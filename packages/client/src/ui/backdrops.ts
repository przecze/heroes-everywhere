// The main menu's and the loading screen's pictures: HotA's own, its earlier (legacy) menu theme's and
// the original game's, one after another across visits (an addition, EXTRAS backdrops; The owner, 2026-10-25),
// else HotA's own every time. Each knows where its logo is, so the emblem sits under it and a tap on it
// opens About.
import { BlurFilter, Container, Sprite, type Texture } from "pixi.js";
import { decodePcx } from "@heroes/formats";
import { fetchRes, loadImage, loadPng } from "../assets.ts";
import { extra } from "../settings.ts";
import { hotaContentThere } from "../hotaContent.ts";
import { type Cut, GAMSELBK, cut } from "./blocks/windowParts.ts";
import { screenSize } from "./screen.ts";

export interface Backdrop {
  /** A PNG of the HotA mod (by its path), or one of the original's PCX pictures. */
  file: string;
  /** The "Remade for the web" emblem under the logo's last line: its centre and its top. */
  emblem: readonly [number, number];
  /** The logo: x, y, width, height. */
  logo: readonly [number, number, number, number];
  /** Where the menus' names go (the original's place on its own picture); else HotA's. */
  title?: readonly [number, number];
  /** Wordless parts reflected into the bands above and below it (else its own top and bottom edges). */
  plain?: { top?: Cut; bottom?: Cut };
}

export const LOADBAR_PNG = "mods/mainmenu/content/data/loadbar.png";

// (The clouds right of the logo above, the sea right of the dragons below.)
const MENU_PLAIN = { top: GAMSELBK.parts.clouds, bottom: GAMSELBK.parts.sea };
export const MENU_BACKDROPS: readonly Backdrop[] = [
  { file: "mods/mainmenu/content/data/gamselbk.png", emblem: [246, 164], logo: [55, 5, 390, 195], plain: MENU_PLAIN },
  { file: "mods/mainmenu/mods/mainmenulegacy/content/data/gamselbk.png", emblem: [255, 190], logo: [15, 5, 480, 185], plain: MENU_PLAIN },
  { file: "gamselbk.pcx", emblem: [215, 184], logo: [15, 5, 400, 175], title: [114, 312], plain: MENU_PLAIN },
];

// (The clouds left of the logo above, the grass left of the bar below.)
const LOADING_PLAIN = { top: { x: 0, y: 0, w: 110, h: 160 }, bottom: { x: 0, y: 430, w: 330, h: 170 } };
export const LOADING_BACKDROPS: readonly Backdrop[] = [
  { file: LOADBAR_PNG, emblem: [390, 258], logo: [60, 20, 680, 280], plain: LOADING_PLAIN },
  { file: "loadbar.pcx", emblem: [370, 190], logo: [150, 0, 440, 190], plain: LOADING_PLAIN },
];

/**
 * The screen around a full-screen picture that doesn't fit its shape (the main menu, its Load / New Game / campaign
 * menus, the loading screen; every layout: the sides of a wide screen, the bands above and below an upright one): the
 * picture's own edges reflected outward, softened and dimmed, never black bars (2026-10-27 11:25: "consistent
 * every mode"). Add `view` under the picture, in the container the picture is drawn in (placed by `centre`), and call
 * `place` whenever the picture or the layout changes.
 */
export function pictureSurround(): {
  view: Container;
  /**
   * `back`: the whole picture; `shown`: the part of it drawn (back's coordinates), `k` times, its top left at the
   * container's 0, 0; `origin`: where the container sits on the canvas (canvas pixels, as screenSize).
   */
  place(back: Texture, opts: { shown?: Cut; k?: number; plain?: Backdrop["plain"]; origin: { x: number; y: number } }): void;
} {
  const view = new Container();
  view.label = "picture surround";
  // (Soft enough that a word near the edge reads as a smudge, not a word mirrored.)
  view.filters = [new BlurFilter({ strength: 10, quality: 3 })];
  view.alpha = 0.5;
  return {
    view,
    place(back, { shown = { x: 0, y: 0, w: back.width, h: back.height }, k = 1, plain, origin }) {
      view.removeChildren().forEach((c) => c.destroy());
      const pw = shown.w * k;
      const ph = shown.h * k;
      // The canvas in the container's coordinates.
      const cx = -origin.x;
      const cy = -origin.y;
      const gaps = { left: -cx, right: cx + screenSize.w - pw, top: -cy, bottom: cy + screenSize.h - ph };
      // The picture itself under it all, so the softening runs on across the seam instead of fading to black there.
      view.addChild(new Sprite(cut(back, shown))).scale.set(k);
      const band = (c: Cut, x: number, y: number, sx: number, sy: number) => view.addChild(Object.assign(new Sprite(cut(back, c)), { x, y })).scale.set(sx, sy);
      // Above and below: across the whole canvas (the corners too).
      if (gaps.top > 0.5) {
        const c = plain?.top ?? { x: shown.x, y: shown.y, w: shown.w, h: Math.max(1, Math.min(gaps.top / k, shown.h / 3)) };
        band(c, cx, 0, screenSize.w / c.w, -gaps.top / c.h);
      }
      if (gaps.bottom > 0.5) {
        const c = plain?.bottom ?? { x: shown.x, y: shown.y + shown.h - Math.max(1, Math.min(gaps.bottom / k, shown.h / 3)), w: shown.w, h: Math.max(1, Math.min(gaps.bottom / k, shown.h / 3)) };
        band(c, cx, ph + gaps.bottom, screenSize.w / c.w, -gaps.bottom / c.h);
      }
      // Beside it: the edge itself reflected (at most a third of the picture, stretched beyond that).
      if (gaps.left > 0.5) {
        const w = Math.max(1, Math.min(gaps.left / k, shown.w / 3));
        band({ x: shown.x, y: shown.y, w, h: shown.h }, 0, 0, -gaps.left / w, k);
      }
      if (gaps.right > 0.5) {
        const w = Math.max(1, Math.min(gaps.right / k, shown.w / 3));
        band({ x: shown.x + shown.w - w, y: shown.y, w, h: shown.h }, pw + gaps.right, 0, -gaps.right / w, k);
      }
    },
  };
}

