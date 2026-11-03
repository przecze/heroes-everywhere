// Towns: buildings, recruitment, weekly growth and income.
import { parseTxt } from "@heroes/formats";
import { randInt } from "../rng.ts";
import { stockGuild } from "./magic.ts";
import { DWELLINGS } from "../dwellingData.ts";
import { MAP_BUILDING_BITS, MAP_SPECIAL_BITS, type Requirement, TOWNS, type TownInfo } from "../townData.ts";
import type { AdventureState, AdvObject, ArmySlot, Hero } from "./types.ts";
import { Terrain, type World, revealOwned, visitTile } from "./world.ts";
import { specialtyOf } from "../specialty.ts";
import { wornArtifacts } from "./artifacts.ts";
import { Refusal } from "../refusal.ts";
import { BANK_LOAN } from "./townSpecials.ts";

export const B = {
  MAGE_GUILD_1: 0,
  TAVERN: 5,
  SHIPYARD: 6,
  FORT: 7,
  CITADEL: 8,
  CASTLE: 9,
  VILLAGE_HALL: 10,
  TOWN_HALL: 11,
  CITY_HALL: 12,
  CAPITOL: 13,
  MARKETPLACE: 14,
  RESOURCE_SILO: 15,
  BLACKSMITH: 16,
  HORDE_1: 18,
  HORDE_1_UPG: 19,
  HORDE_2: 24,
  HORDE_2_UPG: 25,
  GRAIL: 26,
  DWELLING: 30,
  DWELLING_UPG: 37,
} as const;

/** The Factory's eighth creature level (the Gantry) has its own building ids, as in VCMI. */
const DWELLING_8 = 150;
const DWELLING_8_UPG = 151;

/** The building that houses creature level `level` (0-based), basic or upgraded. */
export function dwellingId(level: number, upgraded = false): number {
  if (level === 7) return upgraded ? DWELLING_8_UPG : DWELLING_8;
  return (upgraded ? B.DWELLING_UPG : B.DWELLING) + level;
}

/** Which creature level (0-based) a dwelling building is for, or null. */
export function dwellingLevel(id: number): { level: number; upgraded: boolean } | null {
  if (id >= B.DWELLING && id < B.DWELLING + 7) return { level: id - B.DWELLING, upgraded: false };
  if (id >= B.DWELLING_UPG && id < B.DWELLING_UPG + 7) return { level: id - B.DWELLING_UPG, upgraded: true };
  if (id === DWELLING_8 || id === DWELLING_8_UPG) return { level: 7, upgraded: id === DWELLING_8_UPG };
  return null;
}

/** How many creature levels the town has (the Factory eight, the rest seven). */
export function levelCount(o: AdvObject): number {
  return townInfo(o)?.creatures.length ?? 7;
}

export interface TownState {
  built: number[];
  /** One construction per town per day. */
  builtToday: boolean;
  /** Recruitable creatures per level 1-7 (index 0-6). */
  available: number[];
  garrison: (ArmySlot | null)[];
  /** Mage guild spells by guild level (rolled when each level is built). */
  guild?: number[][];
  /** The map's spells this guild must have (placed first, never researched away) and may have. */
  mandatory?: number[];
  possible?: number[];
  /** HotA's spell research (research.ts): allowed by the map, the day of the last one, the open slot
   * ([level, slot]) and its spells to choose from, finalized slots ("level:slot"), attempts per level,
   * spells already shown (not offered again until the rest have been). */
  research?: boolean;
  researchDay?: number;
  researchSlot?: [number, number];
  researchOffer?: number[];
  researchFixed?: string[];
  researchCount?: number[];
  researchSeen?: number[];
  /** Buildings the map doesn't allow in this town (the editor's disabled buildings). */
  forbidden?: number[];
}

/** Costs and names per town and building id, from BUILDING.TXT and friends. */
export interface TownTexts {
  costs: number[][][];
  names: string[][];
  /** What the build window says about each building (the files' second column). */
  descriptions?: string[][];
}

const empty = (r: string[] | undefined) => !r?.[0]?.trim();

