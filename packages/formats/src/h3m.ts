// Reader for .h3m scenario maps (already gunzipped). Covers RoE, AB and SoD,
// with HotA fields up to format revision 9 where they are simple. Output is
// plain data; interpreting objects is the game's job.
import { Reader } from "./reader.ts";

export const MapFormat = { RoE: 0x0e, AB: 0x15, SoD: 0x1c, HotA: 0x20, WoG: 0x33 } as const;

interface Features {
  ab: boolean;
  sod: boolean;
  hota: number; // -1 when not HotA, else format revision
  factionsBytes: number;
  heroesBytes: number;
  heroesCount: number;
  artifactsBytes: number;
  spellsBytes: number;
  skillsBytes: number;
  artifactSlots: number;
  buildingsBytes: number;
}

function features(version: number, hota: number): Features {
  const ab = version !== MapFormat.RoE;
  const sod = ab && version !== MapFormat.AB;
  const f: Features = {
    ab,
    sod,
    hota: version === MapFormat.HotA ? hota : -1,
    factionsBytes: ab ? 2 : 1,
    heroesBytes: ab ? 20 : 16,
    heroesCount: ab ? 156 : 128,
    artifactsBytes: sod ? 18 : ab ? 17 : 16,
    spellsBytes: 9,
    skillsBytes: 4,
    artifactSlots: sod ? 19 : 18,
    buildingsBytes: 6,
  };
  if (f.hota >= 0) {
    f.artifactsBytes = 21;
    f.heroesBytes = hota >= 7 ? 27 : hota >= 5 ? 25 : 23;
    f.heroesCount = hota >= 7 ? 215 : hota >= 5 ? 198 : hota >= 3 ? 179 : 178;
  }
  return f;
}

export interface MapTile {
  terrain: number;
  view: number;
  river: number;
  riverDir: number;
  road: number;
  roadDir: number;
  /** Bits 0-1 terrain mirror x/y, 2-3 river, 4-5 road, 6 coast, 7 favorable winds. */
  flags: number;
}

export interface ObjectTemplate {
  def: string;
  /** 6 rows x 8 columns, bit set = passable (inverted from the file). */
  blockMask: number[];
  visitMask: number[];
  terrainMask: number;
  /** OBJECTS.TXT's second mask: the terrains whose editor menu lists it (the ones it's drawn for). */
  menuMask?: number;
  id: number;
  subid: number;
  /** 0 = generic, 1 = artifact, 2 = monster, 3 = hero, 4 = landscape(?) etc. */
  type: number;
  /** Objects with this set are drawn below everything else (roads, rivers-like). */
  printPriority: number;
}

export interface MapObject {
  x: number;
  y: number;
  z: number;
  template: number;
  id: number;
  subid: number;
  data: Record<string, unknown>;
}

export interface PlayerSlot {
  canHuman: boolean;
  canComputer: boolean;
  aiTactic?: number;
  allowedFactions?: number;
  randomFaction?: boolean;
  mainTown?: { x: number; y: number; z: number; generateHero: boolean };
  randomHero?: boolean;
  mainHero?: number;
  team?: number;
}

export interface H3Map {
  version: number;
  hotaVersion: number;
  size: number;
  levels: number;
  name: string;
  description: string;
  difficulty: number;
  levelLimit: number;
  players: PlayerSlot[];
  victory: { type: number; [k: string]: unknown };
  loss: { type: number; [k: string]: unknown };
  rumors: { name: string; text: string }[];
  /** What the map's author left out: artifacts, spells and secondary skills never offered at random. */
  banned?: { artifacts: number[]; spells: number[]; skills: number[] };
  /** Heroes the author kept out of taverns and random picks. */
  bannedHeroes?: number[];
  /** The author's settings for heroes by id, wherever they turn up (taverns, prisons, the map). */
  heroCustom?: Record<number, HeroCustom>;
  /** levels x size x size, row-major per level. */
  tiles: MapTile[];
  templates: ObjectTemplate[];
  objects: MapObject[];
  grail?: { x: number; y: number; z: number; radius: number };
  /** Timed events (resources and messages on given days). */
  events?: MapEvent[];
  /** HotA's own map options (absent on other maps). */
  hotaOptions?: HotaOptions;
}

/** What a HotA map sets beyond the original's (the map editor's specifications). */
export interface HotaOptions {
  /** Whether months may be special (plague, a creature's month); off: every month is ordinary. */
  specialMonths: boolean;
  /** Combination artifacts by bit, as the editor lists them (meaning per VCMI: allowed to be assembled). */
  combinedArtifacts?: number[];
  /** The game's length in days, when the author set one. */
  roundLimit?: number;
  /** Defeated heroes never come back to the taverns. */
  noRehiring?: boolean;
  /** Per player: no hiring heroes in taverns (VCMI reads it as "hero recruitment blocked"). */
  hiringBanned?: boolean[];
  /** HotA 1.8's event scripts. */
  scripts?: HotaScripts;
}

/** What a map may set for a hero (in its hero settings, or on a hero or prisoner it places). */
export interface HeroCustom {
  name?: string;
  /** Portrait index (0-155 the heroes', then the original's spare ones, then HotA's). */
  portrait?: number;
  /** Players who may hire the hero (a bit each); a hero renamed for everyone has 0xff. */
  players?: number;
  experience?: number;
  skills?: { skill: number; level: number }[];
  /** Worn (by the map format's slot order) and carried artifact ids; -1 is an empty slot. */
  artifacts?: { worn: number[]; backpack: number[] };
  biography?: string;
  /** 0 male, 1 female. */
  gender?: number;
  spells?: number[];
  primary?: [number, number, number, number];
}

export interface MapEvent {
  name: string;
  message: string;
  resources: number[];
  /** Bit mask of the players it is for. */
  players: number;
  human: boolean;
  computer: boolean;
  /** First day (0 = day 1) and repeat period in days (0 = once). */
  first: number;
  every: number;
  /** HotA: only on these difficulties (bit per difficulty, Easy first); absent: all. */
  difficulties?: number;
  /** HotA 1.8: the player (or town) script it runs instead of its own effects. */
  script?: HotaHandler;
}

export function h3mFormatName(version: number): string {
  return Object.entries(MapFormat).find(([, v]) => v === version)?.[0] ?? `0x${version.toString(16)}`;
}

class MapReader extends Reader {
  f!: Features;

