// Our own faces for the HotA / HD mod buttons whose art only HotA's installer brings (_HD3_Data): without it the
// buttons stay, drawn here on the original's brown button (IOKAY's leather and rim) with gold symbols in the
// original's manner (2026-11-03: "I want them on the release ... maybe just two arrows, but they need to be
// there"). DefButton asks drawnDef when a DEF is missing; the exchange's quick buttons (TRADE3's) use quickPanel.
//   IRCMA / IRCMI: HotA's Max (three arrows up, growing) and Min (three down) beside the sliders.
//   HD_XCHNG: HD's exchange (two arrows chasing round), the town's two heroes' exchange.
//   The quick exchange: all the army / all the artifacts to one hero (two arrows), or swapped (TRADE3's six buttons).
import { Texture } from "pixi.js";
import { type DefTextures, type FrameTexture, loadDef, textureCanvas } from "../assets.ts";

type Ctx = CanvasRenderingContext2D;
/** What a face draws over the leather: `w` x `h`, pressed (one pixel lower) or greyed. */
type Glyph = (ctx: Ctx, w: number, h: number) => void | Promise<void>;

const GOLD_TOP = "#fff3b0";
const GOLD_MID = "#f0c850";
const GOLD_LOW = "#a87420";
const GREY_TOP = "#d8d0c0";
const GREY_LOW = "#6c6458";
const OUTLINE = "#2a1806";

let leather: Promise<HTMLCanvasElement[] | null> | null = null;
/** IOKAY's frames (up, pressed) as canvases: the brown button's leather and rim. */
function leatherFrames(): Promise<HTMLCanvasElement[] | null> {
  leather ??= loadDef("iokay.def")
    .then((d) => {
      const f = d.get(0) ?? [];
      return f[0] && f[1] ? [textureCanvas(f[0].texture), textureCanvas(f[1].texture)] : null;
    })
    .catch(() => null);
  return leather;
}

/** The brown button `w` x `h` (IOKAY's corners and edges round its plain leather, as kit's blankButton), or a dark box. */
function drawLeather(ctx: Ctx, src: HTMLCanvasElement | undefined, w: number, h: number): void {
  if (!src) {
    ctx.fillStyle = "#3a2614";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#000";
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    return;
  }
  const W = src.width;
  const H = src.height;
  const E = 3;
  // The leather left of the tick, tiled as the face.
  for (let y = E; y < h - E; y += H - 2 * E) for (let x = E; x < w - E; x += 12) ctx.drawImage(src, E, E, 12, H - 2 * E, x, y, Math.min(12, w - E - x), Math.min(H - 2 * E, h - E - y));
  for (let x = E; x < w - E; x += 12) {
    const cw = Math.min(12, w - E - x);
    ctx.drawImage(src, E, 0, cw, E, x, 0, cw, E);
    ctx.drawImage(src, E, H - E, cw, E, x, h - E, cw, E);
  }
  for (let y = E; y < h - E; y += 12) {
    const ch = Math.min(12, h - E - y);
    ctx.drawImage(src, 0, E, E, ch, 0, y, E, ch);
    ctx.drawImage(src, W - E, E, E, ch, w - E, y, E, ch);
  }
  ctx.drawImage(src, 0, 0, E, E, 0, 0, E, E);
  ctx.drawImage(src, W - E, 0, E, E, w - E, 0, E, E);
  ctx.drawImage(src, 0, H - E, E, E, 0, h - E, E, E);
  ctx.drawImage(src, W - E, H - E, E, E, w - E, h - E, E, E);
}

let grey = false;
/** The symbols' fill: the original's bright gold from top to bottom (grey when the button is). */
function gold(ctx: Ctx, y0: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, grey ? GREY_TOP : GOLD_TOP);
  if (!grey) g.addColorStop(0.45, GOLD_MID);
  g.addColorStop(1, grey ? GREY_LOW : GOLD_LOW);
  return g;
}

/** Fills the current path in gold with a dark rim, as the original's symbols. */
function paint(ctx: Ctx, y0: number, y1: number): void {
  ctx.lineJoin = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = gold(ctx, y0, y1);
  ctx.fill();
}

/** A block arrow pointing `dir`, its tip at (x, y): `len` long, the head `head` wide, the shaft `shaft` thick. */
function arrowPath(ctx: Ctx, x: number, y: number, dir: "left" | "right" | "up" | "down", len: number, head: number, shaft: number): void {
  const hl = Math.min(len, head * 0.75);
  // Drawn pointing right, then turned.
  const pts: [number, number][] = [
    [0, 0],
    [-hl, -head / 2],
    [-hl, -shaft / 2],
    [-len, -shaft / 2],
    [-len, shaft / 2],
    [-hl, shaft / 2],
    [-hl, head / 2],
  ];
  const [c, s] = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] }[dir];
  ctx.beginPath();
  pts.forEach(([px, py], i) => {
    const X = x + px * c - py * s;
    const Y = y + px * s + py * c;
    if (i) ctx.lineTo(X, Y);
    else ctx.moveTo(X, Y);
  });
  ctx.closePath();
}

/** A gold arrow (see arrowPath). */
function arrow(ctx: Ctx, x: number, y: number, dir: "left" | "right" | "up" | "down", len: number, head: number, shaft: number): void {
  arrowPath(ctx, x, y, dir, len, head, shaft);
  const vertical = dir === "up" || dir === "down";
  paint(ctx, vertical ? Math.min(y, y + (dir === "up" ? len : -len)) : y - head / 2, vertical ? Math.max(y, y + (dir === "up" ? len : -len)) : y + head / 2);
}

