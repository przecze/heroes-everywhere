// The computer's halls: a lone town on a Village Hall's income saves for its Town Hall rather than spending every coin
// on the week's troops (the owner's game, Brave New World, 2026-11-01: Teal's only town still a village on day 27).
import assert from "node:assert/strict";
import { test } from "node:test";
import { B, buildGameData, createAdventure, generateRandomMap, parseRandomMapName } from "../src/index.ts";
import { manageTowns } from "../src/adventure/aiTowns.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);

test("a lone town on a Village Hall's 500 a day gets its Town Hall within the week, troops or not", () => {
  const name = "random:72:2:1:0:5";
  const map = generateRandomMap(data, parseRandomMapName(name)!);
  const { state: s, world: w } = createAdventure(map, data, { seed: 3, mapFile: name, controllers: map.players.map((p) => (p.canHuman || p.canComputer ? "ai" : "none")) });
  const player = s.players.find((p) => p.controller === "ai")!.color;
  const town = s.objects.find((o) => o.town && o.owner === player)!;
  for (const o of s.objects) if (o.town && o.owner === player && o !== town) o.owner = -1;
  // A village: its Tavern, Fort and first dwellings, no Town Hall; plenty of wood and ore, 500 gold.
  town.town!.built = [B.TAVERN, B.FORT, 10, B.DWELLING, B.DWELLING + 1, B.DWELLING + 2].filter((id, i, a) => a.indexOf(id) === i);
  s.players[player].resources = [40, 20, 40, 20, 20, 20, 500];
  let day = 0;
  for (; day < 10 && !town.town!.built.includes(B.TOWN_HALL); day++) {
    s.day = 8 + day;
    town.town!.available = town.town!.available.map(() => 20);
    town.town!.builtToday = false;
    manageTowns(s, w, player);
    s.players[player].resources[6] += 500;
  }
  assert.ok(town.town!.built.includes(B.TOWN_HALL), `no Town Hall after ${day} days, gold ${s.players[player].resources[6]}`);
});
