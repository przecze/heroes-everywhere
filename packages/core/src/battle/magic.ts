// Hero spellcasting in battle (heroes.thelazy.net/index.php/Spells).
import { enchantSpecialty, doubleClone, healSpecialtyPercent, schoolDamageSpecialty, skillFactor, spellDamageSpecialty, spellDurationSpecialty, spellSpecialtyPercent } from "../specialty.ts";
import { type CreatureStats, ability, hasAbility } from "../creatures.ts";
import { random } from "../rng.ts";
import { RESISTANCE, SORCERY, skillLevel } from "../skills.ts";
import { COMBAT_SPELLS, SPELL, SUMMONED, type SpellInfo, isPositive } from "../spells.ts";
import { HEX_COUNT, hexAt, hexCol, hexDistance, hexRow, isPlayable, neighbours } from "./hex.ts";
import { BATTLEFIELDS, blockedHexes, obstacleType } from "./fields.ts";
import { damageWall, earthquakeHits, inMoat, insideWalls, wallBlocked } from "./siege.ts";
import { cursedGround, expertGround } from "./ground.ts";
import { type BattleEvent, alive, controlSide, effectOf, hasHeroBonus, heal, heroBonus, oblivion, onDeath, onNativeTerrain, stats } from "./rules.ts";
import { canOccupy, unitAt, unitHexes } from "./reach.ts";
import { hpOf, isLiving, mindImmune, releaseBound, takeDamage, totalHp } from "./damage.ts";
import type { BattleState, Side, Unit } from "./state.ts";
import { LOG } from "./texts.ts";
import { Refusal } from "../refusal.ts";

const SCHOOL_SKILL = { earth: "earthMagic", water: "waterMagic", fire: "fireMagic", air: "airMagic" } as const;

/** A creature casting instead of the hero: its mastery, spell power and how many rounds effects last. */
interface CreatureCaster {
  name: string;
  /** The casting creature (for the log). */
  cr?: number;
  mastery: number;
  power: number;
  duration: number;
  /** Health a resurrecting creature gives back (Archangels), instead of the spell's formula. */
  raise?: number;
  /** Faerie Dragons: they cast even in an Anti-magic Garrison's battle. */
  faerie?: boolean;
}
let creature: CreatureCaster | null = null;

/** Runs `fn` with a creature as the caster (see creatureMagic.ts). */
export function asCreature<T>(caster: CreatureCaster, fn: () => T): T {
  creature = caster;
  try {
    return fn();
  } finally {
    creature = null;
  }
}

/** Mastery 0..3: the hero's best level among the spell's schools. */
export function mastery(s: BattleState, side: Side, spell: SpellInfo): number {
  // Magic Plains and the school grounds: expert, whoever casts.
  if (expertGround(s, spell)) return 3;
  if (creature) return creature.mastery;
  const skills = s.sides[side].hero?.skills;
  return Math.max(0, ...spell.schools.map((sc) => skillLevel(skills, SCHOOL_SKILL[sc])));
}

/**
 * Mana cost, with Pegasi (+2 for the enemy) and Mages (-2 for their own side): for the whole battle
 * once they were there at its start, even after they have all fallen; several stacks don't add up
 * (heroes.thelazy.net Pegasus, Mage: "Magic Damper", "Magic Channeler").
 */
export function spellCost(s: BattleState, side: Side, spell: SpellInfo): number {
  let more = 0;
  let less = 0;
  for (const u of s.units) {
    if (u.summoned || u.clone || u.raised || u.machine) continue;
    const c = stats(s, u);
    if (u.side !== side) more = Math.max(more, ability(c, "CHANGES_SPELL_COST_FOR_ENEMY")?.val ?? 0);
    else less = Math.max(less, ability(c, "CHANGES_SPELL_COST_FOR_ALLY")?.val ?? 0);
  }
  return Math.max(1, spell.cost[mastery(s, side, spell)] + more - less);
}

/** Spell power: the hero's, less 10/20/30% for an enemy hero with Interference (HotA). */
const power = (s: BattleState, side: Side) => {
  if (creature) return creature.power;
  // (The other side's Charm of Eclipse and kin take from the caster's power.)
  const p = Math.max(1, (s.sides[side].hero?.primary[2] ?? 1) + (s.sides[1 - side].hero?.enemySpellPower ?? 0));
  const interference = skillLevel(s.sides[1 - side].hero?.skills, "interference");
  return Math.max(1, Math.floor(p * (1 - 0.1 * interference)));
};

/** Spells the side's hero can cast right now. */
export function castable(s: BattleState, side: Side): SpellInfo[] {
  const hero = s.sides[side].hero;
  if (!hero?.spells || s.cast?.[side] || s.winner !== null) return [];
  return hero.spells
    .map((id) => s.spells?.[id])
    .filter((sp): sp is SpellInfo => !!sp && !!COMBAT_SPELLS[sp.id] && spellCost(s, side, sp) <= (hero.mana ?? 0) && !magicBlocked(s, sp) && !affectsNoOne(s, side, sp));
}

/** Why a spell can't be cast here: Cursed Ground, or a hero's artifact on either side (the Orb of
 *  Inhibition: no magic; Recanter's Cloak: nothing above level 2; Cape of Silence: nothing up to level 3). */
export type MagicBlock = { by: "cursedGround" } | { by: "garrison" } | { by: "artifact"; type: "BLOCK_ALL_MAGIC" | "BLOCK_MAGIC_ABOVE" | "BLOCK_MAGIC_BELOW"; artifact?: number };

export function magicBlock(s: BattleState, sp: SpellInfo, faerie = !!creature?.faerie): MagicBlock | null {
  // An Anti-magic Garrison's battle: no spells at all, but the Faerie Dragons' (heroes.thelazy.net Garrison;
  // VCMI's BLOCK_ALL_MAGIC battle-wide). The artifacts' opening spells still go off (they aren't cast).
  if (s.noMagic && !faerie) return { by: "garrison" };
  // Cursed Ground: nothing above level 1.
  if (cursedGround(s) && sp.level > 1) return { by: "cursedGround" };
  for (const side of [0, 1]) {
    for (const b of s.sides[side]?.hero?.bonuses ?? []) {
      const blocks =
        b.type === "BLOCK_ALL_MAGIC" || (b.type === "BLOCK_MAGIC_ABOVE" && sp.level > (b.val ?? 0)) || (b.type === "BLOCK_MAGIC_BELOW" && sp.level < (b.val ?? 0));
      if (blocks) return { by: "artifact", type: b.type as "BLOCK_ALL_MAGIC", artifact: b.artifact };
    }
  }
  return null;
}

export function magicBlocked(s: BattleState, sp: SpellInfo, faerie?: boolean): boolean {
  return magicBlock(s, sp, faerie) !== null;
}

