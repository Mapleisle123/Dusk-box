/**
 * S12 字号阶梯测试。
 *
 * 守的规则：**字号只从阶梯里取，且阶梯整体不小于约定基准**。
 *
 * 由来：原来界面字号偏小，而且十来处文字各自写着 13px / 13.5px / 12.5px
 * 这样的魔法数字，等于阶梯形同虚设——想整体调大都不知道该动哪里。
 * 这次把魔法数字收回阶梯，并把这个约束写成测试，防止以后再散出去。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from './helpers.js';

const CSS = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'app.css'), 'utf8');

/** 取出 :root 里的字号阶梯 */
function readLadder() {
  const open = CSS.indexOf(':root {');
  assert.ok(open !== -1, 'app.css 里应有 :root 样式块');
  const close = CSS.indexOf('}', open);
  const block = CSS.slice(open + 1, close);

  const ladder = {};
  for (const m of block.matchAll(/--fs-([a-z0-9]+)\s*:\s*([\d.]+)px\s*;/gi)) {
    ladder[m[1]] = Number(m[2]);
  }
  return ladder;
}

/** 阶梯的顺序（从小到大） */
const ORDER = ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', 'display'];

/** 修复前的字号，用于"不许变小"的回归断言 */
const BEFORE = {
  xs: 11.5,
  sm: 12.5,
  base: 14,
  md: 15,
  lg: 17,
  xl: 21,
  '2xl': 28,
  display: 34,
};

// ---------------------------------------------------------------------------

test('S12 · 字号阶梯齐备且逐级递增', () => {
  const ladder = readLadder();

  for (const key of ORDER) {
    assert.ok(
      typeof ladder[key] === 'number',
      `阶梯缺少 --fs-${key}；所有文字字号都应从这里取`,
    );
  }

  for (let i = 1; i < ORDER.length; i += 1) {
    const prev = ladder[ORDER[i - 1]];
    const curr = ladder[ORDER[i]];
    assert.ok(
      curr > prev,
      `--fs-${ORDER[i]}(${curr}px) 应大于 --fs-${ORDER[i - 1]}(${prev}px)，否则没有层级`,
    );
  }
});

test('S12 · 每一档都不小于调整前的值', () => {
  const ladder = readLadder();
  for (const key of ORDER) {
    assert.ok(
      ladder[key] >= BEFORE[key],
      `--fs-${key} 从 ${BEFORE[key]}px 变成了 ${ladder[key]}px，不应缩小`,
    );
  }
});

test('S12 · 基准字号确实调大了', () => {
  const ladder = readLadder();
  assert.ok(
    ladder.base >= 15,
    `基准字号 --fs-base 目前 ${ladder.base}px，应至少 15px（原来是 14px）`,
  );
  assert.ok(ladder.base > BEFORE.base, '基准字号必须比调整前更大');
});

test('S12 · 正文与主要文本使用基准字号', () => {
  const bodyRule = /(?:^|\n)body\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(bodyRule, 'app.css 里应有独立的 body 样式块');
  assert.ok(
    /font-size:\s*var\(--fs-base\)/.test(bodyRule[1]),
    'body 的字号应取自 --fs-base，这样调整阶梯才能整体生效',
  );

  assert.ok(
    /\.md-body\s*\{[^}]*font-size:\s*var\(--fs-md\)/.test(CSS),
    '文章正文（.md-body）应使用 --fs-md',
  );
});

test('S12 · 文本字号统一走阶梯，不再散落魔法数字', () => {
  const hardcoded = [...CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));

  // 唯一允许硬编码的是"固定尺寸图形内部的小字"：
  //   .mini-ring text(9px) / .ring-label(9.5px) / .cal-cell(10px)
  // 它们的字号与容器尺寸绑定，跟着阶梯放大会撑破容器。
  for (const size of hardcoded) {
    assert.ok(
      size <= 10,
      `发现硬编码字号 ${size}px。除固定图形内的小字（≤10px）外，字号都应写成 var(--fs-*)`,
    );
  }
  assert.ok(
    hardcoded.length <= 4,
    `硬编码字号有 ${hardcoded.length} 处，超出预期的固定图形小字数量，请检查是否又有魔法数字散出来`,
  );
});

test('S12 · 阶梯变量被真正使用，而不是摆设', () => {
  const used = (CSS.match(/var\(--fs-/g) || []).length;
  assert.ok(
    used >= 60,
    `目前只有 ${used} 处引用阶梯变量，太少——说明仍有大量字号绕过了阶梯`,
  );
});
