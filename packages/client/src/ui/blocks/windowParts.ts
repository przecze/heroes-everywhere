// The original's windows as named parts (2026-10-26: "components ... reusing the same components with the same
// styling that we already reproduced for desktop"): each window's picture with its boxes, bands, slots, rims and
// corner knots named and measured once, here. Every layout draws a window's look only through these parts, so the
// phone's hero box is the desktop's hero box, in the player's colours where the original has them (the picture's
// player range, recoloured by loadImagePlayer), and nowhere else. The original paints every box by hand (no two are
// the same), so a part is a cut of the original itself: the desktop placing all of its parts is the original.
// The list of windows still to cut: ROADMAP, "Every original window as named boxes".
import { Container, Rectangle, Sprite, Texture, TilingSprite } from "pixi.js";
import { loadDef, loadImage, textureCanvas } from "../../assets.ts";
import { loadImagePlayer } from "../kit.ts";
import { block } from "./block.ts";

export interface Cut {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowPicture<N extends string = string> {
  /** A picture (PCX, BMP; recoloured to the player's) or a DEF, whose `frame` (group 0) is the picture. */
  file: string;
  frame?: number;
  /** Never in a player's colours (the menus' blue pictures): loaded as they are. */
  plain?: boolean;
  w: number;
  h: number;
  parts: Record<N, Cut>;
}

/** HEROSCR4.PCX, the hero screen (672 x 586). */
export const HEROSCR4 = {
  file: "heroscr4.pcx",
  w: 672,
  h: 586,
  parts: {
    // The head: the portrait's box and the name's box beside it.
    portrait: { x: 18, y: 18, w: 60, h: 65 },
    name: { x: 80, y: 18, w: 220, h: 65 },
    // The skills section under the head: the primary skills, specialty / experience / spell points / morale / luck,
    // the eight secondary skills' boxes (heroBlocks' heroSkills, on every layout).
    skills: { x: 14, y: 86, w: 292, h: 384 },
    // The paper doll and the backpack's row under it.
    doll: { x: 309, y: 14, w: 284, h: 396 },
    // The army's band right of its seventh place: the player's colour, plain enough to tile.
    armyBand: { x: 474, y: 482, w: 124, h: 70 },
    // The column of heroes: its head (the flag's place) and one bordered slot.
    flagHead: { x: 605, y: 4, w: 60, h: 76 },
    heroSlot: { x: 607, y: 83, w: 56, h: 40 },
    // The main panel's rim, 14 deep: the double gold line, the player's colour, the inner gold line and its shadow;
    // its top left knot as two strips along the rim (the window's own boxes begin 18 in), and one pixel of each edge.
    knotTop: { x: 0, y: 0, w: 42, h: 18 },
    knotSide: { x: 0, y: 18, w: 18, h: 24 },
    rimAcross: { x: 60, y: 0, w: 1, h: 14 },
    rimDown: { x: 0, y: 60, w: 14, h: 1 },
  },
} as const satisfies WindowPicture;

/**
 * TRADE3.BMP, the exchange as HotA shows it (the HD mod's, 800 x 600; TRADE2.PCX without its buttons is the plain
 * game's). The first hero's half left, the second's mirrored right; between them the primary skills' column and the
 * quick buttons.
 */
export const TRADE3 = {
  file: "trade3.bmp",
  w: 800,
  h: 600,
  parts: {
    // Each hero's banner in the player's colour (its tail outward) and portrait box.
    bannerLeft: { x: 8, y: 9, w: 249, h: 25 },
    bannerRight: { x: 543, y: 9, w: 249, h: 25 },
    portrait: { x: 255, y: 8, w: 62, h: 67 },
    // One of the small boxes (specialty, experience, spell points, morale, luck; the skills; the army), 36 apart.
    box: { x: 66, y: 40, w: 35, h: 35 },
    // One row of the primary skills' column: the first hero's value, the skill's picture, the second's.
    primaryRow: { x: 322, y: 9, w: 157, h: 26 },
    // The HD mod's quick buttons: the armies' row over the artifacts' (all right, swap, all left).
    quick: { x: 327, y: 119, w: 148, h: 68 },
    // Its two rows apart (upright the exchange puts them apart), and the arrows of the armies' first and last buttons
    // (turned down and up there: exchangeBlocks' armyQuickUpright).
    quickArmy: { x: 327, y: 119, w: 148, h: 33 },
    quickArtifacts: { x: 327, y: 155, w: 148, h: 32 },
    quickArrowsRight: { x: 358, y: 124, w: 16, h: 24 },
    quickArrowsLeft: { x: 428, y: 124, w: 16, h: 24 },
  },
} as const satisfies WindowPicture;

/** TOWNSCRN.PCX, the town's panel under its picture (800 x 226). */
export const TOWNSCRN = {
  file: "townscrn.pcx",
  w: 800,
  h: 226,
  parts: {
    // One place of the garrison's and the visiting hero's rows (the first of each the hero's or the flag's), 62 apart.
    slot: { x: 240, y: 12, w: 60, h: 66 },
    // The gold filigree between the two rows.
    divider: { x: 240, y: 83, w: 496, h: 20 },
    // One of the eight boxes of the creatures' weekly growth.
    growth: { x: 14, y: 84, w: 48, h: 34 },
    // The panel's ground: the player's colour, plain enough to tile.
    colour: { x: 10, y: 201, w: 200, h: 21 },
    // Its rim, 9 deep: the double gold line round the panel; its top left corner and one pixel of each edge.
    rimCorner: { x: 0, y: 0, w: 9, h: 9 },
    rimAcross: { x: 100, y: 0, w: 1, h: 9 },
    rimDown: { x: 0, y: 100, w: 9, h: 1 },
  },
} as const satisfies WindowPicture;

/** OVSLOT.DEF's hero row (frame 4, 700 x 113), the Kingdom Overview's. */
export const OVSLOT_HERO = {
  file: "ovslot.def",
  frame: 4,
  w: 700,
  h: 113,
  parts: {
    portrait: { x: 4, y: 5, w: 61, h: 67 },
    name: { x: 67, y: 5, w: 189, h: 21 },
    // One of the four primary skills' value boxes, and one of the army's seven (36 apart).
    value: { x: 77, y: 57, w: 35, h: 17 },
    army: { x: 4, y: 76, w: 33, h: 35 },
    // Plain leather between the boxes, to tile.
    ground: { x: 70, y: 28, w: 140, h: 26 },
  },
} as const satisfies WindowPicture;

/** TPMRKRES.PCX, the marketplace (600 x 593): one resource's card (the picture over its caption strip). */
export const TPMRKRES = {
  file: "tpmrkres.pcx",
  w: 600,
  h: 593,
  parts: { card: { x: 38, y: 181, w: 71, h: 67 } },
} as const satisfies WindowPicture;

/** TPMRKPTS.PCX, the marketplace's "to a player" page: one player's card (the flag's place over a strip). */
export const TPMRKPTS = {
  file: "tpmrkpts.pcx",
  w: 600,
  h: 593,
  parts: { flag: { x: 332, y: 82, w: 62, h: 89 } },
} as const satisfies WindowPicture;

/** SPELBACK.PCX, the spellbook (in the player's colours, as the desktop's). */
export const SPELBACK = {
  file: "spelback.pcx",
  w: 620,
  h: 595,
  parts: {
    // Both pages with the flags and the bookmarks (sideways); the right-hand page alone (upright).
    spread: { x: 18, y: 62, w: 584, h: 402 },
    half: { x: 296, y: 62, w: 306, h: 402 },
    // The combat spells' bookmark (hung under the right-hand page upright).
    combatMark: { x: 219, y: 404, w: 38, h: 52 },
  },
} as const satisfies WindowPicture;

/**
 * SYSOPBCK.PCX, System Options (481 x 487): its panels, laid out afresh on a phone (ui/mobileOptions.ts): the six
 * settings down the left (hero speed, enemy speed, map scroll speed, video quality, music, effects), the six
 * checkboxes, and Restart / Quit.
 */
export const SYSOPBCK = {
  file: "sysopbck.pcx",
  w: 481,
  h: 487,
  parts: {
    heroSpeed: { x: 22, y: 53, w: 200, h: 62 },
    enemySpeed: { x: 22, y: 119, w: 200, h: 62 },
    scrollSpeed: { x: 22, y: 185, w: 200, h: 62 },
    video: { x: 22, y: 251, w: 200, h: 62 },
    music: { x: 22, y: 338, w: 200, h: 62 },
    effects: { x: 22, y: 403, w: 200, h: 62 },
    check0: { x: 240, y: 51, w: 222, h: 32 },
    check1: { x: 240, y: 83, w: 222, h: 32 },
    check2: { x: 240, y: 115, w: 222, h: 32 },
    check3: { x: 240, y: 147, w: 222, h: 32 },
    check4: { x: 240, y: 179, w: 222, h: 32 },
    check5: { x: 240, y: 211, w: 222, h: 32 },
    restartQuit: { x: 240, y: 352, w: 116, h: 116 },
  },
} as const satisfies WindowPicture;

/** COMOPBCK.PCX, the combat options (481 x 431): its panels, laid out afresh on a phone. */
export const COMOPBCK = {
  file: "comopbck.pcx",
  w: 481,
  h: 431,
  parts: {
    check0: { x: 20, y: 52, w: 208, h: 33 },
    check1: { x: 20, y: 85, w: 208, h: 33 },
    check2: { x: 20, y: 118, w: 208, h: 33 },
    speed: { x: 22, y: 201, w: 200, h: 84 },
    music: { x: 22, y: 283, w: 200, h: 62 },
    effects: { x: 22, y: 348, w: 200, h: 62 },
    autoCombat: { x: 238, y: 54, w: 228, h: 180 },
    creatureInfo: { x: 238, y: 254, w: 228, h: 90 },
  },
} as const satisfies WindowPicture;

/** The rim's depth and the knot's reach (HEROSCR4's main panel). */
export const RIM = 14;
export const KNOT = 42;

/** ADVMAP.PCX, the adventure screen's frame (800 x 600). */
export const ADVMAP = {
  file: "advmap.pcx",
  w: 800,
  h: 600,
  parts: {
    // The info box under the rail's buttons, corners and border included (its filigree corners 24 square).
    panel: { x: 605, y: 389, w: 194, h: 186 },
    // A stretch of the outer rim's top and left edges (7 deep: gold, the player's colour, gold), clear of the corner
    // filigree, and the top left corner.
    rimAcross: { x: 200, y: 0, w: 200, h: 7 },
    rimDown: { x: 0, y: 200, w: 7, h: 200 },
    rimCorner: { x: 0, y: 0, w: 7, h: 7 },
  },
} as const satisfies WindowPicture;

/** GAMSELBK.PCX, the main menu's picture (800 x 600): the parts without words, for the bands above and below it upright. */
export const GAMSELBK = {
  file: "gamselbk.pcx",
  w: 800,
  h: 600,
  parts: {
    // The clouds right of the logo, the sea right of the dragons.
    clouds: { x: 560, y: 0, w: 240, h: 160 },
    sea: { x: 560, y: 300, w: 240, h: 300 },
  },
} as const satisfies WindowPicture;

/**
 * GSELPOP1.PCX, the scenario card beside the menus' lists (370 x 585): the menus' blue window. Its rim (8 deep: two
 * gold lines with black between) and the filigree in its corners, its plain marble, and its recessed boxes (a light
 * bevel round darker marble). The rim's right and bottom edges are its own, not the left and top mirrored.
 */
export const GSELPOP1 = {
  file: "gselpop1.pcx",
  plain: true,
  w: 370,
  h: 585,
  parts: {
    // The bottom corners, rim and filigree (44 square; the top ones are these mirrored, the card's name box reaching
    // into its own top corners), and the top rim's ends over them (the rim's shading is its own on each side).
    cornerBL: { x: 0, y: 541, w: 44, h: 44 },
    cornerBR: { x: 326, y: 541, w: 44, h: 44 },
    rimTopLeft: { x: 0, y: 0, w: 44, h: 8 },
    rimTopRight: { x: 326, y: 0, w: 44, h: 8 },
    // One pixel of each edge of the rim.
    rimTop: { x: 150, y: 0, w: 1, h: 8 },
    rimBottom: { x: 150, y: 577, w: 1, h: 8 },
    rimLeft: { x: 0, y: 300, w: 8, h: 1 },
    rimRight: { x: 362, y: 300, w: 8, h: 1 },
    // Plain marble under the difficulty's pieces, to tile.
    ground: { x: 44, y: 502, w: 282, h: 70 },
    // The scenario's description box: the menus' recessed box (its bevel 4 deep).
    box: { x: 16, y: 123, w: 340, h: 149 },
    // The difficulty's five pieces' boxes.
    pieces: { x: 106, y: 448, w: 164, h: 50 },
  },
} as const satisfies WindowPicture;

/** SCSELBCK.PCX, the scenario list (575 x 585; the card's place on its right is empty). */
export const SCSELBCK = {
  file: "scselbck.pcx",
  plain: true,
  w: 575,
  h: 585,
  parts: {
    // The grid's line under a row (3 deep: its bevel), 25 apart.
    rowLine: { x: 150, y: 140, w: 150, h: 3 },
  },
} as const satisfies WindowPicture;

/** RANMAPBK.PCX, the random map's options (575 x 585): one option's raised card, its title band over its buttons' room. */
export const RANMAPBK = {
  file: "ranmapbk.pcx",
  plain: true,
  w: 575,
  h: 585,
  parts: {
    // The first card ("Human or Computer Players"): the band 24 deep with its line under it, the room 33.
    option: { x: 64, y: 123, w: 316, h: 57 },
  },
} as const satisfies WindowPicture;
/** The depth of a random map card's title band, its line included. */
export const OPTION_BAND = 24;

/**
 * ADOP?PNL.PCX, a player's row in the Advanced Options (336 x 49), one picture per colour (`adopPanel(letter)`, the
 * flags' letters r b y g o p t s), in that colour: the name's box, the "Human or CPU" box and the handicap's (pressed),
 * the town's, hero's and bonus's caption boxes under their pictures, and its plain marble between.
 */
export const adopPanel = (letter: string) =>
  ({
    file: `adop${letter}pnl.pcx`,
    plain: true,
    w: 336,
    h: 49,
    parts: {
      name: { x: 3, y: 0, w: 101, h: 21 },
      kind: { x: 3, y: 21, w: 49, h: 28 },
      handicap: { x: 52, y: 21, w: 52, h: 28 },
      caption: { x: 105, y: 34, w: 75, h: 14 },
      ground: { x: 108, y: 2, w: 226, h: 30 },
    },
  }) as const satisfies WindowPicture;

/**
 * The one place a picture is cut: `c` of `t` (inside its own frame). For the pieces measured elsewhere (a picture's
 * strip by its cells, a button's ends, a frame's repeated middle) and the parts above.
 */
export function cut(t: Texture, c: Cut): Texture {
  return new Texture({ source: t.source, frame: new Rectangle(t.frame.x + c.x, t.frame.y + c.y, c.w, c.h) });
}

/** A part's texture in `player`'s colours (null without the picture, or with a stand-in smaller than the original). */
export async function partTexture<N extends string>(pic: WindowPicture<N>, name: N, player: number): Promise<Texture | null> {
  const t = pic.file.endsWith(".def")
    ? ((await loadDef(pic.file).catch(() => null))?.get(0)?.[pic.frame ?? 0]?.texture ?? null)
    : await (pic.plain ? loadImage(pic.file) : loadImagePlayer(pic.file, Math.max(0, player))).catch(() => null);
  if (!t || t.width < pic.w || t.height < pic.h) return null;
  return cut(t, pic.parts[name]);
}

/** A part as a sprite, `w` x `h` when given (stretched), labelled by its name. */
export async function part<N extends string>(pic: WindowPicture<N>, name: N, player: number, w?: number, h?: number): Promise<Sprite | null> {
  const t = await partTexture(pic, name, player);
  if (!t) return null;
  const s = new Sprite(t);
  s.label = `part: ${name}`;
  if (w) s.width = w;
  if (h) s.height = h;
  return s;
}

/** A part tiled over `w` x `h` (a band, a stretch of leather). */
export async function tiledPart<N extends string>(pic: WindowPicture<N>, name: N, player: number, w: number, h: number): Promise<TilingSprite | null> {
  const t = await partTexture(pic, name, player);
  return t ? Object.assign(new TilingSprite({ texture: t, width: w, height: h }), { label: `part: ${name}` }) : null;
}

/**
 * The original windows' rim (HEROSCR4's; the market's, tavern's and recruit window's are the same) round a `fw` x `fh`
 * panel at 0, 0 (its outside): the edges stretched from one pixel, the top left knot mirrored to every corner. Null
 * without the picture.
 */
export async function windowRim(fw: number, fh: number, player: number): Promise<Container | null> {
  const [across, down, top, side] = await Promise.all((["rimAcross", "rimDown", "knotTop", "knotSide"] as const).map((n) => partTexture(HEROSCR4, n, player)));
  if (!across || !down || !top || !side) return null;
  const c = new Container();
  c.label = "window rim";
  lay(c, across, KNOT, 0, fw - 2 * KNOT, RIM);
  lay(c, across, KNOT, fh - RIM, fw - 2 * KNOT, RIM, { flipY: true });
  lay(c, down, 0, KNOT, RIM, fh - 2 * KNOT);
  lay(c, down, fw - RIM, KNOT, RIM, fh - 2 * KNOT, { flipX: true });
  const { h: th } = HEROSCR4.parts.knotTop;
  for (const [fx, fy] of [[false, false], [true, false], [false, true], [true, true]]) {
    for (const [t, dy] of [[top, 0], [side, th]] as const) lay(c, t, fx ? fw - t.width : 0, fy ? fh - dy - t.height : dy, t.width, t.height, { flipX: fx, flipY: fy });
  }
  return block(c, "windowRim");
}

/**
 * A panel as the town's (TOWNSCRN's): its double gold rim round `w` x `h`, the owner's colour inside. Null without
 * the picture.
 */
export async function townPanel(w: number, h: number, player: number, ground: "colour" | "leather" = "colour"): Promise<Container | null> {
  // (`leather`: the windows' brown (DIBOXBCK) inside the gold rim, for a screen of many panels: the owner, 2026-10-26 21:50,
  // the upright town all in the owner's red was "too much red".)
  const leather = async () => {
    const tex = await loadImage("diboxbck.pcx").catch(() => null);
    return tex ? new TilingSprite({ texture: tex, width: w, height: h }) : tiledPart(TOWNSCRN, "colour", player, w, h);
  };
  const [fill, corner, across, down] = await Promise.all([
    ground === "leather" ? leather() : tiledPart(TOWNSCRN, "colour", player, w, h),
    partTexture(TOWNSCRN, "rimCorner", player),
    partTexture(TOWNSCRN, "rimAcross", player),
    partTexture(TOWNSCRN, "rimDown", player),
  ]);
  if (!fill || !corner || !across || !down) return null;
  return block(townRimOver(fill, { corner, across, down }, w, h), "townPanel");
}

/** TOWNSCRN's double gold rim's pieces in `player`'s colours (null without the picture), for townRimOver. */
export async function townRimParts(player: number): Promise<{ corner: Texture; across: Texture; down: Texture } | null> {
  const [corner, across, down] = await Promise.all((["rimCorner", "rimAcross", "rimDown"] as const).map((n) => partTexture(TOWNSCRN, n, player)));
  return corner && across && down ? { corner, across, down } : null;
}

/** `fill` (w x h) in the town panel's double gold rim, at once (the pieces loaded by townRimParts). */
export function townRimOver(fill: Container, rim: { corner: Texture; across: Texture; down: Texture }, w: number, h: number): Container {
  const { corner, across, down } = rim;
  const c = new Container();
  c.label = "town panel";
  c.addChild(fill);
  const R = TOWNSCRN.parts.rimCorner.w;
  lay(c, across, R, 0, w - 2 * R, R);
  lay(c, across, R, h - R, w - 2 * R, R, { flipY: true });
  lay(c, down, 0, R, R, h - 2 * R);
  lay(c, down, w - R, R, R, h - 2 * R, { flipX: true });
  lay(c, corner, 0, 0, R, R);
  lay(c, corner, w - R, 0, R, R, { flipX: true });
  lay(c, corner, 0, h - R, R, R, { flipY: true });
  lay(c, corner, w - R, h - R, R, R, { flipX: true, flipY: true });
  return c;
}

// The battle's pictures. Their rims are in the player's colour (the picture's player range), as the original
// colours them for whoever watches the battle.

/** CBAR.PCX, the battle's foot bar (800 x 44): the buttons' cells, the console between them. */
export const CBAR = {
  file: "cbar.pcx",
  w: 800,
  h: 44,
  parts: {
    // The console: the message box, its black outline and 2 px rim in the player's colour round plain leather.
    console: { x: 211, y: 4, w: 406, h: 38 },
    // The console's right end, the log's arrows and the Cast cell: HotA's bar has them a slot further left (the
    // alternate action's cell left where Cast was).
    consoleEnd: { x: 617, y: 0, w: 79, h: 44 },
  },
} as const satisfies WindowPicture;

/** CPRESULT.PCX, the battle's result window (470 x 561), its rim in the player's colour. */
export const CPRESULT = {
  file: "cpresult.pcx",
  w: 470,
  h: 561,
  parts: {
    // The attacker's portrait box (the defender's mirrors it at 386): a hero's 58 x 64 portrait at 6, 6 in it.
    portrait: { x: 15, y: 32, w: 69, h: 77 },
    // The film's box (256 x 120 inside its gold line).
    film: { x: 106, y: 69, w: 258, h: 122 },
    // A sideways phone shows the window in two halves side by side, cut above the casualties' title; each half
    // gets the rim's edge where it was cut (10 deep: the rim, not its corner knots).
    top: { x: 0, y: 0, w: 470, h: 288 },
    bottom: { x: 0, y: 288, w: 470, h: 273 },
    topEdge: { x: 0, y: 0, w: 470, h: 10 },
    bottomEdge: { x: 0, y: 551, w: 470, h: 10 },
  },
} as const satisfies WindowPicture;

/**
 * CMNUMWIN.PCX, the plate under a stack's count on the field (30 x 11; tinted for the stack's state). Its ends keep
 * their size, the middle stretches (the damage over a stack: the plate as long as its numbers).
 */
export const CMNUMWIN = {
  file: "cmnumwin.pcx",
  w: 30,
  h: 11,
  parts: {
    left: { x: 0, y: 0, w: 4, h: 11 },
    middle: { x: 4, y: 0, w: 22, h: 11 },
    right: { x: 26, y: 0, w: 4, h: 11 },
  },
} as const satisfies WindowPicture;

/**
 * CMNUMWIN's plate `w` x `h` (`plate`: the picture): its ends as they are, the middle stretched, tinted `tint`. A
 * stand-in plate, smaller than the original, is stretched whole. The battle's floating numbers stand on it.
 */
export function plateStrip(plate: Texture, w: number, h: number, tint = 0xffffff): Container {
  const P = CMNUMWIN.parts;
  const real = plate.width >= CMNUMWIN.w && plate.height >= CMNUMWIN.h;
  const cap = real ? P.left.w : 0;
  const c = new Container();
  c.label = "count plate";
  const piece = (t: Texture, x: number, pw: number) => c.addChild(Object.assign(new Sprite(t), { x, width: pw, height: h, tint }));
  if (real) piece(cut(plate, P.left), 0, cap);
  piece(real ? cut(plate, P.middle) : plate, cap, Math.max(1, w - 2 * cap));
  if (real) piece(cut(plate, P.right), w - cap, cap);
  return c;
}

/**
 * The console's rim on each side: the black outline and the player's colour all round, inside them the recess's
 * shadow and light line on the left and top (5 deep), the light line on the right (3) and bottom (4).
 */
const CONSOLE_RIM: Bevel = { l: 5, t: 5, r: 3, b: 4 };

/**
 * Plain leather (`t`, a cut of it) over `w` x `h`: copies side by side, every other one mirrored, so each meets its
 * neighbour on the same pixels (tiled as it is, a cut's edges show as seams).
 */
export function mirroredLeather(t: Texture, w: number, h: number): Container {
  const c = new Container();
  const tw = t.width;
  const th = t.height;
  for (let j = 0, y = 0; y < h; j++, y += th) {
    for (let i = 0, x = 0; x < w; i++, x += tw) {
      const pw = Math.min(tw, w - x);
      const ph = Math.min(th, h - y);
      const fx = i % 2 === 1;
      const fy = j % 2 === 1;
      // A mirrored copy shows its far side first: the part of it kept is the one that meets the last copy.
      const s = new Sprite(cut(t, { x: fx ? tw - pw : 0, y: fy ? th - ph : 0, w: pw, h: ph }));
      s.scale.set(fx ? -1 : 1, fy ? -1 : 1);
      s.position.set(fx ? x + pw : x, fy ? y + ph : y);
      c.addChild(s);
    }
  }
  return c;
}

/**
 * A box as the battle's console (CBAR's `console` part, `t`), `w` x `h`: its corners as they are, one pixel of
 * each edge stretched along it, its leather inside (mirroredLeather; `ground` for a tall one). The phone's battle rooms (the message, the
 * reading room, the band over the field upright) are this box.
 */
export function consoleBox(t: Texture, w: number, h: number, ground: Texture | null = null): Container {
  const { l, t: tp, r, b } = CONSOLE_RIM;
  const { w: tw, h: th } = CBAR.parts.console;
  // A room taller than a few of the console's own (its leather is 29 high: mirrored over and over it shows as a
  // pattern) gets the windows' leather (DIBOXBCK, made to tile).
  const iw = w - l - r;
  const ih = h - tp - b;
  const leather = ground && ih > 3 * (th - tp - b) ? new TilingSprite({ texture: ground, width: iw, height: ih }) : mirroredLeather(cut(t, { x: l, y: tp, w: tw - l - r, h: th - tp - b }), iw, ih);
  return slicedBox(t, w, h, CONSOLE_RIM, "console box", leather);
}

/**
 * `t` over the `w` x `h` whose top left is `x`, `y` in `c`: stretched, or tiled when `tile`; mirrored in its own box
 * with `flipX` / `flipY`. Every builder here places its cuts with it.
 */
function lay(c: Container, t: Texture, x: number, y: number, w: number, h: number, o: { tile?: boolean; flipX?: boolean; flipY?: boolean } = {}) {
  const s = o.tile ? new TilingSprite({ texture: t, width: w, height: h }) : Object.assign(new Sprite(t), { width: w, height: h });
  // (Pixi's width / height setters keep the sign, so the mirror is set after them.)
  if (o.flipX) s.scale.x = -Math.abs(s.scale.x);
  if (o.flipY) s.scale.y = -Math.abs(s.scale.y);
  s.position.set(o.flipX ? x + w : x, o.flipY ? y + h : y);
  c.addChild(s);
}

/**
 * The menus' blue window (GSELPOP1's) over `w` x `h` (88 square at least): its marble tiled, the rim's edges
 * stretched from a pixel, its four corners with their filigree each as the original's. Null without the picture.
 */
export async function menuPanel(w: number, h: number): Promise<Container | null> {
  const names = ["ground", "rimTop", "rimBottom", "rimLeft", "rimRight", "cornerBL", "cornerBR", "rimTopLeft", "rimTopRight"] as const;
  const [ground, top, bottom, left, right, bl, br, tl, tr] = await Promise.all(names.map((n) => partTexture(GSELPOP1, n, -1)));
  if (!ground || !top || !bottom || !left || !right || !bl || !br || !tl || !tr) return null;
  const c = new Container();
  c.label = "menu panel";
  const R = GSELPOP1.parts.rimTop.h;
  const K = GSELPOP1.parts.cornerBL.w;
  lay(c, ground, R, R, w - 2 * R, h - 2 * R, { tile: true });
  lay(c, top, K, 0, w - 2 * K, R);
  lay(c, bottom, K, h - R, w - 2 * K, R);
  lay(c, left, 0, K, R, h - 2 * K);
  lay(c, right, w - R, K, R, h - 2 * K);
  lay(c, bl, 0, 0, K, K, { flipY: true });
  lay(c, br, w - K, 0, K, K, { flipY: true });
  lay(c, tl, 0, 0, K, R);
  lay(c, tr, w - K, 0, K, R);
  lay(c, bl, 0, h - K, K, K);
  lay(c, br, w - K, h - K, K, K);
  return c;
}

/**
 * The menus' recessed box (GSELPOP1's description box) over `w` x `h`: its bevel's corners as they are, its edges
 * stretched from a pixel, its darker marble stretched. Null without the picture.
 */
export async function menuBox(w: number, h: number): Promise<Container | null> {
  const t = await partTexture(GSELPOP1, "box", -1);
  return t && slicedBox(t, w, h, 4, "menu box");
}

/** A bevel's depth on each side of a box (`slicedBox`). */
export interface Bevel {
  l: number;
  t: number;
  r: number;
  b: number;
}

/**
 * A box of the original (`t`, a box's cut) over `w` x `h`: its bevel (`E` deep, or as deep on each side as `E` says)
 * with its corners as they are and its edges stretched from their middle pixel, the inside stretched (tiled marble
 * shows seams), or `inside` there instead (the battle console's leather). The menus' boxes and cards and the battle
 * console's rooms are this one box.
 */
export function slicedBox(t: Texture, w: number, h: number, E: number | Bevel, name = "box", inside?: Cut | Container): Container {
  const { l, t: tp, r, b } = typeof E === "number" ? { l: E, t: E, r: E, b: E } : E;
  const { width: bw, height: bh } = t.frame;
  const c = new Container();
  c.label = name;
  // (Stretched: its marble tiled shows seams. `inside`: a clean stretch of it when the inside holds a symbol, or what
  // goes there instead.)
  if (inside instanceof Container) c.addChild(Object.assign(inside, { x: l, y: tp }));
  else lay(c, cut(t, inside ?? { x: l, y: tp, w: bw - l - r, h: bh - tp - b }), l, tp, w - l - r, h - tp - b);
  lay(c, cut(t, { x: bw >> 1, y: 0, w: 1, h: tp }), l, 0, w - l - r, tp);
  lay(c, cut(t, { x: bw >> 1, y: bh - b, w: 1, h: b }), l, h - b, w - l - r, b);
  lay(c, cut(t, { x: 0, y: bh >> 1, w: l, h: 1 }), 0, tp, l, h - tp - b);
  lay(c, cut(t, { x: bw - r, y: bh >> 1, w: r, h: 1 }), w - r, tp, r, h - tp - b);
  lay(c, cut(t, { x: 0, y: 0, w: l, h: tp }), 0, 0, l, tp);
  lay(c, cut(t, { x: bw - r, y: 0, w: r, h: tp }), w - r, 0, r, tp);
  lay(c, cut(t, { x: 0, y: bh - b, w: l, h: b }), 0, h - b, l, b);
  lay(c, cut(t, { x: bw - r, y: bh - b, w: r, h: b }), w - r, h - b, r, b);
  return c;
}

/**
 * GSPBUTT.DEF (200 x 20), the scenario screen's word bar (Show Advanced Options, Random Map, Show Available
 * Scenarios): blue marble in a 2-px bevel with a gold arrow at the left; frame 1 is it pressed.
 */
export const GSPBUTT = {
  file: "gspbutt.def",
  frame: 0,
  plain: true,
  w: 200,
  h: 20,
  parts: {
    bar: { x: 0, y: 0, w: 200, h: 20 },
    /** The gold arrow. */
    arrow: { x: 5, y: 3, w: 10, h: 14 },
    /** A clean stretch of the marble (right of the arrow). */
    ground: { x: 20, y: 3, w: 170, h: 14 },
  },
} satisfies WindowPicture;
export const GSPBUTT_DOWN = { ...GSPBUTT, frame: 1 } satisfies WindowPicture;

/**
 * GSPBUTT's word bar over `w` x `h` (a finger-high one on phones): its bevel kept, the marble stretched, the arrow
 * at the left at `k` times (the page's scale, so it stays the original's arrow and doesn't balloon; `arrowed` false:
 * none, for a choice among words). Null without it.
 */
export async function wordBar(w: number, h: number, k: number, pressed = false, arrowed = true): Promise<Container | null> {
  const pic = pressed ? GSPBUTT_DOWN : GSPBUTT;
  const [bar, arrow] = await Promise.all([partTexture(pic, "bar", -1), partTexture(pic, "arrow", -1)]);
  if (!bar || !arrow) return null;
  const c = slicedBox(bar, w, h, 3, "word bar", { ...GSPBUTT.parts.ground });
  const a = GSPBUTT.parts.arrow;
  if (arrowed) lay(c, arrow, Math.round(a.x * k), Math.round((h - a.h * k) / 2), a.w * k, a.h * k);
  return c;
}

/**
 * The random map's option card (RANMAPBK's) over `w` x `h`: its title band `band` deep (the original's 24, its line
 * kept at its foot) and the buttons' room under it, each a sliced box. Null without the picture.
 */
export async function menuCard(w: number, h: number, band = OPTION_BAND): Promise<Container | null> {
  const t = await partTexture(RANMAPBK, "option", -1);
  if (!t) return null;
  const { w: cw, h: ch } = RANMAPBK.parts.option;
  const c = new Container();
  c.label = "option card";
  c.addChild(slicedBox(cut(t, { x: 0, y: 0, w: cw, h: OPTION_BAND }), w, band, 2));
  c.addChild(Object.assign(slicedBox(cut(t, { x: 0, y: OPTION_BAND, w: cw, h: ch - OPTION_BAND }), w, h - band, 2), { y: band }));
  return c;
}

/**
 * SCNRBEG.DEF's up face (166 x 40), the scenario screen's BEGIN: a brushed gold plate between two carved filigree
 * ends. The ends as they are (each with a few clean pixels of the plate); between them the plate without its word.
 */
export const SCNRBEG = {
  file: "scnrbeg.def",
  w: 166,
  h: 40,
  parts: {
    endLeft: { x: 0, y: 0, w: 29, h: 40 },
    endRight: { x: 139, y: 0, w: 27, h: 40 },
  },
} as const satisfies WindowPicture;

/**
 * SCNRBEG's gold plate `w` wide (60 at least), as a canvas to engrave into: its two filigree ends as they are, and
 * between them each of its rows run from the left end's last pixel to the right end's first (the plate's brushed
 * streaks along it, its light growing left to right as on the original). Null without the picture.
 */
export async function goldPlate(w: number): Promise<HTMLCanvasElement | null> {
  const t = (await loadDef(SCNRBEG.file).catch(() => null))?.get(0)?.[0]?.texture;
  if (!t || t.width < SCNRBEG.w || t.height < SCNRBEG.h) return null;
  const { endLeft: L, endRight: R } = SCNRBEG.parts;
  const H = SCNRBEG.h;
  const c = document.createElement("canvas");
  c.width = w = Math.max(L.w + R.w + 4, Math.round(w));
  c.height = H;
  const ctx = c.getContext("2d")!;
  const src = textureCanvas(t);
  const [fx, fy] = [t.frame.x, t.frame.y];
  ctx.drawImage(src, fx + L.x, fy, L.w, H, 0, 0, L.w, H);
  ctx.drawImage(src, fx + R.x, fy, R.w, H, w - R.w, 0, R.w, H);
  const from = ctx.getImageData(L.w - 1, 0, 1, H).data;
  const to = ctx.getImageData(w - R.w, 0, 1, H).data;
  const span = w - L.w - R.w + 1;
  const mid = ctx.createImageData(span - 1, H);
  for (let y = 0; y < H; y++)
    for (let i = 1; i < span; i++)
      for (let k = 0; k < 4; k++) mid.data[(y * (span - 1) + i - 1) * 4 + k] = from[y * 4 + k] + ((to[y * 4 + k] - from[y * 4 + k]) * i) / span;
  ctx.putImageData(mid, L.w, 0);
  return c;
}
