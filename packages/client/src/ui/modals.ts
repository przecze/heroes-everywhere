// The pop-up window manager: the stack of windows over the game, their keys, and on touch screens where each goes
// (ui/modalPlace.ts works it out), the one-handed rail of their buttons and two-finger zoom.
import { browsersKey } from "../chrome/browserKeys.ts";
import { type Application, Container, Graphics, Sprite } from "pixi.js";
import { playSound } from "../audio.ts";
import { onPinch } from "../touch.ts";
import { centre, fingerPx, navBarRight, onLayout, oneHand, pageButtons, screenSize, toGame, touchScale } from "./screen.ts";
import { whileWaiting } from "./loadingNote.ts";
import { fast } from "../speed.ts";
import { extra } from "../settings.ts";
import { DefButton, blankButtonNow, preloadBlankButton } from "./kit.ts";
import { type PlaceScreen, placeWindow, railGrid } from "./modalPlace.ts";

/** The ready promises of the DefButtons in `c` whose pictures are still coming. */
function buttonsLoading(c: Container): Promise<void>[] {
  const out: Promise<void>[] = [];
  const walk = (n: Container) => {
    if (n instanceof DefButton && !n.loaded) out.push(n.ready);
    for (const k of n.children) walk(k as Container);
  };
  walk(c);
  return out;
}

/** Modal windows over the game: a dimmed input blocker plus a stack of windows. */
/** When a window last closed (the next one's guard, EXTRAS dialogGuard). */
let lastClosedAt = 0;

export class Modals {
  /** Every page's and screen's windows (the map's, a town's, a battle's): the one that opened a window last is on top,
   *  and only it takes the keys. A window opened from a screen's window on another layer's stack (the town's hero
   *  exchange, a hero's screen, the map's spell book) came up underneath it: the owner 2026-10-27. */
  private static readonly all = new Set<Modals>();
  private static top = 1000;
  readonly root = new Container();
  private readonly stack: { win: Container; onKey?: (key: string) => boolean; typed?: boolean; railed?: boolean }[] = [];
  /** Called whenever a window opens or closes (screens make their own touch buttons inert under windows, still shown). */
  readonly changed = new Set<() => void>();

  private readonly app: Application;

