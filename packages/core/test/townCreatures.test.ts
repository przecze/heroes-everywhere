// Necropolis, Dungeon, Stronghold and Fortress creatures' abilities as HotA has them
// (heroes.thelazy.net's creature pages; the HotA changelog), with their real ability lists
// (CREATURE_INFO) on a synthetic table of their CRTRAITS numbers.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BattleState,
  type CreatureStats,
  CREATURE_INFO,
  SPELL,
  type SpellInfo,
  activeUnit,
  applyAction,
  attackPositions,
  createBattle,
  effectOf,
  hpOf,
  moraleOf,
  startBattle,
  strike,
} from "../src/index.ts";

/** id: [attack, defense, min, max, hp, speed, shots] */
const NUMBERS: Record<number, number[]> = {
  56: [5, 4, 1, 3, 6, 4, 0], 61: [7, 7, 3, 5, 18, 7, 0], 63: [10, 10, 5, 8, 40, 9, 0], 66: [16, 16, 15, 30, 120, 7, 0],
  68: [17, 15, 25, 50, 150, 9, 0], 69: [19, 17, 25, 50, 200, 14, 0], 70: [4, 3, 1, 3, 5, 4, 0], 73: [6, 6, 1, 4, 14, 9, 0],
  76: [9, 9, 6, 8, 25, 5, 4], 78: [14, 12, 12, 20, 50, 6, 0], 81: [16, 14, 14, 20, 80, 11, 0], 82: [19, 19, 40, 50, 180, 11, 0],
  83: [25, 25, 40, 50, 300, 15, 0], 91: [13, 7, 6, 12, 60, 5, 0], 98: [3, 5, 2, 3, 6, 4, 0], 106: [11, 11, 6, 10, 35, 5, 0],
  109: [14, 14, 18, 22, 70, 11, 0], 12: [20, 20, 50, 50, 200, 12, 0], 59: [5, 5, 2, 3, 20, 4, 0],
};
const TABLE: CreatureStats[] = [];
for (const [id, [attack, defense, minDamage, maxDamage, hp, speed, shots]] of Object.entries(NUMBERS)) {
  const info = CREATURE_INFO[Number(id)];
  TABLE[Number(id)] = {
    id: Number(id), key: info.key, name: info.key, plural: info.key, level: info.level, faction: info.faction, gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp, speed, attack, defense, minDamage, maxDamage, shots,
    abilities: info.abilities.map((a) => ({ ...a })), def: "", missile: "", sound: "",
  };
}
// HotA's Wights and Wraiths regenerate fully (the mod's gameBalance).
for (const id of [61]) for (const a of TABLE[id].abilities) if (a.type === "HP_REGENERATION") a.val = 5000;

const spell = (id: number, key: string, level: number, effect = [0, 0, 0, 0], power = 0): SpellInfo =>
  ({ id, key, name: key, level, schools: ["water"], cost: [5, 5, 5, 5], power, effect, chance: [], text: [] }) as unknown as SpellInfo;
const SPELLS: SpellInfo[] = [];
for (const sp of [
  spell(SPELL.STONE_GAZE, "stoneGaze", 3), spell(SPELL.POISON, "poison", 0), spell(SPELL.DISEASE, "disease", 2), spell(SPELL.PARALYZE, "paralyze", 4),
  spell(SPELL.AGE, "age", 5), spell(SPELL.CURSE, "curse", 1, [0, 0, 1, 1]), spell(SPELL.CURE, "cure", 1, [10, 10, 20, 30], 5),
  spell(SPELL.BLOODLUST, "bloodlust", 1, [3, 3, 6, 6]), spell(SPELL.WEAKNESS, "weakness", 2, [3, 3, 6, 6]),
]) SPELLS[sp.id] = sp;

const ZOMBIE = 59, SKELETON = 56, WRAITH = 61, VAMPIRE_LORD = 63, BLACK_KNIGHT = 66, BONE_DRAGON = 68, GHOST_DRAGON = 69;
const TROGLODYTE = 70, HARPY_HAG = 73, MEDUSA = 76, MINOTAUR = 78, SCORPICORE = 81, RED_DRAGON = 82, BLACK_DRAGON = 83;
const OGRE_MAGE = 91, GNOLL = 98, BASILISK = 106, WYVERN_MONARCH = 109, ANGEL = 12;

