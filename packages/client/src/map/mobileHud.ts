// The adventure screen on a phone or tablet (the touch layout): the map takes the whole screen and
// the original side panel gives way to a few big pieces over it, in the game's own art at twice the
// size so fingers can use them and the text reads: resources and the date along the top, your
// heroes and towns down the left, the buttons used every turn at the bottom right. What the
// original shows all the time sits behind a tap: the minimap, the selected hero's panel (army and
// all), and the rarer commands in a menu.
//
// This file is the HUD's shared state, its sizes and where its pieces may go; each widget is a part in map/hud/:
// dock.ts (the resource bar and the treasury), list.ts (heroes and towns), chip.ts (the hero widget), rail.ts (the
// buttons, + and −, and where they and the small minimap go), minimap.ts (the small and the big minimap), menu.ts (the
// more grid), arrange.ts (grab handles and Move the panels), notices.ts (toasts, the status flash, the new day),
// store.ts (what the player set, kept), look.ts (sizes, text, leather).
import { extra } from "../settings.ts";
import { logPlay } from "../feedback/recent.ts";
import { type AdventureState, type CreatureStats, type Hero, type World, dateParts } from "@heroes/core";
import { tr, type Text } from "../i18n/index.ts";
import { track } from "../usage.ts";
import type { H3Map } from "@heroes/formats";
import { type Application, Container, Graphics, type Texture } from "pixi.js";
import { loadFonts } from "../text.ts";
import { ResourceBar } from "../ui/blocks/resourceBar.ts";
import type { ArmyClicks } from "../ui/armyClicks.ts";
import { preloadBlankButton } from "../ui/kit.ts";
import { type Modals } from "../ui/modals.ts";
import { FINGER_CSS, navBarRight, onLayout, oneHand, pageButtons, screenSize } from "../ui/screen.ts";
import type { Hud, HudButton } from "./hud.ts";
import { covered, viewport } from "./viewport.ts";
import type { FollowShown } from "./follow.ts";
import { CORNER, FEEDBACK, GAP, K, PORTRAIT_K } from "./hud/look.ts";
import { HudStore, type MoveKey } from "./hud/store.ts";
import { ResourceDock } from "./hud/dock.ts";
import { HeroTownList } from "./hud/list.ts";
import { HeroWidget } from "./hud/chip.ts";
import { ButtonRail } from "./hud/rail.ts";
import { MinimapWidget } from "./hud/minimap.ts";
import { MoreMenu } from "./hud/menu.ts";
import { PanelArranger } from "./hud/arrange.ts";
import { HudNotices } from "./hud/notices.ts";

export class MobileHud implements Hud {
  readonly touch = true;
  readonly root = new Container();
  readonly mapLayer = new Container();
  /** View World puts its 190-wide panel at x 607 of this: it lands at the right edge. */
  readonly panel = new Container();
  creatures: CreatureStats[] | null = null;
  moraleLuck: ((h: Hero) => { morale: number; luck: number }) | null = null;
  army: ArmyClicks | null = null;
  /** The day's income of each resource (the page's). */
  income: (() => number[]) | null = null;
  onButton: (b: HudButton) => void = () => {};
  onHero: (id: number) => void = () => {};
  onTown: (id: number) => void = () => {};
  onListInfo: (at: { hero?: number; town?: number }, x: number, y: number) => void = () => {};
  explainMoraleLuck: ((target: Container, h: Hero, morale: boolean) => void) | null = null;
  offTurn: { modals: Modals; why: () => string | null } | null = null;
  /** The selected hero's portrait tapped (`held`: held, which opens its screen whether or not it's in view). */
  onInfoHero: (held?: boolean) => void = () => {};
  onMinimap: (x: number, y: number) => void = () => {};
  onResize: () => void = () => {};
  onFollow: () => void = () => {};

  // What the parts share.
  follow: FollowShown | null = null;
  player = -1;
  last: { s: AdventureState; me: number; selected: number; selectedTown: number; underground: boolean; myTurn: boolean } | null = null;
  asleep = false;
  /** HotA's tutorial map: View Tutorial Messages in the menu. */
  tutorial = false;
  /** One-handed: the pieces moved to the other side for now (a tap on the rail's tab, and back). */
  flipped = false;
  /** Where the bar ends (HUD pixels): the list and the toasts start under it. */
  barBottom = 48;
  private ready: Promise<void> = Promise.resolve();