  constructor(app: Application) {
    this.app = app;
    // (The one-handed rail's buttons take the original's blank face.)
    void preloadBlankButton();
    app.stage.addChild(this.root);
    // Stay above screens added later (battles, towns).
    app.stage.sortableChildren = true;
    this.root.zIndex = 1000;
    centre(this.root);
    Modals.all.add(this);
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    // Dev handle for trying windows from the console.
    if (import.meta.env.DEV) (window as unknown as { __modals: Modals }).__modals = this;
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    // (Another stack's window lies over this one's: the keys are its.)
    for (const m of Modals.all) if (m !== this && m.open && !m.root.destroyed && m.root.zIndex > this.root.zIndex) return;
    // Typing in a text field (the feedback box, the page bar) isn't for the game's windows.
    if (e.target instanceof Element && e.target.closest("textarea, input, select, [contenteditable]")) return;
    // Nor the browser's own shortcuts (Ctrl+Shift+R, Ctrl+C...): a window's keys are plain letters.
    if (browsersKey(e)) return;
    // F is the Feedback box's (feedback/box.ts) over any window too: many windows swallow every key.
    // (Not where a name is typed in: an F there is a letter.)
    if (!top.typed && (e.key === "f" || e.key === "F" || e.code === "KeyF") && !e.ctrlKey && !e.metaKey && !e.altKey) return;
    // (Letters whatever Caps Lock or Shift say: the windows' keys are lower case.)
    if (top.onKey?.(e.key.length === 1 && !top.typed ? e.key.toLowerCase() : e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  /** Removes the layer and its key handling (when its screen goes away). */
  dispose() {
    Modals.all.delete(this);
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    this.stack.length = 0;
    this.changed.clear();
    this.root.destroy({ children: true });
  }

  get open(): boolean {
    return this.stack.length > 0;
  }

  /** The top window's buttons come again in the thumb's third (one-handed: handRail), over what the screen has there. */
  get railed(): boolean {
    return !!this.stack[this.stack.length - 1]?.railed;
  }

  /**
   * Answers every window as Enter would (OK, the default choice), top first, so whatever waits on one
   * goes on (the computer playing our side: taken down unanswered, the messages after it never came).
   * A window Enter doesn't close is taken down unanswered.
   */
  okAll() {
    for (let guard = 0; this.stack.length && guard < 20; guard++) {
      const top = this.stack[this.stack.length - 1];
      top.onKey?.("Enter");
      if (this.stack[this.stack.length - 1] === top) {
        this.stack.pop();
        if (!top.win.destroyed) top.win.destroy({ children: true });
      }
    }
    for (const fn of [...this.changed]) fn();
  }

  /** Takes every window down without answering it (a replay: the game's own choices come from the clip). */
  dismissAll() {
    for (const e of this.stack.splice(0)) if (!e.win.destroyed) e.win.destroy({ children: true });
    for (const fn of [...this.changed]) fn();
  }

  /** Shows a window centred on the screen (or at x, y); returns a function that closes it. */
  show(win: Container, opts: { /** Where (a function: worked out again on a change of layout). */ x?: number | (() => number); y?: number | (() => number); onKey?: (key: string) => boolean; /** A screen laid out for the touch layout itself: no extra Close, no pinch zoom. */ own?: boolean; /** A small window that is itself a set of choices (a picker's grid): one-handed it goes under the thumb, whole, instead of in the far two thirds with its buttons copied into the thumb's rail. */ underThumb?: boolean; /** Text typed in (a name): keys as typed, not lower case. */ typed?: boolean; /** A full-screen window: the canvas around it filled with this colour (the wide layouts' sides). */ backdrop?: number } = {}): () => void {
    // Over every other stack's windows (and the screens), as the newest window.
    if ([...Modals.all].some((m) => m !== this && m.root.zIndex >= this.root.zIndex)) this.root.zIndex = ++Modals.top;
    const blocker = new Graphics();
    blocker.eventMode = "static";
    // Touch: a tap beside the window is its Escape (2026-10-25: no floating Close; EXTRAS tapOutside).
    const shownAt = performance.now();
    // Only beside it: a tap that fell through a gap inside the window (between its rows, on a full-screen window's
    // own background) is a near miss of something in it, not a wish to leave (the owner 11-03: a tap by a player's flag
    // in the Advanced Options closed the whole New Game screen).
    blocker.on("pointertap", (e) => {
      if (!screenSize.touch || e.button === 2 || !extra("tapOutside") || performance.now() - shownAt < 400) return;
      if (win.getBounds().rectangle.contains(e.global.x, e.global.y)) return;
      opts.onKey?.("Escape");
    });
    const layer = new Container();
    layer.label = "dialog window";
    layer.addChild(blocker, win);
    // Not shown until its buttons' pictures are in: a window never comes up without its OK.
    const waiting = buttonsLoading(win);
    if (waiting.length) {
      win.visible = false;
      void whileWaiting(Promise.race([Promise.all(waiting), new Promise((r) => setTimeout(r, 3000))])).then(() => !win.destroyed && (win.visible = true));
    }
    const b = win.getLocalBounds();
    const entry: { win: Container; onKey?: (key: string) => boolean; typed?: boolean; railed?: boolean } = { win: layer, onKey: opts.onKey, typed: opts.typed };
    let rail: Container | null = null;
    let stopPinch = () => {};
    let placed = 0;
    // Laid out for the screen now, and again whenever it changes (the phone turned, Options): the
    // windows stay open across a change of layout instead of the page starting again.
    const place = () => {
      if (layer.destroyed) return;
      const gen = ++placed;
      // Covers the whole canvas, also the sides of a wide one (the touch layout).
      blocker.clear().rect(-screenSize.ox - 1000, -screenSize.oy - 1000, screenSize.w + 2000, screenSize.h + 2000).fill({ color: opts.backdrop ?? 0x000000, alpha: opts.backdrop === undefined ? 0.001 : 1 });
      const at = placeWindow(b.width, b.height, opts, this.screen());
      win.scale.set(at.k);
      win.position.set(at.x, at.y);
      const hand = at.rail;
      rail?.destroy({ children: true });
      rail = null;
      entry.railed = !!hand;
      if (hand) {
        // (Again a while later: some windows put their buttons in once their art is in.)
        const build = () => {
          if (layer.destroyed || gen !== placed) return;
          rail?.destroy({ children: true });
          rail = this.handRail(win, hand, build);
          layer.addChild(rail);
        };
        build();
        for (const ms of [150, 400, 1200, 2500]) setTimeout(build, ms);
      }
      // Touch layout: screen-sized windows are dense on a phone; two fingers zoom into them and move them about.
      stopPinch();
      stopPinch = at.pinch ? this.pinchZoom(win, entry) : () => {};
    };
    place();
    this.root.addChild(layer);
    // VCMI holds a queued dialog back until the input settles: right after another window closed,
    // taps are ignored for a moment (keys still work), so a double tap can't skip a message unread.
    const sinceClose = performance.now() - lastClosedAt;
    if (!fast && sinceClose < 450 && extra("dialogGuard")) {
      const guard = new Graphics().rect(-screenSize.ox - 1000, -screenSize.oy - 1000, screenSize.w + 2000, screenSize.h + 2000).fill({ color: 0x000000, alpha: 0.001 });
      guard.eventMode = "static";
      guard.label = "dialog guard";
      layer.addChild(guard);
      setTimeout(() => !guard.destroyed && guard.destroy(), 350);
    }
    this.stack.push(entry);
    for (const fn of [...this.changed]) fn();
    let first = true;
    const stopLayout = onLayout(() => (first ? (first = false) : place()));
    return () => {
      stopLayout();
      stopPinch();
      const i = this.stack.indexOf(entry);
      if (i >= 0) this.stack.splice(i, 1);
      lastClosedAt = performance.now();
      layer.destroy({ children: true });
      for (const fn of [...this.changed]) fn();
    };
  }

  /** The screen as placeWindow reads it, now. */
  private screen(): PlaceScreen {
    return { w: screenSize.w, h: screenSize.h, ox: screenSize.ox, oy: screenSize.oy, touch: screenSize.touch, hand: oneHand(), navBar: navBarRight(), pageButtons: pageButtons(), touchScale };
  }

  /**
   * One-handed: the window's buttons (and other things to tap) again, finger-sized, in a column in
   * the thumb's third of the screen, top to bottom in the window's reading order; each shows the
   * original's picture and does what it does. The window's own stay as they are (marked
   * `handMirror` for the probes). `again`: builds the rail anew (after a tap: a choice now lit).
   */
  private handRail(win: Container, hand: "left" | "right", again: () => void): Container {
    const rail = new Container();
    rail.label = "panel: the window's buttons on the thumb's side";
    const winB = win.getBounds();
    const targets: Container[] = [];
    const walk = (c: Container) => {
      for (const ch of c.children as Container[]) {
        if (!ch.visible) continue;
        // (A window's grid of settings or slots stays where it is: touchcheck's handGrid.)
        if ((ch as Container & { handGrid?: boolean }).handGrid) continue;
        if (ch instanceof DefButton) {
          targets.push(ch);
          continue;
        }
        if ((ch.eventMode === "static" || ch.eventMode === "dynamic") && ch.listenerCount("pointertap") > 0) {
          const bb = ch.getBounds();
          // (Not a backdrop that takes taps all over: closing a popup.)
          if (bb.width * bb.height < 0.5 * winB.width * winB.height) {
            targets.push(ch);
            continue;
          }
        }
        walk(ch);
      }
    };
    walk(win);
    if (!targets.length) return rail;
    const boxes = new Map(targets.map((t) => [t, t.getBounds()]));
    targets.sort((a, b) => boxes.get(a)!.y - boxes.get(b)!.y || boxes.get(a)!.x - boxes.get(b)!.x);
    const grid = railGrid(targets.length, hand, fingerPx(), this.screen());
    targets.forEach((t, i) => {
      (t as Container & { handMirror?: boolean }).handMirror = true;
      const btn = blankButtonNow(grid.w, grid.h);
      const box = boxes.get(t)!;
      // The original's own picture (its face, a choice's icon), as big as the button takes.
      const tex = this.app.renderer.generateTexture({ target: t, resolution: 2 });
      rail.on("destroyed", () => tex.destroy(true));
      const pic = new Sprite(tex);
      const pk = Math.min((grid.w - 12) / Math.max(1, box.width), (grid.h - 10) / Math.max(1, box.height), 3);
      pic.scale.set(pk);
      pic.position.set(Math.round((grid.w - pic.width) / 2), Math.round((grid.h - pic.height) / 2));
      btn.addChild(pic);
      const off = t instanceof DefButton && t.disabled;
      if (off) btn.alpha = 0.5;
      btn.label = t instanceof DefButton ? `button: ${t.describe()} (thumb's side)` : `button: ${t.label?.replace(/^\w+: /, "") || "choice"} (thumb's side)`;
      const cell = grid.at(i);
      btn.position.set(cell.x - screenSize.ox, cell.y - screenSize.oy);
      btn.eventMode = "static";
      btn.cursor = "pointer";
      btn.on("pointertap", () => {
        if (off || t.destroyed) return;
        if (t instanceof DefButton) {
          void playSound("button");
          t.onClick();
        } else t.emit("pointertap", { button: 0, pointerType: "touch" } as never);
        // A choice made shows lit on the window: the rail's pictures too.
        setTimeout(again, 50);
      });
      rail.addChild(btn);
    });
    return rail;
  }

  /** Two-finger zoom (from the window's fitted size to 2.5x) and pan of a window while it's the top one. */
  private pinchZoom(win: Container, entry: object): () => void {
    const home = { x: win.x, y: win.y, k: win.scale.x };
    let last: { x: number; y: number } | null = null;
    return onPinch(
      (ratio, cx, cy) => {
        if (win.destroyed) return;
        const p = this.root.toLocal(toGame(cx, cy));
        const z = Math.max(home.k, Math.min(2.5, win.scale.x * ratio));
        // The window's point that was between the fingers stays between them as they move and spread.
        const from = last ?? p;
        const lx = (from.x - win.x) / win.scale.x;
        const ly = (from.y - win.y) / win.scale.y;
        win.scale.set(z);
        win.position.set(p.x - lx * z, p.y - ly * z);
        last = p;
        if (z === home.k) win.position.set(home.x, home.y);
      },
      () => (last = null),
      () => this.stack[this.stack.length - 1] === entry && !win.destroyed,
    );
  }
}
