/**
 * S6 设置模块测试。
 *
 * 覆盖：主题与备份配置的读写、参数校验、数据目录迁移。
 * 注意：通过 QSX_CONFIG_FILE 把配置文件指向临时位置，
 * 避免测试污染用户真实的 config.json。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 必须在任何配置读写发生之前设置
const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-cfg-'));
process.env.QSX_CONFIG_FILE = path.join(configHome, 'config.json');

const { startTestServer, ok, makePng } = await import('./helpers.js');
const { THEMES } = await import('../server/routes/settings.js');

test.after(() => {
  delete process.env.QSX_CONFIG_FILE;
  fs.rmSync(configHome, { recursive: true, force: true });
});

test('S6 · 读取设置时同时返回运行期信息', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const body = ok(await srv.get('/api/settings'));
  assert.ok(body.settings, '应返回设置');
  assert.equal(body.runtime.dataRoot, srv.dataRoot);
  assert.ok(body.runtime.dbPath.endsWith('茜色箱.db'));
  assert.deepEqual(body.runtime.themes, THEMES, '应返回可选主题列表');
  assert.ok(body.runtime.projectRoot, '应返回项目根目录');
});

test('S6 · 主题主色调可在预设之间切换', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  for (const theme of THEMES) {
    const res = ok(await srv.put('/api/settings', { theme }));
    assert.equal(res.settings.theme, theme);
  }

  const persisted = ok(await srv.get('/api/settings')).settings;
  assert.equal(persisted.theme, THEMES[THEMES.length - 1]);
});

test('S6 · 深浅色模式切换', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  assert.equal(ok(await srv.put('/api/settings', { colorMode: 'dark' })).settings.colorMode, 'dark');
  assert.equal(ok(await srv.put('/api/settings', { colorMode: 'light' })).settings.colorMode, 'light');
});

test('S6 · 备份配置可修改并校验', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = ok(
    await srv.put('/api/settings', {
      backupEnabled: 'false',
      backupTime: '07:05',
      backupKeep: '14',
    }),
  );
  assert.equal(res.settings.backupEnabled, 'false');
  assert.equal(res.settings.backupTime, '07:05');
  assert.equal(res.settings.backupKeep, '14');

  assert.equal((await srv.put('/api/settings', { backupTime: '7:5' })).status, 400);
  assert.equal((await srv.put('/api/settings', { backupTime: '24:00' })).status, 400);
  assert.equal((await srv.put('/api/settings', { backupKeep: '999' })).status, 400);
  assert.equal((await srv.put('/api/settings', { backupKeep: 'abc' })).status, 400);
  assert.equal((await srv.put('/api/settings', { backupEnabled: 'maybe' })).status, 400);
});

test('S6 · 不可修改的字段被忽略', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = ok(await srv.put('/api/settings', { 恶意字段: 'x', lastBackupAt: '伪造', theme: 'jade' }));
  assert.equal(res.settings.theme, 'jade');
  assert.equal(res.settings['恶意字段'], undefined, '未知字段不应被写入');
  assert.notEqual(res.settings.lastBackupAt, '伪造', 'lastBackupAt 不应可被外部改写');
});

test('S6 · 空更新被拒绝', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  const res = await srv.put('/api/settings', { 无关字段: 1 });
  assert.equal(res.status, 400);
});

test('S6 · 数据目录变更：参数校验', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  assert.equal((await srv.put('/api/settings/data-root', { dataRoot: '' })).status, 400);

  const relative = await srv.put('/api/settings/data-root', { dataRoot: 'my-data' });
  assert.equal(relative.status, 400);
  assert.ok(String(relative.body.error).includes('绝对路径'));
});

test('S6 · 数据目录变更：目标目录非空且要求迁移时被拒绝', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const occupied = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-occupied-'));
  fs.writeFileSync(path.join(occupied, 'already-here.txt'), 'x');
  t.after(() => fs.rmSync(occupied, { recursive: true, force: true }));

  const res = await srv.put('/api/settings/data-root', { dataRoot: occupied });
  assert.equal(res.status, 400);
  assert.ok(String(res.body.error).includes('不为空'));
});

test('S6 · 数据目录变更：会迁移数据并写入配置', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  // 先制造一些真实数据
  await srv.postForm(
    '/api/posts',
    { title: '迁移前', content: '这段内容应该被搬过去', postDate: '2026-09-23' },
    [{ name: 'a.png', buffer: makePng(4, 4) }],
  );
  ok(await srv.post('/api/albums', { name: '迁移相册' }));

  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-newroot-')), '茜色箱数据');
  t.after(() => fs.rmSync(path.dirname(target), { recursive: true, force: true }));

  const res = ok(await srv.put('/api/settings/data-root', { dataRoot: target }));

  assert.equal(res.changed, true);
  assert.equal(res.needsRestart, true);
  assert.equal(res.migrated, true);
  assert.equal(res.dataRoot, path.resolve(target));

  // 数据库与分类目录都被搬过去了
  assert.ok(fs.existsSync(path.join(target, '茜色箱.db')), '数据库应被迁移');
  assert.ok(
    fs.existsSync(path.join(target, '发布', '2026', '2026-09-23 迁移前.md')),
    '文章文件应被迁移',
  );
  assert.ok(fs.existsSync(path.join(target, '相册', '迁移相册')), '相册文件夹应被迁移');

  const migrated = fs.readFileSync(
    path.join(target, '发布', '2026', '2026-09-23 迁移前.md'),
    'utf8',
  );
  assert.ok(migrated.includes('这段内容应该被搬过去'), '内容应完整迁移');

  // 配置文件已更新
  const config = JSON.parse(fs.readFileSync(process.env.QSX_CONFIG_FILE, 'utf8'));
  assert.equal(config.dataRoot, path.resolve(target));
});

test('S6 · 数据目录设为当前目录时不触发迁移', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = ok(await srv.put('/api/settings/data-root', { dataRoot: srv.dataRoot }));
  assert.equal(res.changed, false);
  assert.equal(res.dataRoot, srv.dataRoot);
});

test('S6 · 设置变更在重启后保留', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const os2 = await import('node:os');
  const path2 = await import('node:path');
  const dataRoot = mkdtempSync(path2.join(os2.tmpdir(), 'qsx-set-restart-'));

  const srv = await startTestServer({ dataRoot });
  ok(await srv.put('/api/settings', { theme: 'violet', backupTime: '06:30', backupKeep: '5' }));
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

  const settings = ok(await srv2.get('/api/settings')).settings;
  assert.equal(settings.theme, 'violet', '重启后主题应保留');
  assert.equal(settings.backupTime, '06:30');
  assert.equal(settings.backupKeep, '5');
});
