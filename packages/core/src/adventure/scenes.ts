// Minimal verifiable scenes: for one thing (an artifact, a map object, a spell, a skill, a hero, a
// creature, a building), the smallest map that shows it working: the hero one step from it, with
// only what it needs around (a shore for a boat spell, a stack to cast a battle spell on, a town to
// build in). The day-one message says what to do and what to look for; scenecheck.ts (sim) plays
// each scene's own proof and checks that the effect happened. Named "scene:<kind>-<id>[-<sub>]".
import type { H3Map, HotaScripts, MapEvent, MapObject, MapTile, ObjectTemplate } from "@heroes/formats";
import { SPELL } from "../spells.ts";
import { TOWNS } from "../townData.ts";
import { type CaseKind } from "./cases.ts";
import { type GameData } from "./create.ts";
import { type TerrainLook } from "./rmg.ts";
import { ARTIFACT_INFO } from "../artifactData.ts";
import { BANKS } from "../bankData.ts";
import { SPECIALTIES } from "../specialtyData.ts";
import { HERO_INFO } from "../heroData.ts";
import { COMBOS, MACHINE_SLOT, SLOT, SPELLBOOK_ARTIFACT, equipArtifact, initEquipment, lastPartOf } from "./artifacts.ts";
import { grow, levelUp } from "./starts.ts";
import { heroStartingSpells, makeHero, startingSkills } from "./create.ts";
import { dwellingOf } from "./rules.ts";
import { comesFree, missingBuildings, needsShipyard } from "./town.ts";
import { maxMana } from "./magic.ts";
import { maxMovement } from "./movement.ts";
import { type AdvObject, type AdventureState, type Hero, Obj } from "./types.ts";
import { Terrain, type World, heroSight, maskTiles, reveal } from "./world.ts";
import { SPECIAL } from "./townSpecials.ts";

export interface SceneSpec {
  kind: CaseKind;
  id: number;
  sub?: number;
}

export function sceneName(c: SceneSpec): string {
  return `scene:${c.kind}-${c.id}${c.sub !== undefined ? `-${c.sub}` : ""}`;
}

/**
 * A quick test scene ("scene:..." from the Wiki / the Matrix's Play, "occasion:..." its Watch AI): played
 * and dropped. Never kept as the game going on (Continue, Your games, its timeline, other devices; The owner,
 * 2026-10-27), so leaving one goes back to the real game as it was.
 */
export const isSceneFile = (file: string | undefined) => !!file && /^(scene|occasion):/.test(file);

export function parseSceneName(file: string): SceneSpec | null {
  const m = /^scene:([a-z]+)-(\d+)(?:-(\d+))?$/.exec(file);
  if (!m) return null;
  return { kind: m[1] as CaseKind, id: Number(m[2]), ...(m[3] ? { sub: Number(m[3]) } : {}) };
}

const N = 20;
/** Where the hero stands, and the tile it steps onto to use the thing (straight up). */
/**
 * Heroes added to the game after the scenes were proven (HotA's Beatrice, Kinkeria, Ranloo and
 * Giselle): a scene's random hero isn't drawn from them, so who stars in a scene (and the stats its
 * proof was measured with) doesn't change when the hero table grows. Each still has its own scene.
 */
export const SCENE_LATER_HEROES = [175, 176, 177, 178];
/** `scene:object-45-<this or more>`: the portals tour (EXTRAS cyclicPortals), not a monolith colour. */
export const PORTALS_TOUR = 100;
export const SCENE_HERO = { x: 8, y: 11 };
export const SCENE_SPOT = { x: 8, y: 10 };
/** Where a scene's foe stands (artifacts that show in battle): two tiles left of the spot. */
export const SCENE_FOE = { x: 6, y: 10 };
/** The gate of a rival's walled town to besiege (Earthquake, Ballistics, the Catapult, the bows that ignore walls). */
export const SCENE_SIEGE = { x: 3, y: 10 };
/** The player's town, top left (its gate below it). */
const TOWN_AT = { x: 4, y: 4 };
/** The rival, walled in by rock in the far corner: there, so the game goes on; out of the way. */
const RIVAL_AT = { x: 18, y: 18 };

/**
 * Scenes whose effect uncovers a circle of a given radius: the Redwood Observatory and the Pillar
 * of Fire (20 tiles around the hero), HotA's Ruins (12 around the bank, once won). Their map is
 * bigger and the layout shifted right and down, the spot near the middle, so that the circle shows
 * with fog beyond it on every side.
 */
const REVEAL_SCENES: Record<string, number> = { "58": 20, "60": 20, "16:32": 12 };
/** What a scene uncovers around the hero at the start (the hero's own sight is 5 to 8 tiles). */
const SCENE_SIGHT = 8;

/** The radius a scene's thing uncovers around the hero (or itself), if that is what it does. */
export function sceneRevealRadius(c: SceneSpec): number | undefined {
  if (c.kind !== "object") return undefined;
  return REVEAL_SCENES[`${c.id}:${c.sub ?? 0}`] ?? REVEAL_SCENES[String(c.id)];
}

/**
 * Scenes about how far one sees: Scouting (Expert, 10 tiles around the hero), the Speculum and the
 * Spyglass (one tile more each). The hero sees only its own sight there, no more, so that the
 * circle's edge is what shows; their map is big, as the reveal scenes'.
 */
export function sightScene(c: SceneSpec): boolean {
  if (c.kind === "skill") return c.id === 3;
  if (c.kind === "artifact") return (ARTIFACT_INFO[c.id]?.bonuses ?? []).some((b) => b.type === "SIGHT_RADIUS");
  return false;
}
/** A Tower town's Lookout Tower: the town sees 20 tiles around once it is built. */
const lookoutScene = (c: SceneSpec) => c.kind === "building" && c.id === SPECIAL.s2 && TOWNS[c.sub ?? 0]?.faction === "tower";

/** The circle a scene is about (its radius and the plain scene's tile it is centred on), if any. */
function sceneCircle(c: SceneSpec): { r: number; x: number; y: number } | undefined {
  const r = sceneRevealRadius(c);
  if (r) return { r, ...SCENE_SPOT };
  if (lookoutScene(c)) return { r: 20, ...TOWN_AT };
  if (sightScene(c)) return { r: 10, ...SCENE_HERO };
  return undefined;
}

/** The scene map's size and how far its layout is shifted right (dx) and down (dy) from the plain 20x20 one. */
export function sceneFrame(c: SceneSpec): { size: number; dx: number; dy: number } {
  const o = sceneCircle(c);
  if (!o) return { size: N, dx: 0, dy: 0 };
  // Room for the circle and a band of fog (3 tiles) beyond it on every side.
  const dx = Math.max(0, o.r + 3 - o.x);
  const dy = Math.max(0, o.r + 3 - o.y);
  return { size: Math.max(N + Math.max(dx, dy), o.x + dx + o.r + 4, o.y + dy + o.r + 4), dx, dy };
}

/** Where the scene's hero, spot, foe and siege gate are on its map (SCENE_HERO and the rest, shifted with the layout). */
export function scenePlaces(c: SceneSpec) {
  const { dx, dy } = sceneFrame(c);
  const at = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  return { hero: at(SCENE_HERO), spot: at(SCENE_SPOT), foe: at(SCENE_FOE), siege: at(SCENE_SIEGE), at };
}

