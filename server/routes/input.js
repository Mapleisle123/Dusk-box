/**
 * 路由输入解析辅助：统一处理 JSON 与 multipart 两种请求体。
 */

import { readJson, readMultipart } from '../http.js';

/**
 * 读取请求输入。
 * @returns {Promise<{body: object, files: Array<{originalName:string, buffer:Buffer, contentType:string}>}>}
 */
export async function readInput(req) {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    const { fields, files } = await readMultipart(req);
    return {
      body: normalizeFields(fields),
      files: files.map((f) => ({
        originalName: f.filename,
        buffer: f.data,
        contentType: f.contentType,
      })),
    };
  }
  const body = await readJson(req);
  return { body: normalizeFields(body), files: [] };
}

/** 把 JSON 字符串形式的字段还原为对象/数组 */
function normalizeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
      try {
        out[key] = JSON.parse(value);
        continue;
      } catch {
        /* 解析失败则保留原字符串 */
      }
    }
    out[key] = value;
  }
  return out;
}

/** 把字符串安全转为布尔 */
export function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return fallback;
}

/** 把字符串安全转为数字 */
export function toNum(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
