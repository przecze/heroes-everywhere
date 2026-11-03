// Conflux, Cove, Factory, Bulwark and neutral creatures' abilities as heroes.thelazy.net's creature pages
// give them, on a synthetic table (the keys are the real ones where the rules go by them).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BattleEvent,
  type BattleHero,
  type BattleState,
  type CreatureStats,
  CREATURE_INFO,
  SKILLS,
  alive,
  applyAction,
  canShootAt,
  createBattle,
  effectOf,
  enchant,
  expectedDamage,
  fearless,
  hexAt,
  luckOf,
  spellDamage,
  startBattle,
} from "../src/index.ts";
import { SPELL, type SpellInfo } from "../src/spells.ts";
import { rangePenalty } from "../src/battle/damage.ts";
import { unitHexes } from "../src/battle/reach.ts";
import { hexDistance } from "../src/battle/hex.ts";

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "neutral", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 10, speed: 5, attack: 10, defense: 10, minDamage: 10, maxDamage: 10,
    shots: 0, abilities: [], def: "", missile: "", sound: "", ...over,
  };
}

const spell = (id: number, key: string, level: number, power: number, effect: number[], schools: string[] = []) =>
  ({ id, key, name: key, level, schools, cost: [5, 5, 5, 5], power, effect, chance: [], text: [] }) as unknown as SpellInfo;
const SPELLS: SpellInfo[] = [];
SPELLS[SPELL.MAGIC_ARROW] = spell(SPELL.MAGIC_ARROW, "magicArrow", 1, 10, [10, 10, 20, 30], ["air", "fire", "water", "earth"]);
SPELLS[SPELL.WEAKNESS] = spell(SPELL.WEAKNESS, "weakness", 2, 0, [3, 3, 6, 6], ["water"]);
SPELLS[SPELL.DISRUPTING_RAY] = spell(SPELL.DISRUPTING_RAY, "disruptingRay", 2, 0, [3, 3, 4, 5], ["air"]);
SPELLS[SPELL.CURSE] = spell(SPELL.CURSE, "curse", 1, 0, [0, 0, 1, 1], ["fire"]);
SPELLS[SPELL.HYPNOTIZE] = spell(SPELL.HYPNOTIZE, "hypnotize", 3, 25, [10, 10, 20, 50], ["air"]);
SPELLS[SPELL.CURE] = spell(SPELL.CURE, "cure", 1, 5, [10, 10, 20, 30], ["water"]);
SPELLS[SPELL.AIR_SHIELD] = spell(SPELL.AIR_SHIELD, "airShield", 3, 0, [25, 25, 50, 50], ["air"]);
SPELLS[SPELL.HASTE] = spell(SPELL.HASTE, "haste", 1, 0, [3, 3, 5, 5], ["air"]);

