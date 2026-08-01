// foil/png.ts — minimal pure-JS PNG codec for the foil-mask dev surface.
//
// The api deliberately pulls in no native image addon (no sharp/libvips —
// see scan/phash.ts and export/pdf.ts for the precedent), and the mask
// artifacts are tiny (490×674 RGBA ≈ 1.3 MB raw), so a zlib-backed codec in
// ~150 lines is the cheapest honest option. Scope is exactly what the mask
// pipeline produces and consumes:
//   decode: 8-bit, non-interlaced, color types 0 (gray), 2 (RGB),
//           4 (gray+alpha), 6 (RGBA) — covers every canvas.toDataURL PNG.
//   encode: 8-bit RGBA, filter 0, one IDAT.
// Anything else (16-bit, palette, interlace) throws — the callers treat that
// as a bad upload, not a case to support.

import { deflateSync, inflateSync } from 'node:zlib';

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA8, length = width * height * 4. */
  rgba: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ── CRC32 (standard PNG polynomial) ────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── Decode ─────────────────────────────────────────────────────────────────

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buf: Buffer): RgbaImage {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported');
      if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} unsupported`);
      if (!(colorType in CHANNELS)) throw new Error(`color type ${colorType} unsupported`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (!width || !height || idat.length === 0) throw new Error('truncated PNG');

  const ch = CHANNELS[colorType]!;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  if (raw.length < (stride + 1) * height) throw new Error('PNG data short');

  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1);
    const filter = raw[rowOff]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[rowOff + 1 + x]!;
      const left = x >= ch ? line[x - ch]! : 0;
      const up = prev[x]!;
      const ul = x >= ch ? prev[x - ch]! : 0;
      let out: number;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + left; break;
        case 2: out = v + up; break;
        case 3: out = v + ((left + up) >> 1); break;
        case 4: out = v + paeth(left, up, ul); break;
        default: throw new Error(`bad filter ${filter}`);
      }
      line[x] = out & 0xff;
    }
    // expand to RGBA
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const i = x * ch;
      switch (colorType) {
        case 0: rgba[o] = rgba[o + 1] = rgba[o + 2] = line[i]!; rgba[o + 3] = 255; break;
        case 2: rgba[o] = line[i]!; rgba[o + 1] = line[i + 1]!; rgba[o + 2] = line[i + 2]!; rgba[o + 3] = 255; break;
        case 4: rgba[o] = rgba[o + 1] = rgba[o + 2] = line[i]!; rgba[o + 3] = line[i + 1]!; break;
        case 6: rgba[o] = line[i]!; rgba[o + 1] = line[i + 1]!; rgba[o + 2] = line[i + 2]!; rgba[o + 3] = line[i + 3]!; break;
      }
    }
    prev.set(line);
  }
  return { width, height, rgba };
}

// ── Encode ─────────────────────────────────────────────────────────────────

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(img: RgbaImage): Buffer {
  const { width, height, rgba } = img;
  if (rgba.length !== width * height * 4) throw new Error('rgba length mismatch');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // compression 0, filter 0, interlace 0 (already zeroed)

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height); // filter byte 0 per row
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
