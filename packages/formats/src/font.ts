import { Reader } from "./reader.ts";

export interface Glyph {
  /** Pixels before / after the bitmap; leftOffset may be negative. */
  left: number;
  width: number;
  right: number;
  /** width x height, 0 = transparent, 1 = shadow, 255 = ink. */
  pixels: Uint8Array;
}

export interface BitmapFont {
  height: number;
  glyphs: Glyph[];
}

const METRICS_AT = 32;
const OFFSETS_AT = METRICS_AT + 256 * 12;
const PIXELS_AT = OFFSETS_AT + 256 * 4;

/** The game's .fnt bitmap fonts: 32-byte header (height at byte 5), 256 glyphs. */
export function decodeFnt(bytes: Uint8Array, synthesize = true): BitmapFont {
  const r = new Reader(bytes);
  const height = bytes[5];
  const glyphs: Glyph[] = [];
  for (let c = 0; c < 256; c++) {
    r.pos = METRICS_AT + c * 12;
    const left = r.i32();
    const width = r.i32();
    const right = r.i32();
    r.pos = OFFSETS_AT + c * 4;
    const start = PIXELS_AT + r.u32();
    glyphs.push({ left, width, right, pixels: bytes.subarray(start, start + width * height) });
  }
  if (synthesize) addPolish(glyphs, height);
  for (let i = 0; i < CYRILLIC.length; i++) glyphs[CYRILLIC_AT + i] = glyphs[0x3f];
  return { height, glyphs };
}

/** Unicode punctuation -> Windows-1252 byte, which is how glyphs are indexed. */
export const CP1252: Record<string, number> = { "–": 0x96, "—": 0x97, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95 };

/**
 * Polish letters the game's (Western, cp1252) fonts don't have: put together from the font's own
 * glyphs (Polish installs bring their own fonts; these are for the interface's Polish texts):
 * an acute (é less e, É less E) over c n s z, a cedilla (ç less c) turned into an ogonek under a e,
 * the dot of i over z, a stroke through l. Indexed after the 256 (see `glyphIndex`).
 */
export const POLISH = "ąćęłńśźżĄĆĘŁŃŚŹŻ";
const POLISH_AT = 256;

/**
 * Russian and Ukrainian letters: the Western fonts have none, so they start as the "?" glyph and the
 * client draws them (text.ts `addCyrillic`) from a system font fitted to the font's capital height,
 * until a Russian install's own fonts (cp1251) are served.
 */
export const CYRILLIC = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяЄІЇҐєіїґ";
export const CYRILLIC_AT = POLISH_AT + POLISH.length;

/** The Polish letters' bytes in the Polish release's fonts (Windows-1250). */
const CP1250: Record<string, number> = { ą: 0xb9, ć: 0xe6, ę: 0xea, ł: 0xb3, ń: 0xf1, ś: 0x9c, ź: 0x9f, ż: 0xbf, Ą: 0xa5, Ć: 0xc6, Ę: 0xca, Ł: 0xa3, Ń: 0xd1, Ś: 0x8c, Ź: 0x8f, Ż: 0xaf };

/**
 * The Polish release's own font (the translation pack's .fnt) over ours: its drawing of the Polish
 * letters (cp1250 slots) in place of the ones made from the Western glyphs. Only where it is the same
 * font (HotA's medfont and bigfont are bigger than the original's the pack carries): the same height
 * and a capital H of the same size.
 */
export function useReleaseFont(font: BitmapFont, pack: Uint8Array): void {
  const from = decodeFnt(pack, false);
  const h = (f: BitmapFont) => f.glyphs[0x48];
  if (from.height !== font.height || h(from).width !== h(font).width || h(from).pixels.join() !== h(font).pixels.join()) return;
  for (const ch of POLISH) {
    const g = from.glyphs[CP1250[ch]];
    if (g && g.width > 0 && g.pixels.some((v) => v === 255)) font.glyphs[POLISH_AT + POLISH.indexOf(ch)] = g;
  }
}

/** The rows a font's capital H has ink in: its cap top and baseline. */
function capRows(font: BitmapFont): [number, number] {
  const h = font.glyphs[0x48];
  let top = font.height;
  let bottom = -1;
  for (let y = 0; y < font.height; y++) for (let x = 0; x < h.width; x++) if (h.pixels[y * h.width + x] === 255) (top = Math.min(top, y)), (bottom = Math.max(bottom, y));
  return [top, bottom];
}

