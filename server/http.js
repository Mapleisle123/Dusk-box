/**
 * 零依赖 HTTP 框架层。
 *
 * 提供：路由匹配、JSON 请求体解析、multipart 文件上传解析、
 * 静态文件托管、统一的错误响应格式。
 *
 * 不使用任何第三方库，避免依赖随时间失效。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 统一的可抛出 HTTP 错误 */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const notFound = (message = '资源不存在') => new HttpError(404, message);
export const conflict = (message, details) => new HttpError(409, message, details);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/** 默认请求体上限（本地应用，允许较大图片） */
export const DEFAULT_BODY_LIMIT = 64 * 1024 * 1024;

/**
 * 读取请求体到 Buffer。
 */
export function readBody(req, limit = DEFAULT_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, `请求体超过上限（${Math.round(limit / 1024 / 1024)}MB）`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 读取并解析 JSON 请求体 */
export async function readJson(req, limit = DEFAULT_BODY_LIMIT) {
  const raw = await readBody(req, limit);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('请求体不是合法 JSON');
  }
}

/**
 * 解析 multipart/form-data。
 *
 * 直接在 Buffer 上按 boundary 切分，避免二进制内容被当作文本处理而损坏。
 *
 * @returns {{fields: Record<string,string>, files: Array<{name:string, filename:string, contentType:string, data:Buffer}>}}
 */
export function parseMultipart(buffer, boundary) {
  const fields = {};
  const files = [];
  const delim = Buffer.from(`--${boundary}`);
  const crlf = Buffer.from('\r\n');
  const doubleCrlf = Buffer.from('\r\n\r\n');

  let cursor = buffer.indexOf(delim);
  if (cursor === -1) return { fields, files };

  while (cursor !== -1) {
    let pos = cursor + delim.length;
    // 结束标记 "--"
    if (buffer[pos] === 0x2d && buffer[pos + 1] === 0x2d) break;
    // 跳过 boundary 后的 CRLF
    if (buffer[pos] === 0x0d && buffer[pos + 1] === 0x0a) pos += 2;

    const headerEnd = buffer.indexOf(doubleCrlf, pos);
    if (headerEnd === -1) break;

    const headerText = buffer.subarray(pos, headerEnd).toString('utf8');
    const dataStart = headerEnd + doubleCrlf.length;

    const nextDelim = buffer.indexOf(delim, dataStart);
    if (nextDelim === -1) break;

    let dataEnd = nextDelim;
    if (
      dataEnd >= crlf.length &&
      buffer[dataEnd - 2] === 0x0d &&
      buffer[dataEnd - 1] === 0x0a
    ) {
      dataEnd -= 2;
    }

    const data = buffer.subarray(dataStart, dataEnd);
    const disposition = /content-disposition:\s*form-data;\s*([^\r\n]+)/i.exec(headerText);
    const nameMatch = disposition ? /name="([^"]*)"/i.exec(disposition[1]) : null;
    const filenameMatch = disposition ? /filename="([^"]*)"/i.exec(disposition[1]) : null;
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);

    const fieldName = nameMatch ? nameMatch[1] : null;
    if (fieldName) {
      if (filenameMatch) {
        files.push({
          name: fieldName,
          filename: filenameMatch[1],
          contentType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
          data,
        });
      } else {
        fields[fieldName] = data.toString('utf8');
      }
    }

    // 从下一个 boundary 继续；它是结束标记时下一轮会 break
    cursor = nextDelim;
  }

  return { fields, files };
}

/** 解析 multipart 请求 */
export async function readMultipart(req, limit = DEFAULT_BODY_LIMIT) {
  const contentType = req.headers['content-type'] || '';
  const match = /multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw badRequest('请求不是 multipart/form-data 格式');
  const boundary = (match[1] || match[2] || '').trim();
  if (!boundary) throw badRequest('缺少 multipart boundary');
  const raw = await readBody(req, limit);
  return parseMultipart(raw, boundary);
}

