// Windows of their own on phones (the hero screen, the kingdom...): one window over the dimmed game, a column of title
// and page tabs down the left (upright a header and a foot), big text, and lists a finger drags.
import { track } from "../usage.ts";
import { Container, Graphics, Rectangle } from "pixi.js";
import { type FontName, WHITE, YELLOW } from "../text.ts";
import { DefButton, label, textButton, setEnabled } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { FRAME_PAD, leatherWindow } from "./blocks/phoneWindow.ts";
import { wordBar } from "./blocks/windowParts.ts";
import { screenPlayer } from "./creatureInfo.ts";

/** The column's and the bands' inner margin: clear of the frame's edge (phoneWindow's phoneFrame). */
const PAD = 28;
import { navBarRight, onLayout, oneHand, pageButtons, phoneSized, screenSize } from "./screen.ts";
import { tr, untr, type Text, said } from "../i18n/index.ts";
import { playSound } from "../audio.ts";

/** Room the page's own buttons take: menu and full screen top left, Feedback top right. */
const TOP_MIN = 76;
/**
 * The page's top: upright the window's rim starts under the page's own buttons wherever they really are (the owner's
 * installed app puts ☰ 72-112 CSS pixels down: it sat over the Scenario Info title, 2026-11-02), else a fixed 76.
 */
export const pageTop = (): number => (upright() ? Math.max(TOP_MIN, Math.ceil((pageButtons()?.bottom ?? 0) / pageScale()) + 24) : TOP_MIN);
export const LEFT_W = 270;
/**
 * Upright (the phone held upright) there is no room for a column beside the content: the title and
 * its text run across the top (HEAD high), the buttons along the bottom (FOOT), the content between.
 */
const HEAD = 150;
/** Upright, a page with only its title in the header (no text, no tabs): the content starts under it. */
const HEAD_TITLE = 62;
const FOOT = 76;
/** The open pages' header heights, the top one's in use (a page opened from another one gives it back on closing). */
const heads: { h: number; win: Container }[] = [];
/**
 * A bare window's title band (2026-10-27: "show building name on top of dialog"): the open windows' bands, the top
 * one's in use. The window's own name (Marketplace, Mage Guild Level 3) in the windows' rim above what it draws, as
 * the pages with a column have theirs; phoneWindow's fits leave this much room over the content for it.
 */
const TITLE_BAND = 46;
const bands: { h: number; win: Container }[] = [];
export const titleBand = () => {
  while (bands.length && bands[bands.length - 1].win.destroyed) bands.pop();
  return bands[bands.length - 1]?.h ?? 0;
};
const head = () => {
  // (A page taken down without its close: its window destroyed.)
  while (heads.length && heads[heads.length - 1].win.destroyed) heads.pop();
  return heads[heads.length - 1]?.h ?? HEAD;
};
/** Upright the foot holds a finger-high row of buttons. */
const foot = () => Math.max(FOOT, btnH() + 48);
/** Upright: a foot button's top, in the middle of the foot band (inside its frame). */
const footY = (h: number, bh: number) => Math.round(h - foot() / 2 + 4 - bh / 2);
/** A sideways column's lowest button's foot above the page's: clear of the window's rim (windowBacking). */
const BOTTOM = 24;
const upright = () => screenSize.portrait;

/** Room kept at the right: Android's navigation bar (screen.ts navBarRight, as the map and the battle keep) on a phone held sideways. */
export const rightRoom = () => (screenSize.touch && phoneSized() ? Math.max(16, navBarRight()) : 16);
/**
 * Where the column starts: the left edge, or one-handed with the right thumb (sideways) the right,
 * clear of the navigation bar, so its buttons (Close, Recruit...) are under the thumb.
 */
export const columnX = () => (!upright() && oneHand() === "right" ? pageSize().w - rightRoom() - LEFT_W : 0);

/** Upright (screen.ts's experimental layout) pages are drawn a third bigger, to read as they do turned. */
export const pageScale = () => (screenSize.portrait ? 4 / 3 : 1);
/**
 * A page button's height: 52, or a finger's (46 CSS pixels) on a screen that draws the page smaller
 * (a phone: 67 to 77), so Close, the tabs and the like are never under a finger's width.
 */
