/**
 * 把她的四段动作 MP4 变成**带透明通道的 WebM**（并且和静止图统一取景）。
 *
 * 用法：
 *   node scripts/make-mascot-anim.mjs --ffmpeg <ffmpeg目录>
 *
 * 为什么这么绕：
 *   - 素材是 H.264 的 MP4，**视频编码本身带不了透明通道**，而且画面是白底；
 *     想在网页上"贴纸式"地浮动，就得把背景抠掉，还要换成支持 alpha 的格式。
 *   - 抠底不能简单地"把白色变透明"：她那条白裙子会被一起抠掉。
 *     所以用**从四边出发的连通填充**——只吃与边缘相连的背景，
 *     被轮廓线包住的白色（裙子、脸部高光）动不了。
 *   - 逐帧抠完还要**统一取景**：四段视频分辨率不一样（1280x720 与 720x960），
 *     原样放上去她一会儿大一会儿小。这里把每段动作按"她本人的外框"裁出来，
 *     再缩放摆到同一块画布上（同一个底线、同一个身高上限），
 *     这样静态图与四段动作切换时她不会忽大忽小。
 *
 * 解码与编码都交给 ffmpeg（它能把视频直接吐成原始 RGBA，也能从原始 RGBA
 * 编出 VP9+alpha 的 WebM），像素运算留在 Node 里做——几百万像素的
 * 连通填充在 Node 里是几十毫秒的事。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};

const BIN = argOf('--ffmpeg') || path.dirname(argOf('--ffmpeg') || '');
const FFMPEG = BIN ? path.join(BIN, 'ffmpeg.exe') : 'ffmpeg';
const FFPROBE = BIN ? path.join(BIN, 'ffprobe.exe') : 'ffprobe';

/** 统一画布：所有素材（含静止图）都摆进这个尺寸里 */
const CANVAS_W = 448;
const CANVAS_H = 640;

/** 她在画布里的上限：身高 600、宽度 420，底线在 y=630 */
const SUBJECT_MAX_H = 600;
const SUBJECT_MAX_W = 420;
const BASELINE = 630;

/** 采样帧率：24 帧太密，动作片看 12 帧够用，文件能小一半 */
const FPS = 12;

/** 只播前几秒的那两段（用户要的：挥手与跺脚不拖沓） */
const TRIM_SECONDS = 2.5;

const SOURCES = [
  { key: 'wave', src: 'img/mascot/gif/mascot_wave.mp4', trim: TRIM_SECONDS },
  { key: 'stomp', src: 'img/mascot/gif/mascot_stomp.mp4', trim: TRIM_SECONDS },
  { key: 'struggle', src: 'img/mascot/gif/mascot_struggle.mp4' },
  { key: 'idle', src: 'img/mascot/gif/mascot_idle.mp4' },
];

const OUT_DIR = 'img/mascot/anim';
const STILL_SRC = 'img/mascot/mascot.png';
const STILL_OUT = 'img/mascot/mascot.png';

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function run(bin, args) {
  const res = spawnSync(bin, args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`${path.basename(bin)} 失败：\n${res.stderr || res.error?.message}`);
  }
  return res.stdout || '';
}

/** 读一段素材的宽高与时长 */
function probe(file) {
  const out = run(FFPROBE, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-show_entries', 'format=duration',
    '-of', 'json',
    file,
  ]);
  const data = JSON.parse(out);
  return {
    w: data.streams[0].width,
    h: data.streams[0].height,
    seconds: Number(data.format.duration),
  };
}

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

const BRIGHT_MIN = 186;
const COLOR_TOL = 16;
const MIN_BLOB_RATIO = 0.002;

/**
 * 「近白」判据。
 *
 * 原先用的是"和相邻像素色差不超过 16 才继续爬"，结果在待机那段翻车了：
 * 它的背景是带一点水彩纹理的白（248~251），纹理会让色差忽大忽小，
 * 爬到半路就断，于是**整块背景被当成了她**，她就缩成小小一个。
 *
 * 现在改成看"这个像素本身是不是近白"：够亮 + 颜色不偏（通道差很小）。
 * 她的白裙子虽然也白，但被轮廓线包着，从四边爬不进去，所以是安全的。
 */
const NEAR_WHITE_LUMA = 232;
const NEAR_WHITE_SAT = 20;

