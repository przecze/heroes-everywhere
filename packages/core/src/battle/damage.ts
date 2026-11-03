// Damage in battle: attack and defense with everything that changes them, the damage a blow does
// (the preview's range and the roll), health and what a blow kills.
import { ARCHERY, ARMORER, OFFENCE, skillLevel } from "../skills.ts";
import { blessSpecialtyPercent, creatureBonus, skillFactor, specialtyStat } from "../specialty.ts";
import { SPELL } from "../spells.ts";
import { type CreatureStats, ability, hasAbility } from "../creatures.ts";
import { hexDistance } from "./hex.ts";
import { randInt, random } from "../rng.ts";
import { ruleOn } from "../adventure/gameRules.ts";
import { TOWER_POS, inMoat, moatHolds, towerDamageRange, wallPenalty } from "./siege.ts";
import { type BattleState, type Side, type Unit, type UnitEffect } from "./state.ts";
import { groundDefense } from "./ground.ts";
import { alive, creaturesBonus, effectOf, gainRunes, hasHeroBonus, heroBonus, onNativeTerrain, runeBonus, stats } from "./rules.ts";
import { unitHexes } from "./reach.ts";

// ---- damage --------------------------------------------------------------

/** Creature attack plus the commanding hero's. */
/** Attack with the hero and spells (Bloodlust counts in melee, Precision at range). */
export function attackOf(s: BattleState, u: Unit, ranged?: boolean): number {
  const c0 = stats(s, u);
  const hero = s.sides[u.side].hero;
  // Creature specialists: +5% per (hero level / creature level); flat specialty bonuses.
  let a = specialtyStat(hero, c0, "attack");
  a += (hero?.primary[0] ?? 0) + runeBonus(s, u).attack + (onNativeTerrain(s, u) ? 1 : 0) + creaturesBonus(s, u, "attack");
  a += effectOf(u, SPELL.PRAYER)?.value ?? 0;
  a -= effectOf(u, SPELL.WEAKNESS)?.value ?? 0;
  a -= effectOf(u, SPELL.DISEASE)?.value ?? 0;
  if (ranged === false) a += effectOf(u, SPELL.BLOODLUST)?.value ?? 0;
  if (ranged === true) a += effectOf(u, SPELL.PRECISION)?.value ?? 0;
  // Frenzy: defense turns into attack.
  const frenzy = effectOf(u, SPELL.FRENZY);
  if (frenzy) a += Math.floor((baseDefense(s, u) * frenzy.value) / 100);
  return Math.max(0, a);
}

function baseDefense(s: BattleState, u: Unit): number {
  const c0 = stats(s, u);
  const hero = s.sides[u.side].hero;
  let d = specialtyStat(hero, c0, "defence");
  d += (hero?.primary[1] ?? 0) + runeBonus(s, u).defense + (onNativeTerrain(s, u) ? 1 : 0) + creaturesBonus(s, u, "defence");
  d += effectOf(u, SPELL.STONE_SKIN)?.value ?? 0;
  d += effectOf(u, SPELL.PRAYER)?.value ?? 0;
  d -= effectOf(u, SPELL.DISRUPTING_RAY)?.value ?? 0;
  d -= effectOf(u, SPELL.DISEASE)?.value ?? 0;
  d -= effectOf(u, SPELL.ACID_BREATH)?.value ?? 0;
  // Cracked Ice (HotA): -5 for everyone.
  d += u.machine ? 0 : groundDefense(s);
  return Math.max(0, d);
}

/**
 * A shot from beyond 10 hexes does half damage, unless the shooter (Sharpshooters) or its hero (the Golden Bow) ignores distance.
 * A two-hex target is in range when either of its hexes is (VCMI's battleHasDistancePenalty).
 */
export function rangePenalty(s: BattleState, a: Unit, d: Unit): boolean {
  return unitHexes(s, d).every((h) => hexDistance(a.pos, h) > 10) && !hasAbility(stats(s, a), "NO_DISTANCE_PENALTY") && !hasHeroBonus(s, a.side, "NO_DISTANCE_PENALTY");
}

