// Eight computer players on one map, day by day until one wins: each player's towns and the milestones they reach
// (Capitol, an upgraded 7th-level dwelling, a hero at level 10 and 20, the first town taken, out of the game), as JSON
// for the README's race chart.
//   npm run sim:race -- --map "Free for All.h3m" --days 400 --seed 1 > race.json
// RACE_FROM=<state> goes on from a saved game (RACE_STATE writes one).
// RACE_DIARY=1 prints each player's last AI diary pages (a game that never ends: what holds the heroes back).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { PLAYER_NAMES, type AdventureState, type World, army, beginAdventure, buildGameData, generateRandomMap, nextAiPlayer, parseRandomMapName, playAiTurn, power, GAME_LINE_FILES } from "@heroes/core";
import { parseH3m } from "@heroes/formats";
import { ResourceStore } from "@heroes/formats/node";

export type GameData = ReturnType<typeof buildGameData>;

export function loadData(): GameData {
  const store = new ResourceStore((process.env.HEROES_DATA_DIRS ?? "").split(":").filter(Boolean), (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  return buildGameData({ ...Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])), rmg: store.get("rmgtemplates.txt") } as never);
}

export interface Race {
  map: string;
  file: string;
  size: number;
  seed: number;
  days: number;
  winner?: number;
  players: { color: number; name: string; faction?: string; engine?: string }[];
  /** Towns held at the end of each day, by colour. */
  towns: Record<number, number[]>;
  /** Strength at the end of each week (heroes' armies and garrisons, the AI's own power measure), by colour. */
  strength: Record<number, number[]>;
  /** The most experienced hero's experience at the end of each week, by colour. */
  experience: Record<number, number[]>;
  milestones: { day: number; player: number; what: string }[];
}

const CAPITOL = 13;
const DWELLING_7_UP = 43;

