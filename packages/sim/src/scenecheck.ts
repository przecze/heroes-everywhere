// Plays every scene's proof (core scenes.ts): the action that shows the thing working, and a check
// that its effect happened (the artifact carried and the attributes changed, the boat at the shore,
// the spell cast in battle, the building built...). Writes packages/client/src/sceneProofs.json for
// the Matrix: ✓ proven, ✗ with what went wrong.
//   node packages/sim/src/scenecheck.ts [kind]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ResourceStore } from "@heroes/formats/node";
import {
  type AdventureEvent,
  type AdventureState,
  type Hero,
  type World,
  ARTIFACT_INFO,
  B,
  assemblable,
  lastPartOf,
  Obj,
  SPECIALTIES,
  SPELL,
  TOWNS,
  Terrain,
  applyAdventureAction,
  buildGameData,
  beginAdventure,
  effectivePrimary,
  findPaths,
  generateScene,
  newDay,
  seesNumbers,
  parseSceneName,
  runAi,
  sceneObject,
  scenePlaces,
  VIEW_ARTIFACT,
  VIEW_MINE,
  VIEW_RESOURCE,
  type AdvObject,
  disguisedArmy,
  heroMastery,
  isRevealed,
  mapViews,
  viewSights,
  visit,
  visitTile,GAME_LINE_FILES,
} from "@heroes/core";
import { type ArtifactProof, proveArtifact } from "./artifactcheck.ts";
import { type ObjectCtx, ANSWER_OPTION, fightAndSettle, proveObject, snapshot, visitAgain } from "./objectcheck.ts";
import { proveSpell } from "./spellcheck.ts";
import { type SkillRun, proveSkill } from "./skillcheck.ts";
import { type HeroRun, proveHero } from "./herocheck.ts";
import { proveBuilding } from "./buildingcheck.ts";
import { reactionsFor } from "../../client/src/map/reactions.ts";

/** Questions the rules put to the player that were checked to show on screen. */
let questions = 0;

