// Adventure map AI. It plays only through applyAdventureAction, like a human player would.
import { BANKS } from "../bankData.ts";
import { SPELL_SCROLL } from "./artifacts.ts";
import { COMBOS, LOCKED, SLOT, assemblable, comboFit, hasBonus, slotsOf } from "./artifacts.ts";
import { Refusal } from "../refusal.ts";
import { mapData } from "./objects.ts";
import { type PathNode, airshipStop, boatAt as anyBoatAt, findPaths, isAirship, isStop, mapPathTo } from "./movement.ts";
import { type AdventureAction, type AdventureEvent, GRAIL_ARTIFACT, abandonedMine, allied, applyAdventureAction, battleFor, canAct, cannotBuildBoat, cannotDig, isAirshipYard, dwellingCreatures, dwellingPrice, heroesOf, mapHeroesOf } from "./rules.ts";
import { B, addToStacks, affordableCount, garrisonHero, visitingHero } from "./town.ts";
import { type Quest, questDone, questExpired } from "./quests.ts";
import { scriptQuestReady, scriptedQuest } from "./scripts.ts";
import { type AdventureState, type AdvObject, type ArmySlot, type Hero, Obj } from "./types.ts";
import { aiSeesAll, bridged, onView } from "./aiView.ts";
import { type World, MONOLITH_ONE_WAY_ENTRANCE, MONOLITH_TWO_WAY, SUBTERRANEAN_GATE, isRevealed, teleportExits, tileSpan, visitTile, Terrain } from "./world.ts";
import { buyBook, fits, manageTowns, recruitAll, upgradeAll } from "./aiTowns.ts";
import { GOAL_WORTH, LOSS_WEIGHT, type NearGrid, UNBEATABLE, aiGoal, artifactWorth, completes, goalGuards, goalSavings, guardedLoot, mapHasWater, nearGrid, objectValue, objectWorth, odds, useService, worthSaving } from "./aiWorth.ts";
import { traitsOf } from "./aiPersonality.ts";
import { WORTH, aiEnv } from "./aiValues.ts";
import { engineOf, inRollout, searchStop } from "./aiSearch.ts";
import { guarded, keptMain } from "./aiRoles.ts";
import { freshTurn } from "./fresh/index.ts";
import { diary, diaryAction, diaryMove, diaryOpen, diaryStays } from "./aiDiary.ts";
import { army, boldness, calledTo, canBeat, carriesArmy, ferries, holdsTown, townCalls, homeDefence, inReach, leaveGuard, contested, leavesTownsOpen, power, SANCTUARY, safeStop, desperateFor, strongerEnemies, threatened } from "./aiThreat.ts";
import { castForKnowledge, scuttleBoat, doorToward, portalForTroops, portalHome, castToReach, castToGetOut, doorOver } from "./aiSpells.ts";

/** The boats the AI sails (HotA's airships are weighed apart: see bestFlight). */
export const seaBoatAt = (w: World, s: AdventureState, i: number) => {
  const b = anyBoatAt(w, s, i);
  return b && !isAirship(b) ? b : undefined;
};

export { RESOURCE_VALUE } from "./aiValues.ts";

/**
 * The AI's actions the rules turned down, by kind and reason ("recruit: Not enough resources.").
 * Each one is the AI and the rules disagreeing about what's allowed; the simulations list them.
 */
export const aiRefusals = new Map<string, number>();

export function act(s: AdventureState, w: World, player: number, action: AdventureAction): AdventureEvent[] | null {
  // (The game just ended in the middle of the turn, a town taken or a battle won: nothing more to do.)
  if (s.winner !== undefined) return null;
  try {
    // (On the computer's view, the move goes to the real game: aiView.ts.)
    const out = bridged(s, action, player) ?? applyAdventureAction(s, w, action, player);
    diaryAction(s, w, player, action);
    return out;
  } catch (e) {
    // (Not a Refusal: an error inside the rules, a bug; its kind leads the key.)
    const bug = e instanceof Refusal ? "" : `BUG ${e instanceof Error ? e.name : "throw"} `;
    const key = `${bug}${action.type}: ${(e instanceof Error ? e.message : String(e)).replace(/\d+/g, "#")}`;
    aiRefusals.set(key, (aiRefusals.get(key) ?? 0) + 1);
    diary(s, player, `refused: ${key}`);
    return null;
  }
}

/** The player's strongest hero: the one the others feed troops to. */
/** What the Grail is worth digging up (its town building: 5000 gold a day, faster growth). */
export const GRAIL_WORTH = WORTH.grail;

/** Where the Grail lies once this player has visited every obelisk (the puzzle map shows it whole), or -1. */
function knownGrail(s: AdventureState, w: World, player: number): number {
  const g = s.grail;
  if (!g || g.found) return -1;
  const obelisks = s.objects.filter((o) => o.type === 57).length;
  if (!obelisks || (s.players[player].obelisks?.length ?? 0) < obelisks) return -1;
  const i = w.index(g.x, g.y, g.z);
  return (s.holes ?? []).includes(i) ? -1 : i;
}
const graveUnder = (s: AdventureState, w: World, h: Hero) => {
  const o = s.objects[w.visitBy[w.index(h.x, h.y, h.z)] - 1];
  return o && !o.removed && o.type === 212 && o.subid === 1001 ? o : undefined;
};
const atKnownGrail = (s: AdventureState, w: World, h: Hero) => h.boat === undefined && knownGrail(s, w, h.owner) === w.index(h.x, h.y, h.z) && knownGrail(s, w, h.owner) >= 0;

function mainHero(s: AdventureState, w: World, player: number): Hero | undefined {
  const best = heroesOf(s, player).sort((a, b) => power(w, b) - power(w, a))[0];
  return engineOf(s, player) === "roles" ? keptMain(s, w, player, best) : best;
}
export { mainHero };

/** Does `main` have room for at least one of `other`'s stacks? */
function canTake(main: Hero, other: Hero): boolean {
  // (Something to hand over: a hero keeps one creature to travel with, so a lone one has nothing; it met the main hero a dozen times a day.)
  if (other.army.reduce((n, a) => n + (a?.count ?? 0), 0) <= 1) return false;
  return other.army.some((a) => a && main.army.some((b) => !b || b.creature === a.creature));
}

/** Meeting our main hero: hand over every stack it has room for, keeping one creature to travel with. */
function feedMainHero(s: AdventureState, w: World, player: number, a: Hero, b: Hero) {
  // (Holding a town together: the troops go to the one in its gate, whichever is stronger.)
  const holder = (x: Hero, y: Hero) => {
    const town = calledTo(s, w, y);
    return !!town && w.index(x.x, x.y, x.z) === visitTile(w, town);
  };
  const main = holder(a, b) ? a : holder(b, a) ? b : power(w, a) >= power(w, b) ? a : b;
  const other = main === a ? b : a;
  const ids: [number, number] = [main.id, other.id];
  for (let slot = 0; slot < other.army.length; slot++) {
    const st = other.army[slot];
    if (!st) continue;
    const dest = main.army.findIndex((x) => x?.creature === st.creature);
    const to = dest >= 0 ? dest : main.army.findIndex((x) => !x);
    if (to < 0) continue;
    // The last stack leaves one behind (a hero needs troops).
    const last = other.army.filter((x) => x).length === 1;
    const count = last ? st.count - 1 : st.count;
    if (count <= 0) continue;
    act(s, w, player, { type: "transfer", heroes: ids, kind: "army", from: { who: 1, slot }, to: { who: 0, slot: to }, count: last ? count : undefined });
  }
  // The parts of a set the main hero has begun go to it, to be put together (a hero hired on the first day grabbed one).
  const parts = (h: Hero) => [...(h.equipped ?? []), ...(h.backpack ?? [])];
  const started = Object.values(COMBOS).filter((list) => list.some((p) => parts(main).includes(p)));
  for (const list of started)
    for (const p of list) {
      if (parts(main).includes(p)) continue;
      const slot = (other.equipped ?? []).indexOf(p);
      const bag = (other.backpack ?? []).indexOf(p);
      if (slot < 0 && bag < 0) continue;
      try {
        act(s, w, player, { type: "transfer", heroes: ids, kind: "artifact", from: slot >= 0 ? { who: 1, slot } : { who: 1, backpack: bag }, to: { who: 0, backpack: (main.backpack ?? []).length } });
      } catch {
        // (Refused: it stays where it is.)
      }
    }
  if (started.length) assembleSets(s, w, player, main);
  // The rest of what the other carries and the main hero can use goes to it too (the main hero fights
  // the battles): worn things and the pack, not the spellbook, war machines or scrolls.
  for (let slot = SLOT.MACH1 - 1; slot >= 0; slot--) {
    const id = (other.equipped ?? [])[slot] ?? -1;
    if (id < 0 || id === SPELL_SCROLL || artifactWorth(s, w, main, id) <= 0) continue;
    tryAct(s, w, player, { type: "transfer", heroes: ids, kind: "artifact", from: { who: 1, slot }, to: { who: 0, backpack: (main.backpack ?? []).length } });
  }
  for (let k = (other.backpack ?? []).length - 1; k >= 0; k--) {
    const id = other.backpack![k];
    if (id === SPELL_SCROLL || artifactWorth(s, w, main, id) <= 0) continue;
    tryAct(s, w, player, { type: "transfer", heroes: ids, kind: "artifact", from: { who: 1, backpack: k }, to: { who: 0, backpack: (main.backpack ?? []).length } });
  }
  wearBest(s, w, player, main);
  wearBest(s, w, player, other);
}

/** An action that may be refused (left undone then); whether it went through. */
function tryAct(s: AdventureState, w: World, player: number, a: AdventureAction): boolean {
  try {
    return !!act(s, w, player, a);
  } catch {
    return false;
  }
}

