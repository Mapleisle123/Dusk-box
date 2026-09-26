/**
 * 计划页。
 *
 * 两种打卡形态在两处呈现完全不同的交互：
 *   确认式 → 周期日历格 + 连胜天数（重点是"坚持"）
 *   量化式 → 环形进度 + 累计值（重点是"完成了多少，有没有超额"）
 *
 * 进入页面会弹一次完成情况提醒。为避免每次打卡刷新都弹（那样很烦人），
 * 同一天只自动弹一次，之后可通过页面右上角的提醒按钮主动查看。
 */

import { api } from '../api.js';
import {
  esc,
  todayISO,
  ringSvg,
  emptyState,
  confirmDialog,
  toastError,
  toastSuccess,
  infoDialog,
  icons,
  dateParts,
} from '../ui.js';
import {
  openCheckinDialog,
  openPlanEditor,
  openPlanHistory,
  toggleCheckin,
  CYCLE_LABEL,
} from '../plan-actions.js';
import { refresh, navigate } from '../router.js';

const REMINDER_KEY = 'qsx-plan-reminder-shown';

/** 是否该自动弹提醒（同一天只弹一次） */
function shouldAutoRemind(date) {
  try {
    return sessionStorage.getItem(REMINDER_KEY) !== date;
  } catch {
    return true;
  }
}

function markReminded(date) {
  try {
    sessionStorage.setItem(REMINDER_KEY, date);
  } catch {
    /* 隐私模式下 sessionStorage 可能不可用，忽略即可 */
  }
}

/** 提醒弹窗内容 */
async function showReminder(date, { silent = false } = {}) {
  let data;
  try {
    data = await api.planReminder(date);
  } catch (err) {
    if (!silent) toastError(err.message);
    return;
  }

  const pendingRows = (data.pendingItems || [])
    .map(
      (p) =>
        `<div class="reminder-item"><span>${esc(p.name)}</span><span class="tag">待完成</span></div>`,
    )
    .join('');
  const overRows = (data.overItems || [])
    .map(
      (p) =>
        `<div class="reminder-item"><span>${esc(p.name)}</span><span class="tag tag-accent">${p.total}/${p.target} ${esc(p.unit || '')}</span></div>`,
    )
    .join('');

  infoDialog({
    title: '今天的计划',
    okText: data.pending > 0 ? '去完成' : '好的',
    body: `
      <div class="reminder-icon">${icons.bell}</div>
      <p class="text-sm" style="color:var(--text-2);line-height:1.9">${esc(data.message)}</p>
      ${pendingRows ? `<div class="reminder-list">${pendingRows}</div>` : ''}
      ${
        overRows
          ? `<div class="section-title mt-4 mb-3">本周期超额</div><div class="reminder-list">${overRows}</div>`
          : ''
      }`,
  });
}

/** 周期日历（确认式） */
function calendarHtml(status, date) {
  const cells = status.calendar || [];
  if (!cells.length) return '';
  return `
    <div class="cal-grid">
      ${cells
        .map((cell) => {
          const parts = dateParts(cell.date);
          const isFuture = cell.date > date;
          const isToday = cell.date === date;
          const cls = [cell.done ? 'done' : '', isToday ? 'today' : '', isFuture ? 'future' : '']
            .filter(Boolean)
            .join(' ');
          return `<div class="cal-cell ${cls}" title="${esc(cell.date)}"
                    ${isFuture ? '' : `data-toggle-date="${cell.date}"`}
                    data-done="${cell.done ? '1' : '0'}">${Number(parts.day)}</div>`;
        })
        .join('')}
    </div>`;
}

