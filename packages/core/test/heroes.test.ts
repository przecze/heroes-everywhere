// HotA's hero list: its campaign heroes, who the taverns offer, and what map authors set for a hero.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { parseH3m } from "@heroes/formats";
import { B, HERO_CLASSES, HERO_INFO, SPELL, HERO_PORTRAITS, applyAdventureAction, newDay, pickTavernHero, tavernArmy, tavernReturn, SPECIALTIES, WATER_HEROES, buildGameData, createAdventure, generateRandomMap, mapPortrait, parseRandomMapName, randomHeroOf, randomMapName, unhirableHeroes } from "../src/index.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);

test("HotA's campaign heroes (Kinkeria's friends: Miseria, Kydoimos, Boyd, Maximus...) are in the table, never in taverns", () => {
  for (let id = 0; id <= 230; id++) assert.ok(HERO_INFO[id], `hero ${id}`);
  const named = (id: number, name: string) => assert.equal(HERO_INFO[id].name, name);
  named(176, "Kinkeria");
  named(224, "Miseria");
  named(223, "Kydoimos");
  named(228, "Boyd");
  for (let id = 215; id <= 230; id++) {
    assert.equal(HERO_INFO[id].special, true, `${HERO_INFO[id].name} is a campaign hero`);
    assert.ok(HERO_INFO[id].army.length > 0 && HERO_INFO[id].portrait, `${HERO_INFO[id].name} has an army and a portrait`);
  }
  // The classic campaign heroes too (Mutare, Lord Haart the Death Knight, Sir Mullich...).
  for (const id of [144, 145, 151, 155, 20]) assert.equal(HERO_INFO[id].special, true);
  for (let id = 144; id <= 155; id++) assert.ok(HERO_PORTRAITS[id], `portrait of ${id}`);
  const rng = { rng: 5, unhirable: [0, 1] };
  for (let i = 0; i < 2000; i++) {
    const id = randomHeroOf(rng, undefined, new Set());
    assert.ok(!HERO_INFO[id].special && id !== 0 && id !== 1, `offered ${HERO_INFO[id].name}`);
  }
});

test("HotA's campaign heroes have their specialties", () => {
  assert.deepEqual(SPECIALTIES[176], { skill: 21 }, "Kinkeria: Learning");
  assert.equal(SPECIALTIES[224].bonuses?.[0].spell, SPELL.RESURRECTION, "Miseria: Resurrection");
  assert.deepEqual(SPECIALTIES[228].creatures, [56, 57], "Boyd: Skeletons");
  assert.deepEqual(SPECIALTIES[229].bonuses?.[0].creatures, [66, 67], "Maximus: Black Knights");
});

test("water heroes only on water maps; the map's bans", () => {
  const land = generateRandomMap(data, parseRandomMapName(randomMapName({ size: 36, players: 2, humans: 1, monsters: 1, seed: 2 }))!);
  const sea = generateRandomMap(data, parseRandomMapName(randomMapName({ size: 36, players: 2, humans: 1, monsters: 1, seed: 2, islands: true }))!);
  const only = Object.keys(WATER_HEROES).map(Number).filter((id) => WATER_HEROES[id] === "only");
  const never = Object.keys(WATER_HEROES).map(Number).filter((id) => WATER_HEROES[id] === "never");
  for (const id of only) assert.ok(unhirableHeroes(land).includes(id) && !unhirableHeroes(sea).includes(id), `${HERO_INFO[id].name}`);
  for (const id of never) assert.ok(!unhirableHeroes(land).includes(id) && unhirableHeroes(sea).includes(id), `${HERO_INFO[id].name}`);
  assert.ok(unhirableHeroes({ ...land, bannedHeroes: [7] }).includes(7));
});

test("map portraits: classic, spare and HotA's own", () => {
  assert.equal(mapPortrait(0), HERO_PORTRAITS[0]);
  assert.equal(mapPortrait(156), "hpl129mk");
  assert.equal(mapPortrait(185), "editorPortraits/HPL116BX.png");
  assert.equal(mapPortrait(163), HERO_PORTRAITS[156]);
  assert.equal(mapPortrait(999), undefined);
});

const MAP = "Good Witch, Bad Witch.h3m";
const mapDir = (process.env.HEROES_MAP_DIRS ?? "").split(":").find((d) => d && existsSync(join(d, MAP)));