const isUndead = (s: BattleState, u: Unit) => hasAbility(stats(s, u), "UNDEAD");

const OBLIVION_IMMUNE = new Set(["resurrection", "animateDead", "sacrifice"]);

/** Can this spell affect this unit at all (immunities and target rules)? */
export function affects(s: BattleState, spell: SpellInfo, u: Unit): boolean {
  if (u.sacrificed) return false;
  // A meditating Couatl: nothing touches it until its first turn in the next round.
  if (u.meditating !== undefined) return false;
  if (!alive(u) && (oblivion(s) || (spell.id !== SPELL.RESURRECTION && spell.id !== SPELL.ANIMATE_DEAD && spell.id !== SPELL.SACRIFICE))) return false;
  const c = stats(s, u);
  const def = COMBAT_SPELLS[spell.id];
  if (hasAbility(c, "SIEGE_WEAPON")) return false;
  // The Orb of Vulnerability strips creatures' own immunities (not those heroes' artifacts give).
  const orb = orbOfVulnerability(s);
  if (!orb && c.abilities.some((a) => a.type === "SPELL_IMMUNITY" && a.subtype === spell.key)) return false;
  // The hero's pendants and the Dragon Father's power protect the whole side (HotA took the Badge of Courage's away).
  if (!u.machine) {
    if ((s.sides[u.side].hero?.bonuses ?? []).some((b) => b.type === "SPELL_IMMUNITY" && b.subtype === spell.key)) return false;
  }
  // The Ring of Oblivion's immunities are battle-wide (the HotA mod's propagator): nobody raises,
  // sacrifices or resurrects, on either side.
  if (oblivion(s) && OBLIVION_IMMUNE.has(spell.key)) return false;
  // Dispel ignores the creatures' natural immunities and Anti-Magic: only the Sphere of Permanence stops it (SPTRAITS, heroes.thelazy.net).
  if (spell.id === SPELL.DISPEL) return alive(u);
  if (!u.machine) {
    // Power of the Dragon Father: levels 1-4 don't touch them, friendly spells included.
    if (spell.level > 0 && spell.level <= heroBonus(s, u.side, "LEVEL_SPELL_IMMUNITY")) return false;
    // (The Orb of Vulnerability cancels the Sleepkeeper's: the HotA mod's text.)
    if (!orb && COMBAT_SPELLS[spell.id]?.mind && hasHeroBonus(s, u.side, "MIND_IMMUNITY")) return false;
  }
  if (!orb && c.abilities.some((a) => a.type === "SPELL_SCHOOL_IMMUNITY" && spell.schools.includes(a.subtype as never))) return false;
  const levelImmune = orb ? 0 : (ability(c, "LEVEL_SPELL_IMMUNITY")?.val ?? 0);
  if (spell.level > 0 && spell.level <= levelImmune) return false;
  const anti = effectOf(u, SPELL.ANTI_MAGIC);
  if (anti && spell.level < anti.value && spell.id !== SPELL.ANTI_MAGIC) return false;
  if (def?.mind && mindImmune(stats(s, u))) return false;
  switch (spell.id) {
    case SPELL.DEATH_RIPPLE:
    case SPELL.BLESS:
    case SPELL.CURSE:
      return !isUndead(s, u);
    case SPELL.DESTROY_UNDEAD:
      return isUndead(s, u);
    case SPELL.ANIMATE_DEAD:
      return isUndead(s, u) && raisable(s, spell, u);
    case SPELL.RESURRECTION:
      // Never Golems, Gargoyles, Elementals, the mechanical or the undead (heroes.thelazy.net Archangel, Resurrection).
      return isLiving(c) && !hasAbility(c, "MECHANICAL") && raisable(s, spell, u);
    case SPELL.SACRIFICE:
      // Only a stack that has fallen entirely, of living creatures.
      return !alive(u) && isLiving(c) && !u.summoned;
    case SPELL.PRECISION:
    case SPELL.FORGETFULNESS:
      return hasAbility(c, "SHOOTER");
    case SPELL.CLONE:
      // Each stack one clone at a time (SPTRAITS; VCMI's hasClone), up to level 5 / 6 / 7 by mastery.
      return !u.clone && !s.units.some((x) => x.clone && x.cloneOf === u.id && alive(x)) && c.level <= 0 + [5, 5, 6, 7][Math.max(0, mastery(s, u.side, spell))];
    case SPELL.ANTI_MAGIC:
      // "Does not affect duplicates created with Clone spell" (SPTRAITS).
      return !u.clone;
    case SPELL.HYPNOTIZE: {
      // Magic Mirror shields from it (heroes.thelazy.net Magic Mirror; VCMI's targetCondition).
      if (effectOf(u, SPELL.MAGIC_MIRROR)) return false;
      // Only stacks with no more health than 25 x power + the mastery bonus, counted as if all were
      // unhurt (heroes.thelazy.net Hypnotize: "the current stack size as if it was full health").
      const side = (1 - u.side) as Side;
      // Astral (HotA): 10% more for every N hero levels, N the target's level.
      const more = 1 + (creature ? 0 : spellSpecialtyPercent(s.sides[side].hero, spell.id, c.level) / 100);
      // (A Fangarm's own Hypnotize weighs the health left: heroes.thelazy.net Fangarm.)
      return (creature ? totalHp(s, u) : u.count * hpOf(s, u)) <= Math.floor((spell.power * power(s, side) + spell.effect[mastery(s, side, spell)]) * more);
    }
  }
  return true;
}

/** What Resurrection or Animate Dead gives back to this stack: (power x SP + effect), more for a specialist. */
function raiseAmount(s: BattleState, side: Side, spell: SpellInfo, u: Unit): number {
  if (creature?.raise !== undefined) return creature.raise;
  const more = 1 + (creature ? 0 : spellSpecialtyPercent(s.sides[side].hero, spell.id, stats(s, u).level) / 100);
  return Math.floor((spell.power * power(s, side) + spell.effect[mastery(s, side, spell)]) * more);
}

/**
 * Resurrection and Animate Dead (VCMI's heal effect, "minFullUnits": 1): a stack that has lost
 * creatures, when the spell brings back at least one whole creature (not a stack whose only wound is
 * its top creature's, nor Azure Dragons on too little power: heroes.thelazy.net Resurrection), and a
 * fallen stack only while nobody stands on its corpse.
 */
function raisable(s: BattleState, spell: SpellInfo, u: Unit): boolean {
  const hp = hpOf(s, u);
  const injuries = u.initialCount * hp - totalHp(s, u);
  if (injuries <= 0 || Math.min(raiseAmount(s, u.side, spell, u), injuries) < hp) return false;
  return alive(u) || canOccupy(s, u, unitHexes(s, u, u.pos));
}

