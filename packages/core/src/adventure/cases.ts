// Playable cases: a small random map made around one thing to try (a building, an artifact, a map
// object, a creature, a spell, a skill or a hero), opened from a link (the Matrix tab's "Play").
// Nothing is stored: the case rides in the random map's name (":c-<kind>-<id>[-<sub>]", rmg.ts),
// the generator puts its object a few steps from the player's town, and applyCase (create.ts)
// sets up the rest: the town grown, a hero with an army, resources to spend.
import { type HasRng } from "../rng.ts";
import { skillId } from "../skills.ts";
import { SLOT, SPELLBOOK_ARTIFACT, giveArtifact, initEquipment } from "./artifacts.ts";
import { SPELL } from "../spells.ts";
import { makeHero } from "./create.ts";
import { experienceForLevel } from "./experience.ts";
import { maxMana } from "./magic.ts";
import { findPaths, maxMovement } from "./movement.ts";
import { UPGRADE_OF, applyAdventureAction } from "./rules.ts";
import { grow, levelUp, muster } from "./starts.ts";
import { B, buildingCost, dwellingLevel } from "./town.ts";
import { type AdvObject, type AdventureState, type ArmySlot, type Hero, Obj } from "./types.ts";
import { visit as visitObject } from "./visit.ts";
import { type World, Terrain, maskTiles, reveal, tileSpan } from "./world.ts";

export type CaseKind = "building" | "artifact" | "object" | "creature" | "spell" | "skill" | "hero";
export const CASE_KINDS: CaseKind[] = ["building", "artifact", "object", "creature", "spell", "skill", "hero"];

export interface CaseSpec {
  kind: CaseKind;
  /** The building, artifact, object type, creature, spell, skill or hero. */
  id: number;
  /** A map object's subtype. */
  sub?: number;
  /**
   * A dilemma: the thing behind a guard worth this share of the hero's army (percent of its
   * fight value; a creature's own stack is that big). With `context`, the situation that makes it
   * worth the price or worthless (CASE_CONTEXTS). An AI that understands what things are worth
   * pays in one and not the other.
   */
  price?: number;
  context?: string;
}

/** The map object a case puts beside the player's town ([type, subtype]), if any. */
export function caseObject(c: CaseSpec): [number, number] | null {
  // A dilemma's spell, skill or hero comes on the map's own carrier: a Spell Scroll, a Witch Hut, a Prison.
  if (c.price !== undefined) {
    if (c.kind === "spell") return [SPELL_SCROLL_OBJ, 0];
    if (c.kind === "skill") return [WITCH_HUT, 0];
    if (c.kind === "hero") return [Obj.PRISON, 0];
  }
  if (c.kind === "artifact") return [Obj.ARTIFACT, c.id];
  if (c.kind === "object") return [c.id, c.sub ?? 0];
  // A creature, and something to cast a spell on: a stack of them waiting.
  if (c.kind === "creature") return [Obj.MONSTER, c.id];
  if (c.kind === "spell") return [Obj.MONSTER, SPELL_FOES[c.id]?.[0] ?? PIKEMAN];
  return null;
}

const PIKEMAN = 0;
const SPELL_SCROLL_OBJ = 93;
const WITCH_HUT = 113;
/** What stands in front of a dilemma's object: Minotaurs (any creature would do; their number is the price). */
export const CASE_GUARD = 78;

/** The case object's own data on the map: a scroll's spell, a hut's skill, a prisoner, a guard's stance. */
export function caseObjectData(c: CaseSpec): Record<string, unknown> {
  if (c.price !== undefined && c.kind === "spell") return { spell: c.id };
  if (c.price !== undefined && c.kind === "skill") return { skills: [c.id] };
  // A prisoner worth freeing: a level 12 hero (a tavern's is level 1).
  if (c.price !== undefined && c.kind === "hero") return { hero: c.id, experience: experienceForLevel(12) };
  // A creature that is the price itself: it holds its ground (no fleeing, no joining).
  if (c.price !== undefined && c.kind === "creature") return { character: 4, noJoin: true, neverFlees: true };
  return {};
}
/**
 * The stack a spell's case puts up to cast it on, where Pikemen wouldn't do: [creature, count].
 * Undead for Destroy Undead, shooters for Forgetfulness, a stack under Hypnotize's limit, a fight
 * hard enough to lose troops for the healing spells.
 */
