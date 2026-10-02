/**
 * S21 无窗口启动器测试。
 *
 * 「桌面双击就能用」这件事其实由三段组成，缺一段用户就会看到毛病：
 *   1. DuskBox-launch.vbs —— 用完全不显示窗口的方式把 Node 跑起来；
 *   2. server/launch.js   —— 判断服务在不在、该不该拉起来、什么时候打开界面；
 *   3. 服务本体           —— 端口被占用时会自己往后退，所以启动器必须"扫一段端口"而不是只探一个。
 *
 * VBS 自己没法自动化测，所以本组测试做两件事：
 *   - 用字节级检查钉住 VBS 的形态（纯 ASCII + CRLF），这几条一旦破掉就是"双击没反应"；
 *   - 把启动器的判断逻辑整段跑起来（VBS 只是外壳，逻辑全在 launch.js 里）。
 *
 * 最要紧的一条：**绝不允许起出第二个实例**。
 * 两个进程共用一个数据库文件是实打实的事故，而不是"多一点内存"。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { PROJECT_ROOT } from '../server/config.js';
import { LAUNCH_SCRIPT } from '../server/constants.js';
import { main, findRunningPort, healthAt } from '../server/launch.js';
import { startTestServer } from './helpers.js';

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

/** 造一个临时配置，把数据目录与端口都指向临时位置 */
function tempConfig(dataRoot, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-launch-cfg-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ dataRoot, port }, null, 2), 'utf8');
  return { dir, file };
}

/**
 * 临时把 QSX_CONFIG_FILE 指向测试用的配置。
 * 启动器读配置走的就是这个环境变量（与生产一致），只能这样喂给它。
 */
async function withConfig(file, fn) {
  const saved = process.env.QSX_CONFIG_FILE;
  const savedOpen = process.env.QSX_NO_OPEN;
  process.env.QSX_CONFIG_FILE = file;
  process.env.QSX_NO_OPEN = '1';
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.QSX_CONFIG_FILE;
    else process.env.QSX_CONFIG_FILE = saved;
    if (savedOpen === undefined) delete process.env.QSX_NO_OPEN;
    else process.env.QSX_NO_OPEN = savedOpen;
  }
}

/** 关掉一个进程，已经退出不算错 */
async function stopPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid);
  } catch {
    return;
  }
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
  }
}

/** 删临时目录（Windows 上句柄释放有延迟，重试几次） */
async function rmrf(...dirs) {
  for (const dir of dirs) {
    for (let i = 0; i < 20; i += 1) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
}

/**
 * 当前环境能不能运行脚本宿主（wscript / cscript）。
 *
 * 有些受限环境（例如带安全策略的执行沙箱）会禁止运行脚本宿主，
 * 那样 VBS 这条端到端用例没法跑——不是代码坏了，是环境不让跑。
 * 这时明确跳过并说明原因，而不是把一条本来能抓到问题的用例变成永久红的。
 *
 * 判据是"跑一个只有一行的小脚本能不能成功"，与实际用例走的是同一条系统通道。
 */
function scriptHostAvailable() {
  if (process.platform !== 'win32') return false;
  const file = path.join(os.tmpdir(), `qsx-wsh-probe-${process.pid}.vbs`);
  try {
    fs.writeFileSync(file, 'WScript.Echo "ok"', 'ascii');
    const res = spawnSync('cscript.exe', ['//nologo', file], { encoding: 'utf8' });
    return res.status === 0;
  } catch {
    return false;
  } finally {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* 探针文件删不掉也不影响结果 */
    }
  }
}

test('S21 · 无窗口启动器脚本：纯 ASCII + CRLF，且真的指向 server/launch.js', () => {
  const file = path.join(PROJECT_ROOT, LAUNCH_SCRIPT);
  assert.ok(fs.existsSync(file), `应存在 ${LAUNCH_SCRIPT}`);

  const buf = fs.readFileSync(file);

  // Windows Script Host 按 ANSI 读 .vbs：脚本里一旦混进非 ASCII 字符，
  // 在没有中文环境的机器上就会变成乱码甚至语法错误。中文提示一律放在 launch.js 里。
  const nonAscii = [...buf].filter((b) => b > 0x7f);
  assert.equal(
    nonAscii.length,
    0,
    `${LAUNCH_SCRIPT} 必须是纯 ASCII（当前有 ${nonAscii.length} 个非 ASCII 字节）`,
  );

  // 行尾：与三个 .bat 一样按字节原样存取，统一 CRLF，避免不同机器上解析不一致
  let cr = 0;
  let lf = 0;
  for (const b of buf) {
    if (b === 0x0d) cr += 1;
    else if (b === 0x0a) lf += 1;
  }
  assert.ok(cr > 0, '应使用 CRLF 行尾');
  assert.equal(cr, lf, `CR 与 LF 数量应相等（当前 CR=${cr} LF=${lf}）`);

  const text = buf.toString('ascii');
  assert.match(text, /server\\launch\.js/, '启动器应把 server\\launch.js 跑起来');
  assert.match(text, /node\.exe/, '启动器应自己找 node.exe（不能假设 PATH 里一定有）');
  assert.match(text, /DuskBox-start\.bat/, '找不到 Node 时应回退到带中文提示的 .bat');

  // 关键形态：launch.js 必须被"隐藏窗口"地启动（Run 的第二个参数是 0）
  assert.match(text, /sh\.Run cmd, 0, False/, '启动服务时必须用隐藏窗口方式，否则又会弹出黑窗口');
});

