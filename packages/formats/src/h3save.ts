// Reader for the original game's saved games (.GM1 single player, .GM2-.GM8 hot seat): gzip whose
// CRC the game writes wrong. A save is a dump of the game's state, not a documented format, so
// beyond the first parts (the scenario's summary, the adventure map's tiles, object templates and
// objects, all at fixed shapes) its pieces are found by their shapes: heroes, towns, the fog. The
// shapes are the community's (h3sed's hero and town records, Heroes3HotaCompanion's tiles and fog,
// H3save_reader's notes) checked against real SoD saves; what isn't found is left out, never guessed.
import { inflateRaw } from "./inflate.ts";

export interface SaveTile {
  terrain: number;
  view: number;
  river: number;
  riverDir: number;
  road: number;
  roadDir: number;
  flags: number;
  /** The object class drawn here (34: a hero; then `hero` is its id). */
  cls: number;
  hero?: number;
  /** The object drawn here: its subclass (a monster's creature), its index and its setup bits (a monster's count in the low 12). */
  sub: number;
  object: number;
  setup: number;
  /** Indices into H3Save.objects of the objects covering this tile. */
  objects: number[];
}

export interface SaveTemplate {
  def: string;
  id: number;
  subid: number;
  /** Map-format masks: block (bit set = passable, as the .h3m) and visit. */
  blockMask: number[];
  visitMask: number[];
  flat: boolean;
}

export interface SaveObject {
  x: number;
  y: number;
  z: number;
  template: number;
  /** Still on some tile (an object taken, beaten or flagged away is gone from the tiles). */
  present: boolean;
}

export interface SaveHero {
  /** Hero type (HOTRAITS / HotA's numbering). */
  id: number;
  /** Player colour 0-7, 255 for nobody's (in a tavern, a prison or not yet met). */
  owner: number;
  name: string;
  heroClass: number;
  portrait: number;
  x: number;
  y: number;
  z: number;
  /** Standing on the map (else in a town's garrison or nowhere). */
  onMap: boolean;
  movement: number;
  maxMovement: number;
  experience: number;
  level: number;
  mana: number;
  primary: [number, number, number, number];
  /** Secondary skills in their slot order: [skill id, level 1-3]. */
  skills: [number, number][];
  /** Spells in the spellbook. */
  spells: number[];
  army: ({ creature: number; count: number } | null)[];
  /** The game's 19 worn slots (helm .. spellbook, misc 5 last): artifact id or -1. */
  worn: number[];
  /** Spell of each worn scroll, by worn slot. */
  wornScrolls: Record<number, number>;
  backpack: number[];
  /** Offset of the hero's record (for the scan tool). */
  at: number;
}

export interface SaveTown {
  owner: number;
  /** SoD's: the built buildings (the game's ids, as ours) and creatures to recruit per level (basic, upgraded). */
  built?: number[];
  recruits?: [number[], number[]];
  type: number;
  x: number;
  y: number;
  z: number;
  name: string;
  army: ({ creature: number; count: number } | null)[];
  at: number;
}

/** A player's record (SoD's shape, 145 bytes): who plays it, its heroes, towns and resources. */
export interface SavePlayer {
  color: number;
  human: boolean;
  /** Hero types it owns, in its hero list's order. */
  heroes: number[];
  /** Wood, mercury, ore, sulfur, crystal, gems, gold. */
  resources: number[];
}

/** A mine's or creature dwelling's record: its owner (255 nobody's) at its place. */
export interface SaveFlagged {
  owner: number;
  x: number;
  y: number;
  z: number;
}

export interface H3Save {
  campaign: boolean;
  /** The save's version (HotA's: major 44 and up). */
  major: number;
  minor: number;
  hota: boolean;
  /** The scenario's summary: as the .h3m's header. */
  format: number;
  size: number;
  levels: number;
  name: string;
  description: string;
  /** The map file the game was started from, as the game had it ("Arrogance.h3m"). */
  mapFile: string;
  tiles: SaveTile[];
  templates: SaveTemplate[];
  objects: SaveObject[];
  heroes: SaveHero[];
  towns: SaveTown[];
  players: SavePlayer[];
  /** The date: day 1-7 of week 1-4 of month 1-. */
  date?: { day: number; week: number; month: number };
  mines: SaveFlagged[];
  dwellings: SaveFlagged[];
  /** Explored tiles: per tile (levels x size x size) a bit per player. */
  fog?: Uint8Array;
  /** What couldn't be read, for the import's report. */
  missing: string[];
}

