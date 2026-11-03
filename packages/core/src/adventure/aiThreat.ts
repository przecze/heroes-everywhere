// The computer's sense of danger: how strong an army is, who beats whom (in the field and in a
// siege), where a rival can be by tomorrow or in a few days, and what follows for a town of ours
// (stay and hold it, leave troops in it, run to it). Every "can this town hold?" in the AI is
// `defended` here, so the AI's parts (staying home, running for shelter, leaving a guard, the town
// builder) agree. The strategic bench's "Danger" and "Against a player" cases test it.
import { fixes, markGuard, onTodaysWalk } from "./aiRoles.ts";
import { siegeBonuses } from "./townSpecials.ts";
import { siegeOf } from "./combat.ts";
import { type PathNode, findPaths, mapPathTo } from "./movement.ts";
import { type AdventureEvent, allied } from "./rules.ts";
import { B, garrisonHero, townInfo } from "./town.ts";
import { type AdvObject, type AdventureState, type ArmySlot, type Hero } from "./types.ts";
import { type World, isRevealed, visitTile } from "./world.ts";
import { traitsOf } from "./aiPersonality.ts";
import { WORTH } from "./aiValues.ts";
import { type Consider, act } from "./ai.ts";

/** @wiki principle/army-strength An army's strength: what its creatures are worth, summed. */
export const army = (w: World, slots: (ArmySlot | null)[]) => slots.reduce((a, x) => a + (x ? x.count * (w.creatures[x.creature]?.aiValue ?? 0) : 0), 0);

/**
 * @wiki principle/one-strong-army Does this hero carry the player's army (its strongest, or one near it)? Only such a hero
 * takes the troops waiting in a town; the others scout and gather, and leave them there (they defend the town meanwhile)
 * for the main army to come for. Before, any hero passing took the garrison: a player's computer rival had its army split
 * over five heroes and its towns empty (2026-10-28).
 */
export function carriesArmy(s: AdventureState, w: World, h: Hero): boolean {
  let best = 0;
  for (const x of s.heroes) if (!x.removed && x.owner === h.owner && x.garrison === undefined && x.id !== h.id) best = Math.max(best, army(w, x.army));
  return army(w, h.army) >= 0.5 * best;
}

/**
 * @wiki principle/one-strong-army Does a hero that doesn't carry the army take this town's troops out to the one that
 * does? When they are worth the walk (a sixth of the main army or more), the main army is more than two days from the
 * town (it won't be back for them soon) and no rival in a day's reach could take them off the scout on the way out.
 * The scout then heads for the main hero to hand them over (ourHeroTarget). Against the AI before (2026-10-31): duel
 * 44-41 of 180, the armies at the end +28%; ai:growth army at day 28 42k -> 46k, against the raider 24k -> 34k.
 */
export function ferries(s: AdventureState, w: World, h: Hero, town: AdvObject): boolean {
  if (!town.town || calledTo(s, w, h)) return false;
  let main: Hero | undefined;
  for (const x of s.heroes) if (!x.removed && x.owner === h.owner && x.garrison === undefined && x.id !== h.id && (!main || army(w, x.army) > army(w, main.army))) main = x;
  const g = army(w, town.town.garrison);
  if (!main || g < 0.15 * army(w, main.army)) return false;
  const gate = visitTile(w, town);
  if (gate < 0) return false;
  const [x, y, z] = [gate % w.size, Math.floor(gate / w.size) % w.size, Math.floor(gate / (w.size * w.size))];
  // (Fix engines: the main army picks them up itself only when the town is on today's walk: aiRoles.ts.)
  if (fixes(s, h.owner) ? onTodaysWalk(main, town) : inReach(s, w, main, x, y, z, 2)) return false;
  const carried = g + army(w, h.army);
  return !s.heroes.some((e) => !e.removed && e.owner >= 0 && e.owner !== h.owner && !allied(s, e.owner, h.owner) && army(w, e.army) > carried && inReach(s, w, e, x, y, z));
}

/** Fighting strength: army value, scaled by the hero's attack and defense. */
export function power(w: World, h: Hero): number {
  return army(w, h.army) * (1 + 0.05 * (h.primary[0] + h.primary[1]));
}

