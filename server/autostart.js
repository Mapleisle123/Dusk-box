/**
 * 开机自动启动。
 *
 * 机制与项目根目录的两个 .bat 完全一致：
 *   在 Windows「启动」文件夹里放一个指向「茜色箱启动.bat」的快捷方式。
 *   （安装开机自启.bat 建它，取消开机自启.bat 删它。）
 *
 * 关键设计：**唯一事实来源是快捷方式文件本身**，不是数据库里的开关值。
 * 好处是「设置页里的开关」与「手动双击 bat」操作的是同一个产物，
 * 两条路径天然并存：谁改的，另一条都能立刻看到真实状态，不会各说各话。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { PROJECT_ROOT } from './config.js';

/** 快捷方式文件名（与「安装开机自启.bat」中保持一致） */
export const SHORTCUT_NAME = '茜色箱.lnk';

/** 快捷方式指向的启动脚本 */
export const LAUNCHER_NAME = '茜色箱启动.bat';

/** 快捷方式说明文字 */
const SHORTCUT_DESC = '茜色箱 · 开机自动启动本地服务';

/** 是否支持（快捷方式机制为 Windows 特有） */
export function autostartSupported() {
  return process.platform === 'win32';
}

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

/** 启动脚本完整路径 */
export function launcherPath() {
  return path.join(PROJECT_ROOT, LAUNCHER_NAME);
}

/**
 * 读取当前状态。
 *
 * 以快捷方式是否存在为准，因此用户手动双击过「安装开机自启.bat」时，
 * 这里同样会报告「已开启」。
 */
export function getAutostart() {
  const linkPath = shortcutPath();
  let enabled = false;
  try {
    enabled = fs.statSync(linkPath).isFile();
  } catch {
    enabled = false;
  }
  return {
    enabled,
    supported: autostartSupported(),
    linkPath,
    launcherPath: launcherPath(),
  };
}

/**
 * 创建快捷方式的 PowerShell 脚本。
 *
 * 所有路径都通过环境变量传入，脚本本身保持纯 ASCII：
 * 这样项目路径里的空格（"my app"）与中文名都不会遇到引号转义问题。
 */
const CREATE_SCRIPT = [
  '$ws = New-Object -ComObject WScript.Shell',
  '$sc = $ws.CreateShortcut($env:QSX_LNK)',
  '$sc.TargetPath = $env:QSX_TARGET',
  '$sc.WorkingDirectory = $env:QSX_WORKDIR',
  '$sc.WindowStyle = 7',
  '$sc.Description = $env:QSX_DESC',
  '$sc.Save()',
].join('; ');

/** 执行一段 PowerShell，环境变量用于传参 */
function runPowerShell(script, env) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-Command', script],
      { env: { ...process.env, ...env }, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || '').trim() || err.message;
          reject(new Error(`创建开机自启快捷方式失败：${detail}`));
          return;
        }
        resolve(String(stdout || ''));
      },
    );
  });
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
    fs.rmSync(linkPath, { force: true });
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
  await runPowerShell(CREATE_SCRIPT, {
    QSX_LNK: linkPath,
    QSX_TARGET: launcher,
    QSX_WORKDIR: PROJECT_ROOT,
    QSX_DESC: SHORTCUT_DESC,
  });

  return getAutostart();
}
