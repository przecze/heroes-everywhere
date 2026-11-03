// Proves each creature's battle recipe (core recipes.ts): plays it with the AI on both sides (the
// player's hero casting the recipe's spells first, spellcasting creatures told to cast) over a few
// seeds, and checks that each of the creature's abilities showed in the battle: a second swing, a
// breath that reached the neighbour, a blind that didn't take, Slow failing on dwarves, a death
// cloud that spared the skeletons... What the AI's play doesn't bring about on its own is staged
// (the dragon put beside two packed stacks and told to strike). Writes
// packages/client/src/battleProofs.json for the Completeness page: per creature, whether its
// checkable abilities all showed (null) or what didn't, and which abilities have no checker.
//   node packages/sim/src/battlecheck.ts [creature id or name]      DEBUG=1 prints every failure
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ResourceStore } from "@heroes/formats/node";
import {
  type Ability,
  type BattleEvent,
  type BattleHero,
  type BattleRecipe,
  type BattleSetup,
  type BattleState,
  type CreatureStats,
  type Side,
  type Unit,
  COMBAT_SPELLS,
  SPELL,
  HEX_COUNT,
  activeUnit,
  aiStep,
  applyAction,
  areAdjacent,
  buildGameData,
  canShoot,
  canStand,
  hexCol,
  hexRow,
  createBattle,
  creatureRecipe,
  defenseOf,
  speedOf,
  effectOf,
  enchant,
  expectedDamage,
  neighbours,
  reachable,
  skillId,
  spellDamage,
  spellCost,
  startBattle,
  unitHexes,
  battleAiRefusals,
  type OurLine,
  logLines,GAME_LINE_FILES,
} from "@heroes/core";

