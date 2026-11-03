// The fresh AI's heroes. One main hero carries the kingdom's army and grows: it fights every guard whose battle, played
// out (fight.ts), pays in experience more than it costs in troops, the guards in passages too (the owner's "break": what lies
// behind counts). The others gather (piles, mines, the week's gold), flag what they can take without a fight, and bring
// the towns' troops to the main hero. Every hero walks to the tile with the best worth per day of walking, and keeps to
// its errand unless something clearly better comes up.
import { type AdventureEvent, allied, cannotHire, dwellingCreatures, dwellingGuards, dwellingPrice, mapHeroesOf } from "../rules.ts";
import { findPaths, type PathNode } from "../movement.ts";
import { type AdventureState, type AdvObject, type ArmySlot, type Hero, Obj } from "../types.ts";
import { type World, isRevealed, visitTile } from "../world.ts";
import { affordableCount, townInfo, upperArmy } from "../town.ts";
import { objectWorth, useService } from "../aiWorth.ts";
import { armyGold, againstBanded, againstHero, againstMonster, againstTown, playOut, priceOf } from "./fight.ts";
import { type Danger, dangerOf, townHolds } from "./danger.ts";
import { power } from "../aiThreat.ts";
import { BANKS } from "../../bankData.ts";
import { rewardableDef } from "../rewardable.ts";
import { resourceWorth } from "./economy.ts";
import { type Mind, act, env, note } from "./mind.ts";
import { chooseTarget, locked } from "../ai.ts";
import { gateTiles, guardTiles, opens, sails, unknownWay } from "./unlock.ts";
import { isAirship } from "../movement.ts";
import { boatSpot, cannotBuildBoat, isAirshipYard } from "../rules.ts";
import { B } from "../town.ts";
import { castForKnowledge, castToGetOut, castToReach, doorOver, doorToward, scuttleBoat } from "../aiSpells.ts";

/** Gold a point of the main hero's experience is worth (its levels win the later fights); another hero's. */
const XP_MAIN = Number(env("FR_XP") ?? 4);
const XP_OTHER = Number(env("FR_XP2") ?? 0.3);
/** Gold a lost creature costs, per gold of its price. */
const LOSS = Number(env("FR_LOSS") ?? 1);
/** Days a mine is counted for. */
const MINE_DAYS = Number(env("FR_MINEDAYS") ?? 25);
/** Worth of an unexplored tile seen. */
const FOG = Number(env("FR_FOG") ?? 10);
/** A day's walk as a share of the worth (the overhead of a stop, in days). */
const STOP = Number(env("FR_STOP") ?? 0.1);
/** How much better a new target must be to drop the errand. */
const KEEP = Number(env("FR_KEEP") ?? 1.3);
/** Heroes by week: 2 from the first day, 3 from the second week. */
const HEROES = (env("FR_HEROES") ?? "2,3,3,4").split(",").map(Number);
/** The furthest a guard may cost the main army (share of its worth) to be passed on the way. */
const PASS_SHARE = Number(env("FR_PASS") ?? 0.3);
/** The troops waiting in a town (share of the main army) another hero fetches for the main one. */
/** A town taken: a neutral one, a rival's (the game is won by taking them). */
const TOWN_NEUTRAL = Number(env("FR_TOWN") ?? 20000);
const TOWN_RIVAL = Number(env("FR_RIVALTOWN") ?? 40000);
/** A rival hero beaten, on top of its army. */
const KILL = Number(env("FR_KILL") ?? 3000);
/** A stronger rival, by this much, who can catch the hero tomorrow makes a tile not worth going to. */
const BRAVE = Number(env("FR_BRAVE") ?? 1);
/** A rival this many times stronger who can catch the hero tomorrow: the tile isn't gone to at all. */
const DREAD = Number(env("FR_DREAD") ?? 2);
/** 0: a hero caught out with no town in reach stays where it is (as before 2026-11-02 evening). */
const FLEE = env("FR_FLEE") !== "0";
const FALLBACK = env("FR_FALLBACK") !== "0";
const SPELLS = env("FR_SPELLS") !== "0";
const OTHERS_FIGHT = env("FR_OTHERS_FIGHT") === "1";
const COURIER = Number(env("FR_COURIER") ?? 0.15);
/** The share of its army the main hero may lose in a fight with a guard (a bank: 0.1 less). */
const MAIN_SHARE = Number(env("FR_SHARE") ?? 0.6);
/** From this day the main hero takes a chest's experience rather than its gold. */
const CHEST_XP_DAY = Number(env("FR_CHESTXP") ?? 1);

const tileOf = (w: World, h: { x: number; y: number; z: number }) => w.index(h.x, h.y, h.z);

/** The kingdom's main hero: kept while it lives; else the one with the most levels and army. */
/** FR_BREAKAT: what a guard must open (gold) to be judged over its band as a break (0: never). */
const BREAK_AT = Number(env("FR_BREAKAT") ?? 4000);
/** FR_BREAKS=0: a guarded garrison is worth nothing (as before 2026-11-03: never attacked). */
const BREAKS = env("FR_BREAKS") !== "0";
/** FR_WAYNEAR=1: a monolith in reach with an unseen exit is worth the black land too (not only one behind a guard). */
const WAY_NEAR = env("FR_WAYNEAR") === "1";
/** FR_REMAIN: how many times the main hero's worth (experience x2 + army) another hero must reach to take over (0: never). */
const REMAIN = Number(env("FR_REMAIN") ?? 0);
export function mainHero(s: AdventureState, w: World, player: number, mind: Mind): Hero | undefined {
  const heroes = mapHeroesOf(s, player);
  const kept = mind.main !== undefined ? heroes.find((h) => h.id === mind.main) : undefined;
  const score = (h: Hero) => h.experience * 2 + armyGold(w, h.army);
  const best = [...heroes].sort((a, b) => score(b) - score(a))[0];
  // (Kept while it lives, unless another hero has become REMAIN times its worth: Province, the owner's seat, seed 1: the
  // main hero, a level 1 with 4k, stood stuck for twenty days while a level 4 with 20k waited to hand it its army. Off by
  // default: FR_REMAIN=2 there gave level 6.5 -> 7.5 over 4 games, and nothing changed from the first seat.)
  if (kept && !(REMAIN > 0 && best && best !== kept && score(best) > REMAIN * score(kept))) return kept;
  mind.main = best?.id;
  return best;
}

