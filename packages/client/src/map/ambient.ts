// The adventure map's ambient loops, as VCMI's MapAudioPlayer and config/ambientSounds.json: the
// objects around the selected hero (it follows the selection, not the scrolled view), at most three
// tiles away (counted as a king moves), at a fifth of the effects' volume on the hero's own tile and
// fading by 100 / 90 / 60 / 30 % a tile; never one the player hasn't uncovered yet (a loop from the
// shroud would give away what's there). A visitable object sounds from its entrance, any other from
// the tiles it blocks. With EXTRAS ambientNearOnly (2026-11-01: the Mystical Garden kept playing two
// tiles off, with a town selected, through the enemy's turn) only what the selected hero stands at, on your turn.
import { OBJECT_SOUNDS } from "./sounds.ts";

type Placed = { type: number; subid: number; x: number; y: number; z: number; removed?: boolean; visit?: number[]; block?: number[] };

/** How far a loop carries (tiles, Chebyshev distance). */
export const AMBIENT_RANGE = 3;
/** The volume by distance (0 = the hero's own tile), as a share of the effects' volume. */
const VOLUME = 0.2;
const BY_DISTANCE = [1, 0.9, 0.6, 0.3];

/** An object's ambient loop, if it has one. */
export function ambientLoop(o: { type: number; subid: number }): string | undefined {
  return (OBJECT_SOUNDS[`${o.type}:${o.subid}`] ?? OBJECT_SOUNDS[o.type])?.ambient?.[0];
}

/** The tiles a loop comes from: the entrance of a visitable object, else the tiles it blocks (else its corner). */
export function soundTiles(o: Placed): [number, number][] {
  // (Masks: bit j of byte i = tile (x+j-7, y+i-5); visit bit 1 = an entrance, block bit 0 = blocked.)
  const tiles = (mask: number[] | undefined, on: boolean) => {
    const out: [number, number][] = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 8; j++) if (!!((mask?.[i] ?? (on ? 0 : 255)) & (1 << j)) === on) out.push([o.x + j - 7, o.y + i - 5]);
    return out;
  };
  const entrance = tiles(o.visit, true);
  if (entrance.length) return entrance.slice(0, 1);
  const blocked = o.block ? tiles(o.block, false) : [];
  return blocked.length ? blocked : [[o.x, o.y]];
}

/** The loops to play around `at` and their volumes: each loop at its nearest object's distance, only from explored tiles. */
export function ambientLevels(objects: Placed[], at: { x: number; y: number; z: number }, explored: (x: number, y: number, z: number) => boolean, visitOnly = false): Map<string, number> {
  const nearest = new Map<string, number>();
  for (const o of objects) {
    if (o.removed || o.z !== at.z || Math.abs(o.x - at.x) > AMBIENT_RANGE + 8 || Math.abs(o.y - at.y) > AMBIENT_RANGE + 6) continue;
    const loop = ambientLoop(o);
    if (!loop) continue;
    // (visitOnly, EXTRAS ambientNearOnly: a visitable object only with the hero on its entrance, scenery from next to it.)
    const range = visitOnly ? (o.visit?.some((b) => b) ? 0 : 1) : AMBIENT_RANGE;
    for (const [x, y] of soundTiles(o)) {
      const d = Math.max(Math.abs(x - at.x), Math.abs(y - at.y));
      if (d <= range && d < (nearest.get(loop) ?? Infinity) && explored(x, y, o.z)) nearest.set(loop, d);
    }
  }
  return new Map([...nearest].map(([loop, d]) => [loop, VOLUME * BY_DISTANCE[d]]));
}