const load = (b: Backdrop) => (b.file.endsWith(".png") ? loadPng(b.file) : loadImage(b.file));

const KEY = { menu: "heroes.backdrop.menu", loading: "heroes.backdrop.loading" };
/** The loading picture the page's splash shows (index.html): a /res/ address, or the PCX as a JPEG. */
const SPLASH = "heroes.splashArt";
const SPLASH_EMBLEM = "heroes.splashEmblemAt";

function stored(kind: keyof typeof KEY): number {
  try {
    return Number(localStorage.getItem(KEY[kind]) ?? -1);
  } catch {
    return -1;
  }
}

/** Which of the loading pictures the page's splash shows (by its address; a JPEG is the PCX chosen last). */
export function splashBackdrop(src: string): Backdrop {
  const chosen = LOADING_BACKDROPS[stored("loading")];
  if (src.startsWith("data:") && chosen) return chosen;
  return LOADING_BACKDROPS.find((b) => b.file.endsWith(".png") && src.endsWith(`/res/${encodeURIComponent(b.file)}`)) ?? LOADING_BACKDROPS[0];
}

/**
 * The next picture of the kind (the first with the addition off), skipping one the installation
 * hasn't got; null when none loads. The loading one is remembered for the page's splash.
 */
export async function nextBackdrop(kind: keyof typeof KEY): Promise<[Backdrop, Texture] | null> {
  const list = kind === "menu" ? MENU_BACKDROPS : LOADING_BACKDROPS;
  // (HotA's files gone from the server: its pictures this browser kept from before go first, hotaContent.ts.)
  await hotaContentThere();
  const turn = extra("backdrops");
  const start = turn ? (stored(kind) + 1 + list.length) % list.length : 0;
  for (let n = 0; n < list.length; n++) {
    const i = (start + n) % list.length;
    const t = await load(list[i]).catch(() => null);
    if (!t) continue;
    if (turn) {
      try {
        localStorage.setItem(KEY[kind], String(i));
      } catch {
        // (No storage: the same picture each time.)
      }
    }
    if (kind === "loading") await forSplash(list[i]);
    return [list[i], t];
  }
  return null;
}

/**
 * This page's loading picture: chosen once (the main menu chooses it ahead, while it's up), so the menu's
 * loading screen and the game page's after it (in place, EXTRAS pageSwap) are the same picture; the next
 * one on the next visit.
 */
let chosen: Promise<[Backdrop, Texture] | null> | null = null;
export function prepareLoading() {
  chosen ??= nextBackdrop("loading");
}
export function takeLoading(): Promise<[Backdrop, Texture] | null> {
  return (chosen ??= nextBackdrop("loading"));
}

/** The splash after the page's reload shows the same picture (an <img>: a PCX goes as a JPEG). */
async function forSplash(b: Backdrop) {
  try {
    // Where the "Remade for the web" emblem sits on it, for the splash's copy of the emblem (webEmblem.ts, index.html).
    localStorage.setItem(SPLASH_EMBLEM, JSON.stringify(b.emblem));
    if (b === LOADING_BACKDROPS[0]) return localStorage.removeItem(SPLASH);
    if (b.file.endsWith(".png")) return localStorage.setItem(SPLASH, `/res/${encodeURIComponent(b.file)}`);
    const img = decodePcx(await fetchRes(b.file));
    const c = document.createElement("canvas");
    Object.assign(c, { width: img.width, height: img.height });
    c.getContext("2d")!.putImageData(new ImageData(img.rgba as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
    localStorage.setItem(SPLASH, c.toDataURL("image/jpeg", 0.8));
  } catch {
    // (No storage, or full: the splash shows HotA's picture.)
    try {
      localStorage.removeItem(SPLASH);
    } catch {
      // (None at all.)
    }
  }
}
