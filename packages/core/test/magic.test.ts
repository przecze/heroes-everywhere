// Hero spellcasting on synthetic creatures and spells (HotA values from SPTRAITS.TXT).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BattleState,
  type CreatureStats,
  SPELL,
  type SpellInfo,
  affects,
  applyAction,
  canShoot,
  castable,
  createBattle,
  expectedDamage,
  heal,
  speedOf,
  spellTargets,
  startBattle,
  logIsCast,
} from "../src/index.ts";

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "castle", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 100, speed: 5, attack: 5, defense: 5, minDamage: 2, maxDamage: 8,
    shots: 0, abilities: [], def: "", missile: "", sound: "", ...over,
  };
}

function spell(id: number, over: Partial<SpellInfo>): SpellInfo {
  return { id, key: `s${id}`, name: `S${id}`, level: 1, schools: ["air"], cost: [5, 4, 4, 4], power: 0, effect: [0, 0, 0, 0], chance: [], text: [], ...over };
}

const SPELLS: SpellInfo[] = [];
SPELLS[SPELL.MAGIC_ARROW] = spell(SPELL.MAGIC_ARROW, { key: "magicArrow", schools: ["earth", "water", "fire", "air"], power: 10, effect: [10, 10, 20, 30] });
SPELLS[SPELL.BLESS] = spell(SPELL.BLESS, { key: "bless", schools: ["water"], effect: [0, 0, 1, 1] });
SPELLS[SPELL.HASTE] = spell(SPELL.HASTE, { key: "haste", schools: ["air"], effect: [3, 3, 5, 5] });
SPELLS[SPELL.CHAIN_LIGHTNING] = spell(SPELL.CHAIN_LIGHTNING, { key: "chainLightning", level: 4, schools: ["air"], cost: [24, 20, 20, 20], power: 40, effect: [25, 25, 50, 100] });
SPELLS[SPELL.SACRIFICE] = spell(SPELL.SACRIFICE, { key: "sacrifice", level: 5, schools: ["fire"], cost: [25, 20, 20, 20], effect: [3, 3, 3, 3] });
SPELLS[SPELL.AIR_ELEMENTAL] = spell(SPELL.AIR_ELEMENTAL, { key: "airElemental", level: 5, cost: [25, 20, 20, 20], effect: [2, 2, 3, 4] });
SPELLS[SPELL.FIRE_ELEMENTAL] = spell(SPELL.FIRE_ELEMENTAL, { key: "fireElemental", level: 5, schools: ["fire"], cost: [25, 20, 20, 20], effect: [2, 2, 2, 3] });
SPELLS[SPELL.SLOW] = spell(SPELL.SLOW, { key: "slow", schools: ["earth"], effect: [75, 75, 50, 50] });
SPELLS[SPELL.FORGETFULNESS] = spell(SPELL.FORGETFULNESS, { key: "forgetfulness", level: 3, schools: ["water"] });

const table = [creature(0), creature(1), creature(2, { abilities: [{ type: "LEVEL_SPELL_IMMUNITY", val: 5 }] })];
table[112] = creature(112, { key: "airElemental", hp: 25 });
table[114] = creature(114, { key: "fireElemental", hp: 35 });
table[3] = creature(3, { abilities: [{ type: "SHOOTER" }], shots: 10 });

function battle(spells: number[], skills: [number, number][] = [], power = 2, them = [1, 1]): BattleState {
  const s = createBattle(
    {
      seed: 7,
      field: "grass",
      sides: [
        { name: "A", controller: "human", stacks: [{ creature: 0, count: 10 }, { creature: 0, count: 10 }], hero: { name: "Mage", heroClass: 1, female: false, owner: 0, primary: [0, 0, power, 5], skills, spells, mana: 100 } },
        { name: "B", controller: "ai", stacks: them.map((creature) => ({ creature, count: 10 })) },
      ],
    },
    table,
    SPELLS,
  );
  startBattle(s);
  // Make sure side A is up.
  s.active = s.units.find((u) => u.side === 0)!.id;
  s.units.forEach((u, i) => (u.pos = [18, 52, 32, 66][i] ?? u.pos));
  return s;
}