/** The Cyrillic letters' bytes in a Russian release's fonts (Windows-1251). */
let cp1251: Map<string, number> | undefined;

/**
 * A Russian release's font (cp1251) as the drawing of our font's Cyrillic letters: only when its capitals are as
 * tall as ours (the Russian release's fonts are smaller than HotA's, so its bigfont draws our medfont's), each
 * letter moved onto our baseline. A letter it lacks (Ukrainian's Є І Ї Ґ in some) keeps the one we had.
 * True when it was used.
 */
export function useCyrillicFont(font: BitmapFont, release: Uint8Array): boolean {
  const from = decodeFnt(release, false);
  const [top, base] = capRows(font);
  const [fromTop, fromBase] = capRows(from);
  if (base < 0 || fromBase < 0 || base - top !== fromBase - fromTop) return false;
  const shift = base - fromBase;
  if (!cp1251) {
    const dec = new TextDecoder("windows-1251");
    cp1251 = new Map(Array.from({ length: 128 }, (_, i) => [dec.decode(Uint8Array.of(0x80 + i)), 0x80 + i] as [string, number]));
  }
  for (let i = 0; i < CYRILLIC.length; i++) {
    const g = from.glyphs[cp1251.get(CYRILLIC[i]) ?? -1];
    if (!g || g.width <= 0 || !g.pixels.some((v) => v === 255)) continue;
    const pixels = new Uint8Array(g.width * font.height);
    for (let y = 0; y < from.height; y++) {
      const to = y + shift;
      if (to >= 0 && to < font.height) pixels.set(g.pixels.subarray(y * g.width, (y + 1) * g.width), to * g.width);
    }
    font.glyphs[CYRILLIC_AT + i] = { left: g.left, width: g.width, right: g.right, pixels };
  }
  return true;
}

