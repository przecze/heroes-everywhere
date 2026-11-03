// The original's garrison window (GARRISON.PCX, VCMI's CGarrisonWindow): an upper row over the
// hero's army, Split and OK. Two uses, as in VCMI: creatures that joined a full army (the player
// makes room; a stack moved up is left behind, and whoever is still above at OK goes away), and a
// map garrison the hero stands in ("Leave Guards": troops left there or taken along).
import { heroPortraitHold } from "./heroPortraitHold.ts";
import type { AdventureAction, ArmySlot, Hero, World } from "@heroes/core";
import { Container, Sprite } from "pixi.js";
import { heroPortrait, loadDef } from "../assets.ts";
import { GameText, WHITE, YELLOW } from "../text.ts";
import { stackWindow } from "./stackWindow.ts";
import { ArmyClicks, type StackRef } from "./armyClicks.ts";
import { StackGrid } from "./blocks/stackGrid.ts";
import { resolveText } from "./gameText.ts";
import { DefButton, label, loadImagePlayer } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { phoneSized, screenSize } from "./screen.ts";
import { FRAME_PAD as P, SHEET_IN, SPLIT, fitSheet, sheetFoot, splitLine } from "./blocks/phoneWindow.ts";
import { openPage } from "./mobilePage.ts";
import { TOWNSCRN, part } from "./blocks/windowParts.ts";
import { splitWindow } from "./split.ts";
import { tr, said, fmt, type Text, fallback } from "../i18n/index.ts";

type Army = (ArmySlot | null)[];

interface GarrisonWindow {
  world: () => World;
  hero: () => Hero | undefined;
  /** The upper row (undefined: nothing left to show). */
  upper: () => Army | undefined;
  title: Text;
  /** CREST58's frame: the upper row's owner (8 the neutrals' grey). */
  crest: number;
  move: (from: StackRef, to: StackRef, count?: number) => void;
  okHint: Text;
  send: (a: AdventureAction) => void;
  listen: (fn: () => void) => () => void;
  /** The hero's screen, the portrait held (EXTRAS portraitHold). */
  openHero?: (id: number) => void;
}

/**
 * Upright (2026-10-27 22:31 "small dialog again"; 2026-11-03T00-04 "one row view pls, 7 stacks, no hero spot"): one of
 * phoneWindow's sheets, its title in the rim, each army's seven places in one row (the portraits a little smaller to fit
 * the sheet), the two rows a gold line apart, a note line, then Split and OK at the foot. Where the i-th (1-7) of who's
 * places is (who 2: below the rows).
 */
const CELL = StackGrid.cellSize({ size: "large" });
const GAP = 4;
/** The portraits' scale upright: seven to the sheet's width. */
const K = SHEET_IN / (7 * CELL.w + 6 * GAP);
function uprightPlace(who: number, i: number): [number, number] {
  return [P + Math.round((i - 1) * (CELL.w + GAP) * K), P + who * (Math.round((CELL.h + GAP) * K) + SPLIT)];
}

