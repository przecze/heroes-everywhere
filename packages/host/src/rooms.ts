// The multiplayer rooms: who is in which, the lobby, and each started room's authoritative
// GameServer. No sockets here (main.ts carries the messages), so tests can drive it directly.
// The parts: roomTypes.ts (shapes, who is where), roomHandlers.ts (each lobby message), roomTurns.ts (clock,
// notifications, caretaker, gone and back), roomWatch.ts (recap, replay, following allies), wellFormed.ts (checks).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AdventureState, GameData } from "@heroes/core";
import type { H3Map } from "@heroes/formats";
import { GameServer } from "@heroes/server";
import type { ChatArg, ChatLine, HostClientMessage, HostServerMessage, RoomInfo } from "./protocol.ts";
import { argText, say } from "./words.ts";
import { handle } from "./roomHandlers.ts";
import { CHAT_KEPT, type Client, FLOOD_CLOSE, type HostTime, KEEP_MS, RATE, type Room, type RoomsHost, type TurnNote, here, realTime, seatOf } from "./roomTypes.ts";
import { emptied, goneLater, nudge, startClock, tick } from "./roomTurns.ts";
import { lookAway, record, report, toWatchers } from "./roomWatch.ts";
import { LobbyError, wellFormed } from "./wellFormed.ts";

export { DEADLINE_MAX_HOURS, FLOOD_CLOSE, KEEP_MS, MAX_ROOMS, RATE, VACATION_MAX_MS } from "./roomTypes.ts";
export type { Client, HostTime, Room, TurnNote } from "./roomTypes.ts";
/** A player's lobby mistake, said back to them (not a bug in the host). */
export { LobbyError };

export class Rooms implements RoomsHost {
  readonly rooms = new Map<string, Room>();
  readonly data: GameData;
  readonly loadMap: (file: string) => Promise<H3Map>;
  /** Where room states are kept so a restart doesn't lose games (none: not kept). */
  readonly dir: string | undefined;
  /** Room codes; tests make them predictable. */
  readonly code: () => string;
  readonly time: HostTime;
  /** How long a player may be gone from a running game before the computer plays their colour. */
  readonly goneMs: number;
  /** A new game's seed (tests fix it). */
  readonly seed: () => number;
  /** Tells a player it's their turn in a game played by notification (push.ts; tests collect them). */
  readonly notify: (key: string, note: TurnNote) => void;
  /** How fast each connection may send (null: as fast as it likes, for tests). */
  readonly rate: typeof RATE | null;
  /** An error inside the host (not a player's mistake): logged; the fuzz test counts them. */
  readonly onBug: (err: unknown) => void;

  constructor(opts: { data: GameData; loadMap: (file: string) => Promise<H3Map>; dir?: string; code?: () => string; time?: HostTime; goneMs?: number; seed?: () => number; onBug?: (err: unknown) => void; rate?: typeof RATE | null; notify?: (key: string, note: TurnNote) => void }) {
    this.notify = opts.notify ?? (() => {});
    this.rate = opts.rate === undefined ? RATE : opts.rate;
    this.onBug = opts.onBug ?? ((err) => console.error("host:", err));
    this.seed = opts.seed ?? (() => (Math.random() * 2 ** 31) | 0);
    this.data = opts.data;
    this.time = opts.time ?? realTime;
    this.goneMs = opts.goneMs ?? 3 * 60_000;
    this.loadMap = opts.loadMap;
    this.dir = opts.dir;
    this.code = opts.code ?? (() => Math.random().toString(36).slice(2, 7).toUpperCase());
    if (this.dir) mkdirSync(this.dir, { recursive: true });
  }

