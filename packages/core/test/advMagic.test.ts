// Magic outside battle, against HotA (heroes.thelazy.net): mage guilds, shrines, adventure spells, mana.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { parseH3m } from "@heroes/formats";
import { ResourceStore } from "@heroes/formats/node";
import { GAME_LINE_FILES, type AdvObject, type Hero, B, Obj, SPELL, TOWNS, applyAdventureAction, buildGameData, castAdventure, cannotCastAdventure, createAdventure, generateRandomMap, manaLimit, maxMana, newDay, SKILLS, parseRandomMapName, portalTowns, randomMapName, stockGuild, learnFromGuild, visit, visitTile } from "../src/index.ts";

const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const mapDir = (process.env.HEROES_MAP_DIRS ?? "").split(":").find((d) => d && existsSync(join(d, "Deluge.h3m")));
const skip = (!dataDirs.length || !mapDir) && "needs the game files (HEROES_DATA_DIRS, HEROES_MAP_DIRS)";
const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;

function setup() {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, "Deluge.h3m"))));
  const { state: s, world: w } = createAdventure(map, data, { seed: 7, mapFile: "Deluge.h3m", controllers: map.players.map((p) => (p.canHuman ? "human" : "none")) });
  const h = s.heroes.find((x) => !x.removed)!;
  return { s, w, h, data };
}
const spellsOf = (o: AdvObject) => (o.town!.guild ?? []).flat();

test("mage guilds: HotA's towns by their own odds (no Blind in a Cove, no elementals in a Factory); the Aurora fills only the levels built", { skip }, () => {
  const { s, w } = setup();
  const town = s.objects.find((o) => o.town)!;
  const of = (faction: string) => TOWNS.findIndex((t) => t?.faction === faction);
  const seen: Record<string, Set<number>> = { cove: new Set(), factory: new Set() };
  for (let i = 0; i < 60; i++)
    for (const f of ["cove", "factory"]) {
      const o: AdvObject = { ...town, subid: of(f), town: { ...town.town!, built: [B.MAGE_GUILD_1, B.MAGE_GUILD_1 + 1, B.MAGE_GUILD_1 + 2, B.MAGE_GUILD_1 + 3], guild: undefined } };
      stockGuild(s, w.data.spells!, o);
      for (const id of spellsOf(o)) seen[f].add(id);
    }
  assert.ok(!seen.cove.has(SPELL.BLIND) && !seen.cove.has(SPELL.ARMAGEDDON), "Cove: never Blind or Armageddon");
  assert.ok(!seen.factory.has(SPELL.FIRE_ELEMENTAL) && !seen.factory.has(SPELL.WATER_ELEMENTAL), "Factory: no fire or water elementals");
  assert.ok(seen.cove.has(SPELL.ICE_BOLT), "Cove's favourite (50) comes up");
  const conflux: AdvObject = { ...town, subid: of("conflux"), town: { ...town.town!, built: [B.MAGE_GUILD_1, B.MAGE_GUILD_1 + 1, B.GRAIL], guild: undefined } };
  stockGuild(s, w.data.spells!, conflux);
  assert.equal(conflux.town!.guild!.length, 2, "two levels built, two levels taught");
  assert.equal(conflux.town!.guild![0].length, w.data.spells!.filter((sp) => sp.id < 70 && sp.level === 1).length, "every level 1 spell");
});

function place(s: ReturnType<typeof setup>["s"], type: number, subid = 0, data?: Record<string, unknown>): AdvObject {
  const o: AdvObject = { id: s.objects.length, type, subid, def: "", x: 0, y: 0, z: 0, block: [255, 255, 255, 255, 255, 255], visit: [0, 0, 0, 0, 0, 0], flat: false, owner: -1, ...(data ? { data } : {}) };
  s.objects.push(o);
  return o;
}

