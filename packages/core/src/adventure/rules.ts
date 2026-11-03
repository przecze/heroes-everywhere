import { spellAllowed } from "./bans.ts";
import { ruleOn } from "./gameRules.ts";
import type { MapEvent } from "@heroes/formats";
import { skillFactor, specialtyIncome } from "../specialty.ts";
import { BANK_LOAN, SPECIAL, cannotBorrow, castleGateTowns, coverOfDarkness, hasSpecial, manaVortexRefusal, useManaVortex, visitTownSpecials, weeklyTownSpecials } from "./townSpecials.ts";
import { weekIndex } from "../calendar.ts";
import { RESOURCES, isRecruitable } from "../creatures.ts";

import { TOWNS } from "../townData.ts";
import { randInt } from "../rng.ts";
import { PLAYER_NAMES, customizeHero, makeHero, newTavernWeek, startingKit, tavernArmy, tavernHired, tavernOffer } from "./create.ts";
import { BANKS } from "../bankData.ts";
import { checkGameEnd, isMissionCritical } from "./conditions.ts";
import { applyCheat } from "./cheats.ts";
import { mapData } from "./objects.ts";
import { exchangeAll, moveJoiners, moveStack, transfer } from "./armies.ts";
import { MACHINE_SLOT, machinePrice, assemble, bonus, disassemble, giveArtifact, moveArtifact, hasBonus, initEquipment, randomArtifactPool, wornArtifacts } from "./artifacts.ts";
import { castAdventureSaid } from "./advSpells.ts";
import { SPELL } from "../spells.ts";
import { SPELLBOOK_COST, guildLevel, learnFromGuild, manaRegen, maxMana } from "./magic.ts";
import { finalizeResearch, pickResearch, startResearch } from "./research.ts";
import { ESTATES, skillLevel } from "../skills.ts";
import { marketCount, trade } from "./market.ts";
import { DWELLINGS } from "../dwellingData.ts";
import { AIRSHIP, airshipStop, boatAt, entersToVisit, findPaths, garrisonPass, isAirship, isStop, mapPathTo, maxMovement, refreshMovement, sailing, startDay, dayPool, stepPrice } from "./movement.ts";
import { type AdventureState, type AdvObject, type ArmySlot, type Component, type Hero, Obj, type PendingBattle, RESOURCE_NAMES, type TextRef } from "./types.ts";
import { Terrain, heroSight, tileSpan, visitOffset, type World, reveal, revealOwned, visitTile } from "./world.ts";
import { attackHero, catchUpLevels, chooseSkill, gainExperience, refreshLevelUps } from "./combat.ts";
import { freeTileNear, meetMonster, resolveOffer, visit } from "./visit.ts";
import { B, SHORT_OF_RESOURCES, SPECIAL_DWELLING_CREATURES, addRecruits, canPay, buildingsFromBits, build, recruit, townIncome, townInfo, upgradeInTown, visitingHero, garrisonHero, swapGarrisonHero, weeklyTownGrowth } from "./town.ts";
import { Refusal } from "../refusal.ts";
import { blacksmithMachine, buyMachineAt, cannotBuyMachine, learnSkillAt, tradeAt, upgradeAtHillFort } from "./trades.ts";
import { handicapped } from "./handicap.ts";
import { answerPlayerScript, runScript, runTownScript, scriptOff } from "./scripts.ts";
import { lineText } from "../gameLines.ts";

export type AdventureAction =
  /** `steps`: walk at most that many tiles of the route (then on to the first tile the hero can stop on); the client walks a player's route a step at a time so that a click can stop it, as the original. */
  /** `cyclicPortals`: the player's switch for monoliths' exits in turn (Player.cyclicPortals), sent with each move. */
  | { type: "move"; hero: number; to: number; steps?: number; cyclicPortals?: boolean; /** Beyond HotA (EXTRAS throughGarrisons): walk on through the player's own garrisons (movement.ts garrisonPass). */ throughGarrisons?: boolean }
  /** Visit again the object the hero stands on (Space in the original). */
  | { type: "visit"; hero: number; cyclicPortals?: boolean }
  | { type: "build"; town: number; building: number }
  | { type: "recruit"; town: number; level: number; upgraded: boolean; count: number; /** HotA's second upgrade (the Cove's Sea Dogs). */ second?: boolean }
  | { type: "upgradeInTown"; town: number; who: "garrison" | "hero"; slot: number }
  /** Town screen: the visiting and garrison heroes change places (either may be missing). */
  | { type: "swapGarrison"; town: number }
  | { type: "takeGarrison"; town: number }
  | { type: "cheat"; code: string; hero?: number; town?: number }
  /** The hero screen's toggles: tight / loose formation, Tactics on / off. */
  | { type: "heroSettings"; hero: number; tight?: boolean; tactics?: boolean }
  /** Dismiss the hero: gone with the army (back in the taverns' pool). */
  | { type: "dismiss"; hero: number }
  /** The creature window's Dismiss: a stack of a hero's army (never the last) or of a town's garrison goes. */
  | { type: "dismissStack"; hero?: number; town?: number; slot: number }
  | { type: "hireHero"; town: number; slot: number }
  | { type: "trade"; from: number; to: number; lots: number }
  /** The marketplace's "transfer resources" (VCMI's RESOURCE_PLAYER): a gift to another player, one for one. */
  | { type: "giveResources"; to: number; resource: number; amount: number }
  | { type: "buildBoat"; object: number }
  | { type: "chooseSkill"; hero: number; option: number }
  | { type: "buySpellbook"; hero: number }
  /** Blacksmith: the town's war machine for the hero in the gate. */
  | { type: "buyMachine"; town: number }
  /** Dungeon's Mana Vortex (HotA: asked for): doubles the spell points of the town's hero. */
  | { type: "manaVortex"; town: number }
  | { type: "research"; town: number; level: number; slot: number }
  | { type: "researchPick"; town: number; spell: number }
  | { type: "researchFinalize"; town: number }
  /** Combine worn parts into a combination artifact, or take one apart (by its slot). */
  | { type: "assemble"; hero: number; artifact: number }
  | { type: "disassemble"; hero: number; slot: number }
  /** Answer wandering monsters: accept them joining / pursue the fleeing ones (true), or not. */
  | { type: "answerOffer"; hero: number; accept: boolean; option?: number }
  | { type: "answerScript"; accept: boolean; option?: number }
  /** Joiners that found the army full (the original's garrison window): move stacks between them and the hero. */
  | { type: "moveJoiners"; hero: number; from: { who: "joiners" | "hero"; slot: number }; to: { who: "joiners" | "hero"; slot: number }; count?: number }
  /** The window closed: whoever is left in the upper row goes away. */
  | { type: "closeJoiners"; hero: number }
  /** Put a hero to sleep (or wake it): sleeping heroes are skipped by "next hero". */
  | { type: "sleep"; hero: number; asleep: boolean }
  /** Black Market: buy one of its artifacts (by its place in the stock). */
  /** `resource`: what to pay with (gold when not given). */
  | { type: "buyArtifact"; hero: number; object: number; slot: number; resource?: number }
  /** Freelancer's Guild: sell an army stack for gold. */
  /** `resource`: what to take for them (gold when not given). */
  | { type: "sellStack"; hero: number; object: number; slot: number; count: number; resource?: number }
  /** Skeleton Transformer: these army stacks become Skeletons (dragons: Bone Dragons). */
  | { type: "transform"; hero: number; object: number; slots: number[] }
  /** Dungeon's Portal of Summoning: this week's creature from one of the player's dwellings. */
  | { type: "recruitPortal"; town: number; count: number }
  /** Inferno's Castle Gate: the visiting hero steps into another town with one. */
  | { type: "castleGate"; hero: number; town: number; to: number }
  /** The Factory's Bank: 2500 gold now, the town earns 500 less for five days. */
  | { type: "bankLoan"; town: number }
  /** Town Gate (HotA): to an allied town. */
  | { type: "townGate"; hero: number; object: number; town: number }
  /** Junkman (HotA): an artifact (by id; backpack first) for half its price in gold. */
  /** `resource`: what to take in return (gold when not given). */
  | { type: "sellArtifact"; hero: number; object: number; artifact: number; resource?: number }
  /** Altar of Sacrifice: creatures (evil heroes) or artifacts (the rest) for experience. */
  | { type: "sacrifice"; hero: number; object: number; stacks?: [number, number][]; artifacts?: number[] }
  /** A Tavern on the map: hire a hero from the tavern offer, next to it. */
  | { type: "hireAt"; hero: number; object: number; slot: number }
  /** War Machine Factory: a ballista (4), ammo cart (5) or first aid tent (6). */
  | { type: "buyMachineAt"; hero: number; object: number; artifact: number }
  /** University: a secondary skill (Basic) for 2000 gold. */
  | { type: "learnSkill"; hero: number; object: number; skill: number }
  /** Hill Fort: upgrade an army stack. */
  | { type: "upgradeStack"; hero: number; object: number; slot: number }
  /** Dig for the Grail where the hero stands (needs a full day's movement). */
  | { type: "dig"; hero: number }
  /** Two of your heroes side by side: move troops (count to split) or artifacts between them. */
  | { type: "transfer"; heroes: [number, number]; kind: "army" | "artifact"; from: TransferRef; to: TransferRef; count?: number }
  /** HD mod's quick exchange: everything of a kind from one hero to the other (`from` 0 or 1), or swapped. */
  | { type: "exchangeAll"; heroes: [number, number]; kind: "army" | "artifact"; from: 0 | 1 | "swap" }
  /** Hero screen: move an artifact between a worn slot and the backpack, or between slots. */
  | { type: "equip"; hero: number; from: ArtifactRef; to: ArtifactRef }
  /** An adventure spell; `target` is a tile (Dimension Door, Scuttle Boat) or a town (Town Portal). */
  | { type: "castSpell"; hero: number; spell: number; target?: number }
  /** Town screen: move, swap, merge or split stacks between the garrison and the visiting hero. */
  | { type: "moveStack"; town: number; from: ArmyRef; to: ArmyRef; count?: number }
  | { type: "recruitDwelling"; hero: number; object: number; slot: number; count: number }
  | { type: "endTurn" };

/** Which of the two meeting heroes (0 or 1) and an army slot, worn slot or backpack position. */
export interface TransferRef {
  who: 0 | 1;
  slot?: number;
  backpack?: number;
}

/** A worn slot (0..18) or a backpack position. */
export interface ArtifactRef {
  slot?: number;
  backpack?: number;
}

export interface ArmyRef {
  who: "garrison" | "hero";
  slot: number;
}

