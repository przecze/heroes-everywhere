import type { GameSummary, RuleOverrides } from "@heroes/core";
import type { ClientMessage, GameReport, ReplayStep, ServerMessage } from "@heroes/server";

export interface RoomInfo {
  id: string;
  map: string;
  host: string;
  started: boolean;
  /** Seats players can take: map colours a human may play. */
  colors: number[];
  players: { name: string; seat: number; online: boolean; /** Who it is across devices (gate.ts playerOf): a seat with one is theirs on any device, nobody else's. */ key?: string; /** The town picked (a random-town colour only). */ faction?: string; /** The starting bonus picked (none: random). */ bonus?: Bonus; /** The language their page last spoke (their pings are in it). */ lang?: string }[];
  /** Every colour in the game, as the scenario's options list them (who may play it, its team, the towns it may pick). */
  slots?: Slot[];
  turnMode: "simultaneous" | "sequential";
  /** Game rules the host chose (core's gameRules.ts): without HotA's content, HotA's rule changes turned off. */
  noHota?: boolean;
  rules?: RuleOverrides;
  /**
   * Played by notification, among friends: nobody's colour goes to the computer while they're away
   * (their turn waits for them, and they're told it's come), no time limit, and a battle against
   * someone away is fought for them by the computer.
   */
  async?: boolean;
  /** The friends play as one team against the computer players (whatever teams the map has). */
  allied?: boolean;
  /** Simultaneous turns end after this many days of play even if no rivals have met (none: only on contact). */
  simUntil?: number | null;
  /** HotA's online turn timers (seconds); none: no time limit. */
  clock?: ClockSettings | null;
  /** Colours the computer plays meanwhile: their player has been gone a while (it's theirs again when they're back). */
  away?: number[];
  /**
   * Colours an allied computer player plays: on the friends' team (sharing what it sees, never
   * attacking them, leaving what their heroes are heading for to them). A friend may take one over,
   * also once the game runs.
   */
  allies?: number[];
  /**
   * Played by notification: a soft turn deadline (hours). A friend away longer than that, with the
   * others done for the day, has the turn played for them by a cautious caretaker (none: wait for ever).
   */
  deadline?: number | null;
  /** Friends on vacation (colour → until when, ms): the caretaker plays their turns meanwhile, unless they're back sooner. */
  vacation?: Record<number, number>;
}

/** A game I'm in, for "my games". */
export interface MyGame {
  room: RoomInfo;
  seat: number;
  /** The game's day (0: not started). */
  day: number;
  /** It's my move now. */
  myTurn: boolean;
  /** Whom it waits for (names), when not me. */
  waitingFor: string[];
  over: boolean;
  /** My colour, town, strongest hero and the latest happenings, for "Your games" (none before the start). */
  summary?: GameSummary;
}

export type Bonus = "gold" | "resource" | "artifact";

/** A colour of the map in the lobby's player list. */
export interface Slot {
  seat: number;
  /** A friend may take it. */
  human: boolean;
  /** Nobody picked it: the computer plays it (else it stays out of the game). */
  computer: boolean;
  team?: number;
  /** The towns its player may choose from (empty: the map fixes its town). */
  factions: string[];
}

/** HotA's chess clock: a turn timer each day, a creature timer for each move in a battle, a reserve per battle, and a base reserve for the game (seconds). */
export interface ClockSettings {
  base: number;
  turn: number;
  battle: number;
  unit: number;
}

/** A seat's timers (ms left) and which of them is counting down now. */
export interface SeatClock {
  base: number;
  turn: number;
  battle: number;
  unit: number;
  running: "turn" | "battle" | null;
}

/** A line of the room's chat (`from` empty: the host saying who left or came back). */
export interface ChatLine {
  from: string;
  /** The words (the host's own lines: in English, for pages that can't read `key`). */
  text: string;
  at: number;
  /** The host's own line: its English text with %1, %2... (each page says it in its language) and the values. */
  key?: string;
  args?: ChatArg[];
}

