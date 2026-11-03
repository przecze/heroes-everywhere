// A made-up original save (.GM1, unpacked) in the shapes h3save.ts reads, from a map and what the
// test wants in it: for the reader's and the importer's tests (real saves are the players', not ours).
import type { H3Map } from "../src/index.ts";

export interface TestHero {
  id: number;
  owner: number;
  name: string;
  x: number;
  y: number;
  z: number;
  onMap?: boolean;
  level?: number;
  experience?: number;
  primary?: [number, number, number, number];
  skills?: [number, number][];
  spells?: number[];
  army?: [number, number][];
  /** The game's worn slots (index 0-18) to artifact ids. */
  worn?: Record<number, number>;
  backpack?: number[];
  mana?: number;
  movement?: number;
}

export interface TestSave {
  hota?: boolean;
  heroes: TestHero[];
  towns?: { owner: number; type: number; x: number; y: number; z: number; name: string; army?: [number, number][]; built?: number[]; recruits?: number[] }[];
  /** Map object indices no longer on the map. */
  gone?: number[];
  /** Per tile, a bit per player who has seen it. */
  fog?: (tile: number) => number;
  /** Objects the save lists in place of the map's templates (index to def, id, subid). */
  resolved?: Record<number, { def: string; id: number; subid: number }>;
  /** SoD's game state: the players (a human colour, resources), the date, monster counts and mine / dwelling owners (map object index to colour). */
  human?: number;
  resources?: Record<number, number[]>;
  date?: [number, number, number];
  monsters?: Record<number, number>;
  flags?: Record<number, number>;
}