export type AdventureEvent =
  | { e: "move"; hero: number; path: number[] }
  | { e: "pickup"; hero: number; object: number; resource: number; amount: number; own?: boolean }
  /** `message` in English; `text` the original's own line for it, `components` the rewards pictured. */
  | { e: "visit"; hero: number; object: number; message: string; text?: TextRef; components?: Component[]; /** Its own sound (digging: VCMI's DIG / ULTIMATEARTIFACT). */ sound?: string }
  | { e: "flag"; object: number; owner: number }
  | { e: "battle"; hero: number; object: number }
  | { e: "battleResult"; hero: number; object: number; won: boolean; defender?: number }
  | { e: "town"; hero: number; object: number }
  | { e: "dwelling"; hero: number; object: number }
  | { e: "teleport"; hero: number; object: number; to: number }
  | { e: "shipyard"; hero: number; object: number }
  /** `message` in English ("" for none); `text` the original's own line for it. */
  | { e: "spell"; hero: number; spell: number; message: string; text?: TextRef }
  | { e: "meet"; hero: number; other: number }
  | { e: "obelisk"; hero: number; object: number }
  /** Joining creatures found the army full: make room for them (the original's garrison window). */
  | { e: "joiners"; hero: number }
  /** Wandering monsters offer to join (free or for gold) or are fleeing: the player answers. */
  | {
      e: "offer";
      hero: number;
      object: number;
      kind: "join" | "pay" | "flee" | "ask" | "primary" | "confirm" | "chest" | "attack" | "pandora" | "quest" | "script";
      cost: number;
      text?: string;
      options?: number[];
      /** The original's line for the question, and what accepting gives. */
      textRef?: TextRef;
      components?: Component[];
      /** Joining monsters: how many would join (HotA: the map's share of the stack). */
      count?: number;
      /** A script's two-picture question: the pictures shown beside the two to pick from. */
      extra?: Component[];
    }
  /** A hero at a trading object (Trading Post, University, War Machine Factory, Hill Fort): open its window. */
  | { e: "market"; hero: number; object: number }
  /** A hero stands in its player's map garrison: the original's garrison window ("Leave Guards"). */
  | { e: "garrison"; hero: number; object: number }
  | { e: "built"; object: number; building: number }
  | { e: "day"; day: number }
  /** A message for one player (the map's timed events). */
  | { e: "message"; player: number; text: string; components?: Component[] }
  /** A timed or town event's script asks the player (no hero to ask): mode 1 / 2 picks one of two pictures (2 with Cancel). */
  | { e: "scriptAsk"; player: number; text: string; mode: number; components?: Component[]; extra?: Component[] }
  | { e: "turn"; player: number };

const MINE_INCOME = [2, 1, 2, 1, 1, 1, 1000];

export const PRIMARY_NAMES = ["Attack", "Defense", "Power", "Knowledge"];

// Visit once per hero: object id -> [primary skill, amount].
export const PRIMARY_SHRINES: Record<number, [number, number]> = {
  32: [3, 1], // Garden of Revelation
  51: [0, 1], // Mercenary Camp
  23: [1, 1], // Marletto Tower
  61: [2, 1], // Star Axis
};
export const SHRINE_NAMES: Record<number, string> = { 32: "Garden of Revelation", 51: "Mercenary Camp", 23: "Marletto Tower", 61: "Star Axis" };

export const ART_TIER: Record<string, string> = { TREASURE: "T", MINOR: "N", MAJOR: "J", RELIC: "R" };

export const week = (s: AdventureState) => weekIndex(s.day);

/** The creatures a map dwelling sells (object 17), or null for other objects. */
export function dwellingCreatures(o: AdvObject): number[] | null {
  // Refugee Camp: a different creature every week.
  if (o.type === REFUGEE_CAMP) return o.data?.creature !== undefined ? [Number(o.data.creature)] : null;
  if (o.type === SPECIAL_DWELLING) return SPECIAL_DWELLINGS[o.subid]?.creatures ?? null;
  return o.type === 17 ? (DWELLINGS[o.subid] ?? null) : null;
}

/**
 * An Abandoned Mine (mine subtype 7): guarded by 100-199 Troglodytes (or the map's own guards),
 * then it produces one of the resources the map allows, picked when it's first looked at.
 */
export function abandonedMine(s: AdventureState, w: World, o: AdvObject): { guards: ArmySlot[]; resource: number; cleared?: boolean } | null {
  if ((o.type !== Obj.MINE && o.type !== 220) || o.subid < 7) return null;
  const d = (o.data ??= {}) as Record<string, unknown>;
  if (!d.abandoned) {
    const md = mapData(w, o) as { resources?: number[]; guards?: { creature: number; min: number; max: number } };
    const allowed = (md.resources ?? []).filter((r) => r < 7);
    const pool = allowed.length ? allowed : [6];
    const g = md.guards ?? { creature: 70, min: 100, max: 199 };
    d.abandoned = { resource: pool[randInt(s, 0, pool.length - 1)], guards: [{ creature: g.creature, count: randInt(s, g.min, Math.max(g.min, g.max)) }] };
  }
  return d.abandoned as { guards: ArmySlot[]; resource: number; cleared?: boolean };
}

/**
 * Dungeon's Portal of Summoning: each week (and when built) a random flagged dwelling of the
 * owner lends its creature, a week's growth of it (heroes.thelazy.net/index.php/Portal_of_Summoning).
 */
export function rollPortal(s: AdventureState, w: World, o: AdvObject) {
  const dwellings = s.objects.filter((x) => !x.removed && x.owner === o.owner && x.dwelling && (dwellingCreatures(x)?.length ?? 0) > 0);
  if (!dwellings.length) return void ((o.data ??= {}).portal = undefined);
  const d = dwellings[randInt(s, 0, dwellings.length - 1)];
  const options = dwellingCreatures(d)!;
  const creature = options[randInt(s, 0, options.length - 1)];
  (o.data ??= {}).portal = { creature, available: w.creatures[creature]?.growth ?? 1 };
}

/** The map's timed events due today: resources and a message for the players they're for (also on day 1). */
/** A HotA event may happen only on some difficulties. */
const onDifficulty = (s: AdventureState, ev: MapEvent) => ev.difficulties === undefined || !!(ev.difficulties & (1 << (s.difficulty ?? 1)));

export function timedEvents(s: AdventureState, w: World): AdventureEvent[] {
  const out: AdventureEvent[] = [];
  for (const ev of w.map.events ?? []) {
    const d = s.day - 1 - ev.first;
    if (d < 0 || (d > 0 && !(ev.every > 0 && d % ev.every === 0))) continue;
    if (!onDifficulty(s, ev)) continue;
    s.players.forEach((p, i) => {
      if (!p.alive || !(ev.players & (1 << i))) return;
      if ((p.controller === "human" && !ev.human) || (p.controller === "ai" && !ev.computer)) return;
      // HotA 1.8: a script instead of its own resources and message (unless the script turned it off).
      if (ev.script) return void (scriptOff(s, `player:${ev.script.id}`) || out.push(...runScript(s, w, "player", ev.script.id, i)));
      ev.resources.forEach((n, r) => (p.resources[r] = Math.max(0, p.resources[r] + n)));
      if (ev.message && p.controller === "human") out.push({ e: "message", player: i, text: ev.message });
    });
  }
  // Town events: for the town's owner, resources, new buildings and extra creatures.
  for (const o of s.objects) {
    if (!o.town || o.removed || o.owner < 0) continue;
    const list = mapData(w, o).events as (MapEvent & { buildings?: number[]; creatures?: number[] })[] | undefined;
    for (const ev of list ?? []) {
      const d = s.day - 1 - ev.first;
      if (d < 0 || (d > 0 && !(ev.every > 0 && d % ev.every === 0))) continue;
      if (!onDifficulty(s, ev)) continue;
      const p = s.players[o.owner];
      if (!p?.alive || !(ev.players & (1 << o.owner))) continue;
      if ((p.controller === "human" && !ev.human) || (p.controller === "ai" && !ev.computer)) continue;
      if (ev.script) {
        out.push(...runTownScript(s, w, o, ev.script.id));
        continue;
      }
      ev.resources.forEach((n, r) => (p.resources[r] = Math.max(0, p.resources[r] + n)));
      for (const b of buildingsFromBits(o, ev.buildings ?? [])) if (!o.town.built.includes(b)) o.town.built.push(b);
      (ev.creatures ?? []).forEach((n, l) => {
        if (n > 0 && l < o.town!.available.length) o.town!.available[l] += n;
      });
      if (ev.message && p.controller === "human") out.push({ e: "message", player: o.owner, text: ev.message });
    }
  }
  return out;
}

/** Mercury, sulfur, crystal, gems. */
export const PRECIOUS = [1, 3, 4, 5];

export const SPECIAL_DWELLING = 20;
/** Multi-creature dwellings (VCMI's creatureGeneratorSpecial) and the guards they start with. */
const SPECIAL_DWELLINGS: Record<number, { creatures: number[]; guards: ArmySlot[] }> = {
  0: { creatures: SPECIAL_DWELLING_CREATURES[0], guards: [{ creature: 113, count: 12 }] }, // Elemental Conflux
  1: { creatures: SPECIAL_DWELLING_CREATURES[1], guards: [{ creature: 116, count: 9 }, { creature: 117, count: 6 }] }, // Golem Factory
};

export const REFUGEE_CAMP = 78;

/** Never in a Refugee Camp (heroes.thelazy.net Refugee Camp). */
const NO_REFUGEES = new Set(["sharpshooter", "enchanter", "azureDragon", "crystalDragon", "rustDragon", "fairieDragon"]);

/** A Refugee Camp's creature for the week: any recruitable creature but those. */
export function rollRefugees(s: AdventureState, w: World, o: AdvObject) {
  const pool = w.creatures.filter((c) => c && isRecruitable(c) && !NO_REFUGEES.has(c.key));
  const c = pool[randInt(s, 0, pool.length - 1)];
  o.data = { ...(o.data ?? {}), creature: c.id };
  o.dwelling = { available: [c.growth] };
}

/** A dwelling's creatures and stock (a first look stocks it with a week's growth; with `store` false, only once taken up). */
export function dwellingOf(w: World, o: AdvObject, store = true) {
  const creatures = dwellingCreatures(o);
  if (!creatures) return null;
  const d = o.dwelling ?? { available: creatures.map((c) => w.creatures[c]?.growth ?? 0) };
  if (store) o.dwelling = d;
  return { creatures, d };
}

/** Level 5-7 dwellings are guarded by three weeks' growth (the Pyre's Firebirds: six), renewed weekly. */
export function dwellingGuards(s: AdventureState, w: World, o: AdvObject, h: Hero): ArmySlot[] {
  const found = dwellingOf(w, o);
  if (!found || o.owner === h.owner || found.d.clearedWeek === week(s)) return [];
  // A hero beaten (or fled) this week left only the survivors; the week's start renews them.
  if (found.d.guardsLeft?.week === week(s)) return found.d.guardsLeft.guards.map((g) => ({ ...g }));
  // Special dwellings are guarded until someone takes them.
  if (o.type === SPECIAL_DWELLING) return o.owner >= 0 ? [] : (SPECIAL_DWELLINGS[o.subid]?.guards ?? []).map((g) => ({ ...g }));
  const c = w.creatures[found.creatures[0]];
  if (!c || c.level < 5) return [];
  return [{ creature: c.id, count: c.growth * 3 }];
}

