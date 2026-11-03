// The host fed what a broken or hostile browser might send: garbage, wrong types, every action
// with nonsense fields. Nothing may crash the host, and the rules must turn bad input down with a
// Refusal (said to the sender), never fail inside (a "bug"), which could leave a game half-changed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { battleFor, buildGameData, generateRandomMap, parseRandomMapName } from "@heroes/core";
import { fakeRes } from "../../../tools/shots/fake.ts";
import type { HostServerMessage } from "../src/protocol.ts";
import { Rooms } from "../src/rooms.ts";

const FILES = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData(Object.fromEntries(FILES.map((f) => [f, fakeRes(`${f}.txt`)!])) as Record<(typeof FILES)[number], Uint8Array>);
const MAP = "random:36:2:2:1:5";
const loadMap = async (file: string) => generateRandomMap(data, parseRandomMapName(file) ?? parseRandomMapName(MAP)!);

/** Each action type of a union in the rules' source, with its field names. */
function actionsOf(file: string, union: string): { type: string; fields: string[] }[] {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const body = src.slice(src.indexOf(`export type ${union} =`)).split(/;\n\n|;\n(?=\S)/)[0];
  return [...body.matchAll(/\{ type: "(\w+)"([^}]*)\}/g)].map((m) => ({ type: m[1], fields: [...m[2].matchAll(/;\s*(\w+)\??:/g)].map((f) => f[1]) }));
}
const ADV = actionsOf("../../core/src/adventure/rules.ts", "AdventureAction");
const BATTLE = actionsOf("../../core/src/battle/rules.ts", "BattleAction");

