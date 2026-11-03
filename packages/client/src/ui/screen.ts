// The canvas is 600 game pixels high. It grows as wide as the window's shape allows (as HotA
// adapts to the screen; on desktops unless Options turn it off), so a wide window or a landscape
// phone isn't letterboxed: the adventure map stretches across the extra width, and the original
// 800x600 screens (windows, towns, battles, menus) sit in the middle; the touch layout (phones and
// tablets, or ?touch=1) adds big touch buttons beside the map and the battlefield.
//
// One model for the way the screen is held (docs/rotation.md): the window's own shape says it, read
// once per frame, and everything follows from that one reading: the layout, the page's turn, the
// body's classes the CSS reads (pageUp / pageLand / pageShort: never `@media (orientation)`, which
// can't see a turned page). The screen's orientation API isn't asked (it arrives apart from the new
// size when the phone turns, and the layouts were made for one with the other's size), and the
// page never locks the screen. ☰ → Rotate turns the page a quarter (the game drawn sideways on an
// upright phone, or upright on one held sideways): a page-only choice, kept over a reload in this
// tab, never stored for the next visit.
import { inDemo } from "../demo.ts";
import type { Application, Container } from "pixi.js";
import { type Settings, extra as extraOn, settings, withSettings } from "../settings.ts";
import { onPageEnd } from "../pages.ts";
import { padWanted } from "../pad/device.ts";

export const CLASSIC_W = 800;
export const CLASSIC_H = 600;
const MAX_W = 1440;
/** CSS pixels the page's corner buttons take at the top of a touch screen (style.css). */
const PAGE_BUTTONS = 50;
/** A fixed interface size on a very big window: at most this much of the map (larger shows it enlarged). */
const MAX_W_FIXED = 2560;
const MAX_H_FIXED = 1440;

/** The canvas size in game pixels, the top left of the 800x600 middle, and the layout in use. */
/** Called after the canvas's CSS scale (screenSize.css) changed: the cursors follow it (cursors.ts). */
export const onCssScale = new Set<() => void>();

/**
 * `turn`: the page turned a quarter by ☰ → Rotate (90: clockwise, the game sideways on an upright screen; -90: the
 * upright layout on a screen held sideways); `sideways`: turned either way (the page's rectangles aren't the screen's).
 */
export const screenSize = { w: CLASSIC_W, h: CLASSIC_H, ox: 0, oy: 0, touch: false, sideways: false, turn: 0 as 0 | 90 | -90, portrait: false, css: 1 };
/** The upright layout (experimental): at most this tall, in game pixels (800 wide). */
const MAX_H_PORTRAIT = 1800;

/**
 * One-handed play (Options → One hand): the side within the thumb's reach on a touch screen held
 * sideways, or null. Menus and New Game don't follow it (both hands for the setup).
 */
export function oneHand(): "left" | "right" | null {
  const s = settings().oneHand;
  return screenSize.touch && !screenSize.portrait && s !== "off" ? s : null;
}

/** A phone-sized touch screen: the 800x600 windows' text is too small to read there (under ~0.85 CSS px a game pixel). */
export function phoneSized(): boolean {
  return screenSize.touch && screenSize.css * CLASSIC_H < 520;
}

let canvas: HTMLCanvasElement | null = null;

/** A pointer position (client pixels) in game pixels, also when the game is drawn sideways. */
export function toGame(clientX: number, clientY: number): { x: number; y: number } {
  if (!canvas) return { x: clientX, y: clientY };
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return { x: 0, y: 0 };
  // Turned a quarter clockwise: the game's x runs down the screen, its y from the right edge leftwards.
  if (screenSize.turn === -90) return { x: ((r.bottom - clientY) / r.height) * screenSize.w, y: ((clientX - r.left) / r.width) * screenSize.h };
  if (screenSize.turn === 90) return { x: ((clientY - r.top) / r.height) * screenSize.w, y: ((r.right - clientX) / r.width) * screenSize.h };
  return { x: ((clientX - r.left) / r.width) * screenSize.w, y: ((clientY - r.top) / r.height) * screenSize.h };
}

