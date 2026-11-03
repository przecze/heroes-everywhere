// Air and Fire battle spells against the HotA wiki (heroes.thelazy.net) and VCMI's spell configs:
// synthetic creatures, the spells' numbers from HotA's SPTRAITS.TXT.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BattleEvent,
  type BattleState,
  type CreatureStats,
  SPELL,
  type SpellInfo,
  affects,
  affectsNoOne,
  applyAction,
  attackOf,
  castable,
  createBattle,
  defenseOf,
  expectedDamage,
  startBattle,
} from "../src/index.ts";

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "castle", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 100, speed: 5, attack: 5, defense: 5, minDamage: 2, maxDamage: 8,
    shots: 0, abilities: [], def: "", missile: "", sound: "", ...over,
  };
}

function spell(id: number, key: string, level: number, schools: SpellInfo["schools"], power: number, effect: number[]): SpellInfo {
  return { id, key, name: key, level, schools, cost: [5, 4, 4, 4], power, effect: effect as SpellInfo["effect"], chance: [], text: [] };
}

const SPELLS: SpellInfo[] = [];
for (const sp of [
  spell(SPELL.MAGIC_ARROW, "magicArrow", 1, ["earth", "water", "fire", "air"], 10, [10, 10, 20, 30]),
  spell(SPELL.LIGHTNING_BOLT, "lightningBolt", 2, ["air"], 25, [10, 10, 20, 50]),
  spell(SPELL.FIREBALL, "fireball", 3, ["fire"], 10, [15, 15, 30, 60]),
  spell(SPELL.DESTROY_UNDEAD, "destroyUndead", 3, ["air"], 10, [10, 10, 20, 50]),
  spell(SPELL.LAND_MINE, "landMine", 3, ["fire"], 10, [25, 25, 50, 100]),
  spell(SPELL.FIRE_WALL, "fireWall", 2, ["fire"], 15, [10, 10, 20, 50]),
  spell(SPELL.CHAIN_LIGHTNING, "chainLightning", 4, ["air"], 40, [25, 25, 50, 100]),
  spell(SPELL.PROT_AIR, "protectAir", 2, ["air"], 0, [50, 50, 25, 25]),
  spell(SPELL.PROT_FIRE, "protectFire", 1, ["fire"], 0, [50, 50, 25, 25]),
  spell(SPELL.FIRE_SHIELD, "fireShield", 4, ["fire"], 0, [20, 20, 25, 30]),
  spell(SPELL.MAGIC_MIRROR, "magicMirror", 5, ["air"], 0, [20, 20, 30, 40]),
  spell(SPELL.SACRIFICE, "sacrifice", 5, ["fire"], 1, [3, 3, 6, 10]),
  spell(SPELL.CURSE, "curse", 1, ["fire"], 0, [0, 0, 1, 1]),
  spell(SPELL.BLOODLUST, "bloodlust", 1, ["fire"], 0, [3, 3, 6, 6]),
  spell(SPELL.WEAKNESS, "weakness", 2, ["water"], 0, [3, 3, 6, 6]),
  spell(SPELL.FRENZY, "frenzy", 4, ["fire"], 0, [100, 100, 150, 200]),
  spell(SPELL.BERSERK, "berserk", 4, ["fire"], 0, [0, 0, 1, 2]),
  spell(SPELL.HYPNOTIZE, "hypnotize", 3, ["air"], 25, [10, 10, 20, 50]),
  spell(SPELL.FIRE_ELEMENTAL, "fireElemental", 5, ["fire"], 0, [2, 2, 2, 3]),
])
  SPELLS[sp.id] = sp;

const UNDEAD = 4;
const TABLE: CreatureStats[] = [creature(0), creature(1, { faction: "neutral" }), creature(2, { faction: "neutral", minDamage: 1, maxDamage: 3 })];
TABLE[3] = creature(3, { faction: "neutral", abilities: [{ type: "MAGIC_RESISTANCE", val: 100 }] });
TABLE[UNDEAD] = creature(UNDEAD, { faction: "necropolis", abilities: [{ type: "UNDEAD" }] });
TABLE[114] = creature(114, { key: "fireElemental", faction: "conflux", hp: 35, abilities: [{ type: "SPELL_SCHOOL_IMMUNITY", subtype: "fire" }] });

const AIR = 15;
const FIRE = 14;
const SORCERY = 25;

