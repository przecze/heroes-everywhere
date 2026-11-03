// Routes on the adventure map: where a planned route runs into a monster's guard.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type AdvObject, B, Obj, joiningCount, applyAdventureAction, buildGameData, checkGameEnd, createAdventure, findPaths, fightStep, generateRandomMap, generateScene, heroesInUse, mapPathTo, randomMapName, tavernOffer, visit, visitTile } from "../src/index.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

test("fightStep: the first step into a guarded tile, never the hero's own", () => {
  const guardedBy = new Int32Array(10);
  guardedBy[5] = 3;
  guardedBy[6] = 3;
  assert.equal(fightStep({ guardedBy }, [1, 2, 3]), -1);
  assert.equal(fightStep({ guardedBy }, [1, 2, 5, 6]), 2);
  assert.equal(fightStep({ guardedBy }, [5, 4, 3]), -1, "standing in a guard zone isn't a step into one");
  assert.equal(fightStep({ guardedBy }, []), -1);
});

test("fightStep on a random map: a route to a monster meets it where the walk stops", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const o = { size: 36, players: 2, humans: 1, monsters: 1, seed: 1 };
  const map = generateRandomMap(data, o);
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: randomMapName(o), controllers: map.players.map((p) => (p.canHuman ? "human" : "ai")) });
  const h = s.heroes.find((x) => !x.removed)!;
  const paths = findPaths(w, s, h);
  const monster = s.objects.find((x) => x.type === Obj.MONSTER && !x.removed && paths.has(w.index(x.x, x.y, x.z)))!;
  assert.ok(monster, "a monster the hero can reach");
  const path = mapPathTo(paths, w.index(monster.x, monster.y, monster.z));
  const k = fightStep(w, path);
  assert.ok(k > 0, "the route meets a guard");
  assert.ok(path.slice(1, k).every((i) => !w.guardedBy[i]), "nothing guarded before it");
  // The pathfinder stops at a guard zone: at most the monster itself follows.
  assert.ok(path.length - 1 - k <= 1);
});

test("a hero the map puts on its town's own tiles starts at the gate, visiting", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const o = { size: 36, players: 2, humans: 1, monsters: 1, seed: 1 };
  const map = generateRandomMap(data, o);
  // Blue's town as the editor does it: the hero object on the town's own anchor tile.
  const town = map.objects.find((x) => x.id === Obj.TOWN && x.data.owner === 1)!;
  map.objects.push({ ...town, id: Obj.HERO, subid: 0, data: { owner: 1, hero: -1 } });
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: randomMapName(o), controllers: ["human", "ai"] });
  const h = s.heroes.find((x) => x.owner === 1)!;
  const t = s.objects.find((x) => x.town && x.x === town.x && x.y === town.y && x.z === town.z)!;
  assert.deepEqual([h.x, h.y], [t.x - 2, t.y], "at the town's gate");
  assert.ok(!w.blocked(w.index(h.x, h.y, h.z)));
});

test("a map event: created from the map, fires when walked over (stopping the walk), invisible to routes", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const run = (players: number) => {
    const map = generateScene(data, { kind: "object", id: Obj.EVENT, sub: 0 });
    map.objects.find((o) => o.id === Obj.EVENT)!.data.players = players;
    const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "scene:object-26-0", controllers: ["human", "ai"] });
    const ev = s.objects.find((o) => o.type === Obj.EVENT)!;
    assert.ok(ev, "the event is on the map");
    const h = s.heroes.find((x) => x.owner === 0 && !x.removed)!;
    h.movement = h.maxMovement = 3000;
    const at = visitTile(w, ev);
    // A tile beyond the event, the event on the way there.
    const paths = findPaths(w, s, h);
    const beyond = [...paths.keys()].find((i) => i !== at && mapPathTo(paths, i).slice(1, -1).includes(at))!;
    assert.ok(beyond !== undefined, "routes run over the event");
    const gold = s.players[0].resources[6];
    const events = applyAdventureAction(s, w, { type: "move", hero: h.id, to: beyond }, 0);
    return { s, w, h, ev, at, beyond, gold, events };
  };
  const mine = run(0xff);
  assert.equal(w(mine).here, mine.at, "the walk stops on the event");
  assert.equal(mine.s.players[0].resources[6], mine.gold + 1000);
  assert.ok(mine.ev.removed);
  assert.ok(mine.events.some((e) => e.e === "visit" && /purse/.test(e.message)));
  const theirs = run(0b10);
  assert.equal(w(theirs).here, theirs.beyond, "another player's event: the hero walks on");
  assert.equal(theirs.s.players[0].resources[6], theirs.gold);
  assert.ok(!theirs.ev.removed);
  function w(r: ReturnType<typeof run>) {
    return { here: r.w.index(r.h.x, r.h.y, r.h.z) };
  }
});

