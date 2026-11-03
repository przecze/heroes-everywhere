// Castle, Rampart, Tower and Inferno creatures' battle abilities as heroes.thelazy.net's pages give them
// (HotA), on a table with the real abilities (creatureData.ts) and round numbers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type BattleEvent, type BattleState, type CreatureStats, applyAction, chooseAction, createBattle, moraleOf, startBattle } from "../src/index.ts";
import { CREATURE_INFO } from "../src/creatureData.ts";
import { creatureSpellAt } from "../src/battle/creatureMagic.ts";
import { resistChance, spellCost } from "../src/battle/magic.ts";
import { SPELL, type SpellInfo } from "../src/spells.ts";
import { hexAt, neighbours } from "../src/battle/hex.ts";

const STATS: Record<number, Partial<CreatureStats>> = {
  48: { hp: 35 },
  51: { hp: 45 },
  53: { hp: 90, attack: 16, defense: 14 },
};

const TABLE: CreatureStats[] = Array.from({ length: 56 }, (_, id) => {
  const info = CREATURE_INFO[id];
  return {
    id, key: info.key, name: info.key, plural: `${info.key}s`, level: info.level, faction: info.faction, gold: 10, cost: [0, 0, 0, 0, 0, 0, 10],
    hordeGrowth: 0, fightValue: 100, aiValue: 100, growth: 5, hp: 10, speed: 5, attack: 5, defense: 5, minDamage: 10, maxDamage: 10,
    shots: info.abilities.some((a) => a.type === "SHOOTER") ? 10 : 0, abilities: structuredClone(info.abilities), def: "", missile: "", sound: "", ...STATS[id],
  };
});

const PIKEMAN = 0, MARKSMAN = 3, DENDROID = 22, GRIFFIN = 4, ANGEL = 12, ARCHANGEL = 13, DWARF = 16, PEGASUS = 20, UNICORN = 24;
const GARGOYLE = 30, MAGE = 34, MASTER_GENIE = 37, IMP = 42, CERBERUS = 47, DEMON = 48, PIT_LORD = 51, EFREET = 52, SULTAN = 53;

const RESURRECTION = { id: SPELL.RESURRECTION, key: "resurrection", name: "Resurrection", level: 4, schools: ["earth"], cost: [20, 20, 16, 16], power: 50, effect: [40, 40, 80, 160], chance: [], text: [] } as unknown as SpellInfo;
const CURE = { id: SPELL.CURE, key: "cure", name: "Cure", level: 1, schools: ["water"], cost: [6, 6, 5, 5], power: 5, effect: [10, 10, 20, 30], chance: [], text: [] } as unknown as SpellInfo;
const SLAYER = { id: SPELL.SLAYER, key: "slayer", name: "Slayer", level: 4, schools: ["fire"], cost: [16, 16, 12, 12], power: 0, effect: [8, 8, 8, 8], chance: [], text: [] } as unknown as SpellInfo;
const BLESS = { id: SPELL.BLESS, key: "bless", name: "Bless", level: 1, schools: ["water"], cost: [5, 5, 4, 4], power: 0, effect: [0, 0, 1, 1], chance: [], text: [] } as unknown as SpellInfo;

type Hero = NonNullable<BattleState["sides"][0]["hero"]>;
const hero = (over: Partial<Hero> = {}): Hero => ({ name: "H", heroClass: 0, female: false, owner: 0, primary: [0, 0, 1, 1], ...over });

function battle(a: [number, number][], b: [number, number][], opts: { field?: string; heroA?: Hero; heroB?: Hero } = {}): BattleState {
  const s = createBattle({ seed: 5, field: opts.field ?? "grass_hills", sides: [
    { name: "A", controller: "human", hero: opts.heroA, stacks: a.map(([creature, count]) => ({ creature, count })) },
    { name: "B", controller: "human", hero: opts.heroB, stacks: b.map(([creature, count]) => ({ creature, count })) },
  ] }, TABLE, [RESURRECTION, BLESS, CURE, SLAYER]);
  s.obstacles = [];
  s.blocked = [];
  startBattle(s);
  return s;
}

/** Make `id` the stack whose turn it is. */
function turnOf(s: BattleState, id: number) {
  for (const u of s.units) u.acted = u.id !== id;
  s.active = id;
}

const attacks = (ev: BattleEvent[]) => ev.filter((e): e is Extract<BattleEvent, { e: "attack" }> => e.e === "attack");

test("Angels' +1 morale lasts after they have all fallen (not from a summoned or cloned Angel)", () => {
  const s = battle([[ANGEL, 1], [PIKEMAN, 10]], [[IMP, 10]]);
  const [angel, pike] = s.units;
  assert.equal(moraleOf(s, pike), 2, "one town +1, Angels +1");
  angel.count = 0;
  assert.equal(moraleOf(s, pike), 2, "the Angels' morale outlives them");
});

