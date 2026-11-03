// Does the computer use each thing? Per entity, on its own minimal scene (core scenes.ts) with the
// computer playing the player's side too, nothing staged but the occasion a spell is for:
//   - an artifact: walked to, picked up and worn (not left in the pack);
//   - a map object: the computer's hero goes to it of its own accord and gets what it gives (the
//     scene played again without the object is the control: what differs is the object's doing);
//   - a battle spell: the computer's hero attacks the scene's stack and casts the spell in that fight
//     (if it doesn't attack, the fight is forced and the cast still looked for, noted as forced);
//   - an adventure spell: cast on the map;
//   - a building: built in the scene's town (everything else there, gold to spare);
//   - a creature: recruited from its dwelling (upgraded at a Hill Fort when it's an upgrade), and in
//     its battle recipe the abilities it chooses to use (its spells, its shots) used by the battle AI
//     without being told to.
// Writes packages/client/src/aiUsage.json for the Completeness page ("AI uses" mark): per scene or
// creature, { map?, battle?, note }.
//   node packages/sim/src/aicheck.ts [kind] [id]      DAYS=<n> (default 4)   DEBUG=1
//   The scenes are spread over worker threads (JOBS=<n>, default every core); the results don't depend on how many.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { aiStamp, ratchet } from "./aiStamp.ts";
import { join } from "node:path";
import { ResourceStore } from "@heroes/formats/node";
import {
  type AdventureEvent,
  type AdventureState,
  type BattleEvent,
  type BattleRecipe,
  type BattleSetup,
  type CreatureStats,
  type BattleState,
  type Hero,
  type World,
  B,
  DWELLINGS,
  GRAIL_ARTIFACT,
  Obj,
  SCENE_SIEGE,
  SPELL,
  UPGRADE_OF,
  adventureAiTurn,
  COMBAT_SPELLS,
  aiStep,
  areAdjacent,
  recipeCount,
  reachable,
  canShoot,
  chooseAction,
  applyAdventureAction,
  buildGameData,
  beginAdventure,
  createBattle,
  creatureRecipe,
  finishBattle,
  type MapPrep,
  type Prep as CorePrep,
  generateScene,
  parseSceneName,
  sceneOccasion,
  sceneName,
  sceneObject,
  startBattle,
  startFight,
  visitTile,
  waitingFor,GAME_LINE_FILES,
} from "@heroes/core";
import { snapshot } from "./objectcheck.ts";
import { noUse } from "./aiNoUse.ts";
import { isMainThread, pool, serve, threads } from "./pool.ts";