export function defenseOf(s: BattleState, u: Unit): number {
  if (effectOf(u, SPELL.FRENZY)) return 0;
  return standingDefense(s, u) + (u.defending ? defendBonus(s, u) : 0);
}

/** Defense before the Defend bonus: anyone standing in the moat has 3 less (VCMI's moats; heroes.thelazy.net Moat: defenders too). */
function standingDefense(s: BattleState, u: Unit): number {
  return Math.max(0, baseDefense(s, u) - (s.siege?.moat && moatHolds(s, u) && unitHexes(s, u).some((h) => inMoat(s, h)) ? 3 : 0));
}

/** What Defend adds: +20% Defense, at least 1; HotA War Mammoths +100% (the mod's 80 more, limited to defending). */
export function defendBonus(s: BattleState, u: Unit): number {
  if (effectOf(u, SPELL.FRENZY)) return 0;
  const pct = 20 + (stats(s, u).abilities.find((a) => a.type === "PRIMARY_SKILL" && a.subtype === "defenceWhileDefending")?.val ?? 0);
  return Math.max(1, Math.round((standingDefense(s, u) * pct) / 100));
}

export const isLiving = (c: CreatureStats) => !hasAbility(c, "UNDEAD") && !hasAbility(c, "NON_LIVING") && !hasAbility(c, "GARGOYLE");

/** Immune to mind spells: the undead, the non-living, HotA's mechanical creatures, war machines, and those with the immunity of their own. */
export const mindImmune = (c: CreatureStats, u?: Unit) =>
  !!u?.machine || hasAbility(c, "MIND_IMMUNITY") || hasAbility(c, "NON_LIVING") || hasAbility(c, "UNDEAD") || hasAbility(c, "MECHANICAL");

/**
 * Azure Dragons' fear doesn't reach other Azure Dragons, golems, elementals, the mechanical, the undead or war
 * machines (heroes.thelazy.net Azure Dragon), nor anyone else immune to mind spells.
 */
export const fearless = (c: CreatureStats, u?: Unit) => mindImmune(c, u) || c.abilities.some((a) => a.type === "FEARFUL" && a.val === 0);

/** Out of action: blinded, turned to stone or paralysed. */
/** Meditating (HotA Couatls): attacks and spells can't touch it until its first turn in the next round (heroes.thelazy.net Couatl). */
export const meditating = (_s: BattleState, u: Unit) => u.meditating !== undefined;
export const disabled = (u: Unit) => !!(effectOf(u, SPELL.BLIND) || effectOf(u, SPELL.STONE_GAZE) || effectOf(u, SPELL.PARALYZE) || effectOf(u, SPELL.FROZEN));

/** Number of successes in n tries at probability p. */
export function binomial(s: BattleState, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (random(s) < p) k++;
  return k;
}

/**
 * Multiplier from all modifiers except the base roll:
 * (1 + I1 + I5) x (1 - R1) x (1 - R5), see heroes.thelazy.net/index.php/Damage.
 */