/** 发送 JSON 响应 */
export function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** 把路由模式编译为正则 */
function compilePattern(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      if (seg === '*') {
        keys.push('wildcard');
        return '(.*)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}$`), keys };
}

/** 路由表 */
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const { regex, keys } = compilePattern(pattern);
    this.routes.push({ method: method.toUpperCase(), regex, keys, handler, pattern });
    return this;
  }

  get(p, h) {
    return this.add('GET', p, h);
  }

  post(p, h) {
    return this.add('POST', p, h);
  }

  put(p, h) {
    return this.add('PUT', p, h);
  }

  patch(p, h) {
    return this.add('PATCH', p, h);
  }

  delete(p, h) {
    return this.add('DELETE', p, h);
  }

  /** 匹配路由，返回 { handler, params } 或 null */
  match(method, pathname) {
    const upper = method.toUpperCase();
    for (const route of this.routes) {
      if (route.method !== upper) continue;
      const m = route.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      route.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(m[i + 1]);
      });
      return { handler: route.handler, params, route };
    }
    return null;
  }
}

/** 安全地把 URL 路径解析为文件绝对路径，阻止目录穿越 */
export function safeResolve(root, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
  const abs = path.resolve(root, normalized);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  return abs;
}

/** 发送文件 */
function sendFile(res, filePath, { download = false } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const headers = {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  };
  if (download) {
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`;
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

/**
 * 创建 HTTP 服务。
 *
 * @param {object} options
 * @param {Router} options.router           业务路由（以 /api 开头）
 * @param {string} options.staticDir        前端静态文件目录
 * @param {(url:string)=>string|null} [options.fileResolver] 把 URL 映射到数据目录下的文件
 * @param {(rel:string)=>string|null} [options.resolveAsset]
 *       把 /img/ 之后的一段路径解析成磁盘文件（logo、背景图）。
 *       做成钩子而不是写死一个目录，是因为背景图有**两个来源**：
 *       数据目录里的自定义图优先，项目里的 img/ 兜底，
 *       而两者共用同一个 URL 前缀（名字就是地址，见 server/backgrounds.js）。
 */
export function createServer({ router, staticDir, fileResolver, resolveAsset }) {
  return async function handleRequest(req, res) {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      sendJson(res, 400, { error: '非法请求地址' });
      return;
    }
    const pathname = url.pathname;

    try {
      // 1. 业务 API
      const matched = router.match(req.method, pathname);
      if (matched) {
        const ctx = {
          req,
          res,
          params: matched.params,
          query: Object.fromEntries(url.searchParams.entries()),
          url,
        };
        const result = await matched.handler(ctx);
        if (res.writableEnded) return;
        if (result && typeof result === 'object' && 'status' in result && 'body' in result) {
          sendJson(res, result.status, result.body);
        } else {
          sendJson(res, 200, result ?? { ok: true });
        }
        return;
      }

      // 2. 数据目录中的文件（图片等）
      if (fileResolver && pathname.startsWith('/files/')) {
        const resolved = fileResolver(pathname);
        if (resolved && sendFile(res, resolved, { download: url.searchParams.get('download') === '1' })) {
          return;
        }
        sendJson(res, 404, { error: '文件不存在' });
        return;
      }

      // 3. 项目自带资源 + 用户自定义背景图（都挂在 /img/ 下）。
      //    注意：这里找不到时必须返回 JSON 404，不能回退到 index.html，
      //    否则 <img> 会拿到一段 HTML 而显示成破图。
      if (resolveAsset && pathname.startsWith('/img/')) {
        const target = resolveAsset(pathname.slice('/img'.length));
        if (target && fs.existsSync(target) && fs.statSync(target).isFile()) {
          sendFile(res, target);
          return;
        }
        sendJson(res, 404, { error: '资源不存在' });
        return;
      }

      // 4. API 路径未被任何路由命中：必须返回 JSON 404，
      //    不能回退到 index.html，否则前端会把 404 当成正常页面数据。
      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: `接口不存在：${req.method} ${pathname}` });
        return;
      }

      // 5. 前端静态资源
      if (req.method === 'GET' || req.method === 'HEAD') {
        const target = safeResolve(staticDir, pathname === '/' ? '/index.html' : pathname);
        if (target && fs.existsSync(target) && fs.statSync(target).isFile()) {
          sendFile(res, target);
          return;
        }
        // 前端使用 hash 路由，未命中的路径回退到 index.html
        const fallback = path.join(staticDir, 'index.html');
        if (fs.existsSync(fallback)) {
          sendFile(res, fallback);
          return;
        }
      }

      sendJson(res, 404, { error: '接口或资源不存在' });
    } catch (err) {
      if (res.writableEnded) return;
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message, details: err.details });
      } else {
        // 未预期错误：记录到控制台便于排查，但不把堆栈暴露给界面
        console.error('[Dusk Box] 未处理错误：', err);
        sendJson(res, 500, { error: err?.message || '服务器内部错误' });
      }
    }
  };
}
