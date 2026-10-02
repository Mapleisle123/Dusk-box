/**
 * 应用装配层。
 *
 * createApp 是整个应用的唯一装配点：
 *   - 打开数据库
 *   - 建立存储层
 *   - 挂载各模块路由
 *   - 返回可供 HTTP 服务使用的请求处理器
 *
 * 测试时传入临时 dataRoot 即可获得完全隔离的实例。
 */

import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, getAllSettings, setSettings, setSetting, getSetting } from './db.js';
import { createStorage } from './storage.js';
import { Router, createServer, HttpError, safeResolve } from './http.js';
import { PROJECT_ROOT, saveConfig } from './config.js';
import { resolveBackgroundAsset } from './backgrounds.js';
import { mountPostsRoutes } from './routes/posts.js';
import { mountPlansRoutes } from './routes/plans.js';
import { mountProjectsRoutes } from './routes/projects.js';
import { mountAlbumsRoutes } from './routes/albums.js';
import { mountHomeRoutes } from './routes/home.js';
import { mountSettingsRoutes } from './routes/settings.js';
import { mountBackupRoutes } from './routes/backup.js';
import { mountDesktopRoutes } from './routes/desktop.js';

import { DB_FILENAME, APP_NAME, SHUTDOWN_HEADER, SHUTDOWN_TOKEN } from './constants.js';

/** 数据库文件名。常量本体在 constants.js，这里再导出是给测试用的。 */
export { DB_FILENAME };

/**
 * @param {object} options
 * @param {string} options.dataRoot 数据根目录（数据库与分类文件夹所在处）
 * @param {string} [options.staticDir] 前端静态资源目录
 * @param {() => void} [options.onShutdown] 「停止服务」被调用时的收尾动作
 */
export function createApp({
  dataRoot,
  staticDir = path.join(PROJECT_ROOT, 'public'),
  onShutdown,
}) {
  if (!dataRoot) throw new Error('createApp 需要 dataRoot');

  fs.mkdirSync(dataRoot, { recursive: true });
  const dbPath = path.join(dataRoot, DB_FILENAME);
  const db = openDatabase(dbPath);
  const storage = createStorage(dataRoot);

  const router = new Router();

  // 应用上下文：各模块路由共享。
  // 注意：所有设置读写都通过 ctx.db 间接访问，
  // 这样"从备份恢复"后调用 ctx.reload() 换掉句柄，各模块立刻用上新连接。
  const ctx = {
    db,
    dataRoot,
    dbPath,
    storage,
    /** 读取单个设置 */
    getSetting: (key) => getSetting(ctx.db, key),
    /** 读取全部设置 */
    getSettings: () => getAllSettings(ctx.db),
    /** 写入设置 */
    setSettings: (patch) => setSettings(ctx.db, patch),
    setSetting: (key, value) => setSetting(ctx.db, key, value),
    /**
     * 关闭数据库句柄。
     * Windows 上文件被占用时无法覆盖/删除，
     * 因此"恢复备份"必须先把句柄关掉再动文件。
     */
    closeDb() {
      try {
        ctx.db.close();
      } catch {
        /* 已关闭时忽略 */
      }
      ctx.db = null;
    },
    /** 重新打开数据库句柄 */
    openDb() {
      if (ctx.db) return ctx.db;
      ctx.db = openDatabase(dbPath);
      return ctx.db;
    },
    /**
     * 重新打开数据库（恢复备份后调用）。
     */
    reload() {
      ctx.closeDb();
      return ctx.openDb();
    },
  };

  // 健康检查：前端用来显示"服务运行中"
  //
  // 返回里带上 pid 有两个用处：无窗口启动器靠 app 字段确认"这是我们的服务"
  // （端口可能被别的程序占用），测试则靠 pid 精确地关掉自己拉起来的那个进程
  // ——Windows 上按进程名或进程树乱杀会误伤用户正在用的实例。
  router.get('/api/health', () => ({
    ok: true,
    app: APP_NAME,
    pid: process.pid,
    dataRoot,
    dbPath,
    time: new Date().toISOString(),
  }));

  /**
   * 停止本地服务。
   *
   * 只有"无窗口启动"这个形态才需要它：以前关掉那个黑窗口就等于停服务，
   * 现在窗口没了，得另外给一个明确的停止入口（托盘右键、设置页按钮）。
   *
   * 两个要点：
   *   - 必须带自定义请求头（见 constants.js），否则浏览器里别的网页
   *     也能对着 localhost 发一条请求把服务停掉；
   *   - **先把响应发出去再退出**。直接退出的话，调用方只会看到
   *     "连接被重置"，分不清是停成功了还是服务崩了。
   */
  router.post('/api/shutdown', ({ req, res }) => {
    if (req.headers[SHUTDOWN_HEADER] !== SHUTDOWN_TOKEN) {
      throw new HttpError(403, '缺少停止服务所需的请求头');
    }
    if (typeof onShutdown !== 'function') {
      // 测试实例、或被当作库使用时不带这个回调：明确报错，而不是假装成功
      throw new HttpError(501, '当前运行方式不支持停止服务');
    }
    res.on('finish', () => onShutdown());
    return { ok: true, stopping: true };
  });

  mountSettingsRoutes(router, ctx);
  mountDesktopRoutes(router, ctx);
  mountPostsRoutes(router, ctx);
  mountPlansRoutes(router, ctx);
  mountProjectsRoutes(router, ctx);
  mountAlbumsRoutes(router, ctx);
  mountHomeRoutes(router, ctx);
  mountBackupRoutes(router, ctx);

  const handler = createServer({
    router,
    staticDir,
    // /img/* 的资源解析。
    // background/ 这一支有**两级目录**：数据目录里的自定义图优先、项目里的 img/ 兜底，
    // 两者共用同一个 URL 前缀（名字就是地址）。
    // 其余（logo 等）仍然只认随应用走的 img/。
    resolveAsset: (relPath) =>
      resolveBackgroundAsset(dataRoot, relPath) ??
      safeResolve(path.join(PROJECT_ROOT, 'img'), relPath),
    fileResolver: (pathname) => {
      // /files/<数据目录内的相对路径>
      const rel = pathname.slice('/files/'.length);
      return storage.resolveUrlPath(rel);
    },
  });

  return {
    db,
    dbPath,
    dataRoot,
    storage,
    router,
    handler,
    ctx,
    close() {
      if (!ctx.db) return;
      try {
        ctx.db.close();
      } catch {
        /* 已关闭时忽略 */
      }
      ctx.db = null;
    },
  };
}

export { HttpError };
