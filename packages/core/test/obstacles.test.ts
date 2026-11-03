// Battlefield obstacles: which set each field draws from, where they may stand, and creature banks'
// clear fields (VCMI's obstacles.json, BattleInfo::setupBattle and gameConfig's creatureBank layouts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { BATTLEFIELDS, OBSTACLES, type CreatureStats, createBattle, hexCol, obstacleHexes, obstacleType } from "../src/index.ts";

const creature = (id: number): CreatureStats => ({
  id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "castle", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10], hordeGrowth: 0,
  fightValue: 100, aiValue: 100, growth: 5, hp: 10, speed: 5, attack: 5, defense: 5, minDamage: 2, maxDamage: 2, shots: 0, abilities: [], def: "", missile: "", sound: "",
});
const TABLE = [creature(0)];
const battle = (field: string, seed: number, noObstacles?: boolean) =>
  createBattle(
    {
      seed,
      field,
      noObstacles,
      sides: [
        { name: "A", controller: "ai", stacks: Array.from({ length: 7 }, () => ({ creature: 0, count: 5 })) },
        { name: "B", controller: "ai", stacks: Array.from({ length: 7 }, () => ({ creature: 0, count: 5 })) },
      ],
    },
    TABLE,
  );

test("each field draws its obstacles from its own set, clear of the armies' columns", () => {
  for (const f of BATTLEFIELDS) {
    if (f.impassable) continue;
    let seen = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = battle(f.id, seed);
      for (const p of s.obstacles) {
        const o = obstacleType(p.type)!;
        seen++;
        const own = f.special || f.id === "sand_shore" ? o.special.includes(f.id) : o.terrains.includes(f.terrain!);
        assert.ok(own, `${f.id}: obstacle ${o.id} (${o.art}) doesn't belong`);
        if (o.absolute) continue;
        for (const h of obstacleHexes(o, p.pos)) assert.ok(hexCol(h) > 2 && hexCol(h) < 14, `${f.id}: obstacle ${o.id} at ${p.pos} covers ${h}`);
      }
      for (const u of s.units) assert.ok(!s.blocked.includes(u.pos), `${f.id}: a stack starts on an obstacle`);
    }
    assert.ok(seen > 0, `${f.id} never gets an obstacle`);
  }
});

test("the beach has the shore's obstacles", () => {
  const ids = new Set<number>();
  for (let seed = 1; seed <= 60; seed++) for (const p of battle("sand_shore", seed).obstacles) ids.add(p.type);
  assert.ok([...ids].some((id) => id >= 56 && id <= 60), "shells and shore rocks");
  assert.ok([...ids].every((id) => obstacleType(id)!.special.includes("sand_shore")));
});

test("a usual obstacle fits its width (no blocked hex beyond it)", () => {
  for (const o of OBSTACLES) {
    if (o.absolute) continue;
    const pos = 17 * 8 + 4;
    const cols = obstacleHexes(o, pos).map((h) => hexCol(h) - hexCol(pos));
    assert.ok(Math.max(...cols) < o.width, `obstacle ${o.id} (${o.art}) reaches column +${Math.max(...cols)}, width ${o.width}`);
  }
});

test("a creature bank's fight has a clear field", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = battle("rough", seed, true);
    assert.deepEqual(s.obstacles, []);
    assert.deepEqual(s.blocked, []);
  }
});

test("a creature bank's fight: the hero's army in the middle, the guards around it (VCMI's creatureBank layouts)", () => {
  const wide: CreatureStats = { ...creature(1), abilities: [{ type: "DOUBLE_WIDE" }] };
  const table = [creature(0), wide];
  const bank = (guard: number) =>
    createBattle(
      {
        seed: 1,
        field: "grass",
        bank: true,
        noObstacles: true,
        sides: [
          { name: "A", controller: "ai", stacks: Array.from({ length: 7 }, () => ({ creature: 0, count: 5 })) },
          { name: "B", controller: "ai", stacks: Array.from({ length: 5 }, () => ({ creature: guard, count: 5 })) },
        ],
      },
      table,
    );
  const at = (s: ReturnType<typeof bank>, side: number) => s.units.filter((u) => u.side === side).map((u) => u.pos);
  assert.deepEqual(at(bank(0), 0), [57, 61, 90, 93, 96, 125, 129]);
  assert.deepEqual(at(bank(0), 1), [15, 185, 172, 2, 100]);
  // Double-wide guards: the left ones a hex further out, the right ones with their tails on the field.
  assert.deepEqual(at(bank(1), 1), [14, 184, 171, 1, 99]);
});

test("each bank's own formation: wide for single-hex guards too, HotA's Churchyard, Spit and Ruins", () => {
  const wide: CreatureStats = { ...creature(1), abilities: [{ type: "DOUBLE_WIDE" }] };
  const table = [creature(0), wide];
  const guards = (layout: "narrow" | "wide" | "churchyard" | "spit" | "ruins", n: number, guard = 0) =>
    createBattle(
      {
        seed: 1,
        field: "grass",
        bank: layout,
        noObstacles: true,
        sides: [
          { name: "A", controller: "ai", stacks: [{ creature: 0, count: 5 }] },
          { name: "B", controller: "ai", stacks: Array.from({ length: n }, () => ({ creature: guard, count: 5 })) },
        ],
      },
      table,
    )
      .units.filter((u) => u.side === 1)
      .map((u) => u.pos);
  // (The Red Tower's Fire Elementals.)
  assert.deepEqual(guards("wide", 5), [15, 185, 171, 1, 100]);
  // The Churchyard's six stacks of Zombies: three along the top, three along the bottom (heroes.thelazy.net's Grid-cb_4).
  assert.deepEqual(guards("churchyard", 6), [14, 184, 172, 2, 8, 178]);
  // The Spit's four Basilisks: one on each side of the hero's ring, the right one's tail on the field.
  assert.deepEqual(guards("spit", 4, 1), [99, 86, 7, 177]);
  // The Ruins' five: the corners and the top's middle.
  assert.deepEqual(guards("ruins", 5), [15, 185, 172, 2, 8]);
});
