/**
 * 相册模块业务逻辑。
 *
 * 一个相册集 = 数据库一条记录 + 磁盘一个文件夹。
 * 一张图片 = 数据库一条记录 + 文件夹内的原文件。
 * 同时维护 _album.json 作为人可读的元信息。
 */

import { nowISO, todayISO } from '../dates.js';
import { badRequest, notFound } from '../http.js';
import { isImageFilename, sanitizeName } from '../storage.js';

function rowToAlbum(row, photoCount = 0) {
  return {
    id: row.id,
    name: row.name,
    folder: row.folder,
    coverPath: row.cover_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photoCount,
  };
}

function rowToPhoto(row) {
  return {
    id: row.id,
    albumId: row.album_id,
    originalName: row.original_name,
    filePath: row.file_path,
    createdAt: row.created_at,
  };
}

function getRow(ctx, id) {
  return ctx.db.prepare('SELECT * FROM albums WHERE id = ?').get(Number(id));
}

function photosOf(ctx, albumId) {
  return ctx.db
    .prepare('SELECT * FROM album_photos WHERE album_id = ? ORDER BY id ASC')
    .all(Number(albumId));
}

/** 重写相册的 _album.json */
function exportMeta(ctx, albumId) {
  const row = getRow(ctx, albumId);
  if (!row) return null;
  const photos = photosOf(ctx, albumId);
  return ctx.storage.writeAlbumMeta(
    { name: row.name, created_at: row.created_at, updated_at: row.updated_at },
    photos.map((p) => ({
      original_name: p.original_name,
      file_path: p.file_path,
      created_at: p.created_at,
    })),
    row.folder,
  );
}

/** 列出全部相册集 */
export function listAlbums(ctx) {
  const rows = ctx.db.prepare('SELECT * FROM albums ORDER BY id DESC').all();
  return rows.map((r) => {
    const count = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM album_photos WHERE album_id = ?')
      .get(r.id).c;
    return rowToAlbum(r, Number(count));
  });
}

/** 读取单个相册集（含图片） */
export function getAlbum(ctx, id) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`相册集不存在（id=${id}）`);
  const photos = photosOf(ctx, id).map(rowToPhoto);
  return { ...rowToAlbum(row, photos.length), photos };
}

/** 新建相册集 */
export function createAlbum(ctx, input = {}) {
  const name = String(input.name ?? '').trim();
  if (!name) throw badRequest('相册集名称不能为空');

  const { folder } = ctx.storage.createAlbumFolder(name);
  const now = nowISO();
  const info = ctx.db
    .prepare(
      `INSERT INTO albums (name, folder, cover_path, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?)`,
    )
    .run(name, folder, now, now);
  const id = Number(info.lastInsertRowid);
  exportMeta(ctx, id);
  return getAlbum(ctx, id);
}

/** 重命名相册集（同时重命名磁盘文件夹） */
export function updateAlbum(ctx, id, patch = {}) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`相册集不存在（id=${id}）`);
  const name = patch.name !== undefined ? String(patch.name).trim() : row.name;
  if (!name) throw badRequest('相册集名称不能为空');

  let folder = row.folder;
  let coverPath = row.cover_path;

  if (name !== row.name) {
    const renamed = ctx.storage.renameAlbumFolder(row.folder, name);
    // 文件夹改名后，图片的相对路径需要整体重写
    if (renamed.folder !== row.folder) {
      const oldPrefix = `相册/${row.folder}/`;
      const newPrefix = `相册/${renamed.folder}/`;
      const photos = photosOf(ctx, id);
      for (const p of photos) {
        const next = p.file_path.startsWith(oldPrefix)
          ? newPrefix + p.file_path.slice(oldPrefix.length)
          : p.file_path;
        ctx.db.prepare('UPDATE album_photos SET file_path = ? WHERE id = ?').run(next, p.id);
      }
      if (coverPath && coverPath.startsWith(oldPrefix)) {
        coverPath = newPrefix + coverPath.slice(oldPrefix.length);
      }
      folder = renamed.folder;
    }
  }

  ctx.db
    .prepare('UPDATE albums SET name = ?, folder = ?, cover_path = ?, updated_at = ? WHERE id = ?')
    .run(name, folder, coverPath, nowISO(), Number(id));

  exportMeta(ctx, id);
  return getAlbum(ctx, id);
}

/** 删除相册集（含文件夹与图片） */
export function deleteAlbum(ctx, id) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`相册集不存在（id=${id}）`);
  ctx.db.prepare('DELETE FROM album_photos WHERE album_id = ?').run(Number(id));
  ctx.db.prepare('DELETE FROM albums WHERE id = ?').run(Number(id));
  ctx.storage.deleteAlbumFolder(row.folder);
  return { ok: true, id: Number(id) };
}

