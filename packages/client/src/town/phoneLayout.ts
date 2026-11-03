// Phones: where the town's picture and its blocks go on each layout (upright, sideways, one-handed; the frame or the
// floating arrangement), as numbers only. Read by the town screen (the picture's place and zoom) and its phone parts.
import { extra } from "../settings.ts";
import { cutoutTop, fingerPx, navBarRight, oneHand, screenSize } from "../ui/screen.ts";
import { ResourceBar } from "../ui/blocks/resourceBar.ts";
import { advRim } from "../ui/blocks/advFrame.ts";

/**
 * Phones: the town's picture is the screen's heart (2026-10-25: the backdrop, its animations and tune, each
 * new building's reveal, the Grail's), so it is always shown whole, never cut and nothing over its buildings. Two
 * arrangements of the same blocks (EXTRAS townFloating picks): a frame round the picture as the desktop's panel
 * (the original's dialog border in the player's colour), or the blocks floating on a dimmed, blurred copy of
 * the picture that fills the rest of the screen.
 */
const PHONE_BAR = 64;
/** Sideways: the bar a finger high and a margin (46 CSS pixels: 75 game pixels on a 412-high phone). */
export function phoneBar() {
  return Math.max(PHONE_BAR, fingerPx() + 8);
}
/** Upright the screen is 800 game pixels across a phone's width: a taller bar keeps its buttons finger-sized. */
export function uprightBar() {
  return Math.max(96, fingerPx() + 16);
}
/** The armies' room: two rows of a hero's place and seven stacks (TWCRPORT 58 x 64, 4 apart), with a margin. */
export const ARMIES_W = 8 * 62 - 4 + 12;
export const ARMIES_H = 2 * 68 - 4 + 12;
/** The frame's armies, sideways: two rows of the hero, the trade or swap button and seven stacks; in the panel's inset. */
export const ARMIES_SIDE_W = 58 + 4 + 44 + 4 + 7 * 62 - 4 + 2 * 14;
export const ARMIES_SIDE_H = 2 * 64 + 6 + 2 * 14;
/** Upright: the garrison hero's line (portrait, name, trade and swap), its seven, the visiting hero's seven, its line (split). */
export const ARMIES_UP_W = 7 * 62 - 4;
export const ARMIES_UP_H = 2 * 32 + 2 * 64 + 3 * 6;
/** Upright in the frame: the creatures' band (a row of 84-high tiles at up to 1.7x, in the panel's 30 a side) and the armies' (as wide as the screen). */
export const UP_ROSTER_H = Math.ceil(84 * 1.7 + 2 * 30);

export type PhoneLayout = ReturnType<typeof phoneLayout>;

