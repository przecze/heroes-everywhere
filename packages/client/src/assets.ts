import { HERO_INFO, HERO_PORTRAITS, HOTA_CREATURES, SPECIALTY_ICONS } from "@heroes/core";
import { type DefFrame, decodeBmp, decodeDef, decodePcx, indexedToRgba, playerPalette } from "@heroes/formats";
import { BufferImageSource, Rectangle, Texture } from "pixi.js";
import { loadingFile } from "./ui/loadingNote.ts";
import { fetchRetry, remember } from "./net.ts";
import { has, lang } from "./i18n/index.ts";
import { release } from "./i18n/languages.ts";
import { releaseText } from "./i18n/release.ts";



/**
 * Map objects HotA's newest maps name by DEFs the game files lack, which the HotA mod has under
 * its own names (Bulwark's Yeti and Jotunn dwellings, its Seer's Hut and Trapper Lodge).
 */
const DEF_ALIASES: Record<string, string> = { "avgyeti.def": "avgyeti0.def", "avgjotu.def": "avgjotn0.def", "avxseek0.def": "avxseeka0.def", "avmtrap0.def": "avmtrap0a.def" };

/** A DEF by name, or by the name the HotA mod gives it. */
function fetchDef(file: string): Promise<Uint8Array> {
  return fetchRes(file).catch((e) => (DEF_ALIASES[file] ? fetchRes(DEF_ALIASES[file]) : Promise.reject(e)));
}

export async function fetchRes(name: string): Promise<Uint8Array> {
  // A text file in a language whose own release's files are served (languages.ts release): that release's.
  const l = lang();
  const own = /\.txt$/i.test(name) && release(l) ? await releaseText(l, name) : undefined;
  return own ?? fetchEnglish(name);
}

/** The game file as the server has it (the English release's), whatever the interface's language: for tables the
 *  page keeps in English and names in place over (gameData.ts, the help rows). */
