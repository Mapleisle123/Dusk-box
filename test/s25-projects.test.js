/**
 * S25 「项目」模块测试。
 *
 * 「项目」装的是一次性的、有始有终的事（做某件事、整理某批东西），
 * 与「计划」那套重复打卡互不相干。这一组盯四件事：
 *   1. 数据在库里也在磁盘上——按项目名落成 .md，成果图落在 项目/media/；
 *   2. 百分比进度是 0~100 的整数，乱填一律拒绝；
 *   3. 改名 / 删除不留残影（旧文件、成果图都要跟着走）；
 *   4. 首页那块只是项目模块的投影，数据必须是同一份。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer, ok, makePng } from './helpers.js';
import { PROJECT_ROOT } from '../server/config.js';

/** 建一个项目（默认参数够用，个别字段用 overrides 覆盖） */
function newProject(overrides = {}) {
  return {
    name: '整理旧照片',
    status: 'active',
    progress: 30,
    startDate: '2026-09-01',
    result: '2019~2022 年已按年份归档',
    ...overrides,
  };
}

test('S25 · 新建项目：接口成功，磁盘上出现同名 .md 且内容可读', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = ok(await srv.post('/api/projects', newProject()));
  assert.equal(res.project.name, '整理旧照片');
  assert.equal(res.project.progress, 30);
  assert.equal(res.project.statusLabel, '进行中');
  assert.equal(res.filePath, '项目/整理旧照片.md');

  const file = srv.readDataFile('项目/整理旧照片.md');
  assert.match(file, /# 整理旧照片/);
  assert.match(file, /- 状态：进行中/);
  assert.match(file, /- 进度：30%/);
  assert.match(file, /- 开始日期：2026-09-01/);
  assert.match(file, /2019~2022 年已按年份归档/);
});

test('S25 · 参数校验：名字、进度、状态、日期都不许乱来', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const noName = await srv.post('/api/projects', newProject({ name: '   ' }));
  assert.equal(noName.status, 400, '空名字要拒绝');

  const badProgress = await srv.post('/api/projects', newProject({ progress: 130 }));
  assert.equal(badProgress.status, 400, '进度超过 100 要拒绝');

  const floatProgress = await srv.post('/api/projects', newProject({ progress: 33.5 }));
  assert.equal(floatProgress.status, 400, '进度必须是整数');

  const badStatus = await srv.post('/api/projects', newProject({ status: 'doing' }));
  assert.equal(badStatus.status, 400, '状态只能是约定里的那三个');

  const badDate = await srv.post('/api/projects', newProject({ startDate: '2026/09/01' }));
  assert.equal(badDate.status, 400, '日期格式要统一成 YYYY-MM-DD');
});

test('S25 · 改进度与结果：库里、文件里、首页三处同步', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const created = ok(await srv.post('/api/projects', newProject()));
  const id = created.project.id;

  const updated = ok(await srv.put(`/api/projects/${id}`, { progress: 75, result: '完成到 2024 年' }));
  assert.equal(updated.project.progress, 75);

  const file = srv.readDataFile('项目/整理旧照片.md');
  assert.match(file, /- 进度：75%/);
  assert.match(file, /完成到 2024 年/);

  const home = ok(await srv.get('/api/home'));
  const row = home.projects.items.find((p) => p.id === id);
  assert.ok(row, '首页应能读到这个项目');
  assert.equal(row.progress, 75, '首页显示的进度必须就是项目页那个值');
});

test('S25 · 成果图：落在 项目/media 下，文件里带上图片链接', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const created = ok(await srv.post('/api/projects', newProject({ result: '成果如下' })));
  const id = created.project.id;

  const added = await srv.postForm(`/api/projects/${id}`, {}, [
    { name: 'shot.png', buffer: makePng(6, 6) },
  ], 'PUT');
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.project.media.length, 1);

  const relPath = added.body.project.media[0].filePath;
  assert.match(relPath, /^项目\/media\//, '成果图应落在 项目/media/ 下');
  assert.ok(srv.existsData(relPath), '文件要真的写出来');

  const file = srv.readDataFile('项目/整理旧照片.md');
  assert.match(file, /成果图/);
  assert.match(file, /!\[shot\.png\]/, '文件里应带上这张图');

  // 非图片文件一律拒绝
  const bad = await srv.postForm(`/api/projects/${id}`, {}, [
    { name: 'note.txt', buffer: Buffer.from('hello') },
  ], 'PUT');
  assert.equal(bad.status, 400, '只收图片');
});

test('S25 · 删除一张成果图：记录、文件、项目文件三处都跟着变', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const created = ok(await srv.post('/api/projects', newProject()));
  const id = created.project.id;
  const added = await srv.postForm(`/api/projects/${id}`, {}, [
    { name: 'a.png', buffer: makePng(4, 4) },
  ], 'PUT');
  const media = added.body.project.media[0];

  const removed = ok(await srv.del(`/api/projects/${id}/media/${media.id}`));
  assert.equal(removed.project.media.length, 0);
  assert.equal(srv.existsData(media.filePath), false, '磁盘上的图要一起删掉');
  assert.doesNotMatch(srv.readDataFile('项目/整理旧照片.md'), /a\.png/, '文件里不该还留着它');
});

