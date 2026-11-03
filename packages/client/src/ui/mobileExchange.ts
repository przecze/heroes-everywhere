// Two heroes meeting, on a phone (2026-10-25: no word tabs, no names twice, no paragraph on how stacks move,
// both heroes' artifacts and armies in reach at once): the hero blocks of the hero screen (ui/blocks/heroBlocks.ts)
// for both. Each hero's head (a tap on the portrait: that hero's screen) and army, HD mod's quick buttons between
// the armies (all to one side, swap; its TRADE3 art) with Split, the two paper dolls side by side, OK.
// Upright top to bottom; sideways the armies at the thumb's side (one-handed: that side; else the right), the dolls
// beside them.
import { FRAME_PAD as P, SPLIT, fitUpright, placeSideways, sidewaysScale, splitLine } from "./blocks/phoneWindow.ts";
import { Container, Graphics, Sprite } from "pixi.js";
import { heroPortrait } from "../assets.ts";
import { DefButton } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { setPopupPlayer } from "./creatureInfo.ts";
import { type ExchangeOptions, exchangeClicks } from "./exchange.ts";
import { DOLL, HEAD, heroArmy, heroDoll, heroHead } from "./blocks/heroBlocks.ts";
import { EX_HEAD, HERO_PRIMARIES, armyQuickUpright, exchangeHead, exchangePrimaries, exchangeSkills, hasExchangeParts, heroPrimaries } from "./blocks/exchangeBlocks.ts";
import { TRADE3, part } from "./blocks/windowParts.ts";
import { quickPanel } from "./drawnButtons.ts";
import { StackGrid } from "./blocks/stackGrid.ts";
import { openPage } from "./mobilePage.ts";
import { oneHand, screenSize } from "./screen.ts";
import { playSound } from "../audio.ts";
import { tr } from "../i18n/index.ts";

const GAP = 6;
/** The paper dolls drawn this much smaller, two side by side. */
const DK = 0.74;

