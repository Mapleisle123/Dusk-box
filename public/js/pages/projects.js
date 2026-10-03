/**
 * 项目页。
 *
 * 「项目」装的是一次性的、有始有终的事：做某件事、整理某批东西。
 * 与「计划」页的区别是这里没有打卡、没有周期，只有三样东西要留住：
 * 推进到哪了（百分比）、现在是什么状态、已经拿到了什么结果（文字 + 图片）。
 */

import { api, fileUrl } from '../api.js';
import {
  esc,
  emptyState,
  openModal,
  confirmDialog,
  toastError,
  toastSuccess,
  formatDateShort,
  todayISO,
} from '../ui.js';
import { refresh } from '../router.js';

/** 状态枚举与界面文案（与服务端 services/projects.js 保持一致） */
const STATUS = [
  { id: 'active', label: '进行中', tag: 'tag-primary' },
  { id: 'paused', label: '搁置', tag: '' },
  { id: 'done', label: '已完成', tag: 'tag-success' },
];

const statusOf = (id) => STATUS.find((s) => s.id === id) || STATUS[0];

/** 结果文字的摘要（卡片上只显示一小段） */
function excerpt(text, max = 90) {
  const plain = String(text || '')
    .replace(/[#*`>[\]()!-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

/** 一张项目卡片 */
function projectCard(item) {
  const status = statusOf(item.status);
  const media = item.media || [];
  const thumbs = media
    .slice(0, 4)
    .map(
      (m) =>
        `<img class="project-thumb" src="${esc(fileUrl(m.filePath))}" alt="${esc(m.originalName)}" loading="lazy" decoding="async">`,
    )
    .join('');
  const more = media.length > 4 ? `<span class="project-more">+${media.length - 4}</span>` : '';
  const text = excerpt(item.result);

  return `
    <div class="card project-card" data-project="${item.id}">
      <div class="project-head">
        <div class="project-name">${esc(item.name)}</div>
        <span class="tag ${status.tag}">${esc(item.statusLabel || status.label)}</span>
      </div>
      <div class="project-progress">
        <div class="progress-bar"><div class="progress-fill ${item.progress >= 100 ? 'over' : ''}" style="width:${item.progress}%"></div></div>
        <span class="project-pct">${item.progress}%</span>
      </div>
      ${
        item.status === 'done'
          ? ''
          : `<input class="project-range" type="range" min="0" max="100" step="5" value="${item.progress}"
                    data-project-range aria-label="${esc(item.name)} 的进度">`
      }
      ${text ? `<div class="project-result">${esc(text)}</div>` : '<div class="project-result muted">还没有写结果</div>'}
      ${thumbs ? `<div class="project-thumbs">${thumbs}${more}</div>` : ''}
      <div class="project-foot">
        <span class="text-xs muted">开始 ${esc(item.startDate)} · 更新 ${esc(formatDateShort(item.updatedAt))}</span>
        <div class="project-actions">
          ${
            item.status === 'done'
              ? ''
              : `<button class="btn btn-sm" type="button" data-project-done="${item.id}">标记完成</button>`
          }
          <button class="btn btn-sm" type="button" data-project-edit="${item.id}">编辑</button>
          <button class="btn btn-sm btn-danger" type="button" data-project-del="${item.id}">删除</button>
        </div>
      </div>
    </div>`;
}

/**
 * 新建 / 编辑弹窗。
 * @param {object|null} item 传 null 就是新建
 */
function openProjectEditor(item) {
  const editing = Boolean(item);
  const current = item || {
    name: '',
    status: 'active',
    progress: 0,
    startDate: todayISO(),
    result: '',
  };
  const media = current.media || [];

  const options = STATUS.map(
    (s) => `<option value="${s.id}" ${s.id === current.status ? 'selected' : ''}>${s.label}</option>`,
  ).join('');

  const mediaHtml = media.length
    ? `<div class="editor-media">${media
        .map(
          (m) => `
          <div class="editor-media-item">
            <img src="${esc(fileUrl(m.filePath))}" alt="${esc(m.originalName)}" loading="lazy" decoding="async">
            <button class="bg-del" type="button" data-media-del="${m.id}" title="删除这张图">×</button>
          </div>`,
        )
        .join('')}</div>`
    : '<p class="text-sm muted">还没有成果图。可以选几张放进来。</p>';

  openModal({
    title: editing ? '编辑项目' : '新建项目',
    body: `
      <div class="field">
        <label for="pj-name">名称</label>
        <input class="input" id="pj-name" type="text" maxlength="60" autocomplete="off"
               placeholder="例如：整理旧照片" value="${esc(current.name)}">
      </div>
      <div class="field-row">
        <div class="field">
          <label for="pj-status">状态</label>
          <select class="input" id="pj-status">${options}</select>
        </div>
        <div class="field">
          <label for="pj-start">开始日期</label>
          <input class="input" id="pj-start" type="date" value="${esc(current.startDate)}">
        </div>
      </div>
      <div class="field">
        <label for="pj-progress">进度：<span id="pj-progress-label">${current.progress}</span>%</label>
        <input class="input" id="pj-progress" type="range" min="0" max="100" step="5" value="${current.progress}">
      </div>
      <div class="field">
        <label for="pj-result">结果（已经取得的进展、成果、结论）</label>
        <textarea class="input" id="pj-result" rows="4"
                  placeholder="例如：2019~2022 年的照片已按年份归档">${esc(current.result)}</textarea>
      </div>
      <div class="field">
        <label>成果图</label>
        ${mediaHtml}
        <input class="input" id="pj-files" type="file" accept="image/*" multiple>
      </div>`,
    footer: `
      <button class="btn" data-act="cancel" type="button">取消</button>
      <button class="btn btn-primary" data-act="save" type="button">${editing ? '保存' : '创建'}</button>`,
    onMount: ({ body, foot, close }) => {
      const progress = body.querySelector('#pj-progress');
      const label = body.querySelector('#pj-progress-label');
      progress?.addEventListener('input', () => {
        if (label) label.textContent = progress.value;
      });

      foot.querySelector('[data-act="cancel"]').addEventListener('click', close);

      // 删掉一张已有的成果图（图在磁盘上，删完要立刻重渲染，免得界面上还挂着）
      body.querySelectorAll('[data-media-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const yes = await confirmDialog({
            title: '删除这张图？',
            message: '图片会从磁盘上一起删掉。',
            confirmText: '删除',
            danger: true,
          });
          if (!yes) return;
          try {
            await api.deleteProjectMedia(current.id, btn.dataset.mediaDel);
            btn.closest('.editor-media-item')?.remove();
            toastSuccess('已删除');
          } catch (err) {
            toastError(err.message);
          }
        });
      });

      foot.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const form = new FormData();
        form.append('name', body.querySelector('#pj-name').value.trim());
        form.append('status', body.querySelector('#pj-status').value);
        form.append('startDate', body.querySelector('#pj-start').value);
        form.append('progress', progress.value);
        form.append('result', body.querySelector('#pj-result').value);
        for (const file of body.querySelector('#pj-files').files) form.append('files', file);

        btn.disabled = true;
        try {
          if (editing) await api.updateProject(current.id, form);
          else await api.createProject(form);
          close();
          toastSuccess(editing ? '已保存' : '已创建');
          refresh();
        } catch (err) {
          toastError(err.message);
          btn.disabled = false;
        }
      });
    },
  });
}

