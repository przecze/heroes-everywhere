// Secondary skills (HotA's 30, in SSTRAITS.TXT / HCTRAITS.TXT order) and level-up offers.
// Values follow HotA's own skill descriptions (SSTRAITS.TXT).
import { type HasRng, randInt } from "./rng.ts";

export const SKILLS = [
  "pathfinding", "archery", "logistics", "scouting", "diplomacy", "navigation", "leadership", "wisdom", "mysticism", "luck",
  "ballistics", "eagleEye", "necromancy", "estates", "fireMagic", "airMagic", "waterMagic", "earthMagic", "scholar", "tactics",
  "artillery", "learning", "offence", "armorer", "intelligence", "sorcery", "resistance", "firstAid", "interference", "runes",
] as const;
export type SkillKey = (typeof SKILLS)[number];

export const SKILL_NAMES = [
  "Pathfinding", "Archery", "Logistics", "Scouting", "Diplomacy", "Navigation", "Leadership", "Wisdom", "Mysticism", "Luck",
  "Ballistics", "Eagle Eye", "Necromancy", "Estates", "Fire Magic", "Air Magic", "Water Magic", "Earth Magic", "Scholar", "Tactics",
  "Artillery", "Learning", "Offense", "Armorer", "Intelligence", "Sorcery", "Resistance", "First Aid", "Interference", "Runes",
];
export const LEVEL_NAMES = ["", "Basic", "Advanced", "Expert"];

export const skillId = (key: string) => SKILLS.indexOf(key as SkillKey);

/** [skill id, level 1..3] pairs; a hero has at most 8 skills. */
export type SkillList = [number, number][];
export const MAX_SKILLS = 8;

export function skillLevel(skills: SkillList | undefined, key: SkillKey): number {
  const id = SKILLS.indexOf(key);
  return skills?.find(([s]) => s === id)?.[1] ?? 0;
}

// Effect sizes per level (index 0 = not learned).
export const LOGISTICS = [0, 0.05, 0.1, 0.2];
export const NAVIGATION = [0, 0.5, 1, 1.5];
export const SCOUTING = [0, 1, 3, 5];
export const ESTATES = [0, 250, 500, 1000];
export const LEARNING = [0, 0.2, 0.4, 0.6];
export const NECROMANCY = [0, 0.05, 0.1, 0.15];
export const OFFENCE = [0, 0.1, 0.2, 0.3];
export const ARCHERY = [0, 0.1, 0.25, 0.5];
export const ARMORER = [0, 0.05, 0.1, 0.15];
export const INTELLIGENCE = [0, 0.2, 0.35, 0.5];
/** Spell points at most for a hero without a specialty or artifacts: 10 per Knowledge, more with Intelligence
 * (the adventure map's `maxMana` adds those; a quick battle's heroes and the battle popup use this). */
export const manaLimit = (knowledge: number, skills?: SkillList): number => Math.floor(knowledge * 10 * (1 + INTELLIGENCE[skillLevel(skills, "intelligence")]));
export const SORCERY = [0, 0.1, 0.2, 0.3];
export const RESISTANCE = [0, 0.05, 0.1, 0.2];
export const MYSTICISM = [0, 0.1, 0.2, 0.3];

const MAGIC_SCHOOLS = [14, 15, 16, 17];
const WISDOM = 7;

/** Hero state the level-up rules need. */
export interface SkilledHero {
  skills?: SkillList;
  /** Level-ups since Wisdom / a magic school was last offered. */
  sinceWisdom?: number;
  sinceSchool?: number;
}

function weighted(rng: HasRng, ids: number[], weights: number[]): number {
  const total = ids.reduce((a, id) => a + (weights[id] ?? 0), 0);
  if (total <= 0) return ids.length ? ids[randInt(rng, 0, ids.length - 1)] : -1;
  let r = randInt(rng, 1, total);
  for (const id of ids) {
    r -= weights[id] ?? 0;
    if (r <= 0) return id;
  }
  return ids[ids.length - 1];
}

/**
 * Two skills offered on a level-up (heroes.thelazy.net/index.php/Secondary_skill):
 * an upgrade of a known skill and a new one when possible, weighted by the hero
 * class; Wisdom comes up at least every 6 levels and a magic school every 4 (3 and 3 for magic heroes).
 */