/** The save unpacked (the game's gzip has a wrong CRC, so it isn't checked); an unpacked one as it is. */
export function unpackSave(bytes: Uint8Array): Uint8Array {
  if (bytes[0] === 0x48 && bytes[1] === 0x33) return bytes; // "H3SV" already
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error("not a Heroes III saved game");
  const flags = bytes[3];
  let q = 10;
  if (flags & 4) q += 2 + (bytes[q] | (bytes[q + 1] << 8));
  if (flags & 8) while (bytes[q++] !== 0);
  if (flags & 16) while (bytes[q++] !== 0);
  if (flags & 2) q += 2;
  return inflateRaw(bytes, q).out;
}

const decoders: Record<string, TextDecoder> = {};
const decoder = (cp: string) => (decoders[cp] ??= new TextDecoder(cp));
/**
 * A name or text as the player's game wrote it: the save doesn't say its codepage, so it's told from
 * the letters: mostly high letters is Cyrillic (1251), Polish letters 1250, else Western (1252).
 */
export function saveText(bytes: Uint8Array): string {
  let high = 0, letters = 0, polish = 0;
  for (const c of bytes) {
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) letters++;
    else if (c >= 0xc0) (high++, letters++);
    if (c === 0xb9 || c === 0xea || c === 0x9c || c === 0xb3 || c === 0xbf || c === 0x9f || c === 0xa5 || c === 0xca || c === 0x8c || c === 0xa3 || c === 0xaf || c === 0x8f || c === 0xe6 || c === 0xf1) polish++;
  }
  return decoder(high > letters / 2 ? "windows-1251" : polish ? "windows-1250" : "windows-1252").decode(bytes);
}

const SIZES = new Set([36, 72, 108, 144, 180, 216, 252]);

