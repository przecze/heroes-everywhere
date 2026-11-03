// HotA's specialty changes, laid over specialtyData.ts (the classic game's). Applied once, at load.
// From HotA's own HEROSPEC.TXT and changelog (1.7.2's specialty rework); the HotA mod's gameBalance
// has most of them but not Coronius, Uland, Astra or Zilare (its "DUMMY" files).
import { SPECIALTIES, type Specialty, type SpecialtyBonus } from "./specialtyData.ts";
import { SPELL } from "./spells.ts";

/** Level 1-7 creature specialists of HotA's tier bonuses: Bloodlust, Stone Skin and Precision +10/8/6/4. */
const DOWN = [10, 10, 8, 8, 6, 6, 4];
/** Weakness takes 4/6/8/10 more. */
const UP = [4, 4, 6, 6, 8, 8, 10];
/** Haste and Prayer +3/2/1. */
const SMALL = [3, 3, 3, 3, 2, 2, 1];

const tier = (spell: number, tiers: number[]): Specialty => ({ bonuses: [{ type: "TIER_ENCHANT", spell, tiers }] });

/** Replaces the value of the hero's bonuses of a type (and subtype). */
function setVal(id: number, type: string, val: number, subtype?: string) {
  for (const b of SPECIALTIES[id]?.bonuses ?? []) if (b.type === type && (subtype === undefined || b.subtype === subtype)) b.val = val;
}

const REPLACE: Record<number, Specialty> = {
  // Weakness: Cuthbert, Olema, Mirlanda, Eanswythe.
  10: tier(SPELL.WEAKNESS, UP), 59: tier(SPELL.WEAKNESS, UP), 120: tier(SPELL.WEAKNESS, UP), 194: tier(SPELL.WEAKNESS, UP),
  // Bloodlust: Ash, Inteus, Akka.
  61: tier(SPELL.BLOODLUST, DOWN), 140: tier(SPELL.BLOODLUST, DOWN), 211: tier(SPELL.BLOODLUST, DOWN),
  // Stone Skin: Xsi, Darkstorn, Merist, Labetha.
  77: tier(SPELL.STONE_SKIN, DOWN), 95: tier(SPELL.STONE_SKIN, DOWN), 124: tier(SPELL.STONE_SKIN, DOWN), 139: tier(SPELL.STONE_SKIN, DOWN),
  // Precision: Zubin.
  108: tier(SPELL.PRECISION, DOWN),
  // Slayer: Coronius +20/16/12/8 (HotA 1.7.2).
  24: tier(SPELL.SLAYER, [20, 20, 16, 16, 12, 12, 8]),
  // Cure: Uland, Astra heal 10% more for every (8 - N) hero levels, N the creature's level (HotA 1.7.2).
  25: { bonuses: [{ type: "HEAL_STEP", spell: SPELL.CURE, val: 10 }] },
  170: { bonuses: [{ type: "HEAL_STEP", spell: SPELL.CURE, val: 10 }] },
  // Forgetfulness: Zilare forgets 10% more of the stack for every N hero levels, N the creature's level (HotA 1.7.2).
  169: { bonuses: [{ type: "FORGET_STEP", spell: SPELL.FORGETFULNESS, val: 10 }] },
  // Haste: Cyra, Terek, Brissa. Prayer: Loynis.
  46: tier(SPELL.HASTE, SMALL), 107: tier(SPELL.HASTE, SMALL), 137: tier(SPELL.HASTE, SMALL), 14: tier(SPELL.PRAYER, SMALL),
  // Dargem: Air Shield stops 10% more for every N hero levels (N the creature's level).
  171: { bonuses: [{ type: "GENERAL_DAMAGE_REDUCTION", subtype: "damageTypeRanged", val: 10 }] },
  // Adrienne: +50% damage from Fire spells.
  145: { bonuses: [{ type: "SPELL_DAMAGE", subtype: "fire", val: 50 }] },
  // Kinkeria: Learning (the mod's first version doubled it; HotA made her a plain Learning specialist).
  176: { skill: 21 },
  // HotA's campaign heroes (heroData.ts 215-230).
  215: { creatures: [172, 173] }, // Stina: Mechanics
  216: { creatures: [176, 177] }, // Umender: Automatons
  217: { creatures: [176, 177] }, // Elderian: Automatons
  218: { skill: 27 }, // Valquest: First Aid
  219: { creatures: [180, 181] }, // Jangaard: Gunslingers
  220: { skill: 22 }, // Winzells: Offence
  221: { creatures: [146], creatureLevel: 5 }, // Areshrak: Ballista
  222: { skill: 23 }, // Pactal: Armorer
  // Kydoimos: every dragon +10 Attack and Defense (a bonus for no creature in particular is for dragons).
  223: { bonuses: [{ type: "PRIMARY_SKILL", subtype: "attack", val: 10 }, { type: "PRIMARY_SKILL", subtype: "defence", val: 10 }] },
  // Miseria: Resurrection +5% for every N hero levels, N the creature's level.
  224: { bonuses: [{ type: "SPECIAL_SPELL_LEV", spell: SPELL.RESURRECTION, val: 5, perLevel: true }] },
  225: { skill: 25 }, // Athe: Sorcery
  226: { creatures: [146], creatureLevel: 5 }, // Gruezak: Ballista
  227: { creatures: [90, 91] }, // Zog: Ogres
  228: { creatures: [56, 57] }, // Boyd: Skeletons
  // Maximus: Black and Dread Knights +10 Attack, Defense and damage.
  229: {
    bonuses: [
      { type: "PRIMARY_SKILL", subtype: "attack", val: 10, creatures: [66, 67] },
      { type: "PRIMARY_SKILL", subtype: "defence", val: 10, creatures: [66, 67] },
      { type: "CREATURE_DAMAGE", subtype: "creatureDamageBoth", val: 10, creatures: [66, 67] },
    ],
  },
  // Balfour: Forgetfulness, as Zilare.
  230: { bonuses: [{ type: "FORGET_STEP", spell: SPELL.FORGETFULNESS, val: 10 }] },
};

