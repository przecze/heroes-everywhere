import type { H3Map } from "@heroes/formats";
import { B } from "./town.ts";
import { type AdventureState, type GameConditions, Obj } from "./types.ts";
import type { World } from "./world.ts";

export const VICTORY_TEXT = [
  "Acquire a specific artifact",
  "Accumulate creatures",
  "Accumulate resources",
  "Upgrade a specific town",
  "Build the Grail structure",
  "Defeat a specific hero",
  "Capture a specific town",
  "Defeat a specific monster",
  "Flag all creature dwellings",
  "Flag all mines",
  "Transport a specific artifact",
  "Eliminate all monsters",
  "Survive for a number of days",
];
export const LOSS_TEXT = ["Lose a specific town", "Lose a specific hero", "Time expires"];

type Pos = { x: number; y: number; z: number };

/** Resolves the map's condition positions to the state's heroes and objects. */
/** A player without a town is banished after this many days. */
export const TOWNLESS_DAYS = 7;

/** The days a townless player has left to take a town (0: it has one, or its time is up). */
export function daysToTakeTown(p: { townlessSince?: number }, day: number): number {
  return p.townlessSince === undefined ? 0 : Math.max(0, p.townlessSince + TOWNLESS_DAYS - day);
}

export function resolveConditions(map: H3Map, s: AdventureState): GameConditions {
  const v = map.victory as H3Map["victory"] & { pos?: Pos; artifact?: number; creature?: number; resource?: number; amount?: number; days?: number; hall?: number; fort?: number };
  const l = map.loss as H3Map["loss"] & { pos?: Pos; days?: number };
  // Heroes stand one tile left of their map anchor; objects keep it (random monsters may shift by one).
  const heroAt = (p?: Pos) => (p ? s.heroes.find((h) => h.z === p.z && h.y === p.y && (h.x === p.x - 1 || h.x === p.x))?.id : undefined);
  // (A town's condition names its gate, two tiles left of the town's anchor.)
  const objectAt = (p: Pos | undefined, types: number[]) =>
    p
      ? s.objects
          .filter((o) => types.includes(o.type) && o.z === p.z && o.y === p.y && o.x - p.x >= -1 && o.x - p.x <= 2)
          .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0]?.id
      : undefined;
  const out: GameConditions = {
    victory: { type: v.type, allowNormal: v.type < 0 || !!v.allowNormal, appliesToAI: !!v.appliesToAI },
    loss: { type: l.type },
    contested: new Set(s.players.filter((p) => p.alive).map((p) => p.team ?? p.color + 100)).size > 1,
  };
  const ov = out.victory;
  if (v.artifact !== undefined) ov.artifact = v.artifact;
  if (v.creature !== undefined) ov.creature = v.creature;
  if (v.resource !== undefined) ov.resource = v.resource;
  if (v.amount !== undefined) ov.amount = v.amount;
  if (v.days !== undefined) ov.days = v.days;
  if (v.type === 3) [ov.hall, ov.fort] = [v.hall ?? 2, v.fort ?? 2];
  if (v.type === 5) ov.hero = heroAt(v.pos);
  if (v.type === 3 || v.type === 4 || v.type === 6 || v.type === 10) ov.object = objectAt(v.pos, [Obj.TOWN]);
  if (v.type === 7) ov.object = objectAt(v.pos, [Obj.MONSTER]);
  // Conditions we can't track (the Grail isn't in the game yet, unresolved targets) fall back to normal victory.
  if (((v.type === 5 || v.type === 7) && ov.hero === undefined && ov.object === undefined) || ((v.type === 3 || v.type === 6 || v.type === 10) && ov.object === undefined)) {
    ov.type = -1;
    ov.allowNormal = true;
  }
  if (l.type === 0) out.loss.object = objectAt(l.pos, [Obj.TOWN]);
  if (l.type === 1) out.loss.hero = heroAt(l.pos);
  if (l.type === 2) out.loss.days = l.days;
  return out;
}

/** The hero the map's loss condition names: dismissing it would lose the game (VCMI's CGHeroInstance::isMissionCritical, for the loss-hero case). */
export function isMissionCritical(s: AdventureState, heroId: number): boolean {
  return s.conditions?.loss.type === 1 && s.conditions.loss.hero === heroId;
}

const teamOf = (s: AdventureState, color: number) => s.players[color]?.team ?? color + 100;

function eliminate(s: AdventureState, color: number, why: string, lossType = -1) {
  const p = s.players[color];
  if (!p?.alive) return;
  p.alive = false;
  p.lostBy = lossType;
  for (const h of s.heroes) if (h.owner === color) h.removed = true;
  for (const o of s.objects) if (o.owner === color) o.owner = -1;
  s.log.push(`${["Red", "Blue", "Tan", "Green", "Orange", "Purple", "Teal", "Pink"][color]} is out of the game: ${why}.`);
}

