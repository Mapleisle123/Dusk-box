/**
 * 反向验证：故意把代码改坏，确认对应的测试真的会失败。
 *
 * 一条测试如果在"改坏了"之后依然通过，它就不是护栏，只是装饰。
 * 这里逐个植入退化写法，每次只植入一处、跑一次、还原，再植入下一处。
 *
 * 覆盖五个测试文件：
 *   test/s14-logo.test.js           侧栏徽标（尺寸 / 边框 / 圆角）
 *   test/s17-liquid-glass.test.js   液态玻璃材质
 *   test/s18-style-switch.test.js   外观风格切换（简约 / 新粗野主义）
 *   test/s19-ascii-filenames.test.js  命名护栏（ASCII 侧 / 中文侧）
 *   test/s8-backup.test.js          备份与恢复（含旧文件名兼容）
 *
 * 每条植入可以用 `tests` 指定只跑相关的测试文件；不写就跑默认的三个。
 * 后两个文件跑起来比前三个慢，所以只让需要它们的植入去跑。
 *
 * 注意：**锚点字符串会跟着代码一起过期。** 上一版脚本里钉的还是
 * `--pane-card: … 58%` 和 `--text-3: #7B8393`，而在玻璃重构里这两个值都改过，
 * 于是植入会静默地"找不到目标"。所以每条植入都要求 `apply` 必须真的改变内容，
 * 改不动就判为失败——不许悄悄跳过。
 *
 * 用法：node scripts/verify-mutations.mjs
 * 脚本结束时一定会把所有改动还原（含异常路径）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEST_FILES = [
  'test/s14-logo.test.js',
  'test/s17-liquid-glass.test.js',
  'test/s18-style-switch.test.js',
];

const rel = (p) => path.join(ROOT, ...p.split('/'));

/**
 * 每一条：名字 + 改哪个文件 + 怎么改 + 期望命中的用例名关键词。
 * `apply` 返回原样即视为"没改动"，会被判失败——这是为了防止锚点过期后
 * 整个反向验证变成一场空转。
 */
