import { skillLevel } from "../skills.ts";
import { skillFactor, speedBonus, spellSpecialtyPercent } from "../specialty.ts";
import { COMBAT_SPELLS, type SpellInfo, isPositive } from "../spells.ts";
import { castKeepsTurn, creatureCast, devour, devours, enchant } from "./creatureMagic.ts";
import { CYCLOPS_SHOT, TOWER_POS, WALL_SEGMENTS, type WallPart, autoCatapultTarget, catapultTable, catapultTargets, chanceToHit, damageWall, inMoat, moatHolds, missedShotLands, nextStoneTarget, wallPenalty } from "./siege.ts";
import { updateGate } from "./gate.ts";
import { SPELL } from "../spells.ts";
import { affects, asCreature, castSpell, freeHexNear, lightningRod, orbOfVulnerability, schoolBoost, sorcery, spellDamageTaken } from "./magic.ts";
import { type CreatureStats, ability, hasAbility } from "../creatures.ts";
import { randInt, random } from "../rng.ts";
import { HEX_COUNT, hexCol, hexDistance, hexRow, hexToward, isPlayable, neighbours, sideOf } from "./hex.ts";
import { type BattleState, type Side, type Unit, FANGARM } from "./state.ts";
import { LOG, type LogEntry, type LogLine, type OurLine } from "./texts.ts";
import { cursedGround } from "./ground.ts";
import { Refusal } from "../refusal.ts";
import { binomial, defenseOf, disabled, fearless, hpOf, isLiving, meditating, rangePenalty, releaseBound, rollDamage, suppliedByCart, takeDamage, totalHp } from "./damage.ts";
import { activeUnit, areAdjacent, canFly, canStand, enemyAdjacent, fliesBack, hazardsAt, isWide, pathTo, reachable, unitAt, unitHexes } from "./reach.ts";
import { cheers, panics, rollLuck } from "./morale.ts";

export type BattleAction =
  | { type: "move"; unit: number; to: number }
  /** stay: HotA's alternate action for Harpies, strike and stay instead of flying back. */
  | { type: "attack"; unit: number; target: number; from: number; stay?: boolean }
  | { type: "shoot"; unit: number; target: number }
  /** HotA: an area shooter (Magogs) aims at an empty hex; the blast hits whoever stands around it. */
  | { type: "shootHex"; unit: number; hex: number }
  | { type: "wait"; unit: number }
  | { type: "defend"; unit: number }
  /** The hero of the active unit's side gives up: retreat (army lost) or surrender (pay, keep the army). */
  | { type: "retreat"; unit: number; surrender: boolean }
  /** The hero of the active unit's side casts (once per round); the unit then still acts. */
  | { type: "cast"; unit: number; spell: number; target: number; dest?: number }
  /** A spellcasting creature casts at a hex instead of acting. */
  | { type: "creatureCast"; unit: number; target: number; dest?: number }
  /** Tactics phase: put one of your stacks somewhere else in your area, or start the battle. */
  | { type: "tacticMove"; unit: number; to: number }
  | { type: "tacticsDone"; unit: number }
  /** The catapult hurls a stone at a wall part. */
  | { type: "catapult"; unit: number; target: WallPart }
  /** The First Aid Tent (with First Aid) heals the chosen stack. */
  | { type: "heal"; unit: number; target: number };

export type BattleEvent =
  | { e: "turn"; unit: number }
  | { e: "move"; unit: number; path: number[]; fly: boolean }
  | {
      e: "attack";
      unit: number;
      target: number;
      ranged: boolean;
      retaliation: boolean;
      damage: number;
      killed: number;
      /** Extra target of a breath / multi-head / all-adjacent attack: no separate swing. */
      splash?: boolean;
      deathBlow?: boolean;
      /** Lucky (double) or unlucky (half) strike. */
      luck?: "good" | "bad";
      /** Damage reflected by a Fire Shield. */
      fireShield?: boolean;
      /** The Rust Dragons' acid on top of the blow. */
      acid?: boolean;
    }
  | { e: "drain"; unit: number; amount: number; revived: number; tent?: boolean }
  | { e: "stare"; unit: number; target: number; killed: number }
  | { e: "rebirth"; unit: number; count: number }
  | { e: "death"; unit: number }
  /** Fangarms rising from a slain stack (the Horn of the Abyss). */
  | { e: "rise"; unit: number; from: number }
  | { e: "wait"; unit: number }
  | { e: "defend"; unit: number }
  | { e: "morale"; unit: number; good: boolean }
  /** Something on the stack goes off by itself (VCMI's BattleTriggerEffect): Azure Dragons' fear, a
   *  wound closing, poison biting, Wraiths draining the enemy hero's spell points. */
  | { e: "trigger"; unit: number; what: "fear" | "regen" | "poison" | "manaDrain"; amount?: number }
  | { e: "round"; round: number }
  | {
      e: "spell";
      side: Side;
      spell: number;
      /** Target hex (for the animation). */
      hex: number;
      units: number[];
      damage: { unit: number; damage: number; killed: number }[];
      resisted: number[];
      /** Units that appeared (summons, clones). */
      summoned?: number[];
      /** Reflected by Magic Mirror onto these units. */
      reflected?: boolean;
      /** Cast by a creature's ability rather than a hero. */
      ability?: boolean;
      /** The creature stack that cast it. */
      by?: number;
      /** What a creature's own cast did, for the log (Repair, Ignition, Meditation, Devour, Raise Demons). */
      note?: LogEntry;
      /** HotA's own pictures for its creatures' casts (the mod's spell configs), in place of the stand-in spell's. */
      look?: "ignite" | "meditate" | "repair" | "devour" | "detonate";
    }
  /** A catapult stone: hit (damage 0..2) or missed; destroyed parts fall. */
  | { e: "catapult"; unit: number; part: WallPart; damage: number; destroyed: boolean }
  /** Stepping into the moat hurts. */
  | { e: "moat"; unit: number; damage: number; killed: number }
  | { e: "end"; winner: Side | "draw" };

// ---- queries -------------------------------------------------------------

export const stats = (s: BattleState, u: Unit): CreatureStats => s.creatures[u.creature];
/** A stack's name as the original writes it (VCMI's CStack::getName): singular for one creature, else plural. */
export const stackName = (s: BattleState, u: Unit): string => (u.count === 1 ? stats(s, u).name : stats(s, u).plural);

/** A spell currently on the unit. */
export const effectOf = (u: Unit, spell: number) => u.effects?.find((e) => e.spell === spell);

/** Speed with Haste, Slow and Prayer. */
// ---- Runes (HotA) ---------------------------------------------------------
// heroes.thelazy.net/index.php/Runes: each Rune Level gives, in turn, +2 Attack, +2 Defense,
// +1 Speed; Basic/Advanced/Expert allow 3/6/9 levels. Yeti Runemasters have Expert Runes of
// their own, added to the hero's.

const heroRuneCap = (s: BattleState, u: Unit) => 3 * skillLevel(s.sides[u.side].hero?.skills, "runes");
const ownRunes = (s: BattleState, u: Unit) => stats(s, u).abilities.some((a) => a.type === "YETI_RUNE_LEVEL_COUNTER");

/** How many Rune Levels the unit can hold. */
function runeCap(s: BattleState, u: Unit): number {
  return u.machine ? 0 : Math.max(heroRuneCap(s, u), ownRunes(s, u) ? 9 : 0);
}

/** The unit gains Rune Levels (up to what it can hold). */
/** Rune Levels (HotA, Yeti Runemasters' "ON_COMBAT_EVENT"): after attacking, being hit and defending. */
export function gainRunes(s: BattleState, u: Unit, n: number) {
  const cap = runeCap(s, u);
  if (cap && alive(u)) u.runes = Math.min(cap, (u.runes ?? 0) + n);
}

/** Attack, Defense and Speed from Rune Levels. */
export function runeBonus(s: BattleState, u: Unit): { attack: number; defense: number; speed: number } {
  const n = u.runes ?? 0;
  const of = (levels: number) => ({ attack: 2 * Math.ceil(levels / 3), defense: 2 * Math.ceil((levels - 1) / 3), speed: Math.floor(levels / 3) });
  const a = of(Math.min(n, heroRuneCap(s, u)));
  const b = ownRunes(s, u) ? of(Math.min(n, 9)) : { attack: 0, defense: 0, speed: 0 };
  return { attack: a.attack + b.attack, defense: Math.max(0, a.defense) + Math.max(0, b.defense), speed: a.speed + b.speed };
}

/** The terrain each town's creatures call home (HotA: Conflux on highlands); neutrals have none. */
export const NATIVE_TERRAIN: Record<string, string> = {
  castle: "grass", rampart: "grass", tower: "snow", inferno: "lava", necropolis: "dirt", dungeon: "subterra",
  stronghold: "rough", fortress: "swamp", conflux: "highlands", cove: "swamp", factory: "wasteland", bulwark: "snow",
};

/** On its native terrain a creature fights with +1 Attack, Defense and Speed. */
export const onNativeTerrain = (s: BattleState, u: Unit): boolean =>
  !u.machine && !cursedGround(s) && ((!!s.terrain && NATIVE_TERRAIN[stats(s, u).faction] === s.terrain) || (!!s.lodestar && stats(s, u).faction === "cove"));

export function speedOf(s: BattleState, u: Unit): number {
  let v = stats(s, u).speed + runeBonus(s, u).speed + (u.machine ? 0 : speedBonus(s.sides[u.side]?.hero, u.creature)) + (onNativeTerrain(s, u) ? 1 : 0);
  // Ring of the Wayfarer, Necklace of Swiftness, Cape of Velocity.
  if (!u.machine) v += heroBonus(s, u.side, "STACKS_SPEED");
  v += effectOf(u, SPELL.HASTE)?.value ?? 0;
  v += effectOf(u, SPELL.PRAYER)?.value ?? 0;
  const slow = effectOf(u, SPELL.SLOW);
  // HotA's SPTRAITS: speed x 0.75 (basic), speed x 0.5 + 1 (advanced, expert).
  if (slow) v = Math.floor((v * slow.value) / 100) + (slow.value <= 50 ? 1 : 0);
  v -= flierSlowdown(s, u);
  return Math.max(disabled(u) ? 0 : 1, v);
}

/**
 * HotA Jotunns slow the enemy's fliers (-1, Warlords -2) for the whole battle, even once they've fallen;
 * the strongest one counts, they don't add up.
 */
export function flierSlowdown(s: BattleState, u: Unit): number {
  // (Fliers only: not the Olgoi-Khorkhoi's burrowing, which the data files as teleporting.)
  if (u.machine || !stats(s, u).abilities.some((a) => a.type === "FLYING" && (!a.subtype || a.subtype === "movementFlying"))) return 0;
  let most = 0;
  for (const x of s.units) {
    if (x.side === u.side || x.summoned || x.clone) continue;
    const v = -(ability(stats(s, x), "STACKS_SPEED")?.val ?? 0);
    if (v > most) most = v;
  }
  return most;
}
export const alive = (u: Unit) => u.count > 0;

/** HotA: an attacking hero who cast a spell in the first round can't retreat or surrender in it (the mod's noSpellHitAndRunRounds). */
export const hitAndRun = (s: BattleState, side: number): boolean => side === 0 && s.round <= 1 && !!s.sides[1]?.hero && !!s.cast?.[0];
export const HIT_AND_RUN = "Having cast a spell this first round, the attacking hero can't leave the battle until the next.";

