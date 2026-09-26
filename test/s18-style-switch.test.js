/**
 * S18 外观风格切换测试（简约 · 液态玻璃 ⇄ 新粗野主义）。
 *
 * 这次新增的是**第二个外观维度**：data-style。
 * 它与 data-theme（主色调）、data-mode（深浅色）互相独立，三者可以任意组合——
 * 也就是说 6 × 2 × 2 = 24 种组合都得成立，而不是"两套皮肤"。
 *
 * 这类"再来一种"的改动有三个很容易踩空的地方，这组测试就是冲着它们去的：
 *
 *   1. **加了字段、忘了加白名单。** 后端的 EDITABLE 是一张显式清单，
 *      漏掉 'style' 的话接口会返回 200、值却纹丝不动，
 *      界面上表现为"点了没反应"，而且没有任何报错。
 *   2. **加了选项、忘了写样式。** 选中之后界面完全没变化，
 *      比报错更难查——因为一切"成功"。
 *   3. **写了个空壳覆盖。** 比如把 --pane 又写成 var(--surface)、
 *      或者把某个令牌填成和默认值一样的值。看起来有一大段样式，
 *      实际什么都没改。所以这里逐项核对：**每条覆盖都必须真的改变取值**。
 *
 * 还有一条本次特意钉住的坑：--pane-hi 不能写成 none。
 * 它是和别的阴影拼在同一个 box-shadow 列表里的（`var(--shadow-sm), var(--pane-hi)`），
 * 而 none 只允许单独出现——写进去会让**整条声明失效**，阴影一起消失，且不报错。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 必须在任何配置读写发生之前设置（与 S6 同一套做法）
const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-cfg-s18-'));
process.env.QSX_CONFIG_FILE = path.join(configHome, 'config.json');

const { startTestServer, ok, PUBLIC_DIR } = await import('./helpers.js');
const { STYLES } = await import('../server/routes/settings.js');

test.after(() => {
  delete process.env.QSX_CONFIG_FILE;
  fs.rmSync(configHome, { recursive: true, force: true });
});

const CSS = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'app.css'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const STORE_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'store.js'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'pages', 'settings.js'), 'utf8');

// ---------------------------------------------------------------------------
// 读取工具
// ---------------------------------------------------------------------------

/** 取出某个选择器后紧跟的样式块内容 */
function blockOf(selector) {
  const idx = CSS.indexOf(selector);
  assert.ok(idx !== -1, `app.css 里应有 ${selector} 样式块`);
  const open = CSS.indexOf('{', idx);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open + 1, close);
}

/** 把样式块里的 --变量 读成对象 */
function vars(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}

const BRUTAL_SELECTOR = 'html[data-style="brutal"] {';
const brutalVars = vars(blockOf(BRUTAL_SELECTOR));
const rootVars = vars(blockOf(':root {'));

/** 粗野主义那一段（从它的令牌块起，到基础样式之前），用来查它里面的组件覆盖 */
const brutalSection = CSS.slice(
  CSS.indexOf(BRUTAL_SELECTOR),
  CSS.indexOf('/* ---- 基础 ---- */', CSS.indexOf(BRUTAL_SELECTOR)),
);

// ---------------------------------------------------------------------------
// 1. 后端：可切换、可持久化、有白名单
// ---------------------------------------------------------------------------

test('S18 · 外观风格可切换并持久化，默认是简约', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const first = ok(await srv.get('/api/settings'));
  assert.deepEqual(first.runtime.styles, STYLES, '运行期信息里应列出可选的风格');
  assert.equal(first.settings.style, 'liquid', '默认风格应是简约·液态玻璃');

  for (const id of STYLES) {
    const res = ok(await srv.put('/api/settings', { style: id }));
    assert.equal(res.settings.style, id, `切到 ${id} 后应返回该值`);
  }

  // 重新读一次，确认真的写进库了，而不是只在响应里过了一遍
  assert.equal(
    ok(await srv.get('/api/settings')).settings.style,
    STYLES[STYLES.length - 1],
    '重新读取时应仍是最后切换的那个风格',
  );
});

test('S18 · 非法风格被拒绝，且一批里有一项非法就整批不写', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  assert.equal((await srv.put('/api/settings', { style: 'neon' })).status, 400);
  assert.equal((await srv.put('/api/settings', { style: '' })).status, 400);
  assert.equal((await srv.put('/api/settings', { style: 'LIQUID' })).status, 400);

  // 先把主题改到一个非默认值，再发一批"合法的主题 + 非法的风格"
  ok(await srv.put('/api/settings', { theme: 'jade' }));
  const mixed = await srv.put('/api/settings', { theme: 'amber', style: 'neon' });
  assert.equal(mixed.status, 400);
  assert.equal(
    ok(await srv.get('/api/settings')).settings.theme,
    'jade',
    '同一批里只要有一项非法，其它项也不该被写进去（要么全成，要么全不成）',
  );
});

// ---------------------------------------------------------------------------
// 2. 样式：两种风格都得真的存在，而且是**相反**的材质
// ---------------------------------------------------------------------------

