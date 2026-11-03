// The occasion a thing is for, staged on its minimal scene (scenes.ts): where the scene shows what
// a thing does but gives the computer no reason to use it (a wound for Cure, gold on an island for
// Summon Boat, what lies beyond a monolith). The AI check (sim/aicheck.ts) plays the computer on
// them; Watch AI opens them as "occasion:<kind>-<id>[-<sub>]", the scene with its occasion staged.
import type { H3Map } from "@heroes/formats";
import { SPELL } from "../spells.ts";
import type { BattleState } from "../battle/state.ts";
import { asCreature, castSpell } from "../battle/magic.ts";
import { type GameData } from "./create.ts";
import { type TerrainLook } from "./rmg.ts";
import { type SceneSpec, generateScene, parseSceneName, sceneName } from "./scenes.ts";
import { B } from "./town.ts";
import { type AdventureState, type Hero, Obj } from "./types.ts";
import { Terrain, type World, maskTiles } from "./world.ts";

/** A change to the scene's map before the game starts. */
export type MapPrep = (m: H3Map, data: GameData) => void;
/** Changes to the game as it starts. */
export type Prep = (s: AdventureState, w: World, h: Hero) => void;
/** The occasion: the map changed, the game set, each of the computer's battles staged; and why, in words. */
export interface Occasion {
  map?: MapPrep;
  prep?: Prep;
  battle?: (b: BattleState, data: GameData) => void;
  why: string;
}

/** Puts an object on the scene's map, its entrance at (x, y). */
function putObject(m: H3Map, data: GameData, type: number, sub: number | undefined, x: number, y: number, objData: Record<string, unknown> = {}, z = 0) {
  const t = data.templates.find((o) => o.id === type && (sub === undefined || o.subid === sub)) ?? data.templates.find((o) => o.id === type);
  if (!t) return;
  const v = maskTiles(t.visitMask, 1)[0] ?? { dx: 0, dy: 0 };
  m.objects.push({ x: x - v.dx, y: y - v.dy, z, template: m.templates.push(t) - 1, id: t.id, subid: sub ?? t.subid, data: { owner: -1, ...objData } });
}
/** Sets the tiles of a line or block (x0..x1, y0..y1) to a terrain. */
function paint(m: H3Map, terrain: number, x0: number, y0: number, x1 = x0, y1 = y0, z = 0) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.tiles[z * m.size * m.size + y * m.size + x].terrain = terrain;
}
/** A ring of rock (x0..x1, y0..y1 its edge): what's inside is reached no other way than what the scene gives. */
function walledIn(m: H3Map, x0: number, y0: number, x1: number, y1: number, terrain: number = Terrain.ROCK) {
  paint(m, terrain, x0, y0, x1, y0);
  paint(m, terrain, x0, y1, x1, y1);
  paint(m, terrain, x0, y0, x0, y1);
  paint(m, terrain, x1, y0, x1, y1);
}
/** A pile of gold: what lies where only the thing gets the hero. */
const GOLD = (m: H3Map, data: GameData, x: number, y: number, z = 0) => putObject(m, data, Obj.RESOURCE, 6, x, y, { amount: 20 }, z);
/** HotA's wasteland terrain. */
const WASTELAND = 11;
const army = (list: [number, number][]) => [...list.map(([creature, count]) => ({ creature, count })), ...Array(7 - list.length).fill(null)];

/** Where the scene's island is: two tiles of grass in the middle of its lake (x 9-11, y 6-13), the gold on the upper one. */
const ISLAND = [
  { x: 10, y: 9 },
  { x: 10, y: 10 },
];
/** Two tiles of land in the lake with a pile of gold on them: worth a boat, a flight or a walk on the water, reached no other way. */
const island: MapPrep = (m, data) => {
  for (const { x, y } of ISLAND) m.tiles[y * m.size + x].terrain = Terrain.GRASS;
  GOLD(m, data, ISLAND[0].x, ISLAND[0].y);
};

/**
 * The army a battle spell needs to be worth casting (as cases.ts gives it): undead for Death Ripple
 * and Animate Dead, the fire-proof for Armageddon, a few Pikemen to give up for Sacrifice.
 */