/** Parses BUILDING.TXT (costs) and BLDGNEUT / BLDGSPEC / DWELLING.TXT (names) like the original loader. */
export function parseTownTexts(files: { building: Uint8Array; bldgneut: Uint8Array; bldgspec: Uint8Array; dwelling: Uint8Array }): TownTexts {
  const towns = 9;
  const costs = Array.from({ length: towns }, () => Array.from({ length: 44 }, () => [0, 0, 0, 0, 0, 0, 0]));
  const names = Array.from({ length: towns }, () => Array<string>(44).fill(""));
  const rows = parseTxt(files.building);
  let i = 2;
  const cost = (r: string[]) => [0, 1, 2, 3, 4, 5, 6].map((k) => Number(r[k]) || 0);
  for (let t = 0; t < towns; t++) {
    i += 2;
    for (let b = 17; !empty(rows[i]) && i < rows.length; b++) costs[t][b] = cost(rows[i++]);
  }
  i += 3;
  for (let b = 0; !empty(rows[i]) && i < rows.length; b++) {
    const c = cost(rows[i++]);
    for (let t = 0; t < towns; t++) costs[t][b] = c;
  }
  i += 2;
  for (let t = 0; t < towns; t++) {
    i += 2;
    for (let b = 30; b < 44; b++) costs[t][b] = cost(rows[i++] ?? []);
  }

  const descriptions = Array.from({ length: towns }, () => Array<string>(44).fill(""));
  const put = (t: number, b: number, r: string[] | undefined) => {
    names[t][b] = r?.[0] ?? "";
    descriptions[t][b] = r?.[1]?.trim() ?? "";
  };
  const neut = parseTxt(files.bldgneut);
  for (let b = 0; b < 15; b++) for (let t = 0; t < towns; t++) put(t, b, neut[b]);
  for (let t = 0; t < towns; t++) put(t, 20, neut[18]);
  for (let t = 0; t < towns; t++) put(t, 16, neut[19 + t]);
  const spec = parseTxt(files.bldgspec);
  for (let t = 0; t < towns; t++) {
    for (let b = 0; b < 9; b++) put(t, 17 + b, spec[t * 11 + b]);
    put(t, 26, spec[t * 11 + 9]);
    put(t, 15, spec[t * 11 + 10]);
  }
  const dw = parseTxt(files.dwelling);
  for (let t = 0; t < towns; t++) for (let b = 0; b < 14; b++) put(t, 30 + b, dw[t * 14 + b]);
  return { costs, names, descriptions };
}

export function townInfo(o: AdvObject): TownInfo | undefined {
  return TOWNS[o.subid];
}

function keyToId(info: TownInfo, key: string): number | undefined {
  if (key.startsWith("horde@")) {
    const level = Number(key.slice(6));
    if (info.horde[0] === level) return B.HORDE_1;
    if (info.horde[1] === level) return B.HORDE_2;
    return undefined;
  }
  for (const [id, b] of Object.entries(info.buildings)) if (b.key === key) return Number(id);
  return undefined;
}

/** Building ids for the map format's building bits (starting buildings, town events). */
export function buildingsFromBits(o: AdvObject, bits: number[]): number[] {
  const info = townInfo(o);
  if (!info) return [];
  const special = MAP_SPECIAL_BITS[info.faction] ?? {};
  const out: number[] = [];
  for (const bit of bits) {
    const key = special[bit] ?? MAP_BUILDING_BITS[bit];
    const id = key ? keyToId(info, key) : undefined;
    if (id !== undefined) out.push(id);
  }
  return out;
}

/** Starting buildings: from the map, else the default set (hall, tavern if owned, dwelling 1, maybe 2). */
export function initialTown(s: AdventureState, o: AdvObject, mapData: Record<string, unknown>): TownState {
  const info = townInfo(o);
  const built = new Set<number>([B.VILLAGE_HALL]);
  if (info && Array.isArray(mapData.built)) {
    const special = MAP_SPECIAL_BITS[info.faction] ?? {};
    for (const bit of mapData.built as number[]) {
      const key = special[bit] ?? MAP_BUILDING_BITS[bit];
      const id = key ? keyToId(info, key) : undefined;
      if (id !== undefined) built.add(id);
    }
  } else {
    if (o.owner >= 0) built.add(B.TAVERN);
    built.add(B.DWELLING);
    if (randInt(s, 1, 100) <= 50) built.add(B.DWELLING + 1);
    if (mapData.hasFort) built.add(B.FORT);
  }
  // Upgrades imply what they upgrade (City Hall means Town Hall, ...).
  for (const id of [...built]) for (let up = info?.buildings[id]?.upgrades; up != null; up = info?.buildings[up]?.upgrades) built.add(up);
  const garrison: (ArmySlot | null)[] = Array(7).fill(null);
  if (Array.isArray(mapData.army)) {
    for (const a of mapData.army as { slot: number; creature: number; count: number }[]) if (a.creature >= 0) garrison[a.slot] = { creature: a.creature, count: a.count };
  }
  const t: TownState = { built: [...built], builtToday: false, available: Array(info?.creatures.length ?? 7).fill(0), garrison };
  const forbidden = Array.isArray(mapData.forbidden) ? buildingsFromBits(o, mapData.forbidden as number[]).filter((id) => !built.has(id)) : [];
  if (forbidden.length) t.forbidden = forbidden;
  if (mapData.spellResearch === true) t.research = true;
  const spellList = (v: unknown) => (Array.isArray(v) ? (v as number[]).filter((id) => id < 70) : []);
  const mandatory = spellList(mapData.obligatorySpells);
  if (mandatory.length) t.mandatory = mandatory;
  // Only kept when the map bans some spell here (the list is all 70 otherwise).
  const possible = spellList(mapData.possibleSpells);
  if (Array.isArray(mapData.possibleSpells) && possible.length < 70) t.possible = possible;
  addDecorations({ ...o, town: t });
  t.built.sort((a, b) => a - b);
  return t;
}

export function meets(req: Requirement | null, built: Set<number>): boolean {
  if (req === null) return true;
  if (typeof req === "number") return built.has(req);
  const [op, ...rest] = req;
  if (op === "any") return rest.some((r) => meets(r, built));
  if (op === "none") return !rest.some((r) => meets(r, built));
  return rest.every((r) => meets(r, built));
}

