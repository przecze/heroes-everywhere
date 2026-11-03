// The touch HUD's widgets where the player wants them (2026-10-26: "floats, I can't move them yet"; EXTRAS
// moveWidgets): each widget's grab handle (dragged: it moves; tapped: it folds), kept whole on the screen and off the
// others, and "Move the panels" (from the more grid), where a drag moves any widget and squares beside change shapes.
import { drawShape } from "./chip.ts";
import { Container, Graphics, Rectangle } from "pixi.js";
import { tr, type Text } from "../../i18n/index.ts";
import { extra } from "../../settings.ts";
import { WHITE, YELLOW } from "../../text.ts";
import { GOLD as GOLD_TRIM } from "../../ui/blocks/menuBlocks.ts";
import { popupRoom, roundCorners } from "../../ui/blocks/popupPlace.ts";
import { placeBox } from "../../ui/blocks/popupBox.ts";
import { blankButtonNow } from "../../ui/kit.ts";
import { pageButtonBoxes, screenSize } from "../../ui/screen.ts";
import { untilReleased } from "../../touch.ts";
import { track } from "../../usage.ts";
import type { MobileHud } from "../mobileHud.ts";
import { type Rgb, backing, text } from "./look.ts";
import type { HudShape, MoveKey } from "./store.ts";

/** Each widget's name on its grab handle. */
const HANDLE_NAMES: Record<MoveKey, string> = { list: "hero and town list", chip: "hero widget", bar: "resource bar", buttons: "buttons", zoom: "zoom buttons", mini: "minimap" };

export class PanelArranger {
  /** Arranging the pieces (from the more grid): a drag moves one, the taps don't reach them. */
  private layer: Container | null = null;

  private readonly hud: MobileHud;
  constructor(hud: MobileHud) {
    this.hud = hud;
  }

  /** Which widget a mover is. */
  private keyOf(c: Container): MoveKey {
    return (Object.entries(this.hud.movers) as [MoveKey, Container][]).find(([, x]) => x === c)![0];
  }

  /**
   * Each piece where it was dragged to (none when the switch is off), always whole on the screen (2026-10-26 21:34:
   * the minimap's block crept to the side on reloads until it was gone). The kept move itself stays as dragged (a screen
   * of another shape for a moment while the page loads or turns must not rewrite it).
   */
  apply() {
    const hud = this.hud;
    const kept = extra("moveWidgets") ? hud.store.moves() : {};
    // (Open while placed: a folded piece is kept on the screen by its open size.)
    for (const p of Object.values(hud.pieces)) p.visible = true;
    // Every piece at its kept spot first, then each placed clear of the ones placed before it: the same sizes give the
    // same layout every time (2026-11-01 21:33: "the button widget jumps every time I move my hero": each piece
    // dodged the others where the last pass had left them, so the panels wandered with every redraw). The pieces the
    // player moved go first, so the ones left where the layout puts them make way.
    const all = Object.entries(hud.movers) as [MoveKey, Container][];
    for (const [k, c] of all) {
      const o = kept[k] ?? { x: 0, y: 0 };
      c.position.set(o.x * hud.mirror, o.y);
    }
    const placed: Container[] = [];
    for (const [, c] of [...all.filter(([k]) => kept[k]), ...all.filter(([k]) => !kept[k])]) {
      this.keepOnScreen(c, placed);
      placed.push(c);
    }
    this.drawHandles();
  }

