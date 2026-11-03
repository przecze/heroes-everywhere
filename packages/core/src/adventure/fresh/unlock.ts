// What a way through opens (2026-11-02: "the dependency for the conquest goals turns out to be 'unlock red gate',
// then you find 'red tent' underground behind a guardian, so you put 'kill guardian' on the queue"). A guard in a
// passage, a Keymaster's Tent, a border guard or gate: each is worth what lies behind it, found the same way. The
// hero's routes are walked again as if that one way were open, and every tile they reach that today's routes don't
// counts: the shroud there to explore, the towns, mines and piles already seen there. So the chain builds itself: the
// rival's town beyond the red gate gives the red tent its worth, and the tent gives the guard before it its worth.
import { findPaths, type PathNode } from "../movement.ts";
import { allied } from "../rules.ts";
import { type AdventureState, type AdvObject, type Hero, Obj } from "../types.ts";
import { Terrain, type World, isRevealed, teleportExits, visitTile } from "../world.ts";
import { objectWorth } from "../aiWorth.ts";
import { env, note } from "./mind.ts";

/** The share of what lies beyond that counts (it is further, and partly unknown). */
const OPEN = Number(env("FR_OPEN") ?? 0.5);
/** An unexplored tile beyond, in gold. */
const SHROUD = Number(env("FR_SHROUD") ?? 15);
/** A town beyond: a neutral one, a rival's (before its siege is known). */
const TOWN = 10000;
const RIVAL_TOWN = 20000;
/**
 * The unexplored land a way through leads into, as a player sees it on the map: the black area, flooded from the tiles
 * the opened routes reach at its edge (routes stop at the shroud, so before this only that edge counted). Each of its
 * tiles is worth SHROUD like one at the edge, unless today's routes already touch that black area (exploring reaches
 * it anyway). The owner's Province seat (2026-11-03): the main hero, 90k strong, wandered ten days in its explored corner
 * while the Arch Mages before the rest of the map were worth 2,040. Off by default (FR_DEEP=1, or 2 also counting black areas today's routes touch): on Province it changed nothing, the land behind that guard was a monolith.
 */
const DEEP = env("FR_DEEP") === "1" || env("FR_DEEP") === "2";
/** FR_DEEP=2: a black area counts even when today's routes touch it too (the shroud hides whether they lead in). */
const DEEP_ALL = env("FR_DEEP") === "2";

const cache = new Map<string, number>();
let cacheDay = -1;

/**
 * What opening these tiles (a guard's, a gate's) adds to the hero's reach, in gold. `routes` are today's routes (the
 * cheap guards already counted as passed by `through`); `what` names the opening for the day's cache.
 */
