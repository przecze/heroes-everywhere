// Rules tests on a synthetic creature table, so they run without the game files.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SKILLS,
  surrenderCost,
  fleeBlock,
  battleExperience,
  defenseOf,
  hpOf,
  takeDamage,
  killedBy,
  defendBonus,
  canShootWalls,
  missedShotLands,
  autoCatapultTarget,
  damageWall,
  type BattleState,
  type BattleEvent,
  type CreatureStats,
  alive,
  applyAction,
  attackPositions,
  attackApproaches,
  splashTargets,
  canShoot,
  canStand,
  gateOpen,
  updateGate,
  inMoat,
  createBattle,
  expectedDamage,
  hexAt,
  hexDistance,
  luckOf,
  moraleOf,
  neighbours,
  runAi,
  startBattle,
  castsLeft,
  creatureSpellAt,
  controlSide,
  type SpellInfo,
  totalHp,
  attackOf,
  speedOf,
  gainRunes,
  heatStrokeArea,
  suppliedByCart,
  chooseAction,
  seesHazard,
  logText,
  logTexts,
} from "../src/index.ts";

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id,
    key: `c${id}`,
    name: `C${id}`,
    plural: `C${id}s`,
    level: 1,
    faction: "castle",
    gold: 10,
    cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0,
    fightValue: 100,
    aiValue: 100,
    growth: 5,
    hp: 10,
    speed: 5,
    attack: 5,
    defense: 5,
    minDamage: 2,
    maxDamage: 2,
    shots: 0,
    abilities: [],
    def: "",
    missile: "",
    sound: "",
    ...over,
  };
}

const TABLE = [
  creature(0),
  creature(1, { abilities: [{ type: "SHOOTER" }], shots: 10 }),
  creature(2, { attack: 15, defense: 15, faction: "rampart" }),
  creature(3, { abilities: [{ type: "DOUBLE_WIDE" }, { type: "FLYING" }], speed: 9 }),
];

function battle(a: [number, number][], b: [number, number][], seed = 1): BattleState {
  const s = createBattle(
    {
      seed,
      field: "grass_hills",
      sides: [
        { name: "A", controller: "ai", stacks: a.map(([creature, count]) => ({ creature, count })) },
        { name: "B", controller: "ai", stacks: b.map(([creature, count]) => ({ creature, count })) },
      ],
    },
    TABLE,
  );
  // Keep rules tests independent of random obstacles.
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  return s;
}

test("hex distance agrees with neighbours", () => {
  for (const h of [hexAt(5, 4), hexAt(5, 5), hexAt(1, 0), hexAt(15, 10)]) {
    for (const n of neighbours(h)) assert.equal(hexDistance(h, n), 1);
  }
  assert.equal(hexDistance(hexAt(1, 5), hexAt(15, 5)), 14);
});

test("attack/defense difference: +5% per point above, -2.5% per point below", () => {
  const s = battle([[2, 10]], [[0, 10]]);
  const [att, def] = s.units;
  // 15 vs 5: +50% -> 10 creatures x 2 dmg x 1.5
  assert.deepEqual(expectedDamage(s, att, def, false), { min: 30, max: 30 });
  // 5 vs 15: -25%
  assert.deepEqual(expectedDamage(s, def, att, false), { min: 15, max: 15 });
});

test("shooters take half damage in melee and beyond 10 hexes", () => {
  const s = battle([[1, 10]], [[0, 10]]);
  const [shooter, target] = s.units;
  assert.equal(expectedDamage(s, shooter, target, true).min, 10); // 14 hexes apart: halved
  assert.equal(expectedDamage(s, shooter, target, false).min, 10); // melee penalty
});

test("morale: single-town army gets +1, mixed armies don't", () => {
  const s = battle([[0, 5], [1, 5]], [[0, 5], [2, 5]]);
  assert.equal(moraleOf(s, s.units[0]), 1);
  assert.equal(moraleOf(s, s.units[2]), 0);
});

test("morale: war machines don't count as towns of the army", () => {
  const s = battle([[0, 5]], [[0, 5]]);
  // Three machines of other factions beside a single-town army (they'd make 4 "towns", -2, if counted).
  for (const [id, machine] of [[146, "ballista"], [148, "cart"], [147, "tent"]] as const) {
    s.creatures[id] = creature(id, { faction: "neutral", abilities: [{ type: "SIEGE_WEAPON" }] });
    s.units.push({ ...s.units[0], id: s.units.length, creature: id, count: 1, initialCount: 1, machine });
  }
  assert.equal(moraleOf(s, s.units[0]), 1);
});

test("illegal actions are rejected", () => {
  const s = battle([[0, 5]], [[0, 5]]);
  const u = s.units[s.active!];
  assert.throws(() => applyAction(s, { type: "move", unit: u.id, to: hexAt(15, 0) }));
  assert.throws(() => applyAction(s, { type: "wait", unit: 1 - u.id }));
});

test("AI battles terminate and are deterministic per seed", () => {
  const run = (seed: number) => {
    const s = battle([[0, 20], [1, 10], [3, 3]], [[2, 15], [0, 20]], seed);
    runAi(s);
    return s;
  };
  for (let seed = 1; seed <= 20; seed++) {
    const a = run(seed);
    assert.notEqual(a.winner, null);
    assert.deepEqual(a.units.map((u) => u.count), run(seed).units.map((u) => u.count));
    if (a.winner !== "draw") assert.ok(a.units.some((u) => alive(u) && u.side === a.winner));
  }
});

/** Battle with hand-placed units, no RNG surprises from obstacles. */
function arena(table: CreatureStats[], units: { creature: number; count: number; side: 0 | 1; pos: number }[]): BattleState {
  const s = createBattle(
    {
      seed: 7,
      sides: [
        { name: "A", controller: "human", stacks: units.filter((u) => u.side === 0) },
        { name: "B", controller: "human", stacks: units.filter((u) => u.side === 1) },
      ],
    },
    table,
  );
  s.obstacles = [];
  s.blocked = [];
  // No native terrain unless a test asks for one.
  delete s.terrain;
  const placed = [...units.filter((u) => u.side === 0), ...units.filter((u) => u.side === 1)];
  s.units.forEach((u, i) => (u.pos = placed[i].pos));
  startBattle(s);
  return s;
}

test("breath attack also hits the stack behind the target", () => {
  const table = [creature(0, { speed: 1 }), creature(1, { speed: 9, abilities: [{ type: "TWO_HEX_ATTACK_BREATH" }] })];
  // Dragon at (5,4) faces two stacks in a row at (6,4) and (7,4).
  const s = arena(table, [
    { creature: 1, count: 5, side: 0, pos: hexAt(5, 4) },
    { creature: 0, count: 10, side: 1, pos: hexAt(6, 4) },
    { creature: 0, count: 10, side: 1, pos: hexAt(7, 4) },
  ]);
  const events = applyAction(s, { type: "attack", unit: 0, target: 1, from: hexAt(5, 4) });
  const hit = events.filter((e) => e.e === "attack" && e.unit === 0).map((e) => (e as { target: number }).target);
  assert.deepEqual(hit.sort(), [1, 2]);
});

