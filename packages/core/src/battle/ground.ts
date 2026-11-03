// The magic grounds' (and HotA's overlay fields') effects in battle (heroes.thelazy.net Terrain,
// Magical Terrains; the HotA mod's terrainOverlays). Only one applies: the battlefield is chosen by it.
import type { SpellInfo } from "../spells.ts";
import type { BattleState } from "./state.ts";

const GOOD = new Set(["castle", "rampart", "tower"]);
const EVIL = new Set(["inferno", "necropolis", "dungeon"]);

/** A town's alignment (heroes.thelazy.net Alignment); creatures of no town (`neutral`) have none. */
export function alignment(faction: string): "good" | "evil" | "neutral" | undefined {
  return GOOD.has(faction) ? "good" : EVIL.has(faction) ? "evil" : faction === "neutral" ? undefined : "neutral";
}

/** Grounds that cast one school's spells (or all, Magic Plains) at expert level. */
const SCHOOL_GROUND: Record<string, string> = { fiery_fields: "fire", rocklands: "earth", lucid_pools: "water", magic_clouds: "air" };

/** Is this spell cast at expert level here, whatever the caster's skill (heroes and creatures alike)? */
export function expertGround(s: BattleState, spell: SpellInfo): boolean {
  if (s.field === "magic_plains") return true;
  const school = s.field ? SCHOOL_GROUND[s.field] : undefined;
  return !!school && (spell.schools as string[]).includes(school);
}

/**
 * Cursed Ground: heroes cast nothing above level 1, creatures cast no spells, no native terrain,
 * morale never above 0 and (HotA) luck always 0.
 */
export const cursedGround = (s: BattleState): boolean => s.field === "cursed_ground";

/** Holy Ground: good +1, evil -1; Evil Fog the other way round. */
export function groundMorale(s: BattleState, faction: string): number {
  const a = alignment(faction);
  if (s.field === "holy_ground") return a === "good" ? 1 : a === "evil" ? -1 : 0;
  if (s.field === "evil_fog") return a === "evil" ? 1 : a === "good" ? -1 : 0;
  return 0;
}

/** Clover Field: +2 for the neutral towns' troops (not creatures of no town); Fields of Glory (HotA): -2 for all. */
export function groundLuck(s: BattleState, faction: string): number {
  if (s.field === "clover_field") return alignment(faction) === "neutral" ? 2 : 0;
  if (s.field === "fields_of_glory") return -2;
  return 0;
}

/** Cracked Ice (HotA): every stack's Defense -5. */
export const groundDefense = (s: BattleState): number => (s.field === "cracked_ice" ? -5 : 0);
