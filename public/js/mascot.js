/**
 * Q 版吉祥物「祀」。
 *
 * 形象参考《明日方舟：终末地》的角色「祀」（绿发、蓝眼、金色龙角、
 * 白裙配黑色上衣，身边常有墨魉蝴蝶），由 AI 生成的**原创 Q 版演绎**，
 * 不是官方素材。图放在 img/mascot/，换一张就是换形象。
 *
 * 三条自我约束：
 *   1. **不许挡住任何能点的东西**——它贴在右边缘、落在视口下半部，
 *      容器本身不吃鼠标事件，只有角色本体响应点击与悬停；
 *   2. **不打扰**——气泡只在点击、或者"今天确实有待办 / 刚发布了内容"时冒一次，
 *      同一件事同一天只提一次（记在 localStorage 里）；
 *   3. **可以关掉**——设置页拨一下开关就彻底消失，不用刷新。
 */

import { api, assetUrl } from './api.js';
import { store } from './store.js';

/**
 * 形象文件。
 * 现在入库的是一张占位图（等正式立绘生成好，覆盖同一个文件名即可，代码不用动）。
 */
const MASCOT_SRC = 'mascot/mascot.png';

/** 点击时说的一句（语气跟箱子的调性走：安静、不催、不说教） */
const LINES = [
  '今天也记点什么吧。',
  '写下来，就不怕忘了。',
  '慢慢来，箱子里都收得下。',
  '这一格还空着呢。',
  '歇一会儿也没关系。',
  '我都记着呢。',
];

/** 同一天只提醒一次，键名放到 localStorage 里 */
const REMIND_KEY = 'qsx-mascot-reminded';

let container = null;
let bubbleTimer = null;
let listenersBound = false;

/** 吉祥物开没开（默认开） */
export function mascotEnabled() {
  return store.settings?.mascot !== 'false';
}

/** 冒一个气泡 */
export function say(text, ms = 4200) {
  if (!container) return;
  const bubble = container.querySelector('.mascot-bubble');
  if (!bubble) return;
  bubble.textContent = text;
  bubble.hidden = false;
  // 重新触发一次进场动画（连续点两次也能看到反馈）
  bubble.classList.remove('show');
  void bubble.offsetWidth;
  bubble.classList.add('show');

  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubble.classList.remove('show');
    bubble.hidden = true;
  }, ms);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function alreadyRemindedToday() {
  try {
    return localStorage.getItem(REMIND_KEY) === todayKey();
  } catch {
    return true; // 隐私模式读不到就当已经提醒过，宁可不打扰
  }
}

function markReminded() {
  try {
    localStorage.setItem(REMIND_KEY, todayKey());
  } catch {
    /* 忽略 */
  }
}

/**
 * 进来的第一次：今天还有没做完的事就冒一次气泡，只说一句。
 * 数据来自首页聚合接口——与首页看到的是同一份，不会各说各话。
 */
async function remindOnce() {
  if (alreadyRemindedToday()) return;
  let home;
  try {
    home = await api.home();
  } catch {
    return; // 服务不在就不打扰
  }
  const pending = Number(home?.todayPending || 0);
  const projects = Number(home?.projects?.activeCount || 0);
  markReminded();
  if (pending > 0) {
    say(`今天还有 ${pending} 项没打勾呢。`, 5200);
  } else if (projects > 0) {
    say(`手上还有 ${projects} 件事在推进。`, 5200);
  }
}

function bindGlobalEvents() {
  if (listenersBound) return;
  listenersBound = true;

  // 刚发布完一篇：冒一次气泡（发布页在成功后派发这个事件）
  window.addEventListener('duskbox:published', () => {
    if (mascotEnabled()) say('收进箱子里了。');
  });
}

/** 建出来挂到页面上 */
export function mountMascot() {
  bindGlobalEvents();
  if (!mascotEnabled() || container) return;

  container = document.createElement('div');
  container.className = 'mascot';
  container.innerHTML = `
    <div class="mascot-bubble" hidden></div>
    <button class="mascot-body" type="button" aria-label="吉祥物：祀">
      <img class="mascot-img" src="${assetUrl(MASCOT_SRC)}" alt="" decoding="async">
    </button>`;
  document.body.appendChild(container);

  const img = container.querySelector('.mascot-img');
  // 图不在（还没放正式立绘、或文件坏了）：整个收起，绝不留下一个破图图标
  img.addEventListener('error', () => unmountMascot(), { once: true });

  container.querySelector('.mascot-body').addEventListener('click', () => {
    say(LINES[Math.floor(Math.random() * LINES.length)]);
  });

  remindOnce();
}

/** 收起来（关掉开关时调用） */
export function unmountMascot() {
  if (!container) return;
  container.remove();
  container = null;
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
}

/** 设置改变后调用：开的就挂上，关的就收掉 */
export function refreshMascot() {
  if (mascotEnabled()) mountMascot();
  else unmountMascot();
}
