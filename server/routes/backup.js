/**
 * 备份模块路由。
 */

import { readInput, toBool } from './input.js';
import { createBackup, listBackups, restoreBackup, pruneBackups } from '../backup.js';

export function mountBackupRoutes(router, ctx) {
  /** 备份列表 */
  router.get('/api/backups', () => ({ backups: listBackups(ctx) }));

  /** 立即备份一次 */
  router.post('/api/backups', async ({ req }) => {
    const { body } = await readInput(req);
    const result = await createBackup(ctx, {
      reason: String(body.reason || 'manual'),
    });
    return { backup: result, backups: listBackups(ctx).length };
  });

  /** 从备份恢复 */
  router.post('/api/backups/restore', async ({ req }) => {
    const { body } = await readInput(req);
    const name = String(body.name ?? '').trim();
    if (!name) {
      const { badRequest } = await import('../http.js');
      throw badRequest('缺少备份名称 name');
    }
    return restoreBackup(ctx, name);
  });

  /** 手动清理旧备份 */
  router.post('/api/backups/prune', () => ({ removed: pruneBackups(ctx) }));

  /** 删除某个备份 */
  router.delete('/api/backups/:name', async ({ params }) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = ctx.storage.dirs.backups;
    const safe = String(params.name).replace(/[\\/]/g, '');
    const dir = path.join(root, safe);
    if (!dir.startsWith(root)) {
      const { badRequest } = await import('../http.js');
      throw badRequest('备份名称非法');
    }
    if (!fs.existsSync(dir)) {
      const { notFound } = await import('../http.js');
      throw notFound(`备份不存在：${safe}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, removed: safe, backups: listBackups(ctx).length };
  });
}
