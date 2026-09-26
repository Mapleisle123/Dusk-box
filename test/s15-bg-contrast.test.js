/**
 * S15 深色模式背景图可读性测试。
 *
 * 守的规则：**背景图不能把压在它上面的文字拉垮**。
 *
 * 这条规则的由来：深色模式下的纸面是近黑的（--bg #16140F），
 * 而纱（--bg-veil）只有 50%，于是"近黑的纱"与"明亮的照片"各占一半——
 * 白底照片上的页头副标题实测只剩 1.4:1，比"看不清"更糟。
 *
 * 修法是在图上再加一层压暗（--bg-dim），且只在深色模式下生效。
 * 这里不靠肉眼，而是把整条合成链算一遍：
 *   图片最亮的像素 → 压暗层 → 半透明底色纱 → 实际得到的底色
 * 再拿它和页头各级文字算 WCAG 对比度。
 *
 * 为什么按"图片最亮的像素"算：文字会压在图的任意位置，
 * 最亮处就是最坏情况。只有最坏情况达标，才谈得上"看得清"。
 *
 * 装饰性的主题晕染（--glow / --glow-2）不参与计算：它们是随距离衰减的
 * radial-gradient，到页头文字那一带已衰减到 2% 以下；真机实测会兜底。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from './helpers.js';

const CSS = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'app.css'), 'utf8');

/** 取出某个选择器的样式块内容 */
function readBlock(selector) {
  const idx = CSS.indexOf(selector);
  if (idx === -1) throw new Error(`app.css 里找不到样式块：${selector}`);
  const open = CSS.indexOf('{', idx);
  const close = CSS.indexOf('}', open);
  if (open === -1 || close === -1) throw new Error(`样式块不完整：${selector}`);
  return CSS.slice(open + 1, close);
}

/** 把样式块里的 --变量 读成对象 */
function readVars(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}

/** 合并 :root 与深色模式的变量表（后者覆盖前者，与浏览器的层叠一致） */
function darkVars() {
  return {
    ...readVars(readBlock(':root {')),
    ...readVars(readBlock('html[data-mode="dark"] {')),
  };
}

/** #RRGGBB → [r, g, b] */
function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`只支持 #RRGGBB 形式的颜色，收到：${hex}`);
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** 相对亮度（WCAG 2.1） */
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 两色对比度（1~21） */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 保留两位小数，便于断言信息可读 */
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * 解析 `color-mix(in srgb, var(--x) N%, transparent)`。
 * 这种写法在 sRGB 空间里就是把颜色 x 的 alpha 设为 N%，
 * 压到不透明的底上即：`x * N% + 底色 * (1 - N%)`。
 */
function parseMix(expr, label) {
  const m =
    /color-mix\(\s*in\s+srgb\s*,\s*var\(--([a-z0-9-]+)\)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)/i.exec(
      String(expr),
    );
  assert.ok(
    m,
    `${label} 应写成 color-mix(in srgb, var(--底色) N%, transparent)，实际是：${expr}`,
  );
  return { base: m[1], alpha: Number(m[2]) / 100 };
}

/** 把一层半透明色压到背景上 */
function over(layerRgb, alpha, backdropRgb) {
  return layerRgb.map((c, i) => c * alpha + backdropRgb[i] * (1 - alpha));
}

/** 读出某条规则里 color 引用到的变量名；规则不存在或没写 color 就用 fallback */
function colorVarOf(selector, fallback) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (!rule) return fallback;
  const m = /(?:^|[;{\s])color\s*:\s*var\(--([a-z0-9-]+)\)/i.exec(rule[1]);
  return m ? m[1] : fallback;
}

/** 取出 html[data-bg="on"] body 的样式块 */
function readBgLayerBlock() {
  const m = /html\[data-bg="on"\]\s*body\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(m, 'app.css 里应有 html[data-bg="on"] body 的图层规则');
  return m[1];
}

/** 图片最亮的像素——最坏情况 */
const BRIGHTEST_PIXEL = [255, 255, 255];

/**
 * 算出"图片最亮处"经过整条合成链之后实际得到的底色。
 * @param {boolean} withDim 是否计入压暗层（传 false 用来证明这层确实必需）
 */
function compositeOnBrightestPixel(withDim = true) {
  const vars = darkVars();
  const base = hexToRgb(vars['bg']);

  let color = BRIGHTEST_PIXEL.slice();
  if (withDim) {
    const dim = parseMix(vars['bg-dim'], '深色模式的 --bg-dim');
    color = over(hexToRgb(vars[dim.base]), dim.alpha, color);
  }
  const veil = parseMix(vars['bg-veil'], '--bg-veil');
  color = over(hexToRgb(vars[veil.base]), veil.alpha, color);
  return color;
}

/** 页头各级文字用的变量名（从规则里读，别在测试里另抄一份颜色） */
function headingTextVars() {
  return {
    页头标题: colorVarOf('.page-head h1', 'text'),
    页头副标题: colorVarOf('.page-head .sub', 'text-3'),
  };
}

