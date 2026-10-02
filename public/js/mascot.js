/**
 * 侧栏里的吉祥物「祀」。
 *
 * 她住在左侧导航与底部服务状态之间那块空白里：静止时是一张静态立绘，
 * 四种场合换成动作素材——切页挥手、连点跺脚、拖动挣扎、久置待机。
 *
 * 几条设计上的取舍：
 *   - **动作用 `<video>` 而不是动图**。原始素材（img/mascot/gif/*.mp4）是 H.264 视频，
 *     视频的播放控制比动图精确得多：播完有 `ended` 事件、要循环就 `loop`、
 *     不用猜"该等多少毫秒才假装播完"。视频带音轨，必须静音播——这个应用是安静的。
 *   - **素材是白底的**（H.264 带不了透明通道），所以给她一个小圆角"窗"：
 *     白底就是窗的底色，静止那张透明 PNG 也放在同一个窗里，两者观感才一致。
 *   - **素材不在也不报错**：视频缺了就只显示静态立绘，拖动与气泡照常，
 *     页面上不会出现破图。
 */

import { api, assetUrl } from './api.js';
import { store } from './store.js';
import { DRAG_THRESHOLD_PX, IDLE_AFTER_MS, noteClick } from './mascot-rules.js';

// 几条规则（点几次算跺脚、多久进待机……）在 mascot-rules.js 里，
// 那边是纯计算、能在 Node 里直接测；这里只负责把它们用起来。
export { DRAG_THRESHOLD_PX, IDLE_AFTER_MS, STOMP_CLICKS, STOMP_WINDOW_MS, noteClick } from './mascot-rules.js';

/** 静止（定格）用的是 mascot1 那张抠好的成品 */
const STILL_SRC = assetUrl('mascot/mascot.png');

/** 四段动作素材，就是她本来的文件名 */
const ANIM = {
  wave: 'mascot/gif/mascot_wave.mp4',
  stomp: 'mascot/gif/mascot_stomp.mp4',
  struggle: 'mascot/gif/mascot_struggle.mp4',
  idle: 'mascot/gif/mascot_idle.mp4',
};

/** 静止时点一下她说的话（语气跟着箱子走：安静、不催） */
const LINES = [
  '今天也记点什么吧。',
  '写下来，就不怕忘了。',
  '慢慢来，箱子里都收得下。',
  '这一格还空着呢。',
  '歇一会儿也没关系。',
  '我都记着呢。',
];

/** 同一天只提醒一次 */
const REMIND_KEY = 'qsx-mascot-reminded';

// ---------------------------------------------------------------------------
// 运行期状态
// ---------------------------------------------------------------------------

let els = null; // { wrap, body, img, video, bubble }
let state = 'still'; // still | wave | stomp | struggle | idle
let playSeq = 0; // 每次换素材自增：让地址唯一，浏览器才会从头开始
let clickTimes = [];
let drag = null;
let timers = { idle: 0, back: 0, bubble: 0 };
let listenersBound = false;

/** 吉祥物开着没有（默认开） */
export function mascotEnabled() {
  return store.settings?.mascot !== 'false';
}

function later(key, fn, ms) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(fn, ms);
}

function clearTimers() {
  for (const key of Object.keys(timers)) clearTimeout(timers[key]);
  timers = { idle: 0, back: 0, bubble: 0 };
}

/** 说话气泡 */
export function say(text, ms = 2600) {
  if (!els) return;
  els.bubble.textContent = text;
  els.bubble.hidden = false;
  els.bubble.classList.remove('show');
  void els.bubble.offsetWidth; // 重新触发一次进场
  els.bubble.classList.add('show');
  clearTimeout(timers.bubble);
  if (ms > 0) timers.bubble = setTimeout(hideBubble, ms);
}

function hideBubble() {
  if (!els) return;
  els.bubble.classList.remove('show');
  els.bubble.hidden = true;
}