/**
 * Artifacts in the pack put on: into a free slot, or for a worn one of less worth (that one goes to
 * the pack). Not the war machines' slots or the spellbook's, nor a slot a combination holds.
 */
function wearBest(s: AdventureState, w: World, player: number, h: Hero) {
  for (let k = (h.backpack ?? []).length - 1; k >= 0; k--) {
    const id = h.backpack![k];
    if (id === SPELL_SCROLL) continue;
    const worth = artifactWorth(s, w, h, id);
    if (worth <= 0) continue;
    const eq = h.equipped ?? [];
    let best = -1;
    let low = worth;
    for (const sl of slotsOf(w.data.artifacts, id)) {
      if (sl >= SLOT.MACH1 || eq[sl] === LOCKED || COMBOS[eq[sl]] || h.combos?.[sl]) continue;
      // A combination needs free slots for its other parts too.
      if (COMBOS[id] && !comboFit(w.data.artifacts, eq.map((a, i) => (i === sl ? -1 : a)), id, sl)) continue;
      const v = eq[sl] >= 0 ? artifactWorth(s, w, h, eq[sl]) : -1;
      if (v < low) [best, low] = [sl, v];
    }
    if (best >= 0) tryAct(s, w, player, { type: "equip", hero: h.id, from: { backpack: k }, to: { slot: best } });
  }
}

/** Stacks of one creature in two slots (an upgraded stack beside its kin) joined, freeing a slot, as a player would. */
function mergeStacks(s: AdventureState, w: World, player: number, h: Hero) {
  for (let i = 0; i < h.army.length; i++) {
    const kind = h.army[i]?.creature;
    if (kind === undefined) continue;
    for (let j = i + 1; j < h.army.length; j++)
      if (h.army[j]?.creature === kind) tryAct(s, w, player, { type: "transfer", heroes: [h.id, h.id], kind: "army", from: { who: 0, slot: j }, to: { who: 0, slot: i } });
  }
}

/** The land's walkable stretches: each tile's region (-1: water, rock, blocked), neighbours joined. */
const regionsOf = new WeakMap<World, Int32Array>();
export function landRegions(w: World): Int32Array {
  const known = regionsOf.get(w);
  if (known) return known;
  const region = landRegionsNow(w);
  regionsOf.set(w, region);
  return region;
}
function landRegionsNow(w: World): Int32Array {
  const n = w.levels * w.size * w.size;
  const region = new Int32Array(n).fill(-1);
  const open = (i: number) => i >= 0 && w.map.tiles[i]?.terrain !== Terrain.WATER && !w.blocked(i);
  let id = 0;
  for (let i = 0; i < n; i++) {
    if (region[i] >= 0 || !open(i)) continue;
    const queue = [i];
    region[i] = id;
    while (queue.length) {
      const j = queue.pop()!;
      const x = j % w.size;
      const y = Math.floor(j / w.size) % w.size;
      const z = Math.floor(j / (w.size * w.size));
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const k = w.index(x + dx, y + dy, z);
          if (k >= 0 && region[k] < 0 && open(k)) (region[k] = id), queue.push(k);
        }
    }
    id++;
  }
  return region;
}

/** What the objects in the water within ten tiles of a boat are worth to the hero (each counted at most 5000). */
function seaWorth(s: AdventureState, w: World, h: Hero, boat: AdvObject, enemies: Hero[]): number {
  // (Only the boat's own stretch of water: what lies past a whirlpool counts through the whirlpool's
  // worth, troops lost on the way and all. Counted in full, a hero boarded for it, found the whirlpool
  // not worth its toll from the deck, landed, and boarded again, day after day.)
  const sea = seaRegions(w);
  const home = sea[w.index(boat.x, boat.y, boat.z)];
  const values: number[] = [];
  for (const o of s.objects) {
    if (o.removed || o.type === Obj.BOAT || o.z !== boat.z || tileSpan(o, boat) > 10) continue;
    const gate = visitTile(w, o);
    if (gate < 0 || w.map.tiles[gate]?.terrain !== Terrain.WATER || (home >= 0 && sea[gate] !== home)) continue;
    values.push(Math.max(0, Math.min(5000, objectValue(s, w, h, o, enemies))));
  }
  return bestAndRest(values);
}
/**
 * What a switch between land and water opens: the best thing there, and a share of the rest. (Summed in
 * full, the shore and the sea each looked better from the other side than the one target the hero then
 * picked there: it landed, boarded, landed again, a day's walk spent on each.)
 */
function bestAndRest(values: number[]): number {
  const best = Math.max(0, ...values);
  return best + 0.3 * (values.reduce((a, v) => a + v, 0) - best);
}

/** The water's stretches, as landRegions the land's: each tile's sea (-1: land). */
const seasOf = new WeakMap<World, Int32Array>();
function seaRegions(w: World): Int32Array {
  const known = seasOf.get(w);
  if (known) return known;
  const n = w.levels * w.size * w.size;
  const sea = new Int32Array(n).fill(-1);
  const wet = (i: number) => i >= 0 && w.map.tiles[i]?.terrain === Terrain.WATER;
  let id = 0;
  for (let i = 0; i < n; i++) {
    if (sea[i] >= 0 || !wet(i)) continue;
    const queue = [i];
    sea[i] = id;
    while (queue.length) {
      const j = queue.pop()!;
      const [x, y, z] = [j % w.size, Math.floor(j / w.size) % w.size, Math.floor(j / (w.size * w.size))];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const k = w.index(x + dx, y + dy, z);
          if (k >= 0 && sea[k] < 0 && wet(k)) (sea[k] = id), queue.push(k);
        }
    }
    id++;
  }
  seasOf.set(w, sea);
  return sea;
}

/**
 * A whirlpool, when it lets out into other water than this (the same water is sailed to instead):
 * what lies within six tiles of the way out (each counted at most 5000, the exits' mean), less half
 * of the weakest stack, which the sea takes (nothing with the Sea Captain's Hat).
 */
export function whirlpoolWorth(s: AdventureState, w: World, h: Hero, o: AdvObject, enemies: Hero[]): number {
  const exits = s.objects.filter((x) => !x.removed && x.type === Obj.WHIRLPOOL && x !== o);
  const sea = seaRegions(w);
  const from = visitTile(w, o);
  if (!exits.length || from < 0) return 0;
  let worth = 0;
  for (const e of exits) {
    const to = visitTile(w, e);
    if (to < 0 || sea[to] === sea[from]) continue;
    for (const x of s.objects) {
      if (x.removed || x.type === Obj.WHIRLPOOL || x.type === Obj.BOAT || x.z !== e.z || tileSpan(x, e) > 6) continue;
      worth += Math.max(0, Math.min(5000, objectValue(s, w, h, x, enemies))) / exits.length;
    }
  }
  if (!worth || hasBonus(h, "WHIRLPOOL_PROTECTION")) return worth;
  const weakest = h.army.filter((x): x is ArmySlot => !!x).sort((a, b) => a.count * (w.creatures[a.creature]?.hp ?? 1) - b.count * (w.creatures[b.creature]?.hp ?? 1))[0];
  const lost = weakest && weakest.count > 1 ? Math.ceil(weakest.count / 2) * (w.creatures[weakest.creature]?.aiValue ?? 0) : 0;
  return worth - lost * LOSS_WEIGHT;
}

/**
 * With three or more sides left, the leading rival (towns and armies) is worth more to beat: the
 * others gang up on it, as players do, instead of picking off the weakest while the leader runs away.
 */
const leaderCache = new WeakMap<AdventureState, { key: string; leader: number }>();
export function leaderBonus(s: AdventureState, w: World, player: number, owner: number): number {
  if (owner < 0 || owner === player || allied(s, owner, player)) return 1;
  const key = `${s.day}:${player}`;
  let c = leaderCache.get(s);
  if (!c || c.key !== key) {
    const score = new Map<number, number>();
    for (const p of s.players) if (p.alive && p.color !== player && !allied(s, p.color, player)) score.set(p.color, 0);
    for (const o of s.objects) if (o.town && !o.removed && score.has(o.owner)) score.set(o.owner, score.get(o.owner)! + 15000 + army(w, o.town.garrison));
    for (const h of s.heroes) if (!h.removed && score.has(h.owner)) score.set(h.owner, score.get(h.owner)! + army(w, h.army));
    const sides = new Set([...score.keys()].map((p) => s.players[p].team ?? -1 - p));
    const top = [...score].sort((a, b) => b[1] - a[1])[0];
    leaderCache.set(s, (c = { key, leader: sides.size >= 2 && top ? top[0] : -1 }));
  }
  return owner === c.leader || (c.leader >= 0 && allied(s, owner, c.leader)) ? LEADER_BONUS : 1;
}
const LEADER_BONUS = 1.3;
/**
 * Rival towns and heroes out of today's reach (past guards we can beat, objects in the way, days
 * off): the route there planned through them, and its first leg, up to the first stop, worth the
 * prize at the whole route's cost. Without it a hero never left the land it had emptied while weak
 * guards stood between it and the enemy (the advanced starts: the AI never came for the player).
 */
/** A border guard or gate (a quest gate) the hero can't pass: no key of its colour, the quest not done. */
export function locked(s: AdventureState, w: World, h: Hero, o: AdvObject): boolean {
  if ((o.type !== 9 && o.type !== 212) || o.subid === 1001) return false;
  if (o.subid === 1000 && o.data?.opened) return false;
  if (o.subid === 1000 && scriptedQuest(w, o)) return !scriptQuestReady(s, w, h, o);
  if (o.subid === 1000) return !(questDone(s, w, h, mapData(w, o) as unknown as Quest) && !questExpired(s, mapData(w, o) as unknown as Quest));
  return !s.players[h.owner].keys?.includes(o.subid);
}

const sailCache: { day: number; state?: AdventureState; maps: Map<string, { reach: number; paths: Map<number, PathNode> }> } = { day: -1, maps: new Map() };