export const btnH = () => Math.max(52, Math.ceil(46 / (screenSize.css * pageScale())));
/** The space a page lays out in (the screen, in its own scale). */
export function pageSize() {
  const u = pageScale();
  return { w: Math.round(screenSize.w / u), h: Math.round(screenSize.h / u) };
}

/** Text at `k` times its size, squeezed to `w` when given and wider; wrapped at `wrap` (screen pixels). */
export function bigText(t: Text, font: FontName, color: readonly [number, number, number], k: number, o: { w?: number; wrap?: number; center?: boolean } = {}) {
  const l = label(t, font, color, "left", o.wrap ? Math.floor(o.wrap / k) : undefined);
  l.scale.set(k);
  // (Kept by the text when it is drawn again: made before its font came, it fits once the font is in.)
  if (o.w) l.fit(o.w);
  // (Centred through the pivot, so that placing the text afterwards, x included, keeps it centred.)
  if (o.center && o.w) l.centreIn(o.w);
  return l;
}

/**
 * The scenario screen's word bar (GSPBUTT) at a finger's size, `w` x `h`: the original's bevel, marble and arrow
 * (windowParts' wordBar), its words in `font` at `k` (two lines when they don't fit one), pressed while held.
 */
export async function barButton(text: Text, w: number, h: number, onClick: () => void, arrowed = true, font: FontName = "medfont", k = 1.25): Promise<Container> {
  // (The arrow at the phone pages' 1.5 when the words are enlarged, else the original's.)
  const ak = k > 1 ? 1.5 : 1;
  const c = new Container();
  c.label = `button: ${untr(text)}`;
  const [up, down] = await Promise.all([wordBar(w, h, ak, false, arrowed), wordBar(w, h, ak, true, arrowed)]);
  const left = arrowed ? 20 * ak : 4;
  const face = (b: Container | null) => b ?? new Graphics().rect(0, 0, w, h).fill(0x18295a).stroke({ color: 0x9ca5b5, width: 2 });
  const u = face(up);
  const d = Object.assign(face(down), { visible: false });
  const room = w - left - 8;
  const one = bigText(text, font, WHITE, k);
  // (Two lines when one would be squeezed and two fit, a few pixels into the rim at most: sideways New Game's
  // "Opcje zaawansowane", the owner 2026-10-25.)
  const t = one.height * 2 <= h + 6 && one.width > room ? bigText(said(text.replace(" ", "\n")), font, WHITE, k, { w: room }) : bigText(text, font, WHITE, k, { w: room });
  t.position.set(left + Math.round((room - t.width) / 2), Math.round((h - t.height) / 2));
  t.eventMode = "none";
  c.addChild(u, d, t);
  c.eventMode = "static";
  c.cursor = "pointer";
  const ty = t.y;
  const press = (on: boolean) => ((d.visible = on), (u.visible = !on), (t.y = ty + (on ? 1 : 0)));
  c.on("pointerdown", () => press(true));
  c.on("pointerup", () => press(false));
  c.on("pointerupoutside", () => press(false));
  c.on("pointertap", () => (void playSound("button"), onClick()));
  return c;
}

/** A button of the page's left column: its text, what it does, and whether it's live (greyed out when not; taps do nothing). */
/** A page's button: its words (the hint), what it does, whether it can now, and the original's button art when it has one (the campaign's BEGIN: the owner, 2026-10-26 "Begin button"). */
export type ColumnButton = [text: string, onTap: () => void, live?: boolean, def?: string];

/** A page button: the original's art (`def`) scaled into w x h when it has one, else the word button. */
async function pageButton(text: string, fn: () => void, live: boolean, w: number, h: number, def?: string): Promise<Container> {
  if (!def) {
    const b = await textButton(tr(text), w, h, () => live && fn());
    setEnabled(b, live);
    return b;
  }
  const box = new Container();
  const b = new DefButton(def, 0, 0);
  b.label = `button: ${text}`;
  b.onClick = () => live && fn();
  await b.ready;
  const k = Math.min(w / Math.max(1, b.width), h / Math.max(1, b.height));
  b.scale.set(k);
  b.position.set(Math.round((w - b.width) / 2), Math.round((h - b.height) / 2));
  b.disabled = !live;
  box.addChild(b);
  return box;
}

