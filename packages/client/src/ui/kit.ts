// Original-art interface pieces: player-coloured images, DEF buttons, window frames. (The window stack is ui/modals.ts,
// the message windows ui/dialogs.ts.)
import { track } from "../usage.ts";
import { playerPalette } from "@heroes/formats";
import { Container, Graphics, Rectangle, Sprite, Texture, TilingSprite } from "pixi.js";
import { type DefTextures, fetchEnglish, fetchRes, loadDef, loadDefPlayer, loadImage } from "../assets.ts";
import { GameText, type FontName, WHITE, YELLOW, formatMetric, legacyRows } from "../text.ts";
import { playSound } from "../audio.ts";
import { HELP_IDS } from "./helpIds.ts";
import { FINGER_CSS, navBarRight, phoneSized, screenSize } from "./screen.ts";
import { remember } from "../net.ts";
import { lang, tr, trIn, untr, type Text, type Lang, said, NONE } from "../i18n/index.ts";
import { packLines } from "./gameText.ts";
import { extra } from "../settings.ts";
import { cut as cutPart } from "./blocks/windowParts.ts";
import { drawnDef } from "./drawnButtons.ts";
import { block } from "./blocks/block.ts";
import type { Modals } from "./modals.ts";
// (Only called at a tap: the dialogs draw with this file's pieces.)
import { messageBox } from "./dialogs.ts";
import { fallback as english, noteEnglish } from "../i18n/text.ts";

export const SCREEN_W = 800;
export const SCREEN_H = 600;

let playersPal: Promise<Uint8Array> | null = null;
const imageCache = new Map<string, Promise<Texture>>();

/**
 * An 8-bit interface image with the player's colours (palette slots 224-255, like
 * the original's coloured frames), optionally with a transparent hole cut out.
 */
export function loadImagePlayer(name: string, player: number, hole?: { x: number; y: number; w: number; h: number }): Promise<Texture> {
  const key = `${name.toLowerCase()}#${player}#${hole ? Object.values(hole).join(",") : ""}`;
  let p = imageCache.get(key);
  if (!p) {
    playersPal ??= fetchRes("players.pal");
    p = Promise.all([fetchRes(name.toLowerCase()), playersPal]).then(([bytes, players]) => {
      if (name.toLowerCase().endsWith(".bmp")) return bmpPlayer(bytes, players, player);
      if (name.toLowerCase().endsWith(".png")) return pngPlayer(bytes, players, player);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const size = view.getUint32(0, true);
      const width = view.getUint32(4, true);
      const height = view.getUint32(8, true);
      const n = width * height;
      const data = bytes.subarray(12);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const img = new ImageData(width, height);
      if (size === n * 3) {
        for (let i = 0; i < n; i++) img.data.set([data[i * 3 + 2], data[i * 3 + 1], data[i * 3], 255], i * 4);
      } else {
        const raw = data.subarray(n, n + 768);
        const base = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i++) base.set([raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2], 255], i * 4);
        const pal = player >= 0 && player < 8 ? playerPalette(base, players, player) : base;
        for (let i = 0; i < n; i++) {
          const c = data[i] * 4;
          img.data.set([pal[c], pal[c + 1], pal[c + 2], 255], i * 4);
        }
      }
      if (hole) {
        for (let y = hole.y; y < hole.y + hole.h; y++) for (let x = hole.x; x < hole.x + hole.w; x++) img.data[(y * width + x) * 4 + 3] = 0;
      }
      canvas.getContext("2d")!.putImageData(img, 0, 0);
      return Texture.from(canvas);
    });
    remember(imageCache, key, p);
  }
  return p;
}