test('S18 · 粗野主义覆盖的每一项都必须真的改变取值（不许有空壳覆盖）', () => {
  const changed = Object.keys(brutalVars).filter((k) => rootVars[k] !== brutalVars[k]);

  assert.ok(
    changed.length >= 12,
    `粗野主义只覆盖了 ${changed.length} 个令牌，太少了。` +
      '它要换掉的是整套材质（光场、模糊、填充、圆角、边框、阴影），' +
      '覆盖得太少说明它更接近"换个配色"，而不是另一种材质语言',
  );

  const noop = Object.keys(brutalVars).filter((k) => rootVars[k] === brutalVars[k]);
  assert.deepEqual(
    noop,
    [],
    `这些令牌在粗野主义里被重新声明了，但取值与默认完全相同：${noop.join('、')}。` +
      '它们是空壳覆盖——看着改了一大段，实际什么都没变',
  );
});

test('S18 · 粗野主义把玻璃赖以成立的三样东西都关掉了', () => {
  // 液态玻璃靠的是：底下有光、边上有一道亮线、中间有模糊。
  // 粗野主义是相反的材质语言，这三样必须一样都不留。
  for (const token of ['glow', 'glow-2', 'glow-3']) {
    assert.match(
      brutalVars[token] ?? '',
      /^transparent$/,
      `粗野主义下 --${token} 应关掉（透明）：它是"底上有光在流动"，` +
        '与"平的块面"直接冲突',
    );
  }

  assert.equal(brutalVars['pane-blur'], '0px', '粗野主义不做模糊');
  assert.equal(brutalVars['pane-blur-soft'], '0px', '粗野主义不做模糊');
  assert.equal(brutalVars['pane-sat'], '100%', '不做模糊就不该再提升饱和度');

  for (const token of ['pane', 'pane-2', 'pane-card']) {
    const value = brutalVars[token] ?? '';
    assert.ok(
      !/transparent|color-mix/.test(value),
      `粗野主义下 --${token} 仍然是半透明的（${value}）：` +
        '这套风格的层级靠明度差 + 粗边 + 硬影来读，块面必须是实的',
    );
  }

  assert.equal(brutalVars['grain-opacity'], '0', '噪点是为渐变防色带用的，没有渐变就不需要它');
  assert.equal(brutalVars['bg-photo'], 'none !important', '粗野主义不看背景图：照片是"景"，它要的是"面"');
});

test('S18 · 粗野主义的结构：直角、粗边、硬偏移影', () => {
  for (const token of ['radius-sm', 'radius', 'radius-lg', 'radius-xl']) {
    assert.equal(brutalVars[token], '0', `粗野主义下 --${token} 应为 0：这套风格里没有圆角矩形`);
  }
  assert.equal(brutalVars['bw'], '2px', '粗野主义的边要粗，1px 细边读不出"块面"');
  assert.equal(brutalVars['pane-edge'], 'var(--ink)', '边要用墨色，它是这套风格的骨架');

  // 硬偏移：x y 0 实色。第三个值是模糊半径，必须是 0——
  // 一旦有模糊，它立刻变回"柔和阴影"，那就不是粗野主义了。
  for (const [token, offset] of [
    ['shadow-sm', '2px 2px'],
    ['shadow', '4px 4px'],
    ['shadow-lg', '6px 6px'],
  ]) {
    assert.equal(
      brutalVars[token],
      `${offset} 0 var(--ink)`,
      `粗野主义下 --${token} 应是"${offset} 0 var(--ink)"这样的硬偏移影（零模糊、实色），实际是：${brutalVars[token]}`,
    );
  }
  assert.equal(brutalVars['shadow-press'], 'none', '按下时应该"沉进去"，即阴影消失');
});

test('S18 · --pane-hi 不能写成 none（那会让整条 box-shadow 失效）', () => {
  // 这是一个只会在运行时暴露、且不报错的坑：
  // --pane-hi 永远和别的阴影拼在同一个列表里（`var(--shadow-sm), var(--pane-hi)`），
  // 而 box-shadow 的 none 只允许单独出现。写了 none 之后整条声明被丢弃，
  // 于是"阴影一起消失"——界面只是变得有点平，很难联想到是这里。
  assert.notEqual(
    brutalVars['pane-hi'],
    'none',
    '--pane-hi 写成了 none：它会被拼进 box-shadow 列表，导致整条声明失效',
  );
  assert.match(
    brutalVars['pane-hi'] ?? '',
    /^0 0 0 transparent$/,
    `粗野主义下 --pane-hi 应是一道"什么也不画"的阴影（0 0 0 transparent），实际是：${brutalVars['pane-hi']}`,
  );
});

test('S18 · 粗野主义的面板显式关掉 backdrop-filter', () => {
  // 把模糊调成 0px 只是"画不出模糊"，但 backdrop-filter 只要存在，
  // 元素就会被提升为合成层（多一层离屏渲染，也会改变文字的抗锯齿）。
  // 既然这套风格根本不用玻璃，就该明确写 none。
  for (const selector of ['.sidebar', '.main', '.modal', '.toast']) {
    const pattern = new RegExp(
      `html\\[data-style="brutal"\\][^{]*\\${selector}[^{]*\\{[^}]*backdrop-filter:\\s*none`,
    );
    assert.ok(
      pattern.test(brutalSection),
      `粗野主义下 ${selector} 应显式写成 backdrop-filter: none，` +
        '而不是留着一个 blur(0px) 的合成层',
    );
  }
});

