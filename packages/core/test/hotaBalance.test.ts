// HotA's balance changes from the mod's gameBalance (combat settings, creatures, starting armies),
// on synthetic creature tables where the game files aren't needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type CreatureStats, HERO_INFO, SPELL, heroArmySizes, type SpellInfo, applyAction, areaShooter, areaShotTargets, createBattle, expectedDamage, hitAndRun, neighbours, parseCreatures, startBattle, totalHp } from "../src/index.ts";

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "castle", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 100, speed: 5, attack: 5, defense: 5, minDamage: 2, maxDamage: 8,
    shots: 0, abilities: [], def: "", missile: "", sound: "", ...over,
  };
}

const ARROW: SpellInfo = { id: SPELL.MAGIC_ARROW, key: "magicArrow", name: "Magic Arrow", level: 1, schools: ["air"], cost: [5, 4, 4, 4], power: 10, effect: [10, 10, 20, 30], chance: [], text: [] };
const SPELLS: SpellInfo[] = [];
SPELLS[SPELL.MAGIC_ARROW] = ARROW;

const MAGOG = creature(1, { key: "magog", shots: 10, abilities: [{ type: "SHOOTER" }, { type: "SPELL_LIKE_ATTACK", subtype: "fireballAbility" }] });
const IMMUNE = creature(2, { abilities: [{ type: "SPELL_SCHOOL_IMMUNITY", subtype: "fire" }] });
const table = [creature(0), MAGOG, IMMUNE];

function battle(enemyHero: boolean) {
  const hero = (name: string, owner: number) => ({ name, heroClass: 1, female: false, owner, primary: [0, 0, 1, 5] as [number, number, number, number], spells: [SPELL.MAGIC_ARROW], mana: 50 });
  const s = createBattle(
    {
      seed: 3,
      field: "grass",
      sides: [
        { name: "A", controller: "human", stacks: [{ creature: 1, count: 10 }, { creature: 0, count: 10 }], hero: hero("A", 0) },
        { name: "B", controller: "human", stacks: [{ creature: 0, count: 10 }, { creature: 0, count: 10 }, { creature: 2, count: 10 }], hero: enemyHero ? hero("B", 1) : undefined },
      ],
    },
    table,
    SPELLS,
  );
  startBattle(s);
  s.active = s.units.find((u) => u.side === 0)!.id;
  return s;
}