  int3() {
    return { x: this.u8(), y: this.u8(), z: this.u8() };
  }
  i8() {
    const v = this.u8();
    return v > 127 ? v - 256 : v;
  }
  i16() {
    const v = this.u16();
    return v > 32767 ? v - 65536 : v;
  }
  /** Hero ids are always one byte; 0xff = none. */
  hero() {
    const v = this.u8();
    return v === 0xff ? -1 : v;
  }
  artifact() {
    const v = this.f.ab ? this.u16() : this.u8();
    return v === (this.f.ab ? 0xffff : 0xff) ? -1 : v;
  }
  creature() {
    const v = this.f.ab ? this.u16() : this.u8();
    const none = this.f.ab ? 0xffff : 0xff;
    if (v === none) return -1;
    // Values just below "none" encode random creatures by level.
    return v > none - 16 ? -(none - v) - 1 : v;
  }
  spell() {
    const v = this.u8();
    return v === 0xff ? -1 : v;
  }
  /** Indices of set bits. */
  bits(bytes: number, invert = false): number[] {
    const out: number[] = [];
    for (let b = 0; b < bytes; b++) {
      const m = this.u8();
      for (let i = 0; i < 8; i++) if (((m >> i) & 1) !== +invert) out.push(b * 8 + i);
    }
    return out;
  }
  sizedBits(): number[] {
    return this.bits((this.u32() + 7) >> 3);
  }
  resources() {
    return Array.from({ length: 7 }, () => this.i32());
  }
  /** Seven (creature, count) slots; empty slots dropped. */
  army() {
    const out: { slot: number; creature: number; count: number }[] = [];
    for (let slot = 0; slot < 7; slot++) {
      const creature = this.creature();
      const count = this.u16();
      if (creature !== -1) out.push({ slot, creature, count });
    }
    return out;
  }
}

export function parseH3m(bytes: Uint8Array): H3Map {
  const r = new MapReader(bytes);
  const version = r.u32();
  let hotaVersion = 0;
  if (version === MapFormat.HotA) {
    hotaVersion = r.u32();
    if (hotaVersion > 10) throw new Error(`HotA map revision ${hotaVersion} is not supported yet`);
  } else if (![MapFormat.RoE, MapFormat.AB, MapFormat.SoD].includes(version as 14)) {
    throw new Error(`unsupported map format 0x${version.toString(16)}`);
  }
  const f = (r.f = features(version, hotaVersion));
  const hotaHeader = readHotaHeader(r, f);

  r.bool(); // any players
  const size = r.i32();
  const levels = r.bool() ? 2 : 1;
  const name = r.lenString();
  const description = r.lenString();
  const difficulty = r.i8();
  const levelLimit = f.ab ? r.u8() : 0;

  const players = readPlayers(r, f);
  const victory = readVictory(r);
  const loss = readLoss(r);
  const teams = r.u8();
  if (teams > 0) players.forEach((p) => (p.team = r.u8()));

  // Allowed heroes (a clear bit keeps one out of taverns and random picks), placeholders, and
  // heroes the author renamed or gave another portrait (some for a few players only).
  const heroCount = f.hota >= 0 ? r.u32() : f.heroesCount;
  const bannedHeroes = r.bits((heroCount + 7) >> 3, true).filter((id) => id < heroCount);
  if (f.ab) {
    const placeholders = r.u32();
    for (let i = 0; i < placeholders; i++) r.hero();
  }
  const heroCustom: Record<number, HeroCustom> = {};
  if (f.sod) {
    const disposed = r.u8();
    for (let i = 0; i < disposed; i++) {
      const hero = r.hero();
      const portrait = r.u8();
      const name = r.lenString();
      const players = r.u8();
      heroCustom[hero] = { ...(portrait !== 0xff ? { portrait } : {}), ...(name ? { name } : {}), players };
    }
  }

  const hotaOptions = readMapOptions(r, f);
  if (hotaOptions && hotaHeader.noRehiring) hotaOptions.noRehiring = true;
  // Allowed artifacts, spells, skills: a set bit bans one (HotA bans Resistance by default).
  const banned: { artifacts: number[]; spells: number[]; skills: number[] } = { artifacts: [], spells: [], skills: [] };
  // (A list banning nearly everything can't be meant: it's ignored rather than leave nothing to find.)
  const sane = (ids: number[], bytes: number) => (ids.length > bytes * 8 * 0.9 ? [] : ids);
  if (f.ab) {
    const at = r.pos;
    const ids = f.hota >= 0 ? r.sizedBits() : r.bits(f.artifactsBytes);
    banned.artifacts = sane(ids, r.pos - at - (f.hota >= 0 ? 4 : 0));
  }
  if (f.sod) {
    banned.spells = sane(r.bits(f.spellsBytes), f.spellsBytes);
    banned.skills = sane(r.bits(f.skillsBytes), f.skillsBytes);
  }

  const rumors = Array.from({ length: r.u32() }, () => ({ name: r.lenString(), text: r.lenString() }));
  readPredefinedHeroes(r, f, heroCustom);

  const tiles: MapTile[] = [];
  for (let i = 0; i < levels * size * size; i++) {
    tiles.push({ terrain: r.u8(), view: r.u8(), river: r.u8() & 7, riverDir: r.u8(), road: r.u8(), roadDir: r.u8(), flags: r.u8() });
  }

  const templates: ObjectTemplate[] = [];
  const templateCount = r.u32();
  for (let i = 0; i < templateCount; i++) {
    const def = r.lenString().toLowerCase();
    const blockMask = Array.from({ length: 6 }, () => r.u8());
    const visitMask = Array.from({ length: 6 }, () => r.u8());
    r.u16();
    const terrainMask = r.u16();
    const id = r.u32();
    const subid = r.u32();
    const type = r.u8();
    const printPriority = r.u8();
    r.skip(16);
    templates.push({ def, blockMask, visitMask, terrainMask, id, subid, type, printPriority });
  }

  const objects: MapObject[] = [];
  let grail: H3Map["grail"];
  const objectCount = r.u32();
  for (let i = 0; i < objectCount; i++) {
    const pos = r.int3();
    const template = r.u32();
    r.skip(5);
    const t = templates[template];
    if (!t) throw new Error(`object ${i} uses missing template ${template}`);
    const data = readObject(r, f, t, players);
    if (t.id === 36 && t.subid < 1000) grail = { ...pos, radius: data.radius as number };
    objects.push({ ...pos, template, id: t.id, subid: t.subid, data });
  }
  // Timed events: resources and a message for some players on given days (and repeating).
  const events: MapEvent[] = [];
  try {
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      events.push(readEventCommon(r, f) as unknown as MapEvent);
      if (f.hota >= 5 && f.hota < 7) r.skip(14);
    }
  } catch {
    // older or unusual files: no events
  }

  return {
    version,
    hotaVersion,
    size,
    levels,
    name,
    description,
    difficulty,
    levelLimit,
    players,
    victory,
    loss,
    rumors,
    banned,
    ...(bannedHeroes.length && bannedHeroes.length < heroCount * 0.9 ? { bannedHeroes } : {}),
    ...(Object.keys(heroCustom).length ? { heroCustom } : {}),
    tiles,
    templates,
    objects,
    grail,
    events,
    ...(hotaOptions ? { hotaOptions } : {}),
  };
}