/** What a scene has besides the hero and its town. */
interface Layout {
  /** Water east of the hero (sea things). */
  water?: boolean;
  /** The object on the spot (type, subtype, its map data). */
  object?: { type: number; sub: number; data?: Record<string, unknown> };
  /** A boat on the water beside the hero. */
  boat?: boolean;
  /** Swamp all around (Pathfinding's ground). */
  swamp?: boolean;
  /** Sand all around (the Nomads' ground). */
  sand?: boolean;
  /** A pool of water in the far corner, beyond the hero's sight (what a Cartographer uncovers). */
  pool?: boolean;
  /** Water beside the town (a shipyard's boat). */
  townWater?: boolean;
  /** A rival's walled town with a small garrison, to besiege. */
  siege?: boolean;
  /** An underground level: rock but for a pocket under the spot (the other end of a Subterranean Gate). */
  underground?: boolean;
  /** The object stands in the water instead of on the spot (a whirlpool). */
  objectAt?: { x: number; y: number };
  /** A stack to fight beside the thing (an artifact that shows in battle). */
  foe?: { sub: number; count: number };
  /** More objects the thing needs: the other end of a monolith, the keymaster for a border guard, an eye for the hut. */
  extra?: { type: number; sub: number; x: number; y: number; data?: Record<string, unknown> }[];
  /** HotA 1.8's map scripts, the timed events after day one's, and the home town's events (the script scenes). */
  scripts?: HotaScripts;
  events?: MapEvent[];
  townEvents?: Record<string, unknown>[];
}

/**
 * HotA 1.8's map scripts, shown (`scene:object-26-100`): the event on the spot springs bandits on the
 * hero, and once they're beaten the script goes on with a choice of two pictures (an artifact shown
 * beside them); on day two a timed event asks the player, with no hero, whether to pay a toll, and
 * goes on after the answer. `scene:object-26-101`: a Cove home town whose day-two event builds its
 * special buildings (the map format's HotA building bits).
 */
const SCRIPT_SCENES: Record<number, Pick<Layout, "scripts" | "events" | "townEvents"> & { faction?: number; text: string }> = {
  100: {
    text: "Step up into the event above you: bandits attack. Beat them and the script goes on (a choice of two pictures). Then end the turn: on day two a timed event asks you a question.",
    scripts: {
      events: {
        hero: {
          1: [
            { k: "message", text: "Bandits leap out of the bushes!", images: [] },
            { k: "combat", army: [{ creature: 139, count: 12 }] },
            {
              k: "question",
              mode: 1,
              text: "The bandits are routed. Among their loot: take the gold or the old soldier's teaching? (The Centaur's Axe stays with the dead.)",
              yes: [{ k: "resources", mode: 0, amounts: [0, 0, 0, 0, 0, 0, 1000], show: true }],
              no: [{ k: "experience", amount: 1000, show: true }],
              images: [{ kind: 0, sub: 6, isVar: false, value: 1000 }, { kind: 6, sub: 0, isVar: false, value: 1000 }],
              extra: [{ kind: 1, sub: 7, isVar: false, value: 0 }],
            },
            { k: "message", text: "The road ahead is clear.", images: [] },
          ],
        },
        player: {
          2: [
            { k: "question", mode: 0, text: "A tax collector rides in from the capital: pay 300 gold to keep the peace?", yes: [{ k: "resources", mode: 1, amounts: [0, 0, 0, 0, 0, 0, 300], show: false }], no: [{ k: "resources", mode: 0, amounts: [0, 0, 0, 0, 0, 0, 50], show: false }], images: [{ kind: 13, sub: 6, isVar: false, value: 300 }] },
            { k: "message", text: "The tax collector rides on.", images: [] },
          ],
        },
        town: {},
        quest: {},
      },
      names: {},
      variables: {},
    },
    events: [{ name: "Toll", message: "", resources: [0, 0, 0, 0, 0, 0, 0], players: 1, human: true, computer: false, first: 1, every: 0, script: { id: 2, sync: true } } as MapEvent],
  },
  101: {
    faction: 9,
    text: "Your town is a Cove. End the turn: on day two its town event builds the Thieves' Guild, the Grotto and the Gunpowder Warehouse (HotA's own building bits); open the town and look.",
    townEvents: [{ name: "Builders", message: "Builders from the coast put up new halls.", resources: [0, 0, 0, 0, 0, 0, 0], players: 1, human: true, computer: false, first: 1, every: 0, buildings: [16, 18, 19, 20, 28, 29], creatures: [0, 0, 0, 0, 0, 0, 0] }],
  },
};

/** What View Air and View Earth show in their scenes, in the fog top right: an artifact (the Centaur's Axe), a pile of gold, a sawmill. */
export const VIEW_ARTIFACT = { type: Obj.ARTIFACT, sub: 7, x: 17, y: 3 };
export const VIEW_RESOURCE = { type: 79, sub: 6, x: 17, y: 3 };
export const VIEW_MINE = { type: 53, sub: 0, x: 18, y: 5 };

const WATER_SPELLS = new Set<number>([SPELL.SUMMON_BOAT, SPELL.SCUTTLE_BOAT, SPELL.WATER_WALK]);
/** Things of the coast: water beside them (a shipyard, a lighthouse, the Seafaring Academy). */
const COAST_OBJECTS = new Set([8, 87, 42, 146]);
/** Things in the water, reached by boat: buoys, mermaids, sirens, flotsam, chests, survivors, bottles, wrecks, whirlpools, HotA's lamp, barrel, jetsam and vial, the Temple of the Sea. */
const WATER_OBJECTS = new Set(["11", "52", "92", "29", "82", "86", "59", "24", "85", "111", "145:1", "145:2", "145:3", "16:22"]);

/** An artifact that adds movement at sea (MOVEMENT heroMovementSea). */
const seaArtifact = (id: number) => (ARTIFACT_INFO[id]?.bonuses ?? []).some((b) => b.type === "MOVEMENT" && b.subtype === "heroMovementSea");

