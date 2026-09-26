/**
 * 反向验证：故意把代码改坏，确认对应的测试真的会失败。
 *
 * 一条测试如果在"改坏了"之后依然通过，它就不是护栏，只是装饰。
 * 这里逐个植入退化写法，每次只植入一处、跑一次、还原，再植入下一处。
 *
 * 注意：**锚点字符串会跟着代码一起过期。** 上一版脚本里钉的还是
 * `--pane-card: … 58%` 和 `--text-3: #7B8393`，而在玻璃重构里这两个值都改过，
 * 于是植入会静默地"找不到目标"。所以每条植入都要求 `apply` 必须真的改变内容，
 * 改不动就判为失败——不许悄悄跳过。
 *
 * 用法：node scripts/verify-s17-mutations.mjs
 * 脚本结束时一定会把所有改动还原（含异常路径）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEST_FILE = 'test/s17-liquid-glass.test.js';

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
];

function runTest() {
  try {
    execFileSync(process.execPath, ['--test', '--test-reporter=spec', TEST_FILE], {
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
    const res = runTest();

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

console.log('\n=== S17 反向验证 ===');
for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}\n    ${r.verdict}`);

const stale = [...backups].filter(([f, content]) => fs.readFileSync(rel(f), 'utf8') !== content).map(([f]) => f);
console.log(`\n已还原：${stale.length === 0 ? '是' : `否 —— 这些文件没还原：${stale.join('、')}`}`);

if (!allGood || stale.length > 0) process.exitCode = 1;