const MUTATIONS = [
  {
    name: '把卡片填充改成实心（玻璃悄悄退化成一块板）',
    file: 'public/css/app.css',
    apply: (css) => css.replace('--pane-card: color-mix(in srgb, var(--surface) 66%, transparent);', '--pane-card: var(--surface);'),
    expect: '透明',
  },
  {
    name: '把三级文字调浅（对比度不足）',
    file: 'public/css/app.css',
    apply: (css) => css.replace('  --text-3: #5F6673;', '  --text-3: #B9BEC7;'),
    expect: '文字仍然达标',
  },
  {
    name: '在样式里塞进一张外部风景图',
    file: 'public/css/app.css',
    apply: (css) => `${css}\n.hero-visual { background-image: url("/img/mountain.jpg"); }\n`,
    expect: '气象或景观',
  },
  {
    name: '砍掉按钮的按下反馈',
    file: 'public/css/app.css',
    apply: (css) => css.replace('  transform: translateY(0) scale(0.97);', '  transform: none;'),
    expect: '按下要',
  },
  {
    name: '把标题字体换回非 display 族（字体语言没切换）',
    file: 'public/css/app.css',
    apply: (css) =>
      css.replace(
        'h1 { font-size: var(--fs-xl); font-family: var(--font-display);',
        'h1 { font-size: var(--fs-xl); font-family: var(--font-sans);',
      ),
    expect: '衬线字体',
  },
  {
    name: '把弹窗遮罩调薄（薄到挡不住底下的内容）',
    file: 'public/css/app.css',
    // 注意剂量要往"更差"的方向调：遮罩的不透明度是
    //   首位权重 + 次位权重 × 次位 alpha
    // 上一版这里写成 92%，反而把遮罩调得更不透明了，
    // 于是"改坏了却依然通过"——那是植入的错，不是测试的错。
    apply: (css) =>
      css.replace(
        'background: color-mix(in srgb, var(--bg-deep) 40%, rgba(12, 14, 18, 0.34));',
        'background: color-mix(in srgb, var(--bg-deep) 8%, rgba(12, 14, 18, 0.30));',
      ),
    expect: '弹窗浮层',
  },
  {
    name: '把浅色内容区面板调薄（偏暗照片下副标题不够）',
    file: 'public/css/app.css',
    apply: (css) =>
      css.replace(
        '--pane-2: color-mix(in srgb, var(--surface) 56%, transparent);',
        '--pane-2: color-mix(in srgb, var(--surface) 30%, transparent);',
      ),
    expect: '浅色地板',
  },
  {
    name: '让别的文件也能凭空造出一层全屏遮罩',
    file: 'public/js/router.js',
    apply: (js) => `${js}\n// 故意植入：下面这行会在路由里造一层盖满视口的遮罩\nexport const _stray = (el) => { el.className = 'modal-backdrop'; };\n`,
    expect: '全屏遮罩',
  },

  // ---- S18：外观风格切换（简约 / 新粗野主义）----
  {
    name: '加了 style 字段却忘了加进白名单（接口 200、值却不变）',
    file: 'server/routes/settings.js',
    apply: (js) => js.replace("  'colorMode',\n  'style',\n", "  'colorMode',\n"),
    expect: '可切换并持久化',
  },
  {
    name: '粗野主义没关掉光场（底上还有光在流动）',
    file: 'public/css/app.css',
    apply: (css) =>
      css.replace(
        'html[data-style="brutal"] {\n  /* 墨色',
        'html[data-style="brutal"] {\n  --glow: color-mix(in srgb, var(--primary) 22%, transparent);\n  /* 墨色',
      ),
    expect: '玻璃赖以成立的三样东西',
  },
  {
    name: '粗野主义用回 1px 细边（块面读不出来）',
    file: 'public/css/app.css',
    apply: (css) => css.replace('  --bw: 2px;\n', '  --bw: 1px;\n'),
    expect: '结构：直角、粗边、硬偏移影',
  },
  {
    name: '把 --pane-hi 写成 none（会让整条 box-shadow 失效）',
    file: 'public/css/app.css',
    apply: (css) => css.replace('  --pane-hi: 0 0 0 transparent;\n', '  --pane-hi: none;\n'),
    expect: '--pane-hi 不能写成 none',
  },
  {
    name: '给粗野主义塞一条与默认值相同的空壳覆盖',
    file: 'public/css/app.css',
    apply: (css) =>
      css.replace(
        'html[data-style="brutal"] {\n  /* 墨色',
        'html[data-style="brutal"] {\n  --pane-blur-soft: 16px;\n  /* 墨色',
      ),
    expect: '空壳覆盖',
  },
  {
    name: '删掉"简约"预览图的圆角保护（选择器失去意义）',
    file: 'public/css/app.css',
    apply: (css) =>
      css.replace('html[data-style="brutal"] .style-opt-preview.liquid { border-radius: 12px; }\n', ''),
    expect: '预览图',
  },

  // ---- S14：侧栏徽标（加大 + 边框）----
  {
    name: '把徽标改回原来的 32px（用户明确要求加大过）',
    file: 'public/css/app.css',
    apply: (css) => css.replace('  --brand-size: 40px;', '  --brand-size: 32px;'),
    expect: '徽标已加大',
  },
  {
    name: '删掉徽标那圈边框',
    file: 'public/css/app.css',
    // 这条声明在文件里有 3 处（.brand-mark / .main ×2），
    // .brand-mark 是最靠前的一处，replace 只替换首次命中，正好落在它身上。
    apply: (css) => css.replace('  border: var(--bw) solid var(--border-strong);\n', ''),
    expect: '边框',
  },
  {
    name: '把徽标边框换成 --pane-edge（浅色下是白线，等于没画）',
    file: 'public/css/app.css',
    apply: (css) =>
      css.replace(
        '  border: var(--bw) solid var(--border-strong);',
        '  border: var(--bw) solid var(--pane-edge);',
      ),
    expect: '边框',
  },
  {
    name: '让徽标图片照抄印章圆角（两个角不同心）',
    file: 'public/css/app.css',
    apply: (css) =>
      css.replace(
        '  border-radius: calc(var(--brand-radius) - var(--bw));',
        '  border-radius: var(--brand-radius);',
      ),
    expect: '同源',
  },

  // ---- S19：命名护栏（ASCII 侧不许退回中文，中文侧不许被改掉）----
  {
    name: '把数据库文件名退回中文名',
    file: 'server/constants.js',
    apply: (js) => js.replace("export const DB_FILENAME = 'duskbox.db';", "export const DB_FILENAME = '茜色箱.db';"),
    expect: '数据库文件名与启动脚本常量',
    tests: ['test/s19-ascii-filenames.test.js'],
  },
  {
    name: '把启动脚本名退回中文名',
    file: 'server/autostart.js',
    apply: (js) =>
      js.replace("export const LAUNCHER_NAME = 'DuskBox-start.bat';", "export const LAUNCHER_NAME = '茜色箱启动.bat';"),
    expect: '三个启动脚本齐备',
    tests: ['test/s19-ascii-filenames.test.js'],
  },
  {
    name: '把界面标题也改成英文（用户看到的中文名被悄悄换掉）',
    file: 'public/index.html',
    apply: (html) => html.replace('<title>茜色箱</title>', '<title>Dusk Box</title>'),
    expect: '界面仍然显示中文名',
    tests: ['test/s19-ascii-filenames.test.js'],
  },
  {
    name: '恢复备份时不再兼容旧的中文文件名（历史备份全作废）',
    file: 'server/backup.js',
    apply: (js) => js.replace('  for (const name of [DB_FILENAME, LEGACY_DB_FILENAME]) {', '  for (const name of [DB_FILENAME]) {'),
    expect: '改名前生成的历史备份',
    tests: ['test/s8-backup.test.js'],
  },
  {
    name: '把浅色下的 --border-strong 调成透明（边框在浅色下消失）',
    file: 'public/css/app.css',
    apply: (css) =>
      css.replace('--border-strong: rgba(18, 22, 32, 0.20);', '--border-strong: transparent;'),
    expect: '边框',
  },
];

