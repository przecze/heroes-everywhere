import { GAME_LINE_FILES, type GameLineFile, setGameLines } from "../gameLines.ts";
import { type H3Map, type HeroCustom, type HotaPreset, type ObjectTemplate, decodeText, parseObjectsTxt, parseTxt } from "@heroes/formats";
import { parseRandomMapName } from "./rmg.ts";
import { type RuleOverrides, addNoHotaBans, isHotaCreature, HOTA_FACTION_LIST, startFactionMask } from "./gameRules.ts";
import { type RmgTemplate, parseRmgBundle, parseRmgTxt } from "./rmgTemplates.ts";
import { EXTRA_TEMPLATES } from "../extraTemplates.ts";
import { applyCase } from "./cases.ts";
import { SCENE_LATER_HEROES, applyScene, parseSceneName } from "./scenes.ts";
import { parseOccasionName, sceneOccasion } from "./occasions.ts";
import { applyStrategy, parseStrategyName } from "./strategyCases.ts";
import { applyStart } from "./starts.ts";
import { handicapped } from "./handicap.ts";
import { type Personality, startPersonality } from "./aiPersonality.ts";
import { type CreatureStats, isRecruitable, parseCreatures } from "../creatures.ts";
import { HERO_CLASSES, HERO_INFO, WATER_HEROES, heroArmySizes, mapPortrait } from "../heroData.ts";
import { HOTA_CREATURES } from "../hotaData.ts";
import { SKILLS, skillId } from "../skills.ts";
import { type SpellInfo, parseSpells } from "../spells.ts";
import { HERO_SPELLS } from "../heroSpells.ts";
import { SPELL_ART } from "../spellArt.ts";
import { maxMana, stockGuild } from "./magic.ts";
import { HOTA_ARTIFACTS, MACHINE_CREATURE, MACHINE_SLOT, SLOT, SPELLBOOK_ARTIFACT, equipArtifact, giveArtifact, initEquipment, randomArtifactPool } from "./artifacts.ts";
import { ARTIFACT_INFO } from "../artifactData.ts";
import { importVars } from "./scripts.ts";
import { type CampaignStart, YOG_WIZARD, applyCampaignBonus, campaignClassText, carriedFor, heroFromCarried, parseCampaignRef } from "./campaign.ts";

/** Campaign special cases' heroes and artifact: Mutare, Mutare Drake, Yog as Birth of a Barbarian's Wizard (Solmyr's slot), the Angelic Alliance. */
const MUTARE = 151;
const MUTARE_DRAKE = 153;
const ANGELIC_ALLIANCE = 129;
import { DWELLINGS } from "../dwellingData.ts";
import { TOWNS } from "../townData.ts";
import { type HasRng, randInt } from "../rng.ts";
import { startDay } from "./movement.ts";
import { catchUpLevels } from "./combat.ts";
import { type AdvObject, type AdventureState, type ArmySlot, type Hero, Obj, type Player, type TavernSlot } from "./types.ts";
import { World, maskTiles, revealOwned, visitOffset } from "./world.ts";
import { resolveConditions } from "./conditions.ts";
import { levelCount, type TownTexts, initialTown, parseTownTexts, weeklyGrowth } from "./town.ts";

export const FACTIONS = ["castle", "rampart", "tower", "inferno", "necropolis", "dungeon", "stronghold", "fortress", "conflux", "cove", "factory", "bulwark"];

/** Normal difficulty: wood, mercury, ore, sulfur, crystal, gems, gold. */
/**
 * Starting resources by difficulty (Easy, Normal, Hard, Expert, Impossible), for humans and for
 * the AI (VCMI's difficulty.json: wood, mercury, ore, sulfur, crystal, gems, gold).
 */
const START_HUMAN = [
  [30, 15, 30, 15, 15, 15, 30000],
  [20, 10, 20, 10, 10, 10, 20000],
  [15, 7, 15, 7, 7, 7, 15000],
  [10, 4, 10, 4, 4, 4, 10000],
  [0, 0, 0, 0, 0, 0, 0],
];
const START_AI = [
  [5, 2, 5, 2, 2, 2, 5000],
  [10, 4, 10, 4, 4, 4, 7500],
  [15, 7, 15, 7, 7, 7, 10000],
  [15, 7, 15, 7, 7, 7, 10000],
  [15, 7, 15, 7, 7, 7, 10000],
];
export const DIFFICULTY_NAMES = ["Easy", "Normal", "Hard", "Expert", "Impossible"];
/** The score multiplier of each difficulty, as shown on the scenario screen. */
export const DIFFICULTY_RATING = [80, 100, 130, 160, 200];

// Default guard sizes when the map leaves them random (by creature level).
const MONSTER_AMOUNT: [number, number][] = [[0, 0], [20, 50], [16, 30], [12, 25], [10, 20], [8, 16], [6, 12], [3, 6]];

export interface GameData {
  creatures: CreatureStats[];
  /** OBJECTS.TXT, to find art for resolved random objects. */
  templates: ObjectTemplate[];
  /** Hero names by hero id (HOTRAITS.TXT). */
  heroNames: string[];
  /** Starting attack/defense/power/knowledge by hero class (HCTRAITS.TXT). */
  classPrimary: [number, number, number, number][];
  /** Odds (out of 100) of each primary skill on level-up: levels 2-9, then 10+. */
  classLevelOdds: { low: number[]; high: number[] }[];
  /** Building costs and names; absent in tests that don't need towns. */
  townTexts?: TownTexts;
  /** Spells (SPTRAITS.TXT). */
  spells?: SpellInfo[];
  /** Secondary skill weights per hero class (HCTRAITS.TXT, out of 112). */
  classSkillOdds?: number[][];
  /** How often each hero class comes up in each faction's taverns (HCTRAITS.TXT's "Selection Probability"). */
  classTavernOdds?: Record<string, number>[];
  /** Artifact names, prices and tiers (ARTRAITS.TXT): S special, T treasure, N minor, J major, R relic. */
  artifacts: { name: string; cost: number; tier: string; slots: number[]; description: string }[];
  /** Names for towns the map leaves unnamed, per town type (TOWNNAME.TXT, 16 each). */
  townNames?: string[][];
  /** The random map templates (HotA's _HD3_Data/Templates, else the original's RMG.TXT; rmgTemplates.ts). */
  rmgTemplates?: RmgTemplate[];
}

export interface AdventureSetup {
  seed: number;
  mapFile: string;
  /** Per player colour; default: first human-capable player is human, the rest AI. */
  controllers?: ("human" | "ai" | "none")[];
  /** Start with simultaneous turns (default) or classic one-at-a-time turns. */
  turnMode?: "simultaneous" | "sequential";
  /** Simultaneous turns end once rival heroes come this close (tiles). */
  contactDistance?: number;
  /** Simultaneous turns last at most to this day (HD+'s "simultaneous turns till day"); none: until contact. */
  simultaneousUntil?: number;
  /** A campaign scenario: carried heroes for the placeholders and the chosen start bonus. */
  campaign?: CampaignStart;
  /** 0 Easy .. 4 Impossible (default 1, Normal): starting resources. */
  difficulty?: number;
  /** Advanced options per player colour: starting town (for random towns), hero, bonus. */
  choices?: ({ faction?: string; hero?: number; bonus?: "gold" | "resource" | "artifact"; /** 1 Mild, 2 Severe. */ handicap?: number; /** Its team instead of the map's (HotA's scenario options: Teams). */ team?: number; /** A computer player's personality instead of the map's AI tactic. */ personality?: Personality | "random" } | undefined)[];
  /** The Advanced Options' Player Turn Duration, in minutes (none: unlimited). */
  turnMinutes?: number;
  /** Without the content HotA added (a random map's name says it too), and the HotA rules turned off. */
  noHota?: boolean;
  rules?: RuleOverrides;
}

/** A faction's own resource (its level 7 creature's): wood and ore, or one rare resource. */
// Aggression per map disposition: compliant, friendly, aggressive, hostile, savage (VCMI's initObj).
const AGGRESSION: [number, number][] = [[-4, -4], [1, 7], [1, 10], [4, 10], [10, 10]];

/** A monster's aggression: the HotA map's own, else rolled by its disposition. */
export function rollAggression(s: HasRng, data: Record<string, unknown>): number {
  if (data.aggression !== undefined) return Number(data.aggression);
  const [lo, hi] = AGGRESSION[Math.min(4, Math.max(0, Number(data.character ?? 2)))];
  return randInt(s, lo, hi);
}