  /** The floating pieces, each a widget of its own... */
  readonly pieces: Record<MoveKey, Container> = { list: new Container(), chip: new Container(), buttons: new Container(), bar: new Container(), zoom: new Container(), mini: new Container() };
  /** ...each inside its own mover (EXTRAS moveWidgets: where the player dragged it, kept per layout). */
  readonly movers: Record<MoveKey, Container> = { list: new Container(), chip: new Container(), buttons: new Container(), bar: new Container(), zoom: new Container(), mini: new Container() };
  /** The big minimap, the more grid and the treasury: opened beside their widget, whole on the screen (ui/blocks/popupPlace.ts). */
  readonly popups = new Container();
  /** Each movable piece's grab handle (EXTRAS moveWidgets): dragged, it moves the piece; tapped, it folds it away. */
  readonly handles = new Container();

  // The parts.
  readonly store = new HudStore(() => this.moveKey());
  readonly dock = new ResourceDock(this);
  readonly list = new HeroTownList(this);
  readonly chip = new HeroWidget(this);
  readonly rail = new ButtonRail(this);
  readonly minimap = new MinimapWidget(this);
  readonly more = new MoreMenu(this);
  readonly arranger = new PanelArranger(this);
  readonly notices = new HudNotices(this);

  constructor(app: Application) {
    app.stage.addChild(this.mapLayer, this.root);
    const { pieces, movers } = this;
    for (const k of Object.keys(pieces) as MoveKey[]) movers[k].addChild(pieces[k]);
    this.popups.addChild(this.minimap.box, this.more.box);
    this.root.addChild(...Object.values(movers), this.handles, this.popups, this.panel);
    this.handles.label = "panel: grab handles";
    // The panels lying over the map take taps all over (map/input.ts overHud), not only on their buttons.
    for (const p of [pieces.list, pieces.chip, pieces.bar, pieces.zoom, pieces.mini, this.minimap.box, this.more.box]) p.eventMode = "static";
    // Names for voice notes (feedback/voiceNote.ts tells a model what's on screen).
    this.mapLayer.label = "map: the adventure map";
    pieces.bar.label = "panel: resource bar and the week's days";
    pieces.list.label = "panel: hero and town list (left)";
    pieces.chip.label = "panel: selected hero chip with its army (bottom left)";
    pieces.buttons.label = "panel: buttons: adventure spells, more, next hero, end turn";
    pieces.zoom.label = "panel: zoom in and out";
    pieces.mini.label = "panel: small minimap";
    this.stopLayout = onLayout(() => this.layout());
  }
  private readonly stopLayout: () => void;

  dispose() {
    this.stopLayout();
    this.root.destroy({ children: true });
    this.mapLayer.destroy();
  }

  set visible(v: boolean) {
    this.root.visible = v;
    this.mapLayer.visible = v;
  }

