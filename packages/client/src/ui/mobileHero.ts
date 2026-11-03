// The hero screen on a phone (2026-10-25 brain dump: "so much different than desktop... these stupid tabs... we
// can fit everything in here"): one view, no tabs. The desktop's own blocks (ui/blocks/heroBlocks.ts) in one window in
// the player's colour, only laid out and scaled to fit (2026-10-27: "reuse all building blocks ... same styles,
// borders ... we can afford consistent feel"): the head and the skills section exactly as the desktop's left half (the
// names and values in medfont), the paper doll with the backpack, the army's seven places with the usual taps (a long
// press: the stack's window, Dismiss and Upgrade there), the original's buttons (formation, Tactics, Split, Quest Log,
// Dismiss, OK) and the player's other heroes.
// Upright: the head and skills, the doll with the heroes beside it, the army and its buttons, top to bottom.
// Sideways: three columns, the army and its buttons at the thumb's side (one-handed: that side; else the right).
import { FRAME_PAD as P, HERO_CELL, SPLIT, fitUpright, heroCell, phoneRoom, placeSideways, playerFlag, sidewaysScale, splitLine } from "./blocks/phoneWindow.ts";
import { heroPortraitHold } from "./heroPortraitHold.ts";
import type { Hero } from "@heroes/core";
import { SKILLS } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { heroPortrait } from "../assets.ts";
import { DefButton } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { ArtifactHand, type HandPlace } from "./artifactHand.ts";
import { setPopupPlayer } from "./creatureInfo.ts";
import { type HeroScreenOptions, comboOffers, confirmDismiss, heroArmyClicks } from "./heroScreen.ts";
import { BOXES, DOLL, HEAD, SKILLS_PART, heroArmy, heroDoll, heroHead, heroSkills } from "./blocks/heroBlocks.ts";
import { StackGrid } from "./blocks/stackGrid.ts";
import { openPage } from "./mobilePage.ts";
import { oneHand, screenSize } from "./screen.ts";

const GAP = 6;
/** The skills section under the head, as far down as on the desktop's screen. */
const SKILLS_AT = SKILLS_PART.y - BOXES.portrait.y;
/** The head and the skills section under it: the desktop's left half. */
const SHEET = { w: Math.max(HEAD.w, SKILLS_PART.w), h: SKILLS_AT + SKILLS_PART.h };
/** The head this far right of the skills section's edge (the desktop's boxes start inside it). */
const HEAD_IN = BOXES.portrait.x - SKILLS_PART.x;
/** The player's other heroes: small portraits (48 x 32) this far apart. */
const LIST_STEP = HERO_CELL.h + 2;

