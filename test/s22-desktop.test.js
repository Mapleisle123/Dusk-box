/**
 * S22 桌面启动器（桌面快捷方式）测试。
 *
 * 这一组盯的是"用户点了安装，桌面上真的出现一个能用的图标"：
 *   - 快捷方式必须放在**系统给的桌面目录**里（桌面可能被重定向到 OneDrive，
 *     自己拼 %USERPROFILE%\Desktop 会指向一个看不见的桌面）；
 *   - 它必须指向**无窗口启动器**，指向那个 .bat 又会弹出黑窗口；
 *   - 状态一律以"桌面上那个文件在不在"为准，不看数据库里的任何记录。
 *
 * 测试全程跑在临时目录里（QSX_DESKTOP_DIR），绝不往用户真实桌面写东西。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer, ok } from './helpers.js';
import { PROJECT_ROOT } from '../server/config.js';
import { LAUNCH_SCRIPT, START_SCRIPT } from '../server/constants.js';
import { launcherPath } from '../server/autostart.js';
import { getDesktopShortcut, refreshDesktopShortcutTarget } from '../server/desktop.js';
import { createShortcut, readShortcutTarget } from '../server/shortcuts.js';

/** 本文件内所有"桌面"都指向这个临时目录 */
const DESKTOP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-desktop-'));
process.env.QSX_DESKTOP_DIR = DESKTOP_DIR;

const LINK = path.join(DESKTOP_DIR, 'DuskBox.lnk');

/** 比较路径时忽略大小写与斜杠方向（Windows 上两种写法指同一个文件） */
const normPath = (p) => String(p).replace(/\//g, '\\').toLowerCase();

/** 每个用例结束后把桌面目录清干净 */
async function cleanDesktop() {
  for (let i = 0; i < 20; i += 1) {
    try {
      fs.rmSync(DESKTOP_DIR, { recursive: true, force: true });
      fs.mkdirSync(DESKTOP_DIR, { recursive: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

test('S22 · 没装过的时候，状态是"没有"，接口可用', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const state = ok(await srv.get('/api/desktop'));
  assert.equal(state.exists, false, '没创建过时不应报告已存在');
  assert.equal(state.supported, true, 'Windows 上应报告支持');
  assert.equal(
    path.resolve(state.linkPath),
    path.resolve(path.join(DESKTOP_DIR, 'DuskBox.lnk')),
    '快捷方式应放在桌面目录里',
  );
  assert.equal(
    path.basename(state.targetPath),
    LAUNCH_SCRIPT,
    '应指向无窗口启动器（指向 .bat 会弹出黑窗口）',
  );
});

test('S22 · 打开后真的在桌面生成快捷方式，且指向无窗口启动器', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  t.after(() => cleanDesktop());

  const res = ok(await srv.put('/api/desktop', { enabled: true }));
  assert.equal(res.exists, true, '打开后应报告已存在');
  assert.ok(fs.existsSync(LINK), '桌面上应出现 DuskBox.lnk');

  // 读快捷方式的真实目标：只检查"文件在不在"是挡不住"指向了 .bat"这种错法的
  const target = await readShortcutTarget(LINK);
  assert.ok(target, '应能读出快捷方式的目标');
  assert.equal(
    path.basename(target),
    LAUNCH_SCRIPT,
    `桌面图标应指向 ${LAUNCH_SCRIPT}，实际指向 ${target}`,
  );

  // 快捷方式的状态以文件为准：接口不说谎
  const again = ok(await srv.get('/api/desktop'));
  assert.equal(again.exists, true);
});

test('S22 · 重复打开是幂等的，不会报错', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  t.after(() => cleanDesktop());

  ok(await srv.put('/api/desktop', { enabled: true }));
  const second = ok(await srv.put('/api/desktop', { enabled: true }));
  assert.equal(second.exists, true);
  assert.ok(fs.existsSync(LINK));
});

test('S22 · 关闭后桌面上的快捷方式被删除', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  t.after(() => cleanDesktop());

  ok(await srv.put('/api/desktop', { enabled: true }));
  assert.ok(fs.existsSync(LINK));

  const res = ok(await srv.put('/api/desktop', { enabled: false }));
  assert.equal(res.exists, false);
  assert.equal(fs.existsSync(LINK), false, '关掉之后桌面上不该还留着图标');

  // 再关一次也不该报错（关闭一个已经关掉的东西是正常操作）
  const onceMore = ok(await srv.put('/api/desktop', { enabled: false }));
  assert.equal(onceMore.exists, false);
});

test('S22 · 参数必须是布尔值', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const bad = await srv.put('/api/desktop', { enabled: 'yes' });
  assert.equal(bad.status, 400);

  const missing = await srv.put('/api/desktop', {});
  assert.equal(missing.status, 400);
});

test('S22 · 桌面开关不是一个"设置项"，不能从设置接口伪造', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  t.after(() => cleanDesktop());

  // 真实状态只能来自桌面上的快捷方式文件；想用设置接口写一个值必须被拒
  const res = await srv.put('/api/settings', { desktop: 'true' });
  assert.equal(res.status, 400, '设置接口不该接受桌面启动器的开关');
  assert.equal(fs.existsSync(LINK), false, '更不该凭空在桌面上造出快捷方式');
});

test('S22 · 快捷方式指向旧脚本时，启动服务会把它校正回来', async (t) => {
  t.after(() => cleanDesktop());

  // 造一个"指向带窗口 .bat 的老快捷方式"——这正是从旧版本升级上来的样子
  await createShortcut({
    linkPath: LINK,
    target: path.join(PROJECT_ROOT, START_SCRIPT),
    workdir: PROJECT_ROOT,
    description: '旧快捷方式',
  });
  assert.ok(fs.existsSync(LINK));
  assert.equal(
    path.basename(await readShortcutTarget(LINK)),
    START_SCRIPT,
    '前提：先造出一个指向旧脚本的快捷方式',
  );

  const before = await getDesktopShortcut();
  assert.equal(before.exists, true);

  await refreshDesktopShortcutTarget();

  // 校正后必须指向无窗口启动器：读快捷方式目标要看真实文件，不能靠"我们以为改过"
  const refreshed = await getDesktopShortcut();
  assert.equal(refreshed.exists, true, '校正后快捷方式仍然在');
  assert.equal(
    normPath(await readShortcutTarget(LINK)),
    normPath(launcherPath()),
    '校正后的目标应是无窗口启动器（不能还指着 .bat）',
  );
});
