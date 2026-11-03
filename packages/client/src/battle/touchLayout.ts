// The battle's touch layout, in the room beside the 800x600 battlefield: the bar's buttons again
// at up to twice their size, the message line and whose turn it is in big text. On phones the
// seldom-used left-hand group (options, surrender, retreat, auto and quick combat) goes behind one
// Menu button, and the left-hand room shows the message, the turn's stack and who moves next.
// Everything else past the field's edges stays clipped away (`clip` is the battle root's mask).
// Upright (screen.ts's experimental layout) there's no room beside the field but plenty under it:
// the buttons go in a row under the field, the message and who moves next below them.
// One-handed (screen.ts oneHand): everything to press on the thumb's side, with a touchpad there:
// dragging on it moves an aiming ring over the field (the stack's move or attack shows as a hover
// would) with a magnifier of that spot over the thumb (loupe.ts), and lifting the thumb acts there
// (without the magnifier, settings.ts battleLoupe, a tap on the pad confirms). The message and the queue take the other side.
import type { CreatureStats } from "@heroes/core";
import { Container, Graphics, Sprite, type Texture, TilingSprite } from "pixi.js";
import { creaturePortrait } from "../assets.ts";
import { type GameText, WHITE, YELLOW, placeByText } from "../text.ts";
import { DefButton, FingerArea, blankButton, helpRow, label, textButton, windowFrame } from "../ui/kit.ts";
import { type Modals } from "../ui/modals.ts";
import { canvasBox, cutoutTop, fingerPx, navBarRight, oneHand, pageButtons, phoneSized, screenSize } from "../ui/screen.ts";
import { BAR_Y, SCREEN_H, SCREEN_W } from "./layout.ts";
import { extra } from "../settings.ts";
import { CPRESULT, RIM, consoleBox } from "../ui/blocks/windowParts.ts";
import { phoneFrame } from "../ui/blocks/phoneWindow.ts";
import { GOLD as GOLD_TRIM } from "../ui/blocks/menuBlocks.ts";
import { queueCell } from "./queueCell.ts";
import { PLAYER_RGB } from "../map/minimap.ts";
import { tr, said, fmt, join, type Text, NONE } from "../i18n/index.ts";
import { holdTip } from "../ui/holdTip.ts";
import { playSound } from "../audio.ts";
import { PadTips, stored } from "./touchPad.ts";

/** Below the page's Feedback button, which sits in the top right corner on touch screens. */
const HINT_Y = 64;
/** The field's last hexes end here (x 58-741): past it there's only the enemy hero, which may lie under the navigation bar. */
const HEX_RIGHT = 745;
/** One-handed: the least room on the far side for the message and the queue (else the message goes over the field's top, and no queue). */
const FAR_ROOM = 160;
/** Upright: the band over the field for the heroes and who moves next (canvas pixels; the screen is 800 across). */
export const UPRIGHT_TOP = 126;
/** Upright: where the field starts on the canvas: the band under a camera's (the punch hole sat over the middle of who
 * moves next: the owner, 2026-11-03). */
export const uprightFieldTop = () => UPRIGHT_TOP + cutoutTop();

/** The stack whose turn it is, as the card under the message shows it. */
export interface TurnCard {
  creature: CreatureStats;
  count: number;
  /** Its numbers in this battle, a line or two. */
  numbers: string;
}

/** A blow as the phone's message draws it: who hit whom, the damage and the dead, in pictures and numbers. */
export interface Blow {
  from?: CreatureStats;
  to?: CreatureStats;
  damage: number;
  killed: number;
  /** A word first (a spell's name, "Lucky!"...). */
  lead?: string;
  /** The stacks' ids (upright: their portraits in the log pick them). */
  fromUnit?: number;
  toUnit?: number;
  /** Their sides (upright: the portraits framed in the side's colour, as in the queue). */
  fromSide?: number;
  toSide?: number;
}

/** A stack in the phone's who-moves-next list. */
export interface QueueRow {
  /** The stack's id. */
  unit: number;
  creature: CreatureStats;
  count: number;
  side: 0 | 1;
  /** Its side's flag colour. */
  flag: number;
  nextRound: boolean;
  portrait: Texture | null;
}

export class BattleTouch {
  /** Goes into the battle root above the field; hidden when there's no room (under a window: shown, not tapped). */
  readonly layer = new Container();
  private buttons: { sprite: Container; side: 0 | 1 }[] = [];
  menu: Container | null = null;
  private queue = new Container();
  /** The touchpad's size (this layer's pixels), for a gain that takes a drag across it over the whole field. */
  padSize: { w: number; h: number } | null = null;
  /** A finger on a queue row (or the mouse over it) points at that stack on the field; null when it lifts. */
  onQueuePoint: (unit: number | null) => void = () => {};
  private hintBox: Container | null = null;
  /**
   * The message's pictures kept from one draw to the next (2026-11-03: each pad move redrew the whole
   * reading room, every log line and the leather made again as new pictures, 0.2-0.7 s a move and the heap filling up
   * till the browser stopped to clear it). A label is drawn once for its words, colour and width; the rest is reused.
   */
  private kept = new Map<string, Container>();
  private keptNow = new Map<string, number>();
  private keep<T extends Container>(key: string, make: () => T): T {
    // (The same words twice in one draw, a stack waiting two turns running: each its own.)
    const n = this.keptNow.get(key) ?? 0;
    this.keptNow.set(key, n + 1);
    const k = `${key}\u0002${n}`;
    let c = this.kept.get(k) as T | undefined;
    if (!c || c.destroyed) this.kept.set(k, (c = make()));
    this.usedNow.add(k);
    return c;
  }
  private usedNow = new Set<string>();
  /** A label of the message, kept (keep()). */
  private keptLabel(t: Text, color: readonly [number, number, number], width: number): GameText {
    return this.keep(`${String(t)}\u0001${color.join()}\u0001${width}`, () => label(t, "medfont", color, "left", width));
  }
  private hint: Text = NONE;
  private card: TurnCard | null = null;
  /** Auto combat on: a line under the message says how to take over (the blows replace the turn's line). */
  private autoOn = false;
  /** The tactics phase's own buttons (phones have no bar for the original's). */
  private tactics: Container | null = null;
  private tacticsCalls = 0;

  private readonly clip: Graphics;
  private readonly modals: Modals;
  /** How much bigger the field is drawn (view.ts: upright it crops the heroes' sides; a compact phone draws it smaller); this layer stays in screen pixels. */
  fieldK = 1;
  /** One-handed: the touchpad and what it tells the view. */
  private pad: Container | null = null;
  private padHandlers: { start: () => void; drag: (dx: number, dy: number, at?: { x: number; y: number }) => void; release: (moved: boolean) => void; tap: () => void } | null = null;

  /** One-handed play: what dragging and tapping the touchpad do (view.ts). */
  setPad(h: BattleTouch["padHandlers"]) {
    this.padHandlers = h;
  }

  /** The side the thumb reaches (one-handed), else null. */
  private get hand() {
    return phoneSized() && !screenSize.portrait ? oneHand() : null;
  }