/**
 * Heroes by the week's count (HEROES), or with FR_HIREVALUE=1 when one pays: the army it comes with (handed to the main
 * hero) and what a gathering hero has been bringing in a day (mind.rate, smoothed) over HIRE_LIFE days, against its
 * price at what gold is worth to the plan now.
 */
// (Off by default: on Province it went up to eight heroes; the rate counts errands done again and again. FR_HIREVALUE=1.)
const HIRE_VALUE = env("FR_HIREVALUE") === "1";
const HIRE_LIFE = Number(env("FR_HIRELIFE") ?? 14);
const HIRE_PRIOR = Number(env("FR_HIREPRIOR") ?? 300);
export function hire(s: AdventureState, w: World, player: number, keep: number, mind?: Mind) {
  const week = Math.floor((s.day - 1) / 7);
  const want = HEROES[Math.min(week, HEROES.length - 1)];
  for (const o of s.objects) {
    const count = mapHeroesOf(s, player).length;
    if (count >= 8) return;
    if (!(HIRE_VALUE && mind) && count >= want) return;
    if (!o.town || o.removed || o.owner !== player || cannotHire(s, w, o)) continue;
    // (The second hero comes whatever the plan saves for: it gathers what the main hero leaves.)
    if (s.players[player].resources[6] - 2500 < (count >= 2 ? keep : 0)) return;
    if (HIRE_VALUE && mind && count >= 1) {
      const type = s.players[player].tavern?.[0];
      const comes = type !== undefined ? armyGold(w, s.players[player].tavernArmies?.[type] ?? []) : 0;
      const worth = comes + (mind.rate ?? HIRE_PRIOR) * HIRE_LIFE;
      const price = 2500 * resourceWorth(s, w, player, mind)[6];
      if (worth <= price) return;
      note(s, player, `hires: ${Math.round(comes)} in troops + ${Math.round(mind.rate ?? HIRE_PRIOR)} a day x ${HIRE_LIFE} against ${Math.round(price)}`);
    }
    act(s, w, player, { type: "hireHero", town: o.id, slot: 0 });
  }
}

/** The morning's book of the gatherers: yesterday's gain a hero folded into the rate, the count for today's. */
export function gatherBook(mind: Mind) {
  if (mind.gatherers) mind.rate = 0.7 * (mind.rate ?? HIRE_PRIOR) + 0.3 * ((mind.gain ?? 0) / mind.gatherers);
  mind.gain = 0;
  mind.gatherers = 0;
}
/** Today's gatherers, counted after the day's hires. */
export const countGatherers = (s: AdventureState, player: number, mind: Mind, main: Hero | undefined) => void (mind.gatherers = mapHeroesOf(s, player).filter((h) => h.id !== main?.id).length);

/** Troops from `from` to `to` (all of them but one creature, which a hero must keep), as many as fit. */
export function handOver(s: AdventureState, w: World, player: number, to: Hero, from: Hero) {
  const ids: [number, number] = [to.id, from.id];
  // (The best stacks first: when the main army's seven slots are full, what's left behind is the weakest.)
  const order = from.army.map((x, slot) => ({ x, slot })).filter((e) => e.x).sort((a, b) => b.x!.count * (w.creatures[b.x!.creature]?.aiValue ?? 0) - a.x!.count * (w.creatures[a.x!.creature]?.aiValue ?? 0));
  for (const { slot } of order) {
    const st = from.army[slot];
    if (!st) continue;
    let dest = to.army.findIndex((x) => x?.creature === st.creature);
    if (dest < 0) dest = to.army.findIndex((x) => !x);
    if (dest < 0) {
      // No room: the weakest stack of the main army goes back to make room, if this one is worth more.
      const weakest = to.army.map((x, k) => ({ x, k })).sort((a, b) => armyGold(w, [a.x]) - armyGold(w, [b.x]))[0];
      if (!weakest?.x || armyGold(w, [weakest.x]) >= armyGold(w, [st])) continue;
      act(s, w, player, { type: "transfer", heroes: ids, kind: "army", from: { who: 1, slot }, to: { who: 0, slot: weakest.k } });
      continue;
    }
    const last = from.army.filter((x) => x).length === 1;
    const count = last ? st.count - 1 : st.count;
    if (count <= 0) continue;
    act(s, w, player, { type: "transfer", heroes: ids, kind: "army", from: { who: 1, slot }, to: { who: 0, slot: dest }, count: last ? count : undefined });
  }
}

/** The main hero in a town of ours: the garrison's troops join it, then whatever the town sells and the purse allows. */
export function takeTown(s: AdventureState, w: World, player: number, h: Hero, o: AdvObject) {
  const g = o.town!.garrison;
  for (let slot = 0; slot < g.length; slot++) {
    const st = g[slot];
    if (!st) continue;
    let dest = h.army.findIndex((x) => x?.creature === st.creature);
    if (dest < 0) dest = h.army.findIndex((x) => !x);
    if (dest < 0) continue;
    act(s, w, player, { type: "moveStack", town: o.id, from: { who: "garrison", slot }, to: { who: "hero", slot: dest } });
  }
}