const SPELL_ARMY: Record<number, [number, number][]> = {
  [SPELL.DEATH_RIPPLE]: [[56, 80], [58, 40], [60, 25], [62, 12]],
  [SPELL.ANIMATE_DEAD]: [[56, 80], [58, 40], [60, 25], [62, 12]],
  [SPELL.ARMAGEDDON]: [[83, 6], [53, 12]],
  [SPELL.SACRIFICE]: [[0, 10], [13, 6], [4, 20]],
};
/** The occasion a battle spell is for, staged as the fight begins: a wound for Cure, losses for Resurrection and Animate Dead, a fallen stack for Sacrifice, a curse for Dispel, a
 * stack worth the fire-proof's while for Armageddon. */
const SPELL_STAGE: Record<number, { battle: (b: BattleState, data: GameData) => void; why: string }> = {
  [SPELL.CURE]: { battle: (b) => void (ours(b)[0] && (ours(b)[0].firstHp = 1)), why: "a wounded stack of ours" },
  [SPELL.RESURRECTION]: { battle: (b) => halve(b), why: "a stack of ours half lost" },
  [SPELL.ANIMATE_DEAD]: { battle: (b) => halve(b), why: "a stack of ours half lost" },
  [SPELL.SACRIFICE]: { battle: (b) => void (ours(b)[1] && (ours(b)[1].count = 0)), why: "a stack of ours fallen" },
  // The fire-proof army is far stronger than the scene's stack: a fight won already gets no spell.
  [SPELL.ARMAGEDDON]: { battle: (b) => b.units.filter((u) => u.side === 1 && u.count > 0 && !u.machine).forEach((u) => (u.count = u.initialCount = u.count * 20)), why: "the fire-proof against a big stack" },
  // The enemy's stacks are not alike: one is four times the others, the one worth blinding.
  [SPELL.BLIND]: { battle: (b) => void (foes(b)[2] && (foes(b)[2].count = foes(b)[2].initialCount = foes(b)[2].count * 4)), why: "one enemy stack far stronger than the rest" },
  [SPELL.DISPEL]: {
    battle: (b, data) => {
      const first = ours(b)[0];
      if (!first) return;
      const curse = data.spells?.[SPELL.CURSE];
      if (curse) (b.spells ??= {})[SPELL.CURSE] = curse;
      asCreature({ name: "the dark", mastery: 1, power: 1, duration: 5 }, () => castSpell(b, 1, SPELL.CURSE, first.pos, []));
    },
    why: "a stack of ours cursed",
  },
};
const foes = (b: BattleState) => b.units.filter((u) => u.side === 1 && u.count > 0 && !u.machine);
const ours = (b: BattleState) => b.units.filter((u) => u.side === 0 && u.count > 0 && !u.machine);
function halve(b: BattleState) {
  const first = ours(b)[0];
  if (first) first.count = Math.max(1, first.count - Math.max(5, Math.floor(first.count / 2)));
}

/**
 * The occasion an adventure spell is for, where its scene (a shore, a boat: what shows the spell
 * working) gives the computer no reason to cast it:
 *  - Summon Boat, Fly, Water Walk: gold on an island in the lake;
 *  - Town Portal: the hero stranded on that island at the week's start, a town full of recruits at home;
 *  - Scuttle Boat: an enemy hero beside the empty boat, ours further off with another boat to take
 *    (it sinks the boat the enemy would take).
 */
const MAP_SPELL: Record<number, Occasion> = {
  [SPELL.SUMMON_BOAT]: { map: island, why: "gold on an island in the lake" },
  [SPELL.FLY]: { map: island, why: "gold on an island in the lake" },
  [SPELL.WATER_WALK]: { map: island, why: "gold on an island in the lake" },
  [SPELL.TOWN_PORTAL]: {
    map: (m, data) => {
      island(m, data);
      // (The lake as in the boat scenes; the portal scene has none of its own.)
      for (let y = 6; y <= 13; y++) for (let x = 9; x <= 11; x++) if (!ISLAND.some((p) => p.x === x && p.y === y)) m.tiles[y * m.size + x].terrain = Terrain.WATER;
    },
    prep: (s, w, h) => void ([h.x, h.y] = [ISLAND[1].x, ISLAND[1].y]),
    why: "the hero stranded on an island in a lake, recruits waiting at home",
  },
  [SPELL.SCUTTLE_BOAT]: {
    // (A boat of its own too, up the lake: the computer never sinks the only boat it could take itself.)
    map: (m, data) => putObject(m, data, Obj.BOAT, undefined, 9, 6),
    prep: (s, w, h) => {
      const rival = s.heroes.find((x) => !x.removed && x.owner === 1);
      if (rival) [rival.x, rival.y, rival.z] = [8, 12, 0];
      [h.x, h.y] = [5, 9];
    },
    why: "an enemy hero beside the empty boat, ours further off with another one",
  },
};