export function parseH3Save(bytes: Uint8Array): H3Save {
  const r = unpackSave(bytes);
  const magic = String.fromCharCode(...r.subarray(0, 5));
  if (magic !== "H3SVG" && magic !== "H3SVC") throw new Error("not a Heroes III saved game");
  const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);
  const i16 = (o: number) => dv.getInt16(o, true);
  const major = u32(8);
  const minor = u32(12);
  const missing: string[] = [];

  // The summary: map format, any players, size, two levels, name and description (u16 lengths).
  // (At 0x30 in the saves seen; looked for nearby in case a version adds a field.)
  let h = -1;
  for (let p = 0x10; p < 0x200 && h < 0; p++) {
    if (r[p] > 1 || !SIZES.has(u32(p + 1)) || r[p + 5] > 1 || u16(p + 6) > 300) continue;
    h = p;
  }
  if (h < 0) throw new Error("this save's scenario summary wasn't found");
  let format = 0;
  for (let b = h - 4; b >= Math.max(0x10, h - 16) && !format; b--) if ([0x0e, 0x15, 0x1c, 0x20].includes(u32(b))) format = u32(b);
  const size = u32(h + 1);
  const levels = r[h + 5] ? 2 : 1;
  let p = h + 6;
  const text = () => {
    const n = u16(p);
    const s = saveText(r.subarray(p + 2, p + 2 + n));
    p += 2 + n;
    return s;
  };
  const name = text();
  const description = text();
  const mapFile = findMapFile(r, p);

  // The tiles: per tile the .h3m's 7 bytes, the object drawn there, and the objects covering it;
  // the object templates come right after (found by their first name), so the tiles end there.
  const NT = levels * size * size;
  const tplAt = findTemplates(r, u16, u32, p);
  if (tplAt < 0) throw new Error("this save's map wasn't found in it");
  const tilesAt = findTiles(r, u32, p, tplAt, NT);
  if (tilesAt < 0) throw new Error("this save's map tiles weren't found in it");
  const tiles: SaveTile[] = [];
  let q = tilesAt;
  for (let i = 0; i < NT; i++) {
    const n = u32(q + 18);
    const cls = u16(q + 8);
    tiles.push({
      terrain: r[q], view: r[q + 1], river: r[q + 2], riverDir: r[q + 3], road: r[q + 4], roadDir: r[q + 5], flags: r[q + 6],
      cls, ...(cls === 34 ? { hero: u32(q + 14) } : {}), sub: u16(q + 10), object: u16(q + 12), setup: u32(q + 14),
      objects: Array.from({ length: n }, (_, k) => u16(q + 22 + 4 * k)),
    });
    q += 22 + 4 * n;
  }

  // Templates: name, width, height, three masks, the passability and visit masks, id, subid, flat.
  const templates: SaveTemplate[] = [];
  const tplCount = u32(q);
  q += 4;
  for (let i = 0; i < tplCount; i++) {
    const n = u16(q);
    const def = saveText(r.subarray(q + 2, q + 2 + n)).toLowerCase();
    const b = q + 2 + n;
    templates.push({ def, blockMask: [...r.subarray(b + 8, b + 14)], visitMask: [...r.subarray(b + 20, b + 26)], id: u16(b + 26), subid: u16(b + 28), flat: !!r[b + 32] });
    q = b + 33;
  }
  // Objects: x, y, z and template; present while some tile still lists it.
  const objCount = u32(q);
  q += 4;
  const present = new Uint8Array(objCount);
  for (const t of tiles) for (const o of t.objects) if (o < objCount) present[o] = 1;
  const objects: SaveObject[] = Array.from({ length: objCount }, (_, i) => ({ x: r[q + 5 * i], y: r[q + 5 * i + 1], z: r[q + 5 * i + 2], template: u16(q + 5 * i + 3), present: !!present[i] }));
  const objEnd = q + 5 * objCount;

  const hota = major >= 44;
  const heroes = findHeroes(r, u32, i16, objEnd, hota, size, levels);
  if (!heroes.length) missing.push("heroes");
  const towns = findTowns(r, u16, u32, objEnd, heroes.length ? Math.min(...heroes.map((x) => x.at)) : r.length, size, levels, objects, templates);
  if (!towns.length && objects.some((o) => templates[o.template]?.id === 98)) missing.push("towns");
  // SoD's game state (ProspectorRT's layout): after the last hero record (1094 bytes and its
  // biography) a u16 per hero, then the date's day, week and month as u16 at 11, 13 and 15, and the
  // fog 130 bytes on. Else (HotA, or not all heroes found) the fog is looked for by its shape.
  let date: H3Save["date"];
  let fogAt = -1;
  if (!hota && heroes.length) {
    const last = Math.max(...heroes.map((x) => x.at)) - 26;
    const st = last + 1094 + u16(last + 22) + 2 * heroes.length;
    if (st + 130 + 2 * NT <= r.length) {
      const [day, week, month] = [u16(st + 11), u16(st + 13), u16(st + 15)];
      let fogOk = true;
      for (let k = 1; k < 2 * NT && fogOk; k += 2) fogOk = r[st + 130 + k] <= 1;
      if (fogOk && day >= 1 && day <= 7 && week >= 1 && week <= 4 && month >= 1 && month < 1000) [date, fogAt] = [{ day, week, month }, st + 130];
    }
  }
  if (fogAt < 0) fogAt = findFog(r, objEnd, NT, size, heroes);
  const fog = fogAt < 0 ? undefined : Uint8Array.from({ length: NT }, (_, i) => r[fogAt + 2 * i]);
  if (!fog) missing.push("fog");

  // SoD's players' records (8 x 145 bytes).
  const players = hota ? [] : findPlayers(r, objEnd);
  if (!players.length) missing.push("players");
  if (!date) missing.push("date");
  if (!hota) for (const t of towns) readTownState(r, u16, t);
  const flagged = hota ? undefined : findFlagged(r, u16, objEnd, objects, templates);
  if (!flagged) missing.push("mines and dwellings");

  return { campaign: magic === "H3SVC", major, minor, hota, format, size, levels, name, description, mapFile, tiles, templates, objects, heroes, towns, players, date, mines: flagged?.mines ?? [], dwellings: flagged?.dwellings ?? [], fog, missing };
}

