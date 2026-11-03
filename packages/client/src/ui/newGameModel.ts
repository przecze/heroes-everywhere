// New Game's setup as plain data and its rules: the scenario list's order, each colour's picks (who plays it, town,
// hero, bonus, handicap, the computer's personality), the turn timer, the random map's options and template, and what
// the screen hands back to start the game. The computer's window (scenarioSelect.ts) and the touch screens' page
// (mobileNewGame.ts) are two drawings of it and keep no rules of their own.
// (Until 2026-11-03 each screen kept its own copy of this state and these rules and the copies drifted: the desktop
// got the computer's personality a day late, its Show Random Maps dropped an advanced start from the list, the two
// lists put the guided first game in different places. docs/state/menus-setup.md.) No pictures and no words here:
// packages/client/test/newGameModel.test.ts.
import { FACTIONS, HERO_CLASSES, HERO_INFO, type Personality, type RandomMapOptions, type RuleOverrides, maxRandomMapPlayers, parseRandomMapName, randomMapName, rmgIndex, rmgKey, type RmgTemplate, rmgTemplatesFor, rulesLetters } from "@heroes/core";
import type { Text } from "../i18n/index.ts";
import type { GameSummary } from "../gameSummary.ts";
import type { TimelineGame } from "../timeline/model.ts";
import { hotaContentMissing } from "../hotaContent.ts";

// ---- the scenarios ----------------------------------------------------------------------------

export interface MapInfo {
  file: string;
  name: string;
  description: string;
  size: number;
  levels: number;
  version: number;
  hota: number;
  difficulty: number;
  victory: number;
  loss: number;
  players: { human: boolean; computer: boolean; team?: number; factions?: number; randomFaction?: boolean; town?: boolean; chooseHero?: boolean }[];
  /** Load / save lists: the saved game's name, shown in the list instead of the map's. */
  title?: Text;
  /** "Your games": the game at a glance (colour, town, hero, events), the line under its map name, and whether it waits for you. */
  game?: GameSummary;
  sub?: Text;
  turn?: boolean;
  /** "Your games" as timelines: the game's entry, and whether it goes on past its last point (being played here). */
  timeline?: { game: TimelineGame; now?: boolean };
}

export const SIZES: Record<number, [string, number]> = { 36: ["S", 0], 72: ["M", 1], 108: ["L", 2], 144: ["XL", 3], 180: ["H", 4], 216: ["XH", 5], 252: ["G", 6] };
/** SCSELC frames: RoE, AB, SoD (and Chronicles), WoG, HotA (its horn, frame 5: the mod's, assets.ts EXTENDED_DEFS). */
export const FORMAT_ICON: Record<number, number> = { 14: 0, 21: 1, 28: 2, 29: 2, 51: 3, 32: 5 };
/** The size filters' sizes, as their buttons (S, M, L, XL, All = 0). */
export const SIZE_FILTERS = [36, 72, 108, 144, 0];

/** Rows kept above the maps whatever the sort: the advanced starts (begun weeks in) and a newcomer's guided first game (":g"). */
export const keptOnTop = (file: string) => /^random:.*(:s-|:g$)/.test(file);
/** A map's place before any sort: a newcomer's guided first game, then the advanced starts, then the maps. */
const rank = (m: MapInfo) => (!keptOnTop(m.file) ? 2 : m.file.endsWith(":g") ? 0 : 1);

/** The scenario list's columns, as the original's header buttons. */
export type SortKey = "players" | "size" | "format" | "name" | "victory" | "loss";
const SORT: Record<SortKey, (m: MapInfo) => number | string> = {
  players: (m) => m.players.filter((p) => p.human).length,
  size: (m) => m.size,
  format: (m) => m.version,
  name: (m) => (m.title ?? m.name).toLowerCase(),
  victory: (m) => m.victory,
  loss: (m) => m.loss,
};
export interface ListOrder {
  /** A map size (SIZES' keys), 0 all. */
  sizeFilter: number;
  sortBy: SortKey;
  /** The other way round (a second tap on the column's header). */
  down?: boolean;
}

