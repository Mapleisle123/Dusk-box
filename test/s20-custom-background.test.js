/**
 * S20 自定义背景图测试。
 *
 * 这一版新增的能力：在设置页里直接添加一张自己的背景图，
 * 图片落在**数据目录**的 背景图/ 下，不往任何地方上传
 * （服务只跑在 127.0.0.1 上，这一步就是把文件写进本机磁盘）。
 *
 * 这组测试守的是四个最可能被改坏的地方：
 *
 *   1. **"名字就是地址"这条约定。** 自带图与自定义图来自两个目录，
 *      却共用同一个 URL 前缀 /img/background/，设置里存的始终是一个纯文件名。
 *      一旦有人给自定义图换一个前缀（比如 /files/背景图/），
 *      设置里那个名字就会在换来源的那一刻指向一个不存在的地址——
 *      接口读得出来、页面上却是一片空白。所以这里不只查列表，
 *      还逐个把图**真的取一遍**、比对磁盘字节（与 S13 同一套做法）。
 *
 *   2. **同名撞车。** 数据目录里放一张也叫 background.jpg 的图，
 *      如果直接落盘，自带的默认图就永远选不中了（一个名字只能指向一张图，
 *      而解析顺序是"自定义优先"）。所以存图时必须把重名唯一化。
 *
 *   3. **删掉正在用的那张。** 文件没了、设置里却还留着那个文件名，
 *      会得到一个读得出来但画不出来的界面，而且从此"不使用"以外都不对。
 *      删除接口必须顺手把这处引用清掉。
 *
 *   4. **它算不算用户数据。** 备份、恢复、导出三个出口都必须带上它，
 *      否则恢复之后背景图会凭空消失，而用户很难联想到是恢复造成的。
 *
 * 需要往目录里放图或用临时数据目录的用例，一律用每个用例独立的临时目录
 * （startTestServer 自带），不碰用户真实的数据。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 必须在任何配置读写之前设置（与 S6 / S18 同一套做法）
const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-cfg-s20-'));
process.env.QSX_CONFIG_FILE = path.join(configHome, 'config.json');

const { startTestServer, ok, makePng, PUBLIC_DIR } = await import('./helpers.js');

/**
 * 自带目录也重定向到临时目录，往里放一张与默认图同名的图。
 *
 * 两个理由：
 *   1. 测试往返读写图片时不会动到用户真实放进来的图（与 S13 同一套做法）；
 *   2. **反向验证里有一条植入会把自定义图故意存错到自带目录**——
 *      不隔离的话，那条植入会把测试图片真的写进项目的 img/background。
 *      （这不是假设：加隔离之前它已经写进去过 15 个文件。）
 */
const builtinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-bg-builtin-'));
process.env.QSX_BACKGROUND_DIR = builtinDir;

const { backgroundDir, DEFAULT_BACKGROUND, backgroundUrl, listBackgrounds } =
  await import('../server/assets.js');
const { userBackgroundDir, MAX_BACKGROUND_BYTES, saveUserBackground } =
  await import('../server/backgrounds.js');

// 种一张与默认图同名的图：好几条用例都依赖"自带目录里确实有那张默认图"
fs.writeFileSync(path.join(builtinDir, DEFAULT_BACKGROUND), makePng(8, 8));

test.after(() => {
  delete process.env.QSX_CONFIG_FILE;
  delete process.env.QSX_BACKGROUND_DIR;
  fs.rmSync(configHome, { recursive: true, force: true });
  fs.rmSync(builtinDir, { recursive: true, force: true });
});

const API_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'api.js'), 'utf8');
const SETTINGS_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'pages', 'settings.js'), 'utf8');
const STORE_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'store.js'), 'utf8');

/** 从源码里抠出一个具名函数并求值（与 S13 同一套做法） */
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
        // eslint-disable-next-line no-new-func
        return new Function(`return (${source.slice(source.indexOf('function', start), i + 1)})`)();
      }
    }
  }
  assert.fail(`没能找到 ${name} 的函数体结尾`);
}

const assetUrl = extractFunction(API_JS, 'assetUrl');

/** 取原始响应（要验二进制，不能走 helpers 的 JSON/text 解析） */
async function fetchRaw(srv, urlPath) {
  const res = await fetch(`${srv.base}${urlPath}`);
  return {
    status: res.status,
    type: res.headers.get('content-type') || '',
    bytes: Buffer.from(await res.arrayBuffer()),
  };
}

