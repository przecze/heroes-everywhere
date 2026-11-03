// Two humans on one GameServer: a hero battle reaches both, each controls only their own side.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { type BattleState, activeUnit, buildGameData, chooseAction, GAME_LINE_FILES } from "@heroes/core";
import { parseH3m } from "@heroes/formats";
import { ResourceStore } from "@heroes/formats/node";
import { GameServer, type ServerMessage } from "../src/index.ts";

const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
const mapDir = (process.env.HEROES_MAP_DIRS ?? "").split(":").find((d) => d && existsSync(join(d, "Deluge.h3m")));
const skip = (!dataDirs.length || !mapDir) && "needs the game files (HEROES_DATA_DIRS, HEROES_MAP_DIRS)";

test("hero battle between two humans", { skip }, async () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const inbox: { msg: ServerMessage; to?: number }[] = [];
  const server = new GameServer(data, async (f) => parseH3m(gunzipSync(readFileSync(join(mapDir!, f)))), (msg, to) => inbox.push({ msg, to }));
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, "Deluge.h3m"))));
  const playable = map.players.map((p, i) => (p.canHuman || p.canComputer ? i : -1)).filter((i) => i >= 0);
  const [a, b] = playable;
  const controllers = map.players.map((_, i) => (i === a || i === b ? "human" : "none")) as ("human" | "none")[];
  await server.handle({ t: "advStart", mapFile: "Deluge.h3m", seed: 5, controllers, turnMode: "sequential" }, a);
  const s = server.state!;
  s.current = a;
  const ha = s.heroes.find((h) => h.owner === a && !h.removed)!;
  const hb = s.heroes.find((h) => h.owner === b && !h.removed)!;
  // Put A's hero right next to B's, on any free tile.
  [ha.x, ha.y, ha.z] = [hb.x + 1, hb.y, hb.z];
  ha.army = [{ creature: 13, count: 2 }, null, null, null, null, null, null];
  hb.army = [{ creature: 0, count: 10 }, null, null, null, null, null, null];
  ha.movement = 2000;
  const size = map.size;
  inbox.length = 0;
  await server.handle({ t: "advAct", action: { type: "move", hero: ha.id, to: (hb.z * size + hb.y) * size + hb.x } }, a);
  const updates = (seat: number) => inbox.filter((m) => m.msg.t === "update" && m.to === seat);
  assert.ok(updates(a).length > 0, "attacker sees the battle");
  assert.ok(updates(b).length > 0, "defender sees the battle");

  // Play it out: whoever is up moves their active unit somewhere (or defends); the other seat is refused.
  for (let turn = 0; turn < 400; turn++) {
    const last = [...inbox].reverse().find((m) => m.msg.t === "update")!.msg as { state: BattleState };
    const st = last.state;
    if (st.winner !== null) break;
    const u = activeUnit(st)!;
    const owner = st.sides[u.side].owner!;
    const other = owner === a ? b : a;
    const before = inbox.length;
    await server.handle({ t: "act", action: { type: "defend", unit: u.id } }, other);
    assert.ok(inbox.slice(before).some((m) => m.msg.t === "error" && m.to === other), "can't move the enemy's units");
    await server.handle({ t: "act", action: chooseAction(st) }, owner);
  }
  const end = inbox.filter((m) => m.msg.t === "adv").at(-1)!.msg as { state: typeof s };
  assert.ok(end.state.heroes[ha.id].removed || end.state.heroes[hb.id].removed, "one hero lost");
});

test("a random map is made by the server itself (no map file), the same for every load", async () => {
  const { fakeRes } = await import("../../../tools/shots/fake.ts");
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const inbox: { msg: ServerMessage; to?: number }[] = [];
  const server = new GameServer(data, async (f) => {
    throw new Error(`no map file ${f}`);
  }, (msg, to) => inbox.push({ msg, to }));
  const mapFile = "random:36:2:2:1:5";
  await server.handle({ t: "advStart", mapFile, seed: 5, controllers: ["human", "human"], turnMode: "sequential" }, 0);
  const s = server.state!;
  assert.equal(s.mapFile, mapFile);
  for (const p of [0, 1]) assert.ok(s.heroes.some((h) => h.owner === p && !h.removed), `player ${p} has a hero`);
  assert.ok(!inbox.some((m) => m.msg.t === "error"), "no errors");
});