function battle(a: [number, number][], b: [number, number][], opts: { mana?: number; cure?: boolean; field?: string } = {}): BattleState {
  const hero = (name: string, owner: number) => ({ name, heroClass: 1, female: false, owner, primary: [0, 0, 1, 5] as [number, number, number, number], spells: opts.cure ? [SPELL.CURE] : [], mana: opts.mana ?? 0 });
  const s = createBattle({ seed: 5, field: opts.field ?? "grass_hills", sides: [
    { name: "A", controller: "human", stacks: a.map(([creature, count]) => ({ creature, count })), hero: hero("A", 0) },
    { name: "B", controller: "human", stacks: b.map(([creature, count]) => ({ creature, count })), hero: hero("B", 1) },
  ] }, TABLE, SPELLS);
  s.obstacles = [];
  s.blocked = [];
  // The first enemy a few hexes off the first stack, in reach.
  s.units.find((u) => u.side === 1)!.pos = s.units[0].pos + 4;
  startBattle(s);
  return s;
}

/** Strikes until the after-attack spell lands (each blow rolls its chance). */
function until(s: BattleState, a: number, d: number, spellId: number, tries = 200): boolean {
  for (let i = 0; i < tries; i++) {
    const t = s.units[d];
    t.count = 50;
    t.firstHp = hpOf(s, t);
    t.effects = [];
    strike(s, s.units[a], t, false, false, 0, []);
    if (effectOf(s.units[d], spellId)) return true;
  }
  return false;
}

test("Undead: no morale either way, and their living allies lose 1", () => {
  const s = battle([[SKELETON, 10], [GNOLL, 10]], [[GNOLL, 10]]);
  assert.equal(moraleOf(s, s.units[0]), 0);
  // Two towns (0), undead in the army (-1).
  assert.equal(moraleOf(s, s.units[1]), -1);
});

test("Bone Dragons: enemy morale -1, not added up, and it holds after they fall", () => {
  const s = battle([[BONE_DRAGON, 1], [GHOST_DRAGON, 1]], [[GNOLL, 10]]);
  const gnoll = s.units[2];
  assert.equal(moraleOf(s, gnoll), 0);
  s.units[0].count = 0;
  s.units[1].count = 0;
  assert.equal(moraleOf(s, gnoll), 0, "one town (+1), the dragons (-1), even dead");
});

test("Minotaurs: morale never below +1 (the dragons, mixed towns), and no Angels' aura for the rest", () => {
  const s = battle([[MINOTAUR, 5], [GNOLL, 5], [SKELETON, 5]], [[BONE_DRAGON, 1]]);
  const [mino, gnoll] = s.units;
  assert.equal(moraleOf(s, mino), 1);
  assert.equal(moraleOf(s, gnoll), -3, "three towns -1, undead -1, dragons -1: the Minotaurs lift nobody");
  // Cursed Ground still holds them at 0.
  const c = battle([[MINOTAUR, 5]], [[GNOLL, 5]], { field: "cursed_ground" });
  assert.equal(moraleOf(c, c.units[0]), 0);
  // Angels still raise their side.
  const g = battle([[ANGEL, 1], [GNOLL, 5]], [[GNOLL, 5]]);
  assert.equal(moraleOf(g, g.units[1]), 1);
});

test("Wraiths drain 2 spell points once a round, not again after waiting", () => {
  const s = battle([[WRAITH, 5]], [[GNOLL, 5]], { mana: 20 });
  const foe = s.sides[1].hero!;
  assert.equal(activeUnit(s)!.creature, WRAITH);
  assert.equal(foe.mana, 18);
  applyAction(s, { type: "wait", unit: 0 });
  applyAction(s, { type: "defend", unit: 1 });
  assert.equal(activeUnit(s)!.creature, WRAITH);
  assert.equal(foe.mana, 18, "the waited Wraiths' second turn drains nothing");
});

test("Wraiths regenerate fully at the round's start", () => {
  const s = battle([[WRAITH, 5]], [[GNOLL, 5]]);
  const w = s.units[0];
  w.firstHp = 1;
  applyAction(s, { type: "defend", unit: 0 });
  applyAction(s, { type: "defend", unit: 1 });
  assert.equal(w.firstHp, 18);
});

test("Zombies' disease: -2 Attack and Defense for 3 rounds; Red Dragons (level 1-3 immune) shrug it off", () => {
  const s = battle([[ZOMBIE, 50]], [[GNOLL, 50]]);
  assert.ok(until(s, 0, 1, SPELL.DISEASE));
  const e = effectOf(s.units[1], SPELL.DISEASE)!;
  assert.equal(e.value, 2);
  assert.equal(e.rounds, 3);
  const r = battle([[ZOMBIE, 50]], [[RED_DRAGON, 50]]);
  assert.ok(!until(r, 0, 1, SPELL.DISEASE));
});

