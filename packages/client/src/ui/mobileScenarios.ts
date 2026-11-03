// Saving and loading on a phone or tablet, in the original's own look (as mobileNewGame.ts): HotA's blue
// backdrop, the gold-edged panels, the saved games as rows a finger can hit, the chosen one's card
// beside (upright: below) the list, and the original's Load / Save and Back buttons.
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { loadDef, loadImage, loadPng } from "../assets.ts";
import { tr, said, fmt, type Text } from "../i18n/index.ts";
import { extra } from "../settings.ts";
import { WHITE, YELLOW } from "../text.ts";
import { DefButton } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { K, gspButton, menuRooms, panelBack, panelBox, rowLine } from "./blocks/menuBlocks.ts";
import { bigText, pageScale, scrollList } from "./mobilePage.ts";
import { gameCard, gameRow } from "./gameRows.ts";
import { type TimelinePoint, layout, nowPoint } from "../timeline/model.ts";
import { points as tlPoints } from "../timeline/store.ts";
import { NOW, pointCard, timelineStrip } from "./timelineStrip.ts";
import { type MapInfo, SIZES, type ScenarioChoice } from "./newGameModel.ts";
import { newGameBackdrop } from "./newGameParts.ts";
import { onLayout, screenSize } from "./screen.ts";

/**
 * Saving or loading on a touch screen: the saved games as big rows (newest first, as the list
 * comes), the chosen one's map, and Load, or for saving a name box filled from the tapped row
 * (the same name again overwrites that save, as in the original) and Save.
 */