  /**
   * The side the touchpad goes on sideways: the thumb's one-handed; held in both hands, the right (the owner's note
   * 2026-10-27 18:20: "trackpad needed in landscape two-handed too"; EXTRAS padTwoHands), its buttons in a row under it.
   */
  private get padHand(): "left" | "right" | null {
    return this.hand ?? (phoneSized() && !screenSize.portrait && extra("padTwoHands") ? "right" : null);
  }

  /** A finger's least target, in canvas pixels: about 46 CSS pixels. */
  private get finger() {
    return fingerPx();
  }

  /** The page's own corner buttons (menu, full screen, Feedback): what they take at the top, in canvas pixels. */
  private get pageTop() {
    return Math.ceil(58 / screenSize.css);
  }

  /**
   * A sideways phone whose room right of the field, less the navigation bar, can't take a column of
   * finger-sized buttons (732 CSS pixels wide and less): the field moves right, as far as keeps its
   * hexes clear of the bar, and everything to press goes in the left-hand column, under the message.
   */
  get compact() {
    if (!screenSize.touch || !phoneSized() || screenSize.portrait || this.hand) return false;
    return screenSize.ox - navBarRight() < (48 * this.finger) / 36 + 16;
  }

  /** Where the field's left edge goes on the canvas (landscape): the middle, or right of a wide left-hand column (compact). */
  fieldX() {
    const { ox, w } = screenSize;
    // One-handed on the right: the field moves left until a finger-sized column fits beside the bar.
    if (this.hand === "right") {
      // (Room on the left too narrow for the message and the queue: none, the field at the edge.)
      const x = Math.max(0, Math.min(ox, w - SCREEN_W * this.fieldScale() - navBarRight() - (48 * this.finger) / 36 - 16));
      return x < FAR_ROOM ? 0 : x;
    }
    if (!this.compact) return ox;
    const k = this.fieldScale();
    return k < 1 ? w - navBarRight() - SCREEN_W * k : Math.max(ox, Math.min(2 * ox, w - navBarRight() - HEX_RIGHT));
  }

  /**
   * Sideways phones: how big the field is drawn (view.ts). Compact, all of it, the heroes too, sits
   * between the left-hand column (clear of the page's buttons: menu, full screen, Feedback) and the
   * navigation bar; one-handed, under the page's buttons; 1 when it fits as it is.
   */
  fieldScale() {
    // One-handed the page's buttons share the top with the message (they covered a hero): the field
    // starts under them, drawn smaller (the thumb plays it with the touchpad).
    // (Phones show the field down to the bar's top only.)
    if (this.hand) return Math.min(1, (SCREEN_H - this.fieldTop()) / BAR_Y);
    if (!this.compact) return 1;
    const { ox, w } = screenSize;
    const p = pageButtons();
    const left = Math.max(Math.min(2 * ox, w - navBarRight() - HEX_RIGHT), p ? p.left + 6 : 0);
    return Math.min(1, (w - navBarRight() - left) / SCREEN_W);
  }

  /** One-handed: how far down the canvas the field starts (under the page's buttons); else 0. */
  fieldTop() {
    if (!this.hand) return 0;
    const p = pageButtons();
    return p ? p.bottom + 4 : 0;
  }

  /** The field's width on the canvas (landscape; drawn smaller on a compact phone). */
  private get fieldW() {
    return screenSize.portrait ? SCREEN_W : SCREEN_W * this.fieldK;
  }

  /** The room left of the field and right of it (the latter with the navigation bar still in it). */
  private get leftW() {
    return this.fieldX();
  }
  private get rightW() {
    return screenSize.w - this.fieldX() - this.fieldW;
  }

  /** The middle of the room left / right of the field. */
  private roomX(side: "left" | "right") {
    return side === "left" ? -this.leftW / 2 : this.fieldW + (this.rightW - this.navBar) / 2;
  }

  /** Sideways on a phone the right-hand 72 CSS pixels are Android's navigation bar's (in field pixels). */
  private get navBar() {
    return phoneSized() && !screenSize.portrait ? Math.min(this.rightW / 2, navBarRight()) : 0;
  }

  /** The room the message and the queue get: the left-hand column on phones, else beside the field, or (upright) the width under it. */
  private get panelW() {
    return screenSize.portrait ? SCREEN_W : phoneSized() && this.hand !== "left" ? this.leftW : this.hand === "left" ? this.rightW - this.navBar : screenSize.ox;
  }

  constructor(clip: Graphics, modals: Modals) {
    this.clip = clip;
    this.modals = modals;
  }

  /** Drops the buttons (before they're made again for a new battle). */
  reset() {
    this.layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.hintBox = null;
    this.kept.clear();
    this.buttons = [];
    this.menu = null;
    this.queue = new Container();
    this.layer.addChild(this.queue);
    this.top = new Container();
    this.picked = null;
    this.log = [];
  }

  /** A big copy of one of the bar's buttons: side 0 is the left-hand group, 1 the right-hand one. */
  addButton(sprite: Container, side: 0 | 1) {
    this.buttons.push({ sprite, side });
    this.layer.addChild(sprite);
  }

  /**
   * The phone's Menu button: a window with the left-hand group's own buttons (the original's art, as
   * on the bar), each named under it, and Cancel. `def`: the button's art.
   */
  async setMenu(items: MenuItem[]) {
    // The tiles (2026-11-02 19:27: not the Options art, which is one of the choices inside): "more buttons here".
    this.menu = await menuPicture();
    this.menu.label = "button: Menu";
    const hit = new Graphics().rect(0, 0, 48, 36).fill({ color: 0, alpha: 0.001 });
    hit.eventMode = "static";
    hit.cursor = "pointer";
    hit.on("pointertap", async () => {
      void playSound("button");
      const shown = items.filter((x) => !x.shown || x.shown());
      const i = await iconChoice(this.modals, shown);
      if (i >= 0) shown[i].fn();
    });
    holdTip(hit, () => {
      const names = items.filter((x) => !x.shown || x.shown()).map((x) => x.name);
      return tr("Menu: %1.", join(names, ", "));
    });
    this.menu.addChild(hit);
    this.layer.addChild(this.menu);
  }

  /** Tactics: Next stack and Start battle in place of the right-hand group while the phase lasts (null ends it). */
  async setTactics(h: { next: () => void; end: () => void } | null) {
    const call = ++this.tacticsCalls;
    this.tactics?.destroy({ children: true });
    this.tactics = null;
    if (h) {
      const c = new Container();
      const next = await textButton(tr("Next stack"), 150, 52, h.next, "medfont");
      const end = await textButton(tr("Start battle"), 150, 52, h.end, "medfont");
      // (HELP.TXT 388 / 389, the bar's Next and End Tactics Phase.)
      holdTip(next, () => helpRow(388)?.help || tr("Next creature to place."));
      holdTip(end, () => helpRow(389)?.help || tr("Start the battle."));
      // A later call (the phase ended while the art loaded) wins.
      if (call !== this.tacticsCalls) return c.destroy({ children: true }), next.destroy({ children: true }), end.destroy({ children: true });
      end.y = 64;
      c.addChild(next, end);
      this.tactics = c;
      this.layer.addChild(c);
    }
    this.layout();
  }