function marchOn(s: AdventureState, w: World, h: Hero, paths: Map<number, PathNode>, enemies: Hero[], consider: (i: number, value: number, cost: number) => void, bestScore: number) {
  const mine = power(w, h);
  const bold = boldness(s, h.owner);
  const rivals = traitsOf(s, h.owner).rivals;
  const beatable = (o: AdvObject | undefined) => !!o && o.type === Obj.MONSTER && mine > bold.march * (o.amount ?? 0) * (w.creatures[o.subid]?.aiValue ?? 0);
  const prizes: [number, number][] = [];
  // (The map's victory goal is the game: gone for, even rivals and open towns and all. See evenRivals.)
  const decisive = new Set<number>();
  for (const e of enemies) {
    const i = w.index(e.x, e.y, e.z);
    // (Not one only remembered where it was last seen, out of sight now: marched on across the map, a leader's five
    // heroes went after a 300-creature scout's old tracks for weeks while an empty rival town stood by. It still counts
    // as a threat, and within today's reach as a prize: the walk there shows it.)
    if (e.garrison === undefined && !e.unseen && !paths.has(i) && canBeat(s, w, h, e)) prizes.push([i, heroPrize(s, w, e) * leaderBonus(s, w, h.owner, e.owner) * rivals + (aiGoal(s)?.type === 5 && aiGoal(s)?.hero === e.id ? GOAL_WORTH : 0)]);
  }
  // The monster to beat or the artifact to find for the map's victory, out of today's reach.
  const goal = aiGoal(s);
  for (const o of goal && [0, 7, 10].includes(goal.type) ? s.objects : []) {
    if (o.removed || !(goal!.type === 7 ? o.id === goal!.object : o.type === Obj.ARTIFACT && o.subid === goal!.artifact)) continue;
    const at = visitTile(w, o);
    const v = at >= 0 && !paths.has(at) ? objectValue(s, w, h, o, enemies) : 0;
    if (v > 0) prizes.push([at, v]), decisive.add(at);
  }
  for (const t of s.objects) {
    if (!t.town || t.removed || (t.owner >= 0 && allied(s, t.owner, h.owner))) continue;
    const gate = visitTile(w, t);
    if (gate < 0 || paths.has(gate) || w.heroAt[gate]) continue;
    const v = objectValue(s, w, h, t, enemies);
    if (v > 0) prizes.push([gate, v]);
    if (v > 0 && aiGoal(s)?.type === 6 && aiGoal(s)?.object === t.id) decisive.add(gate);
  }
  // The first week goes to the land around (marching on day 1 had heroes fight their way past what
  // they'd otherwise judge: dilemmas fell from 2351 to 2031).
  if (!prizes.length || s.day <= bold.marchAfter) return;
  // (No further than a prize could still beat the best found so far: its score is at most twice
  // value / (cost + 300). On a map with water the search goes on until every prize is reached or
  // none is left to reach: those it never reaches are the ones over the sea.)
  const cap = bestScore > 0 ? Math.max(...prizes.map(([, v]) => (2 * v) / bestScore)) - 300 : Infinity;
  const left = new Set(prizes.map(([i]) => i));
  const water = mapHasWater(w);
  const enough = (i: number, cost: number) => {
    left.delete(i);
    return cost > cap && (!water || !left.size);
  };
  const far = findPaths(w, s, h, false, (i) => {
    if (w.heroAt[i]) return false;
    const guard = w.guardedBy[i] ? s.objects[w.guardedBy[i] - 1] : undefined;
    if (guard && !beatable(guard)) return false;
    const o = w.visitBy[i] ? s.objects[w.visitBy[i] - 1] : undefined;
    // (Not through a gate it has no key for: heroes stood at one for days on Gambit.)
    // (Nor through a creature bank or an abandoned mine whose guards it can't beat: For Sale's road
    // to the castle passed Medusa Stores, and heroes with one Dwarf walked in.)
    const guarded = !!o && ((!!BANKS[`${o.type}:${o.subid}`] && !o.bank?.cleared) || !!abandonedMine(s, w, o)) && objectWorth(s, w, h, o, enemies) <= 0;
    return !(o?.type === Obj.MONSTER && !beatable(o)) && !(o && locked(s, w, h, o)) && !guarded;
  }, false, enough);
  for (const [goal, value] of prizes) {
    const node = far.get(goal);
    if (!node) continue;
    // The first leg: from the start along the route while today's paths agree, ending at the first stop.
    const route = mapPathTo(far, goal);
    let step = -1;
    for (const i of route.slice(1)) {
      if (!paths.has(i)) break;
      step = i;
      if (isStop(w, s, i)) break;
    }
    const [sx, sy, sz] = [step % w.size, Math.floor(step / w.size) % w.size, Math.floor(step / (w.size * w.size))];
    if (step >= 0 && !threatened(s, w, h, sx, sy, sz, enemies) && (decisive.has(goal) || (!contested(s, w, h, sx, sy, sz, enemies) && !leavesTownsOpen(s, w, h, Math.ceil(node.cost / Math.max(1, h.maxMovement)))))) consider(step, value, node.cost);
  }
  // Across the water (islands): the prizes no road leads to, by boat. At sea, the landing on the
  // prize's own shore; ashore, a free boat in reach, worth the voyage it starts.
  const overSea = prizes.filter(([goal]) => !far.has(goal));
  if (!overSea.length || !mapHasWater(w)) return;
  const region = landRegions(w);
  const landing = (sea: Map<number, PathNode>, goal: number): [number, number] | undefined => {
    const gx = goal % w.size;
    const gy = Math.floor(goal / w.size) % w.size;
    const gz = Math.floor(goal / (w.size * w.size));
    let best: [number, number] | undefined;
    for (let dy = -8; dy <= 8; dy++)
      for (let dx = -8; dx <= 8; dx++) {
        const j = w.index(gx + dx, gy + dy, gz);
        const node = j >= 0 ? sea.get(j) : undefined;
        if (!node || w.map.tiles[j]?.terrain === Terrain.WATER || region[j] < 0 || region[j] !== region[goal] || w.heroAt[j]) continue;
        const cost = node.cost + 100 * Math.max(Math.abs(dx), Math.abs(dy));
        if (!best || cost < best[1]) best = [j, cost];
      }
    return best;
  };
  if (h.boat !== undefined) {
    for (const [goal, value] of overSea) {
      const land = landing(paths, goal);
      if (land) consider(land[0], value * 0.8, land[1]);
    }
    return;
  }
  // The voyage's search ends once every prize's landing is settled: a shore tile reached later costs
  // more, and so can't be a cheaper landing (searching the whole sea from every boat in reach, at
  // every step, was most of the AI's time on Myth and Legend).
  const goals = overSea.map(([g]) => g);
  let cheapest = new Map<number, number>();
  let dearest = Infinity;
  // (Nor further than a landing could still be worth the voyage against the best found so far.)
  const sailCap = bestScore > 0 ? Math.max(...overSea.map(([, v]) => (1.4 * v) / bestScore)) - 300 : Infinity;
  let reach = Infinity;
  const landed = (j: number, cost: number) => {
    if (cost > dearest || cost > reach) return true;
    if (w.map.tiles[j].terrain === Terrain.WATER || region[j] < 0 || w.heroAt[j]) return false;
    const x = j % w.size;
    const y = Math.floor(j / w.size) % w.size;
    const z = Math.floor(j / (w.size * w.size));
    let changed = false;
    for (const g of goals) {
      const d = Math.max(Math.abs((g % w.size) - x), Math.abs((Math.floor(g / w.size) % w.size) - y));
      if (d > 8 || Math.floor(g / (w.size * w.size)) !== z || region[j] !== region[g]) continue;
      const c = cost + 100 * d;
      if (c < (cheapest.get(g) ?? Infinity)) cheapest.set(g, c), (changed = true);
    }
    if (changed && cheapest.size === goals.length) dearest = Math.max(...cheapest.values());
    return false;
  };
  for (const [i, node] of paths) {
    const boat = node.cost > 0 ? seaBoatAt(w, s, i) : undefined;
    if (!boat) continue;
    // (From the boat's tile: its anchor is a tile to the right. Kept for the day: each hero weighed
    // each boat in reach at every step. A voyage searched as far reaches as far again.)
    reach = sailCap - node.cost;
    const key = `${h.id}:${i}:${boat.id}:${goals.join(",")}`;
    if (sailCache.day !== s.day || sailCache.state !== s) sailCache.day = s.day, sailCache.state = s, sailCache.maps.clear();
    let sailing = sailCache.maps.get(key);
    if (!sailing || sailing.reach < reach) {
      cheapest = new Map();
      dearest = Infinity;
      sailCache.maps.set(key, (sailing = { reach, paths: findPaths(w, s, { ...h, x: i % w.size, y: Math.floor(i / w.size) % w.size, z: boat.z, boat: boat.id }, false, undefined, false, landed) }));
    }
    let worth = 0;
    let cost = 0;
    for (const [goal, value] of overSea) {
      const land = landing(sailing.paths, goal);
      if (land && value / (land[1] + 300) > worth / (cost + 300)) [worth, cost] = [value * 0.7, land[1]];
    }
    if (worth > 0) consider(i, worth, node.cost + cost);
  }
}

/**
 * Picks the most worthwhile reachable tile for the hero: value per movement spent. What lies past a
 * monolith or a Subterranean Gate counts too: then the way there is the entrance, and from its exit
 * the hero goes on.
 */
