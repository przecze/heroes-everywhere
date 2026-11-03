// Worn artifacts and their bonuses (slots from ARTRAITS.TXT, bonuses from VCMI / the HotA mod).
import { type ArtifactBonus, ARTIFACT_INFO } from "../artifactData.ts";
import { HOTA_ARTIFACTS as HOTA_ARTIFACT_DATA } from "../../../vcmi-data/src/hotaArtifacts.ts";
import type { SpellInfo } from "../spells.ts";
import type { Hero } from "./types.ts";
import { Refusal } from "../refusal.ts";
import type { CreatureStats } from "../creatures.ts";
import { specialtyStat, speedBonus } from "../specialty.ts";

/** Paper-doll slots, in the original order. */
export const SLOT = {
  HEAD: 0, SHOULDERS: 1, NECK: 2, RIGHT_HAND: 3, LEFT_HAND: 4, TORSO: 5, RIGHT_RING: 6, LEFT_RING: 7, FEET: 8,
  MISC1: 9, MISC2: 10, MISC3: 11, MISC4: 12, MISC5: 13, MACH1: 14, MACH2: 15, MACH3: 16, MACH4: 17, SPELLBOOK: 18,
} as const;
export const SLOT_COUNT = 19;
export const SPELLBOOK_ARTIFACT = 0;

/** The artifacts table entries this module needs. */
export interface ArtifactTraits {
  name: string;
  slots?: number[];
}

/**
 * HotA's own artifacts, for game files whose ARTRAITS.TXT only has the original 144: class
 * (T treasure, N minor, J major, R relic), slot, name, value and text from the HotA mod (packages/vcmi-data). The Golden Goose is a combination, so it never turns up at random.
 */
const MISC = [SLOT.MISC1, SLOT.MISC2, SLOT.MISC3, SLOT.MISC4, SLOT.MISC5];
const RINGS = [SLOT.RIGHT_RING, SLOT.LEFT_RING];
export const HOTA_ARTIFACTS: Record<number, { tier: string; slots: number[]; name: string; cost: number; description: string }> = Object.fromEntries(
  Object.entries(HOTA_ARTIFACT_DATA).map(([id, a]) => [id, { tier: a.tier, slots: a.slot === "MISC" ? MISC : a.slot === "RING" ? RINGS : [SLOT[a.slot as keyof typeof SLOT]], name: a.name, cost: a.cost, description: a.description }]),
);

/** An artifact's class letter, from the game's table or HotA's own list. */
export const artifactTier = (artifacts: { tier?: string }[], id: number): string => artifacts[id]?.tier || HOTA_ARTIFACTS[id]?.tier || "";

/**
 * Artifacts that may turn up at random (map objects, rewards, banks): of these classes, never a
 * combination, never one the map bans.
 */
export function randomArtifactPool(artifacts: { tier?: string }[], tiers: string, banned: number[] = []): number[] {
  const ids = [...artifacts.keys()].filter((id) => id <= 143).concat(Object.keys(HOTA_ARTIFACTS).map(Number));
  return ids.filter((id) => id > 6 && !ARTIFACT_INFO[id]?.components && !banned.includes(id) && tiers.includes(artifactTier(artifacts, id)));
}

/** A worn slot taken by a combination artifact's part (drawn as the lock). */
export const LOCKED = -2;

/** Combination artifacts -> the artifacts they're made of. */
export const COMBOS: Record<number, number[]> = (() => {
  const byKey = new Map(Object.entries(ARTIFACT_INFO).map(([id, a]) => [a.key, Number(id)]));
  const out: Record<number, number[]> = {};
  for (const [id, a] of Object.entries(ARTIFACT_INFO)) if (a.components?.length) out[Number(id)] = a.components.map((k) => byKey.get(k) ?? -1).filter((x) => x >= 0);
  return out;
})();

/** Combinations whose every part the hero is wearing. */
export function assemblable(h: Hero): number[] {
  const worn = new Set(h.equipped ?? []);
  return Object.entries(COMBOS)
    .filter(([, parts]) => parts.length && parts.every((p) => worn.has(p)))
    .map(([id]) => Number(id));
}

/** The part of a combination that is picked up last in its scene (the others are already worn); the artifact itself for anything else. */
export const lastPartOf = (id: number): number => (COMBOS[id]?.length ? COMBOS[id][COMBOS[id].length - 1] : id);

