// Whose turn it is and who is told: the turn clock (live rooms), the notifications and the caretaker (games played by
// notification), and players gone and back (the computer standing in).
import { battleFor, canAct } from "@heroes/core";
import { caretakerReport, reportText } from "@heroes/server";
import { TurnClock } from "./clock.ts";
import { type Room, type RoomsHost, here, looking, namesIn, seatOf } from "./roomTypes.ts";
import { wordsIn } from "./words.ts";
import { report } from "./roomWatch.ts";

export function startClock(room: Room) {
  // (Played by notification: no time limit, everyone takes their turn when they can.)
  const settings = room.info.async ? null : room.info.clock;
  if (settings && room.server?.state) room.clock = new TurnClock(settings, room.info.players.map((p) => p.seat));
}

/**
 * Brings the room's clock up to date after anything happened: a turn whose time is all gone
 * ends, a battle's goes to the computer; everyone is sent the clocks; the next run-out is waited for.
 */
export async function tick(h: RoomsHost, room: Room) {
  const { clock, server } = room;
  // (An empty room's clock stands still: emptied().)
  if (!clock || !server?.state || !room.clients.size) return;
  for (let guard = 0; guard < 16; guard++) {
    const expired = clock.update(server.state, h.time.now());
    if (!expired.length) break;
    for (const { seat, kind } of expired) {
      if (kind === "turn") await server.handle({ t: "advAct", action: { type: "endTurn" } }, seat);
      else {
        const b = battleFor(server.state, seat)?.pb.battle;
        const side = b?.sides.findIndex((x) => x.owner === seat);
        if (side !== undefined && side >= 0) await server.handle({ t: "control", side: side as 0 | 1, controller: "ai" }, seat);
      }
    }
  }
  const seats = clock.view();
  for (const c of room.clients) c.send({ t: "mpClock", seats });
  room.clockWait?.();
  const at = clock.nextDeadline();
  room.clockWait = at === Infinity ? undefined : h.time.after(Math.max(0, at - h.time.now()) + 5, () => void tick(h, room));
}

/**
 * A game played by notification after anything happened: a battle against someone away is fought
 * for them by the computer, and whoever may move now and isn't here is told so, once per turn.
 */
export async function nudge(h: RoomsHost, room: Room, depth = 0) {
  const s = room.server?.state;
  if (!room.info.async || !room.server || !s) return;
  const over = s.winner !== undefined;
  const isHere = (name: string) => here(room, name);
  // (Settling one battle lets the computer go on, and it may attack someone else away.)
  for (let guard = 0; guard < 16 && !over; guard++) {
    let fought = false;
    for (const p of room.info.players) {
      const b = isHere(p.name) ? undefined : battleFor(s, p.seat)?.pb.battle;
      const side = b && b.winner === null ? b.sides.findIndex((x) => x.owner === p.seat && x.controller === "human") : -1;
      if (side < 0) continue;
      await room.server.handle({ t: "control", side: side as 0 | 1, controller: "ai" }, p.seat);
      fought = true;
    }
    if (!fought) break;
  }
  let changed = false;
  for (const p of room.info.players) {
    const attacks = room.attacked?.[p.seat] ?? [];
    // (A game just lost in an attack is still told of: the attack.)
    const yours = !over && s.players[p.seat]?.controller === "human" && canAct(s, p.seat);
    const turn = `${s.day}:${s.turnMode === "sequential" ? s.current : ""}`;
    const newTurn = yours && room.told?.[p.seat] !== turn;
    const first = !room.told?.[p.seat];
    if (!newTurn && !attacks.length) continue;
    if (newTurn) ((room.told ??= {})[p.seat] = turn), ((room.turnAt ??= {})[p.seat] = h.time.now());
    if (room.attacked) delete room.attacked[p.seat];
    changed = true;
    // (Someone here sees it's their move; the others get a notification.)
    if (looking(room, p.name) || !p.key) continue;
    // (In the language their page last spoke.)
    const w = wordsIn(p.lang);
    const attacked = attacks.map((r) => reportText(r, p.seat, namesIn(room, p.lang), w)).join(" ");
    const others = room.info.players.filter((o) => o !== p).map((o) => o.name);
    const moved = first ? w("The game has begun.") : others.length ? w(others.length > 1 ? "%1 have moved." : "%1 has moved.", others.join(", ")) : w("The others have moved.");
    h.notify(p.key, {
      title: newTurn ? w(attacks.length ? "You were attacked! Your turn: day %1" : "Your turn: day %1", s.day) : s.players[p.seat]?.alive === false ? w("You have been defeated") : w("You were attacked"),
      body: newTurn ? `${attacked || moved} ${w("Your move in game %1.", room.info.id)}` : `${attacked} ${w("Game %1.", room.info.id)}`,
      url: `/#map?room=${room.info.id}`,
      tag: `turn-${room.info.id}`,
    });
  }
  if (changed) h.save(room);
  // (Each turn the caretaker plays can bring the next day, and so maybe another turn to cover.)
  if (depth < 8 && cover(h, room)) await nudge(h, room, depth + 1);
}

