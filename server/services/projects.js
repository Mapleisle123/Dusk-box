/**
 * 项目模块业务层。
 *
 * 「项目」记录的是**一次性的、有始有终**的事（做某件事、整理某批东西），
 * 与「计划」正好互补：计划管的是"每天 / 每周重复打卡"的长期习惯。
 * 两者的数据、页面、落盘文件都互不相干，唯一的交汇点是首页——首页只做展示。
 *
 * 每个项目有三样东西要留住：状态（进行中 / 搁置 / 已完成）、
 * 百分比进度、以及"已经取得了什么结果"（文字 + 图片）。
 */

import { badRequest, notFound } from '../http.js';
import { nowISO, todayISO, isValidISODate } from '../dates.js';
import { isImageFilename } from '../storage.js';

/** 允许的状态 */
export const PROJECT_STATUS = ['active', 'paused', 'done'];

/** 状态的中文名（界面用，服务端只存英文枚举） */
export const PROJECT_STATUS_LABEL = {
  active: '进行中',
  paused: '搁置',
  done: '已完成',
};

/** 数据库行 → 接口对象 */
function rowToProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    statusLabel: PROJECT_STATUS_LABEL[row.status] || '进行中',
    progress: row.progress,
    startDate: row.start_date,
    result: row.result || '',
    filePath: row.file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 项目的图片列表 */
function listMedia(ctx, projectId) {
  return ctx.db
    .prepare('SELECT * FROM project_media WHERE project_id = ? ORDER BY seq, id')
    .all(Number(projectId))
    .map((m) => ({
      id: m.id,
      originalName: m.original_name,
      filePath: m.file_path,
      createdAt: m.created_at,
    }));
}

/** 校验并归一化可写字段 */
function normalize(input = {}, { partial = false } = {}) {
  const out = {};

  if (input.name !== undefined) {
    const name = String(input.name ?? '').trim();
    if (!name) throw badRequest('项目名称不能为空');
    if (name.length > 60) throw badRequest('项目名称最长 60 个字');
    out.name = name;
  } else if (!partial) {
    throw badRequest('项目名称不能为空');
  }

  if (input.status !== undefined) {
    const status = String(input.status);
    if (!PROJECT_STATUS.includes(status)) {
      throw badRequest(`状态只能是：${PROJECT_STATUS.join(' / ')}`);
    }
    out.status = status;
  }

  if (input.progress !== undefined) {
    const progress = Number(input.progress);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      throw badRequest('进度应是 0~100 之间的整数');
    }
    out.progress = progress;
  }

  if (input.startDate !== undefined) {
    const startDate = String(input.startDate ?? '').trim();
    if (!isValidISODate(startDate)) throw badRequest('开始日期格式应为 YYYY-MM-DD');
    out.startDate = startDate;
  } else if (!partial) {
    out.startDate = todayISO();
  }

  if (input.result !== undefined) {
    out.result = String(input.result ?? '');
  }

  return out;
}

/** 把项目文件写到磁盘（内容永远以数据库为准） */
function flushFile(ctx, id) {
  const row = ctx.db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!row) return null;
  // 落盘模板读的是表里的字段名（original_name / file_path），
  // 而接口层用的是驼峰，这里转一道，别让模板拿到 undefined
  const media = listMedia(ctx, id).map((m) => ({
    original_name: m.originalName,
    file_path: m.filePath,
  }));
  // 直接喂数据库行：落盘模板用的是表里的字段名（start_date 这些），
  // 而不是接口层那套驼峰命名
  const filePath = ctx.storage.writeProjectFile(row, media);
  ctx.db.prepare('UPDATE projects SET file_path = ? WHERE id = ?').run(filePath, Number(id));
  return filePath;
}

/**
 * 列表。
 * 默认按"进行中 → 搁置 → 已完成"排，同一档里最近更新的在前——
 * 因为用户打开这一页最想先看到的是"我手上在推的那件事"。
 */
