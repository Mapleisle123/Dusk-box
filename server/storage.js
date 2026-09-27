/**
 * 存储层：负责把数据库里的数据同步成磁盘上的真实文件。
 *
 * 目录结构（已确认的设计）：
 *   <dataRoot>/
 *     ├── duskbox.db
 *     ├── 发布/<年>/<日期> <标题>.md
 *     ├── 发布/<年>/media/<日期>-<序号>.<ext>
 *     ├── 计划/<计划名>.md
 *     ├── 相册/<相册集名>/_album.json
 *     ├── 相册/<相册集名>/<原文件名>
 *     └── 备份/<日期>/
 *
 * 设计要点：
 *   - 相对路径一律用正斜杠存库，跨平台稳定；解析时再转本地分隔符。
 *   - 所有写文件都是"先写临时文件再改名"的原子写入，避免中途断电留下半截文件。
 *   - 文件名经过净化，去除 Windows 非法字符，保证一定能落盘成功。
 */

import fs from 'node:fs';
import path from 'node:path';

/** Windows / 通用非法文件名字符 */
const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 需要在文件系统中避免保留的名字（Windows 保留设备名） */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * 把任意字符串净化为安全的文件/文件夹名。
 * @param {string} raw 原始名字
 * @param {string} fallback 净化后为空时的兜底名
 * @param {number} maxLen 最大长度（避免超长路径）
 */
export function sanitizeName(raw, fallback = '未命名', maxLen = 80) {
  let name = String(raw ?? '')
    .replace(ILLEGAL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // 去掉结尾的点和空格（Windows 不允许）
  name = name.replace(/[. ]+$/, '').trim();
  if (name.length > maxLen) name = name.slice(0, maxLen).trim();
  if (!name) name = fallback;
  if (RESERVED_NAMES.has(name.toLowerCase())) name = `${name}_`;
  return name;
}

/** 取扩展名（小写，含点） */
export function extOf(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (!ext) return '';
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

/** 允许的图片扩展名 */
export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);

/** 判断是否为允许的图片 */
export function isImageFilename(filename) {
  return IMAGE_EXTS.has(extOf(filename));
}

/** 原子写入：先写 .tmp 再改名 */
function atomicWrite(absPath, data) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, absPath);
}

/** 逐级创建目录 */
function ensureDir(absDir) {
  fs.mkdirSync(absDir, { recursive: true });
  return absDir;
}

/** 在目录下找一个不冲突的文件名 */
function uniqueAbsPath(absDir, baseName, ext) {
  ensureDir(absDir);
  let candidate = path.join(absDir, `${baseName}${ext}`);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(absDir, `${baseName} (${n})${ext}`);
    n += 1;
    if (n > 9999) throw new Error('无法生成唯一文件名');
  }
  return candidate;
}

/**
 * 计算文章文件名主干。
 * 规则：有标题 → "日期 标题"；无标题 → "日期"。同一天多篇由 uniqueAbsPath 追加序号。
 */
export function postFileBaseName(postDate, title) {
  const cleanTitle = sanitizeName(title, '', 60);
  return cleanTitle ? `${postDate} ${cleanTitle}` : `${postDate}`;
}

