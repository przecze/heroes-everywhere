// The original's message windows over the Modals stack: the message box, the pick-one box, the list to choose from,
// right-click popups and the areas that explain themselves.
import { Container, type FederatedPointerEvent, Graphics, Rectangle, Sprite } from "pixi.js";
import { WHITE, YELLOW } from "../text.ts";
import { creaturePopup, showPopup } from "./creatureInfo.ts";
import { screenSize } from "./screen.ts";
import { tr, type Text } from "../i18n/index.ts";
import { block } from "./blocks/block.ts";
import { DefButton, label, windowFrame } from "./kit.ts";
import type { Modals } from "./modals.ts";
import type { Shown } from "./gameText.ts";
export type { Shown } from "./gameText.ts";

/** The text's room from the frame's sides: the frame's gold-and-red edge is ~10 pixels, and with the original's 11 a
 *  long line's letters met it (the Obelisk's text, upright, the owner 2026-10-27). */
const SIDE = 18;

/**
 * The text areas a message tries, smallest first (VCMI's CMessage). An upright phone keeps to the narrowest column,
 * growing down instead (2026-10-27 22:20 "tiny map begin dialog": a 590-wide box came out a third of a finger's
 * type across the phone's width); the window then grows to the screen's width (screen.ts touchScale).
 */
const WIDE_AREAS = [[270, 72], [270, 136], [270, 200], [400, 136], [400, 200], [590, 200]] as const;
const NARROW_AREAS = [[270, 72], [270, 136], [270, 200], [270, 300], [270, 420]] as const;
const narrow = () => screenSize.touch && screenSize.portrait;
const textAreas = (): readonly (readonly [number, number])[] => (narrow() ? NARROW_AREAS : WIDE_AREAS);
/** The tallest a message's text may be before it scrolls: the classic screen's, upright the taller screen's. */
const textRoom = () => (narrow() ? 760 : 600);
/** A caption under a message's picture: the small font, on a phone the medium one (the small can't be read there). */
const captionFont = () => (screenSize.touch ? "medfont" : "smalfont");

type Component = Shown;
/** Upright, at most this many pictures to a row: seven resources in one row made the window as wide as the classic
 *  screen, so the phone drew it at half size (2026-10-27 22:31, 2026-10-29 00:48 "Dialog too small"). */
const UPRIGHT_ROW = 3;
/** How many of `n` pictures a row holds: all of them (the original), upright UPRIGHT_ROW. */
const perRow = (n: number) => (narrow() ? Math.min(n, UPRIGHT_ROW) : n);
/** The width a message's pictures need (`slot` each, a row's worth). */
const rowsWidth = (n: number, slot: number) => perRow(n) * slot;

interface PlacedComponent {
  icon: Sprite;
  caption: Container;
  /** The picture's middle, its row's top and height, the room each picture of the row has. */
  x: number;
  rowY: number;
  rowH: number;
  span: number;
  /** The first of its row (no "or" before it). */
  first: boolean;
}

/**
 * A message's pictures with their captions under them (VCMI's CComponentBox): rows of perRow(), each row's room shared
 * evenly (free space on each side of each picture), the captions a line under their row, 12 between rows. Adds them to
 * `win` from `y`; the caller wires them (held: explained, picked). Returns them and the height they take.
 */
function placeComponents(win: Container, comps: Component[], slot: number, width: number, y: number): { placed: PlacedComponent[]; h: number } {
  const per = perRow(comps.length) || 1;
  const placed: PlacedComponent[] = [];
  let at = y;
  for (let r = 0; r * per < comps.length; r++) {
    const row = comps.slice(r * per, (r + 1) * per);
    const rowH = Math.max(...row.map((c) => c.texture.height));
    const caps = row.map((c) => label(c.caption, captionFont(), WHITE, "center", slot - 6));
    const span = Math.max(slot, (width - 2 * SIDE) / row.length);
    row.forEach((c, i) => {
      const x = Math.round(width / 2 - (row.length * span) / 2 + i * span + span / 2);
      const icon = new Sprite(c.texture);
      icon.position.set(Math.round(x - icon.width / 2), at + Math.round((rowH - icon.height) / 2));
      caps[i].position.set(Math.round(x - (slot - 6) / 2), at + rowH + 6);
      win.addChild(icon, caps[i]);
      placed.push({ icon, caption: caps[i], x, rowY: at, rowH, span, first: i === 0 });
    });
    at += rowH + 6 + Math.max(...caps.map((c) => c.height)) + 12;
  }
  return { placed, h: comps.length ? at - y - 12 : 0 };
}

