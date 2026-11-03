// The Horn of the Abyss: Fangarms rise from slain living stacks, on either side, for its wearer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type BattleState, type CreatureStats, FANGARM, checkEnd, createBattle, startBattle, takeDamage, totalHp } from "../src/index.ts";

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "castle", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 10, speed: 5, attack: 5, defense: 5, minDamage: 2, maxDamage: 2,
    shots: 0, abilities: [], def: "", missile: "", sound: "", ...over,
  };
}

const TABLE: CreatureStats[] = [creature(0), creature(1, { abilities: [{ type: "UNDEAD" }] }), creature(2, { hp: 200 })];
TABLE[FANGARM] = creature(FANGARM, { name: "Fangarm", plural: "Fangarms", hp: 50, abilities: [{ type: "FLYING" }] });

function battle(horn: boolean, a: [number, number][], b: [number, number][]): BattleState {
  const s = createBattle(
    {
      seed: 1,
      field: "grass_hills",
      sides: [
        {
          name: "A", controller: "ai", stacks: a.map(([creature, count]) => ({ creature, count })),
          hero: { name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 1, 1], bonuses: horn ? [{ type: "RAISE_FANGARMS", artifact: 161 }] : [] },
        },
        { name: "B", controller: "ai", stacks: b.map(([creature, count]) => ({ creature, count })) },
      ],
    },
    TABLE,
  );
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  return s;
}

const kill = (s: BattleState, id: number) => {
  takeDamage(s, s.units[id], totalHp(s, s.units[id]));
  return checkEnd(s, []);
};

test("a slain living stack raises Fangarms for the Horn's wearer: half its health, at most half its number", () => {
  const s = battle(true, [[0, 5]], [[0, 40], [2, 10], [1, 30], [0, 1]]);
  const [, peasants, giants, undead] = s.units;
  kill(s, peasants.id);
  let risen = s.units.filter((u) => u.creature === FANGARM);
  // 40 x 10 health = 400; half is 200, four Fangarms of 50 (and no more than 20).
  assert.equal(risen.length, 1);
  assert.equal(risen[0].count, 4);
  assert.equal(risen[0].side, 0);
  assert.ok(risen[0].raised);
  // 10 x 200 = 2000: half is 20 Fangarms, but no more than half of 10.
  kill(s, giants.id);
  risen = s.units.filter((u) => u.creature === FANGARM);
  assert.equal(risen[1].count, 5);
  // The undead raise nothing; nor do slain Fangarms.
  kill(s, undead.id);
  kill(s, risen[0].id);
  assert.equal(s.units.filter((u) => u.creature === FANGARM).length, 2);
});

test("the wearer's own fallen rise too, and keep the battle going", () => {
  const s = battle(true, [[0, 40]], [[0, 5]]);
  const ended = kill(s, s.units[0].id);
  assert.equal(ended, false);
  assert.equal(s.winner, null);
  assert.equal(s.units.find((u) => u.creature === FANGARM)?.side, 0);
});

test("without the Horn nothing rises", () => {
  const s = battle(false, [[0, 5]], [[0, 40], [0, 5]]);
  kill(s, s.units[1].id);
  assert.ok(!s.units.some((u) => u.creature === FANGARM));
});
