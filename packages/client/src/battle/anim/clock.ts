// The battle's one clock: every wait, tween and frame step of a battle runs on it, driven by the real time
// that passed (never by how often the screen refreshes, so a 30, 60 or 120 Hz screen shows the same thing),
// at the speed set (pace.ts gives the normal times). Waits marked `real` keep their time whatever the speed.
// When it hurries (the agents' fast mode, quick combat, an action fast-forwarded) everything finishes at once,
// so an action is always played to its end state before the next begins: two never run over each other.

interface Run {
  el: number;
  ms: number;
  real: boolean;
  step: (k: number) => void;
  resolve: () => void;
}

/** Waits and tweens running now on any battle's clock (a feedback note says what was still playing). */
export let clockRuns = 0;

export class BattleClock {
  private runs = new Set<Run>();
  private hurry = 0;
  private readonly finishers = new Set<() => void>();

  /**
   * `speed`: times normal now. `instant`: always hurrying (fast mode). `busy`: told when the first wait
   * starts (the frame rate goes up for it).
   */
  private readonly speed: () => number;
  private readonly instant: () => boolean;
  private readonly busy: () => void;

  constructor(speed: () => number, instant: () => boolean = () => false, busy: () => void = () => {}) {
    this.speed = speed;
    this.instant = instant;
    this.busy = busy;
  }

  /** Moves every running wait on by a frame's real milliseconds. */
  advance(realMs: number) {
    if (!this.runs.size) return;
    const k = this.speed();
    for (const r of [...this.runs]) {
      r.el += r.real ? realMs : realMs * k;
      this.step(r, r.el >= r.ms);
    }
  }

  private step(r: Run, last: boolean) {
    try {
      r.step(last ? 1 : Math.min(1, r.el / r.ms));
    } catch {
      // (A picture destroyed under a tween: it ends there; a ticker must never throw.)
      last = true;
    }
    if (!last) return;
    if (this.runs.delete(r)) clockRuns--;
    r.resolve();
  }

  /** Everything finishes at once: fast mode, or an action being fast-forwarded. */
  get hurrying(): boolean {
    return this.hurry > 0 || this.instant();
  }

  /** Waits being played out (the frame rate's "something moves"). */
  get running(): boolean {
    return this.runs.size > 0;
  }

  /** Calls `fn` with 0..1 over `ms` (normal-speed milliseconds unless `real`); at once while hurrying. */
  tween(ms: number, fn: (k: number) => void, real = false): Promise<void> {
    if (this.hurrying || !(ms > 0)) {
      try {
        fn(1);
      } catch {
        // as in step
      }
      return Promise.resolve();
    }
    if (!this.runs.size) this.busy();
    return new Promise((resolve) => (clockRuns++, this.runs.add({ el: 0, ms, real, step: fn, resolve })));
  }

  wait(ms: number, real = false): Promise<void> {
    return this.tween(ms, () => {}, real);
  }

  /**
   * Steps through `count` frames at `fps`, calling `onFrame(i)` once as each frame comes up (from the time
   * passed: a slow phone skips frames instead of slowing down); resolves after the last frame's time.
   */
  frames(count: number, fps: number, onFrame: (i: number) => void, real = false): Promise<void> {
    if (count <= 0) return Promise.resolve();
    let shown = -1;
    return this.tween(
      (count * 1000) / fps,
      (k) => {
        // (A hair over, so a frame that is due exactly now is not a float's rounding late.)
        const i = Math.min(count - 1, Math.floor(k * count + 1e-9));
        if (i !== shown) onFrame((shown = i));
      },
      real,
    );
  }

  /** Something that ends outside the clock's waits (a creature's group playing out): finished too when the clock hurries. */
  onHurry(finish: () => void): () => void {
    this.finishers.add(finish);
    return () => this.finishers.delete(finish);
  }

  /** Every wait under way ends now, at its end state. */
  finishAll() {
    for (const f of [...this.finishers]) f();
    for (const r of [...this.runs]) this.step(r, true);
  }

  /**
   * Plays `p` out at once: what is running finishes, and so does everything it starts until it ends.
   * The battle's watchdog uses it for an action that takes far too long, instead of starting the next one over it.
   */
  async fastForward<T>(p: Promise<T>): Promise<T> {
    this.hurry++;
    try {
      this.finishAll();
      return await p;
    } finally {
      this.hurry--;
    }
  }

  /** The battle was reset or closed: every wait ends without its last step (its pictures may be gone). */
  stop() {
    const runs = [...this.runs];
    this.runs.clear();
    for (const r of runs) r.resolve();
  }
}