test("a wide attacker strikes a hex from eight sides: the six, and centred right above and below (the original's cursor)", () => {
  const table = [creature(0, { speed: 1 }), creature(1, { speed: 30, abilities: [{ type: "DOUBLE_WIDE" }, { type: "FLYING" }] })];
  for (const side of [0, 1] as const) {
    const s = arena(table, [
      { creature: 1, count: 5, side, pos: side === 0 ? hexAt(3, 8) : hexAt(13, 8) },
      { creature: 0, count: 10, side: (1 - side) as 0 | 1, pos: hexAt(8, 4) },
    ]);
    const dragon = s.units.find((u) => u.creature === 1)!;
    const target = s.units.find((u) => u.creature === 0)!;
    const ways = attackApproaches(s, dragon, target, target.pos);
    assert.deepEqual(ways.map((w) => w.dir), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(new Set(ways.map((w) => w.from)).size, 8, "eight different spots");
    // From above: the two hexes over its top left, centred over it, the two over its top right.
    const above = ways.filter((w) => [0, 6, 1].includes(w.dir)).map((w) => (side === 0 ? [w.from - 1, w.from] : [w.from, w.from + 1]));
    assert.deepEqual(above, [[hexAt(7, 3), hexAt(8, 3)], [hexAt(9, 3), hexAt(10, 3)], [hexAt(8, 3), hexAt(9, 3)]]);
    // Every spot next to the target is one of them.
    assert.deepEqual(ways.map((w) => w.from).sort(), attackPositions(s, dragon, target).sort());
  }
});

test("a wide attacker reaches a wide target from above in four spots", () => {
  const table = [creature(0, { speed: 1, abilities: [{ type: "DOUBLE_WIDE" }] }), creature(1, { speed: 30, abilities: [{ type: "DOUBLE_WIDE" }, { type: "FLYING" }] })];
  const s = arena(table, [
    { creature: 1, count: 5, side: 0, pos: hexAt(3, 8) },
    { creature: 0, count: 10, side: 1, pos: hexAt(8, 4) },
  ]);
  const [dragon, target] = s.units;
  const above = new Set([target.pos, target.pos + 1].flatMap((h) => attackApproaches(s, dragon, target, h)).map((w) => w.from).filter((h) => h < hexAt(0, 4)));
  // Heads at (8,3) (from the left), (9,3) (over its head), (10,3) (over its tail), (11,3) (from the right).
  assert.deepEqual([...above].sort(), [hexAt(8, 3), hexAt(9, 3), hexAt(10, 3), hexAt(11, 3)]);
});

test("a breath from right above goes to the rear of the approach: down-left facing right, down-right facing left", () => {
  const table = [creature(0, { speed: 1 }), creature(1, { speed: 9, abilities: [{ type: "DOUBLE_WIDE" }, { type: "TWO_HEX_ATTACK_BREATH" }] })];
  for (const side of [0, 1] as const) {
    const other = (1 - side) as 0 | 1;
    // Centred over (8,4): facing right the head is on (9,3), facing left on (8,3).
    const s = arena(table, [
      { creature: 1, count: 5, side, pos: side === 0 ? hexAt(9, 3) : hexAt(8, 3) },
      { creature: 0, count: 10, side: other, pos: hexAt(8, 4) },
      { creature: 0, count: 10, side: other, pos: hexAt(8, 5) },
      { creature: 0, count: 10, side: other, pos: hexAt(9, 5) },
    ]);
    const dragon = s.units.find((u) => u.creature === 1)!;
    const hit = splashTargets(s, dragon, s.units.find((u) => u.pos === hexAt(8, 4))!).map((u) => u.pos);
    assert.deepEqual(hit, [side === 0 ? hexAt(8, 5) : hexAt(9, 5)]);
  }
});

test("a breath at a wide target from the front stops at it; from above it goes past its tail", () => {
  const table = [creature(0, { speed: 1, abilities: [{ type: "DOUBLE_WIDE" }] }), creature(1, { speed: 9, abilities: [{ type: "DOUBLE_WIDE" }, { type: "TWO_HEX_ATTACK_BREATH" }] }), creature(2, { speed: 1 })];
  // Dragon (head 6,4) facing a wide stack on (7,4)-(8,4) with another stack at (9,4): no breath through.
  const s = arena(table, [
    { creature: 1, count: 5, side: 0, pos: hexAt(6, 4) },
    { creature: 0, count: 10, side: 1, pos: hexAt(7, 4) },
    { creature: 2, count: 10, side: 1, pos: hexAt(9, 4) },
  ]);
  assert.deepEqual(splashTargets(s, s.units[0], s.units[1]), []);
  // Centred over its head (dragon head on (8,3)): the head touches its tail (8,4), the breath goes down-right past it to (9,5).
  const t = arena(table, [
    { creature: 1, count: 5, side: 0, pos: hexAt(8, 3) },
    { creature: 0, count: 10, side: 1, pos: hexAt(7, 4) },
    { creature: 2, count: 10, side: 1, pos: hexAt(8, 5) },
    { creature: 2, count: 10, side: 1, pos: hexAt(9, 5) },
  ]);
  assert.deepEqual(splashTargets(t, t.units[0], t.units[1]).map((u) => u.pos), [hexAt(9, 5)]);
});

test("life drain raises dead attackers, but not past the starting size", () => {
  const table = [creature(0, { hp: 100, defense: 0 }), creature(1, { hp: 10, minDamage: 20, maxDamage: 20, speed: 9, abilities: [{ type: "LIFE_DRAIN", val: 100 }] })];
  const s = arena(table, [
    { creature: 1, count: 4, side: 0, pos: hexAt(5, 4) },
    { creature: 0, count: 5, side: 1, pos: hexAt(6, 4) },
  ]);
  s.units[0].count = 2; // two of four already dead
  const events = applyAction(s, { type: "attack", unit: 0, target: 1, from: hexAt(5, 4) });
  // 50 damage dealt would heal 5 creatures' worth, but the stack started with 4.
  const drain = events.find((e) => e.e === "drain") as { revived: number } | undefined;
  assert.equal(drain?.revived, 2);
});

test("an unhurt life drainer drains nothing to show; a dispel with nothing helpful on the target shows nothing", () => {
  const table = [creature(0, { hp: 100, defense: 0 }), creature(1, { hp: 10, minDamage: 20, maxDamage: 20, speed: 9, abilities: [{ type: "LIFE_DRAIN", val: 100 }, { type: "SPELL_AFTER_ATTACK", subtype: "dispelHelpful", val: 100 }] })];
  const s = arena(table, [
    { creature: 1, count: 4, side: 0, pos: hexAt(5, 4) },
    { creature: 0, count: 5, side: 1, pos: hexAt(6, 4) },
  ]);
  const events = applyAction(s, { type: "attack", unit: 0, target: 1, from: hexAt(5, 4) });
  assert.equal(events.some((e) => e.e === "drain"), false);
  assert.equal(events.some((e) => e.e === "spell"), false);
});

test("death stare never kills more than a tenth of the gorgons, rounded up", () => {
  const table = [creature(0, { hp: 1000, defense: 50 }), creature(1, { speed: 9, abilities: [{ type: "DEATH_STARE", val: 100 }] })];
  const s = arena(table, [
    { creature: 1, count: 15, side: 0, pos: hexAt(5, 4) },
    { creature: 0, count: 50, side: 1, pos: hexAt(6, 4) },
  ]);
  const events = applyAction(s, { type: "attack", unit: 0, target: 1, from: hexAt(5, 4) });
  const stare = events.find((e) => e.e === "stare") as { killed: number } | undefined;
  assert.equal(stare?.killed, 2);
});

test("phoenix rebirth brings back a fifth of the stack once", () => {
  const table = [creature(0, { speed: 9, minDamage: 1000, maxDamage: 1000 }), creature(1, { abilities: [{ type: "REBIRTH", val: 20 }] })];
  const s = arena(table, [
    { creature: 0, count: 10, side: 0, pos: hexAt(5, 4) },
    { creature: 1, count: 10, side: 1, pos: hexAt(6, 4) },
    { creature: 1, count: 1, side: 1, pos: hexAt(15, 10) },
  ]);
  const events = applyAction(s, { type: "attack", unit: 0, target: 1, from: hexAt(5, 4) });
  assert.ok(events.some((e) => e.e === "rebirth"));
  assert.ok(s.units[1].count >= 2 && s.units[1].reborn);
  // Risen from the blow that killed them, they don't strike back at it (VCMI's rebirth.lua).
  assert.ok(!events.some((e) => e.e === "attack" && e.retaliation && e.unit === 1), "no strike back from the ashes");
});

test("wide units turn around to get behind an enemy", () => {
  const table = [creature(0, { speed: 1 }), creature(1, { speed: 7, abilities: [{ type: "DOUBLE_WIDE" }] })];
  // Our two-hex unit faces right at (8,5)/(7,5); the enemy stands behind it at (4,5).
  const s = arena(table, [
    { creature: 1, count: 5, side: 0, pos: hexAt(8, 5) },
    { creature: 0, count: 10, side: 1, pos: hexAt(4, 5) },
  ]);
  const options = attackPositions(s, s.units[0], s.units[1]);
  // Standing on (2,5)/(3,5) - the far side of the enemy - needs a turn on the way.
  assert.ok(options.includes(hexAt(3, 5)), `options: ${options}`);
});

test("devils curse enemy luck; halflings are always lucky", () => {
  const table = [creature(0), creature(1, { key: "archDevil", abilities: [{ type: "LUCK", val: -2 }] }), creature(2, { abilities: [{ type: "LUCK", val: 1 }] })];
  const s = arena(table, [
    { creature: 0, count: 5, side: 0, pos: hexAt(2, 2) },
    { creature: 2, count: 5, side: 0, pos: hexAt(2, 4) },
    { creature: 1, count: 1, side: 1, pos: hexAt(14, 2) },
  ]);
  assert.equal(luckOf(s, s.units[0]), -2);
  assert.equal(luckOf(s, s.units[1]), 1);
});

test("harpies fly back after striking", () => {
  const table = [creature(0, { speed: 1 }), creature(1, { speed: 9, abilities: [{ type: "FLYING" }, { type: "RETURN_AFTER_STRIKE" }] })];
  const s = arena(table, [
    { creature: 1, count: 5, side: 0, pos: hexAt(2, 4) },
    { creature: 0, count: 10, side: 1, pos: hexAt(8, 4) },
  ]);
  applyAction(s, { type: "attack", unit: 0, target: 1, from: hexAt(7, 4) });
  assert.equal(s.units[0].pos, hexAt(2, 4));
});

test("HotA: Nix blunts attack, Ayssid ferocity, Gunslinger shoots first, Steel Elf shoots point-blank", () => {
  // Nix: 60% less attack for whoever strikes it.
  {
    const table = [creature(0, { attack: 20 }), creature(1, { defense: 0, abilities: [{ type: "ENEMY_ATTACK_REDUCTION", val: 60 }] })];
    const s = arena(table, [
      { creature: 0, count: 10, side: 0, pos: hexAt(5, 4) },
      { creature: 1, count: 10, side: 1, pos: hexAt(6, 4) },
    ]);
    // Attack 20 -> 8 vs defense 0: +40%, so 10 x 2 x 1.4.
    assert.equal(expectedDamage(s, s.units[0], s.units[1], false).min, 28);
  }
  // Ferocity: a killing blow earns a second attack.
  {
    const table = [creature(0, { hp: 1, defense: 0 }), creature(1, { hp: 1000, minDamage: 3, maxDamage: 3, abilities: [{ type: "FEROCITY", val: 1 }] })];
    const s = arena(table, [
      { creature: 1, count: 1, side: 0, pos: hexAt(5, 4) },
      { creature: 0, count: 20, side: 1, pos: hexAt(6, 4) },
    ]);
    const events = applyAction(s, { type: "attack", unit: 0, target: 1, from: hexAt(5, 4) });
    assert.equal(events.filter((e) => e.e === "attack" && e.unit === 0 && !e.retaliation).length, 2);
  }
  // Gunslinger: shot at, it fires back first (FIRST_STRIKE); without first strike, after the shot.
  {
    const table = [creature(0, { abilities: [{ type: "SHOOTER" }], shots: 5 }), creature(1, { abilities: [{ type: "SHOOTER" }, { type: "RANGED_RETALIATION" }], shots: 5 })];
    const s = arena(table, [
      { creature: 0, count: 5, side: 0, pos: hexAt(2, 4) },
      { creature: 1, count: 50, side: 1, pos: hexAt(14, 4) },
    ]);
    const events = applyAction(s, { type: "shoot", unit: 0, target: 1 });
    const attacks = events.filter((e) => e.e === "attack") as { unit: number; retaliation: boolean }[];
    assert.deepEqual(attacks.map((e) => e.unit), [0, 1]);
  }
  {
    const table = [creature(0, { abilities: [{ type: "SHOOTER" }], shots: 5 }), creature(1, { abilities: [{ type: "SHOOTER" }, { type: "RANGED_RETALIATION" }, { type: "FIRST_STRIKE", subtype: "damageTypeRanged" }], shots: 5 })];
    const s = arena(table, [
      { creature: 0, count: 5, side: 0, pos: hexAt(2, 4) },
      { creature: 1, count: 5, side: 1, pos: hexAt(14, 4) },
    ]);
    const events = applyAction(s, { type: "shoot", unit: 0, target: 1 });
    const first = events.find((e) => e.e === "attack") as { unit: number; retaliation: boolean };
    assert.equal(first.unit, 1);
    assert.equal(first.retaliation, true);
  }
  // First strike in melee: the defender hits back before the blow, and only once.
  {
    const table = [creature(0), creature(1, { abilities: [{ type: "FIRST_STRIKE", subtype: "damageTypeAll" }] })];
    const s = arena(table, [
      { creature: 0, count: 5, side: 0, pos: hexAt(5, 4) },
      { creature: 1, count: 2, side: 1, pos: hexAt(6, 4) },
    ]);
    const events = applyAction(s, { type: "attack", unit: 0, target: 1, from: hexAt(5, 4) });
    const attacks = events.filter((e) => e.e === "attack") as { unit: number; retaliation: boolean }[];
    assert.deepEqual(attacks.map((e) => [e.unit, e.retaliation]), [[1, true], [0, false]]);
  }
  // Steel Elf: can shoot an adjacent enemy.
  {
    const table = [creature(0), creature(1, { abilities: [{ type: "SHOOTER" }, { type: "FREE_SHOOTING" }], shots: 5 })];
    const s = arena(table, [
      { creature: 1, count: 5, side: 0, pos: hexAt(5, 4) },
      { creature: 0, count: 5, side: 1, pos: hexAt(6, 4) },
    ]);
    assert.ok(canShoot(s, s.units[0]));
  }
});

test("war machines: ballista fires on its own, the tent heals, machines alone don't keep a battle going", () => {
  const table = [...TABLE];
  table[146] = creature(146, { key: "ballista", hp: 250, speed: 0, attack: 10, minDamage: 2, maxDamage: 3, shots: 24, abilities: [{ type: "DOUBLE_WIDE" }, { type: "SHOOTER" }] });
  table[147] = creature(147, { key: "firstAidTent", hp: 75, speed: 0, abilities: [{ type: "DOUBLE_WIDE" }] });
  table[148] = creature(148, { key: "ammoCart", hp: 100, speed: 0 });
  const hero = { name: "H", heroClass: 0, female: false, owner: 0, primary: [4, 0, 1, 1] as [number, number, number, number], machines: [4, 5, 6] };
  const s = createBattle(
    {
      seed: 3,
      field: "grass_hills",
      sides: [
        { name: "A", controller: "human", stacks: [{ creature: 1, count: 5 }], hero },
        { name: "B", controller: "ai", stacks: [{ creature: 0, count: 50 }] },
      ],
    },
    table,
  );
  s.obstacles = [];
  s.blocked = [];
  const machines = s.units.filter((u) => u.machine);
  assert.deepEqual(machines.map((u) => u.machine).sort(), ["ballista", "cart", "tent"]);
  startBattle(s);
  // Play the human shooters by always shooting; the ballista needs no orders.
  for (let i = 0; i < 200 && s.winner === null; i++) {
    const u = s.units.find((x) => x.id === s.active)!;
    if (u.side === 0 && !u.machine) {
      const target = s.units.find((x) => alive(x) && x.side === 1)!;
      applyAction(s, canShoot(s, u) ? { type: "shoot", unit: u.id, target: target.id } : { type: "defend", unit: u.id });
    }
    runAi(s);
  }
  assert.notEqual(s.winner, null);
  const shooters = s.units.find((u) => u.side === 0 && u.creature === 1)!;
  assert.equal(shooters.shots, 10, "the ammo cart keeps the quivers full");
  assert.ok(logTexts(s).some((l) => /Ballista/i.test(l) || /C146/.test(l)), "the ballista fired");
});

test("siege: walls block, the gate lets only defenders through, towers shoot first, the catapult breaks walls", () => {
  const table = [...TABLE];
  table[145] = creature(145, { key: "catapult", hp: 1000, speed: 0, abilities: [{ type: "DOUBLE_WIDE" }, { type: "SHOOTER" }], shots: 24 });
  table[149] = creature(149, { key: "arrowTower", hp: 1000, speed: 0, abilities: [{ type: "SHOOTER" }], shots: 99 });
  const hero = { name: "H", heroClass: 0, female: false, owner: 0, primary: [1, 1, 1, 1] as [number, number, number, number], machines: [3], skills: [] as [number, number][] };
  const s = createBattle(
    {
      seed: 5,
      siege: { faction: "castle", level: 3, structures: 10 },
      sides: [
        { name: "A", controller: "ai", stacks: [{ creature: 0, count: 30 }], hero },
        { name: "B", controller: "ai", stacks: [{ creature: 0, count: 10 }] },
      ],
    },
    table,
  );
  assert.ok(s.siege);
  assert.deepEqual(s.obstacles, []);
  assert.equal(s.units.filter((u) => u.machine === "tower").length, 3);
  assert.ok(s.units.some((u) => u.machine === "catapult"));
  assert.ok(s.blocked.includes(29) && s.blocked.includes(12));
  const attacker = s.units.find((u) => u.side === 0 && !u.machine)!;
  const defender = s.units.find((u) => u.side === 1 && !u.machine)!;
  assert.equal(canStand(s, attacker, 96), false, "the gate holds attackers");
  assert.equal(canStand(s, defender, 96), true, "defenders pass the gate");
  startBattle(s);
  assert.equal(s.units[s.active!].machine, "tower", "towers shoot first");
  runAi(s);
  assert.notEqual(s.winner, null);
  assert.ok(logTexts(s).some((l) => /catapult/.test(l)), "the catapult threw stones");
});

test("siege: a defender standing in the gateway holds the gate open, and attackers can reach it there", () => {
  const s = createBattle(
    {
      seed: 5,
      siege: { faction: "conflux", level: 1, structures: 10 },
      sides: [
        { name: "A", controller: "human", stacks: [{ creature: 0, count: 30 }] },
        { name: "B", controller: "human", stacks: [{ creature: 0, count: 10 }] },
      ],
    },
    TABLE,
  );
  const attacker = s.units.find((u) => u.side === 0 && !u.machine)!;
  const defender = s.units.find((u) => u.side === 1 && !u.machine)!;
  attacker.pos = 93;
  updateGate(s);
  assert.equal(gateOpen(s), false);
  assert.equal(canStand(s, attacker, 95), false, "a raised bridge holds attackers");
  // (a player's first game: a Fire Elemental in the inner gate hex, out of every attacker's reach.)
  defender.pos = 96;
  updateGate(s);
  assert.equal(gateOpen(s), true, "someone in the gateway: the bridge stays down");
  assert.equal(canStand(s, attacker, 95), true, "attackers may step onto the lowered bridge");
  assert.ok(attackPositions(s, attacker, defender).includes(95), "and strike the stack in the gate from there");
  defender.pos = 95;
  attacker.pos = 94;
  updateGate(s);
  assert.ok(attackPositions(s, attacker, defender).includes(94), "in the outer gate hex: from in front of it");
  // The owner 2026-11-01: a corpse in the gateway holds the bridge down as a living stack does (VCMI's updateGateState).
  defender.count = 0;
  updateGate(s);
  assert.equal(gateOpen(s), true, "a corpse in the gateway: the bridge stays down");
  assert.equal(canStand(s, attacker, 96), true, "and the attackers walk in over it");
  defender.sacrificed = true;
  updateGate(s);
  assert.equal(gateOpen(s), false, "nobody in it: the bridge goes up again");
  assert.equal(canStand(s, attacker, 95), false);
  // Something on the bridge's hex in front of the raised gate keeps it up for the defenders too.
  const d2 = { ...defender, id: s.units.length, count: 10, sacrificed: false, pos: 97 };
  s.units.push(d2);
  updateGate(s);
  assert.equal(s.siege!.bridge, "blocked", "the attacker on the bridge's hex blocks the drawbridge");
  assert.equal(canStand(s, d2, 96), false, "and the defenders can't use the gate");
  attacker.pos = 80;
  updateGate(s);
  assert.equal(canStand(s, d2, 96), true, "the bridge's hex clear: defenders may come out again");
});

test("siege: a wide defender with only its tail in the gateway holds the bridge down (the owner's Cerberi 2026-11-01)", () => {
  const table = [...TABLE];
  table[47] = creature(47, { abilities: [{ type: "DOUBLE_WIDE" }] });
  const s = createBattle(
    {
      seed: 5,
      siege: { faction: "inferno", level: 3, structures: 10 },
      sides: [
        { name: "A", controller: "human", stacks: [{ creature: 0, count: 30 }] },
        { name: "B", controller: "human", stacks: [{ creature: 47, count: 10 }] },
      ],
    },
    table,
  );
  const attacker = s.units.find((u) => u.side === 0 && !u.machine)!;
  const cerberi = s.units.find((u) => u.side === 1 && !u.machine)!;
  attacker.pos = 92;
  cerberi.pos = 94; // head on the bridge's hex, tail on the outer gate hex
  updateGate(s);
  assert.equal(gateOpen(s), true, "its tail in the gateway: the bridge is down");
  assert.equal(canStand(s, attacker, 96), true);
  cerberi.count = 0;
  updateGate(s);
  assert.equal(gateOpen(s), true, "its corpse too");
});

test("siege: Fortress's long bridge is dry while down, holds it down, and an attacker in the moat in front blocks it", () => {
  const s = createBattle(
    {
      seed: 5,
      siege: { faction: "fortress", level: 2, structures: 10 },
      sides: [
        { name: "A", controller: "human", stacks: [{ creature: 0, count: 30 }] },
        { name: "B", controller: "human", stacks: [{ creature: 0, count: 10 }] },
      ],
    },
    TABLE,
  );
  const attacker = s.units.find((u) => u.side === 0 && !u.machine)!;
  const defender = s.units.find((u) => u.side === 1 && !u.machine)!;
  attacker.pos = 94;
  updateGate(s);
  assert.equal(s.siege!.bridge, "blocked", "an attacker who waded to the bridge's hex doesn't lower it");
  assert.equal(inMoat(s, 94), true, "and stands in the moat");
  assert.equal(canStand(s, attacker, 95), false);
  attacker.pos = 80;
  updateGate(s);
  assert.equal(s.siege!.bridge, undefined, "the bridge's hex clear: just up");
  defender.pos = 94;
  updateGate(s);
  assert.equal(gateOpen(s), true, "a defender on the long bridge lowers it");
  assert.equal(inMoat(s, 94), false, "and the bridge is dry");
  defender.count = 0;
  updateGate(s);
  assert.equal(gateOpen(s), true, "its corpse there still holds it down");
});

test("after-attack spells: dendroids bind, medusas petrify (half damage), ghost dragons age; magogs splash", () => {
  const table = [...TABLE];
  table[22] = creature(22, { abilities: [{ type: "SPELL_AFTER_ATTACK", subtype: "bind", val: 100 }] });
  table[76] = creature(76, { abilities: [{ type: "SPELL_AFTER_ATTACK", subtype: "stoneGaze", val: 100 }] });
  table[69] = creature(69, { hp: 200, abilities: [{ type: "SPELL_AFTER_ATTACK", subtype: "age", val: 100 }] });
  table[45] = creature(45, { shots: 10, abilities: [{ type: "SHOOTER" }, { type: "SPELL_LIKE_ATTACK", subtype: "fireballAbility" }] });
  table[5] = creature(5, { hp: 100 });
  // Bind: the target can't walk away afterwards.
  let s = arena(table, [
    { creature: 22, count: 10, side: 0, pos: hexAt(7, 5) },
    { creature: 5, count: 10, side: 1, pos: hexAt(8, 5) },
  ]);
  const [dendroids, target] = s.units;
  s.active = dendroids.id;
  applyAction(s, { type: "attack", unit: dendroids.id, target: target.id, from: dendroids.pos });
  assert.ok(target.effects?.some((e) => e.spell === 72), "bound");
  s.active = target.id;
  assert.throws(() => applyAction(s, { type: "move", unit: target.id, to: hexAt(10, 5) }));
  // The dendroids slain: the bind and its mark go with them (2026-10-26T18-43-44-980Z).
  takeDamage(s, dendroids, 1e6);
  assert.ok(!target.effects?.some((e) => e.spell === 72), "let go when the binder dies");
  // Age: health halved while it lasts.
  s = arena(table, [
    { creature: 69, count: 1, side: 0, pos: hexAt(7, 5) },
    { creature: 5, count: 10, side: 1, pos: hexAt(8, 5) },
  ]);
  s.active = s.units[0].id;
  applyAction(s, { type: "attack", unit: s.units[0].id, target: s.units[1].id, from: s.units[0].pos });
  assert.ok(s.units[1].firstHp <= 50, "aged");
  // Magog fireball: the stack next to the target is hit too (here, an ally of the target).
  s = arena(table, [
    { creature: 45, count: 10, side: 0, pos: hexAt(1, 5) },
    { creature: 5, count: 10, side: 1, pos: hexAt(12, 5) },
    { creature: 5, count: 10, side: 1, pos: hexAt(13, 5) },
  ]);
  s.active = s.units[0].id;
  applyAction(s, { type: "shoot", unit: s.units[0].id, target: s.units[1].id });
  assert.ok(totalHp(s, s.units[2]) < 1000, "splash");
});

test("creature spellcasters: archangels resurrect, pit lords raise demons, ogre magi bloodlust", () => {
  const table = [...TABLE];
  const spells = [
    { id: 38, key: "resurrection", name: "Resurrection", level: 5, schools: ["earth"], cost: [20, 20, 20, 20], power: 50, effect: [40, 40, 160, 160], chance: [], text: [] },
    { id: 43, key: "bloodlust", name: "Bloodlust", level: 1, schools: ["fire"], cost: [5, 5, 4, 4], power: 1, effect: [3, 3, 6, 6], chance: [], text: [] },
  ] as unknown as SpellInfo[];
  const spellTable: SpellInfo[] = [];
  for (const sp of spells) spellTable[sp.id] = sp;
  table[13] = creature(13, { abilities: [{ type: "SPELLCASTER", subtype: "resurrection", val: 3 }, { type: "SPECIFIC_SPELL_POWER", subtype: "resurrection", val: 100 }, { type: "CASTS", val: 1 }] });
  table[51] = creature(51, { abilities: [{ type: "SPELLCASTER", subtype: "summonDemons", val: 0 }, { type: "CASTS", val: 1 }] });
  table[48] = creature(48, { hp: 35 });
  table[91] = creature(91, { abilities: [{ type: "SPELLCASTER", subtype: "bloodlust", val: 2 }, { type: "CASTS", val: 3 }, { type: "CREATURE_ENCHANT_POWER", val: 3 }] });
  const s = createBattle(
    {
      seed: 9,
      sides: [
        { name: "A", controller: "human", stacks: [{ creature: 13, count: 2 }, { creature: 51, count: 7 }, { creature: 91, count: 5 }, { creature: 0, count: 20 }] },
        { name: "B", controller: "human", stacks: [{ creature: 0, count: 5 }] },
      ],
    },
    table,
    spellTable,
  );
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  const [angels, lords, ogres, men] = s.units;
  men.count = 10; // half the men fell
  s.active = angels.id;
  applyAction(s, { type: "creatureCast", unit: angels.id, target: men.pos });
  assert.equal(men.count, 20, "200 health raises the ten fallen men");
  assert.equal(castsLeft(s, angels), 0);
  men.count = 0;
  s.active = lords.id;
  applyAction(s, { type: "creatureCast", unit: lords.id, target: men.pos });
  assert.equal(men.creature, 48);
  assert.equal(men.count, 5, "7 x 50 health / 35 = 10 demons, capped by the 20 men x 10 health / 35");
  s.active = ogres.id;
  // The enemy hero's Orb of Inhibition: no spell is offered (the rules would turn it down).
  assert.ok(creatureSpellAt(s, ogres, angels.pos).length);
  s.sides[1].hero = { bonuses: [{ type: "BLOCK_ALL_MAGIC" }] } as unknown as (typeof s.sides)[1]["hero"];
  assert.deepEqual(creatureSpellAt(s, ogres, angels.pos), []);
  delete s.sides[1].hero;
  applyAction(s, { type: "creatureCast", unit: ogres.id, target: angels.pos });
  assert.ok(angels.effects?.some((e) => e.spell === 43 && e.rounds === 3));
});

test("battlefield spells: force field blocks, mines blow up under enemies, quicksand stops them; hypnotize and berserk", () => {
  const table = [...TABLE];
  const sp = (id: number, key: string, power: number, effect: number[]) => ({ id, key, name: key, level: 2, schools: ["earth"], cost: [5, 5, 5, 5], power, effect, chance: [], text: [] }) as unknown as SpellInfo;
  const spells: SpellInfo[] = [];
  for (const x of [sp(10, "quicksand", 0, [0, 0, 0, 0]), sp(11, "landMine", 10, [25, 25, 50, 100]), sp(12, "forceField", 0, [0, 0, 0, 0]), sp(59, "berserk", 0, [0, 0, 0, 0]), sp(60, "hypnotize", 25, [10, 10, 20, 50])]) spells[x.id] = x;
  const hero = (owner: number) => ({ name: "H", heroClass: 0, female: false, owner, primary: [0, 0, 10, 10] as [number, number, number, number], spells: [10, 11, 12, 59, 60], mana: 500 });
  const make = () => {
    // (On dirt: Castle's troops at home on grass would see the mines, and Land Mine couldn't be cast.)
    const s = createBattle({ seed: 3, field: "dirt_hills", sides: [
      { name: "A", controller: "human", stacks: [{ creature: 0, count: 10 }, { creature: 0, count: 10 }], hero: hero(0) },
      { name: "B", controller: "human", stacks: [{ creature: 0, count: 5 }], hero: hero(1) },
    ] }, table, spells);
    s.obstacles = [];
    s.blocked = [];
    startBattle(s);
    return s;
  };
  // Force field: the hexes can't be entered.
  let s = make();
  const [a1] = s.units;
  s.active = a1.id;
  applyAction(s, { type: "cast", unit: a1.id, spell: 12, target: hexAt(5, 5) });
  assert.ok(s.hazards?.some((z) => z.kind === "forceField" && z.hexes.length === 2));
  a1.pos = hexAt(4, 5);
  assert.equal(canStand(s, a1, hexAt(5, 5)), false);
  // Land mines hurt the enemy that steps on them.
  s = make();
  s.active = s.units[0].id;
  applyAction(s, { type: "cast", unit: s.units[0].id, spell: 11, target: 0 });
  const mine = s.hazards!.find((z) => z.kind === "mine")!;
  const enemy = s.units[2];
  enemy.pos = mine.hexes[0] + 1;
  if (!canStand(s, enemy, enemy.pos)) enemy.pos = mine.hexes[0] - 1;
  s.active = enemy.id;
  const before = totalHp(s, enemy);
  applyAction(s, { type: "move", unit: enemy.id, to: mine.hexes[0] });
  assert.ok(totalHp(s, enemy) < before, "the mine went off");
  // A stack the spell can't touch (immune to it, as the Efreet are to fire) walks through: the mine goes off harmlessly.
  for (const immune of [true, false]) {
    s = make();
    s.active = s.units[0].id;
    applyAction(s, { type: "cast", unit: s.units[0].id, spell: 11, target: 0 });
    const z = s.hazards!.find((x) => x.kind === "mine")!;
    const e = s.units[2];
    e.count = 100; // (enough to take the whole blast)
    s.creatures[0] = { ...s.creatures[0], abilities: [...s.creatures[0].abilities, immune ? { type: "SPELL_IMMUNITY", subtype: "landMine" } : { type: "SPELL_DAMAGE_REDUCTION", subtype: "any", val: 50 }] };
    e.pos = canStand(s, e, z.hexes[0] + 1) ? z.hexes[0] + 1 : z.hexes[0] - 1;
    s.active = e.id;
    const hp = totalHp(s, e);
    applyAction(s, { type: "move", unit: e.id, to: z.hexes[0] });
    if (immune) assert.equal(totalHp(s, e), hp, "immune: unhurt");
    else assert.equal(hp - totalHp(s, e), Math.floor((z.damage ?? 0) / 2), "Golems' reduction halves it");
    assert.ok(!s.hazards!.includes(z), "the mine is spent");
  }
  // Hypnotize: the enemy fights for us; berserk makes a stack strike its own.
  s = make();
  s.active = s.units[0].id;
  applyAction(s, { type: "cast", unit: s.units[0].id, spell: 60, target: s.units[2].pos });
  assert.equal(controlSide(s.units[2]), 0);
});

test("tactics: the better tactician rearranges within its columns before the first turn", () => {
  const hero = (lvl: number) => ({ name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 0, 0] as [number, number, number, number], skills: lvl ? ([[19, lvl]] as [number, number][]) : [] });
  const s = createBattle({ seed: 2, field: "grass_hills", sides: [
    { name: "A", controller: "human", stacks: [{ creature: 0, count: 5 }], hero: hero(2) },
    { name: "B", controller: "ai", stacks: [{ creature: 0, count: 5 }], hero: hero(0) },
  ] }, TABLE);
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  assert.deepEqual(s.tactics, { side: 0, cols: 5 });
  const u = s.units[0];
  assert.throws(() => applyAction(s, { type: "tacticMove", unit: u.id, to: hexAt(8, 5) }), /can't place/);
  applyAction(s, { type: "tacticMove", unit: u.id, to: hexAt(5, 3) });
  assert.equal(u.pos, hexAt(5, 3));
  // A walker walks round what stands in its way, as in battle (2026-10-30: it flew straight over it).
  s.blocked = [hexAt(4, 3)];
  const ev = applyAction(s, { type: "tacticMove", unit: u.id, to: hexAt(3, 3) });
  const walk = ev.find((e) => e.e === "move") as { path: number[]; fly: boolean };
  assert.equal(walk.fly, false);
  assert.ok(walk.path.length > 2 && !walk.path.includes(hexAt(4, 3)), `walked round: ${walk.path}`);
  assert.equal(u.pos, hexAt(3, 3));
  s.blocked = [];
  applyAction(s, { type: "tacticsDone", unit: u.id });
  assert.equal(s.tactics, undefined);
  assert.notEqual(s.active, null);
});

test("tactics: the computer's hero arranges before the battle is seen (no moves to watch)", () => {
  const hero = (lvl: number) => ({ name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 0, 0] as [number, number, number, number], skills: lvl ? ([[19, lvl]] as [number, number][]) : [] });
  const s = createBattle({ seed: 2, field: "grass_hills", sides: [
    { name: "A", controller: "human", stacks: [{ creature: 0, count: 5 }], hero: hero(0) },
    { name: "B", controller: "ai", stacks: [{ creature: 0, count: 5 }], hero: hero(3) },
  ] }, TABLE);
  s.obstacles = [];
  s.blocked = [];
  const before = s.units[1].pos;
  const ev = startBattle(s);
  assert.equal(s.tactics, undefined);
  assert.notEqual(s.units[1].pos, before, "stepped forward");
  assert.ok(!ev.some((e) => e.e === "move"), "no walk shown");
});

