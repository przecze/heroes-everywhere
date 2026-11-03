// Water and Earth battle spells against HotA's SPTRAITS, the HotA wiki and VCMI's spell configs.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BattleState,
  type CreatureStats,
  SPELL,
  type SpellInfo,
  affects,
  applyAction,
  attackOf,
  canTeleport,
  createBattle,
  expectedDamage,
  hexAt,
  seesHazard,
  spellTargets,
  startBattle,
} from "../src/index.ts";

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "castle", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 100, speed: 5, attack: 5, defense: 5, minDamage: 2, maxDamage: 8,
    shots: 0, abilities: [], def: "", missile: "", sound: "", ...over,
  };
}

function spell(id: number, over: Partial<SpellInfo>): SpellInfo {
  return { id, key: `s${id}`, name: `S${id}`, level: 1, schools: ["water"], cost: [5, 4, 4, 4], power: 0, effect: [0, 0, 0, 0], chance: [], text: [], ...over };
}

// HotA's SPTRAITS rows.
const SPELLS: SpellInfo[] = [];
SPELLS[SPELL.BLESS] = spell(SPELL.BLESS, { key: "bless", effect: [0, 0, 1, 1] });
SPELLS[SPELL.WEAKNESS] = spell(SPELL.WEAKNESS, { key: "weakness", level: 2, effect: [3, 3, 6, 6] });
SPELLS[SPELL.BLOODLUST] = spell(SPELL.BLOODLUST, { key: "bloodlust", schools: ["fire"], effect: [3, 3, 6, 6] });
SPELLS[SPELL.TELEPORT] = spell(SPELL.TELEPORT, { key: "teleport", level: 3, cost: [15, 12, 6, 3] });
SPELLS[SPELL.CLONE] = spell(SPELL.CLONE, { key: "clone", level: 4, cost: [24, 20, 20, 20], effect: [5, 5, 6, 7] });
SPELLS[SPELL.ICE_BOLT] = spell(SPELL.ICE_BOLT, { key: "iceBolt", level: 2, cost: [8, 6, 6, 6], power: 20, effect: [10, 10, 20, 50] });
SPELLS[SPELL.ANTI_MAGIC] = spell(SPELL.ANTI_MAGIC, { key: "antiMagic", level: 3, schools: ["earth"], effect: [4, 4, 5, 6] });
SPELLS[SPELL.DISPEL] = spell(SPELL.DISPEL, { key: "dispel" });
SPELLS[SPELL.RESURRECTION] = spell(SPELL.RESURRECTION, { key: "resurrection", level: 4, schools: ["earth"], cost: [20, 16, 16, 16], power: 50, effect: [40, 40, 80, 160] });
SPELLS[SPELL.ANIMATE_DEAD] = spell(SPELL.ANIMATE_DEAD, { key: "animateDead", level: 3, schools: ["earth"], cost: [15, 12, 12, 12], power: 50, effect: [30, 30, 60, 160] });

const table = [creature(0), creature(1, { attack: 10 }), creature(2, { hp: 1000, level: 7 }), creature(3, { abilities: [{ type: "UNDEAD" }] })];

const WATER = 16;
const EARTH = 17;

function battle(spells: number[], skills: [number, number][] = [], power = 2, mine = [0, 0], siege = false): BattleState {
  const s = createBattle(
    {
      seed: 7,
      field: "grass",
      siege: siege ? { faction: "castle", level: 3, structures: 12 } : undefined,
      sides: [
        { name: "A", controller: "human", stacks: mine.map((creature) => ({ creature, count: 10 })), hero: { name: "Mage", heroClass: 1, female: false, owner: 0, primary: [0, 0, power, 5], skills, spells, mana: 100 } },
        { name: "B", controller: "ai", stacks: [{ creature: 1, count: 10 }, { creature: 1, count: 10 }] },
      ],
    },
    table,
    SPELLS,
  );
  startBattle(s);
  s.active = s.units.find((u) => u.side === 0)!.id;
  const fighters = s.units.filter((u) => !u.machine);
  fighters.forEach((u, i) => (u.pos = [18, 52, 32, 66][i] ?? u.pos));
  return s;
}

const cast = (s: BattleState, spell: number, target: number, dest?: number) => applyAction(s, { type: "cast", unit: s.active!, spell, target, dest });

