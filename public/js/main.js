/**
 * 应用入口：启动、路由分发、服务状态监测。
 */

import { api } from './api.js';
import { store } from './store.js';
import { currentRoute, onRouteChange, startRouter, navigate } from './router.js';
import { esc, icons } from './ui.js';
import { mascotOnRouteChange, mountMascot } from './mascot.js';

import { pageHome } from './pages/home.js';
import { pagePosts } from './pages/posts.js';
import { pagePlans } from './pages/plans.js';
import { pageProjects } from './pages/projects.js';
import { pageAlbums } from './pages/albums.js';
import { pageSettings } from './pages/settings.js';

const PAGES = {
  home: pageHome,
  posts: pagePosts,
  plans: pagePlans,
  projects: pageProjects,
  albums: pageAlbums,
  settings: pageSettings,
};

let renderToken = 0;

/** 渲染一个页面 */
async function render(route) {
  const token = (renderToken += 1);
  const view = document.getElementById('view');
  const page = PAGES[route.name] || PAGES.home;

  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === route.name);
  });

  let result;
  try {
    result = await page({ route });
  } catch (err) {
    if (token !== renderToken) return;
    view.innerHTML = `
      <div class="page">
        <div class="empty">
          <div class="empty-mark">${icons.info}</div>
          <div class="empty-title">页面加载失败</div>
          <div class="empty-desc">${esc(err.message || '未知错误')}</div>
          <button class="btn btn-primary" data-retry type="button">重试</button>
        </div>
      </div>`;
    view.querySelector('[data-retry]')?.addEventListener('click', () => render(route));
    return;
  }

  if (token !== renderToken) return; // 期间已经切换到别的页面
  view.innerHTML = result.html;
  view.scrollTop = 0;
  try {
    result.mount?.(view);
  } catch (err) {
    console.error('[Dusk Box] 页面挂载出错：', err);
  }
}

/** 服务状态指示灯 */
async function pollService() {
  const dot = document.getElementById('service-dot');
  const text = document.getElementById('service-text');
  try {
    const health = await api.health();
    dot?.classList.remove('offline');
    dot?.classList.add('online');
    if (text) text.textContent = '服务运行中';
    return health;
  } catch {
    dot?.classList.remove('online');
    dot?.classList.add('offline');
    if (text) text.textContent = '服务已断开';
    return null;
  }
}

/** 全局点击代理：data-nav 跳转、data-retry 重试 */
function installGlobalHandlers() {
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      e.preventDefault();
      navigate(nav.dataset.nav);
    }
  });
}

/**
 * 页面 logo。
 *
 * 图片来自 img/logo（见 index.html）。这里只管两件事：
 *   - 加载成功 → 给印章打上 has-logo，让底下的印章底纹与三道横线让位；
 *   - 加载失败 → 把图片移除，退回纯 CSS 画的印章。
 *
 * 之所以要写失败分支：logo 是用户自己往目录里放的图，
 * 换名字、删掉、放成损坏文件都是可能的，那时侧栏不该出现一个破图图标。
 */
function setupBrandLogo() {
  const logo = document.querySelector('.brand-logo');
  if (!logo) return;
  const mark = logo.parentElement;

  /** 退回印章：撤掉 has-logo（否则印章已被关掉、会留下空框），再把 <img> 拿掉 */
  const showSeal = () => {
    mark.classList.remove('has-logo');
    logo.remove();
  };

  // 失败处理先挂上，而不是挂在 load 分支里：
  // 图加载成功之后仍然可能失效（换了文件、文件被删），那时也该退回印章。
  logo.addEventListener('error', showSeal, { once: true });

  // 图片可能已经加载完了（命中内存缓存），此时不会再触发 load 事件
  if (logo.complete) {
    if (logo.naturalWidth > 0) mark.classList.add('has-logo');
    else showSeal();
    return;
  }

  logo.addEventListener('load', () => mark.classList.add('has-logo'), { once: true });
}

async function bootstrap() {
  setupBrandLogo();
  installGlobalHandlers();

  try {
    await store.load();
  } catch (err) {
    document.getElementById('view').innerHTML = `
      <div class="page">
        <div class="empty">
          <div class="empty-mark">${icons.info}</div>
          <div class="empty-title">无法连接到本地服务</div>
          <div class="empty-desc">${esc(err.message)}<br>请确认「DuskBox-start.bat」正在运行。</div>
          <button class="btn btn-primary" data-retry type="button">重试连接</button>
        </div>
      </div>`;
    document.querySelector('[data-retry]')?.addEventListener('click', () => location.reload());
    return;
  }

  onRouteChange(render);
  // 每次切页：让她挥一次手（她第一次露面也是靠这个）
  onRouteChange(() => mascotOnRouteChange());
  startRouter();

  pollService();
  setInterval(pollService, 15000);

  // 侧栏里的吉祥物：服务连上了再挂，免得她先冒出来又没数据
  mountMascot();
}

bootstrap();
