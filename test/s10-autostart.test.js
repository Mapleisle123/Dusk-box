/**
 * S10 开机自启测试。
 *
 * 这一组测试守的是一条规则：
 *   **开机自启的真相在「启动」文件夹里的快捷方式上，不在数据库里。**
 *
 * 因此重点验证三件事：
 *   1. 开关真的能在磁盘上建出/删掉快捷方式；
 *   2. 建出来的快捷方式确实指向「茜色箱启动.bat」（与两个 .bat 脚本等效）；
 *   3. 别人（手动双击 bat）放进去的快捷方式，应用也能识别出来——
 *      这正是"界面开关"与"手动点 bat"两种方式并存的关键。
 *
 * 用 QSX_STARTUP_DIR 把启动文件夹重定向到临时目录，
 * 确保测试**不会**往用户真实的开机项里写东西。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const startupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-startup-'));
process.env.QSX_STARTUP_DIR = startupRoot;

const { startTestServer, ok } = await import('./helpers.js');
const { SHORTCUT_NAME, launcherPath } = await import('../server/autostart.js');

const IS_WINDOWS = process.platform === 'win32';
const linkPath = () => path.join(startupRoot, SHORTCUT_NAME);

test.after(() => {
  delete process.env.QSX_STARTUP_DIR;
  fs.rmSync(startupRoot, { recursive: true, force: true });
});

/** 清空启动文件夹，让每个测试从干净状态开始 */
function resetStartupDir() {
  fs.rmSync(startupRoot, { recursive: true, force: true });
  fs.mkdirSync(startupRoot, { recursive: true });
}

/**
 * 把真实生成的快捷方式读回来（走 WScript.Shell，与用户双击时系统读的是同一份数据）。
 *
 * 结果通过「写文件再读」传递，避免控制台代码页把中文路径转坏。
 */
function readShortcut(lnk) {
  const outFile = path.join(startupRoot, `_probe-${Date.now()}.txt`);
  const script = [
    '$ws = New-Object -ComObject WScript.Shell',
    '$sc = $ws.CreateShortcut($env:QSX_LNK)',
    '(@($sc.TargetPath, $sc.WorkingDirectory, $sc.WindowStyle) -join "|") | Out-File -Encoding utf8 $env:QSX_OUT',
  ].join('; ');
  execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-Command', script],
    { env: { ...process.env, QSX_LNK: lnk, QSX_OUT: outFile }, windowsHide: true },
  );
  const raw = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '').trim();
  fs.rmSync(outFile, { force: true });
  const [target, workingDir, windowStyle] = raw.split('|');
  return { target, workingDir, windowStyle };
}

// ---------------------------------------------------------------------------
// 状态读取
// ---------------------------------------------------------------------------

test('S10 · 未设置时，开机自启为关闭', async (t) => {
  resetStartupDir();
  const srv = await startTestServer();
  t.after(() => srv.close());

  const body = ok(await srv.get('/api/autostart'));
  assert.equal(body.enabled, false);
  assert.equal(body.linkPath, linkPath(), '应报告被重定向后的快捷方式位置');
  if (IS_WINDOWS) assert.equal(body.supported, true);
});

test('S10 · 开关状态取自快捷方式，而不是数据库里的值', async (t) => {
  resetStartupDir();
  const srv = await startTestServer();
  t.after(() => srv.close());

  // 直接在数据库里把 autoStart 写成 true，但磁盘上并没有快捷方式
  const { setSetting } = await import('../server/db.js');
  setSetting(srv.app.db, 'autoStart', 'true');
  assert.equal(
    ok(await srv.get('/api/settings')).settings.autoStart,
    'true',
    '数据库里的值确实被改成了 true',
  );

  const body = ok(await srv.get('/api/autostart'));
  assert.equal(body.enabled, false, '没有快捷方式就应该报告未开启，不能被数据库的值骗到');
});

test('S10 · 设置接口不再接受伪造开机自启开关', async (t) => {
  resetStartupDir();
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = await srv.put('/api/settings', { autoStart: 'true' });
  assert.equal(res.status, 400, 'autoStart 已改为由 /api/autostart 管理，不该能从这里写入');
  assert.equal(ok(await srv.get('/api/autostart')).enabled, false);
});

// ---------------------------------------------------------------------------
// 真正建立 / 移除快捷方式
// ---------------------------------------------------------------------------

