// Playing with a controller in a game console's browser (2026-10-27: the PlayStation 5's browser and its DualSense).
// The platform's half, game-independent: the game hands in what each button does where (PadGame); this layer reads the
// controller (the Gamepad API, standard mapping), moves a cursor of its own and clicks with it, presses the game's own
// hotkeys, and shows what the buttons do: a bar of prompts along the foot of the page and a glyph beside each
// on-screen button a controller button stands for (EXTRAS padPrompts).
//
// The console's browser keeps some buttons for itself: PS (home), Create (captures), Options (the browser's menu) and
// the touchpad are never bound; Circle may be the browser's Back, so Back waits a moment and is dropped when the
// page's history stepped back meanwhile (chrome/layers.ts turns that Back into Escape already). What can't fit on the
// face buttons is a second layer under L2 (held, the bar shows it). Where the browser drives its own cursor with the
// left stick and clicks with Cross (it may not hand the controller to the page at all), the page learns it from the
// trusted mouse events it sees (kept for the next visit) and steps aside; a long press of the click is the right
// click there (the info popups the original shows on a right click).
import { tr } from "../i18n/index.ts";
import { languageChanged } from "../i18n/index.ts";
import { extra } from "../settings.ts";
import { track } from "../usage.ts";
import { menuOpen } from "../chrome/pageMenu.ts";
import { menuViewOpen } from "../chrome/layers.ts";
import { consoleBrowser } from "./device.ts";
// (Its styles go in when the layer starts, setupPad: nothing of it on a page played without a controller.)
import padCss from "./pad.css?inline";

export type PadButton = "cross" | "circle" | "square" | "triangle" | "l1" | "r1" | "l2" | "r2" | "l3" | "r3" | "up" | "down" | "left" | "right";

/** The standard mapping's button indices (a DualSense's in every browser that maps it). 8 Create, 9 Options, 16 PS, 17 touchpad: the console's. */
const INDEX: Record<PadButton, number> = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 };

export interface PadBinding {
  button: PadButton;
  /** What it does, as the prompts say it (translated). */
  label: string;
  /** With L2 held (the second layer). */
  more?: boolean;
  /** The game's own hotkey it presses (KeyboardEvent.key), with Ctrl when `ctrl`. */
  key?: string;
  ctrl?: boolean;
  /** With Shift (the d-pad's hero steps: the arrows alone may scroll the map, EXTRAS arrowsScroll). */
  shift?: boolean;
  /** Or what it does itself. */
  act?: () => void;
  /** Again and again while held (the d-pad's steps). */
  repeat?: boolean;
  /** The on-screen button it stands for (PadGame.locate finds it): its glyph is drawn beside it. */
  near?: string;
  /** Left out of the bar (a glyph beside its button is enough). */
  quiet?: boolean;
  /** Done only once held this long (ms): a ring fills meanwhile, letting go early cancels (End turn: no accidents). */
  hold?: number;
}

export interface PadGame {
  /** Where the player is ("map", "battle", "town", "window", "menu"...): the bindings and the prompts follow it. */
  context(): string;
  bindings(context: string): PadBinding[];
  /** The right stick, each frame it's tilted (-1..1): true when the game moved its own view; else the page under the cursor scrolls. */
  look?(context: string, x: number, y: number, dt: number): boolean;
  /** What the right stick does here, for the prompts (null: nothing, left out). */
  lookLabel?(context: string): string | null;
  /** An on-screen element's rectangle in client pixels (a binding's `near`), or null while it isn't shown. */
  locate?(near: string): DOMRect | null;
}

/** What the browser does by itself, learned from what it sends (kept: the next visit starts knowing). */
type Learned = { browserCursor?: boolean; browserClick?: boolean };
const LEARNED = "heroes.padLearned";
let learned: Learned = {};
try {
  learned = JSON.parse(localStorage.getItem(LEARNED) ?? "{}") as Learned;
} catch {
  // no storage: learned again this visit
}
function learn(k: keyof Learned) {
  if (learned[k]) return;
  learned[k] = true;
  track(`pad:learned:${k}`);
  try {
    localStorage.setItem(LEARNED, JSON.stringify(learned));
  } catch {
    // ignore
  }
}

