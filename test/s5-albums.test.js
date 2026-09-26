/**
 * S5 相册模块测试。
 *
 * 覆盖：相册集增删改查、批量上传、封面管理、重命名联动、
 * 以及"一个相册集 = 磁盘上一个文件夹"的落盘约定。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, ok, makePng } from './helpers.js';

test('S5 · 新建相册集：接口成功且磁盘出现同名文件夹', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const album = ok(await srv.post('/api/albums', { name: '秋天' }));
  assert.equal(album.name, '秋天');
  assert.equal(album.folder, '秋天');
  assert.equal(album.photoCount, 0);

  assert.ok(srv.existsData('相册/秋天'), '磁盘上应出现相册文件夹');
  assert.ok(srv.existsData('相册/秋天/_album.json'), '应生成元信息文件');
});

test('S5 · 相册集名称校验与去重', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  assert.equal((await srv.post('/api/albums', { name: '   ' })).status, 400);

  const a = ok(await srv.post('/api/albums', { name: '旅行' }));
  const b = ok(await srv.post('/api/albums', { name: '旅行' }));
  assert.equal(a.folder, '旅行');
  assert.equal(b.folder, '旅行 (2)', '同名相册集不应互相覆盖');
});

test('S5 · 上传图片：落盘、登记、首图自动成为封面', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const album = ok(await srv.post('/api/albums', { name: '秋天' }));
  const res = await srv.postForm(`/api/albums/${album.id}/photos`, {}, [
    { name: '落叶.png', buffer: makePng(6, 6, [200, 120, 40]) },
    { name: '夕阳.jpg', buffer: makePng(6, 6, [230, 90, 60]) },
  ]);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const updated = res.body;
  assert.equal(updated.photoCount, 2);
  assert.equal(updated.coverPath, '相册/秋天/落叶.png', '首图应自动成为封面');

  assert.ok(srv.existsData('相册/秋天/落叶.png'));
  assert.ok(srv.existsData('相册/秋天/夕阳.jpg'));

  // 文件接口能读到
  const img = await srv.get('/files/相册/秋天/落叶.png');
  assert.equal(img.status, 200);
  assert.ok(String(img.headers.get('content-type')).includes('image/png'));
});

test('S5 · 元信息文件内容随图片变化更新', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const album = ok(await srv.post('/api/albums', { name: '画集' }));
  await srv.postForm(`/api/albums/${album.id}/photos`, {}, [
    { name: 'a.png', buffer: makePng(4, 4) },
    { name: 'b.png', buffer: makePng(4, 4) },
  ]);

  const meta = JSON.parse(srv.readDataFile('相册/画集/_album.json'));
  assert.equal(meta.name, '画集');
  assert.equal(meta.photoCount, 2);
  assert.deepEqual(
    meta.photos.map((p) => p.name),
    ['a.png', 'b.png'],
  );
});

test('S5 · 拒绝非图片文件', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const album = ok(await srv.post('/api/albums', { name: '测试' }));
  const res = await srv.postForm(`/api/albums/${album.id}/photos`, {}, [
    { name: 'movie.mp4', buffer: Buffer.from('not an image') },
  ]);
  assert.equal(res.status, 400);
  assert.ok(String(res.body.error).includes('只支持图片'));
});

test('S5 · 上传到不存在的相册集返回 404', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = await srv.postForm('/api/albums/9999/photos', {}, [
    { name: 'a.png', buffer: makePng(3, 3) },
  ]);
  assert.equal(res.status, 404);
});

test('S5 · 重命名相册集：文件夹连带搬迁，图片路径同步更新', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const album = ok(await srv.post('/api/albums', { name: '旧名字' }));
  await srv.postForm(`/api/albums/${album.id}/photos`, {}, [
    { name: 'a.png', buffer: makePng(4, 4) },
  ]);

  const renamed = ok(await srv.put(`/api/albums/${album.id}`, { name: '新名字' }));
  assert.equal(renamed.name, '新名字');
  assert.equal(renamed.folder, '新名字');

  assert.ok(srv.existsData('相册/新名字/a.png'), '图片应随文件夹搬迁');
  assert.equal(srv.existsData('相册/旧名字'), false, '旧文件夹应已不存在');

  // 关键：数据库里的图片路径也必须更新，否则接口读不到
  assert.equal(renamed.photos[0].filePath, '相册/新名字/a.png');
  assert.equal(renamed.coverPath, '相册/新名字/a.png');
  const img = await srv.get('/files/相册/新名字/a.png');
  assert.equal(img.status, 200, '重命名后图片仍应可访问');
});

test('S5 · 删除单张图片：文件删除，封面自动顶替', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const album = ok(await srv.post('/api/albums', { name: '测试' }));
  const withPhotos = (
    await srv.postForm(`/api/albums/${album.id}/photos`, {}, [
      { name: 'a.png', buffer: makePng(4, 4) },
      { name: 'b.png', buffer: makePng(4, 4) },
    ])
  ).body;

  assert.equal(withPhotos.coverPath, '相册/测试/a.png');

  // 删掉封面那张
  const after = ok(
    await srv.del(`/api/albums/${album.id}/photos/${withPhotos.photos[0].id}`),
  );
  assert.equal(after.photoCount, 1);
  assert.equal(srv.existsData('相册/测试/a.png'), false, '文件应被删除');
  assert.equal(after.coverPath, '相册/测试/b.png', '封面应自动换到下一张');
});

test('S5 · 可手动指定封面', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const album = ok(await srv.post('/api/albums', { name: '测试' }));
  const withPhotos = (
    await srv.postForm(`/api/albums/${album.id}/photos`, {}, [
      { name: 'a.png', buffer: makePng(4, 4) },
      { name: 'b.png', buffer: makePng(4, 4) },
    ])
  ).body;

  const second = withPhotos.photos[1];
  const updated = ok(
    await srv.put(`/api/albums/${album.id}/cover`, { photoId: second.id }),
  );
  assert.equal(updated.coverPath, second.filePath);
});

test('S5 · 删除相册集：记录与磁盘文件夹一并清除', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const album = ok(await srv.post('/api/albums', { name: '待删' }));
  await srv.postForm(`/api/albums/${album.id}/photos`, {}, [
    { name: 'a.png', buffer: makePng(4, 4) },
  ]);
  assert.ok(srv.existsData('相册/待删'));

  ok(await srv.del(`/api/albums/${album.id}`));

  assert.equal((await srv.get(`/api/albums/${album.id}`)).status, 404);
  assert.equal(srv.existsData('相册/待删'), false, '文件夹应被删除');
  assert.equal(ok(await srv.get('/api/albums')).albums.length, 0);
});

test('S5 · 相册集列表按新建顺序倒序展示', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  for (const name of ['第一', '第二', '第三']) {
    ok(await srv.post('/api/albums', { name }));
  }
  const { albums } = ok(await srv.get('/api/albums'));
  assert.deepEqual(
    albums.map((a) => a.name),
    ['第三', '第二', '第一'],
  );
});

test('S5 · 最近收藏返回最新的图片（供首页使用）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const a = ok(await srv.post('/api/albums', { name: '甲' }));
  const b = ok(await srv.post('/api/albums', { name: '乙' }));
  await srv.postForm(`/api/albums/${a.id}/photos`, {}, [{ name: '1.png', buffer: makePng(3, 3) }]);
  await srv.postForm(`/api/albums/${b.id}/photos`, {}, [{ name: '2.png', buffer: makePng(3, 3) }]);

  const { photos } = ok(await srv.get('/api/albums/recent?limit=8'));
  assert.equal(photos.length, 2);
  assert.equal(photos[0].albumName, '乙', '最近加入的应排在最前');
  assert.equal(photos[0].originalName, '2.png');
});

test('S5 · 相册模块摘要数据正确', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const a = ok(await srv.post('/api/albums', { name: '秋天' }));
  await srv.postForm(`/api/albums/${a.id}/photos`, {}, [
    { name: '1.png', buffer: makePng(3, 3) },
    { name: '2.png', buffer: makePng(3, 3) },
    { name: '3.png', buffer: makePng(3, 3) },
  ]);
  ok(await srv.post('/api/albums', { name: '旅行' }));

  const summary = ok(await srv.get('/api/albums/summary'));
  assert.equal(summary.albumCount, 2);
  assert.equal(summary.photoCount, 3);
  assert.equal(summary.latest.name, '旅行');
});

test('S5 · 相册数据在重启后完整保留', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'qsx-album-restart-'));

  const srv = await startTestServer({ dataRoot });
  const album = ok(await srv.post('/api/albums', { name: '持久化相册' }));
  await srv.postForm(`/api/albums/${album.id}/photos`, {}, [
    { name: 'x.png', buffer: makePng(5, 5) },
  ]);
  await srv.close();

  const srv2 = await startTestServer({ dataRoot });
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

  const { albums } = ok(await srv2.get('/api/albums'));
  assert.equal(albums.length, 1);
  assert.equal(albums[0].name, '持久化相册');
  assert.equal(albums[0].photoCount, 1);
  assert.ok(srv2.existsData('相册/持久化相册/x.png'));

  const img = await srv2.get('/files/相册/持久化相册/x.png');
  assert.equal(img.status, 200, '重启后图片仍应可访问');
});