/** Total of an artifact bonus on a side's hero (subtype optional). */
export function heroBonus(s: BattleState, side: number, type: string, subtype?: string): number {
  return (s.sides[side]?.hero?.bonuses ?? []).filter((b) => b.type === type && (subtype === undefined || b.subtype === subtype)).reduce((a, b) => a + (b.val ?? 0), 0);
}

/** Artifact skill bonuses for some creatures only (the Vial of Dragon Blood: +5 / +5 to dragons). */
export function creaturesBonus(s: BattleState, u: Unit, skill: "attack" | "defence"): number {
  return (s.sides[u.side]?.hero?.bonuses ?? [])
    .filter((b) => b.creatures && b.type === "PRIMARY_SKILL" && b.subtype === skill && hasAbility(stats(s, u), b.creatures))
    .reduce((a, b) => a + (b.val ?? 0), 0);
}

/** Does the side's hero have this artifact bonus at all? */
export const hasHeroBonus = (s: BattleState, side: number, type: string, subtype?: string) =>
  (s.sides[side]?.hero?.bonuses ?? []).some((b) => b.type === type && (subtype === undefined || b.subtype === subtype));

/** Ring of Oblivion (HotA), on either hero: the dead are gone for good, on both sides. */
export const oblivion = (s: BattleState) => hasHeroBonus(s, 0, "DISINTEGRATE") || hasHeroBonus(s, 1, "DISINTEGRATE");

/** The side a stack fights for right now: Hypnotize turns it against its own. */
export const controlSide = (u: Unit): Side => (effectOf(u, SPELL.HYPNOTIZE) ? ((1 - u.side) as Side) : u.side);

export function canShoot(s: BattleState, u: Unit): boolean {
  const c = stats(s, u);
  // Steel Elves (HotA) shoot even with an enemy next to them.
  // Forgetfulness: at basic the shots only lose half their damage; advanced and expert stop them.
  if ((effectOf(u, SPELL.FORGETFULNESS)?.mastery ?? 0) >= 2) return false;
  // Ballistas and towers shoot whoever stands next to them; the catapult only throws at walls.
  if (u.machine) return (u.machine === "ballista" || u.machine === "cannon" || u.machine === "tower") && u.shots > 0;
  return hasAbility(c, "SHOOTER") && u.shots > 0 && (!blockedByNeighbours(s, u) || !enemyAdjacent(s, u));
}

/** Does an enemy standing beside this shooter stop its shots? (Not Steel Elves', nor anyone's with the Bow of the Sharpshooter.) */
export function blockedByNeighbours(s: BattleState, u: Unit): boolean {
  return !u.machine && !hasAbility(stats(s, u), "FREE_SHOOTING") && !hasHeroBonus(s, u.side, "FREE_SHOOTING");
}

/**
 * May `u` shoot at `target`? Steel Elves (HotA) shoot with enemies beside them, but those beside them they
 * must fight hand to hand; the Bow of the Sharpshooter lets anyone shoot even those (heroes.thelazy.net Steel Elf).
 */
export function canShootAt(s: BattleState, u: Unit, target: Unit): boolean {
  if (!canShoot(s, u)) return false;
  if (u.machine || hasHeroBonus(s, u.side, "FREE_SHOOTING") || !hasAbility(stats(s, u), "FREE_SHOOTING")) return true;
  return !areAdjacent(s, u, u.pos, target);
}

/**
 * Gold to surrender (heroes.thelazy.net, Combat#Surrender): half the gold price of the troops still
 * standing (not the war machines, summoned creatures or clones), less Diplomacy's 20 / 40 / 60% (5% more
 * per level for Melchior and Oidana) and the Statesman's Medal, Diplomat's Ring and Ambassador's Sash
 * (10% each, also as parts of the Diplomat's Cloak), never more than 90% off (HotA, the wiki's Melchior).
 */
export function surrenderCost(s: BattleState, side: Side): number {
  const hero = s.sides[side].hero;
  const value = s.units.filter((u) => u.side === side && alive(u) && !u.machine && !u.summoned && !u.clone).reduce((a, u) => a + u.count * (stats(s, u).cost?.[6] ?? 0), 0);
  const discount = Math.min(90, [0, 20, 40, 60][skillLevel(hero?.skills, "diplomacy")] * skillFactor(hero, "diplomacy") + (hero?.bonuses ?? []).filter((b) => b.type === "SURRENDER_DISCOUNT").reduce((a, b) => a + (b.val ?? 0), 0));
  return Math.max(0, Math.floor((value * (100 - discount)) / 200));
}

/** Why a side's hero can't retreat (or surrender) now. */
export type FleeBlock = "noHero" | "shackles" | "town" | "noEnemyHero" | "hitAndRun";

/** The reason a side's hero may not retreat (or surrender) now, or null when it may (heroes.thelazy.net, Combat#Retreat). */
export function fleeBlock(s: BattleState, side: Side, surrender: boolean): FleeBlock | null {
  const hero = s.sides[side].hero;
  const enemy = s.sides[1 - side].hero;
  if (!hero) return "noHero";
  // The Shackles of War on either hero; in HotA only between two heroes.
  if (enemy && (hasHeroBonus(s, 0, "BATTLE_NO_FLEEING") || hasHeroBonus(s, 1, "BATTLE_NO_FLEEING"))) return "shackles";
  // Defending a town (walled or not): the Escape Tunnel lets the hero retreat, the Diplomat's Cloak retreat or surrender.
  if (side === 1 && s.town && !hero.diplomat && (surrender || !s.town.escape)) return "town";
  // Surrender only to a hero, but with the Diplomat's Cloak.
  if (surrender && !enemy && !hero.diplomat) return "noEnemyHero";
  // HotA's Hit & Run ban: an attacker who cast a spell in the first round of a fight between heroes stays (the Cloak frees them).
  if (hitAndRun(s, side) && !hero.diplomat) return "hitAndRun";
  return null;
}

const FLEE_ERRORS: Record<FleeBlock, string> = {
  noHero: "only a hero can retreat",
  shackles: "The Shackles of War prevent anyone from fleeing.",
  town: "A hero defending a town can't flee.",
  noEnemyHero: "you can only surrender to a hero",
  hitAndRun: HIT_AND_RUN,
};

/** The side's hero retreats or surrenders (as fleeBlock allows): the battle is lost, the hero lives on. */
function flee(s: BattleState, side: Side, surrender: boolean, events: BattleEvent[]) {
  const why = fleeBlock(s, side, surrender);
  if (why) throw new Refusal(FLEE_ERRORS[why]);
  s.fled = surrender ? { side, surrender, cost: surrenderCost(s, side) } : { side, surrender };
  s.winner = (1 - side) as Side;
  s.active = null;
  s.tactics = undefined;
  s.log.push(surrender ? LOG.surrenders(s.sides[side].hero!.name) : LOG.flees(s.sides[side].hero!.name));
  events.push({ e: "end", winner: s.winner });
}

/** A side's losses by creature, as the results window lists them (a fallen arrow tower is the town's, not a creature lost). */
export function casualties(s: BattleState, side: Side): Map<number, number> {
  const lost = new Map<number, number>();
  for (const u of s.units) if (u.side === side && u.machine !== "tower" && u.initialCount > u.count) lost.set(u.creature, (lost.get(u.creature) ?? 0) + u.initialCount - u.count);
  return lost;
}

/**
 * Experience a side's hero earns (heroes.thelazy.net, Experience): the hit points of the enemy creatures
 * killed (war machines and clones not counted, creatures raised again counted once), and 500 for a
 * beaten hero or a captured town, not for a hero who fled or surrendered. A hero who fled earns nothing.
 */
export function battleExperience(s: BattleState, side: Side): number {
  if (s.fled?.side === side || s.winner === null) return 0;
  const kills = s.units.filter((u) => u.side !== side && !u.machine && !u.clone).reduce((a, u) => a + (u.xpBefore ?? 0) + Math.max(0, u.initialCount - u.count, u.mostLost ?? 0) * (s.creatures[u.creature]?.hp ?? 0), 0);
  const beaten = s.winner === side && !s.fled && (!!s.sides[1 - side].hero || (side === 0 && !!s.town));
  return kills + (beaten ? 500 : 0);
}

/** Cyclopes (CATAPULT ability) and HotA's Cannon may shoot at the walls instead, when attacking a town. */
export function canShootWalls(s: BattleState, u: Unit): boolean {
  // (Cyclopes only ever throw at walls; the cannon at any part still standing.)
  if (!s.siege || u.side !== 0 || !canShoot(s, u)) return false;
  if (u.machine === "cannon") return catapultTargets(s).length > 0;
  return !u.machine && !!ability(stats(s, u), "CATAPULT") && catapultTargets(s).some((p) => WALL_SEGMENTS.includes(p));
}

/** Head positions from which `u` can melee `target` this turn. */
export function attackPositions(s: BattleState, u: Unit, target: Unit): number[] {
  const reach = reachable(s, u);
  return [...reach.keys()].filter((h) => areAdjacent(s, u, h, target));
}

// ---- turn flow -----------------------------------------------------------

/** Towers shoot first in a round (keep, bottom, upper), then the catapult, then by speed. */
const firstRank = (u: Unit) => (u.machine === "tower" ? TOWER_RANK[u.pos] ?? 2 : u.machine === "catapult" ? 1 : 0);
/** The keep first, then the upper tower, then the lower one. */
const TOWER_RANK: Record<number, number> = { [TOWER_POS.keep]: 2.3, [TOWER_POS.upperTower]: 2.2, [TOWER_POS.bottomTower]: 2.1 };
const bySpeed = (s: BattleState) => (a: Unit, b: Unit) => firstRank(b) - firstRank(a) || speedOf(s, b) - speedOf(s, a) || a.side - b.side || a.id - b.id;

function turnOrder(s: BattleState): Unit[] {
  const speed = (u: Unit) => speedOf(s, u);
  const fresh = s.units.filter((u) => alive(u) && !u.acted && !u.waited).sort(bySpeed(s));
  const waiting = s.units
    .filter((u) => alive(u) && !u.acted && u.waited)
    .sort((a, b) => speed(a) - speed(b) || a.side - b.side || a.id - b.id);
  return [...fresh, ...waiting];
}

/** Upcoming units for the queue display: rest of this round, then next round. */
export function upcoming(s: BattleState, n = 12): { unit: number; nextRound: boolean }[] {
  // The stack whose turn it is leads, whatever a spell cast on its turn did to the speeds (Haste on another: the owner 2026-11-02T23-35).
  const order = turnOrder(s);
  const active = order.find((u) => u.id === s.active);
  const now = (active ? [active, ...order.filter((u) => u !== active)] : order).map((u) => ({ unit: u.id, nextRound: false }));
  const next = s.units
    .filter(alive)
    .sort(bySpeed(s))
    .map((u) => ({ unit: u.id, nextRound: true }));
  return [...now, ...next].slice(0, n);
}

export function checkEnd(s: BattleState, events: BattleEvent[]): boolean {
  raiseFangarms(s, events);
  // War machines alone don't keep a side in the battle.
  const a = s.units.some((u) => alive(u) && u.side === 0 && !u.machine);
  const d = s.units.some((u) => alive(u) && u.side === 1 && !u.machine);
  if (a && d) return false;
  s.winner = a ? 0 : d ? 1 : "draw";
  s.active = null;
  s.log.push(s.winner === "draw" ? LOG.ours("draw") : LOG.ours("wins", [s.sides[s.winner].name]));
  events.push({ e: "end", winner: s.winner });
  return true;
}

