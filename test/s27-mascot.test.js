/**
 * S27 吉祥物护栏（她住在侧栏那块空白里）。
 *
 * 挑出来的都是"不看浏览器就发现不了、但一坏就很明显"的约定：
 *   - 拖动时必须把她挪到 <body> 底下，否则侧栏的层叠上下文会让她被主内容区盖住；
 *   - 只能有一个拖动入口，别在别处又写一套；
 *   - 素材必须存在、能取到、且是带透明通道的 PNG。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../server/config.js';
import { startTestServer } from './helpers.js';
import { IDLE_AFTER_MS, mascotLineFor, pageKeyOf } from '../public/js/mascot-rules.js';

const read = (rel) => fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');

const ASSETS = ['wave.png', 'struggle.png', 'idle.png', 'point.png'];

test('S27 · 四张素材都在，且是带透明通道的 PNG', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  for (const name of ASSETS) {
    const abs = path.join(PROJECT_ROOT, 'img', 'mascot', name);
    assert.ok(fs.existsSync(abs), `应存在 img/mascot/${name}`);
    const buf = fs.readFileSync(abs);
    assert.deepEqual(
      [...buf.subarray(0, 4)],
      [0x89, 0x50, 0x4e, 0x47],
      `${name} 应是 PNG`,
    );
    assert.equal(buf[25], 6, `${name} 应是 RGBA（带透明通道），否则侧栏里会出现白底方块`);
    const res = await fetch(`${srv.base}/img/mascot/${name}`);
    assert.equal(res.status, 200, `前端应能取到 ${name}`);
  }
});

test('S27 · 拖动时她必须搬到 body 下（否则被主内容区盖住）', () => {
  const mascot = read('public/js/mascot.js');
  assert.match(
    mascot,
    /document\.body\.appendChild\(els\.body\)/,
    '拖动开始时要把她挪到 body 底下，脱离侧栏的层叠上下文',
  );
  assert.match(mascot, /els\.wrap\.appendChild\(els\.body\)/, '松手要放回侧栏那一格');

  const css = read('public/css/app.css');
  assert.match(
    css,
    /\.mascot-body\.is-dragging[\s\S]*?position:\s*fixed/,
    '拖动时她应是浮层',
  );
  assert.match(css, /\.mascot-body\.is-dragging[\s\S]*?z-index:\s*\d+/, '浮层要有层级');
});

test('S27 · 气泡的话术每页一句，并且认得出子路由', () => {
  assert.equal(pageKeyOf('#/plans/3'), 'plans', '带参数的地址也要认出页面');
  assert.equal(pageKeyOf(''), 'home', '空地址当首页');
  for (const key of ['home', 'posts', 'plans', 'projects', 'albums', 'settings']) {
    assert.ok(mascotLineFor(`#/${key}`).length > 0, `${key} 页应该有一句话`);
  }
  assert.equal(mascotLineFor('#/unknown'), '', '不认识的页面就不冒泡');
  assert.equal(IDLE_AFTER_MS, 10000, '静置 10 秒进待机');
});