/** Spell specialists: +val% for every N hero levels, N the target's level (classic: 3). */
const SCALING: Record<number, number> = {
  11: 10, 30: 10, 40: 10, 45: 5, 57: 10, 63: 10, 72: 10, 73: 5, 76: 5, 88: 5, 91: 5, 93: 5, 168: 10, 191: 10, 192: 10, 193: 10, 207: 10, 208: 10,
};

/** Creature specialists of level 1 creatures: 10% a level; Ballista specialists: 30% for every 5 levels. */
const STEP: Record<number, number> = {
  51: 10, 71: 10, 87: 10, 100: 10, 113: 10, 162: 10, 179: 10, 204: 10, 215: 10, 228: 10,
  6: 30, 36: 30, 54: 30, 81: 30, 97: 30, 118: 30, 177: 30, 186: 30, 221: 30, 226: 30,
};

let applied = false;
export function applyHotaSpecialties() {
  if (applied) return;
  applied = true;
  for (const [id, sp] of Object.entries(REPLACE)) SPECIALTIES[+id] = sp;
  for (const [id, val] of Object.entries(SCALING)) for (const b of SPECIALTIES[+id]?.bonuses ?? []) if (b.type === "SPECIAL_SPELL_LEV") b.val = val;
  for (const [id, step] of Object.entries(STEP)) if (SPECIALTIES[+id]) SPECIALTIES[+id].step = step;
  // Adela: blessed stacks +10% damage for every N hero levels.
  setVal(9, "GENERAL_DAMAGE_PREMY", 10);
  // Aenain: Disrupting Ray takes 10 more Defense.
  for (const b of SPECIALTIES[141]?.bonuses ?? []) if (b.type === "SPECIAL_ADD_VALUE_ENCHANT") b.addInfo = -10;
  // Luna: Fire Walls +25%.
  setVal(136, "SPECIFIC_SPELL_DAMAGE", 25);
  // Elementalists, dragon, Devil, Black Knight and Behemoth specialists.
  const flat: [number[], number, number][] = [[[129, 133], 3, 2], [[130, 134], 3, 4], [[131, 135], 12, 0], [[128, 132], 5, 5], [[151, 153, 155, 150, 149], 10, 10]];
  for (const [ids, attack, defence] of flat)
    for (const id of ids) {
      setVal(id, "PRIMARY_SKILL", attack, "attack");
      if (defence) setVal(id, "PRIMARY_SKILL", defence, "defence");
    }
}

export type { SpecialtyBonus };
