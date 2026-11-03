// What the players away get back, and what allies here see of each other: the journal of battles and towns taken
// (report, recap), the map moves to replay (record), and following an ally's look and battles (tellLook, toWatchers).
import type { AdventureEvent, AdventureState, World } from "@heroes/core";
import { type GameReport, REPLAY_KEPT, flagOwners, replaySteps } from "@heroes/server";
import type { HostServerMessage } from "./protocol.ts";
import { type Client, JOURNAL_KEPT, type Room, alliesOnline, here, seatOf } from "./roomTypes.ts";

/**
 * A battle between players or a town changing hands: kept for the players away, who hear of an
 * attack on them at once (nudge) and of the rest when they're back (recap); those here saw it.
 */
export function report(room: Room, r: GameReport) {
  if (!room.info.async) return;
  const j = (room.journal ??= []);
  const n = (j.at(-1)?.n ?? 0) + 1;
  j.push({ n, r });
  j.splice(0, j.length - JOURNAL_KEPT);
  const day = room.server?.state?.day ?? 0;
  for (const p of room.info.players) {
    if (!r.seats.includes(p.seat)) continue;
    if (here(room, p.name)) (room.seen ??= {})[p.seat] = { n, day };
    else if (r.kind === "battle" ? r.defender === p.seat : r.kind === "town" && r.from === p.seat) ((room.attacked ??= {})[p.seat] ??= []).push(r);
  }
}

/**
 * A battle update for one fighter: also to their allies following along (who aren't fighting in
 * it themselves). Sent once a fighter's copy, so a battle of a friend against a rival reaches the
 * friend's allies only.
 */
export function toWatchers(room: Room, to: number, msg: Extract<HostServerMessage, { t: "mpWatch" }>["msg"]) {
  if (msg.t !== "update") return;
  const fighting = new Set(msg.state.sides.map((x) => x.owner));
  for (const o of alliesOnline(room, to)) if (o.follows && !fighting.has(seatOf(room, o.name))) o.send({ t: "mpWatch", seat: to, msg });
}

/** Gone from the room: their allies stop following them into a town or battle. */
export function lookAway(room: Room, c: Client) {
  c.follows = false;
  if (!c.look || c.look.k === "map") return (c.look = undefined);
  c.look = { k: "map" };
  tellLook(room, c);
  c.look = undefined;
}

/** Where a player looks, to their allies here (and, on joining, theirs to them). */
export function tellLook(room: Room, c: Client) {
  const seat = seatOf(room, c.name);
  if (c.look) for (const o of alliesOnline(room, seat)) o.send({ t: "mpLook", seat, look: c.look });
}

/** Played by notification: what the players away could see happen on the map, to watch when they're back. */
export function record(room: Room, s: AdventureState, w: World, events: AdventureEvent[]) {
  if (!room.info.async) return;
  for (const p of room.info.players) {
    if (here(room, p.name)) continue;
    const steps = replaySteps(s, w, p.seat, events, room.flags);
    if (!steps.length) continue;
    const kept = ((room.replays ??= {})[p.seat] ??= []);
    kept.push(...steps);
    kept.splice(0, kept.length - REPLAY_KEPT);
  }
  room.flags = flagOwners(s);
}

/** A player back in a game played by notification: what they missed since they were last here (in words, and on the map to watch). */
export function recap(room: Room, c: Client, seat: number) {
  if (!room.info.async) return;
  const seen = room.seen?.[seat];
  const missed = (room.journal ?? []).filter((e) => e.n > (seen?.n ?? 0) && e.r.seats.includes(seat)).map((e) => e.r);
  const replay = room.replays?.[seat] ?? [];
  if (missed.length || replay.length) c.send({ t: "mpRecap", reports: missed, ...(seen ? { since: seen.day } : {}), ...(replay.length ? { replay } : {}) });
  if (room.replays) delete room.replays[seat];
  (room.seen ??= {})[seat] = { n: room.journal?.at(-1)?.n ?? 0, day: room.server?.state?.day ?? 0 };
}
