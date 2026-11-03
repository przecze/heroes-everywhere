// The original's saved games (.GM1): what the reader finds, in a save made up in their shapes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { type H3Map, parseH3Save, saveText, unpackSave } from "../src/index.ts";
import { writeTestSave } from "./saveWriter.ts";

function smallMap(): H3Map {
  const size = 36;
  const tiles = Array.from({ length: size * size }, (_, i) => ({ terrain: i % 7 === 0 ? 1 : 2, view: i % 20, river: 0, riverDir: 0, road: i % 50 === 0 ? 2 : 0, roadDir: 0, flags: 0 }));
  const templates = [
    { def: "avwmrnd0.def", blockMask: [255, 255, 255, 255, 255, 127], visitMask: [0, 0, 0, 0, 0, 128], terrainMask: 0, id: 71, subid: 0, type: 0, printPriority: 0 },
    { def: "avccasx0.def", blockMask: [255, 255, 255, 143, 7, 7], visitMask: [0, 0, 0, 0, 0, 32], terrainMask: 0, id: 98, subid: 0, type: 0, printPriority: 0 },
    { def: "avtgold0.def", blockMask: [255, 255, 255, 255, 255, 127], visitMask: [0, 0, 0, 0, 0, 128], terrainMask: 0, id: 79, subid: 6, type: 0, printPriority: 0 },
  ];
  const objects = [
    { x: 10, y: 10, z: 0, template: 0, id: 71, subid: 0, data: {} },
    { x: 20, y: 12, z: 0, template: 1, id: 98, subid: 0, data: {} },
    { x: 5, y: 30, z: 0, template: 2, id: 79, subid: 6, data: {} },
  ];
  return { size, levels: 1, name: "Test", tiles, templates, objects } as unknown as H3Map;
}

for (const hota of [false, true]) {
  test(`reads a ${hota ? "HotA" : "SoD"} save: map, objects gone, random rolls, towns, heroes, fog`, () => {
    const map = smallMap();
    const raw = writeTestSave(map, {
      hota,
      gone: [2],
      resolved: { 0: { def: "avwpike.def", id: 54, subid: 0 } },
      towns: [{ owner: 0, type: 0, x: 20, y: 12, z: 0, name: "Rivertown", army: [[1, 12]], built: [0, 5, 7, 10, 30, 31, 37], recruits: [14, 0, 0, 0, 0, 0, 0, 12, 9] }],
      human: 0,
      resources: { 0: [5, 1, 5, 1, 1, 1, 7300], 1: [20, 10, 20, 10, 10, 10, 20000] },
      date: [3, 2, 1],
      monsters: { 0: 25 },
      heroes: [
        { id: 7, owner: 0, name: "Tyris", x: 15, y: 15, z: 0, level: 6, experience: 6500, primary: [4, 3, 1, 2], skills: [[6, 2], [19, 1]], spells: [15, 41], army: [[0, 30], [3, 5]], worn: { 3: 7, 17: 0, 13: 4 }, backpack: [45], mana: 14, movement: 900 },
        { id: 9, owner: 1, name: "Loynis", x: 19, y: 13, z: 0, onMap: false },
        { id: 11, owner: 255, name: "Adela", x: -1, y: -1, z: -1, onMap: false },
      ],
      fog: (i) => (i < 300 ? 3 : i < 600 ? 1 : 0),
    });
    for (const bytes of [raw, gzipSync(raw)]) {
      const s = parseH3Save(bytes);
      assert.equal(s.hota, hota);
      assert.deepEqual([s.size, s.levels, s.name, s.mapFile], [36, 1, "Test", "Test.h3m"]);
      assert.equal(s.tiles.length, 36 * 36);
      assert.deepEqual(s.tiles.map((t) => t.terrain), map.tiles.map((t) => t.terrain));
      assert.deepEqual(s.objects.map((o) => o.present), [true, true, false]);
      assert.equal(s.templates[s.objects[0].template].def, "avwpike.def");
      assert.deepEqual(s.towns.map((t) => [t.owner, t.x, t.y, t.name, t.army[0]]), [[0, 20, 12, "Rivertown", { creature: 1, count: 12 }]]);
      const tyris = s.heroes.find((h) => h.id === 7)!;
      assert.deepEqual([tyris.owner, tyris.name, tyris.x, tyris.y, tyris.onMap, tyris.level, tyris.experience, tyris.mana, tyris.movement], [0, "Tyris", 15, 15, true, 6, 6500, 14, 900]);
      assert.deepEqual(tyris.primary, [4, 3, 1, 2]);
      assert.deepEqual(tyris.skills, [[6, 2], [19, 1]]);
      assert.deepEqual(tyris.spells, [15, 41]);
      assert.deepEqual(tyris.army.filter(Boolean), [{ creature: 0, count: 30 }, { creature: 3, count: 5 }]);
      assert.deepEqual([tyris.worn[3], tyris.worn[13], tyris.worn[17], tyris.worn[0]], [7, 4, 0, -1]);
      assert.deepEqual(tyris.backpack, [45]);
      assert.equal(s.heroes.find((h) => h.id === 9)!.onMap, false);
      assert.equal(s.heroes.find((h) => h.id === 11)!.owner, 255);
      assert.ok(s.tiles[15 * 36 + 15].cls === 34 && s.tiles[15 * 36 + 15].hero === 7);
      assert.ok(s.fog);
      assert.deepEqual([s.fog![0], s.fog![299], s.fog![300], s.fog![700]], [3, 3, 1, 0]);
      assert.equal(s.tiles[10 * 36 + 10].cls, 54);
      assert.equal(s.tiles[10 * 36 + 10].setup & 0xfff, 25);
      if (hota) assert.deepEqual(s.missing, ["players", "date", "mines and dwellings"]);
      else {
        assert.deepEqual(s.missing, []);
        assert.deepEqual(s.date, { day: 3, week: 2, month: 1 });
        assert.deepEqual(s.players.map((p) => [p.human, p.heroes]).slice(0, 3), [[true, [7]], [false, [9]], [false, []]]);
        assert.deepEqual(s.players[0].resources, [5, 1, 5, 1, 1, 1, 7300]);
        assert.deepEqual(s.towns[0].built, [0, 5, 7, 10, 30, 31, 37]);
        assert.deepEqual(s.towns[0].recruits, [[14, 0, 0, 0, 0, 0, 0], [12, 9, 0, 0, 0, 0, 0]]);
      }
    }
  });
}

test("refuses what isn't a save, and unpacks the game's gzip whatever its CRC", () => {
  assert.throws(() => parseH3Save(new Uint8Array([1, 2, 3, 4])), /not a Heroes III saved game/);
  const raw = writeTestSave(smallMap(), { heroes: [] });
  const gz = gzipSync(raw);
  gz.set([0, 0, 0, 0], gz.length - 8); // the CRC the game gets wrong
  assert.deepEqual(unpackSave(gz), raw);
});

test("names in the player's own codepage: Polish, Russian, English", () => {
  assert.equal(saveText(Uint8Array.from([0x50, 0xb3, 0xf3, 0x63, 0x6b])), "Płóck");
  assert.equal(saveText(Uint8Array.from([0xd2, 0xf3, 0xf0, 0xe8, 0xf1])), "Турис");
  assert.equal(saveText(Uint8Array.from([0x4f, 0x72, 0x72, 0x69, 0x6e])), "Orrin");
});
