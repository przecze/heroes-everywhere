// Battlefield: 17 x 11 hexes, even rows shifted half a hex to the right.
// Columns 0 and 16 belong to heroes / war machines; units can't stand there.

export const FIELD_WIDTH = 17;
export const FIELD_HEIGHT = 11;
export const HEX_COUNT = FIELD_WIDTH * FIELD_HEIGHT;

export const hexCol = (h: number) => h % FIELD_WIDTH;
export const hexRow = (h: number) => Math.floor(h / FIELD_WIDTH);
export const hexAt = (col: number, row: number) => row * FIELD_WIDTH + col;

export function isPlayable(col: number, row: number): boolean {
  return col >= 1 && col <= FIELD_WIDTH - 2 && row >= 0 && row < FIELD_HEIGHT;
}

const EVEN_ROW = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
const ODD_ROW = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];

/** Playable neighbours. */
export function neighbours(h: number): number[] {
  const col = hexCol(h);
  const row = hexRow(h);
  const out: number[] = [];
  for (const [dc, dr] of row % 2 === 0 ? EVEN_ROW : ODD_ROW) {
    if (isPlayable(col + dc, row + dr)) out.push(hexAt(col + dc, row + dr));
  }
  return out;
}

export function hexDistance(a: number, b: number): number {
  const ra = hexRow(a);
  const rb = hexRow(b);
  const qa = hexCol(a) - ((ra + (ra & 1)) >> 1);
  const qb = hexCol(b) - ((rb + (rb & 1)) >> 1);
  const dq = qa - qb;
  const dr = ra - rb;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Axial coordinates, for straight-line hex math. */
function toAxial(h: number): { q: number; r: number } {
  const r = hexRow(h);
  return { q: hexCol(h) - ((r + (r & 1)) >> 1), r };
}

function fromAxial(q: number, r: number): number {
  const col = q + ((r + (r & 1)) >> 1);
  return isPlayable(col, r) ? hexAt(col, r) : -1;
}

/** The hex after `to` on the line from `from` through `to` (dragon breath), or -1. */
export function hexBeyond(from: number, to: number): number {
  const a = toAxial(from);
  const b = toAxial(to);
  return fromAxial(2 * b.q - a.q, 2 * b.r - a.r);
}

/**
 * The six sides of a hex, clockwise from the top left (VCMI's BattleHex::EDir: 0 top left, 1 top right, 2 right,
 * 3 bottom right, 4 bottom left, 5 left).
 */
const SIDES_EVEN = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 0]];
const SIDES_ODD = [[-1, -1], [0, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];

/** The hex on side `dir` (0-5, as above) of `h`, or -1 off the field. */
export function hexToward(h: number, dir: number): number {
  if (h < 0) return -1;
  const [dc, dr] = (hexRow(h) % 2 === 0 ? SIDES_EVEN : SIDES_ODD)[((dir % 6) + 6) % 6];
  const col = hexCol(h) + dc;
  const row = hexRow(h) + dr;
  return isPlayable(col, row) ? hexAt(col, row) : -1;
}

/** Which side of `from` the neighbouring hex `to` is on (0-5), or -1 when they don't touch. */
export function sideOf(from: number, to: number): number {
  for (let d = 0; d < 6; d++) if (hexToward(from, d) === to) return d;
  return -1;
}