const SPELL_FOES: Record<number, [number, number]> = {
  25: [56, 60], // Destroy Undead: Skeletons
  61: [2, 30], // Forgetfulness: Archers
  60: [4, 4], // Hypnotize: a few Griffins
  37: [78, 12], // Cure: Minotaurs, a hard fight
  38: [78, 12], // Resurrection
  35: [66, 10], // Dispel: Black Knights (their blows curse)
  40: [78, 12], // Sacrifice: a hard fight, so some stack falls
};


/**
 * The army a spell's case gives the hero where the town's own wouldn't do: the undead for Death
 * Ripple and Animate Dead (which only they survive or come back from), the fire-proof for Armageddon.
 */
const SPELL_ARMY: Record<number, [number, number][]> = {
  24: [[56, 80], [58, 40], [60, 25], [62, 12]], // Death Ripple: Skeletons, Walking Dead, Wights, Vampires
  39: [[56, 80], [58, 40], [60, 25], [62, 12]], // Animate Dead
  26: [[83, 6], [53, 12]], // Armageddon: Black Dragons, Efreet Sultans (nothing of ours it burns)
  40: [[0, 10], [13, 6], [4, 20]], // Sacrifice: a few Pikemen to give up for Archangels (the stack the check fells)
};

/** How many stand in a case's monster stack: few of a creature to fight, many to cast a spell on. */
export function caseMonsterCount(c: CaseSpec, level: number): number {
  return c.kind === "spell" ? (SPELL_FOES[c.id]?.[1] ?? 30) : Math.max(1, 12 - 2 * level);
}

/** The case's part of a random map's name. */
export function caseSuffix(c: CaseSpec): string {
  return `:c-${c.kind}-${c.id}${c.sub !== undefined ? `-${c.sub}` : ""}${c.price !== undefined ? `:p-${c.price}` : ""}${c.context ? `:x-${c.context}` : ""}`;
}

/**
 * A case's map, as a name for New Game / a link: a small map, one computer rival far off, weak
 * monsters, the given town for the player (a building's own faction).
 */
export function caseMapName(c: CaseSpec, faction?: number, seed = 1): string {
  // (Islands for the situations about water: every zone an island, a boat on each.)
  // (Also for the spells about boats and water: Summon Boat, Scuttle Boat, Water Walk, Fly.)
  const islands = contextsOf(c).some((k) => CASE_CONTEXTS[k]?.islands) || (c.kind === "spell" && ([SPELL.SUMMON_BOAT, SPELL.SCUTTLE_BOAT, SPELL.WATER_WALK, SPELL.FLY] as number[]).includes(c.id)) ? ":i" : "";
  return `random:36:2:1:0:${seed}${islands}${faction !== undefined ? `:f-${faction}` : ""}${caseSuffix(c)}`;
}

