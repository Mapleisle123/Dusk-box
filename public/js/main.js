/**
 * 应用入口：启动、路由分发、服务状态监测。
 */

import { api } from './api.js';
import { store } from './store.js';
import { currentRoute, onRouteChange, startRouter, navigate } from './router.js';
import { esc, icons } from './ui.js';

import { pageHome } from './pages/home.js';
import { pagePosts } from './pages/posts.js';
import { pagePlans } from './pages/plans.js';
import { pageAlbums } from './pages/albums.js';
import { pageSettings } from './pages/settings.js';

const PAGES = {
  home: pageHome,
  posts: pagePosts,
  plans: pagePlans,
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
    console.error('[茜色箱] 页面挂载出错：', err);
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

async function bootstrap() {
  installGlobalHandlers();

  try {
    await store.load();
  } catch (err) {
    document.getElementById('view').innerHTML = `
      <div class="page">
        <div class="empty">
          <div class="empty-mark">${icons.info}</div>
          <div class="empty-title">无法连接到本地服务</div>
          <div class="empty-desc">${esc(err.message)}<br>请确认「茜色箱启动.bat」正在运行。</div>
          <button class="btn btn-primary" data-retry type="button">重试连接</button>
        </div>
      </div>`;
    document.querySelector('[data-retry]')?.addEventListener('click', () => location.reload());
    return;
  }

  onRouteChange(render);
  startRouter();

  pollService();
  setInterval(pollService, 15000);
}

bootstrap();