  /** Places everything for the current screen (after a resize, or a window opening or closing). */
  layout() {
    this.placeAll();
    // One-handed sideways a window's buttons come again in the thumb's third (Modals' hand rail), over the pad and
    // the buttons there: those make way while it is up (everything else stays in view).
    if (this.layer.visible && this.modals.railed) {
      for (const { sprite, side } of this.buttons) if (side === 1) sprite.visible = false;
      if (this.pad) this.pad.visible = false;
      if (this.tactics) this.tactics.visible = false;
      if (this.menu) this.menu.visible = false;
      this.drawClip();
    } else if (this.pad) this.pad.visible = true;
  }

  private placeAll() {
    const room = screenSize.ox;
    this.layer.visible = screenSize.touch && (room >= 64 || screenSize.portrait);
    // Under a window (a message, the spellbook, options, results) everything stays where it is, as the original's
    // screen stays behind its windows (2026-10-27: the touchpad's tutorial talked about a pad it had hidden);
    // only the window takes taps.
    this.layer.interactiveChildren = !this.modals.open;
    if (!this.layer.visible) return this.drawClip();
    const phone = phoneSized();
    for (const t of this.buttons) t.sprite.visible = (!phone || t.side === 1) && !(phone && this.tactics && t.side === 1);
    if (!screenSize.portrait) this.top.visible = false;
    if (screenSize.portrait) return this.layoutUpright();
    if (this.compact) return this.layoutCompact();
    const left = this.leftW;
    const right = this.rightW;
    if (this.tactics) {
      this.tactics.visible = phone;
      // Where the right-hand group would go, unless the navigation bar leaves too little room there:
      // then at the foot of the left-hand column (who moves next makes way for the phase).
      const side = this.hand ?? ((right - this.navBar - 16) / 150 < 0.6 ? "left" : "right");
      const kt = Math.min(1.4, ((side === "right" ? right - this.navBar : left) - 16) / 150);
      this.tactics.scale.set(kt);
      this.tactics.position.set(Math.round(this.roomX(side) - 75 * kt), BAR_Y - Math.round(116 * kt));
    }
    // A finger's size where the room allows it (the bar's buttons are 48x36).
    const fingerK = this.finger / 36;
    if (this.menu) {
      this.menu.visible = phone;
      const km = Math.min(Math.max(1.5, fingerK), ((this.hand === "right" ? right - this.navBar : left) - 16) / 48);
      this.menu.scale.set(km);
      // One-handed: on the thumb's side, below the page's own buttons there.
      this.menu.position.set(Math.round(this.roomX(this.hand ?? "left") - 24 * km), this.hand ? 170 : Math.max(88, this.pageTop));
    }
    // The bar's buttons are 48x36: up to twice that (more if a finger needs it), to fit the room, and
    // the left-hand group below the page's own corner buttons (menu, full screen).
    const TOP = 120;
    const shown = (side: 0 | 1) => this.buttons.filter((t) => t.sprite.visible && t.side === side);
    const most = Math.max(shown(0).length, shown(1).length, 1);
    // The right-hand group also keeps out of the navigation bar.
    const k = Math.min(Math.max(2, fingerK), (left - 16) / 48, (right - this.navBar - 16) / 48, ((BAR_Y - TOP) / most - 18) / 36);
    const step = 36 * k + 18;
    // One-handed: the right-hand group in one row along the bottom of the thumb's side (the touchpad above it).
    const padHand = this.padHand;
    const row = padHand ? shown(1) : [];
    if (row.length) {
      // As few rows as keep them finger-sized: a narrow room (the navigation bar's side) stacks them.
      const avail = (padHand === "right" ? right - this.navBar : left) - 16;
      const fit = (cols: number) => Math.min(2, (avail - (cols - 1) * 8) / (cols * 48));
      let cols = row.length;
      while (cols > 1 && fit(cols) < 1.2 && Math.ceil(row.length / (cols - 1)) * (36 * fit(cols - 1) + 8) <= BAR_Y * 0.45) cols--;
      const kr = fit(cols);
      const rows = Math.ceil(row.length / cols);
      const rowW = cols * 48 * kr + (cols - 1) * 8;
      row.forEach(({ sprite }, i) => {
        sprite.scale.set(kr);
        const r = Math.floor(i / cols);
        sprite.position.set(Math.round(this.roomX(padHand!) - rowW / 2 + (i % cols) * (48 * kr + 8)), Math.round(BAR_Y - (rows - r) * (36 * kr + 8)));
      });
    }
    for (const side of [0, 1] as const) {
      if (side === 1 && row.length) continue;
      const group = shown(side);
      // Down the side, the right-hand group low (where the thumb rests).
      const top = side === 0 ? Math.max(TOP, (BAR_Y - group.length * step) / 2) : BAR_Y - group.length * step;
      group.forEach(({ sprite }, i) => {
        sprite.scale.set(k);
        // One-handed: the right-hand group on the thumb's side.
        const x = this.hand && side === 1 ? this.roomX(this.hand) : this.roomX(side === 0 ? "left" : "right");
        sprite.x = Math.round(x - 24 * k);
        sprite.y = Math.round(top + i * step);
      });
    }
    // Each takes a finger's tap where the room keeps it smaller (a little into the gaps).
    for (const { sprite } of this.buttons) {
      if (sprite instanceof DefButton || sprite.hitArea) continue;
      const r = sprite.getLocalBounds();
      sprite.hitArea = new FingerArea(sprite, r.width, r.height, r.x, r.y);
    }
    this.drawPad();
    this.drawHint();
  }

  /** Where the compact layout's grid of buttons begins (the foot of the left-hand column). */
  private gridTop = SCREEN_H;

  /**
   * Compact (a narrow sideways phone): the left-hand column holds it all, the message and who moves
   * next at the top, the buttons in two columns along its foot: Menu, then cast, wait and defend
   * (or the tactics phase's two buttons, over the Menu).
   */
  private layoutCompact() {
    const w = this.leftW;
    const x0 = -w;
    const items: Container[] = [];
    if (this.menu) {
      this.menu.visible = true;
      items.push(this.menu);
    }
    if (!this.tactics) items.push(...this.buttons.filter((t) => t.sprite.visible && t.side === 1).map((t) => t.sprite));
    const GAP = 8;
    const cols = items.length > 1 ? 2 : 1;
    const k = Math.min(2.4, (w - 16 - (cols - 1) * GAP) / cols / 48);
    const rows = Math.ceil(items.length / cols);
    const cellW = 48 * k;
    const cellH = 36 * k;
    const top = SCREEN_H - 8 - rows * cellH - (rows - 1) * GAP;
    const gridW = cols * cellW + (cols - 1) * GAP;
    items.forEach((c, i) => {
      c.scale.set(k);
      c.position.set(Math.round(x0 + (w - gridW) / 2 + (i % cols) * (cellW + GAP)), Math.round(top + Math.floor(i / cols) * (cellH + GAP)));
    });
    this.gridTop = top;
    if (this.tactics) {
      this.tactics.visible = true;
      const kt = Math.min(1.4, (w - 16) / 150);
      this.tactics.scale.set(kt);
      this.tactics.position.set(Math.round(x0 + (w - 150 * kt) / 2), Math.round(top - GAP - 116 * kt));
      this.gridTop = this.tactics.y;
    }
    this.drawHint();
  }