export async function fetchEnglish(name: string): Promise<Uint8Array> {
  const loaded = loadingFile(name);
  try {
    // "l10n/pl/sprites/mmenung.def": the Polish or German translation pack's art (l10nArt.ts), not the game files.
    const res = await fetchRetry(name.startsWith("l10n/") ? `/${name.toLowerCase()}` : `/res/${encodeURIComponent(name.toLowerCase())}`);
    // (A missing file can come back as the app's own page, 200: the server's fallback for any unknown path.)
    if (!res.ok || res.headers.get("content-type")?.startsWith("text/html")) throw new Error(`missing game file ${name}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    loaded();
  }
}

/** A DEF frame as a texture plus where it sits on the DEF's full canvas. */
export interface FrameTexture {
  texture: Texture;
  x: number;
  y: number;
  fullWidth: number;
  fullHeight: number;
}

export type DefTextures = Map<number, FrameTexture[]>;

/** Player colours used for owner flags (palette slot 5 of map objects). */
export const PLAYER_COLORS: [number, number, number][] = [
  [255, 0, 0],
  [49, 82, 255],
  [156, 115, 82],
  [66, 148, 41],
  [255, 132, 0],
  [140, 41, 165],
  [8, 156, 165],
  [198, 123, 140],
];
/** The flag of an object nobody owns (the original's neutral colour, as VCMI reads it from the game). */
const NEUTRAL_COLOR: [number, number, number] = [0x84, 0x84, 0x84];
/** A player's flag colour for drawing (0xRRGGBB) and for the page's HTML (a CSS colour); grey for nobody. */
export const playerRgb = (player: number) => {
  const [r, g, b] = PLAYER_COLORS[player] ?? NEUTRAL_COLOR;
  return (r << 16) | (g << 8) | b;
};
export const playerCss = (player: number) => `rgb(${(PLAYER_COLORS[player] ?? NEUTRAL_COLOR).join(",")})`;
/** A player's colour as a little square in the page's HTML (the lobby's and the hot seat's seats). */
export const playerSwatch = (player: number) => `<span class="mpSwatch" style="background:${playerCss(player)}"></span>`;

/**
 * Only a DEF's flag (palette 5) in a player's colour, the rest clear: drawn over the map's set pieces so an owned mine's
 * flag shows even where a mountain or a tree a row lower covers it (EXTRAS flagsOnTop). Null when it has no flag.
 */
const flagOnlyCache = new Map<string, Promise<DefTextures | null>>();
export function loadFlagOnly(name: string, player: number): Promise<DefTextures | null> {
  if (player < 0 || player > 7) return Promise.resolve(null);
  const key = `${name.toLowerCase()}#${player}`;
  let p = flagOnlyCache.get(key);
  if (!p) {
    const file = name.toLowerCase().endsWith(".def") ? name.toLowerCase() : `${name.toLowerCase()}.def`;
    p = fetchDef(file).catch(() => null).then((bytes) => {
      if (!bytes) return null;
      const def = decodeDef(bytes);
      const palette = new Uint8Array(256 * 4);
      palette.set([...PLAYER_COLORS[player], 255], 5 * 4);
      let any = false;
      const out: DefTextures = new Map();
      for (const [group, frames] of def.groups) {
        out.set(
          group,
          frames.map((f) => {
            any ||= f.pixels.includes(5);
            return { texture: toTexture(f.width, f.height, indexedToRgba(f.pixels, palette)), x: f.x, y: f.y, fullWidth: f.fullWidth, fullHeight: f.fullHeight };
          }),
        );
      }
      return any ? out : null;
    });
    remember(flagOnlyCache, key, p);
  }
  return p;
}

/** A DEF with its flag slot (palette 5) painted in a player's colour (grey for nobody, below 0). */
const flaggedCache = new Map<string, Promise<DefTextures>>();

export function loadDefFlagged(name: string, player: number): Promise<DefTextures> {
  if (player > 7) return loadDef(name);
  if (player < 0) player = -1;
  const key = `${name.toLowerCase()}#${player}`;
  let p = flaggedCache.get(key);
  if (!p) {
    const file = name.toLowerCase().endsWith(".def") ? name.toLowerCase() : `${name.toLowerCase()}.def`;
    const color = PLAYER_COLORS[player] ?? NEUTRAL_COLOR;
    p = fetchDef(file).catch(() => null).then(async (bytes) => {
      // HotA's newest objects (the Factory's Coatls, Bulwark's dwellings...) come as the mod's JSON + PNG frames.
      if (!bytes) return pngTextures(await loadFrameCanvases(file.replace(/\.def$/, ""), undefined, "image", color));
      const def = decodeDef(bytes);
      def.palette.set([...color, 255], 5 * 4);
      const out: DefTextures = new Map();
      for (const [group, frames] of def.groups) {
        out.set(
          group,
          frames.map((f) => ({ texture: toTexture(f.width, f.height, indexedToRgba(f.pixels, def.palette)), x: f.x, y: f.y, fullWidth: f.fullWidth, fullHeight: f.fullHeight })),
        );
      }
      return out;
    });
    remember(flaggedCache, key, p);
  }
  return p;
}

/** A DEF whose player ramp (palette 224-255) uses a player's colours from PLAYERS.PAL (battle flags etc.). */
const playerCache = new Map<string, Promise<DefTextures>>();
let playersPal: Promise<Uint8Array> | null = null;

export function loadDefPlayer(name: string, player: number): Promise<DefTextures> {
  if (player < 0 || player > 7) return loadDef(name);
  const key = `${name.toLowerCase()}#p${player}`;
  let p = playerCache.get(key);
  if (!p) {
    playersPal ??= fetchRes("players.pal");
    p = Promise.all([fetchRes(name.toLowerCase().endsWith(".def") ? name.toLowerCase() : `${name.toLowerCase()}.def`), playersPal]).then(([bytes, pal]) => {
      const def = decodeDef(bytes);
      return defTextures(def, playerPalette(def.palette, pal, player), battleDef(bytes));
    });
    remember(playerCache, key, p);
  }
  return p;
}

/** Textures holding only a DEF's selection-outline pixels (palette slot 5), in gold. */
const outlineCache = new Map<string, Promise<DefTextures>>();

export function loadDefOutline(name: string): Promise<DefTextures> {
  const key = name.toLowerCase().endsWith(".def") ? name.toLowerCase() : `${name.toLowerCase()}.def`;
  let p = outlineCache.get(key);
  if (!p) {
    p = fetchRes(key).catch(() => null).then(async (bytes) => {
      // A mod creature drawn as JSON + PNG (the Olgoi-Khorkhoi's): its yellow marker pixels are the outline.
      if (!bytes) return pngTextures(await loadFrameCanvases(key.replace(/\.def$/, ""), undefined, "outline"));
      const def = decodeDef(bytes);
      const pal = new Uint8Array(256 * 4);
      // White: the battle tints it, gold for the stack whose turn it is, cyan for the ones pointed at.
      pal.set([255, 255, 255, 255], 5 * 4);
      return defTextures(def, pal, battleDef(bytes));
    });
    remember(outlineCache, key, p);
  }
  return p;
}

/**
 * Pixels as a texture, kept as the bytes themselves rather than a canvas each: a phone's browser
 * caps all canvases together (iOS Safari: 384 MB, after which new ones come out blank), and a
 * long game loads thousands of frames.
 */
function toTexture(width: number, height: number, rgba: Uint8ClampedArray): Texture {
  if (!width || !height) return new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4), width: 1, height: 1, alphaMode: "premultiply-alpha-on-upload" }) });
  return new Texture({ source: new BufferImageSource({ resource: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height, alphaMode: "premultiply-alpha-on-upload" }) });
}

