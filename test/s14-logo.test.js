/**
 * S14 页面 logo 测试。
 *
 * logo 是用户自己往 img/logo 里放的图，不是代码的一部分，
 * 所以这里守的是两条容易出问题的边界：
 *
 *   1. **页面引用的那个地址必须真的取得到。**
 *      资源目录、文件名、MIME、字节数，任何一环对不上，
 *      侧栏就会出现一个破图图标——而页面本身看起来毫无异常。
 *
 *   2. **图缺失时必须能退回原来那套 CSS 印章。**
 *      换名字、删掉、放成损坏文件都是很可能的操作。
 *      原来的印章样式是兜底，不能被删掉；加载失败也要真的移除 <img>，
 *      否则浏览器会在那个方框里画一个破图图标。
 *
 *   3. **尺寸、圆角、边框只有一份定义。**
 *      这三样各有 2~3 处引用（印章本体、三道横线、上面那张图），
 *      各写各的 px 一旦不同步，切换 logo 与兜底印章时就会跳变。
 *      所以尺寸/圆角抽成了 --brand-size / --brand-radius，
 *      边框走 --bw + --border-strong（后者决定它在 24 种外观组合下都看得见）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { startTestServer, PUBLIC_DIR } = await import('./helpers.js');
const { ASSET_DIR } = await import('../server/assets.js');

const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'app.css'), 'utf8');
const MAIN_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'main.js'), 'utf8');

const LOGO_DIR = path.join(ASSET_DIR, 'logo');
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif'];

/** 取出 index.html 里 logo 的 <img> 标签与它的 src */
function readLogoTag() {
  const tag = /<img[^>]*class="brand-logo"[^>]*>/.exec(HTML);
  assert.ok(tag, 'index.html 里应有一个 class="brand-logo" 的 <img>');
  const src = /src="([^"]+)"/.exec(tag[0]);
  assert.ok(src, 'logo 的 <img> 必须有 src');
  return { tag: tag[0], src: src[1] };
}

/** 直接取原始响应（要验二进制，不能用 helpers 的 JSON/text 解析） */
async function fetchRaw(srv, urlPath) {
  const res = await fetch(`${srv.base}${urlPath}`);
  return {
    status: res.status,
    type: res.headers.get('content-type') || '',
    bytes: Buffer.from(await res.arrayBuffer()),
  };
}

// ---------------------------------------------------------------------------
// 页面引用的 logo 真的取得到
// ---------------------------------------------------------------------------

test('S14 · index.html 引用的 logo 指向 img/logo 下真实存在的文件', () => {
  const { src } = readLogoTag();

  assert.ok(
    src.startsWith('/img/logo/'),
    `logo 应放在 img/logo 目录下（走 /img/* 自带资源通道），实际是 ${src}`,
  );

  const rel = src.slice('/img/'.length);
  const abs = path.join(ASSET_DIR, rel);

  // 不允许借助路径上跳指到别处
  assert.ok(
    path.resolve(abs).startsWith(path.resolve(LOGO_DIR) + path.sep),
    'logo 地址不应跳出 img/logo 目录',
  );
  assert.ok(fs.existsSync(abs), `页面引用了 ${src}，但磁盘上找不到 ${abs}`);
  assert.ok(fs.statSync(abs).size > 0, 'logo 文件不该是空的');
});

test('S14 · logo 能取到真实字节，MIME 也对得上', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { src } = readLogoTag();
  const onDisk = fs.readFileSync(path.join(ASSET_DIR, src.slice('/img/'.length)));
  const res = await fetchRaw(srv, src);

  assert.equal(res.status, 200, `logo 取不到：${src}`);
  assert.ok(
    res.type.startsWith('image/'),
    `logo 的 Content-Type 是 ${res.type}，不是图片——多半被回退成了 index.html`,
  );
  assert.equal(res.bytes.length, onDisk.length, '取到的字节数与磁盘不一致');
  assert.ok(res.bytes.equals(onDisk), '取到的内容与磁盘上的文件不一样');
});

test('S14 · logo 文件的扩展名与实际格式一致（避免写着 jpg 其实是 png）', () => {
  const { src } = readLogoTag();
  const abs = path.join(ASSET_DIR, src.slice('/img/'.length));
  const head = fs.readFileSync(abs).subarray(0, 12);
  const ext = path.extname(abs).toLowerCase();

  const signatures = {
    '.jpg': head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
    '.jpeg': head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
    '.png': head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    '.gif': head.subarray(0, 3).toString('ascii') === 'GIF',
    '.webp': head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP',
  };

  assert.ok(
    Object.prototype.hasOwnProperty.call(signatures, ext),
    `没认出 ${ext} 的图片签名，请换用 jpg / png / gif / webp`,
  );
  assert.ok(
    signatures[ext],
    `logo 的扩展名是 ${ext}，但文件头不是这种格式——把 png 改名成 jpg 会让声明的 MIME 与实际内容不符`,
  );
});
test('S14 · img/logo 目录里确实有图（用户放的那张）', () => {
  assert.ok(fs.existsSync(LOGO_DIR), 'img/logo 目录应存在');
  const images = fs
    .readdirSync(LOGO_DIR)
    .filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()));
  assert.ok(images.length > 0, 'img/logo 里应至少有一张图片');
});

