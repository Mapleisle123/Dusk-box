/**
 * 把一张"白底立绘"变成能浮在页面上的透明 PNG。
 *
 * 用法：
 *   node scripts/make-mascot.mjs <源图.png> <输出.png> [目标宽度=520]
 *
 * 为什么要这么麻烦，而不是直接丢进 img/mascot/：
 *   - AI 生成的立绘都是白底（还带浅色渐变、星芒、花瓣、水印），
 *     直接放到页面上就是贴了一张白纸——浅色主题下像补丁，深色主题下像灯箱；
 *   - 全局"白色转透明"会把她白色的裙子一起抠掉，所以必须用
 *     **从四边出发的连通填充**：只会吃掉与边缘相连的背景，
 *     被轮廓线包住的白色区域（裙子、脸部高光）动不了；
 *   - 背景里那些零散的星芒/爱心/花瓣是与主体不相连的小色块，
 *     抠完之后按连通块大小筛掉，只留下人物本身。
 *
 * 实现上分两段：**解码与编码交给 .NET**（System.Drawing，系统自带，
 * Node 没有内置的 PNG 编解码），**像素运算留在 Node**（几百万个像素的
 * 洪水填充在 PowerShell 里跑要几分钟，在 Node 里是几十毫秒）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** 从四边往下吞的亮度门槛：比这个亮的才算"背景候选" */
const BRIGHT_MIN = 186;

/** 与相邻背景像素的最大色差：梯度背景靠它一点点跟着爬 */
const COLOR_TOL = 16;

/** 小于画面这个比例、且与主体不相连的色块，判为装饰贴纸，去掉 */
const MIN_BLOB_RATIO = 0.004;

/** 只用纯 ASCII 的 PowerShell 片段，路径全部走环境变量 */
const PS_DECODE = [
  'Add-Type -AssemblyName System.Drawing',
  '$bmp = [System.Drawing.Bitmap]::FromFile($env:QSX_SRC)',
  '$w = $bmp.Width; $h = $bmp.Height',
  '$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h',
  '$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)',
  '$stride = $data.Stride',
  '$bytes = New-Object byte[] ($stride * $h)',
  '[Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)',
  '$bmp.UnlockBits($data); $bmp.Dispose()',
  '[IO.File]::WriteAllBytes($env:QSX_RAW, $bytes)',
  '[IO.File]::WriteAllText($env:QSX_META, "$w,$h,$stride")',
].join('; ');

const PS_ENCODE = [
  'Add-Type -AssemblyName System.Drawing',
  '$parts = ([IO.File]::ReadAllText($env:QSX_META)).Split(",")',
  '$w = [int]$parts[0]; $h = [int]$parts[1]; $stride = [int]$parts[2]',
  '$bytes = [IO.File]::ReadAllBytes($env:QSX_RAW)',
  '$bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)',
  '$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h',
  '$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)',
  '[Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)',
  '$bmp.UnlockBits($data)',
  '$out = $bmp',
  'if ($env:QSX_SCALE -ne "1") {',
  '  $s = [double]$env:QSX_SCALE',
  '  $nw = [int]($w * $s); $nh = [int]($h * $s)',
  '  $small = New-Object System.Drawing.Bitmap $nw, $nh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)',
  '  $g = [System.Drawing.Graphics]::FromImage($small)',
  '  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
  '  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
  '  $g.DrawImage($bmp, 0, 0, $nw, $nh)',
  '  $g.Dispose()',
  '  $out = $small',
  '}',
  '$out.Save($env:QSX_OUT, [System.Drawing.Imaging.ImageFormat]::Png)',
].join('; ');

function runPowerShell(script, env) {
  execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-Command', script],
    { env: { ...process.env, ...env }, stdio: 'pipe' },
  );
}

/** 解码成图：返回 { w, h, data:Uint8ClampedArray(RGBA) } */
function decodePng(src, tmpDir) {
  const rawPath = path.join(tmpDir, 'src.raw');
  const metaPath = path.join(tmpDir, 'src.meta');
  runPowerShell(PS_DECODE, { QSX_SRC: src, QSX_RAW: rawPath, QSX_META: metaPath });

  const [w, h, stride] = fs
    .readFileSync(metaPath, 'utf8')
    .split(',')
    .map((n) => Number(n.trim()));
  const raw = fs.readFileSync(rawPath);

  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const from = y * stride;
    data.set(raw.subarray(from, from + w * 4), y * w * 4);
  }
  return { w, h, data };
}

/** 编码并（可选）缩放输出 */
function encodePng(dst, image, targetWidth, tmpDir) {
  const { w, h, data } = image;
  const scale = targetWidth && targetWidth < w ? targetWidth / w : 1;
  const rawPath = path.join(tmpDir, 'out.raw');
  const metaPath = path.join(tmpDir, 'out.meta');
  fs.writeFileSync(rawPath, Buffer.from(data.buffer, data.byteOffset, data.length));
  fs.writeFileSync(metaPath, `${w},${h},${w * 4}`, 'utf8');
  runPowerShell(PS_ENCODE, {
    QSX_RAW: rawPath,
    QSX_META: metaPath,
    QSX_OUT: dst,
    QSX_SCALE: String(scale),
  });
}

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * 从四边做连通填充，标出背景。
 * @returns {Uint8Array} 1 表示背景
 */
