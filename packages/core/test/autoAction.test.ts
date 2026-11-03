// Auto combat from the player's screen (battle/view.ts): the AI picks the human side's actions one at
// a time, so the player can take over again at any turn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type CreatureStats, applyAction, autoAction, createBattle, startBattle, activeUnit, controlSide } from "../src/index.ts";

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "neutral", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 10, speed: 7, attack: 5, defense: 5, minDamage: 2, maxDamage: 2,
    shots: 0, abilities: [], def: "", missile: "", sound: "", ...over,
  };
}
const TABLE = [creature(0), creature(1, { shots: 10, abilities: [{ type: "SHOOTER" }] })];

test("auto combat: legal actions for the human side, the state left alone, a whole battle played out", () => {
  const s = createBattle({ seed: 3, field: "grass_hills", sides: [
    { name: "A", controller: "human", stacks: [{ creature: 0, count: 20 }, { creature: 1, count: 10 }] },
    { name: "B", controller: "human", stacks: [{ creature: 0, count: 10 }] },
  ] }, TABLE, []);
  startBattle(s);
  const before = JSON.stringify(s);
  const a = autoAction(s);
  assert.ok(a);
  assert.equal(JSON.stringify(s), before, "nothing changed by choosing");
  assert.equal(s.sides[0].controller, "human");
  let n = 0;
  while (s.winner === null && n++ < 500) {
    const u = activeUnit(s);
    assert.ok(u);
    const next = autoAction(s);
    assert.ok(next, "an action every turn");
    assert.equal(controlSide(s.units[next.unit] ?? u), controlSide(u));
    applyAction(s, next);
  }
  assert.notEqual(s.winner, null, "the battle ends");
});