/** 设置状态（标记完成用它） */
async function setStatus(id, status) {
  try {
    await api.updateProject(id, { status });
    refresh();
  } catch (err) {
    toastError(err.message);
  }
}

export async function pageProjects() {
  const items = await api.listProjects();

  const html = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>项目</h1>
          <div class="sub">正在推进的事，以及已经拿到的结果</div>
        </div>
        <button class="btn btn-primary" data-project-new type="button">新建项目</button>
      </div>
      ${
        items.length
          ? `<div class="project-list">${items.map(projectCard).join('')}</div>`
          : emptyState({
              title: '还没有项目',
              desc: '这里放的是"一次做完"的事——比如整理旧照片、读完一本书、做完某个版本。',
              action: '<button class="btn btn-primary" data-project-new type="button">新建一个</button>',
            })
      }
    </div>`;

  return {
    html,
    mount(root) {
      body.querySelectorAll('[data-project-new]').forEach((btn) => {
        btn.addEventListener('click', () => openProjectEditor(null));
      });

      body.querySelectorAll('[data-project-edit]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const project = await api.getProject(btn.dataset.projectEdit);
            openProjectEditor(project);
          } catch (err) {
            toastError(err.message);
          }
        });
      });

      body.querySelectorAll('[data-project-done]').forEach((btn) => {
        btn.addEventListener('click', () => setStatus(btn.dataset.projectDone, 'done'));
      });

      body.querySelectorAll('[data-project-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const yes = await confirmDialog({
            title: '删除这个项目？',
            message: '项目文件与成果图会一起删掉，删了就找不回来了。',
            confirmText: '删除',
            danger: true,
          });
          if (!yes) return;
          try {
            await api.deleteProject(btn.dataset.projectDel);
            toastSuccess('已删除');
            refresh();
          } catch (err) {
            toastError(err.message);
          }
        });
      });

      // 拖动进度条松手即保存（用 change 而不是 input：拖动过程中不打扰服务端）
      body.querySelectorAll('[data-project-range]').forEach((range) => {
        range.addEventListener('change', async () => {
          const card = range.closest('[data-project]');
          const id = card?.dataset.project;
          const value = Number(range.value);
          try {
            await api.updateProject(id, { progress: value });
            const fill = card.querySelector('.progress-fill');
            const pct = card.querySelector('.project-pct');
            if (fill) {
              fill.style.width = `${value}%`;
              fill.classList.toggle('over', value >= 100);
            }
            if (pct) pct.textContent = `${value}%`;
          } catch (err) {
            toastError(err.message);
          }
        });
      });
    },
  };
}
