// The original Adventure Options window (ADVOPTS) and the puzzle map (PUZZLE).
import { Container, Graphics, Rectangle, Sprite, type Texture, Ticker } from "pixi.js";
import { playSound } from "../audio.ts";
import { loadImage, loadPng } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { resolveText } from "./gameText.ts";
import { DefButton, goldBorder, label, loadImagePlayer } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { PUZZLES } from "../map/puzzles.ts";
import { oneHand, phoneSized, screenSize } from "./screen.ts";
import { tr, type Text, said } from "../i18n/index.ts";
import { FRAME_PAD as P, SHEET_IN, SPLIT, fitSheet, sheetFoot } from "./blocks/phoneWindow.ts";
import { openPage } from "./mobilePage.ts";

export type AdvOption = "world" | "puzzle" | "dig" | "info" | "replay";

/** Five icon buttons with their labels on the left of ADVOPTS, OK at the bottom right. */
export async function advOptionsWindow(modals: Modals, player: number): Promise<AdvOption | null> {
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer("advopts.pcx", player)));
  const items: [AdvOption, string][] = [["world", "advview.def"], ["puzzle", "advpuz.def"], ["dig", "advdig.def"], ["info", "advinfo.def"], ["replay", "advturn.def"]];
  return new Promise((resolve) => {
    let close = () => {};
    const done = (v: AdvOption | null) => (close(), resolve(v));
    // Beside ADVOPTS' five boxes (their tops at 24 + 58 i; VCMI's CAdventureOptions: 24, 23 / 81 / 139...).
    items.forEach(([key, def], i) => {
      const b = new DefButton(def, 24, 23 + i * 58, player);
      b.onClick = () => done(key);
      win.addChild(b);
    });
    // In the picture's gold frame (203..266 x 313..344).
    const ok = new DefButton("iok6432.def", 203, 313);
    ok.onClick = () => done(null);
    win.addChild(ok);
    close = modals.show(win, {
      onKey: (k) => {
        if (k === "Escape" || k === "Enter") done(null);
        else if (k === "v") done("world");
        else if (k === "p") done("puzzle");
        else if (k === "d") done("dig");
        else if (k === "i") done("info");
        return true;
      },
    });
  });
}

export interface PuzzleOptions {
  faction: string;
  /** Share of the obelisks visited, 0..1. */
  ratio: number;
  /** The land and scenery around the Grail on the Grail's own level, over `frame` (map pixels): MapView.landPicture. */
  picture: (frame: Rectangle) => Promise<Texture[]>;
  /** Grail tile. */
  grail: { x: number; y: number };
  /** The treasury and the date for the bottom bar. */
  resources?: number[];
  date?: string;
}

/**
 * The Puzzle Map on an upright phone (2026-10-27 22:26: "a scaled down desktop dialog rather than a sane vertical
 * layout"): one of phoneWindow's sheets, its name in the rim, the picture across it, OK at the foot (the logo and the
 * resource bar are the desktop screen's; the map's own strip shows the resources).
 */
async function puzzleSheet(modals: Modals, pic: Container, W: number, H: number, title: Text): Promise<void> {
  const ok = new DefButton("iok6432.def", 0, 0);
  await ok.ready;
  const shell = await openPage(modals, { bare: true, title, keys: (k) => (k === "Enter" ? (shell.close(), true) : false) });
  const root = new Container();
  root.label = "window: puzzle map";
  const k = SHEET_IN / W;
  const holder = new Container();
  holder.addChild(pic);
  holder.mask = holder.addChild(new Graphics().rect(7, 7, W, H).fill(0xffffff));
  holder.scale.set(k);
  holder.position.set(P - 7 * k, P - 7 * k);
  root.addChild(holder);
  ok.onClick = () => shell.close();
  const end = sheetFoot(root, [ok], P + Math.round(H * k) + SPLIT);
  fitSheet(root, end + P);
  shell.setContent(root);
  return shell.show();
}

