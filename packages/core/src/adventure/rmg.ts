// The random map generator (the original's New Game -> Random Map): a start zone per player with
// its town, mines and pickups; treasure zones between them with guarded mines and artifacts;
// zones walled off by obstacles, joined by passages that monsters guard. The result is the same
// H3Map the map parser gives, so everything else (rules, AI, saves) takes it as it is.
//
// The edges between terrains are separate pictures (tile.view), chosen in the original by its
// editor. The generator doesn't know their layout: a TerrainLook learnt from real maps (which
// picture they use for each terrain and its 3x3 neighbourhood) picks them, see learnTerrainLook.
import { START_PRESETS } from "./starts.ts";
import { CASE_GUARD, CASE_KINDS, type CaseKind, type CaseSpec, caseMonsterCount, caseObject, caseObjectData, caseSuffix } from "./cases.ts";
import { DWELLINGS } from "../dwellingData.ts";
import { TOWNS } from "../townData.ts";
import { needsShipyard } from "./town.ts";

/** Towns a random map can give the first player (the case of a HotA town's building too). */
const TOWN_COUNT = TOWNS.length;
import type { H3Map, MapObject, MapTile, ObjectTemplate, PlayerSlot } from "@heroes/formats";
import { type Personality, PERSONALITIES } from "./aiPersonality.ts";
import { type HasRng, random, randInt } from "../rng.ts";
import { type GameData } from "./create.ts";
import { Obj } from "./types.ts";
import { MONOLITH_TWO_WAY, SUBTERRANEAN_GATE, Terrain, maskTiles } from "./world.ts";
import { visitableFromTop } from "./movement.ts";
import { drawableTile, terrainView } from "./terrainViews.ts";
import { type RmgConnection, type RmgTemplate, type RmgZone, rmgFor, rmgIndex, rmgTitle } from "./rmgTemplates.ts";
import { MINE_VALUES, TREASURES, chooseGuard, guardStrength, layoutZones, pandoraCount, pickTreasure, zoneStrength } from "./rmgZones.ts";
import { SCHOOLS } from "../spells.ts";
import { randomArtifactPool } from "./artifacts.ts";
import { type RuleOverrides, addNoHotaBans, hotaArtifactIds, isHotaCreature, rulesFromLetters, rulesLetters } from "./gameRules.ts";

/** A Border Guard and the Keymaster's Tent of its colour (subid 0-7). */
const BORDER_GUARD = 9;
const KEYMASTER = 10;
/**
 * A random map's monsters: hostile (mood 4-10, heroes.thelazy.net Wandering creature) and, as on
 * all of HotA's standard templates, joining only for gold and only half of them (Diplomacy).
 */
/** A guided first game's foe beside the town (rmg ":g"): Peasants, a handful. */
const GUIDED_FOE = 139;
const GUIDED_COUNT = 8;
const RMG_MONSTER = { character: 3, joinOnlyForMoney: true, joiningPercentage: 50 };

export interface RandomMapOptions {
  /** 36 (S), 72 (M), 108 (L) or 144 (XL). */
  size: number;
  /** Players 2..8; the first `humans` of them may be played by people. */
  players: number;
  humans: number;
  /** 0 weak, 1 normal, 2 strong. */
  monsters: number;
  seed: number;
  /** An underground level, joined to the surface by Subterranean Gates. */
  underground?: boolean;
  /** A lake in the middle (3+ players), with a boat at every shore. */
  water?: boolean;
  /** Every zone an island: the sea between them, a boat on each. */
  islands?: boolean;
  /** The computer players all on one team (against the humans): `compTeams` 1. */
  allied?: boolean;
  /** "Human or Computer Teams": the players who may be human split into this many teams (0: each alone). */
  teams?: number;
  /** "Computer Only Teams": the computer-only players split into this many teams (0: each alone; `allied` is 1). */
  compTeams?: number;
  /** An advanced start (starts.ts START_PRESETS): the game begins weeks or months in. */
  start?: string;
  /** The original's template the map follows (rmgTemplates.ts rmgIndex's key), else the generator's own layout. */
  template?: string;
  /** The first player's town (faction index), else drawn from the seed. */
  faction?: number;
  /** A playable case (cases.ts): its object beside the first player's town, the game set up for it. */
  case?: CaseSpec;
  /** The kinds of road it may have (bits: 1 dirt, 2 gravel, 4 cobblestone; VCMI's road choice), else all three. 0: no roads. */
  roads?: number;
  /** The computer players' personality (the map's AI tactic): one for all, or "mixed", each its own by the seed. */
  ai?: Personality | "mixed";
  /** Without the content HotA added: only the original towns, creatures, artifacts, heroes and skills (HotA's rules stay). */
  noHota?: boolean;
  /** HotA's rule changes turned off (gameRules.ts). */
  rules?: RuleOverrides;
  /** A new player's first game: a few weak monsters waiting a few steps from their town, to win a first battle (the client's first steps). */
  guided?: boolean;
}

export const RANDOM_MAP_SIZES = [36, 72, 108, 144];

/** The most players a size holds (a Small map is too cramped for more than four). */
export function maxRandomMapPlayers(size: number): number {
  return size <= 36 ? 4 : 8;
}

/** The "file name" a generated map goes by: everything needed to make it again. */
export function randomMapName(o: RandomMapOptions): string {
  return `random:${o.size}:${o.players}:${o.humans}:${o.monsters}:${o.seed}${o.underground ? ":u" : ""}${o.water ? ":w" : ""}${o.islands ? ":i" : ""}${o.allied || o.compTeams === 1 ? ":a" : ""}${o.teams ? `:ht-${o.teams}` : ""}${(o.compTeams ?? 0) > 1 ? `:ct-${o.compTeams}` : ""}${o.start ? `:s-${o.start}` : ""}${o.template ? `:t-${o.template}` : ""}${o.faction !== undefined ? `:f-${o.faction}` : ""}${o.case ? caseSuffix(o.case) : ""}${o.roads !== undefined && o.roads !== 7 ? `:r-${o.roads}` : ""}${o.ai ? `:ai-${o.ai}` : ""}${o.noHota ? ":nh" : ""}${rulesLetters(o.rules) ? `:rl-${rulesLetters(o.rules)}` : ""}${o.guided ? ":g" : ""}`;
}

export function parseRandomMapName(file: string): RandomMapOptions | null {
  const m = /^random:(\d+):(\d+):(\d+):(\d+):(\d+)(:u)?(:w)?(:i)?(:a)?(?::ht-(\d))?(?::ct-(\d))?(?::s-([a-z]+))?(?::t-([a-z0-9-]+))?(?::f-(\d+))?(?::c-([a-z]+)-(\d+)(?:-(\d+))?(?::p-(\d+))?(?::x-([a-z_]+))?)?(?::r-([0-7]))?(?::ai-([a-z]+))?(:nh)?(?::rl-([a-z]+))?(:g)?$/.exec(file);
  if (!m) return null;
  const [size, players, humans, monsters, seed] = m.slice(1, 6).map(Number);
  if (!RANDOM_MAP_SIZES.includes(size) || players < 2 || players > maxRandomMapPlayers(size) || humans < 1 || humans > players || monsters > 2) return null;
  const o: RandomMapOptions = { size, players, humans, monsters, seed };
  if (m[6]) o.underground = true;
  // (Without a template, the lake needs three players or more; a template's sea is along the rim.)
  if (m[7] && (players >= 3 || m[13])) o.water = true;
  if (m[8]) o.islands = true;
  if (m[9]) o.allied = true;
  // Teams: fewer than the players in the row (as many teams as players is no teams).
  if (m[10] && Number(m[10]) < humans) o.teams = Number(m[10]);
  if (m[11] && Number(m[11]) < players - humans) o.compTeams = Number(m[11]);
  if (m[12]) o.start = m[12];
  if (m[13]) o.template = m[13];
  if (m[14] && Number(m[14]) < TOWN_COUNT) o.faction = Number(m[14]);
  if (m[15] && (CASE_KINDS as string[]).includes(m[15])) o.case = { kind: m[15] as CaseKind, id: Number(m[16]), ...(m[17] ? { sub: Number(m[17]) } : {}), ...(m[18] ? { price: Number(m[18]) } : {}), ...(m[19] ? { context: m[19] } : {}) };
  if (m[20]) o.roads = Number(m[20]);
  if (m[21] && (m[21] === "mixed" || m[21] === "fresh" || (PERSONALITIES as string[]).includes(m[21]))) o.ai = m[21] as Personality | "mixed";
  if (m[22]) o.noHota = true;
  if (m[23]) o.rules = rulesFromLetters(m[23]);
  if (m[24]) o.guided = true;
  return o;
}

/** Each faction's home terrain (classic factions). */
const NATIVE = [Terrain.GRASS, Terrain.GRASS, Terrain.SNOW, Terrain.LAVA, Terrain.DIRT, Terrain.SUBTERRANEAN, Terrain.ROUGH, Terrain.SWAMP, Terrain.GRASS];
const LAND = [Terrain.DIRT, Terrain.SAND, Terrain.GRASS, Terrain.SNOW, Terrain.SWAMP, Terrain.ROUGH, Terrain.LAVA];
/** Decorations and barriers: never entered. */
// (206 to 211: the hills, swamp foliage and subterranean rocks.)
const OBSTACLE_IDS = new Set([...Array.from({ length: 46 }, (_, i) => 116 + i), ...Array.from({ length: 23 }, (_, i) => 177 + i), 206, 207, 208, 209, 210, 211]);

interface Zone {
  id: number;
  /** 0 the surface, 1 underground. */
  level: number;
  /** -1 for treasure zones. */
  player: number;
  /** 0 start, 1 treasure, 2 the centre, 3 a lake. */
  tier: number;
  cx: number;
  cy: number;
  terrain: number;
  faction: number;
  tiles: number[];
  /** Where paths inside the zone start: the town's gate, or the middle. */
  hub: number;
  /** A template's zone: what it holds (rmgTemplates.ts). */
  spec?: RmgZone;
  /** Its distances count for less the larger its share of the map (a template's zone sizes). */
  share?: number;
}

interface Placed {
  template: ObjectTemplate;
  x: number;
  y: number;
  z: number;
  id: number;
  subid: number;
  data: Record<string, unknown>;
}

/** Picks the pictures for terrain edges; built from real maps by learnTerrainLook. */
export interface TerrainLook {
  view(terrain: number, around: number[], r: number): { view: number; flags: number };
  /** A road piece for a road of `type` with road on the neighbours marked in `around` (8 bits, row by row). */
  road?(type: number, around: number, r: number): { dir: number; flags: number };
}

/** Each player's town (faction index): the generator's first draws, so known without making the map. */
function randomMapFactions(o: RandomMapOptions): number[] {
  const rng: HasRng = { rng: o.seed | 0 || 1 };
  random(rng); // the ring's turn
  const drawn = Array.from({ length: o.players }, () => randInt(rng, 0, 8));
  if (o.faction !== undefined) drawn[0] = o.faction;
  return drawn;
}

/**
 * Each player's team on a random map, or none when nobody is allied: the original's two rows
 * (VCMI's CMapGenerator: the players who may be human in `teams` teams, then the computer-only ones
 * in `compTeams` of their own, never mixed; 0 teams: each alone). A row's players are dealt out in
 * order, as evenly as they go.
 */
export function randomMapTeams(o: RandomMapOptions): number[] | undefined {
  const compTeams = o.compTeams ?? (o.allied ? 1 : 0);
  const comps = o.players - o.humans;
  if (!o.teams && !compTeams) return undefined;
  const row = (n: number, k: number, from: number) => Array.from({ length: n }, (_, i) => from + (k > 0 && k < n ? Math.floor((i * k) / n) : i));
  const humans = row(o.humans, o.teams ?? 0, 0);
  return [...humans, ...row(comps, compTeams, humans.length ? Math.max(...humans) + 1 : 0)];
}

/** A random map's AI tactic for a player (h3m's: 0 random, 1 warrior, 2 builder, 3 explorer). */
const aiTactic = (o: RandomMapOptions, p: number) => (!o.ai ? 0 : o.ai === "fresh" ? 4 : 1 + (o.ai === "mixed" ? Math.abs((o.seed * 31 + p * 7919) | 0) % 3 : PERSONALITIES.indexOf(o.ai)));

/** The player slots of a random map (who may play, each one's town), without making it. */
export function randomMapSlots(o: RandomMapOptions): PlayerSlot[] {
  const factions = randomMapFactions(o);
  const teams = randomMapTeams(o);
  return Array.from({ length: 8 }, (_, p) =>
    p < o.players
      ? { canHuman: p < o.humans, canComputer: true, aiTactic: aiTactic(o, p), allowedFactions: 1 << factions[p], randomFaction: false, randomHero: true, mainHero: -1, ...(teams ? { team: teams[p] } : {}) }
      : { canHuman: false, canComputer: false },
  );
}

/** "the computers allied", "two teams of the humans"...: the teams in words, for the map's description. */
function teamsText(o: RandomMapOptions): string {
  const ct = o.compTeams ?? (o.allied ? 1 : 0);
  const parts = [o.teams ? (o.teams === 1 ? "the humans allied" : `the humans in ${o.teams} teams`) : "", ct ? (ct === 1 ? "the computers allied" : `the computers in ${ct} teams`) : ""].filter(Boolean);
  return parts.length ? `, ${parts.join(", ")}` : "";
}

/** A random map's name and description. */
export function randomMapTitle(o: RandomMapOptions, template?: RmgTemplate): { name: string; description: string } {
  const L = o.underground ? 2 : 1;
  // An advanced start (starts.ts): its own name and what the player finds.
  const start = o.start ? START_PRESETS[o.start] : undefined;
  // A playable case (cases.ts): what it's for.
  if (o.case) return { name: `Case: ${o.case.kind} ${o.case.id}${o.case.sub !== undefined ? `/${o.case.sub}` : ""}${o.faction !== undefined ? ` (${TOWNS[o.faction]?.faction ?? "town"})` : ""}`, description: `A small map made to try one thing: the ${o.case.kind} stands near your town (a building is left for you to build), with a hero, an army and resources to spend. Opened from the Matrix tab.` };
  if (o.guided) return { name: "First steps", description: `A small map for a first game against one computer player: weak monsters wait a few steps from your town, the goals are listed on the screen. Seed ${o.seed}.` };
  if (start) return { name: `${start.name} (random ${["S", "M", "L", "XL"][RANDOM_MAP_SIZES.indexOf(o.size)] ?? o.size}, ${o.players} players)`, description: `${start.text}${template ? ` On the ${rmgTitle(template)} template.` : ""} Seed ${o.seed}.` };
  const size = `${["S", "M", "L", "XL"][RANDOM_MAP_SIZES.indexOf(o.size)] ?? o.size}${L > 1 ? "+U" : ""}`;
  // (The kinds of road, when the map was asked for fewer than all three.)
  const roads = o.roads === undefined || o.roads === 7 ? "" : o.roads === 0 ? ", no roads" : `, ${["dirt", "gravel", "cobblestone"].filter((_, k) => o.roads! & (1 << k)).join(" and ")} roads only`;
  if (template) return { name: `${rmgTitle(template)} (random ${size}, ${o.players} players)`, description: `A random map from the ${rmgTitle(template)} template for ${o.players} players, ${["weak", "normal", "strong"][o.monsters]} monsters${teamsText(o)}${roads}. Seed ${o.seed}.` };
  return {
    name: `Random map (${["S", "M", "L", "XL"][RANDOM_MAP_SIZES.indexOf(o.size)] ?? o.size}${L > 1 ? "+U" : ""}${o.water ? ", water" : ""}${o.islands ? ", islands" : ""}, ${o.players} players)`,
    description: `A random map for ${o.players} players, ${["weak", "normal", "strong"][o.monsters]} monsters${L > 1 ? ", with an underground level" : ""}${o.water ? ", a lake in the middle" : ""}${o.islands ? ", islands" : ""}${teamsText(o)}${roads}. Seed ${o.seed}.`,
  };
}

