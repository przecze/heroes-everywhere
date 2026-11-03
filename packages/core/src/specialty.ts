// Hero specialties (data in specialtyData.ts): creature specialists, secondary skill specialists,
// resources every day, spell specialists, and a few fixed bonuses. Shared by the adventure map
// and battles (a battle hero carries its type and level).
import { LEARNING, SKILLS, type SkillKey, type SkillList, skillLevel } from "./skills.ts";
import { SPECIALTIES, type Specialty } from "./specialtyData.ts";
import { applyHotaSpecialties } from "./specialtyHota.ts";
import { SPELL } from "./spells.ts";
import { type CreatureStats, hasAbility } from "./creatures.ts";

applyHotaSpecialties();

/** VCMI names the Fire Wall's and the Land Mine's burn as spells of their own; a specialty for the trigger is one for the spell. */
const TRIGGER_OF: Record<number, string> = { [SPELL.FIRE_WALL]: "fireWallTrigger", [SPELL.LAND_MINE]: "landMineTrigger" };
/** The specialty's bonuses of a type for a spell: by its id, else by its trigger's name (not both: Luna has both for the Fire Wall). */
function forSpell(h: SpecialtyHero | undefined, type: string, spell: number) {
  const of = (specialtyOf(h)?.bonuses ?? []).filter((b) => b.type === type);
  const byId = of.filter((b) => b.spell === spell);
  return byId.length ? byId : of.filter((b) => b.spell === TRIGGER_OF[spell]);
}

export type { Specialty };

export interface SpecialtyHero {
  type?: number;
  level?: number;
}

const SHIELD_SPELL = 27;

export const specialtyOf = (h: SpecialtyHero | undefined): Specialty | undefined => (h?.type === undefined ? undefined : SPECIALTIES[h.type]);

/** Secondary skill specialists: the skill's effect is 5% better per hero level. */
export function skillFactor(h: SpecialtyHero | undefined, skill: SkillKey): number {
  const sp = specialtyOf(h);
  return sp?.skill === SKILLS.indexOf(skill) ? 1 + 0.05 * (h?.level ?? 1) : 1;
}

/** Experience after Learning (HotA: 20 / 40 / 60% more; Kinkeria 5% more of that per level), rounded down. */
export function withLearning(h: (SpecialtyHero & { skills?: SkillList }) | undefined, xp: number): number {
  return Math.floor(xp * (1 + LEARNING[skillLevel(h?.skills, "learning")] * skillFactor(h, "learning")));
}

/** Resources the hero brings in every day (e.g. 350 gold, 1 gem). */
export function specialtyIncome(h: SpecialtyHero): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const b of specialtyOf(h)?.bonuses ?? []) if (b.type === "GENERATE_RESOURCE") out[b.resource ?? 6] += b.val ?? 0;
  return out;
}

/** Creature specialists (HotA): +20% attack and defence for every N hero levels, N the creature's level (level 1: 10% a level; Ballista: 30% every 5). */
export function creatureSpecialtyPercent(h: SpecialtyHero | undefined, creature: number, creatureLevel: number): number {
  const sp = specialtyOf(h);
  if (!sp?.creatures?.includes(creature)) return 0;
  const lvl = sp.creatureLevel ?? Math.max(1, creatureLevel);
  return (sp.step ?? 20) * Math.floor((h?.level ?? 1) / lvl);
}

/** Flat bonuses for some creatures (e.g. Kilgor's Behemoths): primary skills, damage; a bonus for no creature in particular is for dragons (Mutare's). */
export function creatureBonus(h: SpecialtyHero | undefined, creature: number, type: "attack" | "defence" | "damage", dragon = false): number {
  let v = 0;
  for (const b of specialtyOf(h)?.bonuses ?? []) {
    if (b.type !== "PRIMARY_SKILL" && b.type !== "CREATURE_DAMAGE") continue;
    if (b.creatures ? !b.creatures.includes(creature) : !dragon) continue;
    if (type === "damage" && b.type === "CREATURE_DAMAGE") v += b.val ?? 0;
    if (type !== "damage" && b.type === "PRIMARY_SKILL" && b.subtype === type) v += b.val ?? 0;
  }
  return v;
}

