/**
 * 接口客户端。
 *
 * 所有与本地服务的通信都集中在这里，便于统一处理错误与加载状态。
 */

import { startLoading, stopLoading } from './ui.js';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, { json, formData, headers, quiet = false } = {}) {
  if (!quiet) startLoading();
  try {
    const init = { method };
    if (formData) {
      init.body = formData;
    } else if (json !== undefined) {
      init.headers = { 'Content-Type': 'application/json', ...headers };
      init.body = JSON.stringify(json);
    } else if (headers) {
      init.headers = headers;
    }

    let res;
    try {
      res = await fetch(path, init);
    } catch {
      throw new ApiError('无法连接到本地服务，请确认茜色箱已启动。', 0);
    }

    const contentType = res.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await res.json()
      : await res.text();

    if (!res.ok) {
      const message =
        (payload && typeof payload === 'object' && payload.error) || `请求失败（${res.status}）`;
      throw new ApiError(message, res.status, payload?.details);
    }
    return payload;
  } finally {
    if (!quiet) stopLoading();
  }
}

/** 把对象转成查询串（跳过空值） */
function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export const api = {
  raw: request,

  // ---- 基础 ----
  health: () => request('GET', '/api/health', { quiet: true }),

  // ---- 首页 ----
  home: (date) => request('GET', `/api/home${qs({ date })}`),

  // ---- 发布 ----
  listPosts: (params) => request('GET', `/api/posts${qs(params)}`),
  postDates: () => request('GET', '/api/posts/dates'),
  postSummary: (date) => request('GET', `/api/posts/summary${qs({ date })}`),
  getPost: (id) => request('GET', `/api/posts/${id}`),
  createPost: (formData) => request('POST', '/api/posts', { formData }),
  updatePost: (id, formData) => request('PUT', `/api/posts/${id}`, { formData }),
  deletePost: (id) => request('DELETE', `/api/posts/${id}`),

  // ---- 计划 ----
  listPlans: (params) => request('GET', `/api/plans${qs(params)}`),
  getPlan: (id, date) => request('GET', `/api/plans/${id}${qs({ date })}`),
  planHistory: (id, date) => request('GET', `/api/plans/${id}/history${qs({ date })}`),
  planReminder: (date) => request('GET', `/api/plans/reminder${qs({ date })}`),
  createPlan: (body) => request('POST', '/api/plans', { json: body }),
  updatePlan: (id, body) => request('PUT', `/api/plans/${id}`, { json: body }),
  deletePlan: (id) => request('DELETE', `/api/plans/${id}`),
  checkin: (id, body) => request('POST', `/api/plans/${id}/checkin`, { json: body }),
  uncheckin: (id, date) => request('DELETE', `/api/plans/${id}/checkin${qs({ date })}`),
  archivePlan: (id, archived) =>
    request('POST', `/api/plans/${id}/archive`, { json: { archived } }),

  // ---- 相册 ----
  listAlbums: () => request('GET', '/api/albums'),
  getAlbum: (id) => request('GET', `/api/albums/${id}`),
  createAlbum: (body) => request('POST', '/api/albums', { json: body }),
  updateAlbum: (id, body) => request('PUT', `/api/albums/${id}`, { json: body }),
  deleteAlbum: (id) => request('DELETE', `/api/albums/${id}`),
  uploadPhotos: (id, formData) => request('POST', `/api/albums/${id}/photos`, { formData }),
  deletePhoto: (albumId, photoId) =>
    request('DELETE', `/api/albums/${albumId}/photos/${photoId}`),
  setCover: (albumId, photoId) =>
    request('PUT', `/api/albums/${albumId}/cover`, { json: { photoId } }),
  recentPhotos: (limit) => request('GET', `/api/albums/recent${qs({ limit })}`),
  albumSummary: (date) => request('GET', `/api/albums/summary${qs({ date })}`),

  // ---- 设置 ----
  getSettings: () => request('GET', '/api/settings'),
  updateSettings: (body) => request('PUT', '/api/settings', { json: body }),
  changeDataRoot: (body) => request('PUT', '/api/settings/data-root', { json: body }),

  // ---- 开机自启 ----
  getAutostart: () => request('GET', '/api/autostart'),
  setAutostart: (enabled) => request('PUT', '/api/autostart', { json: { enabled } }),

  // ---- 桌面启动器 ----
  getDesktop: () => request('GET', '/api/desktop'),
  setDesktop: (enabled) => request('PUT', '/api/desktop', { json: { enabled } }),

  /**
   * 停止本地服务。
   * 必须带上这个自定义请求头：服务端靠它区分"我们自己人"和"浏览器里别的网页"。
   */
  shutdown: () =>
    request('POST', '/api/shutdown', {
      json: {},
      headers: { 'X-Duskbox-Action': 'shutdown' },
    }),

  // ---- 背景图 ----
  listBackgrounds: () => request('GET', '/api/backgrounds'),
  // 图片走 multipart 交给本地服务落盘（存在数据目录里，不上传到任何地方）
  uploadBackground: (formData) => request('POST', '/api/backgrounds', { formData }),
  deleteBackground: (name) => request('DELETE', `/api/backgrounds/${encodeURIComponent(name)}`),

  // ---- 备份 ----
  listBackups: () => request('GET', '/api/backups'),
  createBackup: (reason) => request('POST', '/api/backups', { json: { reason } }),
  restoreBackup: (name) => request('POST', '/api/backups/restore', { json: { name } }),
  deleteBackup: (name) => request('DELETE', `/api/backups/${encodeURIComponent(name)}`),
};

/** 把数据目录中的文件路径转成可访问的 URL */
export function fileUrl(relPath) {
  if (!relPath) return '';
  return `/files/${String(relPath)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`;
}

/**
 * 项目自带资源（img/ 目录）的 URL。
 * logo、背景图这类随应用走的图片走这里，与用户数据（/files/）区分开。
 */
export function assetUrl(relPath) {
  if (!relPath) return '';
  return `/img/${String(relPath)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`;
}