/**
 * A battle creature's frames (the 450 x 400 canvas: its DEF, or the mod's PNGs cut to their pixels) packed into a few
 * pictures, each frame a part of one. Every frame its own picture made Pixi sort the whole battlefield out again each
 * time a stack's frame changed (a new picture isn't in the batch it was drawn with), so about every frame while
 * anything moved, on top of the magnifier's draws (2026-11-03). A sheet: 2048 wide at most, as tall as
 * its frames need (2048 at most, then another), 2 clear pixels round each frame so none bleeds into the next.
 */
const SHEET = 2048;
const PAD = 2;
/** A DEF drawn on the battlefield, by its type (the file's first number): a spell's or a blow's, a creature's, a hero's. */
const battleDef = (bytes: Uint8Array) => [0x40, 0x41, 0x42, 0x49].includes(new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true));
function packFrames(frames: { width: number; height: number; rgba: Uint8ClampedArray }[]): Texture[] {
  // Shelves, the tallest frames first; each frame's place.
  const order = frames.map((_, i) => i).sort((a, b) => frames[b].height - frames[a].height);
  const at: { sheet: number; x: number; y: number }[] = [];
  const heights: number[] = [];
  let sheet = 0;
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const i of order) {
    const w = frames[i].width + 2 * PAD;
    const h = frames[i].height + 2 * PAD;
    if (x + w > SHEET) (x = 0), (y += shelf), (shelf = 0);
    if (y + h > SHEET && (x || y)) (heights[sheet] = y), sheet++, (x = 0), (y = 0), (shelf = 0);
    at[i] = { sheet, x: x + PAD, y: y + PAD };
    x += w;
    shelf = Math.max(shelf, h);
  }
  heights[sheet] = y + shelf;
  const sources = heights.map((h, k) => {
    const width = Math.min(SHEET, Math.max(1, ...frames.flatMap((f, i) => (at[i]?.sheet === k ? [at[i].x + f.width + PAD] : []))));
    const height = Math.max(1, h);
    const px = new Uint8ClampedArray(width * height * 4);
    frames.forEach((f, i) => {
      if (at[i].sheet !== k || !f.width || !f.height) return;
      for (let row = 0; row < f.height; row++) px.set(f.rgba.subarray(row * f.width * 4, (row + 1) * f.width * 4), ((at[i].y + row) * width + at[i].x) * 4);
    });
    return new BufferImageSource({ resource: new Uint8Array(px.buffer), width, height, alphaMode: "premultiply-alpha-on-upload" });
  });
  return frames.map((f, i) => new Texture({ source: sources[at[i].sheet], frame: new Rectangle(at[i].x, at[i].y, Math.max(1, f.width), Math.max(1, f.height)) }));
}