/** What a scene's map holds (scene recipes: what shows each kind of thing at its simplest). */
function layoutOf(data: GameData, c: SceneSpec): Layout {
  if (c.kind === "artifact") {
    const types = new Set((ARTIFACT_INFO[c.id]?.bonuses ?? []).map((b) => b.type));
    const battle = [...types].some((t) => BATTLE_ARTIFACT_TYPES.has(t)) || BATTLE_ARTIFACTS.has(c.id) || (ARTIFACT_INFO[c.id]?.bonuses ?? []).some((b) => b.limiters?.includes("OPPOSITE_SIDE"));
    const bonuses = ARTIFACT_INFO[c.id]?.bonuses ?? [];
    // The enemy hero's spell power (HotA): an enemy caster to fight, made in applyScene, instead of a stack.
    const enemyHero = bonuses.some((b) => (b.type === "PRIMARY_SKILL" && b.limiters?.includes("OPPOSITE_SIDE")) || b.type === "LEARN_BATTLE_SPELL_CHANCE");
    // More movement at sea (the Necklace of Ocean Guidance): water and a boat to sail.
    const sea = seaArtifact(c.id);
    return {
      object: { type: Obj.ARTIFACT, sub: lastPartOf(c.id), data: c.id === 1 ? { spell: SPELL.MAGIC_ARROW } : undefined },
      siege: types.has("NO_WALL_PENALTY") || c.id === 3,
      water: sea || types.has("FLYING_MOVEMENT") || types.has("WATER_WALKING") || types.has("FREE_SHIP_BOARDING") || types.has("WHIRLPOOL_PROTECTION"),
      boat: sea || types.has("FREE_SHIP_BOARDING") || types.has("WHIRLPOOL_PROTECTION"),
      swamp: types.has("ROUGH_TERRAIN_DISCOUNT"),
      // The Orb of Vulnerability: dragons to hurt with magic.
      // The Horn of the Abyss: Griffins, enough of each stack for Fangarms to rise from it.
      foe: battle && !enemyHero ? (types.has("RAISE_FANGARMS") ? { sub: 4, count: 40 } : { sub: types.has("NEGATE_ALL_NATURAL_IMMUNITIES") ? 83 : 0, count: types.has("NEGATE_ALL_NATURAL_IMMUNITIES") ? 3 : 20 }) : undefined,
      // Two whirlpools up the water: the voyage the Sea Captain's Hat protects.
      extra: types.has("WHIRLPOOL_PROTECTION") ? [{ type: Obj.WHIRLPOOL, sub: 0, x: 10, y: 12 }, { type: Obj.WHIRLPOOL, sub: 0, x: 10, y: 7 }] : undefined,
    };
  }
  if (c.kind === "object" && c.id === Obj.EVENT && SCRIPT_SCENES[c.sub ?? 0]) {
    const sc = SCRIPT_SCENES[c.sub!];
    return { object: sc.scripts ? { type: Obj.EVENT, sub: 0, data: { players: 0xff, human: true, computer: false, removeAfterVisit: true, script: { id: 1, sync: true } } } : undefined, scripts: sc.scripts, events: sc.events, townEvents: sc.townEvents };
  }
  if (c.kind === "object") {
    const sub = c.sub ?? 0;
    const extra: NonNullable<Layout["extra"]> = [];
    // The other end, far up the map: a one-way exit for an entrance, another two-way monolith.
    if (c.id === 43) extra.push({ type: 44, sub, x: 14, y: 4 });
    if (c.id === 45 && sub < PORTALS_TOUR) extra.push({ type: 45, sub, x: 14, y: 4 });
    // (`scene:object-45-100`: monoliths' exits in turn and where a portal leads, EXTRAS cyclicPortals: four more
    // two-way monoliths of the colour about the map, most in the fog, and a one-way entrance to the right with three exits.)
    if (c.id === 45 && sub >= PORTALS_TOUR) {
      for (const [x, y] of [[14, 4], [17, 9], [13, 15], [3, 15]]) extra.push({ type: 45, sub: 0, x, y });
      extra.push({ type: 43, sub: 0, x: 11, y: 12 });
      for (const [x, y] of [[2, 8], [16, 2], [9, 17]]) extra.push({ type: 44, sub: 0, x, y });
    }
    // The keymaster of the guard's colour, two steps right.
    if (c.id === 9 || (c.id === 212 && sub !== 1001)) extra.push({ type: 10, sub, x: 11, y: 10 });
    // An Eye of the Magi in the far corner, for the hut to look through.
    if (c.id === 37) extra.push({ type: 27, sub: 0, x: 16, y: 3 });
    // A second whirlpool up the water, for the first to lead to.
    if (c.id === Obj.WHIRLPOOL) extra.push({ type: Obj.WHIRLPOOL, sub: 0, x: 10, y: 7 });
    // A quest: bring 5 wood (the player has it), for 1000 gold.
    const QUEST = { mission: 7, resources: [5, 0, 0, 0, 0, 0, 0], reward: 5, resource: 6, amount: 1000 };
    // A map event: the map's words and 1000 gold, for human players only, gone once it fires.
    const EVENT = { message: "A traveller presses a purse of gold into your hand.", resources: [0, 0, 0, 0, 0, 0, 1000], players: 0xff, computer: false, human: true, removeAfterVisit: true };
    // (`scene:object-6-1`: a box guarded by 10 Peasants, for the warning before the fight.)
    const data = c.id === Obj.PANDORAS_BOX ? { experience: 1000, ...(sub === 1 ? { guards: [{ creature: 139, count: 10 }] } : {}) } : c.id === Obj.EVENT ? EVENT : c.id === 83 ? { quests: [QUEST] } : c.id === 215 ? QUEST : undefined;
    const afloat = WATER_OBJECTS.has(`${c.id}:${sub}`) || WATER_OBJECTS.has(String(c.id));
    return {
      object: { type: c.id, sub: c.id === Obj.PANDORAS_BOX || (c.id === 45 && sub >= PORTALS_TOUR) ? 0 : sub, data },
      water: afloat || COAST_OBJECTS.has(c.id),
      boat: afloat,
      // (Up the water, approached straight from below: a wide thing beside the boat can't be entered on the slant.)
      objectAt: afloat ? { x: 10, y: 9 } : undefined,
      underground: c.id === 103,
      pool: c.id === 13,
      extra: extra.length ? extra : undefined,
    };
  }
  if (c.kind === "spell") {
    if (c.id === SPELL.SCUTTLE_BOAT) return { water: true, boat: true };
    // View Air / View Earth: what they show, out in the fog top right (an artifact; gold and a sawmill); the rival's town and hero are in the fog too.
    const view = c.id === SPELL.VIEW_AIR ? [VIEW_ARTIFACT] : c.id === SPELL.VIEW_EARTH ? [VIEW_RESOURCE, VIEW_MINE] : undefined;
    if (c.id < 10) return { water: WATER_SPELLS.has(c.id) || c.id === SPELL.FLY, object: c.id === SPELL.VISIONS ? { type: Obj.MONSTER, sub: 13, data: { count: 7 } } : undefined, extra: view };
    if (c.id === SPELL.EARTHQUAKE) return { siege: true };
    // A Protection: an enemy caster to fight (made in applyScene), no stack: against a stack it guards nothing.
    if (GUARDED[c.id] !== undefined) return {};
    // A battle spell: a stack to fight and cast it on. Remove Obstacle fights on sand: the desert field has
    // no big cliff (elsewhere one can take every obstacle's place, and a cliff can't be removed).
    return { object: { type: Obj.MONSTER, sub: SPELL_TARGET[c.id] ?? 0, data: { count: 20, character: 4, noJoin: true, neverFlees: true, stacksCount: 4 } }, sand: c.id === SPELL.REMOVE_OBSTACLE };
  }
  if (c.kind === "skill") {
    const key = SKILL_SCENE[c.id];
    if (key === "navigation") return { water: true, boat: true };
    if (key === "pathfinding") return { swamp: true };
    if (key === "wisdom") return { object: { type: 90, sub: 0 } };
    // (`scene:skill-4-<percent>`: a HotA map's share of them that may join.)
    if (key === "diplomacy") return { object: { type: Obj.MONSTER, sub: 0, data: { count: 12, character: 1, ...(c.sub ? { joiningPercentage: c.sub } : {}) } } };
    if (key === "map") return {};
    if (c.id === 10) return { siege: true };
    // Eagle Eye: an enemy caster to fight (made in applyScene), no stack.
    if (c.id === 11) return {};
    return { object: { type: Obj.MONSTER, sub: 0, data: { count: 20, character: 4, noJoin: true, neverFlees: true, stacksCount: 4 } } };
  }
  if (c.kind === "building") {
    const faction = TOWNS[c.sub ?? 0]?.faction;
    // A second Inferno of ours for the Castle Gate to lead to; an outside dwelling of ours for the Portal of Summoning to draw from.
    const extra: NonNullable<Layout["extra"]> = [];
    if (faction === "inferno" && c.id === 22) extra.push({ type: Obj.TOWN, sub: 3, x: 14, y: 4, data: { owner: 0, formation: 0 } });
    if (faction === "dungeon" && c.id === 22) extra.push({ type: 17, sub: 0, x: 14, y: 4, data: { owner: 0 } });
    // (By the sea: the Shipyard, its ship, and whatever needs the Shipyard first (the Lighthouse...): an inland town can't build it.)
    return { townWater: needsShipyard(c.sub ?? 0, c.id), extra: extra.length ? extra : undefined };
  }
  if (c.kind === "creature") {
    const cr = data.creatures[c.id];
    // Cavaliers: the Stables that train them; Nomads: sand to cross; the rest a stack to fight (Rogues see its numbers).
    if (c.id === 10) return { object: { type: 94, sub: 0 } };
    if (cr?.abilities.some((a) => a.type === "NO_TERRAIN_PENALTY")) return { sand: true };
    return { object: { type: Obj.MONSTER, sub: 0, data: { count: 20, character: 4, noJoin: true, neverFlees: true, stacksCount: 4 } } };
  }
  if (c.kind === "hero") {
    const bonuses = SPECIALTIES[c.id]?.bonuses ?? [];
    // Shooters to forget for a Forgetfulness specialist; water for the navigators; swamp for the pathfinder.
    const shooters = bonuses.some((b) => b.type === "SPELL_DURATION" && b.spell === SPELL.FORGETFULNESS);
    return {
      object: { type: Obj.MONSTER, sub: shooters ? 2 : 0, data: { count: 20, character: 4, noJoin: true, neverFlees: true, stacksCount: 4 } },
      water: bonuses.some((b) => b.type === "MOVEMENT"),
      boat: bonuses.some((b) => b.type === "MOVEMENT"),
      swamp: bonuses.some((b) => b.type === "ROUGH_TERRAIN_DISCOUNT" || b.type === "BASE_TILE_MOVEMENT_COST"),
    };
  }
  return {};
}

