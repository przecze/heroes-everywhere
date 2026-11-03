// What things are worth to an AI hero: an object with the map's victory goal on top, the loot behind guards,
// artifacts and skills. Each kind of place on the map has its own record in aiPlaces.ts.
import { feelsMorale } from "../creatures.ts";
import { ARTIFACT_INFO } from "../artifactData.ts";
import { SPELLBOOK_ARTIFACT } from "./artifacts.ts";
import { MAX_SKILLS, SKILLS, skillLevel } from "../skills.ts";
import { COMBOS, heroSpells } from "./artifacts.ts";
import { mapData } from "./objects.ts";
import { dailyIncome } from "./rules.ts";
import { B } from "./town.ts";
import { type Quest } from "./quests.ts";
import { type AdventureState, type AdvObject, type ArmySlot, type Hero, Obj } from "./types.ts";
import { type World, visitTile, Terrain } from "./world.ts";
import { power } from "./aiThreat.ts";
import { UNBEATABLE, WORTH } from "./aiValues.ts";
import { objectWorth } from "./aiPlaces.ts";

/** The strongest guard (a share of our strength) fought for what lies behind it. */
const LOOT_RISK = 0.5;
export { LOSS_WEIGHT, UNBEATABLE } from "./aiValues.ts";
export { SERVICE_RESERVE, junkStacks, objectWorth, odds, transformable, useService } from "./aiPlaces.ts";

/**
 * What an object is worth to the hero, with the map's special victory condition on top where it
 * applies to the computer: the town to capture, the monster to beat, the artifact to find are
 * worth more than anything else it could do (it's the game).
 */
export function objectValue(s: AdventureState, w: World, h: Hero, o: AdvObject, enemies: Hero[]): number {
  const v = objectWorth(s, w, h, o, enemies);
  const goal = aiGoal(s);
  if (!goal || o.owner === h.owner) return v;
  if (goal.type === 6 && o.id === goal.object) return v > 0 ? v + GOAL_WORTH : v;
  if (goal.type === 7 && o.id === goal.object && v > UNBEATABLE) return Math.max(v, 0) + GOAL_WORTH;
  if ((goal.type === 0 || goal.type === 10) && o.type === Obj.ARTIFACT && o.subid === goal.artifact) return Math.max(v, 0) + GOAL_WORTH;
  return v;
}
export const GOAL_WORTH = WORTH.goal;
/**
 * Resources the computer saves for the map's victory: those to accumulate (Dwarven Gold), or the
 * price a Quest Guard by the goal asks (For Sale: 50605 gold to buy the castle; spent on buildings
 * day after day, the guards never let anyone by).
 */
export function goalSavings(s: AdventureState, w: World): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  const goal = aiGoal(s);
  if (!goal) return out;
  if (goal.type === 2 && goal.resource !== undefined) out[goal.resource] = goal.amount ?? 0;
  const g = goal.object !== undefined ? s.objects[goal.object] : undefined;
  if (g) for (const o of goalGuards(s, w, g)) for (const [r, n] of ((mapData(w, o) as unknown as Quest).resources ?? []).entries()) out[r] = Math.max(out[r], n ?? 0);
  return out;
}
/**
 * Saving is worth it when today's income gets there within a month: else the economy comes first
 * (For Sale's Red, at 500 gold a day, saved everything and built nothing for a hundred days).
 */
export function worthSaving(s: AdventureState, w: World, player: number, need: number[]): boolean {
  const res = s.players[player].resources;
  const income = dailyIncome(s, w, player);
  return need.every((n, r) => res[r] >= n || (income[r] > 0 && (n - res[r]) / income[r] <= 28));
}
/** Quest Guards asking for resources within three tiles of the goal's entrance (in its way). */
export function goalGuards(s: AdventureState, w: World, g: AdvObject): AdvObject[] {
  const gate = visitTile(w, g);
  if (gate < 0) return [];
  const gx = gate % w.size;
  const gy = Math.floor(gate / w.size) % w.size;
  return s.objects.filter((o) => !o.removed && o.type === 215 && o.z === g.z && Math.max(Math.abs(o.x - gx), Math.abs(o.y - gy)) <= 3 && (mapData(w, o) as unknown as Quest).mission === 7);
}
/** The map's special victory condition, when the computer plays for it too. */
export function aiGoal(s: AdventureState) {
  const v = s.conditions?.victory;
  return v && v.type >= 0 && v.appliesToAI ? v : undefined;
}
const TIER_WORTH: Record<string, number> = { T: 1200, N: 2500, J: 4500, R: 9000, S: 2500 };
const MAGIC_BONUS = new Set(["SPELL_DAMAGE", "SPELL_DURATION", "MANA_REGENERATION", "SPELLS_OF_SCHOOL", "SPELLS_OF_LEVEL", "MANA_PERCENTAGE_REGENERATION", "LEARN_BATTLE_SPELL_CHANCE"]);
const hasWater = new WeakMap<World, boolean>();

