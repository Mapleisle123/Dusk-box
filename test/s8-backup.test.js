/**
 * S8 备份与恢复测试。
 *
 * 这是"数据不会丢"这条承诺的最后一道防线，因此验证要严格：
 *   - 备份内容是否完整（数据库 + 分类文件）
 *   - 恢复是否真的把数据还原回去（包括被误删的图片）
 *   - 恢复后服务是否仍可用（数据库句柄是否正确重开）
 *   - 定时备份的触发条件是否正确
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, ok, makePng } from './helpers.js';
import { maybeRunScheduledBackup, backupStamp } from '../server/backup.js';

const TODAY = '2026-09-23';

/** 造一批数据用于备份/恢复测试 */
async function seed(srv) {
  const post = (
    await srv.postForm(
      '/api/posts',
      { title: '备份测试文章', content: '这段内容必须能被恢复', postDate: TODAY },
      [{ name: 'pic.png', buffer: makePng(5, 5) }],
    )
  ).body.post;

  const album = ok(await srv.post('/api/albums', { name: '备份相册' }));
  await srv.postForm(`/api/albums/${album.id}/photos`, {}, [
    { name: 'leaf.png', buffer: makePng(5, 5) },
  ]);

  const plan = ok(
    await srv.post('/api/plans', {
      name: '备份计划',
      mode: 'quant',
      targetValue: 3,
      unit: '次',
      cycleUnit: 'week',
      startDate: TODAY,
    }),
  );
  ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: TODAY, value: 2 }));

  return { post, album, plan };
}

test('S8 · 备份会生成完整目录：数据库 + 分类文件 + 清单', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  await seed(srv);

  const res = ok(await srv.post('/api/backups', { reason: 'manual' }));
  const backup = res.backup;

  assert.ok(backup.name.match(/^\d{4}-\d{2}-\d{2}_\d{6}/), `时间戳命名不对：${backup.name}`);
  assert.equal(backup.reason, 'manual');
  assert.ok(backup.dbBytes > 0, '数据库应有内容');
  assert.ok(backup.fileCount > 0, '应备份到分类文件');

  const rel = `${backup.relDir}`;
  assert.ok(srv.existsData(`${rel}/茜色箱.db`), '备份里应有数据库');
  assert.ok(srv.existsData(`${rel}/manifest.json`), '备份里应有清单');
  assert.ok(srv.existsData(`${rel}/发布/2026/2026-09-23 备份测试文章.md`), '备份里应有文章');
  assert.ok(srv.existsData(`${rel}/相册/备份相册/leaf.png`), '备份里应有相册图片');

  const manifest = JSON.parse(srv.readDataFile(`${rel}/manifest.json`));
  assert.equal(manifest.app, '茜色箱');
  assert.ok(manifest.createdAt);
});

test('S8 · 备份列表按时间倒序，信息完整', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  await srv.post('/api/backups', {});
  await new Promise((r) => setTimeout(r, 1100)); // 让时间戳不同
  await srv.post('/api/backups', {});

  const { backups } = ok(await srv.get('/api/backups'));
  assert.equal(backups.length, 2);
  assert.ok(backups[0].name > backups[1].name, '新的应排前面');
  assert.equal(backups[0].hasDb, true);
  assert.ok(backups[0].totalBytes > 0);
});

test('S8 · 同一秒内连续备份不会互相覆盖', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const a = ok(await srv.post('/api/backups', {})).backup;
  const b = ok(await srv.post('/api/backups', {})).backup;
  assert.notEqual(a.name, b.name, '同名时间戳应自动加序号');
  assert.ok(srv.existsData(a.relDir) && srv.existsData(b.relDir));
});

test('S8 · 恢复能把改动过的数据还原回去', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { post } = await seed(srv);
  const backup = ok(await srv.post('/api/backups', {})).backup;

  // 备份后再做破坏性修改
  ok(await srv.put(`/api/posts/${post.id}`, { title: '被改坏的标题', content: '内容也被换了' }));
  ok(await srv.del(`/api/posts/${post.id}`));
  ok(await srv.post('/api/posts', { title: '备份之后新增的', content: '应该消失', postDate: TODAY }));

  assert.equal(ok(await srv.get('/api/posts')).total, 1, '此时只剩新增那篇');

  // 恢复
  const restored = ok(await srv.post('/api/backups/restore', { name: backup.name }));
  assert.equal(restored.ok, true);
  assert.equal(restored.restoredFrom, backup.name);

  // 恢复后：被删的文章回来了，新增的消失了
  const list = ok(await srv.get('/api/posts'));
  assert.equal(list.total, 1);
  assert.equal(list.items[0].title, '备份测试文章');
  assert.equal(list.items[0].content, '这段内容必须能被恢复');
});

test('S8 · 恢复后服务仍然可用（数据库句柄已正确重开）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  await seed(srv);
  const backup = ok(await srv.post('/api/backups', {})).backup;

  ok(await srv.post('/api/backups/restore', { name: backup.name }));

  // 恢复后各项功能必须照常工作
  assert.equal((await srv.get('/api/health')).status, 200);
  assert.equal((await srv.get('/api/settings')).status, 200);

  const created = ok(await srv.post('/api/posts', { title: '恢复之后写的', content: 'x', postDate: TODAY }));
  assert.ok(created.post.id);
  assert.equal(ok(await srv.get('/api/posts')).total, 2);

  const plan = ok(await srv.post('/api/plans', { name: '恢复后新建', mode: 'check', cycleUnit: 'week', startDate: TODAY }));
  ok(await srv.post(`/api/plans/${plan.plan.id}/checkin`, { date: TODAY }));
  assert.equal(ok(await srv.get(`/api/plans/${plan.plan.id}?date=${TODAY}`)).checkToday, true);
});