/**
 * Makes the map. It checks its own result (every player has a town, both home mines with their
 * walks, every passage reachable from its zone, a boat on every island, gates in pairs) and, when
 * something is off, tries again from a seed derived from the first (so the same options always
 * give the same map); the players' towns stay those of the options' seed.
 */
export function generateRandomMap(data: GameData, o: RandomMapOptions, look?: TerrainLook): H3Map {
  let best: { map: H3Map; flaws: number } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const made = generateOnce(data, o, attempt, look);
    if (!best || made.flaws < best.flaws) best = made;
    if (made.flaws < 1) break;
  }
  const map = best!.map;
  // HotA: without water Summon Boat is banned, and the Sea Captain's and Admiral's Hats with it (heroes.thelazy.net Summon Boat).
  if (!map.tiles.some((t) => t.terrain === 8)) {
    const banned = (map.banned ??= { artifacts: [], spells: [], skills: [] });
    if (!banned.spells.includes(0)) banned.spells.push(0);
    for (const a of [123, 136]) if (!banned.artifacts.includes(a)) banned.artifacts.push(a);
  }
  if (o.noHota) addNoHotaBans(map);
  return map;
}

function generateOnce(data: GameData, o: RandomMapOptions, attempt: number, look?: TerrainLook): { map: H3Map; flaws: number } {
  const rng: HasRng = { rng: (o.seed + attempt * 7919) | 0 || 1 };
  /** What came out wrong (a missing town or mine, a passage its zone can't reach...). */
  let flaws = 0;
  /** A template's things cut off and taken away: up to one in fifty is no reason to start again. */
  let cutOff = 0;
  const N = o.size;
  const NN = N * N;
  const L = o.underground ? 2 : 1;
  const T = L * NN;
  const idx = (x: number, y: number, z: number) => z * NN + y * N + x;
  const X = (i: number) => i % N;
  const Y = (i: number) => Math.floor(i / N) % N;
  const Z = (i: number) => Math.floor(i / NN);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
  /** The tile dx, dy from i on its level, or -1 off the map. */
  const step = (i: number, dx: number, dy: number) => (inside(X(i) + dx, Y(i) + dy) ? i + dy * N + dx : -1);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(random(rng) * xs.length)];
  const shuffle = <T,>(xs: T[]): T[] => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(random(rng) * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };

  // ---- zones: players on a ring, treasure zones between them, a centre zone for 3+ players;
  // underground, treasure zones of subterranean ground under the borders above.
  const zones: Zone[] = [];
  const mid = (N - 1) / 2;
  const turn = random(rng) * Math.PI * 2;
  const factions = randomMapFactions(o);
  // (Centres rounded: Math.cos and Math.sin may differ in the last digits between browsers, and
  // every place the map is made must make the same one.)
  const zone = (level: number, player: number, tier: number, cx: number, cy: number, terrain: number, faction: number) =>
    zones.push({ id: zones.length, level, player, tier, cx: Math.round(cx * 64) / 64, cy: Math.round(cy * 64) / 64, terrain, faction, tiles: [], hub: -1 });
  // A template's (rmgTemplates.ts): its zones and connections for these players. (Not with
  // cases: those keep the generator's own layout.)
  const tpl = o.template && !o.case && data.rmgTemplates ? rmgIndex(data.rmgTemplates).get(o.template) : undefined;
  const planned = tpl ? rmgFor(tpl, o.humans, o.players) : undefined;
  // (Underground, a template needs a zone that isn't a start to put there.)
  // (Nor one with too few start zones for these players: then the generator's own layout.)
  const plan =
    planned && planned.zones.filter((z) => z.type === "human" || z.type === "computer").length >= o.players && (L === 1 || planned.zones.some((z) => z.type === "treasure" || z.type === "junction")) ? planned : undefined;
  /** A template zone's id to its zone. */
  const tplZone = new Map<number, Zone>();
  /** A template's player numbers (its start zones' Ownership) to the players holding them. */
  const ownerPlayer = new Map<number, number>();
  if (plan) {
    const places = layoutZones(rng, plan.zones, plan.connections, L);
    // Players to start zones, in the template's order: the humans to zones a human may hold, the
    // others to the computers' zones first. Start zones nobody takes are neutral land.
    const free = plan.zones.filter((z) => z.type === "human" || z.type === "computer").sort((a, b) => a.owner - b.owner || a.id - b.id);
    const holder = new Map<number, number>();
    for (let p = 0; p < o.players; p++) {
      const k = p < o.humans ? free.findIndex((z) => z.type === "human") : Math.max(0, free.findIndex((z) => z.type === "computer"));
      if (k < 0 || !free[k]) {
        flaws += 100;
        break;
      }
      holder.set(free[k].id, p);
      ownerPlayer.set(free[k].owner, p);
      free.splice(k, 1);
    }
    for (const z of plan.zones) {
      const at = places.get(z.id)!;
      const player = holder.get(z.id) ?? -1;
      const towns = z.playerTowns.towns + z.playerTowns.castles + z.neutralTowns.towns + z.neutralTowns.castles;
      const allowed = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((f) => z.townTypes & (1 << f));
      const faction = player >= 0 ? factions[player] : towns ? pick(allowed.length ? allowed : [0, 1, 2, 3, 4, 5, 6, 7, 8]) : -1;
      const grounds = [0, 1, 2, 3, 4, 5, 6, 7].filter((g) => z.terrains & (1 << g));
      const terrain =
        z.matchTerrain && faction >= 0 ? (NATIVE[faction] ?? Terrain.GRASS) : at.level === 1 && (!grounds.length || (grounds.includes(Terrain.SUBTERRANEAN) && random(rng) < 0.6)) ? Terrain.SUBTERRANEAN : grounds.length ? pick(grounds) : pick(LAND);
      zone(at.level, player, player >= 0 ? 0 : 1, at.x * (N - 1), at.y * (N - 1), terrain, faction);
      const zn = zones[zones.length - 1];
      zn.spec = z;
      // (Its share of the level: the tiles are dealt out to match it.)
      zn.share = at.area;
      tplZone.set(z.id, zn);
    }
  } else
  for (let p = 0; p < o.players; p++) {
    const a = turn + (Math.PI * 2 * p) / o.players;
    zone(0, p, 0, mid + Math.cos(a) * N * 0.34, mid + Math.sin(a) * N * 0.34, NATIVE[factions[p]] ?? Terrain.GRASS, factions[p]);
  }
  // About one zone per 250 tiles in all: small maps with many players get fewer treasure zones.
  const treasures = plan ? 0 : Math.max(1, Math.min(o.players === 2 ? 2 : o.players, Math.floor((N * N) / 250) - o.players - (o.players >= 3 ? 1 : 0)));
  for (let t = 0; t < treasures; t++) {
    // In the gaps between the players (spread over the gaps when there are fewer of them).
    const gap = Math.floor((t * o.players) / treasures);
    const a = turn + (Math.PI * 2 * (gap + 0.5)) / o.players;
    const r = o.players === 2 ? 0.3 : 0.27;
    zone(0, -1, 1, mid + Math.cos(a) * N * r, mid + Math.sin(a) * N * r, pick(LAND), -1);
  }
  // The centre: treasure, or with water a lake.
  if (o.players >= 3 && !plan) zone(0, -1, o.water ? 3 : 2, mid, mid, o.water ? Terrain.WATER : pick(LAND), -1);
  const wet = (z: number) => zones[z].tier === 3;
  if (L > 1 && !plan) {
    const below = Math.max(2, o.players);
    for (let t = 0; t < below; t++) {
      const a = turn + (Math.PI * 2 * t) / below + Math.PI / below;
      zone(1, -1, 1, mid + Math.cos(a) * N * 0.3, mid + Math.sin(a) * N * 0.3, random(rng) < 0.8 ? Terrain.SUBTERRANEAN : pick([Terrain.LAVA, Terrain.DIRT]), -1);
    }
    zone(1, -1, 2, mid, mid, Terrain.SUBTERRANEAN, -1);
  }

  // Each tile to the nearest zone centre of its level, with smooth noise for natural borders.
  const zoneOf = new Int16Array(T);
  for (let z = 0; z < L; z++) {
    // One noise field twice the map's size, read at a different place for each zone: every zone's
    // border is irregular in its own way (no zone gains on another). The lake stays round.
    const noise = smoothNoise(rng, 2 * N, Math.max(4, Math.round(N / 8)));
    const here = zones.filter((zn) => zn.level === z);
    // A template's zones get their share of the level: each zone's reach grows or shrinks until its
    // tiles match its size (nearest centre alone lets a small zone between big ones be swallowed).
    const reach = new Float64Array(zones.length);
    const shared = here.every((zn) => zn.share !== undefined);
    const deal = () => {
      const count = new Int32Array(zones.length);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          let best = -1;
          let bestD = Infinity;
          for (const zn of here) {
            const ox = (zn.id * 37) % N;
            const oy = (zn.id * 61) % N;
            const d = shared
              ? dist(x - zn.cx, y - zn.cy) - reach[zn.id] + noise[(y + oy) * 2 * N + x + ox] * N * 0.08
              : dist(x - zn.cx, y - zn.cy) * (zn.tier === 2 ? 1.25 : zn.player >= 0 ? 0.92 : 1) + (zn.tier === 3 ? 0 : noise[(y + oy) * 2 * N + x + ox] * N * 0.12);
            if (d < bestD) (bestD = d), (best = zn.id);
          }
          zoneOf[idx(x, y, z)] = best;
          count[best]++;
        }
      return count;
    };
    if (shared)
      for (let round = 0; round < 16; round++) {
        const count = deal();
        for (const zn of here) reach[zn.id] += 0.6 * (Math.sqrt((zn.share! * N * N) / Math.PI) - Math.sqrt(count[zn.id] / Math.PI));
      }
    deal();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) zones[zoneOf[idx(x, y, z)]].tiles.push(idx(x, y, z));
  }

  // Islands: the sea fills the gaps between the zones (and the map's rim) on the surface. A
  // template's map with water: a sea along the rim.
  if (o.islands || (plan && o.water)) {
    const sea = zones.push({ id: zones.length, level: 0, player: -1, tier: 3, cx: -1, cy: -1, terrain: Terrain.WATER, faction: -1, tiles: [], hub: -1 }) - 1;
    const reach = o.islands ? (N >= 108 ? 3 : N >= 72 ? 2 : 1) : N >= 108 ? 5 : N >= 72 ? 4 : 2;
    const dist = new Int16Array(NN).fill(-1);
    const queue: number[] = [];
    for (let i = 0; i < NN; i++) {
      const rim = X(i) < 2 || Y(i) < 2 || X(i) > N - 3 || Y(i) > N - 3;
      const contact = !!o.islands && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const j = step(i, dx, dy);
        return j >= 0 && zoneOf[j] !== zoneOf[i];
      });
      if (rim || contact) (dist[i] = 0), queue.push(i);
    }
    // (The rim sea's coast wanders: from one tile to twice the reach.)
    const coast = o.islands ? null : smoothNoise(rng, N, Math.max(4, Math.round(N / 6)));
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      if (dist[i] >= (coast ? Math.max(1, Math.round(reach * (1 + coast[Y(i) * N + X(i)]))) : reach) - 1) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = step(i, dx, dy);
        if (j >= 0 && dist[j] < 0) (dist[j] = dist[i] + 1), queue.push(j);
      }
    }
    for (const zn of zones) if (zn.level === 0 && zn.id !== sea) zn.tiles = zn.tiles.filter((i) => dist[i] < 0);
    for (let i = 0; i < NN; i++) if (dist[i] >= 0) (zoneOf[i] = sea), zones[sea].tiles.push(i);
  }

  // ---- terrain
  const tiles: MapTile[] = Array.from({ length: T }, (_, i) => ({ terrain: zones[zoneOf[i]].terrain, view: 0, river: 0, riverDir: 0, road: 0, roadDir: 0, flags: 0 }));

  // ---- borders: walls between zones, and the map's own edge. Blocked but for the passages.
  const border = new Uint8Array(T);
  const wallSide = (a: number, b: number) => zones[a].tiles.length > zones[b].tiles.length || (zones[a].tiles.length === zones[b].tiles.length && a < b);
  for (let i = 0; i < T; i++) {
    // The sea and its shores stay open; land zones are walled off from each other.
    let edge = !wet(zoneOf[i]) && (X(i) === 0 || Y(i) === 0 || X(i) === N - 1 || Y(i) === N - 1);
    for (let dy = -1; dy <= 1 && !edge && !wet(zoneOf[i]); dy++)
      for (let dx = -1; dx <= 1 && !edge; dx++) {
        const j = step(i, dx, dy);
        // One side of each boundary is wall, the larger zone's (a small zone isn't eaten by walls):
        // any step from one zone into the other, diagonal ones too, lands on a tile that touches
        // the other zone, so on wall.
        if (j >= 0 && zoneOf[j] !== zoneOf[i] && !wet(zoneOf[j]) && wallSide(zoneOf[i], zoneOf[j])) edge = true;
      }
    if (edge) border[i] = 1;
  }

  // ---- occupancy
  const blocked = new Uint8Array(T); // objects' blocked tiles
  const busy = new Uint8Array(T); // no other object here (footprints and a ring around entrances)
  const entry = new Uint8Array(T); // no obstacle here: round each entrance (an obstacle may lean on an object's blocked side, as in VCMI's maps)
  const keep = new Uint8Array(T); // must stay walkable (paths, entrances' fronts, passages)
  const homeWay = new Uint8Array(T); // the walk from a town to its own mines: no guard next to it
  const placed: Placed[] = [];
  /** Objects that stand or fall together: a treasure and its guard, the two ends of a gate pair. */
  const together = new Map<Placed, Placed[]>();
  const bind = (a: Placed, b: Placed) => {
    (together.get(a) ?? together.set(a, []).get(a)!).push(b);
    (together.get(b) ?? together.set(b, []).get(b)!).push(a);
  };
  /** Takes an object off the map, with whatever stands or falls with it. */
  const unplace = (p: Placed) => {
    const k = placed.indexOf(p);
    if (k < 0) return;
    placed.splice(k, 1);
    // Its ground is free again (else a wall tile under it would stay open, neither wall nor rock).
    for (const { dx, dy } of maskTiles(p.template.blockMask, 0))
      if (inside(p.x + dx, p.y + dy)) {
        const i = idx(p.x + dx, p.y + dy, p.z);
        if (!placed.some((q) => q.z === p.z && maskTiles(q.template.blockMask, 0).some((b) => q.x + b.dx === p.x + dx && q.y + b.dy === p.y + dy))) blocked[i] = 0;
      }
    for (const q of together.get(p) ?? []) unplace(q);
  };
  const templates: ObjectTemplate[] = [];
  const templateIndex = new Map<ObjectTemplate, number>();
  /** The object's picture for the terrain: the one drawn for it (its editor menu's) first, then one allowed on it. */
  const findTemplate = (id: number, subid: number | undefined, terrain: number) => {
    const all = data.templates.filter((t) => t.id === id && (subid === undefined || t.subid === subid));
    return all.find((t) => (t.menuMask ?? 0) & (1 << terrain)) ?? all.find((t) => t.terrainMask & (1 << terrain)) ?? all[0];
  };

  /** Can a template sit with its anchor at x, y, z (its blocked tiles inside the zone, free, off borders, not needed for paths)? */
  const fits = (t: ObjectTemplate, x: number, y: number, z: number, zoneId: number, guarded = false) => {
    for (const { dx, dy } of maskTiles(t.blockMask, 0)) {
      if (!inside(x + dx, y + dy)) return false;
      const i = idx(x + dx, y + dy, z);
      if (blocked[i] || busy[i] || keep[i] || border[i] || zoneOf[i] !== zoneId) return false;
    }
    for (const { dx, dy } of maskTiles(t.visitMask, 1)) {
      // The tile in front of the entrance must be free ground in the zone.
      if (!inside(x + dx, y + dy + 1)) return false;
      const f = idx(x + dx, y + dy + 1, z);
      if (border[f] || blocked[f] || zoneOf[f] !== zoneId) return false;
      // Its guard will stand at f: not next to a town's walk to its mines.
      if (guarded)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx2 = -1; dx2 <= 1; dx2++) {
            const j = step(f, dx2, dy);
            if (j >= 0 && homeWay[j]) return false;
          }
    }
    return true;
  };
  const put = (t: ObjectTemplate, x: number, y: number, z: number, data: Record<string, unknown> = {}, ring = 1): Placed => {
    if (!templateIndex.has(t)) templateIndex.set(t, templates.push(t) - 1);
    const p: Placed = { template: t, x, y, z, id: t.id, subid: t.subid, data };
    placed.push(p);
    for (const { dx, dy } of maskTiles(t.blockMask, 0)) blocked[idx(x + dx, y + dy, z)] = 1;
    for (const { dx, dy } of [...maskTiles(t.blockMask, 0), ...maskTiles(t.visitMask, 1)])
      for (let ry = -ring; ry <= ring; ry++) for (let rx = -ring; rx <= ring; rx++) if (inside(x + dx + rx, y + dy + ry)) busy[idx(x + dx + rx, y + dy + ry, z)] = 1;
    // (Not above an entrance that can't be entered from above.)
    const top = visitableFromTop({ type: t.id }) ? -1 : 0;
    for (const { dx, dy } of maskTiles(t.visitMask, 1)) for (let ry = top; ry <= 1; ry++) for (let rx = -1; rx <= 1; rx++) if (inside(x + dx + rx, y + dy + ry)) entry[idx(x + dx + rx, y + dy + ry, z)] = 1;
    // (Never a tile of the walls: a monster by a wall would keep the wall open below it.)
    for (const { dx, dy } of maskTiles(t.visitMask, 1)) if (inside(x + dx, y + dy + 1) && !border[idx(x + dx, y + dy + 1, z)]) keep[idx(x + dx, y + dy + 1, z)] = 1;
    return p;
  };
  /** An object with its entrance on tile i (HotA's creatures stand a tile left of their anchor). */
  const putOn = (t: ObjectTemplate, i: number, data: Record<string, unknown> = {}, ring = 1) => {
    const v = maskTiles(t.visitMask, 1)[0] ?? { dx: 0, dy: 0 };
    return put(t, X(i) - v.dx, Y(i) - v.dy, Z(i), data, ring);
  };
  /** The tile a hero steps on to enter an object (below its entrance). */
  const front = (p: Placed) => {
    const v = maskTiles(p.template.visitMask, 1)[0];
    return v && inside(p.x + v.dx, p.y + v.dy + 1) ? idx(p.x + v.dx, p.y + v.dy + 1, p.z) : idx(p.x, p.y, p.z);
  };
  /** Places a template somewhere in the zone (near x, y when given); null when no room. */
  const placeIn = (zn: Zone, t: ObjectTemplate | undefined, data: Record<string, unknown> = {}, near?: { x: number; y: number; min: number; max: number }, guarded = false, ok?: (i: number) => boolean) => {
    if (!t) return null;
    const spots = shuffle(zn.tiles.slice()).filter((i) => {
      if (ok && !ok(i)) return false;
      if (!near) return true;
      const d = dist(X(i) - near.x, Y(i) - near.y);
      return d >= near.min && d <= near.max;
    });
    for (const i of spots) if (fits(t, X(i), Y(i), zn.level, zn.id, guarded)) return put(t, X(i), Y(i), zn.level, data);
    return null;
  };

  /**
   * A town near the zone's middle whose gate opens onto most of the zone: with the town standing
   * there, the ground in front of its gate must reach at least 60% of the zone's open ground.
   */
  const placeTown = (zn: Zone, t: ObjectTemplate | undefined, data: Record<string, unknown>) => {
    if (!t) return null;
    const open = zn.tiles.filter((i) => !border[i] && !blocked[i]);
    const hx = X(zn.hub);
    const hy = Y(zn.hub);
    const spots = open.slice().sort((a, b) => dist(X(a) - hx, Y(a) - hy) - dist(X(b) - hx, Y(b) - hy));
    const gate = maskTiles(t.visitMask, 1)[0];
    for (const i of spots.slice(0, 400)) {
      if (!gate || !fits(t, X(i), Y(i), zn.level, zn.id)) continue;
      const foot = new Set(maskTiles(t.blockMask, 0).map(({ dx, dy }) => idx(X(i) + dx, Y(i) + dy, zn.level)));
      const start = idx(X(i) + gate.dx, Y(i) + gate.dy + 1, zn.level);
      const seen = new Set([start]);
      const queue = [start];
      for (let q = 0; q < queue.length; q++)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const j = step(queue[q], dx, dy);
          if (j >= 0 && !seen.has(j) && zoneOf[j] === zn.id && !border[j] && !blocked[j] && !foot.has(j)) (seen.add(j), queue.push(j));
        }
      if (seen.size >= 0.6 * (open.length - foot.size)) return put(t, X(i), Y(i), zn.level, data);
    }
    return null;
  };
  /** A town that found no room: anywhere its footprint is inside the zone, walls or not. */
  const placeAnyway = (zn: Zone, t: ObjectTemplate | undefined, data: Record<string, unknown>) => {
    if (!t) return null;
    for (const i of zn.tiles) {
      const ok =
        maskTiles(t.blockMask, 0).every(({ dx, dy }) => inside(X(i) + dx, Y(i) + dy) && X(i) + dx > 0 && Y(i) + dy > 0 && zoneOf[idx(X(i) + dx, Y(i) + dy, zn.level)] === zn.id && !blocked[idx(X(i) + dx, Y(i) + dy, zn.level)]) &&
        maskTiles(t.visitMask, 1).every(({ dx, dy }) => inside(X(i) + dx, Y(i) + dy + 1) && Y(i) + dy + 1 < N - 1 && zoneOf[idx(X(i) + dx, Y(i) + dy + 1, zn.level)] === zn.id);
      if (!ok) continue;
      const p = put(t, X(i), Y(i), zn.level, data);
      // Its own footprint and the ground in front become the zone's open ground.
      for (const { dx, dy } of [...maskTiles(t.blockMask, 0), ...maskTiles(t.visitMask, 1)])
        for (let ry = -1; ry <= 2; ry++)
          for (let rx = -1; rx <= 1; rx++) {
            const x = X(i) + dx + rx;
            const y = Y(i) + dy + ry;
            if (x <= 0 || y <= 0 || x >= N - 1 || y >= N - 1) continue;
            const j = idx(x, y, zn.level);
            // (Never the wall to another zone.)
            const touches = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([ex, ey]) => {
              const k = step(j, ex, ey);
              return k >= 0 && zoneOf[k] !== zn.id && !wet(zoneOf[k]);
            });
            if (zoneOf[j] === zn.id && !touches) border[j] = 0;
          }
      return p;
    }
    return null;
  };

  const pocket = new Uint8Array(T);
  // Pockets of a zone its own walls cut off (the borders are noisy) get nothing: a zone is its
  // largest open area, with the walls along it. Worked out before anything is placed, and the
  // zone's hub (where its paths start) is the tile of that area nearest its middle.
  for (const zn of zones) {
    if (zn.tier === 3) continue;
    const seen = new Uint8Array(T);
    let best: number[] = [];
    for (const start of zn.tiles) {
      if (seen[start] || border[start]) continue;
      const area = [start];
      seen[start] = 1;
      for (let q = 0; q < area.length; q++)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const j = step(area[q], dx, dy);
          if (j >= 0 && !seen[j] && zoneOf[j] === zn.id && !border[j]) (seen[j] = 1), area.push(j);
        }
      if (area.length > best.length) best = area;
    }
    const keepIt = new Uint8Array(T);
    for (const i of best) keepIt[i] = 1;
    // The zone's walls along that ground belong to it too (two tiles deep at most).
    for (let pass = 0; pass < 2; pass++) {
      const add: number[] = [];
      for (const i of zn.tiles) {
        if (keepIt[i] || !border[i]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const j = step(i, dx, dy);
          if (j >= 0 && keepIt[j] && zoneOf[j] === zn.id) {
            add.push(i);
            break;
          }
        }
      }
      for (const i of add) keepIt[i] = 1;
    }
    // The rest becomes wall, and no passage leads into it.
    for (const i of zn.tiles) if (!keepIt[i]) (border[i] = 1), (pocket[i] = 1);
    zn.tiles = zn.tiles.filter((i) => keepIt[i]);
    zn.hub = best.sort((a, b) => dist(X(a) - zn.cx, Y(a) - zn.cy) - dist(X(b) - zn.cx, Y(b) - zn.cy))[0] ?? idx(Math.round(zn.cx), Math.round(zn.cy), zn.level);
  }

  // ---- towns and starting places
  const players = randomMapSlots(o);
  /** Turns a 3x3 patch two or three tiles from (gx, gy) into water: the first spot whose tiles are all the zone's own and free. */
  const pond = (gx: number, gy: number, z: number, zone: number) => {
    for (const [ox, oy] of [[-1, 2], [1, 2], [-3, 1], [2, 1], [-1, -4], [-4, -1], [3, -1]]) {
      const patch: number[] = [];
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) patch.push(inside(gx + ox + dx, gy + oy + dy) ? idx(gx + ox + dx, gy + oy + dy, z) : -1);
      if (patch.some((i) => i < 0 || zoneOf[i] !== zone || blocked[i] || keep[i] || border[i])) continue;
      for (const i of patch) (tiles[i].terrain = Terrain.WATER), (blocked[i] = 1);
      return;
    }
  };
  for (const zn of zones) {
    if (zn.player < 0) continue;
    const t = findTemplate(Obj.TOWN, zn.faction, zn.terrain);
    // (A template's start zone with a castle: the town has its fort.)
    const td = { owner: zn.player, formation: 0, spellResearch: true, ...(zn.spec && zn.spec.playerTowns.castles > 0 ? { hasFort: true } : {}) };
    const town = placeTown(zn, t, td) ?? placeAnyway(zn, t, td);
    if (!town) {
      flaws++;
      continue;
    }
    const gate = maskTiles(town.template.visitMask, 1)[0];
    // (A template may start players underground: VCMI's forcedLevel.)
    players[zn.player].mainTown = { x: town.x + gate.dx, y: town.y + gate.dy, z: town.z, generateHero: true };
    zn.hub = front(town);
    // The hero comes out of the gate: the gate's own tile stays free of other objects.
    keep[idx(town.x + gate.dx, town.y + gate.dy, town.z)] = 1;
    // A case of the Shipyard (or what needs it): a pond by the town, for it can only be built by the sea (town.ts nearSea).
    if (zn.player === 0 && o.case?.kind === "building" && needsShipyard(zn.faction, o.case.id)) pond(town.x + gate.dx, town.y + gate.dy, town.z, zn.id);
    // Its wood and ore mines next, before anything else takes the room: close by when possible,
    // each with its walk from the town kept (nothing later stands on it or guards it).
    for (const r of [0, 2]) {
      let done = false;
      for (let tries = 0; tries < 10 && !done; tries++) {
        const mine = placeIn(zn, findTemplate(Obj.MINE, r, zn.terrain), { owner: -1 }, tries < 5 ? { x: X(zn.hub), y: Y(zn.hub), min: 3, max: N * 0.12 } : undefined);
        if (!mine) continue;
        const way = path(zn.hub, front(mine), zn.id);
        if (!way.length) {
          // No way to it from the town: somewhere else.
          unplace(mine);
          continue;
        }
        for (const i of way) (keep[i] = 1), (homeWay[i] = 1);
        done = true;
      }
      if (!done) flaws++;
    }
  }

  // ---- a playable case's object: a few steps from the first player's town, its way kept open.
  // (A guided first game: a few Peasants, who neither join nor flee, for a first battle that is won.)
  const theCase: [number, number] | null = o.case ? caseObject(o.case) : o.guided ? [Obj.MONSTER, GUIDED_FOE] : null;
  if (theCase) {
    const zn = zones.find((z) => z.player === 0);
    const [id, sub] = theCase;
    // (A subtype without its own template, e.g. a HotA artifact the archives have no picture for: any of the type.)
    const t = zn && (data.templates.find((x) => x.id === id && x.subid === sub && x.terrainMask & (1 << zn.terrain)) ?? data.templates.find((x) => x.id === id && x.subid === sub) ?? findTemplate(id, undefined, zn.terrain));
    const extra = !o.case ? { count: GUIDED_COUNT, character: 4, noJoin: true, neverFlees: true } : { ...(id === Obj.MONSTER ? { count: caseMonsterCount(o.case, data.creatures[sub]?.level ?? 1), ...RMG_MONSTER, character: 1 } : {}), ...caseObjectData(o.case) };
    let p: Placed | null = null;
    for (let tries = 0; tries < 6 && zn && t && !p; tries++) {
      p = placeIn(zn, t, extra, { x: X(zn.hub), y: Y(zn.hub), min: 2 + tries, max: 5 + 2 * tries });
      if (p && !path(zn.hub, front(p), zn.id).length) (unplace(p), (p = null));
    }
    if (p) {
      p.subid = sub;
      for (const i of path(zn!.hub, front(p), zn!.id)) (keep[i] = 1), (homeWay[i] = 1);
      // A dilemma's price: a guard on the tile it is entered from (applyCase sizes it).
      const g = o.case?.price !== undefined && id !== Obj.MONSTER ? findTemplate(Obj.MONSTER, CASE_GUARD, zn!.terrain) : undefined;
      const f = front(p);
      if (g) {
        keep[f] = 0;
        put(g, X(f), Y(f), Z(f), { count: 1, character: 4, noJoin: true, neverFlees: true }, 0).subid = CASE_GUARD;
        keep[f] = 1;
        // Things taken from any side (pickups): a second guard above, so every way in is guarded.
        const above = step(idx(p.x, p.y, p.z), 0, -1);
        if (above >= 0 && !blocked[above] && !keep[above] && zoneOf[above] === zn!.id) put(g, X(above), Y(above), Z(above), { count: 1, character: 4, noJoin: true, neverFlees: true }, 0).subid = CASE_GUARD;
      }
    } else flaws++;
  }

  // ---- passages between neighbouring zones, each with a guard in it
  const strength = [0.5, 1, 1.6][o.monsters] ?? 1;
  /** The creatures that have a picture on the adventure map. */
  const monsterIds = new Set(data.templates.filter((t) => t.id === Obj.MONSTER).map((t) => t.subid));
  const hasMonster = (id: number) => monsterIds.has(id) && !(o.noHota && isHotaCreature(id));
  /** A template zone's monsters' factions (bits: neutral, then Castle .. Conflux): its own town's when it says so. */
  const monsterTypes = (zn: Zone) => (zn.spec ? (zn.spec.monsterMatch && zn.faction >= 0 && zn.faction < 9 ? 1 | (1 << (zn.faction + 1)) : zn.spec.monsterTypes || 0x3ff) : 0x3ff);
  /** A guard worth `value` in front of a template zone's thing (by the zone's monster strength). */
  const valueGuard = (zn: Zone, value: number) => (zn.spec ? chooseGuard(rng, data.creatures, guardStrength(value, zoneStrength(zn.spec), o.monsters), monsterTypes(zn), hasMonster) : null);
  const monsterTemplate = (level: number, terrain: number) => findTemplate(level <= 4 ? Obj.RANDOM_MONSTER_L1 + level - 1 : Obj.RANDOM_MONSTER_L5 + level - 5, undefined, terrain);
  // Stronger further out; and strong between two players' homes, so nobody walks straight in.
  const guardLevel = (a: Zone, b: Zone) => Math.min(7, a.player >= 0 && b.player >= 0 ? 5 + o.monsters : Math.max(a.tier, b.tier) * 2 + o.monsters + 1);
  const contact = new Map<string, number[]>();
  for (let i = 0; i < T; i++) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const j = step(i, dx, dy);
      if (j < 0 || pocket[i] || pocket[j]) continue;
      const a = zoneOf[i];
      const b = zoneOf[j];
      if (a === b) continue;
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
      (contact.get(key) ?? contact.set(key, []).get(key)!).push(i);
    }
  }
  const links: [Zone, Zone, number][] = [];
  /** A template's connection behind each passage. */
  const linkSpec = new Map<[Zone, Zone, number], RmgConnection>();
  /** A template's connections whose zones don't touch (or lie on different levels): a pair of monoliths (gates) instead. */
  const farLinks: [Zone, Zone, RmgConnection][] = [];
  if (plan) {
    const count = new Map<string, number>();
    for (const c of plan.connections) {
      const a = tplZone.get(c.a);
      const b = tplZone.get(c.b);
      if (!a || !b || a === b) continue;
      const key = `${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`;
      const along = contact.get(key);
      // A second connection between the same two zones: another passage further along their border.
      const n = count.get(key) ?? 0;
      count.set(key, n + 1);
      if (c.portal || a.level !== b.level || !along || along.length < 4 + 6 * n) {
        farLinks.push([a, b, c]);
        continue;
      }
      const link: [Zone, Zone, number] = [a, b, along[Math.floor(along.length * [0.5, 0.2, 0.8, 0.35, 0.65][n % 5])]];
      links.push(link);
      linkSpec.set(link, c);
    }
  } else
  for (const [key, along] of contact) {
    if (along.length < 4) continue;
    const [a, b] = key.split("-").map((n) => zones[Number(n)]);
    // Across the water a boat does it.
    if (a.tier === 3 || b.tier === 3) continue;
    // Two start zones touching: a passage only on small maps with nothing else between them.
    if (a.player >= 0 && b.player >= 0 && contact.size > zones.length) continue;
    // The middle of their common border.
    links.push([a, b, along[Math.floor(along.length / 2)]]);
  }
  // No zone without a way in by land: one through its best contact, a treasure zone first.
  for (const zn of plan ? [] : zones) {
    if (zn.tier === 3 || links.some(([a, b]) => a === zn || b === zn)) continue;
    const options = [...contact.entries()]
      .map(([key, along]) => ({ ids: key.split("-").map(Number), along }))
      .filter(({ ids, along }) => ids.includes(zn.id) && along.length >= 4 && ids.every((id) => zones[id].tier !== 3))
      .sort((p, q) => Number(zones[p.ids.find((id) => id !== zn.id)!].player >= 0) - Number(zones[q.ids.find((id) => id !== zn.id)!].player >= 0) || q.along.length - p.along.length);
    const best = options[0];
    if (best) links.push([zones[best.ids[0]], zones[best.ids[1]], best.along[Math.floor(best.along.length / 2)]]);
  }
  // The land in one piece: while zones fall into separate groups (e.g. homes that only touch each
  // other and the lake), the longest contact between two groups becomes a passage too.
  while (!plan) {
    const group = zones.map((z) => z.id);
    const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
    for (const [a, b] of links) group[find(a.id)] = find(b.id);
    const land = zones.filter((z) => z.tier !== 3);
    if (new Set(land.map((z) => find(z.id))).size <= 1) break;
    const best = [...contact.entries()]
      .map(([key, along]) => ({ ids: key.split("-").map(Number), along }))
      .filter(({ ids, along }) => along.length >= 4 && ids.every((id) => zones[id].tier !== 3) && zones[ids[0]].level === zones[ids[1]].level && find(ids[0]) !== find(ids[1]))
      .sort((p, q) => q.along.length - p.along.length)[0];
    if (!best) break;
    links.push([zones[best.ids[0]], zones[best.ids[1]], best.along[Math.floor(best.along.length / 2)]]);
  }

  // Each passage's guard where it doesn't cut its own zones in two: from the middle of the common
  // border outwards, the first spot that leaves both zones' open ground in one piece (but for the
  // guard's own surroundings) with the guards already placed.
  const guards: number[] = [];
  /** The passages' guards: they stay whatever else is cleared away. */
  const passageGuards = new Set<Placed>();
  /** A template's passages left open (wide, or worth too little for a guard): the zones on both sides are one walk. */
  const openWays: [number, number][] = [];
  /** A template zone's steps (connections) from the nearest start zone. */
  const startSteps = new Map<number, number>();
  if (plan) {
    const queue = plan.zones.filter((z) => z.type === "human" || z.type === "computer").map((z) => z.id);
    for (const id of queue) startSteps.set(id, 0);
    for (let q = 0; q < queue.length; q++)
      for (const c of plan.connections) {
        const next = c.a === queue[q] ? c.b : c.b === queue[q] ? c.a : -1;
        if (next >= 0 && !startSteps.has(next)) (startSteps.set(next, startSteps.get(queue[q])! + 1), queue.push(next));
      }
  }
  /** The next colour for a template's border guard and its Keymaster's Tent. */
  let keyColour = 0;
  const nearGuard = (i: number) => guards.some((g) => Z(g) === Z(i) && Math.abs(X(g) - X(i)) <= 1 && Math.abs(Y(g) - Y(i)) <= 1);
  const pieces = (zn: Zone) => {
    const open = zn.tiles.filter((i) => !border[i] && !blocked[i] && !nearGuard(i));
    if (!open.length) return 0;
    const seen = new Set([open[0]]);
    const queue = [open[0]];
    for (let q = 0; q < queue.length; q++)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const j = step(queue[q], dx, dy);
        if (j >= 0 && !seen.has(j) && zoneOf[j] === zn.id && !border[j] && !blocked[j] && !nearGuard(j)) (seen.add(j), queue.push(j));
      }
    return open.length - seen.size;
  };
  const touchesOther = (j: number, own: number) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([ex, ey]) => {
      const k = step(j, ex, ey);
      return k >= 0 && zoneOf[k] !== own && !wet(zoneOf[k]);
    });
  /**
   * The way from a passage at m into the zone's open ground: the 3x3 around m is opened, and
   * where the wall is thicker (a boundary running diagonally) a corridor goes on through it, but
   * never along the wall (a corridor tile touching the other zone would open the wall out of the
   * guard's reach). The corridor's tiles (none needed: []), or null when the open ground can't be
   * reached from there.
   */
  const corridorFor = (m: number, zn: Zone): number[] | null => {
    const home = new Set(zn.tiles);
    const prev = new Map<number, number>();
    const queue: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const j = step(m, dx, dy);
        if (j >= 0 && zoneOf[j] === zn.id && X(j) > 0 && Y(j) > 0 && X(j) < N - 1 && Y(j) < N - 1) (prev.set(j, -1), queue.push(j));
      }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      if (i !== m && !border[i] && !blocked[i] && !keep[i] && home.has(i)) {
        const way: number[] = [];
        for (let k = prev.get(i)!; k >= 0; k = prev.get(k) ?? -1) way.push(k);
        return way;
      }
      if (prev.get(i) === -1 && border[i] === 0 && home.has(i) && !blocked[i] && i !== m) return [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = step(i, dx, dy);
        if (j >= 0 && !prev.has(j) && zoneOf[j] === zn.id && !blocked[j] && X(j) > 0 && Y(j) > 0 && X(j) < N - 1 && Y(j) < N - 1 && !touchesOther(j, zn.id)) (prev.set(j, i), queue.push(j));
      }
    }
    return null;
  };
  for (let k = links.length - 1; k >= 0; k--) {
    const link = links[k];
    const [a, b] = link;
    const along = contact.get(`${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`) ?? [link[2]];
    const mid = Math.max(0, along.indexOf(link[2]));
    const order = along.map((i, n) => ({ i, d: Math.abs(n - mid) })).sort((p, q) => p.d - q.d).map((c) => c.i);
    // (Not at a town's door either: four tiles from either zone's hub at least.)
    // Nor next to a town's walk to its mines.
    const clear = (m: number) =>
      [a, b].every((z) => Math.max(Math.abs(X(m) - X(z.hub)), Math.abs(Y(m) - Y(z.hub))) >= 4) &&
      [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].every(([dx, dy]) => {
        const j = step(m, dx, dy);
        return j < 0 || !homeWay[j];
      });
    const reaches = (m: number) => corridorFor(m, a) !== null && corridorFor(m, b) !== null;
    let found = -1;
    for (const m of order.filter(clear).slice(0, 60)) {
      if (!reaches(m)) continue;
      guards.push(m);
      if (pieces(a) === 0 && pieces(b) === 0) {
        found = m;
        break;
      }
      guards.pop();
    }
    // Else anywhere along the contact a way through exists (still away from the towns).
    if (found < 0) found = order.find((m) => clear(m) && reaches(m)) ?? -1;
    if (found < 0) {
      // No way through this contact at all: no passage here (a template's connection goes by monoliths then).
      if (linkSpec.has(link)) farLinks.push([a, b, linkSpec.get(link)!]);
      links.splice(k, 1);
      continue;
    }
    link[2] = found;
    if (guards.at(-1) !== found) guards.push(found);
  }
  // A land zone left without any passage (none could be made where it touches the others) is a
  // flaw: another attempt will do better.
  for (const zn of zones) if (zn.tier !== 3 && zn.level === 0 && !o.islands && zones.filter((z) => z.level === 0 && z.tier !== 3).length > 1 && !links.some(([a, b]) => a === zn || b === zn) && !farLinks.some(([a, b]) => a === zn || b === zn)) flaws++;
  for (const [a, b, m] of links) {
    // Open the wall in the 3x3 around the passage's middle (every tile of it is next to the
    // guard), and the corridors on.
    const ways = [corridorFor(m, a) ?? [], corridorFor(m, b) ?? []];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const j = step(m, dx, dy);
        if (j >= 0 && X(j) > 0 && Y(j) > 0 && X(j) < N - 1 && Y(j) < N - 1) {
          border[j] = 0;
          keep[j] = 1;
        }
      }
    for (const way of ways) for (const i of way) (border[i] = 0), (keep[i] = 1);
    // The guard stands in the middle of it: a template's by the connection's value (none for a wide one).
    const spec = [...linkSpec].find(([l]) => l[2] === m)?.[1];
    if (spec) {
      // A border guard instead of a monster: its colour's Keymaster's Tent in the zone on the start's side.
      if (spec.borderGuard && !spec.wide && keyColour < 8) {
        const bt = data.templates.find((x) => x.id === BORDER_GUARD && x.subid === keyColour);
        const kt = data.templates.find((x) => x.id === KEYMASTER && x.subid === keyColour);
        // (The side nearer a start: the key is reached without passing this guard.)
        const home = (startSteps.get(b.spec?.id ?? -1) ?? 99) < (startSteps.get(a.spec?.id ?? -1) ?? 99) ? b : a;
        if (bt && kt) {
          keep[m] = 0;
          const guard = putOn(bt, m, {}, 0);
          keep[m] = 1;
          const tent = placeIn(home, kt, {}, undefined, false);
          if (tent) {
            passageGuards.add(guard);
            keyColour++;
            continue;
          }
          unplace(guard);
        }
      }
      const g = spec.wide ? null : chooseGuard(rng, data.creatures, guardStrength(spec.value, 0, o.monsters, true), monsterTypes(a) | monsterTypes(b), hasMonster);
      const t = g && findTemplate(Obj.MONSTER, g.creature, tiles[m].terrain);
      if (t) {
        keep[m] = 0;
        passageGuards.add(putOn(t, m, { count: g.count, ...RMG_MONSTER }, 0));
        keep[m] = 1;
      } else openWays.push([a.id, b.id]);
      continue;
    }
    const level = guardLevel(a, b);
    const guard = monsterTemplate(level, tiles[m].terrain);
    if (guard) {
      keep[m] = 0;
      passageGuards.add(put(guard, X(m), Y(m), Z(m), { count: Math.max(1, Math.round(guardCount(level) * strength)), ...RMG_MONSTER }, 0));
      keep[m] = 1;
    }
  }

  // Roads: a template's connection may have none, or one half the time (VCMI's "road"); and the
  // map's choice of kinds (o.roads): a kind not allowed is drawn as the next better one, else worse.
  const roadlessSpec = (c: RmgConnection) => c.road === false || (c.road === "random" && random(rng) < 0.5);
  const roadless = new Set<[Zone, Zone, number]>(links.filter((l) => linkSpec.has(l) && roadlessSpec(linkSpec.get(l)!)));
  const roadKind = (k: number) => {
    const allowed = o.roads ?? 7;
    for (const c of [k, k + 1, k + 2, k - 1, k - 2]) if (c >= 1 && c <= 3 && allowed & (1 << (c - 1))) return c;
    return 0;
  };
  // The walks from each zone's middle (or town) to its passages, kept before anything else is
  // placed so nothing can close them.
  const exitWays = new Map<number, number[][]>();
  const onWay = new Uint8Array(T);
  for (const zn of zones) {
    if (zn.tier === 3) continue;
    for (const link of links) {
      const [a, b, m] = link;
      if (a !== zn && b !== zn) continue;
      const way = roadWay(zn.hub, nearestOfZone(m, zn.id), zn.id, onWay);
      if (!way.length) flaws++;
      // Kept, and no guard of a treasure next to it: leaving home doesn't mean a fight.
      for (const i of way) (keep[i] = 1), (homeWay[i] = 1);
      // (A roadless passage's walk is kept all the same, without its road.)
      if (roadless.has(link)) continue;
      for (const i of way) onWay[i] = 1;
      (exitWays.get(zn.id) ?? exitWays.set(zn.id, []).get(zn.id)!).push(way);
    }
  }

  // ---- a template's connections between zones that don't touch: two-way monoliths of a colour of
  // their own (Subterranean Gates between the levels), each end within reach of its zone's middle,
  // the guard (by the connection's value) in front of the end in the zone that isn't a player's.
  /** Monolith and gate pairs, for the check that every zone can be reached. */
  const portals: [Placed, Placed][] = [];
  if (plan) {
    const colours = [...new Set(data.templates.filter((x) => x.id === MONOLITH_TWO_WAY).map((x) => x.subid))].sort((p, q) => p - q);
    let colour = 0;
    let gate = 0;
    const walks = new Map<Placed, number[]>();
    for (const [a, b, c] of farLinks) {
      const cross = a.level !== b.level;
      if (!cross && colour >= colours.length) {
        flaws++;
        continue;
      }
      const sub = cross ? undefined : colours[colour];
      const ends = [a, b].map((zn) => {
        const t = cross ? findTemplate(SUBTERRANEAN_GATE, undefined, zn.terrain) : data.templates.find((x) => x.id === MONOLITH_TWO_WAY && x.subid === sub);
        for (let tries = 0; tries < 4; tries++) {
          const p = placeIn(zn, t, cross ? { gate } : {}, undefined, true);
          if (!p) return null;
          const way = path(zn.hub, front(p), zn.id);
          if (way.length) {
            for (const i of way) keep[i] = 1;
            walks.set(p, way);
            return p;
          }
          unplace(p);
        }
        return null;
      });
      if (!ends[0] || !ends[1]) {
        for (const e of ends) if (e) unplace(e);
        flaws++;
        continue;
      }
      if (cross) gate++;
      else colour++;
      // (Roads lead to the gates, as to the passages.)
      if (cross && !roadlessSpec(c)) [a, b].forEach((zn, k) => (exitWays.get(zn.id) ?? exitWays.set(zn.id, []).get(zn.id)!).push(walks.get(ends[k]!)!));
      bind(ends[0], ends[1]);
      portals.push([ends[0], ends[1]]);
      const g = c.wide ? null : chooseGuard(rng, data.creatures, guardStrength(c.value, 0, o.monsters, true), monsterTypes(a) | monsterTypes(b), hasMonster);
      const f = front(ends[a.player < 0 && b.player >= 0 ? 0 : 1]!);
      const gt = g && findTemplate(Obj.MONSTER, g.creature, tiles[f].terrain);
      if (gt && !blocked[f]) {
        keep[f] = 0;
        passageGuards.add(putOn(gt, f, { count: g.count, ...RMG_MONSTER }, 0));
        keep[f] = 1;
        const below = step(f, 0, 1);
        if (below >= 0 && !border[below]) keep[below] = 1;
      }
    }
  }

  // ---- boats: one at every shore of the lake, moored next to a tile the zone's paths reach.
  const shore = new Map<number, number>();
  const boatOf = new Map<number, Placed>();
  const boat = findTemplate(Obj.BOAT, undefined, Terrain.WATER);
  // Only on the open water: the largest body of water, not a pond the lake's edge cut off.
  const sea = new Set<number>();
  {
    const seen = new Uint8Array(T);
    for (let i = 0; i < NN; i++) {
      if (seen[i] || !wet(zoneOf[i])) continue;
      const body = [i];
      seen[i] = 1;
      for (let q = 0; q < body.length; q++)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = step(body[q], dx, dy);
          if (j >= 0 && !seen[j] && wet(zoneOf[j])) (seen[j] = 1), body.push(j);
        }
      if (body.length > sea.size) (sea.clear(), body.forEach((j) => sea.add(j)));
    }
  }
  for (const zn of zones) {
    if (zn.tier === 3 || !boat) continue;
    const hx = X(zn.hub);
    const hy = Y(zn.hub);
    const coast = zn.tiles
      .filter((i) => !blocked[i] && !border[i])
      .map((i) => ({ i, w: [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => step(i, dx, dy)).find((j) => j >= 0 && sea.has(j) && !blocked[j] && X(j) > 0 && Y(j) > 0 && X(j) < N - 1 && Y(j) < N - 1) }))
      .filter((c): c is { i: number; w: number } => c.w !== undefined)
      .sort((a, b) => dist(X(a.i) - hx, Y(a.i) - hy) - dist(X(b.i) - hx, Y(b.i) - hy));
    const c = coast[0];
    if (!c) continue;
    // (Anchored so the boat itself is on that water: the real boat's anchor is a tile right of it.)
    const v = maskTiles(boat.visitMask, 1)[0] ?? { dx: 0, dy: 0 };
    boatOf.set(zn.id, put(boat, X(c.w) - v.dx, Y(c.w) - v.dy, Z(c.w), {}, 1));
    keep[c.i] = 1;
    shore.set(zn.id, c.i);
    // The walk down to it kept now, with no guard next to it.
    for (const i of path(zn.hub, c.i, zn.id)) (keep[i] = 1), (homeWay[i] = 1);
  }

  // ---- what each zone holds: a template's zone what its template says, each thing guarded by its value
  // Seer's Huts (VCMI's way): each asks for a treasure artifact of its own, which lies in a zone one
  // or two passages away in place of a random artifact or a Pandora's Box placed there.
  const questArts = plan && data.templates.some((t) => t.id === 83) ? shuffle(randomArtifactPool(data.artifacts, "T", o.noHota ? hotaArtifactIds() : [])) : [];
  const seers: { hut: Placed; art: number; zone: number; at?: Placed }[] = [];
  const templateContents = (zn: Zone, z: RmgZone) => {
    /** A thing with its guard in front (by `value`, the whole pile's when more lies round it), or none when it's worth too little. */
    const valued = (t: ObjectTemplate | undefined, value: number, d: Record<string, unknown> = {}, ok?: (i: number) => boolean) => {
      const g = valueGuard(zn, value);
      const p = placeIn(zn, t, d, undefined, !!g, ok);
      const gt = p && g && findTemplate(Obj.MONSTER, g.creature, zn.terrain);
      if (!p || !gt) return { p, guard: null };
      const f = front(p);
      if (blocked[f]) return { p, guard: null };
      keep[f] = 0;
      const guard = putOn(gt, f, { count: g!.count, ...RMG_MONSTER }, 0);
      bind(p, guard);
      keep[f] = 1;
      const below = step(f, 0, 1);
      if (below >= 0 && zoneOf[below] === zn.id && !border[below]) keep[below] = 1;
      return { p, guard };
    };
    // Towns: the player's (beside the one it starts in; a zone of a player nobody plays has them
    // neutral) and neutral ones, castles with their forts.
    const owner = zn.player >= 0 ? zn.player : (ownerPlayer.get(z.owner) ?? -1);
    const started = zn.player >= 0 ? 1 : 0;
    const towns: [number, boolean][] = [];
    for (let k = 0; k < z.playerTowns.castles - started; k++) towns.push([owner, true]);
    for (let k = 0; k < z.playerTowns.towns - Math.max(0, started - z.playerTowns.castles); k++) towns.push([owner, false]);
    for (let k = 0; k < z.neutralTowns.castles; k++) towns.push([-1, true]);
    for (let k = 0; k < z.neutralTowns.towns; k++) towns.push([-1, false]);
    const allowed = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((f) => z.townTypes & (1 << f));
    for (const [who, fort] of towns) {
      const f = z.sameType && zn.faction >= 0 ? zn.faction : pick(allowed.length ? allowed : [0, 1, 2, 3, 4, 5, 6, 7, 8]);
      if (!placeIn(zn, findTemplate(Obj.TOWN, f, zn.terrain), { owner: who, formation: 0, spellResearch: true, ...(fort ? { hasFort: true } : {}) })) flaws++;
    }
    // An advanced start (starts.ts): an obelisk in every zone for its grail puzzle.
    if (o.start) placeIn(zn, findTemplate(57, undefined, zn.terrain));
    // Mines: the template's least, as VCMI places them (the start town's wood and ore came with it),
    // each with one to three heaps of what it gives nearby.
    for (let r = 0; r < 7; r++) {
      let n = z.mines[r];
      if (zn.player >= 0 && (r === 0 || r === 2)) n--;
      for (let k = 0; k < n; k++) {
        const { p } = valued(findTemplate(Obj.MINE, r, zn.terrain), MINE_VALUES[r], { owner: -1 });
        if (!p) {
          flaws++;
          continue;
        }
        const f = front(p);
        for (let heaps = 1 + Math.floor(random(rng) * 3); heaps > 0; heaps--) placeIn(zn, findTemplate(Obj.RESOURCE, r, zn.terrain), {}, { x: X(f), y: Y(f), min: 1, max: 4 });
      }
    }
    // Treasure, as the original's generator places it: the tiers from the most valuable down, each
    // with zone area x density / 400 piles, the piles further apart the more they're worth. A pile is
    // things worth a quarter to all of what's still to fill (one large thing at most, the rest
    // pickups round its guard: every tile next to a monster is guarded), done once past the tier's
    // least half the time; guarded when worth more than the zone's strength lets lie.
    const strength = zoneStrength(z);
    const unguardedUpTo = [6500, 4167, 3000, 1833, 1333][Math.max(0, Math.min(4, strength + o.monsters))];
    // Dwellings of the zone's own town (a zone without towns: one of its allowed kinds), worth their
    // creature's AI value times its growth, more the more zones are of that town (VCMI's measure).
    const kinds = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((f) => z.townTypes & (1 << f));
    const townType = zn.faction >= 0 ? zn.faction : (kinds[zn.id % Math.max(1, kinds.length)] ?? zn.id % 9);
    const native = zones.filter((q) => q.spec && q.faction === townType).length;
    const withTowns = zones.filter((q) => q.spec).length || 1;
    const dwellingValue = (level: number) => {
      const c = data.creatures.find((x) => x.id === TOWNS[townType]?.creatures[level - 1]?.[0]);
      return c ? Math.round(c.aiValue * c.growth * (1 + native / withTowns + native / 2)) : 0;
    };
    const have = TREASURES.filter((x) => data.templates.some((t) => t.id === x.id && (x.sub === undefined || t.subid === x.sub)))
      // (The dwelling itself, not the random one's picture: a real dwelling's ground is larger.)
      .map((x) => {
        if (x.id !== 216) return x;
        const level = Number(x.data!.minLevel) + 1;
        const creature = TOWNS[townType]?.creatures[level - 1]?.[0];
        const sub = Object.entries(DWELLINGS).find(([sub, cs]) => cs[0] === creature && data.templates.some((t) => t.id === 17 && t.subid === Number(sub)))?.[0];
        return sub === undefined ? { ...x, value: 0 } : { ...x, id: 17, sub: Number(sub), value: dwellingValue(level), data: undefined };
      })
      // Pandora's Boxes of the zone's own town's creatures, worth their AI value, more the more zones are of that town.
      .concat(
        (TOWNS[townType]?.creatures ?? []).flat().flatMap((id) => {
          const c = data.creatures.find((x) => x.id === id);
          const count = c ? pandoraCount(c.level, c.aiValue) : 0;
          return c && count ? [{ id: 6, value: Math.round(c.aiValue * count * (1 + native / withTowns)), rarity: 3, data: { creatures: [{ creature: id, count }] } }] : [];
        }),
      )
      // Seer's Huts worth 500 to place, their rewards (experience, gold, the zone's creatures) no more than the zone's best treasure.
      .concat(
        questArts.length
          ? [
              ...[5000, 10000, 15000, 20000].flatMap((v) => [
                { id: 83, value: 500, rarity: 10, reward: v, data: { reward: 1, amount: v } },
                { id: 83, value: 500, rarity: 10, reward: v, data: { reward: 5, resource: 6, amount: v } },
              ]),
              ...(TOWNS[townType]?.creatures ?? []).flat().flatMap((id) => {
                const c = data.creatures.find((x) => x.id === id);
                const count = c ? pandoraCount(c.level, c.aiValue) : 0;
                const reward = c ? Math.round((2 * c.aiValue * count * (1 + native / withTowns) - 4000) / 3) : 0;
                return c && count && reward > 0 ? [{ id: 83, value: 500, rarity: 3, reward, data: { reward: 10, creature: id, amount: count } }] : [];
              }),
            ]
              .filter((x) => x.reward <= Math.max(0, ...z.treasure.map((t) => t.high)))
              .map(({ reward: _, ...x }) => x)
          : [],
      )
      .filter((x) => x.value > 0)
      .sort((p, q) => p.value - q.value);
    /** A box's spells, drawn as it's placed. */
    const spellsFor = (d: Record<string, unknown>) => {
      const all = (data.spells ?? []).filter((x) => x.id < 70 && x.level > 0);
      const pool = d.spellLevel ? all.filter((x) => x.level === d.spellLevel) : d.spellSchool !== undefined ? all.filter((x) => x.schools.includes(SCHOOLS[[3, 2, 1, 0][Number(d.spellSchool)]])) : all;
      const n = d.spellLevel ? 12 : d.spellSchool !== undefined ? 15 : 60;
      return shuffle(pool.map((x) => x.id)).slice(0, n);
    };
    const used = new Map<(typeof TREASURES)[number], number>();
    // (One Seer's Hut a zone at most, while there are artifacts left for it to ask for.)
    let huts = 0;
    const mine = (x: (typeof TREASURES)[number]) => (!x.zoneLimit || (used.get(x) ?? 0) < x.zoneLimit) && (x.id !== 83 || (huts < 1 && questArts.length > seers.length));
    // How far each tile of the zone is from the nearest thing in it, squared, kept as things are
    // placed. (VCMI keeps it squared and holds it against the tier's distance unsquared: piles stand
    // the square root of that apart, 2 to 7 tiles; held against the square, most piles found no room.)
    const reachOf = Math.ceil(Math.sqrt(Math.sqrt(30000 / 10))) + 1;
    const gap = new Map<number, number>(zn.tiles.map((i) => [i, Infinity]));
    const spot = (s: number) => {
      for (let dy = -reachOf; dy <= reachOf; dy++)
        for (let dx = -reachOf; dx <= reachOf; dx++) {
          const j = step(s, dx, dy);
          const old = j >= 0 ? gap.get(j) : undefined;
          if (old !== undefined && dx * dx + dy * dy < old) gap.set(j, dx * dx + dy * dy);
        }
    };
    for (const q of placed) if (zoneOf[idx(q.x, q.y, q.z)] === zn.id) spot(idx(q.x, q.y, q.z));
    const homeRoom = zn.player >= 0 ? Math.max(6, Math.sqrt(zn.tiles.length) / 3) : 0;
    let density = 0;
    for (const tier of z.treasure.slice().sort((p, q) => q.high - p.high)) {
      density += tier.density;
      const count = Math.floor((zn.tiles.length * tier.density) / 400);
      const apart = Math.max(1, Math.sqrt(Math.min(tier.low, 30000) / 10 / density));
      for (let made = 0, misses = 0; made < count && misses < count; ) {
        const target = tier.low + Math.floor(random(rng) * (tier.high - tier.low + 1));
        const pile: (typeof TREASURES)[number][] = [];
        let value = 0;
        while (value <= target - 100) {
          const left = target - value;
          const fit = have.filter((x) => x.value <= left && x.value >= 0.25 * left && mine(x) && (PICKUPS.has(x.id) || !pile.some((y) => !PICKUPS.has(y.id))));
          if (!fit.length) break;
          const x = pickTreasure(rng, fit, 0, left)!;
          if (PICKUPS.has(x.id)) pile.push(x);
          else pile.unshift(x);
          used.set(x, (used.get(x) ?? 0) + 1);
          value += x.value;
          if (value >= tier.low && random(rng) < 0.5) break;
        }
        const lost = () => {
          for (const x of pile) used.set(x, used.get(x)! - 1);
          misses++;
        };
        if (!pile.length) {
          misses++;
          continue;
        }
        const [first, ...more] = pile;
        const t = findTemplate(first.id, first.sub, zn.terrain);
        const far = (i: number) => (gap.get(i) ?? 0) >= apart;
        const box = first.data && (first.data.spellLevel !== undefined || first.data.spellSchool !== undefined || first.data.spellCount !== undefined);
        const art = first.id === 83 ? questArts[seers.length] : -1;
        const d = box
          ? { spells: spellsFor(first.data!) }
          : first.id === 83
            ? { quests: [{ mission: 5, artifacts: [art], lastDay: -1, ...first.data }] }
            : { ...(first.id === Obj.MINE || first.id === 17 || first.id === 216 ? { owner: -1 } : {}), ...first.data };
        // (A guard not too near the start's town: guards round it would close the first days' walk.)
        const roomy = (i: number) => far(i) && dist(X(i) - X(zn.hub), Y(i) - Y(zn.hub)) >= homeRoom;
        const placedPile = first.guarded || value <= unguardedUpTo ? { p: placeIn(zn, t, d, undefined, false, far), guard: null } : valued(t, value, d, roomy);
        if (!placedPile.p) {
          lost();
          continue;
        }
        made++;
        if (first.id === 83) (seers.push({ hut: placedPile.p, art, zone: zn.id }), huts++);
        spot(idx(placedPile.p.x, placedPile.p.y, placedPile.p.z));
        // The pickups round the guard (or round the thing when it has none), on free ground of the zone.
        const g = placedPile.guard ? front(placedPile.p) : idx(placedPile.p.x, placedPile.p.y, placedPile.p.z);
        const round = shuffle([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]);
        for (const x of more) {
          const pt = findTemplate(x.id, x.sub, zn.terrain);
          const at = round.map(([dx, dy]) => step(g, dx, dy)).find((j) => j >= 0 && zoneOf[j] === zn.id && !blocked[j] && !keep[j] && !border[j] && !standsOn(j));
          if (!pt || at === undefined) continue;
          bind(placedPile.p, put(pt, X(at), Y(at), Z(at), {}, 0));
          spot(at);
        }
      }
    }
  };
  // An advanced start on a template (starts.ts): the towns its players hold already (applyStart gives
  // them away), placed first, in their own zones, or where a start zone has no room for them (a small
  // template's are little more than the town and its mines) in the largest zones next to it that no one starts in.
  if (plan && o.start)
    for (const zn of zones) {
      if (!zn.spec || zn.player < 0) continue;
      const next = plan.connections.flatMap((c) => (c.a === zn.spec!.id ? [c.b] : c.b === zn.spec!.id ? [c.a] : [])).map((id) => tplZone.get(id)).filter((q): q is Zone => !!q && q.player < 0 && q.tier !== 3);
      const where = [zn, ...next.sort((a, b) => b.tiles.length - a.tiles.length)];
      for (let k = 0; k < (START_PRESETS[o.start]?.extraTowns ?? 0); k++) if (!where.some((q) => placeIn(q, findTemplate(Obj.TOWN, zn.faction, q.terrain), { owner: -1, formation: 0, spellResearch: true }))) flaws++;
    }
  /** Does an object stand with its anchor on the tile (a monster, a pickup)? */
  const standsOn = (j: number) => placed.some((q) => q.z === Z(j) && q.x === X(j) && q.y === Y(j));
  for (const zn of zones) {
    if (zn.tier === 3) continue;
    if (zn.spec) {
      templateContents(zn, zn.spec);
      continue;
    }
    const guarded = (t: ObjectTemplate | undefined, level: number, d: Record<string, unknown> = {}, near?: { x: number; y: number; min: number; max: number }) => {
      const p = placeIn(zn, t, d, near, level > 0);
      if (!p || level <= 0) return p;
      // A monster on the tile in front of the entrance: no way in without a fight.
      const f = front(p);
      const g = monsterTemplate(level, zn.terrain);
      if (g && !blocked[f]) {
        keep[f] = 0;
        bind(p, put(g, X(f), Y(f), Z(f), { count: Math.max(1, Math.round(guardCount(level) * strength * 0.7)), ...RMG_MONSTER }, 0));
        keep[f] = 1;
        // Its own front: where the hero fights from.
        const below = step(f, 0, 1);
        if (below >= 0 && zoneOf[below] === zn.id && !border[below]) keep[below] = 1;
      }
      return p;
    };
    if (zn.tier === 0) {
      // An advanced start (starts.ts): the towns its players hold already (applyStart gives them
      // away), in their own zones, so nobody's second town lies behind a rival's.
      for (let k = 0; k < (o.start ? START_PRESETS[o.start]?.extraTowns ?? 0 : 0); k++) if (!placeIn(zn, findTemplate(Obj.TOWN, zn.faction, zn.terrain), { owner: -1, formation: 0 })) flaws++;
      // Home (wood and ore came with the town): one more mine, pickups.
      guarded(findTemplate(Obj.MINE, pick([1, 3, 4, 5]), zn.terrain), 1, { owner: -1 });
      for (let k = 0; k < 2 + Math.floor(N / 36); k++) placeIn(zn, findTemplate(Obj.RANDOM_RESOURCE, undefined, zn.terrain), {});
      placeIn(zn, findTemplate(Obj.TREASURE_CHEST, undefined, zn.terrain));
      placeIn(zn, findTemplate(Obj.CAMPFIRE, undefined, zn.terrain));
      guarded(findTemplate(216, undefined, zn.terrain), 1, { owner: -1, factions: 1 << zn.faction, minLevel: 0, maxLevel: 1 });
      guarded(findTemplate(Obj.RANDOM_ART + 1, undefined, zn.terrain), 1);
    } else {
      const lvl = zn.tier === 2 ? 4 : 2;
      guarded(findTemplate(Obj.MINE, 6, zn.terrain), lvl, { owner: -1 });
      guarded(findTemplate(Obj.MINE, pick([1, 3, 4, 5]), zn.terrain), lvl - 1, { owner: -1 });
      guarded(findTemplate(Obj.MINE, pick([0, 2]), zn.terrain), lvl - 1, { owner: -1 });
      for (let k = 0; k < 2 + Math.floor(N / 36); k++) guarded(findTemplate(Obj.RANDOM_ART + (zn.tier === 2 ? 3 + (k % 2) : 1 + (k % 3)), undefined, zn.terrain), lvl + (k % 2));
      for (let k = 0; k < 2; k++) guarded(findTemplate(Obj.TREASURE_CHEST, undefined, zn.terrain), lvl - 1);
      for (let k = 0; k < 3; k++) placeIn(zn, findTemplate(Obj.RANDOM_RESOURCE, undefined, zn.terrain));
      guarded(findTemplate(216, undefined, zn.terrain), lvl, { owner: -1, minLevel: 2, maxLevel: zn.tier === 2 ? 6 : 4 });
      // An advanced start (starts.ts) wants towns to take and a grail to puzzle out: a guarded
      // neutral town in each treasure zone. (Ordinary random maps are left as they were.)
      if (o.start && zn.tier === 1) guarded(findTemplate(Obj.TOWN, pick([0, 1, 2, 3, 4, 5, 6, 7, 8]), zn.terrain), lvl, { owner: -1, formation: 0 });
    }
    if (o.start) placeIn(zn, findTemplate(57, undefined, zn.terrain));
    // Then places to visit, as the original's generator scatters them: minor ones at home, unguarded;
    // the better ones and creature banks (which bring their own guards) further out.
    const site = (ids: (number | [number, number])[], level: number) => {
      const choice = pick(ids);
      const [id, sub] = Array.isArray(choice) ? choice : [choice, undefined];
      const t = findTemplate(id, sub, zn.terrain);
      return BANK_IDS.has(id) ? placeIn(zn, t) : guarded(t, level);
    };
    const count = Math.max(1, Math.round(zn.tiles.length / 400));
    if (zn.tier === 0) for (let k = 0; k < 2 + count; k++) site(MINOR_SITES, 0);
    else if (zn.tier === 1) {
      for (let k = 0; k < 1 + count; k++) site(MAJOR_SITES, 2);
      for (let k = 0; k < count; k++) site(SMALL_BANKS, 0);
    } else if (zn.tier === 2) {
      site(BIG_BANKS, 0);
      for (let k = 0; k < count; k++) site([...SMALL_BANKS, ...MAJOR_SITES], 4);
    }
  }

  // ---- Subterranean Gates: each underground zone gets one, with its pair in the surface zone
  // above it (the game pairs each gate with the nearest one on the other level).
  if (L > 1 && !plan) {
    for (const zn of zones.filter((x) => x.level === 1)) {
      const t = findTemplate(SUBTERRANEAN_GATE, undefined, zn.terrain);
      const down = placeIn(zn, t, {}, { x: zn.cx, y: zn.cy, min: 0, max: N * 0.12 }) ?? placeIn(zn, t);
      if (!down) continue;
      // Its pair in the land zone above it (the nearest land zone when the lake or the sea is there).
      const overhead = zones[zoneOf[idx(down.x, down.y, 0)]];
      const above = overhead.tier !== 3 ? overhead : zones.filter((x) => x.level === 0 && x.tier !== 3).sort((a, b) => dist(a.cx - down.x, a.cy - down.y) - dist(b.cx - down.x, b.cy - down.y))[0];
      let up = placeIn(above, findTemplate(SUBTERRANEAN_GATE, undefined, above.terrain), {}, { x: down.x, y: down.y, min: 0, max: N * 0.15 }) ?? placeIn(above, findTemplate(SUBTERRANEAN_GATE, undefined, above.terrain));
      // No room there: the other land zones, nearest first.
      for (const other of zones.filter((x) => x.level === 0 && x.tier !== 3 && x !== above).sort((a, b) => dist(a.cx - down.x, a.cy - down.y) - dist(b.cx - down.x, b.cy - down.y))) {
        if (up) break;
        up = placeIn(other, findTemplate(SUBTERRANEAN_GATE, undefined, other.terrain));
      }
      // A gate with no way back is useless: then neither stays.
      if (!up) unplace(down);
      else bind(down, up);
    }
  }

  const road = new Uint8Array(T);
  // ---- paths: from each zone's hub to every entrance and passage in it, kept clear of obstacles.
  // Each Seer's Hut's artifact, in place of a random artifact or Pandora's Box one or two passages
  // away (template connections); a hut whose artifact finds no place goes.
  if (seers.length && plan) {
    const steps = (from: number) => {
      const d = new Map([[from, 0]]);
      const queue = [from];
      for (let q = 0; q < queue.length; q++)
        for (const c of plan.connections) {
          const next = c.a === queue[q] ? c.b : c.b === queue[q] ? c.a : -1;
          if (next >= 0 && !d.has(next)) (d.set(next, d.get(queue[q])! + 1), queue.push(next));
        }
      return d;
    };
    const taken = new Set<Placed>();
    for (const seer of seers) {
      const d = steps(zones[seer.zone].spec!.id);
      const near = (q: Placed) => {
        const zq = zones[zoneOf[idx(q.x, q.y, q.z)]];
        const k = zq?.spec ? d.get(zq.spec.id) : undefined;
        return k !== undefined && k >= 1 && k <= 2;
      };
      const swap = shuffle(placed.filter((q) => !taken.has(q) && ((q.id >= 65 && q.id <= 69) || (q.id === 6 && !q.data.creatures)) && near(q)))[0];
      const t = swap && findTemplate(5, seer.art, tiles[idx(swap.x, swap.y, swap.z)].terrain);
      if (!swap || !t || t.subid !== seer.art) {
        unplace(seer.hut);
        continue;
      }
      if (!templateIndex.has(t)) templateIndex.set(t, templates.push(t) - 1);
      Object.assign(swap, { template: t, id: 5, subid: seer.art, data: {} });
      taken.add(swap);
      seer.at = swap;
    }
  }
  for (const zn of zones) {
    // A hub something was put on moves to the nearest free tile of the zone.
    if (blocked[zn.hub] || border[zn.hub] || zoneOf[zn.hub] !== zn.id) {
      const hx = X(zn.hub);
      const hy = Y(zn.hub);
      zn.hub = zn.tiles.filter((i) => !blocked[i] && !border[i]).sort((a, b) => dist(X(a) - hx, Y(a) - hy) - dist(X(b) - hx, Y(b) - hy))[0] ?? zn.hub;
    }
    if (zn.tier === 3) continue;
    const targets = new Set<number>();
    // (A template's guards are reached from any side: not by the tile below them, which may be wall.)
    for (const p of placed) if (p.id !== Obj.BOAT && zoneOf[front(p)] === zn.id && !OBSTACLE_IDS.has(p.id) && !(plan && p.id === Obj.MONSTER)) targets.add(front(p));
    if (shore.has(zn.id)) targets.add(shore.get(zn.id)!);
    // Roads lead out: to the passages, and to the boat.
    const exits = new Set<number>(shore.has(zn.id) ? [shore.get(zn.id)!] : []);
    // Roads along the walks to the passages, kept earlier.
    for (const way of exitWays.get(zn.id) ?? []) for (const i of way) if (!blocked[i]) road[i] = zn.tier === 0 ? 3 : 2;
    // (A template's zone: one walk out from the hub for all its targets, instead of a walk to each.)
    const tree = plan ? walkTree(zn.hub, zn.id) : null;
    for (const t of targets) {
      const way = tree ? wayIn(tree, zn.hub, t) : path(zn.hub, t, zn.id);
      // Cut off after all (later objects closed the way): what stands there goes.
      if (!way.length && t !== zn.hub) {
        // (A template's thing lost: another attempt may keep it.)
        if (plan) cutOff++;
        for (const p of placed.filter((q) => !(q.id === Obj.TOWN && Number(q.data.owner) >= 0) && !passageGuards.has(q) && front(q) === t)) unplace(p);
        if (shore.get(zn.id) === t) unplace(boatOf.get(zn.id)!);
        continue;
      }
      for (const i of way) keep[i] = 1;
      // Roads from the town (or the zone's middle) out to the passages: cobblestone at home, gravel elsewhere.
      if (exits.has(t)) for (const i of way) if (!blocked[i]) road[i] = zn.tier === 0 ? 3 : 2;
    }
  }
  function nearestOfZone(i: number, zoneId: number): number {
    let best = i;
    let bestD = Infinity;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const j = step(i, dx, dy);
        if (j >= 0 && zoneOf[j] === zoneId && !blocked[j] && (!border[j] || keep[j]) && Math.abs(dx) + Math.abs(dy) < bestD) (bestD = Math.abs(dx) + Math.abs(dy)), (best = j);
      }
    return best;
  }
  /** Every walk from a on free tiles of the zone (and the opened passages): each tile's step back towards a, -1 where none goes. */
  function walkTree(a: number, zoneId: number): Int32Array {
    const prev = new Int32Array(T).fill(-1);
    prev[a] = a;
    const queue = [a];
    for (let q = 0; q < queue.length; q++)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const j = step(queue[q], dx, dy);
        if (j < 0 || prev[j] >= 0 || blocked[j] || (border[j] && !keep[j]) || (zoneOf[j] !== zoneId && !keep[j])) continue;
        prev[j] = queue[q];
        queue.push(j);
      }
    return prev;
  }
  /** The walk from a to b in a walkTree (b itself may be blocked: the walk ends beside it), [] when there's none. */
  function wayIn(prev: Int32Array, a: number, b: number): number[] {
    let end = b;
    if (prev[b] < 0) {
      if (!blocked[b]) return [];
      end = -1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const j = step(b, dx, dy);
        if (j >= 0 && prev[j] >= 0) {
          end = j;
          break;
        }
      }
      if (end < 0) return [];
    }
    const out: number[] = end === b ? [] : [b];
    for (let i = end; i !== a; i = prev[i]) out.push(i);
    out.push(a);
    return out;
  }
  /**
   * A walk for a road from a to b, as path() goes, but along roads already laid where it can and
   * straight rather than diagonal: the ways out of a zone share their road as the original's do,
   * instead of running side by side.
   */
  function roadWay(a: number, b: number, zoneId: number, laid: Uint8Array): number[] {
    const cost = new Float64Array(T).fill(Infinity);
    const prev = new Int32Array(T).fill(-1);
    cost[a] = 0;
    prev[a] = a;
    const heap: number[] = [a];
    const less = (p: number, q: number) => cost[heap[p]] < cost[heap[q]];
    const swap = (p: number, q: number) => ([heap[p], heap[q]] = [heap[q], heap[p]]);
    while (heap.length) {
      const i = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let k = 0; ; ) {
          const l = 2 * k + 1;
          const m = l + 1 < heap.length && less(l + 1, l) ? l + 1 : l;
          if (l >= heap.length || !less(m, k)) break;
          swap(k, m);
          k = m;
        }
      }
      if (i === b) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const j = step(i, dx, dy);
        if (j < 0 || (blocked[j] && j !== b) || (border[j] && !keep[j]) || (zoneOf[j] !== zoneId && !keep[j])) continue;
        const c = cost[i] + (laid[j] ? 0.3 : 1) * (dx && dy ? 1.5 : 1);
        if (c >= cost[j]) continue;
        cost[j] = c;
        prev[j] = i;
        heap.push(j);
        for (let k = heap.length - 1; k > 0 && less(k, (k - 1) >> 1); k = (k - 1) >> 1) swap(k, (k - 1) >> 1);
      }
    }
    if (prev[b] < 0) return [];
    const out: number[] = [];
    for (let i = b; i !== a; i = prev[i]) out.push(i);
    out.push(a);
    return out;
  }
  /** Shortest walk from a to b on free tiles of the zone (and the opened passages), as tiles. */
  function path(a: number, b: number, zoneId: number): number[] {
    const prev = new Int32Array(T).fill(-1);
    prev[a] = a;
    const queue = [a];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      if (i === b) break;
      for (const [dx, dy] of shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]])) {
        const j = step(i, dx, dy);
        if (j < 0 || prev[j] >= 0 || (blocked[j] && j !== b) || (border[j] && !keep[j]) || (zoneOf[j] !== zoneId && !keep[j])) continue;
        prev[j] = i;
        queue.push(j);
      }
    }
    if (prev[b] < 0) return [];
    const out: number[] = [];
    for (let i = b; i !== a; i = prev[i]) out.push(i);
    out.push(a);
    return out;
  }

  // ---- obstacles: the borders first (sealed), then clumps inside the zones. Underground, the
  // walls are rock, as in the original's caves.
  const obstacles = data.templates.filter((t) => OBSTACLE_IDS.has(t.id) && t.visitMask.every((b) => !b) && maskTiles(t.blockMask, 0).length > 0);
  // (Each terrain's own, as its editor menu lists them; the ones allowed anywhere only where a terrain has none.)
  const obstacleFor = (terrain: number) => {
    const own = obstacles.filter((t) => (t.menuMask ?? t.terrainMask) & (1 << terrain));
    return own.length ? own : obstacles.filter((t) => t.terrainMask & (1 << terrain));
  };
  const fitsObstacle = (t: ObjectTemplate, x: number, y: number, z: number, onBorder: boolean) => {
    for (const { dx, dy } of maskTiles(t.blockMask, 0)) {
      if (!inside(x + dx, y + dy)) return false;
      const i = idx(x + dx, y + dy, z);
      if (blocked[i] || keep[i] || (onBorder ? !border[i] : border[i] || entry[i])) return false;
    }
    return true;
  };
  const size = new Map(obstacles.map((t) => [t, maskTiles(t.blockMask, 0).length]));
  const cover = (i: number, onBorder: boolean, big = false, least = 0) => {
    // (Inside the zones the big ones first, as the original fills its land: mountains and woods, few pebbles.)
    const pool = shuffle(obstacleFor(tiles[i].terrain).filter((t) => size.get(t)! >= least));
    if (big) {
      const key = new Map(pool.map((t) => [t, size.get(t)! * (0.5 + random(rng))]));
      pool.sort((p, q) => key.get(q)! - key.get(p)!);
    }
    for (const t of pool) {
      // Try anchors so that one of its blocked tiles lands on i.
      for (const { dx, dy } of shuffle(maskTiles(t.blockMask, 0))) {
        if (fitsObstacle(t, X(i) - dx, Y(i) - dy, Z(i), onBorder)) return put(t, X(i) - dx, Y(i) - dy, Z(i), {}, 0);
      }
    }
    return null;
  };
  for (const i of shuffle(Array.from({ length: T }, (_, i) => i).filter((i) => border[i] && Z(i) === 0))) if (!blocked[i] && !keep[i]) cover(i, true);
  // What no obstacle could fill (and every wall underground): rock, so the borders stay closed.
  for (let i = 0; i < T; i++) if (border[i] && !blocked[i] && !keep[i]) tiles[i].terrain = Terrain.ROCK;
  // A wall of rock one tile thin can't be drawn (the original's rock pictures need two): it grows into a
  // free neighbour, as VCMI's terrain painting grows a tile no pattern fits.
  {
    const grid = { size: N, terrain: (i: number) => tiles[i].terrain };
    const free = (j: number) => j >= 0 && !blocked[j] && !keep[j] && !entry[j] && tiles[j].terrain !== Terrain.ROCK && tiles[j].terrain !== Terrain.WATER;
    for (let pass = 0; pass < 6; pass++) {
      let grown = false;
      for (let i = 0; i < T; i++) {
        if (tiles[i].terrain !== Terrain.ROCK || drawableTile(grid, X(i), Y(i), Z(i))) continue;
        let best = -1;
        let bestBad = Infinity;
        for (const [dx, dy] of [[0, -1], [-1, 0], [0, 1], [1, 0], [-1, -1], [-1, 1], [1, 1], [1, -1]]) {
          const j = step(i, dx, dy);
          if (!free(j)) continue;
          const was = tiles[j].terrain;
          tiles[j].terrain = Terrain.ROCK;
          let bad = drawableTile(grid, X(i), Y(i), Z(i)) ? 0 : 10;
          for (let ey = -1; ey <= 1; ey++)
            for (let ex = -1; ex <= 1; ex++) {
              const k = step(j, ex, ey);
              if (k >= 0 && k !== i && !drawableTile(grid, X(k), Y(k), Z(k))) bad++;
            }
          tiles[j].terrain = was;
          if (bad < bestBad) (bestBad = bad), (best = j);
        }
        if (best < 0) continue;
        tiles[best].terrain = Terrain.ROCK;
        border[best] = 1;
        grown = true;
      }
      if (!grown) break;
    }
  }
  // (A template's zone filled as the original's: every tile not on a walk or by an object, half the land as in its maps.)
  // (A template's zone: the mountains and woods over all of it first, then the smaller ones between, as VCMI fills its zones.)
  for (const zn of zones)
    if (zn.tier !== 3)
      for (const least of zn.spec ? [8, 4, 0] : [0])
        for (const i of shuffle(zn.tiles.slice())) if (!blocked[i] && !keep[i] && !entry[i] && !border[i] && (zn.spec || random(rng) < 0.18)) cover(i, false, !!zn.spec, least);

  // ---- roads: through each passage too, then their pieces.
  for (const link of links)
    for (const [dx, dy] of roadless.has(link) ? [] : [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const m = link[2];
      const j = step(m, dx, dy);
      if (j >= 0 && !blocked[j] && !road[j]) road[j] = 2;
    }
  // Into the towns' gates, as the original's roads go.
  for (const p of placed) {
    if (p.id !== Obj.TOWN) continue;
    const f = front(p);
    const v = maskTiles(p.template.visitMask, 1)[0];
    if (road[f] && v && inside(p.x + v.dx, p.y + v.dy)) road[idx(p.x + v.dx, p.y + v.dy, p.z)] = road[f];
  }
  // Roads join side by side, as the original's pieces are drawn: a diagonal step gets a corner tile
  // (else each tile shows as a road's end).
  for (let i = 0; i < T; i++) {
    if (!road[i]) continue;
    for (const dx of [-1, 1]) {
      const j = step(i, dx, 1);
      if (j < 0 || !road[j]) continue;
      const a = step(i, dx, 0);
      const b = step(i, 0, 1);
      if (road[a] || road[b]) continue;
      const free = (k: number) => k >= 0 && !blocked[k] && tiles[k].terrain !== Terrain.ROCK && tiles[k].terrain !== Terrain.WATER;
      const c = free(b) ? b : free(a) ? a : -1;
      if (c >= 0) road[c] = Math.min(road[i], road[j]);
    }
  }
  for (let i = 0; i < T; i++) {
    if (!road[i] || tiles[i].terrain === Terrain.ROCK) continue;
    let around = 0;
    let bit = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = step(i, dx, dy);
        if (j >= 0 && road[j]) around |= 1 << bit;
        bit++;
      }
    // (Side by side only: a diagonal beside a corner would draw a loop.)
    const kind = roadKind(road[i]);
    if (!kind) continue;
    const piece = look?.road?.(kind, around & 0b01011010, random(rng)) ?? { dir: 0, flags: 0 };
    tiles[i].road = kind;
    tiles[i].roadDir = piece.dir;
    tiles[i].flags |= piece.flags << 4;
  }

  // ---- terrain pictures: the original's edge patterns (terrainViews.ts), else the look learnt from real maps
  const grid = { size: N, terrain: (i: number) => tiles[i].terrain };
  const frame = (lo: number, hi: number) => randInt(rng, lo, hi);
  // (A land tile no pattern draws, such as a one-tile spit, takes its neighbours' commonest land, as VCMI's painting does.)
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let i = 0; i < T; i++) {
      const t = tiles[i].terrain;
      if (t === Terrain.ROCK || t === Terrain.WATER || drawableTile(grid, X(i), Y(i), Math.floor(i / NN))) continue;
      const count = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = step(i, dx, dy);
          const u = j >= 0 ? tiles[j].terrain : t;
          if (u !== t && u !== Terrain.ROCK && u !== Terrain.WATER) count.set(u, (count.get(u) ?? 0) + 1);
        }
      const best = [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      if (best) {
        tiles[i].terrain = best[0];
        changed = true;
      }
    }
    if (!changed) break;
  }
  // (A spit of land one tile thin into the water: the land grows into a free water tile beside it,
  // one with no object and no other zone's land next to it, so no new way round a guard opens.)
  {
    const taken = new Uint8Array(T);
    for (const p of placed)
      for (const { dx, dy } of [...maskTiles(p.template.blockMask, 0), ...maskTiles(p.template.visitMask, 1)])
        if (inside(p.x + dx, p.y + dy)) taken[idx(p.x + dx, p.y + dy, p.z)] = 1;
    const ownShore = (j: number, zone: number) => {
      for (let ey = -1; ey <= 1; ey++)
        for (let ex = -1; ex <= 1; ex++) {
          const k = step(j, ex, ey);
          if (k >= 0 && tiles[k].terrain !== Terrain.WATER && tiles[k].terrain !== Terrain.ROCK && zoneOf[k] !== zone) return false;
        }
      return true;
    };
    for (let i = 0; i < T; i++) {
      const t = tiles[i].terrain;
      if (t === Terrain.ROCK || t === Terrain.WATER || drawableTile(grid, X(i), Y(i), Z(i))) continue;
      let best = -1;
      let bestBad = Infinity;
      for (const [dx, dy] of [[0, -1], [-1, 0], [0, 1], [1, 0], [-1, -1], [-1, 1], [1, 1], [1, -1]]) {
        const j = step(i, dx, dy);
        if (j < 0 || tiles[j].terrain !== Terrain.WATER || taken[j] || blocked[j] || keep[j] || !ownShore(j, zoneOf[i])) continue;
        tiles[j].terrain = t;
        let bad = drawableTile(grid, X(i), Y(i), Z(i)) ? 0 : 10;
        for (let ey = -1; ey <= 1; ey++)
          for (let ex = -1; ex <= 1; ex++) {
            const k = step(j, ex, ey);
            if (k >= 0 && k !== i && !drawableTile(grid, X(k), Y(k), Z(k))) bad++;
          }
        tiles[j].terrain = Terrain.WATER;
        if (bad < bestBad) (bestBad = bad), (best = j);
      }
      if (best >= 0 && bestBad < 10) tiles[best].terrain = t;
    }
  }
  for (let i = 0; i < T; i++) {
    const drawn = terrainView(grid, X(i), Y(i), Math.floor(i / NN), frame, 15);
    if (drawn) {
      tiles[i].view = drawn.view;
      tiles[i].flags = (tiles[i].flags & ~3) | drawn.flags;
      continue;
    }
    const around: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = step(i, dx, dy);
        around.push(j >= 0 ? tiles[j].terrain : tiles[i].terrain);
      }
    const v = look?.view(tiles[i].terrain, around, random(rng)) ?? { view: 0, flags: 0 };
    tiles[i].view = v.view;
    tiles[i].flags = (tiles[i].flags & ~3) | v.flags;
  }

  // Sealed: a walk from any zone's middle that goes round every monster stays in that zone (a
  // gap in a wall, or a wall opened beside a passage's guard, would let heroes walk past it).
  {
    const open = new Uint8Array(T);
    const guarded = new Uint8Array(T);
    for (let i = 0; i < T; i++) open[i] = tiles[i].terrain !== Terrain.ROCK && tiles[i].terrain !== Terrain.WATER ? 1 : 0;
    for (const p of placed) for (const { dx, dy } of maskTiles(p.template.blockMask, 0)) if (inside(p.x + dx, p.y + dy)) open[idx(p.x + dx, p.y + dy, p.z)] = 0;
    for (const p of placed) {
      // (Not a boat: boarding isn't walking.)
      for (const { dx, dy } of maskTiles(p.template.visitMask, 1)) if (inside(p.x + dx, p.y + dy) && tiles[idx(p.x + dx, p.y + dy, p.z)].terrain !== Terrain.WATER) open[idx(p.x + dx, p.y + dy, p.z)] = 1;
      const monster = p.id === Obj.MONSTER || (p.id >= Obj.RANDOM_MONSTER && p.id <= Obj.RANDOM_MONSTER_L4) || (p.id >= Obj.RANDOM_MONSTER_L5 && p.id <= Obj.RANDOM_MONSTER_L7);
      // (A border guard closes its own tile: the way on is its key.)
      if (p.id === BORDER_GUARD) for (const { dx, dy } of maskTiles(p.template.visitMask, 1)) if (inside(p.x + dx, p.y + dy)) guarded[idx(p.x + dx, p.y + dy, p.z)] = 1;
      // (Round the tile it's fought from: HotA's creatures stand one tile right of their origin.)
      const v = monster ? maskTiles(p.template.visitMask, 1)[0] ?? { dx: 0, dy: 0 } : null;
      const f = v ? idx(p.x + v.dx, p.y + v.dy, p.z) : -1;
      if (monster) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inside(X(f) + dx, Y(f) + dy)) guarded[idx(X(f) + dx, Y(f) + dy, p.z)] = 1;
    }
    for (const zn of zones) {
      if (zn.tier === 3 || !open[zn.hub] || guarded[zn.hub]) continue;
      const seen = new Uint8Array(T);
      seen[zn.hub] = 1;
      const queue = [zn.hub];
      let leak = -1;
      // (Zones joined by open passages are one walk.)
      const home = new Set([zn.id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const [a, b] of openWays) if (home.has(a) !== home.has(b)) (home.add(a).add(b), (grew = true));
      }
      for (let q = 0; q < queue.length && leak < 0; q++)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const j = step(queue[q], dx, dy);
          if (j < 0 || seen[j] || !open[j] || guarded[j]) continue;
          seen[j] = 1;
          if (!home.has(zoneOf[j]) && !wet(zoneOf[j])) {
            leak = j;
            break;
          }
          queue.push(j);
        }
      if (leak >= 0) flaws += 10;
    }
  }
  // A template's map in one piece: from a start, past monsters (fighting) and through monoliths and
  // gates, every zone is reached.
  if (plan && zones.length) {
    const open = new Uint8Array(T);
    for (let i = 0; i < T; i++) open[i] = tiles[i].terrain !== Terrain.ROCK && tiles[i].terrain !== Terrain.WATER ? 1 : 0;
    for (const p of placed) for (const { dx, dy } of maskTiles(p.template.blockMask, 0)) if (inside(p.x + dx, p.y + dy)) open[idx(p.x + dx, p.y + dy, p.z)] = 0;
    const jump = new Map<number, number>();
    const entrance = (p: Placed) => {
      const v = maskTiles(p.template.visitMask, 1)[0] ?? { dx: 0, dy: 0 };
      return idx(p.x + v.dx, p.y + v.dy, p.z);
    };
    for (const p of placed) for (const { dx, dy } of maskTiles(p.template.visitMask, 1)) if (inside(p.x + dx, p.y + dy)) open[idx(p.x + dx, p.y + dy, p.z)] = 1;
    for (const [a, b] of portals) if (placed.includes(a) && placed.includes(b)) (jump.set(entrance(a), entrance(b)), jump.set(entrance(b), entrance(a)));
    const start = zones.find((z) => z.player >= 0) ?? zones[0];
    const seen = new Uint8Array(T);
    // (Islands: from every island's middle, each reached by its boat.)
    const queue = o.islands ? zones.filter((z) => z.tier !== 3 && z.hub >= 0).map((z) => z.hub) : [start.hub];
    for (const i of queue) seen[i] = 1;
    // (Most things are entered from the side or below, never stepping down onto them, as the game walks.)
    const noTop = new Uint8Array(T);
    for (const p of placed) if (!visitableFromTop({ type: p.id })) for (const { dx, dy } of maskTiles(p.template.visitMask, 1)) if (inside(p.x + dx, p.y + dy)) noTop[idx(p.x + dx, p.y + dy, p.z)] = 1;
    for (let q = 0; q < queue.length; q++) {
      const there = jump.get(queue[q]);
      if (there !== undefined && !seen[there]) (seen[there] = 1), queue.push(there);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const j = step(queue[q], dx, dy);
        // (A boat on the water is boarded, not walked through.)
        if (j >= 0 && !seen[j] && open[j] && !(dy === 1 && noTop[j])) ((seen[j] = 1), tiles[j].terrain !== Terrain.WATER && queue.push(j));
      }
    }
    // (Islands are reached by boat: the walk is what each island's own boat and shore are for.)
    if (!o.islands) for (const zn of zones) if (zn.tier !== 3 && !zn.tiles.some((i) => seen[i])) flaws += 10;
    // A thing walled in after all (in a zone the walk reaches, no tile of its entrance reached): it goes.
    for (const p of placed.slice()) {
        if (OBSTACLE_IDS.has(p.id) || p.id === Obj.BOAT) continue;
        const visits = maskTiles(p.template.visitMask, 1).filter(({ dx, dy }) => inside(p.x + dx, p.y + dy)).map(({ dx, dy }) => idx(p.x + dx, p.y + dy, p.z));
        const zn = zones[zoneOf[idx(p.x, p.y, p.z)]];
        if (visits.length && !visits.some((i) => seen[i]) && zn && zn.tiles.some((i) => seen[i])) (unplace(p), cutOff++);
      }
  }
  // Gates in pairs; with islands, a boat on every island.
  if (L > 1) {
    const gates = placed.filter((p) => p.id === SUBTERRANEAN_GATE);
    if (!gates.length || gates.filter((g) => g.z === 0).length !== gates.filter((g) => g.z === 1).length) flaws++;
  }
  if (o.islands) for (const zn of zones) if (zn.level === 0 && zn.tier !== 3 && !(boatOf.get(zn.id) && placed.includes(boatOf.get(zn.id)!))) flaws++;
  // (A hut whose artifact was cleared away after all, walled in: it goes too.)
  for (const seer of seers) if (seer.at && !placed.includes(seer.at)) unplace(seer.hut);
  const objects: MapObject[] = placed.map((p) => ({ x: p.x, y: p.y, z: p.z, template: templateIndex.get(p.template)!, id: p.id, subid: p.subid, data: p.data }));
  const map: H3Map = {
    version: 0x1c,
    hotaVersion: 0,
    size: N,
    levels: L,
    ...randomMapTitle(o, tpl),
    difficulty: 1,
    levelLimit: 0,
    players,
    victory: { type: -1 },
    loss: { type: -1 },
    rumors: [],
    tiles,
    templates,
    objects,
    events: [],
  };
  return { map, flaws: flaws + cutOff / Math.max(40, placed.length / 50) };
}

