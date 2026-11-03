// Town building rules that need no game files: what can be built, and what a building yields.
import assert from "node:assert/strict";
import { test } from "node:test";
import { B, SPECIAL, TOWNS, build, buildingCost, canPay, offers, pay, townService, buildableButForCost, cannotBuild, hallChoice, missingBuildings, SHORT_OF_RESOURCES, manaVortexRefusal, recruit, recruitOffers, townIncome, townLevelCreature, useManaVortex, visitTownSpecials, weeklyGrowth, weeklyTownGrowth, swapGarrisonHero, type AdventureState, type AdvObject, type World } from "../src/index.ts";

const sub = (faction: string) => TOWNS.findIndex((t) => t.faction === faction);
const town = (faction: string, built: number[]) => ({ id: 0, owner: 0, subid: sub(faction), town: { built, builtToday: false, available: [], garrison: [] } }) as unknown as AdvObject;
const rich = (o: AdvObject) => ({ players: [{ resources: [99, 99, 99, 99, 99, 99, 99999] }], objects: [o], heroes: [], log: [] }) as unknown as AdventureState;
const w = { data: {} } as unknown as World;
const base = [B.VILLAGE_HALL, B.TAVERN, B.MARKETPLACE];

test("towns: the Grail building and the ship can't be bought in the hall", () => {
  for (const f of ["castle", "cove", "bulwark"]) {
    const o = town(f, [...base, B.SHIPYARD]);
    assert.ok(cannotBuild(rich(o), w, o, B.GRAIL), `${f}: no Grail building for gold`);
    if (TOWNS[o.subid].buildings[20]?.key === "ship") assert.ok(cannotBuild(rich(o), w, o, 20), `${f}: no ship building`);
  }
});

test("towns: the Factory's fifth guild level needs the fourth", () => {
  const o = town("factory", [...base, B.MAGE_GUILD_1, B.MAGE_GUILD_1 + 1]);
  assert.ok(cannotBuild(rich(o), w, o, B.MAGE_GUILD_1 + 4), "not from level 2");
  o.town!.built.push(B.MAGE_GUILD_1 + 2, B.MAGE_GUILD_1 + 3);
  assert.equal(cannotBuild(rich(o), w, o, B.MAGE_GUILD_1 + 4), null, "from level 4");
});

test("towns: the HotA towns' Resource Silo yields what the mod says", () => {
  const silo = (f: string) => townIncome(town(f, [...base, B.RESOURCE_SILO])).slice(0, 6);
  assert.deepEqual(silo("cove"), [0, 0, 0, 1, 0, 0], "Cove: sulfur");
  assert.deepEqual(silo("factory"), [0, 0, 0, 0, 1, 0], "Factory: crystal");
  assert.deepEqual(silo("bulwark"), [1, 0, 1, 0, 0, 0], "Bulwark: wood and ore");
});

test("towns: the upgraded horde building comes by itself, never bought", () => {
  const o = town("castle", [...base, B.DWELLING + 2, B.HORDE_1]);
  assert.ok(cannotBuild(rich(o), w, o, B.HORDE_1_UPG), "not for sale");
  assert.equal(hallChoice(o, [B.HORDE_1, B.HORDE_1_UPG]), B.HORDE_1, "the hall shows the horde building as built");
  build(rich(o), w, o, B.DWELLING_UPG + 2);
  assert.ok(o.town!.built.includes(B.HORDE_1_UPG), "upgrading the dwelling brings it");
});

test("towns: the Conflux's Vault of Ashes (HotA) for 5000 gold and 5 mercury adds a Firebird a week", () => {
  const o = town("conflux", [...base, B.DWELLING + 6]);
  const s = rich(o);
  const ww = { data: {}, creatures: { 130: { id: 130, growth: 1, hordeGrowth: 0 } } } as unknown as World;
  assert.equal(cannotBuild(s, ww, o, B.HORDE_2), null);
  build(s, ww, o, B.HORDE_2);
  assert.deepEqual(s.players[0].resources, [99, 94, 99, 99, 99, 99, 94999]);
  assert.equal(weeklyGrowth(ww, o, 6), 2);
});