/** A pointer movement (client pixels) in game pixels. */
export function toGameDelta(dx: number, dy: number): { x: number; y: number } {
  const a = toGame(0, 0);
  const b = toGame(dx, dy);
  return { x: b.x - a.x, y: b.y - a.y };
}

const listeners = new Set<() => void>();

/**
 * Calls `fn` now and after every layout change; returns what stops it. (A listener that stops itself calls the
 * returned function later, `queueMicrotask(() => stop())`: on its first call, made in here, `stop` isn't set yet,
 * and the release build threw "Cannot access 'B' before initialization" from the main menu's.)
 */
export function onLayout(fn: () => void): () => void {
  listeners.add(fn);
  fn();
  // (Made by a page: it goes with it, pages.ts.)
  const forget = onPageEnd(() => listeners.delete(fn));
  return () => (forget(), listeners.delete(fn));
}

/**
 * A console's TV (2026-10-27, EXTRAS padHud): the map's resource bar half as tall again; the canvas grows by what
 * it takes (game pixels), so the map and the panel keep their room.
 */
export const hudLift = () => (padWanted() && !screenSize.touch && extraOn("padHud") ? 11 : 0);

/**
 * The band along the page's top a camera takes (a punch hole, a notch: the safe area's top, style.css --safe-top, turned
 * with the page), in CSS pixels; 0 without one. Read from a hidden element of the page's own, so it is what the CSS
 * resolved (env() can't be read from a script).
 */
export function cutoutCss(): number {
  if (typeof document === "undefined" || !document.body) return 0;
  let el = document.getElementById("safeProbe");
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "safeProbe" });
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:var(--safe-top, 0px)";
    document.body.append(el);
  }
  return Math.max(0, Math.round(parseFloat(getComputedStyle(el).paddingTop) || 0));
}
/**
 * Upright (the tall layout): the camera's band at the top in canvas pixels, which a screen drawn from the top (its
 * name, its title, the battle's queue) starts under; the map alone runs up under it (2026-11-03: the punch hole
 * over the town's name and the middle of the battle's queue). The page's own buttons go up into the band's corners
 * (style.css body.cornersFree). 0 sideways (the page itself stops beside a camera there) and without a camera.
 */
export const cutoutTop = () => (screenSize.portrait ? Math.ceil(cutoutCss() / screenSize.css) : 0);

/**
 * Upright: where a screen drawn from the top starts, under the page's own buttons and the camera's band (canvas
 * pixels). (It was 84 CSS px whatever showed: with a camera the band, then a bar for ☰ and Feedback alone, then the
 * screen: the owner, 2026-11-03.)
 */
export const uprightTop = () => {
  const p = pageButtons();
  const buttons = p && p.bottom > 0 ? p.bottom : Math.ceil(46 / screenSize.css);
  return Math.max(buttons, cutoutTop()) + Math.ceil(8 / screenSize.css);
};
/**
 * An element's box in canvas pixels, turned with the page (☰ → Rotate): its client rectangle is the screen's, so a
 * turned page's top is the screen's side; every layout that keeps clear of a page element reads it through this (never
 * `getBoundingClientRect()` against the canvas's own rectangle, which was right only unturned). Null: not shown.
 */