const onConsole = consoleBrowser() !== null;
/** Cursor speed at full tilt, in screens' widths a second; Fine aim (R2) slows it. */
const SPEED = 0.55;
const FINE = 0.3;
const DEAD = 0.18;
/** A press of the click held this long is the right click (where the browser clicks by itself). */
const HOLD_MS = 450;

let game: PadGame | null = null;
const pos = { x: 0, y: 0 };
let cursorEl: HTMLDivElement;
let cursorImg: HTMLImageElement;
let bar: HTMLDivElement;
let badges: HTMLDivElement;
/** A controller seen through the Gamepad API. */
let apiSeen = false;
/** The last time a trusted mouse event moved / pressed (the browser's own cursor, or a real mouse). */
let realMoveAt = -1e9;
let realDownAt = -1e9;
let stickAt = -1e9;
let popAt = -1e9;

/** The element under the cursor (ours never is: it lets the pointer through). */
const under = (x: number, y: number) => document.elementFromPoint(x, y) ?? document.body;

/** A mouse event of ours at the cursor, as the browser would send it. */
function fire(type: string, x: number, y: number, button: number, buttons: number) {
  const init: PointerEventInit = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true, view: window };
  const el = under(x, y);
  el.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, init) : new MouseEvent(type, init));
  return el;
}
const mask = (button: number) => (button === 2 ? 2 : 1);
function press(x: number, y: number, button: number) {
  fire("pointerdown", x, y, button, mask(button));
  const el = fire("mousedown", x, y, button, mask(button));
  // (A text field or a list takes the focus as under a mouse: the console's keyboard comes up for a text field.)
  const focusable = el.closest<HTMLElement>("input, textarea, select, button, [tabindex]");
  if (focusable) focusable.focus();
}
function release(x: number, y: number, button: number) {
  fire("pointerup", x, y, button, 0);
  fire("mouseup", x, y, button, 0);
  fire(button === 2 ? "contextmenu" : "click", x, y, button, 0);
}
function move(x: number, y: number, buttons: number) {
  fire("pointermove", x, y, 0, buttons);
  fire("mousemove", x, y, 0, buttons);
}

const CODES: Record<string, string> = { Escape: "Escape", Enter: "Enter", " ": "Space", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Tab: "Tab" };
/** The game's own hotkey, as the keyboard would press it (to the focused text field when one has it: the game skips it there). */
export function pressKey(key: string, ctrl = false, shift = false) {
  const code = CODES[key] ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key);
  const init: KeyboardEventInit = { key, code, bubbles: true, cancelable: true, composed: true, ctrlKey: ctrl, shiftKey: shift };
  const target = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
}

/** Back (Circle): Escape, unless the browser took Circle as its Back and the page's history already stepped back. */
function back() {
  if (!onConsole) return pressKey("Escape");
  const at = performance.now();
  setTimeout(() => popAt < at && pressKey("Escape"), 250);
}

/** The ☰ menu or a view over the game is up: a page of HTML, whatever the game's own screen is. */
const where = () => (menuOpen() || menuViewOpen() || document.querySelector("#feedback.open") ? "page" : (game?.context() ?? "page"));

const builtIn = (): PadBinding[] => [
  { button: "cross", label: tr("Select") },
  { button: "square", label: tr("Info (hold)") },
  { button: "circle", label: tr("Back") },
  { button: "r3", more: true, label: tr("Voice feedback"), act: voiceFeedback },
  // (The ☰ button is a small corner far from everything; Options, the controller's own menu key, is the browser's.)
  { button: "l3", more: true, label: tr("Menu"), act: () => document.getElementById("menuToggle")?.click() },
  // (Feedback's box open: Triangle sends it, as OK answers a window; no aiming at its small tick.)
  ...(feedbackSend() ? [{ button: "triangle", label: tr("Send"), act: () => feedbackSend()?.click() } satisfies PadBinding] : []),
];
const feedbackSend = () => document.querySelector<HTMLButtonElement>("#feedback.open form:not([hidden]) button[type=submit]");
function bindings(ctx: string, more: boolean): PadBinding[] {
  const own = ctx === "page" ? [] : (game?.bindings(ctx) ?? []);
  return [...builtIn().filter((b) => !!b.more === more), ...own.filter((b) => !!b.more === more)];
}

