// The multiplayer host's shapes: a connection, a room, the host's time and settings, and the few questions every
// part asks of a room (who sits where, who is here, who is looking). rooms.ts holds the rooms; roomTurns.ts the
// clock, the notifications and the caretaker; roomWatch.ts the recap and following allies; roomHandlers.ts the
// lobby's messages. (Split out of rooms.ts on 2026-10-31, the Refactor queue's multiplayer item.)
import { type GameData, PLAYER_NAMES, allied } from "@heroes/core";
import type { H3Map } from "@heroes/formats";
import type { ClientMessage, GameReport, GameServer, ReplayStep } from "@heroes/server";
import type { TurnClock } from "./clock.ts";
import { say } from "./words.ts";
import type { ChatArg, ChatLine, HostServerMessage, Look, RoomInfo } from "./protocol.ts";

export interface Client {
  send: (m: HostServerMessage) => void;
  name: string;
  room?: Room;
  /** Who it is across devices (gate.ts playerOf, said by the page server in front), when known. */
  who?: { key: string; name: string };
  /** Messages it may still send now (refilled over time), and how many were turned away for coming too fast. */
  budget?: { left: number; at: number; dropped: number };
  /** Where its player is looking (told to their allies), and whether it follows its allies' turns (their battles are sent to it). */
  look?: Look;
  follows?: boolean;
  /** The page is out of sight (another tab, the phone locked, the app in the background): its player is told of their turn as if away. */
  hidden?: boolean;
  /** The language its page speaks (mpLang; none: English). */
  lang?: string;
}

/** How fast a browser may send: a burst, then so many a second (a player clicks far slower; a script or a loop doesn't). */
export const RATE = { burst: 120, perSecond: 30 };
/** A connection that keeps flooding after being told is closed (main.ts). */
export const FLOOD_CLOSE = 300;
/** How long a room with nobody in it is kept: not started, a finished game, any game. */
export const KEEP_MS = { waiting: 3600_000, finished: 24 * 3600_000, any: 30 * 24 * 3600_000 };
/** At most this many rooms on the host (a new one is refused beyond it). */
export const MAX_ROOMS = 500;

export interface Room {
  info: RoomInfo;
  clients: Set<Client>;
  server: GameServer | null;
  /** The turn timers of a started game with a time limit. */
  clock?: TurnClock;
  /** Cancels the wait for the next clock to run out. */
  clockWait?: () => void;
  /** Players gone from a running game, by name: cancels the wait before the computer takes over. */
  goneWaits?: Map<string, () => void>;
  chat?: ChatLine[];
  /** When anyone last did anything in it (ms; for clearing out rooms left behind). */
  active?: number;
  /**
   * A random map as it was made when the game began, kept with the room: a later version of the
   * generator makes another map from the same name, and a game lasting weeks outlives versions.
   */
  map?: H3Map;
  /** Played by notification: the turn each seat was last told of (so it's told once). */
  told?: Record<number, string>;
  /** Battles between players and towns changing hands (numbered), for players away ("since your last turn"). */
  journal?: { n: number; r: GameReport }[];
  /** The last journal entry each seat has seen (it was here, or was given the recap), and the day it was last here. */
  seen?: Record<number, { n: number; day: number }>;
  /** Attacks on a seat while its player was away, not yet in a notification. */
  attacked?: Record<number, GameReport[]>;
  /** What each seat's player, away, could have watched the others do (replaySteps), for watching it when back. */
  replays?: Record<number, ReplayStep[]>;
  /** The flags as the last update left them (not kept: after a restart flags are told from the next update on). */
  flags?: Map<number, number>;
  /** Played by notification: when each seat's current turn came (ms), for the soft deadline. */
  turnAt?: Record<number, number>;
  /** Cancels the wait for the next soft deadline. */
  coverWait?: () => void;
}

/** The longest soft turn deadline (hours) and vacation (ms) a room takes. */
export const DEADLINE_MAX_HOURS = 14 * 24;
export const VACATION_MAX_MS = 60 * 24 * 3600_000;

/** Journal entries kept per room. */
export const JOURNAL_KEPT = 300;

/** A turn notification (push.ts notify()). */
export interface TurnNote {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** The host's time (tests run it by hand). `after` calls back once `ms` have passed and returns a cancel. */
export interface HostTime {
  now: () => number;
  after: (ms: number, fn: () => void) => () => void;
}

export const realTime: HostTime = {
  now: () => Date.now(),
  after: (ms, fn) => {
    // (Not keeping the process alive: the host's server does that.)
    const t = setTimeout(fn, Math.min(ms, 2 ** 31 - 1)).unref();
    return () => clearTimeout(t);
  },
};

export const CHAT_KEPT = 100;

/** What a player in a room may send to its game: their own moves (never a new game in its place). */
export const PLAYABLE = new Set<ClientMessage["t"]>(["advAct", "advAiTurn", "act", "control", "battleUndo", "battleUndoAnswer"]);

/** What the parts need of the host (rooms.ts Rooms): its settings, its rooms and its few shared acts. */
export interface RoomsHost {
  readonly rooms: Map<string, Room>;
  readonly data: GameData;
  readonly loadMap: (file: string) => Promise<H3Map>;
  readonly dir: string | undefined;
  readonly code: () => string;
  readonly time: HostTime;
  readonly goneMs: number;
  readonly seed: () => number;
  readonly notify: (key: string, note: TurnNote) => void;
  readonly onBug: (err: unknown) => void;
  save(room: Room): void;
  say(room: Room, from: string, text: string): void;
  /** The host's own line in the chat: its English with %1, %2..., said by each page in its language. */
  tell(room: Room, key: string, ...args: ChatArg[]): void;
  broadcastRoom(room: Room): void;
  leave(c: Client): void;
  drop(room: Room): void;
  sweep(): number;
  room(id: string): Room;
  makeServer(room: Room): GameServer;
}

// ---- who sits where, who is here ----------------------------------------------------

/** A player's colour in the room (-1: not playing). */
export function seatOf(room: Room, name: string): number {
  return room.info.players.find((p) => p.name === name)?.seat ?? -1;
}

/** A connection of theirs is in the room. */
export function here(room: Room, name: string): boolean {
  return [...room.clients].some((c) => c.name === name);
}

/** Here and looking: a page of theirs is open and in sight (a hidden one still plays, but they need telling). */
export function looking(room: Room, name: string): boolean {
  return [...room.clients].some((c) => c.name === name && !c.hidden);
}

/** What to call each colour: its player's name, else the map's colour (the computer's). */
export function names(room: Room): string[] {
  return PLAYER_NAMES.map((n, seat) => room.info.players.find((p) => p.seat === seat)?.name ?? n);
}

/** names(), the computer's colours said in `lang`. */
export function namesIn(room: Room, lang: string | undefined): string[] {
  return PLAYER_NAMES.map((n, seat) => room.info.players.find((p) => p.seat === seat)?.name ?? say(lang, n));
}

/** The seats online in this room that are allied with `seat` (not itself), each with its connections. */
export function alliesOnline(room: Room, seat: number): Client[] {
  const s = room.server?.state;
  if (!s || seat < 0) return [];
  return [...room.clients].filter((o) => {
    const at = seatOf(room, o.name);
    return at >= 0 && at !== seat && allied(s, at, seat);
  });
}
