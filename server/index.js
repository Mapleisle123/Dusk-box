/**
 * Dusk Box（茜色箱） · 服务入口。
 *
 * 双击 DuskBox-start.bat 最终运行的就是这个文件：
 *   1. 读取配置（数据目录、端口）
 *   2. 装配应用
 *   3. 监听端口，并自动打开浏览器
 */

import http from 'node:http';
import net from 'node:net';
import { exec } from 'node:child_process';
import { createApp } from './app.js';
import { loadConfig, PROJECT_ROOT } from './config.js';
import { startScheduler } from './backup.js';

/** 检查端口是否可用 */
function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

/** 自动打开浏览器 */
function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') cmd = `start "" "${url}"`;
  else if (platform === 'darwin') cmd = `open "${url}"`;
  else cmd = `xdg-open "${url}"`;
  exec(cmd, () => {
    /* 打不开浏览器不影响服务运行，用户可手动访问 */
  });
}

async function main() {
  const config = loadConfig();
  const app = createApp({ dataRoot: config.dataRoot });

  let port = config.port;
  const free = await isPortFree(port);
  if (!free) {
    // 端口被占用时向后试探，避免用户反复启动失败
    let found = false;
    for (let candidate = port + 1; candidate < port + 20; candidate += 1) {
      if (await isPortFree(candidate)) {
        port = candidate;
        found = true;
        break;
      }
    }
    if (!found) {
      console.error(`[Dusk Box] 端口 ${config.port} 及其后 20 个端口都被占用，请关闭其他程序后重试。`);
      process.exit(1);
    }
    console.log(`[Dusk Box] 端口 ${config.port} 被占用，改用 ${port}。`);
  }

  const server = http.createServer(app.handler);
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('  Dusk Box 已启动');
    console.log(`  访问地址：${url}`);
    console.log(`  数据目录：${app.dataRoot}`);
    console.log('  关闭此窗口即停止服务（数据不会丢失）');
    console.log('');
    startScheduler(app);
    if (process.env.QSX_NO_OPEN !== '1') openBrowser(url);
  });

  const shutdown = () => {
    console.log('\n[Dusk Box] 正在关闭…');
    // 先切断空闲的 keep-alive 连接，否则 server.close() 会一直等它们超时
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => {
      app.close();
      process.exit(0);
    });
    // 兜底：2 秒内没关闭就强制退出（数据已落盘，不会丢失）
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 未捕获异常不要让进程静默死掉，明确报出来
  process.on('uncaughtException', (err) => {
    console.error('[Dusk Box] 发生未捕获异常：', err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[Dusk Box] 发生未处理的 Promise 拒绝：', err);
  });
}

main().catch((err) => {
  console.error('[Dusk Box] 启动失败：', err);
  process.exit(1);
});