/** A creature's own attack or defence with its hero's specialty (a creature specialist's percent, flat bonuses);
 * the hero's primary skill comes on top, and in battle terrain, spells and the rest. */
export function specialtyStat(h: SpecialtyHero | undefined, c: CreatureStats, which: "attack" | "defence"): number {
  const base = which === "attack" ? c.attack : c.defense;
  return base + Math.ceil((base * creatureSpecialtyPercent(h, c.id, c.level)) / 100) + creatureBonus(h, c.id, which, hasAbility(c, "DRAGON_NATURE"));
}

/** Speed for a creature: +1 for a creature specialist's own, plus any stack-wide bonus (Sir Mullich). */
export function speedBonus(h: SpecialtyHero | undefined, creature: number): number {
  const sp = specialtyOf(h);
  let v = sp?.creatures?.includes(creature) ? 1 : 0;
  // (Xeron's Devils: a speed bonus for some creatures only.)
  for (const b of sp?.bonuses ?? []) if (b.type === "STACKS_SPEED" && (!b.creatures || b.creatures.includes(creature))) v += b.val ?? 0;
  return v;
}

/** Spell specialists: damage +val% per (hero level / target's creature level). */
export function spellSpecialtyPercent(h: SpecialtyHero | undefined, spell: number, targetLevel: number): number {
  for (const b of forSpell(h, "SPECIAL_SPELL_LEV", spell)) return ((b.val ?? 3) * (h?.level ?? 1)) / Math.max(1, targetLevel);
  return 0;
}

/**
 * Enchantment specialists. HotA's tier bonuses: Bloodlust, Stone Skin, Precision +10/8/6/4 by the
 * creature's level, Weakness 4/6/8/10 more, Haste and Prayer +3/2/1. Classic ones (VCMI's Timed
 * effect): +3 on levels 1-2, +2 on 3-4, +1 on 5-6; Aenain's Disrupting Ray takes 10 more; Fortune is
 * always +3; Coronius' Slayer +20/16/12/8 by tier; Wrathmont's Frenzy +10% for every N hero levels;
 * Zilare's Forgetfulness 10% more of the stack for every N hero levels. Values here are magnitudes,
 * as the battle code uses them.
 */
export function enchantSpecialty(h: SpecialtyHero | undefined, spell: number, creatureLevel: number, value: number): number {
  // Dalton and Dargem (HotA): Shield / Air Shield stops 5% / 10% more of the damage for every N hero
  // levels, N the creature's level. (The shields' value is the share of damage still taken.)
  const reduce = spell === SHIELD_SPELL || spell === SPELL.AIR_SHIELD ? specialtyOf(h)?.bonuses?.find((b) => b.type === "GENERAL_DAMAGE_REDUCTION" && b.subtype === (spell === SHIELD_SPELL ? "damageTypeMelee" : "damageTypeRanged")) : undefined;
  if (reduce) {
    const steps = Math.floor((h?.level ?? 1) / Math.max(1, creatureLevel));
    return Math.max(0, Math.round(100 - (100 - value) * (1 + ((reduce.val ?? 5) / 100) * steps)));
  }
  const lvl = Math.min(7, Math.max(1, creatureLevel));
  for (const b of specialtyOf(h)?.bonuses ?? []) {
    if (b.spell !== spell) continue;
    if (b.type === "TIER_ENCHANT") return value + (b.tiers?.[lvl - 1] ?? 0);
    if (b.type === "FORGET_STEP") return value + (b.val ?? 10) * Math.floor((h?.level ?? 1) / lvl);
    if (b.type === "SPECIAL_SPELL_LEV") return Math.round(value * (1 + spellSpecialtyPercent(h, spell, lvl) / 100));
    if (b.type === "SPECIAL_PECULIAR_ENCHANT" && (b.addInfo ?? 0) === 0) return value + ([0, 3, 3, 2, 2, 1, 1][lvl] ?? 0);
    if (b.type === "SPECIAL_ADD_VALUE_ENCHANT") return value + Math.abs(b.addInfo ?? 0);
    if (b.type === "SPECIAL_FIXED_VALUE_ENCHANT") return b.addInfo ?? value;
  }
  return value;
}

