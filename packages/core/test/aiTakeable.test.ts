// A town's troops count for a hero only as far as it can take them (a hero with seven kinds of its own takes only its kinds).
import assert from "node:assert/strict";
import { test } from "node:test";
import { takeable } from "../src/adventure/aiPlaces.ts";

const stack = (creature: number, count = 10) => ({ creature, count });
test("a full army takes only its own kinds from a garrison", () => {
  const h = { army: [1, 2, 3, 4, 5, 6, 7].map((c) => stack(c)) } as never;
  assert.deepEqual(takeable(h, [stack(8), stack(3), null, stack(9)]), [stack(3)]);
});
test("free slots take new kinds in slot order, as takeGarrison does", () => {
  const h = { army: [stack(1), null, null, null, null, null, stack(2)] } as never;
  assert.deepEqual(takeable(h, [stack(5), stack(1), stack(6), stack(7), stack(8), stack(9), stack(10)]).map((s) => s.creature), [5, 1, 6, 7, 8, 9]);
});