export function chooseTarget(s: AdventureState, w: World, h: Hero): number {
  const paths = findPaths(w, s, h, false, undefined, true);
  // Aboard HotA's airship: where to land (nothing can be visited from the air).
  if (h.airship) return airshipLanding(s, w, h, paths);
  // A free airship is boarded only for a flight to what can't be walked to (pickTarget weighs it).
  const ships = new Map<number, { node: PathNode; ship: AdvObject }>();
  for (const o of s.objects)
    if (!o.removed && o.carriedBy === undefined && isAirship(o)) {
      const t = visitTile(w, o);
      const node = paths.get(t);
      if (node && !w.heroAt[t]) ships.set(t, { node, ship: o }), paths.delete(t);
    }
  const via = (best: number) => {
    const route = best >= 0 ? mapPathTo(paths, best) : [];
    const gate = route.findIndex((i, k) => k > 0 && k < route.length - 1 && w.teleportTo[i] - 1 === route[k + 1]);
    return gate >= 0 ? route[gate] : best;
  };
  const best = pickTarget(s, w, h, paths, ships);
  // (Back for the route: a way may lead past one.)
  for (const [t, { node }] of ships) paths.set(t, node);
  // (Townless, a town to take: gone for, danger and all; see desperateFor.)
  if (desperateFor(s, w, h, best)) return via(best);
  return safeStop(s, w, h, paths, via(best));
}

/**
 * Where allied human players' heroes are heading (the tiles they were sent to, and as negative ids
 * the object there and the monster guarding it): an allied computer player leaves those to them.
 */
export function friendsGoals(s: AdventureState, w: World, player: number): Set<number> {
  const out = new Set<number>();
  for (const e of s.heroes) {
    if (e.removed || e.heading === undefined || !allied(s, e.owner, player) || s.players[e.owner]?.controller !== "human") continue;
    out.add(e.heading);
    if (w.visitBy[e.heading]) out.add(-w.visitBy[e.heading]);
    if (w.guardedBy[e.heading]) out.add(-w.guardedBy[e.heading]);
  }
  return out;
}
/** Weighs a candidate tile: its value per movement spent (cost), against the best so far. */
export type Consider = (i: number, value: number, cost: number) => void;
/** One target search: the hero, where it can walk today, its rivals, and the best tile so far. */
interface Pick {
  s: AdventureState;
  w: World;
  h: Hero;
  paths: Map<number, PathNode>;
  enemies: Hero[];
  mine: number;
  traits: ReturnType<typeof traitsOf>;
  /** Tiles worth only the open ground around them (an explorer's): still scouting, for the spells and boats that wait on it. */
  fogOnly: Set<number>;
  best: number;
  bestScore: number;
  consider: Consider;
  /** For the search engine's outlook (aiSearch.ts): no danger filters, every target kept. */
  raw?: boolean;
}
const tileXYZ = (w: World, i: number) => [i % w.size, Math.floor(i / w.size) % w.size, Math.floor(i / (w.size * w.size))] as const;

/**
 * The hero's target: every source of targets weighs its tiles (value per movement), the best wins.
 * In order: shelter from a far stronger enemy, what lies in today's reach (rivals, our heroes, things
 * and guards), rivals further off, the Grail, multi-exit monoliths, our threatened towns, boats and
 * airships, landings from the sea; with nothing, the fallbacks (clearing the way, exploring, a boat,
 * through a visited place, regrouping).
 */
function pickTarget(s: AdventureState, w: World, h: Hero, paths: Map<number, PathNode>, ships = new Map<number, { node: PathNode; ship: AdvObject }>()): number {
  const enemies = s.heroes.filter((e) => !e.removed && e.owner !== h.owner && (s.players[e.owner]?.team === undefined || s.players[e.owner].team !== s.players[h.owner].team));
  const claimed = friendsGoals(s, w, h.owner);
  const p: Pick = { s, w, h, paths, enemies, mine: power(w, h), traits: traitsOf(s, h.owner), fogOnly: new Set(), best: -1, bestScore: 0, consider: () => {} };
  // The search engine plays the main hero's best few stops out (aiSearch.ts).
  const searching = engineOf(s, h.owner) === "search" && !inRollout() && mainHero(s, w, h.owner) === h;
  const cands: { i: number; score: number }[] = [];
  // Sticking with yesterday's goal beats switching to something slightly better.
  p.consider = (i, value, cost) => {
    // (Water or rock crossed by Fly or Water Walk: a way through, not a place to stop.)
    if (paths.get(i)?.passOnly) return;
    // (What an allied human's hero is on its way to is theirs: not raced for.)
    if (claimed.size && (claimed.has(i) || (w.visitBy[i] && claimed.has(-w.visitBy[i])) || (w.guardedBy[i] && claimed.has(-w.guardedBy[i])))) return;
    const score = (value / (cost + 300)) * (i === h.aiTarget ? 2 : 1);
    if (searching && score > 0) cands.push({ i, score });
    if (score > p.bestScore) {
      p.best = i;
      p.bestScore = score;
    }
  };
  if (shelterTargets(p)) return -1;
  inReachTargets(p);
  marchOn(s, w, h, paths, enemies, p.consider, p.bestScore);
  grailTarget(p);
  monolithTargets(p);
  homeDefence(s, w, h, paths, enemies, p.consider);
  boatTargets(p, ships);
  if (h.boat !== undefined) landingTargets(p, false);
  if (searching && p.best >= 0 && !p.fogOnly.has(p.best)) p.best = searchStop(s, w, h, cands.filter((c) => !p.fogOnly.has(c.i))) ?? p.best;
  h.aiExploring = p.fogOnly.has(p.best);
  h.aiReason = h.aiExploring ? "explore" : "value";
  if (p.best >= 0) return p.best;
  if (h.boat !== undefined) landingTargets(p, true);
  if (p.best >= 0) return p.best;
  clearingTargets(p);
  if (p.best >= 0) return (h.aiReason = "clearing"), p.best;
  exploreTargets(p);
  return p.best;
}

/** Every place worth going to, with no danger filters, for the search engine's outlook (aiSearch.ts). */
export function gatherTargets(s: AdventureState, w: World, h: Hero, paths: Map<number, PathNode>): { i: number; value: number; cost: number }[] {
  const enemies = s.heroes.filter((e) => !e.removed && e.owner !== h.owner && (s.players[e.owner]?.team === undefined || s.players[e.owner].team !== s.players[h.owner].team));
  const out: { i: number; value: number; cost: number }[] = [];
  const p: Pick = { s, w, h, paths, enemies, mine: power(w, h), traits: traitsOf(s, h.owner), fogOnly: new Set(), best: -1, bestScore: 0, raw: true, consider: () => {} };
  p.consider = (i, value, cost) => void (value > 0 && !paths.get(i)?.passOnly && out.push({ i, value, cost }));
  inReachTargets(p);
  marchOn(s, w, h, paths, enemies, p.consider, 0);
  return out;
}

/**
 * @wiki principle/run-from-the-stronger
 * A far stronger enemy a day off: a Sanctuary is shelter (no one attacks a hero resting there). At one,
 * the hero stays (true); one in reach today is worth more than anything else.
 */
function shelterTargets({ s, w, h, paths, enemies, consider }: Pick): boolean {
  if (!threatened(s, w, h, h.x, h.y, h.z, enemies)) return false;
  if (w.visitable(s, w.index(h.x, h.y, h.z))?.type === SANCTUARY) return true;
  for (const o of s.objects) {
    const gate = !o.removed && o.type === SANCTUARY ? visitTile(w, o) : -1;
    const node = gate >= 0 && !w.heroAt[gate] ? paths.get(gate) : undefined;
    if (node && node.cost <= h.movement) consider(gate, WORTH.shelter, node.cost);
  }
  return false;
}

/** Every tile in today's reach: a rival hero to beat, a hero of ours to meet, or what stands there and what guards it. */
function inReachTargets(p: Pick) {
  const { s, w, h, paths, enemies, consider } = p;
  const stronger = strongerEnemies(w, h, enemies);
  const opened = new Map<number, boolean>();
  const opens = (days: number) => opened.get(days) ?? opened.set(days, leavesTownsOpen(s, w, h, days)).get(days)!;
  const guardValue = new Map<AdvObject, number>();
  const near: { grid?: NearGrid } = {};
  for (const [i, node] of paths) {
    if (node.cost === 0) continue;
    const [x, y, z] = tileXYZ(w, i);
    const other = w.heroAt[i] ? s.heroes[w.heroAt[i] - 1] : undefined;
    if (other && enemies.includes(other)) {
      rivalHeroTarget(p, i, node, other);
      continue;
    }
    if (other && other.owner === h.owner) {
      ourHeroTarget(p, i, node, other);
      continue;
    }
    // (Townless, a town to take is gone for in a stronger rival's reach too: see desperateFor.)
    if (!p.raw && stronger.length && !desperateFor(s, w, h, i) && stronger.some((e) => inReach(s, w, e, x, y, z))) continue;
    // (Nor a trip past today's walk while a rival we can't beat could take a town of ours meanwhile: see leavesTownsOpen.)
    if (!p.raw && node.cost > h.movement && opens(Math.ceil((node.cost - h.movement) / Math.max(1, h.maxMovement)) + 1)) continue;
    const v = tileTarget(p, i, node, guardValue, near);
    if (v !== undefined && v > 0) consider(i, v, node.cost);
  }
}

/**
 * @wiki principle/beat-weaker-rivals A rival hero beaten: its army's worth, and the hero itself (worth 20,000 when it
 * carries its side's army, a scout only what hiring another costs: main armies spent days chasing 300-strong scouts
 * across Realm of Chaos while their town was taken, 2026-11-01). Nothing at a Sanctuary, where no one can attack it
 * (a 15-million army walked at two heroes resting in Sanctuaries every day for months, and the game never ended).
 */
export const heroPrize = (s: AdventureState, w: World, e: Hero) => (w.visitable(s, w.index(e.x, e.y, e.z))?.type === SANCTUARY ? 0 : (SCOUTS_CHEAP && !carriesArmy(s, w, e) ? WORTH.beatScout : WORTH.beatHero) + army(w, e.army));
const SCOUTS_CHEAP = aiEnv("AI_SCOUT") !== "0";