test("a whirlpool carries only a boat: a hero on foot isn't swept onto the water", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = generateScene(data, { kind: "object", id: Obj.WHIRLPOOL, sub: 0 });
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "scene:object-111-0", controllers: ["human", "ai"] });
  const h = s.heroes.find((x) => x.owner === 0 && !x.removed)!;
  const pool = s.objects.find((o) => o.type === Obj.WHIRLPOOL)!;
  const [x, y] = [h.x, h.y];
  assert.deepEqual(visit(s, w, h, pool), []);
  assert.deepEqual([h.x, h.y], [x, y]);
});

test("upgrade a town: the map's hall and fort levels, not always Capitol and Castle", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const o = { size: 36, players: 2, humans: 1, monsters: 1, seed: 1 };
  const map = generateRandomMap(data, o);
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: randomMapName(o), controllers: ["human", "ai"] });
  const town = s.objects.find((x) => x.town && x.owner === 0)!;
  s.conditions = { victory: { type: 3, allowNormal: true, appliesToAI: false, object: town.id, hall: 1, fort: 0 }, loss: { type: -1 }, contested: true };
  town.town!.built = town.town!.built.filter((b) => !([B.CITY_HALL, B.CAPITOL, B.FORT, B.CITADEL, B.CASTLE] as number[]).includes(b));
  checkGameEnd(s, w);
  assert.equal(s.winner, undefined);
  town.town!.built.push(B.CITY_HALL, B.FORT);
  checkGameEnd(s, w);
  assert.equal(s.winner, 0, "a City Hall and a Fort are enough here");
});

test("taverns share one pool: no hero offered in two, nor one already on the map", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const o = { size: 36, players: 4, humans: 1, monsters: 1, seed: 3 };
  const map = generateRandomMap(data, o);
  const { state: s } = createAdventure(map, data, { seed: 3, mapFile: randomMapName(o), controllers: map.players.map((p) => (p.canHuman ? "human" : "ai")) });
  for (let week = 0; week < 20; week++) {
    for (const p of s.players) delete p.tavern;
    const seen = s.heroes.filter((h) => !h.removed).map((h) => h.type);
    for (const p of s.players) if (p.alive) seen.push(...tavernOffer(s, p.color));
    assert.equal(new Set(seen).size, seen.length, `week ${week}: ${seen.join(",")}`);
    assert.equal(heroesInUse(s).size, seen.length);
  }
});

test("a map garrison: the hero in it gets the garrison window and moves troops either way, unremovable ones stay", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = generateScene(data, { kind: "object", id: Obj.GARRISON, sub: 0 });
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "scene:object-33-0", controllers: ["human", "ai"] });
  const h = s.heroes.find((x) => x.owner === 0 && !x.removed)!;
  const g = s.objects.find((o) => o.type === Obj.GARRISON)!;
  g.army = [null, null, null, null, null, null, null];
  const events = visit(s, w, h, g);
  assert.ok(events.some((e) => e.e === "garrison" && e.object === g.id), "the garrison window opens");
  assert.equal(g.owner, 0);
  const first = h.army.findIndex((a) => a);
  const stack = h.army[first]!;
  // Half of the first stack left as guards...
  applyAdventureAction(s, w, { type: "moveStack", town: g.id, from: { who: "hero", slot: first }, to: { who: "garrison", slot: 0 }, count: Math.floor(stack.count / 2) || 1 }, 0);
  assert.equal(g.army![0]?.creature, stack.creature);
  // ...and taken back.
  applyAdventureAction(s, w, { type: "moveStack", town: g.id, from: { who: "garrison", slot: 0 }, to: { who: "hero", slot: first } }, 0);
  assert.equal(g.army![0], null);
  // The hero can't leave his last stack; a map's unremovable guards don't come out.
  const only = h.army.filter((a) => a).length === 1;
  if (only) assert.throws(() => applyAdventureAction(s, w, { type: "moveStack", town: g.id, from: { who: "hero", slot: first }, to: { who: "garrison", slot: 0 } }, 0));
  g.army[1] = { creature: stack.creature, count: 5 };
  (w.mapObjectsAt(g.x, g.y, g.z).find((m) => m.id === Obj.GARRISON)!.data as Record<string, unknown>).removable = false;
  assert.throws(() => applyAdventureAction(s, w, { type: "moveStack", town: g.id, from: { who: "garrison", slot: 1 }, to: { who: "hero", slot: first } }, 0), /can't leave/);
});

