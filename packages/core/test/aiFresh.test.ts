// The fresh adventure AI (docs/fresh-ai.md): it plays a computer's days on its own, picked as the "New AI" personality.
import assert from "node:assert/strict";
import { test } from "node:test";
import { B, buildGameData, createAdventure, generateRandomMap, nextAiPlayer, parseRandomMapName, playAiTurn } from "../src/index.ts";
import { engineOf } from "../src/adventure/aiRoles.ts";
import { chainTo } from "../src/adventure/fresh/economy.ts";
import { townInfo } from "../src/adventure/town.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);

function solo(name: string) {
  const map = generateRandomMap(data, parseRandomMapName(name)!);
  const first = map.players.findIndex((p) => p.canHuman || p.canComputer);
  const { state: s, world: w } = createAdventure(map, data, { seed: 3, mapFile: name, controllers: map.players.map((_, c) => (c === first ? "ai" : "none")) });
  return { s, w, me: s.players[first] };
}

test("the New AI personality picks the fresh engine, on a random map's name too", () => {
  const name = "random:36:2:1:1:4:ai-fresh";
  assert.equal(parseRandomMapName(name)?.ai, "fresh");
  const map = generateRandomMap(data, parseRandomMapName(name)!);
  const { state: s } = createAdventure(map, data, { seed: 1, mapFile: name, controllers: map.players.map((p) => (p.canHuman || p.canComputer ? "ai" : "none")) });
  for (const p of s.players.filter((p) => p.controller === "ai")) assert.equal(engineOf(s, p.color), "fresh");
});

test("a building's chain puts what it needs first", () => {
  const { s } = solo("random:36:2:1:1:5");
  const town = s.objects.find((o) => o.town && townInfo(o))!;
  const chain = chainTo(town, B.CAPITOL)!;
  assert.ok(chain.length > 0 && chain.at(-1) === B.CAPITOL);
  const have = new Set(town.town!.built);
  for (const id of chain) {
    const b = townInfo(town)!.buildings[id];
    if (b.upgrades !== null) assert.ok(have.has(b.upgrades), `${id} before its base ${b.upgrades}`);
    have.add(id);
  }
});

test("alone on a map for two weeks, the fresh engine builds, hires and its main hero grows", () => {
  const { s, w, me } = solo("random:36:2:1:1:6");
  me.aiEngine = "fresh";
  const town = s.objects.find((o) => o.town && o.owner === me.color)!;
  const built = town.town!.built.length;
  while (s.day <= 14 && s.winner === undefined) {
    const player = nextAiPlayer(s);
    if (player < 0) break;
    playAiTurn(s, w, player);
  }
  assert.ok(s.day > 14, `stuck on day ${s.day}`);
  // (It saves up to a week for the next hall, so fewer, bigger buildings.)
  assert.ok(town.town!.built.length >= built + 3, `only ${town.town!.built.length - built} buildings in two weeks`);
  const heroes = s.heroes.filter((h) => !h.removed && h.owner === me.color);
  assert.ok(heroes.length >= 2, "a second hero hired");
  assert.ok(Math.max(...heroes.map((h) => h.experience)) > 0, "the main hero fought");
});