/** Buys creatures at a map dwelling the hero stands next to; level 1 creatures are free. */
/** What one creature costs at a dwelling on the map: level 1 ones are given away, except at the Refugee Camp. */
export function dwellingPrice(w: World, o: AdvObject, creature: number): number[] {
  const c = w.creatures[creature];
  return c && (c.level !== 1 || o.type === REFUGEE_CAMP) ? [...c.cost] : [0, 0, 0, 0, 0, 0, 0];
}

function recruitDwelling(s: AdventureState, w: World, h: Hero, o: AdvObject, slot: number, count: number): AdventureEvent[] {
  const found = o && dwellingOf(w, o, false);
  if (!found) throw new Refusal("not a dwelling");
  if (o.owner !== h.owner && o.type !== REFUGEE_CAMP) throw new Refusal("flag the dwelling first");
  const gate = w.visitBy.findIndex((v, i) => v === o.id + 1 && Math.max(Math.abs((i % w.size) - h.x), Math.abs((Math.floor(i / w.size) % w.size) - h.y)) <= 1 && Math.floor(i / (w.size * w.size)) === h.z);
  if (gate < 0) throw new Refusal("the hero must be at the dwelling");
  const creature = found.creatures[slot];
  const c = w.creatures[creature];
  if (!c || !Number.isInteger(count) || count <= 0 || count > found.d.available[slot]) throw new Refusal("not that many available");
  const cost = dwellingPrice(w, o, creature).map((n) => n * count);
  const res = s.players[h.owner].resources;
  if (!canPay(cost, res)) throw new Refusal(SHORT_OF_RESOURCES);
  // No room: they wait in the "make room" window, as creatures joining on the map do (2026-11-03: not refused
  // silently); those left there go back to the dwelling and are refunded (dropJoiners). The computer can't answer it.
  const full = !addToArmy(h, creature, count);
  if (full && s.players[h.owner]?.controller !== "human") throw new Refusal("no free army slot");
  cost.forEach((n, i) => (res[i] -= n));
  o.dwelling = found.d;
  found.d.available[slot] -= count;
  if (full) {
    h.joiners = [{ creature, count }, null, null, null, null, null, null];
    h.joinersFrom = { object: o.id, slot, creature, price: dwellingPrice(w, o, creature) };
    return [{ e: "joiners", hero: h.id }];
  }
  s.log.push(`${h.name} recruits ${count} ${c.plural}.`);
  return [];
}

/** Joiners nobody made room for leave; bought at a dwelling, they go back to it and their price is refunded. */
function dropJoiners(s: AdventureState, h: Hero) {
  const from = h.joinersFrom;
  const o = from && s.objects[from.object];
  if (from && o?.dwelling) {
    // (Only the dwelling's creature: a stack of the hero's own moved up to make room just goes, as on the map.)
    const left = (h.joiners ?? []).reduce((n, x) => n + (x && x.creature === from.creature ? x.count : 0), 0);
    o.dwelling.available[from.slot] = (o.dwelling.available[from.slot] ?? 0) + left;
    const res = s.players[h.owner]?.resources;
    if (res) from.price.forEach((n, i) => (res[i] += n * left));
  }
  delete h.joiners;
  delete h.joinersFrom;
}

/** Adds creatures to a matching or free slot; false when the army is full. */
export function addToArmy(h: Hero, creature: number, count: number): boolean {
  const same = h.army.findIndex((x) => x?.creature === creature);
  const free = h.army.findIndex((x) => !x);
  if (same >= 0) h.army[same]!.count += count;
  else if (free >= 0) h.army[free] = { creature, count };
  else return false;
  return true;
}

// Names for weeks and months without a creature, in the order of the original's lists (ARRAYTXT's gWeekNames from
// line WEEK_NAME_LINE, gMonthNames from MONTH_NAME_LINE): the screen shows the game's own word, in its language.
export const WEEK_NAME_LINE = 43;
export const MONTH_NAME_LINE = 32;
export const WEEK_NAMES = ["Squirrel", "Rabbit", "Gopher", "Badger", "Rat", "Eagle", "Weasel", "Raven", "Mongoose", "Dog", "Aardvark", "Lizard", "Tortoise", "Hedgehog", "Condor"];
/** Creatures a month can double (VCMI's hasDoubleWeek; HotA adds the Sprites and its towns' own). */
const DOUBLE_MONTH = new Set(["griffin", "troglodyte", "harpy", "lizardman", "serpentFly", "gog", "wight", "centaur", "pegasus", "hobgoblin", "goblinWolfRider", "gremlin", "sprite", "stormbird", "crewmate", "armadillo", "kobold"]);
/** A creature's month's new stacks, by level (heroes.thelazy.net Growth; Sprites and Hobgoblins 40-60). */
const MONTH_STACK: Record<number, [number, number]> = { 1: [40, 100], 2: [32, 60], 3: [24, 50], 4: [20, 40] };

/**
 * A creature's month (and the Deity of Fire's Imps each month): new wandering stacks of it on about
 * 0.5% of the free land (heroes.thelazy.net Growth: "any free tile except water has a 0,5% chance";
 * VCMI's spawnWanderingMonsters). Existing stacks stay as they are.
 */
export function spawnMonthStacks(s: AdventureState, w: World, creature: number) {
  const c = w.creatures[creature];
  const t = c && w.data.templates.find((x) => x.id === Obj.MONSTER && x.subid === creature);
  if (!c || !t) return;
  w.refresh(s);
  const free: number[] = [];
  for (let i = 0; i < w.map.tiles.length; i++) {
    const terrain = w.map.tiles[i].terrain;
    if (terrain !== Terrain.WATER && terrain !== Terrain.ROCK && !w.blocked(i) && !w.visitBy[i] && !w.heroAt[i]) free.push(i);
  }
  const [lo, hi] = c.key === "sprite" || c.key === "hobgoblin" ? [40, 60] : (MONTH_STACK[c.level] ?? [20, 40]);
  const v = visitOffset(t.visitMask) ?? [0, 0];
  for (let n = Math.floor(free.length * 0.005); n > 0 && free.length; n--) {
    const at = free.splice(randInt(s, 0, free.length - 1), 1)[0];
    if (w.blocked(at) || w.visitBy[at]) continue;
    const [x, y, z] = [at % w.size, Math.floor(at / w.size) % w.size, Math.floor(at / (w.size * w.size))];
    const amount = randInt(s, lo, hi);
    const id = s.objects.length;
    s.objects.push({ id, type: Obj.MONSTER, subid: creature, def: t.def, x: x - v[0], y: y - v[1], z, block: t.blockMask, visit: t.visitMask, flat: false, owner: -1, amount, data: { aggression: randInt(s, 1, 10), power: amount * 1000 } });
    w.refresh(s);
  }
}
export const MONTH_NAMES = ["Grasshopper", "Ant", "Ladybug", "Spider", "Butterfly", "Bumblebee", "Locust", "Earthworm", "Hornet", "Beetle"];

/** The astrologers' proclamation: sometimes a creature's week (+5 growth); a month may bring plague or a creature's month. */
function proclaimWeek(s: AdventureState, w: World) {
  const pool = w.creatures.filter((c) => c && isRecruitable(c) && c.level >= 1 && c.level <= 6 && TOWNS.some((t) => t?.creatures.some(([base]) => base === c.id)));
  const pick = () => pool[randInt(s, 0, pool.length - 1)];
  const newMonth = (s.day - 1) % 28 === 0 && s.day !== 1;
  // Inferno's Grail, the Deity of Fire (VCMI's DEITYOFFIRE): while it stands, every week is the Week
  // of the Imp (+15 imps and familiars), instead of any other week's or month's event.
  const imp = w.creatures.find((x) => x?.key === "imp");
  if (imp && s.objects.some((o) => !o.removed && o.town && townInfo(o)?.faction === "inferno" && o.town.built.includes(B.GRAIL))) {
    s.week = { name: imp.name, creature: imp.id, deity: true };
    // Each new month Imps come out on the map, 40-100 a stack (heroes.thelazy.net Growth).
    if (newMonth) spawnMonthStacks(s, w, imp.id);
    return;
  }
  // As VCMI's NewTurnProcessor: a new month is a month's event (40% a creature's month, 10% plague)
  // instead of the week's; other weeks are a creature's week 25% of the time.
  const roll = randInt(s, 0, 99);
  const c = !newMonth && roll < 25 && pool.length ? pick() : undefined;
  s.week = c ? { name: c.name, creature: c.id } : { name: WEEK_NAMES[randInt(s, 0, WEEK_NAMES.length - 1)] };
  if (newMonth) {
    // A HotA map may rule out special months: every month is an ordinary one.
    if (w.map.hotaOptions?.specialMonths === false) s.week.month = { name: MONTH_NAMES[randInt(s, 0, MONTH_NAMES.length - 1)] };
    else if (roll < 40 && pool.length) {
      // Month of the <creature>: its towns' numbers double (weeklyTownGrowth), and new stacks of it roam the map.
      const doubled = w.creatures.filter((x) => x && DOUBLE_MONTH.has(x.key));
      const m = doubled.length ? doubled[randInt(s, 0, doubled.length - 1)] : pick();
      s.week.month = { name: m.name, creature: m.id };
      spawnMonthStacks(s, w, m.id);
    } else if (roll < 50) {
      // Plague: half of every town's creatures die, and none grow (weeklyTownGrowth).
      s.week.month = { name: "Plague", plague: true };
    } else s.week.month = { name: MONTH_NAMES[randInt(s, 0, MONTH_NAMES.length - 1)] };
  }
}

/** Rolls a creature bank's level and guards (once, on the first visit). */
export function bankOf(s: AdventureState, o: AdvObject) {
  const def = BANKS[`${o.type}:${o.subid}`];
  if (!o.bank && def) {
    // (What a HotA map chose: the level, -1 random; the upgraded stack, 0 never, 1 always, -1 random.)
    const chosen = o.data?.chosenBank as { level: number; upgraded: number } | undefined;
    let level = 0;
    if (chosen && chosen.level >= 0 && chosen.level < def.levels.length) level = chosen.level;
    else {
      let roll = randInt(s, 0, 99);
      while (level < def.levels.length - 1 && roll >= def.levels[level].chance) roll -= def.levels[level++].chance;
    }
    const guards = def.levels[level].guards.map(([creature, count, upgraded, percent]) => ({
      creature: upgraded !== undefined && (chosen && chosen.upgraded >= 0 ? chosen.upgraded === 1 : randInt(s, 0, 99) < percent) ? upgraded : creature,
      count,
    }));
    o.bank = { level, guards };
  }
  return def && o.bank ? { def, bank: o.bank } : null;
}

