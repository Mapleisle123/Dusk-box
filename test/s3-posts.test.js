/**
 * S3 发布模块测试。
 *
 * 覆盖：文章增删改查、图片上传、时间线排序、搜索与筛选、
 * 以及最关键的"写入数据库的同时必须落到磁盘文件"。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, ok, makePng } from './helpers.js';

/** 发一篇纯文字文章 */
function textPost(overrides = {}) {
  return {
    title: '秋日散步',
    content: '今天去公园走了走，银杏开始黄了。',
    postDate: '2026-09-23',
    ...overrides,
  };
}

test('S3 · 发布纯文字文章：接口成功且磁盘出现 .md 文件', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = ok(await srv.post('/api/posts', textPost()));
  assert.equal(res.post.title, '秋日散步');
  assert.equal(res.post.postDate, '2026-09-23');
  assert.equal(res.post.mediaCount, 0);

  assert.equal(res.filePath, '发布/2026/2026-09-23 秋日散步.md');
  assert.ok(srv.existsData(res.filePath), '磁盘上应出现对应文件');

  const text = srv.readDataFile(res.filePath);
  assert.ok(text.includes('# 秋日散步'));
  assert.ok(text.includes('银杏开始黄了'));
});

test('S3 · 发布带图片的文章：图片落盘到 media 目录并被登记', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = await srv.postForm(
    '/api/posts',
    { title: '傍晚的天空', content: '随手拍了一张晚霞', postDate: '2026-09-21' },
    [
      { name: 'sky.png', buffer: makePng(5, 5, [230, 120, 80]) },
      { name: 'cloud.jpg', buffer: makePng(5, 5, [120, 160, 230]) },
    ],
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const post = res.body.post;
  assert.equal(post.mediaCount, 2);
  assert.equal(post.media[0].filePath, '发布/2026/media/2026-09-21-01.png');
  assert.equal(post.media[1].filePath, '发布/2026/media/2026-09-21-02.jpg');

  assert.ok(srv.existsData(post.media[0].filePath), '第一张图应落盘');
  assert.ok(srv.existsData(post.media[1].filePath), '第二张图应落盘');

  // .md 文件里应引用这两张图
  const md = srv.readDataFile(post.filePath);
  assert.ok(md.includes('2026-09-21-01.png'));
  assert.ok(md.includes('- 图片：2 张'));

  // 通过文件接口能读到图片
  const img = await srv.get(`/files/${post.media[0].filePath}`);
  assert.equal(img.status, 200);
  assert.ok(String(img.headers.get('content-type')).includes('image/png'));
});

test('S3 · 拒绝非图片文件上传', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = await srv.postForm(
    '/api/posts',
    { title: '不该成功', content: 'x', postDate: '2026-09-23' },
    [{ name: 'video.mp4', buffer: Buffer.from('fake video') }],
  );
  assert.equal(res.status, 400);
  assert.ok(String(res.body.error).includes('只支持图片'));
});

test('S3 · 标题与正文同时为空时拒绝发布', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = await srv.post('/api/posts', { title: '', content: '   ', postDate: '2026-09-23' });
  assert.equal(res.status, 400);
});

test('S3 · 时间线按日期倒序，且分页正确', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const dates = ['2026-09-15', '2026-09-23', '2026-09-18', '2026-09-21'];
  for (const d of dates) {
    ok(await srv.post('/api/posts', { title: `记录 ${d}`, content: '内容', postDate: d }));
  }

  const list = ok(await srv.get('/api/posts'));
  assert.equal(list.total, 4);
  assert.deepEqual(
    list.items.map((i) => i.postDate),
    ['2026-09-23', '2026-09-21', '2026-09-18', '2026-09-15'],
    '应按日期从新到旧',
  );

  const page = ok(await srv.get('/api/posts?limit=2&offset=1'));
  assert.equal(page.items.length, 2);
  assert.equal(page.total, 4);
  assert.equal(page.items[0].postDate, '2026-09-21');
});

test('S3 · 按关键词搜索标题与正文', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.post('/api/posts', { title: '读书笔记', content: '《人间草木》很好看', postDate: '2026-09-18' }));
  ok(await srv.post('/api/posts', { title: '散步', content: '银杏黄了', postDate: '2026-09-23' }));

  const byTitle = ok(await srv.get('/api/posts?q=读书'));
  assert.equal(byTitle.total, 1);
  assert.equal(byTitle.items[0].title, '读书笔记');

  const byContent = ok(await srv.get('/api/posts?q=银杏'));
  assert.equal(byContent.total, 1);
  assert.equal(byContent.items[0].title, '散步');

  const none = ok(await srv.get('/api/posts?q=不存在的词'));
  assert.equal(none.total, 0);
});

test('S3 · 按类型筛选：纯文字 / 含图片', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.post('/api/posts', { title: '纯文字', content: 'a', postDate: '2026-09-23' }));
  await srv.postForm(
    '/api/posts',
    { title: '有图', content: 'b', postDate: '2026-09-22' },
    [{ name: 'a.png', buffer: makePng(3, 3) }],
  );

  const textOnly = ok(await srv.get('/api/posts?type=text'));
  assert.equal(textOnly.total, 1);
  assert.equal(textOnly.items[0].title, '纯文字');

  const withImage = ok(await srv.get('/api/posts?type=image'));
  assert.equal(withImage.total, 1);
  assert.equal(withImage.items[0].title, '有图');
});

