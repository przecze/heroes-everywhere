// The Advanced Options' handicap: Mild 15%, Severe 30% off starting resources and each day's income.
import assert from "node:assert/strict";
import { test } from "node:test";
import { World, buildGameData, createAdventure, dailyIncome, generateRandomMap, handicapped, newDay, parseRandomMapName } from "../src/index.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
const name = "random:72:4:1:1:5";
const map = generateRandomMap(data, parseRandomMapName(name)!);
const start = (handicap?: number) =>
  createAdventure(map, data, {
    seed: 3,
    mapFile: name,
    turnMinutes: 4,
    controllers: map.players.map((p, i) => (!p.canHuman && !p.canComputer ? "none" : i === 0 ? "human" : "ai")),
    // (An artifact for a bonus: a starting bonus of resources comes on top, not handicapped.)
    choices: map.players.map((_, i) => (i === 0 ? { handicap, bonus: "artifact" as const } : undefined)),
  });

test("handicap rounds each amount down", () => {
  assert.deepEqual([1, 4, 10, 20000].map((n) => handicapped(1, n)), [0, 3, 8, 17000]);
  assert.deepEqual([1, 4, 10, 20000].map((n) => handicapped(2, n)), [0, 2, 7, 14000]);
  assert.equal(handicapped(undefined, 7), 7);
});

test("a handicapped player starts with less and earns less each day; the others don't", () => {
  const plain = start().state;
  const { state: s, world } = start(2);
  assert.equal(s.turnMinutes, 4);
  assert.equal(s.players[0].handicap, 2);
  assert.deepEqual(s.players[0].resources, plain.players[0].resources.map((n) => handicapped(2, n)));
  assert.deepEqual(s.players[1].resources, plain.players[1].resources);
  const before = [...s.players[0].resources];
  const income = dailyIncome(s, world as World, 0);
  newDay(s, world as World);
  assert.deepEqual(s.players[0].resources.map((n, i) => n - before[i]), income.map((n) => handicapped(2, n)));
});
