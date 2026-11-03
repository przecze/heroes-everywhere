// The original Split Stack window (GPUCRDIV.PCX): the same creature on both sides, a slider
// between them; positions follow VCMI's CSplitWindow.
import type { CreatureStats } from "@heroes/core";
import { Slider } from "./blocks/slider.ts";
import { Container, Graphics, Sprite } from "pixi.js";
import { WHITE } from "../text.ts";
import { DefButton, label, loadImagePlayer, windowFrame } from "./kit.ts";
import { type Modals } from "./modals.ts";
import type { QuickOps } from "./quickPlan.ts";
import { quickStrip } from "./quickStack.ts";
import { creatureCard } from "./recruit.ts";
import { creatureHold } from "./stackWindow.ts";
import { screenSize } from "./screen.ts";
import { said } from "../i18n/index.ts";

/**
 * Splits `left + right` creatures; resolves to the new right-hand amount, or null if cancelled. With `quick` (a stack
 * picked with the Split button): HotA's quick stack actions under the window, as pictures; one of them closes it (null).
 */
export async function splitWindow(modals: Modals, player: number, c: CreatureStats, left: number, right: number, minLeft = 0, quick?: QuickOps): Promise<number | null> {
  const total = left + right;
  const win = new Container();
  const back = new Sprite(await loadImagePlayer("gpucrdiv.pcx", Math.max(0, player)));
  win.addChild(back);
  const [l, r] = await Promise.all([creatureCard(c), creatureCard(c)]);
  l.position.set(20, 54);
  r.position.set(177, 54);
  win.addChild(l, r);
  creatureHold(l, modals, player, c, () => ({ count: total - amount }));
  creatureHold(r, modals, player, c, () => ({ count: amount }));
  const leftL = label(said(""), "bigfont", WHITE, "center", 100);
  const rightL = label(said(""), "bigfont", WHITE, "center", 100);
  leftL.position.set(20, 226);
  rightL.position.set(176, 226);
  win.addChild(leftL, rightL);
  // The slider (ui/blocks/slider.ts): 257 wide at (21, 194), as VCMI's.
  const slider = new Slider(257);
  slider.position.set(21, 194);
  await slider.ready;
  win.addChild(slider);
  const max = total - minLeft;
  let amount = Math.min(right, max);
  let focus: "left" | "right" = "right";
  let typed = "";
  // The box being typed in ends with the original's text caret, "_" (VCMI's CTextInput); not a yellow bar under it
  // (2026-10-31 20:01), and none on a touch screen, which has no keys to type with (2026-10-27 22:05).
  const caret = (side: "left" | "right") => (focus === side && !screenSize.touch ? "_" : "");
  const refresh = () => {
    amount = Math.max(0, Math.min(max, amount));
    leftL.value = said(String(total - amount) + caret("left"));
    rightL.value = said(String(amount) + caret("right"));
    slider.range(max, amount);
  };
  slider.onChange = (v) => ((amount = v), refresh());
  // The two amounts are boxes to type in (VCMI's text inputs at 20,218 / 176,218): a click picks
  // one, digits type its number, Backspace takes one off; the other side gets the rest.
  const showFocus = () => refresh();
  for (const side of ["left", "right"] as const) {
    const box = new Graphics().rect(side === "left" ? 20 : 176, 218, 100, 36).fill({ color: 0, alpha: 0.001 });
    box.eventMode = "static";
    box.cursor = "text";
    box.on("pointertap", () => ((focus = side), (typed = ""), showFocus()));
    win.addChild(box);
  }
  const type = (key: string) => {
    typed = key === "Backspace" ? typed.slice(0, -1) : (typed + key).replace(/^0+(?=\d)/, "").slice(0, 6);
    const n = Number(typed || "0");
    amount = focus === "right" ? n : total - n;
    refresh();
  };
  showFocus();
  refresh();
  // (Built before the window shows, so a phone fits the whole of it on screen.)
  let cancelNow = () => {};
  if (quick) await addQuick(win, back.width, back.height, player, quick, () => cancelNow());
  return new Promise((resolve) => {
    let close = () => {};
    const ok = new DefButton("iok6432.def", 20, 263, player);
    const cancel = new DefButton("icn6432.def", 214, 263, player);
    ok.onClick = () => (close(), resolve(amount));
    cancel.onClick = () => (close(), resolve(null));
    win.addChild(ok, cancel);
    cancelNow = () => cancel.onClick();
    close = modals.show(win, {
      onKey: (k) => {
        if (k === "Enter") ok.onClick();
        else if (k === "Escape") cancel.onClick();
        else if (k === "ArrowLeft") (amount--, refresh());
        else if (k === "ArrowRight") (amount++, refresh());
        else if (/^[0-9]$/.test(k) || k === "Backspace") type(k);
        else if (k === "Tab") ((focus = focus === "left" ? "right" : "left"), (typed = ""), showFocus());
        return true;
      },
    });
  });
}

/** HotA's quick actions in a strip of their own under the split window (the same frame as every dialog). */
async function addQuick(win: Container, w: number, h: number, player: number, quick: QuickOps, done: () => void) {
  // As many buttons as fit inside the strip's frame (2026-10-27 22:05: five of them ran over its edge).
  const n = quick.upgradeAll ? 5 : 4;
  const gap = 8;
  const bw = Math.min(52, Math.floor((w - 36 - (n - 1) * gap) / n));
  const strip = await quickStrip(quick, done, bw, 36, gap);
  if (win.destroyed) return;
  const frame = await windowFrame(w, strip.height + 36, player);
  frame.position.set(0, h - 4);
  strip.position.set(Math.round((w - strip.width) / 2), 18);
  frame.addChild(strip);
  win.addChild(frame);
}
