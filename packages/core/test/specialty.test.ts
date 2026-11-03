// Hero specialties from the generated table (no game files needed).
import assert from "node:assert/strict";
import { test } from "node:test";
import { type AdvObject, type CreatureStats, stackSkills, CREATURE_INFO, doubleClone, enchantSpecialty, healSpecialtyPercent, SKILLS, moveCost, stepCost, stepPrice, spellDurationSpecialty, type Hero, TOWNS, type World, blessSpecialtyPercent, creatureBonus, creatureSpecialtyPercent, dwellingId, schoolDamageSpecialty, spellSpecialtyPercent, specialUpgradeOf, specialtyValue, spellDamageSpecialty, townUpgradeCost, townUpgradeOf } from "../src/index.ts";

test("level-grown specialties: sea movement +75 a level, sight +1 every 6 levels", () => {
  assert.equal(specialtyValue({ type: 3, level: 1 }, "MOVEMENT", "heroMovementSea"), 75);
  assert.equal(specialtyValue({ type: 3, level: 10 }, "MOVEMENT", "heroMovementSea"), 750);
  assert.equal(specialtyValue({ type: 3, level: 10 }, "MOVEMENT", "heroMovementLand"), 0);
  assert.equal(specialtyValue({ type: 163, level: 5 }, "SIGHT_RADIUS"), 0);
  assert.equal(specialtyValue({ type: 163, level: 12 }, "SIGHT_RADIUS"), 2);
  assert.equal(specialtyValue({ type: 0, level: 12 }, "SIGHT_RADIUS"), 0);
});

test("spell damage specialists and Adela's Bless", () => {
  assert.equal(spellDamageSpecialty({ type: 138 }, 15), 50, "Magic Arrow +50%");
  assert.equal(spellDamageSpecialty({ type: 136 }, 13), 25, "Luna: Fire Walls +25% in HotA (classic +100%)");
  assert.equal(spellDamageSpecialty({ type: 136 }, 15), 0);
  assert.equal(blessSpecialtyPercent({ type: 9, level: 12 }, 2), 60, "HotA: +10% x 12 / 2");
  assert.equal(blessSpecialtyPercent({ type: 0, level: 12 }, 2), 0);
});

test("upgrades in town: with the upgraded dwelling, at the full difference in price; Gelu's Sharpshooters anywhere", () => {
  // A creature table with the real keys, every creature costing 10 gold a level.
  const creatures: { id: number; key: string; plural: string; level: number; cost: number[] }[] = [];
  for (const [id, c] of Object.entries(CREATURE_INFO)) creatures[Number(id)] = { id: Number(id), key: c.key, plural: c.key, level: c.level, cost: [0, 0, 0, 0, 0, 0, 10 * (c.level + 1)] };
  const w = { creatures } as unknown as World;
  const castle = TOWNS.findIndex((t) => t?.faction === "castle");
  const [archer, marksman] = TOWNS[castle].creatures[1];
  const town = { id: 0, subid: castle, owner: 0, town: { built: [dwellingId(1)], garrison: [] } } as unknown as AdvObject;
  assert.equal(townUpgradeOf(w, town, archer), undefined, "no upgraded dwelling yet");
  town.town!.built.push(dwellingId(1, true));
  assert.equal(townUpgradeOf(w, town, archer), marksman);
  assert.deepEqual(townUpgradeCost(w, archer, marksman, 3), creatures[marksman].cost.map((n, i) => (n - creatures[archer].cost[i]) * 3));
  const gelu = { type: 148, level: 1 } as unknown as Hero;
  const sharpshooter = creatures.find((c) => c?.key === "sharpshooter")!.id;
  assert.equal(townUpgradeOf(w, town, archer, gelu), sharpshooter, "Gelu's special upgrade comes first");
  assert.equal(specialUpgradeOf(w, marksman, gelu), sharpshooter);
  assert.equal(specialUpgradeOf(w, archer, { type: 0 } as unknown as Hero), undefined);
});

test("HotA's Coronius: Slayer +20/16/12/8 by the creature's tier", () => {
  assert.equal(enchantSpecialty({ type: 24, level: 5 }, 55, 1, 8), 28);
  assert.equal(enchantSpecialty({ type: 24, level: 5 }, 55, 4, 8), 24);
  assert.equal(enchantSpecialty({ type: 24, level: 5 }, 55, 6, 8), 20);
  assert.equal(enchantSpecialty({ type: 24, level: 5 }, 55, 7, 8), 16);
});