/** Does this player meet the special victory condition right now? */
function meetsVictory(s: AdventureState, w: World, color: number): boolean {
  const v = s.conditions?.victory;
  if (!v || v.type < 0) return false;
  if (!v.appliesToAI && s.players[color].controller !== "human") return false;
  const heroes = s.heroes.filter((h) => !h.removed && h.owner === color);
  const owned = (types: number[]) => s.objects.filter((o) => !o.removed && types.includes(o.type));
  switch (v.type) {
    case 0:
      return heroes.some((h) => h.backpack?.includes(v.artifact!) || h.equipped?.includes(v.artifact!));
    case 1: {
      let n = 0;
      for (const h of heroes) for (const a of h.army) if (a && a.creature === v.creature) n += a.count;
      for (const o of s.objects) if (o.town && o.owner === color) for (const a of o.town.garrison) if (a && a.creature === v.creature) n += a.count;
      return n >= (v.amount ?? 0);
    }
    case 2:
      return s.players[color].resources[v.resource ?? 6] >= (v.amount ?? 0);
    case 3: {
      const t = s.objects[v.object!];
      // The map's hall (Town Hall / City Hall / Capitol) and fort (Fort / Citadel / Castle) levels, as VCMI reads them.
      const hall = [B.TOWN_HALL, B.CITY_HALL, B.CAPITOL][Math.max(0, Math.min(2, v.hall ?? 2))];
      const fort = [B.FORT, B.CITADEL, B.CASTLE][Math.max(0, Math.min(2, v.fort ?? 2))];
      return t?.owner === color && !!t.town?.built.includes(hall) && !!t.town.built.includes(fort);
    }
    case 4:
      return s.objects.some((o) => o.town && o.owner === color && o.town.built.includes(B.GRAIL) && (v.object === undefined || o.id === v.object));
    case 6:
      return s.objects[v.object!]?.owner === color;
    case 8:
      return owned([17, 20]).length > 0 && owned([17, 20]).every((o) => o.owner === color);
    case 9:
      return owned([Obj.MINE]).length > 0 && owned([Obj.MINE]).every((o) => o.owner === color);
    case 10: {
      const t = s.objects[v.object!];
      return !!t && heroes.some((h) => (h.backpack?.includes(v.artifact!) || h.equipped?.includes(v.artifact!)) && w.visitBy[w.index(h.x, h.y, h.z)] === t.id + 1);
    }
    case 11:
      return owned([Obj.MONSTER]).length === 0;
    case 12:
      return s.day > (v.days ?? Infinity);
  }
  return false;
}

/**
 * Settles who is still in the game and whether it's over. `defeated` names a
 * special target just killed (hero or monster) and who did it.
 */
export function checkGameEnd(s: AdventureState, w: World, defeated?: { hero?: number; object?: number; by: number }) {
  if (s.winner !== undefined) return;
  const c = s.conditions;
  // Loss conditions (only for human players, as in the original).
  for (const p of s.players) {
    if (!p.alive || p.controller !== "human" || !c) continue;
    if (c.loss.type === 0 && c.loss.object !== undefined && s.objects[c.loss.object]?.owner !== p.color) eliminate(s, p.color, "lost the key town", 0);
    if (c.loss.type === 1 && c.loss.hero !== undefined && s.heroes[c.loss.hero]?.removed) eliminate(s, p.color, "lost the key hero", 1);
    if (c.loss.type === 2 && s.day > (c.loss.days ?? Infinity)) eliminate(s, p.color, "time ran out", 2);
  }
  // Standard elimination: no towns and no heroes, or no town for 7 days.
  // (Counted in one pass: this runs after every action, and a pass per player was a tenth of the AI's time on XL maps.)
  const townsOf = new Map<number, number>();
  const heroesOf = new Map<number, number>();
  for (const o of s.objects) if (o.town && !o.removed) townsOf.set(o.owner, (townsOf.get(o.owner) ?? 0) + 1);
  for (const h of s.heroes) if (!h.removed) heroesOf.set(h.owner, (heroesOf.get(h.owner) ?? 0) + 1);
  for (const p of s.players) {
    if (!p.alive) continue;
    const towns = townsOf.get(p.color) ?? 0;
    const heroes = heroesOf.get(p.color) ?? 0;
    if (!towns && !heroes) eliminate(s, p.color, "no towns and no heroes left");
    else if (towns) delete p.townlessSince;
    else {
      p.townlessSince ??= s.day;
      if (daysToTakeTown(p, s.day) <= 0) eliminate(s, p.color, "a week without a town");
    }
  }
  // Special victory.
  if (c && defeated && ((c.victory.type === 5 && defeated.hero === c.victory.hero) || (c.victory.type === 7 && defeated.object === c.victory.object))) {
    if (c.victory.appliesToAI || s.players[defeated.by].controller === "human") return win(s, defeated.by, c.victory.type);
  }
  for (const p of s.players) if (p.alive && meetsVictory(s, w, p.color)) return win(s, p.color, c!.victory.type);
  // Normal victory: one team left.
  const alive = s.players.filter((p) => p.alive);
  // (No one left at all, as when a lone computer player of a one-player map loses its town: no winner.)
  if (!alive.length || (s.players.some((p) => p.controller === "human") && !alive.some((p) => p.controller === "human"))) {
    // Every human is out: a winner only when the ones left are one team (the computer players
    // still fighting each other haven't won anything yet).
    s.winner = alive.length && new Set(alive.map((p) => teamOf(s, p.color))).size === 1 ? alive[0].color : -1;
    s.log.push("Game over.");
    return;
  }
  const teams = new Set(alive.map((p) => teamOf(s, p.color)));
  if (teams.size <= 1 && alive.length && (c?.contested ?? true) && (c?.victory.allowNormal ?? true)) win(s, alive[0].color);
}

/** nwcredpill / nwcbluepill: win or lose at once. */
export function cheatOutcome(s: AdventureState, color: number, won: boolean) {
  if (won) return win(s, color);
  eliminate(s, color, "gave up");
}

function win(s: AdventureState, color: number, victoryType = -1) {
  s.winner = color;
  s.victoryType = victoryType;
  s.log.push(`${["Red", "Blue", "Tan", "Green", "Orange", "Purple", "Teal", "Pink"][color]} wins the game!`);
}