test("a whirlpool (heroes.thelazy.net): the weakest stack by fight value loses half rounded up, a lone one entirely, never the army's one creature", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = generateScene(data, { kind: "object", id: Obj.WHIRLPOOL, sub: 0 });
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "scene:object-111-0", controllers: ["human", "ai"] });
  const h = s.heroes.find((x) => x.owner === 0 && !x.removed)!;
  const pool = s.objects.find((o) => o.type === Obj.WHIRLPOOL)!;
  h.boat = 0;
  for (const o of s.objects) if (o.type === Obj.WHIRLPOOL && o !== pool) o.removed = true;
  w.refresh(s);
  const [x, y] = [h.x, h.y];
  // The map's only whirlpool: the toll, and the boat stays.
  h.army = [{ creature: 13, count: 3 }, { creature: 0, count: 1 }, null, null, null, null, null];
  const events = visit(s, w, h, pool);
  assert.equal(h.army[1], null, "the lone Pikeman (least fight value) is gone");
  assert.equal(h.army[0]!.count, 3);
  assert.deepEqual([h.x, h.y], [x, y]);
  assert.ok(events.some((e) => e.e === "visit"));
  visit(s, w, h, pool);
  assert.equal(h.army[0]!.count, 1, "3 Archangels: 2 lost (half, rounded up)");
  visit(s, w, h, pool);
  assert.equal(h.army[0]!.count, 1, "the army's one creature is spared");
});

test("a hero at sea can't come ashore into a dug hole (heroes.thelazy.net Boat)", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = generateScene(data, { kind: "object", id: Obj.WHIRLPOOL, sub: 0 });
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "scene:object-111-0", controllers: ["human", "ai"] });
  const h = s.heroes.find((x) => x.owner === 0 && !x.removed)!;
  // Put the hero in the boat next to the shore it stood on.
  const boat = s.objects.find((o) => o.type === Obj.BOAT)!;
  const sea = w.index(boat.x - 1, boat.y, boat.z);
  h.boat = boat.id;
  [h.x, h.y] = [sea % w.size, Math.floor(sea / w.size) % w.size];
  w.refresh(s);
  const land = [...findPaths(w, s, h).keys()].filter((i) => w.map.tiles[i].terrain !== 8);
  assert.ok(land.length, "shore tiles to land on");
  s.holes = land;
  assert.ok([...findPaths(w, s, h).keys()].every((i) => w.map.tiles[i].terrain === 8), "no landing into a hole");
});

test("questions show what they offer: the Trapper Lodge's creatures; joiners as many as the map's share", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = generateScene(data, { kind: "object", id: Obj.WHIRLPOOL, sub: 0 });
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "scene:object-111-0", controllers: ["human", "ai"] });
  const h = s.heroes.find((x) => x.owner === 0 && !x.removed)!;
  const lodge: AdvObject = { id: s.objects.length, type: 144, subid: 12, def: "", x: h.x + 2, y: h.y, z: h.z, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 64], flat: false, owner: -1 };
  s.objects.push(lodge);
  w.refresh(s);
  // Until the dice give the creatures (half the lodges).
  let offer;
  for (let i = 0; i < 40 && !offer; i++) {
    lodge.data = {};
    offer = visit(s, w, h, lodge).find((e) => e.e === "offer");
  }
  assert.ok(offer && offer.e === "offer" && offer.components?.[0]?.kind === "creature" && (offer.components[0].amount ?? 0) >= 3, "the creatures and their number");
  // A wandering stack whose map lets 50% join: the offer says 10 of 20.
  const mon: AdvObject = { ...lodge, id: s.objects.length, type: Obj.MONSTER, subid: 0, amount: 20, x: h.x - 2 };
  s.objects.push(mon);
  w.refresh(s);
  assert.equal(joiningCount(w, mon), 20);
  // (The map's record for it, as a map file gives one, with the share.)
  const template = w.map.objects[0];
  w.map.objects.push({ ...template, x: mon.x, y: mon.y, z: mon.z, id: Obj.MONSTER, subid: 0, data: { joiningPercentage: 50 } } as (typeof w.map.objects)[number]);
  (w as unknown as { anchored?: unknown }).anchored = undefined;
  assert.equal(joiningCount(w, mon), 10);
});

