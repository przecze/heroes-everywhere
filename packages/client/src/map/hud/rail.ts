// The touch HUD's bottom right: the buttons used every turn, + and −, the small minimap: three widgets, each its own
// shape, and where they go.
import { Container, Graphics, Rectangle } from "pixi.js";
import { tr, reason } from "../../i18n/index.ts";
import { extra } from "../../settings.ts";
import { WHITE, YELLOW } from "../../text.ts";
import { DefButton, blankButtonNow } from "../../ui/kit.ts";
import { holdTip } from "../../ui/holdTip.ts";
import { GOLD as GOLD_TRIM } from "../../ui/blocks/menuBlocks.ts";
import { screenSize } from "../../ui/screen.ts";
import { ResourceBar } from "../../ui/blocks/resourceBar.ts";
import { dateParts } from "@heroes/core";
import { track } from "../../usage.ts";
import type { HudButton } from "../hud.ts";
import type { MobileHud } from "../mobileHud.ts";
import { GAP, K, type Rgb, ZOOM_SQUARE, backing, text } from "./look.ts";

export class ButtonRail {
  /** The top and the inner edge of what the three take (HUD pixels): the hero widget keeps clear of them. */
  top = 0;
  left = 0;
  /** Drawn in full before the old ones go (a newer call meanwhile wins). */
  private gen = 0;

  private readonly hud: MobileHud;
  constructor(hud: MobileHud) {
    this.hud = hud;
  }

