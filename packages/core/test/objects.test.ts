// Map objects on a real map, when the game files are present.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { parseH3m } from "@heroes/formats";
import { ResourceStore } from "@heroes/formats/node";
import { stepCost, cannotDig, adventureAiTurn, heroBonuses, type AdvObject, HERO_COST, levelUpOffer, experienceForLevel, MAX_LEVEL, randomArtifactPool, LOCKED, MACHINE_SLOT, assemblable, blacksmithMachine, initEquipment, monsterReaction, universityOffer, heroSpells, abandonedMine, TOWNS, visitTownSpecials, weeklyTownSpecials, marketCount, siegeBonuses, blackMarketStock, townIncome, SKILLS, stockGuild, siegeOf, rollPortal, timedEvents, thievesGuild, tavernLevel, SLOT, applyAdventureAction, buildGameData, effectivePrimary, giveArtifact, dwellingCreatures, dwellingPrice, findPaths, gainExperience, isRevealed, reveal, Obj, maxMovement, tradeRate, artifactOffer, BLACK_MARKET_MARKETS, JUNKMAN_MARKETS, creatureOffer, FREELANCER_MAP_MARKETS, visitTile, mapHeroesOf, createAdventure, finishBattle, maxMana, INTELLIGENCE, newDay, runAi, visit, mapData, splitMonster, UPGRADE_OF, AIRSHIP, airshipStop, isAirship, cannotBuildBoat, BANKS, dailyIncome, heroMoraleLuck, heroMoraleLuckParts, spawnMonthStacks, rollRefugees, raiseDead, fight, castRefusal, generateScene, parseSceneName, portalLinks, refreshMovement, GAME_LINE_FILES, captureObject, B } from "../src/index.ts";

const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const mapDir = (process.env.HEROES_MAP_DIRS ?? "").split(":").find((d) => d && existsSync(join(d, "Deluge.h3m")));
const skip = (!dataDirs.length || !mapDir) && "needs the game files (HEROES_DATA_DIRS, HEROES_MAP_DIRS)";

function setup() {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, "Deluge.h3m"))));
  const { state: s, world: w } = createAdventure(map, data, { seed: 7, mapFile: "Deluge.h3m", controllers: map.players.map((p) => (p.canHuman ? "human" : "none")) });
  const h = s.heroes.find((x) => !x.removed)!;
  return { s, w, h };
}

test("several level-ups at once: each pick's offer is drawn from the skills the hero has by then", { skip }, () => {
  const { s, w, h } = setup();
  h.levelUps = [];
  gainExperience(s, w, h, 20000);
  assert.ok(h.levelUps.length >= 3, "several offers waiting");
  // Always the first option: no pick may be wasted on a level the hero already has.
  while (h.levelUps.length) {
    const [id, level]: [number, number] = h.levelUps[0][0];
    const had: number = (h.skills ?? []).find(([k]) => k === id)?.[1] ?? 0;
    assert.equal(level, had + 1, `skill ${id} offered at ${level} with ${had}`);
    assert.equal(h.levelUps.length, h.levelUpPrimary?.length);
    applyAdventureAction(s, w, { type: "chooseSkill", hero: h.id, option: 0 }, h.owner);
  }
});

const ARCHANGEL = 13;
const PEASANT = 139;

/** Visits; a creature bank asks first, and the answer here is yes. */
function enter(s: Parameters<typeof visit>[0], w: Parameters<typeof visit>[1], h: Parameters<typeof visit>[2], o: Parameters<typeof visit>[3]) {
  const ev = visit(s, w, h, o);
  if (ev.some((e) => e.e === "offer" && e.kind === "attack")) return applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
  return ev;
}

test("creature bank: win plunders it once, a loss leaves the survivors on guard", { skip }, () => {
  const { s, w, h } = setup();
  const bank = s.objects.find((o) => o.type === 16 && o.subid === 5)!;
  assert.ok(bank, "Deluge has a Naga Bank");

  // A hopeless attack: the guards stay, minus nothing.
  h.army = [{ creature: PEASANT, count: 1 }, null, null, null, null, null, null];
  // War machines stay out of a creature-bank fight (HotA): the ballista must not reach the field.
  initEquipment(h);
  h.equipped![SLOT.MACH1] = 4;
  assert.equal(enter(s, w, h, bank)[0].e, "battle");
  assert.ok(!s.battles[h.owner]!.battle.units.some((u) => u.machine), "no war machines at a bank");
  const guards = bank.bank!.guards.reduce((a, g) => a + g.count, 0);
  s.battles[h.owner]!.battle.sides[0].controller = "ai";
  runAi(s.battles[h.owner]!.battle);
  finishBattle(s, w, h.owner);
  assert.equal(bank.bank!.cleared, undefined);
  assert.equal(bank.bank!.guards.reduce((a, g) => a + g.count, 0), guards);

  // A second hero with Archangels wins and gets the gems and gold.
  const h2 = s.heroes.find((x) => x.owner === h.owner && x.id !== h.id) ?? Object.assign(h, { removed: false });
  h2.army = [{ creature: ARCHANGEL, count: 50 }, null, null, null, null, null, null];
  const before = [...s.players[h2.owner].resources];
  enter(s, w, h2, bank);
  s.battles[h2.owner]!.battle.sides[0].controller = "ai";
  runAi(s.battles[h2.owner]!.battle);
  const events = finishBattle(s, w, h2.owner);
  assert.ok(bank.bank!.cleared);
  assert.ok(s.players[h2.owner].resources[5] > before[5], "gems");
  assert.ok(s.players[h2.owner].resources[6] > before[6], "gold");
  assert.ok(events.some((e) => e.e === "visit" && e.message.includes("plunders")));
  assert.equal(enter(s, w, h2, bank)[0].e, "visit", "no second fight");
});

test("creature banks as HotA: the strongest guards named, the dead's places lower morale again, the Black Tower and Ancient Altar fight as usual", { skip }, () => {
  const { s, w, h } = setup();
  const bank = s.objects.find((o) => o.type === 16 && o.subid === 5)!;
  const win = () => {
    h.army = [{ creature: ARCHANGEL, count: 60 }, null, null, null, null, null, null];
    h.movement = 5000;
    enter(s, w, h, bank);
    s.battles[h.owner]!.battle.sides[0].controller = "ai";
    runAi(s.battles[h.owner]!.battle);
    return finishBattle(s, w, h.owner);
  };
  // The Naga Bank: ADVEVENT 34 names the Nagas (or Naga Queens), the strongest guards.
  const naga = win().find((e) => e.e === "visit" && e.object === bank.id);
  assert.ok(naga?.e === "visit" && naga.text?.id === 34 && /^Naga/.test(String(naga.text.args?.[0])), "the strongest guards' name");
  // The Crypt: plundered, a second search lowers morale once, until the next battle.
  Object.assign(bank, { type: 84, subid: 0, bank: undefined });
  win();
  const again = visit(s, w, h, bank);
  assert.ok(again[0].e === "visit" && again[0].text?.id === 120);
  visit(s, w, h, bank);
  assert.equal(h.temp?.morale, -1, "once");
  // The Black Tower: war machines and Tactics as in any battle (heroes.thelazy.net).
  Object.assign(bank, { type: 16, subid: 27, bank: undefined });
  initEquipment(h);
  h.equipped![SLOT.MACH1] = 4;
  h.army = [{ creature: ARCHANGEL, count: 60 }, null, null, null, null, null, null];
  enter(s, w, h, bank);
  assert.ok(s.battles[h.owner]!.battle.units.some((u) => u.machine === "ballista"), "the ballista comes along");
  s.battles[h.owner]!.battle.sides[0].controller = "ai";
  runAi(s.battles[h.owner]!.battle);
  finishBattle(s, w, h.owner);
  assert.equal(h.temp, undefined, "gone after the battle");
  // The Ancient Altar: 25 Haspids keep the Horn of the Abyss.
  Object.assign(bank, { type: 146, subid: 4, bank: undefined });
  h.backpack = [];
  const ev = win();
  assert.ok(h.equipped?.includes(161) || h.backpack?.includes(161), "the Horn of the Abyss");
  assert.ok(ev.some((e) => e.e === "visit" && /Horn of the Abyss/.test(e.message)));
});

test("a dwelling's guards: after a lost fight only the survivors stand that week, renewed the next", { skip }, () => {
  const { s, w, h } = setup();
  const high = s.objects.find((o) => o.type === 17 && dwellingCreatures(o) && w.creatures[dwellingCreatures(o)![0]].level >= 5);
  if (!high) return;
  const full = w.creatures[dwellingCreatures(high)![0]].growth * 3;
  h.army = [{ creature: ARCHANGEL, count: 1 }, null, null, null, null, null, null];
  enter(s, w, h, high);
  const b = s.battles[h.owner]!.battle;
  b.units.find((u) => u.side === 1)!.count = 1; // (one left standing as the attacker falls)
  for (const u of b.units) if (u.side === 0) u.count = 0;
  b.winner = 1;
  finishBattle(s, w, h.owner);
  const h2 = s.heroes.find((x) => x.owner === h.owner && !x.removed) ?? Object.assign(h, { removed: false });
  h2.army = [{ creature: ARCHANGEL, count: 1 }, null, null, null, null, null, null];
  enter(s, w, h2, high);
  assert.equal(s.battles[h2.owner]!.battle.units.filter((u) => u.side === 1).reduce((a, u) => a + u.count, 0), 1);
  delete s.battles[h2.owner];
  while (s.day % 7 !== 1 || s.day === 1) newDay(s, w);
  enter(s, w, h2, high);
  assert.equal(s.battles[h2.owner]!.battle.units.filter((u) => u.side === 1).reduce((a, u) => a + u.count, 0), full, "renewed");
});

test("creature bank data: HotA's numbers (heroes.thelazy.net, CRBANKS.TXT)", () => {
  assert.deepEqual(BANKS["16:3"].levels[0].resources, [0, 2, 0, 0, 0, 0, 1000], "Imp Cache: 2 mercury");
  for (const def of Object.values(BANKS)) assert.equal(def.levels.reduce((a, l) => a + l.chance, 0), 100, `${def.name}: chances add up`);
  assert.deepEqual(BANKS["16:26"].levels[0].guards[2], [114, 7, 129, 50], "Red Tower: Energy Elementals half the time");
  assert.deepEqual(BANKS["16:21"].levels[0].guards[2], [74, 10, 75, 50], "Beholders' Sanctuary: Evil Eyes");
  assert.deepEqual(BANKS["16:23"].levels[0].guards[0], [157, 10, 158, 50], "Pirate Cavern: the first Pirates may be Corsairs");
  assert.deepEqual(BANKS["16:21"].levels.map((l) => [l.resources?.[6], l.artifacts?.[0]]), [[3000, "MINOR"], [5000, "MINOR"], [6000, "MAJOR"], [9000, "MAJOR"]]);
  assert.deepEqual(BANKS["16:22"].levels[0].artifacts, ["TREASURE", "TREASURE", "MINOR", "RELIC"]);
  assert.ok(BANKS["16:27"].ordinary && BANKS["146:4"].ordinary && !BANKS["16:5"].ordinary);
  assert.ok(BANKS["16:26"].ask?.includes("Firebirds"), "HotA's banks speak their own lines");
  // Every bank has its formation, but those fought as ordinary battles.
  for (const def of Object.values(BANKS)) assert.ok(!!def.layout !== !!def.ordinary, `${def.name}: one formation`);
});

test("banks fight on their own formations; the Pyramid as an ordinary battle whose golems come back", { skip }, () => {
  const { s, w, h } = setup();
  const bank = s.objects.find((o) => o.type === 16 && o.subid === 5)!;
  const enemies = () => s.battles[h.owner]!.battle.units.filter((u) => u.side === 1).map((u) => u.pos);
  const lose = () => {
    const b = s.battles[h.owner]!.battle;
    for (const u of b.units) if (u.side === 0) u.count = 0;
    b.winner = 1;
    finishBattle(s, w, h.owner);
    Object.assign(h, { removed: false, retired: false });
  };
  // The Red Tower's Fire Elementals take one hex, but stand as the wide banks' guards (the HotA mod's creatureBankWide).
  Object.assign(bank, { type: 16, subid: 26, bank: undefined });
  h.army = [{ creature: PEASANT, count: 1 }, null, null, null, null, null, null];
  enter(s, w, h, bank);
  assert.deepEqual(enemies(), [15, 185, 171, 1, 100]);
  lose();
  // The Churchyard: six stacks of Zombies, three along the top, three along the bottom.
  Object.assign(bank, { type: 16, subid: 29, bank: undefined });
  h.army = [{ creature: PEASANT, count: 1 }, null, null, null, null, null, null];
  enter(s, w, h, bank);
  assert.deepEqual(enemies(), [14, 184, 172, 2, 8, 178]);
  lose();
  // The Pyramid: its golems on the usual right-hand side, all back after the hero falls.
  Object.assign(bank, { type: 63, subid: 0, bank: undefined });
  h.army = [{ creature: ARCHANGEL, count: 3 }, null, null, null, null, null, null];
  enter(s, w, h, bank);
  assert.ok(enemies().every((p) => p % 17 >= 14), "the golems on the right");
  s.battles[h.owner]!.battle.units.find((u) => u.side === 1)!.count = 1;
  lose();
  assert.equal(bank.bank!.guards.reduce((a, g) => a + g.count, 0), 60, "every golem back");
  // Searched once empty: luck -2 until the next battle, once.
  bank.bank!.cleared = true;
  h.temp = undefined;
  assert.equal(visit(s, w, h, bank)[0].e, "visit");
  visit(s, w, h, bank);
  assert.equal((h.temp as { luck: number } | undefined)?.luck, -2);
  // The Ruins, plundered: their own line, and the land around still comes into view from the tower.
  Object.assign(bank, { type: 16, subid: 32, bank: { cleared: true, guards: [] } });
  s.players[h.owner].revealed.fill(0);
  const ev = visit(s, w, h, bank);
  assert.ok(ev[0].e === "visit" && ev[0].message.startsWith("Wind whistling"));
  const x = bank.x + 10 < w.size ? bank.x + 10 : bank.x - 10;
  assert.ok(isRevealed(s, h.owner, w.index(x, bank.y, bank.z)), "12 tiles around");
});

test("Mystical Garden pays once a week; School of Magic once per hero for 1000 gold", { skip }, () => {
  const { s, w, h } = setup();
  const garden = s.objects.find((o) => o.type === 55)!;
  const r = s.players[h.owner].resources;
  const total = () => r[5] + r[6];
  let t = total();
  visit(s, w, h, garden);
  assert.ok(total() > t);
  t = total();
  visit(s, w, h, garden);
  assert.equal(total(), t, "nothing more this week");
  while (s.day % 7 !== 1 || s.day === 1) newDay(s, w);
  visit(s, w, h, garden);
  assert.ok(total() > t, "refilled next week");

  const school = s.objects.find((o) => o.type === 47)!;
  r[6] = 5000;
  const skills = h.primary[2] + h.primary[3];
  const knowledge = h.primary[3];
  visit(s, w, h, school);
  // A human player picks the skill; the AI takes the weaker one at once.
  if (h.offer) applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true, option: 3 }, h.owner);
  assert.equal(h.primary[2] + h.primary[3], skills + 1);
  if (s.players[h.owner].controller === "human") assert.equal(h.primary[3], knowledge + 1, "the chosen skill");
  assert.equal(r[6], 4000);
  visit(s, w, h, school);
  assert.equal(r[6], 4000, "once per hero");
});

