// The University (and HotA's Seafaring Academy) on a phone: the skills on offer as big cards, each the original's
// tile (the skill between its two strips, gold when it can be learnt, green when the hero has it, red when not) with
// what it does and a Learn button (greyed out with the reason when it can't be learnt).
import { LEVEL_NAMES, SKILL_NAMES, UNIVERSITY_COST as COST } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { loadDef, loadImage } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { textButton, setEnabled } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { skillBody } from "./gameText.ts";
import { type UniversityOptions, priceWords, universityPrice } from "./markets.ts";
import { bigText, contentArea, openPage, pageColumn, scrollList, btnH } from "./mobilePage.ts";
import { tr, said, reason } from "../i18n/index.ts";

export async function mobileUniversity(modals: Modals, o: UniversityOptions): Promise<void> {
  let unlisten = () => {};
  const page = await openPage(modals, { draw: () => redraw(), onClose: () => unlisten() });
  const icons = (await loadDef("secskill.def").catch(() => null))?.get(0) ?? [];
  const [goldStrip, greenStrip, redStrip] = await Promise.all(["univgold.pcx", "univgren.pcx", "univred.pcx"].map((n) => loadImage(n).catch(() => null)));
  let area = contentArea();
  let list: ReturnType<typeof scrollList> | null = null;
  let drawing = Promise.resolve();

  const draw = async () => {
    // The layout now (the phone may have turned).
    area = contentArea();
    const h = o.hero();
    const parts = await pageColumn(o.town?.title ?? (o.academy ? tr("Seafaring Academy") : tr("University")), { text: o.town ? tr(`Each school costs %1 gold and 5 of its resource.`, COST) : tr(`%1 has %2 gold. Each skill costs %3.`, h.name, o.gold(), COST), buttons: [["Close", () => page.close()]] });
    const content = new Container();
    let y = 0;
    for (const skill of o.skills) {
      const level = h.skills?.find(([k]) => k === skill)?.[1] ?? 0;
      const next = Math.min(3, level + 1);
      const price = universityPrice(o, skill);
      const why = reason(o.why(skill)) ?? (price.afford ? null : o.town ? tr("Not enough resources.") : tr("Not enough gold."));
      const card = new Container();
      card.y = y;
      // The desktop's tile at 1.5x (VCMI's CUniversityWindow::CItem): the strips 22 over and 48 under the icon, 28 out to its left;
      // the name on the top strip, the level on the bottom one.
      const tile = new Container();
      const strip = (o.why(skill) && level > 0 ? greenStrip : why ? redStrip : goldStrip) ?? null;
      if (strip) for (const sy of [0, 70]) tile.addChild(Object.assign(new Sprite(strip), { y: sy }));
      const f = icons[skill * 3 + next - 1 + 3];
      if (f) tile.addChild(Object.assign(new Sprite(f.texture), { x: 28, y: 22 }));
      const tw = strip?.width ?? 100;
      tile.scale.set(1.5);
      card.addChild(Object.assign(tile, { x: 6, y: 8 }));
      // A tap on the tile learns, as the desktop's (Learn under it does the same for the thumb).
      tile.eventMode = "static";
      tile.cursor = "pointer";
      tile.on("pointertap", (e) => e.button === 0 && !why && !list?.moved() && o.learn(skill));
      const name = bigText(said(SKILL_NAMES[skill]) ?? said(""), "medfont", WHITE, 1.25, { w: tw * 1.5 - 8, center: true });
      card.addChild(Object.assign(name, { x: 10, y: 8 + Math.round((((strip?.height ?? 20) * 1.5 - name.height) / 2)) }));
      const lvl = bigText(said(LEVEL_NAMES[next]) ?? said(""), "medfont", WHITE, 1.25, { w: tw * 1.5 - 8, center: true });
      card.addChild(Object.assign(lvl, { x: 10, y: 8 + 105 + Math.round((((strip?.height ?? 20) * 1.5 - lvl.height) / 2)) }));
      const textX = tw * 1.5 + 20;
      const desc = bigText((await skillBody(skill, next)) ?? said(""), "medfont", WHITE, 1.5, { wrap: area.w - textX - 10 });
      desc.position.set(textX, 12);
      card.addChild(desc);
      let cy = Math.max(8 + 105 + (strip?.height ?? 20) * 1.5 + 10, 12 + desc.height + 10);
      // The price (or why not) in words beside the original's buy button.
      const learn = await textButton(tr("Learn"), 120, btnH(), () => !why && !list?.moved() && o.learn(skill), "medfont");
      learn.scale.set(1.25);
      setEnabled(learn, !why);
      learn.position.set(10, cy);
      card.addChild(learn);
      card.addChild(Object.assign(bigText(why ?? priceWords(price.cost), "medfont", why ? WHITE : YELLOW, 1.5, { w: area.w - 190 }), { x: 10 + 120 * 1.25 + 16, y: cy + 14 }));
      cy += 48 * 1.25 + 10;
      card.addChildAt(new Graphics().rect(0, 0, area.w, cy).fill({ color: 0, alpha: 0.5 }).stroke({ color: 0xc9a046, width: 1 }), 0);
      content.addChild(card);
      y += cy + 12;
    }
    list = scrollList(content, area, list?.offset() ?? 0);
    parts.addChild(list.view);
    page.setContent(parts);
  };
  const redraw = () => void (drawing = drawing.then(draw).catch((e) => console.error("university", e)));

  await draw();
  unlisten = o.listen(redraw);
  return page.show();
}
