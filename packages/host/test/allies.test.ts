// Absent friends in a game played by notification: an allied computer colour, the soft turn
// deadline with its caretaker, vacations, and taking a seat back (or over) at any time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGameData, generateRandomMap, parseRandomMapName } from "@heroes/core";
import { fakeRes } from "../../../tools/shots/fake.ts";
import type { HostServerMessage } from "../src/protocol.ts";
import { Rooms } from "../src/rooms.ts";

const FILES = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData(Object.fromEntries(FILES.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof FILES)[number], Uint8Array>);
const loadMap = async (file: string) => generateRandomMap(data, parseRandomMapName(file)!);
/** Three colours, two humans, one computer. */
const MAP = "random:36:3:2:1:5";
const HOUR = 3600_000;

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
        for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
      }
      now = end;
    },
  };
}

let codes = 0;
async function friends(opts: { deadline?: number; ally?: boolean } = {}) {
  const time = manualTime();
  const notes: { key: string; title: string; body: string }[] = [];
  const rooms = new Rooms({ data, loadMap, code: () => `A${++codes}`, time, seed: () => 7, rate: null, notify: (key, n) => notes.push({ key, ...n }) });
  const as = (key: string, name: string) => {
    const inbox: HostServerMessage[] = [];
    const c = rooms.connect((m) => inbox.push(structuredClone(m)), { key, name });
    return { c, inbox, errors: () => inbox.flatMap((m) => (m.t === "mpError" ? [m.message] : [])) };
  };
  const ann = as("k-ann", "Ann");
  const bob = as("k-bob", "Bob");
  await rooms.message(ann.c, { t: "mpCreate", name: "Ann", map: MAP });
  const id = ann.c.room!.info.id;
  await rooms.message(bob.c, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(ann.c, { t: "mpMode", turnMode: "simultaneous", async: true, allied: true, ...(opts.deadline ? { deadline: opts.deadline } : {}) });
  const room = rooms.rooms.get(id)!;
  if (opts.ally) {
    const free = room.info.slots!.find((x) => !room.info.players.some((p) => p.seat === x.seat))!.seat;
    await rooms.message(ann.c, { t: "mpAlly", seat: free, ally: true });
  }
  await rooms.message(ann.c, { t: "mpStart" });
  return { rooms, time, notes, as, ann, bob, id, room, s: room.server!.state! };
}

const chat = (room: { chat?: { text: string }[] }) => (room.chat ?? []).map((l) => l.text).join("\n");

test("an allied computer colour: on the friends' team, and a friend joining later takes it over", async () => {
  const t = await friends({ ally: true });
  const ally = t.room.info.allies![0];
  assert.equal(t.s.players[ally].controller, "ai");
  assert.equal(t.s.players[ally].team, t.s.players[0].team, "the ally is on the friends' team");
  assert.equal(t.s.players[0].team, t.s.players[1].team);
  // (A random map of three: no other computer here, so none against them; the map's rule decides the rest.)
  const cat = t.as("k-cat", "Cat");
  await t.rooms.message(cat.c, { t: "mpJoin", room: t.id, name: "Cat" });
  assert.deepEqual(cat.errors(), []);
  assert.equal(t.room.info.players.find((p) => p.name === "Cat")?.seat, ally, "Cat plays the ally's colour");
  assert.equal(t.s.players[ally].controller, "human");
  assert.equal(t.room.info.allies, undefined);
  assert.match(chat(t.room), /Cat joins and takes over/);
  // Nothing left to take over: closed.
  const dan = t.as("k-dan", "Dan");
  await t.rooms.message(dan.c, { t: "mpJoin", room: t.id, name: "Dan" });
  assert.match(dan.errors().at(-1) ?? "", /already started/);
});

test("an ally's colour only before the start, by the host, and never a friend's", async () => {
  const time = manualTime();
  const rooms = new Rooms({ data, loadMap, code: () => `Z${++codes}`, time, seed: () => 7, rate: null });
  const ann = rooms.connect(() => {}, { key: "k-ann", name: "Ann" });
  const inbox: HostServerMessage[] = [];
  const bob = rooms.connect((m) => inbox.push(m), { key: "k-bob", name: "Bob" });
  await rooms.message(ann, { t: "mpCreate", name: "Ann", map: MAP });
  const id = ann.room!.info.id;
  await rooms.message(bob, { t: "mpJoin", room: id, name: "Bob" });
  const info = ann.room!.info;
  await rooms.message(ann, { t: "mpAlly", seat: 1, ally: true });
  assert.equal(info.allies, undefined, "Bob's colour is his");
  await rooms.message(bob, { t: "mpAlly", seat: 2, ally: true });
  assert.equal(info.allies, undefined, "only the host");
  await rooms.message(ann, { t: "mpAlly", seat: 2, ally: true });
  assert.deepEqual(info.allies, [2]);
  assert.equal(info.allied, true, "an ally makes the friends one team");
  await rooms.message(ann, { t: "mpAlly", seat: 2, ally: false });
  assert.equal(info.allies, undefined);
});

test("soft deadline: a friend away past it, the others done, gets a cautious caretaker turn, a notification and a recap line", async () => {
  const t = await friends({ deadline: 12 });
  const day = t.s.day;
  await t.rooms.disconnect(t.bob.c);
  await t.time.advance(HOUR);
  await t.rooms.message(t.ann.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.equal(t.s.day, day, "Bob's deadline isn't up yet: it waits for him");
  await t.time.advance(10 * HOUR);
  assert.equal(t.s.day, day);
  await t.time.advance(2 * HOUR);
  assert.equal(t.s.day, day + 1, "past the deadline the caretaker played Bob's day, and the next came");
  assert.equal(t.s.players[1].controller, "human", "the colour stays Bob's");
  const told = t.notes.filter((n) => n.key === "k-bob");
  assert.ok(told.some((n) => /played for you/.test(n.title) && /caretaker played your turn/.test(n.body)), `Bob is told: ${JSON.stringify(told)}`);
  assert.match(chat(t.room), /Bob is away: the caretaker played/);
  // Back: the recap says what was done for him.
  const bob = t.as("k-bob", "Bob");
  await t.rooms.message(bob.c, { t: "mpJoin", room: t.id, name: "Bob" });
  const recap = bob.inbox.flatMap((m) => (m.t === "mpRecap" ? m.reports : []));
  assert.ok(recap.some((r) => r.kind === "caretaker" && r.seat === 1), "the recap has the caretaker's line");
  // Here, he's never covered: Ann ends the day, the deadline passes, his turn waits.
  await t.rooms.message(t.ann.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  await t.time.advance(30 * HOUR);
  assert.equal(t.s.day, day + 1);
});

test("soft deadline: friends all away, nobody's turn is covered (the game waits, it doesn't race on alone)", async () => {
  const t = await friends({ deadline: 12 });
  const day = t.s.day;
  await t.rooms.disconnect(t.bob.c);
  await t.rooms.disconnect(t.ann.c);
  await t.time.advance(48 * HOUR);
  assert.equal(t.s.day, day);
});

test("vacation: the caretaker plays the friend's turns until the date, at once; playing again ends it early", async () => {
  const t = await friends();
  const day = t.s.day;
  await t.rooms.message(t.bob.c, { t: "mpVacation", until: t.time.now() + 5 * 24 * HOUR });
  assert.ok(t.room.info.vacation?.[1]);
  await t.rooms.disconnect(t.bob.c);
  await t.rooms.message(t.ann.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.equal(t.s.day, day + 1, "no deadline needed: Bob's day was played at once");
  await t.rooms.message(t.ann.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  assert.equal(t.s.day, day + 2);
  // Ann goes on vacation too: friends all away, it waits (it doesn't race on alone).
  await t.rooms.message(t.ann.c, { t: "mpVacation", until: t.time.now() + 5 * 24 * HOUR });
  await t.rooms.disconnect(t.ann.c);
  await t.time.advance(HOUR);
  assert.equal(t.s.day, day + 2);
  // Bob back early: he plays, the vacation is over.
  const bob = t.as("k-bob", "Bob");
  await t.rooms.message(bob.c, { t: "mpJoin", room: t.id, name: "Bob" });
  const h = t.s.heroes.find((x) => x.owner === 1 && !x.removed)!;
  await t.rooms.message(bob.c, { t: "game", msg: { t: "advAct", action: { type: "sleep", hero: h.id, asleep: true } } });
  assert.equal(t.room.info.vacation?.[1], undefined);
  assert.match(chat(t.room), /Bob is back from vacation/);
  // A vacation past its date is over by itself.
  await t.rooms.message(bob.c, { t: "mpVacation", until: t.time.now() + HOUR });
  await t.time.advance(2 * HOUR);
  await t.rooms.message(bob.c, { t: "mpVacation", until: null });
  assert.equal(t.room.info.vacation?.[1], undefined);
});

test("the caretaker never fights, builds or wanders off: it picks up, recruits and ends the turn", async () => {
  const t = await friends({ deadline: 1 });
  const s = t.s;
  const town = s.objects.find((o) => o.town && o.owner === 1)!;
  const built = [...town.town!.built];
  const gold = s.players[1].resources[6];
  s.players[1].resources[6] = gold + 20000;
  await t.rooms.disconnect(t.bob.c);
  await t.rooms.message(t.ann.c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
  await t.time.advance(2 * HOUR);
  const r = t.room.journal!.map((j) => j.r).find((x) => x.kind === "caretaker");
  assert.ok(r && r.kind === "caretaker");
  assert.deepEqual(town.town!.built, built, "nothing built");
  assert.ok(!t.room.journal!.some((j) => j.r.kind === "battle"), "no battles");
  assert.ok(r.recruited.length > 0, `recruited: ${JSON.stringify(r)}`);
});

test("game rules: the host's choice before the start (only HotA's rules, only turned off) goes into the game", async () => {
  const time = manualTime();
  const rooms = new Rooms({ data, loadMap, code: () => `R${++codes}`, time, seed: () => 7, rate: null });
  const ann = rooms.connect(() => {}, { key: "k-ann", name: "Ann" });
  const bob = rooms.connect(() => {}, { key: "k-bob", name: "Bob" });
  await rooms.message(ann, { t: "mpCreate", name: "Ann", map: MAP });
  const id = ann.room!.info.id;
  await rooms.message(bob, { t: "mpJoin", room: id, name: "Bob" });
  const info = ann.room!.info;
  await rooms.message(bob, { t: "mpMode", turnMode: "simultaneous", noHota: true });
  assert.equal(info.noHota, undefined, "only the host sets them");
  await rooms.message(ann, { t: "mpMode", turnMode: "simultaneous", noHota: true, rules: { dwellingStock: false, bogus: false } as never });
  assert.equal(info.noHota, true);
  assert.deepEqual(info.rules, { dwellingStock: false });
  await rooms.message(ann, { t: "mpStart" });
  const s = rooms.rooms.get(id)!.server!.state!;
  assert.equal(s.noHota, true);
  assert.deepEqual(s.rules, { dwellingStock: false });
});