test('S3 · 按日期区间筛选', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  for (const d of ['2026-09-01', '2026-09-15', '2026-09-30']) {
    ok(await srv.post('/api/posts', { title: d, content: 'x', postDate: d }));
  }

  const range = ok(await srv.get('/api/posts?from=2026-09-10&to=2026-09-20'));
  assert.equal(range.total, 1);
  assert.equal(range.items[0].postDate, '2026-09-15');

  const bad = await srv.get('/api/posts?from=2026-13-99');
  assert.equal(bad.status, 400, '非法日期应被拒绝');
});

test('S3 · 可列出有内容的日期', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.post('/api/posts', { title: 'a', content: 'x', postDate: '2026-09-23' }));
  ok(await srv.post('/api/posts', { title: 'b', content: 'x', postDate: '2026-09-23' }));
  ok(await srv.post('/api/posts', { title: 'c', content: 'x', postDate: '2026-09-20' }));

  const { dates } = ok(await srv.get('/api/posts/dates'));
  assert.equal(dates.length, 2);
  assert.deepEqual(dates[0], { date: '2026-09-23', count: 2 });
  assert.deepEqual(dates[1], { date: '2026-09-20', count: 1 });
});

test('S3 · 编辑文章：内容更新、文件同步改名', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const created = ok(await srv.post('/api/posts', textPost())).post;
  const oldPath = created.filePath;

  const updated = ok(
    await srv.put(`/api/posts/${created.id}`, {
      title: '秋日散步（修订）',
      content: '补充：还看到了猫。',
    }),
  ).post;

  assert.equal(updated.title, '秋日散步（修订）');
  assert.equal(srv.existsData(oldPath), false, '旧文件应被清理');
  assert.ok(updated.filePath.includes('秋日散步（修订）'), `新文件应带新标题，实际：${updated.filePath}`);

  const md = srv.readDataFile(updated.filePath);
  assert.ok(md.includes('还看到了猫'));

  // 详情接口读到的也是新内容
  const detail = ok(await srv.get(`/api/posts/${created.id}`));
  assert.equal(detail.content, '补充：还看到了猫。');
});

test('S3 · 编辑时可移除指定图片，磁盘文件一并删除', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const created = (
    await srv.postForm(
      '/api/posts',
      { title: '两张图', content: 'x', postDate: '2026-09-23' },
      [
        { name: 'a.png', buffer: makePng(3, 3) },
        { name: 'b.png', buffer: makePng(3, 3) },
      ],
    )
  ).body.post;

  const keepId = created.media[0].id;
  const dropPath = created.media[1].filePath;

  const updated = (
    await srv.postForm(
      `/api/posts/${created.id}`,
      { title: '两张图', content: 'x', postDate: '2026-09-23', keepMediaIds: JSON.stringify([keepId]) },
      [],
      'PUT',
    )
  ).body.post;

  assert.equal(updated.mediaCount, 1);
  assert.equal(srv.existsData(dropPath), false, '被移除的图片文件应删除');
  assert.equal(srv.existsData(updated.media[0].filePath), true, '保留的图片仍应在');
});

test('S3 · 删除文章：记录、文件、图片全部清除', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const created = (
    await srv.postForm(
      '/api/posts',
      { title: '待删除', content: 'x', postDate: '2026-09-23' },
      [{ name: 'a.png', buffer: makePng(3, 3) }],
    )
  ).body.post;

  const mdPath = created.filePath;
  const imgPath = created.media[0].filePath;

  ok(await srv.del(`/api/posts/${created.id}`));

  assert.equal((await srv.get(`/api/posts/${created.id}`)).status, 404);
  assert.equal(srv.existsData(mdPath), false, '.md 应被删除');
  assert.equal(srv.existsData(imgPath), false, '图片应被删除');

  const list = ok(await srv.get('/api/posts'));
  assert.equal(list.total, 0);
});

test('S3 · 发布摘要数据正确', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  await srv.postForm(
    '/api/posts',
    { title: 'a', content: 'x', postDate: '2026-09-23' },
    [
      { name: '1.png', buffer: makePng(3, 3) },
      { name: '2.png', buffer: makePng(3, 3) },
    ],
  );
  ok(await srv.post('/api/posts', { title: 'b', content: 'y', postDate: '2026-09-23' }));

  const summary = ok(await srv.get('/api/posts/summary?date=2026-09-23'));
  assert.equal(summary.total, 2);
  assert.equal(summary.mediaCount, 2);
  assert.ok(summary.latest, '应有最近一篇');
});

test('S3 · 重启应用后文章与磁盘文件都还在', async (t) => {
  // 自己管理数据目录，避免第一个服务关闭时把它清理掉
  const { mkdtempSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'qsx-restart-'));

  const srv = await startTestServer({ dataRoot });
  const created = (
    await srv.postForm(
      '/api/posts',
      { title: '持久化验证', content: '重启也不能丢', postDate: '2026-09-23' },
      [{ name: 'p.png', buffer: makePng(4, 4) }],
    )
  ).body.post;
  const mdPath = created.filePath;
  await srv.close();

  const srv2 = await startTestServer({ dataRoot });
  // 清理必须在关闭数据库之后进行（Windows 上数据库被占用时无法删除）
  t.after(async () => {
    await srv2.close();
    for (let i = 0; i < 10; i += 1) {
      try {
        rmSync(dataRoot, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  });

  const list = ok(await srv2.get('/api/posts'));
  assert.equal(list.total, 1);
  assert.equal(list.items[0].title, '持久化验证');
  assert.equal(list.items[0].mediaCount, 1);
  assert.ok(srv2.existsData(mdPath), '磁盘文件在重启后仍存在');
});
