// The computer players' personalities: the map's AI tactic, the setup's choice, a random map's
// option, and what each changes in the AI.
import assert from "node:assert/strict";
import { test } from "node:test";
import { B, TRAITS, buildGameData, createAdventure, generateRandomMap, parseRandomMapName, personalOrder, personalityOfTactic, randomMapName, randomMapSlots, startPersonality } from "../src/index.ts";
import { BUILD_ORDER } from "../src/adventure/aiTowns.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);

test("the h3m's AI tactic: 1 warrior, 2 builder, 3 explorer, 0 (random) the standard AI", () => {
  assert.deepEqual([0, 1, 2, 3, -1, undefined].map(personalityOfTactic), [undefined, "warrior", "builder", "explorer", undefined, undefined]);
  assert.equal(startPersonality(undefined, 2, 1, 3), "builder");
  assert.equal(startPersonality("explorer", 2, 1, 3), "explorer");
  // "Random": one of the three, the same for the same game.
  const r = startPersonality("random", 0, 77, 2);
  assert.ok(r && ["warrior", "builder", "explorer"].includes(r));
  assert.equal(startPersonality("random", 0, 77, 2), r);
});

test("a random map's personality goes in its name and the map's AI tactics", () => {
  const name = "random:72:4:1:1:5:ai-warrior";
  const o = parseRandomMapName(name)!;
  assert.equal(o.ai, "warrior");
  assert.equal(randomMapName(o), name);
  assert.deepEqual(randomMapSlots(o).slice(0, 4).map((p) => p.aiTactic), [1, 1, 1, 1]);
  assert.equal(parseRandomMapName("random:72:4:1:1:5:ai-nonsense")?.ai, undefined);
  const mixed = randomMapSlots(parseRandomMapName("random:72:4:1:1:5:ai-mixed")!).slice(0, 4).map((p) => p.aiTactic!);
  assert.ok(mixed.every((t) => t >= 1 && t <= 3));
  assert.deepEqual(randomMapSlots(parseRandomMapName("random:72:4:1:1:5")!).slice(0, 4).map((p) => p.aiTactic), [0, 0, 0, 0]);
});

test("the game's computer players take the map's personality, the setup's choice first; humans none", () => {
  const name = "random:72:4:1:1:5:ai-builder";
  const map = generateRandomMap(data, parseRandomMapName(name)!);
  const { state: s } = createAdventure(map, data, {
    seed: 3,
    mapFile: name,
    controllers: map.players.map((p, i) => (!p.canHuman && !p.canComputer ? "none" : i === 0 ? "human" : "ai")),
    choices: map.players.map((_, i) => (i === 2 ? { personality: "warrior" as const } : i === 0 ? { personality: "explorer" as const } : undefined)),
  });
  assert.deepEqual(s.players.slice(0, 4).map((p) => p.personality), [undefined, "builder", "warrior", "builder"]);
});

test("each personality's build order: its own buildings first, nothing lost or doubled", () => {
  assert.equal(personalOrder(TRAITS.standard, BUILD_ORDER), BUILD_ORDER);
  for (const k of ["warrior", "builder", "explorer"] as const) {
    const order = personalOrder(TRAITS[k], BUILD_ORDER);
    assert.equal(new Set(order).size, order.length, k);
    for (const id of BUILD_ORDER) assert.ok(order.includes(id), `${k} keeps ${id}`);
  }
  const builder = personalOrder(TRAITS.builder, BUILD_ORDER);
  assert.ok(builder.indexOf(B.CITY_HALL) < builder.indexOf(B.DWELLING + 3));
  const warrior = personalOrder(TRAITS.warrior, BUILD_ORDER);
  assert.ok(warrior.indexOf(B.DWELLING_UPG) < warrior.indexOf(B.CITY_HALL));
});
