// The original's quirks HotA fixed (docs/homm3-quirks.md, "HotA's SoD Bugs lines"), on the real game files:
// one check per row, so a row marked = stays true.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { parseH3m } from "@heroes/formats";
import { ResourceStore } from "@heroes/formats/node";
import {
  type BattleState,
  type GameData,
  type Unit,
  Obj,
  SPELL,
  affects,
  alive,
  applyAction,
  attackOf,
  buildGameData,
  createAdventure,
  createBattle,
  dailyIncome,
  newDay,
  spellTargets,
  startBattle,
} from "../src/index.ts";

const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const mapDir = (process.env.HEROES_MAP_DIRS ?? "").split(":").find((d) => d && existsSync(join(d, "Deluge.h3m")));
const skip = (!dataDirs.length || !mapDir) && "needs the game files (HEROES_DATA_DIRS, HEROES_MAP_DIRS)";
const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;

let cached: GameData | undefined;
function data(): GameData {
  if (cached) return cached;
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  cached = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  return cached;
}
const cr = (key: string) => data().creatures.find((c) => c?.key === key)!.id;
const skill = (key: string) => ["pathfinding", "archery", "logistics", "scouting", "diplomacy", "navigation", "leadership", "wisdom", "mysticism", "luck", "ballistics", "eagleEye", "necromancy", "estates", "fireMagic", "airMagic", "waterMagic", "earthMagic"].indexOf(key);

/** A field battle: side A (with a hero casting `spells`) against side B, both human-run, the field cleared. */
function battle(a: [string, number][], b: [string, number][], hero: { spells?: number[]; skills?: [number, number][]; primary?: [number, number, number, number]; bonuses?: object[] } = {}): BattleState {
  const s = createBattle(
    {
      seed: 5,
      field: "grass",
      sides: [
        {
          name: "A",
          controller: "human",
          stacks: a.map(([k, count]) => ({ creature: cr(k), count })),
          hero: { name: "Mage", heroClass: 1, female: false, owner: 0, primary: hero.primary ?? [0, 0, 5, 5], skills: hero.skills ?? [], spells: hero.spells ?? [], mana: 200, bonuses: hero.bonuses as never },
        },
        { name: "B", controller: "human", stacks: b.map(([k, count]) => ({ creature: cr(k), count })) },
      ],
    },
    data().creatures,
    data().spells,
  );
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  s.active = s.units.find((u) => u.side === 0)!.id;
  return s;
}
const side = (s: BattleState, n: 0 | 1) => s.units.filter((u) => u.side === n && !u.machine);
const place = (u: Unit, hex: number) => (u.pos = hex);

test("Sultans' Fire Shield grows with their hero's Sorcery and the Orb again (HotA 1.7.1 took it away, 1.8.0 gave it back)", { skip }, () => {
  const burn = (skills: [number, number][]) => {
    const s = battle([["archangel", 1]], [["efreetSultan", 20]]);
    // (Side B has the hero here: swap it over.)
    s.sides[1].hero = { ...s.sides[0].hero!, skills };
    s.sides[0].hero = undefined;
    const [angel] = side(s, 0);
    const [sultans] = side(s, 1);
    place(angel, 52);
    place(sultans, 53);
    s.active = angel.id;
    const hp = angel.firstHp;
    const events = applyAction(s, { type: "attack", unit: angel.id, target: sultans.id, from: 52 } as never);
    const shield = events.find((e) => e.e === "attack" && (e as { fireShield?: boolean }).fireShield) as { damage: number } | undefined;
    return shield?.damage ?? hp - angel.firstHp;
  };
  const plain = burn([]);
  const sorcery = burn([[25, 3]]);
  assert.ok(plain > 0, "the shield burns back");
  assert.ok(sorcery > plain, `Expert Sorcery raises it (${plain} -> ${sorcery})`);
});

test("Sacrifice raises Gold Dragons (its raising is a level-5 spell: HotA 1.7.0), not Black Dragons", { skip }, () => {
  const s = battle([["goldDragon", 2], ["pikeman", 30], ["blackDragon", 2]], [["pikeman", 1]], { spells: [SPELL.SACRIFICE], skills: [[skill("fireMagic"), 3]] });
  const [gold, pikes, black] = side(s, 0);
  gold.count = 0;
  black.count = 0;
  const sac = data().spells![SPELL.SACRIFICE];
  assert.equal(sac.level, 5);
  assert.ok(affects(s, sac, gold), "Gold Dragons: immune to levels 1-4 only");
  assert.ok(!affects(s, sac, black), "Black Dragons: immune to every level");
  applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.SACRIFICE, target: gold.pos, dest: pikes.pos });
  assert.ok(alive(gold) && !alive(pikes));
});