/** The slots an artifact may be worn in (the game's table, else HotA's own list). */
export const slotsOf = (artifacts: ArtifactTraits[], id: number): number[] => artifacts[id]?.slots ?? HOTA_ARTIFACTS[id]?.slots ?? [];

/**
 * Where a combination's parts go when it is worn in `slot` (VCMI's CCombinedArtifactInstance):
 * the first part that may sit in that slot sits "in" it, every other part locks a free slot of its
 * own kind. The parts in that order (the one in the slot first) and the slots locked for the rest,
 * or null when they don't all fit. Nothing changes.
 */
export function comboFit(artifacts: ArtifactTraits[], eq: number[], combo: number, slot: number): { parts: number[]; locked: number[] } | null {
  const all = COMBOS[combo];
  if (!all?.length) return null;
  const main = Math.max(0, all.findIndex((p) => slotsOf(artifacts, p).includes(slot)));
  const parts = [all[main], ...all.filter((_, i) => i !== main)];
  const locked: number[] = [];
  for (const p of parts.slice(1)) {
    const free = slotsOf(artifacts, p).find((sl) => sl !== slot && sl !== SLOT.SPELLBOOK && eq[sl] === -1 && !locked.includes(sl));
    if (free === undefined) return null;
    locked.push(free);
  }
  return { parts, locked };
}

/** Puts a combination on in `slot` (free), locking its parts' slots; throws, with nothing changed, when they don't fit. */
export function wearCombo(artifacts: ArtifactTraits[], h: Hero, combo: number, slot: number) {
  const eq = h.equipped!;
  const fit = comboFit(artifacts, eq, combo, slot);
  if (!fit) throw new Refusal("there's no room for all its parts");
  eq[slot] = combo;
  for (const sl of fit.locked) eq[sl] = LOCKED;
  (h.combos ??= {})[slot] = { combo, ...fit };
}

/**
 * Puts the worn parts together. The combination goes in its own slot (the Angelic Alliance in the
 * weapon hand, the Elixir of Life among the miscellaneous): the slot of the part that may sit there;
 * the other parts' slots are locked.
 */
export function assemble(artifacts: ArtifactTraits[], h: Hero, combo: number) {
  const parts = COMBOS[combo];
  if (!parts || !assemblable(h).includes(combo)) throw new Refusal("not all the parts are worn");
  const eq = h.equipped!;
  const own = slotsOf(artifacts, combo);
  const at = parts.map((p) => eq.indexOf(p));
  const slot = at.find((sl) => own.includes(sl)) ?? at[0];
  for (const sl of at) eq[sl] = -1;
  // The parts' own slots are free again: the combination takes them back (each part locks one of its own).
  const fit = comboFit(artifacts, eq, combo, slot);
  if (!fit) {
    parts.forEach((p, i) => (eq[at[i]] = p));
    throw new Refusal("there's no room for all its parts");
  }
  eq[slot] = combo;
  for (const sl of fit.locked) eq[sl] = LOCKED;
  (h.combos ??= {})[slot] = { combo, ...fit };
}

/** Takes a worn combination apart again, each part back in its slot. */
export function disassemble(h: Hero, slot: number) {
  const c = h.combos?.[slot];
  if (!c || h.equipped?.[slot] !== c.combo) throw new Refusal("no combination there");
  const eq = h.equipped!;
  eq[slot] = c.parts[0];
  c.locked.forEach((sl, i) => (eq[sl] = c.parts[i + 1]));
  delete h.combos![slot];
}

/** A combination leaving its slot frees the slots it locked. */
export function releaseCombo(h: Hero, slot: number) {
  const c = h.combos?.[slot];
  if (!c) return;
  for (const sl of c.locked) if (h.equipped?.[sl] === LOCKED) h.equipped[sl] = -1;
  delete h.combos![slot];
}

/** Takes what is worn in a slot off (a combination frees its locks); the artifact, or -1. */
function takeOff(h: Hero, slot: number): number {
  const art = h.equipped![slot];
  if (art < 0) return -1;
  if (h.combos?.[slot]) releaseCombo(h, slot);
  h.equipped![slot] = -1;
  return art;
}