/** Two arrows chasing each other round (HD's exchange and TRADE3's swap), centred at (cx, cy), `r` its radius. */
function chase(ctx: Ctx, cx: number, cy: number, r: number): void {
  const t = Math.max(3, r * 0.42);
  for (const turn of [0, Math.PI]) {
    // An arc of ~140° from the left round over the top, its head at the right end, pointing down.
    const a0 = Math.PI + 0.35 + turn;
    const a1 = 2 * Math.PI - 0.55 + turn;
    const ro = r + t / 2;
    const ri = r - t / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, ro, a0, a1);
    // The head: wider than the band, its tip further round.
    const hx = (rr: number, a: number) => cx + rr * Math.cos(a);
    const hy = (rr: number, a: number) => cy + rr * Math.sin(a);
    ctx.lineTo(hx(ro + t * 0.55, a1), hy(ro + t * 0.55, a1));
    ctx.lineTo(hx(r, a1 + 0.62), hy(r, a1 + 0.62));
    ctx.lineTo(hx(ri - t * 0.55, a1), hy(ri - t * 0.55, a1));
    ctx.arc(cx, cy, ri, a1, a0, true);
    ctx.closePath();
    paint(ctx, cy - r - t, cy + r + t);
  }
}

/** The faces of one drawn button: up, pressed (the symbol a pixel lower on the pressed leather), greyed, up again. */
async function faces(w: number, h: number, glyph: Glyph): Promise<DefTextures> {
  const lf = await leatherFrames();
  const frames: FrameTexture[] = [];
  for (const state of ["up", "down", "off"] as const) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    drawLeather(ctx, lf?.[state === "down" ? 1 : 0], w, h);
    if (state === "down") ctx.translate(1, 1);
    grey = state === "off";
    await glyph(ctx, w, h);
    grey = false;
    const t = Texture.from(c);
    t.source.scaleMode = "nearest";
    frames.push({ texture: t, x: 0, y: 0, fullWidth: w, fullHeight: h });
  }
  frames.push(frames[0]);
  return new Map([[0, frames]]);
}

/** Three arrows side by side, growing from left to right (Max: up) or shrinking (Min: down), as IRCMA / IRCMI. */
const three =
  (dir: "up" | "down"): Glyph =>
  (ctx, w, h) => {
    const sizes = dir === "up" ? [0.45, 0.62, 0.8] : [0.8, 0.62, 0.45];
    sizes.forEach((k, i) => {
      const len = (h - 6) * k;
      const x = w / 2 + (i - 1) * 13;
      const base = h - 4;
      if (dir === "up") arrow(ctx, x, base - len, "up", len, 11, 4);
      else arrow(ctx, x, 4 + len, "down", len, 11, 4);
    });
  };

const DRAWN: Record<string, () => Promise<DefTextures>> = {
  "ircma.def": () => faces(50, 32, three("up")),
  "ircmi.def": () => faces(50, 32, three("down")),
  "hd_xchng.def": () => faces(52, 36, (ctx, w, h) => chase(ctx, w / 2, h / 2, 10)),
};

const drawnCache = new Map<string, Promise<DefTextures | null>>();
/** Our own faces for a HotA / HD button DEF that isn't there (null for any other DEF). */
export function drawnDef(name: string): Promise<DefTextures | null> {
  const key = name.toLowerCase();
  const make = DRAWN[key];
  if (!make) return Promise.resolve(null);
  let p = drawnCache.get(key);
  if (!p) {
    p = make().catch(() => null);
    drawnCache.set(key, p);
  }
  return p;
}

/**
 * One quick-exchange button's symbol: two arrows, one over the other, the way the things go (2026-11-03: "just two
 * arrows"); upright two side by side, down or up; the swap's two arrows chasing round. The row says what moves.
 */
function quickGlyph(ctx: Ctx, w: number, h: number, how: "right" | "left" | "up" | "down" | "swap"): void {
  if (how === "swap") return chase(ctx, w / 2, h / 2, 9);
  if (how === "right" || how === "left") {
    const x = how === "right" ? w / 2 + 11 : w / 2 - 11;
    for (const y of [h / 2 - 7, h / 2 + 7]) arrow(ctx, x, y, how, 22, 12, 5);
  } else {
    const y = how === "down" ? h - 4 : 4;
    for (const x of [w / 2 - 7, w / 2 + 7]) arrow(ctx, x, y, how, h - 8, 12, 5);
  }
}

/** One drawn quick-exchange button's up face as a canvas, 48 x 32. */
async function quickFace(how: "right" | "left" | "up" | "down" | "swap"): Promise<HTMLCanvasElement> {
  const lf = await leatherFrames();
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  drawLeather(ctx, lf?.[0], 48, 32);
  quickGlyph(ctx, 48, 32, how);
  return c;
}

/**
 * TRADE3's quick buttons drawn by us (its picture absent), at its places: `rows` the armies' over the artifacts' (148 x
 * 68), or one row (148 x 32): all to the second hero, swap, all to the first; `upright` turns the arrows down and up.
 */
export async function quickPanel(rows: ("army" | "artifact")[], upright = false): Promise<Texture> {
  const c = document.createElement("canvas");
  c.width = 148;
  c.height = rows.length > 1 ? 68 : 32;
  const ctx = c.getContext("2d")!;
  for (let r = 0; r < rows.length; r++) {
    const hows = upright ? (["down", "swap", "up"] as const) : (["right", "swap", "left"] as const);
    for (const [i, how] of hows.entries()) ctx.drawImage(await quickFace(how), 50 * i, 36 * r);
  }
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  return t;
}