/** Artifact bonuses that show in a battle: the scene puts a stack to fight beside them. */
const BATTLE_ARTIFACT_TYPES = new Set(["PERCENTAGE_DAMAGE_BOOST", "NO_DISTANCE_PENALTY", "NO_WALL_PENALTY", "STACKS_SPEED", "SPELL_DURATION", "SPELL_DAMAGE", "MAGIC_RESISTANCE", "SPELL_IMMUNITY", "MIND_IMMUNITY", "SURRENDER_DISCOUNT", "OPENING_BATTLE_SPELL", "STACK_HEALTH", "BATTLE_NO_FLEEING", "BLOCK_ALL_MAGIC", "BLOCK_MAGIC_ABOVE", "BLOCK_MAGIC_BELOW", "UNDEAD_RAISE_PERCENTAGE", "IMPROVED_NECROMANCY", "LEVEL_SPELL_IMMUNITY", "NEGATE_ALL_NATURAL_IMMUNITIES", "SPELL_RESISTANCE_AURA", "FREE_SHOOTING", "HP_REGENERATION", "LEARN_BATTLE_SPELL_CHANCE", "RAISE_FANGARMS"]);
/** ...and the war machines. */
const BATTLE_ARTIFACTS = new Set([3, 4, 5, 6, 146]);
/** Battle spells' targets where Pikemen won't show the effect: undead, shooters, a few for Hypnotize; Gnolls
 *  for Land Mine (Pikemen at home on the scene's grass see the mines, and it can't be cast at them). */
/** A boat takes the day to board: a player who doesn't know ends the turn to sail (the scenes' tests skip that wait). */
const BOARD_NOTE = " Boarding takes the rest of the day: end the turn (the End Turn button, last in the right-hand column), then sail.";
/** A Protection's scene: the enemy hero's spell of that school it guards against. */
const GUARDED: Record<number, number> = { [SPELL.PROT_AIR]: SPELL.LIGHTNING_BOLT, [SPELL.PROT_FIRE]: SPELL.FIREBALL, [SPELL.PROT_WATER]: SPELL.ICE_BOLT, [SPELL.PROT_EARTH]: SPELL.IMPLOSION };
const SPELL_TARGET: Record<number, number> = { [SPELL.DESTROY_UNDEAD]: 56, [SPELL.FORGETFULNESS]: 2, [SPELL.HYPNOTIZE]: 4, [SPELL.DISPEL]: 66, [SPELL.LAND_MINE]: 98, [SPELL.SLAYER]: 26 };
/** How each skill is shown: "navigation" (a boat), "pathfinding" (swamp), "wisdom" (a level 3 shrine), "diplomacy" (a stack that joins), "map" (nothing needed), else a stack to fight. */
// (Learning, 21, fights the stack: its experience shows afterwards.)
const SKILL_SCENE: Record<number, string> = { 0: "pathfinding", 2: "map", 3: "map", 4: "diplomacy", 5: "navigation", 7: "wisdom", 8: "map", 13: "map", 18: "map", 24: "map" };

/** The scene's map: grass, the town top left, the thing above the hero, the rival walled in. */
export function generateScene(data: GameData, c: SceneSpec, look?: TerrainLook): H3Map {
  const lay = layoutOf(data, c);
  // (A reveal scene: a bigger map, everything shifted; the layout below is drawn in the plain scene's coordinates.)
  const { size: n, dx: ox, dy: oy } = sceneFrame(c);
  const idx = (x: number, y: number) => y * n + x;
  const levels = lay.underground ? 2 : 1;
  const tiles: MapTile[] = Array.from({ length: n * n * levels }, (_, i) => {
    const x = (i % n) - ox;
    const y = (Math.floor(i / n) % n) - oy;
    const z = Math.floor(i / (n * n));
    // Underground: rock but for a pocket under the spot, where the gate comes out.
    if (z === 1) return { terrain: Math.abs(x - SCENE_SPOT.x) <= 2 && Math.abs(y - SCENE_SPOT.y) <= 2 ? Terrain.SUBTERRANEAN : Terrain.ROCK, view: 0, river: 0, riverDir: 0, road: 0, roadDir: 0, flags: 0 };
    const rock = (x === 12 && y >= 14) || (y === 14 && x >= 12);
    const water = (lay.water && x >= 9 && x <= 11 && y >= 6 && y <= 13) || (lay.pool && x >= 16 && y <= 3) || (lay.townWater && x === 7 && y >= 2 && y <= 6);
    const swamp = lay.swamp && x >= 6 && x <= 11 && y >= 7 && y <= 13;
    const sand = lay.sand && x >= 6 && x <= 11 && y >= 7 && y <= 13;
    return { terrain: rock ? Terrain.ROCK : water ? Terrain.WATER : swamp ? Terrain.SWAMP : sand ? Terrain.SAND : Terrain.GRASS, view: 0, river: 0, riverDir: 0, road: 0, roadDir: 0, flags: 0 };
  });
  for (let i = 0; i < n * n; i++) {
    const around: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = (i % n) + dx;
        const y = Math.floor(i / n) + dy;
        around.push(x >= 0 && y >= 0 && x < n && y < n ? tiles[idx(x, y)].terrain : tiles[i].terrain);
      }
    const v = look?.view(tiles[i].terrain, around, ((i * 7919) % 100) / 100) ?? { view: 0, flags: 0 };
    tiles[i].view = v.view;
    tiles[i].flags = (tiles[i].flags & ~3) | v.flags;
  }
  const templates: ObjectTemplate[] = [];
  const objects: MapObject[] = [];
  const find = (id: number, sub: number | undefined) =>
    data.templates.filter((t) => t.id === id && (sub === undefined || t.subid === sub)).find((t) => t.terrainMask & (1 << Terrain.GRASS)) ?? data.templates.find((t) => t.id === id && (sub === undefined || t.subid === sub)) ?? data.templates.find((t) => t.id === id);
  /** Places a template so that its entrance is at (ex, ey); returns where the gate in front is. */
  const put = (t: ObjectTemplate | undefined, ex0: number, ey0: number, objData: Record<string, unknown>, sub?: number, z = 0) => {
    if (!t) return null;
    const [ex, ey] = [ex0 + ox, ey0 + oy];
    const v = maskTiles(t.visitMask, 1)[0] ?? maskTiles(t.blockMask, 0)[0] ?? { dx: 0, dy: 0 };
    const x = ex - v.dx;
    const y = ey - v.dy;
    objects.push({ x, y, z, template: templates.push(t) - 1, id: t.id, subid: sub ?? t.subid, data: objData });
    return { x: ex, y: ey + 1 };
  };
  const factions = [sceneFaction(c), 0];
  const homeGate = put(find(Obj.TOWN, factions[0]), TOWN_AT.x, TOWN_AT.y, { owner: 0, formation: 0, ...(lay.townEvents ? { events: lay.townEvents } : {}) })!;
  const rivalGate = put(find(Obj.TOWN, factions[1]), RIVAL_AT.x - 2, RIVAL_AT.y - 1, { owner: 1, formation: 0 })!;
  if (lay.object) put(find(lay.object.type, lay.object.sub), lay.objectAt?.x ?? SCENE_SPOT.x, lay.objectAt?.y ?? SCENE_SPOT.y, { owner: -1, ...(lay.object.data ?? {}) }, lay.object.sub);
  // The gate's other end, straight below.
  if (lay.underground) put(find(103, 0), SCENE_SPOT.x, SCENE_SPOT.y, { owner: -1 }, 0, 1);
  if (lay.foe) put(find(Obj.MONSTER, lay.foe.sub), SCENE_FOE.x, SCENE_FOE.y, { owner: -1, count: lay.foe.count, character: 4, noJoin: true, neverFlees: true, stacksCount: 4 }, lay.foe.sub);
  for (const x of lay.extra ?? []) put(find(x.type, x.sub), x.x, x.y, { owner: -1, ...(x.data ?? {}) }, x.sub);
  if (lay.siege) put(find(Obj.TOWN, 0), SCENE_SIEGE.x, SCENE_SIEGE.y, { owner: 1, formation: 0, hasFort: true, army: [{ slot: 0, creature: 0, count: 10 }] });
  if (lay.boat) put(find(Obj.BOAT, undefined), SCENE_HERO.x + 1, SCENE_HERO.y, {});
  const player = (x: { x: number; y: number }, faction: number) => ({ canHuman: true, canComputer: true, aiTactic: 0, allowedFactions: 1 << faction, randomFaction: false, randomHero: true, mainHero: -1, mainTown: { x: x.x, y: x.y - 1, z: 0, generateHero: true } });
  const message = sceneText(data, c);
  return {
    version: 0x1c,
    hotaVersion: 0,
    size: n,
    levels,
    name: `Scene: ${sceneTitle(data, c)}`,
    description: message,
    difficulty: 1,
    levelLimit: 0,
    players: [player(homeGate, factions[0]), player(rivalGate, factions[1]), ...Array.from({ length: 6 }, () => ({ canHuman: false, canComputer: false }))],
    victory: { type: -1 },
    loss: { type: -1 },
    rumors: [],
    tiles,
    templates,
    objects,
    events: [{ name: "Scene", message, resources: [0, 0, 0, 0, 0, 0, 0], players: 1, human: true, computer: false, first: 0, every: 0 }, ...(lay.events ?? [])],
    ...(lay.scripts ? { hotaOptions: { specialMonths: true, scripts: lay.scripts } } : {}),
  };
}

