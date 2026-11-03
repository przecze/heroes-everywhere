// The hero exchange window: HD mod's (TRADE3, with its quick-exchange buttons) when its files are
// there, else the original TRADE2; laid out like the game (positions from VCMI's CExchangeWindow,
// and measured off TRADE3 for HD's rows).
import { heroPortraitHold } from "./heroPortraitHold.ts";
import { type AdventureAction, type GameData, type Hero, type TransferRef, LOCKED, experienceForLevel, LEVEL_NAMES, SKILL_NAMES, SLOT, effectivePrimary, maxMana, stackSkills } from "@heroes/core";
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { artifactHold } from "./artifactHold.ts";
import { heroPortrait, loadDef, specialtyIcon } from "../assets.ts";
import { WHITE } from "../text.ts";
import { playSound } from "../audio.ts";
import { splitWindow } from "./split.ts";
import { stackWindow } from "./stackWindow.ts";
import { ArmyClicks } from "./armyClicks.ts";
import { StackGrid } from "./blocks/stackGrid.ts";
import { redraws } from "./redraw.ts";
import { DefButton, dragSource, label, loadImagePlayer, slotAt } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { infoArea, messageBox } from "./dialogs.ts";
import { ArtifactHand, type HandPlace } from "./artifactHand.ts";
import { gameTexts } from "./highScores.ts";
import { phoneSized } from "./screen.ts";
import { skillInfo } from "./skillHelp.ts";
import { heroClassName, moraleLuckText, resolveText, textTable } from "./gameText.ts";
import { specialties } from "./heroScreen.ts";
import { mobileExchange } from "./mobileExchange.ts";
import { quickPanel } from "./drawnButtons.ts";
import { tr, said, fallback, fmt, type Text, NONE } from "../i18n/index.ts";

const SLOT_POS = [
  [509, 30], [568, 242], [509, 80], [383, 69], [562, 184], [509, 131], [431, 69], [610, 184], [515, 295],
  [383, 143], [399, 193], [415, 244], [431, 295], [564, 30], [610, 30], [610, 76], [610, 122], [610, 310], [381, 295],
];

export interface ExchangeOptions {
  data: GameData;
  /** Morale and luck as the hero screen shows them. */
  moraleLuck: (h: Hero) => { morale: number; luck: number };
  heroes: () => [Hero, Hero];
  send: (a: AdventureAction) => void;
  listen: (fn: () => void) => () => void;
  /** A click on a hero's portrait: that hero's screen. */
  openHero?: (id: number) => void;
  /** The quest log's buttons beside the portraits (VCMI's questlogButton): greyed with no entries. */
  quests?: { any: () => boolean; open: () => void };
}

