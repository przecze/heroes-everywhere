// The resource bar (AResBar), one block for every screen and layout: the original's strip in the player's colour,
// each resource in its own bevelled cell (the picture is baked into the art) with its amount, then the date. The
// desktop draws all seven and the date as the original does; a phone shows only some cells (docked: gold and the
// resource that matters now), cut out of the same strip, so the look is the same everywhere.
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { GameText, type FontName, WHITE, YELLOW } from "../../text.ts";
import { loadImagePlayer } from "../kit.ts";
import { cut as cutPart } from "./windowParts.ts";
import { block } from "./block.ts";
import { said, fmt, type Text } from "../../i18n/index.ts";

/** Resources in the game's order (wood, mercury, ore, sulfur, crystal, gems, gold): the bar's cells left to right. */
export const ALL_RESOURCES = [0, 1, 2, 3, 4, 5, 6] as const;
export const GOLD = 6;

// AResBar's geometry (794 x 22): cells 84 wide from x 0 (a 4-pixel gap, then the bevel), gold's wider (to 596), the date's after it.
const CELL_W = 84;
const GOLD_END = 596;
const DATE_X = 596;
const BAR_W = 794;
const BAR_H = 22;
/** The closing gap after the last cell, and the date cell's right edge (bevel and gap). */
const GAP = 4;
const DATE_END = 7;
/** The seven day pips' width, and the date cell that holds them. */
const DAY_PIPS_W = 7 * 7 - 2;
export const DAY_CELL_W = DAY_PIPS_W + 20;
const cellX = (r: number) => r * CELL_W;
/** A narrow cell: the original cell's left end with the picture, then its bevel's right end. */
const NARROW_PIC = 30;
const NARROW_END = 6;
const cellW = (r: number) => (r === GOLD ? GOLD_END - cellX(GOLD) : CELL_W);

/**
 * An amount in at most five characters: 99999, then 100k... 999k, then 1.2M (the owner: room for five digits; past a
 * million nobody counts the change).
 */
export function shortAmount(n: number): string {
  if (n < 100000) return String(n);
  if (n < 1000000) return `${Math.floor(n / 1000)}k`;
  return `${(Math.floor(n / 100000) / 10).toFixed(n < 10000000 ? 1 : 0).replace(/\.0$/, "")}M`;
}

/**
 * The docked bar's amounts (2026-10-26): a resource in three characters (999, then 1.0k...9.9k, then 10k...99k),
 * gold in four (9999, then 10.0k...99.9k, then 100k); the point takes next to no room.
 */
export function compactAmount(n: number, gold: boolean): Text {
  const k = (v: number) => `${(Math.floor(v / 100) / 10).toFixed(1)}k`;
  if (n < (gold ? 10000 : 1000)) return said(String(n));
  if (n < (gold ? 100000 : 10000)) return said(k(n));
  if (n < 1000000) return fmt`${Math.floor(n / 1000)}k`;
  return fmt`${said((Math.floor(n / 100000) / 10).toFixed(1).replace(/\.0$/, ""))}M`;
}

/** The treasury opened for a look: every number whole up to 100k. */
export const fullAmount = (n: number) => (n < 100000 ? String(n) : shortAmount(n));

export interface ResourceBarLook {
  /** Which cells, in this order (all seven by default). */
  show?: readonly number[];
  /** The date cell's text; none: no date cell. */
  date?: string;
  /** The date cell's width (the original's 198 by default; a short date takes less). */
  dateW?: number;
  /** Room kept free at the date cell's left (the movers' flags over it). */
  dateInset?: number;
  /** The date cell as the week's seven days, the first `day` of them lit (a phone's: the words on a tap). */
  day?: number;
  /** Each cell just wide enough for its picture and its amount (the docked bar), the amounts by `format`. */
  narrow?: boolean;
  format?: (n: number, resource: number) => string;
  /** The narrow cells widened alike so the bar (date included) takes this many pixels (a console's bar across the screen). */
  fill?: number;
  /** Amounts in this font: smalfont as the original (desktop), medfont where it must read on a phone. */
  font?: FontName;
}

/**
 * The bar, laid out from `look` and refreshed in place with `set`. One sprite per cell cut from the player's strip
 * (the whole strip when it's all seven and the original date: exactly the desktop's picture).
 */
export class ResourceBar extends Container {
  private strip: Texture | null = null;
  private player = -1;
  private look: ResourceBarLook = {};
  private amounts: readonly number[] = [];
  /** Which cell (by resource) sits where, for taps: [resource, x, w]; resource -1 is the date. */
  cells: [number, number, number][] = [];
  /** Its own height (the strip's). */
  static readonly H = BAR_H;

  constructor() {
    super();
    block(this, "resourceBar");
    this.label = "resource bar: resources";
  }

  async set(player: number, amounts: readonly number[], look: ResourceBarLook = {}) {
    if (player !== this.player || !this.strip) {
      this.strip = await loadImagePlayer("aresbar.pcx", Math.max(0, player)).catch(() => null);
      this.player = player;
    }
    this.amounts = amounts;
    this.look = look;
    this.draw();
  }