/** The height placeComponents will take, before the window exists. */
function componentsHeight(comps: Component[], slot: number): number {
  if (!comps.length) return 0;
  const win = new Container();
  const h = placeComponents(win, comps, slot, rowsWidth(comps.length, slot) + 2 * SIDE, 0).h;
  win.destroy({ children: true });
  return h;
}

/**
 * The original message window (VCMI's CMessage::drawIWindow): the smallest of a few text areas the
 * text fits in, 11 pixels at the sides, 20 above, 16 below, 24 between text, pictures and buttons.
 * `buttons`: how many the row under it holds (0 for a right-click popup).
 */
export async function messageWindow(text: Text, player: number, opts: { title?: Text; components?: Shown[]; /** Drawn centred under the pictures (a building's costs). */ below?: Container }, buttons: number): Promise<{ win: Container; width: number; height: number; buttonsW: number }> {
  const comps = opts.components ?? [];
  const slot = comps.length ? Math.max(...comps.map((c) => Math.max(c.texture.width, 80))) + 16 : 0;
  const AREAS = textAreas();
  let body = label(text, "medfont", WHITE, "center", AREAS[0][0]);
  let area: readonly [number, number] = AREAS[0];
  for (const a of AREAS) {
    if (a !== AREAS[0]) {
      body.destroy();
      body = label(text, "medfont", WHITE, "center", a[0]);
    }
    area = a;
    if (body.height <= a[1]) break;
  }
  // Taller than the screen allows (HotA's campaign stories): the text scrolls in its box, a slider
  // beside it (VCMI's CTextBox with its slider), the wheel or a drag moving it.
  const tallest = textRoom() - 60 - (opts.title ? 40 : 0) - (buttons ? 54 : 0) - (comps.length ? 24 + 140 : 0);
  let scroller: Container | null = null;
  if (body.height > tallest) {
    body.destroy();
    body = label(text, "medfont", WHITE, "center", area[0] - 20);
    scroller = scrollingText(body, area[0], tallest);
  }
  // A popup's text box is only as tall as its text (VCMI's CInfoWindow without buttons).
  const textW = area[0];
  const textH = scroller ? tallest : buttons ? Math.max(area[1], body.height) : body.height;
  const bw = 64;
  const buttonsW = buttons ? buttons * bw + (buttons - 1) * 18 : 0;
  const below = opts.below;
  const width = Math.max(buttons ? textW : Math.min(textW, body.width), rowsWidth(comps.length, slot), buttonsW, below?.width ?? 0) + 2 * SIDE;
  const title = opts.title ? label(opts.title, "bigfont", YELLOW, "center", width - 2 * SIDE) : null;
  const top = 20 + (title ? title.height + 8 : 0);
  const iconsY = top + textH + 24;
  const iconsH = componentsHeight(comps, slot);
  const belowY = iconsY + (comps.length ? iconsH : -24) + 16;
  const height = top + textH + (comps.length ? 24 + iconsH : 0) + (below ? 16 + below.height : 0) + (buttons ? 24 + 30 : 0) + 16;
  const win = await windowFrame(width, height, player);
  if (title) {
    title.position.set(SIDE, 20);
    win.addChild(title);
  }
  if (scroller) {
    scroller.position.set(Math.round((width - textW) / 2), top);
    win.addChild(scroller);
  } else {
    body.position.set(Math.round((width - body.width) / 2), top + Math.round((textH - body.height) / 2));
    if (buttons) body.position.x = Math.round((width - textW) / 2);
    win.addChild(body);
  }
  const { placed } = placeComponents(win, comps, slot, width, iconsY);
  if (below) {
    below.position.set(Math.round((width - below.width) / 2), belowY);
    win.addChild(below);
  }
  if (buttons) placed.forEach((p, i) => explainHeld(p.icon, comps[i], player));
  return { win: block(win, "dialog"), width, height, buttonsW };
}