export function primaryResources(data: GameData, faction: string | undefined): number[] {
  const town = TOWNS.find((t) => t.faction === faction);
  const c = town ? data.creatures[town.creatures[6][0]] : undefined;
  const rare = c?.cost.findIndex((n, i) => n > 0 && [1, 3, 4, 5].includes(i)) ?? -1;
  return rare >= 0 ? [rare] : [0, 2];
}

/** Does this map object become part of the game state (vs. static scenery)? */
export function isInteractive(map: H3Map, i: number): boolean {
  const o = map.objects[i];
  const t = map.templates[o.template];
  return t.visitMask.some((b) => b !== 0) || [Obj.HERO, Obj.RANDOM_HERO, Obj.HERO_PLACEHOLDER, Obj.EVENT, Obj.GRAIL].includes(o.id as 34);
}

function pick<T>(rng: HasRng, items: T[]): T {
  return items[randInt(rng, 0, items.length - 1)];
}

function findTemplate(data: GameData, id: number, subid: number): ObjectTemplate | undefined {
  return data.templates.find((t) => t.id === id && t.subid === subid);
}

export function heroArmy(rng: HasRng, type: number): (ArmySlot | null)[] {
  const army: (ArmySlot | null)[] = Array(7).fill(null);
  const info = HERO_INFO[type];
  // War machines (145-149: catapult, ballista, tent, cart, tower) aren't army stacks; they come with M2's war machines.
  info?.army.filter(([creature]) => creature < 145 || creature > 149).forEach(([creature, min, max], i) => {
    // Like the original, the second and third stacks aren't always given.
    if (i === 0 || randInt(rng, 0, 1)) army[i] = { creature, count: randInt(rng, min, max) };
  });
  return army;
}

export function randomHeroOf(rng: HasRng & { unhirable?: number[]; heroPlayers?: Record<number, number> }, faction: string | undefined, taken: Set<number>, player?: number): number {
  // Never the campaign heroes (Mutare, Sir Mullich, HotA's own...), nor those this map leaves out
  // (for this player: Battle of the Sexes gives each side its own).
  const ids = Object.keys(HERO_INFO)
    .map(Number)
    .filter((id) => !HERO_INFO[id].special && !rng.unhirable?.includes(id) && !taken.has(id) && (!faction || HERO_CLASSES[HERO_INFO[id].heroClass]?.faction === faction) && heroFor(rng, id, player));
  if (ids.length) return pick(rng, ids);
  return faction ? randomHeroOf(rng, undefined, taken, player) : player !== undefined ? randomHeroOf(rng, undefined, taken) : 0;
}

/** May this player have this hero (the map's hero settings can name who may)? */
export const heroFor = (s: { heroPlayers?: Record<number, number> }, id: number, player?: number) => player === undefined || !!((s.heroPlayers?.[id] ?? 0xff) & (1 << player));

/** The heroes a map lets only some players hire. */
function heroPlayersOf(map: H3Map): Record<number, number> | undefined {
  const out = Object.fromEntries(Object.entries(map.heroCustom ?? {}).filter(([, c]) => c.players !== undefined && (c.players & 0xff) !== 0xff).map(([id, c]) => [Number(id), c.players!]));
  return Object.keys(out).length ? out : undefined;
}

/** Heroes a map's taverns and random picks leave out: those it bans, and the water or land ones it doesn't suit (VCMI's banWaterHeroes: water on 1% of the map). */
export function unhirableHeroes(map: H3Map): number[] {
  const water = map.tiles.filter((t) => t.terrain === 8).length >= map.tiles.length / 100;
  const out = new Set(map.bannedHeroes ?? []);
  for (const [id, rule] of Object.entries(WATER_HEROES)) if ((rule === "only") !== water) out.add(+id);
  return [...out].sort((a, b) => a - b);
}

/** The map format's artifact slots (head ... misc 4, the four machines, spellbook, misc 5) as the hero's. */
const MAP_SLOT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, SLOT.MACH1, SLOT.MACH2, SLOT.MACH3, SLOT.MACH4, SLOT.SPELLBOOK, SLOT.MISC5];

/**
 * What a map's author set for a hero, in order (its hero settings, then the hero or prisoner on the
 * map): name, portrait, gender, experience, secondary and primary skills, spells, artifacts. The levels
 * that experience brings come once the world is up (catchUpLevels).
 */
export function customizeHero(h: Hero, data: GameData, ...customs: (HeroCustom | Record<string, unknown> | undefined)[]) {
  for (const c of customs as HeroCustom[]) {
    if (!c) continue;
    if (c.name) h.name = c.name;
    const face = typeof c.portrait === "number" && c.portrait !== 0xff ? mapPortrait(c.portrait) : undefined;
    if (face) h.portrait = face;
    if (c.gender === 0 || c.gender === 1) h.female = c.gender === 1;
    if (typeof c.experience === "number" && c.experience > 0) h.experience = c.experience;
    if (Array.isArray(c.skills)) h.skills = c.skills.filter((x) => x.level > 0).map((x) => [x.skill, Math.min(3, x.level)] as [number, number]);
    if (Array.isArray(c.primary) && c.primary.length === 4) h.primary = [...c.primary];
    if (Array.isArray(c.spells)) h.spells = [...c.spells];
    if (c.artifacts) {
      // The author's artifacts instead of the hero's own (the spellbook stays: VCMI gives it back).
      h.equipped = undefined;
      initEquipment(h);
      const pack: number[] = [];
      c.artifacts.worn.forEach((id, i) => {
        if (id < 0 || MAP_SLOT[i] === undefined) return;
        if (id === SPELLBOOK_ARTIFACT) {
          h.spells ??= [];
          h.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
        } else if (!equipArtifact(h, data.artifacts, id)) pack.push(id);
      });
      const carried = [...pack, ...c.artifacts.backpack.filter((id) => id >= 0)];
      if (carried.length) h.backpack = carried;
    }
  }
}