test("tavern: hire a hero into the town gate for 2500 gold; the offer refills", { skip }, () => {
  const { s, w, h } = setup();
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  assert.ok(town, "the player starts with a town");
  for (const x of s.heroes) if (x.owner === h.owner) x.removed = true; // lost every hero
  const r = s.players[h.owner].resources;
  r[6] = 10000;
  const offer = [...s.players[h.owner].tavern!];
  assert.equal(offer.length, 2);
  const count = s.heroes.length;
  applyAdventureAction(s, w, { type: "hireHero", town: town.id, slot: 1 }, h.owner);
  const hired = s.heroes[count];
  assert.equal(hired.type, offer[1]);
  assert.equal(hired.owner, h.owner);
  assert.ok(hired.army.some((a) => a), "comes with an army");
  assert.ok(hired.movement > 0);
  assert.equal(r[6], 10000 - HERO_COST);
  assert.equal(s.players[h.owner].tavern![0], offer[0], "the other hero stays");
  assert.notEqual(s.players[h.owner].tavern![1], offer[1], "a new hero takes the slot");
  // The gate is now occupied.
  assert.throws(() => applyAdventureAction(s, w, { type: "hireHero", town: town.id, slot: 0 }, h.owner), /gate/);
});

test("map dwellings: flag and recruit (level 1 free), level 5+ guarded, weekly growth", { skip }, () => {
  const { s, w, h } = setup();
  const dwellings = s.objects.filter((o) => o.type === 17 && dwellingCreatures(o));
  const low = dwellings.find((o) => w.creatures[dwellingCreatures(o)![0]].level < 5)!;
  assert.ok(low, "Deluge has a low-level dwelling");
  const c = w.creatures[dwellingCreatures(low)![0]];
  const events = visit(s, w, h, low);
  assert.ok(events.some((e) => e.e === "dwelling"));
  assert.equal(low.owner, h.owner);
  assert.equal(low.dwelling!.available[0], c.growth);
  // Stand next to it and buy everything.
  w.refresh(s);
  const gate = w.visitBy.findIndex((v) => v === low.id + 1);
  [h.x, h.y, h.z] = [(gate % w.size) - 1, Math.floor(gate / w.size) % w.size, Math.floor(gate / (w.size * w.size))];
  h.army = [null, null, null, null, null, null, null];
  const r = s.players[h.owner].resources;
  r.fill(100000);
  applyAdventureAction(s, w, { type: "recruitDwelling", hero: h.id, object: low.id, slot: 0, count: c.growth }, h.owner);
  assert.equal(h.army[0]?.count, c.growth);
  assert.equal(low.dwelling!.available[0], 0);
  if (c.level === 1) assert.equal(r[6], 100000, "level 1 is free");
  else assert.equal(r[6], 100000 - c.cost[6] * c.growth);
  assert.throws(() => applyAdventureAction(s, w, { type: "recruitDwelling", hero: h.id, object: low.id, slot: 0, count: 1 }, h.owner));
  // Flagged dwellings accumulate (HotA).
  while (s.day % 7 !== 1 || s.day === 1) newDay(s, w);
  assert.equal(low.dwelling!.available[0], c.growth);
  while (s.day % 7 !== 1 || s.day <= 8) newDay(s, w);
  assert.equal(low.dwelling!.available[0], 2 * c.growth);

  // A full army (2026-11-03: not refused silently): they wait in the "make room" window; those left there go back
  // to the dwelling, their price refunded.
  s.players[h.owner].controller = "human";
  const others = w.creatures.filter((x) => x && x.id !== c.id && x.level === 1).slice(0, 7).map((x) => x.id);
  h.army = others.map((id) => ({ creature: id, count: 1 }));
  const gold = r[6];
  const ev = applyAdventureAction(s, w, { type: "recruitDwelling", hero: h.id, object: low.id, slot: 0, count: 2 }, h.owner);
  assert.ok(ev.some((e) => e.e === "joiners"), "the make-room window, not a refusal");
  assert.equal(h.joiners?.[0]?.count, 2);
  assert.equal(low.dwelling!.available[0], 2 * c.growth - 2);
  // Room made for one of them (the hero's last stack moved up), the other left behind.
  applyAdventureAction(s, w, { type: "moveJoiners", hero: h.id, from: { who: "hero", slot: 6 }, to: { who: "joiners", slot: 1 } }, h.owner);
  applyAdventureAction(s, w, { type: "moveJoiners", hero: h.id, from: { who: "joiners", slot: 0 }, to: { who: "hero", slot: 6 }, count: 1 }, h.owner);
  assert.deepEqual(h.army[6], { creature: c.id, count: 1 });
  applyAdventureAction(s, w, { type: "closeJoiners", hero: h.id }, h.owner);
  assert.equal(h.joiners, undefined);
  assert.equal(low.dwelling!.available[0], 2 * c.growth - 1, "the one left goes back");
  assert.equal(r[6], gold - dwellingPrice(w, low, c.id)[6], "only the one taken is paid for");

  const high = dwellings.find((o) => w.creatures[dwellingCreatures(o)![0]].level >= 5);
  if (high) {
    s.players[h.owner].controller = "human";
    const asked = visit(s, w, h, high);
    // (ADVEVENT 421: the guards, and whether to fight them.)
    assert.ok(asked.some((e) => e.e === "offer" && e.kind === "attack" && e.textRef?.id === 421), "the original asks first");
    assert.deepEqual(applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: false }, h.owner), []);
    visit(s, w, h, high);
    const ev = applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
    assert.equal(ev[0].e, "battle", "level 5+ dwellings are guarded");
    assert.equal(h.offer, undefined);
    const b = s.battles[h.owner]!.battle;
    assert.equal(b.units.filter((u) => u.side === 1).reduce((a, u) => a + u.count, 0), w.creatures[dwellingCreatures(high)![0]].growth * 3);
  }
});

test("Subterranean Gates pair across levels; heroes go through and paths route via them", { skip }, () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, "Arrogance.h3m"))));
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: "Arrogance.h3m", controllers: map.players.map((p) => (p.canHuman ? "human" : "none")) });
  const gates = s.objects.filter((o) => o.type === 103);
  assert.ok(gates.length >= 2);
  for (const g of gates) if (g.link !== undefined) assert.notEqual(s.objects[g.link].z, g.z);
  const g = gates.find((x) => x.link !== undefined)!;
  const h = s.heroes.find((x) => !x.removed)!;
  // Stand next to the gate, with no guards around.
  for (const o of s.objects) if (o.type === 54) o.removed = true;
  w.refresh(s);
  const entrance = visitTile(w, g);
  const ex = entrance % w.size;
  const ey = Math.floor(entrance / w.size) % w.size;
  let placed = false;
  for (const [dx, dy] of [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1]]) {
    const i = w.index(ex + dx, ey + dy, g.z);
    if (i >= 0 && !w.blocked(i) && !w.visitBy[i] && w.map.tiles[i].terrain !== 8) {
      [h.x, h.y, h.z] = [ex + dx, ey + dy, g.z];
      placed = true;
      break;
    }
  }
  assert.ok(placed);
  w.refresh(s);
  const exit = visitTile(w, s.objects[g.link!]);
  assert.ok(findPaths(w, s, h).has(exit), "paths continue on the other level");
  h.movement = 2000;
  const ev = applyAdventureAction(s, w, { type: "move", hero: h.id, to: entrance }, h.owner);
  assert.ok(ev.some((e) => e.e === "teleport"));
  assert.equal(w.index(h.x, h.y, h.z), exit);
});

test("Artifact Merchants: prices by resource and marketplaces, as VCMI's IMarket", () => {
  // One marketplace: effectiveness 0.2, so a 1000-gold artifact costs 5000 gold, or 40 wood (worth 125 each when paying).
  assert.equal(artifactOffer(1, 1000, 6, "buy"), 5000);
  assert.equal(artifactOffer(1, 1000, 0, "buy"), 40);
  assert.equal(artifactOffer(1, 1000, 1, "buy"), 20);
  // Nine or more: effectiveness 0.6 at most.
  assert.equal(artifactOffer(9, 1200, 6, "buy"), 2000);
  assert.equal(artifactOffer(20, 1200, 6, "buy"), 2000);
  // Selling: price x effectiveness in the resource's own value, at least one.
  assert.equal(artifactOffer(1, 1000, 6, "sell"), 200);
  assert.equal(artifactOffer(9, 1000, 2, "sell"), 2);
  assert.equal(artifactOffer(1, 100, 5, "sell"), 1);
  // The Black Market: as five marketplaces, 2.5 times the price (heroes.thelazy.net).
  assert.equal(artifactOffer(BLACK_MARKET_MARKETS, 1000, 6, "buy"), 2500);
  // HotA's Junkman: as seven, half the price in gold.
  assert.equal(artifactOffer(JUNKMAN_MARKETS, 1000, 6, "sell"), 500);
});

test("Freelancer's Guild: share of the gold price by marketplaces, in any resource (VCMI, heroes.thelazy.net)", () => {
  // A Titan (5000 gold) sells for at most 5000 gold, 10 rare resources or 20 wood / ore.
  assert.equal(creatureOffer(8, 5000, 1, 6), 5000);
  assert.equal(creatureOffer(8, 5000, 1, 1), 10);
  assert.equal(creatureOffer(8, 5000, 1, 0), 20);
  // On the map, as five marketplaces: 70%.
  assert.equal(creatureOffer(FREELANCER_MAP_MARKETS, 100, 10, 6), 700);
  // One marketplace: 30%; a 60-gold Pikeman is worth 18 gold, and wood needs 14 of them.
  assert.equal(creatureOffer(1, 60, 1, 6), 18);
  assert.equal(creatureOffer(1, 60, 13, 0), 0);
  assert.equal(creatureOffer(1, 60, 28, 0), 2);
});

test("marketplace: wiki rates by number of marketplaces; trading needs one", { skip }, () => {
  const { s, w, h } = setup();
  assert.deepEqual(tradeRate(1, 6, 0), { give: 2500, get: 1 });
  assert.deepEqual(tradeRate(1, 0, 6), { give: 1, get: 25 });
  assert.deepEqual(tradeRate(9, 1, 6), { give: 1, get: 250 });
  assert.deepEqual(tradeRate(12, 3, 4), { give: 2, get: 1 });
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  town.town!.built = town.town!.built.filter((b) => b !== 14);
  assert.throws(() => applyAdventureAction(s, w, { type: "trade", from: 6, to: 0, lots: 1 }, h.owner), /Marketplace/);
  town.town!.built.push(14);
  const r = s.players[h.owner].resources;
  r[6] = 6000;
  r[0] = 0;
  applyAdventureAction(s, w, { type: "trade", from: 6, to: 0, lots: 2 }, h.owner);
  assert.equal(r[6], 1000);
  assert.equal(r[0], 2);
  assert.throws(() => applyAdventureAction(s, w, { type: "trade", from: 6, to: 0, lots: 1 }, h.owner), /enough/);
});

test("a hero on the shore meets one of ours sailing beside it (2026-10-28: no trade with a hero on a boat)", { skip }, () => {
  const { s, w, h } = setup();
  let shore = -1;
  let sea = -1;
  for (let i = 0; i < w.size * w.size && shore < 0; i++) {
    if (w.map.tiles[i].terrain !== 8 || w.blocked(i) || w.visitBy[i] || w.heroAt[i]) continue;
    const x = i % w.size;
    const y = Math.floor(i / w.size);
    const land = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => w.index(x + dx, y + dy, 0)).find((j) => j >= 0 && w.map.tiles[j].terrain !== 8 && !w.blocked(j) && !w.visitBy[j] && !w.heroAt[j]);
    if (land !== undefined) [shore, sea] = [land, i];
  }
  assert.ok(shore >= 0, "found a shore");
  const t = w.data.templates.find((x) => x.id === 8)!;
  s.objects.push({ id: s.objects.length, type: 8, subid: t.subid, def: t.def, x: (sea % w.size) + 1, y: Math.floor(sea / w.size), z: 0, block: t.blockMask, visit: t.visitMask, flat: false, owner: -1 });
  const sailor = s.heroes.find((x) => !x.removed && x.owner === h.owner && x.id !== h.id) ?? (s.heroes.push({ ...structuredClone(h), id: s.heroes.length, type: h.type + 1 }), s.heroes[s.heroes.length - 1]);
  [sailor.x, sailor.y, sailor.z, sailor.boat] = [sea % w.size, Math.floor(sea / w.size), 0, s.objects.length - 1];
  s.objects[sailor.boat].carriedBy = sailor.id;
  [h.x, h.y, h.z] = [shore % w.size, Math.floor(shore / w.size), 0];
  h.boat = undefined;
  h.movement = 1500;
  w.refresh(s);
  const events = applyAdventureAction(s, w, { type: "move", hero: h.id, to: sea }, h.owner);
  assert.ok(events.some((e) => e.e === "meet" && e.other === sailor.id), JSON.stringify(events));
  assert.equal(w.index(h.x, h.y, h.z), shore, "the hero stays on the shore");
  assert.equal(h.boat, undefined);
});

test("boats: boarding and coming ashore end the day; sailing uses sea movement; the boat stays at the shore", { skip }, () => {
  const { s, w, h } = setup();
  for (const o of s.objects) if (o.type === 54) o.removed = true;
  w.refresh(s);
  // A free water tile with land next to it: put a boat there and the hero on the land.
  const t = w.data.templates.find((x) => x.id === 8)!;
  let shore = -1;
  let sea = -1;
  for (let i = 0; i < w.size * w.size && shore < 0; i++) {
    if (w.map.tiles[i].terrain !== 8 || w.blocked(i) || w.visitBy[i]) continue;
    const x = i % w.size;
    const y = Math.floor(i / w.size);
    // Needs more water next to it to sail on, and clear land to start from.
    const near = (dx: number, dy: number) => w.index(x + dx, y + dy, 0);
    const land = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => near(dx, dy)).find((j) => j >= 0 && w.map.tiles[j].terrain !== 8 && !w.blocked(j) && !w.visitBy[j]);
    const water = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => near(dx, dy)).find((j) => j >= 0 && w.map.tiles[j].terrain === 8 && !w.blocked(j) && !w.visitBy[j]);
    if (land !== undefined && water !== undefined) [shore, sea] = [land, i];
  }
  assert.ok(shore >= 0, "found a shore");
  const sx = sea % w.size;
  const sy = Math.floor(sea / w.size);
  s.objects.push({ id: s.objects.length, type: 8, subid: t.subid, def: t.def, x: sx + 1, y: sy, z: 0, block: t.blockMask, visit: t.visitMask, flat: false, owner: -1 });
  const boat = s.objects[s.objects.length - 1];
  [h.x, h.y, h.z] = [shore % w.size, Math.floor(shore / w.size), 0];
  h.movement = 1500;
  w.refresh(s);
  applyAdventureAction(s, w, { type: "move", hero: h.id, to: sea }, h.owner);
  assert.equal(h.boat, boat.id, "boarded");
  assert.equal(h.movement, 0);
  assert.equal(w.index(h.x, h.y, h.z), sea);
  newDay(s, w);
  assert.equal(h.movement, 1500, "sea movement");
  // Back to the shore: the boat stays on the water tile we left from.
  applyAdventureAction(s, w, { type: "move", hero: h.id, to: shore }, h.owner);
  assert.equal(h.boat, undefined, "ashore");
  assert.equal(h.movement, 0);
  assert.equal(w.visitBy[sea], boat.id + 1, "boat left at the shore");
  // The Admiral's Hat carries the rest of the day over, by the pools fixed when the day began: faster
  // troops picked up on the way gain nothing (HotA; the original's endless-movement loop).
  newDay(s, w);
  h.equipped = [];
  giveArtifact(h, w.data.artifacts, 136);
  h.army = [{ creature: 0, count: 1 }, null, null, null, null, null, null];
  newDay(s, w);
  const land = h.movement;
  assert.equal(land, h.pools!.land);
  applyAdventureAction(s, w, { type: "move", hero: h.id, to: sea }, h.owner);
  assert.equal(h.boat, boat.id, "boarded again");
  assert.ok(h.movement > 0, "the hat keeps the points");
  // At sea, faster troops (as from a hero met there): the land pool they'd give is bigger.
  h.army = [{ creature: 13, count: 1 }, null, null, null, null, null, null];
  refreshMovement(s, w);
  applyAdventureAction(s, w, { type: "move", hero: h.id, to: shore }, h.owner);
  assert.equal(h.boat, undefined, "ashore again");
  assert.ok(h.movement < land, `no more than the day began with (${h.movement} of ${land})`);
});

