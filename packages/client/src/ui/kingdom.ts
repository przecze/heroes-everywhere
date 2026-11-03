// The original Kingdom Overview (OVCAST.PCX): four heroes or towns at a time, mines and owned
// dwellings, total income and resources. Positions follow VCMI's CKingdomInterface.
import { artifactHold } from "./artifactHold.ts";
import { heroPortraitHold } from "./heroPortraitHold.ts";
import { gameTexts } from "./highScores.ts";
import { hallLevel, fortLevel, upperArmy, type AdventureState, type AdvObject, dailyIncome, type World, visitingHero, weeklyGrowth, type CreatureStats, type Hero, TOWNS, dwellingId, effectivePrimary, experienceForLevel, maxMana, townIncome, dateParts } from "@heroes/core";
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { heroPortrait, loadDef, specialtyIcon, townIcon, townPortraitFrame } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { DefButton, label, loadImagePlayer } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { infoArea } from "./dialogs.ts";
import { StackGrid } from "./blocks/stackGrid.ts";
import { infoCard } from "./stackWindow.ts";
import { objectName } from "../map/describe.ts";
import { phoneSized } from "./screen.ts";
import { resolveText } from "./gameText.ts";
import { mobileKingdom } from "./mobileKingdom.ts";
import { skillInfo } from "./skillHelp.ts";
import { tr, said, fallback, fmt, type Text } from "../i18n/index.ts";
import { showPopup } from "./creatureInfo.ts";
import { townQuickView } from "./quickView.ts";
import { townName } from "../i18n/towns.ts";

const DWELLS = 7;
const ROWS = 4;
const ROW_H = 116;
const FOOTER = ROWS * ROW_H;

export interface KingdomOptions {
  state: () => AdventureState;
  player: number;
  creatures: CreatureStats[];
  artifacts: { name: string; description?: string }[];
  openHero: (id: number) => void;
  openTown: (id: number) => void;
  /** The world: the towns' weekly growth, the visiting heroes, the income. */
  world: () => World;
  /** Morale and luck as the battle would count them. */
  moraleLuck: (h: Hero) => { morale: number; luck: number };
}

/** The owned-objects column (VCMI's generateObjectsList): FLAGPORT frame, how many, and the name. Dwellings by creature, then
 * the garrisons (anti-magic too), the lighthouse and the harbour. */
export function ownedObjects(s: AdventureState, player: number, creatures: CreatureStats[], artifacts: KingdomOptions["artifacts"]): [number, { n: number; name: string }][] {
  const owned = new Map<number, { n: number; name: string }>();
  const add = (key: number, name: string) => owned.set(key, { n: (owned.get(key)?.n ?? 0) + 1, name: owned.get(key)?.name ?? name });
  for (const t of s.objects) {
    if (t.removed || t.owner !== player) continue;
    if (t.type === 17) add(t.subid, objectName(t, creatures, artifacts));
    else if (t.type === 33 || t.type === 219) add(t.subid === 1 ? 84 : 83, objectName(t, creatures, artifacts));
    else if (t.type === 42) add(82, objectName(t, creatures, artifacts));
    else if (t.type === 87) add(87, objectName(t, creatures, artifacts));
  }
  return [...owned].sort((a, b) => a[0] - b[0]);
}