test("a map's heroes keep the author's name, portrait, skills and level", { skip: !mapDir && "needs the game maps (HEROES_MAP_DIRS)" }, () => {
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, MAP))));
  assert.ok(map.bannedHeroes && map.bannedHeroes.length > 0, "the map bans some heroes");
  const { state: s } = createAdventure(map, data, { seed: 1, mapFile: MAP, controllers: map.players.map((p) => (p.canHuman || p.canComputer ? "human" : "none")) });
  const glinda = s.heroes.find((h) => h.name === "Glinda")!;
  assert.ok(glinda, "Glinda is on the map");
  assert.equal(glinda.portrait, HERO_PORTRAITS[139]);
  for (const k of [0, 4, 7]) assert.ok(glinda.skills?.some(([x]) => x === k), `skill ${k}`);
  assert.ok(glinda.level > 1 && glinda.experience === 2000, `level ${glinda.level}`);
  assert.equal(s.heroes.find((h) => h.name === "Gulcheria")?.portrait, HERO_PORTRAITS[94]);
  for (const id of map.bannedHeroes!) assert.ok(s.unhirable?.includes(id));
});

// ---- The tavern pool (heroes.thelazy.net Tavern, Combat; VCMI's HeroPoolProcessor) ----

function game(seed = 4) {
  const name = randomMapName({ size: 36, players: 2, humans: 1, monsters: 1, seed });
  const map = generateRandomMap(data, parseRandomMapName(name)!);
  return createAdventure(map, data, { seed: 1, mapFile: name, controllers: map.players.map((p, i) => (!p.canHuman && !p.canComputer ? "none" : i === 0 ? "human" : "ai")) });
}
const classOf = (id: number) => HERO_CLASSES[HERO_INFO[id].heroClass];

test("tavern: two heroes of two classes, the left one of the player's faction, new ones every week", () => {
  const { state: s, world: w } = game();
  const p = s.players[0];
  const weeks: number[][] = [];
  for (let week = 0; week < 6; week++) {
    const [own, any] = p.tavern!;
    assert.equal(classOf(own).faction, p.faction, `week ${week + 1}: ${HERO_INFO[own].name} is of the player's faction`);
    assert.notEqual(HERO_INFO[own].heroClass, HERO_INFO[any].heroClass, "two classes");
    assert.deepEqual(p.tavernRoles, [{ role: "full" }, { role: "full" }]);
    weeks.push([own, any]);
    do newDay(s, w);
    while ((s.day - 1) % 7 !== 0);
  }
  assert.ok(new Set(weeks.map((x) => x.join())).size >= 5, `new heroes each week: ${JSON.stringify(weeks)}`);
});

test("tavern: a hired hero's place is taken at once by one with a single creature; the other stays", () => {
  const { state: s, world: w } = game();
  const p = s.players[0];
  const town = s.objects.find((o) => o.town && o.owner === 0)!;
  if (!town.town!.built.includes(B.TAVERN)) town.town!.built.push(B.TAVERN);
  for (const h of s.heroes) if (h.owner === 0) h.x = (h.x + 5) % w.size;
  p.resources[6] = 10000;
  const [first, second] = p.tavern!;
  applyAdventureAction(s, w, { type: "hireHero", town: town.id, slot: 0 }, 0);
  const hired = s.heroes.find((h) => h.type === first && !h.removed)!;
  assert.ok(hired.army.filter(Boolean).length >= 1, "the week's hero comes with its army");
  assert.equal(p.tavern![1], second, "the other hero stays");
  assert.notEqual(p.tavern![0], first);
  assert.deepEqual(p.tavernRoles![0], { role: "single" });
  const next = p.tavern![0];
  for (const h of s.heroes) if (h.owner === 0 && !h.removed) h.x = (h.x + 3) % w.size;
  applyAdventureAction(s, w, { type: "hireHero", town: town.id, slot: 0 }, 0);
  const late = s.heroes.find((h) => h.type === next && !h.removed)!;
  assert.deepEqual(late.army.filter(Boolean).map((a) => a!.count), [1], "a later hire: one creature");
});

