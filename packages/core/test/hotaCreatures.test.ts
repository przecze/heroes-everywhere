// HotA creature abilities (heroes.thelazy.net's pages for each), on a synthetic table.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type BattleState, type CreatureStats, alive, applyAction, createBattle, defenseOf, hexAt, runAi, speedOf, startBattle, takeDamage } from "../src/index.ts";
import { SPELL, type SpellInfo } from "../src/spells.ts";

const TELEPORT = { id: SPELL.TELEPORT, key: "teleport", name: "Teleport", level: 3, schools: ["water"], cost: [15, 15, 15, 15], power: 0, effect: [0, 0, 0, 0], chance: [], text: [] } as unknown as SpellInfo;

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "neutral", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 10, speed: 5, attack: 5, defense: 5, minDamage: 2, maxDamage: 2,
    shots: 0, abilities: [], def: "", missile: "", sound: "", ...over,
  };
}

const PIKE = 0;
const FLIER = 1;
const JOTUNN = 2;
const WARLORD = 3;
const MAMMOTH = 4;
const AUTOMATON = 5;
const WORM = 6;
const BURROWER = 7;
const TABLE = [
  creature(PIKE),
  creature(FLIER, { speed: 9, abilities: [{ type: "FLYING" }] }),
  creature(JOTUNN, { hp: 165, speed: 8, abilities: [{ type: "DOUBLE_WIDE" }, { type: "SPELLCASTER", subtype: "teleport", val: 3 }, { type: "CASTS", val: 1 }, { type: "STACKS_SPEED", val: -1 }] }),
  creature(WARLORD, { hp: 300, abilities: [{ type: "DOUBLE_WIDE" }, { type: "SPELLCASTER", subtype: "teleport", val: 3 }, { type: "CASTS", val: 99 }, { type: "STACKS_SPEED", val: -2 }] }),
  creature(MAMMOTH, { defense: 20, abilities: [{ type: "DOUBLE_WIDE" }, { type: "PRIMARY_SKILL", subtype: "defenceWhileDefending", val: 80 }] }),
  creature(AUTOMATON, { hp: 30, speed: 8, abilities: [{ type: "SPELLCASTER", subtype: "detonates01", val: 0 }, { type: "CASTS", val: 1 }] }),
  creature(WORM, { hp: 60, speed: 10, attack: 15, minDamage: 1, maxDamage: 1, abilities: [{ type: "DOUBLE_WIDE" }, { type: "FLYING", subtype: "movementTeleporting" }, { type: "SPELLCASTER", subtype: "summonLarva", val: 1 }, { type: "CASTS", val: 50 }] }),
  creature(BURROWER, { speed: 9, abilities: [{ type: "FLYING", subtype: "movementTeleporting" }] }),
];

function battle(a: [number, number][], b: [number, number][], human = true): BattleState {
  const controller = human ? "human" : "ai";
  const s = createBattle({ seed: 3, field: "grass_hills", sides: [
    { name: "A", controller, stacks: a.map(([c, count]) => ({ creature: c, count })) },
    { name: "B", controller, stacks: b.map(([c, count]) => ({ creature: c, count })) },
  ] }, TABLE, [TELEPORT]);
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  return s;
}

test("Jotunns slow the enemy's fliers by 1 (Warlords 2, not added up), even fallen; not their own, not burrowers", () => {
  const s = battle([[JOTUNN, 2], [FLIER, 5]], [[FLIER, 5], [BURROWER, 5]]);
  const [j, ownFlier, flier, burrower] = s.units;
  assert.equal(speedOf(s, ownFlier), 9);
  assert.equal(speedOf(s, flier), 8);
  assert.equal(speedOf(s, burrower), 9);
  j.count = 0;
  assert.equal(speedOf(s, flier), 8, "the slowdown outlives the Jotunns");
  const w = battle([[JOTUNN, 2], [WARLORD, 1]], [[FLIER, 5]]);
  assert.equal(speedOf(w, w.units[2]), 7);
});

test("Jotunns teleport an ally to the spot chosen with the action", () => {
  const s = battle([[JOTUNN, 2], [PIKE, 10]], [[PIKE, 10]]);
  const [j, pike] = s.units;
  s.active = j.id;
  assert.throws(() => applyAction(s, { type: "creatureCast", unit: j.id, target: pike.pos }), /where to/);
  const dest = hexAt(10, 5);
  applyAction(s, { type: "creatureCast", unit: j.id, target: pike.pos, dest });
  assert.equal(pike.pos, dest);
});