/** A map dwelling we stand at: buy what fits and the purse allows (it was flagged on the way in). */
function buyAtDwelling(s: AdventureState, w: World, player: number, h: Hero, o: AdvObject) {
  (dwellingCreatures(o) ?? []).forEach((creature, slot) => {
    const avail = o.dwelling?.available[slot] ?? 0;
    if (!avail || !h.army.some((x) => !x || x.creature === creature)) return;
    const n = affordableCount(dwellingPrice(w, o, creature), s.players[player].resources, avail);
    if (n > 0) act(s, w, player, { type: "recruitDwelling", hero: h.id, object: o.id, slot, count: n });
  });
}

interface Look {
  s: AdventureState;
  w: World;
  h: Hero;
  main: boolean;
  mainHero?: Hero;
  worth: number[];
  /** Tiles other heroes of ours are headed for. */
  claimed: Set<number>;
  /** Fight values by guard id. */
  guards: Map<number, number>;
  danger: Danger;
  /** The hero's strength (power). */
  mine: number;
  /** Rival heroes it would attack. */
  attacks: Set<number>;
  /** Towns of ours that call the main hero home (town id -> worth of holding it). */
  calls: Map<number, number>;
  /** Today's routes and the guards they pass (set once the routes are walked). */
  routes?: Map<number, PathNode>;
  through?: (i: number) => boolean;
}

/** What lies beyond these tiles (unlock.ts), for the main hero once its routes are known. */
function beyond(l: Look, opening: () => Set<number>, what: string, area = false): number {
  if (!l.routes || !l.through) return 0;
  return opens(l.s, l.w, l.h, l.routes, l.through, opening, what, area);
}

/** What beating this guard is worth to the hero (experience less the troops it costs), or undefined if it loses. */
function guardValue(l: Look, g: AdvObject): number | undefined {
  const known = l.guards.get(g.id);
  if (known !== undefined) return Number.isNaN(known) ? undefined : known;
  let out = againstMonster(l.s, l.w, l.h, g);
  // A guard before a break (what it opens is worth BREAK_AT or more: a monolith into the unknown, an area behind) is
  // judged as a garrison's guards are, over counts spread through its band, not at the band's top: the break is
  // risked when it most likely goes well (the owner's Province, 2026-11-03: 24 Arch Mages before a monolith, shown as
  // "lots", fought as 49 and never risked).
  if (BREAK_AT > 0 && l.main && !(out.win && out.share < MAIN_SHARE) && !l.through?.(visitTile(l.w, g)) && beyond(l, () => guardTiles(l.w, g), `g${g.id}`) >= BREAK_AT) out = againstMonster(l.s, l.w, l.h, g, true);
  const v = out.win ? out.xp * (l.main ? XP_MAIN : XP_OTHER) - out.lost * LOSS : NaN;
  // (Another hero than the main one fights only what costs it next to nothing.)
  // (The experience is the main hero's: another hero fights only when FR_OTHERS_FIGHT says so.)
  const ok = out.win && (l.main ? out.share < MAIN_SHARE : OTHERS_FIGHT && out.share < 0.08);
  // A guard in a passage: what it keeps us from counts too (the owner's "break"; a cheap one is passed by the routes already).
  if (ok && l.main && !l.through?.(visitTile(l.w, g))) {
    const far = beyond(l, () => guardTiles(l.w, g), `g${g.id}`);
    if (env("FR_DEBUG") && far > 0) note(l.s, l.h.owner, `  guard ${g.id} opens ${Math.round(far)}`);
    l.guards.set(g.id, v + far);
    return v + far;
  }
  if (env("FR_DEBUG") && l.main) note(l.s, l.h.owner, `  guard ${g.id} ${l.w.creatures[g.subid]?.name} x${g.amount}: win ${out.win} lost ${Math.round(out.lost)} share ${out.share.toFixed(2)} xp ${out.xp} -> ${ok ? Math.round(v) : "no"}`);
  l.guards.set(g.id, ok ? v : NaN);
  return ok ? v : undefined;
}

