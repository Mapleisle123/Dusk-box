/**
 * S27 吉祥物测试。
 *
 * 她住在侧栏里，会挥手、会跺脚、能被拖走又能自己飞回原位。
 * 这一组分三块：
 *   1. 服务端这半能真跑：静止图与四段动作素材都取得到、开关存得住；
 *   2. 纯规则真的跑：连点三次算跺脚、间隔超时重新数（mascot-rules.js 是纯计算）；
 *   3. 前端那半是源码护栏：位置、拖动、静音、回位、切页挥手这些约定，
 *      不跑浏览器也能挡住回归。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer, ok } from './helpers.js';
import { PROJECT_ROOT } from '../server/config.js';
import {
  DRAG_THRESHOLD_PX,
  IDLE_AFTER_MS,
  STOMP_CLICKS,
  STOMP_WINDOW_MS,
  noteClick,
} from '../public/js/mascot-rules.js';

const read = (rel) => fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');

const STILL_FILE = 'img/mascot/mascot.png';
const ANIM_FILES = [
  'img/mascot/gif/mascot_wave.mp4',
  'img/mascot/gif/mascot_stomp.mp4',
  'img/mascot/gif/mascot_struggle.mp4',
  'img/mascot/gif/mascot_idle.mp4',
];

test('S27 · 静止图与四段动作素材都在，且能通过 /img 取到真正的字节', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const still = path.join(PROJECT_ROOT, STILL_FILE);
  assert.ok(fs.existsSync(still), `应存在 ${STILL_FILE}`);
  const pngHead = fs.readFileSync(still).subarray(0, 8);
  assert.deepEqual(
    [...pngHead],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    '静止图应是合法的 PNG',
  );

  const stillRes = await fetch(`${srv.base}/img/mascot/mascot.png`);
  assert.equal(stillRes.status, 200, '前端应能取到静止图');

  for (const rel of ANIM_FILES) {
    const abs = path.join(PROJECT_ROOT, rel);
    assert.ok(fs.existsSync(abs), `应存在 ${rel}`);
    // mp4 的盒子以 "ftyp" 开头（第 4~8 字节），用来确认不是改了扩展名的别的东西
    assert.equal(
      fs.readFileSync(abs).subarray(4, 8).toString('latin1'),
      'ftyp',
      `${rel} 应是 MP4 视频`,
    );

    const relUrl = rel.replace(/^img\//, '');
    const res = await fetch(`${srv.base}/img/${relUrl}`);
    assert.equal(res.status, 200, `前端应能取到 ${rel}`);
    assert.match(res.headers.get('content-type') || '', /video\/mp4/, `${rel} 的 MIME 应是 video/mp4`);
  }
});

test('S27 · 连点三次算跺脚；中途停超过两秒就重新数', () => {
  const t0 = 100000;

  let times = [];
  let r = noteClick(times, t0);
  assert.equal(r.stomp, false, '第一次点击不该触发');
  times = r.recent;

  r = noteClick(times, t0 + 400);
  assert.equal(r.stomp, false, '第二次还不够');
  times = r.recent;

  r = noteClick(times, t0 + 900);
  assert.equal(r.stomp, true, `第 ${STOMP_CLICKS} 次应该触发跺脚`);
  assert.deepEqual(r.recent, [], '触发之后计数要清零，免得下一次点击又立刻触发');

  // 慢慢点：每次都超出窗口，永远凑不满
  times = [];
  let fired = false;
  for (let i = 0; i < 5; i += 1) {
    const out = noteClick(times, t0 + i * (STOMP_WINDOW_MS + 100));
    fired = fired || out.stomp;
    times = out.recent;
  }
  assert.equal(fired, false, '间隔都超过窗口时不该累计触发');

  // 刚好压在窗口边界上：算数（用 <=，不是 <）
  times = [];
  r = noteClick(times, t0);
  r = noteClick(r.recent, t0 + STOMP_WINDOW_MS);
  assert.equal(r.stomp, false);
  assert.equal(r.recent.length, 2, '边界上的点击应被算进窗口');
});

test('S27 · 参数是定好的那几个数（改了就说明是有意改的）', () => {
  assert.equal(STOMP_CLICKS, 3, '用户定的：连点三次');
  assert.equal(STOMP_WINDOW_MS, 2000, '两次点击之间不超过 2 秒');
  assert.equal(IDLE_AFTER_MS, 20000, '静置 20 秒进待机');
  assert.equal(DRAG_THRESHOLD_PX, 4, '位移超过 4px 才算拖动，否则算点击');
});

test('S27 · 她住在侧栏里（导航与服务状态之间），不再浮在页面右侧', () => {
  const html = read('public/index.html');
  const navEnd = html.indexOf('</nav>');
  const slot = html.indexOf('id="mascot-slot"');
  const footer = html.indexOf('class="sidebar-footer"');
  assert.ok(slot > 0, 'index.html 里应有吉祥物的位置');
  assert.ok(navEnd > 0 && slot > navEnd, '位置应在导航之后');
  assert.ok(footer > slot, '位置应在底部服务状态之前（就是那块空白）');

  const css = read('public/css/app.css');
  const slotCss = css.slice(css.indexOf('.sidebar-mascot {'), css.indexOf('.mascot {'));
  assert.match(slotCss, /min-height:\s*0/, '侧栏是 flex，必须允许她被压缩，否则会把底部状态顶出去');
  assert.match(slotCss, /flex:\s*1/, '她应该吃掉导航与底部状态之间那段剩余高度');
  assert.match(css, /@media \(max-height:/, '窗口太矮时应把她藏起来，而不是撑破侧栏');

  // 旧那套"贴右边缘、半收在屏幕外"必须已经删干净
  assert.doesNotMatch(css, /translateX\(50%\)/, '旧的半收位移不该还在');
  const mascotCss = css.slice(css.indexOf('.mascot-body {'));
  assert.doesNotMatch(mascotCss.slice(0, 400), /position:\s*fixed/, '平时不该是浮在页面上的');
});

test('S27 · 切页挥一次手：主入口订阅了路由变化，吉祥物会播 wave', () => {
  const main = read('public/js/main.js');
  assert.match(main, /mascotOnRouteChange/, 'main.js 应在路由变化时通知吉祥物');
  assert.match(main, /onRouteChange\(\(\) => mascotOnRouteChange\(\)\)/, '应挂在路由回调上');

  const mascot = read('public/js/mascot.js');
  assert.match(mascot, /playAnim\('wave'\)/, '切页应播 wave');
  assert.match(mascot, /playAnim\('wave'\);\s*\n\s*remindOnce\(\)/, '第一次露面也要挥一次手');
});

test('S27 · 拖动：握得住、播挣扎、松手飞回原位且不留残余', () => {
  const mascot = read('public/js/mascot.js');
  assert.match(mascot, /addEventListener\('pointerdown'/, '要能按住她');
  assert.match(mascot, /addEventListener\('pointermove'/, '要有拖动过程');
  assert.match(mascot, /addEventListener\('pointerup'/, '松手要处理');
  assert.match(mascot, /setPointerCapture/, '用指针捕获，拖动时别被别的元素抢走');
  assert.match(mascot, /playAnim\('struggle', \{ loop: true \}\)/, '拖动期间挣扎要循环播放');
  assert.match(mascot, /is-dragging/, '拖动时要脱离侧栏浮到最上层');
  assert.match(mascot, /translate\(\$\{flying\.left - home\.left\}px/, '松手要有"飞回原位"的位移');
  assert.match(mascot, /classList\.remove\('is-dragging'\)/, '松手要回到侧栏里的正常状态');

  const css = read('public/css/app.css');
  assert.match(css, /\.mascot-body\.is-dragging[\s\S]*?position:\s*fixed/, '拖动时才是 fixed');
  assert.match(css, /touch-action:\s*none/, '触摸设备上拖动不能被页面滚动抢走');
});

test('S27 · 视频必须静音：素材自带音轨，这个应用是安静的', () => {
  const mascot = read('public/js/mascot.js');
  assert.match(mascot, /muted/, '视频元素要静音');
  assert.match(mascot, /video\.muted = true/, '播放前也要显式静音一次');
  assert.match(
    mascot,
    /<video class="mascot-video" muted/,
    '她是由 JS 挂进侧栏的，标签上就该带 muted',
  );
});

test('S27 · 单击冒一句、悬停冒一句、素材缺失时安静退回静止', () => {
  const mascot = read('public/js/mascot.js');
  assert.match(mascot, /handleClick\(\)/, '单击要处理');
  assert.match(mascot, /addEventListener\('pointerenter'/, '悬停要冒气泡');
  assert.match(mascot, /addEventListener\('pointerleave'/, '移开要收起气泡');
  assert.match(mascot, /addEventListener\('error'/, '素材加载失败要处理');
  assert.match(mascot, /toStill\(\)/, '失败时应退回静止图，而不是卡住');

  const css = read('public/css/app.css');
  assert.match(css, /\.mascot-bubble\.show/, '气泡要有可见状态');
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

test('S27 · 设置页开关仍然真的会挂上/收掉她', () => {
  const settings = read('public/js/pages/settings.js');
  assert.match(settings, /data-toggle-mascot/, '设置页应有吉祥物开关');
  assert.match(settings, /refreshMascot\(\)/, '拨动开关后要立刻生效，不用刷新');
  assert.match(settings, /mascotOn/, '开关的初始状态应来自服务端设置');
});
