// The phone's trading panel, one block for every trade on a phone (2026-10-25: the resource cards, the one
// slider, no "give X for Y" sentence): the original window's own cards (TPMRKRES's sunken slots, TPMRKPTS's players'
// ones) four over three, bigger, in framed panels: what you have, what the other side gives for it, and the deal: the
// two picked cards with how much goes and comes, the shared slider with HotA's Min and Max, the handshake (TPMRKB),
// Done. Upright the panels one over the other; sideways yours and theirs in one column, the deal at the thumb's side
// (one-handed: that side). The town's marketplace (town/mobileMarket.ts) and the Freelancer's Guild use it.
import { Container, Sprite } from "pixi.js";
import { type FrameTexture, loadDef } from "../../assets.ts";
import { tr, type Text } from "../../i18n/index.ts";
import { WHITE } from "../../text.ts";
import { DefButton, label } from "../kit.ts";
import { type Modals } from "../modals.ts";
import { frameSprite, selectionFrame } from "../marketKit.ts";
import { oneHand, screenSize } from "../screen.ts";
import { TPMRKPTS, TPMRKRES, partTexture } from "./windowParts.ts";
import { FRAME_PAD as P, SPLIT, fitUpright, placeSideways, sidewaysScale, splitLine } from "./phoneWindow.ts";
import { Slider, minMax } from "./slider.ts";
import { block } from "./block.ts";

export const GAP = 12;
/** A resource card: TPMRKRES's slot (picture over a caption strip), its picture and caption's centre. */
export const CARD = { ...TPMRKRES.parts.card, image: [20, 9], caption: [36, 56] } as const;
/** A player's card: TPMRKPTS's (a flag's place over a strip). */
export const FLAG = TPMRKPTS.parts.flag;
/** Cards 83 apart across and 79 down, as the original's panels; four over three. */
export const STEP = { x: 83, y: 79 };
export const PANEL_W = 3 * STEP.x + CARD.w;

export interface CardKit {
  /** Resource r's card: the picture, the caption in the medium font on its strip, gold round it when picked. (-1: an empty card.) */
  card(r: number, caption: Text, picked: boolean, tap?: () => void): Container;
  /** A player's card: the flag over its strip, no name (the colour says who). */
  flag(color: number, picked: boolean, tap?: () => void): Container;
}

export async function cardKit(player: number): Promise<CardKit> {
  const [icons, crests, cardTex, flagTex] = await Promise.all([
    loadDef("resource.def").then((d) => d.get(0) ?? []),
    loadDef("crest58.def").then((d) => d.get(0) ?? []).catch(() => [] as FrameTexture[]),
    partTexture(TPMRKRES, "card", player),
    partTexture(TPMRKPTS, "flag", player),
  ]);
  const tappable = (c: Container, tap?: () => void) => {
    if (!tap) return c;
    c.eventMode = "static";
    c.cursor = "pointer";
    c.on("pointertap", tap);
    return c;
  };
  return {
    card(r, caption, picked, tap) {
      const c = new Container();
      if (cardTex) c.addChild(new Sprite(cardTex));
      const icon = frameSprite(icons[r], CARD.image[0], CARD.image[1]);
      if (icon) c.addChild(icon);
      if (caption) c.addChild(label(caption, "medfont", WHITE, "center", CARD.w - 4).centreOn(CARD.caption[0], CARD.caption[1]));
      if (picked) c.addChild(selectionFrame(CARD.w, CARD.h));
      return tappable(c, tap);
    },
    flag(color, picked, tap) {
      const c = new Container();
      if (flagTex) c.addChild(new Sprite(flagTex));
      const f = frameSprite(crests[color], 2, 2);
      if (f) c.addChild(f);
      if (picked) c.addChild(selectionFrame(FLAG.w, FLAG.h));
      return tappable(c, tap);
    },
  };
}

/** Where n things `w` wide go four over three (the second row centred), rows `h` high and STEP apart. */
export function rowPlaces(n: number, w: number, h: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const row = i < 4 ? 0 : 1;
    const inRow = row ? Math.min(3, n - 4) : Math.min(4, n);
    const left = Math.round((PANEL_W - ((inRow - 1) * STEP.x + w)) / 2);
    return [left + (i - row * 4) * STEP.x, row * (h + STEP.y - CARD.h)];
  });
}

/** Cards four over three. */
export function cardRows(cards: Container[], h: number): Container {
  const c = new Container();
  const at = rowPlaces(cards.length, CARD.w, h);
  cards.forEach((x, i) => {
    x.position.set(at[i][0], at[i][1]);
    c.addChild(x);
  });
  return c;
}

export interface DealOptions {
  player: number;
  modals?: Modals;
  /** The two cards: what goes and what comes for `lots` lots, and how wide the coming one is. */
  goes: (lots: number) => Container;
  comes: (lots: number) => Container;
  comesW?: number;
  /** How high the cards' row is. */
  topH?: number;
  /** Lots: the most there can be (0: nothing to trade), and how many now. */
  max: number;
  lots: number;
  onLots: (lots: number) => void;
  /** Both sides picked (else the slider rests and the handshake greys, saying why). */
  ready: boolean;
  trade: () => void;
  done: () => void;
  /** A button left of Done (the marketplace's giving to players and back). */
  extra?: DefButton;
}

