// The original adventure screen around the map (positions from VCMI's adventureMap.json):
// frame, minimap, buttons, hero and town lists, info bar, status and resource bars.
import { extra } from "../settings.ts";
import { hallLevel, upperArmy, type AdventureState, type CreatureStats, type Hero, type World, allied, dateLine, dateParts, movingNow, ownTowns } from "@heroes/core";
import type { H3Map } from "@heroes/formats";
import { type Application, Container, Graphics, Rectangle, Sprite, Texture, TilingSprite } from "pixi.js";
import { cut } from "../ui/blocks/windowParts.ts";
import { loadDef, loadDefPlayer, loadImage, heroPortrait, townIcon } from "../assets.ts";
import { heroQuickView, townQuickView } from "../ui/quickView.ts";
import type { ArmyClicks } from "../ui/armyClicks.ts";
import { GameText, WHITE, YELLOW, loadFonts } from "../text.ts";
import { DefButton, helpRow, hoverHelp, loadImagePlayer, textButton } from "../ui/kit.ts";
import { type Modals } from "../ui/modals.ts";
import { gameTexts } from "../ui/highScores.ts";
import { hudLift, onLayout, screenSize } from "../ui/screen.ts";
import { ResourceBar, shortAmount } from "../ui/blocks/resourceBar.ts";
import { heroHoverName, townHoverName } from "./describe.ts";
import { Minimap } from "./minimap.ts";
import { covered, viewport } from "./viewport.ts";
import { tr, said, fmt, type Text, fallback, NONE } from "../i18n/index.ts";
import { newDayCard } from "./newDay.ts";
import type { FollowShown } from "./follow.ts";
import { block } from "../ui/blocks/block.ts";

const MINIMAP = { x: 630, y: 26, size: 144 };
const BUTTONS = { x: 679, y: 196 };
const HERO_LIST = { x: 607, y: 196 };
const TOWN_LIST = { x: 746, y: 196 };
/** Rows in the hero and town lists: seven on a canvas at least 664 high (VCMI's listContainerLarge), else five. */
const listRows = () => (screenSize.h >= 664 ? 7 : 5);
/** The lists' height: the rows between the two 16-pixel scroll buttons, and a border. */
const listHeight = () => listRows() * 32 + 32;
/**
 * The info box's 176x166 pictures (ADSTATHR, ADSTATCS, ADSTATIN...): where the frame's leather recess has
 * them (AdvMap.pcx's leather there is the same pixels as theirs at exactly this point).
 */
const INFO = { x: 613, y: 399, w: 176, h: 166 };
/** Where the panel's lists end and the info box's part of the frame begins (VCMI: the info box container 210 high at the bottom). */
const PANEL_SPLIT = 390;
const RESOURCE_X = [37, 121, 205, 289, 373, 457, 541];
/** The panel's buttons (IAM000-015), loaded with the frame. */
const HUD_BUTTON_DEFS = ["iam000.def", "iam001.def", "iam002.def", "iam003.def", "iam004.def", "iam005.def", "iam006.def", "iam007.def", "iam008.def", "iam009.def", "iam010.def", "iam011.def", "iam012.def", "iam013.def", "iam014.def", "iam015.def"];

/**
 * The adventure screen's own pictures and texts, fetched while the map loads (the loading screen
 * stays up until the HUD is drawn, so the sooner they're in, the sooner the game shows).
 */
export function preloadHudArt(touch: boolean) {
  const defs = ["itpa.def", "itgflags.def", "imrl22.def", "ilck22.def", "cprsmall.def", ...(touch ? ["resource.def"] : ["imobil.def", "imana.def", "itmtl.def", "crest58.def", "hoursand.def", "hourglas.def"])];
  const images = touch ? [] : ["hpsxxx.pcx", "hpsyyy.pcx", "diboxbck.pcx", "adstathr.pcx", "adstatcs.pcx", "adstatin.pcx", "adstatnx.pcx", "adstatot.pcx"];
  // The message window's frame and its OK / Cancel too: a map's opening message comes up with them.
  const windows = [loadImage("diboxbck.pcx"), loadDefPlayer("dialgbox.def", 0), loadDef("iokay.def"), loadDef("icancel.def")];
  void Promise.all([loadFonts(), gameTexts(), ...defs.map((d) => loadDef(d)), ...images.map((i) => loadImage(i)), ...windows]).catch(() => {});
}

export type HudButton = "kingdom" | "level" | "quests" | "sleep" | "move" | "cast" | "advOptions" | "sysOptions" | "nextHero" | "endTurn" | "world" | "puzzle" | "dig" | "info" | "replay" | "zoomIn" | "zoomOut" | "tutorial";

