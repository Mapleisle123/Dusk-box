/**
 * 项目自带资源（img/ 目录）。
 *
 * 这里的东西不是"用户数据"，而是随应用一起走的静态资源：
 *   img/background —— 页面背景图（用户自己往里放图片即可，默认已放一张）
 *   img/logo       —— 页面 logo
 *
 * 它们通过 /img/* 对外提供（见 http.js 的 assetDir 处理）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';

/** 资源根目录 */
export const ASSET_DIR = path.join(PROJECT_ROOT, 'img');

/**
 * 背景图目录。
 *
 * 默认是项目里的 img/background；测试可用 QSX_BACKGROUND_DIR 重定向到临时目录，
 * 这样测试往返读写图片时**不会动到用户真实放进来的图**
 * （与开机自启测试的 QSX_STARTUP_DIR 是同一套做法）。
 * 每次调用都重新读环境变量，方便同一个进程里临时切换。
 */
export function backgroundDir() {
  const override = process.env.QSX_BACKGROUND_DIR;
  if (override && override.trim()) return override;
  return path.join(ASSET_DIR, 'background');
}

/** 允许的图片扩展名（与 http.js 的 MIME 表对应） */
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);

/** 默认背景图：用户已在 img/background 里放了这一张 */
export const DEFAULT_BACKGROUND = 'background.jpg';

/** 背景图在 URL 上的前缀 */
export const BACKGROUND_URL_PREFIX = '/img/background/';

/** 把文件名转成可直接用于 CSS 的 URL */
export function backgroundUrl(name) {
  return BACKGROUND_URL_PREFIX + encodeURIComponent(name);
}

/**
 * 列出可选背景图。
 * 目录不存在时返回空数组——不该因为没有背景图就报错。
 */
export function listBackgrounds() {
  let entries = [];
  try {
    entries = fs.readdirSync(backgroundDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((name) => ({ name, url: backgroundUrl(name) }));
}

/**
 * 校验背景图设置是否可用。
 *
 * 只接受「img/background 目录下的纯文件名」：
 * 带路径分隔符、上跳、非图片扩展名、或文件不存在，一律拒绝。
 * 空字符串表示"不使用背景图"，是合法的。
 */
export function isAllowedBackground(name) {
  if (name === '') return true;
  if (typeof name !== 'string') return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  if (!IMAGE_EXTS.has(path.extname(name).toLowerCase())) return false;
  return fs.existsSync(path.join(backgroundDir(), name));
}
