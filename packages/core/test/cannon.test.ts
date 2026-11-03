// HotA's Cannon: 4-7 x (hero's attack + 1) per shot (Advanced Artillery x2, Expert x3), it shoots at the
// walls too, and like the other machines it loses at most 40% of its health to one blow.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SKILLS, type BattleState, type CreatureStats, applyAction, canShootWalls, createBattle, hexAt, startBattle, logTexts, takeDamage, totalHp } from "../src/index.ts";

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "neutral", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 10, speed: 5, attack: 5, defense: 5, minDamage: 2, maxDamage: 2,
    shots: 0, abilities: [], def: "", missile: "", sound: "", ...over,
  };
}

const TABLE: CreatureStats[] = [creature(0, { hp: 1000 })];
TABLE[145] = creature(145, { key: "catapult", hp: 1000, speed: 0, abilities: [{ type: "DOUBLE_WIDE" }, { type: "SHOOTER" }], shots: 24 });
TABLE[149] = creature(149, { key: "arrowTower", hp: 1000, speed: 0, abilities: [{ type: "SHOOTER" }], shots: 99 });
TABLE[150] = creature(150, { key: "cannon", hp: 600, speed: 0, minDamage: 4, maxDamage: 7, shots: 99, abilities: [{ type: "DOUBLE_WIDE" }, { type: "SHOOTER" }] });

function battle(seed: number, artillery: number, siege = false): BattleState {
  const skills: [number, number][] = artillery ? [[SKILLS.indexOf("artillery"), artillery]] : [];
  const s = createBattle(
    {
      seed,
      ...(siege ? { siege: { faction: "castle", level: 1, structures: 10 } } : { field: "grass_hills" }),
      sides: [
        { name: "A", controller: "human", stacks: [{ creature: 0, count: 1 }], hero: { name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 1, 1], machines: [146], skills } },
        { name: "B", controller: "human", stacks: [{ creature: 0, count: 10 }] },
      ],
    },
    TABLE,
  );
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  return s;
}

function shot(seed: number, artillery: number): number {
  const s = battle(seed, artillery);
  const cannon = s.units.find((u) => u.machine === "cannon")!;
  const foe = s.units.find((u) => u.side === 1 && !u.machine)!;
  foe.pos = hexAt(5, 3); // within ten hexes: no range penalty
  s.active = cannon.id;
  const before = totalHp(s, foe);
  applyAction(s, { type: "shoot", unit: cannon.id, target: foe.id });
  return before - totalHp(s, foe);
}

test("the Cannon rolls 4-7 (hero attack 0, equal attack and defence); Advanced Artillery doubles, Expert triples", () => {
  for (const [level, k] of [[0, 1], [1, 1], [2, 2], [3, 3]]) {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const d = shot(seed, level);
      assert.ok(d >= 4 * k && d <= 7 * k && d % k === 0, `artillery ${level}: ${d}`);
      seen.add(d);
    }
    assert.ok(seen.size >= 3, "the roll varies");
  }
});

test("the Cannon shoots at the walls when attacking, once a turn; it loses at most 40% to one blow", () => {
  const s = battle(5, 0, true);
  const cannon = s.units.find((u) => u.machine === "cannon")!;
  assert.ok(canShootWalls(s, cannon));
  const shots = cannon.shots;
  s.active = cannon.id;
  const before = s.log.length;
  applyAction(s, { type: "catapult", unit: cannon.id, target: "gate" });
  assert.equal(logTexts(s).slice(before).filter((l) => /The cannon/.test(l)).length, 1, "one ball");
  assert.equal(cannon.shots, shots - 1);
  takeDamage(s, cannon, 100000);
  assert.equal(cannon.firstHp, 600 - 240);
});

test("HotA's Ballista rolls (2-3) x (hero attack + 5), not the Shadow of Death + 1", () => {
  const TB: CreatureStats[] = [creature(0, { hp: 1000 })];
  TB[146] = creature(146, { key: "ballista", hp: 250, speed: 0, minDamage: 2, maxDamage: 3, shots: 24, abilities: [{ type: "DOUBLE_WIDE" }, { type: "SHOOTER" }] });
  function shot(seed: number, attack: number): number {
    const s = createBattle({ seed, field: "grass_hills", sides: [
      { name: "A", controller: "human", stacks: [{ creature: 0, count: 1 }], hero: { name: "H", heroClass: 0, female: false, owner: 0, primary: [attack, 0, 1, 1], machines: [4] } },
      { name: "B", controller: "human", stacks: [{ creature: 0, count: 10 }] } ] }, TB);
    s.obstacles = []; s.blocked = []; startBattle(s);
    const b = s.units.find((u) => u.machine === "ballista")!;
    const f = s.units.find((u) => u.side === 1 && !u.machine)!;
    f.pos = hexAt(5, 3); // within ten hexes, equal attack/defence
    s.active = b.id;
    const before = totalHp(s, f);
    applyAction(s, { type: "shoot", unit: b.id, target: f.id });
    return before - totalHp(s, f);
  }
  // Attack 0: (2-3) x 5 = 10..15. The SoD formula (+1) would give only 2..3.
  for (let seed = 1; seed <= 40; seed++) {
    const d = shot(seed, 0);
    assert.ok(d >= 10 && d <= 15, `attack 0: ${d}`);
  }
  // Every roll clears the Shadow of Death ceiling (attack 0 there would be only 2..3).
});