/** An indexed PNG (the HotA mod's halls, e.g. the Factory's) with the player's colours in its palette's slots 224-255. */
async function pngPlayer(bytes: Uint8Array, players: Uint8Array, player: number): Promise<Texture> {
  const out = bytes.slice();
  const v = new DataView(out.buffer);
  for (let at = 8; at + 12 <= out.length; ) {
    const n = v.getUint32(at);
    const type = String.fromCharCode(...out.subarray(at + 4, at + 8));
    if (type === "PLTE" && n === 768 && player >= 0 && player < 8) {
      const base = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) base.set([out[at + 8 + i * 3], out[at + 9 + i * 3], out[at + 10 + i * 3], 255], i * 4);
      const pal = playerPalette(base, players, player);
      for (let i = 0; i < 256; i++) out.set([pal[i * 4], pal[i * 4 + 1], pal[i * 4 + 2]], at + 8 + i * 3);
      v.setUint32(at + 8 + n, crc32(out.subarray(at + 4, at + 8 + n)));
    }
    at += 12 + n;
  }
  const bitmap = await createImageBitmap(new Blob([out], { type: "image/png" }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return Texture.from(canvas);
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** An 8-bit BMP (e.g. HD mod's windows) with the player's colours in place of the palette's. */
function bmpPlayer(bytes: Uint8Array, players: Uint8Array, player: number): Texture {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = v.getUint32(10, true);
  const header = v.getUint32(14, true);
  const width = v.getInt32(18, true);
  const rawH = v.getInt32(22, true);
  const height = Math.abs(rawH);
  const base = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const at = 14 + header + i * 4;
    base.set([bytes[at + 2], bytes[at + 1], bytes[at], 255], i * 4);
  }
  const pal = player >= 0 && player < 8 ? playerPalette(base, players, player) : base;
  const stride = (width + 3) & ~3;
  const img = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    const row = offset + (rawH > 0 ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      const c = bytes[row + x] * 4;
      img.data.set([pal[c], pal[c + 1], pal[c + 2], 255], (y * width + x) * 4);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(img, 0, 0);
  return Texture.from(canvas);
}

/**
 * A button from an original DEF: frame 0 normal, 1 pressed, 2 disabled, 3 highlighted
 * (when the DEF has them). `hint` goes to the status bar on hover.
 */
/** What common buttons do, for right-click help when a button has no hint of its own (shown through `buttonWords`). */
// i18n-keys
export const BUTTON_HELP: Record<string, string> = {
  "iok6432.def": "Okay: close this window.",
  "iokay.def": "Okay.",
  "iokay32.def": "Okay.",
  "icancel.def": "Cancel.",
  "icn6432.def": "Cancel.",
  "tpmage1.def": "Exit this window.",
  "iby6432.def": "Buy.",
  "ibuy30.def": "Recruit all the creatures you can afford.",
  "ircbtns.def": "Maximum: as many as you can afford.",
  "scnrblf.def": "Fewer.",
  "scnrbrt.def": "More.",
  "igpcrdiv.def": "Fewer or more.",
  "tpmrkb.def": "Make the trade.",
  "tptav01.def": "Recruit the selected hero.",
  "tptav02.def": "Thieves' Guild: how you compare with the other players.",
  "altsacr.def": "Sacrifice what is on the altar.",
  "altarmy.def": "Put everything on the altar.",
  "altembk.def": "Put the backpack's artifacts on the altar.",
  "altfill.def": "Put all artifacts on the altar.",
  "vwpuz.def": "Puzzle map: the obelisks' clues to the Grail.",
  "cbbegib.def": "Begin the scenario.",
  "cbcancb.def": "Back to the campaign list.",
  "cmpscan.def": "Leave the campaign screen.",
  "ovbutn1.def": "Show your heroes.",
  "ovbutn6.def": "Show your towns.",
  // The adventure HUD's buttons, if HELP.TXT is missing (their rollover text is the original's).
  "iam000.def": "Next Hero",
  "iam001.def": "End Turn",
  "iam002.def": "Kingdom Overview",
  "iam004.def": "Quest Log",
  "iam005.def": "Sleep Hero",
  "iam006.def": "Move Hero",
  "iam007.def": "Cast Spell",
  "iam008.def": "Adventure Options",
  "iam009.def": "System Options",
  "iam010.def": "Surface/Underworld View",
  "iam011.def": "Wake Hero",
  "iam012.def": "Scroll Hero List",
  "iam013.def": "Scroll Hero List",
  "iam014.def": "Scroll Town List",
  "iam015.def": "Scroll Town List",
  "icm011.def": "Next creature to place.",
  "icm012.def": "Start the battle.",
};

/** HELP.TXT rows (hover, right-click text), once loaded; in Polish and German the packs' words over them. */
let helpRows: string[][] = [];
let helpEnglish: string[][] = [];
let helpLang = "";
/** HELP.TXT rows the language's pack lacks (drawn in English): noted when shown. */
let helpMissing = new Set<number>();
export async function loadButtonHelp() {
  if (!helpEnglish.length) helpEnglish = legacyRows(await fetchEnglish("help.txt").catch(() => new Uint8Array()));
  const l = lang();
  if (helpLang === l && helpRows.length) return;
  const words = await packLines("help");
  helpRows = words ? helpEnglish.map((r, i) => [words[i] ?? r[0], words[`${i}.help`] ?? r[1], ...r.slice(2)]) : helpEnglish;
  helpMissing = new Set(words ? helpEnglish.flatMap((r, i) => (words[i] === undefined && /[A-Za-z]{2}/.test(r[0] ?? "") ? [i] : [])) : []);
  helpLang = l;
}
/** The original's texts for a button DEF, when known. */
export function buttonHelp(def: string): { hover: Text; help: Text } | undefined {
  return helpRow(HELP_IDS[def.toLowerCase()] ?? MORE_HELP_IDS[def.toLowerCase()] ?? -1);
}
/** HELP.TXT rows of buttons VCMI's sources don't name (so not in the generated HELP_IDS): the recruit window's
 *  Maximum (553), the marketplace's Trade (595), the altar's backpack-to-altar (570). */
const MORE_HELP_IDS: Record<string, number> = { "ircbtns.def": 553, "tpmrkb.def": 595, "altembk.def": 570 };
/** A HELP.TXT row by number (VCMI's zelp), once loaded: its rollover text and its right-click text. */
export function helpRow(id: number): { hover: Text; help: Text } | undefined {
  const row = helpRows[id];
  if (!row) return undefined;
  if (helpMissing.has(id)) noteEnglish(row[0] ?? "", `help.txt row ${id}: no line in the ${lang()} pack`);
  // Some sections lead with an id column ("HERO_SPEED_CANTER_ID,", "SMALL_FILTER ", "VIDEO_QUALITY_LOW")
  // and have one text after it: the rollover is its {title} (or all of it), the right-click text all of it.
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+[ ,]*$|^[A-Z][A-Z0-9_]*[ ,]+$/.test(row[0] ?? "") && row[1]) {
    const title = /^\{([^}]*)\}/.exec(row[1]);
    return { hover: said(title ? title[1] : row[1]), help: said(row[1]) };
  }
  return { hover: said((row[0] ?? "").replace(/[{}]/g, "")), help: said(row[1] ?? "") };
}

/** A common button's words (BUTTON_HELP) in the player's language. */
export const buttonWords = (def: string): Text | undefined => {
  const en = BUTTON_HELP[def.toLowerCase()];
  return en ? tr(en) : undefined;
};

/**
 * A window's control with its HELP.TXT row (VCMI's zelp, "core.help.<id>"): the rollover text goes to
 * `onHint` (the status bar under the window), the right-click text is shown while the button is held.
 * `fallback`: our words when HELP.TXT is missing. Call after loadButtonHelp().
 */
export function withHelp<T extends DefButton>(b: T, id: number, ours: string, onHint?: (text: Text) => void): T {
  const row = helpRow(id);
  b.hint = row?.hover || english(ours, `help ${id}`);
  b.help = row?.help || english(ours, `help ${id}`);
  if (onHint) b.onHint = onHint;
  return b;
}

/**
 * The same for a control that isn't a DefButton (a volume bar, a choice box): hover text while the
 * pointer is over it, right-click text while the right button is held. `at`: the row for a pointer
 * position (local to `target`), e.g. a volume bar's step.
 */
export function hoverHelp(target: Container, at: (x: number, y: number) => { hover: Text; help: Text }, onHint?: (text: Text) => void) {
  let hideHelp: (() => void) | null = null;
  const local = (e: { getLocalPosition: (c: Container) => { x: number; y: number } }) => {
    const p = e.getLocalPosition(target);
    return at(p.x, p.y);
  };
  target.on("pointerover", (e) => onHint?.(local(e).hover));
  target.on("pointermove", (e) => onHint?.(local(e).hover));
  target.on("pointerout", () => onHint?.(said("")));
  target.on("rightdown", (e) => {
    if (!DefButton.showHelp) return;
    hideHelp = DefButton.showHelp(local(e).help, e.global.x, e.global.y);
  });
  const up = () => (hideHelp?.(), (hideHelp = null));
  target.on("pointerup", up).on("pointerupoutside", up);
}

/**
 * A hit area of w x h grown to a finger (screen.ts FINGER_CSS) each way on touch screens, centred, worked out
 * from the target's scale on the screen at each tap (feedback/bundle.ts calls refresh to measure it).
 */
export class FingerArea extends Rectangle {
  private readonly target: Container;
  private readonly w: number;
  private readonly h: number;
  private readonly x0: number;
  private readonly y0: number;

  constructor(target: Container, w: number, h: number, x0 = 0, y0 = 0) {
    super(x0, y0, w, h);
    this.target = target;
    this.w = w;
    this.h = h;
    this.x0 = x0;
    this.y0 = y0;
  }

  refresh(): this {
    const t = this.target.worldTransform;
    const k = Math.hypot(t.a, t.b) * screenSize.css || 1;
    const ew = screenSize.touch ? Math.max(this.w, FINGER_CSS / k) : this.w;
    const eh = screenSize.touch ? Math.max(this.h, FINGER_CSS / k) : this.h;
    this.x = this.x0 + (this.w - ew) / 2;
    this.y = this.y0 + (this.h - eh) / 2;
    this.width = ew;
    this.height = eh;
    return this;
  }

  override contains(x: number, y: number): boolean {
    this.refresh();
    return super.contains(x, y);
  }
}

/**
 * Buttons whose pictures come raised in frame 1 and sunk in frame 0 (VCMI's settings and battle options windows give
 * them imageOrder [1, 0, 2, 3]): the option windows' gold word buttons. Drawn in their own order they looked pressed in
 * all the time (2026-10-30 19:21: "most of them appear pressed in, in this menu and in battle menu").
 */
const DEF_ORDER: Record<string, number[]> = Object.fromEntries(
  ["soload.def", "sosave.def", "sorstrt.def", "somain.def", "soretrn.def", "soquit.def", "codefaul.def"].map((d) => [d, [1, 0, 2, 3]]),
);

export class DefButton extends Container {
  /** Shows right-click help (set once by the app); returns what hides it again. */
  static showHelp: ((text: Text, x: number, y: number) => () => void) | null = null;
  private frames: DefTextures | null = null;
  private readonly face = new Sprite();
  private enabled = true;
  private down = false;
  onClick: () => void = () => {};
  /** A tap while greyed: says why (explain); EXTRAS greyedWhy. */
  private whyNot: (() => void) | null = null;
  onHint: (text: Text) => void = () => {};
  hint: Text = NONE;
  /** Right-click text, when not the DEF's own HELP.TXT row (a DEF used by different windows). */
  help: Text = NONE;
  readonly def: string;
  /** Resolves once the art is in (its size known). */
  readonly ready: Promise<void>;
  /** The art is in (or failed): `ready` has resolved. */
  loaded = false;

  /** Frames for normal, pressed, disabled, highlighted (VCMI's setImageOrder), when not 0..3. */
  private readonly order: number[];

  /** Touch screens: the art's box grown to FINGER_CSS each way (in its own pixels), centred on it. */
  fingerBox(): Rectangle {
    const w = this.face.width;
    const h = this.face.height;
    const k = Math.hypot(this.worldTransform.a, this.worldTransform.b) * screenSize.css || 1;
    const ew = Math.max(w, FINGER_CSS / k);
    const eh = Math.max(h, FINGER_CSS / k);
    const r = new Rectangle((w - ew) / 2, (h - eh) / 2, ew, eh);
    // Not into a sideways phone's navigation bar.
    if (phoneSized() && !screenSize.portrait && ew > w) {
      const edge = this.toLocal({ x: screenSize.w - navBarRight(), y: 0 }).x;
      if (r.x + r.width > edge) r.width = Math.max(w, edge - r.x);
    }
    return r;
  }

  /** Where a tap reaches, on the stage (feedback/bundle.ts uiTree measures this). */
  tapBounds(): { x: number; y: number; width: number; height: number } | null {
    if (!screenSize.touch) return null;
    const r = this.fingerBox();
    const a = this.toGlobal({ x: r.x, y: r.y });
    const b = this.toGlobal({ x: r.x + r.width, y: r.y + r.height });
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  }

  /**
   * Buttons keep their own colours: their art uses palette slots 224-255 for its own gold and brown, so
   * painting the player's ramp there turned the OK, split and cancel buttons blue, green or red. Only the
   * adventure panel's own buttons (iam*.def, red on the red panel) follow the player, as in the original.
   */
  constructor(def: string, x: number, y: number, player = -1, order?: number[]) {
    super();
    block(this, "button");
    this.def = def;
    this.order = order ?? DEF_ORDER[def.toLowerCase()] ?? [0, 1, 2, 3];
    this.position.set(x, y);
    this.addChild(this.face);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.ready = (player >= 0 && /^iam\d+\.def$/i.test(def) ? loadDefPlayer(def, player) : loadDef(def))
      // HotA's / HD's own buttons (Min, Max, Exchange) without HotA's files: our drawn faces (drawnButtons.ts).
      .catch(async (e) => (await drawnDef(def)) ?? Promise.reject(e))
      .then((f) => {
        // Gone before its art arrived (a panel redrawn meanwhile).
        if (this.destroyed) return;
        this.frames = f;
        this.paint();
      })
      .catch(() => {})
      .finally(() => (this.loaded = true));
    // Touch screens: a finger's reach around the art, however small the window draws it.
    if (screenSize.touch)
      this.hitArea = {
        contains: (x: number, y: number) => {
          const r = this.fingerBox();
          return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
        },
      };
    let hideHelp: (() => void) | null = null;
    // Right button (a finger held still, touch.ts): what this button does, while held (as in the original), greyed or
    // not. As "rightdown", the hold's own event, so a HUD widget that moves when held leaves it be (map/hud/arrange.ts).
    this.on("rightdown", (e) => {
      // The original's right-click text first, else ours.
      const text = this.help || buttonHelp(this.def)?.help || this.hint || buttonWords(this.def);
      if (text && DefButton.showHelp) hideHelp = DefButton.showHelp(text, e.global.x, e.global.y);
    });
    this.on("pointerdown", (e) => {
      if (!this.enabled || e.button !== 0) return;
      // The original's click as the button goes down.
      void playSound("button");
      this.down = true;
      this.paint();
    });
    const up = () => {
      hideHelp?.();
      hideHelp = null;
      this.down = false;
      this.paint();
    };
    this.on("pointerup", up);
    this.on("pointerupoutside", up);
    this.on("pointertap", (e) => {
      if (e.button !== 0) return;
      if (!this.enabled) return void (this.whyNot && extra("greyedWhy") && this.whyNot());
      track(`button:${this.def.toLowerCase().replace(/\.def$/, "")}`);
      this.onClick();
    });
    this.on("pointerover", () => this.onHint(this.hint || buttonHelp(this.def)?.hover || buttonWords(this.def) || NONE));
    this.on("pointerout", () => this.onHint(said("")));
  }

  /** What this button is, in words (voice notes tell a model what's on screen with it). */
  describe(): string {
    return this.hint || buttonHelp(this.def)?.hover || buttonWords(this.def) || this.def.replace(/\.def$/i, "");
  }

  /**
   * Why the button is greyed, told by a tap on it (a message box with OK): the build window's "Cannot build", the
   * Upgrade's "Not enough resources"... `reason` is asked at the tap; nothing is said when it returns nothing.
   */
  explain(modals: Modals, player: number, reason: () => Text | null | undefined): this {
    this.whyNot = () => {
      const t = reason();
      if (t) void messageBox(modals, t, player);
    };
    return this;
  }

  get disabled(): boolean {
    return !this.enabled;
  }

  set disabled(v: boolean) {
    this.enabled = !v;
    this.cursor = v && !(this.whyNot && extra("greyedWhy")) ? "default" : "pointer";
    this.paint();
  }

  private paint() {
    if (this.destroyed) return;
    const all = this.frames?.get(0) ?? [];
    const frames = this.order.map((i) => all[i]);
    const f = !this.enabled ? (frames[2] ?? frames[0]) : this.down ? (frames[1] ?? frames[0]) : frames[0];
    if (!f) return;
    this.face.texture = f.texture;
    this.face.position.set(f.x, f.y);
    this.face.alpha = !this.enabled && !frames[2] ? 0.5 : 1;
  }
}

/**
 * A 1-pixel gold line round a button standing on a picture with no frame for it (VCMI's
 * CButton::setBorderColor(Colors::METALLIC_GOLD): the puzzle map's and the Thieves' Guild's).
 */
export function goldBorder<T extends DefButton>(b: T): T {
  void b.ready.then(() => {
    const w = Math.round(b.width);
    const h = Math.round(b.height);
    b.addChild(new Graphics().rect(-1, -1, w + 2, 1).rect(-1, h, w + 2, 1).rect(-1, 0, 1, h).rect(w, 0, 1, h).fill(0xad8e42));
  });
  return b;
}

/** Text in an original font. */
export function label(text: Text, font: FontName = "medfont", color: readonly [number, number, number] = WHITE, align: "left" | "center" = "left", width?: number): GameText {
  const t = new GameText(font, color as [number, number, number], align, width);
  t.value = text;
  return t;
}

/**
 * A stack's count in its portrait's bottom-right corner, as every army slot of the original
 * (VCMI's CGarrisonSlot: BOTTOMRIGHT, the tiny font on small portraits). `w` x `h`: the slot.
 */
/**
 * The original's frame round a picked stack: TWCRPORT's frame 1 over a big portrait (58x64),
 * CPRSMALL's over a small one (32x32), as VCMI's CGarrisonSlot draws it.
 */
export async function armySelection(size: "large" | "small"): Promise<Container> {
  const f = (await loadDef(size === "large" ? "twcrport.def" : "cprsmall.def").catch(() => null))?.get(0)?.[1];
  if (f) return Object.assign(new Sprite(f.texture), { x: f.x, y: f.y });
  const [w, h] = size === "large" ? [58, 64] : [32, 32];
  return new Graphics().rect(0, 0, w, h).stroke({ color: 0xffff00, width: 2 });
}

export function slotCount(count: number, w: number, h: number, font: FontName = "smalfont"): GameText {
  const n = label(said(formatMetric(count)), font, WHITE);
  n.position.set(w - 2 - n.width, h - (font === "tiny" ? 10 : 15));
  return n;
}

/**
 * A dialog window: the original tiled background (DIBOXBCK) inside the
 * player-coloured DIALGBOX border (corners 0-3, edges 4-7: left, right, top, bottom).
 */
export async function windowFrame(width: number, height: number, player: number): Promise<Container> {
  const c = new Container();
  const [bg, border] = await Promise.all([loadImage("diboxbck.pcx"), loadDefPlayer("dialgbox.def", Math.max(0, player))]);
  const tile = new TilingSprite({ texture: bg, width, height });
  c.addChild(tile);
  const f = border.get(0) ?? [];
  const tex = (i: number) => f[i]?.texture ?? Texture.EMPTY;
  const cw = f[0]?.texture.width ?? 64;
  const ch = f[0]?.texture.height ?? 64;
  const edge = (i: number, x: number, y: number, w: number, h: number) => {
    const t = new TilingSprite({ texture: tex(i), width: w, height: h });
    t.position.set(x, y);
    c.addChild(t);
  };
  const ew = f[4]?.texture.width ?? 32;
  const eh = f[6]?.texture.height ?? 32;
  edge(4, 0, ch, ew, height - 2 * ch);
  edge(5, width - (f[5]?.texture.width ?? ew), ch, f[5]?.texture.width ?? ew, height - 2 * ch);
  edge(6, cw, 0, width - 2 * cw, eh);
  edge(7, cw, height - (f[7]?.texture.height ?? eh), width - 2 * cw, f[7]?.texture.height ?? eh);
  const corner = (i: number, x: number, y: number) => {
    const s = new Sprite(tex(i));
    s.position.set(x, y);
    c.addChild(s);
  };
  corner(0, 0, 0);
  corner(1, width - cw, 0);
  corner(2, 0, height - ch);
  corner(3, width - cw, height - ch);
  return c;
}

/**
 * Buttons the original has art for (the game speaks in pictures, not words): a textButton with one
 * of these names draws that DEF instead, as big as its box allows. [def, frames (normal, pressed,
 * disabled, highlighted)].
 */
const BUTTON_ART: Record<string, [string, number[]?]> = {
  OK: ["iokay.def"],
  Close: ["iokay.def"],
  Back: ["iokay.def"],
  Done: ["iokay.def"],
  Cancel: ["icancel.def"],
  Max: ["ircbtns.def"],
  Recruit: ["iby6432.def"],
  Learn: ["iby6432.def"],
  Hire: ["tptav01.def"],
  "Thieves' Guild": ["tptav02.def"],
  Trade: ["tpmrkb.def", [0, 1, 2]],
  Give: ["tpmrkb.def", [0, 1, 2]],
  // The marketplace's modes: give to another player, back to trading.
  "Give to players": ["tpmrkbu1.def"],
  "Trade resources": ["tpmrkbu5.def"],
  Split: ["idv6432.def"],
  // HD's exchange icon (two arrows chasing round): the town's two heroes' exchange window.
  Exchange: ["hd_xchng.def", [0, 1, 0, 0]],
  Quests: ["hsbtns4.def"],
  Dismiss: ["hsbtns2.def"],
  "<": ["hsbtns3.def"],
  // A count down or up (recruiting, trading): the original's arrows, as its sliders' ends.
  "-": ["hsbtns3.def"],
  "+": ["hsbtns5.def"],
  ">": ["hsbtns5.def"],
  "Next stack": ["icm011.def"],
  "Start battle": ["icm012.def"],
  Menu: ["icm003.def"],
  // The option windows' buttons (their phone pages put them in the column).
  "Load Game": ["soload.def"],
  "Save Game": ["sosave.def"],
  "Restart Scenario": ["sorstrt.def"],
  "Main Menu": ["somain.def"],
  Return: ["soretrn.def"],
  Default: ["codefaul.def"],
  // The main menu's Quick game (an addition): the scenario screen's gold BEGIN, the original's own word for starting a game at once.
  "Quick game": ["scnrbeg.def"],
  // The build window's yes (VCMI's CBuildingRect window: IOKAY / ICANCEL).
  Build: ["iokay.def"],
  // The Kingdom Overview's own buttons (OVBUTN1's heroes, OVBUTN6's towns), for its phone page's tabs.
  Heroes: ["ovbutn1.def", [0, 1, 2]],
  Towns: ["ovbutn6.def"],
};

/** Buttons with no art of their own: the original's picture for the job on the brown button, never a word. */
const BUTTON_PICTURE: Record<string, [def: string, frame: number]> = {
  // The income tab: the treasury's gold (RESOURCE 6).
  Income: ["resource.def", 6],
};

let blankArt: (Texture | null)[] | null = null;
/** Loads the brown button's art (IOKAY's two frames) once, for blankButtonNow. */
export async function preloadBlankButton(): Promise<void> {
  if (blankArt) return;
  const d = await loadDef("iokay.def").catch(() => null);
  blankArt = [d?.get(0)?.[0]?.texture ?? null, d?.get(0)?.[1]?.texture ?? null];
}

/**
 * The original's brown button without its symbol, any size: the OK button's (IOKAY) corners and
 * edges around its plain leather, tiled; frame 1 (pressed) when `down`.
 */
export async function blankButton(width: number, height: number, down = false): Promise<Container> {
  await preloadBlankButton();
  return blankButtonNow(width, height, down);
}

/** blankButton once its art is in (preloadBlankButton); a dark box before that. */
export function blankButtonNow(width: number, height: number, down = false): Container {
  const c = new Container();
  const f = blankArt?.[down ? 1 : 0];
  if (!f) {
    c.addChild(new Graphics().rect(0, 0, width, height).fill({ color: 0x1e140a }).stroke({ color: 0, width: 2 }));
    return c;
  }
  const cut = (x: number, y: number, w: number, h: number) => cutPart(f, { x, y, w, h });
  const W = f.frame.width;
  const H = f.frame.height;
  const E = 3;
  // The leather left of the tick, as the face.
  const face = cut(E, E, 12, H - 2 * E);
  const tile = (t: Texture, x: number, y: number, w: number, h: number) => Object.assign(new TilingSprite({ texture: t, width: Math.max(0, w), height: Math.max(0, h) }), { x, y });
  c.addChild(
    tile(face, E, E, width - 2 * E, height - 2 * E),
    tile(cut(E, 0, 12, E), E, 0, width - 2 * E, E),
    tile(cut(E, H - E, 12, E), E, height - E, width - 2 * E, E),
    tile(cut(0, E, E, 12), 0, E, E, height - 2 * E),
    tile(cut(W - E, E, E, 12), width - E, E, E, height - 2 * E),
    Object.assign(new Sprite(cut(0, 0, E, E)), { x: 0, y: 0 }),
    Object.assign(new Sprite(cut(W - E, 0, E, E)), { x: width - E, y: 0 }),
    Object.assign(new Sprite(cut(0, H - E, E, E)), { x: 0, y: height - E }),
    Object.assign(new Sprite(cut(W - E, H - E, E, E)), { x: width - E, y: height - E }),
  );
  return c;
}

/** The English name in `table` that `text` is, or a translation of. */
function artName(text: string, table: Record<string, unknown>): string {
  if (table[text]) return text;
  // (trIn: a lookup, not a text drawn, so a key without a line isn't noted as English shown.)
  return Object.keys(table).find((k) => trIn(lang() as Lang, k) === text) ?? untr(text);
}

/**
 * Touch layout: a button with a word on it, on the original's brown button (blankButton), for
 * what the original has no button for; the original's own button when it has one for that word
 * (BUTTON_ART).
 */
export async function textButton(text: Text, width: number, height: number, onTap: () => void, font: FontName = "bigfont", held = false): Promise<Container> {
  // (The art is found by the English name: the button's text may be a translation. Asked by translating each name,
  // not by untr: two English lines with one translation ("Start battle", "Start the battle": "Rozpocznij bitwę") gave
  // the other's name, and Polish tactics got a brown word button beside the gold Next stack: the owner's note 2026-10-29 00:50.)
  const art = BUTTON_ART[artName(text, BUTTON_ART)];
  if (art) {
    const b = new DefButton(art[0], 0, 0, -1, art[1]);
    await b.ready;
    if (b.width > 0) {
      // The box stays the caller's (its layout), the art centred in it at the largest whole fit.
      const c = new Container();
      c.label = `button: ${text}`;
      const k = Math.min(width / b.width, height / b.height);
      b.scale.set(k);
      b.position.set(Math.round((width - b.width) / 2), Math.round((height - b.height) / 2));
      b.hint = text;
      // A picked tab: the original's gold selection round the art.
      const pick = held ? new Graphics().rect(b.x - 2, b.y - 2, b.width + 4, b.height + 4).stroke({ color: 0xffe070, width: 2 }) : null;
      b.onClick = () => {
        track(`text:${text}`);
        onTap();
      };
      const hit = new Graphics().rect(0, 0, width, height).fill({ color: 0, alpha: 0.001 });
      hit.eventMode = "static";
      hit.cursor = "pointer";
      // A tap beside the art, inside the box, counts too (fingers).
      hit.on("pointertap", () => (void playSound("button"), b.emit("pointertap", { button: 0 } as never)));
      c.addChild(hit, b);
      if (pick) c.addChild(pick);
      return c;
    }
    b.destroy();
  }
  const c = new Container();
  c.label = `button: ${text}`;
  const [up, pressed] = await Promise.all([blankButton(width, height), blankButton(width, height, true)]);
  pressed.visible = false;
  c.addChild(up, pressed);
  const picture = BUTTON_PICTURE[artName(text, BUTTON_PICTURE)];
  const pic = picture ? (await loadDef(picture[0]).catch(() => null))?.get(0)?.[picture[1]]?.texture : undefined;
  const t: Container = pic ? new Sprite(pic) : label(text, font, YELLOW, "center", width - 12);
  if (pic) t.scale.set(Math.min((width - 12) / pic.width, (height - 8) / pic.height));
  else (t as GameText).fit(width - 12);
  t.position.set(Math.round((width - t.width) / 2), Math.round((height - t.height) / 2));
  c.addChild(t);
  c.eventMode = "static";
  c.cursor = "pointer";
  // Pressed as the original's: the down frame, the word a pixel lower.
  // A picked tab or a switch that's on stays held down, as the original's toggles.
  const press = (on: boolean) => ((pressed.visible = on || held), (up.visible = !(on || held)), (t.y = Math.round((height - t.height) / 2) + (on || held ? 1 : 0)));
  press(false);
  // ... framed in the original's gold selection (a held button alone hardly shows).
  if (held) c.addChild(new Graphics().rect(1, 1, width - 2, height - 2).stroke({ color: 0xffe070, width: 2 }));
  c.on("pointerdown", () => press(true));
  c.on("pointerup", () => press(false));
  c.on("pointerupoutside", () => press(false));
  c.on("pointertap", () => {
    void playSound("button");
    track(`text:${text}`);
    onTap();
  });
  return block(c, "wordButton");
}

/** Greys a textButton out (the original's disabled frame when it is drawn with art) or back. */
export function setEnabled(button: Container, on: boolean) {
  const art = button.children.find((c): c is DefButton => c instanceof DefButton);
  if (art) art.disabled = !on;
  else button.alpha = on ? 1 : 0.5;
}

/**
 * HD-style drag and drop (mouse or finger) of a slot's picture: past a few pixels a copy of its sprites
 * follows the pointer on `layer`; letting go calls `drop` with the global point. The returned check is
 * true once for the tap a drag ends with, so the slot's own tap handler can ignore it.
 */
export function dragSource(c: Container, layer: Container, drop: (x: number, y: number) => void): () => boolean {
  let start: { x: number; y: number } | null = null;
  let ghost: Container | null = null;
  let dragged = false;
  const move = (e: { global: { x: number; y: number } }) => {
    if (!start) return;
    const p = e.global;
    if (!ghost && Math.hypot(p.x - start.x, p.y - start.y) < 10) return;
    if (!ghost) {
      ghost = new Container();
      for (const child of c.children) if (child instanceof Sprite) ghost.addChild(new Sprite(child.texture));
      ghost.alpha = 0.75;
      layer.addChild(ghost);
    }
    const b = c.getLocalBounds();
    const local = layer.toLocal(p);
    ghost.position.set(local.x - b.width / 2, local.y - b.height / 2);
  };
  const up = (e: { global: { x: number; y: number } }) => {
    c.off("globalpointermove", move);
    start = null;
    if (!ghost) return;
    ghost.destroy({ children: true });
    ghost = null;
    dragged = true;
    setTimeout(() => (dragged = false), 0);
    drop(e.global.x, e.global.y);
  };
  c.on("pointerdown", (e) => {
    // The right button (or a finger's long press, see touch.ts) shows info instead: no drag then.
    if (e.button !== 0) return void (ghost ? undefined : (start = null));
    start = { x: e.global.x, y: e.global.y };
    c.on("globalpointermove", move);
  });
  c.on("pointerup", up);
  c.on("pointerupoutside", up);
  return () => (dragged ? ((dragged = false), true) : false);
}

/** The first of `slots` whose on-screen box holds the global point. */
export function slotAt<T>(slots: { c: Container; ref: T }[], x: number, y: number): T | undefined {
  return slots.find((s) => !s.c.destroyed && s.c.getBounds().containsPoint(x, y))?.ref;
}

/**
 * The original windows' small numbers and notes (prices, counts): SMALFONT, and on a phone the medium font, readable at
 * the phone's size (EXTRAS phoneNumbers). One place for the Recruit, Build, Blacksmith, Shipyard, Tavern and Hill Fort.
 */
export const smallFont = (): FontName => (screenSize.touch && phoneSized() && extra("phoneNumbers") ? "medfont" : "smalfont");