/**
 * Whether the caster picks a hex for this spell. Not for summons and battlefield-wide spells, nor for
 * the mass versions at Expert (Expert Slow, Bless, Dispel...: the original casts them straight from the book).
 */
export function needsAim(s: BattleState, side: Side, spell: SpellInfo): boolean {
  const def = COMBAT_SPELLS[spell.id];
  if (def?.shape === "summon" || def?.shape === "all" || def?.shape === "field") return false;
  return !((def?.massAtExpert || spell.id === SPELL.DISPEL) && mastery(s, side, spell) >= 3);
}

/** Units the spell would hit if cast on `hex` (for casting and the targeting preview). */
export function spellTargets(s: BattleState, side: Side, spell: SpellInfo, hex: number): Unit[] {
  const def = COMBAT_SPELLS[spell.id];
  if (!def) return [];
  const m = mastery(s, side, spell);
  const friendOk = (u: Unit) => def.who !== "enemy" || u.side !== side;
  const enemyOk = (u: Unit) => def.who !== "friend" || u.side === side;
  const ok = (u: Unit) => friendOk(u) && enemyOk(u) && affects(s, spell, u);
  const byHex = (hexes: number[]) => [...new Set(hexes.map((h) => unitAt(s, h)).filter((u): u is Unit => !!u))].filter(ok);
  switch (def.shape) {
    case "all":
      return s.units.filter((u) => alive(u) && ok(u));
    case "ring":
      return byHex(neighbours(hex));
    case "ball1":
      return byHex([hex, ...neighbours(hex)]);
    case "ball2":
      return byHex([...new Set([hex, ...neighbours(hex), ...neighbours(hex).flatMap(neighbours)])]);
    case "summon":
    case "field":
    case "place":
    case "obstacle":
      return [];
    case "chain": {
      const first = unitAt(s, hex);
      return first && ok(first) ? [first] : [];
    }
    default: {
      // Dispel: a friendly stack (basic), any stack (advanced), every stack on the field (expert).
      if (spell.id === SPELL.DISPEL) {
        if (m >= 3) return s.units.filter((u) => alive(u) && affects(s, spell, u));
        // (Aimed at one stack, it needs something to take away: not a stack with only Disrupting Ray, poison or acid
        // on it, which Dispel can't lift: HotA 1.3.4 and 1.3.5; VCMI's NO_SPELLS_TO_DISPEL.)
        const u = unitAt(s, hex);
        return u && (m >= 2 || u.side === side) && affects(s, spell, u) && (u.effects ?? []).some((e) => !LASTING.has(e.spell)) ? [u] : [];
      }
      // Berserk spreads to the stacks within one (advanced) or two (expert) hexes.
      if (spell.id === SPELL.BERSERK && m >= 2) {
        const ring1 = [hex, ...neighbours(hex)];
        return byHex(m >= 3 ? [...new Set([...ring1, ...ring1.flatMap(neighbours)])] : ring1);
      }
      // Mass versions at expert: every unit of that allegiance; a hypnotised stack counts with the side
      // that holds it (heroes.thelazy.net Hypnotize: "treats them as an allied unit"), so expert Cure
      // passes over one's own hypnotised stack and only basic / advanced Cure frees it (Cure).
      if (def.massAtExpert && m >= 3) {
        const target = def.who === "enemy" ? 1 - side : side;
        return s.units.filter((u) => alive(u) && controlSide(u) === target && affects(s, spell, u));
      }
      const u =
        spell.id === SPELL.RESURRECTION || spell.id === SPELL.ANIMATE_DEAD || spell.id === SPELL.SACRIFICE
          ? s.units.find((x) => unitHexes(s, x).includes(hex) && x.side === side && (spell.id !== SPELL.SACRIFICE || !alive(x)))
          : unitAt(s, hex);
      if (!u) return [];
      if (def.who === "friend" && u.side !== side) return [];
      if (def.who === "enemy" && u.side === side) return [];
      return affects(s, spell, u) ? [u] : [];
    }
  }
}

/** Chance this unit shrugs off a hostile spell: creature resistance, Unicorn aura and the hero's Resistance. */
/** A hero in this battle carries the Orb of Vulnerability. */
export const orbOfVulnerability = (s: BattleState) => s.sides.some((x) => (x.hero?.bonuses ?? []).some((b) => b.type === "NEGATE_ALL_NATURAL_IMMUNITIES"));

export function resistChance(s: BattleState, u: Unit): number {
  // The Orb of Vulnerability: no magic resistance on the battlefield.
  if (orbOfVulnerability(s)) return 0;
  let r = (ability(stats(s, u), "MAGIC_RESISTANCE")?.val ?? 0) / 100;
  // (Not on the Unicorns themselves: heroes.thelazy.net Unicorn; another Unicorn stack beside them gives it.)
  const aura = s.units.some((x) => x !== u && alive(x) && x.side === u.side && hasAbility(stats(s, x), "SPELL_RESISTANCE_AURA") && unitHexes(s, x).some((h) => unitHexes(s, u).some((g) => hexDistance(h, g) <= 1)));
  if (aura) r += 0.2;
  r += RESISTANCE[skillLevel(s.sides[u.side].hero?.skills, "resistance")] * skillFactor(s.sides[u.side].hero, "resistance");
  // Garniture, Surcoat, Boots of Polarity, Pendant of Reflection.
  if (!u.machine) r += heroBonus(s, u.side, "MAGIC_RESISTANCE") / 100;
  return Math.min(0.95, r);
}

/**
 * The Lightning Rod (Factory Grail): lightning on every enemy stack as the battle opens. HotA
 * (heroes.thelazy.net): `base` damage (35 + 7 per building of the town, at most 168), more with
 * Sorcery and the Orb of the Firmament, less for creatures that take less spell damage; creatures
 * immune to Chain Lightning are spared; anti-magic doesn't stop it.
 */
export function lightningRod(s: BattleState, side: Side, base: number, events: BattleEvent[]) {
  const hero = s.sides[side].hero;
  const boost = (1 + SORCERY[skillLevel(hero?.skills, "sorcery")] * skillFactor(hero, "sorcery")) * (1 + heroBonus(s, side, "SPELL_DAMAGE", "air") / 100);
  let struck = 0;
  for (const u of s.units) {
    if (!alive(u) || u.side === side || u.machine) continue;
    const c = stats(s, u);
    const immune = c.abilities.some((a) => (a.type === "SPELL_IMMUNITY" && a.subtype === "chainLightning") || (a.type === "LEVEL_SPELL_IMMUNITY" && (a.val ?? 0) >= 4));
    if (immune) continue;
    const reduce = c.abilities.find((a) => a.type === "SPELL_DAMAGE_REDUCTION" && (a.val ?? 0) > 0 && (a.subtype === "any" || a.subtype === "air"));
    const dmg = Math.max(1, Math.floor(base * boost * (1 - (reduce?.val ?? 0) / 100)));
    takeDamage(s, u, dmg);
    struck++;
    if (!alive(u)) onDeath(s, u, events);
  }
  s.log.push(LOG.ours(struck === 1 ? "rodOne" : "rodMany", [struck]));
}

