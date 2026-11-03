// The whole battle's log in a window to scroll through (EXTRAS battleLog; The owner 2026-11-02 20:13: "allow scrolling
// through the full battle log ... all these special effects that applied, because I want to be able to review it").
// The original's console shows two lines and its arrows step back a line at a time; a phone has no room for that.
import { Container, Graphics } from "pixi.js";
import { WHITE, YELLOW } from "../text.ts";
import { DefButton, blankButton, label } from "../ui/kit.ts";
import { scrollingText } from "../ui/dialogs.ts";
import { type Modals } from "../ui/modals.ts";
import { phoneSized, screenSize } from "../ui/screen.ts";
import { tr, type Text } from "../i18n/index.ts";
import { windowFrame } from "../ui/kit.ts";

/** One line of the log: a new round's line stands out. */
export type LogRow = { text: Text; round?: boolean };

/** The window, scrolled to the newest line at the foot; resolves when it's closed. */
export async function battleLogWindow(modals: Modals, rows: LogRow[], player: number): Promise<void> {
  const up = screenSize.portrait;
  // The words at a size the device reads (upright the screen is 800 game pixels across a phone's width).
  const T = up ? 1.9 : phoneSized() ? 1.25 : 1;
  const W = Math.min(up ? 780 : 720, screenSize.w - 20);
  // (Sideways clear of the page's round badge at the foot.)
  const most = Math.min(up ? Math.round(screenSize.h * 0.72) : 560, screenSize.h - (screenSize.touch ? 150 : 20));
  const title = label(tr("Battle log"), "bigfont", YELLOW, "center", Math.floor((W - 40) / T));
  title.scale.set(T);
  title.position.set(Math.round((W - title.width) / 2), 18);
  const top = Math.round(title.y + title.height + 12);
  const areaW = W - 56;
  const body = new Container();
  let y = 0;
  for (const r of rows) {
    const l = label(r.text, "medfont", r.round ? YELLOW : WHITE, "left", Math.floor((areaW - 20) / T));
    l.scale.set(T);
    l.position.set(0, y);
    body.addChild(l);
    y += l.height + Math.round(4 * T);
  }
  if (!rows.length) body.addChild(new Graphics().rect(0, 0, 1, 1).fill({ color: 0, alpha: 0 }));
  // As tall as the lines need, up to the most the screen gives.
  const areaH = Math.max(80, Math.min(most - top - 70, Math.ceil(body.height) + 8));
  const H = top + areaH + 70;
  const win = await windowFrame(W, H, player);
  const scroller = scrollingText(body, areaW, areaH, true);
  scroller.position.set(28, top);
  const ok = new DefButton("iokay.def", Math.round(W / 2 - 33), H - 54);
  win.addChild(title, scroller, ok);
  return new Promise((resolve) => {
    let close = () => {};
    const done = () => (close(), resolve());
    ok.onClick = done;
    close = modals.show(win, { onKey: (k) => (k === "Escape" || k === "Enter" ? (done(), true) : true) });
  });
}

/** The phone Menu's picture for it: the brown button with gold lines of writing (the game has none). */
export async function logPicture(): Promise<Container> {
  const c = new Container();
  c.addChild(await blankButton(48, 36));
  const g = new Graphics();
  for (let i = 0; i < 4; i++) g.rect(12, 8 + i * 6, i === 3 ? 14 : 24, 3);
  c.addChild(g.fill(0xe8c860));
  return c;
}