test("HotA: an attacker who casts in the first round can't retreat or surrender in it", () => {
  const s = battle(true);
  const foe = s.units.find((u) => u.side === 1)!;
  assert.equal(hitAndRun(s, 0), false);
  applyAction(s, { type: "cast", unit: s.active!, spell: SPELL.MAGIC_ARROW, target: foe.pos });
  assert.ok(hitAndRun(s, 0));
  assert.throws(() => applyAction(s, { type: "retreat", unit: s.active!, surrender: false }), /can't leave/);
  // Against a side with no hero, or in later rounds, it may go.
  const free = battle(false);
  applyAction(free, { type: "cast", unit: free.active!, spell: SPELL.MAGIC_ARROW, target: free.units.find((u) => u.side === 1)!.pos });
  assert.equal(hitAndRun(free, 0), false);
  s.round = 2;
  assert.equal(hitAndRun(s, 0), false);
});

test("HotA: Magogs aim at an empty hex and the blast hits everyone around it but the fire-immune", () => {
  const s = battle(false);
  const magog = s.units[0];
  const [a, b, immune] = s.units.filter((u) => u.side === 1);
  // Two enemy stacks with one free hex between them, an immune one beside it too.
  a.pos = 5 * 17 + 8;
  b.pos = 5 * 17 + 10;
  const gap = 5 * 17 + 9;
  immune.pos = neighbours(gap).find((h) => h !== a.pos && h !== b.pos && h > 17)!;
  s.units[1].pos = 1;
  const hit = areaShotTargets(s, magog, gap);
  assert.deepEqual(hit.map((u) => u.id).sort(), [a.id, b.id].sort());
  const [ha, hb] = [totalHp(s, a), totalHp(s, b)];
  applyAction(s, { type: "shootHex", unit: magog.id, hex: gap });
  assert.ok(totalHp(s, a) < ha && totalHp(s, b) < hb, "both took the blast");
  assert.equal(magog.shots, 9);
});

test("HotA: Liches aim at empty hexes too (the living only); nobody aims next to himself; friends are caught in the blast", () => {
  const s = battle(false);
  const lich = s.units[0];
  s.creatures[1] = { ...MAGOG, key: "lich", abilities: [{ type: "SHOOTER" }, { type: "SPELL_LIKE_ATTACK", subtype: "deathCloud" }] };
  s.creatures[2] = { ...IMMUNE, abilities: [{ type: "UNDEAD" }] };
  const [a, b, undead] = s.units.filter((u) => u.side === 1);
  const friend = s.units[1];
  const gap = 5 * 17 + 9;
  a.pos = 5 * 17 + 8;
  undead.pos = 5 * 17 + 10;
  friend.pos = neighbours(gap).find((h) => h !== a.pos && h !== undead.pos)!;
  b.pos = 1;
  assert.ok(areaShooter(s, lich));
  assert.deepEqual(areaShotTargets(s, lich, gap).map((u) => u.id).sort(), [a.id, friend.id].sort(), "the undead stack is spared, the friend is not");
  lich.pos = neighbours(gap).find((h) => !s.units.some((u) => u.pos === h))!;
  assert.deepEqual(areaShotTargets(s, lich, gap), [], "too close to aim at");
  assert.throws(() => applyAction(s, { type: "shootHex", unit: lich.id, hex: gap }), /nobody|can.t shoot/);
});

test("HotA: Forgetfulness from a specialist: more of the stack forgets", () => {
  const s = battle(false);
  const magog = s.units[0];
  const foe = s.units.find((u) => u.side === 1)!;
  const plain = expectedDamage(s, magog, foe, true);
  magog.effects = [{ spell: SPELL.FORGETFULNESS, rounds: 3, mastery: 1, value: 0 }];
  assert.equal(expectedDamage(s, magog, foe, true).max, Math.floor(plain.max / 2));
  magog.effects = [{ spell: SPELL.FORGETFULNESS, rounds: 3, mastery: 1, value: 30 }];
  assert.ok(expectedDamage(s, magog, foe, true).max <= Math.ceil(plain.max * 0.2));
});

test("HotA creature changes: Firebirds take half from fire instead of immunity; Arch Devils -2 luck; dragons to Bone Dragons", () => {
  const row = (name: string) => [name, `${name}s`, "10", "0", "0", "0", "0", "0", "0", "10", "1", "5", "5", "5", "1", "2", "0", "100", "100", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", ""];
  const rows = [["Singular"], ["x"], ...Array.from({ length: 160 }, (_, i) => row(`C${i}`))];
  const out = parseCreatures(rows);
  const firebird = out[130];
  assert.ok(!firebird.abilities.some((a) => a.type === "SPELL_SCHOOL_IMMUNITY" && a.subtype === "fire"));
  assert.ok(firebird.abilities.some((a) => a.type === "SPELL_DAMAGE_REDUCTION" && a.subtype === "fire" && a.val === 50));
  assert.ok(out[131].abilities.some((a) => a.type === "SPELL_SCHOOL_IMMUNITY" && a.subtype === "fire"), "Phoenixes stay immune");
  assert.equal(out[55].abilities.find((a) => a.type === "LUCK")?.val, -2);
  assert.ok(out[69].abilities.some((a) => a.type === "SKELETON_TRANSFORMER_TARGET" && a.subtype === "boneDragon"));
});

test("the starting armies' sizes are the player's HOTRAITS.TXT's, the creatures ours", () => {
  // (A HOTRAITS-shaped table: two heading rows, then each hero's Low / High / type per stack.)
  const rows = [[""], ["Name"], ...Array.from({ length: 156 }, (_, i) => [`H${i}`, "3", "9", "x", "2", "5", "x", "1", "2", "x"])];
  const before = HERO_INFO[0].army.map((a) => [...a]);
  heroArmySizes(rows);
  assert.deepEqual(HERO_INFO[0].army.map(([c]) => c), [0, 2, 4], "Orrin: Pikemen, Archers, Griffins");
  assert.deepEqual(HERO_INFO[0].army.map(([, lo, hi]) => [lo, hi]), [[3, 9], [2, 5], [1, 2]], "how many: the file's");
  assert.equal(HERO_INFO[86].army[0][0], 70, "Dungeon: Troglodytes");
  HERO_INFO[0].army.splice(0, 3, ...(before as [number, number, number][]));
});