test("HotA's Shrine of Magic Mystery teaches a level 4 spell, with Advanced Wisdom", { skip }, () => {
  const { s, w, h } = setup();
  h.spells = [];
  h.skills = [[7, 1]];
  const shrine = place(s, 88, 3);
  const first = visit(s, w, h, shrine)[0] as { message?: string };
  assert.match(first.message ?? "", /do not have the wisdom/, "Basic Wisdom isn't enough");
  assert.deepEqual(h.spells, []);
  h.skills = [[7, 2]];
  visit(s, w, h, shrine);
  assert.equal(h.spells.length, 1, "learned with Advanced Wisdom");
  assert.equal(w.data.spells![h.spells[0]].level, 4, "a level 4 spell");
  const plain = place(s, 88, 1);
  visit(s, w, h, plain);
  assert.equal(w.data.spells![Number(plain.data!.spell)].level, 1, "the sea shrine (88:1) is a level 1 one");
});

test("Magic Well: one drink a day from any well; spell points over the maximum stay overnight", { skip }, () => {
  const { s, w, h } = setup();
  h.spells = [];
  h.mana = 0;
  visit(s, w, h, place(s, 49));
  assert.equal(h.mana, maxMana(h));
  h.mana = 0;
  visit(s, w, h, place(s, 49));
  assert.equal(h.mana, 0, "a second well the same day does nothing");
  h.mana = 2 * maxMana(h);
  [h.x, h.y] = [1, 1];
  newDay(s, w);
  assert.equal(h.mana, 2 * maxMana(h), "a Magic Spring's double stays");
});

function shoreHero(s: ReturnType<typeof setup>["s"], w: ReturnType<typeof setup>["w"], h: Hero) {
  for (let i = 0; i < w.size * w.size; i++) {
    const [x, y] = [i % w.size, Math.floor(i / w.size)];
    if (w.map.tiles[i].terrain === 8 || w.blocked(i) || w.visitBy[i] || w.heroAt[i]) continue;
    const sea = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => { const j = w.index(x + dx, y + dy, 0); return j >= 0 && w.map.tiles[j].terrain === 8 && !w.blocked(j) && !w.visitBy[j]; });
    if (sea) {
      [h.x, h.y, h.z] = [x, y, 0];
      w.refresh(s);
      return;
    }
  }
}

test("Summon Boat: the player's own boat first, then a neutral one, never another player's; no boat: the points come back", { skip }, () => {
  const { s, w, h } = setup();
  for (const o of s.objects) if (o.type === Obj.BOAT) o.removed = true;
  shoreHero(s, w, h);
  const t = w.data.templates.find((x) => x.id === Obj.BOAT)!;
  const boat = (owner: number, x: number) => {
    const o: AdvObject = { id: s.objects.length, type: Obj.BOAT, subid: t.subid, def: t.def, x, y: 0, z: 0, block: t.blockMask, visit: t.visitMask, flat: false, owner: -1, data: owner >= 0 ? { boatOf: owner } : {} };
    s.objects.push(o);
    return o;
  };
  const summon = w.data.spells![SPELL.SUMMON_BOAT];
  h.spells = [SPELL.SUMMON_BOAT];
  h.skills = [[16, 3]];
  const theirs = boat(h.owner + 1, h.x);
  const neutral = boat(-1, (h.x + 20) % w.size);
  const mine = boat(h.owner, (h.x + 40) % w.size);
  h.mana = 100;
  castAdventure(s, w, h, summon);
  const near = (o: AdvObject) => Math.max(Math.abs(o.x - h.x), Math.abs(o.y - h.y)) <= 2;
  assert.ok(near(mine), "the player's own boat, though the farthest");
  mine.removed = true;
  castAdventure(s, w, h, summon);
  assert.ok(near(neutral), "then the neutral one");
  neutral.removed = true;
  h.skills = [[16, 0]];
  h.mana = 100;
  for (let i = 0; i < 20 && h.mana === 100; i++) castAdventure(s, w, h, summon);
  h.mana = 100;
  let said = "";
  for (let i = 0; i < 30 && !/no boats/.test(said); i++) {
    const before: number = h.mana ?? 0;
    said = castAdventure(s, w, h, summon);
    if (/no boats/.test(said)) assert.equal(h.mana, before, "no boat to call: the points come back");
  }
  assert.match(said, /no boats/);
  assert.ok(!near(theirs) || theirs.x === h.x, "another player's boat stays");
});