test("Sacrifice: a sacrificed stack's clone goes with it; sacrificed Phoenixes aren't reborn (HotA 1.3.0)", { skip }, () => {
  const s = battle([["archangel", 1], ["phoenix", 5], ["pikeman", 20]], [["pikeman", 1]], { spells: [SPELL.SACRIFICE, SPELL.CLONE], skills: [[skill("fireMagic"), 3], [skill("waterMagic"), 3]] });
  const [angels, phoenixes, pikes] = side(s, 0);
  angels.count = 0;
  applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.CLONE, target: pikes.pos });
  const clone = s.units.find((u) => u.clone && u.cloneOf === pikes.id)!;
  assert.ok(clone && alive(clone));
  s.cast = undefined;
  s.active = side(s, 0).find(alive)!.id;
  const events = applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.SACRIFICE, target: angels.pos, dest: phoenixes.pos });
  assert.ok(!alive(phoenixes) && phoenixes.sacrificed, "the Phoenixes are given up");
  assert.ok(!events.some((e) => e.e === "rebirth"), "and don't rise from the ashes");
  assert.ok(alive(clone), "the pikemen's clone stays");
  s.cast = undefined;
  s.active = side(s, 0).find(alive)!.id;
  angels.count = 0;
  const after = applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.SACRIFICE, target: angels.pos, dest: pikes.pos });
  assert.ok(!alive(clone) && clone.sacrificed, "the clone goes with its pikemen");
  assert.ok(after.some((e) => e.e === "death" && e.unit === clone.id));
});

test("Berserk on an area with no one it can take is refused (HotA 1.8.0)", { skip }, () => {
  const s = battle([["pikeman", 5]], [["skeleton", 5]], { spells: [SPELL.BERSERK], skills: [[skill("fireMagic"), 3]] });
  const [skel] = side(s, 1);
  place(skel, 66);
  const empty = 40;
  assert.equal(spellTargets(s, 0, data().spells![SPELL.BERSERK], empty).length, 0);
  assert.throws(() => applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.BERSERK, target: empty }), /no valid target/);
  assert.throws(() => applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.BERSERK, target: skel.pos }), /no valid target/, "the undead don't go berserk");
});

test("Frenzy turns only the stack's own Defense into Attack, not the Behemoths' cut (HotA 1.7.0)", { skip }, () => {
  const plain = battle([["pikeman", 5]], [["pikeman", 5]], { spells: [SPELL.FRENZY], skills: [[skill("fireMagic"), 3]] });
  const near = battle([["pikeman", 5]], [["ancientBehemoth", 5]], { spells: [SPELL.FRENZY], skills: [[skill("fireMagic"), 3]] });
  for (const s of [plain, near]) applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.FRENZY, target: side(s, 0)[0].pos });
  assert.equal(attackOf(near, side(near, 0)[0], false), attackOf(plain, side(plain, 0)[0], false));
});

test("Magic Arrow at low power hurts Gold and Diamond Golems at least 1 (HotA 1.7.0)", { skip }, () => {
  for (const golem of ["goldGolem", "diamondGolem"]) {
    const s = battle([["pikeman", 5]], [[golem, 5]], { spells: [SPELL.MAGIC_ARROW], primary: [0, 0, 0, 1] });
    const [g] = side(s, 1);
    const hp = g.firstHp;
    applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.MAGIC_ARROW, target: g.pos });
    assert.ok(g.count < 5 || g.firstHp < hp, `${golem} hurt`);
  }
});

test("Trolls with the Elixir of Life regenerate fully (HotA 1.7.0)", { skip }, () => {
  const s = battle([["troll", 5]], [["pikeman", 5]], { bonuses: [{ type: "STACK_HEALTH", val: 25, artifact: 131 }, { type: "HP_REGENERATION", val: 50, artifact: 131 }] });
  const [trolls] = side(s, 0);
  assert.equal(trolls.firstHp, 50, "40 health and a quarter more");
  trolls.firstHp = 1;
  for (let i = 0; i < 4 && s.round < 2; i++) applyAction(s, { type: "defend", unit: s.active! });
  assert.ok(s.round >= 2);
  assert.equal(trolls.firstHp, 50);
});

test("Dispel on a stack with only Disrupting Ray or poison is refused (HotA 1.3.4, 1.3.5); expert still clears the field", { skip }, () => {
  const s = battle([["pikeman", 5], ["archer", 5]], [["pikeman", 5]], { spells: [SPELL.DISPEL], skills: [[skill("waterMagic"), 2]] });
  const [pikes, archers] = side(s, 0);
  const [foe] = side(s, 1);
  const dispel = data().spells![SPELL.DISPEL];
  pikes.effects = [{ spell: SPELL.DISRUPTING_RAY, rounds: 999, mastery: 1, value: 3 }];
  archers.effects = [{ spell: SPELL.POISON, rounds: 999, mastery: 1, value: 10 }];
  assert.equal(spellTargets(s, 0, dispel, pikes.pos).length, 0);
  assert.equal(spellTargets(s, 0, dispel, archers.pos).length, 0);
  assert.equal(spellTargets(s, 0, dispel, foe.pos).length, 0, "nothing on it at all");
  assert.throws(() => applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.DISPEL, target: pikes.pos }), /no valid target/);
  foe.effects = [{ spell: SPELL.HASTE, rounds: 3, mastery: 1, value: 3 }];
  pikes.effects.push({ spell: SPELL.SLOW, rounds: 3, mastery: 1, value: 25 });
  assert.equal(spellTargets(s, 0, dispel, pikes.pos).length, 1, "a Slow besides: yes");
  assert.equal(spellTargets(s, 0, dispel, foe.pos).length, 1, "an enemy's Haste at Advanced: yes");
  const ex = battle([["pikeman", 5]], [["pikeman", 5]], { spells: [SPELL.DISPEL], skills: [[skill("waterMagic"), 3]] });
  applyAction(ex, { type: "cast", unit: ex.active!, spell: SPELL.DISPEL, target: side(ex, 0)[0].pos });
});