test("Black Knights' curse is Advanced (the minimum less 20%), not on undead or Red Dragons", () => {
  const s = battle([[BLACK_KNIGHT, 5]], [[GNOLL, 50]]);
  assert.ok(until(s, 0, 1, SPELL.CURSE));
  const e = effectOf(s.units[1], SPELL.CURSE)!;
  assert.ok(e.value > 0 && e.mastery === 2, "advanced");
  assert.equal(e.rounds, 3);
  assert.ok(!until(battle([[BLACK_KNIGHT, 5]], [[RED_DRAGON, 5]]), 0, 1, SPELL.CURSE));
  assert.ok(!until(battle([[BLACK_KNIGHT, 5]], [[SKELETON, 5]]), 0, 1, SPELL.CURSE));
});

test("Vampire Lords: drain (only from the living, not from clones), and no retaliation", () => {
  const s = battle([[VAMPIRE_LORD, 10]], [[GNOLL, 100]]);
  const [v, g] = s.units;
  v.count = 5;
  v.firstHp = 40;
  s.active = v.id;
  const from = attackPositions(s, v, g)[0];
  const before = g.count;
  const events = applyAction(s, { type: "attack", unit: v.id, target: g.id, from });
  assert.ok(v.count > 5, "drained back to life");
  assert.ok(!events.some((e) => e.e === "attack" && e.retaliation), "no retaliation");
  assert.ok(g.count < before);
  const c = battle([[VAMPIRE_LORD, 10]], [[GNOLL, 100]]);
  c.units[0].count = 5;
  c.units[1].clone = true;
  strike(c, c.units[0], c.units[1], false, false, 0, []);
  assert.equal(c.units[0].count, 5, "nothing from a clone");
});

test("Ghost Dragons' aging: health halved rounded up, the top creature keeps its wounds; Black Dragons immune", () => {
  const s = battle([[GHOST_DRAGON, 1]], [[ANGEL, 1]]);
  const angel = s.units[1];
  angel.firstHp = 140;
  const was = hpOf(s, angel);
  angel.effects = [{ spell: SPELL.AGE, rounds: 3, mastery: 1, value: 50 }];
  assert.equal(hpOf(s, angel), 100);
  angel.effects = [];
  assert.equal(was, 200);
  // Through the ability: 140 of 200 left -> 40 of 100 (heroes.thelazy.net's example).
  for (let i = 0; i < 500 && !effectOf(angel, SPELL.AGE); i++) {
    angel.count = 1;
    angel.firstHp = 200;
    const blow = strike;
    s.units[0].count = 1;
    blow(s, s.units[0], angel, false, false, 0, []);
    if (effectOf(angel, SPELL.AGE)) {
      // whatever the blow left, aging took 100 more (but never the last point)
      assert.ok(angel.firstHp <= 100 && angel.firstHp >= 1);
    }
  }
  assert.ok(effectOf(angel, SPELL.AGE));
  const odd = battle([[GHOST_DRAGON, 1]], [[MEDUSA, 1]]);
  odd.units[1].effects = [{ spell: SPELL.AGE, rounds: 3, mastery: 1, value: 50 }];
  assert.equal(hpOf(odd, odd.units[1]), 13, "25 halved, rounded up");
  assert.ok(!until(battle([[GHOST_DRAGON, 5]], [[BLACK_DRAGON, 50]]), 0, 1, SPELL.AGE));
});

test("Wyvern Monarchs' poison: 10% at once, +10% for two rounds, lost for good; again up to half; Cure ends it", () => {
  const s = battle([[WYVERN_MONARCH, 5]], [[GNOLL, 50]], { cure: true, mana: 50 });
  const g = s.units[1];
  assert.ok(until(s, 0, 1, SPELL.POISON));
  g.firstHp = 6;
  const hp = () => hpOf(s, g);
  assert.equal(hp(), 6, "6 x 0.9 rounded up");
  for (let r = 0; r < 4; r++) {
    applyAction(s, { type: "defend", unit: activeUnit(s)!.id });
    applyAction(s, { type: "defend", unit: activeUnit(s)!.id });
  }
  assert.equal(effectOf(g, SPELL.POISON)!.value, 30, "three tenths, and it stays");
  assert.equal(hp(), 5);
  // Poisoned again: up to half.
  for (let i = 0; i < 3; i++) strikeUntilPoison(s);
  assert.equal(effectOf(g, SPELL.POISON)!.value, 50);
  assert.equal(hp(), 3);
  // A Cure takes it away.
  s.active = g.id;
  applyAction(s, { type: "cast", unit: g.id, spell: SPELL.CURE, target: g.pos });
  assert.equal(effectOf(g, SPELL.POISON), undefined);
  assert.equal(hpOf(s, g), 6);

  function strikeUntilPoison(b: BattleState) {
    const before = effectOf(b.units[1], SPELL.POISON)!.value;
    for (let i = 0; i < 200 && effectOf(b.units[1], SPELL.POISON)!.value === before && before < 50; i++) {
      b.units[1].count = 50;
      strike(b, b.units[0], b.units[1], false, false, 0, []);
    }
  }
});

