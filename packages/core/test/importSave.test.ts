// The original's saved games carried on here (importSave.ts): a save made up in the original's shapes
// from a bundled map, imported, and what it holds is what the game now has.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { parseH3Save, parseH3m } from "@heroes/formats";
import { ResourceStore } from "@heroes/formats/node";
import { writeTestSave } from "../../formats/test/saveWriter.ts";
import { SLOT, buildGameData, importOriginalSave, saveMapDiffers } from "../src/index.ts";

const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const mapDir = (process.env.HEROES_MAP_DIRS ?? "").split(":").find((d) => d && existsSync(join(d, "Arrogance.h3m")));
const skip = (!dataDirs.length || !mapDir) && "needs the game files (HEROES_DATA_DIRS, HEROES_MAP_DIRS)";
const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;

test("an original save of Arrogance goes on here: heroes, towns, objects taken, fog", { skip }, () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, "Arrogance.h3m"))));
  const red = map.players.findIndex((p) => p.canHuman);
  const pile = map.objects.findIndex((o) => o.id === 79);
  const townAt = map.objects.findIndex((o) => o.id === 98 || o.id === 77);
  const town = map.objects[townAt];
  const p = map.objects[pile];
  const monster = map.objects.findIndex((o) => o.id === 54);
  const mine = map.objects.findIndex((o) => o.id === 53);
  const raw = writeTestSave(map, {
    gone: [pile],
    towns: [{ owner: red, type: 1, x: town.x, y: town.y, z: town.z, name: "Kept", army: [[14, 9]], built: [5, 7, 10, 11, 30, 31, 37], recruits: [0, 8, 0, 0, 0, 0, 0, 14] }],
    human: red,
    resources: { [red]: [7, 3, 9, 2, 1, 0, 12345] },
    date: [4, 3, 2],
    monsters: { [monster]: 77 },
    flags: { [mine]: red },
    heroes: [{ id: 30, owner: red, name: "Ivor", x: p.x, y: p.y, z: p.z, level: 7, experience: 9000, primary: [3, 4, 2, 2], skills: [[1, 3], [22, 1]], spells: [], army: [[15, 40]], worn: { 3: 7, 13: 4 }, backpack: [45], movement: 700 }],
    fog: (i) => (i < 2000 ? 1 << red : 0),
  }, "Arrogance.h3m");
  const save = parseH3Save(raw);
  assert.equal(saveMapDiffers(save, map), undefined);
  const { state: s, report } = importOriginalSave(map, data, save, { seed: 3, mapFile: "Arrogance.h3m" });
  assert.equal(report.heroes, 1);
  assert.equal(report.objectsGone, 1);
  const heroes = s.heroes.filter((h) => !h.removed);
  assert.equal(heroes.length, 1);
  const h = heroes[0];
  assert.deepEqual([h.type, h.owner, h.x, h.y, h.z, h.level, h.experience, h.movement], [30, red, p.x, p.y, p.z, 7, 9000, 700]);
  assert.deepEqual(h.primary, [3, 4, 2, 2]);
  assert.deepEqual(h.skills, [[1, 3], [22, 1]]);
  assert.deepEqual(h.army.filter(Boolean), [{ creature: 15, count: 40 }]);
  assert.equal(h.equipped![SLOT.RIGHT_HAND], 7);
  assert.equal(h.equipped![SLOT.MACH1], 4);
  assert.deepEqual(h.backpack, [45]);
  assert.equal(h.spells, undefined, "no spellbook in the save: none here");
  assert.ok(s.objects.some((o) => o.removed && o.x === p.x && o.y === p.y && o.type === 79));
  const t = s.objects.find((o) => o.town && o.x === town.x && o.y === town.y)!;
  assert.deepEqual([t.owner, t.name, t.town!.garrison[0]], [red, "Kept", { creature: 14, count: 9 }]);
  const seen = (i: number) => (s.players[red].revealed[i >> 5] >> (i & 31)) & 1;
  assert.deepEqual([seen(0), seen(1999)], [1, 1]);
  assert.equal(s.players[red].controller, "human");
  assert.deepEqual(report.notRead, ["visited objects", "quests"]);
  assert.equal(s.day, 28 + 14 + 4);
  assert.deepEqual(s.players[red].resources, [7, 3, 9, 2, 1, 0, 12345]);
  assert.deepEqual(t.town!.built, [5, 7, 10, 11, 30, 31, 37]);
  assert.deepEqual(t.town!.available.slice(0, 3), [14, 8, 0]);
  const mo = map.objects[monster];
  assert.equal(s.objects.find((o) => o.type === 54 && o.x === mo.x && o.y === mo.y && o.z === mo.z)?.amount, 77);
  const mi = map.objects[mine];
  assert.equal(s.objects.find((o) => o.type === 53 && o.x === mi.x && o.y === mi.y && o.z === mi.z)?.owner, red);
  // Another map entirely: refused.
  const other = parseH3m(gunzipSync(readFileSync(join(mapDir!, "Deluge.h3m"))));
  assert.ok(saveMapDiffers(save, other));
});