/** The list as shown: the size filter, then the guided game and the advanced starts on top (as given), then the sort. */
export function sortedMaps(maps: readonly MapInfo[], o: ListOrder, keep: (m: MapInfo) => boolean = () => true): MapInfo[] {
  const key = SORT[o.sortBy];
  return maps
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => (!o.sizeFilter || m.size === o.sizeFilter) && keep(m))
    .sort((a, b) => {
      const ra = rank(a.m);
      const rb = rank(b.m);
      if (ra !== rb || ra < 2) return ra - rb || a.i - b.i;
      const x = key(a.m);
      const y = key(b.m);
      // (Same key: by name, saved games by their own names, as the original's load list by file name.)
      const c = x < y ? -1 : x > y ? 1 : (a.m.title ?? a.m.name).localeCompare(b.m.title ?? b.m.name);
      return o.down ? -c : c;
    })
    .map(({ m }) => m);
}

/** The map chosen as the list opens: the one asked for (played last), else the first ordinary map, so a newcomer's Begin starts on day 1. */
export function firstChoice(sorted: readonly MapInfo[], current?: string): number {
  const kept = sorted.findIndex((m) => m.file === current);
  return kept >= 0 ? kept : Math.max(0, sorted.findIndex((m) => rank(m) === 2));
}

// ---- each colour's picks ------------------------------------------------------------------------

export const FLAG_LETTERS = ["r", "b", "y", "g", "o", "p", "t", "s"];
// i18n-keys
export const BONUS_NAMES = { random: "Random", gold: "Gold", resource: "Resource", artifact: "Artifact" };
export type Bonus = keyof typeof BONUS_NAMES;
export const BONUS_ORDER: Bonus[] = ["random", "artifact", "gold", "resource"];
/** SCNRSTAR frames for a faction's own resource: wood and ore 0, crystal 1, gems 2, mercury 3, sulfur 5. */
const RESOURCE_FRAME: Record<number, number> = { 4: 1, 5: 2, 1: 3, 3: 5 };
/** A faction's own resource for the bonus icon (silos / level 7 creatures). */
export const resourceOf = (faction?: string) => ({ rampart: 4, tower: 5, inferno: 1, dungeon: 3, conflux: 1 })[faction ?? ""] ?? 0;
/** The SCNRSTAR frame showing a starting bonus (a faction's resource one in its resource). */
export const bonusFrame = (b: Bonus, faction?: string) => (b === "random" ? 10 : b === "gold" ? 8 : b === "artifact" ? 9 : (RESOURCE_FRAME[resourceOf(faction)] ?? 0));
/** The original's handicaps (ARRAYTXT 210-212). */
// i18n-keys
export const HANDICAPS = ["No Handicap", "Mild Handicap", "Severe Handicap"];
/** A computer player's personality as the Advanced Options step through it (the aiPersonality extra): the map's own first. */
export const PERSONALITY_STEPS: (Personality | "random" | undefined)[] = [undefined, "warrior", "builder", "explorer", "random", "fresh"];
/** A random map's computer players: the standard AI, one personality for all, or mixed. */
export const RANDOM_AI_STEPS: (Personality | "mixed" | undefined)[] = [undefined, "warrior", "builder", "explorer", "mixed", "fresh"];
/** Player Turn Duration's steps, minutes, 0 unlimited (VCMI's POSSIBLE_TURNTIME, the slider's order). */
export const TURN_MINUTES = [1, 2, 4, 6, 8, 10, 15, 20, 25, 30, 0];
export const DIFFICULTIES = ["Easy", "Normal", "Hard", "Expert", "Impossible"];
export const RATINGS = [80, 100, 130, 160, 200];
/** The difficulty a new game starts on: Hard, 130% (the original's is Normal; The owner 2026-11-03: "make 130% the default"). */
export const DEFAULT_DIFFICULTY = 2;

