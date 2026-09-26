/**
 * 首页路由。
 */

import { buildHome } from '../services/home.js';
import { todayISO } from '../dates.js';

export function mountHomeRoutes(router, ctx) {
  router.get('/api/home', ({ query }) => buildHome(ctx, query.date || todayISO()));
}