export async function mobileExchange(modals: Modals, player: number, o: ExchangeOptions): Promise<void> {
  setPopupPlayer(player);
  let unlisten = () => {};
  const shell = await openPage(modals, { bare: true, draw: () => redraw(), onClose: () => unlisten() });
  const done = () => shell.close();
  const ids = () => [o.heroes()[0].id, o.heroes()[1].id] as [number, number];
  const { hand, army } = exchangeClicks(modals, player, o, () => redraw());
  const bagScroll = [0, 0];
  // (Without HotA's files, TRADE3 isn't there: our own drawn buttons in its places, drawnButtons' quickPanel.)
  const drawn = async (rows: ("army" | "artifact")[], upright = false) => Object.assign(new Sprite(await quickPanel(rows, upright)), { label: "picture: quick buttons (drawn)" });
  const quickArt = (await part(TRADE3, "quick", player)) ?? (await drawn(["army", "artifact"]));
  // Upright, the two rows apart: the armies' with its arrows turned, the artifacts' as it is (its lower half).
  const armyUpright = (await armyQuickUpright(player)) ?? (await drawn(["army"], true));
  const artRow = (await part(TRADE3, "quickArtifacts", player)) ?? (await drawn(["artifact"]));
  // The exchange's own head, skills and primary skills (TRADE3's parts); without the HD mod's picture, the hero screen's head.
  const own = await hasExchangeParts(player);

  /**
   * HD mod's quick buttons (TRADE3's art): `rows` the armies' row over the artifacts' (sideways), or one of them
   * (upright: the armies' between the armies, its arrows down and up, the artifacts' over the dolls).
   */
  const quick = (rows: ("army" | "artifact")[] = ["army", "artifact"]) => {
    const c = new Container();
    c.label = "panel: quick exchange";
    const art = rows.length === 1 && rows[0] === "army" ? armyUpright : rows.length === 1 ? artRow : quickArt;
    c.addChild(art);
    const all = (kind: "army" | "artifact", from: 0 | 1 | "swap") => o.send({ type: "exchangeAll", heroes: ids(), kind, from });
    const what: Record<"army" | "artifact", [0 | 1 | "swap", string][]> = {
      army: [[0, "Move the whole army to the right (one of the weakest stays)"], ["swap", "Swap the armies"], [1, "Move the whole army to the left (one of the weakest stays)"]],
      artifact: [[0, "Move all artifacts to the right"], ["swap", "Swap the artifacts"], [1, "Move all artifacts to the left"]],
    };
    rows.forEach((kind, r) =>
      what[kind].forEach(([from, text], i) => {
        const g = new Graphics().rect(0, 0, 48, 32).fill({ color: 0, alpha: 0.001 });
        g.position.set(50 * i, 36 * r);
        g.eventMode = "static";
        g.cursor = "pointer";
        g.label = `button: ${tr(text)}`;
        g.on("pointertap", () => {
          void playSound("button");
          all(kind, from);
        });
        c.addChild(g);
      }),
    );
    return c;
  };

  const draw = async () => {
    const pair = o.heroes();
    const open = (i: number) => (o.openHero && !hand.held ? () => o.openHero?.(pair[i].id) : undefined);
    const iw = 7 * (StackGrid.cellSize({ size: "large" }).w + 4) - 4;
    const upright = screenSize.portrait;
    const [heads, grids, dolls, skills, primaries, ownPrimaries] = await Promise.all([
      // (Both heads the first's way round, the portrait at the right: one above the other, the desktop's facing halves
      // only asked "is the upper hero left or right?", the owner 2026-10-27 22:22.)
      Promise.all(([0, 1] as const).map((i) => (own ? exchangeHead(modals, player, pair[i], 0, o.moraleLuck(pair[i]), open(i)) : heroHead(modals, player, pair[i], iw, open(i))))),
      Promise.all([0, 1].map((i) => heroArmy(pair[i], o.data, army, 7, () => redraw(), i))),
      Promise.all(
        [0, 1].map((i) =>
          heroDoll(modals, player, pair[i], {
            data: o.data,
            hand,
            who: i,
            bagScroll: () => bagScroll[i],
            setBagScroll: (n) => (bagScroll[i] = n),
            disassemble: (slot) => o.send({ type: "disassemble", hero: pair[i].id, slot }),
            redraw: () => redraw(),
          }),
        ),
      ),
      // (Upright the skills in one row under their hero's head, sideways four to a row under its doll.)
      own ? Promise.all([0, 1].map((i) => exchangeSkills(modals, player, pair[i], upright ? 8 : 4))) : null,
      own && !upright ? exchangePrimaries(modals, player, [pair[0], pair[1]]) : null,
      own && upright ? Promise.all([0, 1].map((i) => heroPrimaries(modals, player, pair[i]))) : null,
    ]);
    const headH = own ? EX_HEAD.h : HEAD.h;
    // (Each hero's small portrait in a gold rim, tapped for its hero's screen as the heads.)
    const smallHeads = await Promise.all(
      [0, 1].map(async (i) => {
        const c = new Container();
        c.label = `portrait: ${pair[i].name}`;
        const pic = new Sprite(await heroPortrait(pair[i], "small"));
        pic.position.set(1, 1);
        c.addChild(new Graphics().rect(0, 0, pic.width + 2, pic.height + 2).fill(0xe0c068), pic);
        const go = open(i);
        if (go) {
          c.eventMode = "static";
          c.cursor = "pointer";
          c.on("pointertap", go);
        }
        return c;
      }),
    );
    const dollsW = 2 * Math.round(DOLL.w * DK) + 2 * GAP;
    const split = new DefButton("hsbtns9.def", 0, 0, player);
    const ok = new DefButton("hsbtns.def", 0, 0, player);
    await Promise.all([split.ready, ok.ready]);
    split.onClick = async () => void (await army.splitSelected());
    ok.onClick = () => done();
    const root = new Container();
    root.label = "window: exchange";
    let dw: number;
    let dh: number;
    if (upright) {
      // Upright, top to bottom (2026-10-29 00:11: "from top: who are the two heroes, stacks exchange,
      // artifacts exchange"; and 2026-11-03 10:13: each hero next to its own army, "so it's clear that bottom stack row
      // is hero two, top stack row is hero one"): the first hero's head with its primary skills beside it and its
      // skills under it, its army; the quick buttons (their arrows down and up) and Split; the second hero's army, then
      // its head and skills; the artifacts' quick buttons over the two dolls side by side; OK.
      const w = Math.max(iw, dollsW, own ? EX_HEAD.w + 4 + HERO_PRIMARIES.w : 0);
      let y = P;
      const heroBlock = (i: number) => {
        root.addChild(Object.assign(heads[i], { x: P, y }));
        const pr = ownPrimaries?.[i];
        if (pr) root.addChild(Object.assign(pr, { x: P + w - HERO_PRIMARIES.w, y }));
        y += Math.max(headH, pr ? HERO_PRIMARIES.h : 0) + 3;
        const k = skills?.[i];
        if (k) root.addChild(Object.assign(k, { x: P, y })), (y += k.height);
      };
      const ax = P + Math.round((w - iw) / 2);
      heroBlock(0);
      y += GAP;
      root.addChild(Object.assign(grids[0], { x: ax, y }));
      y += grids[0].height + GAP;
      const moves = quick(["army"]);
      const bandH = Math.max(moves.height, split.height);
      moves.position.set(P + Math.round((w - moves.width) / 2), y + Math.round((bandH - moves.height) / 2));
      split.position.set(P + w - split.width, y + Math.round((bandH - split.height) / 2));
      root.addChild(moves, split);
      y += bandH + GAP;
      root.addChild(Object.assign(grids[1], { x: ax, y }));
      y += grids[1].height + GAP;
      heroBlock(1);
      splitLine(root, P, y, w);
      y += SPLIT;
      const arts = quick(["artifact"]);
      const dollX = (i: number) => P + Math.round((w - dollsW) / 2) + i * (Math.round(DOLL.w * DK) + 2 * GAP);
      // Whose doll is whose: each hero's small portrait over its doll, at its outer edge, beside the artifacts' quick
      // buttons (2026-11-01 12:38: "unclear who's left and right"; the heads are one above the other).
      const rowH = Math.max(arts.height, smallHeads[0].height);
      smallHeads.forEach((p, i) => {
        p.position.set(i ? dollX(1) + Math.round(DOLL.w * DK) - p.width : dollX(0), y + Math.round((rowH - p.height) / 2));
        root.addChild(p);
      });
      if (arts.height) {
        arts.position.set(P + Math.round((w - arts.width) / 2), y + Math.round((rowH - arts.height) / 2));
        root.addChild(arts);
      }
      y += rowH + GAP;
      dolls.forEach((d, i) => {
        d.scale.set(DK);
        root.addChild(Object.assign(d, { x: dollX(i), y }));
      });
      y += Math.round(DOLL.h * DK) + GAP;
      ok.position.set(P + w - ok.width, y);
      root.addChild(ok);
      dw = w + 2 * P;
      dh = y + ok.height + P;
      fitUpright(root, dw, dh);
    } else {
      const middle = quick();
      // The armies' panel: the first hero's head and army, the quick buttons and Split, the second's army and head.
      const armies = new Container();
      let y = 0;
      armies.addChild(Object.assign(heads[0], { y }));
      y += headH + GAP;
      armies.addChild(Object.assign(grids[0], { y }));
      y += grids[0].height + GAP + 2;
      // (With the primary skills' column: it at the left, the quick buttons beside it.)
      const bandH = Math.max(middle.height, split.height, primaries?.height ?? 0);
      if (primaries) armies.addChild(Object.assign(primaries, { x: 0, y: y + Math.round((bandH - primaries.height) / 2) }));
      const mx = primaries ? primaries.width + Math.round((iw - primaries.width - split.width - middle.width) / 2) : Math.round((iw - middle.width) / 2);
      middle.position.set(mx, y + Math.round((bandH - middle.height) / 2));
      split.position.set(iw - split.width, y + Math.round((bandH - split.height) / 2));
      armies.addChild(middle, split);
      y += bandH + GAP + 2;
      armies.addChild(Object.assign(grids[1], { y }));
      y += grids[1].height + GAP;
      armies.addChild(Object.assign(heads[1], { y }));
      y += headH;
      const armiesH = y;
      // The dolls side by side, each with its hero's skills under it (the exchange's boxes, four to a row).
      const pairOf = new Container();
      const skillsH = skills ? Math.max(...skills.map((k) => k.height)) + GAP : 0;
      // (Over each doll its hero's small portrait, at its outer edge: whose doll is whose.)
      const topH = smallHeads[0].height + GAP;
      dolls.forEach((d, i) => {
        d.scale.set(DK);
        const x = i * (Math.round(DOLL.w * DK) + 2 * GAP);
        d.position.set(x, topH);
        pairOf.addChild(d);
        const p = smallHeads[i];
        pairOf.addChild(Object.assign(p, { x: i ? x + Math.round(DOLL.w * DK) - p.width : x, y: 0 }));
        const k = skills?.[i];
        if (k) pairOf.addChild(Object.assign(k, { x: x + Math.round((DOLL.w * DK - k.width) / 2), y: topH + Math.round(DOLL.h * DK) + GAP }));
      });
      const dollsH = topH + Math.round(DOLL.h * DK) + skillsH;
      const thumbLeft = oneHand() === "left";
      const aH = armiesH + GAP + ok.height;
      dh = Math.max(aH, dollsH) + 2 * P;
      dw = iw + dollsW + 2 * P + SPLIT;
      // (The frames' ornament may run under the page's buttons, what is inside them not.)
      const k = sidewaysScale(dw, dh, P);
      const ax = thumbLeft ? P : P + dollsW + SPLIT;
      const dx = thumbLeft ? P + iw + SPLIT : P;
      const ay = P;
      splitLine(root, (thumbLeft ? ax + iw : dx + dollsW), P, dh - 2 * P, true);
      root.addChild(Object.assign(armies, { x: ax, y: ay }));
      ok.position.set(thumbLeft ? ax : ax + iw - ok.width, ay + aH - ok.height);
      root.addChild(ok);
      root.addChild(Object.assign(pairOf, { x: dx, y: P + Math.round((dh - 2 * P - dollsH) / 2) }));
      placeSideways(root, dw, dh, k, P);
    }
    (root as Container & { handGrid?: boolean }).handGrid = true;
    shell.setContent(root);
  };
  let drawing = Promise.resolve();
  const redraw = () => void (drawing = drawing.then(draw).catch((e) => console.error("exchange", e)));

  await draw();
  const stop = o.listen(() => {
    hand.check();
    redraw();
  });
  unlisten = () => (hand.drop(), stop());
  return shell.show();
}
