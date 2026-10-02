/**
 * 备份与恢复。
 *
 * 设计：
 *   - 备份 = 数据库快照 + 分类数据文件，整体放进 <dataRoot>/备份/<时间戳>/
 *   - 备份优先使用 SQLite 官方 backup API（在线热备，保证一致性）；
 *     若该 API 不可用，退化为 WAL checkpoint + 文件复制。
 *   - 恢复后需要重新打开数据库句柄，因此调用 ctx.reload()。
 *   - 定时备份由 setInterval 每分钟检查一次，避免依赖外部计划任务。
 */

import fs from 'node:fs';
import path from 'node:path';
import { backup as sqliteBackup } from 'node:sqlite';
import { nowISO } from './dates.js';
import { getAllSettings, setSetting } from './db.js';
import { badRequest, notFound } from './http.js';
import { USER_BACKGROUND_DIRNAME } from './backgrounds.js';
import { DB_FILENAME, LEGACY_DB_FILENAME, APP_NAME } from './constants.js';

/**
 * 需要纳入备份的分类目录名。
 *
 * 自定义背景图也算用户数据，必须一起备份：
 * 少了它，恢复之后设置里那个文件名会指向一张不存在的图——
 * 页面上表现为"背景突然变空白"，而且用户自己很难联想到是恢复造成的。
 */
const DATA_DIRS = ['发布', '计划', '项目', '相册', USER_BACKGROUND_DIRNAME];

/**
 * 在备份目录里找数据库文件，找不到返回 null。
 *
 * 为什么要兼容两个名字：2026-09-27 之前生成的备份里叫 LEGACY_DB_FILENAME，
 * 之后叫 DB_FILENAME。只认新名的话，用户所有的旧备份会瞬间变成"缺少数据库文件，无法恢复"。
 */