  /**
   * A grab handle on each piece (2026-10-26 22:00): a small tab in the windows' leather and gold on the piece's
   * edge towards the map's middle. Dragged, the piece follows the finger (kept as "Move the panels" keeps it); tapped,
   * the piece folds away to its handle, and back. Every widget has its own (the bar, + and −, the minimap, the buttons).
   */
  private drawHandles() {
    const hud = this.hud;
    hud.handles.removeChildren().forEach((c) => c.destroy({ children: true }));
    const on = extra("moveWidgets") && !this.layer;
    const folded = on ? hud.store.folded() : {};
    const u = hud.u;
    const boxes: Partial<Record<MoveKey, { x0: number; y0: number; x1: number; y1: number }>> = {};
    const pieces = Object.entries(hud.pieces) as [MoveKey, Container][];
    for (const [k, piece] of pieces) {
      // (Measured open, then folded away if it is.)
      piece.visible = true;
      const c = hud.movers[k];
      if (!c.children.length || !piece.children.length) continue;
      const b = c.getBounds();
      if (b.width && b.height) boxes[k] = { x0: b.minX / u, y0: b.minY / u, x1: b.maxX / u, y1: b.maxY / u };
    }
    for (const [k, piece] of pieces) {
      const b = boxes[k];
      if (!on || !b) continue;
      const isFolded = !!folded[k];
      piece.visible = !isFolded;
      const S = hud.finger;
      // Slim (2026-10-27: "smaller, better style"): a tab of the panel's own leather standing out of its edge,
      // gold on its three free sides as the panels' trim, three gold studs for the grip; a finger's target round it.
      const w = Math.round(S * 0.3);
      const h = Math.round(S * 0.62);
      // The edge towards the middle; for a piece across the screen, its top.
      const across = b.x1 - b.x0 > hud.W * 0.8;
      const toRight = (b.x0 + b.x1) / 2 < hud.W / 2;
      const handle = new Container();
      handle.label = `button: move or fold the ${HANDLE_NAMES[k]}`; // i18n-ok
      const [hw, hh] = across ? [h, w] : [w, h];
      handle.addChild(Object.assign(blankButtonNow(hw, hh), { alpha: 0.95 }));
      const g = new Graphics();
      // The trim on the free sides (the side against the piece stays open: the tab is part of it).
      const R = 4;
      if (across) g.moveTo(0, hh).lineTo(0, R).arcTo(0, 0, R, 0, R).lineTo(hw - R, 0).arcTo(hw, 0, hw, R, R).lineTo(hw, hh);
      else if (toRight) g.moveTo(0, 0).lineTo(hw - R, 0).arcTo(hw, 0, hw, R, R).lineTo(hw, hh - R).arcTo(hw, hh, hw - R, hh, R).lineTo(0, hh);
      else g.moveTo(hw, 0).lineTo(R, 0).arcTo(0, 0, 0, R, R).lineTo(0, hh - R).arcTo(0, hh, R, hh, R).lineTo(hw, hh);
      g.stroke({ color: 0x000000, width: 3, alpha: 0.6 }).stroke({ color: GOLD_TRIM, width: 1.5 });
      const [cx, cy] = [hw / 2, hh / 2];
      if (isFolded) {
        // Folded: a gold chevron pointing where the piece opens.
        const d = across ? [[-4, 2], [0, -2], [4, 2]] : toRight ? [[-2, -4], [2, 0], [-2, 4]] : [[2, -4], [-2, 0], [2, 4]];
        g.moveTo(cx + d[0][0], cy + d[0][1]).lineTo(cx + d[1][0], cy + d[1][1]).lineTo(cx + d[2][0], cy + d[2][1]).stroke({ color: 0xffe78c, width: 2.5 });
      } else
        for (const i of [-1, 0, 1]) {
          // Three studs along it: a dark dent with a gold point, as the windows' rivets.
          const [sx, sy] = across ? [cx + i * 7, cy] : [cx, cy + i * 7];
          g.circle(sx, sy + 0.5, 2.2).fill({ color: 0x000000, alpha: 0.55 }).circle(sx, sy, 1.6).fill(0xffe78c);
        }
      handle.addChild(g);
      // (A finger's target round the small tab, grown away from its piece only: over the piece it took the taps meant
      // for it, and a tap on a small minimap folded it.)
      const pad = S - Math.min(hw, hh);
      handle.hitArea = across ? new Rectangle(-4, -pad, hw + 8, hh + pad) : toRight ? new Rectangle(0, -4, hw + pad, hh + 8) : new Rectangle(-pad, -4, hw + pad, hh + 8);
      const x = across ? Math.round((b.x0 + b.x1 - hw) / 2) : toRight ? Math.round(b.x1 - 2) : Math.round(b.x0 - hw + 2);
      // (Half way down the side: the one-handed rail's flip tab sits at its top corner.)
      const y = across ? Math.round(b.y0 - hh + 2) : Math.round((b.y0 + b.y1 - hh) / 2);
      handle.position.set(Math.max(0, Math.min(hud.W - hw, x)), Math.max(0, y));
      handle.eventMode = "static";
      handle.cursor = "grab";
      this.grab(handle, k);
      hud.handles.addChild(handle);
    }
    if (!on) for (const p of Object.values(hud.pieces)) p.visible = true;
    for (const [k, c] of Object.entries(hud.movers) as [MoveKey, Container][]) this.holdToMove(c, k, on && !!boxes[k] && !folded[k]);
  }