/** Sorcery's factor for the side's spells (the Sorcery specialists' 5% a level more). */
export function sorcery(s: BattleState, side: Side): number {
  const hero = s.sides[side].hero;
  return 1 + SORCERY[skillLevel(hero?.skills, "sorcery")] * skillFactor(hero, "sorcery");
}

/** The spell-damage artifacts and specialists for a school: the Orbs (+50%) and Adrienne's fire (they add up). */
export function schoolBoost(s: BattleState, side: Side, schools: readonly string[]): number {
  return 1 + Math.max(0, ...schools.map((sc) => heroBonus(s, side, "SPELL_DAMAGE", sc) + schoolDamageSpecialty(s.sides[side].hero, sc))) / 100;
}

const CREATURE_UNSORCERED = new Set<number>([SPELL.MAGIC_ARROW, SPELL.ICE_BOLT, SPELL.LIGHTNING_BOLT]);

/** Damage of a damage spell against one unit. */
export function spellDamage(s: BattleState, side: Side, spell: SpellInfo, u: Unit): number {
  const m = mastery(s, side, spell);
  let dmg = spell.power * power(s, side) + spell.effect[m];
  // Sorcery: the hero's spells, and the creatures' under the hero, but for a Faerie Dragon's Magic
  // Arrow, Ice Bolt and Lightning Bolt (heroes.thelazy.net Sorcery).
  if (!creature || !CREATURE_UNSORCERED.has(spell.id)) dmg *= sorcery(s, side);
  // Orbs: +50% for their school.
  // (Adrienne's +50% to Fire spells adds to the orb's.)
  if (!creature) dmg *= schoolBoost(s, side, spell.schools);
  const c = stats(s, u);
  // Spell specialists: more damage the higher the hero is above the target's level.
  if (!creature) dmg *= 1 + spellSpecialtyPercent(s.sides[side].hero, spell.id, c.level) / 100;
  // Specialists in one spell's damage (Magic Arrow +50%).
  if (!creature) dmg *= 1 + spellDamageSpecialty(s.sides[side].hero, spell.id) / 100;
  const more = c.abilities.find((a) => a.type === "MORE_DAMAGE_FROM_SPELL" && a.subtype === spell.key);
  if (more) dmg *= 1 + (more.val ?? 100) / 100;
  return Math.max(1, Math.floor(spellDamageTaken(s, spell, u, dmg)));
}

/**
 * The damage a spell would do to a target with no defences, for the book's right-click (VCMI's estimateSpellDamage:
 * power x spell power + the mastery's effect, with Sorcery, the Orbs and the specialists, but no target's level or
 * resistances). 0 for spells that deal none, and for Titan's Bolt (its damage isn't the hero's).
 */
export function spellEstimate(s: BattleState, side: Side, spell: SpellInfo): number {
  if (!COMBAT_SPELLS[spell.id]?.damage || spell.id === SPELL.TITANS_BOLT) return 0;
  const hero = s.sides[side].hero;
  const dmg = (spell.power * power(s, side) + spell.effect[mastery(s, side, spell)]) * sorcery(s, side) * schoolBoost(s, side, spell.schools) * (1 + spellDamageSpecialty(hero, spell.id) / 100);
  return Math.max(0, Math.floor(dmg));
}

/** What the target makes of a spell's damage: its own reduction (Golems) and Protection from the spell's school. */
export function spellDamageTaken(s: BattleState, spell: SpellInfo, u: Unit, dmg: number): number {
  const c = stats(s, u);
  // (A negative reduction is an aura on the enemies around: the Argali's, below.)
  const reduce = c.abilities.find((a) => a.type === "SPELL_DAMAGE_REDUCTION" && (a.val ?? 0) > 0 && (a.subtype === "any" || spell.schools.includes(a.subtype as never)));
  if (reduce) dmg *= 1 - (reduce.val ?? 0) / 100;
  // Argali (HotA): enemies next to them take 20% more spell damage, however many Argali stand there (the mod's spellDamageIncreaseAura).
  const aura = Math.max(
    0,
    ...s.units
      .filter((x) => alive(x) && x.side !== u.side && unitHexes(s, x).some((h) => unitHexes(s, u).some((g) => hexDistance(h, g) === 1)))
      .map((x) => -(stats(s, x).abilities.find((a) => a.type === "SPELL_DAMAGE_REDUCTION" && (a.val ?? 0) < 0)?.val ?? 0)),
  );
  if (aura) dmg *= 1 + aura / 100;
  // Protection from <school>: the target takes only a part. One protection only, however many of
  // the spell's schools are guarded (Magic Arrow: VCMI's CSpell::adjustRawDamage stops at the first).
  const prot = { air: SPELL.PROT_AIR, fire: SPELL.PROT_FIRE, water: SPELL.PROT_WATER, earth: SPELL.PROT_EARTH } as const;
  const kept = spell.schools.map((sc) => effectOf(u, prot[sc])?.value).filter((v): v is number => v !== undefined);
  if (kept.length) dmg *= Math.min(...kept) / 100;
  return dmg;
}

/** GENRLTXT 185: what the original says when a spell would touch no one. */
export const NO_ONE = "That spell will affect no one!";

/**
 * A spell that would touch no one wherever it is cast: Destroy Undead with no undead about,
 * Armageddon on the immune, an Expert mass spell with no stack to take it; and Land Mine when the
 * enemy began the battle with a stack on its native ground that the mines could hurt: it sees them
 * (heroes.thelazy.net Land Mine: "this spell cannot be cast if...").
 */
export function affectsNoOne(s: BattleState, side: Side, spell: SpellInfo): boolean {
  const def = COMBAT_SPELLS[spell.id];
  if (!def) return false;
  if (spell.id === SPELL.LAND_MINE) return s.units.some((u) => u.side !== side && !u.summoned && !u.machine && onNativeTerrain(s, u) && affects(s, spell, { ...u, count: Math.max(1, u.count) }));
  if (def.shape === "all" || ((def.massAtExpert || spell.id === SPELL.DISPEL) && mastery(s, side, spell) >= 3)) return !spellTargets(s, side, spell, 0).length;
  return false;
}

