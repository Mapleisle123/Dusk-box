/**
 * 测试辅助工具。
 *
 * 每个测试都使用独立的临时数据目录，互不干扰，结束后自动清理。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createApp } from '../server/app.js';
import { PROJECT_ROOT } from '../server/config.js';

export const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

// ---------------------------------------------------------------------------
// 生成真实的 PNG 图片（用于测试上传与显示）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * 生成一张纯色 PNG。
 * @param {number} width
 * @param {number} height
 * @param {[number,number,number]} rgb
 */
export function makePng(width = 8, height = 8, rgb = [183, 40, 46]) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 4;
      raw[p] = rgb[0];
      raw[p + 1] = rgb[1];
      raw[p + 2] = rgb[2];
      raw[p + 3] = 255;
    }
  }

  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 测试服务器
// ---------------------------------------------------------------------------

/**
 * 启动一个隔离的测试服务器。
 *
 * @param {object} [options]
 * @param {string} [options.dataRoot] 指定数据目录（缺省用临时目录）
 * @param {() => void} [options.onShutdown] 让实例支持「停止服务」接口
 */
export async function startTestServer({ dataRoot, onShutdown } = {}) {
  const root = dataRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'qsx-test-'));
  const owned = !dataRoot;
  const app = createApp({ dataRoot: root, staticDir: PUBLIC_DIR, onShutdown });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  async function rawRequest(method, urlPath, { body, headers = {}, raw } = {}) {
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers: raw ? headers : body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const contentType = res.headers.get('content-type') || '';
    let payload;
    if (contentType.includes('application/json')) {
      payload = await res.json();
    } else {
      payload = await res.text();
    }
    return { status: res.status, body: payload, headers: res.headers };
  }

  return {
    app,
    server,
    ctx: app.ctx,
    dataRoot: root,
    base,
    port,

    get: (p) => rawRequest('GET', p),
    del: (p) => rawRequest('DELETE', p),
    post: (p, body) => rawRequest('POST', p, { body }),
    put: (p, body) => rawRequest('PUT', p, { body }),

    /** 发送 multipart 表单 */
    async postForm(p, fields = {}, files = [], method = 'POST') {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
      for (const file of files) {
        form.append(file.field || 'files', new Blob([file.buffer]), file.name);
      }
      const res = await fetch(`${base}${p}`, { method, body: form });
      const contentType = res.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await res.json() : await res.text();
      return { status: res.status, body: payload };
    },

    /** 读一个数据目录下的文件内容 */
    readDataFile(relPath) {
      return fs.readFileSync(path.join(root, relPath), 'utf8');
    },

    /** 数据目录下某路径是否存在 */
    existsData(relPath) {
      return fs.existsSync(path.join(root, relPath));
    },

    /** 列出目录 */
    listData(relDir) {
      const abs = path.join(root, relDir);
      if (!fs.existsSync(abs)) return [];
      return fs.readdirSync(abs);
    },

    async close() {
      // 必须强制关闭空闲的 keep-alive 连接，
      // 否则 server.close() 会一直等这些连接超时（约 3 秒）。
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      app.close();
      if (owned) {
        // Windows 上文件句柄释放稍有延迟，重试几次
        for (let i = 0; i < 5; i += 1) {
          try {
            fs.rmSync(root, { recursive: true, force: true });
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
      }
    },
  };
}

/** 断言响应成功并返回 body */
export function ok(res, message = '') {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${message} 期望 2xx，实际 ${res.status}：${JSON.stringify(res.body)}`);
  }
  return res.body;
}

// ---------------------------------------------------------------------------
// 端口占位
// ---------------------------------------------------------------------------

/** 找一个空闲端口 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * 把一段连续端口占住（连上就断开），可以留出一格。
 *
 * 两个用处：
 *   1. 让"服务已经在跑"这类探针用例不受并行跑着的隔壁实例干扰——
 *      茜色箱的实例长得都一样，探针扫到谁都会当成"在跑"；
 *   2. 服务不在时报 0 的用例，扫描范围内必须真的一个实例都没有。
 *
 * 为什么监听的是**另一个进程**：本进程自己监听的端口，被别的进程访问时
 * 数据过不来（这台机器的执行环境会拦），探针只能一直等到读超时——
 * 20 个端口乘下来就是半分钟。独立进程监听"连上就断开"，立刻返回 EOF。
 *
 * @param {number} size 段长
 * @param {number} freeIndex 留空的那一格（-1 表示全占住）
 * @returns {Promise<{base:number, child:import('node:child_process').ChildProcess}|null>}
 */
export async function occupyPortRange(size, freeIndex = -1) {
  const script = `
    const net = require('net');
    const [base, size, free] = process.argv.slice(1).map(Number);
    let listening = 0;
    const want = size - (free >= 0 ? 1 : 0);
    for (let i = 0; i < size; i += 1) {
      if (i === free) continue;
      net.createServer((socket) => socket.destroy())
        .listen(base + i, '127.0.0.1', () => {
          listening += 1;
          if (listening === want) console.log('ready');
        });
    }
  `;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const base = await freePort();
    if (base + size - 1 > 65535) continue;
    const child = spawn(
      process.execPath,
      ['-e', script, String(base), String(size), String(freeIndex)],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const ready = await new Promise((resolve) => {
      let out = '';
      const timer = setTimeout(() => resolve(false), 5000);
      child.stdout.on('data', (d) => {
        out += String(d);
        if (out.includes('ready')) {
          clearTimeout(timer);
          resolve(true);
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
    if (ready) return { base, child };
    child.kill();
  }
  return null;
}
