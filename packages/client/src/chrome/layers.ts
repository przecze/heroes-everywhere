// The page's layers (docs/layers.md, the owner 2026-10-25), bottom to top:
//   1. the game: its main menu, the adventure map or a battle, with their own windows (the town, New Game...);
//   2. the app's menu: the ☰ panel, and over the game one stack of menu views (a ☰ item's view: chat, My notes,
//      Settings, the catalog, Admin...; a view opened from inside one is nested on it);
//   3. the ☰ and Feedback buttons, always on top, in every state;
//   4. while a note is being given (typed, spoken or marked), Feedback's own parts; everything under them freezes
//      (no input reaches it, the game's picture stands still) until the note is sent or given up.
// Escape and the phone's / browser's Back go down the same order, one step each: a note in progress stops; else
// the ☰ panel closes; else the top menu view steps back (a nested one first) or closes; else the game's own
// Escape (its top window closes; on the map with none, System Options). The stacking order itself is style.css's
// --layer-* values.
import type { Application } from "pixi.js";
import { browsersKey } from "./browserKeys.ts";
import { closeMenu, menuOpen } from "./pageMenu.ts";

export interface MenuView {
  /** Takes it down (and whatever it needs undone). */
  close(): void;
  /** One step back inside it (a window open in Admin's frame); false when there is none and it should close. */
  back?(): boolean;
}

/** The menu views over the game, the front one last. */
const stack: MenuView[] = [];

/**
 * `v` comes up over the game: a ☰ item's view takes the place of whatever menu views were open (one stack at a
 * time), a `nested` one goes on top of the stack. Returns what to call once it closed itself (its own ✓).
 */
