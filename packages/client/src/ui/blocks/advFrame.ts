// The adventure screen's frame (ADVMAP.PCX) as blocks for screens laid out anew on phones (the town): its info box's
// ornate panel (gold filigree corners on the player's colour, leather inside) stretched to any size, and the thin
// gold-and-colour rim round the map, round any picture. The owner, 2026-10-26: "how is the frame done on the desktop? Lots
// of player colour and ornament, not brown brown brown".
import { Container, Sprite, type Texture, TilingSprite } from "pixi.js";
import { loadImagePlayer } from "../kit.ts";
import { ADVMAP, cut as cutPart } from "./windowParts.ts";
import { block } from "./block.ts";

/** ADVMAP's info box (windowParts); its filigree corners 24 square. */
const PANEL = ADVMAP.parts.panel;
const C = 24;
/** ADVMAP's outer rim: 7 pixels of gold, the player's colour and gold. */
const RIM = ADVMAP.parts.rimCorner.w;

const cut = (tex: Texture, x: number, y: number, w: number, h: number) => cutPart(tex, { x, y, w, h });

/** The info box's panel `w` x `h` in the player's colours: its corners as they are, its edges and leather tiled. */
export async function advPanel(w: number, h: number, player: number): Promise<Container> {
  const adv = await loadImagePlayer("advmap.pcx", Math.max(0, player));
  const c = new Container();
  c.label = "panel";
  w = Math.max(2 * C, Math.round(w));
  h = Math.max(2 * C, Math.round(h));
  const { x, y, w: pw, h: ph } = PANEL;
  const mw = pw - 2 * C;
  const mh = ph - 2 * C;
  const tile = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
    if (dw <= 0 || dh <= 0) return;
    const t = new TilingSprite({ texture: cut(adv, sx, sy, sw, sh), width: dw, height: dh });
    t.position.set(dx, dy);
    c.addChild(t);
  };
  tile(x + C, y + C, mw, mh, C, C, w - 2 * C, h - 2 * C);
  tile(x + C, y, mw, C, C, 0, w - 2 * C, C);
  tile(x + C, y + ph - C, mw, C, C, h - C, w - 2 * C, C);
  tile(x, y + C, C, mh, 0, C, C, h - 2 * C);
  tile(x + pw - C, y + C, C, mh, w - C, C, C, h - 2 * C);
  for (const [sx, sy, dx, dy] of [
    [x, y, 0, 0],
    [x + pw - C, y, w - C, 0],
    [x, y + ph - C, 0, h - C],
    [x + pw - C, y + ph - C, w - C, h - C],
  ])
    c.addChild(Object.assign(new Sprite(cut(adv, sx, sy, C, C)), { x: dx, y: dy }));
  return block(c, "advPanel");
}

/** The map's rim round a `w` x `h` box (drawn outside it, `RIM` wide), in the player's colours; takes no taps. */
export async function advRim(w: number, h: number, player: number): Promise<Container> {
  const adv = await loadImagePlayer("advmap.pcx", Math.max(0, player));
  const c = new Container();
  c.label = "rim";
  c.eventMode = "none";
  // (A stretch of ADVMAP's top and left edges, clear of the corner filigree; the bottom and right mirrored, so the
  // outer gold line stays outside.)
  const edge = (horizontal: boolean, dx: number, dy: number, len: number, flip: boolean) => {
    const t = new TilingSprite({ texture: cutPart(adv, horizontal ? ADVMAP.parts.rimAcross : ADVMAP.parts.rimDown), width: horizontal ? len : RIM, height: horizontal ? RIM : len });
    t.position.set(dx, dy);
    if (flip) t.scale.set(horizontal ? 1 : -1, horizontal ? -1 : 1);
    c.addChild(t);
  };
  edge(true, 0, -RIM, w, false);
  edge(true, 0, h + RIM, w, true);
  edge(false, -RIM, 0, h, false);
  edge(false, w + RIM, 0, h, true);
  for (const [dx, dy, fx, fy] of [
    [-RIM, -RIM, 1, 1],
    [w + RIM, -RIM, -1, 1],
    [-RIM, h + RIM, 1, -1],
    [w + RIM, h + RIM, -1, -1],
  ]) {
    const s = new Sprite(cutPart(adv, ADVMAP.parts.rimCorner));
    s.position.set(dx, dy);
    s.scale.set(fx, fy);
    c.addChild(s);
  }
  return block(c, "advRim");
}