  // ---- sizes and room ------------------------------------------------------------------------
  /**
   * The HUD's own scale and the space it lays out in (the screen, or about 600 wide upright): big
   * enough that the original's buttons at twice their size (64 HUD pixels) are a finger's width
   * (FINGER_CSS) on the device, as on a small phone they weren't.
   */
  get u() {
    const finger = FINGER_CSS / screenSize.css / (32 * K);
    return Math.max(screenSize.portrait ? PORTRAIT_K : 1, finger);
  }
  /** A finger's least target in HUD pixels (never under 44). */
  get finger() {
    return Math.max(44, Math.ceil(FINGER_CSS / (screenSize.css * this.u)));
  }
  /** The resource bar's scale: about 24 CSS pixels high (the strip is 22; The owner, 2026-10-26: 30 was too big), never under 1.25. */
  get barK() {
    return Math.min(2, Math.max(1.25, 24 / (ResourceBar.H * screenSize.css * this.u)));
  }
  /**
   * The page's own buttons along the top (menu and full screen, Feedback; style.css moves them, one-
   * handed): how far in from each side they reach, in HUD pixels, so the bar keeps clear of them.
   */
  pageClear(): { left: number; right: number; bottom: number } {
    const p = pageButtons();
    if (!p) return { left: CORNER, right: FEEDBACK, bottom: 48 };
    const u = this.u;
    return { left: Math.ceil(p.left / u) + 10, right: Math.ceil((screenSize.w - p.right) / u) + 10, bottom: Math.ceil(p.bottom / u) };
  }
  /** View World's side panel (190 wide, desktop-placed at x 607 of the panel): whole on screen, clear of the navigation bar. */
  placeWorldSide(side: Container) {
    const top = this.barBottom + 4;
    const k = Math.min(1.5, (this.bottom - top) / side.height, (this.W / 2) / side.width);
    side.scale.set(k);
    side.position.set(800 - navBarRight() - GAP - side.width, top + Math.max(0, (this.bottom - top - side.height) / 2));
  }
  get W() {
    return screenSize.w / this.u;
  }
  get H() {
    return screenSize.h / this.u;
  }
  /** Where the bottom pieces end: the screen's foot (the page already stops above a real inset, env(safe-area-inset-bottom);
   * an always-shown navigation bar is outside the page: the owner, 2026-10-26). */
  get bottom() {
    return this.H - 8;
  }
  /**
   * One-handed play (screen.ts oneHand): rail, list and chip side by side on the thumb's side, from
   * the edge in: the rail, then the list, then the chip. Otherwise the list at the left, the rail at the right.
   */
  get sides() {
    // Flipped (the tab on the rail): everything to the other side, so the thumb has the map (2026-10-25).
    const own = oneHand();
    const hand = own && this.flipped ? (own === "left" ? "right" : "left") : own;
    const railW = 2 * 32 * K;
    const listW = 64 * 1.5 + 10;
    if (hand === "right") {
      const railX = this.W - navBarRight() - railW - GAP;
      // (Clear of the rail's flip tab, 30 wide.)
      const listX = railX - GAP - 40 - listW;
      return { hand, railX, listX, chipEdge: listX - 10 };
    }
    if (hand === "left") {
      const railX = 8 + GAP;
      const listX = railX + railW + GAP + 40;
      return { hand, railX, listX, chipEdge: listX + listW + 10 };
    }
    return { hand, railX: this.W - navBarRight() - railW - GAP, listX: 6, chipEdge: 64 * 1.5 + 30 };
  }
  /** Places the chip (or the panel over it) along the thumb's side: from its edge, as wide as half the screen. */
  placeBySide(c: Container, y: number) {
    const { hand, chipEdge } = this.sides;
    const room = this.W / 2 - 16;
    c.scale.set(hand && c.width / c.scale.x > room ? room / (c.width / c.scale.x) : 1);
    c.position.set(hand === "right" ? chipEdge - c.width : chipEdge, y);
  }
  /** Sideways, where the rail's column may start: under the page's own buttons. */
  get railRoomTop() {
    return Math.max(this.barBottom, this.pageClear().bottom) + 8;
  }
  /** The space between two widgets: room for a grab handle between them. */
  get widgetGap() {
    return Math.round(this.finger * 0.3) + 12;
  }
  /** Which layout the moves are kept for: upright or sideways, and the hand (the player's own hand's key: flipped to the other side, the same moves mirrored; The owner: "not losing your layout"). */
  private moveKey() {
    return `${screenSize.portrait ? "up" : "side"}-${oneHand() || "both"}`;
  }
  get mirror() {
    return this.flipped && !!oneHand() ? -1 : 1;
  }

  private layout() {
    if (this.root.destroyed) return;
    this.root.scale.set(this.u);
    // The map fills the screen; the HUD floats over it.
    Object.assign(viewport, { x: 0, y: 0, w: screenSize.w, h: screenSize.h });
    Object.assign(covered, { top: 0, right: 0, bottom: 0, left: 0 });
    this.mapLayer.position.set(0, 0);
    this.panel.x = this.W - 800;
    this.arranger.stop();
    this.onResize();
    if (this.last) void this.redraw();
  }

  // ---- drawing ----------------------------------------------------------------------------------
  init(player: number): Promise<void> {
    if (player !== this.player) {
      this.player = player;
      this.ready = Promise.all([loadFonts(), preloadBlankButton()]).then(() => {});
    }
    return this.ready;
  }

  async update(s: AdventureState, me: number, selected: number, selectedTown: number, underground: boolean, myTurn: boolean) {
    this.last = { s, me, selected, selectedTown, underground, myTurn };
    await this.redraw();
  }

  /** The redraw running now, and whether another is wanted after it. */
  private drawing: Promise<void> | null = null;
  private again = false;
  /**
   * Draws the HUD from the last update, one redraw at a time: two at once (a walk's steps, the follow line) emptied and
   * measured each other's pieces halfway, and the panels were placed round half-drawn ones. Asked while one runs, it
   * runs once more after it (with the newest update).
   */
  redraw(): Promise<void> {
    if (this.drawing) {
      this.again = true;
      return this.drawing;
    }
    const run = async (): Promise<void> => {
      try {
        do {
          this.again = false;
          await this.drawOnce();
        } while (this.again && !this.root.destroyed);
      } finally {
        this.drawing = null;
      }
    };
    return (this.drawing = run());
  }

  private async drawOnce() {
    const l = this.last;
    if (!l) return;
    await this.ready;
    // Where the pieces along the top start (the bar is at the foot): under the page's own buttons upright.
    this.barBottom = screenSize.portrait ? this.pageClear().bottom + 2 : 0;
    // (The widget first: the list ends above it upright.)
    await Promise.all([this.dock.draw(l.s, l.me, l.myTurn), this.chip.draw(l.s, l.me, l.selected, l.selectedTown), this.rail.draw(l.myTurn, l.underground)]);
    // (The widget over what is at the foot under it, then the list above the widget.)
    this.chip.place();
    await this.list.draw(l.s, l.me, l.selected, l.selectedTown);
    this.arranger.apply();
    this.measureCover();
  }