test("Town Portal: allies' towns too; below Advanced only the nearest, and not when a hero stands in its gate", { skip }, () => {
  const { s, w, h } = setup();
  const towns = s.objects.filter((o) => o.town && !o.removed);
  assert.ok(towns.length >= 2);
  const [a, b] = towns;
  a.owner = h.owner;
  b.owner = h.owner === 0 ? 1 : 0;
  s.players[b.owner].team = s.players[h.owner].team = 9;
  for (const o of towns.slice(2)) o.owner = -1;
  for (const x of s.heroes) if (x !== h) x.x = (x.x + 50) % w.size;
  [h.x, h.y, h.z] = [a.x - 10 < 0 ? a.x + 10 : a.x - 10, a.y, a.z];
  w.refresh(s);
  assert.deepEqual(portalTowns(s, w, h, 2).map((o) => o.id).sort(), [a.id, b.id].sort(), "the ally's town too");
  const nearest = portalTowns(s, w, h, 0)[0];
  const other = s.heroes.find((x) => x !== h && !x.removed)!;
  const gate = visitTile(w, nearest);
  [other.x, other.y, other.z] = [gate % w.size, Math.floor(gate / w.size) % w.size, Math.floor(gate / (w.size * w.size))];
  w.refresh(s);
  assert.deepEqual(portalTowns(s, w, h, 1), [], "the nearest is taken: nowhere at Basic");
  assert.equal(portalTowns(s, w, h, 2).length, 1, "Advanced goes to the other");
});

