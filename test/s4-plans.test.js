/**
 * S4 计划模块测试。
 *
 * 分两部分：
 *   一、周期算法单元测试（纯函数，最难、最该被钉死）
 *   二、计划模块接口测试（确认式 / 量化式 / 超额 / 提醒 / 落盘）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePeriod,
  periodIndexOf,
  resolveStartDate,
  addMonths,
  addDays,
  parseISODate,
  toISODate,
  diffDays,
} from '../server/dates.js';
import { startTestServer, ok } from './helpers.js';

const d = (s) => parseISODate(s);

// ===========================================================================
// 一、周期算法
// ===========================================================================

test('S4 · 滚动周期：周，从起始日往后数 7 天', () => {
  const anchor = d('2026-09-23'); // 周三

  assert.equal(toISODate(advancePeriod(anchor, 'week', 0, 'start')), '2026-09-23');
  assert.equal(toISODate(advancePeriod(anchor, 'week', 0, 'end')), '2026-09-29');
  assert.equal(toISODate(advancePeriod(anchor, 'week', 1, 'start')), '2026-09-30');
  assert.equal(toISODate(advancePeriod(anchor, 'week', 1, 'end')), '2026-10-06');
  assert.equal(toISODate(advancePeriod(anchor, 'week', 2, 'start')), '2026-10-07');
});

test('S4 · 滚动周期不是自然周：周三创建的一周是周三到周二', () => {
  const anchor = d('2026-09-23'); // 周三

  const p0 = periodIndexOf(anchor, 'week', d('2026-09-23'));
  assert.equal(p0.index, 0);
  assert.equal(p0.startISO, '2026-09-23');
  assert.equal(p0.endISO, '2026-09-29');

  // 09-29 仍是第 0 个周期的最后一天
  assert.equal(periodIndexOf(anchor, 'week', d('2026-09-29')).index, 0);
  // 09-30 进入第 1 个周期
  const p1 = periodIndexOf(anchor, 'week', d('2026-09-30'));
  assert.equal(p1.index, 1);
  assert.equal(p1.startISO, '2026-09-30');
  assert.equal(p1.endISO, '2026-10-06');
});

test('S4 · 早于起始日的日期不属于任何周期', () => {
  const anchor = d('2026-09-23');
  assert.equal(periodIndexOf(anchor, 'week', d('2026-09-22')), null);
  assert.equal(periodIndexOf(anchor, 'month', d('2020-01-01')), null);
});

test('S4 · 月度周期：月末日期正确收敛', () => {
  // 1 月 31 日创建的月周期
  const anchor = d('2026-01-31');

  const p0 = periodIndexOf(anchor, 'month', d('2026-01-31'));
  assert.equal(p0.index, 0);
  assert.equal(p0.startISO, '2026-01-31');
  // 下一个周期起点是 2 月 28 日，所以第 0 周期末是 2 月 27 日
  assert.equal(p0.endISO, '2026-02-27');

  const p1 = periodIndexOf(anchor, 'month', d('2026-02-28'));
  assert.equal(p1.index, 1);
  assert.equal(p1.startISO, '2026-02-28');
  assert.equal(p1.endISO, '2026-03-30');

  // 2 月 27 日仍在第 0 周期
  assert.equal(periodIndexOf(anchor, 'month', d('2026-02-27')).index, 0);
  // 2 月 28 日进入第 1 周期
  assert.equal(periodIndexOf(anchor, 'month', d('2026-02-28')).index, 1);
});

test('S4 · 月度周期跨年正确', () => {
  const anchor = d('2026-11-15');
  const p = periodIndexOf(anchor, 'month', d('2027-02-20'));
  assert.equal(p.index, 3, '11月→2月 跨过 3 个周期');
  assert.equal(p.startISO, '2027-02-15');
  assert.equal(p.endISO, '2027-03-14');
});

test('S4 · 年度周期跨年正确', () => {
  const anchor = d('2026-09-23');
  const p0 = periodIndexOf(anchor, 'year', d('2026-09-23'));
  assert.equal(p0.index, 0);
  assert.equal(p0.startISO, '2026-09-23');
  assert.equal(p0.endISO, '2027-09-22');

  const p1 = periodIndexOf(anchor, 'year', d('2027-09-23'));
  assert.equal(p1.index, 1);
  assert.equal(p1.startISO, '2027-09-23');
});

test('S4 · 闰年 2 月 29 日的月度推进不越界', () => {
  // 2028 是闰年
  assert.equal(toISODate(addMonths(d('2028-01-31'), 1)), '2028-02-29');
  assert.equal(toISODate(addMonths(d('2028-02-29'), 12)), '2029-02-28');
  // 2026 不是闰年
  assert.equal(toISODate(addMonths(d('2026-01-31'), 1)), '2026-02-28');
});

test('S4 · 首次起算：创建当天 / 创建次日', () => {
  assert.equal(resolveStartDate('2026-09-23', 'same_day'), '2026-09-23');
  assert.equal(resolveStartDate('2026-09-23', 'next_day'), '2026-09-24');
  // 跨月边界
  assert.equal(resolveStartDate('2026-09-30', 'next_day'), '2026-10-01');
  assert.equal(resolveStartDate('2026-12-31', 'next_day'), '2027-01-01');
});

test('S4 · 跨夏令时的天数差仍准确', () => {
  assert.equal(diffDays(d('2026-03-01'), d('2026-03-31')), 30);
  assert.equal(diffDays(d('2026-11-01'), d('2026-12-01')), 30);
  assert.equal(toISODate(addDays(d('2026-02-28'), 1)), '2026-03-01');
});

// ===========================================================================
// 二、计划模块接口
// ===========================================================================

test('S4 · 创建确认式计划并可打卡、撤销', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const plan = ok(
    await srv.post('/api/plans', {
      name: '每天背单词',
      mode: 'check',
      cycleUnit: 'week',
      startDate: '2026-09-23',
      startMode: 'same_day',
    }),
  );
  assert.equal(plan.plan.mode, 'check');
  assert.equal(plan.started, true);
  assert.equal(plan.checkToday, false);
  assert.equal(plan.needsToday, true);

  const checked = ok(
    await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: '2026-09-23' }),
  );
  assert.equal(checked.checkToday, true);
  assert.equal(checked.doneInPeriod, 1);
  assert.equal(checked.needsToday, false);
  assert.equal(checked.streak, 1);

  const undone = ok(await srv.del(`/api/plans/${plan.plan.id}/checkin?date=2026-09-23`));
  assert.equal(undone.checkToday, false);
  assert.equal(undone.needsToday, true);
});

test('S4 · 确认式：连续打卡天数计算正确（今天没打不会立刻清零）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const plan = ok(
    await srv.post('/api/plans', {
      name: '早起',
      mode: 'check',
      cycleUnit: 'week',
      startDate: '2026-09-20',
    }),
  );
  for (const day of ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']) {
    ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: day }));
  }

  // 以 09-23 为参照：连续 4 天
  const onToday = ok(await srv.get(`/api/plans/${plan.plan.id}?date=2026-09-23`));
  assert.equal(onToday.streak, 4);

  // 09-24 还没打卡：连胜仍应为 4（从 09-23 往前数）
  const onTomorrow = ok(await srv.get(`/api/plans/${plan.plan.id}?date=2026-09-24`));
  assert.equal(onTomorrow.streak, 4, '今天尚未打卡不应让连胜归零');

  // 09-25 还没打卡：中间断了 09-24，连胜应为 0
  const onDayAfter = ok(await srv.get(`/api/plans/${plan.plan.id}?date=2026-09-25`));
  assert.equal(onDayAfter.streak, 0);
});

test('S4 · 确认式：周期日历标记正确', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const plan = ok(
    await srv.post('/api/plans', {
      name: '阅读',
      mode: 'check',
      cycleUnit: 'week',
      startDate: '2026-09-23',
    }),
  );
  ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: '2026-09-23' }));
  ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: '2026-09-25' }));

  const status = ok(await srv.get(`/api/plans/${plan.plan.id}?date=2026-09-25`));
  assert.equal(status.period.startISO, '2026-09-23');
  assert.equal(status.period.endISO, '2026-09-29');
  assert.equal(status.period.daysTotal, 7);
  assert.equal(status.calendar.length, 7);

  const byDate = Object.fromEntries(status.calendar.map((c) => [c.date, c.done]));
  assert.equal(byDate['2026-09-23'], true);
  assert.equal(byDate['2026-09-24'], false);
  assert.equal(byDate['2026-09-25'], true);
});

test('S4 · 量化式：进度累加与目标对比', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const plan = ok(
    await srv.post('/api/plans', {
      name: '每周跑 3 次',
      mode: 'quant',
      targetValue: 3,
      unit: '次',
      cycleUnit: 'week',
      startDate: '2026-09-23',
      startMode: 'same_day',
    }),
  );
  assert.equal(plan.target, 3);
  assert.equal(plan.total, 0);
  assert.equal(plan.over, false);
  assert.equal(plan.needsToday, true);

  ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: '2026-09-23', value: 1 }));
  const two = ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: '2026-09-24', value: 1 }));
  assert.equal(two.total, 2);
  assert.equal(two.achieved, false);
  assert.equal(two.ratio, 2 / 3);

  const three = ok(
    await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: '2026-09-25', value: 1 }),
  );
  assert.equal(three.total, 3);
  assert.equal(three.achieved, true);
  assert.equal(three.over, false, '刚好达标不算超额');
  assert.equal(three.needsToday, false);
});

test('S4 · 量化式：超额完成会被识别并给出超出量', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const plan = ok(
    await srv.post('/api/plans', {
      name: '每周跑 3 次',
      mode: 'quant',
      targetValue: 3,
      unit: '次',
      cycleUnit: 'week',
      startDate: '2026-09-23',
    }),
  );

  for (const day of ['2026-09-23', '2026-09-24', '2026-09-25']) {
    ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: day, value: 1 }));
  }
  const over = ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: '2026-09-26', value: 1 }));

  assert.equal(over.total, 4);
  assert.equal(over.target, 3);
  assert.equal(over.over, true);
  assert.equal(over.overBy, 1);
  assert.ok(over.ratio > 1, '完成率应大于 100%');
});

test('S4 · 量化式：同一天重复记录会累加，set 模式则覆盖', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const plan = ok(
    await srv.post('/api/plans', {
      name: '每天喝水',
      mode: 'quant',
      targetValue: 8,
      unit: '杯',
      cycleUnit: 'week',
      startDate: '2026-09-23',
    }),
  );
  const id = plan.plan.id;

  const a = ok(await srv.post(`/api/plans/${id}/checkin`, { date: '2026-09-23', value: 2 }));
  assert.equal(a.total, 2);
  const b = ok(await srv.post(`/api/plans/${id}/checkin`, { date: '2026-09-23', value: 3 }));
  assert.equal(b.total, 5, '默认累加');

  const c = ok(await srv.post(`/api/plans/${id}/checkin`, { date: '2026-09-23', value: 4, mode: 'set' }));
  assert.equal(c.total, 4, 'set 模式应覆盖当天数值');
});

test('S4 · 周期结束后计数重置，历史仍保留', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const plan = ok(
    await srv.post('/api/plans', {
      name: '每周跑 3 次',
      mode: 'quant',
      targetValue: 3,
      unit: '次',
      cycleUnit: 'week',
      startDate: '2026-09-23',
    }),
  );
  const id = plan.plan.id;

  // 第 0 周期（09-23 ~ 09-29）完成 3 次
  for (const day of ['2026-09-23', '2026-09-24', '2026-09-25']) {
    ok(await srv.post(`/api/plans/${id}/checkin`, { date: day, value: 1 }));
  }

  const p0 = ok(await srv.get(`/api/plans/${id}?date=2026-09-29`));
  assert.equal(p0.period.index, 0);
  assert.equal(p0.total, 3);

  // 09-30 进入第 1 周期，计数归零
  const p1 = ok(await srv.get(`/api/plans/${id}?date=2026-09-30`));
  assert.equal(p1.period.index, 1);
  assert.equal(p1.total, 0, '新周期计数应从 0 开始');
  assert.equal(p1.period.startISO, '2026-09-30');

  // 但历史记录仍在
  const history = ok(await srv.get(`/api/plans/${id}/history`));
  assert.equal(history.checkins.length, 3, '历史打卡不应被清掉');
});

test('S4 · 起始日在未来时，计划显示为"未开始"', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  // 日期要相对"今天"算，不能写死一个未来日期：
  // 写死的话，那天一过这条用例就会永远失败（2026-10-01 就是这么过期的）。
  // 相对日期既一直测得到"还没开始"，也不会过期。
  const startISO = toISODate(addDays(new Date(), 30));
  const laterISO = toISODate(addDays(new Date(), 31));

  const plan = ok(
    await srv.post('/api/plans', {
      name: '下月开始的计划',
      mode: 'check',
      cycleUnit: 'month',
      startDate: startISO,
      startMode: 'same_day',
    }),
  );
  assert.equal(plan.started, false, '以今天为参照时应尚未开始');
  assert.equal(plan.future, true);
  assert.equal(plan.needsToday, false);

  // 到期后正常开始
  const later = ok(await srv.get(`/api/plans/${plan.plan.id}?date=${laterISO}`));
  assert.equal(later.started, true);
});

test('S4 · 起始日之前无法打卡', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const plan = ok(
    await srv.post('/api/plans', {
      name: '晚点开始',
      mode: 'check',
      cycleUnit: 'week',
      startDate: '2026-09-30',
    }),
  );
  const res = await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: '2026-09-23' });
  assert.equal(res.status, 400);
  assert.ok(String(res.body.error).includes('早于计划起始日'));
});

test('S4 · 创建计划的参数校验', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  assert.equal((await srv.post('/api/plans', { name: '', mode: 'check', cycleUnit: 'week' })).status, 400);
  assert.equal((await srv.post('/api/plans', { name: 'x', mode: '奇形怪状', cycleUnit: 'week' })).status, 400);
  assert.equal((await srv.post('/api/plans', { name: 'x', mode: 'quant', cycleUnit: 'week' })).status, 400);
  assert.equal(
    (await srv.post('/api/plans', { name: 'x', mode: 'quant', targetValue: -1, cycleUnit: 'week' })).status,
    400,
  );
  assert.equal((await srv.post('/api/plans', { name: 'x', mode: 'check', cycleUnit: '季度' })).status, 400);
  assert.equal(
    (await srv.post('/api/plans', { name: 'x', mode: 'check', cycleUnit: 'week', startDate: '乱写' })).status,
    400,
  );
  assert.equal(
    (await srv.post('/api/plans', { name: 'x', mode: 'check', cycleUnit: 'week', startMode: '随便' })).status,
    400,
  );
});

test('S4 · 进入计划页的提醒弹窗内容正确', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  // 无计划时的文案
  const empty = ok(await srv.get('/api/plans/reminder?date=2026-09-23'));
  assert.equal(empty.total, 0);
  assert.ok(empty.message.includes('还没有正在进行'));

  const a = ok(
    await srv.post('/api/plans', {
      name: '背单词',
      mode: 'check',
      cycleUnit: 'week',
      startDate: '2026-09-23',
    }),
  );
  ok(
    await srv.post('/api/plans', {
      name: '跑步',
      mode: 'quant',
      targetValue: 3,
      unit: '次',
      cycleUnit: 'week',
      startDate: '2026-09-23',
    }),
  );

  ok(await srv.post(`/api/plans/${a.plan.id}/checkin`, { date: '2026-09-23' }));

  const rem = ok(await srv.get('/api/plans/reminder?date=2026-09-23'));
  assert.equal(rem.total, 2);
  assert.equal(rem.done, 1);
  assert.equal(rem.pending, 1);
  assert.ok(rem.message.includes('已完成 1 项'));
  assert.ok(rem.message.includes('跑步'), '待完成项应被点名');
  assert.equal(rem.pendingItems.length, 1);
  assert.equal(rem.pendingItems[0].name, '跑步');
});

test('S4 · 提醒弹窗会指出已超额的计划', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const plan = ok(
    await srv.post('/api/plans', {
      name: '跑步',
      mode: 'quant',
      targetValue: 2,
      unit: '次',
      cycleUnit: 'week',
      startDate: '2026-09-23',
    }),
  );
  for (const day of ['2026-09-23', '2026-09-24', '2026-09-25']) {
    ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: day, value: 1 }));
  }

  const rem = ok(await srv.get('/api/plans/reminder?date=2026-09-25'));
  assert.equal(rem.overCount, 1);
  assert.ok(rem.message.includes('超额'));
  assert.equal(rem.overItems[0].name, '跑步');
  assert.equal(rem.overItems[0].total, 3);
  assert.equal(rem.overItems[0].target, 2);
});

test('S4 · 计划同步落盘为文件，含打卡记录', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const plan = ok(
    await srv.post('/api/plans', {
      name: '每周跑3次',
      mode: 'quant',
      targetValue: 3,
      unit: '次',
      cycleUnit: 'week',
      startDate: '2026-09-23',
    }),
  );
  ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: '2026-09-23', value: 1 }));

  assert.ok(srv.existsData('计划/每周跑3次.md'), '计划应落盘');
  const text = srv.readDataFile('计划/每周跑3次.md');
  assert.ok(text.includes('# 每周跑3次'));
  assert.ok(text.includes('| 2026-09-23 | 1 次 |'));
});

test('S4 · 编辑计划：目标值与周期可改，文件同步', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const plan = ok(
    await srv.post('/api/plans', {
      name: '读书',
      mode: 'quant',
      targetValue: 2,
      unit: '本',
      cycleUnit: 'month',
      startDate: '2026-09-01',
    }),
  );

  const updated = ok(await srv.put(`/api/plans/${plan.plan.id}`, { targetValue: 4, unit: '本' }));
  assert.equal(updated.target, 4);

  const renamed = ok(await srv.put(`/api/plans/${plan.plan.id}`, { name: '读四本书' }));
  assert.equal(renamed.plan.name, '读四本书');
  assert.ok(srv.existsData('计划/读四本书.md'), '改名后文件应同步');
  assert.equal(srv.existsData('计划/读书.md'), false, '旧文件应清理');
});

test('S4 · 归档与删除', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const a = ok(await srv.post('/api/plans', { name: 'A', mode: 'check', cycleUnit: 'week', startDate: '2026-09-23' }));
  const b = ok(await srv.post('/api/plans', { name: 'B', mode: 'check', cycleUnit: 'week', startDate: '2026-09-23' }));

  // 归档后默认列表不显示
  ok(await srv.post(`/api/plans/${a.plan.id}/archive`, { archived: true }));
  const visible = ok(await srv.get('/api/plans?date=2026-09-23'));
  assert.equal(visible.length, 1);
  assert.equal(visible[0].plan.name, 'B');

  const all = ok(await srv.get('/api/plans?date=2026-09-23&includeArchived=true'));
  assert.equal(all.length, 2);

  // 删除
  ok(await srv.del(`/api/plans/${b.plan.id}`));
  assert.equal((await srv.get(`/api/plans/${b.plan.id}`)).status, 404);
  assert.equal(srv.existsData('计划/B.md'), false, '删除计划应同时删除文件');
});

test('S4 · 计划数据在重启后完整保留', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'qsx-plan-restart-'));

  const srv = await startTestServer({ dataRoot });
  const plan = ok(
    await srv.post('/api/plans', {
      name: '持久化计划',
      mode: 'quant',
      targetValue: 3,
      unit: '次',
      cycleUnit: 'week',
      startDate: '2026-09-23',
    }),
  );
  ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: '2026-09-23', value: 2 }));
  await srv.close();

  const srv2 = await startTestServer({ dataRoot });
  t.after(async () => {
    await srv2.close();
    for (let i = 0; i < 10; i += 1) {
      try {
        rmSync(dataRoot, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  });

  const restored = ok(await srv2.get(`/api/plans/${plan.plan.id}?date=2026-09-23`));
  assert.equal(restored.total, 2, '打卡进度应在重启后保留');
  assert.equal(restored.plan.name, '持久化计划');
  assert.ok(srv2.existsData('计划/持久化计划.md'));
});
