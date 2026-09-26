/**
 * 开关类按钮的「视觉状态」必须跟得上实际状态。
 *
 * 起因：设置页的深色模式开关，点下去之后页面确实变色了，但按钮自己不动。
 * 根因是在 await 之后才去读 e.currentTarget —— 按 DOM 规范，事件派发一结束
 * currentTarget 就被置为 null，于是那句 classList.toggle 抛 TypeError，
 * 又被处理器自己的 catch 吞成一条错误提示。结果就是"功能生效了、界面没反应"。
 *
 * 这里守两件事：
 *   1) 通用护栏：全前端扫描所有 async 事件处理器，currentTarget 一旦出现在
 *      第一个 await 之后就算违规。这条能防住整类问题，不只是这两处。
 *   2) 行为契约：开关的最终状态由 store.settings（服务端回报的值）推导，
 *      而不是由本地猜出来的 next 推导。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { PUBLIC_DIR } = await import('./helpers.js');

const JS_DIR = path.join(PUBLIC_DIR, 'js');
const SETTINGS_JS = fs.readFileSync(path.join(JS_DIR, 'pages', 'settings.js'), 'utf8');
const STORE_JS = fs.readFileSync(path.join(JS_DIR, 'store.js'), 'utf8');

// ---------------------------------------------------------------------------
// 源码扫描工具
// ---------------------------------------------------------------------------

/** 递归收集某个目录下所有 .js 文件 */
function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(abs);
    return entry.name.endsWith('.js') ? [abs] : [];
  });
}

/**
 * 把注释替换成等长空白——行号与字符下标都保持不变。
 *
 * 这一步不能省：注释里会自然地写出 `await`、`e.currentTarget` 这些词，
 * 不剥掉的话扫描器会被自己的说明文字误伤（本项目就踩过这一回）。
 * 字符串整体保留，这样字符串里的 `//` 不会被误当成注释。
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
    } else if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < src.length) {
        out += '  ';
        i += 2;
      }
    } else if (ch === '"' || ch === "'" || ch === '`') {
      out += ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        const closing = src[i] === ch;
        i += 1;
        if (closing) break;
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * 从 `{` 之后一直配平到它对应的 `}`，返回块体内容。
 * 模板字符串里的 `${...}` 本身是配对的，不影响配平。
 */
function blockBody(code, bodyStart) {
  let depth = 1;
  let i = bodyStart;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  return code.slice(bodyStart, i - 1);
}