test("HotA's Airship: boarded on land, it flies over water on land movement, can't stop over the sea, and lands on clear ground; the Airship Yard sells one for 5000 gold and 20 wood", { skip }, () => {
  const { s, w, h } = setup();
  for (const o of s.objects) if (o.type === 54) o.removed = true;
  w.refresh(s);
  const t = w.data.templates.find((x) => x.id === 8)!;
  // Two clear land tiles side by side by the sea: the hero on one, the airship on the other.
  const clear = (j: number) => j >= 0 && airshipStop(w, s, j);
  let at = -1;
  let ship = -1;
  for (let i = 0; i < w.size * w.size && at < 0; i++) {
    const x = i % w.size;
    const y = Math.floor(i / w.size);
    const right = w.index(x + 1, y, 0);
    const sea = w.index(x + 2, y, 0);
    if (clear(i) && clear(right) && sea >= 0 && w.map.tiles[sea].terrain === 8 && !w.blocked(sea)) [at, ship] = [i, right];
  }
  assert.ok(at >= 0, "found land by the sea");
  // (A boat's entrance is the tile left of its corner, as in the boat test above.)
  s.objects.push({ id: s.objects.length, type: 8, subid: AIRSHIP, def: "avxair00.def", x: (ship % w.size) + 1, y: Math.floor(ship / w.size), z: 0, block: t.blockMask, visit: t.visitMask, flat: false, owner: -1 });
  const airship = s.objects[s.objects.length - 1];
  [h.x, h.y, h.z] = [at % w.size, Math.floor(at / w.size), 0];
  h.movement = 1500;
  w.refresh(s);
  assert.equal(w.visitBy[ship], airship.id + 1, "the airship stands by the hero");
  applyAdventureAction(s, w, { type: "move", hero: h.id, to: ship }, h.owner);
  assert.equal(h.boat, airship.id, "boarded");
  assert.ok(h.airship);
  assert.equal(h.movement, 0, "boarding takes the day");
  newDay(s, w);
  h.movement = h.maxMovement;
  assert.notEqual(h.maxMovement, 1500, "land movement, not the sea's");
  assert.equal(h.maxMovement, maxMovement(w, { ...h, boat: undefined, airship: undefined }));
  // Over the sea: it can fly there but not stop.
  const sea = ship + 1;
  assert.throws(() => applyAdventureAction(s, w, { type: "move", hero: h.id, to: sea }, h.owner), /can't stop there/);
  // A clear tile beyond the water, landed on from another clear tile.
  const paths = findPaths(w, s, h);
  const target = [...paths.entries()].find(([i, n]) => {
    if (n.passOnly || !clear(i) || n.prev < 0 || paths.get(n.prev)?.passOnly || n.prev === w.index(h.x, h.y, 0)) return false;
    for (let j = i; j >= 0; j = paths.get(j)!.prev) if (w.map.tiles[j].terrain === 8) return true;
    return false;
  });
  assert.ok(target, "somewhere across the water");
  const [to, node] = target!;
  applyAdventureAction(s, w, { type: "move", hero: h.id, to }, h.owner);
  assert.equal(w.index(h.x, h.y, 0), to, "flew over and landed");
  assert.equal(h.boat, undefined);
  assert.equal(h.airship, undefined);
  assert.equal(h.movement, 0, "landing takes the day");
  assert.equal(w.visitBy[node.prev], airship.id + 1, "the airship stays where the hero stepped down");

  // The Airship Yard: a shipyard (subtype 1) of ours builds an airship on clear ground by it.
  const yt = w.data.templates.find((x) => x.id === Obj.SHIPYARD)!;
  const yard: AdvObject = { id: s.objects.length, type: Obj.SHIPYARD, subid: 1, def: "avgairy0.def", x: h.x + 1, y: h.y + 1, z: 0, block: yt.blockMask, visit: yt.visitMask, flat: false, owner: h.owner };
  s.objects.push(yard);
  w.refresh(s);
  s.players[h.owner].resources = [0, 0, 0, 0, 0, 0, 99999];
  assert.match(cannotBuildBoat(s, w, yard, h.owner) ?? "", /20 Wood and 5000 Gold/);
  s.players[h.owner].resources = [25, 0, 0, 0, 0, 0, 6000];
  const n = s.objects.length;
  assert.equal(cannotBuildBoat(s, w, yard, h.owner), null);
  applyAdventureAction(s, w, { type: "buildBoat", object: yard.id }, h.owner);
  assert.equal(s.objects.length, n + 1);
  assert.ok(isAirship(s.objects[n]), "an airship");
  assert.ok(airshipStop(w, s, visitTile(w, s.objects[n])) || w.visitBy[visitTile(w, s.objects[n])] === n + 1, "on clear ground");
  assert.notEqual(w.map.tiles[visitTile(w, s.objects[n])].terrain, 8, "not on the water");
  assert.deepEqual([s.players[h.owner].resources[0], s.players[h.owner].resources[6]], [5, 1000]);
});

test("skills: starting skills, level-up offers for humans, Learning/Logistics/Estates take effect", { skip }, () => {
  const { s, w, h } = setup();
  assert.ok((h.skills ?? []).length > 0, "starting skills");
  const before = h.skills!.length;
  h.levelUps = [];
  gainExperience(s, w, h, 5000);
  assert.ok(h.level >= 4);
  assert.ok(h.levelUps.length >= 1, "offers waiting");
  for (const offer of h.levelUps) {
    assert.ok(offer.length >= 1 && offer.length <= 2);
    for (const [id, level] of offer) assert.ok(id >= 0 && id < 30 && level >= 1 && level <= 3);
  }
  const n = h.levelUps.length;
  applyAdventureAction(s, w, { type: "chooseSkill", hero: h.id, option: 0 }, h.owner);
  assert.equal(h.levelUps.length, n - 1);
  assert.ok(h.skills!.length >= before);
  // Logistics: +20% land movement at expert.
  const base = maxMovement(w, h);
  h.skills = h.skills!.filter(([id]) => id !== 2);
  const plain = maxMovement(w, h);
  h.skills.push([2, 3]);
  assert.equal(maxMovement(w, h), Math.floor(plain * 1.2));
  void base;
  // Estates: +1000 gold a day at expert.
  h.skills.push([13, 3]);
  const gold = s.players[h.owner].resources[6];
  newDay(s, w);
  assert.ok(s.players[h.owner].resources[6] >= gold + 1000);
});

test("HotA Dimension Door: landing in a monster's zone starts the fight", { skip }, () => {
  const { s, w, h } = setup();
  h.spells = [8];
  h.mana = 200;
  h.skills = [[15, 3]];
  h.movement = 2000;
  // A monster brought four tiles east of the hero; the door lands next to it.
  const monster = s.objects.find((o) => o.type === Obj.MONSTER && !o.removed)!;
  const at = (dx: number) => w.index(h.x + dx, h.y, h.z);
  [monster.x, monster.y, monster.z] = [h.x + 4, h.y, h.z];
  w.refresh(s);
  const dest = [3, 5].map(at).find((i) => i >= 0 && w.guardedBy[i] && !w.blocked(i) && !w.visitBy[i] && w.map.tiles[i].terrain !== 8);
  assert.ok(dest !== undefined, "a free tile in the zone");
  reveal(s, w, h.owner, h.x, h.y, h.z, 8);
  const ev = applyAdventureAction(s, w, { type: "castSpell", hero: h.id, spell: 8, target: dest }, h.owner);
  assert.equal(w.index(h.x, h.y, h.z), dest);
  assert.ok(ev.some((e) => e.e !== "spell"), "the guards react at once");
});

test("adventure spells: Dimension Door, Town Portal, Fly", { skip }, () => {
  const { s, w, h } = setup();
  h.spells = [6, 8, 9];
  h.mana = 200;
  h.skills = [[15, 3], [17, 3]]; // expert Air and Earth
  h.movement = 2000;
  w.refresh(s);
  // Dimension Door to a free revealed land tile nearby.
  let dest = -1;
  for (let d = 2; d <= 6 && dest < 0; d++) {
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
      const i = w.index(h.x + dx, h.y + dy, h.z);
      if (i >= 0 && w.map.tiles[i].terrain !== 8 && !w.blocked(i) && !w.visitBy[i] && !w.heroAt[i] && isRevealed(s, h.owner, i)) {
        dest = i;
        break;
      }
    }
  }
  assert.ok(dest >= 0);
  applyAdventureAction(s, w, { type: "castSpell", hero: h.id, spell: 8, target: dest }, h.owner);
  assert.equal(w.index(h.x, h.y, h.z), dest);
  assert.equal(h.movement, 1800, "expert: 200 movement");
  // Town Portal home.
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  applyAdventureAction(s, w, { type: "castSpell", hero: h.id, spell: 9 }, h.owner);
  assert.equal(w.visitBy[w.index(h.x, h.y, h.z)], town.id + 1);
  // Fly: water and obstacles become crossable (but not places to stop).
  const before = [...findPaths(w, s, h).values()].filter((n) => n.passOnly).length;
  applyAdventureAction(s, w, { type: "castSpell", hero: h.id, spell: 6 }, h.owner);
  const after = [...findPaths(w, s, h).values()].filter((n) => n.passOnly).length;
  assert.equal(before, 0);
  assert.ok(after > 0);
});

test("artifacts: picked up into a free slot, bonuses count, equip moves between slots and backpack", { skip }, () => {
  const { s, w, h } = setup();
  const axe = 7; // Centaur's Axe: +2 attack, right hand
  const before = effectivePrimary(h)[0];
  giveArtifact(h, w.data.artifacts, axe);
  assert.equal(h.equipped![SLOT.RIGHT_HAND], axe);
  assert.equal(effectivePrimary(h)[0], before + 2);
  applyAdventureAction(s, w, { type: "equip", hero: h.id, from: { slot: SLOT.RIGHT_HAND }, to: {} }, h.owner);
  assert.ok(h.backpack!.includes(axe));
  assert.equal(effectivePrimary(h)[0], before);
  assert.throws(() => applyAdventureAction(s, w, { type: "equip", hero: h.id, from: { backpack: h.backpack!.indexOf(axe) }, to: { slot: SLOT.HEAD } }, h.owner), /doesn't go/);
  applyAdventureAction(s, w, { type: "equip", hero: h.id, from: { backpack: h.backpack!.indexOf(axe) }, to: { slot: SLOT.RIGHT_HAND } }, h.owner);
  assert.equal(h.equipped![SLOT.RIGHT_HAND], axe);
});

test("map objects: temple morale until the next battle, Witch Hut, shrine, Tree of Knowledge, Magic Well", { skip }, () => {
  const { s, w, h } = setup();
  const make = (type: number, subid = 0) => {
    const o = { id: s.objects.length, type, subid, def: "", x: 0, y: 0, z: 0, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 0], flat: false, owner: -1 };
    s.objects.push(o);
    return o;
  };
  const temple = make(96);
  visit(s, w, h, temple);
  assert.equal(h.temp?.morale, s.day % 7 === 0 ? 2 : 1);
  visit(s, w, h, temple);
  assert.equal(h.temp?.morale, s.day % 7 === 0 ? 2 : 1, "once until the next battle");
  const hut = make(113);
  const before = h.skills!.length;
  h.skills = h.skills!.slice(0, 2);
  const asked = visit(s, w, h, hut);
  // HotA: the witch asks first; saying yes teaches the skill.
  assert.ok(asked.some((e) => e.e === "offer" && e.kind === "confirm"), "the witch asks first");
  applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
  assert.ok(h.skills.length === 3 || before >= 8, "learned a skill");
  const shrine = make(88);
  h.spells = [];
  visit(s, w, h, shrine);
  assert.equal(h.spells.length, 1);
  assert.equal(w.data.spells![h.spells[0]].level, 1);
  const tree = make(102, 0);
  const lvl = h.level;
  h.levelUps = [];
  visit(s, w, h, tree);
  assert.equal(h.level, lvl + 1);
  const well = make(49);
  h.mana = 0;
  visit(s, w, h, well);
  assert.ok(h.mana > 0);
});

test("Sirens: 30% of each stack rounded up, lone creatures safe, once per hero whichever Sirens", { skip }, () => {
  const { s, w, h } = setup();
  const make = () => {
    const o = { id: s.objects.length, type: 92, subid: 0, def: "", x: 0, y: 0, z: 0, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 0], flat: false, owner: -1 };
    s.objects.push(o);
    return o;
  };
  h.army = [{ creature: PEASANT, count: 11 }, { creature: ARCHANGEL, count: 1 }, { creature: PEASANT, count: 2 }, null, null, null, null];
  const xp = h.experience;
  visit(s, w, h, make());
  assert.deepEqual(h.army.map((a) => a?.count ?? 0), [7, 1, 1, 0, 0, 0, 0]);
  assert.ok(h.experience > xp, "experience for the drowned");
  visit(s, w, h, make());
  assert.deepEqual(h.army.map((a) => a?.count ?? 0), [7, 1, 1, 0, 0, 0, 0], "other Sirens leave the hero alone");
});

test("Lean To, Wagon and Skeleton stay on the map, empty after the first visitor", { skip }, () => {
  const { s, w, h } = setup();
  for (const [type, empty] of [[39, 65], [105, 156], [22, 38]]) {
    const o = { id: s.objects.length, type, subid: 0, def: "", x: 0, y: 0, z: 0, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 0], flat: false, owner: -1 } as AdvObject;
    s.objects.push(o);
    visit(s, w, h, o);
    assert.ok(!o.removed, `${type} stays`);
    const res = [...s.players[h.owner].resources];
    const again = visit(s, w, h, o);
    assert.equal(again.find((e) => e.e === "visit")?.text?.id, empty, `${type}: the empty line`);
    assert.deepEqual(s.players[h.owner].resources, res, `${type}: nothing the second time`);
  }
});

