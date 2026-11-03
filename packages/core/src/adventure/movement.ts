// Hero movement on the adventure map, per heroes.thelazy.net/index.php/Movement.
import { skillFactor, specialtyValue } from "../specialty.ts";
import { LOGISTICS, NAVIGATION, skillLevel } from "../skills.ts";
import { bonus, hasBonus } from "./artifacts.ts";
import type { AdventureState, Hero, Pos } from "./types.ts";
import { Terrain, type World, isRevealed } from "./world.ts";

/** Daily movement by the speed of the slowest creature (0..11+). */
const BASE_MOVEMENT = [1300, 1360, 1430, 1500, 1560, 1630, 1700, 1760, 1830, 1900, 1960, 2000];

// dirt, sand, grass, snow, swamp, rough, subterranean, lava, water, rock, highlands, wasteland
const TERRAIN_COST = [100, 150, 100, 150, 175, 125, 100, 100, 100, 100, 100, 125];
const ROAD_COST = [0, 75, 65, 50];
const WASTELAND = 11;

const NATIVE_TERRAIN: Record<string, number> = {
  castle: Terrain.GRASS,
  rampart: Terrain.GRASS,
  tower: Terrain.SNOW,
  inferno: Terrain.LAVA,
  necropolis: Terrain.DIRT,
  dungeon: Terrain.SUBTERRANEAN,
  stronghold: Terrain.ROUGH,
  fortress: Terrain.SWAMP,
  // HotA: Conflux moved to the highlands; the new towns' homes.
  conflux: 10,
  cove: Terrain.SWAMP,
  factory: 11,
  bulwark: Terrain.SNOW,
};

/** Daily movement at sea, whatever the army. */
export const BOAT_MOVEMENT = 1500;

/**
 * HotA's Airship (a boat, subtype 100; heroes.thelazy.net Airship): it flies over land, water and
 * obstacles, every step at the plain 100 (VCMI's airship layer), on the army's land movement; it
 * stops only over clear land, its hero visits, meets and attacks nothing while aboard, and boarding
 * or landing takes the rest of the day as a boat's.
 */
export const AIRSHIP = 100;
export const isAirship = (o: { type: number; subid: number }) => o.type === 8 && o.subid === AIRSHIP;
/** At sea in a boat (not flying an airship). */
export const sailing = (h: Hero) => h.boat !== undefined && !h.airship;

/**
 * Brings every hero's `maxMovement` (a full day's points, what the panels show and digging asks for) up
 * to date after whatever changed it: a stack or an artifact gained or lost, a boat boarded.
 */
export function refreshMovement(s: AdventureState, w: World) {
  for (const h of s.heroes) if (!h.removed) h.maxMovement = maxMovement(w, h);
}

export function maxMovement(w: World, h: Hero): number {
  return sailing(h) ? seaMovement(w, h) : landMovement(w, h);
}

/** A full day's points at sea (Navigation, the sea artifacts and specialties, Lighthouses). */
export function seaMovement(w: World, h: Hero): number {
  return Math.floor(BOAT_MOVEMENT * (1 + NAVIGATION[skillLevel(h.skills, "navigation")] * skillFactor(h, "navigation"))) + bonus(h, "MOVEMENT", "heroMovementSea") + (skillLevel(h.skills, "navigation") ? specialtyValue(h, "MOVEMENT", "heroMovementSea") : 0) + 500 * (w.lighthouses[h.owner] ?? 0);
}

/** A full day's points on land (the slowest stack, Logistics, the land artifacts, Stables). */
export function landMovement(w: World, h: Hero): number {
  const speeds = h.army.filter((x) => x).map((x) => w.creatures[x!.creature].speed);
  const slowest = speeds.length ? Math.min(...speeds) : 11;
  // Stables (HotA): +300 a day for the rest of the week.
  const stables = h.stablesWeek === w.week ? 300 : 0;
  return Math.floor(BASE_MOVEMENT[Math.min(11, Math.max(0, slowest))] * (1 + LOGISTICS[skillLevel(h.skills, "logistics")] * skillFactor(h, "logistics"))) + bonus(h, "MOVEMENT", "heroMovementLand") + stables;
}