/** The map file's name: the first "*.h3m" after the summary (its directory follows in a buffer of its own). */
function findMapFile(r: Uint8Array, from: number): string {
  for (let p = from; p < Math.min(r.length - 5, from + 8192); p++) {
    if (r[p] !== 0x2e || (r[p + 1] | 0x20) !== 0x68 || r[p + 2] !== 0x33 || (r[p + 3] | 0x20) !== 0x6d || r[p + 4] !== 0) continue;
    let s = p;
    while (s > from && r[s - 1] >= 0x20) s--;
    return saveText(r.subarray(s, p + 4));
  }
  return "";
}

/** The template list: a count, then u16-length names ending ".def" (the first such name is the first template). */
function findTemplates(r: Uint8Array, u16: (o: number) => number, u32: (o: number) => number, from: number): number {
  for (let p = from; p < r.length - 4; p++) {
    if (r[p] !== 0x2e || (r[p + 1] | 0x20) !== 0x64 || (r[p + 2] | 0x20) !== 0x65 || (r[p + 3] | 0x20) !== 0x66) continue;
    for (let n = 5; n <= 32 && p + 4 - n >= 6; n++) {
      const name = p + 4 - n;
      if (u16(name - 2) !== n) continue;
      const count = u32(name - 6);
      if (count > 0 && count < 20000) return name - 6;
    }
  }
  return -1;
}

/** Where the tile records start: the start whose walk over all tiles ends exactly at `end`. */
function findTiles(r: Uint8Array, u32: (o: number) => number, from: number, end: number, count: number): number {
  const walk = (s: number, limit: number) => {
    let q = s;
    for (let i = 0; i < limit; i++) {
      if (q + 22 > end || r[q] > 9 || r[q + 2] > 4 || r[q + 4] > 3) return -1;
      const n = u32(q + 18);
      if (n > 64) return -1;
      q += 22 + 4 * n;
    }
    return q;
  };
  for (let s = end - 22 * count; s >= from; s--) if (walk(s, Math.min(count, 64)) >= 0 && walk(s, count) === end) return s;
  return -1;
}

const SOD_HERO = { skillLevels: 28, slots: 210 };
const HOTA_HERO = { skillLevels: 30, slots: 1092 };

/**
 * Hero records (h3sed's shape, by the owner byte t): 31 movement total, 35 left, 39 experience,
 * 43 skills count, 47 spell points, 49 level, 113 / 141 army, 169 name, 182 skill levels,
 * 210 (HotA 1092) skill slots, 238 primary skills, 242 / 312 spells, 382 worn, 534 backpack; the
 * position 26 bytes before (i16 x, y, z) and "on the map" 20 before; 10 the hero's id, 11 its class, 12 its portrait.
 */