/** @wiki principle/beat-weaker-rivals A rival hero we beat (a rival wearing the last part of a set we hold is worth the fight). */
function rivalHeroTarget({ s, w, h, traits, consider }: Pick, i: number, node: PathNode, other: Hero) {
  const lastParts = [...(other.equipped ?? []), ...(other.backpack ?? [])].filter((a) => a >= 0).reduce((n, a) => n + (completes(h, a) ? artifactWorth(s, w, h, a) : 0), 0);
  const wanted = aiGoal(s)?.type === 5 && aiGoal(s)?.hero === other.id ? GOAL_WORTH : 0;
  if (canBeat(s, w, h, other)) consider(i, heroPrize(s, w, other) * leaderBonus(s, w, h.owner, other.owner) * traits.rivals + lastParts + wanted, node.cost);
}

/**
 * @wiki principle/one-strong-army
 * A weaker hero of ours brings its troops to our strongest one, and the strongest goes to meet one
 * carrying a real share of an army (the week's growth gathered from the towns): troops with the main
 * army count for more than spread out (a stalemate between even empires otherwise).
 */
function ourHeroTarget({ s, w, h, consider }: Pick, i: number, node: PathNode, other: Hero) {
  const main = mainHero(s, w, h.owner);
  if (other === main && other !== h && army(w, h.army) > 0.05 * army(w, other.army) && canTake(other, h)) consider(i, army(w, h.army) * 1.2, node.cost);
  else if (h === main && other !== h && army(w, other.army) > 0.3 * army(w, h.army) && canTake(h, other)) consider(i, army(w, other.army) * 0.8, node.cost);
}

/**
 * What a free tile is worth: the object on it and, stepping into a monster's zone, the fight (its net
 * worth, then whatever it guarded is open); an explorer's eye adds open ground. Undefined: not to go.
 */
function tileTarget(p: Pick, i: number, node: PathNode, guardValue: Map<AdvObject, number>, near: { grid?: NearGrid }): number | undefined {
  const { s, w, h, paths, enemies, traits } = p;
  const [x, y, z] = tileXYZ(w, i);
  const guard = w.guardedBy[i] ? s.objects[w.guardedBy[i] - 1] : undefined;
  // The guard's net worth (its cost in troops against its experience), and what lies behind it.
  // (Worked out once per guard: each guards up to eight tiles.)
  let fightValue = 0;
  if (guard) {
    const known = guardValue.get(guard);
    fightValue = known ?? objectValue(s, w, h, guard, enemies) + guardedLoot(s, w, h, guard, paths, enemies, (near.grid ??= nearGrid(s)));
    if (known === undefined) guardValue.set(guard, fightValue);
  }
  if (guard && fightValue <= UNBEATABLE) return undefined;
  const o = w.visitable(s, i);
  let v = o && !o.removed && o !== guard ? objectValue(s, w, h, o, enemies) : 0;
  // (A personality's taste for the map's pickups and places; rival towns are weighed as rivals.)
  if (v > 0 && traits.gather !== 1) v *= o!.town && o!.owner !== h.owner ? traits.rivals : o!.town ? 1 : traits.gather;
  // An explorer's eye for open ground: unexplored tiles around a free tile (every other tile looked at).
  const fogTaste = traits.fog || (s.viewer !== undefined ? huntTaste(s, h.owner) : 0);
  if (fogTaste && !o && !guard && !node.passOnly && x % 2 === 0 && y % 2 === 0) {
    let fog = 0;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const j = w.index(x + dx, y + dy, z);
        if (j >= 0 && !isRevealed(s, h.owner, j)) fog++;
      }
    if (fog >= 10 && v <= 0) p.fogOnly.add(i);
    if (fog >= 10) v += fog * fogTaste;
  }
  return v + fightValue;
}

/**
 * @wiki principle/hunt-the-last-towns
 * Rivals still in the game and none of their towns in sight, for a side holding most of the towns it knows: the rivals
 * are under the shroud, and the game ends only when they are found. Every hero gets an explorer's eye. (Without it a leader with 19 towns walked its own land for months
 * while the last rival's town stood underground, never seen: Free for All, 8 fair computers, day 640.)
 */
const HUNT_FOG = Number(aiEnv("AI_HUNT") ?? 200);
const huntCache = new WeakMap<AdventureState, { key: string; taste: number }>();
function huntTaste(s: AdventureState, player: number): number {
  const key = `${s.day}:${player}`;
  const c = huntCache.get(s);
  if (c?.key === key) return c.taste;
  const rivals = s.players.filter((p) => p.alive && p.color !== player && !allied(s, p.color, player)).map((p) => p.color);
  // (Only for a side that holds most of the towns it knows of, after month 3: early on no rival town is in sight either,
  // and every hero exploring instead of gathering cost ai:growth's armies at day 28 a sixth.)
  const known = s.objects.filter((o) => o.town && !o.removed);
  const ours = known.filter((o) => o.owner === player).length;
  const taste = s.day > 84 && rivals.length && 2 * ours >= known.length && !known.some((o) => rivals.includes(o.owner)) ? HUNT_FOG : 0;
  huntCache.set(s, { key, taste });
  return taste;
}

/** The Grail, once the obelisks have shown where it lies: the main hero goes to dig. */
function grailTarget({ s, w, h, paths, consider }: Pick) {
  const grail = knownGrail(s, w, h.owner);
  const atGrail = grail >= 0 ? paths.get(grail) : undefined;
  if (atGrail && atGrail.cost > 0 && !atGrail.passOnly && !w.heroAt[grail]) consider(grail, GRAIL_WORTH, atGrail.cost);
}

/**
 * A monolith with several exits (one at random; the pathfinder only goes through single ones): worth
 * what lies around its exits, on average (Maelstrom's starting pockets lead out only so).
 */
/** The teleports a hero walks into (Subterranean Gate, monoliths' entrances). */
const TELEPORTS = new Set([SUBTERRANEAN_GATE, MONOLITH_ONE_WAY_ENTRANCE, MONOLITH_TWO_WAY]);
/** A way out never seen: worth half the shroud a hero's sight uncovers (11 x 11 tiles at 60 each, placeWorth's rate). */
const UNKNOWN_EXIT = 0.5 * 121 * 60;

function monolithTargets({ s, w, h, paths, enemies, consider }: Pick) {
  for (const [i, node] of paths) {
    const o = node.cost > 0 && !w.guardedBy[i] && !w.heroAt[i] && w.visitBy[i] ? s.objects[w.visitBy[i] - 1] : undefined;
    const exits = o ? teleportExits(s, o) : [];
    if (o && s.day - (h.aiCrossed?.[o.id] ?? -99) < 7) continue;
    // On a player's view a gate or monolith whose way out lies under the shroud leads nowhere known: a way to explore,
    // worth what a walk to the shroud's edge shows (the routes, which end at the shroud, never take it).
    if (o && !exits.length && s.viewer !== undefined && TELEPORTS.has(o.type)) {
      consider(i, UNKNOWN_EXIT, node.cost);
      continue;
    }
    if (exits.length < 2) continue;
    let v = 0;
    for (const e of exits) v += placeWorth(s, w, h, visitTile(w, e), enemies, paths);
    if (v > 0) consider(i, v / exits.length, node.cost);
  }
}

/**
 * Ashore, a boat in reach: worth, at half, what floats within a day's sail of it (flotsam, chests,
 * survivors, sea banks, buoys...), as a landing spot is worth what lies near it ashore. A free airship
 * in reach: worth the best flight it starts, to a prize no walk leads to.
 */
function boatTargets({ s, w, h, paths, enemies, consider }: Pick, ships: Map<number, { node: PathNode; ship: AdvObject }>) {
  if (h.boat === undefined) {
    for (const [i, node] of paths) {
      const boat = node.cost > 0 && !w.heroAt[i] ? seaBoatAt(w, s, i) : undefined;
      if (boat) consider(i, seaWorth(s, w, h, boat, enemies) * 0.5, node.cost);
    }
  }
  for (const [i, { node, ship }] of ships) {
    const flight = bestFlight(s, w, { ...h, x: ship.x, y: ship.y, z: ship.z, boat: ship.id, airship: true }, enemies, paths);
    if (flight) consider(i, flight[1] * 0.7, node.cost + flight[2]);
  }
}

/**
 * At sea: a landing spot is worth what lies near it ashore: things to take, and (only with nothing
 * of worth left in reach, as exploring on land) land to explore. (Exploring first, a hero landed
 * beside the flotsam it had boarded for, and went back and forth between boat and shore.)
 * (Only what can be walked to from there: not a town walled in by rock across the bay.)
 */
function landingTargets({ s, w, h, paths, enemies, consider }: Pick, explore: boolean) {
  const region = landRegions(w);
  for (const [i, node] of paths) {
    if (node.cost === 0 || w.map.tiles[i]?.terrain === Terrain.WATER || w.heroAt[i] || region[i] < 0) continue;
    const [x, y, z] = tileXYZ(w, i);
    let dark = 0;
    const values: number[] = [];
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -5; dx <= 5; dx++) {
        const j = w.index(x + dx, y + dy, z);
        if (j < 0 || region[j] !== region[i]) continue;
        if (explore && !isRevealed(s, h.owner, j)) dark += 60;
        const o = w.visitable(s, j);
        // (What lies right by the landing counts in full: it's sure to be taken from there; further off at a share.)
        if (o && !o.removed && o.owner !== h.owner) values.push(Math.max(0, Math.min(5000, objectValue(s, w, h, o, enemies))) * (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? 1 : 0.3));
      }
    const v = dark + bestAndRest(values);
    if (v > 0) consider(i, v, node.cost);
  }
}