/** The puzzle map: the terrain around the Grail under the faction's pieces; obelisks take pieces away. */
export async function puzzleWindow(modals: Modals, player: number, o: PuzzleOptions): Promise<void> {
  // As it opens, the obelisk's sound (VCMI's CPuzzleWindow); the button, the P key and the world view all come here.
  void playSound("OBELISK");
  const win = new Container();
  // The picture (the map under the pieces) on a layer of its own: upright it is the window (puzzleSheet).
  const pic = new Container();
  pic.label = "picture: puzzle map";
  const upright = phoneSized() && screenSize.portrait;
  if (!upright) win.addChild(new Sprite(await loadImagePlayer("puzzle.pcx", player)));
  win.addChild(pic);
  // A picture of the map, centred on the Grail, filling PUZZLE.PCX's hole (7..600 x 7..552; the
  // pieces tile 592 x 544 of it from 8, 8, so a pixel of the map shows round them).
  const W = 594;
  const H = 546;
  const frame = new Rectangle(o.grail.x * 32 + 16 - W / 2, o.grail.y * 32 + 16 - H / 2, W, H);
  pic.addChild(new Graphics().rect(7, 7, W, H).fill(0x000000));
  // The whole map shows, not only what the adventure view had on screen (it hides what's off it), and
  // neither fog nor the live objects: the original's puzzle map is the land and its scenery, on the Grail's level.
  for (const tex of await o.picture(frame)) pic.addChild(Object.assign(new Sprite(tex), { x: 7, y: 7 }));
  const x = new Graphics().moveTo(7 + W / 2 - 12, 7 + H / 2 - 12).lineTo(7 + W / 2 + 12, 7 + H / 2 + 12).moveTo(7 + W / 2 + 12, 7 + H / 2 - 12).lineTo(7 + W / 2 - 12, 7 + H / 2 + 12).stroke({ color: 0xff0000, width: 4 });
  pic.addChild(x);
  // The pieces: those the obelisks uncovered (index up to 48 x the share visited, VCMI's whenUncovered
  // <= PUZZLE_MAP_PIECES * ratio) dissolve as the window opens, the rest stay.
  const puzzle = PUZZLES[o.faction] ?? PUZZLES.castle;
  const fading: Sprite[] = [];
  await Promise.all(
    puzzle.pieces.map(async (p, i) => {
      const name = `${puzzle.prefix}${String(i).padStart(2, "0")}`;
      const tex = await (name.includes("/") ? loadPng(`${name.toLowerCase()}.png`) : loadImage(`${name.toLowerCase()}.pcx`)).catch(() => null);
      if (!tex) return;
      const piece = pic.addChild(Object.assign(new Sprite(tex), { x: p.x + 1, y: p.y }));
      if (p.index <= 48 * o.ratio) fading.push(piece);
    }),
  );
  // (VCMI's CPuzzleWindow: 2 of 255 alpha a frame, about two seconds.)
  if (fading.length) {
    const fade = (t: Ticker) => {
      const a = win.destroyed ? 0 : Math.max(0, fading[0].alpha - (2 / 255) * t.deltaTime);
      if (!win.destroyed) for (const f of fading) f.alpha = a;
      if (a <= 0) Ticker.shared.remove(fade);
    };
    Ticker.shared.add(fade);
  }
  if (upright) return puzzleSheet(modals, pic, W, H, (await resolveText({ file: "genrltxt", id: 463 })) ?? tr("Puzzle Map"));
  const logo = await loadImage("puzzlogo.pcx").catch(() => null);
  if (logo) win.addChild(Object.assign(new Sprite(logo), { x: 607, y: 3 }));
  // "Puzzle Map" under the logo (VCMI's CPuzzleWindow: GENRLTXT 463, big font, yellow, centred on 700, 95).
  win.addChild(label((await resolveText({ file: "genrltxt", id: 463 })) ?? tr("Puzzle Map"), "bigfont", YELLOW).centreOn(700, 95));
  // The resource bar along the bottom, as VCMI's CPuzzleWindow (ARESBAR at 3,575; amounts 85 apart from 32).
  if (o.resources) {
    const bar = await loadImagePlayer("aresbar.pcx", player).catch(() => null);
    if (bar) win.addChild(Object.assign(new Sprite(bar), { x: 3, y: 575 }));
    // Phones: the bigger font, filling the bar's height (the small one can't be read there).
    const phone = phoneSized();
    const amount = (text: Text, x: number, room: number) => {
      const l = label(text, phone ? "medfont" : "smalfont", WHITE);
      if (phone) {
        // (Upright the screen is 800 across a phone's width: bigger, to the bar's full height.)
        l.scale.set(screenSize.portrait ? 26 / l.height : Math.min(1.25, 21 / l.height));
        if (l.width > room) l.scale.x = room / (l.width / l.scale.x);
      }
      l.position.set(x, phone ? Math.min(575 + Math.round((24 - l.height) / 2), 600 - l.height) : 575 + 4);
      win.addChild(l);
    };
    o.resources.forEach((n, i) => amount(said(String(n)), 3 + 32 + 85 * i, 50));
    if (o.date) amount(said(o.date), 3 + 619, 172);
  }
  return new Promise((resolve) => {
    let close = () => {};
    const ok = goldBorder(new DefButton("iok6432.def", 670, 538));
    ok.onClick = () => (close(), resolve());
    // One-handed: the big Close beside the window (kit.ts, on the thumb's side) does what it does.
    if (oneHand()) (ok as DefButton & { handMirror?: boolean }).handMirror = true;
    win.addChild(ok);
    // (The whole game screen as the original; one-handed placed by the window list instead, away from the thumb with its OK at it.)
    close = modals.show(win, { ...(oneHand() ? {} : { x: 0, y: 0 }), onKey: (k) => (k === "Escape" || k === "Enter" ? (close(), resolve(), true) : true) });
  });
}
