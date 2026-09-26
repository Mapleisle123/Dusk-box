/**
 * 相册模块路由。
 */

import { readInput, toNum } from './input.js';
import * as albums from '../services/albums.js';

export function mountAlbumsRoutes(router, ctx) {
  /** 相册集列表 */
  router.get('/api/albums', () => ({ albums: albums.listAlbums(ctx) }));

  /** 相册模块摘要（供首页） */
  router.get('/api/albums/summary', ({ query }) => albums.summary(ctx, query.date));

  /** 最近收藏（供首页） */
  router.get('/api/albums/recent', ({ query }) => ({
    photos: albums.recentPhotos(ctx, toNum(query.limit, 8)),
  }));

  /** 单个相册集（含图片） */
  router.get('/api/albums/:id', ({ params }) => albums.getAlbum(ctx, params.id));

  /** 新建相册集 */
  router.post('/api/albums', async ({ req }) => {
    const { body } = await readInput(req);
    return albums.createAlbum(ctx, body);
  });

  /** 重命名相册集 */
  router.put('/api/albums/:id', async ({ req, params }) => {
    const { body } = await readInput(req);
    return albums.updateAlbum(ctx, params.id, body);
  });

  /** 上传图片（支持批量） */
  router.post('/api/albums/:id/photos', async ({ req, params }) => {
    const { files } = await readInput(req);
    return albums.addPhotos(ctx, params.id, files);
  });

  /** 设置封面 */
  router.put('/api/albums/:id/cover', async ({ req, params }) => {
    const { body } = await readInput(req);
    const photoId = toNum(body.photoId);
    if (photoId === undefined || photoId === null) {
      const { badRequest } = await import('../http.js');
      throw badRequest('缺少 photoId');
    }
    return albums.setCover(ctx, params.id, photoId);
  });

  /** 删除单张图片 */
  router.delete('/api/albums/:id/photos/:photoId', ({ params }) =>
    albums.deletePhoto(ctx, params.id, params.photoId),
  );

  /** 删除相册集 */
  router.delete('/api/albums/:id', ({ params }) => albums.deleteAlbum(ctx, params.id));
}
