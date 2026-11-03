// New Game on a phone, in the original's own look rather than a web page: HotA's blue backdrop over
// the whole screen, gold letters, the original's buttons (size filters, the chess-piece difficulty,
// Begin and Back), the scenario list in rows a finger can hit, the chosen scenario's card beside it,
// and the advanced options with the original's town, hero and bonus arrows (a tap or a long press on the town or the hero
// opens HotA's grid to pick from: setupBlocks.ts, the computer's window has the same). No minimap preview (the original
// has none either). One layout for every touch screen (sideways, upright, tablet): no one-handed variant for the setup.
import { RANDOM_MAP_SIZES, rmgKey, rmgTemplateFacts, rmgTitle } from "@heroes/core";
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { playMusic } from "../audio.ts";
import { townName } from "../i18n/towns.ts";
import { loadDef, loadImage, loadPng } from "../assets.ts";
import { loadData } from "../gameData.ts";
import { extra } from "../settings.ts";
import { formatIcon, hotaContentCheck, pickHero, pickTown, rulesScroll, setHotaContent, startHeroIcon, startHeroes, startTownIcon, startTowns, tapOrHold } from "./blocks/setupBlocks.ts";
import { WHITE, YELLOW } from "../text.ts";
import { DefButton, helpRow, loadButtonHelp } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { messageBox } from "./dialogs.ts";
import { K, gspButton, menuRooms, panelBack, panelBox, rowLine } from "./blocks/menuBlocks.ts";
import { barButton, bigText, pageScale, scrollList } from "./mobilePage.ts";
import {
  BONUS_NAMES, DEFAULT_DIFFICULTY, FLAG_LETTERS, type MapInfo, RATINGS, RandomMapSetup, SIZES, SIZE_FILTERS, type ScenarioChoice, SetupOptions, type SortKey, bonusFrame, firstChoice, hotaLock,
  putRandomMap, scenarioChoice, setTown, sortedMaps, stepBonus, stepHero, stepPersonality, stepTown, stepTurn, toggleHuman,
} from "./newGameModel.ts";
import { difficultyNames, turnMinutesName, newGameBackdrop, templatedMapInfo, textLines, personalityName } from "./newGameParts.ts";
import { onLayout, screenSize } from "./screen.ts";
import { adopPanel, menuBox, menuCard, menuPanel, partTexture, slicedBox, tiledPart } from "./blocks/windowParts.ts";
import { tr, said, fmt, type Text, fallback } from "../i18n/index.ts";

const loadArt = () =>
  Promise.all([
    loadPng(newGameBackdrop()).catch(() => loadImage("gamselb0.pcx")),
    loadDef("scnrmpsz.def"),
    loadDef("scselc.def"),
    loadDef("scnrvict.def"),
    loadDef("scnrloss.def"),
    loadDef("scnrstar.def"),
    textLines("vcdesc.txt"),
    textLines("lcdesc.txt"),
    loadDef("gspbutt.def"),
    loadDef("scnrbeg.def"),
    loadDef("scnrback.def"),
    menuPanel(100, 100),
    menuBox(20, 20),
    ...[3, 4, 5, 6, 7].map((i) => loadDef(`gspbut${i}.def`)),
    ...["scsmbut", "scmdbut", "sclgbut", "scxlbut", "scalbut"].map((d) => loadDef(`${d}.def`)),
  ] as const);
let artLoad: ReturnType<typeof loadArt> | null = null;
/** New Game's pictures decoded ahead (the main menu does it while it's up): the screen then opens at once. */
export function warmMobileNewGame() {
  (artLoad ??= loadArt()).catch(() => (artLoad = null));
}