/** A plundered bank's treasure goes to the hero; returns what was found, as words and pictures. */
export function bankReward(s: AdventureState, w: World, h: Hero, o: AdvObject): { text: string; components: Component[]; spell?: { name: string; why?: number } } {
  const found = bankOf(s, o);
  const components: Component[] = [];
  if (!found) return { text: "", components };
  const lvl = found.def.levels[found.bank.level];
  const got: string[] = [];
  let spell: { name: string; why?: number } | undefined;
  lvl.resources?.forEach((n, i) => {
    if (!n) return;
    s.players[h.owner].resources[i] += n;
    got.push(`${n} ${RESOURCE_NAMES[i]}`);
    components.push({ kind: "resource", id: i, amount: n });
  });
  for (const [creature, count] of lvl.creatures ?? []) {
    const name = w.creatures[creature]?.plural ?? "creatures";
    got.push(addToArmy(h, creature, count) ? `${count} ${name}` : `${count} ${name} (no room, they leave)`);
    components.push({ kind: "creature", id: creature, amount: count });
  }
  if (lvl.spells) {
    // Needs a spellbook and enough Wisdom (level 3 basic, 4 advanced, 5 expert).
    // (The Pyramid's spell, if the map chose one.)
    const pool = (w.data.spells ?? []).filter((sp) => sp.level === lvl.spells && sp.id < 70 && !h.spells?.includes(sp.id) && spellAllowed(s, sp.id));
    const given = w.data.spells?.find((sp) => sp.id === (o.data?.spell as number | undefined));
    const sp = given ?? (pool.length ? pool[randInt(s, 0, pool.length - 1)] : undefined);
    if (sp && h.spells && 2 + skillLevel(h.skills, "wisdom") >= sp.level) {
      h.spells.push(sp.id);
      got.push(`the spell ${sp.name}`);
      spell = { name: sp.name };
    } else {
      got.push("a spell your hero can't learn");
      if (sp) spell = { name: sp.name, why: h.spells ? 108 : 109 };
    }
    if (sp) components.push({ kind: "spell", id: sp.id });
  }
  // The Ruins (HotA): from the top of the tower the land around comes into view.
  if (lvl.reveal) reveal(s, w, h.owner, o.x, o.y, o.z, lvl.reveal);
  // (The bank's artifacts, each one the map's choice if it made one.)
  const chosen = (o.data?.artifacts as number[] | undefined) ?? [];
  for (const [i, cls] of [...(lvl.artifacts ?? []), ...(lvl.artifactIds ?? [])].entries()) {
    const ids = (chosen[i] ?? -1) >= 0 ? [chosen[i]] : typeof cls === "number" ? [cls] : randomArtifactPool(w.data.artifacts, ART_TIER[cls] ?? "T", s.banned?.artifacts);
    if (!ids.length) continue;
    const id = ids[randInt(s, 0, ids.length - 1)];
    giveArtifact(h, w.data.artifacts, id);
    got.push(w.data.artifacts[id]?.name ?? "an artifact");
    components.push({ kind: "artifact", id });
  }
  return { text: got.join(", "), components, spell };
}
export { MINE_INCOME };

function pos(w: World, i: number) {
  return { x: i % w.size, y: Math.floor(i / w.size) % w.size, z: Math.floor(i / (w.size * w.size)) };
}

const DIRS = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

function faceToward(h: Hero, dx: number, dy: number) {
  const d = DIRS.findIndex(([x, y]) => x === Math.sign(dx) && y === Math.sign(dy));
  if (d >= 0) h.dir = d;
}

export function heroesOf(s: AdventureState, player: number): Hero[] {
  return s.heroes.filter((h) => !h.removed && h.owner === player);
}

/** The player's heroes out on the map: the ones MAX_HEROES caps (a town's garrison hero doesn't count). */
export function mapHeroesOf(s: AdventureState, player: number): Hero[] {
  return heroesOf(s, player).filter((h) => h.garrison === undefined);
}

/** The battle a player is fighting (as attacker or defender), with its key in `s.battles`. */
export function battleFor(s: AdventureState, player: number): { key: number; pb: PendingBattle } | null {
  for (const [key, pb] of Object.entries(s.battles)) {
    if (Number(key) === player || pb.battle.sides.some((side) => side.owner === player)) return { key: Number(key), pb };
  }
  return null;
}

/** May this player act right now? */
export function canAct(s: AdventureState, player: number): boolean {
  if (s.winner !== undefined || !s.players[player]?.alive || battleFor(s, player)) return false;
  return s.turnMode === "simultaneous" ? !s.ended[player] : s.current === player;
}

/** Validates and applies an adventure action for `player`. */
export function applyAdventureAction(s: AdventureState, w: World, action: AdventureAction, player = s.current): AdventureEvent[] {
  if (!action || typeof action !== "object" || typeof action.type !== "string") throw new Refusal("not an action");
  if (battleFor(s, player)) throw new Refusal("finish the battle first");
  if (s.winner !== undefined) throw new Refusal("the game is over");
  // (A timed event's question comes at the day's start, perhaps in another player's turn: answered any time. So is a
  // level-up won defending in another's turn: chosen right after that battle, not when the turn comes round,
  // The owner 2026-11-02T23-50.)
  if (!canAct(s, player) && !((action.type === "answerScript" || action.type === "chooseSkill") && s.players[player]?.alive)) throw new Refusal(s.turnMode === "simultaneous" ? "you've ended your turn" : "not your turn");
  w.refresh(s);
  // Joiners nobody made room for are gone once the player does anything else.
  if (action.type !== "moveJoiners") for (const h of s.heroes) if (h.joiners && h.owner === player) dropJoiners(s, h);
  const events = applyAction(s, w, action, player);
  refreshMovement(s, w);
  checkGameEnd(s, w);
  return [...events, ...passIfOut(s, w)];
}

/** The player's switch for monoliths' exits in turn, as its move or visit carries it (absent: left as it was). */
function portalsSwitch(s: AdventureState, player: number, on: boolean | undefined) {
  const p = s.players[player];
  if (p && typeof on === "boolean") p.cyclicPortals = on || undefined;
}

/**
 * Why a hero can't dig where it stands, with the original's line for it (VCMI's diggingStatus,
 * GENRLTXT 56: not a whole day's movement; 60: at sea; 97: a hole or an object here), or null.
 */
export function cannotDig(s: AdventureState, w: World, h: Hero): { line: number; text: string } | null {
  if (h.movement < h.maxMovement) return { line: 56, text: lineText({ file: "genrltxt", id: 56 }) };
  if (h.boat !== undefined) return { line: 60, text: lineText({ file: "genrltxt", id: 60 }) };
  const here = w.index(h.x, h.y, h.z);
  if ((s.holes ?? []).includes(here) || w.visitBy[here]) return { line: 97, text: lineText({ file: "genrltxt", id: 97 }) };
  return null;
}

/** Knocked out on its own turn: the turn goes on to the next player (sequential play), or, the others
 *  having ended the day already, the next day comes (simultaneous play). */
export function passIfOut(s: AdventureState, w: World): AdventureEvent[] {
  if (s.winner !== undefined) return [];
  if (s.turnMode === "simultaneous") return waitingFor(s).length === 0 ? newDay(s, w) : [];
  if (s.players[s.current]?.alive) return [];
  return endTurn(s, w, s.current);
}

