/**
 * 计划模块业务逻辑。
 *
 * 核心概念：
 *   - 打卡方式（mode）：
 *       'check' 确认式 —— 今天做没做，打勾
 *       'quant' 量化式 —— 记进度，允许超额完成
 *   - 周期（cycle_unit）：week / month / year
 *   - 滚动周期：以 start_date 为锚点，往后每 N 天/月/年为一个周期，
 *     而不是自然周/自然月。这样"周三创建、想下周一再开始"也能正确表达。
 *   - 超额（over）：量化式在当前周期内累计值 > 目标值。
 */

import {
  CYCLE_UNITS,
  CYCLE_UNIT_LABEL,
  periodIndexOf,
  resolveStartDate,
  todayISO,
  nowISO,
  parseISODate,
  toISODate,
  addDays,
  diffDays,
  isValidISODate,
  eachDateInPeriod,
} from '../dates.js';
import { badRequest, notFound } from '../http.js';

const MODES = new Set(['check', 'quant']);
const START_MODES = new Set(['same_day', 'next_day']);

/** 把数据库行转成对外对象 */
export function rowToPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    targetValue: row.target_value,
    unit: row.unit,
    cycleUnit: row.cycle_unit,
    startDate: row.start_date,
    startMode: row.start_mode,
    archived: !!row.archived,
    filePath: row.file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 读取单个计划行 */
function getRow(ctx, id) {
  return ctx.db.prepare('SELECT * FROM plans WHERE id = ?').get(Number(id));
}

/** 读取计划的全部打卡记录（按日期升序） */
export function listCheckinRows(ctx, planId) {
  return ctx.db
    .prepare('SELECT * FROM plan_checkins WHERE plan_id = ? ORDER BY checkin_date ASC')
    .all(Number(planId));
}

/**
 * 计算连续打卡天数。
 * 若今天尚未打卡，则从昨天往前数（这样"今天还没打卡"不会让连胜瞬间归零）。
 */