test("towns: the Cove's Gunpowder Warehouse recruits Sea Dogs from the Pirates' growth", () => {
  const o = town("cove", [...base, B.DWELLING + 2, B.DWELLING_UPG + 2]);
  o.town!.available[2] = 5;
  const s = rich(o);
  (s as unknown as { players: { resources: number[] }[] }).players[0].resources = [99, 99, 99, 99, 99, 99, 99999];
  const ww = { data: {}, creatures: { 151: { id: 151, name: "Sea Dog", plural: "Sea Dogs", cost: [0, 0, 0, 0, 0, 0, 1000] } } } as unknown as World;
  (o as unknown as { town: { garrison: unknown[] } }).town.garrison = Array(7).fill(null);
  assert.throws(() => recruit(s, ww, o, 2, false, 1, true), /not built/, "not before the warehouse");
  o.town!.built.push(44);
  recruit(s, ww, o, 2, false, 2, true);
  assert.deepEqual((o.town!.garrison as unknown[]).find(Boolean), { creature: 151, count: 2 });
  assert.equal(o.town!.available[2], 3);
});

test("towns: the Castle doubles the base growth, not the horde building's (Goblins + Mess Hall + Castle: 38)", () => {
  const o = town("stronghold", [...base, B.DWELLING, B.HORDE_1, B.FORT, B.CITADEL, B.CASTLE]);
  const ww = { data: {}, creatures: { [TOWNS[o.subid].creatures[0][0]]: { id: 0, growth: 15, hordeGrowth: 8 } } } as unknown as World;
  assert.equal(weeklyGrowth(ww, o, 0), 38);
  o.town!.built.push(B.GRAIL);
  assert.equal(weeklyGrowth(ww, o, 0), 57, "the Grail: +50% of all of it");
});

test("towns: HotA's changes to the classic towns (Tower's cheaper dwellings, new requirements)", () => {
  const costs = Array.from({ length: 9 }, () => Array.from({ length: 44 }, () => [5, 0, 5, 0, 0, 0, 1000]));
  const ww = { data: { townTexts: { costs, names: [], descriptions: [] } } } as unknown as World;
  const tower = town("tower", [...base, B.DWELLING + 1, B.DWELLING + 2]);
  assert.deepEqual(buildingCost(ww, tower, B.DWELLING + 2), [5, 0, 5, 0, 0, 0, 1500], "Golem Factory 1500 gold");
  assert.equal(cannotBuild(rich(tower), ww, tower, B.DWELLING + 4), null, "Mage Tower after the Parapet and the Golem Factory");
  const stronghold = town("stronghold", base);
  assert.equal(buildingCost(ww, stronghold, B.DWELLING_UPG + 5)[4], 10, "Upg. Cliff Nest 10 crystal");
  const conflux = town("conflux", [...base, B.DWELLING, B.MAGE_GUILD_1]);
  assert.ok(cannotBuild(rich(conflux), ww, conflux, B.DWELLING_UPG), "Upg. Magic Lantern needs the Garden of Life");
});

test("towns: a new dwelling starts with the creature's own growth; the Castle and horde count from the next week", () => {
  const goblin = TOWNS[sub("stronghold")].creatures[0];
  const o = town("stronghold", [...base, B.FORT, B.CITADEL, B.CASTLE, B.HORDE_1]);
  const ww = { data: {}, creatures: { [goblin[0]]: { id: goblin[0], growth: 15, hordeGrowth: 8 } } } as unknown as World;
  build(rich(o), ww, o, B.DWELLING);
  assert.equal(o.town!.available[0], 15, "15 Goblins at once");
  assert.equal(weeklyGrowth(ww, o, 0), 38, "the next week: 15 + 15 (Castle) + 8 (Mess Hall)");
});

test("towns: the weeks and months as the original (plague, a creature's month, neutral towns, the Deity of Fire)", () => {
  const imp = TOWNS[sub("inferno")].creatures[0];
  const o = town("inferno", [...base, B.DWELLING]);
  o.town!.available = [10];
  const ww = { data: {}, creatures: { [imp[0]]: { id: imp[0], growth: 15 }, [imp[1]]: { id: imp[1], growth: 15 } } } as unknown as World;
  const s = rich(o);
  s.week = { name: "Plague", month: { name: "Plague", plague: true } };
  weeklyTownGrowth(s, ww);
  assert.equal(o.town!.available[0], 5, "plague: half, no growth");
  s.week = { name: "Ant", month: { name: "Imp", creature: imp[1] } };
  weeklyTownGrowth(s, ww);
  assert.equal(o.town!.available[0], 40, "Month of the Familiar doubles the imps' dwelling: (5 + 15) x 2");
  o.owner = -1;
  s.week = { name: "Ant" };
  weeklyTownGrowth(s, ww);
  assert.equal(o.town!.available[0], 47, "a neutral town grows at half the rate");
  o.owner = 0;
  s.week = { name: "Imp", creature: imp[0], deity: true };
  assert.equal(weeklyGrowth(ww, o, 0, s), 30, "the Deity of Fire: +15");
});