  /**
   * Upright (the owner's plan, 2026-10-24), from the top: the two heroes in the corners with who moves next
   * between them, the field, the touchpad, one row of buttons (Menu, cast, the alternate action, wait,
   * defend, Feedback) and under it what to read: the battle's last blows (their portraits tapped pick
   * that stack) or the stack picked. The page's own buttons are in that row and the Menu (style.css
   * ownButtons), so nothing lies over the layout.
   */
  private layoutUpright() {
    // The left-hand group (options, surrender, retreat, auto, quick) is in the Menu here.
    for (const t of this.buttons) if (t.side === 0) t.sprite.visible = false;
    const items: Container[] = [];
    if (this.menu) items.push(this.menu);
    if (this.tactics) {
      this.tactics.visible = true;
      // Side by side here, not one over the other.
      const [next, end] = this.tactics.children;
      if (end) end.position.set((next?.width ?? 150) + 12, 0);
      items.push(this.tactics);
    } else items.push(...this.buttons.filter((t) => t.sprite.visible && t.side === 1).map((t) => t.sprite));
    if (this.menu) this.menu.visible = true;
    for (const c of items) c.scale.set(1);
    // Spaced by what shows: a text button's art can sit in a wider tap box (kit.ts textButton).
    const face = (c: Container) => {
      const [hit, art] = c.children;
      return c.label?.startsWith("button: ") && hit instanceof Graphics && art && c.children.length === 2 ? { x: art.x, w: art.width } : { x: 0, w: c.width };
    };
    const natural = items.reduce((w, c) => w + face(c).w, 0) + (items.length - 1) * 12;
    const tallest = Math.max(1, ...items.map((c) => c.height));
    const k = Math.min(Math.max(2, this.finger / tallest), (SCREEN_W - 16) / Math.max(1, natural));
    const rowH = tallest * k;
    // Down to the page's foot (the page stops above a real inset itself); this layer starts at the field's top.
    let foot = screenSize.h - uprightFieldTop() - Math.ceil(6 / screenSize.css);
    // The page's Menu and Feedback (the same buttons as on every screen) sit at the foot here (style.css ownButtons):
    // everything ends above them.
    // (In canvas pixels turned with the page: on a page turned by ☰ → Rotate the screen's top is the page's side, and
    // reading it as the top put the buttons, the pad and the message above the field, out of sight.)
    const fb = canvasBox(document.getElementById("fbToggle"));
    if (fb) foot = Math.min(foot, Math.floor(fb.y) - uprightFieldTop() - 8);
    const fieldBottom = Math.round(BAR_Y * this.fieldK);
    // From the foot up (2026-10-27: the buttons at the bottom are good; the magnifier above the pad, below the
    // field): the buttons, the touchpad over them (the thumb's sweep), and between the pad and the field the reading
    // room: the last blows or the stack picked, where the magnifier comes up while aiming, right under what it shows.
    const rowY = Math.round(foot - rowH);
    const room = rowY - fieldBottom - 3 * 12;
    // The pad a thumb's sweep; the reading room keeps at least the magnifier's size.
    const padH = Math.round(Math.max(110, Math.min(190, room - Math.max(190, room * 0.45))));
    const padY = rowY - 12 - padH;
    let x = Math.round((SCREEN_W - natural * k) / 2);
    for (const c of items) {
      const f = face(c);
      c.scale.set(k);
      c.position.set(x - f.x * k, rowY);
      x += (f.w + 12) * k;
    }
    this.gridTop = rowY;
    this.readTop = fieldBottom + 10;
    this.readBottom = padY - 10;
    this.drawPad({ x: 12, y: padY, w: SCREEN_W - 24, h: padH });
    this.drawTop();
    this.drawHint();
  }

  /** Upright: where the reading room under the buttons starts and ends (this layer's pixels). */
  private readTop = 0;
  private readBottom = 0;
  /** Upright: the two heroes (a tap: their details) and who moves next between them. */
  private top = new Container();
  private heroFaces: ({ tex: Texture; onTap: () => void } | null)[] = [null, null];
  private queueRows: QueueRow[] = [];
  /** A stack's portrait tapped (the queue, the log): look at it, or aim at it (view.ts). */
  onStackTap: (unit: number) => void = () => {};
  /** Upright: the stack picked from a portrait (its card in the reading room, and what a second tap does). */
  private picked: { unit: number; card: TurnCard; note: Text } | null = null;
  /** Upright: the last blows, newest first. */
  /** The battle's lines as they were shown, newest first (the phone's log in words: the owner 2026-11-02 20:13, not pictures). */
  private log: Text[] = [];
  /** A tap on the log's lines: the whole battle's log (EXTRAS battleLog), or null. */
  onOpenLog: (() => void) | null = null;

  /** The commanding heroes' portraits (null: no hero on that side). */
  setHeroes(faces: ({ tex: Texture; onTap: () => void } | null)[]) {
    this.heroFaces = faces;
    if (screenSize.portrait) this.drawTop();
  }


  /** The two sides' flag colours (the queue's cells, the log's portraits upright). */
  sideFlags: [number, number] = [PLAYER_RGB[0], PLAYER_RGB[1]];
  /**
   * Where the magnifier can pop out beside the field (this layer's pixels): upright the reading room, sideways the
   * column away from the thumb (below Menu); null where there's none.
   */
  /** Whether the magnifier is up (the reading room keeps its square clear). */
  private loupeUp = false;
  setLoupeUp(on: boolean) {
    if (on === this.loupeUp) return;
    this.loupeUp = on;
    if (screenSize.portrait) this.drawHint();
  }

  loupeRoom(): { x: number; y: number; w: number; h: number } | null {
    if (!this.layer.visible) return null;
    // Upright: a square at the reading room's right, the turn's line and the blows' predictions wrapping beside it
    // (2026-10-27: the magnifier in the middle covered the predicted damage and kills).
    if (screenSize.portrait) {
      const h = this.readBottom - this.readTop;
      return h > 80 ? { x: SCREEN_W - h, y: this.readTop, w: h, h } : null;
    }
    if (!phoneSized()) return null;
    const right = this.hand === "left";
    // (Compact: Menu is in the grid of buttons at the column's foot; the magnifier goes over the message above it.)
    const top = Math.max(this.pageTop, this.menu?.visible && !right && !this.compact ? this.menu.y + this.menu.height + 8 : 0);
    const bottom = this.compact ? this.gridTop - 8 : SCREEN_H;
    return right ? { x: this.fieldW, y: top, w: this.rightW - this.navBar, h: bottom - top } : { x: -this.leftW, y: top, w: this.leftW, h: bottom - top };
  }

  /** CBAR's console (the player's colour), the box of the rooms round the field; null: plain black. */
  private console: Texture | null = null;
  /** The windows' leather (DIBOXBCK), inside the tall rooms. */
  private ground: Texture | null = null;
  /** The result window's portrait box (CPRESULT's), the heroes' corners upright. */
  private portraitBox: Texture | null = null;
  setConsole(parts: { console: Texture | null; ground: Texture | null; portraitBox: Texture | null }) {
    this.console = parts.console;
    this.ground = parts.ground;
    this.portraitBox = parts.portraitBox;
    this.drawHint();
    if (screenSize.portrait) this.drawTop();
  }

