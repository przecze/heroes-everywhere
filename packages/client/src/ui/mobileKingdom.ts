// The Kingdom Overview on a phone: the original's four small rows at a time are unreadable there
// and only scroll with a wheel. Tabs down the left (heroes, towns, income); on the right a list of
// big rows a finger drags; a tap on a row opens that hero or town.
import { heroPortraitHold } from "./heroPortraitHold.ts";
import { fortLevel, upperArmy, type CreatureStats, dailyIncome, type Hero, TOWNS, dwellingId, effectivePrimary, maxMana, townIncome } from "@heroes/core";
import { heroClassName } from "./gameText.ts";
import { Container, Graphics, Sprite } from "pixi.js";
import { heroPortrait, loadDef, townIcon, townPortraitFrame } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { type Modals } from "./modals.ts";
import { type KingdomOptions, ownedObjects } from "./kingdom.ts";
import { StackGrid } from "./blocks/stackGrid.ts";
import { OVSLOT_HERO, part, tiledPart } from "./blocks/windowParts.ts";
import { infoCard } from "./stackWindow.ts";
import { bigText, contentArea, openPage, scrollList, columnTitle, columnTabs, columnFoot } from "./mobilePage.ts";
import { tr, said, fmt } from "../i18n/index.ts";
import { showPopup } from "./creatureInfo.ts";
import { townQuickView } from "./quickView.ts";
import { townName } from "../i18n/towns.ts";

type Tab = "heroes" | "towns" | "income";
// (The hero row: the army row at 74 with its counts to 154 inside the box, which is 10 less than this.)
const ROW_H = 168;
/** The income page's cells: a mine, how many, the resource and the treasury's amount. */
const CELL_H = 150;
/** Primary skills and spell points beside the name need this much room; narrower, they go under the army. */
const STATS_X = 430;
const STATS_W = 380;

