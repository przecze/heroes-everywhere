// Every move of yours, kept with the timeline point it led to: the adventure actions, the battle actions and the
// auto-combat switches sent to the game server, in order, with the time. A point's state and the moves after it give
// the whole game back move by move: how people really play, for teaching the computer to play like them (the owner,
// 2026-10-31: "a growing database of generally how humans play the game"). Kept in this browser until the next point
// is taken (so a closed tab or a day offline loses nothing), then packed with that point and sent up with it.
import { storage } from "../map/storage.ts";

export interface Move {
  /** When (ms since 1970). */
  at: number;
  /** The game (gameId). */
  game: string;
  /** The message as sent: { t: "advAct" | "act" | "control", ... }. */
  m: unknown;
}

const KEY = "heroes.timeline.moves";
/** Moves kept waiting at most (a long day of a big map is some hundreds). */
const MAX = 5000;

let moves: Move[] = (() => {
  try {
    const v = JSON.parse(storage(KEY) ?? "[]") as Move[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
})();

let timer = 0;
const keep = () => {
  if (typeof window === "undefined") return void storage(KEY, JSON.stringify(moves));
  if (timer) return;
  timer = window.setTimeout(() => ((timer = 0), storage(KEY, JSON.stringify(moves))), 1000);
};
if (typeof window !== "undefined") addEventListener("pagehide", () => storage(KEY, JSON.stringify(moves)));

/** A message the page sent to the game server: kept if it is a move. */
export function noteMove(m: { t: string }, game: string | undefined) {
  if (!game || (m.t !== "advAct" && m.t !== "act" && m.t !== "control")) return;
  moves.push({ at: Date.now(), game, m: structuredClone(m) });
  if (moves.length > MAX) moves.splice(0, moves.length - MAX);
  keep();
}

/** The moves of a game since its last point, handed over (they go with the point being taken). */
export function takeMoves(game: string): Move[] {
  const out = moves.filter((x) => x.game === game);
  if (!out.length) return out;
  moves = moves.filter((x) => x.game !== game);
  keep();
  return out;
}