export interface PlayerPick {
  faction?: string;
  /** -1: random. */
  hero: number;
  bonus: Bonus;
  /** 1 Mild, 2 Severe. */
  handicap?: number;
  /** A computer player's personality (the aiPersonality extra); none: the map's AI tactic. */
  personality?: Personality | "random";
}

/** Advanced options for a scenario: who's human (hot seat), and each colour's town, hero and bonus. */
export interface ScenarioOptions {
  file: string;
  human: number;
  humans: number[];
  picks: PlayerPick[];
  /** Player Turn Duration, minutes (none: unlimited). */
  turnMinutes?: number;
  /** Without HotA's content (random maps: in the map's name). */
  noHota?: boolean;
  /** HotA's rule changes turned off. */
  rules?: RuleOverrides;
}

/** The game's own choices, for Scenario Information: who plays which colour, and each one's town, hero and bonus. */
export interface InfoPicks {
  human: number;
  picks: { faction?: string; hero: number; bonus: Bonus; handicap?: number }[];
  turnMinutes?: number;
}

/** A scenario's advanced options as they start: one human (a random map made for several: all of them). */
export function defaultOptions(m: MapInfo): ScenarioOptions {
  const human = Math.max(0, m.players.findIndex((p) => p.human));
  const all = m.players.flatMap((p, i) => (p.human ? [i] : []));
  // (A random map made with game rules carries them in its name: they start as it has them.)
  const made = parseRandomMapName(m.file);
  return {
    file: m.file,
    human,
    humans: m.file.startsWith("random:") && all.length ? all : [human],
    // (A colour whose town the map fixes shows it, not Random, the owner 2026-10-27: its heroes to pick from then too.)
    picks: m.players.map((p) => ({ hero: -1, bonus: "random" as Bonus, ...(m.file.startsWith("random:") ? {} : fixedTown(p)) })),
    ...(made?.noHota || hotaContentMissing() ? { noHota: true } : {}),
    ...(made?.rules ? { rules: made.rules } : {}),
  };
}

/** The one town a colour's map fixes for it (not drawn at random, one town allowed), as the original shows it. */
function fixedTown(p: MapInfo["players"][number]): { faction?: string } {
  const towns = FACTIONS.filter((_, i) => (p.factions ?? 0) & (1 << i));
  return !p.randomFaction && towns.length === 1 ? { faction: towns[0] } : {};
}

/**
 * The options being set, one scenario's at a time: asked for another scenario, they start over (defaultOptions);
 * `touched` says whether they were opened at all (untouched, the game starts as the map says).
 */
export class SetupOptions {
  private o: ScenarioOptions | null = null;
  constructor(given?: ScenarioOptions) {
    this.o = given ?? null;
  }
  /** The options for this scenario, made fresh when it's another one. */
  for(m: MapInfo): ScenarioOptions {
    if (this.o?.file !== m.file) this.o = defaultOptions(m);
    return this.o;
  }
  /** The options as set for this scenario, or null when they were never opened for it. */
  touched(m: MapInfo | undefined): ScenarioOptions | null {
    return m && this.o?.file === m.file ? this.o : null;
  }
  /** What to show without opening them (the card's content check and rules scroll). */
  peek(m: MapInfo): ScenarioOptions {
    return this.touched(m) ?? defaultOptions(m);
  }
}

const cycle = <T,>(items: readonly T[], now: T, dir: number): T => items[(items.indexOf(now) + dir + items.length) % items.length];

/** Why a colour can't be turned human or computer: only the computer may play it, or it's the last human. */
export type HumanRefusal = "computerOnly" | "lastHuman";
/** Turns a colour human or computer (hot seat: several humans take turns at one screen); one colour stays human. */
export function toggleHuman(m: MapInfo, o: ScenarioOptions, color: number): HumanRefusal | null {
  if (!m.players[color]?.human) return "computerOnly";
  const humans = o.humans.includes(color) ? o.humans.filter((c) => c !== color) : [...o.humans, color].sort((a, b) => a - b);
  if (!humans.length) return "lastHuman";
  o.humans = humans;
  o.human = humans[0];
  return null;
}