/** 上传一张图（multipart，字段名与前端一致） */
function uploadBackground(srv, { name = 'mine.png', buffer = makePng(6, 6), field = 'file' } = {}) {
  return srv.postForm('/api/backgrounds', {}, [{ field, name, buffer }]);
}

/** 数据目录里自定义背景图目录的位置 */
const userDirOf = (srv) => path.join(srv.dataRoot, '背景图');

// ---------------------------------------------------------------------------
// 1. 列表：两个来源合成一份
// ---------------------------------------------------------------------------

test('S20 · 列表把自带图与自定义图合起来，自定义的排在前面', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const before = ok(await srv.get('/api/backgrounds'));
  const builtinNames = before.images.map((i) => i.name);
  assert.ok(builtinNames.includes(DEFAULT_BACKGROUND), '自带的默认图应该还在列表里');
  assert.ok(
    before.images.every((i) => i.user === false && i.source === 'builtin'),
    '还没有添加过图时，列表里应该全是自带的',
  );

  const added = ok(await uploadBackground(srv, { name: '我的墙纸.png' })).added;

  const after = ok(await srv.get('/api/backgrounds'));
  assert.equal(after.images[0].name, added.name, '自己添加的图应排在前面（刚加的最可能马上要用）');
  assert.equal(after.images[0].user, true, '应标明这是用户自己添加的');
  assert.equal(after.images[0].source, 'user');
  assert.deepEqual(
    after.images.slice(1).map((i) => i.name),
    builtinNames,
    '自带的那几张不能被自定义图挤掉，也不能换顺序（S13 对它们有断言）',
  );
});

test('S20 · 图落在数据目录里，不进 img/background（"不上传"的落地部分）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const builtinBefore = fs.readdirSync(backgroundDir()).sort();
  const { added } = ok(await uploadBackground(srv, { name: 'mine.png' }));

  assert.ok(
    fs.existsSync(path.join(userDirOf(srv), added.name)),
    '图片应落在 <数据目录>/背景图/ 下',
  );
  assert.deepEqual(
    fs.readdirSync(backgroundDir()).sort(),
    builtinBefore,
    'img/background（随应用走的资源）不该被写进用户添加的图',
  );
  assert.ok(
    added.path.startsWith('背景图/'),
    `接口报告的相对路径应在数据目录内，实际是 ${added.path}`,
  );
});

// ---------------------------------------------------------------------------
// 2. 名字就是地址：两种来源共用同一个 URL 前缀
// ---------------------------------------------------------------------------

test('S20 · 自定义图沿用 /img/background/ 前缀，且真的取得回磁盘上的字节', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const buffer = makePng(9, 5, [47, 127, 209]);
  const { added } = ok(await uploadBackground(srv, { name: 'wall.png', buffer }));

  assert.equal(added.url, backgroundUrl(added.name), '接口给的地址应与服务端的拼法一致');

  const onDisk = fs.readFileSync(path.join(userDirOf(srv), added.name));
  const res = await fetchRaw(srv, added.url);

  assert.equal(res.status, 200, `取不到 ${added.url}：说明自定义图没有真的被静态资源这一层认出来`);
  assert.equal(res.type, 'image/png', `Content-Type 是 ${res.type}，不是图片`);
  assert.equal(res.bytes.length, onDisk.length);
  assert.ok(res.bytes.equals(onDisk), '取到的内容与磁盘上的文件不一样');
  assert.ok(res.bytes.equals(buffer), '取到的内容与上传时的字节不一样');
});

test('S20 · 前端拼出的地址与服务端一致（换来源也不会变地址）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { added } = ok(await uploadBackground(srv, { name: '中文 名字.png' }));

  // store.js 是这样拼的：assetUrl('background/' + 文件名)
  assert.equal(
    assetUrl(`background/${added.name}`),
    added.url,
    '前端拼法与服务端不一致的话，页面上就是一张破图',
  );
  assert.ok(assetUrl(`background/${added.name}`).startsWith('/img/background/'));
  assert.equal((await fetchRaw(srv, assetUrl(`background/${added.name}`))).status, 200);

  // 中文与空格必须转义过，否则浏览器取不到
  assert.equal(
    assetUrl(`background/${added.name}`),
    `/img/background/${encodeURIComponent(added.name)}`,
  );
});

