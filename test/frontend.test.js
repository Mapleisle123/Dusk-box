/**
 * 前端资源与导出测试。
 *
 * 前端是纯静态文件，没有构建步骤，所以这里的把关特别重要：
 *   - 每个模块都能被语法解析（一个语法错误会让整个应用白屏）
 *   - index.html 引用的资源都真实存在
 *   - 主题色变量齐全（用户在设置里能选到的主题都必须有对应样式）
 *   - 导出功能产出的确实是一个合法 ZIP
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startTestServer, ok, makePng } from './helpers.js';
import { PROJECT_ROOT } from '../server/config.js';
import { crc32 } from '../server/zip.js';

const execFileAsync = promisify(execFile);
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

/** 递归列出目录下所有文件 */
function walkFiles(dir, ext = null) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (!ext || abs.endsWith(ext)) out.push(abs);
    }
  };
  walk(dir);
  return out;
}

test('前端 · 所有 JS 模块都能通过语法检查', async (t) => {
  const files = walkFiles(path.join(PUBLIC_DIR, 'js'), '.js');
  assert.ok(files.length >= 10, `前端模块数量偏少（只有 ${files.length} 个），可能有文件缺失`);

  for (const file of files) {
    try {
      await execFileAsync(process.execPath, ['--check', file], { timeout: 15000 });
    } catch (err) {
      assert.fail(`${path.relative(PROJECT_ROOT, file)} 语法检查未通过：\n${err.stderr || err.message}`);
    }
  }
});

test('前端 · index.html 引用的资源都存在', async (t) => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

  // 引用的静态资源
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)]
    .map((m) => m[1])
    .filter((href) => !href.startsWith('/api') && !href.startsWith('data:'));
  assert.ok(refs.length >= 2, 'index.html 至少应引用样式表与入口脚本');

  for (const ref of refs) {
    // 两套资源通道（与 server/http.js 的路由一致）：
    //   /img/*  → 项目自带资源（logo、背景图），根目录是 img/
    //   其余    → 前端静态文件，根目录是 public/
    const root = ref.startsWith('/img/') ? PROJECT_ROOT : PUBLIC_DIR;
    const abs = path.join(root, ref.replace(/^\//, ''));
    assert.ok(fs.existsSync(abs), `index.html 引用了不存在的资源：${ref}（解析为 ${abs}）`);
  }

  // 关键元素与属性
  assert.ok(html.includes('data-theme='), '应预设主题属性');
  assert.ok(html.includes('id="nav"'), '应有导航容器');
  assert.ok(html.includes('id="view"'), '应有页面容器');
  assert.ok(html.includes('id="modal-root"'), '应有弹窗容器');
  assert.ok(html.includes('id="toast-root"'), '应有轻提示容器');
  assert.ok(html.includes('茜色箱'), '应显示应用名');
});

test('前端 · 五个页面模块都存在且导出正确的函数', async (t) => {
  const expected = {
    'pages/home.js': 'pageHome',
    'pages/posts.js': 'pagePosts',
    'pages/plans.js': 'pagePlans',
    'pages/albums.js': 'pageAlbums',
    'pages/settings.js': 'pageSettings',
  };
  for (const [rel, fn] of Object.entries(expected)) {
    const abs = path.join(PUBLIC_DIR, 'js', rel);
    assert.ok(fs.existsSync(abs), `缺少页面模块：${rel}`);
    const source = fs.readFileSync(abs, 'utf8');
    assert.ok(
      source.includes(`export async function ${fn}`) || source.includes(`export function ${fn}`),
      `${rel} 应导出 ${fn}`,
    );
  }
});

test('前端 · 每个可选主题都有对应的样式变量', async (t) => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'app.css'), 'utf8');

  // 与后端 THEMES 保持一致
  const { THEMES } = await import('../server/routes/settings.js');
  for (const theme of THEMES) {
    assert.ok(
      css.includes(`html[data-theme="${theme}"]`),
      `样式里缺少主题 ${theme} 的定义`,
    );
  }
  assert.ok(css.includes('html[data-mode="dark"]'), '应支持深色模式');
  assert.ok(css.includes('--primary:'), '应定义主色调变量');
});