test("fuzz: malformed messages and actions are refused, never a crash or a bug", async () => {
  assert.ok(ADV.length > 30 && BATTLE.length > 8, `actions found: ${ADV.length} / ${BATTLE.length}`);
  let seed = 12345;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const bugs = new Map<string, number>();
  const rooms = new Rooms({ data, loadMap, rate: null, seed: () => 7, code: () => "FZ" + Math.floor(rng() * 1e6), onBug: (err) => bugs.set(`host: ${String(err)}`, (bugs.get(`host: ${String(err)}`) ?? 0) + 1) });
  const inboxes: HostServerMessage[][] = [[], []];
  const [a, b] = inboxes.map((box) => rooms.connect((m) => box.push(m)));
  await rooms.message(a, { t: "mpCreate", name: "Ann", map: MAP });
  const id = a.room!.info.id;
  await rooms.message(b, { t: "mpJoin", room: id, name: "Bob" });
  await rooms.message(a, { t: "mpStart" });
  let server = rooms.rooms.get(id)!.server!;
  const battleOf = () => battleFor(server.state!, 0)?.pb.battle;
  const value = () => {
    const s = server.state!;
    return pick<unknown>([
      0, 1, 2, -1, 7, 1e9, -1e9, 3.5, null, true, "x", "", [], {}, [1, 2], { kind: "hero", id: 0 },
      Math.floor(rng() * s.objects.length), Math.floor(rng() * s.heroes.length), Math.floor(rng() * s.size * s.size), Math.floor(rng() * 8),
    ]);
  };
  const garbage = () => pick<unknown>([null, 5, "hi", [], {}, { t: 3 }, { t: "nope" }, { t: "game" }, { t: "game", msg: null }, { t: "game", msg: { t: "advAct" } }, { t: "game", msg: { t: "advAct", action: null } }, { t: "game", msg: { t: "act", action: 7 } }, { t: "mpCreate" }, { t: "mpJoin", room: 5 }, { t: "mpSeat", seat: "x" }, { t: "mpPick", faction: {} }, { t: "mpChat", text: { a: 1 } }, { t: "mpMode", turnMode: "x", simUntil: "y" }, { t: "mpClock", clock: { base: "a" } }, { t: "mpStart" }, { t: "mpList" }, { t: "game", msg: { t: "control", side: 9, controller: "x" } }, { t: "game", msg: { t: "advStart", mapFile: MAP, seed: 1 } }]);
  for (let i = 0; i < 4000; i++) {
    const who = i % 2 ? b : a;
    const box = inboxes[i % 2];
    const before = box.length;
    let m: unknown;
    const r = rng();
    if (r < 0.15) m = garbage();
    else if (r < 0.75) {
      const kind = pick(ADV);
      m = { t: "game", msg: { t: "advAct", action: Object.fromEntries([["type", kind.type], ...kind.fields.map((f) => [f, value()])]) } };
    } else {
      const kind = pick(BATTLE);
      m = { t: "game", msg: { t: "act", action: Object.fromEntries([["type", kind.type], ...kind.fields.map((f) => [f, value()])]) } };
    }
    // (Now and then a day goes by, so the game moves on.)
    if (i % 50 === 49) for (const c of [a, b]) await rooms.message(c, { t: "game", msg: { t: "advAct", action: { type: "endTurn" } } });
    await rooms.message(who, m as never);
    for (const out of box.slice(before)) {
      if (out.t === "game" && out.msg.t === "error" && out.msg.bug) {
        const key = `${JSON.stringify((m as { msg?: { action?: { type?: string } } }).msg?.action?.type ?? (m as { t?: string })?.t)}: ${out.msg.bug.split(" @ ")[0]}`;
        bugs.set(key, (bugs.get(key) ?? 0) + 1);
      }
    }
  }
  assert.ok(server.state!.day > 1, "the game went on");
  // And in a battle between the two (a fresh game: the fuzzing may have dismissed their heroes): every battle action with nonsense fields.
  const fresh: HostServerMessage[][] = [[], []];
  const [a2, b2] = fresh.map((box) => rooms.connect((m) => box.push(m)));
  await rooms.message(a2, { t: "mpCreate", name: "Ann", map: MAP });
  await rooms.message(b2, { t: "mpJoin", room: a2.room!.info.id, name: "Bob" });
  await rooms.message(a2, { t: "mpMode", turnMode: "sequential" });
  await rooms.message(a2, { t: "mpStart" });
  server = a2.room!.server!;
  const s = server.state!;
  s.turnMode = "sequential";
  s.current = 0;
  const ha = s.heroes.find((h) => h.owner === 0 && !h.removed)!;
  const hb = s.heroes.find((h) => h.owner === 1 && !h.removed)!;
  [ha.x, ha.y, ha.z] = [hb.x + 1, hb.y, hb.z];
  ha.army = [{ creature: 13, count: 5 }, null, null, null, null, null, null];
  hb.army = [{ creature: 0, count: 50 }, null, null, null, null, null, null];
  ha.movement = 2000;
  await rooms.message(a2, { t: "game", msg: { t: "advAct", action: { type: "move", hero: ha.id, to: (hb.z * s.size + hb.y) * s.size + hb.x } } });
  let battleSeen = false;
  for (let i = 0; i < 1500; i++) {
    const kind = pick(BATTLE);
    const unit = () => pick([...(battleOf()?.units.map((u) => u.id) ?? [0]), 99, -1]);
    const action = Object.fromEntries([["type", kind.type], ...kind.fields.map((f) => [f, f === "unit" ? unit() : rng() < 0.5 ? Math.floor(rng() * 187) : value()])]);
    const who = i % 2 ? b2 : a2;
    const box = fresh[i % 2];
    const before = box.length;
    battleSeen ||= !!battleOf();
    await rooms.message(who, { t: "game", msg: { t: "act", action } } as never);
    for (const out of box.slice(before)) if (out.t === "game" && out.msg.t === "error" && out.msg.bug) bugs.set(`battle ${kind.type}: ${out.msg.bug.split(" @ ")[0]}`, (bugs.get(`battle ${kind.type}: ${out.msg.bug.split(" @ ")[0]}`) ?? 0) + 1);
  }
  assert.ok(battleSeen, "a battle was fuzzed");
  assert.deepEqual([...bugs].map(([k, n]) => `${k} (x${n})`), []);
});
