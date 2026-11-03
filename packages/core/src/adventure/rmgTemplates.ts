// The original's random map templates (RMG.TXT: SoD's own, and HotA's in _HD3_Data/Templates/<name>/rmg.txt).
// Each template is a set of zones (start zones, treasure zones, junctions: their size, towns, mines,
// terrain, monster strength and treasure) and the connections between them (each with the value
// of its guard). Rows hold a zone and a connection side by side; a row with a name starts a template.
import { parseTxt } from "@heroes/formats";

/** The size codes in RMG.TXT: a Small map is 1, and each size counts by area, twice with the underground. */
export function rmgSizeCode(size: number, levels: number): number {
  return Math.round((size / 36) ** 2) * levels;
}

export interface RmgTowns {
  towns: number;
  castles: number;
  townDensity: number;
  castleDensity: number;
}

export interface RmgZone {
  id: number;
  type: "human" | "computer" | "treasure" | "junction";
  /** Relative size. */
  size: number;
  /** Which players' counts the zone is there for: humans and players in all. */
  humans: [number, number];
  total: [number, number];
  /** The player (1..8) whose start zone it is, or whose towns it holds. */
  owner: number;
  playerTowns: RmgTowns;
  neutralTowns: RmgTowns;
  sameType: boolean;
  /** Allowed towns (bits by faction: Castle .. Conflux). */
  townTypes: number;
  /** Mines by resource (wood, mercury, ore, sulfur, crystal, gems, gold): at least, and more by density. */
  mines: number[];
  mineDensity: number[];
  matchTerrain: boolean;
  /** Allowed terrains, bits by RMG.TXT's order: dirt, sand, grass, snow, swamp, rough, cave (subterranean), lava. */
  terrains: number;
  /** none, weak, avg or strong. */
  monsters: "none" | "weak" | "avg" | "strong";
  monsterMatch: boolean;
  /** Monsters' factions allowed (bits: neutral, then Castle .. Conflux). */
  monsterTypes: number;
  /** Up to three tiers of treasure: piles worth low..high, `density` of them. */
  treasure: { low: number; high: number; density: number }[];
  /** The level it must be on (VCMI's forcedLevel: 0 the surface, 1 underground), else wherever the layout puts it. */
  level?: number;
}

export interface RmgConnection {
  a: number;
  b: number;
  /** The guard's value (0: none). */
  value: number;
  wide: boolean;
  borderGuard: boolean;
  humans: [number, number];
  total: [number, number];
  /** By a pair of monoliths even where the zones touch (VCMI's forcePortal). */
  portal?: boolean;
  /** Its road: false none, "random" one half the time (VCMI's); else one, as every RMG.TXT passage has. */
  road?: false | "random";
}

export interface RmgTemplate {
  name: string;
  /** The folder it came from (HotA keeps one template set per folder). */
  folder: string;
  minSize: number;
  maxSize: number;
  zones: RmgZone[];
  connections: RmgConnection[];
  /** The players it's for, least and most (VCMI's templates say; RMG.TXT's go by their zones). */
  players?: [number, number];
}