function findBackupDb(dir) {
  for (const name of [DB_FILENAME, LEGACY_DB_FILENAME]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** 时间戳：2026-09-24_233000 */
export function backupStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** 把源目录复制到目标目录（存在则覆盖合并） */
function copyDirSafe(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirSafe(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      count += 1;
    }
  }
  return count;
}

/** 统计目录内文件数与总字节 */
function dirStats(dir) {
  let files = 0;
  let bytes = 0;
  if (!fs.existsSync(dir)) return { files, bytes };
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) {
        files += 1;
        try {
          bytes += fs.statSync(p).size;
        } catch {
          /* 忽略 */
        }
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

/**
 * 执行一次备份。
 * @returns {Promise<{name:string, dir:string, relDir:string, dbBytes:number, fileCount:number}>}
 */
export async function createBackup(ctx, { date = new Date(), reason = 'manual' } = {}) {
  const stamp = backupStamp(date);
  const backupsRoot = ctx.storage.dirs.backups;
  fs.mkdirSync(backupsRoot, { recursive: true });

  // 同名时间戳（同一秒内重复备份）时追加序号，避免互相覆盖
  let name = stamp;
  let n = 2;
  while (fs.existsSync(path.join(backupsRoot, name))) {
    name = `${stamp}-${n}`;
    n += 1;
  }
  const target = path.join(backupsRoot, name);
  fs.mkdirSync(target, { recursive: true });

  // 1. 数据库
  const dbTarget = path.join(target, DB_FILENAME);
  let dbBytes = 0;
  try {
    ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    /* checkpoint 失败不阻断，backup API 本身即可保证一致性 */
  }
  try {
    await sqliteBackup(ctx.db, dbTarget);
    dbBytes = fs.statSync(dbTarget).size;
  } catch {
    // 退化路径：直接复制主库文件
    fs.copyFileSync(ctx.dbPath, dbTarget);
    dbBytes = fs.statSync(dbTarget).size;
  }

  // 2. 分类数据文件
  let fileCount = 0;
  for (const dirName of DATA_DIRS) {
    const src = path.join(ctx.dataRoot, dirName);
    const dest = path.join(target, dirName);
    fileCount += copyDirSafe(src, dest);
  }

  // 3. 清单
  const manifest = {
    name,
    reason,
    createdAt: nowISO(date),
    dataRoot: ctx.dataRoot,
    dbBytes,
    fileCount,
    app: APP_NAME,
  };
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  setSetting(ctx.db, 'lastBackupAt', manifest.createdAt);
  pruneBackups(ctx);

  return { ...manifest, dir: target, relDir: `${path.basename(backupsRoot)}/${name}` };
}

/** 列出全部备份（新到旧） */
export function listBackups(ctx) {
  const root = ctx.storage.dirs.backups;
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(root, d.name);
      let manifest = {};
      const mf = path.join(dir, 'manifest.json');
      if (fs.existsSync(mf)) {
        try {
          manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
        } catch {
          manifest = {};
        }
      }
      const stats = dirStats(dir);
      return {
        name: d.name,
        dir,
        createdAt: manifest.createdAt || d.name,
        reason: manifest.reason || 'unknown',
        dbBytes: manifest.dbBytes ?? 0,
        fileCount: stats.files,
        totalBytes: stats.bytes,
        hasDb: !!findBackupDb(dir),
      };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** 按保留份数清理旧备份 */
export function pruneBackups(ctx) {
  const settings = getAllSettings(ctx.db);
  const keep = Math.max(1, Number(settings.backupKeep) || 30);
  const all = listBackups(ctx);
  const removed = [];
  for (const item of all.slice(keep)) {
    fs.rmSync(item.dir, { recursive: true, force: true });
    removed.push(item.name);
  }
  return removed;
}

/**
 * 从备份恢复。
 * 恢复完成后数据库句柄会失效，调用 ctx.reload() 重新打开。
 */
export function restoreBackup(ctx, name) {
  const root = ctx.storage.dirs.backups;
  // 阻止目录穿越
  const safeName = String(name || '').replace(/[\\/]/g, '');
  const dir = path.join(root, safeName);
  if (!dir.startsWith(root)) throw badRequest('备份名称非法');
  if (!fs.existsSync(dir)) throw notFound(`备份不存在：${safeName}`);

  const dbSource = findBackupDb(dir);
  if (!dbSource) throw badRequest('该备份中缺少数据库文件，无法恢复');

  // Windows 上数据库文件被占用时无法覆盖，必须先关闭句柄
  const wasOpen = !!ctx.db;
  if (wasOpen && typeof ctx.closeDb === 'function') ctx.closeDb();

  try {
    // 1. 移除 WAL/SHM，避免旧日志覆盖刚恢复的数据
    for (const suffix of ['-wal', '-shm']) {
      const p = `${ctx.dbPath}${suffix}`;
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    }
    fs.copyFileSync(dbSource, ctx.dbPath);

    // 2. 恢复分类数据文件（先清空再复制，保证与备份完全一致）
    for (const dirName of DATA_DIRS) {
      const src = path.join(dir, dirName);
      const dest = path.join(ctx.dataRoot, dirName);
      if (!fs.existsSync(src)) continue;
      fs.rmSync(dest, { recursive: true, force: true });
      copyDirSafe(src, dest);
    }
  } finally {
    // 3. 无论如何都要把数据库重新打开，避免服务处于不可用状态
    if (wasOpen && typeof ctx.openDb === 'function') ctx.openDb();
  }

  return {
    ok: true,
    restoredFrom: safeName,
    restoredAt: nowISO(),
    dataRoot: ctx.dataRoot,
  };
}

/** 把 Date 格式化为本地 YYYY-MM-DD */
function localDateISO(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 判断此刻是否该执行自动备份，若该执行则执行一次。
 *
 * 单独抽出来是为了可测试——定时器本身很难测，但"该不该跑"这个决策可以。
 *
 * @returns {Promise<object|null>} 执行了返回备份结果，跳过则返回 null
 */
export async function maybeRunScheduledBackup(ctx, now = new Date()) {
  const settings = getAllSettings(ctx.db);
  if (settings.backupEnabled !== 'true') return null;

  const pad = (n) => String(n).padStart(2, '0');
  const current = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (current !== settings.backupTime) return null;

  // 今天已经备份过就不再重复
  if ((settings.lastBackupAt || '').startsWith(localDateISO(now))) return null;

  return createBackup(ctx, { date: now, reason: 'auto' });
}

/**
 * 启动定时备份调度。
 * 每分钟检查一次：到达设定时间且今天还没备份过，就自动备份。
 * @returns {() => void} 停止函数
 */
export function startScheduler(ctx, { intervalMs = 60_000 } = {}) {
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await maybeRunScheduledBackup(ctx, new Date());
      if (result) console.log(`[Dusk Box] 已完成自动备份：${result.name}`);
    } catch (err) {
      console.error('[Dusk Box] 自动备份失败：', err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  // 不因定时器而阻止进程退出（测试时尤其重要）
  if (typeof timer.unref === 'function') timer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