/**
 * Sets a hero's day: both pools as the day begins (or the hero is hired) and today's points from the
 * one it stands in. The Admiral's Hat carries points over between them by these, so a swap of troops
 * or boots during the day changes nothing (HotA 1.4.0 "Fixed a bug where a player could abuse the
 * Admiral's Hat for endless movement points"; heroes.thelazy.net Admiral's Hat: "MPbas cannot be
 * changed during the day").
 */
export function startDay(w: World, s: AdventureState, h: Hero) {
  h.pools = { day: s.day, land: landMovement(w, h), sea: seaMovement(w, h) };
  h.movement = h.maxMovement = sailing(h) ? h.pools.sea : h.pools.land;
}

/** Today's full pool on land or at sea, as fixed when the day began. */
export function dayPool(w: World, s: AdventureState, h: Hero, sea: boolean): number {
  if (h.pools?.day === s.day) return sea ? h.pools.sea : h.pools.land;
  return sea ? seaMovement(w, h) : landMovement(w, h);
}

/** Penalty-free terrain: every creature in the army is native to it. */
function nativeTo(w: World, h: Hero, terrain: number): boolean {
  const army = h.army.filter((x) => x);
  return army.length > 0 && army.every((x) => NATIVE_TERRAIN[w.creatures[x!.creature].faction] === terrain);
}

const TERRAIN_NAMES = ["dirt", "sand", "grass", "snow", "swamp", "rough", "subterra", "lava", "water", "rock", "highlands", "wasteland"];

/**
 * What a hero's steps cost doesn't change while the pathfinder runs (its flight, water walking and
 * the cost of each terrain): worked out once per findPaths, not again on every step (they read the
 * hero's artifacts; on a big map the AI's routes spent half its time there).
 */
let memo: { w: World; s: AdventureState; h: Hero; fly: number; ww: number; terrain: number[] } | null = null;

function terrainCost(w: World, h: Hero, terrain: number): number {
  if (memo && memo.h === h && memo.w === w) return (memo.terrain[terrain] ??= terrainCostOf(w, h, terrain));
  return terrainCostOf(w, h, terrain);
}

function terrainCostOf(w: World, h: Hero, terrain: number): number {
  const c = TERRAIN_COST[terrain] ?? 100;
  // A Trailblazer guides the hero through the wasteland this week: 75 a tile, natives and
  // Pathfinding too (the mod's "down to 75%"; heroes.thelazy.net's Movement page).
  if (terrain === WASTELAND && bonus(h, "WASTELAND_GUIDE")) return 75;
  if (c <= 100 || nativeTo(w, h, terrain)) return Math.min(c, 100);
  // Nomads in the army: no penalty on their terrain (sand).
  const name = TERRAIN_NAMES[terrain];
  if (h.army.some((x) => x && w.creatures[x.creature]?.abilities.some((b) => b.type === "NO_TERRAIN_PENALTY" && b.subtype === name))) return 100;
  return penalised(h, c);
}

/** A penalty terrain's cost after Pathfinding, Wayfarer's Boots and Ergon (not the army's nativity). */
function penalised(h: Hero, c: number): number {
  // Pathfinding (HotA): rough terrain costs 25 points less per level, down to 95/90/85;
  // Wayfarer's Boots (HotA) take off the whole penalty.
  const p = skillLevel(h.skills, "pathfinding");
  const cost = Math.max(100 - 5 * p, c - 25 * p - bonus(h, "ROUGH_TERRAIN_DISCOUNT"));
  // Ergon (HotA): 10 points less on any terrain with a penalty (heroes.thelazy.net: at Expert
  // Pathfinding 90 on swamp and 75 elsewhere, against 100 and 85).
  return specialtyValue(h, "ROUGH_TERRAIN_DISCOUNT") ? cost - 10 : cost;
}

/** Cost of one step; the tile left decides, except road<->terrain where the terrain tile does. */
export function stepCost(w: World, h: Hero, from: Pos, to: Pos, straight = false): number {
  const a = w.tile(from)!;
  const b = w.tile(to)!;
  let c: number;
  if (a.road && b.road) c = ROAD_COST[a.road];
  else if (a.road) c = terrainCost(w, h, b.terrain);
  else if (b.road) c = terrainCost(w, h, a.terrain);
  else c = terrainCost(w, h, a.terrain);
  const diagonal = !straight && from.x !== to.x && from.y !== to.y;
  return diagonal ? Math.floor(c * 1.414) : c;
}