/**
 * How much stronger than a rival hero ours must be to attack it (it was 1.3: with the even armies of
 * the advanced starts no one ever was, and the AI never came for the player); behind a town's walls, more.
 */
export const WALLS = 1.3;
/** What the town's walls multiply its defenders by (a Fort or better; none without). */
export const wallsOf = (town: AdvObject) => (town.town!.built.includes(B.FORT) ? WALLS : 1);
/**
 * @wiki principle/town-holds How much a town of ours holds out with: a hero's army in it (worth `extra`)
 * and the garrison, behind its walls.
 */
export const defended = (w: World, town: AdvObject, extra = 0) => (extra + army(w, town.town!.garrison)) * wallsOf(town);
/**
 * How bold the computer is by the game's difficulty (Easy, Normal, Hard, Expert, Impossible), as
 * in the original where an easy computer keeps to itself and a hard one comes early: the edge it
 * wants over a rival hero or town, the day it starts marching on rivals out of reach, and the odds
 * it fights a guard in the way at. Normal is what the duels tuned: first 1.15, after the first week,
 * 1.6 (at 1.25 the duels went 27 to 43, the army spent on guards); since 2026-10-24 more patient,
 * 1.32, after two weeks, 1.76 (the Builder personality's caution: it beat the standard AI 25 to 13 on
 * random maps with the standard build order, and as the standard AI the duels went 111 to 96 over
 * 360 games; the Builder's build order alone lost 49 to 55). Hard keeps the old numbers.
 */
const BOLDNESS = [
  { edge: 1.5, marchAfter: 21, march: 2 },
  { edge: 1.32, marchAfter: 14, march: 1.76 },
  { edge: 1.15, marchAfter: 7, march: 1.6 },
  { edge: 1.1, marchAfter: 3, march: 1.4 },
  { edge: 1.1, marchAfter: 0, march: 1.4 },
];
/** The difficulty's boldness, shifted by the player's personality. */
export const boldness = (s: AdventureState, player: number) => {
  const b = BOLDNESS[Math.max(0, Math.min(4, s.difficulty ?? 1))];
  const t = traitsOf(s, player);
  return { edge: b.edge * t.edge, marchAfter: Math.max(0, b.marchAfter + t.marchDays), march: b.march * t.margin };
};

export function canBeat(s: AdventureState, w: World, h: Hero, e: Hero): boolean {
  const at = w.visitBy[w.index(e.x, e.y, e.z)];
  const town = at ? s.objects[at - 1] : undefined;
  if (town?.town) return beatsSiege(s, w, h, town, power(w, e), e);
  return power(w, h) > boldness(s, h.owner).edge * power(w, e);
}

/**
 * Whether the hero takes a town held by `defenders` (worth, a hero's power or the garrison's): the
 * walls, the arrow towers' shots over a battle (a Citadel's keep, a Castle's two more towers; 2-4
 * more a shot for each structure), as the attacker's own worth per hit point, and what the town
 * adds to its defender's attack and defense (the Fortress's Grail +10/+10, Glyphs of Fear, Blood
 * Obelisk). Gird (35,870) lost to Jeddite (6,109) in a Fortress castle with its Grail, the towers
 * hitting for 117-170 a shot.
 */
export function beatsSiege(s: AdventureState, w: World, h: Hero, town: AdvObject, defenders: number, guard?: Hero): boolean {
  const built = town.town!.built;
  const mine = power(w, h);
  if (!built.includes(B.FORT)) return mine > boldness(s, h.owner).edge * defenders;
  const setup = siegeOf(town);
  let shot = 0;
  if (setup && setup.level >= 2) shot += 15 + 3 * setup.structures;
  if (setup && setup.level >= 3) shot += 2 * (9 + 3 * Math.floor(setup.structures / 2));
  let hp = 0;
  for (const x of h.army) if (x) hp += x.count * (w.creatures[x.creature]?.hp ?? 0);
  const perHp = hp > 0 ? army(w, h.army) / hp : 0;
  const towers = shot * SIEGE_ROUNDS * perHp;
  let help = siegeBonuses(town).primary[0] + siegeBonuses(town).primary[1];
  if (built.includes(B.GRAIL) && townInfo(town)?.faction === "fortress") help += 20;
  if (built.includes(B.GRAIL) && townInfo(town)?.faction === "stronghold") help += 20;
  const skill = guard ? guard.primary[0] + guard.primary[1] : 0;
  const boost = guard ? (1 + 0.05 * (skill + help)) / (1 + 0.05 * skill) : 1 + 0.05 * help;
  return mine - towers > boldness(s, h.owner).edge * WALLS * defenders * boost;
}
/** Rounds the towers shoot in a siege the attacker wins (an estimate). */
const SIEGE_ROUNDS = 5;