/** What reaching this object is worth to the hero, in gold (0: nothing; undefined: not to be gone to). */
function objectValue(l: Look, o: AdvObject): number {
  const { s, w, h } = l;
  if (o.owner >= 0 && allied(s, o.owner, h.owner) && o.type !== Obj.TOWN) return 0;
  // (A monolith or gate to somewhere nobody has seen: unlock.ts.)
  const way = WAY_NEAR ? unknownWay(s, w, h, o) : 0;
  if (way) return way;
  switch (o.type) {
    case Obj.RESOURCE:
      return (o.amount ?? (o.subid === 6 ? 750 : 5)) * l.worth[o.subid];
    case Obj.MINE: {
      if (o.owner === h.owner) return 0;
      const day = o.subid === 6 ? 1000 : o.subid === 0 || o.subid === 2 ? 2 : 1;
      const r = o.subid >= 7 ? -1 : o.subid;
      if (r < 0) return 0;
      const guards = (o.army ?? []).filter((x): x is ArmySlot => !!x);
      let fightV = 0;
      if (guards.length) {
        const out = playOut(s, w, h, guards, o.id);
        if (!out.win || out.share > (l.main ? 0.5 : 0.08)) return 0;
        fightV = out.xp * (l.main ? XP_MAIN : XP_OTHER) - out.lost * LOSS;
      }
      return day * l.worth[r] * MINE_DAYS + fightV;
    }
    case Obj.MONSTER:
      return 0;
    case Obj.TOWN: {
      if (o.owner === h.owner) {
        // Home: the main hero takes the troops waiting there and buys the week's; another one hasn't much to do.
        const g = armyGold(w, o.town!.garrison.filter((x) => x && h.army.some((y) => !y || y.creature === x.creature)));
        if (l.main) return (l.calls.get(o.id) ?? 0) + (g > 0.1 * armyGold(w, h.army) ? g : 0) + yardValue(l, o);
        // Another hero fetches them for the main one when they are worth it and the main hero is more than a day away.
        const m = l.mainHero;
        if (!m || g < COURIER * armyGold(w, m.army)) return yardValue(l, o);
        const away = Math.max(Math.abs(m.x - o.x), Math.abs(m.y - o.y)) * 100 > m.maxMovement || m.z !== o.z;
        return away ? 0.8 * g : 0;
      }
      // Someone else's: taken if the siege, played out, is won (a rival's towns are the game: they count double).
      const keeper = s.heroes.find((x) => !x.removed && x.garrison === o.id);
      const out = againstTown(s, w, h, o, keeper);
      if (!out.win || out.share > (l.main ? 0.6 : 0.05)) return 0;
      const rival = o.owner >= 0 && !allied(s, o.owner, h.owner);
      return (rival ? TOWN_RIVAL : TOWN_NEUTRAL) - out.lost * LOSS + out.xp * (l.main ? XP_MAIN : XP_OTHER) + (keeper ? armyGold(w, keeper.army) : 0);
    }
    case 10: {
      // A Keymaster's Tent: the key, worth what the gates of its colour open.
      if (s.players[h.owner].keys?.includes(o.subid)) return 0;
      const gates = gateTiles(s, w, o.subid);
      const v = 300 + (gates.size ? 1200 + beyond(l, () => gates, `k${o.subid}`) : 0);
      if (env("FR_DEBUG")) note(s, h.owner, `  tent ${o.subid} for ${h.name}: ${Math.round(v)}`);
      return v;
    }
    case 9:
    case 212:
      // A border guard or gate with its key in hand: the way through, worth what it opens.
      if (o.subid === 1001 || o.subid === 1000) return Math.max(0, objectWorth(s, w, h, o, [])) * (l.main ? 1 : 0.6);
      return locked(s, w, h, o) ? 0 : 800 + beyond(l, () => new Set([visitTile(w, o)]), `b${o.id}`);
    case Obj.TREASURE_CHEST:
      // (The main hero takes the experience: 500-1500.)
      return l.main ? 1000 * XP_MAIN : 1500;
    case 8:
      // A free boat: worth the coasts it reaches (a scout on a ship, the owner).
      if (h.boat !== undefined || isAirship(o) || o.carriedBy !== undefined || !l.routes) return 0;
      return sails(s, w, h, l.routes, visitTile(w, o));
    case Obj.SHIPYARD:
      // A shipyard: flagged, and a boat built there worth the coasts it reaches (the guard at the yard gets that too).
      return Math.max(0, objectWorth(s, w, h, o, [])) * (l.main ? 1 : 0.6) + yardValue(l, o);
    case Obj.CAMPFIRE:
      return 500 + 5 * 300;
    case Obj.GARRISON:
    case Obj.GARRISON2: {
      // A guarded garrison: a break (2026-11-03). Its guards, seen by their bands, fought when 3 of 4 counts in
      // them are won; worth what it opens, the black land behind it counted tile by tile (a new area to explore).
      const guards = (o.army ?? []).filter((x): x is ArmySlot => !!x && x.count > 0);
      if (o.owner === h.owner || !guards.length) return Math.max(0, objectWorth(s, w, h, o, []));
      if (!BREAKS || !l.main) return 0;
      const out = againstBanded(s, w, h, guards, o.id);
      if (env("FR_DEBUG") && (!out.win || out.share > MAIN_SHARE)) note(s, h.owner, `  garrison ${o.id}: ${guards.map((x) => `${x.count} ${w.creatures[x.creature]?.name}`).join(", ")}: win ${out.win} share ${out.share.toFixed(2)} -> no`);
      if (!out.win || out.share > MAIN_SHARE) return 0;
      const far = beyond(l, () => new Set([visitTile(w, o)]), `b${o.id}`, true);
      const v = out.xp * XP_MAIN - out.lost * LOSS + far;
      if (env("FR_DEBUG")) note(s, h.owner, `  garrison ${o.id}: lost ${Math.round(out.lost)} share ${out.share.toFixed(2)} xp ${Math.round(out.xp)} opens ${Math.round(far)} -> ${Math.round(v)}`);
      return Math.max(0, v);
    }
    case 17: {
      // A creature dwelling: flagged (its creatures join the town's growth) and what's for sale.
      const creatures = dwellingCreatures(o) ?? [];
      const c = w.creatures[creatures[0]];
      if (!c) return 0;
      // Its guards (a level 5-7 dwelling's three weeks of growth, a special one's), played out like any fight: on
      // [HotA] Long Road the main hero walked into a Labyrinth's eight guards for its Minotaurs and died on day 4.
      const guards = o.owner === h.owner ? [] : dwellingGuards(s, w, o, h);
      let fightV = 0;
      if (guards.length) {
        if (!l.main && !OTHERS_FIGHT) return 0;
        const out = playOut(s, w, h, guards, o.id);
        if (!out.win || out.share > (l.main ? 0.5 : 0.08)) return 0;
        fightV = out.xp * (l.main ? XP_MAIN : XP_OTHER) - out.lost * LOSS;
      }
      const avail = o.dwelling?.available[0] ?? 0;
      const buys = h.army.some((x) => !x || x.creature === creatures[0]) ? affordableCount(dwellingPrice(w, o, creatures[0]), s.players[h.owner].resources, avail) : 0;
      return Math.max(0, fightV + (o.owner === h.owner ? 0 : 400 + c.growth * c.cost[6] * 0.3) + (l.main ? buys * c.cost[6] * 0.4 : 0));
    }
    // Experience and primary skills: the main hero's (another hero's are worth little: it doesn't fight).
    case 100: // Learning Stone
    case 102: // Tree of Knowledge
    case 4: // Arena
    case 23: // Marletto Tower
    case 32: // Garden of Revelation
    case 51: // Mercenary Camp
    case 61: // Star Axis
      if (o.visitors?.includes(h.id)) return 0;
      return l.main ? 3000 : 300;
    default: {
      const bank = BANKS[`${o.type}:${o.subid}`];
      if (bank && !(rewardableDef(o) && !rewardableDef(o)!.bank)) return bankValue(l, o);
      const v = objectWorth(s, w, h, o, []);
      return v > 0 ? v * (l.main ? 1 : 0.6) : 0;
    }
  }
}


