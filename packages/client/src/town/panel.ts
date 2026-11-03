// Desktop (and a tablet's middle): the original's TOWNSCRN panel under the picture: the town's icon and name, hall and
// fort, income, the creatures' growth, the two heroes and their armies, split and exit, the status bar, the resources
// and the list of the player's towns.
import { B, TOWNS, fortLevel, garrisonHero, hallLevel, levelCount, townIncome, townLevelCreature, upperArmy, visitingHero, weeklyGrowth, dwellingId, buildingName, type AdvObject, type AdventureState, type ArmyRef, type World, ownTowns } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { creaturePortrait, loadDef, loadImage, townIcon } from "../assets.ts";
import { extra } from "../settings.ts";
import { GameText, WHITE } from "../text.ts";
import { tr, said, fmt, type Text } from "../i18n/index.ts";
import { DefButton, FingerArea, label, loadImagePlayer, textButton } from "../ui/kit.ts";
import { resolveText, textTable } from "../ui/gameText.ts";
import { StackGrid } from "../ui/blocks/stackGrid.ts";
import { block } from "../ui/blocks/block.ts";
import { showPopup } from "../ui/creatureInfo.ts";
import { townQuickView } from "../ui/quickView.ts";
import { heroSlot } from "./heroSlot.ts";
import { armyRef, type TownScreen } from "./screen.ts";
import { buildingClicked, massRecruit } from "./windows.ts";
import { townName } from "../i18n/towns.ts";

export class TownPanel {
  /** First town shown in the town list. */
  private listScroll = 0;

  private readonly town: TownScreen;
  constructor(town: TownScreen) {
    this.town = town;
  }