/**
 * The page's left column: the title in big letters, a line or two of text under it, and buttons
 * stacked up from the bottom (the last one lowest, where the thumb is).
 */
/** (Buttons' titles are English, put through `tr` here: callers find them by name.) */
export async function pageColumn(title: Text, o: { text?: string; buttons: ColumnButton[] }): Promise<Container> {
  track(`page:${title}`);
  if (upright()) return pageHeader(title, o);
  const col = new Container();
  const cx = columnX();
  const head = bigText(title, "bigfont", YELLOW, 1.5, { wrap: LEFT_W - 2 * PAD });
  head.position.set(cx + PAD, 90);
  col.addChild(head);
  if (o.text) col.addChild(Object.assign(bigText(said(o.text), "medfont", WHITE, 1.5, { wrap: LEFT_W - 2 * PAD }), { x: cx + PAD, y: 90 + head.height + 14 }));
  const bh = btnH();
  let y = pageSize().h - BOTTOM - bh;
  for (const [text, fn, live = true, def] of [...o.buttons].reverse()) {
    const b = await pageButton(text, fn, live, LEFT_W - 2 * PAD, bh, def);
    b.position.set(cx + PAD, y);
    col.addChild(b);
    y -= bh + 10;
  }
  return col;
}

/** Upright: pageColumn's title and text across the top, its buttons in a row along the bottom (Close at the right). */
async function pageHeader(title: Text, o: { text?: string; buttons: ColumnButton[] }): Promise<Container> {
  const { w, h } = pageSize();
  const col = new Container();
  col.addChild(Object.assign(bigText(title, "bigfont", YELLOW, 1.5, { w: w - 2 * PAD }), { x: PAD, y: pageTop() }));
  if (o.text) {
    const t = bigText(said(o.text), "medfont", WHITE, 1.5, { wrap: w - 2 * PAD });
    // Three lines' room: a longer text is drawn smaller.
    const room = HEAD - 56;
    if (t.height > room) t.scale.set((t.scale.y * room) / t.height);
    t.position.set(PAD, pageTop() + 50);
    col.addChild(t);
  }
  const n = o.buttons.length;
  const gap = 12;
  const bw = Math.min(LEFT_W - 2 * PAD, Math.floor((w - 2 * PAD - (n - 1) * gap) / Math.max(1, n)));
  let x = w - PAD - bw;
  const bh = btnH();
  for (const [text, fn, live = true, def] of [...o.buttons].reverse()) {
    const b = await pageButton(text, fn, live, bw, bh, def);
    b.position.set(x, footY(h, bh));
    col.addChild(b);
    x -= bw + gap;
  }
  return col;
}

/**
 * For pages that draw their own column: the title (sideways at the column's top, upright across the
 * header), `k` times its size.
 */
export function columnTitle(title: Text, k = 1.5) {
  const t = upright() ? bigText(title, "bigfont", YELLOW, k, { w: pageSize().w - 2 * PAD }) : bigText(title, "bigfont", YELLOW, k, { wrap: LEFT_W - 2 * PAD });
  t.position.set(upright() ? PAD : columnX() + PAD, upright() ? pageTop() : 90);
  return t;
}

/**
 * Tabs or other buttons of a page's column: sideways stacked from `y` down the column (the picked
 * one framed), upright in a row across the header, under the title.
 */
export async function columnTabs(items: [text: string, onTap: () => void, picked?: boolean][], y: number, h = btnH()): Promise<Container> {
  h = Math.max(h, btnH());
  const c = new Container();
  const up = upright();
  const n = items.length;
  const gap = 12;
  const w = up ? Math.floor((pageSize().w - 2 * PAD - (n - 1) * gap) / Math.max(1, n)) : LEFT_W - 2 * PAD;
  for (const [i, [text, fn, picked]] of items.entries()) {
    const b = await textButton(tr(text), w, h, fn, h < 52 ? "medfont" : "bigfont", !!picked);
    b.position.set(up ? PAD + i * (w + gap) : columnX() + PAD, up ? pageTop() + 56 : y + i * (h + 12));
    c.addChild(b);
  }
  return c;
}

