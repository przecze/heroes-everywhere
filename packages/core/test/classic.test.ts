// The original game's numbers (SoD / HotA), checked where they are well known.
import assert from "node:assert/strict";
import { test } from "node:test";
import { experienceForLevel } from "../src/index.ts";

test("experience per level: the table to level 12, then each step 20% longer than the one before", () => {
  const want = [0, 1000, 2000, 3200, 4600, 6200, 8000, 10000, 12200, 14700, 17500, 20600, 24320, 28784, 34140, 40567, 48279, 57533, 68637];
  assert.deepEqual(want.map((_, i) => experienceForLevel(i + 1)), want);
});
