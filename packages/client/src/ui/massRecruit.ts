// HotA's recruit-all window (the fort icon in the town panel): every dwelling's creature in one window, a column
// each, the shared blocks (the creature card, the slider, Min / Max, the cost boxes).
import { type CreatureStats, affordableCount } from "@heroes/core";
import { Container, Graphics } from "pixi.js";
import { WHITE, YELLOW } from "../text.ts";
import { DefButton, label, windowFrame } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { costBox, creatureCard } from "./recruit.ts";
import { creatureOnRightClick } from "./creatureInfo.ts";
import { stackWindow } from "./stackWindow.ts";
import { Slider, minMax } from "./blocks/slider.ts";
import { tr, said, type Text } from "../i18n/index.ts";
import { phoneSized, screenSize } from "./screen.ts";

export interface MassChoice {
  creature: CreatureStats;
  available: number;
  cost: number[];
  /** The dwelling's creatures, the best first (the first is `creature`): a tap on the card goes to the next. */
  alts?: CreatureStats[];
}

/** The most of each creature the resources buy, strongest (last) first. */
export function presetCounts(choices: MassChoice[], resources: number[]): number[] {
  const left = [...resources];
  const counts = choices.map(() => 0);
  for (let i = choices.length - 1; i >= 0; i--) {
    const ch = choices[i];
    const n = affordableCount(ch.cost, left, ch.available);
    counts[i] = n;
    ch.cost.forEach((c, r) => (left[r] -= c * n));
  }
  return counts;
}

/** What's left after everyone else's counts: the most of choice `i` it buys. */
export function maxBesides(choices: MassChoice[], counts: number[], resources: number[], i: number): number {
  const left = resources.map((r, k) => r - choices.reduce((a, ch, j) => a + (j === i ? 0 : ch.cost[k] * counts[j]), 0));
  return affordableCount(choices[i].cost, left, choices[i].available);
}

/** One column's pick: how many, and which of its creatures (0: the best offered, then the lesser ones). */
export interface MassPick {
  count: number;
  pick: number;
}

/**
 * HotA's window (the owner's screenshot, 2026-10-25), the same on every layout (a phone scales it to the screen): up to
 * seven columns, each the creature on its town's backdrop (a tap: the next of its dwelling's creatures, the
 * upgrade, then the basic one), how many are left after buying and how many are bought, the slider, Min and Max, the price of
 * one; under them the total, Max (four arrows: the most the treasury buys, the strongest first), Buy and Cancel.
 * The counts start at none, as HotA's, or `preset`: "all" the most of all (Max), a column's index the most of it. Resolves with each column's pick, or null when cancelled.
 */
