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
import { Router, createServer, HttpError } from './http.js';
import { PROJECT_ROOT, saveConfig } from './config.js';
import { mountPostsRoutes } from './routes/posts.js';
import { mountPlansRoutes } from './routes/plans.js';
import { mountAlbumsRoutes } from './routes/albums.js';
import { mountHomeRoutes } from './routes/home.js';
import { mountSettingsRoutes } from './routes/settings.js';
import { mountBackupRoutes } from './routes/backup.js';

/** 数据库文件名 */
export const DB_FILENAME = '茜色箱.db';

/**
 * @param {object} options
 * @param {string} options.dataRoot 数据根目录（数据库与分类文件夹所在处）
 * @param {string} [options.staticDir] 前端静态资源目录
 */
export function createApp({ dataRoot, staticDir = path.join(PROJECT_ROOT, 'public') }) {
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
  router.get('/api/health', () => ({
    ok: true,
    app: '茜色箱',
    dataRoot,
    dbPath,
    time: new Date().toISOString(),
  }));

  mountSettingsRoutes(router, ctx);
  mountPostsRoutes(router, ctx);
  mountPlansRoutes(router, ctx);
  mountAlbumsRoutes(router, ctx);
  mountHomeRoutes(router, ctx);
  mountBackupRoutes(router, ctx);

  const handler = createServer({
    router,
    staticDir,
    // 项目自带资源（img/logo、img/background）通过 /img/* 访问
    assetDir: path.join(PROJECT_ROOT, 'img'),
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