test("Dimension Door: a shrouded spot will do; onto water the spell fails and costs nothing (HotA)", { skip }, () => {
  const { s, w, h } = setup();
  const dd = w.data.spells![SPELL.DIMENSION_DOOR];
  h.spells = [SPELL.DIMENSION_DOOR];
  h.skills = [[15, 3]];
  shoreHero(s, w, h);
  h.mana = 100;
  h.movement = 2000;
  const water = [...Array(9)].flatMap((_, dy) => [...Array(9)].map((_, dx) => w.index(h.x + dx - 4, h.y + dy - 4, h.z))).find((i) => i >= 0 && w.map.tiles[i].terrain === 8 && !w.blocked(i) && !w.visitBy[i])!;
  const at = [h.x, h.y];
  assert.throws(() => castAdventure(s, w, h, dd), /destination/);
  assert.equal(h.mana, 100, "no destination, no spell points spent");
  assert.equal(cannotCastAdventure(s, w, h, dd, water), null, "water can be picked");
  assert.match(castAdventure(s, w, h, dd, water), /can't teleport/);
  assert.deepEqual([h.x, h.y], at, "the hero stays");
  assert.ok(h.mana === 100 && h.movement === 2000 && !h.doors, "HotA: no points, movement or casting spent");
  const p = s.players[h.owner];
  const land = [...Array(17)].flatMap((_, dy) => [...Array(17)].map((_, dx) => w.index(h.x + dx - 8, h.y + dy - 8, h.z))).find((i) => i >= 0 && w.map.tiles[i].terrain !== 8 && w.map.tiles[i].terrain !== 9 && !w.blocked(i) && !w.visitBy[i] && !w.heroAt[i] && !w.guardedBy[i] && i !== w.index(h.x, h.y, h.z))!;
  p.revealed = p.revealed?.map(() => 0) as typeof p.revealed;
  assert.equal(cannotCastAdventure(s, w, h, dd, land), null, "a shrouded spot will do");
});

test("random maps without water ban Summon Boat and the sea hats (HotA)", async () => {
  const { fakeRes } = await import("../../../tools/shots/fake.ts");
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const land = generateRandomMap(data, parseRandomMapName(randomMapName({ size: 36, players: 2, humans: 1, monsters: 1, seed: 2 }))!);
  const sea = generateRandomMap(data, parseRandomMapName(randomMapName({ size: 36, players: 2, humans: 1, monsters: 1, seed: 2, islands: true }))!);
  assert.ok(!land.tiles.some((t) => t.terrain === 8) && land.banned?.spells.includes(SPELL.SUMMON_BOAT) && land.banned.artifacts.includes(123));
  assert.ok(!sea.banned?.spells.includes(SPELL.SUMMON_BOAT));
});

test("HotA's spell research: cost, once a day, two offers, no learning until finalized, Town Portal sure on the third try", { skip }, () => {
  const { s, w, h } = setup();
  const town = s.objects.find((o) => o.town && o.owner === h.owner)!;
  const t = town.town!;
  t.built.push(B.MAGE_GUILD_1, B.MAGE_GUILD_1 + 1, B.MAGE_GUILD_1 + 2, B.MAGE_GUILD_1 + 3);
  t.research = true;
  t.guild = undefined;
  stockGuild(s, w.data.spells!, town);
  assert.ok(!spellsOf(town).includes(SPELL.TOWN_PORTAL) && !spellsOf(town).includes(SPELL.DIMENSION_DOOR), "no Town Portal in ordinary places");
  const res = s.players[h.owner].resources;
  res.splice(0, 7, 50, 50, 50, 50, 50, 50, 50000);
  const act = (a: object) => applyAdventureAction(s, w, { town: town.id, ...a } as never, h.owner);
  const old = t.guild![1][0];
  act({ type: "research", level: 2, slot: 0 });
  assert.deepEqual(res, [50, 46, 50, 46, 46, 46, 49000], "1000 gold and 4 of each rare resource for level 2");
  assert.equal(t.researchOffer!.length, 2);
  assert.ok(!t.researchOffer!.includes(old) && !t.researchOffer!.some((id) => spellsOf(town).includes(id)), "new spells only");
  assert.throws(() => act({ type: "research", level: 2, slot: 1 }), /Choose/);
  const pick = t.researchOffer![1];
  act({ type: "researchPick", spell: pick });
  assert.equal(t.guild![1][0], pick);
  assert.throws(() => act({ type: "research", level: 2, slot: 0 }), /each day/);
  // A hero in town doesn't learn the open slot's spell.
  h.spells = [];
  h.skills = [[7, 3]];
  learnFromGuild(s, w, h, town);
  assert.ok(!h.spells.includes(pick));
  s.day++;
  assert.throws(() => act({ type: "research", level: 2, slot: 1 }), /Finalize/);
  act({ type: "researchFinalize" });
  learnFromGuild(s, w, h, town);
  assert.ok(h.spells.includes(pick), "learned once finalized");
  assert.throws(() => act({ type: "research", level: 2, slot: 0 }), /finalized/);
  // Level 4: the third attempt offers Town Portal.
  for (let i = 1; i <= 3; i++) {
    s.day++;
    act({ type: "research", level: 4, slot: 0 });
    const offer = t.researchOffer!;
    if (i === 3) assert.ok(offer.includes(SPELL.TOWN_PORTAL), "third attempt: Town Portal");
    act({ type: "researchPick", spell: offer.find((id) => id !== SPELL.TOWN_PORTAL) ?? offer[0] });
  }
  // No research where the map doesn't allow it.
  t.research = false;
  t.researchSlot = undefined;
  s.day++;
  assert.throws(() => act({ type: "research", level: 1, slot: 0 }), /not allowed/);
});

test("spell points at most: 10 per Knowledge, Intelligence on top", () => {
  const intelligence = SKILLS.indexOf("intelligence");
  assert.equal(manaLimit(1), 10, "a might hero with Knowledge 1 has 10, not the quick battle's old 30");
  assert.equal(manaLimit(4, [[intelligence, 1]]), 48);
  assert.equal(manaLimit(5, [[intelligence, 2]]), 67);
  assert.equal(manaLimit(3, [[intelligence, 3]]), 45);
  const h = { name: "Test", owner: 0, primary: [2, 1, 1, 3], skills: [[intelligence, 2]], artifacts: {}, backpack: [] } as unknown as Hero;
  assert.equal(maxMana(h), manaLimit(3, [[intelligence, 2]]), "the adventure map's maximum agrees with no artifacts or specialty");
});