export function computeStreak(datesWithDone, today) {
  const set = new Set(datesWithDone);
  let cursor = parseISODate(today);
  if (!set.has(toISODate(cursor))) cursor = addDays(cursor, -1);
  let streak = 0;
  while (set.has(toISODate(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * 组装一个计划的完整状态（含周期、进度、超额信息）。
 * @param {object} ctx 应用上下文
 * @param {object} row plans 表行
 * @param {string} date 参照日期 YYYY-MM-DD，默认今天
 */
export function buildStatus(ctx, row, date = todayISO()) {
  const plan = rowToPlan(row);
  if (!plan) return null;

  const checkins = listCheckinRows(ctx, plan.id);
  const anchor = parseISODate(plan.startDate);
  const period = periodIndexOf(anchor, plan.cycleUnit, parseISODate(date));

  const base = {
    plan,
    date,
    cycleUnitLabel: CYCLE_UNIT_LABEL[plan.cycleUnit],
    started: period !== null,
    period: null,
  };

  if (!period) {
    // 起始日在未来，周期还没开始
    return {
      ...base,
      mode: plan.mode,
      checkToday: false,
      doneInPeriod: 0,
      periodDays: 0,
      streak: 0,
      total: 0,
      target: plan.targetValue,
      unit: plan.unit,
      ratio: 0,
      achieved: false,
      over: false,
      overBy: 0,
      needsToday: false,
      future: true,
    };
  }

  const startISO = period.startISO;
  const endISO = period.endISO;
  const inPeriod = checkins.filter(
    (c) => c.checkin_date >= startISO && c.checkin_date <= endISO,
  );

  const periodDays = diffDays(parseISODate(startISO), parseISODate(endISO)) + 1;
  const periodInfo = {
    index: period.index,
    startISO,
    endISO,
    daysTotal: periodDays,
    daysLeft: Math.max(0, diffDays(parseISODate(date), parseISODate(endISO))),
  };

  if (plan.mode === 'check') {
    const doneDates = inPeriod.filter((c) => c.done).map((c) => c.checkin_date);
    const todayRow = checkins.find((c) => c.checkin_date === date);
    const checkToday = !!(todayRow && todayRow.done);
    return {
      ...base,
      period: periodInfo,
      mode: 'check',
      checkToday,
      doneInPeriod: doneDates.length,
      periodDays,
      streak: computeStreak(
        checkins.filter((c) => c.done).map((c) => c.checkin_date),
        date,
      ),
      total: doneDates.length,
      target: null,
      unit: null,
      ratio: 0,
      achieved: false,
      over: false,
      overBy: 0,
      needsToday: !checkToday,
      // 日历视图用：周期内每天的完成情况
      calendar: eachDateInPeriod(startISO, endISO).map((d) => ({
        date: d,
        done: doneDates.includes(d),
      })),
    };
  }

  // 量化式
  const total = inPeriod.reduce((sum, c) => sum + (Number(c.value) || 0), 0);
  const target = Number(plan.targetValue) || 0;
  const overBy = Math.max(0, total - target);
  return {
    ...base,
    period: periodInfo,
    mode: 'quant',
    checkToday: inPeriod.some((c) => c.checkin_date === date),
    doneInPeriod: inPeriod.length,
    periodDays,
    streak: computeStreak(
      inPeriod.filter((c) => (Number(c.value) || 0) > 0).map((c) => c.checkin_date),
      date,
    ),
    total,
    target,
    unit: plan.unit,
    ratio: target > 0 ? total / target : 0,
    achieved: target > 0 && total >= target,
    over: target > 0 && total > target,
    overBy,
    needsToday: total < target,
    entries: inPeriod.map((c) => ({
      date: c.checkin_date,
      value: Number(c.value) || 0,
      note: c.note || '',
    })),
  };
}

/** 列出计划及其状态 */
export function listStatuses(ctx, { date = todayISO(), includeArchived = false } = {}) {
  const sql = includeArchived
    ? 'SELECT * FROM plans ORDER BY archived ASC, id DESC'
    : 'SELECT * FROM plans WHERE archived = 0 ORDER BY id DESC';
  const rows = ctx.db.prepare(sql).all();
  return rows.map((row) => buildStatus(ctx, row, date));
}

/** 读取单个计划状态 */
export function getStatus(ctx, id, date = todayISO()) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`计划不存在（id=${id}）`);
  return buildStatus(ctx, row, date);
}

/** 校验并规范化创建计划的输入 */
function normalizeCreateInput(ctx, input = {}) {
  const name = String(input.name ?? '').trim();
  if (!name) throw badRequest('计划名称不能为空');

  const mode = String(input.mode ?? 'check');
  if (!MODES.has(mode)) throw badRequest(`打卡方式只能是 check 或 quant，收到：${mode}`);

  const cycleUnit = String(input.cycleUnit ?? 'week');
  if (!CYCLE_UNITS.includes(cycleUnit)) {
    throw badRequest(`周期单位只能是 week / month / year，收到：${cycleUnit}`);
  }

  let targetValue = null;
  let unit = null;
  if (mode === 'quant') {
    targetValue = Number(input.targetValue);
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      throw badRequest('量化式计划必须设置大于 0 的目标数值');
    }
    unit = String(input.unit ?? '').trim() || '次';
  }

  const startMode = String(input.startMode ?? 'same_day');
  if (!START_MODES.has(startMode)) {
    throw badRequest(`首次起算方式只能是 same_day 或 next_day，收到：${startMode}`);
  }

  let startDate;
  if (input.startDate) {
    if (!isValidISODate(input.startDate)) throw badRequest(`起始日格式非法：${input.startDate}`);
    startDate = input.startDate;
  } else {
    startDate = resolveStartDate(todayISO(), startMode);
  }

  return { name, mode, targetValue, unit, cycleUnit, startDate, startMode };
}

/** 把计划同步落盘 */
export function exportPlanFile(ctx, planId) {
  const row = getRow(ctx, planId);
  if (!row) return null;
  const checkins = listCheckinRows(ctx, planId);
  const plan = rowToPlan(row);
  plan.file_path = row.file_path;
  const rel = ctx.storage.writePlanFile(
    {
      id: plan.id,
      name: plan.name,
      mode: plan.mode,
      target_value: plan.targetValue,
      unit: plan.unit,
      cycle_unit: plan.cycleUnit,
      start_date: plan.startDate,
      start_mode: plan.startMode,
      archived: plan.archived ? 1 : 0,
      file_path: row.file_path,
    },
    checkins,
  );
  ctx.db.prepare('UPDATE plans SET file_path = ? WHERE id = ?').run(rel, planId);
  return rel;
}

/** 创建计划 */
export function createPlan(ctx, input) {
  const data = normalizeCreateInput(ctx, input);
  const now = nowISO();
  const info = ctx.db
    .prepare(
      `INSERT INTO plans
        (name, mode, target_value, unit, cycle_unit, start_date, start_mode, archived, file_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    )
    .run(
      data.name,
      data.mode,
      data.targetValue,
      data.unit,
      data.cycleUnit,
      data.startDate,
      data.startMode,
      now,
      now,
    );
  const id = Number(info.lastInsertRowid);
  exportPlanFile(ctx, id);
  return getStatus(ctx, id);
}

/** 更新计划 */
export function updatePlan(ctx, id, patch = {}) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`计划不存在（id=${id}）`);

  const current = rowToPlan(row);
  const merged = {
    name: patch.name !== undefined ? String(patch.name).trim() : current.name,
    mode: patch.mode !== undefined ? String(patch.mode) : current.mode,
    targetValue: patch.targetValue !== undefined ? patch.targetValue : current.targetValue,
    unit: patch.unit !== undefined ? patch.unit : current.unit,
    cycleUnit: patch.cycleUnit !== undefined ? String(patch.cycleUnit) : current.cycleUnit,
    startDate: patch.startDate !== undefined ? patch.startDate : current.startDate,
    startMode: patch.startMode !== undefined ? String(patch.startMode) : current.startMode,
  };
  if (!merged.name) throw badRequest('计划名称不能为空');
  if (!MODES.has(merged.mode)) throw badRequest('打卡方式非法');
  if (!CYCLE_UNITS.includes(merged.cycleUnit)) throw badRequest('周期单位非法');
  if (!isValidISODate(merged.startDate)) throw badRequest('起始日格式非法');
  if (!START_MODES.has(merged.startMode)) throw badRequest('首次起算方式非法');
  if (merged.mode === 'quant') {
    const tv = Number(merged.targetValue);
    if (!Number.isFinite(tv) || tv <= 0) throw badRequest('量化式计划的目标数值必须大于 0');
    merged.targetValue = tv;
    merged.unit = String(merged.unit ?? '').trim() || '次';
  } else {
    merged.targetValue = null;
    merged.unit = null;
  }

  ctx.db
    .prepare(
      `UPDATE plans SET name=?, mode=?, target_value=?, unit=?, cycle_unit=?, start_date=?, start_mode=?, updated_at=?
       WHERE id=?`,
    )
    .run(
      merged.name,
      merged.mode,
      merged.targetValue,
      merged.unit,
      merged.cycleUnit,
      merged.startDate,
      merged.startMode,
      nowISO(),
      Number(id),
    );

  exportPlanFile(ctx, id);
  return getStatus(ctx, id);
}

/** 归档 / 取消归档 */
export function setArchived(ctx, id, archived) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`计划不存在（id=${id}）`);
  ctx.db
    .prepare('UPDATE plans SET archived = ?, updated_at = ? WHERE id = ?')
    .run(archived ? 1 : 0, nowISO(), Number(id));
  exportPlanFile(ctx, id);
  return getStatus(ctx, id);
}

/** 删除计划（连同打卡记录与磁盘文件） */
export function deletePlan(ctx, id) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`计划不存在（id=${id}）`);
  ctx.db.prepare('DELETE FROM plan_checkins WHERE plan_id = ?').run(Number(id));
  ctx.db.prepare('DELETE FROM plans WHERE id = ?').run(Number(id));
  if (row.file_path) ctx.storage.deleteFile(row.file_path);
  return { ok: true, id: Number(id) };
}

/**
 * 打卡 / 记进度。
 *
 * @param {object} input
 * @param {string} [input.date] 打卡日期，默认今天
 * @param {number} [input.value] 量化式的本次数值
 * @param {'add'|'set'} [input.mode] 量化式累加方式，默认 add
 * @param {boolean} [input.done] 确认式是否完成，默认 true
 */
export function checkin(ctx, id, input = {}) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`计划不存在（id=${id}）`);
  const plan = rowToPlan(row);

  const date = input.date ? String(input.date) : todayISO();
  if (!isValidISODate(date)) throw badRequest(`打卡日期格式非法：${date}`);

  const anchor = parseISODate(plan.startDate);
  const period = periodIndexOf(anchor, plan.cycleUnit, parseISODate(date));
  if (!period) {
    throw badRequest(`该日期（${date}）早于计划起始日（${plan.startDate}），无法打卡`);
  }

  const now = nowISO();
  const existing = ctx.db
    .prepare('SELECT * FROM plan_checkins WHERE plan_id = ? AND checkin_date = ?')
    .get(Number(id), date);

  if (plan.mode === 'check') {
    const done = input.done === undefined ? true : !!input.done;
    if (existing) {
      ctx.db
        .prepare('UPDATE plan_checkins SET done = ?, updated_at = ? WHERE id = ?')
        .run(done ? 1 : 0, now, existing.id);
    } else {
      ctx.db
        .prepare(
          `INSERT INTO plan_checkins (plan_id, checkin_date, done, value, note, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(Number(id), date, done ? 1 : 0, input.note ?? null, now, now);
    }
  } else {
    const addValue = Number(input.value);
    if (!Number.isFinite(addValue)) throw badRequest('量化式打卡必须提供数值 value');
    const applyMode = input.mode === 'set' ? 'set' : 'add';
    const prev = existing ? Number(existing.value) || 0 : 0;
    const next = applyMode === 'set' ? addValue : prev + addValue;
    if (next < 0) throw badRequest('进度数值不能为负');
    if (existing) {
      ctx.db
        .prepare('UPDATE plan_checkins SET value = ?, done = 1, note = ?, updated_at = ? WHERE id = ?')
        .run(next, input.note ?? existing.note ?? null, now, existing.id);
    } else {
      ctx.db
        .prepare(
          `INSERT INTO plan_checkins (plan_id, checkin_date, done, value, note, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?, ?, ?)`,
        )
        .run(Number(id), date, next, input.note ?? null, now, now);
    }
  }

  exportPlanFile(ctx, id);
  return getStatus(ctx, id, date);
}

/** 撤销某天打卡 */
export function removeCheckin(ctx, id, date = todayISO()) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`计划不存在（id=${id}）`);
  ctx.db.prepare('DELETE FROM plan_checkins WHERE plan_id = ? AND checkin_date = ?').run(Number(id), date);
  exportPlanFile(ctx, id);
  return getStatus(ctx, id, date);
}