/** 单张计划卡 */
function planCardHtml(status, date) {
  const p = status.plan;
  const over = status.over;
  const cardCls = over ? 'over' : status.achieved ? 'achieved' : '';

  const cycleText = `每${CYCLE_LABEL[p.cycleUnit]} · 从 ${p.startDate} 起`;
  const periodText = status.started
    ? `本周期 ${status.period.startISO} → ${status.period.endISO}`
    : `将于 ${p.startDate} 开始`;

  let bodyHtml;
  if (p.mode === 'check') {
    bodyHtml = `
      <div class="plan-body">
        <div class="plan-stats">
          <div class="plan-stat"><span class="k">本周期完成</span><span class="v">${status.doneInPeriod} / ${status.periodDays} 天</span></div>
          <div class="plan-stat"><span class="k">连续打卡</span><span class="v">${status.streak} 天</span></div>
        </div>
      </div>
      ${calendarHtml(status, date)}`;
  } else {
    const ratio = status.target > 0 ? status.total / status.target : 0;
    bodyHtml = `
      <div class="plan-body">
        <div class="ring-wrap">
          ${ringSvg({ ratio, size: 58, stroke: 6, over, center: `${status.total}/${status.target}` })}
        </div>
        <div class="plan-stats">
          <div class="plan-stat"><span class="k">周期目标</span><span class="v">${status.target} ${esc(status.unit || '')}</span></div>
          <div class="plan-stat"><span class="k">已完成</span><span class="v">${status.total} ${esc(status.unit || '')}</span></div>
          <div class="plan-stat"><span class="k">剩余</span><span class="v">${status.period ? status.period.daysLeft : '-'} 天</span></div>
        </div>
      </div>`;
  }

  const mainButton =
    p.mode === 'check'
      ? `<button class="btn ${status.checkToday ? '' : 'btn-primary'} btn-sm" data-checkin="${p.id}" type="button">
           ${status.checkToday ? '撤销打卡' : '今日打卡'}
         </button>`
      : `<button class="btn btn-primary btn-sm" data-progress="${p.id}" type="button">记进度</button>`;

  return `
    <div class="plan-card ${cardCls}" data-plan="${p.id}">
      <div class="plan-card-head">
        <div>
          <div class="plan-name">${esc(p.name)}</div>
          <div class="plan-sub">${esc(cycleText)}</div>
        </div>
        <div class="row-tight">
          ${over ? `<span class="tag tag-accent">超额 +${status.overBy}</span>` : ''}
          ${p.archived ? '<span class="tag">已归档</span>' : ''}
          ${p.mode === 'quant' ? '<span class="tag">量化</span>' : '<span class="tag">确认</span>'}
        </div>
      </div>

      ${bodyHtml}

      <div class="plan-sub">${esc(periodText)}</div>

      <div class="plan-actions">
        ${status.started ? mainButton : '<span class="tag">尚未开始</span>'}
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-icon" data-history="${p.id}" type="button" title="打卡记录">${icons.history}</button>
        <button class="btn btn-ghost btn-icon" data-edit="${p.id}" type="button" title="编辑">${icons.edit}</button>
        <button class="btn btn-ghost btn-icon" data-archive="${p.id}" data-archived="${p.archived ? '1' : '0'}" type="button" title="${p.archived ? '取消归档' : '归档'}">${icons.archive}</button>
        <button class="btn btn-ghost btn-icon" data-delete="${p.id}" type="button" title="删除">${icons.trash}</button>
      </div>
    </div>`;
}

function buildHtml({ active, archived }, date) {
  const head = `
    <div class="page-head">
      <div>
        <h1>计划</h1>
        <div class="sub">安排一周、一个月甚至一年的计划，每天打卡推进</div>
      </div>
      <div class="row-tight">
        <button class="btn btn-icon" data-show-reminder type="button" title="查看今日完成情况">${icons.bell}</button>
        <button class="btn btn-primary" data-new-plan type="button">${icons.plus}<span>新建计划</span></button>
      </div>
    </div>`;

  const activeBlock = active.length
    ? `<div class="plan-grid">${active.map((s) => planCardHtml(s, date)).join('')}</div>`
    : emptyState({
        title: '还没有进行中的计划',
        desc: '可以是"每天背单词"这样的确认式，也可以是"每周跑 3 次"这样的量化式——量化式还能超额完成。',
        icon: 'target',
        action: '<button class="btn btn-primary" data-new-plan type="button">新建第一个计划</button>',
      });

  const archivedBlock = archived.length
    ? `
      <div class="section mt-4">
        <div class="section-head">
          <span class="section-title">已归档 <span class="count">${archived.length}</span></span>
        </div>
        <div class="plan-grid">${archived.map((s) => planCardHtml(s, date)).join('')}</div>
      </div>`
    : '';

  return `<div class="page">${head}${activeBlock}${archivedBlock}</div>`;
}

