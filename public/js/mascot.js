/**
 * 左下角的吉祥物「祀」——纯静态图。
 *
 * 五张透明 PNG（img/mascot/）：
 *   wave     挥手：打开页面 / 每次切页 / 拖完松手回到这张
 *   struggle 挣扎：按住拖动时，可以拖到页面任何地方
 *   idle     待机：10 秒没有任何操作
 *   point    手指朝右：悬停或单击时，右边冒气泡说这一页该做什么
 *   hide     收起：双击之后换成这张，只露右侧一条（手 + 半个脑袋）
 *
 * 三条硬约束（都是踩过坑换来的）：
 *   1. 她**必须挂在 <body> 下**，不能放进侧栏：侧栏带 backdrop-filter，
 *      会把她当成自己的子层并裁掉，于是拖不出侧栏；
 *   2. 拖动过程中**绝对不要搬动 DOM**：一旦 appendChild 换父节点，
 *      浏览器会释放指针捕获，后面的移动/松手事件全收不到——拖动直接卡死；
 *   3. 换图用**两张图交叉淡入**，直接改 src 是硬切。
 */

import { store } from './store.js';
import { assetUrl } from './api.js';
import { DRAG_THRESHOLD_PX, IDLE_AFTER_MS, mascotLineFor } from './mascot-rules.js';

const IMG = {
  wave: assetUrl('mascot/wave.png'),
  struggle: assetUrl('mascot/struggle.png'),
  idle: assetUrl('mascot/idle.png'),
  point: assetUrl('mascot/point.png'),
  hide: assetUrl('mascot/hide.png'),
};

/** 收起时往左挪多少：留出右侧那一条。露多了/露少了只改这一个数。 */
const HIDDEN_SHIFT = '-58%';

let els = null; // { wrap, body, bubble }
let layers = null; // 两张叠着的图：[当前显示, 备用]
let shown = 0;
/** 每次换图自增：图片是异步加载的，旧的那次回调要作废 */
let showToken = 0;
let state = 'wave';
let hidden = false;
let drag = null;
/** 刚拖完的那一次 click 要丢掉：浏览器在拖动结束后仍会补发 click，
   不丢掉的话她会立刻被"单击=point"覆盖，表现为"拖完定格成 point"。 */
let justDragged = false;
/** 单击要等一小会儿再动作：浏览器双击时会先发两次 click 再发 dblclick，
   不等待的话就变成"先冒 point、再收起"，看着像两个动作连着触发。 */
let clickTimer = 0;
/** 气泡被"钉住"了：点一下钉住（怎么动鼠标都不消失），再点一下才收回 */
let pinned = false;
let timers = { idle: 0, bubble: 0 };

export function mascotEnabled() {
  return store.settings?.mascot !== 'false';
}

/** 换图：新图淡入、旧图淡出（两张图叠在同一位置接力） */
function showState(name, force = false) {
  if (!els || (state === name && !force)) return;
  state = name;
  const nextIndex = shown === 0 ? 1 : 0;
  const next = layers[nextIndex];
  const prev = layers[shown];
  const token = (showToken += 1);
  next.src = IMG[name];

  // 必须等新图**加载完**再交叉淡入。直接切的话，那一层上还挂着它上一次的内容
  // （比如刚从挥手切过来），于是"收起"的位置会闪出挥手图——而且是看运气的，
  // 加载快就不出现、加载慢就闪一下。
  const swap = () => {
    if (token !== showToken || !els || !next.isConnected) return; // 已经又换过图了
    next.classList.add('show');
    prev.classList.remove('show');
    shown = nextIndex;
  };
  if (next.complete && next.naturalWidth > 0) swap();
  else next.addEventListener('load', swap, { once: true });
}

/** 10 秒没人管她就待机；任何操作都会把计时清零 */
function restartIdleTimer() {
  clearTimeout(timers.idle);
  timers.idle = setTimeout(() => {
    if (!hidden && !pinned) showState('idle');
  }, IDLE_AFTER_MS);
}

function hideBubble() {
  if (!els) return;
  clearTimeout(timers.bubble);
  els.bubble.classList.remove('show');
  els.bubble.hidden = true;
}

/** 她指向右边 + 冒一句"这一页该干什么" */
function pointAndSay(ms = 4200) {
  if (!els || hidden) return;
  const line = mascotLineFor(window.location.hash);
  if (!line) return;
  clearTimeout(timers.idle);
  showState('point');
  els.bubble.textContent = line;
  els.bubble.hidden = false;
  els.bubble.classList.remove('show');
  void els.bubble.offsetWidth;
  els.bubble.classList.add('show');
  clearTimeout(timers.bubble);
  // ms = 0 表示"不自动收"（钉住）。**不能**直接把它丢给 setTimeout——
  // 0 毫秒会立刻执行，气泡刚冒出来就被自己收掉，看着就是"点了没反应"。
  if (ms > 0) {
    timers.bubble = setTimeout(() => {
      hideBubble();
      if (!hidden && !pinned) {
        showState('wave');
        restartIdleTimer();
      }
    }, ms);
  }
}