export function createAdventure(map: H3Map, data: GameData, setup: AdventureSetup): { state: AdventureState; world: World } {
  // Without HotA's content: the map's bans (also of a fixed map, whose copy is changed, not the cached original) keep it out of every random draw.
  const named = parseRandomMapName(setup.mapFile);
  const noHota = !!(setup.noHota || named?.noHota);
  const rules = setup.rules ?? named?.rules;
  if (noHota) {
    map = { ...map, banned: map.banned && { artifacts: [...map.banned.artifacts], spells: [...map.banned.spells], skills: [...map.banned.skills] }, bannedHeroes: map.bannedHeroes && [...map.bannedHeroes] };
    addNoHotaBans(map);
  }
  const ownFactions = noHota ? FACTIONS.filter((f) => !HOTA_FACTION_LIST.includes(f)) : FACTIONS;
  const s: AdventureState = {
    id: setup.seed,
    rng: setup.seed >>> 0,
    mapFile: setup.mapFile,
    ...(map.banned && (map.banned.artifacts.length || map.banned.spells.length || map.banned.skills.length) ? { banned: map.banned } : {}),
    ...(unhirableHeroes(map).length ? { unhirable: unhirableHeroes(map) } : {}),
    ...(heroPlayersOf(map) ? { heroPlayers: heroPlayersOf(map) } : {}),
    ...(map.hotaOptions?.noRehiring ? { noRehiring: true } : {}),
    ...(noHota ? { noHota: true } : {}),
    ...(rules && Object.keys(rules).length ? { rules } : {}),
    difficulty: setup.difficulty ?? 1,
    size: map.size,
    levels: map.levels,
    day: 1,
    current: 0,
    players: [],
    heroes: [],
    objects: [],
    replaced: [],
    version: SAVE_VERSION,
    mapObjects: map.objects.length,
    battles: {},
    turnMode: setup.turnMode ?? "simultaneous",
    ...(setup.turnMinutes ? { turnMinutes: setup.turnMinutes } : {}),
    ended: Array(8).fill(false),
    contactDistance: setup.contactDistance ?? 12,
    ...(setup.simultaneousUntil ? { simultaneousUntil: setup.simultaneousUntil } : {}),
    log: [],
  };

  let humanAssigned = false;
  map.players.forEach((p, color) => {
    let controller: Player["controller"] = setup.controllers?.[color] ?? "none";
    if (!setup.controllers) {
      if (p.canHuman && !humanAssigned) {
        controller = "human";
        humanAssigned = true;
      } else if (p.canHuman || p.canComputer) {
        controller = "ai";
      }
    }
    const allowed = ownFactions.filter((f) => (p.allowedFactions ?? 0) & (1 << FACTIONS.indexOf(f)));
    // (A town picked in New Game: HotA's too on a map of the original's that allows every town; drawn at random: the map's.)
    const pickable = ownFactions.filter((f) => startFactionMask(p.allowedFactions ?? 0, !!map.hotaVersion) & (1 << FACTIONS.indexOf(f)));
    const handicap = Math.max(0, Math.min(2, setup.choices?.[color]?.handicap ?? 0));
    s.players.push({
      color,
      controller,
      resources: (controller === "human" ? START_HUMAN : START_AI)[Math.max(0, Math.min(4, setup.difficulty ?? 1))].map((n) => handicapped(handicap, n)),
      ...(handicap ? { handicap } : {}),
      alive: controller !== "none",
      faction: controller === "none" ? undefined : setup.choices?.[color]?.faction && (pickable.length ? pickable : ownFactions).includes(setup.choices[color]!.faction!) ? setup.choices[color]!.faction : pick(s, allowed.length ? allowed : ownFactions),
      revealed: [],
      team: setup.choices?.[color]?.team ?? p.team,
    });
    const personality = controller === "ai" ? startPersonality(setup.choices?.[color]?.personality, p.aiTactic, setup.seed, color) : undefined;
    if (personality) s.players[s.players.length - 1].personality = personality;
  });

  // (Heroes the map names, on the map or in a prison, are out of the pool from the start, as in VCMI:
  // no tavern or random hero is them, whichever comes first in the map's list.)
  // The heroes players picked are theirs: a random hero (an earlier player's, or one the map places) is never one of them (2026-10-29:
  // "I picked Craig Hack" and another player had drawn him first).
  const pickedHeroes = new Set(map.players.map((_, color) => setup.choices?.[color]?.hero).filter((h): h is number => h !== undefined && h >= 0));
  const takenHeroes = new Set<number>(map.objects.filter((m) => (m.id === Obj.PRISON || m.id === Obj.HERO) && typeof m.data.hero === "number" && m.data.hero >= 0).map((m) => m.data.hero as number));
  const usedCarried = new Set<number>();
  /** The campaign and scenario this map is (its special cases below). */
  const camp = parseCampaignRef(setup.mapFile);
  /** The heroes a placeholder brought back: the map's own copy of one of them leaves (VCMI's placeCampaignHeroes). */
  const fromCarried = new Set<Hero>();
  const interactive = new Set<number>();
  /** Subterranean Gates a generated map pairs itself (rmg.ts: a template's connection between levels), by key. */
  const gateKeys = new Map<number, AdvObject>();
  /** Random dwellings tied to a town, settled after the loop. */
  const linkedDwellings: { obj: AdvObject; mo: (typeof map.objects)[number]; t: ObjectTemplate; town: number }[] = [];
  map.objects.forEach((mo, i) => {
    if (!isInteractive(map, i)) return;
    interactive.add(i);
    s.replaced.push(i);
    const t = map.templates[mo.template];
    const owner = typeof mo.data.owner === "number" && mo.data.owner < 8 ? mo.data.owner : -1;

    // Campaign hero placeholders: a hero carried from an earlier scenario (else nobody).
    if (mo.id === Obj.HERO_PLACEHOLDER) {
      if (owner < 0 || s.players[owner].controller === "none" || !setup.campaign) return;
      const c = carriedFor(setup.campaign, usedCarried, mo.data, s.players[owner].controller === "human");
      if (!c) return;
      takenHeroes.add(c.type);
      // Dragon's Blood's fourth scenario: Mutare comes back a dragon, Mutare Drake, 4 Attack and
      // Defense the stronger (the original's hard-coded case, VCMI's transformMutareIntoDrakeIfApplicable).
      const drake = camp?.file === "blood" && camp.scenario === 3 && c.type === MUTARE;
      const type = drake ? MUTARE_DRAKE : c.type;
      const base = makeHero(s, data, type, owner, mo.x - 1, mo.y, mo.z, heroArmy(s, type));
      const h = heroFromCarried(base, drake ? { ...c, type, name: base.name, primary: c.primary && [c.primary[0] + 4, c.primary[1] + 4, c.primary[2], c.primary[3]] } : c);
      if (drake && !c.primary) (h.primary[0] += 4), (h.primary[1] += 4);
      fromCarried.add(h);
      s.heroes.push(h);
      return;
    }
    if (mo.id === Obj.GRAIL) return; // buried, not an object

    if (mo.id === Obj.HERO || mo.id === Obj.RANDOM_HERO) {
      if (owner < 0 || s.players[owner].controller === "none") return;
      let type = typeof mo.data.hero === "number" && mo.data.hero >= 0 ? mo.data.hero : -1;
      // (The same hero placed twice: the second one is someone else.)
      if (s.heroes.some((h) => h.type === type)) type = -1;
      // A player's random hero is the one they picked in the setup, if still free (VCMI's pickNextHeroType;
      // The owner, 2026-11-03: Brave New World ignored the pick: its start is a random hero on the map, not one the
      // main town makes, and on Fort Noxis or War of the Mighty there are both and the town then makes none).
      const picked = setup.choices?.[owner]?.hero;
      if (mo.id === Obj.RANDOM_HERO && picked !== undefined && picked >= 0 && !takenHeroes.has(picked) && !s.heroes.some((h) => h.type === picked)) type = picked;
      else if (type < 0 || mo.id === Obj.RANDOM_HERO) type = randomHeroOf(s, s.players[owner].faction, new Set([...takenHeroes, ...pickedHeroes]), owner >= 0 ? owner : undefined);
      takenHeroes.add(type);
      // (A custom army with every slot empty: the hero's usual one, as VCMI's initArmy.)
      const army = Array.isArray(mo.data.army) && (mo.data.army as { creature: number }[]).some((a) => a.creature >= 0)
        ? Array.from({ length: 7 }, (_, slot) => {
            const a = (mo.data.army as { slot: number; creature: number; count: number }[]).find((x) => x.slot === slot);
            return a && a.creature >= 0 ? { creature: a.creature, count: a.count } : null;
          })
        : heroArmy(s, type);
      // Hero templates are anchored one tile right of where the hero stands.
      const hero = makeHero(s, data, type, owner, mo.x - 1, mo.y, mo.z, army, (mo.data.name as string) || undefined);
      customizeHero(hero, data, map.heroCustom?.[type], mo.data);
      if (typeof mo.data.identifier === "number") hero.ident = mo.data.identifier;
      s.heroes.push(hero);
      return;
    }

    let type = mo.id;
    let subid = mo.subid;
    let tmpl: ObjectTemplate | undefined = t;
    let amount: number | undefined;
    let townOwner = owner;

    if (type === Obj.RANDOM_RESOURCE) {
      type = Obj.RESOURCE;
      subid = randInt(s, 0, 6);
      tmpl = findTemplate(data, type, subid) ?? t;
    }
    if (type === Obj.RESOURCE) {
      const given = Number(mo.data.amount) || 0;
      // Gold piles are stored in hundreds.
      amount = given ? (subid === 6 ? given * 100 : given) : subid === 6 ? randInt(s, 5, 10) * 100 : subid === 0 || subid === 2 ? randInt(s, 5, 10) : randInt(s, 3, 6);
    }
    const randomLevel = mo.id === Obj.RANDOM_MONSTER ? randInt(s, 1, 7)
      : mo.id >= Obj.RANDOM_MONSTER_L1 && mo.id <= Obj.RANDOM_MONSTER_L4 ? mo.id - Obj.RANDOM_MONSTER_L1 + 1
      : mo.id >= Obj.RANDOM_MONSTER_L5 && mo.id <= Obj.RANDOM_MONSTER_L7 ? mo.id - Obj.RANDOM_MONSTER_L5 + 5
      : 0;
    if (randomLevel) {
      type = Obj.MONSTER;
      const choices = data.creatures.filter((c) => isRecruitable(c) && c.level === randomLevel && !(noHota && isHotaCreature(c.id)) && findTemplate(data, Obj.MONSTER, c.id));
      subid = choices.length ? pick(s, choices).id : 0;
      tmpl = findTemplate(data, type, subid) ?? t;
    }
    if (type === Obj.MONSTER) {
      const level = data.creatures[subid]?.level || 1;
      // The neutral dragons count as level 10.
      const [lo, hi] = MONSTER_AMOUNT[Math.min(7, level)];
      // HotA's "size by value": as many as come to the map's total AI value.
      const value = mo.data.sizeByValue ? Number(mo.data.targetValue) / (data.creatures[subid]?.aiValue || 1) : 0;
      amount = value ? Math.max(1, Math.round(value)) : Number(mo.data.count) || randInt(s, lo, hi);
    }
    if (type >= Obj.RANDOM_ART && type <= Obj.RANDOM_RELIC_ART) {
      // Random artifact of a tier (any of T/N/J/R for the plain random one); combined artifacts never drop.
      const tiers = ["TNJR", "T", "N", "J", "R"][type - Obj.RANDOM_ART];
      const ids = randomArtifactPool(data.artifacts, tiers, map.banned?.artifacts)
        .filter((id) => findTemplate(data, Obj.ARTIFACT, id))
        .map((id) => ({ id }));
      if (ids.length) {
        type = Obj.ARTIFACT;
        subid = pick(s, ids).id;
        tmpl = findTemplate(data, type, subid) ?? t;
      }
    }
    // Random dwelling: 216 any faction and level, 217 a fixed level (subid), 218 a fixed faction (subid).
    // One the editor tied to a town ("same as town", 216/217) takes that town's faction; the town may come later
    // in the map's list, so those are settled once every town stands (below).
    const linkedTo = (type === 216 || type === 217) && Number(mo.data.identifier) > 0 ? Number(mo.data.identifier) : 0;
    if ((type === 216 || type === 217 || type === 218) && !linkedTo) {
      const sub = randomDwelling(s, data, type, subid, mo.data);
      if (sub !== undefined) {
        type = 17;
        subid = sub;
        tmpl = findTemplate(data, type, subid) ?? t;
      }
    }
    if (type === Obj.RANDOM_TOWN) {
      type = Obj.TOWN;
      const faction = townOwner >= 0 ? s.players[townOwner].faction : undefined;
      subid = faction ? FACTIONS.indexOf(faction) : randInt(s, 0, 8);
      // Prefer the "with fort" look when there is one.
      tmpl = data.templates.filter((x) => x.id === Obj.TOWN && x.subid === subid).at(-1) ?? t;
    }
    if (type === Obj.TOWN && townOwner >= 0 && s.players[townOwner].controller === "none") townOwner = -1;

    // A resolved random object keeps its tile: if the new template's visitable tile sits
    // elsewhere relative to the anchor (HotA monsters stand one tile left), shift the anchor.
    let [dx, dy] = [0, 0];
    if (tmpl && tmpl !== t) {
      const a = visitOffset(t.visitMask);
      const b = visitOffset(tmpl.visitMask);
      if (a && b) [dx, dy] = [a[0] - b[0], a[1] - b[1]];
    }
    const obj: AdvObject = {
      id: s.objects.length,
      type,
      subid,
      x: mo.x + dx,
      y: mo.y + dy,
      z: mo.z,
      def: (tmpl ?? t).def,
      block: (tmpl ?? t).blockMask,
      visit: (tmpl ?? t).visitMask,
      flat: !!(tmpl ?? t).printPriority,
      owner: type === Obj.TOWN ? townOwner : owner,
      amount,
      name: typeof mo.data.name === "string" ? mo.data.name : undefined,
    };
    if (type === Obj.TOWN) obj.town = initialTown(s, obj, mo.data);
    // A monster's mood is set from the start (so Visions can tell what it will do).
    // (Rolled on a stream of its own, so the game's other rolls stay as they were.)
    if (type === Obj.MONSTER) obj.data = { aggression: rollAggression({ rng: (s.rng ^ Math.imul(obj.id + 1, 0x9e3779b1)) | 0 }, mo.data) };
    if (type === Obj.PRISON && typeof mo.data.hero === "number" && mo.data.hero >= 0) obj.data = { prisoner: mo.data.hero };
    // What a HotA map chose: the skills a University teaches from, the Black Market's first stock.
    const preset = mo.data.preset as HotaPreset | undefined;
    if (preset?.skills?.length) obj.data = { allowed: preset.skills };
    if (preset?.market) obj.data = { chosen: preset.market.map((m) => m.artifact) };
    // A creature bank's level, upgraded stack and artifacts; the Pyramid's spell.
    if (preset?.artifacts) obj.data = { chosenBank: { level: preset.content, upgraded: preset.upgraded ?? -1 }, artifacts: preset.artifacts };
    if (type === 63 && preset?.spell !== undefined) obj.data = { spell: preset.spell };
    // Map identifiers, for quests ("defeat this monster / hero").
    if (typeof mo.data.identifier === "number" && !(mo.id >= 216 && mo.id <= 218)) obj.ident = mo.data.identifier;
    if (linkedTo) linkedDwellings.push({ obj, mo, t, town: linkedTo });
    if (type === 103 && typeof mo.data.gate === "number") {
      const other = gateKeys.get(mo.data.gate);
      if (other) [obj.link, other.link] = [other.id, obj.id];
      else gateKeys.set(mo.data.gate, obj);
    }
    // HotA: a box or event only on some difficulties.
    const only = mo.data.difficulties;
    if (typeof only === "number" && (mo.id === Obj.PANDORAS_BOX || mo.id === Obj.EVENT) && !(only & (1 << (setup.difficulty ?? 1)))) obj.removed = true;
    s.objects.push(obj);
  });

  // Random dwellings tied to a town: that town's faction (HoMM3's "same as town"; VCMI's linkedTown).
  for (const { obj, mo, t, town } of linkedDwellings) {
    const linked = s.objects.find((o) => o.type === Obj.TOWN && o.ident === town);
    const sub = randomDwelling(s, data, mo.id, mo.subid, mo.data, linked ? linked.subid : undefined);
    if (sub === undefined) continue;
    const tmpl = findTemplate(data, 17, sub) ?? t;
    const a = visitOffset(t.visitMask);
    const b = visitOffset(tmpl.visitMask);
    const [dx, dy] = tmpl !== t && a && b ? [a[0] - b[0], a[1] - b[1]] : [0, 0];
    Object.assign(obj, { type: 17, subid: sub, x: mo.x + dx, y: mo.y + dy, def: tmpl.def, block: tmpl.blockMask, visit: tmpl.visitMask, flat: !!tmpl.printPriority });
  }

  nameTowns(s, data);

  const heroCase = parseRandomMapName(setup.mapFile)?.case;
  // Starting heroes at main towns.
  map.players.forEach((p, color) => {
    if (!p.mainTown?.generateHero || s.players[color].controller === "none") return;
    if (s.heroes.some((h) => h.owner === color)) return;
    // The map stores the town's entrance tile, which is where the hero starts.
    const mt = p.mainTown;
    const town = s.objects.find(
      (o) => o.type === Obj.TOWN && o.z === mt.z && maskTiles(o.visit, 1).some(({ dx, dy }) => o.x + dx === mt.x && o.y + dy === mt.y),
    );
    if (!town) return;
    const entrance = { dx: mt.x - town.x, dy: mt.y - town.y };
    const faction = FACTIONS[town.subid] ?? s.players[color].faction;
    // A campaign may let the player pick who starts.
    // A hero's playable case: the first player starts as that hero.
    const caseHero = color === 0 && heroCase?.kind === "hero" ? heroCase.id : undefined;
    const picked = caseHero ?? setup.choices?.[color]?.hero;
    const chosen = setup.campaign?.bonus?.type === "hero" && setup.campaign.bonus.player === color ? setup.campaign.bonus.hero : picked !== undefined && picked >= 0 && !takenHeroes.has(picked) ? picked : -1;
    const scene = parseSceneName(setup.mapFile) ?? parseOccasionName(setup.mapFile);
    const type = chosen >= 0 ? chosen : randomHeroOf(s, faction, new Set([...takenHeroes, ...pickedHeroes, ...(scene ? SCENE_LATER_HEROES : [])]), color);
    takenHeroes.add(type);
    const hero = makeHero(s, data, type, color, town.x + entrance.dx, town.y + entrance.dy, town.z, heroArmy(s, type));
    customizeHero(hero, data, map.heroCustom?.[type]);
    s.heroes.push(hero);
  });

  // A hero the map puts on a town's own tiles (the editor places it on the town) stands at its gate,
  // visiting (as VCMI's placeHeroesInTowns: Barbarian Breakout's Gurnisson and Yog).
  for (const h of s.heroes) {
    const town = s.objects.find((o) => o.town && !o.removed && o.z === h.z && maskTiles(o.block, 0).some(({ dx, dy }) => o.x + dx === h.x && o.y + dy === h.y));
    const gate = town && maskTiles(town.visit, 1)[0];
    if (gate) [h.x, h.y] = [town.x + gate.dx, town.y + gate.dy];
    // One on the water sails a boat of its own (Beware of Demons!, Dead Man's Tales).
    boatIfAtSea(s, data, map, h);
  }

  const world = new World(map, data, interactive);
  for (const h of s.heroes) startDay(world, s, h);
  // Day 1: each dwelling starts with one week of creatures.
  for (const o of s.objects) if (o.town) o.town.available = Array.from({ length: levelCount(o) }, (_, l) => weeklyGrowth(world, o, l));
  for (const p of s.players) if (p.alive) revealOwned(s, world, p.color);
  for (const p of s.players) if (p.alive) tavernOffer(s, p.color, data.classTavernOdds);
  for (const h of s.heroes) startingKit(h);
  for (const h of s.heroes) if (!fromCarried.has(h) && !h.removed && [...fromCarried].some((c) => c.type === h.type)) h.removed = true;
  for (const h of s.heroes) catchUpLevels(s, world, h);
  for (const h of s.heroes) h.mana = maxMana(h);
  // The campaign bonus the player picked, for the human player.
  const human = s.players.findIndex((p) => p.controller === "human");
  // Birth of a Barbarian's third scenario: Yog (a Wizard there) has the Angelic Alliance (the
  // original's hard-coded case, VCMI's yogWizard).
  if (camp?.file === "yog" && camp.scenario === 2) {
    const yog = s.heroes.find((h) => !h.removed && h.owner === human && h.type === YOG_WIZARD);
    if (yog && !(yog.equipped ?? []).includes(ANGELIC_ALLIANCE)) (initEquipment(yog), giveArtifact(yog, data.artifacts, ANGELIC_ALLIANCE));
  }
  for (const h of s.heroes) {
    const cls = campaignClassText(s, h);
    if (cls !== undefined) h.classText = cls;
  }
  // Artifacts the scenario keeps from heroes it doesn't bring: to the human's first hero.
  const receiver = s.heroes.find((h) => !h.removed && h.owner === human);
  for (const c of setup.campaign?.carried ?? []) if (receiver && !usedCarried.has(c.type)) for (const a of c.transfer ?? []) (initEquipment(receiver), giveArtifact(receiver, data.artifacts, a));
  if (setup.campaign?.bonus && human >= 0) applyCampaignBonus(s, world, human, setup.campaign.bonus);
  // Starting bonuses chosen in the advanced options, else a random one (VCMI's CGameState: 500-1000
  // gold, the town's resource, or a treasure artifact for the first hero). Campaigns have their own.
  s.players.forEach((p, color) => {
    if (!p.alive || p.controller === "none" || setup.campaign) return;
    const bonus = setup.choices?.[color]?.bonus ?? (["gold", "resource", "artifact"] as const)[randInt(s, 0, 2)];
    p.startBonus = bonus;
    if (bonus === "gold") p.resources[6] += randInt(s, 5, 10) * 100;
    else if (bonus === "resource") {
      const res = primaryResources(data, p.faction);
      if (res.length === 2) {
        const n = randInt(s, 5, 10);
        for (const r of res) p.resources[r] += n;
      } else p.resources[res[0]] += randInt(s, 3, 6);
    } else if (bonus === "artifact") {
      const h = s.heroes.find((x) => x.owner === color && !x.removed);
      const pool = randomArtifactPool(data.artifacts, "T", map.banned?.artifacts).map((id) => ({ id }));
      if (h && pool.length) {
        initEquipment(h);
        giveArtifact(h, data.artifacts, pool[randInt(s, 0, pool.length - 1)].id);
      }
    }
  });
  for (const o of s.objects) if (o.town) stockGuild(s, data.spells ?? [], o);
  s.grail = placeGrail(s, map, world);
  s.conditions = resolveConditions(map, s);
  // HotA's script variables carried from the campaign's scenarios before.
  if (setup.campaign?.vars) importVars(s, world, setup.campaign.vars);
  pairGates(s);
  s.current = s.players.findIndex((p) => p.alive);
  s.log.push(`Day 1. ${PLAYER_NAMES[s.current]} to move.`);
  world.refresh(s);
  // A random map begun weeks or months in (starts.ts).
  const random = parseRandomMapName(setup.mapFile);
  if (random?.start) applyStart(s, world, random.start);
  // A playable case (cases.ts): the town and hero set up to try it.
  if (random?.case) applyCase(s, world, random.case);
  // A minimal verifiable scene (scenes.ts): the hero one step from the thing.
  const scene = parseSceneName(setup.mapFile);
  if (scene) applyScene(s, world, scene);
  // A strategic benchmark case (strategyCases.ts): the armies and spells set up to try the AI's decision.
  if (parseStrategyName(setup.mapFile)) applyStrategy(s, world, setup.mapFile, data);
  // The same, with the occasion its thing is for staged (occasions.ts: Watch AI).
  const occasion = parseOccasionName(setup.mapFile);
  if (occasion) {
    applyScene(s, world, occasion);
    const h = s.heroes.find((x) => !x.removed && x.owner === 0);
    if (h) sceneOccasion(occasion)?.prep?.(s, world, h);
    world.refresh(s);
  }
  return { state: s, world };
}