/** Where a rival hero can walk to on its next turn (its own routes, guards and all), kept for the day while it stands still. */
const reachCache = new WeakMap<AdventureState, Map<string, Map<number, PathNode>>>();
export function reach(s: AdventureState, w: World, e: Hero): Map<number, PathNode> {
  let byHero = reachCache.get(s);
  if (!byHero) reachCache.set(s, (byHero = new Map()));
  const key = `${e.id}:${e.x},${e.y},${e.z}:${s.day}`;
  let paths = byHero.get(key);
  if (!paths) {
    for (const k of byHero.keys()) if (k.startsWith(`${e.id}:`)) byHero.delete(k);
    // With the other heroes off the map: ours are gone by then (they stood between the rival and
    // the tiles behind them, which looked out of its reach: three weak heroes hid there and were caught).
    const cleared: [number, number][] = [];
    for (const x of s.heroes) {
      const i = x.removed || x === e ? -1 : w.index(x.x, x.y, x.z);
      if (i >= 0 && w.heroAt[i]) cleared.push([i, w.heroAt[i]]), (w.heroAt[i] = 0);
    }
    try {
      byHero.set(key, (paths = findPaths(w, s, e)));
    } finally {
      for (const [i, v] of cleared) w.heroAt[i] = v;
    }
  }
  return paths;
}
/** Can the rival hero get to this tile (or next to it) tomorrow? (It was every tile within maxMovement/100 as the crow flies: 15 tiles, three quarters of a small map, a no-go zone round any strong hero.) */
export function inReach(s: AdventureState, w: World, e: Hero, x: number, y: number, z: number, days = 1): boolean {
  // (Roads: a cobblestone step costs 50, so a day's walk goes twice as far as on grass.)
  if (e.z !== z || Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) > (days * e.maxMovement) / 50 + 1) return false;
  const paths = reach(s, w, e);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const node = paths.get(w.index(x + dx, y + dy, z));
      if (node && node.cost <= days * e.maxMovement) return true;
    }
  return false;
}

/** How many days the rival hero needs to get to this tile (or next to it), Infinity past `most` days. */
export function daysOff(s: AdventureState, w: World, e: Hero, x: number, y: number, z: number, most: number): number {
  if (e.z !== z || Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) > (most * e.maxMovement) / 50 + 1) return Infinity;
  const paths = reach(s, w, e);
  let least = Infinity;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const node = paths.get(w.index(x + dx, y + dy, z));
      if (node && node.cost < least) least = node.cost;
    }
  const days = Math.max(1, Math.ceil(least / Math.max(1, e.maxMovement)));
  return days <= most ? days : Infinity;
}

/**
 * @wiki principle/hold-your-ground
 * The rival heroes in the field this hero can't beat (an even match, or stronger): it doesn't walk into their reach
 * on its way to a rival's town, and doesn't ride off to one while they can reach a town of ours that wouldn't hold
 * (see leavesTownsOpen). The owner, 2026-10-31 (Brave New World, day 21): Teal's main army (9,847) walked past his (9,858)
 * at five tiles for his town, its own town two days behind him; he struck first and beat it. "If you have the better
 * army, you attack my hero; if comparable, you stick to your ground."
 */
export function evenRivals(s: AdventureState, w: World, h: Hero, enemies: Hero[]): Hero[] {
  const mine = power(w, h);
  const edge = boldness(s, h.owner).edge;
  return enemies.filter((e) => e.garrison === undefined && e.owner >= 0 && !allied(s, e.owner, h.owner) && !(mine > edge * power(w, e)));
}