/** Boxed in with nothing left to do: a guard we beat at closer odds opens the way. */
function clearingTargets({ s, w, h, paths, enemies, mine, consider }: Pick) {
  odds.margin = 1.2;
  odds.clearingTheWay = true;
  try {
    for (const [i, node] of paths) {
      const guard = w.guardedBy[i] ? s.objects[w.guardedBy[i] - 1] : undefined;
      if (!guard || node.cost === 0 || threatened(s, w, h, i % w.size, Math.floor(i / w.size) % w.size, Math.floor(i / (w.size * w.size)), enemies)) continue;
      // (Closer odds, not ruinous ones: a guard over half our strength would cost most of the army.)
      if (guard.type === Obj.MONSTER && (guard.amount ?? 0) * (w.creatures[guard.subid]?.aiValue ?? 0) > 0.5 * mine) continue;
      const v = objectValue(s, w, h, guard, enemies);
      if (v > 0) consider(i, v, node.cost);
    }
  } finally {
    odds.margin = 1.6;
    odds.clearingTheWay = false;
  }
}

/**
 * @wiki principle/explore-when-idle
 * Nothing worth it in reach: explore towards the most unexplored ground; else a boat; else through a
 * place already visited toward open ground; else regroup (to the main hero, or home to a town).
 */
function exploreTargets(p: Pick) {
  const { s, w, h, paths, consider } = p;
  h.aiExploring = true;
  h.aiReason = "explore";
  let bestFog = 0;
  for (const [i, node] of paths) {
    if (node.cost === 0 || node.passOnly || w.guardedBy[i] || w.visitBy[i]) continue;
    const [x, y, z] = tileXYZ(w, i);
    let fog = 0;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const j = w.index(x + dx, y + dy, z);
        // (On a player's view the routes end at the shroud, and what lies under it isn't known: all of it counts.)
        if (j >= 0 && !isRevealed(s, h.owner, j) && (paths.has(j) || s.viewer !== undefined)) fog++;
      }
    }
    const score = (fog / (node.cost + 300)) * (i === h.aiTarget ? 2 : 1);
    if (fog > 0 && score > bestFog) {
      p.best = i;
      bestFog = score;
    }
  }
  // Our island explored and emptied: take a boat if one is in reach.
  if (p.best < 0 && h.boat === undefined) {
    h.aiExploring = false;
    for (const [i, node] of paths) if (node.cost > 0 && seaBoatAt(w, s, i)) consider(i, WORTH.boatWhenStuck, node.cost);
  }
  // Still nothing: walk through a place already visited (a path ends on it) when open ground lies
  // beyond. Not back through one crossed this week, so a hero doesn't shuttle to and fro.
  if (p.best < 0) {
    h.aiExploring = false;
    for (const [i, node] of paths) {
      const o = w.visitBy[i] && !w.guardedBy[i] && !w.heroAt[i] ? s.objects[w.visitBy[i] - 1] : undefined;
      if (!o || node.cost === 0 || o.town || o.type === Obj.MONSTER || s.day - (h.aiCrossed?.[o.id] ?? -99) < 7) continue;
      const [x, y, z] = tileXYZ(w, i);
      let beyond = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = w.index(x + dx, y + dy, z);
          if (j >= 0 && !paths.has(j) && !w.blocked(j) && !w.visitBy[j] && w.map.tiles[j]?.terrain !== Terrain.WATER) beyond++;
        }
      if (beyond) consider(i, 300 * beyond, node.cost);
    }
    if (p.best >= 0) {
      const o = s.objects[w.visitBy[p.best] - 1];
      if (o) (h.aiCrossed ??= {})[o.id] = s.day;
    }
  }
  // Nothing at all left to do here (it stood idle for days): to the main hero with what it has,
  // else home to the nearest town of ours with nobody in it (it guards it, and picks up the week's troops).
  if (p.best < 0) {
    h.aiReason = "regroup";
    const main = mainHero(s, w, h.owner);
    if (main && main !== h && h.garrison === undefined) {
      const node = paths.get(w.index(main.x, main.y, main.z));
      if (node && canTake(main, h)) consider(w.index(main.x, main.y, main.z), 1, node.cost);
    }
    const here = w.visitBy[w.index(h.x, h.y, h.z)];
    const inTown = here > 0 && s.objects[here - 1]?.town && s.objects[here - 1].owner === h.owner;
    if (p.best < 0 && !inTown)
      for (const t of s.objects) {
        if (!t.town || t.removed || t.owner !== h.owner) continue;
        const gate = visitTile(w, t);
        const node = gate >= 0 ? paths.get(gate) : undefined;
        if (node && node.cost > 0 && !w.heroAt[gate]) consider(gate, 1, node.cost);
      }
  }
}

/** What lies around a tile we'd arrive at: things to take and ground to explore, not already in reach. */
function placeWorth(s: AdventureState, w: World, h: Hero, at: number, enemies: Hero[], paths: Map<number, unknown>): number {
  if (at < 0 || paths.has(at)) return 0;
  const [x, y, z] = [at % w.size, Math.floor(at / w.size) % w.size, Math.floor(at / (w.size * w.size))];
  let v = 0;
  for (let dy = -5; dy <= 5; dy++)
    for (let dx = -5; dx <= 5; dx++) {
      const j = w.index(x + dx, y + dy, z);
      if (j < 0 || paths.has(j)) continue;
      if (!isRevealed(s, h.owner, j)) v += 60;
      const o = w.visitable(s, j);
      if (o && !o.removed && o.owner !== h.owner) v += 0.3 * Math.max(0, Math.min(5000, objectValue(s, w, h, o, enemies)));
    }
  return v;
}

/**
 * Standing in a town of ours with the Grail (it started there, or stayed to defend it): a step out
 * and back in, since the monument is built as the hero arrives.
 */
function grailHome(s: AdventureState, w: World, player: number, h: Hero): AdventureEvent[] {
  const here = w.index(h.x, h.y, h.z);
  const town = w.visitBy[here] ? s.objects[w.visitBy[here] - 1] : undefined;
  if (!town?.town || town.owner !== player || town.town.built.includes(B.GRAIL) || h.boat !== undefined) return [];
  if (![...(h.equipped ?? []), ...(h.backpack ?? [])].includes(GRAIL_ARTIFACT)) return [];
  for (const [dx, dy] of [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]]) {
    const i = w.index(h.x + dx, h.y + dy, h.z);
    if (i < 0 || w.blocked(i) || w.visitBy[i] || w.heroAt[i] || w.map.tiles[i].terrain === Terrain.WATER) continue;
    const out = act(s, w, player, { type: "move", hero: h.id, to: i });
    if (!out) continue;
    w.refresh(s);
    return [...out, ...(act(s, w, player, { type: "move", hero: h.id, to: here }) ?? [])];
  }
  return [];
}

/**
 * One AI player's turn. Still short of a Quest Guard's price on the way to the victory's goal, the
 * savings are out of reach all turn (heroes recruiting at home spent them too); once there, only
 * the towns can't touch them, and the heroes go and pay.
 */
export function adventureAiTurn(s: AdventureState, w: World, player = s.current): AdventureEvent[] {
  // (Played on what a player in its seat may know, unless the game lets the computer see everything.)
  if (s.viewer === undefined && !aiSeesAll(s)) return onView(s, w, player, adventureAiTurn);
  // The fresh engine (fresh/index.ts), for the players it plays.
  if (engineOf(s, player) === "fresh") return freshTurn(s, w, player);
  const res = s.players[player].resources;
  const goal = aiGoal(s);
  const g = goal?.object !== undefined ? s.objects[goal.object] : undefined;
  const need = [0, 0, 0, 0, 0, 0, 0];
  if (g && g.owner !== player) for (const o of goalGuards(s, w, g)) for (const [r, n] of ((mapData(w, o) as unknown as Quest).resources ?? []).entries()) need[r] = Math.max(need[r], n ?? 0);
  if (!need.some((n, r) => res[r] < n) || !worthSaving(s, w, player, need)) return aiTurn(s, w, player);
  const kept = need.map((n, r) => Math.max(0, Math.min(n, res[r])));
  kept.forEach((n, r) => (res[r] -= n));
  try {
    return aiTurn(s, w, player);
  } finally {
    kept.forEach((n, r) => (res[r] += n));
  }
}