export function buildingCost(w: World, o: AdvObject, id: number): number[] {
  // The mod's cost first: a HotA building in a classic town (the Conflux's Vault of Ashes) has an empty row in BUILDING.TXT.
  const own = townInfo(o)?.buildings[id]?.cost;
  if (own) return own;
  const cost = [...(w.data.townTexts?.costs[o.subid]?.[id] ?? [0, 0, 0, 0, 0, 0, 0])];
  for (const [r, n] of Object.entries(HOTA_COSTS[townInfo(o)?.faction ?? ""]?.[id] ?? {})) cost[Number(r)] = n;
  return cost;
}

// HotA's changes to the classic towns (vendor/hota-mod's gameBalance/factions.json): BUILDING.TXT has the
// original's costs (HotA's own texts are in HotA.lod, which can't be read here).
// Resources: 0 wood, 1 mercury, 2 ore, 3 sulfur, 4 crystal, 5 gems, 6 gold.
const HOTA_COSTS: Record<string, Record<number, Record<number, number>>> = {
  tower: { 32: { 6: 1500 }, 39: { 6: 1500 }, 33: { 6: 2000 }, 34: { 6: 2500 }, 43: { 6: 20000 } },
  inferno: { 21: { 3: 4 }, 38: { 1: 4 }, 39: { 3: 4 } },
  necropolis: { 39: { 1: 4 }, 34: { 3: 4, 2: 5 }, 41: { 3: 4 } },
  stronghold: { 35: { 4: 0 }, 42: { 4: 10 } },
  conflux: { 36: { 6: 15000, 1: 20 } },
  // The Fair: 1000 gold and 5 wood (heroes.thelazy.net/index.php/Fair; the Bulwark page's totals agree).
  bulwark: { 17: { 6: 1000, 0: 5 } },
};
const HOTA_REQUIRES: Record<string, Record<number, Requirement>> = {
  tower: { 34: ["all", 31, 32], 41: 0, 35: 34, 43: 35 },
  inferno: { 41: 0 },
  // (40: the original's own rule, Upg. Altar of Fire needs Upg. Altar of Air, as VCMI's conflux.json.)
  conflux: { 37: ["all", 0, 18], 40: 38 },
  dungeon: { 36: ["all", 1, 33] },
  rampart: { 36: ["all", 1, 34] },
  // The Fair needs only the Marketplace (heroes.thelazy.net).
  bulwark: { 17: 14 },
};
for (const t of TOWNS) for (const [id, req] of Object.entries(HOTA_REQUIRES[t.faction] ?? {})) if (t.buildings[Number(id)]) t.buildings[Number(id)].requires = req;

/** The build window's description of a building (empty when the game files don't have one). */
export function buildingDescription(w: World, o: AdvObject, id: number): string {
  return w.data.townTexts?.descriptions?.[o.subid]?.[id] || townInfo(o)?.buildings[id]?.description || "";
}

export function buildingName(w: World, o: AdvObject, id: number): string {
  return w.data.townTexts?.names[o.subid]?.[id] || townInfo(o)?.buildings[id]?.name || townInfo(o)?.buildings[id]?.key || `Building ${id}`;
}

/** cannotBuild's answers that callers tell apart. */
export const NOT_IN_TOWN = "Not available in this town.";
/** The map forbids it in this town (the interface says it in the game's words, HALLINFO 2). */
export const FORBIDDEN_HERE = "The map forbids this building here.";
export const SHORT_OF_RESOURCES = "Not enough resources.";

/** Whether the building could go up now with enough resources (built or not, what cannotBuild allows but the price). */
export function buildableButForCost(s: AdventureState, w: World, o: AdvObject, id: number): boolean {
  const why = cannotBuild(s, w, o, id);
  return why === null || why === SHORT_OF_RESOURCES;
}

/** What a building still needs, by name: its base, then its requirements not built yet ("A or B" for a choice). */
export function missingBuildings(w: World, o: AdvObject, id: number): string[] {
  const b = townInfo(o)?.buildings[id];
  if (!b || !o.town) return [];
  const built = new Set(o.town.built);
  // A forbidding requirement ("none") asks for nothing to be built.
  const met = (r: Requirement): boolean => (typeof r === "number" ? built.has(r) : r[0] === "any" ? r.slice(1).some((x) => met(x as Requirement)) : r[0] === "none" ? true : r.slice(1).every((x) => met(x as Requirement)));
  const names = (r: Requirement): string[] => {
    if (met(r)) return [];
    if (typeof r === "number") return [buildingName(w, o, r)];
    const rest = r.slice(1) as Requirement[];
    if (r[0] === "any") return [rest.map((x) => names(x).join(", ")).filter(Boolean).join(" or ")];
    return rest.flatMap(names);
  };
  const out = b.upgrades !== null && !built.has(b.upgrades) ? [buildingName(w, o, b.upgrades)] : [];
  for (const n of b.requires === null ? [] : names(b.requires)) if (!out.includes(n)) out.push(n);
  return out;
}

