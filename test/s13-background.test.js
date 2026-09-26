/**
 * S13 页面背景图测试。
 *
 * 守的规则有两条：
 *
 *   1. **设置的图必须真的取得到。** 这里最容易出的问题是"设置页显示选了图，
 *      但页面上是一片空白"——原因通常是静态资源服务把找不到的 /img/ 请求
 *      回退成了 index.html，于是 <img> 拿到一段 HTML，浏览器只能显示破图。
 *      所以这组测试不只查接口返回值，还把列出来的每一张图**真的取一遍**，
 *      比对磁盘上的字节数与 MIME。
 *
 *   2. **半透明是"纱"这一层做的，图层顺序不能颠倒。**
 *      压在图上面的那层纱（--bg-veil，底色 50%）在图**之上**，
 *      图片在最底下。一旦有人把两层写反，图片就会盖住纱，
 *      文字压在图上会看不清——界面上未必立刻看得出来，所以用测试钉住。
 *
 * 需要往目录里放图的用例一律用 QSX_BACKGROUND_DIR 重定向到临时目录，
 * 不碰用户真实放进来的图片（与开机自启测试的 QSX_STARTUP_DIR 是同一套做法）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { startTestServer, ok, makePng, PUBLIC_DIR } = await import('./helpers.js');
const { backgroundDir, DEFAULT_BACKGROUND, backgroundUrl, listBackgrounds } =
  await import('../server/assets.js');

const CSS = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'app.css'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'pages', 'settings.js'), 'utf8');
const STORE_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'store.js'), 'utf8');
const API_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'api.js'), 'utf8');

/** 各扩展名对应的 Content-Type（与 http.js 的 MIME 表一致） */
const EXPECTED_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

/**
 * 把背景图目录临时重定向到一个隔离目录，测试结束后自动还原。
 * @param {import('node:test').TestContext} t
 * @param {Array<[string, Buffer]>} [files] 预置进去的图片
 */
function useTempBackgroundDir(t, files = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-bg-'));
  for (const [name, buf] of files) fs.writeFileSync(path.join(dir, name), buf);

  const prev = process.env.QSX_BACKGROUND_DIR;
  process.env.QSX_BACKGROUND_DIR = dir;

  t.after(() => {
    if (prev === undefined) delete process.env.QSX_BACKGROUND_DIR;
    else process.env.QSX_BACKGROUND_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/**
 * 从源码里抠出一个具名函数并求值。
 *
 * 目的：让"前端拼出来的 URL"与"服务端真正提供的 URL"在同一份代码上对齐，
 * 而不是在测试里手抄一遍 URL 格式（手抄的副本不会跟着代码一起改，
 * 于是测试看着绿、页面却是破图）。
 */
function extractFunction(source, name) {
  const head = `export function ${name}(`;
  const start = source.indexOf(head);
  assert.ok(start !== -1, `源码里应有 export function ${name}`);

  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const fnSource = source.slice(source.indexOf('function', start), i + 1);
        // eslint-disable-next-line no-new-func
        return new Function(`return (${fnSource})`)();
      }
    }
  }
  assert.fail(`没能找到 ${name} 的函数体结尾`);
}

const assetUrl = extractFunction(API_JS, 'assetUrl');

/** 直接取原始响应（不走 helpers 的 JSON/text 解析，因为要验二进制） */
async function fetchRaw(srv, urlPath) {
  const res = await fetch(`${srv.base}${urlPath}`);
  return {
    status: res.status,
    type: res.headers.get('content-type') || '',
    bytes: Buffer.from(await res.arrayBuffer()),
  };
}

// ---------------------------------------------------------------------------
// 可选图列表
// ---------------------------------------------------------------------------

test('S13 · 默认背景图确实存在，且被列在可选列表里', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const body = ok(await srv.get('/api/backgrounds'));

  assert.equal(body.defaultImage, DEFAULT_BACKGROUND);
  assert.ok(
    Array.isArray(body.images) && body.images.length > 0,
    'img/background 目录里应至少有一张图（默认是 background.jpg）',
  );

  const names = body.images.map((i) => i.name);
  assert.ok(
    names.includes(DEFAULT_BACKGROUND),
    `默认背景图 ${DEFAULT_BACKGROUND} 必须在列表里，否则"默认值"指向一张不存在的图`,
  );

  // 列表里的每一项都必须真是磁盘上的文件
  for (const img of body.images) {
    assert.ok(
      fs.existsSync(path.join(backgroundDir(), img.name)),
      `${img.name} 出现在列表里，磁盘上却找不到`,
    );
  }
});

test('S13 · 列表与 /api/settings 报告的是同一个选择', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { settings } = ok(await srv.get('/api/settings'));
  const backgrounds = ok(await srv.get('/api/backgrounds'));

  assert.equal(
    backgrounds.current,
    settings.backgroundImage,
    '两个接口如果各说各话，设置页显示的选择就成了假的',
  );
});

