/**
 * 发布模块业务逻辑。
 *
 * 一篇文章 = 数据库一条记录 + 磁盘一个 .md 文件。
 * 图片 = 数据库一条记录 + 磁盘 media 目录一个原文件。
 */

import { todayISO, nowISO, isValidISODate } from '../dates.js';
import { badRequest, notFound } from '../http.js';
import { isImageFilename, sanitizeName } from '../storage.js';

/** 数据库行 → 对外对象 */
function rowToPost(row, media = []) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    postDate: row.post_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    filePath: row.file_path,
    media: media.map((m) => ({
      id: m.id,
      kind: m.kind,
      originalName: m.original_name,
      filePath: m.file_path,
      seq: m.seq,
    })),
    mediaCount: media.length,
    excerpt: buildExcerpt(row.content),
  };
}

/** 提取摘要用于时间线卡片 */
export function buildExcerpt(content, maxLen = 60) {
  const flat = String(content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 去掉图片语法
    .replace(/[#>*`_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > maxLen ? `${flat.slice(0, maxLen)}…` : flat;
}

/** 读取文章的全部媒体 */
function mediaOf(ctx, postId) {
  return ctx.db
    .prepare('SELECT * FROM post_media WHERE post_id = ? ORDER BY seq ASC, id ASC')
    .all(Number(postId));
}

/** 读取单条 */
function getRow(ctx, id) {
  return ctx.db.prepare('SELECT * FROM posts WHERE id = ? AND deleted = 0').get(Number(id));
}

/** 重建该文章的磁盘文件 */
function exportFile(ctx, postId) {
  const row = getRow(ctx, postId);
  if (!row) return null;
  const media = mediaOf(ctx, postId);
  const rel = ctx.storage.writePostFile(
    {
      title: row.title,
      content: row.content,
      post_date: row.post_date,
      created_at: row.created_at,
      updated_at: row.updated_at,
      file_path: row.file_path,
    },
    media.map((m) => ({ original_name: m.original_name, file_path: m.file_path })),
  );
  ctx.db.prepare('UPDATE posts SET file_path = ? WHERE id = ?').run(rel, Number(postId));
  return rel;
}

/**
 * 创建文章。
 * @param {object} input { title, content, postDate }
 * @param {Array} files 上传的图片 [{ buffer, originalName }]
 */
export function createPost(ctx, input = {}, files = []) {
  const title = String(input.title ?? '').trim();
  const content = String(input.content ?? '');
  if (!title && !content.trim()) throw badRequest('标题和正文不能同时为空');

  let postDate = input.postDate ? String(input.postDate) : todayISO();
  if (!isValidISODate(postDate)) throw badRequest(`日期格式非法：${postDate}`);

  const now = nowISO();
  const info = ctx.db
    .prepare(
      `INSERT INTO posts (title, content, post_date, created_at, updated_at, file_path, deleted)
       VALUES (?, ?, ?, ?, ?, NULL, 0)`,
    )
    .run(title, content, postDate, now, now);
  const postId = Number(info.lastInsertRowid);

  attachMedia(ctx, postId, files, postDate);

  exportFile(ctx, postId);
  return getPost(ctx, postId);
}

/** 把上传的图片写入磁盘并登记 */
function attachMedia(ctx, postId, files, postDate) {
  const existing = mediaOf(ctx, postId);
  let seq = existing.length;
  const inserted = [];
  for (const file of files || []) {
    if (!file || !file.buffer || !file.buffer.length) continue;
    const name = file.originalName || 'image.png';
    if (!isImageFilename(name)) {
      throw badRequest(`只支持图片文件，收到：${name}`);
    }
    seq += 1;
    const rel = ctx.storage.savePostMedia({
      buffer: file.buffer,
      originalName: name,
      postDate,
      seq,
    });
    const info = ctx.db
      .prepare(
        `INSERT INTO post_media (post_id, kind, original_name, file_path, seq, created_at)
         VALUES (?, 'image', ?, ?, ?, ?)`,
      )
      .run(Number(postId), sanitizeName(name, 'image', 80), rel, seq, nowISO());
    inserted.push(Number(info.lastInsertRowid));
  }
  return inserted;
}

/** 读取文章详情 */
export function getPost(ctx, id) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`文章不存在（id=${id}）`);
  return rowToPost(row, mediaOf(ctx, id));
}

/**
 * 列出文章（时间线）。
 * @param {object} opts { q, type, from, to, limit, offset }
 */
export function listPosts(ctx, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const where = ['p.deleted = 0'];
  const args = [];

  if (opts.q) {
    where.push('(p.title LIKE ? OR p.content LIKE ?)');
    const like = `%${String(opts.q)}%`;
    args.push(like, like);
  }
  if (opts.from) {
    if (!isValidISODate(opts.from)) throw badRequest('起始日期格式非法');
    where.push('p.post_date >= ?');
    args.push(opts.from);
  }
  if (opts.to) {
    if (!isValidISODate(opts.to)) throw badRequest('结束日期格式非法');
    where.push('p.post_date <= ?');
    args.push(opts.to);
  }
  if (opts.type === 'text') {
    where.push('(SELECT COUNT(*) FROM post_media m WHERE m.post_id = p.id) = 0');
  } else if (opts.type === 'image') {
    where.push('(SELECT COUNT(*) FROM post_media m WHERE m.post_id = p.id) > 0');
  }

  const whereSql = where.join(' AND ');
  const total = ctx.db.prepare(`SELECT COUNT(*) AS c FROM posts p WHERE ${whereSql}`).get(...args).c;
  const rows = ctx.db
    .prepare(
      `SELECT * FROM posts p WHERE ${whereSql}
       ORDER BY p.post_date DESC, p.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset);

  return {
    total,
    limit,
    offset,
    items: rows.map((r) => rowToPost(r, mediaOf(ctx, r.id))),
  };
}

/** 按日期列出有内容的日期（用于日历/按日期跳转） */
export function listDates(ctx) {
  const rows = ctx.db
    .prepare(
      `SELECT post_date AS date, COUNT(*) AS count FROM posts WHERE deleted = 0 GROUP BY post_date ORDER BY post_date DESC`,
    )
    .all();
  return rows.map((r) => ({ date: r.date, count: Number(r.count) }));
}

/**
 * 更新文章。
 * @param {object} patch { title, content, postDate, keepMediaIds }
 * @param {Array} files 新增图片
 */
export function updatePost(ctx, id, patch = {}, files = []) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`文章不存在（id=${id}）`);

  const title = patch.title !== undefined ? String(patch.title).trim() : row.title;
  const content = patch.content !== undefined ? String(patch.content) : row.content;
  if (!title && !content.trim()) throw badRequest('标题和正文不能同时为空');

  let postDate = patch.postDate !== undefined ? String(patch.postDate) : row.post_date;
  if (!isValidISODate(postDate)) throw badRequest(`日期格式非法：${postDate}`);

  // 处理媒体保留列表：不在列表中的图片会被删除
  if (Array.isArray(patch.keepMediaIds)) {
    const keep = new Set(patch.keepMediaIds.map(Number));
    for (const m of mediaOf(ctx, id)) {
      if (!keep.has(m.id)) {
        ctx.storage.deleteFile(m.file_path);
        ctx.db.prepare('DELETE FROM post_media WHERE id = ?').run(m.id);
      }
    }
  }

  ctx.db
    .prepare('UPDATE posts SET title=?, content=?, post_date=?, updated_at=? WHERE id=?')
    .run(title, content, postDate, nowISO(), Number(id));

  attachMedia(ctx, id, files, postDate);
  exportFile(ctx, id);
  return getPost(ctx, id);
}

/** 删除文章（连同磁盘文件与图片） */
export function deletePost(ctx, id) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`文章不存在（id=${id}）`);
  for (const m of mediaOf(ctx, id)) {
    ctx.storage.deleteFile(m.file_path);
  }
  ctx.db.prepare('DELETE FROM post_media WHERE post_id = ?').run(Number(id));
  ctx.db.prepare('UPDATE posts SET deleted = 1 WHERE id = ?').run(Number(id));
  if (row.file_path) ctx.storage.deleteFile(row.file_path);
  return { ok: true, id: Number(id) };
}

/** 发布模块摘要（供首页使用） */
export function summary(ctx, date = todayISO()) {
  const totalRow = ctx.db.prepare('SELECT COUNT(*) AS c FROM posts WHERE deleted = 0').get();
  const mediaRow = ctx.db
    .prepare(
      `SELECT COUNT(*) AS c FROM post_media m
       JOIN posts p ON p.id = m.post_id AND p.deleted = 0`,
    )
    .get();
  const weekAgo = ctx.db
    .prepare('SELECT COUNT(*) AS c FROM posts WHERE deleted = 0 AND post_date >= ?')
    .get(weekStartISO(date));
  const latest = ctx.db
    .prepare('SELECT * FROM posts WHERE deleted = 0 ORDER BY post_date DESC, id DESC LIMIT 1')
    .get();
  const monthStart = `${String(date).slice(0, 7)}-01`;
  const monthRow = ctx.db
    .prepare('SELECT COUNT(*) AS c FROM posts WHERE deleted = 0 AND post_date >= ?')
    .get(monthStart);

  return {
    total: Number(totalRow.c),
    mediaCount: Number(mediaRow.c),
    thisWeek: Number(weekAgo.c),
    thisMonth: Number(monthRow.c),
    latest: latest
      ? {
          id: latest.id,
          title: latest.title,
          postDate: latest.post_date,
          excerpt: buildExcerpt(latest.content),
        }
      : null,
  };
}

/** 计算某日期所在周的周一（自然周口径，仅用于统计展示） */
function weekStartISO(date) {
  const d = new Date(`${date}T00:00:00`);
  const day = d.getDay(); // 0=周日
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