/** Sets a case's game up (after the map's own start): the player's town and hero ready to try it. */
export function applyCase(s: AdventureState & HasRng, w: World, c: CaseSpec) {
  // The first player's, as rmg.ts placed it (whoever plays them: a person, or the computer in a test).
  const color = 0;
  if (!s.players[color]?.alive) return;
  const p = s.players[color];
  const town = s.objects.find((o) => o.town && !o.removed && o.owner === color);
  const hero = s.heroes.find((h) => !h.removed && h.owner === color);
  if (!town || !hero) return;
  // Plenty to spend: building, recruiting, markets, the object's price.
  p.resources = p.resources.map((_, i) => (i === 6 ? 100000 : 100));
  if (c.kind === "building") {
    // Everything but the building (and what needs it): the player builds it and sees it work.
    grow(s, w, town, "all", true, c.id);
    town.town!.builtToday = false;
  } else grow(s, w, town, 5, false);
  // A hero who can take on what's near: level 8, three weeks of the town's troops.
  levelUp(s, w, hero, 8, []);
  // (Town Portal's case: the troops stay in the town, and the hero starts far from it, to portal back for them.)
  const portalCase = c.kind === "spell" && c.price === undefined && c.id === SPELL.TOWN_PORTAL;
  if (!portalCase) muster(s, w, hero, town, 3);
  initEquipment(hero);
  // Nothing in the way of what's tried: no starting bonus artifacts (a Badge of Courage made the
  // hero's own troops immune to Mirth); the spellbook and war machines stay.
  const KEEP = new Set([0, 3, 4, 5, 6]);
  hero.equipped = hero.equipped!.map((a) => (a >= 0 && !KEEP.has(a) ? -1 : a));
  hero.backpack = [];
  if (c.kind === "creature") {
    const level = w.data.creatures[c.id]?.level ?? 1;
    hero.army[hero.army.findIndex((a) => !a) >= 0 ? hero.army.findIndex((a) => !a) : 6] = { creature: c.id, count: Math.max(2, 24 - 3 * level) };
  }
  if (c.kind === "spell" && c.price === undefined) {
    hero.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
    // Only that spell: the case is about it (and the AI, which casts its best, has nothing else).
    hero.spells = [c.id];
    hero.primary[3] = Math.max(hero.primary[3], 20);
    hero.mana = 10 * hero.primary[3];
    const army = SPELL_ARMY[c.id];
    if (army) hero.army = [...army.map(([creature, count]) => ({ creature, count })), ...Array<null>(7 - army.length).fill(null)];
    // Stranded on an island for Summon Boat, Water Walk and Fly: the boats taken away.
    if (c.id === SPELL.SUMMON_BOAT || c.id === SPELL.WATER_WALK || c.id === SPELL.FLY) for (const o of s.objects) if (o.type === Obj.BOAT && !o.removed && o.carriedBy === undefined) o.removed = true;
    if (c.id === SPELL.SCUTTLE_BOAT) {
      // A rival's hero beside a spare boat, the boat further from ours than two tiles and in sight.
      w.refresh(s);
      const rival = s.heroes.find((x) => !x.removed && x.owner !== color);
          const boat = s.objects.filter((o) => o.type === Obj.BOAT && !o.removed && o.carriedBy === undefined && o.z === hero.z && tileSpan(o, hero) > 2).sort((a, b) => tileSpan(a, hero) - tileSpan(b, hero))[0];
      if (rival && boat) {
        let spot = -1;
        for (let dy = -2; dy <= 2 && spot < 0; dy++)
          for (let dx = -2; dx <= 2 && spot < 0; dx++) {
            const i = w.index(boat.x + dx, boat.y + dy, boat.z);
            if (i >= 0 && w.map.tiles[i].terrain !== Terrain.WATER && !w.blocked(i) && !w.visitBy[i] && !w.heroAt[i]) spot = i;
          }
        if (spot >= 0) {
          [rival.x, rival.y, rival.z] = [spot % w.size, Math.floor(spot / w.size) % w.size, boat.z];
          reveal(s, w, color, boat.x, boat.y, boat.z, 3);
        }
      }
    }
    if (portalCase) {
      // Far from home: the farthest spot the hero can walk to.
      w.refresh(s);
      let far = -1;
      let cost = -1;
      for (const [i, node] of findPaths(w, s, hero)) if (node.cost > cost && !node.passOnly && !w.visitBy[i] && !w.heroAt[i] && !w.guardedBy[i]) [far, cost] = [i, node.cost];
      if (far >= 0) [hero.x, hero.y] = [far % w.size, Math.floor(far / w.size) % w.size];
      w.refresh(s);
      town.town!.available = town.town!.available.map((n) => n * 3);
    }
  }
  if (c.kind === "skill" && c.price === undefined) {
    const others = (hero.skills ?? []).filter(([id]) => id !== c.id).slice(0, 7);
    hero.skills = [[c.id, 3], ...others];
  }
  if (c.price !== undefined) setDilemma(s, w, c, hero, town);
  // The case object (rmg.ts placed it) in plain sight.
  reveal(s, w, color, hero.x, hero.y, hero.z, 10);
  // (Town Portal's case: tired too, so home is more than today's walk; the portal takes 300.)
  hero.movement = portalCase ? 400 : hero.maxMovement;
  s.log.push(`A case to try: ${c.kind} ${c.id}${c.sub !== undefined ? `/${c.sub}` : ""}.`);
  w.refresh(s);
}