/**
 * L2 + R3 on every screen: a voice note to Feedback (2026-10-27: on the console notes are spoken, not typed). Pressed
 * again while it listens: sends what was said, or gives up when nothing was. Where the browser can't record, Feedback's
 * own fallback opens the box with the picture (feedback/button.ts). Whether a console hands over its microphone is
 * counted (`pad:mic:*`).
 */
function voiceFeedback() {
  const note = document.getElementById("voiceNote");
  if (note) {
    const send = note.querySelector<HTMLButtonElement>(".vnSend");
    return void (send && !send.hidden ? send : note.querySelector<HTMLButtonElement>(".vnCancel"))?.click();
  }
  if (!navigator.mediaDevices?.getUserMedia) track("pad:mic:none");
  (document.getElementById("fbVoice") ?? document.getElementById("fbToggle"))?.click();
}

// --- the controller, read each frame ---

const was = new Map<PadButton, boolean>();
const repeats = new Map<PadButton, number>();
/** Cross / Square down through us (the click held), and Cross waiting to learn whether the browser clicks by itself. */
let crossHeld = false;
let squareHeld = false;
let crossWait: { at: number; released: boolean } | null = null;
let layer = false;
let lastFrame = 0;
/** The touchpad (button 17 when the browser lets it through), its last touch, and what a console showed of it. */
const TOUCHPAD = 17;
let touchClick = false;
let lastTouch: { id: number; x: number; y: number } | null = null;
let touchSeen = false;
let gyroSeen = false;

function readPad(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? [];
  for (const p of pads) if (p && p.connected && p.buttons.length >= 16) return p;
  return null;
}

function run(b: PadBinding) {
  track(`pad:${b.more ? "L2+" : ""}${b.button}:${b.key ?? b.label}`);
  if (b.act) b.act();
  else if (b.key) pressKey(b.key, b.ctrl, b.shift);
}

function down(btn: PadButton, now: number) {
  if (btn === "l2") return setLayer(true);
  if (!layer && btn === "cross") {
    if (learned.browserClick) return;
    // (The console's first click this visit: did the browser click by itself? Then it does from now on.)
    if (onConsole) return void (crossWait = { at: now, released: false });
    crossHeld = true;
    return press(pos.x, pos.y, 0);
  }
  if (!layer && btn === "square") {
    squareHeld = true;
    return press(pos.x, pos.y, 2);
  }
  if (!layer && btn === "circle") return back();
  const b = bindings(where(), layer).find((x) => x.button === btn && (x.key || x.act));
  if (!b) return;
  if (b.hold) return void (holding = { b, btn, at: now });
  run(b);
  if (b.repeat) repeats.set(btn, now + 380);
}

/** A binding held to be done (`hold`), since `at`; the ring shows how far. */
let holding: { b: PadBinding; btn: PadButton; at: number } | null = null;
let ring: HTMLDivElement | null = null;
function drawHold(now: number) {
  if (!holding) return void (ring && (ring.hidden = true));
  const p = Math.min(1, (now - holding.at) / (holding.b.hold ?? 1));
  if (p >= 1) {
    const b = holding.b;
    holding = null;
    if (ring) ring.hidden = true;
    return run(b);
  }
  if (!ring) {
    ring = document.createElement("div");
    ring.id = "padHold";
    document.body.append(ring);
  }
  // Around the button it stands for, else over the bar's item.
  const r = (holding.b.near && game?.locate?.(holding.b.near)) || bar.querySelector(`.g-${holding.btn}`)?.getBoundingClientRect() || null;
  if (!r) return;
  const size = Math.max(r.width, r.height) + 18;
  Object.assign(ring.style, { left: `${r.left + r.width / 2 - size / 2}px`, top: `${r.top + r.height / 2 - size / 2}px`, width: `${size}px`, height: `${size}px` });
  // (A custom property only through setProperty.)
  ring.style.setProperty("--p", `${Math.round(p * 360)}deg`);
  ring.hidden = false;
}