/** `area`: a break into a new area (a garrison): the black land its routes touch counts too, tile by tile. */
export function opens(s: AdventureState, w: World, h: Hero, routes: Map<number, PathNode>, through: (i: number) => boolean, opening: () => Set<number>, what: string, area = false): number {
  if (cacheDay !== s.day) (cache.clear(), (cacheDay = s.day));
  const key = `${h.id}|${what}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const open = opening();
  const far = findPaths(w, s, h, false, (i) => open.has(i) || through(i), true);
  let v = 0;
  const counted = new Set<number>();
  for (const [i, node] of far) {
    if (routes.has(i) || node.passOnly) continue;
    if (!isRevealed(s, h.owner, i)) v += SHROUD;
    const o = w.visitable(s, i);
    if (o && !o.removed && !counted.has(o.id)) {
      counted.add(o.id);
      v += seenWorth(s, w, h, o);
    }
  }
  const deep = DEEP || area ? darkBeyond(s, w, h, routes, far, DEEP_ALL || area) : 0;
  if (env("FR_DEBUG")) {
    let tiles = 0, black = 0;
    for (const [i, node] of far) if (!routes.has(i) && !node.passOnly) (tiles++, isRevealed(s, h.owner, i) || black++);
    note(s, h.owner, `  opens ${what}: ${tiles} tiles beyond (${black} unexplored), ${[...counted].map((id) => `${s.objects[id].type}:${s.objects[id].subid}`).join(" ")}, dark ${deep}, worth ${Math.round(v)}`);
  }
  v += SHROUD * deep;
  v *= OPEN;
  cache.set(key, v);
  return v;
}

/** The player's unexplored areas (8-neighbour, per level), labelled once a day: label per tile (0 explored), sizes. */
let dark: { day: number; player: number; label: Int32Array; size: number[] } | undefined;
function darkAreas(s: AdventureState, w: World, player: number) {
  if (dark && dark.day === s.day && dark.player === player) return dark;
  const n = w.levels * w.size * w.size;
  const label = new Int32Array(n);
  const size = [0];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (label[i] || isRevealed(s, player, i)) continue;
    const id = size.length;
    size.push(0);
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      size[id]++;
      for (const k of around(w, j)) if (!label[k] && !isRevealed(s, player, k)) (label[k] = id), stack.push(k);
    }
  }
  return (dark = { day: s.day, player, label, size });
}
function around(w: World, i: number): number[] {
  const x = i % w.size;
  const y = Math.floor(i / w.size) % w.size;
  const z = Math.floor(i / (w.size * w.size));
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const k = w.index(x + dx, y + dy, z);
      if (k >= 0) out.push(k);
    }
  return out;
}
/** Unexplored tiles in the black areas the opened routes `far` touch and today's `routes` don't. */
function darkBeyond(s: AdventureState, w: World, h: Hero, routes: Map<number, PathNode>, far: Map<number, PathNode>, all: boolean): number {
  const d = darkAreas(s, w, h.owner);
  const touched = (m: Map<number, PathNode>, skip?: Map<number, PathNode>) => {
    const out = new Set<number>();
    for (const i of m.keys()) {
      if (skip?.has(i)) continue;
      if (d.label[i]) out.add(d.label[i]);
      for (const k of around(w, i)) if (d.label[k]) out.add(d.label[k]);
    }
    return out;
  };
  const near = all ? new Set<number>() : touched(routes);
  let v = 0;
  for (const id of touched(far, routes)) if (!near.has(id)) v += d.size[id];
  return v;
}

/**
 * A way out whose far end nobody has seen (a monolith, a Subterranean Gate: its exit lies in the shroud, so the view
 * knows of none): worth a share of all the black land, which it may lead into. The owner's Province seat (2026-11-03): the
 * Arch Mages guarded a two-way monolith into the rest of the map, and the 3 explored tiles behind them were all the
 * fight was worth; the main hero, 90k strong, then wandered its explored corner for ten days. FR_WAY=0: nothing.
 */
const WAY = Number(env("FR_WAY") ?? 0.5);
export function unknownWay(s: AdventureState, w: World, h: Hero, o: AdvObject): number {
  if (!WAY || !(o.type === 43 || o.type === 45 || o.type === 103) || teleportExits(s, o).length) return 0;
  const d = darkAreas(s, w, h.owner);
  let black = 0;
  for (let k = 1; k < d.size.length; k++) black += d.size[k];
  return WAY * SHROUD * black;
}

/** A thing seen beyond, worth at a glance (no battles played: it's further on). */
function seenWorth(s: AdventureState, w: World, h: Hero, o: AdvObject): number {
  if (o.owner >= 0 && allied(s, o.owner, h.owner)) return 0;
  const way = unknownWay(s, w, h, o);
  if (way) return way;
  if (o.type === Obj.TOWN) return o.owner >= 0 ? RIVAL_TOWN : TOWN;
  if (o.type === Obj.MONSTER) return 0;
  const v = objectWorth(s, w, h, o, []);
  return v > 0 ? v : 0;
}

/** The tiles of a guard: its own and those it watches. */
export function guardTiles(w: World, g: AdvObject): Set<number> {
  const out = new Set<number>([visitTile(w, g)]);
  for (let i = 0; i < w.guardedBy.length; i++) if (w.guardedBy[i] === g.id + 1) out.add(i);
  return out;
}

/** The tiles of the border guards and gates of a key's colour. */
export function gateTiles(s: AdventureState, w: World, colour: number): Set<number> {
  const out = new Set<number>();
  for (const o of s.objects) if (!o.removed && (o.type === 9 || o.type === 212) && o.subid === colour) out.add(visitTile(w, o));
  return out;
}

/**
 * What a boat at this tile opens (the owner: "if there's seafaring on the map, put a scout or two on a ship"): the coasts
 * the sea reaches that today's routes don't, each landing's surroundings (3 tiles) counted once, and what floats on the
 * way, by the same measure as above.
 */
export function sails(s: AdventureState, w: World, h: Hero, routes: Map<number, PathNode>, at: number): number {
  if (cacheDay !== s.day) (cache.clear(), (cacheDay = s.day));
  const key = `${h.id}|s${at}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  // (A hero afloat there: the boat it would take, or one a shipyard would put there.)
  const sea = findPaths(w, s, { ...h, x: at % w.size, y: Math.floor(at / w.size) % w.size, z: Math.floor(at / (w.size * w.size)), boat: -1, movement: h.maxMovement }, false);
  const near = new Set<number>();
  const counted = new Set<number>();
  let v = 0;
  for (const j of sea.keys()) {
    const wet = w.map.tiles[j].terrain === Terrain.WATER;
    if (wet) {
      const o = w.visitable(s, j);
      if (o && !o.removed && o.type !== 8 && !counted.has(o.id)) (counted.add(o.id), (v += seenWorth(s, w, h, o)));
      continue;
    }
    if (routes.has(j)) continue;
    const x = j % w.size;
    const y = Math.floor(j / w.size) % w.size;
    const z = Math.floor(j / (w.size * w.size));
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const k = w.index(x + dx, y + dy, z);
        if (k >= 0 && !routes.has(k) && w.map.tiles[k].terrain !== Terrain.WATER) near.add(k);
      }
  }
  for (const k of near) {
    if (!isRevealed(s, h.owner, k)) v += SHROUD;
    const o = w.visitable(s, k);
    if (o && !o.removed && !counted.has(o.id)) (counted.add(o.id), (v += seenWorth(s, w, h, o)));
  }
  v *= OPEN;
  cache.set(key, v);
  return v;
}
