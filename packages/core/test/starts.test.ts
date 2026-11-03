// The advanced starts, each applied to random maps: fair to everyone, and what each preset promises.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Obj, START_PRESETS, buildGameData, createAdventure, generateRandomMap, heroSight, maxMana, parseRandomMapName, randomMapName } from "../src/index.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);

test("every advanced start: equal towns, heroes at the preset's level with their skills, full mana and moves, own heroes in sight", async () => {
  const { mapProblems } = await import("../../sim/src/rmgsanity.ts");
  const bad: string[] = [];
  for (const start of Object.keys(START_PRESETS))
    for (const [size, players, seed] of [[36, 2, 1], [72, 4, 3], [72, 3, 8]]) {
      const name = randomMapName({ size, players, humans: 1, monsters: 1, seed, islands: start === "sea", start });
      const o = parseRandomMapName(name)!;
      const map = generateRandomMap(data, o);
      const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: name, controllers: map.players.map((p, i) => (!p.canHuman && !p.canComputer ? "none" : i === 0 ? "human" : "ai")) });
      const preset = START_PRESETS[start];
      const say = (what: string) => bad.push(`${name}: ${what}`);
      assert.equal(s.day, preset.day, name);
      const colors = s.players.map((p, c) => ({ p, c })).filter(({ p }) => p.alive && p.controller !== "none").map(({ c }) => c);
      const towns = colors.map((c) => s.objects.filter((x) => x.type === Obj.TOWN && !x.removed && x.owner === c).length);
      if (new Set(towns).size > 1) say(`towns ${towns.join("/")}`);
      if (Math.min(...towns) < 1 + Math.min(preset.extraTowns, 1)) say(`only ${Math.min(...towns)} towns with ${preset.extraTowns} extra`);
      for (const h of s.heroes.filter((x) => !x.removed && x.owner >= 0)) {
        const who = `${h.name} (player ${h.owner})`;
        if (h.level !== preset.heroLevel) say(`${who} at level ${h.level}, not ${preset.heroLevel}`);
        // (The human's hero too: its level-up choices were once left unmade.)
        if (h.levelUps?.length) say(`${who} has ${h.levelUps.length} level-ups waiting`);
        if (!preset.skills && (h.skills?.length ?? 0) < Math.min(8, 2 + Math.floor(preset.heroLevel / 4))) say(`${who} has only ${h.skills?.length ?? 0} skills`);
        // (The heroes at the gates once stood with no move points: no battle on day one.)
        if (h.movement < 1000 || h.movement !== h.maxMovement) say(`${who} has ${h.movement} of ${h.maxMovement} move points`);
        if (h.mana !== maxMana(h)) say(`${who} mana ${h.mana} of ${maxMana(h)}`);
        const at = w.index(h.x, h.y, h.z);
        if (!((s.players[h.owner].revealed[at >> 5] >>> (at & 31)) & 1)) say(`${who} stands in its owner's fog`);
        if (heroSight(h) < 1) say(`${who} sees nothing`);
      }
      for (const problem of mapProblems(s, w, o)) say(problem);
    }
  assert.deepEqual(bad, []);
});

test("a rival's Cover of Darkness leaves what a player's own heroes and towns look at in sight", async () => {
  const { newDay } = await import("../src/adventure/rules.ts");
  const name = randomMapName({ size: 36, players: 3, humans: 1, monsters: 1, seed: 280091, start: "siege" });
  const map = generateRandomMap(data, parseRandomMapName(name)!);
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: name, controllers: map.players.map((p, i) => (i === 0 ? "human" : "ai")) });
  // Every rival town a Necropolis with the Cover of Darkness.
  for (const o of s.objects) if (o.type === Obj.TOWN && o.owner > 0) (o.subid = 4), o.town!.built.push(17);
  newDay(s, w);
  const seen = (x: number, y: number, z: number) => {
    const i = w.index(x, y, z);
    return ((s.players[0].revealed[i >> 5] >>> (i & 31)) & 1) === 1;
  };
  for (const h of s.heroes.filter((x) => !x.removed && x.owner === 0)) assert.ok(seen(h.x, h.y, h.z), `${h.name} hidden from its owner`);
  for (const o of s.objects.filter((x) => x.type === Obj.TOWN && x.owner === 0))
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -5; dx <= 5; dx++) if (dx * dx + dy * dy <= 25 && w.index(o.x - 2 + dx, o.y + dy, o.z) >= 0) assert.ok(seen(o.x - 2 + dx, o.y + dy, o.z), `own town's sight hidden at ${dx},${dy}`);
});