function damageFactor(s: BattleState, a: Unit, d: Unit, ranged: boolean, moved: number, deathBlow: boolean | number = false, parts?: { raise: number }): number {
  const ac = stats(s, a);
  // Nixes (HotA) blunt the attack of whoever strikes them.
  const blunt = ability(stats(s, d), "ENEMY_ATTACK_REDUCTION")?.val ?? 0;
  let att = Math.floor(attackOf(s, a, ranged) * (1 - blunt / 100));
  // Slayer: +8 attack against big creatures (King 1 at basic, up to King 3 at expert).
  const slayer = effectOf(a, SPELL.SLAYER);
  // (A king without a level in the data, the dragons, is King 1: Slayer at basic.)
  const kingAb = ability(stats(s, d), "KING");
  const king = kingAb ? Math.max(1, kingAb.val ?? 1) : 0;
  if (slayer && king && king <= Math.max(1, slayer.mastery)) att += slayer.value;
  // Behemoths ignore part of the target's defense; a shooter's (HotA's Halfling Grenadiers) only with its shots.
  const ignore = !ranged && hasAbility(ac, "SHOOTER") ? 0 : (ability(ac, "ENEMY_DEFENCE_REDUCTION")?.val ?? 0);
  const def = Math.floor(defenseOf(s, d) * (1 - ignore / 100));
  let inc = att > def ? 0.05 * Math.min(att - def, 60) : 0;
  const r1 = def > att ? 0.025 * Math.min(def - att, 28) : 0;
  // Jousting: +5% per hex travelled, cancelled by Pikemen/Halberdiers.
  if (!ranged && hasAbility(ac, "JOUSTING") && !hasAbility(stats(s, d), "CHARGE_IMMUNITY")) inc += 0.05 * moved;
  // Hatred: +50% against the hated creature.
  const hate = ac.abilities.find((x) => x.type === "HATE" && x.subtype === stats(s, d).key);
  if (hate) inc += (hate.val ?? 50) / 100;
  // Death Blow doubles the base damage (I5 = 1.0); the Cannon's Artillery adds 1 or 2 the same way.
  inc += +deathBlow;
  // I2: Offense (melee) or Archery (ranged) of the attacker's hero; R2: Armorer of the defender's.
  const ah = s.sides[a.side].hero;
  const dh = s.sides[d.side].hero;
  inc += ranged ? ARCHERY[skillLevel(ah?.skills, "archery")] * skillFactor(ah, "archery") : OFFENCE[skillLevel(ah?.skills, "offence")] * skillFactor(ah, "offence");
  // Haspids' Revenge (HotA): the fewer left, the harder they hit.
  if (hasAbility(ac, "REVENGE")) {
    const hp = hpOf(s, a);
    // (sqrt(x - 1), not sqrt(x) - 1: heroes.thelazy.net Haspid, 12 left of 100 hit as an unharmed 43; a stack
    // cut to half hits as hard as it did whole; VCMI's revenge.lua.)
    inc += Math.sqrt(Math.max(0, ((a.initialCount + 1) * hp) / (totalHp(s, a) + hp) - 1));
  }
  // Bows, bowstrings and arrows add to Archery.
  if (ranged && !a.machine) inc += heroBonus(s, a.side, "PERCENTAGE_DAMAGE_BOOST", "damageTypeRanged") / 100;
  if (parts) parts.raise = 1 + inc;
  let f = (1 + inc) * (1 - r1) * (1 - ARMORER[skillLevel(dh?.skills, "armorer")] * skillFactor(dh, "armorer"));
  // Shield (melee) and Air Shield (ranged): the target takes only a part.
  const guard = effectOf(d, ranged ? SPELL.AIR_SHIELD : SPELL.SHIELD);
  if (guard) f *= guard.value / 100;
  // R5: range penalty beyond 10 hexes, or a shooter forced into melee.
  if (ranged && rangePenalty(s, a, d)) f *= 0.5;
  // Stone takes half the damage.
  if (effectOf(d, SPELL.STONE_GAZE)) f *= 0.5;
  // Psychic Elementals do half damage to the mind-immune, Magic Elementals to the immune to all spells (heroes.thelazy.net).
  if (ac.key === "psychicElemental" && mindImmune(stats(s, d), d)) f *= 0.5;
  if (ac.key === "magicElemental" && (ability(stats(s, d), "LEVEL_SPELL_IMMUNITY")?.val ?? 0) >= 5) f *= 0.5;
  // Frozen by a Great Shaman's shot: a quarter more damage taken.
  if (effectOf(d, SPELL.FROZEN)) f *= 1.25;
  // Shooting over the town walls.
  if (ranged && !hasAbility(ac, "NO_WALL_PENALTY") && !hasHeroBonus(s, a.side, "NO_WALL_PENALTY") && wallPenalty(s, a, d)) f *= 0.5;
  if (!ranged && hasAbility(ac, "SHOOTER") && !hasAbility(ac, "NO_MELEE_PENALTY")) f *= 0.5;
  if (a.numbed) f *= 0.25;
  // Forgetfulness: half the stack forgets its shots at basic; HotA's advanced and expert stop the
  // shots and half forget their melee blows. (A specialist's spell: more of them, its value.)
  const forgot = effectOf(a, SPELL.FORGETFULNESS);
  if (forgot && (ranged ? forgot.mastery <= 1 : forgot.mastery >= 2)) f *= Math.max(0, 0.5 - (forgot.value ?? 0) / 100);
  return f;
}

