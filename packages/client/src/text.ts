import { type BitmapFont, breakText, CYRILLIC, CYRILLIC_AT, decodeFnt as decodeFnt0, type Glyph, glyphIndex, measureText, useCyrillicFont, useReleaseFont } from "@heroes/formats";
export { formatMetric } from "@heroes/formats";
import { type Container, type DestroyOptions, Sprite, Texture } from "pixi.js";
import { fetchRes } from "./assets.ts";
import { type Lang, lang, retranslate, type Text, said } from "./i18n/index.ts";
import { asDrawn } from "./i18n/text.ts";

/** The four interface fonts (loaded together), the credits' own (CREDITS.FNT) and the score screen's (HISCORE.FNT), loaded by `loadFont`. */
export type FontName = "tiny" | "smalfont" | "medfont" | "bigfont" | "credits" | "hiscore";

// Interface text colours from the original (VCMI's Colors::WHITE and Colors::YELLOW): its "white" is
// a warm off-white, its highlight a pale gold. Pure white text is not the original's.
export const WHITE = [255, 243, 222] as const;
/** The same off-white (older name). */
export const GOLD = WHITE;
export const YELLOW = [229, 215, 123] as const;


/**
 * Russian and Ukrainian letters for a bitmap font: a system serif fitted to the font's capital H (same
 * height, same baseline), ink 255 with the game's 1-pixel shadow. Stand-ins where the Russian release's fonts
 * (withReleaseLetters) have none of the font's size or aren't served; every other language uses the game's glyphs.
 */
