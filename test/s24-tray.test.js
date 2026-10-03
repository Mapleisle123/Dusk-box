/**
 * S24 托盘图标测试。
 *
 * 托盘是这一版里唯一"只能靠眼睛验收"的地方（Windows 通知区域里的图标没法在测试里点），
 * 但真正容易出错的部分是可以自动测的：
 *   - 脚本的字节形态（UTF-8 带 BOM + CRLF）——存错了整条菜单会变成一串问号；
 *   - 找端口的那段逻辑（服务降级后还找不找得到、没在跑时会不会乱指）；
 *   - 界面（图标 + 菜单）到底建不建得出来；
 *   - 启动器会不会记得把它拉起来。
 *
 * 剩下真正要人看的只有两件事：图标长得对不对、点击菜单的反应对不对，
 * 那部分写在 README 的人工验收清单里。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { PROJECT_ROOT } from '../server/config.js';
import { healthAt, main, startTray, trayScriptPath } from '../server/launch.js';
import { startTestServer } from './helpers.js';

/** 托盘只在 Windows 上存在 */
const onWindows = process.platform === 'win32';

/** 跑一次托盘脚本的某个开关模式，返回 {status, stdout} */
function runTray(args, env = {}) {
  return spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Sta', '-File', trayScriptPath(), ...args],
    { cwd: PROJECT_ROOT, env: { ...process.env, ...env }, encoding: 'utf8' },
  );
}

/** 造一个临时配置 */
function tempConfig(dataRoot, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-tray-cfg-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ dataRoot, port }, null, 2), 'utf8');
  return { dir, file };
}

/** 找一个空闲端口 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

test('S24 · 托盘脚本必须是 UTF-8 带 BOM + CRLF，否则中文菜单会变成问号', () => {
  const file = trayScriptPath();
  assert.ok(fs.existsSync(file), '应存在 launcher/tray.ps1');

  const buf = fs.readFileSync(file);
  assert.ok(
    buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf,
    '必须以 UTF-8 BOM 开头（PowerShell 5.1 读无 BOM 的 UTF-8 会把中文读成乱码）',
  );

  let cr = 0;
  let lf = 0;
  for (const b of buf) {
    if (b === 0x0d) cr += 1;
    else if (b === 0x0a) lf += 1;
  }
  assert.ok(cr > 0, '应使用 CRLF 行尾');
  assert.equal(cr, lf, `CR 与 LF 数量应相等（当前 CR=${cr} LF=${lf}）`);

  // 用 UTF-8 解出来必须是能读的中文，而不是乱码
  const text = buf.toString('utf8');
  assert.match(text, /打开界面/, '菜单里应有「打开界面」');
  assert.match(text, /停止服务/, '菜单里应有「停止服务」');
  assert.match(text, /DuskBoxTray/, '应有单例互斥体，避免出现两个托盘图标');
  assert.match(text, /X-DuskBox-Action/, '停止服务要带上服务端要求的自定义请求头');
  assert.match(text, /logo\.jpg/, '图标应由现有 logo 现算，而不是另存一份 .ico');
});

test(
  'S24 · 单独的探针模式：能找到在跑的服务端口（含端口降级）',
  { skip: !onWindows ? '仅适用于 Windows' : false },
  async (t) => {
    const port = await freePort();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-tray-probe-'));
    const dataRoot = path.join(root, 'data');
    const runCfg = tempConfig(dataRoot, port);
    // 探针看到的配置里写小一号的端口，真实服务在 port 上：
    // 这正是"端口被占后自动后退"的现场，只探配置端口会误判成没在跑
    const probeCfg = tempConfig(dataRoot, port - 1);

    // 起一个**真实的服务进程**，而不是测试进程内部的那个实例。
    // 托盘在真实场景下面向的永远是另一个进程，这样测才是照着实际的样子测
    // （有些受限的执行环境里，子进程根本连不到父进程监听的端口）。
    const server = spawn(process.execPath, [path.join(PROJECT_ROOT, 'server', 'index.js')], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, QSX_NO_OPEN: '1', QSX_NO_TRAY: '1', QSX_CONFIG_FILE: runCfg.file },
      stdio: 'ignore',
    });
    let serverPid = null;

    // 收尾顺序不能颠倒：先关进程、等它真的退出，再删临时目录。
    // 进程还占着数据目录时删目录会直接 EPERM，测试就会以一条莫名其妙的
    // "Permission denied" 报错收场。
    t.after(async () => {
      if (serverPid) {
        try {
          process.kill(serverPid);
        } catch {
          /* 已经退出 */
        }
      }
      if (server.exitCode === null) server.kill();
      if (server.exitCode === null) {
        await new Promise((resolve) => {
          const to = setTimeout(resolve, 3000);
          to.unref();
          server.once('exit', () => {
            clearTimeout(to);
            resolve();
          });
        });
      }
      for (const target of [root, runCfg.dir, probeCfg.dir]) {
        for (let i = 0; i < 20; i += 1) {
          try {
            fs.rmSync(target, { recursive: true, force: true });
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      }
    });

    // 等服务真的起来
    const begin = Date.now();
    let health = null;
    while (Date.now() - begin < 20000) {
      health = await healthAt(port);
      if (health) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(health, '测试准备：服务进程应能启动');
    serverPid = health.pid;

    const res = runTray(['-Probe'], { QSX_CONFIG_FILE: probeCfg.file });
    assert.equal(res.status, 0, `探针应正常退出：${res.stderr}`);
    assert.equal(
      res.stdout.trim(),
      String(port),
      `应报出真实在跑的那个端口（${port}），而不是配置里写的那个（${port - 1}）`,
    );
  },
);

