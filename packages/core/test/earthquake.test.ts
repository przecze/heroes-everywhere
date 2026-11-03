// Earthquake's lottery (heroes.thelazy.net Fortifications, Earthquake).
import assert from "node:assert/strict";
import { test } from "node:test";
import { earthquakeHits } from "../src/battle/siege.ts";

/** A die that comes up with these fractions, in turn. */
const die = (...xs: number[]) => () => xs.shift()!;

test("Earthquake: points drawn in a fixed order, the Keep drops out once a target is doomed, points can be wasted", () => {
  // A Castle: towers 2, walls 3, gate 2, keep 2. Eight targets: index k of 8 is order[k].
  const castle = { upperTower: 2, upperWall: 3, overGate: 3, gate: 2, belowGate: 3, bottomWall: 3, bottomTower: 2, keep: 2 } as const;
  assert.deepEqual(earthquakeHits({ ...castle }, 2, die(0, 7 / 8)), ["upperTower", "keep"]);
  // Two points on the upper tower doom it: only 7 still open, so the last draw can't reach the Keep (index 6 of 7 is the lower tower).
  assert.deepEqual(earthquakeHits({ ...castle }, 3, die(0, 0, 0.99)), ["upperTower", "upperTower", "bottomTower"]);
  // A third point on the doomed tower is wasted.
  assert.deepEqual(earthquakeHits({ ...castle }, 3, die(0, 0, 0)), ["upperTower", "upperTower"]);
  // A Fort: the Keep and towers aren't built but still draw points, which are lost.
  const fort = { gate: 2, upperWall: 2, overGate: 2, belowGate: 2, bottomWall: 2 };
  assert.deepEqual(earthquakeHits({ ...fort }, 2, die(0, 7 / 8)), []);
  assert.deepEqual(earthquakeHits({ ...fort }, 2, die(1 / 8, 3 / 8)), ["upperWall", "gate"]);
  // Fallen parts are out of the lottery.
  assert.deepEqual(earthquakeHits({ ...castle, upperTower: 0 }, 1, die(0)), ["upperWall"]);
});