/** HotA's header: read past, but for whether defeated heroes may be hired again. */
function readHotaHeader(r: MapReader, f: Features): { noRehiring?: boolean } {
  const out: { noRehiring?: boolean } = {};
  if (f.hota < 0) return out;
  if (f.hota >= 8) r.skip(12); // HotA version major.minor.patch
  if (f.hota >= 1) r.skip(2); // mirror, arena
  if (f.hota >= 2) r.u32(); // terrain types
  if (f.hota >= 5) {
    r.u32(); // town types
    r.u8(); // allowed difficulties
  }
  if (f.hota >= 7 && !r.bool()) out.noRehiring = true; // can hire defeated heroes
  if (f.hota >= 8) r.bool(); // force matching version
  // Script variables (the HotA tutorial's "Shown-COMM_Adv_QuestLog" flags): name, value, a flag.
  if (f.hota >= 9) {
    const n = r.u32();
    for (let i = 0; i < n; i++) {
      r.lenString();
      r.i32();
      r.bool();
    }
  }
  return out;
}

function readPlayers(r: MapReader, f: Features): PlayerSlot[] {
  const players: PlayerSlot[] = [];
  for (let i = 0; i < 8; i++) {
    const p: PlayerSlot = { canHuman: r.bool(), canComputer: r.bool() };
    players.push(p);
    if (!p.canHuman && !p.canComputer) {
      r.skip(6 + (f.ab ? 6 : 0) + (f.sod ? 1 : 0));
      continue;
    }
    p.aiTactic = r.i8();
    if (f.sod) r.u8(); // faction selectable
    p.allowedFactions = f.factionsBytes === 2 ? r.u16() : r.u8();
    p.randomFaction = r.bool();
    if (r.bool()) {
      let generateHero = true;
      if (f.ab) {
        generateHero = r.bool();
        r.u8();
      }
      p.mainTown = { ...r.int3(), generateHero };
    }
    p.randomHero = r.bool();
    p.mainHero = r.hero();
    if (p.mainHero !== -1) {
      r.u8(); // portrait
      r.lenString();
    }
    if (f.ab) {
      r.u8();
      const named = r.u32();
      for (let k = 0; k < named; k++) {
        r.hero();
        r.lenString();
      }
    }
  }
  return players;
}

function readVictory(r: MapReader): H3Map["victory"] {
  const type = r.i8();
  if (type === -1) return { type };
  const v: H3Map["victory"] = { type, allowNormal: r.bool(), appliesToAI: r.bool() };
  switch (type) {
    case 0:
      v.artifact = r.artifact();
      break;
    case 1:
      v.creature = r.creature();
      v.amount = r.i32();
      break;
    case 2:
      v.resource = r.u8();
      v.amount = r.i32();
      break;
    case 3:
      v.pos = r.int3();
      v.hall = r.i8();
      v.fort = r.i8();
      break;
    case 4:
    case 5:
    case 6:
    case 7:
      v.pos = r.int3();
      break;
    case 10:
      v.artifact = r.u8();
      v.pos = r.int3();
      break;
    case 12:
      v.days = r.u32();
      break;
  }
  return v;
}

function readLoss(r: MapReader): H3Map["loss"] {
  const type = r.i8();
  if (type === 0 || type === 1) return { type, pos: r.int3() };
  if (type === 2) return { type, days: r.u16() };
  return { type };
}

function readMapOptions(r: MapReader, f: Features): HotaOptions | undefined {
  r.skip(31);
  if (f.hota < 0) return undefined;
  // (After VCMI's readMapOptions.)
  const o: HotaOptions = { specialMonths: r.bool() };
  r.skip(3);
  if (f.hota >= 1) o.combinedArtifacts = r.sizedBits();
  if (f.hota >= 3) {
    const limit = r.i32();
    if (limit >= 0) o.roundLimit = limit;
  }
  if (f.hota >= 5) o.hiringBanned = Array.from({ length: 8 }, () => r.bool());
  if (f.hota >= 9 && r.bool()) o.scripts = readHotaScripts(r);
  return o;
}

// ---- HotA 1.8 scripts (map events, variables), after VCMI's HotaScriptConverter ----

/** A number, or a computed one. */
export type HotaExpr =
  | number
  | { k: "var"; id: number }
  | { k: "neg"; e: HotaExpr }
  | { k: "+" | "-" | "*" | "/" | "%"; l: HotaExpr; r: HotaExpr }
  | { k: "resource"; player: number; res: number }
  | { k: "creatures"; creature: number }
  | { k: "difficulty" }
  | { k: "compareDifficulty"; value: number }
  | { k: "date" }
  | { k: "experience" }
  | { k: "level" }
  | { k: "primary"; skill: number }
  | { k: "random"; lo: HotaExpr; hi: HotaExpr }
  | { k: "artifacts"; artifact: number };

export type HotaCond =
  | { k: "const"; value: boolean }
  | { k: "all" | "any"; of: HotaCond[] }
  | { k: "<" | ">" | "==" | ">=" | "<=" | "!="; l: HotaExpr; r: HotaExpr }
  | { k: "not"; c: HotaCond }
  | { k: "hasArtifact"; artifact: number }
  | { k: "currentPlayer"; player: number }
  | { k: "heroOwner"; hero: number; player: number }
  | { k: "heroClass"; cls: number }
  | { k: "heroType"; hero: number }
  | { k: "defeatedMonster" | "defeatedHero" | "ownsTown"; player: number; target: number }
  | { k: "skill"; skill: number; level: number }
  | { k: "playerDefeated" | "playerHuman"; player: number }
  | { k: "startingFaction"; player: number; faction: number }
  | { k: "townNeutral" };

/** A picture in a message: its kind (HotA's numbering), subtype, and amount (a variable's id when isVar). */
export interface HotaImage {
  kind: number;
  sub: number;
  isVar: boolean;
  value: number;
}

