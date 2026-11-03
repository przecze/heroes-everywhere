// The marketplace on a phone (2026-10-25: the resource cards, the one slider, no "give X for Y" sentence): the
// shared phone trading panel (ui/blocks/tradePanel.ts) with yours with your amounts, the market's with its rates (or
// the other players' flags when giving), and the deal, giving to players and back (TPMRKBU1 / BU5).
import { RESOURCE_NAMES, marketCount, tradeRate } from "@heroes/core";
import type { Container } from "pixi.js";
import { DefButton } from "../ui/kit.ts";
import { compactAmount } from "../ui/blocks/resourceBar.ts";
import { CARD, FLAG, cardKit, cardRows, dealPart, tradeLayout } from "../ui/blocks/tradePanel.ts";
import { marketTexts } from "../ui/marketKit.ts";
import { openPage } from "../ui/mobilePage.ts";
import { tr, said, type Text } from "../i18n/index.ts";
import type { TownCtx } from "./windows.ts";

export async function mobileMarket(ctx: TownCtx, opts: { title?: Text; minMarkets?: number; rate?: (from: number, to: number) => { give: number; get: number } | null } = {}): Promise<void> {
  const o = ctx.town();
  const player = ctx.player;
  let unlisten = () => {};
  // Its name over it, as the desktop window's (a Trading Post's on the map).
  const page = await openPage(ctx.modals, { bare: true, title: opts.title ?? tr("Marketplace"), draw: () => redraw(), onClose: () => unlisten() });
  const [kit, texts] = await Promise.all([cardKit(player), marketTexts()]);
  const { card, flag } = kit;
  // As the original: nothing picked until the player picks (special traders start on what they trade).
  let give = opts.rate ? 1 : -1;
  let take = opts.rate ? 3 : -1;
  let lots = 0;
  /** Trading, or giving to another player (the original's TPMRKBU1 mode; not at special traders). */
  let mode: "trade" | "players" = "trade";
  const rateOf = (a: number, b: number) => {
    if (mode === "players") return { give: 1, get: 1 };
    const markets = Math.max(marketCount(ctx.state(), o.owner), opts.minMarkets ?? 0);
    return opts.rate ? opts.rate(a, b) : tradeRate(markets, a, b);
  };

  const draw = async () => {
    const have = ctx.state().players[o.owner].resources;
    const rate = give >= 0 && take >= 0 && (mode === "players" || give !== take) ? rateOf(give, take) : null;
    const max = rate && rate.get ? Math.floor(have[give] / rate.give) : 0;
    lots = Math.max(0, Math.min(lots, max));
    const pick = (side: "give" | "take", v: number) => () => {
      if (side === "give") give = v;
      else take = v;
      lots = 0;
      redraw();
    };

    // Yours: the amounts. The market's: one lot's price ("get/give", "get" for one), or the players' flags.
    const yours = cardRows([0, 1, 2, 3, 4, 5, 6].map((r) => Object.assign(card(r, compactAmount(have[r], r === 6), r === give, pick("give", r)), { label: `button: ${RESOURCE_NAMES[r]}` })), CARD.h);
    yours.label = "panel: your resources";
    let theirs: Container;
    if (mode === "players") {
      const others = ctx.state().players.filter((p) => p.alive && p.color !== o.owner);
      theirs = cardRows(others.map((p) => Object.assign(flag(p.color, p.color === take, pick("take", p.color)), { label: `player: ${p.color}` })), FLAG.h);
      theirs.label = "panel: players";
    } else {
      const caption = (r: number) => {
        if (give < 0) return "";
        const x = r === give ? null : rateOf(give, r);
        if (!x || !x.get) return texts.na;
        return x.give === 1 ? String(x.get) : `${x.get}/${x.give}`;
      };
      theirs = cardRows([0, 1, 2, 3, 4, 5, 6].map((r) => Object.assign(card(r, said(caption(r)), r === take, pick("take", r)), { label: `button: for ${RESOURCE_NAMES[r]}` })), CARD.h);
      theirs.label = "panel: the market's resources";
    }

    // The deal: what goes, the handshake, what comes; the slider; Min, Max, the mode and Done.
    const toOther = opts.rate ? null : new DefButton(mode === "trade" ? "tpmrkbu1.def" : "tpmrkbu5.def", 0, 0, player);
    if (toOther) {
      toOther.label = mode === "trade" ? "button: Give to players" : "button: Trade resources";
      toOther.onClick = () => {
        mode = mode === "trade" ? "players" : "trade";
        give = take = -1;
        lots = 0;
        redraw();
      };
    }
    const { deal, height } = await dealPart({
      player,
      modals: ctx.modals,
      goes: (n) => card(give, give >= 0 && rate ? said(String(n * rate.give)) : said(""), false),
      comes: (n) => (take < 0 ? card(-1, said(""), false) : mode === "players" ? flag(take, false) : card(take, rate ? said(String(n * rate.get)) : said(""), false)),
      comesW: mode === "players" ? FLAG.w : CARD.w,
      topH: Math.max(CARD.h, mode === "players" ? FLAG.h : 0),
      max,
      lots,
      onLots: (n) => (lots = n),
      ready: !!rate && !!rate.get,
      trade: () => {
        if (!rate || lots <= 0) return;
        if (mode === "players") ctx.send({ type: "giveResources", to: take, resource: give, amount: lots });
        else ctx.send({ type: "trade", from: give, to: take, lots });
        // As the original: the deal done, nothing stays picked.
        if (!opts.rate) give = take = -1;
        lots = 0;
        redraw();
      },
      done: () => page.close(),
      extra: toOther ?? undefined,
    });
    page.setContent(await tradeLayout("window: marketplace", player, yours, theirs, deal, height));
  };
  let drawing = Promise.resolve();
  const redraw = () => void (drawing = drawing.then(draw).catch((e) => console.error("market", e)));

  await draw();
  unlisten = ctx.listen(redraw);
  return page.show();
}