/** Is the building the Shipyard, its ship, or something that needs the Shipyard (through its requirements or what it upgrades)? */
export function needsShipyard(sub: number, id: number, seen = new Set<number>()): boolean {
  if (id === 6) return true;
  const b = TOWNS[sub]?.buildings[id];
  if (!b || seen.has(id)) return false;
  seen.add(id);
  if (b.key === "ship") return true;
  const ids: number[] = [];
  const walk = (r: unknown): void => void (typeof r === "number" ? ids.push(r) : Array.isArray(r) && r.forEach(walk));
  walk(b.requires);
  if (b.upgrades !== null) ids.push(b.upgrades);
  return ids.some((x) => needsShipyard(sub, x, seen));
}

export const NO_SEA = "The town is too far from the sea for a Shipyard.";

/** Is there sea near the town's gate, where its shipyard would put boats (rules.ts boatSpot's square, whatever stands there now)? */
export function nearSea(w: World, o: AdvObject): boolean {
  const gate = visitTile(w, o);
  if (gate < 0) return false;
  const gx = gate % w.size;
  const gy = Math.floor(gate / w.size) % w.size;
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const i = w.index(gx + dx, gy + dy, o.z);
      if (i >= 0 && w.map.tiles[i].terrain === Terrain.WATER) return true;
    }
  return false;
}

/** Why a building can't be built right now, or null if it can. */
export function cannotBuild(s: AdventureState, w: World, o: AdvObject, id: number): string | null {
  const info = townInfo(o);
  const t = o.town;
  const b = info?.buildings[id];
  if (!info || !t || !b) return NOT_IN_TOWN;
  const built = new Set(t.built);
  if (built.has(id)) return "Already built.";
  if (b.key.startsWith("extra")) return "Appears with its hall.";
  if (t.forbidden?.includes(id)) return FORBIDDEN_HERE;
  if (comesFree(b)) return "Comes with the horde building and the upgraded dwelling.";
  // The Grail building comes only with the Grail itself; the ship is the boat in the shipyard's dock.
  if (id === B.GRAIL) return "Built only by bringing the Grail to the town.";
  if (b.key === "ship") return "Not a building: the shipyard builds boats.";
  // Shipyard: only by the sea (2026-11-01: an inland town built one, then had nowhere to put a boat).
  if (id === B.SHIPYARD && !nearSea(w, o)) return NO_SEA;
  if (t.builtToday) return "Already built here today.";
  if (b.upgrades !== null && !built.has(b.upgrades)) return `Requires ${buildingName(w, o, b.upgrades)}.`;
  if (!meets(b.requires, built)) return "Requirements not met.";
  // Capitol: one per kingdom.
  if (id === B.CAPITOL && s.objects.some((x) => x !== o && x.owner === o.owner && x.town?.built.includes(B.CAPITOL))) return "You already have a Capitol.";
  const res = s.players[o.owner]?.resources;
  if (!res || !canPay(buildingCost(w, o, id), res)) return SHORT_OF_RESOURCES;
  return null;
}

export function build(s: AdventureState, w: World, o: AdvObject, id: number) {
  const why = cannotBuild(s, w, o, id);
  if (why) throw new Refusal(why);
  pay(s.players[o.owner].resources, buildingCost(w, o, id));
  o.town!.built.push(id);
  addDecorations(o);
  // A new guild level, or the Tower's Library (one more spell a level), stocks at once.
  if (o.town!.built.includes(B.MAGE_GUILD_1)) stockGuild(s, w.data.spells ?? [], o);
  o.town!.built.sort((a, b) => a - b);
  o.town!.builtToday = true;
  // A new dwelling has its first week of creatures ready: the creature's own growth, without the
  // Castle, horde or Grail (heroes.thelazy.net Creature dwelling: those count from the next week).
  const dw = dwellingLevel(id);
  const base = dw ? townInfo(o)?.creatures[dw.level]?.[0] : undefined;
  if (dw && !dw.upgraded && !o.town!.available[dw.level]) o.town!.available[dw.level] = (base !== undefined ? w.creatures[base]?.growth : undefined) ?? weeklyGrowth(w, o, dw.level);
  // The Lookout Tower: the town sees further at once.
  if (id === 21 && townInfo(o)?.faction === "tower") revealOwned(s, w, o.owner);
  s.log.push(`Built ${buildingName(w, o, id)}.`);
}

/**
 * The upgraded horde buildings are never bought: they come by themselves once the horde building and
 * the upgraded dwelling both stand (VCMI's "mode": "auto"), as the original's.
 */
export function comesFree(b: { key: string }): boolean {
  return b.key === "horde1Upgr" || b.key === "horde2Upgr";
}

/**
 * Decorative "extra" pieces of the town picture appear once what they belong to is built, and the
 * upgraded horde buildings once both halves stand.
 */
export function addDecorations(o: AdvObject) {
  const info = townInfo(o);
  const t = o.town;
  if (!info || !t) return;
  for (const [id, b] of Object.entries(info.buildings)) {
    if (t.built.includes(Number(id))) continue;
    const built = new Set(t.built);
    if (b.key.startsWith("extra") && meets(b.requires, built)) t.built.push(Number(id));
    else if (comesFree(b) && (b.upgrades === null || built.has(b.upgrades)) && meets(b.requires, built)) t.built.push(Number(id));
  }
}

