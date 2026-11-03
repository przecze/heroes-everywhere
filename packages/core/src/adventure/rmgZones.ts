// The random map generator's template side (rmgTemplates.ts reads the templates): where each zone
// goes, what a guard of some value is, and what treasure is worth.
//
// The values and the guard formula follow the original's generator as the community measured it
// (VCMI's random map generator reproduces it the same way): a treasure or a passage has a value, the
// zone's monster strength (and the map's) turns it into a guard's strength, and the guard is a stack
// of one creature whose AI values add up to that.
import type { CreatureStats } from "../creatures.ts";
import { type HasRng, random } from "../rng.ts";
import type { RmgConnection, RmgZone } from "./rmgTemplates.ts";

/** Zone monster strength: none (-1), weak, avg, strong (0..2). */
export function zoneStrength(z: RmgZone): number {
  return z.monsters === "none" ? -1 : z.monsters === "weak" ? 0 : z.monsters === "strong" ? 2 : 1;
}

/**
 * The guard's strength (in AI value) for a thing worth `value`: nothing under 2000. `map` is the
 * map's monster setting (0 weak, 1 normal, 2 strong); a passage between zones counts as an avg
 * zone's (its value is the template's own figure for the guard).
 */
export function guardStrength(value: number, zone: number, map: number, passage = false): number {
  if (zone < 0 && !passage) return 0;
  const k = Math.max(0, Math.min(4, (passage ? 1 : zone) + map));
  const v1 = [2500, 1500, 1000, 500, 0][k];
  const v2 = [7500, 7500, 7500, 5000, 5000][k];
  const m1 = [0.5, 0.75, 1, 1.5, 1.5][k];
  const m2 = [0.5, 0.75, 1, 1, 1.5][k];
  const s = Math.max(0, (value - v1) * m1) + Math.max(0, (value - v2) * m2);
  return s < 2000 ? 0 : Math.round(s);
}

/** How many of a creature a map stack usually holds (CRTRAITS's adventure map low..high), by level when unknown. */
function usualStack(c: CreatureStats): number {
  if (c.mapStack) return (c.mapStack[0] + c.mapStack[1]) / 2;
  return [30, 35, 23, 18, 15, 10, 6, 2.5][c.level] ?? 10;
}

/** Factions in RMG.TXT's monster columns (after Neutral): Castle .. Conflux ("Forge"). */
const RMG_FACTIONS = ["castle", "rampart", "tower", "inferno", "necropolis", "dungeon", "stronghold", "fortress", "conflux"];

/**
 * A guard of `strength`: one creature (of the allowed factions: bit 0 neutral, then Castle ..
 * Conflux; HotA's own towns' creatures whenever most factions are allowed) of which at least one
 * whole stack fits, and no more than a hundred of it.
 */
export function chooseGuard(rng: HasRng, creatures: CreatureStats[], strength: number, factions: number, has: (id: number) => boolean): { creature: number; count: number } | null {
  if (strength <= 0) return null;
  let allowed = 0;
  for (let b = 0; b < 10; b++) if (factions & (1 << b)) allowed++;
  const ok = (c: CreatureStats) => {
    if (c.faction === "neutral") return !!(factions & 1);
    const k = RMG_FACTIONS.indexOf(c.faction);
    return k >= 0 ? !!(factions & (1 << (k + 1))) : allowed >= 6;
  };
  const pool = creatures.filter((c) => c.level >= 1 && c.aiValue > 0 && c.def && has(c.id) && ok(c) && c.aiValue * usualStack(c) < strength && strength < c.aiValue * 100);
  // None fits: the strongest creature that does any (a strong guard of something small).
  const list = pool.length ? pool : creatures.filter((c) => c.level >= 1 && c.aiValue > 0 && c.def && has(c.id) && ok(c) && c.aiValue <= strength).sort((a, b) => b.aiValue - a.aiValue).slice(0, 1);
  if (!list.length) return null;
  const c = list[Math.floor(random(rng) * list.length)];
  let count = Math.floor(strength / c.aiValue);
  if (count >= 4) count = Math.floor((count * 3) / 4 + random(rng) * ((count * 5) / 4 - (count * 3) / 4 + 1));
  return { creature: c.id, count: Math.max(1, count) };
}

