// Trading spots on a phone (the Black Market, the Junkman, a town's Artifact Merchants): what's on offer as the
// phones' shopping-list tiles (ui/blocks/shopTiles.ts, the town hall's look: the picture, its price as the resource's
// picture and amount, the green / red bar with the name), a tap trading it, a hold telling what it is; what there is
// to pay with in the marketplace's resource cards under them (a tap prices the goods in that resource).
import { Container, type Texture } from "pixi.js";
import { WHITE } from "../text.ts";
import { type Modals } from "./modals.ts";
import { textPopup } from "./dialogs.ts";
import { type ColumnButton, bigText, contentArea, openPage, pageColumn, scrollList } from "./mobilePage.ts";
import { shopGrid, shopTile, shopTileArt } from "./blocks/shopTiles.ts";
import { compactAmount } from "./blocks/resourceBar.ts";
import { CARD, PANEL_W, cardKit, cardRows } from "./blocks/tradePanel.ts";
import { RESOURCE_NAMES } from "@heroes/core";
import { type Text, reason } from "../i18n/index.ts";

export interface Good {
  icon?: Texture | null;
  name: string;
  /** What it costs (or brings), by resource: drawn as the resources' pictures with their amounts. */
  price: { resource: number; amount: number }[];
  /** Why it can't be traded now, if so (the bar turns red, a tap says why). */
  why?: Text | null;
  trade: () => void;
  /** What a finger held on the tile says (an artifact's description). */
  about?: () => Text;
}

export interface GoodsPage {
  title: Text;
  /** What's on offer, priced in `resource` (picked on the resource bar at the foot, gold at first). */
  goods: (resource: number) => Good[];
  empty: Text;
  listen: (fn: () => void) => () => void;
  /** The player's resources, across the foot (drawn again after each trade). */
  resources: () => readonly number[];
  /** The frame colour of the held text, and of the resource bar. */
  player: number;
  /** The market's other mode (Artifact Merchants: buying, selling), its original button: the page closes, resolving true. */
  other?: { text: Text; def: string };
}

export async function mobileGoods(modals: Modals, o: GoodsPage): Promise<boolean> {
  let unlisten = () => {};
  let switched = false;
  const page = await openPage(modals, { draw: () => redraw(), onClose: () => unlisten(), titleOnly: true });
  const [art, kit] = await Promise.all([shopTileArt(), cardKit(o.player)]);
  let list: ReturnType<typeof scrollList> | null = null;
  let drawing = Promise.resolve();
  // What the prices are in: the resource picked on the bar at the foot, as the marketplace (2026-11-02 19:10:
  // "you pick a resource and then you see prices in this resource"); gold at first.
  let resource = 6;

  const draw = async () => {
    // The layout now (the phone may have turned).
    let area = contentArea();
    const other: ColumnButton[] = o.other ? [[o.other.text, () => ((switched = true), page.close()), true, o.other.def]] : [];
    const parts = await pageColumn(o.title, { buttons: [...other, ["Close", () => page.close()]] });
    // What there is to pay with: the marketplace's own seven resource cards, four over three, with what you have
    // under each (2026-11-03: wherever a resource is picked it is the same component as the marketplace's); a
    // tap on one prices the tiles in it, the picked one framed in gold. Gold at first.
    const have = o.resources();
    const cards = cardRows([0, 1, 2, 3, 4, 5, 6].map((r) => Object.assign(kit.card(r, compactAmount(have[r] ?? 0, r === 6), r === resource, r === resource ? undefined : () => ((resource = r), redraw())), { label: `button: ${RESOURCE_NAMES[r]}` })), CARD.h);
    // (Smaller where the screen is short, a phone sideways: the goods keep most of it.)
    const ck = Math.min(1.25, area.w / PANEL_W, (area.h * 0.4) / cards.height);
    cards.scale.set(ck);
    area = { ...area, h: area.h - Math.round(cards.height) - 12 };
    cards.position.set(area.x + Math.round((area.w - cards.width) / 2), area.y + area.h + 12);
    parts.addChild(cards);
    const goods = o.goods(resource);
    const { cols, k, tileW, tileH, gapX, gapY } = shopGrid(area.w);
    const content = new Container();
    if (!goods.length) content.addChild(bigText(o.empty, "medfont", WHITE, 1.5, { wrap: area.w }));
    goods.forEach((g, i) => {
      const tile = shopTile({ label: `good: ${g.name}`, name: g.name, bar: g.why ? 2 : 1, picture: g.icon, small: true, price: g.price, dim: !!g.why }, art, k);
      tile.position.set((i % cols) * (tileW + gapX), Math.floor(i / cols) * (tileH + gapY));
      (tile as Container & { handGrid?: boolean }).handGrid = true;
      tile.eventMode = "static";
      tile.cursor = "pointer";
      tile.on("pointertap", (e) => {
        if (list?.moved() || e.button === 2) return;
        const why = reason(g.why);
        if (why) textPopup(why, o.player, e.global.x, e.global.y);
        else g.trade();
      });
      const about = g.about;
      if (about) tile.on("rightdown", (e) => textPopup(about(), o.player, e.global.x, e.global.y));
      content.addChild(tile);
    });
    list = scrollList(content, area, list?.offset() ?? 0);
    parts.addChild(list.view);
    page.setContent(parts);
  };
  const redraw = () => void (drawing = drawing.then(draw).catch((e) => console.error("goods", e)));

  await draw();
  unlisten = o.listen(redraw);
  await page.show();
  return switched;
}
