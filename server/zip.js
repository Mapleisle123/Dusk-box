/**
 * 最小可用的 ZIP 打包器（零依赖）。
 *
 * 只实现导出所需的部分：deflate 压缩、UTF-8 文件名、无 Zip64。
 * 数据量上限 4GB / 65535 个文件，对本地个人应用绰绰有余。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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

/** 计算 CRC32 */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 把 Date 转成 DOS 时间/日期 */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * 打包为一组 [名称, Buffer] 的 ZIP。
 * @param {Array<{name:string, data:Buffer, mtime?:Date}>} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const raw = entry.data;
    const compressed = zlib.deflateRawSync(raw, { level: 6 });
    // 压缩后反而更大时用"仅存储"，避免白忙一场
    const useStore = compressed.length >= raw.length;
    const body = useStore ? raw : compressed;
    const method = useStore ? 0 : 8;
    const crc = crc32(raw);
    const { time, day } = dosDateTime(entry.mtime || new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flag: UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(day, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/**
 * 把一个目录树读取成 ZIP 条目。
 * @param {string} rootDir 根目录
 * @param {string} [prefix] 在压缩包内的路径前缀
 * @param {(relPath:string)=>boolean} [filter]
 */
export function collectDirEntries(rootDir, prefix = '', filter = null) {
  const entries = [];
  if (!fs.existsSync(rootDir)) return entries;

  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, item.name);
      const rel = path.relative(rootDir, abs).split(path.sep).join('/');
      if (filter && !filter(rel)) continue;
      if (item.isDirectory()) {
        walk(abs);
      } else if (item.isFile()) {
        let data;
        try {
          data = fs.readFileSync(abs);
        } catch {
          continue; // 正在被写入的文件跳过即可，不影响整体导出
        }
        entries.push({
          name: prefix ? `${prefix}/${rel}` : rel,
          data,
          mtime: fs.statSync(abs).mtime,
        });
      }
    }
  };

  walk(rootDir);
  return entries;
}