const PLAIN = 0, UNDEAD = 1, PSYCHIC = 2, MAGIC = 3, IMMUNE = 4, GRENADIER = 5, RUST = 6, FANGARM = 7, WITCH = 8, SORCERESS = 9, MUMMY = 10;
const HASPID = 22, WIDE = 23;
const LEPRECHAUN = 11, HALFLING = 12, ARGALI = 13, COUATL = 14, FAST = 15, MECHANIC = 16, AUTOMATON = 17, GUNSLINGER = 18, SHOOTER = 19, STEEL_ELF = 20, ENCHANTER = 21;
const TABLE: CreatureStats[] = [
  creature(PLAIN, { hp: 1000 }),
  creature(UNDEAD, { hp: 1000, abilities: [{ type: "UNDEAD" }] }),
  creature(PSYCHIC, { key: "psychicElemental", abilities: [{ type: "NON_LIVING" }, { type: "ATTACKS_ALL_ADJACENT" }, { type: "BLOCKS_RETALIATION" }, { type: "MIND_IMMUNITY" }] }),
  creature(MAGIC, { key: "magicElemental", abilities: [{ type: "NON_LIVING" }, { type: "ATTACKS_ALL_ADJACENT" }, { type: "BLOCKS_RETALIATION" }, { type: "LEVEL_SPELL_IMMUNITY", val: 5 }] }),
  creature(IMMUNE, { hp: 1000, abilities: [{ type: "LEVEL_SPELL_IMMUNITY", val: 5 }] }),
  creature(GRENADIER, { key: "halflingGrenadier", shots: 24, abilities: [{ type: "SHOOTER" }, { type: "ENEMY_DEFENCE_REDUCTION", val: 20 }] }),
  creature(RUST, { hp: 750, speed: 9, abilities: [{ type: "ACID_BREATH", val: 25 }, { type: "SPELL_AFTER_ATTACK", subtype: "acidBreath", val: 100 }] }),
  creature(FANGARM, { hp: 50, abilities: [{ type: "SPELL_AFTER_ATTACK", subtype: "hypnotize", val: 100 }, { type: "MIND_IMMUNITY" }] }),
  creature(WITCH, { key: "seaWitch", shots: 12, abilities: [{ type: "SHOOTER" }, { type: "SPELL_AFTER_ATTACK", subtype: "weakness", val: 100 }, { type: "SPELL_AFTER_ATTACK", subtype: "disruptingRay", val: 100 }] }),
  creature(SORCERESS, { key: "sorceress", shots: 12, abilities: [{ type: "SHOOTER" }, { type: "SPELL_AFTER_ATTACK", subtype: "weakness", val: 100 }, { type: "SPELL_AFTER_ATTACK", subtype: "disruptingRay", val: 100 }] }),
  creature(MUMMY, { abilities: [{ type: "UNDEAD" }, { type: "SPELL_AFTER_ATTACK", subtype: "curse", val: 25 }] }),
  creature(LEPRECHAUN, { abilities: [{ type: "LUCK", val: 100 }] }),
  creature(HALFLING, { faction: "factory", shots: 24, abilities: [{ type: "SHOOTER" }, { type: "LUCK", val: 1 }] }),
  creature(ARGALI, { abilities: [{ type: "SPELL_DAMAGE_REDUCTION", subtype: "any", val: -20 }] }),
  creature(COUATL, { hp: 160, speed: 11, abilities: [{ type: "SPELLCASTER", subtype: "meditation01", val: 0 }, { type: "CASTS", val: 1 }] }),
  creature(FAST, { hp: 1000, speed: 20, abilities: [{ type: "FLYING" }] }),
  creature(MECHANIC, { abilities: [{ type: "ADJACENT_SPELLCASTER", subtype: "hotaRepair" }, { type: "SPECIFIC_SPELL_POWER", subtype: "hotaRepair", val: 10 }, { type: "CASTS", val: 1 }] }),
  creature(AUTOMATON, { hp: 30, abilities: [{ type: "MECHANICAL" }] }),
  creature(GUNSLINGER, { hp: 45, shots: 16, abilities: [{ type: "SHOOTER" }, { type: "RANGED_RETALIATION" }, { type: "FIRST_STRIKE", subtype: "damageTypeRanged" }] }),
  creature(SHOOTER, { hp: 1000, shots: 24, abilities: [{ type: "SHOOTER" }] }),
  creature(STEEL_ELF, { shots: 8, abilities: [{ type: "SHOOTER" }, { type: "NO_MELEE_PENALTY" }, { type: "FREE_SHOOTING" }] }),
  creature(ENCHANTER, { shots: 32, abilities: [{ type: "SHOOTER" }, { type: "ENCHANTER", subtype: "cure", val: 3 }, { type: "ENCHANTER", subtype: "airShield", val: 3 }, { type: "ENCHANTER", subtype: "haste", val: 3 }] }),
];
TABLE[HASPID] = creature(HASPID, { key: "haspid", abilities: [{ type: "REVENGE" }] });
TABLE[WIDE] = creature(WIDE, { hp: 1000, abilities: [{ type: "DOUBLE_WIDE" }] });
TABLE[146] = creature(146, { key: "ballista", hp: 250, shots: 24, abilities: [{ type: "DOUBLE_WIDE" }, { type: "SHOOTER" }] });
TABLE[150] = creature(150, { key: "cannon", hp: 250, attack: 19, minDamage: 4, maxDamage: 7, shots: 8, abilities: [{ type: "DOUBLE_WIDE" }, { type: "SHOOTER" }] });

