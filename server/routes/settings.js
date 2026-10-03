/**
 * 设置模块路由。
 *
 * 说明：
 *   - 主题、备份策略等存在数据库 settings 表，随时可改。
 *   - 数据目录存在 config.json，因为它决定数据库文件位置，
 *     必须能在数据库打开之前读取。修改后需要重启服务。
 */

import path from 'node:path';
import fs from 'node:fs';
import { loadConfig, saveConfig, PROJECT_ROOT } from '../config.js';
import { badRequest } from '../http.js';
import { getAllSettings } from '../db.js';
import { createZip, collectDirEntries } from '../zip.js';
import { backupStamp } from '../backup.js';
import { getAutostart, setAutostart } from '../autostart.js';
import { DEFAULT_BACKGROUND } from '../assets.js';
import {
  USER_BACKGROUND_DIRNAME,
  listAllBackgrounds,
  isAllowedBackgroundName,
  saveUserBackground,
  removeUserBackground,
} from '../backgrounds.js';
import { readInput } from './input.js';
import { DB_FILENAME } from '../constants.js';

/**
 * 需要纳入导出的目录。
 *
 * 背景图也算用户数据：它是用户自己加进来的图片，不在这个清单里的话，
 * 导出的包拿到别的机器上恢复，设置里那个文件名就指向一张不存在的图。
 */
const EXPORT_DIRS = ['发布', '计划', '项目', '相册', USER_BACKGROUND_DIRNAME];

/**
 * 允许通过接口修改的设置项。
 *
 * 注意：这里**刻意不含** autoStart。
 * 开机自启的真实状态由「启动」文件夹里的快捷方式决定（见 /api/autostart），
 * 如果允许在这里写一个数据库值，就会出现"开关显示已开、实际没设"的假象。
 */
const EDITABLE = new Set([
  'theme',
  'colorMode',
  'style',
  'backupEnabled',
  'backupTime',
  'backupKeep',
  'backgroundImage',
  'mascot',
]);

/** 允许的主题主色调 */
export const THEMES = ['akane', 'amber', 'jade', 'azure', 'violet', 'graphite'];

/**
 * 允许的外观风格。
 *
 * 这两个值对应 app.css 里的两套材质语言（html[data-style="…"]）：
 *   liquid —— 简约：半透玻璃、柔和的圆角与阴影、底下一片光场
 *   brutal —— 新粗野主义：实色块面、直角、粗边、硬偏移影
 * 名字用英文枚举而不是直接写中文，是为了让 CSS、接口、数据库三处用的是同一组值，
 * 中文名只出现在界面文案里（见 store.js 的 STYLE_OPTIONS）。
 */
export const STYLES = ['liquid', 'brutal'];

/**
 * 校验并挑出可写入的设置项。
 * @param {object} patch 请求体
 * @param {string} dataRoot 数据根目录（背景图要同时看数据目录与自带目录才知道文件名是否有效）
 */
function validateSettingsPatch(patch, dataRoot) {
  const out = {};
  for (const [key, raw] of Object.entries(patch || {})) {
    if (!EDITABLE.has(key)) continue;
    const value = typeof raw === 'boolean' ? String(raw) : String(raw ?? '');
    if (key === 'theme' && !THEMES.includes(value)) {
      throw badRequest(`主题只能是：${THEMES.join(' / ')}`);
    }
    if (key === 'colorMode' && !['light', 'dark'].includes(value)) {
      throw badRequest('明暗模式只能是 light 或 dark');
    }
    if (key === 'style' && !STYLES.includes(value)) {
      throw badRequest(`外观风格只能是：${STYLES.join(' / ')}`);
    }
    if (key === 'backupEnabled' && !['true', 'false'].includes(value)) {
      throw badRequest('backupEnabled 只能是 true 或 false');
    }
    if (key === 'backupTime' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw badRequest('备份时间格式应为 HH:mm');
    }
    if (key === 'backupKeep') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        throw badRequest('保留份数应为 1~365 之间的整数');
      }
    }
    if (key === 'backgroundImage' && !isAllowedBackgroundName(dataRoot, value)) {
      throw badRequest(
        '背景图必须是可选列表里的图片文件名（自带的或你自己添加的；留空表示不使用）',
      );
    }
    if (key === 'mascot' && !['true', 'false'].includes(value)) {
      throw badRequest('mascot 只能是 true 或 false');
    }
    out[key] = value;
  }
  return out;
}