/**
 * A creature bank: its loot (the levels' mean, or the rolled level's) and the experience, less the troops the battle,
 * played out against its guards (the strongest level's until it's been looked at), costs. The main hero's only.
 */
function bankValue(l: Look, o: AdvObject): number {
  const { s, w, h } = l;
  const bank = BANKS[`${o.type}:${o.subid}`]!;
  if (o.bank?.cleared || !l.main) return 0;
  const levels = o.bank ? [bank.levels[o.bank.level]] : bank.levels;
  const strongest = [...levels].sort((a, b) => armyGold(w, b.guards.map(([creature, count]) => ({ creature, count }))) - armyGold(w, a.guards.map(([creature, count]) => ({ creature, count }))))[0];
  const guards = o.bank?.guards ?? strongest.guards.map(([creature, count]) => ({ creature, count }));
  const out = playOut(s, w, h, guards, o.id, !bank.ordinary);
  if (!out.win || out.share > MAIN_SHARE - 0.1) return 0;
  const lootOf = (lv: (typeof bank.levels)[number]) =>
    (lv.resources ?? []).reduce((a, n, r) => a + n * l.worth[r], 0) + (lv.artifacts?.length ?? 0) * 2500 + (lv.creatures ?? []).reduce((a, [c, n]) => a + n * priceOf(w, c), 0) + (lv.spells ? 500 * lv.spells : 0);
  const total = levels.reduce((a, lv) => a + lv.chance, 0) || 1;
  const loot = levels.reduce((a, lv) => a + (lv.chance * lootOf(lv)) / total, 0);
  return loot + out.xp * XP_MAIN - out.lost * LOSS;
}

/** Unexplored tiles around a tile, a little worth each. */
function fogAt(s: AdventureState, w: World, player: number, i: number): number {
  const x = i % w.size;
  const y = Math.floor(i / w.size) % w.size;
  const z = Math.floor(i / (w.size * w.size));
  let n = 0;
  for (let dy = -5; dy <= 5; dy++)
    for (let dx = -5; dx <= 5; dx++) {
      const j = w.index(x + dx, y + dy, z);
      if (j >= 0 && !isRevealed(s, player, j)) n++;
    }
  return n;
}

