// Where a shooter's missile leaves it and on which frame of its shot: CRANIM.TXT for the original
// creatures (as VCMI's RangedAttackAnimation reads it), the HotA mod's "missile" blocks for HotA's own.
import { parseTxt } from "@heroes/formats";
import { fetchRes } from "../assets.ts";

export interface ShotOrigin {
  /** The shot's frame the missile flies on (1 = the first, as H3 counts). */
  climax: number;
  /** Offsets from the canvas point (222 - 25, 265), facing right: shooting up, ahead, down. */
  upper: [number, number];
  ahead: [number, number];
  lower: [number, number];
}

const shot = (climax: number, ux: number, uy: number, x: number, y: number, lx: number, ly: number): ShotOrigin => ({ climax, upper: [ux, uy], ahead: [x, y], lower: [lx, ly] });

/** HotA's shooters (ids as HotA's), from the mod's creature configs. */
const HOTA: Record<number, ShotOrigin> = {
  150: shot(4, 44, -63, 79, -55, 27, -46), // Cannon
  151: shot(6, 38, -93, 45, -64, 21, -35), // Sea Dogs
  157: shot(6, 38, -93, 45, -64, 21, -35), // Pirates
  158: shot(6, 38, -93, 45, -64, 21, -35), // Corsairs
  161: shot(9, 41, -72, 54, -75, 29, -14), // Sea Witches
  162: shot(8, 41, -72, 54, -75, 29, -14), // Sorceresses
  171: shot(10, 32, -77, 36, -36, 18, -55), // Halfling Grenadiers
  180: shot(6, 38, -99, 60, -78, 30, -58), // Gunslingers
  181: shot(7, 38, -85, 46, -70, 21, -60), // Bounty Hunters
  190: shot(5, 30, -60, 45, -50, 20, -20), // Snow Elves
  191: shot(5, 30, -60, 45, -50, 20, -20), // Steel Elves
  194: shot(6, 40, -57, 45, -50, 25, -20), // Shamans
  195: shot(6, 40, -57, 45, -50, 25, -20), // Great Shamans
};
/** HotA's redrawn Halflings shoot from lower down (the mod's patch of core:halfling). */
const HOTA_AHEAD: Record<number, [number, number]> = { 138: [36, -36] };

let table: Promise<ShotOrigin[]> | null = null;

/** The creature's shot origin (undefined when the game files have none for it). */
export async function shotOrigin(creature: number): Promise<ShotOrigin | undefined> {
  if (HOTA[creature]) return HOTA[creature];
  table ??= fetchRes("cranim.txt")
    .then((bytes) =>
      parseTxt(bytes)
        .slice(2)
        // (Blank rows part the towns, as in CRTRAITS.TXT.)
        .filter((r) => r.length > 20 && r[0]?.trim())
        .map((r) => {
          const n = (i: number) => Number(r[i]) || 0;
          return shot(n(23), n(4), n(5), n(6), n(7), n(8), n(9));
        }),
    )
    .catch(() => []);
  const o = (await table)[creature];
  if (!o) return undefined;
  const ahead = HOTA_AHEAD[creature];
  return ahead ? { ...o, ahead } : o;
}