function applyAction(s: AdventureState, w: World, action: AdventureAction, player: number): AdventureEvent[] {
  switch (action.type) {
    case "move": {
      const h = yourHero(s, action.hero, player);
      if (h.garrison !== undefined) throw new Refusal("The hero is in the garrison.");
      portalsSwitch(s, player, action.cyclicPortals);
      const events = moveHero(s, w, action.hero, action.to, typeof action.steps === "number" && action.steps > 0 ? Math.floor(action.steps) : undefined, action.throughGarrisons === true);
      // (A human's goal, for an allied computer player to leave alone: kept until the hero is there.)
      if (s.players[player]?.controller === "human" && !h.removed && w.index(h.x, h.y, h.z) !== action.to) h.heading = action.to;
      else delete h.heading;
      return events;
    }
    case "visit":
      portalsSwitch(s, player, action.cyclicPortals);
      return revisit(s, w, action.hero, player);
    case "swapGarrison": {
      const o = yourTown(s, action.town, player);
      swapGarrisonHero(s, w, o);
      w.refresh(s);
      return [];
    }
    case "endTurn":
      return endTurn(s, w, player);
    case "moveStack":
      return moveStack(s, w, player, action);
    case "manaVortex": {
      const o = yourTown(s, action.town, player);
      // HotA: asked for, by the visiting hero only (heroes.thelazy.net Mana Vortex).
      const h = visitingHero(s, w, o);
      if (!h) throw new Refusal("A visiting hero must be in the town.");
      const week = Math.floor((s.day - 1) / 7);
      const why = manaVortexRefusal(o, h, week, maxMana);
      if (why) throw new Refusal(why);
      s.log.push(useManaVortex(o, h, week, maxMana).replace(/[{}]/g, "").replace(/\n+/g, " "));
      return [];
    }
    case "research":
    case "researchPick":
    case "researchFinalize": {
      const o = yourTown(s, action.town, player);
      if (action.type === "research") startResearch(s, w.data.spells ?? [], o, action.level, action.slot);
      else if (action.type === "researchPick") pickResearch(o, action.spell);
      else finalizeResearch(o);
      // A finalized spell is learned by the heroes in town at once.
      for (const h of [visitingHero(s, w, o), garrisonHero(s, o)]) if (h) learnFromGuild(s, w, h, o);
      return [];
    }
    case "buyMachine": {
      const o = yourTown(s, action.town, player);
      const why = cannotBuyMachine(s, w, o);
      if (why) throw new Refusal(why);
      const art = blacksmithMachine(o);
      const hero = visitingHero(s, w, o)!;
      initEquipment(hero);
      s.players[player].resources[6] -= machinePrice(w, art);
      hero.equipped![MACHINE_SLOT[art]] = art;
      return [];
    }
    case "dig": {
      const h = yourHero(s, action.hero, player);
      const why = cannotDig(s, w, h);
      if (why) throw new Refusal(why.text);
      const here = w.index(h.x, h.y, h.z);
      h.movement = 0;
      (s.holes ??= []).push(here);
      const g = s.grail;
      if (g && !g.found && g.x === h.x && g.y === h.y && g.z === h.z) {
        g.found = true;
        giveArtifact(h, w.data.artifacts, GRAIL_ARTIFACT);
        s.log.push(`${h.name} digs up the Grail!`);
        // GENRLTXT 58 and the Grail's name (VCMI's CGameHandler::dig).
        const grail = w.data.artifacts[GRAIL_ARTIFACT]?.name ?? "Grail";
        return [{ e: "visit", hero: h.id, object: -1, message: lineText({ file: "genrltxt", id: 58, more: [grail] }), text: { file: "genrltxt", id: 58, more: [grail] }, components: [{ kind: "artifact", id: GRAIL_ARTIFACT }], sound: "ULTIMATEARTIFACT" }];
      }
      return [{ e: "visit", hero: h.id, object: -1, message: lineText({ file: "genrltxt", id: 59 }), text: { file: "genrltxt", id: 59 }, sound: "DIGSOUND" }];
    }
    case "castSpell": {
      const h = yourHero(s, action.hero, player);
      const spell = w.data.spells?.[action.spell];
      if (!spell) throw new Refusal("unknown spell");
      const said = castAdventureSaid(s, w, h, spell, action.target);
      s.log.push(`${h.name} casts ${spell.name}.`);
      const out: AdventureEvent[] = [{ e: "spell", hero: h.id, spell: spell.id, message: said.text, ...(said.ref ? { text: said.ref } : {}) }];
      // HotA: landing by Dimension Door in a monster's zone starts the fight (the mod's dimensionDoorTriggersGuards).
      const guard = spell.id === SPELL.DIMENSION_DOOR ? w.guardedBy[action.target ?? -1] : 0;
      if (guard) out.push(...meetMonster(s, w, h, s.objects[guard - 1]));
      return out;
    }
    case "exchangeAll":
      return exchangeAll(s, w, player, action);
    case "transfer":
      return transfer(s, w, player, action);
    case "equip": {
      const h = yourHero(s, action.hero, player);
      moveArtifact(w.data.artifacts, h, action.from, h, action.to);
      return [];
    }
    case "assemble":
    case "disassemble": {
      const h = yourHero(s, action.hero, player);
      if (action.type === "assemble") assemble(w.data.artifacts, h, action.artifact);
      else disassemble(h, action.slot);
      return [];
    }
    case "buySpellbook": {
      const h = yourHero(s, action.hero, player);
      if (h.spells) throw new Refusal("already has a spellbook");
      const town = s.objects.find((o) => o.town && o.owner === player && guildLevel(o) > 0 && w.visitBy[w.index(h.x, h.y, h.z)] === o.id + 1);
      if (!town) throw new Refusal("spellbooks are sold in towns with a mage guild");
      if (s.players[player].resources[6] < SPELLBOOK_COST) throw new Refusal(`a spellbook costs ${SPELLBOOK_COST} gold`);
      s.players[player].resources[6] -= SPELLBOOK_COST;
      h.spells = [];
      initEquipment(h);
      learnFromGuild(s, w, h, town);
      return [];
    }
    case "chooseSkill": {
      const h = s.heroes[action.hero];
      if (h?.owner !== player || !h.levelUps?.length) throw new Refusal("no skill to choose");
      const offer = h.levelUps.shift()!;
      h.levelUpPrimary?.shift();
      s.log.push(...chooseSkill(s, w, h, offer, action.option));
      refreshLevelUps(s, w, h);
      return [];
    }
    case "buildBoat":
      return buildBoat(s, w, player, action.object);
    case "giveResources": {
      const at = (h: Hero) => objectBeside(s, w, h);
      const post = s.heroes.some((h) => h.owner === player && !h.removed && [99, 221].includes(at(h)?.type ?? -1));
      if (!marketCount(s, player) && !post) throw new Refusal("you need a Marketplace");
      const to = s.players[action.to];
      if (!to?.alive || action.to === player) throw new Refusal("no such player to give to");
      const res = s.players[player].resources;
      if (!Number.isInteger(action.resource) || action.resource < 0 || action.resource > 6) throw new Refusal("no such resource");
      if (!Number.isInteger(action.amount) || action.amount <= 0 || action.amount > res[action.resource]) throw new Refusal("not that much to give");
      res[action.resource] -= action.amount;
      to.resources[action.resource] += action.amount;
      s.log.push(`${PLAYER_NAMES[player] ?? "A player"} sends ${action.amount} ${RESOURCE_NAMES[action.resource]} to ${PLAYER_NAMES[action.to] ?? "another player"}.`);
      return [];
    }
    case "trade": {
      // A hero at a Trading Post gets five marketplaces' rates.
      const at = (h: Hero) => objectBeside(s, w, h);
      const mine = s.heroes.filter((h) => h.owner === player && !h.removed);
      const post = mine.some((h) => [99, 221].includes(at(h)?.type ?? -1));
      // Warlock's Lab (HotA): mercury, sulfur, crystal and gems one for one.
      const lab = mine.some((h) => at(h)?.type === 144 && at(h)?.subid === 9);
      if (lab && PRECIOUS.includes(action.from) && PRECIOUS.includes(action.to) && action.from !== action.to) {
        const res = s.players[player].resources;
        if (!Number.isInteger(action.lots) || action.lots <= 0 || res[action.from] < action.lots) throw new Refusal("not enough to trade");
        res[action.from] -= action.lots;
        res[action.to] += action.lots;
        return [];
      }
      trade(s, player, action.from, action.to, action.lots, post ? 5 : 0);
      return [];
    }
    case "castleGate": {
      const h = s.heroes[action.hero];
      const o = s.objects[action.town];
      if (h?.owner !== player || h.removed || !o?.town || visitingHero(s, w, o) !== h) throw new Refusal("the hero must be in the town");
      if (o.owner !== player && !allied(s, o.owner, player)) throw new Refusal("not a friendly town");
      const dest = castleGateTowns(s, o, (t) => visitTile(w, t) >= 0 && !w.heroAt[visitTile(w, t)], player).find((t) => t.id === action.to);
      if (!dest) throw new Refusal("You can't go there.");
      const to = visitTile(w, dest);
      [h.x, h.y, h.z] = [to % w.size, Math.floor(to / w.size) % w.size, Math.floor(to / (w.size * w.size))];
      reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
      w.refresh(s);
      s.log.push(`${h.name} passes through the Castle Gate to ${dest.name ?? "town"}.`);
      return [{ e: "teleport", hero: h.id, object: o.id, to }];
    }
    case "bankLoan": {
      const o = s.objects[action.town];
      const why = o ? cannotBorrow(o, player) : "no Bank here";
      if (why) throw new Refusal(why);
      (o.data ??= {}).loanDays = BANK_LOAN.days;
      s.players[player].resources[6] += BANK_LOAN.gold;
      s.log.push(`The Bank lends ${BANK_LOAN.gold} gold.`);
      return [];
    }
    case "moveJoiners":
      return moveJoiners(s, w, player, action);
    case "closeJoiners":
      // (Cleared above, as for any other action.)
      return [];
    case "answerOffer": {
      const h = s.heroes[action.hero];
      if (h?.owner !== player || h.removed || !h.offer) throw new Refusal("no offer to answer");
      const offer = h.offer;
      delete h.offer;
      const o = s.objects[offer.object];
      // (A script's question goes on even when its object is gone: a box opened, a guard left.)
      if (!o || (o.removed && offer.kind !== "script")) return [];
      return resolveOffer(s, w, h, o, offer, action.accept, action.option);
    }
    case "answerScript":
      if (!s.players[player]?.script) throw new Refusal("no question to answer");
      return answerPlayerScript(s, w, player, action.accept, action.option);
    case "cheat": {
      if (typeof action.code !== "string") throw new Refusal("no such cheat");
      const h = action.hero !== undefined ? s.heroes[action.hero] : undefined;
      const t = action.town !== undefined ? s.objects[action.town] : undefined;
      const msg = applyCheat(s, w, player, action.code, h?.owner === player && !h.removed ? h : undefined, t);
      if (msg === null) return [];
      return msg ? [{ e: "message", player, text: msg }] : [];
    }
    case "heroSettings": {
      const h = yourHero(s, action.hero, player);
      if (action.tight !== undefined) h.tight = action.tight || undefined;
      if (action.tactics !== undefined) h.noTactics = !action.tactics || undefined;
      return [];
    }
    case "dismiss": {
      const h = yourHero(s, action.hero, player);
      const towns = s.objects.some((o) => o.town && !o.removed && o.owner === player);
      if (!towns && heroesOf(s, player).length <= 1) throw new Refusal("You can't dismiss your last hero without a town.");
      if (h.boat !== undefined) throw new Refusal("A hero can't be dismissed at sea.");
      if (isMissionCritical(s, h.id)) throw new Refusal("The map needs this hero: dismissing it would lose the game.");
      h.removed = true;
      h.retired = true;
      h.army = [];
      s.log.push(`${h.name} is dismissed.`);
      w.refresh(s);
      checkGameEnd(s, w);
      return [];
    }
    case "dismissStack": {
      const h = action.hero !== undefined ? s.heroes[action.hero] : undefined;
      const o = action.town !== undefined ? s.objects[action.town] : undefined;
      if (h ? h.owner !== player || h.removed : !o?.town || o.owner !== player) throw new Refusal("not yours");
      const army = h ? h.army : o!.town!.garrison;
      if (!army[action.slot]) throw new Refusal("nothing to dismiss");
      if (h && army.filter((x) => x).length <= 1) throw new Refusal("a hero needs at least one stack");
      army[action.slot] = null;
      return [];
    }
    case "sleep": {
      const h = yourHero(s, action.hero, player);
      h.asleep = action.asleep || undefined;
      return [];
    }
    case "buyArtifact":
    case "sellStack":
    case "transform":
    case "townGate":
    case "sellArtifact":
    case "sacrifice":
    case "hireAt": {
      const h = yourHero(s, action.hero, player);
      const o = s.objects[action.object];
      if (!o) throw new Refusal("nothing there");
      if (!heroAtObject(w, h, o)) throw new Refusal("the hero must be there");
      const res = s.players[player].resources;
      if (action.type !== "hireAt") return tradeAt(s, w, player, h, o, action);
      // Hiring at a map tavern: the new hero appears on a free tile around it.
      const type = tavernOffer(s, player, w.data.classTavernOdds)[action.slot];
      if (type === undefined) throw new Refusal("nobody to hire");
      const why = cannotHireAt(s, w, h, player);
      if (why) throw new Refusal(why);
      const spot = freeTileNear(w, h.x, h.y, h.z);
      res[6] -= HERO_COST;
      const hired = hireFromTavern(s, w, player, action.slot, pos(w, spot));
      w.refresh(s);
      // (The new hero just appears: the original says nothing.)
      return [{ e: "visit", hero: hired.id, object: o.id, message: "" }];
    }
    case "buyMachineAt":
    case "learnSkill":
    case "upgradeStack": {
      const h = yourHero(s, action.hero, player);
      const o = s.objects[action.object];
      if (!o) throw new Refusal("nothing there");
      if (!heroAtObject(w, h, o)) throw new Refusal("the hero must be there");
      if (action.type === "buyMachineAt") return buyMachineAt(s, w, h, o, action.artifact, player);
      if (action.type === "learnSkill") return learnSkillAt(s, w, h, o, action.skill, player);
      return upgradeAtHillFort(s, w, h, o, action.slot, player);
    }
    case "recruitDwelling":
      return recruitDwelling(s, w, yourHero(s, action.hero, player), s.objects[action.object], action.slot, action.count);
    case "recruitPortal": {
      const o = s.objects[action.town];
      if (!o?.town || o.owner !== player || !hasSpecial(o, "dungeon", SPECIAL.s3)) throw new Refusal("no Portal of Summoning here");
      const portal = o.data?.portal as { creature: number; available: number } | undefined;
      if (!portal || action.count < 1 || action.count > portal.available) throw new Refusal("not that many available");
      const c = w.creatures[portal.creature];
      const res = s.players[player].resources;
      const cost = c.cost.map((n) => n * action.count);
      if (!canPay(cost, res)) throw new Refusal(SHORT_OF_RESOURCES);
      if (!addRecruits(s, w, o, portal.creature, action.count)) throw new Refusal("No free army slot.");
      cost.forEach((n, i) => (res[i] -= n));
      portal.available -= action.count;
      return [];
    }
    case "build":
    case "recruit":
    case "upgradeInTown":
    case "hireHero":
    case "takeGarrison": {
      const o = yourTown(s, action.town, player);
      if (action.type === "upgradeInTown") {
        upgradeInTown(s, w, o, action.who, action.slot);
        return [];
      }
      if (action.type === "hireHero") return hireHero(s, w, o, action.slot);
      if (action.type === "build") {
        build(s, w, o, action.building);
        // A new guild level (or the Library) teaches the heroes in the town at once, as the original.
        for (const h of [visitingHero(s, w, o), garrisonHero(s, o)]) if (h) learnFromGuild(s, w, h, o);
        if (hasSpecial(o, "dungeon", SPECIAL.s3) && action.building === SPECIAL.s3) rollPortal(s, w, o);
        // A bonus building (Hall of Valhalla, Battle Academy, Stables...) gives the heroes in the town its gift at once,
        // with its message, as VCMI's buildStructure visits them.
        const gifts: AdventureEvent[] = [];
        for (const h of [visitingHero(s, w, o), garrisonHero(s, o)])
          if (h)
            for (const g of visitTownSpecials(s, o, h, { maxMana, gainExperience: (x, xp) => gainExperience(s, w, x, xp) }, action.building)) {
              s.log.push(g.message.replace(/[{}]/g, "").replace(/\n+/g, " "));
              gifts.push({ e: "visit", hero: h.id, object: o.id, ...g });
            }
        return [{ e: "built", object: o.id, building: action.building }, ...gifts];
      }
      if (action.type === "recruit") {
        recruit(s, w, o, action.level, action.upgraded, action.count, action.second);
        return [];
      }
      const hero = visitingHero(s, w, o);
      if (!hero) throw new Refusal("no hero in town");
      takeGarrison(o, hero);
      return [];
    }
    default:
      throw new Refusal(`unknown action ${(action as { type: unknown }).type}`);
  }
}

