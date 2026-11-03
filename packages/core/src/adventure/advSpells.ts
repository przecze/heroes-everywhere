// Adventure map spells (heroes.thelazy.net): Summon / Scuttle Boat, Fly, Water Walk,
// Dimension Door, Town Portal.
import { hasAbility } from "../creatures.ts";
import { randInt } from "../rng.ts";
import { SORCERY, skillLevel } from "../skills.ts";
import { schoolDamageSpecialty, skillFactor, spellDamageSpecialty } from "../specialty.ts";
import { COMBAT_SPELLS, SPELL, type SpellInfo } from "../spells.ts";
import { isAirship, maxMovement } from "./movement.ts";
import { battleBonuses, effectivePrimary, heroSpells } from "./artifacts.ts";
import { type AdventureState, type AdvObject, type Hero, Obj, type TextRef } from "./types.ts";
import { Terrain, type World, heroSight, reveal, visitOffset, visitTile } from "./world.ts";
import { Refusal } from "../refusal.ts";
import { lineText } from "../gameLines.ts";

const SCHOOL_SKILL = { earth: "earthMagic", water: "waterMagic", fire: "fireMagic", air: "airMagic" } as const;

/** Mastery 0..3 of the hero for a spell: the best of its schools. */
export function heroMastery(h: Hero, spell: SpellInfo): number {
  return Math.max(0, ...spell.schools.map((sc) => skillLevel(h.skills, SCHOOL_SKILL[sc])));
}

/** What a damage spell would do to a target with no defences when this hero casts it (the book's right-click on the map, as in battle's spellEstimate); 0 for the rest. */
export function heroSpellEstimate(h: Hero, spell: SpellInfo): number {
  if (!COMBAT_SPELLS[spell.id]?.damage || spell.id === SPELL.TITANS_BOLT) return 0;
  const orb = Math.max(0, ...spell.schools.map((sc) => battleBonuses(h).filter((b) => b.type === "SPELL_DAMAGE" && b.subtype === sc).reduce((a, b) => a + (b.val ?? 0), 0) + schoolDamageSpecialty(h, sc))) / 100;
  const sorcery = 1 + SORCERY[skillLevel(h.skills, "sorcery")] * skillFactor(h, "sorcery");
  const dmg = (spell.power * effectivePrimary(h)[2] + spell.effect[heroMastery(h, spell)]) * sorcery * (1 + orb) * (1 + spellDamageSpecialty(h, spell.id) / 100);
  return Math.max(0, Math.floor(dmg));
}

export const ADVENTURE_SPELLS = new Set<number>([
  SPELL.SUMMON_BOAT, SPELL.SCUTTLE_BOAT, SPELL.FLY, SPELL.WATER_WALK, SPELL.DIMENSION_DOOR, SPELL.TOWN_PORTAL, SPELL.VIEW_AIR, SPELL.VIEW_EARTH,
  SPELL.VISIONS, SPELL.DISGUISE,
]);
/** Spells that need a map tile picked as their target. */
export const TARGETED = new Set<number>([SPELL.SCUTTLE_BOAT, SPELL.DIMENSION_DOOR]);

const pos = (w: World, i: number) => ({ x: i % w.size, y: Math.floor(i / w.size) % w.size, z: Math.floor(i / (w.size * w.size)) });
const isWater = (w: World, i: number) => w.map.tiles[i]?.terrain === Terrain.WATER;

/** Free water tiles next to the hero (where a summoned boat can go). */
export function waterNextTo(w: World, h: { x: number; y: number; z: number }): number[] {
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = w.index(h.x + dx, h.y + dy, h.z);
      if ((dx || dy) && i >= 0 && isWater(w, i) && !w.blocked(i) && !w.visitBy[i] && !w.heroAt[i]) out.push(i);
    }
  }
  return out;
}

/**
 * The towns a Town Portal can reach: your own and allies', with no hero in the gate; below Advanced
 * only the nearest town, and none when a hero stands in its gate (heroes.thelazy.net Town Portal).
 */
