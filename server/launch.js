/**
 * 无窗口启动器的逻辑部分。
 *
 * 桌面快捷方式与开机自启都指向 `DuskBox-launch.vbs`。那个脚本只负责一件事：
 * 用"完全不显示窗口"的方式把本文件跑起来。所有判断都放在这里，
 * 因为这里的逻辑能被自动化测试覆盖，而 VBS 不能。
 *
 * 本文件按顺序做三件事：
 *   1. 先看服务是不是已经在跑——扫端口，并且**必须认出是我们自己的服务**；
 *   2. 已经在跑：只把界面叫出来，绝不起第二个进程；
 *   3. 没在跑：后台拉起服务，等它真的能响应了再打开界面。
 *
 * 为什么第 3 步不能省"等"：服务从启动到能响应有几百毫秒，
 * 抢在它前面打开浏览器，用户会看到一个"无法连接到本地服务"的页面。
 *
 * 为什么必须认应用名而不是只看端口：端口被别的程序占用时，
 * 服务会自己往后降级到别的端口（见 index.js）。只扫一个端口会误判成"没在跑"，
 * 于是又拉起一个实例——**两个进程共用一个数据库**，这正是要极力避免的事故。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, PROJECT_ROOT } from './config.js';
import { APP_NAME } from './constants.js';
import { openBrowser } from './browser.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(MODULE_DIR, 'index.js');

/** 端口向后扫描的范围，与 index.js 的降级范围保持一致 */
export const PORT_SCAN = 20;

/** 单次健康检查的超时（连不上会立刻失败，这个上限只防"端口有人但不回话"） */
const PROBE_TIMEOUT_MS = 1200;

/** 等服务起来的时限 */
const READY_TIMEOUT_MS = 25000;

/** 启动锁超过这么久就当成残留（上一次启动中途被强杀） */
const LOCK_STALE_MS = 60000;

/** 查一次健康检查；不是我们的服务、或不是 JSON，都算没查到 */
export async function healthAt(port, timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.ok === true ? body : null;
  } catch {
    return null;
  }
}

/**
 * 在 basePort 起往后找正在运行的茜色箱。
 * @returns {Promise<number|null>} 找到就返回实际端口，否则 null
 */
export async function findRunningPort(basePort) {
  const ports = Array.from({ length: PORT_SCAN }, (_, i) => basePort + i);
  const found = await Promise.all(
    ports.map(async (port) => ({ port, health: await healthAt(port) })),
  );
  const hit = found.find((item) => item.health && item.health.app === APP_NAME);
  return hit ? hit.port : null;
}

/** 一直等到服务能响应为止 */
export async function waitForService(basePort, timeoutMs = READY_TIMEOUT_MS) {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    const port = await findRunningPort(basePort);
    if (port) return port;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

/**
 * 启动锁：同一份数据目录同时只允许一个"正在启动"的进程。
 *
 * 防的是一种很具体的双击：用户双击后觉得"怎么没反应"，又双击了一次。
 * 两次启动之间服务还没起来，第二个实例会扫到端口空闲而**另起一个进程**，
 * 两个进程用同一个数据库文件、还会开出两个浏览器标签。
 *
 * 锁放在系统临时目录，不往用户的数据目录里塞临时文件；
 * 文件名按数据目录哈希，多个数据目录互不干扰。
 */
export function startLockPath(dataRoot) {
  const key = crypto.createHash('sha1').update(path.resolve(dataRoot)).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `duskbox-launch-${key}.lock`);
}

/** 抢锁。抢到返回 true；别人正拿着（且不算过期）返回 false */
export function acquireStartLock(dataRoot) {
  const file = startLockPath(dataRoot);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return true; // 别的错误不拦着用户启动
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS;
      } catch {
        continue; // 锁文件刚好被清掉了，再试一次
      }
      if (!stale) return false;
      fs.rmSync(file, { force: true });
    }
  }
  return false;
}

export function releaseStartLock(dataRoot) {
  fs.rmSync(startLockPath(dataRoot), { force: true });
}

/** 后台拉起服务本体 */
export function spawnServer(env = process.env) {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: PROJECT_ROOT,
    // 界面由启动器统一打开（等确认服务能响应之后），所以让服务本体别自己开
    // 与 .bat 一样继承当前环境（测试靠 QSX_CONFIG_FILE 做数据隔离，不能被丢掉）
    env: { ...process.env, ...env, QSX_NO_OPEN: '1' },
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
  return child;
}

/**
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<{started:boolean, port:number|null}>} started 表示这次是不是由本进程拉起的服务
 */
export async function main({ env = process.env } = {}) {
  const config = loadConfig();
  const shouldOpen = env.QSX_NO_OPEN !== '1';

  const running = await findRunningPort(config.port);
  if (running) {
    if (shouldOpen) openBrowser(`http://localhost:${running}`);
    return { started: false, port: running };
  }

  if (!acquireStartLock(config.dataRoot)) {
    // 别人正在启动：等它起来，把界面打开就好，不能再起一个
    const port = await waitForService(config.port);
    if (port && shouldOpen) openBrowser(`http://localhost:${port}`);
    return { started: false, port };
  }

  try {
    spawnServer(env);
    const port = await waitForService(config.port);
    if (port && shouldOpen) openBrowser(`http://localhost:${port}`);
    return { started: true, port };
  } finally {
    releaseStartLock(config.dataRoot);
  }
}

/** 被 VBS 直接执行时才跑；被测试 import 时不跑 */
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .then((result) => {
      // 静默失败对用户最不友好：什么都不发生、也不知道为什么。
      // 这里在拿不到端口时明确把错误写出来（有窗口启动时能看到）。
      if (!result.port) {
        console.error('[Dusk Box] 启动失败：服务没有在预期时间内就绪。');
        console.error('可以双击 DuskBox-start.bat 查看详细输出。');
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error('[Dusk Box] 启动器出错：', err);
      process.exitCode = 1;
    });
}