test("HotA's Zilare and Balfour: 10% more of the stack forgets for every N hero levels; Uland and Astra heal 10% more for every 8 - N", () => {
  assert.equal(enchantSpecialty({ type: 169, level: 1 }, 61, 2, 0), 0);
  assert.equal(enchantSpecialty({ type: 169, level: 10 }, 61, 2, 0), 50, "five steps of two levels");
  assert.equal(enchantSpecialty({ type: 230, level: 9 }, 61, 3, 0), 30);
  assert.equal(spellDurationSpecialty({ type: 169, level: 10 }, 61), 0, "no longer longer");
  assert.equal(healSpecialtyPercent({ type: 25, level: 6 }, 37, 1), 0, "a level 1 creature: every 7 levels");
  assert.equal(healSpecialtyPercent({ type: 25, level: 7 }, 37, 1), 10);
  assert.equal(healSpecialtyPercent({ type: 170, level: 7 }, 37, 7), 70, "a level 7 creature: every level");
  assert.equal(healSpecialtyPercent({ type: 0, level: 7 }, 37, 7), 0);
});

test("HotA: Dalton's Shield stops 5% more per step of levels, Eovacius' first Clone makes two", () => {
  // Expert Shield: 30% less melee damage, 70% still taken.
  assert.equal(enchantSpecialty({ type: 209, level: 10 }, 27, 2, 70), 63, "30% x (1 + 5 x 5%) = 37.5% stopped");
  assert.equal(enchantSpecialty({ type: 209, level: 3 }, 27, 7, 70), 70, "no step yet on a level 7 creature");
  assert.equal(enchantSpecialty({ type: 0, level: 10 }, 27, 2, 70), 70);
  assert.equal(doubleClone({ type: 165 }), true);
  assert.equal(doubleClone({ type: 0 }), false);
});