  /** A room's ground, `w` x `h`: the console's box (black without the picture). */
  private backing(w: number, h: number): Container {
    // (Without the pictures, the stand-in art: plain brown, as the leather.)
    return this.console ? consoleBox(this.console, w, h, this.ground) : new Graphics().rect(0, 0, w, h).fill(0x3a2814);
  }

  /** Upright: a stack's card in the reading room with a line on what a second tap does; null puts the log back. */
  showPicked(p: { unit: number; card: TurnCard; note: Text } | null) {
    this.picked = p;
    this.drawHint();
    if (screenSize.portrait) this.drawTop();
  }

  /** Upright: the top band's draws (its rim comes in later, only onto the draw it was for). */
  private topDraws = 0;

  /**
   * Upright: the band over the field as one of the original's windows (2026-10-27: "use borders and ornaments"):
   * the windows' leather in their rim (the double gold line, the player's colour, the knots), each commanding hero's
   * portrait in the result window's portrait box at its end, a gold line between it and who moves next. A side with
   * no hero (monsters, a town's guards) has no box: the queue takes its room.
   */
  private drawTop() {
    const t = this.top;
    t.removeChildren().forEach((c) => c.destroy({ children: true }));
    const gen = ++this.topDraws;
    if (!screenSize.portrait || !this.layer.visible) {
      t.visible = false;
      return;
    }
    t.visible = true;
    if (!t.parent) this.layer.addChild(t);
    t.position.set(0, -UPRIGHT_TOP + 6);
    // (In t: the band from -6 to UPRIGHT_TOP - 6.)
    const y0 = -6;
    // (Under a camera's band the ground goes on up to the screen's top: the band's own pieces start under it.)
    const cut = cutoutTop();
    t.addChild(this.ground ? Object.assign(new TilingSprite({ texture: this.ground, width: SCREEN_W, height: UPRIGHT_TOP + cut }), { y: y0 - cut }) : new Graphics().rect(0, y0 - cut, SCREEN_W, UPRIGHT_TOP + cut).fill(0x3a2814));
    void phoneFrame(SCREEN_W, UPRIGHT_TOP, this.player).then((rim) => {
      if (gen !== this.topDraws || t.destroyed) return rim.destroy({ children: true });
      rim.y = y0;
      t.addChildAt(rim, 1);
    });
    // Inside the rim, a few pixels clear of it.
    const inX = RIM + 6;
    const inY = y0 + RIM + 4;
    const H = UPRIGHT_TOP - 2 * RIM - 8;
    const box = CPRESULT.parts.portrait;
    const kb = this.portraitBox ? H / box.h : 0;
    const faceW = this.portraitBox ? Math.round(58 * kb) : Math.round((H * 58) / 64);
    const faceH = this.portraitBox ? Math.round(64 * kb) : H;
    const outer = this.portraitBox ? Math.round(box.w * kb) : faceW + 4;
    let x0 = inX;
    let x1 = SCREEN_W - inX;
    for (const side of [0, 1] as const) {
      const f = this.heroFaces[side];
      if (!f) continue;
      const bx = side === 0 ? inX : SCREEN_W - inX - outer;
      const x = this.portraitBox ? bx + Math.round(6 * kb) : bx + 2;
      const y = inY + (this.portraitBox ? Math.round(6 * kb) : 0);
      if (this.portraitBox) t.addChild(Object.assign(new Sprite(this.portraitBox), { x: bx, y: inY, width: outer, height: H, label: "part: portrait" }));
      else t.addChild(new Graphics().rect(x - 2, inY - 2, faceW + 4, H + 4).fill(this.sideFlags[side]));
      const pic = Object.assign(new Sprite(f.tex), { x, y, width: faceW, height: faceH });
      pic.eventMode = "static";
      pic.cursor = "pointer";
      pic.label = `button: ${side === 0 ? "left" : "right"} hero`;
      pic.on("pointertap", f.onTap);
      // Held, the same (a hold is "rightdown", touch.ts; The owner's note 2026-10-30: in the tactics phase it did nothing).
      pic.on("rightdown", f.onTap);
      t.addChild(pic);
      // The thin gold line between the portrait and the queue (the windows' trim between parts).
      const lx = side === 0 ? bx + outer + 8 : bx - 10;
      t.addChild(new Graphics().rect(lx, inY + 2, 2, H - 4).fill(GOLD_TRIM));
      if (side === 0) x0 = lx + 10;
      else x1 = lx - 8;
    }
    // Who moves next, left to right, as many as fit between the heroes: small cells (the owner: smaller, more of them),
    // the first (whose turn it is) a size up in a gold frame.
    const cell = 50;
    const big = Math.min(76, H);
    const gap = 3;
    const room = x1 - x0;
    const n = Math.max(0, 1 + Math.floor((room - big - gap) / (cell + gap)));
    const shownRows = this.queueRows.slice(0, n);
    const used = shownRows.length ? big + (shownRows.length - 1) * (cell + gap) + (shownRows.length > 1 ? gap : 0) : 0;
    let x = x0 + Math.round((room - used) / 2);
    const H0 = inY;
    shownRows.forEach((r, i) => {
      const current = i === 0 && !r.nextRound && extra("battleCues");
      const size = current ? big : cell;
      const c = new Container();
      c.position.set(x, H0 + Math.round((H - size) / 2));
      x += size + gap + (current ? gap : 0);
      // The queue's own cell (queueCell.ts), as on every layout: the stack to move gold-framed, the one picked white.
      c.addChild(queueCell({ portrait: r.portrait, count: r.count, flag: r.flag, size, current, picked: this.picked?.unit === r.unit, nextRound: r.nextRound }));
      c.eventMode = "static";
      c.cursor = "pointer";
      c.label = `button: ${r.count} ${r.count === 1 ? r.creature.name : r.creature.plural}`;
      c.on("pointertap", () => this.onStackTap(r.unit));
      t.addChild(c);
    });
    this.drawClip();
  }