/** Of a hall slot's chain, the building it shows: the first not built (one that comes free counts as built). */
export function hallChoice(o: AdvObject, ids: number[]): number {
  const info = townInfo(o);
  let id = -1;
  for (const k of ids) {
    if (id >= 0 && info?.buildings[k] && comesFree(info.buildings[k]) && !o.town?.built.includes(k)) continue;
    id = k;
    if (!o.town?.built.includes(k)) break;
  }
  return id;
}

/** HotA's Vault of Ashes adds 1 Firebird a week, though CRTRAITS.TXT gives them no horde growth (the mod's creatures.json). */
const HOTA_HORDE_GROWTH: Record<number, number> = { 130: 1 };

/** The Elemental Conflux (0) and the Golem Factory (1): the map's multi-creature dwellings (object 20). */
export const SPECIAL_DWELLING_CREATURES: Record<number, number[]> = { 0: [112, 115, 114, 113], 1: [32, 33, 116, 117] };

/**
 * Creatures per week for a town dwelling level. With the game state, flagged
 * map dwellings of the same creature add +1 each.
 */
export function weeklyGrowth(w: World, o: AdvObject, level: number, s?: AdventureState): number {
  const info = townInfo(o);
  const t = o.town;
  if (!info || !t || !t.built.includes(dwellingId(level))) return 0;
  const c = w.creatures[info.creatures[level][0]];
  // As VCMI's getGrowthInfo (the original's): the base, the Citadel's +50% or the Castle's +100% of
  // the base, the horde building's flat bonus, and the Grail's +50% of all of that at the end.
  const base = c?.growth ?? 0;
  const castle = t.built.includes(B.CASTLE) ? base : t.built.includes(B.CITADEL) ? Math.floor(base / 2) : 0;
  let horde = 0;
  // (The horde building, or its upgraded-dwelling twin.)
  if (info.horde[0] === level && (t.built.includes(B.HORDE_1) || t.built.includes(B.HORDE_1_UPG))) horde += c.hordeGrowth;
  if (info.horde[1] === level && (t.built.includes(B.HORDE_2) || t.built.includes(B.HORDE_2_UPG))) horde += c.hordeGrowth || HOTA_HORDE_GROWTH[c.id] || 0;
  // External dwellings (VCMI's getDwellingBonus): +1 for each the owner flags that offers this level's creature or its upgrade (the Conflux and the Golem Factory too).
  const kin = info.creatures[level] ?? [];
  const flagged = s && o.owner >= 0 ? s.objects.filter((x) => (x.type === 17 || x.type === 20) && !x.removed && x.owner === o.owner && ((x.type === 17 ? DWELLINGS[x.subid] : SPECIAL_DWELLING_CREATURES[x.subid]) ?? []).some((id) => kin.includes(id))).length : 0;
  // Week of the <creature>: +5 to its dwellings.
  const weekOf = s?.week?.deity ? (info.creatures[level]?.includes(s.week.creature ?? -1) ? 15 : 0) : s?.week?.creature === c?.id ? 5 : 0;
  // The Legion: pieces add to levels 2-6 of the town their hero stays in (visiting or in the
  // garrison; two of a kind on one hero count once, on two heroes twice: heroes.thelazy.net's Legs
  // of Legion), the Statue +50% in all the owner's towns.
  let legion = 0;
  let statue = 0;
  if (s && o.owner >= 0) {
    const here = [garrisonHero(s, o), visitingHero(s, w, o)].filter((h): h is Hero => !!h && h.owner === o.owner);
    for (const h of here) {
      for (const a of new Set(wornArtifacts(h))) {
        // (The Legs are for level 2, the Loins 3, the Torso 4, the Arms 5, the Head 6.)
        if (a >= 118 && a <= 122 && level === a - 116) legion += [5, 4, 3, 2, 1][a - 118];
      }
    }
    if (s.heroes.some((h) => !h.removed && h.owner === o.owner && wornArtifacts(h).includes(133))) statue = 0.5;
  }
  // The Statue of Legion: +50% of the base and the castle's share.
  const total = base + castle + horde + legion + Math.floor(statue * (base + castle)) + flagged;
  return total + (t.built.includes(B.GRAIL) ? Math.floor(total / 2) : 0) + weekOf;
}