/** The hero's best target tile today: its worth per day of walking, the guards on the way and the hero's errand counted. */
export function bestTarget(l: Look, paths: Map<number, PathNode>, errand?: number): { tile: number; step: number; value: number; why: string } | undefined {
  const { s, w, h } = l;
  const day = Math.max(1, h.maxMovement);
  const start = tileOf(w, h);
  let best: { tile: number; step: number; value: number; why: string; score: number } | undefined;
  for (const [i, node] of paths) {
    if (i === start || node.passOnly) continue;
    if (l.claimed.has(i)) continue;
    let v = 0;
    let why = "";
    const guard = w.guardedBy[i] ? s.objects[w.guardedBy[i] - 1] : undefined;
    const o = w.visitable(s, i);
    const other = w.heroAt[i] ? s.heroes[w.heroAt[i] - 1] : undefined;
    if (other && other.owner === h.owner && other.id !== h.id) {
      // A hero of ours: the main hero gets the other's troops; another hero takes its own to the main one.
      if (l.mainHero && other.id === l.mainHero.id && !l.main) {
        v = armyGold(w, h.army) - armyGold(w, h.army.filter((x) => x).slice(0, 1).map((x) => ({ ...x!, count: 1 })));
        why = "brings troops";
      }
    } else if (other && other.owner !== h.owner && !allied(s, other.owner, h.owner)) {
      // A rival hero: beaten if the battle, played out, is won (at its town's gate, behind the town's walls).
      const town = o?.town ? o : undefined;
      const out = town ? againstTown(s, w, h, town, other) : againstHero(s, w, h, other);
      if (env("FR_DEBUG")) note(s, h.owner, `  vs ${other.name}${town ? " in town" : ""}: ${other.army.map((x) => (x ? `${x.count} ${w.creatures[x.creature]?.name}` : "")).filter(Boolean).join(", ")} prim ${other.primary.join("/")} -> win ${out.win} share ${out.share.toFixed(2)}`);
      if (!out.win || out.share > (l.main ? 0.5 : 0.1)) continue;
      v = armyGold(w, other.army) + KILL + out.xp * (l.main ? XP_MAIN : XP_OTHER) - out.lost * LOSS + (town ? TOWN_RIVAL : 0);
      why = `attacks ${other.name}`;
      l.attacks.add(other.id);
    } else if (o && !o.removed) {
      if (o.type === Obj.MONSTER) {
        const g = guardValue(l, o);
        if (g === undefined) continue;
        v = g;
        why = "fights";
      } else {
        v = objectValue(l, o);
        why = `goes to ${o.type}:${o.subid}`;
      }
    } else if (!guard && node.cost > 0 && i % 2 === 0) {
      // Open ground: what it shows of the shroud.
      const fog = fogAt(s, w, h.owner, i);
      if (fog >= 12) {
        v = fog * FOG;
        why = "explores";
      }
    }
    if (guard && guard !== o) {
      const g = guardValue(l, guard);
      if (g === undefined) continue;
      v += g;
    }
    // The guards passed on the way (the route went through them: see `through`), each fought once.
    let step = i;
    const fought = new Set<number>();
    for (let k = node.prev, next = i; k >= 0 && k !== start; next = k, k = paths.get(k)?.prev ?? -1) {
      // (A teleport on the way, a Subterranean Gate or a monolith: the walk goes to its entrance, the next day's from its exit.)
      if (w.teleportTo[k] - 1 === next) step = k;
      const gk = w.guardedBy[k] ? s.objects[w.guardedBy[k] - 1] : w.visitable(s, k)?.type === Obj.MONSTER ? w.visitable(s, k) : undefined;
      if (!gk) continue;
      // (The walk stops at the first guarded tile: the fight is there, whichever guard it is.)
      step = k;
      if (!fought.has(gk.id) && gk !== guard) {
        fought.add(gk.id);
        v += guardValue(l, gk) ?? -1e9;
      }
    }
    if (v <= 0) continue;
    // Where a stronger rival can catch the hero tomorrow: not worth it (unless it's that rival we go for, or home). Both
    // the target and, when it's further than today's walk, where the walk ends tonight (medium 1v1 seed 6: a hero with
    // the town's army went for a safe mine two days off, stopped halfway inside the rival's reach and was taken).
    let tonight = i;
    if (FLEE) for (let k = i; k >= 0 && k !== start && (paths.get(k)?.cost ?? 0) > h.movement; k = paths.get(k)?.prev ?? -1) tonight = paths.get(k)?.prev ?? k;
    const worse = (l.danger.one.get(tonight) ?? 0) > (l.danger.one.get(i) ?? 0) ? tonight : i;
    const threat = l.danger.one.get(worse) ?? 0;
    const by = l.danger.by.get(worse);
    const home = o?.town && o.owner === h.owner;
    if (threat > l.mine * BRAVE && !(by && l.attacks.has(by.id) && other?.id === by.id) && !home) {
      if (FLEE && threat > l.mine * DREAD) continue;
      v *= 0.1;
    }
    const days = node.cost / day + STOP;
    let score = v / days;
    if (i === errand) score *= KEEP;
    if (!best || score > best.score) best = { tile: i, step, value: v, why, score };
  }
  return best;
}