test("Magic Arrow: power x SP + effect by mastery; mana spent; once per round", () => {
  const s = battle([SPELL.MAGIC_ARROW]);
  const target = s.units.find((u) => u.side === 1)!;
  const before = (target.count - 1) * 100 + target.firstHp;
  applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.MAGIC_ARROW, target: target.pos });
  const after = (target.count - 1) * 100 + target.firstHp;
  assert.equal(before - after, 10 * 2 + 10);
  assert.equal(s.sides[0].hero!.mana, 95);
  assert.throws(() => applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.MAGIC_ARROW, target: target.pos }), /already cast/);
  assert.equal(castable(s, 0).length, 0);
  // Expert in any of its schools: effect 30.
  const e = battle([SPELL.MAGIC_ARROW], [[17, 3]]);
  const t2 = e.units.find((u) => u.side === 1)!;
  applyAction(e, { type: "cast", unit: e.active!, spell: SPELL.MAGIC_ARROW, target: t2.pos });
  assert.equal(1000 - ((t2.count - 1) * 100 + t2.firstHp), 10 * 2 + 30);
  assert.equal(e.sides[0].hero!.mana, 96, "basic+ mastery is cheaper");
});

test("immunity: level spell immunity blocks the spell", () => {
  const s = battle([SPELL.MAGIC_ARROW], [], 2, [2]);
  const dragon = s.units.find((u) => u.side === 1)!;
  assert.equal(spellTargets(s, 0, SPELLS[SPELL.MAGIC_ARROW], dragon.pos).length, 0);
  assert.throws(() => applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.MAGIC_ARROW, target: dragon.pos }), /no valid target/);
});

test("Bless: maximum damage; expert Water Magic blesses every friendly stack; Haste adds speed", () => {
  const s = battle([SPELL.BLESS, SPELL.HASTE]);
  const [a, b] = s.units.filter((u) => u.side === 0);
  const foe = s.units.find((u) => u.side === 1)!;
  applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.BLESS, target: a.pos });
  assert.ok(a.effects?.some((e) => e.spell === SPELL.BLESS));
  assert.ok(!b.effects?.length, "single target without expertise");
  const d = expectedDamage(s, a, foe, false);
  assert.equal(d.min, d.max, "blessed: always the maximum");
  const m = battle([SPELL.BLESS], [[16, 3]]);
  applyAction(m, { type: "cast", unit: m.active!, spell: SPELL.BLESS, target: m.units[0].pos });
  assert.equal(m.units.filter((u) => u.side === 0 && u.effects?.some((e) => e.spell === SPELL.BLESS)).length, 2, "mass at expert");
  const h = battle([SPELL.HASTE]);
  const before = speedOf(h, h.units[0]);
  applyAction(h, { type: "cast", unit: h.active!, spell: SPELL.HASTE, target: h.units[0].pos });
  assert.equal(speedOf(h, h.units[0]), before + 3);
  // Wears off after SP (2) rounds.
  assert.equal(h.units[0].effects![0].rounds, 2);
});

test("Chain Lightning halves on each jump; summoning adds elementals", () => {
  const s = battle([SPELL.CHAIN_LIGHTNING], [], 1, [1, 1]);
  const first = s.units.find((u) => u.side === 1)!;
  const events = applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.CHAIN_LIGHTNING, target: first.pos });
  const ev = events.find((e) => e.e === "spell") as Extract<(typeof events)[number], { e: "spell" }>;
  assert.equal(ev.damage[0].damage, 40 + 25);
  assert.equal(ev.damage[1].damage, Math.floor((40 + 25) / 2));
  const z = battle([SPELL.AIR_ELEMENTAL], [], 3);
  const n = z.units.length;
  applyAction(z, { type: "cast", unit: z.active!, spell: SPELL.AIR_ELEMENTAL, target: 0 });
  assert.equal(z.units.length, n + 1);
  assert.equal(z.units[n].count, 2 * 3);
  assert.ok(z.units[n].summoned);
});