// ---------------------------------------------------------------------------
// 标签页图标（favicon）也用这张 logo
// ---------------------------------------------------------------------------

/** 抠出 index.html 里的 <link rel="icon"> */
function readIconTag() {
  const m = /<link[^>]*\brel="icon"[^>]*>/.exec(HTML);
  assert.ok(m, 'index.html 里应有 <link rel="icon">');
  return m[0];
}

/** 把 index.html 里的资源地址按真实路由解析成磁盘绝对路径（两套通道） */
function resolveRef(href) {
  // /img/* 的根是 img/，所以前缀本身要先剥掉（与 server/http.js 的路由一致）
  if (href.startsWith('/img/')) return path.resolve(ASSET_DIR, href.slice('/img/'.length));
  return path.resolve(PUBLIC_DIR, href.replace(/^\//, ''));
}

/** 从 icon 标签里取 href */
function readIconHref() {
  const href = /href="([^"]+)"/.exec(readIconTag());
  assert.ok(href, '图标标签必须有 href');
  return href[1];
}

test('S14 · 标签页图标与侧栏 logo 是同一张图', () => {
  const iconHref = readIconHref();

  assert.ok(
    !/^data:/.test(iconHref),
    '标签页图标应指向真实文件，而不是内嵌的 SVG 图形——' +
      '内嵌图形与侧栏那张 logo 是两套画法，改了图这里不会跟着变',
  );

  const { src } = readLogoTag();
  assert.equal(
    resolveRef(iconHref),
    resolveRef(src),
    `标签页图标（${iconHref}）与侧栏 logo（${src}）指向了不同的文件。"换成这张 logo"` +
      '指的是同一张图；若复制一份到 public/ 下，日后换图就会留下一个对不上的旧图标',
  );

  assert.ok(fs.existsSync(resolveRef(iconHref)), `标签页图标指向的 ${iconHref} 在磁盘上不存在`);
});

test('S14 · 标签页图标能取到真实字节，而不是一段 HTML', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const iconHref = readIconHref();
  const onDisk = fs.readFileSync(resolveRef(iconHref));
  const res = await fetchRaw(srv, iconHref);

  assert.equal(res.status, 200, `标签页图标取不到：${iconHref}`);
  assert.ok(
    res.type.startsWith('image/'),
    `标签页图标的 Content-Type 是 ${res.type}，不是图片——地址多半落到了页面回退上，` +
      '浏览器只会显示一个默认的空图标',
  );
  assert.equal(res.bytes.length, onDisk.length, '取到的字节数与磁盘不一致');
  assert.ok(res.bytes.equals(onDisk), '取到的内容与磁盘上的文件不一样');
});

test('S14 · 标签页图标声明的 type 与实际格式一致', () => {
  const icon = readIconTag();
  const declared = /type="([^"]+)"/.exec(icon);
  assert.ok(
    declared,
    '应声明 type：浏览器会据此挑图标，声明错了会直接跳过这个候选',
  );

  const ext = path.extname(readIconHref()).toLowerCase();
  const expected = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  }[ext];

  assert.ok(expected, `没认出 ${ext} 对应的图标类型，请换用 jpg / png / gif / webp / svg / ico`);
  assert.equal(declared[1], expected, `扩展名是 ${ext}，type 应写 ${expected}`);
});

// ---------------------------------------------------------------------------
// 样式：铺满印章方框，且不挡住自己
// ---------------------------------------------------------------------------

/** 取出某个选择器的样式块 */
function readRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  assert.ok(m, `app.css 里应有一条 ${selector} 规则`);
  return m[1];
}

/** 取出 :root 里的令牌（尺寸/圆角这类"只该有一个事实来源"的值都放这儿） */
function readRootBlock() {
  const m = /(?:^|\n):root\s*\{([\s\S]*?)\n\}/.exec(CSS);
  assert.ok(m, 'app.css 应有 :root 块');
  return m[1];
}

/** 从某个样式块里读一个自定义属性 */
function tokenIn(block, name) {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block);
  assert.ok(m, `样式块里应有 ${name}`);
  return m[1].trim();
}

