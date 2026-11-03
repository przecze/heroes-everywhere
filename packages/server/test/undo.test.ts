// Undo in battle (EXTRAS battleUndo): the battle back to just before the last human decision; in a battle between
// two humans the other one agrees first.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type BattleState, activeUnit, battleFor, buildGameData, chooseAction } from "@heroes/core";
import { GameServer, type ServerMessage } from "../src/index.ts";

async function fakeData() {
  const { fakeRes } = await import("../../../tools/shots/fake.ts");
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
  return buildGameData(Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof files)[number], Uint8Array>);
}

type Update = Extract<ServerMessage, { t: "update" }>;
const lastUpdate = (inbox: { msg: ServerMessage; to?: number }[], to?: number) =>
  [...inbox].reverse().find((m) => m.msg.t === "update" && (to === undefined || m.to === to))!.msg as Update;
/** The state without what's only bookkeeping of the rules' search (the same battle). */
const same = (a: BattleState, b: BattleState) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

test("a quick battle: undo goes back to before the last move, again and again, and stops at the start", async () => {
  const data = await fakeData();
  const inbox: { msg: ServerMessage; to?: number }[] = [];
  const server = new GameServer(data, async () => {
    throw new Error("no maps");
  }, (msg, to) => inbox.push({ msg, to }));
  const stacks = [{ creature: 0, count: 20 }, { creature: 2, count: 10 }];
  await server.handle({ t: "start", setup: { seed: 7, sides: [{ name: "A", controller: "human", stacks }, { name: "B", controller: "ai", stacks }] } });
  const start = lastUpdate(inbox);
  assert.equal(start.undo, undefined, "nothing to undo before the first move");
  const states: BattleState[] = [];
  for (let i = 0; i < 3; i++) {
    const st = lastUpdate(inbox).state;
    if (st.winner !== null) break;
    states.push(st);
    await server.handle({ t: "act", action: chooseAction(st) });
    assert.ok(lastUpdate(inbox).undo, "the move can be taken back");
  }
  assert.ok(states.length >= 2, "played a few moves");
  // Back one move at a time, each time exactly where the human was asked to decide.
  for (const st of states.reverse()) {
    await server.handle({ t: "battleUndo" });
    const u = lastUpdate(inbox);
    assert.equal(u.rewound, true);
    same(u.state, st);
  }
  assert.equal(lastUpdate(inbox).undo, undefined, "back at the start: nothing more to undo");
  const before = inbox.length;
  await server.handle({ t: "battleUndo" });
  assert.ok(inbox.slice(before).some((m) => m.msg.t === "error"), "a refusal when there's nothing to undo");
  // The same move again plays out the same (the dice are in the state).
  const st = lastUpdate(inbox).state;
  await server.handle({ t: "act", action: chooseAction(st) });
  const again = lastUpdate(inbox).state;
  await server.handle({ t: "battleUndo" });
  await server.handle({ t: "act", action: chooseAction(st) });
  same(lastUpdate(inbox).state, again);
});

test("two humans: an undo waits for the other player's yes", async () => {
  const data = await fakeData();
  const inbox: { msg: ServerMessage; to?: number }[] = [];
  const server = new GameServer(data, async (f) => {
    throw new Error(`no map file ${f}`);
  }, (msg, to) => inbox.push({ msg, to }));
  await server.handle({ t: "advStart", mapFile: "random:36:2:2:1:5", seed: 5, controllers: ["human", "human"], turnMode: "sequential" }, 0);
  const s = server.state!;
  const size = server.world!.size;
  const ha = s.heroes.find((h) => h.owner === 0 && !h.removed)!;
  const hb = s.heroes.find((h) => h.owner === 1 && !h.removed)!;
  // A's hero next to B's (on B's tile's neighbour; the move is the attack).
  [ha.x, ha.y, ha.z] = [hb.x + 1, hb.y, hb.z];
  ha.army = [{ creature: 0, count: 30 }, { creature: 2, count: 10 }, null, null, null, null, null];
  hb.army = [{ creature: 0, count: 30 }, { creature: 2, count: 10 }, null, null, null, null, null];
  ha.movement = 2000;
  inbox.length = 0;
  await server.handle({ t: "advAct", action: { type: "move", hero: ha.id, to: (hb.z * size + hb.y) * size + hb.x } }, 0);
  assert.ok(battleFor(server.state!, 0), "the battle is on");

  // Whoever is up moves once; then the one who moved asks to undo.
  let st = lastUpdate(inbox, 0).state;
  const mover = st.sides[activeUnit(st)!.side].owner!;
  const other = 1 - mover;
  const before = st;
  await server.handle({ t: "act", action: chooseAction(st) }, mover);
  assert.equal(lastUpdate(inbox, mover).undo?.action.unit, activeUnit(st)!.id, "the move named");
  const after = lastUpdate(inbox, mover).state;

  // Asked; the other says no: nothing changes, the asker is told.
  let n = inbox.length;
  await server.handle({ t: "battleUndo" }, mover);
  assert.deepEqual(inbox.slice(n).map((m) => [m.msg.t, m.to]), [["undoAsk", other]]);
  n = inbox.length;
  await server.handle({ t: "battleUndoAnswer", yes: false }, other);
  assert.deepEqual(inbox.slice(n).map((m) => [m.msg.t, m.to]), [["error", mover]]);
  same(battleFor(server.state!, 0)!.pb.battle, after);

  // The asker can't answer their own ask.
  await server.handle({ t: "battleUndo" }, mover);
  n = inbox.length;
  await server.handle({ t: "battleUndoAnswer", yes: true }, mover);
  assert.equal(inbox.length, n, "only the other player answers");
  // The other says yes: both see the battle back where it was.
  await server.handle({ t: "battleUndoAnswer", yes: true }, other);
  for (const p of [0, 1]) {
    const u = lastUpdate(inbox, p);
    assert.equal(u.rewound, true, `player ${p} sees it go back`);
    same(u.state, before);
  }
  same(battleFor(server.state!, 0)!.pb.battle, before);
  // A stale yes (no ask pending) does nothing.
  n = inbox.length;
  await server.handle({ t: "battleUndoAnswer", yes: true }, other);
  assert.equal(inbox.length, n);
  st = lastUpdate(inbox, 0).state;
  assert.equal(st.winner, null);
});
