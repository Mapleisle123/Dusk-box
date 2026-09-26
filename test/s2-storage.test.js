/**
 * S2 存储层测试。
 *
 * 验证"数据在磁盘上是看得见摸得着的真实文件"这一核心承诺：
 * 命名规则、目录结构、原子写入、重命名联动、目录穿越防护。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createStorage,
  sanitizeName,
  postFileBaseName,
  renderPostMarkdown,
  renderPlanMarkdown,
  isImageFilename,
  extOf,
} from '../server/storage.js';
import { makePng } from './helpers.js';

function tempStorage(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-store-'));
  const storage = createStorage(root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, storage };
}

test('S2 · 文件名净化去除 Windows 非法字符', () => {
  assert.equal(sanitizeName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.equal(sanitizeName('  前后有空格  '), '前后有空格');
  assert.equal(sanitizeName('结尾的点...'), '结尾的点');
  assert.equal(sanitizeName('', '兜底'), '兜底');
  assert.equal(sanitizeName('   ', '兜底'), '兜底');
  assert.equal(sanitizeName('nul'), 'nul_', 'Windows 保留名应被处理');
  assert.equal(sanitizeName('CON'), 'CON_');
  assert.ok(sanitizeName('很长'.repeat(100), 'x', 20).length <= 20);
});

test('S2 · 识别图片扩展名', () => {
  assert.equal(isImageFilename('a.JPG'), true);
  assert.equal(isImageFilename('a.jpeg'), true);
  assert.equal(isImageFilename('a.png'), true);
  assert.equal(isImageFilename('a.webp'), true);
  assert.equal(isImageFilename('a.mp4'), false, '第一版不支持视频');
  assert.equal(isImageFilename('a.txt'), false);
  assert.equal(extOf('a.PNG'), '.png');
  assert.equal(extOf('noext'), '');
});

test('S2 · 文章文件名规则：日期 + 标题', () => {
  assert.equal(postFileBaseName('2026-09-23', '秋日散步'), '2026-09-23 秋日散步');
  assert.equal(postFileBaseName('2026-09-23', ''), '2026-09-23');
  assert.equal(postFileBaseName('2026-09-23', '   '), '2026-09-23');
  assert.equal(postFileBaseName('2026-09-23', '标题/带非法:字符'), '2026-09-23 标题 带非法 字符');
});

test('S2 · 文章落盘为「发布/<年>/<日期> <标题>.md」，内容可读', async (t) => {
  const { root, storage } = tempStorage(t);

  const rel = storage.writePostFile(
    {
      title: '秋日散步',
      content: '今天去公园走了走，银杏开始黄了。',
      post_date: '2026-09-23',
      created_at: '2026-09-23 20:15:00',
      updated_at: '2026-09-23 20:15:00',
      file_path: null,
    },
    [],
  );

  assert.equal(rel, '发布/2026/2026-09-23 秋日散步.md', '路径应符合约定');

  const abs = path.join(root, '发布', '2026', '2026-09-23 秋日散步.md');
  assert.ok(fs.existsSync(abs), '文件应真实存在');

  const text = fs.readFileSync(abs, 'utf8');
  assert.ok(text.startsWith('# 秋日散步'), '文件名首行是标题');
  assert.ok(text.includes('2026-09-23'), '内容包含日期');
  assert.ok(text.includes('今天去公园走了走'), '内容包含正文');
});

test('S2 · 同一天同标题的两篇文章不会互相覆盖', async (t) => {
  const { storage } = tempStorage(t);
  const base = {
    content: 'x',
    post_date: '2026-09-23',
    created_at: '2026-09-23 10:00:00',
    updated_at: '2026-09-23 10:00:00',
    file_path: null,
  };
  const a = storage.writePostFile({ ...base, title: '同名' }, []);
  const b = storage.writePostFile({ ...base, title: '同名' }, []);
  assert.notEqual(a, b, '第二个文件应自动改名');
  assert.ok(storage.exists(a) && storage.exists(b));
  assert.ok(b.includes('(2)'), `应带序号，实际：${b}`);
});

test('S2 · 标题变更时旧文件被清理，不留残影', async (t) => {
  const { storage } = tempStorage(t);
  const first = storage.writePostFile(
    {
      title: '旧标题',
      content: 'a',
      post_date: '2026-09-23',
      created_at: 'x',
      updated_at: 'x',
      file_path: null,
    },
    [],
  );
  const second = storage.writePostFile(
    {
      title: '新标题',
      content: 'a',
      post_date: '2026-09-23',
      created_at: 'x',
      updated_at: 'x',
      file_path: first,
    },
    [],
  );
  assert.ok(second.includes('新标题'));
  assert.equal(storage.exists(first), false, '旧文件应被删除');
  assert.equal(storage.exists(second), true);
});

test('S2 · 图片按年月存入 media 目录，命名含日期与序号', async (t) => {
  const { root, storage } = tempStorage(t);

  const rel1 = storage.savePostMedia({
    buffer: makePng(4, 4),
    originalName: 'IMG_0001.png',
    postDate: '2026-09-23',
    seq: 1,
  });
  const rel2 = storage.savePostMedia({
    buffer: makePng(4, 4),
    originalName: 'photo.jpg',
    postDate: '2026-09-23',
    seq: 2,
  });
  const relOtherYear = storage.savePostMedia({
    buffer: makePng(4, 4),
    originalName: 'a.png',
    postDate: '2025-01-05',
    seq: 1,
  });

  assert.equal(rel1, '发布/2026/media/2026-09-23-01.png');
  assert.equal(rel2, '发布/2026/media/2026-09-23-02.jpg');
  assert.equal(relOtherYear, '发布/2025/media/2025-01-05-01.png', '不同年份应落在不同目录');

  assert.ok(fs.existsSync(path.join(root, ...rel1.split('/'))));
  assert.ok(fs.statSync(path.join(root, ...rel1.split('/'))).size > 0, '图片内容非空');
});

test('S2 · 写入是原子的，不残留临时文件', async (t) => {
  const { root, storage } = tempStorage(t);
  storage.writePostFile(
    {
      title: '原子性',
      content: 'y',
      post_date: '2026-09-23',
      created_at: 'x',
      updated_at: 'x',
      file_path: null,
    },
    [],
  );
  const yearDir = path.join(root, '发布', '2026');
  const leftovers = fs.readdirSync(yearDir).filter((f) => f.includes('.tmp'));
  assert.deepEqual(leftovers, [], '不应残留 .tmp 文件');
});

test('S2 · 计划落盘为「计划/<名称>.md」，含打卡历史', async (t) => {
  const { root, storage } = tempStorage(t);
  const rel = storage.writePlanFile(
    {
      id: 1,
      name: '每周跑3次',
      mode: 'quant',
      target_value: 3,
      unit: '次',
      cycle_unit: 'week',
      start_date: '2026-09-23',
      start_mode: 'same_day',
      archived: 0,
      file_path: null,
    },
    [
      { checkin_date: '2026-09-23', value: 1, done: 1 },
      { checkin_date: '2026-09-25', value: 1, done: 1 },
    ],
  );

  assert.equal(rel, '计划/每周跑3次.md');
  const text = fs.readFileSync(path.join(root, '计划', '每周跑3次.md'), 'utf8');
  assert.ok(text.includes('# 每周跑3次'));
  assert.ok(text.includes('量化式'));
  assert.ok(text.includes('| 2026-09-23 | 1 次 |'), '应包含打卡记录表格');
});

test('S2 · 计划文件包含确认式的完成标记', () => {
  const text = renderPlanMarkdown(
    {
      name: '每天背单词',
      mode: 'check',
      target_value: null,
      unit: null,
      cycle_unit: 'week',
      start_date: '2026-09-23',
      start_mode: 'next_day',
      archived: 0,
    },
    [
      { checkin_date: '2026-09-23', done: 1, value: null },
      { checkin_date: '2026-09-24', done: 0, value: null },
    ],
  );
  assert.ok(text.includes('确认式'));
  assert.ok(text.includes('创建次日'));
  assert.ok(text.includes('| 2026-09-23 | 已完成 |'));
  assert.ok(text.includes('| 2026-09-24 | 未完成 |'));
});

test('S2 · 相册集即文件夹，图片原样存放，元信息为 _album.json', async (t) => {
  const { root, storage } = tempStorage(t);

  const { folder } = storage.createAlbumFolder('秋天');
  assert.equal(folder, '秋天');
  assert.ok(fs.existsSync(path.join(root, '相册', '秋天')));

  const rel = storage.saveAlbumPhoto({
    buffer: makePng(6, 6),
    originalName: '落叶.png',
    folder,
  });
  assert.equal(rel, '相册/秋天/落叶.png');
  assert.ok(fs.existsSync(path.join(root, '相册', '秋天', '落叶.png')));

  storage.writeAlbumMeta(
    { name: '秋天', created_at: '2026-09-23 10:00:00', updated_at: '2026-09-23 10:00:00' },
    [{ original_name: '落叶.png', file_path: rel, created_at: '2026-09-23 10:00:00' }],
    folder,
  );

  const metaPath = path.join(root, '相册', '秋天', '_album.json');
  assert.ok(fs.existsSync(metaPath), '应生成 _album.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.equal(meta.name, '秋天');
  assert.equal(meta.photoCount, 1);
  assert.equal(meta.photos[0].name, '落叶.png');
});

test('S2 · 同名相册集自动加序号，不覆盖已有文件夹', async (t) => {
  const { storage } = tempStorage(t);
  const a = storage.createAlbumFolder('旅行');
  const b = storage.createAlbumFolder('旅行');
  assert.equal(a.folder, '旅行');
  assert.equal(b.folder, '旅行 (2)');
});

test('S2 · 重命名相册文件夹会连带搬运内部图片', async (t) => {
  const { root, storage } = tempStorage(t);
  const { folder } = storage.createAlbumFolder('旧名字');
  storage.saveAlbumPhoto({ buffer: makePng(3, 3), originalName: 'a.png', folder });

  const renamed = storage.renameAlbumFolder(folder, '新名字');
  assert.equal(renamed.folder, '新名字');
  assert.ok(fs.existsSync(path.join(root, '相册', '新名字', 'a.png')), '图片应随文件夹一起搬过去');
  assert.equal(fs.existsSync(path.join(root, '相册', '旧名字')), false, '旧文件夹应已不存在');
});

test('S2 · 删除相册文件夹会移除内部全部内容', async (t) => {
  const { root, storage } = tempStorage(t);
  const { folder } = storage.createAlbumFolder('待删');
  storage.saveAlbumPhoto({ buffer: makePng(3, 3), originalName: 'a.png', folder });
  assert.ok(fs.existsSync(path.join(root, '相册', '待删', 'a.png')));

  storage.deleteAlbumFolder(folder);
  assert.equal(fs.existsSync(path.join(root, '相册', '待删')), false);
});

test('S2 · URL 路径解析阻止目录穿越', async (t) => {
  const { storage } = tempStorage(t);
  assert.equal(storage.resolveUrlPath('../../etc/passwd'), null);
  assert.equal(storage.resolveUrlPath('..\\..\\windows\\system32'), null);
  const ok1 = storage.resolveUrlPath('发布/2026/media/x.png');
  assert.ok(ok1 && ok1.includes('media'), '合法路径应正常解析');
});

test('S2 · 删除文件不允许越出数据目录', async (t) => {
  const { storage } = tempStorage(t);
  assert.equal(storage.deleteFile('../../important.txt'), false);
  assert.equal(storage.deleteFile('不存在的文件.md'), false);
});

test('S2 · 文章 Markdown 渲染应包含附图链接', () => {
  const text = renderPostMarkdown(
    {
      title: '带图',
      content: '正文',
      post_date: '2026-09-23',
      created_at: 'x',
      updated_at: 'y',
    },
    [{ original_name: 'a.png', file_path: '发布/2026/media/2026-09-23-01.png' }],
  );
  assert.ok(text.includes('![a.png](发布/2026/media/2026-09-23-01.png)'));
  assert.ok(text.includes('- 图片：1 张'));
});