/** Something a zone's treasure can be: an object (and subtype), its value, how common it is, at most so many per zone. */
export interface Treasure {
  id: number;
  sub?: number;
  value: number;
  rarity: number;
  zoneLimit?: number;
  /** Data for the object (a random dwelling's levels). */
  data?: Record<string, unknown>;
  /** Brings its own guards (creature banks): no guard in front. */
  guarded?: boolean;
}

/** The treasure the generator draws from (land objects). */
export const TREASURES: Treasure[] = [
  // Resources and pickups.
  { id: 79, sub: 0, value: 1400, rarity: 300 },
  { id: 79, sub: 2, value: 1400, rarity: 300 },
  ...[1, 3, 4, 5].map((sub) => ({ id: 79, sub, value: 2000, rarity: 300 })),
  { id: 79, sub: 6, value: 750, rarity: 300 },
  { id: 76, value: 1500, rarity: 2000 },
  { id: 101, value: 1500, rarity: 1000 },
  { id: 12, value: 2000, rarity: 500 },
  // Random artifacts: treasure, minor, major, relic.
  { id: 66, value: 2000, rarity: 150 },
  { id: 67, value: 5000, rarity: 150 },
  { id: 68, value: 10000, rarity: 150 },
  { id: 69, value: 20000, rarity: 150 },
  // Random dwellings, by level (each zone values them by its own town's creatures, see rmg.ts).
  ...[1, 2, 3, 4, 5, 6, 7].map((level) => ({ id: 216, value: [0, 1500, 2500, 3500, 5000, 7000, 9500, 13000][level], rarity: 40, data: { minLevel: level - 1, maxLevel: level - 1 } })),
  // Pandora's Boxes of gold and of experience, and spell scrolls (VCMI's values for the original's generator).
  ...[1, 2, 3, 4].map((i) => ({ id: 6, value: i * 5000, rarity: 5, data: { resources: [0, 0, 0, 0, 0, 0, i * 5000] } })),
  ...[1, 2, 3, 4].map((i) => ({ id: 6, value: i * 6000, rarity: 20, data: { experience: i * 5000 } })),
  ...[500, 2000, 3000, 4000, 5000].map((value, i) => ({ id: 93, value, rarity: 30, data: { level: i + 1 } })),
  // Pandora's Boxes of spells: 12 of a level, 15 of a school, 60 of all (the spells drawn as the box is placed, see rmg.ts).
  ...[1, 2, 3, 4, 5].map((level) => ({ id: 6, value: (level + 1) * 2500, rarity: 2, data: { spellLevel: level } })),
  ...[0, 1, 2, 3].map((school) => ({ id: 6, value: 15000, rarity: 2, data: { spellSchool: school } })),
  { id: 6, value: 30000, rarity: 2, data: { spellCount: 60 } },
  // Prisons, a hero of 1, 5, 10, 20 or 30 levels (the hero drawn when freed).
  ...[2500, 5000, 10000, 20000, 30000].map((value, i) => ({ id: 62, value, rarity: 30, zoneLimit: Math.ceil(5 / (i + 1)), data: { experience: [0, 5000, 15000, 90000, 500000][i] } })),
  // Places to visit.
  { id: 112, value: 1500, rarity: 80 }, // windmill
  { id: 109, value: 750, rarity: 50 }, // water wheel
  { id: 55, value: 500, rarity: 50 }, // mystical garden
  { id: 39, value: 500, rarity: 100 }, // lean-to
  { id: 22, value: 500, rarity: 100 }, // corpse
  { id: 105, value: 500, rarity: 50 }, // wagon
  { id: 108, value: 6000, rarity: 20 }, // warrior's tomb
  { id: 4, value: 3000, rarity: 50 }, // arena
  { id: 23, value: 1500, rarity: 100 }, // Marletto Tower
  { id: 32, value: 1500, rarity: 100 }, // Garden of Revelation
  { id: 41, value: 12000, rarity: 20 }, // Library of Enlightenment
  { id: 51, value: 1500, rarity: 100 }, // mercenary camp
  { id: 61, value: 1500, rarity: 100 }, // Star Axis
  { id: 102, value: 2500, rarity: 50 }, // Tree of Knowledge
  { id: 47, value: 1000, rarity: 50 }, // School of Magic
  { id: 107, value: 1000, rarity: 50 }, // School of War
  { id: 100, value: 1500, rarity: 200 }, // learning stone
  { id: 113, value: 1500, rarity: 80 }, // witch hut
  { id: 81, value: 1500, rarity: 50 }, // scholar
  { id: 88, value: 500, rarity: 100 }, // shrine of magic incantation
  { id: 89, value: 2000, rarity: 100 }, // shrine of magic gesture
  { id: 90, value: 3000, rarity: 100 }, // shrine of magic thought
  { id: 104, value: 2500, rarity: 20, zoneLimit: 1 }, // university
  { id: 99, value: 100, rarity: 100, zoneLimit: 1 }, // trading post
  { id: 7, value: 8000, rarity: 20 }, // Black Market
  { id: 2, value: 100, rarity: 20, zoneLimit: 1 }, // Altar of Sacrifice
  { id: 213, value: 100, rarity: 100, zoneLimit: 1 }, // Freelancer's Guild
  { id: 57, value: 3500, rarity: 200, zoneLimit: 1 }, // obelisk
  { id: 106, value: 1500, rarity: 50, zoneLimit: 1 }, // war machine factory
  { id: 78, value: 5000, rarity: 20 }, // refugee camp
  { id: 35, value: 7000, rarity: 20, zoneLimit: 1 }, // hill fort
  { id: 95, value: 100, rarity: 20, zoneLimit: 1 }, // tavern
  { id: 80, value: 100, rarity: 50, zoneLimit: 1 }, // sanctuary
  { id: 97, value: 100, rarity: 100, zoneLimit: 1 }, // den of thieves
  // Bonuses for the next battle (one of each per zone).
  ...[14, 28, 30, 31, 38, 56, 96, 64].map((id) => ({ id, value: 100, rarity: 100, zoneLimit: 1 })),
  { id: 94, value: 200, rarity: 40, zoneLimit: 1 }, // stables
  { id: 110, value: 500, rarity: 50, zoneLimit: 1 }, // watering hole
  { id: 49, value: 250, rarity: 100, zoneLimit: 1 }, // magic well
  // Creature banks (their own guards).
  ...[[0, 3000], [1, 2000], [2, 2000], [3, 5000], [4, 1500], [5, 3000], [6, 9000]].map(([sub, value]) => ({ id: 16, sub, value, rarity: 100, guarded: true })),
  { id: 85, value: 2000, rarity: 100, guarded: true }, // shipwreck
  { id: 84, value: 1000, rarity: 100, guarded: true }, // crypt
  { id: 25, value: 10000, rarity: 100, guarded: true }, // Dragon Utopia
  { id: 63, value: 8000, rarity: 50, guarded: true }, // pyramid
];