/** Is a rival hero this hero can't beat within a day's reach of this tile (it would strike first)? */
export function contested(s: AdventureState, w: World, h: Hero, x: number, y: number, z: number, enemies: Hero[]): boolean {
  return evenRivals(s, w, h, enemies).some((e) => inReach(s, w, e, x, y, z));
}

/**
 * @wiki principle/hold-your-ground
 * Would the hero that carries the army, riding off `days` to a rival's town and back, leave a town of ours open to a
 * rival hero it can't beat? Open: the garrison (and a hero holding it) behind the walls wouldn't hold against that
 * rival, and the rival can be at its gate before the hero is back. Then the trade is their town for ours (and an
 * even rival met on the way): the hero holds its ground instead. A scout's ride leaves nothing more open than it was.
 */
export function leavesTownsOpen(s: AdventureState, w: World, h: Hero, days: number): boolean {
  if (!carriesArmy(s, w, h)) return false;
  const rivals = evenRivals(s, w, h, s.heroes.filter((e) => !e.removed && e.owner !== h.owner));
  if (!rivals.length) return false;
  const away = Math.min(6, Math.max(2, 2 * days));
  for (const t of s.objects) {
    if (!t.town || t.removed || t.owner !== h.owner) continue;
    const gate = visitTile(w, t);
    if (gate < 0) continue;
    const [x, y, z] = [gate % w.size, Math.floor(gate / w.size) % w.size, Math.floor(gate / (w.size * w.size))];
    const keeper = garrisonHero(s, t);
    const held = defended(w, t, keeper && keeper !== h ? power(w, keeper) : 0);
    if (rivals.some((e) => power(w, e) >= held && daysOff(s, w, e, x, y, z, away) <= away)) return true;
  }
  return false;
}

/** Is a stronger enemy hero within a day's reach of this tile? */
export function threatened(s: AdventureState, w: World, h: Hero, x: number, y: number, z: number, enemies: Hero[]): boolean {
  return strongerEnemies(w, h, enemies).some((e) => inReach(s, w, e, x, y, z));
}

/** The enemies strong enough to threaten the hero (worked out once for a scan over many tiles). */
export function strongerEnemies(w: World, h: Hero, enemies: Hero[]): Hero[] {
  const mine = power(w, h);
  return enemies.filter((e) => power(w, e) > 1.2 * mine);
}

/**
 * @wiki principle/hold-together
 * The towns our heroes go home to hold together, though no one of them could alone (2026-10-27, A Warm and
 * Familiar Place: three heroes, each weaker than his, each hid where it stood, and his walked into the empty capital;
 * the three with the walls would have held it). For each town of ours a rival hero can reach within two days that its
 * garrison can't hold, our heroes that can be back before it are counted, nearest first, the garrison and the walls
 * with them, until the town holds; when it takes two or more, those are called home (hero id -> town id). A town not even all of them could hold
 * is not called for: its heroes keep out of the way and come back for it. Worked out once a turn.
 */
