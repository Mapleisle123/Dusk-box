/**
 * 首页聚合服务。
 *
 * 首页不拥有任何数据，只是各模块数据的一个"视图"。
 * 关键约束：今日计划区的数据直接来自计划模块的同一套状态计算结果，
 * 因此"在首页打卡"与"在计划页打卡"天然一致，不会出现两套数据。
 */

import { todayISO } from '../dates.js';
import { todaySummaries, reminder, listStatuses } from './plans.js';
import { recentPhotos, summary as albumsSummary } from './albums.js';
import { summary as postsSummary } from './posts.js';
import { summary as projectsSummary } from './projects.js';

/**
 * 计划模块摘要。
 */
function plansSummary(ctx, date) {
  const all = listStatuses(ctx, { date, includeArchived: false });
  const started = all.filter((s) => s.started);
  const pending = started.filter((s) => s.needsToday);
  const over = started.filter((s) => s.over);
  const achieved = started.filter((s) => s.mode === 'quant' && s.achieved);
  const checkItems = started.filter((s) => s.mode === 'check');
  const checkDone = checkItems.filter((s) => s.checkToday);

  return {
    total: started.length,
    todayTotal: started.length,
    todayDone: started.length - pending.length,
    todayPending: pending.length,
    overCount: over.length,
    achievedCount: achieved.length,
    checkTotal: checkItems.length,
    checkDone: checkDone.length,
    // 首页顶部进度文案："完成 2/4"
    progressLabel:
      started.length === 0
        ? '暂无进行中的计划'
        : `完成 ${started.length - pending.length}/${started.length}`,
  };
}

/**
 * 组装首页数据。
 * @param {object} ctx
 * @param {string} [date] 参照日期，默认今天
 */
export function buildHome(ctx, date = todayISO()) {
  const today = todaySummaries(ctx, date).map((s) => ({
    id: s.plan.id,
    name: s.plan.name,
    mode: s.mode,
    cycleUnitLabel: s.cycleUnitLabel,
    period: s.period,
    started: s.started,
    needsToday: s.needsToday,
    // 确认式
    checkToday: s.checkToday,
    streak: s.streak,
    doneInPeriod: s.doneInPeriod,
    periodDays: s.periodDays,
    // 量化式
    total: s.total,
    target: s.target,
    unit: s.unit,
    ratio: s.ratio,
    achieved: s.achieved,
    over: s.over,
    overBy: s.overBy,
  }));

  return {
    date,
    today,
    todayCount: today.length,
    todayPending: today.filter((t) => t.needsToday).length,
    reminder: reminder(ctx, date),
    recentPhotos: recentPhotos(ctx, 8),
    // 首页最下面的「项目」区块：只展示进行中的几条，数据完全来自项目模块
    projects: projectsSummary(ctx, { limit: 3 }),
    summaries: {
      posts: postsSummary(ctx, date),
      plans: plansSummary(ctx, date),
      albums: albumsSummary(ctx, date),
    },
  };
}