function addPolish(glyphs: Glyph[], height: number) {
  const g = (ch: string) => glyphs[ch.charCodeAt(0)];
  const at = (x: Glyph, px: number, py: number) => (px >= 0 && px < x.width && py >= 0 && py < height ? x.pixels[py * x.width + px] : 0);
  const rows = (x: Glyph) => {
    const ink: number[] = [];
    for (let y = 0; y < height; y++) for (let px = 0; px < x.width; px++) if (at(x, px, y) === 255) ink.push(y);
    return ink.length ? { top: Math.min(...ink), bottom: Math.max(...ink) } : { top: 0, bottom: height - 1 };
  };
  const cols = (x: Glyph, y0 = 0, y1 = height - 1) => {
    const ink: number[] = [];
    for (let y = y0; y <= y1; y++) for (let px = 0; px < x.width; px++) if (at(x, px, y)) ink.push(px);
    return ink.length ? { left: Math.min(...ink), right: Math.max(...ink) } : { left: 0, right: x.width - 1 };
  };
  /** What `marked` has that `plain` lacks, above (or below) the plain letter's ink. */
  const mark = (marked: Glyph, plain: Glyph, above: boolean) => {
    const r = rows(plain);
    const pts: [number, number, number][] = [];
    for (let y = 0; y < height; y++) {
      if (above ? y >= r.top : y <= r.bottom) continue;
      for (let px = 0; px < marked.width; px++) {
        const v = at(marked, px, y);
        if (v && !at(plain, px, y)) pts.push([px, y, v]);
      }
    }
    return pts;
  };
  /** `base` with `pts` laid on it, moved by dx (the glyph widened where they stick out). */
  const compose = (base: Glyph, parts: [number, number, number][][]): Glyph => {
    let minX = 0;
    let maxX = base.width - 1;
    for (const pts of parts) for (const [px] of pts) ((minX = Math.min(minX, px)), (maxX = Math.max(maxX, px)));
    const width = maxX - minX + 1;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let px = 0; px < base.width; px++) pixels[y * width + px - minX] = at(base, px, y);
    for (const pts of parts) for (const [px, y, v] of pts) if (pixels[y * width + px - minX] !== 255) pixels[y * width + px - minX] = v;
    return { left: base.left + minX, width, right: Math.max(0, base.right - (maxX - (base.width - 1))), pixels };
  };
  const shift = (pts: [number, number, number][], dx: number, dy = 0) => pts.map(([x, y, v]) => [x + dx, y + dy, v] as [number, number, number]);
  const centreOn = (pts: [number, number, number][], base: Glyph, nudge = 0) => {
    if (!pts.length) return pts;
    const xs = pts.map((p) => p[0]);
    const c = cols(base);
    return shift(pts, Math.round((c.left + c.right) / 2 - (Math.min(...xs) + Math.max(...xs)) / 2) + nudge);
  };
  // Some fonts' lowercase Western letters are missing (BIGFONT: garbage boxes): made again from the
  // capital's mark, lowered onto the small letter (ß as two s).
  const broken = (ch: string, base: string) => g(ch).width > g(base).width * 1.4 + 2 || g(ch).width === 0;
  const lower = (pts: [number, number, number][], base: Glyph) => {
    if (!pts.length) return pts;
    const ys = pts.map((p) => p[1]);
    return centreOn(shift(pts, 0, rows(base).top - 2 - Math.max(...ys)), base);
  };
  for (const [ch, base, upper, upperBase] of [
    ["á", "a", "Á", "A"], ["à", "a", "À", "A"], ["â", "a", "Â", "A"], ["ä", "a", "Ä", "A"], ["é", "e", "É", "E"], ["è", "e", "È", "E"], ["ê", "e", "Ê", "E"], ["ë", "e", "Ë", "E"],
    ["ó", "o", "Ó", "O"], ["ò", "o", "Ò", "O"], ["ô", "o", "Ô", "O"], ["ö", "o", "Ö", "O"], ["ú", "u", "Ú", "U"], ["ù", "u", "Ù", "U"], ["û", "u", "Û", "U"], ["ü", "u", "Ü", "U"], ["ñ", "n", "Ñ", "N"],
  ]) {
    if (broken(ch, base)) glyphs[ch.charCodeAt(0)] = compose(g(base), [lower(mark(g(upper), g(upperBase), true), g(base))]);
  }
  if (broken("ç", "c")) glyphs["ç".charCodeAt(0)] = compose(g("c"), [centreOn(mark(g("Ç"), g("C"), false), g("c"))]);
  if (broken("ß", "s")) {
    const s = g("s");
    glyphs["ß".charCodeAt(0)] = compose(s, [shift([...Array(s.width * height).keys()].filter((i) => s.pixels[i]).map((i) => [i % s.width, Math.floor(i / s.width), s.pixels[i]] as [number, number, number]), s.width + s.right)]);
  }
  const acute = mark(g("é"), g("e"), true);
  const acuteUp = mark(g("É"), g("E"), true);
  const cedilla = mark(g("ç"), g("c"), false);
  const cedillaUp = mark(g("Ç"), g("C"), false);
  /** The ogonek: the cedilla's hook at the letter's lower right. */
  const ogonek = (pts: [number, number, number][], base: Glyph) => {
    if (!pts.length) return pts;
    const xs = pts.map((p) => p[0]);
    const r = rows(base);
    const c = cols(base, r.bottom - 1, r.bottom);
    const ys = pts.map((p) => p[1]);
    return shift(pts, c.right - Math.max(...xs), r.bottom + 1 - Math.min(...ys));
  };
  /** The dot of i, above a letter at the acute's height. */
  const dot = (() => {
    const i = g("i");
    const pts: [number, number, number][] = [];
    const r = rows(i);
    for (let y = r.top; y < height; y++) {
      const row = [...Array(i.width).keys()].filter((px) => at(i, px, y));
      if (y > r.top && !row.some((px) => at(i, px, y) === 255)) break;
      for (const px of row) pts.push([px, y, at(i, px, y)]);
    }
    return pts;
  })();
  const dotOver = (base: Glyph, accent: [number, number, number][]) => {
    if (!dot.length || !accent.length) return [];
    const dys = dot.map((p) => p[1]);
    const ays = accent.map((p) => p[1]);
    // Its middle row where the acute's is.
    const dy = Math.round((Math.min(...ays) + Math.max(...ays)) / 2 - (Math.min(...dys) + Math.max(...dys)) / 2);
    return centreOn(shift(dot, 0, dy), base);
  };
  /** The stroke of ł / Ł as the Polish release draws it: a short slash across the stem, rising to the right, ink with its shadow. */
  const stroke = (base: Glyph, upper: boolean): [number, number, number][] => {
    const r = rows(base);
    const mid = Math.round(upper ? r.top + (r.bottom - r.top) * 0.5 : r.top + (r.bottom - r.top) * 0.55);
    const c = cols(base, mid, mid);
    const span = Math.max(2, Math.round(height / 6));
    const travel = c.right - c.left + 2;
    const pts: [number, number, number][] = [];
    for (let j = 0; j <= span; j++) {
      const px = c.right + 1 - Math.round((j * travel) / span);
      const y = mid - Math.floor(span / 2) + j;
      pts.push([px, y, 255]);
    }
    for (const [px, y] of [...pts]) if (!at(base, px + 1, y + 1) && !pts.some((q) => q[0] === px + 1 && q[1] === y + 1)) pts.push([px + 1, y + 1, 1]);
    return pts;
  };
  const made: Record<string, Glyph> = {
    ą: compose(g("a"), [ogonek(cedilla, g("a"))]),
    ć: compose(g("c"), [centreOn(acute, g("c"), 1)]),
    ę: compose(g("e"), [ogonek(cedilla, g("e"))]),
    ł: compose(g("l"), [stroke(g("l"), false)]),
    ń: compose(g("n"), [centreOn(acute, g("n"), 1)]),
    ś: compose(g("s"), [centreOn(acute, g("s"), 1)]),
    ź: compose(g("z"), [centreOn(acute, g("z"), 1)]),
    ż: compose(g("z"), [dotOver(g("z"), acute)]),
    Ą: compose(g("A"), [ogonek(cedillaUp, g("A"))]),
    Ć: compose(g("C"), [centreOn(acuteUp, g("C"), 1)]),
    Ę: compose(g("E"), [ogonek(cedillaUp, g("E"))]),
    Ł: compose(g("L"), [stroke(g("L"), true)]),
    Ń: compose(g("N"), [centreOn(acuteUp, g("N"), 1)]),
    Ś: compose(g("S"), [centreOn(acuteUp, g("S"), 1)]),
    Ź: compose(g("Z"), [centreOn(acuteUp, g("Z"), 1)]),
    Ż: compose(g("Z"), [dotOver(g("Z"), acuteUp)]),
  };
  for (const ch of POLISH) glyphs[POLISH_AT + POLISH.indexOf(ch)] = made[ch];
}