export function writeTestSave(map: H3Map, t: TestSave, mapFile = "Test.h3m"): Uint8Array {
  const out: number[] = [];
  const u8 = (v: number) => out.push(v & 255);
  const u16 = (v: number) => (u8(v), u8(v >> 8));
  const u32 = (v: number) => (u16(v), u16(v >>> 16));
  const bytes = (s: string) => [...s].forEach((c) => u8(c.charCodeAt(0)));
  const fill = (n: number, v = 0) => { for (let i = 0; i < n; i++) u8(v); };
  bytes("H3SVG");
  fill(3);
  u32(t.hota ? 44 : 42);
  u32(t.hota ? 10 : 2);
  fill(0x30 - out.length);
  u32(t.hota ? 0x20 : 0x1c);
  u8(1);
  u32(map.size);
  u8(map.levels > 1 ? 1 : 0);
  u16(map.name.length);
  bytes(map.name);
  u16(0);
  fill(40, 0xff);
  u8(4);
  bytes(mapFile);
  u8(0);
  fill(300);

  const NT = map.levels * map.size * map.size;
  const gone = new Set(t.gone ?? []);
  const cover: number[][] = Array.from({ length: NT }, () => []);
  map.objects.forEach((o, i) => {
    // (Listed on its anchor's tile; one past the map's edge on the edge's.)
    if (!gone.has(i)) cover[(o.z * map.size + Math.min(o.y, map.size - 1)) * map.size + Math.min(o.x, map.size - 1)]?.push(i);
  });
  const heroAt = new Map(t.heroes.filter((h) => h.onMap !== false).map((h) => [(h.z * map.size + h.y) * map.size + h.x, h.id]));
  const monsterAt = new Map(Object.entries(t.monsters ?? {}).map(([i, n]) => { const o = map.objects[Number(i)]; return [(o.z * map.size + o.y) * map.size + o.x, [Number(i), o.subid, n]]; }));
  for (let i = 0; i < NT; i++) {
    const m = map.tiles[i];
    [m.terrain, m.view, m.river, m.riverDir, m.road, m.roadDir, m.flags, 0].forEach(u8);
    const mon = monsterAt.get(i);
    u16(heroAt.has(i) ? 34 : mon ? 54 : 0);
    u16(mon ? mon[1] : 0);
    u16(mon ? mon[0] : 0);
    u32(heroAt.get(i) ?? (mon ? mon[2] : 0xffffffff));
    u32(cover[i].length);
    for (const o of cover[i]) (u16(o), u8(0), u8(0));
  }
  const templates = map.templates.map((x) => ({ def: x.def, id: x.id, subid: x.subid, block: x.blockMask, visit: x.visitMask, flat: x.printPriority }));
  const extra = Object.values(t.resolved ?? {});
  u32(templates.length + extra.length);
  for (const x of [...templates, ...extra.map((e) => ({ ...e, block: [255, 255, 255, 255, 255, 127], visit: [0, 0, 0, 0, 0, 128], flat: 0 }))]) {
    u16(x.def.length);
    bytes(x.def);
    u8(1);
    u8(1);
    fill(6);
    x.block.forEach(u8);
    fill(6);
    x.visit.forEach(u8);
    u16(x.id);
    u16(x.subid);
    u16(0);
    u8(x.flat ? 1 : 0);
  }
  u32(map.objects.length);
  const resolvedAt = Object.keys(t.resolved ?? {}).map(Number);
  map.objects.forEach((o, i) => {
    u8(o.x), u8(o.y), u8(o.z);
    const k = resolvedAt.indexOf(i);
    u16(k >= 0 ? templates.length + k : o.template);
  });
  fill(500);

  const sod = !t.hota;
  if (sod) {
    // Mines, then dwellings (their records' places: a tile left of the anchor, as the game has some).
    const mines = map.objects.map((o, i) => [o, i] as const).filter(([o]) => o.id === 53 || o.id === 220);
    const dwellings = map.objects.map((o, i) => [o, i] as const).filter(([o]) => o.id === 17 || o.id === 20);
    if (mines.length || dwellings.length) {
      u8(mines.length);
      for (const [o, i] of mines) (u8(t.flags?.[i] ?? 255), u8(o.subid), u8(0), fill(28, 255), fill(28), u8(o.x - 1), u8(o.y), u8(o.z));
      u16(dwellings.length);
      for (const [o, i] of dwellings) (u8(t.flags?.[i] ?? 255), u8(o.id), u8(o.subid), fill(4, 255), fill(8), u8(o.x), u8(o.y), u8(o.z), fill(28, 255), fill(28), u8(255));
    }
    fill(300);
    for (let c = 0; c < 8; c++) {
      const heroes = t.heroes.filter((h) => h.owner === c).map((h) => h.id);
      const rec = new Uint8Array(145).fill(0);
      const dv = new DataView(rec.buffer);
      rec[0] = c, rec[1] = heroes.length, rec[2] = 255;
      for (let k = 0; k < 8; k++) rec[3 + k] = heroes[k] ?? 255;
      rec[14] = t.human === c ? 3 : 0;
      rec.fill(255, 26, 98);
      (t.resources?.[c] ?? [0, 0, 0, 0, 0, 0, 0]).forEach((n, k) => dv.setInt32(98 + 4 * k, n, true));
      rec.forEach((b) => u8(b));
    }
    fill(300);
  }

  for (const town of t.towns ?? []) {
    u8(town.owner), u16(0), u8(town.type), u8(town.x), u8(town.y), u8(town.z), u16(0);
    const army = town.army ?? [];
    for (let k = 0; k < 7; k++) u32(army[k] ? army[k][0] : 0xffffffff);
    for (let k = 0; k < 7; k++) u32(army[k] ? army[k][1] : 0);
    fill(4);
    u16(town.name.length);
    bytes(town.name);
    const after = new Uint8Array(400);
    if (sod) {
      (town.recruits ?? []).forEach((n, k) => (after[2 * k] = n));
      for (const b of town.built ?? [10]) after[97 + (b >> 3)] |= 1 << (b & 7);
    }
    after.forEach((b) => u8(b));
  }
  fill(2000);

  const slots = t.hota ? 1092 : 210;
  const levels = t.hota ? 30 : 28;
  for (const h of t.heroes) {
    // (SoD's: 26 bytes before the owner, 1094 on from there with no biography.)
    const rec = new Uint8Array(t.hota ? 1200 : 1108);
    const dv = new DataView(rec.buffer);
    const at = 40;
    dv.setInt16(at - 26, h.x, true), dv.setInt16(at - 24, h.y, true), dv.setInt16(at - 22, h.z, true);
    rec[at - 20] = h.onMap === false ? 0 : 1;
    rec[at] = h.owner;
    rec[at + 1] = 255, rec[at + 5] = rec[at + 6] = rec[at + 7] = 255, rec[at + 9] = 255;
    rec[at + 10] = h.id;
    dv.setUint32(at + 31, 1500, true);
    dv.setUint32(at + 35, h.movement ?? 1500, true);
    dv.setUint32(at + 39, h.experience ?? 50, true);
    rec[at + 43] = (h.skills ?? []).length;
    dv.setUint16(at + 47, h.mana ?? 10, true);
    rec[at + 49] = h.level ?? 1;
    for (let k = 0; k < 7; k++) {
      const a = h.army?.[k];
      dv.setUint32(at + 113 + 4 * k, a ? a[0] : 0xffffffff, true);
      dv.setUint32(at + 141 + 4 * k, a ? a[1] : 0, true);
    }
    [...h.name].forEach((c, k) => (rec[at + 169 + k] = c.charCodeAt(0)));
    (h.skills ?? []).forEach(([s, l], k) => ((rec[at + 182 + s] = l), (rec[at + slots + s] = k + 1)));
    void levels;
    (h.primary ?? [1, 1, 1, 1]).forEach((v, k) => (rec[at + 238 + k] = v));
    for (const s of h.spells ?? []) rec[at + 242 + s] = rec[at + 312 + s] = 1;
    for (let k = 0; k < 19; k++) {
      const a = h.worn?.[k];
      dv.setUint32(at + 382 + 8 * k, a ?? 0xffffffff, true);
      dv.setUint32(at + 386 + 8 * k, a === undefined ? 0 : 0xffffffff, true);
    }
    for (let k = 0; k < 64; k++) {
      const a = h.backpack?.[k];
      dv.setUint32(at + 534 + 8 * k, a ?? 0xffffffff, true);
      dv.setUint32(at + 538 + 8 * k, 0xffffffff, true);
    }
    rec.forEach((b) => u8(b));
  }
  if (sod) {
    fill(2 * t.heroes.length);
    const st = new Uint8Array(130);
    const [day, week, month] = t.date ?? [1, 1, 1];
    (st[11] = day), (st[13] = week), (st[15] = month), (st[129] = 9);
    st.forEach((b) => u8(b));
  } else {
    fill(3000, 7);
    u8(9);
  }
  for (let i = 0; i < NT; i++) (u8(t.fog?.(i) ?? 0), u8(i % 3 === 0 ? 1 : 0));
  fill(40, 5);
  return Uint8Array.from(out);
}