function decodeFnt(bytes: Uint8Array): BitmapFont {
  const font = decodeFnt0(bytes);
  if (typeof document === "undefined") return font;
  const h = font.glyphs[0x48];
  let top = font.height;
  let bottom = 0;
  for (let y = 0; y < font.height; y++) for (let x = 0; x < h.width; x++) if (h.pixels[y * h.width + x] === 255) {
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const capH = Math.max(4, bottom - top + 1);
  const px = Math.round(capH / 0.68);
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const face = `bold ${px}px "Times New Roman", "DejaVu Serif", serif`;
  ctx.font = face;
  const n = font.glyphs[0x6e];
  for (let i = 0; i < CYRILLIC.length; i++) {
    const ch = CYRILLIC[i];
    const adv = Math.max(2, Math.ceil(ctx.measureText(ch).width));
    const w = adv + 1;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = font.height;
    const g2 = c.getContext("2d", { willReadFrequently: true })!;
    g2.font = face;
    g2.textBaseline = "alphabetic";
    g2.fillStyle = "#000";
    g2.fillText(ch, 0, bottom);
    const data = g2.getImageData(0, 0, w, font.height).data;
    const pixels = new Uint8Array(w * font.height);
    for (let y = 0; y < font.height; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 120) pixels[y * w + x] = 255;
    for (let y = font.height - 1; y > 0; y--) for (let x = w - 1; x > 0; x--) if (pixels[y * w + x] === 0 && pixels[(y - 1) * w + x - 1] === 255) pixels[y * w + x] = 1;
    const glyph: Glyph = { left: n.left, width: w, right: n.right, pixels };
    font.glyphs[CYRILLIC_AT + i] = glyph;
  }
  return font;
}

/** The Russian release's fonts (l10nArt.ts, /l10n/ru/fonts/) that draw each of ours' Cyrillic letters: the ones with
 *  capitals as tall (HotA's fonts are bigger than the Russian release's, so its bigfont draws our medfont). */
const CYRILLIC_FROM: Partial<Record<FontName, string>> = { tiny: "tiny", smalfont: "smalfont", medfont: "bigfont", credits: "credits" };

/** In Polish the translation pack's own letters (the Polish release's fonts, l10nArt.ts) where its font is the same as ours;
 *  in Russian the Russian release's Cyrillic letters, where it has a font of our size. Never in Ukrainian (2026-10-28:
 *  nothing Russian is shown in Ukrainian): its letters stay the system serif's. */
async function withReleaseLetters(name: FontName, font: BitmapFont): Promise<BitmapFont> {
  const l = lang();
  const file = l === "pl" ? `/l10n/pl/fonts/${name}.fnt` : l === "ru" && CYRILLIC_FROM[name] ? `/l10n/ru/fonts/${CYRILLIC_FROM[name]}.fnt` : undefined;
  if (!file) return font;
  try {
    const res = await fetch(file);
    if (!res.ok || res.headers.get("content-type")?.startsWith("text/html")) return font;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (l === "pl") useReleaseFont(font, bytes);
    else useCyrillicFont(font, bytes);
  } catch {
    // Without the pack the letters made from the game's glyphs (or a system serif) stay.
  }
  return font;
}

const fonts = new Map<FontName, BitmapFont>();
let fontsLoading: Promise<void> | undefined;
/** Texts made before their font arrived: drawn again once it has. */
const waiting = new Set<GameText>();
/**
 * Where the texts made before their fonts were made (dev only): such a text has no size until the font
 * comes, so a layout measured from it is wrong (the Continue card, 2026-10-27). Probes read
 * `window.__textsBeforeFonts`; the console names the builders once the fonts are in.
 */
const early: string[] = [];

/** Fonts must be loaded once before drawing text (later calls wait for the same load). */
export function loadFonts(): Promise<void> {
  fontsLoading ??= Promise.all(
    (["tiny", "smalfont", "medfont", "bigfont"] as FontName[]).map(async (n) => {
      fonts.set(n, await withReleaseLetters(n, decodeFnt(await fetchRes(`${n}.fnt`))));
    }),
  ).then(
    () => {
      for (const t of waiting) t.redraw();
      waiting.clear();
      if (early.length) console.warn(`${early.length} text(s) made before the fonts came, laid out without a size:\n${[...new Set(early)].slice(0, 8).join("\n")}`);
    },
    (e) => {
      fontsLoading = undefined;
      throw e;
    },
  );
  return fontsLoading;
}

/**
 * Runs `place` now, and again once the fonts are in when they aren't yet: for a layout measured from its
 * texts' sizes (a text has none before its font comes).
 */
export function placeByText(place: () => void): void {
  place();
  if (!fontsReady()) void loadFonts().then(place, () => {});
}

/** True once the interface's fonts are in. */
export function fontsReady(): boolean {
  return (["tiny", "smalfont", "medfont", "bigfont"] as FontName[]).every((n) => fonts.has(n));
}

/** A font the interface doesn't load up front (the credits'). */
export async function loadFont(name: FontName): Promise<void> {
  if (!fonts.has(name)) fonts.set(name, await withReleaseLetters(name, decodeFnt(await fetchRes(`${name}.fnt`))));
}

type Rgb = readonly [number, number, number];

/** Renders lines of text with an original game font into a texture; wraps when a width is given (cut to `maxLines`, ending "..."). */
export function textTexture(rawLines: string[], font: FontName, color: Rgb = WHITE, align: "left" | "center" = "left", width?: number, maxLines?: number): Texture {
  const f = fonts.get(font);
  if (!f) return Texture.EMPTY;
  let lines = width ? rawLines.flatMap((l) => breakText(f, l, width)) : rawLines;
  if (maxLines && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last && width && measureText(f, `${last}...`) > width) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}...`;
  }
  const w = Math.max(1, width ?? Math.max(...lines.map((l) => measureText(f, l))));
  const h = Math.max(1, lines.length * f.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  // Text in {braces} is highlighted in yellow, as the original game does with titles and names.
  let lit = false;
  lines.forEach((line, row) => {
    // Centred as VCMI's renderTextCenter: the line's half width (rounded down) left of the box's middle.
    let x = align === "center" ? Math.floor(w / 2) - Math.floor(measureText(f, line) / 2) : 0;
    for (const ch of line) {
      if (ch === "{" || ch === "}") {
        lit = ch === "{";
        continue;
      }
      const c = lit ? YELLOW : color;
      const g = f.glyphs[glyphIndex(ch)];
      x += g.left;
      for (let py = 0; py < f.height; py++) {
        for (let px = 0; px < g.width; px++) {
          const v = g.pixels[py * g.width + px];
          const tx = x + px;
          const ty = row * f.height + py;
          if (!v || tx < 0 || tx >= w) continue;
          const o = (ty * w + tx) * 4;
          if (v === 1) {
            img.data[o + 3] = 255; // shadow: black
          } else {
            img.data[o] = c[0];
            img.data[o + 1] = c[1];
            img.data[o + 2] = c[2];
            img.data[o + 3] = 255;
          }
        }
      }
      x += g.width + g.right;
    }
  });
  ctx.putImageData(img, 0, 0);
  return Texture.from(canvas);
}

/** Every text under `root` that is one of ours, in the interface's language now (it was drawn in `from`). */
export function retranslateTexts(root: Container, from: Lang) {
  for (const c of root.children) {
    if (c instanceof GameText) c.value = retranslate(c.value, from);
    else if (!c.destroyed) retranslateTexts(c, from);
  }
}

/** Sprite whose text can be swapped; old textures are released. */
/** The most a fitted line is squeezed sideways (fit()): past it, cut short. */
const SQUEEZE_MOST = 0.75;

export class GameText extends Sprite {
  private current = "";
  private readonly font: FontName;
  private readonly color: Rgb;
  private readonly align: "left" | "center";
  private readonly boxWidth?: number;
  /** At most this many lines (the rest cut, "..."): a status bar's one. */
  maxLines?: number;
  /** The point centreOn keeps the text's middle on. */
  private centre?: { x: number; y: number };
  /** The width fit() keeps the text within, also when it is drawn again (its font in later, a new value). */
  private fitTo?: number;
  /** The box width the text is centred in through its pivot (bigText's `center`), kept the same way. */
  private centreWidth?: number;

  constructor(font: FontName, color: Rgb = WHITE, align: "left" | "center" = "left", boxWidth?: number) {
    super(Texture.EMPTY);
    this.font = font;
    this.color = color;
    this.align = align;
    this.boxWidth = boxWidth;
    // Taken out with a parent that is being destroyed without its children (a plain destroy()): nobody can show it
    // again, so it goes too, with its picture (2026-11-01: the route's end label leaked a texture each
    // time the route was drawn, thousands a minute, till the graphics ran out).
    this.on("removed", (from: Container) => {
      if (from?.destroyed) queueMicrotask(() => !this.parent && !this.destroyed && this.destroy());
    });
  }

  /** The text's picture is its own (drawn for it alone): it goes with the text. */
  override destroy(options?: DestroyOptions) {
    if (this.destroyed) return;
    const own = this.texture;
    super.destroy(options);
    if (own && own !== Texture.EMPTY && !own.destroyed) own.destroy(true);
  }

  get fontName(): FontName {
    return this.font;
  }
  /** One line's height in the font's own pixels (0 before the font is in). */
  get lineHeight(): number {
    return fonts.get(this.font)?.height ?? 0;
  }

  /** What it says: only a `Text` (i18n/text.ts), so no bare English reaches the screen. */
  set value(text: Text) {
    // (The last check: English handed on as data and vouched for is drawn in the language's words, and noted.)
    text = asDrawn(text);
    if (text === this.current) return;
    this.current = text;
    this.redraw();
  }

  /** Draws the text again (made before its font loaded). */
  redraw() {
    if (this.destroyed) return;
    if (!fonts.has(this.font)) {
      if (import.meta.env?.DEV && !waiting.has(this)) {
        early.push(`"${this.current.slice(0, 30)}" ${new Error().stack?.split("\n").find((l, i) => i > 2 && !/text\.ts|kit\.ts|mobilePage\.ts/.test(l))?.trim() ?? ""}`);
        (globalThis as { __textsBeforeFonts?: string[] }).__textsBeforeFonts = early;
      }
      waiting.add(this);
      return;
    }
    const old = this.texture;
    this.texture = this.shortened(textTexture(this.current.split("\n"), this.font, this.color, this.align, this.boxWidth, this.maxLines));
    if (old !== Texture.EMPTY) old.destroy(true);
    this.refit();
    if (this.centre) this.centreOn(this.centre.x, this.centre.y);
  }

  /**
   * fit(): a line squeezed past SQUEEZE_MOST would come out with letters too thin to read (the Continue card's line,
   * half as wide: the owner's note 2026-10-29 20:05), so it is cut short with "..." instead, at the most squeeze.
   */
  private shortened(t: Texture): Texture {
    const room = this.fitTo === undefined ? 0 : this.fitTo / (this.scale.y * SQUEEZE_MOST);
    if (!room || t.width <= room || this.current.includes("\n") || this.current.length < 4) return t;
    const draw = (n: number) => textTexture([this.current.slice(0, n).trimEnd() + "..."], this.font, this.color, this.align, this.boxWidth, this.maxLines);
    let lo = 1;
    let hi = this.current.length - 1;
    let best = draw(lo);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const m = draw(mid);
      if (m.width <= room) (best.destroy(true), (best = m), (lo = mid));
      else (m.destroy(true), (hi = mid - 1));
    }
    t.destroy(true);
    return best;
  }

  /** The fit and the centring again, for the texture drawn now. */
  private refit() {
    if (this.fitTo !== undefined) this.scale.x = this.texture.width * this.scale.y > this.fitTo ? this.fitTo / this.texture.width : this.scale.y;
    if (this.centreWidth !== undefined) this.pivot.x = -Math.round((this.centreWidth - this.width) / 2) / this.scale.x;
  }

  /**
   * True while the text waits for its font: it has no size yet, so anything laid out from its width or
   * height now is laid out wrong (the Continue card's lines on the main menu, 2026-10-27). Builders that
   * place by a text's size wait for loadFonts() first; fit() and centreIn() are kept either way.
   */
  get pending(): boolean {
    return this.texture === Texture.EMPTY && this.current !== "" && !fonts.has(this.font);
  }

  /**
   * Puts the text's middle on (cx, cy) as VCMI's CENTER-aligned CLabel does (renderTextCenter: half the
   * line's width and height, rounded down, left of and above the point), on whole pixels so the font's
   * pixels stay its own. A box label (made with a width) centres in its box, so the box goes there.
   * Kept when the text changes.
   */
  centreOn(cx: number, cy: number): this {
    this.centre = { x: cx, y: cy };
    if (this.texture === Texture.EMPTY) return this;
    this.position.set(Math.round(cx) - Math.floor(this.width / 2), Math.round(cy) - Math.floor(this.height / 2));
    return this;
  }

  get value(): Text {
    return this.current as Text;
  }

  /**
   * Squeezes the text sideways when it is wider than `w` (long names in fixed boxes), at the text's own
   * scale (its height's); kept when the text is drawn again.
   */
  fit(w: number): this {
    const was = this.fitTo;
    this.fitTo = w;
    // (Drawn again when the room changed: a line too long for it is cut short, shortened().)
    if (was !== w && this.texture !== Texture.EMPTY && this.texture.width * this.scale.y * SQUEEZE_MOST > w) {
      const cur = said(this.current);
      this.current = "";
      this.value = cur;
    }
    this.refit();
    return this;
  }

  /** Centres the text in a box `w` wide starting at its x (through the pivot); kept when it is drawn again. */
  centreIn(w: number): this {
    this.centreWidth = w;
    this.refit();
    return this;
  }
}

/** The original's text tables, row by row (in formats, so the rules read them the same way). */
export { legacyRows } from "@heroes/formats";