test('S13 · 列表由目录决定，往目录里放图就会自动出现', async (t) => {
  useTempBackgroundDir(t, [
    ['a.png', makePng(4, 4, [29, 158, 117])],
    ['b.png', makePng(4, 4, [47, 127, 209])],
  ]);
  const srv = await startTestServer();
  t.after(() => srv.close());

  const body = ok(await srv.get('/api/backgrounds'));
  assert.deepEqual(
    body.images.map((i) => i.name),
    ['a.png', 'b.png'],
    '目录里有什么就列什么，不需要改代码',
  );
  assert.equal(body.images[0].url, '/img/background/a.png');

  // 放一张新图进去，不用重启服务也能看到
  fs.writeFileSync(path.join(backgroundDir(), 'c.png'), makePng(4, 4, [186, 117, 23]));
  const after = ok(await srv.get('/api/backgrounds')).images.map((i) => i.name);
  assert.deepEqual(after, ['a.png', 'b.png', 'c.png']);
});

test('S13 · 目录里的非图片文件不会被当成背景图', async (t) => {
  useTempBackgroundDir(t, [
    ['real.png', makePng(4, 4)],
    ['notes.txt', Buffer.from('不是图片')],
    ['.gitkeep', Buffer.from('')],
  ]);
  const srv = await startTestServer();
  t.after(() => srv.close());

  const names = ok(await srv.get('/api/backgrounds')).images.map((i) => i.name);
  assert.deepEqual(names, ['real.png'], '只有图片才会出现在可选列表里');
});

test('S13 · 目录为空时不报错，接口照常可用', async (t) => {
  useTempBackgroundDir(t);
  const srv = await startTestServer();
  t.after(() => srv.close());

  const body = ok(await srv.get('/api/backgrounds'));
  assert.deepEqual(body.images, [], '没有图片时列表就是空的，不该抛错');

  // 此时目录里没有那张默认图，选它就该被拒绝——不能"设置写进去了、图却不存在"
  const res = await srv.put('/api/settings', { backgroundImage: DEFAULT_BACKGROUND });
  assert.equal(res.status, 400);

  // 但"不使用背景图"仍然合法，界面不会卡死在这个状态
  assert.equal((await srv.put('/api/settings', { backgroundImage: '' })).status, 200);
});

// ---------------------------------------------------------------------------
// 图片真的能取到（这是之前最可能出问题的地方）
// ---------------------------------------------------------------------------

test('S13 · 列出的每一张图都能取到真实字节，而不是一段 HTML', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { images } = ok(await srv.get('/api/backgrounds'));
  assert.ok(images.length > 0);

  for (const img of images) {
    const onDisk = fs.readFileSync(path.join(backgroundDir(), img.name));
    const res = await fetchRaw(srv, img.url);

    assert.equal(res.status, 200, `${img.name} 应可以直接取到`);
    assert.ok(
      res.type.startsWith('image/'),
      `${img.name} 的 Content-Type 是 ${res.type}，不是图片——很可能被回退成了 index.html`,
    );
    assert.equal(
      res.type,
      EXPECTED_MIME[path.extname(img.name).toLowerCase()],
      `${img.name} 的 MIME 类型不对`,
    );
    assert.equal(res.bytes.length, onDisk.length, `${img.name} 取到的字节数与磁盘不一致`);
    assert.ok(res.bytes.equals(onDisk), `${img.name} 取到的内容与磁盘上的文件不一样`);
  }
});

test('S13 · 前端拼出的 URL 与服务端提供的 URL 一致', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { images } = ok(await srv.get('/api/backgrounds'));

  for (const img of images) {
    // store.js 是这样拼的：assetUrl('background/' + 文件名)
    const fromFrontend = assetUrl(`background/${img.name}`);
    assert.equal(
      fromFrontend,
      backgroundUrl(img.name),
      `${img.name}: 前端拼出 ${fromFrontend}，服务端用的是 ${backgroundUrl(img.name)}`,
    );

    const res = await fetchRaw(srv, fromFrontend);
    assert.equal(res.status, 200, `前端拼出来的地址 ${fromFrontend} 取不到东西`);
  }
});

test('S13 · 拿不到的图返回 JSON 404，不能悄悄回退成页面', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const missing = ['/img/background/nope.jpg', '/img/background/不存在.png', '/img/nope.png'];
  for (const urlPath of missing) {
    const res = await fetchRaw(srv, urlPath);
    assert.equal(res.status, 404, `${urlPath} 应返回 404`);
    assert.ok(
      res.type.includes('application/json'),
      `${urlPath} 返回了 ${res.type}；<img> 拿到 HTML 会显示成破图`,
    );
    assert.ok(!res.bytes.toString('utf8').includes('<html'), `${urlPath} 不该返回页面内容`);
  }
});

