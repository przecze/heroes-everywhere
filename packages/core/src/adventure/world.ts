import { specialtyValue } from "../specialty.ts";
import type { H3Map } from "@heroes/formats";
import { SPECIAL, hasSpecial } from "./townSpecials.ts";
import { SCOUTING, skillLevel } from "../skills.ts";
import { bonus } from "./artifacts.ts";
import type { CreatureStats } from "../creatures.ts";
import type { GameData } from "./create.ts";
import type { AdventureState, AdvObject, Hero, Pos } from "./types.ts";
import { weekIndex } from "../calendar.ts";

export const Terrain = { DIRT: 0, SAND: 1, GRASS: 2, SNOW: 3, SWAMP: 4, ROUGH: 5, SUBTERRANEAN: 6, LAVA: 7, WATER: 8, ROCK: 9 } as const;

/**
 * Tiles covered by a template-masked object: offsets from its anchor
 * (bottom-right tile) for each set (or unset) bit. In the map's byte form
 * the anchor is the last bit: byte i, bit j is tile (-(7-j), -(5-i)).
 */
/** How many tiles apart two spots are on a level (a king's moves: a diagonal step counts one). */
export function tileSpan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function maskTiles(mask: number[], want: 0 | 1): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 8; j++) if (((mask[i] >> j) & 1) === want) out.push({ dx: j - 7, dy: i - 5 });
  return out;
}

/** Calls f for each tile of the mask with the wanted bit (maskTiles' order, without allocating). */
function forMaskTiles(mask: number[], want: 0 | 1, f: (dx: number, dy: number) => void) {
  for (let i = 0; i < 6; i++) for (let j = 0; j < 8; j++) if (((mask[i] >> j) & 1) === want) f(j - 7, i - 5);
}

/**
 * Static facts about a map plus per-tile occupancy rebuilt from the state.
 * Not serialized: server and client each build it from the same map file.
 */
export class World {
  readonly map: H3Map;
  readonly size: number;
  readonly levels: number;
  readonly creatures: CreatureStats[];
  readonly data: GameData;
  /** Scenery and impassable terrain. */
  /** Tiles blocked by scenery (rocks, trees...) regardless of state. */
  readonly staticBlocked: Uint8Array;
  /** Rebuilt by refresh(): object id + 1 blocking / visitable at a tile, hero id + 1 standing on it. */
  blockedBy = new Int32Array(0);
  visitBy = new Int32Array(0);
  heroAt = new Int32Array(0);
  /** Teleport entrances with a single exit: tile -> exit tile + 1. */
  teleportTo = new Int32Array(0);
  guardedBy = new Int32Array(0);

  constructor(map: H3Map, data: GameData, interactive: Set<number>) {
    this.map = map;
    this.size = map.size;
    this.levels = map.levels;
    this.data = data;
    this.creatures = data.creatures;
    const n = map.levels * map.size * map.size;
    this.staticBlocked = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (map.tiles[i].terrain === Terrain.ROCK) this.staticBlocked[i] = 1;
    map.objects.forEach((o, i) => {
      if (interactive.has(i)) return;
      const t = map.templates[o.template];
      for (const { dx, dy } of maskTiles(t.blockMask, 0)) this.mark(this.staticBlocked, o.x + dx, o.y + dy, o.z, 1);
    });
  }