test("Runes (HotA): Rune Levels from defending; Yeti Runemasters have their own; Yetis shake off curses", () => {
  const table = [...TABLE];
  table[4] = creature(4, { abilities: [{ type: "DOUBLE_WIDE" }, { type: "ENCHANTED", subtype: "yetiCure" }, { type: "YETI_RUNE_LEVEL_COUNTER" }] });
  const hero = { name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 0, 0] as [number, number, number, number], skills: [[29, 3]] as [number, number][] };
  const s = createBattle({ seed: 3, field: "grass_hills", sides: [
    { name: "A", controller: "human", stacks: [{ creature: 0, count: 5 }], hero },
    { name: "B", controller: "human", stacks: [{ creature: 4, count: 5 }] },
  ] }, table);
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  const [a, y] = s.units;
  const before = { atk: attackOf(s, a), spd: speedOf(s, a) };
  a.runes = 0;
  gainRunes(s, a, 3);
  assert.equal(a.runes, 3);
  assert.equal(attackOf(s, a), before.atk + 2);
  assert.equal(speedOf(s, a), before.spd + 1);
  gainRunes(s, a, 30);
  assert.equal(a.runes, 9, "Expert: up to 9 levels");
  assert.equal(attackOf(s, a), before.atk + 6);
  // The Runemaster without a hero still has Expert Runes.
  const yAtk = attackOf(s, y);
  gainRunes(s, y, 4);
  assert.equal(attackOf(s, y), yAtk + 4);
  // Yetis recover from a curse after one round.
  y.effects = [{ spell: 42, rounds: 3, mastery: 1, value: 1 }];
  for (let i = 0; i < 30 && s.round === 1; i++) applyAction(s, { type: "defend", unit: s.active! });
  assert.ok(!(y.effects ?? []).some((e) => e.spell === 42), "the curse is gone");
});

