// Map battles are fought on the ground under the hero (VCMI's battleGetBattlefieldType): a magic
// ground's own field, the shore beside water, a ship at sea, else one of the terrain's fields.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { parseH3m } from "@heroes/formats";
import { ResourceStore } from "@heroes/formats/node";
import { BATTLEFIELDS, Terrain, battleGround, buildGameData, createAdventure, GAME_LINE_FILES } from "../src/index.ts";

const MAP = "And One for All.h3m";
const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const mapDir = (process.env.HEROES_MAP_DIRS ?? "").split(":").find((d) => d && existsSync(join(d, MAP)));
const skip = (!dataDirs.length || !mapDir) && "needs the game files (HEROES_DATA_DIRS, HEROES_MAP_DIRS)";

test("battles are fought on the ground under the hero", { skip }, () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, MAP))));
  const { state: s, world: w } = createAdventure(map, data, { seed: 7, mapFile: MAP, controllers: map.players.map((p) => (p.canHuman ? "human" : "none")) });
  const field = (x: number, y: number, z: number, boats = false) => battleGround(s, w, { x, y, z }, 3, boats).field;
  // Each magic ground's own corner tile.
  const grounds = w.map.objects.filter((o) => [21, 46, 222, 223, 224, 226, 227, 228, 229, 230, 231].includes(o.id));
  assert.ok(grounds.length > 0, "the map has magic grounds");
  for (const o of grounds) assert.equal(BATTLEFIELDS.find((f) => f.id === field(o.x, o.y, o.z))?.special, true, `${o.id} at ${o.x},${o.y}`);
  const at = (i: number) => ({ x: i % w.size, y: Math.floor(i / w.size) % w.size, z: Math.floor(i / (w.size * w.size)) });
  const water = w.map.tiles.findIndex((t) => t.terrain === Terrain.WATER);
  if (water >= 0) {
    const p = at(water);
    assert.equal(field(p.x, p.y, p.z), "ship");
    assert.equal(field(p.x, p.y, p.z, true), "ship_to_ship");
  }
  // An inland tile of each terrain gets one of that terrain's fields.
  for (let i = 0; i < w.map.tiles.length; i++) {
    const t = w.map.tiles[i].terrain;
    if (t === Terrain.WATER) continue;
    const p = at(i);
    const got = battleGround(s, w, p, i);
    const f = BATTLEFIELDS.find((b) => b.id === got.field);
    assert.ok(f, `a field at ${p.x},${p.y},${p.z}`);
    if (!f!.special && f!.id !== "sand_shore" && f!.id !== "subterranean") assert.equal(f!.terrain, got.terrain, `${f!.id} on ${got.terrain}`);
  }
});