/** 递归复制目录 */
function copyDirSafe(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSafe(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

export function mountSettingsRoutes(router, ctx) {
  /** 读取设置（含只读的运行期信息） */
  router.get('/api/settings', () => {
    const config = loadConfig();
    return {
      settings: getAllSettings(ctx.db),
      runtime: {
        dataRoot: ctx.dataRoot,
        dbPath: ctx.dbPath,
        configuredDataRoot: config.dataRoot,
        port: config.port,
        projectRoot: PROJECT_ROOT,
        themes: THEMES,
        styles: STYLES,
        // 开机自启的真实状态（读自启动文件夹，不是数据库）
        autoStart: getAutostart(),
      },
    };
  });

  /**
   * 开机自启状态。
   *
   * 与手动双击「安装开机自启.bat」等效——两者读写的是同一个快捷方式，
   * 所以这里报告的是真实状态，而不是应用"以为自己设过"的状态。
   */
  router.get('/api/autostart', () => getAutostart());

  /** 开启 / 关闭开机自启 */
  router.put('/api/autostart', async ({ req }) => {
    const { readJson } = await import('../http.js');
    const body = await readJson(req);
    if (typeof body.enabled !== 'boolean') {
      throw badRequest('enabled 必须是 true 或 false');
    }
    return setAutostart(body.enabled);
  });

  /** 更新设置 */
  router.put('/api/settings', async ({ req }) => {
    const { readJson } = await import('../http.js');
    const body = await readJson(req);
    const patch = validateSettingsPatch(body, ctx.dataRoot);
    if (Object.keys(patch).length === 0) throw badRequest('没有可更新的设置项');
    ctx.setSettings(patch);
    return { settings: getAllSettings(ctx.db) };
  });

  /**
   * 可选背景图列表 + 当前选择。
   *
   * 两个来源合成一份列表：
   *   - 项目里的 img/background（自带，往目录里放图片就会出现在列表里）
   *   - 数据目录里的 背景图/（用户在这里点「添加背景图」加进来的）
   * 两者共用同一个 URL 前缀，所以设置里存的仍然是一个纯文件名。
   */
  router.get('/api/backgrounds', () => ({
    images: listAllBackgrounds(ctx.dataRoot),
    // 与 /api/settings 里的 backgroundImage 是同一个值，避免两个接口各说各话
    current: ctx.getSetting('backgroundImage') ?? '',
    defaultImage: DEFAULT_BACKGROUND,
  }));

  /**
   * 添加一张自定义背景图（multipart，取第一个文件，字段名不限）。
   *
   * 图片只会落到本机的数据目录里，**不上传到任何地方**：
   * 这是一个只跑在 127.0.0.1 上的本地服务，这一步就是把文件写进磁盘。
   * 只加进列表、不顺手改动当前设置——"我加了一张图"和"我要换成这张"
   * 是两件事，后者由设置接口单独完成。
   */
  router.post('/api/backgrounds', async ({ req }) => {
    const { files } = await readInput(req);
    const file = files[0];
    if (!file) throw badRequest('没有收到图片文件');
    const added = saveUserBackground(ctx.dataRoot, {
      buffer: file.buffer,
      originalName: file.originalName,
    });
    return {
      added,
      images: listAllBackgrounds(ctx.dataRoot),
      current: ctx.getSetting('backgroundImage') ?? '',
    };
  });

  /**
   * 删除一张自定义背景图。
   *
   * 如果删掉的正是当前在用的那张，就把设置一并清空——
   * 否则库里会留下一个指向已删除文件的文件名：接口读得出来，
   * 页面上却是一片空白，而且从此再选"不使用"都修不好它。
   */
  router.delete('/api/backgrounds/:name', ({ params }) => {
    const removed = removeUserBackground(ctx.dataRoot, params.name);
    let current = ctx.getSetting('backgroundImage') ?? '';
    const cleared = current === removed.name;
    if (cleared) {
      ctx.setSetting('backgroundImage', '');
      current = '';
    }
    return {
      removed: removed.name,
      cleared,
      current,
      images: listAllBackgrounds(ctx.dataRoot),
    };
  });

  /**
   * 修改数据目录。
   * 默认会把现有数据整体搬过去，避免"改完设置数据看起来丢了"。
   */
  router.put('/api/settings/data-root', async ({ req }) => {
    const { readJson } = await import('../http.js');
    const body = await readJson(req);
    const target = String(body.dataRoot ?? '').trim();
    if (!target) throw badRequest('数据目录不能为空');
    if (!path.isAbsolute(target)) throw badRequest('请提供绝对路径，例如 D:\\DuskBox');

    const current = ctx.dataRoot;
    if (path.resolve(target) === path.resolve(current)) {
      return { ok: true, dataRoot: current, changed: false, message: '数据目录未变化' };
    }
    if (fs.existsSync(target) && fs.readdirSync(target).length > 0 && body.migrate !== false) {
      throw badRequest('目标目录不为空。请选择一个空目录，或选择不迁移数据。');
    }

    const migrate = body.migrate !== false;
    let migratedFiles = 0;
    if (migrate) {
      // 先做一次完整备份，避免迁移过程出问题导致数据丢失
      fs.mkdirSync(target, { recursive: true });
      for (const dirName of ['发布', '计划', '项目', '相册']) {
        const src = path.join(current, dirName);
        const dest = path.join(target, dirName);
        copyDirSafe(src, dest);
        if (fs.existsSync(dest)) {
          const walk = (d) =>
            fs.readdirSync(d, { withFileTypes: true }).reduce((acc, e) => {
              const p = path.join(d, e.name);
              return acc + (e.isDirectory() ? walk(p) : 1);
            }, 0);
          migratedFiles += walk(dest);
        }
      }
      // 数据库最后复制（保证数据文件已就位）
      fs.copyFileSync(ctx.dbPath, path.join(target, DB_FILENAME));
    } else {
      fs.mkdirSync(target, { recursive: true });
    }

    saveConfig({ dataRoot: path.resolve(target) });

    return {
      ok: true,
      changed: true,
      dataRoot: path.resolve(target),
      migrated: migrate,
      migratedFiles,
      needsRestart: true,
      message: '数据目录已修改，请关闭并重新启动茜色箱后生效。',
    };
  });

  /**
   * 导出全部数据为一个 ZIP。
   * 内容：数据库快照 + 发布/计划/相册 三个分类目录的原始文件。
   * 直接写二进制响应，不经过 JSON 包装。
   */
  router.get('/api/export', ({ res }) => {
    // 先做一次 WAL checkpoint，保证导出的数据库文件是完整一致的
    try {
      ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      /* 失败不阻断导出 */
    }

    const entries = [];
    try {
      entries.push({
        name: DB_FILENAME,
        data: fs.readFileSync(ctx.dbPath),
        mtime: fs.statSync(ctx.dbPath).mtime,
      });
    } catch {
      /* 数据库读不到时仍导出文件部分 */
    }

    for (const dirName of EXPORT_DIRS) {
      entries.push(...collectDirEntries(path.join(ctx.dataRoot, dirName), dirName));
    }

    const zip = createZip(entries);
    const filename = `DuskBox-导出-${backupStamp()}.zip`;

    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': zip.length,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    res.end(zip);
    return undefined;
  });
}