/**
 * The Horn of the Abyss (heroes.thelazy.net/index.php/Fangarm): after a stack of living creatures
 * is slain, on either side, Fangarms rise in its place for the hero who wears it, and stay with the
 * hero after the battle. Half the slain stack's total health (the stack as it came into the
 * battle) in Fangarms, at most half as many as were in it. Slain Fangarms raise nothing.
 */
function raiseFangarms(s: BattleState, events: BattleEvent[]) {
  const side = ([0, 1] as const).find((x) => s.sides[x].hero?.bonuses?.some((b) => b.type === "RAISE_FANGARMS"));
  const fangarm = s.creatures[FANGARM];
  if (side === undefined || !fangarm) return;
  for (const dead of [...s.units]) {
    if (dead.count > 0 || dead.hornDone || dead.diedWith === undefined) continue;
    dead.hornDone = true;
    const c = stats(s, dead);
    if (dead.machine || dead.summoned || dead.clone || dead.sacrificed || dead.creature === FANGARM || !isLiving(c) || hasAbility(c, "MECHANICAL")) continue;
    const count = Math.min(Math.floor((dead.initialCount * c.hp) / 2 / fangarm.hp), Math.floor(dead.initialCount / 2));
    if (count <= 0) continue;
    const u: Unit = {
      id: s.units.length, side, creature: FANGARM, count, firstHp: fangarm.hp, pos: 0, shots: fangarm.shots, retaliations: 0,
      acted: true, waited: false, defending: false, hadMorale: false, initialCount: count, raised: true,
    };
    const spot = freeHexNear(s, u, dead.pos);
    if (spot < 0) continue;
    u.pos = spot;
    s.units.push(u);
    s.log.push(LOG.ours("fangarms", [count, { cr: FANGARM, n: count }, { cr: dead.creature, n: 2 }]));
    events.push({ e: "rise", unit: u.id, from: dead.id });
  }
}

function advance(s: BattleState, events: BattleEvent[]) {
  if (checkEnd(s, events)) return;
  let order = turnOrder(s);
  if (!order.length) {
    s.round++;
    for (const u of s.units) {
      u.acted = false;
      u.waited = false;
      u.defending = false;
      u.retaliations = 0;
      u.hadMorale = false;
      // Spells wear off; Yetis shake off bad ones after a round (not lasting ones like Disrupting Ray).
      if (u.effects) {
        const yeti = stats(s, u).abilities.some((a) => a.type === "ENCHANTED" && a.subtype === "yetiCure");
        for (const e of u.effects) if (e.rounds < 999) e.rounds = yeti && !isPositive(e.spell) ? 0 : e.rounds - 1;
        if (alive(u)) for (const e of u.effects) if (e.rounds <= 0) s.log.push(LOG.wearsOff(e.spell, u.creature));
        u.effects = u.effects.filter((e) => e.rounds > 0);
      }
      // Regeneration: the top creature regains health each round (the Elixir of Life 50 points, the
      // HotA mod's text and its bonus's value).
      const hpBefore = u.firstHp;
      const elixir = (s.sides[u.side]?.hero?.bonuses ?? []).find((b) => b.type === "HP_REGENERATION");
      if (alive(u) && !u.machine && elixir && isLiving(stats(s, u))) u.firstHp = Math.min(hpOf(s, u), u.firstHp + (elixir.val ?? 50));
      const regen = ability(stats(s, u), "HP_REGENERATION");
      if (regen && alive(u)) u.firstHp = Math.min(hpOf(s, u), u.firstHp + (regen.val ?? 50));
      if (alive(u) && u.firstHp > hpBefore) {
        events.push({ e: "trigger", unit: u.id, what: "regen", amount: u.firstHp - hpBefore });
        s.log.push(LOG.ours("regen", [{ cr: u.creature, n: 2 }, u.firstHp - hpBefore]));
      }
      // Poison eats a further tenth of their health each round, up to half.
      const poison = effectOf(u, SPELL.POISON);
      if (poison && poison.mastery > 0 && alive(u)) {
        poison.mastery--;
        const was = hpOf(s, u);
        poison.value = Math.min(50, poison.value + 10);
        if (hpOf(s, u) < was) {
          events.push({ e: "trigger", unit: u.id, what: "poison" });
          s.log.push(LOG.ours("poisonBites", [{ cr: u.creature, n: 2 }]));
        }
        shrink(s, u, was);
      }
    }
    // Clones whose time is up (or whose spell was dispelled) are gone (VCMI's afterNewRound).
    for (const u of s.units) if (u.clone && alive(u) && !effectOf(u, SPELL.CLONE)) vanish(s, u, events);
    s.cast = [false, false];
    // Force Fields and Fire Walls die down after two rounds.
    if (s.hazards) s.hazards = s.hazards.filter((z) => z.rounds < 0 || --z.rounds > 0);
    s.log.push(LOG.nextRound());
    events.push({ e: "round", round: s.round });
    order = turnOrder(s);
  }
  const u = order[0];
  // Meditation lasts until the stack's first turn in a later round.
  if (u.meditating !== undefined && u.meditating < s.round) delete u.meditating;
  // Frenzy lasts through the stack's closest turn and until the next one begins (SPTRAITS; heroes.thelazy.net
  // Frenzy: "until target troop's action turn in the next round"). A turn resumed after waiting is the same turn.
  if (!u.waited && u.effects?.some((e) => e.turns !== undefined)) {
    for (const e of u.effects) if (e.turns !== undefined) e.turns--;
    u.effects = u.effects.filter((e) => e.turns === undefined || e.turns > 0);
  }
  // The Lightning Rod (Factory Grail) strikes as its owner's side first gets to act, not as the
  // battle opens (heroes.thelazy.net/index.php/Grail): faster enemies can shield their troops first.
  const rod = s.sides[u.side];
  if (s.round === 1 && rod.lightningRod && !rod.rodStruck) {
    rod.rodStruck = true;
    lightningRod(s, u.side, rod.lightningRod, events);
    if (checkEnd(s, events)) return;
  }
  // War machines: the cart stands by, the tent heals by itself (a player with First Aid aims it),
  // the catapult rests once the walls are down.
  const aimedTent = u.machine === "tent" && s.sides[u.side].controller === "human" && skillLevel(s.sides[u.side].hero?.skills, "firstAid") > 0 && healTargets(s, u).length > 0;
  if (u.machine === "cart" || (u.machine === "tent" && !aimedTent) || (u.machine === "catapult" && !catapultTargets(s).length)) {
    u.acted = true;
    if (u.machine === "tent") firstAid(s, u, events);
    advance(s, events);
    return;
  }
  // Blinded, petrified or paralysed: the stack stands there.
  if (disabled(u)) {
    u.acted = true;
    s.log.push(LOG.ours("cantAct", [{ cr: u.creature, n: 2 }]));
    advance(s, events);
    return;
  }
  // Azure Dragons: a tenth of the time, enemies (with minds) freeze in fear.
  const fearful = s.units.some((x) => alive(x) && x.side !== u.side && hasAbility(stats(s, x), "FEARFUL"));
  if (fearful && !fearless(stats(s, u), u) && random(s) < 0.1) {
    u.acted = true;
    s.log.push(LOG.fear(u.creature, u.count));
    events.push({ e: "trigger", unit: u.id, what: "fear" });
    advance(s, events);
    return;
  }
  // Wraiths drain the enemy hero's spell points as they go.
  const drain = ability(stats(s, u), "MANA_DRAIN");
  const foe = s.sides[1 - u.side].hero;
  if (drain && foe?.mana && u.drained !== s.round) {
    // (Once a round per stack: not again after waiting or on a morale turn.)
    u.drained = s.round;
    const amount = Math.min(foe.mana, drain.val ?? 2);
    foe.mana -= amount;
    events.push({ e: "trigger", unit: u.id, what: "manaDrain", amount });
    s.log.push(LOG.manaDrain(u.creature, u.count, foe.name));
  }
  // Bad morale: the stack freezes in panic and loses its turn (machines have no morale). Checked as the
  // turn begins, not again when a stack that waited comes back (VCMI's tryActivateMoralePenalty).
  if (!u.machine && !u.waited && panics(s, u)) {
    u.acted = true;
    s.log.push(LOG.lowMorale(u.creature, u.count));
    events.push({ e: "morale", unit: u.id, good: false });
    advance(s, events);
    return;
  }
  // Standing in fire hurts at the start of the turn.
  for (const z of unitHexes(s, u).flatMap((h) => hazardsAt(s, h)).filter((z) => z.kind === "fireWall")) burn(s, u, z, events);
  if (!alive(u)) {
    if (!checkEnd(s, events)) advance(s, events);
    return;
  }
  // Enchanters cast on their own as their turn comes up.
  enchant(s, u, events);
  s.active = u.id;
  events.push({ e: "turn", unit: s.active });
}

/**
 * Whether `side` sees this quicksand or mine: its own, one stepped on, and under the Lodestar (Cove
 * Grail) every one while the side has Cove creatures (heroes.thelazy.net Grail: "can see and ignore
 * land mines and see quicksand").
 */
export function seesHazard(s: BattleState, side: number | undefined, z: NonNullable<BattleState["hazards"]>[number]): boolean {
  if ((z.kind !== "quicksand" && z.kind !== "mine") || z.revealed || side === undefined) return true;
  if (!z.neutral && z.side === side) return true;
  // A stack of the side fighting on its native terrain sees them too (SPTRAITS: "visible to the caster
  // and creatures native to the terrain"; VCMI's battleIsObstacleVisibleForSide). (Not the Dunes' own.)
  if (!z.neutral && nativeSees(s, side)) return true;
  return !!s.lodestar && s.units.some((u) => u.side === side && alive(u) && stats(s, u).faction === "cove");
}

/** A side with a stack on its native ground sees the enemy's mines and walks over them unhurt (VCMI's
 *  battleHasNativeStack; heroes.thelazy.net Land Mine: "can see the mines and can cross them safely"). */
const nativeSees = (s: BattleState, side: number) => s.units.some((x) => x.side === side && alive(x) && onNativeTerrain(s, x));

/** Mines blow up under the enemy and fire burns whoever walks through; quicksand shows itself. */
function tread(s: BattleState, u: Unit, hexes: number[], events: BattleEvent[]) {
  for (const h of hexes) {
    for (const z of hazardsAt(s, h)) {
      if (!alive(u)) return;
      if (z.kind === "quicksand" && (z.neutral || z.side !== u.side)) z.revealed = true;
      // Under the Lodestar, Cove creatures see the enemy's mines and walk over them.
      const spared = z.kind === "mine" && ((!!s.lodestar && stats(s, u).faction === "cove") || nativeSees(s, u.side));
      if ((z.kind === "mine" && z.side !== u.side && !spared) || z.kind === "fireWall") burn(s, u, z, events);
    }
  }
}