/** A message's picture explains itself with the right button (or a finger) held (VCMI's CComponent::showPopupWindow):
 * its description, a creature its card. Every window with pictures (messages, the pick-one boxes) uses this. */
export function explainHeld(icon: Container, c: Shown, player: number): void {
  const { help, creature } = c;
  if (!help && !creature) return;
  icon.eventMode = "static";
  icon.on("rightdown", (e: FederatedPointerEvent) => {
    if (creature) showPopup(() => creaturePopup(creature.c, { count: creature.count, player }), e.global.x, e.global.y);
    else if (help) textPopup(help, player, e.global.x, e.global.y, [{ texture: c.texture, caption: c.caption }]);
  });
}

/** Text (or any content) in a box `w` x `h` that scrolls (wheel, drag, or the slider down its right-hand side).
 *  `moved()`: whether the press now ending dragged it, so a tap on something in it isn't taken as a tap. */
export function scrollingText(body: Container, w: number, h: number, atEnd = false): Container & { moved: () => boolean } {
  const view = new Container();
  const mask = new Graphics().rect(0, 0, w, h).fill(0xffffff);
  const track = new Graphics().rect(w - 12, 0, 10, h).fill({ color: 0x000000, alpha: 0.45 }).stroke({ color: 0xc9a046, width: 1 });
  const knob = new Graphics();
  // (Measured before the mask: a masked container measures only what shows, and nothing scrolled.)
  const full = body.height;
  view.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 }), body, mask, track, knob);
  body.mask = mask;
  view.eventMode = "static";
  // (Taps only inside the box: the mask hides the text scrolled out, it doesn't stop it catching taps.)
  view.hitArea = new Rectangle(0, 0, w, h);
  const most = Math.max(0, full - h);
  const knobH = Math.min(h, Math.max(24, Math.round((h * h) / Math.max(1, full))));
  let y = 0;
  const set = (v: number) => {
    y = Math.max(0, Math.min(most, v));
    body.y = -Math.round(y);
    knob.clear().rect(w - 11, most ? Math.round((y / most) * (h - knobH)) : 0, 8, knobH).fill(0xc9a046);
  };
  set(atEnd ? most : 0);
  let from: number | null = null;
  let onKnob = false;
  let dragged = 0;
  view.on("pointerdown", (e) => {
    const p = view.toLocal(e.global);
    onKnob = p.x >= w - 14;
    from = e.global.y;
    dragged = 0;
    if (onKnob) set(((p.y - knobH / 2) / (h - knobH)) * most);
  });
  view.on("globalpointermove", (e) => {
    if (from === null) return;
    const d = e.global.y - from;
    from = e.global.y;
    dragged += Math.abs(d);
    set(onKnob ? y + (d * most) / (h - knobH) : y - d);
  });
  const up = () => (from = null);
  view.on("pointerup", up);
  view.on("pointerupoutside", up);
  view.on("wheel", (e) => set(y + e.deltaY));
  return Object.assign(view, { moved: () => dragged > 8 });
}

/**
 * The original right-click popup (VCMI's CRClickPopup::createAndPush): the message window without
 * buttons, centred on the pointer while the right button (or a long press) is held.
 */
export function textPopup(text: Text, player: number, x: number, y: number, components?: Shown[]): () => void {
  return showPopup(async () => (await messageWindow(text, player, { components }, 0)).win, x, y);
}

/** `target` explains itself as the original's LRClickableAreaWText: a click opens the text with OK,
 * the right button held shows it as a popup. */