export function showMenuView(v: MenuView, nested = false): () => void {
  if (!nested) closeMenuViews();
  stack.push(v);
  return () => {
    const i = stack.indexOf(v);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Every menu view goes: back to the game. */
export function closeMenuViews() {
  for (const v of stack.splice(0).reverse()) v.close();
}

export const menuViewOpen = () => stack.length > 0;

/** A note is being given: the box, the frozen picture of a touch screen, a voice note. */
export const noteGoing = () => !!document.querySelector("#feedback.open, #fbPick, #voiceNote");

/** Our own Escape on its way to its target (stopping the note, or the game's after Back): let through. */
let passing = false;
function pass(target: EventTarget) {
  passing = true;
  try {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  } finally {
    passing = false;
  }
}

/** The note in progress given up, as its own ✕ (or the box's Escape) does. */
function stopNote() {
  const cancel = document.querySelector<HTMLElement>("#voiceNote .vnCancel, #fbPick [data-cancel]");
  if (cancel) return cancel.click();
  const form = document.getElementById("fbForm");
  if (form) pass(form);
}

/** Escape or Back: the top layer's step back. False when it's the game's. */
export function stepBack(): boolean {
  // The Feedback button's modes, shown by a long press (feedback/button.ts): put away first.
  const modes = document.getElementById("fbModes");
  if (modes) return modes.remove(), true;
  if (noteGoing()) return stopNote(), true;
  if (menuOpen()) return closeMenu(), true;
  const top = stack.at(-1);
  if (!top) return false;
  if (!top.back?.()) {
    stack.pop();
    top.close();
  }
  return true;
}

/** The game's answer to a Back with nothing left to step back from (the map asks whether to leave); false: its Escape. */
let bottomBack: (() => boolean) | null = null;
export const onBackAtBottom = (fn: (() => boolean) | null) => void (bottomBack = fn);
let leave = () => {};
/** Leaves the game as Back past its first page would: the page (or tab) before it, or the installed app closed. */
export const leaveApp = () => leave();

/** A step back is being taken: the hash change its traversal fires is not a page change. */
let stepping = false;
export const steppingBack = () => stepping;
let adopt = (url: string) => void history.replaceState(history.state, "", url);
/** The history entry a link just made (a view's hash) becomes one of ours, its address `url` (the game's, the view sets its own). */
export const adoptEntry = (url: string) => adopt(url);

/** Once, first of everything (main.ts): Escape and Back, and the freeze while a note is given. */
export function setupLayers(app: Application) {
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || passing || !stepBack()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
  // Back: the page keeps entries of its own on top of the history (numbered from 1), so Back steps back here
  // instead of leaving the game (or the installed app); under the first, the one Back lands on (`base`) gets one
  // again. `here` is the address as the page last set it (a page and a view change it in place); a step back
  // puts it back, and the hash change that follows is not a page change (steppingBack: main.ts skips it).
  const top = window.top === window; // (not in a frame, as the UI catalog's screens: its entries would be the tab's)
  const n = (st: unknown) => (st as { hotaBack?: number } | null)?.hotaBack ?? 0;
  let at = n(history.state);
  let base = at ? ((history.state as { base?: string }).base ?? "") : location.href;
  let here = location.href;
  let length = history.length;
  const replace = history.replaceState.bind(history);
  history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
    replace(at && !n(data) ? { ...(data as object), hotaBack: at, base } : data, unused, url);
    here = location.href;
  };
  if (top && !at) history.pushState({ hotaBack: (at = 1), base }, "", location.href);
  length = history.length;
  // Chrome on Android skips, on Back, an entry the page sat on while it pushed the next one with no tap since
  // (its history intervention): one entry pushed again after each Back made the second Back leave the app (the owner,
  // 2026-10-26: "first tap closes the town's window, the second closes the app"). So a few entries are kept ready,
  // each pushed during a tap or a key (user activation): that many Backs in a row are steps back in the game.
  // (A page opened by a link in place, as the map from the main menu, is a new entry: made ours, with its own few.)
  const READY = 6;
  let floor = 0;
  const ready = (e: Event) => {
    // (Only a real tap or key gives the page user activation: not our own Escape passed on after a Back.)
    if (!top || !e.isTrusted) return;
    if (!n(history.state) && location.href !== base) {
      replace({ ...(history.state ?? {}), hotaBack: ++at, base }, "", location.href);
      here = location.href;
      floor = at - 1;
    }
    if (n(history.state) !== at || at >= floor + READY) return;
    while (at < floor + READY) history.pushState({ hotaBack: ++at, base }, "", here);
    length = history.length;
  };
  for (const type of ["pointerup", "keydown", "click"]) window.addEventListener(type, ready, { capture: true, passive: true });
  adopt = (url) => {
    if (!top) return;
    at = n(history.state) || at + 1;
    replace({ ...(history.state ?? {}), hotaBack: at, base }, "", url);
    here = location.href;
  };
  // A link or `location.hash = ...` makes a popstate too: a new entry, not a step back (the Navigation API says so
  // where there is one; else the history grew).
  let fresh = false;
  (window as unknown as { navigation?: EventTarget }).navigation?.addEventListener("navigate", (e) => {
    if ((e as Event & { navigationType?: string }).navigationType === "traverse") return;
    fresh = true;
    setTimeout(() => (fresh = false));
  });
  let leaving = false;
  leave = () => {
    if (!top) return;
    leaving = true;
    // Past our own entries and the one under them; where there is nothing before the game (an installed app, a
    // fresh tab) that goes nowhere: the window closes if it may, else Back stands on the first page and the next leaves.
    history.go(-(at + 1));
    setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      window.close();
      history.go(-at);
      // Still here, on the first page: the next tap makes the entries ready again (a Back after it asks again).
      setTimeout(() => ((at = 0), (floor = 0), (leaving = false)), 300);
    }, 400);
  };
  window.addEventListener("popstate", (e) => {
    if (leaving) return;
    const grew = history.length > length;
    length = history.length;
    if (!top || fresh || grew) return;
    const to = n(e.state);
    if (to > at || (!to && location.href !== base)) return void (at = to || at); // (forward, or another page: main.ts's hashchange)
    if (to) {
      at = to;
      replace(e.state, "", here);
    } else history.pushState({ hotaBack: (at = 1), base }, "", here);
    here = location.href;
    length = history.length;
    stepping = true;
    setTimeout(() => (stepping = false));
    if (!stepBack() && !bottomBack?.()) pass(document.body);
  });
  // A note being given freezes the layers under it: no input, the game's picture still.
  let frozen = false;
  const watch = () => {
    const on = noteGoing();
    if (on === frozen) return;
    frozen = on;
    document.body.classList.toggle("noteGoing", on);
    if (on) app.ticker.stop();
    else app.ticker.start();
  };
  new MutationObserver(watch).observe(document.body, { childList: true });
  // (A resize while frozen (a phone turned, the controller's prompts bar changing height) clears the canvas: drawn once again.)
  app.renderer.on("resize", () => frozen && requestAnimationFrame(() => frozen && app.render()));
  const fb = document.getElementById("feedback");
  if (fb) new MutationObserver(watch).observe(fb, { attributes: true, attributeFilter: ["class"] });
  const ours = "#feedback, #fbPick, #voiceNote, .fbFlash, .fbDialog";
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu", "touchstart", "keydown", "keyup"])
    window.addEventListener(
      type,
      (e) => {
        if (!frozen || passing || (e.target as HTMLElement | null)?.closest?.(ours)) return;
        // (Escape is the note's: the keydown handler above already stopped it.)
        e.stopImmediatePropagation();
        // (The browser's own shortcuts still work: a hard reload mid-note.)
        if (type !== "wheel" && type !== "touchstart" && !(e instanceof KeyboardEvent && browsersKey(e))) e.preventDefault();
      },
      { capture: true, passive: false },
    );
}
