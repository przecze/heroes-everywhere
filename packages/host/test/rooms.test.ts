// The multiplayer host's rooms, driven as two (or three) browsers would: joining, rejoining
// mid-battle, after a restart, what each is sent, and what a room member may not do.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type AdventureState, type BattleState, SKILLS, type World, activeUnit, buildGameData, chooseAction, generateRandomMap, parseRandomMapName, playersInContact } from "@heroes/core";
import { type ServerMessage, flagOwners, replaySteps } from "@heroes/server";
import { fakeRes } from "../../../tools/shots/fake.ts";
import type { HostServerMessage } from "../src/protocol.ts";
import { type Client, FLOOD_CLOSE, KEEP_MS, RATE, Rooms } from "../src/rooms.ts";
import { record } from "../src/roomWatch.ts";

const FILES = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData(Object.fromEntries(FILES.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof FILES)[number], Uint8Array>);
const loadMap = async (file: string) => {
  const o = parseRandomMapName(file);
  if (!o) throw new Error(`no map ${file}`);
  return generateRandomMap(data, o);
};
const MAP = "random:36:2:2:1:5";

/** A browser: its inbox of what the host sent it. */
interface Browser {
  c: Client;
  inbox: HostServerMessage[];
  game: () => ServerMessage[];
  lastAdv: () => AdventureState | undefined;
  lastBattle: () => BattleState | undefined;
  errors: () => string[];
}

function browser(rooms: Rooms): Browser {
  const inbox: HostServerMessage[] = [];
  const c = rooms.connect((m) => inbox.push(structuredClone(m)));
  const game = () => inbox.flatMap((m) => (m.t === "game" ? [m.msg] : []));
  return {
    c,
    inbox,
    game,
    lastAdv: () => game().flatMap((m) => (m.t === "adv" ? [m.state] : [])).at(-1),
    lastBattle: () => game().flatMap((m) => (m.t === "update" ? [m.state] : [])).at(-1),
    errors: () => inbox.flatMap((m) => (m.t === "mpError" ? [m.message] : m.t === "game" && m.msg.t === "error" ? [m.msg.message] : [])),
  };
}

let codes = 0;
function setup(dir?: string) {
  // (A fixed seed: the same game, the same battles, every run.)
  const rooms = new Rooms({ data, loadMap, dir, code: () => `R${++codes}`, seed: () => 7, rate: null });
  return rooms;
}

/** Two players in a started sequential game: Red (seat 0) hosts, Blue (seat 1) joined. */
async function twoPlayers(rooms: Rooms) {
  const a = browser(rooms);
  const b = browser(rooms);
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: MAP });
  const id = a.c.room!.info.id;
  await rooms.message(b.c, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(a.c, { t: "mpMode", turnMode: "sequential" });
  await rooms.message(a.c, { t: "mpStart" });
  const room = rooms.rooms.get(id)!;
  return { a, b, id, room, server: room.server! };
}

/** Red's hero walks into Blue's: a battle between the two humans. */
async function fight(rooms: Rooms, t: Awaited<ReturnType<typeof twoPlayers>>, redSkills?: [number, number][], counts = [2, 10]) {
  const s = t.server.state!;
  s.current = 0;
  const ha = s.heroes.find((h) => h.owner === 0 && !h.removed)!;
  const hb = s.heroes.find((h) => h.owner === 1 && !h.removed)!;
  [ha.x, ha.y, ha.z] = [hb.x + 1, hb.y, hb.z];
  ha.army = [{ creature: 13, count: counts[0] }, null, null, null, null, null, null];
  hb.army = [{ creature: 0, count: counts[1] }, null, null, null, null, null, null];
  ha.movement = 2000;
  if (redSkills) ha.skills = redSkills;
  hb.skills = [];
  await rooms.message(t.a.c, { t: "game", msg: { t: "advAct", action: { type: "move", hero: ha.id, to: (hb.z * s.size + hb.y) * s.size + hb.x } } });
  assert.ok(t.a.lastBattle(), "the attacker sees the battle");
  assert.ok(t.b.lastBattle(), "the defender sees the battle");
  return { ha, hb };
}

test("rejoining mid-battle brings back the battle, not only the map", async () => {
  const rooms = setup();
  const t = await twoPlayers(rooms);
  await fight(rooms, t);
  rooms.disconnect(t.b.c);
  const b2 = browser(rooms);
  await rooms.message(b2.c, { t: "mpJoin", room: t.id, name: "Bob" });
  assert.ok(b2.lastAdv(), "the map");
  const battle = b2.lastBattle();
  assert.ok(battle, "the battle it's in");
  assert.equal(battle!.id, t.a.lastBattle()!.id);
  // And it can go on: Bob's units answer to him.
  for (let turn = 0; turn < 400; turn++) {
    const st = b2.lastBattle()!;
    if (st.winner !== null) break;
    const side = st.tactics?.side ?? activeUnit(st)!.side;
    // (Tactics over: sent for one of that side's own units, as the battle screen does.)
    const action = st.tactics ? { type: "tacticsDone" as const, unit: st.units.find((u) => u.side === side)!.id } : chooseAction(st);
    await rooms.message((st.sides[side].owner === 0 ? t.a : b2).c, { t: "game", msg: { t: "act", action } });
  }
  assert.notEqual(b2.lastBattle()!.winner, null, "the battle finished");
  assert.deepEqual(b2.errors(), []);
});

test("after a host restart, rejoining players get their game and the battle in progress", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rooms-"));
  const first = setup(dir);
  const t = await twoPlayers(first);
  await fight(first, t);
  const again = setup(dir);
  await again.restore();
  const b = browser(again);
  await again.message(b.c, { t: "mpJoin", room: t.id, name: "Bob" });
  assert.ok(b.lastAdv(), "the map");
  assert.ok(b.lastBattle(), "the battle");
  assert.equal(b.lastBattle()!.winner, null);
});