  index(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size || z < 0 || z >= this.levels) return -1;
    return (z * this.size + y) * this.size + x;
  }

  tile(p: Pos) {
    const i = this.index(p.x, p.y, p.z);
    return i < 0 ? undefined : this.map.tiles[i];
  }

  private mark(arr: Uint8Array | Int32Array, x: number, y: number, z: number, v: number) {
    const i = this.index(x, y, z);
    if (i >= 0) arr[i] = v;
  }

  /** Recomputes object/hero occupancy and monster guard zones from the state. */
  /** Lighthouses each player owns (+500 sea movement apiece). */
  lighthouses: number[] = [];
  /** The current week (0-based), for week-long bonuses like the Stables. */
  week = 0;

  refresh(s: AdventureState) {
    this.week = weekIndex(s.day);
    const n = this.levels * this.size * this.size;
    // (This runs after every action, and most actions only move a hero: only the heroes' old tiles
    // are cleared, and the objects' layers are touched only where an object changed, on the tiles it
    // left and the ones it covers now; many changes at once, or a state the world hasn't seen, rebuild
    // them all.)
    if (this.heroAt.length === n) for (const i of this.heroMarks) this.heroAt[i] = 0;
    else this.heroAt = new Int32Array(n);
    this.heroMarks = [];
    for (const h of s.heroes) {
      if (h.removed || h.garrison !== undefined) continue;
      const i = this.index(h.x, h.y, h.z);
      if (i < 0) continue;
      this.heroAt[i] = h.id + 1;
      this.heroMarks.push(i);
    }
    const changed = this.objectsChanged(s);
    if (changed === "all" || this.blockedBy.length !== n) this.rebuild(s, n);
    else if (changed.length) this.update(s, changed);
    this.lighthouses = [];
    // (Castle towns' Lighthouses count too.)
    for (const o of this.lit) if (!o.removed && o.owner >= 0 && (o.type === 42 || (o.town && hasSpecial(o, "castle", SPECIAL.s1)))) this.lighthouses[o.owner] = (this.lighthouses[o.owner] ?? 0) + 1;
    if (World.verify) this.check(s, n);
  }

  /** Tests: after each refresh, the layers compared with ones built from scratch. */
  static verify = false;

  /** Tiles the heroes were marked on at the last refresh. */
  private heroMarks: number[] = [];
  /** What each object looked like when the layers were last built (everything they read of it), and the tiles it was put on. */
  private stamps: Stamp[] = [];
  /** Per tile, the objects (by index, ascending) blocking it, visitable there, and guarding it (monsters around it, water left out). */
  private blockers: (number[] | undefined)[] = [];
  private visitors: (number[] | undefined)[] = [];
  private guards: (number[] | undefined)[] = [];
  /** The objects that may be lighthouses (Lighthouses and towns). */
  private lit: AdvObject[] = [];

  /** The objects (by index) that moved, appeared, went or changed since the last refresh, noted as they are now; "all" when too many did. */
  private objectsChanged(s: AdventureState): number[] | "all" {
    const objs = s.objects;
    if (objs.length < this.stamps.length) return "all";
    const out: number[] = [];
    for (let k = 0; k < objs.length; k++) {
      const o = objs[k];
      const t = this.stamps[k];
      if (t && t.o === o && t.x === o.x && t.y === o.y && t.z === o.z && t.b === o.block && t.v === o.visit && t.removed === !!o.removed && t.carried === (o.carriedBy !== undefined) && t.type === o.type && t.subid === o.subid && t.link === o.link && t.town === !!o.town) continue;
      // (A state the world hasn't seen: everything differs.)
      if (out.push(k) > 64) return "all";
    }
    return out;
  }

  /** The object's stamp as it is now: what it covers, and the tiles a monster guards. */
  private stamp(o: AdvObject): Stamp {
    const on = !o.removed && o.carriedBy === undefined;
    const f = on ? this.footprint(o) : undefined;
    const zone: number[] = [];
    if (!o.removed && o.type === 54) {
      // Around where it stands, its visitable tile (HotA's monsters stand one tile left of their anchor).
      const at = visitTile(this, o);
      const mx = at >= 0 ? at % this.size : o.x;
      const my = at >= 0 ? Math.floor(at / this.size) % this.size : o.y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const i = this.index(mx + dx, my + dy, o.z);
          if (i >= 0 && this.map.tiles[i].terrain !== Terrain.WATER) zone.push(i);
        }
    }
    return { o, x: o.x, y: o.y, z: o.z, b: o.block, v: o.visit, removed: !!o.removed, carried: o.carriedBy !== undefined, type: o.type, subid: o.subid, link: o.link, town: !!o.town, block: f?.block ?? NONE, visit: f?.visit ?? NONE, zone };
  }

  /** Every layer built from scratch. */
  private rebuild(s: AdventureState, n: number) {
    const fresh = (a: Int32Array<ArrayBuffer>) => (a?.length === n ? a.fill(0) : new Int32Array(n));
    this.blockedBy = fresh(this.blockedBy);
    this.visitBy = fresh(this.visitBy);
    this.guardedBy = fresh(this.guardedBy);
    this.blockers = new Array(n);
    this.visitors = new Array(n);
    this.guards = new Array(n);
    this.stamps = [];
    this.lit = [];
    const add = (lists: (number[] | undefined)[], i: number, k: number) => (lists[i] ??= []).push(k);
    for (let k = 0; k < s.objects.length; k++) {
      const o = s.objects[k];
      const t = (this.stamps[k] = this.stamp(o));
      if (t.type === 42 || t.town) this.lit.push(o);
      for (const i of t.block) (this.blockedBy[i] = o.id + 1), add(this.blockers, i, k);
      for (const i of t.visit) (this.visitBy[i] = o.id + 1), add(this.visitors, i, k);
      for (const i of t.zone) add(this.guards, i, k);
    }
    this.teleports(s, n);
    // Monsters attack anyone stepping next to them.
    for (let k = 0; k < s.objects.length; k++) for (const i of this.stamps[k].zone) if (!this.guardedBy[i] && !this.blocked(i)) this.guardedBy[i] = s.objects[k].id + 1;
  }

  /** The layers mended where the changed objects were and are now. */
  private update(s: AdventureState, changed: number[]) {
    const tiles = new Set<number>();
    let teleports = false;
    let lit = false;
    const take = (lists: (number[] | undefined)[], i: number, k: number) => {
      const l = lists[i]!;
      l.splice(l.indexOf(k), 1);
      tiles.add(i);
    };
    const put = (lists: (number[] | undefined)[], i: number, k: number) => {
      const l = (lists[i] ??= []);
      let j = l.length;
      while (j > 0 && l[j - 1] > k) j--;
      l.splice(j, 0, k);
      tiles.add(i);
    };
    for (const k of changed) {
      const was = this.stamps[k];
      const now = (this.stamps[k] = this.stamp(s.objects[k]));
      if (was) {
        for (const i of was.block) take(this.blockers, i, k);
        for (const i of was.visit) take(this.visitors, i, k);
        for (const i of was.zone) take(this.guards, i, k);
      }
      for (const i of now.block) put(this.blockers, i, k);
      for (const i of now.visit) put(this.visitors, i, k);
      for (const i of now.zone) put(this.guards, i, k);
      if (TELEPORTS.has(now.type) || (was && TELEPORTS.has(was.type))) teleports = true;
      if (now.type === 42 || now.town || was?.type === 42 || was?.town || was?.o !== now.o) lit = true;
    }
    const id = (l: number[] | undefined, at: number) => (l?.length ? s.objects[l[at < 0 ? l.length - 1 : 0]].id + 1 : 0);
    for (const i of tiles) {
      this.blockedBy[i] = id(this.blockers[i], -1);
      this.visitBy[i] = id(this.visitors[i], -1);
    }
    for (const i of tiles) this.guardedBy[i] = this.blocked(i) ? 0 : id(this.guards[i], 0);
    if (teleports) this.teleports(s, this.blockedBy.length);
    if (lit) this.lit = s.objects.filter((o, k) => this.stamps[k].type === 42 || this.stamps[k].town);
  }

  /** Teleport entrances with a single exit. */
  private teleports(s: AdventureState, n: number) {
    this.teleportTo = this.teleportTo?.length === n ? this.teleportTo.fill(0) : new Int32Array(n);
    // Monoliths by type and colour, once (not a search of every object per monolith).
    const byKind = new Map<string, AdvObject[]>();
    for (const o of s.objects) if (!o.removed && (o.type === MONOLITH_ONE_WAY_EXIT || o.type === MONOLITH_TWO_WAY)) byKind.get(`${o.type}:${o.subid}`)?.push(o) ?? byKind.set(`${o.type}:${o.subid}`, [o]);
    for (const o of s.objects) {
      if (o.removed) continue;
      const exits = teleportExits(s, o, byKind);
      if (exits.length !== 1) continue;
      const from = visitTile(this, o);
      const to = visitTile(this, exits[0]);
      if (from >= 0 && to >= 0) this.teleportTo[from] = to + 1;
    }
  }

  /** The layers as the first, whole-map build makes them (World.verify). */
  private check(s: AdventureState, n: number) {
    const fresh = new World(this.map, this.data, new Set());
    (fresh as unknown as { staticBlocked: Uint8Array }).staticBlocked = this.staticBlocked;
    fresh.rebuild(s, n);
    for (const k of ["blockedBy", "visitBy", "guardedBy", "teleportTo"] as const)
      for (let i = 0; i < n; i++) if (fresh[k][i] !== this[k][i]) throw new Error(`world layer ${k} differs at tile ${i}: ${this[k][i]}, whole build ${fresh[k][i]} (day ${s.day})`);
  }

  /** Each object's tiles (blocked, visitable), kept until it moves: refresh runs after every action. */
  private footprints = new WeakMap<AdvObject, { x: number; y: number; z: number; b: number[]; v: number[]; block: number[]; visit: number[] }>();
  private footprint(o: AdvObject) {
    let f = this.footprints.get(o);
    if (!f || f.x !== o.x || f.y !== o.y || f.z !== o.z || f.b !== o.block || f.v !== o.visit) {
      const block: number[] = [];
      const visit: number[] = [];
      forMaskTiles(o.block, 0, (dx, dy) => {
        const i = this.index(o.x + dx, o.y + dy, o.z);
        if (i >= 0) block.push(i);
      });
      forMaskTiles(o.visit, 1, (dx, dy) => {
        const i = this.index(o.x + dx, o.y + dy, o.z);
        if (i >= 0) visit.push(i);
      });
      f = { x: o.x, y: o.y, z: o.z, b: o.block, v: o.visit, block, visit };
      this.footprints.set(o, f);
    }
    return f;
  }

  /** The map file's objects anchored at a spot, in the file's order (built once: the map never changes). */
  private anchored?: Map<number, H3Map["objects"]>;
  mapObjectsAt(x: number, y: number, z: number): H3Map["objects"] {
    if (!this.anchored) {
      this.anchored = new Map();
      for (const m of this.map.objects) {
        const key = (m.z * 4096 + m.y) * 4096 + m.x;
        this.anchored.get(key)?.push(m) ?? this.anchored.set(key, [m]);
      }
    }
    return this.anchored.get((z * 4096 + y) * 4096 + x) ?? [];
  }

  blocked(i: number): boolean {
    return !!this.staticBlocked[i] || (!!this.blockedBy[i] && !this.visitBy[i]);
  }

  /** Interactive object whose visitable tile is here. */
  visitable(s: AdventureState, i: number): AdvObject | undefined {
    const id = this.visitBy[i];
    return id ? s.objects[id - 1] : undefined;
  }
}