/**
 * Takes an artifact away from the hero, from the backpack first, then worn (a combination frees the
 * slots it locked; with `combos` false a worn combination stays). False, with nothing taken, if the hero hasn't it.
 */
export function takeArtifact(h: Hero, id: number, combos = true): boolean {
  const bi = (h.backpack ?? []).indexOf(id);
  if (bi >= 0) return void h.backpack!.splice(bi, 1), true;
  const ei = (h.equipped ?? []).indexOf(id);
  if (ei < 0 || (!combos && h.combos?.[ei])) return false;
  takeOff(h, ei);
  return true;
}

/** Wears an artifact in a free slot (a combination locks its parts' slots). */
function putOn(artifacts: ArtifactTraits[], h: Hero, art: number, slot: number) {
  if (COMBOS[art]) wearCombo(artifacts, h, art, slot);
  else h.equipped![slot] = art;
}

/** A place on a hero: a worn slot, or the backpack (an index there, or none for its end; a move puts it at that index). */
export interface ArtifactPlace {
  slot?: number;
  backpack?: number;
}

/**
 * Moves an artifact between the worn slots and backpacks of one hero or two (the hero screen and
 * the exchange window). A worn combination takes its locks along; what is worn in the target slot
 * changes places with it (to the source slot, or the source's backpack). All or nothing: a move
 * the rules refuse changes nothing.
 */
export function moveArtifact(artifacts: ArtifactTraits[], src: Hero, from: ArtifactPlace, dst: Hero, to: ArtifactPlace) {
  initEquipment(src);
  initEquipment(dst);
  const art = from.slot !== undefined ? (src.equipped![from.slot] ?? -1) : ((src.backpack ?? [])[from.backpack ?? -1] ?? -1);
  if (art < 0) throw new Refusal("nothing there");
  if (from.slot === SLOT.SPELLBOOK || to.slot === SLOT.SPELLBOOK) throw new Refusal("the spellbook stays where it is");
  // Every hero has the catapult, for good: it never leaves its slot (nor would another fit there).
  if (from.slot === SLOT.MACH4 || to.slot === SLOT.MACH4) throw new Refusal("the catapult stays where it is");
  if (to.slot !== undefined && (to.slot < 0 || to.slot >= SLOT_COUNT || !slotsOf(artifacts, art).includes(to.slot))) throw new Refusal("it doesn't go there");
  // Within one backpack: moved to another place in it (a place past its end: the end).
  if (src === dst && to.slot === undefined && from.slot === undefined) {
    const bag = src.backpack ?? [];
    const at = Math.min(to.backpack ?? bag.length, bag.length - 1);
    if (at !== from.backpack) bag.splice(at, 0, ...bag.splice(from.backpack!, 1));
    return;
  }
  // HotA's Cannon never goes in the pack: it only changes places with another machine slot's cannon or ballista.
  if (art === CANNON && to.slot === undefined) throw new Refusal("the cannon can't go in the backpack");
  if (from.slot === undefined && to.slot !== undefined && dst.equipped![to.slot] === CANNON) throw new Refusal("the cannon can't go in the backpack");
  const saved = [src, dst].map((h) => ({ h, equipped: [...h.equipped!], backpack: [...(h.backpack ?? [])], combos: structuredClone(h.combos ?? {}) }));
  try {
    if (from.slot !== undefined) takeOff(src, from.slot);
    else (src.backpack ??= []).splice(from.backpack!, 1);
    if (to.slot === undefined) {
      // At the backpack's place picked, else its end.
      const bag = (dst.backpack ??= []);
      bag.splice(Math.min(to.backpack ?? bag.length, bag.length), 0, art);
      return;
    }
    if (dst.equipped![to.slot] === LOCKED) throw new Refusal("that slot is taken by a combination artifact");
    const there = takeOff(dst, to.slot);
    putOn(artifacts, dst, art, to.slot);
    if (there >= 0) {
      if (from.slot === undefined) (src.backpack ??= []).push(there);
      else if (!slotsOf(artifacts, there).includes(from.slot) || src.equipped![from.slot] !== -1) throw new Refusal("can't swap those");
      else putOn(artifacts, src, there, from.slot);
    }
  } catch (e) {
    for (const x of saved) {
      x.h.equipped = x.equipped;
      x.h.backpack = x.backpack;
      x.h.combos = x.combos;
    }
    throw e;
  }
}