  /** What of the map's edges the bar, the list, the rail and the chip lie over (viewport.ts covered). */
  measureCover() {
    const c = { top: 0, right: 0, bottom: 0, left: 0 };
    const { w, h } = screenSize;
    const { pieces } = this;
    const box = (p: Container) => (p.visible && p.children.length ? p.getBounds() : null);
    // Along the bottom: the bar, the chip, and upright the rows of buttons under it.
    for (const p of [pieces.bar, pieces.chip, ...(screenSize.portrait ? [pieces.buttons, pieces.zoom, pieces.mini] : [])]) {
      const b = box(p);
      if (b) c.bottom = Math.max(c.bottom, h - b.minY);
    }
    // Down the sides: the list, and in landscape the rail.
    for (const p of [pieces.list, ...(screenSize.portrait ? [] : [pieces.buttons, pieces.zoom, pieces.mini])]) {
      const b = box(p);
      if (!b) continue;
      if (b.minX + b.maxX < w) c.left = Math.max(c.left, b.maxX);
      else c.right = Math.max(c.right, w - b.minX);
    }
    for (const k of ["top", "right", "bottom", "left"] as const) covered[k] = Math.max(0, Math.min(c[k], (k === "top" || k === "bottom" ? h : w) / 2));
  }

  // ---- the pop-ups: the treasury, the big minimap, the more grid --------------------------------
  /**
   * While the menu or the big minimap is open, a tap anywhere else closes it and does nothing more
   * (it went through to the map and End Turn): an invisible sheet over the rest of the HUD and the map.
   */
  private readonly catcher = (() => {
    const g = new Graphics();
    g.label = "panel: tap to close the menu";
    g.eventMode = "static";
    g.visible = false;
    g.hitArea = { contains: () => true };
    g.on("pointertap", () => this.closePopups());
    return g;
  })();

  closePopups() {
    this.dock.close();
    this.more.box.visible = false;
    this.minimap.open = false;
    this.minimap.box.visible = false;
    this.catcher.visible = false;
  }

  openCatcher() {
    if (!this.catcher.parent) this.root.addChildAt(this.catcher, this.root.getChildIndex(this.popups));
    this.catcher.visible = true;
  }

  // ---- what the page tells it ----------------------------------------------------------------
  setFollow(f: FollowShown | null) {
    if (JSON.stringify(f) === JSON.stringify(this.follow)) return;
    this.follow = f;
    void this.redraw();
  }

  /**
   * The status line. Toasted over the map only when it's a `notice` or EXTRAS statusToasts is on: a toast
   * for every tap, route and visit line kept popping and changing (and repeated the visit's window).
   */
  setStatus(value: Text, notice = false) {
    if (value) logPlay(`status: ${value}`);
    if (import.meta.env.DEV) Object.assign(window, { __status: value });
    if (notice || extra("statusToasts")) this.notices.text(value, 2500 + Math.min(3000, value.length * 30));
  }

  /** Picked-up things: their pictures and amounts over the minimap. */
  showComponents(comps: { texture: Texture; caption: Text }[], line: Text, ms?: number) {
    const value = line || comps.map((c) => c.caption).join("  ");
    if (value) logPlay(`status: ${value}`);
    this.notices.flash(comps, line, ms ?? (comps.length ? 1500 : 2500 + Math.min(4000, line.length * 40)));
  }

  setTutorial(on: boolean) {
    this.tutorial = on;
  }

  setSleeping(asleep: boolean) {
    if (asleep === this.asleep) return;
    this.asleep = asleep;
    if (this.last) void this.rail.draw(this.last.myTurn, this.last.underground);
  }

  setView(view: { x: number; y: number; w: number; h: number }) {
    this.minimap.setView(view);
  }

  buildMinimap(map: H3Map, world: World, level: number) {
    this.minimap.build(map, world, level);
  }

  drawMinimap(s: AdventureState, world: World, level: number, me: number) {
    this.minimap.draw(s, world, level, me);
  }

  /** The date in words for a moment (a tap on the week's days). */
  sayDate(day: number) {
    track("hud:date");
    this.notices.text(tr("Month %1, Week %2, Day %3", ...dateParts(day)));
  }

  /** The original's new day animation (NEWDAY / NEWWEEKn) and the day, big in the middle for a moment. */
  showNewDay(s: AdventureState) {
    this.notices.newDay(s);
  }
}