test("a rejoining player gets their own view, not the whole game", async () => {
  const rooms = setup();
  const t = await twoPlayers(rooms);
  const b2 = browser(rooms);
  await rooms.message(b2.c, { t: "mpJoin", room: t.id, name: "Bob" });
  const view = b2.lastAdv()!;
  const s = t.server.state!;
  const red = s.heroes.find((h) => h.owner === 0 && !h.removed)!;
  const seen = view.heroes[red.id];
  assert.ok(seen.removed, "Red's hero far off in the fog");
  assert.deepEqual([seen.x, seen.y, seen.army.filter(Boolean).length], [0, 0, 0], "nothing of where it is or its army");
  assert.ok(view.players[0].resources.every((r) => r === 0), "nor Red's resources");
  assert.equal(view.players[0].revealed.length, 0);
  assert.equal(view.rng, 0, "nor the random seed");
  assert.ok(view.players[1].resources[6] > 0, "its own resources");
  assert.ok(view.ranks, "the Thieves' Guild ranking made from the whole game");
});

test("a room member can't replace the running game", async () => {
  const rooms = setup();
  const t = await twoPlayers(rooms);
  const before = t.server.state!;
  for (const msg of [
    { t: "advStart", mapFile: "random:36:2:1:1:9", seed: 1 },
    { t: "advResume", state: before },
    { t: "start", setup: {} },
  ] as const)
    await rooms.message(t.b.c, { t: "game", msg: msg as never });
  assert.equal(t.server.state, before, "the same game runs");
  assert.equal(t.b.errors().length, 3);
});

test("a refused joiner isn't left in the room", async () => {
  const rooms = setup();
  const t = await twoPlayers(rooms);
  const c = browser(rooms);
  await rooms.message(c.c, { t: "mpJoin", room: t.id, name: "Cid" });
  assert.deepEqual(c.errors(), ["That game has already started."]);
  assert.equal(c.c.room, undefined);
  assert.ok(![...t.room.clients].includes(c.c));
  const n = c.inbox.length;
  await rooms.message(t.a.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.equal(c.inbox.length, n, "and gets nothing of the game");
});

test("a player can't hand the other's battle side to the computer", async () => {
  const rooms = setup();
  const t = await twoPlayers(rooms);
  await fight(rooms, t);
  const b = t.server.state!.battles[0].battle;
  await rooms.message(t.a.c, { t: "game", msg: { t: "control", side: 1, controller: "ai" } });
  assert.equal(b.sides[1].controller, "human");
  assert.ok(t.a.errors().includes("that side isn't yours"));
});

test("auto combat in a battle between two humans: the other still sees every move to the end", async () => {
  const rooms = setup();
  const t = await twoPlayers(rooms);
  await fight(rooms, t);
  // Both hand their side to the computer: the battle plays out.
  await rooms.message(t.a.c, { t: "game", msg: { t: "control", side: 0, controller: "ai" } });
  await rooms.message(t.b.c, { t: "game", msg: { t: "control", side: 1, controller: "ai" } });
  for (const x of [t.a, t.b]) assert.notEqual(x.lastBattle()!.winner, null, "the battle's end reaches both");
  assert.equal(t.a.lastBattle()!.log.length, t.b.lastBattle()!.log.length);
});

test("one side on auto: the human playing the other still gets the computer's moves", async () => {
  const rooms = setup();
  const t = await twoPlayers(rooms);
  await fight(rooms, t);
  const st = t.a.lastBattle()!;
  const autoSide = st.sides[st.tactics?.side ?? activeUnit(st)!.side].owner === 0 ? 0 : 1;
  const [auto, other] = autoSide === 0 ? [t.a, t.b] : [t.b, t.a];
  const n = other.game().length;
  await rooms.message(auto.c, { t: "game", msg: { t: "control", side: autoSide, controller: "ai" } });
  assert.ok(other.game().length > n, "the computer's moves reach the other");
  assert.equal(other.lastBattle()!.log.length, auto.lastBattle()!.log.length);
});

test("leaving a room before the start frees the colour; the host hands the room on; the last one closes it", async () => {
  const rooms = setup();
  const a = browser(rooms);
  const b = browser(rooms);
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: MAP });
  const id = a.c.room!.info.id;
  await rooms.message(b.c, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(a.c, { t: "mpLeave" });
  const info = rooms.rooms.get(id)!.info;
  assert.deepEqual(info.players.map((p) => p.name), ["Bob"]);
  assert.equal(info.host, "Bob");
  await rooms.message(b.c, { t: "mpLeave" });
  assert.ok(!rooms.rooms.has(id));
});

test("leaving a running game keeps the seat to continue later", async () => {
  const rooms = setup();
  const t = await twoPlayers(rooms);
  await rooms.message(t.b.c, { t: "mpLeave" });
  assert.equal(t.b.c.room, undefined);
  assert.deepEqual(t.room.info.players.map((p) => [p.name, p.online]), [["Ann", true], ["Bob", false]]);
  const b2 = browser(rooms);
  await rooms.message(b2.c, { t: "mpJoin", room: t.id, name: "Bob" });
  assert.ok(b2.lastAdv());
});

test("auto combat while arranging the troops (Tactics): the battle begins and plays out", async () => {
  const rooms = setup();
  const t = await twoPlayers(rooms);
  await fight(rooms, t, [[SKILLS.indexOf("tactics"), 3]]);
  assert.ok(t.a.lastBattle()!.tactics, "Red arranges its troops first");
  await rooms.message(t.a.c, { t: "game", msg: { t: "control", side: 0, controller: "ai" } });
  const b = t.b.lastBattle()!;
  assert.equal(b.tactics, undefined, "the battle began");
  assert.ok(b.winner !== null || b.sides[b.units.find((u) => u.id === b.active)?.side ?? 0].owner === 1, "it went on to Blue's move (or the end)");
});

/** The host's time run by hand: `advance` moves it on and fires what was waiting. */
function manualTime() {
  let now = 1_000_000;
  let waits: { at: number; fn: () => void }[] = [];
  return {
    now: () => now,
    after: (ms: number, fn: () => void) => {
      const w = { at: now + ms, fn };
      waits.push(w);
      return () => void (waits = waits.filter((x) => x !== w));
    },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = waits.filter((w) => w.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        waits = waits.filter((w) => w !== next);
        now = next.at;
        next.fn();
        // (What fired may answer asynchronously.)
        for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
      }
      now = end;
    },
  };
}

