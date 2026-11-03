// Fights between players: hero vs hero, sieges, elimination and victory (Deluge, when the game files are present).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { parseH3m } from "@heroes/formats";
import { ResourceStore } from "@heroes/formats/node";
import { assemble, SLOT, initEquipment, applyAction, applyAdventureAction, battleFor, buildGameData, checkGameEnd, createAdventure, finishBattle, garrisonHero, runAi, swapGarrisonHero, visitingHero, GAME_LINE_FILES } from "../src/index.ts";

const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const mapDir = (process.env.HEROES_MAP_DIRS ?? "").split(":").find((d) => d && existsSync(join(d, "Deluge.h3m")));
const skip = (!dataDirs.length || !mapDir) && "needs the game files (HEROES_DATA_DIRS, HEROES_MAP_DIRS)";

function setup() {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, "Deluge.h3m"))));
  let first = true;
  const controllers = map.players.map((p) => {
    if (!p.canHuman && !p.canComputer) return "none" as const;
    if (first) return (first = false), "human" as const;
    return "ai" as const;
  });
  const { state: s, world: w } = createAdventure(map, data, { seed: 3, mapFile: "Deluge.h3m", controllers, turnMode: "sequential" });
  const me = s.players.find((p) => p.controller === "human")!.color;
  const foe = s.players.find((p) => p.controller === "ai" && p.alive)!.color;
  s.current = me;
  return { s, w, me, foe };
}

const ARCHANGEL = 13;
const PEASANT = 139;

/** Puts `h` right of `x` on open ground. */
function standBeside(w: ReturnType<typeof setup>["w"], s: ReturnType<typeof setup>["s"], target: { x: number; y: number; z: number }, h: { x: number; y: number; z: number }) {
  w.refresh(s);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const i = w.index(target.x + dx, target.y + dy, target.z);
    if (i < 0 || w.blocked(i) || w.visitBy[i] || w.heroAt[i] || w.guardedBy[i] || w.map.tiles[i].terrain === 8) continue;
    [h.x, h.y, h.z] = [target.x + dx, target.y + dy, target.z];
    w.refresh(s);
    return;
  }
  throw new Error("no free tile");
}

test("hero vs hero: the loser is removed, the winner takes artifacts and 500 bonus xp", { skip }, () => {
  const { s, w, me, foe } = setup();
  const mine = s.heroes.find((h) => h.owner === me && !h.removed)!;
  const theirs = s.heroes.find((h) => h.owner === foe && !h.removed)!;
  standBeside(w, s, theirs, mine);
  mine.army = [{ creature: ARCHANGEL, count: 30 }, null, null, null, null, null, null];
  theirs.army = [{ creature: PEASANT, count: 5 }, null, null, null, null, null, null];
  theirs.backpack = [7];
  mine.movement = mine.maxMovement = 2000;
  const xp = mine.experience;
  const events = applyAdventureAction(s, w, { type: "move", hero: mine.id, to: w.index(theirs.x, theirs.y, theirs.z) }, me);
  assert.ok(events.some((e) => e.e === "battle"));
  const found = battleFor(s, foe)!;
  assert.ok(found, "the defender takes part");
  assert.equal(found.pb.battle.sides[1].owner, foe);
  found.pb.battle.sides[0].controller = "ai";
  runAi(found.pb.battle);
  finishBattle(s, w, found.key);
  assert.ok(theirs.removed);
  assert.ok(mine.equipped?.includes(7) || mine.backpack?.includes(7), "artifact looted");
  assert.ok(mine.experience >= xp + 500 + 5);
});

test("hero vs hero: a beaten hero's assembled set is looted as its parts", { skip }, () => {
  const { s, w, me, foe } = setup();
  const mine = s.heroes.find((h) => h.owner === me && !h.removed)!;
  const theirs = s.heroes.find((h) => h.owner === foe && !h.removed)!;
  standBeside(w, s, theirs, mine);
  mine.army = [{ creature: ARCHANGEL, count: 30 }, null, null, null, null, null, null];
  theirs.army = [{ creature: PEASANT, count: 5 }, null, null, null, null, null, null];
  initEquipment(theirs);
  theirs.equipped![SLOT.RIGHT_RING] = 94;
  theirs.equipped![SLOT.LEFT_RING] = 95;
  theirs.equipped![SLOT.MISC1] = 96;
  assemble(w.data.artifacts, theirs, 131);
  mine.movement = mine.maxMovement = 2000;
  applyAdventureAction(s, w, { type: "move", hero: mine.id, to: w.index(theirs.x, theirs.y, theirs.z) }, me);
  const found = battleFor(s, foe)!;
  found.pb.battle.sides[0].controller = "ai";
  runAi(found.pb.battle);
  finishBattle(s, w, found.key);
  const mineAll = [...(mine.equipped ?? []), ...(mine.backpack ?? [])];
  assert.ok([94, 95, 96].every((a) => mineAll.includes(a)), "the parts arrive");
  assert.ok(!mineAll.includes(131), "the set does not arrive assembled");
  assert.ok(!mineAll.includes(-2), "no locked slot travels");
});