test("an unknown action is refused, not reported as a bug", async () => {
  const { fakeRes } = await import("../../../tools/shots/fake.ts");
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const inbox: { msg: ServerMessage; to?: number }[] = [];
  const server = new GameServer(data, async (f) => {
    throw new Error(`no map file ${f}`);
  }, (msg, to) => inbox.push({ msg, to }));
  await server.handle({ t: "advStart", mapFile: "random:36:2:2:1:5", seed: 5, controllers: ["human", "human"], turnMode: "sequential" }, 0);
  inbox.length = 0;
  await server.handle({ t: "advAct", action: { type: "noSuchThing" } as never }, 0);
  const err = inbox.find((m) => m.msg.t === "error")?.msg;
  assert.ok(err && err.t === "error" && /unknown action/.test(err.message) && !err.bug, JSON.stringify(err));
});

test("two humans: each is sent only what they may see", async () => {
  const { fakeRes } = await import("../../../tools/shots/fake.ts");
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const inbox: { msg: ServerMessage; to?: number }[] = [];
  const server = new GameServer(data, async (f) => {
    throw new Error(`no map file ${f}`);
  }, (msg, to) => inbox.push({ msg, to }));
  await server.handle({ t: "advStart", mapFile: "random:72:2:2:1:9", seed: 5, controllers: ["human", "human"], turnMode: "simultaneous" }, 0);
  for (const seat of [0, 1]) {
    const mine = inbox.filter((m) => m.msg.t === "adv" && m.to === seat).at(-1)?.msg;
    assert.ok(mine && mine.t === "adv", `seat ${seat} got the adventure`);
    if (mine?.t !== "adv") continue;
    const other = 1 - seat;
    assert.ok(mine.state.heroes.some((h) => h.owner === seat && !h.removed), "its own hero");
    assert.ok(!mine.state.heroes.some((h) => h.owner === other && !h.removed), "not the other's, far off in the fog");
    assert.equal(mine.state.players[other].revealed.length, 0, "nor the other's explored map");
    assert.ok(mine.state.players[seat].revealed.length > 0, "its own explored map");
  }
  assert.ok(!inbox.some((m) => m.msg.t === "adv" && m.to === undefined), "nothing sent to everyone");
});

test("Disguise: the rival's copy of the state holds the shown army, not the real one", async () => {
  const { fakeRes } = await import("../../../tools/shots/fake.ts");
  const { createAdventure, generateRandomMap, randomMapName, isRevealed } = await import("@heroes/core");
  const { viewFor } = await import("../src/index.ts");
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const o = { size: 36, players: 2, humans: 2, monsters: 1, seed: 1 };
  const map = generateRandomMap(data, o);
  const { state: s, world: w } = createAdventure(map, data, { seed: 1, mapFile: randomMapName(o), controllers: ["human", "human"] });
  const h = s.heroes.find((x) => x.owner === 0 && !x.removed)!;
  h.army = [{ creature: 0, count: 30 }, { creature: 13, count: 2 }, null, null, null, null, null];
  [h.disguise, h.disguiseMastery] = [s.day, 2];
  // Blue sees Red's hero (its tile revealed).
  const i = w.index(h.x, h.y, h.z);
  s.players[1].revealed[i >> 5] |= 1 << (i & 31);
  assert.ok(isRevealed(s, 1, i));
  const theirs = viewFor(s, w, 1, []).state.heroes[h.id];
  assert.ok(!theirs.removed);
  assert.deepEqual(theirs.army.filter(Boolean).map((a) => a!.count), [0, 0], "Advanced: the numbers hidden");
  assert.ok(theirs.army.filter(Boolean).every((a) => a!.creature === theirs.army[0]!.creature), "every stack shown as one creature");
  assert.deepEqual(viewFor(s, w, 0, []).state.heroes[h.id].army, h.army, "the owner keeps the real army");
});