test('S21 · 服务已经在跑：只打开界面，绝不起第二个进程', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const before = (await healthAt(srv.port)).pid;
  const cfg = tempConfig(srv.dataRoot, srv.port);
  t.after(() => rmrf(cfg.dir));

  const result = await withConfig(cfg.file, () => main());

  assert.equal(result.started, false, '已经在跑时不该再拉起一个服务');
  assert.equal(result.port, srv.port, '应回报正在运行的那个端口');

  const after = (await healthAt(srv.port)).pid;
  assert.equal(after, before, '服务进程必须还是原来那一个（换 pid 就意味着起出了第二个实例）');
});

test('S21 · 服务降级到别的端口时也要认出来（不能只探一个端口）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  // 配置里写的是 srv.port - 1，真实服务在 srv.port 上：
  // 这正是"端口被占用后自动后退"的现场，只探配置端口会误判成没在跑。
  const cfg = tempConfig(srv.dataRoot, srv.port - 1);
  t.after(() => rmrf(cfg.dir));

  const result = await withConfig(cfg.file, () => main());

  assert.equal(result.port, srv.port, `应认出降级后的端口 ${srv.port}`);
  assert.equal(result.started, false, '认出来之后就不该再起一个');
});

test('S21 · 没在跑就拉起来，而且只拉一个（连点两次双击也一样）', async (t) => {
  const port = await freePort();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-launch-cold-'));
  const dataRoot = path.join(root, 'data');
  const cfg = tempConfig(dataRoot, port);
  t.after(() => rmrf(root, cfg.dir));

  // 模拟"用户双击后觉得没反应，又双击了一次"：两个启动器同时开跑
  const [a, b] = await withConfig(cfg.file, () => Promise.all([main(), main()]));

  assert.equal(a.port, port, '第一个启动器应把服务拉在配置的端口上');
  assert.equal(b.port, port, '第二个启动器应等到同一个服务，而不是自己再起一个');
  assert.equal(
    [a.started, b.started].filter(Boolean).length,
    1,
    '两次启动里只能有一次真的去拉服务',
  );

  const health = await healthAt(port);
  t.after(() => stopPid(health.pid));

  assert.equal(health.ok, true, '冷启动后服务应能正常响应');
  assert.equal(health.dataRoot, dataRoot, '应使用配置里的临时数据目录');
  assert.ok(Number.isInteger(health.pid), '健康检查应报告 pid');
  assert.notEqual(health.pid, process.pid, '服务必须是另一个进程，不能是本测试进程');

  // 配置端口之后的一段端口里，只应该有这一个实例
  assert.equal(await findRunningPort(port + 1), null, `端口 ${port + 1} 起不该再冒出第二个实例`);

  // 数据目录确实落在配置的位置（而不是用户真实的 data/）
  assert.ok(fs.existsSync(path.join(dataRoot, 'duskbox.db')), '数据库应建在配置的数据目录里');
});

test(
  'S21 · 真实的 VBS 启动器：双击路径能跑通（不弹窗口）',
  {
    skip:
      process.platform !== 'win32'
        ? '仅适用于 Windows'
        : !scriptHostAvailable() && '当前环境禁止运行脚本宿主（wscript/cscript），VBS 端到端用例无法执行',
  },
  async (t) => {
    const port = await freePort();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-launch-vbs-'));
    const dataRoot = path.join(root, 'data');
    const cfg = tempConfig(dataRoot, port);
    t.after(() => rmrf(root, cfg.dir));

    const env = { ...process.env, QSX_NO_OPEN: '1', QSX_CONFIG_FILE: cfg.file };
    const child = spawn('wscript.exe', [path.join(PROJECT_ROOT, LAUNCH_SCRIPT)], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });

    // 启动器自己会判断、自己会等，这里只等结果
    const begin = Date.now();
    let health = null;
    while (Date.now() - begin < 30000) {
      health = await healthAt(port);
      if (health) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (health) t.after(() => stopPid(health.pid));
    assert.ok(health, '双击启动器应能在配置端口上把服务拉起来');
    assert.equal(health.dataRoot, dataRoot, '应使用配置里的临时数据目录');

    // 再双击一次：不该再起一个进程
    const again = spawn('wscript.exe', [path.join(PROJECT_ROOT, LAUNCH_SCRIPT)], {
      cwd: PROJECT_ROOT,
      env,
      stdio: 'ignore',
    });
    t.after(() => {
      if (again.exitCode === null) again.kill();
    });
    await new Promise((r) => setTimeout(r, 3000));

    const after = await healthAt(port);
    assert.equal(after.pid, health.pid, '重复双击不该换进程');
    assert.equal(await findRunningPort(port + 1), null, '重复双击不该起出第二个实例');
  },
);