/** Another town (undefined: random): the hero goes back to random, as a town's heroes are its own. */
export function setTown(pick: PlayerPick, faction: string | undefined): boolean {
  if (faction === pick.faction) return false;
  pick.faction = faction;
  pick.hero = -1;
  return true;
}
/** The town's arrows: through `allowed` and Random. */
export const stepTown = (pick: PlayerPick, allowed: readonly string[], dir: number) => setTown(pick, cycle([undefined, ...allowed], pick.faction, dir));
/** The hero's arrows: through `heroes` (the town's that can be picked) and Random. */
export const stepHero = (pick: PlayerPick, heroes: readonly number[], dir: number) => void (pick.hero = cycle([-1, ...heroes], pick.hero, dir));
export const stepBonus = (pick: PlayerPick, dir: number) => void (pick.bonus = cycle(BONUS_ORDER, pick.bonus, dir));
/** No, Mild, Severe, round again. */
export const stepHandicap = (pick: PlayerPick) => void (pick.handicap = ((pick.handicap ?? 0) + 1) % HANDICAPS.length || undefined);
export const stepPersonality = (pick: PlayerPick, dir: number) => void (pick.personality = cycle(PERSONALITY_STEPS, pick.personality, dir));

/** The turn timer's step (TURN_MINUTES' index). */
export const turnStep = (o: ScenarioOptions) => Math.max(0, TURN_MINUTES.indexOf(o.turnMinutes ?? 0));
/** A step of the turn timer, kept to the slider's ends. */
export const setTurnStep = (o: ScenarioOptions, i: number) => void (o.turnMinutes = TURN_MINUTES[Math.max(0, Math.min(TURN_MINUTES.length - 1, i))] || undefined);
/** The arrows round: past Unlimited back to one minute. */
export const stepTurn = (o: ScenarioOptions, dir: number) => setTurnStep(o, (turnStep(o) + dir + TURN_MINUTES.length) % TURN_MINUTES.length);

/** The heroes a town's colour may start with (its classes' heroes; HotA's own included). */
export const heroesOf = (faction?: string) =>
  Object.keys(HERO_INFO)
    .map(Number)
    .filter((id) => (id < 144 || id >= 156) && HERO_CLASSES[HERO_INFO[id].heroClass]?.faction === faction);

/** A map made with HotA's content in it (a HotA-format map): it can't be played without that. */
export const placesHota = (m: MapInfo) => !m.file.startsWith("random:") && m.hota > 0;
/** Why the HotA content check is locked, if it is: a server without HotA's files says so first. */
export const hotaLock = (m: MapInfo): "map" | "missing" | false => (hotaContentMissing() ? "missing" : placesHota(m) ? "map" : false);

// ---- what the screen hands back ----------------------------------------------------------------

export interface ScenarioChoice {
  file: string;
  difficulty: number;
  controllers?: ("human" | "ai" | "none")[];
  choices?: ({ faction?: string; hero?: number; bonus?: "gold" | "resource" | "artifact"; /** 1 Mild, 2 Severe. */ handicap?: number; personality?: Personality | "random" } | undefined)[];
  /** Player Turn Duration, minutes (none: unlimited). */
  turnMinutes?: number;
  /** Without HotA's content / HotA's rules turned off (the gameRules extra). */
  noHota?: boolean;
  rules?: RuleOverrides;
  /** Save mode: the name typed in the strip. */
  name?: string;
  /** A game's timeline: the point picked to play from (timelineStrip's NOW: where it was left). */
  point?: string;
}

/** A random map's file name with the game rules and the first colour's town chosen in its options (the map is made from its name). */
function withRandomChoices(file: string, o: ScenarioOptions): string {
  const parsed = parseRandomMapName(file);
  const town = o.picks[0]?.faction && /^random:/.test(file) && !/:(s|c|f)-/.test(file) ? FACTIONS.indexOf(o.picks[0].faction) : -1;
  if (!parsed || (!!parsed.noHota === !!o.noHota && rulesLetters(parsed.rules) === rulesLetters(o.rules) && town < 0)) return file;
  return randomMapName({ ...parsed, noHota: o.noHota || undefined, rules: o.rules, ...(town >= 0 ? { faction: town } : {}) });
}

