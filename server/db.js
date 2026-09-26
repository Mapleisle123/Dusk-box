/**
 * 数据库层：建表、迁移、设置读写。
 *
 * 使用 Node 内置的 node:sqlite（无第三方依赖）。
 * 主存储为单个 .db 文件，保证读写速度与事务一致性。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** 当前 schema 版本，后续结构变更时递增并追加迁移步骤 */
export const SCHEMA_VERSION = 1;

/** 建表语句（幂等，可重复执行） */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL DEFAULT '',
  content     TEXT    NOT NULL DEFAULT '',
  post_date   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  file_path   TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_posts_date   ON posts(post_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts(deleted);

CREATE TABLE IF NOT EXISTS post_media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id       INTEGER NOT NULL,
  kind          TEXT    NOT NULL DEFAULT 'image',
  original_name TEXT    NOT NULL,
  file_path     TEXT    NOT NULL,
  seq           INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id, seq);

CREATE TABLE IF NOT EXISTS plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  mode         TEXT    NOT NULL,
  target_value REAL,
  unit         TEXT,
  cycle_unit   TEXT    NOT NULL,
  start_date   TEXT    NOT NULL,
  start_mode   TEXT    NOT NULL DEFAULT 'same_day',
  archived     INTEGER NOT NULL DEFAULT 0,
  file_path    TEXT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_archived ON plans(archived);

CREATE TABLE IF NOT EXISTS plan_checkins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id       INTEGER NOT NULL,
  checkin_date  TEXT    NOT NULL,
  done          INTEGER NOT NULL DEFAULT 1,
  value         REAL,
  note          TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_unique ON plan_checkins(plan_id, checkin_date);
CREATE INDEX IF NOT EXISTS idx_checkin_plan_date ON plan_checkins(plan_id, checkin_date DESC);

CREATE TABLE IF NOT EXISTS albums (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  folder     TEXT    NOT NULL UNIQUE,
  cover_path TEXT,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS album_photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id      INTEGER NOT NULL,
  original_name TEXT    NOT NULL,
  file_path     TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_album_photos_album ON album_photos(album_id, id DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

/** 设置项的默认值 */
export const DEFAULT_SETTINGS = {
  theme: 'akane',
  colorMode: 'light',
  // 外观风格：liquid（简约·液态玻璃）/ brutal（新粗野主义）。
  // 与 theme、colorMode 是三个相互独立的维度，可以任意组合。
  style: 'liquid',
  backupEnabled: 'true',
  backupTime: '23:30',
  backupKeep: '30',
  backupDirName: '备份',
  // 页面背景图：img/background 目录下的文件名，空字符串表示不使用背景图
  backgroundImage: 'background.jpg',
  // 注意：开机自启不在这里。它的真实状态是「启动」文件夹里的快捷方式，
  // 见 server/autostart.js 与 GET /api/autostart。
  autoStart: 'false',
  lastBackupAt: '',
};

/**
 * 打开数据库并完成建表。
 * @param {string} dbPath .db 文件路径
 */
export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  // WAL 模式提升并发读写表现；外键约束保证级联删除正确
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);

  // 记录 schema 版本
  const current = getMeta(db, 'schema_version');
  if (current === null) {
    setMeta(db, 'schema_version', String(SCHEMA_VERSION));
  }

  // 播种默认设置（已存在的键不覆盖）
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)').run(key, value);
  }

  return db;
}

/** 读取 meta */
export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

/** 写入 meta */
export function setMeta(db, key, value) {
  db.prepare(
    'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

/** 读取单个设置项 */
export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key) ? DEFAULT_SETTINGS[key] : null;
}

/** 读取全部设置项（合并默认值） */
export function getAllSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** 写入设置项 */
export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value === null || value === undefined ? '' : String(value));
  return getSetting(db, key);
}

/** 批量写入设置项 */
export function setSettings(db, patch) {
  for (const [key, value] of Object.entries(patch)) {
    setSetting(db, key, value);
  }
  return getAllSettings(db);
}