/** A DEF's frames as textures: the battlefield's packed into sheets (packFrames), anything else each its own. */
function defTextures(def: { groups: Map<number, DefFrame[]> }, palette: Uint8Array, pack: boolean): DefTextures {
  const all = [...new Set([...def.groups.values()].flat())];
  const made = new Map<DefFrame, Texture>();
  if (pack && all.length > 1) {
    const packed = packFrames(all.map((f) => ({ width: f.width, height: f.height, rgba: indexedToRgba(f.pixels, palette) })));
    all.forEach((f, i) => made.set(f, packed[i]));
  } else for (const f of all) made.set(f, toTexture(f.width, f.height, indexedToRgba(f.pixels, palette)));
  const out: DefTextures = new Map();
  for (const [group, frames] of def.groups) out.set(group, frames.map((f) => ({ texture: made.get(f)!, x: f.x, y: f.y, fullWidth: f.fullWidth, fullHeight: f.fullHeight })));
  return out;
}

const canvases = new WeakMap<Texture, HTMLCanvasElement>();

/** A texture's whole picture as a canvas, for drawing it into another (made once, when asked). */
export function textureCanvas(t: Texture): HTMLCanvasElement {
  const r = t.source.resource as unknown;
  if (r instanceof HTMLCanvasElement) return r;
  let c = canvases.get(t);
  if (!c) {
    c = document.createElement("canvas");
    c.width = t.source.pixelWidth;
    c.height = t.source.pixelHeight;
    const ctx = c.getContext("2d")!;
    if (r instanceof Uint8Array || r instanceof Uint8ClampedArray) ctx.putImageData(new ImageData(new Uint8ClampedArray(r.buffer, r.byteOffset, r.byteLength) as Uint8ClampedArray<ArrayBuffer>, c.width, c.height), 0, 0);
    else ctx.drawImage(r as CanvasImageSource, 0, 0);
    canvases.set(t, c);
  }
  return c;
}

const defCache = new Map<string, Promise<DefTextures>>();

// Marker colours of the original palettes and the alpha they stand for (see palette.ts).
const MARKERS: [number, number, number, number][] = [
  [0, 255, 255, 0],
  [255, 150, 255, 64],
  [255, 100, 255, 64],
  [255, 50, 255, 128],
  [255, 0, 255, 128],
  [255, 255, 0, 0],
  [180, 0, 255, 128],
  [0, 255, 0, 64],
];

/** `flag`: the owner's colour for the flag marker (yellow), else it goes transparent like the rest. */
function keyMarkerColors(px: Uint8ClampedArray, flag?: [number, number, number]) {
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    for (const [r, g, b, a] of MARKERS) {
      if (Math.abs(px[i] - r) <= 4 && Math.abs(px[i + 1] - g) <= 4 && Math.abs(px[i + 2] - b) <= 4) {
        if (flag && r === 255 && g === 255 && b === 0) [px[i], px[i + 1], px[i + 2], px[i + 3]] = [...flag, 255];
        else {
          px[i] = px[i + 1] = px[i + 2] = 0;
          px[i + 3] = a;
        }
        break;
      }
    }
  }
}

/** Frames of a JSON + PNG animation (VCMI mod format): either an `images` list or `sequences` per group. */
export async function loadFrameCanvases(
  name: string,
  want?: (group: number, frame: number) => boolean,
  mode: "image" | "outline" = "image",
  flag?: [number, number, number],
): Promise<Map<number, HTMLCanvasElement[]>> {
  type Anim = { basepath?: string; images?: { group?: number; frame: number; file: string }[]; sequences?: { group: number; frames: string[] }[] };
  const list = JSON.parse(new TextDecoder().decode(await fetchRes(`${name}.json`))) as Anim;
  const items = list.images ?? (list.sequences ?? []).flatMap((s) => s.frames.map((file, frame) => ({ group: s.group, frame, file })));
  const out = new Map<number, HTMLCanvasElement[]>();
  await Promise.all(
    // A list without groups (the Cove's and Bulwark's hall icons) is group 0, as VCMI reads it.
    items.filter(({ group = 0, frame }) => !want || want(group, frame)).map(async ({ group = 0, frame, file }) => {
      const base = file.split("/").pop()!;
      // Prefer the path under sprites/ (unique), fall back to the bare file name.
      const bytes = await fetchRes(`${list.basepath ?? ""}${base}`).catch(() => fetchRes(base));
      const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      // These PNGs keep the DEF marker colours (cyan = transparent, magentas = shadow).
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (mode === "outline") outlineOnly(img.data);
      else keyMarkerColors(img.data, flag);
      ctx.putImageData(img, 0, 0);
      const frames = out.get(group) ?? [];
      frames[frame] = canvas;
      out.set(group, frames);
    }),
  );
  return out;
}