/** Gold per day from the town's hall. */
export function townIncome(o: AdvObject): number[] {
  const t = o.town;
  const out = [0, 0, 0, 0, 0, 0, 0];
  if (!t) return out;
  out[6] = t.built.includes(B.CAPITOL) ? 4000 : t.built.includes(B.CITY_HALL) ? 2000 : t.built.includes(B.TOWN_HALL) ? 1000 : 500;
  if (t.built.includes(B.GRAIL)) out[6] += 5000;
  // The Factory's Bank: a loan is paid back a day at a time.
  if (Number(o.data?.loanDays ?? 0) > 0) out[6] -= BANK_LOAN.daily;
  if (t.built.includes(B.RESOURCE_SILO)) {
    // Wood+ore towns vs. the rare resource each town favours.
    const silo: Record<string, [number, number][]> = {
      castle: [[0, 1], [2, 1]],
      rampart: [[4, 1]],
      tower: [[5, 1]],
      inferno: [[1, 1]],
      necropolis: [[0, 1], [2, 1]],
      dungeon: [[3, 1]],
      stronghold: [[0, 1], [2, 1]],
      fortress: [[0, 1], [2, 1]],
      conflux: [[1, 1]],
      // HotA (the mod's buildings.json "produce").
      cove: [[3, 1]],
      factory: [[4, 1]],
      bulwark: [[0, 1], [2, 1]],
    };
    for (const [r, n] of silo[townInfo(o)?.faction ?? ""] ?? []) out[r] += n;
  }
  return out;
}

/** Hero standing in the town gate, if any. */
export function visitingHero(s: AdventureState, w: World, o: AdvObject): Hero | undefined {
  return s.heroes.find((h) => !h.removed && h.garrison === undefined && h.z === o.z && w.visitBy[w.index(h.x, h.y, h.z)] === o.id + 1);
}

/** The hero stationed in the town's garrison, if any. */
export function garrisonHero(s: AdventureState, o: AdvObject): Hero | undefined {
  return s.heroes.find((h) => !h.removed && h.garrison === o.id);
}

/** The town's upper row: the garrison hero's army, else the town's own garrison. */
export function upperArmy(s: AdventureState, o: AdvObject): (ArmySlot | null)[] {
  return garrisonHero(s, o)?.army ?? o.town!.garrison;
}

/**
 * The garrison and visiting heroes change places (either may be missing). A hero going up takes
 * the town's garrison troops into its army; they must all fit (as in the original).
 */
export function swapGarrisonHero(s: AdventureState, w: World, o: AdvObject) {
  const t = o.town;
  if (!t) throw new Refusal("not a town");
  const up = visitingHero(s, w, o);
  const down = garrisonHero(s, o);
  if (!up && !down) throw new Refusal("no hero to move");
  // Out of the garrison with nobody coming in: one more hero on the map, within the cap (VCMI).
  if (down && !up && s.heroes.filter((h) => !h.removed && h.owner === down.owner && h.garrison === undefined).length >= 8)
    throw new Refusal("You already have 8 heroes on the map: the garrison's hero can't come out.");
  if (up) {
    // As VCMI's canBeMergedWith (allowMergingStacks): the hero's own stacks of one kind join up when that makes room
    // (2026-10-27: four single Imps beside the main stack kept the garrison out).
    const joined = (merge: boolean) => {
      const army: (ArmySlot | null)[] = up.army.map((x) => (x ? { ...x } : null));
      if (merge)
        army.forEach((x, i) => {
          const first = x && army.findIndex((y) => y?.creature === x.creature);
          if (x && first !== null && first >= 0 && first < i) ((army[first]!.count += x.count), (army[i] = null));
        });
      return t.garrison.every((st) => !st || addToStacks(army, st.creature, st.count)) ? army : null;
    };
    const army = joined(false) ?? joined(true);
    if (!army) throw new Refusal("The garrison's troops don't fit in the hero's army.");
    up.army = army;
    t.garrison = t.garrison.map(() => null);
    up.garrison = o.id;
  }
  if (down) {
    delete down.garrison;
    // Out at the town's gate.
    const gate = w.visitBy.findIndex((v) => v === o.id + 1);
    if (gate >= 0) {
      const n = w.size;
      [down.x, down.y, down.z] = [gate % n, Math.floor(gate / n) % n, Math.floor(gate / (n * n))];
    }
  }
}

export function addToStacks(army: (ArmySlot | null)[], creature: number, count: number): boolean {
  const same = army.findIndex((x) => x?.creature === creature);
  if (same >= 0) {
    army[same]!.count += count;
    return true;
  }
  const free = army.findIndex((x) => !x);
  if (free < 0) return false;
  army[free] = { creature, count };
  return true;
}

/** The building of a level's second upgrade (HotA: the Cove's Gunpowder Warehouse for Sea Dogs), if the town has one. */
export function secondUpgradeDwelling(o: AdvObject, level: number): number | undefined {
  const info = townInfo(o);
  if (info?.creatures[level]?.[2] === undefined) return undefined;
  const b = Object.entries(info.buildings).find(([, x]) => x.key === `dwellingUp2Lvl${level + 1}`);
  return b ? Number(b[0]) : undefined;
}

/** The creature a town's level shows (its upgrade once the upgraded dwelling stands), built or not. */
/** The creature level a town building recruits for: a dwelling, its upgrade, HotA's second upgrade (the Cove's
 * Gunpowder Warehouse) or a horde building; -1 for anything else. */
export function recruitsLevel(o: AdvObject, id: number): number {
  const dw = dwellingLevel(id);
  if (dw) return dw.level;
  const info = townInfo(o);
  const second = info?.buildings[id]?.key?.match(/^dwellingUp2Lvl(\d)$/);
  if (second) return Number(second[1]) - 1;
  const horde = info?.horde ?? [];
  if (id === B.HORDE_1 || id === B.HORDE_1_UPG) return horde[0] ?? -1;
  if (id === B.HORDE_2 || id === B.HORDE_2_UPG) return horde[1] ?? -1;
  return -1;
}