test('S8 · 恢复能找回被误删的图片文件', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { album } = await seed(srv);
  const backup = ok(await srv.post('/api/backups', {})).backup;

  // 模拟用户手动把相册文件夹删了
  fs.rmSync(path.join(srv.dataRoot, '相册', '备份相册'), { recursive: true, force: true });
  assert.equal(srv.existsData('相册/备份相册/leaf.png'), false);

  ok(await srv.post('/api/backups/restore', { name: backup.name }));

  assert.ok(srv.existsData('相册/备份相册/leaf.png'), '图片应被恢复');
  const img = await srv.get('/files/相册/备份相册/leaf.png');
  assert.equal(img.status, 200, '恢复后图片应可访问');
  const detail = ok(await srv.get(`/api/albums/${album.id}`));
  assert.equal(detail.photoCount, 1);
});

test('S8 · 恢复参数校验：不存在的备份、非法名称', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  assert.equal((await srv.post('/api/backups/restore', {})).status, 400);

  const missing = await srv.post('/api/backups/restore', { name: '2020-01-01_000000' });
  assert.equal(missing.status, 404);

  // 目录穿越尝试
  const evil = await srv.post('/api/backups/restore', { name: '../../etc' });
  assert.ok([400, 404].includes(evil.status), '穿越路径不应成功');
});

test('S8 · 保留份数生效，旧备份被自动清理', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.put('/api/settings', { backupKeep: '2' }));

  for (let i = 0; i < 4; i += 1) {
    ok(await srv.post('/api/backups', {}));
    await new Promise((r) => setTimeout(r, 1100));
  }

  const { backups } = ok(await srv.get('/api/backups'));
  assert.equal(backups.length, 2, `应只保留 2 份，实际 ${backups.length}`);
});

test('S8 · 可手动删除某个备份', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const backup = ok(await srv.post('/api/backups', {})).backup;
  ok(await srv.del(`/api/backups/${backup.name}`));
  assert.equal(srv.existsData(backup.relDir), false);
  assert.equal(ok(await srv.get('/api/backups')).backups.length, 0);
});

test('S8 · 定时备份：到点且今天未备份才执行', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  // 设定备份时间为 03:30，且今天尚未备份
  ok(await srv.put('/api/settings', { backupEnabled: 'true', backupTime: '03:30' }));
  srv.ctx.setSetting('lastBackupAt', '');

  const atSlot = new Date(2026, 8, 23, 3, 30, 0);
  const result = await maybeRunScheduledBackup(srv.ctx, atSlot);
  assert.ok(result, '到点应执行备份');
  assert.equal(result.reason, 'auto');

  // 同一天再跑一次：应跳过
  const again = await maybeRunScheduledBackup(srv.ctx, new Date(2026, 8, 23, 3, 31, 0));
  assert.equal(again, null, '同一天不应重复备份');

  // 换一天：应再次执行
  const nextDay = await maybeRunScheduledBackup(srv.ctx, new Date(2026, 8, 24, 3, 30, 0));
  assert.ok(nextDay, '第二天应再次备份');
});

test('S8 · 定时备份：未到时间点不执行', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.put('/api/settings', { backupEnabled: 'true', backupTime: '23:30' }));
  srv.ctx.setSetting('lastBackupAt', '');

  const result = await maybeRunScheduledBackup(srv.ctx, new Date(2026, 8, 23, 12, 0, 0));
  assert.equal(result, null, '未到设定时间不应备份');
});

test('S8 · 定时备份：关闭开关后不执行', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.put('/api/settings', { backupEnabled: 'false', backupTime: '03:30' }));
  srv.ctx.setSetting('lastBackupAt', '');

  const result = await maybeRunScheduledBackup(srv.ctx, new Date(2026, 8, 23, 3, 30, 0));
  assert.equal(result, null, '开关关闭时不应备份');
});

test('S8 · 自动备份会记录 lastBackupAt', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.put('/api/settings', { backupEnabled: 'true', backupTime: '03:30' }));
  srv.ctx.setSetting('lastBackupAt', '');

  await maybeRunScheduledBackup(srv.ctx, new Date(2026, 8, 23, 3, 30, 0));

  const settings = ok(await srv.get('/api/settings')).settings;
  assert.ok(settings.lastBackupAt.startsWith('2026-09-23'), `实际：${settings.lastBackupAt}`);
});

test('S8 · 备份时间戳格式正确', () => {
  const stamp = backupStamp(new Date(2026, 8, 23, 23, 30, 5));
  assert.equal(stamp, '2026-09-23_233005');
});

test('S8 · 备份与恢复跨重启仍可用', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'qsx-backup-restart-'));

  const srv = await startTestServer({ dataRoot });
  await seed(srv);
  const backup = ok(await srv.post('/api/backups', {})).backup;
  ok(await srv.del(`/api/posts/1`));
  await srv.close();

  // 重启后备份列表与恢复能力都应还在
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

  const { backups } = ok(await srv2.get('/api/backups'));
  assert.equal(backups.length, 1);
  assert.equal(backups[0].name, backup.name);

  ok(await srv2.post('/api/backups/restore', { name: backup.name }));
  assert.equal(ok(await srv2.get('/api/posts')).total, 1, '重启后恢复依然有效');
});
