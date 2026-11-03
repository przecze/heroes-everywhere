// The original quest log (QUESTLOG.PCX, a parchment scroll): the quests the player has been
// given by Seer's Huts and Quest Guards, open ones first; the painted check mark closes it.
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { CreatureStats } from "@heroes/core";
import { loadImage } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { FingerArea, label } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { mobileQuests } from "./mobileQuests.ts";
import { phoneSized } from "./screen.ts";
import { tr, said, fmt, type Text } from "../i18n/index.ts";

export interface QuestEntry {
  title: Text;
  text: Text;
  done: boolean;
  /** Pictures of what the quest asks for and what it gives (VCMI's quest log shows both under the text); phones only, the scroll has no room. */
  asks?: QuestPicture[];
  gives?: QuestPicture[];
}

export interface QuestPicture {
  texture: Texture;
  caption: Text;
  /** What a held picture says (componentView's), a creature its card. */
  help?: Text;
  creature?: { c: CreatureStats; count: number };
}

const BROWN: readonly [number, number, number] = [80, 48, 24];
const GREY: readonly [number, number, number] = [130, 110, 90];

export async function questLog(modals: Modals, quests: QuestEntry[]): Promise<void> {
  // Phones: a page of quest cards in big text.
  if (phoneSized()) return mobileQuests(modals, quests);
  const win = new Container();
  win.addChild(new Sprite(await loadImage("questlog.pcx", true)));
  const list = new Container();
  list.mask = win.addChild(new Graphics().rect(36, 112, 296, 340).fill(0xffffff));
  win.addChild(list);
  const footer = label(said(""), "smalfont", WHITE, "center", 280);
  footer.position.set(36, 476);
  win.addChild(footer);
  let scroll = 0;
  const draw = (): void => {
    list.removeChildren().forEach((c) => c.destroy());
    let y = 116 - scroll;
    if (!quests.length) {
      const l = label(tr("You haven't been given any quests."), "medfont", BROWN, "center", 290);
      l.position.set(38, 140);
      list.addChild(l);
    }
    for (const q of quests) {
      const title = label(fmt`${q.title}${q.done ? tr(" (completed)") : said("")}`, "medfont", q.done ? GREY : YELLOW, "left", 290);
      title.position.set(40, y);
      list.addChild(title);
      y += title.height + 2;
      const body = label(wrap(q.text, 44), "smalfont", q.done ? GREY : BROWN, "left", 290);
      body.position.set(40, y);
      list.addChild(body);
      y += body.height + 14;
    }
    // No further down than the last quest's end at the frame's foot.
    const max = Math.max(0, y + scroll - 116 - 330);
    if (scroll > max) return ((scroll = max), draw());
    const open = quests.filter((q) => !q.done).length;
    footer.value = quests.length ? tr("%1 open, %2 completed", open, quests.length - open) : said("");
  };
  draw();
  return new Promise((resolve) => {
    let close = () => {};
    const done = () => (close(), resolve());
    // The check mark is part of the picture.
    const ok = new Graphics().rect(322, 466, 34, 36).fill({ color: 0, alpha: 0.001 });
    ok.hitArea = new FingerArea(ok, 34, 36, 322, 466);
    ok.eventMode = "static";
    ok.cursor = "pointer";
    ok.on("pointertap", done);
    win.addChild(ok);
    win.eventMode = "static";
    win.on("wheel", (e) => {
      scroll = Math.max(0, scroll + (e.deltaY > 0 ? 30 : -30));
      draw();
    });
    // The scroll bar's arrows, painted on the scroll (QUESTLOG.PCX).
    for (const [y, d] of [[111, -30], [439, 30]] as const) {
      const arrow = new Graphics().rect(336, y, 18, 16).fill({ color: 0, alpha: 0.001 });
      arrow.hitArea = new FingerArea(arrow, 18, 16, 336, y);
      arrow.eventMode = "static";
      arrow.cursor = "pointer";
      arrow.on("pointertap", () => ((scroll = Math.max(0, scroll + d)), draw()));
      win.addChild(arrow);
    }
    close = modals.show(win, {
      onKey: (k) => {
        if (k === "Escape" || k === "Enter" || k === "q") done();
        else if (k === "ArrowDown") (scroll += 30, draw());
        else if (k === "ArrowUp") (scroll = Math.max(0, scroll - 30), draw());
        return true;
      },
    });
  });
}

/** Breaks text into lines of about `width` characters (labels don't wrap by themselves). */
function wrap(text: string, width: number): Text {
  return said(text
    .split("\n")
    .map((para) => {
      const out: string[] = [];
      let line = "";
      for (const word of para.split(" ")) {
        if ((line + " " + word).trim().length > width) {
          out.push(line.trim());
          line = word;
        } else line += " " + word;
      }
      out.push(line.trim());
      return out.join("\n");
    })
    .join("\n"));
}