// ---- teleports ------------------------------------------------------------

/** What World.refresh noted of an object (see objectsChanged). */
interface Stamp {
  o: AdvObject;
  x: number;
  y: number;
  z: number;
  b: number[];
  v: number[];
  removed: boolean;
  carried: boolean;
  type: number;
  subid: number;
  link?: number;
  town: boolean;
  block: number[];
  visit: number[];
  zone: number[];
}
const NONE: number[] = [];

export const SUBTERRANEAN_GATE = 103;
export const MONOLITH_ONE_WAY_ENTRANCE = 43;
export const MONOLITH_ONE_WAY_EXIT = 44;
export const MONOLITH_TWO_WAY = 45;
const TELEPORTS = new Set([SUBTERRANEAN_GATE, MONOLITH_ONE_WAY_ENTRANCE, MONOLITH_ONE_WAY_EXIT, MONOLITH_TWO_WAY]);

/** Where a teleport object can send a hero (several for monoliths sharing a colour). */
export function teleportExits(s: AdventureState, o: AdvObject, byKind?: Map<string, AdvObject[]>): AdvObject[] {
  if (o.type === SUBTERRANEAN_GATE) return o.link !== undefined && !s.objects[o.link]?.removed ? [s.objects[o.link]] : [];
  const exitType = o.type === MONOLITH_ONE_WAY_ENTRANCE ? MONOLITH_ONE_WAY_EXIT : o.type === MONOLITH_TWO_WAY ? MONOLITH_TWO_WAY : -1;
  if (exitType < 0) return [];
  if (byKind) return (byKind.get(`${exitType}:${o.subid}`) ?? []).filter((x) => x !== o);
  return s.objects.filter((x) => !x.removed && x !== o && x.type === exitType && x.subid === o.subid);
}

