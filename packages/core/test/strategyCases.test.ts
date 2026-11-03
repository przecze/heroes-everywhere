// The strategic benchmark cases (strategyCases.ts): every one builds a map the game starts on, its
// situation applies, and "strategy:<id>" names read back.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { ResourceStore } from "@heroes/formats/node";
import { beginAdventure, buildGameData, generateStrategy, parseStrategyName, strategyCases, strategyName, applyStrategy, GAME_LINE_FILES } from "../src/index.ts";

const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const skip = !dataDirs.length && "needs the game files (HEROES_DATA_DIRS)";

test("every strategy case starts a game with its situation staged", { skip }, () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const all = strategyCases(data);
  assert.equal(new Set(all.map((c) => c.id)).size, all.length, "ids are unique");
  for (const c of all) {
    const name = strategyName(c.id);
    assert.equal(parseStrategyName(name), c.id);
    const map = generateStrategy(data, name);
    const { state: s, world: w } = beginAdventure(map, data, { seed: 1, mapFile: name, controllers: map.players.map((p, i) => (i === 0 ? "human" : p.canComputer ? "ai" : "none")) });
    applyStrategy(s, w, name, data);
    assert.ok(s.heroes.some((h) => !h.removed && h.owner === 0), `${c.id}: player 0 has a hero`);
  }
});