/** Only the selection outline (the DEF's yellow marker, palette slot 5), in gold; the rest clear. */
function outlineOnly(px: Uint8ClampedArray) {
  for (let i = 0; i < px.length; i += 4) {
    const yellow = px[i + 3] > 0 && px[i] >= 251 && px[i + 1] >= 251 && px[i + 2] <= 4;
    px.set(yellow ? [255, 255, 255, 255] : [0, 0, 0, 0], i);
  }
}

async function loadPngAnimation(name: string, want?: (group: number, frame: number) => boolean): Promise<DefTextures> {
  return pngTextures(await loadFrameCanvases(name, want));
}

/**
 * A battle-sized frame (450 x 400, the creatures' canvas: HotA's own creatures come as the mod's PNGs, whole frames)
 * cut to its pixels, its place kept in x / y as a DEF frame's. Whole, the owner's phone held 166 of them after the towns'
 * recruit windows, 120 MB (2026-11-02); cut, a creature's frame is a tenth of that.
 */
function trimmed(c: HTMLCanvasElement): { width: number; height: number; rgba: Uint8ClampedArray; x: number; y: number } {
  const px = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let [x0, y0, x1, y1] = [c.width, c.height, -1, -1];
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (px[(y * c.width + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  c.width = c.height = 0;
  if (x1 < 0) return { width: 0, height: 0, rgba: new Uint8ClampedArray(0), x: 0, y: 0 };
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) rgba.set(px.subarray(((y0 + row) * 450 + x0) * 4, ((y0 + row) * 450 + x1 + 1) * 4), row * width * 4);
  return { width, height, rgba, x: x0, y: y0 };
}

function pngTextures(frames: Map<number, HTMLCanvasElement[]>): DefTextures {
  const out: DefTextures = new Map();
  // A battle creature's (whole 450 x 400 frames): cut to their pixels and packed into sheets (packFrames).
  const all = [...frames.values()].flat();
  if (all.length && all.every((c) => c.width === 450 && c.height === 400)) {
    const cut = new Map(all.map((c) => [c, trimmed(c)]));
    const list = [...cut.values()];
    const packed = packFrames(list);
    const tex = new Map(list.map((f, i) => [f, packed[i]]));
    for (const [group, canvases] of frames) out.set(group, canvases.map((c) => { const f = cut.get(c)!; return { texture: tex.get(f)!, x: f.x, y: f.y, fullWidth: 450, fullHeight: 400 }; }));
    return out;
  }
  for (const [group, canvases] of frames) {
    out.set(
      group,
      canvases.map((c) => ({ texture: Texture.from(c), x: 0, y: 0, fullWidth: c.width, fullHeight: c.height })),
    );
  }
  return out;
}

/**
 * DEFs whose frames HotA extends beyond the game's file (its own artifacts, the Interference skill, its map format):
 * the mod's JSON + PNG list has them.
 */
// (SCSELC: the scenario list's map formats, HotA's horn its frame 5, as VCMI's mapSupport mod adds it.)
const EXTENDED_DEFS = new Set(["artifact.def", "secskill.def", "secsk82.def", "secsk32.def", "scselc.def"]);
/** Runes (skill 29, frames 90-92 of the skill DEFs): the mod keeps them with Bulwark, one PNG a level. */
const RUNES_ICONS: Record<string, string> = { "secskill.def": "medium", "secsk82.def": "large", "secsk32.def": "small" };

/**
 * Frames the game's DEF has only as the original's placeholders, which HotA drew anew: the Diplomat's
 * Cloak and the Pendant of Reflection (the old unused artifacts' crossed-out picture).
 */
const REDRAWN_FRAMES: Record<string, number[]> = { "artifact.def": [141, 142] };

/** Fills the frames a DEF lacks (and its placeholders) from the mod's JSON + PNG animation of the same name, when there is one. */
async function withModFrames(key: string, out: DefTextures): Promise<DefTextures> {
  const redrawn = new Set(REDRAWN_FRAMES[key] ?? []);
  const extra = await loadPngAnimation(key.replace(/\.def$/, ""), (group, frame) => !out.get(group)?.[frame] || (group === 0 && redrawn.has(frame))).catch(() => null);
  for (const [group, frames] of extra ?? []) {
    const have = out.get(group) ?? [];
    frames.forEach((f, i) => (group === 0 && redrawn.has(i) ? (have[i] = f) : (have[i] ??= f)));
    out.set(group, have);
  }
  const runes = RUNES_ICONS[key];
  const have = out.get(0);
  if (runes && have)
    await Promise.all(
      ["basic", "advanced", "expert"].map(async (level, i) => {
        if (have[90 + i]) return;
        const texture = await loadPng(`hota/bulwark/skills/runes/icons/${runes}/${level}.png`).catch(() => null);
        if (texture) have[90 + i] = { texture, x: 0, y: 0, fullWidth: texture.width, fullHeight: texture.height };
      }),
    );
  return out;
}

/** The DEFs the Polish or German translation pack redraws (l10nArt.ts), by lowercase name; empty in other languages or without the pack. */
const l10nIndexes = new Map<string, Promise<Set<string>>>();
export function l10nDefs(l: string): Promise<Set<string>> {
  let p = l10nIndexes.get(l);
  if (!p) l10nIndexes.set(l, (p = has(l, "art") ? fetchRetry(`/l10n/${l}/index.json`).then((r) => (r.ok ? r.json() : [])).then((a: string[]) => new Set(a.map((n) => n.toLowerCase()))).catch(() => new Set<string>()) : Promise.resolve(new Set<string>())));
  return p;
}

/** A DEF by name; in Polish or German the translation pack's drawing of it where there is one (its words are in the picture). */
export async function loadDef(name: string): Promise<DefTextures> {
  const l = lang();
  if (has(l, "art")) {
    const own = name.toLowerCase().endsWith(".def") ? name.toLowerCase() : `${name.toLowerCase()}.def`;
    // (The pack's drawing missing or broken on the server: the game's own.)
    if ((await l10nDefs(l)).has(own)) return loadDefAs(`l10n/${l}/sprites/${own}`).catch(() => loadDefAs(name));
  }
  return loadDefAs(name);
}

function loadDefAs(name: string): Promise<DefTextures> {
  const key = name.toLowerCase().endsWith(".def") ? name.toLowerCase() : `${name.toLowerCase()}.def`;
  let p = defCache.get(key);
  if (!p) {
    p = fetchDef(key).catch(() => null).then((bytes) => {
      if (!bytes) return loadPngAnimation(key.replace(/\.def$/, ""));
      const def = decodeDef(bytes);
      const out = defTextures(def, def.palette, battleDef(bytes));
      return EXTENDED_DEFS.has(key) ? withModFrames(key, out) : out;
    });
    remember(defCache, key, p);
  }
  return p;
}

const imageCache = new Map<string, Promise<Texture>>();

/** PCX or BMP from the bitmap archives; `keyBlack` makes palette slot 0 transparent (overlays like the hex grid). */
export function loadImage(name: string, keyBlack = false): Promise<Texture> {
  const key = name.toLowerCase();
  const cacheKey = keyBlack ? `${key}#keyed` : key;
  let p = imageCache.get(cacheKey);
  if (!p) {
    p = fetchRes(key).then((bytes) => {
      const img = key.endsWith(".bmp") ? decodeBmp(bytes) : decodePcx(bytes);
      if (keyBlack && !key.endsWith(".bmp")) {
        const n = img.width * img.height;
        for (let i = 0; i < n; i++) if (bytes[12 + i] === 0) img.rgba[i * 4 + 3] = 0;
      }
      return toTexture(img.width, img.height, img.rgba);
    });
    remember(imageCache, cacheKey, p);
  }
  return p;
}

const pngCache = new Map<string, Promise<Texture>>();

/** A loose PNG (e.g. HotA portraits from the mod), as a texture. */
export function loadPng(path: string, colorKey = false): Promise<Texture> {
  const key = colorKey ? `${path}#key` : path;
  let p = pngCache.get(key);
  if (!p) {
    p = fetchRes(path).then(async (bytes) => {
      const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (colorKey) {
        // Like the original BMPs: cyan is see-through, magenta is shadow.
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] === 0 && d[i + 1] === 255 && d[i + 2] === 255) d[i + 3] = 0;
          else if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 255) [d[i], d[i + 1], d[i + 2], d[i + 3]] = [0, 0, 0, 128];
        }
      }
      // (The pixels kept, not the canvas: see toTexture.)
      canvas.width = canvas.height = 0;
      bitmap.close();
      return toTexture(img.width, img.height, img.data);
    });
    remember(pngCache, key, p);
  }
  return p;
}