test("Marksmen shoot twice but strike once in melee", () => {
  const s = battle([[MARKSMAN, 10]], [[PIKEMAN, 100]]);
  const [m, p] = s.units;
  m.pos = hexAt(5, 5);
  p.pos = hexAt(12, 5);
  turnOf(s, m.id);
  assert.equal(attacks(applyAction(s, { type: "shoot", unit: m.id, target: p.id })).filter((e) => e.unit === m.id).length, 2);
  p.pos = hexAt(6, 5);
  turnOf(s, m.id);
  assert.equal(attacks(applyAction(s, { type: "attack", unit: m.id, target: p.id, from: m.pos })).filter((e) => e.unit === m.id).length, 1);
});

test("Woken from Blind, a stack strikes back at half (basic), a quarter (advanced), not at all (expert)", () => {
  const back = (mastery: number | null) => {
    const s = battle([[PIKEMAN, 10]], [[GRIFFIN, 100]]);
    const [p, g] = s.units;
    p.pos = hexAt(5, 5);
    g.pos = hexAt(6, 5);
    if (mastery !== null) g.effects = [{ spell: SPELL.BLIND, rounds: 3, mastery, value: 0 }];
    turnOf(s, p.id);
    const ev = attacks(applyAction(s, { type: "attack", unit: p.id, target: g.id, from: p.pos }));
    return ev.filter((e) => e.retaliation && e.unit === g.id).map((e) => e.damage);
  };
  const [full] = back(null);
  assert.deepEqual(back(1), [Math.floor(full * 0.5)]);
  assert.deepEqual(back(2), [Math.floor(full * 0.25)]);
  assert.deepEqual(back(3), []);
});

test("Unicorns' aura: +20% resistance to the stacks beside them, not to themselves", () => {
  const s = battle([[UNICORN, 2], [DWARF, 10], [PIKEMAN, 10]], [[IMP, 10]]);
  const [u, d, p] = s.units;
  u.pos = hexAt(3, 5);
  d.pos = neighbours(u.pos).find((h) => h !== hexAt(2, 5) && h !== hexAt(4, 5))!;
  p.pos = hexAt(10, 9);
  assert.equal(resistChance(s, u), 0);
  assert.ok(Math.abs(resistChance(s, d) - 0.4) < 1e-9, "Dwarves' 20% and the aura's 20%");
  assert.equal(resistChance(s, p), 0);
});

test("Pegasi (+2 to the enemy) and Magi (-2 to their own) for the whole battle, not added up", () => {
  const s = battle([[MAGE, 5], [MAGE, 5]], [[PEGASUS, 5], [PEGASUS, 5]], { heroA: hero(), heroB: hero() });
  assert.equal(spellCost(s, 0, BLESS), 5 - 2 + 2);
  assert.equal(spellCost(s, 1, BLESS), 5);
  for (const u of s.units) if (u.creature === PEGASUS) u.count = 0;
  assert.equal(spellCost(s, 0, BLESS), 5, "the Pegasi's damper stays after they fall... and the Magi's help");
});

test("Efreet Sultans' Fire Shield: 20% back, 30% with the Orb of Tempestuous Fire; Efreet and clones don't burn", () => {
  const burn = (attacker: number, opts: { orb?: boolean; clone?: boolean } = {}) => {
    const s = battle([[attacker, 10]], [[SULTAN, 10]], { heroB: opts.orb ? hero({ bonuses: [{ type: "SPELL_DAMAGE", subtype: "fire", val: 50 }] }) : undefined });
    const [a, d] = s.units;
    a.pos = hexAt(5, 5);
    d.pos = hexAt(6, 5);
    if (opts.clone) d.clone = true;
    turnOf(s, a.id);
    const ev = attacks(applyAction(s, { type: "attack", unit: a.id, target: d.id, from: a.pos }));
    const blow = ev.find((e) => e.unit === a.id && !e.retaliation)!;
    return { blow: blow.damage, shield: ev.find((e) => e.fireShield)?.damage };
  };
  // (Its base leaves out the Sultans' defenses: 10 Pikemen deal 100 before the Sultans' Defense, 80 after.)
  const plain = burn(PIKEMAN);
  assert.equal(plain.blow, 80);
  assert.equal(plain.shield, 20);
  const orb = burn(PIKEMAN, { orb: true });
  assert.equal(orb.shield, 30);
  assert.equal(burn(EFREET).shield, undefined, "fire-immune");
  assert.equal(burn(PIKEMAN, { clone: true }).shield, undefined, "a clone has no shield");
});