export async function mobileSaveLoad(modals: Modals, saves: MapInfo[], mode: "save" | "load", name = "", initial?: string, overMenu = false): Promise<ScenarioChoice | null> {
  // (Over the main menu: its own picture stays behind the panels, as HotA's.)
  const [bg, sizeIcons] = await Promise.all([overMenu ? Promise.resolve(Texture.EMPTY) : loadPng(newGameBackdrop()).catch(() => loadImage("gamselb0.pcx")), loadDef("scnrmpsz.def"), loadDef("scnrlod.def"), loadDef("scnrsav.def"), loadDef("scnrback.def"), loadDef("gspbutt.def")]);
  // Loading: this device's games; other devices' (cloud:) behind a button, or straight away with none here.
  const mine = saves.filter((x) => !x.file.startsWith("cloud:"));
  const others = mode === "load" ? saves.filter((x) => x.file.startsWith("cloud:")) : [];
  let showOthers = !mine.length;
  const shown = () => (mode === "load" && others.length ? (showOthers ? others : mine) : saves);
  let chosen = mode === "load" ? (shown().find((x) => x.file === initial) ?? shown()[0]) : undefined;
  // A game's timeline: its points (asked for once) and the point picked in it.
  const points = new Map<string, Promise<TimelinePoint[]>>();
  const picked = new Map<string, string>();
  let typed: Text = said(name);

  const win = new Container();
  const page = new Container();
  win.addChild(page);
  const back = new Sprite(bg);
  back.visible = !overMenu;
  page.addChild(back);
  const left = new Container();
  const card = new Container();
  page.addChild(left, card);

  let L = { x: 0, y: 0, w: 0, h: 0 };
  let C = L;
  const measure = () => {
    ({ L, C } = menuRooms(page, back));
  };
  measure();

  let resolveIt: (v: ScenarioChoice | null) => void = () => {};
  let close = () => {};
  let input: HTMLInputElement | null = null;
  const done = (v: ScenarioChoice | null) => (input?.remove(), close(), resolveIt(v));
  const go = () => {
    if (mode === "load") return chosen && done({ file: chosen.file, difficulty: 1, ...(chosen.timeline ? { point: picked.get(chosen.timeline.game.id) } : {}) });
    const n = typed.trim();
    if (n) done({ file: chosen?.file ?? "", difficulty: 1, name: n });
  };

  let listOffset = 0;
  let listScroller: { offset: () => number } | null = null;
  const drawList = async () => {
    if (listScroller) listOffset = listScroller.offset();
    listScroller = null;
    left.removeChildren().forEach((c) => c.destroy({ children: true }));
    left.addChild(Object.assign(panelBack(L.w, L.h), { x: L.x, y: L.y }));
    const title = bigText(mode === "save" ? tr("Save Game") : extra("asyncGames") ? tr("Your games") : tr("Load Game"), "bigfont", YELLOW, 1.25, { w: L.w - 24 });
    // (Centred, as the original's list title: clear of the panel's corner filigree.)
    title.position.set(L.x + Math.round((L.w - title.width) / 2), L.y + 12);
    left.addChild(title);
    let headH = title.height + 14;
    // The other devices' games, a bar of the original's under the title.
    if (others.length && mine.length) {
      const b = await gspButton(showOthers ? tr("This device's games") : tr(`Other devices' games (%1)`, others.length), () => {
        showOthers = !showOthers;
        chosen = shown()[0];
        listOffset = 0;
        void drawList();
        void drawCard();
      });
      b.scale.set(Math.min(K, (L.w - 28) / (b.width || 1)));
      b.position.set(L.x + 14, L.y + headH + 4);
      left.addChild(b);
      headH += b.height + 10;
    }
    // "Your games": a row shows the game at a glance, so it is taller.
    const games = mode === "load" && extra("asyncGames");
    const rowH = games ? Math.max(114, Math.ceil(46 / (screenSize.css * pageScale())) + 8) : Math.max(66, Math.ceil(46 / (screenSize.css * pageScale())) + 8);
    const area = { x: L.x + 12, y: L.y + headH + 8, w: L.w - 16, h: L.h - headH - 18 };
    // The rows in the list's recessed box, inside the panel's rim.
    left.addChild(Object.assign(panelBox(L.w - 16, area.h + 4), { x: L.x + 8, y: area.y - 2 }));
    const content = new Container();
    const list = shown();
    content.addChild(new Graphics().rect(0, 0, 1, Math.max(1, list.length) * rowH).fill({ color: 0, alpha: 0.001 }));
    if (!list.length) content.addChild(Object.assign(bigText(tr(`No saved games yet.`), "medfont", WHITE, 1.25, { wrap: area.w - 20 }), { x: 10, y: 10 }));
    for (const [i, m] of list.entries()) {
      const row = new Container();
      row.y = i * rowH;
      const on = m === chosen;
      // The picked row says so by its yellow text, as the original's lists (no filled bar); a thin rule under each row.
      row.addChild(new Graphics().rect(0, 2, area.w - 8, rowH - 4).fill({ color: 0x000000, alpha: 0.001 }));
      row.addChild(Object.assign(rowLine(area.w - 8), { y: rowH - 2 }));
      if (games) row.addChild(await gameRow(m, { w: area.w - 8, h: rowH, on }));
      else {
        const color = on ? YELLOW : WHITE;
        row.addChild(Object.assign(bigText(m.title ?? said(m.name), "medfont", color, 1.25, { w: area.w - 28 }), { x: 10, y: 8 }));
        const meta = bigText(fmt`${said(m.name)}${m.size ? fmt` · ${said(SIZES[m.size]?.[0]) ?? m.size}` : said("")}`, "medfont", WHITE, 1, { w: area.w - 28 });
        meta.alpha = 0.75;
        meta.position.set(10, 8 + 24 + 4);
        row.addChild(meta);
      }
      row.label = `row: ${m.title ?? m.name}`;
      row.eventMode = "static";
      row.cursor = "pointer";
      row.on("pointertap", () => {
        if (scroller.moved()) return;
        // A tap on the chosen one opens it, as a double click does in the original (not when saving: the name is taken from it).
        if (chosen === m && mode === "load") return go();
        chosen = m;
        if (mode === "save") typed = m.title ?? said(m.name);
        void drawList();
        void drawCard();
      });
      content.addChild(row);
    }
    const scroller = scrollList(content, area, listOffset);
    listScroller = scroller;
    left.addChild(scroller.view);
  };

  let cardGen = 0;
  const drawCard = async () => {
    const gen = ++cardGen;
    card.removeChildren().forEach((c) => c.destroy({ children: true }));
    card.addChild(Object.assign(panelBack(C.w, C.h), { x: C.x, y: C.y }));
    const x = C.x + 14;
    const w = C.w - 28;
    const footH = 36 * K + 12;
    const footY = C.y + C.h - footH;
    let bodyTop = C.y + 12;
    const m = chosen;
    if (mode === "save") {
      // The name of the save: a box of its own, a tap brings up the device's keyboard (a hidden text field).
      const hint = bigText(tr(`Name of the save`), "medfont", YELLOW, 1.25, { w });
      hint.position.set(x, bodyTop);
      const box = panelBox(w, 44);
      box.position.set(x, bodyTop + 30);
      const text = bigText(typed ? typed : tr(`Type a name, or tap a saved game to save over it.`), "medfont", typed ? WHITE : [170, 170, 170], 1.25, { w: w - 20 });
      text.position.set(x + 10, bodyTop + 30 + 10);
      box.hitArea = { contains: (px: number, py: number) => px >= 0 && py >= 0 && px < w && py < 44 };
      box.eventMode = "static";
      box.cursor = "text";
      box.on("pointertap", () => input?.focus());
      card.addChild(hint, box, text);
      bodyTop += 30 + 44 + 12;
    }
    if (m?.timeline && mode === "load") {
      const g = m.timeline.game;
      const title = bigText(said(m.name), "bigfont", YELLOW, 1.25, { w });
      title.position.set(x, bodyTop);
      card.addChild(title);
      if (!points.has(g.id)) points.set(g.id, tlPoints(g.id).catch(() => []));
      const pts = await points.get(g.id)!;
      if (gen !== cardGen || card.destroyed) return;
      const head = g.head && pts.some((p) => p.id === g.head) ? g.head : [...pts].sort((a, b) => b.at - a.at)[0]?.id;
      const sel = picked.get(g.id) ?? (m.timeline.now ? NOW : head) ?? NOW;
      picked.set(g.id, sel);
      const k = screenSize.touch ? Math.max(1, 46 / (screenSize.css * pageScale()) / 50) : 1;
      const placed = layout(pts);
      const headPlaced = placed.find((p) => p.point.id === head);
      const lanes = Math.max(1, ...placed.map((p) => p.lane + 1)) + (m.timeline.now && headPlaced && placed.some((p) => p.parent === headPlaced) ? 1 : 0);
      const stripY = bodyTop + title.height + 8;
      const stripH = Math.round(24 * k + Math.min(lanes, 2.5) * 62 * k);
      const strip = await timelineStrip({ points: pts, head, selected: sel, now: m.timeline.now, color: g.color, faction: g.faction, w, h: stripH, k, onPick: (id) => (picked.set(g.id, id), void drawCard()) });
      if (gen !== cardGen || card.destroyed) return;
      strip.position.set(x, stripY);
      card.addChild(strip);
      const point = sel === NOW ? nowPoint(NOW, g.day) : (pts.find((p) => p.id === sel) ?? null);
      const body = new Container();
      body.addChild(await pointCard(point, { color: g.color, w: w - 8, branches: !!point && pts.some((p) => p.parent === point.id), now: m.timeline.now }));
      const glance = await gameCard(m, w - 8);
      if (glance) body.addChild(Object.assign(glance, { y: body.height + 16 }));
      if (gen !== cardGen || card.destroyed) return;
      const at = stripY + stripH + 10;
      card.addChild(scrollList(body, { x, y: at, w, h: Math.max(40, footY - at - 8) }).view);
    } else if (m) {
      const sz = sizeIcons.get(0)?.[SIZES[m.size]?.[1] ?? 0]?.texture;
      if (sz && m.size) card.addChild(Object.assign(new Sprite(sz), { x: x + w - 40, y: bodyTop, scale: { x: 1.25, y: 1.25 } }));
      const title = bigText(mode === "load" && extra("asyncGames") ? said(m.name) : (m.title ?? said(m.name)), "bigfont", YELLOW, 1.25, { wrap: w - (m.size ? 50 : 0) });
      title.position.set(x, bodyTop);
      const sub = bigText(fmt`${said(m.name)}${m.size ? fmt` · ${said(SIZES[m.size]?.[0]) ?? m.size}${m.levels > 1 ? tr(", with underground") : said("")}` : said("")}`, "medfont", WHITE, 1.25, { wrap: w });
      sub.alpha = 0.75;
      const body = new Container();
      const glance = mode === "load" && extra("asyncGames") ? await gameCard(m, w - 8) : null;
      if (glance) body.addChild(glance);
      body.addChild(Object.assign(sub, { y: glance ? glance.height + 12 : 0 }));
      if (m.description) body.addChild(Object.assign(bigText(said(m.description), "medfont", WHITE, 1.25, { wrap: w - 8 }), { y: body.height + 12 }));
      if (mode === "save") body.addChild(Object.assign(bigText(tr(`Saving under this name replaces it.`), "medfont", YELLOW, 1.25, { wrap: w - 8 }), { y: body.height + 12 }));
      const at = bodyTop + title.height + 10;
      // The name's and the description's recessed boxes, as the New Game card's (GSELPOP1's).
      // (Under the size icon and the save's name: just over the panel.)
      card.addChildAt(Object.assign(panelBox(w + 12, title.height + 8), { x: x - 6, y: bodyTop - 4 }), 1);
      card.addChildAt(Object.assign(panelBox(w + 12, Math.max(40, footY - at - 8) + 4), { x: x - 6, y: at - 2 }), 1);
      card.addChild(title);
      card.addChild(scrollList(body, { x, y: at, w, h: Math.max(40, footY - at - 8) }).view);
    }
    const goBtn = new DefButton(mode === "load" ? "scnrlod.def" : "scnrsav.def", 0, 0);
    goBtn.onClick = go;
    const backBtn = new DefButton("scnrback.def", 0, 0);
    backBtn.onClick = () => done(null);
    let bx = x;
    for (const b of [goBtn, backBtn]) {
      b.scale.set(K);
      await b.ready;
      b.position.set(bx, footY + 6);
      bx += b.width + 10;
      card.addChild(b);
    }
    const rowW = bx - 10 - x;
    if (rowW > w) for (const b of [goBtn, backBtn]) (b.scale.set((K * w) / rowW), (b.x = x + ((b.x - x) * w) / rowW));
    if (mode === "load" && !m) goBtn.alpha = 0.5;
  };

  if (mode === "save") {
    input = Object.assign(document.createElement("input"), { type: "text", maxLength: 60, value: typed, autocomplete: "off" });
    input.setAttribute("aria-label", tr(`Name of the save`));
    Object.assign(input.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", border: "0", padding: "0" });
    document.body.appendChild(input);
    input.addEventListener("input", () => {
      typed = said(input!.value);
      void drawCard();
    });
    input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  }

  // (A card that can't be drawn must not keep the window from coming up: a black page was all that showed.)
  await Promise.all([drawList(), drawCard().catch((e) => console.error("load window card:", e))]);
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
      typed: mode === "save",
      onKey: (k) => {
        if (k === "Escape") done(null);
        else if (k === "Enter") go();
        else return false;
        return true;
      },
    });
  });
}