/**
 * A case's battle recipe: the battle page's address (`?...#battle`) for a fight about it right away:
 * a creature against its own kind, a spell in the left hero's book, a skill at expert for the left
 * hero. Null for what only shows on the map. `level` is a creature's (its stack's size).
 */
export function caseBattle(c: CaseSpec, opts: { level?: number; skillKey?: string; spell?: { name: string; schools: string[]; text?: string } } = {}): string | null {
  const q = (params: Record<string, string>) => `?${new URLSearchParams({ ...params, new: "1" }).toString()}#battle`;
  if (c.kind === "creature") {
    const n = Math.max(1, 40 - 5 * (opts.level ?? 1));
    return q({ left: `${c.id}:${n}`, right: `${c.id}:${n}` });
  }
  // (Adventure spells, ids below 10, aren't cast in battle.)
  // A caster's hero (Spell Power 10, 100 mana, Expert in the spell's schools) and armies that show it (SPELL_FOES, SPELL_ARMY).
  if (c.kind === "spell" && c.id >= 10) {
    const stacks = (list: [number, number][]) => list.map(([id, n]) => `${id}:${n}`).join(",");
    const foe = SPELL_FOES[c.id];
    const schools = opts.spell?.schools ?? [];
    const skills = [...schools.map((sc) => `${sc}Magic:3`), "wisdom:3"].join(",");
    const params: Record<string, string> = {
      spells: String(c.id),
      left: stacks(SPELL_ARMY[c.id] ?? [[6, 20], [2, 20], [4, 10]]),
      right: stacks(foe ? [foe, [0, 30]] : [[0, 30], [0, 30]]),
      power: "10",
      know: "10",
      skills,
    };
    if (c.id === SPELL.EARTHQUAKE) params.siege = "castle";
    // Land Mine on dirt: Pikemen at home on grass would see the mines, and it couldn't be cast (heroes.thelazy.net Land Mine).
    if (c.id === SPELL.LAND_MINE) params.field = "dirt_hills";
    if (opts.spell) params.what = `${opts.spell.name}: cast it from your spellbook (your hero: Spell Power 10, which sets its damage or its rounds; 100 spell points; ${schools.length ? `Expert ${schools.map((sc) => `${sc[0].toUpperCase()}${sc.slice(1)}`).join(" and ")} Magic` : "no school"}).${opts.spell.text ? ` ${opts.spell.text}` : ""}`;
    return q(params);
  }
  // Only the skills that work in battle (Logistics, Estates, Navigation... show nothing there).
  if (c.kind === "skill" && opts.skillKey && BATTLE_SKILLS.has(opts.skillKey)) return q({ skills: `${opts.skillKey}:3` });
  return null;
}

/** Secondary skills that do something in battle (the rest act on the map or between days). */
const BATTLE_SKILLS = new Set(["offence", "armorer", "archery", "tactics", "artillery", "ballistics", "firstAid", "leadership", "luck", "resistance", "eagleEye", "airMagic", "earthMagic", "fireMagic", "waterMagic", "sorcery", "interference", "runes"]);

/** A skill case for a skill's key (the Matrix lists skills by key). */
export function skillCase(key: string): CaseSpec | null {
  const id = skillId(key);
  return id >= 0 ? { kind: "skill", id } : null;
}

/** A dilemma's situations: one, or several joined by "_" (a caster on islands: "mage_islands"). */
export function contextsOf(c: CaseSpec): string[] {
  return (c.context ?? "fresh").split("_");
}

/** A dilemma's object: the nearest of its kind to the hero. */
export function dilemmaObject(s: AdventureState, c: CaseSpec, h: Hero, evenRemoved = false): AdvObject | undefined {
  const near = caseObject(c);
  if (!near) return undefined;
  const d = (o: AdvObject) => Math.abs(o.x - h.x) + Math.abs(o.y - h.y);
  // (Taken away in a control, it still marks where its guards stand.)
  const control = evenRemoved && contextsOf(c).includes("alone");
  return s.objects.filter((o) => (!o.removed || control) && o.type === near[0] && (c.kind === "spell" || c.kind === "skill" || c.kind === "hero" || o.subid === near[1])).sort((a, b) => d(a) - d(b))[0];
}