/** A page's bottom buttons (Close last): sideways stacked up the column's foot, upright in a row from the right. */
export async function columnFoot(items: ColumnButton[]): Promise<Container> {
  const c = new Container();
  const { w, h } = pageSize();
  const up = upright();
  const n = items.length;
  const gap = 12;
  const bw = up ? Math.min(LEFT_W - 2 * PAD, Math.floor((w - 2 * PAD - (n - 1) * gap) / Math.max(1, n))) : LEFT_W - 2 * PAD;
  let x = w - PAD - bw;
  const bh = btnH();
  let y = h - BOTTOM - bh;
  for (const [text, fn, live = true] of [...items].reverse()) {
    const b = await textButton(tr(text), bw, bh, () => live && fn());
    setEnabled(b, live);
    b.position.set(up ? x : columnX() + PAD, up ? footY(h, bh) : y);
    c.addChild(b);
    x -= bw + gap;
    y -= bh + 10;
  }
  return c;
}

/**
 * A bare window's leather and rim round what its content drew (the parts laid out with FRAME_PAD round each, as the
 * hero, exchange, tavern and market windows are): one window, no frame per part.
 */
/** `c` (placed by phoneWindow's fits, the band left free over it) with `title` centred in the band over it. */
function titled(c: Container, title: Text): Container {
  const holder = new Container();
  holder.label = `window: ${title}`;
  // (Not on the stage yet: its bounds are in the layer's pixels, as the title's.)
  const b = c.getBounds();
  const w = Math.max(b.width, 240);
  const t = bigText(title, "bigfont", YELLOW, 1.25, { w: w - 8, center: true });
  t.label = `title: ${title}`;
  t.position.set(Math.round(b.x + (b.width - w) / 2 + 4), Math.round(b.y - TITLE_BAND + (TITLE_BAND - t.height) / 2 + 4));
  holder.addChild(c, t);
  return holder;
}

async function windowRound(c: Container) {
  const b = c.getLocalBounds();
  const P = FRAME_PAD;
  const win = await leatherWindow(Math.ceil(b.width) + 2 * P, Math.ceil(b.height) + 2 * P, screenPlayer());
  if (c.destroyed) return void win.destroy({ children: true });
  win.position.set(Math.floor(b.x) - P, Math.floor(b.y) - P);
  win.label = "window: leather";
  c.addChildAt(win, 0);
}

/** Under a window over the game: the game dimmed, taking the taps that miss the window. */
function windowVeil(): Container {
  const { w, h } = pageSize();
  const g = new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.5 });
  g.label = "veil: the game under the window";
  g.eventMode = "static";
  return g;
}

/**
 * A page shown as a window over the game (2026-10-26: "windowed, no full screen, no sections"): the game dimmed
 * round it, and one rim of the windows' leather round the title, the content and the buttons, a gold line between
 * them where the page had its frames. The page's own buttons (☰, Feedback) stay over the dimmed game above it.
 */
async function windowBacking(cut = 0): Promise<Container> {
  const c = new Container();
  c.addChild(windowVeil());
  const r = windowRect();
  r.h -= cut;
  const win = await leatherWindow(r.w, r.h, screenPlayer());
  win.position.set(r.x, r.y);
  win.label = "window: the page's";
  c.addChild(win);
  const lines = new Graphics();
  const gold = { color: 0xc8a046, alpha: 0.9 };
  const { h } = pageSize();
  const m = RIM_ROOM;
  if (upright()) {
    lines.rect(r.x + m, pageTop() + head() - 6, r.w - 2 * m, 2).fill(gold);
    lines.rect(r.x + m, h - cut - foot() - 6, r.w - 2 * m, 2).fill(gold);
  } else {
    // Between the column and the content, at the column's inner side.
    const x = columnX() ? columnX() - 10 : LEFT_W + 8;
    lines.rect(x, r.y + m, 2, r.h - 2 * m).fill(gold);
  }
  c.addChild(lines);
  return c;
}

/** The window's rim and the room inside it kept clear. */
const RIM_ROOM = 20;

/** Where a page's window lies: under the page's own buttons' row, clear of a sideways phone's navigation bar. */
function windowRect() {
  const { w, h } = pageSize();
  const y = pageTop() - 18;
  return { x: 4, y, w: (upright() ? w : w - rightRoom()) - 8, h: h - y - 4 };
}

/** The room contentArea leaves round the content (the window's gold lines, its rim). */
const INSET = 12;