/** The besieged town's own arrow tower picture (battle/siegeView.ts sets it while a siege is up). */
let arrowTowerPortrait: ((size: "small" | "large") => Promise<Texture | null>) | null = null;
export function setArrowTowerPortrait(fn: typeof arrowTowerPortrait) {
  arrowTowerPortrait = fn;
}
const ARROW_TOWER = 149;
/** Creatures whose portrait HotA repainted for the town that took them in (138: the Halflings, Factory's). */
const HOTA_REPAINTED = new Set([138]);

/** A creature's portrait: small (32x32, turn queue / casualties) or large (58x64). */
export async function creaturePortrait(c: { id: number; iconSmall?: string; iconLarge?: string }, size: "small" | "large"): Promise<Texture | null> {
  // The sheets have no arrow tower: each town shows its own (VCMI's towerIconSmall / towerIconLarge).
  if (c.id === ARROW_TOWER && arrowTowerPortrait) return arrowTowerPortrait(size);
  // Called with just an id (e.g. an army slot): HotA's creatures have their own pictures, not in the sheets.
  const hota = c.iconSmall || c.iconLarge ? undefined : HOTA_CREATURES.find((h) => h.id === c.id);
  const icon = size === "small" ? (c.iconSmall ?? hota?.iconSmall) : (c.iconLarge ?? hota?.iconLarge);
  if (icon) return loadPng(icon).catch(() => null);
  // (A creature HotA moved into a town has HotA's repainted portrait, the town's backdrop behind it: the Halflings,
  // Factory's since HotA 1.7. HotA.lod can't be read by name; the HotA mod's patched sheets have them. The owner 2026-11-02.)
  if (HOTA_REPAINTED.has(c.id)) {
    const frame = String(c.id + 2).padStart(3, "0");
    const own = await loadPng(size === "small" ? `cprsmall/cprsmalla${frame}.png` : `twcrport/twcrporta${frame}.png`).catch(() => null);
    if (own) return own;
  }
  const sheet = (await loadDef(size === "small" ? "cprsmall.def" : "twcrport.def")).get(0) ?? [];
  return sheet[c.id + 2]?.texture ?? null;
}