/** Heroes no tavern or prison may offer: those on the map, in any player's tavern or waiting in a prison (one pool, as VCMI's). */
export function heroesInUse(s: AdventureState): Set<number> {
  const prisoners = s.objects.filter((o) => o.type === Obj.PRISON && !o.removed && typeof o.data?.prisoner === "number").map((o) => o.data!.prisoner as number);
  return new Set([...s.heroes.filter((h) => !h.removed).map((h) => h.type), ...s.players.flatMap((p) => p.tavern ?? []), ...prisoners]);
}

/**
 * A hero for one of a player's tavern slots (VCMI's HeroPoolProcessor::pickHeroFor): a class first,
 * by the classes' odds in the player's (starting) faction's taverns, the own faction's for the left
 * slot, none the tavern already shows; then one of its heroes. HotA keeps out heroes who fell in
 * battle having gained levels, unless nobody else is left.
 */
export function pickTavernHero(s: AdventureState, player: number, native: boolean, odds?: Record<string, number>[]): number | undefined {
  const p = s.players[player];
  const taken = heroesInUse(s);
  // (A HotA map that forbids rehiring keeps out every hero beaten in battle, whatever their level.)
  const fallen = new Set(s.heroes.filter((h) => h.removed && !h.retired && (s.noRehiring || h.level > 1)).map((h) => h.type));
  const free = Object.keys(HERO_INFO)
    .map(Number)
    .filter((id) => !HERO_INFO[id].special && !s.unhirable?.includes(id) && !taken.has(id) && heroFor(s, id, player));
  // (Fallen heroes come back only when no one else is left; never on a HotA map that says so.)
  const pool = s.noRehiring || free.some((id) => !fallen.has(id)) ? free.filter((id) => !fallen.has(id)) : free;
  const weight = (cls: number) => (p.faction && odds?.[cls] ? (odds[cls][p.faction] ?? 0) : 1);
  const classes = [...new Set(pool.map((id) => HERO_INFO[id].heroClass))].filter((c) => weight(c) > 0);
  if (!classes.length) return undefined;
  const shown = new Set((p.tavern ?? []).map((id) => HERO_INFO[id]?.heroClass));
  let possible = classes.filter((c) => (!native || HERO_CLASSES[c]?.faction === p.faction) && !shown.has(c));
  if (!possible.length) possible = classes;
  let roll = randInt(s, 0, possible.reduce((a, c) => a + weight(c), 0) - 1);
  const cls = possible.find((c) => (roll -= weight(c)) < 0) ?? possible[possible.length - 1];
  return pick(s, pool.filter((id) => HERO_INFO[id].heroClass === cls));
}