/** War machine artifacts and their slots: ballista, ammo cart, first aid tent, catapult, and HotA's Cannon (in the ballista's slot). */
export const MACHINE_SLOT: Record<number, number> = { 4: SLOT.MACH1, 5: SLOT.MACH2, 6: SLOT.MACH3, 3: SLOT.MACH4, 146: SLOT.MACH1 };
/** The creature behind each machine artifact. */
export const MACHINE_CREATURE: Record<number, number> = { 4: 146, 5: 148, 6: 147, 3: 145, 146: 150 };

/** What a war machine costs to buy (its creature's price in gold: Blacksmith, War Machine Factory). */
export function machinePrice(w: { creatures: { cost: number[] }[] }, artifact: number): number {
  return w.creatures[MACHINE_CREATURE[artifact]]?.cost[6] ?? 0;
}
export const CANNON = 146;

/** Starts the paper doll: a spellbook for heroes who have one, and the catapult every hero has. */
export function initEquipment(h: Hero) {
  if (!h.equipped || h.equipped.length !== SLOT_COUNT) h.equipped = Array(SLOT_COUNT).fill(-1);
  if (h.spells && h.equipped[SLOT.SPELLBOOK] < 0) h.equipped[SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
  if (h.equipped[SLOT.MACH4] < 0) h.equipped[SLOT.MACH4] = 3;
}

/** The hero's war machines (artifact ids in the machine slots). */
export function heroMachines(h: Hero): number[] {
  return [SLOT.MACH1, SLOT.MACH2, SLOT.MACH3, SLOT.MACH4].map((sl) => h.equipped?.[sl] ?? -1).filter((a) => a >= 0);
}

/** Puts an artifact in its first free slot; false (and nothing changes) when there's none. */
export function equipArtifact(h: Hero, artifacts: ArtifactTraits[], id: number): boolean {
  initEquipment(h);
  // A combination needs room for its parts too (their slots locked).
  const slot = slotsOf(artifacts, id).find((sl) => sl !== SLOT.SPELLBOOK && h.equipped![sl] === -1 && (!COMBOS[id] || comboFit(artifacts, h.equipped!, id, sl)));
  if (slot === undefined) return false;
  putOn(artifacts, h, id, slot);
  return true;
}

/** Picks up an artifact: worn if a slot is free, else into the backpack. */
export const SPELL_SCROLL = 1;

/** A Spell Scroll with its spell. */
export function giveScroll(h: Hero, artifacts: ArtifactTraits[], spell: number) {
  (h.scrolls ??= []).push(spell);
  giveArtifact(h, artifacts, SPELL_SCROLL);
}

export function giveArtifact(h: Hero, artifacts: ArtifactTraits[], id: number) {
  // A spellbook found on the map: the hero can cast from now on (a second one goes in the pack).
  if (id === SPELLBOOK_ARTIFACT && !h.spells) {
    initEquipment(h);
    h.spells = [];
    h.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
    return;
  }
  // HotA's Cannon can't wait in the pack: it takes the ballista's place.
  if (id === CANNON) {
    initEquipment(h);
    h.equipped![SLOT.MACH1] = CANNON;
    return;
  }
  if (!equipArtifact(h, artifacts, id)) (h.backpack ??= []).push(id);
}

/** A worn artifact that holds a value at 0 for everyone (the Spirit of Oppression's morale, the Hourglass's luck). */
export const capsAtZero = (h: Hero, type: string) => heroBonuses(h).some((b) => b.type === type && b.val === 0 && !b.limiters?.length);

/** Every artifact at work on the hero: the worn ones, and the parts of the combinations put together (which keep their own effects, added to the combination's). */
export function wornArtifacts(h: Hero): number[] {
  const out = (h.equipped ?? []).filter((id) => id >= 0);
  // Only a combination still worn where it was put on (a stale record gives nothing).
  for (const [slot, c] of Object.entries(h.combos ?? {})) if (h.equipped?.[Number(slot)] === c.combo) out.push(...c.parts);
  return out;
}

/** All bonuses of the worn artifacts. */
/**
 * The worn artifacts whose bonuses count: two of a kind count once, but for the Quiet Eye of the
 * Dragon (heroes.thelazy.net's Artifacts page; the resource makers stack too, counted elsewhere).
 */
export function bonusArtifacts(h: Hero): number[] {
  const seen = new Set<number>();
  return wornArtifacts(h).filter((id) => {
    if (id === 37) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function heroBonuses(h: Hero): ArtifactBonus[] {
  const out: ArtifactBonus[] = [];
  for (const id of bonusArtifacts(h)) out.push(...(ARTIFACT_INFO[id]?.bonuses ?? []));
  for (const b of h.timed ?? []) if (b.active) out.push({ type: b.type, subtype: b.subtype, val: b.val } as ArtifactBonus);
  return out;
}

/** The artifact bonuses that matter in battle, tagged with their artifact (own side only). */
export function battleBonuses(h: Hero): { type: string; subtype?: string; val?: number; artifact?: number; creatures?: string }[] {
  const out: { type: string; subtype?: string; val?: number; artifact?: number; creatures?: string }[] = [];
  for (const id of bonusArtifacts(h)) {
    for (const b of ARTIFACT_INFO[id]?.bonuses ?? []) {
      if (b.limiters?.includes("OPPOSITE_SIDE")) continue;
      // Only some creatures (the Vial of Dragon Blood: dragons): kept with the ability they need.
      const creatures = b.limiters?.find((l) => l !== "OPPOSITE_SIDE");
      if (creatures) out.push({ type: b.type, subtype: b.subtype, val: b.val, artifact: id, creatures });
      else if (BATTLE_TYPES.has(b.type)) out.push({ type: b.type, subtype: b.subtype, val: b.val, artifact: id });
    }
  }
  return out;
}

const BATTLE_TYPES = new Set([
  "PERCENTAGE_DAMAGE_BOOST", "STACKS_SPEED", "STACK_HEALTH", "SPELL_DAMAGE", "SPELL_DURATION", "MAGIC_RESISTANCE", "SPELL_IMMUNITY",
  "BLOCK_MAGIC_ABOVE", "BLOCK_MAGIC_BELOW", "BLOCK_ALL_MAGIC", "NO_DISTANCE_PENALTY", "NO_WALL_PENALTY", "FREE_SHOOTING", "BATTLE_NO_FLEEING",
  "OPENING_BATTLE_SPELL", "LEVEL_SPELL_IMMUNITY", "MIND_IMMUNITY", "HP_REGENERATION", "SURRENDER_DISCOUNT", "LEARN_BATTLE_SPELL_CHANCE", "DISINTEGRATE",
  // The Orb of Vulnerability: no natural immunity or resistance on the field.
  "NEGATE_ALL_NATURAL_IMMUNITIES", "SPELL_RESISTANCE_AURA",
  // The Horn of the Abyss: Fangarms rise from slain living stacks.
  "RAISE_FANGARMS",
]);

/** Sum of a bonus type (and subtype) on the hero's own side (not the "opposite side" ones, nor those for some creatures only). */
export function bonus(h: Hero, type: string, subtype?: string): number {
  return heroBonuses(h)
    .filter((b) => b.type === type && (subtype === undefined || b.subtype === subtype) && !b.limiters?.length)
    .reduce((a, b) => a + (b.val ?? 0), 0);
}

/** Bonuses the hero's artifacts put on the enemy (e.g. Demon's Horseshoe: -1 luck). */
export function enemyBonus(h: Hero, type: string): number {
  return heroBonuses(h)
    .filter((b) => b.type === type && b.limiters?.includes("OPPOSITE_SIDE"))
    .reduce((a, b) => a + (b.val ?? 0), 0);
}

export const hasBonus = (h: Hero, type: string) => heroBonuses(h).some((b) => b.type === type);

const PRIMARY = ["attack", "defence", "spellpower", "knowledge"];

/** Attack, defense, power and knowledge with artifacts. */
export function effectivePrimary(h: Hero): [number, number, number, number] {
  // As in the original: Attack and Defense never below 0, Power and Knowledge never below 1.
  return h.primary.map((v, i) => Math.max(i < 2 ? 0 : 1, v + bonus(h, "PRIMARY_SKILL", PRIMARY[i]))) as [number, number, number, number];
}

/** A stack's attack, defence and speed under its hero out of battle (the creature window): its specialty, the hero's
 * primary skills, speed artifacts (as the battle's, before terrain and spells). */
export function stackSkills(h: Hero, c: CreatureStats): { attack: number; defense: number; speed: number } {
  const p = effectivePrimary(h);
  return { attack: specialtyStat(h, c, "attack") + p[0], defense: specialtyStat(h, c, "defence") + p[1], speed: c.speed + speedBonus(h, c.id) + bonus(h, "STACKS_SPEED") };
}

/** Where a stack's bonus comes from out of battle: the hero's own skill, his specialty, or an artifact he wears. */
export interface StackPart {
  kind: "hero" | "specialty" | "artifact" | "other";
  artifact?: number;
  val: number;
}

/** stackSkills' bonuses told apart by source (the creature window's breakdown); the parts add up to its numbers minus the creature's own. */
export function stackSkillParts(h: Hero, c: CreatureStats): { attack: StackPart[]; defense: StackPart[]; speed: StackPart[] } {
  const out = { attack: [] as StackPart[], defense: [] as StackPart[], speed: [] as StackPart[] };
  const stat: [keyof typeof out, string, number][] = [["attack", "attack", 0], ["defense", "defence", 1]];
  for (const [key, name, i] of stat) {
    const own = h.primary[i] ?? 0;
    const arts = bonusArtifacts(h).flatMap((id) => (ARTIFACT_INFO[id]?.bonuses ?? []).filter((b) => b.type === "PRIMARY_SKILL" && b.subtype === name && !b.limiters?.length && b.val).map((b) => ({ id, val: b.val! })));
    if (own) out[key].push({ kind: "hero", val: own });
    for (const a of arts) out[key].push({ kind: "artifact", artifact: a.id, val: a.val });
    const spec = specialtyStat(h, c, name as "attack" | "defence") - (key === "attack" ? c.attack : c.defense);
    if (spec) out[key].push({ kind: "specialty", val: spec });
  }
  const sp = speedBonus(h, c.id);
  if (sp) out.speed.push({ kind: "specialty", val: sp });
  for (const id of bonusArtifacts(h)) for (const b of ARTIFACT_INFO[id]?.bonuses ?? []) if (b.type === "STACKS_SPEED" && !b.limiters?.length && b.val) out.speed.push({ kind: "artifact", artifact: id, val: b.val });
  // Whatever else the numbers hold (a visited place's lasting bonus): one more line.
  const total = stackSkills(h, c);
  const base = { attack: c.attack, defense: c.defense, speed: c.speed };
  for (const k of ["attack", "defense", "speed"] as const) {
    const rest = total[k] - base[k] - out[k].reduce((a, p) => a + p.val, 0);
    if (rest) out[k].push({ kind: "other", val: rest });
  }
  return out;
}

/** Spells the hero can cast: the spellbook plus tomes (whole schools) and artifacts granting spells. */
export function heroSpells(h: Hero, spells: SpellInfo[]): number[] | undefined {
  if (!h.spells) return undefined;
  const out = new Set(h.spells);
  // Titan's Lightning Bolt (57) is special: only Titan's Thunder gives it, never a tome or the Spellbinder's Hat.
  const ordinary = (sp: SpellInfo) => sp.id < 70 && sp.id !== 57;
  for (const b of heroBonuses(h)) {
    if (b.type === "SPELLS_OF_SCHOOL") for (const sp of spells) if (ordinary(sp) && sp.level > 0 && sp.schools.includes(b.subtype as never)) out.add(sp.id);
    // (The level is in the subtype, "spellLevel5"; the value is something else.)
    if (b.type === "SPELLS_OF_LEVEL") {
      const level = Number(/(\d)$/.exec(b.subtype ?? "")?.[1] ?? b.val);
      for (const sp of spells) if (ordinary(sp) && sp.level === level) out.add(sp.id);
    }
    // Armageddon's Blade, Titan's Thunder, the Sea Captain's Hat: their own spells.
    if (b.type === "SPELL") for (const sp of spells) if (sp.key === b.subtype || (b.subtype === "titanBolt" && sp.id === 57)) out.add(sp.id);
  }
  // Spell Scrolls: their spells while they're carried.
  const held = [...(h.equipped ?? []), ...(h.backpack ?? [])].filter((a) => a === SPELL_SCROLL).length;
  for (const sp of (h.scrolls ?? []).slice(0, held)) out.add(sp);
  return [...out];
}