export function portalTowns(s: AdventureState, w: World, h: Hero, mastery: number): AdvObject[] {
  const team = (p: number) => s.players[p]?.team ?? p;
  const towns = s.objects
    .filter((o) => o.town && !o.removed && o.owner >= 0 && team(o.owner) === team(h.owner))
    .map((o) => ({ o, gate: visitTile(w, o) }))
    .filter(({ gate }) => gate >= 0)
    .sort((a, b) => dist(w, h, a.gate) - dist(w, h, b.gate));
  return (mastery >= 2 ? towns : towns.slice(0, 1)).filter(({ gate }) => !w.heroAt[gate]).map(({ o }) => o);
}

/** HotA's Town Gate: any allied town with a free gate, nearest first. */
export function gateTowns(s: AdventureState, w: World, h: Hero): AdvObject[] {
  const team = (p: number) => s.players[p]?.team ?? p;
  return s.objects
    .filter((o) => o.town && !o.removed && o.owner >= 0 && team(o.owner) === team(h.owner))
    .map((o) => ({ o, gate: visitTile(w, o) }))
    .filter(({ gate }) => gate >= 0 && !w.heroAt[gate])
    .sort((a, b) => dist(w, h, a.gate) - dist(w, h, b.gate))
    .map(({ o }) => o);
}

/** Steps through a Town Gate into an allied town's gate; no movement spent. */
export function useTownGate(s: AdventureState, w: World, h: Hero, town: number): string {
  const o = gateTowns(s, w, h).find((x) => x.id === town);
  if (!o) throw new Refusal("You can't go to that town.");
  const gate = pos(w, visitTile(w, o));
  [h.x, h.y, h.z] = [gate.x, gate.y, gate.z];
  reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
  w.refresh(s);
  return `${h.name} steps through the Town Gate into ${o.name ?? "town"}.`;
}

const dist = (w: World, h: Hero, i: number) => {
  const p = pos(w, i);
  return (p.z !== h.z ? 1000 : 0) + Math.hypot(p.x - h.x, p.y - h.y);
};

/** A message for the player: in English, and the original's own line for it when there is one. */
export interface Said {
  text: string;
  ref?: TextRef;
}
const said = (text: string): Said => ({ text });
/** The game's own line (its words from the player's files: gameLines.ts). */
const gameSaid = (file: TextRef["file"], id: number, args?: (string | number)[]): Said => {
  const ref = { file, id, ...(args ? { args } : {}) };
  return { text: lineText(ref), ref };
};

/** Why the spell can't be cast now (or null). `target` is a tile for targeted spells, a town for Town Portal. */
export function cannotCastAdventure(s: AdventureState, w: World, h: Hero, spell: SpellInfo, target?: number): string | null {
  return castRefusal(s, w, h, spell, target)?.text ?? null;
}

/**
 * cannotCastAdventure with the original's lines (VCMI's AdventureSpellMechanics and CSpellWindow:
 * GENRLTXT 206 the spell points, 333 / 334 Summon Boat, 192 / 135 not from a boat, 338 Dimension
 * Door's castings, 125 too tired, 124 no town); our own words where it has none.
 */
