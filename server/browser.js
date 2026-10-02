/**
 * 打开系统默认浏览器。
 *
 * 单独成一个模块，是因为现在有两条路径要打开界面：
 *   - server/index.js：服务启动后自动打开（双击 DuskBox-start.bat 的路径）
 *   - server/launch.js：发现服务已经在跑时，只把界面叫出来（无窗口启动器的路径）
 * 两处必须是同一套行为，否则"换个方式启动"就会出现有的开浏览器、有的不开。
 */

import { exec } from 'node:child_process';

/**
 * 用系统默认浏览器打开一个地址。
 * 打不开不影响服务运行——用户照着窗口里的地址手敲也能进。
 *
 * @param {string} url
 */
export function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') cmd = `start "" "${url}"`;
  else if (platform === 'darwin') cmd = `open "${url}"`;
  else cmd = `xdg-open "${url}"`;
  exec(cmd, () => {
    /* 忽略失败：这不是启动流程的关键路径 */
  });
}