/** A building's own faction; otherwise Castle. */
function sceneFaction(c: SceneSpec): number {
  if (c.kind === "object" && c.id === Obj.EVENT) return SCRIPT_SCENES[c.sub ?? 0]?.faction ?? 0;
  return c.kind === "building" && c.sub !== undefined ? c.sub : 0;
}

function sceneTitle(data: GameData, c: SceneSpec): string {
  if (c.kind === "artifact") return data.artifacts[c.id]?.name ?? `artifact ${c.id}`;
  if (c.kind === "spell") return data.spells?.[c.id]?.name ?? `spell ${c.id}`;
  if (c.kind === "creature") return data.creatures[c.id]?.plural ?? `creature ${c.id}`;
  if (c.kind === "hero") return data.heroNames[c.id] ?? `hero ${c.id}`;
  return `${c.kind} ${c.id}`;
}

/** What to do in the scene and what to look for (the game's own texts where it has them). */
export function sceneText(data: GameData, c: SceneSpec): string {
  const name = sceneTitle(data, c);
  if (c.kind === "artifact") {
    // (No "the The Grail"; the scroll's description names its spell.)
    const the = (x: string | undefined) => (x?.startsWith("The ") ? x : `the ${x}`);
    const description = (data.artifacts[c.id]?.description ?? "").replace("[spell name]", data.spells?.[SPELL.MAGIC_ARROW]?.name ?? "Magic Arrow");
    return `Step up onto ${the(COMBOS[c.id]?.length ? data.artifacts[lastPartOf(c.id)]?.name : name)}${COMBOS[c.id]?.length ? `, the last part of ${the(name)} (the others are worn already; open the hero screen to put them together)` : ""}. It goes to your hero (open the hero screen, H, to see it).${layoutOf(data, c).siege ? " Then attack the walled town to your left: the artifact shows in the siege." : layoutOf(data, c).foe ? " Then attack the Pikemen to your left: the artifact shows in the battle." : seaArtifact(c.id) ? " Then board the boat beside you: you sail further each day than without it." : sightScene(c) ? " Now you see 5 tiles around you; with it, a tile further (take a step and watch the fog's edge)." : ""}\n\n${description}`;
  }
  if (c.kind === "object" && c.id === Obj.WHIRLPOOL) return "Board the boat beside you and sail into the whirlpool: it carries you to the other one up the water (half of your weakest stack lost, unless you wear the Sea Captain's Hat)." + BOARD_NOTE;
  if (c.kind === "object" && c.id === Obj.SHIPYARD && c.sub === 1) return "Step up to the Airship Yard and buy an airship (5000 gold, 20 wood); board it the next day and fly over the water: it lands only on clear ground.";
  if (c.kind === "object" && c.id === Obj.EVENT && SCRIPT_SCENES[c.sub ?? 0]) return SCRIPT_SCENES[c.sub!].text;
  if (c.kind === "object" && c.id === 45 && (c.sub ?? 0) >= PORTALS_TOUR)
    return "Five monoliths of one colour stand about this map, most of them in the fog, and a one-way portal to your right leads to three exits. Step into the monolith above you again and again: with Settings → Additions → Monoliths' exits in turn on, each trip takes you to the next exit in order, so after five trips you have stood at every one. Hold (or right-click) a monolith or the portal: lines show where it leads, the next exit marked.";
  if (c.kind === "object" && c.id === 103) return "Step up into the gate: it takes you underground, to its other end.";
  if (c.kind === "object" && (c.id === 83 || c.id === 215)) return "Step up to it: the quest asks for 5 wood, which you have; hand it over for 1000 gold.";
  if (c.kind === "object" && (WATER_OBJECTS.has(`${c.id}:${c.sub ?? 0}`) || WATER_OBJECTS.has(String(c.id)))) return "Board the boat beside you and sail into the thing in the water: see what it does." + BOARD_NOTE;
  const radius = sceneRevealRadius(c);
  if (c.kind === "object" && radius && BANKS[`${c.id}:${c.sub ?? 0}`])
    return `Step up into the place above you and beat its guards: from the top of the tower the fog lifts in a circle ${radius} tiles around it. Now you see only ${SCENE_SIGHT} tiles around you and a little around your town; the map beyond the circle stays dark.`;
  if (c.kind === "object" && radius) return `Step up into the place above you: the fog lifts in a circle ${radius} tiles around. Now you see only ${SCENE_SIGHT} tiles around you and a little around your town; the map beyond the circle stays dark.`;
  if (c.kind === "object") return `Step up into the place above you and see what it does.`;
  if (c.kind === "spell") {
    const sp = data.spells?.[c.id];
    const what = sp?.text?.[3] ?? sp?.text?.[0] ?? "";
    if (c.id === SPELL.SUMMON_BOAT) return `Cast ${name} (C): a boat comes to the shore beside you.\n\n${what}`;
    if (c.id === SPELL.SCUTTLE_BOAT) return `Cast ${name} (C) on the boat beside you: it sinks.\n\n${what}`;
    if (c.id === SPELL.WATER_WALK) return `Cast ${name} (C), then walk out over the water.\n\n${what}`;
    if (c.id === SPELL.FLY) return `Cast ${name} (C), then fly out over the water.\n\n${what}`;
    if (c.id === SPELL.TOWN_PORTAL) return `Cast ${name} (C): you go to your town.\n\n${what}`;
    if (c.id === SPELL.DIMENSION_DOOR) return `Cast ${name} (C) on a tile a few steps away: you're there at once.\n\n${what}`;
    if (c.id === SPELL.VISIONS) return `Cast ${name} (C), then right-click the Archangels above: their exact number.\n\n${what}`;
    if (c.id === SPELL.VIEW_AIR) return `Cast ${name} (C) at Expert: the world view shows, through the fog, the artifact top right, and the rival's hero and town bottom right. Close it and press V: they stay shown until the day ends.\n\n${what}`;
    if (c.id === SPELL.VIEW_EARTH) return `Cast ${name} (C) at Expert: the world view shows, through the fog, the gold and the sawmill top right, and all the terrain. Close it and press V: they stay shown until the day ends.\n\n${what}`;
    if (c.id === SPELL.DISGUISE) return `Cast ${name} (C) at Expert: to the rival, every stack of yours looks like your town's strongest creature, the numbers 0, until tomorrow.\n\n${what}`;
    if (c.id < 10) return `Cast ${name} (C) and see the map.\n\n${what}`;
    if (c.id === SPELL.EARTHQUAKE) return `Attack the walled town to your left; in the siege, cast ${name}: the walls crack.\n\n${what}`;
    if (GUARDED[c.id] !== undefined) return `Attack the enemy hero to your left, who casts ${data.spells?.[GUARDED[c.id]]?.name ?? "a spell of that school"}; in the battle, cast ${name} from your spellbook: it does less.\n\n${what}`;
    return `Attack the stack above you; in the battle, cast ${name} from your spellbook.\n\n${what}`;
  }
  if (c.kind === "skill") {
    const key = SKILL_SCENE[c.id];
    if (key === "navigation") return "Board the boat beside you: you sail further each day than without the skill." + BOARD_NOTE;
    if (key === "pathfinding") return "Walk through the swamp around you: each step costs less than without the skill (right-click the route).";
    if (key === "wisdom") return "Step up into the Shrine of Magic Thought: without Wisdom a hero can't learn its level 3 spell.";
    if (key === "diplomacy") return "Walk up to the Pikemen: they offer to join you.";
    if (c.id === 10) return "Attack the walled town to your left: you aim the catapult yourself, and it hits more often.";
    if (c.id === 11) return "Attack the enemy hero to your left: after the battle you may learn the spells they know and cast.";
    if (c.id === 3) return "Your hero has Scouting at Expert: you see 10 tiles around you instead of 5; the map beyond the circle stays dark. Take a step and watch the fog's edge move with you.";
    if (c.id === 18) return "Walk onto your other hero to your left: you teach each other your spells.";
    return "Your hero has the skill at Expert: open the hero screen (H) and right-click it, then attack the stack above to see it at work.";
  }
  if (c.kind === "creature" && c.id === 10) return "Your Cavaliers and the Stables above: step in, and they ride out as Champions.";
  if (c.kind === "creature" && data.creatures[c.id]?.abilities.some((a) => a.type === "NO_TERRAIN_PENALTY")) return `Your army has ${name}: the sand around you costs no more than grass (right-click the route).`;
  if (c.kind === "creature" && data.creatures[c.id]?.abilities.some((a) => a.type === "VISIONS")) return `Your army has ${name}: right-click the stack above, you see its exact number.`;
  if (c.kind === "creature" && data.creatures[c.id]?.abilities.some((a) => a.type === "SPECIAL_CRYSTAL_GENERATION")) return `Your army has ${name}: at the start of the week they bring 3 crystal.`;
  if (c.kind === "creature" && data.creatures[c.id]?.abilities.some((a) => a.type === "GENERATE_RESOURCE")) return `Your army has ${name}: each brings a gold a day (end the turn and watch the gold).`;
  if (c.kind === "creature") return `Your army has ${name}: attack the stack above and watch them fight.`;
  if (c.kind === "hero" && SPECIALTIES[c.id]?.bonuses?.some((b) => b.type === "MOVEMENT")) return `This is ${name}: open the hero screen (H) for the specialty, then board the boat beside you: you sail further each day than other heroes.` + BOARD_NOTE;
  if (c.kind === "hero") return `This is ${name}: open the hero screen (H) for the specialty, then attack the stack above.`;
  if (lookoutScene(c)) return "You're in town with gold to spare: open the town hall and build the Lookout Tower. Now the town sees 5 tiles around; with the tower, 20 (the map beyond stays dark).";
  // (The Tavern hires only while no hero is inside: the hero steps out first.)
  if (c.kind === "building" && c.id === 5) return "You're in town with gold to spare: open the town hall and build the Tavern. It hires only while no hero is in town: step the hero out, come back to the town's screen from the town list, and open the Tavern.";
  if (c.kind === "building") {
    const sub = c.sub ?? 0;
    const bname = data.townTexts?.names[sub]?.[c.id] || TOWNS[sub]?.buildings[c.id]?.name;
    return `You're in town with gold to spare: open the town hall and build ${bname ? `the ${bname}` : "it"}; see what it adds.`;
  }
  return name;
}