test("the battle AI casts its best spell and then acts", async () => {
  const { runAi } = await import("../src/index.ts");
  const s = battle([SPELL.MAGIC_ARROW, SPELL.BLESS, SPELL.CHAIN_LIGHTNING], [], 5);
  s.sides[0].controller = "ai";
  runAi(s);
  assert.ok(s.log.some((e) => logIsCast(e)), "cast something");
  assert.notEqual(s.winner, null);
});

test("Sacrifice: a fallen stack rises with (power + victim's health + 3) per victim; the victim is gone", () => {
  const s = battle([SPELL.SACRIFICE]);
  const [a, b] = s.units.filter((u) => u.side === 0);
  a.count = 0;
  b.count = 4;
  applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.SACRIFICE, target: a.pos, dest: b.pos });
  // (2 power + 100 hp + 3) x 4 = 420 health: four creatures of 100 hp and a fifth with 20.
  assert.equal(a.count, 5);
  assert.equal(a.firstHp, 20);
  assert.equal(b.count, 0);
  assert.ok(b.sacrificed);
});

test("Ring of Oblivion (HotA): healing only tops up the wounded, the dead stay dead", () => {
  const s = battle([SPELL.SACRIFICE]);
  const u = s.units.find((x) => x.side === 0)!;
  u.count = 6;
  u.firstHp = 50;
  assert.equal(heal(s, u, 1000), 4, "normally the fallen come back");
  const r = battle([SPELL.SACRIFICE]);
  r.sides[1].hero = { name: "Foe", heroClass: 1, female: false, primary: [0, 0, 0, 0], skills: [], spells: [], mana: 0, bonuses: [{ type: "DISINTEGRATE" }] } as never;
  const v = r.units.find((x) => x.side === 0)!;
  v.count = 6;
  v.firstHp = 50;
  assert.equal(heal(r, v, 1000), 0);
  assert.equal(v.firstHp, 100, "the top creature is healed");
  v.count = 0;
  assert.equal(affects(r, SPELLS[SPELL.SACRIFICE], v), false, "nothing to sacrifice into or raise");
  assert.equal(affects(s, SPELLS[SPELL.SACRIFICE], { ...u, count: 0 }), true);
  // Battle-wide (the HotA mod's propagator): the foe's ring stops this side's Resurrection even on a living, wounded stack.
  const res = spell(SPELL.RESURRECTION, { key: "resurrection", level: 4, schools: ["earth"], power: 50, effect: [40, 40, 80, 160] });
  v.count = 6;
  v.firstHp = 50;
  u.count = 6;
  u.firstHp = 50;
  assert.equal(affects(s, res, u), true, "without the ring, Resurrection reaches a wounded stack");
  assert.equal(affects(r, res, v), false, "the enemy's ring blocks it for this side too");
  assert.equal(affects(r, { ...res, key: "animateDead", id: SPELL.ANIMATE_DEAD }, v), false);
});

test("the AI dispels the enemy's blessings and its own curses, and leaves a clean field alone", async () => {
  const { chooseSpell } = await import("../src/battle/aiMagic.ts");
  SPELLS[SPELL.DISPEL] = spell(SPELL.DISPEL, { key: "dispel", schools: ["water"] });
  const s = battle([SPELL.DISPEL], [[16, 2]]);
  assert.equal(chooseSpell(s, 0, s.active!), null, "nothing to take away");
  const foe = s.units.find((u) => u.side === 1)!;
  foe.effects = [{ spell: SPELL.BLESS, rounds: 3, mastery: 1, value: 1 }];
  const cast = chooseSpell(s, 0, s.active!);
  assert.equal(cast?.type === "cast" && cast.spell, SPELL.DISPEL, "Bless on an enemy: dispel it");
});

