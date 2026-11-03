// HotA's alternate action (the battle bar's button or Alt; HotA changelog 1.5.0 and 1.7.0,
// heroes.thelazy.net Keybinds): shooters fight hand to hand, Harpies strike and stay, creatures with a
// power aimed at enemies, corpses or the ground move or attack instead. Each is an ordinary action.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type BattleState, type CreatureStats, alternateAction, applyAction, createBattle, creatureSpellAt, hexAt, startBattle } from "../src/index.ts";
import { Refusal } from "../src/refusal.ts";
import { SPELL, type SpellInfo } from "../src/spells.ts";

function creature(id: number, over: Partial<CreatureStats> = {}): CreatureStats {
  return {
    id, key: `c${id}`, name: `C${id}`, plural: `C${id}s`, level: 1, faction: "neutral", gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 10, speed: 7, attack: 5, defense: 5, minDamage: 2, maxDamage: 2,
    shots: 0, abilities: [], def: "", missile: "", sound: "", ...over,
  };
}

const PIKE = 0, ARCHER = 1, HARPY = 2, FAERIE = 3, ARCHANGEL = 4, WORM = 5, JUGGERNAUT = 6, OGRE_MAGE = 7, CYCLOPS = 8, NIMBLE = 9;
const TABLE = [
  creature(PIKE, { hp: 1000 }),
  creature(ARCHER, { shots: 12, abilities: [{ type: "SHOOTER" }] }),
  creature(HARPY, { speed: 9, abilities: [{ type: "FLYING" }, { type: "RETURN_AFTER_STRIKE" }] }),
  creature(FAERIE, { hp: 20, speed: 15, abilities: [{ type: "FLYING" }, { type: "SPELLCASTER", subtype: "magicArrow", val: 2 }, { type: "CASTS", val: 5 }, { type: "CREATURE_SPELL_POWER", val: 500 }] }),
  creature(ARCHANGEL, { hp: 250, speed: 18, abilities: [{ type: "FLYING" }, { type: "SPELLCASTER", subtype: "resurrection", val: 3 }, { type: "CASTS", val: 1 }] }),
  creature(WORM, { hp: 60, speed: 10, abilities: [{ type: "DOUBLE_WIDE" }, { type: "FLYING", subtype: "movementTeleporting" }, { type: "SPELLCASTER", subtype: "summonLarva", val: 1 }, { type: "CASTS", val: 50 }] }),
  creature(JUGGERNAUT, { hp: 300, abilities: [{ type: "SPELLCASTER", subtype: "heatStrokeJuggernaut" }, { type: "CASTS" }] }),
  creature(OGRE_MAGE, { abilities: [{ type: "SPELLCASTER", subtype: "bloodlust", val: 2 }, { type: "CASTS", val: 3 }] }),
  creature(CYCLOPS, { shots: 16, abilities: [{ type: "SHOOTER" }, { type: "CATAPULT", subtype: "cyclopsShot" }] }),
  creature(NIMBLE, { speed: 3 }),
];
const spell = (id: number, key: string, who: number) => ({ id, key, name: key, level: who, schools: ["fire"], cost: [5, 5, 5, 5], power: 10, effect: [10, 10, 20, 30], chance: [], text: [] }) as unknown as SpellInfo;
const SPELLS = [spell(SPELL.MAGIC_ARROW, "magicArrow", 1), spell(SPELL.RESURRECTION, "resurrection", 4), spell(SPELL.BLOODLUST, "bloodlust", 1)];

function battle(a: [number, number][], b: [number, number][]): BattleState {
  const s = createBattle({ seed: 7, field: "grass_hills", sides: [
    { name: "A", controller: "human", stacks: a.map(([c, count]) => ({ creature: c, count })) },
    { name: "B", controller: "human", stacks: b.map(([c, count]) => ({ creature: c, count })) },
  ] }, TABLE, SPELLS);
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  s.active = s.units[0].id;
  for (const u of s.units) u.acted = u !== s.units[0];
  return s;
}

const attacks = (ev: ReturnType<typeof applyAction>) => ev.filter((e): e is Extract<typeof e, { e: "attack" }> => e.e === "attack");

test("what the alternate action offers: shooters melee, Harpies stay, powers aimed at foes, corpses or ground give way, Heat Stroke the other way round", () => {
  const s = battle([[ARCHER, 5], [HARPY, 5], [FAERIE, 1], [ARCHANGEL, 1], [WORM, 1], [JUGGERNAUT, 1], [OGRE_MAGE, 1]], [[CYCLOPS, 1], [PIKE, 1]]);
  const kind = (i: number) => alternateAction(s, s.units[i]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(kind), ["melee", "stay", "plain", "plain", "plain", "power", null, "melee", null]);
  // A shooter with an enemy beside it can only fight hand to hand: nothing to switch.
  const archer = s.units[0];
  s.units[8].pos = archer.pos + 1;
  assert.equal(kind(0), null);
  // Out of arrows, likewise; Faerie Dragons with no casts left too.
  s.units[8].pos = hexAt(14, 9);
  archer.shots = 0;
  assert.equal(kind(0), null);
  s.units[2].casts = 0;
  assert.equal(kind(2), null);
});