test("meeting heroes: walking into your own hero meets them; troops and artifacts can be traded", { skip }, () => {
  const { s, w, h } = setup();
  const t = s.heroes.find((x) => x.id !== h.id && !x.removed)!;
  // A second hero of ours right next to the first.
  w.refresh(s);
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
    .map(([dx, dy]) => [h.x + dx, h.y + dy])
    .find(([x, y]) => {
      const i = w.index(x, y, h.z);
      return i >= 0 && !w.blocked(i) && !w.visitBy[i] && !w.heroAt[i] && !w.guardedBy[i] && w.map.tiles[i].terrain !== 8;
    })!;
  const friend = { ...structuredClone(t), id: s.heroes.length, owner: h.owner, x: spot[0], y: spot[1], z: h.z, army: [{ creature: 0, count: 10 }, null, null, null, null, null, null], equipped: undefined, backpack: [7] };
  s.heroes.push(friend);
  w.refresh(s);
  h.movement = 1000;
  const ev = applyAdventureAction(s, w, { type: "move", hero: h.id, to: w.index(friend.x, friend.y, friend.z) }, h.owner);
  assert.ok(ev.some((e) => e.e === "meet"));
  const firstSlot = h.army.findIndex((x) => x);
  applyAdventureAction(s, w, { type: "transfer", heroes: [h.id, friend.id], kind: "army", from: { who: 1, slot: 0 }, to: { who: 0, slot: 6 }, count: 4 }, h.owner);
  assert.equal(h.army[6]?.count, 4);
  assert.equal(friend.army[0]?.count, 6);
  assert.throws(() => applyAdventureAction(s, w, { type: "transfer", heroes: [h.id, friend.id], kind: "army", from: { who: 1, slot: 0 }, to: { who: 0, slot: 6 } }, h.owner), /at least one/);
  applyAdventureAction(s, w, { type: "transfer", heroes: [h.id, friend.id], kind: "artifact", from: { who: 1, backpack: 0 }, to: { who: 0, slot: 3 } }, h.owner);
  assert.equal(h.equipped![3], 7);
  // Everything handed over at once: each hero keeps the catapult (no spare in the other's pack),
  // and Boots of Speed take their movement with them.
  h.equipped![SLOT.FEET] = 98;
  h.maxMovement = maxMovement(w, h);
  const [mine, theirs] = [h.maxMovement, friend.maxMovement];
  applyAdventureAction(s, w, { type: "exchangeAll", heroes: [h.id, friend.id], kind: "artifact", from: 0 }, h.owner);
  for (const x of [h, friend]) assert.equal(x.equipped![SLOT.MACH4], 3);
  assert.ok(!friend.backpack!.includes(3), "no second catapult");
  assert.equal(friend.equipped![SLOT.FEET], 98);
  assert.ok(h.maxMovement < mine && friend.maxMovement > theirs, `${mine} -> ${h.maxMovement}, ${theirs} -> ${friend.maxMovement}`);
  void firstSlot;
});

test("keymasters: the key lets you past border guards (gone) and gates", { skip }, () => {
  const { s, w, h } = setup();
  const make = (type: number, subid: number) => {
    const o: AdvObject = { id: s.objects.length, type, subid, def: "", x: h.x + 3, y: h.y, z: h.z, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 64], flat: false, owner: -1 };
    s.objects.push(o);
    return o;
  };
  const guard = make(9, 2);
  visit(s, w, h, guard);
  assert.ok(!guard.removed, "no key yet");
  visit(s, w, h, make(10, 2));
  assert.ok(s.players[h.owner].keys?.includes(2));
  visit(s, w, h, guard);
  assert.ok(!guard.removed, "a player is asked first");
  applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
  assert.ok(guard.removed, "the guard steps aside");
  const other = make(9, 5);
  visit(s, w, h, other);
  assert.ok(!other.removed, "a different colour still blocks");
});

test("grail: obelisks, digging (full day), the Grail building in town", { skip }, () => {
  const { s, w, h } = setup();
  assert.ok(s.grail, "a grail spot");
  const g = s.grail!;
  [h.x, h.y, h.z] = [g.x, g.y, g.z];
  h.movement = h.maxMovement - 1;
  assert.throws(() => applyAdventureAction(s, w, { type: "dig", hero: h.id }, h.owner), /whole day/);
  h.movement = h.maxMovement;
  applyAdventureAction(s, w, { type: "dig", hero: h.id }, h.owner);
  assert.ok(h.equipped?.includes(2) || h.backpack?.includes(2), "dug up the Grail");
  // The same hole again, a day later: "Try searching on clear ground." (GENRLTXT 97).
  h.movement = h.maxMovement;
  assert.equal(cannotDig(s, w, h)?.line, 97);
  assert.throws(() => applyAdventureAction(s, w, { type: "dig", hero: h.id }, h.owner), /clear ground/);
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  const gate = visitTile(w, town);
  [h.x, h.y] = [gate % w.size, Math.floor(gate / w.size) % w.size];
  visit(s, w, h, town);
  assert.ok(town.town!.built.includes(26), "Grail structure built");
  assert.ok(!(h.equipped ?? []).includes(2) && !(h.backpack ?? []).includes(2));
});

test("blacksmith sells the town's war machine to the visiting hero", { skip }, () => {
  const { s, w, h } = setup();
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  const gate = visitTile(w, town);
  [h.x, h.y, h.z] = [gate % w.size, Math.floor(gate / w.size) % w.size, town.z];
  w.refresh(s);
  if (!town.town!.built.includes(16)) town.town!.built.push(16);
  s.players[h.owner].resources[6] = 5000;
  const art = blacksmithMachine(town);
  h.equipped![MACHINE_SLOT[art]] = -1;
  applyAdventureAction(s, w, { type: "buyMachine", town: town.id }, h.owner);
  assert.equal(h.equipped![MACHINE_SLOT[art]], art);
  assert.ok(s.players[h.owner].resources[6] < 5000);
  assert.throws(() => applyAdventureAction(s, w, { type: "buyMachine", town: town.id }, h.owner), /already/);
});

test("water and misc objects: whirlpools, lighthouse, stables, refugee camp, sanctuary", { skip }, () => {
  const { s, w, h } = setup();
  const add = (type: number, subid = 0, dx = 3): AdvObject => {
    const o: AdvObject = { id: s.objects.length, type, subid, def: "", x: h.x + dx, y: h.y, z: h.z, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 64], flat: false, owner: -1 };
    s.objects.push(o);
    return o;
  };
  // Whirlpool: lands at the other one, half the weakest stack is gone.
  const a = add(111, 0, 3);
  const b = add(111, 0, 6);
  w.refresh(s);
  h.army = [{ creature: 0, count: 10 }, { creature: 13, count: 2 }, null, null, null, null, null];
  // (On foot nothing happens: only a boat is carried off.)
  assert.deepEqual(visit(s, w, h, a), []);
  h.boat = 0;
  visit(s, w, h, a);
  assert.equal(h.x, b.x - 1, "came out of the other whirlpool (its visit tile)");
  assert.equal(h.army[0]!.count, 5);
  // Lighthouse: +500 at sea.
  const lh = add(42, 0, 9);
  w.refresh(s);
  h.boat = 0;
  const before = maxMovement(w, h);
  visit(s, w, h, lh);
  assert.equal(maxMovement(w, h), before + 500);
  h.boat = undefined;
  // Stables (HotA): +300 on land this week.
  const st = add(94, 0, 12);
  w.refresh(s);
  const land = maxMovement(w, h);
  visit(s, w, h, st);
  assert.equal(maxMovement(w, h), land + 300);
  // Refugee Camp: some creature to buy.
  const camp = add(78, 0, 15);
  w.refresh(s);
  visit(s, w, h, camp);
  assert.ok(dwellingCreatures(camp)?.length === 1 && (camp.dwelling?.available[0] ?? 0) > 0);
});

test("university teaches for 2000, hill fort upgrades, factory sells machines, pyramid teaches a level 5 spell", { skip }, () => {
  const { s, w, h } = setup();
  const add = (type: number): AdvObject => {
    const o: AdvObject = { id: s.objects.length, type, subid: 0, def: "", x: h.x + 1, y: h.y, z: h.z, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 64], flat: false, owner: -1 };
    s.objects.push(o);
    w.refresh(s);
    return o;
  };
  s.players[h.owner].resources = [50, 50, 50, 50, 50, 50, 50000];
  const uni = add(104);
  const offer = universityOffer(s, uni);
  const skill = offer.find((k) => !h.skills?.some(([x]) => x === k))!;
  applyAdventureAction(s, w, { type: "learnSkill", hero: h.id, object: uni.id, skill }, h.owner);
  assert.ok(h.skills?.some(([k, l]) => k === skill && l === 1));
  uni.removed = true;
  const fort = add(35);
  h.army[0] = { creature: 0, count: 10 }; // Pikemen -> Halberdiers
  applyAdventureAction(s, w, { type: "upgradeStack", hero: h.id, object: fort.id, slot: 0 }, h.owner);
  assert.equal(h.army[0]!.creature, 1);
  fort.removed = true;
  const factory = add(106);
  h.equipped![SLOT.MACH3] = -1;
  applyAdventureAction(s, w, { type: "buyMachineAt", hero: h.id, object: factory.id, artifact: 6 }, h.owner);
  assert.equal(h.equipped![SLOT.MACH3], 6);
  assert.throws(() => applyAdventureAction(s, w, { type: "buyMachineAt", hero: h.id, object: factory.id, artifact: 146 }, h.owner), /not for sale/);
  // HotA's Cannon Yard (subtype 1) sells only the cannon, which takes the ballista's place.
  factory.removed = true;
  const yard = add(106);
  yard.subid = 1;
  h.equipped![SLOT.MACH1] = 4;
  assert.throws(() => applyAdventureAction(s, w, { type: "buyMachineAt", hero: h.id, object: yard.id, artifact: 5 }, h.owner), /not for sale/);
  const gold = s.players[h.owner].resources[6];
  applyAdventureAction(s, w, { type: "buyMachineAt", hero: h.id, object: yard.id, artifact: 146 }, h.owner);
  assert.equal(h.equipped![SLOT.MACH1], 146);
  assert.equal(s.players[h.owner].resources[6], gold - 4000);
});

test("wandering monsters: a weak, friendly stack joins or flees; a savage one fights", { skip }, () => {
  const { s, w, h } = setup();
  const o: AdvObject = { id: s.objects.length, type: 54, subid: 0, def: "", x: h.x + 2, y: h.y, z: h.z, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 64], flat: false, owner: -1, amount: 5 };
  s.objects.push(o);
  h.army = [{ creature: 13, count: 20 }, null, null, null, null, null, null]; // twenty Archangels
  o.data = { aggression: 1 };
  const r = monsterReaction(s, w, h, o);
  assert.ok(r.kind === "flee" || r.kind === "join" || r.kind === "pay", `got ${r.kind}`);
  o.data = { aggression: 10 };
  h.army = [{ creature: 0, count: 1 }, null, null, null, null, null, null];
  assert.equal(monsterReaction(s, w, h, o).kind, "fight");
  // Kin and Diplomacy make friendly Pikemen join for free.
  h.army = [{ creature: 0, count: 100 }, null, null, null, null, null, null];
  h.skills = [[4, 3]]; // Expert Diplomacy
  o.data = { aggression: 5 };
  assert.equal(monsterReaction(s, w, h, o).kind, "join");
});

test("wandering monsters: the easiest difficulty adds one join disposition (H3), capped at expert", { skip }, () => {
  const { s, w, h } = setup();
  // A huge non-kin army (high power factor) facing a tiny disposition-2 stack, hero with no Diplomacy.
  const o: AdvObject = { id: s.objects.length, type: 54, subid: 0, def: "", x: h.x + 2, y: h.y, z: h.z, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 64], flat: false, owner: -1, amount: 5 };
  s.objects.push(o);
  h.army = [{ creature: 13, count: 50 }, null, null, null, null, null, null]; // Archangels (not Pikemen)
  h.skills = [];
  o.data = { aggression: 2 };
  s.difficulty = 1; // Normal: no bonus => one short of their mood, they ask for gold.
  assert.equal(monsterReaction(s, w, h, o).kind, "pay");
  s.difficulty = 0; // Easy: +1 disposition => they join for free.
  assert.equal(monsterReaction(s, w, h, o).kind, "join");
});

test("wandering monsters: join at their mood, ask gold one or two short, flee further short (the HoMM3 wiki)", { skip }, () => {
  const { s, w, h } = setup();
  const o = s.objects.find((x) => x.type === Obj.MONSTER && !x.removed && x.subid !== 12 && x.subid !== 13)!;
  const md = mapData(w, o);
  for (const k of ["neverFlees", "noJoin", "joinOnlyForMoney", "joiningPercentage"]) delete md[k];
  o.amount = 5;
  s.difficulty = 1;
  h.primary = [0, 0, h.primary[2], h.primary[3]];
  h.army = [{ creature: 13, count: 50 }, null, null, null, null, null, null]; // overwhelming: strength 11
  // Diplomacy counts 1 (none) to 4 (expert); no kin here.
  const at = (mood: number, diplomacy: number) => {
    h.skills = diplomacy > 1 ? [[4, diplomacy - 1]] : [];
    o.data = { aggression: mood };
    return monsterReaction(s, w, h, o).kind;
  };
  assert.deepEqual([1, 2, 3, 4].map((m) => at(m, 1)), ["join", "pay", "pay", "flee"]);
  assert.deepEqual([4, 5, 6, 7].map((m) => at(m, 4)), ["join", "pay", "pay", "flee"]);
  // Never fleeing: they fight instead; joining only for money: the free join becomes a price.
  md.neverFlees = true;
  assert.equal(at(7, 4), "fight");
  delete md.neverFlees;
  md.joinOnlyForMoney = true;
  assert.equal(at(4, 4), "pay");
  delete md.joinOnlyForMoney;
  // Turned down, they run unless only just won over (charisma equal to their mood): then they fight.
  assert.equal(at(5, 4), "pay");
  assert.equal(monsterReaction(s, w, h, o, false).kind, "flee");
  // One of their own against one of them (kin 2): strength 0, expert Diplomacy 4 => charisma 6.
  h.army = [{ creature: o.subid, count: 1 }, null, null, null, null, null, null];
  o.amount = 1;
  assert.equal(at(6, 4), "join");
  assert.equal(monsterReaction(s, w, h, o, false).kind, "fight");
});

test("combination artifacts: the Elixir of Life from its three parts, locked slots, taken apart again", { skip }, () => {
  const { s, w, h } = setup();
  initEquipment(h);
  h.equipped![SLOT.RIGHT_RING] = 94;
  h.equipped![SLOT.LEFT_RING] = 95;
  h.equipped![SLOT.MISC1] = 96;
  assert.deepEqual(assemblable(h), [131]);
  applyAdventureAction(s, w, { type: "assemble", hero: h.id, artifact: 131 }, h.owner);
  assert.equal(h.equipped!.filter((a) => a === 131).length, 1);
  assert.equal(h.equipped!.filter((a) => a === LOCKED).length, 2);
  // The parts keep their own bonuses beside the combination's.
  assert.deepEqual(heroBonuses(h).filter((b) => b.type === "STACK_HEALTH").map((b) => b.val).sort((a, b) => a! - b!), [1, 1, 2, 25]);
  const slot = h.equipped!.indexOf(131);
  applyAdventureAction(s, w, { type: "disassemble", hero: h.id, slot }, h.owner);
  assert.ok([94, 95, 96].every((a) => h.equipped!.includes(a)));
  assert.equal(h.equipped!.filter((a) => a === LOCKED).length, 0);
});

