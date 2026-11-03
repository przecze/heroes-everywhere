// Timed events: on their day, then every so many days; HotA's only on some difficulties.
import assert from "node:assert/strict";
import { test } from "node:test";
import { timedEvents, type AdventureState, type World } from "../src/index.ts";

const state = (day: number, difficulty: number) =>
  ({ day, difficulty, objects: [], players: [{ alive: true, controller: "human", resources: [0, 0, 0, 0, 0, 0, 0] }] }) as unknown as AdventureState;
const world = (difficulties?: number) =>
  ({ map: { events: [{ name: "", message: "Gold!", resources: [0, 0, 0, 0, 0, 0, 100], players: 1, human: true, computer: true, first: 2, every: 7, difficulties }] } }) as unknown as World;

test("timed events: the first time on day first + 1, then every so many days", () => {
  const gold = (day: number) => {
    const s = state(day, 1);
    timedEvents(s, world());
    return s.players[0].resources[6];
  };
  assert.deepEqual([1, 2, 3, 4, 10, 11].map(gold), [0, 0, 100, 0, 100, 0]);
});

test("timed events: a HotA event for some difficulties only", () => {
  const gold = (difficulty: number) => {
    const s = state(3, difficulty);
    timedEvents(s, world(0b11100));
    return s.players[0].resources[6];
  };
  assert.deepEqual([0, 1, 2, 3, 4].map(gold), [0, 0, 100, 100, 100]);
});

test("HotA's Pandora's boxes and events: movement given, taken, emptied, set, topped up", async () => {
  const { boxReward } = await import("../src/adventure/objects.ts");
  type Args = Parameters<typeof boxReward>;
  const after = (mode: number, amount: number, movement = 1000) => {
    const h = { owner: 0, movement, maxMovement: 1500, primary: [0, 0, 1, 1] } as unknown as Args[3];
    const s = { players: [{ resources: [0, 0, 0, 0, 0, 0, 0] }] } as unknown as AdventureState;
    boxReward(s, {} as World, {} as Args[2], h, { movement: { mode, amount } });
    return h.movement;
  };
  assert.equal(after(0, 800), 1800, "given, past the day's full");
  assert.equal(after(1, 400), 600);
  assert.equal(after(1, 4000), 0);
  assert.equal(after(2, 0), 0);
  assert.equal(after(3, 300), 300);
  assert.equal(after(4, 800), 1500, "topped up to the day's full");
  assert.equal(after(4, 800, 1700), 1700, "never taken down");
});

test("a Pandora's Box says what it gives as the original: a window per kind (ADVEVENT 175-188), the map's words in the first one's place", async () => {
  const { openBox } = await import("../src/adventure/visit.ts");
  type Args = Parameters<typeof openBox>;
  const open = (data: Record<string, unknown>, afterBattle = false) => {
    const h = { id: 0, name: "Orrin", owner: 0, movement: 0, maxMovement: 1500, primary: [0, 0, 1, 1], army: [] } as unknown as Args[2];
    const s = { players: [{ resources: [5, 0, 0, 0, 0, 0, 0] }] } as unknown as AdventureState;
    const w = { refresh() {}, creatures: [], data: { artifacts: [], spells: [] } } as unknown as World;
    const o = { id: 3, type: 6 } as unknown as Args[3];
    return openBox(s, w, h, o, data, afterBattle).map((e) => (e.e === "visit" ? { id: e.text?.id, message: e.message, args: e.text?.args } : null));
  };
  assert.deepEqual(open({ resources: [-2, 0, 0, 0, 0, 0, 500], morale: 1 }), [
    { id: 179, message: "Orrin's spirits rise.", args: ["Orrin"] },
    { id: 182, message: "Orrin has lost treasure.", args: ["Orrin"] },
    { id: 183, message: "Orrin has found treasure.", args: ["Orrin"] },
  ]);
  assert.deepEqual(open({ resources: [0, 0, 0, 0, 0, 0, 500], message: "A gift." }), [{ id: undefined, message: "A gift.", args: undefined }]);
  assert.deepEqual(open({ resources: [0, 0, 0, 0, 0, 0, 500], message: "A gift." }, true), [{ id: 183, message: "Orrin has found treasure.", args: ["Orrin"] }], "after its guards: the original's lines");
  assert.deepEqual(open({}), [{ id: 15, message: "advevent 15", args: undefined }]);
});