/** The combination (id, parts) this artifact would complete, from what the hero carries. */
export function completes(h: Hero, id: number): [string, number[]] | undefined {
  const carried = [...(h.equipped ?? []), ...(h.backpack ?? [])];
  return Object.entries(COMBOS).find(([, parts]) => parts.includes(id) && parts.every((p) => p === id || carried.includes(p)));
}

/**
 * What an artifact is worth to this hero where it stands: its class's worth (treasure to relic),
 * or what the first of the rules below that speaks for it says (in their order).
 */
export function artifactWorth(s: AdventureState, w: World, h: Hero, id: number): number {
  const info = ARTIFACT_INFO[id];
  const a: Held = { s, w, h, id, base: TIER_WORTH[w.data.artifacts[id]?.tier ?? "S"] ?? 2500, carried: [...(h.equipped ?? []), ...(h.backpack ?? [])], bonuses: info?.bonuses ?? [], machine: !!info?.warMachine };
  for (const rule of ARTIFACT_RULES) {
    const v = rule(a);
    if (v !== undefined) return v;
  }
  return a.base;
}
/** An artifact weighed for a hero: its class's worth, what the hero carries, its bonuses. */
interface Held {
  s: AdventureState;
  w: World;
  h: Hero;
  id: number;
  base: number;
  carried: number[];
  bonuses: NonNullable<NonNullable<(typeof ARTIFACT_INFO)[number]>["bonuses"]>;
  machine: boolean;
}
/** A rule for some artifacts: their worth, or undefined when it doesn't speak for this one. */
type ArtifactRule = (a: Held) => number | undefined;
const creatureOf = (w: World, x: ArmySlot | null) => (x ? w.creatures[x.creature] : undefined);
const hasBonus = (a: Held, ...types: string[]) => a.bonuses.some((b) => types.includes(b.type));

/** The last missing part of a combination whose other parts we hold: the whole is worth more than the parts. */
const finishesSet: ArtifactRule = ({ w, h, id, base }) => {
  const finishes = completes(h, id);
  return finishes ? Math.max(base, TIER_WORTH[w.data.artifacts[Number(finishes[0])]?.tier ?? "R"] ?? 9000) * 1.5 : undefined;
};
/** @wiki thing/spell-book thing/ballista thing/ammo-cart thing/first-aid-tent thing/catapult A second spellbook or war machine: nothing. */
const oneOfEach: ArtifactRule = ({ id, base, carried, machine }) => (id === SPELLBOOK_ARTIFACT || machine ? (carried.includes(id) ? 0 : base) : undefined);
/** Nothing to its effect (or nothing known): its class's worth. */
const plain: ArtifactRule = ({ base, bonuses }) => (bonuses.length ? undefined : base);
/** @wiki thing/amulet-of-the-undertaker thing/vampire-s-cowl thing/dead-man-s-boots thing/cloak-of-the-undead-king Necromancy's: only with Necromancy. */
const necromancy: ArtifactRule = (a) => (hasBonus(a, "UNDEAD_RAISE_PERCENTAGE", "IMPROVED_NECROMANCY") ? (skillLevel(a.h.skills, "necromancy") ? a.base * 1.5 : 0) : undefined);
/** @wiki thing/boots-of-levitation thing/sea-captain-s-hat thing/admiral-s-hat thing/necklace-of-ocean-guidance The sea's: only on a map with water. */
const sea: ArtifactRule = (a) => (hasBonus(a, "WATER_WALKING", "WHIRLPOOL_PROTECTION", "FREE_SHIP_BOARDING") || a.bonuses.some((b) => b.subtype === "heroMovementSea") ? (mapHasWater(a.w) ? a.base * 1.5 : 0) : undefined);
/** @wiki thing/bow-of-elven-cherrywood thing/bowstring-of-the-unicorn-s-mane thing/angel-feather-arrows thing/golden-bow thing/bow-of-the-sharpshooter Archery's: little without shooters. */
const archery: ArtifactRule = ({ w, h, base, bonuses }) =>
  bonuses.some((b) => b.subtype === "damageTypeRanged" || b.type === "FREE_SHOOTING" || b.type === "NO_DISTANCE_PENALTY") ? (h.army.some((x) => creatureOf(w, x)?.abilities.some((a) => a.type === "SHOOTER")) ? base : base * 0.1) : undefined;