/** 生成一篇文章的 Markdown 内容 */
export function renderPostMarkdown(post, media = []) {
  const lines = [];
  lines.push(`# ${post.title || '无标题'}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`- 日期：${post.post_date}`);
  lines.push(`- 创建：${post.created_at}`);
  lines.push(`- 更新：${post.updated_at}`);
  if (media.length) {
    lines.push(`- 图片：${media.length} 张`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(post.content || '');
  lines.push('');
  if (media.length) {
    lines.push('<!-- 附图 -->');
    lines.push('');
    for (const m of media) {
      lines.push(`![${m.original_name}](${m.file_path})`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

/** 生成一个计划文件的 Markdown 内容 */
export function renderPlanMarkdown(plan, checkins = []) {
  const modeText = plan.mode === 'quant' ? '量化式（记进度，可超额）' : '确认式（完成打卡）';
  const cycleLabel = { week: '周', month: '月', year: '年' }[plan.cycle_unit] || plan.cycle_unit;
  const lines = [];
  lines.push(`# ${plan.name}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`- 打卡方式：${modeText}`);
  if (plan.mode === 'quant') {
    lines.push(`- 周期目标：${plan.target_value} ${plan.unit || ''}`.trim());
  }
  lines.push(`- 周期长度：每 ${cycleLabel}`);
  lines.push(`- 起始日：${plan.start_date}`);
  lines.push(
    `- 首次起算：${plan.start_mode === 'next_day' ? '创建次日' : '创建当天'}`,
  );
  lines.push(`- 状态：${plan.archived ? '已归档' : '进行中'}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 打卡记录');
  lines.push('');
  if (!checkins.length) {
    lines.push('（暂无记录）');
  } else {
    lines.push('| 日期 | 结果 |');
    lines.push('| --- | --- |');
    for (const c of checkins) {
      const result =
        plan.mode === 'quant'
          ? `${c.value ?? 0} ${plan.unit || ''}`.trim()
          : c.done
            ? '已完成'
            : '未完成';
      lines.push(`| ${c.checkin_date} | ${result} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** 生成相册元信息 JSON */
export function renderAlbumMeta(album, photos = []) {
  return `${JSON.stringify(
    {
      name: album.name,
      createdAt: album.created_at,
      updatedAt: album.updated_at,
      photoCount: photos.length,
      photos: photos.map((p) => ({
        name: p.original_name,
        file: p.file_path,
        addedAt: p.created_at,
      })),
    },
    null,
    2,
  )}\n`;
}

/**
 * 创建存储层。
 * @param {string} dataRoot 数据根目录
 */
export function createStorage(dataRoot) {
  const absRoot = path.resolve(dataRoot);
  const dirs = {
    root: absRoot,
    posts: path.join(absRoot, '发布'),
    plans: path.join(absRoot, '计划'),
    albums: path.join(absRoot, '相册'),
    backups: path.join(absRoot, '备份'),
  };

  /** 相对路径（正斜杠）→ 绝对路径 */
  function absOf(rel) {
    if (!rel) return absRoot;
    const normalized = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
    return path.join(absRoot, ...normalized.split('/'));
  }

  /** 绝对路径 → 相对路径（正斜杠） */
  function relOf(abs) {
    const rel = path.relative(absRoot, abs);
    return rel.split(path.sep).join('/');
  }

  /** 确保分类目录都存在 */
  function ensureDirs() {
    for (const dir of Object.values(dirs)) ensureDir(dir);
    return dirs;
  }

  /**
   * 把 /files/ 后面的 URL 路径解析为绝对路径，并阻止目录穿越。
   */
  function resolveUrlPath(relFromUrl) {
    const decoded = decodeURIComponent(String(relFromUrl || ''));
    const abs = path.resolve(absRoot, decoded);
    if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) return null;
    return abs;
  }

  // ---------- 发布 ----------

  /** 年份目录 */
  function postYearDir(postDate) {
    const year = String(postDate).slice(0, 4);
    return path.join(dirs.posts, year);
  }

  /** 媒体目录 */
  function postMediaDir(postDate) {
    return path.join(postYearDir(postDate), 'media');
  }

  /**
   * 写入文章文件。
   * @returns {string} 相对路径
   */
  function writePostFile(post, media = []) {
    const dir = postYearDir(post.post_date);
    const base = postFileBaseName(post.post_date, post.title);

    // 若文章已有文件且标题/日期未变，原地覆盖；否则新建（避免改动后残留旧文件）
    let abs;
    if (post.file_path) {
      const existing = absOf(post.file_path);
      const existingBase = path.basename(existing, '.md');
      if (existingBase === base) {
        abs = existing;
      } else {
        // 标题变了：写新文件并删除旧文件
        abs = uniqueAbsPath(dir, base, '.md');
        safeUnlink(post.file_path);
      }
    } else {
      abs = uniqueAbsPath(dir, base, '.md');
    }

    atomicWrite(abs, renderPostMarkdown(post, media));
    return relOf(abs);
  }

  /** 安全删除（不存在则忽略，且不允许越出数据目录） */
  function safeUnlink(rel) {
    if (!rel) return false;
    const abs = absOf(rel);
    if (!abs.startsWith(absRoot + path.sep)) return false;
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        fs.unlinkSync(abs);
        return true;
      }
    } catch {
      /* 忽略删除失败，避免影响主流程 */
    }
    return false;
  }

  /**
   * 保存一张媒体图片，按"日期-序号"命名，落在对应年份的 media 目录。
   * @returns {string} 相对路径
   */
  function savePostMedia({ buffer, originalName, postDate, seq }) {
    const dir = postMediaDir(postDate);
    ensureDir(dir);
    const ext = extOf(originalName) || '.png';
    const base = `${postDate}-${String(seq).padStart(2, '0')}`;
    const abs = uniqueAbsPath(dir, base, ext);
    atomicWrite(abs, buffer);
    return relOf(abs);
  }

  // ---------- 计划 ----------

  /** 写入计划文件 */
  function writePlanFile(plan, checkins = []) {
    const base = sanitizeName(plan.name, `计划${plan.id}`, 60);
    let abs;
    if (plan.file_path) {
      const existing = absOf(plan.file_path);
      if (path.basename(existing, '.md') === base) {
        abs = existing;
      } else {
        abs = uniqueAbsPath(dirs.plans, base, '.md');
        safeUnlink(plan.file_path);
      }
    } else {
      abs = uniqueAbsPath(dirs.plans, base, '.md');
    }
    atomicWrite(abs, renderPlanMarkdown(plan, checkins));
    return relOf(abs);
  }

  // ---------- 相册 ----------

  /** 为一个相册集生成不冲突的文件夹名 */
  function albumFolderName(desired) {
    const base = sanitizeName(desired, '相册集', 60);
    let candidate = base;
    let n = 2;
    while (fs.existsSync(path.join(dirs.albums, candidate))) {
      candidate = `${base} (${n})`;
      n += 1;
      if (n > 9999) throw new Error('无法生成唯一相册文件夹名');
    }
    return candidate;
  }

  /** 创建相册文件夹 */
  function createAlbumFolder(desiredName) {
    const folder = albumFolderName(desiredName);
    const abs = path.join(dirs.albums, folder);
    ensureDir(abs);
    return { folder, relPath: relOf(abs) };
  }

  /** 重命名相册文件夹 */
  function renameAlbumFolder(oldFolder, desiredName) {
    const oldAbs = path.join(dirs.albums, oldFolder);
    const base = sanitizeName(desiredName, '相册集', 60);
    if (!fs.existsSync(oldAbs)) {
      // 文件夹不在了（被用户手动删过）：重建
      ensureDir(oldAbs);
    }
    if (oldFolder === base) return { folder: oldFolder, relPath: relOf(oldAbs) };
    const newAbs = uniqueAbsPath(dirs.albums, base, '');
    fs.renameSync(oldAbs, newAbs);
    return { folder: path.basename(newAbs), relPath: relOf(newAbs) };
  }

  /** 删除相册文件夹（含内部图片） */
  function deleteAlbumFolder(folder) {
    const abs = path.join(dirs.albums, folder);
    if (!abs.startsWith(dirs.albums)) return false;
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { recursive: true, force: true });
      return true;
    }
    return false;
  }

  /** 保存相册图片 */
  function saveAlbumPhoto({ buffer, originalName, folder }) {
    const dir = path.join(dirs.albums, folder);
    ensureDir(dir);
    const ext = extOf(originalName) || '.png';
    const base = sanitizeName(path.basename(String(originalName), path.extname(String(originalName))), 'photo', 50);
    const abs = uniqueAbsPath(dir, base, ext);
    atomicWrite(abs, buffer);
    return relOf(abs);
  }

  /** 写入相册元信息 */
  function writeAlbumMeta(album, photos = [], folder) {
    const dir = path.join(dirs.albums, folder);
    ensureDir(dir);
    const abs = path.join(dir, '_album.json');
    atomicWrite(abs, renderAlbumMeta(album, photos));
    return relOf(abs);
  }

  /** 删除单个文件（相对路径） */
  function deleteFile(rel) {
    return safeUnlink(rel);
  }

  /** 文件是否存在 */
  function exists(rel) {
    const abs = absOf(rel);
    return fs.existsSync(abs);
  }

  /** 文件大小 */
  function sizeOf(rel) {
    try {
      return fs.statSync(absOf(rel)).size;
    } catch {
      return 0;
    }
  }

  /** 列出某目录下的文件（相对路径数组） */
  function listFilesIn(relDir) {
    const abs = absOf(relDir);
    if (!fs.existsSync(abs)) return [];
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => relOf(path.join(abs, d.name)));
  }

  ensureDirs();

  return {
    dirs,
    absRoot,
    absOf,
    relOf,
    ensureDirs,
    resolveUrlPath,
    writePostFile,
    savePostMedia,
    writePlanFile,
    createAlbumFolder,
    renameAlbumFolder,
    deleteAlbumFolder,
    saveAlbumPhoto,
    writeAlbumMeta,
    deleteFile,
    exists,
    sizeOf,
    listFilesIn,
    // 供测试与备份使用
    _internal: { atomicWrite, uniqueAbsPath, sanitizeName },
  };
}
