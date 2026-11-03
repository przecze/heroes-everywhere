// Playable cases (cases.ts): each kind makes a map with the thing to try within reach.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { ResourceStore } from "@heroes/formats/node";
import { B, type CaseSpec, Obj, TOWNS, buildGameData, cannotBuild, caseMapName, createAdventure, findPaths, generateRandomMap, maskTiles, parseRandomMapName, GAME_LINE_FILES } from "../src/index.ts";

const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const skip = !dataDirs.length && "needs the game files (HEROES_DATA_DIRS)";

function play(c: CaseSpec, faction?: number) {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const name = caseMapName(c, faction);
  const o = parseRandomMapName(name)!;
  assert.deepEqual(o.case, c, `${name} reads back`);
  const map = generateRandomMap(data, o);
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: name, controllers: map.players.map((p, i) => (i === 0 ? "human" : p.canComputer ? "ai" : "none")) });
  const h = s.heroes.find((x) => !x.removed && x.owner === 0)!;
  return { s, w, h, name };
}

/** The case's object, and whether the hero can walk up to it. */
function reachable(t: ReturnType<typeof play>, type: number, subid: number) {
  const { s, w, h } = t;
  const o = s.objects.find((x) => !x.removed && x.type === type && x.subid === subid);
  if (!o) return { o, reach: false };
  const reach = findPaths(w, s, h);
  const tiles = maskTiles(o.visit, 1).flatMap(({ dx, dy }) => [w.index(o.x + dx, o.y + dy, o.z), w.index(o.x + dx, o.y + dy + 1, o.z)]);
  return { o, reach: tiles.some((i) => reach.has(i)) };
}

test("cases: an artifact, a map object and a creature beside the town, in reach", { skip }, () => {
  for (const [c, type, sub] of [
    [{ kind: "artifact", id: 7 }, Obj.ARTIFACT, 7],
    [{ kind: "object", id: 41, sub: 0 }, 41, 0],
    [{ kind: "object", id: 16, sub: 2 }, 16, 2],
    [{ kind: "creature", id: 13 }, Obj.MONSTER, 13],
  ] as [CaseSpec, number, number][]) {
    const t = play(c);
    const { o, reach } = reachable(t, type, sub);
    assert.ok(o, `${t.name}: the object is on the map`);
    assert.ok(reach, `${t.name}: the hero can walk up to it`);
    assert.ok(Math.abs(o!.x - t.h.x) + Math.abs(o!.y - t.h.y) <= 16, `${t.name}: near the hero`);
  }
});

test("cases: a building is left for the player to build in a grown town of its faction", { skip }, () => {
  const tower = TOWNS.findIndex((x) => x.faction === "tower");
  const t = play({ kind: "building", id: 17 }, tower);
  const town = t.s.objects.find((o) => o.town && o.owner === 0)!;
  assert.equal(town.subid, tower, "the building's faction");
  assert.ok(!town.town!.built.includes(17), "not built yet");
  assert.ok(town.town!.built.includes(B.CAPITOL) || town.town!.built.includes(B.CITY_HALL), "the rest grown");
  assert.equal(cannotBuild(t.s, t.w, town, 17), null, "and it can be built now");
});

test("cases: a spell in the book with the mana for it, a skill at expert, a hero to play", { skip }, () => {
  const sp = play({ kind: "spell", id: 15 });
  assert.ok(sp.h.spells?.includes(15) && (sp.h.mana ?? 0) >= 100, "spell and mana");
  assert.ok(reachable(sp, Obj.MONSTER, 0).o, "something to cast it on");
  const sk = play({ kind: "skill", id: 7 });
  assert.deepEqual(sk.h.skills?.[0], [7, 3], "the skill at expert");
  const he = play({ kind: "hero", id: 30 });
  assert.equal(he.h.type, 30, "that hero");
});

test("dilemmas: the price is a guard of that share of the hero's strength, the situation is set", { skip }, async () => {
  const { dilemmaObject, dilemmaGuards } = await import("../src/index.ts");
  const value = (t: ReturnType<typeof play>) => t.h.army.reduce((a, x) => a + (x ? x.count * t.w.creatures[x.creature].aiValue : 0), 0) * (1 + 0.05 * (t.h.primary[0] + t.h.primary[1]));
  const t = play({ kind: "artifact", id: 4, price: 30 });
  const ob = dilemmaObject(t.s, { kind: "artifact", id: 4, price: 30 }, t.h)!;
  const [g] = dilemmaGuards(t.s, t.w, ob);
  assert.ok(g, "a guard in front");
  const share = (g.amount! * t.w.creatures[g.subid].aiValue) / value(t);
  assert.ok(Math.abs(share - 0.3) < 0.03, `the guard is 30% of the hero (${share.toFixed(2)})`);
  assert.ok(!t.h.equipped?.includes(4), "no ballista to start with");
  const has = play({ kind: "artifact", id: 4, price: 30, context: "hasit" });
  assert.ok(has.h.equipped?.includes(4), "hasit: one already");
  const nomagic = play({ kind: "spell", id: 15, price: 30, context: "nomagic" });
  assert.equal(nomagic.h.spells, undefined, "nomagic: no spellbook");
  assert.ok(!nomagic.s.objects.find((o) => o.town && o.owner === 0)!.town!.built.includes(0), "nomagic: no mage guild");
  const full = play({ kind: "skill", id: 6, price: 30, context: "skillsfull" });
  assert.equal(full.h.skills?.length, 8, "skillsfull: eight skills");
  const max = play({ kind: "hero", id: 30, price: 30, context: "maxheroes" });
  assert.equal(max.s.heroes.filter((x) => !x.removed && x.owner === 0).length, 8, "maxheroes: eight heroes");
});

test("a guided first game (:g): a few Peasants a short walk from the hero, who neither join nor flee", { skip }, () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  for (let seed = 1; seed <= 12; seed++) {
    const name = `random:36:2:1:0:${seed}:g`;
    const o = parseRandomMapName(name)!;
    assert.equal(o.guided, true, `${name} reads back`);
    const map = generateRandomMap(data, o);
    const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: name, controllers: map.players.map((p, i) => (i === 0 ? "human" : p.canComputer ? "ai" : "none")) });
    const h = s.heroes.find((x) => !x.removed && x.owner === 0)!;
    const t = { s, w, h, name };
    const { o: foe, reach } = reachable(t, Obj.MONSTER, 139);
    assert.ok(foe, `${name}: the Peasants are on the map`);
    assert.ok(reach, `${name}: the hero can walk up to them`);
    assert.ok(Math.abs(foe!.x - h.x) + Math.abs(foe!.y - h.y) <= 10, `${name}: near the hero (${foe!.x},${foe!.y} vs ${h.x},${h.y})`);
    assert.equal(foe!.data?.aggression, 10, `${name}: they fight (savage)`);
  }
});
