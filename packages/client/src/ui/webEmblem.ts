// "Remade for the web" under the Heroes III / Horn of the Abyss logo of the main menu and the loading
// screen (an addition, EXTRAS webEmblem; The owner, 2026-10-25): a maker's plate in the original's own gold, the
// scenario screen's BEGIN plate (SCNRBEG, the plain game's, not HotA's) with its carved ends, the words engraved
// into it as BEGIN is, in the title font, and after them the three ways it is played (a desktop, a phone held
// sideways, one held upright) engraved the same way, as little pixel pictures in the game's own size (the owner,
// 2026-10-26: prettier, in the game's style, not basic vector icons).
import { Container, Sprite, Texture } from "pixi.js";
import { textureCanvas } from "../assets.ts";
import { textTexture, YELLOW, loadFont } from "../text.ts";
import { onLayout, screenSize } from "./screen.ts";
import { extra } from "../settings.ts";
import { goldPlate } from "./blocks/windowParts.ts";
import { playSound } from "../audio.ts";

const WORDS = "Remade for the web"; // i18n-ok (the project's subtitle: English in every language, the owner)

// The three pictures, `#` the ink (each gets the fonts' 1-pixel shadow down and right, as the letters do).
const DESKTOP = [
  "##########################",
  "##########################",
  "##......................##",
  "##......................##",
  "##......................##",
  "##......................##",
  "##......................##",
  "##......................##",
  "##......................##",
  "##......................##",
  "##......................##",
  "##......................##",
  "##########################",
  "##########################",
  "...........####...........",
  "...........####...........",
  "......##############......",
  "......##############......",
];
const UPRIGHT = [
  ".##########.",
  "############",
  "###......###",
  "##........##",
  "##........##",
  "##........##",
  "##........##",
  "##........##",
  "##........##",
  "##........##",
  "##........##",
  "##........##",
  "##........##",
  "##........##",
  "##........##",
  "###......###",
  "############",
  "#####..#####",
  "############",
  ".##########.",
];
/** The upright phone turned a quarter (its button at the right, as a phone held sideways in the right hand). */
const SIDEWAYS = UPRIGHT[0].split("").map((_, x) => UPRIGHT.map((row) => row[x]).reverse().join(""));

type Rgb = readonly [number, number, number];
/** The engraving's colours, measured from BEGIN: the cut nearly black, its lit edge pale gold. */
const CUT: Rgb = [16, 10, 0];
const LIT: Rgb = [255, 247, 214];
const SHADOW: Rgb = [0, 0, 0];

/**
 * Draws the words and the pictures into `px` (`w` wide) from `x`, the words' top at `y`, the pictures sitting on
 * the words' line: the ink in `ink`, the shadow in `shade`. Returns where it ends.
 */
function engrave(px: Uint8ClampedArray, w: number, x: number, y: number, ink: Rgb, shade: Rgb, text = WORDS, pictures = true): number {
  const put = (tx: number, ty: number, c: Rgb) => {
    if (tx < 0 || tx >= w || ty < 0 || (ty + 1) * w * 4 > px.length) return;
    const o = (ty * w + tx) * 4;
    [px[o], px[o + 1], px[o + 2], px[o + 3]] = [c[0], c[1], c[2], 255];
  };
  // The words in the title font: its ink one colour, its shadow the other.
  const words = textTexture([text], "bigfont", [255, 255, 255]);
  const tw = words.width;
  if (tw > 1) {
    const d = textureCanvas(words).getContext("2d")!.getImageData(0, 0, tw, words.height).data;
    for (let j = 0; j < words.height; j++)
      for (let i = 0; i < tw; i++) {
        const o = (j * tw + i) * 4;
        if (d[o + 3]) put(x + i, y + j, d[o] > 128 ? ink : shade);
      }
  }
  words.destroy(true);
  if (!pictures) return x + tw;
  // The pictures, their foot on the letters' baseline.
  let at = x + tw + GAP * 2;
  const base = y + BASELINE;
  for (const pic of [DESKTOP, SIDEWAYS, UPRIGHT]) {
    const top = base - pic.length;
    const ink2 = (i: number, j: number) => pic[j]?.[i] === "#";
    for (let j = 0; j <= pic.length; j++)
      for (let i = 0; i <= pic[0].length; i++) {
        if (ink2(i, j)) put(at + i, top + j, ink);
        else if (ink2(i - 1, j - 1)) put(at + i, top + j, shade);
      }
    at += pic[0].length + GAP;
  }
  return at - GAP;
}

/**
 * The remake's own mark, small (the size of the scenario list's format pictures, SCSELC): the emblem's desktop and
 * upright phone side by side in its gold with the fonts' shadow. Stands where the original's mark would say whose a
 * thing is when it is ours, not HotA's or the Shadow of Death's (Game rules: the owner 2026-11-03 "not hota but ours").
 */
export function webMark(): Texture {
  const pics = [DESKTOP, UPRIGHT];
  const gap = 3;
  const h = Math.max(...pics.map((p) => p.length)) + 1;
  const w = pics.reduce((a, p) => a + p[0].length, 0) + gap * (pics.length - 1) + 1;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const put = (x: number, y: number, col: readonly number[]) => {
    const o = (y * w + x) * 4;
    [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]] = [col[0], col[1], col[2], 255];
  };
  let at = 0;
  for (const pic of pics) {
    const top = h - 1 - pic.length;
    const ink = (i: number, j: number) => pic[j]?.[i] === "#";
    for (let j = 0; j <= pic.length; j++)
      for (let i = 0; i <= pic[0].length; i++) {
        if (ink(i, j)) put(at + i, top + j, YELLOW);
        else if (ink(i - 1, j - 1)) put(at + i, top + j, SHADOW);
      }
    at += pic[0].length + gap;
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(c);
}

