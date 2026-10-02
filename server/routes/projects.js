/**
 * 项目模块路由。
 *
 * 注册顺序与计划模块一样：静态路径（/summary）必须排在参数路径（/:id）之前，
 * 否则 /api/projects/summary 会被当成 id=summary 处理。
 */

import { readInput } from './input.js';
import * as projects from '../services/projects.js';

export function mountProjectsRoutes(router, ctx) {
  /** 项目列表 */
  router.get('/api/projects', ({ query }) =>
    projects.listProjects(ctx, { status: query.status || undefined, q: query.q || undefined }),
  );

  /** 项目模块摘要（供首页用） */
  router.get('/api/projects/summary', ({ query }) =>
    projects.summary(ctx, { limit: Number(query.limit) || 3 }),
  );

  /** 单个项目（含成果图） */
  router.get('/api/projects/:id', ({ params }) => projects.getProject(ctx, params.id));

  /** 新建项目（可以同时带成果图） */
  router.post('/api/projects', async ({ req }) => {
    const { body, files } = await readInput(req);
    return projects.createProject(ctx, body, files);
  });

  /** 更新项目（字段 + 追加成果图） */
  router.put('/api/projects/:id', async ({ req, params }) => {
    const { body, files } = await readInput(req);
    return projects.updateProject(ctx, params.id, body, files);
  });

  /** 删除一张成果图 */
  router.delete('/api/projects/:id/media/:mediaId', ({ params }) =>
    projects.removeMedia(ctx, params.id, params.mediaId),
  );

  /** 删除项目 */
  router.delete('/api/projects/:id', ({ params }) => projects.deleteProject(ctx, params.id));
}