function backgroundMask({ w, h, data }) {
  const bg = new Uint8Array(w * h);
  const stack = [];

  const push = (x, y) => {
    const i = y * w + x;
    if (bg[i]) return;
    const p = i * 4;
    if (luma(data[p], data[p + 1], data[p + 2]) < BRIGHT_MIN) return;
    bg[i] = 1;
    stack.push(i);
  };

  // 四条边上的所有"够亮"的点都是种子
  for (let x = 0; x < w; x += 1) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    push(0, y);
    push(w - 1, y);
  }

  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    const p = i * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];

    const neighbors = [];
    if (x > 0) neighbors.push(i - 1);
    if (x < w - 1) neighbors.push(i + 1);
    if (y > 0) neighbors.push(i - w);
    if (y < h - 1) neighbors.push(i + w);

    for (const n of neighbors) {
      if (bg[n]) continue;
      const np = n * 4;
      const nr = data[np];
      const ng = data[np + 1];
      const nb = data[np + 2];
      if (Math.abs(nr - r) > COLOR_TOL || Math.abs(ng - g) > COLOR_TOL || Math.abs(nb - b) > COLOR_TOL) {
        continue;
      }
      if (luma(nr, ng, nb) < BRIGHT_MIN) continue;
      bg[n] = 1;
      stack.push(n);
    }
  }
  return bg;
}

/**
 * 只保留够大的连通块（人物本体），把星芒、爱心、花瓣这些贴纸筛掉。
 * @returns {Uint8Array} 1 表示保留
 */
function subjectMask({ w, h }, bg) {
  const keep = new Uint8Array(w * h);
  const total = w * h;
  const minArea = Math.max(400, Math.round(total * MIN_BLOB_RATIO));
  const areas = [];

  const labels = new Int32Array(w * h).fill(-1);
  let current = -1;

  for (let start = 0; start < total; start += 1) {
    if (bg[start] || labels[start] >= 0) continue;
    current += 1;
    let area = 0;
    const stack = [start];
    labels[start] = current;
    while (stack.length) {
      const i = stack.pop();
      area += 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && !bg[i - 1] && labels[i - 1] < 0) {
        labels[i - 1] = current;
        stack.push(i - 1);
      }
      if (x < w - 1 && !bg[i + 1] && labels[i + 1] < 0) {
        labels[i + 1] = current;
        stack.push(i + 1);
      }
      if (y > 0 && !bg[i - w] && labels[i - w] < 0) {
        labels[i - w] = current;
        stack.push(i - w);
      }
      if (y < h - 1 && !bg[i + w] && labels[i + w] < 0) {
        labels[i + w] = current;
        stack.push(i + w);
      }
    }
    areas.push(area);
  }

  for (let i = 0; i < total; i += 1) {
    const label = labels[i];
    if (label >= 0 && areas[label] >= minArea) keep[i] = 1;
  }
  return keep;
}

/** 把保留区的 alpha 写回图像，并做一圈轻微羽化 */
function applyAlpha({ w, h, data }, bg, keep) {
  const total = w * h;
  const alpha = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) alpha[i] = keep[i] ? 255 : 0;

  // 边缘羽化：往外三圈、往内两圈逐级过渡。
  // 只做一圈的话，缩小到页面尺寸后边缘还是"刀切"的（发梢尤其明显），
  // 这里按"离边界的距离"铺一条 alpha 斜坡。
  const OUTER = [150, 85, 35];
  const INNER = [232, 214];

  // 由外向内推：每一轮把"紧贴已知区域的外侧一圈"点亮，并记下这一圈的 alpha
  let grown = Uint8Array.from(keep);
  for (let step = 0; step < OUTER.length; step += 1) {
    const next = Uint8Array.from(grown);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        if (grown[i]) continue;
        if (grown[i - 1] || grown[i + 1] || grown[i - w] || grown[i + w]) {
          alpha[i] = OUTER[step];
          next[i] = 1;
        }
      }
    }
    grown = next;
  }

  // 由内向外啃：每一轮把当前的边界圈压暗一点，然后把它从"实心"里去掉，
  // 下一轮自然就轮到往里一圈
  let solid = Uint8Array.from(keep);
  for (let step = 0; step < INNER.length; step += 1) {
    const next = Uint8Array.from(solid);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        if (!solid[i]) continue;
        if (!solid[i - 1] || !solid[i + 1] || !solid[i - w] || !solid[i + w]) {
          alpha[i] = Math.min(alpha[i], INNER[step]);
          next[i] = 0;
        }
      }
    }
    solid = next;
  }

  for (let i = 0; i < total; i += 1) {
    data[i * 4 + 3] = alpha[i];
  }
}

/** 裁到主体外框（带一点留白），避免四周空一大片 */
function crop(image, keep, pad = 12) {
  const { w, h, data } = image;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!keep[y * w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return image;

  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(w - 1, maxX + pad);
  const y1 = Math.min(h - 1, maxY + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y += 1) {
    out.set(data.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + cw) * 4), y * cw * 4);
  }
  return { w: cw, h: ch, data: out };
}

function main() {
  const [src, dst, widthArg] = process.argv.slice(2);
  if (!src || !dst) {
    console.error('用法：node scripts/make-mascot.mjs <源图.png> <输出.png> [目标宽度=520]');
    process.exit(1);
  }
  const targetWidth = Number(widthArg) || 520;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-mascot-'));

  try {
    const image = decodePng(src, tmpDir);
    const bg = backgroundMask(image);
    const keep = subjectMask(image, bg);
    applyAlpha(image, bg, keep);
    const cropped = crop(image, keep);
    encodePng(dst, cropped, targetWidth, tmpDir);

    const kept = keep.reduce((sum, v) => sum + v, 0);
    const bytes = fs.statSync(dst).size;
    console.log(
      `${path.basename(src)} -> ${path.basename(dst)}：` +
        `${image.w}x${image.h} 保留 ${(kept / (image.w * image.h) * 100).toFixed(1)}% 像素，` +
        `裁到 ${cropped.w}x${cropped.h}，输出 ${(bytes / 1024).toFixed(0)} KB`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
