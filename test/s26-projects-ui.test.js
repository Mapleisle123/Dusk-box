/**
 * S26 「项目」前端测试（源码扫描 + 结构断言）。
 *
 * 服务端那一套在 S25 里已经验过；这一组盯的是"页面上真的有这些东西"：
 * 导航项、页面模块、首页最下面那块、以及按钮要用到的接口都存在。
 * 这类护栏不跑浏览器，但能挡住"接口写错名字、模块忘了注册、首页那块被挪走"
 * 这种一眼看不出来的回归。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../server/config.js';

const read = (rel) => fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');

test('S26 · 左侧导航里有「项目」，而且排在计划之后', () => {
  const html = read('public/index.html');
  assert.match(html, /href="#\/projects"/, '导航里应有指向项目页的链接');
  assert.match(html, /data-route="projects"/, '导航项应带上路由标记（高亮靠它）');
  assert.match(html, /<span>项目<\/span>/, '导航文字应是「项目」');

  const planAt = html.indexOf('data-route="plans"');
  const projectAt = html.indexOf('data-route="projects"');
  assert.ok(planAt > 0 && projectAt > planAt, '项目应排在计划后面（同一组里）');
});

test('S26 · 项目页模块被注册进路由', () => {
  const main = read('public/js/main.js');
  assert.match(main, /import \{ pageProjects \} from '\.\/pages\/projects\.js'/, '应引入项目页');
  assert.match(main, /projects: pageProjects/, '应把项目页挂进 PAGES');
  assert.ok(fs.existsSync(path.join(PROJECT_ROOT, 'public/js/pages/projects.js')));
});

test('S26 · 首页最下面有项目区块，且排在模块摘要之后', () => {
  const home = read('public/js/pages/home.js');
  assert.match(home, /home\.projects/, '首页应使用项目模块的数据');
  assert.match(home, /home-project/, '首页应有项目行');
  assert.match(home, /data-nav="projects"/, '点项目行应能进项目页');

  const summaryAt = home.indexOf('模块摘要');
  const projectAt = home.indexOf('home-projects');
  assert.ok(summaryAt > 0 && projectAt > summaryAt, '项目区块应在首页最下面（摘要之后）');
});

test('S26 · 项目页有新建 / 编辑 / 删除 / 改进度这几件事', () => {
  const page = read('public/js/pages/projects.js');
  for (const [pattern, label] of [
    [/data-project-new/, '新建项目'],
    [/data-project-edit/, '编辑项目'],
    [/data-project-del/, '删除项目'],
    [/data-project-range/, '拖动改进度'],
    [/data-project-done/, '标记完成'],
    [/confirmDialog/, '删除前二次确认'],
    [/progress-fill/, '进度条'],
  ]) {
    assert.match(page, pattern, `项目页应有：${label}`);
  }
});

test('S26 · 页面用到的项目接口都在 api.js 里定义好了', () => {
  const api = read('public/js/api.js');
  const page = read('public/js/pages/projects.js');

  const used = new Set([...page.matchAll(/\bapi\.([a-zA-Z0-9_]+)\s*\(/g)].map((m) => m[1]));
  assert.ok(used.size >= 5, `项目页应调用若干接口，实际只找到 ${used.size} 个`);

  for (const name of used) {
    assert.match(
      api,
      new RegExp(`\\b${name}\\s*:`),
      `api.js 里缺少项目页用到的接口：${name}`,
    );
  }

  // 首页那块也读同一个来源
  const homeApi = read('public/js/pages/home.js');
  assert.match(homeApi, /api\.home\(/, '首页仍走首页聚合接口（项目数据由它一起带回）');
});

test('S26 · 项目页的样式齐备（卡片 / 进度 / 首页那一行）', () => {
  const css = read('public/css/app.css');
  for (const cls of ['.project-list', '.project-card', '.project-thumb', '.home-project']) {
    assert.ok(css.includes(cls), `样式里应有 ${cls}`);
  }
  // 进度条复用现有组件，避免又造一套
  assert.ok(css.includes('.progress-fill'), '进度条应复用现有样式');
});

test('S26 · 项目状态与界面文案一致（进行中 / 搁置 / 已完成）', () => {
  const page = read('public/js/pages/projects.js');
  const server = read('server/services/projects.js');
  for (const label of ['进行中', '搁置', '已完成']) {
    assert.ok(page.includes(label), `项目页应有状态「${label}」`);
    assert.ok(server.includes(label), `服务端也应有状态「${label}」`);
  }
  for (const id of ['active', 'paused', 'done']) {
    assert.ok(
      page.includes(`'${id}'`) && server.includes(`'${id}'`),
      `状态枚举 ${id} 前后端要一致`,
    );
  }
});

test('S26 · 弹窗回调只能用 openModal 真正给出的字段（用错会让按钮全部失灵）', () => {
  // openModal 的 onMount 收到的是 { body, foot, close }——**没有 root**。
  // 写成 root 的话，回调一开始就抛异常，取消与保存两个按钮都不会绑上事件，
  // 表现就是"点创建没反应、点取消也没反应"（项目页当初就踩了这个坑）。
  const pages = ['projects.js', 'plans.js', 'albums.js', 'settings.js', 'posts.js', 'home.js'];
  for (const name of pages) {
    const src = read(`public/js/pages/${name}`);
    for (const m of src.matchAll(/onMount:\s*\(\s*\{([^}]*)\}/g)) {
      const fields = m[1].split(',').map((s) => s.trim().split(':')[0].trim());
      assert.ok(
        !fields.includes('root') && !fields.includes('modalRoot'),
        `${name} 的 onMount 不该用 root（openModal 给的是 body / foot / close）`,
      );
    }
  }
});