async function timedPlayers(clock: { base: number; turn: number; battle: number; unit: number } | null, goneMs = 60_000, mode: "sequential" | "simultaneous" = "sequential") {
  const time = manualTime();
  const rooms = new Rooms({ data, loadMap, code: () => `T${++codes}`, time, goneMs, seed: () => 7, rate: null });
  const a = browser(rooms);
  const b = browser(rooms);
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: MAP });
  const id = a.c.room!.info.id;
  await rooms.message(b.c, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(a.c, { t: "mpMode", turnMode: mode });
  await rooms.message(a.c, { t: "mpClock", clock });
  await rooms.message(a.c, { t: "mpStart" });
  const room = rooms.rooms.get(id)!;
  return { rooms, time, a, b, id, room, server: room.server! };
}

const clocks = (x: Browser) => x.inbox.flatMap((m) => (m.t === "mpClock" ? [m.seats] : []));

test("turn clock: a turn whose time is all gone (turn timer, then the base) ends by itself", async () => {
  const t = await timedPlayers({ base: 30, turn: 60, battle: 60, unit: 20 });
  const s = () => t.server.state!;
  assert.equal(s().current, 0);
  assert.equal(clocks(t.b).at(-1)![0].running, "turn", "everyone is told Red's clock runs");
  await t.time.advance(80_000);
  assert.equal(s().current, 0, "past the turn timer, the base still has time");
  await t.time.advance(11_000);
  assert.equal(s().current, 1, "Red's turn ended when the base ran out too");
  assert.equal(clocks(t.a).at(-1)![1].running, "turn", "Blue's clock runs now");
  // Blue ends the day itself: Red's turn timer starts afresh, its base stays spent.
  await t.rooms.message(t.b.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.equal(s().current, 0);
  const red = clocks(t.a).at(-1)![0];
  assert.deepEqual([red.turn, red.base, red.running], [60_000, 0, "turn"]);
});

test("turn clock: simultaneous turns run every player's clock at once", async () => {
  const t = await timedPlayers({ base: 0, turn: 60, battle: 60, unit: 20 }, 60_000, "simultaneous");
  const c = clocks(t.a).at(-1)!;
  assert.deepEqual([c[0].running, c[1].running], ["turn", "turn"]);
  const day = t.server.state!.day;
  await t.time.advance(61_000);
  assert.equal(t.server.state!.day, day + 1, "both turns ended, a new day began");
});

test("turn clock: in a battle the creature timer, then the battle's reserve; then the computer fights on", async () => {
  const t = await timedPlayers({ base: 10, turn: 600, battle: 30, unit: 20 });
  await fight(t.rooms, t);
  const b = () => t.server.state!.battles[0]?.battle;
  const up = () => {
    const st = b()!;
    return st.tactics?.side ?? activeUnit(st)!.side;
  };
  const side = up();
  const owner = b()!.sides[side].owner!;
  assert.equal(clocks(t.a).at(-1)![owner].running, "battle");
  await t.time.advance(19_000);
  assert.equal(b()!.sides[side].controller, "human", "within the creature timer");
  await t.time.advance(41_000 + 1000);
  assert.ok(!b() || b()!.sides[side].controller === "ai", "unit, battle and base gone: the computer took the side");
});

test("no clock: nothing runs, nothing is sent", async () => {
  const t = await timedPlayers(null);
  await t.time.advance(3_600_000 - 120_000);
  assert.equal(t.server.state!.current, 0);
  assert.equal(clocks(t.a).length, 0);
});

test("a player gone for good: the computer plays their colour, and gives it back when they return", async () => {
  const t = await timedPlayers(null, 60_000, "simultaneous");
  const s = () => t.server.state!;
  t.rooms.disconnect(t.b.c);
  await t.time.advance(59_000);
  assert.equal(s().players[1].controller, "human", "a short absence changes nothing");
  await t.time.advance(2_000);
  assert.equal(s().players[1].controller, "ai", "then the computer takes over");
  assert.deepEqual(t.room.info.away, [1]);
  assert.ok(t.a.inbox.some((m) => m.t === "mpChat" && m.lines.some((l) => !l.from && l.text.includes("Bob is gone"))), "Ann is told");
  // Ann ends the day: the computer plays Blue's, and the days go on without waiting for Bob.
  const day = s().day;
  await t.rooms.message(t.a.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.equal(s().day, day + 1);
  const view = t.a.lastAdv()!;
  assert.equal(view.players[1].resources.every((r) => r === 0), true, "Ann still only gets her own view");
  // Bob comes back.
  const b2 = browser(t.rooms);
  await t.rooms.message(b2.c, { t: "mpJoin", room: t.id, name: "Bob" });
  assert.equal(s().players[1].controller, "human");
  assert.deepEqual(t.room.info.away, []);
  assert.ok(b2.lastAdv(), "his view");
  assert.ok(b2.inbox.some((m) => m.t === "mpChat" && m.lines.some((l) => l.text.includes("back"))), "everyone is told he's back");
  await t.rooms.message(b2.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.deepEqual(b2.errors(), [], "and he plays again");
});

test("a reconnect within the wait keeps the colour human", async () => {
  const t = await timedPlayers(null);
  t.rooms.disconnect(t.b.c);
  await t.time.advance(30_000);
  const b2 = browser(t.rooms);
  await t.rooms.message(b2.c, { t: "mpJoin", room: t.id, name: "Bob" });
  await t.time.advance(120_000);
  assert.equal(t.server.state!.players[1].controller, "human");
});

test("room chat: everyone in the room hears it, a newcomer gets what was said, outsiders nothing", async () => {
  const rooms = setup();
  const a = browser(rooms);
  const b = browser(rooms);
  const out = browser(rooms);
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: MAP });
  const id = a.c.room!.info.id;
  await rooms.message(a.c, { t: "mpChat", text: "  hello <b>all</b>  " });
  await rooms.message(b.c, { t: "mpJoin", room: id, name: "Bob" });
  const said = (x: Browser) => x.inbox.flatMap((m) => (m.t === "mpChat" ? m.lines.map((l) => `${l.from}: ${l.text}`) : []));
  assert.deepEqual(said(b), ["Ann: hello <b>all</b>"], "the history on joining");
  await rooms.message(b.c, { t: "mpChat", text: "hi" });
  assert.deepEqual(said(a), ["Ann: hello <b>all</b>", "Bob: hi"]);
  await rooms.message(out.c, { t: "mpChat", text: "spam" });
  assert.equal(out.errors().length, 1);
  assert.equal(said(a).length, 2);
});

test("only the room's host sets the clock, before the start", async () => {
  const rooms = setup();
  const a = browser(rooms);
  const b = browser(rooms);
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: MAP });
  const id = a.c.room!.info.id;
  await rooms.message(b.c, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(b.c, { t: "mpClock", clock: { base: 1, turn: 1, battle: 1, unit: 1 } });
  assert.equal(rooms.rooms.get(id)!.info.clock, undefined);
  await rooms.message(a.c, { t: "mpClock", clock: { base: -5, turn: 1e9, battle: 60, unit: 20 } });
  assert.deepEqual(rooms.rooms.get(id)!.info.clock, { base: 0, turn: 86400, battle: 60, unit: 20 });
});

