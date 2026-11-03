// The random map generator, checked with the game's own rules on the stand-in data.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Obj, START_PRESETS, guardStrength, rmgFor, rmgIndex, rmgKey, rmgTemplatesFor, buildGameData, createAdventure, findPaths, generateRandomMap, maskTiles, parseRandomMapName, parseRmgBundle, rmgBundleWithVcmi, rmgTemplateFacts, VCMI_HOTA_TEMPLATES, randomMapName, randomMapSlots, visit } from "../src/index.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData({ ...(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>), rmg: fakeRes("rmgtemplates.txt")! });

const cases = [
  { size: 36, players: 2, humans: 1, monsters: 1, seed: 1 },
  { size: 72, players: 4, humans: 1, monsters: 0, seed: 7 },
  { size: 72, players: 3, humans: 2, monsters: 2, seed: 42 },
  { size: 108, players: 6, humans: 1, monsters: 1, seed: 5 },
  { size: 72, players: 3, humans: 1, monsters: 1, seed: 11, underground: true },
  { size: 72, players: 4, humans: 1, monsters: 1, seed: 3, water: true },
  { size: 72, players: 3, humans: 1, monsters: 1, seed: 9, islands: true },
  // And a spread of others: sizes, player counts, monsters, levels and water.
  ...Array.from({ length: 16 }, (_, k) => {
    const players = k % 2 ? 2 + (k % 5) : 2 + (k % 3);
    // (A lake needs three players or more.)
    return { size: [36, 72][k % 2], players, humans: 1, monsters: k % 3, seed: 100 + k, underground: k % 4 === 1, water: k % 4 === 2 && players >= 3, islands: k % 8 === 3 };
  }),
];

test("random map names carry the options", () => {
  // (Options left off read back as absent.)
  for (const o of cases) assert.deepEqual(parseRandomMapName(randomMapName(o)), Object.fromEntries(Object.entries(o).filter(([, v]) => v !== false)));
  assert.equal(parseRandomMapName("Arrogance.h3m"), null);
});