export type HotaAction =
  | { k: "message"; text: string; images: HotaImage[] }
  | { k: "rewardsMessage"; text: string; body: HotaAction[] }
  | { k: "removeObject" }
  | { k: "disable" }
  | { k: "quest"; cond: HotaCond; proposal: string; progression: string; completion: string; hint: string; reward: HotaAction[] }
  | { k: "if"; cond: HotaCond; then: HotaAction[]; else: HotaAction[] }
  | { k: "chain"; branches: { cond: HotaCond; body: HotaAction[] }[] }
  | { k: "for"; body: HotaAction[]; from: HotaExpr; to: HotaExpr; variable: number }
  | { k: "questHint"; text: string; images: HotaImage[]; log: boolean }
  | { k: "question"; mode: number; text: string; yes: HotaAction[]; no: HotaAction[]; cancel?: HotaAction[]; images: HotaImage[]; extra?: HotaImage[] }
  | { k: "artifact"; take: boolean; artifact: number; spell: number; show: boolean }
  | { k: "warMachine"; take: boolean; artifact: number; show: boolean }
  | { k: "spell"; spell: number; show: boolean }
  | { k: "spellbook"; take: boolean; show: boolean }
  | { k: "creatures"; take: boolean; creature: number; count: HotaExpr; show: boolean }
  | { k: "combat"; army: { creature: number; count: HotaExpr }[] }
  | { k: "secondarySkill"; skill: number; level: number; show: boolean }
  | { k: "morale" | "luck"; amount: number; show: boolean }
  | { k: "experience"; amount: HotaExpr; show: boolean }
  | { k: "spellPoints" | "movement"; amount: HotaExpr; mode: number; show: boolean }
  | { k: "hire"; level: number; amount: HotaExpr; show: boolean }
  | { k: "build"; building: number; faction: number; show: boolean }
  | { k: "run"; bucket: number; id: number }
  | { k: "resources"; mode: number; amounts: HotaExpr[]; show: boolean }
  | { k: "primary"; skill: number; amount: HotaExpr; show: boolean }
  | { k: "setVar"; id: number; mode: number; value: HotaExpr }
  | { k: "setVarIf"; id: number; cond: HotaCond; yes: HotaExpr; no: HotaExpr };

/** A map's scripts: events by kind (hero: an object's visit, player: a timed event, town: a town event, quest: a scripted quest) and id, and its variables. */
export interface HotaScripts {
  events: { hero: Record<number, HotaAction[]>; player: Record<number, HotaAction[]>; town: Record<number, HotaAction[]>; quest: Record<number, HotaAction[]> };
  /** The event's name in the editor (not shown to players), by kind and id. */
  names: Record<string, string>;
  variables: Record<number, { name: string; initial: number; persist: boolean; imported: boolean }>;
}

const BUCKETS = ["hero", "player", "town", "quest"] as const;

function readHotaScripts(r: MapReader): HotaScripts {
  const out: HotaScripts = { events: { hero: {}, player: {}, town: {}, quest: {} }, names: {}, variables: {} };
  for (const bucket of BUCKETS) {
    const n = r.i32();
    for (let i = 0; i < n; i++) {
      const id = r.i32();
      out.events[bucket][id] = readActions(r);
      out.names[`${bucket}:${id}`] = r.lenString();
    }
  }
  r.skip(5 * 4); // next IDs
  const vars = r.i32();
  for (let i = 0; i < vars; i++) {
    const id = r.i32();
    const name = r.lenString();
    const persist = r.bool(); // kept for the campaign's next scenario
    const imported = r.bool(); // starts with the previous scenario's value: none of its own
    out.variables[id] = { name: name || `var${id}`, initial: imported ? 0 : r.i32(), persist, imported };
  }
  for (let m = 0; m < 5; m++) r.skip(4 * r.i32());
  return out;
}

/** The scripts' counts per kind (hero, player, town, quest events). */
export const hotaScriptCounts = (s: HotaScripts) => BUCKETS.map((b) => Object.keys(s.events[b]).length);

function readImages(r: MapReader, n: number): HotaImage[] {
  return Array.from({ length: n }, () => ({ kind: r.i32(), sub: r.i32(), isVar: r.bool(), value: r.i32() }));
}

function readActions(r: MapReader): HotaAction[] {
  r.i32();
  r.u8();
  const out: HotaAction[] = [];
  const n = r.i32();
  for (let j = 0; j < n; j++) {
    const action = r.i32();
    switch (action) {
      case 29:
        out.push({ k: "message", text: r.lenString(), images: readImages(r, r.i32()) });
        break;
      case 6:
        out.push({ k: "rewardsMessage", text: r.lenString(), body: readActions(r) });
        break;
      case 5:
        out.push({ k: "removeObject" });
        break;
      case 27:
        out.push({ k: "disable" });
        break;
      case 7: {
        const cond = readCondition(r);
        const [proposal, progression, completion, hint] = [r.lenString(), r.lenString(), r.lenString(), r.lenString()];
        const reward = readActions(r);
        r.u8();
        out.push({ k: "quest", cond, proposal, progression, completion, hint, reward });
        break;
      }
      case 13:
        out.push({ k: "if", cond: readCondition(r), then: readActions(r), else: readActions(r) });
        break;
      case 28: {
        const body = readActions(r);
        out.push({ k: "for", body, from: readExpression(r), to: readExpression(r), variable: r.i32() });
        break;
      }
      case 11: {
        const text = r.lenString();
        out.push({ k: "questHint", text, images: readImages(r, r.i32()), log: r.bool() });
        break;
      }
      case 12: {
        // A question: 0 no pictures, 1 two choices, 2 two choices and Cancel, 3 pictures given.
        const mode = r.u8();
        const text = r.lenString();
        const yes = readActions(r);
        const no = readActions(r);
        const cancel = mode === 2 ? readActions(r) : undefined;
        const images = readImages(r, mode === 0 || mode === 3 ? r.i32() : 2);
        let extra: HotaImage[] = [];
        if (mode === 1 || mode === 2) {
          r.u8(); // "or" between the two pictures
          extra = readImages(r, r.i32());
        }
        out.push({ k: "question", mode, text, yes, no, ...(cancel ? { cancel } : {}), images, ...(extra.length ? { extra } : {}) });
        break;
      }
      case 9: {
        const take = r.bool();
        const artifact = r.i32();
        const spell = r.i32();
        out.push({ k: "artifact", take, artifact, spell, show: r.bool() });
        break;
      }
      case 25: {
        const take = r.bool();
        const artifact = r.i32();
        r.skip(4);
        out.push({ k: "warMachine", take, artifact, show: r.bool() });
        break;
      }
      case 15:
        out.push({ k: "spell", spell: r.i32(), show: r.bool() });
        break;
      case 26: {
        const take = r.bool();
        r.skip(8);
        out.push({ k: "spellbook", take, show: r.bool() });
        break;
      }
      case 8: {
        const take = r.bool();
        const creature = r.i32();
        out.push({ k: "creatures", take, creature, count: readExpression(r), show: r.bool() });
        break;
      }
      case 23: {
        const army: { creature: number; count: HotaExpr }[] = [];
        for (let k = 0; k < 7; k++) {
          const count = readExpression(r);
          army.push({ count, creature: r.i32() });
        }
        out.push({ k: "combat", army });
        break;
      }
      case 20: {
        const level = r.i32();
        out.push({ k: "secondarySkill", level, skill: r.i32(), show: r.bool() });
        break;
      }
      case 21:
      case 22:
        out.push({ k: action === 21 ? "luck" : "morale", amount: r.i32(), show: r.bool() });
        break;
      case 16:
        out.push({ k: "experience", amount: readExpression(r), show: r.bool() });
        break;
      case 17:
      case 18: {
        const amount = readExpression(r);
        out.push({ k: action === 17 ? "spellPoints" : "movement", amount, mode: r.i32(), show: r.bool() });
        break;
      }
      case 14: {
        const level = r.i32();
        const amount = readExpression(r);
        r.skip(4);
        out.push({ k: "hire", level, amount, show: r.bool() });
        break;
      }
      case 10: {
        const building = r.i32();
        const faction = r.i16();
        r.skip(2);
        out.push({ k: "build", building, faction, show: r.bool() });
        break;
      }
      case 24:
        out.push({ k: "run", bucket: r.i32(), id: r.i32() });
        break;
      case 4: {
        const mode = r.u8();
        const amounts = Array.from({ length: 7 }, () => readExpression(r));
        out.push({ k: "resources", mode, amounts, show: r.bool() });
        break;
      }
      case 19: {
        const amount = readExpression(r);
        out.push({ k: "primary", amount, skill: r.i32(), show: r.bool() });
        break;
      }
      case 3: {
        const id = r.i32();
        const mode = r.u8();
        out.push({ k: "setVar", id, mode, value: readExpressionInternal(r) });
        break;
      }
      case 2: {
        const id = r.i32();
        out.push({ k: "setVarIf", id, cond: readCondition(r), yes: readExpression(r), no: readExpression(r) });
        break;
      }
      case 1: {
        const branches: { cond: HotaCond; body: HotaAction[] }[] = [];
        for (;;) {
          branches.push({ cond: readCondition(r), body: readActions(r) });
          r.u8();
          if (r.i32() === 0) break;
        }
        r.i32();
        out.push({ k: "chain", branches });
        break;
      }
      default:
        throw new Error(`unknown HotA script action ${action}`);
    }
  }
  return out;
}