/** The deal: the two cards with the handshake between, the slider, Min and Max, `extra` and Done. */
export async function dealPart(o: DealOptions): Promise<{ deal: Container; height: number }> {
  const deal = new Container();
  deal.label = "panel: deal";
  let lots = Math.max(0, Math.min(o.lots, o.max));
  const dealB = new DefButton("tpmrkb.def", 0, 0, o.player);
  const done = new DefButton("iok6432.def", 0, 0, o.player);
  const slider = new Slider(PANEL_W);
  const set = (v: number) => {
    lots = v;
    slider.set(v);
    o.onLots(v);
    showDeal();
  };
  const { less, most } = minMax(
    () => set(0),
    () => set(o.max),
  );
  await Promise.all([dealB.ready, done.ready, o.extra?.ready, slider.ready, less.ready, most.ready]);
  const topH = o.topH ?? CARD.h;
  dealB.position.set(Math.round((PANEL_W - dealB.width) / 2), Math.round((topH - dealB.height) / 2));
  dealB.label = "button: Trade";
  dealB.onClick = () => o.ready && lots > 0 && o.trade();
  if (o.modals) dealB.explain(o.modals, o.player, () => (o.ready ? tr("Move the slider to pick how many.") : tr("Pick what to trade first.")));
  // The two cards follow the slider without a redraw (the knob stays under the finger).
  const cards = new Container();
  const showDeal = () => {
    cards.removeChildren().forEach((c) => c.destroy({ children: true }));
    const comes = o.comes(lots);
    comes.position.set(PANEL_W - (o.comesW ?? CARD.w), 0);
    cards.addChild(o.goes(lots), comes);
    dealB.disabled = !o.ready || lots <= 0;
    less.disabled = lots <= 0;
    most.disabled = lots >= o.max;
  };
  deal.addChild(cards, dealB);
  let y = topH + GAP;
  slider.position.set(0, y);
  slider.range(o.max, lots);
  slider.block(!o.ready);
  slider.onChange = (v) => ((lots = v), o.onLots(v), showDeal());
  deal.addChild(slider);
  y += 16 + GAP;
  less.position.set(0, y);
  most.position.set(less.width + 6, y);
  deal.addChild(less, most);
  showDeal();
  done.position.set(PANEL_W - done.width, y);
  done.onClick = o.done;
  deal.addChild(done);
  if (o.extra) {
    o.extra.position.set(done.x - 8 - o.extra.width, y);
    deal.addChild(o.extra);
  }
  return { deal, height: y + Math.max(less.height, done.height) };
}

/** Sideways: whether three columns show the parts bigger than two (yours over theirs, the deal beside). */
function threeWide(yh: number, th: number, dealH: number): boolean {
  const two = sidewaysScale(2 * PANEL_W + 4 * P + GAP, Math.max(yh + GAP + th, dealH) + 2 * P, P);
  const three = sidewaysScale(3 * PANEL_W + 6 * P + 2 * GAP, Math.max(yh, th, dealH) + 2 * P, P);
  return three > two * 1.05;
}

/** The three parts framed and fitted on the page, upright one over the other, sideways in two columns or three (whichever is bigger). */
export async function tradeLayout(name: string, player: number, yours: Container, theirs: Container, deal: Container, dealH: number): Promise<Container> {
  const root = new Container();
  root.label = name;
  const yh = yours.height;
  const th = theirs.height;
  if (screenSize.portrait) {
    let y0 = P;
    for (const [part, h] of [[yours, yh], [theirs, th], [deal, dealH]] as const) {
      if (y0 > P) splitLine(root, P, y0 - SPLIT, PANEL_W);
      part.position.set(P, y0);
      root.addChild(part);
      y0 += h + SPLIT;
    }
    fitUpright(root, PANEL_W + 2 * P, y0 - SPLIT + P);
  } else if (threeWide(yh, th, dealH)) {
    // Sideways and the parts tall (the Altar): three columns, the deal at the thumb's side.
    const h = Math.max(yh, th, dealH);
    const order = oneHand() === "left" ? [deal, yours, theirs] : [yours, theirs, deal];
    let x = P;
    for (const part of order) {
      if (x > P) splitLine(root, x - SPLIT, P, h, true);
      part.position.set(x, P + (part === deal ? h - dealH : 0));
      root.addChild(part);
      x += PANEL_W + SPLIT;
    }
    const dw = x - SPLIT + P;
    const dh = h + 2 * P;
    placeSideways(root, dw, dh, sidewaysScale(dw, dh, P), P);
  } else {
    const thumbLeft = oneHand() === "left";
    const colH = yh + GAP + th;
    const h = Math.max(colH, dealH);
    const cx = thumbLeft ? P + PANEL_W + SPLIT : P;
    const dx = thumbLeft ? P : P + PANEL_W + SPLIT;
    yours.position.set(cx, P);
    theirs.position.set(cx, P + yh + GAP);
    deal.position.set(dx, P + h - dealH);
    root.addChild(yours, theirs, deal);
    splitLine(root, P + PANEL_W, P, h, true);
    const dw = 2 * PANEL_W + 2 * P + SPLIT;
    const dh = h + 2 * P;
    placeSideways(root, dw, dh, sidewaysScale(dw, dh, P), P);
  }
  (root as Container & { handGrid?: boolean }).handGrid = true;
  return block(root, "trade");
}