/** What the map page needs of the screen around the map: the original's (AdventureHud) or the mobile one. */
export interface Hud {
  /** The phone and tablet HUD (MobileHud), not the original's panel: the layout it was made for. */
  readonly touch: boolean;
  readonly mapLayer: Container;
  /** Everything of the HUD but the map (a tap on it isn't the map's). */
  readonly root: Container;
  /** Where screens put their own panel (View World). */
  readonly panel: Container;
  visible: boolean;
  creatures: CreatureStats[] | null;
  moraleLuck: ((h: Hero) => { morale: number; luck: number }) | null;
  /** The day's income of each resource (the phone's treasury shows it). */
  income?: (() => number[]) | null;
  army: ArmyClicks | null;
  onButton: (b: HudButton) => void;
  onHero: (id: number) => void;
  onTown: (id: number) => void;
  /** Right-click (or a long press) on a hero or town in the lists: its quick view while held, at a canvas point. */
  onListInfo: (at: { hero?: number; town?: number }, x: number, y: number) => void;
  /** Why the turn's buttons are greyed (another player's turn), told by a tap on one (EXTRAS greyedWhy). */
  offTurn?: { modals: Modals; why: () => string | null } | null;
  /** The phone hero widget's morale or luck picture: its text on a tap or held (the hero screen's). */
  explainMoraleLuck?: ((target: Container, h: Hero, morale: boolean) => void) | null;
  onInfoHero: (held?: boolean) => void;
  onMinimap: (x: number, y: number) => void;
  onResize: () => void;
  /** The Follow control (allies' turns: map/follow.ts): a tap lets go of following, or takes it up again. */
  onFollow: () => void;
  /** Allies' turns being followable now: the Follow control and what the ally is doing (null: none). */
  setFollow(f: FollowShown | null): void;
  init(player: number): Promise<void>;
  update(s: AdventureState, me: number, selected: number, selectedTown: number, underground: boolean, myTurn: boolean): Promise<void>;
  /**
   * The status bar's line. A touch screen has no status bar: there it's a toast, but only a `notice`
   * (something the player must be told: a refusal, a spell to aim) unless EXTRAS statusToasts is on.
   */
  setStatus(text: Text, notice?: boolean): void;
  setSleeping(asleep: boolean): void;
  /** HotA's tutorial map: its View Tutorial Messages button (top right), or none. */
  setTutorial(on: boolean): void;
  setView(view: { x: number; y: number; w: number; h: number }): void;
  buildMinimap(map: H3Map, world: World, level: number): void;
  drawMinimap(s: AdventureState, world: World, level: number, me: number): void;
  showNewDay(s: AdventureState): void;
  /** Picked-up things (VCMI's CInfoBar components): pictures with captions, and a line, for a few seconds. */
  showComponents(comps: { texture: Texture; caption: Text }[], text: Text, ms?: number): void;
  /** Where View World's side panel goes (the mobile HUD's own place; the original's panel keeps it where it is). */
  placeWorldSide?(side: Container): void;
  /** Takes it off the screen for good (the other layout's HUD replaces it); the map layer's children are the page's. */
  dispose(): void;
}

export class AdventureHud implements Hud {
  readonly touch = false;
  readonly root = new Container();
  /** The map goes in here; it's clipped to the viewport and offset to it. */
  readonly mapLayer = new Container();
  /** The frame in three pieces (left, a stretch repeated across the extra width, right). */
  private readonly frame = new Container();
  private frameTexture: Texture | null = null;
  /** DIBOXBCK: fills the panel between the lists and the info box on a taller canvas. */
  private fillTexture: Texture | null = null;
  private readonly mask = new Graphics();
  /** Everything right of the map (panel, minimap, lists, info bar, resource bar): moves right on a wide canvas. */
  private readonly side = new Container();
  private readonly minimap = new Minimap(MINIMAP.size);
  /** The panel's bottom strip (resource bar, date), moved down on a taller canvas. */
  private readonly lower = new Container();
  /** The map's lower left corner gem, at the bottom of a taller canvas. */
  private readonly lowerLeft = new Container();
  private readonly heroList = new Container();
  private readonly townList = new Container();
  private readonly info = new Container();
  private readonly resources: GameText[] = [];
  private readonly date = new GameText("smalfont", [...WHITE] as [number, number, number]);
  /** A console's TV (EXTRAS padHud): the resource bar half as tall again, across the bottom, in place of the original's. */
  private bigBar: ResourceBar | null = null;
  private barParts: Container[] = [];
  // (One line, as the original's: a long message is cut.)
  private status = block(Object.assign(new GameText("smalfont", [...WHITE] as [number, number, number], "center", viewport.w - 10), { maxLines: 1 }), "mapStatus");
  private readonly gems: Sprite[] = [];
  private readonly buttons = new Map<HudButton, DefButton>();
  private player = -1;
  private heroScroll = 0;
  private townScroll = 0;

  onButton: (b: HudButton) => void = () => {};
  onHero: (id: number) => void = () => {};
  onTown: (id: number) => void = () => {};
  onListInfo: (at: { hero?: number; town?: number }, x: number, y: number) => void = () => {};
  /** Click on the hero portrait in the info bar. */
  onInfoHero: (held?: boolean) => void = () => {};
  /** Minimap click: tile to centre on. */
  onMinimap: (x: number, y: number) => void = () => {};
  onFollow: () => void = () => {};
  private follow: FollowShown | null = null;

  setFollow(f: FollowShown | null) {
    if (JSON.stringify(f) === JSON.stringify(this.follow)) return;
    this.follow = f;
    this.redrawInfo();
  }

  /** After the viewport changed size (a rotation, the touch layout switched). */
  onResize: () => void = () => {};

  constructor(app: Application) {
    this.mapLayer.mask = this.mask;
    app.stage.addChild(this.mapLayer, this.mask, this.root);
    this.root.addChild(this.frame, this.side, this.status);
    // The info box goes with the bottom strip: on a taller canvas it stays at the panel's bottom.
    this.side.addChild(this.minimap, this.heroList, this.townList, this.lower);
    this.lower.addChild(this.info);
    this.lower.addChild(this.date);
    this.root.addChild(this.lowerLeft);
    // Names for what a feedback note points at (feedback/pointAt.ts) and the note's drawn tree.
    this.mapLayer.label = "map: the adventure map";
    this.minimap.label = "panel: minimap";
    this.heroList.label = "panel: hero list";
    this.townList.label = "panel: town list";
    // The wheel over a list scrolls it (VCMI's CList::wheelScrolled).
    for (const [list, scroll] of [[this.heroList, (d: number) => this.scrollHeroes(d)], [this.townList, (d: number) => this.scrollTowns(d)]] as const) {
      list.eventMode = "static";
      list.on("wheel", (e) => e.deltaY && scroll(Math.sign(e.deltaY)));
    }
    this.info.label = "panel: selected hero or town (portrait, army)";
    this.minimap.position.set(MINIMAP.x, MINIMAP.y);
    this.minimap.onPick = (x, y) => this.onMinimap(x, y);
    // Right-click on the minimap: the original's help for the world map (HELP.TXT 291).
    this.minimap.onHelp = (x, y) => {
      const text = helpRow(291)?.help;
      if (text && DefButton.showHelp) DefButton.showHelp(text, x, y);
    };
    this.date.position.set(3 + 619, 575 + 4);
    this.status.position.set(8 + 5, 556 + 3);
    this.stopLayout = onLayout(() => this.layout());
  }
  private readonly stopLayout: () => void;

