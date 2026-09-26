/**
 * 日期工具集。
 *
 * 设计原则：所有"日期"在业务层一律使用本地时区的 `YYYY-MM-DD` 字符串，
 * 避免 UTC 偏移导致"今天"错位（这是本地日记类应用最常见的 bug）。
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 补零 */
function pad(n) {
  return String(n).padStart(2, '0');
}

/** 把 Date 格式化为本地 YYYY-MM-DD */
export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 把 Date 格式化为本地 YYYY-MM-DD HH:mm:ss */
export function toISODateTime(date) {
  return `${toISODate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 今天的 YYYY-MM-DD */
export function todayISO(date = new Date()) {
  return toISODate(date);
}

/** 现在的时间戳字符串 */
export function nowISO(date = new Date()) {
  return toISODateTime(date);
}

/**
 * 解析 YYYY-MM-DD 为本地零点 Date。
 * 不用 new Date(str)，因为那会按 UTC 解析产生时区偏移。
 */
export function parseISODate(iso) {
  if (typeof iso !== 'string') throw new TypeError('parseISODate 需要字符串');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new TypeError(`非法日期格式：${iso}（应为 YYYY-MM-DD）`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    throw new TypeError(`非法日期：${iso}`);
  }
  return d;
}

/** 校验是否为合法 YYYY-MM-DD */
export function isValidISODate(iso) {
  try {
    parseISODate(iso);
    return true;
  } catch {
    return false;
  }
}

/** 日期加减天数，返回新 Date */
export function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

/** b - a 的天数差（按本地零点计算，避免夏令时干扰） */
export function diffDays(a, b) {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db.getTime() - da.getTime()) / MS_PER_DAY);
}

/**
 * 日期加减月数。若目标月没有对应日（如 1/31 + 1 月），
 * 则收敛到该月最后一天（2/28 或 2/29），这是最符合直觉的行为。
 */
export function addMonths(date, months) {
  const day = date.getDate();
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/** 周期单位 → 允许的值 */
export const CYCLE_UNITS = ['week', 'month', 'year'];

/**
 * 滚动周期的核心运算：从锚点日期往后推进 k 个周期。
 *
 * 滚动周期的定义（本项目已确认的口径）：
 *   第 0 个周期 = [起始日, 起始日 + 1 个周期长度 - 1 天]
 *   第 k 个周期 = 从起始日往后推 k 个周期长度的区间
 * 而不是"自然周/自然月"。
 *
 * @param {Date} anchor 周期锚点（起始日）
 * @param {'week'|'month'|'year'} unit 周期单位
 * @param {number} k 周期序号（0 起）
 * @param {'start'|'end'} edge 取周期首日还是末日
 */
export function advancePeriod(anchor, unit, k, edge = 'start') {
  if (!CYCLE_UNITS.includes(unit)) throw new TypeError(`非法周期单位：${unit}`);
  if (!Number.isInteger(k) || k < 0) throw new TypeError('周期序号必须是非负整数');
  let start;
  if (unit === 'week') {
    start = addDays(anchor, k * 7);
  } else if (unit === 'month') {
    start = addMonths(anchor, k);
  } else {
    start = addMonths(anchor, k * 12);
  }
  if (edge === 'start') return start;
  // 周期末日 = 下一个周期首日 - 1 天
  const nextStart = advancePeriod(anchor, unit, k + 1, 'start');
  return addDays(nextStart, -1);
}

/**
 * 判断某个日期落在第几个周期。
 *
 * 返回 null 表示该日期早于起始日（周期尚未开始）。
 *
 * @returns {{index:number, start:Date, end:Date, startISO:string, endISO:string}|null}
 */
export function periodIndexOf(anchor, unit, date) {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const base = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (target.getTime() < base.getTime()) return null;

  let k;
  if (unit === 'week') {
    k = Math.floor(diffDays(base, target) / 7);
  } else {
    // 月/年：逐级试探（有界循环，最多几年，可忽略性能）
    const monthsPerPeriod = unit === 'month' ? 1 : 12;
    k = 0;
    // 先估算，再修正，避免长循环
    const monthSpan =
      (target.getFullYear() - base.getFullYear()) * 12 + (target.getMonth() - base.getMonth());
    k = Math.max(0, Math.floor(monthSpan / monthsPerPeriod));
    while (advancePeriod(base, unit, k, 'start').getTime() > target.getTime()) k -= 1;
    while (advancePeriod(base, unit, k + 1, 'start').getTime() <= target.getTime()) k += 1;
    if (k < 0) return null;
  }

  const start = advancePeriod(base, unit, k, 'start');
  const end = advancePeriod(base, unit, k, 'end');
  return {
    index: k,
    start,
    end,
    startISO: toISODate(start),
    endISO: toISODate(end),
  };
}

/**
 * 计算"首次起算"的锚点。
 * @param {string} baseDate 用户创建计划的日期（YYYY-MM-DD）
 * @param {'same_day'|'next_day'} startMode
 */
export function resolveStartDate(baseDate, startMode) {
  const base = parseISODate(baseDate);
  if (startMode === 'next_day') return toISODate(addDays(base, 1));
  return toISODate(base);
}

/** 周期单位的中文名 */
export const CYCLE_UNIT_LABEL = {
  week: '周',
  month: '月',
  year: '年',
};

/** 在周期区间内生成所有日期字符串 */
export function eachDateInPeriod(startISO, endISO) {
  const out = [];
  let cursor = parseISODate(startISO);
  const end = parseISODate(endISO);
  while (cursor.getTime() <= end.getTime()) {
    out.push(toISODate(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}