const root = join(import.meta.dirname, "../../..");
const store = new ResourceStore((process.env.HEROES_DATA_DIRS ?? "").split(":").filter(Boolean), (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
const coverage = JSON.parse(readFileSync(join(root, "packages/client/src/coverage.json"), "utf8")) as { groups: { sections: { name: string; items: { name: string; scene?: string }[] }[] }[] };
const only = process.argv[2];

function start(name: string) {
  const c = parseSceneName(name)!;
  const map = generateScene(data, c);
  const { state: s, world: w } = beginAdventure(map, data, { seed: 1, mapFile: name, controllers: map.players.map((p, i) => (i === 0 ? "human" : p.canComputer ? "ai" : "none")) });
  const h = s.heroes.find((x) => !x.removed && x.owner === 0)!;
  return { c, s, w, h };
}
const act = (s: AdventureState, w: World, h: Hero, a: Parameters<typeof applyAdventureAction>[2]) => applyAdventureAction(s, w, a, h.owner);
/** Where the scene's hero, spot, foe and siege gate are (shifted on a reveal scene's bigger map). */
const places = (s: AdventureState) => scenePlaces(parseSceneName(s.mapFile)!);
const spot = (s: AdventureState, w: World) => w.index(places(s).spot.x, places(s).spot.y, 0);
/** Steps up to the spot (and answers yes if asked). */
function stepUp(s: AdventureState, w: World, h: Hero) {
  const ev = act(s, w, h, { type: "move", hero: h.id, to: spot(s, w) });
  if (h.offer) ev.push(...act(s, w, h, { type: "answerOffer", hero: h.id, accept: true }));
  // The last part of a combination: the hero screen offers the assembly, and the player says yes.
  for (const combo of assemblable(h)) ev.push(...act(s, w, h, { type: "assemble", hero: h.id, artifact: combo }));
  return ev;
}
/** Attacks the rival's walled town to the left: a siege begins. */
function besiege(s: AdventureState, w: World, h: Hero) {
  return act(s, w, h, { type: "move", hero: h.id, to: w.index(places(s).siege.x, places(s).siege.y, 0) });
}
/** A battle the step started, fought out by the AI on both sides (the hero's side too). */
function fightOut(s: AdventureState) {
  const b = s.battles[0]?.battle;
  if (!b) return null;
  b.sides[0].controller = "ai";
  runAi(b);
  return b;
}

/** Plays the scene's proof; null when its effect showed, else what didn't (artifacts: with what was checked). */
function prove(name: string): string | null | ArtifactProof {
  const { c, s, w, h } = start(name);
  if (c.kind === "artifact") {
    const before = effectivePrimary(h);
    stepUp(s, w, h);
    if (![...(h.equipped ?? []), ...(h.backpack ?? [])].includes(c.id)) return "not picked up";
    const after = effectivePrimary(h);
    const prim = [...(ARTIFACT_INFO[c.id]?.bonuses ?? []), ...(lastPartOf(c.id) !== c.id ? ARTIFACT_INFO[lastPartOf(c.id)]?.bonuses ?? [] : [])].filter((b) => b.type === "PRIMARY_SKILL" && !b.limiters?.length);
    const keys = ["attack", "defence", "spellpower", "knowledge"];
    if (prim.length && h.equipped?.includes(c.id))
      for (const b of prim) {
        const i = keys.indexOf(b.subtype ?? "");
        // (Several bonuses on one attribute add up.)
        const want = prim.filter((x) => x.subtype === b.subtype).reduce((a, x) => a + (x.val ?? 0), 0);
        // (Attack and defence don't go below 0, power and knowledge below 1: Titan's Cuirass on a hero of knowledge 2.)
        const expected = Math.max(i < 2 ? 0 : 1, before[i] + want) - before[i];
        if (i >= 0 && after[i] - before[i] !== expected) return `${b.subtype} changed by ${after[i] - before[i]}, not ${expected}`;
      }
    // The rest of its families, measured with and without it (artifactcheck.ts); the scene's foe fought where they show in battle.
    const run = (pickup: boolean) => {
      const g = start(name);
      if (pickup) stepUp(g.s, g.w, g.h);
      const at = places(g.s).foe;
      const foe = g.s.objects.find((o) => !o.removed && o.type === Obj.MONSTER && o.x === at.x && o.y === at.y) ?? g.s.heroes.find((x) => !x.removed && x.owner === 1 && x.x === at.x && x.y === at.y);
      const walled = g.s.objects.find((o) => o.town && !o.removed && o.owner === 1 && o.y <= 12);
      let b: ReturnType<typeof fightOut> | undefined;
      // (The walled town first: an artifact that shows in a siege.)
      if (walled) {
        besiege(g.s, g.w, g.h);
        b = g.s.battles[0]?.battle;
      } else if (foe) {
        act(g.s, g.w, g.h, { type: "move", hero: g.h.id, to: g.w.index(at.x, at.y, 0) });
        b = g.s.battles[0]?.battle;
      }
      return { s: g.s, w: g.w, h: g.h, b: b ?? undefined };
    };
    return proveArtifact(data, c.id, () => run(true), () => run(false));
  }
  if (c.kind === "object") {
    // (A whirlpool stands in the water, not on the spot.)
    const o = sceneObject(s) ?? s.objects.find((x) => !x.removed && x.type === c.id && x.z === 0);
    if (!o) return "the object isn't on the map";
    // A border guard's key first (the keymaster the scene put beside it).
    const tent = s.objects.find((x) => !x.removed && x.type === 10 && x !== o);
    if (tent && (o.type === 9 || o.type === 212)) visit(s, w, h, tent);
    const before = snapshot(s, w, h);
    // A thing in the water: board the boat (which takes the day: the next day's movement given), then sail into it.
    const afloat = w.map.tiles[visitTile(w, o)]?.terrain === Terrain.WATER;
    if (afloat) {
      act(s, w, h, { type: "move", hero: h.id, to: w.index(places(s).hero.x + 1, places(s).hero.y, 0) });
      h.movement = h.maxMovement;
    }
    const ev = act(s, w, h, { type: "move", hero: h.id, to: afloat ? visitTile(w, o) : spot(s, w) });
    // A question the rules wait on must reach the screen as one (map/reactions.ts), or the player is stuck.
    const unasked = (events: AdventureEvent[]) => !!h.offer && (questions++, !reactionsFor(null, s, events, 0, 0).some((r) => r.r === "offer"));
    if (unasked(ev)) return `the hero is asked (${h.offer!.kind}) but the screen shows no question`;
    if (h.offer) {
      const answered = act(s, w, h, { type: "answerOffer", hero: h.id, accept: true, option: ANSWER_OPTION[o.type] });
      if (unasked(answered)) return `after the answer the hero is asked again (${h.offer!.kind}) but the screen shows no question`;
      ev.push(...answered);
    }
    // (A bank asks, then fights; a gate asks, then lets through.)
    if (h.offer) ev.push(...act(s, w, h, { type: "answerOffer", hero: h.id, accept: true }));
    const ctx: ObjectCtx = { s, w, h, o, before, after: snapshot(s, w, h), events: ev, fight: () => fightAndSettle(s, w), again: () => visitAgain(s, w, h, o), now: () => snapshot(s, w, h) };
    return proveObject(ctx);
  }
  if (c.kind === "spell" && c.id < 10) return proveMapSpell(c.id, s, w, h);
  if (c.kind === "spell") {
    // The battle begun (a siege for Earthquake), the hero casts it at the stack that shows it (spellcheck.ts).
    // (A Protection's foe is an enemy caster, two tiles left: against a stack it guards nothing.)
    const at = places(s).foe;
    const caster = s.heroes.find((x) => !x.removed && x.owner === 1 && x.x === at.x && x.y === at.y);
    if (c.id === SPELL.EARTHQUAKE) besiege(s, w, h);
    else if (caster) act(s, w, h, { type: "move", hero: h.id, to: w.index(at.x, at.y, 0) });
    else stepUp(s, w, h);
    const b = s.battles[0]?.battle;
    if (!b) return "no battle";
    return proveSpell(b, c.id);
  }
  if (c.kind === "skill") {
    // Two plays: with the skill at Expert, and without it (skillcheck.ts measures the difference).
    const run = (strip: boolean): SkillRun => {
      const g = start(name);
      if (strip) g.h.skills = (g.h.skills ?? []).filter(([id]) => id !== c.id);
      const xp = g.h.experience;
      const spellsBefore = (g.h.spells ?? []).length;
      // (Ballistics besieges the walled town instead; Eagle Eye and Scholar go to the other hero in their own check.)
      const ev = c.id === 10 ? besiege(g.s, g.w, g.h) : c.id === 11 || c.id === 18 ? [] : stepUp(g.s, g.w, g.h);
      const offered = ev.some((e) => e.e === "offer") || g.h.army.some((a) => a?.creature === 0 && a.count > 60);
      return { s: g.s, w: g.w, h: g.h, b: g.s.battles[0]?.battle, xp, offered, spellsBefore, fight: () => fightAndSettle(g.s, g.w) };
    };
    return proveSkill(c.id, data.spells ?? [], run(false), run(true));
  }
  if (c.kind === "creature") {
    const cr = data.creatures[c.id];
    const plural = cr?.plural ?? "";
    // The few with a map effect, measured with the creature in the army and without it.
    const without = () => {
      const g = start(name);
      g.h.army = g.h.army.map((a) => (a?.creature === c.id ? null : a));
      return g;
    };
    if (c.id === 10) {
      stepUp(s, w, h);
      return h.army.some((a) => a?.creature === 11) && !h.army.some((a) => a?.creature === 10) ? null : "the Cavaliers didn't ride out as Champions";
    }
    if (cr?.abilities.some((a) => a.type === "VISIONS")) {
      const g = without();
      return seesNumbers(s, w, 0, places(s).spot.x, places(s).spot.y, 0) && !seesNumbers(g.s, g.w, 0, places(s).spot.x, places(s).spot.y, 0) ? null : "the stack's numbers aren't seen with them (or are without)";
    }
    if (cr?.abilities.some((a) => a.type === "SPECIAL_CRYSTAL_GENERATION")) {
      const g = without();
      // (Three crystal a week: a week passes.)
      const crystal = (x: AdventureState, ww: World) => {
        const before = x.players[0].resources[4];
        for (let d = 0; d < 7; d++) newDay(x, ww);
        return x.players[0].resources[4] - before;
      };
      const a = crystal(s, w);
      const b = crystal(g.s, g.w);
      return a - b === 3 ? null : `${a} crystal a week with them, ${b} without`;
    }
    if (cr?.abilities.some((a) => a.type === "GENERATE_RESOURCE")) {
      const g = without();
      // (HotA Kobolds: a gold each a day; a day passes.)
      const gold = (x: AdventureState, ww: World) => {
        const before = x.players[0].resources[6];
        newDay(x, ww);
        return x.players[0].resources[6] - before;
      };
      const n = h.army.reduce((t, a) => t + (a?.creature === c.id ? a.count : 0), 0);
      const a = gold(s, w);
      const b = gold(g.s, g.w);
      return n > 0 && a - b === n ? null : `${a} gold a day with ${n} of them, ${b} without`;
    }
    if (cr?.abilities.some((a) => a.type === "NO_TERRAIN_PENALTY")) {
      const g = without();
      const far = w.index(places(s).spot.x - 2, places(s).spot.y - 2, 0);
      const cost = (x: AdventureState, ww: World, hh: Hero) => findPaths(ww, x, hh).get(far)?.cost ?? Infinity;
      return cost(s, w, h) < cost(g.s, g.w, g.h) ? null : "the sand costs as much without them";
    }
    stepUp(s, w, h);
    const b = fightOut(s);
    if (!b) return "no battle";
    return b.units.some((u) => u.side === 0 && u.creature === c.id) ? null : `no ${plural} in the battle`;
  }
  if (c.kind === "hero") {
    if (h.type !== c.id) return `playing hero ${h.type}`;
    // Twice: as the hero, and as another whose specialty can't touch the measure (herocheck.ts).
    const income = (SPECIALTIES[c.id]?.bonuses ?? []).some((b) => b.type === "GENERATE_RESOURCE");
    const run = (type: number): HeroRun => {
      const g = start(name);
      g.h.type = type;
      stepUp(g.s, g.w, g.h);
      return { s: g.s, w: g.w, h: g.h, b: g.s.battles[0]?.battle };
    };
    return proveHero(c.id, data.spells ?? [], run(c.id), run(income ? 1 : 15));
  }
  if (c.kind === "building") {
    // Built in the scene's town, and what it changes measured (buildingcheck.ts).
    const town = s.objects.find((o) => o.town && o.owner === 0)!;
    return proveBuilding(s, w, h, town, c.id, TOWNS[c.sub ?? 0]?.faction ?? "castle");
  }
  return "no proof for this kind";
}

/**
 * The adventure map spells (cast at Expert, the scene's school skill): the exact effect, the spell
 * points spent and, where the rules spend them, the movement points.
 */
function proveMapSpell(id: number, s: AdventureState, w: World, h: Hero): string | null {
  const sp = data.spells?.[id];
  if (!sp) return "no such spell";
  const m = heroMastery(h, sp);
  if (m !== 3) return `cast at mastery ${m}, not Expert`;
  const mana = h.mana ?? 0;
  const cast = (target?: number) => act(s, w, h, { type: "castSpell", hero: h.id, spell: id, target });
  /** The spell points went down by its cost at Expert. */
  const spent = (casts = 1) => (h.mana ?? 0) === mana - casts * sp.cost[m] ? null : `spell points ${mana} -> ${h.mana}, not -${casts * sp.cost[m]}`;
  const at = places(s);
  const water = (i: number) => w.map.tiles[i]?.terrain === Terrain.WATER;
  const boats = () => s.objects.filter((o) => o.type === Obj.BOAT && !o.removed);
  if (id === SPELL.SUMMON_BOAT) {
    // (No boat on the map: at Expert one is made, by the shore beside the hero.)
    if (boats().length) return "a boat was there before the spell";
    cast();
    const made = boats();
    if (made.length !== 1) return `${made.length} boats after the spell`;
    const v = visitTile(w, made[0]);
    const p = { x: v % w.size, y: Math.floor(v / w.size) % w.size };
    if (!water(v) || Math.max(Math.abs(p.x - h.x), Math.abs(p.y - h.y)) !== 1) return `the boat is at ${p.x},${p.y}, not on the water beside the hero`;
    return spent();
  }
  if (id === SPELL.SCUTTLE_BOAT) {
    const boat = boats()[0];
    if (!boat) return "no boat to sink";
    cast(visitTile(w, boat));
    if (!s.objects[boat.id].removed || boats().length) return "the boat is still there";
    return spent();
  }
  if (id === SPELL.FLY || id === SPELL.WATER_WALK) {
    // Straight across the water east of the hero (3 tiles) onto the grass beyond.
    const over = w.index(at.hero.x + 2, at.hero.y, 0);
    const beyond = w.index(at.hero.x + 4, at.hero.y, 0);
    if (!water(over) || water(beyond)) return "the scene has no water to cross";
    const before = findPaths(w, s, h).get(beyond)?.cost ?? Infinity;
    if (findPaths(w, s, h).has(over)) return "the water was walkable before the spell";
    cast();
    const eff = (id === SPELL.FLY ? h.fly : h.waterWalk)?.efficiency;
    if (eff !== (sp.effect[m] || 60)) return `movement efficiency ${eff}%, not ${sp.effect[m]}%`;
    const paths = findPaths(w, s, h);
    if (!paths.get(over)?.passOnly) return "the water can't be crossed, or the hero could stop on it";
    // Three steps over the water at 100/efficiency each, one onto the grass (100, or less flying).
    const step = Math.floor((100 * 100) / eff);
    const want = 3 * step + Math.min(100, step);
    const cost = paths.get(beyond)?.cost ?? Infinity;
    if (cost !== want) return `the way across costs ${cost}, not ${want} (around it ${before})`;
    return spent();
  }
  if (id === SPELL.DIMENSION_DOOR) {
    // Three tiles up and back, as often as Expert allows a day; then refused.
    const times = Math.max(1, sp.effect[m]);
    const move = h.movement;
    for (let k = 0; k < times; k++) {
      const to = w.index(h.x, h.y + (k % 2 ? 3 : -3), 0);
      try {
        cast(to);
      } catch (e) {
        return `cast ${k + 1} of ${times}: ${e instanceof Error ? e.message : e}`;
      }
      if (w.index(h.x, h.y, h.z) !== to) return `the hero is at ${h.x},${h.y}, not where the door led`;
    }
    if (h.movement !== move - times * 200) return `movement ${move} -> ${h.movement}, not -${times * 200}`;
    try {
      cast(w.index(h.x, h.y - 3, 0));
      return `a cast more than ${times} a day went through`;
    } catch {
      // (Refused: the day's casts used up.)
    }
    return spent(times);
  }
  if (id === SPELL.TOWN_PORTAL) {
    const town = s.objects.find((o) => o.town && !o.removed && o.owner === 0)!;
    const move = h.movement;
    cast();
    if (w.index(h.x, h.y, h.z) !== visitTile(w, town)) return `the hero is at ${h.x},${h.y}, not at the town's gate`;
    if (h.movement !== Math.max(0, move - 200)) return `movement ${move} -> ${h.movement}, not -200`;
    return spent();
  }
  if (id === SPELL.VISIONS) {
    const { x, y } = at.spot;
    if (seesNumbers(s, w, 0, x, y, 0)) return "the Angels' numbers were seen before the spell";
    cast();
    const range = Math.max(3, effectivePrimary(h)[2] * 3);
    if (h.visionsReach?.range !== range) return `reach ${h.visionsReach?.range}, not ${range} (spell power x3)`;
    if (!seesNumbers(s, w, 0, x, y, 0)) return "the Angels' numbers aren't seen";
    if (!seesNumbers(s, w, 0, h.x + range, h.y, 0, "town") || seesNumbers(s, w, 0, h.x + range + 1, h.y, 0)) return `not seen out to ${range} tiles and no further`;
    return spent();
  }
  if (id === SPELL.DISGUISE) {
    if (disguisedArmy(s, w, h, 1)) return "disguised before the spell";
    cast();
    const seen = disguisedArmy(s, w, h, 1);
    if (!seen || disguisedArmy(s, w, h, 0)) return "the rival sees the real army (or the owner a disguised one)";
    // Expert: the starting town's strongest creature (Castle: Archangels), the numbers 0.
    const best = w.creatures.filter((x) => x && x.faction === s.players[0].faction).sort((a, b) => b.aiValue - a.aiValue)[0]?.id;
    const wrong = seen.find((a, i) => !!a !== !!h.army[i] || (a && (a.creature !== best || a.count !== 0)));
    if (wrong !== undefined) return `the rival sees ${JSON.stringify(seen)}, not every stack as creature ${best} with 0`;
    return spent();
  }
  if (id === SPELL.VIEW_AIR || id === SPELL.VIEW_EARTH) {
    const air = id === SPELL.VIEW_AIR;
    if (viewSights(s, 0).objects.length || viewSights(s, 0).heroes.length) return "something was shown before the spell";
    cast();
    const v = mapViews(s, 0);
    if ((air ? v.air : v.earth) !== 3) return `the player's views are ${JSON.stringify(v)}, not Expert ${air ? "air" : "earth"}`;
    const fogged = (o: { x: number; y: number }) => !isRevealed(s, 0, w.index(o.x, o.y, 0));
    const thing = (t: { type: number; sub: number; x: number; y: number }) => s.objects.find((o) => !o.removed && o.type === t.type && o.subid === t.sub && visitTile(w, o) === w.index(at.at(t).x, at.at(t).y, 0));
    const rivalTown = s.objects.find((o) => o.town && !o.removed && o.owner === 1);
    const rival = s.heroes.filter((x) => !x.removed && x.owner === 1);
    const want = air ? [thing(VIEW_ARTIFACT), rivalTown] : [thing(VIEW_RESOURCE), thing(VIEW_MINE)];
    if (want.some((o) => !o)) return "the scene lacks what the spell shows";
    if (want.some((o) => !fogged(o!))) return "what the spell shows wasn't in the fog";
    // By mastery: basic, advanced, expert (the original's: artifacts, + heroes, + towns; resources, + mines, + terrain).
    const shows = (mastery: number) => viewSights(s, 0, air ? { air: mastery } : { earth: mastery });
    const [first, second] = want as AdvObject[];
    for (const mastery of [1, 2, 3]) {
      const sh = shows(mastery);
      const has = (o: AdvObject) => sh.objects.includes(o.id);
      if (!has(first)) return `${air ? "the artifact" : "the gold"} isn't shown at mastery ${mastery}`;
      if (air) {
        if (rival.length && rival.every((x) => sh.heroes.includes(x.id)) !== mastery >= 2) return `the rival's hero ${mastery >= 2 ? "isn't" : "is"} shown at mastery ${mastery}`;
        if (has(second) !== mastery >= 3) return `the rival's town ${mastery >= 3 ? "isn't" : "is"} shown at mastery ${mastery}`;
        if (sh.heroes.some((x) => s.heroes[x].owner === 0)) return "the player's own heroes among those shown";
      } else {
        if (has(second) !== mastery >= 2) return `the sawmill ${mastery >= 2 ? "isn't" : "is"} shown at mastery ${mastery}`;
        if (sh.terrain !== mastery >= 3) return `the terrain ${mastery >= 3 ? "isn't" : "is"} shown at mastery ${mastery}`;
        if (sh.heroes.length) return "heroes shown by View Earth";
      }
    }
    // Until the day ends: gone the next morning.
    const why = spent();
    newDay(s, w);
    if (Object.keys(mapViews(s, 0)).length) return "still shown the next day";
    return why;
  }
  return "no proof for this spell";
}

const proofs: Record<string, string | null | ArtifactProof> = {};
let n = 0;
let ok = 0;
for (const g of coverage.groups)
  for (const sec of g.sections)
    for (const item of sec.items) {
      if (!item.scene) continue;
      const c = parseSceneName(item.scene);
      if (!c || (only && c.kind !== only)) continue;
      let r: string | null | ArtifactProof;
      try {
        r = prove(item.scene);
      } catch (e) {
        r = `error: ${e instanceof Error ? e.message : e}`;
      }
      proofs[item.scene] = r;
      n++;
      const proof = r !== null && typeof r === "object" ? r.proof : r;
      if (proof === null) ok++;
      else if (process.env.DEBUG) console.log(`${sec.name} / ${item.name}: ${proof}${r !== null && typeof r === "object" && r.note ? ` [${r.note}]` : ""}`);
      if (process.env.DEBUG && r !== null && typeof r === "object" && /no checker/.test(r.note)) console.log(`${sec.name} / ${item.name}: ${r.note}`);
    }
console.log(`${n} scenes: ${ok} proven; ${questions} questions shown on screen${visitAgain.direct ? ` (${visitAgain.direct} second visits made directly: the hero wasn't standing on the thing)` : ""}`);
if (!only) writeFileSync(join(root, "packages/client/src/sceneProofs.json"), JSON.stringify(proofs) + "\n");
// A gate (tools/gate/rules.sh): every scene proven, and some there (none without the game files).
if (!n || ok < n) process.exitCode = 1;
void B;
