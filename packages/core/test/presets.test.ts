// What a HotA map's author chose for an object (HotA 1.7: a campfire's resources, a sea barrel's,
// the Ancient Lamp's genies, a survivor's artifact, the Black Market's stock, the Seafaring
// Academy's skills), on The Cataclysm, when the game files are present.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { parseH3m } from "@heroes/formats";
import { ResourceStore } from "@heroes/formats/node";
import { type AdvObject, blackMarketStock, buildGameData, createAdventure, universityOffer, visit, GAME_LINE_FILES } from "../src/index.ts";

const MAP = "[HotA] The Cataclysm.h3m";
const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const mapDir = (process.env.HEROES_MAP_DIRS ?? "").split(":").find((d) => d && existsSync(join(d, MAP)));
const skip = (!dataDirs.length || !mapDir) && "needs the game files with HotA's maps (HEROES_DATA_DIRS, HEROES_MAP_DIRS)";

function setup() {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, MAP))));
  const { state: s, world: w } = createAdventure(map, data, { seed: 7, mapFile: MAP, controllers: map.players.map((p) => (p.canHuman ? "human" : "none")) });
  const h = s.heroes.find((x) => !x.removed)!;
  /** The map's object of this kind whose chosen contents match. */
  const find = (type: number, subid: number, match: (p: Record<string, unknown>) => boolean) => {
    const mo = map.objects.find((m) => m.id === type && m.subid === subid && m.data.preset && match(m.data.preset as Record<string, unknown>))!;
    return s.objects.find((o) => o.x === mo.x && o.y === mo.y && o.z === mo.z && o.type === type)!;
  };
  return { s, w, h, find };
}

test("chosen contents: a campfire, a sea barrel and a survivor give what the map says", { skip }, () => {
  const { s, w, h, find } = setup();
  const res = s.players[h.owner].resources;
  const before = [...res];
  visit(s, w, h, find(12, 0, (p) => p.amount === 1500));
  assert.equal(res[6] - before[6], 1500);
  assert.equal(res[4] - before[4], 5, "and 5 crystal");
  const barrel = find(145, 1, (p) => p.content === 0 && p.amount === 10);
  const crystal = res[4];
  visit(s, w, h, barrel);
  assert.equal(res[4] - crystal, 10);
  const empty = find(145, 1, (p) => p.content === 1);
  const all = [...res];
  visit(s, w, h, empty);
  assert.deepEqual(res, all, "an empty barrel");
  visit(s, w, h, find(86, 0, () => true));
  assert.ok([...Object.values(h.equipped ?? {}), ...(h.backpack ?? [])].includes(48), "the survivor's artifact");
});

test("chosen contents: the Black Market's first stock, the Seafaring Academy's skills", { skip }, () => {
  const { s, w, find } = setup();
  assert.deepEqual(blackMarketStock(s, w, find(7, 0, () => true)), [84, 118, 102, 112, 114, 70, 159]);
  const academy: AdvObject = find(146, 0, () => true);
  const offer = universityOffer(s, academy);
  assert.equal(offer.length, 3);
  assert.ok(offer.slice(1).every((k) => [16, 19, 21].includes(k)), `${offer}`);
});