test("Heat Stroke (HotA): Juggernauts burn the stacks next to them and behind, without retaliation", () => {
  const table = [...TABLE];
  table[5] = creature(5, { attack: 20, minDamage: 40, maxDamage: 50, hp: 300, speed: 7, abilities: [{ type: "SPELLCASTER", subtype: "heatStrokeJuggernaut" }, { type: "CASTS" }] });
  const s = createBattle({ seed: 4, field: "grass_hills", sides: [
    { name: "A", controller: "human", stacks: [{ creature: 5, count: 2 }] },
    { name: "B", controller: "human", stacks: [{ creature: 0, count: 50 }, { creature: 0, count: 50 }] },
  ] }, table);
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  const [j, near, far] = s.units;
  j.pos = hexAt(5, 5);
  const front = hexAt(6, 5);
  near.pos = front;
  // A hex two steps out in the same direction.
  far.pos = hexAt(7, 5);
  s.active = j.id;
  const area = heatStrokeArea(s, j, front);
  assert.ok(area.includes(front) && area.includes(far.pos), `area ${area}`);
  applyAction(s, { type: "creatureCast", unit: j.id, target: front });
  assert.ok(near.count < 50 && far.count < 50, "both stacks burnt");
  assert.equal(j.count, 2, "no retaliation");
});

test("battle AI: with only battlefield spells it lays Land Mines in the way of walking enemies", () => {
  const table = [...TABLE];
  const sp = (id: number, key: string, power: number, effect: number[]) => ({ id, key, name: key, level: 2, schools: ["fire"], cost: [5, 5, 5, 5], power, effect, chance: [], text: [] }) as unknown as SpellInfo;
  const spells: SpellInfo[] = [];
  for (const x of [sp(11, "landMine", 10, [25, 25, 50, 100])]) spells[x.id] = x;
  const hero = { name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 10, 10] as [number, number, number, number], spells: [11], mana: 500 };
  const s = createBattle({ seed: 5, field: "dirt_hills", sides: [
    { name: "A", controller: "ai", stacks: [{ creature: 1, count: 10 }], hero },
    { name: "B", controller: "ai", stacks: [{ creature: 0, count: 30 }, { creature: 2, count: 30 }] },
  ] }, table, spells);
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  const before = s.hazards?.length ?? 0;
  for (let i = 0; i < 6 && !(s.hazards?.length ?? 0); i++) runAi(s);
  assert.ok((s.hazards?.length ?? 0) > before, "mines laid");
});

test("hero specialties: creature specialists, Sir Mullich's speed, Kilgor's Behemoths", () => {
  const table = [...TABLE];
  table[2] = creature(2, { attack: 6, defense: 3, level: 2 });
  table[66] = creature(66, { attack: 17, defense: 17, level: 7, minDamage: 30, maxDamage: 50 });
  const make = (type: number, level: number, creature: number) => {
    const s = createBattle({ seed: 1, field: "grass_hills", sides: [
      { name: "A", controller: "human", stacks: [{ creature, count: 5 }], hero: { name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 0, 0], type, level } },
      { name: "B", controller: "human", stacks: [{ creature: 0, count: 5 }] },
    ] }, table);
    delete s.terrain; // (just the specialty)
    return { s, u: s.units[0] };
  };
  // Valeska (archers): level 10 / creature level 2 = 5 steps of HotA's 20%: 6 attack + 100% = 12.
  const v = make(1, 10, 2);
  assert.equal(attackOf(v.s, v.u), 12);
  // Level 7: 3 steps, 6 + 60% (rounded up) = 10.
  assert.equal(attackOf(make(1, 7, 2).s, make(1, 7, 2).u), 10);
  assert.equal(speedOf(v.s, v.u), (table[2].speed ?? 0) + 1);
  // Sir Mullich: +2 speed for everyone.
  const m = make(144, 1, 0);
  assert.equal(speedOf(m.s, m.u), (table[0].speed ?? 0) + 2);
  // Lord Haart the Death Knight: Black Knights +10 attack in HotA (classic +5).
  const k = make(150, 1, 66);
  assert.equal(attackOf(k.s, k.u), 17 + 10);
});