test('S14 · logo 铺满印章方框，尺寸与圆角都与印章同源', () => {
  const brandMark = readRule('.brand-mark');
  const logo = readRule('.brand-logo');

  assert.ok(
    /width:\s*var\(--brand-size\)/.test(brandMark) &&
      /height:\s*var\(--brand-size\)/.test(brandMark),
    '印章的宽高应取自 --brand-size——尺寸只留一个事实来源，不要在这条规则里另写一套 px',
  );

  assert.ok(/width:\s*100%/.test(logo) && /height:\s*100%/.test(logo), 'logo 应铺满这个方框');
  assert.ok(
    /object-fit:\s*cover/.test(logo),
    'logo 要用 cover 填满方框，否则会按原始比例留下空白',
  );

  assert.ok(
    /border-radius:\s*var\(--brand-radius\)/.test(brandMark),
    '印章的圆角应取自 --brand-radius',
  );
  assert.ok(
    /border-radius:\s*var\(--brand-radius\)/.test(readRule('.brand-mark::after')),
    '三道横线也画在同一块方框里，圆角应与印章同源',
  );

  // 同心圆角：加了边框后，内层实际可用的是 padding box，
  // 它的圆角天然比 border-radius 小一个边框宽。
  assert.ok(
    /border-radius:\s*calc\(\s*var\(--brand-radius\)\s*-\s*var\(--bw\)\s*\)/.test(logo),
    'logo 的圆角要写成「印章圆角 − 边框宽度」。照抄印章圆角会让两个角**不同心**，' +
      '四个角各露出一小瓣背景色（11px 的角套在 10px 的角里）',
  );
});

test('S14 · 徽标已加大（原来 32px，用户反馈偏小）', () => {
  const raw = tokenIn(readRootBlock(), '--brand-size');
  const size = Number(raw.replace('px', ''));

  assert.ok(Number.isFinite(size), `--brand-size 应是 px 数值，实际是 ${raw}`);
  assert.ok(
    size >= 40,
    `徽标当前 ${size}px。原来是 32px、用户反馈偏小，加大后不该再掉回 40px 以下`,
  );
});

test('S14 · 徽标有一圈边框，且在浅色/深色/粗野主义下都看得见', () => {
  const brandMark = readRule('.brand-mark');

  assert.ok(
    /border:\s*var\(--bw\)\s+solid\s+var\(--border-strong\)/.test(brandMark),
    '徽标应有一圈边框，写成 `border: var(--bw) solid var(--border-strong)`：' +
      '一条声明就能在主题 × 深浅 × 风格共 24 种组合下都成立',
  );

  assert.ok(
    !/border:[^;]*pane-edge/.test(brandMark),
    '别拿 --pane-edge 当边框：它是"玻璃面板边缘的高光白线"，浅色下是 rgba(255,255,255,.66)，' +
      '压在近白的玻璃上等于没画——用户要的是看得见的边框',
  );

  // 三种作用域都必须给 --border-strong 一个非透明的值，否则某些组合下边框会静默消失
  const scopes = {
    '浅色（:root）': readRootBlock(),
    深色: readRule('html[data-mode="dark"]'),
    粗野主义: readRule('html[data-style="brutal"]'),
  };
  for (const [label, block] of Object.entries(scopes)) {
    const value = tokenIn(block, '--border-strong');
    assert.ok(
      !/^(transparent|none)$/i.test(value),
      `${label} 下 --border-strong 是 ${value}，边框会消失`,
    );
  }

  // 边框宽度跟着 --bw 走，粗野主义才有那圈 2px 粗边
  assert.equal(tokenIn(readRootBlock(), '--bw'), '1px', '简约的边框宽度是 1px');
  assert.equal(
    tokenIn(readRule('html[data-style="brutal"]'), '--bw'),
    '2px',
    '粗野主义的边框宽度是 2px',
  );
});

test('S14 · 印章兜底样式还在（图缺失时才好看得过去）', () => {
  const brandMark = readRule('.brand-mark');
  assert.ok(
    /background:\s*linear-gradient/.test(brandMark),
    '印章的底色渐变不能删——它是 logo 缺失时的兜底外观',
  );

  const seal = readRule('.brand-mark::after');
  const lines = (seal.match(/linear-gradient/g) || []).length;
  assert.ok(lines >= 3, `印章的"箱"字三道横线应还在，实际只剩 ${lines} 条`);
});

test('S14 · 图加载好后，印章的底色与横线要让开', () => {
  const hasLogo = readRule('.brand-mark.has-logo');
  assert.ok(
    /background:\s*none/.test(hasLogo),
    'has-logo 应关掉印章底色，否则彩色底板会从 logo 边缘漏出来',
  );

  const after = readRule('.brand-mark.has-logo::after');
  assert.ok(
    /display:\s*none/.test(after),
    '三道横线是伪元素、会画在图片上层，必须让开——否则白色横线会压在 logo 画面上',
  );
});

