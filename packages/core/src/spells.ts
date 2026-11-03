// Spells: numbers from HotA's SPTRAITS.TXT, behaviour per heroes.thelazy.net.
import { SPELL_ART } from "./spellArt.ts";

export type School = "earth" | "water" | "fire" | "air";
export const SCHOOLS: School[] = ["earth", "water", "fire", "air"];

export interface SpellInfo {
  id: number;
  key: string;
  name: string;
  /** 1..5 (0 for creature abilities). */
  level: number;
  schools: School[];
  /** Mana cost by mastery: none, basic, advanced, expert. */
  cost: [number, number, number, number];
  /** Spell power multiplier (damage / healing = power x hero power + effect). */
  power: number;
  /** Effect value by mastery: none, basic, advanced, expert. */
  effect: [number, number, number, number];
  /** Mage guild odds per town (Castle .. Conflux; others use the average). */
  chance: number[];
  /** Right-click text by mastery. */
  text: string[];
}

/** Parses SPTRAITS.TXT rows: 0-9 adventure, 10-69 combat, 70+ creature abilities. */
export function parseSpells(rows: string[][]): SpellInfo[] {
  const out: SpellInfo[] = [];
  for (const r of rows) {
    const name = r[0]?.trim();
    if (!name || r[2] === undefined || r[2].trim() === "" || Number.isNaN(Number(r[2])) || name === "Name") continue;
    const id = out.length;
    const n = (i: number) => Number(r[i]) || 0;
    out.push({
      id,
      key: SPELL_ART[id]?.key ?? name,
      name,
      level: n(2),
      schools: SCHOOLS.filter((_, i) => (r[3 + i] ?? "").trim().toLowerCase() === "x"),
      cost: [n(7), n(8), n(9), n(10)],
      power: n(11),
      effect: [n(12), n(13), n(14), n(15)],
      chance: [16, 17, 18, 19, 20, 21, 22, 23, 24].map(n),
      text: [29, 30, 31, 32].map((i) => (r[i] ?? "").replace(/\{[^}]*\}\s*/g, "").trim()),
    });
  }
  return out;
}

export const SPELL = {
  SUMMON_BOAT: 0, SCUTTLE_BOAT: 1, VISIONS: 2, VIEW_EARTH: 3, DISGUISE: 4, VIEW_AIR: 5, FLY: 6, WATER_WALK: 7, DIMENSION_DOOR: 8, TOWN_PORTAL: 9,
  QUICKSAND: 10, LAND_MINE: 11, FORCE_FIELD: 12, FIRE_WALL: 13, EARTHQUAKE: 14, MAGIC_ARROW: 15, ICE_BOLT: 16, LIGHTNING_BOLT: 17, IMPLOSION: 18,
  CHAIN_LIGHTNING: 19, FROST_RING: 20, FIREBALL: 21, INFERNO: 22, METEOR_SHOWER: 23, DEATH_RIPPLE: 24, DESTROY_UNDEAD: 25, ARMAGEDDON: 26,
  SHIELD: 27, AIR_SHIELD: 28, FIRE_SHIELD: 29, PROT_AIR: 30, PROT_FIRE: 31, PROT_WATER: 32, PROT_EARTH: 33, ANTI_MAGIC: 34, DISPEL: 35,
  MAGIC_MIRROR: 36, CURE: 37, RESURRECTION: 38, ANIMATE_DEAD: 39, SACRIFICE: 40, BLESS: 41, CURSE: 42, BLOODLUST: 43, PRECISION: 44,
  WEAKNESS: 45, STONE_SKIN: 46, DISRUPTING_RAY: 47, PRAYER: 48, MIRTH: 49, SORROW: 50, FORTUNE: 51, MISFORTUNE: 52, HASTE: 53, SLOW: 54,
  SLAYER: 55, FRENZY: 56, TITANS_BOLT: 57, COUNTERSTRIKE: 58, BERSERK: 59, HYPNOTIZE: 60, FORGETFULNESS: 61, BLIND: 62, TELEPORT: 63,
  REMOVE_OBSTACLE: 64, CLONE: 65, FIRE_ELEMENTAL: 66, EARTH_ELEMENTAL: 67, WATER_ELEMENTAL: 68, AIR_ELEMENTAL: 69,
  // Creature abilities (SPTRAITS rows 70+).
  STONE_GAZE: 70, POISON: 71, BIND: 72, DISEASE: 73, PARALYZE: 74, AGE: 75, DEATH_CLOUD: 76, THUNDERBOLT: 77, DISPEL_HELPFUL: 78,
  DEATH_STARE: 79, ACID_BREATH: 80,
  // HotA effects with no spell of their own: a Great Shaman's freezing shot.
  FROZEN: 90,
} as const;

/** How a combat spell picks its targets. */
export type SpellShape =
  | "single" // one creature
  | "ball1" // target hex and the ring around it
  | "ball2" // two rings
  | "ring" // only the ring around the target hex
  | "chain" // jumps between nearest creatures
  | "all" // every creature (filtered by `who`)
  | "summon" // no target
  | "teleport" // a creature and a destination hex
  | "sacrifice" // a fallen friendly stack, then the friendly stack given up for it
  | "field" // no target: Quicksand and Land Mines scatter, Earthquake shakes the walls
  | "place" // a free hex: Force Field, Fire Wall
  | "obstacle"; // an obstacle to remove

export interface CombatSpell {
  shape: SpellShape;
  /** Damage spells deal power x SP + effect. */
  damage?: boolean;
  /** Whom it affects: friends, enemies or anyone. */
  who: "friend" | "enemy" | "any";
  /** A buff/debuff lasting SP rounds (+mastery bonuses), else instant. */
  timed?: boolean;
  /** At expert mastery it hits every creature of the side (bless, haste, slow...). */
  massAtExpert?: boolean;
  /** Mind spells don't touch mind-immune creatures (undead, elementals, golems...). */
  mind?: boolean;
}

