/**
 * S1 基础设施测试。
 *
 * 验证：服务可启动、数据库与数据目录自动建立、设置读写、
 * 数据跨进程重启不丢、静态托管、错误处理、目录穿越防护。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer, ok, PUBLIC_DIR } from './helpers.js';
import { createApp, DB_FILENAME } from '../server/app.js';
import { loadConfig, DEFAULT_DATA_ROOT } from '../server/config.js';

test('S1 · 健康检查可用，报告数据目录与数据库路径', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const body = ok(await srv.get('/api/health'), '健康检查');
  assert.equal(body.ok, true);
  assert.equal(body.app, '茜色箱');
  assert.equal(body.dataRoot, srv.dataRoot);
  assert.ok(body.dbPath.endsWith(DB_FILENAME));
});

test('S1 · 启动时自动建立数据目录与分类文件夹', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  for (const dir of ['发布', '计划', '相册', '备份']) {
    const abs = path.join(srv.dataRoot, dir);
    assert.ok(fs.existsSync(abs), `应自动创建 ${dir} 目录`);
    assert.ok(fs.statSync(abs).isDirectory(), `${dir} 应是目录`);
  }
  assert.ok(fs.existsSync(path.join(srv.dataRoot, DB_FILENAME)), '数据库文件应存在');
});

test('S1 · 默认数据目录位于项目下的 data/', () => {
  assert.equal(loadConfig().dataRoot, DEFAULT_DATA_ROOT);
  assert.ok(DEFAULT_DATA_ROOT.endsWith(`${path.sep}data`), '默认数据目录应为项目下的 data/');
});

test('S1 · 设置读写生效，且默认值齐备', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const initial = ok(await srv.get('/api/settings')).settings;
  assert.equal(initial.theme, 'akane', '默认主题应为茜色');
  assert.equal(initial.backupTime, '23:30');
  assert.equal(initial.backupKeep, '30');
  assert.equal(initial.backupEnabled, 'true');

  ok(await srv.put('/api/settings', { theme: 'jade', backupKeep: '7' }));
  const after = ok(await srv.get('/api/settings')).settings;
  assert.equal(after.theme, 'jade');
  assert.equal(after.backupKeep, '7');
  assert.equal(after.backupTime, '23:30', '未修改的项应保持原值');
});

test('S1 · 非法设置被拒绝', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  assert.equal((await srv.put('/api/settings', { theme: '不存在的主题' })).status, 400);
  assert.equal((await srv.put('/api/settings', { backupTime: '25:99' })).status, 400);
  assert.equal((await srv.put('/api/settings', { backupKeep: '0' })).status, 400);
  assert.equal((await srv.put('/api/settings', { colorMode: 'rainbow' })).status, 400);
});

test('S1 · 数据跨进程重启不丢（关闭应用后重新打开同一数据目录）', async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-persist-'));

  const first = createApp({ dataRoot, staticDir: PUBLIC_DIR });
  first.ctx.setSettings({ theme: 'azure', backupTime: '08:15' });
  first.close();

  const second = createApp({ dataRoot, staticDir: PUBLIC_DIR });
  t.after(() => {
    second.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  const settings = second.ctx.getSettings();
  assert.equal(settings.theme, 'azure', '重启后主题应保留');
  assert.equal(settings.backupTime, '08:15', '重启后备份时间应保留');
});

test('S1 · 静态页面可访问，未知接口返回 404', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const page = await srv.get('/');
  assert.equal(page.status, 200);
  assert.ok(String(page.body).includes('茜色箱'), '首页应包含应用名');

  const css404 = await srv.get('/api/does-not-exist');
  assert.equal(css404.status, 404);
  assert.ok(css404.body.error, '错误响应应带 error 字段');
});

test('S1 · 非法 JSON 请求体返回 400 而不是崩溃', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = await fetch(`${srv.base}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '{ 这不是合法 JSON',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.includes('JSON'));

  // 服务应仍然存活
  assert.equal((await srv.get('/api/health')).status, 200);
});

test('S1 · 数据文件接口阻止目录穿越', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  // 用一个已知存在的文件做对照
  fs.writeFileSync(path.join(srv.dataRoot, 'probe.txt'), 'hello');

  const good = await srv.get('/files/probe.txt');
  assert.equal(good.status, 200);
  assert.equal(good.body, 'hello');

  const evil = await srv.get('/files/..%2F..%2Fpackage.json');
  assert.notEqual(evil.status, 200, '穿越路径不应返回成功');
});

test('S1 · 路由参数能正确解析（含中文）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  // 用 404 消息验证参数被解析出来（计划不存在时会报出 id）
  const res = await srv.get(`/api/plans/${encodeURIComponent('不存在的计划')}`);
  assert.equal(res.status, 404);
  assert.ok(String(res.body.error).includes('不存在的计划'), `错误信息应回显参数，实际：${res.body.error}`);
});