test("a shooter's alternate action: walks up and strikes hand to hand (half damage, retaliation), no arrow spent", () => {
  const s = battle([[ARCHER, 10]], [[PIKE, 1]]);
  const [archer, pike] = s.units;
  archer.pos = hexAt(2, 5);
  pike.pos = hexAt(6, 5);
  const ev = applyAction(s, { type: "attack", unit: archer.id, target: pike.id, from: hexAt(5, 5) });
  assert.equal(archer.pos, hexAt(5, 5));
  assert.equal(archer.shots, 12, "no arrow spent");
  const [blow, back] = attacks(ev);
  assert.equal(blow.ranged, false);
  assert.equal(blow.damage, 10, "10 archers x 2, halved in melee");
  assert.ok(back?.retaliation, "the Pikemen strike back");

  // The shot for comparison: full damage, an arrow spent, no retaliation.
  const t = battle([[ARCHER, 10]], [[PIKE, 1]]);
  t.units[1].pos = hexAt(6, 5);
  t.units[0].pos = hexAt(2, 5);
  const shot = applyAction(t, { type: "shoot", unit: t.units[0].id, target: t.units[1].id });
  assert.equal(attacks(shot)[0].damage, 20);
  assert.equal(t.units[0].shots, 11);
  assert.equal(attacks(shot).length, 1);
});

test("Harpies return after the blow unless told to stay; only those that return may be told to", () => {
  const go = (stay: boolean) => {
    const s = battle([[HARPY, 5]], [[PIKE, 1]]);
    const [h, p] = s.units;
    h.pos = hexAt(2, 5);
    p.pos = hexAt(7, 5);
    applyAction(s, { type: "attack", unit: h.id, target: p.id, from: hexAt(6, 5), stay });
    return h.pos;
  };
  assert.equal(go(false), hexAt(2, 5), "flown back");
  assert.equal(go(true), hexAt(6, 5), "stayed where it struck from");
  const s = battle([[NIMBLE, 5]], [[PIKE, 1]]);
  const [n, p] = s.units;
  n.pos = hexAt(4, 5);
  p.pos = hexAt(6, 5);
  assert.throws(() => applyAction(s, { type: "attack", unit: n.id, target: p.id, from: hexAt(5, 5), stay: true }), Refusal);
});

test("Faerie Dragons attack instead of casting: no cast spent, a plain blow", () => {
  const s = battle([[FAERIE, 2]], [[PIKE, 1]]);
  const [f, p] = s.units;
  f.pos = hexAt(3, 5);
  p.pos = hexAt(8, 5);
  assert.ok(creatureSpellAt(s, f, p.pos).length, "the spell could reach them");
  const ev = applyAction(s, { type: "attack", unit: f.id, target: p.id, from: hexAt(7, 5) });
  assert.equal(attacks(ev)[0].ranged, false);
  assert.ok(!ev.some((e) => e.e === "spell"));
  assert.equal(f.casts ?? 5, 5);
});

test("Archangels and Olgoi-Khorkhoi move onto the fallen without raising or eating them", () => {
  const s = battle([[ARCHANGEL, 1], [ARCHER, 5]], [[PIKE, 1]]);
  const [aa, fallen, foe] = s.units;
  fallen.count = 0;
  fallen.pos = hexAt(6, 3);
  foe.pos = hexAt(14, 9);
  assert.ok(creatureSpellAt(s, aa, fallen.pos).length, "Resurrection could reach them");
  applyAction(s, { type: "move", unit: aa.id, to: fallen.pos });
  assert.equal(aa.pos, hexAt(6, 3));
  assert.equal(fallen.count, 0);
  assert.equal(aa.casts ?? 1, 1);

  const w = battle([[WORM, 1], [PIKE, 1]], [[PIKE, 1]]);
  const [worm, corpse, far] = w.units;
  corpse.count = 0;
  corpse.pos = hexAt(6, 5);
  far.pos = hexAt(14, 9);
  applyAction(w, { type: "move", unit: worm.id, to: corpse.pos });
  assert.equal(worm.pos, hexAt(6, 5));
  assert.ok(!corpse.sacrificed && !worm.bonusStrikes, "not eaten");
});

test("Juggernauts strike as usual instead of a Heat Stroke: retaliation, no beam", () => {
  const s = battle([[JUGGERNAUT, 1]], [[PIKE, 1]]);
  const [j, p] = s.units;
  j.pos = hexAt(4, 5);
  p.pos = hexAt(6, 5);
  const ev = applyAction(s, { type: "attack", unit: j.id, target: p.id, from: hexAt(5, 5) });
  assert.ok(attacks(ev).some((a) => a.retaliation), "the plain blow is answered");
});
