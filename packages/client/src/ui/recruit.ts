// The original recruitment window (TPRCRT), laid out like the game (positions from VCMI's CRecruitmentWindow).
import { type CreatureStats, affordableCount } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { creaturePic } from "./creaturePic.ts";
import { creatureHold } from "./stackWindow.ts";
import { loadDef } from "../assets.ts";
import { type FontName, WHITE, YELLOW } from "../text.ts";
import { DefButton, label, loadImagePlayer, smallFont } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { Slider } from "./blocks/slider.ts";
import { tr, said, type Text } from "../i18n/index.ts";

export interface RecruitChoice {
  creature: CreatureStats;
  available: number;
  /** Cost of one creature (all zero for free level 1 map dwellings). */
  cost: number[];
}

/** A creature on its town's backdrop, as in the recruit and hire windows (100 x 130), animated as the original. */
export function creatureCard(c: CreatureStats): Promise<Container> {
  return creaturePic(c, true);
}

/**
 * A cost box as VCMI's CreatureCostBox: the big RESOURCE icons side by side in the middle of the
 * 97x74 box (gold first), each amount under its icon in the box's bottom strip.
 */
export async function costBox(cost: number[], times: number, w: number): Promise<Container> {
  const box = new Container();
  const icons = (await loadDef("resource.def")).get(0) ?? [];
  const used = cost.map((n, i) => [i, n * times]).filter(([, n]) => n > 0).reverse();
  if (!used.length) used.push([6, 0]);
  let x = w / 2 - 16 * used.length - 8 * (used.length - 1);
  for (const [res, n] of used) {
    const f = icons[res];
    if (f) box.addChild(Object.assign(new Sprite(f.texture), { x: x + f.x, y: 22 + f.y }));
    const t = label(said(String(n)), smallFont(), WHITE, "center", 48);
    t.centreOn(x + 15, 22 + 43);
    box.addChild(t);
    x += 48;
  }
  return box;
}

/** Opens the window; resolves with the creature picked and how many, or null. */
export async function recruitWindow(modals: Modals, player: number, title: Text | ((c: CreatureStats) => Text), choices: RecruitChoice[], resources: number[]): Promise<{ index: number; count: number } | null> {
  // (Phones too: the window scaled to the screen, as every dialog; its cards, slider and Max are the same blocks.)
  const win = new Container();
  const bg = new Sprite(await loadImagePlayer("tprcrt.pcx", player));
  win.addChild(bg);
  const W = bg.width;
  const off = (W - 484) / 2;
  // The title names the picked creature (HotA's "Recruit Halberdiers", then "Recruit Pikemen" when the other card is picked).
  const titleOf = (i: number) => (typeof title === "function" ? title(choices[i].creature) : title);
  const head = label(titleOf(0), "bigfont", YELLOW, "center", W - 40);
  head.centreOn(20 + (W - 40) / 2, 32);
  win.addChild(head);

  let sel = 0;
  let count = 0;
  const maxFor = (i: number) => {
    const ch = choices[i];
    return affordableCount(ch.cost, resources, ch.available);
  };

  // Creature cards, side by side above the controls.
  const cards = await Promise.all(choices.map((ch) => creatureCard(ch.creature)));
  const cw = 102;
  const startX = W / 2 - (cards.length * cw) / 2;
  const frames: Graphics[] = [];
  cards.forEach((card, i) => {
    card.position.set(startX + i * cw + 1, 64);
    const frame = new Graphics().rect(-1, -1, 102, 132).stroke({ color: 0xffff00, width: 2 });
    frames.push(frame);
    card.addChild(frame);
    card.eventMode = "static";
    card.cursor = "pointer";
    card.on("pointertap", (e) => e.button !== 2 && select(i));
    creatureHold(card, modals, player, choices[i].creature, () => ({ count: choices[i].available }));
    win.addChild(card);
  });

  // The boxes (available / to recruit, cost per troop / total) are drawn in TPRCRT itself.
  const text = (t: Text, x: number, y: number, font: FontName = "smalfont") => {
    const l = label(t, font, WHITE, "center", 100).centreOn(x, y);
    win.addChild(l);
    return l;
  };
  text(tr("Available"), off + 204, 233);
  text(tr("Recruit"), off + 279, 233);
  text(tr("Cost Per Troop"), off + 113, 232);
  text(tr("Total Cost"), off + 372, 232);
  // (The counts in the phones' bigger font, as the cost boxes' amounts: EXTRAS phoneNumbers.)
  const availL = text(said(""), off + 204, 253, smallFont());
  const countL = text(said(""), off + 279, 253, smallFont());
  const perBox = new Container();
  perBox.position.set(off + 65, 222);
  const totalBox = new Container();
  totalBox.position.set(off + 323, 222);
  win.addChild(perBox, totalBox);

  // The slider (ui/blocks/slider.ts) where VCMI's CSlider sits, at (176, 279), 135 wide.
  const slider = new Slider(135);
  slider.position.set(off + 176, 279);
  await slider.ready;
  slider.onChange = (v) => ((count = v), void refresh());
  win.addChild(slider);

  let buyB: DefButton | null = null;
  const refresh = async () => {
    const ch = choices[sel];
    const max = maxFor(sel);
    count = Math.max(0, Math.min(count, max));
    frames.forEach((f, i) => (f.visible = i === sel));
    head.value = titleOf(sel);
    // Nothing to recruit: Recruit greyed (a tap says why), as Max at nothing more.
    if (buyB) buyB.disabled = count <= 0;
    availL.value = said(String(ch.available - count));
    countL.value = said(String(count));
    slider.range(max, count);
    const [per, total] = await Promise.all([costBox(ch.cost, 1, 97), costBox(ch.cost, count, 97)]);
    perBox.removeChildren().forEach((c) => c.destroy({ children: true }));
    totalBox.removeChildren().forEach((c) => c.destroy({ children: true }));
    perBox.addChild(per);
    totalBox.addChild(total);
  };
  const select = (i: number) => {
    sel = i;
    // As VCMI's CRecruitmentWindow::select: another card picked, the slider goes to its most.
    count = maxFor(i);
    void refresh();
  };
  return new Promise((resolve) => {
    let close = () => {};
    const finish = (v: { index: number; count: number } | null) => {
      close();
      resolve(v);
    };
    const maxB = new DefButton("ircbtns.def", off + 134, 313);
    maxB.onClick = () => ((count = maxFor(sel)), void refresh());
    const buy = new DefButton("iby6432.def", off + 212, 313);
    buy.onClick = () => finish(count > 0 ? { index: sel, count } : null);
    buy.explain(modals, player, () => (choices[sel].available <= 0 ? tr("No creatures to recruit.") : maxFor(sel) <= 0 ? tr("Not enough resources.") : null));
    buyB = buy;
    const cancel = new DefButton("icn6432.def", off + 290, 313);
    cancel.onClick = () => finish(null);
    win.addChild(maxB, buy, cancel);
    select(0);
    close = modals.show(win, {
      onKey: (key) => {
        if (key === "Enter") finish(count > 0 ? { index: sel, count } : null);
        else if (key === "Escape") finish(null);
        else if (key === "ArrowLeft") (count = Math.max(0, count - 1)), void refresh();
        else if (key === "ArrowRight") (count += 1), void refresh();
        else if (key === "m" || key === "End") (count = maxFor(sel)), void refresh();
        else if (key === "Home") (count = 0), void refresh();
        // Tab: the other creature of the dwelling (the upgrade or the basic one).
        else if (key === "Tab" && choices.length > 1) select((sel + 1) % choices.length);
        return true;
      },
    });
  });
}

