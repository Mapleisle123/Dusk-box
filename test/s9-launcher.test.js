/**
 * S9 启动器测试。
 *
 * 这一组测试不模拟，而是真的把 server/index.js 当独立进程启动一次，
 * 验证「双击 茜色箱启动.bat」这条链路真的能跑通：
 *   - Node 能找到入口文件
 *   - 配置文件被正确读取，数据目录自动建立
 *   - 端口监听成功并能响应请求
 *   - 重复启动时端口被占用会自动换端口（不会直接失败）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { PROJECT_ROOT } from '../server/config.js';

const ENTRY = path.join(PROJECT_ROOT, 'server', 'index.js');

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

/**
 * 启动真实的入口进程，等待它打印出访问地址。
 * @returns {Promise<{child, port, base, stop}>}
 */
async function launchServer(env, { timeoutMs = 20000 } = {}) {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, QSX_NO_OPEN: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString('utf8');
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString('utf8');
  });

  const port = await new Promise((resolve, reject) => {
    const started = Date.now();
    const check = setInterval(() => {
      const m = /http:\/\/localhost:(\d+)/.exec(stdout);
      if (m) {
        clearInterval(check);
        resolve(Number(m[1]));
        return;
      }
      if (child.exitCode !== null) {
        clearInterval(check);
        reject(new Error(`进程提前退出（code=${child.exitCode}）\nstdout: ${stdout}\nstderr: ${stderr}`));
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(check);
        reject(new Error(`等待启动超时\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    }, 100);
  });

  return {
    child,
    port,
    base: `http://127.0.0.1:${port}`,
    getStdout: () => stdout,
    getStderr: () => stderr,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill();
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 4000);
        child.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}

/** 造一个临时配置 */
function tempConfig(dataRoot, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-launch-cfg-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ dataRoot, port }, null, 2), 'utf8');
  return { dir, file };
}

/**
 * 先停服务再删目录，并带重试。
 * Windows 上进程退出后文件句柄的释放会略有延迟，直接删会 EBUSY。
 */
async function cleanup(srv, ...dirs) {
  if (srv) await srv.stop();
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

test('S9 · 启动脚本与配套文件齐备', () => {
  for (const name of ['茜色箱启动.bat', '安装开机自启.bat', '取消开机自启.bat', 'package.json']) {
    assert.ok(fs.existsSync(path.join(PROJECT_ROOT, name)), `应存在 ${name}`);
  }

  // bat 是 GBK 编码，必须用 GBK 解码才能读到其中的中文
  const readBat = (name) =>
    new TextDecoder('gbk').decode(fs.readFileSync(path.join(PROJECT_ROOT, name)));

  const launcher = readBat('茜色箱启动.bat');
  assert.ok(launcher.includes('server\\index.js'), '启动脚本应指向服务入口');
  assert.ok(launcher.includes('where node'), '启动脚本应查找 node');
  assert.ok(
    launcher.includes('chcp 65001'),
    '启动 Node 之前应切到 65001，否则 Node 的 UTF-8 中文输出在本地代码页下会乱码',
  );

  const autoStart = readBat('安装开机自启.bat');
  assert.ok(autoStart.includes('Startup'), '开机自启脚本应写入启动文件夹');
  assert.ok(autoStart.includes('茜色箱启动.bat'), '自启脚本应指向启动脚本');

  const uninstall = readBat('取消开机自启.bat');
  assert.ok(uninstall.includes('茜色箱.lnk'), '取消脚本应删除对应快捷方式');
});

/**
 * 这一组断言来自一次真实事故：三个 bat 曾被写成「纯 LF 行尾 + UTF-8 无 BOM」，
 * 双击后 cmd 把命令拆得面目全非（'et' 不是内部或外部命令…），窗口一闪就没反应。
 * 光检查文件"存在"和"内容包含某字符串"完全挡不住这类问题，必须查字节形态。
 *
 * 踩过的三种写法（都实测失败）：
 *   - UTF-8 无 BOM：cmd 按 936 读，中文 UTF-8 字节被配对解码时吞掉相邻 ASCII 字符，
 *     实测 `echo 关闭本窗口…（你的数据不会丢失）。` 会被拆成半句并报"不是内部或外部命令"
 *   - UTF-8 带 BOM：BOM 粘在第一行命令名前，`@echo off` 变成 `<BOM>@echo off` 直接不识别
 *   - 纯 LF 行尾：多行 if 块与 echo 语句解析错位，整个脚本崩掉
 * 正确组合：GBK/936 编码（与 cmd 默认代码页一致） + CRLF 行尾 + 不带 BOM。
 */
test('S9 · 三个 bat 必须是 GBK 编码 + CRLF 行尾，且不带 BOM', () => {
  const gbk = new TextDecoder('gbk');

  for (const name of ['茜色箱启动.bat', '安装开机自启.bat', '取消开机自启.bat']) {
    const buf = fs.readFileSync(path.join(PROJECT_ROOT, name));

    // 编码：cmd 在 936 代码页下逐字节解析脚本，文件必须是 GBK 才能对上。
    // 用 GBK 解码能读回中文，就说明存的是 GBK；存成 UTF-8 时这里会是乱码。
    const text = gbk.decode(buf);
    assert.ok(
      text.includes('茜色箱'),
      `${name} 应以 GBK(本地代码页) 编码保存；当前用 GBK 解码读不出中文，说明编码不对`,
    );

    // 不能有 UTF-8 BOM：它会粘在第一行命令名前，让 '@echo off' 无法识别
    const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    assert.ok(!hasBom, `${name} 不应带 UTF-8 BOM，BOM 会污染第一行命令导致其无法识别`);

    // 行尾：cmd 的批处理解析器依赖 \r\n 判断行边界
    let cr = 0;
    let lf = 0;
    for (const byte of buf) {
      if (byte === 0x0d) cr += 1;
      else if (byte === 0x0a) lf += 1;
    }
    assert.ok(cr > 0, `${name} 必须是 CRLF 行尾（当前一个 CR 都没有，纯 LF 会让 cmd 解析崩溃）`);
    assert.equal(cr, lf, `${name} 的 CR 与 LF 数量应相等，当前 CR=${cr} LF=${lf}，说明存在裸 LF`);

    // 代码页要与文件编码一致
    assert.ok(
      text.includes('chcp 936') || !text.includes('chcp '),
      `${name} 设置了与 GBK 编码不匹配的代码页（应使用 chcp 936 或不切换）`,
    );
  }
});

/**
 * 真刀真枪通过 cmd.exe 执行启动脚本。
 * 之前的测试都是 spawn(process.execPath, [index.js]) 绕过 bat 跑的，
 * 于是"bat 本身能不能被执行"这件事其实从未被验证过。
 */
test(
  'S9 · 真实执行启动 bat：cmd 能正确解析并拉起服务',
  { skip: process.platform !== 'win32' ? '仅适用于 Windows' : false },
  async (t) => {
    const dataRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-bat-')), 'data');
    const port = await freePort();
    const cfg = tempConfig(dataRoot, port);
    const batPath = path.join(PROJECT_ROOT, '茜色箱启动.bat');

    const child = spawn('cmd.exe', ['/c', batPath], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, QSX_NO_OPEN: '1', QSX_CONFIG_FILE: cfg.file },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 注意：这个流里混着两种编码——bat 自身的提示按本地代码页(GBK)输出，
    // 而它拉起的 Node 进程输出固定是 UTF-8。所以先按原始字节收着，最后再解码。
    const outChunks = [];
    const errChunks = [];
    child.stdout.on('data', (d) => {
      outChunks.push(d);
    });
    child.stderr.on('data', (d) => {
      errChunks.push(d);
    });

    // 判据不靠中文匹配（编码混杂），直接轮询健康检查接口：能通就说明服务真的起来了
    const started = await (async () => {
      const begin = Date.now();
      while (Date.now() - begin < 25000) {
        if (child.exitCode !== null) return false;
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/health`);
          if (r.ok) return true;
        } catch {
          /* 服务还没起来，继续等 */
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    })();

    t.after(async () => {
      // 必须杀整棵进程树：只杀 cmd.exe 会留下孤儿的 node 进程继续占着端口
      if (child.exitCode === null) {
        await new Promise((resolve) => {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
          });
          const to = setTimeout(resolve, 5000);
          to.unref();
          killer.once('exit', () => {
            clearTimeout(to);
            resolve();
          });
        });
      }
      for (const dir of [path.dirname(dataRoot), cfg.dir]) {
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

    // cmd 的报错信息按本地代码页输出，用 GBK 解码才能读出中文报错；
    // Node 的 UTF-8 输出在这里会解成乱码，但不影响我们找 cmd 的报错文本。
    const raw = Buffer.concat([...outChunks, ...errChunks]);
    const decoded = new TextDecoder('gbk').decode(raw).slice(0, 2000);

    assert.ok(started, `启动 bat 应能拉起服务\n--- 输出(GBK 解码) ---\n${decoded}`);

    // 关键判据：cmd 解析批处理时不应出现任何语法/命令识别错误。
    // 历史上这里踩过两次：纯 LF 行尾把多行 if 块解析崩、UTF-8 编码让中文行吞掉
    // 相邻 ASCII 字符（echo 语句被拆成半句并报"不是内部或外部命令"）。
    assert.doesNotMatch(
      decoded,
      /不是内部或外部命令|命令语法不正确|此时不应有|is not recognized/,
      `cmd 解析 bat 时出现了语法错误（行尾或编码有问题）\n--- 输出(GBK 解码) ---\n${decoded}`,
    );

    // 服务确实在跑，且用的是配置里的数据目录
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await res.json();
    assert.equal(body.ok, true, '经 bat 启动后服务应能正常响应');
    assert.equal(body.dataRoot, dataRoot, '应使用配置中的数据目录');
  },
);

test('S9 · 真实启动入口：能监听端口并响应请求，自动建立数据目录', async (t) => {
  const dataRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-launch-')), 'data');
  const port = await freePort();
  const cfg = tempConfig(dataRoot, port);

  const srv = await launchServer({ QSX_CONFIG_FILE: cfg.file });
  t.after(() => cleanup(srv, path.dirname(dataRoot), cfg.dir));

  assert.equal(srv.port, port, '应使用配置中的端口');

  const res = await fetch(`${srv.base}/api/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.dataRoot, dataRoot, '应使用配置中的数据目录');

  // 数据目录与分类文件夹自动建立
  assert.ok(fs.existsSync(dataRoot), '数据目录应被创建');
  for (const dir of ['发布', '计划', '相册', '备份']) {
    assert.ok(fs.existsSync(path.join(dataRoot, dir)), `应创建 ${dir} 目录`);
  }
  assert.ok(fs.existsSync(path.join(dataRoot, '茜色箱.db')), '应创建数据库文件');

  // 首页可访问
  const home = await (await fetch(`${srv.base}/api/home`)).json();
  assert.ok(Array.isArray(home.today), '首页接口应可用');

  // 前端页面可访问
  const page = await fetch(`${srv.base}/`);
  assert.equal(page.status, 200);
});

test('S9 · 端口被占用时自动改用其它端口，而不是启动失败', async (t) => {
  const dataRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-launch2-')), 'data');
  const port = await freePort();

  // 先占住目标端口
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => blocker.close(resolve)));

  const cfg = tempConfig(dataRoot, port);

  const srv = await launchServer({ QSX_CONFIG_FILE: cfg.file });
  t.after(() => cleanup(srv, path.dirname(dataRoot), cfg.dir));

  assert.ok(srv.port !== port, `应换到其它端口，实际仍是 ${srv.port}`);
  assert.ok(srv.port > port, '应向后试探端口');

  const res = await fetch(`${srv.base}/api/health`);
  assert.equal(res.status, 200, '换端口后服务应正常工作');
});

test('S9 · 优雅关闭：发出停止信号后进程能正常退出', async (t) => {
  const dataRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-launch3-')), 'data');
  const port = await freePort();
  const cfg = tempConfig(dataRoot, port);

  const srv = await launchServer({ QSX_CONFIG_FILE: cfg.file });
  t.after(() => cleanup(srv, path.dirname(dataRoot), cfg.dir));
  await fetch(`${srv.base}/api/health`);

  const exited = new Promise((resolve) => srv.child.once('exit', resolve));
  const started = Date.now();
  srv.child.kill();

  const code = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 6000)),
  ]);
  const elapsed = Date.now() - started;

  assert.notEqual(code, 'TIMEOUT', '进程应在 6 秒内退出');
  assert.ok(elapsed < 4000, `退出应足够快（实际 ${elapsed}ms），不应等待 keep-alive 连接超时`);

  // 关闭后端口应被释放
  const reuse = await new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
  assert.equal(reuse, true, '关闭后端口应可被重新使用');
});