test("HotA terrain: Pathfinding, Wayfarer's Boots and Ergon on swamp", () => {
  const swamp = 4;
  const w = { tile: () => ({ terrain: swamp, road: 0 }), creatures: [] } as unknown as World;
  const hero = (extra: Partial<Hero>) => ({ army: [], skills: [], equipped: [], ...extra }) as unknown as Hero;
  const step = (h: Hero) => stepCost(w, h, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  assert.equal(step(hero({})), 175);
  assert.equal(step(hero({ skills: [[SKILLS.indexOf("pathfinding"), 1]] } as unknown as Partial<Hero>)), 150);
  const boots = Array(19).fill(-1);
  boots[9] = 151;
  assert.equal(step(hero({ equipped: boots })), 100, "the boots: 100 on any terrain");
  assert.equal(step(hero({ type: 205, level: 1 })), 165, "Ergon: 10 points off");
  assert.equal(step(hero({ type: 205, level: 1, skills: [[SKILLS.indexOf("pathfinding"), 3]] } as unknown as Partial<Hero>)), 90, "Ergon at Expert Pathfinding: 90 on swamp");
});

test("HotA specialties, as HotA's own hero texts give them", () => {
  // Creature specialists: 20% for every N levels (N the creature's level); level 1 creatures 10% a level; Ballista 30% every 5.
  assert.equal(creatureSpecialtyPercent({ type: 1, level: 7 }, 2, 2), 60, "Valeska's Archers: 3 steps of 20%");
  assert.equal(creatureSpecialtyPercent({ type: 51, level: 7 }, 42, 1), 70, "Ignatius' Imps: 10% a level");
  assert.equal(creatureSpecialtyPercent({ type: 6, level: 9 }, 146, 0), 30, "Christian's Ballista: 30% at level 5-9");
  // Tier bonuses.
  assert.equal(enchantSpecialty({ type: 61, level: 1 }, 43, 1, 6), 16, "Ash's Bloodlust +10 on level 1");
  assert.equal(enchantSpecialty({ type: 61, level: 1 }, 43, 7, 6), 10, "+4 on level 7");
  assert.equal(enchantSpecialty({ type: 10, level: 1 }, 45, 7, 6), 16, "Cuthbert's Weakness 10 more on level 7");
  assert.equal(enchantSpecialty({ type: 46, level: 1 }, 53, 5, 5), 7, "Cyra's Haste +2 on level 5");
  assert.equal(enchantSpecialty({ type: 14, level: 1 }, 48, 3, 4), 7, "Loynis' Prayer +3 on level 3");
  assert.equal(enchantSpecialty({ type: 141, level: 1 }, 47, 3, 5), 15, "Aenain's Disrupting Ray: 10 more");
  assert.equal(enchantSpecialty({ type: 171, level: 10 }, 28, 2, 50), 25, "Dargem's expert Air Shield: 50% x (1 + 5 x 10%) stopped");
  assert.equal(enchantSpecialty({ type: 191, level: 10 }, 56, 2, 200), 300, "Wrathmont's Frenzy: +10% x 10 / 2");
  // Spell specialists: 10% (5% for the strongest spells) for every N levels.
  assert.equal(spellSpecialtyPercent({ type: 11, level: 6 }, 20, 3), 20, "Adelaide's Frost Ring");
  assert.equal(spellSpecialtyPercent({ type: 45, level: 6 }, 19, 3), 10, "Solmyr's Chain Lightning");
  assert.equal(schoolDamageSpecialty({ type: 145 }, "fire"), 50, "Adrienne: Fire spells +50%");
  assert.equal(schoolDamageSpecialty({ type: 145 }, "air"), 0);
  // Fixed bonuses.
  assert.equal(creatureBonus({ type: 131 }, 115, "attack"), 12, "Lacus' Water Elementals +12 Attack");
  assert.equal(creatureBonus({ type: 130 }, 114, "defence"), 4, "Ignissa's Fire Elementals +4 Defense");
  assert.equal(creatureBonus({ type: 151 }, 26, "attack", true), 10, "Mutare's dragons +10");
  assert.equal(creatureBonus({ type: 155 }, 54, "defence"), 10, "Xeron's Devils +10 Defense");
});

test("the diagonal exception (heroes.thelazy.net Movement; HotA's every-modifier check): a straight step's points make a last diagonal one", () => {
  const [GRASS, ROUGH, SWAMP] = [2, 5, 4];
  const world = (terrain: number, road = 0) =>
    ({ tile: () => ({ terrain, road }), index: () => 0, map: { tiles: [{ terrain }] }, creatures: [{ faction: "fortress", speed: 6, abilities: [] }, { faction: "stronghold", speed: 6, abilities: [] }, { faction: "castle", speed: 6, abilities: [] }] }) as unknown as World;
  const s = { day: 1 } as never;
  const hero = (creature = 2) => ({ army: [{ creature, count: 1 }], skills: [], equipped: [] }) as unknown as Hero;
  const diag = (w: World, h: Hero, points: number) => stepPrice(w, s, h, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, points);
  assert.equal(diag(world(GRASS), hero(), 150), 141, "enough for the diagonal: its full cost");
  assert.equal(diag(world(GRASS), hero(), 120), 100, "short of 141 but 100 or more: the step, for a straight one's price");
  assert.equal(diag(world(GRASS), hero(), 99), -1);
  assert.equal(diag(world(SWAMP), hero(), 200), 175, "swamp: 175 to 246 points");
  // HotA counts roads and nativity in the check too (the original forgot them, so a road or a native
  // army could step on after its "last" diagonal).
  assert.equal(diag(world(GRASS, 3), hero(), 120), 70, "a cobblestone road: 70 is there, the full diagonal");
  assert.equal(diag(world(GRASS, 3), hero(), 60), 50, "...between 50 and 69: the straight road price");
  assert.equal(diag(world(SWAMP), hero(0), 120), 100, "swamp natives: 100 to 140 points step for 100");
  assert.equal(diag(world(SWAMP), hero(0), 200), 141, "...and pay the full 141 above");
  assert.equal(diag(world(ROUGH), hero(1), 130), 100, "rough natives: 100 to 140 points, for 100");
  assert.equal(diag(world(ROUGH), hero(1), 99), -1);
});

test("Fly and Water Walk: 140 / 120 / 100 a tile by Air or Water Magic (heroes.thelazy.net Movement)", () => {
  const [GRASS, SWAMP, WATER] = [2, 4, 8];
  const world = (terrain: number) => ({ tile: () => ({ terrain, road: 0 }), index: () => 0, map: { tiles: [{ terrain }] }, blocked: () => false, visitBy: [0], heroAt: [0], creatures: [{ faction: "castle", speed: 6, abilities: [] }] }) as unknown as World;
  const s = { day: 1 } as never;
  const flier = (efficiency: number) => ({ army: [{ creature: 0, count: 1 }], skills: [], equipped: [], fly: { day: 1, efficiency } }) as unknown as Hero;
  const step = (w: World, h: Hero, dy = 0) => moveCost(w, s, h, { x: 0, y: 0, z: 0 }, { x: 1, y: dy, z: 0 });
  assert.deepEqual([60, 80, 100].map((e) => step(world(WATER), flier(e))), [140, 120, 100]);
  assert.deepEqual([60, 80, 100].map((e) => step(world(WATER), flier(e), 1)), [197, 169, 141]);
  assert.equal(step(world(SWAMP), flier(60)), 140, "less than the swamp's 175");
  assert.equal(step(world(GRASS), flier(60)), 100, "never more than the ground");
  // HotA: over water the better of Fly and Water Walk counts.
  const both = { ...flier(60), waterWalk: { day: 1, efficiency: 100 } } as unknown as Hero;
  assert.equal(step(world(WATER), both), 100, "basic Fly, expert Water Walk: 100 on water");
  assert.equal(step(world(SWAMP), both), 140, "...and Fly's own on land");
});

test("stackSkills: the creature window under a hero counts the specialty as the battle does", () => {
  // Edric (level 6) and Griffins: +40% (two steps of 20%) of 8 is 4, then the hero's 2 / 3; speed +1.
  const griffin = { id: 4, level: 3, attack: 8, defense: 8, speed: 6, abilities: [] } as unknown as CreatureStats;
  const edric = { type: 2, level: 6, primary: [2, 3, 1, 1], equipped: [], backpack: [] } as unknown as Hero;
  assert.deepEqual(stackSkills(edric, griffin), { attack: 14, defense: 15, speed: 7 });
});