/**
 * The two heroes a player's taverns offer: rolled on the first day and each new week (with their
 * armies), in state transitions only, so clients just read it.
 */
export function tavernOffer(s: AdventureState, player: number, odds?: Record<string, number>[]): number[] {
  const p = s.players[player];
  if (!p.tavern) newTavernWeek(s, player, odds);
  return p.tavern!;
}

/** A new week: both slots new heroes with their armies (but a hero who came back on the week's last day, in another's turn, stays). */
export function newTavernWeek(s: AdventureState, player: number, odds?: Record<string, number>[]) {
  const p = s.players[player];
  const roles = p.tavernRoles ?? [];
  const kept = [0, 1].map((i) => (roles[i]?.keep ? (p.tavern?.[i] ?? -1) : -1));
  p.tavern = [...kept];
  p.tavernRoles = kept.map((id, i) => ({ role: id >= 0 ? roles[i].role : "full" }));
  for (const slot of [0, 1]) if (kept[slot] < 0) p.tavern[slot] = pickTavernHero(s, player, slot === 0, odds) ?? -1;
  trimTavern(p);
  const old = p.tavernArmies ?? {};
  p.tavernArmies = {};
  p.tavern.forEach((type, slot) => {
    if (kept[slot] >= 0 && old[type]) p.tavernArmies![type] = old[type];
    else if (kept[slot] < 0) p.tavernArmies![type] = offeredArmy(s, type);
  });
}