test("the AI teleports a melee stack that's out of the fight next to the enemy's shooters", async () => {
  const { chooseSpell } = await import("../src/battle/aiMagic.ts");
  const { neighbours } = await import("../src/battle/hex.ts");
  SPELLS[SPELL.TELEPORT] = spell(SPELL.TELEPORT, { key: "teleport", level: 3, schools: ["water"], cost: [15, 12, 12, 3] });
  table[3] = creature(3, { abilities: [{ type: "SHOOTER" }], shots: 12 });
  const s = battle([SPELL.TELEPORT], [], 2, [3, 3]);
  const cast = chooseSpell(s, 0, s.active!);
  assert.ok(cast?.type === "cast" && cast.spell === SPELL.TELEPORT && cast.dest !== undefined, "a teleport");
  const shooters = s.units.filter((u) => u.side === 1).map((u) => u.pos);
  const dest = cast!.type === "cast" ? cast!.dest! : -1;
  assert.ok(shooters.some((p) => neighbours(p).includes(dest)), "next to a shooter");
});

test("a refused Teleport or Sacrifice costs nothing: the landing and the victim are checked before the spell points go", () => {
  SPELLS[SPELL.TELEPORT] ??= spell(SPELL.TELEPORT, { key: "teleport", level: 3, schools: ["water"], cost: [15, 12, 12, 3] });
  const s = battle([SPELL.TELEPORT, SPELL.SACRIFICE]);
  const [a] = s.units.filter((u) => u.side === 0);
  const foe = s.units.find((u) => u.side === 1)!;
  assert.throws(() => applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.TELEPORT, target: a.pos, dest: foe.pos }), /can't teleport there/);
  a.count = 0;
  assert.throws(() => applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.SACRIFICE, target: a.pos, dest: foe.pos }), /sacrifice/);
  assert.equal(s.sides[0].hero!.mana, 100);
  assert.ok(!s.cast?.[0], "the hero may still cast this round");
  a.count = 10;
  // Refused landings (obstacles) along the way cost nothing either: the first open hex takes it.
  let landed = -1;
  for (let dest = 80; dest < 100 && landed < 0; dest++) {
    try {
      applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.TELEPORT, target: a.pos, dest });
      landed = dest;
    } catch {}
  }
  assert.equal(a.pos, landed);
  assert.equal(s.sides[0].hero!.mana, 85);
});

test("Dendroids teleported away let go of the stack they bound, its mark too (the bind ends when they move)", () => {
  SPELLS[SPELL.TELEPORT] ??= spell(SPELL.TELEPORT, { key: "teleport", level: 3, schools: ["water"], cost: [15, 12, 12, 3] });
  const s = battle([SPELL.TELEPORT]);
  const [a] = s.units.filter((u) => u.side === 0);
  const foe = s.units.find((u) => u.side === 1)!;
  foe.effects = [{ spell: SPELL.BIND, rounds: 999, mastery: 0, value: a.id }];
  let landed = -1;
  for (let dest = 80; dest < 100 && landed < 0; dest++) {
    try {
      applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.TELEPORT, target: a.pos, dest });
      landed = dest;
    } catch {}
  }
  assert.equal(a.pos, landed);
  assert.ok(!foe.effects?.some((e) => e.spell === SPELL.BIND), "let go");
});

test("Chain Lightning strikes four stacks at basic, five from advanced (SPTRAITS)", () => {
  for (const [lvl, hits] of [[1, 4], [2, 5], [3, 5]] as const) {
    const s = battle([SPELL.CHAIN_LIGHTNING], [[15, lvl]], 1, [1, 1, 1, 1]);
    const first = s.units.find((u) => u.side === 1)!;
    const events = applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.CHAIN_LIGHTNING, target: first.pos });
    const ev = events.find((e) => e.e === "spell") as Extract<(typeof events)[number], { e: "spell" }>;
    assert.equal(ev.units.length, hits, `mastery ${lvl}`);
  }
});