  /**
   * The touchpad: one-handed between the Menu button and the buttons on the thumb's side; upright
   * (`at`) the width of the screen under the field.
   */
  private drawPad(at: { x: number; y: number; w: number; h: number } | null = null) {
    this.pad?.destroy({ children: true });
    this.pad = null;
    const hand = this.padHand;
    if ((!hand && !at) || !this.padHandlers) return;
    let x0: number;
    let w: number;
    let top: number;
    let bottom: number;
    if (at) ({ x: x0, y: top, w } = at), (bottom = at.y + at.h);
    else {
      const room = hand === "right" ? this.rightW : this.leftW;
      w = room - 24 - (hand === "right" ? this.navBar : 0);
      top = (this.menu ? this.menu.y + this.menu.height : 120) + 14;
      const buttons = this.buttons.filter((b) => b.sprite.visible && b.side === 1).map((b) => b.sprite.y);
      // The tactics buttons on the thumb's side too: the pad ends above them.
      if (this.tactics?.visible && this.tactics.x > 0 === (hand === "right")) buttons.push(this.tactics.y);
      bottom = (buttons.length ? Math.min(...buttons) : BAR_Y) - 14;
      x0 = Math.round(this.roomX(hand!) - w / 2);
    }
    if (bottom - top < 80) return;
    this.padSize = { w, h: bottom - top };
    const pad = new Container();
    pad.label = "panel: battle touchpad";
    pad.position.set(x0, top);
    // The original's brown button face, as big as the room (drawn once its art is in).
    void blankButton(w, bottom - top).then((face) => {
      if (pad.destroyed) return face.destroy({ children: true });
      pad.addChildAt(face, 0);
      // (The clip opened the pad's room as big as its label was: the whole face now; tactics showed a strip.)
      this.drawClip();
    });
    // What it does in two lines (the owner: clearer words): where to put the thumb, then what letting go does.
    const hk = screenSize.portrait ? 1.75 : 1.25;
    const help = new Container();
    const l1 = label(tr("Slide here to aim"), "medfont", YELLOW, "center", Math.floor(w / hk));
    const l2 = label(extra("battleLoupe") ? tr("let go to act") : tr("tap to act"), "medfont", WHITE, "center", Math.floor(w / hk));
    l1.scale.set(hk);
    l2.scale.set(hk);
    help.addChild(l1, l2);
    placeByText(() => {
      if (help.destroyed) return;
      l2.y = l1.height + 2;
      help.position.set(0, Math.round((bottom - top) / 2 - help.height / 2));
    });
    pad.addChild(help);
    pad.eventMode = "static";
    let last: { x: number; y: number } | null = null;
    let travel = 0;
    pad.on("pointerdown", (e) => {
      this.tips.used();
      last = { x: e.global.x, y: e.global.y };
      travel = 0;
      this.padHandlers?.start();
    });
    pad.on("globalpointermove", (e) => {
      if (!last) return;
      // Screen pixels to the field's: the layer's own scale.
      const k = this.layer.worldTransform.a || 1;
      const dx = (e.global.x - last.x) / k;
      const dy = (e.global.y - last.y) / k;
      last = { x: e.global.x, y: e.global.y };
      travel += Math.abs(dx) + Math.abs(dy);
      this.padHandlers?.drag(dx, dy, { x: e.global.x, y: e.global.y });
    });
    const up = () => {
      if (!last) return;
      last = null;
      if (travel > 6) this.padHandlers?.release(true);
      else this.padHandlers?.tap();
    };
    pad.on("pointerup", up);
    pad.on("pointerupoutside", up);
    this.layer.addChild(pad);
    this.pad = pad;
    if (extra("padTips")) {
      this.tips.tutorialOnce();
      // Until the pad has been used on this device, the finger glides over it at each battle's start.
      if (!stored("heroes.padUsed")) this.tips.showGhost(10000);
    }
  }

  /** The player watching (the tutorial's window in their colour). */
  player = 0;
  /** A picture of the field as it stands (view.ts), for the tutorial's moving demo; null: none. */
  fieldShot: () => Texture | null = () => null;
  /** The pad's tutorial and its finger hints (battle/touchPad.ts). */
  private readonly tips = new PadTips({
    pad: () => this.pad,
    padSize: () => this.padSize,
    layer: () => this.layer,
    modals: () => this.modals,
    player: () => this.player,
    fieldShot: () => this.fieldShot(),
    hand: () => this.hand,
    navBar: () => this.navBar,
    gridTop: () => this.gridTop,
  });

  /** The field was tapped (not the pad): the second time in a row, the finger glides over the pad again for a while. */
  fieldTapped() {
    if (this.pad) this.tips.fieldTapped();
  }

  /** The message line (and the turn's stack under it). */
  setHint(text: Text, card: TurnCard | null, blow: Blow | null = null, logged = false) {
    // The log: each line of the battle's own (not the turn's prompt, nor what's pointed at); a line that adds to the one
    // before (a blow's splash victims) takes its place.
    if ((logged || blow) && String(text).trim()) {
      if (this.log[0] && String(text).startsWith(String(this.log[0]))) this.log[0] = text;
      else this.log.unshift(text);
    }
    this.log.length = Math.min(this.log.length, 30);
    this.hint = text;
    this.card = card;
    this.drawHint();
  }



  private hintAt(): [number, number] {
    // Upright: right under the field.
    if (screenSize.portrait) return [0, Math.round(BAR_Y * this.fieldK) + 12];
    const band = this.topBand;
    if (band) return [band.x, 4];
    // One-handed: the message on the far side (read, not pressed).
    if (this.hand) return [this.hand === "left" ? this.fieldW : -this.leftW, HINT_Y];
    if (this.compact) return [-this.leftW, this.pageTop];
    return phoneSized() && this.menu ? [-this.leftW, this.menu.y + this.menu.height + 12] : [this.fieldW, HINT_Y];
  }

  /**
   * One-handed on a phone too narrow for the message on the far side: it goes over the field's top
   * (the sky above the hexes, between the heroes and clear of the page's buttons), without the card.
   */
  private get topBand(): { x: number; w: number } | null {
    const hand = this.hand;
    if (!hand) return null;
    const far = hand === "left" ? this.rightW - this.navBar : this.leftW;
    if (far >= FAR_ROOM) return null;
    const p = pageButtons();
    const fx = this.fieldX();
    let x0 = 110;
    let x1 = 690;
    if (p && p.bottom > 0) {
      x0 = Math.max(x0, p.left - fx + 8);
      x1 = Math.min(x1, p.right - fx - 8);
    }
    return x1 - x0 >= 200 ? { x: Math.round(x0), w: Math.round(x1 - x0) } : null;
  }

  setAuto(on: boolean) {
    if (on === this.autoOn) return;
    this.autoOn = on;
    this.drawHint();
  }

  private drawHint() {
    // The kept pictures come out of the old box before it goes; the ones this draw doesn't use go after it.
    for (const c of this.kept.values()) if (!c.destroyed) c.parent?.removeChild(c);
    this.hintBox?.destroy({ children: true });
    this.hintBox = null;
    this.keptNow.clear();
    this.usedNow.clear();
    try {
      if (screenSize.portrait) this.drawReading();
      else this.drawSideHint();
    } finally {
      for (const [k, c] of this.kept) {
        if (this.usedNow.has(k)) continue;
        this.kept.delete(k);
        if (!c.destroyed) c.destroy({ children: true });
      }
    }
  }

