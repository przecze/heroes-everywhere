import { Reader } from "./reader.ts";
import { type Palette, applySpecialColors } from "./palette.ts";

export const DefType = {
  Spell: 0x40,
  Sprite: 0x41,
  Creature: 0x42,
  AdventureObject: 0x43,
  AdventureHero: 0x44,
  Terrain: 0x45,
  Cursor: 0x46,
  Interface: 0x47,
  SpriteFrame: 0x48,
  BattleHero: 0x49,
} as const;

/**
 * A frame as palette indices. Only the stored rectangle is kept;
 * (x, y) places it on the full fullWidth x fullHeight canvas.
 */
export interface DefFrame {
  name: string;
  fullWidth: number;
  fullHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface Def {
  type: number;
  width: number;
  height: number;
  palette: Palette;
  /** Animation groups keyed by group id; ids are often sparse. */
  groups: Map<number, DefFrame[]>;
}

/**
 * Decodes a DEF animation. Frames share one palette; indices 0..7 are
 * special (transparency, shadow, selection) and mapped to RGBA here.
 */
export function decodeDef(bytes: Uint8Array): Def {
  const r = new Reader(bytes);
  const type = r.u32();
  const width = r.u32();
  const height = r.u32();
  const blockCount = r.u32();
  // Not a DEF (a web page answered for a missing file): its counts would run to billions.
  const notDef = () => new Error(`not a DEF file (${bytes.length} bytes)`);
  if (bytes.length < 16 + 768 || blockCount * 16 > bytes.length) throw notDef();
  const palette: Palette = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    palette[i * 4] = r.u8();
    palette[i * 4 + 1] = r.u8();
    palette[i * 4 + 2] = r.u8();
    palette[i * 4 + 3] = 255;
  }
  applySpecialColors(palette);

  const groups = new Map<number, DefFrame[]>();
  const cache = new Map<number, DefFrame>();
  for (let b = 0; b < blockCount; b++) {
    const id = r.u32();
    const count = r.u32();
    r.skip(8);
    if (r.pos + count * 17 > bytes.length) throw notDef();
    const names: string[] = [];
    for (let i = 0; i < count; i++) names.push(r.fixedString(13));
    const frames: DefFrame[] = [];
    for (let i = 0; i < count; i++) {
      const offset = r.u32();
      let frame = cache.get(offset);
      if (!frame) {
        frame = decodeFrame(bytes, offset, names[i]);
        cache.set(offset, frame);
      }
      frames.push(frame);
    }
    groups.set(id, frames);
  }
  return { type, width, height, palette, groups };
}

function decodeFrame(bytes: Uint8Array, offset: number, name: string): DefFrame {
  const r = new Reader(bytes, offset);
  r.skip(4); // size
  const format = r.u32();
  const fullWidth = r.u32();
  const fullHeight = r.u32();
  const width = r.u32();
  const height = r.u32();
  const x = r.i32();
  const y = r.i32();
  const base = r.pos;
  const pixels = new Uint8Array(width * height);

  let row = 0;
  let col = 0;
  const putRun = (src: Uint8Array | number, len: number, at = 0) => {
    const o = row * width;
    for (let k = 0; k < len && col < width; k++, col++) {
      pixels[o + col] = typeof src === "number" ? src : src[at + k];
    }
  };

  // Formats 2 and 3 pack (code, length) into one byte; code 7 means raw bytes follow.
  const readPackedRow = (p: number): number => {
    col = 0;
    while (col < width) {
      const seg = bytes[p++];
      const code = seg >> 5;
      const len = (seg & 31) + 1;
      if (code === 7) {
        putRun(bytes, len, p);
        p += len;
      } else {
        putRun(code, len);
      }
    }
    return p;
  };

  switch (format) {
    case 0:
      for (row = 0; row < height; row++) {
        col = 0;
        putRun(bytes, width, base + row * width);
      }
      break;
    case 1:
      for (row = 0; row < height; row++) {
        let p = base + r.view.getUint32(base + row * 4, true);
        col = 0;
        while (col < width) {
          const code = bytes[p++];
          const len = bytes[p++] + 1;
          if (code === 0xff) {
            putRun(bytes, len, p);
            p += len;
          } else {
            putRun(code, len);
          }
        }
      }
      break;
    case 2: {
      let p = base + r.view.getUint16(base, true);
      for (row = 0; row < height; row++) p = readPackedRow(p);
      break;
    }
    case 3: {
      const blocksPerRow = width >> 5;
      for (row = 0; row < height; row++) {
        readPackedRow(base + r.view.getUint16(base + row * 2 * blocksPerRow, true));
      }
      break;
    }
    default:
      throw new Error(`unknown DEF frame format ${format}`);
  }
  return { name, fullWidth, fullHeight, x, y, width, height, pixels };
}
