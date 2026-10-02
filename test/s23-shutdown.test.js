/**
 * S23 停止服务测试。
 *
 * 以前"关掉那个黑窗口"就等于停服务；改成无窗口启动之后，必须另外给一个明确的停止入口。
 * 这一组盯三件事：
 *   1. 没有自定义请求头就停不了——否则浏览器里任何一个网页都能对着 localhost
 *      发一条请求把服务停掉；
 *   2. 响应要先发出去再退出——先退出的话调用方只会看到"连接被重置"，
 *      分不清是停成功了还是服务崩了；
 *   3. 停下之后端口真的释放了（不是"接口说停了、进程还占着"）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { startTestServer, ok, PUBLIC_DIR } from './helpers.js';
import { PROJECT_ROOT } from '../server/config.js';
import { SHUTDOWN_HEADER, SHUTDOWN_TOKEN } from '../server/constants.js';
import { healthAt } from '../server/launch.js';

/** 发一条停止请求（默认带上正确的请求头） */
function shutdownRequest(base, { headers = { [SHUTDOWN_HEADER]: SHUTDOWN_TOKEN } } = {}) {
  return fetch(`${base}/api/shutdown`, { method: 'POST', headers });
}

test('S23 · 缺少请求头时拒绝停止，服务照常运行', async (t) => {
  let stopped = 0;
  const srv = await startTestServer({ onShutdown: () => (stopped += 1) });
  t.after(() => srv.close());

  const res = await shutdownRequest(srv.base, { headers: {} });
  assert.equal(res.status, 403, '不带自定义请求头必须被拒绝');
  assert.equal(stopped, 0, '被拒绝时不该触发停止');

  // 服务还活着
  const health = ok(await srv.get('/api/health'));
  assert.equal(health.ok, true);
});

test('S23 · 请求头不对时同样拒绝', async (t) => {
  let stopped = 0;
  const srv = await startTestServer({ onShutdown: () => (stopped += 1) });
  t.after(() => srv.close());

  const res = await shutdownRequest(srv.base, { headers: { [SHUTDOWN_HEADER]: 'reboot' } });
  assert.equal(res.status, 403);
  assert.equal(stopped, 0);
});

test('S23 · 请求头正确时先把响应发回来，再执行停止', async (t) => {
  let stopped = 0;
  let srv;
  srv = await startTestServer({
    onShutdown: () => {
      stopped += 1;
      // 模拟真实的收尾：先关连接与数据库
      if (typeof srv.server.closeAllConnections === 'function') srv.server.closeAllConnections();
      srv.server.close();
      srv.app.close();
    },
  });
  t.after(() => {
    try {
      srv.app.close();
    } catch {
      /* 已经关了 */
    }
  });

  const res = await shutdownRequest(srv.base);
  // 如果实现是"先退出再回应"，这里拿到的会是连接错误而不是一个完整的 200
  assert.equal(res.status, 200, '应拿到完整的成功响应，而不是连接被重置');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.stopping, true);

  // 回调是在响应写完之后才跑的
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(stopped, 1, '停止动作应恰好执行一次');

  // 端口真的被放开了（不是"接口说停了、进程还占着"）
  const reuse = await new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(srv.port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
  assert.equal(reuse, true, '停止后端口应可被重新使用');
});

test('S23 · 不支持停止的运行方式要明确报错，而不是假装成功', async (t) => {
  // 测试实例默认没有 onShutdown：这是"被当作库使用"的情形
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = await shutdownRequest(srv.base);
  assert.equal(res.status, 501, '拿不出停止能力时应明确说"这个运行方式不支持"');
});

test('S23 · 设置页的停止按钮：带请求头、先确认、并立刻把状态灯切过去', () => {
  const source = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'pages', 'settings.js'), 'utf8');

  assert.match(source, /data-stop-service/, '设置页应有停止服务的按钮');
  assert.match(source, /confirmDialog/, '停止是不可逆操作，必须先二次确认');
  assert.match(source, /api\.shutdown\(\)/, '按钮应真的调用停止接口');

  const api = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'api.js'), 'utf8');
  assert.match(
    api,
    /X-Duskbox-Action/,
    '停止请求必须带上自定义请求头，否则服务端一律拒绝',
  );

  // 静态资源与后端常量必须是同一个头名字：两边写岔了就是"点了没反应"
  assert.ok(
    api.toLowerCase().includes(SHUTDOWN_HEADER),
    `前端带的头名应与服务端常量一致（${SHUTDOWN_HEADER}）`,
  );
  assert.ok(api.includes(SHUTDOWN_TOKEN), `前端带的头值应与服务端常量一致（${SHUTDOWN_TOKEN}）`);
});

test('S23 · 启动入口把停止能力接上了（不是只写了接口没人用）', () => {
  const index = fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'index.js'), 'utf8');
  assert.match(index, /onShutdown/, 'server/index.js 应把 onShutdown 交给应用装配层');
});

test('S23 · 真实进程：点了停止，进程真的在几秒内退出', async (t) => {
  // 这条是"接口能跑"与"服务真的会停"的分界线。
  // 前面的用例都是拿内存里的实例验证行为，这一条起一个真正的服务进程。
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port: p } = s.address();
      s.close(() => resolve(p));
    });
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-shutdown-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-shutdown-cfg-'));
  const cfgFile = path.join(cfgDir, 'config.json');
  fs.writeFileSync(
    cfgFile,
    JSON.stringify({ dataRoot: path.join(root, 'data'), port }, null, 2),
    'utf8',
  );

  const child = spawn(process.execPath, [path.join(PROJECT_ROOT, 'server', 'index.js')], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, QSX_NO_OPEN: '1', QSX_CONFIG_FILE: cfgFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });

  const exited = new Promise((resolve) => child.once('exit', resolve));

  // 等服务起来
  const begin = Date.now();
  let health = null;
  while (Date.now() - begin < 20000) {
    health = await healthAt(port);
    if (health) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(health, '服务应能正常启动');

  const res = await shutdownRequest(`http://127.0.0.1:${port}`);
  assert.equal(res.status, 200);

  const code = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 6000)),
  ]);
  assert.notEqual(code, 'TIMEOUT', '发出停止请求后进程应在 6 秒内退出');

  for (const dir of [root, cfgDir]) {
    for (let i = 0; i < 20; i += 1) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
});