/** What a New Game screen hands back: the scenario, difficulty and (when touched) the advanced options. */
export function scenarioChoice(m: MapInfo, difficulty: number, o: ScenarioOptions | null, name = ""): ScenarioChoice {
  return {
    name,
    file: o ? withRandomChoices(m.file, o) : m.file,
    difficulty,
    controllers: o ? m.players.map((p, i) => (!p.human && !p.computer ? "none" : o.humans.includes(i) ? "human" : "ai")) : undefined,
    // A random bonus is one of the three, as in the original.
    choices: o ? o.picks.map((p, i) => ({ faction: p.faction, hero: p.hero >= 0 ? p.hero : undefined, bonus: p.bonus === "random" ? undefined : p.bonus, ...(p.handicap ? { handicap: p.handicap } : {}), ...(p.personality && !o.humans.includes(i) ? { personality: p.personality } : {}) })) : undefined,
    ...(o?.turnMinutes ? { turnMinutes: o.turnMinutes } : {}),
    ...(o?.noHota ? { noHota: true } : {}),
    ...(o?.rules && Object.keys(o.rules).length ? { rules: o.rules } : {}),
  };
}

// ---- the random map ---------------------------------------------------------------------------

/** The original's Random Map panel's choices (and the additions: personality, roads, template), and their limits. */
export class RandomMapSetup {
  readonly o: Omit<RandomMapOptions, "seed"> = { size: 72, players: 4, humans: 1, monsters: 1 };
  /** The rows left to Random (the classic panel's Random buttons): drawn when the map is made. */
  readonly pick = { humans: false, teams: false, computers: false, compTeams: false, water: false, monsters: false };
  /** The template asked for (a key of rmgIndex); none: one that fits at random, as the original picks. */
  templateKey: string | undefined;

  get max() {
    return maxRandomMapPlayers(this.o.size);
  }
  get computers() {
    return this.o.players - this.o.humans;
  }
  /** Players within the map's size, humans within the players, each row's teams fewer than its players. */
  private fit() {
    const o = this.o;
    o.players = Math.max(2, Math.min(o.players, this.max));
    o.humans = Math.max(1, Math.min(o.humans, o.players));
    o.teams = Math.min(o.teams ?? 0, Math.max(0, o.humans - 1)) || undefined;
    o.compTeams = Math.min(o.compTeams ?? 0, Math.max(0, this.computers - 1)) || undefined;
  }
  setSize(n: number) {
    this.o.size = n;
    this.fit();
  }
  setUnderground(on: boolean) {
    this.o.underground = on || undefined;
  }
  /** All the players (the phone's row): humans stay within them. */
  setPlayers(n: number) {
    this.o.players = n;
    this.fit();
  }
  /** The players who may be human (the phone's row): within the players. */
  setHumans(n: number) {
    this.pick.humans = false;
    this.o.humans = n;
    this.fit();
  }
  /** The players who may be human, the computer-only players kept (the classic panel's first row). */
  setHumansKeepingComputers(n: number) {
    const computers = this.computers;
    this.pick.humans = false;
    this.o.players = Math.max(2, Math.min(this.max, n + computers));
    this.o.humans = Math.min(n, this.o.players);
    this.fit();
  }
  /** The computer-only players (the classic panel's third row). */
  setComputers(n: number) {
    this.pick.computers = false;
    this.o.players = this.o.humans + n;
    this.fit();
  }
  /** Can the classic panel's rows take this many: humans, computers (a map holds `max`, two at least)? */
  canHumans = (n: number) => n <= this.max;
  canComputers = (n: number) => this.o.humans + n <= this.max && this.o.humans + n >= 2;
  /** Teams: none, or fewer than the row's players. */
  canTeams = (n: number, players: number) => n === 0 || n < players;
  setTeams(n: number) {
    this.pick.teams = false;
    this.o.teams = n || undefined;
    this.fit();
  }
  setCompTeams(n: number) {
    this.pick.compTeams = false;
    this.o.compTeams = n || undefined;
    this.fit();
  }
  /** 0 none, 1 normal, 2 islands. */
  get water(): number {
    return this.o.islands ? 2 : this.o.water ? 1 : 0;
  }
  setWater(i: number) {
    this.pick.water = false;
    this.o.water = i === 1;
    this.o.islands = i === 2;
  }
  setMonsters(i: number) {
    this.pick.monsters = false;
    this.o.monsters = i;
  }
  stepAi(dir: number) {
    this.o.ai = cycle(RANDOM_AI_STEPS, this.o.ai, dir);
  }
  /** The kinds of road (bits: dirt, gravel, cobblestone; all by default). */
  get roads() {
    return this.o.roads ?? 7;
  }
  toggleRoad(k: number) {
    this.o.roads = this.roads ^ (1 << k);
  }