test("random maps: a town and a hero each, home reachable, other players only past guards", () => {
  for (const o of cases) {
    const map = generateRandomMap(data, o);
    // (The main town's place is known only once the map is made.)
    assert.deepEqual(randomMapSlots(o), map.players.map(({ mainTown: _, ...p }) => p), "the slots without making the map");
    assert.deepEqual(generateRandomMap(data, o), map, "same options, same map");
    const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: randomMapName(o), controllers: map.players.map((p) => (p.canHuman || p.canComputer ? "ai" : "none")) });
    const what = `${randomMapName(o)}`;
    const towns = s.objects.filter((x) => x.type === Obj.TOWN && x.owner >= 0);
    assert.equal(towns.length, o.players, `${what}: a town per player`);
    assert.equal(new Set(s.heroes.filter((h) => !h.removed).map((h) => h.owner)).size, o.players, `${what}: a hero per player`);
    const entrance = (x: (typeof s.objects)[number]) => maskTiles(x.visit, 1).map(({ dx, dy }) => w.index(x.x + dx, x.y + dy, x.z));
    for (const h of s.heroes.filter((x) => !x.removed)) {
      const reach = findPaths(w, s, h);
      // Home: its wood and ore mines are in reach without a fight.
      const mines = s.objects.filter((x) => x.type === Obj.MINE && (x.subid === 0 || x.subid === 2) && entrance(x).some((i) => reach.has(i)));
      assert.ok(mines.length >= 2, `${what}: player ${h.owner} reaches ${mines.length} wood/ore mines`);
      // No other player's town or hero without passing a guard.
      for (const t of towns.filter((x) => x.owner !== h.owner)) assert.ok(!entrance(t).some((i) => reach.has(i)), `${what}: player ${h.owner} walks into player ${t.owner}'s town unguarded`);
      // Monsters: some are next to the reachable area (the passages out).
      if (!o.islands) assert.ok([...reach.keys()].some((i) => w.guardedBy[i]), `${what}: player ${h.owner} has no guarded way out`);
      // Islands: a boat on the hero's own island.
      else assert.ok(s.objects.some((x) => x.type === 8 && entrance(x).some((i) => reach.has(i))), `${what}: player ${h.owner} has no boat`);
    }
    // Roads: on free ground only, and from every town's gate somewhere along them.
    const roads = map.tiles.map((t, i) => (t.road ? i : -1)).filter((i) => i >= 0);
    assert.ok(roads.length > 0, `${what}: no roads`);
    for (const i of roads) assert.ok(!w.blocked(i) || w.guardedBy[i] || s.objects.some((x) => x.type === Obj.MONSTER && w.index(x.x, x.y, 0) === i), `${what}: road under an obstacle at ${i % map.size},${Math.floor(i / map.size)}`);
    for (const t of towns) {
      const gate = entrance(t)[0];
      const near = roads.some((i) => Math.abs((i % map.size) - (gate % map.size)) <= 1 && Math.abs(Math.floor(i / map.size) - Math.floor(gate / map.size)) <= 1);
      assert.ok(near, `${what}: no road at player ${t.owner}'s town`);
    }
    if (o.underground) {
      assert.equal(map.levels, 2, `${what}: two levels`);
      const gates = s.objects.filter((x) => x.type === 103);
      assert.ok(gates.some((g) => g.z === 0) && gates.some((g) => g.z === 1), `${what}: gates on both levels`);
      assert.ok(gates.every((g) => g.link !== undefined && s.objects[g.link].z !== g.z), `${what}: every gate leads to the other level`);
      assert.ok(map.tiles.slice(map.size * map.size).some((t) => t.terrain === 9), `${what}: rock walls underground`);
    }
    // With every monster gone, the whole map is one piece: every town can be walked to.
    for (const m of s.objects) if (m.type === Obj.MONSTER) m.removed = true;
    w.refresh(s);
    const h = s.heroes.find((x) => !x.removed)!;
    const reach = findPaths(w, s, h);
    // (Islands: the others are only reached by boat.)
    if (!o.islands) for (const t of towns) assert.ok(entrance(t).some((i) => reach.has(i)) || t.owner === h.owner, `${what}: player ${t.owner}'s town is cut off`);
    // With water: boats at the shores, each one walked to (a boat is boarded by stepping on it).
    if (o.water) {
      const boats = s.objects.filter((x) => x.type === 8);
      assert.ok(boats.length >= 2, `${what}: ${boats.length} boats`);
      for (const b of boats) assert.ok(entrance(b).some((i) => reach.has(i)), `${what}: a boat at ${b.x},${b.y} can't be reached`);
    }
  }
});

test("allied computers: one team, and an ally's town is neither fought for nor taken", () => {
  const o = { size: 72, players: 4, humans: 1, monsters: 1, seed: 21, allied: true };
  const map = generateRandomMap(data, o);
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: randomMapName(o), controllers: map.players.map((p, i) => (i === 0 ? "human" : p.canComputer ? "ai" : "none")) });
  assert.deepEqual(s.players.slice(0, 4).map((p) => p.team), [0, 1, 1, 1]);
  const h = s.heroes.find((x) => x.owner === 1 && !x.removed)!;
  const town = s.objects.find((x) => x.type === Obj.TOWN && x.owner === 2)!;
  visit(s, w, h, town);
  assert.equal(town.owner, 2, "still the ally's");
  const enemy = s.objects.find((x) => x.type === Obj.TOWN && x.owner === 0)!;
  for (const g of enemy.town!.garrison.keys()) enemy.town!.garrison[g] = null;
  const got = visit(s, w, h, enemy);
  assert.equal(enemy.owner, 1, "an enemy's empty town is taken");
  // The hero goes in, as the original's: the town screen opens (2026-10-26).
  assert.ok(got.some((e) => e.e === "town" && e.object === enemy.id), "the taken town is entered");
});

