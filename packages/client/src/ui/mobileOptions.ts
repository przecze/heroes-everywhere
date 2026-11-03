// System Options and the combat options on a phone: the original windows' own parts (their panels
// cut from SYSOPBCK / COMOPBCK, the same buttons, checkboxes, volume bars and words) drawn bigger and
// laid out afresh over the whole screen, the title (and what the last control does) in the column.
import { Container } from "pixi.js";
import { resolveText } from "./gameText.ts";
import { DefButton, setEnabled, textButton } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { type GameText, WHITE, YELLOW } from "../text.ts";
import { FRAME_PAD, leatherWindow, phoneRoom } from "./blocks/phoneWindow.ts";
import { screenSize } from "./screen.ts";
import { COMOPBCK, SYSOPBCK, type WindowPicture, part } from "./blocks/windowParts.ts";
import { type ColumnButton, bigText, btnH, contentArea, openPage, pageColumn, pageSize, scrollList } from "./mobilePage.ts";

/** The options windows' own word buttons, by the column's words. */
const WORD_BUTTONS: Record<string, string> = { "Load Game": "soload.def", "Save Game": "sosave.def", "Main Menu": "somain.def", Return: "soretrn.def", Default: "codefaul.def" }; // i18n-ok
import { type SystemActions, buildSystemOptions } from "./systemOptions.ts";
import { type UndoOffer, buildBattleOptions } from "../battle/options.ts";
import { said, tr, type Text } from "../i18n/index.ts";

/** A part of the window: its rectangle in the window's own pixels. */
type Part = [x: number, y: number, w: number, h: number];

/** System Options: the three speeds, video quality, the two volumes, the six checkboxes, Restart and Quit (the other buttons go in the column). */
// The windows' panels (windowParts' SYSOPBCK, COMOPBCK): each setting's panel, the checkboxes, Restart and Quit (each
// asks first, as the original); combat's three checkboxes, animation speed (and the fine slider), the two volumes, the
// auto-combat and creature info choices (Default and Return in the column).
const SYSTEM_PARTS: Part[] = Object.values(SYSOPBCK.parts).map((r) => [r.x, r.y, r.w, r.h]);
const COMBAT_PARTS: Part[] = Object.values(COMOPBCK.parts).map((r) => [r.x, r.y, r.w, r.h]);

/** The smallest the parts are drawn: the original's words at 1.25 times (readable on a phone). */
const MIN_K = 1.25;
const MAX_K = 2;
/** Between parts, and between columns. */
const GAP = 6;
const COL_GAP = 16;

/**
 * Lays the parts out in columns that fill `area` top to bottom, as big as they fit; when even the
 * smallest size doesn't fit, one column at that size, to scroll.
 */