/**
 * A hero portrait: original PCX (HPL/HPS) or a HotA PNG path; large 58x64 or small 48x32. A hero (or
 * battle hero) with a portrait of its own (one the map gave it) shows that one.
 */
export function heroPortrait(who: number | { type?: number; portrait?: string }, size: "large" | "small" = "large"): Promise<Texture> {
  const type = typeof who === "number" ? who : (who.type ?? -1);
  const own = typeof who === "number" ? undefined : who.portrait;
  if (own?.includes("/")) return loadPng((size === "small" ? own.replace("portraitLarge", "portraitSmall").replace(/hpl([^/]*)$/i, "HPS$1") : own).toLowerCase());
  if (own) return loadImage(`${size === "small" ? own.replace(/^hpl/, "hps") : own}.pcx`).catch(() => loadImage(size === "small" ? "hpsrand.pcx" : "hpl000kn.pcx"));
  const info = HERO_INFO[type];
  const name = HERO_PORTRAITS[type] ?? "";
  if (name.includes("/") || info?.portrait?.[0]?.includes("/")) {
    const path = (size === "large" ? info?.portrait?.[0] : info?.portrait?.[1]) || name;
    return loadPng(path.toLowerCase());
  }
  const pcx = size === "small" ? name.replace(/^hpl/, "hps") : name;
  return loadImage(`${pcx || (size === "small" ? "hpsrand" : "hpl000kn")}.pcx`).catch(() => loadImage(size === "small" ? "hpsrand.pcx" : "hpl000kn.pcx"));
}

