// The Black Market and Artifact Merchants (TPMRKABS: artifacts for any resource), the Freelancer's Guild
// (TPMRKCRS: creatures for any resource), with the original market backgrounds.
import { artifactHold } from "./artifactHold.ts";
import { artifactText } from "./artifactText.ts";
import { type CreatureStats, type Hero } from "@heroes/core";
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { creaturePortrait, loadDef } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { SLOT_POS } from "./heroScreen.ts";
import { DefButton, loadImagePlayer } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { messageBox } from "./dialogs.ts";
import { Slider } from "./blocks/slider.ts";
import { RESOURCE_SHOWCASE, RESOURCE_SLOT, centredText, fill, frameSprite, marketTexts, resourcePanel, selectionFrame, showcase, traderText } from "./marketKit.ts";
import { mobileFreelancer } from "./mobileFreelancer.ts";
import { mobileGoods } from "./mobileGoods.ts";
import { phoneSized } from "./screen.ts";
import { StackGrid } from "./blocks/stackGrid.ts";
import { infoCard } from "./stackWindow.ts";
import { tr, type Text, said, NONE, num, fallback } from "../i18n/index.ts";
import { resourceName } from "./resourceNames.ts";

/** Slots of the artifacts for sale (VCMI's ArtifactsPanel) and of the hero's stacks (CreaturesPanel). */
const ARTIFACT_SLOTS = [[0, 0], [83, 0], [165, 0], [0, 79], [83, 79], [165, 79], [83, 158]];
const CREATURE_SLOTS = [[0, 0], [83, 0], [166, 0], [0, 98], [83, 98], [166, 98], [83, 196]];

export interface BlackMarketOptions {
  stock: () => number[];
  artifacts: { name: string; cost: number; description?: string }[];
  gold: () => number;
  /** `resource`: what's paid with. */
  buy: (slot: number, resource: number) => void;
  listen: (fn: () => void) => () => void;
  /** Any resource pays, at these prices (a town's Artifact Merchants, or the Black Market as five marketplaces). */
  market: { title: Text; price: (artifact: number, resource: number) => number; resources: () => number[] };
  /** A town's Artifact Merchants: the market's button to its selling mode (TPMRKBU3); the window closes, resolving true. */
  other?: Text;
}