/** The object's visitable tile index (first one), or -1. */
export function visitTile(w: World, o: AdvObject): number {
  // (Read straight from the mask's bits: this runs for every object the AI weighs, many times a turn.)
  const mask = o.visit;
  for (let r = 0; r < 6; r++) {
    const row = mask[r];
    if (!row) continue;
    for (let j = 0; j < 8; j++) {
      if (!((row >> j) & 1)) continue;
      const i = w.index(o.x + j - 7, o.y + r - 5, o.z);
      if (i >= 0) return i;
    }
  }
  return -1;
}

/** Offset of the first visitable tile from the anchor (mask bit j of byte i = (j-7, i-5)). */
export function visitOffset(mask: number[]): [number, number] | null {
  for (let i = 5; i >= 0; i--) for (let j = 7; j >= 0; j--) if (mask[i] & (1 << j)) return [j - 7, i - 5];
  return null;
}

// ---- fog of war ----------------------------------------------------------

export const HERO_SIGHT = 5;

/** How far a hero sees: 5 tiles, plus Scouting. */
export function heroSight(h: Hero): number {
  return HERO_SIGHT + SCOUTING[skillLevel(h.skills, "scouting")] + bonus(h, "SIGHT_RADIUS") + specialtyValue(h, "SIGHT_RADIUS");
}
export const TOWN_SIGHT = 5;
export const MINE_SIGHT = 2;