/**
 * The guards of a dilemma's object (rmg.ts put one on the tile it is entered from, one above it for
 * things taken from any side); a creature's own stack is its own guard.
 */
export function dilemmaGuards(s: AdventureState, w: World, o: AdvObject): AdvObject[] {
  if (o.type === Obj.MONSTER) return [o];
  const near = [...maskTiles(o.visit, 1).map(({ dx, dy }) => [o.x + dx, o.y + dy + 1]), [o.x, o.y - 1]];
  return s.objects.filter((m) => !m.removed && m.type === Obj.MONSTER && m.subid === CASE_GUARD && m.z === o.z && near.some(([x, y]) => m.x === x && m.y === y));
}

/** An army's fight value (what monsters weigh a hero by). */
const fight = (w: World, army: (ArmySlot | null)[]) => army.reduce((a, x) => a + (x ? x.count * (w.creatures[x.creature]?.fightValue ?? 0) : 0), 0);
/** A hero's strength as the AI weighs it (army value by attack and defense): what prices are a share of. */
const strength = (w: World, h: Hero) => h.army.reduce((a, x) => a + (x ? x.count * (w.creatures[x.creature]?.aiValue ?? 0) : 0), 0) * (1 + 0.05 * (h.primary[0] + h.primary[1]));

/**
 * The situations a dilemma can be set in. Each makes some things worth a price and others worth
 * nothing: no water for a boat, no Necromancy for its artifacts, an undead army for morale, no
 * spellbook for magic, no shooters for archery, a thing the hero already has, a place already
 * visited, mana already full, no room for another skill or hero.
 */