  private drawSideHint() {
    const band = this.topBand;
    const room = band?.w ?? this.panelW;
    if (!this.layer.visible || !this.hint || room < 120) return this.placeQueue();
    // The buttons' size on phones too (2026-10-27: "there's room"; 1.3 read small held sideways).
    // (Upright the screen is 800 across: a third bigger, to read as it does turned.)
    // (One-handed the far column is narrow: a little smaller there, so a line holds a few words.)
    const k = screenSize.portrait ? 1.75 : phoneSized() && this.hand ? 1.3 : 1.5;
    const width = Math.floor((room - 16) / k);
    const t = this.keptLabel(this.hint, WHITE, width);
    t.scale.set(k);
    t.position.set(8, 10);
    const box = new Container();
    let h = t.height + 18;
    // The lines before it, dimmer (EXTRAS battleLog: words, more than one; a tap opens the whole log).
    if (phoneSized() && this.onOpenLog) {
      const shown = String(this.hint);
      for (const l of this.log.filter((x) => !shown.includes(String(x).split("\n")[0])).slice(0, 2)) {
        const o = this.keptLabel(l, OLDER, width);
        o.scale.set(k);
        o.position.set(8, h - 6);
        box.addChild(o);
        h += o.height + 2;
      }
      const open = this.onOpenLog;
      const tap = new Graphics().rect(0, 0, room, h).fill({ color: 0, alpha: 0.001 });
      tap.label = "button: Battle log";
      tap.eventMode = "static";
      tap.on("pointertap", () => open());
      box.addChild(tap);
    }
    if (this.autoOn) {
      const a = this.keptLabel(tr("Auto combat: tap the field to stop."), YELLOW, width);
      a.scale.set(k);
      a.position.set(8, h - 4);
      box.addChild(a);
      h = a.y + a.height + 10;
    }
    // Whose turn it is, readable: the portrait with the count and name beside it, the stack's
    // numbers in this battle under them across the whole width.
    // (Under auto combat the AI moves them: no card, room for the line on how to take over.)
    const c = band || this.autoOn ? null : this.card;
    if (c) {
      const card = new Container();
      card.position.set(8, h);
      const head = label(fmt`${c.count} ${c.count === 1 ? said(c.creature.name) : said(c.creature.plural)}`, "medfont", YELLOW, "left", Math.floor((room - 72) / k));
      head.scale.set(k);
      head.position.set(54, Math.max(0, Math.round((48 - head.height) / 2)));
      const nums = label(said(c.numbers.replace("\n", "   ")), "medfont", WHITE, "left", width);
      nums.scale.set(k);
      nums.position.set(0, Math.max(50, head.height + 4));
      card.addChild(head, nums);
      void creaturePortrait(c.creature, "small").then((tex) => tex && !card.destroyed && card.addChild(Object.assign(new Sprite(tex), { width: 48, height: 48 })));
      h += nums.y + nums.height + 10;
      box.addChild(card);
    }
    box.addChildAt(this.keep(`backing ${room}x${Math.round(h)}`, () => this.backing(room, h)), 0);
    box.addChild(t);
    box.position.set(...this.hintAt());
    this.layer.addChild(box);
    this.hintBox = box;
    this.placeQueue();
  }

  /**
   * Upright: the reading room between the field and the touchpad: the turn's line, then the stack picked from a
   * portrait (its card and what a second tap does) or the last blows, newest first.
   */
  private drawReading() {
    if (!this.layer.visible || this.readBottom - this.readTop < 60) return this.placeQueue();
    // While the magnifier is up its square on the right is kept clear (loupeRoom).
    const W = SCREEN_W - (this.loupeUp ? this.readBottom - this.readTop : 0);
    const k = 1.5;
    const box = new Container();
    box.position.set(0, this.readTop);
    const h = this.readBottom - this.readTop;
    box.addChild(this.keep(`backing ${SCREEN_W}x${h}`, () => this.backing(SCREEN_W, h)));
    let y = 6;
    const line = (t: Text, color: readonly [number, number, number]) => {
      const l = this.keptLabel(t, color, Math.floor((W - 24) / k));
      l.scale.set(k);
      l.position.set(12, y);
      box.addChild(l);
      y += l.height + 6;
    };
    const p = this.picked;
    if (p) {
      const c = p.card;
      const head = label(fmt`${c.count} ${c.count === 1 ? said(c.creature.name) : said(c.creature.plural)}`, "medfont", YELLOW, "left", Math.floor((W - 100) / k));
      head.scale.set(1.75);
      head.position.set(84, y + Math.max(0, Math.round((64 - head.height) / 2)));
      const pic = new Container();
      pic.position.set(12, y);
      void creaturePortrait(c.creature, "small").then((tex) => tex && !pic.destroyed && pic.addChild(Object.assign(new Sprite(tex), { width: 64, height: 64 })));
      box.addChild(pic, head);
      y += 72;
      line(said(c.numbers.replace("\n", "   ")), WHITE);
      if (p.note) line(p.note, YELLOW);
    } else {
      if (this.hint && !this.log.length) line(this.hint, WHITE);
      else if (this.hint) line(said(this.hint.split("\n")[0]), WHITE);
      if (this.autoOn) line(tr("Auto combat: tap the field to stop."), YELLOW);
      // The blows at the foot, near the thumb, the newest lowest (the owner); older ones above as they fit.
      let bottom = h - 6;
      // (Up to the first that doesn't fit: the lines above it are older still.)
      for (const [i, e] of this.log.entries()) {
        const r = this.keptLabel(e, i ? OLDER : WHITE, Math.floor((W - 24) / k));
        r.scale.set(k);
        if (bottom - r.height < y) break;
        bottom -= r.height;
        r.position.set(12, bottom);
        bottom -= 8;
        box.addChild(r);
      }
      // A tap on the lines: the whole battle's log (EXTRAS battleLog).
      const open = this.onOpenLog;
      if (open) {
        const tap = new Graphics().rect(0, 0, W, h).fill({ color: 0, alpha: 0.001 });
        tap.label = "button: Battle log";
        tap.eventMode = "static";
        tap.on("pointertap", () => open());
        box.addChild(tap);
      }
    }
    this.layer.addChild(box);
    this.hintBox = box;
    this.placeQueue();
  }

  /** Phones: who moves next, readable (side colour, portrait, count and name), under the turn card. */
  setQueue(rows: QueueRow[]) {
    const q = this.queue;
    if (q.destroyed) return;
    q.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.onQueuePoint(null);
    this.queueRows = rows;
    // Upright: in the band over the field, between the heroes.
    if (screenSize.portrait) return this.drawTop(), this.placeQueue();
    const room = this.panelW;
    // Too narrow a column (one-handed on a small phone) shows no list rather than squeezed names.
    if (!phoneSized() || room < (this.hand ? FAR_ROOM : 120)) return this.placeQueue();
    const k = screenSize.portrait ? 2 : 1.5;
    const rowH = screenSize.portrait ? 56 : 40;
    // A box behind the rows (placeQueue sizes it): the clip opens this part of the side room, where stacks
    // standing at the field's edge would otherwise show through.
    q.addChild(new Container());
    rows.forEach((r, i) => {
      const row = new Container();
      row.y = i * (rowH + 6);
      row.alpha = r.nextRound ? 0.6 : 1;
      row.eventMode = "static";
      const point = (on: boolean) => () => this.onQueuePoint(on ? r.unit : null);
      row.on("pointerdown", point(true)).on("pointerover", point(true));
      row.on("pointerup", point(false)).on("pointerupoutside", point(false)).on("pointerout", point(false));
      row.addChild(queueCell({ portrait: r.portrait, flag: r.flag, size: rowH }));
      const t = label(fmt`${r.count} ${r.count === 1 ? said(r.creature.name) : said(r.creature.plural)}`, "medfont", WHITE);
      t.scale.set(k);
      if (t.width > room - 64) t.scale.x = (room - 64) / t.texture.width;
      t.position.set(rowH + 8, Math.round((rowH - t.height) / 2));
      row.addChild(t);
      q.addChild(row);
    });
    this.placeQueue();
  }