export async function blackMarketWindow(modals: Modals, player: number, o: BlackMarketOptions): Promise<boolean> {
  const m = o.market;
  const priceOf = (art: number, r: number) => m.price(art, r);
  const have = (r: number) => m.resources()[r] ?? 0;
  // Phones: the stock as big cards, a tap buying after picking what to pay with.
  if (phoneSized()) {
    const arts = (await loadDef("artifact.def")).get(0) ?? [];
    return mobileGoods(modals, {
      title: m.title,
      player,
      resources: m.resources,
      goods: (r) =>
        o.stock().flatMap((a, i) => {
          const art = o.artifacts[a];
          if (a < 0 || !art) return [];
          const price = priceOf(a, r);
          // Priced in the resource picked at the foot; a tap asks once, with the artifact and the price, then buys.
          return [{
            icon: arts[a]?.texture,
            name: art.name,
            about: () => artifactText(o, a),
            price: [{ resource: r, amount: price }],
            why: have(r) >= price ? null : tr("Not enough resources."),
            trade: async () => {
              if (await dealAsk(modals, player, tr("Buy %1?", art.name), arts[a]?.texture, art.name, r, price)) o.buy(i, r);
            },
          }];
        }),
      empty: tr("Sold out."),
      listen: o.listen,
      other: o.other ? { text: o.other, def: "tpmrkbu3.def" } : undefined,
    });
  }
  // The original's screen (TPMRKABS) as VCMI's CArtifactsBuying: your resources left, the artifacts
  // for sale right with their price in the resource picked, the two picked under the panels.
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer("tpmrkabs.pcx", player)));
  const t = await marketTexts();
  win.addChild(centredText(m.title, "bigfont", YELLOW, 299, 27), centredText(t.kingdom, "smalfont", WHITE, 156, 148), centredText(t.available, "smalfont", WHITE, 445, 148));
  const arts = (await loadDef("artifact.def")).get(0) ?? [];
  const icons = (await loadDef("resource.def")).get(0) ?? [];
  const layer = new Container();
  win.addChild(layer);
  let chosen = -1;
  let pay = -1;
  let dealt = false;
  const trade = new DefButton("tpmrkb.def", 270, 520, player);
  const ok = new DefButton("iok6432.def", 516, 520, player);
  win.addChild(trade, ok);
  const draw = () => {
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const stock = o.stock();
    const art = chosen >= 0 ? stock[chosen] : -1;
    if (art < 0) chosen = -1;
    layer.addChild(resourcePanel(39, 184, { icons, caption: (r) => said(String(have(r))), selected: pay, pick: (r) => ((pay = r), (dealt = false), draw()) }));
    // The artifacts for sale (ARTIFACTS panel: 69 x 68 slots, the picture 13 in, the price under it).
    const panel = new Container();
    panel.position.set(328, 181);
    stock.forEach((a, i) => {
      const [x, y] = ARTIFACT_SLOTS[i] ?? [];
      if (x === undefined || a < 0 || !arts[a]) return;
      const slot = new Container();
      slot.position.set(x, y);
      slot.addChild(new Graphics().rect(0, 0, 69, 68).fill({ color: 0, alpha: 0.001 }));
      const pic = frameSprite(arts[a], 13, 0);
      if (pic) slot.addChild(pic);
      if (pay >= 0) slot.addChild(centredText(said(String(priceOf(a, pay))), "smalfont", WHITE, 35, 57));
      if (i === chosen) slot.addChild(selectionFrame(69, 68));
      slot.eventMode = "static";
      slot.cursor = "pointer";
      slot.on("pointertap", () => ((chosen = i), (dealt = false), draw()));
      artifactHold(slot, player, o, a);
      panel.addChild(slot);
    });
    layer.addChild(panel);
    const both = art >= 0 && pay >= 0;
    const price = both ? priceOf(art, pay) : 0;
    const name = art >= 0 ? (o.artifacts[art]?.name ?? "") : "";
    layer.addChild(traderText(both ? fill(t.offerBuyArtifact, [name, price, price === 1 ? t.unit : t.units, resourceName(pay)]) : dealt ? t.bargain : t.browse));
    if (both) {
      // The showcases: HotA's screen has the selling screen's boxes here (VCMI's CArtifactsSelling
      // places, mirrored): the resource paid in the left one, the artifact in the right, amounts under.
      layer.addChild(showcase(118, 473, frameSprite(icons[pay], 19, 8), said(String(price)), [38, 56]), showcase(411, 470, frameSprite(arts[art], 13, 0), said("1"), [35, 59]));
    }
    trade.disabled = !both || have(pay) < price;
    trade.explain(modals, player, () => (both ? tr("Not enough resources.") : tr("Pick what to trade first.")));
  };
  draw();
  const unlisten = o.listen(() => {
    chosen = -1;
    draw();
  });
  // The market's mode button down the left (VCMI's createChangeModeButtons at 18, 520).
  const modeB = o.other ? new DefButton("tpmrkbu3.def", 18, 520) : null;
  if (modeB) ((modeB.hint = o.other!), win.addChild(modeB));
  return new Promise((resolve) => {
    let close = () => {};
    const done = (switched = false) => (unlisten(), close(), resolve(switched));
    if (modeB) modeB.onClick = () => done(true);
    trade.onClick = () => {
      if (chosen < 0 || pay < 0) return;
      o.buy(chosen, pay);
      dealt = true;
      chosen = pay = -1;
      draw();
    };
    ok.onClick = () => done();
    close = modals.show(win, { onKey: (k) => (k === "Escape" || k === "Enter" ? done() : k === " " ? trade.onClick() : undefined, true) });
  });
}

/** Phones: the deal asked once (the original's trade button): the artifact and the resource with its amount, OK or Cancel. */
async function dealAsk(modals: Modals, player: number, text: Text, art: Texture | undefined, name: string, r: number, amount: number): Promise<boolean> {
  const icons = (await loadDef("resource.def")).get(0) ?? [];
  const components = [...(art ? [{ texture: art, caption: said(name) }] : []), ...(icons[r] ? [{ texture: icons[r].texture, caption: num(amount) }] : [])];
  const v = await messageBox(modals, text, player, { components, buttons: [{ def: "iokay.def", value: "ok" }, { def: "icancel.def", value: "no" }] });
  return v === "ok";
}