/** Empty slots (nobody left to offer) drop out, the right one first. */
function trimTavern(p: Player) {
  for (const slot of [1, 0])
    if ((p.tavern?.[slot] ?? -1) < 0) {
      p.tavern?.splice(slot, 1);
      p.tavernRoles?.splice(slot, 1);
    }
}

/** A hero hired from a slot: a new one takes its place at once, of any faction, with one creature. */
export function tavernHired(s: AdventureState, player: number, slot: number, odds?: Record<string, number>[]) {
  const p = s.players[player];
  tavernOffer(s, player, odds);
  p.tavernRoles ??= p.tavern!.map(() => ({ role: "full" }));
  const gone = p.tavern![slot];
  p.tavern![slot] = -1;
  p.tavern![slot] = pickTavernHero(s, player, false, odds) ?? -1;
  p.tavernRoles[slot] = { role: "single" };
  if (p.tavernArmies) delete p.tavernArmies[gone];
  const type = p.tavern![slot];
  if (type >= 0) (p.tavernArmies ??= {})[type] = oneOfFirst(offeredArmy(s, type));
  trimTavern(p);
}

/** A tavern hero's army, rolled on a side stream of the game's random numbers (the game's own goes on as it would without it). */
function offeredArmy(s: AdventureState, type: number): (ArmySlot | null)[] {
  return heroArmy({ rng: (s.rng ^ Math.imul(type + 1, 0x9e3779b1) ^ Math.imul(s.day + 7, 0x27d4eb2f)) | 0 }, type);
}

/** One creature of an army's first stack, the rest empty: a later hire's, or a returned hero's who kept no army. */
function oneOfFirst(army: (ArmySlot | null)[]): (ArmySlot | null)[] {
  const first = army.find((a) => a);
  return army.map((_, i) => (i === 0 && first ? { creature: first.creature, count: 1 } : null));
}

const SLOT_RANK: Record<TavernSlot["role"], number> = { single: 0, full: 1, retreated: 2, surrendered: 3 };

/**
 * A hero back from a battle (retreated or surrendered) waits in the player's tavern (VCMI's
 * selectSlotForRole): in an empty slot if there is one (HotA), else instead of the slot worth less
 * (a one-creature hire before a week's hero, either before a returned one), at random between equals.
 */
export function tavernReturn(s: AdventureState, player: number, type: number, role: "retreated" | "surrendered", attacked: boolean, odds?: Record<string, number>[]) {
  const p = s.players[player];
  tavernOffer(s, player, odds);
  const tavern = p.tavern!.filter((id) => id !== type);
  const roles = (p.tavernRoles ?? []).filter((_, i) => p.tavern![i] !== type);
  while (roles.length < tavern.length) roles.push({ role: "full" });
  let slot: number;
  if (tavern.length < 2) slot = tavern.length;
  else {
    const [l, r] = [SLOT_RANK[roles[0].role], SLOT_RANK[roles[1].role]];
    slot = l > r ? 1 : l < r ? 0 : randInt(s, 0, 1);
  }
  tavern[slot] = type;
  // Attacked on the week's last day (after the player's own turn) it outlasts the week's change.
  const keep = s.day % 7 === 0 && attacked;
  roles[slot] = keep ? { role, keep } : { role };
  p.tavern = tavern;
  p.tavernRoles = roles;
  // (A returned hero comes as they left: hireFromTavern; the hero it pushed out leaves with its army.)
  if (p.tavernArmies) for (const k of Object.keys(p.tavernArmies)) if (!tavern.includes(+k)) delete p.tavernArmies[+k];
}

/**
 * The army a tavern hero comes with, the same the tavern's preview shows: one who retreated, surrendered or was
 * dismissed as they left (one creature of their first stack if they kept no army), else the army rolled when
 * the hero took the slot (a week's hero its own, a later one a single creature of its first stack).
 */
export function tavernArmy(s: AdventureState, player: number, slot: number): (ArmySlot | null)[] {
  const type = s.players[player].tavern![slot];
  const back = s.heroes.find((x) => x.removed && x.retired && x.type === type);
  if (back) return back.army.every((a) => !a) ? oneOfFirst(heroArmy(s, type)) : back.army.map((a) => (a ? { ...a } : null));
  const kept = s.players[player].tavernArmies?.[type];
  // (The roll a hire used to make is still drawn, so the game's random numbers go on as before.)
  const rolled = heroArmy(s, type);
  if (kept) return kept.map((a) => (a ? { ...a } : null));
  // (A save from before the armies were kept: rolled now.)
  return s.players[player].tavernRoles?.[slot]?.role !== "single" ? rolled : oneOfFirst(rolled);
}

export const PLAYER_NAMES = ["Red", "Blue", "Tan", "Green", "Orange", "Purple", "Teal", "Pink"];

/** A hero's starting spellbook (classic heroes from VCMI, HotA heroes from the mod), or none. */
export function heroStartingSpells(type: number): number[] | undefined {
  if (HERO_SPELLS[type]) return [...HERO_SPELLS[type]];
  const keys = (HERO_INFO[type] as { spellbook?: string[] | null } | undefined)?.spellbook;
  if (!keys?.length) return undefined;
  return keys.map((k) => Number(Object.entries(SPELL_ART).find(([, a]) => a.key === k.split(":").pop())?.[0] ?? -1)).filter((id) => id >= 0);
}

/** A hero's starting secondary skills (HOTRAITS.TXT). */
export function startingSkills(type: number): [number, number][] {
  return (HERO_INFO[type]?.skills ?? []).map(([key, level]) => [skillId(key), level] as [number, number]).filter(([id]) => id >= 0);
}

/**
 * A new hero's kit: the spellbook (when it starts with spells), the catapult and the war machines of its starting army
 * (HOTRAITS: Christian's ballista, Rion's first aid tent), in the slots the map left empty. Every new hero gets it: at
 * the start, from a tavern and out of a prison
 * (a player and the owner, 2026-10-28/29: hired heroes came without them).
 */
export function startingKit(h: Hero) {
  initEquipment(h);
  for (const [creature] of HERO_INFO[h.type]?.army ?? []) {
    const art = Number(Object.entries(MACHINE_CREATURE).find(([, c]) => c === creature)?.[0] ?? -1);
    if (art >= 0 && h.equipped![MACHINE_SLOT[art]] < 0) h.equipped![MACHINE_SLOT[art]] = art;
  }
}

export function makeHero(s: AdventureState, data: GameData, type: number, owner: number, x: number, y: number, z: number, army: (ArmySlot | null)[], name?: string): Hero {
  const info = HERO_INFO[type];
  // New heroes come with a little experience already (heroes.thelazy.net/index.php/Experience); in HotA those
  // starting with Learning come with the level it grants due: 1000, resolved on the next experience gained (Learning).
  const little = randInt(s, 40, 90);
  const skills = startingSkills(type);
  return {
    id: s.heroes.length,
    type,
    name: name ?? data.heroNames[type] ?? info?.name ?? info?.key ?? `Hero ${type}`,
    owner,
    heroClass: info?.heroClass ?? 0,
    x,
    y,
    z,
    movement: 0,
    maxMovement: 0,
    army,
    primary: [...(data.classPrimary[info?.heroClass ?? 0] ?? [1, 1, 1, 1])] as Hero["primary"],
    experience: skills.some(([id]) => SKILLS[id] === "learning") ? 1000 : little,
    skills,
    spells: heroStartingSpells(type),
    level: 1,
    dir: 3,
  };
}