export function castRefusal(s: AdventureState, w: World, h: Hero, spell: SpellInfo, target?: number): Said | null {
  if (!ADVENTURE_SPELLS.has(spell.id)) return said("That spell isn't in the game yet.");
  if (!heroSpells(h, w.data.spells ?? [])?.includes(spell.id)) return said("The hero doesn't know that spell.");
  const m = heroMastery(h, spell);
  if ((h.mana ?? 0) < spell.cost[m]) return gameSaid("genrltxt", 206, [spell.cost[m], h.mana ?? 0]);
  w.refresh(s);
  // Standing in an Anti-magic Garrison: no adventure spells either (heroes.thelazy.net Garrison).
  const here = w.visitable(s, w.index(h.x, h.y, h.z));
  if (here && (here.type === 33 || here.type === 219) && here.subid === 1) return gameSaid("genrltxt", 541, [h.name]);
  switch (spell.id) {
    case SPELL.SUMMON_BOAT:
      if (h.boat !== undefined) return gameSaid("genrltxt", 333, [h.name]);
      if (!waterNextTo(w, h).length) return gameSaid("genrltxt", 334);
      return null;
    case SPELL.SCUTTLE_BOAT: {
      if (target === undefined) return null;
      const o = w.visitable(s, target);
      if (!o || o.type !== Obj.BOAT || o.carriedBy !== undefined) return said("There's no empty boat there.");
      return null;
    }
    case SPELL.FLY:
      return h.boat !== undefined ? gameSaid("genrltxt", 192) : null;
    case SPELL.WATER_WALK:
      return h.boat !== undefined ? gameSaid("genrltxt", 135) : null;
    case SPELL.DIMENSION_DOOR: {
      const cost = m >= 3 ? 200 : 300;
      if (h.boat !== undefined) return gameSaid("genrltxt", 135);
      const used = h.doors?.day === s.day ? h.doors.n : 0;
      if (used >= Math.max(1, spell.effect[m])) return gameSaid("genrltxt", 338, [h.name]);
      if (h.movement <= cost) return gameSaid("genrltxt", 125);
      if (target === undefined) return null;
      const p = pos(w, target);
      const up = h.y - p.y;
      if (p.z !== h.z || Math.abs(p.x - h.x) > 9 || p.y - h.y > 9 || up > 8) return said("Too far for Dimension Door.");
      // (A shrouded tile will do; water takes the casting and fails, below.)
      if (isWater(w, target)) return null;
      if (w.blocked(target) || (w.visitBy[target] && s.objects[w.visitBy[target] - 1]?.type !== Obj.EVENT) || w.heroAt[target]) return said("Dimension Door needs a free spot on land.");
      return null;
    }
    case SPELL.TOWN_PORTAL: {
      if (h.boat !== undefined) return gameSaid("genrltxt", 135);
      if (h.movement < (m >= 3 ? 200 : 300)) return gameSaid("genrltxt", 125);
      const towns = portalTowns(s, w, h, m);
      if (!towns.length) return gameSaid("genrltxt", 124);
      if (target !== undefined && !towns.some((o) => o.id === target)) return said("You can't portal to that town.");
      return null;
    }
  }
  return null;
}

/** Casts an adventure spell; returns a message for the player ("" for none). */
export function castAdventure(s: AdventureState, w: World, h: Hero, spell: SpellInfo, target?: number): string {
  return castAdventureSaid(s, w, h, spell, target).text;
}

/**
 * Casts an adventure spell; returns what the player is told, with the original's line (VCMI's
 * AdventureSpellMechanics: GENRLTXT 336 / 337 a failed Summon / Scuttle Boat, 335 no boats, 70
 * Dimension Door onto water). A spell that works says nothing, as in the original.
 */
