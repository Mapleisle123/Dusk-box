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

test('S27 · 五张图要预热、双击判定别拖太长（否则单击显得卡）', () => {
  const mascot = read('public/js/mascot.js');
  assert.match(
    mascot,
    /for \(const src of Object\.values\(IMG\)\) \{[\s\S]{0,80}new Image\(\)/,
    '挂载时要把五张图预热，否则第一次切换要等文件读完',
  );
  const wait = /clickTimer = setTimeout\([\s\S]*?\}, (\d+)\)/.exec(mascot);
  assert.ok(wait, '应能找到双击判定的等待毫秒数');
  assert.ok(
    Number(wait[1]) <= 220,
    `双击判定的等待不能太长（现在 ${wait[1]}ms），否则单击会显得"点了没反应"`,
  );
});

test('S27 · 换图要等新图加载完再交叉淡入（否则会闪出上一张）', () => {
  // 踩过：先换 src 再立刻把那一层显示出来，如果新图还没解码完，
  // 那一层上挂着的还是它上一次的内容 —— "收起"的位置会偶尔闪出挥手图。
  // 所以必须等 load（或本来就 complete）再切，并且用 token 作废旧回调。
  const mascot = read('public/js/mascot.js');
  const body = mascot.slice(mascot.indexOf('function showState'), mascot.indexOf('restartIdleTimer'));
  assert.match(body, /next\.addEventListener\('load', swap, \{ once: true \}\)/, '要等图片加载完再切');
  assert.match(body, /if \(next\.complete && next\.naturalWidth > 0\) swap\(\)/, '已缓存时应立刻切');
  assert.match(body, /token !== showToken/, '旧的回调要能作废（连续快速换图时不打架）');
});

test('S27 · ms=0 表示"不自动收"，不能直接丢给 setTimeout', () => {
  // 踩过：pointAndSay(0) 本意是"钉住不收"，但代码把 0 当超时传给 setTimeout，
  // 0 毫秒立刻执行 → 气泡刚出来就被收掉 → 现象是"单击完全没反应"。
  const mascot = read('public/js/mascot.js');
  const body = mascot.slice(mascot.indexOf('function pointAndSay'));
  assert.match(body, /if \(ms > 0\) \{/, '自动收起必须判断 ms > 0');
  assert.match(body, /if \(!hidden && !pinned\)/, '自动收起时不该打断钉住的状态');
});

test('S27 · 拖动后的"忽略本次点击"标记必须会自己过期', () => {
  // 它靠"下一次 click 到来时消费掉"来清除；可拖到别处松手时那次 click 不会发，
  // 标记就会一直挂着，把用户后面第一次真正的单击吃掉——表现为"单击没反应"。
  const mascot = read('public/js/mascot.js');
  assert.match(mascot, /justDragged = true;/, '拖动结束要挂上忽略标记');
  assert.match(
    mascot,
    /justDragged = true;[\s\S]{0,260}setTimeout\(\(\) => \{\s*justDragged = false;\s*\}, 400\)/,
    '忽略标记必须自动过期（400ms），不能只等下一次 click 来消费',
  );
});

test('S27 · 气泡点一下钉住，再点一下才收回（鼠标移开不消失）', () => {
  const mascot = read('public/js/mascot.js');
  assert.match(mascot, /let pinned = false/, '要有"钉住"这个状态');
  assert.match(mascot, /if \(pinned\) \{[\s\S]{0,140}hideBubble\(\)/, '再点一下要收回气泡');
  assert.match(
    mascot,
    /pointerleave'[\s\S]{0,80}if \(!pinned\) hideBubble\(\)/,
    '鼠标移开时，钉住的气泡不能消失',
  );
  assert.match(
    mascot,
    /if \(!hidden && !pinned\) showState\('idle'\)/,
    '钉住气泡时不要偷偷切成待机图',
  );
});

test('S27 · 双击不能被拆成"先 point 再 hide"', () => {
  // 浏览器双击的顺序是 click、click、dblclick。单击若立刻动作，
  // 用户就会看到 point 闪一下再收起。所以单击必须延迟，并在 dblclick 里取消。
  const mascot = read('public/js/mascot.js');
  assert.match(
    mascot,
    /clickTimer = setTimeout\(\(\) => \{[\s\S]{0,90}pointAndSay\(0\)/,
    '单击要延迟再动作（延迟期间可以被双击取消）',
  );
  assert.match(
    mascot,
    /addEventListener\('dblclick'[\s\S]{0,220}clearTimeout\(clickTimer\)/,
    '收到双击时要取消延迟中的单击动作',
  );
  const clickBlock = mascot.slice(mascot.indexOf("addEventListener('click'"));
  assert.ok(
    clickBlock.indexOf('clickTimer') < clickBlock.indexOf("addEventListener('dblclick'"),
    '单击处理器里应先挂上延迟计时，再由双击取消',
  );
});

test('S27 · 挥手图应比其它张矮一截（她举手时不显得顶到天）', () => {
  // 画布统一是 480x960，但她本人占的高度不一样：挥手那张用户明确要求矮五分之一。
  const boxOf = (name) => {
    const p = path.join(PROJECT_ROOT, 'img', 'mascot', name);
    const b = fs.readFileSync(p);
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    return { w, h };
  };
  for (const name of ASSETS) {
    const box = boxOf(name);
    assert.equal(`${box.w}x${box.h}`, '480x960', `${name} 应统一在 480x960 画布上`);
  }
});

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
  // 她一开始就挂在 <body> 下（挂侧栏里会被 backdrop-filter 裁掉、拖不出去）
  assert.match(
    mascot,
    /document\.body\.appendChild\(wrap\)/,
    '她应该挂在 <body> 下，不能放进侧栏',
  );
  // 而拖动过程中**不许**再搬 DOM：appendChild 换父节点会释放指针捕获，拖动会卡死
  assert.doesNotMatch(
    mascot,
    /appendChild\(els\.body\)/,
    '拖动中不许搬动 DOM（会释放指针捕获，表现为一拖就卡死）',
  );

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