/** @wiki thing/power-of-the-dragon-father thing/dragon-scale-armor thing/crown-of-dragontooth thing/vial-of-dragon-blood For dragons only: little without dragons. */
const dragons: ArtifactRule = ({ w, h, base, bonuses }) =>
  bonuses.some((b) => b.limiters?.includes("DRAGON_NATURE")) ? (h.army.some((x) => creatureOf(w, x)?.abilities.some((a) => a.type === "DRAGON_NATURE")) ? base : base * 0.1) : undefined;
/** @wiki thing/orb-of-inhibition thing/recanter-s-cloak thing/cape-of-silence They block the wearer's own spells too: nothing to a hero with spells they'd block. */
const blocksMagic: ArtifactRule = ({ w, h, carried, bonuses }) => {
  const block = bonuses.find((b) => b.type === "BLOCK_ALL_MAGIC" || b.type === "BLOCK_MAGIC_ABOVE" || b.type === "BLOCK_MAGIC_BELOW");
  if (!block || !carried.includes(SPELLBOOK_ARTIFACT)) return undefined;
  const blocked = (level: number) => block.type === "BLOCK_ALL_MAGIC" || (block.type === "BLOCK_MAGIC_ABOVE" ? level > (block.val ?? 0) : level < (block.val ?? 0));
  const all = w.data.spells ?? [];
  const levelOf = (id: number) => all.find((x) => x.id === id)?.level ?? 0;
  return (heroSpells(h, all) ?? []).some((id) => levelOf(id) > 0 && blocked(levelOf(id))) ? 0 : undefined;
};
/**
 * @wiki thing/tome-of-fire-magic thing/tome-of-air-magic thing/tome-of-water-magic thing/tome-of-earth-magic thing/orb-of-the-firmament thing/collar-of-conjuring thing/wizard-s-well thing/charm-of-mana
 * Spell power and mana: for a hero who can cast (half with a mage guild to buy a book, nothing with neither).
 */
const magic: ArtifactRule = ({ s, h, base, carried, bonuses }) => {
  if (!bonuses.every((b) => MAGIC_BONUS.has(b.type) || (b.type === "PRIMARY_SKILL" && (b.subtype === "spellpower" || b.subtype === "knowledge") && (b.val ?? 0) > 0))) return undefined;
  const book = carried.includes(SPELLBOOK_ARTIFACT);
  const guild = s.objects.some((o) => o.town && o.owner === h.owner && o.town.built.includes(B.MAGE_GUILD_1));
  return book ? base : guild ? base * 0.5 : 0;
};
/** @wiki thing/badge-of-courage thing/crest-of-valor thing/glyph-of-gallantry Morale: nothing to an army that feels none (the undead). */
const morale: ArtifactRule = ({ w, h, base, bonuses }) => {
  if (!bonuses.every((b) => b.type === "MORALE" && (b.val ?? 0) > 0 && !b.limiters?.length)) return undefined;
  return h.army.some((x) => creatureOf(w, x) && feelsMorale(creatureOf(w, x)!)) ? base : 0;
};
/** The artifact rules, in the order they're asked. */
const ARTIFACT_RULES: ArtifactRule[] = [finishesSet, oneOfEach, plain, necromancy, sea, archery, dragons, blocksMagic, magic, morale];

