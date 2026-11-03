import { Reader } from "./reader.ts";

export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/**
 * The game's ".pcx" files are not real PCX: a 12-byte header (size, width,
 * height) followed by either 8-bit indices + 768-byte palette or 24-bit BGR.
 */
export function decodePcx(bytes: Uint8Array): RgbaImage {
  const r = new Reader(bytes);
  const size = r.u32();
  const width = r.u32();
  const height = r.u32();
  const n = width * height;
  const rgba = new Uint8ClampedArray(n * 4);
  const data = bytes.subarray(12);
  if (size === n * 3) {
    for (let i = 0; i < n; i++) {
      rgba[i * 4] = data[i * 3 + 2];
      rgba[i * 4 + 1] = data[i * 3 + 1];
      rgba[i * 4 + 2] = data[i * 3];
      rgba[i * 4 + 3] = 255;
    }
  } else {
    const pal = data.subarray(n, n + 768);
    // Cyan in slot 0 is the colour key, as with sprites.
    const keyed = pal[0] === 0 && pal[1] === 255 && pal[2] === 255;
    for (let i = 0; i < n; i++) {
      const p = data[i];
      rgba[i * 4] = pal[p * 3];
      rgba[i * 4 + 1] = pal[p * 3 + 1];
      rgba[i * 4 + 2] = pal[p * 3 + 2];
      rgba[i * 4 + 3] = keyed && p === 0 ? 0 : 255;
    }
  }
  return { width, height, rgba };
}

/** Uncompressed 8/24/32-bit BMP (a few interface images ship as BMP). */
export function decodeBmp(bytes: Uint8Array): RgbaImage {
  const r = new Reader(bytes);
  if (r.u16() !== 0x4d42) throw new Error("not a BMP");
  r.pos = 10;
  const dataOffset = r.u32();
  const headerSize = r.u32();
  const width = r.i32();
  const rawHeight = r.i32();
  r.skip(2);
  const bpp = r.u16();
  const height = Math.abs(rawHeight);
  const palette = bytes.subarray(14 + headerSize, dataOffset);
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = dataOffset + (rawHeight > 0 ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bpp === 8) {
        const p = bytes[srcRow + x] * 4;
        rgba[o] = palette[p + 2];
        rgba[o + 1] = palette[p + 1];
        rgba[o + 2] = palette[p];
      } else {
        const s = srcRow + x * (bpp / 8);
        rgba[o] = bytes[s + 2];
        rgba[o + 1] = bytes[s + 1];
        rgba[o + 2] = bytes[s];
      }
      rgba[o + 3] = 255;
    }
  }
  return { width, height, rgba };
}