  /** Under the turn card, as many rows as fit above the bottom. */
  private placeQueue() {
    const q = this.queue;
    if (q.destroyed) return this.drawClip();
    if (screenSize.portrait) return (q.visible = false), this.drawClip();
    const [, y] = this.hintAt();
    q.position.set((screenSize.portrait ? 0 : this.hand === "left" ? this.fieldW : -this.leftW) + 8, y + (this.hintBox?.height ?? 0) + 12);
    const [backing, ...rows] = q.children;
    let bottom = 0;
    // Down to the screen's foot (upright: far below the field).
    // Upright and compact: down to the buttons along the foot.
    const tacticsLeft = !screenSize.portrait && this.tactics?.visible && this.tactics.x < 0;
    const foot = (screenSize.portrait || this.compact ? this.gridTop : tacticsLeft ? this.tactics!.y : SCREEN_H) - 8;
    for (const row of rows) {
      row.visible = q.y + row.y + row.height <= foot;
      if (row.visible) bottom = row.y + row.height;
    }
    if (backing) {
      backing.removeChildren().forEach((c) => c.destroy({ children: true }));
      if (bottom > 0) backing.addChild(Object.assign(this.backing(this.panelW, bottom + 12), { x: -8, y: -6 }));
    }
    q.visible = this.layer.visible && phoneSized() && bottom > 0;
    this.drawClip();
  }

  /** The field, and over the sides only what this layout shows there. */
  private drawClip() {
    // Phones have no bar under the field (view.ts): what stood behind it stays hidden.
    this.clip.clear().rect(0, 0, SCREEN_W, phoneSized() && this.layer.visible ? BAR_Y : SCREEN_H).fill(0xffffff);
    if (!this.layer.visible) return;
    // The clip is in the battle's coordinates, this layer's pieces in its own (upright: screen pixels).
    const L = this.layer;
    const rect = (x: number, y: number, w: number, h: number) => this.clip.rect(L.x + x * L.scale.x, L.y + y * L.scale.y, w * L.scale.x, h * L.scale.y).fill(0xffffff);
    const open = (c: Container | null) => c?.visible && !c.destroyed && rect(c.x, c.y, c.width, c.height);
    for (const { sprite } of this.buttons) open(sprite);
    open(this.menu);
    open(this.tactics);
    open(this.pad);
    if (this.queue.visible && !this.queue.destroyed) rect(this.queue.x - 8, this.queue.y - 6, this.panelW, this.queue.height);
    if (screenSize.portrait) {
      if (this.top.visible && !this.top.destroyed) rect(0, -uprightFieldTop(), SCREEN_W, uprightFieldTop());
      if (this.hintBox) rect(0, this.readTop, SCREEN_W, this.readBottom - this.readTop);
      return;
    }
    if (this.hintBox) rect(...this.hintAt(), this.hintBox.width, this.hintBox.height);
  }
}

/** The log's older lines: dimmer than the newest. */
const OLDER = [205, 190, 160] as const;

/** A row of the original's buttons in a window, each named under it; resolves with the one pressed (-1: Cancel). */
/** A choice of the phone's battle Menu: the original button's DEF, or ours (`def` ""; Undo's arrow); `live`: greyed when false; `shown`: left out when false. */
export type MenuItem = { name: Text; def: string; fn: () => void; live?: () => boolean; shown?: () => boolean; picture?: () => Promise<Container> };

/** The battle Menu's picture: the brown button with nine gold tiles (the game has none: "more buttons behind this"). */
export async function menuPicture(): Promise<Container> {
  const c = new Container();
  c.addChild(await blankButton(48, 36));
  const g = new Graphics();
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) g.rect(13 + k * 8, 7 + r * 8, 6, 6);
  c.addChild(g.fill(0xe8c860));
  return c;
}

/** Undo's picture (EXTRAS battleUndo): the brown button with a gold arrow bending back (the game has no picture for it). */
export async function undoPicture(): Promise<Container> {
  const c = new Container();
  c.addChild(await blankButton(48, 36));
  c.addChild(new Graphics().arc(26, 18, 9, -Math.PI, Math.PI * 0.3).stroke({ color: 0xe8c860, width: 3 }).poly([12, 17, 22, 17, 17, 26]).fill(0xe8c860));
  return c;
}

async function iconChoice(modals: Modals, items: MenuItem[]): Promise<number> {
  // Upright: three to a row, as big as the width allows (2026-10-27: "this can be bigger"); sideways one row at
  // the bar's buttons x1.5. The names at a size a phone reads (they were dashes upright: 2026-11-02).
  const cols = screenSize.portrait ? Math.min(3, items.length) : items.length;
  const K = screenSize.portrait ? 2.8 : 1.5;
  const T = screenSize.portrait ? 1.9 : 1.25;
  const cell = Math.round(48 * K + (screenSize.portrait ? 24 : 36));
  const rowH = Math.round(36 * K + 8 + 2 * 16 * T + 12);
  const rows = Math.ceil(items.length / cols);
  const width = cols * cell + 40;
  const height = 34 + rows * rowH + 70;
  const win = await windowFrame(width, height, 0);
  return new Promise((resolve) => {
    let close = () => {};
    const done = (v: number) => (close(), resolve(v));
    const name = (n: Text, cx: number, y: number) => {
      // (A word longer than the cell, "automatyczna": the name smaller, so the word fits whole rather than cut.)
      const widest = Math.max(...String(n).split(/\s+/).map((w) => {
        const m = label(said(w), "medfont");
        const v = m.width;
        m.destroy();
        return v;
      }));
      const k = Math.min(T, (cell - 4) / Math.max(1, widest));
      const t = label(n, "medfont", WHITE, "center", Math.floor((cell - 4) / k));
      t.scale.set(k);
      t.position.set(cx - t.width / 2, y);
      return t;
    };
    items.forEach(({ name: n, def, live, picture }, i) => {
      const cx = 20 + (i % cols) * cell + cell / 2;
      const x = Math.round(cx - 24 * K);
      const y = 34 + Math.floor(i / cols) * rowH;
      const on = !live || live();
      const t = name(n, cx, y + 36 * K + 8);
      // The whole cell (picture and name) takes the tap.
      const hit = new Graphics().rect(cx - cell / 2, y - 4, cell, rowH).fill({ color: 0, alpha: 0.001 });
      hit.label = `button: ${n}`;
      hit.eventMode = "static";
      if (!def) {
        // Ours (Undo): its own picture, greyed with nothing to take back.
        void (picture ?? undoPicture)().then((p) => {
          p.position.set(x, y);
          p.scale.set(K);
          p.alpha = on ? 1 : 0.45;
          if (!win.destroyed) win.addChild(p);
        });
        t.alpha = on ? 1 : 0.45;
        hit.on("pointertap", () => on && done(i));
        win.addChild(hit, t);
        return;
      }
      const b = new DefButton(def, x, y);
      b.scale.set(K);
      b.hint = n;
      b.onClick = () => done(i);
      hit.on("pointertap", () => done(i));
      win.addChild(hit, b, t);
    });
    const cancel = new DefButton("icancel.def", Math.round(width / 2 - 33), height - 58);
    cancel.onClick = () => done(-1);
    win.addChild(cancel);
    close = modals.show(win, { onKey: (k) => (k === "Escape" ? (done(-1), true) : true) });
  });
}