/** A Pandora's Box of creatures worth about this much: how many (VCMI's creatureToCount: rounded to 2, 5 or 10 as they grow). */
export const PANDORA_CREATURE_VALUES = [5000, 7000, 9000, 12000, 16000, 21000, 27000];
export function pandoraCount(level: number, aiValue: number): number {
  if (!aiValue) return 0;
  const n = Math.floor(PANDORA_CREATURE_VALUES[Math.min(level, PANDORA_CREATURE_VALUES.length) - 1] / aiValue);
  return n < 1 ? 0 : n <= 5 ? n : n <= 12 ? Math.ceil(n / 2) * 2 : n <= 50 ? Math.round(n / 5) * 5 : Math.round(n / 10) * 10;
}

/** Mines' values (for their guards): wood, mercury, ore, sulfur, crystal, gems, gold. */
export const MINE_VALUES = [1500, 3500, 1500, 3500, 3500, 3500, 7000];

/** A thing for a pile worth low..high, weighted by how common each is: the best that fits under high, else the cheapest that reaches low. */
export function pickTreasure(rng: HasRng, list: Treasure[], low: number, high: number): Treasure | null {
  const fits = list.filter((t) => t.value <= high && t.value >= Math.min(low, high) / 2);
  const pool = fits.length ? fits : list.filter((t) => t.value <= high);
  if (!pool.length) return list.slice().sort((a, b) => a.value - b.value)[0] ?? null;
  let total = 0;
  for (const t of pool) total += t.rarity;
  let r = random(rng) * total;
  for (const t of pool) if ((r -= t.rarity) < 0) return t;
  return pool[pool.length - 1];
}