const hero = (owner: number, over: Partial<BattleHero> = {}): BattleHero => ({ name: `H${owner}`, heroClass: 0, female: false, owner, primary: [0, 0, 1, 1], ...over });

function battle(a: [number, number][], b: [number, number][], seed = 3, heroes: [BattleHero?, BattleHero?] = []): BattleState {
  const s = createBattle(
    {
      seed,
      field: "grass_hills",
      sides: [
        { name: "A", controller: "human", stacks: a.map(([creature, count]) => ({ creature, count })), hero: heroes[0] },
        { name: "B", controller: "human", stacks: b.map(([creature, count]) => ({ creature, count })), hero: heroes[1] },
      ],
    },
    TABLE,
    SPELLS,
  );
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  return s;
}

/** Puts `a` beside `d` and lets it attack from where it stands. */
function strikeBeside(s: BattleState, a: number, d: number) {
  const ua = s.units[a];
  const ud = s.units[d];
  ua.pos = hexAt(7, 5);
  ud.pos = hexAt(8, 5);
  s.active = ua.id;
  return applyAction(s, { type: "attack", unit: ua.id, target: ud.id, from: ua.pos });
}

test("Psychic Elementals do half damage to the mind-immune, Magic Elementals to those immune to all spells", () => {
  const s = battle([[PSYCHIC, 10], [MAGIC, 10]], [[PLAIN, 10], [UNDEAD, 10], [IMMUNE, 10]]);
  const [psychic, magic, plain, undead, immune] = s.units;
  assert.equal(expectedDamage(s, psychic, undead, false).max, expectedDamage(s, psychic, plain, false).max / 2);
  assert.equal(expectedDamage(s, psychic, immune, false).max, expectedDamage(s, psychic, plain, false).max);
  assert.equal(expectedDamage(s, magic, immune, false).max, expectedDamage(s, magic, plain, false).max / 2);
  assert.equal(expectedDamage(s, magic, undead, false).max, expectedDamage(s, magic, plain, false).max);
});

test("Halfling Grenadiers ignore 20% of the enemy's Defense with their shots only", () => {
  const s = battle([[GRENADIER, 10]], [[PLAIN, 10]]);
  const [g, foe] = s.units;
  g.pos = hexAt(3, 5);
  foe.pos = hexAt(6, 5);
  // Attack 10 against Defense 10, 8 of it counted: +10% for the shot; in melee the full 10 (and the shooter's half).
  assert.equal(expectedDamage(s, g, foe, true).max, 110);
  assert.equal(expectedDamage(s, g, foe, false).max, 50);
});

test("Rust Dragons' acid: -3 Defense with every blow, 25 more damage per dragon one time in five", () => {
  let burns = 0;
  const tries = 400;
  for (let seed = 1; seed <= tries; seed++) {
    const s = battle([[RUST, 2]], [[PLAIN, 100]], seed);
    const ev = strikeBeside(s, 0, 1);
    burns += ev.filter((e) => e.e === "attack" && e.acid).length;
    assert.equal(effectOf(s.units[1], SPELL.ACID_BREATH)?.value, 3, "Defense -3");
    const extra = ev.filter((e) => e.e === "attack" && e.acid);
    for (const e of extra) assert.equal(e.e === "attack" && e.damage, 50);
    assert.ok(!ev.some((e) => e.e === "spell" && e.damage.length), "no second acid damage");
  }
  assert.ok(burns > tries * 0.13 && burns < tries * 0.27, `acid ${burns} of ${tries}`);
});