/** Side A (Castle troops, at home on grass) with a caster; side B as given (neutrals by default). */
function battle(spells: number[], opts: { skills?: [number, number][]; power?: number; them?: [number, number][]; us?: [number, number][]; field?: string; type?: number; level?: number; bonuses?: { type: string; subtype?: string; val?: number }[] } = {}): BattleState {
  const s = createBattle(
    {
      seed: 11,
      field: opts.field ?? "dirt_hills",
      sides: [
        {
          name: "A", controller: "human",
          stacks: (opts.us ?? [[0, 10], [0, 10]]).map(([creature, count]) => ({ creature, count })),
          hero: { name: "Mage", heroClass: 1, female: false, owner: 0, primary: [0, 0, opts.power ?? 2, 5], skills: opts.skills ?? [], spells, mana: 200, type: opts.type, level: opts.level, bonuses: opts.bonuses as never },
        },
        { name: "B", controller: "ai", stacks: (opts.them ?? [[1, 10], [1, 10]]).map(([creature, count]) => ({ creature, count })) },
      ],
    },
    TABLE,
    SPELLS,
  );
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  s.active = s.units.find((u) => u.side === 0)!.id;
  s.units.forEach((u, i) => (u.pos = [18, 52, 32, 66][i] ?? u.pos));
  return s;
}

const spellEvent = (events: BattleEvent[]) => events.find((e) => e.e === "spell") as Extract<BattleEvent, { e: "spell" }>;
const cast = (s: BattleState, spell: number, target: number, dest?: number) => applyAction(s, { type: "cast", unit: s.active!, spell, target, dest });

test("Curse: the minimum damage, one less from Advanced and never under 1 (not 80% of it)", () => {
  for (const [mastery, min] of [[0, 2], [1, 2], [2, 1], [3, 1]] as const) {
    const s = battle([SPELL.CURSE], { skills: mastery ? [[FIRE, mastery]] : [] });
    const foe = s.units[2];
    cast(s, SPELL.CURSE, foe.pos);
    const d = expectedDamage(s, foe, s.units[0], false);
    assert.equal(d.min, d.max, "always the same");
    // 10 creatures of 2-8 cursed: 2 each, 1 each from Advanced; against equal attack and defence.
    assert.equal(d.min, min * 10, `mastery ${mastery}`);
  }
  // A 1-3 creature stays at 1.
  const s = battle([SPELL.CURSE], { skills: [[FIRE, 2]], them: [[2, 10]] });
  cast(s, SPELL.CURSE, s.units[2].pos);
  assert.equal(expectedDamage(s, s.units[2], s.units[0], false).max, 10);
});

test("Bloodlust and Weakness cancel each other (VCMI's counters)", () => {
  const s = battle([SPELL.BLOODLUST]);
  const u = s.units[0];
  u.effects = [{ spell: SPELL.WEAKNESS, rounds: 3, mastery: 1, value: 3 }];
  const weak = attackOf(s, u, false);
  cast(s, SPELL.BLOODLUST, u.pos);
  assert.deepEqual(u.effects.map((e) => e.spell), [SPELL.BLOODLUST]);
  assert.equal(attackOf(s, u, false), weak + 3 + 3);
  assert.equal(attackOf(s, u, true), weak + 3, "melee only");
});

test("Frenzy: through the stack's closest turn and until its next one begins", () => {
  // Cast on the stack whose turn it is: gone as its next turn begins.
  const s = battle([SPELL.FRENZY]);
  const u = s.units[0];
  cast(s, SPELL.FRENZY, u.pos);
  assert.equal(defenseOf(s, u), 0);
  assert.equal(attackOf(s, u, false), 5 + 5);
  applyAction(s, { type: "defend", unit: u.id });
  // The other stacks act; Frenzy holds through the round's end and into the next.
  for (let i = 0; i < 12 && s.active !== u.id && s.winner === null; i++) applyAction(s, { type: "defend", unit: s.active! });
  assert.equal(s.active, u.id);
  assert.ok(!u.effects?.some((e) => e.spell === SPELL.FRENZY), "ended as its next turn began");
  // Cast on a stack yet to act: it fights frenzied, and stays so until its turn in the next round.
  const t = battle([SPELL.FRENZY], { skills: [[FIRE, 3]] });
  const other = t.units[1];
  cast(t, SPELL.FRENZY, other.pos);
  assert.equal(attackOf(t, other, false), 5 + 10, "Expert: twice the defence");
  for (let i = 0; i < 12 && t.round === 1; i++) applyAction(t, { type: "defend", unit: t.active! });
  assert.ok(other.effects?.some((e) => e.spell === SPELL.FRENZY), "still on into the next round");
  for (let i = 0; i < 12 && t.active !== other.id; i++) applyAction(t, { type: "defend", unit: t.active! });
  assert.ok(!other.effects?.some((e) => e.spell === SPELL.FRENZY));
});