export async function exchangeWindow(modals: Modals, player: number, o: ExchangeOptions): Promise<void> {
  // Phones: a page each for the armies and the artifacts, with big slots.
  if (phoneSized()) return mobileExchange(modals, player, o);
  const win = new Container();
  const hdBg = await loadImagePlayer("trade3.bmp", player).catch(() => null);
  const hd = !!hdBg;
  win.addChild(new Sprite(hdBg ?? (await loadImagePlayer("trade2.pcx", player))));
  // Where each row starts for each hero: [left hero, right hero] x, and the row's y.
  const L = hd
    ? { stats: { x: [67, 557], y: 42 }, skills: { x: [31, 485], y: 81 }, army: { x: [67, 485], y: 120 } }
    : { stats: { x: [67, 557], y: 45 }, skills: { x: [32, 486], y: 88 }, army: { x: [69, 487], y: 131 } };
  const shown = new Container();
  win.addChild(shown);
  const status = label(said(""), "smalfont", WHITE, "center", 725);
  status.position.set(5, 581);
  win.addChild(status);
  const [pskil, arts, secsk, un32, mrl, lck] = await Promise.all([
    loadDef("pskil32.def"),
    loadDef("artifact.def"),
    loadDef("secsk32.def"),
    Promise.all(o.heroes().map(async (h) => [h.type, await specialtyIcon(h.type, "small")] as const)).then((l) => new Map(l)),
    loadDef("imrl30.def").catch(() => loadDef("imrl22.def")),
    loadDef("ilck30.def").catch(() => loadDef("ilck22.def")),
  ]);
  const pskil21 = hd ? await loadDef("pskil21.def").catch(() => null) : null;
  const ids = () => [o.heroes()[0].id, o.heroes()[1].id] as [number, number];
  const { hand, army } = exchangeClicks(modals, player, o, () => void draw());
  /** Where each hero's backpack is turned to (five places shown). */
  const bagScroll = [0, 0];
  const bagArrows: DefButton[][] = [];
  const moraleLuck = o.moraleLuck;

  const draw = redraws(shown, async (layer) => {
    const pair = o.heroes();
    const ids: [number, number] = [pair[0].id, pair[1].id];
    const add = (x: number, y: number, c: Container) => (c.position.set(x, y), layer.addChild(c));
    // (The armies are the shared stack row below; these are the artifacts' places.)
    const click = (ref: TransferRef & { bagAt?: number }) => () => {
      army.selected = null;
      hand.click({ who: ref.who, slot: ref.slot, backpack: ref.backpack }, ref.bagAt);
    };
    // HD-style drag and drop between the artifacts' places (mouse or finger).
    type Ref = TransferRef & { bagAt?: number };
    const slots = { artifact: [] as { c: Container; ref: Ref }[] };
    const tappable = (c: Container, kind: "artifact", ref: Ref, filled: boolean) => {
      slots[kind].push({ c, ref });
      // (Dragging is HD mod's way; the original's is the click to pick up and the click to put down.)
      const fixed = ref.slot === SLOT.SPELLBOOK || ref.slot === SLOT.MACH4;
      const dragged = filled && !fixed && !hand.held
        ? dragSource(c, win, (x, y) => {
            const to = slotAt(slots[kind], x, y);
            hand.drop();
            army.selected = null;
            if (to && (to.who !== ref.who || to.slot !== ref.slot || to.backpack !== ref.backpack))
              o.send({ type: "transfer", heroes: ids, kind, from: { who: ref.who, slot: ref.slot, backpack: ref.backpack }, to: to.slot === undefined ? { who: to.who, backpack: to.bagAt } : { who: to.who, slot: to.slot, backpack: to.backpack } });
            void draw();
          })
        : () => false;
      const tap = click(ref);
      c.eventMode = "static";
      c.cursor = "pointer";
      c.on("pointertap", () => !dragged() && tap());
    };
    const armyGrids: StackGrid[] = [];
    for (const who of [0, 1] as const) {
      const h = pair[who];
      const portrait = await heroPortrait(h).catch(() => null);
      if (portrait) add(257 + 228 * who, 13, new Sprite(portrait));
      // GENRLTXT 139: "%s, Level %d %s" (VCMI's CExchangeWindow titles).
      const title = label(tr(`%1, Level %2 %3`, h.name, h.level, await heroClassName(h.heroClass, h)), "smalfont", WHITE, "center", 260);
      add((who ? 653 : 147) - 130, 18, title);
      const prim = effectivePrimary(h);
      for (let g = 0; g < 4; g++) {
        const v = label(said(String(prim[g])), "smalfont", WHITE, "center", 40);
        // TRADE3: four 26-pixel rows from y 10, boxes centred at 353 / 449.
        if (hd) add((who ? 449 : 353) - 20, 21 + 26 * g - 7, v);
        else add((who ? 445 : 352) - 20, 35 + 36 * g - 7, v);
      }
      // Specialty, experience, spell points, morale, luck (32x32 icons, values under the middle two).
      const sx = L.stats.x[who];
      const icon = (tex: Texture | undefined, k: number) => tex && add(sx + 36 * k, L.stats.y, new Sprite(tex));
      icon(un32.get(h.type), 0);
      icon(pskil.get(0)?.[4]?.texture, 1);
      icon(pskil.get(0)?.[5]?.texture, 2);
      const ml = moraleLuck(h);
      icon(mrl.get(0)?.[ml.morale + 3]?.texture, 3);
      icon(lck.get(0)?.[ml.luck + 3]?.texture, 4);
      // Each explains itself as VCMI's CExchangeWindow areas: a click or the right button reads the text, the status bar
      // says what it is (HEROSCRN 27, 9, 22 and 3-8).
      const area = (x: number, y: number, w: number, hh: number, text: () => Promise<Text | null | undefined>, hover: Text, comp?: () => Promise<{ texture: Texture; caption: Text } | null>) => {
        const a = new Graphics().rect(0, 0, w, hh).fill({ color: 0, alpha: 0.001 });
        a.position.set(x, y);
        a.on("pointerover", () => (status.value = hover)).on("pointerout", () => (status.value = said("")));
        a.cursor = "pointer";
        infoArea(modals, a, player, text, comp);
        layer.addChild(a);
      };
      const hs = await textTable("heroscrn");
      const frame = (def: string, v: number) => async () => {
        const t = (await loadDef(def).catch(() => null))?.get(0)?.[v + 3]?.texture;
        return t ? { texture: t, caption: NONE } : null;
      };
      // The four primary skill rows (VCMI's primSkillAreas: ARRAYTXT 2-5 with the skill's picture, HEROSCRN 1 "View %s Info" on the bar).
      const pri = await textTable("priskill");
      // (One column between the two heroes, so drawn with the first.)
      for (let g = 0; g < 4 && !who; g++) {
        const name = pri(g, said(["Attack", "Defense", "Spell Power", "Knowledge"][g]));
        const row = hd ? [324, 12 + 26 * g, 152, 22] : [329, 19 + 36 * g, 140, 32];
        area(row[0], row[1], row[2], row[3], () => resolveText({ file: "arraytxt", id: 2 + g }), hs(1, said("View %s Info"), name), async () => { // i18n-ok (HEROSCRN 1 is always there; this is its English form)
          const t = pskil.get(0)?.[g]?.texture;
          return t ? { texture: t, caption: name } : null;
        });
      }
      area(sx, L.stats.y, 32, 32, async () => (await specialties())[h.type]?.[2], hs(27, tr("View Special Ability Info")));
      area(sx + 36, L.stats.y, 32, 32, () => resolveText({ file: "genrltxt", id: 2, args: [h.level, experienceForLevel(h.level + 1), h.experience] }), hs(9, tr("View Experience Info")));
      area(sx + 72, L.stats.y, 32, 32, () => resolveText({ file: "genrltxt", id: 205, args: [h.name, h.mana ?? 0, maxMana(h)] }), hs(22, tr("View Spell Points Info")));
      area(sx + 108, L.stats.y, 32, 32, () => moraleLuckText(true, ml.morale), hs(ml.morale > 0 ? 3 : ml.morale < 0 ? 5 : 4, tr("View Morale Info")), frame("imrl82.def", ml.morale));
      area(sx + 144, L.stats.y, 32, 32, () => moraleLuckText(false, ml.luck), hs(ml.luck > 0 ? 6 : ml.luck < 0 ? 8 : 7, tr("View Luck Info")), frame("ilck82.def", ml.luck));
      // The portrait opens the hero's screen (unless an artifact is in hand).
      if (o.openHero) {
        const pa = new Graphics().rect(0, 0, 58, 64).fill({ color: 0, alpha: 0.001 });
        pa.position.set(257 + 228 * who, 13);
        pa.eventMode = "static";
        pa.cursor = "pointer";
        pa.on("pointertap", (e) => e.button !== 2 && !hand.held && o.openHero?.(h.id));
        heroPortraitHold(pa, () => !hand.held && o.openHero?.(h.id));
        layer.addChild(pa);
      }
      const xp = label(said(String(h.experience)), "smalfont", WHITE, "center", 40);
      add(sx + 36 + 16 - 20, L.stats.y + 26 - 7, xp);
      const mana = label(fmt`${h.mana ?? 0}/${maxMana(h)}`, "smalfont", WHITE, "center", 40);
      add(sx + 72 + 16 - 20, L.stats.y + 26 - 7, mana);
      // Secondary skills: SECSK32, three frames per skill (basic, advanced, expert) after the first three.
      (h.skills ?? []).forEach(([skill, level], g) => {
        const f = secsk.get(0)?.[skill * 3 + level + 2];
        if (!f) return;
        const c = new Container();
        c.addChild(new Sprite(f.texture));
        c.eventMode = "static";
        c.on("pointerover", () => (status.value = fmt`${said(LEVEL_NAMES[level]) ?? said("")} ${said(SKILL_NAMES[skill]) ?? said("")}`));
        skillInfo(modals, c, player, skill, level);
        add(L.skills.x[who] + 36 * g, L.skills.y, c);
      });
      // Army: the shared stack row, small portraits in a row (drag and drop between the two heroes too).
      const grid = new StackGrid(
        { size: "small", at: Array.from({ length: 7 }, (_, slot) => [slot * 36, 0] as const), count: "corner" },
        {
          creatures: o.data.creatures,
          who,
          clicks: army,
          changed: () => (hand.drop(), void draw()),
          info: (slot, count) => ({ count, ...stackSkills(h, o.data.creatures[h.army[slot]?.creature ?? -1]) }),
          hover: (slot) => {
            const a = slot === null ? null : h.army[slot];
            status.value = a ? fmt`${a.count} ${said(o.data.creatures[a.creature]?.plural) ?? said("")}` : said("");
          },
          drag: { layer: win, grids: () => armyGrids, move: (from, to) => o.send({ type: "transfer", heroes: ids, kind: "army", from: { who: from.who as 0 | 1, slot: from.slot }, to: { who: to.who as 0 | 1, slot: to.slot } }) },
        },
      );
      armyGrids.push(grid);
      await grid.set(h.army);
      add(L.army.x[who], L.army.y, grid);
      // Artifacts: paper dolls side by side, then the backpacks.
      const dx = who ? 98 : -334;
      const place = (x: number, y: number, real: number, ref: Ref) => {
        const c = new Container();
        c.addChild(new Graphics().rect(0, 0, 44, 44).fill({ color: 0, alpha: 0.001 }));
        const hp: HandPlace = { who: ref.who, slot: ref.slot, backpack: ref.backpack };
        // The artifact in hand is on the cursor: its place shows empty.
        const art = hand.hides(hp) ? -1 : real;
        // A slot taken by a combination artifact's part shows the lock (frame 145), as on the hero screen.
        const f = art >= 0 ? arts.get(0)?.[art] : art === LOCKED ? arts.get(0)?.[145] : undefined;
        // At its place in the 44x44 slot: ARTIFACT.DEF's frames are trimmed.
        if (f) c.addChild(Object.assign(new Sprite(f.texture), { x: f.x, y: f.y }));
        // The slots (of either hero) that take the artifact in hand light up: ARTIFACT.DEF's frame 144.
        const lit = arts.get(0)?.[144];
        if (lit && ((ref.slot !== undefined && hand.takes(who, ref.slot)) || hand.framed(hp))) c.addChild(Object.assign(new Sprite(lit.texture), { x: lit.x, y: lit.y }));
        tappable(c, "artifact", ref, art >= 0);
        c.on("pointerover", () => (status.value = art >= 0 ? (said(o.data.artifacts[art]?.name) ?? said("")) : said("")));
        artifactHold(c, player, o.data, art, o.heroes()[who]);
        add(x, y, c);
      };
      SLOT_POS.forEach(([x, y], slot) => place(x + dx, y + 151, h.equipped?.[slot] ?? -1, { who, slot }));
      // The backpack: five places; with more, its arrows turn it round (as on the hero screen).
      const bag = hand.bag(who);
      bagScroll[who] = bag.length > 5 ? ((bagScroll[who] % bag.length) + bag.length) % bag.length : 0;
      for (let k = 0; k < 5; k++) {
        const i = bag.length > 5 ? (bagScroll[who] + k) % bag.length : k;
        place(403 + 46 * k + dx, 365 + 151, bag[i]?.art ?? -1, { who, backpack: bag[i]?.index, bagAt: i });
      }
      for (const b of bagArrows[who] ?? []) b.disabled = bag.length <= 5;
    }
    for (let g = 0; g < 4; g++) {
      const f = (hd && pskil21 ? pskil21 : pskil).get(0)?.[g];
      if (f) add(hd ? 390 : 385, hd ? 11 + 26 * g : 19 + 36 * g, new Sprite(f.texture));
    }
  });

  // HD mod's quick exchange, drawn in TRADE3 itself: all the army or all the artifacts to one side
  // or swapped (middle), and each stack across on its own (the arrows under the army). Without HotA's files (TRADE2,
  // no quick buttons in it) our own drawn ones (drawnButtons' quickPanel) between the paper dolls, over TRADE2's first
  // double arrow's gap: the HotA ergonomics stay with the plain game's files.
  const Q = hd ? { x: 327, y: 119 } : { x: 326, y: 184 };
  if (!hd) {
    const panel = new Sprite(await quickPanel(["army", "artifact"]));
    panel.label = "picture: quick buttons (drawn)";
    panel.position.set(Q.x, Q.y);
    win.addChild(panel);
  }
  {
    const hit = (x: number, y: number, w: number, h: number, hint: Text, act: () => void) => {
      const g = new Graphics().rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0.001 });
      g.position.set(x, y);
      g.eventMode = "static";
      g.cursor = "pointer";
      g.on("pointerover", () => (status.value = hint));
      g.on("pointerout", () => (status.value = said("")));
      g.on("pointertap", () => {
        void playSound("button");
        act();
      });
      win.addChild(g);
    };
    const all = (kind: "army" | "artifact", from: 0 | 1 | "swap") => o.send({ type: "exchangeAll", heroes: ids(), kind, from });
    hit(Q.x, Q.y, 48, 32, tr("Move the whole army to the right (one of the weakest stays)"), () => all("army", 0));
    hit(Q.x + 50, Q.y, 48, 32, tr("Swap the armies"), () => all("army", "swap"));
    hit(Q.x + 100, Q.y, 48, 32, tr("Move the whole army to the left (one of the weakest stays)"), () => all("army", 1));
    hit(Q.x, Q.y + 36, 48, 32, tr("Move all artifacts to the right"), () => all("artifact", 0));
    hit(Q.x + 50, Q.y + 36, 48, 32, tr("Swap the artifacts"), () => all("artifact", "swap"));
    hit(Q.x + 100, Q.y + 36, 48, 32, tr("Move all artifacts to the left"), () => all("artifact", 1));
    // (Each stack's own arrow under it: TRADE3 draws them; TRADE2 has no room under its army row.)
    if (hd) for (const who of [0, 1] as const) {
      for (let slot = 0; slot < 7; slot++) {
        hit((who ? 485 : 67) + 36 * slot, 155, 20, 14, tr("Move this stack to the other hero"), () => {
          const pair = o.heroes();
          const st = pair[who].army[slot];
          if (!st) return;
          const other = (1 - who) as 0 | 1;
          const same = pair[other].army.findIndex((a) => a?.creature === st.creature);
          const to = same >= 0 ? same : pair[other].army.findIndex((a) => !a);
          if (to < 0) return;
          // The hero's last stack leaves one creature behind (a hero can't be left without an army).
          const last = pair[who].army.filter((a) => a).length === 1;
          const count = last ? st.count - 1 : st.count;
          if (count <= 0) return;
          o.send({ type: "transfer", heroes: ids(), kind: "army", from: { who, slot }, to: { who: other, slot: to }, count: count === st.count ? undefined : count });
        });
      }
    }
  }

  // Each backpack's arrows (VCMI's CArtifactsOfHeroMain in the exchange: HSBTNS3 / HSBTNS5 beside the five places).
  for (const who of [0, 1] as const) {
    const dx = who ? 98 : -334;
    const left = new DefButton("hsbtns3.def", 379 + dx, 364 + 151, player);
    const right = new DefButton("hsbtns5.def", 632 + dx, 364 + 151, player);
    left.onClick = () => ((bagScroll[who] -= 1), void draw());
    right.onClick = () => ((bagScroll[who] += 1), void draw());
    win.addChild(left, right);
    bagArrows[who] = [left, right];
  }
  // The quest log beside each portrait (VCMI: hsbtns4 at 10 / 740, 44; the quick layout's 8 and 39).
  if (o.quests) {
    for (const x of [hd ? 8 : 10, 740]) {
      const q = new DefButton("hsbtns4.def", x, hd ? 39 : 44, player);
      q.disabled = !o.quests.any();
      q.explain(modals, player, () => tr("No quests yet."));
      q.onClick = () => o.quests?.open();
      q.onHint = (h) => (status.value = h);
      win.addChild(q);
    }
  }
  await draw();
  const unlistenState = o.listen(() => (hand.check(), void draw()));
  // Leaving the window lets go of an artifact in hand (it stays where it was).
  const unlisten = () => (hand.drop(), unlistenState());
  return new Promise((resolve) => {
    let close = () => {};
    const quit = new DefButton("iokay.def", 732, 567);
    quit.onClick = () => (unlisten(), close(), resolve());
    win.addChild(quit);
    // Split on each side (VCMI's CExchangeWindow, TSBTNS): the picked stack into two, the new part
    // into its hero's first free place.
    for (const x of [10, 744]) {
      const split = new DefButton("tsbtns.def", x, hd ? 122 : 132, player, [0, 1, 2, 3]);
      split.onClick = async () => void ((await army.splitSelected()) || (status.value = tr("Pick a stack of two or more first.")));
      split.hint = tr("Split a stack: pick one, then this");
      split.onHint = (h) => (status.value = h);
      win.addChild(split);
    }
    // HD mod's keys (VCMI's exchangeArmySwap / exchangeArtifactsSwap): F10 swaps the armies, F11 the artifacts.
    const ids = () => [o.heroes()[0].id, o.heroes()[1].id] as [number, number];
    close = modals.show(win, {
      onKey: (k) => {
        if (k === "Escape" || k === "Enter") (unlisten(), close(), resolve());
        else if (army.quickKey(k)) void draw();
        else if (k === "F10") o.send({ type: "exchangeAll", heroes: ids(), kind: "army", from: "swap" });
        else if (k === "F11") o.send({ type: "exchangeAll", heroes: ids(), kind: "artifact", from: "swap" });
        return true;
      },
    });
  });
}

