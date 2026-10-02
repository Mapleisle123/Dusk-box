/**
 * 桌面启动器路由。
 *
 * 与 /api/autostart 完全对称：GET 报告真实状态，PUT 开关。
 * 真实状态一律读自"桌面上那个快捷方式文件在不在"。
 */

import { badRequest, readJson } from '../http.js';
import { getDesktopShortcut, setDesktopShortcut } from '../desktop.js';

export function mountDesktopRoutes(router) {
  router.get('/api/desktop', () => getDesktopShortcut());

  router.put('/api/desktop', async ({ req }) => {
    const body = await readJson(req);
    if (typeof body.enabled !== 'boolean') {
      throw badRequest('enabled 必须是 true 或 false');
    }
    return setDesktopShortcut(body.enabled);
  });
}