test("siege: beating the garrison captures the town; losing every town and hero ends the game", { skip }, () => {
  const { s, w, me, foe } = setup();
  const mine = s.heroes.find((h) => h.owner === me && !h.removed)!;
  const town = s.objects.find((o) => o.town && o.owner === foe)!;
  town.town!.garrison = [{ creature: PEASANT, count: 10 }, null, null, null, null, null, null];
  // March straight to the town gate.
  const gate = w.visitBy.findIndex((v) => v === town.id + 1);
  const g = { x: gate % w.size, y: Math.floor(gate / w.size) % w.size, z: Math.floor(gate / (w.size * w.size)) };
  for (const h of s.heroes) if (h.owner === foe) h.removed = true; // nobody home
  standBeside(w, s, g, mine);
  mine.army = [{ creature: ARCHANGEL, count: 30 }, null, null, null, null, null, null];
  mine.movement = 2000;
  const events = applyAdventureAction(s, w, { type: "move", hero: mine.id, to: gate }, me);
  assert.ok(events.some((e) => e.e === "battle"), "the garrison fights");
  const found = battleFor(s, me)!;
  found.pb.battle.sides[0].controller = "ai";
  runAi(found.pb.battle);
  finishBattle(s, w, found.key);
  assert.equal(town.owner, me);
  assert.ok(town.town!.garrison.every((x) => !x));

  // Take every other enemy town too: with no towns and heroes left, they're out.
  for (const o of s.objects) if (o.town && o.owner >= 0 && o.owner !== me) o.owner = me;
  for (const h of s.heroes) if (h.owner !== me) h.removed = true;
  checkGameEnd(s, w);
  for (const p of s.players) if (p.color !== me && p.controller === "ai") assert.equal(p.alive, false);
  assert.equal(s.winner, me);
  assert.throws(() => applyAdventureAction(s, w, { type: "endTurn" }, me), /over/);
});

test("garrison hero: takes the garrison's troops, leaves the map, defends the town and loses it with the battle", { skip }, () => {
  const { s, w, me, foe } = setup();
  const mine = s.heroes.find((h) => h.owner === me && !h.removed)!;
  const town = s.objects.find((o) => o.town && o.owner === foe)!;
  const gate = w.visitBy.findIndex((v) => v === town.id + 1);
  const g = { x: gate % w.size, y: Math.floor(gate / w.size) % w.size, z: Math.floor(gate / (w.size * w.size)) };
  for (const h of s.heroes) if (h.owner === foe) h.removed = true;
  const keeper = s.heroes.find((h) => h.owner === foe)!;
  Object.assign(keeper, { removed: false, ...g, army: [{ creature: PEASANT, count: 5 }, null, null, null, null, null, null] });
  town.town!.garrison = [{ creature: PEASANT, count: 10 }, null, null, null, null, null, null];
  w.refresh(s);
  assert.equal(visitingHero(s, w, town)?.id, keeper.id);

  // Up into the garrison: the town's troops join the hero; the gate is free.
  const swap = () => (swapGarrisonHero(s, w, town), w.refresh(s));
  swap();
  assert.equal(garrisonHero(s, town)?.id, keeper.id);
  assert.equal(visitingHero(s, w, town), undefined);
  assert.equal(keeper.army[0]?.count, 15);
  assert.ok(town.town!.garrison.every((x) => !x));
  assert.equal(w.heroAt[gate], 0, "off the map");
  // And back down to the gate, then up again.
  swap();
  assert.equal(visitingHero(s, w, town)?.id, keeper.id);
  swap();

  // A siege fights the garrison hero; beating them takes the town.
  standBeside(w, s, g, mine);
  mine.army = [{ creature: ARCHANGEL, count: 30 }, null, null, null, null, null, null];
  mine.movement = 2000;
  const events = applyAdventureAction(s, w, { type: "move", hero: mine.id, to: gate }, me);
  assert.ok(events.some((e) => e.e === "battle"), "the garrison hero fights");
  const found = battleFor(s, me)!;
  assert.equal(found.pb.battle.sides[1].hero?.name, keeper.name);
  found.pb.battle.sides[0].controller = "ai";
  runAi(found.pb.battle);
  finishBattle(s, w, found.key);
  assert.equal(town.owner, me);
  assert.ok(keeper.removed);
  assert.equal(garrisonHero(s, town), undefined);
});