/** On vacation now (an ended one is forgotten). */
export function onVacation(h: RoomsHost, room: Room, seat: number): boolean {
  const until = room.info.vacation?.[seat];
  if (until === undefined) return false;
  if (until > h.time.now()) return true;
  delete room.info.vacation![seat];
  return false;
}

/**
 * Played by notification: friends away past the soft deadline, or on vacation, have their turn
 * played by the caretaker (GameServer.caretake), once everyone else still to move is such a friend
 * and someone has played the day themselves (friends all away: the game waits, it doesn't race on
 * alone). Each is told what was done for them (a notification, and the recap when back). Returns
 * whether it played a turn; else waits for the next deadline.
 */
export function cover(h: RoomsHost, room: Room): boolean {
  const s = room.server?.state;
  room.coverWait?.();
  room.coverWait = undefined;
  if (!room.info.async || !room.server || !s || s.winner !== undefined) return false;
  const deadline = room.info.deadline ? room.info.deadline * 3600_000 : 0;
  const now = h.time.now();
  const humans = room.info.players.filter((p) => s.players[p.seat]?.controller === "human" && s.players[p.seat]?.alive !== false);
  const waiting = humans.filter((p) => canAct(s, p.seat));
  const away = (p: (typeof humans)[number]) => !here(room, p.name) && !battleFor(s, p.seat);
  const due = (p: (typeof humans)[number]) => away(p) && (onVacation(h, room, p.seat) || (!!deadline && (room.turnAt?.[p.seat] ?? now) + deadline <= now));
  const played = humans.some((p) => !waiting.includes(p) && !onVacation(h, room, p.seat));
  if (!waiting.length || !played || !waiting.every(due)) {
    // The next deadline to come, for those away (it may come true by then).
    const next = deadline ? Math.min(...waiting.filter(away).map((p) => (room.turnAt?.[p.seat] ?? now) + deadline)) : Infinity;
    if (played && next < Infinity) room.coverWait = h.time.after(Math.max(0, next - now) + 5, () => void nudge(h, room).catch(h.onBug));
    return false;
  }
  let any = false;
  for (const p of waiting) {
    // (The day played: the next may have come by the end of it.)
    const day = s.day;
    const log = room.server.caretake(p.seat);
    if (!log) continue;
    any = true;
    const r = { ...caretakerReport(s, room.server.world!, p.seat, log), day };
    report(room, r);
    h.tell(room, "%1 is away: the caretaker played %2's turn (day %3).", p.name, { colour: p.seat }, r.day);
    const w = wordsIn(p.lang);
    if (p.key) h.notify(p.key, { title: w("Your turn was played for you: day %1", r.day), body: `${reportText(r, p.seat, namesIn(room, p.lang), w)} ${w("Game %1.", room.info.id)}`, url: `/#map?room=${room.info.id}`, tag: `care-${room.info.id}` });
  }
  if (any) (h.save(room), h.broadcastRoom(room));
  return any;
}

/**
 * The last player left a running game: it waits for them, as it stands. The computer gives back the
 * colours it stood in for (with nobody there it would race through the whole game alone) and the
 * clock stops (it would end everyone's turns, day after day).
 */
export function emptied(h: RoomsHost, room: Room) {
  if (room.clients.size || !room.server) return;
  room.clockWait?.();
  room.clockWait = undefined;
  for (const seat of room.info.away ?? []) room.server.setController(seat, "human");
  if (room.info.away?.length) (room.info.away = []), h.save(room);
}

/** The first player is back in an empty game: the clock goes on from here, and whoever is still away is waited for. */
export function reopened(h: RoomsHost, room: Room, name: string) {
  if (!room.server) return;
  room.clock?.resume(h.time.now());
  for (const p of room.info.players) if (p.name !== name) goneLater(h, room, p.name);
}

/** A player with no connection left: if they stay away, the computer plays their colour. */
export function goneLater(h: RoomsHost, room: Room, name: string) {
  if (!room.info.started || room.info.async || [...room.clients].some((c) => c.name === name)) return;
  const waits = (room.goneWaits ??= new Map());
  waits.get(name)?.();
  waits.set(
    name,
    h.time.after(h.goneMs, () => {
      waits.delete(name);
      void gone(h, room, name);
    }),
  );
}

export async function gone(h: RoomsHost, room: Room, name: string) {
  const seat = seatOf(room, name);
  // (Nobody else is there to be kept waiting.)
  if (!room.server || seat < 0 || !room.clients.size || [...room.clients].some((c) => c.name === name) || room.info.away?.includes(seat)) return;
  (room.info.away ??= []).push(seat);
  h.tell(room, "%1 is gone: the computer plays %2 until they come back.", name, { colour: seat });
  h.broadcastRoom(room);
  room.server.setController(seat, "ai");
  h.save(room);
  await tick(h, room);
}

/** Back in the room: their colour is theirs again (from the computer, if it stood in). */
export function back(h: RoomsHost, room: Room, name: string) {
  room.goneWaits?.get(name)?.();
  room.goneWaits?.delete(name);
  const seat = seatOf(room, name);
  if (!room.server || !room.info.away?.includes(seat)) return;
  room.info.away = room.info.away.filter((s) => s !== seat);
  room.server.setController(seat, "human");
  h.tell(room, "%1 is back and plays %2 again.", name, { colour: seat });
}