/** The content area right of the column, below the page's own buttons. */
export function contentArea() {
  const { w, h } = pageSize();
  if (upright()) return { x: 16 + INSET, y: pageTop() + head() + INSET, w: w - 32 - 2 * INSET, h: h - pageTop() - head() - foot() - 8 - 2 * INSET };
  // Right-handed the column is at the right: the content left of it.
  const cx = columnX();
  // Under the page's own buttons (on a short phone they come lower than pageTop()).
  const top = Math.max(pageTop(), Math.ceil((pageButtons()?.bottom ?? 0) / pageScale()) + 6);
  // (INSET: room for the content's frame, round it; at the right twice, the frame clear of the navigation bar.)
  if (cx) return { x: 16 + INSET, y: top + INSET, w: cx - 20 - 16 - 3 * INSET, h: h - top - 12 - 2 * INSET };
  // Sideways on a phone the right-hand 72 CSS pixels are Android's navigation bar's.
  return { x: LEFT_W + 20 + INSET, y: top + INSET, w: w - LEFT_W - 20 - rightRoom() - 3 * INSET, h: h - top - 12 - 2 * INSET };
}

type ScrollView = Container & { fits?: { bottom: number; spare: number } };

/**
 * Upright, a window over the game as high as its list needs (2026-10-26: "windowed, no full screen"): the room a
 * short list leaves unused is cut out, what lies under the list (the foot's buttons) moving up with the window's foot.
 * Returns the cut.
 */
function fitWindow(c: Container): number {
  if (!upright()) return 0;
  const lists: ScrollView[] = [];
  const walk = (x: Container, depth: number) => {
    for (const ch of x.children as ScrollView[]) {
      if (ch.fits) lists.push(ch);
      else if (depth < 3) walk(ch, depth + 1);
    }
  };
  walk(c, 0);
  if (lists.length !== 1) return 0;
  const { bottom, spare } = lists[0].fits!;
  if (spare < 1) return 0;
  const cut = Math.floor(spare);
  // (The foot's buttons are the column's children, or the content's own, a few containers down.)
  const lift = (x: Container, y0: number, depth: number) => {
    for (const ch of x.children as Container[]) {
      if (ch === lists[0]) continue;
      if (y0 + ch.y >= bottom) ch.y -= cut;
      else if (depth < 3 && ch.children.length) lift(ch, y0 + ch.y, depth + 1);
    }
  };
  lift(c, 0, 0);
  return cut;
}

/**
 * A list a finger (or the wheel) scrolls up and down inside `area`. `moved()` is true right after a
 * drag, so rows can ignore the tap a drag ends with.
 */
export function scrollList(content: Container, area: { x: number; y: number; w: number; h: number }, offset = 0) {
  const view = new Container();
  view.position.set(area.x, area.y);
  const mask = new Graphics().rect(0, 0, area.w, area.h).fill(0xffffff);
  view.addChild(new Graphics().rect(0, 0, area.w, area.h).fill({ color: 0, alpha: 0.001 }), content, mask);
  // On the view, not the content: a masked container measures only what shows (its height then
  // never exceeded the area, and no list scrolled).
  view.mask = mask;
  // What a window over the game can leave out under a short list (openPage's fitWindow).
  (view as ScrollView).fits = { bottom: area.y + area.h, spare: Math.max(0, area.h - content.height) };
  view.eventMode = "static";
  // Taps only where the list is: upright a short list's window is cut to fit it (fitWindow), the foot's buttons moving up
  // into the area's lower part, and the view, as tall as the area, took their taps (upright Artifact Merchants' Close
  // and Sell artifacts did nothing). Nor do rows scrolled out of sight catch taps: a mask doesn't stop them.
  view.hitArea = new Rectangle(0, 0, area.w, Math.min(area.h, content.height));
  let y = offset;
  const clamp = () => {
    y = Math.max(Math.min(0, area.h - content.height), Math.min(0, y));
    content.y = y;
  };
  clamp();
  let from: number | null = null;
  let dragged = false;
  let travel = 0;
  view.on("pointerdown", (e) => ((from = e.global.y), (travel = 0)));
  view.on("globalpointermove", (e) => {
    if (from === null) return;
    const d = e.global.y - from;
    from = e.global.y;
    travel += Math.abs(d);
    if (travel > 8) dragged = true;
    y += d;
    clamp();
  });
  const up = () => {
    from = null;
    setTimeout(() => (dragged = false), 0);
  };
  view.on("pointerup", up);
  view.on("pointerupoutside", up);
  view.on("wheel", (e) => ((y -= e.deltaY), clamp()));
  return { view, moved: () => dragged, offset: () => y };
}