function readCondition(r: MapReader): HotaCond {
  r.u8();
  return readConditionInternal(r);
}

const COMPARE = { 3: "<", 4: ">", 5: "==", 8: ">=", 9: "<=", 10: "!=" } as const;

function readConditionInternal(r: MapReader): HotaCond {
  const code = r.i32();
  switch (code) {
    case 0:
      return { k: "const", value: r.bool() };
    case 1:
    case 2: {
      const n = r.i32();
      return { k: code === 1 ? "all" : "any", of: Array.from({ length: n }, () => readConditionInternal(r)) };
    }
    case 3:
    case 4:
    case 5:
    case 8:
    case 9:
    case 10:
      return { k: COMPARE[code], l: readExpression(r), r: readExpression(r) };
    case 6:
      return { k: "not", c: readCondition(r) };
    case 7: {
      const artifact = r.i32();
      r.i32();
      return { k: "hasArtifact", artifact };
    }
    case 11:
      return { k: "currentPlayer", player: r.i32() };
    case 12:
      return { k: "heroOwner", hero: r.i32(), player: r.i32() };
    case 13:
      return { k: "heroClass", cls: r.i32() };
    case 14:
    case 15:
      return { k: code === 14 ? "defeatedMonster" : "defeatedHero", player: r.i32(), target: r.u32() };
    case 16:
      return { k: "skill", skill: r.i32(), level: r.i32() };
    case 17:
    case 19:
      return { k: code === 17 ? "playerDefeated" : "playerHuman", player: r.i32() };
    case 18:
      return { k: "ownsTown", player: r.i32(), target: r.u32() };
    case 20:
      return { k: "startingFaction", player: r.i32(), faction: r.i32() };
    case 21:
      return { k: "townNeutral" };
    case 22:
      return { k: "heroType", hero: r.i32() };
    default:
      throw new Error(`unknown HotA script condition ${code}`);
  }
}

function readExpression(r: MapReader): HotaExpr {
  if (!r.bool()) return r.i32();
  return readExpressionInternal(r);
}

const ARITH = { 3: "+", 4: "-", 6: "*", 7: "/", 8: "%" } as const;

function readExpressionInternal(r: MapReader): HotaExpr {
  r.u8();
  const code = r.i32();
  switch (code) {
    case 0:
      return r.i32();
    case 1:
      return { k: "var", id: r.i32() };
    case 2:
      r.i32();
      return { k: "neg", e: readExpression(r) };
    case 3:
    case 4:
    case 6:
    case 7:
    case 8:
      return { k: ARITH[code], l: readExpressionInternal(r), r: readExpressionInternal(r) };
    case 5: {
      const player = r.i8();
      return { k: "resource", player, res: r.i32() };
    }
    case 9:
      return { k: "creatures", creature: r.i32() };
    case 10:
      return { k: "difficulty" };
    case 11:
      return { k: "compareDifficulty", value: r.i32() };
    case 12:
      return { k: "date" };
    case 13:
      return { k: "experience" };
    case 14:
      return { k: "level" };
    case 15:
      return { k: "primary", skill: r.i32() };
    case 16:
      return { k: "random", lo: readExpression(r), hi: readExpression(r) };
    case 17: {
      const artifact = r.i32();
      r.i32();
      return { k: "artifacts", artifact };
    }
    default:
      throw new Error(`unknown HotA script expression ${code}`);
  }
}

function readArtifacts(r: MapReader, f: Features) {
  if (!r.bool()) return undefined;
  const slot = () => {
    const a = r.artifact();
    if (f.hota >= 5) r.i16();
    return a;
  };
  const worn = Array.from({ length: f.artifactSlots }, slot);
  const backpack = Array.from({ length: r.u16() }, slot);
  return { worn, backpack };
}

/** The map's own settings for heroes wherever they turn up (taverns, prisons, the map): experience, skills, artifacts, spells. */
function readPredefinedHeroes(r: MapReader, f: Features, out: Record<number, HeroCustom>) {
  if (!f.sod) return;
  const count = f.hota >= 0 ? r.u32() : f.heroesCount;
  for (let i = 0; i < count; i++) {
    if (!r.bool()) continue;
    const c: HeroCustom = (out[i] ??= {});
    if (r.bool()) c.experience = r.u32();
    if (r.bool()) c.skills = Array.from({ length: r.u32() }, () => ({ skill: r.u8(), level: r.u8() }));
    const artifacts = readArtifacts(r, f);
    if (artifacts) c.artifacts = artifacts;
    if (r.bool()) c.biography = r.lenString();
    const gender = r.u8();
    if (gender !== 0xff) c.gender = gender;
    if (r.bool()) c.spells = r.bits(f.spellsBytes);
    if (r.bool()) c.primary = [r.u8(), r.u8(), r.u8(), r.u8()];
  }
  if (f.hota >= 5) r.skip(count * 6);
}

function messageAndGuards(r: MapReader) {
  if (!r.bool()) return {};
  const message = r.lenString();
  const guards = r.bool() ? r.army() : undefined;
  r.skip(4);
  return { message, guards };
}

