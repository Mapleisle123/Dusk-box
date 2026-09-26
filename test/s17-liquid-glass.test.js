/**
 * S17 液态玻璃（Liquid Glass）材质测试。
 *
 * 这次重构把界面从"纸"换成了"玻璃"，随之带来两个**新的**失效方式，
 * 它们都不会报错、也不会白屏，只是安静地变难看或变难读：
 *
 *   1. 玻璃一旦不透明，"玻璃"就没了。最省事的写法就是给卡片写一个
 *      实心 background，一切照旧、测试全绿，但材质已经悄悄退化回一块板。
 *      所以这里不去检查"有没有 backdrop-filter"（那只是个手段），
 *      而是检查**填充色是否真的带透明度、且由 --surface 派生**。
 *
 *   2. 玻璃是"有背景的"。实心板上的对比度只要算一次；
 *      玻璃上的文字，压在的是"光场 → 面板 → 卡片"三层合成之后的结果。
 *      合成后的底色比 --surface 深一点点，够不够 AA 得重算一遍。
 *      这正是 S11（平底色）覆盖不到的地方。
 *
 *   3. 玻璃上的对比度会被"别的东西"悄悄污染。计划页一进去会自动弹出
 *      "今天的计划"提醒，那层 .modal-backdrop 盖满视口、60% 不透明还有模糊；
 *      隔着它量到的 4.05:1 是**弹窗态**的数字，不是页面的。关掉弹窗再量，
 *      同一个位置是 6.9:1——从来就没有不够过。当时差点因此把玻璃加厚一轮。
 *      所以这里补两条：弹窗自身（它是唯一叠在遮罩上的玻璃）必须达标；
 *      全屏遮罩只能由弹窗创建，别让它成为一个可以随处冒出来的变量。
 *
 * 另外守一条本次任务的硬边界：**只借材质，不借题材**。
 * 界面里不允许出现天空、云、日月星、雨雪、山川、城市之类的具象景物。
 * 这条用"扫描源码里的违禁词 + 断言环境背景只由渐变构成"来钉住——
 * 光靠肉眼审是守不住的，加一个组件就可能带进来一张风景图。
 *
 * 扫描一律先剥掉注释：本项目已经在 S16 上踩过一次"被自己的说明文字误伤"。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from './helpers.js';

const CSS = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'app.css'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

// ---------------------------------------------------------------------------
// 读取工具（与 S11 / S15 同一套写法，便于对照）
// ---------------------------------------------------------------------------

/** 取出某个选择器的样式块内容 */
function readBlock(src, selector) {
  const idx = src.indexOf(selector);
  if (idx === -1) throw new Error(`app.css 里找不到样式块：${selector}`);
  const open = src.indexOf('{', idx);
  const close = src.indexOf('}', open);
  if (open === -1 || close === -1) throw new Error(`样式块不完整：${selector}`);
  return src.slice(open + 1, close);
}

/** 把样式块里的 --变量 读成对象 */
function readVars(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}

/** 取某条规则的规则体（选择器须位于行首，与 S14 的 readRule 一致） */
function readRule(src, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(src);
  assert.ok(m, `app.css 里应有一条 ${selector} 规则`);
  return m[1];
}

/** 合并 :root 与深色模式的变量表（后者覆盖前者，与浏览器的层叠一致） */
function varsOf(mode) {
  const base = readVars(readBlock(CSS, ':root {'));
  if (mode !== 'dark') return base;
  return { ...base, ...readVars(readBlock(CSS, 'html[data-mode="dark"] {')) };
}

/** #RRGGBB → [r, g, b] */
function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`只支持 #RRGGBB 形式的颜色，收到：${hex}`);
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** rgba(r,g,b,a) / rgb(r,g,b) → { rgb:[r,g,b], alpha } */
function parseRgb(expr, label) {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i.exec(String(expr));
  assert.ok(m, `${label} 应写成 rgb()/rgba()，实际是：${expr}`);
  return {
    rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
    alpha: m[4] === undefined ? 1 : Number(m[4]),
  };
}

/**
 * 解析 `color-mix(in srgb, var(--x) N%, transparent)`。
 * 在 sRGB 空间里就是把颜色 x 的 alpha 设为 N%，压到不透明的底上即：
 * `x * N% + 底色 * (1 - N%)`。
 *
 * 这里额外要求基底必须是 var(--…) 而不是一个写死的颜色：
 * 写死的话，换主题、切深浅色时玻璃不会跟着变，
 * 于是项目里就多了一份"不会跟着一起改的真相"。
 */