test("visiting hero: defends the town with the garrison's troops in one battle; with a garrison hero too, outside the walls", { skip }, () => {
  const { s, w, me, foe } = setup();
  const mine = s.heroes.find((h) => h.owner === me && !h.removed)!;
  const town = s.objects.find((o) => o.town && o.owner === foe)!;
  const gate = w.visitBy.findIndex((v) => v === town.id + 1);
  const g = { x: gate % w.size, y: Math.floor(gate / w.size) % w.size, z: Math.floor(gate / (w.size * w.size)) };
  for (const h of s.heroes) if (h.owner === foe) h.removed = true;
  const keeper = s.heroes.find((h) => h.owner === foe)!;
  Object.assign(keeper, { removed: false, ...g, army: [{ creature: PEASANT, count: 5 }, null, null, null, null, null, null] });
  town.town!.garrison = [{ creature: PEASANT, count: 10 }, { creature: ARCHANGEL, count: 1 }, null, null, null, null, null];
  standBeside(w, s, g, mine);
  mine.army = [{ creature: ARCHANGEL, count: 30 }, null, null, null, null, null, null];
  mine.movement = 2000;
  const events = applyAdventureAction(s, w, { type: "move", hero: mine.id, to: gate }, me);
  assert.ok(events.some((e) => e.e === "battle"));
  const found = battleFor(s, me)!;
  assert.equal(found.pb.object, town.id, "the battle is for the town");
  const theirs = found.pb.battle.units.filter((u) => u.side === 1 && !u.machine);
  assert.equal(theirs.find((u) => u.creature === PEASANT)?.count, 15, "the garrison's peasants joined the hero's");
  assert.ok(theirs.some((u) => u.creature === ARCHANGEL), "and its archangel");
  assert.ok(town.town!.garrison.every((x) => !x));
  found.pb.battle.sides[0].controller = "ai";
  runAi(found.pb.battle);
  finishBattle(s, w, found.key);
  assert.equal(town.owner, me, "one battle takes the town");
  assert.ok(keeper.removed);
});

test("retreat: the army is lost, the hero comes back from the tavern with skills and artifacts", { skip }, () => {
  const { s, w, me, foe } = setup();
  const mine = s.heroes.find((h) => h.owner === me && !h.removed)!;
  const theirs = s.heroes.find((h) => h.owner === foe && !h.removed)!;
  standBeside(w, s, theirs, mine);
  mine.army = [{ creature: 139, count: 5 }, null, null, null, null, null, null];
  mine.backpack = [7];
  mine.movement = 2000;
  applyAdventureAction(s, w, { type: "move", hero: mine.id, to: w.index(theirs.x, theirs.y, theirs.z) }, me);
  const found = battleFor(s, me)!;
  const b = found.pb.battle;
  // Whoever is up on our side retreats.
  b.active = b.units.find((u) => u.side === 0)!.id;
  applyAction(b, { type: "retreat", unit: b.active, surrender: false });
  finishBattle(s, w, found.key);
  assert.ok(mine.removed && mine.retired);
  assert.ok(!theirs.removed);
  const slot = s.players[me].tavern!.indexOf(mine.type);
  assert.ok(slot >= 0, "back in the tavern");
  assert.deepEqual(s.players[me].tavernRoles![slot], { role: "retreated" });
  const town = s.objects.find((o) => o.town && o.owner === me)!;
  s.players[me].resources[6] = 10000;
  for (const h of s.heroes) if (h.owner === me && !h.removed && w.visitBy[w.index(h.x, h.y, h.z)] === town.id + 1) h.x += 100;
  w.refresh(s);
  applyAdventureAction(s, w, { type: "hireHero", town: town.id, slot }, me);
  assert.ok(!mine.removed, "rehired");
  assert.ok(mine.equipped?.includes(7) || mine.backpack?.includes(7), "kept the artifact");
  assert.deepEqual(mine.army.filter(Boolean).length, 1, "with one creature of the hero's own stack");
});

