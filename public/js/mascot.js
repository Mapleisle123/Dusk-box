/**
 * 侧栏里的吉祥物「祀」——**纯静态图**版本。
 *
 * 四张图（都放在 img/mascot/，都是带透明通道的 PNG）：
 *   wave     挥手：进入/切换页面时
 *   struggle 挣扎：按住拖动时
 *   idle     待机：10 秒没有任何操作
 *   point    手指朝右：鼠标悬停或点击时，右边冒一个气泡说当前页面该干什么
 *
 * 规矩：
 *   - 她**不遮挡任何能点的东西**：住在侧栏自己那格里，容器本身不吃鼠标事件，
 *     只有她本人接鼠标；
 *   - 松手一定飞回侧栏原位，然后回到挥手图、重新开始 10 秒计时；
 *   - 气泡的话术**每个页面不一样**（见 PAGE_LINES），她指哪儿就是在提醒去哪儿。
 */

import { assetUrl } from './api.js';
import { store } from './store.js';
import { DRAG_THRESHOLD_PX, IDLE_AFTER_MS, mascotLineFor, noteClick } from './mascot-rules.js';

const IMG = {
  wave: assetUrl('mascot/wave.png'),
  struggle: assetUrl('mascot/struggle.png'),
  idle: assetUrl('mascot/idle.png'),
  point: assetUrl('mascot/point.png'),
};

let els = null; // { wrap, body, img, bubble }
let state = 'wave';
let clickTimes = [];
let drag = null;
let timers = { idle: 0, bubble: 0 };
let bound = false;

export function mascotEnabled() {
  return store.settings?.mascot !== 'false';
}

function clearIdleTimer() {
  clearTimeout(timers.idle);
}

/** 秀一张状态图（不带气泡） */
function showState(name) {
  if (!els) return;
  state = name;
  els.body.classList.toggle('is-pointing', name === 'point');
  els.img.src = IMG[name];
}

/** 10 秒没人理她 → 待机；任何操作都会把计时清零 */
function restartIdleTimer() {
  clearIdleTimer();
  timers.idle = setTimeout(() => showState('idle'), IDLE_AFTER_MS);
}

function hideBubble() {
  if (!els) return;
  clearTimeout(timers.bubble);
  els.bubble.classList.remove('show');
  els.bubble.hidden = true;
  if (state === 'point') showState('wave');
}

/** 她指右边 + 右边冒一句"该干什么" */
function pointAndSay(ms = 4200) {
  if (!els) return;
  const line = mascotLineFor(window.location.hash);
  if (!line) return;
  clearIdleTimer();
  showState('point');
  els.bubble.textContent = line;
  els.bubble.hidden = false;
  els.bubble.classList.remove('show');
  void els.bubble.offsetWidth;
  els.bubble.classList.add('show');
  clearTimeout(timers.bubble);
  timers.bubble = setTimeout(hideBubble, ms);
}

// ---- 拖动 ----------------------------------------------------------------

function onPointerDown(e) {
  if (!els || e.button !== 0) return;
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, dx: 0, dy: 0 };
  try {
    els.body.setPointerCapture(e.pointerId);
  } catch {
    /* 不支持指针捕获时退化成普通事件 */
  }
}

function onPointerMove(e) {
  if (!els || !drag || e.pointerId !== drag.id) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) <= DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    clearIdleTimer();
    hideBubble();
    const rect = els.body.getBoundingClientRect();
    drag.dx = drag.sx - rect.left;
    drag.dy = drag.sy - rect.top;
    els.body.style.width = `${rect.width}px`;
    els.body.style.height = `${rect.height}px`;
    els.body.style.left = `${rect.left}px`;
    els.body.style.top = `${rect.top}px`;
    els.body.classList.add('is-dragging');
    showState('struggle');
  }
  const rect = els.body.getBoundingClientRect();
  const m = 4;
  els.body.style.left = `${Math.min(Math.max(e.clientX - drag.dx, m), window.innerWidth - rect.width - m)}px`;
  els.body.style.top = `${Math.min(Math.max(e.clientY - drag.dy, m), window.innerHeight - rect.height - m)}px`;
}

function onPointerUp(e) {
  if (!els || !drag || e.pointerId !== drag.id) return;
  const wasDrag = drag.moved;
  drag = null;
  try {
    els.body.releasePointerCapture(e.pointerId);
  } catch {
    /* 没捕获成功就不用释放 */
  }

  if (!wasDrag) {
    const result = noteClick(clickTimes, Date.now());
    clickTimes = result.recent;
    pointAndSay();
    return;
  }

  // 松手：记下她在哪，删掉拖动态让她瞬间回位，再用一段位移把这一跳补成动画
  const flying = els.body.getBoundingClientRect();
  els.body.classList.remove('is-dragging');
  els.body.style.left = '';
  els.body.style.top = '';
  els.body.style.width = '';
  els.body.style.height = '';
  const home = els.body.getBoundingClientRect();
  els.body.style.transition = 'none';
  els.body.style.transform = `translate(${flying.left - home.left}px, ${flying.top - home.top}px)`;
  void els.body.offsetWidth;
  els.body.style.transition = '';
  requestAnimationFrame(() => {
    if (els) els.body.style.transform = '';
  });

  showState('wave'); // 用户定的：松手回到挥手图
  restartIdleTimer();
}

// ---- 挂载 / 卸载 ---------------------------------------------------------

export function mountMascot() {
  if (bound === false) {
    bound = true;
    window.addEventListener('duskbox:published', () => {
      if (mascotEnabled()) pointAndSay();
    });
  }
  if (!mascotEnabled() || els) return;

  const slot = document.getElementById('mascot-slot');
  if (!slot) return;

  const wrap = document.createElement('div');
  wrap.className = 'mascot';
  wrap.innerHTML = `
    <button class="mascot-body" type="button" aria-label="吉祥物：祀">
      <img class="mascot-img" src="${IMG.wave}" alt="" decoding="async">
      <span class="mascot-bubble" hidden></span>
    </button>`;
  slot.appendChild(wrap);

  els = {
    wrap,
    body: wrap.querySelector('.mascot-body'),
    img: wrap.querySelector('.mascot-img'),
    bubble: wrap.querySelector('.mascot-bubble'),
  };
  state = 'wave';

  // 图不在（素材没放好）：整块收起，绝不留破图
  els.img.addEventListener('error', () => unmountMascot(), { once: true });

  els.body.addEventListener('pointerdown', onPointerDown);
  els.body.addEventListener('pointermove', onPointerMove);
  els.body.addEventListener('pointerup', onPointerUp);
  els.body.addEventListener('pointercancel', onPointerUp);
  els.body.addEventListener('click', (e) => e.preventDefault());
  els.body.addEventListener('pointerenter', () => pointAndSay(0));
  els.body.addEventListener('pointerleave', hideBubble);
  els.body.addEventListener('focus', () => pointAndSay(0));
  els.body.addEventListener('blur', hideBubble);

  restartIdleTimer();
}

export function unmountMascot() {
  clearIdleTimer();
  clearTimeout(timers.bubble);
  drag = null;
  clickTimes = [];
  if (els) els.wrap.remove();
  els = null;
}

export function refreshMascot() {
  if (mascotEnabled()) mountMascot();
  else unmountMascot();
}

/** 每次切页：换成挥手图，并重新开始 10 秒计时 */
export function mascotOnRouteChange() {
  if (!els) return;
  hideBubble();
  showState('wave');
  restartIdleTimer();
}

export function mascotState() {
  return state;
}