/**
 * The two heroes' artifacts and stacks as the exchange moves them (any layout): the artifact in hand goes to either
 * hero (ArtifactHand), a picked stack moves, swaps, merges or splits between them (ArmyClicks), a stack's window can
 * dismiss it while the hero keeps another.
 */
export function exchangeClicks(modals: Modals, player: number, o: ExchangeOptions, changed: () => void): { hand: ArtifactHand; army: ArmyClicks } {
  const ids = () => [o.heroes()[0].id, o.heroes()[1].id] as [number, number];
  const tref = (p: HandPlace): TransferRef => ({ who: p.who as 0 | 1, ...(p.slot !== undefined ? { slot: p.slot } : { backpack: p.backpack }) });
  const hand: ArtifactHand = new ArtifactHand({
    heroes: () => o.heroes(),
    artifacts: o.data.artifacts,
    move: (from, to) => o.send({ type: "transfer", heroes: ids(), kind: "artifact", from: tref(from), to: tref(to) }),
    catapult: async () => void messageBox(modals, (await gameTexts()).general[312] || fallback("The Catapult must be equipped."), player),
    changed,
  });
  const army: ArmyClicks = new ArmyClicks({
    armies: () => o.heroes().map((h) => h.army),
    move: (from, to, count) => o.send({ type: "transfer", heroes: ids(), kind: "army", from: { who: from.who as 0 | 1, slot: from.slot }, to: { who: to.who as 0 | 1, slot: to.slot }, count }),
    split: (creature, left, right, minLeft, quick) => splitWindow(modals, player, o.data.creatures[creature], left, right, minLeft, quick),
    details: (ref) => {
      const h = o.heroes()[ref.who];
      const a = h.army[ref.slot];
      const c = a && o.data.creatures[a.creature];
      if (!a || !c) return;
      void stackWindow(modals, player, c, {
        info: { count: a.count, ...stackSkills(h, c) },
        dismiss: h.army.filter((x) => x).length > 1 ? () => o.send({ type: "dismissStack", hero: h.id, slot: ref.slot }) : undefined,
      });
    },
    keepsOne: () => true,
  });
  return { hand, army };
}