test("Hypnotize: by the stack's count at full health; Magic Mirror shields from it; Berserk is resisted and never reflected", () => {
  // Power 2, basic: 25 x 2 + 10 = 60. One wounded creature of 100 is still 100.
  const s = battle([SPELL.HYPNOTIZE], { them: [[1, 1], [1, 1]] });
  const foe = s.units[2];
  foe.firstHp = 40;
  assert.equal(affects(s, SPELLS[SPELL.HYPNOTIZE], foe), false);
  const big = battle([SPELL.HYPNOTIZE], { power: 4, them: [[1, 1], [1, 1]] });
  const target = big.units[2];
  assert.equal(affects(big, SPELLS[SPELL.HYPNOTIZE], target), true);
  target.effects = [{ spell: SPELL.MAGIC_MIRROR, rounds: 3, mastery: 1, value: 100 }];
  assert.equal(affects(big, SPELLS[SPELL.HYPNOTIZE], target), false, "Magic Mirror");
  // Berserk on a stack of full magic resistance: resisted, and not bounced by a mirror.
  const b = battle([SPELL.BERSERK], { them: [[3, 10], [3, 10]] });
  b.units[2].effects = [{ spell: SPELL.MAGIC_MIRROR, rounds: 3, mastery: 1, value: 100 }];
  const ev = spellEvent(cast(b, SPELL.BERSERK, b.units[2].pos));
  assert.deepEqual(ev.resisted, [b.units[2].id]);
  assert.ok(!ev.reflected);
});

test("Protection from Air and Fire: 50% taken, 25% from Advanced; one protection only for Magic Arrow", () => {
  for (const [mastery, share] of [[1, 0.5], [2, 0.25]] as const) {
    const s = battle([SPELL.PROT_AIR, SPELL.LIGHTNING_BOLT], { skills: [[AIR, mastery]] });
    s.units[2].effects = [{ spell: SPELL.PROT_AIR, rounds: 3, mastery, value: SPELLS[SPELL.PROT_AIR].effect[mastery] }];
    const ev = spellEvent(cast(s, SPELL.LIGHTNING_BOLT, s.units[2].pos));
    assert.equal(ev.damage[0].damage, Math.floor((25 * 2 + SPELLS[SPELL.LIGHTNING_BOLT].effect[mastery]) * share));
  }
  const s = battle([SPELL.MAGIC_ARROW]);
  s.units[2].effects = [
    { spell: SPELL.PROT_AIR, rounds: 3, mastery: 1, value: 50 },
    { spell: SPELL.PROT_FIRE, rounds: 3, mastery: 1, value: 50 },
  ];
  assert.equal(spellEvent(cast(s, SPELL.MAGIC_ARROW, s.units[2].pos)).damage[0].damage, 15);
});

test("Fireball may land where it touches no one; Destroy Undead with no undead about 'will affect no one'", () => {
  const s = battle([SPELL.FIREBALL, SPELL.DESTROY_UNDEAD]);
  const before = s.sides[0].hero!.mana!;
  const ev = spellEvent(cast(s, SPELL.FIREBALL, 8 + 17 * 5));
  assert.equal(ev.damage.length, 0);
  assert.ok(s.sides[0].hero!.mana! < before);
  const t = battle([SPELL.DESTROY_UNDEAD]);
  assert.equal(affectsNoOne(t, 0, SPELLS[SPELL.DESTROY_UNDEAD]), true);
  assert.equal(castable(t, 0).length, 0);
  assert.throws(() => cast(t, SPELL.DESTROY_UNDEAD, 0), /affect no one/);
  const u = battle([SPELL.DESTROY_UNDEAD], { them: [[UNDEAD, 10]] });
  const hit = spellEvent(cast(u, SPELL.DESTROY_UNDEAD, 0));
  assert.deepEqual(hit.damage.map((d) => d.damage), [10 * 2 + 10]);
});