test("Fangarms hypnotize stacks with no more than 20 + 25 per Fangarm health left, for three rounds; the hypnotized don't strike back", () => {
  // 2 Fangarms: 70 health or less. 100 Pikemen of 1000 are far beyond; a lone wounded one is not.
  const s = battle([[FANGARM, 2]], [[PLAIN, 100]]);
  strikeBeside(s, 0, 1);
  assert.ok(!effectOf(s.units[1], SPELL.HYPNOTIZE));
  const t = battle([[FANGARM, 2]], [[PLAIN, 1]]);
  t.units[1].firstHp = 70 + 20; // the blow (2 x 10) leaves 70
  const ev = strikeBeside(t, 0, 1);
  const h = effectOf(t.units[1], SPELL.HYPNOTIZE);
  assert.ok(h, "hypnotized");
  assert.equal(h.rounds, 3);
  assert.ok(!ev.some((e) => e.e === "attack" && e.retaliation), "no retaliation from the hypnotized stack");
});

test("Sea Witches weaken the stack they shoot (Basic), Disrupting Ray on one already weakened; Sorceresses at Advanced; nothing in melee", () => {
  const shoot = (who: number) => {
    const s = battle([[who, 5]], [[PLAIN, 10]]);
    const [w, foe] = s.units;
    s.active = w.id;
    applyAction(s, { type: "shoot", unit: w.id, target: foe.id });
    const first = { weak: effectOf(foe, SPELL.WEAKNESS)?.value, ray: effectOf(foe, SPELL.DISRUPTING_RAY)?.value };
    s.active = w.id;
    w.acted = false;
    applyAction(s, { type: "shoot", unit: w.id, target: foe.id });
    return { first, second: { weak: effectOf(foe, SPELL.WEAKNESS)?.value, ray: effectOf(foe, SPELL.DISRUPTING_RAY)?.value, rounds: effectOf(foe, SPELL.WEAKNESS)?.rounds } };
  };
  assert.deepEqual(shoot(WITCH), { first: { weak: 3, ray: undefined }, second: { weak: 3, ray: 3, rounds: 3 } });
  assert.deepEqual(shoot(SORCERESS), { first: { weak: 6, ray: undefined }, second: { weak: 6, ray: 4, rounds: 3 } });
  const s = battle([[WITCH, 5]], [[PLAIN, 10]]);
  strikeBeside(s, 0, 1);
  assert.ok(!effectOf(s.units[1], SPELL.WEAKNESS) && !effectOf(s.units[1], SPELL.DISRUPTING_RAY), "no spell with a melee blow");
});

test("Mummies curse one blow in four, at Advanced (minimum damage less one), for three rounds; not the undead", () => {
  let cursed = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const s = battle([[MUMMY, 5]], [[PLAIN, 100], [UNDEAD, 10]], seed);
    strikeBeside(s, 0, 1);
    const c = effectOf(s.units[1], SPELL.CURSE);
    if (c) {
      cursed++;
      assert.equal(c.value, 1);
      assert.equal(c.rounds, 3);
    }
  }
  assert.ok(cursed > 70 && cursed < 130, `cursed ${cursed} of 400`);
  for (let seed = 1; seed <= 50; seed++) {
    const s = battle([[MUMMY, 5]], [[UNDEAD, 100]], seed);
    strikeBeside(s, 0, 1);
    assert.ok(!effectOf(s.units[1], SPELL.CURSE));
  }
});

