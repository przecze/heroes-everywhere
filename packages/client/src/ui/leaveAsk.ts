// Back on the adventure map with nothing open (2026-10-26: not the whole System Options, a small question):
// the original's question for Quit (GENRLTXT 69) with System Options' own buttons, their words in the art: Main
// Menu, Quit (leaves the game: the page before it, or the installed app closed) and Return. EXTRAS leaveAsk; off,
// Back opens System Options as Escape does.
import { DefButton, label, windowFrame } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { resolveText, englishLine } from "./gameText.ts";
import { WHITE } from "../text.ts";

/** Resolves once answered: "menu", "quit" or "return". */
export async function leaveAsk(modals: Modals, player: number): Promise<"menu" | "quit" | "return"> {
  const question = (await resolveText({ file: "genrltxt", id: 69 }).catch(() => null)) || englishLine("genrltxt", 69);
  const buttons = (["somain.def", "soquit.def", "soretrn.def"] as const).map((d) => new DefButton(d, 0, 0, player));
  await Promise.all(buttons.map((b) => b.ready));
  const bw = Math.max(...buttons.map((b) => b.width));
  const gap = 10;
  const w = 3 * bw + 2 * gap + 48;
  const text = label(question, "medfont", WHITE, "center", w - 48);
  const h = 30 + text.height + 24 + Math.max(...buttons.map((b) => b.height)) + 26;
  const win = await windowFrame(w, h, player);
  win.label = "window: leave the game";
  text.position.set(24, 30);
  win.addChild(text);
  return new Promise((resolve) => {
    let close = () => {};
    const done = (v: "menu" | "quit" | "return") => (close(), resolve(v));
    const answers = ["menu", "quit", "return"] as const;
    buttons.forEach((b, i) => {
      b.position.set(24 + i * (bw + gap), h - 26 - b.height);
      b.onClick = () => done(answers[i]);
      win.addChild(b);
    });
    close = modals.show(win, { onKey: (k) => (k === "Escape" || k === "Enter" ? done("return") : k.toLowerCase() === "m" ? done("menu") : k.toLowerCase() === "q" ? done("quit") : undefined, true) });
  });
}