/** Moves the cursor of ours by (dx, dy) client pixels (a game's step: a hex in a battle) and shows what is under it. */
export function nudgeCursor(dx: number, dy: number) {
  pos.x = Math.max(0, Math.min(innerWidth - 1, pos.x + dx));
  pos.y = Math.max(0, Math.min(innerHeight - 1, pos.y + dy));
  move(pos.x, pos.y, 0);
  showCursor(true);
}

function up(btn: PadButton) {
  repeats.delete(btn);
  if (holding?.btn === btn) holding = null;
  if (btn === "l2") return setLayer(false);
  if (btn === "cross") {
    if (crossWait) crossWait.released = true;
    if (crossHeld) (crossHeld = false), release(pos.x, pos.y, 0);
  }
  if (btn === "square" && squareHeld) (squareHeld = false), release(pos.x, pos.y, 2);
}

function setLayer(on: boolean) {
  if (layer === on) return;
  layer = on;
  document.body.classList.toggle("padMore", on);
  drawBar(true);
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
  lastFrame = now;
  // The first click's question answered (a moment after it): the browser clicked by itself, or we do.
  if (crossWait && now - crossWait.at > 140) {
    const w = crossWait;
    crossWait = null;
    if (realDownAt >= w.at - 30) learn("browserClick");
    else {
      press(pos.x, pos.y, 0);
      if (w.released) release(pos.x, pos.y, 0);
      else crossHeld = true;
    }
  }
  const pad = readPad();
  if (!pad) return;
  if (!apiSeen) {
    apiSeen = true;
    document.body.classList.add("padLive");
    track(`pad:api:${pad.mapping || "raw"}:${pad.buttons.length}:${pad.id.slice(0, 48)}`);
    drawBar(true);
  }
  for (const [btn, i] of Object.entries(INDEX) as [PadButton, number][]) {
    const b = pad.buttons[i];
    const on = !!b && (b.pressed || b.value > 0.5);
    if (on && !was.get(btn)) down(btn, now);
    else if (!on && was.get(btn)) up(btn);
    was.set(btn, on);
    const next = repeats.get(btn);
    if (on && next !== undefined && now >= next) {
      repeats.set(btn, now + 110);
      const r = bindings(where(), layer).find((x) => x.button === btn && x.repeat);
      if (r) run(r);
    }
  }
  const axis = (i: number) => {
    const v = pad.axes[i] ?? 0;
    return Math.abs(v) < DEAD ? 0 : Math.sign(v) * ((Math.abs(v) - DEAD) / (1 - DEAD)) ** 2;
  };
  const lx = axis(0);
  const ly = axis(1);
  if (lx || ly) {
    stickAt = now;
    // The browser moves its own cursor with this stick: it gets the page's mouse events, ours stays away.
    if (onConsole && realMoveAt > now - 120) learn("browserCursor");
    if (!learned.browserCursor) {
      const k = SPEED * innerWidth * dt * (was.get("r2") ? FINE : 1);
      pos.x = Math.max(0, Math.min(innerWidth - 1, pos.x + lx * k));
      pos.y = Math.max(0, Math.min(innerHeight - 1, pos.y + ly * k));
      move(pos.x, pos.y, (crossHeld ? 1 : 0) | (squareHeld ? 2 : 0));
      showCursor(true);
    }
  }
  // The touchpad as a laptop's (where the browser hands its touches over: Gamepad touchEvents), its click as Cross.
  const touch = (pad as Gamepad & { touchEvents?: { touchId: number; position: ArrayLike<number> }[] }).touchEvents?.[0];
  if (touch && !learned.browserCursor) {
    const [tx, ty] = [touch.position[0], touch.position[1]];
    if (lastTouch && lastTouch.id === touch.touchId) {
      if (!touchSeen) (touchSeen = true), track("pad:touchpad");
      nudgeCursor((tx - lastTouch.x) * innerWidth * 0.6, (ty - lastTouch.y) * innerHeight * 0.6);
    }
    lastTouch = { id: touch.touchId, x: tx, y: ty };
  } else lastTouch = null;
  const pressPad = !!pad.buttons[TOUCHPAD]?.pressed;
  if (pressPad !== touchClick) {
    touchClick = pressPad;
    if (pressPad) down("cross", now);
    else up("cross");
  }
  // Tilting the controller (its gyroscope, where the browser hands it over: Gamepad pose) aims while R2 is held.
  const spin = (pad as Gamepad & { pose?: { angularVelocity?: ArrayLike<number> | null } | null }).pose?.angularVelocity;
  if (spin && was.get("r2") && !learned.browserCursor) {
    if (!gyroSeen) (gyroSeen = true), track("pad:gyro");
    nudgeCursor(-(spin[1] ?? 0) * innerWidth * 0.35 * dt, -(spin[0] ?? 0) * innerHeight * 0.35 * dt);
  }
  drawHold(now);
  const rx = axis(2);
  const ry = axis(3);
  if (rx || ry) {
    const ctx = where();
    if (!game?.look?.(ctx, rx, ry, dt)) scrollUnder(rx, ry, dt);
  }
}