/** 收起 / 展开 */
function setHidden(value) {
  if (!els) return;
  hidden = value;
  els.wrap.classList.toggle('is-hidden', value);
  els.wrap.style.setProperty('--mascot-shift', HIDDEN_SHIFT);
  hideBubble();
  clearTimeout(timers.idle);
  pinned = false;
  showState(value ? 'hide' : 'wave', true);
  if (!value) restartIdleTimer();
}

// ---- 拖动（全程不搬 DOM）------------------------------------------------

function onPointerDown(e) {
  if (!els || e.button !== 0) return;
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, dx: 0, dy: 0 };
  try {
    els.body.setPointerCapture(e.pointerId);
  } catch {
    /* 个别环境不支持指针捕获，退化成普通事件也能用 */
  }
}

function onPointerMove(e) {
  if (!els || !drag || e.pointerId !== drag.id) return;

  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) <= DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    clearTimeout(timers.idle);
    hideBubble();
    pinned = false;
    const rect = els.body.getBoundingClientRect();
    drag.dx = drag.sx - rect.left;
    drag.dy = drag.sy - rect.top;
    els.body.style.width = `${rect.width}px`;
    els.body.style.height = `${rect.height}px`;
    els.body.style.left = `${rect.left}px`;
    els.body.style.top = `${rect.top}px`;
    els.body.classList.add('is-dragging'); // 她在 body 下，天然浮在整页最上层
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

  if (!wasDrag) return; // 单击交给 click 处理，别在这里重复触发

  // 紧接着的那次 click 要忽略（浏览器在拖动结束后会补发一次）。
  // 但拖到别处松手时那次 click 可能根本不发，所以给它一个 400ms 的自动过期——
  // 否则标记一直挂着，会把用户后面第一次真正的单击吃掉（表现为"单击没反应"）。
  justDragged = true;
  setTimeout(() => {
    justDragged = false;
  }, 400);

  // 松手：记下她在哪，删掉拖动态（她立刻回到左下角原位），再用位移把这一跳补成动画
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

/** 挂到 <body> 下（不能放侧栏里，理由见文件头） */
export function mountMascot() {
  if (!mascotEnabled() || els) return;

  const wrap = document.createElement('div');
  wrap.className = 'mascot';
  wrap.innerHTML = `
    <button class="mascot-body" type="button" aria-label="吉祥物：祀">
      <img class="mascot-img show" src="${IMG.wave}" alt="" decoding="async">
      <img class="mascot-img" alt="" decoding="async">
      <span class="mascot-bubble" hidden></span>
    </button>`;
  document.body.appendChild(wrap);

  els = {
    wrap,
    body: wrap.querySelector('.mascot-body'),
    bubble: wrap.querySelector('.mascot-bubble'),
  };
  layers = [...wrap.querySelectorAll('.mascot-img')];
  shown = 0;
  state = 'wave';
  hidden = false;

  // 五张图先预热（本地文件，合计 2.5MB）。不预热的话，第一次切到某张图要等
  // 文件读完才淡入——单击/收起那一瞬间会明显顿一下。
  for (const src of Object.values(IMG)) {
    const warm = new Image();
    warm.src = src;
  }

  // 图不在（素材没放好）：整块收起，绝不留破图
  for (const layer of layers) {
    layer.addEventListener('error', () => unmountMascot(), { once: true });
  }

  els.body.addEventListener('pointerdown', onPointerDown);
  els.body.addEventListener('pointermove', onPointerMove);
  els.body.addEventListener('pointerup', onPointerUp);
  els.body.addEventListener('pointercancel', onPointerUp);
  els.body.addEventListener('click', (e) => {
    e.preventDefault();
    if (justDragged) {
      justDragged = false; // 这次点击是拖动补发的，放过
      return;
    }
    if (hidden) {
      setHidden(false); // 收起时点露出来的那一条 = 立即展开
      return;
    }
    // 已经钉住了：再点一下就收回、回到挥手图
    if (pinned) {
      pinned = false;
      hideBubble();
      showState('wave');
      restartIdleTimer();
      return;
    }
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      pinned = true; // 钉住：鼠标移开也不消失
      pointAndSay(0);
    }, 200); // 等一等，看是不是双击（太长会显得点了没反应）
  });
  els.body.addEventListener('dblclick', (e) => {
    e.preventDefault();
    clearTimeout(clickTimer); // 是双击：把刚才那次单击的动作取消掉
    pinned = false;
    setHidden(true); // 双击 = 收起
  });
  els.body.addEventListener('pointerenter', () => {
    if (!hidden && !justDragged) pointAndSay(0);
  });
  els.body.addEventListener('pointerleave', () => {
    if (!pinned) hideBubble(); // 钉住的不收
  });

  restartIdleTimer();
}

export function unmountMascot() {
  clearTimeout(timers.idle);
  clearTimeout(timers.bubble);
  drag = null;
  layers = null;
  shown = 0;
  if (els) els.wrap.remove();
  els = null;
}

export function refreshMascot() {
  if (mascotEnabled()) mountMascot();
  else unmountMascot();
}

/** 切页：挥手 + 重新计时（收起状态下保持收起） */
export function mascotOnRouteChange() {
  if (!els || hidden) return;
  hideBubble();
  showState('wave');
  restartIdleTimer();
}

export function mascotState() {
  return state;
}