/** A mine or fire wall hurts the stack (mines are gone afterwards). */
function burn(s: BattleState, u: Unit, z: NonNullable<BattleState["hazards"]>[number], events: BattleEvent[]) {
  const spell = z.kind === "mine" ? SPELL.LAND_MINE : SPELL.FIRE_WALL;
  const c = stats(s, u);
  // What the victim makes of it: Water and Ice Elementals burn twice as hard in a fire wall; a Land Mine specialist's mines hurt more.
  const more = c.abilities.find((a) => a.type === "MORE_DAMAGE_FROM_SPELL" && a.subtype === (z.kind === "mine" ? "landMineTrigger" : "fireWallTrigger"))?.val ?? 0;
  // As the spell itself: a stack it can't affect (fire immunity, Efreet, Anti-Magic...) walks through unhurt, mines
  // go off all the same; Golems' reduction and Protection from Fire cut the damage.
  const info = s.spells?.[spell];
  if (info && !affects(s, info, u)) {
    s.log.push(LOG.ours(z.kind === "mine" ? "mineNone" : "fireWallNone"));
    if (z.kind === "mine") s.hazards = (s.hazards ?? []).filter((x) => x !== z);
    return;
  }
  let raw = (z.damage ?? 0) * (1 + more / 100) * (1 + spellSpecialtyPercent(s.sides[z.side].hero, spell, c.level) / 100);
  if (info) raw = spellDamageTaken(s, info, u, raw);
  const dmg = Math.floor(raw);
  const killed = takeDamage(s, u, dmg);
  s.log.push(LOG.spellDamage(spell, dmg, killed, u.creature));
  events.push({ e: "spell", side: z.side, spell, hex: u.pos, units: [u.id], damage: [{ unit: u.id, damage: dmg, killed }], resisted: [], ability: true });
  if (z.kind === "mine") s.hazards = (s.hazards ?? []).filter((x) => x !== z);
  if (!alive(u)) onDeath(s, u, events);
}

/**
 * A stack walking into the moat takes the moat's damage, and again for each turn it ends there;
 * attackers and defenders alike (heroes.thelazy.net Moat). Not a turn ended by casting a spell, a
 * turn missed (bad morale, blinded, paralysed...), nor a stack teleported in.
 */
function moat(s: BattleState, u: Unit, events: BattleEvent[]) {
  // (Fliers too, landing in it: only a Teleport spell's stack is spared, heroes.thelazy.net Moat; The owner 2026-11-03T00-10.)
  if (!s.siege?.moat || u.machine || !moatHolds(s, u) || !unitHexes(s, u).some((h) => inMoat(s, h))) return;
  const before = u.count;
  takeDamage(s, u, s.siege.moat.damage);
  const killed = before - u.count;
  s.log.push(killed ? LOG.ours("moatKills", [{ cr: u.creature, n: 2 }, s.siege.moat.damage, killed]) : LOG.ours("moat", [{ cr: u.creature, n: 2 }, s.siege.moat.damage]));
  events.push({ e: "moat", unit: u.id, damage: s.siege.moat.damage, killed });
  if (!alive(u)) onDeath(s, u, events);
}

/** The catapult's stones for this turn: more and better aimed with Ballistics; misses hit nothing. */
function throwStones(s: BattleState, u: Unit, aimed: WallPart, events: BattleEvent[]) {
  const siege = s.siege;
  if (!siege) throw new Refusal("no walls here");
  // A Cyclops throws like a basic catapult; the King twice (VCMI's cyclopsShot).
  // The Cannon: one ball, aimed like the catapult without / with basic / with expert Ballistics as
  // Artillery grows (the HotA mod's cannonSiegeShot: Advanced aims like Basic, Expert never misses).
  const artillery = skillLevel(s.sides[u.side].hero?.skills, "artillery");
  const t =
    u.machine === "cannon"
      ? { ...catapultTable(artillery >= 3 ? 3 : Math.min(artillery, 1)), shots: 1 }
      : u.machine
        ? catapultTable(skillLevel(s.sides[u.side].hero?.skills, "ballistics"))
        : { ...CYCLOPS_SHOT, shots: 1 + (ability(stats(s, u), "CATAPULT_EXTRA_SHOTS")?.val ?? 0) };
  if (u.machine === "cannon") u.shots--;
  const who = u.machine === "cannon" ? LOG.ours("cannon") : u.machine ? LOG.ours("catapult") : LOG.ours("theStack", [{ cr: u.creature, n: 2 }]);
  const pick = (n: number) => randInt(s, 0, n - 1);
  let target: WallPart | null = aimed;
  for (let i = 0; i < t.shots; i++) {
    if (!catapultTargets(s).length) break;
    // Both stones go at the aimed part; once it has fallen, at the nearest one still standing.
    // (A Cyclops King's second stone: the weakest wall left, as Cyclopes only ever throw at walls.)
    if (!target || !(siege.walls[target] ?? 0)) target = u.machine ? target && nextStoneTarget(s, target, pick) : autoCatapultTarget(s, 0, true, pick);
    if (!target) break;
    // A miss isn't wasted: the stone lands on the nearest standing wall segment instead
    // (heroes.thelazy.net Fortifications, Targeting); every stone then rolls its damage.
    const part = randInt(s, 1, 100) <= chanceToHit(target, t) ? target : missedShotLands(s, target, pick);
    const r = randInt(s, 1, 100);
    const damage = r <= t.one ? 1 : r <= t.one + t.two ? 2 : 0;
    const { fallen: destroyed, tower } = damageWall(s, part, damage);
    if (tower) events.push({ e: "death", unit: tower.id });
    s.log.push(LOG.ours(`${damage ? (destroyed ? "destroys" : "damages") : "miss"}${u.machine ? "One" : "Many"}` as const, [who, LOG.ours(part)]));
    events.push({ e: "catapult", unit: u.id, part, damage, destroyed });
  }
}

/** Friendly living stacks the First Aid Tent could heal. */
export function healTargets(s: BattleState, tent: Unit): Unit[] {
  return s.units.filter((x) => alive(x) && x.side === tent.side && !x.machine && x.firstHp < hpOf(s, x) && isLiving(stats(s, x)));
}

/** First Aid Tent: heals the top creature of `target` (or the most hurt stack); more with First Aid. */
function firstAid(s: BattleState, tent: Unit, events: BattleEvent[], target?: Unit) {
  const level = skillLevel(s.sides[tent.side].hero?.skills, "firstAid");
  const k = skillFactor(s.sides[tent.side].hero, "firstAid");
  // HotA: 20-25 without the skill (heroes.thelazy.net War Machine), 40-50 / 60-75 / 80-100 with it (First Aid).
  const [lo, hi] = [[20, 25], [40, 50], [60, 75], [80, 100]][level].map((v) => Math.floor(v * k));
  // A computer hero with First Aid aims it as a player would: where the most is mended, by the creatures' worth.
  const mended = (x: Unit) => (Math.min(hpOf(s, x) - x.firstHp, (lo + hi) / 2) / hpOf(s, x)) * stats(s, x).aiValue;
  const aimed = !target && level > 0 && s.sides[tent.side].controller === "ai" ? healTargets(s, tent).sort((a, b) => mended(a) - mended(b)).pop() : undefined;
  const hurt = target ?? aimed ?? healTargets(s, tent).sort((a, b) => b.firstHp / hpOf(s, b) - a.firstHp / hpOf(s, a)).pop();
  if (!hurt) return;
  const amount = Math.min(randInt(s, lo, hi), hpOf(s, hurt) - hurt.firstHp);
  hurt.firstHp += amount;
  s.log.push(LOG.heals(tent.creature, hurt.creature, hurt.count, amount));
  events.push({ e: "drain", unit: hurt.id, amount, revived: 0, tent: true });
}

/** Good morale: after a real action (not wait/defend), once per round, act again. */
function rollGoodMorale(s: BattleState, u: Unit, events: BattleEvent[]): boolean {
  // (HotA: nor a stack blinded, petrified or paralysed by the retaliation it met.)
  if (!alive(u) || u.machine || u.waited || u.hadMorale || s.winner !== null || disabled(u)) return false;
  if (!cheers(s, u)) return false;
  u.hadMorale = true;
  s.log.push(LOG.highMorale(u.creature, u.count));
  events.push({ e: "morale", unit: u.id, good: true });
  events.push({ e: "turn", unit: u.id });
  return true;
}

/** Sets the first active unit. Call once after createBattle. */
export function startBattle(s: BattleState): BattleEvent[] {
  const events: BattleEvent[] = [];
  // Every stack starts at full health, health bonuses (rings, First Aid) included.
  for (const u of s.units) if (alive(u)) u.firstHp = hpOf(s, u);
  openingSpells(s);
  // Tactics: the hero with the better skill may rearrange first (3 / 5 / 7 columns; equal skill cancels out). In a siege
  // too (VCMI: no tactics only in creature banks; The owner 2026-11-01: "I got no tactics in siege").
  const t = [0, 1].map((side) => skillLevel(s.sides[side].hero?.skills, "tactics"));
  const side: Side | null = t[0] > t[1] ? 0 : t[1] > t[0] ? 1 : null;
  if (side !== null && s.sides[side].controller === "human") {
    // The enemy's Tactics cancels as many levels (HotA): 3 / 5 / 7 columns for what is left.
    s.tactics = { side, cols: 1 + 2 * (t[side] - t[1 - side]) };
    s.active = null;
    s.log.push(LOG.ours("tactics", [s.sides[side].hero?.name ?? LOG.ours("theHero")]));
    return events;
  }
  // The computer's hero arranges its troops too, at once: before the battle is seen, so no moves to watch (the owner's note
  // 2026-11-02 11:26: "you see him moving troops quickly at the battle start"; in the original they stand there already).
  if (side !== null && s.sides[side].controller === "ai") arrangeByComputer(s, side, 1 + 2 * (t[side] - t[1 - side]));
  s.log.push(LOG.ours("begins"));
  advance(s, events);
  return events;
}

/** Artifacts that cast as the battle opens: expert spells for the whole battle on friends or foes. */
function openingSpells(s: BattleState) {
  for (const side of [0, 1] as Side[]) {
    for (const b of s.sides[side].hero?.bonuses ?? []) {
      if (b.type !== "OPENING_BATTLE_SPELL") continue;
      const sp = Object.values(s.spells ?? {}).find((x) => x.key === b.subtype);
      const def = sp && COMBAT_SPELLS[sp.id];
      if (!sp || !def) continue;
      const targetSide = def.who === "enemy" ? 1 - side : side;
      for (const u of s.units) {
        if (!alive(u) || u.side !== targetSide || u.machine) continue;
        u.effects = (u.effects ?? []).filter((e) => e.spell !== sp.id);
        u.effects.push({ spell: sp.id, rounds: 50, mastery: 3, value: sp.effect[3] });
      }
      s.log.push(LOG.ours("artifactsCast", [s.sides[side].hero!.name, { sp: sp.id }]));
    }
  }
}

/**
 * The computer's Tactics: its foot soldiers stepped as far forward as the columns allow, so they
 * reach the enemy a turn sooner (the shooters stay back, the fliers need no help); each in its own
 * row or the nearest free one, the front-most first.
 */
function arrangeByComputer(s: BattleState, side: Side, cols: number) {
  s.tactics = { side, cols };
  const front = (h: number) => (side === 0 ? hexCol(h) : 16 - hexCol(h));
  const walkers = s.units.filter((u) => u.side === side && alive(u) && !u.machine && !canShoot(s, u) && !hasAbility(stats(s, u), "FLYING"));
  for (const u of walkers.sort((a, b) => front(b.pos) - front(a.pos))) {
    let best = u.pos;
    // (Not into the reach of their foot soldiers' first move: whoever steps in first is struck first.)
    const struck = (h: number) => s.units.some((e) => e.side !== side && alive(e) && !e.machine && !canShoot(s, e) && unitHexes(s, e).some((x) => unitHexes(s, u, h).some((m) => hexDistance(x, m) <= speedOf(s, e) + 1)));
    for (let h = 0; h < HEX_COUNT; h++) {
      if (!tacticsSpot(s, u, h) || struck(h)) continue;
      const better = front(h) > front(best) || (front(h) === front(best) && Math.abs(hexRow(h) - hexRow(u.pos)) < Math.abs(hexRow(best) - hexRow(u.pos)));
      if (better && Math.abs(hexRow(h) - hexRow(u.pos)) <= 2) best = h;
    }
    u.pos = best;
  }
  s.tactics = undefined;
  s.log.push(LOG.ours("tactics", [s.sides[side].hero?.name ?? LOG.ours("theHero")]));
}