/** Builds GameData from the game's text tables (CRTRAITS, OBJECTS, HOTRAITS, HCTRAITS, BUILDING...). */
export function buildGameData(files: {
  crtraits: Uint8Array;
  objects: Uint8Array;
  hotraits: Uint8Array;
  hctraits: Uint8Array;
  artraits?: Uint8Array;
  building?: Uint8Array;
  bldgneut?: Uint8Array;
  bldgspec?: Uint8Array;
  dwelling?: Uint8Array;
  sptraits?: Uint8Array;
  townname?: Uint8Array;
  /** /res/rmgtemplates.txt (several RMG.TXT, parseRmgBundle), or the original's RMG.TXT alone. */
  rmg?: Uint8Array;
} & Partial<Record<GameLineFile, Uint8Array>>, opts: { extraTemplates?: boolean } = {}): GameData {
  // The lines the rules quote, from the same files (gameLines.ts).
  for (const f of GAME_LINE_FILES) setGameLines(f, files[f]);
  const creatures = parseCreatures(parseTxt(files.crtraits));
  const templates = [...parseObjectsTxt(decodeText(files.objects)), ...hotaMonsterTemplates()];
  // HotA's objects and others objects.txt lacks (from the shipped maps): generated maps can place them.
  if (opts.extraTemplates !== false) {
    const have = new Set(templates.map((t) => `${t.id}:${t.subid}`));
    templates.push(...EXTRA_TEMPLATES.filter((t) => !have.has(`${t.id}:${t.subid}`)));
  }
  // The original heroes' starting armies: how many of each, from the player's HOTRAITS.TXT.
  heroArmySizes(parseTxt(files.hotraits));
  const heroNames = parseTxt(files.hotraits)
    .slice(2)
    .filter((r) => r[0]?.trim())
    .map((r) => r[0]);
  // HotA's own heroes past the table: their own names (the tavern, scenario lists and quests showed none).
  for (const [id, info] of Object.entries(HERO_INFO)) heroNames[Number(id)] ??= info.name ?? info.key;
  const classPrimary = parseTxt(files.hctraits)
    .slice(2)
    .filter((r) => r[0]?.trim())
    .map((r) => [Number(r[2]), Number(r[3]), Number(r[4]), Number(r[5])] as [number, number, number, number]);
  const classLevelOdds = parseTxt(files.hctraits)
    .slice(2)
    .filter((r) => r[0]?.trim())
    .map((r) => ({ low: [6, 7, 8, 9].map((i) => Number(r[i])), high: [10, 11, 12, 13].map((i) => Number(r[i])) }));
  const townTexts =
    files.building && files.bldgneut && files.bldgspec && files.dwelling
      ? parseTownTexts({ building: files.building, bldgneut: files.bldgneut, bldgspec: files.bldgspec, dwelling: files.dwelling })
      : undefined;
  const artifacts = files.artraits
    ? parseTxt(files.artraits)
        .slice(2)
        .filter((r) => r[0]?.trim())
        // Slot columns run from Spell Book (2) to Head (20): slot = 20 - column.
        .map((r) => ({
          name: r[0],
          cost: Number(r[1]) || 0,
          tier: (r[21] ?? "").trim(),
          slots: Array.from({ length: 19 }, (_, sl) => sl).filter((sl) => (r[20 - sl] ?? "").trim().toLowerCase() === "x"),
          description: (r[22] ?? "").replace(/\{[^}]*\}\s*/g, "").trim(),
        }))
    : [];
  // HotA's own artifacts past the original table (its ARTRAITS stops at 143): names, slots, values, texts.
  if (artifacts.length) {
    // HotA's table marks the Pendant of Reflection as body armour; it is a pendant, worn (and assembled) at the neck.
    if (artifacts[142]?.slots.join() === "5") artifacts[142].slots = [2];
    for (const [id, a] of Object.entries(HOTA_ARTIFACTS)) artifacts[Number(id)] ??= { name: a.name, cost: a.cost, tier: a.tier, slots: a.slots, description: a.description };
    for (let id = 0; id < artifacts.length; id++) artifacts[id] ??= { name: "", cost: 0, tier: "", slots: [], description: "" };
    // The combinations' price (none in the table): their parts' together, as the HotA wiki gives them
    // (the Angelic Alliance 84000); the Altar of Sacrifice and the merchants pay by it.
    for (const [id, info] of Object.entries(ARTIFACT_INFO)) {
      const a = artifacts[Number(id)];
      if (!a || a.cost || !info.components) continue;
      a.cost = info.components.reduce((sum, key) => sum + (artifacts[Number(Object.keys(ARTIFACT_INFO).find((k) => ARTIFACT_INFO[Number(k)].key === key))]?.cost ?? 0), 0);
    }
    // HotA's own table keeps the placeholder for its two later combinations: their effects, from the HotA wiki.
    const PLACEHOLDER = "This is a kick-ass artifact.";
    if (artifacts[141]?.description === PLACEHOLDER) artifacts[141].description = "Allows retreat and surrender when battling neutral monsters or defending a town. Triples your army's strength in the eyes of neutral creatures and the Thieves' Guild. Counting component effects, reduces the cost of surrendering by 30%.";
    if (artifacts[142]?.description === PLACEHOLDER) artifacts[142].description = "Increases your chance to resist a hostile spell by 20%; counting component effects, by 50%.";
  }
  const classSkillOdds = parseTxt(files.hctraits)
    .slice(2)
    .filter((r) => r[0]?.trim())
    .map((r) => Array.from({ length: 30 }, (_, i) => Number(r[14 + i]) || 0));
  // The tavern odds sit after the skills, one column a faction, under the faction's name in the header.
  const hc = parseTxt(files.hctraits);
  const head = (hc[1] ?? []).map((c) => c.trim().toLowerCase().replace(/^necro$/, "necropolis"));
  const first = head.indexOf("castle");
  const classTavernOdds =
    first < 0
      ? undefined
      : hc
          .slice(2)
          .filter((r) => r[0]?.trim())
          .map((r) => Object.fromEntries(head.slice(first).flatMap((f, i) => (f ? [[f, Number(r[first + i]) || 0]] : []))));
  const spells = files.sptraits ? parseSpells(parseTxt(files.sptraits)) : [];
  const names = files.townname ? decodeText(files.townname).split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  const townNames = names.length ? Array.from({ length: Math.ceil(names.length / 16) }, (_, i) => names.slice(i * 16, i * 16 + 16)) : undefined;
  // (A bundle starts "@@@ <folder>"; the original's RMG.TXT alone doesn't.)
  const rmgTemplates = files.rmg ? (files.rmg[0] === 0x40 ? parseRmgBundle(files.rmg) : parseRmgTxt(files.rmg, "{Original}")) : undefined;
  return { creatures, templates, heroNames, classPrimary, classLevelOdds, classSkillOdds, ...(classTavernOdds ? { classTavernOdds } : {}), townTexts, artifacts, spells, townNames, ...(rmgTemplates?.length ? { rmgTemplates } : {}) };
}

/**
 * Wandering-monster templates for HotA creatures, from their sprite name and
 * footprint rows (top to bottom; B blocked, A blocked + visitable, T visitable).
 */
/** Saves from before the Grail existed get one when they're loaded. */
export function ensureGrail(s: AdventureState, map: H3Map, w: World) {
  s.grail ??= placeGrail(s, map, w);
}