test("Medusas' and Basilisks' stone gaze: on undead too, not on Troglodytes or Red Dragons (level 3)", () => {
  assert.ok(until(battle([[BASILISK, 10]], [[SKELETON, 50]]), 0, 1, SPELL.STONE_GAZE));
  assert.ok(until(battle([[MEDUSA, 10]], [[GNOLL, 50]]), 0, 1, SPELL.STONE_GAZE));
  assert.ok(!until(battle([[MEDUSA, 10]], [[TROGLODYTE, 50]]), 0, 1, SPELL.STONE_GAZE));
  assert.ok(!until(battle([[BASILISK, 10]], [[RED_DRAGON, 50]]), 0, 1, SPELL.STONE_GAZE));
  // Not by shots.
  const s = battle([[MEDUSA, 10]], [[GNOLL, 50]]);
  for (let i = 0; i < 100; i++) strike(s, s.units[0], s.units[1], true, false, 0, []);
  assert.equal(effectOf(s.units[1], SPELL.STONE_GAZE), undefined);
});

test("Scorpicores' paralysis: on undead too, not on Black Dragons; the paralysed answer an attack at a quarter", () => {
  assert.ok(until(battle([[SCORPICORE, 10]], [[SKELETON, 50]]), 0, 1, SPELL.PARALYZE));
  assert.ok(!until(battle([[SCORPICORE, 10]], [[BLACK_DRAGON, 50]]), 0, 1, SPELL.PARALYZE));
  const damageBack = (paralysed: boolean) => {
    const s = battle([[GNOLL, 10]], [[GNOLL, 100]]);
    const [a, d] = s.units;
    if (paralysed) d.effects = [{ spell: SPELL.PARALYZE, rounds: 3, mastery: 1, value: 0 }];
    s.active = a.id;
    const events = applyAction(s, { type: "attack", unit: a.id, target: d.id, from: attackPositions(s, a, d)[0] });
    const back = events.find((e) => e.e === "attack" && e.retaliation);
    return back && back.e === "attack" ? back.damage : 0;
  };
  const full = damageBack(false);
  const weak = damageBack(true);
  assert.ok(weak > 0 && weak <= Math.ceil(full / 4) + 1, `${weak} vs ${full}`);
});

test("Harpy Hags: strike and return, or (HotA's alternate action) strike and stay", () => {
  for (const stay of [false, true]) {
    const s = battle([[HARPY_HAG, 10]], [[GNOLL, 10]]);
    const [h, g] = s.units;
    const start = h.pos;
    s.active = h.id;
    const from = attackPositions(s, h, g)[0];
    applyAction(s, { type: "attack", unit: h.id, target: g.id, from, stay });
    assert.equal(h.pos, stay ? from : start);
  }
});

test("Ogre Magi: Bloodlust at advanced (+6) for 6 rounds", () => {
  const s = battle([[OGRE_MAGE, 5], [GNOLL, 5]], [[GNOLL, 5]]);
  const [o, g] = s.units;
  s.active = o.id;
  applyAction(s, { type: "creatureCast", unit: o.id, target: g.pos });
  const e = effectOf(g, SPELL.BLOODLUST)!;
  assert.equal(e.value, 6);
  assert.equal(e.rounds, 6);
});

test("A stack petrified by the retaliation gets no morale turn (HotA)", () => {
  const s = battle([[MINOTAUR, 10]], [[MEDUSA, 50]]);
  const [m, med] = s.units;
  let tried = 0;
  for (let i = 0; i < 300; i++) {
    const t = battle([[MINOTAUR, 10]], [[MEDUSA, 50]]);
    t.rng = (i * 7919 + 1) >>> 0;
    const [mm, md] = t.units;
    t.active = mm.id;
    const events = applyAction(t, { type: "attack", unit: mm.id, target: md.id, from: attackPositions(t, mm, md)[0] });
    if (effectOf(mm, SPELL.STONE_GAZE)) {
      tried++;
      assert.ok(!events.some((e) => e.e === "morale" && e.good), "no morale turn while stone");
    }
  }
  assert.ok(tried > 0);
  assert.ok(m && med);
});