/** The right stick over HTML: the nearest scrolling box under the cursor scrolls (else a wheel at the cursor, for the canvas). */
function scrollUnder(x: number, y: number, dt: number) {
  const dy = y * 1400 * dt;
  const dx = x * 1400 * dt;
  for (let el: Element | null = under(pos.x, pos.y); el; el = el.parentElement) {
    const s = getComputedStyle(el);
    if ((el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(s.overflowY)) || (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(s.overflowX))) {
      el.scrollBy(dx, dy);
      return;
    }
  }
  under(pos.x, pos.y).dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, deltaX: dx, deltaY: dy }));
}

// --- the cursor of ours: the picture the page's own cursor has at that spot ---

const ARROW =
  "data:image/svg+xml," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34"><path d="M1 1 L1 28 L8 21 L13 32 L18 30 L13 19 L23 19 Z" fill="#f0d27a" stroke="#000" stroke-width="2"/></svg>');
let cursorShown = false;
let pictureAt = 0;
function showCursor(on: boolean) {
  if (on !== cursorShown) cursorEl.hidden = !(cursorShown = on);
  cursorEl.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
  const now = performance.now();
  if (on && now - pictureAt > 90) {
    pictureAt = now;
    const css = getComputedStyle(under(pos.x, pos.y)).cursor;
    const m = /url\(["']?([^"')]+)["']?\)\s*(\d+)?\s*(\d+)?/.exec(css);
    const src = m ? m[1] : ARROW;
    if (cursorImg.getAttribute("src") !== src) cursorImg.src = src;
    cursorImg.style.transform = m ? `translate(${-(+(m[2] ?? 0))}px, ${-(+(m[3] ?? 0))}px)` : "";
  }
}

// --- the prompts: the bar along the foot, and glyphs beside the buttons on screen ---

const GLYPH: Record<PadButton, string> = { cross: "✕", circle: "○", square: "□", triangle: "△", l1: "L1", r1: "R1", l2: "L2", r2: "R2", l3: "L3", r3: "R3", up: "▲", down: "▼", left: "◀", right: "▶" };
export const glyph = (b: PadButton) => `<i class="padGlyph g-${b}">${GLYPH[b]}</i>`;
const prompts = () => extra("padPrompts");

