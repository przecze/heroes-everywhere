/** 256 RGBA entries. */
export type Palette = Uint8Array;

// Marker colours the original art uses for palette slots 0..7, and what they mean.
const MARKERS = [
  [0, 255, 255],
  [255, 150, 255],
  [255, 100, 255],
  [255, 50, 255],
  [255, 0, 255],
  [255, 255, 0],
  [180, 0, 255],
  [0, 255, 0],
];
const SPECIAL_ALPHA = [0, 64, 64, 128, 128, 0, 128, 64];

/** Index of the selection outline / owner-flag slot. */
export const SELECTION_INDEX = 5;

/** Turns the marker slots into transparent black (with shadow alpha). Slot 0 is always transparent. */
export function applySpecialColors(palette: Palette): void {
  palette[0] = palette[1] = palette[2] = palette[3] = 0;
  for (let i = 0; i < MARKERS.length; i++) {
    const [r, g, b] = MARKERS[i];
    const o = i * 4;
    // Some sprites store the markers slightly off (151 instead of 150, 183 instead of 180).
    const near = (a: number, b: number) => Math.abs(a - b) <= 4;
    if (near(palette[o], r) && near(palette[o + 1], g) && near(palette[o + 2], b)) {
      palette[o] = palette[o + 1] = palette[o + 2] = 0;
      palette[o + 3] = SPECIAL_ALPHA[i];
    }
  }
}

/** Expands indexed pixels to RGBA. */
export function indexedToRgba(pixels: Uint8Array, palette: Palette): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i] * 4;
    out[i * 4] = palette[p];
    out[i * 4 + 1] = palette[p + 1];
    out[i * 4 + 2] = palette[p + 2];
    out[i * 4 + 3] = palette[p + 3];
  }
  return out;
}

/** Player colour ramps live in PLAYERS.PAL: 8 players x 32 RGB colours, mapped onto indices 224..255. */
export function playerPalette(base: Palette, playersPal: Uint8Array, player: number): Palette {
  const out = base.slice();
  // PLAYERS.PAL is a RIFF palette; colour data starts at byte 24, 4 bytes per entry.
  const start = 24 + player * 32 * 4;
  for (let i = 0; i < 32; i++) {
    const o = (224 + i) * 4;
    out[o] = playersPal[start + i * 4];
    out[o + 1] = playersPal[start + i * 4 + 1];
    out[o + 2] = playersPal[start + i * 4 + 2];
  }
  return out;
}