/** 读取某计划的打卡历史 */
export function history(ctx, id, date = todayISO()) {
  const row = getRow(ctx, id);
  if (!row) throw notFound(`计划不存在（id=${id}）`);
  const plan = rowToPlan(row);
  const checkins = listCheckinRows(ctx, id).map((c) => ({
    date: c.checkin_date,
    done: !!c.done,
    value: c.value === null ? null : Number(c.value),
    note: c.note || '',
  }));
  return {
    plan,
    checkins,
    status: buildStatus(ctx, row, date),
  };
}

/**
 * 今日需要关注的计划（首页"今日计划"区的数据源）。
 *
 * 注意：这个函数和计划模块共用同一份 buildStatus 结果，
 * 所以首页与计划页永远一致，不存在两套数据。
 */
export function todaySummaries(ctx, date = todayISO()) {
  return listStatuses(ctx, { date, includeArchived: false }).filter((s) => s.started);
}

/** 生成进入计划页的提醒弹窗文案 */
export function reminder(ctx, date = todayISO()) {
  const items = todaySummaries(ctx, date);
  const pending = items.filter((s) => s.needsToday);
  const overItems = items.filter((s) => s.over);
  const parts = [];
  if (items.length === 0) {
    parts.push('你还没有正在进行的计划，去新建一个吧。');
  } else {
    const doneCount = items.length - pending.length;
    parts.push(`今日 ${items.length} 项计划，已完成 ${doneCount} 项。`);
    if (pending.length) {
      parts.push(`还有 ${pending.length} 项待完成：${pending.map((s) => s.plan.name).join('、')}。`);
    } else {
      parts.push('今天的计划全部完成，做得好！');
    }
    if (overItems.length) {
      parts.push(
        `本周期已超额：${overItems
          .map((s) => `${s.plan.name}（${s.total}/${s.target} ${s.unit || ''}）`.trim())
          .join('、')}，继续保持！`,
      );
    }
  }
  return {
    date,
    total: items.length,
    pending: pending.length,
    done: items.length - pending.length,
    overCount: overItems.length,
    message: parts.join(''),
    pendingItems: pending.map((s) => ({ id: s.plan.id, name: s.plan.name, mode: s.mode })),
    overItems: overItems.map((s) => ({
      id: s.plan.id,
      name: s.plan.name,
      total: s.total,
      target: s.target,
      unit: s.unit,
    })),
  };
}