test("Cerberi: a lucky bite is the main target's only", () => {
  const s = battle([[CERBERUS, 10]], [[PIKEMAN, 50], [PIKEMAN, 50], [PIKEMAN, 50]], { heroA: hero({ luck: 3 }) });
  const [c, a, b, d] = s.units;
  c.pos = hexAt(5, 5);
  a.pos = hexAt(6, 5);
  [b.pos, d.pos] = neighbours(c.pos).filter((h) => neighbours(a.pos).includes(h));
  let lucky = 0;
  for (let i = 0; i < 40; i++) {
    for (const x of [a, b, d]) x.count = 50;
    turnOf(s, c.id);
    const ev = attacks(applyAction(s, { type: "attack", unit: c.id, target: a.id, from: c.pos }));
    assert.ok(ev.filter((e) => e.splash).length >= 1);
    assert.ok(ev.every((e) => !e.splash || !e.luck));
    lucky += ev.filter((e) => e.luck === "good").length;
    s.winner = null;
  }
  assert.ok(lucky > 0, "the main bite is lucky at times");
});

test("Pit Lords: 50 health of Demons each, no more than the fallen stack's health nor its number; not on Cursed Ground; Demons rise again", () => {
  const raise = (lords: number, dead: [number, number], field?: string) => {
    const s = battle([[PIT_LORD, lords], dead], [[IMP, 1]], { field });
    const [pl, corpse] = s.units;
    corpse.count = 0;
    corpse.firstHp = 0;
    turnOf(s, pl.id);
    if (!creatureSpellAt(s, pl, corpse.pos).length) return { n: 0, s, corpse, pl };
    applyAction(s, { type: "creatureCast", unit: pl.id, target: corpse.pos });
    return { n: corpse.creature === DEMON ? corpse.count : 0, s, corpse, pl };
  };
  assert.equal(raise(10, [PIKEMAN, 4]).n, 1, "40 health: one Demon");
  assert.equal(raise(10, [PIKEMAN, 3]).n, 0, "30 health: none");
  assert.equal(raise(7, [IMP, 100]).n, 10, "350 health of Pit Lords");
  assert.equal(raise(10, [SULTAN, 2]).n, 2, "180 health but only two fallen");
  assert.equal(raise(10, [PIKEMAN, 40], "cursed_ground").n, 0, "Cursed Ground");
  assert.equal(raise(10, [GARGOYLE, 40]).n, 0, "not from Gargoyles");
  const r = raise(20, [PIKEMAN, 40]);
  assert.equal(r.n, 11);
  r.corpse.count = 0;
  r.pl.casts = 1;
  turnOf(r.s, r.pl.id);
  applyAction(r.s, { type: "creatureCast", unit: r.pl.id, target: r.corpse.pos });
  assert.equal(r.corpse.count, 11, "the fallen Demons rise again");
});

test("Archangels raise the fallen, but not Gargoyles", () => {
  const s = battle([[ARCHANGEL, 2], [GARGOYLE, 10], [PIKEMAN, 30]], [[IMP, 1]]);
  const [aa, gar, pike] = s.units;
  gar.count = 0;
  pike.count = 5;
  turnOf(s, aa.id);
  assert.equal(creatureSpellAt(s, aa, gar.pos).length, 0);
  applyAction(s, { type: "creatureCast", unit: aa.id, target: pike.pos });
  assert.equal(pike.count, 25, "200 health of Pikemen");
});

test("Master Genies don't cast what would do nothing: Cure on a stack unhurt, Slayer with no king to slay", () => {
  const s = battle([[MASTER_GENIE, 5], [PIKEMAN, 10]], [[IMP, 10]]);
  const [g, p] = s.units;
  const keys = () => creatureSpellAt(s, g, p.pos).map((sp) => sp.key);
  assert.ok(keys().includes("bless"));
  assert.ok(!keys().includes("cure") && !keys().includes("slayer"));
  p.firstHp = 3;
  assert.ok(keys().includes("cure"));
  const k = battle([[MASTER_GENIE, 5], [PIKEMAN, 10]], [[ANGEL, 1]]);
  assert.ok(creatureSpellAt(k, k.units[0], k.units[1].pos).some((sp) => sp.key === "slayer"), "Angels are King 2: advanced Slayer");
});

test("Dendroids let go of whoever they bound once they move", () => {
  const s = battle([[DENDROID, 5]], [[PIKEMAN, 10]]);
  const [d, p] = s.units;
  d.pos = hexAt(5, 5);
  p.pos = hexAt(6, 5);
  p.effects = [{ spell: SPELL.BIND, rounds: 999, mastery: 1, value: d.id }];
  turnOf(s, d.id);
  applyAction(s, { type: "move", unit: d.id, to: hexAt(4, 5) });
  assert.equal(p.effects?.length ?? 0, 0);
});

test("The computer's Archangels keep their one Resurrection for the fallen, not a wound of their own", () => {
  const s = battle([[ARCHANGEL, 2], [PIKEMAN, 30]], [[IMP, 1]]);
  const [aa, pike] = s.units;
  s.sides[0].controller = "ai";
  aa.firstHp = 10;
  turnOf(s, aa.id);
  assert.notEqual(chooseAction(s).type, "creatureCast");
  pike.count = 10;
  turnOf(s, aa.id);
  const act = chooseAction(s);
  assert.equal(act.type, "creatureCast");
  assert.equal(act.type === "creatureCast" && act.target, pike.pos);
});