export function phoneLayout() {
  const upright = screenSize.portrait;
  const floating = extra("townFloating");
  const css = screenSize.css;
  const barK = Math.min(3, Math.max(1.25, 30 / (ResourceBar.H * css)));
  const bottom = -screenSize.oy + screenSize.h;
  if (upright) {
    // Upright: the resources under the page's own buttons, the picture across the whole width under them, the rest
    // by the thumb at the foot.
    // (Under a camera's band, the name a line below it: the punch hole sat over it, the owner 2026-11-03.)
    const cut = cutoutTop();
    const top = -screenSize.oy + Math.max(Math.ceil(44 / css), cut + Math.ceil(20 / css));
    // (The frame shows all seven resources in two rows, the floating one gold and one more.)
    const picY = top + Math.ceil((floating ? ResourceBar.H : 2 * ResourceBar.H + 2) * (floating ? barK : Math.min(barK, (800 - 16) / (4 * 84 + 4)))) + 8;
    const barY = bottom - Math.ceil(6 / css) - uprightBar();
    // (In the frame the map's rim goes round the picture: it's that much narrower.)
    // (The frame: the picture right at the top, the page's own buttons and the town's name over it: the owner, 2026-10-26.)
    const R = floating ? 0 : advRim.WIDTH;
    // (The frame: the picture in the middle of the screen, nothing over it; above it the town's name between the page's
    // own buttons, the creatures to recruit and the armies; under it the buttons and the foot by the thumb: the owner,
    // 2026-10-26 21:09.)
    // The armies as wide as the screen, unless that leaves the buttons under the picture less than two rows a finger
    // high, the resources and Leave (a short phone, 360 x 649): then smaller, but never under 1.2x.
    const k = (800 - 2 * R) / 800;
    const fullK = (800 - 60) / ARMIES_UP_W;
    const footNeed = 2 * (Math.ceil(44 / css) + 6) + 24 + Math.ceil(40 / css) + 6 + 2 * 30;
    const room = bottom - (top + 4 + UP_ROSTER_H + 2 * 30 + 2 * (R + 2) + 374 * k) - footNeed;
    const upArmiesK = Math.max(1.2, Math.min(fullK, room / ARMIES_UP_H));
    const upArmiesH = Math.ceil(ARMIES_UP_H * upArmiesK + 2 * 30);
    const framedY = top + 4 + UP_ROSTER_H + upArmiesH + R + 2;
    return { upright, floating, barK, safeRight: 800 - 8, left: 8, k, picX: R, picY: floating ? picY : framedY, barY, top, bottom, armiesK: (800 - 16) / ARMIES_W, col: 0, upArmiesK, upArmiesH };
  }
  const safeRight = 800 + screenSize.ox - navBarRight();
  const left = -screenSize.ox + 8;
  const top = -screenSize.oy + 4;
  // The armies a finger's width a place (38 CSS pixels).
  // (44 since 2026-10-30: the frame's band is the armies' alone now, the creatures in the column; The owner's 22:11 note.)
  const want = Math.max(0.75, 44 / (58 * css));
  if (floating) {
    // The bar along the foot, the armies and the creatures in a band along the top, the picture whole between them.
    const barY = 600 + screenSize.oy - phoneBar();
    const band = Math.ceil(ARMIES_H * want) + 8;
    const k = Math.max(0.5, Math.min((safeRight - left) / 800, (barY - top - band - 4) / 374));
    const picX = Math.round(left + (safeRight - left - 800 * k) / 2);
    return { upright, floating, barK, safeRight, left, k, picX, picY: Math.round(top + band + (barY - top - band - 374 * k) / 2), barY, top, bottom, armiesK: want, col: 0, upArmiesK: 0, upArmiesH: 0 };
  }
  // The frame (as the adventure screen's): a column at the thumb's side (the town's name, the resources, the town's
  // buttons, Leave), the picture in its rim over the band of the armies and the creatures to recruit, as big as fits.
  const R = advRim.WIDTH;
  const band = Math.ceil(ARMIES_SIDE_H * want);
  const thumbRight = oneHand() === "right";
  const y0 = -screenSize.oy + R + 2;
  const barY = 600 + screenSize.oy - band;
  // The picture as big as the height allows (the page's own buttons may float over it: the owner, 2026-10-26), with at
  // least the column's least width beside it; the column takes the rest.
  const least = Math.max(170, Math.ceil(130 / css));
  const k = Math.max(0.5, Math.min((safeRight - left - least - 2 * R) / 800, (barY - 2 * R - 4 - y0) / 374));
  const col = Math.floor(safeRight - left - 800 * k - 2 * R);
  const picX = Math.round(thumbRight ? left + R : safeRight - R - 800 * k);
  return { upright, floating, barK, safeRight, left, k, picX, picY: y0, barY, top, bottom, armiesK: want, col, upArmiesK: 0, upArmiesH: 0 };
}

/**
 * How far the page's own buttons along the top (menu, full screen, Feedback; their corners change
 * with one-handed play) reach in from the left and right edges, in CSS pixels.
 */
export function pageCorners(): { left: number; right: number } {
  let left = 96;
  let right = 96;
  // Drawn sideways (a phone held upright) the page's left and right aren't the game's.
  if (screenSize.sideways) return { left, right };
  left = right = 0;
  for (const id of ["menuToggle", "feedback"]) {
    const el = document.getElementById(id);
    if (!el || el.hidden || getComputedStyle(el).display === "none") continue;
    const b = el.getBoundingClientRect();
    // (On a desktop they sit in the page's bar, above the game: nothing to keep clear.)
    if (!b.width || b.top > 120 || b.bottom <= (document.getElementById("stage")?.getBoundingClientRect().top ?? 0)) continue;
    if (b.left + b.width / 2 < innerWidth / 2) left = Math.max(left, b.right);
    else right = Math.max(right, innerWidth - b.left);
  }
  return { left, right };
}
