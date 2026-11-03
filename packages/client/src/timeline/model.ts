// A game's timeline instead of saved games: one entry per game (its map, your colour and faction), and
// in it the points the game went through, taken by themselves: each new day of yours, and each big
// happening (a battle of yours, a town taken, the game won or lost). Going back to a point and playing
// on from there starts a branch beside the old line, so the timeline is a tree. This file is the
// part without storage or screens: what a point is, when one is taken, what it is called, and where
// it sits when the tree is drawn left to right.
import type { AdventureState } from "@heroes/core";
import { type GameSummary, myColor, summarize } from "../gameSummary.ts";

export type PointKind = "start" | "day" | "battle" | "town" | "won" | "lost" | "here";

export interface TimelinePoint {
  id: string;
  game: string;
  /** The point it was played on from (none: the game's start, or an imported save). */
  parent?: string;
  at: number;
  day: number;
  kind: PointKind;
  /** The happenings since the point before (log lines of the rules, oldest first, at most a few). */
  events: string[];
  /** The log's length and last line: how a later state is told to follow on from this one. */
  logLen: number;
  logTail: string;
  /** The state is whole here (else a change from the parent's). */
  whole: boolean;
  /** Changes since the last whole state, along the line (a whole one every KEYFRAME points). */
  depth: number;
  /** The packed size (bytes). */
  size: number;
  /** Your strongest hero etc. at this point (the card beside the timeline). */
  summary?: GameSummary;
  /** Made on this device and not yet on the server. */
  unsent?: boolean;
  /** How many of your moves led here from the point before (moves.ts; kept beside the state). */
  moves?: number;
  /** Its moves not yet on the server (the point itself is). */
  movesUnsent?: boolean;
  device?: string;
}

export interface TimelineGame {
  id: string;
  mapFile: string;
  /** The map's name when the game began. */
  name: string;
  color: number;
  faction: number;
  createdAt: number;
  updatedAt: number;
  /** How many people play it (hot seat: more than one). */
  humans: number;
  /** The newest point's summary (the games' list). */
  summary?: GameSummary;
  day: number;
  /** Where this device is in the game: the point it last took or went back to. */
  head?: string;
  /** Begun from a saved game of the original. */
  imported?: boolean;
  over?: boolean;
}

/** A whole state every so many points along a line, so going back never patches a long chain. */
export const KEYFRAME = 10;
/** How many happenings a point tells. */
const EVENTS = 4;

/** One game, whatever device or saved copy it is played from: its map and its own seed. */
export const gameId = (s: AdventureState) => `${s.mapFile.replace(/[^\w.-]+/g, "_").slice(0, 60)}-${(s.id >>> 0).toString(36)}`;

/** The moment being played past the last point (not a point yet): drawn and told like one. */
export const nowPoint = (id: string, day: number): TimelinePoint => ({ id, game: "", at: Date.now(), day, kind: "here", events: [], logLen: 0, logTail: "", whole: false, depth: 0, size: 0 });

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const BATTLE = /is victorious|has been defeated|lays siege|surrenders|flee\.$|retreats/;
const CLAIM = /claims|brings the Grail/;
const END = /wins the game|is out of the game/;

/** The log lines added since `p` (it is found by its last line; failing that the last few). */
export function linesSince(s: AdventureState, p: Pick<TimelinePoint, "logLen" | "logTail"> | undefined): string[] {
  if (!p) return [];
  const log = s.log;
  // (The log is cut at its front now and then: look for the last line near where it was.)
  for (let i = Math.min(log.length - 1, p.logLen - 1); i >= Math.max(0, p.logLen - 400); i--) if (log[i] === p.logTail) return log.slice(i + 1);
  const at = log.lastIndexOf(p.logTail);
  return at >= 0 ? log.slice(at + 1) : log.slice(-EVENTS);
}

/** The lines worth telling on the timeline: battles, towns and the Grail, the game's end. */
export const happenings = (lines: string[]) => lines.filter((l) => BATTLE.test(l) || CLAIM.test(l) || END.test(l));

/** Your heroes' names (also those beaten or gone), to tell your battles from the others'. */
const yourNames = (s: AdventureState, color: number) => s.heroes.filter((h) => h.owner === color).map((h) => h.name);

/**
 * Whether the state is worth a point, after `head` (where this device is in the game): a new day on
 * your move, or a big happening of yours. Not in the middle of your battle (its end is the point).
 */
