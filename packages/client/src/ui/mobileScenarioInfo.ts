// Scenario information on a phone: the map's name, size, how to win and lose and its description
// in big text, and who plays which colour (town, first hero, starting bonus) as the desktop card's pictures.
import { dateParts } from "@heroes/core";
import { loadDef, playerRgb } from "../assets.ts";
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { WHITE, YELLOW } from "../text.ts";
import type { Modals } from "./modals.ts";
import { bigText, contentArea, openPage, pageColumn, scrollList } from "./mobilePage.ts";
import { tr, fmt, type Text, said } from "../i18n/index.ts";
import { SIZES, bonusFrame } from "./newGameModel.ts";
import { difficultyNames } from "./newGameParts.ts";
import { startHeroIcon, startTownIcon } from "./blocks/setupBlocks.ts";


export interface ScenarioInfoPage {
  name: string;
  description: string;
  size: number;
  levels: number;
  victory: string;
  loss: string;
  difficulty: number;
  day: number;
  players: { color: number; human: boolean; faction?: string; hero: number; heroName: string; bonus?: "gold" | "resource" | "artifact"; out: boolean }[];
}

export async function mobileScenarioInfo(modals: Modals, o: ScenarioInfoPage): Promise<void> {
  const page = await openPage(modals, { draw: () => draw() });
  // Drawn again when the layout changes (the phone turned).
  const draw = async () => {
    const area = contentArea();
    const names = await difficultyNames();
    // (The size as the scenario list's letters, S M L XL: the words were English.)
    const size = `${SIZES[o.size]?.[0] ?? `${o.size}x${o.size}`}${o.levels > 1 ? tr(", two levels") : ""}`;
    const facts = `${size}\n${tr("Difficulty")}: ${names[o.difficulty] ?? names[1]}\n${tr("Month %1, Week %2, Day %3", ...dateParts(o.day))}`;
    const parts = await pageColumn(said(o.name), { text: facts, buttons: [["Close", () => page.close()]] });

    const content = new Container();
    let y = 0;
    const say = (t: Text, color: readonly [number, number, number], font: "medfont" | "bigfont" = "medfont", gap = 10) => {
      if (!t) return;
      const l = bigText(t, font, color, 1.5, { wrap: area.w });
      l.y = y;
      content.addChild(l);
      y += l.height + gap;
    };
    say(tr("Victory"), YELLOW, "medfont", 4);
    say(said(o.victory), WHITE, "medfont", 16);
    say(tr("Loss"), YELLOW, "medfont", 4);
    say(said(o.loss), WHITE, "medfont", 16);
    say(said(o.description), WHITE, "medfont", 20);
    say(tr("Players"), YELLOW, "medfont", 8);
    const stars = (await loadDef("scnrstar.def").catch(() => null))?.get(0);
    for (const p of o.players) {
      const row = new Container({ label: `row: player ${p.color}` });
      row.y = y;
      const k = 1.25;
      // The colour, then the town's, the first hero's and the bonus's pictures (48 x 32 each, as the Advanced Options').
      row.addChild(new Graphics().rect(0, 2, 32 * k, 32 * k).fill(playerRgb(p.color)).stroke({ color: 0x000000, width: 1 }));
      const [town, hero] = await Promise.all([startTownIcon(p.faction), startHeroIcon(p.hero)]);
      const bonus = p.bonus ? stars?.[bonusFrame(p.bonus, p.faction)]?.texture : undefined;
      let x = 32 * k + 10;
      for (const [t, what] of [[town, "town"], [hero, "hero"], [bonus, "bonus"]] as [Texture | null | undefined, string][]) {
        if (!t) continue;
        const pic = Object.assign(new Sprite(t), { x, y: 2, label: `picture: ${what}` });
        pic.scale.set((32 * k) / t.height);
        row.addChild(pic);
        x += pic.width + 8;
      }
      // Who plays it: the player's own colour is "Human", the others the computer; the hero's name after it.
      const who = bigText(fmt`${p.human ? tr("Human") : tr("Computer")}${p.heroName ? fmt`, ${said(p.heroName)}` : said("")}${p.out ? tr(" (out)") : said("")}`, "medfont", p.out ? [150, 150, 150] : WHITE, 1.25, { wrap: Math.max(80, area.w - x) });
      who.position.set(x + 2, Math.max(0, Math.round((32 * k - who.height) / 2) + 2));
      row.addChild(who);
      if (p.out) row.alpha = 0.6;
      content.addChild(row);
      y += Math.max(32 * k + 4, who.height) + 10;
    }
    parts.addChild(scrollList(content, area).view);
    page.setContent(parts);
  };
  await draw();
  return page.show();
}