  dispose() {
    this.stopLayout();
    this.mapLayer.mask = null;
    for (const c of [this.root, this.mask, this.mapLayer]) c.destroy({ children: c !== this.mapLayer });
  }

  /** Places the map and the panel for the canvas width (800 in the original layout, the map wider on a wide one). */
  private layout() {
    if (this.root.destroyed) return;
    const extra = screenSize.w - 800;
    // (A console's bigger resource bar takes `hudLift` rows of its own at the bottom: the rest lays out as it would.)
    const taller = screenSize.h - 600 - hudLift();
    Object.assign(viewport, { x: 7, y: 7, w: 594 + extra, h: 546 + taller });
    Object.assign(covered, { top: 0, right: 0, bottom: 0, left: 0 });
    this.mapLayer.position.set(viewport.x, viewport.y);
    this.side.x = extra;
    // The status line, resource bar and date stay along the bottom of a taller canvas.
    this.lower.y = taller;
    this.lowerLeft.y = screenSize.h;
    this.mask.clear().rect(viewport.x, viewport.y, viewport.w, viewport.h).fill(0xffffff);
    // The status line is centred under the map: a new one for the new width.
    const text = this.status.value;
    this.status.destroy();
    this.status = block(Object.assign(new GameText("smalfont", [...WHITE] as [number, number, number], "center", viewport.w - 10), { maxLines: 1 }), "mapStatus");
    this.status.value = text;
    this.status.position.set(8 + 5, 556 + 3 + taller);
    this.root.addChild(this.status);
    // Five or seven rows in the lists: the scroll-down buttons move, the lists redraw.
    for (const b of this.listDown) b.y = HERO_LIST.y + listHeight() - 16;
    if (this.last) void this.update(this.last.s, this.last.me, this.last.selected, this.last.selectedTown, this.last.underground, this.last.myTurn);
    this.drawFrame();
    this.placeBigBar();
    this.placeTutorialButton();
    this.onResize();
  }

  /**
   * The original frame, its middle repeated to fill a wider canvas. On a taller one (as VCMI's
   * adventureMap layout) the frame's left part repeats a band of rows down to the bottom strip, the
   * info box stays at the bottom of the panel, and the room between it and the lists is the dialog
   * backing between the panel's borders.
   */
  private drawFrame() {
    const tex = this.frameTexture;
    this.frame.removeChildren().forEach((c) => c.destroy());
    if (!tex) return;
    const extra = screenSize.w - 800;
    const lift = hudLift();
    const taller = screenSize.h - 600 - lift;
    const piece = (sx: number, sw: number, sy: number, sh: number, dx: number, dy: number) => {
      const sp = new Sprite(cut(tex, { x: sx, y: sy, w: sw, h: sh }));
      sp.position.set(dx, dy);
      this.frame.addChild(sp);
    };
    // A band of rows across the whole width: left part, its middle repeated for the extra width, the panel.
    const row = (sy: number, sh: number, dy: number, panel = true) => {
      piece(0, 300, sy, sh, 0, dy);
      for (let x = 300; x < 300 + extra; x += 50) piece(250, Math.min(50, 300 + extra - x), sy, sh, x, dy);
      piece(300, panel ? 500 : 301, sy, sh, 300 + extra, dy);
    };
    const SPLIT = 553;
    const BAND = [300, 40] as const;
    row(0, SPLIT, 0, taller <= 0);
    for (let y = 0; y < taller; y += BAND[1]) row(BAND[0], Math.min(BAND[1], taller - y), SPLIT + y, false);
    if (taller > 0) {
      const px = 601 + extra;
      const fillRect = (x: number, y: number, w: number, h: number) => {
        if (h <= 0) return;
        const fill = this.fillTexture;
        this.frame.addChild(fill ? Object.assign(new TilingSprite({ texture: fill, width: w, height: h }), { x, y }) : new Graphics().rect(x, y, w, h).fill(0x0c0904));
      };
      // The panel: minimap, buttons and lists at the top; the info box's part at the bottom.
      piece(601, 199, 0, PANEL_SPLIT + 2, px, 0);
      let listsEnd = PANEL_SPLIT;
      if (listRows() > 5) {
        // Two more rows of the lists (a row of the original's repeated, the rows' own pictures go
        // over it), their bottom border, and the dialog backing under the buttons.
        const more = (listRows() - 5) * 32;
        for (let y = 0; y < more; y += 32) piece(601, 199, 228, 32, px, 389 + y);
        piece(601, 199, 389, 3, px, 389 + more);
        fillRect(679 + extra, 388, 64, more + 1);
        listsEnd = 392 + more;
      }
      piece(601, 199, PANEL_SPLIT, 600 - PANEL_SPLIT, px, PANEL_SPLIT + taller);
      // Between the lists and the info box: the panel's left and right borders run down, the dialog backing inside.
      const gap = PANEL_SPLIT + taller - listsEnd;
      for (let y = 0; y < gap; y += 10) {
        const h = Math.min(10, gap - y);
        piece(601, 6, PANEL_SPLIT - 12, h, px, listsEnd + y);
        piece(795, 5, PANEL_SPLIT - 12, h, px + 194, listsEnd + y);
      }
      fillRect(px + 6, listsEnd, 188, gap);
    }
    row(SPLIT, 600 - SPLIT, SPLIT + taller);
    // The bigger bar's rows: the bar's band again, its bottom border at the canvas's foot.
    if (lift) row(575, 25, 575 + taller + lift);
  }