test("siege: Cyclopes throw at the walls (the King twice); defenders' Cyclopes can't", () => {
  const table = [...TABLE];
  table[95] = creature(95, { key: "cyclopKing", hp: 70, speed: 8, abilities: [{ type: "SHOOTER" }, { type: "CATAPULT", subtype: "cyclopsShot" }, { type: "CATAPULT_EXTRA_SHOTS", subtype: "cyclopsShot", val: 1 }], shots: 24 });
  table[149] = creature(149, { key: "arrowTower", hp: 1000, speed: 0, abilities: [{ type: "SHOOTER" }], shots: 99 });
  const s = createBattle(
    {
      seed: 7,
      siege: { faction: "castle", level: 1, structures: 10 },
      sides: [
        { name: "A", controller: "ai", stacks: [{ creature: 95, count: 10 }] },
        { name: "B", controller: "ai", stacks: [{ creature: 95, count: 10 }] },
      ],
    },
    table,
  );
  startBattle(s);
  const mine = s.units.find((u) => u.side === 0 && !u.machine)!;
  const theirs = s.units.find((u) => u.side === 1 && !u.machine)!;
  assert.equal(canShootWalls(s, mine), true);
  assert.equal(canShootWalls(s, theirs), false, "only attackers breach walls");
  s.active = mine.id;
  const before = s.log.length;
  assert.throws(() => applyAction(s, { type: "catapult", unit: mine.id, target: "gate" }), /wall segments/, "Cyclopes throw only at walls");
  applyAction(s, { type: "catapult", unit: mine.id, target: "upperWall" });
  assert.equal(logTexts(s).slice(before).filter((l) => /Cyclop|C95/.test(l) && /gate|wall|tower|keep/.test(l)).length, 2, "two stones");
  s.active = theirs.id;
  assert.throws(() => applyAction(s, { type: "catapult", unit: theirs.id, target: "upperWall" }));
});

test("siege: a missed stone lands on the nearest wall; the catapult aims by itself as HotA's", () => {
  const table = [...TABLE];
  table[145] = creature(145, { key: "catapult", hp: 1000, speed: 0, abilities: [{ type: "DOUBLE_WIDE" }, { type: "SHOOTER" }], shots: 24 });
  table[149] = creature(149, { key: "arrowTower", hp: 1000, speed: 0, abilities: [{ type: "SHOOTER" }], shots: 99 });
  const make = (seed: number) =>
    createBattle(
      { seed, siege: { faction: "castle", level: 3, structures: 10 }, sides: [{ name: "A", controller: "ai", stacks: [{ creature: 0, count: 30 }], hero: { name: "H", heroClass: 0, female: false, owner: 0, primary: [1, 1, 1, 1], machines: [3], skills: [] } }, { name: "B", controller: "ai", stacks: [{ creature: 0, count: 10 }] }] },
      table,
    );
  const s = make(1);
  const first = () => 0;
  // The fixed redirections (heroes.thelazy.net, Fortifications / Targeting).
  assert.equal(missedShotLands(s, "upperWall", first), "overGate");
  assert.equal(missedShotLands(s, "overGate", first), "upperWall");
  assert.equal(missedShotLands(s, "belowGate", first), "bottomWall");
  assert.equal(missedShotLands(s, "keep", first), "bottomWall");
  assert.equal(missedShotLands(s, "upperTower", first), "upperWall");
  assert.deepEqual([missedShotLands(s, "gate", () => 0), missedShotLands(s, "gate", () => 1)].sort(), ["belowGate", "overGate"]);
  s.siege!.walls.bottomWall = 0;
  assert.equal(missedShotLands(s, "keep", first), "belowGate", "the next nearest when that one is down");
  for (const p of ["upperWall", "overGate", "belowGate"] as const) s.siege!.walls[p] = 0;
  assert.equal(missedShotLands(s, "keep", first), "keep", "no wall left: it hits what it was aimed at");
  // Automatic aim: without Ballistics the weakest wall, then the gate and the towers; with it the
  // gate first, the walls while all four stand, then the keep.
  const t = make(2);
  t.siege!.walls.belowGate = 1;
  assert.equal(autoCatapultTarget(t, 0, false, first), "belowGate");
  assert.equal(autoCatapultTarget(t, 1, false, first), "gate");
  t.siege!.walls.gate = 0;
  assert.equal(autoCatapultTarget(t, 1, false, first), "belowGate");
  t.siege!.walls.belowGate = 0;
  assert.equal(autoCatapultTarget(t, 1, false, first), "keep");
  for (const p of ["upperWall", "overGate", "bottomWall"] as const) t.siege!.walls[p] = 0;
  assert.equal(autoCatapultTarget(t, 0, false, first), "keep");
  assert.equal(autoCatapultTarget(t, 0, true, first), null, "Cyclopes only throw at walls");
  // Every stone hits something: a whole siege's stones never "miss".
  const u = make(3);
  startBattle(u);
  const events = runAi(u);
  const stones = events.filter((e) => e.e === "catapult");
  assert.ok(stones.length > 0);
  for (const e of stones) assert.ok(e.e === "catapult" && e.part);
});

test("siege: the moat stops and hurts defenders too, and hurts again each turn ended in it", () => {
  const table = [...TABLE];
  table[149] = creature(149, { key: "arrowTower", hp: 1000, speed: 0, abilities: [{ type: "SHOOTER" }], shots: 99 });
  const s = createBattle(
    { seed: 4, siege: { faction: "castle", level: 2, structures: 0 }, sides: [{ name: "A", controller: "human", stacks: [{ creature: 0, count: 30 }] }, { name: "B", controller: "human", stacks: [{ creature: 0, count: 30 }] }] },
    table,
  );
  const d = s.units.find((u) => u.side === 1 && !u.machine)!;
  d.pos = 95;
  s.units.filter((u) => u.machine === "tower").forEach((t) => (t.count = 0));
  s.active = d.id;
  const ev = applyAction(s, { type: "move", unit: d.id, to: 77 });
  assert.equal(ev.filter((e) => e.e === "moat").length, 1, "a defender wading out takes the moat's damage, once");
  // Its next turn begins in the moat: no harm yet (heroes.thelazy.net Moat: a turn ended in it hurts).
  const later: BattleEvent[] = [];
  for (let i = 0; i < 6 && s.active !== d.id; i++) later.push(...applyAction(s, { type: "defend", unit: s.active! }));
  assert.equal(s.active, d.id);
  assert.ok(!later.some((e) => e.e === "moat" && e.unit === d.id), "a turn begun in the moat doesn't hurt by itself");
  const out = structuredClone(s);
  assert.ok(applyAction(s, { type: "defend", unit: d.id }).some((e) => e.e === "moat" && e.unit === d.id), "a turn ended in the moat hurts");
  assert.ok(!applyAction(out, { type: "move", unit: d.id, to: 96 }).some((e) => e.e === "moat"), "climbing out of it doesn't");
});

test("First Aid: the player aims the tent, the army gets more health; machines lose at most 40% per blow", () => {
  const table = [...TABLE];
  table[147] = creature(147, { key: "firstAidTent", hp: 75, speed: 0, abilities: [{ type: "DOUBLE_WIDE" }] });
  const firstAid = SKILLS.indexOf("firstAid");
  const hero = { name: "H", heroClass: 0, female: false, owner: 0, primary: [1, 1, 1, 1] as [number, number, number, number], machines: [6], skills: [[firstAid, 3]] as [number, number][] };
  const s = createBattle(
    {
      seed: 3,
      field: "grass_hills",
      sides: [
        { name: "A", controller: "human", stacks: [{ creature: 1, count: 5 }], hero },
        { name: "B", controller: "human", stacks: [{ creature: 0, count: 5 }] },
      ],
    },
    table,
  );
  startBattle(s);
  const mine = s.units.find((u) => u.side === 0 && !u.machine)!;
  const tent = s.units.find((u) => u.machine === "tent")!;
  assert.equal(hpOf(s, mine), Math.floor(TABLE[1].hp * 1.15), "expert First Aid: +15% health");
  assert.equal(mine.firstHp, hpOf(s, mine), "stacks start at full (bonus) health");
  // The preview counts the bonus health and the 40% cap as the blow itself does.
  mine.firstHp = 5;
  const big = hpOf(s, mine) * 2 + 5;
  assert.equal(killedBy(s, mine, 4), 0, "less than the top creature's health kills none");
  assert.equal(killedBy(s, mine, big), Math.min(mine.count, 3));
  const expected = killedBy(s, mine, big);
  assert.equal(takeDamage(s, mine, big), expected, "the blow kills what the preview said");
  assert.equal(killedBy(s, tent, 1000), 0, "a machine loses at most 40% to one blow");
  takeDamage(s, tent, 1000);
  assert.equal(tent.count, 1, "a machine loses at most 40% to one blow");
  mine.firstHp = 1;
  // Play until the tent is up: it waits for its owner, who picks the stack.
  for (let i = 0; i < 20 && s.units[s.active!] !== tent; i++) {
    const u = s.units[s.active!];
    applyAction(s, { type: "defend", unit: u.id });
  }
  assert.equal(s.units[s.active!], tent, "the tent waits for orders");
  const before = mine.firstHp;
  applyAction(s, { type: "heal", unit: tent.id, target: mine.id });
  assert.ok(mine.firstHp > before, "healed");
});

test("siege moats: Tower's is hidden land mines (gone once set off); attackers in a moat lose 3 Defense", () => {
  const table = [...TABLE];
  table[149] = creature(149, { key: "arrowTower", hp: 1000, speed: 0, abilities: [{ type: "SHOOTER" }], shots: 99 });
  const make = (faction: string) =>
    createBattle({ seed: 2, siege: { faction, level: 2, structures: 10 }, sides: [{ name: "A", controller: "human", stacks: [{ creature: 0, count: 50 }] }, { name: "B", controller: "human", stacks: [{ creature: 0, count: 5 }] }] }, table);
  const tower = make("tower");
  assert.equal(tower.siege!.moat, null);
  assert.equal(tower.hazards!.filter((z) => z.kind === "mine" && z.side === 1).length, 10);
  // 10 x Power + 25 (none or Basic Fire Magic) / 50 / 100, at least 150; Sorcery and the Orb of Tempestuous Fire add.
  const mines = (primary: [number, number, number, number], skills: [number, number][] = [], bonuses: { type: string; subtype?: string; val: number }[] = []) =>
    createBattle(
      { seed: 2, siege: { faction: "tower", level: 2, structures: 10 }, sides: [{ name: "A", controller: "human", stacks: [{ creature: 0, count: 50 }] }, { name: "B", controller: "human", stacks: [{ creature: 0, count: 5 }], hero: { name: "H", heroClass: 0, female: false, owner: 1, primary, skills, bonuses } }] },
      table,
    ).hazards![0].damage;
  const fire = SKILLS.indexOf("fireMagic");
  assert.equal(mines([0, 0, 12, 1]), 150);
  assert.equal(mines([0, 0, 13, 1]), 155);
  assert.equal(mines([0, 0, 13, 1], [[fire, 1]]), 155);
  assert.equal(mines([0, 0, 10, 1], [[fire, 2]]), 150);
  assert.equal(mines([0, 0, 6, 1], [[fire, 3]]), 160);
  assert.equal(mines([0, 0, 1, 1], [], [{ type: "SPELL_DAMAGE", subtype: "fire", val: 50 }]), 225);
  assert.equal(mines([0, 0, 1, 1], [[SKILLS.indexOf("sorcery"), 3]]), 195);
  const castle = make("castle");
  const u = castle.units.find((x) => x.side === 0 && !x.machine)!;
  const dry = defenseOf(castle, u);
  u.pos = castle.siege!.moat!.hexes[0];
  assert.equal(defenseOf(castle, u), Math.max(0, dry - 3));
});