test("Land Mine: not against an enemy at home on its ground; such a side walks over mines unhurt", () => {
  // Castle's troops on grass: the mines can't be laid against them.
  const s = battle([SPELL.LAND_MINE], { field: "grass_hills", us: [[1, 10]], them: [[0, 10]] });
  assert.equal(affectsNoOne(s, 0, SPELLS[SPELL.LAND_MINE]), true);
  assert.throws(() => cast(s, SPELL.LAND_MINE, 0), /affect no one/);
  // Neutrals on grass: laid. Then a Castle stack joins the enemy (a native side): its troops cross them.
  const t = battle([SPELL.LAND_MINE], { field: "grass_hills", us: [[1, 10]], them: [[1, 10], [0, 10]] });
  assert.equal(affectsNoOne(t, 0, SPELLS[SPELL.LAND_MINE]), true, "one native stack is enough");
  const u = battle([SPELL.LAND_MINE], { field: "grass_hills", us: [[1, 10]], them: [[1, 10]] });
  cast(u, SPELL.LAND_MINE, 0);
  assert.equal(u.hazards?.filter((z) => z.kind === "mine").length, 4);
});

test("Fire Wall and Land Mine: Sorcery and the Orb of Tempestuous Fire make them burn harder", () => {
  const plain = battle([SPELL.FIRE_WALL]);
  cast(plain, SPELL.FIRE_WALL, 8 + 17 * 5);
  const strong = battle([SPELL.FIRE_WALL], { skills: [[SORCERY, 3]], bonuses: [{ type: "SPELL_DAMAGE", subtype: "fire", val: 50 }] });
  cast(strong, SPELL.FIRE_WALL, 8 + 17 * 5);
  const base = 15 * 2 + 10;
  assert.equal(plain.hazards![0].damage, base);
  assert.equal(strong.hazards![0].damage, Math.floor(base * 1.3 * 1.5));
});

test("Fire Shield: Sorcery and the Orb strengthen what burns back", () => {
  const burnt = (skills: [number, number][]) => {
    const s = battle([SPELL.FIRE_SHIELD], { skills, them: [[1, 100]] });
    const [ours] = s.units;
    ours.effects = [{ spell: SPELL.FIRE_SHIELD, rounds: 3, mastery: 1, value: 20 }];
    const foe = s.units[2];
    foe.pos = ours.pos + 1;
    s.active = foe.id;
    const events = applyAction(s, { type: "attack", unit: foe.id, target: ours.id, from: foe.pos });
    const hit = events.find((e) => e.e === "attack" && !e.retaliation && e.unit === foe.id) as Extract<BattleEvent, { e: "attack" }>;
    const back = events.find((e) => e.e === "attack" && e.fireShield) as Extract<BattleEvent, { e: "attack" }>;
    return { hit: hit.damage, back: back.damage };
  };
  const a = burnt([]);
  assert.equal(a.back, Math.floor(Math.min(a.hit, 1000) * 0.2));
  const b = burnt([[SORCERY, 3]]);
  assert.equal(b.back, Math.floor(Math.min(b.hit, 1000) * 0.2 * 1.3));
});

test("Sacrifice: never a summoned or hypnotised stack of ours", () => {
  const s = battle([SPELL.SACRIFICE, SPELL.FIRE_ELEMENTAL], { power: 5 });
  const [fallen] = s.units;
  fallen.count = 0;
  fallen.firstHp = 0;
  s.active = s.units[1].id;
  cast(s, SPELL.FIRE_ELEMENTAL, 0);
  const elemental = s.units.find((u) => u.summoned)!;
  s.cast = [false, false];
  assert.throws(() => cast(s, SPELL.SACRIFICE, fallen.pos, elemental.pos), /sacrifice/);
  const ours = s.units[1];
  ours.effects = [{ spell: SPELL.HYPNOTIZE, rounds: 3, mastery: 1, value: 0 }];
  s.active = elemental.id;
  assert.throws(() => cast(s, SPELL.SACRIFICE, fallen.pos, ours.pos), /sacrifice/);
});

test("Chain Lightning picks at random among the stacks as near as each other", () => {
  const seen = new Set<number>();
  for (let seed = 0; seed < 30; seed++) {
    const s = battle([SPELL.CHAIN_LIGHTNING], { them: [[1, 10], [1, 10]] });
    s.rng = seed * 7919 + 1;
    // Two enemies at the same distance from the first one struck.
    const [, , first, a] = s.units;
    first.pos = 8 + 17 * 5;
    a.pos = 8 + 17 * 3;
    s.units[1].pos = 8 + 17 * 7;
    s.units[0].pos = 1;
    const ev = spellEvent(cast(s, SPELL.CHAIN_LIGHTNING, first.pos));
    seen.add(ev.units[1]);
  }
  assert.equal(seen.size, 2, "either of the two as near");
});