test("tavern: a hire brings the army its preview showed (a week's hero, a later one-creature one, a returned one)", () => {
  const { state: s, world: w } = game();
  const p = s.players[0];
  const town = s.objects.find((o) => o.town && o.owner === 0)!;
  if (!town.town!.built.includes(B.TAVERN)) town.town!.built.push(B.TAVERN);
  p.resources[6] = 100000;
  const away = () => {
    for (const h of s.heroes) if (h.owner === 0 && !h.removed) h.x = (h.x + 3) % w.size;
  };
  for (let round = 0; round < 4; round++) {
    away();
    const type = p.tavern![0];
    // The preview, as the client makes it: on a copy of the state, many times.
    const shown = JSON.stringify(tavernArmy(structuredClone(s), 0, 0));
    for (let k = 0; k < 5; k++) assert.equal(JSON.stringify(tavernArmy(structuredClone(s), 0, 0)), shown, "the preview is the same each time");
    applyAdventureAction(s, w, { type: "hireHero", town: town.id, slot: 0 }, 0);
    const hired = s.heroes.find((h) => h.type === type && !h.removed)!;
    assert.equal(JSON.stringify(hired.army), shown, `round ${round}: the hire brings what the preview showed`);
    if (round === 0) assert.ok(hired.army[0]!.count > 1, "a week's hero: its own army");
    else assert.deepEqual(hired.army.filter(Boolean).map((a) => a!.count), [1], "a later hire: one creature");
  }
  // A hero back from a retreat with no army: one creature of their first stack, as the preview shows.
  const gone = s.heroes.find((h) => h.owner === 0 && !h.removed)!;
  Object.assign(gone, { removed: true, retired: true, army: Array(7).fill(null) });
  tavernReturn(s, 0, gone.type, "retreated", false);
  const slot = p.tavern!.indexOf(gone.type);
  const shown = JSON.stringify(tavernArmy(structuredClone(s), 0, slot));
  away();
  applyAdventureAction(s, w, { type: "hireHero", town: town.id, slot }, 0);
  assert.equal(JSON.stringify(gone.army), shown, "the returned hero: as the preview showed");
  assert.deepEqual(gone.army.filter(Boolean).map((a) => a!.count), [1]);
});

test("tavern: a hired hero comes with its starting kit (Rion's first aid tent, Christian's ballista, a cleric's spellbook)", () => {
  const { state: s, world: w } = game();
  const p = s.players[0];
  const town = s.objects.find((o) => o.town && o.owner === 0)!;
  if (!town.town!.built.includes(B.TAVERN)) town.town!.built.push(B.TAVERN);
  p.resources[6] = 10000;
  for (const type of [8, 6]) {
    for (const h of s.heroes) if (h.owner === 0 && !h.removed) h.x = (h.x + 5) % w.size;
    s.heroes = s.heroes.filter((h) => h.type !== type);
    p.tavern![0] = type;
    applyAdventureAction(s, w, { type: "hireHero", town: town.id, slot: 0 }, 0);
    const h = s.heroes.find((x) => x.type === type && !x.removed)!;
    assert.ok(h.equipped!.includes(type === 8 ? 6 : 4), `${h.name}: ${type === 8 ? "first aid tent" : "ballista"}`);
    assert.ok(h.equipped!.includes(3), "the catapult");
    if (type === 8) assert.ok(h.spells && h.equipped!.includes(0), "the spellbook");
  }
});

test("tavern: a hero back from battle takes the slot worth least, and one attacked on day 7 stays into the week", () => {
  const { state: s, world: w } = game();
  const p = s.players[0];
  p.tavernRoles = [{ role: "full" }, { role: "single" }];
  const hero = s.heroes.find((h) => h.owner === 0)!;
  tavernReturn(s, 0, hero.type, "retreated", false);
  assert.equal(p.tavern![1], hero.type, "instead of the one-creature hire");
  const other = 2 + s.heroes.length;
  tavernReturn(s, 0, other, "surrendered", false);
  assert.equal(p.tavern![0], other, "instead of the week's hero, not the retreated one");
  assert.deepEqual(p.tavernRoles, [{ role: "surrendered" }, { role: "retreated" }]);
  while (s.day % 7 !== 0) newDay(s, w);
  const before = [...p.tavern!];
  const late = s.heroes.find((h) => h.owner === 1)!.type;
  tavernReturn(s, 0, late, "retreated", true);
  const at = p.tavern!.indexOf(late);
  assert.deepEqual(p.tavernRoles![at], { role: "retreated", keep: true });
  newDay(s, w);
  assert.equal(p.tavern![at], late, "attacked on day 7: still there in the new week");
  assert.ok(!before.includes(p.tavern![1 - at]), "the other slot is new");
  assert.deepEqual(p.tavernRoles![at], { role: "retreated" });
});

test("tavern (HotA): heroes who fell in battle with levels gained don't come back while others can", () => {
  const { state: s } = game();
  const fallen = s.heroes.find((h) => h.owner === 0)!;
  fallen.removed = true;
  fallen.level = 5;
  for (let i = 0; i < 300; i++) assert.notEqual(pickTavernHero(s, 0, i % 2 === 0), fallen.type);
});

const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
test("tavern odds from HotA's HCTRAITS.TXT", { skip: !dataDirs.length && "needs the game files (HEROES_DATA_DIRS)" }, async () => {
  const { ResourceStore } = await import("@heroes/formats/node");
  const store = new ResourceStore(dataDirs, []);
  const real = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const odds = real.classTavernOdds!;
  assert.equal(odds[0].castle, 6, "Knights in Castle's taverns");
  assert.equal(odds[1].necropolis, 5, "Clerics in Necropolis'");
  assert.equal(odds[18]?.cove, 6, "Captains in Cove's");
});