  /** The width it takes (game pixels, before its scale). */
  get barWidth() {
    return this.cells.reduce((w, [, x, cw]) => Math.max(w, x + cw), 0) + (this.look.date === undefined ? GAP : 0);
  }

  private draw() {
    if (this.destroyed) return;
    this.removeChildren().forEach((c) => c.destroy());
    this.cells = [];
    const strip = this.strip;
    const cut = (x: number, w: number, at: number) => {
      if (!strip) return;
      const s = new Sprite(cutPart(strip, { x, y: 0, w, h: BAR_H }));
      s.x = at;
      this.addChild(s);
    };
    const show = this.look.show ?? ALL_RESOURCES;
    const amount = (r: number) => (this.look.format ?? shortAmount)(this.amounts[r] ?? 0, r);
    const font = this.look.font ?? "smalfont";
    const whole = show.length === 7 && show.every((r, i) => r === i) && this.look.date !== undefined && !this.look.dateW;
    let x = 0;
    if (whole && strip) {
      this.addChild(new Sprite(strip));
      for (const r of show) this.cells.push([r, cellX(r), cellW(r)]);
      x = DATE_X;
    } else if (this.look.narrow) {
      // The cell's picture end, its blank middle as long as the amount needs, its bevel's end.
      const natural = show.map((r) => {
        const t = new GameText(font, [...WHITE] as [number, number, number]);
        t.value = said(amount(r));
        const w = NARROW_PIC + Math.ceil(t.width) + 8;
        t.destroy();
        return w;
      });
      const dateTaken = this.look.date === undefined ? GAP : Math.min(BAR_W - DATE_X, Math.max(40, this.look.dateW ?? BAR_W - DATE_X));
      const spare = this.look.fill ? Math.max(0, Math.floor((this.look.fill - dateTaken - natural.reduce((a, b) => a + b, 0)) / show.length)) : 0;
      for (const [i, r] of show.entries()) {
        const cw = natural[i] + spare;
        cut(cellX(r), NARROW_PIC, x);
        for (let m = NARROW_PIC; m < cw - NARROW_END; m += 30) cut(cellX(r) + 40, Math.min(30, cw - NARROW_END - m), x + m);
        cut(cellX(r) + cellW(r) - NARROW_END, NARROW_END, x + cw - NARROW_END);
        this.cells.push([r, x, cw]);
        x += cw;
      }
    } else {
      for (const r of show) {
        cut(cellX(r), cellW(r), x);
        this.cells.push([r, x, cellW(r)]);
        x += cellW(r);
      }
    }
    // The amounts: the original's place in each cell (37 in from its left), a phone's bigger font a little nearer the picture.
    for (const [r, cx] of this.cells) {
      const t = new GameText(font, [...WHITE] as [number, number, number]);
      t.value = said(amount(r));
      t.position.set(cx + (font === "smalfont" ? 37 : 31), Math.round((BAR_H - t.height) / 2));
      this.addChild(t);
    }
    if (this.look.date === undefined) {
      if (!whole) cut(DATE_X, GAP, x);
      return;
    }
    const dw = whole ? BAR_W - DATE_X : Math.min(BAR_W - DATE_X, Math.max(40, this.look.dateW ?? BAR_W - DATE_X));
    if (!whole) {
      cut(DATE_X, dw - DATE_END, x);
      cut(BAR_W - DATE_END, DATE_END, x + dw - DATE_END);
    }
    if (this.look.day !== undefined) {
      // Seven pips, today's the brightest; centred right of the divider.
      const g = new Graphics();
      const x0 = x + 8 + Math.round((dw - 8 - DAY_PIPS_W) / 2);
      for (let i = 0; i < 7; i++) {
        const lit = i < this.look.day;
        g.rect(x0 + i * 7, 8, 5, 6).fill({ color: i === this.look.day - 1 ? 0xffe78c : lit ? 0xb89a3e : 0x000000, alpha: lit ? 1 : 0.55 });
      }
      this.addChild(g);
    } else {
      // One line, squeezed to fit when long (2026-10-26: "Czerwony wykonuje / ruch" wrapped out of the bar).
      // (The cell's own left side holds the yellow divider: the text centred in what is right of it and the flags.)
      const inset = 8 + (this.look.dateInset ?? 0);
      const room = dw - inset - 4;
      const d = new GameText(font, [...WHITE] as [number, number, number]);
      d.value = said(this.look.date);
      d.fit(room);
      d.position.set(x + inset + Math.round((room - d.width) / 2), Math.round((BAR_H - d.height) / 2));
      this.addChild(d);
    }
    this.cells.push([-1, x, dw]);
  }

  /** The resource (or -1 the date, undefined nothing) under a point in its own pixels. */
  at(x: number): number | undefined {
    return this.cells.find(([, cx, w]) => x >= cx && x < cx + w)?.[0];
  }
}