test('前端 · 静态资源能正确访问，MIME 类型正确', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const page = await srv.get('/');
  assert.equal(page.status, 200);
  assert.ok(String(page.headers.get('content-type')).includes('text/html'));

  const css = await srv.get('/css/app.css');
  assert.equal(css.status, 200);
  assert.ok(String(css.headers.get('content-type')).includes('text/css'));

  const js = await srv.get('/js/main.js');
  assert.equal(js.status, 200);
  assert.ok(String(js.headers.get('content-type')).includes('javascript'));

  // 深层路由回退到 index.html（hash 路由刷新时不会 404）
  const deep = await srv.get('/some/deep/route');
  assert.equal(deep.status, 200);
  assert.ok(String(deep.body).includes('茜色箱'));
});

test('前端 · 页面用到的接口全部存在', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  // 把前端 api.js 里声明的接口逐个验证一遍，避免"界面调了不存在的接口"
  const endpoints = [
    ['GET', '/api/health'],
    ['GET', '/api/home'],
    ['GET', '/api/posts'],
    ['GET', '/api/posts/dates'],
    ['GET', '/api/posts/summary'],
    ['GET', '/api/plans'],
    ['GET', '/api/plans/reminder'],
    ['GET', '/api/albums'],
    ['GET', '/api/albums/recent'],
    ['GET', '/api/albums/summary'],
    ['GET', '/api/settings'],
    ['GET', '/api/backups'],
  ];

  for (const [method, url] of endpoints) {
    const res = await srv.get(url);
    assert.notEqual(res.status, 404, `${method} ${url} 不存在（前端会调用它）`);
    assert.equal(res.status, 200, `${method} ${url} 返回了 ${res.status}`);
  }
});

test('导出 · 产出合法的 ZIP，且包含数据库与分类文件', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  // 先造点数据，确保导出有内容
  await srv.postForm(
    '/api/posts',
    { title: '导出测试', content: '这段内容应该出现在导出包里', postDate: '2026-09-23' },
    [{ name: 'a.png', buffer: makePng(4, 4) }],
  );
  const album = ok(await srv.post('/api/albums', { name: '导出相册' }));
  await srv.postForm(`/api/albums/${album.id}/photos`, {}, [
    { name: 'leaf.png', buffer: makePng(4, 4) },
  ]);
  ok(
    await srv.post('/api/plans', {
      name: '导出计划',
      mode: 'check',
      cycleUnit: 'week',
      startDate: '2026-09-23',
    }),
  );

  const res = await fetch(`${srv.base}/api/export`);
  assert.equal(res.status, 200);
  assert.ok(
    String(res.headers.get('content-type')).includes('zip'),
    '应返回 ZIP 类型',
  );

  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 100, '导出的 ZIP 不应为空');
  assert.equal(buf.readUInt32LE(0), 0x04034b50, '应以 ZIP 本地文件头开头');

  // 结束记录
  const eocdOffset = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocdOffset), 0x06054b50, '应有 ZIP 结束记录');
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  assert.ok(entryCount >= 4, `ZIP 内条目过少（${entryCount}）`);

  // 中央目录里的文件名是明文，直接查找关键条目
  const asText = buf.toString('utf8');
  for (const expected of [
    'duskbox.db',
    '发布/2026/2026-09-23 导出测试.md',
    '相册/导出相册/leaf.png',
    '计划/导出计划.md',
  ]) {
    assert.ok(asText.includes(expected), `导出包中应包含：${expected}`);
  }

  // 下载响应头应带文件名
  assert.ok(
    String(res.headers.get('content-disposition')).includes('attachment'),
    '应作为附件下载',
  );
});

test('导出 · 解压校验：内容与 CRC 一致', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  await srv.post('/api/posts', {
    title: '校验用文章',
    content: 'CRC 校验内容',
    postDate: '2026-09-23',
  });

  const res = await fetch(`${srv.base}/api/export`);
  const buf = Buffer.from(await res.arrayBuffer());

  // 手工解析第一个条目，校验其 CRC 与内容
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const compressedSize = buf.readUInt32LE(18);
  const expectedCrc = buf.readUInt32LE(14);
  const method = buf.readUInt16LE(8);
  const name = buf.subarray(30, 30 + nameLen).toString('utf8');
  const dataStart = 30 + nameLen + extraLen;
  const body = buf.subarray(dataStart, dataStart + compressedSize);

  assert.ok(name.length > 0, '第一个条目应有文件名');
  assert.equal(method, 8, '应使用 deflate 压缩');

  const zlib = await import('node:zlib');
  const raw = zlib.inflateRawSync(body);
  assert.equal(crc32(raw), expectedCrc, 'CRC 应校验通过（说明文件内容完整无误）');
});