function runTest(files = TEST_FILES) {
  try {
    execFileSync(process.execPath, ['--test', '--test-reporter=spec', ...files], {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { ok: true, out: '' };
  } catch (err) {
    return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

// 先把会被改到的文件全备份一份（同一个文件可能被多条植入命中）
const FILES = [...new Set(MUTATIONS.map((m) => m.file))];
const backups = new Map(FILES.map((f) => [f, fs.readFileSync(rel(f), 'utf8')]));

let allGood = true;
const results = [];

try {
  for (const m of MUTATIONS) {
    const original = backups.get(m.file);
    const mutated = m.apply(original);
    if (mutated === original) {
      results.push({ name: m.name, verdict: `植入失败：在 ${m.file} 里找不到替换目标（锚点已过期？）`, ok: false });
      allGood = false;
      continue;
    }

    fs.writeFileSync(rel(m.file), mutated, 'utf8');
    const res = runTest(m.tests);

    let verdict;
    let ok;
    if (res.ok) {
      verdict =
        '✗ 改坏了却依然通过 —— 要么这条护栏是空的，要么这处植入其实没有变差。' +
        '先自己看一眼植入方向对不对（本文件里就踩过一次：把遮罩调成了"更厚"）';
      ok = false;
    } else if (res.out.includes(m.expect)) {
      verdict = `✓ 如期失败（命中了「${m.expect}」相关用例）`;
      ok = true;
    } else {
      const failed = [...res.out.matchAll(/✖ (.+?) \(/g)].map((x) => x[1]);
      verdict = `△ 失败了，但失败的不是预期那条。实际失败：${failed.join(' | ') || '(未解析出)'}`;
      ok = false;
    }
    results.push({ name: m.name, verdict, ok });
    if (!ok) allGood = false;
  }
} finally {
  for (const [f, content] of backups) fs.writeFileSync(rel(f), content, 'utf8');
}

console.log('\n=== 反向验证（S14 徽标 + S17 液态玻璃 + S18 外观风格 + S19 命名 + S8 备份兼容）===');
for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}\n    ${r.verdict}`);

const stale = [...backups].filter(([f, content]) => fs.readFileSync(rel(f), 'utf8') !== content).map(([f]) => f);
console.log(`\n已还原：${stale.length === 0 ? '是' : `否 —— 这些文件没还原：${stale.join('、')}`}`);

if (!allGood || stale.length > 0) process.exitCode = 1;