function readBox(r: MapReader, f: Features) {
  const out: Record<string, unknown> = { ...messageAndGuards(r) };
  out.experience = r.u32();
  out.mana = r.i32();
  out.morale = r.i8();
  out.luck = r.i8();
  out.resources = r.resources();
  out.primary = [r.u8(), r.u8(), r.u8(), r.u8()];
  out.skills = Array.from({ length: r.u8() }, () => ({ skill: r.u8(), level: r.u8() }));
  // (HotA: a spell scroll's spell.)
  const artifacts: number[] = [];
  const scrolls: number[] = [];
  for (let n = r.u8(); n > 0; n--) {
    const a = r.artifact();
    const spell = f.hota >= 5 ? r.i16() : -1;
    if (a === 1 && spell >= 0) scrolls.push(spell);
    else artifacts.push(a);
  }
  out.artifacts = artifacts;
  if (scrolls.length) out.scrolls = scrolls;
  out.spells = Array.from({ length: r.u8() }, () => r.spell());
  out.creatures = Array.from({ length: r.u8() }, () => ({ creature: r.creature(), count: r.u16() }));
  r.skip(8);
  return out;
}

/** A reference to one of the map's scripts: its id, and whether it runs for every player at once. */
export interface HotaHandler {
  id: number;
  sync: boolean;
}
const readHandler = (r: MapReader): HotaHandler => ({ id: r.i32(), sync: r.bool() });

/** HotA's box and event extras: movement (0 give, 1 take, 2 nullify, 3 set, 4 replenish), the difficulties it's on, a script. */
function readBoxHota(r: MapReader, f: Features, box: Record<string, unknown>) {
  if (f.hota >= 5) {
    const mode = r.i32();
    const amount = r.i32();
    if (mode >= 0 && mode <= 4 && (amount || mode === 2)) box.movement = { mode, amount };
  }
  if (f.hota >= 6) {
    const mask = r.i32();
    if ((mask & 31) !== 31) box.difficulties = mask;
  }
  if (f.hota >= 9 && r.bool()) box.script = readHandler(r);
}

function readQuest(r: MapReader, f: Features): Record<string, unknown> {
  const mission = r.i8();
  const q: Record<string, unknown> = { mission };
  switch (mission) {
    case 0:
      return q;
    // 1 = reach a level, 2 = primary skills (VCMI's EQuestMission).
    case 1:
      q.level = r.u32();
      break;
    case 2:
      q.primary = [r.u8(), r.u8(), r.u8(), r.u8()];
      break;
    case 3:
    case 4:
      q.target = r.u32();
      break;
    case 5:
      q.artifacts = Array.from({ length: r.u8() }, () => {
        const a = r.artifact();
        if (f.hota >= 5) r.i16();
        return a;
      });
      break;
    case 6:
      q.creatures = Array.from({ length: r.u8() }, () => ({ creature: r.creature(), count: r.u16() }));
      break;
    case 7:
      q.resources = Array.from({ length: 7 }, () => r.u32());
      break;
    case 8:
      q.hero = r.hero();
      break;
    case 9:
      q.player = r.u8();
      break;
    // HotA's own: 0 = be of one of these hero classes, 1 = come on this day or later, 2 = (VCMI
    // reads a number), 3 = (five bytes).
    case 10: {
      const sub = r.u32();
      q.hota = sub;
      if (sub === 0) q.classes = r.sizedBits();
      else if (sub === 1 || sub === 2) q.value = r.u32();
      else if (sub === 3) q.script = readHandler(r);
      break;
    }
  }
  q.lastDay = r.i32();
  q.firstVisit = r.lenString();
  q.nextVisit = r.lenString();
  q.completed = r.lenString();
  return q;
}

function readSeerReward(r: MapReader, f: Features): Record<string, unknown> {
  const reward = r.u8();
  const out: Record<string, unknown> = { reward };
  switch (reward) {
    case 1:
    case 2:
      out.amount = r.u32();
      break;
    case 3:
    case 4:
      out.amount = r.i8();
      break;
    case 5:
      out.resource = r.u8();
      out.amount = r.u32();
      break;
    case 6:
    case 7:
      out.skill = r.u8();
      out.amount = r.u8();
      break;
    case 8: {
      out.artifact = r.artifact();
      // (HotA: a spell scroll's spell.)
      const spell = f.hota >= 5 ? r.i16() : -1;
      if (out.artifact === 1 && spell >= 0) out.spell = spell;
      break;
    }
    case 9:
      out.spell = r.spell();
      break;
    case 10:
      out.creature = r.creature();
      out.amount = r.u16();
      break;
  }
  return out;
}

function readSeerHut(r: MapReader, f: Features) {
  const quests: Record<string, unknown>[] = [];
  // (HotA: quests done one after another, then ones that can be done again and again.)
  const one = (repeat = false) => {
    let q: Record<string, unknown>;
    if (f.ab) {
      q = readQuest(r, f);
    } else {
      const artifact = r.artifact();
      q = artifact === -1 ? { mission: 0 } : { mission: 5, artifacts: [artifact] };
    }
    if (q.mission !== 0) {
      if (f.hota >= 10) q.timeout = r.lenString();
      Object.assign(q, readSeerReward(r, f));
    } else {
      r.skip(1);
    }
    if (repeat) q.repeat = true;
    quests.push(q);
  };
  const count = f.hota >= 3 ? r.u32() : 1;
  for (let i = 0; i < count; i++) one();
  if (f.hota >= 3) {
    const repeat = r.u32();
    for (let i = 0; i < repeat; i++) one(true);
  }
  const name = f.hota >= 10 && r.bool() ? r.lenString() : undefined;
  r.skip(2);
  return { quests, name };
}

function readHero(r: MapReader, f: Features) {
  const out: Record<string, unknown> = {};
  if (f.ab) out.identifier = r.u32();
  out.owner = r.u8();
  out.hero = r.hero();
  if (r.bool()) out.name = r.lenString();
  if (f.sod) {
    if (r.bool()) out.experience = r.u32();
  } else {
    out.experience = r.u32();
  }
  if (r.bool()) out.portrait = r.u8();
  if (r.bool()) out.skills = Array.from({ length: r.u32() }, () => ({ skill: r.u8(), level: r.u8() }));
  if (r.bool()) out.army = r.army();
  out.formation = r.u8();
  out.artifacts = readArtifacts(r, f);
  out.patrol = r.u8();
  if (f.ab) {
    if (r.bool()) out.biography = r.lenString();
    out.gender = r.i8();
  }
  if (f.sod) {
    if (r.bool()) out.spells = r.bits(f.spellsBytes);
  } else if (f.ab) {
    out.spell = r.spell();
  }
  if (f.sod && r.bool()) out.primary = [r.u8(), r.u8(), r.u8(), r.u8()];
  r.skip(16);
  if (f.hota >= 5) r.skip(6);
  return out;
}