test("lobby: the room list, picking a town and bonus, and they reach the game", async () => {
  // (A map whose Red may choose among three towns; a random map's towns come with the map.)
  const rooms = new Rooms({
    data,
    code: () => `R${++codes}`,
    seed: () => 7,
    loadMap: async (f) => {
      const map = await loadMap(MAP);
      if (f === "picky") Object.assign(map.players[0], { randomFaction: true, allowedFactions: 0b111 });
      return map;
    },
  });
  const plain = browser(rooms);
  await rooms.message(plain.c, { t: "mpCreate", name: "Cid", map: MAP });
  assert.deepEqual(plain.c.room!.info.slots!.map((s) => s.factions.length), [0, 0], "a random map's towns are its own");
  const a = browser(rooms);
  const b = browser(rooms);
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: "picky" });
  const id = a.c.room!.info.id;
  await rooms.message(b.c, { t: "mpList" });
  const listed = b.inbox.flatMap((m) => (m.t === "mpRooms" ? m.rooms : []));
  assert.ok(listed.some((r) => r.id === id && !r.started && r.players[0].name === "Ann"), "the new room is listed");
  await rooms.message(b.c, { t: "mpJoin", room: id, name: "Bob" });
  const info = a.c.room!.info;
  const slot = info.slots!.find((s) => s.seat === 0)!;
  assert.deepEqual(slot.factions, ["castle", "rampart", "tower"]);
  const town = slot.factions[1];
  await rooms.message(a.c, { t: "mpPick", faction: town, bonus: "gold" });
  await rooms.message(a.c, { t: "mpPick", faction: "nowhere" });
  assert.match(a.errors().at(-1) ?? "", /can't be picked/);
  assert.deepEqual([info.players[0].faction, info.players[0].bonus], [town, "gold"]);
  await rooms.message(a.c, { t: "mpMode", turnMode: "simultaneous", simUntil: 1 });
  await rooms.message(a.c, { t: "mpStart" });
  const s = rooms.rooms.get(id)!.server!.state!;
  assert.equal(s.players[0].faction, town, "Red's town as picked");
  assert.equal(s.simultaneousUntil, 1);
  assert.equal(s.turnMode, "simultaneous");
  // Day 1 ends for both: simultaneous turns are over after day 1 even without contact.
  await rooms.message(a.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  await rooms.message(b.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.equal(s.day, 2);
  assert.equal(s.turnMode, "sequential");
});

test("simultaneous turns: allies' heroes meeting is no contact; rivals' is", () => {
  const hero = (owner: number, x: number) => ({ owner, x, y: 0, z: 0 });
  const s = { heroes: [hero(0, 0), hero(1, 2)], players: [{ team: 0 }, { team: 0 }, { team: 1 }], contactDistance: 12 } as unknown as AdventureState;
  assert.equal(playersInContact(s), false);
  s.heroes.push(hero(2, 5) as never);
  assert.equal(playersInContact(s), true);
});

test("rate limit: a flood is turned away (told once), a calm sender isn't; a sustained flood is marked for closing", async () => {
  const time = manualTime();
  const rooms = new Rooms({ data, loadMap, code: () => `F${++codes}`, time, seed: () => 7 });
  const a = browser(rooms);
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: MAP });
  for (let i = 0; i < RATE.burst + 50; i++) await rooms.message(a.c, { t: "mpList" });
  const listed = () => a.inbox.filter((m) => m.t === "mpRooms").length;
  assert.equal(listed(), RATE.burst - 1, "the burst (less the create), then nothing");
  assert.deepEqual(a.errors(), ["Too many messages at once: slow down."]);
  assert.equal(rooms.flooding(a.c), false);
  await time.advance(2000);
  await rooms.message(a.c, { t: "mpList" });
  assert.equal(listed(), RATE.burst, "allowed again after a pause");
  for (let i = 0; i < RATE.burst + FLOOD_CLOSE; i++) await rooms.message(a.c, { t: "mpList" });
  assert.equal(rooms.flooding(a.c), true);
});

test("malformed lobby messages are said back as such, the room untouched", async () => {
  const rooms = setup();
  const a = browser(rooms);
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: MAP });
  for (const m of [null, 7, "x", {}, { t: 5 }, { t: "mpJoin", room: 5, name: "x" }, { t: "mpCreate", name: "x".repeat(100), map: MAP }, { t: "mpSeat", seat: "1" }, { t: "game", msg: { t: "act", action: null } }, { t: "game", msg: { t: "control", side: 3, controller: "ai" } }])
    await rooms.message(a.c, m as never);
  assert.ok(a.errors().every((e) => e === "That message makes no sense to the host."), a.errors().join(" / "));
  assert.equal(a.errors().length, 10);
  assert.equal(a.c.room!.info.players.length, 1);
});

test("cheat codes are off in a multiplayer game", async () => {
  const rooms = setup();
  const t = await twoPlayers(rooms);
  const gold = t.server.state!.players[0].resources[6];
  await rooms.message(t.a.c, { t: "game", msg: { t: "advAct", action: { type: "cheat", code: "nwctheconstruct" } } });
  assert.equal(t.server.state!.players[0].resources[6], gold);
  assert.match(t.a.errors().at(-1) ?? "", /Cheats are off/);
});