/** Sets the scene's hero up after the map's own start: in place, with what the thing needs. */
export function applyScene(s: AdventureState, w: World, c: SceneSpec) {
  const h = s.heroes.find((x) => !x.removed && x.owner === 0);
  const town = s.objects.find((o) => o.town && !o.removed && o.owner === 0);
  if (!h || !town) return;
  const at = scenePlaces(c);
  const p = s.players[0];
  p.resources = p.resources.map((_, i) => (i === 6 ? 50000 : 50));
  // (The hero of the scene: its own starting skills, Adrienne's expert Fire Magic among them.)
  if (c.kind === "hero") {
    h.type = c.id;
    h.skills = startingSkills(c.id);
    // Its own name and class too, not the drawn hero's.
    h.name = w.data.heroNames[c.id] ?? HERO_INFO[c.id]?.name ?? h.name;
    h.heroClass = HERO_INFO[c.id]?.heroClass ?? h.heroClass;
  }
  levelUp(s as AdventureState & { rng: number }, w, h, 6, []);
  // Nothing worn but the machines and the book: the random starting bonus may have handed a treasure
  // artifact (a Badge of Courage in a misc slot would add its morale to every combination's count).
  initEquipment(h);
  for (let i = 0; i < SLOT.MACH1; i++) h.equipped![i] = -1;
  h.backpack = [];
  // Plain enough that the thing's effect is what changes.
  h.army = [{ creature: 0, count: 60 }, { creature: 2, count: 30 }, { creature: 4, count: 15 }, null, null, null, null];
  if (c.kind === "creature") h.army[3] = { creature: c.id, count: Math.max(3, 30 - 4 * (w.creatures[c.id]?.level ?? 1)) };
  if (c.kind === "hero") {
    // What the specialty works on: its skill, its creature in the army, its spell in the book (with Bless, Shield and Clone for the odd ones).
    const sp = SPECIALTIES[c.id];
    if (sp?.skill !== undefined) h.skills = [[sp.skill, 3], ...(h.skills ?? []).filter(([id]) => id !== sp.skill).slice(0, 7)];
    const creature = sp?.creatures?.[0] ?? sp?.bonuses?.find((b) => b.creatures?.length)?.creatures?.[0] ?? (sp?.bonuses?.some((b) => b.type === "PRIMARY_SKILL" && !b.creatures) ? 26 : undefined);
    if (creature !== undefined) h.army[3] = { creature, count: 10 };
    const own = (sp?.bonuses ?? []).map((b) => b.spell).filter((x): x is number => typeof x === "number");
    h.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
    // (And the hero's own starting spells: Dargem's Air Shield is his specialty's.)
    h.spells = [...new Set([...own, ...(heroStartingSpells(c.id) ?? []), SPELL.BLESS, SPELL.SHIELD, SPELL.CLONE, SPELL.HASTE])];
    h.skills = [[7, 3], ...(h.skills ?? []).filter(([id]) => id !== 7).slice(0, 7)];
    h.primary[2] = Math.max(h.primary[2], 5);
    // Enough spell points for the specialty's spell (Slayer, Clone, Forgetfulness), whoever the hero is.
    h.primary[3] = Math.max(h.primary[3], 5);
    h.mana = maxMana(h);
  }
  if (c.kind === "spell") {
    h.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
    h.spells = [c.id];
    h.primary[2] = Math.max(h.primary[2], 6);
    h.primary[3] = Math.max(h.primary[3], 10);
    // Animate Dead needs undead of our own.
    // (Alone in the army, so the foes strike it and some fall to be raised; with other stacks beside it none did.)
    if (c.id === SPELL.ANIMATE_DEAD) h.army = h.army.map((_, i) => (i === 3 ? { creature: 56, count: 30 } : null));
    // Its school at Expert: the spell at its best (Summon Boat makes a boat only from Advanced);
    // `scene:spell-<id>-<level>` at that level instead (0 none, 1 Basic, 2 Advanced).
    const schools = { fire: 14, air: 15, water: 16, earth: 17 } as Record<string, number>;
    const level = c.sub ?? 3;
    h.skills = level ? (w.data.spells?.[c.id]?.schools ?? []).slice(0, 4).map((sc) => [schools[sc], level] as [number, number]).filter(([id]) => id !== undefined) : [];
    // (Full, with the skills it keeps: no Intelligence from the level-ups left in the sum.)
    h.mana = maxMana(h);
    // A Protection: the enemy caster it guards against, two tiles left, with troops enough for a few rounds (the AI
    // casts one only once it has seen the enemy hero cast a spell of that school: the owner, 2026-10-27 18:26 and 10-31).
    if (GUARDED[c.id] !== undefined) {
      const type = Object.keys(w.data.heroNames).map(Number).find((t) => t !== h.type && w.data.heroNames[t] && !s.heroes.some((x) => x.type === t))!;
      const foe = makeHero(s, w.data, type, 1, at.foe.x, at.foe.y, 0, [{ creature: 0, count: 30 }, { creature: 0, count: 30 }, { creature: 0, count: 30 }, null, null, null, null]);
      initEquipment(foe);
      foe.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
      foe.spells = [GUARDED[c.id]];
      foe.primary[2] = Math.max(foe.primary[2], 6);
      foe.primary[3] = Math.max(foe.primary[3], 10);
      foe.mana = maxMana(foe);
      s.heroes.push(foe);
    }
  }
  // (A magic school's scene: no other school from the level-ups, or Magic Arrow is cast at Expert without it too.)
  if (c.kind === "skill") h.skills = [[c.id, 3], ...(h.skills ?? []).filter(([id]) => id !== c.id && id !== 7 && !(c.id >= 14 && c.id <= 17 && id >= 14 && id <= 17)).slice(0, 6)];
  if (c.kind === "artifact") {
    const types = new Set((ARTIFACT_INFO[c.id]?.bonuses ?? []).map((b) => b.type));
    // Nothing else worn (a hero's own starting artifact in a misc slot left the Statue of Legion a slot short).
    for (let i = SLOT.HEAD; i <= SLOT.MISC5; i++) h.equipped![i] = -1;
    h.backpack = [];
    // A combination: every part but the last already worn (the last is on the map); the hero screen offers the assembly after the pickup.
    for (const p of (COMBOS[c.id] ?? []).slice(0, -1)) if (!equipArtifact(h, w.data.artifacts, p)) (h.backpack ??= []).push(p);
    // A necromancer for the Necromancy artifacts; a caster (a few spells of every level, Expert Wisdom) for the magic ones; no book for the spellbook itself.
    if (types.has("UNDEAD_RAISE_PERCENTAGE") || types.has("IMPROVED_NECROMANCY")) h.skills = [[12, 3], ...(h.skills ?? []).filter(([id]) => id !== 12).slice(0, 7)];
    // The Angelic Alliance: three good towns' troops, whose mixing costs morale.
    if (types.has("NONEVIL_ALIGNMENT_MIX")) (h.army[3] = { creature: 14, count: 10 }), (h.army[4] = { creature: 28, count: 10 });
    // The enemy caster for the Charm of Eclipse and kin, two tiles left; for the Eagle Eye artifacts (Bird of Perception...)
    // one with a book of cheap spells and no spell points to cast them: each is rolled for after the fight, our hero's Eagle Eye basic.
    const learning = types.has("LEARN_BATTLE_SPELL_CHANCE");
    if (learning || (ARTIFACT_INFO[c.id]?.bonuses ?? []).some((b) => b.type === "PRIMARY_SKILL" && b.limiters?.includes("OPPOSITE_SIDE"))) {
      const type = Object.keys(w.data.heroNames).map(Number).find((t) => t !== h.type && w.data.heroNames[t] && !s.heroes.some((x) => x.type === t))!;
      const foe = makeHero(s, w.data, type, 1, at.foe.x, at.foe.y, 0, [{ creature: 0, count: 10 }, null, null, null, null, null, null]);
      initEquipment(foe);
      foe.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
      foe.spells = learning ? [SPELL.MAGIC_ARROW, SPELL.HASTE, SPELL.SLOW, SPELL.BLESS, SPELL.CURSE, SPELL.SHIELD, SPELL.STONE_SKIN, SPELL.BLOODLUST] : [SPELL.MAGIC_ARROW];
      foe.primary[2] = 12;
      foe.mana = learning ? 0 : maxMana(foe);
      s.heroes.push(foe);
      if (learning) h.skills = [[11, 1], ...(h.skills ?? []).filter(([id]) => id !== 11).slice(0, 7)];
    }
    if (c.id !== SPELLBOOK_ARTIFACT) {
      h.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
      h.spells = [SPELL.HASTE, SPELL.MAGIC_ARROW, SPELL.LIGHTNING_BOLT, SPELL.FIREBALL, SPELL.SLAYER];
      h.skills = [[7, 3], ...(h.skills ?? []).filter(([id]) => id !== 7).slice(0, 7)];
      h.primary[2] = Math.max(h.primary[2], 5);
      h.mana = maxMana(h);
    } else (h.equipped![SLOT.SPELLBOOK] = -1), (h.spells = undefined);
  }
  if (c.kind === "skill" && SKILL_SCENE[c.id] === "wisdom") h.spells = [];
  // Scholar: another hero of ours to meet, with spells this one lacks; Eagle Eye: an enemy caster to beat.
  if (c.kind === "skill" && (c.id === 18 || c.id === 11)) {
    const type = Object.keys(w.data.heroNames).map(Number).find((t) => t !== h.type && w.data.heroNames[t] && !s.heroes.some((x) => x.type === t))!;
    const other = makeHero(s, w.data, type, c.id === 18 ? 0 : 1, at.foe.x, at.foe.y, 0, [{ creature: 0, count: c.id === 18 ? 10 : 5 }, null, null, null, null, null, null]);
    initEquipment(other);
    other.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
    other.spells = [SPELL.HASTE, SPELL.SLOW, SPELL.BLESS, SPELL.STONE_SKIN, SPELL.SHIELD];
    other.primary[3] = Math.max(other.primary[3], 5);
    other.mana = maxMana(other);
    other.movement = other.maxMovement = maxMovement(w, other);
    s.heroes.push(other);
  }
  // The battle skills: a caster with Magic Arrow (the magic schools, Sorcery, Interference), a ballista and a tent (Artillery, First Aid).
  if (c.kind === "skill" && SKILL_SCENE[c.id] !== "wisdom") {
    h.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
    h.spells = [SPELL.MAGIC_ARROW];
    h.primary[2] = Math.max(h.primary[2], 5);
    h.mana = maxMana(h);
    h.equipped![SLOT.MACH1] = 4;
    h.equipped![SLOT.MACH3] = 6;
  }
  // A First Aid or Artillery specialist: the tent or the ballista their skill works with.
  if (c.kind === "hero") {
    const skill = SPECIALTIES[c.id]?.skill;
    if (skill === 27) h.equipped![SLOT.MACH3] = 6;
    if (skill === 20) h.equipped![SLOT.MACH1] = 4;
  }
  // A war machine's scene: its slot empty, so the one found goes on (a cannon doesn't wait in the pack behind a ballista).
  if (c.kind === "artifact" && MACHINE_SLOT[c.id] !== undefined) h.equipped![MACHINE_SLOT[c.id]] = -1;
  if (c.kind === "object") {
    const key = `${c.id}:${c.sub ?? 0}`;
    // A bank's guards (dragons at the Utopia): an army that wins; a Library needs level 10; a level 3 shrine and the Pyramid Wisdom; the wells a drained caster; the Stables Cavaliers to train.
    // (The abandoned mine's guards, up to 199 Troglodytes, too: the starting army's win hung on the level-ups' skills.)
    if (BANKS[key] || (c.id === 220 && c.sub === 7)) h.army = [{ creature: 13, count: 40 }, { creature: 41, count: 40 }, { creature: 83, count: 20 }, null, null, null, null];
    if (c.id === 41) levelUp(s as AdventureState & { rng: number }, w, h, 10, []);
    if (c.id === 90 || c.id === 63) h.skills = [[7, 3], ...(h.skills ?? []).filter(([id]) => id !== 7).slice(0, 7)];
    if (c.id === 94) h.army[3] = { creature: 10, count: 5 };
    // The Altar of Sacrifice: an artifact to give up (a good hero gives artifacts).
    if (c.id === 2) (h.backpack ??= []).push(7);
    if ([48, 49, 63, 88, 89, 90, 81, 93].includes(c.id) || key === "145:3" || key === "146:2") {
      h.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
      h.spells ??= [];
      h.mana = c.id === 48 || c.id === 49 || key === "145:3" || key === "146:2" ? 0 : maxMana(h);
    }
  }
  if (c.kind === "building") grow(s as AdventureState & { rng: number }, w, town, "all", true, c.id);
  // The thing to build isn't there yet (the map's town came with a Tavern and a Village Hall; a dwelling's upgrade or a hall's twin may have gone up with it), nor what stands on it.
  if (c.kind === "building" && town.town) {
    const t = town.town;
    // (One that comes by itself — a horde building's upgrade, a decorative "extra" — waits for what brings it: the dwelling upgrade, the hall.)
    const info = TOWNS[c.sub ?? 0]?.buildings[c.id];
    const trigger = info && comesFree(info) ? [info.upgrades] : info?.key.startsWith("extra") ? [info.requires] : [];
    t.built = t.built.filter((b) => b !== c.id && !trigger.includes(b));
    for (let again = true; again; ) {
      again = false;
      for (const b of [...t.built]) if (missingBuildings(w, town, b).length) (t.built = t.built.filter((x) => x !== b)), (again = true);
    }
  }
  // An outside dwelling of ours (the Portal of Summoning draws on it): its creatures known.
  if (c.kind === "building") for (const d of s.objects) if (d.type === 17 && !d.removed && d.owner === 0) dwellingOf(w, d);
  // A second town of ours in the scene (the Castle Gate's other end): everything built.
  if (c.kind === "building") for (const t of s.objects) if (t.town && !t.removed && t.owner === 0 && t !== town) grow(s as AdventureState & { rng: number }, w, t, "all", true);
  // The town to besiege: castle walls (the map gave it a fort).
  const besieged = s.objects.find((o) => o.town && !o.removed && o.owner === 1 && o.y <= at.siege.y + 2);
  if (besieged?.town) for (const b of [7, 8, 9]) if (!besieged.town.built.includes(b)) besieged.town.built.push(b);
  // The Grail is brought home, not built: the hero carries it.
  if (c.kind === "building" && c.id === 26) (h.backpack ??= []).push(2);
  // The growth artifacts (the Legion's pieces, the Statue): every dwelling built, so the growth they raise exists.
  if (c.kind === "artifact" && ((c.id >= 118 && c.id <= 122) || c.id === 133)) grow(s as AdventureState & { rng: number }, w, town, "all", true);
  // On the spot: below the thing (or in town, for a building).
  if (c.kind !== "building") (h.x = at.hero.x), (h.y = at.hero.y);
  // The sight scenes: the hero's own sight from a plain start (no Scouting but the skill's own scene's).
  if (sightScene(c) && c.kind === "artifact") h.skills = (h.skills ?? []).filter(([id]) => id !== 3);
  h.maxMovement = h.movement = maxMovement(w, h);
  // (Where the hero is: on the spot, or in town for a building.)
  reveal(s, w, 0, h.x, h.y, 0, sightScene(c) ? heroSight(h) : lookoutScene(c) ? 0 : SCENE_SIGHT);
  w.refresh(s);
}