function readEventCommon(r: MapReader, f: Features) {
  const e: Record<string, unknown> = { name: r.lenString(), message: r.lenString(), resources: r.resources(), players: r.u8() };
  e.human = f.sod ? r.bool() : true;
  e.computer = r.bool();
  e.first = r.u16();
  e.every = r.u16();
  r.skip(16);
  // HotA: the difficulties it happens on (bit per difficulty, Easy first); a script it runs.
  if (f.hota >= 7) {
    const mask = r.i32();
    if ((mask & 31) !== 31) e.difficulties = mask;
  }
  if (f.hota >= 9 && r.bool()) e.script = readHandler(r);
  return e;
}

function readTown(r: MapReader, f: Features) {
  const out: Record<string, unknown> = {};
  if (f.ab) out.identifier = r.u32();
  out.owner = r.u8();
  if (r.bool()) out.name = r.lenString();
  if (r.bool()) out.army = r.army();
  out.formation = r.u8();
  if (r.bool()) {
    out.built = r.bits(f.buildingsBytes);
    out.forbidden = r.bits(f.buildingsBytes);
  } else {
    out.hasFort = r.bool();
  }
  if (f.ab) out.obligatorySpells = r.bits(f.spellsBytes);
  out.possibleSpells = r.bits(f.spellsBytes, true);
  // HotA: whether the town's mage guild allows spell research.
  if (f.hota >= 1) out.spellResearch = r.bool();
  if (f.hota >= 5) r.skip(r.u32());
  // Town events: on given days, resources, buildings and creatures for this town.
  const events = r.u32();
  const townEvents: Record<string, unknown>[] = [];
  for (let i = 0; i < events; i++) {
    const e = readEventCommon(r, f);
    if (f.hota >= 5) r.skip(14);
    // HotA: for the town while it's neutral too.
    if (f.hota >= 7 && r.bool()) e.neutral = true;
    e.buildings = r.bits(f.buildingsBytes);
    e.creatures = Array.from({ length: 7 }, () => r.u16());
    r.skip(4);
    townEvents.push(e);
  }
  if (townEvents.length) out.events = townEvents;
  if (f.sod) out.alignment = r.u8();
  r.skip(3);
  return out;
}

/** Reads an object's payload; layout depends on the template's object id. */
function readObject(r: MapReader, f: Features, t: ObjectTemplate, players: PlayerSlot[]): Record<string, unknown> {
  void players;
  const { id, subid } = t;
  switch (id) {
    case 26: {
      // Event
      const box = readBox(r, f);
      box.players = r.u8();
      box.computer = r.bool();
      box.removeAfterVisit = r.bool();
      r.skip(4);
      if (f.hota >= 3) box.human = r.bool();
      readBoxHota(r, f, box);
      return box;
    }
    case 34:
    case 70:
    case 62:
      return readHero(r, f);
    case 54:
    case 71:
    case 72:
    case 73:
    case 74:
    case 75:
    case 162:
    case 163:
    case 164: {
      const m: Record<string, unknown> = {};
      if (f.ab) m.identifier = r.u32();
      m.count = r.u16();
      m.character = r.u8();
      if (r.bool()) {
        m.message = r.lenString();
        m.resources = r.resources();
        m.artifact = r.artifact();
      }
      m.neverFlees = r.bool();
      m.noGrowth = r.bool();
      r.skip(2);
      // HotA: an exact aggression (-1: by the disposition), joining only for gold, the share that
      // joins, whether one stack is upgraded (-1 random, 0 never, 1 always) and the stacks (-1 default).
      if (f.hota >= 3) {
        const aggression = r.i32();
        if (aggression !== -1) m.aggression = aggression;
        m.joinOnlyForMoney = r.bool();
        m.joiningPercentage = r.i32();
        m.upgradedStack = r.i32();
        m.stacksCount = r.i32();
      }
      if (f.hota >= 5) {
        m.sizeByValue = r.bool();
        m.targetValue = r.i32();
      }
      return m;
    }
    case 59:
    case 91: {
      const message = r.lenString();
      r.skip(4);
      return { message };
    }
    case 83:
      return readSeerHut(r, f);
    case 113:
      return f.ab ? { skills: r.bits(f.skillsBytes) } : {};
    case 81: {
      const kind = r.i8();
      const value = r.u8();
      r.skip(6);
      return { kind, value };
    }
    case 33:
    case 219: {
      const owner = r.i32();
      const army = r.army();
      const removable = f.ab ? r.bool() : true;
      r.skip(8);
      return { owner, army, removable };
    }
    case 5:
    case 65:
    case 66:
    case 67:
    case 68:
    case 69: {
      const out = messageAndGuards(r);
      if (f.hota >= 5) r.skip(5);
      return out;
    }
    case 93: {
      const out = messageAndGuards(r);
      return { ...out, spell: r.i32() };
    }
    case 76:
    case 79: {
      const out = messageAndGuards(r);
      const amount = r.u32();
      r.skip(4);
      return { ...out, amount };
    }
    case 77:
    case 98:
      return readTown(r, f);
    case 53:
    case 220:
      if (subid < 7) return { owner: r.i32() };
      {
        // Abandoned Mine: the resources it may turn out to produce, and (HotA) its own guards.
        const resources = r.bits(4);
        if (f.hota >= 5 && r.bool()) return { resources, guards: { creature: r.i32(), min: r.i32(), max: r.i32() } };
        if (f.hota >= 5) r.skip(12);
        return { resources };
      }
    case 17:
    case 18:
    case 19:
    case 20:
      return { owner: r.i32() };
    case 88:
    case 89:
    case 90:
      return { spell: r.i32() };
    case 6: {
      const box = readBox(r, f);
      if (f.hota >= 5) r.skip(1);
      readBoxHota(r, f, box);
      return box;
    }
    case 36:
      return subid < 1000 ? { radius: r.i32() } : {};
    case 216:
    case 217:
    case 218: {
      const out: Record<string, unknown> = { owner: r.i32() };
      if (id === 216 || id === 217) {
        out.identifier = r.u32();
        if (out.identifier === 0) out.factions = r.u16();
      }
      if (id === 216 || id === 218) {
        out.minLevel = r.u8();
        out.maxLevel = r.u8();
      }
      return out;
    }
    case 215: {
      const q = readQuest(r, f);
      if (f.hota >= 10) q.timeout = r.lenString();
      return q;
    }
    case 87:
    case 42:
      return { owner: r.i32() };
    case 214: {
      const out: Record<string, unknown> = { owner: r.u8(), hero: r.hero() };
      if (out.hero === -1) out.power = r.u8();
      if (f.hota >= 5) {
        r.bool();
        r.skip(7 * 8);
        r.skip(r.i32() * 4);
      }
      return out;
    }
    case 16:
    case 24:
    case 25:
    case 84:
    case 85:
      if (f.hota >= 3) {
        // HotA's chosen bank: its guards (0-4: the level, -1 random), the upgraded stack (-1 random,
        // 0 never, 1 always), its artifacts (each one, -1 random; none listed: as usual).
        const level = r.i32();
        const upgraded = r.i8();
        const artifacts = Array.from({ length: r.u32() }, () => r.i32());
        if (level >= 0 || upgraded >= 0 || artifacts.some((a) => a >= 0)) return { preset: { content: level, upgraded, artifacts } };
      }
      return {};
    case 212:
      // HotA reuses Border Gate for its Quest Gate.
      if (subid === 1000) {
        const q = readQuest(r, f);
        if (f.hota >= 10) q.timeout = r.lenString();
        return q;
      }
      return f.hota >= 5 ? hotaContents(r, f, id, subid) : {};
    default:
      return f.hota >= 5 ? hotaContents(r, f, id, subid) : {};
  }
}