const callsCache = new WeakMap<AdventureState, { key: string; calls: Map<number, number> }>();
export function townCalls(s: AdventureState, w: World, player: number): Map<number, number> {
  const key = `${s.day}:${player}`;
  const known = callsCache.get(s);
  if (known?.key === key) return known.calls;
  const calls = new Map<number, number>();
  callsCache.set(s, { key, calls });
  const enemies = s.heroes.filter((e) => !e.removed && e.owner >= 0 && e.owner !== player && !allied(s, e.owner, player));
  const ours = s.heroes.filter((h) => !h.removed && h.owner === player && h.garrison === undefined && h.boat === undefined);
  const towns = s.objects.filter((o) => o.town && !o.removed && o.owner === player);
  if (!enemies.length || !ours.length || !towns.length) return calls;
  const pathsOf = new Map<number, Map<number, PathNode>>();
  const paths = (h: Hero) => pathsOf.get(h.id) ?? pathsOf.set(h.id, findPaths(w, s, h)).get(h.id)!;
  for (const town of towns) {
    const gate = visitTile(w, town);
    if (gate < 0) continue;
    const [x, y, z] = [gate % w.size, Math.floor(gate / w.size) % w.size, Math.floor(gate / (w.size * w.size))];
    const keeper = garrisonHero(s, town);
    const base = keeper ? power(w, keeper) : 0;
    // The rivals that come before two days are out and would take it as it stands; the days until the first can.
    const threats = enemies.map((e) => ({ e, days: inReach(s, w, e, x, y, z) ? 1 : inReach(s, w, e, x, y, z, 2) ? 2 : 0 })).filter((t) => t.days && power(w, t.e) >= defended(w, town, base));
    if (!threats.length) continue;
    const worst = Math.max(...threats.map((t) => power(w, t.e)));
    const days = Math.min(...threats.map((t) => t.days));
    // Our heroes that are there in time (the one standing at the gate already is), nearest first.
    const helpers = ours
      .filter((h) => !calls.has(h.id))
      .map((h) => ({ h, cost: w.index(h.x, h.y, h.z) === gate ? 0 : (paths(h).get(gate)?.cost ?? Infinity) }))
      .filter((x) => x.cost <= x.h.movement + (days - 1) * x.h.maxMovement)
      .sort((a, b) => a.cost - b.cost);
    let sum = base;
    const called: Hero[] = [];
    for (const { h } of helpers) {
      if (defended(w, town, sum) > HOLD_MARGIN * worst) break;
      called.push(h);
      sum += power(w, h);
    }
    // (Only a call that holds: else they'd all be caught there. One hero alone is the other rules' to judge: going home,
    // staying behind the walls, leaving a guard; called, a 13,000 army sat in its gate all day for a 1,400 scout.)
    if (called.length >= 2 && defended(w, town, sum) > HOLD_MARGIN * worst) for (const h of called) calls.set(h.id, town.id);
  }
  return calls;
}
/** How much more than the strongest rival coming the town must hold with, to call heroes home for it. */
const HOLD_MARGIN = 1.1;
/** The town this hero is called home to hold, if any. */
export const calledTo = (s: AdventureState, w: World, h: Hero): AdvObject | undefined => {
  const id = townCalls(s, w, h.owner).get(h.id);
  return id === undefined ? undefined : s.objects[id];
};

/** @wiki principle/stand-behind-walls Should the hero stay in the town it stands in (an enemy two days off it can't clearly beat outside, but can with the walls)? */
export function holdsTown(s: AdventureState, w: World, h: Hero): boolean {
  const at = w.visitBy[w.index(h.x, h.y, h.z)];
  const town = at ? s.objects[at - 1] : undefined;
  if (!town?.town || town.owner !== h.owner) return false;
  // (Called home to hold it with others: it waits for them here.)
  if (calledTo(s, w, h) === town) return true;
  const mine = power(w, h);
  const held = defended(w, town, mine);
  // (A hero of ours in the garrison that holds it with the walls alone: the one at the gate goes on. Both stayed, and an
  // advanced start's side stood still for days, its second hero hired to go on holding the gate too.)
  const keeper = garrisonHero(s, town);
  const alone = keeper && keeper !== h ? defended(w, town, power(w, keeper)) : 0;
  return s.heroes.some((e) => !e.removed && e.owner !== h.owner && !allied(s, e.owner, h.owner) && mine <= boldness(s, h.owner).edge * power(w, e) && power(w, e) < held && power(w, e) >= alone && inReach(s, w, e, town.x, town.y, town.z, 2));
}

/**
 * @wiki principle/empty-town-invites
 * The hero rides out of a town of ours: troops stay behind against what could come before it is back
 * (2026-10-27: a town left empty in plain sight of a small army fell the next day; "how much is a
 * trade-off: how likely an enemy is to pop up, how much army you have, how far off you stray").
 * The risk: enemy heroes that reach the town before the hero could come back (within two days for
 * certain, further off as a likelihood), and rival towns that reach it (a hero hired there takes their
 * garrison). The weakest stacks first, enough for the garrison behind the walls to hold; for a certain
 * threat as long as the hero stays stronger than it in the field, for a likely one a third of the
 * army at most. With a certain threat it can't spare a hold for, behind walls a small stack makes a
 * stand (a siege costs the attacker, the towers shoot).
 */