/** What a pile's extra things can be: resources, chests, campfires, artifacts (taken from any side, one tile each). */
const PICKUPS = new Set([79, 76, 101, 12, 66, 67, 68, 69]);

/** Minor places to visit (windmill, water wheel, garden, lean-to, wells, fountains, idol, temple...). */
const MINOR_SITES = [112, 109, 55, 39, 49, 30, 38, 96, 64, 31, 100, 88, 113, 81, 58, 61, 23, 51, 32];
/** Better ones, worth a guard (library, tree of knowledge, shrines, arena, schools, university, tomb, den of thieves). */
const MAJOR_SITES = [41, 102, 89, 90, 4, 47, 107, 104, 108, 97];
/** Creature banks: Cyclops Stockpile, Dwarven Treasury, Griffin Conservatory, Imp Cache, Medusa Stores, Naga Bank, Dragon Fly Hive. */
const SMALL_BANKS: [number, number][] = [[16, 0], [16, 1], [16, 2], [16, 3], [16, 4], [16, 5], [16, 6]];
/** Dragon Utopia, Crypt, Pyramid. */
const BIG_BANKS: [number, number][] = [[25, 0], [84, 0], [63, 0]];
const BANK_IDS = new Set([16, 25, 84, 63]);

/** Distance by square root, which every JavaScript engine computes exactly alike (Math.hypot needn't). */
function dist(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** How many guards of a level stand in a passage at normal strength. */
function guardCount(level: number): number {
  return [0, 30, 22, 16, 12, 8, 5, 3][level] ?? 3;
}

/** Value noise in -1..1, smoothed over `cell` tiles. */
function smoothNoise(rng: HasRng, n: number, cell: number): Float32Array {
  const g = Math.ceil(n / cell) + 2;
  const grid = Array.from({ length: g * g }, () => random(rng) * 2 - 1);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const fx = x / cell;
      const fy = y / cell;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const v = (a: number, b: number) => grid[(y0 + b) * g + x0 + a];
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      out[y * n + x] = (v(0, 0) * (1 - sx) + v(1, 0) * sx) * (1 - sy) + (v(0, 1) * (1 - sx) + v(1, 1) * sx) * sy;
    }
  return out;
}