/**
 * What a guard keeps the hero from: the objects next to it whose entrance can't be reached without
 * fighting it (a treasure behind its guard, a mine with a monster at its gate).
 */
export function guardedLoot(s: AdventureState, w: World, h: Hero, guard: AdvObject, paths: Map<number, unknown>, enemies: Hero[], near: NearGrid): number {
  if (guard.type !== Obj.MONSTER) return 0;
  // A guard over half our strength costs most of the army (1.7 r^2 of it): nothing behind it is worth that.
  if ((guard.amount ?? 0) * (w.creatures[guard.subid]?.aiValue ?? 0) > LOOT_RISK * power(w, h)) return 0;
  let v = 0;
  // (The objects in the 8x8 blocks around it, in the state's order, not a scan of the whole map.)
  const around: number[] = [];
  for (let by = (guard.y - 3) >> 3; by <= (guard.y + 3) >> 3; by++) for (let bx = (guard.x - 3) >> 3; bx <= (guard.x + 3) >> 3; bx++) around.push(...(near.get(nearKey(bx, by, guard.z)) ?? []));
  around.sort((a, b) => a - b);
  for (const k of around) {
    const o = s.objects[k];
    if (o.removed || o === guard || o.type === Obj.MONSTER || o.z !== guard.z || Math.abs(o.x - guard.x) > 3 || Math.abs(o.y - guard.y) > 3) continue;
    const gate = visitTile(w, o);
    // (The way in being the guard's own tile counts as guarded: a path there is the fight.)
    if (gate < 0 || (paths.has(gate) && gate !== w.index(guard.x, guard.y, guard.z))) continue;
    const gx = gate % w.size;
    const gy = Math.floor(gate / w.size) % w.size;
    // Its way in passes the guard: the gate is the guard's tile or right next to it.
    if (Math.max(Math.abs(gx - guard.x), Math.abs(gy - guard.y)) <= 1) v += Math.max(0, objectValue(s, w, h, o, enemies));
  }
  return v;
}

/** Objects other than monsters by 8x8 block of the map: their indices in the state's list. */
export type NearGrid = Map<number, number[]>;
const nearKey = (bx: number, by: number, z: number) => (z * 4096 + by) * 4096 + bx;
export function nearGrid(s: AdventureState): NearGrid {
  const g: NearGrid = new Map();
  s.objects.forEach((o, k) => {
    if (o.removed || o.type === Obj.MONSTER) return;
    const key = nearKey(o.x >> 3, o.y >> 3, o.z);
    g.get(key)?.push(k) ?? g.set(key, [k]);
  });
  return g;
}

/** Is there sea worth sailing (5% of the map or more)? */
export function mapHasWater(w: World): boolean {
  if (!hasWater.has(w)) hasWater.set(w, w.map.tiles.filter((t) => t.terrain === Terrain.WATER).length > w.map.tiles.length * 0.05);
  return hasWater.get(w)!;
}

/** Any living troops in the army (morale touches them; the undead and the non-living it doesn't). */
export function livingArmy(w: World, h: Hero): boolean {
  return h.army.some((x) => x && w.creatures[x.creature] && feelsMorale(w.creatures[x.creature]));
}

/**
 * What learning a skill is worth to this hero: nothing when known already or with no room left;
 * Navigation only with water, Archery with shooters, Leadership for the living, the magic skills
 * for a hero with a spellbook.
 */
export function skillWorth(s: AdventureState, w: World, h: Hero, id: number): number {
  if ((h.skills ?? []).some(([k]) => k === id) || (h.skills ?? []).length >= MAX_SKILLS) return 0;
  const key = SKILLS[id];
  if (key === "navigation") return mapHasWater(w) ? 2500 : 0;
  if (key === "archery") return h.army.some((x) => x && w.creatures[x.creature]?.abilities.some((a) => a.type === "SHOOTER")) ? 2000 : 300;
  if (key === "leadership") return livingArmy(w, h) ? 2000 : 0;
  if (["wisdom", "airMagic", "earthMagic", "fireMagic", "waterMagic", "sorcery", "intelligence", "mysticism", "scholar", "eagleEye"].includes(key)) return h.spells ? 2000 : 300;
  return 2000;
}