export function infoArea(
  modals: Modals,
  target: Container,
  player: number,
  text: () => Promise<Text | null | undefined> | Text | null | undefined,
  /** The picture the text is about (LRClickableAreaWTextComp's component). */
  component?: () => Promise<Shown | null | undefined>,
) {
  const both = async () => {
    const [t, c] = await Promise.all([text(), component?.()]);
    return { t, components: c ? [c] : undefined };
  };
  target.eventMode = "static";
  // (A hold is "rightdown": what's held answers it, so a HUD piece that moves on a hold leaves it be, arrange.ts.)
  target.on("rightdown", (e: FederatedPointerEvent) => {
    let up = false;
    void both().then(({ t, components }) => {
      if (t && !up) textPopup(t, player, e.global.x, e.global.y, components);
    });
    // Released before the text came: nothing to show.
    window.addEventListener("pointerup", () => (up = true), { once: true });
  });
  target.on("pointertap", async (e: FederatedPointerEvent) => {
    if (e.button !== 0) return;
    const { t, components } = await both();
    if (t) void messageBox(modals, t, player, { components });
  });
}

/** OK and Cancel for a yes-or-no question (messageBox answers "yes" or "no"). */
export const YES_NO = [
  { def: "iokay.def", value: "yes" },
  { def: "icancel.def", value: "no" },
];

/** The original message box: wrapped text and an OK button; resolves when closed (Enter, Esc or OK). */
export async function messageBox(
  modals: Modals,
  text: Text,
  player: number,
  opts: { title?: Text; buttons?: { def: string; value: string }[]; components?: Shown[]; /** Takes the box down unanswered (it resolves with the last button's value). */ signal?: AbortSignal; /** Up while held (the signal is the release): no buttons. */ held?: boolean; /** Drawn centred under the pictures. */ below?: Container } = {},
): Promise<string> {
  // Shown while held (the signal: the finger or the right button lets go): the original's right-click window, without
  // buttons (2026-10-29: a held building's box had an OK that vanished with the finger, so it was useless).
  const buttons = opts.held ? [] : (opts.buttons ?? [{ def: "iokay.def", value: "ok" }]);
  const last = opts.held ? "ok" : buttons[buttons.length - 1].value;
  const bw = 64;
  const { win, width, height, buttonsW } = await messageWindow(text, player, opts, buttons.length);
  return new Promise((resolve) => {
    let close = () => {};
    const done = (v: string) => {
      close();
      resolve(v);
    };
    buttons.forEach((b, i) => {
      const btn = new DefButton(b.def, Math.round((width - buttonsW) / 2) + i * (bw + 18), height - 16 - 30);
      btn.onClick = () => done(b.value);
      win.addChild(btn);
    });
    close = modals.show(win, {
      onKey: (key) => {
        if (key === "Enter" || key === " ") done(buttons[0]?.value ?? last);
        else if (key === "Escape") done(last);
        else return false;
        return true;
      },
    });
    if (opts.signal?.aborted) done(last);
    else opts.signal?.addEventListener("abort", () => done(last), { once: true });
  });
}

/**
 * The original "pick one" message (Arena, Schools, Witch Huts...): text, a row of icons with
 * captions to click, OK and Cancel. Resolves with the picked index, or -1 when cancelled.
 */