/** 批量添加图片 */
export function addPhotos(ctx, id, files = []) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`相册集不存在（id=${id}）`);
  if (!files.length) throw badRequest('没有收到任何图片');

  const added = [];
  for (const file of files) {
    if (!file || !file.buffer || !file.buffer.length) continue;
    const name = file.originalName || 'photo.png';
    if (!isImageFilename(name)) throw badRequest(`只支持图片文件，收到：${name}`);
    const rel = ctx.storage.saveAlbumPhoto({
      buffer: file.buffer,
      originalName: name,
      folder: row.folder,
    });
    const info = ctx.db
      .prepare(
        `INSERT INTO album_photos (album_id, original_name, file_path, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(Number(id), sanitizeName(name, 'photo', 80), rel, nowISO());
    added.push(Number(info.lastInsertRowid));
  }

  // 首张图片自动作为封面
  if (!row.cover_path) {
    const first = ctx.db.prepare('SELECT file_path FROM album_photos WHERE id = ?').get(added[0]);
    if (first) {
      ctx.db.prepare('UPDATE albums SET cover_path = ? WHERE id = ?').run(first.file_path, Number(id));
    }
  }
  ctx.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(nowISO(), Number(id));
  exportMeta(ctx, id);
  return getAlbum(ctx, id);
}

/** 删除单张图片 */
export function deletePhoto(ctx, albumId, photoId) {
  const photo = ctx.db
    .prepare('SELECT * FROM album_photos WHERE id = ? AND album_id = ?')
    .get(Number(photoId), Number(albumId));
  if (!photo) throw notFound(`图片不存在（id=${photoId}）`);

  ctx.storage.deleteFile(photo.file_path);
  ctx.db.prepare('DELETE FROM album_photos WHERE id = ?').run(Number(photoId));

  // 若删掉的正是封面，重新挑选一张
  const album = getRow(ctx, albumId);
  if (album && album.cover_path === photo.file_path) {
    const next = ctx.db
      .prepare('SELECT file_path FROM album_photos WHERE album_id = ? ORDER BY id ASC LIMIT 1')
      .get(Number(albumId));
    ctx.db
      .prepare('UPDATE albums SET cover_path = ?, updated_at = ? WHERE id = ?')
      .run(next ? next.file_path : null, nowISO(), Number(albumId));
  }
  exportMeta(ctx, albumId);
  return getAlbum(ctx, albumId);
}

/** 把图片设为封面 */
export function setCover(ctx, albumId, photoId) {
  const album = getRow(ctx, albumId);
  if (!album) throw notFound(`相册集不存在（id=${albumId}）`);
  const photo = ctx.db
    .prepare('SELECT * FROM album_photos WHERE id = ? AND album_id = ?')
    .get(Number(photoId), Number(albumId));
  if (!photo) throw notFound(`图片不存在（id=${photoId}）`);
  ctx.db
    .prepare('UPDATE albums SET cover_path = ?, updated_at = ? WHERE id = ?')
    .run(photo.file_path, nowISO(), Number(albumId));
  exportMeta(ctx, albumId);
  return getAlbum(ctx, albumId);
}

/** 最近收藏（供首页使用）：按加入时间倒序取图 */
export function recentPhotos(ctx, limit = 8) {
  const rows = ctx.db
    .prepare(
      `SELECT ph.*, al.name AS album_name
       FROM album_photos ph JOIN albums al ON al.id = ph.album_id
       ORDER BY ph.id DESC LIMIT ?`,
    )
    .all(Math.max(1, Number(limit) || 8));
  return rows.map((r) => ({
    id: r.id,
    albumId: r.album_id,
    albumName: r.album_name,
    originalName: r.original_name,
    filePath: r.file_path,
    createdAt: r.created_at,
  }));
}

/** 相册模块摘要（供首页使用） */
export function summary(ctx, date = todayISO()) {
  const albumCount = ctx.db.prepare('SELECT COUNT(*) AS c FROM albums').get().c;
  const photoCount = ctx.db.prepare('SELECT COUNT(*) AS c FROM album_photos').get().c;
  const monthStart = `${String(date).slice(0, 7)}-01`;
  const monthCount = ctx.db
    .prepare('SELECT COUNT(*) AS c FROM album_photos WHERE created_at >= ?')
    .get(monthStart).c;
  const latest = ctx.db.prepare('SELECT * FROM albums ORDER BY id DESC LIMIT 1').get();
  const latestCount = latest
    ? ctx.db.prepare('SELECT COUNT(*) AS c FROM album_photos WHERE album_id = ?').get(latest.id).c
    : 0;

  return {
    albumCount: Number(albumCount),
    photoCount: Number(photoCount),
    thisMonth: Number(monthCount),
    latest: latest
      ? { id: latest.id, name: latest.name, photoCount: Number(latestCount) }
      : null,
  };
}