/** Between the pictures (twice that before them), and the bigfont's baseline under a line's top. */
const GAP = 6;
const BASELINE = 19;

/** The plate's width for the words (and the pictures): its carved ends, and room either side of the engraving. */
function engravingWidth(text = WORDS, pictures = true): number {
  const t = textTexture([text], "bigfont", [255, 255, 255]);
  const tw = t.width;
  t.destroy(true);
  return pictures ? tw + GAP * 2 + DESKTOP[0].length + SIDEWAYS[0].length + UPRIGHT[0].length + GAP * 2 + 1 : tw + 1;
}

/** The emblem's picture: the plate engraved, or (without the original's plate) the engraving alone in gold.
 *  `text` other than the emblem's words: those alone, without the pictures (goldWordButton). */
async function emblemTexture(text = WORDS): Promise<Texture> {
  const pictures = text === WORDS;
  const ew = engravingWidth(text, pictures);
  const END = 29;
  const PAD = 7;
  const plate = await goldPlate(ew + 2 * (END + PAD));
  if (plate) {
    const ctx = plate.getContext("2d")!;
    const img = ctx.getImageData(0, 0, plate.width, plate.height);
    engrave(img.data, plate.width, Math.round((plate.width - ew) / 2), 8, CUT, LIT, text, pictures);
    ctx.putImageData(img, 0, 0);
    return Texture.from(plate);
  }
  const c = document.createElement("canvas");
  c.width = ew + 2;
  c.height = 28;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(c.width, c.height);
  engrave(img.data, c.width, 0, 2, YELLOW, SHADOW, text, pictures);
  ctx.putImageData(img, 0, 0);
  return Texture.from(c);
}

/**
 * A button in the emblem's own make (the About window's "Original game credits", the owner 2026-10-27): the words
 * engraved into SCNRBEG's gold plate, at its own size; held, it sinks a pixel as the original's buttons do.
 */
export async function goldWordButton(text: string, onTap: () => void): Promise<Container> {
  await loadFont("bigfont").catch(() => {});
  const texture = await emblemTexture(text);
  const root = new Container();
  const plate = root.addChild(new Sprite(texture));
  root.on("destroyed", () => texture.destroy(true));
  root.eventMode = "static";
  root.cursor = "pointer";
  root.on("pointerdown", (e) => e.button === 0 && (plate.position.set(1, 1), void playSound("button")));
  const up = () => plate.position.set(0, 0);
  root.on("pointerup", up);
  root.on("pointerupoutside", up);
  root.on("pointertap", (e) => e.button === 0 && onTap());
  return root;
}

/** The emblem's picture kept for the page's splash (index.html), so the first load after this one shows it before
 *  the game's fonts are in (2026-10-27 20:01: "remade for the web already during the initial load"). */
let remembered = false;
function rememberForSplash(texture: Texture) {
  if (remembered) return;
  remembered = true;
  try {
    const canvas = texture.source.resource as HTMLCanvasElement;
    if (canvas?.toDataURL) localStorage.setItem("heroes.splashEmblem", JSON.stringify({ src: canvas.toDataURL("image/png"), w: canvas.width }));
  } catch {
    // (No storage: the splash goes without it.)
  }
}

/**
 * The emblem, centred on `at()`'s x with its top at its y in the 800x600 picture (asked again on a change of layout), put into `parent` once the
 * font is in (nothing when the addition is switched off), no wider than `at()`'s third number times its own size. Kept readable on a phone:
 * scaled so its words are about 9 CSS pixels high, again on a change of layout.
 */
export async function webEmblem(parent: Container, at: () => readonly [number, number, number?], onTap?: () => void): Promise<Container | null> {
  if (!extra("webEmblem")) return null;
  await loadFont("bigfont").catch(() => {});
  const texture = await emblemTexture();
  rememberForSplash(texture);
  if (parent.destroyed) return null;
  const root = new Container();
  root.label = "emblem: remade for the web";
  const plate = new Sprite(texture);
  // (Drawn smaller than the original's pixels: smoothed, as the picture under it.)
  texture.source.scaleMode = "linear";
  plate.position.set(-Math.round(texture.width / 2), 0);
  root.addChild(plate);
  // A tap on it: what this remake is, whose work it stands on (the menu's Credits window).
  if (onTap) {
    root.eventMode = "static";
    root.cursor = "pointer";
    root.on("pointertap", onTap);
  }
  parent.addChild(root);
  // The plate is the BEGIN button's size; under the logo it sits smaller, as a mark on the picture, not a button.
  const SIZE = 0.7;
  // The capitals are about 17 of the plate's pixels high.
  const fit = () => {
    if (root.destroyed) return void queueMicrotask(() => stop());
    const [cx, top, most = Infinity] = at();
    root.scale.set(Math.min(most * SIZE, Math.max(SIZE, 9 / (17 * screenSize.css))));
    root.position.set(Math.round(cx), Math.round(top));
  };
  const stop = onLayout(fit);
  fit();
  return root;
}