/** Whether `victim` may be given up for `raised` by Sacrifice: a living stack of the caster's own, not
 *  summoned, cloned, hypnotised or a war machine (heroes.thelazy.net Sacrifice, "Additional information"). */
export function sacrificeable(s: BattleState, side: Side, victim: Unit | undefined, raised?: Unit): boolean {
  return !!victim && victim !== raised && victim.side === side && controlSide(victim) === side && alive(victim) && !victim.machine && !victim.summoned && !victim.clone && isLiving(stats(s, victim));
}

/**
 * The side's hero casts `spell` at `hex` (and `dest` for Teleport). Spends mana,
 * applies the effect and reports one "spell" event.
 */
/** Fireball, Inferno, Frost Ring and Meteor Shower: aimed at any hex of the field, touching someone or not. */
export function landsAnywhere(id: number): boolean {
  const shape = COMBAT_SPELLS[id]?.shape;
  return shape === "ball1" || shape === "ball2" || shape === "ring";
}

/** Whether a spell aimed at this hex has somewhere to go: room for a wall, an obstacle to remove, a field hex for
 * a ball, else a stack it touches (the first pick of Teleport and Sacrifice; their landing is checked apart). */
export function aimsAt(s: BattleState, side: Side, spell: SpellInfo, hex: number): boolean {
  const shape = COMBAT_SPELLS[spell.id]?.shape;
  if (shape === "place") return placeHexes(s, side, hex, mastery(s, side, spell)).length > 0;
  if (shape === "obstacle") return obstacleAt(s, hex, mastery(s, side, spell)) >= 0;
  if (landsAnywhere(spell.id) && hex >= 0 && isPlayable(hexCol(hex), hexRow(hex))) return true;
  return spellTargets(s, side, spell, hex).length > 0;
}

export function castSpell(s: BattleState, side: Side, id: number, hex: number, events: BattleEvent[], dest?: number) {
  const spell = s.spells?.[id];
  const hero = s.sides[side].hero;
  const def = COMBAT_SPELLS[id];
  if (!spell || !def) throw new Refusal("unknown spell");
  if (magicBlocked(s, spell)) throw new Refusal("Magic is blocked here.");
  if (!creature) {
    if (!hero) throw new Refusal("no hero to cast");
    if (s.cast?.[side]) throw new Refusal("the hero has already cast a spell this round");
    if (!hero.spells?.includes(id)) throw new Refusal("not in the spellbook");
  }
  const cost = creature ? 0 : spellCost(s, side, spell);
  if (!creature && (hero!.mana ?? 0) < cost) throw new Refusal("not enough spell points");
  const m = mastery(s, side, spell);
  let targets = spellTargets(s, side, spell, hex);
  const fieldShape = def.shape === "field" || def.shape === "place" || def.shape === "obstacle";
  const fallenTowers: Unit[] = [];
  // Fireball, Inferno, Frost Ring and Meteor Shower may land on any hex, even where they touch no one
  // (VCMI: a LOCATION spell; its hint is "Cast %s" over a free hex).
  const area = landsAnywhere(id);
  if (def.shape !== "summon" && def.shape !== "all" && !fieldShape && !area && !targets.length) throw new Refusal("no valid target");
  if (area && !isPlayable(hexCol(hex), hexRow(hex))) throw new Refusal("no valid target");
  // A spell cast straight from the book (the whole field, an Expert mass spell) that would touch no one,
  // and Land Mine against an enemy fighting at home (GENRLTXT 185, as VCMI's NO_APPROPRIATE_TARGET).
  if (affectsNoOne(s, side, spell)) throw new Refusal(NO_ONE);
  if (id === SPELL.EARTHQUAKE && (!s.siege || side !== 0)) throw new Refusal("Earthquake only shakes the walls of a town you besiege.");
  if (def.shape === "place" && !placeHexes(s, side, hex, m).length) throw new Refusal("no room there");
  if (def.shape === "obstacle" && obstacleAt(s, hex, m) < 0) throw new Refusal("no obstacle there");
  // Sacrifice's victim and Teleport's landing checked before the spell points go (a refused cast costs nothing).
  const victim = def.shape === "sacrifice" && dest !== undefined ? unitAt(s, dest) : undefined;
  if (def.shape === "sacrifice" && !sacrificeable(s, side, victim, targets[0])) throw new Refusal("choose a living stack of yours to sacrifice");
  if (def.shape === "teleport" && (dest === undefined || !canTeleport(s, targets[0], dest, m))) throw new Refusal("can't teleport there");
  if (!creature) {
    hero!.mana = (hero!.mana ?? 0) - cost;
    // Familiars channel a fifth of the enemy hero's spent mana to their own hero.
    const foe = s.sides[1 - side].hero;
    if (foe && s.units.some((u) => alive(u) && u.side !== side && hasAbility(stats(s, u), "MANA_CHANNELING"))) foe.mana = (foe.mana ?? 0) + Math.floor(cost / 5);
    (s.cast ??= [false, false])[side] = true;
    (s.castLog ??= [[], []])[side].push(id);
  }
  const ev: Extract<BattleEvent, { e: "spell" }> = { e: "spell", side, spell: id, hex, units: [], damage: [], resisted: [] };
  // (Berserk is hostile too: magic resistance shrugs it off as any curse.)
  const negative = def.who === "enemy" || def.damage || id === SPELL.BERSERK;

  // Magic Mirror (the spell, or Faerie Dragons' own 20%): a hero's single-target hostile spell may
  // bounce to a random enemy of the caster; not Berserk (it targets an area) nor a mass spell that
  // happens to find one stack (heroes.thelazy.net Magic Mirror).
  if (!creature && def.shape === "single" && negative && targets.length === 1 && id !== SPELL.BERSERK && !(def.massAtExpert && m >= 3)) {
    const mirror = Math.max(effectOf(targets[0], SPELL.MAGIC_MIRROR)?.value ?? 0, ability(stats(s, targets[0]), "MAGIC_MIRROR")?.val ?? 0);
    if (mirror && random(s) < mirror / 100) {
      const pool = s.units.filter((u) => alive(u) && u.side === side && affects(s, spell, u));
      if (pool.length) {
        targets = [pool[Math.floor(random(s) * pool.length)]];
        ev.reflected = true;
      }
    }
  }

  const resisted = (u: Unit) => negative && u.side !== side && random(s) < resistChance(s, u);
  // One stack picked: named as the target (the original's "... on the Pikemen").
  const one = def.shape === "single" && targets.length === 1 ? targets[0] : null;
  const on = one ? { cr: one.creature, n: one.count } : undefined;
  s.log.push(creature ? LOG.creatureCasts(creature.cr !== undefined ? { cr: creature.cr, n: 2 } : creature.name, 2, id, on) : LOG.heroCasts(hero!.name, id, on));

  const hit = (u: Unit, dmg: number) => {
    const killed = takeDamage(s, u, dmg);
    ev.damage.push({ unit: u.id, damage: dmg, killed });
    if (!alive(u)) onDeath(s, u, events);
  };

  if (def.damage && def.shape === "chain") {
    // Chain Lightning: full damage, then half, quarter... to the nearest creature each time, friend or
    // foe, a random one of those as near (heroes.thelazy.net Chain Lightning). Four strikes, five from
    // advanced (SPTRAITS).
    const jumps = m >= 2 ? 5 : 4;
    let cur: Unit | undefined = targets[0];
    const done = new Set<number>();
    for (let i = 0; i < jumps && cur; i++) {
      done.add(cur.id);
      ev.units.push(cur.id);
      if (resisted(cur)) ev.resisted.push(cur.id);
      else hit(cur, Math.max(1, Math.floor(spellDamage(s, side, spell, cur) / 2 ** i)));
      const from: Unit = cur;
      const gap = (u: Unit) => Math.min(...unitHexes(s, from).flatMap((h) => unitHexes(s, u).map((g) => hexDistance(h, g))));
      const left = s.units.filter((u) => alive(u) && !done.has(u.id) && affects(s, spell, u)).map((u) => ({ u, d: gap(u) }));
      const near = Math.min(...left.map((x) => x.d));
      const nearest = left.filter((x) => x.d === near);
      cur = nearest.length > 1 ? nearest[Math.floor(random(s) * nearest.length)].u : nearest[0]?.u;
    }
  } else if (def.damage) {
    for (const u of targets) {
      ev.units.push(u.id);
      if (resisted(u)) ev.resisted.push(u.id);
      else hit(u, spellDamage(s, side, spell, u));
    }
  } else if (def.shape === "summon") {
    summon(s, side, spell, m, ev);
  } else if (fieldShape) {
    fieldSpell(s, side, spell, m, hex, fallenTowers);
  } else if (def.shape === "sacrifice") {
    // The victim dies for good; the fallen stack rises with (power + the victim's health + bonus) per victim.
    const u = targets[0];
    if (!victim) return;
    const hp = (power(s, side) + hpOf(s, victim) + spell.effect[m]) * victim.count;
    victim.count = 0;
    victim.sacrificed = true;
    releaseBound(s, victim);
    // (Its clone goes with it, as when it falls: heroes.thelazy.net Clone.)
    for (const x of s.units)
      if (x.clone && x.cloneOf === victim.id && alive(x)) {
        x.count = 0;
        x.firstHp = 0;
        x.sacrificed = true;
        releaseBound(s, x);
        fallenTowers.push(x);
      }
    ev.units.push(u.id, victim.id);
    const revived = heal(s, u, hp);
    s.log.push(LOG.ours("sacrificed", [{ cr: victim.creature, n: 2 }, revived, { cr: u.creature, n: 2 }]));
  } else if (def.shape === "teleport") {
    const u = targets[0];
    u.pos = dest!;
    // Teleport frees a stack the Dendroids hold; Dendroids teleported away let go of theirs (it ends when they move).
    if (u.effects) u.effects = u.effects.filter((e) => e.spell !== SPELL.BIND);
    releaseBound(s, u);
    ev.units.push(u.id);
  } else {
    for (const u of targets) {
      ev.units.push(u.id);
      if (resisted(u)) {
        ev.resisted.push(u.id);
        continue;
      }
      applyEffect(s, side, spell, m, u, ev);
    }
  }
  // Expert Dispel also clears the spells laid on the field (fire walls, force fields, mines, quicksand; the moat stays).
  if (id === SPELL.DISPEL && m >= 3 && s.hazards) s.hazards = s.hazards.filter((z) => z.hexes.some((h) => !!s.siege?.moat?.hexes.includes(h)));
  for (const id of ev.resisted) {
    const u = s.units[id];
    s.log.push(LOG.resists(u.creature, u.count));
  }
  // GENRLTXT 376 and 378 / 379, as the client shows them while the spell plays: "The Ice Bolt does
  // 150 damage. 4 Swordsmen perish." (the stack's name when one stack lost creatures).
  if (ev.damage.length) {
    const total = ev.damage.reduce((a, d) => a + d.damage, 0);
    const fallen = ev.damage.filter((d) => d.killed);
    const killed = fallen.reduce((a, d) => a + d.killed, 0);
    s.log.push(LOG.spellDamage(id, total, killed, fallen.length === 1 ? s.units[fallen[0].unit].creature : LOG.ours(killed === 1 ? "creature" : "creatures")));
  }
  events.push(ev);
  // (Fallen towers' archers and a sacrificed stack's clone.)
  for (const t of fallenTowers) events.push({ e: "death", unit: t.id });
}

