/**
 * S7 首页聚合测试。
 *
 * 首页的核心风险不是"取不到数据"，而是"攒了第二份数据"，
 * 导致首页和模块页显示不一致。因此本组测试重点验证一致性：
 *   - 首页的今日计划 == 计划模块的计划（同一份状态计算结果）
 *   - 在首页打卡，计划页立刻能看到；反之亦然
 *   - 摘要数字与实际数据吻合
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, ok, makePng } from './helpers.js';

const TODAY = '2026-09-23';

async function seed(srv) {
  const check = ok(
    await srv.post('/api/plans', {
      name: '背单词',
      mode: 'check',
      cycleUnit: 'week',
      startDate: TODAY,
    }),
  );
  const quant = ok(
    await srv.post('/api/plans', {
      name: '跑步',
      mode: 'quant',
      targetValue: 3,
      unit: '次',
      cycleUnit: 'week',
      startDate: TODAY,
    }),
  );
  return { check, quant };
}

test('S7 · 首页返回完整的三块内容', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const home = ok(await srv.get(`/api/home?date=${TODAY}`));
  assert.equal(home.date, TODAY);
  assert.ok(Array.isArray(home.today), '应有今日计划');
  assert.ok(home.reminder, '应有提醒信息');
  assert.ok(Array.isArray(home.recentPhotos), '应有近期收藏');
  assert.ok(home.summaries.posts && home.summaries.plans && home.summaries.albums, '应有三块摘要');
});

test('S7 · 首页的今日计划与计划模块完全一致（同一份数据）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  await seed(srv);

  const home = ok(await srv.get(`/api/home?date=${TODAY}`));
  const plans = ok(await srv.get(`/api/plans?date=${TODAY}`));

  assert.equal(home.today.length, plans.length, '数量应一致');
  assert.deepEqual(
    home.today.map((x) => x.id),
    plans.map((x) => x.plan.id),
    'ID 顺序应一致',
  );
  for (let i = 0; i < plans.length; i += 1) {
    const h = home.today[i];
    const p = plans[i];
    assert.equal(h.name, p.plan.name);
    assert.equal(h.needsToday, p.needsToday);
    assert.equal(h.total, p.total);
    assert.equal(h.over, p.over);
    assert.equal(h.streak, p.streak);
  }
});

test('S7 · 在首页打卡后，计划页状态立刻同步', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { check } = await seed(srv);

  const before = ok(await srv.get(`/api/home?date=${TODAY}`));
  assert.equal(before.today.find((x) => x.id === check.plan.id).needsToday, true);
  assert.equal(before.reminder.pending, 2);

  // 首页打卡走的就是计划模块的接口
  ok(await srv.post(`/api/plans/${check.plan.id}/checkin`, { date: TODAY }));

  const after = ok(await srv.get(`/api/home?date=${TODAY}`));
  const item = after.today.find((x) => x.id === check.plan.id);
  assert.equal(item.checkToday, true, '首页应立刻反映打卡');
  assert.equal(item.needsToday, false);
  assert.equal(after.reminder.pending, 1);

  // 计划页读到的一致
  const plan = ok(await srv.get(`/api/plans/${check.plan.id}?date=${TODAY}`));
  assert.equal(plan.checkToday, true);
});

test('S7 · 首页能反映量化计划的超额状态', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { quant } = await seed(srv);
  for (const day of ['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']) {
    ok(await srv.post(`/api/plans/${quant.plan.id}/checkin`, { date: day, value: 1 }));
  }

  const home = ok(await srv.get(`/api/home?date=2026-09-26`));
  const item = home.today.find((x) => x.id === quant.plan.id);
  assert.equal(item.over, true);
  assert.equal(item.total, 4);
  assert.equal(item.target, 3);
  assert.equal(item.overBy, 1);
  assert.equal(home.summaries.plans.overCount, 1);
  assert.ok(home.reminder.message.includes('超额'));
});

test('S7 · 首页摘要的数字与实际数据吻合', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  await srv.postForm(
    '/api/posts',
    { title: '第一篇', content: 'a', postDate: TODAY },
    [{ name: '1.png', buffer: makePng(3, 3) }],
  );
  ok(await srv.post('/api/posts', { title: '第二篇', content: 'b', postDate: TODAY }));

  const album = ok(await srv.post('/api/albums', { name: '秋天' }));
  await srv.postForm(`/api/albums/${album.id}/photos`, {}, [
    { name: '1.png', buffer: makePng(3, 3) },
    { name: '2.png', buffer: makePng(3, 3) },
  ]);

  const home = ok(await srv.get(`/api/home?date=${TODAY}`));
  assert.equal(home.summaries.posts.total, 2);
  assert.equal(home.summaries.posts.mediaCount, 1);
  assert.ok(home.summaries.posts.latest.title, '应有最近一篇标题');
  assert.equal(home.summaries.albums.albumCount, 1);
  assert.equal(home.summaries.albums.photoCount, 2);
  assert.equal(home.recentPhotos.length, 2, '近期收藏应返回相册图片');
});

test('S7 · 尚未开始的计划不出现在首页今日计划里', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(
    await srv.post('/api/plans', {
      name: '未来计划',
      mode: 'check',
      cycleUnit: 'week',
      startDate: '2026-12-01',
    }),
  );

  const home = ok(await srv.get(`/api/home?date=${TODAY}`));
  assert.equal(home.today.length, 0, '未开始的计划不应出现在今日计划');
  assert.ok(home.reminder.message.includes('还没有正在进行'));
});

test('S7 · 已归档的计划不出现在首页', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { check } = await seed(srv);
  ok(await srv.post(`/api/plans/${check.plan.id}/archive`, { archived: true }));

  const home = ok(await srv.get(`/api/home?date=${TODAY}`));
  assert.equal(home.today.length, 1);
  assert.equal(home.today[0].name, '跑步');
});

test('S7 · 首页进度文案正确', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { check } = await seed(srv);

  let home = ok(await srv.get(`/api/home?date=${TODAY}`));
  assert.equal(home.summaries.plans.progressLabel, '完成 0/2');

  ok(await srv.post(`/api/plans/${check.plan.id}/checkin`, { date: TODAY }));
  home = ok(await srv.get(`/api/home?date=${TODAY}`));
  assert.equal(home.summaries.plans.progressLabel, '完成 1/2');

  const { quant } = { quant: home.today.find((x) => x.mode === 'quant') };
  ok(await srv.post(`/api/plans/${quant.id}/checkin`, { date: TODAY, value: 3 }));
  home = ok(await srv.get(`/api/home?date=${TODAY}`));
  assert.equal(home.summaries.plans.progressLabel, '完成 2/2');
});

test('S7 · 空数据时首页不报错，给出友好的空态', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const home = ok(await srv.get(`/api/home?date=${TODAY}`));
  assert.equal(home.today.length, 0);
  assert.equal(home.recentPhotos.length, 0);
  assert.equal(home.summaries.posts.total, 0);
  assert.equal(home.summaries.albums.albumCount, 0);
  assert.equal(home.summaries.plans.progressLabel, '暂无进行中的计划');
});

test('S7 · 删除文章后首页摘要同步减少', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const post = ok(await srv.post('/api/posts', { title: '待删', content: 'x', postDate: TODAY })).post;
  assert.equal(ok(await srv.get(`/api/home?date=${TODAY}`)).summaries.posts.total, 1);

  ok(await srv.del(`/api/posts/${post.id}`));
  assert.equal(ok(await srv.get(`/api/home?date=${TODAY}`)).summaries.posts.total, 0);
});
