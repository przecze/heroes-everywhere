// The touch HUD's sizes and its two drawing helpers: the game's fonts enlarged, and the panels' leather.
import { GameText, WHITE } from "../../text.ts";
import { blankButtonNow } from "../../ui/kit.ts";
import { type Text } from "../../i18n/index.ts";

/** Game pixels kept free at the top left for the page's corner buttons (menu, full screen)... */
export const CORNER = 150;
/** ...and at the top right for its Feedback button. */
export const FEEDBACK = 150;
/** The original buttons at twice their size: 64 game pixels, a comfortable finger. */
export const K = 2;
export const GAP = 6;
/**
 * The upright layout (screen.ts, experimental): the screen is 800 game pixels across there, so the
 * HUD is drawn 4/3 as big to keep the size it has with the phone turned (600 high), and laid out in
 * a 600-wide space: the buttons in one row along the bottom.
 */
export const PORTRAIT_K = 4 / 3;
/** The side of + and −'s small squares (HUD pixels; the target round each is a finger's). */
export const ZOOM_SQUARE = 44;

export type Rgb = [number, number, number];

/** A line of text in a game font, enlarged so it reads on a small screen. */
export function text(value: Text, font: "smalfont" | "medfont" | "bigfont", scale: number, color: Rgb = [...WHITE] as Rgb, align: "left" | "center" = "left", width?: number) {
  const t = new GameText(font, color, align, width ? Math.floor(width / scale) : undefined);
  t.value = value;
  t.scale.set(scale);
  return t;
}

/** A panel of the HUD: the original's brown leather with its bevel (the buttons' art), a little see-through. */
export const backing = (w: number, h: number, alpha = 0.6) => Object.assign(blankButtonNow(Math.round(w), Math.round(h)), { alpha: Math.min(1, 0.35 + alpha) });
