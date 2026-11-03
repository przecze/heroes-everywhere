// Touch screens: a long press works as the right mouse button (the original's info popups),
// and two fingers pinch to zoom. Taps are ordinary pointer events already.
//
// The one gesture model (2026-10-31, after the owner's notes on holds that did the wrong thing):
// - a tap is Pixi's "pointertap" (never after a long press: held back below);
// - a hold (a finger held still LONG_PRESS_MS, or the right button) is Pixi's "rightdown", and only that: a thing that
//   answers a hold listens to "rightdown" (never "pointerdown" asking for button 2), so whatever lies under it (the
//   HUD's panels that move when held, map/hud/arrange.ts) can see that it is answered and leave it be;
// - what a hold shows goes when it is let go (untilReleased; a finger's stays until the next touch, EXTRAS holdStays),
//   so it has no buttons (dialogs.ts messageBox `held`);
// - "select first, open on the next tap" (the hero and town lists) keeps the selection across the game's updates
//   (map/inbox.ts) and centres in the open part of the view (map/camera.ts centerOn / brought).
import type { Application } from "pixi.js";
import { onPageEnd } from "./pages.ts";
import { extra } from "./settings.ts";

const LONG_PRESS_MS = 450;
const SLOP = 12;

let longPress = false;
interface PinchHandler {
  move: (ratio: number, cx: number, cy: number) => void;
  start?: () => void;
  /** Whether this one takes the pinch now (the latest that wants it does). */
  wants: () => boolean;
}
const pinchHandlers: PinchHandler[] = [];
let pinching: PinchHandler | null = null;

/** True (once) when the touch that just ended was a long press: the map page's own click shouldn't act too (Pixi's taps are held back below). */
export function consumeLongPress(): boolean {
  const v = longPress;
  longPress = false;
  return v;
}

/** Whether the right-button press now arriving is a finger held down (not a mouse's right button). */
export const isTouchLongPress = () => longPress;

/**
 * Called while two fingers pinch: the change of their distance, and the middle point (client px).
 * The latest handler that `wants` the pinch gets it (a window over the map before the map); returns
 * what removes the handler.
 */
export function onPinch(move: (ratio: number, cx: number, cy: number) => void, start?: () => void, wants: () => boolean = () => true): () => void {
  const h = { move, start, wants };
  pinchHandlers.push(h);
  // (Made by a page: it goes with it, pages.ts.)
  const forget = onPageEnd(() => stop());
  const stop = () => {
    forget();
    const i = pinchHandlers.indexOf(h);
    if (i >= 0) pinchHandlers.splice(i, 1);
    if (pinching === h) pinching = null;
  };
  return stop;
}

/**
 * For what shows while the right button (or a long-pressing finger) is held: calls `hide` once the
 * pointer lets go anywhere, or the page loses focus. Listening on the window, not on the thing
 * pressed: that may be redrawn meanwhile (a HUD panel on every state update), and a destroyed
 * object hears no pointerup, which left popups up for good. Returns `hide` (safe to call again).
 */
export function untilReleased(hide: () => void, o: { /** Something to read (a pop-up), not a drag: see below. */ popup?: boolean } = {}): () => void {
  let done = false;
  // A pop-up a finger's hold shows (2026-11-03: it came up under his thumb and went as he slid the thumb off to
  // read it): it stays after the finger lifts, until the next touch anywhere, which only takes it away (EXTRAS
  // holdStays; the map's own hold pop-up, map/holdPopup.ts, has stayed so since 2026-10-25).
  const stays = !!o.popup && longPress && extra("holdStays");
  const remove = () => {
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    window.removeEventListener("pointerdown", next, true);
    window.removeEventListener("blur", end);
  };
  const end = () => {
    if (done) return;
    done = true;
    remove();
    hide();
  };
  let lifted = false;
  const up = () => {
    if (!stays) return end();
    if (lifted) return;
    lifted = true;
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    window.addEventListener("pointerdown", next, true);
  };
  const next = (e: PointerEvent) => {
    // (On the game the touch is the pop-up's close and nothing more: the game doesn't hear it. The page's own
    // buttons, ☰ and Feedback, still work at once.)
    if (e.target instanceof HTMLCanvasElement) (e.stopPropagation(), e.preventDefault());
    end();
  };
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", up, true);
  window.addEventListener("blur", end);
  return end;
}

export function setupTouch(app: Application) {
  const canvas = app.canvas;
  const touches = new Map<number, { x: number; y: number }>();
  let timer = 0;
  let pressed: { id: number; x: number; y: number } | null = null;
  let rightDown = false;
  let pinchDist = 0;

  const fake = (type: "pointerdown" | "pointerup", x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 2, buttons: type === "pointerdown" ? 2 : 0, pointerType: "mouse", pointerId: 9999, clientX: x, clientY: y, isPrimary: true }));

  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    longPress = false;
    if (touches.size === 1) {
      pressed = { id: e.pointerId, x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        // Held still: show what the right button shows, until the finger lifts.
        timer = 0;
        rightDown = true;
        longPress = true;
        fake("pointerdown", pressed!.x, pressed!.y);
      }, LONG_PRESS_MS);
    } else {
      cancel();
      const [a, b] = [...touches.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinching = [...pinchHandlers].reverse().find((h) => h.wants()) ?? null;
      pinching?.start?.();
    }
  });
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > SLOP) cancel();
      if (touches.size === 2 && pinchDist > 0) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 0) pinching?.move(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinchDist = d;
      }
    },
    { capture: true },
  );
  const end = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.delete(e.pointerId);
    cancel();
    if (rightDown && pressed?.id === e.pointerId) {
      rightDown = false;
      fake("pointerup", e.clientX, e.clientY);
    }
    if (touches.size < 2) pinchDist = 0;
    if (!touches.size) pressed = null;
  };
  window.addEventListener("pointerup", end, { capture: true });
  window.addEventListener("pointercancel", end, { capture: true });
  // Lifting the finger after a long press only ends the popup: no tap for what was held (a button
  // that would act, a stack that would be picked). Nor is the right button's release (the long
  // press's own) a tap: Pixi sends pointertap for every button and most handlers don't ask which.
  // Held back where Pixi sends them (listeners on the stage don't hear them: it isn't interactive).
  const boundary = app.renderer.events.rootBoundary;
  const dispatch = boundary.dispatchEvent.bind(boundary);
  boundary.dispatchEvent = (e, type) => {
    const t = type ?? e.type;
    const p = e as { pointerType?: string; button?: number };
    if ((t === "pointertap" || t === "tap" || t === "click") && (p.button === 2 || (longPress && p.pointerType === "touch"))) return;
    dispatch(e, type);
  };
  // No browser menu on a long press over the game.
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}