export interface FreelancerOptions {
  /** The building's name (a town's guild), else "Freelancer's Guild". */
  title?: Text;
  hero: () => Hero;
  creatures: CreatureStats[];
  /** What `count` of a creature bring in `resource` (0: too few for any). */
  price: (creature: number, count: number, resource: number) => number;
  sell: (slot: number, count: number, resource: number) => void;
  listen: (fn: () => void) => () => void;
}

export async function freelancerWindow(modals: Modals, player: number, o: FreelancerOptions): Promise<void> {
  // Phones: the shared phone trading panel, as the marketplace.
  if (phoneSized()) return mobileFreelancer(modals, player, o);
  // The original's screen (TPMRKCRS) as VCMI's CFreelancerGuild: the hero's stacks left, every resource
  // right with what one lot of the picked creature brings, the slider for how many lots.
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer("tpmrkcrs.pcx", player)));
  const t = await marketTexts();
  win.addChild(
    centredText(tr("Freelancer's Guild"), "bigfont", YELLOW, 299, 27),
    centredText(fill(t.heroCreatures, [o.hero().name ?? fallback("Hero")]), "smalfont", WHITE, 155, 103),
    centredText(t.available, "smalfont", WHITE, 445, 148),
  );
  const icons = (await loadDef("resource.def")).get(0) ?? [];
  const portraits = new Map<number, Awaited<ReturnType<typeof creaturePortrait>>>();
  const portrait = async (c: number) => {
    if (!portraits.has(c)) portraits.set(c, await creaturePortrait(o.creatures[c], "large"));
    return portraits.get(c);
  };
  for (const a of o.hero().army) if (a) await portrait(a.creature);
  const layer = new Container();
  win.addChild(layer);
  let chosen = -1;
  let take = -1;
  let dealt = false;
  // The shared slider (ui/blocks/slider.ts) where VCMI's CSlider sits.
  const slider = new Slider(137);
  slider.position.set(232, 489);
  const maxB = new DefButton("ircbtns.def", 228, 520);
  const trade = new DefButton("tpmrkb.def", 306, 520, player);
  const ok = new DefButton("iok6432.def", 516, 520, player);
  win.addChild(slider, maxB, trade, ok);
  /** One lot: the fewest creatures that bring something (VCMI's bidQty / offerQty). */
  const lotOf = (c: number, r: number) => {
    for (let n = 1; n <= 1000; n++) {
      const get = o.price(c, n, r);
      if (get > 0) return { give: n, get };
    }
    return null;
  };
  const showcases = new Container();
  win.addChild(showcases);
  let lot: { give: number; get: number } | null = null;
  const showAmounts = () => {
    showcases.removeChildren().forEach((c) => c.destroy({ children: true }));
    const a = chosen >= 0 ? o.hero().army[chosen] : null;
    if (!a || take < 0 || !lot) return;
    const n = slider.value;
    const tex = portraits.get(a.creature);
    showcases.addChild(
      showcase(45 + 83, 123 + 327, tex ? new Sprite(tex) : null, said(String(n * lot.give)), [30, 76]),
      showcase(327 + RESOURCE_SHOWCASE[0], 182 + RESOURCE_SHOWCASE[1], frameSprite(icons[take], RESOURCE_SLOT.image[0], RESOURCE_SLOT.image[1]), said(String(o.price(a.creature, n * lot.give, take)))),
    );
  };
  const draw = () => {
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const h = o.hero();
    // The hero's stacks (CREATURES panel: 59 x 64 portraits, the count under each): the shared stack row, a tap picks
    // one, a long press opens its card.
    const panel = new StackGrid(
      { size: "large", at: CREATURE_SLOTS.map(([x, y]) => [x, y] as const), count: "below" },
      { creatures: o.creatures, onTap: (i) => ((chosen = i), (dealt = false), slider.set(0, false), draw()), picked: () => chosen, card: infoCard(modals, player, o.creatures, () => o.hero().army) },
    );
    panel.position.set(45, 123);
    void panel.set(h.army);
    layer.addChild(panel);
    const a = chosen >= 0 ? h.army[chosen] : null;
    if (!a) chosen = -1;
    const caption = (r: number): Text => {
      if (!a) return NONE;
      const l = lotOf(a.creature, r);
      return !l ? t.na : said(l.give === 1 ? String(l.get) : `${l.get}/${l.give}`);
    };
    layer.addChild(resourcePanel(327, 182, { icons, caption, selected: take, pick: (r) => ((take = r), (dealt = false), slider.set(0, false), draw()) }));
    lot = a && take >= 0 ? lotOf(a.creature, take) : null;
    const c = a ? o.creatures[a.creature] : null;
    layer.addChild(
      traderText(a && lot && c ? fill(t.offerCreatures, [lot.get, lot.get === 1 ? t.unit : t.units, resourceName(take), lot.give, lot.give === 1 ? c.name : c.plural]) : dealt ? t.bargain : t.browse),
    );
    const max = a && lot ? Math.floor(a.count / lot.give) : 0;
    slider.range(max);
    slider.block(!lot);
    maxB.disabled = !lot || !max;
    trade.disabled = !lot || slider.value <= 0;
    maxB.explain(modals, player, () => (lot ? tr("Not enough creatures.") : tr("Pick what to trade first.")));
    trade.explain(modals, player, () => (lot ? tr("Move the slider to pick how many.") : tr("Pick what to trade first.")));
    showAmounts();
  };
  slider.onChange = () => {
    trade.disabled = !lot || slider.value <= 0;
    showAmounts();
  };
  maxB.onClick = () => slider.toMax();
  draw();
  const unlisten = o.listen(() => {
    chosen = -1;
    draw();
  });
  return new Promise((resolve) => {
    let close = () => {};
    const done = () => (unlisten(), close(), resolve());
    trade.onClick = () => {
      if (chosen < 0 || take < 0 || !lot || slider.value <= 0) return;
      o.sell(chosen, slider.value * lot.give, take);
      dealt = true;
      chosen = take = -1;
      slider.set(0, false);
      draw();
    };
    ok.onClick = done;
    close = modals.show(win, {
      onKey: (k) => {
        if (k === "Escape" || k === "Enter") done();
        else if (k === " ") trade.onClick();
        else if (k === "m") maxB.onClick();
        else if (k === "ArrowLeft") slider.step(-1);
        else if (k === "ArrowRight") slider.step(1);
        return true;
      },
    });
  });
}