function pack(sizes: { w: number; h: number }[], area: { w: number; h: number }, minK = MIN_K) {
  for (let k = MAX_K; k >= minK - 1e-9; k -= 0.05) {
    const pos: { x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    let colW = 0;
    for (const s of sizes) {
      const [w, h] = [s.w * k, s.h * k];
      if (y > 0 && y + h > area.h) {
        x += colW + COL_GAP;
        y = 0;
        colW = 0;
      }
      pos.push({ x, y });
      y += h + GAP;
      colW = Math.max(colW, w);
    }
    if (x + colW <= area.w) return { k, pos, w: x + colW, scroll: false };
  }
  let y = 0;
  const pos = sizes.map((s) => {
    const p = { x: 0, y };
    y += s.h * MIN_K + GAP;
    return p;
  });
  return { k: MIN_K, pos, w: Math.max(...sizes.map((s) => s.w * MIN_K)), scroll: true };
}

/**
 * The phone's page for one of the option windows. `build` makes the window in its own coordinates
 * (as on a desktop) and calls `after` with its controls each time it draws them again; each control
 * and word goes into the part it lies in, the rest (the title, what a phone can't set) stays out.
 */
async function optionsPage(
  modals: Modals,
  titleRef: [id: number, ours: string],
  background: WindowPicture,
  player: number,
  parts: Part[],
  build: (onHint: (text: Text) => void, finish: (fn?: () => void) => void, after: (layer: Container) => void) => Promise<{ win: Container; layer: Container; buttons: ColumnButton[] }>,
): Promise<void> {

  // The window's title (GENRLTXT), big in the column.
  const title = (await resolveText({ file: "genrltxt", id: titleRef[0] }).catch(() => null))?.trim() || said(titleRef[1]);
  const cuts = await Promise.all(Object.keys(background.parts).map((name) => part(background, name, player)));
  const pieces = cuts.map((sp) => {
    const c = new Container();
    if (sp) c.addChild(sp);
    return c;
  });
  const into = (c: Container) => {
    const b = c.getBounds();
    const [cx, cy] = b.width > 0 ? [b.x + b.width / 2, b.y + b.height / 2] : [c.x + 1, c.y + 1];
    const i = parts.findIndex(([x, y, w, h]) => cx >= x && cx < x + w && cy >= y && cy < y + h);
    if (i < 0) return false;
    pieces[i].addChild(c);
    c.position.set(c.x - parts[i][0], c.y - parts[i][1]);
    return true;
  };
  /** The controls moved out of the window's layer last time (drawn afresh now). */
  let moved: Container[] = [];
  const after = (layer: Container) => {
    moved.forEach((c) => c.destroy({ children: true }));
    moved = [];
    for (const c of [...layer.children] as Container[]) {
      if (into(c)) moved.push(c);
      else c.destroy({ children: true });
    }
  };
  let hint: Text = said("");
  let showHint = () => {};
  const onHint = (text: Text) => {
    if (!text || text === hint) return;
    hint = text;
    showHint();
  };
  let page: Awaited<ReturnType<typeof openPage>> | null = null;
  let then = null as (() => void) | null;
  const finish = (fn?: () => void) => {
    then = fn ?? null;
    page?.close();
  };
  const { win, layer, buttons } = await build(onHint, finish, after);
  // The window's own words and buttons go into their parts too; its backing and title stay out.
  for (const c of [...win.children] as Container[]) if (c !== layer && c !== win.children[0] && !into(c)) c.visible = false;
  // Upright: one window over the map, its title, settings, words and buttons inside (2026-10-26 22:24: "windowed,
  // no full screen, no sections, fit everything").
  const windowed = screenSize.portrait;
  page = await openPage(modals, { bare: windowed, ownWindow: windowed, draw: () => draw(), onClose: () => win.destroy({ children: true }) });
  const content = new Container();
  const column = new Container();
  const body = new Container();
  // One-handed: the settings stay where they are (touchcheck's handGrid); the buttons are the column's.
  (body as Container & { handGrid?: boolean }).handGrid = true;
  content.addChild(column, body);
  let columnGen = 0;
  showHint = () => {
    if (windowed) return void (hintLine && !hintLine.destroyed && (hintLine.value = hint));
    const gen = ++columnGen;
    void pageColumn(title, { text: hint, buttons }).then((c) => {
      if (gen !== columnGen || content.destroyed) return void c.destroy({ children: true });
      column.removeChildren().forEach((x) => x.destroy({ children: true }));
      column.addChild(c);
    });
  };
  const drawWindow = async () => {
    const { w: PW, h: PH } = pageSize();
    const { top } = phoneRoom();
    const P = FRAME_PAD;
    const IW = PW - 2 * 8 - 2 * P;
    const head = bigText(title, "bigfont", YELLOW, 1.5, { w: IW, center: true });
    const hintText = bigText(hint || said(" "), "medfont", WHITE, 1.25, { wrap: IW });
    // The original's own word buttons (the owner, 22:23: our shaded text buttons looked weird), a finger high, in a row.
    const bh = btnH();
    const row = new Container();
    const made = await Promise.all(buttons.map(async ([text, fn, live = true]) => {
      // (Ours, with no art of its own: the brown word button, as tall as the art's.)
      if (!WORD_BUTTONS[text]) {
        const b = await textButton(tr(text), 100, 48, () => live && fn(), "medfont");
        setEnabled(b, live);
        return b;
      }
      const def = WORD_BUTTONS[text];
      // (Raised in frame 1, as VCMI orders them: kit.ts DEF_ORDER.)
      const b = new DefButton(def, 0, 0, -1);
      await b.ready;
      b.onClick = () => fn();
      return b;
    }));
    // (Clear of the page's ☰ and Feedback in the bottom corners: a finger meant for Undo or Return got the page's button.)
    const rowW = IW - 2 * 44;
    const bk = Math.min(bh / Math.max(1, ...made.map((b) => b.height)), (rowW - (made.length - 1) * 12) / made.reduce((n, b) => n + b.width, 0));
    let x = 0;
    for (const b of made) {
      b.scale.set(bk);
      b.position.set(x, 0);
      x += b.width + 12;
      row.addChild(b);
    }
    // The settings in the room left between the title and the words.
    const room = PH - top - 2 * P - 16 - head.height - 2 * hintText.height - row.height - 4 * GAP * 2;
    // (All of it in the window, a little smaller than a page's parts when it must: the owner, "fit everything".)
    const fit = pack(parts.map(([, , w, h]) => ({ w, h })), { w: IW, h: Math.max(100, room) }, 1);
    pieces.forEach((p) => p.parent?.removeChild(p));
    body.removeChildren().forEach((c) => c.destroy({ children: true }));
    column.removeChildren().forEach((c) => c.destroy({ children: true }));
    const holder = new Container();
    pieces.forEach((p, i) => {
      p.scale.set(fit.k);
      p.position.set(fit.pos[i].x, fit.pos[i].y);
      holder.addChild(p);
    });
    const hb = holder.getLocalBounds();
    const settingsH = fit.scroll ? Math.max(100, room) : hb.height;
    let y = P;
    head.position.set(P, y);
    y += head.height + 2 * GAP;
    const settingsAt = { x: P + Math.max(0, Math.round((IW - fit.w) / 2)), y };
    y += settingsH + 2 * GAP;
    const hintAt = y;
    y += 2 * hintText.height;
    row.position.set(P + Math.round((IW - row.width) / 2), y);
    y += row.height + P;
    const dw = IW + 2 * P;
    const root = new Container();
    root.addChild(await leatherWindow(dw, y, player), head);
    if (fit.scroll) root.addChild(scrollList(holder, { x: settingsAt.x, y: settingsAt.y, w: Math.min(IW, Math.ceil(fit.w)), h: settingsH }).view);
    else root.addChild(Object.assign(holder, settingsAt));
    hintText.position.set(P, hintAt);
    root.addChild(hintText, row);
    hintLine = hintText;
    root.position.set(Math.round((PW - dw) / 2), Math.round(top + Math.max(0, (PH - top - y) / 2)));
    body.addChild(root);
  };
  let hintLine: GameText | null = null;
  const draw = () => {
    if (windowed) return void drawWindow();
    showHint();
    const area = contentArea();
    const fit = pack(parts.map(([, , w, h]) => ({ w, h })), area);
    // (The parts stay: only what held them goes.)
    pieces.forEach((p) => p.parent?.removeChild(p));
    body.removeChildren().forEach((x) => x.destroy({ children: true }));
    const holder = new Container();
    pieces.forEach((p, i) => {
      p.scale.set(fit.k);
      p.position.set(fit.pos[i].x, fit.pos[i].y);
      holder.addChild(p);
    });
    if (fit.scroll) {
      // Centred in the area, scrolled by a finger.
      body.addChild(scrollList(holder, { ...area, x: area.x + Math.max(0, Math.round((area.w - fit.w) / 2)), w: Math.min(area.w, Math.ceil(fit.w)) }).view);
    } else {
      holder.position.set(area.x + Math.max(0, Math.round((area.w - fit.w) / 2)), area.y);
      body.addChild(holder);
    }
  };
  draw();
  page.setContent(content);
  await page.show();
  then?.();
}

/** System Options on a phone (map/page.ts's actions: load, save, restart, main menu). */
export function mobileSystemOptions(modals: Modals, player: number, actions: SystemActions): Promise<void> {
  return optionsPage(modals, [568, "System Options"], SYSOPBCK, player, SYSTEM_PARTS, async (onHint, finish, after) => {
    const built = await buildSystemOptions(player, actions, onHint, finish, after);
    const b = built.buttons;
    return { ...built, buttons: [["Load Game", b.load], ["Save Game", b.save], ["Main Menu", b.mainMenu], ["Return", () => finish()]] }; // i18n-ok: the original's buttons (their words are in the art)
  });
}

/** The combat options on a phone. */
export function mobileBattleOptions(modals: Modals, player: number, undo?: UndoOffer): Promise<void> {
  return optionsPage(modals, [392, "Combat Options"], COMOPBCK, player, COMBAT_PARTS, async (onHint, finish, after) => {
    const built = await buildBattleOptions(player, onHint, () => finish(), after);
    // Undo (EXTRAS battleUndo): a word button of the row, before Default and Return; greyed with nothing to take back.
    const undoButton: ColumnButton[] = undo ? [["Undo", () => finish(undo.run), undo.can]] : []; // i18n-ok: put through tr by the page
    return { ...built, buttons: [...undoButton, ["Default", built.reset], ["Return", () => finish()]] }; // i18n-ok: the original's buttons (their words are in the art)
  });
}
