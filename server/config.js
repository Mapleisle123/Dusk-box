/**
 * 路径与配置。
 *
 * 分工说明：
 *   - config.json（项目根目录）：存放"必须在数据库打开之前就知道"的设置，
 *     即数据目录位置与端口。因为数据目录决定了数据库文件在哪里。
 *   - 数据库 settings 表：存放其余可在应用内随时修改的设置（主题、备份策略等）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录 */
export const PROJECT_ROOT = path.resolve(MODULE_DIR, '..');

/** 配置文件路径 */
export const CONFIG_FILE = path.join(PROJECT_ROOT, 'config.json');

/**
 * 实际使用的配置文件路径。
 * 测试时可通过 QSX_CONFIG_FILE 环境变量指向临时文件，
 * 避免污染用户真实的 config.json。
 */
export function configFilePath() {
  return process.env.QSX_CONFIG_FILE || CONFIG_FILE;
}

/** 数据根目录的默认位置：项目目录下的 data/ */
export const DEFAULT_DATA_ROOT = path.join(PROJECT_ROOT, 'data');

/** 默认端口 */
export const DEFAULT_PORT = 8899;

/** 默认配置 */
export function defaultConfig() {
  return {
    dataRoot: DEFAULT_DATA_ROOT,
    port: DEFAULT_PORT,
  };
}

/** 读取配置（缺失字段用默认值补齐，不写回磁盘） */
export function loadConfig() {
  const base = defaultConfig();
  const file = configFilePath();
  if (!fs.existsSync(file)) return base;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      dataRoot: typeof raw.dataRoot === 'string' && raw.dataRoot.trim() ? raw.dataRoot : base.dataRoot,
      port: Number.isInteger(raw.port) && raw.port > 0 && raw.port < 65536 ? raw.port : base.port,
    };
  } catch {
    // 配置损坏时退回默认值，不阻断启动
    return base;
  }
}

/** 写入配置 */
export function saveConfig(patch) {
  const merged = { ...loadConfig(), ...patch };
  fs.writeFileSync(configFilePath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}