test("Bless: the maximum at basic, the maximum + 1 from advanced (SPTRAITS, heroes.thelazy.net)", () => {
  for (const [lvl, top] of [[1, 8], [2, 9], [3, 9]] as const) {
    const s = battle([SPELL.BLESS], [[WATER, lvl]]);
    const [a] = s.units;
    const foe = s.units.find((u) => u.side === 1)!;
    cast(s, SPELL.BLESS, a.pos);
    const d = expectedDamage(s, a, foe, false);
    assert.equal(d.min, d.max);
    assert.equal(d.max, Math.floor(top * 10), `mastery ${lvl}`);
  }
});

test("Weakness and Bloodlust cancel each other (VCMI's counters)", () => {
  const s = battle([SPELL.WEAKNESS], [[WATER, 2]]);
  const foe = s.units.find((u) => u.side === 1)!;
  foe.effects = [{ spell: SPELL.BLOODLUST, rounds: 3, mastery: 1, value: 3 }];
  const before = attackOf(s, foe);
  cast(s, SPELL.WEAKNESS, foe.pos);
  assert.ok(!foe.effects.some((e) => e.spell === SPELL.BLOODLUST));
  assert.equal(attackOf(s, foe), before - 6);
});

test("Teleport: basic not across the walls or the moat, advanced not across the walls, expert anywhere", () => {
  const s = battle([SPELL.TELEPORT], [], 2, [0, 0], true);
  const u = s.units.find((x) => x.side === 0 && !x.machine)!;
  u.pos = hexAt(3, 5);
  // Inside the walls (row 5's wall is at column 11), and the hex between the moat and the wall (row 7).
  const inside = hexAt(13, 5);
  assert.equal(canTeleport(s, u, inside, 1), false, "basic: not over the walls");
  assert.equal(canTeleport(s, u, inside, 2), false, "advanced: not over the walls");
  assert.equal(canTeleport(s, u, inside, 3), true, "expert: anywhere");
  assert.equal(canTeleport(s, u, hexAt(6, 5), 1), true, "the same side of the wall: anywhere free");
  assert.throws(() => cast(s, SPELL.TELEPORT, u.pos, inside), /can't teleport there/);
  assert.equal(s.sides[0].hero!.mana, 100, "refused before the spell points go");
  // Through a breach: the wall section on the way is down.
  s.siege!.walls.belowGate = 0;
  s.siege!.walls.overGate = 0;
  s.siege!.walls.gate = 0;
  s.blocked = s.blocked.filter((h) => h !== 78 && h !== 130);
  const behind = hexAt(13, 4);
  u.pos = hexAt(8, 4);
  assert.equal(canTeleport(s, u, behind, 2), true, "advanced: over the moat through a breach");
  assert.equal(canTeleport(s, u, behind, 1), false, "basic: not over the moat");
  // Off the siege the walls don't matter.
  const f = battle([SPELL.TELEPORT]);
  assert.equal(canTeleport(f, f.units[0], hexAt(13, 5), 1), true);
});

test("Clone: one at a time per stack, SP rounds, gone when hit by a spell or when its original falls; Anti-Magic passes it over", () => {
  const s = battle([SPELL.CLONE, SPELL.ANTI_MAGIC, SPELL.ICE_BOLT], [[WATER, 1]], 2);
  const a = s.units[0];
  cast(s, SPELL.CLONE, a.pos);
  const copy = s.units.find((u) => u.clone)!;
  assert.equal(copy.cloneOf, a.id);
  assert.equal(copy.effects?.find((e) => e.spell === SPELL.CLONE)?.rounds, 2, "lasts SP rounds");
  assert.equal(spellTargets(s, 0, SPELLS[SPELL.CLONE], a.pos).length, 0, "one clone per stack");
  assert.equal(affects(s, SPELLS[SPELL.CLONE], copy), false, "a clone isn't cloned");
  assert.equal(affects(s, SPELLS[SPELL.ANTI_MAGIC], copy), false, "Anti-Magic doesn't take clones (SPTRAITS)");
  // The enemy's hero Ice Bolts: one point of damage dispels a clone, and the original's death takes its clone along.
  const foeCasts = (b: BattleState, target: number) => {
    b.sides[1].hero = { ...b.sides[0].hero!, name: "Foe", owner: 1, spells: [SPELL.ICE_BOLT], mana: 50 };
    b.cast = [false, false];
    b.active = b.units.find((u) => u.side === 1)!.id;
    applyAction(b, { type: "cast", unit: b.active!, spell: SPELL.ICE_BOLT, target });
  };
  foeCasts(s, copy.pos);
  assert.equal(copy.count, 0, "hit by a spell: gone");
  assert.ok(copy.sacrificed, "no corpse");
  const r = battle([SPELL.CLONE, SPELL.ICE_BOLT], [[WATER, 1]], 2);
  cast(r, SPELL.CLONE, r.units[0].pos);
  const c3 = r.units.find((u) => u.clone)!;
  r.units[0].count = 1;
  r.units[0].firstHp = 1;
  foeCasts(r, r.units[0].pos);
  assert.equal(r.units[0].count, 0);
  assert.equal(c3.count, 0, "the clone goes with its original");
});

test("Clone wears off with the new round once its rounds are up, or once dispelled", () => {
  const s = battle([SPELL.CLONE, SPELL.DISPEL], [[WATER, 1]], 1);
  cast(s, SPELL.CLONE, s.units[0].pos);
  const copy = s.units.find((u) => u.clone)!;
  // Everyone acts (defends) until the round turns: the clone's one round is over.
  for (let i = 0; i < 20 && s.round === 1 && s.winner === null; i++) applyAction(s, { type: "defend", unit: s.active! });
  assert.equal(copy.count, 0, "SP 1: gone with the next round");
  const d = battle([SPELL.CLONE, SPELL.DISPEL], [[WATER, 1]], 5);
  cast(d, SPELL.CLONE, d.units[0].pos);
  const c = d.units.find((u) => u.clone)!;
  c.effects = [];
  for (let i = 0; i < 20 && d.round === 1 && d.winner === null; i++) applyAction(d, { type: "defend", unit: d.active! });
  assert.equal(c.count, 0, "dispelled: gone with the next round");
});

test("Resurrection and Animate Dead: lost creatures only, at least one whole creature back, never on an occupied corpse; Basic lends them for the battle", () => {
  const s = battle([SPELL.RESURRECTION], [[EARTH, 1]], 2, [0, 2]);
  const [a, dragon] = s.units;
  const res = SPELLS[SPELL.RESURRECTION];
  a.firstHp = 50;
  assert.equal(affects(s, res, a), false, "only the top creature wounded: nothing to raise");
  a.count = 8;
  assert.equal(affects(s, res, a), true);
  dragon.count = 9;
  assert.equal(affects(s, res, dragon), false, "140 health can't raise a 1000-health creature");
  // Basic: they come back for this battle only.
  cast(s, SPELL.RESURRECTION, a.pos);
  assert.equal(a.count, 9, "750 + 140 health: one back");
  assert.equal(a.borrowed, 1);
  // A fallen stack under another: not while somebody stands on it.
  const r = battle([SPELL.RESURRECTION], [[EARTH, 3]], 2);
  const [x, y] = r.units;
  x.count = 0;
  x.firstHp = 0;
  y.pos = x.pos;
  assert.equal(affects(r, res, x), false);
  y.pos = 52;
  assert.equal(affects(r, res, x), true);
  cast(r, SPELL.RESURRECTION, x.pos);
  assert.ok(!x.borrowed, "advanced and expert: for good");
  // Animate Dead: the undead only, under the same rules.
  const u = battle([SPELL.ANIMATE_DEAD], [], 2, [3, 0]);
  const [z, man] = u.units;
  z.count = 7;
  man.count = 7;
  assert.equal(affects(u, SPELLS[SPELL.ANIMATE_DEAD], z), true);
  assert.equal(affects(u, SPELLS[SPELL.ANIMATE_DEAD], man), false);
  z.count = 10;
  z.firstHp = 1;
  assert.equal(affects(u, SPELLS[SPELL.ANIMATE_DEAD], z), false);
});

test("Quicksand: the creatures fighting on their native terrain see the enemy's (SPTRAITS), not the Dunes' own", () => {
  const s = battle([]);
  const sand = { kind: "quicksand", side: 0, hexes: [50], rounds: -1 } as NonNullable<BattleState["hazards"]>[number];
  assert.equal(seesHazard(s, 1, sand), false);
  // Castle creatures on grass, Castle's native terrain.
  s.terrain = "grass";
  assert.equal(seesHazard(s, 1, sand), true);
  assert.equal(seesHazard(s, 1, { ...sand, neutral: true }), false);
});
