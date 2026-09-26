/**
 * 首页：今日计划 + 近期收藏 + 各模块摘要。
 *
 * 重要：这里的今日计划数据直接来自计划模块，
 * 在首页打卡走的就是计划模块的接口，两处永远一致。
 */

import { api, fileUrl } from '../api.js';
import {
  esc,
  todayISO,
  ringSvg,
  emptyState,
  openLightbox,
  toastError,
  icons,
} from '../ui.js';
import { toggleCheckin, openCheckinDialog } from '../plan-actions.js';
import { navigate, refresh } from '../router.js';

/** 根据时间给出问候语 */
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/**
 * 中文小写数字（用于"九月二十五日"这种手账式日期）。
 * 1→一  10→十  15→十五  20→二十  25→二十五  31→三十一
 */
function cnNum(n) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return digits[n];
  if (n === 10) return '十';
  if (n < 20) return `十${digits[n % 10]}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ''}`;
}

const CN_WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** 把 YYYY-MM-DD 拆成"九月二十五日" + "2026 · 星期五" */
function heroDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const weekday = CN_WEEK[new Date(y, m - 1, d).getDay()];
  return { day: `${cnNum(m)}月${cnNum(d)}日`, sub: `${y} · ${weekday}` };
}

/** 今日计划里的一项 */
function todayItemHtml(item, date) {
  const over = item.over;
  const done = item.mode === 'check' ? item.checkToday : item.achieved;
  const cls = over ? 'over' : done ? 'done' : '';

  if (item.mode === 'check') {
    const meta = item.streak > 0 ? `连胜 ${item.streak} 天` : `本${item.cycleUnitLabel} ${item.doneInPeriod}/${item.periodDays} 天`;
    return `
      <div class="today-item ${cls}" data-plan="${item.id}" data-mode="check">
        <button class="today-check ${item.checkToday ? 'checked' : ''}" type="button"
                data-check="${item.id}" aria-label="打卡">${icons.check}</button>
        <div class="today-body">
          <div class="today-name">${esc(item.name)}</div>
          <div class="today-meta">${esc(meta)}</div>
        </div>
        ${item.checkToday ? '<span class="tag tag-success">已完成</span>' : ''}
      </div>`;
  }

  const ratio = item.target > 0 ? item.total / item.target : 0;
  const meta = over
    ? `已超额 ${item.overBy} ${esc(item.unit || '')}`
    : `目标 ${item.target} ${esc(item.unit || '')}`;
  return `
    <div class="today-item ${cls}" data-plan="${item.id}" data-mode="quant" style="cursor:pointer">
      <div class="today-body">
        <div class="today-name">${esc(item.name)}</div>
        <div class="today-meta">${meta}</div>
      </div>
      <div class="today-progress">
        ${over ? '<span class="tag tag-accent">超额</span>' : ''}
        ${ringSvg({ ratio, size: 38, stroke: 4, over, center: `${item.total}/${item.target}` })}
      </div>
    </div>`;
}

/** 摘要卡片 */
function summaryCard({ title, main, mainUnit, lines, action, actionTarget }) {
  return `
    <div class="summary-card">
      <div class="s-title">${esc(title)}</div>
      <div class="s-main">${main}${mainUnit ? `<small>${esc(mainUnit)}</small>` : ''}</div>
      <div class="s-lines">${lines.map((l) => esc(l)).join('<br>')}</div>
      ${action ? `<div class="s-action" data-nav="${actionTarget}">${esc(action)} →</div>` : ''}
    </div>`;
}