test("surrender: the enemy player gets the gold, the hero keeps the army (back from the tavern), the winner no 500", { skip }, () => {
  const { s, w, me, foe } = setup();
  const mine = s.heroes.find((h) => h.owner === me && !h.removed)!;
  const theirs = s.heroes.find((h) => h.owner === foe && !h.removed)!;
  standBeside(w, s, theirs, mine);
  mine.army = [{ creature: PEASANT, count: 40 }, null, null, null, null, null, null];
  mine.movement = 2000;
  s.players[me].resources[6] = 5000;
  const theirGold = s.players[foe].resources[6];
  const theirXp = theirs.experience;
  applyAdventureAction(s, w, { type: "move", hero: mine.id, to: w.index(theirs.x, theirs.y, theirs.z) }, me);
  const found = battleFor(s, me)!;
  const b = found.pb.battle;
  b.active = b.units.find((u) => u.side === 0 && !u.machine)!.id;
  applyAction(b, { type: "retreat", unit: b.active, surrender: true });
  const cost = b.fled!.cost!;
  assert.equal(cost, Math.floor((40 * w.creatures[PEASANT].cost[6]) / 2), "half the peasants' price");
  finishBattle(s, w, found.key);
  assert.equal(s.players[me].resources[6], 5000 - cost);
  assert.equal(s.players[foe].resources[6], theirGold + cost, "paid to the enemy");
  assert.equal(theirs.experience, theirXp, "nothing killed, no 500 for a hero who surrendered");
  assert.ok(mine.removed && mine.retired);
  assert.deepEqual(mine.army[0], { creature: PEASANT, count: 40 }, "the army stays with the hero");
});

test("a hero defending a town without walls can't retreat either", { skip }, () => {
  const { s, w, me, foe } = setup();
  const town = s.objects.find((o) => o.town && o.owner === foe)!;
  town.town!.built = town.town!.built.filter((x) => x < 7 || x > 9);
  const keeper = s.heroes.find((h) => h.owner === foe && !h.removed)!;
  const mine = s.heroes.find((h) => h.owner === me && !h.removed)!;
  const gate = w.visitBy.findIndex((v) => v === town.id + 1);
  [keeper.x, keeper.y, keeper.z] = [gate % w.size, Math.floor(gate / w.size) % w.size, Math.floor(gate / (w.size * w.size))];
  w.refresh(s);
  standBeside(w, s, keeper, mine);
  mine.movement = 2000;
  applyAdventureAction(s, w, { type: "move", hero: mine.id, to: gate }, me);
  const b = battleFor(s, me)!.pb.battle;
  assert.equal(b.siege, undefined, "no fort, no walls");
  assert.ok(b.town, "but still a town's defence");
  b.active = b.units.find((u) => u.side === 1 && !u.machine)!.id;
  assert.throws(() => applyAction(b, { type: "retreat", unit: b.active!, surrender: false }), /defending a town/);
});

test("Eagle Eye (HotA): learns from the enemy's spellbook at 50% (expert), cancelled by the enemy's own", { skip }, () => {
  const run = (enemyEye: number) => {
    const { s, w, me, foe } = setup();
    const mine = s.heroes.find((h) => h.owner === me && !h.removed)!;
    const theirs = s.heroes.find((h) => h.owner === foe && !h.removed)!;
    standBeside(w, s, theirs, mine);
    mine.army = [{ creature: ARCHANGEL, count: 30 }, null, null, null, null, null, null];
    theirs.army = [{ creature: PEASANT, count: 5 }, null, null, null, null, null, null];
    mine.skills = [[11, 3]];
    mine.spells = [];
    theirs.skills = enemyEye ? [[11, enemyEye]] : [];
    // Ten level 1-3 spells in the enemy's book (no mana: it casts none of them).
    const book = (w.data.spells ?? []).filter((sp) => sp && sp.level >= 1 && sp.level <= 3).slice(0, 10).map((sp) => sp.id);
    theirs.spells = book;
    theirs.mana = 0;
    mine.movement = mine.maxMovement = 2000;
    applyAdventureAction(s, w, { type: "move", hero: mine.id, to: w.index(theirs.x, theirs.y, theirs.z) }, me);
    const found = battleFor(s, foe)!;
    found.pb.battle.sides[0].controller = "ai";
    runAi(found.pb.battle);
    finishBattle(s, w, found.key);
    return mine.spells.filter((id) => book.includes(id)).length;
  };
  const learned = run(0);
  assert.ok(learned > 0 && learned < 10, `learned ${learned} of 10`);
  assert.equal(run(3), 0, "the enemy's expert Eagle Eye cancels ours");
});