/** Can the hero still take this step today? Includes the last-diagonal-step exception. */
// Fly / Water Walk from a spell cast today, or for good from Angel Wings / Boots of Levitation.
const flyingOf = (s: AdventureState, h: Hero) => (h.boat !== undefined ? 0 : hasBonus(h, "FLYING_MOVEMENT") ? 100 : h.fly?.day === s.day ? h.fly.efficiency : 0);
const waterWalkingOf = (s: AdventureState, h: Hero) => (h.boat !== undefined ? 0 : hasBonus(h, "WATER_WALKING") ? 100 : h.waterWalk?.day === s.day ? h.waterWalk.efficiency : 0);
const flying = (s: AdventureState, h: Hero) => (memo && memo.h === h && memo.s === s ? memo.fly : flyingOf(s, h));
const waterWalking = (s: AdventureState, h: Hero) => (memo && memo.h === h && memo.s === s ? memo.ww : waterWalkingOf(s, h));

/**
 * A tile the hero may cross today only thanks to Fly (water and obstacles, not rock)
 * or Water Walk (water), but not stop on.
 */
export function passOnly(w: World, s: AdventureState, h: Hero, i: number): boolean {
  if (h.airship) return !airshipStop(w, s, i);
  if (h.boat !== undefined) return false;
  const water = isWater(w, i);
  // A map event on the water is no object to them: it fires for boats only (HotA 1.5.0).
  const clear = !w.visitBy[i] || (water && s.objects[w.visitBy[i] - 1]?.type === EVENT);
  if (flying(s, h)) return (water || w.blocked(i)) && w.map.tiles[i].terrain !== Terrain.ROCK && clear && !w.heroAt[i];
  if (waterWalking(s, h)) return water && clear && !w.heroAt[i];
  return false;
}

/** Where an airship may stop (and its hero step down): clear land, no object, guard or hero there. */
export function airshipStop(w: World, s: AdventureState, i: number): boolean {
  const t = w.map.tiles[i].terrain;
  return t !== Terrain.WATER && t !== Terrain.ROCK && !w.blocked(i) && !isStop(w, s, i) && !w.guardedBy[i];
}

/**
 * Cost of a step with today's spells: Fly and Water Walk add their penalty to the plain 100 (the
 * spell's 60/60/80/100 "efficiency" is a 40/40/20/0% penalty: 140, 120 or 100 a tile, 197, 169 or
 * 141 diagonally, as heroes.thelazy.net's Movement table and VCMI); Fly never costs more than the
 * ground under it (roads, Pathfinding).
 */
export function moveCost(w: World, s: AdventureState, h: Hero, from: Pos, to: Pos): number {
  const base = stepCost(w, h, from, to);
  const diagonal = from.x !== to.x && from.y !== to.y;
  if (h.airship) return Math.min(base, diagonal ? 141 : 100);
  const penalty = (eff: number) => Math.floor((200 - eff) * (diagonal ? 1.414 : 1));
  const fly = flying(s, h);
  const i = w.index(to.x, to.y, to.z);
  const ww = waterWalking(s, h);
  // Over water with both spells the better one counts (HotA 1.7.0: "the penalty for Fly on water is
  // not used if the more effective Water Walk is also cast").
  const wet = ww && isWater(w, i) ? penalty(ww) : Infinity;
  if (fly) return Math.min(wet, passOnly(w, s, h, i) ? penalty(fly) : Math.min(base, penalty(fly)));
  if (wet < Infinity) return wet;
  return base;
}

/**
 * What a step takes from the hero's `points`, or -1 when it can't be taken today. The original's
 * diagonal exception (heroes.thelazy.net Movement): with fewer points than a diagonal step but at
 * least a straight one's, the hero still steps diagonally and pays a straight step. The original's
 * check forgot roads and the army's nativity; HotA 1.7.3 counts every modifier ("Fixed a hero last
 * step cost bug", its changelog), so the cheap diagonal is always the day's last step.
 */
