import { test } from "node:test";
import assert from "node:assert/strict";
import { calendar, dateLine } from "../src/index.ts";

test("the calendar: four weeks of seven days a month", () => {
  assert.deepEqual(calendar(1), { month: 1, week: 1, day: 1 });
  assert.deepEqual(calendar(8), { month: 1, week: 2, day: 1 });
  assert.deepEqual(calendar(28), { month: 1, week: 4, day: 7 });
  assert.deepEqual(calendar(29), { month: 2, week: 1, day: 1 });
  assert.equal(dateLine(10), "Month 1, Week 2, Day 3");
  assert.equal(dateLine(10, ": "), "Month: 1, Week: 2, Day: 3");
});

test("a player without a town has a week to take one", async () => {
  const { daysToTakeTown, TOWNLESS_DAYS } = await import("../src/index.ts");
  assert.equal(TOWNLESS_DAYS, 7);
  assert.equal(daysToTakeTown({}, 10), 0);
  assert.equal(daysToTakeTown({ townlessSince: 10 }, 10), 7);
  assert.equal(daysToTakeTown({ townlessSince: 10 }, 16), 1);
  assert.equal(daysToTakeTown({ townlessSince: 10 }, 17), 0);
});