test('S20 · 列表里的每一项地址都能取到（自带与自定义一视同仁）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await uploadBackground(srv, { name: 'a.png' }));
  ok(await uploadBackground(srv, { name: 'b.png' }));

  const { images } = ok(await srv.get('/api/backgrounds'));
  assert.ok(images.length >= 3, '应同时列出自定义图与自带图');

  for (const img of images) {
    const res = await fetchRaw(srv, img.url);
    assert.equal(res.status, 200, `${img.name} 列在列表里却取不到`);
    assert.ok(res.type.startsWith('image/'), `${img.name} 的 Content-Type 是 ${res.type}`);
  }
});

// ---------------------------------------------------------------------------
// 3. 同名的处理
// ---------------------------------------------------------------------------

test('S20 · 与自带的图同名时自动改名，两张都还在', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { added } = ok(await uploadBackground(srv, { name: DEFAULT_BACKGROUND }));

  assert.notEqual(
    added.name,
    DEFAULT_BACKGROUND,
    '直接落成同名的话，自带的默认图就永远选不中了（一个名字只能指向一张图）',
  );
  assert.match(added.name, / \(2\)\.jpe?g$/i, `应按"名字 (2).ext"的规则让路，实际是 ${added.name}`);

  // 自带的那张必须还在、还能取到
  assert.ok(fs.existsSync(path.join(backgroundDir(), DEFAULT_BACKGROUND)));
  assert.deepEqual(
    (await fetchRaw(srv, backgroundUrl(DEFAULT_BACKGROUND))).status,
    200,
    '自带的那张应仍然取得到',
  );

  const names = ok(await srv.get('/api/backgrounds')).images.map((i) => i.name);
  assert.ok(names.includes(DEFAULT_BACKGROUND), '自带的那张应仍在列表里');
  assert.ok(names.includes(added.name), '改过名的那张也应在列表里');
  assert.equal(new Set(names).size, names.length, '同一个名字不该出现两次');
});

test('S20 · 原始文件名里的路径与非法字符被净化，落盘的名字仍然可用', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const nasty = ['..\\..\\evil.png', '../../evil.png', 'a/b/c.png', '名字:带冒号*.png'];
  for (const raw of nasty) {
    const { added } = ok(await uploadBackground(srv, { name: raw, buffer: makePng(4, 4) }));

    assert.ok(!added.name.includes('/') && !added.name.includes('\\'), `落盘名不该带分隔符：${added.name}`);
    assert.ok(!added.name.includes('..'), `落盘名不该带上跳：${added.name}`);
    assert.ok(
      fs.existsSync(path.join(userDirOf(srv), added.name)),
      `净化后的名字必须是真实存在的文件名：${added.name}`,
    );
    // 关键：净化后的名字必须还能被解析回来（否则图存进去了却永远选不中）
    assert.equal(
      (await fetchRaw(srv, backgroundUrl(added.name))).status,
      200,
      `${raw} 净化成 ${added.name} 之后取不到，说明它不满足"名字就是地址"`,
    );
    assert.equal(
      (await srv.put('/api/settings', { backgroundImage: added.name })).status,
      200,
      `${raw} 净化成 ${added.name} 之后设不进去`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. 拒绝不该进来的东西
// ---------------------------------------------------------------------------

test('S20 · 非图片、空内容、没有文件一律拒绝', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const cases = [
    ['notes.txt', Buffer.from('这不是图片'), '文本文件'],
    ['evil.exe', Buffer.from('MZ'), '可执行文件'],
    ['noext', Buffer.alloc(0), '空文件'],
  ];
  for (const [name, buffer, why] of cases) {
    const res = await uploadBackground(srv, { name, buffer });
    assert.equal(res.status, 400, `${name}（${why}）应被拒绝`);
  }

  // 一个文件都没带
  const empty = await srv.postForm('/api/backgrounds', {});
  assert.equal(empty.status, 400, '没有文件时应返回 400，而不是静默成功');

  // 被拒绝之后目录里不该留下垃圾
  assert.deepEqual(
    fs.existsSync(userDirOf(srv)) ? fs.readdirSync(userDirOf(srv)) : [],
    [],
    '被拒绝的上传不该在数据目录里留下任何文件',
  );
});

test('S20 · 超过大小上限的图会被拒（不存在"悄悄存下半张"）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-bg-limit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // 直接调存储层，避免为了这条用例往请求体里塞 20MB
  const big = Buffer.alloc(MAX_BACKGROUND_BYTES + 1);
  assert.throws(
    () => saveUserBackground(dir, { buffer: big, originalName: 'big.png' }),
    (err) => err.status === 413 && /MB/.test(err.message),
    '超过上限应抛出 413（请求体本身还没到 http.js 的上限，所以必须在这里挡住）',
  );
  assert.equal(fs.existsSync(path.join(dir, '背景图', 'big.png')), false);
});

test('S20 · 设置接口只认列表里真实存在的名字', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { added } = ok(await uploadBackground(srv, { name: 'ok.png' }));

  assert.equal((await srv.put('/api/settings', { backgroundImage: added.name })).status, 200);
  assert.equal(
    ok(await srv.get('/api/backgrounds')).current,
    added.name,
    '两个接口必须说的是同一个选择',
  );

  const bad = ['nope.png', '../ok.png', 'sub/pic.png', 'sub\\pic.png', 'x.txt', '..\\ok.png'];
  for (const value of bad) {
    assert.equal(
      (await srv.put('/api/settings', { backgroundImage: value })).status,
      400,
      `${value} 应被拒绝`,
    );
  }
  assert.equal(
    ok(await srv.get('/api/settings')).settings.backgroundImage,
    added.name,
    '被拒绝的写入不该改动原有设置',
  );
});