test("Thieves' Guild: ranks players; a town shows more per tavern, the Den of Thieves everything", { skip }, () => {
  const { s, w, h } = setup();
  const other = s.players.findIndex((p, i) => i !== h.owner && p.alive && p.controller !== "none");
  s.players[h.owner].resources[6] = 50000;
  s.players[other].resources[6] = 100;
  const full = thievesGuild(s, w, 20);
  assert.deepEqual(full.rows[2][0], [h.owner], "richest first");
  assert.ok(full.rows[2].at(-1)!.includes(other));
  assert.ok(full.bestHero[full.players.indexOf(h.owner)]?.primary, "the Den shows the best hero's skills");
  // HotA's Diplomat's Cloak: the army counts three times (row 7).
  const rival = s.heroes.find((x) => !x.removed && x.owner === other);
  assert.ok(rival, "the rival has a hero");
  {
    for (const x of s.heroes) if (!x.removed && (x.owner === h.owner || x.owner === other) && x !== h && x !== rival) x.army = x.army.map(() => null);
    h.army = [{ creature: 0, count: 10 }, null, null, null, null, null, null];
    rival.army = [{ creature: 0, count: 20 }, null, null, null, null, null, null];
    assert.deepEqual(thievesGuild(s, w, 20).rows[7][0], [other]);
    h.equipped![SLOT.SHOULDERS] = 141;
    assert.deepEqual(thievesGuild(s, w, 20).rows[7][0], [h.owner]);
  }
  for (const t of s.objects) if (t.town) t.town.built = t.town.built.filter((b) => b !== 5);
  assert.equal(tavernLevel(s, h.owner), 0);
  const town = thievesGuild(s, w, 0);
  assert.ok(town.rows[0].length && !town.rows[2].length, "no taverns: only towns and heroes");
  assert.equal(town.bestHero[0], null);
});

test("HotA configurable objects: warehouses weekly, sea barrels once, lamps ask and need gold, HotA banks guard", { skip }, () => {
  const { s, w, h } = setup();
  const put = (type: number, subid: number) => {
    const o = structuredClone(s.objects.find((x) => !x.town && !x.removed)!);
    Object.assign(o, { id: s.objects.length, type, subid, data: {}, removed: false, owner: -1 });
    s.objects.push(o);
    return o;
  };
  const res = s.players[h.owner].resources;
  const wood = put(142, 0);
  const before = res[0];
  visit(s, w, h, wood);
  assert.equal(res[0], before + 10, "a warehouse of wood gives 10 wood");
  visit(s, w, h, wood);
  assert.equal(res[0], before + 10, "once a week");
  for (let i = 0; i < 7; i++) newDay(s, w);
  visit(s, w, h, wood);
  assert.equal(res[0], before + 20, "and again next week");

  const barrel = put(145, 1);
  const ev = visit(s, w, h, barrel);
  assert.ok(barrel.removed, "a sea barrel is taken");
  assert.ok(ev.some((e) => e.e === "visit" && e.message.includes("Sea Barrel")));

  s.players[h.owner].controller = "human";
  const lamp = put(145, 0);
  res[6] = 1000;
  const empty = visit(s, w, h, lamp);
  assert.ok(empty.some((e) => e.e === "visit"), "no gold: the genies won't come");
  res[6] = 5000;
  const ask = visit(s, w, h, lamp);
  assert.ok(ask.some((e) => e.e === "offer" && e.kind === "ask"));
  applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
  assert.ok(h.army.some((a) => a?.creature === 37), "Master Genies join");
  assert.ok(res[6] < 5000 && lamp.removed);

  const tower = put(16, 27);
  const fight = enter(s, w, h, tower);
  assert.ok(fight.some((e) => e.e === "battle" || e.e === "battleResult"), "the Black Tower's dragon fights");
});

test("Spell Scroll: its spell can be cast while the scroll is carried", { skip }, () => {
  const { s, w, h } = setup();
  h.spells ??= [];
  const scroll = structuredClone(s.objects.find((x) => !x.town && !x.removed)!);
  Object.assign(scroll, { id: s.objects.length, type: 93, subid: 0, removed: false, owner: -1 });
  s.objects.push(scroll);
  visit(s, w, h, scroll);
  assert.ok(scroll.removed);
  const spell = h.scrolls![0];
  assert.ok(heroSpells(h, w.data.spells ?? [])!.includes(spell) || h.spells.includes(spell));
  h.backpack = (h.backpack ?? []).filter((a) => a !== 1);
  h.equipped = (h.equipped ?? []).map((a) => (a === 1 ? -1 : a));
  if (!h.spells.includes(spell)) assert.ok(!heroSpells(h, w.data.spells ?? [])!.includes(spell), "gone with the scroll");
});

test("Abandoned Mine: Troglodytes guard it, then it mines one resource for its owner", { skip }, () => {
  const { s, w, h } = setup();
  const mine = structuredClone(s.objects.find((x) => !x.town && !x.removed)!);
  Object.assign(mine, { id: s.objects.length, type: 220, subid: 7, data: {}, removed: false, owner: -1 });
  s.objects.push(mine);
  // A player is asked first (ADVEVENT 84), then the guards fight.
  assert.equal(visit(s, w, h, mine)[0]?.e, "offer");
  const ev = applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
  assert.ok(ev.some((e) => e.e === "battle" || e.e === "battleResult"), "the guards fight");
  const lost = abandonedMine(s, w, mine)!;
  assert.equal(lost.guards[0].creature, 70);
  assert.ok(lost.guards[0].count >= 100 && lost.guards[0].count <= 199);
  lost.cleared = true;
  visit(s, w, h, mine);
  assert.equal(mine.owner, h.owner, "flagged after the guards are gone");
  const before = s.players[h.owner].resources[lost.resource];
  newDay(s, w);
  assert.ok(s.players[h.owner].resources[lost.resource] > before);
});

test("Altar of Sacrifice: evil heroes trade creatures, the rest artifacts, for experience", { skip }, () => {
  const { s, w, h } = setup();
  const altar = structuredClone(s.objects.find((x) => !x.town && !x.removed)!);
  Object.assign(altar, { id: s.objects.length, type: 2, subid: 0, removed: false, owner: -1 });
  s.objects.push(altar);
  s.objects.forEach(() => {});
  w.refresh(s);
  const at = (o: AdvObject) => {
    // stand on the altar's visit tile
    for (let i = 0; i < w.visitBy.length; i++) if (w.visitBy[i] === o.id + 1) return i;
    return -1;
  };
  const tile = at(altar);
  assert.ok(tile >= 0, "the altar has a visit tile");
  h.x = tile % w.size;
  h.y = Math.floor(tile / w.size) % w.size;
  h.heroClass = 10; // a Death Knight: evil
  h.army = [{ creature: 0, count: 10 }, { creature: 2, count: 5 }, null, null, null, null, null];
  const xp0 = h.experience;
  applyAdventureAction(s, w, { type: "sacrifice", hero: h.id, object: altar.id, stacks: [[1, 5]] }, h.owner);
  assert.equal(h.army[1], null);
  assert.ok(h.experience > xp0);
  assert.throws(() => applyAdventureAction(s, w, { type: "sacrifice", hero: h.id, object: altar.id, stacks: [[0, 10]] }, h.owner), /last/);
  h.army = [{ creature: 0, count: 10 }, { creature: 2, count: 5 }, null, null, null, null, null];
  assert.throws(() => applyAdventureAction(s, w, { type: "sacrifice", hero: h.id, object: altar.id, stacks: [[1, 5], [0, 10]] }, h.owner), /last/);
  assert.equal(h.army[1]?.count, 5, "a refused sacrifice takes nothing");
  h.heroClass = 0; // a Knight: artifacts
  h.backpack = [7];
  const xp1 = h.experience;
  applyAdventureAction(s, w, { type: "sacrifice", hero: h.id, object: altar.id, artifacts: [7] }, h.owner);
  assert.deepEqual(h.backpack, []);
  assert.ok(h.experience >= xp1 + 1000);
});

test("HotA objects from the wiki: Gazebo, Derrick, Mineral Spring, Hermit's Shack, Trailblazer", { skip }, () => {
  const { s, w, h } = setup();
  const put = (type: number, subid: number) => {
    const o = structuredClone(s.objects.find((x) => !x.town && !x.removed)!);
    Object.assign(o, { id: s.objects.length, type, subid, data: {}, removed: false, owner: -1 });
    s.objects.push(o);
    return o;
  };
  const res = s.players[h.owner].resources;
  // Gazebo: 1000 gold for 2000 experience, once per hero (a human player is asked).
  res[6] = 5000;
  const xp = h.experience;
  visit(s, w, h, put(144, 6));
  if (h.offer) applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
  assert.equal(res[6], 4000);
  assert.ok(h.experience >= xp + 2000);
  // Derrick: 500 gold in the first week.
  res[6] = 0;
  visit(s, w, h, put(144, 8));
  assert.equal(res[6], 500);
  // Mineral Spring: +600 movement and +1 luck, again only after a battle.
  const spring = put(144, 4);
  const mp = h.movement;
  visit(s, w, h, spring);
  assert.equal(h.movement, mp + 600);
  assert.equal(h.temp?.luck, 1);
  visit(s, w, h, spring);
  assert.equal(h.movement, mp + 600, "not twice before a battle");
  // Hermit's Shack: a skill up a level.
  h.skills = [[0, 1]];
  visit(s, w, h, put(144, 5));
  assert.deepEqual(h.skills, [[0, 2]]);
  // Vial of Mana: 30 points, in full up to the maximum and half of the rest (heroes.thelazy.net).
  h.mana = maxMana(h) - 10;
  const vial = put(145, 3);
  vial.data = { reward: { dice: [10, 0, 0, 0], vars: {}, heroes: [], players: [] } };
  visit(s, w, h, vial);
  assert.equal(h.mana, maxMana(h) + 10);
  // Trailblazer: a week-long bonus.
  visit(s, w, h, put(144, 11));
  assert.ok(h.timed?.some((b) => b.type === "WASTELAND_GUIDE" && b.active));
  // ... wasteland costs 75 a tile (the mod's "down to 75%"), not its usual 125.
  const [a, b] = [{ x: h.x, y: h.y, z: h.z }, { x: h.x + 1, y: h.y, z: h.z }];
  for (const p of [a, b]) Object.assign(w.tile(p)!, { terrain: 11, road: 0 });
  assert.equal(stepCost(w, h, a, b), 75);
  // Trapper Lodge: once, either 300-500 gold or 3-5 Kobolds / Gremlins who ask to join.
  const lodge = put(144, 12);
  lodge.data = { reward: { dice: [10, 0, 0, 0], vars: { "@gainedGoldAmount": 400 }, heroes: [], players: [] } };
  res[6] = 0;
  visit(s, w, h, lodge);
  assert.equal(res[6], 400);
  visit(s, w, h, lodge);
  assert.equal(res[6], 400, "once only");
  const gremlin = w.creatures.findIndex((c) => c?.key === "gremlin");
  const lodge2 = put(144, 12);
  lodge2.data = { reward: { dice: [70, 0, 0, 0], vars: { "@gainedCreature": gremlin, "@gainedCreatureAmount": 4 }, heroes: [], players: [] } };
  h.army = [{ creature: 0, count: 10 }, null, null, null, null, null, null];
  visit(s, w, h, lodge2);
  if (h.offer) applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
  assert.ok(h.army.some((x) => x?.creature === gremlin && x.count === 4));
});

test("HotA traders: Warlock's Lab trades precious resources 1:1, the Junkman buys artifacts, the Seafaring Academy teaches Navigation", { skip }, () => {
  const { s, w, h } = setup();
  const put = (type: number, subid: number) => {
    const o = structuredClone(s.objects.find((x) => !x.town && !x.removed)!);
    Object.assign(o, { id: s.objects.length, type, subid, data: {}, removed: false, owner: -1 });
    s.objects.push(o);
    w.refresh(s);
    for (let i = 0; i < w.visitBy.length; i++)
      if (w.visitBy[i] === o.id + 1) {
        h.x = i % w.size;
        h.y = Math.floor(i / w.size) % w.size;
        h.z = Math.floor(i / (w.size * w.size));
        break;
      }
    return o;
  };
  const res = s.players[h.owner].resources;
  put(144, 9);
  res[1] = 10;
  res[3] = 0;
  applyAdventureAction(s, w, { type: "trade", from: 1, to: 3, lots: 4 }, h.owner);
  assert.deepEqual([res[1], res[3]], [6, 4]);
  const junk = put(144, 7);
  h.backpack = [7];
  const gold = res[6];
  applyAdventureAction(s, w, { type: "sellArtifact", hero: h.id, object: junk.id, artifact: 7 }, h.owner);
  assert.equal(res[6], gold + Math.floor(w.data.artifacts[7].cost / 2));
  assert.deepEqual(h.backpack, []);
  const academy = put(146, 0);
  const offer = universityOffer(s, academy);
  assert.equal(offer.length, 3);
  assert.equal(offer[0], 5, "Navigation first");
  h.skills = [[5, 1]];
  res[6] = 5000;
  applyAdventureAction(s, w, { type: "learnSkill", hero: h.id, object: academy.id, skill: 5 }, h.owner);
  assert.deepEqual(h.skills, [[5, 2]], "the academy improves a known skill");
});

test("Town Gate: a hero steps into an allied town's gate", { skip }, () => {
  const { s, w, h } = setup();
  const gate = structuredClone(s.objects.find((x) => !x.town && !x.removed)!);
  Object.assign(gate, { id: s.objects.length, type: 146, subid: 3, data: {}, removed: false, owner: -1 });
  s.objects.push(gate);
  w.refresh(s);
  for (let i = 0; i < w.visitBy.length; i++)
    if (w.visitBy[i] === gate.id + 1) {
      [h.x, h.y, h.z] = [i % w.size, Math.floor(i / w.size) % w.size, Math.floor(i / (w.size * w.size))];
      break;
    }
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  const mp = h.movement;
  applyAdventureAction(s, w, { type: "townGate", hero: h.id, object: gate.id, town: town.id }, h.owner);
  assert.equal(w.visitBy[w.index(h.x, h.y, h.z)], town.id + 1, "in the town's gate");
  assert.equal(h.movement, mp, "no movement spent");
});

test("Skeleton Transformer: stacks become Skeletons, dragons Bone Dragons, and like stacks merge", { skip }, () => {
  const { s, w, h } = setup();
  const t = structuredClone(s.objects.find((x) => !x.town && !x.removed)!);
  Object.assign(t, { id: s.objects.length, type: 144, subid: 1, data: {}, removed: false, owner: -1 });
  s.objects.push(t);
  w.refresh(s);
  for (let i = 0; i < w.visitBy.length; i++)
    if (w.visitBy[i] === t.id + 1) {
      [h.x, h.y, h.z] = [i % w.size, Math.floor(i / w.size) % w.size, Math.floor(i / (w.size * w.size))];
      break;
    }
  h.army = [{ creature: 0, count: 10 }, { creature: 26, count: 2 }, { creature: 2, count: 5 }, null, null, null, null];
  applyAdventureAction(s, w, { type: "transform", hero: h.id, object: t.id, slots: [0, 1, 2] }, h.owner);
  assert.deepEqual(h.army[0], { creature: 56, count: 15 });
  assert.equal(h.army[1]?.creature, 68, "green dragons become bone dragons");
  assert.equal(h.army[2], null);
});