function isNearWhite(data, p) {
  const r = data[p];
  const g = data[p + 1];
  const b = data[p + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return luma(r, g, b) >= NEAR_WHITE_LUMA && max - min <= NEAR_WHITE_SAT;
}

/**
 * 从四边做连通填充，标出背景。
 * 画面已经是透明底的（比如静止图）就跳过——那里边框本来就是透明的。
 * @returns {{bg: Uint8Array, already: boolean}}
 */
function backgroundMask({ w, h, data }) {
  const total = w * h;
  const bg = new Uint8Array(total);

  // 先看边框：全是透明的说明这张图已经抠过了
  let clearBorder = 0;
  let border = 0;
  const check = (i) => {
    border += 1;
    if (data[i * 4 + 3] < 16) clearBorder += 1;
  };
  for (let x = 0; x < w; x += 1) {
    check(x);
    check((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    check(y * w);
    check(y * w + w - 1);
  }
  if (clearBorder / border > 0.8) return { bg, already: true };

  const stack = [];
  const push = (i) => {
    if (bg[i]) return;
    const p = i * 4;
    if (data[p + 3] < 16) {
      bg[i] = 1;
      stack.push(i);
      return;
    }
    if (!isNearWhite(data, p)) return;
    bg[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x += 1) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    push(y * w);
    push(y * w + w - 1);
  }

  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    const p = i * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const around = [];
    if (x > 0) around.push(i - 1);
    if (x < w - 1) around.push(i + 1);
    if (y > 0) around.push(i - w);
    if (y < h - 1) around.push(i + w);
    for (const n of around) {
      if (bg[n]) continue;
      const np = n * 4;
      if (data[np + 3] < 16) {
        bg[n] = 1;
        stack.push(n);
        continue;
      }
      if (!isNearWhite(data, np)) continue;
      bg[n] = 1;
      stack.push(n);
    }
  }
  return { bg, already: false };
}

/**
 * 只留下**最大的一块**——也就是她本人。
 *
 * 素材里除了她，周围还有墨迹、蝴蝶、卷轴这些装饰（尤其待机那段是横屏的，
 * 装饰铺得很开）。它们如果被算进外框，她就得为了"装下装饰"而缩小，
 * 于是待机时看起来比挥手小一截。只留她本人之后，五张素材的外框都是她，
 * 大小自然就一致了。
 *
 * 用比例而不是绝对面积来筛：最大那块是人物，其余一律不要。
 */
function subjectMask({ w, h, data }, bg, already) {
  const total = w * h;
  const keep = new Uint8Array(total);
  if (already) {
    for (let i = 0; i < total; i += 1) if (data[i * 4 + 3] >= 16) keep[i] = 1;
    return { keep, parts: [{ label: 0, area: 1, minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 }] };
  }

  const minArea = Math.max(400, Math.round(total * MIN_BLOB_RATIO));
  const labels = new Int32Array(total).fill(-1);
  const areas = [];
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
      const around = [];
      if (x > 0) around.push(i - 1);
      if (x < w - 1) around.push(i + 1);
      if (y > 0) around.push(i - w);
      if (y < h - 1) around.push(i + w);
      for (const n of around) {
        if (bg[n] || labels[n] >= 0) continue;
        labels[n] = current;
        stack.push(n);
      }
    }
    areas.push(area);
  }
  // 每块的面积与外框，交给调用方决定"哪一块是她"
  const parts = [];
  for (let label = 0; label < areas.length; label += 1) {
    if (areas[label] < minArea) continue;
    parts.push({ label, area: areas[label], minX: w, minY: h, maxX: -1, maxY: -1 });
  }
  const byLabel = new Map(parts.map((p) => [p.label, p]));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = byLabel.get(labels[y * w + x]);
      if (!p) continue;
      if (x < p.minX) p.minX = x;
      if (x > p.maxX) p.maxX = x;
      if (y < p.minY) p.minY = y;
      if (y > p.maxY) p.maxY = y;
    }
  }
  for (const p of parts) {
    p.cx = (p.minX + p.maxX) / 2;
    p.cy = (p.minY + p.maxY) / 2;
  }
  return { keep, parts, labels };
}

