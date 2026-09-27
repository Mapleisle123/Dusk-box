/**
 * S19 命名护栏。
 *
 * 背景：项目原名「茜色箱」，数据库文件、启动脚本、快捷方式全都用了中文名。
 * 中文文件名在 Windows 上会牵出 .bat 的 GBK 编码坑（中文 bat 必须 GBK+CRLF+无 BOM，
 * 否则双击时 cmd 会在解析阶段把命令行拆断），也让命令行、日志、备份脚本里的路径难以处理。
 *
 * 2026-09-27 起统一为英文名 Dusk Box，约定是：
 *   - 数据库文件名、脚本文件名、代码常量 → 纯 ASCII
 *   - 界面上给用户看的名字 → 仍然保留中文「茜色箱」
 *
 * 所以本文件同时守住两个方向：ASCII 侧不许退回中文，中文侧不许被误改成英文。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../server/config.js';
import { DB_FILENAME, LEGACY_DB_FILENAME, APP_NAME } from '../server/constants.js';
import { SHORTCUT_NAME, LAUNCHER_NAME } from '../server/autostart.js';

/** 需要保持纯 ASCII 的目录（data/ 不在此列——分类目录名「发布/计划/相册」是产品的一部分） */
const CODE_DIRS = ['server', 'public', 'test', 'scripts', 'img'];

/** 纯 ASCII：只含可见的半角字符 */
const ASCII_ONLY = /^[\x20-\x7e]+$/;

/** 收集目录下的全部文件与子目录（绝对路径） */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    out.push(p);
    if (entry.isDirectory()) walk(p, out);
  }
  return out;
}

test('S19 · 源码与资源的文件名必须是纯 ASCII', () => {
  const offenders = [];

  for (const dir of CODE_DIRS) {
    for (const p of walk(path.join(PROJECT_ROOT, dir))) {
      if (!ASCII_ONLY.test(path.basename(p))) {
        offenders.push(path.relative(PROJECT_ROOT, p));
      }
    }
  }

  // 根目录的脚本与配置文件也算（只查文件，跳过 data/ 等目录）
  for (const entry of fs.readdirSync(PROJECT_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && !ASCII_ONLY.test(entry.name)) offenders.push(entry.name);
  }

  assert.deepEqual(
    offenders,
    [],
    `以下路径含非 ASCII 字符，应改为英文名：\n${offenders.join('\n')}`,
  );
});

test('S19 · 数据库文件名与启动脚本常量必须是纯 ASCII', () => {
  for (const [label, value] of [
    ['DB_FILENAME', DB_FILENAME],
    ['SHORTCUT_NAME', SHORTCUT_NAME],
    ['LAUNCHER_NAME', LAUNCHER_NAME],
  ]) {
    assert.ok(ASCII_ONLY.test(value), `${label} 应为纯 ASCII，当前是「${value}」`);
  }

  assert.equal(DB_FILENAME, 'duskbox.db', '数据库文件名应为 duskbox.db');
  assert.equal(APP_NAME, 'Dusk Box', '应用英文名应为 Dusk Box');
  assert.notEqual(DB_FILENAME, LEGACY_DB_FILENAME, '现役文件名不应再是旧的中文名');
});

test('S19 · 源码里不得再硬编码中文数据库文件名', () => {
  const hits = [];
  for (const dir of ['server', 'public']) {
    for (const p of walk(path.join(PROJECT_ROOT, dir))) {
      if (!p.endsWith('.js')) continue;
      if (fs.readFileSync(p, 'utf8').includes(LEGACY_DB_FILENAME)) {
        hits.push(path.relative(PROJECT_ROOT, p).split(path.sep).join('/'));
      }
    }
  }

  // 唯一允许出现的地方是 constants.js——那里把它当作"旧备份兼容"常量保留。
  // 其它任何地方再出现，都意味着有人把名字写死了，改动文件名时会漏改。
  assert.deepEqual(
    hits,
    ['server/constants.js'],
    `中文数据库文件名只允许定义在 server/constants.js，实际出现在：${hits.join(', ')}`,
  );
});

test('S19 · 界面仍然显示中文名「茜色箱」', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('<title>茜色箱</title>'), '页面标题应保持中文');
  assert.ok(html.includes('茜色箱'), '界面品牌名应保持中文，不要跟着英文名改掉');
});

test('S19 · 三个启动脚本齐备，旧的中文脚本已不存在', () => {
  const wanted = [LAUNCHER_NAME, 'DuskBox-autostart-on.bat', 'DuskBox-autostart-off.bat'];
  for (const name of wanted) {
    assert.ok(fs.existsSync(path.join(PROJECT_ROOT, name)), `应存在 ${name}`);
    assert.ok(ASCII_ONLY.test(name), `${name} 的文件名应为纯 ASCII`);
  }

  for (const old of ['茜色箱启动.bat', '安装开机自启.bat', '取消开机自启.bat']) {
    assert.equal(
      fs.existsSync(path.join(PROJECT_ROOT, old)),
      false,
      `旧脚本 ${old} 应已被替换删除`,
    );
  }
});