/** May this unit be put on this hex during the tactics phase? */
export function tacticsSpot(s: BattleState, u: Unit, head: number): boolean {
  const t = s.tactics;
  if (!t || u.side !== t.side || u.machine || !alive(u)) return false;
  return unitHexes(s, u, head).every((h) => inTacticsZone(s, h)) && canStand(s, u, head);
}

/** Whether a hex lies in the columns the Tactics side may place its troops in. */
export function inTacticsZone(s: BattleState, h: number): boolean {
  const t = s.tactics;
  if (!t) return false;
  return t.side === 0 ? hexCol(h) >= 1 && hexCol(h) <= t.cols : hexCol(h) <= 15 && hexCol(h) >= 16 - t.cols;
}


/** Heals a stack, raising dead members up to its starting size. Returns creatures revived. */
export function heal(s: BattleState, u: Unit, amount: number): number {
  const hp = hpOf(s, u);
  const before = u.count;
  // The dead counted for experience once, whoever brings them back (heroes.thelazy.net, Experience).
  if (u.initialCount > u.count) u.mostLost = Math.max(u.mostLost ?? 0, u.initialCount - u.count);
  // Under the Ring of Oblivion only the wounded heal: nobody comes back.
  const total = Math.min(totalHp(s, u) + amount, (oblivion(s) ? u.count : u.initialCount) * hp);
  u.count = Math.ceil(total / hp);
  u.firstHp = total - (u.count - 1) * hp;
  return u.count - before;
}

export function onDeath(s: BattleState, u: Unit, events: BattleEvent[]) {
  events.push({ e: "death", unit: u.id });
  const c = stats(s, u);
  // Its clone goes with it (heroes.thelazy.net Clone; VCMI's makeGhost).
  for (const x of s.units) if (x.clone && x.cloneOf === u.id && alive(x)) vanish(s, x, events);
  // Detonation (HotA Automatons, once ignited): 90 + 5 per Automaton in the stack as it fell, to every stack beside it; no corpse.
  if (u.ignited) {
    const dmg = 90 + 5 * (u.diedWith ?? u.initialCount);
    const hit: { unit: number; damage: number; killed: number }[] = [];
    for (const x of s.units) {
      if (x === u || !alive(x) || x.machine === "tower" || !areAdjacent(s, x, x.pos, u)) continue;
      const killed = takeDamage(s, x, dmg);
      hit.push({ unit: x.id, damage: dmg, killed });
      if (!alive(x)) onDeath(s, x, events);
    }
    u.sacrificed = true;
    s.log.push(LOG.ours("detonate", [{ cr: u.creature, n: 2 }, dmg]));
    // (The blast looks and sounds as Inferno's: the mod's "detonation" has C04SPF0 and FIREBLST.)
    events.push({ e: "spell", side: u.side, spell: SPELL.INFERNO, hex: u.pos, units: hit.map((h) => h.unit), damage: hit, resisted: [], ability: true, by: u.id, note: s.log[s.log.length - 1], look: "detonate" });
  }
  // Rebirth (Phoenix): a fifth of the original stack, plus 20% per leftover creature, once per battle.
  if (hasAbility(c, "REBIRTH") && !u.reborn) {
    u.reborn = true;
    u.rebornRound = s.round;
    const n = Math.floor(u.initialCount / 5) + binomial(s, u.initialCount % 5, 0.2);
    if (n > 0) {
      u.count = n;
      u.firstHp = c.hp;
      s.log.push(LOG.ours("ashes", [n, { cr: u.creature, n }]));
      events.push({ e: "rebirth", unit: u.id, count: n });
    }
  }
}

/** A clone fades away: no corpse, nothing to raise. */
function vanish(s: BattleState, u: Unit, events: BattleEvent[]) {
  s.log.push(LOG.ours("vanishes", [{ cr: u.creature, n: 2 }]));
  u.count = 0;
  u.firstHp = 0;
  releaseBound(s, u);
  u.sacrificed = true;
  events.push({ e: "death", unit: u.id });
}

/** Stacks a melee blow has just woken from Blind, with the spell's mastery, until that attack is over. */
const woken = new WeakMap<Unit, number>();

export function strike(
  s: BattleState,
  a: Unit,
  d: Unit,
  ranged: boolean,
  retaliation: boolean,
  moved: number,
  events: BattleEvent[],
  splash = false,
) {
  const ac = stats(s, a);
  const dc = stats(s, d);
  const blow = ability(ac, "DOUBLE_DAMAGE_CHANCE");
  const deathBlow = !!blow && random(s) < (blow.val ?? 0) / 100;
  const hpBefore = totalHp(s, d);
  // A Cerberus' side heads strike without luck: a lucky or unlucky bite is the main target's only (heroes.thelazy.net Cerberus).
  const luck = splash && hasAbility(ac, "THREE_HEADED_ATTACK") ? undefined : rollLuck(s, a);
  const raw = { before: 0 };
  let base = rollDamage(s, a, d, ranged, moved, deathBlow, raw);
  // A stack woken from Blind strikes back at half (basic), a quarter (advanced) of its damage (heroes.thelazy.net Blind).
  const woke = retaliation ? woken.get(a) : undefined;
  if (woke !== undefined) base = Math.max(1, Math.floor(base * (woke >= 2 ? 0.25 : 0.5)));
  const dmg = luck === "good" ? base * 2 : luck === "bad" ? Math.max(1, Math.floor(base / 2)) : base;
  // (HotA's luck doubles or halves the whole blow, so the blow before defenses too.)
  const before = luck === "good" ? raw.before * 2 : luck === "bad" ? Math.floor(raw.before / 2) : raw.before;
  const killed = takeDamage(s, d, dmg);
  const blind = !retaliation && !ranged && effectOf(d, SPELL.BLIND);
  if (blind) woken.set(d, blind.mastery);
  // Blinded, petrified and paralysed creatures snap out of it when hit; clones vanish when hit at all.
  // (A paralysed stack answers that attack at a quarter of its strength, heroes.thelazy.net Scorpicore.)
  if (!retaliation && effectOf(d, SPELL.PARALYZE)) d.numbed = true;
  if (d.effects?.length) {
    const broken = (e: { spell: number }) => e.spell === SPELL.BLIND || e.spell === SPELL.STONE_GAZE || e.spell === SPELL.PARALYZE;
    if (alive(d)) for (const e of d.effects.filter(broken)) s.log.push(LOG.wearsOff(e.spell, d.creature));
    d.effects = d.effects.filter((e) => !broken(e));
  }
  if (d.clone && alive(d)) {
    d.count = 0;
    d.firstHp = 0;
    releaseBound(s, d);
  }
  if (luck) s.log.push(luck === "good" ? LOG.goodLuck(a.creature, a.count) : LOG.badLuck(a.creature, a.count));
  if (deathBlow) s.log.push(LOG.doubleDamage(a.creature, a.count));
  s.log.push(LOG.damage(a.creature, a.count, dmg, killed, d.creature));
  events.push({ e: "attack", unit: a.id, target: d.id, ranged, retaliation, damage: dmg, killed, splash, deathBlow, luck });
  if (!alive(d)) onDeath(s, d, events);

  // Life Drain: heal by the damage actually dealt, only from living targets.
  // (The Ring of Oblivion: nothing drained either; war machines have no life to drain, heroes.thelazy.net War Machine.)
  const drain = ability(ac, "LIFE_DRAIN");
  // (HotA: nor from clones.)
  if (drain && isLiving(dc) && !d.clone && !d.machine && !oblivion(s)) {
    const amount = Math.floor((Math.min(dmg, hpBefore) * (drain.val ?? 100)) / 100);
    const had = totalHp(s, a);
    const revived = heal(s, a, amount);
    // (Unhurt, none lost: nothing to drain into, so no drain to show.)
    const healed = totalHp(s, a) - had;
    if (healed > 0) {
      events.push({ e: "drain", unit: a.id, amount: healed, revived });
      s.log.push(revived ? LOG.ours("drainRise", [{ cr: a.creature, n: 2 }, healed, revived]) : LOG.ours("drain", [{ cr: a.creature, n: 2 }, healed]));
    }
  }

  // Death Stare: each Gorgon has a 10% chance; at most a tenth of the stack (rounded up) dies.
  // Sea Dogs' Accurate Shot (HotA): shots only, 3% each (2% at a range penalty), not over walls
  // or at war machines, at most that share of the stack (rounded up).
  const accurate = (sub: string) => ac.abilities.find((b) => b.type === "DEATH_STARE" && b.subtype === sub);
  const penalised = ranged && rangePenalty(s, a, d);
  const sharp = accurate("deathStareNoRangePenalty");
  const stare = sharp
    ? ranged && !d.machine && !wallPenalty(s, a, d) ? (penalised ? (accurate("deathStareRangePenalty") ?? sharp) : sharp) : undefined
    : ability(ac, "DEATH_STARE");
  if (stare && alive(d) && !d.machine && (sharp || isLiving(dc))) {
    const p = (stare.val ?? 10) / 100;
    const n = Math.min(binomial(s, a.count, p), Math.ceil(sharp ? a.count * p : a.count / 10), d.count);
    if (n > 0) {
      d.count -= n;
      if (d.count > 0) d.firstHp = hpOf(s, d);
      else d.firstHp = 0;
      s.log.push(LOG.stare(n, d.creature, a.creature));
      events.push({ e: "stare", unit: a.id, target: d.id, killed: n });
      if (!alive(d)) onDeath(s, d, events);
    }
  }

  // (Spells after the blow go to the stack struck, not to those a breath or a blast catches besides.)
  if (alive(d) && !splash) afterAttack(s, a, d, events, ranged);

  // Acid Breath (Rust Dragons): one time in five, 25 acid damage per dragon on top of the blow, which no defense
  // softens (heroes.thelazy.net Rust Dragon; VCMI's acidBreathDamage, 20%).
  const acid = ability(ac, "ACID_BREATH")?.val ?? 0;
  if (acid && !ranged && !retaliation && !splash && alive(d) && random(s) < 0.2) {
    const extra = acid * a.count;
    const k = takeDamage(s, d, extra);
    s.log.push(LOG.ours("acid", [{ cr: d.creature, n: 2 }, extra], k, d.creature));
    events.push({ e: "attack", unit: a.id, target: d.id, ranged: false, retaliation: false, damage: extra, killed: k, splash: true, acid: true });
    if (!alive(d)) onDeath(s, d, events);
  }

  // Fire Shield: melee attackers take a share of the damage they dealt (heroes.thelazy.net Efreet):
  // the better of an Efreet Sultan's own (not a clone's) and the spell's, half as much again with the
  // Orb of Tempestuous Fire; the fire-immune don't burn, Protection from Fire cuts it, and a breath
  // reaching a stack it never closed with isn't burned back (VCMI's fireShield.lua).
  const natural = d.clone ? 0 : (ability(dc, "FIRE_SHIELD")?.val ?? 0);
  // (Sorcery, the Orb and Adrienne strengthen every friendly Fire Shield, heroes.thelazy.net Fire Shield.)
  const shieldPct = Math.max(natural, effectOf(d, SPELL.FIRE_SHIELD)?.value ?? 0) * sorcery(s, d.side) * schoolBoost(s, d.side, ["fire"]);
  const fireproof = ac.abilities.some((x) => (x.type === "SPELL_SCHOOL_IMMUNITY" && x.subtype === "fire") || (x.type === "SPELL_IMMUNITY" && x.subtype === "fireShield"));
  if (shieldPct && !ranged && alive(a) && !fireproof && !d.clone && (!splash || areAdjacent(s, a, a.pos, d))) {
    // (Water and Ice Elementals burn twice as hard on it.)
    const more = ac.abilities.find((x) => x.type === "MORE_DAMAGE_FROM_SPELL" && x.subtype === "fireShield")?.val ?? 0;
    // Its base is the blow without the shielded stack's defenses (Defense, Armorer, Shield), at most the health it had:
    // 14 Archangels deal 630 to Efreet Sultans with 20 more Defense, the shield's base is 700 (heroes.thelazy.net Fire Shield).
    const reflected = (Math.min(before, hpBefore) * shieldPct * (1 + more / 100)) / 100;
    const back = Math.floor(spellDamageTaken(s, s.spells?.[SPELL.FIRE_SHIELD] ?? ({ schools: ["fire"] } as unknown as SpellInfo), a, reflected));
    if (back > 0) {
      const k = takeDamage(s, a, back);
      s.log.push(LOG.ours("fireShield", [back], k, a.creature));
      events.push({ e: "attack", unit: d.id, target: a.id, ranged: false, retaliation: true, damage: back, killed: k, splash: true, fireShield: true });
      if (!alive(a)) onDeath(s, a, events);
    }
  }
}