export function castAdventureSaid(s: AdventureState, w: World, h: Hero, spell: SpellInfo, target?: number): Said {
  const why = cannotCastAdventure(s, w, h, spell, target);
  if (why) throw new Refusal(why);
  // (Before the spell points go.)
  if (target === undefined && TARGETED.has(spell.id)) throw new Refusal(spell.id === SPELL.SCUTTLE_BOAT ? "pick a boat" : "pick a destination");
  const m = heroMastery(h, spell);
  h.mana = (h.mana ?? 0) - spell.cost[m];
  const chance = spell.effect[m];
  switch (spell.id) {
    case SPELL.SUMMON_BOAT: {
      // The chance first (heroes.thelazy.net Summon Boat): a failure costs the spell points.
      if (randInt(s, 1, 100) > chance) return gameSaid("genrltxt", 336, [h.name]);
      const spot = waterNextTo(w, h)[0];
      const t = w.data.templates.find((x) => x.id === Obj.BOAT);
      // The nearest of the player's own free boats (left or bought by them), else a neutral one; never
      // another player's. From Advanced a new one is made when there's none (up to 64 on the map).
      const free = s.objects
        .filter((o) => o.type === Obj.BOAT && !o.removed && o.carriedBy === undefined && !isAirship(o))
        .sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y));
      const of = (o: AdvObject) => (typeof o.data?.boatOf === "number" ? o.data.boatOf : -1);
      let boat = free.find((o) => of(o) === h.owner) ?? free.find((o) => of(o) < 0);
      const boats = s.objects.filter((o) => o.type === Obj.BOAT && !o.removed).length;
      if (!boat && m >= 2 && t && boats < 64) {
        boat = { id: s.objects.length, type: Obj.BOAT, subid: t.subid, def: t.def, x: 0, y: 0, z: h.z, block: t.blockMask, visit: t.visitMask, flat: false, owner: -1 };
        s.objects.push(boat);
      }
      if (!boat) {
        // No boat to call: the spell points come back.
        h.mana += spell.cost[m];
        return gameSaid("genrltxt", 335);
      }
      (boat.data ??= {}).boatOf = h.owner;
      const v = visitOffset(boat.visit) ?? [-1, 0];
      const p = pos(w, spot);
      [boat.x, boat.y, boat.z] = [p.x - v[0], p.y - v[1], p.z];
      w.refresh(s);
      return said("");
    }
    case SPELL.SCUTTLE_BOAT: {
      if (randInt(s, 1, 100) > chance) return gameSaid("genrltxt", 337, [h.name]);
      const o = w.visitable(s, target!)!;
      o.removed = true;
      w.refresh(s);
      return said("");
    }
    case SPELL.FLY:
      h.fly = { day: s.day, efficiency: chance || 60 };
      return said("");
    case SPELL.WATER_WALK:
      h.waterWalk = { day: s.day, efficiency: chance || 60 };
      return said("");
    case SPELL.DIMENSION_DOOR: {
      const p = pos(w, target!);
      // Onto water the spell fails. The original took its spell points, movement and one of the day's
      // castings; HotA 1.7.1 takes nothing ("doesn't spend mana anymore", its changelog).
      if (isWater(w, target!)) {
        h.mana += spell.cost[m];
        return gameSaid("genrltxt", 70);
      }
      h.movement -= m >= 3 ? 200 : 300;
      h.doors = { day: s.day, n: (h.doors?.day === s.day ? h.doors.n : 0) + 1 };
      [h.x, h.y] = [p.x, p.y];
      reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
      w.refresh(s);
      return said("");
    }
    case SPELL.VISIONS:
      // HotA: as far as the spell power (x2 Advanced, x3 Expert), at least 3 tiles.
      h.visions = s.day;
      h.visionsReach = { range: Math.max(3, effectivePrimary(h)[2] * Math.max(1, m)), mastery: m };
      return said("");
    case SPELL.DISGUISE:
      h.disguise = s.day;
      h.disguiseMastery = m;
      return said("");
    case SPELL.VIEW_AIR:
    case SPELL.VIEW_EARTH: {
      const p = s.players[h.owner];
      if (!p) return said("");
      const v = p.views?.day === s.day ? p.views : { day: s.day };
      const key = spell.id === SPELL.VIEW_AIR ? "air" : "earth";
      v[key] = Math.max(v[key] ?? 0, m);
      p.views = v;
      return said("");
    }
    case SPELL.TOWN_PORTAL: {
      const towns = portalTowns(s, w, h, m);
      const town = target !== undefined ? towns.find((o) => o.id === target) : towns[0];
      if (!town) throw new Refusal("no town");
      const gate = pos(w, visitTile(w, town));
      [h.x, h.y, h.z] = [gate.x, gate.y, gate.z];
      h.movement = Math.max(0, h.movement - (m >= 3 ? 200 : 300));
      h.maxMovement = maxMovement(w, h);
      reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
      w.refresh(s);
      return said("");
    }
  }
  return said("");
}

/** What an army belongs to, for Visions: a wandering stack, a hero, a town (or a garrison). */
export type SeenArmy = "monster" | "hero" | "town";
/** The Visions mastery each needs: monsters at any, heroes from Advanced, towns at Expert. */
const VISIONS_MASTERY: Record<SeenArmy, number> = { monster: 0, hero: 2, town: 3 };

/**
 * Whether `player` sees the exact numbers of the army at (x, y, z): the Visions spell cast today
 * by a hero within its reach (HotA: spell power x 1 / 2 / 3 tiles, at least 3; Advanced shows
 * heroes too, Expert towns), or Rogues in a hero's army within theirs (VCMI's VISIONS ability: 3 tiles).
 */
export function seesNumbers(s: AdventureState, w: World, player: number, x: number, y: number, z: number, what: SeenArmy = "monster"): boolean {
  return s.heroes.some((h) => {
    if (h.removed || h.owner !== player || h.z !== z) return false;
    const span = Math.max(Math.abs(h.x - x), Math.abs(h.y - y));
    // (A Visions cast before its reach was kept: everywhere, as it was then.)
    const reach = h.visions === s.day ? (h.visionsReach ?? { range: Infinity, mastery: 3 }) : undefined;
    if (reach && span <= reach.range && reach.mastery >= VISIONS_MASTERY[what]) return true;
    if (span > 3) return false;
    return h.army.some((a) => a && w.creatures[a.creature] && hasAbility(w.creatures[a.creature], "VISIONS"));
  });
}