// ---------------------------------------------------------------------------
// 5. 删除
// ---------------------------------------------------------------------------

test('S20 · 删除会真的把文件删掉，列表里也不再出现', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { added } = ok(await uploadBackground(srv, { name: 'temp.png' }));
  const abs = path.join(userDirOf(srv), added.name);
  assert.ok(fs.existsSync(abs));

  const res = ok(await srv.del(`/api/backgrounds/${encodeURIComponent(added.name)}`));
  assert.equal(res.removed, added.name);
  assert.equal(res.cleared, false, '删的不是当前在用的那张，不该动设置');
  assert.equal(fs.existsSync(abs), false, '文件应该真的从磁盘上消失');
  assert.equal(res.images.some((i) => i.name === added.name), false);
});

test('S20 · 删掉正在使用的那张时，设置一并清空（不留悬空引用）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { added } = ok(await uploadBackground(srv, { name: 'current.png' }));
  ok(await srv.put('/api/settings', { backgroundImage: added.name }));

  const res = ok(await srv.del(`/api/backgrounds/${encodeURIComponent(added.name)}`));
  assert.equal(res.cleared, true, '删的正是当前在用的那张，应报告已清空');
  assert.equal(res.current, '', '接口应返回清空之后的当前值');
  assert.equal(
    ok(await srv.get('/api/settings')).settings.backgroundImage,
    '',
    '库里不该留下指向已删除文件的文件名：接口读得出来，页面上却是一片空白',
  );
  assert.equal(ok(await srv.get('/api/backgrounds')).current, '');
});

test('S20 · 自带的图不能通过接口删掉，不存在的图返回 404', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = await srv.del(`/api/backgrounds/${encodeURIComponent(DEFAULT_BACKGROUND)}`);
  assert.equal(res.status, 400, '自带的图是随应用走的资源，接口不该动它');
  assert.ok(
    fs.existsSync(path.join(backgroundDir(), DEFAULT_BACKGROUND)),
    '被拒之后自带的图必须还在',
  );

  assert.equal((await srv.del('/api/backgrounds/nope.png')).status, 404);

  const { added } = ok(await uploadBackground(srv, { name: 'safe.png' }));
  for (const evil of ['..%2Fsafe.png', '%2e%2e%2Fsafe.png', 'sub%2Fpic.png', 'safe.txt']) {
    assert.equal((await srv.del(`/api/backgrounds/${evil}`)).status, 400, `${evil} 应被拒绝`);
  }
  assert.ok(
    fs.existsSync(path.join(userDirOf(srv), added.name)),
    '被拒绝的删除请求不该动到别的文件',
  );
});

// ---------------------------------------------------------------------------
// 6. 它算用户数据：备份 / 恢复 / 导出
// ---------------------------------------------------------------------------