test("Halflings' luck is at least +1 but under the Hourglass; Leprechauns double their army's lucky strikes", () => {
  const s = battle([[HALFLING, 10]], [[PLAIN, 10]]);
  const [h] = s.units;
  h.effects = [{ spell: SPELL.MISFORTUNE, rounds: 3, mastery: 3, value: 2 }];
  assert.equal(luckOf(s, h), 1, "Misfortune can't lower it");
  s.sides[0].hero = hero(0, { noLuck: true });
  assert.equal(luckOf(s, h), 0, "the Hourglass can");
  assert.equal(luckOf(battle([[LEPRECHAUN, 10]], [[PLAIN, 10]]), battle([[LEPRECHAUN, 10]], [[PLAIN, 10]]).units[0]), 0, "Leprechauns aren't lucky themselves");
  // +1 luck: 1 in 24 lucky strikes, with Leprechauns in the army 1 in 12.
  const lucky = (withLeprechauns: boolean) => {
    let n = 0;
    for (let seed = 1; seed <= 1200; seed++) {
      const t = battle(withLeprechauns ? [[PLAIN, 10], [LEPRECHAUN, 1]] : [[PLAIN, 10]], [[PLAIN, 100]], seed, [hero(0, { luck: 1 })]);
      n += strikeBeside(t, 0, withLeprechauns ? 2 : 1).filter((e) => e.e === "attack" && !e.retaliation && e.luck === "good").length;
    }
    return n;
  };
  const [plain, doubled] = [lucky(false), lucky(true)];
  assert.ok(plain > 25 && plain < 80, `plain ${plain}`);
  assert.ok(doubled > 70 && doubled < 140, `with Leprechauns ${doubled}`);
});

test("Argali: enemies beside them take 20% more spell damage (however many Argali), the Argali themselves don't", () => {
  const s = battle([[ARGALI, 5], [ARGALI, 5]], [[PLAIN, 10], [PLAIN, 10]]);
  const [a1, a2, near, far] = s.units;
  const arrow = SPELLS[SPELL.MAGIC_ARROW];
  a1.pos = hexAt(7, 5);
  a2.pos = hexAt(7, 6);
  near.pos = hexAt(8, 5);
  far.pos = hexAt(12, 1);
  const plain = spellDamage(s, 0, arrow, far);
  assert.equal(spellDamage(s, 0, arrow, near), Math.floor(plain * 1.2));
  assert.equal(spellDamage(s, 1, arrow, a1), plain);
});

test("Azure Dragons' fear spares the mind-immune: undead, non-living, mechanical, war machines and other Azure Dragons", () => {
  const ci = (key: string) => Object.values(CREATURE_INFO).find((c) => c.key === key)!;
  const as = (key: string) => creature(0, { abilities: ci(key).abilities });
  for (const key of ["azureDragon", "skeleton", "goldGolem", "airElemental", "mummy"]) assert.ok(fearless(as(key)), key);
  assert.ok(fearless(creature(0, { abilities: [{ type: "MECHANICAL" }] })));
  assert.ok(fearless(creature(0), { machine: "ballista" } as never));
  for (const key of ["pikeman", "peasant", "goldDragon"]) assert.ok(!fearless(as(key)), key);
});

test("Couatls meditate untouchable until their own turn next round, even when a faster enemy comes first", () => {
  const s = battle([[COUATL, 2]], [[FAST, 5]]);
  const [c, fast] = s.units;
  // The fast flier goes first; then the Couatls meditate.
  s.active = fast.id;
  applyAction(s, { type: "defend", unit: fast.id });
  assert.equal(s.active, c.id);
  applyAction(s, { type: "creatureCast", unit: c.id, target: c.pos });
  assert.equal(s.round, 2);
  assert.equal(s.active, fast.id, "round 2: the faster enemy first");
  const from = [hexAt(c.pos % 17 + 1, Math.floor(c.pos / 17)), hexAt(c.pos % 17 - 1, Math.floor(c.pos / 17))].find((h) => !s.units.some((u) => u.pos === h)) ?? c.pos + 1;
  assert.throws(() => applyAction(s, { type: "attack", unit: fast.id, target: c.id, from }), /meditating/);
  applyAction(s, { type: "wait", unit: fast.id });
  assert.equal(s.active, c.id);
  assert.equal(c.meditating, undefined, "over at its own turn");
});