/** A hero's specialty picture: UN44 / UN32 by hero for the classic heroes, HotA's own (beside its portrait) for the rest. */
export async function specialtyIcon(type: number, size: "large" | "small" = "large"): Promise<Texture | undefined> {
  const frame = (await loadDef(size === "large" ? "un44.def" : "un32.def").catch(() => null))?.get(0)?.[type]?.texture;
  if (frame) return frame;
  // (Beside the portrait: in an icons folder for the Cove's and Factory's heroes, in the hero's own for the Bulwark's.)
  const dir = SPECIALTY_ICONS[type] ? `${SPECIALTY_ICONS[type]}/icons` : HERO_INFO[type]?.portrait?.[0]?.replace(/\/[^/]*$/, "");
  if (!dir?.includes("/")) return undefined;
  return loadPng(`${dir}/specialty${size === "large" ? "Large" : "Small"}.png`.toLowerCase()).catch(() => undefined);
}

/**
 * Small town icon (ITPA) frame: forts at 2 + 2·faction, villages at 20 + 2·faction, the next frame
 * when a building went up today; 38 for factions the file doesn't have (VCMI's CTownHandler).
 */
export function townIconFrame(faction: number, fort: boolean, builtToday = false): number {
  if (faction < 0 || faction > 8) return 38;
  return (fort ? 2 : 20) + faction * 2 + (builtToday ? 1 : 0);
}

/** ITPT (58 x 64): each town with a fort (0-17), then without (18-35), each followed by its built-today one (the red cross). */
export function townPortraitFrame(faction: number, fort: boolean, builtToday = false): number {
  return (fort ? 0 : 18) + Math.max(0, Math.min(8, faction)) * 2 + (builtToday ? 1 : 0);
}

/** The HotA towns' icons are files of their own (the HotA mod's town configs), not frames of ITPA / ITPT. */
const HOTA_TOWN_ICONS: Record<number, (fort: boolean, built: boolean, small: boolean) => string[]> = {
  9: (fort, built, small) => [`hota/cove/town/icons/${fort ? "fort" : "hall"}${built ? "builded" : ""}${small ? "small" : "large"}.png`],
  10: (fort, built, small) => {
    const base = `hota/factory/town/icons/${fort ? "fort" : "hall"}${built ? "-builded" : ""}-${small ? "small" : "big"}`;
    return [`${base}.png`, `${base}.bmp`];
  },
  11: (fort, built, small) => [`hota/bulwark/town/icons/${fort ? "fort" : "hall"}${built ? "Built" : ""}${small ? "Small" : "Large"}.png`],
};

/**
 * A town's icon: small (48x32, the town lists: ITPA) or large (58x64, the panels: ITPT), with or
 * without a fort, and (small) marked as built in today. The HotA towns' from their own files,
 * falling back to the original's generic one.
 */
export async function townIcon(faction: number, fort: boolean, builtToday: boolean, size: "small" | "large"): Promise<Texture | null> {
  // (The Bulwark has no built-today pictures: its plain one then.)
  const hota = HOTA_TOWN_ICONS[faction];
  const files = hota ? [...hota(fort, builtToday, size === "small"), ...(builtToday ? hota(fort, false, size === "small") : [])] : [];
  for (const f of files) {
    const tex = await (f.endsWith(".png") ? loadPng(f) : loadImage(f)).catch(() => null);
    if (tex) return tex;
  }
  if (size === "small") {
    const frames = (await loadDef("itpa.def")).get(0) ?? [];
    return (frames[townIconFrame(faction, fort, builtToday)] ?? frames[0])?.texture ?? null;
  }
  const frames = (await loadDef("itpt.def")).get(0) ?? [];
  return frames[townPortraitFrame(faction, fort, builtToday)]?.texture ?? null;
}

/** The drawn part of a frame (its opaque pixels), in the texture's own pixels: the HotA mod's PNGs keep their whole canvas
 * (a creature's 500 px and more of clear margin, a building's patches the building's size), so a texture's bounds say
 * nothing of what is drawn. */
const opaque = new WeakMap<object, Rectangle | null>();
export function opaqueBox(t: Texture): Rectangle | null {
  const src = (t.source as { resource?: unknown }).resource;
  if (!(src instanceof HTMLCanvasElement)) return null;
  if (opaque.has(src)) return opaque.get(src)!;
  let box: Rectangle | null = null;
  const px = src.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, src.width, src.height).data;
  if (px) {
    let [x0, y0, x1, y1] = [src.width, src.height, -1, -1];
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++)
        if (px[(y * src.width + x) * 4 + 3] > 0) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
    if (x1 >= 0) box = new Rectangle(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }
  opaque.set(src, box);
  return box;
}