test("Factory: the Gantry is an eighth dwelling (Dreadnoughts, upgraded: Juggernauts)", { skip }, () => {
  const { s, w, h } = setup();
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  town.subid = TOWNS.findIndex((t) => t.faction === "factory");
  const t = town.town!;
  t.built = [0, 5, 7, 10, 11, 14, 30, 31, 32, 33, 34, 35];
  t.available = [0, 0, 0, 0, 0, 0, 0];
  t.builtToday = false;
  s.players[h.owner].resources = [99, 99, 99, 99, 99, 99, 99999];
  applyAdventureAction(s, w, { type: "build", town: town.id, building: 150 }, h.owner);
  assert.ok(t.built.includes(150));
  assert.equal(t.available[7], w.creatures[184].growth, "a week of Dreadnoughts");
  for (const x of s.heroes) if (x.owner === h.owner) x.removed = true;
  applyAdventureAction(s, w, { type: "recruit", town: town.id, level: 7, upgraded: false, count: 1 }, h.owner);
  assert.ok(t.garrison.some((a) => a?.creature === 184));
  t.builtToday = false;
  applyAdventureAction(s, w, { type: "build", town: town.id, building: 151 }, h.owner);
  t.available[7] = 1;
  applyAdventureAction(s, w, { type: "recruit", town: town.id, level: 7, upgraded: true, count: 1 }, h.owner);
  assert.ok(t.garrison.some((a) => a?.creature === 185));
});

test("town specials: Hall of Valhalla once per hero, Treasury interest, Fair markets, Brotherhood morale in a siege", { skip }, () => {
  const { s, h } = setup();
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  const t = town.town!;
  const as = (faction: string, built: number[]) => {
    town.subid = TOWNS.findIndex((x) => x.faction === faction);
    t.built = [...new Set([...t.built, ...built])];
  };
  as("stronghold", [23]);
  const atk = h.primary[0];
  visitTownSpecials(s, town, h, { maxMana: () => 10, gainExperience: () => [] });
  visitTownSpecials(s, town, h, { maxMana: () => 10, gainExperience: () => [] });
  assert.equal(h.primary[0], atk + 1, "once per hero");
  as("rampart", [22]);
  s.players[h.owner].resources[6] = 10000;
  weeklyTownSpecials(s);
  assert.equal(s.players[h.owner].resources[6], 11000);
  as("bulwark", [14, 17]);
  assert.equal(marketCount(s, h.owner), 3);
  as("castle", [22]);
  assert.equal(siegeBonuses(town).morale, 2);
});

test("town services: Artifact Merchants, Magic University, Freelancer's Guild, Sieidi of Runes, the Bank", { skip }, () => {
  const { s, w, h } = setup();
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  const t = town.town!;
  w.refresh(s);
  for (let i = 0; i < w.visitBy.length; i++)
    if (w.visitBy[i] === town.id + 1) {
      [h.x, h.y, h.z] = [i % w.size, Math.floor(i / w.size) % w.size, Math.floor(i / (w.size * w.size))];
      break;
    }
  const as = (faction: string, built: number[]) => {
    town.subid = TOWNS.findIndex((x) => x.faction === faction);
    t.built = [...new Set([...t.built, ...built])];
  };
  const res = s.players[h.owner].resources;
  res[6] = 100000;
  as("tower", [17]);
  const at = { hero: h.id, object: town.id };
  // A refused purchase on the first look rolls the stock but leaves the game's generator alone.
  const rng = s.rng;
  const coins0 = res[6];
  res[6] = 0;
  assert.throws(() => applyAdventureAction(s, w, { type: "buyArtifact", ...at, slot: 0 }, h.owner), /costs/);
  assert.equal(s.rng, rng, "a refusal changes nothing");
  res[6] = coins0;
  const art = blackMarketStock(s, w, town)[0];
  applyAdventureAction(s, w, { type: "buyArtifact", ...at, slot: 0 }, h.owner);
  assert.ok([...(h.equipped ?? []), ...(h.backpack ?? [])].includes(art), "bought from the merchants");
  as("conflux", [21]);
  h.skills = [];
  // The Magic University: the four schools, each for 2000 gold and 5 of its resource (Air: gems).
  assert.deepEqual(universityOffer(s, town).map((k) => SKILLS[k]), ["airMagic", "fireMagic", "earthMagic", "waterMagic"]);
  const skill = universityOffer(s, town)[0];
  const [gems, coins] = [res[5], res[6]];
  applyAdventureAction(s, w, { type: "learnSkill", ...at, skill }, h.owner);
  assert.deepEqual(h.skills, [[skill, 1]]);
  assert.deepEqual([res[5], res[6]], [gems - 5, coins - 2000]);
  // Not a school the hero's class never learns.
  const odds = w.data.classSkillOdds ?? [];
  const banned = odds.flatMap((row, cls) => [SKILLS.indexOf("fireMagic"), SKILLS.indexOf("earthMagic"), SKILLS.indexOf("waterMagic")].filter((k) => row[k] === 0).map((k) => [cls, k]))[0];
  if (banned) {
    const was = h.heroClass;
    h.heroClass = banned[0];
    assert.throws(() => applyAdventureAction(s, w, { type: "learnSkill", ...at, skill: banned[1] }, h.owner), /class can't/);
    h.heroClass = was;
  }
  as("stronghold", [14, 21]); // the guild pays by the marketplaces owned
  h.army = [{ creature: 0, count: 10 }, { creature: 2, count: 5 }, null, null, null, null, null];
  applyAdventureAction(s, w, { type: "sellStack", ...at, slot: 1, count: 5 }, h.owner);
  assert.equal(h.army[1], null);
  as("bulwark", [21]);
  assert.throws(() => applyAdventureAction(s, w, { type: "learnSkill", ...at, skill: 29 }, h.owner), /Scholar/);
  h.skills.push([SKILLS.indexOf("scholar"), 1]);
  applyAdventureAction(s, w, { type: "learnSkill", ...at, skill: 29 }, h.owner);
  assert.ok(h.skills.some(([k]) => k === 29));
  as("factory", [17]);
  const income = townIncome(town)[6];
  const gold = res[6];
  applyAdventureAction(s, w, { type: "bankLoan", town: town.id }, h.owner);
  assert.equal(res[6], gold + 2500);
  assert.equal(townIncome(town)[6], income - 500);
  assert.throws(() => applyAdventureAction(s, w, { type: "bankLoan", town: town.id }, h.owner), /paid back/);
});

test("town specials 2: Library adds guild spells, Escape Tunnel allows a siege retreat, Ballista Yard sells ballistas", { skip }, () => {
  const { s, w, h } = setup();
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  const t = town.town!;
  town.subid = TOWNS.findIndex((x) => x.faction === "tower");
  t.built = [...new Set([...t.built, 0, 22])];
  t.guild = [];
  stockGuild(s, w.data.spells ?? [], town);
  assert.equal(t.guild[0].length, 6, "five spells and one from the Library");
  town.subid = TOWNS.findIndex((x) => x.faction === "stronghold");
  t.built = [...new Set([...t.built, 7, 17, 22])];
  assert.equal(siegeOf(town)?.escape, true);
  w.refresh(s);
  for (let i = 0; i < w.visitBy.length; i++)
    if (w.visitBy[i] === town.id + 1) {
      [h.x, h.y, h.z] = [i % w.size, Math.floor(i / w.size) % w.size, Math.floor(i / (w.size * w.size))];
      break;
    }
  initEquipment(h);
  h.equipped![MACHINE_SLOT[4]] = -1;
  s.players[h.owner].resources[6] = 10000;
  applyAdventureAction(s, w, { type: "buyMachineAt", hero: h.id, object: town.id, artifact: 4 }, h.owner);
  assert.equal(h.equipped![MACHINE_SLOT[4]], 4);
});

test("Portal of Summoning: a week's creatures from a flagged dwelling, recruitable in the town", { skip }, () => {
  const { s, w, h } = setup();
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  town.subid = TOWNS.findIndex((x) => x.faction === "dungeon");
  town.town!.built = [...new Set([...town.town!.built, 22])];
  const dw = structuredClone(s.objects.find((x) => !x.town && !x.removed)!);
  Object.assign(dw, { id: s.objects.length, type: 17, subid: 0, owner: h.owner, removed: false, dwelling: { available: [5] }, data: {} });
  s.objects.push(dw);
  rollPortal(s, w, town);
  const portal = town.data!.portal as { creature: number; available: number };
  assert.equal(portal.creature, dwellingCreatures(dw)![0]);
  s.players[h.owner].resources = [99, 99, 99, 99, 99, 99, 99999];
  for (const x of s.heroes) if (x.owner === h.owner) x.removed = true;
  applyAdventureAction(s, w, { type: "recruitPortal", town: town.id, count: 1 }, h.owner);
  assert.ok(town.town!.garrison.some((a) => a?.creature === portal.creature));
});

test("timed events: resources and a message on their day, then every N days", { skip }, () => {
  const { s, w, h } = setup();
  s.players[h.owner].controller = "human";
  w.map.events = [{ name: "Gift", message: "Gold from the king.", resources: [0, 0, 0, 0, 0, 0, 1000], players: 1 << h.owner, human: true, computer: false, first: 1, every: 2 }];
  const gold = () => s.players[h.owner].resources[6];
  const start = gold();
  assert.deepEqual(timedEvents(s, w), [], "not on day 1");
  const day2 = newDay(s, w);
  assert.ok(day2.some((e) => e.e === "message" && e.text === "Gold from the king."));
  const after2 = gold();
  assert.ok(after2 >= start + 1000);
  newDay(s, w); // day 3: nothing from the event
  const before4 = gold();
  newDay(s, w); // day 4: again
  assert.ok(gold() >= before4 + 1000);
});

test("Seer's Hut: the quest's own lines, a player is asked before handing over, then the reward", { skip }, () => {
  const { s, w, h } = setup();
  // An empty tile (no map object near it), and on it a hut asking for level 1 (done already), rewarding 500 experience.
  let x = 1;
  const [y, z] = [1, 0];
  while (w.map.objects.some((m) => m.z === z && m.y === y && Math.abs(m.x - x) <= 1)) x++;
  (w.map.objects as unknown as { x: number; y: number; z: number; id: number; data: unknown }[]).push({ x, y, z, id: 83, data: { quests: [{ mission: 1, level: 1, reward: 1, amount: 500 }] } });
  const o = { id: s.objects.length, type: 83, subid: 0, x, y, z, def: "", block: [], visit: [], flat: false, owner: -1 } as unknown as AdvObject;
  s.objects.push(o);
  const xp = h.experience;
  const ev = visit(s, w, h, o);
  const offer = ev.find((e) => e.e === "offer");
  assert.equal(offer && offer.e === "offer" && offer.kind, "quest");
  assert.deepEqual(offer && offer.e === "offer" && offer.textRef && { file: offer.textRef.file, id: offer.textRef.id, args: offer.textRef.args }, { file: "seerhut", id: 4, args: [1] });
  assert.equal(h.experience, xp, "nothing happens before the answer");
  // The question shows what the hut gives (it showed what it takes: a big reward came without a word of it).
  assert.deepEqual(offer && offer.e === "offer" && offer.components, [{ kind: "experience", amount: 500 }]);
  // Told the quest (done on the spot): it's in the player's quest log.
  assert.ok(o.visitors?.includes(h.owner));
  applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
  assert.ok(h.experience >= xp + 500);
  assert.ok(o.data?.done);
  // Afterwards the hut is deserted.
  const again = visit(s, w, h, o);
  assert.equal(again[0].e === "visit" && again[0].text?.id, 1);
});

test("the map's bans: never offered at level-up or as a random artifact; HotA's own artifacts are in the pool", () => {
  const artifacts = Array.from({ length: 144 }, (_, id) => ({ name: `A${id}`, cost: 100, tier: id === 7 ? "T" : id === 8 ? "J" : "S", slots: [] }));
  const pool = randomArtifactPool(artifacts, "TJ");
  assert.ok(pool.includes(7) && pool.includes(8), "the game's own");
  assert.ok(pool.includes(158) && pool.includes(152), "Ring of Oblivion (major), Runes of Imminency (treasure)");
  assert.ok(!pool.includes(131) && !pool.includes(160), "never a combination");
  assert.ok(!randomArtifactPool(artifacts, "TJ", [7, 158]).some((id) => id === 7 || id === 158), "banned by the map");
  const hero = { skills: [] as [number, number][] };
  const weights = Array(28).fill(1);
  for (let i = 0; i < 40; i++) {
    const offer = levelUpOffer({ rng: i + 1 }, { ...hero }, weights, [SKILLS.indexOf("resistance")]);
    assert.ok(!offer.some(([id]) => id === SKILLS.indexOf("resistance")));
  }
});

test("Learning (HotA 1.7.3): the level it grants doesn't offer it again, unless it's one of the last two to improve", () => {
  const learning = SKILLS.indexOf("learning");
  const weights = Array(30).fill(1);
  for (let i = 0; i < 40; i++) {
    const offer = levelUpOffer({ rng: i + 1 }, { skills: [[learning, 1], [0, 1]] }, weights, [], learning);
    assert.ok(!offer.some(([id]) => id === learning));
  }
  // Eight skills, only Learning and one more short of expert: both are offered.
  const full: [number, number][] = [[learning, 1], [0, 2], ...[1, 2, 3, 4, 5, 6].map((id) => [id, 3] as [number, number])];
  assert.deepEqual(new Set(levelUpOffer({ rng: 1 }, { skills: full }, weights, [], learning).map(([id]) => id)), new Set([learning, 0]));
  // HotA's levels (heroes.thelazy.net, Experience): its table to level 74, the last one.
  assert.equal(experienceForLevel(13), 24320);
  assert.equal(experienceForLevel(40), 3066455);
  assert.equal(experienceForLevel(74), 1508362195);
  assert.equal(MAX_LEVEL, 74);
});

test("dismissing a stack: a hero's (never the last one) and a garrison's", { skip }, () => {
  const { s, w, h } = setup();
  h.army = [{ creature: PEASANT, count: 5 }, { creature: ARCHANGEL, count: 1 }, null, null, null, null, null];
  applyAdventureAction(s, w, { type: "dismissStack", hero: h.id, slot: 0 }, h.owner);
  assert.equal(h.army[0], null);
  assert.throws(() => applyAdventureAction(s, w, { type: "dismissStack", hero: h.id, slot: 1 }, h.owner), /at least one/);
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  town.town!.garrison[3] = { creature: PEASANT, count: 2 };
  applyAdventureAction(s, w, { type: "dismissStack", town: town.id, slot: 3 }, h.owner);
  assert.equal(town.town!.garrison[3], null);
});

test("hero cap: only heroes on the map count (a garrison's hero doesn't, as VCMI's perPlayerOnMapCap)", () => {
  const h = (owner: number, garrison?: number) => ({ owner, removed: false, ...(garrison === undefined ? {} : { garrison }) });
  const s = { heroes: [h(0), h(0, 5), h(1), h(0), { ...h(0), removed: true }] } as never;
  assert.equal(mapHeroesOf(s, 0).length, 2);
  assert.equal(mapHeroesOf(s, 1).length, 1);
});

test("entrances: a hero walks onto a windmill's or mine's entrance, visits once, Space visits again; pickups are taken from beside", { skip }, () => {
  const { s, w, h } = setup();
  for (const o of s.objects) if (o.type === 54) o.removed = true;
  w.refresh(s);
  const free = (i: number) => i >= 0 && !w.blocked(i) && !w.visitBy[i] && !w.heroAt[i] && w.map.tiles[i].terrain !== 8;
  /** Puts the hero on a free tile beside (below or to the side of) the object's entrance. */
  const besideEntrance = (o: AdvObject): number => {
    const v = visitTile(w, o);
    const [vx, vy] = [v % w.size, Math.floor(v / w.size) % w.size];
    for (const [dx, dy] of [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]]) {
      const i = w.index(vx + dx, vy + dy, o.z);
      if (free(i)) {
        [h.x, h.y, h.z] = [vx + dx, vy + dy, o.z];
        w.refresh(s);
        return v;
      }
    }
    return -1;
  };
  // A windmill, water wheel, mine or the like: the hero ends on its entrance.
  const place = s.objects.find((o) => !o.removed && [112, 109, 53, 57, 100, 49, 55].includes(o.type) && besideEntrance(o) >= 0)!;
  assert.ok(place, "Deluge has a windmill, mine or the like with a free tile beside");
  const door = besideEntrance(place);
  h.movement = 2000;
  const ev = applyAdventureAction(s, w, { type: "move", hero: h.id, to: door }, h.owner);
  assert.equal(w.index(h.x, h.y, h.z), door, "standing on the entrance");
  // (One's own mine opens its garrison window instead of a message.)
  const visits = (list: typeof ev) => list.filter((e) => "object" in e && e.object === place.id && (e.e === "visit" || e.e === "garrison")).length;
  assert.equal(visits(ev), 1, "visited once");
  assert.ok(ev.some((e) => e.e === "move" && e.path[e.path.length - 1] === door));
  // Space: the same object again, the hero staying put.
  const again = applyAdventureAction(s, w, { type: "visit", hero: h.id }, h.owner);
  assert.equal(visits(again), 1);
  assert.equal(w.index(h.x, h.y, h.z), door);
  // And off it again.
  const off = [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]].map(([dx, dy]) => w.index(h.x + dx, h.y + dy, h.z)).find(free)!;
  applyAdventureAction(s, w, { type: "move", hero: h.id, to: off }, h.owner);
  assert.equal(w.index(h.x, h.y, h.z), off, "leaves the entrance");
  assert.throws(() => applyAdventureAction(s, w, { type: "visit", hero: h.id }, h.owner), /nothing to visit/);

  // A resource: picked up from beside it; the hero doesn't step onto it.
  const res = s.objects.find((o) => !o.removed && o.type === 79 && besideEntrance(o) >= 0)!;
  assert.ok(res, "Deluge has a resource with a free tile beside");
  const at = besideEntrance(res);
  const before = w.index(h.x, h.y, h.z);
  h.movement = 2000;
  applyAdventureAction(s, w, { type: "move", hero: h.id, to: at }, h.owner);
  assert.ok(res.removed, "picked up");
  assert.equal(w.index(h.x, h.y, h.z), before, "stays beside it");
});