/** Average damage, for the AI and the hover preview. */
export function expectedDamage(s: BattleState, a: Unit, d: Unit, ranged: boolean, moved = 0): { min: number; max: number } {
  const c = stats(s, a);
  // Arrow towers and the Ballista have their own damage (as rollDamage); the preview showed 1-1.
  if (a.machine === "tower" && s.siege) {
    const [min, max] = towerDamageRange(s.siege, a.pos === TOWER_POS.keep);
    const f = ruleOn(s.rules, "towerSkills") ? damageFactor(s, a, d, true, moved) : 1;
    return { min: Math.max(1, Math.floor(min * f)), max: Math.max(1, Math.floor(max * f)) };
  }
  if (a.machine === "ballista") {
    const hero = s.sides[a.side].hero;
    const k = (hero?.primary[0] ?? 0) + 5;
    // Expert Artillery always doubles (a Death Blow's bonus term); below it, the double is a chance.
    const art = skillLevel(hero?.skills, "artillery");
    const f = damageFactor(s, a, d, ranged, moved, art >= 3);
    const top = damageFactor(s, a, d, ranged, moved, art > 0);
    return { min: Math.max(1, Math.floor((c.minDamage || 2) * k * f)), max: Math.max(1, Math.floor((c.maxDamage || 3) * k * top)) };
  }
  if (a.machine === "cannon") {
    const hero = s.sides[a.side].hero;
    const k = (hero?.primary[0] ?? 0) + 1;
    const f = damageFactor(s, a, d, ranged, moved, CANNON_ARTILLERY[skillLevel(hero?.skills, "artillery")]);
    return { min: Math.max(1, Math.floor((c.minDamage || 4) * k * f)), max: Math.max(1, Math.floor((c.maxDamage || 7) * k * f)) };
  }
  const f = damageFactor(s, a, d, ranged, moved);
  const bless = effectOf(a, SPELL.BLESS);
  const curse = effectOf(a, SPELL.CURSE);
  const extra = creatureBonus(s.sides[a.side].hero, a.creature, "damage", hasAbility(stats(s, a), "DRAGON_NATURE"));
  // (Bless from advanced: the maximum + 1, SPTRAITS; VCMI's alwaysMaximumDamage val 1.)
  const plus = bless?.value ? 1 : 0;
  const lo = (bless ? c.maxDamage + plus : cursed(c.minDamage, curse)) + extra;
  const hi = (curse ? cursed(c.minDamage, curse) : c.maxDamage + plus) + extra;
  const blessed = bless ? 1 + blessSpecialtyPercent(s.sides[a.side].hero, c.level) / 100 : 1;
  return {
    min: Math.max(1, Math.floor(lo * blessed * a.count * f)),
    max: Math.max(1, Math.floor(hi * blessed * a.count * f)),
  };
}

/**
 * A cursed creature's damage: its minimum, one less from Advanced (never under 1). The manual's "80% of
 * the minimum" is wrong (heroes.thelazy.net Curse; VCMI's ALWAYS_MINIMUM_DAMAGE 0 / 1).
 */
const cursed = (min: number, curse: UnitEffect | undefined) => Math.max(1, min - (curse?.value ? 1 : 0));

/** The Cannon's bonus term by the hero's Artillery: none, none, +100%, +200%. */
const CANNON_ARTILLERY = [0, 0, 1, 2];

