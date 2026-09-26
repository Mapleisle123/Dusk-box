/**
 * S11 主题可读性测试。
 *
 * 守的规则：**次级/三级文字必须真的看得清**。
 *
 * 这条规则的由来：深色模式下 --text-2 / --text-3 定得过浅，
 * 说明文字、辅助信息、卡片元数据都发灰，"有点不清晰"。
 * 靠肉眼盯颜色是守不住的，所以这里直接把配色算成 WCAG 对比度来断言。
 *
 * 对比度阈值参考 WCAG 2.1：
 *   4.5 : 1  —— AA，正常大小的正文
 *   7   : 1  —— AAA，更舒服的正文
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
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** #RRGGBB → 相对亮度 */
function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`只支持 #RRGGBB 形式的颜色，收到：${hex}`);
  const int = parseInt(m[1], 16);
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** 两色对比度（1~21） */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** 保留两位小数，便于断言信息可读 */
const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------

test('S11 · 深色模式：次级文字在每一层底色上都达到 AA', () => {
  const dark = readVars(readBlock('html[data-mode="dark"] {'));

  // 深色模式下最浅的底色是 surface-3，对比度最低 → 拿它当基准
  for (const [surfaceName, surface] of Object.entries({
    '--bg': dark['bg'],
    '--surface': dark.surface,
    '--surface-2': dark['surface-2'],
    '--surface-3': dark['surface-3'],
  })) {
    const ratio = contrast(dark['text-2'], surface);
    assert.ok(
      ratio >= 4.5,
      `深色模式 --text-2 压在 ${surfaceName} 上只有 ${round2(ratio)}:1，低于 AA 的 4.5:1`,
    );
  }
});

test('S11 · 深色模式：三级文字（说明/元信息）也达到 AA', () => {
  const dark = readVars(readBlock('html[data-mode="dark"] {'));
  const ratioOnBg = contrast(dark['text-3'], dark['bg']);
  const ratioOnSurface3 = contrast(dark['text-3'], dark['surface-3']);

  assert.ok(
    ratioOnBg >= 4.5,
    `深色模式 --text-3 压在 --bg 上只有 ${round2(ratioOnBg)}:1，低于 AA 的 4.5:1`,
  );
  assert.ok(
    ratioOnSurface3 >= 4.5,
    `深色模式 --text-3 压在 --surface-3 上只有 ${round2(ratioOnSurface3)}:1，低于 AA 的 4.5:1`,
  );
});

test('S11 · 深色模式：正文保持高对比，且层级不倒挂', () => {
  const dark = readVars(readBlock('html[data-mode="dark"] {'));
  const body = contrast(dark.text, dark['bg']);
  assert.ok(body >= 7, `深色模式正文对比度只有 ${round2(body)}:1，应达到 AAA 的 7:1`);

  const l1 = luminance(dark.text);
  const l2 = luminance(dark['text-2']);
  const l3 = luminance(dark['text-3']);
  assert.ok(l1 > l2, '正文应比次级文字更亮，否则层级消失');
  assert.ok(l2 > l3, '次级文字应比三级文字更亮，否则层级消失');
});

test('S11 · 浅色模式对比度不倒退', () => {
  const light = readVars(readBlock(':root {'));

  // 浅色模式这次不做改动（用户只反馈了深色），但守住它不继续变浅。
  const bodyRatio = contrast(light.text, light['surface']);
  assert.ok(bodyRatio >= 7, `浅色模式正文对比度 ${round2(bodyRatio)}:1 低于 7:1`);

  const secondary = contrast(light['text-2'], light['surface']);
  assert.ok(secondary >= 4.5, `浅色模式 --text-2 对比度 ${round2(secondary)}:1 低于 4.5:1`);

  const tertiary = contrast(light['text-3'], light['surface']);
  assert.ok(tertiary >= 3, `浅色模式 --text-3 对比度 ${round2(tertiary)}:1 已低于 3:1`);
});

test('S11 · 深色模式的次级文字确实比修复前更亮', () => {
  const dark = readVars(readBlock('html[data-mode="dark"] {'));

  // 修复前：#B3A99B / #857B6D。用亮度下限卡住，防止以后再调回去。
  assert.ok(
    luminance(dark['text-2']) >= luminance('#B3A99B'),
    '--text-2 不应比修复前更暗',
  );
  assert.ok(
    luminance(dark['text-3']) > luminance('#857B6D'),
    '--text-3 必须比原来的 #857B6D 更亮',
  );
  assert.ok(
    contrast(dark['text-3'], dark['surface-3']) > contrast('#857B6D', dark['surface-3']),
    '--text-3 的可读性必须真的提升，而不只是换了个色号',
  );
});
