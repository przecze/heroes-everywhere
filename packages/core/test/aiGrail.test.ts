// The computer digs for the Grail once its obelisks show where it lies.
import assert from "node:assert/strict";
import { test } from "node:test";
import { adventureAiTurn, buildGameData, createAdventure, findPaths, generateRandomMap, randomMapName } from "../src/index.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

test("AI: every obelisk seen, a hero walks to the Grail, waits there and digs it up the next day", () => {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const o = { size: 36, players: 2, humans: 0, monsters: 0, seed: 1 };
  const map = generateRandomMap(data, o);
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: randomMapName(o), controllers: ["ai", "ai"] });
  w.refresh(s);
  const h = s.heroes.find((x) => !x.removed && x.owner === 0)!;
  // The Grail on bare ground half a day's walk away; one obelisk on the map, and red has seen it.
  const paths = findPaths(w, s, h);
  const [spot] = [...paths].find(([i, n]) => n.cost > 300 && n.cost < h.movement / 2 && !n.passOnly && !w.visitBy[i] && !w.blockedBy[i] && !w.guardedBy[i])!;
  s.grail = { x: spot % w.size, y: Math.floor(spot / w.size) % w.size, z: 0 };
  const obelisk = s.objects.find((x) => x.type === 57) ?? s.objects.find((x) => !x.town && x.type !== 34)!;
  obelisk.type = 57;
  for (const x of s.objects) if (x !== obelisk && x.type === 57) x.type = 0;
  s.players[0].obelisks = [obelisk.id];
  adventureAiTurn(s, w, 0);
  assert.deepEqual([h.x, h.y], [s.grail.x, s.grail.y], "at the Grail, waiting for a whole day to dig");
  assert.ok(!s.grail.found);
  // Red's next turn, a whole day's movement.
  s.current = 0;
  s.ended[0] = false;
  h.movement = h.maxMovement;
  adventureAiTurn(s, w, 0);
  assert.ok(s.grail.found, "dug up");
  assert.ok([...(h.equipped ?? []), ...(h.backpack ?? [])].includes(2), "the hero carries it");
});