/**
 * What a HotA 1.7+ map chose for a simple reward object, after VCMI's readers (MapFormatH3M.cpp):
 * `content` the reward's index in the object's own list (VCMI's "mapDice"; -1 random), with what
 * goes with it (an artifact, a spell, resources and amounts, a creature). Absent: as usual.
 */
export interface HotaPreset {
  content: number;
  artifact?: number;
  spell?: number;
  amount?: number;
  res?: number;
  amountB?: number;
  resB?: number;
  creature?: number;
  creatureAmount?: number;
  /** A bank's: the upgraded stack (-1 random, 0 never, 1 always), its artifacts (-1 random). */
  upgraded?: number;
  artifacts?: number[];
  /** The Black Market's seven: an artifact, or a scroll (artifact 1) with its spell; -1 random. */
  market?: { artifact: number; spell: number }[];
  /** A University's chosen skills. */
  skills?: number[];
}

/** An artifact id stored in 4 bytes (sometimes 2 bytes of artifact, 2 of a scroll's spell); -1 none. */
const artifact32 = (raw: number) => (raw >= 0 && raw < 0xffff ? raw : raw > 0 && (raw & 0xffff) < 0xffff ? raw & 0xffff : -1);

function hotaContents(r: MapReader, f: Features, id: number, subid: number): { preset?: HotaPreset } {
  const keep = (p: HotaPreset) => (p.content === -1 && !p.market && !p.skills ? {} : { preset: p });
  // content, artifact, amount A, resource A, amount B, resource B
  const block = () => ({ content: r.i32(), artifact: r.i32(), amount: r.i32(), res: r.i8(), amountB: r.i32(), resB: r.i8() });
  const withArtifact = (artifactIndex: number) => {
    const content = r.i32();
    const art = artifact32(r.i32());
    return keep(content === artifactIndex && art >= 0 ? { content, artifact: art } : { content });
  };
  const garbage = () => {
    const content = r.i32();
    r.skip(4);
    return keep({ content });
  };
  switch (id) {
    case 101: // treasure chest
      return withArtifact(3);
    case 22: // corpse
      return withArtifact(1);
    case 108: // warrior's tomb
    case 86: // shipwreck survivor
      return withArtifact(0);
    case 82: // sea chest
      return withArtifact(2);
    case 29: // flotsam
    case 102: // tree of knowledge
      return garbage();
    case 63: {
      // pyramid: content 0, its spell
      const content = r.i32();
      const spell = r.i32();
      return keep(content === 0 && spell >= 0 ? { content, spell } : { content });
    }
    case 7: {
      // black market: seven artifacts (16 bits) with a scroll's spell (16 bits), 0xffff random
      const market = Array.from({ length: 7 }, () => {
        const artifact = r.u16();
        const spell = r.u16();
        return { artifact: artifact === 0xffff ? -1 : artifact, spell: spell === 0xffff ? -1 : spell };
      });
      return market.some((m) => m.artifact >= 0) ? { preset: { content: 0, market } } : {};
    }
    case 104: {
      // university: chosen (0) or random (-1), its skills
      const content = r.i32();
      const skills = r.bits(f.skillsBytes);
      return content === -1 ? {} : { preset: { content, skills } };
    }
    case 12: // campfire: two resources
    case 39: // lean-to: one resource
    case 105: {
      // wagon: -1 random, 0 chosen (its artifact, else its resource), 1 empty
      const b = block();
      if (b.content === -1) return {};
      const art = artifact32(b.artifact);
      return { preset: { content: b.content, ...(art >= 0 ? { artifact: art } : {}), amount: b.amount, res: b.res, ...(id === 12 ? { amountB: b.amountB, resB: b.resB } : {}) } };
    }
    case 144: // HotA custom object 3: the Trapper Lodge (1.8): -1 random, 0 gold, 1 creatures
      if (subid === 12 && f.hota >= 9) {
        const content = r.i32();
        const amount = r.i32();
        const creatureAmount = r.i32();
        const creature = r.i32();
        return keep({ content, amount, creatureAmount, creature });
      }
      return {};
    case 145: {
      // HotA custom object 1: Ancient Lamp (0: its amount), Sea Barrel (1: a resource), Jetsam, Vial of Mana
      if (subid === 0 || subid === 1) {
        const b = block();
        if (b.content === -1) return {};
        return { preset: subid === 0 ? { content: b.content, amount: b.amount } : { content: b.content, amount: b.amount, res: b.res } };
      }
      return garbage();
    }
    case 146: // HotA custom object 2: the Seafaring Academy (a university)
      if (subid === 0) {
        const content = r.i32();
        const skills = r.bits(f.skillsBytes);
        return content === -1 ? {} : { preset: { content, skills } };
      }
      return {};
    case 212: {
      // the Grave: its artifact and gold
      if (subid !== 1001) return {};
      const b = block();
      if (b.content === -1) return {};
      const art = artifact32(b.artifact);
      return { preset: { content: b.content, ...(art >= 0 ? { artifact: art } : {}), amount: b.amount, res: b.res } };
    }
  }
  return {};
}

/**
 * OBJECTS.TXT: every object template in the game. Masks are 48 '0'/'1'
 * characters starting at the anchor (bottom-right) tile: char i*8+j is tile
 * (-j, -i). The map file stores the same grid the other way round (anchor =
 * last bit), so we convert to the map's 6-byte form.
 */
export function parseObjectsTxt(text: string): ObjectTemplate[] {
  const out: ObjectTemplate[] = [];
  const mask = (s: string) => {
    const bytes = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 8; j++) if (s[i * 8 + j] === "1") bytes[5 - i] |= 1 << (7 - j);
    return bytes;
  };
  for (const line of text.split(/\r?\n/).slice(1)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 9) continue;
    out.push({
      def: p[0].toLowerCase().replace(/\.def$/, "") + ".def",
      blockMask: mask(p[1]),
      visitMask: mask(p[2]),
      // (The last digit is dirt, the first water: as the map file's bits read from the top.)
      terrainMask: parseInt(p[3], 2),
      menuMask: parseInt(p[4], 2),
      id: Number(p[5]),
      subid: Number(p[6]),
      type: Number(p[7]),
      printPriority: Number(p[8]),
    });
  }
  return out;
}