test("arrow towers (HotA): their 10 Attack and the defending hero's add, the target's Defense doesn't; Armorer takes off", () => {
  const table = [...TABLE];
  table[149] = creature(149, { key: "arrowTower", hp: 100, speed: 0, attack: 10, abilities: [{ type: "SHOOTER" }, { type: "ENEMY_DEFENCE_REDUCTION", val: 100 }, { type: "NO_DISTANCE_PENALTY" }, { type: "NO_WALL_PENALTY" }], shots: 99 });
  const hero = (owner: number, attack: number, skills: [number, number][] = []) => ({ name: `H${owner}`, heroClass: 0, female: false, owner, primary: [attack, 0, 1, 1] as [number, number, number, number], skills });
  const keepHits = (defAttack: number, armorer = 0) => {
    const s = createBattle(
      {
        seed: 1,
        siege: { faction: "castle", level: 2, structures: 0 },
        sides: [
          { name: "A", controller: "human", stacks: [{ creature: 0, count: 10 }], hero: hero(0, 0, armorer ? [[SKILLS.indexOf("armorer"), armorer]] : []) },
          { name: "B", controller: "human", stacks: [{ creature: 0, count: 5 }], hero: hero(1, defAttack) },
        ],
      },
      table,
    );
    const keep = s.units.find((u) => u.machine === "tower")!;
    return expectedDamage(s, keep, s.units.find((u) => u.side === 0 && !u.machine)!, true);
  };
  assert.deepEqual(keepHits(0), { min: 15, max: 30 }, "10-20 x (1 + 0.05 x 10)");
  assert.deepEqual(keepHits(10), { min: 20, max: 40 }, "the hero's Attack counts");
  assert.ok(keepHits(10, 3).max < 40, "Armorer cuts it");
});

test("surrender costs half the surviving troops' gold, 60% less with expert Diplomacy, never over 90% off", () => {
  const table = [...TABLE];
  const hero = (dip: number) => ({ name: "H", heroClass: 0, female: false, owner: 0, primary: [1, 1, 1, 1] as [number, number, number, number], skills: dip ? ([[SKILLS.indexOf("diplomacy"), dip]] as [number, number][]) : [] });
  const make = (dip: number, bonuses: { type: string; val: number }[] = []) =>
    createBattle({ seed: 1, field: "grass_hills", sides: [{ name: "A", controller: "human", stacks: [{ creature: 1, count: 100 }], hero: { ...hero(dip), bonuses } }, { name: "B", controller: "human", stacks: [{ creature: 0, count: 5 }], hero: { ...hero(0), owner: 1 } }] }, table);
  const full = surrenderCost(make(0), 0);
  assert.equal(full, (100 * (TABLE[1].cost?.[6] ?? 0)) / 2, "half the recruitment cost (heroes.thelazy.net)");
  assert.equal(surrenderCost(make(3), 0), Math.floor(full * 0.4));
  // Expert Diplomacy and the three discount artifacts: 60 + 30 = 90% off.
  const three = [1, 2, 3].map(() => ({ type: "SURRENDER_DISCOUNT", val: 10 }));
  assert.equal(surrenderCost(make(3, three), 0), Math.floor(full * 0.1));
  // A fourth 10% would make it 100%: HotA stops at 90.
  assert.equal(surrenderCost(make(3, [...three, { type: "SURRENDER_DISCOUNT", val: 10 }]), 0), Math.floor(full * 0.1));
});

test("retreat and surrender: who may, when (heroes.thelazy.net, Combat#Retreat; the Diplomat's Cloak)", () => {
  const hero = (owner: number, over: object = {}) => ({ name: `H${owner}`, heroClass: 0, female: false, owner, primary: [1, 1, 1, 1] as [number, number, number, number], ...over });
  const make = (a: object | null, b: object | null, town?: { escape?: boolean }) => {
    const s = createBattle(
      { seed: 1, field: "grass_hills", town, sides: [{ name: "A", controller: "human", stacks: [{ creature: 0, count: 10 }], hero: a ? hero(0, a) : undefined }, { name: "B", controller: "human", stacks: [{ creature: 0, count: 10 }], hero: b ? hero(1, b) : undefined }] },
      [...TABLE],
    );
    startBattle(s);
    return s;
  };
  const shackles = { bonuses: [{ type: "BATTLE_NO_FLEEING" }] };
  // Between heroes: both may go; the Shackles of War (on either hero) hold everyone.
  assert.equal(fleeBlock(make({}, {}), 0, false), null);
  assert.equal(fleeBlock(make({}, {}), 1, true), null);
  assert.equal(fleeBlock(make({}, shackles), 0, false), "shackles");
  assert.equal(fleeBlock(make(shackles, {}), 1, true), "shackles");
  // Against monsters: retreat, but no surrender (and in HotA the Shackles do nothing there); the Cloak may surrender.
  assert.equal(fleeBlock(make(shackles, null), 0, false), null);
  assert.equal(fleeBlock(make({}, null), 0, true), "noEnemyHero");
  assert.equal(fleeBlock(make({ diplomat: true }, null), 0, true), null);
  assert.equal(fleeBlock(make(null, {}), 0, false), "noHero");
  // Defending a town (walled or not): neither; the Escape Tunnel retreats only; the Cloak both.
  assert.equal(fleeBlock(make({}, {}, {}), 1, false), "town");
  assert.equal(fleeBlock(make({}, {}, {}), 1, true), "town");
  assert.equal(fleeBlock(make({}, {}, { escape: true }), 1, false), null);
  assert.equal(fleeBlock(make({}, {}, { escape: true }), 1, true), "town");
  assert.equal(fleeBlock(make({}, { diplomat: true }, {}), 1, true), null);
  assert.equal(fleeBlock(make({}, {}, {}), 0, false), null, "the attacker may still leave");
  // HotA's Hit & Run ban: the attacker cast a spell in the first round of a fight between heroes.
  const s = make({}, {});
  s.cast = [true, false];
  assert.equal(fleeBlock(s, 0, false), "hitAndRun");
  assert.equal(fleeBlock(s, 0, true), "hitAndRun");
  assert.equal(fleeBlock(s, 1, false), null, "not the defender");
  s.round = 2;
  s.cast = [false, false];
  assert.equal(fleeBlock(s, 0, false), null, "from the second round on");
  const cloak = make({ diplomat: true }, {});
  cloak.cast = [true, false];
  assert.equal(fleeBlock(cloak, 0, true), null, "the Cloak lifts the ban");
  // A blocked retreat is refused; an allowed surrender records its price.
  const town = make({}, {}, {});
  town.active = town.units.find((u) => u.side === 1)!.id;
  assert.throws(() => applyAction(town, { type: "retreat", unit: town.active!, surrender: false }), /defending a town/);
  const ok = make({}, {});
  ok.active = ok.units.find((u) => u.side === 0)!.id;
  applyAction(ok, { type: "retreat", unit: ok.active, surrender: true });
  assert.deepEqual(ok.fled, { side: 0, surrender: true, cost: surrenderCost(ok, 0) });
  assert.equal(ok.winner, 1);
});

test("retreat during the tactics phase (heroes.thelazy.net, Combat#Tactics Phase)", () => {
  const hero = (owner: number, tactics: number) => ({ name: `H${owner}`, heroClass: 0, female: false, owner, primary: [1, 1, 1, 1] as [number, number, number, number], skills: tactics ? ([[SKILLS.indexOf("tactics"), tactics]] as [number, number][]) : [] });
  const s = createBattle({ seed: 1, field: "grass_hills", sides: [{ name: "A", controller: "human", stacks: [{ creature: 0, count: 10 }], hero: hero(0, 3) }, { name: "B", controller: "human", stacks: [{ creature: 0, count: 10 }], hero: hero(1, 0) }] }, [...TABLE]);
  startBattle(s);
  assert.equal(s.tactics?.side, 0);
  const theirs = s.units.find((u) => u.side === 1)!;
  assert.throws(() => applyAction(s, { type: "retreat", unit: theirs.id, surrender: false }), /tactics/);
  applyAction(s, { type: "retreat", unit: s.units.find((u) => u.side === 0)!.id, surrender: false });
  assert.equal(s.winner, 1);
  assert.equal(s.tactics, undefined);
});

test("battle experience: the killed enemies' health, 500 for a beaten hero or a taken town, none for fleeing", () => {
  const hero = (owner: number) => ({ name: `H${owner}`, heroClass: 0, female: false, owner, primary: [1, 1, 1, 1] as [number, number, number, number] });
  const make = (heroes: [boolean, boolean], town?: object) => {
    const s = createBattle({ seed: 1, field: "grass_hills", town, sides: [{ name: "A", controller: "human", stacks: [{ creature: 0, count: 10 }], hero: heroes[0] ? hero(0) : undefined }, { name: "B", controller: "human", stacks: [{ creature: 0, count: 10 }, { creature: 2, count: 5 }], hero: heroes[1] ? hero(1) : undefined }] }, [...TABLE]);
    startBattle(s);
    return s;
  };
  // Every enemy killed (10 HP each), a clone not counted.
  const won = make([true, true]);
  for (const u of won.units.filter((x) => x.side === 1)) u.count = 0;
  won.units.push({ ...won.units.find((x) => x.side === 1)!, id: won.units.length, initialCount: 7, count: 0, clone: true });
  won.winner = 0;
  assert.equal(battleExperience(won, 0), 15 * 10 + 500);
  // Monsters: no 500; a town's garrison: 500 for taking the town.
  const monsters = make([true, false]);
  for (const u of monsters.units.filter((x) => x.side === 1)) u.count = 0;
  monsters.winner = 0;
  assert.equal(battleExperience(monsters, 0), 150);
  const town = make([true, false], {});
  for (const u of town.units.filter((x) => x.side === 1)) u.count = 0;
  town.winner = 0;
  assert.equal(battleExperience(town, 0), 150 + 500);
  // The defender fled after losing 4: the winner gets those 40, no 500; the one who fled nothing.
  const fled = make([true, true]);
  fled.units.find((x) => x.side === 1)!.count = 6;
  fled.units.find((x) => x.side === 0)!.count = 5;
  fled.active = fled.units.find((x) => x.side === 1)!.id;
  applyAction(fled, { type: "retreat", unit: fled.active, surrender: false });
  assert.equal(battleExperience(fled, 0), 40);
  assert.equal(battleExperience(fled, 1), 0);
});

test("skill specialists: Diplomacy and First Aid work 5% better per hero level", () => {
  const table = [...TABLE];
  const base = { name: "H", heroClass: 0, female: false, owner: 0, primary: [1, 1, 1, 1] as [number, number, number, number] };
  const make = (hero: object) =>
    createBattle({ seed: 1, field: "grass_hills", sides: [{ name: "A", controller: "human", stacks: [{ creature: 1, count: 10 }], hero: { ...base, ...hero } }, { name: "B", controller: "human", stacks: [{ creature: 0, count: 5 }] }] }, table);
  const full = surrenderCost(make({}), 0);
  // Hero 182 is a Diplomacy specialist: at level 10, expert Diplomacy's 60% becomes 90%.
  assert.equal(surrenderCost(make({ type: 182, level: 10, skills: [[SKILLS.indexOf("diplomacy"), 3]] }), 0), Math.floor((full * 10) / 100));
  // Hero 8 (Rion) is a First Aid specialist: expert First Aid's +15% health becomes +22.5% at level 10.
  // (The tent gives it: on the field, or left outside a creature bank's fight.)
  const s = make({ type: 8, level: 10, skills: [[SKILLS.indexOf("firstAid"), 3]], machines: [6] });
  const mine = s.units.find((u) => u.side === 0 && !u.machine)!;
  assert.equal(hpOf(s, mine), TABLE[1].hp + Math.floor((TABLE[1].hp * 5 * 3 * 1.5) / 100));
  const away = make({ type: 8, level: 10, skills: [[SKILLS.indexOf("firstAid"), 3]], machinesAway: [6] });
  assert.equal(hpOf(away, away.units.find((u) => u.side === 0 && !u.machine)!), hpOf(s, mine));
  const none = make({ type: 8, level: 10, skills: [[SKILLS.indexOf("firstAid"), 3]] });
  assert.equal(hpOf(none, none.units.find((u) => u.side === 0 && !u.machine)!), TABLE[1].hp, "no tent, no extra health");
  // The Ammo Cart left outside a bank's fight still keeps the shooters supplied.
  assert.equal(suppliedByCart(none, 0), false);
  const carted = make({ machinesAway: [5] });
  assert.equal(suppliedByCart(carted, 0), true);
});