const num = (s: string | undefined) => {
  const n = Number((s ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};
const mark = (s: string | undefined) => (s ?? "").trim().toLowerCase() === "x";
const bits = (row: string[], from: number, count: number) => {
  let b = 0;
  for (let i = 0; i < count; i++) if (mark(row[from + i])) b |= 1 << i;
  return b;
};
const range = (row: string[], at: number): [number, number] => [num(row[at]), num(row[at + 1])];

/** Every template in one RMG.TXT. */
export function parseRmgTxt(bytes: Uint8Array, folder = ""): RmgTemplate[] {
  const rows = parseTxt(bytes);
  const out: RmgTemplate[] = [];
  let t: RmgTemplate | null = null;
  // The header rows end with the column names ("Name", "Minimum Size"...); some files have a blank row after them.
  const head = rows.findIndex((r) => (r[0] ?? "").trim() === "Name");
  for (const row of rows.slice(head + 1)) {
    const name = (row[0] ?? "").replace(/\s+/g, " ").trim();
    const id = num(row[3]);
    // (Some files repeat the name on every row: the same template goes on until its zones start again.)
    if (name && !(t && t.name === name && id > 0 && t.zones.every((z) => z.id < id))) {
      t = { name, folder, minSize: num(row[1]), maxSize: num(row[2]), zones: [], connections: [] };
      out.push(t);
    }
    if (!t) continue;
    if (id > 0) {
      const type = mark(row[4]) ? "human" : mark(row[5]) ? "computer" : mark(row[7]) ? "junction" : "treasure";
      const towns = (at: number): RmgTowns => ({ towns: num(row[at]), castles: num(row[at + 1]), townDensity: num(row[at + 2]), castleDensity: num(row[at + 3]) });
      const strength = (row[55] ?? "").trim().toLowerCase();
      t.zones.push({
        id,
        type,
        size: num(row[8]) || 1,
        humans: range(row, 9),
        total: range(row, 11),
        owner: num(row[13]),
        playerTowns: towns(14),
        neutralTowns: towns(18),
        sameType: mark(row[22]),
        townTypes: bits(row, 23, 9),
        mines: Array.from({ length: 7 }, (_, i) => num(row[32 + i])),
        mineDensity: Array.from({ length: 7 }, (_, i) => num(row[39 + i])),
        matchTerrain: mark(row[46]),
        terrains: bits(row, 47, 8),
        monsters: strength === "none" ? "none" : strength === "weak" ? "weak" : strength === "strong" ? "strong" : "avg",
        monsterMatch: mark(row[56]),
        monsterTypes: bits(row, 57, 10),
        treasure: [0, 1, 2].map((k) => ({ low: num(row[67 + 3 * k]), high: num(row[68 + 3 * k]), density: num(row[69 + 3 * k]) })).filter((x) => x.density > 0 && x.high > 0),
      });
    }
    const a = num(row[76]);
    const b = num(row[77]);
    if (a > 0 && b > 0) t.connections.push({ a, b, value: num(row[78]), wide: mark(row[79]), borderGuard: mark(row[80]), humans: range(row, 81), total: range(row, 83) });
  }
  return out.filter((x) => x.zones.length > 0);
}

const LATIN = new Map<string, number>();

/**
 * Several RMG.TXT files in one (how the game fetches them: /res/rmgtemplates.txt): each starts with
 * a line "@@@ <folder>".
 */
export function parseRmgBundle(bytes: Uint8Array): RmgTemplate[] {
  // ("latin1" decodes as Windows-1252: its 0x80-0x9f back to the bytes they came from, for the UTF-8 files.)
  if (!LATIN.size) for (let b = 0x80; b < 0xa0; b++) LATIN.set(new TextDecoder("latin1").decode(Uint8Array.of(b)), b);
  const text = new TextDecoder("latin1").decode(bytes);
  const out: RmgTemplate[] = [];
  for (const part of text.split(/^@@@ /m).slice(1)) {
    const nl = part.indexOf("\n");
    const folder = part.slice(0, nl).trim();
    const body = part.slice(nl + 1);
    // One of VCMI's template files (VCMI_HOTA_TEMPLATES), in UTF-8.
    if (/\.json$/i.test(folder)) {
      try {
        out.push(...parseVcmiTemplates(new TextDecoder().decode(Uint8Array.from(body, (c) => LATIN.get(c) ?? c.charCodeAt(0)))));
      } catch {
        // (A file that isn't one: left out.)
      }
      continue;
    }
    out.push(...parseRmgTxt(new TextEncoder().encode(body), folder));
  }
  // (Latin-1 back through UTF-8: names with accents read alike everywhere, which is all that matters.)
  return out;
}

/** A template's short name for map names: lower case letters, digits and dashes. */
export function rmgSlug(t: { name: string; folder: string }): string {
  const s = (t.folder && t.folder !== t.name ? `${t.folder}-${t.name}` : t.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s.slice(0, 48).replace(/-$/, "") || "template";
}

const indexes = new WeakMap<RmgTemplate[], Map<string, RmgTemplate>>();
/** Each template by its key in map names: its slug, and -2, -3... for the ones after it with the same slug (a folder's size variants). */
export function rmgIndex(list: RmgTemplate[]): Map<string, RmgTemplate> {
  let m = indexes.get(list);
  if (m) return m;
  m = new Map();
  for (const t of list) {
    const s = rmgSlug(t);
    let key = s;
    for (let k = 2; m.has(key); k++) key = `${s}-${k}`;
    m.set(key, t);
  }
  indexes.set(list, m);
  return m;
}

/** The key of a template in rmgIndex. */
export function rmgKey(list: RmgTemplate[], t: RmgTemplate): string | undefined {
  for (const [k, v] of rmgIndex(list)) if (v === t) return k;
  return undefined;
}

/** What the template list shows: the template's name without its notes in brackets (the Match Terrain set's marked so). */
export function rmgTitle(t: RmgTemplate): string {
  const name = t.name.replace(/\s*\(.*$/, "").trim() || t.name;
  return /^match terrain$/i.test(t.folder) ? `${name} (match terrain)` : name;
}

/** The zones and connections a template has for these players (humans, players in all). */
export function rmgFor(t: RmgTemplate, humans: number, players: number): { zones: RmgZone[]; connections: RmgConnection[] } {
  const fits = (h: [number, number], p: [number, number]) => (h[1] === 0 || (humans >= h[0] && humans <= h[1])) && (p[1] === 0 || (players >= p[0] && players <= p[1]));
  const zones = t.zones.filter((z) => fits(z.humans, z.total));
  const ids = new Set(zones.map((z) => z.id));
  const connections = t.connections.filter((c) => ids.has(c.a) && ids.has(c.b) && fits(c.humans, c.total));
  // Zones no connection leads to for this many players are left out (the starts' side of the template is the map).
  const reach = new Set(zones.filter((z) => z.type === "human" || z.type === "computer").slice(0, 1).map((z) => z.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of connections)
      if (reach.has(c.a) !== reach.has(c.b)) {
        reach.add(c.a).add(c.b);
        grew = true;
      }
  }
  return { zones: zones.filter((z) => reach.has(z.id)), connections: connections.filter((c) => reach.has(c.a)) };
}

/** Templates that can make a map of this size for these players (enough start zones, humans in ones they may hold). */
export function rmgTemplatesFor(list: RmgTemplate[], size: number, levels: number, humans: number, players: number): RmgTemplate[] {
  const code = rmgSizeCode(size, levels);
  return list.filter((t) => {
    if (code < t.minSize || code > t.maxSize) return false;
    if (t.players && (players < t.players[0] || players > t.players[1])) return false;
    const { zones, connections } = rmgFor(t, humans, players);
    const starts = zones.filter((z) => z.type === "human" || z.type === "computer");
    if (starts.length < players || starts.filter((z) => z.type === "human").length < humans) return false;
    // (Underground, a zone that isn't a start to put there: else rmg.ts falls back to its own sparse layout.)
    if (levels > 1 && starts.length === zones.length) return false;
    // (rmgFor keeps only what the first start reaches: every start must be in it.)
    return connections.length > 0 || zones.length === 1;
  });
}

/**
 * HotA's templates as VCMI keeps them (its HotA mod: mods/templates/content/config/hota*.json), for
 * servers without HotA's own _HD3_Data/Templates. Fetched one by one (/res/<name>), each a file of
 * the bundle (parseRmgBundle: "@@@ <file name>" and the JSON).
 */
export const VCMI_HOTA_TEMPLATES = [
  "hota2sm2c(2).json",
  "hota2sm4d(3).json",
  "hota6lm10a.json",
  "hota8mm6a.json",
  "hota8xm12a.json",
  "hotaApocalypse.json",
  "hotaBlackNBlue.json",
  "hotaBoomerang.json",
  "hotaDiamond.json",
  "hotaDoubled8mm6.json",
  "hotaJebusCross.json",
  "hotaKerberos.json",
  "hotaMiniNostalgia.json",
  "hotaNineDayWonder.json",
  "hotaNostalgia.json",
  "hotaSkirmish(M).json",
  "hotaSpider.json",
];

/** VCMI's JSON with its comments and trailing commas taken out (strings kept as they are). */
function looseJson(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const VCMI_SIZES: Record<string, number> = { s: 1, m: 4, l: 9, xl: 16, h: 25, xh: 36, g: 49 };
const VCMI_TERRAINS = ["dirt", "sand", "grass", "snow", "swamp", "rough", "subterra", "lava"];
const VCMI_MINES = ["wood", "mercury", "ore", "sulfur", "crystal", "gems", "gold"];
const VCMI_FACTIONS = ["castle", "rampart", "tower", "inferno", "necropolis", "dungeon", "stronghold", "fortress", "conflux"];

/** Every template in one of VCMI's template files (its zones' "...LikeZone" resolved). */
export function parseVcmiTemplates(text: string, folder = ""): RmgTemplate[] {
  type J = Record<string, any>;
  const root = looseJson(text) as J;
  const size = (s: unknown) => {
    const m = /^(\w+?)(\+u)?$/i.exec(String(s ?? "").trim());
    return m ? (VCMI_SIZES[m[1].toLowerCase()] ?? 1) * (m[2] ? 2 : 1) : 1;
  };
  const range = (s: unknown): [number, number] => {
    const m = /^(\d+)(?:-(\d+))?$/.exec(String(s ?? "").trim());
    return m ? [Number(m[1]), Number(m[2] ?? m[1])] : [0, 0];
  };
  /** A faction's name ("necropolis", "hota.cove:cove") to its index in our lists, -1 when there's none. */
  const faction = (s: string) => VCMI_FACTIONS.indexOf(s.replace(/^.*:/, "").toLowerCase());
  const factionBits = (allowed: unknown, banned: unknown, all: number, at = 0) => {
    let b = Array.isArray(allowed) && allowed.length ? 0 : all;
    if (Array.isArray(allowed)) for (const s of allowed) b |= s === "neutral" ? 1 : faction(String(s)) >= 0 ? 1 << (faction(String(s)) + at) : 0;
    if (Array.isArray(banned)) for (const s of banned) b &= ~(s === "neutral" ? 1 : faction(String(s)) >= 0 ? 1 << (faction(String(s)) + at) : 0);
    return b;
  };
  const towns = (t: J | undefined): RmgTowns => ({ towns: t?.towns ?? 0, castles: t?.castles ?? 0, townDensity: t?.townDensity ?? 0, castleDensity: t?.castleDensity ?? 0 });
  const out: RmgTemplate[] = [];
  for (const [rawName, t] of Object.entries(root as Record<string, J>)) {
    if (!t || typeof t !== "object" || !t.zones) continue;
    // (As VCMI lists them: "[HotA] Jebus Cross", beside the original's own Jebus Cross.)
    const name = rawName.replace(/\s+/g, " ").trim();
    const raw = t.zones as Record<string, J>;
    // (A zone "like" another takes that one's mines, treasure or terrain, through as many as it takes.)
    const like = (id: string, key: string, depth = 0): J => {
      const z = raw[id];
      const other = z?.[`${key}LikeZone`];
      return other !== undefined && depth < 10 && raw[String(other)] ? like(String(other), key, depth + 1) : z;
    };
    const zones: RmgZone[] = [];
    for (const [id, z] of Object.entries(raw)) {
      // Water zones: the generator makes its own sea (the Water option).
      if (z.type === "water" || z.type === "sealed") continue;
      const mines = like(id, "mines").mines ?? {};
      const ground = like(id, "terrainType");
      const strength = String(z.monsters ?? "normal");
      const level = z.forcedLevel === "underground" ? 1 : z.forcedLevel === "surface" ? 0 : undefined;
      zones.push({
        id: Number(id),
        type: z.type === "playerStart" ? "human" : z.type === "cpuStart" ? "computer" : z.type === "junction" ? "junction" : "treasure",
        size: z.size ?? 1,
        humans: [0, 0],
        total: [0, 0],
        owner: z.owner ?? 0,
        playerTowns: towns(z.playerTowns),
        neutralTowns: towns(z.neutralTowns),
        sameType: !!z.townsAreSameType,
        townTypes: factionBits(z.allowedTowns, z.bannedTowns, 0x1ff),
        mines: VCMI_MINES.map((r) => Number(mines[r] ?? 0)),
        mineDensity: VCMI_MINES.map(() => 0),
        matchTerrain: ground.matchTerrainToTown ?? z.matchTerrainToTown ?? true,
        terrains: Array.isArray(ground.terrainTypes) ? ground.terrainTypes.reduce((b: number, s: string) => b | (VCMI_TERRAINS.includes(s) ? 1 << VCMI_TERRAINS.indexOf(s) : 0), 0) || 0xff : 0xff,
        monsters: strength === "none" ? "none" : strength === "weak" ? "weak" : strength === "strong" ? "strong" : "avg",
        monsterMatch: false,
        monsterTypes: factionBits(z.allowedMonsters, z.bannedMonsters, 0x3ff, 1),
        treasure: ((like(id, "treasure").treasure ?? []) as J[]).map((x) => ({ low: x.min ?? 0, high: x.max ?? 0, density: x.density ?? 0 })).filter((x) => x.density > 0 && x.high > 0),
        ...(level !== undefined ? { level } : {}),
      });
    }
    const ids = new Set(zones.map((z) => z.id));
    const connections: RmgConnection[] = [];
    for (const c of (t.connections ?? []) as J[]) {
      const a = Number(c.a);
      const b = Number(c.b);
      // (Fictive and repulsive ones only steer VCMI's zone placement.)
      if (!ids.has(a) || !ids.has(b) || c.type === "fictive" || c.type === "repulsive") continue;
      const road = c.road === "false" || c.road === false ? false : c.road === "random" ? "random" : true;
      connections.push({ a, b, value: c.guard ?? 0, wide: c.type === "wide", borderGuard: false, humans: [0, 0], total: [0, 0], ...(c.type === "forcePortal" ? { portal: true } : {}), ...(road !== true ? { road } : {}) });
    }
    if (!zones.length) continue;
    const players = range(t.players);
    out.push({ name, folder: folder || name, minSize: size(t.minSize), maxSize: size(t.maxSize), zones, connections, ...(players[1] ? { players } : {}) });
  }
  return out;
}

/**
 * The templates bundle (/res/rmgtemplates.txt, else the original's RMG.TXT) with HotA's templates from
 * VCMI's files (VCMI_HOTA_TEMPLATES, fetched by `get`) added when it has none of HotA's own: a server
 * with the HotA mod but without _HD3_Data/Templates still offers them.
 */
export async function rmgBundleWithVcmi(bundle: Uint8Array | undefined, original: Uint8Array | undefined, get: (name: string) => Promise<Uint8Array | undefined>): Promise<Uint8Array | undefined> {
  const latin = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
  const text = bundle ? latin(bundle) : original ? `@@@ {Original}\n${latin(original)}` : "";
  const folders = [...text.matchAll(/^@@@ (.*)$/gm)].map((m) => m[1].trim());
  if (folders.some((f) => f !== "{Original}")) return bundle;
  const files = await Promise.all(VCMI_HOTA_TEMPLATES.map((n) => get(n).catch(() => undefined)));
  const more = files.map((b, i) => (b?.length && b[0] !== 0x3c ? `\n@@@ ${VCMI_HOTA_TEMPLATES[i]}\n${latin(b)}\n` : "")).join("");
  if (!more) return bundle ?? original;
  return Uint8Array.from(text + more, (c) => c.charCodeAt(0));
}

const SIZE_NAMES: Record<number, string> = { 1: "S", 4: "M", 9: "L", 16: "XL", 25: "H", 36: "XH", 49: "G" };
/** A size code's name (rmgSizeCode): S, M, L, XL (HotA's H, XH, G), "+U" with the underground. */
export function rmgSizeName(code: number): string {
  return SIZE_NAMES[code] ?? (code % 2 === 0 && SIZE_NAMES[code / 2] ? `${SIZE_NAMES[code / 2]}+U` : String(code));
}

/** What the template list shows of a template: its sizes ("M-L+U") and players ("2-8"). */
export function rmgTemplateFacts(t: RmgTemplate): { sizes: string; players: string } {
  const sizes = t.minSize === t.maxSize ? rmgSizeName(t.minSize) : `${rmgSizeName(t.minSize)}-${rmgSizeName(t.maxSize)}`;
  const starts = t.zones.filter((z) => z.type === "human" || z.type === "computer").length;
  const [a, b] = t.players ?? [2, starts];
  return { sizes, players: a === b ? String(a) : `${a}-${b}` };
}