  /** Brings saved rooms back after a restart; their players get the game when they rejoin. */
  async restore() {
    if (!this.dir) return;
    for (const f of readdirSync(this.dir).filter((f) => f.endsWith(".json"))) {
      try {
        const saved = JSON.parse(readFileSync(join(this.dir, f), "utf8")) as { info: RoomInfo; state: AdventureState | null; chat?: ChatLine[]; active?: number; told?: Record<number, string>; journal?: Room["journal"]; seen?: Room["seen"]; attacked?: Room["attacked"]; replays?: Room["replays"]; turnAt?: Room["turnAt"] };
        const mapFile = join(this.dir, `${saved.info.id}.map`);
        const map = existsSync(mapFile) ? (JSON.parse(readFileSync(mapFile, "utf8")) as H3Map) : undefined;
        const room: Room = { map, info: saved.info, clients: new Set(), server: null, chat: saved.chat ?? [], active: saved.active ?? this.time.now(), told: saved.told, journal: saved.journal, seen: saved.seen, attacked: saved.attacked, replays: saved.replays, turnAt: saved.turnAt };
        if (saved.info.started && saved.state) {
          room.server = this.makeServer(room);
          await room.server.handle({ t: "advResume", state: saved.state }, -1);
          // (The timers start afresh: time spent while the host was down isn't anyone's.)
          startClock(room);
          // Nobody is here yet: whoever doesn't come back in time is played by the computer.
          for (const p of room.info.players) goneLater(this, room, p.name);
          await tick(this, room);
          // (The soft deadlines are waited for again.)
          this.rooms.set(room.info.id, room);
          await nudge(this, room);
        }
        this.rooms.set(room.info.id, room);
      } catch (err) {
        console.error(`couldn't restore ${f}:`, err);
      }
    }
  }

  connect(send: (m: HostServerMessage) => void, who?: { key: string; name: string }): Client {
    return { send, name: "", ...(who ? { who } : {}) };
  }

  /**
   * The connection closed: the player shows as offline (their seat stays theirs). Played by
   * notification, a battle they were in is fought on for them by the computer (nobody waits on it).
   */
  async disconnect(c: Client) {
    const room = c.room;
    if (!room) return;
    lookAway(room, c);
    room.clients.delete(c);
    // (What happened while they were here they saw: a recap later starts from now.)
    const seat = seatOf(room, c.name);
    if (room.info.async && seat >= 0 && !here(room, c.name)) (room.seen ??= {})[seat] = { n: room.journal?.at(-1)?.n ?? 0, day: room.server?.state?.day ?? 0 };
    goneLater(this, room, c.name);
    emptied(this, room);
    this.broadcastRoom(room);
    await nudge(this, room).catch(this.onBug);
  }

  /** Handles one message; a mistake is said back to the sender. */
  async message(c: Client, m: HostClientMessage) {
    if (!this.allowed(c)) return;
    try {
      wellFormed(m);
      await handle(this, c, m);
      if (c.room) c.room.active = this.time.now();
    } catch (err) {
      if (!(err instanceof LobbyError)) this.onBug(err);
      c.send({ t: "mpError", message: err instanceof Error ? err.message : String(err), ...(err instanceof LobbyError && err.code ? { code: err.code } : {}) });
    }
  }

  broadcastRoom(room: Room) {
    room.info.players.forEach((p) => (p.online = [...room.clients].some((c) => c.name === p.name)));
    for (const c of room.clients) c.send({ t: "mpRoom", room: room.info, you: c.name });
  }

