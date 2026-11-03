import { randInt } from "../rng.ts";
import type { HasRng } from "../rng.ts";
import { FIELD_WIDTH, HEX_COUNT, hexCol, hexRow } from "./hex.ts";

// Battlefield and obstacle tables (footprints, art, which terrain allows which obstacle): made in packages/vcmi-data
// from VCMI's and the HotA mod's configs. Blocked tiles are hex offsets from the obstacle's position; absolute
// obstacles list hexes directly.
import { BATTLEFIELD_LIST, type Battlefield, OBSTACLES, type ObstacleType } from "../../../vcmi-data/src/battlefields.ts";

export { type Battlefield, OBSTACLES, type ObstacleType };

const BY_ID = new Map(OBSTACLES.map((o) => [o.id, o]));
/** An obstacle by its id (the table skips ids: the big cliffs start at 100). */
export function obstacleType(id: number): ObstacleType | undefined {
  return BY_ID.get(id);
}

const FIELD_TERRAIN: Record<string, string> = {
  "dirt_birches": "dirt",
  "dirt_hills": "dirt",
  "dirt_pines": "dirt",
  "sand_mesas": "sand",
  "grass_hills": "grass",
  "grass_pines": "grass",
  "snow_mountains": "snow",
  "snow_trees": "snow",
  "swamp_trees": "swamp",
  "rough": "rough",
  "subterranean": "subterra",
  "lava": "lava",
  "ship": "water",
  "rocklands": "rock",
  "highlands_flowers": "highlands",
  "wasteland_rocks": "wasteland",
  "swamp_grass": "swamp",
  "swamp_dead": "swamp",
  "sand_cave": "sand",
  "lava_cave": "lava",
};

export const BATTLEFIELDS: Battlefield[] = BATTLEFIELD_LIST.map((f): Battlefield => ({ ...f, terrain: FIELD_TERRAIN[f.id] }));


export interface PlacedObstacle {
  type: number;
  /** Anchor hex; unused (-1) for absolute obstacles. */
  pos: number;
}

/** Hexes an obstacle covers when anchored at `pos`. */
export function obstacleHexes(o: ObstacleType, pos: number): number[] {
  if (o.absolute) return o.blocked;
  return o.blocked.map((offset) => {
    let h = pos + offset;
    // Offsets are written for even rows; odd rows sit half a hex further left.
    if (hexRow(pos) % 2 === 1 && hexRow(h) % 2 === 0) h -= 1;
    return h;
  });
}

function suits(o: ObstacleType, field: Battlefield): boolean {
  // The beach is fought on any ground beside water and has its own set (skeletons, shells, the
  // shore's cliffs), as the original flags obstacles by field; VCMI picks the ground's set there.
  if (field.special || field.id === "sand_shore") return o.special.includes(field.id);
  return !!field.terrain && o.terrains.includes(field.terrain);
}

function pick<T>(rng: HasRng, items: T[]): T | undefined {
  return items.length ? items[randInt(rng, 0, items.length - 1)] : undefined;
}

/**
 * Random obstacles like the original: 5-12 hexes' worth, sometimes one big
 * "absolute" cliff, never in the deployment columns.
 */
export function placeObstacles(rng: HasRng, field: Battlefield): PlacedObstacle[] {
  const placed: PlacedObstacle[] = [];
  const taken = new Set<number>(field.impassable ?? []);
  let toBlock = randInt(rng, 5, 12);

  if (randInt(rng, 1, 100) <= 40) {
    const big = pick(rng, OBSTACLES.filter((o) => o.absolute && suits(o, field)));
    if (big) {
      placed.push({ type: big.id, pos: -1 });
      for (const h of big.blocked) taken.add(h);
      toBlock -= Math.floor(big.blocked.length / 2);
    }
  }

  const usual = OBSTACLES.filter((o) => !o.absolute && suits(o, field));
  for (let guard = 0; toBlock > 0 && guard < 50; guard++) {
    const o = pick(rng, usual);
    if (!o) break;
    const valid = (pos: number) => {
      if (o.height >= hexRow(pos) || hexCol(pos) === 0 || hexCol(pos) + o.width > 15 || taken.has(pos)) return false;
      return obstacleHexes(o, pos).every((h) => h >= 0 && h < HEX_COUNT && !taken.has(h) && hexCol(h) > 2 && hexCol(h) < 14);
    };
    const candidates: number[] = [];
    for (let p = 18; p <= 168; p++) if (valid(p)) candidates.push(p);
    const pos = pick(rng, candidates);
    if (pos === undefined) continue;
    placed.push({ type: o.id, pos });
    for (const h of obstacleHexes(o, pos)) taken.add(h);
    toBlock -= o.blocked.length;
  }
  return placed;
}

export function blockedHexes(field: Battlefield, obstacles: PlacedObstacle[]): number[] {
  const out = new Set<number>(field.impassable ?? []);
  for (const p of obstacles) {
    const o = obstacleType(p.type);
    if (o) for (const h of obstacleHexes(o, p.pos)) out.add(h);
  }
  return [...out].filter((h) => h >= 0 && h < FIELD_WIDTH * 11);
}