export interface ZonePlace {
  /** 0..1 across the map. */
  x: number;
  y: number;
  level: number;
  /** The zone's share of its level's area. */
  area: number;
}

/**
 * Where each zone goes: the start zones on the surface (and, with an underground, as much of the
 * rest below as keeps the two levels near equal, the zones furthest from the starts first), then a
 * few hundred steps of pulling connected zones together and pushing overlapping ones apart, each
 * zone a circle as large as its share of the level. Plain arithmetic only (and square roots), so
 * every engine lays it out alike.
 */
export function layoutZones(rng: HasRng, zones: RmgZone[], connections: RmgConnection[], levels: number): Map<number, ZonePlace> {
  const level = new Map<number, number>(zones.map((z) => [z.id, levels > 1 ? (z.level ?? 0) : 0]));
  // (A template that says each zone's level (VCMI's forcedLevel) has its own split.)
  if (levels > 1 && !zones.some((z) => z.level !== undefined)) {
    // Steps from the nearest start zone.
    const far = new Map<number, number>();
    const queue = zones.filter((z) => z.type === "human" || z.type === "computer").map((z) => z.id);
    for (const id of queue) far.set(id, 0);
    for (let q = 0; q < queue.length; q++)
      for (const c of connections) {
        const next = c.a === queue[q] ? c.b : c.b === queue[q] ? c.a : -1;
        if (next >= 0 && !far.has(next)) (far.set(next, far.get(queue[q])! + 1), queue.push(next));
      }
    const total = zones.reduce((a, z) => a + z.size, 0);
    // One connected group below, grown from the zone furthest from the starts by the zones most
    // connected to it (so few connections need gates), until it holds near half the land.
    const rest = zones.filter((z) => z.type === "treasure" || z.type === "junction");
    const linksTo = (id: number) => connections.filter((c) => (c.a === id && level.get(c.b) === 1) || (c.b === id && level.get(c.a) === 1)).length;
    let below = 0;
    const seed = rest.slice().sort((p, q) => (far.get(q.id) ?? 99) - (far.get(p.id) ?? 99) || p.id - q.id)[0];
    if (seed) (level.set(seed.id, 1), (below += seed.size));
    for (;;) {
      const next = rest
        .filter((z) => level.get(z.id) === 0 && below + z.size <= total * 0.5)
        .map((z) => ({ z, n: linksTo(z.id) }))
        .sort((p, q) => q.n - p.n || (far.get(q.z.id) ?? 99) - (far.get(p.z.id) ?? 99) || p.z.id - q.z.id)[0];
      if (!next || (next.n === 0 && below >= total * 0.3)) break;
      level.set(next.z.id, 1);
      below += next.z.size;
    }
    // Then zones moved up or down, one or a pair at a time, while fewer connections cross the
    // levels (each needs a pair of gates), the underground keeping 30-50% of the land.
    const crossing = () => connections.filter((c) => level.get(c.a) !== level.get(c.b)).length;
    const fits = (b: number) => b > 0 && b >= total * 0.3 - 1e-9 && b <= total * 0.5 + 1e-9;
    let cuts = crossing();
    for (let better = true; better; ) {
      better = false;
      for (const z of rest) {
        const d = level.get(z.id) === 1 ? -z.size : z.size;
        if (!fits(below + d)) continue;
        level.set(z.id, 1 - level.get(z.id)!);
        const n = crossing();
        if (n < cuts) ((cuts = n), (below += d), (better = true));
        else level.set(z.id, 1 - level.get(z.id)!);
      }
      for (const u of rest)
        for (const v of rest) {
          if (level.get(u.id) !== 1 || level.get(v.id) !== 0) continue;
          const b = below - u.size + v.size;
          if (!fits(b)) continue;
          level.set(u.id, 0);
          level.set(v.id, 1);
          const n = crossing();
          if (n < cuts) ((cuts = n), (below = b), (better = true));
          else (level.set(u.id, 1), level.set(v.id, 0));
        }
    }
  }
  const places = new Map<number, ZonePlace & { r: number }>();
  for (let l = 0; l < levels; l++) {
    const here = zones.filter((z) => level.get(z.id) === l);
    const sum = here.reduce((a, z) => a + z.size, 0) || 1;
    const links = connections.filter((c) => level.get(c.a) === l && level.get(c.b) === l);
    const radius = new Map(here.map((z) => [z.id, Math.sqrt(z.size / sum / Math.PI)]));
    // Several tries from different starts, each settled and then improved by swapping zones; the one
    // whose connected zones lie closest (and least on top of each other) wins.
    let best: Map<number, { x: number; y: number }> | null = null;
    let bestStress = Infinity;
    for (let attempt = 0; attempt < 6; attempt++) {
      const at = new Map<number, { x: number; y: number }>();
      const starts = here.filter((z) => z.type === "human" || z.type === "computer");
      // Starts on a ring (the points of a regular polygon, by rotation: no Math.cos), the rest near the middle.
      let px = random(rng) - 0.5;
      let py = random(rng) - 0.5;
      const len = Math.sqrt(px * px + py * py) || 1;
      (px /= len), (py /= len);
      const turn = polygonStep(Math.max(1, starts.length));
      for (const z of here) {
        if (starts.includes(z)) {
          at.set(z.id, { x: 0.5 + px * 0.36, y: 0.5 + py * 0.36 });
          [px, py] = [px * turn.c - py * turn.s, px * turn.s + py * turn.c];
        } else at.set(z.id, { x: 0.5 + (random(rng) - 0.5) * 0.6, y: 0.5 + (random(rng) - 0.5) * 0.6 });
      }
      settle(here, links, at, radius, 300);
      // Swaps that bring connected zones closer.
      for (let pass = 0; pass < 2; pass++) {
        let now = stress(here, links, at, radius);
        for (let i = 0; i < here.length; i++)
          for (let j = i + 1; j < here.length; j++) {
            const a = at.get(here[i].id)!;
            const b = at.get(here[j].id)!;
            [a.x, b.x, a.y, b.y] = [b.x, a.x, b.y, a.y];
            const then = stress(here, links, at, radius);
            if (then < now - 1e-9) now = then;
            else [a.x, b.x, a.y, b.y] = [b.x, a.x, b.y, a.y];
          }
        settle(here, links, at, radius, 100);
      }
      const s = stress(here, links, at, radius);
      if (s < bestStress) (bestStress = s), (best = at);
    }
    for (const z of here) places.set(z.id, { ...best!.get(z.id)!, level: l, area: z.size / sum, r: radius.get(z.id)! });
  }
  return places;
}