function findHeroes(r: Uint8Array, u32: (o: number) => number, i16: (o: number) => number, from: number, hota: boolean, size: number, levels: number): SaveHero[] {
  const shape = hota ? HOTA_HERO : SOD_HERO;
  const artOk = (o: number) => (r[o] === 0xff && r[o + 1] === 0xff && r[o + 2] === 0xff && r[o + 3] === 0xff) || (r[o + 1] === 0 && r[o + 2] === 0 && r[o + 3] === 0);
  const isHero = (t: number) => {
    if (r[t] > 7 && r[t] !== 255) return false;
    if (r[t + 43] > 0x1c || r[t + 44] || r[t + 45] || r[t + 46]) return false;
    // (Then 255 at 1, 5-7 and 9 in every save seen, SoD's and HotA 1.8's.)
    if (r[t + 1] !== 0xff || r[t + 5] !== 0xff || r[t + 6] !== 0xff || r[t + 7] !== 0xff || r[t + 9] !== 0xff) return false;
    // The name: letters, then zeros to the 13th byte.
    if (r[t + 169] <= 0x20 || r[t + 181] !== 0) return false;
    let k = 169;
    while (k < 181 && r[t + k] >= 0x20) k++;
    while (k < 181 && r[t + k] === 0) k++;
    if (k < 181) return false;
    for (let k = 0; k < shape.skillLevels; k++) if (r[t + 182 + k] > 3) return false;
    for (let k = 242; k < 382; k++) if (r[t + k] > 1) return false;
    for (let k = 0; k < 19; k++) if (!artOk(t + 382 + 8 * k)) return false;
    for (let k = 0; k < 128; k++) if (!artOk(t + 534 + 4 * k)) return false;
    if (hota) for (let k = 0; k < 29; k++) if (r[t + 1092 + k] > 0x1c) return false;
    return true;
  };
  const out: SaveHero[] = [];
  const seen = new Set<number>();
  const end = r.length - 1200;
  for (let t = Math.max(from, 40); t < end; t++) {
    if (!isHero(t)) continue;
    const id = r[t + 10];
    if (!seen.has(id)) {
      seen.add(id);
      const army: SaveHero["army"] = Array.from({ length: 7 }, (_, k) => {
        const c = u32(t + 113 + 4 * k);
        const n = u32(t + 141 + 4 * k);
        return c !== 0xffffffff && n > 0 ? { creature: c, count: n } : null;
      });
      const skills: [number, number, number][] = [];
      for (let k = 0; k < shape.skillLevels; k++) if (r[t + 182 + k]) skills.push([k, r[t + 182 + k], r[t + shape.slots + k] || 99]);
      skills.sort((a, b) => a[2] - b[2]);
      const spells: number[] = [];
      for (let k = 0; k < 70; k++) if (r[t + 242 + k]) spells.push(k);
      const worn: number[] = [];
      const wornScrolls: Record<number, number> = {};
      for (let k = 0; k < 19; k++) {
        const a = u32(t + 382 + 8 * k);
        worn.push(a === 0xffffffff ? -1 : a);
        if (a === 1) wornScrolls[k] = u32(t + 386 + 8 * k);
      }
      const backpack: number[] = [];
      for (let k = 0; k < 64; k++) {
        const a = u32(t + 534 + 8 * k);
        if (a !== 0xffffffff) backpack.push(a);
      }
      const x = i16(t - 26), y = i16(t - 24), z = i16(t - 22);
      const inMap = x >= 0 && y >= 0 && x < size && y < size && z >= 0 && z < levels;
      out.push({
        id, owner: r[t], name: saveText(r.subarray(t + 169, t + 169 + Math.max(0, r.subarray(t + 169, t + 182).indexOf(0)))),
        heroClass: r[t + 11], portrait: r[t + 12],
        x: inMap ? x : -1, y: inMap ? y : -1, z: inMap ? z : -1, onMap: inMap && r[t - 20] === 1,
        maxMovement: u32(t + 31), movement: u32(t + 35), experience: u32(t + 39), mana: r[t + 47] | (r[t + 48] << 8), level: r[t + 49],
        primary: [r[t + 238], r[t + 239], r[t + 240], r[t + 241]],
        skills: skills.map(([s, l]) => [s, l]), spells, army, worn, wornScrolls, backpack, at: t,
      });
    }
    t += 1000;
  }
  return out;
}

/**
 * Town records (h3sed's shape): owner, 2 bytes, type, x, y, z, 2 bytes, 7 creature ids, 7 counts,
 * 4 bytes, a u16 name length and the name; each must stand on a town object of the map.
 */