export const CASE_CONTEXTS: Record<string, { text: string; islands?: boolean; apply?: (s: AdventureState & HasRng, w: World, c: CaseSpec, h: Hero, town: AdvObject) => void }> = {
  fresh: { text: "the hero hasn't got it and can use it" },
  islands: { text: "on islands, the sea between them", islands: true },
  landlocked: { text: "no water anywhere" },
  hasit: {
    text: "the hero already has it",
    apply: (s, w, c, h) => {
      if (c.kind === "artifact") giveArtifact(h, w.data.artifacts, c.id);
      if (c.kind === "spell") (giveBook(h), (h.spells = [...new Set([...(h.spells ?? []), c.id])]));
      if (c.kind === "skill") h.skills = [[c.id, 3], ...(h.skills ?? []).filter(([id]) => id !== c.id).slice(0, 7)];
    },
  },
  nomagic: {
    text: "a hero with no spellbook, no magic skills, no mage guild to buy one",
    apply: (s, w, c, h, town) => {
      // (No spell list is how the rules know there's no spellbook.)
      h.equipped![SLOT.SPELLBOOK] = -1;
      h.spells = undefined;
      const magic = new Set(["wisdom", "airMagic", "earthMagic", "fireMagic", "waterMagic", "sorcery", "intelligence", "mysticism", "scholar", "eagleEye"].map(skillId));
      h.skills = (h.skills ?? []).filter(([id]) => !magic.has(id));
      town.town!.built = town.town!.built.filter((b) => b < B.MAGE_GUILD_1 || b > B.MAGE_GUILD_1 + 4);
      // (And none to build: with a guild a book is 500 gold away, and the thing worth having after all.)
      town.town!.forbidden = [0, 1, 2, 3, 4].map((l) => B.MAGE_GUILD_1 + l);
    },
  },
  mage: {
    text: "a caster: spellbook, spells, expert Wisdom, high power and knowledge, mana to spare",
    apply: (s, w, c, h) => {
      giveBook(h);
      h.spells = (w.data.spells ?? []).filter((sp) => sp && sp.id !== c.id && sp.level >= 1 && sp.level <= 3 && sp.id < 70).map((sp) => sp.id);
      h.skills = [[skillId("wisdom"), 3], ...(h.skills ?? []).filter(([id]) => id !== skillId("wisdom") && id !== c.id).slice(0, 6)];
      h.primary[2] = Math.max(h.primary[2], 10);
      h.primary[3] = Math.max(h.primary[3], 10);
      h.mana = maxMana(h);
    },
  },
  necro: { text: "a necromancer (expert Necromancy)", apply: (s, w, c, h) => (h.skills = [[skillId("necromancy"), 3], ...(h.skills ?? []).filter(([id]) => id !== skillId("necromancy")).slice(0, 7)]) },
  undead: {
    text: "an all-undead army (morale doesn't touch it)",
    apply: (s, w, c, h) => {
      const before = fight(w, h.army);
      const UNDEAD = [56, 58, 60, 62, 64, 66, 68];
      h.army = h.army.map((a, i) => (a ? { creature: UNDEAD[Math.min(6, w.creatures[a.creature]?.level ? w.creatures[a.creature].level - 1 : i)], count: a.count } : null));
      // As strong as before.
      const k = before / Math.max(1, fight(w, h.army));
      for (const a of h.army) if (a) a.count = Math.max(1, Math.round(a.count * k));
    },
  },
  shooters: { text: "an army with shooters", apply: (s, w, c, h) => addStack(w, h, 2, 40) },
  noshooters: { text: "an army without shooters", apply: (s, w, c, h) => (h.army = h.army.map((a) => (a && w.creatures[a.creature]?.abilities.some((x) => x.type === "SHOOTER") ? null : a))) },
  dragons: { text: "dragons in the army", apply: (s, w, c, h) => addStack(w, h, 26, 6) },
  nodragons: { text: "no dragons in the army" },
  manafull: { text: "a caster with mana full", apply: (s, w, c, h) => (CASE_CONTEXTS.mage.apply!(s, w, c, h, h as never), (h.mana = maxMana(h))) },
  manadouble: { text: "a caster with mana at double its maximum", apply: (s, w, c, h) => (CASE_CONTEXTS.mage.apply!(s, w, c, h, h as never), (h.mana = 2 * maxMana(h))) },
  manalow: { text: "a caster with no mana left", apply: (s, w, c, h) => (CASE_CONTEXTS.mage.apply!(s, w, c, h, h as never), (h.mana = 0)) },
  skillsfull: {
    text: "no room for another skill (eight at Expert)",
    apply: (s, w, c, h) => {
      const own = c.kind === "skill" ? c.id : -1;
      h.skills = Array.from({ length: 28 }, (_, i) => i).filter((i) => i !== own && i !== skillId("necromancy")).slice(0, 8).map((i) => [i, 3] as [number, number]);
    },
  },
  highlevel: { text: "a level 12 hero", apply: (s, w, c, h) => levelUp(s, w, h, 12, []) },
  visited: {
    text: "the hero has already been there",
    apply: (s, w, c, h) => {
      const o = dilemmaObject(s, c, h);
      if (!o) return;
      visitObject(s, w, h, o);
      if (h.offer) applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
    },
  },
  alone: {
    text: "the control: the same guard with nothing behind it",
    apply: (s, w, c, h) => {
      const o = dilemmaObject(s, c, h);
      if (o && o.type !== Obj.MONSTER) (o.removed = true), w.refresh(s);
    },
  },
  basic: {
    text: "an army of unupgraded troops, no upgraded dwellings at home",
    apply: (s, w, c, h, town) => {
      const base = new Map(Object.entries(UPGRADE_OF).map(([b, u]) => [Number(u), Number(b)]));
      for (const a of h.army) if (a && base.has(a.creature)) a.creature = base.get(a.creature)!;
      town.town!.built = town.town!.built.filter((b) => !(dwellingLevel(b)?.upgraded));
    },
  },
  nomarket: {
    text: "no marketplace at home, wood and ore piling up",
    apply: (s, w, c, h, town) => {
      town.town!.built = town.town!.built.filter((b) => b !== B.MARKETPLACE && b !== B.RESOURCE_SILO);
      const p = s.players[h.owner];
      p.resources = p.resources.map((n, i) => (i === 6 ? 2000 : 80));
    },
  },
  owned: {
    text: "it's already the player's",
    apply: (s, w, c, h) => {
      const o = dilemmaObject(s, c, h);
      if (o) o.owner = h.owner;
    },
  },
  threat: {
    text: "a stronger enemy hero a day from the town, and gold for the building or troops, not both",
    apply: (s, w, c, h, town) => {
      const rival = s.players.findIndex((p, i) => i !== h.owner && p.alive && p.controller !== "none");
      if (rival < 0) return;
      // Within a day's walk of the gate, on open ground.
      const paths = findPaths(w, s, h);
      const spot = [...paths.entries()].filter(([i, n]) => n.cost > 600 && n.cost < 1200 && !w.heroAt[i] && !w.visitBy[i] && !w.guardedBy[i]).map(([i]) => i)[0];
      if (spot === undefined) return;
      const enemy = makeHero(s, w.data, Object.keys(w.data.heroNames).map(Number).find((t) => !s.heroes.some((x) => x.type === t))!, rival, spot % w.size, Math.floor(spot / w.size) % w.size, h.z, h.army.map((a) => (a ? { creature: a.creature, count: Math.ceil(a.count * 1.4) } : null)));
      enemy.primary = [...h.primary];
      enemy.movement = enemy.maxMovement = maxMovement(w, enemy);
      s.heroes.push(enemy);
      // Gold for one or the other: the building's price, about what this week's troops cost.
      const p = s.players[h.owner];
      p.resources[6] = Math.max(buildingCost(w, town, c.id)[6], 3000);
      w.refresh(s);
    },
  },
  maxheroes: {
    text: "the player already has eight heroes",
    apply: (s, w, c, h) => {
      const free = [...findPaths(w, s, h).keys()].filter((i) => !w.heroAt[i] && !w.visitBy[i] && !w.guardedBy[i] && i !== w.index(h.x, h.y, h.z));
      const taken = new Set(s.heroes.map((x) => x.type));
      for (let k = 0; s.heroes.filter((x) => !x.removed && x.owner === h.owner && x.garrison === undefined).length < 8 && k < free.length; k += 3) {
        const type = Object.keys(w.data.heroNames).map(Number).find((t) => !taken.has(t) && t !== c.id);
        if (type === undefined) break;
        taken.add(type);
        const i = free[free.length - 1 - k];
        const extra = makeHero(s, w.data, type, h.owner, i % w.size, Math.floor(i / w.size) % w.size, h.z, [{ creature: 0, count: 1 }, null, null, null, null, null, null]);
        // They stay put (asleep): the test is about the main hero's choice.
        extra.asleep = true;
        s.heroes.push(extra);
        w.refresh(s);
      }
    },
  },
};

