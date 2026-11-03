// View Tutorial Messages on a phone: the hints this tutorial has shown as cards in big text (the
// original's list window is unreadable there), the newest first, each with its whole text.
import { Container, Graphics } from "pixi.js";
import { WHITE, YELLOW } from "../text.ts";
import type { Modals } from "./modals.ts";
import { bigText, contentArea, openPage, pageColumn, scrollList } from "./mobilePage.ts";
import { tr, said, type Text } from "../i18n/index.ts";

export async function mobileTutorialMessages(modals: Modals, messages: { title: Text; text: Text }[]): Promise<void> {
  const page = await openPage(modals, { draw: () => draw() });
  const draw = async () => {
    const area = contentArea();
    const parts = await pageColumn(tr("Tutorial Messages"), { buttons: [["Close", () => page.close()]] });
    const content = new Container();
    let y = 0;
    if (!messages.length) content.addChild(bigText(tr("No tutorial messages yet."), "medfont", WHITE, 1.5, { wrap: area.w }));
    for (const m of [...messages].reverse()) {
      const card = new Container();
      card.y = y;
      const title = bigText(m.title, "medfont", YELLOW, 1.5, { wrap: area.w - 24 });
      title.position.set(12, 10);
      // (The text without its {heading}, which is the card's title.)
      const body = bigText(said(m.text.replace(/^\s*\{[^}]*\}\s*/, "").trim()), "medfont", WHITE, 1.5, { wrap: area.w - 24 });
      body.position.set(12, 14 + title.height);
      const h = 24 + title.height + body.height;
      card.addChild(new Graphics().rect(0, 0, area.w, h).fill({ color: 0, alpha: 0.5 }).stroke({ color: 0xc9a046, width: 1 }), title, body);
      content.addChild(card);
      y += h + 12;
    }
    parts.addChild(scrollList(content, area).view);
    page.setContent(parts);
  };
  await draw();
  return page.show();
}