export function canvasBox(el: Element | null | undefined): { x: number; y: number; w: number; h: number } | null {
  const r = el?.getBoundingClientRect();
  if (!canvas || !r || !r.width || !r.height) return null;
  const a = toGame(r.left, r.top);
  const b = toGame(r.right, r.bottom);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/**
 * The page's own size and an element's box in it, in CSS pixels turned with the page (☰ → Rotate): what an element
 * with `position: fixed` inside the turned body is placed by (its left and top run along the page, not the screen).
 * Unturned, the window's own.
 */
export function pageSize(): { w: number; h: number } {
  const w = document.documentElement.clientWidth || innerWidth;
  const h = document.documentElement.clientHeight || innerHeight;
  return screenSize.turn ? { w: h, h: w } : { w, h };
}
export function pageRect(el: Element): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || innerWidth;
  const vh = document.documentElement.clientHeight || innerHeight;
  // body.sideways: translateX(100vw) rotate(90deg); body.turnedUp: translateY(100vh) rotate(-90deg) (style.css).
  const at = (x: number, y: number) => (screenSize.turn === 90 ? [y, vw - x] : screenSize.turn === -90 ? [vh - y, x] : [x, y]);
  const [ax, ay] = at(r.left, r.top);
  const [bx, by] = at(r.right, r.bottom);
  const left = Math.min(ax, bx), top = Math.min(ay, by), width = Math.abs(bx - ax), height = Math.abs(by - ay);
  return { left, top, right: left + width, bottom: top + height, width, height };
}

/**
 * The page's own buttons along the top (menu and full screen, Feedback and its mic; style.css moves
 * them about): where the left-hand group ends and the right-hand group begins, and how low they reach,
 * in canvas pixels (turned with the page); null when not laid out.
 */
export function pageButtons(): { left: number; right: number; bottom: number } | null {
  if (!canvas || !canvas.getBoundingClientRect().width) return null;
  let left = 0;
  let right = screenSize.w;
  let bottom = 0;
  for (const id of ["menuToggle", "fbToggle", "fbVoice"]) {
    const r = canvasBox(document.getElementById(id));
    // (On a desktop they sit in the page's bar, above the game: nothing to keep clear.)
    if (!r || r.y > 90 / screenSize.css || r.y + r.h <= 0) continue;
    bottom = Math.max(bottom, Math.ceil(r.y + r.h));
    if (r.x + r.w / 2 < screenSize.w / 2) left = Math.max(left, Math.ceil(r.x + r.w));
    else right = Math.min(right, Math.floor(r.x));
  }
  return { left, right, bottom };
}

/**
 * The page's own buttons lying over the game (☰, Feedback and its mic), wherever style.css put them, each a box in
 * canvas pixels (turned with the page): what a pop-up keeps clear of (ui/blocks/popupPlace.ts).
 */
export function pageButtonBoxes(): { x: number; y: number; w: number; h: number }[] {
  if (!canvas || typeof document === "undefined") return [];
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  for (const id of ["menuToggle", "fbToggle", "fbVoice"]) {
    const el = document.getElementById(id);
    const r = canvasBox(el);
    if (!r || getComputedStyle(el!).visibility === "hidden") continue;
    if (r.x + r.w <= 0 || r.x >= screenSize.w || r.y + r.h <= 0 || r.y >= screenSize.h) continue;
    boxes.push(r);
  }
  return boxes;
}

/** iPhones and iPads: nothing of the system's over the page beyond the safe area (style.css keeps the page inside it). */
const apple = typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/**
 * Game pixels to keep clear at the right of a landscape phone: Android's navigation bar, 72 CSS
 * pixels, less what the safe area at the right already keeps the page from (a camera cutout there);
 * none on an iPhone, whose notch and home bar the safe area covers.
 */
/** A finger's least target on a touch screen, in CSS pixels; `fingerPx`: in canvas pixels. Every layout sizes its targets by it. */
export const FINGER_CSS = 46;
export const fingerPx = () => Math.ceil(FINGER_CSS / screenSize.css);

export const navBarRight = () => {
  // (Upright Android's bar is at the foot, not the right: upright windows kept 72 px off their right for nothing,
  // the Recruit all window came out narrow and to the left: a 2026-11-02 note "This can be scaled up".)
  if (apple || screenSize.portrait) return 0;
  const inset = typeof document !== "undefined" && document.body ? parseFloat(getComputedStyle(document.body).paddingRight) || 0 : 0;
  return Math.ceil(Math.max(0, 72 - inset) / screenSize.css);
};