export interface DockedBarOptions {
  /** The cells always shown (gold and the one that matters now). */
  show: readonly number[];
  date?: string;
  dateW?: number;
  /** The date as the week's day pips (instead of `date`'s words). */
  day?: number;
  /** The width it may take, and its largest scale. */
  room: number;
  k: number;
  /** The other resources in rows under it. */
  open: boolean;
  /** Each cell a row of its own (a narrow column): the shown ones always, the rest under them while open. */
  stack?: boolean;
  /** A tap on the bar (`date`: on its date cell); on the open rows. */
  tap: (date: boolean) => void;
  restTap?: () => void;
}

/**
 * Phones (the map and the town): the bar docked to a few cells, a tap opens the rest in rows under it that fit
 * `room`. Medium font, as big as `k` allows in the room. `top` is the docked bar (for what's drawn over it).
 */
export async function dockedBar(player: number, amounts: readonly number[], o: DockedBarOptions) {
  const bar = new Container();
  bar.label = "resource bar: resources";
  // (Stacked only when side by side they would be much smaller.)
  const stack = !!o.stack && o.show.reduce((w, r) => w + cellW(r), GAP) * o.k * 0.7 > o.room;
  const top = new ResourceBar();
  await top.set(player, amounts, { show: stack ? o.show.slice(0, 1) : o.show, date: o.date, dateW: o.dateW, day: o.day, font: "medfont" });
  const scale = Math.min(o.k, o.room / top.barWidth);
  top.scale.set(scale);
  top.eventMode = "static";
  top.cursor = "pointer";
  top.on("pointertap", (e) => o.tap(top.at(top.toLocal(e.global).x) === -1));
  bar.addChild(top);
  const always = stack ? o.show.slice(1) : [];
  for (const [i, r] of always.entries()) {
    const row = new ResourceBar();
    await row.set(player, amounts, { show: [r], font: "medfont" });
    row.scale.set(scale);
    row.position.set(0, (i + 1) * (BAR_H + 2) * scale);
    row.eventMode = "static";
    row.cursor = "pointer";
    row.on("pointertap", () => o.tap(false));
    bar.addChild(row);
  }
  if (o.open) {
    const rest = ALL_RESOURCES.filter((r) => !o.show.includes(r));
    const below = always.length;
    const perRow = Math.max(1, Math.min(rest.length, Math.floor(o.room / (CELL_W * scale))));
    for (let i = 0; i * perRow < rest.length; i++) {
      const row = new ResourceBar();
      await row.set(player, amounts, { show: rest.slice(i * perRow, (i + 1) * perRow), font: "medfont" });
      row.scale.set(scale);
      row.position.set(0, (below + i + 1) * (BAR_H + 2) * scale);
      row.eventMode = "static";
      row.on("pointertap", () => o.restTap?.());
      bar.addChild(row);
    }
  }
  return { bar, top, scale };
}

/** The treasury's two rows (2026-10-27: "could be a bit bigger, could be two rows"): the four rare ones over crystal, gems and gold. */
export const TREASURY_ROWS: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [4, 5, GOLD],
];

/**
 * The treasury opened for a look (2026-10-26): all seven with whole numbers (to 100k), each one's daily income
 * over it, in two rows (each row centred), as big as `w` wide allows and at most `maxK` times the strip. A tap anywhere
 * closes it (the caller's); the caller places it whole on the screen (ui/blocks/popupPlace.ts).
 */
export async function treasuryPanel(player: number, amounts: readonly number[], income: readonly number[], w: number, maxK = Infinity): Promise<Container> {
  const c = new Container();
  c.label = "resource bar: treasury";
  const INCOME_H = 18;
  const rows = await Promise.all(
    TREASURY_ROWS.map(async (show) => {
      const bar = new ResourceBar();
      await bar.set(player, amounts, { show, font: "medfont", format: (n) => fullAmount(n) });
      return bar;
    }),
  );
  const width = Math.max(...rows.map((b) => b.barWidth));
  let y = 0;
  for (const bar of rows) {
    const row = new Container();
    const strip = new Graphics().rect(0, 0, bar.barWidth, INCOME_H).fill({ color: 0, alpha: 0.8 }).rect(0, INCOME_H - 1, bar.barWidth, 1).fill(0xc9a046);
    row.addChild(strip);
    for (const [r, cx, cw] of bar.cells) {
      const n = income[r] ?? 0;
      if (!n) continue;
      const t = new GameText("medfont", [...YELLOW] as [number, number, number], "center", cw);
      t.value = fmt`${n > 0 ? said("+") : said("")}${n}`;
      t.position.set(cx, Math.round((INCOME_H - 1 - t.height) / 2));
      row.addChild(t);
    }
    bar.y = INCOME_H;
    row.addChild(bar);
    row.position.set(Math.round((width - bar.barWidth) / 2), y);
    c.addChild(row);
    y += INCOME_H + BAR_H + 2;
  }
  c.scale.set(Math.min(maxK, w / width));
  c.eventMode = "static";
  return block(c, "treasury");
}