export const BOAT_COST = [10, 0, 0, 0, 0, 0, 1000];
/** HotA's Airship Yard (shipyard subtype 1) builds airships for 5000 gold and 20 wood (heroes.thelazy.net Airship Yard). */
export const AIRSHIP_COST = [20, 0, 0, 0, 0, 0, 5000];
export const isAirshipYard = (o: AdvObject) => o.type === Obj.SHIPYARD && o.subid === 1;
export const boatCost = (o: AdvObject) => (isAirshipYard(o) ? AIRSHIP_COST : BOAT_COST);

/** Where a shipyard (map object or town) puts its boats: the nearest free water tile by its entrance (an airship: clear land). */
export function boatSpot(s: AdventureState, w: World, o: AdvObject): number {
  const gate = visitTile(w, o);
  if (gate < 0) return -1;
  const gx = gate % w.size;
  const gy = Math.floor(gate / w.size) % w.size;
  let best = -1;
  let bestD = Infinity;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const i = w.index(gx + dx, gy + dy, o.z);
      if (i < 0 || (isAirshipYard(o) ? !airshipStop(w, s, i) : w.map.tiles[i].terrain !== Terrain.WATER || w.blocked(i) || w.visitBy[i] || w.heroAt[i])) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) [best, bestD] = [i, d];
    }
  }
  return best;
}

/** Why a boat can't be built here right now (or null). */
export function cannotBuildBoat(s: AdventureState, w: World, o: AdvObject | undefined, player: number): string | null {
  if (!o || o.owner !== player) return "Not your shipyard.";
  if (o.town && !o.town.built.includes(B.SHIPYARD)) return "Build a Shipyard first.";
  if (!o.town && o.type !== Obj.SHIPYARD) return "Not a shipyard.";
  if (boatSpot(s, w, o) < 0) return isAirshipYard(o) ? "There's no clear ground for an airship." : "There's no free water for a boat.";
  if (boatCost(o).some((c, i) => s.players[player].resources[i] < c)) return isAirshipYard(o) ? AIRSHIP_PRICE : BOAT_PRICE;
  return null;
}

export const BOAT_PRICE = "A boat costs 10 Wood and 1000 Gold.";
export const AIRSHIP_PRICE = "An airship costs 20 Wood and 5000 Gold.";

/**
 * The boat a shipyard builds (its subtype, the map's boat object): a town's by its faction's alignment, as
 * VCMI's factions' "boat" (good towns the white sails, evil ones the black, neutral ones the brown; HotA's
 * Cove, Conflux and Bulwark their own), a shipyard on the map HotA's neutral boat (heroes3DataPatch
 * objects.json "boatNeutral"). The owner 2026-11-01: his Fortress built the Necropolis boat.
 */
const BOAT_OF_FACTION: Record<string, number> = { castle: 1, rampart: 1, tower: 1, factory: 1, inferno: 0, necropolis: 0, dungeon: 0, stronghold: 2, fortress: 2, conflux: 5, cove: 3, bulwark: 6 };
/** HotA's boats' map pictures, which objects.txt lacks (mapDecorations, cove and bulwark boats.json). */
const HOTA_BOAT_PICTURES: Record<number, string> = { 3: "avxboat4.def", 4: "avxboat5.def", 5: "avxboat6.def", 6: "ab07_002.def" };
export function boatKind(o: AdvObject): number {
  if (!o.town) return 4;
  return BOAT_OF_FACTION[TOWNS[o.subid]?.faction ?? ""] ?? 2;
}

export function buildBoat(s: AdventureState, w: World, player: number, objectId: number): AdventureEvent[] {
  const o = s.objects[objectId];
  const why = cannotBuildBoat(s, w, o, player);
  if (why) throw new Refusal(why);
  const spot = boatSpot(s, w, o);
  const air = isAirshipYard(o);
  const kind = air ? AIRSHIP : boatKind(o);
  const own = w.data.templates.find((x) => x.id === Obj.BOAT && x.subid === kind);
  const t = own ?? w.data.templates.find((x) => x.id === Obj.BOAT && (!air || x.subid === AIRSHIP)) ?? w.data.templates.find((x) => x.id === Obj.BOAT);
  if (!t) throw new Refusal("no boat template");
  const v = visitOffset(t.visitMask) ?? [-1, 0];
  const x = spot % w.size;
  const y = Math.floor(spot / w.size) % w.size;
  boatCost(o).forEach((c, i) => (s.players[player].resources[i] -= c));
  // (The airship's map picture, as the HotA maps place it, when the game's object list lacks it.)
  const hota = !air && !own ? HOTA_BOAT_PICTURES[kind] : undefined;
  const def = air && t.subid !== AIRSHIP ? "avxair00.def" : (hota ?? t.def);
  s.objects.push({ id: s.objects.length, type: Obj.BOAT, subid: air ? AIRSHIP : hota ? kind : t.subid, def, x: x - v[0], y: y - v[1], z: o.z, block: t.blockMask, visit: t.visitMask, flat: false, owner: -1 });
  w.refresh(s);
  s.log.push(air ? "An airship is built." : "A boat is built.");
  return [];
}

export const HERO_COST = 2500;
export const MAX_HEROES = 8;

/** Why this town can't hire a hero right now (or null). */
/** A HotA map may forbid a player hiring heroes (its specifications' per-player option). */
const NO_HIRING = "Hiring heroes is not allowed on this map.";
const hiringBanned = (w: World, player: number) => !!w.map.hotaOptions?.hiringBanned?.[player];

export function cannotHire(s: AdventureState, w: World, o: AdvObject): string | null {
  if (hiringBanned(w, o.owner)) return NO_HIRING;
  if (!o.town?.built.includes(B.TAVERN)) return "Build a Tavern first.";
  if (mapHeroesOf(s, o.owner).length >= MAX_HEROES) return `You already have ${MAX_HEROES} heroes on the map.`;
  if (visitingHero(s, w, o)) return "A hero is standing in the town gate.";
  if (s.players[o.owner].resources[6] < HERO_COST) return `A hero costs ${HERO_COST} gold.`;
  // (Every hero of the map hired, imprisoned or banned already.)
  if (!tavernOffer(s, o.owner, w.data.classTavernOdds).length) return "the tavern is empty";
  return null;
}

/** Why the player can't hire a hero at this Tavern on the map, beside their hero `h`; null when they can. */
export function cannotHireAt(s: AdventureState, w: World, h: Hero, player: number): string | null {
  if (hiringBanned(w, player)) return NO_HIRING;
  if (s.players[player].resources[6] < HERO_COST) return `Heroes cost ${HERO_COST} gold.`;
  if (mapHeroesOf(s, player).length >= MAX_HEROES) return "You can't have more than eight heroes on the map.";
  if (freeTileNear(w, h.x, h.y, h.z) < 0) return "There's no room for another hero here.";
  return null;
}

/**
 * A tavern's hero joins the player on a tile: one who retreated, surrendered or was dismissed comes back
 * as they were (one creature of their first stack if they kept no army), a new one with the slot's army;
 * the other slot's hero stays, and a new one takes the hired one's place (VCMI's HeroPoolProcessor::hireHero).
 */
function hireFromTavern(s: AdventureState, w: World, player: number, slot: number, at: { x: number; y: number; z: number }): Hero {
  const type = s.players[player].tavern![slot];
  const back = s.heroes.find((x) => x.removed && x.retired && x.type === type);
  let h: Hero;
  if (back) {
    h = back;
    const army = tavernArmy(s, player, slot);
    Object.assign(h, { removed: false, retired: false, owner: player, ...at, boat: undefined, army });
  } else {
    h = makeHero(s, w.data, type, player, at.x, at.y, at.z, tavernArmy(s, player, slot));
    customizeHero(h, w.data, w.map.heroCustom?.[type]);
    s.heroes.push(h);
    startingKit(h);
    catchUpLevels(s, w, h);
  }
  startDay(w, s, h);
  h.mana = Math.max(h.mana ?? 0, maxMana(h));
  tavernHired(s, player, slot, w.data.classTavernOdds);
  return h;
}

function hireHero(s: AdventureState, w: World, o: AdvObject, slot: number): AdventureEvent[] {
  const why = cannotHire(s, w, o);
  if (why) throw new Refusal(why);
  const offer = tavernOffer(s, o.owner, w.data.classTavernOdds);
  if (!offer.length) throw new Refusal("the tavern is empty");
  const type = offer[slot];
  if (type === undefined) throw new Refusal("no such hero in the tavern");
  // The hero appears in the town gate (the visitable tile).
  let gate: { x: number; y: number } | undefined;
  o.visit.forEach((b, i) => {
    for (let j = 0; j < 8; j++) if (b & (1 << j)) gate ??= { x: o.x + j - 7, y: o.y + i - 5 };
  });
  if (!gate) throw new Refusal("this town has no gate");
  const h = hireFromTavern(s, w, o.owner, slot, { x: gate.x, y: gate.y, z: o.z });
  learnFromGuild(s, w, h, o);
  s.players[o.owner].resources[6] -= HERO_COST;
  reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
  w.refresh(s);
  s.log.push(`${h.name} is hired in ${o.name ?? "the town"}.`);
  // (The new hero just appears: the original says nothing.)
  return [{ e: "visit", hero: h.id, object: o.id, message: "" }];
}