/** 把保留区的 alpha 写回，并铺一条由外向内 / 由内向外的柔和过渡 */
function applyAlpha({ w, h, data }, keep) {
  const total = w * h;
  const alpha = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) alpha[i] = keep[i] ? 255 : 0;

  const OUTER = [150, 85, 35];
  const INNER = [232, 214];

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

  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < total; i += 1) out[i * 4 + 3] = alpha[i];
  for (let i = 0; i < total; i += 1) {
    // 抠完还把颜色按 alpha 预乘一下，缩放时才不会在边缘泛白
    const a = out[i * 4 + 3] / 255;
    out[i * 4] = out[i * 4] * a;
    out[i * 4 + 1] = out[i * 4 + 1] * a;
    out[i * 4 + 2] = out[i * 4 + 2] * a;
  }
  return { data: out, keep };
}

/** 主体外框 */
function bboxOf(keep, w, h) {
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
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** 双线性采样（按预乘 alpha 采样，避免边缘泛白） */
function sample(src, w, h, x, y, out, at) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let dy = 0; dy <= 1; dy += 1) {
    for (let dx = 0; dx <= 1; dx += 1) {
      const sx = Math.min(Math.max(x0 + dx, 0), w - 1);
      const sy = Math.min(Math.max(y0 + dy, 0), h - 1);
      const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      const p = (sy * w + sx) * 4;
      r += src[p] * weight;
      g += src[p + 1] * weight;
      b += src[p + 2] * weight;
      a += src[p + 3] * weight;
    }
  }
  const alpha = a / 255;
  out[at] = alpha > 0.004 ? Math.min(255, r / alpha) : 0;
  out[at + 1] = alpha > 0.004 ? Math.min(255, g / alpha) : 0;
  out[at + 2] = alpha > 0.004 ? Math.min(255, b / alpha) : 0;
  out[at + 3] = a;
}

/** 按统一画布摆好：同一个身高上限、同一个底线、水平居中 */
function toCanvas(premultiplied, w, h, box) {
  const bw = box.maxX - box.minX + 1;
  const bh = box.maxY - box.minY + 1;
  const scale = Math.min(SUBJECT_MAX_H / bh, SUBJECT_MAX_W / bw);

  const out = new Uint8ClampedArray(CANVAS_W * CANVAS_H * 4);
  const drawW = bw * scale;
  const drawH = bh * scale;
  const left = (CANVAS_W - drawW) / 2;
  const top = BASELINE - drawH;

  const x0 = Math.max(0, Math.floor(left));
  const x1 = Math.min(CANVAS_W, Math.ceil(left + drawW));
  const y0 = Math.max(0, Math.floor(top));
  const y1 = Math.min(CANVAS_H, Math.ceil(top + drawH));

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const sx = box.minX + (x + 0.5 - left) / scale - 0.5;
      const sy = box.minY + (y + 0.5 - top) / scale - 0.5;
      sample(premultiplied, w, h, sx, sy, out, (y * CANVAS_W + x) * 4);
    }
  }
  return out;
}