export function listProjects(ctx, { status, q } = {}) {
  const rows = ctx.db.prepare('SELECT * FROM projects').all();
  let items = rows.map(rowToProject);
  if (status) items = items.filter((p) => p.status === status);
  if (q) {
    const key = String(q).toLowerCase();
    items = items.filter(
      (p) => p.name.toLowerCase().includes(key) || p.result.toLowerCase().includes(key),
    );
  }
  const rank = { active: 0, paused: 1, done: 2 };
  items.sort((a, b) => {
    const diff = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (diff !== 0) return diff;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
  return items.map((p) => ({ ...p, media: listMedia(ctx, p.id) }));
}

/** 单个项目 */
export function getProject(ctx, id) {
  const row = ctx.db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!row) throw notFound('项目不存在');
  return { ...rowToProject(row), media: listMedia(ctx, id) };
}

/**
 * 新建项目。
 * @param {object} ctx
 * @param {object} input 字段
 * @param {Array<{buffer:Buffer, originalName:string}>} files 成果图
 */
export function createProject(ctx, input = {}, files = []) {
  const data = normalize(input);
  const now = nowISO();

  const info = ctx.db
    .prepare(
      `INSERT INTO projects (name, status, progress, start_date, result, file_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      data.name,
      data.status ?? 'active',
      data.progress ?? 0,
      data.startDate,
      data.result ?? '',
      now,
      now,
    );
  const id = Number(info.lastInsertRowid);

  attachMedia(ctx, id, files);
  const filePath = flushFile(ctx, id);
  return { project: getProject(ctx, id), filePath };
}

/**
 * 保存成果图。
 * 只接受图片——与发布、相册一致：不接受非图片文件混进来。
 */
function attachMedia(ctx, projectId, files = []) {
  let seq = ctx.db
    .prepare('SELECT COUNT(*) AS n FROM project_media WHERE project_id = ?')
    .get(Number(projectId)).n;

  for (const file of files) {
    if (!file || !file.buffer) continue;
    if (!isImageFilename(file.originalName || '')) {
      throw badRequest(`只能上传图片：${file.originalName || '未命名文件'}`);
    }
    seq += 1;
    const relPath = ctx.storage.saveProjectMedia({
      buffer: file.buffer,
      originalName: file.originalName,
      projectId,
      seq,
    });
    ctx.db
      .prepare(
        `INSERT INTO project_media (project_id, original_name, file_path, seq, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(Number(projectId), file.originalName || 'image', relPath, seq, nowISO());
  }
}

/** 更新项目（字段 + 追加成果图） */
export function updateProject(ctx, id, patch = {}, files = []) {
  const current = ctx.db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!current) throw notFound('项目不存在');

  const data = normalize(patch, { partial: true });
  const next = {
    name: data.name ?? current.name,
    status: data.status ?? current.status,
    progress: data.progress ?? current.progress,
    startDate: data.startDate ?? current.start_date,
    result: data.result ?? current.result,
  };

  ctx.db
    .prepare(
      `UPDATE projects SET name = ?, status = ?, progress = ?, start_date = ?, result = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(next.name, next.status, next.progress, next.startDate, next.result, nowISO(), Number(id));

  attachMedia(ctx, id, files);
  const filePath = flushFile(ctx, id);
  return { project: getProject(ctx, id), filePath };
}

/** 删除一张成果图 */
export function removeMedia(ctx, projectId, mediaId) {
  const row = ctx.db
    .prepare('SELECT * FROM project_media WHERE id = ? AND project_id = ?')
    .get(Number(mediaId), Number(projectId));
  if (!row) throw notFound('图片不存在');

  ctx.db.prepare('DELETE FROM project_media WHERE id = ?').run(row.id);
  ctx.storage.deleteFile(row.file_path);
  ctx.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowISO(), Number(projectId));
  flushFile(ctx, projectId);
  return { removed: row.id, project: getProject(ctx, projectId) };
}

/** 删除项目：记录、落盘文件、成果图一起清掉 */
export function deleteProject(ctx, id) {
  const row = ctx.db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!row) throw notFound('项目不存在');

  const media = listMedia(ctx, id);
  ctx.db.prepare('DELETE FROM project_media WHERE project_id = ?').run(Number(id));
  ctx.db.prepare('DELETE FROM projects WHERE id = ?').run(Number(id));
  for (const m of media) ctx.storage.deleteFile(m.filePath);
  ctx.storage.deleteFile(row.file_path);
  return { deleted: Number(id) };
}

/** 供首页用的摘要：进行中的项目（默认 3 条，首页排版定） */
export function summary(ctx, { limit = 3 } = {}) {
  const all = listProjects(ctx);
  const active = all.filter((p) => p.status === 'active');
  return {
    total: all.length,
    activeCount: active.length,
    pausedCount: all.filter((p) => p.status === 'paused').length,
    doneCount: all.filter((p) => p.status === 'done').length,
    items: active.slice(0, limit).map((p) => ({
      id: p.id,
      name: p.name,
      progress: p.progress,
      status: p.status,
      statusLabel: p.statusLabel,
      updatedAt: p.updatedAt,
    })),
  };
}