export function isRevealed(s: AdventureState, player: number, i: number): boolean {
  const r = s.players[player]?.revealed;
  return !!r && ((r[i >> 5] >>> (i & 31)) & 1) === 1;
}

/** Uncovers a disc of tiles around (x, y) on one level for a player. */
export function reveal(s: AdventureState, w: World, player: number, x: number, y: number, z: number, radius: number) {
  const p = s.players[player];
  if (!p) return;
  // A team shares one map: what one ally uncovers, all of them see (the original's, VCMI's TeamState fog).
  const team = p.team === undefined ? [p] : s.players.filter((o) => o === p || (o.team === p.team && o.controller !== "none"));
  for (const t of team) if (t.revealed.length === 0) t.revealed = new Array(Math.ceil((w.levels * w.size * w.size) / 32)).fill(0);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + radius) continue;
      const i = w.index(x + dx, y + dy, z);
      if (i >= 0) for (const t of team) t.revealed[i >> 5] |= 1 << (i & 31);
    }
  }
}

/** Everything a player currently sees: heroes, towns and flagged mines. */
export function revealOwned(s: AdventureState, w: World, player: number) {
  for (const h of s.heroes) if (!h.removed && h.owner === player) reveal(s, w, player, h.x, h.y, h.z, heroSight(h));
  for (const o of s.objects) {
    if (o.removed || o.owner !== player) continue;
    // A Tower town's Lookout Tower sees 20 tiles around (heroes.thelazy.net/index.php/Lookout_Tower).
    if (o.type === 98) reveal(s, w, player, o.x - 2, o.y, o.z, hasSpecial(o, "tower", SPECIAL.s2) ? 20 : TOWN_SIGHT);
    else if (o.type === 53) reveal(s, w, player, o.x - 1, o.y, o.z, MINE_SIGHT);
  }
}