/** 回到静止：定格在 mascot1 那张静态图，并开始 20 秒的待机倒计时 */
function toStill() {
  if (!els) return;
  state = 'still';
  clearTimeout(timers.back);
  els.video.pause();
  els.video.hidden = true;
  els.img.hidden = false;
  scheduleIdle();
}

function scheduleIdle() {
  later(
    'idle',
    () => {
      playAnim('idle', { loop: true });
    },
    IDLE_AFTER_MS,
  );
}

/**
 * 播一段动作。
 * @param {'wave'|'stomp'|'struggle'|'idle'} name
 * @param {{loop?: boolean}} [options]
 */
function playAnim(name, { loop = false } = {}) {
  if (!els) return;
  const video = els.video;
  clearTimeout(timers.idle);
  clearTimeout(timers.back);
  state = name;

  // 同一段素材再播一次：能回开头就回开头，不然就换个地址让它重新加载
  const same = video.dataset.anim === name && video.readyState >= 1;
  if (same) {
    try {
      video.currentTime = 0;
    } catch {
      video.src = `${assetUrl(ANIM[name])}?t=${++playSeq}`;
    }
  } else {
    video.dataset.anim = name;
    video.src = `${assetUrl(ANIM[name])}?t=${++playSeq}`;
  }

  video.loop = loop;
  video.muted = true; // 素材自带音轨，这里必须静音
  els.img.hidden = true;
  video.hidden = false;
  const played = video.play();
  if (played?.catch) {
    // 浏览器不肯自动播（少见）：退回静止，别让她卡在一个黑框上
    played.catch(() => toStill());
  }
  video.addEventListener(
    'error',
    () => {
      // 这一段素材缺失或坏了：退回静止，页面上不留破元素
      if (state === name) toStill();
    },
    { once: true },
  );
}

// ---------------------------------------------------------------------------
// 拖动
// ---------------------------------------------------------------------------

function onPointerDown(e) {
  if (!els || e.button !== 0) return;
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, dx: 0, dy: 0 };
  try {
    els.body.setPointerCapture(e.pointerId);
  } catch {
    /* 个别环境不支持指针捕获，退化成普通事件也能用 */
  }
}

function movePointer(x, y) {
  if (!els || !drag?.moved) return;
  const rect = els.body.getBoundingClientRect();
  const margin = 4;
  const left = Math.min(Math.max(x - drag.dx, margin), window.innerWidth - rect.width - margin);
  const top = Math.min(Math.max(y - drag.dy, margin), window.innerHeight - rect.height - margin);
  els.body.style.left = `${left}px`;
  els.body.style.top = `${top}px`;
}

function onPointerMove(e) {
  if (!els || !drag || e.pointerId !== drag.id) return;

  if (!drag.moved) {
    const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
    if (moved <= DRAG_THRESHOLD_PX) return; // 还没超过阈值：她可能只是想被点一下

    // 真的开始拖了：先量好她的位置与大小，再脱离侧栏
    drag.moved = true;
    clearTimeout(timers.idle);
    const rect = els.body.getBoundingClientRect();
    drag.dx = drag.sx - rect.left;
    drag.dy = drag.sy - rect.top;
    els.body.style.width = `${rect.width}px`;
    els.body.style.height = `${rect.height}px`;
    els.body.style.left = `${rect.left}px`;
    els.body.style.top = `${rect.top}px`;
    els.body.classList.add('is-dragging');
    playAnim('struggle', { loop: true });
  }
  movePointer(e.clientX, e.clientY);
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
    handleClick();
    return;
  }

  // 松手：先记下她当前在哪，再删掉拖动态，于是她瞬间回到侧栏原位——
  // 然后用一段位移把这一跳补成动画（不然会"啪"地闪回去）
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

  toStill();
}

function handleClick() {
  const result = noteClick(clickTimes, Date.now());
  clickTimes = result.recent;
  if (result.stomp) {
    playAnim('stomp');
  } else {
    say(LINES[Math.floor(Math.random() * LINES.length)]); // 单击也要有反馈
    scheduleIdle();
  }
}

// ---------------------------------------------------------------------------
// 挂载 / 卸载
// ---------------------------------------------------------------------------

