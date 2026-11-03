// Combination artifacts on the paper doll: assembled in their own slot, moved, traded and worn again
// with their locks; HotA's own artifacts in the game data.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { ResourceStore } from "@heroes/formats/node";
import { COMBOS, LOCKED, SLOT, assemble, bonus, buildGameData, giveArtifact, initEquipment, moveArtifact, takeArtifact, wornArtifacts } from "../src/index.ts";
import type { Hero } from "../src/index.ts";
import { questPay } from "../src/adventure/quests.ts";

const S = SLOT;
const MISC = [S.MISC1, S.MISC2, S.MISC3, S.MISC4, S.MISC5];
const RINGS = [S.RIGHT_RING, S.LEFT_RING];
/** The slots of the artifacts these tests use (ARTRAITS.TXT). */
const artifacts: { name: string; slots: number[] }[] = [];
const put = (slots: number[], ...ids: number[]) => ids.forEach((id) => (artifacts[id] = { name: `#${id}`, slots }));
put([S.RIGHT_HAND], 7, 12, 35, 129, 135);
put([S.LEFT_HAND], 13, 18, 34);
put([S.HEAD], 24, 36);
put([S.TORSO], 30, 31);
put([S.FEET], 32);
put([S.NECK], 33);
put(RINGS, 94, 95);
put(MISC, 96, 131);

const hero = (id = 0): Hero => {
  const h = { id, equipped: undefined, backpack: [] } as unknown as Hero;
  initEquipment(h);
  return h;
};
const attack = (h: Hero) => bonus(h, "PRIMARY_SKILL", "attack");
const snapshot = (...hs: Hero[]) => JSON.stringify(hs.map((h) => [h.equipped, h.backpack, h.combos ?? {}]));

/** Titan's Thunder (Titan's Gladius, Sentinel's Shield, Thunder Helmet, Titan's Cuirass), assembled. */
function titansThunder(h: Hero) {
  Object.assign(h.equipped!, { [S.RIGHT_HAND]: 12, [S.LEFT_HAND]: 18, [S.HEAD]: 24, [S.TORSO]: 30 });
  assemble(artifacts, h, 135);
}

test("an assembled set handed to another hero leaves the giver with nothing of it", () => {
  const a = hero(0);
  const b = hero(1);
  titansThunder(a);
  const withIt = attack(a);
  assert.ok(withIt > 0);
  moveArtifact(artifacts, a, { slot: S.RIGHT_HAND }, b, {});
  assert.equal(attack(a), 0, "the giver keeps no bonus");
  assert.ok(!a.equipped!.includes(LOCKED), "the giver's locks are gone");
  assert.deepEqual(a.combos ?? {}, {});
  assert.deepEqual(b.backpack, [135]);
  assert.equal(attack(b), 0, "in the backpack it gives nothing");
  // Worn by the receiver: the whole set's bonuses, once.
  moveArtifact(artifacts, b, { backpack: 0 }, b, { slot: S.RIGHT_HAND });
  assert.equal(attack(b), withIt);
  assert.equal(b.equipped!.filter((x) => x === LOCKED).length, 3);
  // Straight from one doll to the other.
  moveArtifact(artifacts, b, { slot: S.RIGHT_HAND }, a, { slot: S.RIGHT_HAND });
  assert.equal(attack(a), withIt);
  assert.equal(attack(b), 0);
  assert.ok(!b.equipped!.includes(LOCKED));
});

test("a set goes in its own slot: the Angelic Alliance in the weapon hand, the Elixir of Life among the misc", () => {
  const h = hero();
  Object.assign(h.equipped!, { [S.TORSO]: 31, [S.FEET]: 32, [S.NECK]: 33, [S.LEFT_HAND]: 34, [S.RIGHT_HAND]: 35, [S.HEAD]: 36 });
  assemble(artifacts, h, 129);
  assert.equal(h.equipped![S.RIGHT_HAND], 129);
  for (const sl of [S.TORSO, S.FEET, S.NECK, S.LEFT_HAND, S.HEAD]) assert.equal(h.equipped![sl], LOCKED);
  const e = hero();
  Object.assign(e.equipped!, { [S.RIGHT_RING]: 94, [S.LEFT_RING]: 95, [S.MISC1]: 96 });
  assemble(artifacts, e, 131);
  assert.equal(e.equipped![S.MISC1], 131);
  assert.equal(e.equipped![S.RIGHT_RING], LOCKED);
  assert.equal(e.equipped![S.LEFT_RING], LOCKED);
});

test("a set taken off and worn again keeps every part's bonus, as often as you like", () => {
  const h = hero();
  Object.assign(h.equipped!, { [S.TORSO]: 31, [S.FEET]: 32, [S.NECK]: 33, [S.LEFT_HAND]: 34, [S.RIGHT_HAND]: 35, [S.HEAD]: 36 });
  assemble(artifacts, h, 129);
  const worn = [...wornArtifacts(h)].sort();
  for (let i = 0; i < 3; i++) {
    moveArtifact(artifacts, h, { slot: S.RIGHT_HAND }, h, {});
    assert.ok(!h.equipped!.includes(LOCKED));
    assert.deepEqual(wornArtifacts(h).filter((x) => x !== 0 && x !== 3), []);
    moveArtifact(artifacts, h, { backpack: 0 }, h, { slot: S.RIGHT_HAND });
    assert.deepEqual([...wornArtifacts(h)].sort(), worn);
    assert.equal(h.equipped!.filter((x) => x === LOCKED).length, 5);
  }
});