test("Hydras hit every enemy around them; Cerberi the target and its two neighbours on their side", () => {
  const table = [creature(0, { speed: 1 }), creature(1, { speed: 9, abilities: [{ type: "ATTACKS_ALL_ADJACENT" }, { type: "BLOCKS_RETALIATION" }] }), creature(2, { speed: 9, abilities: [{ type: "THREE_HEADED_ATTACK" }] })];
  // A Hydra at (5,4) with enemies in front, above-right and below-left, and one two hexes away.
  const s = arena(table, [
    { creature: 1, count: 5, side: 0, pos: hexAt(5, 4) },
    { creature: 0, count: 10, side: 1, pos: hexAt(6, 4) },
    { creature: 0, count: 10, side: 1, pos: hexAt(4, 4) },
    { creature: 0, count: 10, side: 1, pos: hexAt(9, 4) },
  ]);
  const events = applyAction(s, { type: "attack", unit: 0, target: 1, from: hexAt(5, 4) });
  const hit = events.filter((e) => e.e === "attack" && e.unit === 0).map((e) => (e as { target: number }).target);
  assert.deepEqual(hit.sort(), [1, 2], "both neighbours, not the far one");
  assert.ok(!events.some((e) => e.e === "attack" && e.unit !== 0), "nobody strikes back");
  // A Cerberus at (5,4) strikes (6,4); stacks at (6,3)/(5,3) side hexes get bitten too, (8,4) doesn't.
  const c = arena(table, [
    { creature: 2, count: 5, side: 0, pos: hexAt(5, 4) },
    { creature: 0, count: 10, side: 1, pos: hexAt(6, 4) },
    { creature: 0, count: 10, side: 1, pos: hexAt(5, 3) },
    { creature: 0, count: 10, side: 1, pos: hexAt(8, 4) },
  ]);
  const bites = applyAction(c, { type: "attack", unit: 0, target: 1, from: hexAt(5, 4) })
    .filter((e) => e.e === "attack" && e.unit === 0)
    .map((e) => (e as { target: number }).target);
  assert.ok(bites.includes(1) && !bites.includes(3), `bit ${bites}`);
});

test("native terrain: +1 Attack, Defense and Speed for the creatures at home (HotA: Conflux on highlands)", () => {
  const table = [creature(0, { faction: "fortress", speed: 5 }), creature(1, { faction: "conflux", speed: 5 })];
  const s = arena(table, [
    { creature: 0, count: 5, side: 0, pos: hexAt(2, 4) },
    { creature: 1, count: 5, side: 1, pos: hexAt(12, 4) },
  ]);
  s.terrain = "swamp";
  assert.equal(speedOf(s, s.units[0]), 6);
  assert.equal(speedOf(s, s.units[1]), 5);
  assert.equal(attackOf(s, s.units[0]) - attackOf(s, s.units[1]), 1);
  assert.equal(defenseOf(s, s.units[0]) - defenseOf(s, s.units[1]), 1);
  s.terrain = "highlands";
  assert.equal(speedOf(s, s.units[1]), 6);
});

test("Harpies fly back to where they started after striking", () => {
  const table = [creature(0, { speed: 1 }), creature(1, { speed: 9, abilities: [{ type: "FLYING" }, { type: "RETURN_AFTER_STRIKE" }] })];
  const s = arena(table, [
    { creature: 1, count: 5, side: 0, pos: hexAt(2, 4) },
    { creature: 0, count: 10, side: 1, pos: hexAt(6, 4) },
  ]);
  applyAction(s, { type: "attack", unit: 0, target: 1, from: hexAt(5, 4) });
  assert.equal(s.units[0].pos, hexAt(2, 4));
});

test("Harpies bound by the Dendroids' strike back stay beside them (HotA; the original flew them home bound for good)", () => {
  const table = [creature(0, { speed: 1, abilities: [{ type: "SPELL_AFTER_ATTACK", subtype: "bind", val: 100 }] }), creature(1, { speed: 9, abilities: [{ type: "FLYING" }, { type: "RETURN_AFTER_STRIKE" }] })];
  const s = arena(table, [
    { creature: 1, count: 5, side: 0, pos: hexAt(2, 4) },
    { creature: 0, count: 10, side: 1, pos: hexAt(6, 4) },
  ]);
  applyAction(s, { type: "attack", unit: 0, target: 1, from: hexAt(5, 4) });
  assert.ok(s.units[0].effects?.some((e) => e.spell === 72), "bound by the strike back");
  assert.equal(s.units[0].pos, hexAt(5, 4), "held where it struck");
});

test("Vial of Dragon Blood: +5 Attack and Defense for dragons only", () => {
  const table = [creature(0), creature(1, { abilities: [{ type: "DRAGON_NATURE" }] })];
  const vial = [
    { type: "PRIMARY_SKILL", subtype: "attack", val: 5, artifact: 127, creatures: "DRAGON_NATURE" },
    { type: "PRIMARY_SKILL", subtype: "defence", val: 5, artifact: 127, creatures: "DRAGON_NATURE" },
  ];
  const s = createBattle(
    {
      seed: 1,
      field: "grass_hills",
      sides: [
        { name: "A", controller: "ai", stacks: [{ creature: 0, count: 1 }, { creature: 1, count: 1 }], hero: { name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 0, 0], bonuses: vial } },
        { name: "B", controller: "ai", stacks: [{ creature: 0, count: 1 }] },
      ],
    },
    table,
  );
  const [plain, dragon] = s.units;
  // The same creature otherwise (native terrain and all): the dragon has 5 more of each.
  assert.equal(attackOf(s, dragon) - attackOf(s, plain), 5);
  assert.equal(defenseOf(s, dragon) - defenseOf(s, plain), 5);
});

test("Lightning Rod: every enemy stack struck as the battle opens, Chain Lightning immunity spares", () => {
  const table = [creature(0, { hp: 10 }), creature(1, { hp: 10, abilities: [{ type: "LEVEL_SPELL_IMMUNITY", val: 5 }] })];
  const s = createBattle(
    {
      seed: 1,
      field: "grass_hills",
      sides: [
        { name: "A", controller: "ai", lightningRod: 100, stacks: [{ creature: 0, count: 50 }], hero: { name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 3, 0] } },
        { name: "B", controller: "ai", stacks: [{ creature: 0, count: 50 }, { creature: 1, count: 50 }] },
      ],
    },
    table,
  );
  startBattle(s);
  const [mine, plain, immune] = s.units;
  assert.equal(mine.count, 50);
  // 100 damage: 10 of the 10-hp creatures fall.
  assert.equal(plain.count, 40);
  assert.equal(immune.count, 50);
});

test("Lightning Rod: strikes as its owner first acts, so faster enemies move before it (HotA)", () => {
  const table = [creature(0, { hp: 10, speed: 3 }), creature(1, { hp: 10, speed: 9 })];
  const s = createBattle(
    {
      seed: 1,
      field: "grass_hills",
      sides: [
        { name: "A", controller: "ai", lightningRod: 100, stacks: [{ creature: 0, count: 50 }], hero: { name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 3, 0] } },
        { name: "B", controller: "ai", stacks: [{ creature: 1, count: 50 }] },
      ],
    },
    table,
  );
  startBattle(s);
  const [, fast] = s.units;
  assert.equal(s.active, fast.id);
  assert.equal(fast.count, 50, "not yet struck: the enemy's fast stack acts first");
  applyAction(s, { type: "defend", unit: fast.id });
  assert.equal(fast.count, 40, "struck as the owner's stack gets its turn");
});

test("Lodestar: any ground is native to Cove creatures", () => {
  const table = [creature(0, { faction: "cove", speed: 5 })];
  const s = createBattle({ seed: 1, field: "grass_hills", sides: [{ name: "A", controller: "ai", stacks: [{ creature: 0, count: 1 }] }, { name: "B", controller: "ai", stacks: [{ creature: 0, count: 1 }] }] }, table);
  const before = speedOf(s, s.units[0]);
  s.lodestar = true;
  assert.equal(speedOf(s, s.units[0]), before + 1);
});

test("the combat log speaks the original's lines (GENRLTXT)", () => {
  const s = arena(TABLE, [
    { creature: 0, count: 10, side: 0, pos: hexAt(5, 5) },
    { creature: 0, count: 1, side: 1, pos: hexAt(6, 5) },
  ]);
  const [a, d] = s.units;
  assert.equal(s.active, a.id);
  // (Lines of our own in the files' place: the game's words come from the player's files, never from here.)
  const lines: Record<number, string> = { 137: "%s wait.", 120: "%s defends: +%d.", 377: "%s hit for %d.", 378: "\n%s falls." };
  const words = { gen: (id: number) => lines[id] };
  applyAction(s, { type: "wait", unit: a.id });
  assert.equal(logTexts(s, words).at(-1), "C0s wait.");
  assert.equal(logTexts(s).at(-1), "genrltxt 137: C0s", "without the files: the line's number");
  assert.equal(s.active, d.id);
  applyAction(s, { type: "defend", unit: d.id });
  assert.equal(logTexts(s, words).at(-1), "C0 defends: +1.");
  assert.equal(s.active, a.id);
  applyAction(s, { type: "attack", unit: a.id, target: d.id, from: a.pos });
  assert.ok(logTexts(s, words).some((l) => /^C0s hit for \d+\. C0 falls\.$/.test(l)), logTexts(s, words).join(" | "));
  // Language-neutral: every entry names its line and its creatures by id, and the game files' words replace ours.
  assert.ok(s.log.every((e) => typeof e === "object"), JSON.stringify(s.log));
  const blow = s.log.find((e) => typeof e === "object" && e.t === 377)!;
  assert.deepEqual(blow, { t: 377, a: [{ cr: 0, n: 10 }, (blow as { a: number[] }).a[1]], then: [{ t: 378, a: [{ cr: 0, n: 1 }] }] });
  const other: Record<number, string> = { 377: "Die %s machen %d Schaden.", 378: "\nEin %s stirbt." };
  assert.match(logText(s, blow, { gen: (id) => other[id] }), /^Die C0s machen \d+ Schaden\. Ein C0 stirbt\.$/);
});

