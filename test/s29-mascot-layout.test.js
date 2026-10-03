/**
 * S29 吉祥物的"看得见"护栏。
 *
 * 由来：她一度**完全看不见**——DOM 在、图能取到、样式也生效，但整块宽高都是 0。
 * 原因：`.mascot` 是 `position: fixed` 且只写了 `left`（shrink-to-fit），
 * 而 `.mascot-body` 写的是 `width: 100%`、里面两张图又是绝对定位不撑宽度，
 * 于是宽度塌成 0。
 *
 * 这条护栏就是钉住"浮层必须有明确尺寸"这件事：以后谁把它改回百分比宽度，
 * 测试会立刻失败。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../server/config.js';

const css = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'css', 'app.css'), 'utf8');

/** 取一条规则的正文 */
function rule(selector) {
  const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(
    css,
  );
  assert.ok(m, `app.css 里应有 ${selector} 这条规则`);
  return m[1];
}

test('S29 · 浮层必须给明确宽度，否则整块塌成 0×0（她就"看不见"了）', () => {
  const mascot = rule('.mascot');
  assert.match(mascot, /position:\s*fixed/, '她应是浮在侧栏上方的');
  assert.match(mascot, /width:\s*\d+px/, '必须写死一个宽度：fixed + shrink-to-fit 撑不出宽度');
  assert.doesNotMatch(mascot, /width:\s*100%/, '不能用百分比宽度，那会塌成 0');

  const body = rule('.mascot-body');
  assert.match(body, /width:\s*\d+px/, '她本体也要有明确宽度');
  assert.match(body, /aspect-ratio:\s*480\s*\/\s*960/, '宽度配上画布比例才有高度');
});

test('S29 · 收起时用位移露一条，不是靠 display:none 藏起来', () => {
  assert.match(css, /\.mascot\.is-hidden\s+\.mascot-body\s*\{[^}]*transform/, '收起应是位移');
  assert.match(css, /--mascot-shift/, '露出多少应由变量控制，方便一个数调');
  assert.doesNotMatch(
    css,
    /\.mascot\.is-hidden\s*\{[^}]*display:\s*none/,
    '收起不能直接 display:none——那样就看不到露出来的那一条了',
  );
});