export async function mobileKingdom(modals: Modals, o: KingdomOptions): Promise<void> {
  const shell = await openPage(modals, { keys: (k) => (k === "h" || k === "t") && ((tab = k === "h" ? "heroes" : "towns"), void draw()), draw: () => draw() });
  const [pskil, itpt, resource, ovmines, flagport] = await Promise.all(["pskil32.def", "itpt.def", "resource.def", "ovmines.def", "flagport.def"].map((d) => loadDef(d).catch(() => new Map())));
  const frame = (d: Awaited<ReturnType<typeof loadDef>>, i: number) => d.get(0)?.[i]?.texture;
  let area = contentArea();
  // Narrow (upright): the hero rows taller, the stats under the army.
  let narrow = STATS_X + STATS_W > area.w;
  let rowH = narrow ? ROW_H + 80 : ROW_H;
  let tab: Tab = "heroes";
  const offsets: Record<Tab, number> = { heroes: 0, towns: 0, income: 0 };
  let list: ReturnType<typeof scrollList> | null = null;

  /** Up to seven stacks in a row: the shared stack row at 1.5x (48-pixel portraits, the counts under them); a long press opens a stack's card. */
  const armyRow = async (slots: ({ creature: number; count: number } | null)[], creatures: CreatureStats[]) => {
    // (Each stack on the desktop row's own army box, OVSLOT's.)
    const grid = new StackGrid({ size: "small", packed: true, gap: 5, count: "below", countFont: "medfont", boxes: { pic: OVSLOT_HERO, name: "army", player: o.player } }, { creatures, card: infoCard(modals, o.player, creatures, () => slots) });
    await grid.set(slots);
    grid.scale.set(1.5);
    return grid;
  };

  /** The desktop row's own leather (OVSLOT's) under a phone row, its edge darkened as the original's. */
  const rowBox = async (onTap: () => void) => {
    const row = new Container();
    const ground = await tiledPart(OVSLOT_HERO, "ground", o.player, area.w, rowH - 10);
    if (ground) row.addChild(ground, new Graphics().rect(0.5, 0.5, area.w - 1, rowH - 11).stroke({ color: 0x1a0f05, width: 2 }));
    else row.addChild(new Graphics().rect(0, 0, area.w, rowH - 10).fill({ color: 0, alpha: 0.45 }).stroke({ color: 0xc9a046, width: 1 }));
    row.eventMode = "static";
    // One-handed: a slot of the page's grid, which stays where it is (touchcheck's handGrid).
    (row as Container & { handGrid?: boolean }).handGrid = true;
    row.cursor = "pointer";
    row.on("pointertap", (e) => e.button !== 2 && !list?.moved() && onTap());
    return row;
  };

  const heroRow = async (h: Hero) => {
    const row = await rowBox(() => (done(), o.openHero(h.id)));
    // The desktop row's boxes: the portrait's, the name's (round the name and the level).
    const [pbox, nbox] = await Promise.all([part(OVSLOT_HERO, "portrait", o.player, 92, 100), part(OVSLOT_HERO, "name", o.player, 312, 72)]);
    if (pbox) row.addChild(Object.assign(pbox, { x: 8, y: 8 }));
    if (nbox) row.addChild(Object.assign(nbox, { x: 104, y: 4 }));
    const portrait = await heroPortrait(h).catch(() => null);
    if (portrait) heroPortraitHold(row.addChild(Object.assign(new Sprite(portrait), { x: 10, y: 10, scale: { x: 1.5, y: 1.5 } })), () => (done(), o.openHero(h.id)));
    const cls = await heroClassName(h.heroClass, h);
    row.addChild(Object.assign(bigText(said(h.name), "bigfont", YELLOW, 1.5, { w: 300 }), { x: 112, y: 8 }));
    row.addChild(Object.assign(bigText(tr(`Level %1 %2`, h.level, cls), "medfont", WHITE, 1.5, { w: 300 }), { x: 112, y: 42 }));
    // Primary skills and spell points along the right of the name.
    const prim = effectivePrimary(h);
    const stats = new Container();
    stats.position.set(narrow ? 112 : STATS_X, narrow ? 150 : 8);
    for (let i = 0; i < 4; i++) {
      const vbox = await part(OVSLOT_HERO, "value", o.player, 52, 26);
      if (vbox) stats.addChild(Object.assign(vbox, { x: i * 70 - 2, y: 50 }));
      const t = frame(pskil, i);
      if (t) stats.addChild(Object.assign(new Sprite(t), { x: i * 70, scale: { x: 1.5, y: 1.5 } }));
      stats.addChild(Object.assign(bigText(said(String(prim[i])), "medfont", WHITE, 1.5, { w: 48, center: true }), { x: i * 70, y: 50 }));
    }
    const spBox = await part(OVSLOT_HERO, "value", o.player, 90, 26);
    if (spBox) stats.addChild(Object.assign(spBox, { x: 4 * 70 - 2, y: 50 }));
    const sp = frame(pskil, 5);
    if (sp) stats.addChild(Object.assign(new Sprite(sp), { x: 4 * 70, scale: { x: 1.5, y: 1.5 } }));
    stats.addChild(Object.assign(bigText(fmt`${h.mana ?? 0}/${maxMana(h)}`, "medfont", WHITE, 1.5, { w: 90 }), { x: 4 * 70, y: 50 }));
    row.addChild(stats);
    const army = await armyRow(h.army, o.creatures);
    army.position.set(112, 74);
    row.addChild(army);
    return row;
  };

  const townRow = async (id: number) => {
    const t = o.state().objects[id];
    const town = t.town!;
    const row = await rowBox(() => (done(), o.openTown(id)));
    const ibox = await part(OVSLOT_HERO, "portrait", o.player, 92, 100);
    if (ibox) row.addChild(Object.assign(ibox, { x: 8, y: 6 }));
    const fort = fortLevel(town.built) > 0;
    const icon = (await townIcon(t.subid, fort, false, "large")) ?? frame(itpt, townPortraitFrame(t.subid, !!fort));
    if (icon) row.addChild(Object.assign(new Sprite(icon), { x: 10, y: 10, scale: { x: 1.5, y: 1.5 } }));
    // A long tap: the town's quick view while held, as the town lists.
    row.on("rightdown", (e) => showPopup(() => townQuickView(t, o.player, o.world().creatures, upperArmy(o.state(), t)), e.global.x, e.global.y));
    const faction = TOWNS[t.subid]?.faction ?? "town";
    row.addChild(Object.assign(bigText(said(t.name) ?? townName(faction), "bigfont", YELLOW, 1.5, { w: 300 }), { x: 112, y: 8 }));
    row.addChild(Object.assign(bigText(tr(`+%1 gold a day`, townIncome(t)[6]), "medfont", WHITE, 1.5, { w: 300 }), { x: 112, y: 42 }));
    // Ready to recruit: each built dwelling's creature and how many wait.
    const ready: { creature: number; count: number }[] = [];
    const info = TOWNS[t.subid];
    for (let lvl = 0; lvl < 7; lvl++) {
      const pair = info?.creatures[lvl];
      if (pair && town.built.includes(dwellingId(lvl))) ready.push({ creature: town.built.includes(dwellingId(lvl, true)) ? pair[1] : pair[0], count: town.available[lvl] ?? 0 });
    }
    const avail = await armyRow(ready, o.creatures);
    avail.position.set(112, 74);
    row.addChild(avail);
    return row;
  };

  const incomePage = () => {
    const s = o.state();
    const c = new Container();
    const mines = [0, 0, 0, 0, 0, 0, 0];
    for (const t of s.objects) if (!t.removed && t.owner === o.player && t.type === 53 && t.subid < 7) mines[t.subid]++;
    const gold = dailyIncome(s, o.world(), o.player)[6];
    const res = s.players[o.player]?.resources ?? [];
    // As the desktop's strip: each mine's picture with how many are yours, the treasury's gold pile with the day's gold;
    // under each, the resource and what the treasury holds (no words, as the owner asked: icons).
    const cols = area.w >= 8 * 100 ? 8 : 4;
    const cellW = Math.floor(area.w / cols);
    [0, 1, 2, 3, 4, 5, 6, 7].forEach((r, i) => {
      const x = (i % cols) * cellW;
      const y = Math.floor(i / cols) * CELL_H;
      // (OVMINES' frames are trimmed: each at its place in the 68 x 54 box. The last cell is the day's gold: RESOURCE's.)
      const mine = r < 7 ? ovmines.get(0)?.[r] : undefined;
      const left = x + Math.round((cellW - 68 * 1.2) / 2);
      if (mine) c.addChild(Object.assign(new Sprite(mine.texture), { x: left + mine.x * 1.2, y: y + mine.y * 1.2, scale: { x: 1.2, y: 1.2 } }));
      const pile = r === 7 ? frame(resource, 6) : undefined;
      if (pile) c.addChild(Object.assign(new Sprite(pile), { x: left + 10, y: y + 4, scale: { x: 2, y: 2 } }));
      const n = r === 7 ? fmt`+${gold}` : said(String(mines[r]));
      c.addChild(Object.assign(bigText(n, "medfont", r === 7 || mines[r] ? YELLOW : WHITE, 1.5, { w: cellW, center: true }), { x, y: y + 68 }));
      const ri = r === 7 ? 6 : r;
      const icon = frame(resource, ri);
      if (r !== 6 && icon) {
        c.addChild(Object.assign(new Sprite(icon), { x: x + 8, y: y + 100, scale: { x: 1.2, y: 1.2 } }));
        c.addChild(Object.assign(bigText(said(String(res[ri] ?? 0)), "medfont", WHITE, 1.5, { w: cellW - 52 }), { x: x + 50, y: y + 108 }));
      }
    });
    // The owned dwellings, garrisons, lighthouse and harbour the desktop lists down its right side (VCMI's generateObjectsList).
    const owned = ownedObjects(s, o.player, o.creatures, o.artifacts);
    let y = Math.ceil(8 / cols) * CELL_H + 10;
    if (owned.length) c.addChild(Object.assign(bigText(tr("Owned objects"), "bigfont", YELLOW, 1.5), { y }));
    y += 50;
    for (const [key, d] of owned) {
      const icon = frame(flagport, key);
      if (icon) c.addChild(Object.assign(new Sprite(icon), { x: 0, y, scale: { x: 1, y: 1 } }));
      c.addChild(Object.assign(bigText(fmt`${d.n} × ${said(d.name)}`, "medfont", WHITE, 1.5, { w: area.w - 80 }), { x: 70, y: y + 14 }));
      y += 62;
    }
    return c;
  };

  const draw = async () => {
    // The layout now (the phone may have turned).
    area = contentArea();
    narrow = STATS_X + STATS_W > area.w;
    rowH = narrow ? ROW_H + 80 : ROW_H;
    const s = o.state();
    const parts = new Container();
    const col = new Container();
    col.addChild(columnTitle(tr("Kingdom"), 2));
    const tabs: [Tab, string][] = [["heroes", "Heroes"], ["towns", "Towns"], ["income", "Income"]];
    col.addChild(
      await columnTabs(
        tabs.map(([t, name]) => [
          name,
          () => {
            if (list) offsets[tab] = list.offset();
            tab = t;
            void draw();
          },
          t === tab,
        ]),
        170,
      ),
    );
    col.addChild(await columnFoot([[tr("Close"), () => done()]]));
    parts.addChild(col);
    if (tab === "income") {
      // (Taller than a phone with the owned objects: a list a finger drags.)
      list = scrollList(incomePage(), area, offsets.income);
      parts.addChild(list.view);
    } else {
      const content = new Container();
      const ids = tab === "heroes" ? s.heroes.filter((h) => !h.removed && h.owner === o.player).map((h) => h.id) : s.objects.filter((t) => t.town && !t.removed && t.owner === o.player).map((t) => t.id);
      for (const [i, id] of ids.entries()) {
        const row = tab === "heroes" ? await heroRow(s.heroes[id]) : await townRow(id);
        row.y = i * rowH;
        content.addChild(row);
      }
      if (!ids.length) content.addChild(bigText(tab === "heroes" ? tr("You have no heroes.") : tr("You have no towns."), "medfont", WHITE, 2));
      list = scrollList(content, area, offsets[tab]);
      parts.addChild(list.view);
    }
    shell.setContent(parts);
  };

  const done = () => shell.close();
  await draw();
  return shell.show();
}
