// A route walked a step at a time (the client's, so a click can stop the hero) ends where the whole
// walk does, with the same movement points left.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAdventureAction, buildGameData, createAdventure, findPaths, generateRandomMap, mapPathTo, randomMapName } from "../src/index.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

test("move with steps: one tile per action, the same end and points as the whole walk", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const o = { size: 36, players: 2, humans: 1, monsters: 0, seed: 3 };
  const fresh = () => {
    const { state: s, world: w } = createAdventure(generateRandomMap(data, o), data, { seed: 1, mapFile: randomMapName(o), controllers: ["human", "ai"] });
    w.refresh(s);
    return { s, w, h: s.heroes.find((x) => !x.removed && x.owner === 0)! };
  };
  const a = fresh();
  const paths = findPaths(a.w, a.s, a.h, true);
  // Bare ground three or more steps away, reachable today.
  const [target] = [...paths].find(([i, n]) => {
    const p = mapPathTo(paths, i);
    return p.length >= 4 && n.cost <= a.h.movement && !n.passOnly && p.slice(1).every((t) => !a.w.visitBy[t] && !a.w.blockedBy[t] && !a.w.guardedBy[t] && !a.w.heroAt[t]);
  })!;
  const route = mapPathTo(paths, target);
  applyAdventureAction(a.s, a.w, { type: "move", hero: a.h.id, to: target }, 0);
  const b = fresh();
  for (let k = 1; k < route.length; k++) {
    const ev = applyAdventureAction(b.s, b.w, { type: "move", hero: b.h.id, to: target, steps: 1 }, 0);
    assert.deepEqual(ev, [{ e: "move", hero: b.h.id, path: [route[k - 1], route[k]] }]);
    assert.equal(b.w.index(b.h.x, b.h.y, b.h.z), route[k]);
  }
  assert.deepEqual([b.h.x, b.h.y, b.h.movement], [a.h.x, a.h.y, a.h.movement]);
});