/** A player's row in the Advanced Options (windowParts' adopPanel): its marble over `w` x `h`, its boxes where asked. */
async function playerRow(letter: string, w: number, h: number, boxes: (readonly [number, number, number, number, "name" | "handicap" | "caption"])[]): Promise<Container | null> {
  const pic = adopPanel(letter);
  const [ground, ...cuts] = await Promise.all([tiledPart(pic, "ground", -1, w, h), ...boxes.map(([, , , , n]) => partTexture(pic, n, -1))]);
  if (!ground || cuts.some((t) => !t)) return null;
  const c = new Container({ label: "player row" });
  c.addChild(ground);
  boxes.forEach(([x, y, bw, bh], i) => c.addChild(Object.assign(slicedBox(cuts[i]!, bw, bh, 2), { x, y })));
  return c;
}
export async function mobileNewGame(modals: Modals, given: MapInfo[], current: string | undefined, heroNames: string[], overMenu = false): Promise<ScenarioChoice | null> {
  // (The list's order, the picks and the random map: newGameModel.ts, as the computer's window has them.)
  const maps = [...given];
  const [bg, sizeIcons, , victIcons, lossIcons, stars, vc, lc] = await (artLoad ??= loadArt()).catch((e) => ((artLoad = null), Promise.reject(e)));
  const frame = (d: typeof sizeIcons, i: number): Texture | undefined => d.get(0)?.[i]?.texture;
  const win = new Container();
  const page = new Container();
  win.addChild(page);
  const back = new Sprite(bg);
  // Over the main menu: its own picture stays behind the panels, as HotA's (the owner: the same backdrop as the menu's).
  back.visible = !overMenu;
  page.addChild(back);

  let sizeFilter = 0;
  /** The list's order (the original's column headers, an addition on phones: the owner 2026-11-02); a second tap turns it round. */
  let sortBy: SortKey = "name";
  let sortDown = false;
  let view: "list" | "options" | "random" | "templates" = "list";
  let difficulty = DEFAULT_DIFFICULTY;
  // (Nothing played yet: the first ordinary map, not an advanced start, so a newcomer's Begin starts on day 1.)
  let chosen: MapInfo | undefined = ((l) => l[firstChoice(l, current)])(sortedMaps(maps, { sizeFilter, sortBy }));
  const setup = new SetupOptions();
  const optionsFor = (m: MapInfo) => setup.for(m);
  const rnd = new RandomMapSetup();
  const random = rnd.o;

  // Left: the list (or the options / random map); right: the card. Clear of the page's corner buttons.
  // Upright (a tall screen): the list above the card instead of beside it.
  let top = 70;
  let L = { x: 0, y: 0, w: 0, h: 0 };
  let C = L;
  let leftW = 0;
  /** The layout for the screen now (again when the phone turns). */
  const measure = () => {
    ({ top, L, C } = menuRooms(page, back));
    leftW = L.w;
  };
  measure();
  const left = new Container();
  const card = new Container();
  page.addChild(left, card);

  let resolveIt: (v: ScenarioChoice | null) => void = () => {};
  let close = () => {};
  const done = (v: ScenarioChoice | null) => (close(), resolveIt(v));
  const begin = () => chosen && done(scenarioChoice(chosen, difficulty, setup.touched(chosen)));

  /** A panel's title: centred at its top, as the original's, clear of the rim's filigree corners. */
  const panelTitle = (text: Text) => {
    const t = bigText(text, "bigfont", YELLOW, 1.25, { w: leftW - 96 });
    t.position.set(L.x + Math.round((L.w - t.width) / 2), top + 10);
    return t;
  };

  // ---- the scenario list ------------------------------------------------------------------
  let listOffset = 0;
  let listScroller: { offset: () => number } | null = null;
  // The Advanced Options' and Random Map's panels stay scrolled where they were as a tap redraws them.
  const panelOffset: Record<string, number> = {};
  let panelScroller: { view: string; offset: () => number } | null = null;
  const keepScroll = <T extends { offset: () => number },>(s: T) => ((panelScroller = { view, offset: s.offset }), s);
  const drawList = async () => {
    if (listScroller) listOffset = listScroller.offset();
    listScroller = null;
    if (panelScroller) panelOffset[panelScroller.view] = view === panelScroller.view ? panelScroller.offset() : 0;
    panelScroller = null;
    left.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (view === "options") return drawOptions();
    if (view === "random") return drawRandom();
    if (view === "templates") return drawTemplates();
    left.addChild(Object.assign(panelBack(L.w, L.h), { x: L.x, y: L.y }));
    // The original's size filters (S, M, L, XL, All), the chosen one pressed; Random map beside them.
    const filters = new Container();
    filters.position.set(20, top + 10);
    ["scsmbut", "scmdbut", "sclgbut", "scxlbut", "scalbut"].forEach((d, i) => {
      const size = SIZE_FILTERS[i];
      const b = new DefButton(`${d}.def`, i * 47 * K, 0, -1, size === sizeFilter ? [1, 1, 2, 3] : [0, 1, 2, 3]);
      b.scale.set(K);
      b.label = `button: ${["View all small maps", "View all medium maps", "View all large maps", "View all extra large maps", "View all maps"][i]}`;
      b.onClick = () => ((sizeFilter = size), (listScroller = null), (listOffset = 0), void drawList());
      filters.addChild(b);
    });
    const randomBtn = await gspButton(tr("Random Map"), () => ((view = "random"), void drawList()));
    randomBtn.scale.set(K);
    randomBtn.position.set(5 * 47 * K + 8, 0);
    filters.addChild(randomBtn);
    // (Inside the panel's rim.)
    if (filters.width > leftW - 32) filters.scale.set((leftW - 32) / filters.width);
    left.addChild(filters);
    // The rows: players, size, format, name, victory and loss, as the original's columns. A finger high (the page
    // shrinks on a small phone) and no more (the owner: tighter rows, more maps in sight); each piece in the row's middle.
    const rowH = Math.max(42, Math.ceil(36 / (screenSize.css * pageScale())));
    // The original's column headers over the columns: a tap sorts by that column, again the other way round.
    const iconsW = 2 * 36 + 8;
    const colW = leftW - 20 - 8;
    const nameW = colW - 136 - iconsW - 12;
    const header = new Container({ label: "list headers" });
    const headH = 30;
    const cols: [string, number, number, typeof sortBy][] = [["scbutt1", 0, 50, "players"], ["scbutt2", 52, 32, "size"], ["scbutcp", 86, 46, "format"], ["scbutt3", 136, nameW, "name"], ["scbutt4", colW - iconsW, 36, "victory"], ["scbutt5", colW - 36, 36, "loss"]];
    await Promise.all(
      cols.map(async ([d, x, w, by]) => {
        const b = new DefButton(`${d}.def`, 0, 0, -1, by === sortBy ? [1, 1, 2, 3] : [0, 1, 2, 3]);
        b.label = `button: sort by ${by}`;
        b.onClick = () => ((sortDown = sortBy === by ? !sortDown : false), (sortBy = by), (listScroller = null), (listOffset = 0), void drawList());
        await b.ready;
        if (b.destroyed) return;
        const k = Math.min(w / Math.max(1, b.width), headH / Math.max(1, b.height));
        b.scale.set(k);
        b.position.set(x + Math.round((w - b.width) / 2), Math.round((headH - b.height) / 2));
        header.addChild(b);
      }),
    );
    header.position.set(20, top + 10 + filters.height + 8);
    left.addChild(header);
    const listTop = top + 10 + filters.height + 8 + headH + 6;
    const area = { x: 20, y: listTop, w: leftW - 20, h: L.y + L.h - listTop - 12 };
    // The rows in the list's recessed box, as the original's grid (inside the panel's rim).
    left.addChild(Object.assign(panelBox(leftW - 16, area.h + 4), { x: L.x + 8, y: area.y - 2 }));
    const content = new Container();
    const shown = sortedMaps(maps, { sizeFilter, sortBy, down: sortDown });
    // The whole list's height from the start (the scroller measures it), its rows drawn as below.
    content.addChild(new Graphics().rect(0, 0, 1, shown.length * rowH).fill({ color: 0, alpha: 0.001 }));
    const rows = new Map<MapInfo, Container>();
    const makeRow = (m: MapInfo, i: number) => {
      const row = new Container();
      row.y = i * rowH;
      const on = m === chosen;
      // The chosen row says so by its yellow letters, as the original's list (no bar); the list's grid line under each.
      row.addChild(new Graphics().rect(0, 0, area.w - 8, rowH).fill({ color: 0, alpha: 0.001 }));
      row.addChild(Object.assign(rowLine(area.w - 8), { y: rowH - 2 }));
      const color = on ? YELLOW : WHITE;
      const mid = (c: Container, x: number) => Object.assign(c, { x, y: Math.round((rowH - 2 - c.height) / 2) });
      const humans = m.players.filter((p) => p.human).length;
      const total = m.players.filter((p) => p.human || p.computer).length;
      row.addChild(mid(bigText(fmt`${humans}/${total}`, "medfont", color, 1.25, { w: 44 }), 6));
      row.addChild(mid(bigText(said(SIZES[m.size]?.[0]) ?? said("C"), "medfont", color, 1.25, { w: 30 }), 56));
      // (Its format: SCSELC's, HotA's horn for a HotA map.)
      void formatIcon(m).then((t) => t && !row.destroyed && row.addChild(mid(Object.assign(new Sprite(t), { scale: { x: 1.25, y: 1.25 } }), 86)));
      // (A gap before the icons, nameW: a long name squeezed to it never touches them.)
      row.addChild(mid(bigText(m.title ?? (said(m.name) || said(m.file.replace(/\.h3m$/i, ""))), "bigfont", color, 1, { w: nameW }), 136));
      const v = frame(victIcons, m.victory < 0 ? 11 : m.victory);
      if (v) row.addChild(mid(Object.assign(new Sprite(v), { scale: { x: 1.15, y: 1.15 } }), area.w - 8 - iconsW));
      const l = frame(lossIcons, m.loss < 0 ? 3 : m.loss);
      if (l) row.addChild(mid(Object.assign(new Sprite(l), { scale: { x: 1.15, y: 1.15 } }), area.w - 8 - 36));
      row.label = `row: ${m.title ?? (m.name || m.file)}`;
      row.eventMode = "static";
      row.cursor = "pointer";
      row.on("pointertap", () => {
        if (scroller.moved()) return;
        // A tap on the chosen one begins it, as a double click does in the original.
        if (chosen === m) return begin();
        const before = chosen;
        chosen = m;
        // Only the two rows change (drawing the whole list again took a phone a third of a second).
        redraw(before);
        redraw(m);
        void drawCard();
      });
      return row;
    };
    const place = (m: MapInfo) => {
      const i = shown.indexOf(m);
      if (i < 0 || rows.has(m)) return;
      const row = makeRow(m, i);
      rows.set(m, row);
      content.addChild(row);
    };
    const redraw = (m: MapInfo | undefined) => {
      const old = m && rows.get(m);
      if (!m || !old || old.destroyed) return;
      rows.delete(m);
      place(m);
      old.destroy({ children: true });
    };
    // The rows in sight first (the list shows at once), the rest a few at a time after.
    const first = Math.max(0, Math.floor(-listOffset / rowH) - 1);
    const inSight = Math.ceil(area.h / rowH) + 2;
    for (const m of shown.slice(first, first + inSight)) place(m);
    const rest = shown.filter((m) => !rows.has(m));
    const more = () => {
      if (content.destroyed) return;
      for (const m of rest.splice(0, 12)) place(m);
      if (rest.length) setTimeout(more, 0);
    };
    setTimeout(more, 0);
    // Opened at the top (the advanced starts first); after that the list stays where the finger left it.
    const scroller = scrollList(content, area, listOffset);
    listScroller = scroller;
    left.addChild(scroller.view);
  };

  // ---- advanced options: colour, town (with its creatures), hero and bonus per player ------------
  const drawOptions = async () => {
    const m = chosen;
    if (!m) return;
    const o = optionsFor(m);
    left.addChild(Object.assign(panelBack(L.w, L.h), { x: L.x, y: L.y }));
    left.addChild(panelTitle(tr("Advanced Options")));
    const listTop = top + 52;
    const area = { x: 18, y: listTop, w: leftW - 20, h: L.y + L.h - listTop - 12 };
    const content = new Container();
    // A row a player: the flag with who plays it, then the town, hero and bonus boxes (no handicap here: the owner, its
    // No / Mild / Severe said nothing and took a row; the computer's window keeps the original's box).
    const rowH = 104;
    const rowW = Math.max(area.w - 8, 624);
    // The town, hero and bonus columns evenly spaced across the row after the flag's (the owner 11-03: the hero's sat
    // nearer the bonus than the town); a column is 124 wide, its right arrow at 104 from its left.
    const colStep = Math.floor((rowW - 4 - 124 - 124) / 2);
    const [tx, hx, bx] = [124, 124 + colStep, 124 + 2 * colStep];
    let n = 0;
    for (const [color, p] of m.players.entries()) {
      if (!p.human && !p.computer) continue;
      const pick = o.picks[color];
      const row = new Container();
      row.y = n++ * rowH;
      content.addChild(row);
      // The player's row of the original (ADOP?PNL, in its colour): its marble, the box for who plays it, a caption
      // box under the town's, hero's and bonus's names; without the picture, a dark box.
      const back = new Container({ label: "player row" });
      row.addChild(back);
      // (As wide as the row's pieces at least: a narrow phone shrinks the rows as a whole, the colour to the bonus's arrow.)
      void playerRow(FLAG_LETTERS[color], rowW, rowH - 8, [[0, 70, 120, 26, "name"], ...[tx, hx, bx].map((cx) => [cx, 60, 124, 28, "caption"] as const)]).then((r) => !back.destroyed && back.addChild(r ?? new Graphics().rect(0, 0, rowW, rowH - 8).fill({ color: 0x000000, alpha: 0.35 })));
      // Colour: its flag; a tap turns it human or computer (hot seat). A colour only the computer may play says so.
      const flag = new DefButton(`aoflgb${FLAG_LETTERS[color]}.def`, 8, 4);
      flag.hint = tr("Human or computer");
      flag.scale.set(K);
      const turnHuman = () => {
        const no = toggleHuman(m, o, color);
        if (no) return void (extra("greyedWhy") && messageBox(modals, no === "computerOnly" ? tr("Only the computer can play this colour on this map.") : tr("One colour at least is played by a human."), color));
        void drawList();
      };
      flag.onClick = turnHuman;
      row.addChild(flag);
      // Who plays it, under the flag: a tap there turns it too; a computer's personality (an addition) is stepped by its own tap.
      const personal = !o.humans.includes(color) && extra("aiPersonality");
      row.addChild(Object.assign(bigText(o.humans.includes(color) ? tr("Human") : personal ? personalityName(pick.personality) : tr("Computer"), "medfont", personal && pick.personality ? YELLOW : WHITE, 1.25, { w: 110 }), { x: 6, y: 73 }));
      const who = new Graphics().rect(0, 70, 120, 26).fill({ color: 0, alpha: 0.001 });
      who.label = `button: who plays ${FLAG_LETTERS[color]}`;
      tapOrHold(who, personal ? () => (stepPersonality(pick, 1), void drawList()) : turnHuman);
      row.addChild(who);
      const arrows = (x: number, enabled: boolean, step: (dir: number) => void) => {
        if (!enabled) return;
        const l = new DefButton("adoplfa.def", x, 18);
        const r = new DefButton("adoprta.def", x + 104, 18);
        for (const [b, dir] of [[l, -1], [r, 1]] as const) {
          b.scale.set(K);
          b.onClick = () => (step(dir), void drawList());
          row.addChild(b);
        }
      };
      /** A box (town, hero): its picture and name; a tap or a long press opens its picker (`open`, none: fixed). */
      const box = async (x: number, what: string, pic: Promise<Texture | null>, name: Text, open?: () => void) => {
        const b = new Container({ label: `${what}: ${FLAG_LETTERS[color]}` });
        b.addChild(new Graphics().rect(x + 14, 4, 96, 86).fill({ color: 0, alpha: 0.001 }));
        const t = await pic;
        if (t) b.addChild(Object.assign(new Sprite(t), { x: x + 26, y: 10, scale: { x: K, y: K } }));
        b.addChild(Object.assign(bigText(name, "medfont", WHITE, 1.25, { w: 124, center: true }), { x, y: 62 }));
        if (open) tapOrHold(b, open);
        row.addChild(b);
      };
      // Town: its picture (Random's own), its name; HotA's towns greyed in the picker while HotA's content is off.
      const towns = startTowns(m, color, o);
      const allowed = towns.filter((t) => !t.why).map((t) => t.faction);
      await box(tx, "town", startTownIcon(pick.faction), pick.faction ? townName(pick.faction) : tr("Random"), towns.length ? () => void pickTown(modals, towns, pick.faction, color).then((r) => r && setTown(pick, r.faction) && void drawList()) : undefined); // i18n-ok (a label)
      arrows(tx, allowed.length > 1, (dir) => stepTown(pick, allowed, dir));
      // Hero: one of the town's, or random.
      const heroList = p.chooseHero ? startHeroes(pick.faction, o) : [];
      const heroes = heroList.filter((h) => !h.why).map((h) => h.hero);
      await box(hx, "hero", startHeroIcon(pick.hero), pick.hero >= 0 ? (said(heroNames[pick.hero]) ?? fallback("Hero")) : tr("Random"), heroList.length ? () => void pickHero(modals, heroList, pick.hero, heroNames, color).then((h) => h !== null && h !== pick.hero && ((pick.hero = h), void drawList())) : undefined); // i18n-ok (a label)
      arrows(hx, heroes.length > 0, (dir) => stepHero(pick, heroes, dir));
      // Bonus.
      const bf = frame(stars, bonusFrame(pick.bonus, pick.faction));
      if (bf) row.addChild(Object.assign(new Sprite(bf), { x: bx + 26, y: 10, scale: { x: K, y: K } }));
      row.addChild(Object.assign(bigText(tr(BONUS_NAMES[pick.bonus]), "medfont", WHITE, 1.25, { w: 124, center: true }), { x: bx, y: 62 }));
      arrows(bx, true, (dir) => stepBonus(pick, dir));
    }
    // The Player Turn Duration under the players: arrows step through 1 .. 30 minutes and Unlimited.
    {
      const row = new Container();
      row.y = n * rowH;
      content.addChild(row);
      row.addChild(Object.assign(bigText(tr("Player Turn Duration"), "medfont", YELLOW, 1.25, { w: 240 }), { x: 6, y: 18 }));
      row.addChild(Object.assign(bigText((turnMinutesName(o.turnMinutes)), "medfont", WHITE, 1.25, { w: 124, center: true }), { x: 300, y: 18 }));
      for (const [def, x, dir] of [["adoplfa.def", 300 - 40, -1], ["adoprta.def", 300 + 124 + 8, 1]] as const) {
        const b = new DefButton(def, x, 10);
        b.scale.set(K);
        b.onClick = () => (stepTurn(o, dir), void drawList());
        row.addChild(b);
      }
    }
    // Wider than the panel (a narrow phone): the rows as a whole a little smaller.
    if (content.width > area.w) content.scale.set(area.w / content.width);
    left.addChild(keepScroll(scrollList(content, area, panelOffset[view] ?? 0)).view);
  };

  // ---- random map ---------------------------------------------------------------------------
  const drawRandom = async () => {
    left.addChild(Object.assign(panelBack(L.w, L.h), { x: L.x, y: L.y }));
    left.addChild(panelTitle(tr("Random Map")));
    const content = new Container();
    let y = 0;
    // Each option on the original's card (RANMAPBK's): its title in the band, its buttons in the room under it.
    const cardW = Math.max(leftW - 24, 420);
    const BAND = 30;
    const card = (h: number) => {
      const c = new Container({ label: "option card" });
      void menuCard(cardW, h, BAND).then((p) => !c.destroyed && c.addChild(p ?? new Graphics().rect(0, 0, cardW, h).fill({ color: 0x08122b }).stroke({ color: 0x5a6b9c, width: 1 })));
      content.addChild(Object.assign(c, { y }));
    };
    const title = (text: Text) => content.addChild(Object.assign(bigText(text, "medfont", YELLOW, 1.25, { w: cardW - 20 }), { x: 10, y: y + 5 }));
    // The original's toggles: pressed while chosen, greyed when this map can't have it (`set` null).
    const defRow = async (text: Text, toggles: [def: string, on: boolean, set: (() => void) | null][], pitch: number) => {
      const h = BAND + 32 * K + 14;
      card(h);
      title(text);
      for (const [k, [def, on, set]] of toggles.entries()) {
        const b = new DefButton(`${def}.def`, 8 + k * pitch * K, y + BAND + 6, -1, on ? [1, 1, 1, 3] : [0, 1, 1, 3]);
        b.scale.set(K);
        if (set) b.onClick = () => (set(), void drawList());
        else b.disabled = true;
        content.addChild(b);
      }
      y += h + 8;
    };
    // The additions (no button of the original's says them): the scenario screen's word bars, the chosen one in yellow.
    const row = async (text: Text, choices: [string, () => boolean, () => void][], w = 64) => {
      const h = BAND + 34 * 1.25 + 14;
      card(h);
      title(text);
      for (const [k, [word, on, set]] of choices.entries()) {
        const b = await barButton(said(word), w * 1.25, 34 * 1.25, () => (set(), void drawList()), false);
        b.position.set(8 + k * (w + 8) * 1.25, y + BAND + 6);
        if (on()) b.addChild(new Graphics().rect(0, 0, w * 1.25, 34 * 1.25).stroke({ color: 0xffff00, width: 2 }));
        content.addChild(b);
      }
      y += h + 8;
    };
    const max = rnd.max;
    // Map size with the underground beside it, as the original's.
    await defRow(tr("Map Size"), [
      ...RANDOM_MAP_SIZES.map((n, i): [string, boolean, () => void] => [["ransizs", "ransizm", "ransizl", "ransizx"][i], random.size === n, () => rnd.setSize(n)]),
      ["ranundr", !!random.underground, () => rnd.setUnderground(!random.underground)],
    ], 47);
    await defRow(tr("Players"), [2, 3, 4, 5, 6, 7, 8].map((n): [string, boolean, (() => void) | null] => [`rannum${n}`, random.players === n, n <= max ? () => rnd.setPlayers(n) : null]), 32);
    await defRow(tr("Humans"), Array.from({ length: 8 }, (_, i): [string, boolean, (() => void) | null] => [`rannum${i + 1}`, random.humans === i + 1, i < random.players ? () => rnd.setHumans(i + 1) : null]), 32);
    // Teams (the original's two rows): the computers' among themselves, the humans' among themselves; fewer teams than players.
    const computers = rnd.computers;
    const teamRow = (n: number, get: () => number, set: (k: number) => void) => Array.from({ length: 8 }, (_, k): [string, boolean, (() => void) | null] => [`rannum${k}`, get() === k, rnd.canTeams(k, n) ? () => set(k) : null]);
    if (computers >= 2) await defRow(tr("Computer teams"), teamRow(computers, () => random.compTeams ?? 0, (k) => rnd.setCompTeams(k)), 32);
    if (random.humans >= 2) await defRow(tr("Human teams"), teamRow(random.humans, () => random.teams ?? 0, (k) => rnd.setTeams(k)), 32);
    await defRow(tr("Water"), ["rannone", "rannorm", "ranisld"].map((def, i): [string, boolean, () => void] => [def, rnd.water === i, () => rnd.setWater(i)]), 85);
    await defRow(tr("Monsters"), ["ranweak", "rannorm", "ranstrg"].map((def, i): [string, boolean, () => void] => [def, random.monsters === i, () => rnd.setMonsters(i)]), 85);
    // The computers' personality (an addition): one wide button, a tap steps on.
    if (extra("aiPersonality") && random.players > random.humans) await row(tr("Computers"), [[personalityName(random.ai, "Standard"), () => !!random.ai, () => rnd.stepAi(1)]], 150);
    // The kinds of road (an addition, VCMI's): each on or off, none of them a map without roads.
    if (extra("rmgRoads")) {
      await row(tr("Roads"), ["Dirt", "Gravel", "Cobble"].map((name, k) => [name, () => !!(rnd.roads & (1 << k)), () => rnd.toggleRoad(k)]), 64);
    }
    // The template (an addition: the original picks one that fits): the arrows step through those that fit.
    const templates = extra("rmgTemplate") ? ((await loadData().catch(() => null))?.rmgTemplates ?? []) : [];
    if (rnd.fitting(templates).length) {
      const chosenT = rnd.template(templates);
      const h = BAND + 34 * 1.25 + 14;
      card(h);
      title(tr("Template"));
      y += BAND + 6;
      for (const [k, dir] of [[0, -1], [1, 1]] as const) {
        // The Advanced Options' own left / right arrows.
        const b = new DefButton(dir < 0 ? "adoplfa.def" : "adoprta.def", 8 + k * 300, y);
        b.scale.set(K);
        b.onClick = () => (rnd.stepTemplate(templates, dir), void drawList());
        content.addChild(b);
      }
      // (Its name opens the list of them.)
      const name = Object.assign(bigText(chosenT ? said(rmgTitle(chosenT)) : tr("Random"), "medfont", WHITE, 1.25, { w: 220, center: true }), { x: 84, y: y + 8 });
      const hit = new Graphics().rect(84, y, 220, 42).fill({ color: 0, alpha: 0.001 });
      hit.eventMode = "static";
      hit.cursor = "pointer";
      hit.on("pointertap", () => ((view = "templates"), void drawList()));
      content.addChild(name, hit);
      y += h - BAND - 6 + 8;
    }
    // Show Random Maps (the original's RANSHOW): the map made and shown at the top of the list.
    const make = new DefButton("ranshow.def", 0, y);
    make.label = "button: Show Random Maps";
    make.onClick = async () => {
      const info = await templatedMapInfo(rnd.options(extra("rmgRoads")), rnd.templateKey);
      putRandomMap(maps, info);
      chosen = info;
      sizeFilter = 0;
      view = "list";
      void drawList();
      void drawCard();
    };
    // (As wide as the cards.)
    make.scale.set(Math.min(K, cardW / 337));
    content.addChild(make);
    const area = { x: 20, y: top + 52, w: leftW - 24, h: L.y + L.h - top - 60 };
    if (content.width > area.w) content.scale.set(area.w / content.width);
    left.addChild(keepScroll(scrollList(content, area, panelOffset[view] ?? 0)).view);
  };

  // ---- the templates that fit (an addition): Random first, a tap takes one -------------------
  const drawTemplates = async () => {
    left.addChild(Object.assign(panelBack(L.w, L.h), { x: L.x, y: L.y }));
    left.addChild(panelTitle(tr("Select a Template")));
    const templates = (await loadData().catch(() => null))?.rmgTemplates ?? [];
    const fitting = rnd.fitting(templates);
    const content = new Container();
    const rowH = 52;
    for (const [i, t] of [undefined, ...fitting].entries()) {
      const key = t ? rmgKey(templates, t) : undefined;
      const color = key === rnd.templateKey ? YELLOW : WHITE;
      const row = new Container();
      row.y = i * rowH;
      row.addChild(new Graphics().rect(0, 0, 420, rowH - 4).fill({ color: 0, alpha: 0.001 }));
      const facts = t ? rmgTemplateFacts(t) : null;
      row.addChild(Object.assign(bigText(t ? said(rmgTitle(t)) : tr("Random (one that fits)"), "medfont", color, 1.25, { w: 250 }), { x: 6, y: 12 }));
      if (facts) row.addChild(Object.assign(bigText(fmt`${said(facts.sizes)}, ${said(facts.players)}`, "medfont", color, 1.25, { w: 150 }), { x: 270, y: 12 }));
      row.eventMode = "static";
      row.cursor = "pointer";
      row.on("pointertap", () => ((rnd.templateKey = key), (view = "random"), void drawList()));
      content.addChild(row);
    }
    const back = await barButton(tr("Back"), 160, 40, () => ((view = "random"), void drawList()));
    back.position.set(0, (fitting.length + 1) * rowH + 6);
    content.addChild(back);
    const area = { x: 20, y: top + 52, w: leftW - 24, h: L.y + L.h - top - 60 };
    if (content.width > area.w) content.scale.set(area.w / content.width);
    left.addChild(scrollList(content, area).view);
  };

  // ---- the card: name, description, conditions, difficulty, and the buttons ----------------------
  const drawCard = async () => {
    card.removeChildren().forEach((c) => c.destroy({ children: true }));
    const m = chosen;
    card.addChild(Object.assign(panelBack(C.w, C.h), { x: C.x, y: C.y }));
    if (!m) return;
    const x = C.x + 14;
    const w = C.w - 28;
    const top = C.y;
    const sz = frame(sizeIcons, SIZES[m.size]?.[1] ?? 0);
    if (sz) card.addChild(Object.assign(new Sprite(sz), { x: x + w - 40, y: top + 10, scale: { x: 1.25, y: 1.25 } }));
    const name = bigText(said(m.name) || said(m.file), "bigfont", YELLOW, 1.25, { wrap: w - 50 });
    name.position.set(x, top + 10);
    card.addChild(name);
    // The buttons along the foot: Advanced options (a toggle), Begin, Back.
    const footH = 36 * K + 12;
    const footY = C.y + C.h - footH;
    // Advanced Options / Show Scenarios: a finger-high button in two lines (the owner: the original's thin bar was
    // hard to hit and its letters small), right of the chess pieces, or a row of its own when the card is narrow.
    const piecesW = 5 * 34 * K;
    const advRoom = w - piecesW - 12;
    const beside = advRoom >= 150;
    const advText = view === "options" ? tr("Show Scenarios") : tr("Advanced Options");
    // (Drawn at 1.25: the medium font at a size a phone reads.)
    const adv = await barButton(advText, beside ? Math.min(advRoom, 230) : Math.min(w, 300), Math.round(32 * K), () => {
      view = view === "options" ? "list" : "options";
      void drawList();
      void drawCard();
    });
    adv.label = `button: ${view === "options" ? "Show Scenarios" : "Advanced Options"}`;
    const advRow = beside ? 0 : Math.round(adv.height) + 10;
    // Difficulty: the original's five chess pieces, the chosen one pressed, with the rating.
    const diffY = footY - 32 * K - 34 - advRow;
    card.addChild(Object.assign(bigText(tr(`Difficulty: %1 (%2%)`, (await difficultyNames())[difficulty], RATINGS[difficulty]), "medfont", YELLOW, 1.25, { w }), { x, y: diffY - 26 }));
    // (A long press shows the piece's meaning, HELP.TXT 24-28 as the original's right click; The owner 2026-11-02.)
    await loadButtonHelp().catch(() => {});
    let piecesRight = x + piecesW - 4 * K;
    for (let i = 0; i < 5; i++) {
      const b = new DefButton(`gspbut${i + 3}.def`, x + i * 34 * K, diffY, -1, i === difficulty ? [1, 1, 2, 3] : [0, 1, 2, 3]);
      b.scale.set(K);
      b.label = `button: difficulty ${i + 1}`;
      const row = helpRow(24 + i);
      if (row) ((b.hint = row.hover), (b.help = row.help));
      b.onClick = () => ((difficulty = i), void drawCard());
      card.addChild(b);
      if (i === 4) piecesRight = await b.ready.then(() => b.x + b.width, () => piecesRight);
    }
    // The conditions stay in view above the difficulty (a long description pushed the Loss line out of the card);
    // the description between them and the name is what's dragged when long.
    const conds = new Container();
    let cy = 0;
    for (const [icons, idx, lines, title] of [
      [victIcons, m.victory < 0 ? 11 : m.victory, vc[m.victory + 1], "Victory"],
      [lossIcons, m.loss < 0 ? 3 : m.loss, lc[m.loss + 1], "Loss"],
    ] as const) {
      const icon = frame(icons, idx);
      if (icon) conds.addChild(Object.assign(new Sprite(icon), { x: 0, y: cy, scale: { x: 1.25, y: 1.25 } }));
      const t = bigText(fmt`${tr(title)}: ${said(lines) ?? said("")}`, "medfont", WHITE, 1.25, { wrap: w - 56 });
      t.position.set(48, cy + 4);
      conds.addChild(t);
      cy += Math.max(44, t.height + 12);
    }
    // HotA content and the game rules (additions, EXTRAS gameRules): one row above the difficulty, in sight whatever
    // the left panel shows: the horn's check (locked on for a map made with HotA's content) and the blue scroll.
    let rulesH = 0;
    if (extra("gameRules")) {
      const o = setup.peek(m);
      const changed = () => (view === "options" && void drawList(), void drawCard());
      const [hota, rules] = await Promise.all([
        hotaContentCheck(modals, !o.noHota, hotaLock(m), (on) => (setHotaContent(optionsFor(m), on), changed()), 1.25, "medfont"),
        rulesScroll(modals, optionsFor(m), changed, 1.25, "medfont"),
      ]);
      rulesH = Math.max(hota.height, rules.height) + 10;
      const row = new Container({ label: "content and rules" });
      rules.position.set(Math.max(Math.round(hota.width) + 16, w - Math.round(rules.width)), Math.round((rulesH - 4 - rules.height) / 2));
      hota.position.set(0, Math.round((rulesH - 4 - hota.height) / 2));
      row.addChild(hota, rules);
      if (row.width > w) row.scale.set(w / row.width);
      row.position.set(x, diffY - 30 - rulesH);
      card.addChild(row);
    }
    const condsY = diffY - 34 - rulesH - cy;
    conds.position.set(x, condsY);
    card.addChild(conds);
    const body = new Container();
    body.addChild(bigText(said(m.description) || tr("No description."), "medfont", WHITE, 1.25, { wrap: w - 8 }));
    const bodyTop = top + 14 + name.height + 10;
    card.addChild(scrollList(body, { x, y: bodyTop, w, h: Math.max(40, condsY - 6 - bodyTop) }).view);
    // The card's recessed boxes, as GSELPOP1's: the name's, the description's, the conditions', the pieces'.
    const boxes = [
      [top + 6, bodyTop - 4],
      [bodyTop - 2, condsY - 4],
      [condsY - 2, condsY + cy - 4],
    ].filter(([a, b]) => b - a >= 12).map(([a, b]) => Object.assign(panelBox(w + 12, b - a), { x: x - 6, y: a }));
    // (The pieces' box as wide as the pieces themselves: it ran past the last one.)
    boxes.push(Object.assign(panelBox(Math.round(piecesRight - x) + 8, 32 * K + 8), { x: x - 4, y: diffY - 4 }));
    card.addChildAt(new Container({ children: boxes, label: "boxes" }), 1);
    const beginBtn = new DefButton("scnrbeg.def", 0, 0);
    beginBtn.onClick = begin;
    const backBtn = new DefButton("scnrback.def", 0, 0);
    backBtn.onClick = () => (view !== "list" ? ((view = "list"), void drawList(), void drawCard()) : done(null));
    if (beside) adv.position.set(x + w - adv.width, diffY + Math.round((32 * K - adv.height) / 2));
    else adv.position.set(x + Math.round((w - adv.width) / 2), footY - advRow + 2);
    card.addChild(adv);
    let bx = x;
    for (const b of [beginBtn, backBtn]) {
      b.scale.set(K);
      await b.ready;
      b.position.set(bx, footY + 6);
      bx += b.width + 10;
      card.addChild(b);
    }
    // Too wide for a narrow card: the row a little smaller.
    const rowW = bx - 10 - x;
    if (rowW > w) for (const b of [beginBtn, backBtn]) (b.scale.set((K * w) / rowW), (b.x = x + ((b.x - x) * w) / rowW));
  };

  // The main menu's theme, as on the original's New Game screen (it carries on from the menu).
  playMusic("MAINMENU.MP3");
  await Promise.all([drawList(), drawCard()]);
  // The phone turned: laid out again, as it was.
  let first = true;
  const stopLayout = onLayout(() => {
    if (first || win.destroyed) return void (first = false);
    measure();
    void Promise.all([drawList(), drawCard()]);
  });
  return new Promise((resolve) => {
    resolveIt = (v) => (stopLayout(), resolve(v));
    close = modals.show(win, {
      x: () => -screenSize.ox,
      y: () => -screenSize.oy,
      own: true,
      onKey: (k) => {
        if (k === "Escape") done(null);
        else if (k === "Enter") begin();
        else return false;
        return true;
      },
    });
  });
}
