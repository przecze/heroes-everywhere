// Every campaign in the game's archives parses: header, scenarios and their maps.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ResourceStore } from "@heroes/formats/node";
import { parseH3c, parseH3m } from "@heroes/formats";
import { CAMPAIGN_REGIONS, COMBOS, LOCKED, buildGameData, campaignMapRef, campaignScenarioMap, carryOver, createAdventure, heroFromCarried, readCampaign, trimCarried } from "../src/index.ts";
import type { AdventureState, Hero, World } from "../src/index.ts";
import { YOG_WIZARD, campaignClassText } from "../src/adventure/campaign.ts";
import { gainExperience } from "../src/adventure/combat.ts";
import { importVars, persistentVars } from "../src/adventure/scripts.ts";

const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter(Boolean);
const skip = !dataDirs.length && "needs the game files (HEROES_DATA_DIRS)";
const FILES = ["good1", "good2", "good3", "evil1", "evil2", "neutral1", "secret1", "ab", "blood", "slayer", "festival", "fire", "fool", "gem", "gelu", "crag", "sandro", "yog", "final", "secret", "h1roger", "h2terror", "h3horn", "h4fact", "h5allin"];

test("campaigns: all the original and HotA campaigns parse, with their maps", { skip }, () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  for (const f of FILES) {
    const bytes = store.get(`${f}.h3c`);
    assert.ok(bytes, `${f}.h3c in the archives`);
    const c = parseH3c(bytes!, (id) => CAMPAIGN_REGIONS[id]?.desc.length ?? 0);
    assert.ok(c.name, `${f}: name`);
    assert.ok(c.scenarios.length > 0, `${f}: scenarios`);
    for (const [i, sc] of c.scenarios.entries()) if (sc.mapName) assert.ok(c.maps[i], `${f}: map for ${sc.mapName}`);
    for (const [i, m] of c.maps.entries()) if (m) assert.ok(parseH3m(m).size > 0, `${f}: ${c.scenarios[i].mapName} parses`);
  }
});

test("campaigns: skills not kept revert to the hero's defaults, not to empty or the accumulated values", () => {
  // VCMI trimCrossoverHeroesParameters: when primarySkills aren't kept the hero's primary skills go
  // back to the class's initial values, and when secondarySkills aren't kept the secondary skills go
  // back to the hero type's starting skills — never to zero, never to an empty list.
  const won = {
    id: 1,
    type: 5,
    name: "Crag Hack",
    owner: 0,
    primary: [12, 9, 3, 2] as [number, number, number, number],
    skills: [[1, 3] as [number, number], [7, 2] as [number, number]],
    spells: [10, 11],
    experience: 50000,
    level: 15,
    army: [],
    removed: false,
  };
  const state = { heroes: [won] } as unknown as AdventureState;
  // The placeholder in the next scenario: the hero's defaults (what makeHero would build).
  const base = {
    type: 5,
    name: "Crag Hack",
    primary: [6, 3, 1, 1] as [number, number, number, number],
    skills: [[2, 1] as [number, number]],
    spells: undefined,
    equipped: [],
    backpack: [],
    army: [],
    heroClass: 0,
    owner: 0,
    experience: 0,
    level: 1,
  } as unknown as Hero;

  const dropAll = trimCarried(carryOver(state, 0), { keeps: { experience: false, primary: false, secondary: false, spells: false, artifacts: false }, keptArtifacts: [], keptCreatures: [] } as never)[0];
  assert.equal(dropAll.primary, undefined, "primary dropped => carry nothing (revert to defaults)");
  assert.equal(dropAll.skills, undefined, "secondary dropped => carry nothing (revert to defaults)");
  assert.equal(dropAll.experience, 0, "experience dropped => level 1");
  assert.equal(dropAll.level, 1);
  const dropped = heroFromCarried(base, dropAll);
  assert.deepEqual(dropped.primary, [6, 3, 1, 1], "primary reverts to the hero's class defaults");
  assert.deepEqual(dropped.skills, [[2, 1]], "secondary reverts to the hero's starting skills, not empty");

  const keepAll = trimCarried(carryOver(state, 0), { keeps: { experience: true, primary: true, secondary: true, spells: true, artifacts: true }, keptArtifacts: [], keptCreatures: [] } as never)[0];
  const kept = heroFromCarried(base, keepAll);
  assert.deepEqual(kept.primary, [12, 9, 3, 2], "primary kept => the accumulated values carry");
  assert.deepEqual(kept.skills, [[1, 3], [7, 2]], "secondary kept => the accumulated skills carry");
  assert.equal(kept.level, 15, "experience kept => level carries");
});

test("campaigns: the winner's heroes carry over into the next scenario's placeholders", { skip }, () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "heroes", "sptraits", "building", "bldgneut", "bldgspec", "dwelling", "townname", "secskill", "skilllev", "genrltxt", "arraytxt", "minename", "crgen1"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)])) as never);
  const bytes = store.get("good1.h3c")!;
  const c = readCampaign(bytes);
  // Find a scenario with a hero placeholder.
  const i = c.maps.findIndex((m) => m && parseH3m(m).objects.some((o) => o.id === 214));
  assert.ok(i >= 0, "a scenario uses placeholders");
  const first = createAdventure(campaignScenarioMap(bytes, 0), data, { seed: 1, mapFile: campaignMapRef("good1", 0) });
  const me = first.state.players.findIndex((p) => p.controller === "human");
  const hero = first.state.heroes.find((h) => h.owner === me && !h.removed)!;
  hero.experience = 12345;
  hero.level = 9;
  const carried = trimCarried(carryOver(first.state, me), c.scenarios[i]);
  const next = createAdventure(campaignScenarioMap(bytes, i), data, { seed: 2, mapFile: campaignMapRef("good1", i), campaign: { carried } });
  const back = next.state.heroes.find((h) => h.type === hero.type && !h.removed);
  assert.ok(back, `${hero.name} is back in scenario ${i + 1}`);
  if (c.scenarios[0].keeps.experience) assert.equal(back!.level, 9);
});

