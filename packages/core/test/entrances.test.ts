// Which way a map object's entrance may be stepped into and out of (the original's rule, VCMI's CMap::canMoveBetween):
// most objects not from the three tiles above, and a hero standing on such an entrance never leaves it upwards.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { parseH3m } from "@heroes/formats";
import { ResourceStore } from "@heroes/formats/node";
import { GAME_LINE_FILES, Obj, applyAdventureAction, buildGameData, createAdventure, findPaths, generateScene, visitTile, visitableFromTop } from "../src/index.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;

/** Every step a route may take out of tile `from` (the tiles whose best way in is from it). */
const stepsOutOf = (paths: Map<number, { prev: number }>, from: number) => [...paths].filter(([, n]) => n.prev === from).map(([i]) => i);

test("a mine's entrance: never stepped into from above, never left upwards, though the roof row is open ground", () => {
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = generateScene(data, { kind: "object", id: Obj.MINE, sub: 1 });
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "scene:object-53-1", controllers: ["human", "ai"] });
  const mine = s.objects.find((o) => o.type === Obj.MINE)!;
  // The Alchemist's Lab as Brave New World has it: only its bottom row blocked, the entrance in its middle.
  mine.block = [0xff, 0xff, 0xff, 0xff, 0xff, 0x1f];
  mine.visit = [0, 0, 0, 0, 0, 0x40];
  w.refresh(s);
  const h = s.heroes.find((x) => x.owner === 0 && !x.removed)!;
  const gate = visitTile(w, mine);
  const N = w.size;
  const above = [gate - N - 1, gate - N, gate - N + 1];
  assert.ok(above.every((i) => !w.blocked(i)), "the tiles over the entrance are open ground");
  // Standing on the entrance: out sideways or down, never up.
  [h.x, h.y] = [gate % N, Math.floor(gate / N) % N];
  h.movement = h.maxMovement = 3000;
  w.refresh(s);
  const out = stepsOutOf(findPaths(w, s, h), gate);
  assert.ok(out.length > 0, "the hero can leave");
  assert.deepEqual(out.filter((i) => above.includes(i)), [], "not upwards over the roof");
  assert.ok(findPaths(w, s, h).has(gate - N), "the roof row is still reached the long way round");
  // From above: the entrance is reached round the side, never straight down.
  [h.x, h.y] = [(gate - N) % N, Math.floor((gate - N) / N) % N];
  w.refresh(s);
  const paths = findPaths(w, s, h);
  if (paths.has(gate)) assert.ok(!above.includes(paths.get(gate)!.prev), "entered from below or the side");
  // And the rules never take that step: a one-step move goes round, not down.
  try {
    applyAdventureAction(s, w, { type: "move", hero: h.id, to: gate, steps: 1 }, h.owner);
  } catch {}
  assert.notEqual(w.index(h.x, h.y, h.z), gate, "not straight down into it");
});

test("a hero standing on an entrance doesn't open it from above", () => {
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = generateScene(data, { kind: "object", id: Obj.MINE, sub: 1 });
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "scene:object-53-1", controllers: ["human", "ai"] });
  const mine = s.objects.find((o) => o.type === Obj.MINE)!;
  mine.block = [0xff, 0xff, 0xff, 0xff, 0xff, 0x1f];
  mine.visit = [0, 0, 0, 0, 0, 0x40];
  const [a, b] = s.heroes.filter((x) => !x.removed);
  const gate = visitTile(w, mine);
  const N = w.size;
  [a.x, a.y, a.z, a.owner] = [gate % N, Math.floor(gate / N) % N, mine.z, 0];
  [b.x, b.y, b.z, b.owner] = [gate % N, Math.floor(gate / N) % N - 1, mine.z, 0];
  b.movement = b.maxMovement = 3000;
  w.refresh(s);
  const paths = findPaths(w, s, b);
  if (paths.has(gate)) assert.notEqual(Math.floor(paths.get(gate)!.prev / N) % N, Math.floor(gate / N) % N - 1, "met from the side or below");
});

test("visited from above too: monsters, heroes, artifacts, resources, the pickups (HotA's among them), boats, garrisons", () => {
  for (const type of [54, 34, 5, 79, 76, 6, 101, 12, 29, 82, 86, 59, 81, 22, 145, 8, 33, 219, 9, 212, 215, 26]) assert.ok(visitableFromTop({ type }), `type ${type}`);
  for (const type of [53, 17, 20, 16, 98, 62, 85, 43, 45, 103, 49]) assert.ok(!visitableFromTop({ type }), `type ${type}`);
});

const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const mapDir = (process.env.HEROES_MAP_DIRS ?? "").split(":").find((d) => d && existsSync(join(d, "Brave New World.h3m")));
const skip = (!dataDirs.length || !mapDir) && "needs the game files (HEROES_DATA_DIRS, HEROES_MAP_DIRS)";

test("Brave New World's Alchemist's Lab (2026-11-01 21:51): visited, the hero can't walk on up over it", { skip }, () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const all = [...files, ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(all.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof all)[number], Uint8Array>);
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, "Brave New World.h3m"))));
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "Brave New World.h3m", controllers: map.players.map((p) => (p.canHuman ? "human" : "none")) });
  const lab = s.objects.find((o) => o.type === Obj.MINE && o.subid === 1 && o.x === 63 && o.y === 91 && o.z === 0)!;
  assert.ok(lab, "the lab south of the start");
  const gate = visitTile(w, lab);
  const N = w.size;
  assert.equal(gate, w.index(62, 91, 0));
  assert.ok(!w.blocked(w.index(62, 90, 0)), "its roof row is open ground on this map (its own mask)");
  const h = s.heroes.find((x) => !x.removed && s.players[x.owner]?.controller === "human")!;
  [h.x, h.y, h.z] = [62, 91, 0];
  h.movement = h.maxMovement = 3000;
  w.refresh(s);
  const out = stepsOutOf(findPaths(w, s, h), gate);
  assert.deepEqual(out.filter((i) => Math.floor(i / N) % N === 90), [], "no step up from the entrance");
  try {
    applyAdventureAction(s, w, { type: "move", hero: h.id, to: w.index(62, 90, 0), steps: 1 }, h.owner);
  } catch {}
  assert.notEqual(h.y, 90, "the rules don't take the step up either");
});