test("a set with no room for its parts stays in the backpack, nothing changed", () => {
  const h = hero();
  Object.assign(h.equipped!, { [S.RIGHT_RING]: 94, [S.LEFT_RING]: 95, [S.MISC1]: 96 });
  assemble(artifacts, h, 131);
  moveArtifact(artifacts, h, { slot: S.MISC1 }, h, {});
  h.backpack!.push(94, 95);
  moveArtifact(artifacts, h, { backpack: 1 }, h, { slot: S.RIGHT_RING });
  moveArtifact(artifacts, h, { backpack: 1 }, h, { slot: S.LEFT_RING });
  const before = snapshot(h);
  assert.throws(() => moveArtifact(artifacts, h, { backpack: 0 }, h, { slot: S.MISC2 }), /no room/);
  assert.equal(snapshot(h), before);
});

test("nothing can be put in a slot a set has locked, by the hero or by another", () => {
  const a = hero(0);
  const b = hero(1);
  titansThunder(a);
  b.backpack = [13];
  b.equipped![S.LEFT_HAND] = 13;
  const before = snapshot(a, b);
  assert.throws(() => moveArtifact(artifacts, b, { slot: S.LEFT_HAND }, a, { slot: S.LEFT_HAND }), /taken by a combination/);
  assert.throws(() => moveArtifact(artifacts, b, { backpack: 0 }, a, { slot: S.LEFT_HAND }), /taken by a combination/);
  a.backpack = [13];
  assert.throws(() => moveArtifact(artifacts, a, { backpack: 0 }, a, { slot: S.LEFT_HAND }), /taken by a combination/);
  a.backpack = [];
  assert.equal(snapshot(a, b), before);
  // A lock isn't an artifact: it can't be picked up.
  assert.throws(() => moveArtifact(artifacts, a, { slot: S.LEFT_HAND }, b, {}), /nothing there/);
});

test("swapping a worn artifact for a set: each goes where it may", () => {
  const a = hero(0);
  const b = hero(1);
  titansThunder(a);
  b.equipped![S.RIGHT_HAND] = 7;
  moveArtifact(artifacts, a, { slot: S.RIGHT_HAND }, b, { slot: S.RIGHT_HAND });
  assert.equal(b.equipped![S.RIGHT_HAND], 135);
  assert.equal(a.equipped![S.RIGHT_HAND], 7);
  assert.ok(!a.equipped!.includes(LOCKED));
  assert.equal(attack(a), 2);
});

// With the game's own table: every set assembles in its own slot, comes off, and goes back on with the same bonuses.
const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const skip = !dataDirs.length && "needs the game files (HEROES_DATA_DIRS)";
const realData = () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits"] as const;
  return buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
};

test("every set, with the game's table: own slot, off and on again, the same bonuses", { skip }, () => {
  const data = realData();
  for (const [id, parts] of Object.entries(COMBOS)) {
    const combo = Number(id);
    const h = hero();
    const used = new Set<number>();
    for (const p of parts) {
      const sl = data.artifacts[p].slots.find((x) => x !== S.SPELLBOOK && !used.has(x))!;
      used.add(sl);
      h.equipped![sl] = p;
    }
    assemble(data.artifacts, h, combo);
    const at = h.equipped!.indexOf(combo);
    const name = data.artifacts[combo].name;
    assert.ok(data.artifacts[combo].slots.includes(at), `${name} sits in one of its own slots`);
    const worn = [...wornArtifacts(h)].sort();
    moveArtifact(data.artifacts, h, { slot: at }, h, {});
    moveArtifact(data.artifacts, h, { backpack: 0 }, h, { slot: at });
    assert.deepEqual([...wornArtifacts(h)].sort(), worn, `${name} worn again`);
    assert.equal(h.equipped!.filter((x) => x === LOCKED).length, parts.length - 1, `${name} locks`);
  }
});

test("HotA's own artifacts are in the game data: names, slots, and they can be worn", { skip }, () => {
  const data = realData();
  assert.equal(data.artifacts[147].name, "Trident of Dominion");
  assert.deepEqual(data.artifacts[147].slots, [S.RIGHT_HAND]);
  assert.equal(data.artifacts[160].name, "Golden Goose");
  assert.equal(data.artifacts[141].name, "Diplomat's Cloak");
  const h = hero();
  h.backpack = [147, 165];
  moveArtifact(data.artifacts, h, { backpack: 0 }, h, { slot: S.RIGHT_HAND });
  assert.equal(attack(h), 7);
  moveArtifact(data.artifacts, h, { backpack: 0 }, h, { slot: S.MISC3 });
  assert.equal(h.equipped![S.MISC3], 165);
  const b = hero(1);
  moveArtifact(data.artifacts, h, { slot: S.RIGHT_HAND }, b, { slot: S.RIGHT_HAND });
  assert.equal(attack(b), 7);
});