test('S25 · 改名：新文件出现，旧文件不残留', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const created = ok(await srv.post('/api/projects', newProject()));
  const id = created.project.id;

  const renamed = ok(await srv.put(`/api/projects/${id}`, { name: '整理老照片' }));
  assert.equal(renamed.filePath, '项目/整理老照片.md');
  assert.equal(srv.existsData('项目/整理旧照片.md'), false, '旧文件必须被清掉');
  assert.ok(srv.existsData('项目/整理老照片.md'));
});

test('S25 · 删除项目：记录、项目文件、成果图一起清掉', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const created = ok(await srv.post('/api/projects', newProject()));
  const id = created.project.id;
  const added = await srv.postForm(`/api/projects/${id}`, {}, [
    { name: 'a.png', buffer: makePng(4, 4) },
  ], 'PUT');
  const mediaPath = added.body.project.media[0].filePath;

  ok(await srv.del(`/api/projects/${id}`));
  assert.equal(srv.existsData('项目/整理旧照片.md'), false);
  assert.equal(srv.existsData(mediaPath), false);
  const list = ok(await srv.get('/api/projects'));
  assert.equal(list.length, 0);
});

test('S25 · 列表顺序：进行中 → 搁置 → 已完成', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.post('/api/projects', newProject({ name: '已完成的事', status: 'done' })));
  ok(await srv.post('/api/projects', newProject({ name: '搁置的事', status: 'paused' })));
  ok(await srv.post('/api/projects', newProject({ name: '在推的事', status: 'active' })));

  const list = ok(await srv.get('/api/projects'));
  assert.deepEqual(
    list.map((p) => p.status),
    ['active', 'paused', 'done'],
    '手上在推的应该排在最前面',
  );
});

test('S25 · 首页区块：只列进行中的，最多 3 条', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  for (let i = 1; i <= 4; i += 1) {
    ok(await srv.post('/api/projects', newProject({ name: `进行中 ${i}`, status: 'active' })));
  }
  ok(await srv.post('/api/projects', newProject({ name: '搁置的', status: 'paused' })));
  ok(await srv.post('/api/projects', newProject({ name: '完成的', status: 'done' })));

  const home = ok(await srv.get('/api/home'));
  assert.equal(home.projects.activeCount, 4, '进行中的总数要如实报告');
  assert.equal(home.projects.items.length, 3, '首页区块最多显示 3 条（按排版定的）');
  assert.ok(
    home.projects.items.every((p) => p.status === 'active'),
    '首页只显示进行中的项目',
  );
});

test('S25 · 标记完成之后，首页不再显示它', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const created = ok(await srv.post('/api/projects', newProject()));
  const id = created.project.id;
  assert.equal(ok(await srv.get('/api/home')).projects.items.length, 1);

  ok(await srv.put(`/api/projects/${id}`, { status: 'done', progress: 100 }));
  assert.equal(ok(await srv.get('/api/home')).projects.items.length, 0);

  const list = ok(await srv.get('/api/projects'));
  assert.equal(list[0].status, 'done', '项目本身还在，只是不占首页那一块了');
});

test('S25 · 重启服务后项目与文件都还在', async (t) => {
  // 自己建数据目录并交给测试服务器：这样 close() 不会把它删掉，
  // 第二个实例才能对着同一份数据重新打开
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-projects-restart-'));

  const srv = await startTestServer({ dataRoot });
  const created = ok(await srv.post('/api/projects', newProject()));
  const id = created.project.id;
  await srv.close();

  const srv2 = await startTestServer({ dataRoot });
  // 收尾顺序不能颠倒：先把实例关掉再删目录，
  // 数据库句柄还开着的时候删目录会 EPERM（Windows 上文件被占用就是删不掉）
  t.after(async () => {
    await srv2.close();
    for (let i = 0; i < 20; i += 1) {
      try {
        fs.rmSync(dataRoot, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });

  const list = ok(await srv2.get('/api/projects'));
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].progress, 30);
  assert.ok(srv2.existsData('项目/整理旧照片.md'), '文件也还在');
});

test('S25 · 项目目录纳入备份与导出（否则恢复后项目文件会凭空消失）', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  ok(await srv.post('/api/projects', newProject()));

  const backup = ok(await srv.post('/api/backups', { reason: 'manual' }));
  const name = backup.backup.name ?? backup.backup.dirName ?? backup.backup.stamp;
  const dir = `备份/${name}/项目`;
  assert.ok(fs.existsSync(path.join(srv.dataRoot, dir)), `备份里应包含 ${dir}`);

  // 三处"分类目录清单"必须都带上项目：少一处就会出现"备份有、导出没有"这种怪事
  for (const file of ['server/backup.js', 'server/routes/settings.js', 'server/storage.js']) {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
    assert.match(source, /项目/, `${file} 的分类目录清单里应包含「项目」`);
  }
});

test('S25 · 首页接口在没有任何项目时也不报错', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const home = ok(await srv.get('/api/home'));
  assert.equal(home.projects.total, 0);
  assert.deepEqual(home.projects.items, []);
});
