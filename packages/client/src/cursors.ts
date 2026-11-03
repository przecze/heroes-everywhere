import { decodeDef, indexedToRgba } from "@heroes/formats";
import { fetchRes } from "./assets.ts";
import { onCssScale, screenSize } from "./ui/screen.ts";
import { AdvCursor } from "./advCursor.ts";

/** One cursor picture: the decoded frame and its hotspot in the art's own pixels. */
type Frame = { canvas: HTMLCanvasElement; hx: number; hy: number; fallback: string; made: Map<number, string> };

function frameOf(f: { width: number; height: number; pixels: Uint8Array }, palette: Parameters<typeof indexedToRgba>[1], hx: number, hy: number, fallback = "auto"): Frame {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, f.width);
  canvas.height = Math.max(1, f.height);
  canvas.getContext("2d")!.putImageData(new ImageData(indexedToRgba(f.pixels, palette) as Uint8ClampedArray<ArrayBuffer>, f.width, f.height), 0, 0);
  return { canvas, hx, hy, fallback, made: new Map() };
}

/** Browsers drop cursor images bigger than this (Chrome: 128x128). */
const MAX_CURSOR = 128;

/**
 * How much the cursors are enlarged: the canvas's own scale (screen pixels per game pixel), so the
 * cursor keeps its size against the game as the original's does when run scaled; whole or half steps
 * so it stays crisp. Touch screens show no cursor: 1 there.
 */
export function cursorScale(): number {
  if (typeof matchMedia === "function" && !matchMedia("(any-pointer: fine)").matches) return 1;
  return Math.max(1, Math.round(screenSize.css * 2) / 2);
}

/** CSS cursor value of a frame at the current scale (made once per scale, nearest-neighbour). */
function css(f: Frame | undefined): string {
  if (!f) return "default";
  const k = Math.min(cursorScale(), MAX_CURSOR / Math.max(f.canvas.width, f.canvas.height));
  let v = f.made.get(k);
  if (v) return v;
  let src = f.canvas;
  if (k !== 1) {
    src = document.createElement("canvas");
    src.width = Math.round(f.canvas.width * k);
    src.height = Math.round(f.canvas.height * k);
    const g = src.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.drawImage(f.canvas, 0, 0, src.width, src.height);
  }
  const hx = Math.min(src.width - 1, Math.floor(f.hx * k));
  const hy = Math.min(src.height - 1, Math.floor(f.hy * k));
  v = `url(${src.toDataURL()}) ${hx} ${hy}, ${f.fallback}`;
  f.made.set(k, v);
  return v;
}

/** Frames of CRCOMBAT.DEF. Swords point the way the blow lands. */
export const CombatCursor = {
  Blocked: 0,
  Move: 1,
  Fly: 2,
  Shoot: 3,
  Hero: 4,
  Query: 5,
  Pointer: 6,
  SwordNE: 7,
  SwordE: 8,
  SwordSE: 9,
  SwordSW: 10,
  SwordW: 11,
  SwordNW: 12,
  SwordN: 13,
  SwordS: 14,
  ShootPenalty: 15,
  Catapult: 16,
  Heal: 17,
  Sacrifice: 18,
  Teleport: 19,
  /** The spell cursor (CRSPELL.DEF), after the combat set. */
  Spell: 20,
} as const;

let combat: Frame[] = [];

/** Where each sword's tip is, as a fraction of its frame (NE: top right ... S: bottom middle). */
const SWORD_TIPS: Record<number, [number, number]> = {
  [CombatCursor.SwordNE]: [1, 0],
  [CombatCursor.SwordE]: [1, 0.45],
  [CombatCursor.SwordSE]: [1, 1],
  [CombatCursor.SwordSW]: [0, 1],
  [CombatCursor.SwordW]: [0, 0.45],
  [CombatCursor.SwordNW]: [0, 0],
  [CombatCursor.SwordN]: [0.5, 0],
  [CombatCursor.SwordS]: [0.5, 1],
};

/** Builds CSS cursor values from the game's cursor art. */
export async function loadCursors() {
  if (combat.length) return;
  const def = decodeDef(await fetchRes("crcombat.def"));
  combat = (def.groups.get(0) ?? []).map((f, i) => {
    // The pointer's and the swords' hotspots are their tips (VCMI's getPivotOffsetCombat: the blow
    // lands where the tip points, the sword lying back over the hex it comes from); the rest centred.
    const tip = SWORD_TIPS[i];
    const [hx, hy] = i === CombatCursor.Pointer ? [0, 0] : tip ? [Math.round(tip[0] * (f.width - 1)), Math.round(tip[1] * (f.height - 1))] : [Math.floor(f.width / 2), Math.floor(f.height / 2)];
    return frameOf(f, def.palette, hx, hy);
  });
  const spell = decodeDef(await fetchRes("crspell.def").catch(() => new Uint8Array()));
  const f = spell.groups?.get(0)?.[0];
  if (f) combat[CombatCursor.Spell] = frameOf(f, spell.palette, Math.floor(f.width / 2), Math.floor(f.height / 2));
}

export function combatCursor(i: number): string {
  return css(combat[i]);
}

/** A combat cursor's picture itself (the alternate action's button shows one), once loadCursors is done. */
export function combatCursorPicture(i: number): HTMLCanvasElement | undefined {
  return combat[i]?.canvas;
}