test('S14 · logo 用不着懒加载', () => {
  const { tag } = readLogoTag();
  assert.ok(
    !/loading="lazy"/.test(tag),
    'logo 在侧栏首屏可见，懒加载只会让它晚一步出现；懒加载是背景图那种"首屏外、体积大"的资源才需要的',
  );
});

test('S14 · logo 是装饰性的，不该被读屏重复念一遍', () => {
  const { tag } = readLogoTag();
  assert.ok(/alt=""/.test(tag), 'logo 的 alt 应为空串（装饰性图片）');
  assert.ok(
    /class="brand-mark"[^>]*aria-hidden="true"/.test(HTML),
    '承载 logo 的印章是装饰，应保持 aria-hidden——品牌名已由旁边的文字读出',
  );
});

// ---------------------------------------------------------------------------
// 加载失败必须能退回印章
// ---------------------------------------------------------------------------

/** 抠出 setupBrandLogo 的函数体（按花括号配对，避免被里面的 { once: true } 骗到） */
function readSetupBrandLogo() {
  const start = MAIN_JS.indexOf('function setupBrandLogo');
  assert.ok(start !== -1, 'main.js 应有 setupBrandLogo');
  const bodyStart = MAIN_JS.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < MAIN_JS.length; i += 1) {
    if (MAIN_JS[i] === '{') depth += 1;
    else if (MAIN_JS[i] === '}') {
      depth -= 1;
      if (depth === 0) return MAIN_JS.slice(bodyStart, i + 1);
    }
  }
  return assert.fail('没能找到 setupBrandLogo 的函数体结尾');
}

test('S14 · 加载成功时打上 has-logo，让印章底纹让位', () => {
  const body = readSetupBrandLogo();
  assert.ok(/querySelector\('\.brand-logo'\)/.test(body), '应去找页面上的 .brand-logo');
  assert.ok(/addEventListener\(\s*'load'/.test(body), '应监听 load');
  assert.ok(/classList\.add\('has-logo'\)/.test(body), '加载成功时应打上 has-logo');
});

test('S14 · 加载失败时退回印章，而不是空框或破图', () => {
  const body = readSetupBrandLogo();

  assert.ok(/addEventListener\(\s*'error'/.test(body), '应监听 error');
  assert.ok(
    /logo\.remove\(\)/.test(body),
    '失败时应把 <img> 移除，否则会在方框里留下一个破图图标',
  );
  assert.ok(
    /classList\.remove\('has-logo'\)/.test(body),
    '失败时还要撤掉 has-logo：印章底色已被关掉、横线也被藏起来，' +
      '不撤就会留下一个既没有 logo 也没有印章的空框',
  );
});

test('S14 · error 处理必须挂在「已加载完就直接返回」之前', () => {
  const body = readSetupBrandLogo();

  const errorAt = body.indexOf("'error'");
  const completeAt = body.indexOf('logo.complete');

  assert.ok(errorAt !== -1, '应监听 error');
  assert.ok(completeAt !== -1, '应有 complete 判断（命中缓存时不会再触发 load）');
  assert.ok(
    errorAt < completeAt,
    'error 处理要在 complete 提前返回**之前**挂上。' +
      '挂在后面的话，图片加载成功后再失效（换文件、文件被删）就没有兜底，' +
      '方框会一直停在"破了但没有退回印章"的状态——这正是探针实测发现的那个缺口',
  );
});

test('S14 · 图片早已加载完（内存缓存）时也要处理', () => {
  const body = readSetupBrandLogo();
  assert.ok(
    /logo\.complete/.test(body),
    '图片命中缓存时不会再触发 load 事件，必须用 complete 判断一次，' +
      '否则每次刷新侧栏都会停在没有底纹的中间态',
  );
  assert.ok(
    /naturalWidth\s*>\s*0/.test(body),
    'complete 为 true 也要靠 naturalWidth 区分"加载成功"与"加载失败"',
  );
});

test('S14 · bootstrap 一开始就装上 logo，别等数据加载完', () => {
  const boot = /async function bootstrap\s*\(\)\s*\{([\s\S]*?)\n\}/.exec(MAIN_JS);
  assert.ok(boot, 'main.js 应有 bootstrap');
  assert.ok(
    /setupBrandLogo\(\)/.test(boot[1]),
    'setupBrandLogo 应在 bootstrap 里调用',
  );

  const logoAt = boot[1].indexOf('setupBrandLogo()');
  const awaitAt = boot[1].indexOf('await store.load()');
  assert.ok(awaitAt !== -1, 'bootstrap 里应有 await store.load()');
  assert.ok(
    logoAt < awaitAt,
    'logo 要在拉取设置之前就装上：服务连不上时侧栏仍应显示 logo，' +
      '而不是空等到请求失败',
  );
});
