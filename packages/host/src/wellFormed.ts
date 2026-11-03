// What the host takes from a browser: each message checked for its kind and its fields' types before a room sees it
// (rooms.ts message()), and the lobby's clock brought within reason. Split out of rooms.ts (Refactor queue, 2026-10-31).
import type { ClockSettings, HostClientMessage, LobbyErrorCode } from "./protocol.ts";

/** A player's mistake, said back to them (`code`: what the page acts on, never the English words). */
export class LobbyError extends Error {
  readonly code?: LobbyErrorCode;
  constructor(message: string, code?: LobbyErrorCode) {
    super(message);
    this.code = code;
  }
}

/** A message as a browser sends it: an object of a known kind with its fields of the right types (else a LobbyError). */
export function wellFormed(m: unknown): asserts m is HostClientMessage {
  const bad = () => new LobbyError("That message makes no sense to the host.");
  if (!m || typeof m !== "object" || typeof (m as { t?: unknown }).t !== "string") throw bad();
  const o = m as Record<string, unknown>;
  const str = (k: string, max = 200) => {
    if (typeof o[k] !== "string" || (o[k] as string).length > max) throw bad();
  };
  switch (o.t) {
    case "mpCreate":
      return (str("name", 40), str("map", 300));
    case "mpJoin":
      return (str("room", 20), str("name", 40));
    case "mpPeek":
      return str("room", 20);
    case "mpSeat":
      if (!Number.isInteger(o.seat)) throw bad();
      return;
    case "mpAlly":
      if (!Number.isInteger(o.seat) || typeof o.ally !== "boolean") throw bad();
      return;
    case "mpVacation":
      if (o.until !== null && !Number.isFinite(o.until)) throw bad();
      return;
    case "mpMode":
      if (o.turnMode !== "simultaneous" && o.turnMode !== "sequential") throw bad();
      if (o.simUntil !== undefined && o.simUntil !== null && !Number.isFinite(o.simUntil)) throw bad();
      if (o.deadline !== undefined && o.deadline !== null && !Number.isFinite(o.deadline)) throw bad();
      return;
    case "mpPick":
      if (![undefined, null].includes(o.faction as null) && typeof o.faction !== "string") throw bad();
      if (![undefined, null].includes(o.bonus as null) && typeof o.bonus !== "string") throw bad();
      return;
    case "mpClock":
      if (o.clock !== null && (typeof o.clock !== "object" || Array.isArray(o.clock))) throw bad();
      return;
    case "mpChat":
      return str("text", 2000);
    case "mpLook": {
      const l = o.look as Record<string, unknown> | null;
      if (!l || typeof l !== "object" || !["map", "town", "battle"].includes(l.k as string)) throw bad();
      if (l.k === "town" && !Number.isInteger(l.object)) throw bad();
      return;
    }
    case "mpFollow":
      if (typeof o.on !== "boolean") throw bad();
      return;
    case "mpLang":
      return str("lang", 8);
    case "mpHidden":
      if (typeof o.hidden !== "boolean") throw bad();
      return;
    case "mpLeave":
    case "mpStart":
    case "mpList":
    case "mpMine":
      return;
    case "mpQuit":
      return str("room", 20);
    case "game": {
      const g = o.msg as Record<string, unknown> | null;
      if (!g || typeof g !== "object" || typeof g.t !== "string") throw bad();
      if ((g.t === "advAct" || g.t === "act") && (!g.action || typeof g.action !== "object" || typeof (g.action as { type?: unknown }).type !== "string")) throw bad();
      if (g.t === "battleUndoAnswer" && typeof g.yes !== "boolean") throw bad();
      if (g.t === "control" && ((g.side !== 0 && g.side !== 1) || (g.controller !== "ai" && g.controller !== "human"))) throw bad();
      return;
    }
    default:
      throw bad();
  }
}

/** The lobby's clock as sent: whole seconds within reason, or no clock. */
export function validClock(c: ClockSettings | null | undefined): ClockSettings | null {
  if (!c) return null;
  const n = (v: unknown) => Math.max(0, Math.min(24 * 3600, Math.round(Number(v) || 0)));
  const out = { base: n(c.base), turn: n(c.turn), battle: n(c.battle), unit: n(c.unit) };
  return out.base + out.turn > 0 && out.base + out.battle + out.unit > 0 ? out : null;
}
