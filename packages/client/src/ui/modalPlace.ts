// Where a pop-up window goes and how big (ui/modals.ts's Modals.show), worked out from the screen as given: no DOM, no
// Pixi, so every layout's placement is tested (test/modalPlace.test.ts).

/** The classic screen the windows are drawn for (kit.ts SCREEN_W x SCREEN_H; imports nothing, to stay testable in node). */
const SCREEN_W = 800;
const SCREEN_H = 600;

/** The screen a window is placed on: canvas pixels, as ui/screen.ts reads them. */
export interface PlaceScreen {
  w: number;
  h: number;
  ox: number;
  oy: number;
  touch: boolean;
  /** One-handed: the thumb's side (screen.ts oneHand()). */
  hand: "left" | "right" | null;
  /** The navigation bar's room on the right (screen.ts navBarRight()). */
  navBar: number;
  /** The page's own buttons (☰, Feedback) over the canvas (screen.ts pageButtons()). */
  pageButtons: { left: number; right: number; bottom: number } | null;
  /** The small windows' touch scale for a w x h window (screen.ts touchScale). */
  touchScale: (w: number, h: number) => number;
}

/** What a window asks for (Modals.show's options that decide where it goes). */
export interface PlaceOpts {
  /** Where (a function: worked out again on a change of layout). */
  x?: number | (() => number);
  y?: number | (() => number);
  /** A screen laid out for the touch layout itself: no extra Close, no pinch zoom. */
  own?: boolean;
  /** A small window that is itself a set of choices (a picker's grid): one-handed it goes under the thumb, whole. */
  underThumb?: boolean;
}

export interface Placement {
  /** The window's scale and its position (in the modal layer, which is centred: the canvas offset taken off). */
  k: number;
  x: number;
  y: number;
  /** One-handed: the window's buttons come again in the thumb's third on this side (Modals' handRail). */
  rail: "left" | "right" | null;
  /** Two fingers zoom into it and move it about (a screen-sized window dense on a phone). */
  pinch: boolean;
}

/** A window at least this big is "screen-sized" (Options, the Town Hall, the hero): it fits whole rather than grows. */
const isBig = (w: number, h: number) => w >= 500 || h >= 450;

/** Places a w x h window on the screen. */
export function placeWindow(w: number, h: number, opts: PlaceOpts, s: PlaceScreen): Placement {
  // Touch layout: small centred windows (messages, choices, recruiting) grow to fit the screen.
  const free = opts.x === undefined && opts.y === undefined;
  // One-handed: a small window goes in the two thirds away from the thumb, its buttons again in
  // the thumb's third (handRail).
  // (A bigger one too, Options, when it fits there hardly smaller.)
  const near = free && !opts.own ? s.hand : null;
  // One-handed, a picker: in the thumb's third, as big as fits there under the page's buttons, at the foot.
  if (near && opts.underThumb) {
    const third = s.w / 3;
    const x0 = near === "right" ? 2 * third : 8;
    const x1 = near === "right" ? s.w - s.navBar - 8 : third;
    const top = (s.pageButtons?.bottom ?? 48) + 8;
    const kt = Math.min(Math.max(1, s.touchScale(w, h)), (x1 - x0) / w, (s.h - top - 8) / h);
    return { k: kt, x: Math.round(near === "right" ? x1 - w * kt : x0) - s.ox, y: Math.round(s.h - 8 - h * kt) - s.oy, rail: null, pinch: false };
  }
  const away = near && farRoom(near, s);
  // (A screen-sized one when the thumb's third costs it little: sideways the height bounds it anyway, so it comes out
  // nearly as big there as across the whole screen, and its buttons get to the thumb.)
  const whole = s.touch && isBig(w, h) ? bigRoom(w, h, s, false).k : 1;
  const fits = away && Math.min(away.w / w, (s.h - 16) / h) >= 0.85 * whole;
  const hand = near && (!isBig(w, h) || fits) ? near : null;
  const far = hand && farRoom(hand, s);
  const big = isBig(w, h);
  // Touch layout: a screen-sized window fits whole on the page, clear of the page's own buttons and
  // the navigation bar (between the corner buttons or under them, whichever leaves it bigger).
  const room = free && !hand && big && s.touch && !opts.own ? bigRoom(w, h, s) : null;
  const k = room ? room.k : free ? (far ? Math.max(0.5, Math.min(s.touchScale(w, h), far.w / w, (s.h - 16) / h)) : s.touchScale(w, h)) : 1;
  const at = (v: number | (() => number) | undefined, mid: number) => (typeof v === "function" ? v() : (v ?? mid));
  const pos = room
    ? { x: Math.round(room.x + (room.w - w * k) / 2 - s.ox), y: Math.round(room.y + (room.h - h * k) / 2 - s.oy) }
    : { x: at(opts.x, far ? Math.round(far.x + (far.w - w * k) / 2 - s.ox) : Math.round((SCREEN_W - w * k) / 2)), y: at(opts.y, Math.round((SCREEN_H - h * k) / 2)) };
  // Touch layout: screen-sized windows are dense on a phone; two fingers zoom into them and move them about.
  return { k, ...pos, rail: hand, pinch: s.touch && !opts.own && !hand && k <= 1 && big };
}