  /**
   * A widget held on a pixel of its own that shows nothing when held (its frame, its backing, a slot without an info
   * pop-up) is grabbed as by its handle (2026-10-27: "tap hold on non popup able pixel of it also grab for moving,
   * not only on hooks"). A long press arrives as the right button (touch.ts); where something answers it (a hero's
   * or town's info) it keeps doing so.
   */
  private holdToMove(c: Container, k: MoveKey, on: boolean) {
    const hud = this.hud;
    c.removeAllListeners("rightdown");
    c.removeAllListeners("globalpointermove");
    if (!on) {
      c.hitArea = null;
      c.eventMode = "passive";
      return;
    }
    const lb = c.getLocalBounds();
    c.hitArea = new Rectangle(lb.minX, lb.minY, lb.width, lb.height);
    c.eventMode = "static";
    let at: { x: number; y: number; cx: number; cy: number } | null = null;
    const answersHold = (t: Container | null) => {
      for (let n = t; n && n !== c; n = n.parent) if (n.listenerCount("rightdown") || n.listenerCount("rightclick")) return true;
      return false;
    };
    c.on("rightdown", (e) => {
      if (answersHold(e.target as Container)) return;
      e.stopPropagation();
      at = { x: e.global.x, y: e.global.y, cx: c.x, cy: c.y };
      c.alpha = 0.8;
      hud.closePopups();
      untilReleased(() => {
        if (!at) return;
        at = null;
        c.alpha = 1;
        if (c.destroyed || hud.root.destroyed) return;
        track(`hud:hold ${k}`);
        this.keepOnScreen(c);
        const m = { ...hud.store.moves() };
        const key = this.keyOf(c);
        m[key] = { x: Math.round(c.x * hud.mirror), y: Math.round(c.y) };
        if (!m[key].x && !m[key].y) delete m[key];
        hud.store.saveMoves(m);
        requestAnimationFrame(() => {
          if (hud.root.destroyed) return;
          this.apply();
          hud.measureCover();
        });
      });
    });
    c.on("globalpointermove", (e) => {
      if (at) c.position.set(at.cx + (e.global.x - at.x) / hud.u, at.cy + (e.global.y - at.y) / hud.u);
    });
  }