export function glyphIndex(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c <= 255) return c;
  const pl = POLISH.indexOf(ch);
  if (pl >= 0) return POLISH_AT + pl;
  const cy = CYRILLIC.indexOf(ch);
  return cy >= 0 ? CYRILLIC_AT + cy : (CP1252[ch] ?? 0x3f);
}

/** Advance width of a string in pixels ("{" and "}" only mark highlighted text, as in the game's texts). */
export function measureText(font: BitmapFont, text: string): number {
  let w = 0;
  for (const ch of text) {
    if (ch === "{" || ch === "}") continue;
    const g = font.glyphs[glyphIndex(ch)];
    w += g.left + g.width + g.right;
  }
  return w;
}

/**
 * One paragraph broken into lines at most `width` pixels wide, at spaces (VCMI's CMessage::breakText):
 * words are never split (a word wider than the box gets a line of its own), "{" "}" take no room.
 */
export function breakText(font: BitmapFont, line: string, width: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of line.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && measureText(font, next) > width) {
      out.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  out.push(cur);
  return out;
}

/**
 * A count shortened to fit a small box, as the original's army slots and battle stacks do (VCMI's
 * TextOperations::formatMetric): more than `digits` digits become thousands ("10k"), then millions ("10M").
 */
export function formatMetric(n: number, digits = 4): string {
  const max = 10 ** digits - 1;
  let v = Math.abs(Math.trunc(n));
  let e = 0;
  while (v > max && e < 5) {
    v = Math.floor(v / 1000);
    e++;
  }
  return `${n < 0 ? "-" : ""}${v}${["", "k", "M", "G", "T", "P"][e]}`;
}