/** One hero's day: walk to the best target, again and again, until nothing is worth the walk or the day is spent. */
export function heroDay(s: AdventureState, w: World, player: number, h: Hero, mind: Mind, mainH: Hero | undefined, claimed: Set<number>, stop: () => boolean): AdventureEvent[] {
  const events: AdventureEvent[] = [];
  const isMain = mainH?.id === h.id;
  const targets = (mind.targets ??= {});
  // (Chests: the main hero takes the experience once its kingdom has gold coming, before that the gold: FR_CHESTXP the day.)
  // (A chest's experience is about 0.6 of its gold: taken when that is worth more than the gold, at the plan's worth.)
  if (isMain && s.day >= CHEST_XP_DAY && XP_MAIN * 0.6 > resourceWorth(s, w, player, mind)[6]) h.aiChestXp = true;
  else delete h.aiChestXp;
  // Cheap magic first, as the classic computer casts it: View Earth / Air weekly, Visions by a monster, Disguise with a
  // rival near, Scuttle Boat on a rival's way across (FR_SPELLS=0: none).
  let castOver = false;
  let doorUsed = false;
  if (SPELLS) events.push(...castForKnowledge(s, w, player, h), ...scuttleBoat(s, w, player, h));
  for (let k = 0; k < 24 && h.movement > 0 && !h.removed && h.garrison === undefined; k++) {
    if (stop()) return events;
    w.refresh(s);
    const l: Look = { s, w, h, main: isMain, mainHero: mainH, worth: resourceWorth(s, w, player, mind), claimed, guards: new Map(), danger: dangerOf(s, w, player), mine: power(w, h), attacks: new Set(), calls: isMain ? townCalls(s, w, player, h) : new Map() };
    // Holding a town in danger: it stays, unless the rival can be beaten first.
    const here = w.visitBy[tileOf(w, h)] ? s.objects[w.visitBy[tileOf(w, h)] - 1] : undefined;
    const holding = isMain && here?.town && here.owner === player && l.calls.has(here.id);
    const mineArmy = armyGold(w, h.army);
    // Routes go on past the guards the hero beats at little cost (the far side of a passage counts: the owner's "break").
    const through = (i: number) => {
      const g = w.guardedBy[i] ? s.objects[w.guardedBy[i] - 1] : undefined;
      if (!g || g.type !== Obj.MONSTER) return false;
      const out = againstMonster(s, w, h, g);
      return out.win && (isMain || OTHERS_FIGHT) && out.lost <= PASS_SHARE * mineArmy * (isMain ? 1 : 0.1);
    };
    // (Through teleports too: the other level and the monoliths' far ends count.)
    const paths = findPaths(w, s, h, false, through, true);
    l.routes = paths;
    l.through = through;
    let t = bestTarget(l, paths, targets[h.id]);
    if (holding && t && !t.why.startsWith("attacks")) t = undefined;
    if (holding && !t) {
      note(s, player, `${h.name} holds ${here!.name ?? here!.id} against a rival`);
      break;
    }
    if (!t) {
      delete targets[h.id];
      // Nothing on foot: what the fresh engine doesn't do yet (boats, whirlpools, monoliths, airships, spells to get
      // out) the classic picker does, for this one step.
      let classic = FALLBACK ? chooseTarget(s, w, h) : -1;
      // Only scouting left on foot (or nothing): Water Walk / Fly / Summon Boat or Dimension Door over to what lies
      // across, else a boat by magic or Town Portal out, as the classic computer casts them (FR_SPELLS=0: none).
      if (SPELLS && !castOver && h.boat === undefined && (classic < 0 || h.aiExploring)) {
        castOver = true;
        const cast = castToReach(s, w, player, h);
        if (!cast.length) cast.push(...doorOver(s, w, player, h));
        if (!cast.length && classic < 0) cast.push(...castToGetOut(s, w, player, h));
        if (cast.length) {
          events.push(...cast);
          for (const ev of cast) arrive(s, w, player, h, ev, mainH);
          w.refresh(s);
          classic = chooseTarget(s, w, h);
        }
      }
      if (classic >= 0 && classic !== tileOf(w, h)) {
        note(s, player, `${h.name}: the classic picker's step to ${classic}`);
        const before = h.movement;
        const got = act(s, w, player, { type: "move", hero: h.id, to: classic });
        if (got) {
          events.push(...got);
          for (const ev of got) arrive(s, w, player, h, ev, mainH);
        }
        if (!got || h.movement === before) break;
        continue;
      }
      // Nothing left ashore: a boat from a shipyard of ours in reach (tomorrow's routes weigh it).
      if (h.boat === undefined && orderBoat(s, w, player, h, paths)) continue;
      note(s, player, `${h.name}: nothing worth the walk`);
      break;
    }
    targets[h.id] = t.tile;
    note(s, player, `${h.name} ${t.why} at ${t.tile} (${Math.round(t.value)})`);
    if (env("FR_DEBUG")) note(s, player, `  danger there ${Math.round(l.danger.one.get(t.tile) ?? 0)} by ${l.danger.by.get(t.tile)?.name ?? "-"}, here ${Math.round(l.danger.one.get(tileOf(w, h)) ?? 0)}, mine ${Math.round(l.mine)}, rivals ${l.danger.rivals.map((e) => `${e.name}@${e.x},${e.y}`).join(" ")}`);
    // More than today's walk off: Dimension Door toward it first (once a day; FR_SPELLS=0: never).
    if (SPELLS && !doorUsed && (paths.get(t.tile)?.cost ?? 0) > h.movement) {
      doorUsed = true;
      const jumped = doorToward(s, w, player, h, t.tile);
      if (jumped.length) {
        events.push(...jumped);
        continue;
      }
    }
    const before = h.movement;
    const at = tileOf(w, h);
    const got = act(s, w, player, { type: "move", hero: h.id, to: t.step });
    if (!got) {
      if (env("FR_DEBUG")) {
        const plain = findPaths(w, s, h);
        note(s, player, `  no path: at ${at} step ${t.step} target ${t.tile} plain ${plain.has(t.step)} cost ${paths.get(t.step)?.cost} guard ${w.guardedBy[t.step]} visit ${w.visitBy[t.step]} hero ${w.heroAt[t.step]} prev ${paths.get(t.step)?.prev}`);
      }
      claimed.add(t.tile);
      continue;
    }
    events.push(...got);
    for (const ev of got) arrive(s, w, player, h, ev, mainH);
    // At the shipyard it came for: the boat (tomorrow's routes weigh it, today's what's left of the day).
    const yard = w.visitBy[tileOf(w, h)] ? s.objects[w.visitBy[tileOf(w, h)] - 1] : undefined;
    if (yard && tileOf(w, h) === t.tile && yard.owner === player && yardValue(l, yard) > 0) orderBoat(s, w, player, h, paths);
    if (!isMain && tileOf(w, h) === t.tile) mind.gain = (mind.gain ?? 0) + Math.max(0, t.value);
    if (tileOf(w, h) === t.tile || h.removed) delete targets[h.id];
    if (h.movement === before && tileOf(w, h) === at) break;
  }
  if (targets[h.id] !== undefined) claimed.add(targets[h.id]);
  if (!stop()) shelter(s, w, player, h);
  return events;
}

/**
 * The towns of ours that call the main hero home: a rival who can get there by tomorrow (or in two days) and would take
 * it from what holds it now, when the main hero and the garrison together would hold. Worth the town (twice tomorrow's).
 */
export function townCalls(s: AdventureState, w: World, player: number, main: Hero): Map<number, number> {
  const out = new Map<number, number>();
  const d = dangerOf(s, w, player);
  for (const o of s.objects) {
    if (!o.town || o.removed || o.owner !== player) continue;
    const gate = visitTile(w, o);
    const one = d.one.get(gate) ?? 0;
    const two = d.two.get(gate) ?? 0;
    const holds = townHolds(s, w, o);
    const atGate = tileOf(w, main) === gate;
    const withMain = atGate ? holds : holds + power(w, main) * 1.3;
    if (one > holds && withMain > one) out.set(o.id, TOWN_RIVAL);
    else if (two > holds && withMain > two) out.set(o.id, TOWN_RIVAL * 0.3);
  }
  return out;
}