export function rollDamage(s: BattleState, a: Unit, d: Unit, ranged: boolean, moved: number, deathBlow: boolean, raw?: { before: number }): number {
  const c = stats(s, a);
  // The blow before the target's defenses (only the raising terms), for Fire Shield (heroes.thelazy.net Fire Shield).
  const parts = { raise: 1 };
  const done = (base: number, f: number) => {
    if (raw) raw.before = Math.max(1, Math.floor(base * parts.raise));
    return Math.max(1, Math.floor(base * f));
  };
  // Arrow towers: their own damage from the town's structures; defense doesn't count. HotA
  // (heroes.thelazy.net Arrow Tower): their 10 Attack and the defending hero's add as any attack's,
  // as does Archery; Armorer, Air Shield and stone take off as from any shot.
  if (a.machine === "tower" && s.siege) {
    const [lo, hi] = towerDamageRange(s.siege, a.pos === TOWER_POS.keep);
    if (!ruleOn(s.rules, "towerSkills")) return done(randInt(s, lo, hi), 1);
    return done(randInt(s, lo, hi), damageFactor(s, a, d, true, moved, false, parts));
  }
  // Ballista (HotA): 2-3 x (hero's attack + 5); Artillery may double it (50% / 75% / 100%).
  if (a.machine === "ballista") {
    const hero = s.sides[a.side].hero;
    const base = randInt(s, c.minDamage || 2, c.maxDamage || 3) * ((hero?.primary[0] ?? 0) + 5);
    const art = skillLevel(hero?.skills, "artillery");
    // The double is a bonus term as the Death Blow's (heroes.thelazy.net Damage, I5), added to the attack's, not a multiplier on top.
    const twice = art > 0 && random(s) < [0, 0.5, 0.75, 1][art];
    return done(base, damageFactor(s, a, d, ranged, moved, twice, parts));
  }
  // The Cannon (HotA): 4-7 x (hero's attack + 1); Advanced Artillery adds +100%, Expert +200%, as bonus
  // terms beside the attack's (heroes.thelazy.net War Machine, the Ballista vs. Cannon table).
  if (a.machine === "cannon") {
    const hero = s.sides[a.side].hero;
    const base = randInt(s, c.minDamage || 4, c.maxDamage || 7) * ((hero?.primary[0] ?? 0) + 1);
    return done(base, damageFactor(s, a, d, ranged, moved, CANNON_ARTILLERY[skillLevel(hero?.skills, "artillery")], parts));
  }
  // Big stacks roll ten times and scale, like the original.
  const rolls = Math.min(a.count, 10);
  let base = 0;
  // Bless: always the maximum (from advanced the maximum + 1: HotA's SPTRAITS "greater than their
  // normal maximum damage by 1", heroes.thelazy.net Bless); Curse: always the minimum (1 less from advanced, never under 1).
  const bless = effectOf(a, SPELL.BLESS);
  const curse = effectOf(a, SPELL.CURSE);
  for (let i = 0; i < rolls; i++) base += bless ? c.maxDamage + (bless.value ? 1 : 0) : curse ? cursed(c.minDamage, curse) : randInt(s, c.minDamage, c.maxDamage);
  // Specialty damage (e.g. Kilgor's Behemoths: +10 each).
  base += rolls * creatureBonus(s.sides[a.side].hero, a.creature, "damage", hasAbility(stats(s, a), "DRAGON_NATURE"));
  // Bless specialists (Adela): +3% per hero level / creature level for blessed stacks.
  if (bless) base *= 1 + blessSpecialtyPercent(s.sides[a.side].hero, c.level) / 100;
  if (a.count > 10) base = (base * a.count) / 10;
  return done(base, damageFactor(s, a, d, ranged, moved, deathBlow, parts));
}

/** Does this side's hero own the war machine (artifact id), on the field or left out of a creature bank's fight? */
export function ownsMachine(s: BattleState, side: Side, art: number): boolean {
  const h = s.sides[side]?.hero;
  return !!(h?.machines?.includes(art) || h?.machinesAway?.includes(art));
}

/**
 * Shooters never run out while the side's Ammo Cart stands, or while it waits outside a creature
 * bank's fight (HotA: its passive help still counts there, heroes.thelazy.net Ammo Cart).
 */
export function suppliedByCart(s: BattleState, side: Side): boolean {
  return s.units.some((x) => alive(x) && x.side === side && x.machine === "cart") || !!s.sides[side]?.hero?.machinesAway?.includes(5);
}