/** One AI player's turn: towns first, then every hero, then end the turn (stops early for a battle). */
function aiTurn(s: AdventureState, w: World, player: number): AdventureEvent[] {
  const events: AdventureEvent[] = [];
  w.refresh(s);
  diaryOpen(s, player, `gold ${s.players[player].resources[6]}, heroes ${mapHeroesOf(s, player).map((h) => `${h.name} ${Math.round(power(w, h))}`).join(", ") || "none"}`);
  // What the map's victory asks to pay or hold is kept out of the towns' reach meanwhile.
  // (Already put aside for the whole turn when still short: see adventureAiTurn.)
  const res = s.players[player].resources;
  const need = worthSaving(s, w, player, goalSavings(s, w)) ? goalSavings(s, w) : [0, 0, 0, 0, 0, 0, 0];
  const kept = need.some((n, r) => res[r] < n) ? need.map(() => 0) : need;
  kept.forEach((n, r) => (res[r] -= n));
  try {
    manageTowns(s, w, player);
  } finally {
    kept.forEach((n, r) => (res[r] += n));
  }
  // (Worked out here, after the towns' day, as the heroes' rules would first ask for it.)
  for (const [hero, town] of townCalls(s, w, player)) diary(s, player, `${s.heroes[hero].name} called home to hold ${s.objects[town].name ?? `town ${town}`} with others`);
  // Strongest hero first, so it gets first pick of the targets; then any that leave a garrison once the gate is free.
  // (A hero put to sleep stays put, as its player said: a scenario's, or a friend's the caretaker plays for.)
  const heroes = [...leaveGarrisons(s, w, player), ...mapHeroesOf(s, player).filter((h) => !h.asleep).sort((a, b) => power(w, b) - power(w, a))];
  let stuck = false;
  /** The heroes that stay to hold a town today. */
  const holding: Hero[] = [];
  // A battle to fight first (playAiTurn settles it and calls again), the game over, or the turn
  // gone (the player lost meanwhile): nothing more now.
  const stop = () => s.winner !== undefined || !!battleFor(s, player) || !canAct(s, player);
  for (let k = 0; k < heroes.length; k++) {
    const h = heroes[k];
    if (k > 0) heroes.push(...leaveGarrisons(s, w, player));
    if (stop()) return events;
    events.push(...castForKnowledge(s, w, player, h));
    events.push(...scuttleBoat(s, w, player, h));
    events.push(...assembleSets(s, w, player, h));
    wearBest(s, w, player, h);
    mergeStacks(s, w, player, h);
    events.push(...portalHome(s, w, player, h));
    events.push(...portalForTroops(s, w, player, h));
    events.push(...grailHome(s, w, player, h));
    // On the Grail's tile: dig with a whole day's movement, else wait there for it.
    if (atKnownGrail(s, w, h)) {
      if (!cannotDig(s, w, h)) events.push(...(act(s, w, player, { type: "dig", hero: h.id }) ?? []));
      continue;
    }
    // On a HotA Grave: dig with a whole day's movement (it stood there since yesterday).
    const grave = graveUnder(s, w, h);
    if (grave && h.movement >= h.maxMovement) {
      events.push(...(act(s, w, player, { type: "visit", hero: h.id }) ?? []));
      continue;
    }
    for (let guard = 0; guard < 12 && h.movement > 0 && !h.removed && h.garrison === undefined; guard++) {
      if (stop()) return events;
      // At the Grail: it stays for tomorrow's dig.
      if (atKnownGrail(s, w, h)) break;
      w.refresh(s);
      // In a town of ours an enemy can reach tomorrow, too strong to meet in the field but not
      // behind the walls with the garrison: the hero stays and defends it.
      if (holdsTown(s, w, h)) {
        diaryStays(s, w, h, calledTo(s, w, h) ? "holds the town for the others coming" : "holds the town against a rival two days off");
        holding.push(h);
        break;
      }
      let target = chooseTarget(s, w, h);
      // Hiding from a stronger enemy where it stands: no spells to get away, the day ends here.
      if (target < 0 && h.aiReason === "hide") {
        diaryStays(s, w, h, "hides from a stronger rival");
        break;
      }
      // Only scouting left on foot, and something worth taking across the water: a spell to get there.
      if (h.boat === undefined && (target < 0 || h.aiExploring)) {
        const cast = [...castToReach(s, w, player, h)];
        if (!cast.length) cast.push(...doorOver(s, w, player, h));
        if (cast.length) {
          events.push(...cast);
          w.refresh(s);
          target = chooseTarget(s, w, h);
        }
      }
      // Nowhere to go on foot: a boat by magic, or flying / walking over the water.
      if (target < 0 && h.boat === undefined) {
        const cast = castToGetOut(s, w, player, h);
        if (cast.length) {
          events.push(...cast);
          w.refresh(s);
          target = chooseTarget(s, w, h);
        }
      }
      // A far target and Dimension Door known: a jump toward it first.
      if (target >= 0) {
        const jumped = doorToward(s, w, player, h, target);
        if (jumped.length) {
          events.push(...jumped);
          w.refresh(s);
          target = chooseTarget(s, w, h);
        }
      }
      // Riding out of a town an enemy can reach: troops stay behind to hold it.
      if (target >= 0) {
        const left = leaveGuard(s, w, player, h, target);
        if (left.length) {
          events.push(...left);
          w.refresh(s);
          target = chooseTarget(s, w, h);
        }
      }
      h.aiTarget = target < 0 ? undefined : target;
      // Nothing left but scouting (or not even that): time to look across the water.
      if (h.boat === undefined && (target < 0 || h.aiExploring)) stuck = true;
      if (target < 0) {
        diaryStays(s, w, h, "nothing worth going to");
        break;
      }
      diaryMove(s, w, h, target, power(w, h));
      // (A walk on the way to a spell, to the shore for Summon Boat, may have met a fight.)
      if (stop()) return events;
      const before = h.movement;
      const got = act(s, w, player, { type: "move", hero: h.id, to: target });
      if (!got) break;
      events.push(...got);
      for (const ev of got) {
        // Home: take the garrison and recruit (into the garrison, then down to the hero).
        if (ev.e === "town" && s.objects[ev.object]?.owner === player) {
          // (The army's troops go to the hero that carries it; another leaves them to hold the town.)
          const carrier = carriesArmy(s, w, h) || ferries(s, w, h, s.objects[ev.object]);
          if (carrier && !guarded(s, player, ev.object)) act(s, w, player, { type: "takeGarrison", town: ev.object });
          recruitAll(s, w, player, s.objects[ev.object], carrier);
          upgradeAll(s, w, player, s.objects[ev.object]);
          buyBook(s, w, player, s.objects[ev.object]);
        }
        if (ev.e === "dwelling") recruitDwelling(s, w, player, h, s.objects[ev.object]);
        if (ev.e === "market" && ev.hero === h.id) useService(s, w, player, h, s.objects[ev.object]);
        if ((ev.e === "visit" || ev.e === "dwelling" || ev.e === "market" || ev.e === "offer") && ev.hero === h.id) (h.aiVisited ??= {})[ev.object] = s.day;
        if (ev.e === "teleport" && ev.hero === h.id) (h.aiCrossed ??= {})[ev.object] = s.day;
        if (ev.e === "meet" && s.heroes[ev.other]?.owner === player) feedMainHero(s, w, player, s.heroes[ev.hero], s.heroes[ev.other]);
      }
      if (h.movement === before && !got.length) break;
      // Reached a Grave: it's dug tomorrow, with the day's movement.
      if (graveUnder(s, w, h)) break;
    }
  }
  if (stop()) return events;
  heroes.push(...leaveGarrisons(s, w, player));
  for (const h of holding) enterGarrison(s, w, player, h);
  guardTowns(s, w, player);
  // Heroes with nowhere left to go on their island: a boat from one of our shipyards.
  if (stuck) {
    s.players[player].aiStuck = s.day;
    buildBoatIfUseful(s, w, player);
  }
  events.push(...(act(s, w, player, { type: "endTurn" }) ?? []));
  return events;
}

/**
 * @wiki principle/hold-from-the-garrison
 * A hero that stays to hold a town goes into its garrison, as a player would: it defends from there the same, and the
 * gate is free for the tavern's next hero, who goes on with the game (2026-10-27: on Week three the rival's only
 * hero held its castle in the gate day after day, the tavern shut behind it, and nothing on its side ever moved).
 */
function enterGarrison(s: AdventureState, w: World, player: number, h: Hero) {
  const at = w.visitBy[w.index(h.x, h.y, h.z)];
  const town = at ? s.objects[at - 1] : undefined;
  if (h.removed || h.garrison !== undefined || !town?.town || town.owner !== player || garrisonHero(s, town)) return;
  // (The garrison's troops must fit in the hero's army, else it holds from the gate.)
  const merged = [...h.army];
  if (town.town.garrison.every((st) => !st || addToStacks(merged, st.creature, st.count))) act(s, w, player, { type: "swapGarrison", town: town.id });
}

/**
 * @wiki principle/empty-town-invites
 * The turn's last look at our towns: one a rival hero can reach in two days with nothing in it (no hero, no garrison)
 * buys its troops now, with what the heroes brought in today too (the towns were seen to first thing, before the gold
 * picked up on the way; an empty town fell to a lone scout four times a week in the growth check).
 */
function guardTowns(s: AdventureState, w: World, player: number) {
  const enemies = s.heroes.filter((e) => !e.removed && e.owner >= 0 && e.owner !== player && !allied(s, e.owner, player));
  if (!enemies.length) return;
  for (const o of s.objects) {
    if (!o.town || o.removed || o.owner !== player || garrisonHero(s, o) || visitingHero(s, w, o) || o.town.garrison.some(Boolean)) continue;
    const gate = visitTile(w, o);
    if (gate < 0) continue;
    const [x, y, z] = [gate % w.size, Math.floor(gate / w.size) % w.size, Math.floor(gate / (w.size * w.size))];
    if (enemies.some((e) => inReach(s, w, e, x, y, z, 2))) recruitAll(s, w, player, o);
  }
}

/** The garrison heroes no town needs held today, back out at their gates while those are free (the day's heroes to play). */
function leaveGarrisons(s: AdventureState, w: World, player: number): Hero[] {
  const out: Hero[] = [];
  for (const h of heroesOf(s, player)) {
    const town = h.garrison !== undefined ? s.objects[h.garrison] : undefined;
    if (!town?.town || town.owner !== player || visitingHero(s, w, town) || mapHeroesOf(s, player).length >= 8) continue;
    // (Judged as if at the gate: whether an enemy that the walls hold off is still about.)
    const gate = visitTile(w, town);
    if (gate < 0) continue;
    const [x, y, z] = [h.x, h.y, h.z];
    [h.x, h.y, h.z] = [gate % w.size, Math.floor(gate / w.size) % w.size, Math.floor(gate / (w.size * w.size))];
    const hold = holdsTown(s, w, h);
    [h.x, h.y, h.z] = [x, y, z];
    if (hold || !act(s, w, player, { type: "swapGarrison", town: town.id })) continue;
    w.refresh(s);
    out.push(h);
  }
  return out;
}