test(
  'S24 · 服务没在跑时，探针报 0（不能乱指一个端口）',
  { skip: !onWindows ? '仅适用于 Windows' : false },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-tray-none-'));
    t.after(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    // 并行跑全量测试时，隔壁用例的服务可能正好落在扫描范围里，被探针认出来——
    // 那是环境噪声（茜色箱的实例长得都一样），不是规则错了。
    // 所以换几段端口重试，只要有一次干干净净地报 0 即可。
    let out = '';
    for (let i = 0; i < 4; i += 1) {
      const port = await freePort();
      const cfg = tempConfig(path.join(root, 'data'), port);
      const res = runTray(['-Probe'], { QSX_CONFIG_FILE: cfg.file });
      assert.equal(res.status, 0, `探针应正常退出：${res.stderr}`);
      out = res.stdout.trim();
      fs.rmSync(cfg.dir, { recursive: true, force: true });
      if (out === '0') break;
    }
    assert.equal(out, '0', '没有服务时应报 0');
  },
);

test(
  'S24 · 图标与菜单真的建得出来（把 logo 变成托盘图标、中文菜单不变形）',
  { skip: !onWindows ? '仅适用于 Windows' : false },
  () => {
    const res = runTray(['-SelfTest']);
    assert.equal(res.status, 0, `自检应通过：${res.stderr}`);
    assert.match(res.stdout, /ok icon=True/, `自检应报告图标已建好：${res.stdout}`);
    assert.match(res.stdout, /打开界面/, '菜单里应有「打开界面」');
    assert.match(res.stdout, /停止服务/, '菜单里应有「停止服务」');
  },
);

test('S24 · 启动器会顺手把托盘拉起来，且测试环境里不拉（不在用户桌面留图标）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const cfg = tempConfig(srv.dataRoot, srv.port);
  t.after(() => fs.rmSync(cfg.dir, { recursive: true, force: true }));

  const saved = process.env.QSX_CONFIG_FILE;
  process.env.QSX_CONFIG_FILE = cfg.file;
  t.after(() => {
    if (saved === undefined) delete process.env.QSX_CONFIG_FILE;
    else process.env.QSX_CONFIG_FILE = saved;
  });

  // 用替身记录"到底有没有去拉托盘"，避免测试真的弹出一个小图标
  const calls = [];
  await main({
    env: { ...process.env, QSX_NO_OPEN: '1' },
    startTray: (env) => calls.push(env),
  });
  assert.equal(calls.length, 1, '启动器应把托盘拉起来（否则就没有停止服务的入口了）');

  calls.length = 0;
  await main({
    env: { ...process.env, QSX_NO_OPEN: '1', QSX_NO_TRAY: '1' },
    startTray: (env) => calls.push(env),
  });
  assert.equal(calls.length, 1, '是否跳过托盘由 startTray 自己判断（它认 QSX_NO_TRAY）');
});

test('S24 · QSX_NO_TRAY=1 时真的不会起托盘进程', () => {
  // 盯的是"测试不该在用户右下角留图标"这件事本身：开关一给就不许起进程
  assert.equal(startTray({ QSX_NO_TRAY: '1' }), null, '给了开关就不该拉起托盘');
});