test("Dispel: a friend (basic), anyone (advanced), every stack and the field's spells (expert); Disrupting Ray stays", () => {
  SPELLS[SPELL.DISPEL] = spell(SPELL.DISPEL, { key: "dispel", schools: ["water"] });
  const bless = { spell: SPELL.BLESS, rounds: 3, mastery: 1, value: 1 };
  const ray = { spell: SPELL.DISRUPTING_RAY, rounds: 999, mastery: 1, value: 3 };
  const basic = battle([SPELL.DISPEL], [[16, 1]]);
  const foe = basic.units.find((u) => u.side === 1)!;
  assert.equal(spellTargets(basic, 0, SPELLS[SPELL.DISPEL], foe.pos).length, 0, "basic: not on an enemy");
  const adv = battle([SPELL.DISPEL], [[16, 2]]);
  const f2 = adv.units.find((u) => u.side === 1)!;
  f2.effects = [{ ...bless }, { ...ray }];
  applyAction(adv, { type: "cast", unit: adv.active!, spell: SPELL.DISPEL, target: f2.pos });
  assert.deepEqual(f2.effects.map((e) => e.spell), [SPELL.DISRUPTING_RAY]);
  // Expert: both sides, through a creature's immunity, and the fire walls go.
  const ex = battle([SPELL.DISPEL], [[16, 3]], 2, [2, 1]);
  ex.units.forEach((u) => (u.effects = [{ ...bless }]));
  ex.hazards = [{ kind: "fireWall", hexes: [40], side: 1, rounds: 2, damage: 10 }];
  applyAction(ex, { type: "cast", unit: ex.active!, spell: SPELL.DISPEL, target: ex.units[0].pos });
  assert.ok(ex.units.every((u) => !u.effects?.length), "every stack cleared, the immune one too");
  assert.equal(ex.hazards.length, 0);
});

test("Cure leaves Disrupting Ray and binding; Anti-Magic lifts the curses of the levels it guards against", () => {
  SPELLS[SPELL.CURE] = spell(SPELL.CURE, { key: "cure", schools: ["water"], power: 5, effect: [10, 10, 20, 30] });
  SPELLS[SPELL.ANTI_MAGIC] = spell(SPELL.ANTI_MAGIC, { key: "antiMagic", level: 3, schools: ["earth"], effect: [4, 4, 5, 6] });
  SPELLS[SPELL.SLOW] = spell(SPELL.SLOW, { key: "slow", level: 1, schools: ["earth"] });
  SPELLS[SPELL.SORROW] = spell(SPELL.SORROW, { key: "sorrow", level: 4, schools: ["earth"] });
  const c = battle([SPELL.CURE]);
  const u = c.units[0];
  u.effects = [{ spell: SPELL.SLOW, rounds: 2, mastery: 1, value: 25 }, { spell: SPELL.DISRUPTING_RAY, rounds: 999, mastery: 1, value: 3 }, { spell: SPELL.BIND, rounds: 999, mastery: 0, value: 3 }];
  applyAction(c, { type: "cast", unit: c.active!, spell: SPELL.CURE, target: u.pos });
  assert.deepEqual(u.effects.map((e) => e.spell), [SPELL.DISRUPTING_RAY, SPELL.BIND]);
  const a = battle([SPELL.ANTI_MAGIC, SPELL.SORROW]);
  const v = a.units[0];
  v.effects = [{ spell: SPELL.SLOW, rounds: 2, mastery: 1, value: 25 }, { spell: SPELL.SORROW, rounds: 2, mastery: 1, value: 1 }];
  applyAction(a, { type: "cast", unit: a.active!, spell: SPELL.ANTI_MAGIC, target: v.pos });
  assert.deepEqual(v.effects!.map((e) => e.spell), [SPELL.SORROW, SPELL.ANTI_MAGIC], "basic: levels 1-3 lifted, Sorrow (4) stays");
});