/** The Grail: where the map's Grail object says (within its radius), else a random free land tile. */
function placeGrail(s: AdventureState, map: H3Map, w: World): { x: number; y: number; z: number } {
  const free = (x: number, y: number, z: number) => {
    const i = w.index(x, y, z);
    return i >= 0 && map.tiles[i].terrain !== 8 && map.tiles[i].terrain !== 9 && !w.blocked(i) && !w.visitBy[i];
  };
  w.refresh(s);
  const g = map.objects.find((o) => o.id === Obj.GRAIL);
  if (g) {
    const r = Number((g.data as { radius?: number }).radius ?? 0);
    const spots: { x: number; y: number; z: number }[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (free(g.x + dx, g.y + dy, g.z)) spots.push({ x: g.x + dx, y: g.y + dy, z: g.z });
    if (spots.length) return spots[randInt(s, 0, spots.length - 1)];
  }
  for (let tries = 0; tries < 5000; tries++) {
    const x = randInt(s, 2, map.size - 3);
    const y = randInt(s, 2, map.size - 3);
    if (free(x, y, 0)) return { x, y, z: 0 };
  }
  return { x: 0, y: 0, z: 0 };
}

/** Subterranean Gates connect to the nearest unpaired gate on the other level. */
function pairGates(s: AdventureState) {
  const gates = s.objects.filter((o) => o.type === 103);
  for (const g of gates) {
    if (g.link !== undefined) continue;
    let best: AdvObject | undefined;
    let bestD = Infinity;
    for (const o of gates) {
      if (o === g || o.link !== undefined || o.z === g.z) continue;
      const d = (o.x - g.x) ** 2 + (o.y - g.y) ** 2;
      if (d < bestD) [best, bestD] = [o, d];
    }
    if (best) [g.link, best.link] = [best.id, g.id];
  }
}

function hotaMonsterTemplates(): ObjectTemplate[] {
  return HOTA_CREATURES.filter((c) => c.mapDef).map((c) => {
    const block = [255, 255, 255, 255, 255, 255];
    const visit = [0, 0, 0, 0, 0, 0];
    const rows = c.mapMask.length ? c.mapMask : ["A"];
    const h = rows.length;
    rows.forEach((row, r) => {
      const w = row.length;
      [...row].forEach((ch, col) => {
        const i = r - (h - 1) + 5;
        const j = col - (w - 1) + 7;
        if (i < 0 || j < 0) return;
        if (ch === "B" || ch === "A") block[i] &= ~(1 << j);
        if (ch === "A" || ch === "T") visit[i] |= 1 << j;
      });
    });
    return { def: `${c.mapDef}.def`, blockMask: block, visitMask: visit, terrainMask: 0xff, id: 54, subid: c.id, type: 2, printPriority: 0 };
  });
}

/** Brings a saved game from an older version up to the current state shape. */
export function upgradeAdventureState(s: AdventureState): AdventureState {
  const legacy = s as AdventureState & { battle?: AdventureState["battles"][number] };
  s.battles ??= {};
  if (legacy.battle) {
    s.battles[s.heroes[legacy.battle.hero]?.owner ?? s.current] = legacy.battle;
    delete legacy.battle;
  }
  s.turnMode ??= "sequential";
  s.ended ??= Array(8).fill(false);
  s.contactDistance ??= 12;
  for (const p of s.players) p.revealed ??= [];
  for (const p of s.players) if (p.alive && !p.tavern) tavernOffer(s, p.color);
  // Saves from before the tavern kept its heroes' armies: rolled once now, so the preview and the hire agree.
  for (const p of s.players)
    p.tavern?.forEach((type, slot) => {
      if (type >= 0 && !p.tavernArmies?.[type] && !s.heroes.some((x) => x.removed && x.retired && x.type === type)) (p.tavernArmies ??= {})[type] = tavernArmy(s, p.color, slot);
    });
  for (const h of s.heroes) h.skills ??= startingSkills(h.type);
  // Saves from before the paper doll: start one (backpack items can be worn from the hero screen).
  for (const h of s.heroes) initEquipment(h);
  for (const h of s.heroes) if (h.mana === undefined) {
    if (h.spells === undefined && HERO_SPELLS[h.type]) h.spells = [...HERO_SPELLS[h.type]];
    h.mana = maxMana(h);
  }
  if (s.objects.some((o) => o.type === 103 && o.link === undefined)) pairGates(s);
  // Saves from before taverns and prisons shared one pool (VCMI's): a hero in two taverns, or in one
  // and on the map, leaves the later tavern and another takes the slot.
  if ((s.version ?? 0) < 1) dedupeTaverns(s);
  s.version = SAVE_VERSION;
  return s;
}

/** The save format's version: upgradeAdventureState brings anything older up to it. */
export const SAVE_VERSION = 1;

function dedupeTaverns(s: AdventureState) {
  const seen = new Set(s.heroes.filter((h) => !h.removed).map((h) => h.type));
  for (const p of s.players) {
    if (!p.tavern) continue;
    let changed = false;
    p.tavern.forEach((id, slot) => {
      if (seen.has(id)) {
        p.tavern![slot] = -1;
        p.tavern![slot] = pickTavernHero(s, p.color, slot === 0) ?? -1;
        changed = true;
      }
      seen.add(p.tavern![slot]);
    });
    if (changed) trimTavern(p);
  }
}

/**
 * Has the map changed under a save (a later build generates a random map differently, or reads a map
 * file's objects otherwise)? The objects a save keeps are the map's interactive ones, by index: a
 * description of the difference when they no longer match, else undefined.
 */
export function saveMapMismatch(s: AdventureState, map: H3Map): string | undefined {
  if (map.size !== s.size || map.levels !== s.levels) return `the map is ${map.size}x${map.size}x${map.levels} now, the save's ${s.size}x${s.size}x${s.levels}`;
  if (s.mapObjects !== undefined && s.mapObjects !== map.objects.length) return `the map has ${map.objects.length} objects now, ${s.mapObjects} when saved`;
  const now = map.objects.map((_, i) => i).filter((i) => isInteractive(map, i));
  const saved = new Set(s.replaced);
  const missing = now.filter((i) => !saved.has(i)).length;
  const extra = s.replaced.length - (now.length - missing);
  if (missing || extra) return `${missing} of the map's objects aren't in the save and ${extra} of the save's aren't on the map`;
  return undefined;
}

/**
 * Towns the map leaves unnamed get one of their type's names, each name used once; when a type
 * runs out, another type's (VCMI's CGameState::initTownNames).
 */
function nameTowns(s: AdventureState, data: GameData) {
  if (!data.townNames) return;
  const left = data.townNames.map((names) => [...names]);
  for (const o of s.objects) {
    if (!o.town || o.name) continue;
    let pool = left[o.subid];
    if (!pool?.length) {
      const others = left.filter((p) => p.length);
      if (!others.length) return;
      pool = others[randInt(s, 0, others.length - 1)];
    }
    o.name = pool.splice(randInt(s, 0, pool.length - 1), 1)[0];
  }
}

/** A hero put on the water (by the map, or freed from a sea prison) sits in a boat of its own. */
export function boatIfAtSea(s: AdventureState, data: GameData, map: H3Map, h: Hero) {
  const boat = data.templates.find((x) => x.id === Obj.BOAT);
  if (h.boat !== undefined || !boat || map.tiles[(h.z * map.size + h.y) * map.size + h.x]?.terrain !== 8) return;
  const v = maskTiles(boat.visitMask, 1)[0] ?? { dx: -1, dy: 0 };
  h.boat = s.objects.length;
  s.objects.push({ id: h.boat, type: Obj.BOAT, subid: boat.subid, def: boat.def, x: h.x - v.dx, y: h.y - v.dy, z: h.z, block: boat.blockMask, visit: boat.visitMask, flat: false, owner: -1, carriedBy: h.id });
}

/** A random dwelling's real one (an object 17 subid), or undefined when none fits: 216 any faction and level,
 *  217 a fixed level (subid), 218 a fixed faction (subid); `faction` (a linked town's) overrides the allowed set. */
function randomDwelling(s: AdventureState, data: GameData, type: number, subid: number, d: Record<string, unknown>, faction?: number): number | undefined {
  const mask = typeof d.factions === "number" && d.factions ? d.factions : 0x1ff;
  const allowed = faction !== undefined ? [faction] : type === 218 ? [subid] : FACTIONS.map((_, i) => i).filter((i) => mask & (1 << i));
  const lo = type === 217 ? subid + 1 : (Number(d.minLevel) || 0) + 1;
  const hi = type === 217 ? subid + 1 : Math.max(lo, (Number(d.maxLevel) || 6) + 1);
  const options: number[] = [];
  for (const f of allowed.length ? allowed : [0]) {
    for (let l = lo; l <= Math.min(hi, 7); l++) {
      const creature = TOWNS[f]?.creatures[l - 1]?.[0];
      const dw = Object.entries(DWELLINGS).find(([sub, cs]) => cs[0] === creature && findTemplate(data, 17, Number(sub)));
      if (dw) options.push(Number(dw[0]));
    }
  }
  return options.length ? pick(s, options) : undefined;
}
