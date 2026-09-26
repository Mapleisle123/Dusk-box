/**
 * 路由。
 *
 * 使用 hash 路由（#/posts 这种），好处是刷新页面不会 404，
 * 也不需要服务端配合重写。
 */

const listeners = new Set();

/** 当前路由：{ name, params } */
export function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const [name, ...params] = raw.split('/').filter(Boolean);
  return { name: name || 'home', params };
}

/** 跳转 */
export function navigate(path) {
  const next = `#/${String(path).replace(/^#?\/?/, '')}`;
  if (location.hash === next) {
    // 同一个地址：直接重渲染，避免"点了没反应"
    emit();
    return;
  }
  location.hash = next;
}

/** 重新渲染当前页 */
export function refresh() {
  emit();
}

/** 订阅路由变化 */
export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const route = currentRoute();
  for (const fn of listeners) fn(route);
}

/** 开始监听 */
export function startRouter() {
  window.addEventListener('hashchange', emit);
  emit();
}