test("a hero's battle carries their spell-point maximum (Intelligence, artifacts' Knowledge) for the hero popup", { skip }, () => {
  const { s, w, h } = setup();
  const bank = s.objects.find((o) => o.type === 16)!;
  h.army = [{ creature: PEASANT, count: 1 }, null, null, null, null, null, null];
  h.skills = [[SKILLS.indexOf("intelligence"), 3]];
  enter(s, w, h, bank);
  const hero = s.battles[h.owner]!.battle.sides[0].hero!;
  assert.equal(hero.maxMana, maxMana(h));
  assert.equal(hero.maxMana, Math.floor(effectivePrimary(h)[3] * 10 * (1 + INTELLIGENCE[3])));
});

test("wandering monsters: weekly growth, VCMI's stacks, a refusal's insult, HotA's joining share", { skip }, () => {
  const { s, w, h } = setup();
  const o = s.objects.find((x) => x.type === Obj.MONSTER && !x.removed && UPGRADE_OF[x.subid] !== undefined)!;
  const md = mapData(w, o);
  // +10% a week, the fractions kept (VCMI's power in thousandths), not on day 1 of the game.
  o.amount = 15;
  delete o.data!.power;
  md.noGrowth = false;
  for (const day of [8, 15, 22]) {
    s.day = day - 1;
    newDay(s, w);
  }
  assert.equal(o.amount, 19, "15 -> 16.5 -> 18.15 -> 19.96");
  md.noGrowth = true;
  s.day = 28;
  newDay(s, w);
  assert.equal(o.amount, 19, "a monster the map keeps from growing stays");
  // Stacks: by the armies' strengths, dealt out evenly, the middle one upgraded when the map says so.
  o.amount = 100;
  md.stacksCount = 4;
  md.upgradedStack = 1;
  const stacks = splitMonster(s, w, h, o);
  assert.deepEqual(stacks.map((x) => x.count), [25, 25, 25, 25]);
  assert.equal(stacks[2].creature, UPGRADE_OF[o.subid]);
  md.stacksCount = -3;
  md.upgradedStack = 0;
  h.army = [{ creature: 0, count: 1 }, null, null, null, null, null, null];
  assert.equal(splitMonster(s, w, h, o).length, 7, "a weak hero meets seven stacks");
  assert.ok(splitMonster(s, w, h, o).every((x) => x.creature === o.subid));
  // A turned-down offer: they flee if they would anyway, else "Insulted by your refusal".
  s.players[h.owner].controller = "human";
  h.army = [{ creature: o.subid, count: 100 }, null, null, null, null, null, null];
  o.amount = 10;
  o.data!.aggression = 1;
  const offer = visit(s, w, h, o).find((e) => e.e === "offer");
  assert.equal(offer?.e === "offer" && offer.kind, "join");
  const fled = applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: false }, h.owner);
  assert.ok(fled.some((e) => e.e === "offer" && e.kind === "flee"), "the strong hero's refusal: they flee");
  applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: false }, h.owner);
  assert.ok(o.removed, "let go, they're gone");
  // HotA: half of them join (the joining share), the reward goes along.
  o.removed = false;
  w.refresh(s);
  md.joiningPercentage = 50;
  md.resources = [0, 0, 0, 0, 0, 0, 500];
  const gold = s.players[h.owner].resources[6];
  visit(s, w, h, o);
  applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
  assert.equal(h.army[0]!.count, 105);
  assert.equal(s.players[h.owner].resources[6], gold + 500);
  // Joining only for gold: never free.
  o.removed = false;
  w.refresh(s);
  md.joinOnlyForMoney = true;
  h.skills = [[4, 3]];
  assert.equal(monsterReaction(s, w, h, o).kind, "pay");
  // Ones too strong to flee from a weak hero, turned down, are insulted and attack.
  md.joinOnlyForMoney = false;
  o.data!.aggression = 3;
  h.army = [{ creature: o.subid, count: 1 }, null, null, null, null, null, null];
  h.skills = [[4, 3]];
  assert.equal(monsterReaction(s, w, h, o).kind, "join");
  visit(s, w, h, o);
  const fight = applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: false }, h.owner);
  assert.ok(fight.some((e) => e.e === "visit" && /Insulted/.test(e.message)) && fight.some((e) => e.e === "battle"));
});

test("wandering monsters: joiners finding the army full wait in the garrison window for room", { skip }, () => {
  const { s, w, h } = setup();
  const o = s.objects.find((x) => x.type === Obj.MONSTER && !x.removed)!;
  s.players[h.owner].controller = "human";
  const other = o.subid === ARCHANGEL ? PEASANT : ARCHANGEL;
  h.army = Array.from({ length: 7 }, () => ({ creature: other, count: 10 }));
  h.army[6] = { creature: PEASANT === other ? ARCHANGEL : PEASANT, count: 5 };
  h.skills = [[4, 3]];
  o.amount = 4;
  o.data!.aggression = 1;
  mapData(w, o).joiningPercentage = 100;
  visit(s, w, h, o);
  const ev = applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true }, h.owner);
  assert.ok(ev.some((e) => e.e === "joiners"));
  assert.ok(o.removed);
  assert.deepEqual(h.joiners?.[0], { creature: o.subid, count: 4 });
  // The last stack goes up (left behind), the joiners come down.
  applyAdventureAction(s, w, { type: "moveJoiners", hero: h.id, from: { who: "hero", slot: 6 }, to: { who: "joiners", slot: 0 } }, h.owner);
  assert.equal(h.army[6]?.creature, o.subid);
  assert.equal(h.joiners?.[0]?.count, 5);
  applyAdventureAction(s, w, { type: "closeJoiners", hero: h.id }, h.owner);
  assert.equal(h.joiners, undefined);
  assert.throws(() => applyAdventureAction(s, w, { type: "moveJoiners", hero: h.id, from: { who: "hero", slot: 0 }, to: { who: "joiners", slot: 0 } }, h.owner), /no creatures waiting/);
});

test("kingdom income: dailyIncome is what a new day brings; resources given to another player at a marketplace", { skip }, () => {
  const { s, w, h } = setup();
  const p = s.players[h.owner];
  h.skills = [[SKILLS.indexOf("estates"), 3]];
  const expect = dailyIncome(s, w, h.owner);
  assert.ok(expect[6] >= 1000 + 500, "Expert Estates and a town at least");
  const before = [...p.resources];
  newDay(s, w);
  assert.deepEqual(p.resources.map((n, i) => n - before[i]), expect);
  // Giving away: only with a marketplace, only to a player still in the game, never more than there is.
  const other = s.players.find((x) => x.color !== h.owner)!;
  other.alive = true;
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  town.town!.built = town.town!.built.filter((b) => b !== 14);
  assert.throws(() => applyAdventureAction(s, w, { type: "giveResources", to: other.color, resource: 6, amount: 100 }, h.owner), /Marketplace/);
  town.town!.built.push(14);
  const gold = [p.resources[6], other.resources[6]];
  applyAdventureAction(s, w, { type: "giveResources", to: other.color, resource: 6, amount: 100 }, h.owner);
  assert.deepEqual([p.resources[6], other.resources[6]], [gold[0] - 100, gold[1] + 100]);
  assert.throws(() => applyAdventureAction(s, w, { type: "giveResources", to: other.color, resource: 6, amount: p.resources[6] + 1 }, h.owner), /not that much/);
  assert.throws(() => applyAdventureAction(s, w, { type: "giveResources", to: h.owner, resource: 6, amount: 1 }, h.owner), /no such player/);
});

test("arrow towers count the town's structures as the wiki's Arrow Tower page lists them", () => {
  // Everything built: 14 common ones (the hall, guild, tavern, blacksmith, market, silo, Grail, seven dwellings) and the town's own.
  const full = (faction: string) => {
    const subid = TOWNS.findIndex((x) => x.faction === faction);
    const own = Object.keys(TOWNS[subid].buildings).map(Number);
    const built = [...Array(44).keys(), 150, 151].filter((b) => own.includes(b) || (b <= 16 && b !== 6));
    return siegeOf({ subid, town: { built } } as unknown as AdvObject)!.structures;
  };
  assert.equal(full("castle"), 17, "Lighthouse, Shipyard, Stables; not the Brotherhood of the Sword");
  assert.equal(full("rampart"), 16, "Mystic Pond, Treasury; not the Fountain of Fortune");
  assert.equal(full("tower"), 18);
  assert.equal(full("inferno"), 17);
  assert.equal(full("necropolis"), 18);
  assert.equal(full("conflux"), 18, "the Vault of Ashes counts");
  assert.equal(full("cove"), 17, "Grotto, Shipyard, Thieves' Guild");
  assert.equal(full("factory"), 18, "Artifact Merchants, Bank, Mana Generator, the Gantry");
});

test("HotA's Grave: digging takes the whole day's movement; gold, an artifact, -3 morale, and it's gone", { skip }, () => {
  const { s, w, h } = setup();
  const grave = { id: s.objects.length, type: 212, subid: 1001, x: h.x, y: h.y, z: h.z } as AdvObject;
  s.objects.push(grave);
  h.movement = h.maxMovement - 100;
  assert.match((visit(s, w, h, grave)[0] as { message: string }).message, /entire day/);
  assert.ok(!grave.removed);
  h.movement = h.maxMovement;
  const gold = s.players[h.owner].resources[6];
  const ev = visit(s, w, h, grave)[0] as { message: string; components?: { kind: string }[] };
  assert.match(ev.message, /shovel/);
  const got = s.players[h.owner].resources[6] - gold;
  assert.ok(got >= 1500 && got <= 4000 && got % 500 === 0, `${got} gold`);
  assert.deepEqual(ev.components?.map((c) => c.kind), ["resource", "artifact", "morale"]);
  assert.equal(h.temp?.morale, -3);
  assert.equal(h.movement, 0);
  assert.ok(grave.removed);
});

test("Castle Gate: from an ally's Inferno to one of the hero's own (heroes.thelazy.net), never from an enemy's", { skip }, () => {
  const { s, w, h } = setup();
  const towns = s.objects.filter((o) => o.town && !o.removed);
  const [theirs, mine] = towns;
  const ally = s.players.find((p) => p.color !== h.owner)!.color;
  const inferno = TOWNS.findIndex((x) => x.faction === "inferno");
  for (const t of [theirs, mine]) (t.subid = inferno), (t.town!.built = [...new Set([...t.town!.built, 22])]);
  theirs.owner = ally;
  mine.owner = h.owner;
  w.refresh(s);
  const at = visitTile(w, theirs);
  [h.x, h.y, h.z] = [at % w.size, Math.floor(at / w.size) % w.size, Math.floor(at / (w.size * w.size))];
  w.refresh(s);
  const go = () => applyAdventureAction(s, w, { type: "castleGate", hero: h.id, town: theirs.id, to: mine.id }, h.owner);
  assert.throws(go, /friendly/);
  s.players[ally].team = s.players[h.owner].team = 0;
  go();
  assert.equal(w.index(h.x, h.y, h.z), visitTile(w, mine));
});

test("the computer uses its towns' services: the Magic University, the Portal of Summoning, spell research", { skip }, () => {
  const { s, w, h } = setup();
  const p = h.owner;
  s.players[p].controller = "ai";
  const town = s.objects.find((o) => o.town && o.owner === p)!;
  town.subid = TOWNS.findIndex((x) => x.faction === "conflux");
  town.town!.built = [...new Set([...town.town!.built, 21])];
  w.refresh(s);
  const at = visitTile(w, town);
  [h.x, h.y, h.z] = [at % w.size, Math.floor(at / w.size) % w.size, Math.floor(at / (w.size * w.size))];
  h.skills = [];
  s.players[p].resources = [50, 50, 50, 50, 50, 50, 50000];
  w.refresh(s);
  adventureAiTurn(s, w, p);
  assert.ok(h.skills.some(([k]) => ["airMagic", "fireMagic", "earthMagic", "waterMagic"].includes(SKILLS[k])), "learned a school");
  // A Dungeon's Portal of Summoning with this week's creatures: recruited.
  town.subid = TOWNS.findIndex((x) => x.faction === "dungeon");
  town.town!.built = [...new Set([...town.town!.built, 22])];
  town.data = { ...(town.data ?? {}), portal: { creature: 2, available: 6 } };
  s.players[p].resources = [50, 50, 50, 50, 50, 50, 50000];
  if (s.ended) s.ended[p] = false;
  adventureAiTurn(s, w, p);
  assert.equal((town.data!.portal as { available: number }).available, 0, "all six recruited");
  // Spell research (allowed by the map): a first-level guild of dull spells gets researched.
  const dull = (w.data.spells ?? []).filter((sp) => sp.level === 1 && [27, 31, 32, 30, 33].includes(sp.id)).map((sp) => sp.id);
  const t = town.town!;
  t.built = [...new Set([...t.built, 0])];
  t.guild = [dull.slice(0, 2)];
  t.research = true;
  s.players[p].resources = [50, 50, 50, 50, 50, 50, 50000];
  s.ended[p] = false;
  adventureAiTurn(s, w, p);
  assert.equal(t.researchDay, s.day, "researched today");
});