  /**
   * The buttons used every turn, the zoom and the small minimap, each a floating widget of its own (2026-10-27: one
   * rectangle holding things of different shapes covered the map with empty background, and the resource bar slid over
   * its buttons). The buttons' block (the adventure spells and "more" over End turn, Follow on the others' turns) in
   * the thumb's corner; over it the minimap's picture (a tap shows it big) and + and − as small gold squares.
   * Sideways the three go up the rail's side: the minimap on top, then + and −, then the block.
   */
  async draw(myTurn: boolean, _underground: boolean) {
    const hud = this.hud;
    // (A call still on its way after the HUD went: a layout change or a new page.)
    if (hud.root.destroyed) return;
    // (The big minimap's level button shows the level now in view.)
    if (hud.minimap.open) hud.minimap.drawBig();
    const gen = ++this.gen;
    const player = Math.max(0, hud.player);
    const cell = 32 * K;
    const make = (def: string, name: HudButton | (() => void), enabled = true): DefButton => {
      const b = new DefButton(def, 0, 0, player);
      b.scale.set(K);
      b.disabled = !enabled;
      if (!enabled && hud.offTurn) b.explain(hud.offTurn.modals, player, () => reason(hud.offTurn!.why()));
      b.onClick = () => (typeof name === "function" ? name() : hud.onButton(name));
      return b;
    };
    const following = !!hud.follow && !myTurn;
    // The block: [spells][more] over End turn (Follow over End turn while following), or all in one row (the player's
    // pick while moving the panels). With EXTRAS railNextHero (2026-11-01 12:32: "more 1 by 1, next hero 1 by
    // 1, end turn 1 by 2 and the week strip below it; spellbook in more options"): [more][Next hero] over End turn,
    // the same upright and sideways, the spellbook in the more grid (hud/menu.ts).
    const block = new Container();
    const nextOn = extra("railNextHero");
    const cast = nextOn ? null : make("iam007.def", "cast");
    const more = nextOn ? this.tilesButton(() => hud.more.toggle()) : make("iam008.def", () => hud.more.toggle());
    more.label = "button: more";
    if (nextOn) holdTip(more, () => tr("More: the spellbook, the kingdom, quests, the puzzle map, digging, options and the rest of the game's buttons."));
    const end = make("iam001.def", "endTurn", myTurn);
    const follow = following ? this.followButton() : null;
    const next = nextOn && !follow ? make("iam000.def", "nextHero", myTurn) : null;
    if (next) next.label = "button: Next hero";
    const row = hud.store.shape().buttons === "row";
    let bw: number;
    let bh: number;
    const small = [...(cast ? [cast] : []), more];
    const extras: Container[] = [];
    if (row) {
      const wide = [...(next ? [next] : []), ...(follow ? [follow] : []), end];
      bw = small.length * (cell + GAP) + wide.length * (2 * cell + GAP) - GAP;
      small.forEach((b, i) => b.position.set(i * (cell + GAP), 0));
      wide.forEach((b, i) => b.position.set(small.length * (cell + GAP) + i * (2 * cell + GAP), 0));
      bh = cell;
    } else if (nextOn) {
      // [more][Next hero] over End turn (Follow two wide over End turn on the allies' turns: it has words).
      bw = 2 * cell + GAP;
      more.position.set(0, 0);
      let y = 0;
      if (next) {
        // One square (the owner: "next hero 1 by 1"): the middle of the original's wide button, its helmeted head, in a
        // rim of its own; the button's pressed and greyed faces still its own.
        next.position.set(cell + GAP - cell / 2, 0);
        const m = new Graphics().rect(cell + GAP, 0, cell, cell).fill(0xffffff);
        next.mask = m;
        const rim = new Graphics().rect(cell + GAP + 1, 1, cell - 2, cell - 2).stroke({ color: 0x000000, width: 2, alpha: 0.7 }).rect(cell + GAP + 3, 3, cell - 6, cell - 6).stroke({ color: 0xb08a3c, width: 2 });
        rim.eventMode = "none";
        next.hitArea = new Rectangle(cell / 2 / K, 0, cell / K, cell / K);
        extras.push(m, rim);
      }
      if (follow) follow.position.set(0, (y = cell + GAP));
      end.position.set(0, y + cell + GAP);
      bh = y + 2 * cell + GAP;
    } else {
      bw = 2 * cell + GAP;
      cast!.position.set(0, 0);
      more.position.set(cell + GAP, 0);
      let y = cell + GAP;
      for (const b of [follow]) if (b) ((b.position.set(Math.round((bw - 2 * cell) / 2), y)), (y += cell + GAP));
      end.position.set(Math.round((bw - 2 * cell) / 2), y);
      bh = y + cell;
    }
    // The week's days under End turn, part of its block, in the resource bar's own date cell with its seven pips (the owner,
    // 2026-10-29 23:50: "integrated with the next turn button"; 10-31 06:56: the big squares along the foot were uglier,
    // "attached to the widget with next turn button but old style"). A tap says the date in words.
    const day = hud.last?.s.day;
    let days: Container | null = null;
    if (day) {
      const k = hud.barK;
      const cellBar = new ResourceBar();
      await cellBar.set(player, [], { show: [], date: "", dateW: Math.round(bw / k), day: dateParts(day)[2], narrow: true });
      cellBar.label = `week days: ${tr("Month %1, Week %2, Day %3", ...dateParts(day))}`;
      cellBar.scale.set(k);
      days = cellBar;
      days.position.set(0, bh + GAP);
      bh += GAP + Math.round(ResourceBar.H * k);
      days.eventMode = "static";
      days.cursor = "pointer";
      days.on("pointertap", (e) => (e.stopPropagation(), hud.sayDate(day)));
      holdTip(days, () => tr("The week's days: %1. Tap: the date in words.", tr("Month %1, Week %2, Day %3", ...dateParts(day))));
    }
    block.addChild(backing(bw + 2 * GAP, bh + 2 * GAP), ...small, ...(next ? [next] : []), ...(follow ? [follow] : []), end, ...extras, ...(days ? [days] : []));
    block.children[0].position.set(-GAP, -GAP);
    // + and −: two small gold squares (2026-10-27: "smaller squares, golden plus minus"), stacked upright, side by side
    // up the rail sideways; a finger's target each.
    const Z = ZOOM_SQUARE;
    const zoom = extra("zoomButtons") ? new Container() : null;
    if (zoom) {
      const across = !screenSize.portrait;
      const zi = this.zoomButton("zoomIn", Z);
      const zo = this.zoomButton("zoomOut", Z);
      zo.position.set(across ? Z + GAP : 0, across ? 0 : Z + GAP);
      const [zw, zh] = across ? [2 * Z + GAP, Z] : [Z, 2 * Z + GAP];
      zoom.addChild(Object.assign(backing(zw + 2 * GAP, zh + 2 * GAP), { x: -GAP, y: -GAP }), zi, zo);
    }
    // The minimap's picture: a finger's square upright (it opens big on a tap), up to the rail's width sideways.
    const blockH = bh + 2 * GAP;
    const zoomH = zoom ? (screenSize.portrait ? 0 : Z + 2 * GAP + hud.widgetGap) : 0;
    const roomH = hud.bottom - hud.railRoomTop - blockH - zoomH - hud.widgetGap - 2 * GAP;
    const side = screenSize.portrait ? cell : Math.max(cell, Math.min(2 * cell, roomH));
    const mini = hud.minimap.thumbWidget(side);
    // (One-handed: a tab on the block's inner side moves the rail, the list and the widget to the other side and back.)
    if (hud.sides.hand) block.addChild(this.flipTab(hud.sides.hand === "right" ? -GAP - 30 : bw + GAP, -GAP));
    if (gen !== this.gen) return void [block, zoom, mini].forEach((c) => c?.destroy({ children: true }));
    for (const [piece, c] of [[hud.pieces.buttons, block], [hud.pieces.zoom, zoom], [hud.pieces.mini, mini]] as const) {
      piece.removeChildren().forEach((x) => x.destroy({ children: true }));
      if (c) piece.addChild(c);
    }
    this.place(block, bw, bh, zoom, mini, side);
  }