  /** The TOWNSCRN panel: town icon and name, hall/fort, income, heroes and armies, exit. */
  async draw(s: AdventureState, w: World, o: AdvObject) {
    const town = this.town;
    const t = o.town!;
    // The status bar's words: TCOMMAND.TXT's (VCMI's CCastleInterface / CGarrisonSlot / CHeroGSlot), ours without it.
    const tc = await textTable("tcommand");
    const empty = (await resolveText({ file: "genrltxt", id: 507 }))?.trim() || tr("Empty");
    const player = Math.max(0, o.owner);
    const panel = new Container();
    panel.addChild(Object.assign(new Sprite(await loadImagePlayer("townscrn.pcx", player)), { y: 374, label: "panel: town panel" }));
    const fort = fortLevel(t.built);
    // With the red cross once something was built today (VCMI: icons[fort][built]).
    const icon = await townIcon(o.subid, fort > 0, !!t.builtToday, "large");
    // The town's picture opens the tavern, the gold the marketplace (VCMI's fastTavern / fastMarket).
    if (icon) {
      const pic = new Sprite(icon);
      if (t.built.includes(B.TAVERN)) panel.addChild(this.button(pic, 15, 387, said(buildingName(w, o, B.TAVERN)), () => void buildingClicked(town.ctx(), B.TAVERN)));
      else panel.addChild(Object.assign(pic, { x: 15, y: 387 }));
    }
    if (t.built.includes(B.MARKETPLACE)) {
      const gold = new Graphics().rect(0, 0, 64, 42).fill({ color: 0, alpha: 0.001 });
      panel.addChild(this.button(gold, 163, 410, said(buildingName(w, o, B.MARKETPLACE)), () => void buildingClicked(town.ctx(), B.MARKETPLACE)));
    }
    const fallback = TOWNS[o.subid]?.faction ?? "town";
    const name = label(said(o.name) ?? townName(fallback), "medfont", WHITE);
    name.position.set(83, 386);
    panel.addChild(name);
    const hall = Math.max(0, hallLevel(t.built));
    const hallIcon = (await loadDef("itmtl.def")).get(0)?.[hall];
    if (hallIcon) panel.addChild(this.button(new Sprite(hallIcon.texture), 80, 413, said(buildingName(w, o, B.VILLAGE_HALL + hall)), () => buildingClicked(town.ctx(), B.VILLAGE_HALL + hall)));
    if (fort) {
      const fortIcon = (await loadDef("itmcl.def")).get(0)?.[fort - 1];
      // HotA: the panel's fort recruits from every dwelling at once (the castle in the scene opens the fort's roster).
      if (fortIcon) panel.addChild(Object.assign(this.button(new Sprite(fortIcon.texture), 122, 413, said(buildingName(w, o, B.FORT + fort - 1)), () => void massRecruit(town.ctx())), { label: "button: Recruit all" }));
    }
    const income = label(said(String(townIncome(o)[6])), "smalfont", WHITE, "center", 60);
    income.centreOn(195, 443);
    panel.addChild(income);

    // Each built dwelling's best creature and its weekly growth; click to recruit (VCMI's CCreaInfo).
    const info = TOWNS[o.subid];
    for (let level = 0; level < Math.min(8, levelCount(o)); level++) {
      if (!t.built.includes(dwellingId(level)) || !info) continue;
      const c = w.creatures[townLevelCreature(o, level) ?? -1];
      const tex = c && (await creaturePortrait(c, "small"));
      const x = 14 + 55 * (level % 4);
      const y = level < 4 ? 459 : 507;
      const growth = weeklyGrowth(w, o, level, s);
      if (tex) panel.addChild(this.button(new Sprite(tex), x + 8, y, tc(21, tr(`Recruit %1`, c.plural), c.plural), () => buildingClicked(town.ctx(), dwellingId(level)), tr(`%1: %2 available, +%3 per week`, c.plural, t.available[level] ?? 0, growth)));
      // What can be bought now, then the weekly growth.
      // (The original shows the growth alone, as VCMI's CCreaInfo.)
      const g = label(extra("trayAvailable") ? fmt`${t.available[level] ?? 0} (+${growth})` : fmt`+${growth}`, "smalfont", WHITE, "center", 54);
      g.centreOn(x + 24, y + 40);
      panel.addChild(g);
    }

    // Heroes: the garrison hero (top) and the visiting one (bottom), then their armies. Click one
    // portrait, then the other place: they change places (the one going up takes the garrison's troops).
    const hero = visitingHero(s, w, o);
    const above = garrisonHero(s, o);
    for (const [y, which] of [[387, "up"], [483, "down"]] as const) {
      const slot = await heroSlot(town, o, which, () => town.state && town.world && void this.draw(town.state, town.world, o));
      slot.position.set(241, y);
      panel.addChild(slot);
    }
    // Ours: the two heroes' exchange window (troops and artifacts) by a click, between the portraits (the original: E only).
    if (above && hero && extra("townExchange") && town.onExchange) {
      const b = await textButton(tr("Exchange"), 58, 28, () => town.onExchange?.(above.id, hero.id, town.modals), "smalfont");
      b.position.set(241, 453);
      b.on("pointerover", () => town.setStatus(tc(7, tr(`Exchange %1 with %2`, above.name, hero.name), above.name, hero.name)));
      panel.addChild(b);
    }
    const rows: [ArmyRef["who"], (typeof t.garrison)[number][], number][] = [["garrison", upperArmy(s, o), 387]];
    if (hero) rows.push(["hero", hero.army, 483]);
    // The two rows are the shared stack row (ui/blocks/stackGrid.ts) with the town's clicks, drag and drop between them.
    const grids: StackGrid[] = [];
    for (const [who, army, y] of rows) {
      const n = who === "garrison" ? 0 : 1;
      const grid = new StackGrid(
        { size: "large", at: Array.from({ length: 7 }, (_, slot) => [slot * 62, 0] as const), count: "corner" },
        {
          creatures: w.creatures,
          who: n,
          clicks: town.army,
          changed: () => town.state && town.world && void this.draw(town.state, town.world, o),
          drag: { layer: town.root, grids: () => grids, move: (from, to) => town.send({ type: "moveStack", town: o.id, from: armyRef(from), to: armyRef(to) }) },
          // As VCMI's CGarrisonSlot: TCOMMAND 4 "View %s" (this one picked), 2 "Combine %s armies", 7 "Exchange %s with %s",
          // 12 / 32 "Select %s (in garrison / visiting)"; an empty slot 6 "Move %s" with one picked, else "Empty".
          hover: (slot) => {
            if (slot === null) return town.setStatus(said(""));
            const a = army[slot];
            const sel = town.army.selected;
            const selArmy = sel ? (sel.who === 0 ? upperArmy(s, o) : visitingHero(s, w, o)?.army) : undefined;
            const from = sel && selArmy?.[sel.slot];
            const fromName = from ? (w.creatures[from.creature]?.plural ?? "") : "";
            const name = a ? (w.creatures[a.creature]?.plural ?? "") : "";
            town.setStatus(
              a
                ? town.army.isSelected({ who: n, slot })
                  ? tc(4, tr(`View %1`, name), name)
                  : from
                    ? from.creature === a.creature
                      ? tc(2, tr(`Combine %1 armies`, name), name)
                      : tc(7, tr(`Exchange %1 with %2`, fromName, name), fromName, name)
                    : who === "garrison"
                      ? tc(12, tr(`Select %1 (in garrison)`, name), name)
                      : tc(32, tr(`Select %1 (visiting)`, name), name)
                : from
                  ? tc(6, tr(`Move %1`, fromName), fromName)
                  : empty,
            );
          },
        },
      );
      grids.push(grid);
      await grid.set(army);
      grid.position.set(305, y);
      panel.addChild(grid);
    }
    // TSBTNS: frames 0-3 are the swap-armies button, 4-5 the exit tick (VCMI's setImageOrder).
    const exit = new DefButton("tsbtns.def", 744, 544, -1, [4, 5]);
    exit.hint = tc(8, tr("Exit town"));
    exit.onHint = (h) => town.setStatus(h);
    exit.onClick = () => town.close();
    panel.addChild(exit);
    // Split (VCMI's town screen at 744,382): the picked stack into two, the new part into its army's first free place.
    const split = new DefButton("tsbtns.def", 744, 382, -1, [0, 1, 2, 3]);
    split.hint = tc(3, tr("Split army"));
    split.onHint = (h) => town.setStatus(h);
    split.onClick = async () => void ((await town.army.splitSelected()) || town.setStatus(tr("Pick a stack of two or more first.")));
    panel.addChild(split);
    town.status = block(new GameText("smalfont", [...WHITE] as [number, number, number], "center", 732), "townStatus");
    town.status.position.set(9, 558);
    town.status.label = "status bar: hover line";
    panel.addChild(town.status);
    // Resources along the bottom, like the adventure map.
    panel.addChild(Object.assign(new Sprite(await loadImagePlayer("aresbar.pcx", player)), { x: 3, y: 575, label: "resource bar: resources" }));
    s.players[o.owner]?.resources.forEach((r, i) => {
      const l = label(said(String(r)), "smalfont", WHITE);
      l.position.set(3 + [37, 121, 205, 289, 373, 457, 541][i], 579);
      panel.addChild(l);
    });
    // The player's towns down the right (ITPA, three at a time, as VCMI's CTownList): a click opens that town.
    const towns = ownTowns(s, o.owner);
    this.listScroll = Math.max(0, Math.min(this.listScroll, towns.length - 3));
    const frame = await loadImage("hpsyyy.pcx").catch(() => null);
    towns.slice(this.listScroll, this.listScroll + 3).forEach((x, i) => {
      const item = new Container();
      item.position.set(744, 430 + i * 32);
      void townIcon(x.subid, x.town!.built.includes(B.FORT), !!x.town!.builtToday, "small").then((tex) => tex && !item.destroyed && item.addChildAt(new Sprite(tex), 0));
      if (x.id === o.id && frame) item.addChild(Object.assign(new Sprite(frame), { width: 48 }));
      item.hitArea = new FingerArea(item, 48, 32);
      item.eventMode = "static";
      item.cursor = "pointer";
      item.on("pointertap", () => x.id !== o.id && void town.show(s, w, x.id));
      item.on("pointerover", () => town.setStatus(said(x.name) ?? said("")));
      // The right button (a finger) held: the town's quick view, as the map's town list (VCMI's CTownList).
      item.on("rightdown", (e) => showPopup(() => townQuickView(x, o.owner, w.creatures, upperArmy(s, x)), e.global.x, e.global.y));
      panel.addChild(item);
    });
    const up = new DefButton("iam014.def", 744, 414);
    up.onClick = () => ((this.listScroll = Math.max(0, this.listScroll - 1)), void this.draw(s, w, o));
    const down = new DefButton("iam015.def", 744, 526);
    down.onClick = () => ((this.listScroll += 1), void this.draw(s, w, o));
    up.onHint = down.onHint = (t) => town.setStatus(t);
    panel.addChild(up, down);
    town.panel.removeChildren().forEach((c) => c.destroy({ children: true }));
    town.panel.addChild(panel);
  }

  private button<T extends Container>(sp: T, x: number, y: number, hint: Text, fn: () => void, help = hint): T {
    sp.position.set(x, y);
    // Touch screens: a finger's tap, a little past the original's small pictures.
    if (!(sp instanceof DefButton)) {
      const r = sp.getLocalBounds();
      if (r.width > 0) sp.hitArea = new FingerArea(sp, r.width, r.height, r.x, r.y);
    }
    sp.eventMode = "static";
    sp.cursor = "pointer";
    // Left click acts; a right click only explains, while held (it opened the window and left it open).
    sp.on("pointertap", (e) => e.button === 0 && fn());
    sp.on("pointerover", () => this.town.setStatus(hint));
    let hide: (() => void) | null = null;
    sp.on("rightdown", (e) => DefButton.showHelp && (hide = DefButton.showHelp(help, e.global.x, e.global.y)));
    const up = () => (hide?.(), (hide = null));
    sp.on("pointerup", up).on("pointerupoutside", up);
    return sp;
  }
}