/**
 * Learns which picture real maps use for each terrain and its 3x3 neighbourhood (and which
 * mirroring), so generated maps draw their terrain edges as the original's do.
 */
export function learnTerrainLook(maps: H3Map[]): TerrainLook {
  const roads = new Map<string, { dir: number; flags: number }[]>();
  const roadsLoose = new Map<string, { dir: number; flags: number }[]>();
  const exact = new Map<string, { view: number; flags: number }[]>();
  const loose = new Map<string, { view: number; flags: number }[]>();
  const cat = (t: number, n: number) => (n === t ? "=" : n === Terrain.DIRT ? "d" : n === Terrain.SAND ? "s" : n === Terrain.WATER ? "w" : n === Terrain.ROCK ? "r" : "o");
  const note = (m: Map<string, { view: number; flags: number }[]>, k: string, v: { view: number; flags: number }) => {
    const list = m.get(k) ?? m.set(k, []).get(k)!;
    if (list.length < 64) list.push(v);
  };
  for (const map of maps) {
    const n = map.size;
    for (let z = 0; z < map.levels; z++)
      for (let y = 1; y < n - 1; y++)
        for (let x = 1; x < n - 1; x++) {
          const t = map.tiles[z * n * n + y * n + x];
          const around: number[] = [];
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) around.push(map.tiles[z * n * n + (y + dy) * n + x + dx].terrain);
          const v = { view: t.view, flags: t.flags & 3 };
          note(exact, `${t.terrain}:${around.join(",")}`, v);
          if (t.road) {
            let bits = 0;
            let bit = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                if (map.tiles[z * n * n + (y + dy) * n + x + dx].road) bits |= 1 << bit;
                bit++;
              }
            const piece = { dir: t.roadDir, flags: (t.flags >> 4) & 3 };
            const add = (m: Map<string, { dir: number; flags: number }[]>, k: string) => {
              const list = m.get(k) ?? m.set(k, []).get(k)!;
              if (list.length < 32) list.push(piece);
            };
            add(roads, `${t.road}:${bits}`);
            // Any road type: the pieces are laid out the same in each road's sprites.
            add(roadsLoose, `${bits}`);
            // The straight neighbours alone, for patterns the maps never show.
            add(roadsLoose, `+${bits & 0b01011010}`);
          }
          note(loose, `${t.terrain}:${around.map((a) => cat(t.terrain, a)).join("")}`, v);
        }
  }
  return {
    road(type, around, r) {
      const list = roads.get(`${type}:${around}`) ?? roadsLoose.get(`${around}`) ?? roadsLoose.get(`+${around & 0b01011010}`);
      return list?.length ? list[Math.floor(r * list.length)] : { dir: 0, flags: 0 };
    },
    view(terrain, around, r) {
      const list = exact.get(`${terrain}:${around.join(",")}`) ?? loose.get(`${terrain}:${around.map((a) => cat(terrain, a)).join("")}`) ?? loose.get(`${terrain}:========`);
      return list?.length ? list[Math.floor(r * list.length)] : { view: 0, flags: 0 };
    },
  };
}