function mount(root, data, date) {
  const findById = (id) =>
    [...data.active, ...data.archived].find((s) => s.plan.id === Number(id));

  // 新建
  root.querySelectorAll('[data-new-plan]').forEach((el) => {
    el.addEventListener('click', () => openPlanEditor({ onSaved: () => refresh() }));
  });

  // 主动查看提醒
  root.querySelector('[data-show-reminder]')?.addEventListener('click', () => {
    showReminder(date, { silent: false });
  });

  // 确认式：今日打卡按钮
  root.querySelectorAll('[data-checkin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const s = findById(btn.dataset.checkin);
      if (!s) return;
      await toggleCheckin({ id: s.plan.id, checkToday: s.checkToday }, date, () => refresh());
    });
  });

  // 确认式：点日历格补打卡 / 撤销
  root.querySelectorAll('[data-toggle-date]').forEach((cell) => {
    cell.addEventListener('click', async () => {
      const card = cell.closest('[data-plan]');
      const s = findById(card.dataset.plan);
      if (!s) return;
      const target = cell.dataset.toggleDate;
      try {
        if (cell.dataset.done === '1') {
          await api.uncheckin(s.plan.id, target);
        } else {
          await api.checkin(s.plan.id, { date: target });
        }
        refresh();
      } catch (err) {
        toastError(err.message);
      }
    });
  });

  // 量化式：记进度
  root.querySelectorAll('[data-progress]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = findById(btn.dataset.progress);
      if (!s) return;
      openCheckinDialog({
        plan: {
          id: s.plan.id,
          name: s.plan.name,
          total: s.total,
          target: s.target,
          unit: s.unit,
          ratio: s.ratio,
        },
        date,
        onDone: () => refresh(),
      });
    });
  });

  // 历史记录
  root.querySelectorAll('[data-history]').forEach((btn) => {
    btn.addEventListener('click', () => openPlanHistory({ planId: btn.dataset.history, date }));
  });

  // 编辑
  root.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = findById(btn.dataset.edit);
      if (!s) return;
      openPlanEditor({ plan: s.plan, onSaved: () => refresh() });
    });
  });

  // 归档 / 取消归档
  root.querySelectorAll('[data-archive]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const willArchive = btn.dataset.archived !== '1';
      try {
        await api.archivePlan(btn.dataset.archive, willArchive);
        toastSuccess(willArchive ? '已归档' : '已取消归档');
        refresh();
      } catch (err) {
        toastError(err.message);
      }
    });
  });

  // 删除
  root.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const s = findById(btn.dataset.delete);
      if (!s) return;
      const yes = await confirmDialog({
        title: '删除计划',
        message: `确定要删除「${esc(s.plan.name)}」吗？<br>该计划的全部打卡记录和磁盘上的 <span class="mono">计划/${esc(s.plan.name)}.md</span> 文件都会被删除，无法恢复。`,
        confirmText: '删除',
        danger: true,
      });
      if (!yes) return;
      try {
        await api.deletePlan(s.plan.id);
        toastSuccess('已删除');
        refresh();
      } catch (err) {
        toastError(err.message);
      }
    });
  });
}

export async function pagePlans() {
  const date = todayISO();
  const all = await api.listPlans({ date, includeArchived: true });
  const data = {
    active: all.filter((s) => !s.plan.archived),
    archived: all.filter((s) => s.plan.archived),
  };

  const shouldRemind = shouldAutoRemind(date);
  if (shouldRemind) markReminded(date);

  return {
    html: buildHtml(data, date),
    mount: (root) => {
      mount(root, data, date);
      if (shouldRemind) showReminder(date, { silent: true });
    },
  };
}