  /** A handle's drag (the piece follows) and tap (fold or unfold). */
  private grab(handle: Container, k: MoveKey) {
    const hud = this.hud;
    let at: { x: number; y: number; moved: boolean; hx: number; hy: number } | null = null;
    const movers = () => [hud.movers[k]];
    const start = movers().map((c) => ({ x: c.x, y: c.y }));
    handle.on("pointerdown", (e) => {
      e.stopPropagation();
      at = { x: e.global.x, y: e.global.y, moved: false, hx: handle.x, hy: handle.y };
      movers().forEach((c, i) => (start[i] = { x: c.x, y: c.y }));
      hud.closePopups();
    });
    handle.on("globalpointermove", (e) => {
      if (!at) return;
      const dx = (e.global.x - at.x) / hud.u;
      const dy = (e.global.y - at.y) / hud.u;
      if (!at.moved && Math.hypot(dx, dy) * hud.u * screenSize.css < 10) return;
      at.moved = true;
      movers().forEach((c, i) => c.position.set(start[i].x + dx, start[i].y + dy));
      handle.position.set(at.hx + dx, at.hy + dy);
    });
    const up = () => {
      if (!at) return;
      const moved = at.moved;
      at = null;
      if (!moved) {
        track(`hud:fold ${k}`);
        if (k === "buttons") hud.closePopups();
        hud.store.setFolded(k, !hud.store.folded()[k]);
      } else {
        track(`hud:handle ${k}`);
        const m = { ...hud.store.moves() };
        for (const c of movers()) {
          this.keepOnScreen(c);
          const key = this.keyOf(c);
          m[key] = { x: Math.round(c.x * hud.mirror), y: Math.round(c.y) };
          if (!m[key].x && !m[key].y) delete m[key];
        }
        hud.store.saveMoves(m);
      }
      // (Redrawn on the next frame: this handle is the one being destroyed.)
      requestAnimationFrame(() => {
        if (hud.root.destroyed) return;
        this.apply();
        hud.measureCover();
      });
    };
    handle.on("pointerup", up);
    handle.on("pointerupoutside", up);
  }

  /**
   * A widget whole on the screen (sideways clear of Android's navigation bar), off the page's ☰ and Feedback and off
   * the other widgets (2026-10-27: the resource bar lay over the buttons): moved to the nearest place clear of them.
   */
  /** `among`: the pieces to keep clear of (all the others by default). */
  private keepOnScreen(c: Container, among: Container[] = Object.values(this.hud.movers)) {
    if (!c.children.length) return;
    const b = c.getBounds();
    if (!b.width || !b.height) return;
    const room = popupRoom();
    const others = among
      .filter((m) => m !== c && m.children.length && m.visible)
      .map((m) => m.getBounds())
      .filter((o) => o.width && o.height)
      .map((o) => ({ x: o.minX, y: o.minY, w: o.width, h: o.height }));
    // (Bigger than the screen: its top left corner on it.)
    // (☰ and Feedback, and the screen's rounded corners.)
    const page = [...pageButtonBoxes(), ...roundCorners()];
    const at = { x: b.minX + b.width / 2, y: b.minY + b.height / 2 };
    const hits = (q: { x: number; y: number }, boxes: { x: number; y: number; w: number; h: number }[]) => boxes.some((a) => q.x < a.x + a.w && a.x < q.x + b.width && q.y < a.y + a.h && a.y < q.y + b.height);
    let p = b.width > room.w || b.height > room.h ? { x: room.x, y: room.y } : placeBox(b.width, b.height, room, { at, avoid: [...page, ...others], gap: 4 });
    // (No place clear of everything near: at least off ☰ and Feedback.)
    if (hits(p, page)) p = placeBox(b.width, b.height, room, { at, avoid: page, gap: 4 });
    const u = this.hud.u;
    c.position.set(Math.round(c.x + (p.x - b.minX) / u), Math.round(c.y + (p.y - b.minY) / u));
  }