test("a hero the map's loss condition names can't be dismissed (VCMI's isMissionCritical)", () => {
  const o = { size: 36, players: 2, humans: 1, monsters: 1, seed: 1 };
  const { state: s, world: w } = createAdventure(generateRandomMap(data, o), data, { seed: 1, mapFile: randomMapName(o), controllers: ["human", "ai"] });
  w.refresh(s);
  const hero = s.heroes.find((x) => !x.removed && x.owner === 0)!;
  s.conditions = { ...s.conditions!, loss: { type: 1, hero: hero.id } };
  assert.throws(() => applyAdventureAction(s, w, { type: "dismiss", hero: hero.id }, 0), /loss|lose/i);
  s.conditions.loss = { type: -1 };
  applyAdventureAction(s, w, { type: "dismiss", hero: hero.id }, 0);
  assert.ok(hero.removed);
});

test("start: the hero a player picked is theirs, never an earlier player's random one (the owner's Craig Hack)", () => {
  const name = randomMapName({ size: 36, players: 2, humans: 1, monsters: 1, seed: 4 });
  const map = generateRandomMap(data, parseRandomMapName(name)!);
  const setup = { seed: 1, mapFile: name, controllers: map.players.map((p, i) => (!p.canHuman && !p.canComputer ? "none" : i === 0 ? "ai" : "human")) as ("human" | "ai" | "none")[] };
  const plain = createAdventure(map, data, setup).state;
  const drawn = plain.heroes.find((h) => h.owner === 0 && !h.removed)!.type;
  const { state: s } = createAdventure(map, data, { ...setup, choices: map.players.map((_, i) => (i === 1 ? { hero: drawn } : undefined)) });
  assert.equal(s.heroes.find((h) => h.owner === 1 && !h.removed)?.type, drawn, "the second player gets the hero picked");
  assert.notEqual(s.heroes.find((h) => h.owner === 0 && !h.removed)?.type, drawn, "the first draws another");
});

// The owner, 2026-11-03: "Brave New World is ignoring my starting hero pick" (its players start with a random
// hero standing on the map, not one the main town makes). VCMI's pickNextHeroType: a player's random hero
// is the hero they picked, if it is free.
const mapDirs = (process.env.HEROES_MAP_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
test("start: the hero a player picked is theirs on every map that lets them pick (Brave New World, Arrogance...)", { skip: !mapDirs.length && "needs the game maps (HEROES_MAP_DIRS)" }, async () => {
  const { readdirSync } = await import("node:fs");
  const files = mapDirs.flatMap((d) => readdirSync(d).filter((f) => /\.h3m$/i.test(f)).map((f) => join(d, f)));
  let checked = 0;
  const wrong: string[] = [];
  for (const file of files) {
    let map;
    try {
      map = parseH3m(gunzipSync(readFileSync(file)));
    } catch {
      continue;
    }
    const color = map.players.findIndex((p) => p.canHuman && (p.mainTown?.generateHero || p.randomHero));
    // (A named hero of theirs on the map is who they start as: nothing to pick, [HotA] A Cold Day In Hell.)
    if (color < 0 || map.objects.some((o) => o.id === 34 && o.data.owner === color)) continue;
    const controllers = map.players.map((p, i) => (i === color ? "human" : p.canComputer || p.canHuman ? "ai" : "none")) as ("human" | "ai" | "none")[];
    const mapFile = file.split("/").pop()!;
    const plain = createAdventure(map, data, { seed: 1, mapFile, controllers }).state;
    const first = plain.heroes.filter((h) => h.owner === color && !h.removed);
    if (!first.length) continue;
    // Pick a hero nobody has: the first of the player's faction absent from the plain start.
    const taken = new Set(plain.heroes.map((h) => h.type));
    const pick = [...Array(156).keys()].find((id) => !taken.has(id) && !(map.bannedHeroes ?? []).includes(id) && !HERO_INFO[id]?.special);
    if (pick === undefined) continue;
    let s;
    try {
      s = createAdventure(map, data, { seed: 1, mapFile, controllers, choices: map.players.map((_, i) => (i === color ? { hero: pick } : undefined)) }).state;
    } catch {
      continue;
    }
    checked++;
    if (!s.heroes.some((h) => h.owner === color && !h.removed && h.type === pick)) wrong.push(mapFile);
  }
  assert.ok(checked > 10, `maps checked: ${checked}`);
  assert.deepEqual(wrong, [], "maps where the picked hero isn't the player's");
});
