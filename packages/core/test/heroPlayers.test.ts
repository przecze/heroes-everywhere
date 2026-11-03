// A map's hero settings may let only some players have a hero (Battle of the Sexes: each side its own).
import assert from "node:assert/strict";
import { test } from "node:test";
import { heroFor, randomHeroOf } from "../src/adventure/create.ts";

test("hero settings: a hero only some players may have", () => {
  const s = { rng: 7, heroPlayers: { 0: 0b10, 1: 0b01 } };
  assert.equal(heroFor(s, 0, 0), false);
  assert.equal(heroFor(s, 0, 1), true);
  assert.equal(heroFor(s, 1, 0), true);
  assert.equal(heroFor(s, 5, 0), true, "a hero the map says nothing about");
  // Only heroes 0 and 1 not taken: player 0 gets 1, player 1 gets 0, every time.
  const taken = new Set(Array.from({ length: 300 }, (_, i) => i).filter((i) => i > 1));
  for (let i = 0; i < 20; i++) {
    assert.equal(randomHeroOf({ ...s, rng: i + 1 }, undefined, taken, 0), 1);
    assert.equal(randomHeroOf({ ...s, rng: i + 1 }, undefined, taken, 1), 0);
  }
});