/** The army a hero carries spare artifacts with: a Helm of Chaos worn, two lesser helms (the Alabaster Unicorn's) in the pack, with no slot to wear them. */
const SPARE_HELMS: Prep = (s, w, h) => {
  (h.equipped ??= Array(19).fill(-1))[0] = 21;
  h.backpack = [19, 19];
};
/**
 * The occasion an object is for (by "type" or "type:subtype"), where its scene (made to show what it
 * does) gives the computer no reason to go: what lies beyond a way through, a need a trade meets, a
 * threat to shelter from; or what its use needs to matter.
 */
export const OBJECT_OCCASION: Record<string, Occasion> = {
  // An army of three towns for the Temple of Loyalty: only mixing three or more costs morale.
  "144:0": { prep: (s, w, h) => void (h.army = army([[0, 30], [14, 20], [28, 20]])), why: "an army of three towns" },
  // Some wasteland for the Trailblazer to guide through.
  "144:11": { prep: (s, w) => w.map.tiles.forEach((t, i) => void (i % w.size < 12 && Math.floor(i / w.size) >= 15 && (t.terrain = WASTELAND))), why: "wasteland to cross" },
  // HotA's Airship Yard: gold ringed by water, no boat to be had: reached only by air (the yard's price in hand).
  // (Not rock: an airship doesn't fly over the solid rock, as VCMI's air layer.)
  "87:1": {
    map: (m, data) => (walledIn(m, 12, 1, 17, 7, Terrain.WATER), GOLD(m, data, 15, 4)),
    prep: (s, w, h) => {
      const res = s.players[h.owner].resources;
      [res[0], res[6]] = [Math.max(res[0], 60), Math.max(res[6], 30000)];
    },
    why: "gold ringed by water, the airship's price in hand",
  },
  // The far end of a monolith walled in by rock, gold beside it.
  // (And a red one-way monolith back out, as a map leaves a way on from an exit: without one the hero was stranded for good.)
  "43": {
    map: (m, data) => (walledIn(m, 12, 1, 17, 7), GOLD(m, data, 16, 6), putObject(m, data, 43, 1, 13, 2), putObject(m, data, 44, 1, 13, 12)),
    why: "gold walled in by rock at its exit, a way back out",
  },
  "45": { map: (m, data) => (walledIn(m, 12, 1, 17, 7), GOLD(m, data, 16, 6)), why: "gold walled in by rock at its other end" },
  // Gold in the pocket underground.
  "103": { map: (m, data) => GOLD(m, data, 10, 12, 1), why: "gold in the pocket underground" },
  // The lake cut in two by rock, the second whirlpool in the upper half with flotsam, a sea chest and a survivor: reached only through the whirlpool.
  "111": {
    map: (m, data) => {
      paint(m, Terrain.WATER, 9, 2, 11, 7);
      paint(m, Terrain.ROCK, 9, 8, 11, 8);
      putObject(m, data, 29, 0, 9, 3);
      putObject(m, data, 82, 0, 11, 3);
      putObject(m, data, 86, 0, 10, 5);
    },
    why: "things afloat in a part of the lake reached only through it",
  },
  // The home town walled in by rock, troops waiting in its garrison (and no gold to hire a hero there to take them).
  "146:3": {
    map: (m) => (paint(m, Terrain.ROCK, 8, 0, 8, 8), paint(m, Terrain.ROCK, 0, 8, 8, 8)),
    prep: (s) => {
      s.objects.find((o) => o.town && o.owner === 0)!.town!.garrison[0] = { creature: 4, count: 20 };
      s.players[0].resources[6] = 0;
    },
    why: "the home town walled in by rock, troops waiting in it",
  },
  // A far stronger enemy hero a few steps off.
  "80": {
    prep: (s) => {
      const rival = s.heroes.find((x) => !x.removed && x.owner === 1)!;
      [rival.x, rival.y, rival.z] = [13, 10, 0];
      rival.army = army([[12, 30]]);
    },
    why: "a far stronger enemy hero a few steps off",
  },
  // Spare artifacts in the pack.
  "2": { prep: SPARE_HELMS, why: "two helms in the pack with none to wear them" },
  "144:7": { prep: SPARE_HELMS, why: "two helms in the pack with none to wear them" },
  // The town short of sulfur and gems for its next dwelling, with mercury and crystal to spare (and no marketplace).
  "144:9": {
    prep: (s) => {
      s.players[0].resources = [50, 30, 50, 0, 30, 0, 50000];
      s.objects.find((o) => o.town && o.owner === 0)!.town!.built.push(B.FORT, B.DWELLING + 1, B.DWELLING + 2, B.TOWN_HALL, B.DWELLING + 3, B.CITADEL, B.BLACKSMITH, B.MAGE_GUILD_1);
    },
    why: "the town short of sulfur and gems for its next dwelling, mercury and crystal to spare",
  },
  // Every slot taken, four of them by a few stragglers of four kinds. (Four stacks of Peasants were
  // merged into one on the first morning, which left the slots free and nothing to sell.)
  "213": { prep: (s, w, h) => void h.army.splice(3, 4, ...[[139, 3], [138, 2], [42, 4], [28, 2]].map(([creature, count]) => ({ creature, count }))), why: "every slot taken, four of them by a few stragglers (Peasants, Halflings, Imps, Gremlins)" },
  // An undead army with Peasants among it: Skeletons are worth more, and no morale is lost to mixing.
  "144:1": { prep: (s, w, h) => void (h.army = army([[56, 40], [58, 20], [139, 60]])), why: "an undead army with 60 Peasants among it" },
  // Out of mana, its army worth more: the Altar of Mana's trade is a loss (left alone).
  "146:2": { prep: (s, w, h) => void (h.mana = 0), why: "out of mana, the army worth more than spell points" },
};