test('S20 · 自定义背景图纳入备份，恢复后设置里的名字仍指向真实的图', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const buffer = makePng(7, 7, [186, 117, 23]);
  const { added } = ok(await uploadBackground(srv, { name: 'keep.png', buffer }));
  ok(await srv.put('/api/settings', { backgroundImage: added.name }));

  const { backup } = ok(await srv.post('/api/backups', { reason: 'manual' }));
  assert.ok(srv.existsData(`备份/${backup.name}/背景图/${added.name}`), '备份里应带上自定义背景图');

  // 模拟"换台机器"：数据目录里的自定义图没了
  fs.rmSync(userDirOf(srv), { recursive: true, force: true });
  assert.equal(srv.existsData(`背景图/${added.name}`), false);

  ok(await srv.post('/api/backups/restore', { name: backup.name }));

  assert.ok(srv.existsData(`背景图/${added.name}`), '恢复之后图应回来');
  const onDisk = fs.readFileSync(path.join(userDirOf(srv), added.name));
  assert.ok(onDisk.equals(buffer), '恢复出来的文件内容应与备份时一致');

  const after = ok(await srv.get('/api/backgrounds'));
  const item = after.images.find((i) => i.name === added.name);
  assert.ok(item?.user, '恢复之后它应该仍是"我的"那一类');
  assert.equal((await fetchRaw(srv, item.url)).status, 200, '恢复之后仍取得到');
  assert.equal(
    ok(await srv.get('/api/settings')).settings.backgroundImage,
    added.name,
    '设置里的名字没有变，所以文件必须回到原来的位置',
  );
});

test('S20 · 导出的 ZIP 里带上自定义背景图', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { added } = ok(await uploadBackground(srv, { name: '导出用.png' }));

  const res = await fetch(`${srv.base}/api/export`);
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  const asText = buf.toString('utf8');

  assert.ok(
    asText.includes(`背景图/${added.name}`),
    '导出的 ZIP 里应包含自定义背景图（ZIP 中央目录的文件名是明文，可直接查找）',
  );
});

// ---------------------------------------------------------------------------
// 7. 前端接线
// ---------------------------------------------------------------------------