let drawn = "";
function drawBar(force = false) {
  if (!bar) return;
  bar.hidden = !prompts();
  if (bar.hidden) return void (badges.hidden = true);
  const ctx = where();
  const key = `${ctx}|${layer}|${apiSeen}|${learned.browserClick}`;
  if (key === drawn && !force) return;
  drawn = key;
  // No controller through the page (the browser keeps it): only what its own cursor does.
  if (!apiSeen && onConsole) {
    bar.innerHTML = `<span class="padItem">${glyph("cross")}${tr("Select")}</span><span class="padItem">${glyph("cross")}${tr("Info (hold)")}</span><span class="padItem">${glyph("circle")}${tr("Back")}</span>`;
    return;
  }
  bar.innerHTML = barHtml(ctx, layer, game);
}

/** The bar's items for a screen (`more`: L2 held): what `g`'s buttons do there, the platform's three first. */
export function barHtml(ctx: string, more: boolean, g: PadGame | null): string {
  const of = (m: boolean) => [...builtIn().filter((b) => !!b.more === m), ...(ctx === "page" ? [] : (g?.bindings(ctx) ?? [])).filter((b) => !!b.more === m)];
  const list = of(more).filter((b) => !b.quiet);
  // The d-pad's four as one item when they walk / step together.
  const items: string[] = [];
  const pads = list.filter((b) => ["up", "down", "left", "right"].includes(b.button));
  const same = pads.length === 4 && pads.every((b) => b.label === pads[0].label);
  for (const b of list) {
    if (same && pads.includes(b)) {
      if (b === pads[0]) items.push(`<span class="padItem"><i class="padGlyph g-dpad">✚</i>${b.label}</span>`);
      continue;
    }
    items.push(`<span class="padItem">${glyph(b.button)}${b.hold ? tr("%1 (hold)", b.label) : b.label}</span>`);
  }
  const look = ctx === "page" ? tr("Scroll") : g?.lookLabel ? g.lookLabel(ctx) : tr("Scroll");
  const sticks = look ? `<span class="padItem"><i class="padGlyph g-stick">R</i>${look}</span>` : "";
  // (L2's layer named only where it holds something.)
  const deeper = of(true).length > 0;
  // (Fine aim waits on L2's bar where there is one: one line on the map's.)
  const fine = `<span class="padItem">${glyph("r2")}${tr("Fine aim")}</span>`;
  const tail = more ? `<span class="padItem padNow">${glyph("l2")}${tr("held")}</span>${fine}` : deeper ? `<span class="padItem">${glyph("l2")}${tr("More")}</span>` : fine;
  return `${sticks}${items.join("")}${tail}`;
}

/** The bar drawn into another document (the UI catalog's frame), with its own styles. */
export function previewBar(doc: Document, ctx: string, more: boolean, g: PadGame) {
  const style = doc.createElement("style");
  style.textContent = padCss;
  const el = doc.createElement("div");
  el.id = "padBar";
  el.innerHTML = barHtml(ctx, more, g);
  doc.head.append(style);
  doc.body.append(el);
  if (more) doc.body.classList.add("padMore");
}

function drawBadges() {
  if (!badges || !prompts() || !game?.locate) return void (badges && (badges.hidden = true));
  badges.hidden = false;
  const out: string[] = [];
  for (const b of bindings(where(), layer)) {
    if (!b.near) continue;
    const r = game.locate(b.near);
    if (!r || r.width < 4) continue;
    out.push(`<span class="padBadge" style="left:${Math.round(r.left)}px;top:${Math.round(r.top)}px">${glyph(b.button)}</span>`);
  }
  const html = out.join("");
  if (badges.innerHTML !== html) badges.innerHTML = html;
}