function findTowns(r: Uint8Array, u16: (o: number) => number, u32: (o: number) => number, from: number, to: number, size: number, levels: number, objects: SaveObject[], templates: SaveTemplate[]): SaveTown[] {
  const townAt = new Set<number>();
  for (const o of objects) if (templates[o.template]?.id === 98 || templates[o.template]?.id === 77) townAt.add((o.z * 256 + o.y) * 256 + o.x);
  if (!townAt.size) return [];
  const out: SaveTown[] = [];
  const seen = new Set<number>();
  for (let t = from; t < Math.min(to, r.length - 90); t++) {
    const owner = r[t];
    if ((owner > 7 && owner !== 255) || r[t + 3] > 11 || r[t + 4] >= size || r[t + 5] >= size || r[t + 6] >= levels) continue;
    // (The record's position is the town's top left or the object's anchor: either way within 2 tiles.)
    const key = (r[t + 6] * 256 + r[t + 5]) * 256 + r[t + 4];
    const anchor = townAt.has(key) ? key : townAt.has(key + 2) ? key + 2 : -1;
    if (anchor < 0 || seen.has(anchor)) continue;
    const n = u16(t + 69);
    if (n < 1 || n > 14) continue;
    const nameBytes = r.subarray(t + 71, t + 71 + n);
    if (nameBytes.some((c) => c < 0x20 || c === 0xff)) continue;
    let ok = true;
    const army: SaveTown["army"] = [];
    for (let k = 0; k < 7 && ok; k++) {
      const c = u32(t + 9 + 4 * k);
      const cnt = u32(t + 37 + 4 * k);
      if (c === 0xffffffff) ok = cnt === 0;
      else ok = c < 256 && cnt > 0;
      army.push(ok && c !== 0xffffffff ? { creature: c, count: cnt } : null);
    }
    if (!ok) continue;
    seen.add(anchor);
    out.push({ owner, type: r[t + 3], x: anchor & 255, y: (anchor >> 8) & 255, z: anchor >> 16, name: saveText(nameBytes), army, at: t });
    t += 70 + n;
  }
  return out;
}

/**
 * The fog: a u16 per tile (low byte a bit per player who has seen it, high byte 0 or 1), the last
 * such run in the save; aligned where each owned hero's own tile is seen by its owner.
 */
function findFog(r: Uint8Array, from: number, NT: number, size: number, heroes: SaveHero[]): number {
  const n = 2 * NT;
  let cand = -1;
  outer: for (let s = r.length - 18 - n; s > from; s--) {
    if (r[s + 1] > 1 || r[s + 3] > 1 || r[s + 5] > 1 || r[s - 1] <= 1) continue;
    for (let k = 1; k < n; k += 2) if (r[s + k] > 1) continue outer;
    const values = new Set<number>();
    for (let k = 0; k < n && values.size < 3; k += 2) values.add(r[s + k]);
    if (values.size < 2) continue;
    cand = s;
    break;
  }
  if (cand < 0) return -1;
  const owned = heroes.filter((h) => h.owner < 8 && h.onMap);
  let best = cand;
  let bestScore = -1;
  // (Nearest first: a shift scores no better unless the heroes' own tiles say so.)
  for (const d of [0, 2, -2, 4, -4, 6, -6, 8, -8, 10, 12, 14, 16]) {
    const s = cand + d;
    if (s < from || s + n > r.length) continue;
    let score = 0;
    for (const h of owned) if ((r[s + 2 * ((h.z * size + h.y) * size + h.x)] >> h.owner) & 1) score++;
    if (score > bestScore) [best, bestScore] = [s, score];
  }
  return best;
}

/**
 * SoD's players: 8 records of 145 bytes (ProspectorRT's): 0 colour, 1 hero count, 3-10 the heroes,
 * 14 3 for a human, 24 town count, 26 the towns, 98 the resources (7 x i32).
 */
function findPlayers(r: Uint8Array, from: number): SavePlayer[] {
  const SZ = 145;
  const ok = (p: number, c: number) => {
    if (r[p] !== c || r[p + 1] > 8 || r[p + 24] > 48) return false;
    for (let k = 0; k < 8; k++) if ((r[p + 3 + k] === 0xff) !== k >= r[p + 1]) return false;
    for (let k = 0; k < r[p + 24]; k++) if (r[p + 26 + k] === 0xff) return false;
    return true;
  };
  for (let p = from; p < r.length - 8 * SZ; p++) {
    let all = true;
    for (let c = 0; c < 8 && all; c++) all = ok(p + c * SZ, c);
    if (!all) continue;
    const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
    return Array.from({ length: 8 }, (_, c) => {
      const q = p + c * SZ;
      return { color: c, human: r[q + 14] === 3, heroes: [...r.subarray(q + 3, q + 3 + r[q + 1])], resources: Array.from({ length: 7 }, (_, k) => dv.getInt32(q + 98 + 4 * k, true)) };
    });
  }
  return [];
}