test("campaigns: the next scenario's travel options cut the heroes as they come in; named artifacts of heroes left behind pass on", () => {
  const hero = { type: 1, name: "A", experience: 9000, level: 8, primary: [5, 5, 5, 5] as [number, number, number, number], skills: [[1, 2] as [number, number]], spells: [3], equipped: [7, -1, 9], backpack: [11], army: [{ creature: 1, count: 10 }, { creature: 2, count: 5 }, null] };
  const next = { keeps: { experience: true, primary: false, secondary: true, spells: false, artifacts: false }, keptArtifacts: [9, 11], keptCreatures: [2] };
  const [c] = trimCarried([hero], next as never);
  assert.equal(c.level, 8);
  assert.equal(c.primary, undefined);
  assert.deepEqual(c.skills, [[1, 2]]);
  assert.deepEqual(c.spells, []);
  assert.deepEqual(c.equipped, [-1, -1, 9]);
  assert.deepEqual(c.backpack, [11]);
  assert.deepEqual(c.army, [null, { creature: 2, count: 5 }, null]);
  assert.deepEqual(c.transfer, [9, 11]);
  // Dragon Slayer's third scenario: no creatures.
  assert.deepEqual(trimCarried([hero], next as never, true)[0].army, [null, null, null]);
});

test("campaigns: a combination left behind frees the slots it locked; a kept one keeps them", () => {
  const combo = Number(Object.keys(COMBOS).find((k) => COMBOS[Number(k)].length === 4));
  // Worn in slot 0, locking 1, 2 and 3; slot 4 holds a plain artifact.
  const hero = { type: 1, name: "A", experience: 0, level: 1, equipped: [combo, LOCKED, LOCKED, LOCKED, 7], army: [{ creature: 1, count: 1 }], combos: { 0: { combo, locked: [1, 2, 3], parts: COMBOS[combo] } } };
  const keeps = { experience: true, primary: true, secondary: true, spells: true, artifacts: false };
  const [dropped] = trimCarried([hero], { keeps, keptArtifacts: [7], keptCreatures: [] } as never);
  assert.deepEqual(dropped.equipped, [-1, -1, -1, -1, 7]);
  assert.deepEqual(dropped.combos, {});
  const [kept] = trimCarried([hero], { keeps, keptArtifacts: [combo], keptCreatures: [] } as never);
  assert.deepEqual(kept.equipped, [combo, LOCKED, LOCKED, LOCKED, -1]);
  assert.deepEqual(kept.combos, hero.combos);
  // A hero carried without the record: as many locks as the kept combinations need.
  const { combos: _, ...old } = hero;
  assert.deepEqual(trimCarried([old], { keeps, keptArtifacts: [7], keptCreatures: [] } as never)[0].equipped, [-1, -1, -1, -1, 7]);
  assert.deepEqual(trimCarried([old], { keeps, keptArtifacts: [combo], keptCreatures: [] } as never)[0].equipped, [combo, LOCKED, LOCKED, LOCKED, -1]);
});

test("campaigns: Yog levels up in Attack and Defense only in his campaign; Gem is a Sorceress in hers", () => {
  const w = { map: { levelLimit: 0 }, data: { classLevelOdds: { 7: { low: [10, 10, 40, 40], high: [10, 10, 40, 40] } } } } as unknown as World;
  const yog = (mapFile: string) => {
    const h = { type: YOG_WIZARD, heroClass: 7, owner: 0, level: 1, experience: 0, primary: [0, 0, 1, 1], skills: [], name: "Yog" } as unknown as Hero;
    const s = { mapFile, rng: 3, log: [], players: [{ controller: "ai" }], banned: undefined } as unknown as AdventureState;
    gainExperience(s, w, h, 500000);
    return h.primary;
  };
  const own = yog("campaign:yog#1");
  assert.deepEqual(own.slice(2), [1, 1], "no Power or Knowledge from levels");
  assert.ok(own[0] + own[1] > 20);
  const elsewhere = yog("Arrogance.h3m");
  assert.ok(elsewhere[2] + elsewhere[3] > 2, "a Wizard elsewhere gets them");
  const gem = { type: 27 } as Hero;
  assert.equal(campaignClassText({ mapFile: "campaign:gem#0" } as AdventureState, gem), 735);
  assert.equal(campaignClassText({ mapFile: "campaign:final#2" } as AdventureState, gem), 735);
  assert.equal(campaignClassText({ mapFile: "campaign:yog#0" } as AdventureState, gem), undefined);
});

test("campaigns: HotA's script variables marked to keep pass to the next scenario's imported ones (by name)", () => {
  const vars = (v: Record<number, { name: string; initial: number; persist: boolean; imported: boolean }>) =>
    ({ map: { hotaOptions: { scripts: { events: { hero: {}, player: {}, town: {}, quest: {} }, names: {}, variables: v } } } }) as unknown as World;
  const first = vars({ 1: { name: "allies", initial: 0, persist: true, imported: false }, 2: { name: "temp", initial: 5, persist: false, imported: false } });
  const s1 = {} as AdventureState;
  persistentVars(s1, first);
  s1.scripts!.vars[1] = 3;
  const kept = persistentVars(s1, first);
  assert.deepEqual(kept, { allies: 3 });
  const second = vars({ 7: { name: "allies", initial: 0, persist: false, imported: true } });
  const s2 = {} as AdventureState;
  importVars(s2, second, kept);
  assert.equal(s2.scripts!.vars[7], 3);
});