  start() {
    const hud = this.hud;
    this.stop();
    const layer = new Container();
    layer.label = "panel: moving the panels";
    this.layer = layer;
    this.drawHandles();
    // A frame round each piece, and a cover over it that takes the drag; beside three of them their shapes (the owner,
    // 2026-10-25: the list one or two columns and how high, the hero's army one row or two, the buttons across or up).
    const frames = new Graphics();
    const opts = new Container();
    const box = (c: Container) => {
      const b = c.getBounds();
      return { x: b.minX / hud.u - 3, y: b.minY / hud.u - 3, w: b.width / hud.u + 6, h: b.height / hud.u + 6 };
    };
    const reshape = (change: Partial<HudShape>) => {
      hud.store.setShape(change);
      void hud.redraw().then(() => (this.apply(), hud.measureCover(), draw()));
    };
    let resize: { y: number; rows: number } | null = null;
    const draw = () => {
      if (layer.destroyed) return;
      frames.clear();
      opts.removeChildren().forEach((x) => x.destroy({ children: true }));
      for (const c of Object.values(hud.movers)) {
        if (!c.children.length) continue;
        const b = box(c);
        frames.rect(b.x, b.y, b.w, b.h).stroke({ color: 0xffe78c, width: 3 });
      }
      const S = hud.finger;
      const at = (c: Container, glyph: (g: Graphics) => void, label: string, fn: () => void, where: (b: ReturnType<typeof box>) => [number, number]) => {
        if (!c.children.length) return;
        const g = new Graphics().roundRect(0, 0, S, S, 4).fill({ color: 0x2a1b0e, alpha: 0.95 }).stroke({ color: 0xffe78c, width: 2 });
        glyph(g);
        const t = new Container();
        t.label = `button: ${label}`; // i18n-ok
        t.addChild(g);
        t.eventMode = "static";
        t.cursor = "pointer";
        t.on("pointerdown", (e) => e.stopPropagation());
        t.on("pointertap", (e) => (e.stopPropagation(), fn()));
        // (Inside the piece's own frame: the pieces take no taps while they're moved, and outside they ran into each other.)
        const [x, y] = where(box(c));
        t.position.set(Math.round(Math.max(4, Math.min(hud.W - S - 4, x))), Math.round(Math.max(4, Math.min(hud.H - S - 4, y))));
        opts.addChild(t);
        return t;
      };
      const gold = 0xf2d674;
      const shape = hud.store.shape();
      // The list: one column or two (two narrow bars or one wide), and a grip under it that sets how many rows show.
      at(hud.movers.list, (g) => {
        const two = shape.listCols !== 2;
        if (two) g.rect(S * 0.22, S * 0.22, S * 0.24, S * 0.56).rect(S * 0.54, S * 0.22, S * 0.24, S * 0.56).fill(gold);
        else g.rect(S * 0.3, S * 0.22, S * 0.4, S * 0.56).fill(gold);
      }, "list columns", () => reshape({ listCols: shape.listCols === 2 ? 1 : 2 }), (b) => [b.x + b.w - S - 4, b.y + 4]);
      const grip = at(hud.movers.list, (g) => {
        for (let i = 0; i < 3; i++) g.rect(S * 0.2, S * (0.32 + i * 0.14), S * 0.6, S * 0.07).fill(gold);
      }, "list height", () => {}, (b) => [b.x + b.w / 2 - S / 2, b.y + b.h - S - 4]);
      grip?.on("pointerdown", (e) => (resize = { y: e.global.y, rows: hud.list.geom.rows }));
      // The hero's army: its four shapes round (a picture of the next).
      at(hud.movers.chip, (g) => drawShape(g, hud.chip.nextShape(), S * 0.7, S * 0.15, S * 0.15), "army shape", () => (hud.chip.turnShape(), void hud.redraw().then(() => (this.apply(), draw()))), (b) => [b.x + b.w - S - 4, b.y + 4]);
      // The buttons: a block (two over End turn) or one row (a picture of what a tap makes of it).
      at(hud.movers.buttons, (g) => {
        if (shape.buttons === "row") g.rect(S * 0.2, S * 0.22, S * 0.26, S * 0.22).rect(S * 0.54, S * 0.22, S * 0.26, S * 0.22).rect(S * 0.2, S * 0.54, S * 0.6, S * 0.24).fill(gold);
        else g.rect(S * 0.12, S * 0.38, S * 0.18, S * 0.24).rect(S * 0.34, S * 0.38, S * 0.18, S * 0.24).rect(S * 0.56, S * 0.38, S * 0.32, S * 0.24).fill(gold);
      }, "buttons in a block or a row", () => reshape({ buttons: shape.buttons === "row" ? "block" : "row" }), (b) => [b.x + 4, b.y + 4]);
    };
    const shade = new Graphics().rect(-2000, -2000, 6000, 6000).fill({ color: 0, alpha: 0.35 });
    shade.eventMode = "static";
    layer.eventMode = "static";
    layer.addChild(shade, frames, opts);
    let drag: { c: Container; x: number; y: number } | null = null;
    shade.on("pointerdown", (e) => {
      const at = { x: e.global.x, y: e.global.y };
      const c = Object.values(hud.movers).find((m) => m.children.length && m.getBounds().containsPoint(at.x, at.y));
      if (c) drag = { c, x: at.x, y: at.y };
    });
    shade.on("globalpointermove", (e) => {
      if (resize) {
        const geom = hud.list.geom;
        const rows = Math.max(1, Math.min(geom.n, resize.rows + Math.round((e.global.y - resize.y) / hud.u / geom.itemH)));
        if (rows !== geom.rows) {
          geom.rows = rows;
          reshape({ listRows: rows >= geom.n ? undefined : rows });
        }
        return;
      }
      if (!drag) return;
      drag.c.position.set(drag.c.x + (e.global.x - drag.x) / hud.u, drag.c.y + (e.global.y - drag.y) / hud.u);
      drag.x = e.global.x;
      drag.y = e.global.y;
      draw();
    });
    const drop = () => {
      resize = null;
      if (!drag) return;
      this.keepOnScreen(drag.c);
      // Only the dragged piece's move is written: the others keep theirs as dragged, not where the clamp put them on
      // this screen (that rewrite let the pieces creep sideways over reloads and turns, the owner 21:34).
      const m = { ...hud.store.moves() };
      const k = this.keyOf(drag.c);
      m[k] = { x: Math.round(drag.c.x * hud.mirror), y: Math.round(drag.c.y) };
      if (!m[k].x && !m[k].y) delete m[k];
      drag = null;
      hud.store.saveMoves(m);
      this.apply();
      hud.measureCover();
      draw();
    };
    layer.on("pointerup", drop);
    layer.on("pointerupoutside", drop);
    // Done and Back to where they were.
    const word = (t: Text, fn: () => void) => {
      const l = text(t, "medfont", 1.5, [...YELLOW] as Rgb);
      const b = new Container();
      b.label = `button: ${t}`;
      b.addChild(backing(l.width + 32, l.height + 20, 0.95), Object.assign(l, { x: 16, y: 10 }));
      b.eventMode = "static";
      b.cursor = "pointer";
      b.on("pointertap", fn);
      return b;
    };
    const done = word(tr("Done"), () => this.stop());
    const reset = word(tr("Back to where they were"), () => {
      hud.store.saveMoves(null);
      hud.store.setShape(null);
      void hud.redraw().then(() => (this.apply(), hud.measureCover(), draw()));
    });
    // (At the top's middle, between the page's own buttons, wrapped to the room there: off the pieces at the foot and the sides.)
    const clear = hud.pageClear();
    const room = hud.W - clear.left - clear.right;
    const hint = text(tr("Drag a panel to move it; the squares beside change its shape."), "medfont", 1.5, [...WHITE] as Rgb, "center", room / 1.5);
    const total = reset.width + 16 + done.width;
    // (In the screen's middle: the pieces sit along its edges.)
    const top = Math.round(hud.H / 2 - (hint.height + 12 + reset.height) / 2);
    hint.position.set(Math.round(clear.left + (room - hint.width) / 2), top);
    reset.position.set(Math.round((hud.W - total) / 2), top + hint.height + 12);
    done.position.set(reset.x + reset.width + 16, reset.y);
    layer.addChild(hint, reset, done);
    hud.root.addChild(layer);
    draw();
  }

  stop() {
    const was = !!this.layer;
    this.layer?.destroy({ children: true });
    this.layer = null;
    if (was) this.drawHandles();
  }
}