export async function massRecruitWindow(modals: Modals, player: number, title: Text, choices: MassChoice[], resources: number[], preset?: "all" | number): Promise<MassPick[] | null> {
  const COL = 108;
  // Upright on a phone seven columns read too small: two rows of them, the window twice as big on the screen.
  const ROW = 300;
  const perRow = screenSize.portrait && phoneSized() && choices.length > 4 ? Math.ceil(choices.length / 2) : choices.length;
  const rows = Math.ceil(choices.length / perRow);
  const W = Math.max(300, 32 + perRow * COL);
  const H = 484 + (rows - 1) * ROW;
  const win = await windowFrame(W, H, player);
  win.label = "window: recruit all";
  const head = label(title, "bigfont", YELLOW, "center", W - 40);
  head.position.set(20, 18);
  win.addChild(head);
  const picks = choices.map(() => 0);
  const counts = choices.map(() => 0);
  /** Each column's creature as now picked (how many there are stays the dwelling's). */
  const current = (i: number): MassChoice => {
    const ch = choices[i];
    const alt = ch.alts?.[picks[i]];
    return alt ? { ...ch, creature: alt, cost: alt.cost } : ch;
  };
  const live = () => choices.map((_, i) => current(i));
  const maxFor = (i: number) => maxBesides(live(), counts, resources, i);
  if (preset === "all") presetCounts(live(), resources).forEach((n, i) => (counts[i] = n));
  else if (preset !== undefined && preset >= 0) counts[preset] = maxFor(preset);
  const x0 = Math.round((W - perRow * COL) / 2);
  const totalBox = new Container();
  totalBox.position.set(Math.round(W / 2 - 50), 346 + (rows - 1) * ROW);
  win.addChild(totalBox);
  const refreshers: (() => Promise<void>)[] = [];
  let buy: DefButton | null = null;
  const refreshAll = async () => {
    await Promise.all(refreshers.map((r) => r()));
    const total = [0, 0, 0, 0, 0, 0, 0];
    choices.forEach((_, i) => current(i).cost.forEach((c, k) => (total[k] += c * counts[i])));
    const box = await costBox(total, 1, 100);
    totalBox.removeChildren().forEach((c) => c.destroy({ children: true }));
    totalBox.addChild(box);
    if (buy) buy.disabled = !counts.some((n) => n > 0);
  };
  // (The columns built side by side: each card loads its creature's animation.)
  await Promise.all(choices.map(async (ch, i) => {
    const col = new Container();
    col.label = `column: ${ch.creature.plural}`;
    // (A shorter last row centred.)
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, choices.length - row * perRow);
    col.position.set(x0 + ((perRow - inRow) * COL) / 2 + (i % perRow) * COL, 50 + row * ROW);
    const cardBox = new Container();
    cardBox.position.set(4, 0);
    cardBox.eventMode = "static";
    cardBox.cursor = (ch.alts?.length ?? 0) > 1 ? "pointer" : "default";
    // A creature with an upgrade (or a second one): a tap on its picture swaps them; no mark on the picture, as HotA's own
    // window has none (2026-10-26 22:18: the swap marks on the creatures were ugly).
    const drawCard = async () => {
      const card = await creatureCard(current(i).creature);
      cardBox.removeChildren().forEach((c) => c.destroy({ children: true }));
      cardBox.addChild(card);
    };
    await drawCard();
    // Held: the creature shown now (the upgrade or the basic one), with what's left to buy.
    creatureOnRightClick(cardBox, () => ({ c: current(i).creature, info: { count: current(i).available } }), () => void stackWindow(modals, player, current(i).creature, { info: { count: current(i).available } }));
    cardBox.on("pointertap", (e) => {
      if (e.button === 2 || (ch.alts?.length ?? 0) < 2) return;
      picks[i] = (picks[i] + 1) % ch.alts!.length;
      void drawCard().then(refreshAll);
    });
    // Left after buying | to buy, in two dark boxes: the order of the Recruit window's Available | Recruit (2026-10-27:
    // "left number should be how many remain after you buy, right how much you're about to buy").
    // (Touch: medfont in taller boxes, never smalfont on a phone: the owner, 2026-11-01 "bigger counts here".)
    const big = screenSize.touch;
    const [boxY, boxH, font] = big ? [131, 24, "medfont" as const] : [134, 18, "smalfont" as const];
    const numBox = (x: number) => col.addChild(new Graphics().rect(x, boxY, 48, boxH).fill({ color: 0, alpha: 0.6 }).stroke({ color: 0x7a5d30, width: 1 }));
    numBox(2);
    numBox(52);
    const bought = label(said(""), font, WHITE, "center", 48);
    bought.position.set(52, boxY + 2);
    const left = label(said(""), font, WHITE, "center", 48);
    left.position.set(2, boxY + 2);
    const slider = new Slider(100);
    slider.position.set(2, 158);
    await slider.ready;
    const { less, most } = minMax(
      () => set(0),
      () => set(maxFor(i)),
    );
    less.position.set(1, 180);
    most.position.set(53, 180);
    const per = new Container();
    per.position.set(2, 216);
    col.addChild(cardBox, bought, left, slider, less, most, per);
    const set = (n: number) => {
      counts[i] = Math.max(0, Math.min(n, maxFor(i)));
      void refreshAll();
    };
    slider.onChange = (v) => set(v);
    refreshers.push(async () => {
      const max = maxFor(i);
      counts[i] = Math.max(0, Math.min(counts[i], max));
      const c = current(i);
      bought.value = said(String(counts[i]));
      left.value = said(String(c.available - counts[i]));
      slider.range(max, counts[i]);
      less.disabled = counts[i] === 0;
      most.disabled = counts[i] >= max;
      const box = await costBox(c.cost, 1, 100);
      per.removeChildren().forEach((x) => x.destroy({ children: true }));
      per.addChild(new Graphics().rect(0, 4, 100, 72).fill({ color: 0, alpha: 0.35 }).stroke({ color: 0x7a5d30, width: 1 }), box);
    });
    win.addChild(col);
  }));

  return new Promise((resolve) => {
    let close = () => {};
    const finish = (v: MassPick[] | null) => (close(), resolve(v));
    const y = H - 20 - 32;
    const maxB = new DefButton("ircbtns.def", W / 2 - 112, y);
    maxB.label = "button: the most of all";
    maxB.hint = tr("The most the treasury buys, the strongest first");
    maxB.onClick = () => {
      presetCounts(live(), resources).forEach((n, i) => (counts[i] = n));
      void refreshAll();
    };
    buy = new DefButton("iby6432.def", W / 2 - 32, y);
    buy.label = "button: buy";
    buy.onClick = () => counts.some((n) => n > 0) && finish(counts.map((count, i) => ({ count, pick: picks[i] })));
    const cancel = new DefButton("icn6432.def", W / 2 + 48, y);
    cancel.label = "button: cancel";
    cancel.onClick = () => finish(null);
    win.addChild(maxB, buy, cancel);
    void refreshAll();
    close = modals.show(win, {
      onKey: (key) => {
        if (key === "Enter") buy?.onClick();
        else if (key === "Escape") finish(null);
        return true;
      },
    });
  });
}