function applyTactics(s: BattleState, action: BattleAction): BattleEvent[] {
  const events: BattleEvent[] = [];
  // The arranging hero may still retreat or surrender (heroes.thelazy.net, Combat#Tactics Phase).
  if (action.type === "retreat") {
    const u = s.units[action.unit];
    if (!u || u.side !== s.tactics!.side) throw new Refusal("not this side's tactics phase");
    flee(s, u.side, action.surrender, events);
    return events;
  }
  if (action.type === "tacticsDone") {
    s.tactics = undefined;
    s.log.push(LOG.ours("begins"));
    advance(s, events);
    return events;
  }
  if (action.type !== "tacticMove") throw new Refusal("arrange your troops first");
  const u = s.units[action.unit];
  if (!u || !tacticsSpot(s, u, action.to)) throw new Refusal("can't place it there");
  // A walker walks there round the obstacles and the other stacks (2026-10-30: they flew straight over
  // them), out of the tactics zone on the way if it must; a flyer flies, and so does a walker with no way there.
  const way = canFly(s, u) ? null : reachable(s, u, HEX_COUNT);
  const path = way?.has(action.to) ? pathTo(way, action.to) : null;
  events.push(path && path.length > 1 ? { e: "move", unit: u.id, path, fly: false } : { e: "move", unit: u.id, path: [u.pos, action.to], fly: true });
  u.pos = action.to;
  return events;
}

/** Dendroids that move let go of whoever they bound (heroes.thelazy.net Dendroid Guard: "until the dendroids move"). */
const letGo = releaseBound;

/** Held by Dendroids: can't move while the one that bound it lives and stays next to it. */
export function bound(s: BattleState, u: Unit): boolean {
  const e = effectOf(u, SPELL.BIND);
  const by = e && s.units[e.value];
  return !!by && alive(by) && areAdjacent(s, u, u.pos, by);
}

/** Spells some creatures cast with their blows (chance in %; most last three rounds). */
/** (Most work only in melee; a Great Shaman's freezing shot only at range.) */
function afterAttack(s: BattleState, a: Unit, d: Unit, events: BattleEvent[], ranged = false) {
  const ac = stats(s, a);
  const dc = stats(s, d);
  if (d.machine) return;
  const living = isLiving(dc);
  const mindless = hasAbility(dc, "MIND_IMMUNITY") || !living;
  const put = (spell: number, value: number, rounds = 3, mastery = 1) => {
    d.effects = (d.effects ?? []).filter((e) => e.spell !== spell);
    d.effects.push({ spell, rounds, mastery, value });
  };
  // A creature spell's strength: the hero's spell at that level (SPTRAITS), else `fallback`.
  const level = (spell: number, m: number, fallback: number) => s.spells?.[spell]?.effect[m] ?? fallback;
  const after = (sub: string) => ac.abilities.some((x) => x.type === "SPELL_AFTER_ATTACK" && x.subtype === sub);
  // Sea Witches (HotA) weaken the stack they shoot, or, already weakened, cast Disrupting Ray on it instead
  // (heroes.thelazy.net Sea Witch: Basic for the Sea Witches, Advanced for the Sorceresses).
  const layered = after("weakness") && after("disruptingRay");
  const witch = ac.key === "sorceress" ? 2 : 1;
  let weakened = false;
  for (const ab of ac.abilities) {
    if (ab.type !== "SPELL_AFTER_ATTACK") continue;
    // A Great Shaman's freezing shot and a Sea Witch's spells come with shots; the rest with blows.
    const afterShot = ab.subtype === "freezingShot" || (hasAbility(ac, "SHOOTER") && (ab.subtype === "weakness" || ab.subtype === "disruptingRay"));
    if (ranged !== afterShot) continue;
    if (random(s) * 100 >= (ab.val ?? 0)) continue;
    // Immune to that spell (Troglodytes to a Medusa's gaze): the blow is just a blow.
    if (dc.abilities.some((x) => x.type === "SPELL_IMMUNITY" && x.subtype === ab.subtype)) continue;
    // (The hero's immunities too: the Sphere of Permanence against a Serpent Fly's dispel, the Pendant of Free Will against a Fangarm's hypnosis.)
    if ((s.sides[d.side].hero?.bonuses ?? []).some((x) => x.type === "SPELL_IMMUNITY" && x.subtype === ab.subtype)) continue;
    // The effect counts as a spell of its SPTRAITS level (Disease 2, Stone Gaze 3, Paralyze 4, Age 5):
    // dragons immune to that level shrug it off, as do Cursed Ground, Recanter's Cloak and Cape of Silence.
    if (abilityLevelBlocked(s, d, s.spells?.[ABILITY_SPELL[ab.subtype ?? ""]]?.level ?? 0)) continue;
    let note: OurLine | "" = "";
    // The original's own line for the effect, when it has one (GENRLTXT 551-564, 91).
    let line: LogLine | null = null;
    const dn = d.creature;
    switch (ab.subtype) {
      case "bind":
        put(SPELL.BIND, a.id, 999);
        line = LOG.bound(dn, d.count);
        break;
      case "freezingShot":
        // HotA: frozen for three rounds, unable to act, a quarter more damage taken.
        put(SPELL.FROZEN, 25, 3);
        note = "frozen";
        break;
      case "blind":
        if (mindless) continue;
        // Basic Blind for three rounds (heroes.thelazy.net Unicorn; VCMI's enchant power 3 for creatures).
        put(SPELL.BLIND, 0, 3);
        line = LOG.blinded(dn, d.count);
        break;
      case "paralyze":
        // (Only war machines and the level-immune resist it: undead and golems freeze too, heroes.thelazy.net Scorpicore.)
        put(SPELL.PARALYZE, 0);
        line = LOG.paralyzed(dn, d.count);
        break;
      case "stoneGaze":
        // (Undead and golems too: only war machines, Troglodytes and the level-immune resist, heroes.thelazy.net Petrification.)
        put(SPELL.STONE_GAZE, 0);
        line = LOG.stone(dn, d.count);
        break;
      case "disease":
        if (!living) continue;
        put(SPELL.DISEASE, 2);
        line = LOG.ill(dn, d.count);
        break;
      case "poison": {
        if (!living) continue;
        // A tenth of their health at once and a tenth more on each of the next two rounds; it stays
        // lost after (up to half, poisoned again), until a Cure (heroes.thelazy.net Poison).
        // (value: the share lost; mastery: the rounds still to bite.)
        const was = hpOf(s, d);
        const e = effectOf(d, SPELL.POISON);
        if (e) (e.value = Math.min(50, e.value + 10)), (e.mastery = 2);
        else (d.effects ??= []).push({ spell: SPELL.POISON, rounds: 999, mastery: 2, value: 10 });
        shrink(s, d, was);
        line = LOG.poisoned(dn, d.count);
        break;
      }
      case "age": {
        if (!living) continue;
        const was = hpOf(s, d);
        put(SPELL.AGE, 50);
        shrink(s, d, was);
        line = LOG.aged(dn, d.count, was - hpOf(s, d));
        break;
      }
      case "curse":
        // Mummies: Advanced Curse for three rounds (heroes.thelazy.net Mummy).
        if (hasAbility(dc, "UNDEAD")) continue;
        // Advanced Curse (heroes.thelazy.net Black Knight): the minimum damage, 20% less.
        put(SPELL.CURSE, level(SPELL.CURSE, 2, 1), 3, 2);
        note = "cursed";
        break;
      case "weakness": {
        if (layered && effectOf(d, SPELL.WEAKNESS)) continue;
        const m = layered ? witch : 2;
        put(SPELL.WEAKNESS, level(SPELL.WEAKNESS, m, 6), 3, m);
        weakened = true;
        note = "weakened";
        break;
      }
      case "dispelHelpful":
        // Nothing helpful on the stack: no dispel to show (2026-11-01: the Serpent Flies' effect played on every bite).
        if (!(d.effects ?? []).some((e) => isPositive(e.spell))) continue;
        d.effects = (d.effects ?? []).filter((e) => !isPositive(e.spell));
        line = LOG.dispelled(dn, d.count);
        break;
      case "disruptingRay": {
        // Sea Witches (HotA): Disrupting Ray on a weakened stack, -3 (Advanced: -4) defense that stacks for the rest of the battle.
        if (layered && weakened) continue;
        const v = layered ? level(SPELL.DISRUPTING_RAY, witch, 3) : 3;
        const e = effectOf(d, SPELL.DISRUPTING_RAY);
        if (e) e.value += v;
        else put(SPELL.DISRUPTING_RAY, v, 999);
        line = LOG.ray(v);
        break;
      }
      case "hypnotize": {
        // Fangarms (HotA): Advanced Hypnotize for three rounds at a spell power of their number: only stacks
        // with no more health left than 20 + 25 per Fangarm, not already hypnotized (heroes.thelazy.net Fangarm).
        const hyp = s.spells?.[SPELL.HYPNOTIZE];
        if (mindless || effectOf(d, SPELL.HYPNOTIZE)) continue;
        if (totalHp(s, d) > (hyp?.power ?? 25) * a.count + (hyp?.effect[2] ?? 20)) continue;
        if (hyp && !asCreature({ name: ac.plural, mastery: 2, power: a.count, duration: 3 }, () => affects(s, hyp, d))) continue;
        put(SPELL.HYPNOTIZE, 0, 3, 2);
        note = "hypnotized";
        break;
      }
      case "acidBreath": {
        // Rust Dragons: -3 defense for the rest of the battle (the acid's extra damage is strike's).
        const e = effectOf(d, SPELL.ACID_BREATH);
        if (e) e.value += 3;
        else put(SPELL.ACID_BREATH, 3, 999);
        note = "acidBurned";
        break;
      }
      case "thunderbolt": {
        // Thunderbirds: 10 damage per bird, like a lightning strike.
        const per = ac.abilities.find((x) => x.type === "SPECIFIC_SPELL_POWER" && x.subtype === "thunderbolt")?.val ?? 10;
        const dmg = per * a.count;
        const killed = takeDamage(s, d, dmg);
        s.log.push(LOG.thunderbolt(d.creature, killed));
        events.push({ e: "spell", side: a.side, spell: SPELL.THUNDERBOLT, hex: d.pos, units: [d.id], damage: [{ unit: d.id, damage: dmg, killed }], resisted: [], ability: true });
        if (!alive(d)) onDeath(s, d, events);
        continue;
      }
      default:
        continue;
    }
    s.log.push(line ?? LOG.ours(note || "cursed", [{ cr: d.creature, n: 2 }]));
    // (The original's line, when it has one, is what the status line shows as the effect plays.)
    events.push({ e: "spell", side: a.side, spell: ABILITY_SPELL[ab.subtype ?? ""] ?? SPELL.CURSE, hex: d.pos, units: [d.id], damage: [], resisted: [], ability: true, ...(line ? { note: line } : {}) });
    if (!alive(d)) break;
  }
}