const root = join(import.meta.dirname, "../../..");
const store = new ResourceStore((process.env.HEROES_DATA_DIRS ?? "").split(":").filter(Boolean), (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
const spells = data.spells ?? [];
const coverage = JSON.parse(readFileSync(join(root, "packages/client/src/coverage.json"), "utf8")) as { groups: { name: string; sections: { name: string; items: { name: string; scene?: string; play?: string }[] }[] }[] };
const [onlyKind, onlyId] = process.argv.slice(2);
const DAYS = Number(process.env.DAYS ?? 4);
const debug = !!process.env.DEBUG;

export interface AiUse {
  /** Used on the adventure map (picked up and worn, visited, built, recruited, cast). */
  map?: boolean;
  /** Used in battle (the spell cast, the creature's own choices made). */
  battle?: boolean;
  /** What was seen, in words. */
  note: string;
}

/** A battle the computer's hero fought, with every event. */
interface Fought {
  b: BattleState;
  events: BattleEvent[];
  forced?: boolean;
}
interface Play {
  s: AdventureState;
  w: World;
  h: Hero;
  /** The computer's own (player 0's) adventure events. */
  events: AdventureEvent[];
  fought: Fought[];
  /** The day each of player 0's events came on. */
  eventDays: number[];
  /** player 0's snapshot at the end of each of its days (from day 1). */
  days: ReturnType<typeof snapshot>[];
}

/** A change to the scene's map before the game starts, and to the game as it starts (occasions.ts). */
type Prep = CorePrep;

/** The scene, every player the computer. */
function start(name: string, prep?: Prep, mapPrep?: MapPrep) {
  const c = parseSceneName(name)!;
  const map = generateScene(data, c);
  mapPrep?.(map, data);
  const { state: s, world: w } = beginAdventure(map, data, { seed: 1, mapFile: name, controllers: map.players.map((p) => (p.canComputer || p.canHuman ? "ai" : "none")) });
  const h = s.heroes.find((x) => !x.removed && x.owner === 0)!;
  prep?.(s, w, h);
  w.refresh(s);
  return { c, s, w, h };
}

/** Plays the scene for DAYS days, the computer on every side; the occasion staged in each of player 0's battles. */
function play(name: string, prep?: Prep, stage?: (b: BattleState) => void, mapPrep?: MapPrep): Play {
  const { s, w, h } = start(name, prep, mapPrep);
  const out: Play = { s, w, h, events: [], fought: [], eventDays: [], days: [] };
  const mine = (day: number, ev: AdventureEvent[]) => (out.events.push(...ev), out.eventDays.push(...ev.map(() => day)));
  for (let turns = 0; s.day <= DAYS && s.winner === undefined && turns < 2000; turns++) {
    const player = s.turnMode === "sequential" ? s.current : waitingFor(s)[0];
    const day = s.day;
    const ev = adventureAiTurn(s, w, player);
    if (player === 0) mine(day, ev);
    const fight = s.battles[player];
    if (fight) {
      if (player === 0) stage?.(fight.battle);
      const events = runAll(fight.battle);
      if (player === 0) out.fought.push({ b: fight.battle, events });
      const after = finishBattle(s, w, player);
      if (player === 0) mine(day, after);
    }
    if (player === 0) out.days[day] = snapshot(s, w, h);
  }
  return out;
}

/** Spells whose cast is judged by its target (judgeCast). */
const JUDGED = new Set<number>([SPELL.CLONE, SPELL.BLIND, SPELL.HYPNOTIZE, SPELL.BERSERK, SPELL.TELEPORT]);
const worthOf = (u: BattleState["units"][number]) => u.initialCount * (data.creatures[u.creature]?.aiValue ?? 0);
/**
 * Whether a cast was wise: "" when it was, else why not (the target, from the stacks' worth at the start).
 * Clone: our strongest stack; Blind and Hypnotize: the enemy's strongest; Berserk: enemies only, and
 * among the strongest or amid its own side; Teleport: one of ours.
 */
function judgeCast(b: BattleState, id: number, e: Extract<BattleEvent, { e: "spell" }>): string {
  if (!JUDGED.has(id)) return "";
  const units = b.units.filter((u) => !u.machine && !u.clone && !u.summoned);
  const target = b.units.find((u) => u.id === e.units[0]);
  if (!target) return "no target";
  const top = (side: number) => Math.max(...units.filter((u) => u.side === side).map(worthOf));
  if (id === SPELL.CLONE) return target.side === 0 && worthOf(target) >= top(0) * 0.99 ? "" : "not our strongest stack";
  if (id === SPELL.BLIND || id === SPELL.HYPNOTIZE) return target.side === 1 && worthOf(target) >= top(1) * 0.9 ? "" : target.side !== 1 ? "on our own stack" : "not the enemy's strongest stack";
  if (id === SPELL.BERSERK) return e.units.every((x) => b.units.find((u) => u.id === x)?.side === 1) ? "" : "on our own stack";
  // (Teleport: one of ours; where it landed can't be judged from the battle at its end.)
  if (id === SPELL.TELEPORT) return target.side === 0 ? "" : "on an enemy stack";
  return "";
}

/** The battle AI on both sides to the end. */
function runAll(b: BattleState): BattleEvent[] {
  for (const side of b.sides) side.controller = "ai";
  const events: BattleEvent[] = [];
  for (let i = 0, ev = aiStep(b); ev && i < 3000; ev = aiStep(b), i++) events.push(...ev);
  return events;
}

/**
 * player 0's heroes' events about this object (and their steps through the object's way in: a gate
 * let through says nothing). Any of its heroes: a hero hired on the first day may get there first.
 */
const touched = (p: Play, id: number) => {
  const gate = visitTile(p.w, p.s.objects[id]);
  const ours = (hero: number) => p.s.heroes[hero]?.owner === p.h.owner;
  return p.events.filter((e) => ("object" in e && e.object === id && (!("hero" in e) || ours(e.hero))) || (e.e === "move" && ours(e.hero) && e.path.includes(gate)));
};

// ---- Artifacts: worn after the computer's days.
function artifactUse(name: string, id: number): AiUse {
  const p = play(name);
  // The Grail: brought home, where its monument goes up.
  if (id === GRAIL_ARTIFACT) {
    const home = p.s.objects.some((o) => o.town && !o.removed && o.owner === 0 && o.town.built.includes(B.GRAIL));
    return { map: home, note: home ? "picked up and brought home: the Grail's monument built" : "the Grail not brought home" };
  }
  // (By any hero of ours: the one hired on the first day may be handed it at a meeting.)
  const ours = p.s.heroes.filter((x) => !x.removed && x.owner === 0);
  const worn = ours.some((x) => (x.equipped ?? []).includes(id));
  const carried = ours.some((x) => (x.backpack ?? []).includes(id));
  return { map: worn, note: worn ? "picked up and worn" : carried ? "picked up but left in the pack" : "not picked up" };
}

// ---- Map objects: gone to, and the hero (or player) better off than without it.
/** What an object's use can change, from the snapshot (not where the hero stands or how far it walked, nor what it saw: REVEALS). */
const gains = (x: ReturnType<typeof snapshot>) => JSON.stringify({ ...x, movement: 0, x: 0, y: 0, revealed: 0 });
/** Places that show the map (the Cartographer, the Hut of the Magi, the Redwood Observatory, the Pillar of Fire): more seen by the end of the day it went there than the control saw that day. */
const REVEALS = new Set([13, 37, 58, 60]);
/**
 * Whether the computer's hero used the object, besides being better off at the end (`gains`):
 * flagging it (a lighthouse's longer voyages, a garrison or dwelling of ours: owning it is the use),
 * using it up (a corpse or chest searched may hold nothing: searching it is all there is to do),
 * being taken through it, or, on the day it went there, seeing more (a place that shows the map) or
 * being better off (a bonus for a day or two).
 */
function usedBy(p: Play, q: Play, id: number, owner: number): string | undefined {
  const o = p.s.objects[id];
  if (owner !== 0 && o.owner === 0) return "flagged";
  if (o.removed) return "used up";
  const t = touched(p, id);
  if (t.some((e) => e.e === "teleport")) return "taken through";
  // (A Border Gate: passing through it is the use.)
  if (o.type === 212 && t.some((e) => e.e === "move")) return "let through";
  // The day it went there, against the control's same day: what it saw (and only that, for a place that shows the map), or what lasts a day or two (a HotA place's bonus).
  const day = p.eventDays[p.events.indexOf(t[0])];
  const [a, b] = [p.days[day], q.days[day]];
  if (REVEALS.has(o.type)) return a && b && a.revealed > b.revealed ? `${a.revealed - b.revealed} more tiles seen that day` : undefined;
  if (gains(snapshot(p.s, p.w, p.h)) !== gains(snapshot(q.s, q.w, q.h))) return "better off than without it";
  if (a && b && gains(a) !== gains(b)) return "better off that day than without it";
  return undefined;
}
/** Objects whose use is a loss here: the check is that the computer leaves them alone. */
const AVOIDED: Record<string, string> = {
  "92": "the Sirens take 30% of every stack for less experience than the troops are worth",
  "146:2": "the Altar of Mana takes troops for spell points (out of mana, its army worth more)",
};
function objectUse(name: string): AiUse {
  const first = start(name);
  const o = sceneObject(first.s) ?? first.s.objects.find((x) => !x.removed && x.type === first.c.id && x.z === 0 && !x.town);
  if (!o) return { note: "the object isn't on the scene" };
  const key = `${o.type}:${o.subid}`;
  const occasion = sceneOccasion({ kind: "object", id: o.type, sub: o.subid });
  const avoided = AVOIDED[key] ?? AVOIDED[o.type];
  if (avoided) {
    const touches = touched(play(name, occasion?.prep), o.id).length;
    return { map: !touches, note: touches ? `gone to, though ${avoided}` : `rightly left alone: ${avoided}` };
  }
  const why = noUse(o.type, o.subid);
  if (why) return { note: `nothing to use: ${why}` };
  const prep = occasion?.prep;
  const p = play(name, prep, undefined, occasion?.map);
  const t = touched(p, o.id);
  const with_ = occasion ? ` (${occasion.why})` : "";
  // (A border guard let us through leaves without a word: gone, it was gone to.)
  if (!t.length && !p.s.objects[o.id].removed) return { map: false, note: `not gone to in ${DAYS} days${with_}` };
  // The control: the same scene without the object.
  const q = play(
    name,
    (s, w, h) => {
      prep?.(s, w, h);
      s.objects[o.id].removed = true;
    },
    undefined,
    occasion?.map,
  );
  const used = usedBy(p, q, o.id, o.owner);
  const kinds = [...new Set(t.map((e) => e.e))].join(", ") || "passed";
  return { map: !!used, note: used ? `gone to (${kinds})${with_}: ${used}` : `gone to (${kinds})${with_}, nothing gained` };
}

// ---- Spells.
function spellUse(name: string, id: number): AiUse {
  const occasion = sceneOccasion({ kind: "spell", id });
  if (id < 10) {
    const castBy = (p: Play) => p.events.some((e) => e.e === "spell" && e.hero === p.h.id && e.spell === id);
    if (castBy(play(name))) return { map: true, note: "cast on the map" };
    // Nothing in the scene to cast it for: the occasion staged.
    const why = occasion;
    if (!why) return { map: false, note: `not cast on the map in ${DAYS} days` };
    const cast = castBy(play(name, why.prep, undefined, why.map));
    return { map: cast, note: cast ? `cast on the map (${why.why})` : `not cast on the map in ${DAYS} days, nor with ${why.why}` };
  }
  const prep = occasion?.prep;
  const stage = (b: BattleState) => occasion?.battle?.(b, data);
  const p = play(name, prep, stage);
  const castIn = (f: Fought) => f.events.some((e) => e.e === "spell" && e.side === 0 && e.spell === id && !e.ability);
  // The cast judged, for the spells whose use is a matter of the target (Clone, Blind, Hypnotize, Berserk, Teleport).
  const judged = (f: Fought) => {
    const casts = f.events.filter((e): e is Extract<BattleEvent, { e: "spell" }> => e.e === "spell" && e.side === 0 && e.spell === id && !e.ability);
    const verdicts = casts.map((e) => judgeCast(f.b, id, e));
    return verdicts.find((v) => v === "") === "" ? "" : verdicts[0] ?? "";
  };
  if (p.fought.length) {
    const cast = p.fought.some(castIn);
    const why = cast ? p.fought.filter(castIn).map(judged).find((v) => v === "") ?? p.fought.filter(castIn).map(judged)[0] : "";
    if (cast && why) return { battle: false, note: `attacked the stack and cast it, but badly: ${why}` };
    return { battle: cast, note: cast ? `attacked the stack and cast it${JUDGED.has(id) ? ", on the right target" : ""}` : `attacked the stack, didn't cast it (${p.fought.length} fight${p.fought.length > 1 ? "s" : ""})` };
  }
  // Not attacked: the fight forced, to see the battle AI's choice anyway.
  const g = start(name, prep);
  const o = sceneObject(g.s);
  const rival = id === SPELL.EARTHQUAKE ? g.s.objects.find((x) => x.town && !x.removed && x.owner === 1 && x.y <= 12) : undefined;
  if (rival) {
    g.h.movement = g.h.maxMovement;
    applyAdventureAction(g.s, g.w, { type: "move", hero: g.h.id, to: g.w.index(SCENE_SIEGE.x, SCENE_SIEGE.y, 0) }, 0);
  } else if (o?.type === Obj.MONSTER) startFight(g.s, g.w, g.h, o);
  const b = g.s.battles[0]?.battle;
  if (!b) return { battle: false, note: "didn't attack, and no fight could be forced" };
  stage(b);
  const cast = castIn({ b, events: runAll(b) });
  return { battle: cast, note: cast ? "didn't attack on its own; cast it when the fight was forced" : "didn't attack on its own, nor cast it when the fight was forced" };
}

// ---- Buildings: built in the scene's town.
function buildingUse(name: string, id: number): AiUse {
  const g = start(name);
  const town = g.s.objects.find((o) => o.town && !o.removed && o.owner === 0)!;
  if (town.town!.built.includes(id)) return { note: "the town starts with it" };
  // (The ship, building 20, is a boat at the shipyard: bought when there's somewhere to sail, as Summon Boat's scene checks.)
  if (id === 20) return { note: "the ship is a boat bought at the shipyard, not a building to decide on" };
  const p = play(name);
  const built = p.s.objects[town.id].town!.built.includes(id);
  return { map: built, note: built ? "built" : `not built in ${DAYS} days` };
}

// ---- Creatures.
const DWELLING_OF = new Map<number, number>();
for (const [sub, list] of Object.entries(DWELLINGS)) for (const cr of list) if (!DWELLING_OF.has(cr)) DWELLING_OF.set(cr, Number(sub));
const HILL_FORT = 35;
const SPELLCASTERS = ["SPELLCASTER", "RANDOM_SPELLCASTER", "ADJACENT_SPELLCASTER"];
const hasStack = (h: Hero, cr: number) => h.army.some((a) => a?.creature === cr && a.count > 0);
function creatureMapUse(id: number): Pick<AiUse, "map" | "note"> {
  const sub = DWELLING_OF.get(id);
  if (sub !== undefined) {
    // (Levels 5 to 7 are guarded by three weeks' growth: an army that beats them, as a bank's scene has.)
    const strong = (data.creatures[id]?.level ?? 1) >= 5;
    const p = play(sceneName({ kind: "object", id: 17, sub }), strong ? (s, w, h) => void (h.army = [{ creature: 13, count: 40 }, { creature: 41, count: 40 }, { creature: 83, count: 20 }, null, null, null, null]) : undefined);
    const town = p.s.objects.find((o) => o.town && !o.removed && o.owner === 0);
    const got = hasStack(p.h, id) || p.s.heroes.some((x) => !x.removed && x.owner === 0 && hasStack(x, id)) || !!town?.town?.garrison.some((a) => a?.creature === id);
    return { map: got, note: got ? "recruited from its dwelling" : `not recruited from its dwelling in ${DAYS} days` };
  }
  const base = Object.entries(UPGRADE_OF).find(([, up]) => up === id)?.[0];
  if (base !== undefined) {
    const p = play(sceneName({ kind: "object", id: HILL_FORT }), (s, w, h) => void (h.army[3] = { creature: Number(base), count: 10 }));
    const got = hasStack(p.h, id);
    return { map: got, note: got ? `upgraded from ${data.creatures[Number(base)]?.plural} at the Hill Fort` : `${data.creatures[Number(base)]?.plural} not upgraded at the Hill Fort in ${DAYS} days` };
  }
  return { note: "no dwelling or upgrade to get it from" };
}
const ARCHER = 2;
const PIKEMAN = 0;
const TITAN = 41;
const casts = (c: CreatureStats, key: string) => c.abilities.some((a) => a.type === "SPELLCASTER" && a.subtype === key);
/**
 * The occasion a creature's choice is for, where its recipe (made to show the ability, not to give
 * the AI a reason) has none, as a spell's occasion (occasions.ts) does:
 *  - Teleport (Jotunns): the enemy's archers far off and no hero spells, so the Jotunns have nothing
 *    to strike and the Pikemen beside them a long walk;
 *  - a Protection cast by shooters (Ice and Storm Elementals), which weigh it against their shot: a
 *    strong enemy hero with that school's damage spells, Titans beside them it would hurt, and only
 *    Pikemen to shoot at (in the recipe the hero's spells of the school can't touch the Ice
 *    Elementals and the Pikemen beside them are worth less than a shot).
 */
/** A recipe, and the spells the left hero is staged as having cast already (what the other side has seen of its book). */
type Staged = BattleRecipe & { seen?: number[] };
function battleReason(c: CreatureStats, r: BattleRecipe): { r: Staged; reason?: string } {
  const guard = c.abilities.find((a) => a.type === "SPELLCASTER" && a.subtype?.startsWith("protect"))?.subtype;
  if (guard && c.abilities.some((a) => a.type === "SHOOTER")) {
    const school = guard.slice("protect".length).toLowerCase();
    const book = spells.filter((sp) => COMBAT_SPELLS[sp.id]?.damage && sp.schools.includes(school as never)).map((sp) => sp.id);
    const own = [{ creature: c.id, count: recipeCount(c) }, { creature: TITAN, count: 10 }];
    // (Seen casting them already: the AI reads only what a player would know, never the enemy's spellbook.)
    return { r: { left: [{ creature: PIKEMAN, count: 50 }], right: own, spells: book, seen: book, what: r.what, power: 15 }, reason: `a strong enemy hero seen casting ${school} spells, Titans beside them` };
  }
  if (guard && r.spells?.length) {
    // (A Protection cast by a fighter (Energy Elementals): its recipe's enemy hero seen casting that school's spells.)
    const school = guard.slice("protect".length).toLowerCase();
    const seen = r.spells.filter((id) => spells.find((sp) => sp.id === id)?.schools.includes(school as never));
    if (seen.length) return { r: { ...r, seen }, reason: `the enemy hero seen casting ${school} spells` };
  }
  if (c.abilities.some((a) => a.type === "SPELLCASTER" && a.subtype === "meditation01")) {
    // Meditation pays when the blows coming outweigh its own: archers far off, aiming at it, still to shoot this round.
    const own = [{ creature: c.id, count: recipeCount(c) }];
    return { r: { ...r, tight: undefined, deep: undefined, spells: undefined, rightSpells: undefined, skills: undefined, left: own, right: [{ creature: ARCHER, count: 250 }] }, reason: "a crowd of archers aiming at them, too many to cut down first" };
  }
  if (casts(c, "teleport")) {
    const mine = r.left.some((x) => x.creature === c.id) && r.left.length > 1 ? "left" : "right";
    // (As many as the Pikemen beside them: a match for them, not a volley that ends it at once.)
    const archers = { creature: ARCHER, count: 40 };
    const own = r[mine];
    return { r: { ...r, spells: undefined, rightSpells: undefined, skills: undefined, left: mine === "left" ? own : [archers], right: mine === "right" ? own : [archers] }, reason: "the enemy's archers far off" };
  }
  return { r };
}
/** Devour Corpses (Olgoi-Khorkhoi): the ally beside them has fallen as the battle begins, a few steps ahead of them toward the enemy. */
const stageReason = (c: CreatureStats) => (casts(c, "summonLarva") ? "an ally fallen on their way" : casts(c, "summonDemons") ? "a stack of theirs fallen" : undefined);
function stageCreature(b: BattleState, c: CreatureStats) {
  // Pit Lords: a stack of ours fallen to raise as Demons (in the recipe the Pit Lords fell before their Imps did).
  if (casts(c, "summonDemons")) {
    const fallen = b.units.find((u) => u.side === b.units.find((x) => x.creature === c.id)?.side && u.creature !== c.id && !u.machine);
    if (fallen) (fallen.count = 0), (fallen.firstHp = 0);
    return;
  }
  if (!casts(c, "summonLarva")) return;
  const worm = b.units.find((u) => u.creature === c.id && u.count > 0 && b.units.some((x) => x.side === u.side && x !== u && !x.machine));
  const ally = worm && b.units.find((u) => u.side === worm.side && u !== worm && !u.machine);
  if (!worm || !ally) return;
  ally.count = 0;
  const ahead = (n: number) => worm.pos + (worm.side === 0 ? n : -n);
  const reach = reachable(b, worm);
  ally.pos = [4, 3, 5, 2].map(ahead).find((h) => reach.has(h)) ?? ally.pos;
}
/** In its recipe (core recipes.ts), the battle AI on both sides and nothing told: does it use what it chooses to use? */
function creatureBattleUse(id: number): Pick<AiUse, "battle" | "note"> {
  const c = data.creatures[id];
  if (c.abilities.some((a) => a.type === "SIEGE_WEAPON" || a.type === "CPU_CONTROLLED")) return { note: "a war machine" };
  const recipe = creatureRecipe(c, data.creatures, spells);
  const caster = c.abilities.some((a) => SPELLCASTERS.includes(a.type));
  const shooter = c.abilities.some((a) => a.type === "SHOOTER");
  const wants = [caster && "cast", shooter && "shoot", "strike"].filter(Boolean) as string[];
  const seen = new Set<string>();
  let couldShoot = false;
  let couldStrike = false;
  /** Fights the scene (four seeds at most) and notes what the battle AI chose for the creature. */
  const fight = (r: Staged, stage: boolean) => {
    for (let seed = 1; seed <= 4 && wants.some((x) => !seen.has(x)); seed++) {
      const setup: BattleSetup = {
        seed,
        siege: r.siege ? { faction: r.siege, level: 3, structures: 12 } : undefined,
        sides: [
          { name: "Left", controller: "ai", stacks: r.left, hero: { name: "Left", heroClass: 0, female: false, owner: 0, primary: [5, 5, r.power ?? 5, r.knowledge ?? 10], spells: r.spells, mana: 10 * (r.knowledge ?? 10), machines: [] }, tight: r.tight, deep: r.deep === "left" || r.deep === "both" },
          { name: "Right", controller: "ai", stacks: r.right, hero: { name: "Right", heroClass: 0, female: false, owner: 1, primary: [5, 5, 5, 10], spells: r.rightSpells, mana: 100, machines: [] }, tight: r.tight, deep: r.deep === "right" || r.deep === "both" },
        ],
      };
      const b = createBattle(setup, data.creatures, spells);
      startBattle(b);
      if (r.seen) b.castLog = [[...r.seen], []];
      if (stage) stageCreature(b, c);
      const A = new Set(b.units.filter((u) => u.creature === id).map((u) => u.id));
      for (const side of b.sides) side.controller = "ai";
      for (let i = 0; i < 3000 && b.winner === null; i++) {
        const u = b.units[b.active ?? -1];
        const mine = !!u && A.has(u.id);
        // What the battle AI picks for it (looked at on a copy, so the battle itself runs as ever).
        const choice = mine ? chooseAction(structuredClone(b)) : undefined;
        if (mine && canShoot(b, u)) couldShoot = true;
        if (mine && !couldStrike) {
          const foes = b.units.filter((e) => e.count > 0 && e.side !== u.side && e.machine !== "tower");
          couldStrike = [...reachable(b, u).keys()].some((h) => foes.some((e) => areAdjacent(b, u, h, e)));
        }
        const ev = aiStep(b);
        if (!ev) break;
        // (A step that was the hero's cast: the creature acts in the next.)
        if (!choice || ev.some((e) => e.e === "spell" && e.by === undefined && !e.ability)) continue;
        if (choice.type === "creatureCast") seen.add("cast");
        if (choice.type === "shoot") seen.add("shoot");
        if (choice.type === "attack") seen.add("strike");
      }
      // Shooters that shoot have struck; casters that cast have acted.
      if (seen.has("shoot") || seen.has("cast")) seen.add("strike");
    }
  };
  const how: string[] = [];
  fight(recipe, false);
  // Where the recipe gives no reason for a choice, the occasion staged.
  const { r: reasoned, reason } = battleReason(c, recipe);
  const staged = stageReason(c);
  if (wants.some((x) => !seen.has(x)) && (reason || staged)) {
    const before = seen.size;
    fight(reasoned, !!staged);
    if (seen.size > before) how.push(reason ?? staged!);
  }
  // The heroes' spells (there for the recipe's proof) can end the fight before the stack's shot or
  // blow comes round: the fight again without them.
  const blows = () => wants.filter((x) => x !== "cast" && !seen.has(x)).length;
  if (blows() && (recipe.spells?.length || recipe.rightSpells?.length)) {
    const before = blows();
    fight({ ...recipe, spells: undefined, rightSpells: undefined }, false);
    if (blows() < before) how.push("without the heroes' spells, which ended the fight first");
  }
  // A recipe's few (the Automatons, to show their detonation) can fall before anyone is in reach: a full stack of them.
  const few = (list: BattleRecipe["left"]) => list.map((x) => (x.creature === id ? { ...x, count: Math.max(x.count, recipeCount(c)) } : x));
  if (!seen.has("strike") && !couldStrike && [...recipe.left, ...recipe.right].some((x) => x.creature === id && x.count < recipeCount(c))) {
    fight({ ...recipe, left: few(recipe.left), right: few(recipe.right) }, false);
    if (seen.has("strike")) how.push(`${recipeCount(c)} of them, as the recipe's few fell before anyone was in reach`);
  }
  // (A shooter kept in melee all battle had no shot to choose; a stack nobody came near before it fell, no blow.)
  const missing = wants.filter((x) => !seen.has(x) && (x !== "shoot" || couldShoot) && (x !== "strike" || couldStrike));
  const unused = wants.filter((x) => !seen.has(x) && !missing.includes(x));
  const where = `in its recipe${how.length ? ` (and ${how.join("; ")})` : ""}`;
  const none = unused.length ? ` (no chance to ${unused.join(" or ")}: ${unused.includes("strike") ? "nobody in reach before it fell" : "never had a shot"})` : "";
  const chose = wants.filter((x) => seen.has(x));
  return { battle: !missing.length, note: missing.length ? `${where}, never chose to ${missing.join(" or ")}` : chose.length ? `${where}, chose to ${chose.join(" and ")}${none}` : `${where}, had${none.slice(2, -1)}` };
}

// ---- The run.
/** A scene or a creature to check (what the Completeness page lists, and every creature). */
type Job = { scene: string; kind: string; id: number; label: string } | { creature: number; label: string };
function check(j: Job): AiUse {
  try {
    if ("creature" in j) {
      const m = creatureMapUse(j.creature);
      const b = creatureBattleUse(j.creature);
      return { map: m.map, battle: b.battle, note: [m.note, b.note].join("; ") };
    }
    return j.kind === "artifact" ? artifactUse(j.scene, j.id) : j.kind === "object" ? objectUse(j.scene) : j.kind === "spell" ? spellUse(j.scene, j.id) : buildingUse(j.scene, j.id);
  } catch (e) {
    return "creature" in j ? { note: `error: ${e instanceof Error ? e.message : e}` } : { map: false, note: `error: ${e instanceof Error ? e.message : e}` };
  }
}
if (!isMainThread) {
  serve(check);
  // (A worker only answers the main thread's jobs.)
  await new Promise(() => {});
}
const want = (kind: string, id: number) => (!onlyKind || onlyKind === kind) && (!onlyId || String(id) === onlyId);
const jobs: Job[] = [];
for (const g of coverage.groups)
  for (const sec of g.sections)
    for (const item of sec.items) {
      const c = item.scene ? parseSceneName(item.scene) : null;
      if (!c || !want(c.kind, c.id)) continue;
      if (!["artifact", "object", "spell", "building"].includes(c.kind)) continue;
      jobs.push({ scene: item.scene!, kind: c.kind, id: c.id, label: `${sec.name} / ${item.name}` });
    }
for (const c of data.creatures) {
  if (!c.name || /^(creature|unused)\d/.test(c.key) || /^not used/i.test(c.name) || !want("creature", c.id)) continue;
  jobs.push({ creature: c.id, label: `Creatures / ${c.name}` });
}
const results = threads() > 1 && jobs.length > 1 ? await pool<Job, AiUse>(new URL(import.meta.url), jobs) : jobs.map(check);

const out: Record<string, AiUse> = {};
const tally: Record<string, [number, number]> = {};
const count = (k: string, ok: boolean | undefined) => {
  if (ok === undefined) return;
  const t = (tally[k] ??= [0, 0]);
  (t[1]++, ok && t[0]++);
};
jobs.forEach((j, i) => {
  const r = results[i];
  if ("creature" in j) {
    out[`creature-${j.creature}`] = r;
    count("creature (map)", r.map);
    count("creature (battle)", r.battle);
    if (debug && (r.map === false || r.battle === false)) console.log(`${j.label}: ${r.note}`);
  } else {
    out[j.scene] = r;
    count(j.kind === "spell" ? (j.id < 10 ? "spell (map)" : "spell (battle)") : j.kind, r.map ?? r.battle);
    if (debug && (process.env.DEBUG === "all" || !(r.map ?? r.battle ?? true))) console.log(`${j.label}: ${r.note}`);
  }
});
for (const [k, [n, of]] of Object.entries(tally)) console.log(`${k}: the computer uses ${n} of ${of}`);
if (!onlyKind) {
  const path = join(root, "packages/client/src/aiUsage.json");
  const marks = (uses: Record<string, AiUse>) => new Map(Object.entries(uses).flatMap(([k, r]) => (["map", "battle"] as const).filter((f) => r[f] !== undefined).map((f) => [`${k} ${f}`, !!r[f]] as [string, boolean])));
  const before = existsSync(path) ? marks((JSON.parse(readFileSync(path, "utf8")) as { uses: Record<string, AiUse> }).uses) : new Map<string, boolean>();
  if (ratchet("AI uses", before, marks(out))) writeFileSync(path, JSON.stringify({ days: DAYS, stamp: aiStamp(), uses: out }) + "\n");
}
