// Drawing only as often as the picture changes: the screens' own animations step every 100-180 ms
// (the adventure map's water and flags 180, a battle's idle creatures 100), yet the canvas was redrawn
// 60 times a second while nothing moved, which on a phone is the GPU (and battery) busy for nothing.
// Idle, the game draws 20 frames a second; any input, a walk, a fight's blow or a scroll brings back
// the full rate at once. A ticker listener added for a moment (an animation) counts as busy until it
// is removed; the screens' standing listeners are added with steadyTick.
import type { Application, Ticker, TickerCallback } from "pixi.js";

/** Frames a second while nothing moves. */
const IDLE_FPS = 20;
/**
 * The full rate's ceiling: 60 frames a second, as the original. A phone with a 120 Hz screen drew every frame twice as
 * often for nothing (the creatures step every 100 ms), and in a battle with the magnifier the field is drawn twice a
 * frame: the owner's phone ran at 120 and froze for 0.5 to 2.3 s while aiming (2026-11-02).
 */
const FULL_FPS = 60;
/** How long after the last input the full rate stays. */
const AWAKE_MS = 1000;

const steady = new WeakSet<object>();
const transient = new Set<object>();
const awake: (() => boolean)[] = [];
let lastInput = 0;
let governed: Ticker | null = null;
let drawn = 0;

/** Frames drawn so far (the agent API's frames(), for measuring). */
export const framesDrawn = () => drawn;

/** A screen's standing ticker listener (its idle animations): it doesn't keep the full rate on. */
export function steadyTick<T>(app: Application, fn: TickerCallback<T>, context?: T, priority?: number) {
  steady.add(fn);
  app.ticker.add(fn, context, priority);
}

/** Something outside the ticker that needs the full rate while it lasts (the map scrolling at the screen's edge). */
export function keepAwake(fn: () => boolean) {
  awake.push(fn);
}

/** Full rate now (and for a moment). */
export function wake() {
  lastInput = performance.now();
  if (governed && governed.maxFPS !== FULL_FPS) governed.maxFPS = FULL_FPS;
}

export function governFrameRate(app: Application) {
  steadyTick(app, () => void drawn++);
  // (?fullfps=1: always the full rate, to compare.)
  if (new URLSearchParams(location.search).has("fullfps")) return;
  const ticker = app.ticker;
  governed = ticker;
  const add = ticker.add.bind(ticker);
  const addOnce = ticker.addOnce.bind(ticker);
  const remove = ticker.remove.bind(ticker);
  ticker.add = ((fn: TickerCallback<unknown>, context?: unknown, priority?: number) => {
    if (!steady.has(fn)) {
      transient.add(fn);
      wake();
    }
    return add(fn, context, priority);
  }) as Ticker["add"];
  ticker.addOnce = ((fn: TickerCallback<unknown>, context?: unknown, priority?: number) => {
    wake();
    return addOnce(fn, context, priority);
  }) as Ticker["addOnce"];
  ticker.remove = ((fn: TickerCallback<unknown>, context?: unknown) => {
    transient.delete(fn);
    return remove(fn, context);
  }) as Ticker["remove"];
  for (const type of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "touchstart", "touchmove"]) window.addEventListener(type, wake, { capture: true, passive: true });
  setInterval(() => {
    const busy = transient.size > 0 || performance.now() - lastInput < AWAKE_MS || awake.some((f) => f());
    ticker.maxFPS = busy ? FULL_FPS : IDLE_FPS;
  }, 200);
}