test("Slow (HotA): speed x 0.75 at basic, x 0.5 + 1 from advanced", () => {
  const s = battle([]);
  const u = s.units[0];
  const base = speedOf(s, u);
  u.effects = [{ spell: SPELL.SLOW, rounds: 2, mastery: 1, value: 75 }];
  assert.equal(speedOf(s, u), Math.floor(base * 0.75));
  u.effects = [{ spell: SPELL.SLOW, rounds: 2, mastery: 2, value: 50 }];
  assert.equal(speedOf(s, u), Math.floor(base * 0.5) + 1);
});

test("Summon Fire Elemental: power x 2.5 at Advanced (SPTRAITS), x 3 at Expert", () => {
  SPELLS[SPELL.FIRE_ELEMENTAL] = spell(SPELL.FIRE_ELEMENTAL, { key: "fireElemental", level: 5, schools: ["fire"], cost: [25, 20, 20, 20], effect: [2, 2, 2, 3] });
  table[114] = creature(114, { key: "fireElemental", hp: 35 });
  for (const [lvl, n] of [[2, 7], [3, 9]] as const) {
    const z = battle([SPELL.FIRE_ELEMENTAL], [[14, lvl]], 3);
    applyAction(z, { type: "cast", unit: z.active!, spell: SPELL.FIRE_ELEMENTAL, target: 0 });
    assert.equal(z.units[z.units.length - 1].count, n, `mastery ${lvl}`);
  }
});

test("HotA elementals: Fire and Earth by health (2.5 x SP at advanced), and two kinds in one battle", () => {
  const z = battle([SPELL.FIRE_ELEMENTAL, SPELL.AIR_ELEMENTAL], [[14, 2]], 3);
  const n = z.units.length;
  applyAction(z, { type: "cast", unit: z.active!, spell: SPELL.FIRE_ELEMENTAL, target: 0 });
  // 88 x 3 = 264 hit points of 35-point elementals: 7 (SoD gave 2 x 3 = 6).
  assert.equal(z.units[n].count, 7);
  z.cast = undefined;
  applyAction(z, { type: "cast", unit: z.active!, spell: SPELL.AIR_ELEMENTAL, target: 0 });
  assert.equal(z.units.length, n + 2, "a second kind of elemental joins");
});

test("Forgetfulness: basic halves the shots; advanced stops them and HotA halves the melee blows", () => {
  const forgot = (skills: [number, number][]) => {
    const s = battle([SPELL.FORGETFULNESS], skills, 2, [3]);
    const archer = s.units.find((u) => u.side === 1)!;
    const target = s.units.find((u) => u.side === 0)!;
    const shot = expectedDamage(s, archer, target, true).max;
    const blow = expectedDamage(s, archer, target, false).max;
    applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.FORGETFULNESS, target: archer.pos });
    return { s, archer, shot: expectedDamage(s, archer, target, true).max / shot, blow: expectedDamage(s, archer, target, false).max / blow };
  };
  const basic = forgot([]);
  assert.ok(canShoot(basic.s, basic.archer), "basic: still shoots");
  assert.equal(basic.shot, 0.5);
  assert.equal(basic.blow, 1);
  const adv = forgot([[16, 2]]);
  assert.ok(!canShoot(adv.s, adv.archer), "advanced: can't shoot");
  assert.equal(adv.blow, 0.5);
});

test("Berserk lasts until the stack attacks, not spell-power rounds", () => {
  SPELLS[SPELL.BERSERK] = spell(SPELL.BERSERK, { key: "berserk", level: 4, schools: ["fire"], cost: [20, 16, 16, 16] });
  const s = battle([SPELL.BERSERK]);
  const foe = s.units[2];
  applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.BERSERK, target: foe.pos });
  assert.equal(foe.effects?.find((e) => e.spell === SPELL.BERSERK)?.rounds, 255);
});