/**
 * The occasion staged on a scene, if it has one: a battle spell's in each of its fights (with the
 * army it needs), an adventure spell's and an object's on the map.
 */
export function sceneOccasion(c: SceneSpec, sub = c.sub ?? 0): Occasion | undefined {
  if (c.kind === "object") return OBJECT_OCCASION[`${c.id}:${sub}`] ?? OBJECT_OCCASION[c.id];
  if (c.kind !== "spell") return undefined;
  if (c.id < 10) return MAP_SPELL[c.id];
  const list = SPELL_ARMY[c.id];
  const stage = SPELL_STAGE[c.id];
  if (!list && !stage) return undefined;
  return {
    prep: list ? (s, w, h) => void (h.army = army(list)) : undefined,
    battle: stage?.battle,
    why: [list && "the army it's cast for", stage?.why].filter(Boolean).join(", "),
  };
}

/** "occasion:<kind>-<id>[-<sub>]": the scene with its occasion staged (Watch AI). */
export function parseOccasionName(file: string): SceneSpec | null {
  return file.startsWith("occasion:") ? parseSceneName(`scene:${file.slice(9)}`) : null;
}
export const occasionName = (c: SceneSpec) => `occasion:${sceneName(c).slice(6)}`;

/** The occasion's map: the scene's, changed. */
export function generateOccasion(data: GameData, c: SceneSpec, look?: TerrainLook): H3Map {
  const m = generateScene(data, c, look);
  sceneOccasion(c)?.map?.(m, data);
  return m;
}

/** Stages the occasion's fight, if a battle of the scene's player (player 0) has just begun on an occasion's map. */
export function stageOccasionBattle(s: AdventureState, b: BattleState, data: GameData) {
  const c = parseOccasionName(s.mapFile);
  const stage = c && sceneOccasion(c)?.battle;
  if (stage && b.sides[0]?.owner === 0) stage(b, data);
}