test("magic grounds: Holy Ground / Evil Fog morale, Clover Field and Fields of Glory luck, Cursed Ground, Magic Plains, Cracked Ice, Dunes", async () => {
  const { magicBlocked, magicBlock, mastery, defenseOf } = await import("../src/index.ts");
  const table = [...TABLE, creature(4, { faction: "inferno" }), creature(5, { faction: "stronghold" }), creature(6, { faction: "neutral" })];
  const on = (field: string, a: number, b = 0) => {
    const s = createBattle({ seed: 4, field, sides: [
      { name: "A", controller: "human", stacks: [{ creature: a, count: 5 }] },
      { name: "B", controller: "human", stacks: [{ creature: b, count: 5 }] },
    ] }, table);
    return { s, u: s.units[0] };
  };
  // Castle (good) alone: +1 for one town.
  assert.equal(moraleOf(on("holy_ground", 0).s, on("holy_ground", 0).u), 2);
  assert.equal(moraleOf(on("evil_fog", 0).s, on("evil_fog", 0).u), 0);
  let x = on("evil_fog", 4);
  assert.equal(moraleOf(x.s, x.u), 2, "evil +1");
  x = on("holy_ground", 5);
  assert.equal(moraleOf(x.s, x.u), 1, "neutral towns untouched");
  x = on("clover_field", 5);
  assert.equal(luckOf(x.s, x.u), 2, "neutral towns +2");
  x = on("clover_field", 6);
  assert.equal(luckOf(x.s, x.u), 0, "creatures of no town get nothing");
  x = on("fields_of_glory", 0);
  assert.equal(luckOf(x.s, x.u), -2);
  x = on("cursed_ground", 0);
  assert.equal(moraleOf(x.s, x.u), 0, "no good morale");
  x.s.sides[0].luck = -2;
  assert.equal(luckOf(x.s, x.u), 0, "HotA: no bad luck either");
  const sp = (level: number, schools: string[]) => ({ id: 1, key: "k", name: "k", level, schools, cost: [5, 5, 5, 5], power: 1, effect: [1, 1, 1, 1], chance: [], text: [] }) as unknown as SpellInfo;
  assert.equal(magicBlocked(x.s, sp(1, ["fire"])), false);
  assert.equal(magicBlocked(x.s, sp(2, ["fire"])), true, "nothing above level 1");
  assert.deepEqual(magicBlock(x.s, sp(2, ["fire"])), { by: "cursedGround" }, "the spellbook names the ground");
  // An Anti-magic Garrison's battle: nothing at all, but the Faerie Dragons cast.
  const g = on("grass", 0).s;
  g.noMagic = true;
  assert.deepEqual(magicBlock(g, sp(1, ["fire"])), { by: "garrison" });
  assert.equal(magicBlocked(g, sp(1, ["fire"]), true), false, "Faerie Dragons still cast");
  // An artifact on either side: the spellbook names it (Recanter's Cloak, the Orb of Inhibition, the Cape of Silence).
  const worn = (bonus: { type: string; val?: number }, artifact: number) => {
    const y = on("grass", 0);
    y.s.sides[1].hero = { name: "B", heroClass: 0, female: false, owner: 1, primary: [1, 1, 1, 1], bonuses: [{ ...bonus, artifact }] } as never;
    return y.s;
  };
  assert.deepEqual(magicBlock(worn({ type: "BLOCK_MAGIC_ABOVE", val: 2 }, 83), sp(3, ["fire"])), { by: "artifact", type: "BLOCK_MAGIC_ABOVE", artifact: 83 });
  assert.equal(magicBlock(worn({ type: "BLOCK_MAGIC_ABOVE", val: 2 }, 83), sp(2, ["fire"])), null);
  assert.deepEqual(magicBlock(worn({ type: "BLOCK_ALL_MAGIC" }, 126), sp(1, ["fire"])), { by: "artifact", type: "BLOCK_ALL_MAGIC", artifact: 126 });
  // (The Cape's "level 1-2 spells": below its 3.)
  assert.deepEqual(magicBlock(worn({ type: "BLOCK_MAGIC_BELOW", val: 3 }, 159), sp(2, ["fire"])), { by: "artifact", type: "BLOCK_MAGIC_BELOW", artifact: 159 });
  assert.equal(magicBlock(worn({ type: "BLOCK_MAGIC_BELOW", val: 3 }, 159), sp(3, ["fire"])), null);
  assert.equal(mastery(on("magic_plains", 0).s, 0, sp(3, ["air"])), 3);
  assert.equal(mastery(on("fiery_fields", 0).s, 0, sp(3, ["fire"])), 3);
  assert.equal(mastery(on("fiery_fields", 0).s, 0, sp(3, ["air"])), 0);
  x = on("lava", 0);
  const d = defenseOf(x.s, x.u);
  x = on("cracked_ice", 0);
  assert.equal(defenseOf(x.s, x.u), d - 5);
  x = on("dunes", 0);
  const sands = (x.s.hazards ?? []).filter((z) => z.kind === "quicksand" && z.neutral);
  assert.ok(sands.length >= 15 && sands.length <= 20, `${sands.length} hidden quicksand patches`);
  assert.ok(!sands.some((z) => x.s.units.some((u) => u.pos === z.hexes[0])), "none under a stack");
});

test("arrow towers: a defending hero with Artillery aims them; without it, or with no hero, they shoot by themselves", async () => {
  const { actsByItself } = await import("../src/index.ts");
  const table = [...TABLE];
  table[149] = creature(149, { key: "arrowTower", hp: 1000, speed: 0, abilities: [{ type: "SHOOTER" }], shots: 99 });
  const make = (skills?: [number, number][]) =>
    createBattle(
      { seed: 2, siege: { faction: "castle", level: 3, structures: 10 }, sides: [
        { name: "A", controller: "human", stacks: [{ creature: 0, count: 30 }] },
        { name: "B", controller: "human", stacks: [{ creature: 0, count: 10 }], hero: skills ? { name: "H", heroClass: 0, female: false, owner: 1, primary: [1, 1, 1, 1], skills } : undefined },
      ] },
      table,
    );
  const towers = (s: BattleState) => s.units.filter((u) => u.machine === "tower");
  for (const [skills, auto] of [[undefined, true], [[], true], [[[20, 1]], false]] as [[number, number][] | undefined, boolean][]) {
    const s = make(skills);
    assert.ok(towers(s).length >= 1);
    for (const t of towers(s)) assert.equal(actsByItself(s, t), auto, JSON.stringify(skills));
  }
});

test("the computer's hero, its fight lost, retreats (or surrenders, with the gold for it); a hero not worth keeping fights on", async () => {
  const { chooseFlight } = await import("../src/index.ts");
  const make = (level: number, gold?: number) => {
    const hero = (owner: number, lv: number) => ({ name: `H${owner}`, heroClass: 0, level: lv, female: false, owner, primary: [1, 1, 1, 1] as [number, number, number, number] });
    const s = createBattle(
      { seed: 1, field: "grass_hills", sides: [
        { name: "A", controller: "ai", stacks: [{ creature: 0, count: 2 }], hero: hero(0, level), gold },
        { name: "B", controller: "ai", stacks: [{ creature: 2, count: 50 }], hero: hero(1, 1) },
      ] },
      TABLE,
    );
    startBattle(s);
    // Our stack's turn.
    while (s.units[s.active!]?.side !== 0) applyAction(s, { type: "defend", unit: s.active! });
    return s;
  };
  assert.equal(chooseFlight(make(1), 0), null, "a level 1 hero isn't worth saving");
  assert.deepEqual(chooseFlight(make(6), 0), { type: "retreat", unit: 0, surrender: false });
  // Rich enough to surrender, it still only retreats: the original's computer never surrenders (2026-11-03).
  assert.deepEqual(chooseFlight(make(6, 100000), 0), { type: "retreat", unit: 0, surrender: false });
});

test("the battle AI fells the stack that keeps a shooter of its own from shooting", () => {
  const table = [creature(0, { speed: 9, attack: 10, minDamage: 6, maxDamage: 6 }), creature(1, { abilities: [{ type: "SHOOTER" }], shots: 10, speed: 3, minDamage: 4, maxDamage: 4 }), creature(2, { speed: 2, minDamage: 1, maxDamage: 1 })];
  const s = arena(table, [
    { creature: 0, count: 20, side: 0, pos: hexAt(4, 5) },
    { creature: 1, count: 20, side: 0, pos: hexAt(1, 5) },
    // One lone soldier beside our archers; a crowd further off.
    { creature: 2, count: 1, side: 1, pos: hexAt(2, 5) },
    { creature: 2, count: 30, side: 1, pos: hexAt(6, 5) },
  ]);
  assert.equal(s.units[s.active!].creature, 0);
  const a = chooseAction(s);
  assert.equal(a.type, "attack");
  assert.equal(a.type === "attack" && s.units[a.target].count, 1, "the archers' blocker struck first");
});

test("Lodestar: a side with Cove creatures sees the enemy's quicksand and mines (HotA)", () => {
  // (Inferno's creatures: on these grassy hills not at home, which would show them the quicksand too.)
  const table = [creature(0, { faction: "cove" }), creature(1, { faction: "inferno" })];
  const make = (lodestar: boolean, c: number) => {
    const s = createBattle({ seed: 1, field: "grass_hills", sides: [{ name: "A", controller: "ai", stacks: [{ creature: c, count: 5 }] }, { name: "B", controller: "ai", stacks: [{ creature: 1, count: 5 }] }] }, table);
    if (lodestar) s.lodestar = true;
    return s;
  };
  const sand = { kind: "quicksand", side: 1, hexes: [50] } as unknown as NonNullable<ReturnType<typeof createBattle>["hazards"]>[number];
  assert.equal(seesHazard(make(false, 0), 0, sand), false);
  assert.equal(seesHazard(make(true, 0), 0, sand), true);
  assert.equal(seesHazard(make(true, 1), 0, sand), false, "no Cove creatures: hidden still");
  assert.equal(seesHazard(make(false, 0), 1, sand), true, "its own side sees it");
});

test("Elixir of Life: +25% health and 50 points back a round, for the living only (the HotA mod's text)", () => {
  const table = [creature(0, { hp: 200 }), creature(1, { hp: 200, abilities: [{ type: "UNDEAD" }] })];
  const elixir = [
    { type: "STACK_HEALTH", val: 25, artifact: 131 },
    { type: "HP_REGENERATION", val: 50, artifact: 131 },
  ];
  const s = createBattle(
    {
      seed: 1,
      field: "grass_hills",
      sides: [
        { name: "A", controller: "ai", stacks: [{ creature: 0, count: 2 }, { creature: 1, count: 2 }], hero: { name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 0, 0], bonuses: elixir } },
        { name: "B", controller: "ai", stacks: [{ creature: 0, count: 1 }] },
      ],
    },
    table,
  );
  const [living, undead] = s.units;
  assert.equal(hpOf(s, living), 250);
  assert.equal(hpOf(s, undead), 200);
  // Hurt: back 50 a round, not to full.
  startBattle(s);
  living.firstHp = 100;
  for (let i = 0; i < 40 && s.round < 2; i++) applyAction(s, { type: "defend", unit: s.active! });
  assert.ok(s.round >= 2);
  assert.equal(living.firstHp, 150);
});

test("Defend adds what the battle line says it adds (a fifth of the Defense, at least 1)", () => {
  const s = battle([[1, 5]], [[1, 5]]);
  const u = s.units[0];
  const before = defenseOf(s, u);
  const bonus = defendBonus(s, u);
  assert.equal(bonus, Math.max(1, Math.round(before / 5)));
  u.defending = true;
  assert.equal(defenseOf(s, u), before + bonus);
});

test("siege: a wall part falls the same way to stones and Earthquake (its hex opens; a tower's archers fall with it, once)", () => {
  const table = [...TABLE];
  table[149] = creature(149, { key: "arrowTower", hp: 1000, speed: 0, abilities: [{ type: "SHOOTER" }], shots: 99 });
  const s = createBattle(
    {
      seed: 5,
      siege: { faction: "castle", level: 3, structures: 10 },
      sides: [
        { name: "A", controller: "ai", stacks: [{ creature: 0, count: 30 }] },
        { name: "B", controller: "ai", stacks: [{ creature: 0, count: 10 }] },
      ],
    },
    table,
  );
  s.siege!.walls.upperTower = 2;
  assert.deepEqual(damageWall(s, "upperTower", 1), { fallen: false });
  const fell = damageWall(s, "upperTower", 1);
  assert.ok(fell.fallen && fell.tower && fell.tower.count === 0, "the upper tower's archers fall with it");
  assert.equal(damageWall(s, "upperTower", 1).tower, undefined, "and only once");
  s.siege!.walls.upperWall = 1;
  assert.ok(s.blocked.includes(29));
  assert.equal(damageWall(s, "upperWall", 1).fallen, true);
  assert.ok(!s.blocked.includes(29), "the fallen wall's hex opens");
});

test("HotA's rule changes can be turned off: arrow towers then shoot a fixed damage, the moat spares defenders", () => {
  const table = [...TABLE];
  table[145] = creature(145, { key: "catapult", hp: 1000, speed: 0, abilities: [{ type: "DOUBLE_WIDE" }, { type: "SHOOTER" }], shots: 24 });
  table[149] = creature(149, { key: "arrowTower", hp: 1000, speed: 0, abilities: [{ type: "SHOOTER" }], shots: 99 });
  const dhero = { name: "D", heroClass: 0, female: false, owner: 1, primary: [30, 1, 1, 1] as [number, number, number, number], machines: [] as number[], skills: [] as [number, number][] };
  const make = (rules?: { towerSkills?: false }) =>
    createBattle({ seed: 5, rules, siege: { faction: "castle", level: 3, structures: 10 }, sides: [{ name: "A", controller: "ai", stacks: [{ creature: 0, count: 30 }] }, { name: "B", controller: "ai", stacks: [{ creature: 0, count: 10 }], hero: dhero }] }, table);
  const damage = (s: BattleState) => expectedDamage(s, s.units.find((u) => u.machine === "tower")!, s.units.find((u) => u.side === 0 && !u.machine)!, true);
  const hota = damage(make());
  const sod = damage(make({ towerSkills: false }));
  assert.ok(hota.max > sod.max, `the defending hero's attack adds in HotA (${hota.max} vs ${sod.max})`);
});
