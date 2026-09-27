/**
 * 背景图：把两个来源合成一份列表。
 *
 *   1. **自带的** —— 项目里的 img/background（随应用走；用户往里丢图片也会被列出来）
 *   2. **自定义的** —— 数据目录里的 背景图/（在设置页里添加，图片只落在这台电脑上）
 *
 * 核心约定：**名字就是地址。**
 * 两个来源共用同一个 URL 前缀 /img/background/（URL 由 assets.js 的 backgroundUrl 拼），
 * 设置里存的始终是一个纯文件名。这条约定同时买到三件事：
 *
 *   - 老设置、老备份里存的 'background.jpg' 不需要任何迁移；
 *   - 前端拼地址的写法（assetUrl('background/' + 名字)）一行都不用改；
 *   - 一张图从"自带"变成"自定义"时，它的地址不会变——否则设置里存的名字
 *     会在换来源的那一刻指向一个不存在的地址，页面上表现为"背景突然没了"。
 *
 * 两个来源靠**解析顺序**区分：先看数据目录，再看自带目录。
 * 之所以不会有歧义，是因为存图时会把重名唯一化（与 storage.js 的
 * uniqueAbsPath 同一套 "名字 (2).ext" 做法，只是这里要同时避开两个目录）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { badRequest, notFound, HttpError } from './http.js';
import { IMAGE_EXTS, extOf, sanitizeName } from './storage.js';
import { backgroundDir, backgroundUrl, listBackgrounds } from './assets.js';

/** 数据目录下存放自定义背景图的分类目录 */
export const USER_BACKGROUND_DIRNAME = '背景图';

/** 单张背景图的大小上限：够放 4K 壁纸，又不至于把请求体撑爆 */
export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;

/** 扩展名列表，拼进错误提示里 */
const EXT_HINT = [...IMAGE_EXTS].join(' / ');

/** 自定义背景图目录：<数据目录>/背景图 */
export function userBackgroundDir(dataRoot) {
  return path.join(dataRoot, USER_BACKGROUND_DIRNAME);
}

/**
 * 是不是一个"纯文件名"形式的图片名。
 * 带目录分隔符、上跳、或不是图片扩展名，一律不算。
 */
export function isPlainImageName(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  return IMAGE_EXTS.has(extOf(name));
}

/** 列出一个目录里的图片文件名（目录不存在就当空的，不抛错） */
function listImagesIn(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 自定义背景图列表（用户自己添加的那些） */
export function listUserBackgrounds(dataRoot) {
  return listImagesIn(userBackgroundDir(dataRoot)).map((name) => ({
    name,
    url: backgroundUrl(name),
    source: 'user',
    // 给界面用：只有自己添加的才能删
    user: true,
  }));
}

/**
 * 全部可选背景图：自定义的排在前面（刚加进来的图最可能马上要用），
 * 自带的排在后面。两边各自按名字排序。
 */
export function listAllBackgrounds(dataRoot) {
  const user = listUserBackgrounds(dataRoot);
  const taken = new Set(user.map((i) => i.name));
  const builtin = listBackgrounds()
    // 万一两个目录里出现了同名文件（手工往数据目录里拷的），
    // 自定义的那张在前、这里就跳过，保证一个名字只出现一次
    .filter((i) => !taken.has(i.name))
    .map((i) => ({ ...i, source: 'builtin', user: false }));
  return [...user, ...builtin];
}

/**
 * 按名字找一张背景图。
 * @returns {{name:string, url:string, abs:string, source:'user'|'builtin', user:boolean}|null}
 */
export function findBackground(dataRoot, name) {
  if (!isPlainImageName(name)) return null;

  const candidates = [
    { abs: path.join(userBackgroundDir(dataRoot), name), source: 'user', user: true },
    { abs: path.join(backgroundDir(), name), source: 'builtin', user: false },
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate.abs).isFile()) {
        return {
          name,
          url: backgroundUrl(name),
          abs: candidate.abs,
          source: candidate.source,
          user: candidate.user,
        };
      }
    } catch {
      /* 不存在，继续找下一个来源 */
    }
  }
  return null;
}

/** 校验一个设置值能不能当背景图用（空串表示"不使用"） */
export function isAllowedBackgroundName(dataRoot, name) {
  if (name === '') return true;
  return findBackground(dataRoot, name) !== null;
}

/**
 * 在若干个目录里找一个不冲突的文件名。
 * 规则与 storage.js 的 uniqueAbsPath 一致：重名就追加 " (2)"、" (3)"…
 */