const UNSEEN_GUARD = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AI_UNSEEN ?? 0.2);
/** Unexplored ground within `r` tiles of the town (its side's view). */
function fogNear(s: AdventureState, w: World, player: number, town: AdvObject, r: number): boolean {
  for (let dy = -r; dy <= r; dy += 2)
    for (let dx = -r; dx <= r; dx += 2) {
      const j = w.index(town.x + dx, town.y + dy, town.z);
      if (j >= 0 && !isRevealed(s, player, j)) return true;
    }
  return false;
}

export function leaveGuard(s: AdventureState, w: World, player: number, h: Hero, target: number): AdventureEvent[] {
  const at = w.visitBy[w.index(h.x, h.y, h.z)];
  const town = at ? s.objects[at - 1] : undefined;
  if (!town?.town || town.owner !== player || target === w.index(h.x, h.y, h.z) || h.aiReason === "hide") return [];
  // (A hero of ours holds it from the garrison: the troops it would leave would go to that hero, and the town isn't empty.)
  if (garrisonHero(s, town)) return [];
  // How long the town is on its own: there and back again, in days.
  const cost = findPaths(w, s, h, false, undefined, true).get(target)?.cost ?? h.maxMovement;
  const away = Math.min(6, Math.max(2, 2 * Math.ceil(cost / Math.max(1, h.maxMovement))));
  const enemies = s.heroes.filter((e) => !e.removed && e.owner !== player && !allied(s, e.owner, player) && e.garrison === undefined);
  const sure = enemies.filter((e) => inReach(s, w, e, town.x, town.y, town.z, 2));
  const likely = away > 2 ? enemies.filter((e) => !sure.includes(e) && inReach(s, w, e, town.x, town.y, town.z, away)) : [];
  // (A rival town that reaches ours: what a hero hired there would bring, its garrison.)
  const rivalTowns = s.objects.filter((o) => o.town && !o.removed && o.owner >= 0 && o.owner !== player && !allied(s, o.owner, player) && army(w, o.town.garrison) > 0);
  const fromTowns = rivalTowns.filter((o) => {
    const gate = visitTile(w, o);
    return gate >= 0 && inReach(s, w, { ...h, id: -1 - o.id, owner: o.owner, x: gate % w.size, y: Math.floor(gate / w.size) % w.size, z: o.z, army: o.town!.garrison } as Hero, town.x, town.y, town.z, away);
  });
  // @wiki principle/hold-from-the-garrison Playing from its own view, the computer can't see a rival coming out of the
  // shroud and striking the same day (against ai:growth's raider it lost 0.77 towns a player-week, 0.61 seeing all):
  // unexplored ground a day or two from the town is a rival that may be there, and a fifth of the army stays (not when
  // it rides out to a fight: a guard of 30% then looked too strong, and 56 spell dilemmas went unpaid).
  const fog = s.viewer !== undefined && !w.guardedBy[target] && !sure.length && !likely.length && !fromTowns.length && UNSEEN_GUARD > 0 && fogNear(s, w, player, town, 2 * Math.ceil(h.maxMovement / 100));
  if (!sure.length && !likely.length && !fromTowns.length && !fog) return [];
  // (Not when it rides out to fight one of them: then it needs every troop.)
  const [tx, ty] = [target % w.size, Math.floor(target / w.size) % w.size];
  if ([...sure, ...likely].some((e) => Math.max(Math.abs(e.x - tx), Math.abs(e.y - ty)) <= 2)) return [];
  const sureNeed = sure.length ? Math.max(...sure.map((e) => power(w, e))) * 1.1 : 0;
  const need = Math.max(sureNeed, ...likely.map((e) => power(w, e) * 1.1), ...fromTowns.map((o) => army(w, o.town!.garrison) * 1.1), fog ? UNSEEN_GUARD * power(w, h) : 0);
  const start = power(w, h);
  // What the hero can spare: enough to stay stronger than a certain threat in the field; for a likely one a third.
  const spare = sure.length ? start - sureNeed * 1.1 : start / 3;
  const walls = wallsOf(town);
  const out: AdventureEvent[] = [];
  const worth = (c: ArmySlot | null) => (c ? c.count * (w.creatures[c.creature]?.aiValue ?? 0) : 0);
  for (let left = 0; army(w, town.town.garrison) * walls < need; left++) {
    const stacks = h.army.map((c, slot) => ({ c, slot })).filter((x) => x.c && x.c.count > 0).sort((a, b) => worth(a.c) - worth(b.c));
    if (stacks.length < 2) break;
    const weakest = stacks[0];
    // (Over what it can spare: only the one stand-in stack, behind walls, a small one, against a certain threat.)
    if (start - power(w, h) + worth(weakest.c) > spare && (!sure.length || left > 0 || army(w, town.town.garrison) > 0 || walls === 1 || worth(weakest.c) > 0.1 * start)) break;
    const g = town.town.garrison;
    const slot = g.findIndex((c) => c?.creature === weakest.c!.creature);
    const to = slot >= 0 ? slot : g.findIndex((c) => !c || c.count === 0);
    if (to < 0) break;
    const got = act(s, w, player, { type: "moveStack", town: town.id, from: { who: "hero", slot: weakest.slot }, to: { who: "garrison", slot: to } });
    if (!got) break;
    out.push(...got);
  }
  if (out.length) markGuard(s, player, town.id);
  return out;
}

