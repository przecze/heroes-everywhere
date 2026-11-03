// The hover preview's damage range (expectedDamage) and the blow itself (rollDamage) are written apart: this keeps
// them one rule. Every rolled blow must land inside the range the player was shown, over many random setups.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type BattleHero, type BattleState, type CreatureStats, SKILLS, SPELL, createBattle, expectedDamage, rollDamage, startBattle } from "../src/index.ts";

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "castle", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 10, speed: 5, attack: 5, defense: 5, minDamage: 2, maxDamage: 2,
    shots: 0, abilities: [], def: "", missile: "", sound: "", ...over,
  };
}

// A small deterministic generator for the setups (the battle's own random numbers roll the blows).
let seed = 12345;
const rnd = (lo: number, hi: number) => {
  seed = (Math.imul(seed, 1103515245) + 12345) | 0;
  return lo + (((seed >>> 8) & 0xffff) % (hi - lo + 1));
};

function setup(k: number): { s: BattleState; a: number; d: number; ranged: boolean } {
  const min = rnd(1, 20);
  const list = [
    creature(0, { attack: rnd(0, 30), defense: rnd(0, 30), minDamage: min, maxDamage: min + rnd(0, 25), level: rnd(1, 7), abilities: k % 3 === 0 ? [{ type: "SHOOTER" }] : [], shots: k % 3 === 0 ? 10 : 0 }),
    creature(1, { attack: rnd(0, 30), defense: rnd(0, 30) }),
    creature(146, { minDamage: 2, maxDamage: 3, attack: 10, defense: 10, hp: 250 }),
    creature(150, { minDamage: 4, maxDamage: 7, attack: 10, defense: 10, hp: 300 }),
  ];
  const table: CreatureStats[] = [];
  for (const c of list) table[c.id] = c;
  const art = rnd(0, 3);
  const hero: BattleHero = {
    name: "H", heroClass: 0, female: false, owner: 0, primary: [rnd(0, 20), rnd(0, 20), 1, 1],
    skills: art ? [[SKILLS.indexOf("artillery"), art]] : [],
    machines: k % 4 === 1 ? [4] : k % 4 === 2 ? [146] : [],
  };
  const s = createBattle(
    { seed: k + 1, field: "grass_hills", sides: [{ name: "A", controller: "ai", stacks: [{ creature: 0, count: rnd(1, 300) }], hero }, { name: "B", controller: "ai", stacks: [{ creature: 1, count: rnd(1, 300) }] }] },
    table,
  );
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  const attacker = s.units.find((u) => u.side === 0 && (k % 4 === 1 ? u.machine === "ballista" : k % 4 === 2 ? u.machine === "cannon" : !u.machine))!;
  const target = s.units.find((u) => u.side === 1 && !u.machine)!;
  // Bless or Curse (basic or advanced) on some creature stacks.
  if (!attacker.machine && k % 5 === 1) attacker.effects = [{ spell: SPELL.BLESS, rounds: 3, mastery: 1, value: rnd(0, 1) }];
  if (!attacker.machine && k % 5 === 2) attacker.effects = [{ spell: SPELL.CURSE, rounds: 3, mastery: 1, value: rnd(0, 1) }];
  return { s, a: attacker.id, d: target.id, ranged: !!attacker.machine || k % 3 === 0 };
}

test("every blow lands inside the damage range the preview shows (creatures, Bless, Curse, Ballista, Cannon, Artillery)", () => {
  let checked = 0;
  for (let k = 0; k < 400; k++) {
    const { s, a, d, ranged } = setup(k);
    const shown = expectedDamage(s, s.units[a], s.units[d], ranged);
    for (let roll = 0; roll < 25; roll++) {
      const dmg = rollDamage(s, s.units[a], s.units[d], ranged, 0, false);
      assert.ok(dmg >= shown.min && dmg <= shown.max, `setup ${k} (${s.units[a].machine ?? "creature"}): rolled ${dmg}, shown ${shown.min}-${shown.max}`);
      checked++;
    }
  }
  assert.equal(checked, 10000);
});