/** A combat cursor's picture with its hotspot (the battle's magnifier draws it), once loadCursors is done. */
export function combatCursorFrame(i: number): { canvas: HTMLCanvasElement; hx: number; hy: number } | undefined {
  const f = combat[i];
  return f && { canvas: f.canvas, hx: f.hx, hy: f.hy };
}

/** Sword cursor for a blow travelling from `from` to `to` (screen coordinates). */
export function swordFor(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI; // 0 = east, 90 = north
  if (deg >= 67.5 && deg < 112.5) return CombatCursor.SwordN;
  if (deg >= -112.5 && deg < -67.5) return CombatCursor.SwordS;
  if (deg >= 22.5 && deg < 67.5) return CombatCursor.SwordNE;
  if (deg >= 112.5 && deg < 157.5) return CombatCursor.SwordNW;
  if (deg >= -67.5 && deg < -22.5) return CombatCursor.SwordSE;
  if (deg >= -157.5 && deg < -112.5) return CombatCursor.SwordSW;
  return Math.abs(deg) < 90 ? CombatCursor.SwordE : CombatCursor.SwordW;
}

export { AdvCursor } from "./advCursor.ts";

let adventure: Frame[] = [];

export async function loadAdventureCursors() {
  if (adventure.length) return;
  const def = decodeDef(await fetchRes("cradvntr.def"));
  adventure = (def.groups.get(0) ?? []).map((f, i) => frameOf(f, def.palette, ...(i === 0 ? [0, 0] : [Math.floor(f.width / 2), Math.floor(f.height / 2)]) as [number, number]));
}

/** CSS cursor for an adventure action `days` turns away (1..4). */
export function adventureCursor(kind: number, days = 1): string {
  const per = [AdvCursor.Move, AdvCursor.Attack, AdvCursor.Sail, AdvCursor.Disembark, AdvCursor.Exchange, AdvCursor.Visit] as number[];
  let i: number = kind;
  if (per.includes(kind)) i = kind + 6 * (Math.min(4, Math.max(1, days)) - 1);
  else if (kind === AdvCursor.SailVisit) i = kind + Math.min(3, Math.max(0, days - 1));
  return css(adventure[i]);
}

/** CRDEFLT.DEF frame 0: the original's arrow, the cursor everywhere off the adventure map and battle field. */
let arrow: Frame | undefined;

/** CSS cursor value of the original's arrow ("default" until the game files load), or the artifact in hand. */
export function defaultCursor(): string {
  return held ?? css(arrow);
}

/**
 * The original never shows the browser's hand or I-beam: over buttons, windows and text boxes the
 * cursor stays its own arrow. Pixi's named cursors ("default", "pointer", "text") all map to it, and the
 * page's game screens (built from HTML) take it through --hota-cursor. Touch screens show no cursor, so
 * nothing changes for them.
 */
export async function installDefaultCursor(events: { cursorStyles: Record<string, unknown>; domElement?: HTMLElement | null }) {
  const def = decodeDef(await fetchRes("crdeflt.def"));
  const f = def.groups.get(0)?.[0];
  if (!f) return;
  // The hotspot is the tip, the frame's top-left pixel.
  arrow = frameOf(f, def.palette, 0, 0, "default");
  let shown = "";
  const apply = () => {
    const v = held ?? css(arrow);
    if (v === shown) return;
    const before = shown;
    shown = v;
    for (const k of ["default", "pointer", "text"]) events.cursorStyles[k] = v;
    document.documentElement.style.setProperty("--hota-cursor", v);
    // Pixi applies a named cursor only when it changes: swap the one already on the canvas.
    const el = events.domElement;
    // (The browser gives a cursor back written its own way, url("..."): compared as it writes it.)
    const asWritten = (c: string) => Object.assign(document.createElement("div").style, { cursor: c }).cursor;
    if (el && ["", "default", "pointer", "text", "inherit", asWritten(before)].includes(el.style.cursor)) el.style.cursor = v;
  };
  applyCursor = apply;
  apply();
  // A resized window enlarges the game: the arrow follows (the map's and battle's cursors are made
  // afresh at their next move).
  onCssScale.add(apply);
}

/** What the cursor carries instead of the arrow (an artifact picked up), or null. */
let held: string | null = null;
let applyCursor = () => {};

/** ARTIFACT.DEF, decoded once for the cursors. */
let artifactDef: Promise<ReturnType<typeof decodeDef> | null> | null = null;
const artifactFrames = new Map<number, Frame>();

/**
 * An artifact picked up on the hero screen or in the exchange is the cursor itself, as in the
 * original (VCMI's dragAndDropCursor: ARTIFACT.DEF's frame, held by its middle); null puts the
 * arrow back. Touch screens have no cursor: nothing changes there.
 */
/** Decodes ARTIFACT.DEF ahead (a window that moves artifacts opening), so the first one picked is on the cursor at once. */
export function artifactCursors() {
  artifactDef ??= fetchRes("artifact.def")
    .then((b) => decodeDef(b))
    .catch(() => null);
  return artifactDef;
}

let holding = 0;
export async function holdArtifactCursor(id: number | null) {
  const mine = ++holding;
  if (id === null || id < 0) {
    held = null;
    return applyCursor();
  }
  const def = await artifactCursors();
  if (mine !== holding) return;
  let f = artifactFrames.get(id);
  const raw = def?.groups.get(0)?.[id];
  if (!f && raw && def) artifactFrames.set(id, (f = frameOf(raw, def.palette, Math.floor(raw.width / 2), Math.floor(raw.height / 2))));
  held = f ? css(f) : null;
  applyCursor();
}