test('S13 · /img/ 取不到项目源码（挡住路径穿越）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const attempts = [
    '/img/..%2Fserver%2Fdb.js',
    '/img/..%2F..%2Fserver%2Fdb.js',
    '/img/%2e%2e%2fserver%2fdb.js',
    '/img/....//server/db.js',
  ];

  for (const attempt of attempts) {
    const res = await fetchRaw(srv, attempt);
    const text = res.bytes.toString('utf8');
    assert.ok(
      !text.includes('CREATE TABLE'),
      `${attempt} 竟然返回了数据库层源码，路径穿越没有被挡住`,
    );
    assert.equal(res.status, 404, `${attempt} 应被拒绝`);
  }
});

// ---------------------------------------------------------------------------
// 设置项
// ---------------------------------------------------------------------------

test('S13 · 可以换成目录里的另一张图', async (t) => {
  useTempBackgroundDir(t, [
    ['a.png', makePng(4, 4, [29, 158, 117])],
    ['b.png', makePng(4, 4, [47, 127, 209])],
  ]);
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = ok(await srv.put('/api/settings', { backgroundImage: 'b.png' }));
  assert.equal(res.settings.backgroundImage, 'b.png', '设置应真的写进去了');

  assert.equal(
    ok(await srv.get('/api/settings')).settings.backgroundImage,
    'b.png',
    '重新读取应还是这张图',
  );
  assert.equal(ok(await srv.get('/api/backgrounds')).current, 'b.png');
});

test('S13 · 可以关掉背景图（不使用时留空）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = ok(await srv.put('/api/settings', { backgroundImage: '' }));
  assert.equal(res.settings.backgroundImage, '', '留空表示不使用背景图');
  assert.equal(ok(await srv.get('/api/settings')).settings.backgroundImage, '');
});

test('S13 · 不存在的图 / 带路径 / 非图片扩展名一律拒绝', async (t) => {
  useTempBackgroundDir(t, [['ok.png', makePng(4, 4)]]);
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.put('/api/settings', { backgroundImage: 'ok.png' }));

  const bad = [
    ['nope.jpg', '文件不存在'],
    ['../ok.png', '不允许上跳'],
    ['sub/pic.png', '不允许带目录'],
    ['sub\\pic.png', '不允许带目录（反斜杠）'],
    ['..\\ok.png', '不允许上跳（反斜杠）'],
    ['evil.exe', '非图片扩展名'],
    ['real.txt', '非图片扩展名'],
  ];

  for (const [value, why] of bad) {
    const res = await srv.put('/api/settings', { backgroundImage: value });
    assert.equal(res.status, 400, `${value} 应被拒绝（${why}）`);
  }

  assert.equal(
    ok(await srv.get('/api/settings')).settings.backgroundImage,
    'ok.png',
    '被拒绝的写入不该改动原有设置',
  );
});

test('S13 · 背景图设置只在白名单里，不会顺手改到别的设置', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = ok(
    await srv.put('/api/settings', {
      backgroundImage: DEFAULT_BACKGROUND,
      notASetting: 'hack',
      dbPath: 'C:\\evil',
    }),
  );
  assert.equal(res.settings.notASetting, undefined);
  assert.ok(!('dbPath' in res.settings), 'dbPath 不该能被这种请求写进来');
});

// ---------------------------------------------------------------------------
// 半透明的实现方式：纱在图之上，图在最底下
// ---------------------------------------------------------------------------

/** 取出 html[data-bg="on"] body 的样式块 */
function readBgLayerBlock() {
  const m = /html\[data-bg="on"\]\s*body\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(m, 'app.css 里应有 html[data-bg="on"] body 的图层规则');
  return m[1];
}