test("level-up guarantees (heroes.thelazy.net, Secondary skill): magic heroes see Wisdom by level 3 and a school every 3; a known skill the class never gets weighs 1", () => {
  const wisdom = SKILLS.indexOf("wisdom");
  const schools = ["fireMagic", "airMagic", "waterMagic", "earthMagic"].map((k) => SKILLS.indexOf(k as never));
  const weights = Array(30).fill(10);
  for (let seed = 1; seed <= 30; seed++) {
    // Two level-ups without Wisdom, then the third offers it for a magic hero; a might hero waits for the sixth.
    const mage = { skills: [[0, 1]] as [number, number][], sinceWisdom: 2, sinceSchool: 0 };
    assert.ok(levelUpOffer({ rng: seed }, mage, weights, [], undefined, true).some(([id]) => id === wisdom), "magic: Wisdom on the third level");
    const knight = { skills: [[0, 1]] as [number, number][], sinceWisdom: 2, sinceSchool: 2 };
    const k = levelUpOffer({ rng: seed }, knight, Array(30).fill(10).map((v, id) => (id === wisdom || schools.includes(id) ? 0 : v)), [], undefined, false);
    assert.ok(!k.some(([id]) => id === wisdom), "might: not yet");
    const school = { skills: [[0, 1]] as [number, number][], sinceWisdom: 0, sinceSchool: 2 };
    assert.ok(levelUpOffer({ rng: seed }, school, weights, [], undefined, true).some(([id]) => schools.includes(id)), "magic: a school on the third level");
  }
  // Water Magic weighs 0 for this class, but the hero has it: it can still come up to improve.
  const water = SKILLS.indexOf("waterMagic");
  const w0 = Array(30).fill(10);
  w0[water] = 0;
  let seen = false;
  for (let seed = 1; seed <= 200 && !seen; seed++) seen = levelUpOffer({ rng: seed }, { skills: [[water, 1], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 3]] }, w0).some(([id]) => id === water);
  assert.ok(seen);
});

test("the hero screen's morale text lists what makes it up (ARRAYTXT's modifier lines), adding up to the morale shown", { skip }, () => {
  const { s, w, h } = setup();
  // Castle, Rampart and Necropolis troops: three alignments (-1) and undead (-1).
  h.army = [{ creature: 0, count: 5 }, { creature: 14, count: 5 }, { creature: 56, count: 5 }, null, null, null, null];
  h.skills = [[SKILLS.indexOf("leadership"), 3]];
  giveArtifact(h, w.data.artifacts, 49);
  h.temp = { morale: 1, luck: -1, from: [] };
  const p = heroMoraleLuckParts(s, w, h);
  assert.deepEqual(p.moraleParts.map((x) => x.id ?? x.name), [114, 116, 107, w.data.artifacts[49].name, 110]);
  assert.deepEqual(p.moraleParts[0].args, [3, -1]);
  assert.equal(p.morale, 3);
  assert.deepEqual(heroMoraleLuck(s, w, h), { morale: 3, luck: -1 });
  assert.deepEqual(p.luckParts, [{ id: 78, args: [1], val: -1 }]);
});

test("a creature's month: new wandering stacks of it on about 0.5% of the free land, the old ones unchanged; Refugee Camps never offer the six excluded", { skip }, () => {
  const { s, w } = setup();
  const gnoll = w.creatures.find((c) => c?.key === "gnoll")!;
  const old = s.objects.filter((o) => o.type === Obj.MONSTER && !o.removed).map((o) => [o.id, o.amount]);
  const before = s.objects.length;
  spawnMonthStacks(s, w, gnoll.id);
  const added = s.objects.slice(before);
  assert.ok(added.length >= 1, "new stacks (VCMI: one per 200 free land tiles)");
  for (const o of added) {
    assert.equal(o.type, Obj.MONSTER);
    assert.equal(o.subid, gnoll.id);
    assert.ok(o.amount! >= 40 && o.amount! <= 100, `level 1: 40-100 (${o.amount})`);
    assert.notEqual(w.map.tiles[visitTile(w, o)].terrain, 8, "not on water");
  }
  for (const [id, amount] of old) assert.equal(s.objects[id!].amount, amount, "existing stacks stay as they are");
  w.refresh(s);
  assert.equal(new Set(added.map((o) => w.visitBy.indexOf(o.id + 1))).size, added.length, "one stack a tile");
  const camp = { id: 9999, type: 78, subid: 0, x: 0, y: 0, z: 0, owner: -1 } as unknown as AdvObject;
  const banned = new Set(["sharpshooter", "enchanter", "azureDragon", "crystalDragon", "rustDragon", "fairieDragon"]);
  for (let i = 0; i < 300; i++) {
    rollRefugees(s, w, camp);
    assert.ok(!banned.has(w.creatures[camp.data!.creature as number].key));
  }
});

test("two of a kind count once on the hero screen, as in battle (two Clovers of Fortune: +1 luck)", { skip }, () => {
  const { s, w, h } = setup();
  h.skills = [];
  h.temp = undefined;
  h.equipped = [];
  h.equipped[SLOT.MISC1] = 46;
  h.equipped[SLOT.MISC2] = 46;
  assert.equal(heroMoraleLuck(s, w, h).luck, 1);
  assert.equal(heroBonuses(h).filter((b) => b.type === "LUCK").length, 1);
});

test("a full day's movement follows the hero's artifacts after any action (the panels, digging)", { skip }, () => {
  const { s, w, h } = setup();
  initEquipment(h);
  const before = h.maxMovement;
  // (As a reward or a won battle might: the Boots of Speed arrive outside the exchange screens.)
  h.equipped![SLOT.FEET] = 98;
  applyAdventureAction(s, w, { type: "sleep", hero: h.id, asleep: true }, h.owner);
  assert.equal(h.maxMovement, maxMovement(w, h));
  assert.ok(h.maxMovement > before);
});

test("a hero no longer in the game can't act (a spellbook bought for a removed hero)", { skip }, () => {
  const { s, w, h } = setup();
  h.removed = true;
  const gold = s.players[h.owner].resources[6];
  assert.throws(() => applyAdventureAction(s, w, { type: "buySpellbook", hero: h.id }, h.owner), /not your hero/);
  assert.equal(s.players[h.owner].resources[6], gold);
});

test("the AI joins two stacks of one creature (an upgraded stack beside its kin), freeing a slot", { skip }, () => {
  const { s, w, h } = setup();
  const p = h.owner;
  s.players[p].controller = "ai";
  h.army = [{ creature: 1, count: 10 }, { creature: 2, count: 5 }, { creature: 1, count: 4 }, null, null, null, null];
  adventureAiTurn(s, w, p);
  const archers = h.army.filter((x) => x?.creature === 1);
  assert.equal(archers.length, 1, JSON.stringify(h.army));
  assert.ok(archers[0]!.count >= 14);
});

test("Necromancy: each fallen counts with health up to a Skeleton's, the share of that", { skip }, () => {
  const { s, w, h } = setup();
  h.skills = [[12, 3]];
  h.equipped = [];
  h.army = [{ creature: 56, count: 1 }, null, null, null, null, null, null];
  const BLACK_DRAGON = 83;
  const fallen = (creature: number, n: number) => ({ sides: [], units: [{ side: 1, creature, initialCount: n, count: 0 }], creatures: w.creatures }) as unknown as Parameters<typeof raiseDead>[3];
  // Expert Necromancy (15%): 100 Black Dragons raise 15 Skeletons, not 100.
  raiseDead(s, w, h, fallen(BLACK_DRAGON, 100), 0);
  assert.equal(h.army[0]!.count, 1 + 15);
  // 100 Peasants (1 health): 100 health, 15 of it, two Skeletons.
  raiseDead(s, w, h, fallen(PEASANT, 100), 0);
  assert.equal(h.army[0]!.count, 1 + 15 + 2);
  // HotA: summoned elementals and clones raise nothing.
  const summoned = { sides: [], units: [{ side: 1, creature: BLACK_DRAGON, initialCount: 100, count: 0, summoned: true }, { side: 1, creature: BLACK_DRAGON, initialCount: 100, count: 0, clone: true, summoned: true }], creatures: w.creatures } as unknown as Parameters<typeof raiseDead>[3];
  assert.deepEqual(raiseDead(s, w, h, summoned, 0), []);
  assert.equal(h.army[0]!.count, 1 + 15 + 2);
});

test("Anti-magic Garrison: its battle allows no spells; nor adventure spells in it", { skip }, () => {
  const { s, w, h } = setup();
  for (const [subid, noMagic] of [[0, undefined], [1, true]] as const) {
    const o = { id: s.objects.length, type: 33, subid, def: "", x: h.x, y: h.y, z: h.z, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 128], flat: false, owner: 1 } as AdvObject;
    s.objects.push(o);
    delete s.battles[h.owner];
    fight(s, w, h, { name: "Garrison", stacks: [{ creature: PEASANT, count: 5 }], owner: 1 }, o.id);
    assert.equal(s.battles[h.owner]?.battle.noMagic, noMagic, `garrison subtype ${subid}`);
    o.removed = true;
  }
  delete s.battles[h.owner];
  const o = { id: s.objects.length, type: 219, subid: 1, def: "", x: h.x, y: h.y, z: h.z, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 128], flat: false, owner: h.owner } as AdvObject;
  s.objects.push(o);
  w.refresh(s);
  const view = w.data.spells!.find((x) => x.key === "viewAir")!;
  h.spells = [view.id];
  h.mana = 100;
  assert.equal(castRefusal(s, w, h, view)?.ref?.id, 541);
});

test("Monoliths' exits in turn (a player's switch): each exit once, in the map's order, then round again", { skip }, () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const mapFile = "scene:object-45-100";
  const map = generateScene(data, parseSceneName(mapFile)!);
  const { state: s, world: w } = createAdventure(map, data, { seed: 3, mapFile, controllers: map.players.map((p) => (p.canHuman ? "human" : "none")) });
  const h = s.heroes.find((x) => !x.removed && x.owner === 0)!;
  const monoliths = s.objects.filter((o) => !o.removed && o.type === 45);
  assert.equal(monoliths.length, 5);
  const start = monoliths.find((o) => o.x === 8 && o.y === 10) ?? monoliths.find((o) => Math.abs(o.x - 8) + Math.abs(o.y - 10) < 3)!;
  const home = [h.x, h.y, h.z] as const;
  const trip = () => {
    [h.x, h.y, h.z] = home;
    w.refresh(s);
    visit(s, w, h, start);
    return w.index(h.x, h.y, h.z);
  };
  s.players[0].cyclicPortals = true;
  const seen = [trip(), trip(), trip(), trip()];
  assert.equal(new Set(seen).size, 4, "four trips, four different exits");
  assert.deepEqual([...seen].sort((a, b) => a - b), seen, "in the map's order");
  assert.equal(trip(), seen[0], "then round again");
  // What the map's lines show: the exits found, the next one among them once it is explored.
  const links = portalLinks(s, w, 0, start, true)!;
  assert.equal(links.total, 4);
  assert.equal(links.exits.length, 4, "all four seen by now");
  assert.equal(w.index(links.next!.x, links.next!.y, links.next!.z) >= 0, true);
});

test("a map event on water fires for a boat only, not for a hero water walking or flying over it (HotA 1.5.0)", { skip }, () => {
  const { s, w, h } = setup();
  const free = (i: number) => i >= 0 && !w.blocked(i) && !w.visitBy[i] && !w.guardedBy[i] && !w.heroAt[i];
  const land = (i: number) => free(i) && w.map.tiles[i].terrain !== 8 && w.map.tiles[i].terrain !== 9;
  let at = -1;
  for (let i = 0; i < w.size * w.size && at < 0; i++) {
    const x = i % w.size;
    if (!land(i)) continue;
    if (x < 1 || x > w.size - 2 || i < 2 * w.size || i >= w.size * (w.size - 2)) continue;
    if ([-1, 1].every((d) => land(i + d)) && [-1, 1].every((d) => w.blocked(i + d * w.size))) at = i;
  }
  // (A pass between obstacles, dug into water, so that the way across is over it.)
  assert.ok(at >= 0, "a pass");
  w.map.tiles[at].terrain = 8;
  const [x, y] = [at % w.size, Math.floor(at / w.size)];
  s.objects.push({ id: s.objects.length, type: 26, subid: 0, def: "", x, y, z: 0, block: [0, 0, 0, 0, 0, 0], visit: [0, 0, 0, 0, 0, 128], flat: false, owner: -1, data: { experience: 1000 } } as AdvObject);
  [h.x, h.y, h.z] = [x - 1, y, 0];
  h.movement = h.maxMovement = 1500;
  h.waterWalk = { day: s.day, efficiency: 100 };
  w.refresh(s);
  assert.equal(w.visitBy[at], s.objects.length, "the event sits on the water");
  // (Its settings live with the map's object, as an h3m's do.)
  w.map.objects.push({ id: 26, x, y, z: 0, data: { players: 0xff, human: true, computer: true, experience: 1000 } } as unknown as (typeof w.map.objects)[number]);
  (w as unknown as { anchored?: unknown }).anchored = undefined;
  const xp = h.experience;
  const events = applyAdventureAction(s, w, { type: "move", hero: h.id, to: at + 1 }, h.owner);
  assert.ok(!events.some((e) => e.e === "visit"), "nothing visited");
  assert.equal(w.index(h.x, h.y, h.z), at + 1, "walked across");
  assert.equal(h.experience, xp, "the event didn't fire");
});

test("Witch Huts teach any skill but Leadership, Necromancy and Runes (heroes.thelazy.net Witch Hut)", { skip }, () => {
  const { s, w, h } = setup();
  const o = { id: s.objects.length, type: 113, subid: 0, def: "", x: 0, y: 0, z: 0, block: [0, 0, 0, 0, 0, 0], visit: [0, 0, 0, 0, 0, 0], flat: false, owner: -1 } as AdvObject;
  s.objects.push(o);
  const seen = new Set<number>();
  for (let k = 0; k < 600; k++) {
    o.data = {};
    visit(s, w, h, o);
    seen.add(Number(o.data.skill));
  }
  for (const no of ["leadership", "necromancy", "runes"] as const) assert.ok(!seen.has(SKILLS.indexOf(no)), no);
  for (const yes of ["wisdom", "interference", "firstAid"] as const) assert.ok(seen.has(SKILLS.indexOf(yes)), yes);
});

test("one Capitol to a kingdom: a captured town's Capitol falls to a City Hall when the captor has one", { skip }, () => {
  const { s, w, h } = setup();
  const mine = s.objects.find((o) => o.town && o.owner === h.owner)!;
  const theirs = s.objects.find((o) => o.town && o !== mine && !o.removed)!;
  mine.town!.built.push(B.CAPITOL);
  theirs.town!.built.push(B.CITY_HALL, B.CAPITOL);
  captureObject(s, w, h, theirs);
  assert.equal(theirs.owner, h.owner);
  assert.ok(!theirs.town!.built.includes(B.CAPITOL), "the captured Capitol is gone");
  assert.ok(theirs.town!.built.includes(B.CITY_HALL), "a City Hall stands in its place");
  assert.ok(mine.town!.built.includes(B.CAPITOL), "the captor's own stays");
  // Without one of its own the captor keeps the town's.
  mine.town!.built = mine.town!.built.filter((b) => b !== B.CAPITOL);
  const third = s.objects.find((o) => o.town && o !== mine && o !== theirs && !o.removed);
  if (third) {
    third.town!.built.push(B.CITY_HALL, B.CAPITOL);
    captureObject(s, w, h, third);
    assert.ok(third.town!.built.includes(B.CAPITOL));
  }
});