/** Effects that stay through Dispel, Cure and Anti-Magic: Disrupting Ray, poison and acid. */
const LASTING = new Set<number>([SPELL.DISRUPTING_RAY, SPELL.POISON, SPELL.ACID_BREATH]);

/** Instant and timed non-damage spells. */
function applyEffect(s: BattleState, side: Side, spell: SpellInfo, m: number, u: Unit, ev: Extract<BattleEvent, { e: "spell" }>) {
  const sp = power(s, side);
  const value = spell.effect[m];
  switch (spell.id) {
    case SPELL.DISPEL:
      // Everything but Disrupting Ray, poison and acid (SPTRAITS: "except Disrupting Ray and poison").
      u.effects = (u.effects ?? []).filter((e) => LASTING.has(e.spell));
      return;
    case SPELL.CURE: {
      // The negative effects, but not Disrupting Ray, acid or the Dendroids' binding (SPTRAITS);
      // Hypnotize only at basic and advanced (heroes.thelazy.net Cure).
      // (HotA's Cure "restores health decremented with poison": the poison goes.)
      u.effects = (u.effects ?? []).filter((e) => isPositive(e.spell) || (LASTING.has(e.spell) && e.spell !== SPELL.POISON) || e.spell === SPELL.BIND || (m >= 3 && e.spell === SPELL.HYPNOTIZE));
      const top = hpOf(s, u);
      const more = 1 + (creature ? 0 : healSpecialtyPercent(s.sides[side].hero, spell.id, stats(s, u).level) / 100);
      u.firstHp = Math.min(top, u.firstHp + Math.floor((spell.power * sp + value) * more));
      return;
    }
    case SPELL.RESURRECTION:
    case SPELL.ANIMATE_DEAD: {
      // Alamar, Jeddite, Thant (HotA): 5% more for every N hero levels, N the target's level.
      const revived = heal(s, u, raiseAmount(s, side, spell, u));
      // Basic Resurrection brings them back for this battle only (SPTRAITS; HotA: the real ones fall first).
      if (spell.id === SPELL.RESURRECTION && m <= 1 && revived > 0) u.borrowed = (u.borrowed ?? 0) + revived;
      if (revived) s.log.push(LOG.rise(revived, u.creature));
      return;
    }
    case SPELL.DISRUPTING_RAY: {
      // Stacks, and lasts the whole battle; Aenain's takes 2 more.
      const dv = creature ? value : enchantSpecialty(s.sides[side].hero, spell.id, stats(s, u).level, value);
      const e = effectOf(u, SPELL.DISRUPTING_RAY);
      if (e) e.value += dv;
      else (u.effects ??= []).push({ spell: spell.id, rounds: 999, mastery: m, value: dv });
      return;
    }
    case SPELL.CLONE: {
      // Eovacius: two copies the first time (one if there's room for only one).
      const copies = doubleClone(s.sides[side].hero) && !s.sides[side].cloned ? 2 : 1;
      s.sides[side].cloned = true;
      for (let k = 0; k < copies; k++) {
        // It lasts as a timed spell does (SP rounds and the Conjuring artifacts; VCMI's clone marker):
        // gone with the new round once the marker wears off or is dispelled.
        const copy: Unit = { ...structuredClone(u), id: s.units.length, clone: true, cloneOf: u.id, summoned: true, effects: [{ spell: SPELL.CLONE, rounds: spellRounds(s, side, spell), mastery: m, value: 0 }] };
        const spot = freeHexNear(s, copy, u.pos);
        if (spot < 0) return;
        copy.pos = spot;
        copy.acted = true;
        s.units.push(copy);
        (ev.summoned ??= []).push(copy.id);
      }
      return;
    }
  }
  // Timed spells: SP rounds (a creature's own duration); casting again refreshes.
  // Collar, Ring and Cape of Conjuring (and the Ring of the Magi) make spells last longer.
  // Berserk lasts until the stack attacks (rules.ts lifts it), 255 rounds if it never can (heroes.thelazy.net Berserk).
  // Frenzy lasts through the stack's next turn and until its turn after that begins (rules.ts ends it;
  // the rounds are only a backstop).
  const rounds = spell.id === SPELL.BERSERK ? 255 : spell.id === SPELL.FRENZY ? 3 : spellRounds(s, side, spell);
  u.effects = (u.effects ?? []).filter((e) => e.spell !== spell.id);
  // Opposites cancel each other: Haste/Slow, Bless/Curse, Bloodlust/Weakness, Mirth/Sorrow, Fortune/Misfortune (VCMI's "counters").
  const OPPOSITE: Record<number, number> = {
    [SPELL.HASTE]: SPELL.SLOW, [SPELL.SLOW]: SPELL.HASTE, [SPELL.BLESS]: SPELL.CURSE, [SPELL.CURSE]: SPELL.BLESS,
    [SPELL.BLOODLUST]: SPELL.WEAKNESS, [SPELL.WEAKNESS]: SPELL.BLOODLUST,
    [SPELL.MIRTH]: SPELL.SORROW, [SPELL.SORROW]: SPELL.MIRTH, [SPELL.FORTUNE]: SPELL.MISFORTUNE, [SPELL.MISFORTUNE]: SPELL.FORTUNE,
  };
  if (OPPOSITE[spell.id] !== undefined) u.effects = u.effects.filter((e) => e.spell !== OPPOSITE[spell.id]);
  // Anti-Magic takes away the negative spells it would have stopped (all of them at expert), Disrupting Ray aside.
  if (spell.id === SPELL.ANTI_MAGIC) u.effects = u.effects.filter((e) => isPositive(e.spell) || LASTING.has(e.spell) || (s.spells?.[e.spell]?.level ?? 0) >= value);
  // Berserk breaks Hypnotize and Hypnotize breaks Berserk (SPTRAITS).
  if (spell.id === SPELL.BERSERK) u.effects = u.effects.filter((e) => e.spell !== SPELL.HYPNOTIZE);
  if (spell.id === SPELL.HYPNOTIZE) u.effects = u.effects.filter((e) => e.spell !== SPELL.BERSERK);
  // The caster's enchantment specialty.
  const v = creature ? value : enchantSpecialty(s.sides[side].hero, spell.id, stats(s, u).level, value);
  // Frenzy: the turn the stack is in (it is acting, or waited) is its closest one, else its next.
  const turns = spell.id === SPELL.FRENZY ? (s.active === u.id || (u.waited && !u.acted) ? 1 : 2) : undefined;
  u.effects.push({ spell: spell.id, rounds, mastery: m, value: v, ...(turns ? { turns } : {}) });
}

