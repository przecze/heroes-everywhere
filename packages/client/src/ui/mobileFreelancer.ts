// The Freelancer's Guild on a phone: the shared phone trading panel (ui/blocks/tradePanel.ts) as the marketplace,
// the hero's stacks (the shared stack row) where your resources are, every resource with what one lot of the picked
// creature brings, and the deal: the creatures going, what comes, the slider for how many lots.
import { Container, Sprite } from "pixi.js";
import { creaturePortrait } from "../assets.ts";
import { WHITE } from "../text.ts";
import { label } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { marketTexts } from "./marketKit.ts";
import { openPage } from "./mobilePage.ts";
import { tr, said } from "../i18n/index.ts";
import { PORTRAIT, StackGrid } from "./blocks/stackGrid.ts";
import { CARD, cardKit, cardRows, dealPart, rowPlaces, tradeLayout } from "./blocks/tradePanel.ts";
import { infoCard } from "./stackWindow.ts";
import type { FreelancerOptions } from "./tradeObjects.ts";

/** A stack's place: the portrait and its count under it (medfont). */
const STACK_H = PORTRAIT.large.h + 17;

export async function mobileFreelancer(modals: Modals, player: number, o: FreelancerOptions): Promise<void> {
  let unlisten = () => {};
  const page = await openPage(modals, { bare: true, title: o.title ?? tr("Freelancer's Guild"), draw: () => redraw(), onClose: () => unlisten() });
  const [kit, texts] = await Promise.all([cardKit(player), marketTexts()]);
  let chosen = -1;
  let take = -1;
  let lots = 0;
  /** One lot: the fewest creatures that bring something (VCMI's bidQty / offerQty). */
  const lotOf = (c: number, r: number) => {
    for (let n = 1; n <= 1000; n++) {
      const get = o.price(c, n, r);
      if (get > 0) return { give: n, get };
    }
    return null;
  };

  const draw = async () => {
    const army = o.hero().army;
    const a = chosen >= 0 ? army[chosen] : null;
    if (!a) chosen = -1;
    const lot = a && take >= 0 ? lotOf(a.creature, take) : null;
    const max = a && lot ? Math.floor(a.count / lot.give) : 0;
    lots = Math.max(0, Math.min(lots, max));

    // Yours: the hero's stacks (a tap picks one, a long press opens its card).
    const yours = new StackGrid(
      { size: "large", at: rowPlaces(7, PORTRAIT.large.w, STACK_H), count: "below", countFont: "medfont", packed: true },
      { creatures: o.creatures, onTap: (i) => ((chosen = i), (lots = 0), redraw()), picked: () => chosen, card: infoCard(modals, player, o.creatures, () => o.hero().army) },
    );
    await yours.set(army);
    yours.label = "panel: your creatures";
    // The guild's: one lot's worth of each resource ("get/give", "get" for one).
    const caption = (r: number) => {
      if (!a) return "";
      const l = lotOf(a.creature, r);
      return !l ? texts.na : l.give === 1 ? String(l.get) : `${l.get}/${l.give}`;
    };
    const theirs = cardRows([0, 1, 2, 3, 4, 5, 6].map((r) => Object.assign(kit.card(r, said(caption(r)), r === take, () => ((take = r), (lots = 0), redraw())), { label: `button: resource ${r}` })), CARD.h);
    theirs.label = "panel: the guild's resources";

    const tex = a ? await creaturePortrait(o.creatures[a.creature], "large") : null;
    const goes = (n: number) => {
      const c = new Container();
      if (tex) c.addChild(new Sprite(tex));
      if (a && lot) c.addChild(label(said(String(n * lot.give)), "medfont", WHITE, "center", PORTRAIT.large.w).centreOn(PORTRAIT.large.w / 2, PORTRAIT.large.h + 8));
      return c;
    };
    const { deal, height } = await dealPart({
      player,
      modals,
      goes,
      comes: (n) => (take < 0 ? kit.card(-1, said(""), false) : kit.card(take, a && lot ? said(String(o.price(a.creature, n * lot.give, take))) : said(""), false)),
      topH: STACK_H,
      max,
      lots,
      onLots: (n) => (lots = n),
      ready: !!lot,
      trade: () => {
        if (chosen < 0 || take < 0 || !lot || lots <= 0) return;
        o.sell(chosen, lots * lot.give, take);
        // As the original: the deal done, nothing stays picked.
        chosen = take = -1;
        lots = 0;
        redraw();
      },
      done: () => page.close(),
    });
    page.setContent(await tradeLayout("window: Freelancer's Guild", player, yours, theirs, deal, height));
  };
  let drawing = Promise.resolve();
  const redraw = () => void (drawing = drawing.then(draw).catch((e) => console.error("freelancer", e)));

  await draw();
  unlisten = o.listen(redraw);
  return page.show();
}
