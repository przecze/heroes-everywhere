// The phone windows' shared frame and fit (the hero, exchange, tavern and marketplace pages, the Thieves' Guild, the
// spellbook, the Mage Guild upright): each part in the minimap's ornate frame, and the whole as big as the page allows,
// under the page's own buttons (☰, Feedback) upright, clear of a sideways phone's navigation bar.
import { Container, Graphics, Sprite, TilingSprite } from "pixi.js";
import { loadDef, loadImage } from "../../assets.ts";
import { windowFrame } from "../kit.ts";
import { pageButtons } from "../screen.ts";
import { pageScale, pageSize, rightRoom, titleBand } from "../mobilePage.ts";
import { advOrnate } from "./advFrame.ts";
import { HEROSCR4, TOWNSCRN, part, tiledPart, windowRim } from "./windowParts.ts";
import { block } from "./block.ts";

/** The ornate frame's own scale on a phone (thinner than the desktop's) and the room it takes round a part. */
export const FRAME_K = 0.6;
export const FRAME_PAD = 20;

/**
 * The room between two parts of one phone window, a gold line along its middle (2026-10-26: "one dialogue rather
 * than a full screen overlay with three sections"): the window's one rim round them all (mobilePage's openPage), no
 * frame per part.
 */
export const SPLIT = 16;

/** A split's gold line: across the gap at x, y (`len` long), or down it. */
export function splitLine(root: Container, x: number, y: number, len: number, down = false): void {
  const g = new Graphics();
  g.label = "window: gold line";
  if (down) g.rect(x + SPLIT / 2 - 1, y, 2, len);
  else g.rect(x, y + SPLIT / 2 - 1, len, 2);
  root.addChildAt(g.fill({ color: 0xc8a046, alpha: 0.9 }), 0);
}

/** The phone windows' and pages' frame over `fw` x `fh` (its outside): the windows' rim, the minimap's ornament only without the picture. */
export async function phoneFrame(fw: number, fh: number, player: number): Promise<Container> {
  return (await windowRim(fw, fh, player)) ?? (await advOrnate(fw, fh, player, FRAME_K));
}

/**
 * A small phone window of its own (the battle's hero popup): the windows' leather (DIBOXBCK) in that rim, as the
 * pages are; the desktop's dialog frame without the pictures.
 */
export async function leatherWindow(w: number, h: number, player: number): Promise<Container> {
  const [leather, rim] = await Promise.all([loadImage("diboxbck.pcx").catch(() => null), windowRim(w, h, player)]);
  if (!leather || !rim) return windowFrame(w, h, player);
  const c = new Container();
  c.addChild(new TilingSprite({ texture: leather, width: w, height: h }), rim);
  return block(c, "leatherWindow");
}

/**
 * A phone screen's panel as the desktop's town panel (TOWNSCRN): the owner's colour inside the windows' rim with its
 * knots, for a screen of panels whose places (slots, boxes) are leather, as the desktop's are.
 */
export async function colourWindow(w: number, h: number, player: number): Promise<Container> {
  const [ground, rim] = await Promise.all([tiledPart(TOWNSCRN, "colour", player, w, h), windowRim(w, h, player)]);
  if (!ground || !rim) return leatherWindow(w, h, player);
  const c = new Container();
  c.addChild(ground, rim);
  return block(c, "colourWindow");
}

/**
 * The page's size, the top under its own buttons, and the width left of a sideways phone's navigation bar. `band`: the
 * window's title band (mobilePage's titleBand), kept free over what the fits place.
 */
export function phoneRoom(): { W: number; H: number; top: number; room: number; band: number } {
  const { w, h } = pageSize();
  const band = titleBand();
  return { W: w, H: h, top: Math.ceil((pageButtons()?.bottom ?? 0) / pageScale()) + 4 + band, room: w - rightRoom() - 8, band };
}

/** Upright: `root` (dw x dh) as big as fits under the page's buttons, in the middle. */
export function fitUpright(root: Container, dw: number, dh: number): number {
  const { W, H, top } = phoneRoom();
  const k = Math.min((W - 8) / dw, (H - top - 6) / dh);
  root.scale.set(k);
  root.position.set(Math.round((W - dw * k) / 2), Math.round(top + (H - top - dh * k) / 2));
  return k;
}

/**
 * The upright phone window (2026-10-27 22:00-22:44: the tavern, the Mage Guild, the Puzzle Map, "make room" for
 * joining creatures each came out as the desktop's window scaled down, or blown up to fill the screen): every upright
 * window of its own is laid out SHEET_W wide, its rim included, and drawn at the one scale that width gets across the
 * phone. So the same words, pictures and buttons are the same size in every one of them, a window is only as tall as
 * what it holds, and the parts are arranged for a narrow screen instead of shrunk (rows of four, a picture over its
 * words). Its inside is SHEET_IN wide.
 */