async function garrisonWindow(modals: Modals, player: number, o: GarrisonWindow): Promise<void> {
  const upright = phoneSized() && screenSize.portrait;
  const win = new Container();
  if (!upright) win.addChild(new Sprite(await loadImagePlayer("garrison.pcx", player)));
  const crests = (await loadDef("crest58.def").catch(() => null))?.get(0);
  const crest = crests?.[o.crest] ?? crests?.at(-1);
  const [crestX, crestY] = [28, 124];
  if (crest && !upright) win.addChild(Object.assign(new Sprite(crest.texture), { x: crestX, y: crestY }));
  if (!upright) {
    const head = label(o.title, "bigfont", YELLOW, "center", 500);
    head.position.set(25, 22);
    win.addChild(head);
  }
  const [, statusY] = uprightPlace(2, 0);
  const status = new GameText(phoneSized() ? "medfont" : "smalfont", [...WHITE] as [number, number, number], "center", upright ? SHEET_IN : 400);
  status.position.set(upright ? P : 75, upright ? statusY - SPLIT : phoneSized() ? 286 : 290);
  if (upright) {
    splitLine(win, P, uprightPlace(1, 0)[1] - SPLIT, SHEET_IN);
    // The empty places as the town screen's (TOWNSCRN's slot), the stacks over them.
    const slots = await Promise.all(Array.from({ length: 14 }, () => part(TOWNSCRN, "slot", player)));
    slots.forEach((sl, i) => {
      const [x, y] = uprightPlace(i < 7 ? 0 : 1, (i % 7) + 1);
      if (sl) win.addChild(Object.assign(sl, { x: x - K, y: y - K })).scale.set(K);
    });
  }
  win.addChild(status);
  const rows = (): [Army, Army] => [o.upper() ?? [], o.hero()?.army ?? []];
  const army: ArmyClicks = new ArmyClicks({
    armies: rows,
    move: o.move,
    split: (creature, left, right, minLeft, quick) => splitWindow(modals, player, o.world().creatures[creature], left, right, minLeft, quick),
    keepsOne: (who) => who === 1,
    details: (ref) => {
      const a = rows()[ref.who][ref.slot];
      const c = a && o.world().creatures[a.creature];
      const h = o.hero();
      // The hero's row: Dismiss while the hero keeps another stack (the upper row's go at OK anyway).
      const dismiss = ref.who === 1 && h && h.army.filter((x) => x).length > 1 ? () => o.send({ type: "dismissStack", hero: h.id, slot: ref.slot }) : undefined;
      if (a && c) void stackWindow(modals, player, c, { info: { count: a.count }, dismiss });
    },
  });
  // The two rows are the shared stack row (ui/blocks/stackGrid.ts) with the shared clicks, drag and drop between them.
  const grids: StackGrid[] = [0, 1].map(
    (who) =>
      new StackGrid(
        { size: "large", at: Array.from({ length: 7 }, (_, slot) => (upright ? (uprightPlace(who, slot + 1).map((v) => v / K) as [number, number]) : ([92 + slot * 62, 127 + who * 96] as const))), count: "corner" },
        {
          creatures: o.world().creatures,
          who,
          clicks: army,
          changed: () => void draw(),
          // (A finger has no hover: the line is for what a tap couldn't do, the owner 2026-10-27 22:32 "why show text for the current slot".)
          hover: (slot) => {
            if (screenSize.touch) return;
            const a = slot === null ? undefined : rows()[who][slot];
            status.value = slot === null ? said("") : a ? fmt`${a.count} ${said(o.world().creatures[a.creature]?.plural) ?? said("")}` : tr("Empty slot");
          },
          drag: { layer: win, grids: () => grids, move: (from, to) => o.move(from, to) },
        },
      ),
  );
  if (upright) grids.forEach((g) => g.scale.set(K));
  win.addChild(...grids);
  const portrait = new Sprite();
  portrait.position.set(29, 222);
  if (!upright) win.addChild(portrait);
  heroPortraitHold(portrait, o.openHero && (() => { const h = o.hero(); if (h) o.openHero!(h.id); }));
  const draw = async () => {
    const h = o.hero();
    if (!h || win.destroyed) return;
    const tex = await heroPortrait(h.type).catch(() => null);
    if (tex && !portrait.destroyed) portrait.texture = tex;
    await Promise.all(grids.map((g, who) => g.set(rows()[who])));
  };
  await draw();
  const unlisten = o.listen(() => void draw());
  // Split (IDV6432) and OK (IOK6432) where VCMI has them; upright at the sheet's foot.
  const split = new DefButton("idv6432.def", 88, 314);
  split.hint = tr("Split a stack: pick one, then this");
  split.onHint = (t) => (status.value = t);
  // The shared Split: the picked stack's split window with HotA's quick actions (as every army).
  split.onClick = async () => void ((await army.splitSelected()) ? draw() : (status.value = tr("Pick a stack of two or more first.")));
  const ok = new DefButton("iok6432.def", 399, 314);
  ok.hint = o.okHint;
  ok.onHint = (t) => (status.value = t);
  const onKey = (k: string) => (k === "Enter" || k === "Escape" ? finish() : army.quickKey(k) && void draw(), true);
  let close = () => {};
  let finished = () => {};
  const finish = () => {
    unlisten();
    close();
    finished();
  };
  ok.onClick = finish;
  if (upright) {
    await Promise.all([split.ready, ok.ready]);
    const shell = await openPage(modals, { bare: true, title: o.title, keys: (k) => onKey(k) });
    const end = sheetFoot(win, [split, ok], statusY + status.height);
    fitSheet(win, end + P);
    shell.setContent(win);
    close = () => shell.close();
    return new Promise((done) => {
      finished = done;
      void shell.show().then(() => (unlisten(), done()));
    });
  }
  win.addChild(split, ok);
  return new Promise((done) => {
    finished = done;
    close = modals.show(win, { onKey });
  });
}

type Ctx = { world: () => World; hero: () => Hero | undefined; send: (a: AdventureAction) => void; listen: (fn: () => void) => () => void; openHero?: (id: number) => void };

/** Creatures that joined a full army: make room, or leave them. */
export async function joinersWindow(modals: Modals, player: number, o: Ctx): Promise<void> {
  const first = o.hero()?.joiners?.find((x) => x);
  if (!first) return;
  const plural = o.world().creatures[first.creature]?.plural ?? "creatures";
  const who = ["joiners", "hero"] as const;
  await garrisonWindow(modals, player, {
    ...o,
    upper: () => o.hero()?.joiners,
    title: (await resolveText({ file: "genrltxt", id: 35, args: [plural] })) ?? tr("Make room for the %1 in your army", plural),
    crest: 8,
    move: (from, to, count) => {
      const h = o.hero();
      if (h) o.send({ type: "moveJoiners", hero: h.id, from: { who: who[from.who], slot: from.slot }, to: { who: who[to.who], slot: to.slot }, count });
    },
    okHint: tr("Done: whoever is left above goes away"),
  });
  const h = o.hero();
  if (h?.joiners) o.send({ type: "closeJoiners", hero: h.id });
}

/** A map garrison the hero stands in: leave guards there, or take them along. */
export async function mapGarrisonWindow(modals: Modals, player: number, o: Ctx & { garrison: () => { id: number; owner: number; army?: Army } | undefined }): Promise<void> {
  const g = o.garrison();
  if (!g || !o.hero()) return;
  const who = ["garrison", "hero"] as const;
  await garrisonWindow(modals, player, {
    ...o,
    upper: () => o.garrison()?.army ?? [],
    title: (await resolveText({ file: "genrltxt", id: 709 })) ?? fallback("Leave Guards"),
    crest: g.owner >= 0 ? g.owner : 8,
    move: (from, to, count) => o.send({ type: "moveStack", town: g.id, from: { who: who[from.who], slot: from.slot }, to: { who: who[to.who], slot: to.slot }, count }),
    okHint: tr("Done"),
  });
}