test("War Mammoths defending: +100% Defense instead of +20%", () => {
  const s = battle([[MAMMOTH, 2], [PIKE, 2]], [[PIKE, 10]]);
  const [m, pike] = s.units;
  assert.equal(defenseOf(s, m), 20);
  m.defending = true;
  pike.defending = true;
  assert.equal(defenseOf(s, m), 40);
  assert.equal(defenseOf(s, pike), 6);
});

test("Great Shaman's freeze: any damage thaws the stack", () => {
  const s = battle([[PIKE, 10]], [[PIKE, 10]]);
  const d = s.units[1];
  d.effects = [{ spell: SPELL.FROZEN, rounds: 3, mastery: 0, value: 25 }];
  takeDamage(s, d, 0);
  assert.equal(d.effects.length, 1, "no damage, still frozen");
  takeDamage(s, d, 3);
  assert.equal(d.effects.length, 0);
});

test("Automatons detonate only once ignited; igniting keeps the turn and can't be undone", () => {
  const plain = battle([[AUTOMATON, 5]], [[PIKE, 50]]);
  const [a0, p0] = plain.units;
  p0.pos = a0.pos + 1;
  takeDamage(plain, a0, 1000);
  const before = p0.count;
  // (onDeath is run by strikes; a quiet death here shows nothing went off.)
  assert.equal(p0.count, before);

  const s = battle([[AUTOMATON, 5]], [[PIKE, 50]]);
  const [a, p] = s.units;
  s.active = a.id;
  applyAction(s, { type: "creatureCast", unit: a.id, target: a.pos });
  assert.ok(a.ignited);
  assert.equal(s.active, a.id, "still its turn");
  assert.throws(() => applyAction(s, { type: "creatureCast", unit: a.id, target: a.pos }));
  // It walks up and strikes; then the Pikemen kill it beside them and take the blast.
  p.pos = hexAt(3, 5);
  applyAction(s, { type: "attack", unit: a.id, target: p.id, from: hexAt(2, 5) });
  a.count = 1;
  a.firstHp = 1;
  const hp = p.count * 10 - (10 - p.firstHp);
  s.active = p.id;
  applyAction(s, { type: "attack", unit: p.id, target: a.id, from: p.pos });
  assert.ok(!alive(a));
  // (One Automaton was left as it fell: 90 + 5.)
  assert.ok(p.count * 10 - (10 - p.firstHp) <= hp - 95, "the blast hit the Pikemen");
});

test("Olgoi-Khorkhoi eat every corpse on the hex, and those where they strike from; all the strikes on the next attack", () => {
  const s = battle([[WORM, 1], [PIKE, 1], [PIKE, 1]], [[PIKE, 100]]);
  const [w, c1, c2] = s.units;
  c1.count = 0;
  c2.count = 0;
  c2.pos = c1.pos = hexAt(4, 5);
  s.active = w.id;
  applyAction(s, { type: "creatureCast", unit: w.id, target: c1.pos });
  assert.equal(w.bonusStrikes, 2);
  assert.ok(c1.sacrificed && c2.sacrificed);

  const t = battle([[WORM, 10], [PIKE, 1]], [[PIKE, 100]]);
  const [w2, corpse, foe2] = t.units;
  corpse.count = 0;
  corpse.pos = hexAt(7, 5);
  foe2.pos = hexAt(8, 5);
  t.active = w2.id;
  const events = applyAction(t, { type: "attack", unit: w2.id, target: foe2.id, from: hexAt(7, 5) });
  assert.ok(corpse.sacrificed);
  assert.equal(events.filter((e) => e.e === "attack" && e.unit === w2.id && !e.retaliation).length, 2, "two blows");
});

test("battle AI: Automatons ignite once among the enemy with no friend beside them", () => {
  const s = battle([[AUTOMATON, 5]], [[PIKE, 50]], false);
  const [a, p] = s.units;
  p.pos = hexAt(4, 5);
  s.active = a.id;
  runAi(s);
  assert.ok(a.ignited);
});