test("Mechanics repair mechanical stacks, even fallen ones; not war machines, not Automatons that detonated", () => {
  const s = battle([[MECHANIC, 10], [AUTOMATON, 10]], [[PLAIN, 10]], 3, [hero(0, { machines: [4] })]);
  const [m, auto] = s.units;
  const ballista = s.units.find((u) => u.machine === "ballista")!;
  m.pos = hexAt(3, 5);
  auto.pos = hexAt(4, 5);
  s.active = m.id;
  auto.count = 0;
  auto.firstHp = 0;
  ballista.firstHp = 10;
  ballista.pos = hexAt(3, 4);
  assert.throws(() => applyAction(s, { type: "creatureCast", unit: m.id, target: ballista.pos }));
  auto.sacrificed = true;
  assert.throws(() => applyAction(s, { type: "creatureCast", unit: m.id, target: auto.pos }));
  auto.sacrificed = false;
  applyAction(s, { type: "creatureCast", unit: m.id, target: auto.pos });
  assert.equal(auto.count, 4, "100 health: 3 whole Automatons and a fourth");
  assert.ok(alive(auto));
});

test("Gunslingers shoot first only when they could shoot: not with an enemy beside them, not at the Ballista or the Cannon", () => {
  const shotBack = (setup: (s: BattleState) => number) => {
    const s = battle([[SHOOTER, 10]], [[GUNSLINGER, 10], [PLAIN, 1]], 3, [hero(0, { machines: [4] })]);
    const shooter = setup(s);
    s.active = shooter;
    const ev = applyAction(s, { type: "shoot", unit: shooter, target: 1 });
    return ev.some((e) => e.e === "attack" && e.retaliation && e.unit === 1);
  };
  assert.ok(shotBack(() => 0), "a plain shot is answered");
  assert.ok(!shotBack((s) => s.units.find((u) => u.machine === "ballista")!.id), "not the Ballista's");
  assert.ok(
    !shotBack((s) => {
      s.units[1].pos = hexAt(10, 5);
      s.units[2].pos = hexAt(9, 5);
      s.units[2].side = 0;
      return 0;
    }),
    "an enemy beside the Gunslingers",
  );
});

test("After the Gunslingers' Preemptive Shot the shooters still fire, once", () => {
  const s = battle([[SHOOTER, 10]], [[GUNSLINGER, 10]]);
  s.active = 0;
  const ev = applyAction(s, { type: "shoot", unit: 0, target: 1 });
  const blows = ev.filter((e) => e.e === "attack").map((e) => (e as { unit: number }).unit);
  assert.deepEqual(blows, [1, 0]);
});

test("Steel Elves shoot with an enemy beside them, but not at it (the Bow of the Sharpshooter lets them)", () => {
  const s = battle([[STEEL_ELF, 10]], [[PLAIN, 10], [PLAIN, 10]]);
  const [elf, near, far] = s.units;
  elf.pos = hexAt(7, 5);
  near.pos = hexAt(8, 5);
  far.pos = hexAt(14, 1);
  assert.ok(canShootAt(s, elf, far));
  assert.ok(!canShootAt(s, elf, near));
  s.active = elf.id;
  assert.throws(() => applyAction(s, { type: "shoot", unit: elf.id, target: near.id }), /hand to hand/);
  s.sides[0].hero = hero(0, { bonuses: [{ type: "FREE_SHOOTING" }] });
  assert.ok(canShootAt(s, elf, near));
});

test("Enchanters cast Cure only with a friend hurt, Air Shield only against shooters", () => {
  const casts = (hurt: boolean, shooters: boolean) => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const s = battle([[ENCHANTER, 5], [PLAIN, 10]], [[shooters ? SHOOTER : PLAIN, 10]], seed);
      if (hurt) s.units[1].firstHp = 5;
      s.round = 4;
      s.units[0].enchanted = undefined;
      const ev: BattleEvent[] = [];
      enchant(s, s.units[0], ev);
      for (const e of ev) if (e.e === "spell") seen.add(e.spell);
    }
    return seen;
  };
  const plain = casts(false, false);
  assert.ok(!plain.has(SPELL.CURE) && !plain.has(SPELL.AIR_SHIELD) && plain.has(SPELL.HASTE), [...plain].join());
  const both = casts(true, true);
  assert.ok(both.has(SPELL.CURE) && both.has(SPELL.AIR_SHIELD), [...both].join());
});

