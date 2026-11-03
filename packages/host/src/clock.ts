// HotA's online turn timers (the chess clock of its multiplayer lobby, after VCMI's TurnTimerInfo):
// a turn timer each day, then a base reserve for the whole game; in a battle a timer for each
// creature's move, then a reserve for the battle, then the base. When a turn's time is all gone the
// turn ends; when a battle's is, the computer fights the rest of it for that player.
import { type AdventureState, activeUnit, battleFor, canAct, controlSide } from "@heroes/core";
import type { ClockSettings, SeatClock } from "./protocol.ts";

/** The lobby's choices (seconds); null: no clock. */
// i18n-keys (the lobby shows the names through the client's `tr`)
export const CLOCK_PRESETS: { name: string; clock: ClockSettings | null }[] = [
  { name: "No time limit", clock: null },
  { name: "Blitz: 1 min turns, 20 s per creature", clock: { base: 120, turn: 60, battle: 60, unit: 20 } },
  { name: "Standard: 2 min turns, 30 s per creature", clock: { base: 300, turn: 120, battle: 120, unit: 30 } },
  { name: "Relaxed: 4 min turns, 1 min per creature", clock: { base: 600, turn: 240, battle: 180, unit: 60 } },
];

interface Running extends SeatClock {
  since: number;
  turnKey: string;
  battleKey: number;
  unitKey: string;
}

/** What has run out: the turn (it ends) or the battle (the computer takes the side). */
export interface Expired {
  seat: number;
  kind: "turn" | "battle";
}

export class TurnClock {
  readonly settings: ClockSettings;
  private readonly seats = new Map<number, Running>();

  constructor(settings: ClockSettings, seats: number[]) {
    this.settings = settings;
    for (const seat of seats) this.seats.set(seat, { base: settings.base * 1000, turn: 0, battle: 0, unit: 0, running: null, since: 0, turnKey: "", battleKey: -1, unitKey: "" });
  }

  /** Time left before this seat runs out, for what it is doing now. */
  private left(c: SeatClock): number {
    return c.running === "turn" ? c.turn + c.base : c.running === "battle" ? c.unit + c.battle + c.base : Infinity;
  }

  /** Charges the time since the last update to the timers in order (turn / creature first, the base last). */
  private charge(c: Running, now: number) {
    let t = Math.max(0, now - c.since);
    c.since = now;
    if (!c.running) return;
    const take = (k: "turn" | "battle" | "unit" | "base") => {
      const d = Math.min(c[k], t);
      c[k] -= d;
      t -= d;
    };
    if (c.running === "turn") take("turn");
    else (take("unit"), take("battle"));
    take("base");
  }

  /** Brings the clocks up to `now` with the game as it stands; returns who has run out. */
  update(s: AdventureState, now: number): Expired[] {
    const out: Expired[] = [];
    for (const [seat, c] of this.seats) {
      this.charge(c, now);
      c.running = null;
      if (s.winner !== undefined || s.players[seat]?.controller !== "human") continue;
      const b = battleFor(s, seat)?.pb.battle;
      if (b && b.winner === null) {
        const u = activeUnit(b);
        const up = b.tactics?.side ?? (u ? controlSide(u) : undefined);
        if (up === undefined || b.sides[up].owner !== seat || b.sides[up].controller !== "human") continue;
        if (c.battleKey !== b.id) (c.battleKey = b.id), (c.battle = this.settings.battle * 1000);
        const unitKey = `${b.round}:${b.active}:${b.tactics ? "t" : ""}:${b.log.length}`;
        if (c.unitKey !== unitKey) (c.unitKey = unitKey), (c.unit = this.settings.unit * 1000);
        c.running = "battle";
      } else if (canAct(s, seat)) {
        // A new day (or, one at a time, this player's turn come round again): a fresh turn timer.
        const turnKey = `${s.day}:${s.turnMode}:${s.turnMode === "sequential" ? s.current : ""}`;
        if (c.turnKey !== turnKey) (c.turnKey = turnKey), (c.turn = this.settings.turn * 1000);
        c.running = "turn";
      }
      if (c.running && this.left(c) <= 0) out.push({ seat, kind: c.running });
    }
    return out;
  }

  /** Time stood still until now (the room was empty): nobody is charged for it. */
  resume(now: number) {
    for (const c of this.seats.values()) c.since = now;
  }

  /** When the next seat runs out (Infinity: nobody's clock is running). */
  nextDeadline(): number {
    let at = Infinity;
    for (const c of this.seats.values()) at = Math.min(at, c.since + this.left(c));
    return at;
  }

  /** Every seat's timers as they stand (ms left; the running ones go on counting down from now). */
  view(): Record<number, SeatClock> {
    return Object.fromEntries([...this.seats].map(([seat, c]) => [seat, { base: c.base, turn: c.turn, battle: c.battle, unit: c.unit, running: c.running }]));
  }
}
