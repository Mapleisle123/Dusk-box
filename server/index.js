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
import { createApp } from './app.js';
import { loadConfig, PROJECT_ROOT } from './config.js';
import { startScheduler } from './backup.js';
import { openBrowser } from './browser.js';
import { refreshAutostartTarget } from './autostart.js';
import { refreshDesktopShortcutTarget } from './desktop.js';

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

async function main() {
  const config = loadConfig();
  // 停止服务由设置页或托盘触发（无窗口启动后没有"关掉黑窗口"这个动作了）。
  // 这里传的是个箭头函数：它要等到真的有人点停止时才执行，
  // 那时下面的 shutdown 已经定义好了。
  const app = createApp({ dataRoot: config.dataRoot, onShutdown: () => shutdown() });

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

    // 托盘**不再自动启动**：这台机器上它注册不成系统托盘图标
    // （"其他系统托盘图标"列表里找不到），所以停服务改用桌面的「停止服务」
    // 快捷方式与设置页按钮。脚本仍留在 launcher/tray.ps1，想用可手动起。

    // 开机自启的快捷方式指向的是启动脚本。脚本换文件（比如从 .bat 换成无窗口启动器）时，
    // 老快捷方式不会自己跟着变，得在这里顺手校正一次，否则用户每次开机都还是旧行为。
    // 放在监听之后异步做：它是"维护动作"，不该拖慢服务可用时间。
    refreshAutostartTarget().catch((err) => {
      console.error('[Dusk Box] 校正开机自启快捷方式失败（不影响使用）：', err.message);
    });
    refreshDesktopShortcutTarget().catch((err) => {
      console.error('[Dusk Box] 校正桌面快捷方式失败（不影响使用）：', err.message);
    });
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