export async function pickBox(
  modals: Modals,
  text: Text,
  choices: Shown[],
  player: number,
  /** Pictures shown above the choices, not to be picked (a HotA map script's question). */
  extra: Shown[] = [],
): Promise<number> {
  // Laid out as messageBox (VCMI's CMessage: 11 at the sides, 20 above, 16 below, 24 between the
  // text, the pictures and the buttons), so two-line captions never run under the buttons.
  const AREAS = textAreas();
  const slot = Math.max(...[...choices, ...extra].map((c) => Math.max(c.texture.width, 80))) + 16;
  let body = label(text, "medfont", WHITE, "center", AREAS[0][0]);
  let area: readonly [number, number] = AREAS[0];
  for (const a of AREAS) {
    if (a !== AREAS[0]) {
      body.destroy();
      body = label(text, "medfont", WHITE, "center", a[0]);
    }
    area = a;
    if (body.height <= a[1]) break;
  }
  const buttonsW = 2 * 64 + 18;
  const width = Math.max(area[0], rowsWidth(choices.length, slot), rowsWidth(extra.length, slot), buttonsW) + 2 * SIDE;
  const top = 20;
  const extraY = top + body.height + 24;
  const extraH = extra.length ? componentsHeight(extra, slot) + 24 : 0;
  const iconsY = extraY + extraH;
  const height = iconsY + componentsHeight(choices, slot) + 24 + 30 + 16;
  const win = await windowFrame(width, height, player);
  body.position.set(Math.round((width - area[0]) / 2), top);
  win.addChild(body);
  placeComponents(win, extra, slot, width, extraY).placed.forEach((p, i) => explainHeld(p.icon, extra[i], player));
  let picked = 0;
  const marks: Graphics[] = [];
  placeComponents(win, choices, slot, width, iconsY).placed.forEach(({ icon, x, rowY, rowH, span, first }, i) => {
    icon.eventMode = "static";
    icon.cursor = "pointer";
    const mark = new Graphics().rect(icon.x - 0.5, icon.y - 0.5, icon.width + 1, icon.height + 1).stroke({ color: 0xffff00, width: 1 });
    mark.visible = i === 0;
    marks.push(mark);
    icon.on("pointertap", (e: FederatedPointerEvent) => {
      if (e.button === 2) return;
      picked = i;
      marks.forEach((m, k) => (m.visible = k === i));
    });
    explainHeld(icon, choices[i], player);
    win.addChild(mark);
    // "or" between the choices of a row, level with the pictures' middle (VCMI's CComponentBox, selectable).
    if (!first) {
      const or = label(tr("or"), "medfont", WHITE, "center", 40);
      or.position.set(Math.round(x - span / 2 - 20), rowY + Math.round(rowH / 2) - 8);
      win.addChild(or);
    }
  });
  return new Promise((resolve) => {
    let close = () => {};
    const done = (v: number) => {
      close();
      resolve(v);
    };
    const ok = new DefButton("iokay.def", Math.round((width - buttonsW) / 2), height - 16 - 30);
    ok.onClick = () => done(picked);
    const cancel = new DefButton("icancel.def", Math.round((width - buttonsW) / 2) + 64 + 18, height - 16 - 30);
    cancel.onClick = () => done(-1);
    win.addChild(ok, cancel);
    close = modals.show(win, {
      onKey: (key) => {
        if (key === "Enter" || key === " ") done(picked);
        else if (key === "Escape") done(-1);
        else if (key === "ArrowLeft" || key === "ArrowRight") {
          picked = (picked + (key === "ArrowLeft" ? choices.length - 1 : 1)) % choices.length;
          marks.forEach((m, k) => (m.visible = k === picked));
        } else if (/^[1-9]$/.test(key) && Number(key) <= choices.length) {
          // 1, 2...: that choice (also how the agent API picks).
          picked = Number(key) - 1;
          marks.forEach((m, k) => (m.visible = k === picked));
        } else return false;
        return true;
      },
    });
  });
}

/** A list to pick from in the original window style; resolves with the index, or -1 when cancelled. */
export async function choiceBox(modals: Modals, title: Text, options: Text[], player: number): Promise<number> {
  const width = 320;
  // A title of several lines pushes the rows down.
  const t = label(title, "medfont", YELLOW, "center", width - 40);
  const top = 26 + Math.max(24, Math.ceil(t.height)) + 14;
  // Touch screens: each row a finger high.
  const step = screenSize.touch ? 50 : 26;
  const height = top + options.length * step + 76;
  const win = await windowFrame(width, height, player);
  t.position.set(20, 26);
  win.addChild(t);
  return new Promise((resolve) => {
    let close = () => {};
    const done = (v: number) => {
      close();
      resolve(v);
    };
    options.forEach((text, i) => {
      const row = label(text, "medfont", WHITE, "center", width - 60);
      row.position.set(30, top + i * step + Math.round((step - 26) / 2));
      if (screenSize.touch) row.hitArea = new Rectangle(0, -Math.round((step - 26) / 2), width - 60, step);
      row.eventMode = "static";
      row.cursor = "pointer";
      row.on("pointerover", () => (row.tint = 0xffff80));
      row.on("pointerout", () => (row.tint = 0xffffff));
      row.on("pointertap", () => done(i));
      win.addChild(row);
    });
    const cancel = new DefButton("icancel.def", Math.round(width / 2 - 33), height - 56);
    cancel.onClick = () => done(-1);
    win.addChild(cancel);
    close = modals.show(win, { onKey: (k) => (k === "Escape" ? (done(-1), true) : true) });
  });
}