/**
 * Keeps an 800x600 screen in the middle of a wide (or tall) canvas; `top` (canvas pixels from the
 * top, or null for the middle) puts it higher.
 */
export function centre(c: Container, top?: () => number | null) {
  const stop = onLayout(() => {
    if (c.destroyed) return void queueMicrotask(() => stop());
    c.position.set(screenSize.ox, top?.() ?? screenSize.oy);
  });
}

/** Should the touch layout be used here? ?touch=1 / ?touch=0, then the setting, then the device. */
export function touchLayoutWanted(): boolean {
  // (A welcome card's demo is laid out as each layout in turn by the setting, over the address's own: chrome/settingsWindow.ts.)
  if (inDemo && settings().touchLayout !== "auto") return settings().touchLayout === "on";
  const q = new URLSearchParams(location.search).get("touch");
  if (q === "1") return true;
  if (q === "0") return false;
  const s = settings().touchLayout;
  if (s === "on") return true;
  if (s === "off") return false;
  // (A console's browser is played with its controller: the desktop layout, whatever its pointer says.)
  if (padWanted()) return false;
  return matchMedia("(pointer: coarse)").matches;
}

/** The window's shape as last read (fit), and whether a text field had the keyboard up then. */
let held = { upright: false, w: 0 };

/** The window's shape now: upright when taller than wide. */
function readHeld(): boolean {
  const w = document.documentElement.clientWidth || window.innerWidth;
  const h = document.documentElement.clientHeight || window.innerHeight;
  // The keyboard coming up for a note makes the window wider than tall without the phone turning: a turn changes
  // the width too, so while typing only a new width counts.
  const typing = document.activeElement instanceof HTMLElement && document.activeElement.matches("input, textarea, [contenteditable]");
  if (!(typing && w === held.w && held.w)) held = { upright: h > w, w };
  else held.w = w;
  return held.upright;
}

/** The phone held upright: the window's shape (the one reading the layout was made from). */
export function heldUpright(): boolean {
  return held.w ? held.upright : readHeld();
}

const TURN_KEY = "heroes.turned";
/**
 * ☰ → Rotate's quarter turn of the page: the way the phone was held at the tap ("up" / "side"), or null. For this
 * tab (a reload keeps it, a new visit starts as the phone is held), and only while the phone is held that way: turned
 * for real, the screen turns by itself and the page's turn is dropped.
 */
let turnedAt: "up" | "side" | null = (() => {
  try {
    const t = sessionStorage.getItem(TURN_KEY);
    return t === "up" || t === "side" ? t : null;
  } catch {
    return null;
  }
})();
function keepTurn(t: "up" | "side" | null) {
  turnedAt = t;
  try {
    if (t) sessionStorage.setItem(TURN_KEY, t);
    else sessionStorage.removeItem(TURN_KEY);
  } catch {
    // for this page only
  }
}
/** The page turned now (☰ → Rotate, and the phone still held as it was then). */
export const pageTurned = () => turnedAt !== null && turnedAt === (heldUpright() ? "up" : "side");
/** ☰ → Rotate: the page turned a quarter, or back (laid out again in place). */
export function toggleTurn(on = !pageTurned()) {
  keepTurn(on ? (heldUpright() ? "up" : "side") : null);
  relayoutNow();
}

/** A layout to lay the screen out as, without being on a device like that (the Layouts… previews): the stage's size, the touch layout, the way the phone is held. */
export interface LayoutProbe {
  touch: boolean;
  upright: boolean;
  w: number;
  h: number;
}
let probe: LayoutProbe | null = null;
let previewNow: (items: { probe: LayoutProbe; patch: Partial<Settings> }[], width: number, each: (i: number, c: HTMLCanvasElement) => void) => Promise<void> = async () => {};
/**
 * The current screen laid out as each of these layouts would, copied one by one to canvases `width`
 * wide, then laid out as before. The page's canvas is hidden meanwhile (the layouts finish drawing
 * their pieces a moment after being laid out, so each is waited for), and nothing of it is shown.
 */