function uniqueNameInDirs(dirs, base, ext) {
  let candidate = `${base}${ext}`;
  let n = 2;
  while (dirs.some((dir) => fs.existsSync(path.join(dir, candidate)))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
    if (n > 9999) throw new HttpError(500, '无法生成唯一的背景图文件名');
  }
  return candidate;
}

/** 原子写入：先写临时文件再改名，避免中途断电留下半截文件 */
function atomicWrite(absPath, data) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, absPath);
}

/**
 * 从上传时的原始文件名里取一个能安全落盘、且之后还解析得出来的名字主干。
 *
 * 两处细节都是必要的：
 *   - sanitizeName 抹掉 Windows 非法字符与结尾的点/空格；
 *   - 再压掉连续的 ".." —— 这个名字接下来要存进设置、拼进 URL，
 *     而 isPlainImageName 把带 ".." 的名字一律判为非法（防路径上跳），
 *     留着的话图存进去了却永远选不中。正常的英文名（my.wallpaper.png）
 *     只受影响一次点压缩，读起来没有变化。
 */
function baseNameOf(rawName) {
  const raw = String(rawName || '');
  const withoutExt = path.basename(raw, path.extname(raw));
  return (
    sanitizeName(withoutExt, '背景图', 60)
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+/, '') || '背景图'
  );
}

/**
 * 添加一张自定义背景图。
 *
 * 图片落在 <数据目录>/背景图/ 下，**不往任何地方上传**——
 * 这一步只是把浏览器选中的文件写给同一个进程里的本地服务。
 *
 * @param {string} dataRoot 数据根目录
 * @param {{buffer:Buffer, originalName:string}} file
 * @returns {{name:string, url:string, size:number, source:'user', user:true, path:string}}
 */
export function saveUserBackground(dataRoot, { buffer, originalName } = {}) {
  if (!buffer || !buffer.length) throw badRequest('没有收到图片内容');

  const rawName = String(originalName || '');
  const ext = extOf(rawName) || '.png';
  if (!IMAGE_EXTS.has(ext)) {
    throw badRequest(`背景图只支持这些格式：${EXT_HINT}（收到的是 ${ext || '无扩展名'}）`);
  }
  if (buffer.length > MAX_BACKGROUND_BYTES) {
    throw new HttpError(
      413,
      `背景图不能超过 ${Math.round(MAX_BACKGROUND_BYTES / 1024 / 1024)}MB`,
    );
  }

  const base = baseNameOf(rawName);
  const dir = userBackgroundDir(dataRoot);
  // 重名要同时避开两个目录：设置里存的是纯文件名，
  // 一旦和自带的图撞名，那张自带的就再也选不到了
  const name = uniqueNameInDirs([dir, backgroundDir()], base, ext);

  atomicWrite(path.join(dir, name), buffer);

  return {
    name,
    url: backgroundUrl(name),
    size: buffer.length,
    source: 'user',
    user: true,
    path: `${USER_BACKGROUND_DIRNAME}/${name}`,
  };
}

/**
 * 删除一张自定义背景图。
 * 只删数据目录里的；项目自带的图不归接口管（那是随应用走的资源）。
 */
export function removeUserBackground(dataRoot, name) {
  if (!isPlainImageName(name)) throw badRequest('背景图名称非法');
  const abs = path.join(userBackgroundDir(dataRoot), name);

  if (!fs.existsSync(abs)) {
    if (fs.existsSync(path.join(backgroundDir(), name))) {
      throw badRequest('这是项目自带的背景图，不能在这里删除');
    }
    throw notFound(`背景图不存在：${name}`);
  }

  fs.unlinkSync(abs);
  return { name };
}

/**
 * 把 /img/ 之后的一段路径解析成磁盘路径——只负责 background/ 这一支。
 *
 * 背景图是唯一有"两级目录"的资源：先自定义、后自带。
 * 其余（logo 之类的自带资源）返回 null，交给调用方按原来的规则处理。
 *
 * @param {string} dataRoot
 * @param {string} relPath /img 之后的部分，形如 '/background/x.jpg'
 * @returns {string|null} 绝对路径；不属于背景图、或名字不合法时返回 null
 */
export function resolveBackgroundAsset(dataRoot, relPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(relPath || ''));
  } catch {
    // 非法转义（比如 %E4%D8）：当作找不到，别让异常冒到请求处理之外
    return null;
  }
  const m = /^\/?background\/([^/\\]+)$/.exec(decoded);
  if (!m) return null;
  const found = findBackground(dataRoot, m[1]);
  return found ? found.abs : null;
}
