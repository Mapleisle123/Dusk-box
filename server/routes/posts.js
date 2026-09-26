/**
 * 发布模块路由。
 */

import { readInput } from './input.js';
import * as posts from '../services/posts.js';

export function mountPostsRoutes(router, ctx) {
  /** 时间线列表 */
  router.get('/api/posts', ({ query }) => {
    return posts.listPosts(ctx, {
      q: query.q,
      type: query.type,
      from: query.from,
      to: query.to,
      limit: query.limit,
      offset: query.offset,
    });
  });

  /** 有内容的日期（用于按日期浏览） */
  router.get('/api/posts/dates', () => ({ dates: posts.listDates(ctx) }));

  /** 发布摘要 */
  router.get('/api/posts/summary', ({ query }) => posts.summary(ctx, query.date));

  /** 详情 */
  router.get('/api/posts/:id', ({ params }) => posts.getPost(ctx, params.id));

  /** 新建 */
  router.post('/api/posts', async ({ req }) => {
    const { body, files } = await readInput(req);
    const created = posts.createPost(ctx, body, files);
    return { post: created, filePath: created.filePath };
  });

  /** 更新 */
  router.put('/api/posts/:id', async ({ req, params }) => {
    const { body, files } = await readInput(req);
    const updated = posts.updatePost(ctx, params.id, body, files);
    return { post: updated, filePath: updated.filePath };
  });

  /** 删除 */
  router.delete('/api/posts/:id', ({ params }) => posts.deletePost(ctx, params.id));
}
