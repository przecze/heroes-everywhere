// New Game's "without Horn of the Abyss content" and the HotA rules turned off one by one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type BattleState, Obj, type Unit, buildGameData, createAdventure, generateRandomMap, isHotaCreature, moatHolds, parseRandomMapName, randomMapName, ruleOn, startFactionMask } from "../src/index.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);

test("the option and the rules are part of a random map's name", () => {
  const name = "random:72:4:1:1:5:nh:rl-dt";
  const o = parseRandomMapName(name)!;
  assert.equal(o.noHota, true);
  assert.deepEqual(o.rules, { dwellingStock: false, towerSkills: false });
  assert.equal(randomMapName(o), name);
  assert.equal(parseRandomMapName("random:72:4:1:1:5")!.noHota, undefined);
});

test("a random map without HotA content places none and bans the rest from every draw", () => {
  for (const seed of [1, 2, 3]) {
    const name = `random:72:4:1:1:${seed}:nh`;
    const map = generateRandomMap(data, parseRandomMapName(name)!);
    assert.ok(map.banned!.artifacts.includes(160) || map.banned!.artifacts.length > 5);
    assert.ok(map.bannedHeroes!.includes(156));
    assert.ok(map.banned!.skills.includes(28));
    const { state } = createAdventure(map, data, { seed, mapFile: name });
    assert.equal(state.noHota, true);
    assert.ok(state.unhirable!.includes(160));
    for (const o of state.objects) if (o.type === Obj.MONSTER && !o.removed) assert.ok(!isHotaCreature(o.subid), `HotA creature ${o.subid} on the map`);
    for (const p of state.players) if (p.faction) assert.ok(!["cove", "factory", "bulwark"].includes(p.faction));
  }
});

test("a rule turned off is off; the rest stay HotA's", () => {
  assert.equal(ruleOn(undefined, "towerSkills"), true);
  assert.equal(ruleOn({ towerSkills: false }, "towerSkills"), false);
  assert.equal(ruleOn({ towerSkills: false }, "machineCap"), true);
  const spared = { rules: { moatDefenders: false } } as unknown as BattleState;
  assert.equal(moatHolds(spared, { side: 1 } as Unit), false);
  assert.equal(moatHolds(spared, { side: 0 } as Unit), true);
  assert.equal(moatHolds({} as BattleState, { side: 1 } as Unit), true);
});

test("a map of the original's that allows every town lets HotA's three be picked; a HotA map's own list stands", () => {
  const all = (1 << 9) - 1;
  assert.equal(startFactionMask(all, false), (1 << 12) - 1);
  assert.equal(startFactionMask(all, true), all);
  assert.equal(startFactionMask(0b101, false), 0b101);
});