test('S20 · 设置页提供"添加背景图"的入口，并把文件交给本地服务', () => {
  assert.ok(SETTINGS_JS.includes('data-bg-add'), '应有添加背景图的按钮');
  assert.ok(SETTINGS_JS.includes('data-bg-file'), '应有一个隐藏的文件选择框');
  assert.ok(
    /type="file"[^>]*accept="image\/\*"/.test(SETTINGS_JS) ||
      /accept="image\/\*"[^>]*type="file"/.test(SETTINGS_JS),
    '文件框应限定图片类型，避免用户选到一个必然被拒的文件',
  );
  assert.ok(
    /data-bg-file[\s\S]*?addEventListener\('change'/.test(SETTINGS_JS),
    '选完文件要有 change 处理器，否则选了也没反应',
  );
  assert.ok(
    /new FormData\(\)[\s\S]*?api\.uploadBackground\(/.test(SETTINGS_JS),
    '应把文件交给 api.uploadBackground（multipart），而不是自己拼请求',
  );
  // 清空 input：否则连着选同一个文件不会再触发 change
  assert.ok(
    /data-bg-file[\s\S]*?\.value\s*=\s*''/m.test(SETTINGS_JS),
    '选完之后应把文件框清空，否则同一个文件第二次选不动',
  );
});

test('S20 · 自己添加的图可以删，且删除按钮不嵌在缩略图按钮里面', () => {
  assert.ok(SETTINGS_JS.includes('data-bg-del'), '自己添加的缩略图应带删除按钮');
  assert.ok(
    /data-bg-del[\s\S]*?addEventListener\('click'/.test(SETTINGS_JS),
    '删除按钮要真的绑上事件',
  );
  assert.ok(SETTINGS_JS.includes('api.deleteBackground'), '点击后应调用删除接口');
  assert.ok(
    /confirmDialog\(\{[\s\S]*?危险|confirmDialog\(\{[\s\S]*?danger:\s*true/.test(SETTINGS_JS),
    '删除不可撤销，应先弹确认框',
  );

  // button 套 button 是非法结构：浏览器会把内层拆出来，
  // 于是"点删除"变成"点选这张背景图"，而且不报错
  const block = SETTINGS_JS.slice(
    SETTINGS_JS.indexOf('const thumbs'),
    SETTINGS_JS.indexOf('${thumbs}'),
  );
  assert.ok(block.length > 0, '应能找到缩略图的那一段模板');
  for (const piece of block.split('<button').slice(1)) {
    const inner = piece.slice(0, piece.indexOf('</button>'));
    assert.ok(
      !inner.includes('<button'),
      '缩略图按钮里面不能再套一个按钮：浏览器会把它拆开，点删除会变成点选背景图',
    );
  }
  // 删除按钮不该只在自己添加的图上出现（自带的图不该给删除入口）
  assert.ok(
    /img\.user[\s\S]{0,200}?data-bg-del/.test(SETTINGS_JS),
    '删除按钮应只渲染在自己添加的那张上（img.user）',
  );
});

test('S20 · 只有自己添加的图才带"我的"标记，且 store 仍走统一的地址拼法', () => {
  assert.ok(/img\.user/.test(SETTINGS_JS) && SETTINGS_JS.includes('我的'), '应标出哪张是自己加的');
  assert.ok(
    STORE_JS.includes('assetUrl(`background/'),
    'store 拼背景图地址应走 assetUrl 的 background/ 前缀：两种来源共用同一个前缀，才谈得上"名字就是地址"',
  );
});

test('S20 · 删掉正在使用的那张之后，前端状态也要跟着清掉（不能只在服务端清）', () => {
  // 服务端确实把 backgroundImage 清空了，但屏幕上的那块底图是由 store 驱动的：
  // 不采纳服务端返回的新值，界面会继续画着那张已经被删掉的图——
  // 提示条说"已关掉"，页面上却还在；而且下一次 applyTheme（切主题/切深浅色）
  // 还会拿着这个名字去取一张不存在的图。
  // 这是浏览器实测抓出来的：删完之后 data-bg 仍是 on、--bg-photo 仍指着那个已删除的文件。
  assert.ok(/\badopt\s*\(/.test(STORE_JS), 'store 应有一个"采纳服务端已返回的设置"的方法');
  assert.ok(
    /adopt\(patch\)\s*\{[\s\S]{0,260}?this\.settings\s*=[\s\S]{0,120}?applyTheme\(\)/.test(STORE_JS),
    'adopt 要更新 store.settings 并立刻 applyTheme，否则界面不会跟着变',
  );
  assert.ok(
    /data-bg-del[\s\S]*?store\.adopt\(\{\s*backgroundImage:\s*res\.current\s*\}\)/.test(SETTINGS_JS),
    '删除流程应把删除接口返回的 current 采纳进来（接口说清空了，界面就得清空）',
  );
});

test('S20 · 接口客户端集中声明，不散落在页面里', () => {
  assert.ok(
    /uploadBackground:\s*\(formData\)\s*=>[\s\S]{0,120}?\/api\/backgrounds/.test(API_JS),
    'api.js 里应有 uploadBackground 并指向 /api/backgrounds',
  );
  assert.ok(
    /deleteBackground:\s*\(name\)\s*=>[\s\S]{0,140}?encodeURIComponent\(name\)/.test(API_JS),
    'deleteBackground 应把名字转义进路径（中文文件名必须转义才能取到）',
  );
  assert.ok(
    !/fetch\(/.test(SETTINGS_JS),
    '设置页不该自己发请求：接口一律走 api.js，否则统一错误处理会被绕过',
  );
});

test('S20 · 自定义背景图目录本身是数据目录里的一员', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { added } = ok(await uploadBackground(srv, { name: 'x.png' }));
  assert.equal(userBackgroundDir(srv.dataRoot), path.join(srv.dataRoot, '背景图'));
  assert.ok(fs.existsSync(path.join(userBackgroundDir(srv.dataRoot), added.name)));

  // 也是 /files/ 通道里的一份普通文件（这是它"在数据目录里"的另一个证据）
  const viaFiles = await fetchRaw(srv, `/files/${encodeURIComponent('背景图')}/${encodeURIComponent(added.name)}`);
  assert.equal(viaFiles.status, 200, '数据目录里的图应该也能从 /files/ 取到');
  assert.ok(viaFiles.type.startsWith('image/'));

  // 自带图仍然只看自带目录（空目录下不该凭空冒出东西）
  assert.deepEqual(
    listBackgrounds().map((i) => i.name).filter((n) => n === added.name),
    [],
    '自定义图不该出现在"自带资源"的列表里',
  );
});