test("HotA's Restart: a battle fought by the computer for us is fought again from its start, by hand; gone once anything else is done", { skip }, async () => {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const inbox: { msg: ServerMessage; to?: number }[] = [];
  const server = new GameServer(data, async (f) => parseH3m(gunzipSync(readFileSync(join(mapDir!, f)))), (msg, to) => inbox.push({ msg, to }));
  const map = parseH3m(gunzipSync(readFileSync(join(mapDir!, "Deluge.h3m"))));
  const me = map.players.findIndex((p) => p.canHuman);
  const controllers = map.players.map((p, i) => (i === me ? "human" : p.canComputer ? "ai" : "none")) as ("human" | "ai" | "none")[];
  await server.handle({ t: "advStart", mapFile: "Deluge.h3m", seed: 5, controllers }, me);
  const s = server.state!;
  const h = s.heroes.find((x) => x.owner === me && !x.removed)!;
  // A wandering stack brought to the tile beside our hero (Deluge is mostly water).
  const w = (server as unknown as { adv: { world: { refresh(s: unknown): void; index(x: number, y: number, z: number): number; blocked(i: number): boolean; visitBy: number[]; map: { tiles: { terrain: number }[] } } } }).adv.world;
  const monster = s.objects.find((o) => o.type === 54 && !o.removed)!;
  const free = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]].map(([dx, dy]) => [h.x + dx, h.y + dy]).find(([x, y]) => { const i = w.index(x, y, h.z); return i >= 0 && !w.blocked(i) && !w.visitBy[i] && w.map.tiles[i].terrain !== 8; })!;
  [monster.x, monster.y, monster.z] = [free[0], free[1], h.z];
  // (Savage: they fight, neither fleeing nor joining.)
  monster.data = { ...monster.data, aggression: 10 };
  h.army = [{ creature: 0, count: 20 }, null, null, null, null, null, null];
  h.movement = 2000;
  w.refresh(s);
  const army = structuredClone(h.army);
  await server.handle({ t: "advAct", action: { type: "move", hero: h.id, to: (monster.z * map.size + monster.y) * map.size + monster.x } }, me);
  const b = [...inbox].reverse().find((m) => m.msg.t === "update")?.msg as { state: BattleState };
  const side = b.state.sides.findIndex((x) => x.owner === me);
  // Quick combat: the computer plays our side to the end.
  await server.handle({ t: "control", side: side as 0 | 1, controller: "ai" }, me);
  assert.ok(monster.removed || server.state!.heroes[h.id].removed || server.state!.objects[monster.id].removed, "the battle is over");
  inbox.length = 0;
  await server.handle({ t: "battleRestart" }, me);
  const again = inbox.find((m) => m.msg.t === "update")?.msg as { state: BattleState } | undefined;
  assert.ok(again, "the battle is back");
  assert.equal(again.state.winner, null);
  assert.equal(again.state.sides[side].controller, "human", "ours to fight by hand");
  assert.ok(!server.state!.objects[monster.id].removed, "the monsters stand again");
  assert.deepEqual(server.state!.heroes[h.id].army, army, "our army as it was");
  // Fought out again, then something else done on the map: no restart any more.
  await server.handle({ t: "control", side: side as 0 | 1, controller: "ai" }, me);
  await server.handle({ t: "advAct", action: { type: "dig", hero: h.id } }, me);
  inbox.length = 0;
  await server.handle({ t: "battleRestart" }, me);
  assert.ok(inbox.some((m) => m.msg.t === "error" && !m.msg.bug), "refused");
});

test("hot seat: a colour goes to the computer when someone leaves (and back); never the last person's, never in a multiplayer game", async () => {
  const { fakeRes } = await import("../../../tools/shots/fake.ts");
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  const data = buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
  const inbox: { msg: ServerMessage; to?: number }[] = [];
  const server = new GameServer(data, async (f) => {
    throw new Error(`no map file ${f}`);
  }, (msg, to) => inbox.push({ msg, to }));
  await server.handle({ t: "advStart", mapFile: "random:36:3:3:1:5", seed: 5, controllers: ["human", "human", "human"], turnMode: "sequential" }, 0);
  const s = server.state!;
  // Blue leaves the party: the computer plays Blue on; Red ends the day and Blue's turn goes by itself to Tan.
  await server.handle({ t: "advSeat", player: 1, controller: "ai" }, 0);
  assert.equal(s.players[1].controller, "ai");
  await server.handle({ t: "advAct", action: { type: "endTurn" } }, 0);
  assert.equal(s.current, 2, "the computer played Blue's turn");
  await server.handle({ t: "advSeat", player: 0, controller: "ai" }, 2);
  inbox.length = 0;
  await server.handle({ t: "advSeat", player: 2, controller: "ai" }, 2);
  assert.ok(inbox.some((m) => m.msg.t === "error" && /keep playing/.test(m.msg.message)), "the last person keeps playing");
  assert.equal(s.players[2].controller, "human");
  // Blue is back.
  await server.handle({ t: "advSeat", player: 1, controller: "human" }, 2);
  assert.equal(s.players[1].controller, "human");
  // A multiplayer game's colours are their players'.
  const mp = new GameServer(data, async () => { throw new Error("no file"); }, () => {}, { views: true });
  await mp.handle({ t: "advStart", mapFile: "random:36:2:2:1:5", seed: 5, controllers: ["human", "human"], turnMode: "sequential" }, 0);
  await mp.handle({ t: "advSeat", player: 1, controller: "ai" }, 0);
  assert.equal(mp.state!.players[1].controller, "human");
});
