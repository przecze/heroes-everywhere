// Every pop-up is placed through here (2026-10-27: "never show a pop-up in a location where it won't be on the
// screen fully"): whole on the screen, clear of Android's navigation bar (a phone held sideways) and of the page's own
// ☰ and Feedback, beside the floating piece it comes from or centred on the point held. The geometry is popupBox.ts;
// client/test/sharedPieces.test.ts keeps the hand-made clamps from coming back.
import { type Container, Matrix } from "pixi.js";
import { navBarRight, pageButtonBoxes, screenSize } from "../screen.ts";
import { extra } from "../../settings.ts";
import { type Box, type Side, placeBox } from "./popupBox.ts";

/** The screen a pop-up may take, in canvas pixels: a few pixels in from the edges, the navigation bar's strip left out. */
export function popupRoom(): Box {
  const M = 4;
  const right = screenSize.touch && !screenSize.portrait ? navBarRight() : 0;
  return { x: M, y: M, w: screenSize.w - 2 * M - right, h: screenSize.h - 2 * M };
}

/**
 * A phone screen's rounded corners (canvas pixels): a square at each corner that a floating widget keeps out of. A
 * phone's corner arc, some 40 CSS pixels round, cuts a box pushed into the corner by up to 12 (2026-10-30
 * 19:20: "the bottom left widget slightly hidden behind the corner"). None on a mouse's screen.
 */
export function roundCorners(): Box[] {
  if (!screenSize.touch) return [];
  const r = Math.ceil(12 / screenSize.css);
  const right = !screenSize.portrait ? navBarRight() : 0;
  const W = screenSize.w - right;
  const H = screenSize.h;
  return [
    { x: 0, y: 0, w: r, h: r },
    { x: W - r, y: 0, w: r, h: r },
    { x: 0, y: H - r, w: r, h: r },
    { x: W - r, y: H - r, w: r, h: r },
  ];
}

/** A container's box on the canvas (its bounds in the stage's pixels: the stage isn't scaled). */
export function canvasBox(c: Container): Box {
  const b = c.getBounds();
  return { x: b.minX, y: b.minY, w: b.width, h: b.height };
}

export interface PopupAt {
  /** The floating piece (or its canvas box) it comes from: beside it. */
  from?: Container | Box;
  /** Or the canvas point it is centred on. */
  at?: { x: number; y: number };
  sides?: Side[];
  gap?: number;
}

/**
 * Puts `popup` (scaled as it should be, in its parent or about to be added to the stage) wholly on the screen by the
 * rule above, shrinking it when even whole it is bigger than the screen. Its parent may be scaled or moved (the map
 * HUD's): the place is worked out on the canvas and set in the parent's pixels.
 */
export function placePopup(popup: Container, o: PopupAt = {}): void {
  const parent = popup.parent;
  // Its own size on the canvas: its local box through its scale and its parent's.
  const lb = popup.getLocalBounds();
  const ps = parent ? parent.getGlobalTransform(new Matrix(), false) : null;
  const sx = popup.scale.x * (ps ? Math.hypot(ps.a, ps.b) : 1);
  const sy = popup.scale.y * (ps ? Math.hypot(ps.c, ps.d) : 1);
  const w = lb.width * sx;
  const h = lb.height * sy;
  if (!w || !h) return;
  let from = o.from && "getBounds" in o.from ? canvasBox(o.from) : (o.from as Box | undefined);
  let sides = o.sides;
  // A finger's point (EXTRAS holdStays): beside the fingertip, above it first (the hand is below), never under it
  // (2026-11-03: a held stack's pop-up came up under his thumb).
  if (!from && o.at && screenSize.touch && extra("holdStays")) {
    const r = Math.round(36 / screenSize.css);
    from = { x: o.at.x - r, y: o.at.y - r, w: 2 * r, h: 2 * r };
    sides ??= ["above", "left", "right", "below"];
  }
  const p = placeBox(w, h, popupRoom(), { from, at: from ? undefined : o.at, sides, gap: o.gap, avoid: pageButtonBoxes() });
  if (p.k < 1) popup.scale.set(popup.scale.x * p.k, popup.scale.y * p.k);
  // The top left on the canvas, less its own box's offset, in the parent's pixels.
  const gx = p.x - lb.minX * sx * p.k;
  const gy = p.y - lb.minY * sy * p.k;
  const local = parent ? parent.toLocal({ x: gx, y: gy }) : { x: gx, y: gy };
  popup.position.set(Math.round(local.x), Math.round(local.y));
}