/**
 * @wiki principle/run-from-the-stronger
 * The target, unless the hero would end the day on the way there in a day's reach of an enemy that
 * would beat it (weak heroes walked into the open and were picked off, three in one enemy turn):
 * then a refuge in today's reach, a town of ours that holds first (its walls and garrison), else
 * the nearest tile out of reach, or where it stands (-1, aiReason "hide"). With none, the target
 * after all.
 */
/** The Sanctuary: a hero in it can't be attacked. */
export const SANCTUARY = 80;

/** The rivals in the field that would beat the hero, and whether a tile is in a day's reach of one (none: undefined). */
export function dangerFor(s: AdventureState, w: World, h: Hero) {
  const stronger = strongerEnemies(w, h, s.heroes.filter((e) => !e.removed && e.owner !== h.owner && !allied(s, e.owner, h.owner) && e.garrison === undefined));
  if (!stronger.length) return undefined;
  const danger = (i: number) => stronger.some((e) => inReach(s, w, e, i % w.size, Math.floor(i / w.size) % w.size, Math.floor(i / (w.size * w.size))));
  return { stronger, danger };
}

/**
 * Townless, a town to take: the days left run out hiding, so the hero goes, danger and all (the owner's
 * 10-27 game: its town lost, two heroes hid in a pocket by it for days while the deadline ran).
 */
export function desperateFor(s: AdventureState, w: World, h: Hero, goal: number): boolean {
  if (goal < 0 || s.players[h.owner].townlessSince === undefined) return false;
  const o = w.visitBy[goal] ? s.objects[w.visitBy[goal] - 1] : undefined;
  return !!o?.town && o.owner !== h.owner;
}

/** Where the hero's walk to the target ends today (its own tile when nothing of the way is in reach). */
export function stopToday(w: World, h: Hero, paths: Map<number, PathNode>, target: number): number {
  let stop = w.index(h.x, h.y, h.z);
  for (const i of mapPathTo(paths, target)) {
    if ((paths.get(i)?.cost ?? Infinity) > h.movement) break;
    stop = i;
  }
  return stop;
}

