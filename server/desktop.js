/**
 * 桌面启动器：在桌面上放一个指向无窗口启动器的快捷方式。
 *
 * 与开机自启是同一套路（见 autostart.js）：
 *   - 唯一事实来源是快捷方式文件本身，不是数据库里的开关值；
 *   - 设置页的按钮与手动双击 `DuskBox-desktop-on.bat` 操作的是同一个产物。
 * 区别只在"放在哪个目录"。
 *
 * 桌面的真实路径**必须问系统**，不能自己拼 `%USERPROFILE%\Desktop`：
 * Windows 上桌面目录可能被重定向（OneDrive 接管后通常是
 * `%USERPROFILE%\OneDrive\桌面`），自己拼出来的路径会指向一个"看不见的桌面"——
 * 用户点了安装，桌面上却什么都没有。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';
import { SHORTCUT_NAME } from './constants.js';
import { launcherPath } from './autostart.js';
import {
  createShortcut,
  readShortcutTarget,
  removeShortcut,
  runPowerShell,
  shortcutExists,
  shortcutsSupported,
} from './shortcuts.js';

/** 桌面快捷方式的说明文字 */
const SHORTCUT_DESC = 'Dusk Box · 从桌面打开茜色箱';

/** 「停止服务」那个快捷方式 */
const STOP_LINK_NAME = 'DuskBox-stop.lnk';
const STOP_SHORTCUT_DESC = 'Dusk Box · 停止本地服务（数据不会丢）';

/** 停止服务用的小脚本（纯 ASCII 的 VBS，只发一个本地 HTTP 请求） */
export const STOP_SCRIPT_NAME = 'DuskBox-stop.vbs';
export function stopScriptPath() {
  return path.join(PROJECT_ROOT, STOP_SCRIPT_NAME);
}

/** 问系统要桌面目录（纯 ASCII 脚本，路径由系统给出） */
const DESKTOP_SCRIPT = '[Console]::Out.Write([Environment]::GetFolderPath(\'Desktop\'))';

/** 解析结果缓存：桌面目录在运行期间不会变，没必要每次问一遍 */
let cachedDesktopDir = null;

/**
 * 桌面目录。
 *
 * 可用环境变量 QSX_DESKTOP_DIR 覆盖——测试时指向临时目录，
 * 免得在用户真实的桌面上真的留下快捷方式。
 */
export async function desktopDir() {
  const override = process.env.QSX_DESKTOP_DIR;
  if (override && override.trim()) return override;
  if (cachedDesktopDir) return cachedDesktopDir;

  let resolved = '';
  try {
    resolved = (await runPowerShell(DESKTOP_SCRIPT, {})).trim();
  } catch {
    resolved = '';
  }
  // 问不到就退回常规位置：宁可放错地方，也好过让功能完全不可用
  cachedDesktopDir = resolved || path.join(process.env.USERPROFILE || os.homedir(), 'Desktop');
  return cachedDesktopDir;
}

/** 桌面快捷方式的完整路径 */
export async function desktopShortcutPath() {
  return path.join(await desktopDir(), SHORTCUT_NAME);
}

/**
 * 当前状态。
 *
 * 判据与开机自启一致：**看快捷方式文件在不在**，不看任何记录。
 */
export async function getDesktopShortcut() {
  const linkPath = await desktopShortcutPath();
  return {
    exists: shortcutExists(linkPath),
    supported: shortcutsSupported(),
    linkPath,
    // 快捷方式应该指向哪个文件（无窗口启动器）
    targetPath: launcherPath(),
  };
}

/**
 * 创建 / 移除桌面快捷方式。
 *
 * @param {boolean} enabled
 */
export async function setDesktopShortcut(enabled) {
  const linkPath = await desktopShortcutPath();

  if (!enabled) {
    removeShortcut(linkPath);
    removeShortcut(path.join(await desktopDir(), STOP_LINK_NAME));
    return getDesktopShortcut();
  }

  if (!shortcutsSupported()) {
    throw new Error('桌面启动器目前仅支持 Windows。');
  }

  const target = launcherPath();
  if (!fs.existsSync(target)) {
    throw new Error(`找不到启动脚本，无法创建桌面快捷方式：${target}`);
  }

  try {
    await createShortcut({
      linkPath,
      target,
      workdir: PROJECT_ROOT,
      description: SHORTCUT_DESC,
    });
    // 顺手放一个「停止服务」图标：这台机器上托盘注册不成系统图标，
    // 所以停服务改用它——只发一个本地请求，不依赖托盘、也不弹 PowerShell 窗口。
    const stop = stopScriptPath();
    if (fs.existsSync(stop)) {
      await createShortcut({
        linkPath: path.join(await desktopDir(), STOP_LINK_NAME),
        target: stop,
        workdir: PROJECT_ROOT,
        description: STOP_SHORTCUT_DESC,
      });
    }
  } catch (err) {
    throw new Error(`创建桌面快捷方式失败：${err.message}`);
  }

  return getDesktopShortcut();
}

/**
 * 让桌面上的快捷方式指向当前的启动脚本。
 *
 * 与开机自启同样的道理：快捷方式是外部引用，启动脚本换了文件之后
 * 老快捷方式不会自己跟着变，会一直静静地指向旧的那个。
 * 只在"快捷方式确实存在 + 目标对不上"时重建，没装过的用户一切照旧。
 */
export async function refreshDesktopShortcutTarget() {
  const state = await getDesktopShortcut();
  if (!state.exists || !state.supported) return state;

  const current = await readShortcutTarget(state.linkPath);
  if (current && samePath(current, state.targetPath)) return state;

  return setDesktopShortcut(true);
}

/** 比较两个路径是否相同（Windows 上大小写与斜杠方向都不敏感） */
function samePath(a, b) {
  const norm = (p) => path.resolve(String(p)).replace(/[\\/]+/g, '\\').toLowerCase();
  return norm(a) === norm(b);
}
