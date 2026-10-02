/**
 * 开机自动启动。
 *
 * 机制与项目根目录的两个 .bat 完全一致：
 *   在 Windows「启动」文件夹里放一个指向启动脚本的快捷方式。
 *   快捷方式指向的是**无窗口**启动器（DuskBox-launch.vbs），开机时不弹黑窗口。
 *   （DuskBox-autostart-on.bat 建它，DuskBox-autostart-off.bat 删它。）
 *
 * 关键设计：**唯一事实来源是快捷方式文件本身**，不是数据库里的开关值。
 * 好处是「设置页里的开关」与「手动双击 bat」操作的是同一个产物，
 * 两条路径天然并存：谁改的，另一条都能立刻看到真实状态，不会各说各话。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';
import { LAUNCH_SCRIPT, SHORTCUT_NAME, START_SCRIPT } from './constants.js';
import {
  createShortcut,
  readShortcutTarget,
  removeShortcut,
  shortcutExists,
  shortcutsSupported,
} from './shortcuts.js';

/** 快捷方式文件名（与「安装开机自启.bat」中保持一致） */
export { SHORTCUT_NAME };

/** 有窗口的启动脚本：调试与兜底用（没找到 Node 时的中文提示在里面） */
export const LAUNCHER_NAME = START_SCRIPT;

/** 无窗口启动器：桌面快捷方式与开机自启都指向它 */
export const SILENT_LAUNCHER_NAME = LAUNCH_SCRIPT;

/** 快捷方式说明文字 */
const SHORTCUT_DESC = 'Dusk Box · 开机自动启动本地服务';

/** 是否支持（快捷方式机制为 Windows 特有） */
export const autostartSupported = shortcutsSupported;

/**
 * 启动文件夹位置。
 *
 * 可用环境变量 QSX_STARTUP_DIR 覆盖——测试时指向临时目录，
 * 避免在用户真实的开机项里留下东西。
 */
export function startupDir() {
  const override = process.env.QSX_STARTUP_DIR;
  if (override && override.trim()) return override;
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

/** 快捷方式完整路径 */
export function shortcutPath() {
  return path.join(startupDir(), SHORTCUT_NAME);
}

/**
 * 快捷方式指向的启动脚本完整路径。
 *
 * 注意这里指的是**无窗口**启动器（DuskBox-launch.vbs），不是那个 .bat：
 * 开机自启的目标是"开机后悄悄把服务跑起来"，不该弹出一个黑窗口。
 * 有窗口的 .bat 仍然保留，供手动排查问题用。
 */
export function launcherPath() {
  return path.join(PROJECT_ROOT, SILENT_LAUNCHER_NAME);
}

/**
 * 读取当前状态。
 *
 * 以快捷方式是否存在为准，因此用户手动双击过「安装开机自启.bat」时，
 * 这里同样会报告「已开启」。
 */
export function getAutostart() {
  const linkPath = shortcutPath();
  return {
    enabled: shortcutExists(linkPath),
    supported: autostartSupported(),
    linkPath,
    launcherPath: launcherPath(),
  };
}

/**
 * 开启 / 关闭开机自启。
 *
 * @param {boolean} enabled
 * @returns {Promise<ReturnType<typeof getAutostart>>} 操作后的真实状态
 */
export async function setAutostart(enabled) {
  const linkPath = shortcutPath();

  if (!enabled) {
    // 关闭：直接删掉快捷方式即可，不需要 PowerShell
    removeShortcut(linkPath);
    return getAutostart();
  }

  if (!autostartSupported()) {
    throw new Error('开机自动启动目前仅支持 Windows。');
  }

  const launcher = launcherPath();
  if (!fs.existsSync(launcher)) {
    throw new Error(`找不到启动脚本，无法设置开机自启：${launcher}`);
  }

  fs.mkdirSync(startupDir(), { recursive: true });
  try {
    await createShortcut({
      linkPath,
      target: launcher,
      workdir: PROJECT_ROOT,
      description: SHORTCUT_DESC,
    });
  } catch (err) {
    throw new Error(`创建开机自启快捷方式失败：${err.message}`);
  }

  return getAutostart();
}

/**
 * 让现有的快捷方式指向当前的启动脚本。
 *
 * 为什么需要它：快捷方式是**外部世界**对文件的引用，不会跟着文件改名或换目标走。
 * 开机自启原先指向 DuskBox-start.bat（会弹黑窗口），改成无窗口启动器之后，
 * 老快捷方式会一直静静地指着旧脚本——每次开机照样弹出黑窗口，
 * 而设置页显示的是"已开启"，从界面上看不出任何异常。
 *
 * 只在"已经开着自启 + 目标对不上"时才动手重建；没开自启的用户一切照旧。
 */
export async function refreshAutostartTarget() {
  const state = getAutostart();
  if (!state.enabled || !autostartSupported()) return state;

  const current = await readShortcutTarget(state.linkPath);
  if (current && samePath(current, state.launcherPath)) return state;

  // 读不出目标（老格式、文件损坏、或读取被安全策略拦下）时也重建一次：
  // 代价是一条快捷方式，换来的是"绝不会再指向旧脚本"。
  return setAutostart(true);
}

/** 比较两个路径是否相同（Windows 上大小写与斜杠方向都不敏感） */
function samePath(a, b) {
  const norm = (p) => path.resolve(String(p)).replace(/[\\/]+/g, '\\').toLowerCase();
  return norm(a) === norm(b);
}