export function safeStop(s: AdventureState, w: World, h: Hero, paths: Map<number, PathNode>, target: number): number {
  if (target < 0 || h.boat !== undefined) return target;
  // (On its way home to hold a town with the others: the plan counted on it, danger and all.)
  const call = calledTo(s, w, h);
  if (call && visitTile(w, call) === target) return target;
  const threat = dangerFor(s, w, h);
  if (!threat) return target;
  const { stronger, danger } = threat;
  const here = w.index(h.x, h.y, h.z);
  if (!danger(stopToday(w, h, paths, target))) return target;
  const mine = power(w, h);
  const holds = (town: AdvObject, i: number) => {
    const held = defended(w, town, mine);
    return stronger.every((e) => power(w, e) < held || !inReach(s, w, e, i % w.size, Math.floor(i / w.size) % w.size, Math.floor(i / (w.size * w.size))));
  };
  let best = -1;
  let bestCost = Infinity;
  // (Walked paths only: a refuge past a monolith or a gate was out of the move's reach, "no path" 30 times on Gambit.)
  for (const [i, node] of findPaths(w, s, h)) {
    if (node.cost > h.movement || node.passOnly || (w.heroAt[i] && i !== here) || w.guardedBy[i]) continue;
    const o = w.visitBy[i] ? s.objects[w.visitBy[i] - 1] : undefined;
    const town = !!o?.town && o.owner === h.owner;
    // A Sanctuary: no one fights a hero in it, the strongest enemy at its door or not.
    const sanctuary = o?.type === SANCTUARY;
    // (A town only where it holds against them, the hero and garrison behind the walls: else the hero falls with it.)
    if ((o && !town && !sanctuary) || (danger(i) && !sanctuary && !(town && holds(o!, i)))) continue;
    const cost = node.cost - (town || sanctuary ? 1e6 : 0);
    if (cost < bestCost) [best, bestCost] = [i, cost];
  }
  // Nowhere out of their reach: as far off as today's walk goes (the costliest for them to come to),
  // not on to the target (a scout stripped of its troops walked on into the open and was caught).
  if (best < 0) {
    const far = (i: number) => {
      const [x, y, z] = [i % w.size, Math.floor(i / w.size) % w.size, Math.floor(i / (w.size * w.size))];
      let least = Infinity;
      for (const e of stronger) {
        const paths = reach(s, w, e);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const node = paths.get(w.index(x + dx, y + dy, z));
            if (node && node.cost < least) least = node.cost;
          }
      }
      return least;
    };
    let bestFar = far(here);
    for (const [i, node] of findPaths(w, s, h)) {
      if (node.cost > h.movement || node.passOnly || (w.heroAt[i] && i !== here) || w.guardedBy[i] || w.visitBy[i]) continue;
      const d = far(i);
      if (d > bestFar + 100) [best, bestFar] = [i, d];
    }
    if (best < 0) return target;
  }
  if (best === here) return (h.aiReason = "hide"), -1;
  return (h.aiReason = "hide"), best;
}

/**
 * @wiki principle/stand-behind-walls
 * Our towns with an enemy hero closing in that the garrison can't hold: the strong go home.
 */
export function homeDefence(s: AdventureState, w: World, h: Hero, paths: Map<number, PathNode>, enemies: Hero[], consider: Consider) {
  const mine = power(w, h);
  // Called home to hold a town together: its gate, or the hero of ours holding it there (its troops go to that one).
  const call = calledTo(s, w, h);
  const callGate = call ? visitTile(w, call) : -1;
  const callNode = callGate >= 0 ? paths.get(callGate) : undefined;
  if (callNode && callNode.cost > 0) consider(callGate, WORTH.holdTogether, callNode.cost);
  for (const t of s.objects) {
    if (!t.town || t.removed || t.owner !== h.owner) continue;
    const gate = visitTile(w, t);
    const node = gate >= 0 ? paths.get(gate) : undefined;
    if (!node) continue;
    const garrison = army(w, t.town.garrison);
    // A real threat: within a day's walk, stronger than the garrison and worth a fight for us.
    // (Two days off counts for our own towns: a hero that wandered three days away could not come back in time.)
    const danger = enemies.filter((e) => power(w, e) > garrison * 1.2 && power(w, e) > 0.4 * mine && inReach(s, w, e, t.x, t.y, t.z, 2));
    if (!danger.length || w.heroAt[gate]) continue;
    const worst = Math.max(...danger.map((e) => power(w, e)));
    if (mine > 0.8 * worst && node.cost <= h.movement + h.maxMovement) consider(gate, WORTH.defendHome, node.cost);
  }
}