const root = join(import.meta.dirname, "../../..");
const store = new ResourceStore((process.env.HEROES_DATA_DIRS ?? "").split(":").filter(Boolean), (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
const spells = data.spells ?? [];
const only = process.argv[2];

/** Abilities with nothing to see in a battle (tags, map effects, what the engine reads elsewhere). */
const NO_CHECK = new Set(["NONE", "SIEGE_WEAPON", "CPU_CONTROLLED", "BLOCKS_RANGED_RETALIATION", "MULTIHEX_ANIMATION", "DRAGON_NATURE", "SKELETON_TRANSFORMER_TARGET", "MECHANICAL", "GENERATE_RESOURCE", "STACKS_SPEED", "SPECIAL_CRYSTAL_GENERATION", "PRIMARY_SKILL", "YETI_RUNE_LEVEL_COUNTER", "ENCHANTED", "SPECIFIC_SPELL_POWER", "CREATURE_ENCHANT_POWER", "CREATURE_SPELL_POWER", "CATAPULT_EXTRA_SHOTS", "MANA_CHANNELING", "GARGOYLE", "VISIONS", "NO_TERRAIN_PENALTY"]);
/** (Seen after all: the Jotunns' slowing of fliers, the War Mammoths' Defense defending; the Yeti Runemasters' rune speed isn't.) */
const noCheck = (a: Ability) => NO_CHECK.has(a.type) && !(a.type === "PRIMARY_SKILL" && a.subtype === "defenceWhileDefending") && !(a.type === "STACKS_SPEED" && (a.val ?? 0) < 0);
const SPELLCASTERS = ["SPELLCASTER", "RANDOM_SPELLCASTER", "ADJACENT_SPELLCASTER"];
/** What the log says when an after-attack spell takes (those that leave no effect to see). */
/** The log line an effect leaves (GENRLTXT 555, 367, 91; ours for the rest). */
const NOTES: Record<string, number | OurLine> = { dispelHelpful: 555, thunderbolt: 367, acidBreath: "acidBurned", disruptingRay: 91, freezingShot: "frozen" };

const hero = (owner: Side, book?: number[], skills?: [string, number][], power = 5, knowledge = 10): BattleHero => ({
  name: owner ? "Right" : "Left",
  heroClass: 0,
  female: false,
  owner,
  primary: [5, 5, power, knowledge],
  spells: book,
  mana: 10 * knowledge,
  machines: [],
  skills: skills?.map(([k, l]) => [skillId(k), l] as [number, number]).filter(([id]) => id >= 0),
});

function makeBattle(r: BattleRecipe, seed: number): BattleState {
  const setup: BattleSetup = {
    seed,
    siege: r.siege ? { faction: r.siege, level: 3, structures: 12 } : undefined,
    sides: [
      { name: "Left", controller: "human", stacks: r.left, hero: hero(0, r.spells, r.skills, r.power, r.knowledge), tight: r.tight, deep: r.deep === "left" || r.deep === "both" },
      { name: "Right", controller: "ai", stacks: r.right, hero: hero(1, r.rightSpells, r.skills, r.power, r.knowledge), tight: r.tight, deep: r.deep === "right" || r.deep === "both" },
    ],
  };
  const s = createBattle(setup, data.creatures, spells);
  startBattle(s);
  return s;
}

const alive = (u: Unit) => u.count > 0 && !u.machine;
/** Where the hero's spell goes: an own stack for a blessing, the enemy (the creature's stack if it's there) otherwise; a ring beside it. */
function targetFor(s: BattleState, spell: number, creature: number): number {
  const who = COMBAT_SPELLS[spell]?.who;
  const own = s.units.find((u) => alive(u) && u.side === 0);
  const enemy = s.units.find((u) => alive(u) && u.side === 1 && u.creature === creature) ?? s.units.find((u) => alive(u) && u.side === 1);
  const at = (who === "friend" ? own : enemy)?.pos ?? enemy?.pos ?? 0;
  return spell === SPELL.FROST_RING ? at - 1 : at;
}

interface Cast {
  spell: number;
  refused?: string;
  /** Units the spell hurt (damage > 0), units that resisted, the creature's units it took effect on. */
  hit: number[];
  resisted: number[];
  effected: number[];
  /** The damage to the creature's stacks, and the same cast without the creature's abilities. */
  damage: number;
  damageWithout: number;
  /** The same cast without the creature's abilities: refused, or its effect (or damage) on the creature's stacks. */
  refusedWithout: boolean;
  tookWithout: boolean;
  cost: number;
  costWithout: number;
}
interface Run {
  s: BattleState;
  events: BattleEvent[];
  casts: Cast[];
  /** A unit of the creature healed up between turns with nothing healing it. */
  regenerated: boolean;
  /** Spells seen as effects on the enemy's units (the creature's after-attack spells), and on the creature's own. */
  afflicted: Set<number>;
  selfEffects: Set<number>;
  /** Enemy attacks that landed on the creature's stacks, in all and by creature. */
  hitsOnA: number;
  hitsOnABy: Map<number, number>;
  /** The unit ids of the creature's stacks and their side. */
  A: Set<number>;
  aside: Side;
}

/** The state with the creature's abilities taken away (all of them, or these types): what the effect is compared with. */
function without(s: BattleState, creature: number, types?: string[]): BattleState {
  const t = structuredClone(s);
  const c = t.creatures[creature];
  t.creatures[creature] = { ...c, abilities: c.abilities.filter((a) => (types ? !types.includes(a.type) : false)) };
  return t;
}

/** Plays the recipe out: the player's hero casts the recipe's spells at its first turns, casting creatures are told to cast, the AI does the rest. */
function play(r: BattleRecipe, seed: number, creature: number): Run {
  const s = makeBattle(r, seed);
  const A = new Set(s.units.filter((u) => u.creature === creature).map((u) => u.id));
  const aside = (s.units.find((u) => u.creature === creature)?.side ?? 0) as Side;
  const run: Run = { s, events: [], casts: [], regenerated: false, afflicted: new Set(), selfEffects: new Set(), hitsOnA: 0, hitsOnABy: new Map(), A, aside };
  // One hero cast a round: a different spell first each seed, so a short battle still shows each.
  const book = r.spells ?? [];
  const pending = book.map((_, i) => book[(i + seed - 1) % book.length]);
  const rightBook = r.rightSpells ?? [];
  const caster = data.creatures[creature].abilities.some((a) => SPELLCASTERS.includes(a.type));
  let creatureCasts = 0;
  const hpOfA = () => [...A].map((id) => [s.units[id].count, s.units[id].firstHp] as const);
  const note = (ev: BattleEvent[]) => {
    run.events.push(...ev);
    for (const u of s.units) for (const e of u.effects ?? []) (A.has(u.id) ? run.selfEffects : u.side !== aside ? run.afflicted : new Set()).add(e.spell);
    for (const e of ev)
      if (e.e === "attack" && A.has(e.target) && !A.has(e.unit)) {
        run.hitsOnA++;
        const by = s.units[e.unit].creature;
        run.hitsOnABy.set(by, (run.hitsOnABy.get(by) ?? 0) + 1);
      }
  };
  for (let guard = 0; guard < 3000 && s.winner === null; guard++) {
    const u = activeUnit(s);
    if (!u) break;
    if (u.side === 0 && pending.length && !s.cast?.[0]) {
      const spell = pending.shift()!;
      const target = targetFor(s, spell, creature);
      const info = spells[spell];
      const cost = info ? spellCost(s, 0, info) : 0;
      const t = without(s, creature);
      const costWithout = info ? spellCost(t, 0, info) : 0;
      const dmgTo = (ev: BattleEvent[]) => ev.filter((e) => e.e === "spell").flatMap((e) => (e.e === "spell" ? e.damage : [])).filter((d) => A.has(d.unit)).reduce((a, d) => a + d.damage, 0);
      // (The same cast without the creature's abilities first: what the cast does to them is compared with it.)
      let damageWithout = 0;
      let refusedWithout = false;
      try {
        damageWithout = dmgTo(applyAction(t, { type: "cast", unit: u.id, spell, target }));
      } catch {
        refusedWithout = true;
      }
      const tookWithout = damageWithout > 0 || [...A].some((id) => effectOf(t.units[id], spell));
      try {
        const ev = applyAction(s, { type: "cast", unit: u.id, spell, target });
        note(ev);
        const sp = ev.filter((e) => e.e === "spell");
        run.casts.push({
          spell,
          hit: sp.flatMap((e) => (e.e === "spell" ? e.damage.filter((d) => d.damage > 0).map((d) => d.unit) : [])),
          resisted: sp.flatMap((e) => (e.e === "spell" ? e.resisted : [])),
          effected: [...A].filter((id) => effectOf(s.units[id], spell)),
          damage: dmgTo(ev),
          damageWithout,
          refusedWithout,
          tookWithout,
          cost,
          costWithout,
        });
      } catch (e) {
        run.casts.push({ spell, refused: e instanceof Error ? e.message : String(e), hit: [], resisted: [], effected: [], damage: 0, damageWithout, refusedWithout, tookWithout, cost, costWithout });
      }
      if (!pending.length && s.sides[0].hero) s.sides[0].hero.spells = [];
      continue;
    }
    if (u.side === 1 && rightBook.length && !s.cast?.[1]) {
      const at = s.units.find((x) => alive(x) && x.side === 0 && !A.has(x.id)) ?? s.units.find((x) => alive(x) && x.side === 0);
      try {
        note(applyAction(s, { type: "cast", unit: u.id, spell: rightBook[0], target: at?.pos ?? 0 }));
        continue;
      } catch {
        // Not castable now: the unit just acts.
      }
    }
    // A casting creature is told to cast (at an ally, the enemy, itself, or a free hex beside it), twice at most.
    if (A.has(u.id) && caster && creatureCasts < 2) {
      const ally = s.units.find((x) => alive(x) && x.side === u.side && x.id !== u.id);
      const enemy = s.units.find((x) => alive(x) && x.side !== u.side);
      const targets = [ally?.pos, enemy?.pos, u.pos, u.pos - 1, u.pos + 1, u.pos - 17, u.pos + 17].filter((x): x is number => x !== undefined && x >= 0);
      let done = false;
      for (const target of targets) {
        try {
          note(applyAction(s, { type: "creatureCast", unit: u.id, target }));
          done = true;
          break;
        } catch {
          // Not a target for it: the next.
        }
      }
      creatureCasts++;
      if (done) continue;
    }
    const before = hpOfA();
    if (u.side === 0) s.sides[0].controller = "ai";
    let ev: BattleEvent[] | null;
    try {
      ev = aiStep(s);
    } finally {
      s.sides[0].controller = "human";
    }
    if (!ev) break;
    note(ev);
    const healed = ev.some((e) => e.e === "drain" || (e.e === "spell" && ([SPELL.CURE, SPELL.RESURRECTION, SPELL.ANIMATE_DEAD, SPELL.SACRIFICE] as number[]).includes(e.spell)));
    if (!healed) {
      const after = hpOfA();
      if (before.some(([n, hp], i) => after[i][0] === n && after[i][1] > hp)) run.regenerated = true;
    }
  }
  return run;
}

/** A fresh battle at the player's first turn, with these spells cast on the player's own first stack. */
function freshWith(r: BattleRecipe, seed: number, creature: number, own: number[]): BattleState {
  const s = makeBattle(r, seed);
  for (let guard = 0; guard < 200 && s.winner === null; guard++) {
    const u = activeUnit(s);
    if (!u) break;
    if (u.side === 0) {
      for (const spell of own) {
        try {
          applyAction(s, { type: "cast", unit: u.id, spell, target: targetFor(s, spell, creature) });
        } catch {
          // Refused: the check will say so.
        }
      }
      return s;
    }
    if (!aiStep(s)) break;
  }
  return s;
}

/**
 * Forty melee blows by a caster stack at the creature's stack (staged beside it), and the same
 * without the creature's abilities: did the casters' spell ever take on it, and would it otherwise.
 */
function stagedBlows(r: BattleRecipe, seed: number, creature: number, casters: Set<number>, spell: number): { took: boolean; tookWithout: boolean } | string {
  const base = makeBattle(r, seed);
  const a = base.units.find((u) => casters.has(u.creature) && alive(u) && base.units.some((d) => d.creature === creature && d.side !== u.side && alive(d)));
  const d = a && base.units.find((u) => u.creature === creature && u.side !== a.side && alive(u));
  if (!a || !d) return "no caster facing them";
  const blows = (s: BattleState) => {
    for (let k = 1; k <= 40; k++) {
      const t = structuredClone(s);
      t.rng = (t.rng + k * 7919) | 0;
      const ta = t.units[a.id];
      const td = t.units[d.id];
      t.active = ta.id;
      // (A Great Shaman's Freezing Shot comes with its shots: it shoots from where it stands.)
      const shot = spell === SPELL.FROZEN;
      const spot = shot ? ta.pos : Array.from({ length: HEX_COUNT }, (_, h) => h).find((h) => canStand(t, ta, h) && areAdjacent(t, ta, h, td));
      if (spot === undefined) return false;
      ta.pos = spot;
      try {
        applyAction(t, shot ? { type: "shoot", unit: ta.id, target: td.id } : { type: "attack", unit: ta.id, target: td.id, from: spot });
      } catch {
        return false;
      }
      if (effectOf(td, spell)) return true;
    }
    return false;
  };
  return { took: blows(base), tookWithout: blows(without(base, creature)) };
}

/**
 * The creature's stack put beside each enemy stack in turn and told to strike (or shoot): the events
 * of the strike that reached a second stack. `front`: only from straight in front (the target's row,
 * on the attacker's side), as a player strikes across the field; the second stack an enemy.
 */
function stagedStrike(r: BattleRecipe, seed: number, creature: number, shoot = false, any = false, front = false): BattleEvent[] | null {
  const s = makeBattle(r, seed);
  const a = s.units.find((u) => u.creature === creature);
  if (!a) return null;
  const enemies = s.units.filter((u) => u.side !== a.side && alive(u));
  for (const d of enemies) {
    const ahead = (h: number) => !front || (hexRow(h) === hexRow(d.pos) && (a.side === 0 ? hexCol(h) < hexCol(d.pos) : hexCol(h) > hexCol(d.pos)));
    const spots = shoot ? [a.pos] : Array.from({ length: HEX_COUNT }, (_, h) => h).filter((h) => areAdjacent(s, a, h, d) && ahead(h));
    for (const p of spots) {
      const t = structuredClone(s);
      const ta = t.units[a.id];
      if (!shoot && !canStand(t, ta, p)) continue;
      ta.pos = p;
      t.active = ta.id;
      try {
        const ev = shoot ? applyAction(t, { type: "shoot", unit: ta.id, target: d.id }) : applyAction(t, { type: "attack", unit: ta.id, target: d.id, from: p });
        if (ev.some((e) => e.e === "attack" && e.unit === ta.id && (any || (e.splash && (!front || t.units[e.target].side !== ta.side))))) return ev;
      } catch {
        // Can't strike from there.
      }
    }
  }
  return null;
}

type Check = (run: Run, ab: Ability, r: BattleRecipe, seed: number, creature: number) => true | string;

const attacks = (run: Run) => run.events.filter((e): e is Extract<BattleEvent, { e: "attack" }> => e.e === "attack");
const spellKey = (key: string | undefined) => spells.find((x) => x.key === key)?.id;
const castable = (key: string | undefined) => {
  const id = spellKey(key);
  return id !== undefined && id < 70 && COMBAT_SPELLS[id] ? id : undefined;
};
/** The player's cast of a spell, if the recipe had one. */
const castOf = (run: Run, spell: number | undefined) => (spell === undefined ? undefined : run.casts.find((c) => c.spell === spell));
/** Per unit of the creature, its events between its turns. */
function perTurn(run: Run): { unit: number; events: BattleEvent[] }[] {
  const out: { unit: number; events: BattleEvent[] }[] = [];
  let cur: { unit: number; events: BattleEvent[] } | null = null;
  for (const e of run.events) {
    if (e.e === "turn") {
      cur = run.A.has(e.unit) ? { unit: e.unit, events: [] } : null;
      if (cur) out.push(cur);
    } else if (cur) cur.events.push(e);
  }
  return out;
}
/** Damage comparison on a fresh battle: the creature's unit against the first enemy (or the reverse), with and without these abilities. */
function compare(r: BattleRecipe, seed: number, creature: number, types: string[], f: (s: BattleState, a: number, d: number) => number, reverse = false): [number, number] | string {
  const s = makeBattle(r, seed);
  const a = s.units.find((u) => u.creature === creature);
  const d = s.units.find((u) => u.side !== a?.side && alive(u));
  if (!a || !d) return "no two stacks to compare";
  const t = without(s, creature, types);
  const [x, y] = reverse ? [d.id, a.id] : [a.id, d.id];
  return [f(s, x, y), f(t, x, y)];
}
const maxDamage = (moved = 0, ranged = false) => (s: BattleState, a: number, d: number) => expectedDamage(s, s.units[a], s.units[d], ranged, moved).max;
/**
 * Immune: the cast at them refused or without effect, where the same cast at them without their
 * abilities goes through and takes (a resisted roll isn't immunity: magic resistance has its own check).
 */
const immune = (run: Run, spell: number | undefined, what: string): true | string => {
  const c = castOf(run, spell);
  if (!c) return `${what}: the hero never cast it`;
  const spared = !!c.refused || (COMBAT_SPELLS[spell!]?.damage ? !c.hit.some((id) => run.A.has(id)) : !c.effected.length);
  if (!spared) return `${what} ${COMBAT_SPELLS[spell!]?.damage ? "hurt" : "took on"} them`;
  if (c.refusedWithout || !c.tookWithout) return `${what} didn't take on them without their abilities either (${c.refused ?? "no effect"}): nothing shown`;
  return true;
};
const twoRetaliations = (run: Run) => {
  let count = new Map<number, number>();
  for (const e of run.events) {
    if (e.e === "round") count = new Map();
    if (e.e === "attack" && e.retaliation && run.A.has(e.unit)) {
      count.set(e.unit, (count.get(e.unit) ?? 0) + 1);
      if (count.get(e.unit)! >= 2) return true;
    }
  }
  return false;
};
const splash = (run: Run, r: BattleRecipe, seed: number, creature: number, fail: string) => attacks(run).some((e) => run.A.has(e.unit) && e.splash) || !!stagedStrike(r, seed, creature) || fail;
const casterKeys = (creature: number) => data.creatures[creature].abilities.filter((a) => a.type === "SPELLCASTER").map((a) => a.subtype ?? "");
/** The recipe's Imps fallen at the battle's start, the Pit Lords' turn: the battle AI raises them as Demons. */
function raisedDemons(r: BattleRecipe, seed: number, creature: number): true | string {
  const s = makeBattle(r, seed);
  const a = s.units.find((u) => u.creature === creature && !u.machine)!;
  const corpse = s.units.find((u) => u.side === a.side && u.id !== a.id && !u.machine && u.creature !== creature);
  if (!corpse) return "no stack to fall";
  corpse.count = 0;
  corpse.firstHp = 0;
  s.active = a.id;
  s.cast = [true, true];
  s.sides[a.side].controller = "ai";
  const ev = aiStep(s) ?? [];
  return ev.some((e) => e.e === "spell" && e.by === a.id && e.summoned?.includes(corpse.id)) || "the AI didn't raise the fallen Imps";
}
const casting = (run: Run) => run.events.some((e) => e.e === "spell" && e.by !== undefined && run.A.has(e.by));
function cmp(r: [number, number] | string, op: ">" | "<", fail: string): true | string {
  if (typeof r === "string") return r;
  return (op === ">" ? r[0] > r[1] : r[0] < r[1]) || `${fail} (${r[0]} vs ${r[1]} without it)`;
}
const livingUnit = (s: BattleState, id: number) => !["UNDEAD", "NON_LIVING"].some((t) => s.creatures[s.units[id].creature].abilities.some((a) => a.type === t));

/** Hits taken from a creature's caster across seeds (a 20% gaze needs many misses to be an immunity). */
const hitsSoFar = new Map<string, { hits: number; took: boolean }>();

const CHECKS: Record<string, Check> = {
  // Every creature: it fights (the mirror match shows it on the field, moving and striking).
  FIGHTS: (run, ab, r, seed, creature) => attacks(run).some((e) => run.A.has(e.unit)) || !!stagedStrike(r, seed, creature, false, true) || "never struck a blow",
  SHOOTER: (run, ab, r, seed, creature) => attacks(run).some((e) => run.A.has(e.unit) && e.ranged) || !!stagedStrike(r, seed, creature, true, true) || "never shot",
  FLYING: (run, ab, r, seed, creature) => {
    if (run.events.some((e) => e.e === "move" && run.A.has(e.unit) && e.fly)) return true;
    const s = makeBattle(r, seed);
    const a = s.units.find((u) => u.creature === creature)!;
    return reachable(s, a).size > reachable(without(s, creature, ["FLYING"]), without(s, creature, ["FLYING"]).units[a.id]).size || "reaches no further than on foot";
  },
  DOUBLE_WIDE: (run) => [...run.A].some((id) => unitHexes(run.s, run.s.units[id]).length === 2) || "stands on one hex",
  ADDITIONAL_ATTACK: (run) => perTurn(run).some((t) => t.events.filter((e) => e.e === "attack" && e.unit === t.unit && !e.retaliation && !e.splash).length >= 2) || "never struck twice",
  BLOCKS_RETALIATION: (run) => {
    for (const t of perTurn(run)) {
      const i = t.events.findIndex((e) => e.e === "attack" && e.unit === t.unit && !e.retaliation && !e.ranged);
      if (i < 0) continue;
      const hit = t.events[i] as Extract<BattleEvent, { e: "attack" }>;
      const rest = t.events.slice(i + 1);
      if (rest.some((e) => e.e === "death" && e.unit === hit.target)) continue;
      if (!rest.some((e) => e.e === "attack" && e.retaliation && e.unit === hit.target)) return true;
    }
    return "the enemy struck back";
  },
  ADDITIONAL_RETALIATION: (run) => twoRetaliations(run) || "never struck back twice in a round",
  UNLIMITED_RETALIATIONS: (run) => twoRetaliations(run) || "never struck back twice in a round",
  // The breath through the front stack into the enemy's stack behind it: in the battle, or struck from straight in front (the recipe's two-deep enemy).
  TWO_HEX_ATTACK_BREATH: (run, ab, r, seed, creature) =>
    attacks(run).some((e) => run.A.has(e.unit) && e.splash && run.s.units[e.target].side !== run.aside) || !!stagedStrike(r, seed, creature, false, false, true) || "the breath never reached an enemy stack behind the one struck",
  THREE_HEADED_ATTACK: (run, ab, r, seed, creature) => splash(run, r, seed, creature, "never hit a second stack"),
  ATTACKS_ALL_ADJACENT: (run, ab, r, seed, creature) => splash(run, r, seed, creature, "never hit a second stack"),
  MULTIHEX_UNIT_ATTACK: (run, ab, r, seed, creature) => splash(run, r, seed, creature, "never hit a second stack"),
  SPELL_LIKE_ATTACK: (run, ab, r, seed, creature) => {
    // HotA's grenades (range 0): an explosion to see, on the target alone (heroes.thelazy.net: no area).
    if (ab.subtype === "hotaGrenade") {
      const shots = attacks(run).filter((e) => run.A.has(e.unit) && e.ranged);
      return !shots.length ? "never shot" : shots.some((e) => e.splash) ? "a grenade hit a second stack" : true;
    }
    const shooter = data.creatures[creature].abilities.some((a) => a.type === "SHOOTER");
    const own = attacks(run).filter((e) => run.A.has(e.unit) && e.splash);
    const hits = own.length ? own : (stagedStrike(r, seed, creature, shooter) ?? []).filter((e): e is Extract<BattleEvent, { e: "attack" }> => e.e === "attack" && e.splash === true);
    if (!hits.length) return "it never reached a second stack";
    if (ab.subtype === "deathCloud") return hits.every((e) => livingUnit(run.s, e.target)) || "the cloud hurt the undead too";
    return true;
  },
  SPELL_AFTER_ATTACK: (run, ab, r, seed, creature) => {
    const id = ab.subtype === "freezingShot" ? SPELL.FROZEN : spellKey(ab.subtype);
    if (id !== undefined && run.afflicted.has(id)) return true;
    const note = NOTES[ab.subtype ?? ""];
    if (note && run.s.log.some((l) => logLines(l).includes(note))) return true;
    // A chance per blow: forty staged blows (or shots) at the enemy, the effect or the log's note looked for after each.
    const s = makeBattle(r, seed);
    const a = s.units.find((u) => u.creature === creature);
    // (A mind spell wants a living stack with a mind; a gaze a living one.)
    const mindless = (u: Unit) => !livingUnit(s, u.id) || s.creatures[u.creature].abilities.some((x) => x.type === "MIND_IMMUNITY");
    const enemies = s.units.filter((u) => u.side !== a?.side && alive(u));
    const d = enemies.find((u) => !mindless(u)) ?? enemies[0];
    if (!a || !d) return `${ab.subtype} never took on anyone`;
    const shoots = data.creatures[creature].abilities.some((x) => x.type === "SHOOTER");
    for (let k = 1; k <= 40; k++) {
      const t = structuredClone(s);
      t.rng = (t.rng + k * 7919) | 0;
      const ta = t.units[a.id];
      const td = t.units[d.id];
      t.active = ta.id;
      // A dispel shows only on a stack with something helpful on it (a Bless here), and is proven by its going.
      const dispel = ab.subtype === "dispelHelpful";
      if (dispel) (td.effects ??= []).push({ spell: SPELL.BLESS, rounds: 3, mastery: 1, value: 0 });
      try {
        if (shoots) applyAction(t, { type: "shoot", unit: ta.id, target: td.id });
        else {
          const spot = Array.from({ length: HEX_COUNT }, (_, h) => h).find((h) => canStand(t, ta, h) && areAdjacent(t, ta, h, td));
          if (spot === undefined) break;
          ta.pos = spot;
          applyAction(t, { type: "attack", unit: ta.id, target: td.id, from: spot });
        }
        if (dispel && alive(td) && !effectOf(td, SPELL.BLESS)) return true;
        if ((id !== undefined && effectOf(td, id)) || (note && t.log.some((l) => logLines(l).includes(note)))) return true;
      } catch {
        break;
      }
    }
    return `${ab.subtype} never took on anyone (forty blows staged)`;
  },
  LIFE_DRAIN: (run) => run.events.some((e) => e.e === "drain" && run.A.has(e.unit) && e.amount > 0) || "never drained",
  DEATH_STARE: (run) => run.events.some((e) => e.e === "stare" && run.A.has(e.unit) && e.killed > 0) || "the stare killed nobody",
  REBIRTH: (run) => run.events.some((e) => e.e === "rebirth" && run.A.has(e.unit)) || "never rose from the ashes",
  ACID_BREATH: (run) => attacks(run).some((e) => run.A.has(e.unit) && e.acid) || "no acid burned anyone",
  // Enchanters: each of their spells comes up (one every third round, at random: staged on the first round, sixty rolls).
  ENCHANTER: (run, ab, r, seed, creature) => {
    const spell = castable(ab.subtype);
    if (spell === undefined) return `unknown spell ${ab.subtype}`;
    const s = makeBattle(r, seed);
    for (let k = 1; k <= 60; k++) {
      const t = structuredClone(s);
      t.rng = (t.rng + k * 7919) | 0;
      t.round = 1;
      const u = t.units.find((x) => x.creature === creature && alive(x))!;
      // Cure comes up only with a friend hurt, Air Shield only against shooters: a hurt friend and enemy Archers staged.
      const friend = t.units.find((x) => x.side === u.side && alive(x) && !x.machine);
      if (ab.subtype === "cure" && friend) friend.firstHp = 1;
      const foe = t.units.find((x) => x.side !== u.side && alive(x) && !x.machine);
      const spot = Array.from({ length: HEX_COUNT }, (_, h) => h).find((h) => hexCol(h) > 0 && hexCol(h) < 16 && !t.units.some((x) => alive(x) && unitHexes(t, x).includes(h)) && !t.blocked.includes(h));
      if (ab.subtype === "airShield" && foe && spot !== undefined && !t.units.some((x) => x.side !== u.side && alive(x) && canShoot(t, x))) {
        t.creatures[2] ??= data.creatures[2];
        t.units.push({ ...structuredClone(foe), id: t.units.length, creature: 2, count: 10, initialCount: 10, firstHp: 10, shots: 12, pos: spot, effects: [] });
      }
      const ev: BattleEvent[] = [];
      enchant(t, u, ev);
      if (ev.some((e) => e.e === "spell" && e.spell === spell)) return true;
    }
    return `never cast ${ab.subtype} in sixty rounds`;
  },
  // Ferocity (Ayssids): a blow that kills earns another.
  FEROCITY: (run) =>
    perTurn(run).some((t) => {
      const hits = t.events.filter((e) => e.e === "attack" && e.unit === t.unit && !e.retaliation && !e.splash);
      return hits.length >= 2 && hits[0].e === "attack" && hits[0].killed > 0;
    }) || "never struck again after a kill",
  // Free shooting (Steel Elves): they shoot with an enemy beside them.
  FREE_SHOOTING: (run, ab, r, seed, creature) => {
    const s = makeBattle(r, seed);
    const a = s.units.find((u) => u.creature === creature)!;
    const d = s.units.find((u) => u.side !== a.side && alive(u) && !u.machine)!;
    const beside = neighbours(a.pos).find((h) => canStand(s, d, h));
    if (beside === undefined) return "nowhere beside them to put an enemy";
    d.pos = beside;
    const t = without(s, creature, ["FREE_SHOOTING"]);
    return canShoot(s, a) ? !canShoot(t, t.units[a.id]) || "shoot beside an enemy without the ability too" : "can't shoot beside an enemy";
  },
  // Rune Levels (Yeti Runemasters): gained after attacking, being hit and defending.
  ON_COMBAT_EVENT: (run) => run.s.units.some((u) => run.A.has(u.id) && (u.runes ?? 0) > 0) || "no Rune Levels gained",
  FIRE_SHIELD: (run) => run.events.some((e) => e.e === "attack" && e.fireShield) || "nobody burned on the shield",
  DOUBLE_DAMAGE_CHANCE: (run) => attacks(run).some((e) => run.A.has(e.unit) && e.deathBlow) || "no Death Blow",
  RETURN_AFTER_STRIKE: (run) => perTurn(run).some((t) => /move(,attack)+,move/.test(t.events.filter((e) => e.e === "move" || e.e === "attack").map((e) => e.e).join(","))) || "never flew back after striking",
  MORALE: (run, ab) => ((ab.val ?? 0) >= 0 ? run.events.some((e) => e.e === "morale" && e.good && run.A.has(e.unit)) || "no high morale seen" : run.events.some((e) => e.e === "morale" && !e.good && run.s.units[e.unit].side !== run.aside) || "the enemy never lost morale"),
  LUCK: (run, ab) => ((ab.val ?? 0) >= 0 ? attacks(run).some((e) => run.A.has(e.unit) && e.luck === "good") || "no lucky strike seen" : attacks(run).some((e) => e.luck === "bad" && run.s.units[e.unit].side !== run.aside) || "the enemy never struck unluckily"),
  FEARFUL: (run) => run.s.log.some((l) => logLines(l).some((t) => t === 710 || t === 711)) || "nobody froze in fear",
  HP_REGENERATION: (run) => run.regenerated || run.events.some((e) => e.e === "trigger" && e.what === "regen" && run.A.has(e.unit)) || "no wound closed between turns",
  MANA_DRAIN: (run) => ((run.s.sides[run.aside ? 0 : 1].hero?.mana ?? 100) < 100 ? true : "the enemy hero's spell points didn't drain"),
  HATE: (run, ab, r, seed, creature) => {
    const h = data.creatures.find((x) => x.key === ab.subtype);
    if (!h) return `no such creature: ${ab.subtype}`;
    const s = makeBattle({ ...r, left: [{ creature, count: 10 }], right: [{ creature: h.id, count: 10 }], siege: undefined }, seed);
    const a = s.units.find((u) => u.creature === creature)!;
    const d = s.units.find((u) => u.creature === h.id && u.side === 1)!;
    const w = without(s, creature, ["HATE"]);
    return expectedDamage(s, a, d, false).max > expectedDamage(w, a, d, false).max || `no extra damage against ${h.plural}`;
  },
  ENEMY_DEFENCE_REDUCTION: (run, ab, r, seed, creature) => cmp(compare(r, seed, creature, ["ENEMY_DEFENCE_REDUCTION"], maxDamage(0, data.creatures[creature].abilities.some((x) => x.type === "SHOOTER"))), ">", "no extra damage through the enemy's defence"),
  // Jotunns: the enemy's fliers slower (an enemy stack made a flier for it).
  STACKS_SPEED: (run, ab, r, seed, creature) =>
    cmp(
      compare(r, seed, creature, ["STACKS_SPEED"], (s, a, d) => {
        const c = s.creatures[s.units[d].creature];
        s.creatures[s.units[d].creature] = { ...c, abilities: [...c.abilities.filter((x) => x.type !== "FLYING"), { type: "FLYING" }] };
        return speedOf(s, s.units[d]);
      }),
      "<",
      "the enemy's fliers no slower",
    ),
  // War Mammoths: more Defense defending than the usual fifth.
  PRIMARY_SKILL: (run, ab, r, seed, creature) =>
    cmp(
      compare(r, seed, creature, ["PRIMARY_SKILL"], (s, a) => {
        s.units[a].defending = true;
        return defenseOf(s, s.units[a]);
      }),
      ">",
      "no more Defense defending",
    ),
  ENEMY_ATTACK_REDUCTION: (run, ab, r, seed, creature) => cmp(compare(r, seed, creature, ["ENEMY_ATTACK_REDUCTION"], maxDamage(), true), "<", "the enemy hits them as hard as anyone"),
  JOUSTING: (run, ab, r, seed, creature) => {
    const s = makeBattle(r, seed);
    const a = s.units.find((u) => u.creature === creature)!;
    const d = s.units.find((u) => u.side !== a.side && alive(u))!;
    return expectedDamage(s, a, d, false, 5).max > expectedDamage(s, a, d, false, 0).max || "no more damage after a charge";
  },
  CHARGE_IMMUNITY: (run, ab, r, seed, creature) => {
    const s = makeBattle(r, seed);
    const a = s.units.find((u) => u.creature === creature)!;
    // (The charger: the stack opposite that isn't the creature itself, which stands on both sides.)
    const d = s.units.find((u) => u.side !== a.side && alive(u) && u.creature !== creature)!;
    const w = without(s, creature, ["CHARGE_IMMUNITY"]);
    const same = expectedDamage(s, d, a, false, 5).max === expectedDamage(s, d, a, false, 0).max;
    const charge = expectedDamage(w, d, a, false, 5).max > expectedDamage(w, d, a, false, 0).max;
    return (same && charge) || (same ? "the charger wouldn't gain on anyone" : "the charge still counts against them");
  },
  NO_MELEE_PENALTY: (run, ab, r, seed, creature) => cmp(compare(r, seed, creature, ["NO_MELEE_PENALTY"], maxDamage(0, false)), ">", "melee damage is cut like any shooter's"),
  NO_DISTANCE_PENALTY: (run, ab, r, seed, creature) => cmp(compare(r, seed, creature, ["NO_DISTANCE_PENALTY"], maxDamage(0, true)), ">", "distance cuts their shots"),
  NO_WALL_PENALTY: (run, ab, r, seed, creature) => cmp(compare(r, seed, creature, ["NO_WALL_PENALTY"], maxDamage(0, true)), ">", "the walls cut their shots"),
  KING: (run, ab, r, seed, creature) => {
    // (Titans bear the Slayer: nothing frightens or charms them out of their turn.)
    // (Enough of the creature to survive the Titans' retaliation, few enough not to kill them first.)
    const count = Math.max(5, Math.min(60, Math.round((60 * 5000) / Math.max(1, data.creatures[creature].aiValue))));
    const s = freshWith({ left: [{ creature: 41, count: 20 }], right: [{ creature, count }], spells: [SPELL.SLAYER], skills: [["fireMagic", 3]], what: "" }, seed, creature, [SPELL.SLAYER]);
    const f = s.units.find((u) => u.side === 0 && alive(u));
    const a = s.units.find((u) => u.creature === creature);
    if (!f || !a) return "no stack to cast Slayer on";
    if (!effectOf(f, SPELL.SLAYER)) return "Slayer wasn't cast";
    const w = without(s, creature, ["KING"]);
    return expectedDamage(s, f, a, false).max > expectedDamage(w, f, a, false).max || "Slayer gives nothing against them";
  },
  MIND_IMMUNITY: (run) => immune(run, SPELL.BLIND, "Blind"),
  NON_LIVING: (run) => immune(run, SPELL.BLIND, "Blind"),
  UNDEAD: (run) => {
    const hurt = castOf(run, SPELL.DESTROY_UNDEAD);
    const spared = castOf(run, SPELL.DEATH_RIPPLE);
    if (!hurt || !spared) return "the hero never cast Destroy Undead and Death Ripple";
    if (!hurt.hit.some((id) => run.A.has(id))) return "Destroy Undead didn't hurt them";
    if (spared.hit.some((id) => run.A.has(id))) return "Death Ripple hurt them";
    return true;
  },
  LEVEL_SPELL_IMMUNITY: (run) => immune(run, SPELL.MAGIC_ARROW, "Magic Arrow"),
  SPELL_SCHOOL_IMMUNITY: (run) => immune(run, SPELL.FIREBALL, "Fireball"),
  SPELL_IMMUNITY: (run, ab, r, seed, creature) => {
    const id = castable(ab.subtype);
    const casters = new Set(data.creatures.filter((x) => x.abilities.some((y) => y.type === "SPELL_AFTER_ATTACK" && y.subtype === ab.subtype)).map((x) => x.id));
    const inBattle = [...r.left, ...r.right].some((x) => casters.has(x.creature));
    if (id !== undefined) {
      const hero = immune(run, id, ab.subtype ?? "the spell");
      // (A spell creatures cast too, its casters in the battle: their blows must never take either.)
      if (hero !== true || !inBattle) return hero;
    }
    // A creature's spell: its casters' blows (melee: a gaze or a blind takes only then) landed on them and never took.
    const cid = spellKey(ab.subtype) ?? (ab.subtype === "freezingShot" ? SPELL.FROZEN : undefined);
    if (cid !== undefined) {
      const staged = stagedBlows(r, seed, creature, casters, cid);
      if (typeof staged === "string") return staged;
      if (staged.took) return `${ab.subtype} took on them (staged blows)`;
      if (!staged.tookWithout) return `${ab.subtype} never took on them even without their abilities: nothing shown`;
      return true;
    }
    const key = `${creature}:${ab.subtype}`;
    const acc = hitsSoFar.get(key) ?? { hits: 0, took: false };
    for (const [by, k] of run.hitsOnABy) if (casters.has(by)) acc.hits += k;
    acc.took ||= cid !== undefined && run.selfEffects.has(cid);
    hitsSoFar.set(key, acc);
    if (acc.took) return `${ab.subtype} took on them`;
    return acc.hits >= 12 || `hit only ${acc.hits} times by its casters so far`;
  },
  // (A negative reduction, the Argali's, is an aura: more spell damage to the enemies beside them. Staged: an enemy put beside them.)
  SPELL_DAMAGE_REDUCTION: (run, ab, r, seed, creature) => {
    if ((ab.val ?? 0) < 0) {
      const s = makeBattle(r, seed);
      const a = s.units.find((u) => u.creature === creature)!;
      const d = s.units.find((u) => u.side !== a.side && alive(u) && !u.machine && u.creature !== creature);
      const arrow = spells.find((sp) => sp.id === SPELL.MAGIC_ARROW);
      const beside = d && neighbours(a.pos).find((h) => canStand(s, d, h));
      if (!d || !arrow || beside === undefined) return "no enemy to put beside them";
      d.pos = beside;
      const t = without(s, creature, ["SPELL_DAMAGE_REDUCTION"]);
      const [hit, plain, self] = [spellDamage(s, a.side, arrow, d), spellDamage(t, a.side, arrow, t.units[d.id]), spellDamage(s, d.side, arrow, a)];
      if (self !== spellDamage(t, d.side, arrow, t.units[a.id])) return "they take more spell damage themselves";
      return hit > plain || `Magic Arrow did ${hit} beside them, ${plain} without the aura`;
    }
    const c = castOf(run, SPELL.MAGIC_ARROW);
    if (!c || c.refused) return `the hero's Magic Arrow ${c?.refused ? `was refused: ${c.refused}` : "was never cast"}`;
    return ((ab.val ?? 0) < 0 ? c.damage > c.damageWithout : c.damage < c.damageWithout) || `Magic Arrow did ${c.damage}, ${c.damageWithout} without the ability`;
  },
  MORE_DAMAGE_FROM_SPELL: (run, ab, r, seed, creature) => {
    if (ab.subtype === "fireShield" || ab.subtype === "fireWallTrigger") {
      // Staged: the stack strikes a shielded enemy (the shield burns back) or steps into a fire wall; the same without the ability, to compare.
      const burnOf = (s: BattleState): number | string => {
        const a = s.units.find((u) => u.creature === creature)!;
        s.active = a.id;
        if (ab.subtype === "fireWallTrigger") {
          const to = neighbours(a.pos).find((h) => canStand(s, a, h));
          if (to === undefined) return "nowhere to step";
          (s.hazards ??= []).push({ kind: "fireWall", hexes: [to], side: a.side === 0 ? 1 : 0, rounds: 2, damage: 30 });
          const ev = applyAction(s, { type: "move", unit: a.id, to });
          return ev.filter((e) => e.e === "spell").flatMap((e) => (e.e === "spell" ? e.damage : [])).filter((d) => d.unit === a.id).reduce((x, d) => x + d.damage, 0);
        }
        const d = s.units.find((u) => u.side !== a.side && alive(u) && s.creatures[u.creature].abilities.some((x) => x.type === "FIRE_SHIELD"));
        if (!d) return "no Fire Shield opposite";
        const p = Array.from({ length: HEX_COUNT }, (_, h) => h).find((h) => areAdjacent(s, a, h, d) && canStand(s, a, h));
        if (p === undefined) return "can't reach the shield";
        a.pos = p;
        const ev = applyAction(s, { type: "attack", unit: a.id, target: d.id, from: p });
        return ev.filter((e) => e.e === "attack" && e.fireShield && e.target === a.id).reduce((x, e) => x + (e.e === "attack" ? e.damage : 0), 0);
      };
      const w = burnOf(makeBattle(r, seed));
      const wo = burnOf(without(makeBattle(r, seed), creature, ["MORE_DAMAGE_FROM_SPELL"]));
      if (typeof w === "string") return w;
      if (typeof wo === "string") return wo;
      return w > wo || `burned for ${w}, no more than without the ability (${wo})`;
    }
    const c = castOf(run, castable(ab.subtype));
    if (!c || c.refused) return `the hero's ${ab.subtype} ${c?.refused ? `was refused: ${c.refused}` : "was never cast"}`;
    return c.damage > c.damageWithout || `${ab.subtype} did ${c.damage}, no more than without the ability`;
  },
  // Seen in the battle, or staged: the enemy hero's Slow at the stack, forty rolls, with and without it.
  MAGIC_RESISTANCE: (run, ab, r, seed, creature) => {
    if (run.casts.some((c) => c.resisted.some((id) => run.A.has(id)))) return true;
    const s = makeBattle({ ...r, rightSpells: [...(r.rightSpells ?? []), SPELL.SLOW] }, seed);
    const foe = s.units.find((u) => u.side === 1 && alive(u));
    const me = s.units.find((u) => u.side === 0 && u.creature === creature && alive(u));
    if (!foe || !me) return "no stack to cast at";
    const rolls = (base: BattleState) => {
      let n = 0;
      for (let k = 1; k <= 40; k++) {
        const t = structuredClone(base);
        t.active = foe.id;
        t.rng = (t.rng + k * 7919) | 0;
        try {
          n += applyAction(t, { type: "cast", unit: foe.id, spell: SPELL.SLOW, target: me.pos }).some((e) => e.e === "spell" && e.resisted.includes(me.id)) ? 1 : 0;
        } catch (e) {
          if (process.env.DEBUG) console.log(e);
          return -1;
        }
      }
      return n;
    };
    const w = rolls(s);
    if (w < 0) return "the enemy's Slow was refused";
    const wo = rolls(without(s, creature, ["MAGIC_RESISTANCE"]));
    return (w > 0 && wo === 0) || `Slow was resisted ${w} times in 40, ${wo} without the ability`;
  },
  // Staged at the start, while the Pikemen still stand beside them: the enemy hero's Slow at the Pikemen, forty rolls.
  SPELL_RESISTANCE_AURA: (run, ab, r, seed, creature) => {
    if (run.events.some((e) => e.e === "spell" && e.resisted.some((id) => run.s.units[id].side === run.aside && !run.A.has(id)))) return true;
    const s = makeBattle(r, seed);
    const foe = s.units.find((u) => u.side === 1 && alive(u));
    const beside = s.units.find((u) => u.side === 0 && u.creature !== creature && alive(u));
    if (!foe || !beside) return "no stack beside them";
    const rolls = (base: BattleState) => {
      let n = 0;
      for (let k = 1; k <= 40; k++) {
        const t = structuredClone(base);
        t.active = foe.id;
        t.rng = (t.rng + k * 7919) | 0;
        try {
          n += applyAction(t, { type: "cast", unit: foe.id, spell: SPELL.SLOW, target: beside.pos }).some((e) => e.e === "spell" && e.resisted.includes(beside.id)) ? 1 : 0;
        } catch {
          return -1;
        }
      }
      return n;
    };
    const w = rolls(s);
    if (w < 0) return "the enemy's Slow was refused";
    const wo = rolls(without(s, creature, ["SPELL_RESISTANCE_AURA"]));
    return (w > 0 && wo === 0) || `Slow was resisted ${w} times in 40 beside them, ${wo} without them`;
  },
  CHANGES_SPELL_COST_FOR_ALLY: (run) => {
    const c = castOf(run, SPELL.MAGIC_ARROW);
    return c ? c.cost < c.costWithout || "the spell cost as much as without them" : "the hero never cast";
  },
  CHANGES_SPELL_COST_FOR_ENEMY: (run) => {
    const c = castOf(run, SPELL.MAGIC_ARROW);
    return c ? c.cost > c.costWithout || "the spell cost no more than without them" : "the hero never cast";
  },
  CATAPULT: (run) => run.events.some((e) => e.e === "catapult" && run.A.has(e.unit)) || "never hurled a stone",
  // Forty Magic Arrows at them: some bounce back.
  MAGIC_MIRROR: (run, ab, r, seed, creature) => {
    const s = makeBattle({ left: [{ creature: 6, count: 30 }], right: [{ creature, count: 5 }], spells: [SPELL.MAGIC_ARROW], what: "" }, seed);
    const mine = s.units.find((u) => u.side === 0 && alive(u));
    const target = s.units.find((u) => u.creature === creature);
    if (!mine || !target) return "no stacks";
    let bounced = 0;
    for (let k = 1; k <= 40; k++) {
      const t = structuredClone(s);
      t.rng = (t.rng + k * 7919) | 0;
      t.active = mine.id;
      try {
        if (applyAction(t, { type: "cast", unit: mine.id, spell: SPELL.MAGIC_ARROW, target: target.pos }).some((e) => e.e === "spell" && e.reflected)) bounced++;
      } catch {
        // Refused: not this roll.
      }
    }
    return bounced > 0 || "no spell bounced back in forty";
  },
  // The more of them have fallen, the harder the rest hit.
  REVENGE: (run, ab, r, seed, creature) =>
    cmp(
      compare(r, seed, creature, ["REVENGE"], (s, a, d) => {
        const u = s.units[a];
        u.count = Math.max(1, Math.floor(u.initialCount / 2));
        return expectedDamage(s, u, s.units[d], false).max;
      }),
      ">",
      "no more damage for a stack half fallen",
    ),
  CASTS: (run, ab, r, seed, creature) => casting(run) || (casterKeys(creature).includes("summonDemons") && raisedDemons(r, seed, creature) === true) || "never cast",
  // Detonation: the fallen stack's blast (a spell event by it with damage) hits a neighbour.
  // Meditation: once it meditates, an enemy's blow at it is refused.
  SPELLCASTER: (run, ab, r, seed, creature) => {
    if (ab.subtype?.startsWith("detonates")) return run.events.some((e) => e.e === "spell" && e.by !== undefined && run.A.has(e.by) && e.damage.length > 0) || "never detonated beside anyone";
    // Pit Lords: the fallen Imps beside them get up as Demons (staged when the fight killed the Lords first).
    if (ab.subtype === "summonDemons") return casting(run) || raisedDemons(r, seed, creature);
    // Devour: a fallen stack (a Pikeman of ours, killed here) eaten, then two strikes in one attack.
    if (ab.subtype === "summonLarva") {
      const s = makeBattle(r, seed);
      // (The worm beside the Pikemen: the creature may stand on both sides.)
      const a = s.units.find((u) => u.creature === creature && s.units.some((x) => x.side === u.side && x.creature === 0)) ?? s.units.find((u) => u.creature === creature)!;
      const corpse = s.units.find((u) => u.side === a.side && u.creature === 0);
      const d = s.units.find((u) => u.side !== a.side && alive(u) && u.creature !== creature) ?? s.units.find((u) => u.side !== a.side && alive(u))!;
      if (!corpse) return "no stack to fall";
      corpse.count = 0;
      corpse.firstHp = 0;
      // The corpse within reach: put it beside the worm.
      const near = Array.from({ length: HEX_COUNT }, (_, h) => h).find((h) => h !== a.pos && !s.units.some((x) => alive(x) && unitHexes(s, x).includes(h)) && areAdjacent(s, a, a.pos, { ...corpse, pos: h }));
      if (near === undefined) return "nowhere to lay the corpse";
      corpse.pos = near;
      s.active = a.id;
      try {
        applyAction(s, { type: "creatureCast", unit: a.id, target: near });
      } catch (e) {
        return `couldn't devour: ${e instanceof Error ? e.message : e}`;
      }
      if (!corpse.sacrificed || !a.bonusStrikes) return "the corpse wasn't eaten, or no strike owed";
      s.active = a.id;
      const spot = Array.from({ length: HEX_COUNT }, (_, h) => h).find((h) => canStand(s, a, h) && areAdjacent(s, a, h, d));
      if (spot === undefined) return "nowhere to strike from";
      a.pos = spot;
      const ev = applyAction(s, { type: "attack", unit: a.id, target: d.id, from: spot });
      return ev.filter((e) => e.e === "attack" && e.unit === a.id && !e.retaliation).length >= 2 || "no second strike after the meal";
    }
    // Teleport: an ally sent across the field.
    if (ab.subtype === "teleport") {
      const s = makeBattle(r, seed);
      // (The Jotunns on the side that has the Pikemen beside them.)
      const mine = s.units.filter((u) => u.creature === creature);
      const a = mine.find((u) => s.units.some((x) => x.side === u.side && x.id !== u.id && alive(x) && !x.machine && x.creature !== creature)) ?? mine[0];
      const ally = s.units.find((u) => u.side === a.side && u.id !== a.id && alive(u) && !u.machine && u.creature !== creature);
      if (!ally) return "no ally to send";
      const dest = Array.from({ length: HEX_COUNT }, (_, h) => h).find((h) => h % 17 === 10 && canStand(s, ally, h));
      if (dest === undefined) return "nowhere to send them";
      s.active = a.id;
      const from = ally.pos;
      try {
        applyAction(s, { type: "creatureCast", unit: a.id, target: ally.pos, dest });
      } catch (e) {
        return `couldn't teleport: ${e instanceof Error ? e.message : e}`;
      }
      return ally.pos !== from || "the ally stayed put";
    }
    if (ab.subtype?.startsWith("meditation")) {
      const s = makeBattle(r, seed);
      const a = s.units.find((u) => u.creature === creature)!;
      const d = s.units.find((u) => u.side !== a.side && alive(u))!;
      s.active = a.id;
      try {
        applyAction(s, { type: "creatureCast", unit: a.id, target: a.pos });
      } catch (e) {
        return `couldn't meditate: ${e instanceof Error ? e.message : e}`;
      }
      s.active = d.id;
      const spot = Array.from({ length: HEX_COUNT }, (_, h) => h).find((h) => canStand(s, d, h) && areAdjacent(s, d, h, a));
      if (spot === undefined) return "nowhere to strike from";
      d.pos = spot;
      try {
        applyAction(s, { type: "attack", unit: d.id, target: a.id, from: spot });
      } catch {
        return true;
      }
      return "the enemy could strike the meditating stack";
    }
    return casting(run) || "never cast";
  },
  RANDOM_SPELLCASTER: (run) => casting(run) || "never cast",
  ADJACENT_SPELLCASTER: (run) => casting(run) || "never cast",
  RANGED_RETALIATION: (run) => attacks(run).some((e) => run.A.has(e.unit) && e.retaliation && e.ranged) || "never shot back",
  FIRST_STRIKE: (run, ab) => {
    const ev = run.events;
    for (let i = 1; i < ev.length; i++) {
      const e = ev[i];
      // (A blow from the creature's own kind counts too: it stands on both sides.)
      if (e.e !== "attack" || e.retaliation || !run.A.has(e.target) || run.s.units[e.unit].side === run.s.units[e.target].side) continue;
      // (Gunslingers strike first at shots only: a melee blow is answered after it.)
      if (ab.subtype === "damageTypeRanged" && !e.ranged) continue;
      const p = ev[i - 1];
      return (p.e === "attack" && p.retaliation && run.A.has(p.unit) && p.target === e.unit) || "struck back only after the blow";
    }
    return "never attacked";
  },
};

/** The checker for an ability, if there is one it can use on this creature. */
function checkerFor(c: CreatureStats, a: Ability): Check | undefined {
  if (noCheck(a)) return undefined;
  // (CASTS counts only for real spells: detonation, devouring, meditation and the Jotunns' teleport have checks of their own.)
  if (a.type === "CASTS" && !c.abilities.some((x) => SPELLCASTERS.includes(x.type) && !/^(detonates|summonLarva|meditation|teleport)/.test(x.subtype ?? ""))) {
    // The count of a special cast: proven with the cast itself.
    const special = c.abilities.find((x) => x.type === "SPELLCASTER");
    return special ? (run, ab, r, seed, creature) => CHECKS.SPELLCASTER(run, special, r, seed, creature) : undefined;
  }
  if (a.type === "MORE_DAMAGE_FROM_SPELL" && !["fireShield", "fireWallTrigger"].includes(a.subtype ?? "") && !COMBAT_SPELLS[castable(a.subtype) ?? -1]?.damage) return undefined;
  if (a.type === "SPELL_DAMAGE_REDUCTION" && !(a.val ?? 0)) return undefined;
  if (a.type === "SPELL_SCHOOL_IMMUNITY" && a.subtype !== "fire") return undefined;
  if (a.type === "SPELL_IMMUNITY" && castable(a.subtype) === undefined && !data.creatures.some((x) => x.abilities.some((y) => y.type === "SPELL_AFTER_ATTACK" && y.subtype === a.subtype))) return undefined;
  if (a.type === "FLYING" && a.subtype === "movementTeleporting") return CHECKS.FLYING;
  return CHECKS[a.type];
}

interface Proof {
  proof: string | null;
  checked: string[];
  unchecked: string[];
  what: string;
}
const label = (a: Ability) => `${a.type}${a.subtype ? `:${a.subtype}` : ""}`;

function prove(c: CreatureStats): Proof | null {
  if (c.abilities.some((a) => a.type === "SIEGE_WEAPON" || a.type === "CPU_CONTROLLED")) return null;
  const r = creatureRecipe(c, data.creatures, spells);
  // (A CASTS count without any spell, the Phoenix's: its Rebirth, checked as such.)
  const abilities = [{ type: "FIGHTS" } as Ability, ...c.abilities.filter((a) => !noCheck(a) && !(a.type === "CASTS" && !c.abilities.some((x) => SPELLCASTERS.includes(x.type))))];
  const checkable = abilities.filter((a) => a.type === "FIGHTS" || checkerFor(c, a));
  const unchecked = abilities.filter((a) => a.type !== "FIGHTS" && !checkerFor(c, a)).map(label);
  const proven = new Map<string, true | string>();
  for (let seed = 1; seed <= 8 && [...proven.values()].filter((v) => v === true).length < checkable.length; seed++) {
    let run: Run;
    try {
      run = play(r, seed, c.id);
    } catch (e) {
      for (const a of checkable) if (proven.get(label(a)) !== true) proven.set(label(a), `error: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    for (const a of checkable) {
      if (proven.get(label(a)) === true) continue;
      try {
        proven.set(label(a), (a.type === "FIGHTS" ? CHECKS.FIGHTS : checkerFor(c, a)!)(run, a, r, seed, c.id));
      } catch (e) {
        proven.set(label(a), `error: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  const failed = [...proven].filter(([, v]) => v !== true).map(([k, v]) => `${k}: ${v}`);
  return { proof: failed.length ? failed.join("; ") : null, checked: checkable.map(label), unchecked, what: r.what };
}

const proofs: Record<string, Proof> = {};
let n = 0;
let ok = 0;
for (const c of data.creatures) {
  if (!c.name || /^(creature|unused)\d/.test(c.key) || /^not used/i.test(c.name)) continue;
  if (only && String(c.id) !== only && c.name.toLowerCase() !== only.toLowerCase()) continue;
  const p = prove(c);
  if (!p) continue;
  proofs[`creature-${c.id}`] = p;
  n++;
  if (p.proof === null) ok++;
  if (p.proof !== null && (process.env.DEBUG || only)) console.log(`${c.name}: ${p.proof}${p.unchecked.length ? ` (unchecked: ${p.unchecked.join(", ")})` : ""}`);
  else if (only) console.log(`${c.name}: proven ${p.checked.join(", ")}${p.unchecked.length ? ` (unchecked: ${p.unchecked.join(", ")})` : ""}`);
}
console.log(`${n} creatures: ${ok} proven, ${n - ok} not`);
// What the battle AI chose and the rules refused (it defended instead): the two disagree there.
const refused = [...battleAiRefusals].sort((a, b) => b[1] - a[1]).slice(0, 12);
if (refused.length) console.log(`battle AI choices the rules refused:\n${refused.map(([k, v]) => `  ${v} x ${k}`).join("\n")}`);
if (!only) writeFileSync(join(root, "packages/client/src/battleProofs.json"), JSON.stringify(proofs) + "\n");
// A gate (tools/gate/rules.sh): every creature proven, and some there (none without the game files).
if (!n || ok < n) process.exitCode = 1;