/** Moves the town's garrison into the visiting hero where slots allow. */
function takeGarrison(o: AdvObject, h: Hero) {
  const g = o.town!.garrison;
  g.forEach((slot, i) => {
    if (!slot) return;
    const same = h.army.findIndex((x) => x?.creature === slot.creature);
    const free = h.army.findIndex((x) => !x);
    if (same >= 0) h.army[same]!.count += slot.count;
    else if (free >= 0) h.army[free] = slot;
    else return;
    g[i] = null;
  });
}

/**
 * Is the hero at this object: on its entrance (a town's gate) or, as blocking objects are visited
 * from the tile before, right next to it.
 */
export function heroAtObject(w: World, h: Hero, o: AdvObject): boolean {
  const here = w.index(h.x, h.y, h.z);
  if (w.visitBy[here] === o.id + 1) return true;
  if (o.z !== h.z) return false;
  const v = visitTile(w, o);
  if (v < 0) return false;
  const vx = v % w.size;
  const vy = Math.floor(v / w.size) % w.size;
  return Math.abs(vx - h.x) <= 1 && Math.abs(vy - h.y) <= 1;
}

/** The object the hero stands at (its entrance, or beside it): what a market action is about. */
function objectBeside(s: AdventureState, w: World, h: Hero): AdvObject | undefined {
  const on = s.objects[w.visitBy[w.index(h.x, h.y, h.z)] - 1];
  if (on) return on;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const i = w.index(h.x + dx, h.y + dy, h.z);
      const o = i >= 0 ? s.objects[w.visitBy[i] - 1] : undefined;
      if (o && !o.removed && !o.town) return o;
    }
  return undefined;
}

/** The object whose entrance the hero stands on (a town's gate, a mine's door...), if any. */
export function objectUnder(s: AdventureState, w: World, h: Hero): AdvObject | undefined {
  const i = w.index(h.x, h.y, h.z);
  const o = i >= 0 && w.visitBy[i] ? s.objects[w.visitBy[i] - 1] : undefined;
  return o && !o.removed && o.carriedBy === undefined && o.type !== Obj.BOAT ? o : undefined;
}

/** The player's hero (still in the game), or a refusal. */
function yourHero(s: AdventureState, id: number, player: number): Hero {
  const h = s.heroes[id];
  if (!h || h.removed || h.owner !== player) throw new Refusal("not your hero");
  return h;
}

/** The player's town, or a refusal. */
function yourTown(s: AdventureState, id: number, player: number): AdvObject {
  const o = s.objects[id];
  if (!o?.town || o.owner !== player) throw new Refusal("not your town");
  return o;
}

/** Space: the hero visits again the object it stands on. */
function revisit(s: AdventureState, w: World, heroId: number, player: number): AdventureEvent[] {
  const h = yourHero(s, heroId, player);
  if (h.garrison !== undefined) throw new Refusal("The hero is in the garrison.");
  const o = objectUnder(s, w, h);
  if (!o) throw new Refusal("nothing to visit here");
  return visit(s, w, h, o);
}

function moveHero(s: AdventureState, w: World, heroId: number, target: number, steps?: number, throughGarrisons = false): AdventureEvent[] {
  const h = s.heroes[heroId];
  if (!h || h.removed) throw new Refusal("no such hero");
  // (The player's own garrisons walked through, not stopped at, when they asked: the route they were shown.)
  const through = throughGarrisons ? (i: number) => garrisonPass(w, s, h, i) : undefined;
  // A player's hero takes the route they were shown, over explored ground, when there is one.
  let paths = findPaths(w, s, h, s.players[h.owner]?.controller === "human", through);
  let path = mapPathTo(paths, target);
  if (path.length < 2) path = mapPathTo((paths = findPaths(w, s, h, false, through)), target);
  if (path.length < 2) throw new Refusal("no path");
  if (paths.get(target)?.passOnly) throw new Refusal("can't stop there");

  const events: AdventureEvent[] = [];
  const walked = [path[0]];
  // The steps so far, shown before whatever stops or interrupts the walk.
  const showWalked = () => {
    if (walked.length > 1) events.push({ e: "move", hero: h.id, path: walked.slice() });
  };
  // Out of movement over water or an obstacle (Fly / Water Walk): back to the last solid ground.
  const settle = () => {
    while (walked.length > 1 && paths.get(walked[walked.length - 1])?.passOnly) walked.pop();
    const last = walked[walked.length - 1];
    [h.x, h.y] = [last % w.size, Math.floor(last / w.size) % w.size];
  };
  for (let k = 1; k < path.length; k++) {
    // Walked as far as asked (and standing where a hero can stop: not over water or an obstacle).
    if (steps !== undefined && walked.length > steps && !paths.get(path[k - 1])?.passOnly) break;
    const from = pos(w, path[k - 1]);
    const to = pos(w, path[k]);
    const price = stepPrice(w, s, h, from, to, h.movement);
    if (price < 0) break;
    // Aboard an airship: fly over everything; the last step, from a stop over clear land onto clear
    // land, is the landing (the airship stays where the hero stepped down).
    if (h.airship) {
      const land = k === path.length - 1 && !paths.get(path[k])?.passOnly && !paths.get(path[k - 1])?.passOnly;
      if (!land) {
        faceToward(h, to.x - from.x, to.y - from.y);
        h.movement -= price;
        [h.x, h.y] = [to.x, to.y];
        walked.push(path[k]);
        reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
        continue;
      }
    }
    // Over water or an obstacle (Fly / Water Walk) a hero can't stop, so it can't fight, visit or
    // meet anyone from there either: back to solid ground instead.
    if (k > 1 && paths.get(path[k - 1])?.passOnly && isStop(w, s, path[k])) {
      settle();
      showWalked();
      return events;
    }
    // Another player's hero: attack it from here.
    const other = w.heroAt[path[k]] ? s.heroes[w.heroAt[path[k]] - 1] : undefined;
    // An ally's hero: no fight; the hero stops beside it.
    if (other && allied(s, other.owner, h.owner)) {
      settle();
      showWalked();
      return events;
    }
    if (other && other.owner !== h.owner) {
      // Over water or an obstacle (Fly / Water Walk) a hero can't stop, so can't attack from there either.
      if (paths.get(path[k - 1])?.passOnly) {
        settle();
        showWalked();
        return events;
      }
      faceToward(h, to.x - from.x, to.y - from.y);
      showWalked();
      events.push(...attackHero(s, w, h, other));
      return events;
    }
    if (other) {
      // One of our own heroes: stop beside them and meet (trade troops and artifacts).
      showWalked();
      walked.length = 1;
      if (other.owner === h.owner) {
        scholarTrade(s, w, h, other);
        events.push({ e: "meet", hero: h.id, other: other.id });
      }
      return events;
    }
    // Boarding a boat or coming ashore takes the rest of the day's movement.
    const boat = h.boat === undefined ? boatAt(w, s, path[k]) : undefined;
    const ashore = h.boat !== undefined && (h.airship || w.map.tiles[path[k]].terrain !== Terrain.WATER);
    if (boat || ashore) {
      faceToward(h, to.x - from.x, to.y - from.y);
      // The Admiral's Hat: what's left of the day carries over, scaled to the new pool.
      // Both pools as the day began, so swapping troops or boots on the way gains nothing (dayPool).
      const keep = hasBonus(h, "FREE_SHIP_BOARDING") ? (h.movement - price) / Math.max(1, dayPool(w, s, h, sailing(h))) : 0;
      if (boat) {
        h.boat = boat.id;
        boat.carriedBy = h.id;
        if (isAirship(boat)) h.airship = true;
        s.log.push(`${h.name} boards ${h.airship ? "an airship" : "a boat"}.`);
      } else {
        // The boat stays at the shore, where the hero left it.
        const b = s.objects[h.boat!];
        const v = visitOffset(b.visit) ?? [-1, 0];
        [b.x, b.y, b.z] = [from.x - v[0], from.y - v[1], from.z];
        b.dir = h.dir;
        delete b.carriedBy;
        // The player's boat now (Summon Boat calls it first).
        (b.data ??= {}).boatOf = h.owner;
        s.log.push(`${h.name} ${h.airship ? "lands" : "comes ashore"}.`);
        h.boat = undefined;
        delete h.airship;
      }
      [h.x, h.y] = [to.x, to.y];
      walked.push(path[k]);
      h.maxMovement = maxMovement(w, h);
      h.movement = Math.floor(keep * dayPool(w, s, h, sailing(h)));
      reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
      events.push({ e: "move", hero: h.id, path: walked });
      w.refresh(s);
      // A map event on the shore fires as the hero lands.
      const landed = w.visitable(s, path[k]);
      if (landed?.type === Obj.EVENT) events.push(...visit(s, w, h, landed));
      return events;
    }
    const obj = w.visitable(s, path[k]);
    // A hero walks onto an object's entrance (a town's gate, a windmill's door...) and visits it
    // there; monsters, pickups and the like are visited from the tile before (movement.ts blockVisit).
    const steppable = !obj || !w.blockedBy[path[k]] || entersToVisit(obj);
    faceToward(h, to.x - from.x, to.y - from.y);
    h.movement -= price;
    if (steppable) {
      h.x = to.x;
      h.y = to.y;
      walked.push(path[k]);
      reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
    }
    // A map event (invisible) stops the walk only if it fires for this player. One on water fires only
    // for a boat: HotA 1.5.0 "Water events now won't trigger while passing over them using Fly or Water Walk".
    if (obj?.type === Obj.EVENT && !w.guardedBy[path[k]] && h.boat === undefined && w.map.tiles[path[k]].terrain === Terrain.WATER) continue;
    if (obj?.type === Obj.EVENT && !w.guardedBy[path[k]]) {
      const fired = visit(s, w, h, obj);
      if (!fired.length && k < path.length - 1) continue;
      showWalked();
      events.push(...fired);
      return events;
    }
    // One of the player's own garrisons on the way, not the walk's end (EXTRAS throughGarrisons): walked through.
    // (Its gate is visited from the tile before, so the hero steps onto it here, as the visit would, and on.)
    if (obj && through && k < path.length - 1 && through(path[k])) {
      if (!steppable) {
        [h.x, h.y] = [to.x, to.y];
        walked.push(path[k]);
        reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
      }
      continue;
    }
    if (obj || w.guardedBy[path[k]]) {
      showWalked();
      walked.length = 0;
      // A guarding monster attacks before anything in its zone can be visited.
      const guard = w.guardedBy[path[k]] ? s.objects[w.guardedBy[path[k]] - 1] : undefined;
      if (guard && guard !== obj) events.push(...meetMonster(s, w, h, guard));
      else if (obj) events.push(...visit(s, w, h, obj));
      return events;
    }
  }
  settle();
  if (walked.length > 1) events.push({ e: "move", hero: h.id, path: walked });
  return events;
}