test("an Ocean Bottle is gone once read, a Sign stays (heroes.thelazy.net Ocean Bottle)", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = generateScene(data, { kind: "object", id: Obj.WHIRLPOOL, sub: 0 });
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "scene:object-111-0", controllers: ["human", "ai"] });
  const h = s.heroes.find((x) => x.owner === 0 && !x.removed)!;
  const at = (type: number, dx: number): AdvObject => {
    const o: AdvObject = { id: s.objects.length, type, subid: 0, def: "", x: h.x + dx, y: h.y, z: h.z, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 64], flat: false, owner: -1 };
    s.objects.push(o);
    return o;
  };
  const bottle = at(59, 2);
  const sign = at(91, 4);
  w.refresh(s);
  assert.ok(visit(s, w, h, bottle).some((e) => e.e === "visit"));
  assert.equal(bottle.removed, true);
  visit(s, w, h, sign);
  assert.ok(!sign.removed);
});

test("a Pandora's Box warns before its guards attack, and an empty one says so (advevent 15, 16)", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const open = (box: Record<string, unknown>) => {
    const map = generateScene(data, { kind: "object", id: Obj.PANDORAS_BOX, sub: 0 });
    const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "scene:object-6-0", controllers: ["human", "ai"] });
    const h = s.heroes.find((x) => x.owner === 0 && !x.removed)!;
    const o = s.objects.find((x) => x.type === Obj.PANDORAS_BOX)!;
    const md = w.mapObjectsAt(o.x, o.y, o.z).find((m) => m.id === Obj.PANDORAS_BOX)!;
    for (const k of Object.keys(md.data as object)) delete (md.data as Record<string, unknown>)[k];
    Object.assign(md.data as object, box);
    assert.equal(visit(s, w, h, o)[0]?.e, "offer");
    return applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, 0);
  };
  const guarded = open({ guards: [{ creature: 0, count: 5 }], experience: 500 });
  assert.equal((guarded[0] as { text?: { id: number } }).text?.id, 16);
  assert.ok(guarded.some((e) => e.e === "battle"), JSON.stringify(guarded.map((e) => e.e)));
  const empty = open({});
  assert.equal((empty[0] as { text?: { id: number } }).text?.id, 15);
});

test("one's own mine opens the garrison window; troops left there defend it (VCMI's CGMine)", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = generateScene(data, { kind: "object", id: Obj.MINE, sub: 0 });
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "scene:object-53-0", controllers: ["human", "ai"] });
  const h = s.heroes.find((x) => x.owner === 0 && !x.removed)!;
  const mine = s.objects.find((x) => x.type === Obj.MINE)!;
  const gate = visitTile(w, mine);
  assert.ok(applyAdventureAction(s, w, { type: "move", hero: h.id, to: gate }, 0).some((e) => e.e === "flag"));
  assert.equal(mine.owner, 0);
  // Visited again: the garrison window, no words.
  const again = visit(s, w, h, mine);
  assert.deepEqual(again.map((e) => e.e), ["garrison"]);
  const first = h.army.findIndex((a) => !!a && a.count > 1);
  const stack = h.army[first]!;
  applyAdventureAction(s, w, { type: "moveStack", town: mine.id, from: { who: "hero", slot: first }, to: { who: "garrison", slot: 0 }, count: 1 }, 0);
  assert.deepEqual(mine.army?.[0], { creature: stack.creature, count: 1 });
  // The rival's hero must beat them to take the mine.
  const rival = s.heroes.find((x) => x.owner === 1 && !x.removed)!;
  const ev = visit(s, w, rival, mine);
  assert.ok(ev.some((e) => e.e === "battle"), JSON.stringify(ev.map((e) => e.e)));
  assert.equal(mine.owner, 0);
  // A player is asked first (ADVEVENT 187); yes is the fight.
  s.battles = [];
  Object.assign(mine, { owner: 1 });
  const asked = visit(s, w, h, mine);
  assert.equal(asked[0]?.e, "offer");
  assert.equal((asked[0] as { textRef?: { id: number } }).textRef?.id, 187);
  assert.ok(applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, 0).some((e) => e.e === "battle"));
});
