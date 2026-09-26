/**
 * 界面通用组件：图标、弹窗、确认框、轻提示、图片查看、加载条、日期格式化。
 */

// ===========================================================================
// 图标
// ===========================================================================

const svg = (path, extra = '') =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${path}</svg>`;

export const icons = {
  check: svg('<path d="M4 10.5 8 14.5 16 6"/>'),
  close: svg('<path d="M5 5l10 10M15 5L5 15"/>'),
  plus: svg('<path d="M10 4v12M4 10h12"/>'),
  edit: svg('<path d="M13.5 3.5 16.5 6.5 7 16H4v-3z"/>'),
  trash: svg('<path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/>'),
  camera: svg('<rect x="3" y="6" width="14" height="10" rx="2"/><circle cx="10" cy="11" r="2.6"/>'),
  album: svg('<rect x="3" y="5" width="14" height="11" rx="2"/><path d="M3 12.5 7 9l4 3.5 2.5-2 3.5 3"/>'),
  file: svg('<path d="M5 3h7l4 4v10H5z"/><path d="M12 3v4h4"/>'),
  target: svg('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2.5"/>'),
  star: svg('<path d="m10 3 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4L5.5 16.8l.9-5L2.8 8.3l5-.7z"/>'),
  chevronLeft: svg('<path d="M12 5 7 10l5 5"/>'),
  chevronRight: svg('<path d="M8 5l5 5-5 5"/>'),
  arrowRight: svg('<path d="M4 10h12M11 5l5 5-5 5"/>'),
  calendar: svg('<rect x="3" y="5" width="14" height="12" rx="2"/><path d="M3 9h14M7 3v4M13 3v4"/>'),
  history: svg('<path d="M10 5v5l3.5 2M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 3v3.5H7"/>'),
  download: svg('<path d="M10 3v9M6 9l4 4 4-4M4 16h12"/>'),
  archive: svg('<rect x="3" y="4" width="14" height="4" rx="1"/><path d="M5 8v8h10V8M8 11h4"/>'),
  refresh: svg('<path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v3.5h-3.5"/>'),
  bell: svg('<path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 4-1.5 5-1.5 5h12s-1.5-1-1.5-5A4.5 4.5 0 0 0 10 3Z"/><path d="M8.5 15.5a1.6 1.6 0 0 0 3 0"/>'),
  folder: svg('<path d="M3 6a1 1 0 0 1 1-1h3.5l1.5 2H16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>'),
  info: svg('<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5v.5"/>'),
};

// ===========================================================================
// 文本与日期
// ===========================================================================

/** 转义 HTML，防止内容里的符号破坏结构 */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** '2026-09-23' → { day: '23', ym: '2026.09', weekday: '周三' } */
export function dateParts(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return {
    day: String(d).padStart(2, '0'),
    ym: `${y}.${String(m).padStart(2, '0')}`,
    weekday: WEEKDAYS[date.getDay()],
    year: y,
    month: m,
  };
}

/** '2026-09-23' → '2026年9月23日 周三' */
export function formatDateCN(iso) {
  const p = dateParts(iso);
  return `${p.year}年${p.month}月${Number(p.day)}日 ${p.weekday}`;
}

/** '2026-09-23' → '9月23日' */
export function formatDateShort(iso) {
  const p = dateParts(iso);
  return `${p.month}月${Number(p.day)}日`;
}

/** 今天的 YYYY-MM-DD */
export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 相对时间描述：今天 / 昨天 / 3 天前 */
export function relativeDay(iso) {
  const today = todayISO();
  if (iso === today) return '今天';
  const diff = Math.round(
    (new Date(`${today}T00:00:00`) - new Date(`${iso}T00:00:00`)) / 86400000,
  );
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  if (diff > 2) return `${diff} 天前`;
  if (diff === -1) return '明天';
  return formatDateShort(iso);
}

/** 字节数转可读大小 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ===========================================================================
// 加载条
// ===========================================================================

let loadingCount = 0;

export function startLoading() {
  loadingCount += 1;
  const bar = document.getElementById('loading-bar');
  if (!bar) return;
  bar.classList.remove('done');
  bar.classList.add('active');
}

export function stopLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount > 0) return;
  const bar = document.getElementById('loading-bar');
  if (!bar) return;
  bar.classList.remove('active');
  bar.classList.add('done');
  setTimeout(() => bar.classList.remove('done'), 300);
}

// ===========================================================================
// 轻提示
// ===========================================================================

export function toast(message, type = '') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const node = document.createElement('div');
  node.className = `toast${type ? ` ${type}` : ''}`;
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 260);
  }, type === 'error' ? 4200 : 2400);
}

export const toastError = (message) => toast(message, 'error');
export const toastSuccess = (message) => toast(message, 'success');

// ===========================================================================
// 弹窗
// ===========================================================================

/**
 * 打开弹窗。
 * @returns {{ close: () => void, root: HTMLElement, body: HTMLElement, foot: HTMLElement }}
 */
export function openModal({ title, body = '', footer = '', size = '', onMount, onClose } = {}) {
  const host = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="modal-title">${esc(title)}</span>
        <button class="modal-close" type="button" aria-label="关闭">${icons.close}</button>
      </div>
      <div class="modal-body"></div>
      ${footer ? '<div class="modal-foot"></div>' : ''}
    </div>`;

  const modalBody = backdrop.querySelector('.modal-body');
  const modalFoot = backdrop.querySelector('.modal-foot');
  if (typeof body === 'string') modalBody.innerHTML = body;
  else modalBody.appendChild(body);
  if (modalFoot && typeof footer === 'string') modalFoot.innerHTML = footer;
  else if (modalFoot && footer) modalFoot.appendChild(footer);

  host.appendChild(backdrop);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (onClose) onClose();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  backdrop.querySelector('.modal-close').addEventListener('click', close);
  // 点击遮罩关闭（点击弹窗本体不关闭）
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });

  // 自动聚焦第一个输入框，减少一次点击
  const firstInput = modalBody.querySelector('input, textarea, select');
  if (firstInput) setTimeout(() => firstInput.focus(), 30);

  if (onMount) onMount({ body: modalBody, foot: modalFoot, close });

  return { close, root: backdrop, body: modalBody, foot: modalFoot };
}