export const previewLayouts = (items: { probe: LayoutProbe; patch: Partial<Settings> }[], width: number, each: (i: number, c: HTMLCanvasElement) => void) => previewNow(items, width, each);

let relayoutNow = () => {};
/** Lays the page out as this layout stays (the UI catalog mounts a screen at a layout's size on any window); null: as the device is. */
export function setLayoutProbe(p: LayoutProbe | null) {
  probe = p;
  relayoutNow();
}
/**
 * Lays the page out again in place after a setting the layouts read changed (upright or turned,
 * one-handed): every onLayout listener runs, the game and its open windows carry on.
 */
export const relayout = () => relayoutNow();

/** Started as the installed app (its own window, not a browser tab). */
const installedApp = () => typeof matchMedia === "function" && matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches && !document.fullscreenElement;

/** Sizes the canvas to the page (again on every resize or rotation). */
export function setupScreen(app: Application, stage: HTMLElement) {
  /** `force`: everything laid out again even with the same size (a setting the layouts read changed). */
  const fit = (force = false) => {
    const touch = probe ? probe.touch : touchLayoutWanted();
    const up = probe ? probe.upright : readHeld();
    // ☰ → Rotate (or ?set=sideways:on, for probes): the page a quarter turned. Not while a feedback
    // note is typed (feedback/modes.ts: the keyboard comes up the way the phone is held).
    // (Held another way since the tap: the phone turned for real, the page's turn is dropped.)
    if (!probe && turnedAt && turnedAt !== (up ? "up" : "side")) keepTurn(null);
    const turn: 0 | 90 | -90 = !probe && touch && (turnedAt !== null || (up && settings().sideways === "on")) && !document.body.classList.contains("noteOpen") ? (up ? 90 : -90) : 0;
    // The page's own shape: the window's, swapped when turned.
    const pageUp = turn ? !up : up;
    const sideways = turn !== 0;
    // The upright layout: 800 game pixels across, as tall as the screen's shape allows ("off": the landscape one, small).
    const portrait = touch && pageUp && settings().sideways !== "off";
    const body = document.body.classList;
    body.toggle("portrait", portrait);
    // One-handed: the page's own corner buttons go to the thumb's side (style.css).
    body.toggle("oneHandLeft", touch && !portrait && settings().oneHand === "left");
    body.toggle("oneHandRight", touch && !portrait && settings().oneHand === "right");
    // Where the phone's camera is along its top (☰ → Layouts): the page's own buttons go up into the corners of its
    // band that it leaves free (style.css). Not on iPhones: their clock and battery are in those corners.
    const cam = settings().camera;
    body.toggle("cornersFree", touch && !apple);
    body.toggle("camLeft", cam === "left");
    body.toggle("camMid", cam !== "left" && cam !== "right");
    body.toggle("camRight", cam === "right");
    // The page turned (style.css): sideways on an upright screen, or upright on one held sideways. (A preview's
    // layout is drawn off screen: the page stays as it is.)
    if (!probe) body.toggle("sideways", turn === 90);
    if (!probe) body.toggle("turnedUp", turn === -90);
    // What the CSS reads instead of `@media (orientation)`: the page's own shape, and a short one (a phone sideways).
    body.toggle("pageUp", pageUp);
    body.toggle("pageLand", !pageUp);
    body.toggle("coarse", matchMedia("(pointer: coarse)").matches);
    const sw = probe ? probe.w : stage.clientWidth;
    const sh = probe ? probe.h : stage.clientHeight;
    if (!probe) body.toggle("pageShort", !pageUp && sh <= 500);
    if (!probe) body.toggle("pageLow", !pageUp && sh <= 560);
    if (!sw || !sh) return;
    const wide = touch || settings().wideScreen;
    // Fit: 600 game pixels high, as wide as the window's shape allows (all of it enlarged).
    // A fixed interface size (desktops, wide windows): game pixels of that many screen pixels, so a
    // bigger window shows more of the map, as HD mod's resolutions do; never smaller than 800x600.
    const px = { fit: 0, large: 2, medium: 1.5, small: 1 }[settings().uiSize] ?? 0;
    // (A console's bigger resource bar: a few rows more, as wide as the window's shape then allows.)
    const lift = !touch && padWanted() && extraOn("padHud") ? 11 : 0;
    let w = wide ? Math.max(CLASSIC_W, Math.min(MAX_W, Math.round(((CLASSIC_H + lift) * sw) / sh))) : CLASSIC_W;
    let h = CLASSIC_H + lift;
    if (portrait) {
      w = CLASSIC_W;
      h = Math.max(CLASSIC_H, Math.min(MAX_H_PORTRAIT, Math.round((CLASSIC_W * sh) / sw)));
    } else if (touch && sh >= 700) {
      // Tablets: a band above and below the 800x600 windows for the page's own corner buttons
      // (menu, full screen, Feedback, about 50 CSS pixels), so they never cover a window's corners.
      h = Math.ceil((CLASSIC_H * sh) / (sh - 2 * PAGE_BUTTONS));
      w = Math.max(CLASSIC_W, Math.min(MAX_W, Math.round((h * sw) / sh)));
    } else if (!touch && wide && px) {
      const k = Math.min(px, sh / CLASSIC_H, sw / CLASSIC_W);
      w = Math.max(CLASSIC_W, Math.min(MAX_W_FIXED, Math.floor(sw / k)));
      h = Math.max(CLASSIC_H, Math.min(MAX_H_FIXED, Math.floor(sh / k)));
    }
    const changed = w !== screenSize.w || h !== screenSize.h || touch !== screenSize.touch || turn !== screenSize.turn || portrait !== screenSize.portrait;
    const k = Math.min(sw / w, sh / h);
    // Desktops draw at the screen's own pixels: the canvas as many pixels across as it covers on the
    // screen (up to 3 per game pixel). The interface looks the same (nearest, as the page's crisp
    // enlarging did), but the map zoomed out keeps every pixel of the original's art instead of
    // averaging 2 x 2 of them into one blurry game pixel (2026-11-01: "blurry, too smooth as
    // soon as I zoom out" on desktop, never noticed on the phone, whose pixels are far smaller).
    // Phones stay at game pixels (their GPUs, and nobody saw it there).
    const dpr = window.devicePixelRatio || 1;
    const res = touch || probe ? 1 : Math.min(3, Math.max(1, (Math.floor(w * k) * dpr) / w));
    const resChanged = res !== app.renderer.resolution;
    if (w !== app.screen.width || h !== app.screen.height || resChanged) app.renderer.resize(w, h, res);
    const scaleChanged = k !== screenSize.css || resChanged;
    Object.assign(screenSize, { w, h, ox: Math.round((w - CLASSIC_W) / 2), oy: Math.round((h - CLASSIC_H) / 2), touch, sideways, turn, portrait, css: k });
    app.canvas.style.width = `${Math.floor(w * k)}px`;
    app.canvas.style.height = `${Math.floor(h * k)}px`;
    // Shrunk on the device (upright phones: 800 game pixels in ~780), whole rows of pixels would
    // drop out with the crisp scaling (an 8 read as a 0): smooth then, crisp when enlarged.
    app.canvas.style.imageRendering = (k * dpr) / res < 0.999 ? "auto" : "";
    if (changed || force) for (const fn of [...listeners]) fn();
    if (scaleChanged) for (const fn of [...onCssScale]) fn();
  };
  relayoutNow = () => fit(true);
  const settle = () => new Promise<void>((r) => setTimeout(r, 50));
  previewNow = async (items, width, each) => {
    if (probe) return;
    const shown = app.canvas.style.visibility;
    app.canvas.style.visibility = "hidden";
    try {
      for (const [i, item] of items.entries()) {
        probe = item.probe;
        try {
          await withSettings(item.patch, async () => {
            fit(true);
            await settle();
            app.render();
            const out = document.createElement("canvas");
            out.width = Math.round(width);
            out.height = Math.round((width * app.canvas.height) / app.canvas.width);
            out.getContext("2d")!.drawImage(app.canvas, 0, 0, out.width, out.height);
            each(i, out);
          });
        } finally {
          probe = null;
        }
      }
    } finally {
      probe = null;
      fit(true);
      await settle();
      app.render();
      app.canvas.style.visibility = shown;
    }
  };
  canvas = app.canvas;
  // Pixi's own pointer events go through the same mapping.
  app.renderer.events.mapPositionToPoint = (point, x, y) => {
    const p = toGame(x, y);
    point.x = p.x;
    point.y = p.y;
  };
  // Every sign of a new shape lays out once, on the next frame, from one reading of the window (a turn sends several:
  // the orientation, then the size, a ResizeObserver; in any order, a frame or more apart).
  let queued = 0;
  const later = () => void (queued ||= requestAnimationFrame(() => ((queued = 0), fit())));
  new ResizeObserver(later).observe(stage);
  // The page's own buttons growing or shrinking (Feedback's mic shown, its label changed) move the
  // room the layouts keep clear of them (pageButtons): lay out again.
  let fbSize = "";
  const fb = document.getElementById("feedback");
  if (fb)
    new ResizeObserver(() => {
      const r = fb.getBoundingClientRect();
      const size = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (size !== fbSize) (fbSize = size), fit(true);
    }).observe(fb);
  window.addEventListener("resize", later);
  // Some phones report the turned window's size only a moment after the turn: read it again then.
  const again = () => (later(), [150, 500].forEach((ms) => setTimeout(later, ms)));
  window.addEventListener("orientationchange", again);
  screen.orientation?.addEventListener?.("change", again);
  window.visualViewport?.addEventListener("resize", later);
  // The installed app: Android keeps its own copy of the manifest, refreshed only days after a change, and a copy with
  // the old "landscape" held the screen sideways with the phone upright (2026-10-28: an upright battle drawn
  // sideways, the keyboard sideways for a note). Asking for "any", what the manifest says now (follow the phone),
  // overrides that copy for this run. Not a lock to a side: the phone turns as it is held. Never let go of (an unlock
  // brings the copy's orientation back). Outside the installed app the browser refuses it, and that's fine.
  if (installedApp()) (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.("any")?.catch(() => {});
  // (The probes and the feedback note read the model as it is.)
  Object.assign(window, { __layout: () => ({ ...screenSize, upright: heldUpright(), turned: pageTurned() }), __turnScreen: () => toggleTurn() });
  fit();
  return () => fit();
}

/**
 * How wide to build a window of words that is `desktop` wide on a computer: upright, half the screen, so the windows'
 * doubling (touchScale) fills the width with readable type. Built 760 wide, the About window came out at its own size
 * across a phone held upright, the text a third of a readable size (2026-10-27 11:11: "Too small to read").
 */
export function textWindowWidth(desktop: number): number {
  return screenSize.touch && screenSize.portrait ? Math.min(desktop, Math.floor((screenSize.w - 16) / 2)) : desktop;
}

/** Touch layout: how much to enlarge a small window or popup of this size so a finger can use it (1 elsewhere). */
export function touchScale(w: number, h: number): number {
  if (!screenSize.touch || !w || !h) return 1;
  // Upright the screen is tall: the width is the limit (a message's narrow column fills it, its words then about the
  // size of the upright windows' own: phoneWindow's sheets).
  if (screenSize.portrait) return Math.max(1, Math.min(2.6, (screenSize.h - 160) / h, (screenSize.w - 16) / w));
  return Math.max(1, Math.min(1.75, (CLASSIC_H - 16) / h, (screenSize.w - 16) / w));
}