function parsePaneMix(expr, label) {
  const m =
    /color-mix\(\s*in\s+srgb\s*,\s*var\(--([a-z0-9-]+)\)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)/i.exec(
      String(expr),
    );
  assert.ok(
    m,
    `${label} 应写成 color-mix(in srgb, var(--底色) N%, transparent)，实际是：${expr}。` +
      '基底用 var(--…) 才能跟着主题与深浅色一起变',
  );
  return { base: m[1], alpha: Number(m[2]) / 100 };
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

/** 把一层半透明色压到背景上 */
function over(layerRgb, alpha, backdropRgb) {
  return layerRgb.map((c, i) => c * alpha + backdropRgb[i] * (1 - alpha));
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * 算出"卡片上"实际压着的底色：
 *   光场(--bg) → 内容区面板(--pane-2) → 卡片(--pane-card)
 * 这是页面上绝大多数文字真正压着的那一层，也是玻璃重构后最容易出问题的一层。
 */
function compositeCard(mode) {
  const vars = varsOf(mode);
  const bg = hexToRgb(vars['bg']);
  const surface = hexToRgb(vars['surface']);

  const panel = parsePaneMix(vars['pane-2'], `${mode} 的 --pane-2`);
  const card = parsePaneMix(vars['pane-card'], `${mode} 的 --pane-card`);

  return over(surface, card.alpha, over(surface, panel.alpha, bg));
}

// ---------------------------------------------------------------------------
// 1. 玻璃材质本身
// ---------------------------------------------------------------------------

/** 玻璃材质的所有令牌，都必须定义——少一个都会让某处静默退化成实心色 */
const GLASS_TOKENS = [
  'pane',
  'pane-2',
  'pane-card',
  'pane-edge',
  'pane-hi',
  'pane-blur',
  'pane-blur-soft',
  'pane-sat',
];

test('S17 · 玻璃材质令牌深浅色都齐备', () => {
  for (const mode of ['light', 'dark']) {
    const vars = varsOf(mode);
    for (const token of GLASS_TOKENS) {
      assert.ok(
        vars[token],
        `${mode} 模式缺少 --${token}。玻璃材质一旦有一处没跟上深浅色，` +
          '那一处就会保持上一种模式的样子',
      );
    }
  }
});

test('S17 · 三种厚度都真的带透明度，且厚度有序', () => {
  for (const mode of ['light', 'dark']) {
    const vars = varsOf(mode);
    const layers = {
      侧栏: parsePaneMix(vars['pane'], `${mode} 的 --pane`),
      卡片: parsePaneMix(vars['pane-card'], `${mode} 的 --pane-card`),
      内容区: parsePaneMix(vars['pane-2'], `${mode} 的 --pane-2`),
    };

    for (const [label, layer] of Object.entries(layers)) {
      assert.ok(
        layer.alpha > 0 && layer.alpha < 1,
        `${mode} 模式「${label}」的填充不透明度是 ${layer.alpha}，必须介于 0 与 1 之间：` +
          '等于 1 是一块实心板（玻璃没了），等于 0 则什么都没有',
      );
      assert.equal(
        layer.base,
        'surface',
        `${mode} 模式「${label}」的玻璃基底是 --${layer.base}，应由 --surface 派生，` +
          '这样换主题、切深浅色时玻璃才会跟着变',
      );
    }

    assert.ok(
      layers.侧栏.alpha >= layers.卡片.alpha && layers.卡片.alpha >= layers.内容区.alpha,
      `${mode} 模式的厚度顺序应是 侧栏 ≥ 卡片 ≥ 内容区（越靠外的面板越厚、越不透），` +
        `实际是 ${layers.侧栏.alpha} / ${layers.卡片.alpha} / ${layers.内容区.alpha}。` +
        '顺序颠倒会让层级读反：内容区反而比侧栏更"实"，看起来像贴纸',
    );
  }
});

test('S17 · 玻璃的边是一道更亮的细线（玻璃的"存在感"主要来自它）', () => {
  for (const mode of ['light', 'dark']) {
    const vars = varsOf(mode);
    const edge = parseRgb(vars['pane-edge'], `${mode} 的 --pane-edge`);

    assert.deepEqual(
      edge.rgb,
      [255, 255, 255],
      `${mode} 的玻璃边应为白色高光：它模拟的是玻璃边缘捕到光的那一下`,
    );
    assert.ok(
      edge.alpha > 0.06 && edge.alpha < 0.9,
      `${mode} 的玻璃边不透明度是 ${edge.alpha}，超出可用区间：太淡等于没有边，太浓会变成一根描边`,
    );

    assert.ok(
      /inset\s+0\s+1px\s+0/.test(vars['pane-hi']),
      `${mode} 的 --pane-hi 应是一道 1px 的内顶高光（inset 0 1px 0 …），实际是：${vars['pane-hi']}`,
    );
  }

  // 深色下的边必须比浅色下更含蓄：纯白细线压在近黑底上会显得廉价
  const lightEdge = parseRgb(varsOf('light')['pane-edge'], '浅色的 --pane-edge').alpha;
  const darkEdge = parseRgb(varsOf('dark')['pane-edge'], '深色的 --pane-edge').alpha;
  assert.ok(
    darkEdge < lightEdge,
    `深色的玻璃边（${darkEdge}）应比浅色（${lightEdge}）更淡，` +
      '否则浅色下刚好的那道边，到了暗底上会刺眼',
  );
});

test('S17 · 关键面板真的挂上了玻璃，而不是写死一块实心色', () => {
  // 侧栏与内容区是两层主面板，必须既能透、又能折
  for (const selector of ['.sidebar', '.main']) {
    const rule = readRule(CSS, selector);
    assert.ok(
      /backdrop-filter\s*:\s*blur\(/.test(rule),
      `${selector} 应有 backdrop-filter 模糊，否则它就不"透"了，只是一块半透明贴纸`,
    );
    assert.ok(
      /var\(--pane/.test(rule),
      `${selector} 的填充应取自玻璃令牌（--pane / --pane-2），实际规则里没有引用`,
    );
    assert.ok(
      !/background\s*:\s*var\(--surface\)\s*;/.test(rule),
      `${selector} 的底色被写成了实心的 --surface：玻璃材质会就此消失，` +
        '而后面的测试仍然全绿——这正是本次重构最容易被悄悄改坏的地方',
    );
  }

  // 弹窗是最典型的浮层，必须与侧栏同一种材质
  const modal = readRule(CSS, '.modal');
  assert.ok(
    /backdrop-filter\s*:\s*blur\(/.test(modal) && /var\(--pane/.test(modal),
    '弹窗是浮在界面之上的浮层，应与侧栏同一种玻璃材质',
  );

  // 卡片这一组是"面板里的块"，靠更亮的填充 + 高光边浮起来
  const cardGroup = CSS.slice(CSS.indexOf('.card,'), CSS.indexOf('.section {'));
  for (const token of ['--pane-card', '--pane-edge', '--pane-hi']) {
    assert.ok(
      cardGroup.includes(`var(${token})`),
      `卡片组（.card, .today-item, …）的配方里缺少 var(${token})，` +
        '说明有一类卡片的材质没跟上',
    );
  }
});

// ---------------------------------------------------------------------------
// 2. 玻璃合成之后的文字可读性（S11 覆盖不到的一层）
// ---------------------------------------------------------------------------

/**
 * 各级文字：变量名 → 该级在卡片上应达到的对比度下限。
 *
 * 深色的口径沿用 S11（正文 AAA 7:1，次级与三级 AA 4.5:1）。
 * 浅色的三级文字这次从 3:1 **提到了 4.5:1**：
 * 上一版浅色只把 3:1 当底线（当时备注"这次不做改动"），
 * 于是说明文字、元信息压在玻璃卡片上实测只有 3.3:1，读起来是吃力的。
 * 这次是完整重构，就一并提到与深色同一标准。
 *
 * 顺带记下一个容易走错的方向：三级文字偏浅**不能靠把玻璃调亮来解决**。
 * 像 #7B8393 这样的中灰，即便压在最纯的白上也只有 3.81:1——
 * 中灰在白底上的对比度是有上限的。唯一的出路是把它本身加深。
 */
const TEXT_LEVELS = {
  light: { text: 7, 'text-2': 4.5, 'text-3': 4.5 },
  dark: { text: 7, 'text-2': 4.5, 'text-3': 4.5 },
};

test('S17 · 玻璃合成之后，卡片上各级文字仍然达标', () => {
  for (const mode of ['light', 'dark']) {
    const vars = varsOf(mode);
    const backdrop = compositeCard(mode);

    for (const [level, min] of Object.entries(TEXT_LEVELS[mode])) {
      const ratio = contrast(hexToRgb(vars[level]), backdrop);
      assert.ok(
        ratio >= min,
        `${mode} 模式 --${level} 压在"光场→面板→卡片"合成后的底色上只有 ${round2(ratio)}:1，` +
          `低于 ${min}:1。玻璃每叠一层都会把底色往深处带一点，` +
          '文字对比度必须在**合成之后**算，而不是只算平底色那一次',
      );
    }
  }
});

test('S17 · 合成后的底色确实比 --surface 更深——所以这层计算不能省', () => {
  // 如果合成结果与 --surface 一模一样，说明玻璃根本没生效（或面板是全不透明的），
  // 那这条测试就是多余的，该删掉而不是留着装样子。
  for (const mode of ['light', 'dark']) {
    const surface = hexToRgb(varsOf(mode)['surface']);
    const composited = compositeCard(mode);

    assert.ok(
      composited.some((c, i) => Math.abs(c - surface[i]) > 0.5),
      `${mode} 模式合成后的底色与 --surface 完全相同，` +
        '说明玻璃没起作用（面板或卡片被写成全不透明了）',
    );
  }
});

test('S17 · 压在最亮背景图上的副标题也达标（沿用 S15 的口径）', () => {
  // 页头副标题是全页最"暴露"的一级文字：它直接压在光场上，
  // 启用背景图时还要扛住照片最亮的像素。这次它从 --text-3 提到了 --text-2。
  const vars = varsOf('dark');
  const subVar = /(?:^|\n)\s*\.page-head\s+\.sub\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(subVar, 'app.css 里应有 .page-head .sub 规则');

  const m = /color\s*:\s*var\(--([a-z0-9-]+)\)/.exec(subVar[1]);
  assert.ok(m, '.page-head .sub 应显式指定颜色变量，便于逐级核对对比度');
  const level = m[1];
  assert.ok(
    Object.prototype.hasOwnProperty.call(vars, level),
    `页头副标题引用了 --${level}，但 app.css 里没有定义它——文字会掉回继承色，` +
      '而且对比度无从校验',
  );

  // 照片最亮处（255,255,255）→ 压暗层 → 纱，与 S15 同一套算法
  const dim = parsePaneMix(vars['bg-dim'], '深色模式的 --bg-dim');
  const veil = parsePaneMix(vars['bg-veil'], '--bg-veil');
  let pixel = [255, 255, 255];
  pixel = over(hexToRgb(vars[dim.base]), dim.alpha, pixel);
  pixel = over(hexToRgb(vars[veil.base]), veil.alpha, pixel);

  const ratio = contrast(hexToRgb(vars[level]), pixel);
  assert.ok(
    ratio >= 4.5,
    `页头副标题（--${level}）压在背景图最亮处只有 ${round2(ratio)}:1，低于 AA 的 4.5:1`,
  );
});

// ---------------------------------------------------------------------------
// 3. 只借材质，不借题材
// ---------------------------------------------------------------------------

/** 剥掉 CSS 注释（换成等长空白，保持下标不变） */
function stripCssComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 剥掉 JS/markup 注释与字符串以外的说明文字（这里只用于 HTML） */
function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * 禁止出现在样式与页面结构里的具象景物。
 *
 * 为什么用词组而不是单字：单字会误伤常用词——
 * "风格"里含"风"，"云"含在"云盘"里，逐个单字扫会把正常代码判成违规，
 * 这种测试不出三天就会被"加白名单"绕过，等于没写。
 */
const FORBIDDEN_CN = [
  '天气', '天空', '云朵', '白云', '乌云', '太阳', '月亮', '星星', '星辰',
  '雨滴', '下雨', '阵雨', '雷暴', '闪电', '台风', '气温', '雪花', '下雪',
  '山川', '山脉', '山峦', '河流', '湖泊', '海洋', '沙漠', '森林',
  '城市', '高楼', '风景', '景观', '日出', '日落', '朝霞', '晚霞', '极光',
];

/** 英文词组用词边界匹配，避免误伤 gradient / shadow 这类技术词 */
const FORBIDDEN_EN =
  /\b(weather|forecast|sunny|clouds?|moon|stars?|rain|snow|thunder|lightning|mountain|mountains|sky|sunrise|sunset|aurora|city|cityscape|landscape)\b/i;

test('S17 · 样式与页面里没有混进任何气象或景观元素', () => {
  const targets = [
    ['public/css/app.css', stripCssComments(CSS)],
    ['public/index.html', stripHtmlComments(HTML)],
  ];

  for (const [file, src] of targets) {
    for (const term of FORBIDDEN_CN) {
      assert.ok(
        !src.includes(term),
        `${file} 里出现了「${term}」。本次风格只借 macOS 的材质与层级，不借题材：` +
          '天空、云、日月星、雨雪、山川、城市之类的具象景物一律不允许出现',
      );
    }
    assert.ok(
      !FORBIDDEN_EN.test(src),
      `${file} 里出现了气象/景观相关的英文词：${FORBIDDEN_EN.exec(src)?.[0]}`,
    );
  }
});

test('S17 · 扫描器能分辨违规与合规（护栏不是空转）', () => {
  // 自检：把一段违规样式喂给同一套判断，必须被判出来
  const badSamples = [
    'body { background-image: url("/img/sky-blue.jpg"); }',
    '/* 参考天气 App 的渐变 */ .hero { background: linear-gradient(#7ab8ff, #fff); }',
  ];
  assert.ok(
    /\b(sky|weather)\b/i.test(stripCssComments(badSamples[0])),
    '自检失败：含 sky 的样式必须被判为违规',
  );
  assert.ok(
    !/\b(sky|weather)\b/i.test(stripCssComments(badSamples[1])),
    '自检失败：注释里的 sky/weather 应被剥掉后再判断，否则每写一句说明就会误报',
  );
});

test('S17 · 环境光场只由渐变构成，没有一张图', () => {
  const body = readRule(CSS, 'body');

  const layers = body.match(/(?:repeating-)?(?:radial|linear|conic)-gradient\(/g) || [];
  assert.ok(
    layers.length >= 3,
    `环境光场只有 ${layers.length} 层渐变。它需要多点分布的光，` +
      '单一方向的长渐变会读成"天空"，而不是照明',
  );
  assert.equal(
    /url\(/.test(body),
    false,
    'body 的底图里出现了 url()：环境光场必须由渐变构成。' +
      '一旦允许放图，就很容易塞进一张风景照——那正是这次明确不允许的',
  );
  for (const fn of layers) {
    assert.ok(
      !/conic-gradient/.test(fn),
      '环境光场不应使用 conic-gradient：它会产生方向明确的扇形，容易读成具象的光束',
    );
  }
});

test('S17 · 样式不引用任何外部图片，唯二入口是噪点与用户选的背景图', () => {
  // 按"出现几次"来数是不牢靠的：注释里的示例写法会算进来，
  // 内联 SVG 里那个 filter='url(%23g)' 也会算进来（它其实是字符串内容，不是 CSS 的 url）。
  // 所以先把注释剥掉、把内联 data: 资源整体抹掉，再看还剩什么。
  let src = stripCssComments(CSS);
  src = src.replace(/url\(\s*"data:[\s\S]*?"\s*\)/g, ' DATAURI ');
  src = src.replace(/url\(\s*'data:[\s\S]*?'\s*\)/g, ' DATAURI ');
  src = src.replace(/url\(\s*data:[^)]*\)/g, ' DATAURI ');

  const leftovers = src.match(/url\([^)]*\)/g) || [];
  assert.deepEqual(
    leftovers,
    [],
    '样式里出现了指向外部文件的 url()：' +
      `${leftovers.join('、')}。整份样式表只允许内联的 data: 资源（纸纹噪点）；` +
      '任何外部图片都必须从设置里的背景图进来（--bg-photo）。' +
      '多出来的入口，就是一张风景照被顺手带进界面的路径',
  );

  // 背景图只有一个入口，且只应在 html[data-bg="on"] 的图层规则里被引用
  const photoUses = (CSS.match(/var\(--bg-photo\)/g) || []).length;
  assert.equal(
    photoUses,
    1,
    `--bg-photo 在样式里被引用了 ${photoUses} 处，应只有 1 处（html[data-bg="on"] 的图层规则）`,
  );
  assert.ok(
    /html\[data-bg="on"\]\s*body\s*\{([^}]*)\}/.test(CSS) &&
      /var\(--bg-photo\)/.test(/html\[data-bg="on"\]\s*body\s*\{([^}]*)\}/.exec(CSS)[1]),
    '--bg-photo 应出现在 html[data-bg="on"] body 的图层规则里，' +
      '这样只有真正启用背景图时才会去取那张图',
  );
});

// ---------------------------------------------------------------------------
// 4. 交互反馈
// ---------------------------------------------------------------------------

test('S17 · 按下要"沉"：主要按钮有缩放反馈', () => {
  const active = readRule(CSS, '.btn:active');
  assert.ok(
    /transform\s*:[^;]*scale\(0?\.9\d+\)/.test(active),
    '.btn:active 应有 scale(…) 收缩。没有这一帧，点击就只是"颜色变了"，' +
      '手感是网页；缩下一点点，才有原生的"被按住"的感觉',
  );

  const hover = readRule(CSS, '.btn:hover');
  assert.ok(
    /translateY\(-?\d/.test(hover),
    '.btn:hover 应有位移，让按钮在指针下微微浮起',
  );
});

test('S17 · 悬停要"浮"：卡片有位移 + 阴影加深两种反馈', () => {
  for (const selector of ['.today-item:hover', '.post-card:hover', '.plan-card:hover']) {
    const rule = readRule(CSS, selector);
    assert.ok(/translateY\(-/.test(rule), `${selector} 应向上位移，表达"被托起来"`);
    assert.ok(/box-shadow\s*:/.test(rule), `${selector} 应同时加深阴影，只位移会显得轻飘`);
  }
});

test('S17 · 状态翻转要有回弹：勾选与开关走弹性曲线', () => {
  assert.ok(
    /--ease-spring\s*:\s*cubic-bezier\(/.test(CSS),
    '应定义一条弹性曲线（含过冲），供"状态翻转"这类短促动效使用',
  );

  const check = readRule(CSS, '.today-check.checked svg');
  assert.ok(
    /animation\s*:[^;]*var\(--ease-spring\)/.test(check),
    '.today-check.checked 的勾应带一点回弹。直接出现会显得生硬',
  );

  const knob = readRule(CSS, '.switch.on::after');
  assert.ok(
    /translateX\(/.test(knob),
    '.switch.on::after 必须让滑块位移，否则用户感知不到开关被打开',
  );
});

// ---------------------------------------------------------------------------
// 5. 设计语言的切换点
// ---------------------------------------------------------------------------

test('S17 · 液态玻璃是"默认值"，不依赖某个属性才生效', () => {
  // 令牌写在 :root 而不是 html[data-style="liquid"] 里。
  // 这样即使属性没写上（脚本没跑、HTML 被改坏），界面依然是对的，
  // 不会先闪一下无材质的裸样式。
  const root = readVars(readBlock(CSS, ':root {'));
  for (const token of GLASS_TOKENS) {
    assert.ok(root[token], `--${token} 应定义在 :root 里，作为不依赖属性的默认材质`);
  }
  assert.ok(
    !/^html\[data-style="liquid"\]/m.test(CSS),
    '液态玻璃不该只在 html[data-style="liquid"] 下生效——' +
      '那样一旦属性缺失，整页材质就会塌掉',
  );
});

test('S17 · 页面已声明外观风格，且与样式约定一致', () => {
  const m = /data-style="([a-z]+)"/.exec(HTML);
  assert.ok(m, 'index.html 的 <html> 上应声明 data-style，让首帧就是最终材质');

  assert.ok(
    ['liquid', 'brutal'].includes(m[1]),
    `data-style="${m[1]}" 不是约定的取值（liquid / brutal）`,
  );

  // 页面初始状态必须与默认设置一致，否则连上服务的一瞬间会闪一下
  assert.ok(
    /data-mode="light"/.test(HTML),
    'index.html 的初始 data-mode 应与默认设置一致（light），否则首帧会闪一下深色',
  );
});

test('S17 · 纸张时代的衬线字体已经不再用于标题', () => {
  // 上一版是"日记本"：标题走宋体/衬线，靠纸张与印刷的语汇建立层级。
  // 液态玻璃走系统字，靠字重与字距建立层级。
  // 如果衬线还在标题上，说明只换了颜色、没换语言。
  assert.ok(
    !/--font-serif/.test(CSS),
    '样式里仍残留 --font-serif。这套界面不应再有衬线标题',
  );
  assert.ok(
    /--font-display\s*:/.test(CSS),
    '应定义 --font-display 作为标题与数字的字体族',
  );

  const h1 = readRule(CSS, 'h1');
  assert.ok(
    /var\(--font-display\)/.test(h1),
    'h1 应走 --font-display，否则字体语言没有真正切换',
  );
  assert.ok(
    /letter-spacing\s*:\s*-/.test(h1),
    '大标题应收紧字距（负 letter-spacing）。大字号不收紧字距，会显得松散、不精致',
  );
});

// ---------------------------------------------------------------------------
// 4. 弹窗：唯一一层"叠在遮罩之上"的玻璃
// ---------------------------------------------------------------------------

/**
 * 解析遮罩那层 `color-mix(in srgb, var(--x) N%, rgba(r,g,b,a))`。
 *
 * 与 parsePaneMix 的区别在于第二个颜色不是 transparent，所以要连 alpha 一起算。
 * CSS 的 color-mix 在**预乘**空间插值，于是结果的 alpha 是加权后的：
 *   0.4 * 1 + 0.6 * 0.34 = 0.604
 * （浏览器算出来是 0.604706，对得上。）
 */
function parseScrim(expr, label) {
  const m =
    /color-mix\(\s*in\s+srgb\s*,\s*var\(--([a-z0-9-]+)\)\s+(\d+(?:\.\d+)?)%\s*,\s*rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)\s*\)/i.exec(
      String(expr),
    );
  assert.ok(
    m,
    `${label} 应写成 color-mix(in srgb, var(--底色) N%, rgba(r,g,b,a))，实际是：${expr}`,
  );
  return {
    base: m[1],
    weight: Number(m[2]) / 100,
    second: [Number(m[3]), Number(m[4]), Number(m[5])],
    secondAlpha: Number(m[6]),
  };
}

/** 按预乘规则把遮罩算成 { rgb, alpha } */
function scrimColor(vars, parsed) {
  const first = hexToRgb(vars[parsed.base]);
  const w1 = parsed.weight;
  const w2 = 1 - w1;
  const a2 = parsed.secondAlpha;
  const alpha = w1 + w2 * a2;
  const premultiplied = first.map((c, i) => c * w1 + parsed.second[i] * a2 * w2);
  return { rgb: premultiplied.map((c) => c / alpha), alpha };
}

/** 页头副标题用的是哪一级文字变量（从规则里读，别在测试里另抄一份颜色） */
function subTextVar() {
  const rule = /(?:^|\n)\s*\.page-head\s+\.sub\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, 'app.css 里应有 .page-head .sub 规则');
  const m = /color\s*:\s*var\(--([a-z0-9-]+)\)/.exec(rule[1]);
  assert.ok(m, '.page-head .sub 应显式指定颜色变量，便于逐级核对对比度');
  return m[1];
}

test('S17 · 弹窗浮层上的文字，无论底下多暗都要读得清', () => {
  // 弹窗是界面上唯一一层"叠在遮罩之上"的玻璃：它背后不是光场，
  // 而是一层半透明灰纱，纱后面还压着整页内容。
  // 纱挡不住全部，所以这里把"页面内容"取成最极端的一种——纯黑，
  // 意思是"底下暗到不能再暗"，再看弹窗里的两级文字还剩多少对比度。
  const rule = readRule(CSS, '.modal-backdrop');
  const m = /background\s*:\s*(color-mix\([^;]+\))\s*;/.exec(rule);
  assert.ok(m, '.modal-backdrop 的底色应写成一条 color-mix，便于核对它的遮盖力');

  for (const mode of ['light', 'dark']) {
    const vars = varsOf(mode);
    const scrim = scrimColor(vars, parseScrim(m[1], `${mode} 模式的遮罩`));

    assert.ok(
      scrim.alpha >= 0.5,
      `${mode} 模式的遮罩只有 ${round2(scrim.alpha)} 不透明：太薄的纱挡不住底下的内容，` +
        '弹窗里的文字就变成了"压在随机画面上"，开一张亮照片就够呛',
    );

    const underScrim = over(scrim.rgb, scrim.alpha, [0, 0, 0]);
    const pane = parsePaneMix(vars['pane'], `${mode} 的 --pane`);
    const dialog = over(hexToRgb(vars[pane.base]), pane.alpha, underScrim);

    for (const [level, min] of [
      ['text', 7],
      ['text-2', 4.5],
    ]) {
      const ratio = contrast(hexToRgb(vars[level]), dialog);
      assert.ok(
        ratio >= min,
        `${mode} 模式下弹窗里的 --${level} 只有 ${round2(ratio)}:1，低于 ${min}:1。` +
          '弹窗的底比卡片更不可控（后面隔着一层纱和整页内容），这一层要单独算',
      );
    }
  }
});

test('S17 · 偏暗的照片也不能把浅色的副标题拉垮（浅色地板）', () => {
  // 上面那条只算了"深色模式 + 照片最亮处"这一种组合。
  // 浅色的文字是深的，它怕的恰好相反：**照片的暗部**。
  // 取一块偏暗、但不算全黑的照片区域（RGB 60），把整条链算一遍：
  //   照片 → 纱(--bg-veil) → 内容区面板(--pane-2) → 副标题
  //
  // 为什么不取全黑：实测过，照片全黑时面板加到 74% 也只有 4.19:1。
  // 想靠"把玻璃加厚"来兜住任意照片是兜不住的——除非厚成实心板，那玻璃就没了。
  // 所以这里守的是一条写明的、够用的地板，而不是一个假装的保证。
  const DARK_ENOUGH_PIXEL = 60;
  const vars = varsOf('light');
  const veil = parsePaneMix(vars['bg-veil'], '--bg-veil');
  const pane = parsePaneMix(vars['pane-2'], '浅色的 --pane-2');
  const level = subTextVar();

  const photo = [DARK_ENOUGH_PIXEL, DARK_ENOUGH_PIXEL, DARK_ENOUGH_PIXEL];
  const veiled = over(hexToRgb(vars[veil.base]), veil.alpha, photo);
  const backdrop = over(hexToRgb(vars[pane.base]), pane.alpha, veiled);

  const ratio = contrast(hexToRgb(vars[level]), backdrop);
  assert.ok(
    ratio >= 4.5,
    `浅色下副标题（--${level}）压在偏暗的照片上只有 ${round2(ratio)}:1，低于 AA 的 4.5:1。` +
      `当前 --pane-2 是 ${pane.alpha}，要过这一关大约需要 0.45 以上。` +
      '注意这不是"越厚越好"的指标：加厚只是给偏暗照片留的保险，' +
      '真正让玻璃像玻璃的是底下有光、边上有一道亮线、中间有模糊——那三样调不动。',
  );
});

test('S17 · 全屏遮罩只能由弹窗创建，且空着的时候不许拦点击', () => {
  // 这条是上面第 3 条失效方式的护栏：一层盖满视口的遮罩是"全局变量"，
  // 它会一次性改掉整页每一处文字的对比度。这种能力只应该握在弹窗手里。
  const jsDir = path.join(PUBLIC_DIR, 'js');
  const offenders = [];
  for (const rel of fs.readdirSync(jsDir, { recursive: true })) {
    const file = path.join(jsDir, rel);
    if (!fs.statSync(file).isFile()) continue;
    if (!/\.m?js$/.test(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    // 只认"创建/查询这层遮罩"的写法；注释里的提及不算
    const hits = (src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').match(/modal-backdrop/g) || []).length;
    if (hits > 0 && !/ui\.js$/.test(file)) offenders.push(`${rel}（${hits} 处）`);
    if (/ui\.js$/.test(file) && hits > 1) offenders.push(`${rel}（${hits} 处，应只有创建那一处）`);
  }
  assert.deepEqual(
    offenders,
    [],
    `除 ui.js 之外，不该有别的地方碰 .modal-backdrop：${offenders.join('、')}。` +
      '一层盖满视口的遮罩会同时改掉整页的对比度，这类改动必须从弹窗走',
  );

  // modal-root 空着的时候不能拦住任何点击——否则一次没关干净的浮层
  // 会让整个界面"看起来在、其实点不动"。
  const root = readRule(CSS, '.modal-root');
  assert.ok(
    /pointer-events\s*:\s*none/.test(root),
    '.modal-root 应为 pointer-events: none：空着的时候不该接住任何点击',
  );
  const backdrop = readRule(CSS, '.modal-backdrop');
  assert.ok(
    /pointer-events\s*:\s*auto/.test(backdrop),
    '.modal-backdrop 应把点击接回来（pointer-events: auto），否则弹窗里的按钮点不动',
  );
});