test("Fire Shield that kills the attacker: no strike back into nowhere (HotA 1.7.1)", { skip }, () => {
  const s = battle([["archangel", 1]], [["efreetSultan", 30]]);
  const [angel] = side(s, 0);
  const [sultans] = side(s, 1);
  place(angel, 52);
  place(sultans, 53);
  angel.firstHp = 1;
  s.active = angel.id;
  const events = applyAction(s, { type: "attack", unit: angel.id, target: sultans.id, from: 52 } as never);
  assert.ok(!alive(angel), "burnt");
  assert.ok(events.some((e) => e.e === "attack" && (e as { fireShield?: boolean }).fireShield));
  assert.ok(!events.some((e) => e.e === "attack" && e.unit === sultans.id && !(e as { fireShield?: boolean }).fireShield), "no retaliation");
});

test("Roland's specialty: Swordsmen and Crusaders (HotA 1.5.4)", { skip }, async () => {
  const { SPECIALTIES } = await import("../src/specialtyData.ts");
  assert.deepEqual(SPECIALTIES[152].creatures, [cr("swordsman"), cr("crusader")]);
});

test("Crystal Dragons (and Kobolds) left in a mine or a garrison still make their owner's crystal (HotA 1.8.0)", { skip }, () => {
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, "Deluge.h3m"))));
  const { state: s, world: w } = createAdventure(map, data(), { seed: 7, mapFile: "Deluge.h3m", controllers: map.players.map((p) => (p.canHuman ? "human" : "none")) });
  const me = s.players.find((p) => p.alive)!.color;
  for (const h of s.heroes) if (h.owner === me) h.army = h.army.map(() => null);
  for (const o of s.objects) if (o.town && o.owner === me) o.town.garrison = o.town.garrison.map(() => null);
  const mine = s.objects.find((o) => o.type === Obj.MINE && !o.removed)!;
  mine.owner = me;
  mine.army = [{ creature: cr("crystalDragon"), count: 1 }, { creature: cr("kobold"), count: 10 }, null, null, null, null, null];
  const gold = dailyIncome(s, w, me)[6];
  mine.army[1] = null;
  assert.equal(gold - dailyIncome(s, w, me)[6], 10, "ten Kobolds, ten gold");
  s.day = 7;
  const before = s.players.find((p) => p.color === me)!.resources[4];
  const mined = dailyIncome(s, w, me)[4];
  newDay(s, w);
  const after = s.players.find((p) => p.color === me)!.resources[4];
  assert.equal(after - before - mined, 3, "the dragon's 3 crystal as the week begins");
});

test("A random dwelling tied to a town (Sands of Blood's) is of that town's faction", { skip: skip || !existsSync(join(mapDir!, "Sands of Blood.h3m")) }, async () => {
  const { DWELLINGS } = await import("../src/dwellingData.ts");
  const { TOWNS } = await import("../src/townData.ts");
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, "Sands of Blood.h3m"))));
  const linked = map.objects.filter((m) => (m.id === 216 || m.id === 217) && Number(m.data.identifier) > 0);
  assert.equal(linked.length, 8, "two per player");
  for (const seed of [1, 2, 3]) {
    const { state: s } = createAdventure(map, data(), { seed, mapFile: "Sands of Blood.h3m", controllers: map.players.map((p) => (p.canHuman ? "human" : p.canComputer ? "ai" : "none")) });
    const dwellings = s.objects.filter((o) => o.type === 17 && linked.some((m) => Math.abs(m.x - o.x) <= 1 && m.y === o.y && m.z === o.z));
    assert.equal(dwellings.length, 8);
    for (const d of dwellings) {
      const town = s.objects.filter((o) => o.type === Obj.TOWN).sort((a, b) => Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y))[0];
      const creature = DWELLINGS[d.subid][0];
      assert.ok(TOWNS[town.subid].creatures.some((c) => c.includes(creature)), `seed ${seed}: dwelling ${d.subid} at ${d.x},${d.y} is the town's (${town.subid}) own`);
      assert.equal(d.ident, undefined, "the link is not the dwelling's own identifier");
    }
  }
});