/** Aged or poisoned: the top creature keeps the wounds it had (heroes.thelazy.net Aging), never below 1. */
function shrink(s: BattleState, d: Unit, was: number) {
  d.firstHp = Math.max(1, Math.min(hpOf(s, d), d.firstHp - (was - hpOf(s, d))));
}

/** Does a creature's after-attack spell of this level fail on `d` (level immunity, Cursed Ground, the blocking artifacts)? */
function abilityLevelBlocked(s: BattleState, d: Unit, level: number): boolean {
  if (level <= 0) return false;
  const own = orbOfVulnerability(s) ? 0 : (ability(stats(s, d), "LEVEL_SPELL_IMMUNITY")?.val ?? 0);
  if (level <= own || level <= heroBonus(s, d.side, "LEVEL_SPELL_IMMUNITY")) return true;
  if (cursedGround(s) && level > 1) return true;
  // (Not the Orb of Inhibition: the creatures' powers aren't cast spells.)
  return s.sides.some((x) => (x.hero?.bonuses ?? []).some((b) => (b.type === "BLOCK_MAGIC_ABOVE" && level > (b.val ?? 0)) || (b.type === "BLOCK_MAGIC_BELOW" && level < (b.val ?? 0))));
}

const ABILITY_SPELL: Record<string, number> = {
  disruptingRay: SPELL.DISRUPTING_RAY, hypnotize: SPELL.HYPNOTIZE,
  bind: SPELL.BIND, blind: SPELL.BLIND, paralyze: SPELL.PARALYZE, stoneGaze: SPELL.STONE_GAZE, disease: SPELL.DISEASE, poison: SPELL.POISON,
  age: SPELL.AGE, curse: SPELL.CURSE, weakness: SPELL.WEAKNESS, dispelHelpful: SPELL.DISPEL_HELPFUL, acidBreath: SPELL.ACID_BREATH, freezingShot: SPELL.FROZEN,
};

/** Magogs' fireballs and Liches' death clouds also hit everyone around the target. */
export function shotSplash(s: BattleState, a: Unit, d: Unit): Unit[] {
  const like = ability(stats(s, a), "SPELL_LIKE_ATTACK")?.subtype;
  // Only these two reach around; HotA's Grenadiers' grenades (range 0) hit the target alone.
  if (like !== "fireballAbility" && like !== "deathCloud") return [];
  return caughtInBurst(s, like === "deathCloud", new Set([...unitHexes(s, d), ...unitHexes(s, d).flatMap(neighbours)]), d);
}

/** The stacks (not war machines) on `area` but `skip` a burst catches: a death cloud the living, a fireball the not fire-immune. */
function caughtInBurst(s: BattleState, cloud: boolean, area: Set<number>, skip: Unit): Unit[] {
  return s.units.filter((x) => {
    if (!alive(x) || x === skip || x.machine || !unitHexes(s, x).some((h) => area.has(h))) return false;
    const c = stats(s, x);
    if (cloud) return isLiving(c);
    return !c.abilities.some((ab) => ab.type === "SPELL_SCHOOL_IMMUNITY" && ab.subtype === "fire") && !hasAbility(c, "FIRE_IMMUNITY");
  });
}

/** Shooters whose shot bursts over an area, so they may aim at an empty hex: HotA's Magogs, Liches and Power Liches. */
export const areaShooter = (s: BattleState, u: Unit): boolean => ["fireballAbility", "deathCloud"].includes(ability(stats(s, u), "SPELL_LIKE_ATTACK")?.subtype ?? "");

/**
 * Who a blast aimed at the empty `hex` would hit: everyone on it or next to it, friend or foe, but the
 * fire-immune (a fireball reaches them only on its central hex) or, for a death cloud, the undead and
 * non-living. Not at the shooter's own or neighbouring hexes, unless the Bow of the Sharpshooter is there.
 */
export function areaShotTargets(s: BattleState, a: Unit, hex: number): Unit[] {
  const free = hasAbility(stats(s, a), "FREE_SHOOTING") || hasHeroBonus(s, a.side, "FREE_SHOOTING");
  if (!free && unitHexes(s, a).some((h) => h === hex || neighbours(h).includes(hex))) return [];
  const cloud = ability(stats(s, a), "SPELL_LIKE_ATTACK")?.subtype === "deathCloud";
  return caughtInBurst(s, cloud, new Set([hex, ...neighbours(hex)]), a);
}

/**
 * Where a melee blow from `at` leaves the attacker and where it lands on `d`, as the original (VCMI's
 * getPotentiallyAttackableHexes): a wide attacker strikes with its head when the head touches the target, else
 * with its tail (it turns round); a wide target is struck on its tail when that touches the striking hex, else
 * on its head. So a wide stack centred over a target strikes from its head: facing right, a breath goes down
 * (or up) to the left, facing left to the right (heroes.thelazy.net Breath attack: "the hex to the rear of the
 * approach vector"). No choice of facing: the army's side decides it.
 */
export function blowLine(s: BattleState, a: Unit, d: Unit, at = a.pos): { from: number; struck: number } {
  const mine = unitHexes(s, a, at);
  const theirs = unitHexes(s, d);
  const touches = (h: number) => theirs.some((t) => hexDistance(h, t) === 1);
  const from = mine.length > 1 && !touches(mine[0]) ? mine[1] : mine[0];
  const struck = theirs.length > 1 && hexDistance(from, theirs[1]) === 1 ? theirs[1] : theirs[0];
  if (hexDistance(from, struck) === 1) return { from, struck };
  // (Not touching at all: the closest pair.)
  let best = { from: mine[0], struck: theirs[0] };
  for (const t of theirs) for (const m of mine) if (hexDistance(m, t) < hexDistance(best.from, best.struck)) best = { from: m, struck: t };
  return best;
}

/**
 * Every side a melee attacker can strike the hex `hex` of `target` from (VCMI's getReachableApproaches with
 * fromWhichHexAttack, as the original's cursor): `dir` 0-5 the hex's six sides (as hexToward), and for a wide
 * attacker 6 and 7, centred right above and right below it; `from` where the attacker's head then stands.
 * Only the spots it can reach this turn (attackPositions).
 */
export function attackApproaches(s: BattleState, u: Unit, target: Unit, hex: number): { dir: number; from: number }[] {
  const ok = new Set(attackPositions(s, u, target));
  const wide = isWide(s, u);
  const right = u.side === 0;
  const out: { dir: number; from: number }[] = [];
  for (let dir = 0; dir < (wide ? 8 : 6); dir++) {
    let from: number;
    if (!wide) from = hexToward(hex, dir);
    else if (dir === 6) from = hexToward(hex, right ? 1 : 0);
    else if (dir === 7) from = hexToward(hex, right ? 3 : 4);
    // On the left sides the head is the neighbour itself when facing right (else one further left); on the right sides one further right when facing right.
    else if (dir === 0 || dir === 4 || dir === 5) from = right ? hexToward(hex, dir) : hexToward(hexToward(hex, dir), 5);
    else from = right ? hexToward(hexToward(hex, dir), 2) : hexToward(hex, dir);
    if (from >= 0 && ok.has(from) && !out.some((o) => o.from === from)) out.push({ dir, from });
  }
  return out;
}

/** Extra stacks hit by breath, multi-head and all-adjacent attacks (struck from `at`, where the attacker stands by default). */
export function splashTargets(s: BattleState, a: Unit, d: Unit, at = a.pos): Unit[] {
  const ac = stats(s, a);
  const mine = unitHexes(s, a, at);
  const { from, struck } = blowLine(s, a, d, at);
  const dir = sideOf(from, struck);
  const out = new Set<Unit>();
  if (hasAbility(ac, "TWO_HEX_ATTACK_BREATH") && dir >= 0) {
    // Breath hits whoever stands behind the struck hex, friend or foe; behind a wide target's own other hex
    // nobody (heroes.thelazy.net: "two hexes wide do not suffer double damage"; VCMI's path {11}).
    const behind = unitAt(s, hexToward(struck, dir));
    if (behind && behind !== d && behind !== a) out.add(behind);
  }
  if (hasAbility(ac, "ATTACKS_ALL_ADJACENT") || hasAbility(ac, "MULTIHEX_UNIT_ATTACK")) {
    for (const e of s.units) if (alive(e) && e.side !== a.side && e !== d && areAdjacent(s, a, at, e)) out.add(e);
  }
  if (hasAbility(ac, "THREE_HEADED_ATTACK") && dir >= 0) {
    // The two hexes flanking the blow, next to both the striking hex and the struck one; when one is the
    // attacker's own tail, the one past the struck hex on that side instead (VCMI's path {2, 6}).
    for (const turn of [1, 5]) {
      let h = hexToward(from, dir + turn);
      if (mine.includes(h)) h = hexToward(struck, dir + turn);
      const e = h >= 0 ? unitAt(s, h) : undefined;
      if (e && e !== d && e !== a && e.side !== a.side) out.add(e);
    }
  }
  return [...out];
}

export function canRetaliate(s: BattleState, d: Unit): boolean {
  const c = stats(s, d);
  if (!alive(d) || d.machine || hasAbility(c, "NO_RETALIATION") || disabled(d)) return false;
  // Phoenixes reborn from the blow that killed them don't answer it, nor anything else that round.
  if (d.rebornRound === s.round) return false;
  // Woken from an expert Blind: no strike back at all.
  if ((woken.get(d) ?? 0) >= 3) return false;
  if (hasAbility(c, "UNLIMITED_RETALIATIONS")) return true;
  return d.retaliations < 1 + (ability(c, "ADDITIONAL_RETALIATION")?.val ?? 0) + (effectOf(d, SPELL.COUNTERSTRIKE)?.value ?? 0);
}

/** One of the two is now hypnotized to the other's side (HotA Fangarms): the exchange of blows ends. */
const turned = (a: Unit, d: Unit) => (!!effectOf(d, SPELL.HYPNOTIZE) || !!effectOf(a, SPELL.HYPNOTIZE)) && controlSide(a) === controlSide(d);