/**
 * The army an enemy sees on a hero disguised today (HotA's Disguise), or null when it sees the real
 * one: every stack as the army's strongest creature; from Advanced the numbers show as 0; at Expert
 * the creature is the strongest of the player's starting town instead.
 */
export function disguisedArmy(s: AdventureState, w: World, h: Hero, viewer: number): ({ creature: number; count: number } | null)[] | null {
  if (h.disguise !== s.day || h.owner === viewer) return null;
  const team = (p: number) => s.players[p]?.team ?? p;
  if (viewer >= 0 && team(viewer) === team(h.owner)) return null;
  const m = h.disguiseMastery ?? 1;
  const value = (c: number) => w.creatures[c]?.aiValue ?? 0;
  const faction = s.players[h.owner]?.faction;
  const town = m >= 3 && faction ? Object.values(w.creatures).filter((c) => c && c.faction === faction).sort((a, b) => b.aiValue - a.aiValue)[0]?.id : undefined;
  const strongest = town ?? h.army.reduce<number | undefined>((best, a) => (a && (best === undefined || value(a.creature) > value(best)) ? a.creature : best), undefined);
  if (strongest === undefined) return h.army.map(() => null);
  return h.army.map((a) => (a ? { creature: strongest, count: m >= 2 ? 0 : a.count } : null));
}

/** View Air / View Earth cast this turn by the player's heroes, by their best mastery (HotA: shown in View World until the turn ends). */
export interface MapViews {
  air?: number;
  earth?: number;
}
export function mapViews(s: AdventureState, player: number): MapViews {
  const v = s.players[player]?.views;
  return v?.day === s.day ? { ...(v.air !== undefined ? { air: v.air } : {}), ...(v.earth !== undefined ? { earth: v.earth } : {}) } : {};
}

/** The View World window's symbols: what each object is shown as (or null). */
export type WorldViewKind = "town" | "hero" | "artifact" | "teleport" | "gate" | "mine" | "resource";
export function worldViewKind(o: AdvObject): WorldViewKind | null {
  switch (o.type) {
    case Obj.TOWN:
      return "town";
    case 5:
    case 65:
    case 66:
    case 67:
    case 68:
    case 69:
      return "artifact";
    case 43:
    case 44:
    case 45:
      return "teleport";
    case 103:
      return "gate";
    case 53:
    case 220:
      return "mine";
    case 79:
      return "resource";
  }
  return null;
}

/**
 * Whether the spells show a kind of thing through the fog (the original's): View Air the artifacts
 * on the map, from Advanced the heroes, at Expert the towns; View Earth the resources, from Advanced
 * the mines (and at Expert all the terrain, viewShowsTerrain).
 */
export function viewShows(v: MapViews, kind: WorldViewKind): boolean {
  const air = v.air !== undefined && (kind === "artifact" || (kind === "hero" && v.air >= 2) || (kind === "town" && v.air >= 3));
  const earth = v.earth !== undefined && (kind === "resource" || (kind === "mine" && v.earth >= 2));
  return air || earth;
}
export const viewShowsTerrain = (v: MapViews) => (v.earth ?? 0) >= 3;

/** What the player's View Air / View Earth show today, fog or not: the objects and the other players' heroes (ids), and whether all terrain is. */
export function viewSights(s: AdventureState, player: number, v: MapViews = mapViews(s, player)): { objects: number[]; heroes: number[]; terrain: boolean } {
  const objects = s.objects.filter((o) => !o.removed && o.carriedBy === undefined && (o.town ? viewShows(v, "town") : ((k) => !!k && viewShows(v, k))(worldViewKind(o)))).map((o) => o.id);
  const heroes = viewShows(v, "hero") ? s.heroes.filter((h) => !h.removed && h.garrison === undefined && h.owner !== player).map((h) => h.id) : [];
  return { objects, heroes, terrain: viewShowsTerrain(v) };
}