/** SoD's town record after the name: 14 u16 creatures to recruit (basic, upgraded), 97 bytes on the built buildings (u64). */
function readTownState(r: Uint8Array, u16: (o: number) => number, t: SaveTown): void {
  const a = t.at + 71 + u16(t.at + 69);
  if (a + 113 > r.length) return;
  const built: number[] = [];
  for (let i = 0; i < 64; i++) if ((r[a + 97 + (i >> 3)] >> (i & 7)) & 1) built.push(i);
  // (The village hall stands in every town: a record without it isn't this shape.)
  if (!built.includes(10)) return;
  t.built = built;
  t.recruits = [Array.from({ length: 7 }, (_, k) => u16(a + 2 * k)), Array.from({ length: 7 }, (_, k) => u16(a + 14 + 2 * k))];
}

/**
 * SoD's mines and dwellings (ProspectorRT's): a count byte and 62-byte mines (0 owner, 1 resource,
 * 59 x, y, z), then a u16 count and 75-byte dwellings (0 owner, 1 object id, 2 subid, 15 x, y, z). Found where the places line up with the map's mines and dwellings.
 */
function findFlagged(r: Uint8Array, u16: (o: number) => number, from: number, objects: SaveObject[], templates: SaveTemplate[]): { mines: SaveFlagged[]; dwellings: SaveFlagged[] } | undefined {
  const key = (x: number, y: number, z: number) => (z * 256 + y) * 256 + x;
  const mineAt = new Set<number>(), dwellingAt = new Set<number>();
  for (const o of objects) {
    const id = templates[o.template]?.id;
    if (id === 53 || id === 220) mineAt.add(key(o.x, o.y, o.z));
    if (id === 17 || id === 20) dwellingAt.add(key(o.x, o.y, o.z));
  }
  // (The record's place is the object's anchor or the tile left of it.)
  const placeIn = (set: Set<number>, q: number) => (set.has(key(r[q], r[q + 1], r[q + 2])) ? r[q] : set.has(key(r[q] + 1, r[q + 1], r[q + 2])) ? r[q] + 1 : -1);
  const isMine = (q: number) => placeIn(mineAt, q + 59) >= 0;
  const isDwelling = (q: number) => placeIn(dwellingAt, q + 15) >= 0;
  const owner = (b: number) => (b < 8 ? b : 255);
  // (Most must line up: a record or two may stand for something the map lists otherwise.)
  if (!mineAt.size && !dwellingAt.size) return { mines: [], dwellings: [] };
  const fits = (n: number, at: (k: number) => number, is: (q: number) => boolean) => {
    if (!n) return true;
    if (!is(at(0))) return false;
    let hit = 0;
    for (let k = 0; k < n; k++) if (is(at(k))) hit++;
    return hit >= n * 0.9;
  };
  for (let m = from; m < r.length - 64; m++) {
    const n = r[m];
    if (!n !== !mineAt.size || m + 1 + 62 * n + 2 > r.length) continue;
    if (!fits(n, (k) => m + 1 + 62 * k, isMine)) continue;
    const d = m + 1 + 62 * n;
    const nd = u16(d);
    if (!nd !== !dwellingAt.size || d + 2 + 75 * nd > r.length || !fits(nd, (k) => d + 2 + 75 * k, isDwelling)) continue;
    const mines = Array.from({ length: n }, (_, k) => {
      const q = m + 1 + 62 * k;
      return { owner: owner(r[q]), x: placeIn(mineAt, q + 59), y: r[q + 60], z: r[q + 61] };
    });
    const dwellings = Array.from({ length: nd }, (_, k) => {
      const q = d + 2 + 75 * k;
      return { owner: owner(r[q]), x: placeIn(dwellingAt, q + 15), y: r[q + 16], z: r[q + 17] };
    });
    return { mines, dwellings };
  }
  return undefined;
}