export const SHEET_W = 360;
export const SHEET_IN = SHEET_W - 2 * FRAME_PAD;
/** The words in an upright window: the medium font at the sheet's scale (about 17 CSS pixels a line on a phone 360 wide), names and headings this much bigger. */
export const SHEET_TEXT = 1;
export const SHEET_NAME = 1.25;
/** Upright, the room a screen's own foot keeps below a window: the town's and the map's resources stay in sight. */
const SHEET_KEEP = 70;

/**
 * Upright: an SHEET_W x dh window at the sheets' one scale, in the middle of the screen's width, its foot just over the
 * screen's own (so the resources stay in sight and its buttons come near the thumb), a little smaller where that makes
 * it fit there; taller than that, as big as fits under the page's buttons.
 */
export function fitSheet(root: Container, dh: number): number {
  const { W, H, top } = phoneRoom();
  const k0 = (W - 8) / SHEET_W;
  const low = Math.min(k0, (H - SHEET_KEEP - top) / dh);
  const k = low >= 0.85 * k0 ? low : Math.min(k0, (H - top - 6) / dh);
  root.scale.set(k);
  const y = low >= 0.85 * k0 ? H - SHEET_KEEP - dh * k : top + (H - top - dh * k) / 2;
  root.position.set(Math.round((W - SHEET_W * k) / 2), Math.round(y));
  return k;
}

/** An upright window's foot: its buttons spread along SHEET_IN at `y` (the first at the left, the last at the right), each `k` times bigger. */
export function sheetFoot(root: Container, buttons: Container[], y: number, k = 1.6): number {
  let h = 0;
  for (const b of buttons) b.scale.set(k), (h = Math.max(h, b.height));
  const free = SHEET_IN - buttons.reduce((s, b) => s + b.width, 0);
  const gap = buttons.length > 1 ? free / (buttons.length - 1) : 0;
  let x = FRAME_PAD + (buttons.length === 1 ? SHEET_IN - buttons[0].width : 0);
  for (const b of buttons) {
    b.position.set(Math.round(x), Math.round(y + (h - b.height) / 2));
    root.addChild(b);
    x += b.width + gap;
  }
  return y + h;
}

/**
 * Sideways: the scale for dw x dh left of the navigation bar (asked before the parts are laid out: some go by it).
 * `pad`: the frames' ornament may run under the page's buttons, what is inside them not.
 */
export function sidewaysScale(dw: number, dh: number, pad = 0): number {
  const { H, top, room, band } = phoneRoom();
  return Math.min(room / dw, (H - 8 - band) / dh, pad ? (H - top - 4) / (dh - pad) : Infinity);
}

/** Sideways: `root` at that scale, in the middle of the room (with `pad`, its inside never under the page's buttons). */
export function placeSideways(root: Container, dw: number, dh: number, k: number, pad = 0): void {
  const { H, top, room, band } = phoneRoom();
  root.scale.set(k);
  const mid = band + (H - band - dh * k) / 2;
  root.position.set(Math.round((room - dw * k) / 2), Math.round(pad ? Math.max(mid, top - pad * k) : mid));
}

/** One whole picture of a page (the spellbook, the Thieves' Guild's ranking): upright as fitUpright, sideways as big as fits left of the navigation bar. */
export function fitOnPage(root: Container, dw: number, dh: number, upright: boolean): number {
  if (upright) return fitUpright(root, dw, dh);
  const k = sidewaysScale(dw, dh);
  placeSideways(root, dw, dh, k);
  return k;
}

/**
 * The player's flag (CREST58) on the head of the hero screen's coloured column (windowParts' flagHead), as the
 * desktop's banner over its heroes.
 */
export async function playerFlag(player: number): Promise<Container | null> {
  const [f, head] = await Promise.all([loadDef("crest58.def").then((d) => d.get(0)?.[Math.max(0, player)]).catch(() => undefined), part(HEROSCR4, "flagHead", player)]);
  if (!f) return null;
  const c = new Container();
  c.label = "hero: flag";
  if (head) c.addChild(head);
  c.addChild(Object.assign(new Sprite(f.texture), { x: head ? 1 : 0, y: head ? 4 : 0 }));
  return c;
}

/**
 * One place of the hero screen's column of heroes: the bordered slot on the player's colour (windowParts'
 * heroSlot), a 48 x 32 portrait at INSET in it (2026-10-26: "bordered and with player colors").
 */
export const HERO_CELL = { w: 56, h: 40, inset: 4 };
export function heroCell(player: number): Promise<Sprite | null> {
  return part(HEROSCR4, "heroSlot", player);
}