/**
 * Can Teleport (at this mastery) put the stack's head on `dest`? A free spot; in a siege, basic can't
 * cross the walls or the moat, advanced the walls (SPTRAITS; VCMI's teleport isWallPassable /
 * isMoatPassable and battleHasPenaltyOnLine: only between the two sides of the wall, along the
 * shortest way, through a wall section still standing or the moat).
 */
export function canTeleport(s: BattleState, u: Unit, dest: number, m: number): boolean {
  if (!canOccupy(s, u, unitHexes(s, u, dest))) return false;
  if (!s.siege || m >= 3 || insideWalls(u.pos) === insideWalls(dest)) return true;
  // (The drawbridge's hex, while the gate stands: VCMI's GATE part, 96.)
  const walls = [...wallBlocked(s.siege), ...(s.siege.walls.gate ? [96] : [])];
  for (let h = u.pos; h !== dest; ) {
    // VCMI's getShortestPath: the neighbour nearest the destination, toward its side on a tie.
    const right = hexCol(dest) >= hexCol(u.pos);
    h = neighbours(h).sort((a, b) => hexDistance(a, dest) - hexDistance(b, dest) || (right ? hexCol(b) - hexCol(a) : hexCol(a) - hexCol(b)))[0];
    if (h === dest) break;
    if (walls.includes(h)) return false;
    if (m < 2 && inMoat(s, h)) return false;
  }
  return true;
}

/** How many rounds a timed spell lasts: SP (a creature's own duration), more with the Conjuring artifacts and the specialists. */
function spellRounds(s: BattleState, side: Side, spell: SpellInfo): number {
  return creature ? creature.duration : power(s, side) + heroBonus(s, side, "SPELL_DURATION") + spellDurationSpecialty(s.sides[side].hero, spell.id);
}

/** The hex next to `h` on the row above, toward the top right or top left (-1 off the field). */
function upward(h: number, dir: "TR" | "TL"): number {
  if (h < 0) return -1;
  const c = hexCol(h);
  const r = hexRow(h);
  const dc = dir === "TR" ? (r % 2 === 0 ? 1 : 0) : r % 2 === 0 ? 0 : -1;
  return isPlayable(c + dc, r - 1) ? hexAt(c + dc, r - 1) : -1;
}