let started = false;
/** Controller play from now on, the game's buttons from `g` (once; a later page's game replaces the bindings). */
export function setupPad(g: PadGame) {
  game = g;
  if (started) return void drawBar(true);
  started = true;
  document.body.classList.add("padOn");
  const style = document.createElement("style");
  style.textContent = padCss;
  document.head.append(style);
  pos.x = innerWidth / 2;
  pos.y = innerHeight / 2;
  cursorEl = document.createElement("div");
  cursorEl.id = "padCursor";
  cursorEl.hidden = true;
  cursorImg = document.createElement("img");
  cursorImg.alt = "";
  cursorEl.append(cursorImg);
  bar = document.createElement("div");
  bar.id = "padBar";
  badges = document.createElement("div");
  badges.id = "padBadges";
  document.body.append(bar, badges, cursorEl);
  // A real mouse (or the browser's own cursor): ours follows it and steps aside.
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!e.isTrusted || e.pointerType !== "mouse") return;
      realMoveAt = performance.now();
      pos.x = e.clientX;
      pos.y = e.clientY;
      if (performance.now() - stickAt > 300 || learned.browserCursor) showCursor(false);
    },
    true,
  );
  window.addEventListener("pointerdown", (e) => e.isTrusted && e.pointerType === "mouse" && (realDownAt = performance.now()), true);
  addEventListener("popstate", () => (popAt = performance.now()), true);
  holdForRightClick();
  languageChanged.add(() => drawBar(true));
  setInterval(() => (drawBar(), drawBadges()), 250);
  // The page's shape keeps the bar's room: the game lays out again above it.
  drawBar(true);
  dispatchEvent(new Event("resize"));
  requestAnimationFrame(frame);
  track(`pad:on:${onConsole ? "console" : "forced"}`);
  // (The probes put the cursor somewhere at once.)
  if (import.meta.env.DEV) Object.assign(window, { __padPos: () => ({ ...pos }), __padWhere: () => [where(), game?.context()], __padAt: (x: number, y: number) => ((pos.x = x), (pos.y = y), move(x, y, 0), showCursor(true)) });
}

/**
 * Where the browser clicks by itself (its own cursor and Cross, no controller for the page), a long press is the
 * right click: the trusted press is held back until it's known (let go soon: a click; held: the right button; moved:
 * a drag from where it began).
 */
function holdForRightClick() {
  let held: { x: number; y: number; timer: number; as: "right" | "left" | null } | null = null;
  let swallowClick = false;
  const active = () => onConsole && (learned.browserClick || !apiSeen);
  const stop = (e: Event) => (e.stopImmediatePropagation(), e.preventDefault());
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (!e.isTrusted || e.pointerType !== "mouse" || e.button !== 0 || !active()) return;
      stop(e);
      const h: { x: number; y: number; timer: number; as: "right" | "left" | null } = { x: e.clientX, y: e.clientY, as: null, timer: 0 };
      held = h;
      h.timer = window.setTimeout(() => {
        h.as = "right";
        track("pad:holdRight");
        press(h.x, h.y, 2);
      }, HOLD_MS);
    },
    true,
  );
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!held || held.as || !e.isTrusted || Math.hypot(e.clientX - held.x, e.clientY - held.y) < 12) return;
      clearTimeout(held.timer);
      held.as = "left";
      press(held.x, held.y, 0);
    },
    true,
  );
  window.addEventListener(
    "pointerup",
    (e) => {
      if (!held || !e.isTrusted || e.button !== 0) return;
      stop(e);
      const h = held;
      held = null;
      clearTimeout(h.timer);
      swallowClick = true;
      if (h.as === "right") release(e.clientX, e.clientY, 2);
      else if (h.as === "left") release(e.clientX, e.clientY, 0);
      else (press(h.x, h.y, 0), release(h.x, h.y, 0));
    },
    true,
  );
  for (const type of ["mousedown", "mouseup", "click", "contextmenu"])
    addEventListener(
      type,
      (e) => {
        if (!e.isTrusted || !active()) return;
        if (type === "click" && !swallowClick && !held) return;
        if (type === "click") swallowClick = false;
        if ((e as MouseEvent).button === 0 || type === "contextmenu") stop(e);
      },
      true,
    );
}