export function levelUpOffer(rng: HasRng, h: SkilledHero, weights: number[], banned: number[] = [], avoid?: number, magic = false): [number, number][] {
  const skills = h.skills ?? [];
  const known = new Set(skills.map(([id]) => id));
  let upgradable = skills.filter(([, l]) => l < 3).map(([id]) => id);
  // HotA 1.7.3: the level Learning grants doesn't offer Learning again, unless it's one of the last two skills to improve.
  if (avoid !== undefined && upgradable.includes(avoid) && (upgradable.length > 2 || skills.length < MAX_SKILLS)) upgradable = upgradable.filter((id) => id !== avoid);
  const fresh = skills.length < MAX_SKILLS ? SKILLS.map((_, id) => id).filter((id) => !known.has(id) && (weights[id] ?? 0) > 0 && !banned.includes(id)) : [];
  const levelOf = (id: number) => (skills.find(([s]) => s === id)?.[1] ?? 0) + 1;
  const offer: number[] = [];
  // A skill the hero has though the class never gets it (Water Magic on a Barbarian) weighs 1.
  const odds = SKILLS.map((_, id) => (known.has(id) ? Math.max(1, weights[id] ?? 0) : (weights[id] ?? 0)));
  const pick = (pool: number[]) => {
    const left = pool.filter((id) => !offer.includes(id));
    // Guarantees first: Wisdom (every 6 levels for might heroes, 3 for magic ones), then a magic
    // school (every 4 / 3), if they're in the pool. HotA counts Elementalists as magic heroes.
    const wisdomDue = (h.sinceWisdom ?? 0) >= (magic ? 2 : 5) && left.includes(WISDOM);
    const schoolDue = (h.sinceSchool ?? 0) >= (magic ? 2 : 3) ? left.filter((id) => MAGIC_SCHOOLS.includes(id)) : [];
    const id = wisdomDue ? WISDOM : schoolDue.length ? weighted(rng, schoolDue, odds) : weighted(rng, left, odds);
    if (id >= 0) offer.push(id);
  };
  if (upgradable.length) pick(upgradable);
  if (fresh.length) pick(fresh);
  else if (upgradable.length > offer.length) pick(upgradable);
  if (!upgradable.length && fresh.length > 1) pick(fresh);
  h.sinceWisdom = offer.includes(WISDOM) ? 0 : (h.sinceWisdom ?? 0) + 1;
  h.sinceSchool = offer.some((id) => MAGIC_SCHOOLS.includes(id)) ? 0 : (h.sinceSchool ?? 0) + 1;
  return offer.map((id) => [id, levelOf(id)]);
}

/** Learns or improves a skill. */
export function learnSkill(h: SkilledHero, id: number, level: number) {
  h.skills ??= [];
  const known = h.skills.find(([s]) => s === id);
  if (known) known[1] = Math.max(known[1], level);
  else if (h.skills.length < MAX_SKILLS) h.skills.push([id, level]);
}

/** AI preference when choosing between offered skills. */
const AI_VALUE: Record<string, number> = {
  offence: 10, armorer: 10, logistics: 9, wisdom: 8, archery: 8, leadership: 7, earthMagic: 7, airMagic: 7, necromancy: 9,
  pathfinding: 6, luck: 6, estates: 5, resistance: 5, intelligence: 5, sorcery: 4, waterMagic: 6, fireMagic: 4, tactics: 5,
  learning: 4, mysticism: 4, scouting: 3, diplomacy: 3, artillery: 3, ballistics: 2, firstAid: 2, eagleEye: 1, scholar: 1, navigation: 2,
  interference: 4, runes: 4,
};
/**
 * The AI's pick among offered skills: each skill's general worth times what it's worth to this
 * hero where it stands (`worth`: 0 for Navigation without water, Leadership for the undead...).
 */
export function aiSkillChoice(offer: [number, number][], worth: (key: SkillKey) => number = () => 1): number {
  const score = (id: number) => (AI_VALUE[SKILLS[id]] ?? 0) * worth(SKILLS[id]);
  let best = 0;
  offer.forEach(([id], i) => {
    if (score(id) > score(offer[best][0])) best = i;
  });
  return best;
}