function buildHtml(home, date) {
  const today = home.today || [];
  const pending = today.filter((t) => t.needsToday);
  const overItems = today.filter((t) => t.over);
  const photos = home.recentPhotos || [];
  const s = home.summaries;

  // ---- 今日计划 ----
  let todayBlock;
  if (!today.length) {
    todayBlock = emptyState({
      title: '今天还没有计划',
      desc: '建一个计划，让每一天都有个着落。',
      icon: 'target',
      action: '<button class="btn btn-primary" data-nav="plans" type="button">去建计划</button>',
    });
  } else {
    todayBlock = `
      <div class="today-list">${today.map((t) => todayItemHtml(t, date)).join('')}</div>
      ${
        overItems.length
          ? `<div class="tag tag-accent mt-3">本周期已超额：${esc(overItems.map((o) => o.name).join('、'))}</div>`
          : ''
      }`;
  }

  // ---- 近期收藏 ----
  const photoBlock = photos.length
    ? `<div class="photo-strip">
         ${photos
           .slice(0, 6)
           .map(
             (p, i) => `
           <div class="photo-thumb" data-photo="${i}">
             <img src="${fileUrl(p.filePath)}" alt="${esc(p.originalName)}" loading="lazy">
           </div>`,
           )
           .join('')}
         ${
           photos.length > 6
             ? `<div class="photo-more" data-nav="albums">+${photos.length - 6}</div>`
             : ''
         }
       </div>`
    : emptyState({
        title: '还没有收藏的图片',
        desc: '把喜欢的照片放进相册，这里就会显示最近的作品。',
        icon: 'album',
        action: '<button class="btn" data-nav="albums" type="button">去相册</button>',
      });

  // ---- 摘要 ----
  const postsLines = [
    `本周 ${s.posts.thisWeek} 篇 · 共 ${s.posts.total} 篇`,
    s.posts.latest
      ? `最近：${s.posts.latest.postDate} ${s.posts.latest.title || '无标题'}`
      : '还没有发布过内容',
    `图片 ${s.posts.mediaCount} 张`,
  ];
  const plansLines = [
    s.plans.total ? `进行中 ${s.plans.total} 项` : '还没有进行中的计划',
    s.plans.total ? `今日完成 ${s.plans.todayDone}/${s.plans.todayTotal}` : '—',
    s.plans.overCount ? `超额达成 ${s.plans.overCount} 项` : '暂无超额',
  ];
  const albumsLines = [
    `相册集 ${s.albums.albumCount} 个 · 图片 ${s.albums.photoCount} 张`,
    s.albums.latest ? `最近：${s.albums.latest.name}（${s.albums.latest.photoCount} 张）` : '还没有相册集',
    `本月新增 ${s.albums.thisMonth} 张`,
  ];

  const hd = heroDate(date);
  const todayLine = home.todayCount
    ? `今日 ${home.todayCount} 项计划${pending.length ? `，还有 ${pending.length} 项待完成` : '，已全部完成'}`
    : '今天还没有安排';

  return `
  <div class="page">
    <div class="page-head">
      <div class="hero">
        <div class="hero-date">
          <span class="hero-day">${esc(hd.day)}</span>
          <span class="hero-sub">${esc(hd.sub)}</span>
        </div>
        <h1 class="hero-greet">${greeting()}</h1>
        <div class="hero-line">${esc(todayLine)}</div>
      </div>
      <button class="btn btn-primary" data-nav="posts" type="button">
        ${icons.plus}<span>写点什么</span>
      </button>
    </div>

    <div class="section">
      <div class="section-head">
        <span class="section-title">今日计划 ${today.length ? `<span class="count">${s.plans.progressLabel}</span>` : ''}</span>
        <span class="section-link" data-nav="plans">全部计划</span>
      </div>
      ${todayBlock}
    </div>

    <div class="section">
      <div class="section-head">
        <span class="section-title">近期收藏</span>
        <span class="section-link" data-nav="albums">查看全部</span>
      </div>
      <div class="card">${photoBlock}</div>
    </div>

    <div class="section">
      <div class="section-head"><span class="section-title">模块摘要</span></div>
      <div class="summary-grid">
        ${summaryCard({
          title: '发布',
          main: String(s.posts.total),
          mainUnit: '篇',
          lines: postsLines,
          action: '去写一篇',
          actionTarget: 'posts',
        })}
        ${summaryCard({
          title: '计划',
          main: `${s.plans.todayDone}/${s.plans.todayTotal}`,
          mainUnit: '',
          lines: plansLines,
          action: '去打卡',
          actionTarget: 'plans',
        })}
        ${summaryCard({
          title: '相册',
          main: String(s.albums.photoCount),
          mainUnit: '张',
          lines: albumsLines,
          action: '去看相册',
          actionTarget: 'albums',
        })}
      </div>
    </div>
  </div>`;
}

function mount(root, home, date) {
  // 确认式：点一下就打勾
  root.querySelectorAll('[data-check]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.check);
      const item = home.today.find((t) => t.id === id);
      if (!item) return;
      await toggleCheckin({ id, checkToday: item.checkToday }, date, () => refresh());
    });
  });

  // 量化式：点整行打开记进度弹窗
  root.querySelectorAll('.today-item[data-mode="quant"]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = Number(row.dataset.plan);
      const item = home.today.find((t) => t.id === id);
      if (!item) return;
      openCheckinDialog({ plan: item, date, onDone: () => refresh() });
    });
  });

  // 近期收藏：点缩略图看大图
  const photos = home.recentPhotos || [];
  const lightboxItems = photos.map((p) => ({
    url: fileUrl(p.filePath),
    caption: `${p.albumName} · ${p.originalName}`,
  }));
  root.querySelectorAll('[data-photo]').forEach((el) => {
    el.addEventListener('click', () => {
      openLightbox(lightboxItems, Number(el.dataset.photo));
    });
  });
}

export async function pageHome() {
  const date = todayISO();
  try {
    const home = await api.home(date);
    return { html: buildHtml(home, date), mount: (root) => mount(root, home, date) };
  } catch (err) {
    toastError(err.message);
    throw err;
  }
}