test('S18 · 风格选择器里的两张预览图，各自要保持自己的样子', () => {
  // 选择器要能让人"看出两个风格的区别"，所以两张预览图必须固定：
  // 左边的永远画成玻璃的样子，右边的永远画成方块的样子。
  // 如果放任粗野主义的"压平一切圆角"作用到预览图上，
  // 切到粗野主义之后，连"简约"那张也会变成方块——选择器就失去意义了。
  assert.match(
    CSS,
    /html\[data-style="brutal"\]\s*\.style-opt-preview\.liquid\s*\{[^}]*border-radius:\s*12px/,
    '粗野主义下，"简约"那张预览图的圆角必须被放回来——否则两张图长得一样',
  );

  // 反过来也要确认：确实有一条会压平一切的规则，上面那条保护才有存在意义
  assert.match(
    CSS,
    /html\[data-style="brutal"\]\s*\*[^{]*\{[^}]*border-radius:\s*0/,
    '应有"压平一切圆角"的规则；没有它的话，上面那条例外就是多余的',
  );
});

// ---------------------------------------------------------------------------
// 3. 前端：store 与设置页
// ---------------------------------------------------------------------------

test('S18 · store 把风格写到根元素上，选项与后端一一对应', () => {
  assert.match(STORE_JS, /setAttribute\('data-style'/, 'store 应把风格写到 html 的 data-style 上');
  assert.match(STORE_JS, /async setStyle\(style\)/, 'store 应有 setStyle');
  assert.match(
    STORE_JS,
    /async setStyle\(style\)[\s\S]{0,220}?applyTheme\(\)/,
    'setStyle 拿到新设置之后要立刻 applyTheme 生效，否则要点刷新才看得到',
  );

  // 界面上的选项必须与后端 STYLES 一一对应（顺序也一致）：
  // 对不上就会出现"后端认的值界面里没有"或反过来，而两边都不报错
  const block = /export const STYLE_OPTIONS\s*=\s*\[([\s\S]*?)\n\];/.exec(STORE_JS);
  assert.ok(block, 'store.js 里应有 STYLE_OPTIONS');
  const ids = [...block[1].matchAll(/id:\s*'([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, STYLES, 'STYLE_OPTIONS 的 id 与顺序都应与后端 STYLES 一致');

  // 每个选项都得有中文名给用户看
  for (const id of STYLES) {
    assert.ok(
      new RegExp(`id:\\s*'${id}'[\\s\\S]{0,200}?name:`).test(block[1]),
      `风格 ${id} 缺少界面文案（name）`,
    );
  }
});

test('S18 · 设置页的外观区块里有风格选择器，且带无障碍状态', () => {
  assert.match(SETTINGS_JS, /STYLE_OPTIONS/, '设置页应使用 STYLE_OPTIONS 渲染选项');
  assert.match(SETTINGS_JS, /data-style-pick/, '风格选项应带 data-style-pick 标记');
  assert.match(SETTINGS_JS, /style-picker/, '应使用 .style-picker 容器');
  assert.match(SETTINGS_JS, /style-opt-preview/, '每个选项应画出自己那套材质的预览');
  assert.match(SETTINGS_JS, /store\.setStyle\(/, '点击应调用 store.setStyle');

  // aria-pressed 要跟着一起更新：它是真实的开关状态，不能只有视觉高亮
  assert.match(
    SETTINGS_JS,
    /data-style-pick[\s\S]{0,900}?aria-pressed/,
    '风格选项应维护 aria-pressed，让读屏也能知道当前选中哪一个',
  );

  // 兜底值：老数据里没有 style 时不能变成 undefined
  assert.match(
    SETTINGS_JS,
    /settings\.style\s*\?\?\s*DEFAULT_STYLE/,
    '设置页应对缺失的 style 做兜底，否则老数据库下会渲染出没有选中项的选择器',
  );
});

test('S18 · 首帧就带上默认风格，不会先闪一下另一种材质', () => {
  // 三处默认值必须是同一个：服务端 DEFAULT_SETTINGS.style、index.html 上的属性、
  // 设置页的兜底。任一处不一致，就会出现"设置页高亮的是 A、界面实际是 B"。
  assert.equal(STYLES[0], 'liquid', 'STYLES 的第一项应就是默认值（当前端与界面都按第一项兜底）');

  const initial = /data-style="([a-z-]+)"/.exec(HTML)?.[1];
  assert.equal(
    initial,
    'liquid',
    `index.html 的初始 data-style 是 ${initial}，应与默认设置一致（liquid）。` +
      '否则脚本还没跑起来的那一帧会先按另一套材质画一次，加载时会闪',
  );
  assert.ok(
    STYLES.includes(initial),
    `index.html 上的风格「${initial}」不在后端允许的清单里：${STYLES.join(' / ')}`,
  );
});