export interface JunkmanOptions {
  hero: () => Hero;
  artifacts: { name: string; description?: string }[];
  /** Whether it's taken at all (0: not). */
  price: (id: number) => number;
  /** `resource`: what's taken in return. */
  sell: (id: number, resource: number) => void;
  listen: (fn: () => void) => () => void;
  /** Paid in any resource, at these prices (a town's Artifact Merchants, or the Junkman as seven marketplaces). */
  market: { title: Text; price: (artifact: number, resource: number) => number; resources: () => number[] };
  /** A town's Artifact Merchants: the market's button to its buying mode (TPMRKBU2); the window closes, resolving true. */
  other?: Text;
}

/** Selling artifacts on the original artifacts-for-resources screen (TPMRKASS): HotA's Junkman and a town's Artifact Merchants. */
export async function junkmanWindow(modals: Modals, player: number, o: JunkmanOptions): Promise<boolean> {
  const m = o.market;
  const priceOf = (id: number, r: number) => (o.price(id) ? m.price(id, r) : 0);
  // Phones: the hero's artifacts the Junkman buys, as big cards; a tap sells.
  if (phoneSized()) {
    const arts = (await loadDef("artifact.def")).get(0) ?? [];
    return mobileGoods(modals, {
      title: m.title,
      player,
      resources: m.resources,
      goods: (r) => {
        const h = o.hero();
        const ids = [...(h.equipped ?? []), ...(h.backpack ?? [])].filter((id) => id >= 0 && o.artifacts[id] && o.price(id));
        // What each brings in the resource picked at the foot; a tap asks once, then sells.
        return ids.map((id) => ({
          icon: arts[id]?.texture,
          name: o.artifacts[id].name,
          about: () => artifactText(o, id, o.hero()),
          price: [{ resource: r, amount: priceOf(id, r) }],
          why: priceOf(id, r) > 0 ? null : tr("Not enough resources."),
          trade: async () => {
            if (await dealAsk(modals, player, tr("Sell %1?", o.artifacts[id].name), arts[id]?.texture, o.artifacts[id].name, r, priceOf(id, r))) o.sell(id, r);
          },
        }));
      },
      empty: tr("Nothing to sell."),
      listen: o.listen,
      other: o.other ? { text: o.other, def: "tpmrkbu2.def" } : undefined,
    });
  }
  // The original's screen (TPMRKASS) as VCMI's CArtifactsSelling: the hero's artifacts left, every
  // resource right with what the picked artifact brings in it.
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer("tpmrkass.pcx", player)));
  const t = await marketTexts();
  win.addChild(
    // (VCMI's "%s's Artifacts" at 155, 56 would sit on HotA's helmet slot: HotA's screen has no place for it.)
    centredText(m.title, "bigfont", YELLOW, 299, 27),
    centredText(t.available, "smalfont", WHITE, 445, 148),
  );
  const arts = (await loadDef("artifact.def")).get(0) ?? [];
  const icons = (await loadDef("resource.def")).get(0) ?? [];
  const layer = new Container();
  win.addChild(layer);
  let chosen = -1;
  let take = -1;
  let dealt = false;
  const trade = new DefButton("tpmrkb.def", 270, 520, player);
  const ok = new DefButton("iok6432.def", 516, 520, player);
  win.addChild(trade, ok);
  const draw = () => {
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const h = o.hero();
    const owned = [...(h.equipped ?? []), ...(h.backpack ?? [])];
    if (chosen >= 0 && !owned.includes(chosen)) chosen = -1;
    const place = (id: number, x: number, y: number) => {
      if (id < 0 || !arts[id]) return;
      const sp = Object.assign(new Sprite(arts[id].texture), { x, y });
      sp.alpha = o.price(id) ? 1 : 0.45;
      sp.eventMode = "static";
      sp.cursor = "pointer";
      sp.on("pointertap", () => {
        if (o.price(id)) ((chosen = id), (dealt = false), draw());
      });
      artifactHold(sp, player, o, id, h);
      layer.addChild(sp);
      if (id === chosen) layer.addChild(Object.assign(selectionFrame(46, 46), { x: x - 1, y: y - 1 }));
    };
    // The paper doll and backpack: the hero screen's places, moved onto this screen's slots.
    SLOT_POS.forEach(([x, y], slot) => place(h.equipped?.[slot] ?? -1, x - 361, y + 18));
    (h.backpack ?? []).slice(0, 5).forEach((id, k) => place(id, 403 + 46 * k - 361, 365 + 18));
    const caption = (r: number): Text => (chosen >= 0 ? said(String(priceOf(chosen, r))) : NONE);
    layer.addChild(resourcePanel(326, 184, { icons, caption, selected: take, pick: (r) => ((take = r), (dealt = false), draw()) }));
    const both = chosen >= 0 && take >= 0;
    const get = both ? priceOf(chosen, take) : 0;
    layer.addChild(traderText(both ? fill(t.offerSellArtifact, [get, get === 1 ? t.unit : t.units, resourceName(take), o.artifacts[chosen]?.name ?? ""]) : dealt ? t.bargain : t.browse));
    // VCMI's showcases: the artifact in its slot at (123, 470), the resource in the one at (409, 473).
    if (chosen >= 0) layer.addChild(showcase(123, 470, frameSprite(arts[chosen], 13, 0), said("1"), [35, 57]));
    if (both) layer.addChild(showcase(409, 473, frameSprite(icons[take], RESOURCE_SLOT.image[0], RESOURCE_SLOT.image[1]), said(String(get)), [35, 56]));
    trade.disabled = !both || get <= 0;
    trade.explain(modals, player, () => (both ? null : tr("Pick what to trade first.")));
  };
  draw();
  const unlisten = o.listen(() => {
    chosen = -1;
    draw();
  });
  // The market's mode button down the left (VCMI's createChangeModeButtons at 18, 520).
  const modeB = o.other ? new DefButton("tpmrkbu2.def", 18, 520) : null;
  if (modeB) ((modeB.hint = o.other!), win.addChild(modeB));
  return new Promise((resolve) => {
    let close = () => {};
    const done = (switched = false) => (unlisten(), close(), resolve(switched));
    if (modeB) modeB.onClick = () => done(true);
    trade.onClick = () => {
      if (chosen < 0 || take < 0) return;
      o.sell(chosen, take);
      dealt = true;
      chosen = take = -1;
      draw();
    };
    ok.onClick = () => done();
    close = modals.show(win, { onKey: (k) => (k === "Escape" || k === "Enter" ? done() : k === " " ? trade.onClick() : undefined, true) });
  });
}
