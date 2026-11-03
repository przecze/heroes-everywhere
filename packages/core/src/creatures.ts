import { type Ability, CREATURE_INFO } from "./creatureData.ts";
import { HOTA_BALANCE, HOTA_CREATURES } from "./hotaData.ts";

export type { Ability } from "./creatureData.ts";

export interface CreatureStats {
  id: number;
  key: string;
  name: string;
  plural: string;
  level: number;
  faction: string;
  gold: number;
  /** Full price: wood, mercury, ore, sulfur, crystal, gems, gold. */
  cost: number[];
  /** Extra weekly growth from a horde building. */
  hordeGrowth: number;
  fightValue: number;
  aiValue: number;
  /** Weekly growth. */
  growth: number;
  /** How many a stack on the adventure map holds, low and high (CRTRAITS). */
  mapStack?: [number, number];
  hp: number;
  speed: number;
  attack: number;
  defense: number;
  minDamage: number;
  maxDamage: number;
  shots: number;
  abilities: Ability[];
  /** Battle animation DEF (without extension). */
  def: string;
  /** Projectile DEF for shooters. */
  missile: string;
  /** Beam colours for ray shooters (Beholders, Titans...). */
  ray?: number[][][];
  /** Prefix of the creature's sounds in Heroes3.snd (PIKE -> PIKEATTK.wav, ...). */
  sound: string;
  /** The game's own words for its abilities (CRTRAITS.TXT's "Ability Text"), as the creature popup shows them. */
  abilityText?: string;
  /** Portrait images for creatures not in the original portrait sheets (HotA). */
  iconSmall?: string;
  iconLarge?: string;
}

/**
 * Builds creature stats from CRTRAITS.TXT rows plus CREATURE_INFO. Ids are
 * assigned in file order, skipping the blank separator lines between towns.
 */
export function parseCreatures(rows: string[][]): CreatureStats[] {
  const out: CreatureStats[] = [];
  for (const row of rows.slice(2)) {
    if (!row[0]?.trim()) continue;
    const id = out.length;
    const n = (i: number) => Number(row[i]) || 0;
    const info = CREATURE_INFO[id];
    out.push({
      id,
      key: info?.key ?? `creature${id}`,
      name: row[0],
      plural: row[1],
      level: info?.level ?? 0,
      faction: info?.faction ?? "neutral",
      gold: n(8),
      cost: [2, 3, 4, 5, 6, 7, 8].map(n),
      hordeGrowth: n(12),
      fightValue: n(9),
      aiValue: n(10),
      growth: n(11),
      hp: n(13),
      speed: n(14),
      attack: n(15),
      defense: n(16),
      minDamage: n(17),
      maxDamage: n(18),
      shots: n(19),
      ...(n(22) > 0 ? { mapStack: [n(21), n(22)] as [number, number] } : {}),
      abilities: info?.abilities ?? [],
      def: info?.def ?? "",
      missile: info?.missile ?? "",
      ray: info?.ray,
      sound: info?.sound ?? "",
      abilityText: row[23]?.trim() || undefined,
    });
  }
  applyHota(out);
  return out;
}

export const RESOURCES = ["wood", "mercury", "ore", "sulfur", "crystal", "gems", "gold"];

/** Horn of the Abyss: balance changes to original creatures, then its new creatures at ids 150+. */
function applyHota(out: CreatureStats[]) {
  for (const [id, b] of Object.entries(HOTA_BALANCE)) {
    const c = out[Number(id)];
    if (!c) continue;
    if (b.cost) c.cost = RESOURCES.map((r) => b.cost![r] ?? 0);
    if (b.aiValue) c.aiValue = b.aiValue;
    if (b.fightValue) c.fightValue = b.fightValue;
    // HotA's changed shooting visuals: the Enchanters shoot a Magic Arrow (C20SPX0) instead of the SoD arrow.
    if (b.missile) c.missile = b.missile;
  }
  // HotA's ability changes (the mod's gameBalance creatures.json).
  const by = (key: string) => out.find((c) => c?.key === key);
  const firebird = by("firebird");
  if (firebird) firebird.abilities = [...firebird.abilities.filter((a) => !(a.type === "SPELL_SCHOOL_IMMUNITY" && a.subtype === "fire")), { type: "SPELL_DAMAGE_REDUCTION", subtype: "fire", val: 50 }];
  for (const k of ["boneDragon", "ghostDragon"]) by(k)?.abilities.push({ type: "SKELETON_TRANSFORMER_TARGET", subtype: "boneDragon" });
  for (const k of ["wight", "wraith"]) for (const a of by(k)?.abilities ?? []) if (a.type === "HP_REGENERATION") a.val = 5000;
  for (const a of by("archDevil")?.abilities ?? []) if (a.type === "LUCK") a.val = -2;
  // Halflings are the Factory's level 1 (heroes.thelazy.net Halfling): no longer neutral, at home in the wasteland.
  const halfling = by("halfling");
  if (halfling) halfling.faction = "factory";
  // Nymphs and Oceanids are immune to the Great Shamans' Freezing Shot too (heroes.thelazy.net Nymph; the mod leaves it out).
  for (const h of HOTA_CREATURES) if ((h.key === "nymph" || h.key === "oceanid") && !h.abilities.some((a) => a.subtype === "freezingShot")) h.abilities.push({ type: "SPELL_IMMUNITY", subtype: "freezingShot" });
  for (const h of HOTA_CREATURES) {
    // Keep ids aligned with HotA maps; unused ids get an inert placeholder.
    while (out.length < h.id) out.push({ ...out[0], id: out.length, key: `unused${out.length}`, name: "", plural: "", level: 0, def: "", abilities: [] });
    out[h.id] = {
      id: h.id,
      key: h.key,
      name: h.name,
      plural: h.plural,
      level: h.level,
      faction: h.faction,
      gold: h.cost[6],
      cost: h.cost,
      hordeGrowth: h.hordeGrowth,
      fightValue: h.fightValue,
      aiValue: h.aiValue,
      growth: h.growth,
      hp: h.hp,
      speed: h.speed,
      attack: h.attack,
      defense: h.defense,
      minDamage: h.minDamage,
      maxDamage: h.maxDamage,
      shots: h.shots,
      abilities: h.abilities,
      def: h.def,
      missile: h.missile,
      sound: h.sound,
      iconSmall: h.iconSmall,
      iconLarge: h.iconLarge,
    };
  }
}

export function ability(c: CreatureStats, type: string): Ability | undefined {
  return c.abilities.find((a) => a.type === type);
}

export function hasAbility(c: CreatureStats, type: string): boolean {
  return c.abilities.some((a) => a.type === type);
}

/** Morale touches the creature: not the undead, nor the non-living (golems, elementals, gargoyles, war machines). */
export function feelsMorale(c: CreatureStats): boolean {
  return !hasAbility(c, "UNDEAD") && !hasAbility(c, "NON_LIVING");
}

/** Creatures that can stand in an army (not war machines, arrow towers, ...). */
export function isRecruitable(c: CreatureStats): boolean {
  return !!c.def && c.level > 0 && !hasAbility(c, "SIEGE_WEAPON") && !hasAbility(c, "NOT_ACTIVE") && !hasAbility(c, "CPU_CONTROLLED");
}
