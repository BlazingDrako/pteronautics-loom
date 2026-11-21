// Minimal .zip reading and writing, with no dependencies. Files are deflated with the
// browser's own CompressionStream when it has one, and stored otherwise. Reading handles
// stored and deflated entries, which covers zips made by macOS, Windows, git and Loom itself.

const enc = new TextEncoder(), dec = new TextDecoder();

/** @type {Uint32Array | null} */
let crcTable = null;
/** CRC-32 (IEEE). @param {Uint8Array} data */
export function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {Uint8Array} data @param {'deflate-raw'} fmt @param {boolean} compress */
async function stream(data, fmt, compress) {
  const S = compress ? globalThis.CompressionStream : globalThis.DecompressionStream;
  const s = new Blob([data]).stream().pipeThrough(new S(fmt));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const canDeflate = () => typeof globalThis.CompressionStream === 'function';

/**
 * Make a zip. Paths use forward slashes.
 * @param {Record<string, string | Uint8Array>} files @returns {Promise<Uint8Array>}
 */
export async function zip(files) {
  /** @type {Uint8Array[]} */
  const parts = [];
  /** @type {Uint8Array[]} */
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const path of Object.keys(files).sort()) {
    const raw = typeof files[path] === 'string' ? enc.encode(/** @type {string} */ (files[path])) : /** @type {Uint8Array} */ (files[path]);
    const name = enc.encode(path);
    const crc = crc32(raw);
    let body = raw, method = 0;
    if (canDeflate() && raw.length > 64) {
      const d = await stream(raw, 'deflate-raw', true);
      if (d.length < raw.length) { body = d; method = 8; }
    }
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, method, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true); local.setUint32(18, body.length, true); local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, method, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, raw.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

/** Is this the start of a zip file? @param {Uint8Array} data */
export const isZip = (data) => data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 3 && data[3] === 4;

/**
 * Read a zip. Returns every file (folders and macOS metadata are skipped).
 * @param {Uint8Array} data @returns {Promise<Record<string, Uint8Array>>}
 */
export async function unzip(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a zip file, or it is damaged');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  /** @type {Record<string, Uint8Array>} */
  const out = {};
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('The zip file is damaged');
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const localAt = v.getUint32(p + 42, true);
    const name = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').pop()?.startsWith('._')) continue;
    if (name.includes('..') || name.startsWith('/')) throw new Error(`The zip has an unsafe path: ${name}`);
    const lNameLen = v.getUint16(localAt + 26, true), lExtra = v.getUint16(localAt + 28, true);
    const start = localAt + 30 + lNameLen + lExtra;
    const body = data.subarray(start, start + size);
    if (method === 0) out[name] = body.slice();
    else if (method === 8) out[name] = await stream(body, 'deflate-raw', false);
    else throw new Error(`${name} uses a compression this browser cannot read`);
  }
  return out;
}

/**
 * Text files from a zip, with a single top folder (if every path shares one) taken off.
 * @param {Record<string, Uint8Array>} entries @returns {Record<string, string>}
 */
export function textFiles(entries) {
  const paths = Object.keys(entries);
  const tops = new Set(paths.map((x) => (x.includes('/') ? x.split('/')[0] : '')));
  const strip = tops.size === 1 && !tops.has('') && !paths.some((x) => x.startsWith('.loom/')) ? [...tops][0].length + 1 : 0;
  /** @type {Record<string, string>} */
  const out = {};
  for (const x of paths) out[x.slice(strip)] = dec.decode(entries[x]);
  return out;
}