export function stepPrice(w: World, s: AdventureState, h: Hero, from: Pos, to: Pos, points: number): number {
  const cost = moveCost(w, s, h, from, to);
  if (points >= cost) return cost;
  const diagonal = from.x !== to.x && from.y !== to.y;
  const magic = h.airship || flying(s, h) || (waterWalking(s, h) && isWater(w, w.index(to.x, to.y, to.z)));
  if (diagonal && !magic) {
    const straight = stepCost(w, h, from, to, true);
    if (points >= straight) return straight;
  }
  return -1;
}

/**
 * Can the hero still take one step today, anywhere it may go (`onlyExplored`: as its player sees the map)? A few
 * points left that buy no step on the hero's ground don't count (2026-11-03: End turn asked about a hero who could
 * not move a single tile).
 */
export function canStepToday(w: World, s: AdventureState, h: Hero, onlyExplored = true): boolean {
  if (h.movement <= 0) return false;
  const paths = findPaths(w, s, h, onlyExplored);
  let start = -1;
  for (const [i, n] of paths) if (n.prev === -1) start = i;
  if (start < 0) return false;
  for (const [i, n] of paths) if (n.prev === start && stepsToday(w, s, h, [start, i]) >= 1) return true;
  return false;
}

/**
 * Beyond HotA (EXTRAS throughGarrisons, the owner 2026-11-03): a garrison of the hero's own player, unguarded and with no
 * hero in it, that a route may run through instead of stopping at (pass it to findPaths as `through`).
 */
export function garrisonPass(w: World, s: AdventureState, h: Hero, i: number): boolean {
  const v = w.visitBy[i];
  const o = v ? s.objects[v - 1] : undefined;
  return !!o && (o.type === 33 || o.type === 219) && o.owner === h.owner && !w.guardedBy[i] && !w.heroAt[i];
}

/** How many steps of a route (hero's tile first) today's movement takes. */
export function stepsToday(w: World, s: AdventureState, h: Hero, path: readonly number[]): number {
  let points = h.movement;
  let k = 1;
  for (; k < path.length; k++) {
    const price = stepPrice(w, s, h, pos(w, path[k - 1]), pos(w, path[k]), points);
    if (price < 0) break;
    points -= price;
  }
  return k - 1;
}

/**
 * Which day each step of a route is walked on (0 today, 1 tomorrow...; the first entry, the hero's
 * own tile, 0): today's points first, then a full day's each day after.
 */
export function stepDays(w: World, s: AdventureState, h: Hero, path: readonly number[]): number[] {
  const full = Math.max(1, h.maxMovement ?? h.movement);
  const days = [0];
  let points = h.movement;
  let day = 0;
  for (let k = 1; k < path.length; k++) {
    let price = stepPrice(w, s, h, pos(w, path[k - 1]), pos(w, path[k]), points);
    if (price < 0) {
      day++;
      points = full;
      price = Math.max(0, stepPrice(w, s, h, pos(w, path[k - 1]), pos(w, path[k]), points));
    }
    points = Math.max(0, points - price);
    days.push(day);
  }
  return days;
}

/** On which of the hero's turns the walk ends: 1 today, 2 tomorrow... (as stepDays, the arrows' colours). */
export function turnsAway(w: World, s: AdventureState, h: Hero, path: readonly number[]): number {
  return 1 + (stepDays(w, s, h, path).at(-1) ?? 0);
}

const pos = (w: World, i: number): Pos => ({ x: i % w.size, y: Math.floor(i / w.size) % w.size, z: Math.floor(i / (w.size * w.size)) });

export interface PathNode {
  cost: number;
  prev: number;
  /** Crossed by Fly / Water Walk: the path may go over it but not end there. */
  passOnly?: boolean;
}

/**
 * Dijkstra from the hero over passable tiles. Visitable objects, guarded
 * tiles and other heroes end a path; you can step onto them but not through.
 * `through`: stops the route may carry on past (the AI planning beyond today: guards it can beat).
 * `beyond`: routes go on from a teleport's exit (the AI weighing what lies past a monolith or a
 * gate; walked, the hero stops at the entrance, is carried over and goes on from there).
 * `enough`: asked of each tile as its cost is settled (cheapest first); true ends the search there
 * (the AI's far search, once nothing further could be worth the walk). The tiles not yet settled
 * come back with their costs so far.
 */