advRim.WIDTH = RIM;

/** The minimap's frame (ADVMAP x 601-799, y 0-195): the wide band of the player's colour with gold vines, round a
 * leather inside; its letters (N, E, S, W) sit in each edge's middle. */
const MM = { x: 601, y: 0, w: 199, h: 196, l: 29, t: 26, r: 24, b: 24 };
/** Each edge's stretch from its corner to (not reaching) its letter. */
const RUN = 56;

/**
 * A panel `w` x `h` in the minimap's ornate frame, in the player's colours (2026-10-26: "beautiful, ornamental,
 * with a lot of player colour, like the original desktop's frame"): its corners as they are, each edge the vine from
 * the corner tiled out from both ends (mirrored, so the letters never show), the inside the info box's leather.
 * `k` scales the frame's own pixels (thinner on a crowded screen).
 */
export async function advOrnate(w: number, h: number, player: number, k = 1): Promise<Container> {
  const adv = await loadImagePlayer("advmap.pcx", Math.max(0, player));
  const c = new Container();
  c.label = "panel";
  const { x, y, l, t, r, b } = MM;
  const [L, T, Rr, Bb] = [l, t, r, b].map((v) => Math.round(v * k));
  w = Math.max(L + Rr + 2, Math.round(w));
  h = Math.max(T + Bb + 2, Math.round(h));
  // The inside: the info box's leather.
  const leather = new TilingSprite({ texture: cut(adv, PANEL.x + C, PANEL.y + C, PANEL.w - 2 * C, PANEL.h - 2 * C), width: w - L - Rr + 2, height: h - T - Bb + 2 });
  leather.position.set(L - 1, T - 1);
  c.addChild(leather);
  /** A stretch of the source tiled over [d0, d0 + len) along an edge, from its start or (flipped) from its end. */
  const run = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, flipX: boolean, flipY: boolean) => {
    if (dw <= 0 || dh <= 0) return;
    const s = new TilingSprite({ texture: cut(adv, sx, sy, sw, sh), width: dw / k, height: dh / k });
    s.scale.set(flipX ? -k : k, flipY ? -k : k);
    s.position.set(flipX ? dx + dw : dx, flipY ? dy + dh : dy);
    c.addChild(s);
  };
  const midW = w - L - Rr;
  const midH = h - T - Bb;
  const hw = Math.ceil(midW / 2);
  const hh = Math.ceil(midH / 2);
  // Top and bottom: the vine from the left corner on the left half, the same flipped on the right half.
  run(x + l, y, RUN, t, L, 0, hw, T, false, false);
  run(x + l, y, RUN, t, L + midW - hw, 0, hw, T, true, false);
  run(x + l, y + MM.h - b, RUN, b, L, h - Bb, hw, Bb, false, false);
  run(x + l, y + MM.h - b, RUN, b, L + midW - hw, h - Bb, hw, Bb, true, false);
  // Left and right: the vine down from the top corner, the same flipped up from the bottom.
  run(x, y + t, l, RUN, 0, T, L, hh, false, false);
  run(x, y + t, l, RUN, 0, T + midH - hh, L, hh, false, true);
  run(x + MM.w - r, y + t, r, RUN, w - Rr, T, Rr, hh, false, false);
  run(x + MM.w - r, y + t, r, RUN, w - Rr, T + midH - hh, Rr, hh, false, true);
  for (const [sx, sy, sw, sh, dx, dy] of [
    [x, y, l, t, 0, 0],
    [x + MM.w - r, y, r, t, w - Rr, 0],
    [x, y + MM.h - b, l, b, 0, h - Bb],
    [x + MM.w - r, y + MM.h - b, r, b, w - Rr, h - Bb],
  ])
    c.addChild(Object.assign(new Sprite(cut(adv, sx, sy, sw, sh)), { x: dx, y: dy, scale: { x: k, y: k } }));
  return block(c, "advOrnate");
}

/** The date's plate under the info box (ADVMAP x 617-781, y 581-591): the player's colour, plain, to tile under buttons. */
export async function advPlate(player: number): Promise<Texture> {
  const adv = await loadImagePlayer("advmap.pcx", Math.max(0, player));
  return cut(adv, 617, 581, 165, 11);
}