  save(room: Room) {
    if (!this.dir) return;
    // (Written aside and then renamed: a host killed mid-write leaves the last whole save, not half of one.)
    const file = join(this.dir, `${room.info.id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify({ info: room.info, state: room.server?.state ?? null, chat: room.chat ?? [], active: room.active, told: room.told, journal: room.journal, seen: room.seen, attacked: room.attacked, replays: room.replays, turnAt: room.turnAt }));
    renameSync(`${file}.tmp`, file);
  }

  /** Clears out rooms nobody is in and nobody came back to (see KEEP_MS); returns how many went. */
  sweep(): number {
    const now = this.time.now();
    let gone = 0;
    for (const room of [...this.rooms.values()]) {
      if (room.clients.size) continue;
      const idle = now - (room.active ?? now);
      const keep = !room.info.started ? KEEP_MS.waiting : room.server?.state?.winner !== undefined ? KEEP_MS.finished : KEEP_MS.any;
      if (idle < keep) continue;
      this.drop(room);
      gone++;
    }
    return gone;
  }

  drop(room: Room) {
    room.clockWait?.();
    room.coverWait?.();
    for (const cancel of room.goneWaits?.values() ?? []) cancel();
    this.rooms.delete(room.info.id);
    if (this.dir) for (const f of [`${room.info.id}.json`, `${room.info.id}.map`]) rmSync(join(this.dir, f), { force: true });
  }

  /** Takes one from the sender's budget; false: it's sending too fast and this message is dropped. */
  private allowed(c: Client): boolean {
    const rate = this.rate;
    if (!rate) return true;
    const now = this.time.now();
    const b = (c.budget ??= { left: rate.burst, at: now, dropped: 0 });
    b.left = Math.min(rate.burst, b.left + ((now - b.at) / 1000) * rate.perSecond);
    b.at = now;
    // (Calm again: a later flood is told again.)
    if (b.left > rate.burst / 2) b.dropped = 0;
    if (b.left >= 1) return (b.left--, true);
    // (Said once per flood, not for every message dropped.)
    if (b.dropped++ === 0) c.send({ t: "mpError", message: "Too many messages at once: slow down." });
    return false;
  }

  /** It kept flooding after being told: main.ts closes the connection. */
  flooding(c: Client): boolean {
    return (c.budget?.dropped ?? 0) >= FLOOD_CLOSE;
  }

  makeServer(room: Room): GameServer {
    return new GameServer(
      this.data,
      // (Its own copy of a random map, if it has one.)
      async (file) => (room.map && file === room.info.map ? structuredClone(room.map) : this.loadMap(file)),
      (msg, to) => {
        for (const c of room.clients) if (to === undefined || seatOf(room, c.name) === to) c.send({ t: "game", msg });
        if (msg.t === "adv") this.save(room);
        if (msg.t === "update" && to !== undefined) toWatchers(room, to, msg);
      },
      // Each player only ever sees their own view, also while the computer stands in for the others.
      { views: true, onReport: (r) => report(room, r), onPublish: (s, w, events) => record(room, s, w, events) },
    );
  }

  say(room: Room, from: string, text: string) {
    this.post(room, { from, text, at: this.time.now() });
  }

  tell(room: Room, key: string, ...args: ChatArg[]) {
    this.post(room, { from: "", text: say(undefined, key, ...args.map((a) => argText(undefined, a))), at: this.time.now(), key, args });
  }

  /** A line into the room's chat: kept (the last CHAT_KEPT), sent to everyone here, saved. */
  private post(room: Room, line: ChatLine) {
    (room.chat ??= []).push(line);
    room.chat.splice(0, room.chat.length - CHAT_KEPT);
    for (const c of room.clients) c.send({ t: "mpChat", lines: [line] });
    this.save(room);
  }



  /**
   * Out of the room. Before the game starts the player's colour is free again (and a host who
   * leaves hands the room to the next player; an empty room goes); once it runs, the seat stays
   * theirs to continue later.
   */
  leave(c: Client) {
    const room = c.room;
    if (!room) return;
    lookAway(room, c);
    room.clients.delete(c);
    c.room = undefined;
    goneLater(this, room, c.name);
    emptied(this, room);
    if (!room.info.started && ![...room.clients].some((o) => o.name === c.name)) {
      room.info.players = room.info.players.filter((p) => p.name !== c.name);
      if (!room.info.players.length) return this.drop(room);
      if (room.info.host === c.name) room.info.host = room.info.players[0].name;
      this.save(room);
    }
    this.broadcastRoom(room);
  }

  room(id: string): Room {
    const r = this.rooms.get(id.trim().toUpperCase());
    if (!r) throw new LobbyError("No such room.", "noRoom");
    return r;
  }

}