export async function kingdomOverview(modals: Modals, o: KingdomOptions): Promise<void> {
  // Phones get a page of their own: big rows a finger scrolls.
  if (phoneSized()) return mobileKingdom(modals, o);
  const p = Math.max(0, o.player);
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer("ovcast.pcx", p)));
  const [ovslot, pskil, secsk, arts, ovmines, itpt, itmtl, itmcl, flagport, imrl, ilck] = await Promise.all(
    ["ovslot.def", "pskil32.def", "secsk32.def", "artifact.def", "ovmines.def", "itpt.def", "itmtl.def", "itmcl.def", "flagport.def", "imrl22.def", "ilck22.def"].map((d) =>
      loadDef(d).catch(() => new Map()),
    ),
  );
  const frame = (d: Awaited<ReturnType<typeof loadDef>>, i: number) => d.get(0)?.[i]?.texture;
  const tab = new Container();
  tab.position.set(4, 4);
  win.addChild(tab);
  let showing: "heroes" | "towns" = "heroes";
  let scroll = 0;

  // The armies are the shared stack row, only to look at: a long press opens a stack's card.
  const army = async (c: Container, slots: ({ creature: number; count: number } | null)[], x: number, y: number, at?: (i: number) => readonly [number, number]) => {
    const grid = new StackGrid(
      { size: "small", at: Array.from({ length: 7 }, (_, i) => at?.(i) ?? ([i * 36, 0] as const)), count: "corner" },
      { creatures: o.creatures, card: infoCard(modals, o.player, o.creatures, () => slots) },
    );
    await grid.set(slots);
    grid.position.set(x, y);
    c.addChild(grid);
  };

  /** Closes the overview (set once it is shown): a town opens on the map's screen, not under it. */
  let leave = () => {};
  /** Which artifact page each hero row shows. */
  const artPage = new Map<number, number>();
  /** Where each hero's backpack page starts. */
  const bagScroll = new Map<number, number>();
  // OVERVIEW.TXT: the column titles and captions.
  const overview = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((id) => resolveText({ file: "overview", id }).then((t) => t ?? "")));
  const heroRow = async (h: Hero, row: Container) => {
    row.addChild(new Sprite(frame(ovslot, 4)));
    const portrait = new Sprite(await heroPortrait(h));
    portrait.position.set(5, 6);
    portrait.eventMode = "static";
    portrait.cursor = "pointer";
    portrait.on("pointertap", (e) => e.button !== 2 && o.openHero(h.id));
    heroPortraitHold(portrait, () => o.openHero(h.id));
    row.addChild(portrait);
    const name = label(fmt`${said(h.name)}`, "smalfont", WHITE);
    name.position.set(73, 7);
    row.addChild(name);
    const prim = effectivePrimary(h);
    for (let i = 0; i < 4; i++) {
      const pic = row.addChild(Object.assign(new Sprite(frame(pskil, i)), { x: 78 + i * 36, y: 26 }));
      // A tap or the right button held: what the skill does (ARRAYTXT, as the hero screen's).
      infoArea(modals, pic, p, () => resolveText({ file: "arraytxt", id: 2 + i }));
      // VCMI's InfoBox (SIZE_SMALL: the small font), the value centred 8 under the picture.
      const v = label(said(String(prim[i])), "smalfont", WHITE, "center", 40);
      v.position.set(78 + i * 36 - 4, 26 + 33);
      row.addChild(v);
    }
    // Spell points, experience and specialty along the top, morale and luck by the skills (VCMI's CHeroItem).
    const box = (tex: Texture | undefined, x: number, y: number, value?: Text, about?: () => Promise<Text | null>) => {
      if (tex) {
        const pic = row.addChild(Object.assign(new Sprite(tex), { x, y }));
        if (about) infoArea(modals, pic, p, about);
      }
      if (value === undefined) return;
      // POS_INSIDE: the value centred 6 above the picture's bottom.
      const v = label(value, "smalfont", WHITE, "center", 40);
      v.position.set(x - 4, y + 19);
      row.addChild(v);
    };
    box(frame(pskil, 5), 280, 5, fmt`${h.mana ?? 0}/${maxMana(h)}`, () => resolveText({ file: "genrltxt", id: 205, args: [h.name, h.mana ?? 0, maxMana(h)] }));
    box(frame(pskil, 4), 330, 5, said(String(h.experience)), () => resolveText({ file: "genrltxt", id: 2, args: [h.level, experienceForLevel(h.level + 1), h.experience] }));
    box(await specialtyIcon(h.type, "small"), 375, 5);
    const ml = o.moraleLuck(h);
    // VCMI's MoraleLuckBox (30x22 at 225, 28 / 53): the small picture in its middle.
    box(frame(ilck, ml.luck + 3), 225 + 4, 28 + 5);
    box(frame(imrl, ml.morale + 3), 225 + 4, 53 + 5);
    // Secondary skills along the top right.
    (h.skills ?? []).slice(0, 8).forEach(([skill, level], i) => {
      const t = frame(secsk, skill * 3 + level + 2);
      if (!t) return;
      const sp = row.addChild(Object.assign(new Sprite(t), { x: 410 + i * 36, y: 5 }));
      // A tap or the right button held: the skill's description, as on the hero screen.
      skillInfo(modals, sp, p, skill, level);
    });
    // Artifacts in three pages, as the original: worn (the first nine slots), the rest (misc and
    // war machines), the backpack; OVBUTN3 tabs labelled from GENRLTXT 259 / 261 / 262.
    const page = artPage.get(h.id) ?? 0;
    // VCMI's ArtSlotsTab / BackpackTab: nine full-size places from (269, 66), 48 apart, on OVSLOT 4; the
    // backpack shows eight from 294 between its arrows on OVSLOT 5.
    if (page === 2) {
      const bg = frame(ovslot, 5);
      if (bg) row.addChild(new Sprite(bg));
      const bag = h.backpack ?? [];
      const from = Math.max(0, Math.min(bagScroll.get(h.id) ?? 0, bag.length - 8));
      const left = new DefButton("hsbtns3.def", 269, 66, -1);
      left.onClick = () => (bagScroll.set(h.id, Math.max(0, from - 1)), void drawTab());
      const right = new DefButton("hsbtns5.def", 675, 66, -1);
      right.onClick = () => (bagScroll.set(h.id, from + 1), void drawTab());
      row.addChild(left, right);
      bag.slice(from, from + 8).forEach((a, i) => {
        const f = a >= 0 ? arts.get(0)?.[a] : undefined;
        if (f) artifactHold(row.addChild(Object.assign(new Sprite(f.texture), { x: 294 + i * 48 + f.x, y: 66 + f.y })), o.player, o, a, h);
      });
    } else {
      (h.equipped ?? []).slice(page * 9, page * 9 + 9).forEach((a, i) => {
        const f = a >= 0 ? arts.get(0)?.[a] : undefined;
        if (f) artifactHold(row.addChild(Object.assign(new Sprite(f.texture), { x: 269 + i * 48 + f.x, y: 66 + f.y })), o.player, o, a, h);
      });
    }
    const artsText = label(overview[2] || fallback("Artifacts"), "smalfont", WHITE).centreOn(320, 55);
    row.addChild(artsText);
    const names = (await gameTexts()).general;
    [259, 261, 262].forEach((textId, k) => {
      const b = new DefButton("ovbutn3.def", 364 + k * 112, 46, -1, k === page ? [1, 1, 2, 3] : [0, 1, 2, 3]);
      b.onClick = () => {
        artPage.set(h.id, k);
        void drawTab();
      };
      const caption = label(names[textId] ?? said(["Equipped", "Misc", "Backpack"][k]), "smalfont", YELLOW, "center", 108);
      caption.position.set(0, 3);
      caption.eventMode = "none";
      b.addChild(caption);
      row.addChild(b);
    });
    await army(row, h.army, 6, 78);
  };

  const townRow = async (id: number, row: Container) => {
    const s = o.state();
    const t = s.objects[id];
    const town = t.town!;
    row.addChild(new Sprite(frame(ovslot, 6)));
    const fort = fortLevel(town.built);
    const icon = new Sprite((await townIcon(t.subid, fort > 0, false, "large")) ?? frame(itpt, townPortraitFrame(t.subid, !!fort)));
    icon.position.set(5, 6);
    icon.eventMode = "static";
    icon.cursor = "pointer";
    icon.on("pointertap", (e) => e.button !== 2 && (leave(), o.openTown(id)));
    // The right button (a finger) held: the town's quick view, as the town lists.
    icon.on("rightdown", (e) => showPopup(() => townQuickView(t, o.player, o.world().creatures, upperArmy(s, t)), e.global.x, e.global.y));
    row.addChild(icon);
    const faction = TOWNS[t.subid]?.faction ?? "town";
    const name = label(said(t.name) ?? townName(faction), "smalfont", WHITE);
    name.position.set(74, 8);
    row.addChild(name);
    const hall = hallLevel(town.built);
    const hallIcon = frame(itmtl, Math.max(0, hall));
    if (hallIcon) row.addChild(Object.assign(new Sprite(hallIcon), { x: 69, y: 31 }));
    const fortIcon = frame(itmcl, fort ? fort - 1 : 3);
    if (fortIcon) row.addChild(Object.assign(new Sprite(fortIcon), { x: 111, y: 31 }));
    const income = label(said(String(townIncome(t)[6])), "smalfont", WHITE).centreOn(190, 60);
    row.addChild(income);
    // The garrison and the visiting hero's army in two rows of four and three (VCMI's CGarrisonInt at
    // 313, 3, TWO_ROWS, the visiting army 232 further right), the heroes' portraits at 244 and 475.
    const twoRows = (slots: ({ creature: number; count: number } | null)[], x: number) => army(row, slots, x, 0, (i) => (i < 4 ? [36 * i, 3] : [18 + 36 * (i - 4), 39]));
    await twoRows(upperArmy(s, t), 313);
    const visitor = visitingHero(s, o.world(), t);
    const garrisonHero = s.heroes.find((h) => !h.removed && h.garrison === id);
    for (const [h, x, ax] of [[garrisonHero, 244, 313], [visitor, 475, 545]] as const) {
      if (!h) continue;
      const pic = new Sprite(await heroPortrait(h));
      pic.position.set(x, 6);
      pic.eventMode = "static";
      pic.cursor = "pointer";
      pic.on("pointertap", (e) => e.button !== 2 && o.openHero(h.id));
      heroPortraitHold(pic, () => o.openHero(h.id));
      row.addChild(pic);
      if (h === visitor) await twoRows(h.army, ax);
    }
    // Creatures ready to recruit in each dwelling, then the week's growth (VCMI's CCreaInfo, compact: the portrait 8 in,
    // its number in the corner; ready from 48, growth from 401): the shared stack row, a long press the creature's card.
    const info = TOWNS[t.subid];
    const levels = Array.from({ length: 7 }, (_, lvl) => {
      const pair = info?.creatures[lvl];
      if (!pair || !town.built.includes(dwellingId(lvl))) return null;
      return town.built.includes(dwellingId(lvl, true)) ? pair[1] : pair[0];
    });
    const at = (i: number) => [8 + 37 * i, 0] as const;
    await army(row, levels.map((c, lvl) => (c === null ? null : { creature: c, count: town.available[lvl] ?? 0 })), 48, 78, at);
    await army(row, levels.map((c, lvl) => {
      const n = c === null ? null : weeklyGrowth(o.world(), t, lvl, s);
      return c === null || n === null ? null : { creature: c, count: n };
    }), 401, 78, at);
  };

  const drawTab = async () => {
    tab.removeChildren().forEach((c) => c.destroy({ children: true }));
    const s = o.state();
    const title = new Sprite(await loadImagePlayer("ovtitle.pcx", p));
    title.position.set(16, 0);
    tab.addChild(title);
    // VCMI's CKingdHeroList / CKingdTownList: OVERVIEW.TXT 0-1 and 3-5.
    const heads = showing === "heroes"
      ? [[overview[0] || fallback("Hero/Stats"), 150], [overview[1] || fallback("Skills"), 500]]
      : [[overview[3] || fallback("Town"), 146], [overview[4] || fallback("Garrison Hero"), 375], [overview[5] || fallback("Visiting Hero"), 608]];
    for (const [t, x] of heads) {
      // (VCMI's CENTER labels on these points, as the other texts here.)
      const l = label(said(String(t)), "medfont", WHITE).centreOn(Number(x), 10);
      tab.addChild(l);
    }
    const items = showing === "heroes" ? s.heroes.filter((h) => !h.removed && h.owner === o.player).map((h) => h.id) : s.objects.filter((t) => t.town && !t.removed && t.owner === o.player).map((t) => t.id);
    scroll = Math.max(0, Math.min(scroll, items.length - ROWS));
    for (let i = 0; i < ROWS; i++) {
      const row = new Container();
      row.position.set(19, 21 + i * ROW_H);
      tab.addChild(row);
      const id = items[scroll + i];
      if (id === undefined) {
        row.addChild(new Sprite(frame(ovslot, i % 4)));
        continue;
      }
      if (showing === "heroes") await heroRow(s.heroes[id], row);
      else await townRow(id, row);
    }
  };

  // Footer: mines, income, resources.
  const general = (await gameTexts()).general;
  let dwellScroll = 0;
  // The status bar (KSTATBAR at 10, 555): what the pointer is over.
  const statusBar = await loadImagePlayer("kstatbar.pcx", p).catch(() => null);
  const status = label(said(""), "smalfont", WHITE, "center", 780);
  if (statusBar) win.addChild(Object.assign(new Sprite(statusBar), { x: 10, y: FOOTER + 91 }));
  status.position.set(10, FOOTER + 93);
  win.addChild(status);
  const hoverArea = (c: Container, text: Text) => {
    c.eventMode = "static";
    c.on("pointerover", () => (status.value = text));
    c.on("pointerout", () => (status.value = said("")));
  };
  const resBar = await loadImagePlayer("kresbar.pcx", p).catch(() => null);
  const footer = new Container();
  win.addChild(footer);
  const drawFooter = () => {
    footer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const s = o.state();
    const mines = [0, 0, 0, 0, 0, 0, 0];
    for (const t of s.objects) if (!t.removed && t.owner === o.player && t.type === 53 && t.subid < 7) mines[t.subid]++;
    // Everything that makes gold a day: mines, towns, the heroes' skills, specialties and artifacts (VCMI's total).
    const income = dailyIncome(s, o.world(), o.player)[6];
    mines.forEach((n, i) => {
      // OVMINES is 68 x 54 with trimmed frames: each at its place in the box; the count inside it,
      // centred 6 above its bottom (VCMI's InfoBox POS_INSIDE).
      const f = ovmines.get(0)?.[i];
      if (f) footer.addChild(Object.assign(new Sprite(f.texture), { x: 20 + i * 80 + f.x, y: 31 + FOOTER + f.y }));
      const l = label(said(String(n)), "smalfont", WHITE).centreOn(20 + i * 80 + 34, 31 + FOOTER + 48);
      footer.addChild(l);
    });
    const inc = label(said(String(income)), "smalfont", WHITE);
    inc.position.set(628, FOOTER + 70);
    footer.addChild(inc);
    // The resource bar (VCMI's CResDataBar: KRESBAR at 7, 111 below the rows; amounts from 29 in, 76 apart; the date 81 past the last).
    if (resBar) footer.addChild(Object.assign(new Sprite(resBar), { x: 7, y: 111 + FOOTER }));
    s.players[o.player]?.resources.forEach((n, i) => {
      const l = label(said(String(n)), "smalfont", WHITE);
      l.position.set(7 + 29 + i * 76, 111 + FOOTER + 4);
      footer.addChild(l);
    });
    const date = label(tr(`Month: %1, Week: %2, Day: %3`, ...dateParts(s.day)), "smalfont", WHITE);
    date.position.set(7 + 29 + 6 * 76 + 81, 111 + FOOTER + 4);
    footer.addChild(date);
    // Owned dwellings down the right side, then the special objects VCMI lists (garrisons, the lighthouse, the
    // harbour), each a picture with its count and its name on hover (generateObjectsList); the arrows scroll.
    const list = ownedObjects(s, o.player, o.creatures, o.artifacts);
    dwellScroll = Math.max(0, Math.min(dwellScroll, list.length - DWELLS));
    list.slice(dwellScroll, dwellScroll + DWELLS).forEach(([key, d], i) => {
      const t = frame(flagport, key);
      const box = new Container();
      box.position.set(740, 44 + i * 57);
      if (t) box.addChild(new Sprite(t));
      const l = label(said(String(d.n)), "smalfont", WHITE, "center", 50);
      l.position.set(0, 40);
      box.addChild(l);
      box.addChild(new Graphics().rect(0, 0, 50, 57).fill({ color: 0, alpha: 0.001 }));
      hoverArea(box, said(d.name));
      footer.addChild(box);
    });
    // The mines and the income answer on the status bar (the mines' boxes ignore clicks, VCMI's #890).
    mines.forEach((_, i) => {
      const z = new Container();
      z.addChild(new Graphics().rect(0, 0, 68, 54).fill({ color: 0, alpha: 0.001 }));
      z.position.set(20 + i * 80, 31 + FOOTER);
      hoverArea(z, objectName({ type: 53, subid: i } as AdvObject, o.creatures, o.artifacts));
      footer.addChild(z);
    });
    const incomeArea = new Container();
    incomeArea.addChild(new Graphics().rect(0, 0, 136, 68).fill({ color: 0, alpha: 0.001 }));
    incomeArea.position.set(580, 31 + FOOTER);
    hoverArea(incomeArea, general[255] || fallback("Daily Income"));
    footer.addChild(incomeArea);
  };

  await drawTab();
  drawFooter();
  return new Promise((resolve) => {
    let close = () => {};
    const done = () => (close(), resolve());
    leave = done;
    const heroes = new DefButton("ovbutn1.def", 748, 28 + FOOTER, p);
    heroes.onClick = () => {
      showing = "heroes";
      scroll = 0;
      void drawTab();
    };
    const towns = new DefButton("ovbutn6.def", 748, 64 + FOOTER, p);
    towns.onClick = () => {
      showing = "towns";
      scroll = 0;
      void drawTab();
    };
    const exit = new DefButton("ovbutn1.def", 748, 99 + FOOTER, p, [3, 4, 5, 6]);
    exit.onClick = done;
    win.addChild(heroes, towns, exit);
    // The owned objects' arrows (VCMI's OVBUTN4: top, up, down, bottom).
    const arrow = (y: number, order: number[], by: (n: number) => number) => {
      const b = new DefButton("ovbutn4.def", 733, y, p, order);
      b.onClick = () => ((dwellScroll = by(dwellScroll)), drawFooter());
      win.addChild(b);
    };
    arrow(4, [0, 1, 2, 3], () => 0);
    arrow(24, [4, 5, 6, 7], (n) => n - 1);
    arrow(FOOTER - 18, [6, 7, 8, 9], (n) => n + 1);
    arrow(FOOTER + 2, [2, 3, 4, 5], () => 1e6);
    // The pointer over the buttons: their words on the status bar (OVERVIEW 11-12 and 6-7, GENRLTXT 600).
    heroes.hint = overview[11] || tr("Show Heroes");
    towns.hint = overview[12] || tr("Show Towns");
    exit.hint = general[600] || tr("Exit");
    heroes.help = said(overview[6]);
    towns.help = said(overview[7]);
    for (const b of [heroes, towns, exit]) b.onHint = (t) => (status.value = t);
    win.eventMode = "static";
    win.on("wheel", (e) => {
      scroll += e.deltaY > 0 ? 1 : -1;
      void drawTab();
    });
    close = modals.show(win, {
      x: 0,
      y: 0,
      onKey: (k) => {
        if (k === "Escape" || k === "Enter") done();
        else if (k === "ArrowDown") (scroll++, void drawTab());
        else if (k === "ArrowUp") (scroll--, void drawTab());
        // VCMI's kingdomHeroesTab / kingdomTownsTab.
        else if (k === "h") heroes.onClick();
        else if (k === "t") towns.onClick();
        return true;
      },
    });
  });
}
