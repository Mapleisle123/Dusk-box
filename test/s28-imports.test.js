/**
 * S28 前端 import 解析护栏。
 *
 * 由来：吉祥物那次白屏——`mascot.js` 从 `mascot-rules.js` 取了一个**对方没导出**的名字，
 * 浏览器加载模块图时直接抛错，整个前端起不来，页面一片白。
 * 而原来的"语法检查"只跑 `node --check`，它**不解析 import**，所以放过去了。
 *
 * 这里把 public/js 全树的 import 走一遍：每个 `import { a, b } from './x.js'`
 * 里的名字，对方都真的导出过没有。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../server/config.js';

const JS_DIR = path.join(PROJECT_ROOT, 'public', 'js');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

/** 这个文件导出了哪些名字 */
function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)) {
    names.add(m[1]);
  }
  // export { a, b as c } / export { x } from './y.js'
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const asMatch = /\bas\s+(\w+)$/.exec(piece);
      names.add(asMatch ? asMatch[1] : piece.split(/\s+/)[0]);
    }
  }
  return names;
}

test('S28 · 前端每个 import 的名字，对方都真的导出过（白屏往往就是这里错）', () => {
  const files = walk(JS_DIR);
  assert.ok(files.length >= 10, `前端模块数量偏少（只有 ${files.length} 个）`);

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), m[2]);
      if (!fs.existsSync(target)) {
        assert.fail(`${path.basename(file)} 引用了不存在的模块：${m[2]}`);
      }
      const exported = exportsOf(fs.readFileSync(target, 'utf8'));
      for (const part of m[1].split(',')) {
        const piece = part.trim();
        if (!piece || piece.startsWith('type ')) continue;
        const name = (/\bas\s+/.test(piece) ? piece.split(/\s+as\s+/)[0] : piece).trim();
        assert.ok(
          exported.has(name),
          `${path.basename(file)} 从 ${m[2]} 取了 ${name}，但对方没有导出它——浏览器会整页白屏`,
        );
      }
    }
  }
});