const HANDLER_RE = /addEventListener\(\s*['"]([\w-]+)['"]\s*,\s*(async\s+)?\(([^)]*)\)\s*=>\s*\{/g;

/** 找出源码里所有带块体的 addEventListener 处理器（注释已剥离） */
function eventHandlers(src) {
  const code = stripComments(src);
  const found = [];
  let m;
  HANDLER_RE.lastIndex = 0;
  while ((m = HANDLER_RE.exec(code)) !== null) {
    found.push({
      event: m[1],
      isAsync: Boolean(m[2]),
      params: m[3].trim(),
      body: blockBody(code, HANDLER_RE.lastIndex),
      line: code.slice(0, m.index).split('\n').length,
    });
  }
  return found;
}

/** 取某个查询选择器后面紧跟的那个 async 事件处理器的函数体（注释已剥离） */
function handlerBodyAfter(src, marker) {
  const code = stripComments(src);
  const at = code.indexOf(marker);
  assert.ok(at >= 0, `源码里找不到 ${marker}`);
  const rest = code.slice(at);
  const m = /addEventListener\(\s*['"]\w+['"]\s*,\s*async\s*\([^)]*\)\s*=>\s*\{/.exec(rest);
  assert.ok(m, `${marker} 后面应紧跟一个 async 的 click 处理器`);
  return blockBody(code, at + m.index + m[0].length);
}

/**
 * 取出 `classList.toggle('on', ...)` 那一整条语句。
 * 只切到分号为止——切宽了会把后面几行也框进来（比如 toastSuccess(next…)，误报）。
 */
function toggleStatement(body) {
  const at = body.indexOf("classList.toggle('on'");
  assert.ok(at > -1, "处理器里应有一句 classList.toggle('on', ...)");
  const semi = body.indexOf(';', at);
  return body.slice(at, semi === -1 ? at + 200 : semi);
}

// ---------------------------------------------------------------------------
// 1. 通用护栏
// ---------------------------------------------------------------------------

test('S16 · async 事件处理器里，currentTarget 不许出现在 await 之后', () => {
  const offenders = [];

  for (const file of jsFiles(JS_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const h of eventHandlers(src)) {
      if (!h.isAsync) continue;
      const firstAwait = h.body.indexOf('await');
      if (firstAwait === -1) continue;
      if (/\.currentTarget\b/.test(h.body.slice(firstAwait))) {
        offenders.push(`${path.relative(PUBLIC_DIR, file)}:${h.line} 的 '${h.event}' 处理器`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'e.currentTarget 在 await 之后会变成 null（事件派发此时已结束），再读它会抛 TypeError，' +
      '通常还被自己的 catch 吞掉，表现为"功能生效了、界面没反应"。' +
      `请在 await 之前先取出按钮：const btn = e.currentTarget。\n违规处：\n${offenders.join('\n')}`,
  );
});

test('S16 · 扫描器自身有效，护栏不是空转', () => {
  const handlers = eventHandlers(SETTINGS_JS);
  assert.ok(
    handlers.length >= 8,
    `settings.js 里应能扫出至少 8 个事件处理器，实际只找到 ${handlers.length} 个 —— 正则可能失灵了`,
  );
  assert.ok(
    handlers.some((h) => h.isAsync),
    '应能识别出 async 处理器，否则第 1 条测试永远通过（空转）',
  );

  const files = jsFiles(JS_DIR);
  assert.ok(files.length >= 8, `public/js 下应扫出至少 8 个 js 文件，实际 ${files.length}`);
});

test('S16 · 扫描器能分辨违规写法与正确写法', () => {
  const bad = `
    el.addEventListener('click', async (e) => {
      await save();
      e.currentTarget.classList.add('on');
    });
  `;
  const badH = eventHandlers(bad)[0];
  assert.ok(badH?.isAsync, '应认出这是 async 处理器');
  const badAwait = badH.body.indexOf('await');
  assert.ok(
    /\.currentTarget\b/.test(badH.body.slice(badAwait)),
    '自检失败：await 之后读 currentTarget 这种写法必须被判为违规',
  );

  const good = `
    el.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      await save();
      btn.classList.add('on');
    });
  `;
  const goodH = eventHandlers(good)[0];
  const goodAwait = goodH.body.indexOf('await');
  assert.ok(
    !/\.currentTarget\b/.test(goodH.body.slice(goodAwait)),
    '自检失败：先把按钮取出来的写法不该被判为违规',
  );
});

test('S16 · 扫描器会忽视注释里的同名写法（否则会被说明文字误伤）', () => {
  const withComment = `
    el.addEventListener('click', async (e) => {
      // 必须在 await 之前取出，否则 e.currentTarget 就是 null 了
      const btn = e.currentTarget;
      await save();
      btn.classList.add('on');
    });
  `;
  const h = eventHandlers(withComment)[0];
  const firstAwait = h.body.indexOf('await');
  assert.ok(
    !/\.currentTarget\b/.test(h.body.slice(firstAwait)),
    '注释里的 "await … e.currentTarget" 不该被判为违规；' +
      '扫描前必须先剥掉注释，否则每写一句解释就会误报',
  );
  assert.ok(h.body.includes('const btn'), '剥注释不能把代码一起剥掉');
});

// ---------------------------------------------------------------------------
// 2. 两个开关的行为契约
// ---------------------------------------------------------------------------

test('S16 · 深色模式开关：状态由服务端设置推导，且按钮在 await 前取出', () => {
  const body = handlerBodyAfter(SETTINGS_JS, '[data-toggle-mode]');

  assert.ok(
    /const\s+btn\s*=\s*e\.currentTarget/.test(body),
    '应先在 await 之前把按钮取出来（await 之后 e.currentTarget 就是 null 了）',
  );

  const stmt = toggleStatement(body);
  assert.ok(
    /store\.settings/.test(stmt),
    '开关的最终状态要读 store.settings（服务端回报的设置）——' +
      '万一写库失败或被规范化，按钮也不会显示一个假的"已开启"',
  );
  assert.ok(
    !/\bnext\b/.test(stmt),
    '不能用本地猜出来的 next 决定按钮状态：它只代表"我们请求了什么"，' +
      '不代表"服务端实际接受了什么"',
  );
});

test('S16 · 自动备份开关：与深色模式开关同一套写法', () => {
  const body = handlerBodyAfter(SETTINGS_JS, '[data-toggle-backup]');

  assert.ok(/const\s+btn\s*=\s*e\.currentTarget/.test(body), '应先在 await 之前把按钮取出来');

  const stmt = toggleStatement(body);
  assert.ok(/store\.settings/.test(stmt), '开关状态要读 store.settings');
  assert.ok(!/\bnext\b/.test(stmt), '不能用本地猜的 next 决定按钮状态');
});

test('S16 · store.settings 确实会被服务端返回值刷新（上面两条契约的前提）', () => {
  assert.ok(
    /async setColorMode\s*\(/.test(STORE_JS) && /async update\s*\(/.test(STORE_JS),
    'store 应有 setColorMode 与 update',
  );
  const refreshes = STORE_JS.match(/this\.settings\s*=\s*res\.settings/g) || [];
  assert.ok(
    refreshes.length >= 3,
    `store.load / setTheme / setColorMode / update 都应把服务端返回的 settings 写回 this.settings，` +
      `只找到 ${refreshes.length} 处 —— 少了的话，开关读到的就是过期状态`,
  );
});

test('S16 · 开关的两种视觉状态都有对应样式（否则"动了"也看不出来）', () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'app.css'), 'utf8');
  assert.ok(/\.switch\s*\{/.test(css), '应有 .switch 基础样式');
  assert.ok(/\.switch\.on\s*\{/.test(css), '应有 .switch.on 样式（轨道变色）');
  assert.ok(
    /\.switch\.on::after\s*\{[^}]*transform\s*:\s*translateX\(/.test(css),
    '.switch.on 必须让滑块（::after）位移，否则用户感知不到开关被打开',
  );
});