/** Cure specialists (Uland, Astra; HotA): +10% healing for every (8 - N) hero levels, N the creature's level. */
export function healSpecialtyPercent(h: SpecialtyHero | undefined, spell: number, creatureLevel: number): number {
  const lvl = Math.min(7, Math.max(1, creatureLevel));
  for (const b of specialtyOf(h)?.bonuses ?? []) if (b.type === "HEAL_STEP" && b.spell === spell) return (b.val ?? 10) * Math.floor((h?.level ?? 1) / (8 - lvl));
  return 0;
}

/** School damage specialists (Adrienne, HotA): +val% damage from that school's spells. */
export function schoolDamageSpecialty(h: SpecialtyHero | undefined, school: string): number {
  return specialtyValue(h, "SPELL_DAMAGE", school);
}

/** A bonus's value at the hero's level: VCMI's "grows with level" (valPer20 per step of levels), else its plain value. */
function grown(b: Specialty["bonuses"] extends (infer T)[] | undefined ? T : never, level: number): number {
  if (!b.grows) return b.val ?? 0;
  const [per20, step] = b.grows;
  return Math.floor((per20 * (step ? Math.floor(level / step) : level) + 19) / 20);
}

/**
 * Plain specialty bonuses by type (not tied to creatures or spells): sea movement for the HotA
 * navigators (+75 a level), sight for the scouts (+1 every 6 levels).
 */
export function specialtyValue(h: SpecialtyHero | undefined, type: string, subtype?: string): number {
  let v = 0;
  for (const b of specialtyOf(h)?.bonuses ?? []) {
    if (b.type !== type || b.creatures || b.spell !== undefined || (subtype !== undefined && b.subtype !== subtype)) continue;
    v += grown(b, h?.level ?? 1);
  }
  return v;
}

/** Eovacius (HotA): the first Clone of each battle makes two copies. */
export function doubleClone(h: SpecialtyHero | undefined): boolean {
  return !!specialtyOf(h)?.bonuses?.some((b) => b.type === "SPELL" && b.spell === "specialClone");
}

/** Spell damage specialists by spell (Fire Wall +100%, Magic Arrow +50%): the extra percent. */
export function spellDamageSpecialty(h: SpecialtyHero | undefined, spell: number): number {
  let v = 0;
  for (const b of forSpell(h, "SPECIFIC_SPELL_DAMAGE", spell)) v += b.val ?? 0;
  return v;
}

/** Bless specialists (Adela): blessed stacks deal +10% damage (HotA; classic 3%) per (hero level / creature level). */
export function blessSpecialtyPercent(h: SpecialtyHero | undefined, creatureLevel: number): number {
  let v = 0;
  for (const b of specialtyOf(h)?.bonuses ?? []) {
    if (b.type === "GENERAL_DAMAGE_PREMY" && b.perLevelByCreatureLevel) v += ((b.val ?? 3) * (h?.level ?? 1)) / Math.max(1, creatureLevel);
  }
  return v;
}

/** Spell duration specialists (Forgetfulness, growing with level): extra rounds for that spell. */
export function spellDurationSpecialty(h: SpecialtyHero | undefined, spell: number): number {
  let v = 0;
  for (const b of specialtyOf(h)?.bonuses ?? []) if (b.type === "SPELL_DURATION" && b.spell === spell) v += grown(b, h?.level ?? 1);
  return v;
}