/** The scene's thing on the map (on the spot above the hero), if it has one. */
export function sceneObject(s: AdventureState): AdvObject | undefined {
  const c = parseSceneName(s.mapFile);
  const spot = c ? scenePlaces(c).spot : SCENE_SPOT;
  return s.objects.find((o) => !o.removed && !o.town && maskTiles(o.visit, 1).some(({ dx, dy }) => o.x + dx === spot.x && o.y + dy === spot.y)) ?? s.objects.find((o) => !o.removed && o.x === spot.x && o.y === spot.y);
}

/** The faction index of a town object (for building scenes' names). */
export const sceneFactionOf = (faction: string) => TOWNS.findIndex((t) => t.faction === faction);
export type SceneHero = Hero;

/**
 * Creatures with an effect on the map (the rest show in battle only): Rogues' Visions, Crystal
 * Dragons' crystal, HotA Kobolds' gold, Nomads crossing sand, Cavaliers trained at the Stables, the Skeleton Transformer's.
 */
export function creatureHasMapScene(c: { id: number; abilities: { type: string }[] } | undefined): boolean {
  if (!c) return false;
  return c.id === 10 || c.abilities.some((a) => ["VISIONS", "SPECIAL_CRYSTAL_GENERATION", "GENERATE_RESOURCE", "NO_TERRAIN_PENALTY"].includes(a.type));
}