/** A value in the host's line: words, a number, or a colour (said by its name in the reader's language). */
export type ChatArg = string | number | { colour: number };

/**
 * Where a player is looking, told to their allies so they can follow along (a town screen open, a
 * battle being fought, else the map). Only these: the rest of what's on their screen stays theirs.
 */
export type Look = { k: "map" } | { k: "town"; object: number } | { k: "battle" };

/** Lobby messages, plus game messages wrapped in `game`. */
export type HostClientMessage =
  | { t: "mpCreate"; name: string; map: string }
  | { t: "mpJoin"; room: string; name: string }
  /** Look at a room without joining it (to continue a game on another device). */
  | { t: "mpPeek"; room: string }
  /** Out of the room (before the start the colour is free again; a running game's seat is kept). */
  | { t: "mpLeave" }
  | { t: "mpSeat"; seat: number }
  | { t: "mpMode"; turnMode: "simultaneous" | "sequential"; simUntil?: number | null; async?: boolean; allied?: boolean; deadline?: number | null; noHota?: boolean; rules?: RuleOverrides | null }
  /** The host makes a computer colour an ally of the friends (or an opponent again), before the start. */
  | { t: "mpAlly"; seat: number; ally: boolean }
  /** Away until then (ms; null: back now): the caretaker plays my turns meanwhile. */
  | { t: "mpVacation"; until: number | null }
  /** The games I'm in (by who I am; nothing without an identity). */
  | { t: "mpMine" }
  /** Out of a game for good: its seat is given up (the computer plays it on). */
  | { t: "mpQuit"; room: string }
  /** Our own town and bonus (before the start; null: random). */
  | { t: "mpPick"; faction?: string | null; bonus?: Bonus | null }
  /** The rooms on this host (the lobby's list). */
  | { t: "mpList" }
  /** The host picks the turn timers (before the start). */
  | { t: "mpClock"; clock: ClockSettings | null }
  | { t: "mpChat"; text: string }
  | { t: "mpStart" }
  /** Where I'm looking now (my allies follow it). */
  | { t: "mpLook"; look: Look }
  /** I'm following my allies' turns: send me their battles to watch (off: stop). */
  | { t: "mpFollow"; on: boolean }
  /** The page went out of sight or came back (its player is told of their turn while it's hidden). */
  | { t: "mpHidden"; hidden: boolean }
  /** The language this page speaks (the host says its pings to this player in it). */
  | { t: "mpLang"; lang: string }
  | { t: "game"; msg: ClientMessage };

export type HostServerMessage =
  | { t: "mpRoom"; room: RoomInfo; you: string }
  /** `code`: what the page acts on (never the English words, which it only shows). */
  | { t: "mpError"; message: string; code?: LobbyErrorCode }
  /** `mine`: the seat's player name when it's the asker's own (an account), to go straight in. */
  | { t: "mpPeek"; room: RoomInfo; mine?: string; /** The asker's own name, when they're known (an account): they join as that. */ you?: string }
  | { t: "mpRooms"; rooms: RoomInfo[] }
  | { t: "mpMine"; games: MyGame[] }
  /** The running clocks, as of when this was sent. */
  | { t: "mpClock"; seats: Record<number, SeatClock> }
  /** `history`: what was said before, sent on joining (not news to announce). */
  | { t: "mpChat"; lines: ChatLine[]; history?: boolean }
  /** Since your last visit (a game played by notification): battles and towns changing hands you missed, oldest first. */
  | { t: "mpRecap"; reports: GameReport[]; /** The day you were last here. */ since?: number; /** What you could have seen the others do on the map meanwhile, oldest first (to watch again). */ replay?: ReplayStep[] }
  /** Where an ally is looking (sent when it changes, and on joining for each ally online). */
  | { t: "mpLook"; seat: number; look: Look }
  /** An ally's battle, to watch while following their turn (a battle update as its fighters get it). */
  | { t: "mpWatch"; seat: number; msg: ServerMessage }
  | { t: "game"; msg: ServerMessage };

/** Host errors the page acts on: a room that is gone. */
export type LobbyErrorCode = "noRoom";