test("HotA's Cannon never waits in the pack: found, it takes the ballista's place; it can't be moved there", () => {
  const table = [...artifacts];
  table[4] = { name: "Ballista", slots: [S.MACH1] };
  table[146] = { name: "Cannon", slots: [S.MACH1] };
  const a = hero();
  a.equipped![S.MACH1] = 4;
  giveArtifact(a, table as never, 146);
  assert.equal(a.equipped![S.MACH1], 146);
  assert.ok(!a.backpack?.includes(146));
  assert.throws(() => moveArtifact(table as never, a, { slot: S.MACH1 }, a, {}), /backpack/);
  // A ballista from the pack can't push the cannon into it either; to another hero's machine slot it goes.
  a.backpack = [4];
  assert.throws(() => moveArtifact(table as never, a, { backpack: 0 }, a, { slot: S.MACH1 }), /backpack/);
  const b = hero(1);
  b.equipped![S.MACH1] = 4;
  moveArtifact(table as never, a, { slot: S.MACH1 }, b, { slot: S.MACH1 });
  assert.equal(b.equipped![S.MACH1], 146);
  assert.equal(a.equipped![S.MACH1], 4);
});

test("an artifact taken away (sold, sacrificed) comes from the backpack first; a worn set frees its slots", () => {
  const h = hero();
  titansThunder(h);
  h.backpack = [7];
  assert.ok(takeArtifact(h, 7));
  assert.deepEqual(h.backpack, []);
  assert.ok(!takeArtifact(h, 135, false), "the Junkman leaves a worn set alone");
  assert.ok(takeArtifact(h, 135));
  assert.equal(h.equipped![S.RIGHT_HAND], -1);
  assert.ok(![S.LEFT_HAND, S.HEAD, S.TORSO].some((sl) => h.equipped![sl] === LOCKED), "the set's slots are free again");
  assert.deepEqual(h.combos ?? {}, {});
  assert.ok(!takeArtifact(h, 135), "nothing left to take");
});

test("the catapult never leaves its slot (a hero would get another one)", () => {
  const h = hero();
  assert.equal(h.equipped![S.MACH4], 3);
  assert.throws(() => moveArtifact(artifacts, h, { slot: S.MACH4 }, h, {}), /catapult/);
  assert.throws(() => moveArtifact(artifacts, h, { slot: S.MACH4 }, hero(1), {}), /catapult/);
  assert.equal(h.equipped![S.MACH4], 3);
  assert.deepEqual(h.backpack, []);
});

test("two of a kind count once, but for the Quiet Eye of the Dragon (heroes.thelazy.net's Artifacts page)", () => {
  const h = hero();
  // Two Rings of Vitality: +1 health, not +2.
  h.equipped![S.RIGHT_RING] = 94;
  h.equipped![S.LEFT_RING] = 94;
  assert.equal(bonus(h, "STACK_HEALTH"), 1);
  // A Ring of Vitality and a Ring of Life: +2.
  h.equipped![S.LEFT_RING] = 95;
  assert.equal(bonus(h, "STACK_HEALTH"), 2);
  // Two Quiet Eyes: +2 Attack.
  h.equipped![S.MISC1] = 37;
  h.equipped![S.MISC2] = 37;
  assert.equal(attack(h), 2);
});

test("a Seer's Hut paid with a worn set frees the slots the set locked", () => {
  const h = hero();
  titansThunder(h);
  questPay({} as never, h, { mission: 5, artifacts: [135] } as never);
  assert.ok(!h.equipped!.includes(135));
  assert.ok(!h.equipped!.includes(LOCKED), "no slot left locked");
});

test("the backpack: an artifact goes in at the place picked, and moves within it", () => {
  const h = hero(0);
  h.backpack = [32, 33, 94];
  h.equipped![S.RIGHT_HAND] = 12;
  // From the doll to the backpack's second place (the original's click on that place).
  moveArtifact(artifacts, h, { slot: S.RIGHT_HAND }, h, { backpack: 1 });
  assert.deepEqual(h.backpack, [32, 12, 33, 94]);
  // Within the backpack: the last one to the front; a place past the end is the end.
  moveArtifact(artifacts, h, { backpack: 3 }, h, { backpack: 0 });
  assert.deepEqual(h.backpack, [94, 32, 12, 33]);
  moveArtifact(artifacts, h, { backpack: 0 }, h, { backpack: 9 });
  assert.deepEqual(h.backpack, [32, 12, 33, 94]);
  // No place named: the end, as before.
  moveArtifact(artifacts, h, { backpack: 0 }, h, { slot: S.FEET });
  moveArtifact(artifacts, h, { slot: S.FEET }, h, {});
  assert.deepEqual(h.backpack, [12, 33, 94, 32]);
});