test("towns: HotA's Mana Vortex is asked for by a player's hero, taken on the way in by the computer's", () => {
  const o = town("dungeon", [...base, 21]);
  const s = rich(o);
  (s as unknown as { day: number }).day = 1;
  const maxMana = () => 10;
  const h = { owner: 0, type: 1, name: "Hero", mana: 10 } as unknown as Parameters<typeof visitTownSpecials>[2];
  (s.players[0] as unknown as { controller: string }).controller = "human";
  visitTownSpecials(s, o, h, { maxMana, gainExperience: () => [] });
  assert.equal(h.mana, 10, "not on the way in");
  assert.equal(manaVortexRefusal(o, h, 0, maxMana), null);
  useManaVortex(o, h, 0, maxMana);
  assert.equal(h.mana, 20);
  assert.match(manaVortexRefusal(o, h, 0, maxMana) ?? "", /already used/);
  (s.players[0] as unknown as { controller: string }).controller = "ai";
  h.mana = 5;
  visitTownSpecials(s, o, h, { maxMana, gainExperience: () => [] });
  assert.equal(h.mana, 5, "once a week for the town");
});

test("towns: each flagged map dwelling of the level's creature or its upgrade adds one a week (the Golem Factory too)", () => {
  const o = town("tower", [...base, B.DWELLING + 2]);
  const s = rich(o);
  const golems = TOWNS[o.subid].creatures[2];
  const ww = { data: {}, creatures: { [golems[0]]: { id: golems[0], growth: 6, hordeGrowth: 0 } } } as unknown as World;
  const dwelling = (type: number, subid: number, owner: number) => ({ id: s.objects.length, type, subid, owner }) as unknown as AdvObject;
  s.objects.push(dwelling(20, 1, 0), dwelling(20, 1, 1), dwelling(20, 0, 0));
  assert.equal(weeklyGrowth(ww, o, 2, s), 7, "our Golem Factory: +1; someone else's and the Conflux: nothing");
});

test("towns: what a level offers to recruit, best first, and the creature it shows", () => {
  const o = town("castle", [...base]);
  const [pike, halberd] = TOWNS[o.subid].creatures[0];
  assert.deepEqual(recruitOffers(o, 0), [], "no dwelling, nothing");
  assert.equal(townLevelCreature(o, 0), pike, "shows the basic creature");
  o.town!.built.push(B.DWELLING);
  assert.deepEqual(recruitOffers(o, 0), [{ creature: pike, upgraded: false }]);
  o.town!.built.push(B.DWELLING_UPG);
  assert.deepEqual(recruitOffers(o, 0), [{ creature: halberd, upgraded: true }, { creature: pike, upgraded: false }]);
  assert.equal(townLevelCreature(o, 0), halberd);
});

test("towns: the Cove's Gunpowder Warehouse puts Sea Dogs first", () => {
  const o = town("cove", [...base]);
  const level = TOWNS[o.subid].creatures.findIndex((c) => c[2] !== undefined);
  const [corsair, up, seaDog] = TOWNS[o.subid].creatures[level];
  const warehouse = Number(Object.entries(TOWNS[o.subid].buildings).find(([, b]) => b.key === `dwellingUp2Lvl${level + 1}`)![0]);
  o.town!.built.push(B.DWELLING + level, B.DWELLING_UPG + level, warehouse);
  assert.deepEqual(recruitOffers(o, level), [{ creature: seaDog, upgraded: false, second: true }, { creature: up, upgraded: true }, { creature: corsair, upgraded: false }]);
});