function melee(s: BattleState, a: Unit, d: Unit, moved: number, events: BattleEvent[]) {
  const ac = stats(s, a);
  // (Devoured corpses, HotA Olgoi-Khorkhoi: one more strike each, all spent on this attack.)
  const owed = a.bonusStrikes ?? 0;
  if (owed) a.bonusStrikes = 0;
  // (Marksmen and Grand Elves shoot twice but strike once: VCMI's ONLY_DISTANCE_FIGHT.)
  const twice = ability(ac, "ADDITIONAL_ATTACK");
  const hits = 1 + (twice?.subtype === "onlyDistanceFight" ? 0 : (twice?.val ?? 0)) + owed;
  let bonus = ability(ac, "FEROCITY")?.val ?? 0;
  // FIRST_STRIKE (melee or all attacks): the defender's retaliation comes before the first blow.
  const fs = ability(stats(s, d), "FIRST_STRIKE");
  let early = !!fs && (!fs.subtype || fs.subtype === "damageTypeMelee" || fs.subtype === "damageTypeAll") && !hasAbility(ac, "BLOCKS_RETALIATION") && canRetaliate(s, d);
  if (early) {
    d.retaliations++;
    strike(s, d, a, false, true, 0, events);
  }
  for (let hit = 0; hit < hits && alive(a) && alive(d) && !turned(a, d); hit++) {
    const extra = splashTargets(s, a, d);
    const before = d.count;
    strike(s, a, d, false, false, moved, events);
    // Ferocity (Ayssids): a blow that kills earns another one.
    if (bonus > 0 && d.count < before && alive(d)) {
      bonus--;
      hit--;
    }
    for (const e of extra) if (alive(e) && alive(a)) strike(s, a, e, false, false, moved, events, true);
    if (!alive(a)) break;
    // A stack a Fangarm's blow has just hypnotized doesn't strike back; Fangarms hypnotizing in return stop a second blow.
    if (turned(a, d)) break;
    if (early) early = false;
    else if (!hasAbility(ac, "BLOCKS_RETALIATION") && canRetaliate(s, d)) {
      d.retaliations++;
      strike(s, d, a, false, true, 0, events);
    }
  }
  for (const x of s.units) woken.delete(x);
}

/** Validates and applies an action for the active unit. Throws on illegal input. */
export function applyAction(s: BattleState, action: BattleAction): BattleEvent[] {
  // The drawbridge follows whoever lies in the gateway, before (older saves) and after every action.
  updateGate(s);
  const events = act(s, action);
  updateGate(s);
  return events;
}

function act(s: BattleState, action: BattleAction): BattleEvent[] {
  if (!action || typeof action !== "object" || typeof action.type !== "string") throw new Refusal("not an action");
  if (s.tactics) return applyTactics(s, action);
  const u = activeUnit(s);
  if (!u || u.id !== action.unit) throw new Refusal("not this unit's turn");
  const events: BattleEvent[] = [];

  switch (action.type) {
    case "cast":
      castSpell(s, controlSide(u), action.spell, action.target, events, action.dest);
      checkEnd(s, events);
      // The stack whose turn it was fell to the spell (Armageddon, Sacrifice): the turn moves on.
      if (s.winner === null && !alive(u)) {
        u.acted = true;
        advance(s, events);
      }
      return events;
    case "retreat":
      // (A hypnotized stack's turn is its controller's: that side gives up.)
      flee(s, controlSide(u), action.surrender, events);
      return events;
    case "wait":
      if (u.waited) throw new Refusal("already waited");
      u.waited = true;
      s.log.push(LOG.wait(u.creature, u.count));
      events.push({ e: "wait", unit: u.id });
      advance(s, events);
      return events;
    case "defend":
      {
        const before = defenseOf(s, u);
        u.defending = true;
        s.log.push(LOG.defend(u.creature, u.count, defenseOf(s, u) - before));
      }
      gainRunes(s, u, 3);
      events.push({ e: "defend", unit: u.id });
      break;
    case "move": {
      const reach = reachable(s, u);
      if (!reach.has(action.to) || action.to === u.pos) throw new Refusal("unreachable");
      const path = pathTo(reach, action.to);
      events.push({ e: "move", unit: u.id, path, fly: canFly(s, u) });
      u.pos = action.to;
      letGo(s, u);
      moat(s, u, events);
      tread(s, u, canFly(s, u) ? [action.to] : path.slice(1), events);
      break;
    }
    case "creatureCast": {
      const keepsTurn = castKeepsTurn(s, u, action.target);
      creatureCast(s, u, action.target, events, action.dest);
      checkEnd(s, events);
      // A Crimson Couatl meditates and still acts; so do Automatons that ignite.
      if (keepsTurn && s.winner === null) return events;
      break;
    }
    case "heal": {
      const target = s.units[action.target];
      if (u.machine !== "tent" || !target || !healTargets(s, u).includes(target)) throw new Refusal("nothing to heal there");
      firstAid(s, u, events, target);
      break;
    }
    case "catapult": {
      if (u.machine !== "catapult" && !canShootWalls(s, u)) throw new Refusal("only the catapult (or Cyclopes) throws at walls");
      if (!(s.siege?.walls[action.target] ?? 0)) throw new Refusal("that part of the walls is down");
      if (!u.machine && !WALL_SEGMENTS.includes(action.target)) throw new Refusal("Cyclopes throw only at the wall segments");
      throwStones(s, u, action.target, events);
      break;
    }
    case "attack": {
      const target = s.units[action.target];
      if (!target || !alive(target) || target === u || target.machine === "tower") throw new Refusal("bad target");
      if (meditating(s, target)) throw new Refusal("nothing can touch a meditating stack");
      if (controlSide(target) === controlSide(u) && !effectOf(u, SPELL.BERSERK)) throw new Refusal("bad target");
      const reach = reachable(s, u);
      const from = reach.get(action.from);
      if (!from || !areAdjacent(s, u, action.from, target)) throw new Refusal("can't attack from there");
      // (HotA's alternate action: only those that fly back can be told to stay.)
      if (action.stay && !hasAbility(stats(s, u), "RETURN_AFTER_STRIKE")) throw new Refusal("only Harpies can strike and stay");
      const start = u.pos;
      if (action.from !== u.pos) {
        const path = pathTo(reach, action.from);
        events.push({ e: "move", unit: u.id, path, fly: canFly(s, u) });
        u.pos = action.from;
        letGo(s, u);
        moat(s, u, events);
        tread(s, u, canFly(s, u) ? [action.from] : path.slice(1), events);
      }
      // Olgoi-Khorkhoi eat the corpses where they stand to strike, and the strikes count at once.
      if (alive(u) && devours(s, u)) devour(s, u, unitHexes(s, u), events);
      if (alive(u)) {
        gainRunes(s, u, 1);
        melee(s, u, target, from.dist, events);
      }
      // Harpies fly back to where they started.
      // (HotA: unless told to stay, the alternate action; nor when the Dendroids they struck bound them
      // back: the original flew them home bound for good, HotA 1.3.3 "Fixed a SoD bug with Harpy return".)
      if (alive(u) && !action.stay && !bound(s, u) && fliesBack(s, u, u.pos, start)) {
        events.push({ e: "move", unit: u.id, path: [u.pos, start], fly: true });
        u.pos = start;
      }
      break;
    }
    case "shootHex": {
      if (!areaShooter(s, u) || !canShoot(s, u)) throw new Refusal("can't shoot there");
      if (!isPlayable(hexCol(action.hex), hexRow(action.hex)) || unitAt(s, action.hex)) throw new Refusal("aim at an empty hex");
      const hit = areaShotTargets(s, u, action.hex);
      if (!hit.some((x) => !meditating(s, x))) throw new Refusal("nobody stands there");
      gainRunes(s, u, 1);
      if (!suppliedByCart(s, u.side)) u.shots--;
      // The shot flies at the first enemy in the blast (as an ordinary shot); the rest are caught in it.
      const main = hit.find((x) => controlSide(x) !== controlSide(u) && !meditating(s, x)) ?? hit.find((x) => !meditating(s, x))!;
      strike(s, u, main, true, false, 0, events);
      for (const x of hit) if (x !== main && alive(x) && !meditating(s, x)) strike(s, u, x, true, false, 0, events, true);
      break;
    }
    case "shoot": {
      const target = s.units[action.target];
      if (!target || !alive(target) || target === u || target.machine === "tower") throw new Refusal("bad target");
      if (meditating(s, target)) throw new Refusal("nothing can touch a meditating stack");
      if (controlSide(target) === controlSide(u) && !effectOf(u, SPELL.BERSERK)) throw new Refusal("bad target");
      if (!canShoot(s, u)) throw new Refusal("can't shoot");
      if (!canShootAt(s, u, target)) throw new Refusal("Steel Elves can't shoot a stack next to them: they fight it hand to hand.");
      gainRunes(s, u, 1);
      const tc = stats(s, target);
      // Gunslingers and Bounty Hunters (HotA) answer a shot with their own (RANGED_RETALIATION),
      // fired before it when they strike first (FIRST_STRIKE: ranged or all attacks), else after;
      // only when they could shoot themselves, and never at the Ballista, the Cannon or an area shot
      // (heroes.thelazy.net Gunslinger, Preemptive Shot).
      const shootBack = () => {
        if (!hasAbility(tc, "RANGED_RETALIATION") || !alive(target) || !alive(u) || !canShoot(s, target) || !canRetaliate(s, target)) return;
        if (u.machine || areaShooter(s, u)) return;
        target.retaliations++;
        if (!suppliedByCart(s, target.side)) target.shots--;
        strike(s, target, u, true, true, 0, events);
      };
      const first = ability(tc, "FIRST_STRIKE");
      const shootsFirst = !!first && (!first.subtype || first.subtype === "damageTypeRanged" || first.subtype === "damageTypeAll");
      if (shootsFirst) shootBack();
      const shots = 1 + (ability(stats(s, u), "ADDITIONAL_ATTACK")?.val ?? 0);
      // An ammo cart keeps the shooters supplied; Artillery lets the ballista shoot twice.
      const cart = suppliedByCart(s, u.side);
      const volleys = u.machine === "ballista" && skillLevel(s.sides[u.side].hero?.skills, "artillery") >= 2 ? 2 : shots;
      for (let i = 0; i < volleys && u.shots > 0 && alive(target) && alive(u); i++) {
        if (!cart) u.shots--;
        const around = shotSplash(s, u, target);
        strike(s, u, target, true, false, 0, events);
        for (const x of around) if (alive(x)) strike(s, u, x, true, false, 0, events, true);
      }
      if (!shootsFirst) shootBack();
      break;
    }
    default:
      throw new Refusal(`unknown action ${(action as { type: unknown }).type}`);
  }
  // A paralysed stack's weak answer was for that attack only.
  for (const x of s.units) if (x.numbed) delete x.numbed;
  // Berserk lasts until the stack has lashed out.
  if ((action.type === "attack" || action.type === "shoot" || action.type === "shootHex") && u.effects) u.effects = u.effects.filter((e) => e.spell !== SPELL.BERSERK);
  // A turn ended in the moat hurts (once a round; walking in already did; a spell cast spares it).
  if (alive(u) && s.winner === null && action.type !== "creatureCast" && !u.hadMorale && !events.some((e) => e.e === "moat" && e.unit === u.id)) moat(s, u, events);
  if (action.type !== "defend" && !checkEnd(s, events) && rollGoodMorale(s, u, events)) return events;
  if (s.winner !== null) return events;
  u.acted = true;
  advance(s, events);
  return events;
}