export async function mobileHeroScreen(modals: Modals, player: number, o: HeroScreenOptions): Promise<void> {
  setPopupPlayer(player);
  let unlisten = () => {};
  // One window over the map (2026-10-26 21:11 and 22:12: "a windowed dialog, not a full screen view"), upright
  // and sideways (three columns there, gold lines between them).
  const shell = await openPage(modals, { bare: true, onClose: () => unlisten(), draw: () => redraw() });
  const done = () => shell.close();
  let current = o.hero().id;
  const hero = (): Hero => o.heroes?.().find((x) => x.id === current) ?? o.hero();
  const army = heroArmyClicks(modals, player, o, hero);
  const offerCombos = comboOffers(modals, player, o, hero);
  let bagScroll = 0;
  const place = (p: HandPlace) => (p.slot !== undefined ? { slot: p.slot } : { backpack: p.backpack });
  const hand = new ArtifactHand({
    heroes: () => [hero()],
    artifacts: o.data.artifacts,
    move: (from, to) => o.send({ type: "equip", hero: hero().id, from: place(from), to: place(to) }),
    spellbook: () => o.spellbook?.(hero()),
    changed: () => redraw(),
  });

  /** The original's buttons, at their own size. `order`: frames when pressed in (a setting that is on). */
  const button = async (def: string, fn: () => void, order?: number[], disabled = false) => {
    const b = new DefButton(def, 0, 0, player, order);
    await b.ready;
    b.disabled = disabled;
    b.onClick = () => void fn();
    return b;
  };
  /** Formation (tight / loose), Tactics, Split: the army's own buttons. */
  const armyButtons = async (h: Hero) => {
    const made = [
      await button("hsbtns6.def", () => o.send({ type: "heroSettings", hero: h.id, tight: true }), h.tight ? [1, 1, 2, 3] : undefined),
      await button("hsbtns7.def", () => o.send({ type: "heroSettings", hero: h.id, tight: false }), !h.tight ? [1, 1, 2, 3] : undefined),
    ];
    if ((h.skills ?? []).some(([id]) => id === SKILLS.indexOf("tactics"))) made.push(await button("hsbtns8.def", () => o.send({ type: "heroSettings", hero: h.id, tactics: !!h.noTactics }), h.noTactics ? undefined : [1, 1, 2, 3]));
    made.push(await button("hsbtns9.def", async () => void (await army.splitSelected())));
    return made;
  };
  /** Quest Log and Dismiss (greyed where the hero can't be dismissed: the last one without a town, at sea). */
  const heroButtons = async (h: Hero) => {
    const made: DefButton[] = [];
    if (o.questLog) made.push(await button("hsbtns4.def", () => o.questLog?.()));
    made.push(
      await button(
        "hsbtns2.def",
        async () => {
          if (!(await confirmDismiss(modals, player, h))) return;
          o.send({ type: "dismiss", hero: h.id });
          done();
        },
        undefined,
        o.canDismiss ? !o.canDismiss(h) : false,
      ).then((b) => b.explain(modals, player, () => o.dismissWhy?.(h))),
    );
    return made;
  };
  /** In a row from x, y, `w` wide, wrapping; answers the height taken. */
  const flow = (parent: Container, items: Container[], x: number, y: number, w: number) => {
    let cx = 0;
    let cy = 0;
    let row = 0;
    for (const b of items) {
      if (cx > 0 && cx + b.width > w) ((cx = 0), (cy += row + GAP), (row = 0));
      b.position.set(x + cx, y + cy);
      parent.addChild(b);
      cx += b.width + GAP;
      row = Math.max(row, b.height);
    }
    return cy + row;
  };
  /** The player's heroes, a tap shows that one (the original's column down the right). */
  const heroList = async (across: boolean, room: number) => {
    const c = new Container();
    c.label = "hero: list";
    const all = (o.heroes?.() ?? []).slice(0, Math.max(1, Math.floor((room + LIST_STEP - HERO_CELL.h) / LIST_STEP)));
    for (const [i, other] of all.entries()) {
      // Each in the hero screen's bordered slot on the player's colour.
      const cell = await heroCell(player);
      const [cx, cy] = [across ? i * (HERO_CELL.w + 2) : 0, across ? 0 : i * LIST_STEP];
      if (cell) c.addChild(Object.assign(cell, { x: cx, y: cy }));
      const pic = new Sprite(await heroPortrait(other, "small"));
      pic.position.set(cx + HERO_CELL.inset, cy + HERO_CELL.inset);
      pic.eventMode = "static";
      pic.cursor = "pointer";
      pic.label = `hero: ${other.name}`;
      const show = () => {
        if (other.id === current) return;
        current = other.id;
        hand.drop();
        army.selected = null;
        bagScroll = 0;
        redraw();
      };
      pic.on("pointertap", (e) => e.button !== 2 && show());
      heroPortraitHold(pic, show);
      c.addChild(pic);
      if (other.id === current) c.addChild(new Graphics().rect(pic.x - 1, pic.y - 1, 50, 34).stroke({ color: 0xffff00, width: 2 }));
    }
    return c;
  };

  const draw = async () => {
    const h = hero();
    const ml = o.moraleLuck(h);
    const [head, stats, doll, ok] = await Promise.all([
      heroHead(modals, player, h),
      // The desktop's skills section as it is (2026-10-27): the names, the values, the boxes; medfont on a phone.
      heroSkills(modals, player, h, ml, { font: "medfont" }),
      heroDoll(modals, player, h, {
        data: o.data,
        hand,
        bagScroll: () => bagScroll,
        setBagScroll: (n) => (bagScroll = n),
        disassemble: (slot) => o.send({ type: "disassemble", hero: h.id, slot }),
        redraw: () => redraw(),
      }),
      button("hsbtns.def", () => done()),
    ]);
    const root = new Container();
    root.label = "window: hero";
    const upright = screenSize.portrait;
    // The page's own buttons (☰, Feedback) along the top: the frames start under them.
    const { H, top } = phoneRoom();
    const changed = () => redraw();
    let dw: number;
    let dh: number;
    if (upright) {
      // Each frame as wide as the army's seven places.
      const iw = 7 * (StackGrid.cellSize({ size: "large" }).w + 4) - 4;
      const grid = await heroArmy(h, o.data, army, 7, changed);
      // One window: the head and the skills section (the desktop's left half), the doll with the heroes, the army; a gold
      // line between them.
      let y = P;
      root.addChild(Object.assign(head, { x: P + HEAD_IN, y }));
      root.addChild(Object.assign(stats, { x: P, y: y + SKILLS_AT }));
      // Quest Log and Dismiss by the portrait and the tagline, away from the army's buttons (2026-10-26: Dismiss
      // in the stacks' busy area is a danger zone; it asks first all the same).
      const side = new Container();
      flow(side, await heroButtons(h), 0, 0, iw - HEAD.w);
      side.position.set(P + iw - side.width, y + Math.round((HEAD.h - side.height) / 2));
      root.addChild(side);
      const lines = new Graphics();
      const divide = (at: number) => lines.rect(P, at, iw, 2).fill({ color: 0xc8a046, alpha: 0.9 });
      // The doll, the heroes beside it.
      y += SHEET.h + GAP;
      divide(y);
      y += 2 + GAP;
      root.addChild(Object.assign(doll, { x: P, y }));
      const flag = await playerFlag(player);
      const fx = P + DOLL.w + Math.round((iw - DOLL.w - HERO_CELL.w) / 2);
      let fh = 0;
      if (flag) {
        flag.scale.set(HERO_CELL.w / flag.width);
        flag.position.set(fx, y);
        root.addChild(flag);
        fh = flag.height + GAP;
      }
      const list = await heroList(false, DOLL.h - fh);
      list.position.set(fx, y + fh);
      root.addChild(list);
      // The army, its buttons and OK under it.
      y += DOLL.h + GAP;
      divide(y);
      y += 2 + GAP;
      const buttons = await armyButtons(h);
      const bh = Math.max(...buttons.map((b) => b.height), ok.height);
      root.addChild(Object.assign(grid, { x: P, y }));
      flow(root, buttons, P, y + grid.height + GAP, iw - ok.width - 12);
      ok.position.set(P + iw - ok.width, y + grid.height + GAP);
      root.addChild(ok);
      dw = iw + 2 * P;
      dh = y + grid.height + GAP + bh + P;
      root.addChildAt(lines, 0);
      // (The window's leather and rim round it: openPage.) As big as the screen allows under the page's buttons.
      fitUpright(root, dw, dh);
    } else {
      // Three columns: the head and skills (the desktop's left half), the doll (the heroes, Quest Log and Dismiss under
      // it), the army (four and three, for the thumb).
      const grid = await heroArmy(h, o.data, army, 4, changed);
      const aw = grid.width;
      const buttons = await armyButtons(h);
      const thumbLeft = oneHand() === "left";
      const cols = thumbLeft ? (["army", "doll", "stats"] as const) : (["stats", "doll", "army"] as const);
      const widths = { stats: SHEET.w, doll: DOLL.w, army: aw };
      const ih = SHEET.h;
      dh = ih + 2 * P;
      dw = cols.reduce((s, c) => s + widths[c] + SPLIT, 0) - SPLIT + 2 * P;
      // Clear of the navigation bar at the right (Android's, sideways). Held in both hands, the page's buttons sit over
      // both outer columns: the head and skills (the whole height) start under them, only the frame's rim above.
      const pad = oneHand() ? 0 : P;
      const k = sidewaysScale(dw, dh, pad);
      const y0 = pad ? Math.max((H - dh * k) / 2, top - pad * k) : (H - dh * k) / 2;
      // The army's column starts under the page's buttons when there's room for it.
      const below = (h2: number) => Math.min(Math.max(0, (top - y0) / k), dh - h2 - 2 * P);
      let x = P;
      for (const col of cols) {
        if (col === "stats") {
          root.addChild(Object.assign(head, { x: x + HEAD_IN, y: P }), Object.assign(stats, { x, y: P + SKILLS_AT }));
        } else if (col === "doll") {
          root.addChild(Object.assign(doll, { x, y: P }));
          // Under the doll: the flag and the heroes, Quest Log and Dismiss at the row's end (away from the army's buttons:
          // The owner, 2026-10-26, Dismiss in the stacks' busy area is a danger zone).
          const side = new Container();
          flow(side, await heroButtons(h), 0, 0, DOLL.w);
          const rowY = P + DOLL.h + Math.max(0, Math.round((ih - DOLL.h - Math.max(HERO_CELL.h, side.height)) / 2));
          side.position.set(x + DOLL.w - side.width, rowY);
          root.addChild(side);
          const flag = await playerFlag(player);
          let fw = 0;
          if (flag) {
            flag.scale.set(HERO_CELL.h / flag.height);
            flag.position.set(x, rowY);
            root.addChild(flag);
            fw = flag.width + GAP;
          }
          const list = await heroList(true, DOLL.w - fw - side.width - GAP);
          list.position.set(x + fw, rowY);
          root.addChild(list);
        } else {
          const tmp = new Container();
          const bH = flow(tmp, buttons, 0, 0, aw);
          tmp.destroy({ children: false });
          const armyH = grid.height + GAP + bH + GAP + ok.height;
          const y = P + below(armyH);
          root.addChild(Object.assign(grid, { x, y }));
          flow(root, buttons, x, y + grid.height + GAP, aw);
          // OK at the foot, at the thumb's side.
          ok.position.set(thumbLeft ? x : x + aw - ok.width, P + ih - ok.height);
          root.addChild(ok);
        }
        x += widths[col] + SPLIT;
        if (col !== cols[2]) splitLine(root, x - SPLIT, P, ih, true);
      }
      placeSideways(root, dw, dh, k, pad);
    }
    // One-handed: the pieces stay where they are (touchcheck's handGrid).
    (root as Container & { handGrid?: boolean }).handGrid = true;
    shell.setContent(root);
  };
  // One drawing at a time, the latest state each time.
  let drawing = Promise.resolve();
  const redraw = () => void (drawing = drawing.then(draw).catch((e) => console.error("hero screen", e)));

  await draw();
  void offerCombos();
  const stop = o.listen(() => {
    hand.check();
    redraw();
    void offerCombos();
  });
  unlisten = () => (hand.drop(), stop());
  return shell.show();
}