test("rooms left behind are cleared: a waiting room after an hour, a finished game after a day, any after a month; not while anyone is in", async () => {
  const time = manualTime();
  const dir = mkdtempSync(join(tmpdir(), "rooms-"));
  const rooms = new Rooms({ data, loadMap, dir, code: () => `C${++codes}`, time, seed: () => 7, rate: null });
  const make = async (start: boolean) => {
    const a = browser(rooms);
    await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: MAP });
    const id = a.c.room!.info.id;
    if (start) {
      const b = browser(rooms);
      await rooms.message(b.c, { t: "mpJoin", room: id, name: "Bob" });
      await rooms.message(a.c, { t: "mpStart" });
      rooms.disconnect(b.c);
    }
    return { a, id };
  };
  const waiting = await make(false);
  const playing = await make(true);
  const finished = await make(true);
  const stays = await make(false);
  rooms.rooms.get(finished.id)!.server!.state!.winner = 0;
  for (const x of [waiting, playing, finished]) rooms.disconnect(x.a.c);
  await time.advance(KEEP_MS.waiting + 1);
  const ps = rooms.rooms.get(playing.id)!.server!.state!;
  assert.deepEqual([ps.day, ps.winner], [1, undefined], "an empty game waits: the computer doesn't play it out alone");
  assert.equal(rooms.sweep(), 1);
  assert.ok(!rooms.rooms.has(waiting.id) && rooms.rooms.has(stays.id), "the empty waiting room went, the one with Ann in it stays");
  assert.ok(!existsSync(join(dir, `${waiting.id}.json`)), "and its save");
  await time.advance(KEEP_MS.finished);
  assert.equal(rooms.sweep(), 1);
  assert.ok(!rooms.rooms.has(finished.id) && rooms.rooms.has(playing.id));
  await time.advance(KEEP_MS.any);
  assert.equal(rooms.sweep(), 1);
  assert.ok(!rooms.rooms.has(playing.id) && rooms.rooms.has(stays.id));
});

