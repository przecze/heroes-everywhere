// HotA's own quests (hero class, date, difficulty), deadlines and Seer's Huts with several quests.
import assert from "node:assert/strict";
import { test } from "node:test";
import { activeQuest, questDone, questExpired, questStepDone, type Quest } from "../src/index.ts";
import type { AdventureState, AdvObject, Hero, World } from "../src/index.ts";

const hero = (heroClass: number) => ({ heroClass, owner: 0, army: [], level: 1, primary: [0, 0, 1, 1] }) as unknown as Hero;
const state = (day: number, difficulty = 1) => ({ day, difficulty, players: [], heroes: [], objects: [] }) as unknown as AdventureState;
const w = {} as World;

test("quests: HotA's hero-class quest lets only those classes by", () => {
  const q: Quest = { mission: 10, hota: 0, classes: [8, 9] };
  assert.equal(questDone(state(1), w, hero(8), q), true);
  assert.equal(questDone(state(1), w, hero(0), q), false);
});

test("quests: HotA's date quest opens the day after the one the map keeps", () => {
  const q: Quest = { mission: 10, hota: 1, value: 1 };
  assert.equal(questDone(state(1), w, hero(0), q), false);
  assert.equal(questDone(state(2), w, hero(0), q), true);
});

test("quests: HotA's difficulty quest checks the game's difficulty", () => {
  const q: Quest = { mission: 10, hota: 2, value: 0b00110 };
  assert.equal(questDone(state(1, 1), w, hero(0), q), true);
  assert.equal(questDone(state(1, 0), w, hero(0), q), false);
});

test("quests: a deadline runs out after its last day", () => {
  const q: Quest = { mission: 1, level: 1, lastDay: 10 };
  assert.equal(questExpired(state(10), q), false);
  assert.equal(questExpired(state(11), q), true);
  assert.equal(questExpired(state(99), { mission: 1, level: 1, lastDay: -1 }), false);
});

test("quests: a HotA Seer's Hut takes whichever of its quests the hero has done, then its repeatable ones in turn", () => {
  const quests: Quest[] = [
    { mission: 1, level: 9, lastDay: 55 },
    { mission: 1, level: 2, lastDay: 55 },
    { mission: 1, level: 1, repeat: true, amount: 1 },
    { mission: 1, level: 1, repeat: true, amount: 2 },
  ];
  const world = { mapObjectsAt: () => [{ id: 83, data: { quests } }] } as unknown as World;
  const o = { type: 83, x: 0, y: 0, z: 0, data: {} } as unknown as AdvObject;
  const h = { ...hero(0), level: 3 } as Hero;
  // Level 3: not the first (level 9) but the second.
  assert.equal(activeQuest(world, o, state(1), h).level, 2);
  questStepDone(world, o, quests[1]);
  // Nothing else done once: the repeatable ones, in turn.
  assert.equal(activeQuest(world, o, state(1), h).amount, 1);
  questStepDone(world, o, quests[2]);
  assert.equal(activeQuest(world, o, state(1), h).amount, 2);
  // Unmet, the hut says its first open quest; past day 55 that one's gone.
  assert.equal(activeQuest(world, o).level, 9);
  questStepDone(world, o, quests[3]);
  assert.equal(activeQuest(world, o, state(1), h).amount, 1);
  assert.notEqual(o.data!.done, true);
  assert.equal(activeQuest(world, o, state(60), { ...h, level: 1 } as Hero).amount, 1);
});