/** A hero visits a map object (exported for tests). */
/** Two different players on the same team. */
export function allied(s: AdventureState, a: number, b: number): boolean {
  const ta = s.players[a]?.team;
  return a !== b && ta !== undefined && ta === s.players[b]?.team;
}

export const GRAIL_ARTIFACT = 2;

/** Daily resources from artifacts: [resource, amount] (Cornucopia: four of each rare resource). */
const RESOURCE_ARTIFACTS: Record<number, [number, number][]> = {
  109: [[4, 1]], 110: [[5, 1]], 111: [[1, 1]], 112: [[2, 1]], 113: [[3, 1]], 114: [[0, 1]],
  115: [[6, 1000]], 116: [[6, 750]], 117: [[6, 500]], 140: [[1, 4], [3, 4], [4, 4], [5, 4]],
};

/** Base creature -> its upgrade, from the towns' dwellings. */
export const UPGRADE_OF: Record<number, number> = Object.fromEntries(
  TOWNS.flatMap((t) => t?.creatures ?? []).filter(([base, up]) => base !== undefined && up !== undefined && base !== up).map(([base, up]) => [base, up]),
);

/** Scholar: meeting heroes teach each other spells up to level 2 / 3 / 4 (if the learner's Wisdom allows). */
function scholarTrade(s: AdventureState, w: World, a: Hero, b: Hero) {
  const level = Math.max(skillLevel(a.skills, "scholar"), skillLevel(b.skills, "scholar"));
  if (!level || !a.spells || !b.spells) return;
  for (const [from, to] of [[a, b], [b, a]] as const) {
    for (const id of from.spells!) {
      const sp = w.data.spells?.[id];
      if (!sp || to.spells!.includes(id) || sp.level > level + 1 || sp.level > 2 + skillLevel(to.skills, "wisdom")) continue;
      to.spells!.push(id);
      s.log.push(`${to.name} learns ${sp.name} from ${from.name}.`);
    }
  }
}

/**
 * What a player's kingdom makes in a day: mines (abandoned ones too, once cleared), towns, the
 * heroes' Estates, specialties and artifacts, and creatures that make resources (HotA's Kobolds),
 * in any army or garrison. The kingdom overview's total is its gold (VCMI's CKingdomInterface).
 */
export function dailyIncome(s: AdventureState, w: World, player: number): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const o of s.objects) {
    if (o.removed || o.owner !== player) continue;
    if (o.type === Obj.MINE && o.subid < 7) out[o.subid] += MINE_INCOME[o.subid];
    const lost = abandonedMine(s, w, o);
    if (lost?.cleared) out[lost.resource] += MINE_INCOME[lost.resource];
    if (o.town) townIncome(o).forEach((n, i) => (out[i] += n));
  }
  for (const h of s.heroes) {
    if (h.removed || h.owner !== player) continue;
    out[6] += Math.floor(ESTATES[skillLevel(h.skills, "estates")] * skillFactor(h, "estates"));
    // Specialty income (e.g. 350 gold or a gem a day).
    specialtyIncome(h).forEach((n, i) => (out[i] += n));
    // Artifacts that make resources every day.
    for (const a of wornArtifacts(h)) for (const [r, n] of RESOURCE_ARTIFACTS[a] ?? []) out[r] += n;
    out[6] += bonus(h, "GENERATE_RESOURCE", "gold");
  }
  // Creatures that make resources (HotA Kobolds: a gold each a day), in any army or garrison.
  for (const a of ownedArmies(s, player))
    for (const x of a) {
      if (!x) continue;
      for (const b of w.creatures[x.creature]?.abilities ?? []) if (b.type === "GENERATE_RESOURCE") out[RESOURCES.includes(b.subtype ?? "") ? RESOURCES.indexOf(b.subtype!) : 6] += (b.val ?? 0) * x.count;
    }
  return out;
}

/** Every army a player owns: its heroes', its towns' garrisons, and the troops left in its mines and garrisons. */
function ownedArmies(s: AdventureState, player: number): (ArmySlot | null)[][] {
  return [
    ...s.heroes.filter((h) => !h.removed && h.owner === player).map((h) => h.army),
    ...s.objects.filter((o) => !o.removed && o.owner === player).map((o) => (o.town ? o.town.garrison : o.army)).filter((a): a is (ArmySlot | null)[] => !!a),
  ];
}

/** A new day: movement back, income, weekly growth; may end simultaneous turns. */
export function newDay(s: AdventureState, w: World): AdventureEvent[] {
  const events: AdventureEvent[] = [];
  s.day++;
  events.push({ e: "day", day: s.day });
  for (const h of s.heroes) {
    if (h.removed) continue;
    if (h.timed) {
      h.timed = h.timed.filter((b) => b.until >= s.day);
      for (const b of h.timed) b.active = b.from <= s.day;
      if (!h.timed.length) delete h.timed;
    }
    startDay(w, s, h);
    // Spell points: a night in a town with a mage guild refills them, else regeneration.
    const town = s.objects.find((o) => o.town && o.owner === h.owner && guildLevel(o) > 0 && w.visitBy[w.index(h.x, h.y, h.z)] === o.id + 1);
    // (Points above the maximum, from a Magic Spring or the Mana Vortex, stay until spent.)
    const mana = h.mana ?? 0;
    h.mana = town ? Math.max(mana, maxMana(h)) : mana >= maxMana(h) ? mana : Math.min(maxMana(h), mana + manaRegen(h));
    if (town) learnFromGuild(s, w, h, town);
  }
  // The Treasury's 10% is of the gold held as the week ended, before the new day's income (heroes.thelazy.net).
  if ((s.day - 1) % 7 === 0) weeklyTownSpecials(s);
  for (const p of s.players) {
    if (!p.alive) continue;
    dailyIncome(s, w, p.color).forEach((n, i) => (p.resources[i] += handicapped(p.handicap, n)));
    for (const o of s.objects) if (o.town && !o.removed && o.owner === p.color && Number(o.data?.loanDays ?? 0) > 0) o.data!.loanDays = Number(o.data!.loanDays) - 1;
  }
  for (const o of s.objects) if (o.town) o.town.builtToday = false;
  coverOfDarkness(s, (x, y, z) => w.index(x, y, z));
  // What a player's own heroes, towns and mines look at stays in sight (as VCMI: no hiding observed tiles).
  for (const p of s.players) if (p.revealed.length) revealOwned(s, w, p.color);
  events.push(...timedEvents(s, w));
  if ((s.day - 1) % 7 === 0) {
    for (const o of s.objects) if (o.town && !o.removed && hasSpecial(o, "dungeon", SPECIAL.s3)) rollPortal(s, w, o);
    // Map dwellings: flagged ones accumulate (HotA), the rest refill to one week's growth.
    for (const o of s.objects) if (o.type === REFUGEE_CAMP && !o.removed) rollRefugees(s, w, o);
    for (const o of s.objects) {
      if (!o.dwelling || o.removed || o.type === REFUGEE_CAMP) continue;
      const creatures = dwellingCreatures(o) ?? [];
      o.dwelling.available = creatures.map((c, i) => {
        const g = w.creatures[c]?.growth ?? 0;
        return o.owner >= 0 && ruleOn(s.rules, "dwellingStock") ? (o.dwelling!.available[i] ?? 0) + g : g;
      });
    }
    for (const p of s.players) if (p.alive) newTavernWeek(s, p.color, w.data.classTavernOdds);
    // Wandering monsters grow 10% a week (VCMI's CGCreature::newTurn: fractions kept), up to 9999 since AB (4000 in RoE; heroes.thelazy.net Wandering creature).
    for (const o of s.objects) {
      if (o.type !== Obj.MONSTER || o.removed || mapData(w, o).noGrowth || (o.amount ?? 1) >= 9999) continue;
      o.data ??= {};
      const power = Math.floor((Number(o.data.power) || (o.amount ?? 1) * 1000) * 1.1);
      o.data.power = power;
      o.amount = Math.min(9999, Math.floor(power / 1000));
    }
    proclaimWeek(s, w);
    // In HotA the plague halves the flagged map dwellings too (heroes.thelazy.net Plague).
    if (s.week?.month?.plague) for (const o of s.objects) if (o.dwelling && !o.removed && o.owner >= 0 && o.type !== REFUGEE_CAMP) o.dwelling.available = o.dwelling.available.map((n) => Math.floor(n / 2));
    weeklyTownGrowth(s, w);
    // Crystal Dragons in any army or garrison bring their owner 3 crystal a week (heroes.thelazy.net Crystal Dragon),
    // those guarding a mine or a garrison too (HotA 1.8.0 fixed SoD leaving them out).
    for (const p of s.players) {
      if (!p.alive) continue;
      if (ownedArmies(s, p.color).some((a) => a.some((x) => x && w.creatures[x.creature]?.abilities.some((b) => b.type === "SPECIAL_CRYSTAL_GENERATION")))) p.resources[4] += 3;
    }
    s.log.push(`Week ${(s.day - 1) / 7 + 1} begins: creatures grow in every dwelling.`);
  }
  s.ended = s.ended.map(() => false);
  s.log.push(`Day ${s.day}.`);
  if (s.turnMode === "simultaneous" && (playersInContact(s) || (s.simultaneousUntil !== undefined && s.day > s.simultaneousUntil))) {
    s.turnMode = "sequential";
    s.current = s.players.find((p) => p.alive)?.color ?? 0;
    s.log.push(playersInContact(s) ? "Rival heroes have met: from now on players take turns one at a time." : "Simultaneous turns are over: from now on players take turns one at a time.");
  }
  checkGameEnd(s, w);
  return events;
}

/** Are heroes of two different players within the contact distance? */
export function playersInContact(s: AdventureState): boolean {
  const heroes = s.heroes.filter((h) => !h.removed);
  for (const a of heroes) {
    for (const b of heroes) {
      if (a.owner >= b.owner || a.z !== b.z || allied(s, a.owner, b.owner)) continue;
      if (tileSpan(a, b) <= s.contactDistance) return true;
    }
  }
  return false;
}

/** Players still to finish the day in simultaneous mode. */
export function waitingFor(s: AdventureState): number[] {
  return s.players.filter((p) => p.alive && !s.ended[p.color]).map((p) => p.color);
}

/** Who is moving now: the current player, or in simultaneous turns everyone not yet done with the day. */
export function movingNow(s: AdventureState): number[] {
  return s.turnMode === "sequential" ? [s.current] : waitingFor(s);
}

function endTurn(s: AdventureState, w: World, player: number): AdventureEvent[] {
  const events: AdventureEvent[] = [];
  if (s.turnMode === "simultaneous") {
    s.ended[player] = true;
    s.log.push(`${PLAYER_NAMES[player]} ends the day.`);
    if (waitingFor(s).length === 0) events.push(...newDay(s, w));
    return events;
  }
  const alive = s.players.filter((p) => p.alive).map((p) => p.color);
  const next = alive.find((c) => c > s.current) ?? alive[0];
  if (next <= s.current) events.push(...newDay(s, w));
  s.current = next;
  s.log.push(`${PLAYER_NAMES[next]} to move.`);
  events.push({ e: "turn", player: next });
  return events;
}
