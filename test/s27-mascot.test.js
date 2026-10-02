/**
 * S27 吉祥物测试。
 *
 * 分两半：
 *   - 服务端这半能真跑：形象文件取得到、开关存得住、乱填值会被拒；
 *   - 前端那半是源码护栏：它管的是几条**看着不起眼但会真出问题**的约定——
 *     吉祥物不许挡住能点的东西、图没了要自己收起、同一件事一天只提醒一次。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer, ok } from './helpers.js';
import { PROJECT_ROOT } from '../server/config.js';

const read = (rel) => fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');

const MASCOT_FILE = 'img/mascot/mascot.png';

test('S27 · 形象文件存在，且能通过 /img 取到真正的图片字节', async (t) => {
  const file = path.join(PROJECT_ROOT, MASCOT_FILE);
  assert.ok(fs.existsSync(file), `应存在 ${MASCOT_FILE}`);

  // PNG 魔数：确认这真的是张 PNG，而不是改了扩展名的别的东西
  const head = fs.readFileSync(file).subarray(0, 8);
  assert.deepEqual(
    [...head],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    '应是合法的 PNG',
  );

  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = await fetch(`${srv.base}/img/mascot/mascot.png`);
  assert.equal(res.status, 200, '前端应能取到这张图');
  assert.match(res.headers.get('content-type') || '', /image\/png/, 'MIME 应是 PNG');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.ok(bytes.length > 1000, '不该是一张空图');
});

test('S27 · 开关：默认开、能关、非法值被拒、重启后还记得', async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-mascot-'));
  const srv = await startTestServer({ dataRoot });

  const initial = ok(await srv.get('/api/settings'));
  assert.equal(initial.settings.mascot, 'true', '默认应显示吉祥物');

  const off = ok(await srv.put('/api/settings', { mascot: 'false' }));
  assert.equal(off.settings.mascot, 'false');

  const bad = await srv.put('/api/settings', { mascot: 'maybe' });
  assert.equal(bad.status, 400, '只能是 true / false');

  await srv.close();
  const srv2 = await startTestServer({ dataRoot });
  t.after(async () => {
    await srv2.close();
    for (let i = 0; i < 20; i += 1) {
      try {
        fs.rmSync(dataRoot, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });
  const again = ok(await srv2.get('/api/settings'));
  assert.equal(again.settings.mascot, 'false', '关掉之后重启也得还是关着的');
});

test('S27 · 不许挡住能点的东西（位置在下半部 + 容器不吃鼠标）', () => {
  const css = read('public/css/app.css');
  const block = css.slice(css.indexOf('.mascot {'), css.indexOf('@keyframes mascot-breathe'));

  assert.match(block, /position:\s*fixed/, '应是浮在页面上的');
  assert.match(block, /right:\s*0/, '应贴着右边缘');
  assert.match(block, /bottom:\s*[\d.]+(vh|px|%)/, '应定位在底部（用 bottom，不许用 top 钉在上半部）');
  assert.doesNotMatch(block, /\.mascot\s*\{[^}]*top:/, '不许用 top 定位：各页面右上角本来就有按钮');
  assert.match(block, /pointer-events:\s*none/, '容器本身不能吃鼠标事件');
  assert.match(block, /\.mascot-body[\s\S]*?pointer-events:\s*auto/, '只有角色本体接鼠标');
  assert.match(block, /translateX\(/, '默认应是半收在屏幕外的');
  assert.match(block, /:hover/, '鼠标靠近要展开');
});

test('S27 · 图不在时自己收起，绝不留下一个破图图标', () => {
  const mascot = read('public/js/mascot.js');
  assert.match(mascot, /addEventListener\('error'/, '图片加载失败要处理');
  assert.match(mascot, /unmountMascot\(\)/, '失败时应把整个吉祥物收掉');
  assert.match(mascot, /assetUrl\(/, '图片地址要走统一的资源拼法');
  assert.match(mascot, /mascot\/mascot\.png/, '应指向 img/mascot/mascot.png');
});

test('S27 · 互动：点一下说话、悬停有反应、有新发布时冒一次气泡', () => {
  const mascot = read('public/js/mascot.js');
  assert.match(mascot, /addEventListener\('click'/, '点击要冒气泡');
  assert.match(mascot, /duskbox:published/, '应监听"刚发布"这个事件');

  const posts = read('public/js/pages/posts.js');
  assert.match(posts, /dispatchEvent\(new CustomEvent\('duskbox:published'\)\)/, '发布成功后应通知吉祥物');

  const css = read('public/css/app.css');
  assert.match(css, /mascot-breathe/, '常驻应有呼吸浮动');
  assert.match(css, /\.mascot-body:hover/, '悬停应有反应');
});

test('S27 · 同一件事一天只提醒一次（不能每次都来烦人）', () => {
  const mascot = read('public/js/mascot.js');
  assert.match(mascot, /localStorage/, '提醒记录要落在本地');
  assert.match(mascot, /alreadyRemindedToday/, '应先判断今天是不是已经提醒过');
  assert.match(mascot, /api\.home\(/, '提醒内容应来自真实数据（首页聚合）');
});

test('S27 · 设置页有开关，且真的会挂上/收掉吉祥物', () => {
  const settings = read('public/js/pages/settings.js');
  assert.match(settings, /data-toggle-mascot/, '设置页应有吉祥物开关');
  assert.match(settings, /mascotOn/, '开关的初始状态应来自服务端设置');
  assert.match(settings, /refreshMascot\(\)/, '拨动开关后要立刻生效，不用刷新');

  const main = read('public/js/main.js');
  assert.match(main, /mountMascot\(\)/, '启动时应把它挂出来');
});