test("The Cannon: Advanced Artillery +100%, Expert +200%, beside the attack's bonus (the wiki's Ballista vs. Cannon table)", () => {
  // Hero Attack 1 (Cannon 19 + 1 = 20) against Defense 10: +50%; 4-7 x 2 = 8-14.
  for (const [level, k] of [[0, 1.5], [1, 1.5], [2, 2.5], [3, 3.5]]) {
    const skills: [number, number][] = level ? [[SKILLS.indexOf("artillery"), level]] : [];
    const s = battle([[PLAIN, 1]], [[PLAIN, 10]], 3, [hero(0, { primary: [1, 0, 1, 1], machines: [146], skills })]);
    const cannon = s.units.find((u) => u.machine === "cannon")!;
    s.units[1].pos = hexAt(5, 3); // within ten hexes: no range penalty
    assert.deepEqual(expectedDamage(s, cannon, s.units[1], true), { min: Math.floor(8 * k), max: Math.floor(14 * k) }, `artillery ${level}`);
  }
});

test("Water and Ice Elementals: immune to Freezing Shot, no more hurt by Fire Shield or Fire Wall", () => {
  for (const key of ["waterElemental", "iceElemental"]) {
    const c = Object.values(CREATURE_INFO).find((x) => x.key === key)!;
    assert.ok(c.abilities.some((a) => a.type === "SPELL_IMMUNITY" && a.subtype === "freezingShot"), key);
    assert.ok(!c.abilities.some((a) => a.type === "MORE_DAMAGE_FROM_SPELL" && (a.subtype === "fireShield" || a.subtype === "fireWallTrigger")), key);
  }
});

test("Haspids' Revenge: 12 left of 100 hit as an unharmed 43, a stack cut to half as hard as it did whole", () => {
  const s = battle([[HASPID, 100]], [[PLAIN, 10]]);
  const [h, foe] = s.units;
  const blow = (left: number) => {
    h.count = left;
    h.firstHp = 10;
    return expectedDamage(s, h, foe, false).max;
  };
  assert.equal(blow(100), 1000, "no bonus unharmed");
  // 12 x 10 x (1 + sqrt(101 / 13 - 1)) (heroes.thelazy.net Haspid's example)
  assert.equal(blow(12), 432);
  assert.equal(blow(50), 995);
});

test("A two-hex target is in full range when either of its hexes is within 10", () => {
  const s = battle([[SHOOTER, 10]], [[WIDE, 10]]);
  const [a, d] = s.units;
  a.pos = hexAt(1, 5);
  // Where the target's near hex is 10 away and its far one 11.
  for (let col = 9; col <= 13; col++) {
    d.pos = hexAt(col, 5);
    const gaps = unitHexes(s, d).map((h) => hexDistance(a.pos, h)).sort((x, y) => x - y);
    if (gaps[0] === 10 && gaps[1] === 11) break;
  }
  assert.deepEqual(unitHexes(s, d).map((h) => hexDistance(a.pos, h)).sort((x, y) => x - y), [10, 11]);
  assert.equal(rangePenalty(s, a, d), false);
  d.pos += 1;
  assert.ok(unitHexes(s, d).every((h) => hexDistance(a.pos, h) > 10));
  assert.equal(rangePenalty(s, a, d), true);
});

test("Bad morale strikes as a stack's turn begins, not again when it comes back after waiting", () => {
  const s = battle([[PLAIN, 10], [PLAIN, 10]], [[PLAIN, 10], [PLAIN, 10]], 5, [hero(0, { morale: -3 }), hero(1, { morale: -3 })]);
  let frozen = 0;
  for (let i = 0; i < 400 && s.winner === null && s.round <= 40; i++) {
    const u = s.units[s.active!];
    const ev = applyAction(s, u.waited ? { type: "defend", unit: u.id } : { type: "wait", unit: u.id });
    for (const e of ev) {
      if (e.e !== "morale" || e.good) continue;
      assert.ok(!s.units[e.unit].waited, `stack ${e.unit} froze after waiting in round ${s.round}`);
      frozen++;
    }
  }
  assert.ok(frozen > 10, `bad morale struck (${frozen})`);
});