test("random map teams: the original's two rows, humans and computers never mixed, named and parsed back", () => {
  const o = { size: 108, players: 7, humans: 3, monsters: 1, seed: 4, teams: 1, compTeams: 2 };
  assert.equal(randomMapName(o), "random:108:7:3:1:4:ht-1:ct-2");
  assert.deepEqual(parseRandomMapName(randomMapName(o)), o);
  assert.deepEqual(randomMapSlots(o).slice(0, 7).map((p) => p.team), [0, 0, 0, 1, 1, 2, 2]);
  // Two humans' teams of three: as even as they go; computers each alone.
  assert.deepEqual(randomMapSlots({ ...o, teams: 2, compTeams: 0 }).slice(0, 7).map((p) => p.team), [0, 0, 1, 2, 3, 4, 5]);
  // The old ":a" is one team of computers; as many teams as players is none.
  assert.equal(parseRandomMapName("random:72:4:1:1:5:a")!.allied, true);
  assert.equal(parseRandomMapName("random:72:4:2:1:5:ht-2")!.teams, undefined);
  assert.equal(randomMapSlots({ size: 72, players: 3, humans: 1, monsters: 1, seed: 1 })[0].team, undefined, "no teams: no team field");
  // On the generated map and in the game: allies are allies.
  const map = generateRandomMap(data, o);
  const { state: s } = createAdventure(map, data, { seed: 1, mapFile: randomMapName(o), controllers: map.players.map((p, i) => (i < 3 ? "human" : p.canComputer ? "ai" : "none")) });
  assert.deepEqual(s.players.slice(0, 7).map((p) => p.team), [0, 0, 0, 1, 1, 2, 2]);
  assert.match(map.description ?? "", /the humans allied, the computers in 2 teams/);
});

test("random maps are sane: walls without gaps, everything reachable, advanced starts fair", async () => {
  // (The checker lives with the simulations: rmgsanity.ts, also run by rmgview.ts over the real files.)
  const { mapProblems } = await import("../../sim/src/rmgsanity.ts");
  const starts = Object.keys(START_PRESETS);
  // Ones that once went wrong (a guard next to a wall kept it open; HotA monsters guarded the tile beside them; a boat on the shore; extra towns behind rivals' walls), then a spread.
  const names = ["random:36:4:1:1:2:s-war", "random:72:8:1:0:592:w:s-empire", "random:144:8:1:2:168819:s-war", "random:72:5:1:0:878836:w", "random:36:4:1:1:289180:i:s-relics", "random:72:4:1:1:5:s-war"];
  for (let k = 0; k < 24; k++) {
    const size = [36, 72, 108][k % 3];
    const players = 2 + (k % (size === 36 ? 3 : 7));
    names.push(randomMapName({ size, players, humans: 1, monsters: k % 3, seed: 500 + k, underground: k % 4 === 1, water: k % 4 === 2 && players >= 3, islands: k % 8 === 3 || starts[k % starts.length] === "sea", start: k % 3 ? starts[k % starts.length] : undefined }));
  }
  const bad: string[] = [];
  for (const name of names) {
    const o = parseRandomMapName(name)!;
    const map = generateRandomMap(data, o);
    const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: name, controllers: map.players.map((p) => (p.canHuman || p.canComputer ? "ai" : "none")) });
    const problems = mapProblems(s, w, o);
    if (problems.length) bad.push(`${name}: ${problems.join("; ")}`);
  }
  assert.deepEqual(bad, []);
});