/** Hexes a Force Field or Fire Wall cast at `hex` covers (two, three from advanced), if they're all free. */
export function placeHexes(s: BattleState, side: Side, hex: number, m: number): number[] {
  const [first, second] = side === 0 ? (["TR", "TL"] as const) : (["TL", "TR"] as const);
  const a = upward(hex, first);
  const hexes = m >= 2 ? [hex, a, upward(a, second)] : [hex, a];
  const blocked = (h: number) => h < 0 || s.blocked.includes(h) || !!unitAt(s, h) || (s.hazards ?? []).some((z) => z.kind === "forceField" && z.hexes.includes(h));
  return hexes.some(blocked) ? [] : hexes;
}

/** The index of the obstacle at `hex` that Remove Obstacle can clear (-1 if none). */
export function obstacleAt(s: BattleState, hex: number, m: number): number {
  const field = BATTLEFIELDS.find((f) => f.id === s.field);
  if (field) {
    const i = s.obstacles.findIndex((o) => !obstacleType(o.type)?.absolute && blockedHexes(field, [o]).includes(hex));
    if (i >= 0) return i;
  }
  // Advanced clears Fire Walls, expert any spell on the field.
  const z = (s.hazards ?? []).findIndex((h) => h.hexes.includes(hex) && (m >= 3 || (m >= 2 && h.kind === "fireWall")));
  return z >= 0 ? 1000 + z : -1;
}

/** Quicksand, Land Mines, Earthquake, Force Field, Fire Wall and Remove Obstacle. */
function fieldSpell(s: BattleState, side: Side, spell: SpellInfo, m: number, hex: number, fallen: Unit[]) {
  const hazards = (s.hazards ??= []);
  // Fire Wall specialists burn twice as hard; Sorcery, the Orb of Tempestuous Fire and Adrienne add as
  // to any fire spell (heroes.thelazy.net Fire Wall, Land Mine: "Damage Increases").
  const boost = creature ? 1 : sorcery(s, side) * schoolBoost(s, side, spell.schools);
  const damage = Math.floor((spell.power * power(s, side) + spell.effect[m]) * boost * (1 + spellDamageSpecialty(s.sides[side].hero, spell.id) / 100));
  switch (spell.id) {
    case SPELL.QUICKSAND:
    case SPELL.LAND_MINE: {
      // 4 patches (6 advanced, 8 expert) on free hexes, hidden from the enemy.
      const free = [...Array(HEX_COUNT).keys()].filter((h) => isPlayable(hexCol(h), hexRow(h)) && !s.blocked.includes(h) && !unitAt(s, h) && !hazards.some((z) => z.hexes.includes(h)));
      for (let i = 0; i < [4, 4, 6, 8][m] && free.length; i++) {
        const h = free.splice(Math.floor(random(s) * free.length), 1)[0];
        hazards.push({ kind: spell.id === SPELL.QUICKSAND ? "quicksand" : "mine", hexes: [h], side, rounds: -1, damage: spell.id === SPELL.LAND_MINE ? damage : undefined });
      }
      return;
    }
    case SPELL.FORCE_FIELD:
    case SPELL.FIRE_WALL:
      hazards.push({ kind: spell.id === SPELL.FORCE_FIELD ? "forceField" : "fireWall", hexes: placeHexes(s, side, hex, m), side, rounds: 2, damage: spell.id === SPELL.FIRE_WALL ? damage : undefined });
      return;
    case SPELL.EARTHQUAKE: {
      // Two points (three advanced, four expert) drawn among the walls, towers and the drawbridge, no miss.
      const siege = s.siege!;
      // (A fallen tower's archers die after the quake is shown.)
      for (const part of earthquakeHits(siege.walls, [2, 2, 3, 4][m], () => random(s))) {
        const { tower } = damageWall(s, part, 1);
        if (tower) fallen.push(tower);
      }
      return;
    }
    case SPELL.REMOVE_OBSTACLE: {
      const i = obstacleAt(s, hex, m);
      if (i >= 1000) hazards.splice(i - 1000, 1);
      else if (i >= 0) {
        s.obstacles.splice(i, 1);
        const field = BATTLEFIELDS.find((f) => f.id === s.field)!;
        s.blocked = blockedHexes(field, s.obstacles);
      }
      return;
    }
  }
}

export function freeHexNear(s: BattleState, u: Unit, near: number): number {
  const order = [...Array(HEX_COUNT).keys()].sort((a, b) => hexDistance(near, a) - hexDistance(near, b));
  return order.find((h) => canOccupy(s, u, unitHexes(s, u, h))) ?? -1;
}

/**
 * HotA summons Fire and Earth Elementals by health: this many hit points per spell power
 * (the mod's summonByHealth, [2/2/2.5/3] x SP of them).
 */
const SUMMON_HP: Record<number, [number, number, number, number]> = { [SPELL.FIRE_ELEMENTAL]: [70, 70, 88, 105], [SPELL.EARTH_ELEMENTAL]: [80, 80, 100, 120] };

/** How many elementals the spell brings. */
export function summonCount(s: BattleState, side: Side, spell: SpellInfo, c: CreatureStats, m: number): number {
  const byHp = SUMMON_HP[spell.id];
  return byHp ? Math.floor((byHp[m] * power(s, side)) / c.hp) : spell.effect[m] * power(s, side);
}

/** Elementals next to the hero's corner (HotA lifted SoD's one kind per battle). */
function summon(s: BattleState, side: Side, spell: SpellInfo, m: number, ev: Extract<BattleEvent, { e: "spell" }>) {
  const creature = SUMMONED[spell.id];
  const c = s.creatures[creature];
  if (!c) throw new Refusal("can't summon here");
  const count = summonCount(s, side, spell, c, m);
  const existing = s.units.find((u) => u.side === side && u.summoned && !u.clone && u.creature === creature && alive(u));
  if (existing) {
    existing.count += count;
    existing.initialCount += count;
    ev.units.push(existing.id);
    return;
  }
  const u: Unit = {
    id: s.units.length,
    side,
    creature,
    count,
    firstHp: c.hp,
    pos: 0,
    shots: c.shots,
    retaliations: 0,
    acted: true,
    waited: false,
    defending: false,
    hadMorale: false,
    initialCount: count,
    summoned: true,
  };
  const spot = freeHexNear(s, u, side === 0 ? 1 + 5 * 17 : 15 + 5 * 17);
  if (spot < 0) throw new Refusal("no room to summon");
  u.pos = spot;
  s.units.push(u);
  (ev.summoned ??= []).push(u.id);
}
