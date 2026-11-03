// Multiplayer in the game: the turn clock (HotA's chess timers) over the top of the map, and the
// room's chat lines, which show on the map for a while as the original's messages do.
import { PLAYER_NAMES } from "@heroes/core";
import type { ChatLine, SeatClock } from "../mp.ts";

const SHOWN_MS = 12_000;

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export class MpOverlay {
  private readonly clockEl = document.createElement("div");
  private readonly chatEl = document.createElement("div");
  private seats: Record<number, SeatClock> | null = null;
  private receivedAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Our colour (-1: watching). */
  private readonly me: () => number;

  constructor(me: () => number) {
    this.me = me;
    this.clockEl.className = "mpClock";
    this.clockEl.hidden = true;
    this.chatEl.className = "mpChat";
    document.body.append(this.clockEl, this.chatEl);
  }

  /** The clocks as the host just sent them; they count down here until the next. */
  clock(seats: Record<number, SeatClock>) {
    this.seats = seats;
    this.receivedAt = performance.now();
    this.timer ??= setInterval(() => this.drawClock(), 250);
    this.drawClock();
  }

  say(line: ChatLine) {
    const el = document.createElement("div");
    el.textContent = line.from ? `${line.from}: ${line.text}` : line.text;
    if (!line.from) el.className = "host";
    this.chatEl.append(el);
    while (this.chatEl.children.length > 6) this.chatEl.firstElementChild!.remove();
    setTimeout(() => el.remove(), SHOWN_MS);
  }

  /** Out of the room. */
  clear() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.seats = null;
    this.clockEl.hidden = true;
    this.chatEl.replaceChildren();
  }

  private drawClock() {
    const seats = this.seats;
    const running = seats ? Object.entries(seats).filter(([, c]) => c.running) : [];
    if (!seats || !running.length) return void (this.clockEl.hidden = true);
    const spent = performance.now() - this.receivedAt;
    const me = this.me();
    // Ours when it is running, else whoever's is (one at a time, or the side up in a battle).
    const [seat, c] = running.find(([s]) => Number(s) === me) ?? running[0];
    let t = spent;
    const take = (v: number) => {
      const d = Math.min(v, t);
      t -= d;
      return v - d;
    };
    const parts =
      c.running === "turn"
        ? [`turn ${mmss(take(c.turn))}`, `base ${mmss(take(c.base))}`]
        : [`creature ${mmss(take(c.unit))}`, `battle ${mmss(take(c.battle))}`, `base ${mmss(take(c.base))}`];
    const who = Number(seat) === me ? "You" : PLAYER_NAMES[Number(seat)];
    this.clockEl.textContent = `${who}: ${parts.join(" · ")}`;
    const left = c.running === "turn" ? c.turn + c.base - spent : c.unit + c.battle + c.base - spent;
    this.clockEl.classList.toggle("low", left < 15_000);
    this.clockEl.hidden = false;
  }
}