  /**
   * Where the three go. Upright: the block in the bottom corner on the thumb's side, the minimap and + / − side by side
   * over it. Sideways: up the rail's side from the bottom, the block, + and −, the minimap; a short screen scales the
   * three alike to fit under the bar's line.
   */
  private place(block: Container, bw: number, bh: number, zoom: Container | null, mini: Container, side: number) {
    const hud = this.hud;
    const G = hud.widgetGap;
    const Z = ZOOM_SQUARE;
    const left = hud.sides.hand === "left";
    if (screenSize.portrait) {
      const right = hud.W - 8 - GAP;
      const by = hud.bottom - GAP - bh;
      block.position.set(Math.round(right - bw), Math.round(by));
      // Over the block, at the screen's edge: + and − (the thumb's), the minimap beside them.
      const zh = 2 * Z + GAP;
      const top = by - GAP - G - GAP;
      if (zoom) zoom.position.set(Math.round(right - Z), Math.round(top - zh));
      mini.position.set(Math.round(right - (zoom ? Z + 2 * GAP + G : 0) - side), Math.round(top - side));
      this.top = top - Math.max(zoom ? zh : 0, side) - GAP;
      this.left = Math.min(right - bw, mini.x) - GAP;
      return;
    }
    const zh = zoom ? Z + 2 * GAP + G : 0;
    const total = side + 2 * GAP + G + zh + bh + 2 * GAP;
    // (Under the page's ☰ and Feedback: one-handed they sit over the rail.)
    const k = Math.min(1, (hud.bottom - hud.railRoomTop) / total);
    for (const c of [block, zoom, mini]) c?.scale.set(k);
    const w = 2 * 32 * K;
    const x0 = hud.sides.railX;
    // (Each centred on the rail's middle; a scaled rail keeps its outer edge.)
    const mid = left ? x0 + (w * k) / 2 : x0 + w - (w * k) / 2;
    let y = hud.bottom - (bh + GAP) * k;
    block.position.set(Math.round(mid - (bw * k) / 2), Math.round(y));
    y -= (2 * GAP + G) * k;
    if (zoom) {
      y -= (Z + 0) * k;
      zoom.position.set(Math.round(mid - ((2 * Z + GAP) * k) / 2), Math.round(y));
      y -= (2 * GAP + G) * k;
    }
    y -= side * k;
    mini.position.set(Math.round(mid - (side * k) / 2), Math.round(y));
    this.top = y - GAP * k;
    this.left = mid - (w * k) / 2 - GAP;
  }

  /**
   * Beyond the original (allies' turns, map/follow.ts): in next hero's place while the others move,
   * "Follow" takes the view back to the ally followed; "Following" (a free camera when tapped) while it does.
   */
  private followButton(): Container {
    const cell = 32 * K;
    const following = !!this.hud.follow?.following;
    const b = blankButtonNow(2 * cell, cell);
    const t = text(following ? tr("Following") : tr("Follow"), "bigfont", 1.25, following ? ([...WHITE] as Rgb) : ([...YELLOW] as Rgb));
    if (t.width > 2 * cell - 8) t.scale.set((t.scale.x * (2 * cell - 8)) / t.width);
    t.position.set(Math.round((2 * cell - t.width) / 2), Math.round((cell - t.height) / 2));
    b.addChild(t);
    if (following) b.alpha = 0.8;
    b.eventMode = "static";
    b.cursor = "pointer";
    b.label = "button: Follow allies' turns";
    b.hitArea = new Rectangle(0, 0, 2 * cell, cell);
    b.on("pointertap", () => (track("hud:follow"), this.hud.onFollow()));
    holdTip(b, () => (following ? tr("Following: the view goes with the ally whose turn it is. Tap: look around freely.") : tr("Follow: the view goes back to the ally whose turn it is.")));
    return b;
  }