/**
 * A phone page: a window over the dimmed game and a layer for its content. `show()` puts it up and
 * resolves once it closes (Escape / Enter unless `keys` takes them, or `close()`, which also runs `onClose`); `setContent`
 * swaps in freshly drawn content (dropped if the page has closed meanwhile).
 */
export async function openPage(
  modals: Modals,
  opts: {
    onClose?: () => void;
    keys?: (key: string) => boolean | void;
    /** Draws the content again (for a change of layout: the phone turned). */
    draw?: () => unknown;
    /** Upright, only the title in the header (pageColumn without text, or columnTitle alone): the content moves up under it. */
    titleOnly?: boolean;
    /** Only the leather: no header or foot bands, no column (the page draws all of it). */
    bare?: boolean;
    /** The content draws its own window (upright Options). */
    ownWindow?: boolean;
    /** A bare window's name, drawn in its rim above the content (titleBand). */
    title?: Text;
  } = {},
) {
  const win = new Container();
  const myHead = { h: opts.titleOnly ? HEAD_TITLE : HEAD, win };
  heads.push(myHead);
  const myBand = { h: opts.bare && opts.title ? TITLE_BAND : 0, win };
  bands.push(myBand);
  // The page's own scale on a container of its own (the window's is the modal stack's to set).
  const page = new Container();
  win.addChild(page);
  const layer = new Container();
  let hide = () => {};
  let resolve = () => {};
  const closed = new Promise<void>((r) => (resolve = r));
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    const i = heads.indexOf(myHead);
    if (i >= 0) heads.splice(i, 1);
    const j = bands.indexOf(myBand);
    if (j >= 0) bands.splice(j, 1);
    stopLayout();
    opts.onClose?.();
    hide();
    resolve();
  };
  // Taken down with the rest of the stack (Modals.dismissAll), not closed: closed all the same (its listeners, its header).
  win.once("destroyed", close);
  /** The backing for the layout now, under the content. */
  let built = 0;
  let cut = 0;
  const frame = async () => {
    const gen = ++built;
    // (A bare window's content gets the windows' leather and rim round it: windowRound.)
    const parts = [opts.bare ? windowVeil() : await windowBacking(cut)];
    if (gen !== built || win.destroyed) return void parts.forEach((p) => p.destroy({ children: true }));
    page.removeChildren().forEach((x) => x !== layer && x.destroy({ children: true }));
    page.scale.set(pageScale());
    page.addChild(parts[0], layer, ...parts.slice(1));
  };
  await frame();
  // The phone turned (or Options changed the layout): the page laid out again, open as it was.
  let first = true;
  let showing = false;
  let missed = false;
  const stopLayout = onLayout(() => {
    if (first) return void (first = false);
    if (!open || win.destroyed) return;
    // (Before show its maker may still be drawing the content: drawn again once shown.)
    if (!showing) return void (missed = true);
    void frame().then(() => open && opts.draw?.());
  });
  const show = () => {
    showing = true;
    if (missed) void frame().then(() => open && opts.draw?.());
    hide = modals.show(win, {
      x: () => -screenSize.ox,
      y: () => -screenSize.oy,
      own: true,
      onKey: (key) => {
        // `keys` answering true has dealt with the key (Escape / Enter included).
        if (opts.keys?.(key) !== true && (key === "Escape" || key === "Enter")) close();
        return true;
      },
    });
    return closed;
  };
  const setContent = (c: Container) => {
    if (win.destroyed || !open) return void c.destroy({ children: true });
    layer.removeChildren().forEach((x) => x.destroy({ children: true }));
    if (opts.bare && opts.title) c = titled(c, opts.title);
    layer.addChild(c);
    if (opts.bare && !opts.ownWindow) void windowRound(c);
    if (!opts.bare) {
      const was = cut;
      cut = fitWindow(c);
      if (cut !== was) void frame();
    }
  };
  return { win, close, show, setContent };
}