test("Cure: basic frees one's own hypnotised stack, expert passes over it and spares the hypnosis it holds", () => {
  SPELLS[SPELL.CURE] = spell(SPELL.CURE, { key: "cure", schools: ["water"], power: 5, effect: [10, 10, 20, 30] });
  SPELLS[SPELL.SLOW] = spell(SPELL.SLOW, { key: "slow", level: 1, schools: ["earth"] });
  const on = (u: { effects?: { spell: number }[] }) => (u.effects ?? []).map((e) => e.spell);
  const hypnotised = () => [{ spell: SPELL.HYPNOTIZE, rounds: 3, mastery: 1, value: 0 }, { spell: SPELL.SLOW, rounds: 3, mastery: 1, value: 75 }];
  const b = battle([SPELL.CURE]);
  b.units[1].effects = hypnotised();
  applyAction(b, { type: "cast", unit: b.active!, spell: SPELL.CURE, target: b.units[1].pos });
  assert.deepEqual(on(b.units[1]), [], "basic Cure lifts the hypnosis too");
  const x = battle([SPELL.CURE], [[16, 3]]);
  x.units[1].effects = hypnotised();
  x.units[2].effects = hypnotised();
  applyAction(x, { type: "cast", unit: x.active!, spell: SPELL.CURE, target: x.units[0].pos });
  assert.deepEqual(on(x.units[1]), [SPELL.HYPNOTIZE, SPELL.SLOW], "the enemy holds it: not cured");
  assert.deepEqual(on(x.units[2]), [SPELL.HYPNOTIZE], "ours for now: Slow lifted, still ours");
});

test("the AI casts a Protection only against an enemy hero seen casting a spell of that school", async () => {
  const { chooseSpell } = await import("../src/battle/aiMagic.ts");
  SPELLS[SPELL.PROT_EARTH] = spell(SPELL.PROT_EARTH, { key: "protectEarth", schools: ["earth"], effect: [30, 30, 50, 50] });
  SPELLS[SPELL.LIGHTNING_BOLT] = spell(SPELL.LIGHTNING_BOLT, { key: "lightningBolt", level: 2, schools: ["air"], cost: [10, 8, 8, 8], power: 25, effect: [10, 10, 20, 50] });
  SPELLS[SPELL.IMPLOSION] = spell(SPELL.IMPLOSION, { key: "implosion", level: 5, schools: ["earth"], cost: [30, 25, 25, 25], power: 75, effect: [100, 100, 200, 300] });
  const s = battle([SPELL.PROT_EARTH]);
  // (2026-10-27 18:26: Protection from Earth against a hero with no earth spell.)
  s.sides[1].hero = { name: "Foe", heroClass: 1, female: false, owner: 1, primary: [0, 0, 3, 5], skills: [], spells: [SPELL.LIGHTNING_BOLT], mana: 50 } as unknown as BattleState["sides"][number]["hero"];
  // (The foe's hero joins after the battle is made: its spells into the battle's table too.)
  s.spells = { ...s.spells, [SPELL.LIGHTNING_BOLT]: SPELLS[SPELL.LIGHTNING_BOLT], [SPELL.IMPLOSION]: SPELLS[SPELL.IMPLOSION] };
  assert.equal(chooseSpell(s, 0, s.active!), null, "the enemy has no earth spell: no Protection from Earth");
  s.sides[1].hero!.spells = [SPELL.IMPLOSION];
  // (Only what a player sees: Implosion in the enemy's book, not cast yet, is unknown.)
  assert.equal(chooseSpell(s, 0, s.active!), null, "an Implosion not seen yet: no Protection from Earth");
  s.castLog = [[], [SPELL.LIGHTNING_BOLT]];
  assert.equal(chooseSpell(s, 0, s.active!), null, "a Lightning Bolt seen: still no Protection from Earth");
  s.castLog = [[], [SPELL.IMPLOSION]];
  const cast = chooseSpell(s, 0, s.active!);
  assert.equal(cast?.type === "cast" && cast.spell, SPELL.PROT_EARTH, "against Implosion it guards");
});
