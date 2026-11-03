// Saves from older builds: brought up to date on loading, and a map that changed under one is noticed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SAVE_VERSION, buildGameData, createAdventure, generateRandomMap, parseRandomMapName, saveMapMismatch, upgradeAdventureState } from "../src/index.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
const name = "random:72:4:1:1:5";
const map = generateRandomMap(data, parseRandomMapName(name)!);
const fresh = () => createAdventure(map, data, { seed: 3, mapFile: name, controllers: map.players.map((p, i) => (!p.canHuman && !p.canComputer ? "none" : i === 0 ? "human" : "ai")) }).state;

test("a new game carries the save version and its map's object count; it matches its map", () => {
  const s = fresh();
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.mapObjects, map.objects.length);
  assert.equal(saveMapMismatch(s, map), undefined);
});

test("an old save's taverns: a hero offered twice, or owned and offered, is replaced", () => {
  const s = JSON.parse(JSON.stringify(fresh()));
  delete s.version;
  const owned = s.heroes.find((h: { removed?: boolean }) => !h.removed).type;
  const alive = s.players.filter((p: { tavern?: number[] }) => p.tavern?.length === 2);
  alive[0].tavern[0] = owned;
  alive[1].tavern[1] = alive[0].tavern[1];
  upgradeAdventureState(s);
  assert.equal(s.version, SAVE_VERSION);
  const seen = new Set<number>(s.heroes.filter((h: { removed?: boolean }) => !h.removed).map((h: { type: number }) => h.type));
  for (const p of s.players)
    for (const t of p.tavern ?? []) {
      assert.ok(!seen.has(t), `hero ${t} twice`);
      seen.add(t);
    }
});

test("a save whose map has changed since (an object fewer, or no count kept) is noticed", () => {
  const s = fresh();
  const other = { ...map, objects: map.objects.slice(0, -1) };
  assert.match(saveMapMismatch(s, other) ?? "", /objects/);
  delete s.mapObjects;
  s.replaced = s.replaced.slice(1);
  assert.match(saveMapMismatch(s, map) ?? "", /aren't in the save/);
});