export function pointFor(s: AdventureState, head: TimelinePoint | undefined, yourMove: boolean): { kind: PointKind; events: string[] } | null {
  const color = myColor(s);
  if (s.battles[color]) return null;
  if (!head) return { kind: "start", events: [] };
  const fresh = linesSince(s, head);
  const told = happenings(fresh);
  if (s.winner !== undefined && head.kind !== "won" && head.kind !== "lost") return { kind: s.winner >= 0 && s.players[s.winner]?.team === s.players[color]?.team ? "won" : "lost", events: told.filter((l) => END.test(l)).slice(-EVENTS) };
  if (s.winner !== undefined) return null;
  // Yours alone (the others' doings stay as unseen as on the map): your heroes', your towns', the game's end.
  const names = [...yourNames(s, color), ...s.objects.filter((o) => o.town && o.owner === color && o.name).map((o) => o.name!)];
  const mine = told.filter((l) => END.test(l) || names.some((n) => l.includes(n)));
  if (mine.length) return { kind: mine.some((l) => CLAIM.test(l)) && !mine.some((l) => BATTLE.test(l)) ? "town" : "battle", events: mine.slice(-EVENTS) };
  if (s.day > head.day && yourMove) return { kind: "day", events: mine.slice(-EVENTS) };
  return null;
}

/** A point's descriptor (with the state it was taken from). */
export function describe(s: AdventureState, game: string, parent: TimelinePoint | undefined, kind: PointKind, events: string[]): Omit<TimelinePoint, "id" | "whole" | "depth" | "size"> {
  return {
    game,
    ...(parent ? { parent: parent.id } : {}),
    at: Date.now(),
    day: s.day,
    kind,
    events,
    logLen: s.log.length,
    logTail: s.log[s.log.length - 1] ?? "",
    summary: summarize(s),
  };
}

/** A new game entry for the state. */
export function gameFor(s: AdventureState, name: string, imported = false): TimelineGame {
  const sum = summarize(s);
  const now = Date.now();
  return { id: gameId(s), mapFile: s.mapFile, name, color: sum.color, faction: sum.faction, createdAt: now, updatedAt: now, humans: s.players.filter((p) => p.controller === "human").length, summary: sum, day: s.day, ...(imported ? { imported } : {}) };
}

export interface Placed {
  point: TimelinePoint;
  /** Column (left to right: how far from the start) and lane (top to bottom: the branch). */
  col: number;
  lane: number;
  parent?: Placed;
}

/**
 * Where each point sits: left to right along its line, each branch on a lane of its own below the
 * one it left. The line played most lately stays on the top lane, so the way to the present is
 * a straight row and the branches left behind hang under it.
 */
export function layout(points: TimelinePoint[]): Placed[] {
  const byId = new Map(points.map((p) => [p.id, p]));
  const kids = new Map<string, TimelinePoint[]>();
  const roots: TimelinePoint[] = [];
  for (const p of points) {
    if (p.parent && byId.has(p.parent)) kids.set(p.parent, [...(kids.get(p.parent) ?? []), p]);
    else roots.push(p);
  }
  // The newest moment under each point: the line with the latest one comes first.
  const latest = new Map<string, number>();
  const newest = (p: TimelinePoint): number => {
    let t = latest.get(p.id);
    if (t !== undefined) return t;
    t = p.at;
    for (const k of kids.get(p.id) ?? []) t = Math.max(t, newest(k));
    latest.set(p.id, t);
    return t;
  };
  const order = (list: TimelinePoint[]) => [...list].sort((a, b) => newest(b) - newest(a));
  const out: Placed[] = [];
  let lanes = 0;
  const place = (p: TimelinePoint, col: number, lane: number, parent?: Placed) => {
    // (Iterative along the line: a long game is a long chain.)
    let cur: TimelinePoint | undefined = p;
    let up = parent;
    while (cur) {
      const at: Placed = { point: cur, col, lane, ...(up ? { parent: up } : {}) };
      out.push(at);
      const [next, ...rest] = order(kids.get(cur.id) ?? []);
      for (const k of rest) place(k, col + 1, lanes++, at);
      cur = next;
      up = at;
      col++;
    }
  };
  for (const r of order(roots)) place(r, 0, lanes++);
  return out;
}

/** The line from the start to `id` (oldest first). */
export function lineTo(points: TimelinePoint[], id: string): TimelinePoint[] {
  const byId = new Map(points.map((p) => [p.id, p]));
  const out: TimelinePoint[] = [];
  for (let p = byId.get(id); p; p = p.parent ? byId.get(p.parent) : undefined) {
    out.unshift(p);
    if (out.length > 100000) break;
  }
  return out;
}

/**
 * The point a state opened from somewhere else (a saved game, another device) follows on from:
 * one taken at that very moment, else the latest one of its day or before on the line it came from.
 */
export function pointOf(s: AdventureState, points: TimelinePoint[]): TimelinePoint | undefined {
  const tail = s.log[s.log.length - 1] ?? "";
  const same = points.filter((p) => p.day === s.day && p.logLen === s.log.length && p.logTail === tail);
  if (same.length) return same.sort((a, b) => b.at - a.at)[0];
  const seen = new Set(s.log);
  const before = points.filter((p) => p.day <= s.day && (!p.logTail || seen.has(p.logTail)));
  return before.sort((a, b) => b.day - a.day || b.logLen - a.logLen || b.at - a.at)[0];
}
