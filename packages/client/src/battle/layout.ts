import { hexCol, hexRow } from "@heroes/core";

// Screen geometry of the original 800x600 battle screen.
export const SCREEN_W = 800;
export const SCREEN_H = 600;
export const BAR_Y = 556;

/**
 * Top-left of a hex cell image (ccellgrd.pcx is 45x52), as VCMI's hexPositionLocal: the playable
 * hexes span x 58-741, centred on the screen; the absolute obstacles' blocked hexes (obdtl06,
 * obgrl01...) line up with their art only on this grid.
 */
export function cellOrigin(hex: number): { x: number; y: number } {
  const col = hexCol(hex);
  const row = hexRow(hex);
  return { x: 14 + 44 * col + (row % 2 === 0 ? 22 : 0), y: 86 + 42 * row };
}

export function hexCenter(hex: number): { x: number; y: number } {
  const o = cellOrigin(hex);
  return { x: o.x + 22, y: o.y + 26 };
}

/** Hex under a screen point, or -1. */
export function hexAtPoint(px: number, py: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let h = 0; h < 17 * 11; h++) {
    const c = hexCenter(h);
    const d = (c.x - px) ** 2 + (c.y - py) ** 2;
    if (d < bestD) [best, bestD] = [h, d];
  }
  return bestD <= 26 * 26 ? best : -1;
}

// Where a hex centre falls on a creature DEF's 450x400 canvas: VCMI's getStackPositionAtHex puts the
// canvas at (-189 + 29, -139) from the hex grid's corner, i.e. the hex centre at (196, 251) (a mirrored
// canvas one pixel less, 449 - 254).
export const CREATURE_ANCHOR = { x: 196, y: 251 };

/** Upright: the part of the battle screen drawn across the width (the hexes, without the heroes). */
// (12 more to the left than to the right: the left side's war machines and tents stand further out.)
export let CROP_X = 40;
export let CROP_W = 700;
/**
 * A siege: the crop reaches the field's right edge, so the keep behind the walls (its picture from x 720 on) is whole
 * (2026-10-27 18:14: "the big tower in the back hidden"); the field a little smaller. True when it changed.
 */
export function cropForSiege(siege: boolean): boolean {
  const w = siege ? SCREEN_W - CROP_X : 700;
  if (w === CROP_W) return false;
  CROP_W = w;
  return true;
}

/** A stack's drawing order on its hex: lower rows in front, then left to right. */
export const depthOf = (hex: number) => hexRow(hex) * 100 + (hex % 17);