test("the original's templates: read from RMG.TXT, chosen by size and players", () => {
  const list = data.rmgTemplates!;
  assert.deepEqual(list.map((t) => t.name), ["Stand-in duel", "Stand-in ring"]);
  const duel = list[0];
  assert.equal(duel.zones.length, 4);
  assert.deepEqual(duel.zones[0].mines, [1, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(duel.zones[2].treasure, [{ low: 10000, high: 15000, density: 2 }, { low: 3000, high: 6000, density: 6 }, { low: 500, high: 3000, density: 6 }]);
  assert.equal(duel.connections.find((c) => c.wide)?.value, 0);
  // Small maps: the duel only; four players: the ring; an Extra Large map with an underground: neither.
  assert.deepEqual(rmgTemplatesFor(list, 36, 1, 1, 2).map((t) => t.name), ["Stand-in duel"]);
  assert.deepEqual(rmgTemplatesFor(list, 72, 1, 1, 4).map((t) => t.name), ["Stand-in ring"]);
  assert.deepEqual(rmgTemplatesFor(list, 144, 2, 1, 4), []);
  // Keys for map names, each template its own.
  assert.deepEqual([...rmgIndex(list).keys()], ["stand-in-stand-in-duel", "stand-in-stand-in-ring"]);
  // The guard formula: nothing under 2000, the map's strength scaling it.
  assert.equal(guardStrength(1500, 1, 1), 0);
  assert.equal(guardStrength(9000, 1, 1), 8000 + 1500);
  assert.ok(guardStrength(9000, 1, 2) > guardStrength(9000, 1, 1) && guardStrength(9000, 1, 0) < guardStrength(9000, 1, 1));
});

test("maps from a template: its zones, towns and mines, guards by value, sane", async () => {
  const { mapProblems } = await import("../../sim/src/rmgsanity.ts");
  const list = data.rmgTemplates!;
  const bad: string[] = [];
  for (const [size, players, underground, seed] of [[36, 2, false, 1], [72, 2, true, 2], [72, 4, false, 3], [108, 3, false, 4], [72, 2, false, 5], [72, 4, false, 6]] as const) {
    for (const t of rmgTemplatesFor(list, size, underground ? 2 : 1, 1, players)) {
      const o = { size, players, humans: 1, monsters: 1, seed, underground, template: rmgKey(list, t) };
      const name = randomMapName(o);
      const map = generateRandomMap(data, parseRandomMapName(name)!);
      assert.deepEqual(generateRandomMap(data, parseRandomMapName(name)!), map, "same name, same map");
      assert.match(map.name, /^Stand-in (duel|ring) \(random/, name);
      const { zones, connections } = rmgFor(t, 1, players);
      // Every castle and town the template asks for (the players' and the neutral ones).
      const want = zones.reduce((a, z) => a + z.playerTowns.towns + z.playerTowns.castles + z.neutralTowns.towns + z.neutralTowns.castles, 0);
      const towns = map.objects.filter((x) => x.id === Obj.TOWN);
      if (towns.length !== want) bad.push(`${name}: ${towns.length} towns, not ${want}`);
      // Mines: at least the template's least.
      const mines = map.objects.filter((x) => x.id === Obj.MINE).length;
      const least = zones.reduce((a, z) => a + z.mines.reduce((p, q) => p + q, 0), 0);
      if (mines < least) bad.push(`${name}: ${mines} mines, not ${least}`);
      // The guards' worth: no guard bigger than the strongest connection or treasure calls for.
      const most = Math.max(...connections.map((c) => guardStrength(c.value, 0, 1, true)), ...zones.flatMap((z) => z.treasure.map((x) => guardStrength(x.high + 3000, 2, 1))));
      for (const m of map.objects.filter((x) => x.id === Obj.MONSTER)) {
        const worth = Number(m.data.count) * data.creatures[m.subid].aiValue;
        if (worth > most * 1.3) bad.push(`${name}: a guard worth ${worth} (at most ${most})`);
      }
      const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: name, controllers: map.players.map((p) => (p.canHuman || p.canComputer ? "ai" : "none")) });
      for (const problem of mapProblems(s, w, o)) bad.push(`${name}: ${problem}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("HotA's templates as VCMI keeps them: zones like others, forced levels, portals and roadless passages", async () => {
  const { mapProblems } = await import("../../sim/src/rmgsanity.ts");
  // A stand-in in VCMI's format (comments and trailing commas as its files have them).
  const json = `{
    "[HotA] Stand-in cross" : {
      "minSize" : "s", "maxSize" : "m+u", "players" : "2-3",
      "zones" : {
        "1" : { "type" : "playerStart", "size" : 20, "owner" : 1, "playerTowns" : { "castles" : 1 }, "monsters" : "weak",
                "mines" : { "wood" : 1, "ore" : 1 }, "treasure" : [ { "min" : 500, "max" : 3000, "density" : 9 }, ], "bannedTowns" : [ "conflux" ] },
        "2" : { "type" : "playerStart", "size" : 20, "owner" : 2, "playerTowns" : { "castles" : 1 }, "minesLikeZone" : 1, "treasureLikeZone" : 1 },
        "3" : { "type" : "playerStart", "size" : 20, "owner" : 3, "playerTowns" : { "castles" : 1 }, "minesLikeZone" : 2, "treasureLikeZone" : 2 },
        // The middle: underground when there is one.
        "4" : { "type" : "treasure", "size" : 30, "forcedLevel" : "underground", "monsters" : "strong", "terrainTypes" : [ "lava" ], "matchTerrainToTown" : false,
                "mines" : { "gold" : 1 }, "treasure" : [ { "min" : 3000, "max" : 9000, "density" : 6 } ] },
        "5" : { "type" : "water", "size" : 10 }
      },
      "connections" : [
        { "a" : "1", "b" : "4", "guard" : 5000, "road" : "false" },
        { "a" : "2", "b" : "4", "guard" : 5000, "road" : "random" },
        { "a" : "3", "b" : "4", "guard" : 5000 },
        { "a" : "1", "b" : "2", "guard" : 9000, "type" : "forcePortal" },
        { "a" : "2", "b" : "3", "type" : "fictive" },
        { "a" : "4", "b" : "5", "guard" : 0 }
      ]
    }
  }`;
  const bundle = new TextEncoder().encode(`@@@ {Original}\n@@@ hotaStandIn.json\n${json}\n`);
  const list = parseRmgBundle(bundle);
  assert.equal(list.length, 1);
  const t = list[0];
  assert.deepEqual([t.name, t.minSize, t.maxSize, t.players], ["[HotA] Stand-in cross", 1, 8, [2, 3]]);
  assert.deepEqual(t.zones.map((z) => z.type), ["human", "human", "human", "treasure"], "the water zone left out");
  assert.deepEqual(t.zones[2].mines, [1, 0, 1, 0, 0, 0, 0], "mines like zone 2, which is like zone 1");
  assert.equal(t.zones[0].townTypes, 0x1ff & ~(1 << 8));
  assert.deepEqual([t.zones[3].level, t.zones[3].terrains, t.zones[3].monsters], [1, 1 << 7, "strong"]);
  assert.deepEqual(t.connections.map((c) => [c.a, c.b, c.road, c.portal]), [[1, 4, false, undefined], [2, 4, "random", undefined], [3, 4, undefined, undefined], [1, 2, undefined, true]]);
  assert.deepEqual(rmgTemplateFacts(t), { sizes: "S-M+U", players: "2-3" });
  // Chosen by its players: not for four.
  assert.equal(rmgTemplatesFor(list, 72, 2, 1, 4).length, 0);
  assert.equal(rmgTemplatesFor(list, 72, 2, 1, 3).length, 1);
  // Fetched beside a server's bundle that has none of HotA's own (and not beside one that has).
  const fetched = await rmgBundleWithVcmi(new TextEncoder().encode("@@@ {Original}\n"), undefined, async (n) => (n === VCMI_HOTA_TEMPLATES[0] ? new TextEncoder().encode(json) : undefined));
  assert.equal(parseRmgBundle(fetched!).length, 1);
  const own = new TextEncoder().encode("@@@ Jebus Cross\n");
  assert.equal(await rmgBundleWithVcmi(own, undefined, async () => new TextEncoder().encode(json)), own);
  // Maps from it: players underground or not, no roads when asked for none, sane.
  const withIt = { ...data, rmgTemplates: list };
  const bad: string[] = [];
  for (const [underground, roads] of [[true, undefined], [false, 0], [true, 1]] as const) {
    const o = { size: 72, players: 3, humans: 1, monsters: 1, seed: 7, ...(underground ? { underground } : {}), template: rmgKey(list, t), ...(roads !== undefined ? { roads } : {}) };
    const name = randomMapName(o);
    assert.deepEqual(parseRandomMapName(name), o);
    const map = generateRandomMap(withIt, o);
    const kinds = new Set(map.tiles.filter((x) => x.road).map((x) => x.road));
    if (roads === 0 && kinds.size) bad.push(`${name}: roads`);
    if (roads === 1 && [...kinds].some((k) => k !== 1)) bad.push(`${name}: roads not dirt`);
    const { state: s, world: w } = createAdventure(map, withIt, { seed: 1, mapFile: name, controllers: map.players.map((p) => (p.canHuman || p.canComputer ? "ai" : "none")) });
    for (const problem of mapProblems(s, w, o)) bad.push(`${name}: ${problem}`);
  }
  assert.deepEqual(bad, []);
});