type Spots = Map<number, { x: number; y: number }>;

/** How far a layout is from what it wants: connected zones apart beyond touching, and zones on top of each other. */
function stress(here: RmgZone[], links: RmgConnection[], at: Spots, radius: Map<number, number>): number {
  let s = 0;
  for (const c of links) {
    const a = at.get(c.a)!;
    const b = at.get(c.b)!;
    const d = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    const gap = d - (radius.get(c.a)! + radius.get(c.b)!);
    if (gap > 0) s += gap * gap * 4;
  }
  for (let i = 0; i < here.length; i++)
    for (let j = i + 1; j < here.length; j++) {
      const a = at.get(here[i].id)!;
      const b = at.get(here[j].id)!;
      const d = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      const over = radius.get(here[i].id)! + radius.get(here[j].id)! - d;
      if (over > 0) s += over * over;
    }
  return s;
}

/** Steps of pulling connected zones together and pushing overlapping ones apart, inside the map. */
function settle(here: RmgZone[], links: RmgConnection[], at: Spots, radius: Map<number, number>, steps: number) {
  for (let it = 0; it < steps; it++) {
    const cool = 1 - it / steps;
    const move = new Map<number, [number, number]>(here.map((z) => [z.id, [0, 0]]));
    for (const c of links) {
      const a = at.get(c.a)!;
      const b = at.get(c.b)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const want = (radius.get(c.a)! + radius.get(c.b)!) * 0.9;
      if (d <= want) continue;
      const f = ((d - want) / d) * 0.1;
      move.get(c.a)![0] += dx * f;
      move.get(c.a)![1] += dy * f;
      move.get(c.b)![0] -= dx * f;
      move.get(c.b)![1] -= dy * f;
    }
    for (let i = 0; i < here.length; i++)
      for (let j = i + 1; j < here.length; j++) {
        const a = at.get(here[i].id)!;
        const b = at.get(here[j].id)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const want = radius.get(here[i].id)! + radius.get(here[j].id)!;
        if (d >= want) continue;
        const f = ((want - d) / d) * 0.25;
        move.get(here[i].id)![0] -= dx * f;
        move.get(here[i].id)![1] -= dy * f;
        move.get(here[j].id)![0] += dx * f;
        move.get(here[j].id)![1] += dy * f;
      }
    for (const z of here) {
      const p = at.get(z.id)!;
      const r = radius.get(z.id)!;
      const [mx, my] = move.get(z.id)!;
      p.x = Math.max(r * 0.7, Math.min(1 - r * 0.7, p.x + mx * (0.3 + cool)));
      p.y = Math.max(r * 0.7, Math.min(1 - r * 0.7, p.y + my * (0.3 + cool)));
    }
  }
}

/** The cosine and sine of a full turn over n, by halving the angle from known values (square roots only). */
function polygonStep(n: number): { c: number; s: number } {
  // Exact for the counts a template has starts for; others go by a short series.
  const table: Record<number, [number, number]> = { 1: [1, 0], 2: [-1, 0], 3: [-0.5, Math.sqrt(3) / 2], 4: [0, 1], 6: [0.5, Math.sqrt(3) / 2], 8: [Math.SQRT1_2, Math.SQRT1_2] };
  if (table[n]) return { c: table[n][0], s: table[n][1] };
  const a = (2 * Math.PI) / n;
  // Taylor series to many terms: plain arithmetic.
  let c = 0;
  let s = 0;
  let term = 1;
  for (let k = 0; k < 30; k++) {
    if (k % 2 === 0) c += (k % 4 === 0 ? 1 : -1) * term;
    else s += (k % 4 === 1 ? 1 : -1) * term;
    term *= a / (k + 1);
  }
  return { c, s };
}