export function findPaths(w: World, s: AdventureState, h: Hero, onlyExplored = false, through?: (i: number) => boolean, beyond = false, enough?: (i: number, cost: number) => boolean): Map<number, PathNode> {
  const outer = memo;
  memo = { w, s, h, fly: flyingOf(s, h), ww: waterWalkingOf(s, h), terrain: [] };
  depth++;
  try {
    return searchPaths(w, s, h, onlyExplored, through, beyond, enough);
  } finally {
    memo = outer;
    depth--;
  }
}

/**
 * A search's working arrays, a tile apiece, kept between searches (one set per nesting depth: a
 * `through` test may search too). A tile's entries count only when its stamp is this search's.
 */
const scratch: { seen: Int32Array; done: Int32Array; cost: Float64Array; prev: Int32Array; pass: Uint8Array; gen: number }[] = [];
let depth = 0;

function searchPaths(w: World, s: AdventureState, h: Hero, onlyExplored: boolean, through: ((i: number) => boolean) | undefined, beyond: boolean, enough?: (i: number, cost: number) => boolean): Map<number, PathNode> {
  const start = w.index(h.x, h.y, h.z);
  if (start < 0) return new Map([[start, { cost: 0, prev: -1 }]]);
  // A player's routes stay on explored tiles (VCMI: unexplored tiles are blocked to the pathfinder), and so do
  // all routes in a player's view (the computer's turn is played on one: aiView.ts).
  const explored = (onlyExplored || s.viewer !== undefined) && (s.players[h.owner]?.revealed.length ?? 0) > 0;
  const n = w.levels * w.size * w.size;
  let b = scratch[depth];
  if (!b || b.seen.length !== n) b = scratch[depth] = { seen: new Int32Array(n), done: new Int32Array(n), cost: new Float64Array(n), prev: new Int32Array(n), pass: new Uint8Array(n), gen: 0 };
  const g = ++b.gen;
  const { seen, done, cost: costOf, prev: prevOf, pass } = b;
  // (The tiles in the order first reached: the routes come back in that order.)
  const order: number[] = [];
  const reach = (j: number, c: number, p: number, over: boolean) => {
    if (seen[j] !== g) {
      seen[j] = g;
      order.push(j);
    }
    costOf[j] = c;
    prevOf[j] = p;
    pass[j] = over ? 1 : 0;
  };
  reach(start, 0, -1, false);
  const open = new MinHeap();
  open.push(0, start);
  while (open.size) {
    const [cost, i] = open.pop();
    if (done[i] === g) continue;
    done[i] = g;
    if (enough?.(i, cost)) break;
    // A teleport entrance continues at its exit (not for an airship: nothing is entered from the air). Not one a monster
    // guards: stepping on it is the fight, and only a won fight carries the hero through (a route past a guarded
    // Subterranean Gate led a player's computer rival's main army, 39,000 strong, into 39 Minotaur Kings, 2026-10-28).
    const exit = i !== start && !h.airship && (!w.guardedBy[i] || !!through?.(i)) ? w.teleportTo[i] - 1 : -1;
    if (exit >= 0 && done[exit] !== g && !w.heroAt[exit]) {
      if (seen[exit] !== g || cost < costOf[exit]) {
        reach(exit, cost, i, false);
        open.push(cost, exit);
      }
    }
    // Boarding or coming ashore ends a path (unless walking on water by magic); an airship flies on.
    if (i !== start && !h.airship && (h.boat !== undefined) !== isWater(w, i) && !pass[i]) continue;
    // Carried out of a teleport (and no guard there): the hero walks on from its exit as from the start.
    const prev = prevOf[i];
    const arrived = beyond && i !== start && prev >= 0 && w.teleportTo[prev] - 1 === i && !w.guardedBy[i];
    // Stops end a path; from a guarded tile you can still step into its guard to attack.
    const guard = i !== start && !arrived && !h.airship && isStop(w, s, i) && !through?.(i) ? w.guardedBy[i] : -1;
    if (guard === 0) continue;
    const x = i % w.size;
    const y = Math.floor(i / w.size) % w.size;
    const z = Math.floor(i / (w.size * w.size));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = w.index(x + dx, y + dy, z);
        if (j < 0 || done[j] === g) continue;
        if (explored && !isRevealed(s, h.owner, j)) continue;
        const over = passOnly(w, s, h, j);
        if ((!over || h.airship) && !enterable(w, s, h, j)) continue;
        // (Over water or an obstacle the hero can't stop, so nor visit, fight or meet from there: moveHero turns back.)
        if (pass[i] && isStop(w, s, j) && !h.airship) continue;
        // Most objects can't be entered from the three tiles above them, nor left upwards from their entrance
        // (VCMI's CMap::canMoveBetween checks the step both ways: a hero who visited the Alchemist's Lab walked on
        // up over its roof, the owner's note 2026-11-01 21:51). A hero standing on the entrance changes nothing.
        if (!h.airship && ((dy === 1 && closedAbove(w, s, j)) || (dy === -1 && closedAbove(w, s, i)))) continue;
        if (guard > 0 && w.visitBy[j] !== guard) continue;
        const c = cost + moveCost(w, s, h, { x, y, z }, { x: x + dx, y: y + dy, z });
        if (seen[j] !== g || c < costOf[j]) {
          reach(j, c, i, over);
          open.push(c, j);
        }
      }
    }
  }
  const out = new Map<number, PathNode>();
  for (const j of order) out.set(j, pass[j] ? { cost: costOf[j], prev: prevOf[j], passOnly: true } : { cost: costOf[j], prev: prevOf[j] });
  return out;
}