export function townLevelCreature(o: AdvObject, level: number): number | undefined {
  const pair = townInfo(o)?.creatures[level];
  return pair && o.town ? pair[o.town.built.includes(dwellingId(level, true)) ? 1 : 0] : undefined;
}

/**
 * What a town's level offers to recruit, best first: HotA's second upgrade (the Cove's Sea Dogs),
 * the upgrade, the basic creature; each once its dwelling stands (none before the basic one does).
 */
export function recruitOffers(o: AdvObject, level: number): { creature: number; upgraded: boolean; second?: boolean }[] {
  const pair = townInfo(o)?.creatures[level];
  const t = o.town;
  if (!pair || !t?.built.includes(dwellingId(level))) return [];
  const out: { creature: number; upgraded: boolean; second?: boolean }[] = [{ creature: pair[0], upgraded: false }];
  if (t.built.includes(dwellingId(level, true))) out.unshift({ creature: pair[1], upgraded: true });
  const up2 = secondUpgradeDwelling(o, level);
  if (up2 !== undefined && t.built.includes(up2)) out.unshift({ creature: pair[2], upgraded: false, second: true });
  return out;
}

/** Special upgrades by specialist (VCMI's SPECIAL_UPGRADE): Dracon's Enchanters, Gelu's Sharpshooters, the Cove's Sea Dogs. */
const SPECIAL_UPGRADE_TO: Record<number, string> = { 147: "enchanter", 148: "sharpshooter", 172: "seadog" };

/**
 * What a stack can be upgraded to in this town: its upgrade when the town builds both
 * (the upgraded dwelling stands), or a specialist hero's special upgrade for the hero's own stacks.
 */
export function townUpgradeOf(w: World, o: AdvObject, creature: number, hero?: Hero): number | undefined {
  const special = specialUpgradeOf(w, creature, hero);
  if (special !== undefined) return special;
  const info = townInfo(o);
  const t = o.town;
  if (!info || !t) return undefined;
  for (const [level, pair] of info.creatures.entries()) {
    if (pair[0] === creature && pair[1] !== undefined && pair[1] !== creature && t.built.includes(dwellingId(level, true))) return pair[1];
    // HotA's second upgrade (the Cove's Gunpowder Warehouse: Corsairs to Sea Dogs).
    const up2 = secondUpgradeDwelling(o, level);
    if (pair[1] === creature && up2 !== undefined && t.built.includes(up2)) return pair[2];
  }
  return undefined;
}

/** A specialist's special upgrade for one of its creatures (Gelu: Archers and Wood Elves to Sharpshooters). */
export function specialUpgradeOf(w: World, creature: number, hero?: Hero): number | undefined {
  const key = hero?.type === undefined ? undefined : SPECIAL_UPGRADE_TO[hero.type];
  const from = w.creatures[creature]?.key;
  if (!key || !from || !specialtyOf(hero)?.bonuses?.some((b) => b.type === "SPECIAL_UPGRADE" && b.spell === from)) return undefined;
  const to = w.creatures.findIndex((c) => c?.key === key);
  return to >= 0 && to !== creature ? to : undefined;
}

/** Upgrading in a town costs the full difference in price. */
export function townUpgradeCost(w: World, from: number, to: number, count: number): number[] {
  const a = w.creatures[from];
  return w.creatures[to].cost.map((n, i) => Math.max(0, (n - (a?.cost[i] ?? 0)) * count));
}

/** Upgrades a garrison stack or one of the visiting hero's. */
/**
 * What a stack in the town (the upper row: the garrison hero's army or the garrison; or the visiting
 * hero's) becomes here and for how much; null when it can't be upgraded. The rules, the town screen
 * and the AI all ask this.
 */
export function townUpgrade(s: AdventureState, w: World, o: AdvObject, who: "garrison" | "hero", slot: number): { stack: ArmySlot; to: number; cost: number[] } | null {
  const hero = visitingHero(s, w, o);
  const above = garrisonHero(s, o);
  const stack = (who === "garrison" ? (above?.army ?? o.town?.garrison) : hero?.army)?.[slot];
  const to = stack ? townUpgradeOf(w, o, stack.creature, who === "hero" ? hero : above) : undefined;
  return stack && to !== undefined ? { stack, to, cost: townUpgradeCost(w, stack.creature, to, stack.count) } : null;
}

export function upgradeInTown(s: AdventureState, w: World, o: AdvObject, who: "garrison" | "hero", slot: number) {
  const army = who === "garrison" ? (garrisonHero(s, o)?.army ?? o.town?.garrison) : visitingHero(s, w, o)?.army;
  if (!army?.[slot]) throw new Refusal("no stack there");
  const up = townUpgrade(s, w, o, who, slot);
  if (!up) throw new Refusal("can't be upgraded here");
  const { stack, to, cost } = up;
  pay(s.players[o.owner].resources, cost);
  s.log.push(`Upgraded ${stack.count} ${w.creatures[stack.creature]?.plural} to ${w.creatures[to]?.plural}.`);
  stack.creature = to;
}