/** 从 ffmpeg 吐出的整段原始 RGBA 里切出每一帧 */
function splitFrames(raw, w, h) {
  const size = w * h * 4;
  const count = Math.floor(raw.length / size);
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    frames.push(new Uint8ClampedArray(raw.buffer, raw.byteOffset + i * size, size));
  }
  return frames;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function processVideo(item, tmpDir) {
  const info = probe(item.src);
  const rawPath = path.join(tmpDir, `${item.key}.rgba`);
  const args = ['-y', '-v', 'error', '-i', item.src];
  if (item.trim) args.push('-t', String(item.trim));
  args.push('-vf', `fps=${FPS}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', rawPath);
  run(FFMPEG, args);

  const frames = splitFrames(fs.readFileSync(rawPath), info.w, info.h);
  if (!frames.length) throw new Error(`${item.src} 一帧都没解出来`);

  // 逐帧抠底：背景吃掉之后，剩下的最大一块就是她（星芒花瓣墨迹都比她小）
  const processed = [];
  const boxes = [];
  for (const frame of frames) {
    const image = { w: info.w, h: info.h, data: frame };
    const { bg, already } = backgroundMask(image);
    const { parts, labels } = subjectMask(image, bg, already);
    let pick = parts.length ? parts.reduce((a, b) => (a.area > b.area ? a : b), parts[0]) : null;

    // 已经是透明底的素材：整张都是她
    if (!pick && already) {
      const whole = { label: -1, minX: 0, minY: 0, maxX: info.w - 1, maxY: info.h - 1 };
      pick = whole;
    }
    if (!pick) {
      processed.push(new Uint8ClampedArray(info.w * info.h * 4));
      continue;
    }

    const keep = new Uint8Array(info.w * info.h);
    if (labels) {
      for (let p = 0; p < keep.length; p += 1) {
        if (labels[p] === pick.label) keep[p] = 1;
      }
    } else {
      keep.fill(1); // 已经是透明底的素材
    }
    const { data } = applyAlpha(image, keep);
    boxes.push({ minX: pick.minX, minY: pick.minY, maxX: pick.maxX, maxY: pick.maxY });
    processed.push(data);
  }
  if (!boxes.length) throw new Error(`${item.src} 抠完之后什么都没剩下`);

  // 取中位数而不是并集：万一某一帧有东西误判成主体，也不至于把整段的外框撑大
  const mid = (key) => {
    const sorted = boxes.map((b) => b[key]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const union = { minX: mid('minX'), minY: mid('minY'), maxX: mid('maxX'), maxY: mid('maxY') };

  // 统一画布（用整段动作的合并外框，避免逐帧裁切导致她抖动）
  const outPath = path.join(tmpDir, `${item.key}.canvas.rgba`);
  const fd = fs.openSync(outPath, 'w');
  try {
    for (const data of processed) {
      fs.writeSync(fd, Buffer.from(toCanvas(data, info.w, info.h, union).buffer));
    }
  } finally {
    fs.closeSync(fd);
  }

  const target = path.join(OUT_DIR, `${item.key}.webm`);
  run(FFMPEG, [
    '-y', '-v', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba',
    '-s', `${CANVAS_W}x${CANVAS_H}`, '-r', String(FPS),
    '-i', outPath,
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p',
    '-auto-alt-ref', '0', // VP9 带 alpha 时必须关掉这个，否则透明通道会被丢掉
    '-b:v', '0', '-crf', '34', '-row-mt', '1',
    '-metadata:s:v:0', 'alpha_mode=1',
    target,
  ]);

  const after = probe(target);
  const pixFmt = run(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt',
    '-of', 'default=noprint_wrappers=1:nokey=1', target,
  ]).trim();

  return {
    key: item.key,
    frames: processed.length,
    seconds: after.seconds,
    pixFmt,
    bytes: fs.statSync(target).size,
  };
}

function processStill(tmpDir) {
  const info = probe(STILL_SRC);
  const rawPath = path.join(tmpDir, 'still.rgba');
  run(FFMPEG, ['-y', '-v', 'error', '-i', STILL_SRC, '-f', 'rawvideo', '-pix_fmt', 'rgba', rawPath]);
  const frame = new Uint8ClampedArray(fs.readFileSync(rawPath).buffer);
  const image = { w: info.w, h: info.h, data: frame };
  const { bg, already } = backgroundMask(image);
  const { keep } = subjectMask(image, bg, already);
  const { data } = applyAlpha(image, keep);
  const box = bboxOf(keep, info.w, info.h);
  const canvas = toCanvas(data, info.w, info.h, box);

  const outRaw = path.join(tmpDir, 'still.canvas.rgba');
  fs.writeFileSync(outRaw, Buffer.from(canvas.buffer));
  run(FFMPEG, [
    '-y', '-v', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${CANVAS_W}x${CANVAS_H}`,
    '-i', outRaw,
    '-frames:v', '1', '-c:v', 'png', '-pix_fmt', 'rgba',
    STILL_OUT,
  ]);
  return { w: CANVAS_W, h: CANVAS_H, bytes: fs.statSync(STILL_OUT).size };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-anim-'));
  try {
    const still = processStill(tmpDir);
    console.log(`静止图 → ${STILL_OUT}  ${still.w}x${still.h}  ${(still.bytes / 1024).toFixed(0)}KB`);
    for (const item of SOURCES) {
      const r = processVideo(item, tmpDir);
      console.log(
        `${r.key.padEnd(9)} → ${OUT_DIR}/${r.key}.webm  ` +
          `${r.frames} 帧 / ${r.seconds.toFixed(2)}s / ${r.pixFmt} / ${(r.bytes / 1024).toFixed(0)}KB`,
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