  /**
   * A console's TV (EXTRAS padHud, the owner 2026-10-27: "I won't be able to read it on my TV"): the resource bar across the
   * bottom half as tall again, the medium font, amounts short (compactAmount), the date as three numbers; the original's
   * bar, amounts and date stay under it, hidden.
   */
  private placeBigBar() {
    const lift = hudLift();
    for (const c of this.barParts) c.visible = !lift;
    this.date.visible = !lift;
    for (const t of this.resources) t.visible = !lift;
    if (!lift) {
      if (this.bigBar) this.bigBar.visible = false;
      return;
    }
    if (!this.bigBar) {
      const b = (this.bigBar = new ResourceBar());
      b.label = "resource bar: resources and date (console)";
      b.eventMode = "static";
      hoverHelp(b, (x) => {
        const r = b.at(x);
        const row = r === undefined ? undefined : helpRow(r < 0 ? 316 : r === 6 ? 309 : 310 + r);
        const text = row?.help ?? NONE;
        return { hover: said(text.replace(/^\{[^}]*\}\s*/, "")), help: text };
      }, (t) => this.setStatus(t));
      this.root.addChild(b);
    }
    const k = (22 + lift) / 22;
    this.bigBar.visible = true;
    this.bigBar.scale.set(k);
    this.bigBar.position.set(3, screenSize.h - 3 - (22 + lift));
    if (this.last) void this.drawBigBar(this.last.s, this.last.me);
  }

  private async drawBigBar(s: AdventureState, me: number) {
    const b = this.bigBar;
    if (!b || !b.visible) return;
    const [m, w, d] = dateParts(s.day);
    const k = b.scale.x;
    await b.set(Math.max(0, me), s.players[me]?.resources ?? [], { narrow: true, font: "medfont", format: (n) => shortAmount(n), date: `${m} · ${w} · ${d}`, dateW: 84, fill: Math.floor((screenSize.w - 6) / k) });
  }

  /** Creature table, for morale in the info bar. */
  creatures: CreatureStats[] | null = null;
  /** The selected hero's morale and luck, as the hero screen has them. */
  moraleLuck: ((h: Hero) => { morale: number; luck: number }) | null = null;
  /** The selected hero's army in the info bar: picked stacks and their moves (set by the map page). */
  army: ArmyClicks | null = null;

  set visible(v: boolean) {
    this.root.visible = v;
    this.mapLayer.visible = v;
  }

  /** The side panel, for screens that put their own panel there (View World). */
  get panel(): Container {
    return this.side;
  }

  /** The minimap picture, for windows that show the map small (quest log). */
  get minimapTexture() {
    return this.minimap.texture;
  }

  /** A button's picture changes (sleep / wake, the level it would show): the same button from another DEF. */
  private swapButton(name: HudButton, def: string) {
    const b = this.buttons.get(name);
    if (!b || b.def === def) return;
    const nb = new DefButton(def, b.x, b.y, this.player);
    nb.onHint = (t) => this.setStatus(t);
    nb.onClick = () => this.onButton(name);
    nb.disabled = b.disabled;
    b.destroy();
    this.buttons.set(name, nb);
    this.side.addChild(nb);
  }

  /** The sleep button shows Wake for a sleeping hero. */
  setSleeping(asleep: boolean) {
    this.swapButton("sleep", asleep ? "iam011.def" : "iam005.def");
  }

  /** HotA's View Tutorial Messages, in the map's top right corner (its art isn't in the installed files: a plain button in its place). */
  private tutorialButton: Container | null = null;
  private tutorialWanted = false;
  setTutorial(on: boolean) {
    if (on === this.tutorialWanted) return;
    this.tutorialWanted = on;
    if (!on) return void (this.tutorialButton?.destroy({ children: true }), (this.tutorialButton = null));
    void textButton(tr("Tutorial Messages"), 128, 22, () => this.onButton("tutorial"), "smalfont").then((b) => {
      if (!this.tutorialWanted || this.root.destroyed || this.tutorialButton) return void b.destroy({ children: true });
      b.label = "button: View Tutorial Messages";
      b.on("pointerover", () => this.setStatus(tr("View Tutorial Messages")));
      b.on("pointerout", () => this.setStatus(said("")));
      this.tutorialButton = b;
      this.root.addChild(b);
      this.placeTutorialButton();
    });
  }
  private placeTutorialButton() {
    this.tutorialButton?.position.set(viewport.x + viewport.w - 128 - 6, viewport.y + 6);
  }

  setStatus(text: Text) {
    this.status.value = text;
    // (For the help-text probe.)
    if (import.meta.env.DEV) Object.assign(window, { __status: text });
  }

  private ready: Promise<void> = Promise.resolve();

  /** Builds the frame and buttons in the player's colours (again only when the player changes). */
  init(player: number): Promise<void> {
    if (player !== this.player) {
      this.player = player;
      this.ready = this.build(player);
    }
    return this.ready;
  }

  private async build(player: number) {
    const corners: [string, number, number][] = [["agemul.def", 6, 6], ["agemur.def", 800 - 198 - 46, 6], ["agemll.def", 6, 600 - 46 - 46], ["agemlr.def", 800 - 198 - 46, 600 - 46 - 46]];
    // Everything at once (one after another it took seconds on a slow line), then drawn together.
    const [frame, fill, barTexture, gemDefs] = await Promise.all([
      loadImagePlayer("advmap.pcx", player, { x: 7, y: 7, w: 594, h: 546 }),
      loadImage("diboxbck.pcx").catch(() => null),
      loadImagePlayer("aresbar.pcx", player),
      Promise.all(corners.map(([def]) => loadDef(def).catch(() => null))),
      loadFonts(),
      ...HUD_BUTTON_DEFS.map((def) => loadDefPlayer(def, player).catch(() => null)),
    ]);
    this.frameTexture = frame;
    this.fillTexture = fill;
    this.drawFrame();
    const bar = new Sprite(barTexture);
    bar.position.set(3, 575);
    this.lower.addChildAt(bar, 0);
    this.barParts = [bar];
    // The original's texts for the resources and the date (HELP.TXT 309 gold, 310-315 wood...gems,
    // 316 the date): in the status line on hover, in a popup while right-clicked.
    bar.eventMode = "static";
    hoverHelp(bar, (x) => {
      const r = x >= 616 ? -1 : Math.max(0, RESOURCE_X.findLastIndex((rx) => rx - 30 <= x));
      const row = helpRow(r < 0 ? 316 : r === 6 ? 309 : 310 + r);
      const text = row?.help ?? NONE;
      return { hover: said(text.replace(/^\{[^}]*\}\s*/, "")), help: text };
    }, (t) => this.setStatus(t));
    for (const t of this.resources) t.destroy();
    this.resources.length = 0;
    for (const x of RESOURCE_X) {
      const t = new GameText("smalfont", [...WHITE] as [number, number, number]);
      t.position.set(3 + x, 575 + 4);
      this.resources.push(t);
      this.lower.addChild(t);
    }
    // Player-coloured gems in the map corners.
    for (const g of this.gems) g.destroy();
    this.gems.length = 0;
    for (const [i, [, x, y]] of corners.entries()) {
      const frames = gemDefs[i]?.get(0) ?? [];
      const f = frames[Math.max(0, player)] ?? frames[0];
      if (!f) continue;
      const s = new Sprite(f.texture);
      s.position.set(x + f.x, y + f.y);
      this.gems.push(s);
      // The right-hand gems sit at the panel's edge, wherever it is; the lower ones at the bottom.
      const low = y > 300;
      if (low && x < 300) s.y -= 600;
      (x > 300 ? (low ? this.lower : this.side) : low ? this.lowerLeft : this.root).addChild(s);
    }
    for (const b of this.buttons.values()) b.destroy();
    this.buttons.clear();
    // The buttons' rollover and right-click texts are the original's own (HELP.TXT, through
    // DefButton; kit.ts BUTTON_HELP has the English fallback), so no hint is set here.
    const defs: [HudButton, string, number, number][] = [
      ["kingdom", "iam002.def", 0, 0],
      ["level", "iam010.def", 32, 0],
      ["quests", "iam004.def", 0, 32],
      ["sleep", "iam005.def", 32, 32],
      ["move", "iam006.def", 0, 64],
      ["cast", "iam007.def", 32, 64],
      ["advOptions", "iam008.def", 0, 96],
      ["sysOptions", "iam009.def", 32, 96],
      ["nextHero", "iam000.def", 0, 128],
      ["endTurn", "iam001.def", 0, 160],
    ];
    for (const [name, def, dx, dy] of defs) {
      const b = new DefButton(def, BUTTONS.x + dx, BUTTONS.y + dy, player);
      b.onHint = (t) => this.setStatus(t);
      b.onClick = () => this.onButton(name);
      this.buttons.set(name, b);
      this.side.addChild(b);
    }
    const scroll = (def: string, x: number, y: number, fn: () => void) => {
      const b = new DefButton(def, x, y, player);
      b.onHint = (t) => this.setStatus(t);
      b.onClick = fn;
      this.side.addChild(b);
      return b;
    };
    scroll("iam012.def", HERO_LIST.x + 2, HERO_LIST.y, () => this.scrollHeroes(-1));
    this.listDown = [
      scroll("iam013.def", HERO_LIST.x + 2, HERO_LIST.y + listHeight() - 16, () => this.scrollHeroes(1)),
      scroll("iam015.def", TOWN_LIST.x + 1, TOWN_LIST.y + listHeight() - 16, () => this.scrollTowns(1)),
    ];
    scroll("iam014.def", TOWN_LIST.x + 1, TOWN_LIST.y, () => this.scrollTowns(-1));
  }

  /** The lists' scroll-down buttons, at the bottom of five or seven rows. */
  private listDown: DefButton[] = [];
  private last: { s: AdventureState; me: number; selected: number; selectedTown: number; underground: boolean; myTurn: boolean } | null = null;
  private scrollHeroes(d: number) {
    this.heroScroll = Math.max(0, this.heroScroll + d);
    if (this.last) void this.update(this.last.s, this.last.me, this.last.selected, this.last.selectedTown, this.last.underground, this.last.myTurn);
  }
  private scrollTowns(d: number) {
    this.townScroll = Math.max(0, this.townScroll + d);
    if (this.last) void this.update(this.last.s, this.last.me, this.last.selected, this.last.selectedTown, this.last.underground, this.last.myTurn);
  }

  /** How many levels the map has (the level button is dead on a map of one). */
  private levels = 1;

  buildMinimap(map: H3Map, world: World, level: number) {
    this.levels = map.levels;
    this.minimap.build(map, world, level);
  }

  setView(view: { x: number; y: number; w: number; h: number }) {
    this.minimap.setView(view);
  }

  drawMinimap(s: AdventureState, world: World, level: number, me: number) {
    this.minimap.draw(s, world, level, me);
  }

  /** Resources, date, hero and town lists and the info bar. */
  async update(s: AdventureState, me: number, selected: number, selectedTown: number, underground: boolean, myTurn: boolean) {
    this.last = { s, me, selected, selectedTown, underground, myTurn };
    const p = s.players[me];
    if (p) p.resources.forEach((r, i) => (this.resources[i] ? (this.resources[i].value = said(String(r))) : undefined));
    // The original's own words for the date (GENRLTXT: Month, Week, Day).
    const words = (await gameTexts()).general;
    this.date.value = said(dateLine(s.day, ": ", [words[62] || fallback("Month"), words[63] || fallback("Week"), words[64] || fallback("Day")]));
    void this.drawBigBar(s, me);
    // The level button shows the level it would switch to, and is dead on a map of one level.
    this.swapButton("level", underground ? "iam003.def" : "iam010.def");
    const level = this.buttons.get("level");
    if (level) level.disabled = this.levels < 2;
    for (const name of ["nextHero", "endTurn", "move", "sleep"] as HudButton[]) {
      const b = this.buttons.get(name);
      if (b) b.disabled = !myTurn;
    }
    // Move hero greyed once the selected hero has no movement left (VCMI's AdventureMapInterface; A player's note).
    const move = this.buttons.get("move");
    if (move && myTurn && (s.heroes[selected]?.movement ?? 1) <= 0) move.disabled = true;
    await Promise.all([this.drawHeroList(s, me, selected), this.drawTownList(s, me, selectedTown), this.drawInfo(s, me, selected, selectedTown, myTurn)]);
  }

  private async drawHeroList(s: AdventureState, me: number, selected: number) {
    // Heroes on the map first, then those in a town's garrison (dimmed and marked: they can't be
    // selected on the map; a tap opens their town).
    const mine = s.heroes.filter((h) => !h.removed && h.owner === me);
    const heroes = [...mine.filter((h) => h.garrison === undefined), ...(extra("listGarrisoned") ? mine.filter((h) => h.garrison !== undefined) : [])];
    const rows = listRows();
    this.heroScroll = Math.min(this.heroScroll, Math.max(0, heroes.length - rows));
    const [mob, mana, empty, sel] = await Promise.all([loadDef("imobil.def"), loadDef("imana.def"), loadImage("hpsxxx.pcx").catch(() => null), loadImage("hpsyyy.pcx")]);
    const mf = mob.get(0) ?? [];
    const af = mana.get(0) ?? [];
    const items = await Promise.all(
      Array.from({ length: rows }, async (_, i) => {
        const h = heroes[this.heroScroll + i];
        const c = new Container();
        c.position.set(HERO_LIST.x + 3, HERO_LIST.y + 16 + i * 32);
        // Movement (left) and mana (right) bars, then the small portrait. The bars show amounts, as
        // VCMI's CHeroItem: a step per 100 movement points and per 5 spell points.
        const mi = h ? Math.min(mf.length - 1, Math.floor(h.movement / 100)) : 0;
        const ai = h ? Math.min(af.length - 1, Math.floor((h.mana ?? 0) / 5)) : 0;
        if (mf[mi]) c.addChild(Object.assign(new Sprite(mf[mi].texture), { x: 0, y: 1 }));
        // An empty row: the original's empty portrait (VCMI's CEmptyHeroItem).
        const pic = h ? await heroPortrait(h, "small") : empty;
        if (pic) c.addChild(Object.assign(new Sprite(pic), { x: 7, y: 0 }));
        if (af[ai]) c.addChild(Object.assign(new Sprite(af[ai].texture), { x: 56, y: 1 }));
        if (!h) return c;
        if (h.garrison !== undefined) {
          for (const x of c.children) x.alpha = 0.55;
          c.addChild(garrisonMark(46, 18));
        }
        if (h.id === selected) c.addChild(Object.assign(new Sprite(sel), { x: 7, y: 0 }));
        c.eventMode = "static";
        c.cursor = "pointer";
        c.on("pointertap", () => this.onHero(h.id));
        c.on("rightdown", (e) => this.onListInfo({ hero: h.id }, e.global.x, e.global.y));
        // The original's "Orrin the Knight" (GENRLTXT 15); Options: with its movement and spell points.
        c.on("pointerover", () =>
          this.setStatus(
            !extra("listHoverStats") ? heroHoverName(h)
            : h.garrison !== undefined ? tr(`%1: in the garrison of %2`, h.name, s.objects[h.garrison]?.name ?? "a town")
            : tr(`%1: %2/%3 movement · %4 spell points`, h.name, h.movement, h.maxMovement, h.mana ?? 0),
          ),
        );
        return c;
      }),
    );
    this.heroList.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const it of items) this.heroList.addChild(it);
  }

  private async drawTownList(s: AdventureState, me: number, selectedTown: number) {
    const towns = ownTowns(s, me);
    const rows = listRows();
    this.townScroll = Math.min(this.townScroll, Math.max(0, towns.length - rows));
    const icons = (await loadDef("itpa.def")).get(0) ?? [];
    const sel = await loadImage("hpsyyy.pcx");
    this.townList.removeChildren().forEach((c) => c.destroy({ children: true }));
    // Empty rows: ITPA's first picture (VCMI's CTownList).
    for (let i = towns.length - this.townScroll; i < rows; i++) {
      if (i < 0 || !icons[0]) continue;
      this.townList.addChild(Object.assign(new Sprite(icons[0].texture), { x: TOWN_LIST.x + 1, y: TOWN_LIST.y + 16 + i * 32 }));
    }
    towns.slice(this.townScroll, this.townScroll + rows).forEach((o, i) => {
      const fort = o.town!.built.includes(7);
      const c = new Container();
      c.position.set(TOWN_LIST.x + 1, TOWN_LIST.y + 16 + i * 32);
      void townIcon(o.subid, fort, !!o.town!.builtToday, "small").then((t) => t && !c.destroyed && c.addChildAt(new Sprite(t), 0));
      if (o.id === selectedTown) {
        const frame = new Sprite(sel);
        frame.width = 48;
        c.addChild(frame);
      }
      c.eventMode = "static";
      c.cursor = "pointer";
      c.on("pointertap", () => this.onTown(o.id));
      c.on("rightdown", (e) => this.onListInfo({ town: o.id }, e.global.x, e.global.y));
      c.on("pointerover", () => this.setStatus(townHoverName(o)));
      this.townList.addChild(c);
    });
  }

  /** Until when the new day's animation plays in the info bar. */
  private dayUntil = 0;
  private lastInfo: [AdventureState, number, number, number, boolean] | null = null;
  /** The info bar again, as last drawn (after the army changed). */
  redrawInfo() {
    if (this.lastInfo) void this.drawInfo(...this.lastInfo);
  }

  /** The box stepped by clicks: the game's status, then the date, each for three seconds (VCMI's CInfoBar). */
  private statusView: "game" | "date" | null = null;
  private statusUntil = 0;
  private cycleInfo() {
    const now = performance.now();
    const showing = now < this.statusUntil ? this.statusView : null;
    this.statusView = showing === null ? "game" : showing === "game" ? "date" : null;
    this.statusUntil = this.statusView ? now + 3000 : 0;
    this.redrawInfo();
    if (this.statusView) {
      const until = this.statusUntil;
      setTimeout(() => until === this.statusUntil && this.redrawInfo(), 3050);
    }
  }

  /** Until when, and what, the info bar shows of something picked up. */
  private compUntil = 0;
  private comps: { comps: { texture: Texture; caption: Text }[]; text: Text } | null = null;

  showComponents(comps: { texture: Texture; caption: Text }[], text: Text, ms = 3000) {
    this.comps = { comps, text };
    this.compUntil = performance.now() + ms;
    this.redrawInfo();
    setTimeout(() => performance.now() >= this.compUntil && this.redrawInfo(), ms + 50);
  }

  /** The original's new day in the info bar: NEWDAY (or NEWWEEKn on a Monday) and "Day n" / "Week n", 1.5 s. */
  showNewDay(s: AdventureState) {
    this.dayUntil = performance.now() + 1500;
    if (this.lastInfo) void this.drawInfo(...this.lastInfo);
    setTimeout(() => this.lastInfo && void this.drawInfo(...this.lastInfo), 1600);
    void s;
  }

  /** The game's status in the info box (VCMI's VisibleGameStatusInfo): towns by hall, allies' and enemies' flags. */
  private async gameStatus(c: Container, s: AdventureState, me: number) {
    c.addChild(new Sprite(await loadImage("adstatin.pcx")));
    const [halls, flags, texts] = await Promise.all([loadDef("itmtl.def"), loadDef("itgflags.def"), gameTexts()]);
    const count = [0, 0, 0, 0];
    for (const o of s.objects) {
      if (!o.town || o.removed || o.owner !== me) continue;
      const level = hallLevel(o.town!.built);
      if (level >= 0) count[level]++;
    }
    count.forEach((n, i) => {
      const f = halls.get(0)?.[i];
      if (f) c.addChild(Object.assign(new Sprite(f.texture), { x: 6 + 42 * i, y: 11 }));
      if (!n) return;
      const l = new GameText("smalfont", [...WHITE] as [number, number, number], "center", 40);
      l.value = said(String(n));
      // (VCMI's VisibleGameStatusInfo: CENTER labels on 26 + 42 per hall, 64.)
      l.centreOn(26 + 42 * i, 64);
      c.addChild(l);
    });
    const players = s.players.filter((p) => p.alive).map((p) => p.color);
    const rows: [string, number[], number][] = [
      [texts.general[390] || fallback("Allies"), players.filter((p) => p === me || allied(s, me, p)), 106],
      [texts.general[391] || fallback("Enemies"), players.filter((p) => p !== me && !allied(s, me, p)), 136],
    ];
    for (const [name, who, y] of rows) {
      const l = new GameText("smalfont", [...WHITE] as [number, number, number]);
      l.value = fmt`${said(name)}:`;
      l.position.set(10, y);
      c.addChild(l);
      let x = 10 + l.width + 4;
      for (const p of who) {
        const f = flags.get(0)?.[p];
        if (!f) continue;
        c.addChild(Object.assign(new Sprite(f.texture), { x, y: y - 4 }));
        x += f.texture.width;
      }
    }
  }

  /**
   * The date in the info box (VCMI's VisibleDateInfo): the day's own picture (NEWDAY, or NEWWEEKn
   * on the first day of a week) and "Day n" / "Week n" over it, in the game's own words.
   */
  private async dateView(c: Container, s: AdventureState, anim: (frames: { texture: Texture; x?: number; y?: number }[], x: number, y: number, ms: number, once?: boolean) => Sprite) {
    const card = newDayCard(s.day);
    const [frames, texts] = await Promise.all([
      loadDef(card.def)
        .catch(() => loadDef("newday.def"))
        .then((d) => (d.get(0) ?? []) as { texture: Texture }[]),
      gameTexts(),
    ]);
    c.addChild(anim(frames, 1, 0, 180, true));
    // (Centred on the box's middle, 31 down, as a CENTER label.)
    const txt = new GameText("medfont", [...WHITE] as [number, number, number]);
    txt.value = fmt`${card.newWeek ? texts.general[63] || fallback("Week") : texts.general[64] || fallback("Day")} ${card.n}`;
    txt.centreOn(Math.floor(INFO.w / 2), 31);
    c.addChild(txt);
  }

  /** Info bar: the selected hero (or town), else the date; the hourglass while others move. */
  private async drawInfo(s: AdventureState, me: number, selected: number, selectedTown: number, myTurn: boolean) {
    this.lastInfo = [s, me, selected, selectedTown, myTurn];
    const c = new Container();
    c.position.set(INFO.x, INFO.y);
    const h: Hero | undefined = s.heroes[selected];
    const t = selectedTown >= 0 ? s.objects[selectedTown] : undefined;
    // A DEF animation; each frame has its own offset inside the DEF's box.
    const anim = (frames: { texture: Texture; x?: number; y?: number }[], x: number, y: number, ms: number, once = false) => {
      const sp = new Sprite(frames[0]?.texture ?? Texture.EMPTY);
      const place = (f?: { x?: number; y?: number }) => sp.position.set(x + (f?.x ?? 0), y + (f?.y ?? 0));
      place(frames[0]);
      let i = 0;
      const timer = setInterval(() => {
        if (sp.destroyed) return clearInterval(timer);
        if (once && i >= frames.length - 1) return clearInterval(timer);
        i = (i + 1) % frames.length;
        if (frames[i]) {
          sp.texture = frames[i].texture;
          place(frames[i]);
        }
      }, ms);
      return sp;
    };
    if (myTurn && this.comps && performance.now() < this.compUntil) {
      // Something picked up (VCMI's VisibleComponentInfo): ADSTATOT, the line, up to two pictures with captions.
      const { comps, text } = this.comps;
      c.addChild(Object.assign(new Sprite(await loadImage("adstatot.pcx")), { x: 0, y: 0 }));
      let top = 8;
      if (text) {
        const line = new GameText("smalfont", [...WHITE] as [number, number, number], "center", INFO.w - 16);
        line.value = text;
        line.position.set(8, top);
        c.addChild(line);
        top += line.height + 4;
      }
      const shown = comps.slice(0, 2);
      const slot = INFO.w / Math.max(1, shown.length);
      shown.forEach((p, i) => {
        const pic = new Sprite(p.texture);
        const k = Math.min(1, 80 / p.texture.width, (INFO.h - top - 20) / p.texture.height);
        pic.scale.set(k);
        pic.position.set(Math.round(i * slot + (slot - pic.width) / 2), top + Math.round((INFO.h - top - 20 - pic.height) / 2));
        c.addChild(pic);
        const cap = new GameText("smalfont", [...WHITE] as [number, number, number], "center", slot);
        cap.value = p.caption;
        cap.position.set(i * slot, INFO.h - 18);
        c.addChild(cap);
      });
    } else if (myTurn && this.statusView === "game" && performance.now() < this.statusUntil) {
      await this.gameStatus(c, s, me);
    } else if (myTurn && performance.now() < this.dayUntil) {
      await this.dateView(c, s, anim);
    } else if (!myTurn && s.winner === undefined) {
      // Others' turn: the mover's crest and the hourglass (VCMI's VisibleEnemyTurnInfo). Not once the
      // game is over (no one moves then): the box keeps the hero, town or date under the victory message.
      c.addChild(new Sprite(await loadImage("adstatnx.pcx")));
      // The mover's crest; in simultaneous turns, the crests of everyone still moving, in turn.
      const crests = (await loadDef("crest58.def")).get(0) ?? [];
      const movers = movingNow(s).filter((p) => p !== me || s.turnMode === "sequential");
      if (movers.length && crests[movers[0]]) {
        const crest = new Sprite(crests[movers[0]].texture);
        crest.position.set(20, 51);
        c.addChild(crest);
        let k = 0;
        const t = setInterval(() => {
          if (crest.destroyed || movers.length < 2) return clearInterval(t);
          k = (k + 1) % movers.length;
          const f = crests[movers[k]];
          if (f) crest.texture = f.texture;
        }, 1000);
      }
      const [sand, glass] = await Promise.all([loadDef("hoursand.def"), loadDef("hourglas.def")]);
      c.addChild(anim((sand.get(0) ?? []) as { texture: Texture }[], 99, 51, 100));
      c.addChild(anim((glass.get(0) ?? []) as { texture: Texture }[], 99, 51, 1000, true));
      // Beyond the original (allies' turns, map/follow.ts): what the ally followed is doing, and a
      // click lets go of following (a free camera) or takes it up again.
      const f = this.follow;
      if (f) {
        const line = (value: Text, y: number, color: readonly [number, number, number]) => {
          const t = new GameText("smalfont", [...color] as [number, number, number], "center", INFO.w - 12);
          t.value = value;
          t.position.set(6, y);
          c.addChild(t);
        };
        if (f.caption) line(f.caption, 114, WHITE);
        line(f.following ? tr("Following") : tr("Click to follow"), 140, f.following ? WHITE : YELLOW);
        c.label = "button: Follow allies' turns";
        c.cursor = "pointer";
        c.on("pointertap", () => this.onFollow());
      }
    } else if (h && !h.removed && h.owner === me && selectedTown < 0 && !(this.statusView === "date" && performance.now() < this.statusUntil)) {
      // The selected hero (VCMI's CInteractableHeroTooltip): as the right-click view, and its army can be rearranged here.
      const tip = await heroQuickView(h, me, this.creatures ?? [], null, { background: "adstathr.pcx", margin: false, moraleLuck: this.moraleLuck?.(h), army: this.army ? { clicks: this.army, changed: () => this.redrawInfo() } : undefined });
      // Beyond the original: a click anywhere but the army opens the hero screen (the original's
      // own click steps through the box's views, which is what the classic interface keeps).
      if (extra("infoBoxHero")) {
        tip.eventMode = "static";
        tip.cursor = "pointer";
        tip.hitArea = new Rectangle(0, 0, INFO.w, INFO.h);
        tip.on("pointertap", () => this.onInfoHero());
      }
      c.addChild(tip);
    } else if (t?.town && !(this.statusView === "date" && performance.now() < this.statusUntil)) {
      c.addChild(await townQuickView(t, me, this.creatures ?? [], upperArmy(s, t), { background: "adstatcs.pcx", margin: false }));
    } else if (this.statusView === "date" && performance.now() < this.statusUntil) {
      // The date, as the click cycle's second step: the day's own picture and its number
      // (VCMI's VisibleDateInfo, the same view a new day shows).
      await this.dateView(c, s, anim);
    } else {
      // Nothing selected: the game's status, as VCMI's CInfoBar::showSelection does.
      await this.gameStatus(c, s, me);
    }
    // A click on the box (but the hero's, which opens the hero screen) steps through the game's
    // status and the date, as VCMI's CInfoBar. The box always takes the pointer, so a right-click
    // anywhere in it (even over the hero view) reaches the help below.
    c.eventMode = "static";
    c.hitArea = new Rectangle(0, 0, INFO.w, INFO.h);
    if (myTurn && !c.children.some((x) => x.eventMode === "static")) {
      c.cursor = "pointer";
      c.on("pointertap", () => this.cycleInfo());
    }
    // Right-click: the original's own help for the status window (HELP.TXT 292), in a popup while held.
    c.on("rightdown", async (e) => {
      const text = helpRow(292)?.help || (await gameTexts()).general[109] || tr("The info box: the selected hero or town, the date, or what was just found.");
      if (DefButton.showHelp) DefButton.showHelp(text, e.global.x, e.global.y);
      else this.setStatus(text);
    });
    this.info.removeChildren().forEach((x) => x.destroy({ children: true }));
    this.info.addChild(c);
  }
}

/** A hero list's mark for a hero in a town's garrison: a little gold gatehouse at (x, y), 12 wide. */
export function garrisonMark(x: number, y: number): Graphics {
  const g = new Graphics()
    .rect(0, 3, 12, 9)
    .rect(0, 0, 3, 3)
    .rect(4.5, 0, 3, 3)
    .rect(9, 0, 3, 3)
    .fill(0xf2d674)
    .rect(4, 6, 4, 6)
    .fill(0x2a1c08);
  g.position.set(x, y);
  return g;
}