test("host restart mid-game: the saves carry the game on (days, turns, chat); a broken save file doesn't stop the others", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rooms-"));
  const first = setup(dir);
  const t = await twoPlayers(first);
  await first.message(t.a.c, { t: "mpChat", text: "see you after the restart" });
  for (const c of [t.a, t.b]) await first.message(c.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  const day = t.server.state!.day;
  assert.equal(day, 2);
  writeFileSync(join(dir, "BROKEN.json"), "{ not json");
  assert.ok(!readdirSync(dir).some((f) => f.endsWith(".tmp")), "no half-written saves left");
  const again = setup(dir);
  await again.restore();
  assert.ok(again.rooms.has(t.id) && !again.rooms.has("BROKEN"));
  const a = browser(again);
  const b = browser(again);
  await again.message(a.c, { t: "mpJoin", room: t.id, name: "Ann" });
  await again.message(b.c, { t: "mpJoin", room: t.id, name: "Bob" });
  assert.equal(a.lastAdv()!.day, 2);
  assert.ok(a.inbox.some((m) => m.t === "mpChat" && m.lines.some((l) => l.text === "see you after the restart")));
  for (const c of [a, b]) await again.message(c.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.equal(again.rooms.get(t.id)!.server!.state!.day, 3, "the game goes on");
  assert.deepEqual([...a.errors(), ...b.errors()], []);
});

test("many rooms at once: 40 games played side by side stay apart", async () => {
  const rooms = setup();
  const games = [];
  for (let i = 0; i < 40; i++) games.push(await twoPlayers(rooms));
  const t0 = Date.now();
  for (let d = 0; d < 3; d++)
    await Promise.all(games.map(async (g) => {
      for (const c of [g.a, g.b]) await rooms.message(c.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
    }));
  const ms = Date.now() - t0;
  for (const g of games) {
    assert.equal(g.server.state!.day, 4);
    assert.deepEqual([...g.a.errors(), ...g.b.errors()], []);
    // Each browser only ever heard its own room.
    assert.ok(g.a.game().every((m) => m.t !== "adv" || m.state.mapFile === MAP));
  }
  assert.equal(new Set(games.map((g) => g.server)).size, 40);
  console.log(`40 rooms x 3 days: ${ms} ms`);
});

test("everyone gone: the game and its clock wait; back, the clock goes on and the one still away is waited for", async () => {
  const t = await timedPlayers({ base: 30, turn: 60, battle: 60, unit: 20 }, 60_000);
  const day = t.server.state!.day;
  t.rooms.disconnect(t.a.c);
  t.rooms.disconnect(t.b.c);
  await t.time.advance(3600_000);
  assert.equal(t.server.state!.day, day, "no turns ended by the clock, no computer playing");
  assert.deepEqual(t.server.state!.players.slice(0, 2).map((p) => p.controller), ["human", "human"]);
  const a2 = browser(t.rooms);
  await t.rooms.message(a2.c, { t: "mpJoin", room: t.id, name: "Ann" });
  await t.time.advance(61_000);
  assert.equal(t.server.state!.players[1].controller, "ai", "Bob, still away with Ann waiting, is played by the computer");
  assert.equal(t.server.state!.players[0].controller, "human");
});

test("played by notification: an absent friend's turn waits for them and they're told once; any device of theirs takes their seat", async () => {
  const time = manualTime();
  const notes: { key: string; title: string; url: string }[] = [];
  const rooms = new Rooms({ data, loadMap, code: () => `N${++codes}`, time, goneMs: 60_000, seed: () => 7, rate: null, notify: (key, n) => notes.push({ key, ...n }) });
  const as = (key: string, name: string) => {
    const b = browser(rooms);
    b.c.who = { key, name };
    return b;
  };
  const ann = as("k-ann", "Ann");
  const bob = as("k-bob", "Bob");
  await rooms.message(ann.c, { t: "mpCreate", name: "typed", map: MAP });
  const id = ann.c.room!.info.id;
  // Nobody takes Ann's seat by typing her name.
  const stranger = browser(rooms);
  await rooms.message(stranger.c, { t: "mpJoin", room: id, name: "Ann" });
  assert.match(stranger.errors().at(-1) ?? "", /someone else's/);
  await rooms.message(bob.c, { t: "mpJoin", room: id, name: "whatever" });
  assert.deepEqual(ann.c.room!.info.players.map((p) => [p.name, p.key]), [["Ann", "k-ann"], ["Bob", "k-bob"]]);
  await rooms.message(ann.c, { t: "mpMode", turnMode: "sequential", async: true });
  await rooms.message(ann.c, { t: "mpStart" });
  const room = rooms.rooms.get(id)!;
  const s = room.server!.state!;
  assert.equal(s.current, 0);
  assert.equal(notes.length, 0, "Ann is here for her first turn");
  rooms.disconnect(bob.c);
  await time.advance(10 * 60_000);
  assert.equal(s.players[1].controller, "human", "Bob's colour waits for him, no computer");
  await rooms.message(ann.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.equal(s.current, 1);
  assert.deepEqual(notes.map((n) => [n.key, n.url]), [["k-bob", `/#map?room=${id}`]], "Bob is told it's his turn");
  await rooms.message(ann.c, { t: "mpChat", text: "your move" });
  assert.equal(notes.length, 1, "once");
  // "My games" on Bob's phone: his turn there.
  const phone = as("k-bob", "Bob");
  await rooms.message(phone.c, { t: "mpMine" });
  const mine = phone.inbox.flatMap((m) => (m.t === "mpMine" ? m.games : []));
  assert.deepEqual(mine.map((g) => [g.room.id, g.seat, g.myTurn]), [[id, 1, true]]);
  assert.equal(mine[0].summary?.color, 1, "the game at a glance is of his colour");
  assert.ok(mine[0].summary?.hero, "with his strongest hero");
  await rooms.message(phone.c, { t: "mpJoin", room: id, name: "typed on the phone" });
  assert.equal(phone.lastAdv()?.current, 1, "his game, his seat");
  rooms.disconnect(ann.c);
  await rooms.message(phone.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.equal(s.day, 2);
  assert.deepEqual(notes.at(-1)?.key, "k-ann", "and Ann is told when it comes back to her");
  assert.deepEqual(phone.errors(), []);
});

test("played by notification: the host away is told when a friend joins, and the first turn's note says the game has begun", async () => {
  const notes: { key: string; title: string; body: string }[] = [];
  const rooms = new Rooms({ data, loadMap, code: () => `J${++codes}`, seed: () => 7, rate: null, notify: (key, n) => notes.push({ key, ...n }) });
  const as = (key: string, name: string) => {
    const b = browser(rooms);
    b.c.who = { key, name };
    return b;
  };
  const ann = as("k-ann", "Ann");
  await rooms.message(ann.c, { t: "mpCreate", name: "Ann", map: MAP });
  const id = ann.c.room!.info.id;
  await rooms.message(ann.c, { t: "mpMode", turnMode: "simultaneous", async: true });
  await rooms.disconnect(ann.c);
  const bob = as("k-bob", "Bob");
  await rooms.message(bob.c, { t: "mpJoin", room: id, name: "Bob" });
  assert.deepEqual(notes.map((n) => [n.key, n.title]), [["k-ann", "Bob has joined your game"]]);
  // Ann back from the notification starts; Bob has gone meanwhile.
  await rooms.disconnect(bob.c);
  const ann2 = as("k-ann", "Ann");
  await rooms.message(ann2.c, { t: "mpJoin", room: id, name: "Ann" });
  assert.equal(notes.length, 1, "nobody is told of their own coming back");
  await rooms.message(ann2.c, { t: "mpStart" });
  assert.deepEqual(notes.slice(1).map((n) => [n.key, n.title, n.body]), [["k-bob", "Your turn: day 1", `The game has begun. Your move in game ${id}.`]]);
});

test("played by notification: a battle against someone away is fought for them by the computer; they're told, and get it in their recap", async () => {
  const notes: { key: string; title: string; body: string }[] = [];
  const rooms = new Rooms({ data, loadMap, code: () => `B${++codes}`, seed: () => 7, rate: null, notify: (key, n) => notes.push({ key, ...n }) });
  const a = browser(rooms);
  const b = browser(rooms);
  a.c.who = { key: "k-ann", name: "Ann" };
  b.c.who = { key: "k-bob", name: "Bob" };
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: MAP });
  const id = a.c.room!.info.id;
  await rooms.message(b.c, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(a.c, { t: "mpMode", turnMode: "sequential", async: true });
  await rooms.message(a.c, { t: "mpStart" });
  rooms.disconnect(b.c);
  const server = rooms.rooms.get(id)!.server!;
  // (Bob holds: losing his only town and hero would end the game for him.)
  await fight(rooms, { a, b, id, room: rooms.rooms.get(id)!, server }, undefined, [1, 200]).catch(() => {});
  const battle = a.lastBattle()!;
  assert.ok(battle, "the battle began");
  assert.equal(battle.sides[1].controller, "ai", "Bob's side is fought by the computer");
  // Ann plays hers to the end.
  for (let turn = 0; turn < 400; turn++) {
    const st = a.lastBattle()!;
    if (st.winner !== null) break;
    if (st.tactics) await rooms.message(a.c, { t: "game", msg: { t: "act", action: { type: "tacticsDone", unit: st.units.find((u) => u.side === st.tactics!.side)!.id } } });
    else await rooms.message(a.c, { t: "game", msg: { t: "act", action: chooseAction(st) } });
  }
  assert.notEqual(a.lastBattle()!.winner, null);
  const told = notes.filter((n) => n.key === "k-bob");
  assert.equal(told.length, 1, "Bob hears of the attack at once");
  assert.equal(told[0].title, "You were attacked");
  assert.match(told[0].body, /^Day 1: .+ \(Ann\) attacked your town .+ and was beaten\. Lost: Ann .+; Bob .+\. Game B\d+\.$/);
  // Ann's turn ends: Bob's turn, said once (the attack already was).
  await rooms.message(a.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.deepEqual(notes.filter((n) => n.key === "k-bob").map((n) => n.title), ["You were attacked", "Your turn: day 1"]);
  // Bob back: the recap has the battle; a second visit has nothing new.
  const back = browser(rooms);
  back.c.who = { key: "k-bob", name: "Bob" };
  await rooms.message(back.c, { t: "mpJoin", room: id, name: "Bob" });
  const recap = back.inbox.flatMap((m) => (m.t === "mpRecap" ? m.reports : []));
  assert.deepEqual(recap.map((r) => [r.kind, r.kind === "battle" && r.attacker, r.kind === "battle" && r.defender]), [["battle", 0, 1]]);
  rooms.disconnect(back.c);
  const again = browser(rooms);
  again.c.who = { key: "k-bob", name: "Bob" };
  await rooms.message(again.c, { t: "mpJoin", room: id, name: "Bob" });
  assert.equal(again.inbox.filter((m) => m.t === "mpRecap").length, 0);
});

test("played by notification: the one away can watch again what they could see (fog applied), once", async () => {
  const rooms = setup();
  const a = browser(rooms);
  const b = browser(rooms);
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: MAP });
  const id = a.c.room!.info.id;
  await rooms.message(b.c, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(a.c, { t: "mpMode", turnMode: "sequential", async: true });
  await rooms.message(a.c, { t: "mpStart" });
  rooms.disconnect(b.c);
  const room = rooms.rooms.get(id)!;
  const s = room.server!.state!;
  const w = (room.server as unknown as { adv: { world: World } }).adv.world;
  const n = s.size;
  const ha = s.heroes.find((h) => h.owner === 0 && !h.removed)!;
  // Bob has explored only the left half of the map.
  const half = Math.floor(n / 2);
  const seen = (i: number) => i % n < half;
  s.players[1].revealed = Array(Math.ceil((n * n * 2) / 32)).fill(0);
  for (let i = 0; i < n * n; i++) if (seen(i)) s.players[1].revealed[i >> 5] |= 1 << (i & 31);
  // Ann walks from the right half into the left: Bob gets the stretch in his sight.
  const row = (ha.z * n + ha.y) * n;
  const path = [3, 2, 1, 0, -1, -2, -3].map((d) => row + half + d - 1);
  const steps = replaySteps(s, w, 1, [{ e: "move", hero: ha.id, path }]);
  assert.deepEqual(steps.map((st) => st.k === "move" && st.path), [path.filter(seen)]);
  assert.equal(steps[0].k === "move" && steps[0].hero.owner, 0);
  assert.deepEqual(replaySteps(s, w, 1, [{ e: "move", hero: ha.id, path: path.slice(0, 3) }]), [], "a walk in the dark isn't kept");
  assert.deepEqual(replaySteps(s, w, 0, [{ e: "move", hero: ha.id, path }]), [], "nor one's own");
  // A flag changing hands where Bob can see, and where he can't.
  const flagged = s.objects.filter((o) => o && !o.removed && o.owner < 0 && (o.town || o.type === 53));
  const mine = flagged.find((o) => o.x < half - 1);
  const dark = flagged.find((o) => o.x > half + 3);
  const owners = flagOwners(s);
  if (mine) mine.owner = 0;
  if (dark) dark.owner = 0;
  const flags = replaySteps(s, w, 1, [], owners);
  assert.deepEqual(flags, mine ? [{ k: "flag", day: s.day, object: mine.id, owner: 0, from: -1 }] : []);
  // The host keeps them for Bob while he's away (not for Ann, here), and hands them over once.
  record(room, s, w, [{ e: "move", hero: ha.id, path }]);
  assert.equal(room.replays?.[0], undefined);
  const kept = room.replays?.[1] ?? [];
  assert.ok(kept.some((st) => st.k === "move"));
  const back = browser(rooms);
  await rooms.message(back.c, { t: "mpJoin", room: id, name: "Bob" });
  assert.deepEqual(back.inbox.flatMap((m) => (m.t === "mpRecap" ? (m.replay ?? []) : [])), kept);
  rooms.disconnect(back.c);
  const again = browser(rooms);
  await rooms.message(again.c, { t: "mpJoin", room: id, name: "Bob" });
  assert.equal(again.inbox.filter((m) => m.t === "mpRecap").length, 0, "nothing new: no recap");
});

test("a random map is kept with its game: a later generator's different map doesn't replace it after a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rooms-"));
  const first = setup(dir);
  const t = await twoPlayers(first);
  const objects = t.server.state!.objects.length;
  // The next version of the generator makes another map from the same name.
  let generated = 0;
  const later = new Rooms({ data, dir, code: () => `L${++codes}`, seed: () => 7, rate: null, loadMap: async () => (generated++, loadMap("random:36:2:2:1:9")) });
  await later.restore();
  const b = browser(later);
  await later.message(b.c, { t: "mpJoin", room: t.id, name: "Bob" });
  assert.equal(later.rooms.get(t.id)!.server!.state!.objects.length, objects);
  assert.equal(generated, 0, "the kept map, not a new one");
  for (const c of [b]) await later.message(c.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.deepEqual(b.errors().filter((e) => !/not your turn/.test(e)), []);
});

test("friends allied: the players are one team, the computer players apart, whatever the map's teams", async () => {
  const rooms = setup();
  const a = browser(rooms);
  const b = browser(rooms);
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: "random:36:3:2:1:5:a" });
  const id = a.c.room!.info.id;
  await rooms.message(b.c, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(a.c, { t: "mpMode", turnMode: "simultaneous", async: true, allied: true });
  await rooms.message(a.c, { t: "mpStart" });
  const s = rooms.rooms.get(id)!.server!.state!;
  assert.equal(s.players[0].team, s.players[1].team);
  assert.notEqual(s.players[0].team, undefined);
  assert.notEqual(s.players[2].team, s.players[0].team, "the computer isn't on the friends' team");
  assert.ok(s.conditions?.contested ?? true);
});

test("following allies: where a friend looks reaches their allies only, and their battles reach the allies following", async () => {
  const rooms = setup();
  const a = browser(rooms);
  const b = browser(rooms);
  await rooms.message(a.c, { t: "mpCreate", name: "Ann", map: "random:36:3:2:1:5:a" });
  const id = a.c.room!.info.id;
  await rooms.message(b.c, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(a.c, { t: "mpMode", turnMode: "simultaneous", allied: true });
  await rooms.message(a.c, { t: "mpStart" });
  const s = rooms.rooms.get(id)!.server!.state!;
  const town = s.objects.find((o) => o.town && o.owner === 0)!;
  await rooms.message(a.c, { t: "mpLook", look: { k: "town", object: town.id } });
  const looks = (x: Browser) => x.inbox.flatMap((m) => (m.t === "mpLook" ? [m] : []));
  assert.deepEqual(looks(b).at(-1), { t: "mpLook", seat: 0, look: { k: "town", object: town.id } });
  assert.equal(looks(a).length, 0, "not told back to the one looking");
  // The same look again isn't sent again (it's light: only changes go out).
  await rooms.message(a.c, { t: "mpLook", look: { k: "town", object: town.id } });
  assert.equal(looks(b).length, 1);
  // Joining later (another device): told where the allies look.
  const b2 = browser(rooms);
  await rooms.message(b2.c, { t: "mpJoin", room: id, name: "Bob" });
  assert.deepEqual(looks(b2).at(-1)?.look, { k: "town", object: town.id });
  // Ann's hero attacks the computer's: Bob, following, gets the battle to watch; not before he follows.
  await rooms.message(b.c, { t: "mpFollow", on: true });
  const ha = s.heroes.find((h) => h.owner === 0 && !h.removed)!;
  const hc = s.heroes.find((h) => h.owner === 2 && !h.removed)!;
  [ha.x, ha.y, ha.z] = [hc.x + 1, hc.y, hc.z];
  ha.movement = 2000;
  await rooms.message(a.c, { t: "game", msg: { t: "advAct", action: { type: "move", hero: ha.id, to: (hc.z * s.size + hc.y) * s.size + hc.x } } });
  assert.ok(a.lastBattle(), "Ann fights");
  const watched = b.inbox.flatMap((m) => (m.t === "mpWatch" ? [m] : []));
  assert.ok(watched.length > 0, "Bob, following, watches it");
  assert.equal(watched[0].seat, 0);
  assert.equal(b2.inbox.filter((m) => m.t === "mpWatch").length, 0, "Bob's other device isn't following: nothing sent there");
  // Ann leaves: her allies stop following her into the town.
  await rooms.message(a.c, { t: "mpLeave" });
  assert.deepEqual(looks(b).at(-1)?.look, { k: "map" });
});

test("following allies: a rival never learns where the other looks", async () => {
  const rooms = setup();
  const t = await twoPlayers(rooms);
  await rooms.message(t.a.c, { t: "mpLook", look: { k: "battle" } });
  await rooms.message(t.b.c, { t: "mpFollow", on: true });
  assert.equal(t.b.inbox.filter((m) => m.t === "mpLook").length, 0);
  await rooms.message(t.a.c, { t: "mpLook", look: { k: "nonsense" } as never });
  assert.ok(t.a.errors().some((e) => /makes no sense/.test(e)));
});

test("played by notification: a page out of sight (another tab, the phone locked) is told of its turn; one in sight isn't", async () => {
  const notes: { key: string; title: string }[] = [];
  const rooms = new Rooms({ data, loadMap, code: () => `H${++codes}`, seed: () => 7, rate: null, notify: (key, n) => notes.push({ key, ...n }) });
  const as = (key: string, name: string) => {
    const b = browser(rooms);
    b.c.who = { key, name };
    return b;
  };
  const ann = as("k-ann", "Ann");
  const bob = as("k-bob", "Bob");
  await rooms.message(ann.c, { t: "mpCreate", name: "Ann", map: MAP });
  const id = ann.c.room!.info.id;
  await rooms.message(bob.c, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(ann.c, { t: "mpMode", turnMode: "simultaneous", async: true });
  await rooms.message(ann.c, { t: "mpStart" });
  assert.equal(notes.length, 0, "both here and looking on day 1");
  const s = rooms.rooms.get(id)!.server!.state!;
  // Ann ends her day and switches to another tab; Bob ends his: day 2 comes.
  await rooms.message(ann.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  await rooms.message(ann.c, { t: "mpHidden", hidden: true });
  await rooms.message(bob.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.equal(s.day, 2);
  assert.deepEqual(notes.map((n) => [n.key, n.title]), [["k-ann", "Your turn: day 2"]], "Ann, out of sight, is told; Bob, looking, isn't");
  await rooms.message(ann.c, { t: "mpHidden", hidden: false });
  assert.equal(notes.length, 1, "coming back isn't news");
  assert.deepEqual(ann.errors(), []);
});

test("a room that is gone is said with a code the page acts on, not only in English words", async () => {
  const rooms = new Rooms({ data, loadMap, code: () => `G${++codes}`, seed: () => 7, rate: null });
  const b = browser(rooms);
  await rooms.message(b.c, { t: "mpJoin", room: "NOPE1", name: "Ann" });
  assert.deepEqual(b.inbox.filter((m) => m.t === "mpError").map((m) => m.t === "mpError" && m.code), ["noRoom"]);
});

test("the host's own lines: chat as a key the page says in its language, pings in the language the player's page speaks", async () => {
  const notes: { key: string; title: string; body: string }[] = [];
  const rooms = new Rooms({ data, loadMap, code: () => `W${++codes}`, seed: () => 7, rate: null, notify: (key, n) => notes.push({ key, ...n }) });
  const as = (key: string, name: string) => {
    const b = browser(rooms);
    b.c.who = { key, name };
    return b;
  };
  const ann = as("k-ann", "Ann");
  const bob = as("k-bob", "Bob");
  await rooms.message(bob.c, { t: "mpLang", lang: "pl" });
  await rooms.message(ann.c, { t: "mpCreate", name: "Ann", map: MAP });
  const id = ann.c.room!.info.id;
  await rooms.message(bob.c, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(ann.c, { t: "mpMode", turnMode: "simultaneous", async: true });
  await rooms.message(ann.c, { t: "mpStart" });
  await rooms.message(bob.c, { t: "mpVacation", until: Date.now() + 86400_000 });
  const line = ann.inbox.flatMap((m) => (m.t === "mpChat" ? m.lines : [])).at(-1)!;
  assert.equal(line.key, "%1 is on vacation until %2: the caretaker plays %3's turns meanwhile.");
  assert.deepEqual(line.args?.[2], { colour: 1 });
  assert.match(line.text, /^Bob is on vacation until .*: the caretaker plays Blue's turns meanwhile\.$/, "and in English for a page that can't read keys");
  await rooms.message(bob.c, { t: "mpVacation", until: null });
  await rooms.message(bob.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  await rooms.message(bob.c, { t: "mpHidden", hidden: true });
  await rooms.message(ann.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.deepEqual(notes.filter((n) => n.key === "k-bob").map((n) => n.title).at(-1), `Twoja tura: dzień ${rooms.rooms.get(id)!.server!.state!.day}`, "Bob's page speaks Polish");
  assert.match(notes.filter((n) => n.key === "k-bob").at(-1)!.body, /Twój ruch w grze/);
  assert.deepEqual([...ann.errors(), ...bob.errors()], []);
});