  /**
   * More (EXTRAS railNextHero): the original's blank button with nine gold tiles, three by three, the picture of "more
   * buttons behind this" (the menu it opens is a grid of the original's buttons); pressed, the button's own down face.
   */
  private tilesButton(onTap: () => void): Container {
    const cell = 32 * K;
    const b = new Container();
    const face = (down: boolean) => {
      b.removeChildren().forEach((c) => c.destroy({ children: true }));
      b.addChild(blankButtonNow(cell, cell, down));
      const g = new Graphics();
      const t = Math.round(cell * 0.16);
      const gap = Math.round(cell * 0.07);
      const x0 = Math.round((cell - 3 * t - 2 * gap) / 2) + (down ? 1 : 0);
      const y0 = Math.round((cell - 3 * t - 2 * gap) / 2) + (down ? 1 : 0);
      for (let i = 0; i < 9; i++) {
        const x = x0 + (i % 3) * (t + gap);
        const y = y0 + Math.floor(i / 3) * (t + gap);
        g.rect(x + 1, y + 1, t, t).fill({ color: 0x000000, alpha: 0.6 }).rect(x, y, t, t).fill(0xe5c55a).stroke({ color: 0x7a5418, width: 1 });
      }
      b.addChild(g);
    };
    face(false);
    b.eventMode = "static";
    b.cursor = "pointer";
    b.hitArea = new Rectangle(0, 0, cell, cell);
    b.on("pointerdown", () => face(true));
    b.on("pointerup", () => face(false));
    b.on("pointerupoutside", () => face(false));
    b.on("pointertap", () => (track("hud:more"), onTap()));
    return b;
  }

  /** The tab that moves the one-handed pieces to the other side (two arrows, one each way). */
  private flipTab(x: number, y: number): Container {
    const tab = new Container();
    tab.label = "button: move the buttons to the other side";
    tab.addChild(backing(30, 64, 0.8));
    const g = new Graphics();
    const arrow = (cy: number, dir: 1 | -1) => g.poly([15 - 9 * dir, cy, 15 + 3 * dir, cy - 7, 15 + 3 * dir, cy + 7]).fill({ color: 0xe5d77b });
    arrow(22, -1);
    arrow(42, 1);
    tab.addChild(g);
    tab.position.set(x, y);
    tab.eventMode = "static";
    tab.cursor = "pointer";
    tab.hitArea = new Rectangle(0, 0, 30, 64);
    holdTip(tab, () => tr("Moves the buttons, the lists and the hero's panel to the other side of the screen, for the other thumb."));
    tab.on("pointertap", (e) => {
      e.stopPropagation();
      track("hud:flip");
      this.hud.flipped = !this.hud.flipped;
      this.hud.closePopups();
      void this.hud.redraw();
    });
    return tab;
  }

  /**
   * A + or − of the map's zoom: a small square (2026-10-27: "smaller squares, golden plus minus", as on 2026-10-26
   * 22:01), a gold rim and a gold sign on the panel's dark, `s` HUD pixels; its target never under a finger's.
   */
  private zoomButton(name: "zoomIn" | "zoomOut", s: number): Container {
    const gold = 0xf2d674;
    const b = new Container();
    const g = new Graphics();
    g.roundRect(0, 0, s, s, 4).fill({ color: 0x1a0f06, alpha: 0.9 }).stroke({ color: 0x000000, width: 3, alpha: 0.6 }).roundRect(0, 0, s, s, 4).stroke({ color: GOLD_TRIM, width: 2 });
    const l = Math.round(s * 0.5);
    const t = Math.max(4, Math.round(l / 5));
    g.rect(Math.round((s - l) / 2), Math.round((s - t) / 2), l, t).fill(gold);
    if (name === "zoomIn") g.rect(Math.round((s - t) / 2), Math.round((s - l) / 2), t, l).fill(gold);
    b.addChild(g);
    b.eventMode = "static";
    b.cursor = "pointer";
    b.label = `button: ${name === "zoomIn" ? "zoom in" : "zoom out"}`;
    const f = this.hud.finger;
    b.hitArea = new Rectangle(Math.min(0, (s - f) / 2), Math.min(0, (s - f) / 2), Math.max(s, f), Math.max(s, f));
    b.on("pointertap", () => (track(`hud:${name}`), this.hud.onButton(name)));
    holdTip(b, () => (name === "zoomIn" ? tr("Zoom in: the map bigger (two fingers pinch too).") : tr("Zoom out: more of the map (two fingers pinch too).")));
    return b;
  }
}
