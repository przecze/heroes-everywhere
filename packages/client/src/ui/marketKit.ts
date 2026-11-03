// The pieces the original market windows share (VCMI's client/widgets/markets: TradePanels, CMarketBase,
// CMarketSlider; client/widgets/Slider.cpp): the 3 x 3 panels of trade slots, the showcase slot under
// a panel, and texts centred on a point as VCMI's CLabel / CTextBox place them.
import { Container, Graphics, Sprite } from "pixi.js";
import type { FrameTexture } from "../assets.ts";
import type { FontName, GameText } from "../text.ts";
import { WHITE } from "../text.ts";
import { gameLines, englishLine } from "./gameText.ts";
import { label } from "./kit.ts";
import { type Text, said } from "../i18n/index.ts";

type Rgb = readonly [number, number, number];

/** Text centred on (cx, cy), as VCMI's CENTER-aligned CLabel; `width` wraps it (a CTextBox's width). */
export function centredText(text: Text, font: FontName, color: Rgb, cx: number, cy: number, width?: number): GameText {
  return label(text, font, color, "center", width).centreOn(cx, cy);
}

/** A DEF frame drawn where VCMI's CAnimImage puts it: its canvas at (x, y), the frame at its offset in it. */
export function frameSprite(f: FrameTexture | undefined, x: number, y: number): Sprite | null {
  return f ? Object.assign(new Sprite(f.texture), { x: x + f.x, y: y + f.y }) : null;
}

/** Places of the slots of a resources panel (VCMI's ResourcesPanel): 3 x 3, 83 across and 79 down. */
export const RESOURCE_SLOTS: [number, number][] = [[0, 0], [83, 0], [166, 0], [0, 79], [83, 79], [166, 79], [0, 158], [83, 158], [166, 158]];
/** A resource slot's size, and where its picture and its caption's centre sit in it. */
export const RESOURCE_SLOT = { w: 69, h: 66, image: [19, 8], caption: [35, 55] } as const;
/** The showcase slot under a resources panel (the resource and amount picked). */
export const RESOURCE_SHOWCASE: [number, number] = [83, 267];

/** The slot a resource goes in: seven resources put gold in the middle of the bottom row, as VCMI. */
export const resourceSlot = (r: number): [number, number] => RESOURCE_SLOTS[r === 6 ? 7 : r];

/** The yellow frame round a picked slot (VCMI's SelectableSlot, 2 px). */
export function selectionFrame(w: number, h: number): Graphics {
  return new Graphics().rect(1, 1, w - 2, h - 2).stroke({ color: 0xffff00, width: 2 });
}

export interface ResourcePanelOptions {
  /** RESOURCE.DEF's frames. */
  icons: FrameTexture[];
  caption: (r: number) => Text;
  selected: number;
  pick: (r: number) => void;
}

/** A resources panel at (x, y): the seven resources in their slots, captions under, the picked one framed. */
export function resourcePanel(x: number, y: number, o: ResourcePanelOptions): Container {
  const panel = new Container();
  panel.position.set(x, y);
  for (let r = 0; r < 7; r++) {
    const [sx, sy] = resourceSlot(r);
    const slot = new Container();
    slot.position.set(sx, sy);
    // The whole slot takes the click (VCMI's CTradeableItem is the slot's rectangle).
    slot.addChild(new Graphics().rect(0, 0, RESOURCE_SLOT.w, RESOURCE_SLOT.h).fill({ color: 0, alpha: 0.001 }));
    const icon = frameSprite(o.icons[r], RESOURCE_SLOT.image[0], RESOURCE_SLOT.image[1]);
    if (icon) slot.addChild(icon);
    const caption = o.caption(r);
    if (caption) slot.addChild(centredText(caption, "smalfont", WHITE, RESOURCE_SLOT.caption[0], RESOURCE_SLOT.caption[1]));
    if (o.selected === r) slot.addChild(selectionFrame(RESOURCE_SLOT.w, RESOURCE_SLOT.h));
    slot.eventMode = "static";
    slot.cursor = "pointer";
    slot.on("pointertap", () => o.pick(r));
    panel.addChild(slot);
  }
  return panel;
}

/** A showcase slot at (x, y): a picture placed as `image` in it and the amount centred at `caption`. */
export function showcase(x: number, y: number, picture: Sprite | null, text: Text, caption: readonly [number, number] = RESOURCE_SLOT.caption): Container {
  const c = new Container();
  c.position.set(x, y);
  if (picture) c.addChild(picture);
  if (text) c.addChild(centredText(text, "smalfont", WHITE, caption[0], caption[1]));
  return c;
}


/** The original's market texts (GENRLTXT, VCMI's numbers), read once. */
export interface MarketTexts {
  kingdom: Text;
  available: Text;
  na: Text;
  /** Nothing picked yet / a deal just made. */
  browse: Text;
  bargain: Text;
  unit: Text;
  units: Text;
  /** "%d %s of %s for %d %s of %s" (resources), "the %s for %d %s of %s" (buying an artifact), "%d %s of %s for your %s" (selling one), "%d %s of %s for %d %s" (creatures). */
  offerResources: Text;
  offerBuyArtifact: Text;
  offerSellArtifact: Text;
  offerCreatures: Text;
  heroArtifacts: Text;
  heroCreatures: Text;
}

let texts: Promise<MarketTexts> | null = null;
export function marketTexts(): Promise<MarketTexts> {
  // The line with its blanks (%s / %d), from the game files.
  const raw = async (id: number) => (await gameLines("genrltxt"))[id] || englishLine("genrltxt", id);
  texts ??= (async () => {
    const [kingdom, available, na, browse, bargain, unit, units, offerResources, offerBuyArtifact, offerSellArtifact, offerCreatures, heroArtifacts, heroCreatures] = await Promise.all([
      raw(270),
      raw(168),
      raw(164),
      raw(163),
      raw(162),
      raw(161),
      raw(160),
      raw(157),
      raw(267),
      raw(268),
      raw(269),
      raw(271),
      raw(272),
    ]);
    return { kingdom, available, na, browse, bargain, unit, units, offerResources, offerBuyArtifact, offerSellArtifact, offerCreatures, heroArtifacts, heroCreatures };
  })();
  return texts;
}

/** A line's blanks filled in order. */
export function fill(line: string, args: (string | number)[]): Text {
  let i = 0;
  return said(line.replace(/%[sd]/g, () => String(args[i++] ?? "")));
}

/** The trader's words in the box top right (VCMI's CMarketTraderText: 256 x 75 at 316, 48). */
export function traderText(words: Text, left = false): GameText {
  // The box at the top right (TPMRKRES), or at the top left when giving to players (TPMRKPTS).
  return centredText(words, "smalfont", WHITE, left ? 158 : 316 + 128, 48 + 37, 256);
}
