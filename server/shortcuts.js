/**
 * Windows 快捷方式（.lnk）的通用工具。
 *
 * 「开机自启」和「桌面启动器」其实是同一件事的两个落点：
 * 都是在某个目录里放一个指向启动脚本的快捷方式。所以建 / 删 / 读的逻辑集中在这里，
 * 两处共用，避免出现"一边能建、另一边建不出来"这种各写各的差异。
 *
 * 唯一事实来源始终是**快捷方式文件本身**，不是数据库里的某个开关值。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

/** 快捷方式机制是 Windows 特有的 */
export function shortcutsSupported() {
  return process.platform === 'win32';
}

/** 快捷方式是否存在（判据是文件本身，不是任何记录） */
export function shortcutExists(linkPath) {
  try {
    return fs.statSync(linkPath).isFile();
  } catch {
    return false;
  }
}

/** 删除快捷方式。不存在也算成功——关闭一个已经关掉的东西不该报错 */
export function removeShortcut(linkPath) {
  fs.rmSync(linkPath, { force: true });
}

/**
 * 建快捷方式的 PowerShell 脚本。
 *
 * 所有路径都通过环境变量传入，脚本本身保持纯 ASCII：
 * 这样项目路径里的空格（"my app"）与中文目录名都不会遇到引号转义问题。
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

/**
 * 读快捷方式的目标路径。
 * 用它来判断"现有的快捷方式是不是还指向当前这个启动脚本"——
 * 启动脚本改名或换文件时，老快捷方式会一直静静地指向旧文件。
 */
const READ_SCRIPT = [
  '$ws = New-Object -ComObject WScript.Shell',
  '$sc = $ws.CreateShortcut($env:QSX_LNK)',
  '[Console]::Out.Write($sc.TargetPath)',
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
          reject(new Error(`PowerShell 执行失败：${detail}`));
          return;
        }
        resolve(String(stdout || ''));
      },
    );
  });
}

/**
 * 创建快捷方式。
 *
 * @param {object} options
 * @param {string} options.linkPath     快捷方式文件路径
 * @param {string} options.target       指向的可执行文件
 * @param {string} options.workdir      起始目录
 * @param {string} [options.description] 备注（显示在属性的"备注"里）
 */
export async function createShortcut({ linkPath, target, workdir, description = '' }) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  await runPowerShell(CREATE_SCRIPT, {
    QSX_LNK: linkPath,
    QSX_TARGET: target,
    QSX_WORKDIR: workdir,
    QSX_DESC: description,
  });
}

/**
 * 读取快捷方式指向的文件。
 * 读不到（文件不存在 / 不是快捷方式 / PowerShell 不许跑）时返回 null。
 */
export async function readShortcutTarget(linkPath) {
  try {
    const out = await runPowerShell(READ_SCRIPT, { QSX_LNK: linkPath });
    const target = out.trim();
    return target || null;
  } catch {
    return null;
  }
}