/** 确认对话框 */
export function confirmDialog({
  title = '确认操作',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const modal = openModal({
      title,
      size: 'narrow',
      body: `<p class="text-sm" style="color:var(--text-2);line-height:1.8">${message}</p>`,
      footer: `
        <button class="btn" data-act="cancel" type="button">${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" type="button">${esc(confirmText)}</button>`,
      onMount: ({ foot, close }) => {
        foot.querySelector('[data-act="cancel"]').addEventListener('click', () => {
          decided = true;
          close();
          resolve(false);
        });
        foot.querySelector('[data-act="ok"]').addEventListener('click', () => {
          decided = true;
          close();
          resolve(true);
        });
      },
      onClose: () => {
        if (!decided) resolve(false);
      },
    });
    void modal;
  });
}

/** 提示对话框（只有一个"知道了"） */
export function infoDialog({ title, body, okText = '知道了' }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body,
      footer: `<button class="btn btn-primary" data-act="ok" type="button">${esc(okText)}</button>`,
      onMount: ({ foot, close }) => {
        foot.querySelector('[data-act="ok"]').addEventListener('click', () => {
          close();
          resolve(true);
        });
      },
      onClose: () => resolve(true),
    });
  });
}

// ===========================================================================
// 图片查看
// ===========================================================================

let activeLightbox = null;

/**
 * 打开大图查看。
 * @param {Array<{url:string, caption?:string}>} items
 * @param {number} startIndex
 */
export function openLightbox(items, startIndex = 0) {
  if (!items.length) return;
  if (activeLightbox) activeLightbox();

  let index = Math.max(0, Math.min(startIndex, items.length - 1));

  const node = document.createElement('div');
  node.className = 'lightbox';
  node.innerHTML = `
    <button class="lightbox-close" type="button" aria-label="关闭">${icons.close}</button>
    ${items.length > 1 ? `<button class="lightbox-nav prev" type="button" aria-label="上一张">${icons.chevronLeft}</button>` : ''}
    ${items.length > 1 ? `<button class="lightbox-nav next" type="button" aria-label="下一张">${icons.chevronRight}</button>` : ''}
    <img alt="">
    <div class="lightbox-caption"></div>`;

  const img = node.querySelector('img');
  const caption = node.querySelector('.lightbox-caption');

  const render = () => {
    const item = items[index];
    img.src = item.url;
    img.alt = item.caption || '';
    caption.textContent = `${item.caption || ''}${items.length > 1 ? `　${index + 1} / ${items.length}` : ''}`.trim();
  };
  render();

  const close = () => {
    document.removeEventListener('keydown', onKey);
    node.remove();
    activeLightbox = null;
  };
  const go = (delta) => {
    index = (index + delta + items.length) % items.length;
    render();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  };
  document.addEventListener('keydown', onKey);

  node.querySelector('.lightbox-close').addEventListener('click', close);
  node.querySelector('.prev')?.addEventListener('click', () => go(-1));
  node.querySelector('.next')?.addEventListener('click', () => go(1));
  node.addEventListener('mousedown', (e) => {
    if (e.target === node) close();
  });

  document.body.appendChild(node);
  activeLightbox = close;
}

// ===========================================================================
// 其他
// ===========================================================================

/** 空状态占位 */
export function emptyState({ title, desc = '', action = '', icon = 'file' } = {}) {
  return `
    <div class="empty">
      <div class="empty-mark">${icons[icon] || icons.file}</div>
      <div class="empty-title">${esc(title)}</div>
      ${desc ? `<div class="empty-desc">${esc(desc)}</div>` : ''}
      ${action}
    </div>`;
}

/** 迷你环形进度图 */
export function ringSvg({ ratio, size = 34, stroke = 4, over = false, label = '', center = '' }) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(ratio, 1));
  const dash = circumference * clamped;
  const color = over ? 'var(--accent)' : 'var(--primary)';
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
        stroke="var(--surface-3)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
        stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${dash} ${circumference}"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="${size / 2}" y="${size / 2}" text-anchor="middle" dominant-baseline="central"
        fill="var(--text)" font-size="${Math.round(size * 0.3)}" font-weight="500">${esc(center)}</text>
    </svg>`;
}

/** 防止重复提交：包装一个异步按钮动作 */
export function guard(fn) {
  let busy = false;
  return async (...args) => {
    if (busy) return undefined;
    busy = true;
    try {
      return await fn(...args);
    } finally {
      busy = false;
    }
  };
}