/**
 * Where a town's recruits go, as in the original (VCMI recruits into the town's getUpperArmy()):
 * the upper row (the garrison hero's army, else the town's garrison), merged with the same creature
 * or in a free slot; only when that has no room, the visiting hero's army. False when neither has room.
 */
export function addRecruits(s: AdventureState, w: World, o: AdvObject, creature: number, count: number): boolean {
  if (addToStacks(upperArmy(s, o), creature, count)) return true;
  const hero = visitingHero(s, w, o);
  return !!hero && addToStacks(hero.army, creature, count);
}

/** Whether `resources` cover `cost` (both by resource). */
export function canPay(cost: readonly number[], resources: readonly number[]): boolean {
  return cost.every((n, i) => n <= (resources[i] ?? 0));
}

/** Takes `cost` from `resources`, or refuses (taking nothing) when they fall short. */
export function pay(resources: number[], cost: readonly number[]) {
  if (!canPay(cost, resources)) throw new Refusal(SHORT_OF_RESOURCES);
  cost.forEach((n, i) => (resources[i] -= n));
}

/** The town's walls: 0 none, 1 Fort, 2 Citadel, 3 Castle. */
export function fortLevel(built: readonly number[]): number {
  return built.includes(B.CASTLE) ? 3 : built.includes(B.CITADEL) ? 2 : built.includes(B.FORT) ? 1 : 0;
}

/** The town's hall: 0 Village Hall, 1 Town Hall, 2 City Hall, 3 Capitol (-1: none built, as a map may have it). */
export function hallLevel(built: readonly number[]): number {
  return built.includes(B.CAPITOL) ? 3 : built.includes(B.CITY_HALL) ? 2 : built.includes(B.TOWN_HALL) ? 1 : built.includes(B.VILLAGE_HALL) ? 0 : -1;
}

/** How many of something priced `cost` (per one, by resource) the resources buy, at most `cap`. */
export function affordableCount(cost: number[], resources: number[], cap = Infinity): number {
  return Math.max(0, Math.min(cap, ...cost.map((n, r) => (n ? Math.floor(resources[r] / n) : Infinity))));
}

/** Buys creatures of a level (basic or upgraded) into the town's garrison (the visiting hero's army when it's full). */
export function recruit(s: AdventureState, w: World, o: AdvObject, level: number, upgraded: boolean, count: number, second = false) {
  const info = townInfo(o);
  const t = o.town;
  if (!info || !t) throw new Refusal("not a town");
  if (!t.built.includes(second ? (secondUpgradeDwelling(o, level) ?? -1) : dwellingId(level, upgraded))) throw new Refusal("dwelling not built");
  if (count < 1 || count > t.available[level]) throw new Refusal("not that many available");
  const creature = info.creatures[level][second ? 2 : upgraded ? 1 : 0];
  const cost = w.creatures[creature].cost.map((c) => c * count);
  const res = s.players[o.owner].resources;
  if (!canPay(cost, res)) throw new Refusal(SHORT_OF_RESOURCES);
  if (!addRecruits(s, w, o, creature, count)) throw new Refusal("No free army slot.");
  cost.forEach((c, i) => (res[i] -= c));
  t.available[level] -= count;
  s.log.push(`Recruited ${count} ${count === 1 ? w.creatures[creature].name : w.creatures[creature].plural}.`);
}

/** Start of a new week: every dwelling's creatures grow. */
export function weeklyTownGrowth(s: AdventureState, w: World) {
  for (const o of s.objects) {
    if (o.removed || !o.town) continue;
    const info = townInfo(o);
    for (let l = 0; l < levelCount(o); l++) {
      const before = o.town.available[l] ?? 0;
      // Neutral towns grow at half the rate (VCMI's generateTownGrowth).
      const g = o.owner < 0 ? Math.floor(weeklyGrowth(w, o, l, s) / 2) : weeklyGrowth(w, o, l, s);
      const month = s.week?.month;
      o.town.available[l] = month?.plague ? Math.floor(before / 2) : month?.creature !== undefined && info?.creatures[l]?.includes(month.creature) ? (before + g) * 2 : before + g;
    }
  }
}

// The HotA towns' configs (the mod's) leave the standard buildings' chains and requirements to the
// game's defaults: the halls, forts, guilds and silo upgrade and require what the Castle's do
// (the fifth guild level, which the Castle lacks, what the Rampart's does).
(function standardChains() {
  const castle = TOWNS[0]?.buildings;
  const rampart = TOWNS[1]?.buildings;
  if (!castle || !rampart) return;
  for (const t of TOWNS.slice(1)) {
    for (const id of Object.keys(t.buildings).map(Number)) {
      const ref = castle[id] ?? rampart[id];
      if (id > 16 || !ref) continue;
      const b = t.buildings[id];
      if (b.upgrades == null && b.requires == null) {
        b.upgrades = ref.upgrades;
        b.requires = ref.requires;
      }
    }
  }
})();