/**
 * Where a route (hero's tile first) runs into a fight: the first step onto a monster or into the
 * tiles around it (its guard zone, which stops the hero for a battle). -1 when no guard is met.
 */
export function fightStep(w: Pick<World, "guardedBy">, path: readonly number[]): number {
  for (let k = 1; k < path.length; k++) if (w.guardedBy[path[k]]) return k;
  return -1;
}

/**
 * Tiles where movement has to stop: objects to visit, monster guard zones, other heroes. Not a map
 * event: it's invisible, so routes run over it as over bare ground (the walk stops there if it fires).
 */
export function isStop(w: World, s: AdventureState, i: number): boolean {
  return (!!w.visitBy[i] && s.objects[w.visitBy[i] - 1]?.type !== EVENT) || !!w.guardedBy[i] || !!w.heroAt[i];
}

const EVENT = 26;

/** A free boat waiting at this tile, if any. */
export function boatAt(w: World, s: AdventureState, i: number) {
  const o = w.visitable(s, i);
  return o && o.type === 8 && o.carriedBy === undefined ? o : undefined;
}

const isWater = (w: World, i: number) => w.map.tiles[i].terrain === Terrain.WATER;

/**
 * Objects entered from above too (VCMI's isOnVisitableFromTopList: OBJECTS.TXT's classes 2-5): monsters, heroes,
 * artifacts, resources, Pandora's Box and the Treasure Chest, and these sea and road-side objects. Everything else only from the side or below.
 */
const FROM_TOP = new Set([
  54, 71, 72, 73, 74, 75, 162, 163, 164, // monsters
  34, 70, // heroes
  5, 65, 66, 67, 68, 69, 93, // artifacts, spell scrolls
  76, 79, // resources
  // Pandora's Box and the Treasure Chest: OBJECTS.TXT puts them in the artifacts' and resources' classes (4, 5), which
  // VCMI's list takes whole (2026-10-28: a chest on Arrogance reachable only from above could not be picked up).
  6, 101,
  // HotA's pickups (Ancient Lamp, Sea Barrel, Jetsam, Vial of Mana): class 5 in HotA's maps, "visitableFrom" every way in
  // the HotA mod's configs.
  145,
  29, 82, 86, 11, 59, 8, 111, 33, 219, 81, 12, 9, 212, 215, 22,
  26, // map events (invisible: from any side)
]);
export const visitableFromTop = (o: { type: number }) => FROM_TOP.has(o.type);