/** Plays every seat by the AI until a winner or `days`; `diary` gets each player's last pages at the end. */
export function playRace(data: GameData, file: string, seed: number, days: number, end?: (s: AdventureState, w: World) => void, onDay?: (s: AdventureState, w: World) => void): Race {
  const random = parseRandomMapName(file);
  let raw: Buffer | undefined;
  for (const d of random ? [] : (process.env.HEROES_MAP_DIRS ?? "").split(":").filter(Boolean))
    try {
      raw = readFileSync(join(d, file));
      break;
    } catch {
      // the next folder
    }
  if (!random && !raw) throw new Error(`map ${file} not found in HEROES_MAP_DIRS`);
  const map = random ? generateRandomMap(data, random) : parseH3m(gunzipSync(raw!));
  let { state: s, world: w } = beginAdventure(map, data, { seed, mapFile: file, difficulty: 1, controllers: map.players.map((p) => (p.canHuman || p.canComputer ? "ai" : "none")) });
  // RACE_FROM=<file>: go on from a game RACE_STATE saved (the same map), to try a change on its endgame.
  if (process.env.RACE_FROM) {
    s = JSON.parse(readFileSync(process.env.RACE_FROM, "utf8"));
    w.refresh(s);
  }
  // AI_FAIR=0: the original's all-seeing computer (rule aiFair off).
  if (process.env.AI_FAIR === "0") s.rules = { ...s.rules, aiFair: false };
  const players = s.players.filter((p) => p.controller === "ai");
  // RACE_ENGINES=base,search: the seats take the engines in turn (shifted by the seed, so each engine gets each seat).
  const engines = (process.env.RACE_ENGINES ?? "").split(",").filter(Boolean) as NonNullable<AdventureState["players"][number]["aiEngine"]>[];
  if (engines.length) players.forEach((p, k) => (p.aiEngine = engines[(k + seed) % engines.length]));
  const towns: Record<number, number[]> = Object.fromEntries(players.map((p) => [p.color, []]));
  const strength: Record<number, number[]> = Object.fromEntries(players.map((p) => [p.color, []]));
  const experience: Record<number, number[]> = Object.fromEntries(players.map((p) => [p.color, []]));
  const milestones: Race["milestones"] = [];
  const reached = new Set<string>();
  const mark = (player: number, what: string) => {
    if (reached.has(`${player}:${what}`)) return;
    reached.add(`${player}:${what}`);
    milestones.push({ day: s.day, player, what });
  };
  // Who held each town yesterday: a town that changes hands between players is a rival's town taken.
  const heldBy = new Map(s.objects.filter((o) => o.town).map((o) => [o.id, o.owner]));
  const startTowns = new Map(players.map((p) => [p.color, new Set(s.objects.filter((o) => o.town && o.owner === p.color).map((o) => o.id))]));
  const record = () => {
    for (const o of s.objects) {
      if (!o.town) continue;
      const was = heldBy.get(o.id) ?? -1;
      if (was >= 0 && o.owner >= 0 && o.owner !== was && !o.removed) mark(o.owner, "Rival town taken");
      heldBy.set(o.id, o.removed ? -1 : o.owner);
    }
    for (const p of players) {
      const own = s.objects.filter((o) => o.town && o.owner === p.color && !o.removed);
      towns[p.color][s.day - 1] = own.length;
      if (s.day % 7 === 0) strength[p.color][s.day / 7 - 1] = Math.round(s.heroes.filter((h) => h.owner === p.color && !h.removed).reduce((a, h) => a + power(w, h), 0) + own.reduce((a, o) => a + army(w, o.town!.garrison), 0));
      if (s.day % 7 === 0) experience[p.color][s.day / 7 - 1] = Math.max(0, ...s.heroes.filter((h) => h.owner === p.color && !h.removed).map((h) => h.experience));
      if (own.some((o) => o.town!.built.includes(CAPITOL))) mark(p.color, "Capitol");
      if (own.some((o) => o.town!.built.includes(DWELLING_7_UP))) mark(p.color, "Upgraded 7th-level dwelling");
      const level = Math.max(0, ...s.heroes.filter((h) => h.owner === p.color && !h.removed).map((h) => h.level));
      if (level >= 10) mark(p.color, "Hero level 10");
      if (level >= 20) mark(p.color, "Hero level 20");
      if (own.some((o) => !startTowns.get(p.color)!.has(o.id))) mark(p.color, "First town taken");
      if (!p.alive) mark(p.color, "Out of the game");
    }
  };
  let day = s.day;
  let actions = 0;
  while (s.day <= days && s.winner === undefined) {
    const player = nextAiPlayer(s);
    if (player < 0) break;
    playAiTurn(s, w, player, () => void actions++);
    if (s.day !== day) {
      s.day--;
      record();
      s.day++;
      day = s.day;
      onDay?.(s, w);
      if (process.env.RACE_LOG && day % 28 === 1) console.error(`${file} month ${(day - 1) / 28}: ${players.map((p) => `${PLAYER_NAMES[p.color]} ${towns[p.color][day - 2]}`).join(", ")}`);
    }
    if (actions > 2_000_000) throw new Error("stuck");
  }
  if (s.day <= days) record();
  if (s.winner !== undefined && s.winner >= 0) mark(s.winner, "Wins");
  end?.(s, w);
  return { map: map.name, file, size: map.size, seed, days: Math.min(s.day, days), winner: s.winner, players: players.map((p) => ({ color: p.color, name: PLAYER_NAMES[p.color], faction: p.faction, engine: p.aiEngine })), towns, strength, experience, milestones };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { map: { type: "string", default: "Free for All.h3m" }, days: { type: "string", default: "400" }, seed: { type: "string", default: "1" } } });
  process.env.RACE_LOG ??= "1";
  const race = playRace(loadData(), values.map!, Number(values.seed), Number(values.days), (s) => {
    // RACE_DIARY=1: each player's last AI diary pages (what each hero went for and what held it back).
    if (process.env.RACE_DIARY) for (const p of s.players.filter((p) => p.controller === "ai" && p.alive)) for (const page of (p.aiDiary ?? []).slice(-3)) console.error(`== ${PLAYER_NAMES[p.color]} day ${page.day}\n  ${page.lines.join("\n  ")}`);
    // RACE_STATE=<file>: the game as it ended, to look into (a game that never ends, say).
    if (process.env.RACE_STATE) writeFileSync(process.env.RACE_STATE, JSON.stringify(s));
  });
  console.log(JSON.stringify(race));
}