/** What a boat from this shipyard (a map one, a town's) is worth to the hero: the sea's coasts less its price. */
function yardValue(l: Look, o: AdvObject): number {
  const { s, w, h } = l;
  if (h.boat !== undefined || !l.routes || isAirshipYard(o) || (o.type !== Obj.SHIPYARD && !o.town?.built.includes(B.SHIPYARD))) return 0;
  if (s.players[h.owner].resources[6] < 3000 || (o.owner >= 0 && o.owner !== h.owner)) return 0;
  // (One at sea at a time.)
  if (mapHeroesOf(s, h.owner).some((x) => x.boat !== undefined && !x.airship)) return 0;
  const spot = boatSpot(s, w, o);
  if (spot < 0) return 0;
  return Math.max(0, sails(s, w, h, l.routes, spot) - 1500);
}

/** A boat built at a shipyard of ours the hero can walk to (one at a time; 3000 gold in hand). */
const boatDay = new Map<number, number>();
function orderBoat(s: AdventureState, w: World, player: number, h: Hero, paths: Map<number, PathNode>): boolean {
  if (s.players[player].resources[6] < 3000 || boatDay.get(player) === s.day) return false;
  if ([...paths.keys()].some((i) => { const o = w.visitable(s, i); return o?.type === 8 && !o.removed && o.carriedBy === undefined && !isAirship(o); })) return false;
  const yard = s.objects.find((o) => !o.removed && o.owner === player && ((o.type === Obj.SHIPYARD && !isAirshipYard(o)) || o.town?.built.includes(B.SHIPYARD)) && !cannotBuildBoat(s, w, o, player) && (paths.has(visitTile(w, o)) || visitTile(w, o) === tileOf(w, h)));
  if (!yard) return false;
  boatDay.set(player, s.day);
  note(s, player, `${h.name}: a boat built at ${yard.name ?? yard.id}`);
  return !!act(s, w, player, { type: "buildBoat", object: yard.id });
}

/** The day's walking over: a hero a stronger rival can catch tomorrow gets into a town of ours in reach, if any. */
export function shelter(s: AdventureState, w: World, player: number, h: Hero) {
  if (h.removed || h.garrison !== undefined || !h.movement) return;
  const d = dangerOf(s, w, player);
  if ((d.one.get(tileOf(w, h)) ?? 0) <= power(w, h) * BRAVE) return;
  const paths = findPaths(w, s, h);
  let best = -1;
  let cost = Infinity;
  for (const o of s.objects) {
    if (!o.town || o.removed || o.owner !== player) continue;
    const gate = visitTile(w, o);
    const node = paths.get(gate);
    if (node && node.cost <= h.movement && node.cost < cost && !w.heroAt[gate]) [best, cost] = [gate, node.cost];
  }
  if (best >= 0) {
    note(s, player, `${h.name} shelters in a town from a stronger rival`);
    act(s, w, player, { type: "move", hero: h.id, to: best });
    return;
  }
  // No town in reach: out of the rival's reach, if it can (the tile nearest home), else the least dangerous one (seed 4
  // of the small 1v1 maps: the main hero stood where it was, was caught on day 9 and gave up its army).
  if (!FLEE) return;
  const mine = power(w, h) * BRAVE;
  const home = s.objects.find((o) => o.town && !o.removed && o.owner === player);
  const hx = home ? home.x : h.x;
  const hy = home ? home.y : h.y;
  let to = -1;
  let key = [Infinity, Infinity];
  for (const [i, node] of paths) {
    if (node.cost > h.movement || w.heroAt[i] || w.guardedBy[i] || w.visitable(s, i)) continue;
    const t = d.one.get(i) ?? 0;
    const x = i % w.size;
    const y = Math.floor(i / w.size) % w.size;
    const k = [t <= mine ? 0 : t, Math.hypot(x - hx, y - hy)];
    if (k[0] < key[0] || (k[0] === key[0] && k[1] < key[1])) [to, key] = [i, k];
  }
  if (to >= 0 && to !== tileOf(w, h) && key[0] < (d.one.get(tileOf(w, h)) ?? 0)) {
    note(s, player, `${h.name} flees a stronger rival`);
    act(s, w, player, { type: "move", hero: h.id, to });
  }
}

/** What the hero does on arrival: home troops and recruits, a dwelling's creatures, a service, a meeting. */
function arrive(s: AdventureState, w: World, player: number, h: Hero, ev: AdventureEvent, mainH: Hero | undefined) {
  if (h.removed) return;
  const isMain = mainH?.id === h.id;
  if (ev.e === "town" && s.objects[ev.object]?.owner === player) {
    const o = s.objects[ev.object];
    // (The main hero takes the troops; another hero takes them to the main one when they are worth fetching.)
    if (isMain || (mainH && armyGold(w, o.town!.garrison) >= COURIER * armyGold(w, mainH.army))) takeTown(s, w, player, h, o);
  }
  if (ev.e === "dwelling" && isMain) buyAtDwelling(s, w, player, h, s.objects[ev.object]);
  if (ev.e === "market" && ev.hero === h.id) useService(s, w, player, h, s.objects[ev.object]);
  if (ev.e === "meet") {
    const a = s.heroes[ev.hero];
    const b = s.heroes[ev.other];
    if (a?.owner === player && b?.owner === player && mainH && (a.id === mainH.id || b.id === mainH.id)) handOver(s, w, player, mainH, a.id === mainH.id ? b : a);
  }
}

/** Upper army of a town: what waits there for the main hero. */
export const waiting = (s: AdventureState, w: World, o: AdvObject) => armyGold(w, upperArmy(s, o));

export { tileOf, visitTile, townInfo };