/**
 * Is this tile an entrance closed to the three tiles above it: no step down into it from them, and none up out of it to
 * them (the original's rule both ways; VCMI's CMap::canMoveBetween). Every map object's entrance in the original's and
 * HotA's maps is also one of its blocked tiles, so VCMI's "blocking objects only" leaves nothing out.
 */
export function closedAbove(w: World, s: AdventureState, i: number): boolean {
  const id = w.visitBy[i];
  if (!id) return false;
  const o = s.objects[id - 1];
  return !!o && !visitableFromTop(o);
}

/**
 * Objects visited from the tile beside them, the hero never standing on them (VCMI's blockVisit /
 * "blockedVisitable"): monsters, heroes and prisons, artifacts, scrolls and resources, and the
 * pickups (Pandora's Box, Treasure Chest, Campfire, Flotsam, Sea Chest, Shipwreck Survivor, Ocean
 * Bottle, Corpse, Scholar, HotA's Ancient Lamp, Sea Barrel, Jetsam, Vial of Mana), the Buoy, the
 * Shipwreck, Border and Quest Guards. Every other object's entrance is walked onto: the hero visits
 * it there and stays standing on it (Space visits it again).
 */
const BLOCK_VISIT = new Set([
  54, 71, 72, 73, 74, 75, 162, 163, 164, // monsters
  34, 62, 70, // heroes, prisons
  5, 65, 66, 67, 68, 69, 93, // artifacts, spell scrolls
  76, 79, // resources
  6, 101, 12, 29, 82, 86, 59, 22, 81, 11, 85, 9, 215,
  145, // HotA's pickups
]);
export const blockVisit = (o: { type: number }) => BLOCK_VISIT.has(o.type);

/**
 * Does a hero stepping onto this object's entrance stand there before the visit? Not for the
 * objects visited from beside them, nor for those the visit itself lets the hero onto or not
 * (Border Gates, Garrisons: stepOnto) or that the move handles itself (boats).
 */
export const entersToVisit = (o: { type: number; subid?: number }) => !BLOCK_VISIT.has(o.type) && o.type !== 8 && !(o.type === 212 && o.subid !== 1001) && o.type !== 33 && o.type !== 219;

function enterable(w: World, s: AdventureState, h: Hero, i: number): boolean {
  // An airship flies over anything but rock and other heroes.
  if (h.airship) return w.map.tiles[i].terrain !== Terrain.ROCK && !w.heroAt[i];
  if (w.blocked(i)) return false;
  if (h.boat !== undefined) {
    // At sea: water without another boat, or clear land to come ashore.
    if (isWater(w, i)) return !boatAt(w, s, i);
    if ((w.visitBy[i] && s.objects[w.visitBy[i] - 1]?.type !== EVENT) || w.guardedBy[i]) return false;
    // Never into a hole someone dug (heroes.thelazy.net Boat; boarding from one is fine).
    if (s.holes?.includes(i)) return false;
  } else if (isWater(w, i)) {
    // From the shore: board a free boat, meet one of our own heroes sailing beside it (2026-10-28: no trade
    // with a hero on a boat), or attack another's (VCMI's LayerTransitionRule: land to sea onto a boat or a hero;
    // The owner, 2026-11-01: "can't attack boat on shore, I should").
    const other = w.heroAt[i] ? s.heroes[w.heroAt[i] - 1] : undefined;
    return !!boatAt(w, s, i) || (!!other && other.id !== h.id);
  }
  const other = w.heroAt[i];
  // Another hero's tile ends the path: attack an enemy, meet a friend.
  if (other && other - 1 !== h.id) return true;
  return true;
}

export function mapPathTo(paths: Map<number, PathNode>, target: number): number[] {
  if (!paths.has(target)) return [];
  const out: number[] = [];
  for (let i = target; i !== -1; i = paths.get(i)!.prev) out.unshift(i);
  return out;
}

/** Binary min-heap of (priority, value) pairs. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];

  get size() {
    return this.keys.length;
  }

  push(key: number, val: number) {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop(): [number, number] {
    const { keys, vals } = this;
    const top: [number, number] = [keys[0], vals[0]];
    const key = keys.pop()!;
    const val = vals.pop()!;
    if (keys.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= keys.length) break;
        if (c + 1 < keys.length && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}