/** Health of one creature, lowered by Age (Ghost Dragons) and Poison (Wyvern Monarchs). */
export function hpOf(s: BattleState, u: Unit): number {
  const age = effectOf(u, SPELL.AGE)?.value ?? 0;
  const poison = effectOf(u, SPELL.POISON)?.value ?? 0;
  let base = stats(s, u).hp;
  // Rings of Vitality / Life, Vial of Lifeblood: +1 / +1 / +2 each; the Elixir of Life +25%.
  if (!u.machine) {
    const health = (s.sides[u.side]?.hero?.bonuses ?? []).filter((b) => b.type === "STACK_HEALTH");
    // (The Elixir's quarter only for the living: not undead nor unliving, the HotA mod's text.)
    for (const b of health) base += b.artifact === 131 ? (isLiving(stats(s, u)) ? Math.floor((stats(s, u).hp * (b.val ?? 0)) / 100) : 0) : (b.val ?? 0);
    // First Aid (HotA): the tent gives the whole army +5% / 10% / 15% health (5% more of it per level for its specialists).
    const hero = s.sides[u.side]?.hero;
    const aid = ownsMachine(s, u.side, 6) ? skillLevel(hero?.skills, "firstAid") : 0;
    if (aid) base += Math.floor((stats(s, u).hp * 5 * aid * skillFactor(hero, "firstAid")) / 100);
  }
  // Aging halves it (rounded up), poison takes its share of what's left: together down to a quarter.
  if (!age && !poison) return base;
  return Math.max(1, Math.ceil((base * (100 - age) * (100 - poison)) / 10000));
}

export function totalHp(s: BattleState, u: Unit): number {
  return u.count <= 0 ? 0 : (u.count - 1) * hpOf(s, u) + u.firstHp;
}

/** The damage a blow really does: HotA's Ballista, Catapult and First Aid Tent lose at most 40% of their health to any one. */
function blowOn(s: BattleState, u: Unit, dmg: number): number {
  if (!ruleOn(s.rules, "machineCap")) return dmg;
  return u.machine === "ballista" || u.machine === "cannon" || u.machine === "catapult" || u.machine === "tent" ? Math.min(dmg, Math.floor(hpOf(s, u) * 0.4)) : dmg;
}

/** How many creatures a blow of this much damage would kill (as takeDamage, without dealing it). */
export function killedBy(s: BattleState, u: Unit, dmg: number): number {
  const left = totalHp(s, u) - blowOn(s, u, dmg);
  return left <= 0 ? u.count : u.count - Math.ceil(left / hpOf(s, u));
}

/** Dendroids that die let go of whoever they bound (the bind ends with its binder; its mark on the stack too). */
export function releaseBound(s: BattleState, u: Unit) {
  for (const x of s.units) if (x.effects?.some((e) => e.spell === SPELL.BIND && e.value === u.id)) x.effects = x.effects.filter((e) => !(e.spell === SPELL.BIND && e.value === u.id));
}

/** Applies damage; returns creatures killed. */
export function takeDamage(s: BattleState, u: Unit, dmg: number): number {
  const hp = hpOf(s, u);
  dmg = blowOn(s, u, dmg);
  const before = u.count;
  if (dmg > 0) gainRunes(s, u, 2);
  // Frozen by a Great Shaman: any damage thaws it (the blow that does still takes the quarter more).
  if (dmg > 0 && u.effects?.length) u.effects = u.effects.filter((e) => e.spell !== SPELL.FROZEN);
  // A clone is dispelled by any damage, a spell's too (heroes.thelazy.net Clone).
  const left = u.clone && dmg > 0 ? 0 : totalHp(s, u) - dmg;
  if (left <= 0) {
    u.diedWith = before;
    u.count = 0;
    u.firstHp = 0;
    releaseBound(s, u);
    // (It leaves no corpse.)
    if (u.clone) u.sacrificed = true;
  } else {
    u.count = Math.ceil(left / hp);
    u.firstHp = left - (u.count - 1) * hp;
  }
  return before - u.count;
}