/** Every combination whose parts a hero carries: the parts put on (in free slots, or for lesser things) and assembled. */
function assembleSets(s: AdventureState, w: World, player: number, h: Hero): AdventureEvent[] {
  const out: AdventureEvent[] = [];
  const run = (a: AdventureAction) => {
    try {
      out.push(...(act(s, w, player, a) ?? []));
      return true;
    } catch {
      return false;
    }
  };
  for (const [id, parts] of Object.entries(COMBOS)) {
    const combo = Number(id);
    const carried = () => [...(h.equipped ?? []), ...(h.backpack ?? [])];
    if (!parts.length || !parts.every((p) => carried().includes(p)) || (h.equipped ?? []).includes(combo)) continue;
    const used = new Set<number>();
    for (const p of parts) {
      const at = (h.equipped ?? []).indexOf(p);
      if (at >= 0) used.add(at);
    }
    for (const p of parts) {
      if ((h.equipped ?? []).includes(p)) continue;
      const from = (h.backpack ?? []).indexOf(p);
      const slots = (w.data.artifacts[p]?.slots ?? []).filter((sl) => !used.has(sl) && sl !== SLOT.SPELLBOOK && (h.equipped ?? [])[sl] !== -2 && !parts.includes((h.equipped ?? [])[sl]) && !COMBOS[(h.equipped ?? [])[sl]]);
      // A free slot first, else the worn thing of least worth.
      slots.sort((a, b) => ((h.equipped ?? [])[a] >= 0 ? artifactWorth(s, w, h, (h.equipped ?? [])[a]) : -1) - ((h.equipped ?? [])[b] >= 0 ? artifactWorth(s, w, h, (h.equipped ?? [])[b]) : -1));
      if (from < 0 || !slots.length || !run({ type: "equip", hero: h.id, from: { backpack: from }, to: { slot: slots[0] } })) break;
      used.add(slots[0]);
    }
    if (assemblable(h).includes(combo)) run({ type: "assemble", hero: h.id, artifact: combo });
  }
  return out;
}

/** What an airship can fly to: rival towns and heroes we beat, and anything worth a visit, not on `walkable` (the prizes a walk already reaches). */
function airshipPrizes(s: AdventureState, w: World, h: Hero, enemies: Hero[], walkable?: Map<number, PathNode>): [number, number][] {
  const prizes: [number, number][] = [];
  // (Not what another hero of ours is flying to or has landed by: one airship for it is enough.)
  const others = s.heroes.filter((x) => !x.removed && x.owner === h.owner && x.id !== h.id);
  const claimed = [...others.map((x) => w.index(x.x, x.y, x.z)), ...others.filter((x) => x.airship && x.aiTarget !== undefined).map((x) => x.aiTarget!)];
  const taken = (i: number) => claimed.some((t) => Math.max(Math.abs((t % w.size) - (i % w.size)), Math.abs(Math.floor(t / w.size) - Math.floor(i / w.size))) <= 2);
  for (const e of enemies) {
    const i = w.index(e.x, e.y, e.z);
    if (e.garrison === undefined && !e.unseen && !walkable?.has(i) && !taken(i) && canBeat(s, w, h, e)) prizes.push([i, heroPrize(s, w, e)]);
  }
  for (const o of s.objects) {
    if (o.removed || o.type === Obj.BOAT || o.carriedBy !== undefined) continue;
    const gate = visitTile(w, o);
    if (gate < 0 || walkable?.has(gate) || w.heroAt[gate] || taken(gate)) continue;
    const v = Math.min(o.town ? 1e9 : 5000, objectValue(s, w, h, o, enemies));
    if (v > 0) prizes.push([gate, v]);
  }
  return prizes;
}

/** The best landing an airship hero can fly to: [tile, the prize's worth, the flight's cost]. Beside the prize, on its own ground. */
function bestFlight(s: AdventureState, w: World, h: Hero, enemies: Hero[], walkable?: Map<number, PathNode>): [number, number, number] | undefined {
  const prizes = airshipPrizes(s, w, h, enemies, walkable);
  if (!prizes.length) return undefined;
  const flying = findPaths(w, s, h, false, undefined, true);
  const region = landRegions(w);
  // Each prize's best landing, then the best of them that a walk from there really reaches (a guard
  // or rock between: the hero landed, boarded again for it the next day, and again).
  const options: [number, number, number, number][] = [];
  for (const [goal, value] of prizes) {
    const gx = goal % w.size;
    const gy = Math.floor(goal / w.size) % w.size;
    const gz = Math.floor(goal / (w.size * w.size));
    let best: [number, number, number, number] | undefined;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const j = w.index(gx + dx, gy + dy, gz);
        const node = j >= 0 ? flying.get(j) : undefined;
        if (!node || node.cost === 0 || !airshipStop(w, s, j) || w.heroAt[j] || region[j] < 0 || (region[goal] >= 0 && region[j] !== region[goal])) continue;
        // (A landing is a step from clear ground onto clear ground: reached over the sea or rock, the airship only hovers there.)
        if (node.prev < 0 || flying.get(node.prev)?.passOnly) continue;
        const cost = node.cost + 100 * Math.max(Math.abs(dx), Math.abs(dy));
        if (!best || cost < best[2]) best = [j, value, cost, goal];
      }
    if (best) options.push(best);
  }
  options.sort((a, b) => b[1] / (b[2] + 300) - a[1] / (a[2] + 300));
  for (const [j, value, cost, goal] of options.slice(0, 6)) {
    const [x, y, z] = [j % w.size, Math.floor(j / w.size) % w.size, Math.floor(j / (w.size * w.size))];
    if (findPaths(w, s, { ...h, x, y, z, boat: undefined, airship: undefined }, false, undefined, true).has(goal)) return [j, value, cost];
  }
  return undefined;
}

/** Aboard an airship: land by the best prize; with none, on the nearest clear ground. */
function airshipLanding(s: AdventureState, w: World, h: Hero, paths: Map<number, PathNode>): number {
  const enemies = s.heroes.filter((e) => !e.removed && e.owner !== h.owner && !allied(s, e.owner, h.owner));
  h.aiExploring = false;
  h.aiReason = "value";
  // (Not what could be walked to from here: the flight was for what can't.)
  const flight = bestFlight(s, w, h, enemies, findPaths(w, s, { ...h, boat: undefined, airship: undefined }, false, undefined, true));
  if (flight) return airshipLeg(w, h, paths, flight[0]);
  let best = -1;
  for (const [i, node] of paths) if (node.cost > 0 && !w.heroAt[i] && airshipStop(w, s, i) && node.prev >= 0 && !paths.get(node.prev)?.passOnly && (best < 0 || node.cost < paths.get(best)!.cost)) best = i;
  return best;
}

/**
 * Today's leg of a flight: the airship can only stop over clear land, so a flight whose stretch in
 * reach today is all sea or rock would end back where it began (day after day). Then: the stop in
 * reach today nearest the goal, one come to over the sea or rock (it hovers there, not landing).
 */
function airshipLeg(w: World, h: Hero, paths: Map<number, PathNode>, goal: number): number {
  const route = mapPathTo(paths, goal);
  if (route.some((i, k) => k > 0 && paths.get(i)!.cost <= h.movement && !paths.get(i)!.passOnly)) return goal;
  const gx = goal % w.size;
  const gy = Math.floor(goal / w.size) % w.size;
  const far = (i: number) => Math.hypot((i % w.size) - gx, (Math.floor(i / w.size) % w.size) - gy);
  let best = -1;
  for (const [i, node] of paths) {
    if (node.cost === 0 || node.cost > h.movement || node.passOnly || node.prev < 0 || !paths.get(node.prev)?.passOnly || w.heroAt[i]) continue;
    if (far(i) < far(w.index(h.x, h.y, h.z)) && (best < 0 || far(i) < far(best))) best = i;
  }
  return best >= 0 ? best : goal;
}

function buildBoatIfUseful(s: AdventureState, w: World, player: number) {
  w.refresh(s);
  // Each hero with nothing left to do ashore and no boat it can walk to: a boat from a shipyard it can reach.
  for (const h of mapHeroesOf(s, player)) {
    if (h.boat !== undefined || s.players[player].resources[6] < 3000) continue;
    const paths = findPaths(w, s, h);
    if ([...paths.keys()].some((i) => anyBoatAt(w, s, i))) continue;
    if (chooseTarget(s, w, h) >= 0 && !h.aiExploring) continue;
    const reach = (o: AdvObject) => {
      const gate = visitTile(w, o);
      return gate >= 0 && (paths.has(gate) || w.index(h.x, h.y, h.z) === gate);
    };
    const yard = s.objects.find((o) => !o.removed && o.owner === player && ((o.type === Obj.SHIPYARD && !isAirshipYard(o)) || o.town?.built.includes(B.SHIPYARD)) && !cannotBuildBoat(s, w, o, player) && reach(o));
    // HotA's Airship Yard: an airship, when there's somewhere to fly that no walk reaches.
    const airYard = yard ? undefined : s.objects.find((o) => !o.removed && o.owner === player && isAirshipYard(o) && !cannotBuildBoat(s, w, o, player) && reach(o));
    const enemies = s.heroes.filter((e) => !e.removed && e.owner !== player && !allied(s, e.owner, player));
    if (yard) act(s, w, player, { type: "buildBoat", object: yard.id });
    // (One flight at a time: not while a hero of ours is aboard one.)
    else if (airYard && !mapHeroesOf(s, player).some((x) => x.airship) && airshipPrizes(s, w, h, enemies, paths).length) act(s, w, player, { type: "buildBoat", object: airYard.id });
  }
}

function recruitDwelling(s: AdventureState, w: World, player: number, h: Hero, o: AdvObject) {
  const creatures = dwellingCreatures(o) ?? [];
  creatures.forEach((creature, slot) => {
    const c = w.creatures[creature];
    const avail = o.dwelling?.available[slot] ?? 0;
    if (!c || !avail || !fits(h.army, creature)) return;
    const res = s.players[player].resources;
    const n = affordableCount(dwellingPrice(w, o, creature), res, avail);
    if (n > 0) act(s, w, player, { type: "recruitDwelling", hero: h.id, object: o.id, slot, count: n });
  });
}