  /** The templates that can make the map as set now. */
  fitting(templates: readonly RmgTemplate[]): RmgTemplate[] {
    return rmgTemplatesFor(templates as RmgTemplate[], this.o.size, this.o.underground ? 2 : 1, this.o.humans, this.o.players);
  }
  /** The template asked for, if it still fits (none: Random). */
  template(templates: readonly RmgTemplate[]): RmgTemplate | undefined {
    const t = this.templateKey ? rmgIndex(templates as RmgTemplate[]).get(this.templateKey) : undefined;
    return t && this.fitting(templates).includes(t) ? t : undefined;
  }
  /** Random, then each template that fits, by key. */
  templateKeys(templates: readonly RmgTemplate[]): (string | undefined)[] {
    return [undefined, ...this.fitting(templates).map((t) => rmgKey(templates as RmgTemplate[], t))];
  }
  stepTemplate(templates: readonly RmgTemplate[], dir: number) {
    const keys = this.templateKeys(templates);
    this.templateKey = cycle(keys, keys.includes(this.templateKey) ? this.templateKey : undefined, dir);
  }

  /** The map's options to make it with: the rows left to Random drawn now (`roll(n)`: 0 .. n-1), a new seed. */
  options(roads: boolean, roll: (n: number) => number = (n) => Math.floor(Math.random() * n)): RandomMapOptions {
    const { o, pick, max } = this;
    const humans = pick.humans ? 1 + roll(Math.min(max, 8) - (pick.computers ? 1 : Math.max(0, this.computers))) : o.humans;
    const computers = pick.computers ? Math.max(humans < 2 ? 1 : 0, roll(max - humans + 1)) : Math.max(humans < 2 ? 1 : 0, Math.min(max - humans, this.computers));
    const players = Math.max(2, Math.min(max, humans + computers));
    const h = Math.min(humans, players);
    const comps = players - h;
    const water = pick.water ? roll(3) : this.water;
    const teams = pick.teams ? roll(Math.max(1, h)) : Math.min(o.teams ?? 0, Math.max(0, h - 1));
    const compTeams = pick.compTeams ? roll(Math.max(1, comps)) : Math.min(o.compTeams ?? 0, Math.max(0, comps - 1));
    return {
      ...o,
      roads: roads ? o.roads : undefined,
      humans: h,
      players,
      monsters: pick.monsters ? roll(3) : o.monsters,
      water: water === 1,
      islands: water === 2,
      allied: undefined,
      teams: teams || undefined,
      compTeams: compTeams || undefined,
      seed: roll(2 ** 31),
    };
  }
}

/** A random map just made, at the top of the list: one at a time (it replaces the last made), the advanced starts and the guided game kept. */
export function putRandomMap(maps: MapInfo[], info: MapInfo) {
  const old = maps.findIndex((x) => x.file.startsWith("random:") && !keptOnTop(x.file));
  if (old >= 0) maps.splice(old, 1);
  maps.unshift(info);
}