function bindGlobalEvents() {
  if (listenersBound) return;
  listenersBound = true;
  // 刚发布完一篇：冒一次气泡
  window.addEventListener('duskbox:published', () => {
    if (mascotEnabled()) say('收进箱子里了。');
  });
}

/** 挂到侧栏那块空白里 */
export function mountMascot() {
  bindGlobalEvents();
  if (!mascotEnabled() || els) return;

  const slot = document.getElementById('mascot-slot');
  if (!slot) return; // 侧栏结构变了就安静退出，不报错

  const wrap = document.createElement('div');
  wrap.className = 'mascot';
  wrap.innerHTML = `
    <div class="mascot-bubble" hidden></div>
    <button class="mascot-body" type="button" aria-label="吉祥物：祀">
      <img class="mascot-img" src="${STILL_SRC}" alt="" decoding="async">
      <video class="mascot-video" muted playsinline preload="metadata" hidden></video>
    </button>`;
  slot.appendChild(wrap);

  els = {
    wrap,
    body: wrap.querySelector('.mascot-body'),
    img: wrap.querySelector('.mascot-img'),
    video: wrap.querySelector('.mascot-video'),
    bubble: wrap.querySelector('.mascot-bubble'),
  };
  state = 'still';

  // 静止图不在（素材还没做完 / 文件坏了）：整块收起，绝不留一个破图
  els.img.addEventListener('error', () => unmountMascot(), { once: true });
  // 一段动作播完：回到静止（struggle / idle 是循环的，不会触发 ended）
  els.video.addEventListener('ended', () => {
    if (state === 'wave' || state === 'stomp') toStill();
  });

  els.body.addEventListener('pointerdown', onPointerDown);
  els.body.addEventListener('pointermove', onPointerMove);
  els.body.addEventListener('pointerup', onPointerUp);
  els.body.addEventListener('pointercancel', onPointerUp);
  // 鼠标点击已经在 pointerup 里处理过了，这里只放行键盘触发的 click
  els.body.addEventListener('click', (e) => {
    if (e.detail === 0) handleClick();
    e.preventDefault();
  });
  els.body.addEventListener('pointerenter', () => {
    say(LINES[Math.floor(Math.random() * LINES.length)], 0);
  });
  els.body.addEventListener('pointerleave', hideBubble);
  els.body.addEventListener('focus', () => say('我在呢。', 0));
  els.body.addEventListener('blur', hideBubble);

  // 第一次露面也挥一次手（用户要的），播完自然回到静止并开始待机计时
  playAnim('wave');
  remindOnce();
}

/** 收起来（设置里关掉时调用） */
export function unmountMascot() {
  clearTimers();
  drag = null;
  clickTimes = [];
  if (els) {
    els.video.pause();
    els.wrap.remove();
  }
  els = null;
  state = 'still';
}

/** 设置改变后调用：开的就挂上，关的就收掉 */
export function refreshMascot() {
  if (mascotEnabled()) mountMascot();
  else unmountMascot();
}

/** 每次切换页面：先把她从待机里叫出来，再放一次挥手 */
export function mascotOnRouteChange() {
  if (!els) return;
  playAnim('wave');
}

/** 当前状态（给测试用） */
export function mascotState() {
  return state;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 今天还有没做完的事就提醒一次，同一天只提一次 */
async function remindOnce() {
  let seen = true;
  try {
    seen = localStorage.getItem(REMIND_KEY) === todayKey();
  } catch {
    return; // 隐私模式读不了存储，宁可不打扰
  }
  if (seen) return;

  let home;
  try {
    home = await api.home();
  } catch {
    return;
  }
  try {
    localStorage.setItem(REMIND_KEY, todayKey());
  } catch {
    /* 忽略 */
  }
  const pending = Number(home?.todayPending || 0);
  const projects = Number(home?.projects?.activeCount || 0);
  if (pending > 0) say(`今天还有 ${pending} 项没打勾呢。`, 5200);
  else if (projects > 0) say(`手上还有 ${projects} 件事在推进。`, 5200);
}