test('S10 · 开启后真的在启动文件夹生成快捷方式，且指向启动脚本', { skip: !IS_WINDOWS }, async (t) => {
  resetStartupDir();
  const srv = await startTestServer();
  t.after(() => srv.close());

  const body = ok(await srv.put('/api/autostart', { enabled: true }));

  assert.equal(body.enabled, true, '接口应回报已开启');
  assert.ok(fs.existsSync(linkPath()), '启动文件夹里应真的出现快捷方式文件');
  assert.ok(fs.statSync(linkPath()).size > 0, '快捷方式不该是空文件');

  // 把快捷方式读回来，证明它确实指向那个 .bat，且工作目录正确
  const sc = readShortcut(linkPath());
  assert.equal(
    path.resolve(sc.target),
    path.resolve(launcherPath()),
    '快捷方式应指向「茜色箱启动.bat」——与手动双击安装脚本的效果一致',
  );
  assert.equal(path.resolve(sc.workingDir), path.resolve(path.dirname(launcherPath())));
  assert.equal(sc.windowStyle, '7', '应为最小化启动（7），否则开机时会弹出一个黑窗口');
});

test('S10 · 重复开启是幂等的，不会报错', { skip: !IS_WINDOWS }, async (t) => {
  resetStartupDir();
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.put('/api/autostart', { enabled: true }));
  const second = ok(await srv.put('/api/autostart', { enabled: true }));
  assert.equal(second.enabled, true);
  assert.ok(fs.existsSync(linkPath()));
});

test('S10 · 关闭后快捷方式被删除', { skip: !IS_WINDOWS }, async (t) => {
  resetStartupDir();
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.put('/api/autostart', { enabled: true }));
  assert.ok(fs.existsSync(linkPath()));

  const body = ok(await srv.put('/api/autostart', { enabled: false }));
  assert.equal(body.enabled, false);
  assert.equal(fs.existsSync(linkPath()), false, '快捷方式应已被删除');
});

test('S10 · 关闭时不依赖 PowerShell（快捷方式不存在也能安全关闭）', async (t) => {
  resetStartupDir();
  const srv = await startTestServer();
  t.after(() => srv.close());

  const body = ok(await srv.put('/api/autostart', { enabled: false }));
  assert.equal(body.enabled, false, '本来就没开，关闭应当是安全的空操作');
});

// ---------------------------------------------------------------------------
// 两种方式并存：手动点 bat 的结果也要认
// ---------------------------------------------------------------------------

test('S10 · 手动双击 bat 放进去的快捷方式，界面也能识别为已开启', async (t) => {
  resetStartupDir();
  const srv = await startTestServer();
  t.after(() => srv.close());

  // 模拟用户手动双击「安装开机自启.bat」：启动文件夹里多了一个快捷方式
  fs.writeFileSync(path.join(startupRoot, SHORTCUT_NAME), 'manual');

  assert.equal(
    ok(await srv.get('/api/autostart')).enabled,
    true,
    '手动设置的快捷方式必须被识别，否则两种方式会各说各话',
  );

  // 并且界面上的开关也能把它关掉（= 等效于双击「取消开机自启.bat」）
  const off = ok(await srv.put('/api/autostart', { enabled: false }));
  assert.equal(off.enabled, false);
  assert.equal(fs.existsSync(path.join(startupRoot, SHORTCUT_NAME)), false);
});

test('S10 · 设置页拿到的运行期信息里也带着真实的开机自启状态', async (t) => {
  resetStartupDir();
  const srv = await startTestServer();
  t.after(() => srv.close());

  assert.equal(ok(await srv.get('/api/settings')).runtime.autoStart.enabled, false);
  ok(await srv.put('/api/autostart', { enabled: true }));
  assert.equal(
    ok(await srv.get('/api/settings')).runtime.autoStart.enabled,
    true,
    '两个接口报告的应是同一份真实状态',
  );
});

// ---------------------------------------------------------------------------
// 参数校验
// ---------------------------------------------------------------------------

test('S10 · 参数必须是布尔值', async (t) => {
  resetStartupDir();
  const srv = await startTestServer();
  t.after(() => srv.close());

  assert.equal((await srv.put('/api/autostart', { enabled: 'yes' })).status, 400);
  assert.equal((await srv.put('/api/autostart', {})).status, 400);
  assert.equal((await srv.put('/api/autostart', { enabled: 1 })).status, 400);
});