/** Behaviour of the combat spells that are in the game so far. */
export const COMBAT_SPELLS: Record<number, CombatSpell> = {
  [SPELL.MAGIC_ARROW]: { shape: "single", damage: true, who: "enemy" },
  [SPELL.ICE_BOLT]: { shape: "single", damage: true, who: "enemy" },
  [SPELL.LIGHTNING_BOLT]: { shape: "single", damage: true, who: "enemy" },
  [SPELL.IMPLOSION]: { shape: "single", damage: true, who: "enemy" },
  [SPELL.CHAIN_LIGHTNING]: { shape: "chain", damage: true, who: "any" },
  [SPELL.FROST_RING]: { shape: "ring", damage: true, who: "any" },
  [SPELL.FIREBALL]: { shape: "ball1", damage: true, who: "any" },
  [SPELL.INFERNO]: { shape: "ball2", damage: true, who: "any" },
  [SPELL.METEOR_SHOWER]: { shape: "ball1", damage: true, who: "any" },
  [SPELL.DEATH_RIPPLE]: { shape: "all", damage: true, who: "any" },
  [SPELL.DESTROY_UNDEAD]: { shape: "all", damage: true, who: "any" },
  [SPELL.ARMAGEDDON]: { shape: "all", damage: true, who: "any" },
  [SPELL.SHIELD]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.AIR_SHIELD]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.FIRE_SHIELD]: { shape: "single", who: "friend", timed: true },
  [SPELL.PROT_AIR]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.PROT_FIRE]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.PROT_WATER]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.PROT_EARTH]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.ANTI_MAGIC]: { shape: "single", who: "friend", timed: true },
  [SPELL.DISPEL]: { shape: "single", who: "any", massAtExpert: true },
  [SPELL.MAGIC_MIRROR]: { shape: "single", who: "friend", timed: true },
  [SPELL.CURE]: { shape: "single", who: "friend", massAtExpert: true },
  [SPELL.RESURRECTION]: { shape: "single", who: "friend" },
  [SPELL.SACRIFICE]: { shape: "sacrifice", who: "friend" },
  [SPELL.ANIMATE_DEAD]: { shape: "single", who: "friend" },
  [SPELL.BLESS]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.CURSE]: { shape: "single", who: "enemy", timed: true, massAtExpert: true },
  [SPELL.BLOODLUST]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.PRECISION]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.WEAKNESS]: { shape: "single", who: "enemy", timed: true, massAtExpert: true },
  [SPELL.STONE_SKIN]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.DISRUPTING_RAY]: { shape: "single", who: "enemy" },
  [SPELL.PRAYER]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.MIRTH]: { shape: "single", who: "friend", timed: true, massAtExpert: true, mind: true },
  [SPELL.SORROW]: { shape: "single", who: "enemy", timed: true, massAtExpert: true, mind: true },
  [SPELL.FORTUNE]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.MISFORTUNE]: { shape: "single", who: "enemy", timed: true, massAtExpert: true },
  [SPELL.HASTE]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  [SPELL.SLOW]: { shape: "single", who: "enemy", timed: true, massAtExpert: true },
  [SPELL.SLAYER]: { shape: "single", who: "friend", timed: true },
  [SPELL.FRENZY]: { shape: "single", who: "friend", timed: true, mind: true },
  [SPELL.COUNTERSTRIKE]: { shape: "single", who: "friend", timed: true, massAtExpert: true },
  // Berserk: one stack, then the stacks within one (advanced) or two (expert) hexes.
  [SPELL.BERSERK]: { shape: "single", who: "any", timed: true, mind: true },
  [SPELL.HYPNOTIZE]: { shape: "single", who: "enemy", timed: true, mind: true },
  [SPELL.FORGETFULNESS]: { shape: "single", who: "enemy", timed: true, massAtExpert: true, mind: true },
  [SPELL.BLIND]: { shape: "single", who: "enemy", timed: true, mind: true },
  [SPELL.TELEPORT]: { shape: "teleport", who: "friend" },
  [SPELL.CLONE]: { shape: "single", who: "friend" },
  [SPELL.FIRE_ELEMENTAL]: { shape: "summon", who: "friend" },
  [SPELL.EARTH_ELEMENTAL]: { shape: "summon", who: "friend" },
  [SPELL.WATER_ELEMENTAL]: { shape: "summon", who: "friend" },
  [SPELL.AIR_ELEMENTAL]: { shape: "summon", who: "friend" },
  [SPELL.QUICKSAND]: { shape: "field", who: "any" },
  [SPELL.LAND_MINE]: { shape: "field", who: "any" },
  [SPELL.EARTHQUAKE]: { shape: "field", who: "any" },
  [SPELL.FORCE_FIELD]: { shape: "place", who: "any" },
  [SPELL.FIRE_WALL]: { shape: "place", who: "any" },
  [SPELL.REMOVE_OBSTACLE]: { shape: "obstacle", who: "any" },
  [SPELL.TITANS_BOLT]: { shape: "single", damage: true, who: "enemy" },
};

/** Elementals summoned by the four summoning spells. */
export const SUMMONED: Record<number, number> = {
  [SPELL.FIRE_ELEMENTAL]: 114,
  [SPELL.EARTH_ELEMENTAL]: 113,
  [SPELL.WATER_ELEMENTAL]: 115,
  [SPELL.AIR_ELEMENTAL]: 112,
};

/** Positive (friendly) timed spells: Dispel on friends, Cure's removal and Dispel Helpful use this. */
export function isPositive(id: number): boolean {
  return COMBAT_SPELLS[id]?.who === "friend";
}
