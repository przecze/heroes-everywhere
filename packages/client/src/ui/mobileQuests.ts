// The quest log on a phone: a card per quest (open ones first, as the log has them) in big text.
import { Container, Graphics, Sprite } from "pixi.js";
import { WHITE, YELLOW } from "../text.ts";
import { type Modals } from "./modals.ts";
import { explainHeld } from "./dialogs.ts";
import { screenPlayer } from "./creatureInfo.ts";
import type { QuestEntry, QuestPicture } from "./questLog.ts";
import { bigText, contentArea, openPage, pageColumn, scrollList } from "./mobilePage.ts";
import { tr, said, fmt, type Text } from "../i18n/index.ts";

const GREY = [150, 150, 150] as const;

export async function mobileQuests(modals: Modals, quests: QuestEntry[]): Promise<void> {
  const page = await openPage(modals, { draw: () => draw() });
  // Drawn again when the layout changes (the phone turned).
  const draw = async () => {
    const area = contentArea();
    const open = quests.filter((q) => !q.done).length;
    const parts = await pageColumn(tr("Quest Log"), { text: quests.length ? tr(`%1 open, %2 completed`, open, quests.length - open) : undefined, buttons: [["Close", () => page.close()]] });
    const content = new Container();
    let y = 0;
    if (!quests.length) content.addChild(bigText(tr("You haven't been given any quests."), "medfont", WHITE, 1.5, { wrap: area.w }));
    for (const q of quests) {
      const card = new Container();
      card.y = y;
      const title = bigText(fmt`${q.title}${q.done ? tr(" (completed)") : said("")}`, "medfont", q.done ? GREY : YELLOW, 1.5, { wrap: area.w - 24 });
      title.position.set(12, 10);
      const body = bigText(q.text, "medfont", q.done ? GREY : WHITE, 1.5, { wrap: area.w - 24 });
      body.position.set(12, 14 + title.height);
      let h = 24 + title.height + body.height;
      const pics = new Container();
      // Required, then Reward: side by side when there is room (the landscape phone), else one under the other.
      let px = 0;
      let top = h;
      let bottom = h;
      for (const [label, row] of [[tr("Required"), q.asks], [tr("Reward"), q.gives]] as const) {
        if (!row?.length) continue;
        const r = pictureRow(label, row, area.w - 24, q.done);
        if (px && px + r.width > area.w - 24) ((px = 0), (top = bottom + 8));
        r.position.set(12 + px, top);
        pics.addChild(r);
        px += r.width + 24;
        bottom = Math.max(bottom, top + r.height);
      }
      h = bottom + (pics.children.length ? 12 : 0);
      card.addChild(new Graphics().rect(0, 0, area.w, h).fill({ color: 0, alpha: 0.5 }).stroke({ color: q.done ? 0x606060 : 0xc9a046, width: 1 }), title, body, pics);
      content.addChild(card);
      y += h + 12;
    }
    parts.addChild(scrollList(content, area).view);
    page.setContent(parts);
  };
  await draw();
  return page.show();
}

/** A label and the quest's pictures along a row (the original's 82 px icons, captions centred under them), wrapping when they don't fit. */
function pictureRow(label: Text, row: QuestPicture[], width: number, done: boolean): Container {
  const out = new Container();
  const tag = bigText(label, "medfont", done ? GREY : YELLOW, 1.25);
  out.addChild(tag);
  const cell = 150;
  let x = 0;
  let y = tag.height + 4;
  let lineH = 0;
  for (const p of row) {
    if (x && x + cell > width) ((x = 0), (y += lineH + 6), (lineH = 0));
    const icon = new Sprite(p.texture);
    icon.alpha = done ? 0.6 : 1;
    icon.position.set(x + (cell - icon.width) / 2, y);
    const cap = bigText(p.caption, "medfont", done ? GREY : WHITE, 1.25, { w: cell - 8, center: true });
    cap.position.set(x + 4, y + icon.height + 2);
    // Each picture explains itself held, as a message's (a creature its card, an artifact its text).
    explainHeld(icon, p, screenPlayer());
    out.addChild(icon, cap);
    x += cell;
    lineH = Math.max(lineH, icon.height + 2 + cap.height);
  }
  return out;
}
