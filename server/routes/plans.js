/**
 * 计划模块路由。
 *
 * 注意路由注册顺序：静态路径（/reminder）必须排在参数路径（/:id）之前，
 * 否则 /api/plans/reminder 会被当成 id=reminder 处理。
 */

import { readInput, toBool } from './input.js';
import * as plans from '../services/plans.js';
import { todayISO } from '../dates.js';

export function mountPlansRoutes(router, ctx) {
  /** 计划列表（含状态） */
  router.get('/api/plans', ({ query }) =>
    plans.listStatuses(ctx, {
      date: query.date || todayISO(),
      includeArchived: toBool(query.includeArchived, false),
    }),
  );

  /** 进入计划页的提醒弹窗数据 */
  router.get('/api/plans/reminder', ({ query }) => plans.reminder(ctx, query.date || todayISO()));

  /** 计划模块摘要（供首页） */
  router.get('/api/plans/summary', ({ query }) => {
    const date = query.date || todayISO();
    const items = plans.listStatuses(ctx, { date, includeArchived: false });
    return {
      date,
      total: items.length,
      pending: items.filter((i) => i.needsToday).length,
      over: items.filter((i) => i.over).length,
    };
  });

  /** 单个计划状态 */
  router.get('/api/plans/:id', ({ params, query }) =>
    plans.getStatus(ctx, params.id, query.date || todayISO()),
  );

  /** 打卡历史 */
  router.get('/api/plans/:id/history', ({ params, query }) =>
    plans.history(ctx, params.id, query.date || todayISO()),
  );

  /** 新建计划 */
  router.post('/api/plans', async ({ req }) => {
    const { body } = await readInput(req);
    return plans.createPlan(ctx, body);
  });

  /** 更新计划 */
  router.put('/api/plans/:id', async ({ req, params }) => {
    const { body } = await readInput(req);
    return plans.updatePlan(ctx, params.id, body);
  });

  /** 打卡 / 记进度 */
  router.post('/api/plans/:id/checkin', async ({ req, params }) => {
    const { body } = await readInput(req);
    return plans.checkin(ctx, params.id, body);
  });

  /** 撤销打卡 */
  router.delete('/api/plans/:id/checkin', ({ params, query }) =>
    plans.removeCheckin(ctx, params.id, query.date || todayISO()),
  );

  /** 归档 / 取消归档 */
  router.post('/api/plans/:id/archive', async ({ req, params }) => {
    const { body } = await readInput(req);
    return plans.setArchived(ctx, params.id, toBool(body.archived, true));
  });

  /** 删除计划 */
  router.delete('/api/plans/:id', ({ params }) => plans.deletePlan(ctx, params.id));
}