// ---------------------------------------------------------------------------

test('S15 · 深色模式下，图片最亮处的页头文字也够清晰', () => {
  const vars = darkVars();
  const composite = compositeOnBrightestPixel();

  for (const [label, varName] of Object.entries(headingTextVars())) {
    const ratio = contrast(hexToRgb(vars[varName]), composite);
    assert.ok(
      ratio >= 4.5,
      `${label}（--${varName}）压在背景图最亮处只有 ${round2(ratio)}:1，低于 AA 的 4.5:1。` +
        '要么把 --bg-dim 调浓，要么别让这级文字直接压在图上',
    );
  }
});

test('S15 · 页头标题在图上仍然醒目，不是"勉强看得清"', () => {
  const vars = darkVars();
  const composite = compositeOnBrightestPixel();
  const varName = colorVarOf('.page-head h1', 'text');
  const ratio = contrast(hexToRgb(vars[varName]), composite);

  assert.ok(
    ratio >= 7,
    `页头标题压在背景图最亮处只有 ${round2(ratio)}:1，没达到 AAA 的 7:1——` +
      '标题是页面的主视觉，在背景图上不该只是勉强够用',
  );
});

test('S15 · 这层压暗是必需的（去掉它就不达标）', () => {
  const vars = darkVars();
  const sub = hexToRgb(vars[colorVarOf('.page-head .sub', 'text-3')]);

  const without = contrast(sub, compositeOnBrightestPixel(false));
  const withDim = contrast(sub, compositeOnBrightestPixel(true));

  assert.ok(
    without < 4.5,
    `不加压暗层时副标题就有 ${round2(without)}:1，那这层就是多余的——` +
      '该删掉，而不是白白把图片压暗',
  );
  assert.ok(
    withDim > without,
    '加了压暗层之后，对比度必须真的变高',
  );
});

test('S15 · 浅色模式不受影响：压暗层默认是透明的', () => {
  const root = readVars(readBlock(':root {'));

  assert.equal(
    String(root['bg-dim'] || '').replace(/\s+/g, ''),
    'transparent',
    '--bg-dim 在 :root 里应为 transparent：这次只要求深色下压暗，' +
      '浅色下动它会把原本可用的观感改坏',
  );

  const dark = readVars(readBlock('html[data-mode="dark"] {'));
  assert.ok(dark['bg-dim'], '深色模式必须覆盖 --bg-dim，否则这条修法根本没生效');
});

test('S15 · 「半透」仍是 50%，没有拿纱去顶压暗', () => {
  const root = readVars(readBlock(':root {'));
  const veil = parseMix(root['bg-veil'], ':root 的 --bg-veil');

  assert.equal(
    veil.alpha,
    0.5,
    '纱应保持 50%（用户要的"透明度一半左右"）。压暗是另一层的事：' +
      '拿纱去顶的话，"半透"这个性质就名存实亡了',
  );

  const dark = readVars(readBlock('html[data-mode="dark"] {'));
  assert.equal(
    dark['bg-veil'],
    undefined,
    '深色模式不该另设一份 --bg-veil：那会与 S13 里"纱是 50%"的断言悄悄分叉',
  );
});

test('S15 · 压暗层写进了图层数组，且压在图片之上', () => {
  const block = readBgLayerBlock();

  const dimAt = block.indexOf('var(--bg-dim)');
  const photoAt = block.indexOf('var(--bg-photo)');

  assert.ok(dimAt !== -1, '图层里应包含 --bg-dim');
  assert.ok(photoAt !== -1, '图层里应包含 --bg-photo（那张图）');
  assert.ok(
    dimAt < photoAt,
    '压暗层必须写在图片**之前**：background-image 是前面的层压后面的层，' +
      '写反了图片会把压暗层整个盖住，等于白压',
  );
});

test('S15 · 图层数与 background-* 的取值个数一一对应', () => {
  const block = readBgLayerBlock();

  const layers = (block.match(/radial-gradient\(|linear-gradient\(|var\(--bg-photo\)/g) || [])
    .length;
  assert.ok(layers >= 5, `图层偏少（只有 ${layers} 层），压暗层可能没加进去`);

  // 多重背景的取值列表会**循环复用**：少写一个值不会报错，
  // 但后面的层会悄悄套用到错误的取值上（比如 cover 落到别的层、
  // 图片变成 auto 不再铺满），所以逐个数一遍。
  for (const prop of ['background-size', 'background-position', 'background-repeat']) {
    const decl = new RegExp(`${prop}\\s*:\\s*([^;]+);`).exec(block);
    assert.ok(decl, `图层规则里应有 ${prop}`);
    assert.equal(
      decl[1].split(',').length,
      layers,
      `${prop} 有 ${decl[1].split(',').length} 个取值，但图层有 ${layers} 层：` +
        '取值列表会自动循环复用，少写的那些会让后面的层套到错误的取值上，' +
        '而这一点在界面上未必看得出来',
    );
  }
});