test('S13 · 半透明用的是「底色 50% 的纱」，符合"透明度一半左右"', () => {
  const m = /--bg-veil\s*:\s*color-mix\([^;]*?(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)/.exec(CSS);
  assert.ok(m, '--bg-veil 应是"底色 + transparent"的混合，用来把图压成半透');

  const percent = Number(m[1]);
  assert.ok(
    percent >= 40 && percent <= 60,
    `纱的不透明度是 ${percent}%，偏离"一半左右"太远：太低会让文字看不清，太高就看不见图了`,
  );
});

test('S13 · 图层顺序不能颠倒：图片在最底下，纱在它上面', () => {
  const block = readBgLayerBlock();

  const photoAt = block.indexOf('var(--bg-photo)');
  const veilAt = block.indexOf('var(--bg-veil)');

  assert.ok(photoAt !== -1, '图层里应包含 --bg-photo（也就是那张图）');
  assert.ok(veilAt !== -1, '图层里应包含 --bg-veil（那层纱）');

  assert.ok(
    veilAt < photoAt,
    '纱必须写在图片**之前**：background-image 是前面的层压后面的层，' +
      '写反了图片会盖住纱，文字压在图上就看不清了',
  );
});

test('S13 · 图片按 cover 铺满，且不重复平铺', () => {
  const block = readBgLayerBlock();

  assert.ok(/background-size\s*:[^;]*cover/.test(block), '图片要按 cover 铺满整屏，否则会露出边角');
  assert.ok(
    /background-repeat\s*:[^;]*no-repeat/.test(block),
    '不应重复平铺，否则一张图会变成一片花纹',
  );
});

test('S13 · 默认不显示背景图，必须由设置打开', () => {
  assert.ok(/--bg-photo\s*:\s*none/.test(CSS), '--bg-photo 默认应为 none：没设置时不应有图');
  assert.ok(
    /html\[data-bg="on"\]\s*body/.test(CSS),
    '只有打上 data-bg="on" 时才换用带图的图层，避免影响未启用的情况',
  );
});

// ---------------------------------------------------------------------------
// 前端接线
// ---------------------------------------------------------------------------

test('S13 · 设置页把可选图渲染成可点的缩略图', () => {
  assert.ok(SETTINGS_JS.includes('data-bg-pick'), '缩略图应带 data-bg-pick，便于点选');
  assert.ok(SETTINGS_JS.includes('data-bg-state'), '应有一处显示当前用的是哪张图');
  assert.ok(
    /thumbs[\s\S]*?<img[^>]*src=/.test(SETTINGS_JS),
    '缩略图应真的渲染 <img>，而不是只列文件名',
  );
  assert.ok(
    SETTINGS_JS.includes('bg-thumb-none') && SETTINGS_JS.includes('不使用'),
    '应提供"不使用背景图"这一项，否则选了图就回不去了',
  );
});

test('S13 · 点缩略图会写回设置（缩略图不是摆设）', () => {
  assert.ok(
    /data-bg-pick[\s\S]*?addEventListener\('click'/.test(SETTINGS_JS),
    '缩略图应绑定了点击事件',
  );
  assert.ok(
    /store\.update\(\{\s*backgroundImage:/.test(SETTINGS_JS),
    '点击后应通过 store.update 写入 backgroundImage，并即时生效',
  );
});

test('S13 · store 把图片地址写进 CSS 变量并打上 data-bg 标记', () => {
  assert.ok(/applyBackground\s*\(/.test(STORE_JS), 'store 应有 applyBackground');
  assert.ok(
    /--bg-photo/.test(STORE_JS),
    'applyBackground 应写入 --bg-photo，具体效果交给 CSS 图层',
  );
  assert.ok(
    /setAttribute\('data-bg',\s*'on'\)/.test(STORE_JS),
    '启用背景图时应打上 data-bg="on"',
  );
  assert.ok(
    /removeAttribute\('data-bg'\)/.test(STORE_JS),
    '关闭背景图时应移除标记，而不是留着上一次的图',
  );
  assert.ok(
    /applyTheme\s*\(\)[\s\S]*?applyBackground\(\)/.test(STORE_JS),
    'applyTheme 应调用 applyBackground：切主题/切深浅色时背景图要一起跟上',
  );
  assert.ok(
    STORE_JS.includes('assetUrl(`background/'),
    'store 拼地址时应走 assetUrl 的 background/ 前缀，不要自己手拼 URL',
  );
});

test('S13 · 资源地址集中在 api.js 的 assetUrl 里', () => {
  // 与用户数据（/files/）分开：img/ 是随应用走的自带资源
  assert.equal(assetUrl('background/x.jpg'), '/img/background/x.jpg');
  assert.equal(assetUrl('logo/logo.jpg'), '/img/logo/logo.jpg');
  assert.equal(assetUrl(''), '', '空路径应返回空串，避免拼出 /img/ 这种地址');
  assert.equal(
    assetUrl('background/中文 名.jpg'),
    '/img/background/%E4%B8%AD%E6%96%87%20%E5%90%8D.jpg',
    '中文与空格要转义，否则浏览器取不到',
  );
  assert.ok(
    API_JS.includes('export function assetUrl'),
    'assetUrl 应在 api.js 里集中定义，便于与 /files/ 那套区分开',
  );
});

test('S13 · 背景图目录本身可用', () => {
  assert.ok(fs.existsSync(backgroundDir()), 'img/background 目录应存在');
  for (const item of listBackgrounds()) {
    assert.ok(typeof item.name === 'string' && item.name.length > 0);
    assert.ok(item.url.startsWith('/img/background/'));
  }
});