/**
 * Touch layout: where a w x h window fits biggest clear of the page's own buttons and the navigation bar: between the
 * corner buttons, or under them; canvas pixels. Never above its size, unless it is narrower than the screen: then up to
 * the small windows' touch scale (upright, a 400-wide window such as the Town Hall's Build came out half the screen
 * wide in tiny type: the owner, 2026-10-26 21:49 "Dialog bigger").
 */
export function bigRoom(w: number, h: number, s: PlaceScreen, grow = true): { x: number; y: number; w: number; h: number; k: number } {
  const m = 4;
  const nav = s.navBar;
  const pb = s.pageButtons;
  const right = Math.min(s.w - nav, pb ? pb.right : s.w) - m;
  const rooms = [{ x: (pb?.left ?? 0) + m, y: m, w: right - (pb?.left ?? 0) - m, h: s.h - 2 * m }];
  if (pb && pb.bottom) rooms.push({ x: m, y: pb.bottom + m, w: s.w - nav - 2 * m, h: s.h - pb.bottom - 2 * m });
  const most = grow ? Math.max(1, s.touchScale(w, h)) : 1;
  const sized = rooms.map((r) => ({ ...r, k: Math.min(most, r.w / w, r.h / h) }));
  return sized.reduce((a, r) => (r.k > a.k ? r : a));
}

/** One-handed: the screen's two thirds away from the thumb (canvas pixels), where a small window goes. */
export function farRoom(hand: "left" | "right", s: PlaceScreen): { x: number; w: number } {
  const third = s.w / 3;
  return hand === "right" ? { x: 8, w: 2 * third - 16 } : { x: third + 8, w: s.w - s.navBar - third - 16 };
}

/**
 * One-handed: the grid of `n` finger-sized buttons in the thumb's third, under the page's own buttons (style.css puts
 * them on that side), top to bottom, two columns when one doesn't fit; the i-th button's box in canvas pixels.
 */
export function railGrid(n: number, hand: "left" | "right", finger: number, s: PlaceScreen): { w: number; h: number; at: (i: number) => { x: number; y: number } } {
  const third = s.w / 3;
  const x0 = hand === "right" ? 2 * third : 0;
  const x1 = hand === "right" ? s.w - s.navBar : third;
  const top = (s.pageButtons?.bottom ?? 48) + 8;
  const gap = Math.round(finger / 4);
  const cols = n * (finger * 1.4 + gap) > s.h - top - 8 ? 2 : 1;
  const bw = Math.min(Math.round(finger * 4), Math.floor((x1 - x0 - 16 - (cols - 1) * gap) / cols));
  const rows = Math.ceil(n / cols);
  const bh = Math.max(finger, Math.min(Math.round(finger * 1.4), Math.floor((s.h - top - 8 - (rows - 1) * gap) / rows)));
  const y0 = Math.max(top, Math.round((s.h - rows * bh - (rows - 1) * gap) / 2));
  const left = Math.round((x0 + x1) / 2 - (cols * bw + (cols - 1) * gap) / 2);
  return { w: bw, h: bh, at: (i) => ({ x: left + (i % cols) * (bw + gap), y: y0 + Math.floor(i / cols) * (bh + gap) }) };
}