function giveBook(h: Hero) {
  h.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
  h.spells ??= [];
}

function addStack(w: World, h: Hero, creature: number, count: number) {
  if (!w.creatures[creature]) return;
  const i = h.army.findIndex((a) => !a);
  h.army[i >= 0 ? i : 6] = { creature, count };
}

/** Prices a dilemma (the guard's size) and sets its situation. */
function setDilemma(s: AdventureState & HasRng, w: World, c: CaseSpec, h: Hero, town: AdvObject) {
  // The war machines and spellbook are the situation's to give: a ballista case starts without one.
  if (c.kind === "artifact") h.equipped = h.equipped!.map((a) => (a === c.id ? -1 : a));
  // The week's troops are already with the hero: the price stays the share it was set at. (A
  // building's dilemma keeps them: troops or the building is its choice.)
  if (c.kind !== "building") town.town!.available = town.town!.available.map(() => 0);
  for (const k of contextsOf(c)) CASE_CONTEXTS[k]?.apply?.(s, w, c, h, town);
  h.maxMovement = maxMovement(w, h);
  w.refresh(s);
  const o = dilemmaObject(s, c, h, true);
  for (const guard of o ? dilemmaGuards(s, w, o) : []) {
    const each = w.creatures[guard.subid]?.aiValue ?? 1;
    guard.amount = Math.max(1, Math.round((((c.price ?? 0) / 100) * strength(w, h)) / each));
    guard.data = { ...(guard.data ?? {}), aggression: 10 };
  }
}