test("towns: what a building still needs, and whether only the price holds it back", () => {
  const o = town("castle", [...base]);
  const poor = { ...rich(o), players: [{ resources: [0, 0, 0, 0, 0, 0, 0] }] } as unknown as AdventureState;
  assert.deepEqual(missingBuildings(w, o, B.TOWN_HALL), [], "the Town Hall needs nothing more");
  assert.ok(missingBuildings(w, o, B.CAPITOL).length > 0, "the Capitol needs the City Hall");
  const priced = { data: { townTexts: { costs: { [o.subid]: { [B.TOWN_HALL]: [0, 0, 0, 0, 0, 0, 2500] } } } } } as unknown as World;
  assert.equal(cannotBuild(poor, priced, o, B.TOWN_HALL), SHORT_OF_RESOURCES);
  assert.ok(buildableButForCost(poor, priced, o, B.TOWN_HALL), "only the price");
  assert.ok(!buildableButForCost(rich(o), w, o, B.CAPITOL), "requirements first");
});

test("paying takes the whole cost, or refuses and takes nothing", () => {
  const res = [5, 0, 5, 0, 0, 0, 1000];
  assert.equal(canPay([5, 0, 0, 0, 0, 0, 1000], res), true);
  assert.equal(canPay([0, 1, 0, 0, 0, 0, 0], res), false);
  assert.throws(() => pay(res, [5, 1, 0, 0, 0, 0, 500]), new RegExp(SHORT_OF_RESOURCES));
  assert.deepEqual(res, [5, 0, 5, 0, 0, 0, 1000]);
  pay(res, [5, 0, 1, 0, 0, 0, 500]);
  assert.deepEqual(res, [0, 0, 4, 0, 0, 0, 500]);
});

test("which town building offers which service (the rules' offers and the town screen's windows agree)", () => {
  const factory = town("factory", [SPECIAL.s1, SPECIAL.s3]);
  assert.equal(townService(factory, SPECIAL.s1), "bank");
  assert.equal(townService(factory, SPECIAL.s3), "artifacts");
  assert.ok(offers(factory, "bank") && offers(factory, "sellArtifacts") && !offers(factory, "university"));
  const conflux = town("conflux", [SPECIAL.s2]);
  assert.equal(townService(conflux, SPECIAL.s2), "university");
  assert.equal(townService(conflux, SPECIAL.s1), undefined, "not built");
  assert.equal(townService(town("castle", [SPECIAL.s1]), SPECIAL.s1), undefined);
});

test("towns: a hero going into the garrison joins its own stacks of one kind when that makes room (VCMI canBeMergedWith)", () => {
  const o = { ...town("inferno", base), x: 5, y: 5, z: 0 } as AdvObject;
  o.town!.garrison = [{ creature: 50, count: 22 }, { creature: 51, count: 12 }, null, null, null, null, null];
  const one = (creature: number, count: number) => ({ creature, count });
  const hero = { id: 0, owner: 0, x: 5, y: 5, z: 0, army: [one(42, 94), one(44, 5), one(46, 71), one(42, 1), one(42, 1), one(42, 1), one(42, 1)] };
  const s = { players: [{}], objects: [o], heroes: [hero], log: [] } as unknown as AdventureState;
  const world = { size: 10, index: (x: number, y: number, z: number) => (z * 10 + y) * 10 + x, visitBy: Object.assign(Array(200).fill(0), { [55]: 1 }) } as unknown as World;
  swapGarrisonHero(s, world, o);
  assert.deepEqual(hero.army.filter(Boolean).map((x) => [x!.creature, x!.count]).sort((a, b) => a[0] - b[0]), [[42, 98], [44, 5], [46, 71], [50, 22], [51, 12]]);
  assert.ok(o.town!.garrison.every((x) => !x));
  // Still too many kinds: refused, and the hero's army as it was.
  const full = { ...hero, id: 1, garrison: undefined, army: [1, 2, 3, 4, 5, 6, 7].map((c) => one(c, 1)) };
  const o2 = { ...town("inferno", base), id: 0, x: 5, y: 5, z: 0 } as AdvObject;
  o2.town!.garrison = [one(9, 1), null, null, null, null, null, null];
  const s2 = { players: [{}], objects: [o2], heroes: [full], log: [] } as unknown as AdventureState;
  assert.throws(() => swapGarrisonHero(s2, world, o2));
  assert.deepEqual(full.army.map((x) => x.count), [1, 1, 1, 1, 1, 1, 1]);
});
