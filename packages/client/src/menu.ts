// The main menu: New Game, Load Game, High Scores, Credits, Quit, and the New Game / Load Game
// sub-menus (single scenario, multiplayer, campaign, tutorial). HotA's own theme when the HotA mod's
// art is there (its 24-bit background and buttons, positions from its mainmenu.json), else the
// original's GAMSELBK and DEF buttons (positions from VCMI's mainmenu.json, centres). The buttons
// come up one after another.
import { needsNet } from "./online.ts";
import { centre, onLayout, screenSize, uprightTop } from "./ui/screen.ts";
import { type Application, Container, Rectangle, Sprite } from "pixi.js";
import { cut } from "./ui/blocks/windowParts.ts";
import { loadDef, loadImage, loadPng } from "./assets.ts";
import { playMusic } from "./audio.ts";
import { DefButton, helpRow, loadButtonHelp, textButton } from "./ui/kit.ts";
import { type Modals } from "./ui/modals.ts";
import { YES_NO, messageBox } from "./ui/dialogs.ts";
import { playSound } from "./audio.ts";
import { highScoreList } from "./ui/highScores.ts";
import { type MapInfo } from "./ui/newGameModel.ts";
import { fetchMapsInfo, prefetchNewGame, randomMapInfo } from "./ui/newGameParts.ts";
import { parseRandomMapName } from "@heroes/core";
import { loadData } from "./gameData.ts";
import { loadFonts } from "./text.ts";
import { handOverChoice, pickNewGame } from "./ui/newGame.ts";
import { warmMobileNewGame } from "./ui/mobileNewGame.ts";
import { loadingScreen } from "./ui/loadingScreen.ts";
import { webEmblem } from "./ui/webEmblem.ts";
import { type Ongoing, latestGame, ongoingItem } from "./ui/ongoingGame.ts";
import { MENU_BACKDROPS, nextBackdrop, pictureSurround, prepareLoading } from "./ui/backdrops.ts";
import { creditsHost, openCredits } from "./ui/about.ts";
import { PLAYED_AT, elsewhere, forgetLocal } from "./cloudSaves.ts";
import { resolveText } from "./ui/gameText.ts";
import { extra } from "./settings.ts";
import { resetTutorialHints } from "./map/tutorial.ts";
import { lang, languageChanged, tr, type Text, NONE } from "./i18n/index.ts";
import { SavedGames, handOverGame, localGame, offerLine } from "./map/savedGames.ts";
import { loadMap } from "./map/loadMap.ts";
import { startCampaignPage } from "./campaign/page.ts";

/**
 * Original DEF and its centre, HotA's button art (images/<name>-normal|down|hover.png), hint, action,
 * and where HotA puts that button when not in its usual column (mainmenu.json's x from the right, y).
 */
/**
 * The buttons' right-click texts as the original's: HELP.TXT 3-7 (main), 10-14 (new / load game: VCMI's
 * mainmenu.json), the campaign sets' GENRLTXT 725 / 724 / 734 / 726 / 727; ours where it has none.
 */
const MENU_HELP: Record<string, Record<string, number>> = {
  main: { new: 3, load: 4, scores: 5, credits: 6, quit: 7 },
  new: { single: 10, camp: 11, multi: 12, tutor: 13, back: 14 },
  load: { single: 10, camp: 11, multi: 12, tutor: 13, back: 14 },
};
const CAMPAIGN_TEXT: Record<string, number> = { roe: 725, ab: 724, sod: 734, custom: 726, back: 727 };
async function originalHint(menu: string, key: string, ours: string): Promise<Text> {
  const help = MENU_HELP[menu]?.[key];
  // (Ours, where the files have no line, in the player's language: HotA's campaigns.)
  if (help !== undefined) return helpRow(help)?.help || tr(ours);
  const id = menu === "campaign" ? CAMPAIGN_TEXT[key] : undefined;
  return (id !== undefined && (await resolveText({ file: "genrltxt", id }).catch(() => null))) || tr(ours);
}

type Item = [def: string, x: number, y: number, hota: string, hint: string, action: () => void, hotaAt?: [number, number]];

/** HotA's main menu theme in the HotA mod (VCMI's "mainMenu" mod). */
const HOTA_MENU = "mods/mainmenu/content/";
/** HotA's buttons drawn with the words of another language (the mod's buttonsPolish, buttonsGerman...: the same names, sizes and look). */
const HOTA_MENU_IN: Record<string, string> = Object.fromEntries(
  Object.entries({ pl: "polish", de: "german", ru: "russian", uk: "ukrainian", es: "spanish" }).map(([l, word]) => [l, `mods/mainmenu/mods/buttons${word}/content/`]),
);
/** HotA's buttons: left edge and the top of each of the five (mainmenu.json: x -240, y 0..480). */
const HOTA_X = 560;
const HOTA_Y = [0, 120, 240, 360, 480];
/**
 * Upright (2026-10-25): the picture without the column on its right where its buttons stand
 * (the dragon's horn ends at about 550), enlarged to the screen's width; the buttons in rows of three
 * under it, a little bigger than HotA's, so the first screen looks made for a phone held upright.
 */
const UPRIGHT_CROP = 580;
const UPRIGHT_BUTTON = 1.2;
const UPRIGHT_PER_ROW = 3;
const UPRIGHT_GAP = 16;
/** Continue's item (EXTRAS continueGame): wide enough for the town, the hero and the map's name side by side. */
const CONTINUE_W = { upright: 760, sideways: 520 };
// (Sideways tall enough for the game's line to wrap onto a second: ui/gameRows.ts.)
const CONTINUE_H = { upright: 140, sideways: 132 };
/** Upright it is drawn enlarged (the picture there is about half size on the phone): its words readable. */
const CONTINUE_UPRIGHT = 1.4;

/** A button from three PNGs (normal, pressed, under the mouse), as HotA's menu has them. */
class PngButton extends Container {
  onClick = () => {};
  hint: Text = NONE;
  /** Its size once its pictures are in (the campaign sets' buttons are bigger or smaller than the rest). */
  readonly size: Promise<{ w: number; h: number }>;
  constructor(name: string, x: number, y: number, base = HOTA_MENU) {
    super();
    this.position.set(x, y);
    this.eventMode = "static";
    this.cursor = "pointer";
    const face = new Sprite();
    this.addChild(face);
    const states = ["normal", "down", "hover"] as const;
    const art = Promise.all(states.map((st) => loadPng(`${base}sprites/images/${name}-${st}.png`)));
    this.size = art.then(([t]) => ({ w: t.width, h: t.height }), () => ({ w: 200, h: 118 }));
    void art.then(([normal, down, hover]) => {
      let over = false;
      let pressed = false;
      const paint = () => (face.texture = pressed ? down : over ? hover : normal);
      paint();
      let hideHelp: (() => void) | null = null;
      // Only a mouse hovers (a finger's "over" would leave the glow on after the tap).
      this.on("pointerover", (e) => e.pointerType === "mouse" && ((over = true), paint()));
      this.on("pointerout", () => ((over = false), (pressed = false), paint()));
      this.on("pointerdown", (e) => {
        if (e.button === 2) {
          if (this.hint && DefButton.showHelp) hideHelp = DefButton.showHelp(this.hint, e.global.x, e.global.y);
          return;
        }
        if (e.button !== 0) return;
        void playSound("button");
        pressed = true;
        paint();
      });
      const up = () => {
        hideHelp?.();
        hideHelp = null;
        pressed = false;
        paint();
      };
      this.on("pointerup", up);
      this.on("pointerupoutside", up);
      this.on("pointertap", (e) => e.button === 0 && this.onClick());
    });
  }
}

/**
 * The main menu. `still` (the UI catalog): only drawn, as it stands once up: no music, nothing fetched ahead, no offers,
 * the buttons in place at once; `newGame` then opens the scenario selection over it. Resolves with its root.
 */
export async function startMenuPage(app: Application, modals: Modals, { still = false, newGame = false } = {}): Promise<Container> {
  const root = new Container();
  app.stage.addChild(root);
  // Upright: the picture across the top under the page's buttons, the menu's buttons in rows below it.
  centre(root, () => (screenSize.portrait ? uprightTop() : null));
  const hota = await loadPng(`${HOTA_MENU}sprites/images/new-normal.png`).then(() => true, () => false);
  // HotA's picture, or the next of its and the original's (EXTRAS backdrops).
  const [backdrop, back] = (await nextBackdrop("menu")) ?? [MENU_BACKDROPS[MENU_BACKDROPS.length - 1], await loadImage("gamselbk.pcx")];
  // Around the picture, whatever the screen's shape (upright above and below it, a wide screen's sides): its own
  // edges reflected and dimmed (pictureSurround).
  const surround = pictureSurround();
  const picture = new Sprite(back);
  root.addChild(surround.view, picture);
  /** The picture's enlargement (1 sideways), set with the buttons' layout. */
  let zoom = 1;
  // "Remade for the web" right under the logo's last line (EXTRAS webEmblem), on every menu: the picture
  // stays. Upright it stays a little smaller than its phone size so it fits under the title (the owner,
  // 2026-10-25: right below the game's name, in every layout).
  const emblemAt = () => [backdrop.emblem[0] * zoom, backdrop.emblem[1] * zoom, screenSize.portrait ? 1.3 * zoom : Infinity] as const;
  const emblem = webEmblem(root, emblemAt, () => void about());
  creditsHost(app, modals);
  // A tap on the logo itself opens it too (the owner: "the emblem or the original logo").
  let logo: Container | null = null;
  if (extra("about")) {
    logo = new Container();
    logo.label = "tap area: logo";
    logo.hitArea = new Rectangle(...backdrop.logo);
    logo.eventMode = "static";
    logo.cursor = "pointer";
    logo.on("pointertap", () => void about());
    root.addChild(logo);
  }
  /**
   * Upright: how much the picture is enlarged, filling the width with its left part as far as the
   * screen's height leaves room under it for the rows of buttons (and the Quick game): a tablet's
   * squarer screen shows more of it, less enlarged.
   */
  const uprightZoom = () => {
    const rows = Math.ceil(5 / UPRIGHT_PER_ROW);
    const buttons = rows * 118 * UPRIGHT_BUTTON + (rows + 1) * UPRIGHT_GAP + (extra("quickGame") || extra("continueGame") ? CONTINUE_H.upright + UPRIGHT_GAP : 0);
    const room = screenSize.h - uprightTop() - buttons - UPRIGHT_GAP;
    return Math.max(1, Math.min(800 / UPRIGHT_CROP, room / 600));
  };
  const placePicture = () => {
    // (A resize that lands after the menu was left: its picture is gone with it.)
    if (picture.destroyed || !picture.texture) return;
    zoom = upright ? uprightZoom() : 1;
    if (picture.texture !== back) picture.texture.destroy();
    picture.texture = zoom > 1 ? cut(back, { x: 0, y: 0, w: Math.round(800 / zoom), h: 600 }) : back;
    picture.scale.set(zoom);
    surround.place(back, { shown: { x: 0, y: 0, w: zoom > 1 ? Math.round(800 / zoom) : 800, h: 600 }, k: zoom, plain: backdrop.plain, origin: { x: screenSize.ox, y: upright ? uprightTop() : screenSize.oy } });
    logo?.scale.set(zoom);
    void emblem.then((e) => e?.position.set(Math.round(emblemAt()[0]), Math.round(emblemAt()[1])));
  };
  /** Credits: what this remake is and whose work it stands on first (EXTRAS about), the original's roll from there. */
  const about = () => void openCredits(app, modals);
  const layer = new Container();
  root.addChild(layer);
  if (!still) void playMusic("MAINMENU.MP3", true);
  // New Game is the likeliest next step: its map list and pictures download while the menu is up.
  // (It opens over this page: the list, the game's tables and fonts are fetched here, kept for it.)
  let mapsSoon: Promise<MapInfo[]> | undefined;
  // HotA's own tutorial (its guided messages from NEWTUT.TXT) when the installation has it, else the original's.
  const tutorial = async () => {
    const hota = "[HotA] Tutorial.tut";
    const url = `/maps/${encodeURIComponent(hota)}`;
    // (Offline: the downloaded copy says, "Play offline" keeps it.)
    const has = await fetch(url, { method: "HEAD" }).then((r) => r.ok).catch(async () => !!(await globalThis.caches?.match(url).catch(() => undefined)));
    resetTutorialHints();
    go(`#map?map=${encodeURIComponent(has ? hota : "Tutorial.tut")}`);
  };
  const warm = () => {
    mapsSoon ??= fetchMapsInfo();
    mapsSoon.catch(() => (mapsSoon = undefined));
    prefetchNewGame(false);
    void loadData().catch(() => {});
    void loadFonts().catch(() => {});
    // (The loading picture chosen now: the page's splash after the reload into the game shows it too.)
    prepareLoading();
    // (A phone's New Game: its pictures decoded too, so Single Scenario opens it at once.)
    if (screenSize.touch) warmMobileNewGame();
  };
  if (!still) setTimeout(warm, 1500);
  const go = async (hash: string, game = false) => {
    // Into a game: the original's loading screen at once, before the page changes (the next page's
    // splash shows the same picture in the same place, so there's no dark moment between).
    if (game || /^#map\?(start|map|quick)\b/.test(hash)) await Promise.race([loadingScreen(app).drawn, new Promise((r) => setTimeout(r, 300))]);
    location.hash = hash;
  };
  /**
   * Single scenario: the scenario selection over the menu, as in HotA (the menu's picture around it,
   * its music going on; no page change until a game is chosen). Back returns to the menu's buttons.
   */
  let picking = false;
  const newGameHere = async () => {
    if (picking) return;
    picking = true;
    layer.visible = false;
    let current: string | undefined;
    try {
      current = localStorage.getItem("heroes.map") ?? undefined;
    } catch {
      current = undefined;
    }
    const choice = await pickNewGame(modals, current, mapsSoon, true).catch((err) => {
      console.error("New Game failed", err);
      return null;
    });
    picking = false;
    if (!choice) return void (layer.visible = true);
    handOverChoice(choice);
    go(`#map?start=${encodeURIComponent(choice.file)}`);
  };

  const menus: Record<string, { items: Item[]; image?: string; hotaImage?: [string, number, number] }> = {
    main: {
      items: [
        ["mmenung.def", 644, 70, "new", "Start a new game.", () => (warm(), show("new"))],
        ["mmenulg.def", 645, 192, "load", "Continue a saved game.", () => show("load")],
        ["mmenuhs.def", 643, 296, "scores", "High scores.", () => void highScoreList(modals)],
        ["mmenucr.def", 643, 414, "credits", "Credits.", () => void about()],
        ["mmenuqt.def", 643, 520, "quit", "Quit.", () => void messageBox(modals, tr("Close the browser tab to quit."), 0)],
      ],
    },
    new: {
      image: "newgame",
      hotaImage: ["newgame", 280, 276],
      items: [
        ["gtsingl.def", 649, 65, "single", "A single scenario against the computer.", () => void newGameHere()],
        ["gtmulti.def", 649, 180, "multi", "Play with friends: a room code or link, any device.", () => needsNet() || go("#map?mp")],
        ["gtcampn.def", 646, 298, "camp", "Play a campaign.", () => show("campaign")],
        ["gttutor.def", 647, 412, "tutor", "The tutorial.", () => void tutorial()],
        ["gtback.def", 645, 517, "back", "Back to the main menu.", () => show("main")],
      ],
    },
    // The campaign sets (HotA's mainmenu.json "campaign"; the original's CSS buttons, VCMI's centres).
    campaign: {
      items: [
        ["cssroe.def", 637, 190, "roe", "The Restoration of Erathia campaigns.", () => campaignSet(0), [-250, 0]],
        ["cssarm.def", 638, 315, "ab", "The Armageddon's Blade campaigns.", () => campaignSet(1), [-256, 120]],
        ["csssod.def", 634, 67, "sod", "The Shadow of Death campaigns.", () => campaignSet(2), [-220, 240]],
        ["", 0, 0, "hota", "The Horn of the Abyss campaigns.", () => campaignSet(3), [-240, 360]],
        ["csscus.def", 638, 435, "custom", "A custom campaign.", () => void messageBox(modals, tr("No custom campaigns here yet: play the official ones."), 0), [-384, 491]],
        ["cssexit.def", 638, 554, "back", "Back to the New Game menu.", () => show("new"), [-240, 480]],
      ],
    },
    load: {
      image: "loadgame",
      hotaImage: ["loadgame", 250, 276],
      items: [
        ["gtsingl.def", 649, 65, "single", "Load a saved single player game.", () => void loadHere()],
        ["gtmulti.def", 649, 180, "multi", "Rejoin your multiplayer game.", () => needsNet() || go("#map?mp")],
        ["gtcampn.def", 646, 298, "camp", "Continue a campaign.", () => void campaignHere()],
        ["gttutor.def", 647, 412, "tutor", "Load a saved tutorial game.", () => void loadHere()],
        ["gtback.def", 645, 517, "back", "Back to the main menu.", () => show("main")],
      ],
    },
  };

  /**
   * Load Game: the saved games' window over the menu, as in HotA (the menu's picture around it, its
   * music going on; The owner: "the same backdrop as the main menu, and the music continues"); with none
   * anywhere, the original's "There are no Saved Games to load". A game picked goes to the map page
   * ("#map?loaded", the game handed over in the tab's storage); a game with friends to its room.
   */
  let checking = false;
  async function loadHere() {
    if (checking) return;
    checking = true;
    layer.visible = false;
    try {
      const data = await loadData();
      const saved = new SavedGames({
        modals,
        heroNames: data.heroNames,
        color: () => 0,
        state: () => null,
        savable: () => null,
        mapName: () => undefined,
        multiplayer: () => false,
        battleModals: () => null,
        mapsInfo: () => (mapsSoon ??= fetchMapsInfo()),
        infoFor: (file, byFile) => {
          const random = parseRandomMapName(file);
          return random ? randomMapInfo(random) : byFile?.get(file);
        },
        gameLine: (id, ...args) => resolveText({ file: "genrltxt", id, args }),
        open: async (file, st) => {
          // (The tab's storage full: the map page's own Load window, as before.)
          go(handOverGame(st) ? "#map?loaded" : "#map?load");
          return true;
        },
        playedAt: () => Number(localStorage.getItem(PLAYED_AT) ?? 0),
        openRoom: (id) => go(`#map?room=${id}`),
        loadMap,
        overMenu: true,
      });
      await saved.load();
    } catch (err) {
      console.error("Load Game failed", err);
      mapsSoon = undefined;
    } finally {
      checking = false;
      layer.visible = true;
    }
  }

  /** A campaign set's screen (the campaign screens show the set chosen last). */
  function campaignSet(set: number) {
    try {
      localStorage.setItem("heroes.campaignSet", String(set));
    } catch {
      // (No storage: the screens show the first set.)
    }
    void campaignHere();
  }

  /**
   * The campaign screens over this page, as in HotA (the music goes on; The owner: no page change and no
   * new start of the menu's music between the menu's screens). Back returns to the campaign buttons.
   */
  let inCampaign = false;
  async function campaignHere() {
    if (inCampaign) return;
    inCampaign = true;
    root.visible = false;
    try {
      await startCampaignPage(app, null, {
        modals,
        back: () => {
          inCampaign = false;
          root.visible = true;
          void show("campaign");
        },
      });
    } catch (err) {
      console.error("Campaign screen failed", err);
      inCampaign = false;
      root.visible = true;
    }
  }


  let shown = 0;
  /** The menu on screen, and whether its buttons were laid out upright. */
  let current = "main";
  /** The game going on, for Continue (EXTRAS continueGame). */
  let ongoing: Ongoing | null = null;
  let upright = false;
  async function show(name: string) {
    const gen = ++shown;
    current = name;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const menu = menus[name];
    /** The menu's name drawn on the picture (enlarged with it upright). */
    const titles: Sprite[] = [];
    // In another language the buttons and the menu's name in it, when the installation has HotA's sets for it.
    const own = HOTA_MENU_IN[lang()];
    const base = hota && own && (await loadPng(`${own}sprites/images/new-normal.png`).then(() => true, () => false)) ? own : HOTA_MENU;
    /** The menu's name (HotA's NEW GAME, LOAD GAME...) over the picture's right-hand side. */
    if (hota && menu.hotaImage) {
      const [img, ...at] = menu.hotaImage;
      const [x, y] = backdrop.title ?? at;
      const t = await loadPng(`${base}data/${img}.png`).catch(() => null);
      if (t && gen === shown) titles.push(Object.assign(new Sprite(t), { x, y }));
    } else if (menu.image) {
      const img = await loadImage(`${menu.image}.pcx`).catch(() => null);
      if (img && gen === shown) titles.push(Object.assign(new Sprite(img), { x: 114, y: 312 }));
    }
    const buttons: Container[] = [];
    /** Each button's size (HotA's PNGs are 200x118, drawn once loaded). */
    const sizes: { w: number; h: number }[] = [];
    const names: string[] = [];
    await loadButtonHelp().catch(() => {});
    const words = await Promise.all(menu.items.map(async ([, , , key, hint]) => originalHint(name, key, hint)));
    for (const [i, [def, x, y, hotaName, , action, hotaAt]] of menu.items.entries()) {
      const hint = words[i];
      if (hota) {
        const b = new PngButton(hotaName, hotaAt ? 800 + hotaAt[0] : HOTA_X, hotaAt ? hotaAt[1] : HOTA_Y[i], base);
        b.hint = hint;
        b.onClick = action;
        buttons.push(b);
        names.push(hotaName);
        sizes.push(await b.size);
        continue;
      }
      // The positions are button centres. (The original has no HotA set: its button only in HotA's theme.)
      if (!def) continue;
      const f = (await loadDef(def)).get(0)?.[0];
      const b = new DefButton(def, x - (f ? f.texture.width / 2 : 0), y - (f ? f.texture.height / 2 : 0));
      b.hint = hint;
      b.onClick = action;
      buttons.push(b);
      names.push(hotaName);
      sizes.push({ w: f?.texture.width ?? 200, h: f?.texture.height ?? 100 });
    }
    // The Quick game (an addition, EXTRAS quickGame): a first game with no setup screens, at the
    // picture's bottom left.
    let quick: Container | null = null;
    // (A finger's height on a phone: 50 was 32 CSS pixels there; upright the picture is drawn half size.)
    let qw = screenSize.portrait ? 330 : screenSize.touch ? 260 : 200;
    let qh = screenSize.portrait ? 96 : screenSize.touch ? 74 : 50;
    // The game going on (EXTRAS continueGame) in its place: Continue, straight back into it.
    if (name === "main" && ongoing) {
      const side = screenSize.portrait ? "upright" : "sideways";
      [qw, qh] = [CONTINUE_W[side], CONTINUE_H[side]];
      const game = ongoing;
      const k = screenSize.portrait ? CONTINUE_UPRIGHT : 1;
      quick = await ongoingItem(game, Math.round(qw / k), Math.round(qh / k), () => void ((game.multiplayer && needsNet()) || go(game.open(), true)));
      quick.scale.set(k);
      Object.assign(quick, { hint: game.multiplayer ? tr("Back into your game with friends.") : tr("Back into the game you were playing.") });
      quick.position.set(16, 600 - qh - 14);
    } else if (name === "main" && extra("quickGame")) {
      // (Its word measured in the game's own font, which the menu may not have fetched yet.)
      await loadFonts().catch(() => {});
      quick = await textButton(tr("Quick game"), qw, qh, () => go("#map?quick"));
      Object.assign(quick, { hint: tr("A first game straight away: a Medium map for two, you against one computer, Normal.") });
      quick.position.set(24, 600 - qh - 24);
    }
    // Named for feedback and probes ("button: menu new single": New Game, then Single Scenario).
    buttons.forEach((b, i) => (b.label = `button: menu ${name} ${names[i]}`));
    if (gen !== shown) return [...buttons, ...(quick ? [quick] : []), ...titles].forEach((b) => b.destroy({ children: true }));
    upright = screenSize.portrait;
    placePicture();
    for (const t of titles) {
      t.position.set(t.x * zoom, t.y * zoom);
      t.scale.set(zoom);
      layer.addChild(t);
    }
    if (quick) layer.addChild(quick);
    if (upright) {
      const top = uprightTop();
      const bottom = 600 * zoom;
      // Under the picture, in rows of three (the last row's centred), each button a little enlarged
      // (smaller on a tablet's squarer screen, where the picture can't shrink further).
      const rows = Math.ceil(buttons.length / UPRIGHT_PER_ROW);
      const room = screenSize.h - top - bottom - (rows + 1) * UPRIGHT_GAP - (quick ? qh + UPRIGHT_GAP : 0);
      const k = Math.min(UPRIGHT_BUTTON, room / rows / Math.max(...sizes.map((s) => s.h)), (800 - (UPRIGHT_PER_ROW + 1) * UPRIGHT_GAP) / UPRIGHT_PER_ROW / Math.max(...sizes.map((s) => s.w)));
      const cw = Math.max(...sizes.map((s) => s.w)) * k;
      const ch = Math.max(...sizes.map((s) => s.h)) * k;
      const gap = (800 - UPRIGHT_PER_ROW * cw) / (UPRIGHT_PER_ROW + 1);
      // A tall phone's room to spare above and below the block, half each (nearer the thumb).
      const spare = Math.max(0, (room - rows * ch) / 2);
      const y0 = bottom + UPRIGHT_GAP + spare;
      buttons.forEach((b, i) => {
        const row = Math.floor(i / UPRIGHT_PER_ROW);
        const inRow = Math.min(UPRIGHT_PER_ROW, buttons.length - row * UPRIGHT_PER_ROW);
        const left = (800 - inRow * cw - (inRow - 1) * gap) / 2;
        const col = i % UPRIGHT_PER_ROW;
        b.scale.set(k);
        b.position.set(Math.round(left + col * (cw + gap) + (cw - sizes[i].w * k) / 2), Math.round(y0 + row * (ch + UPRIGHT_GAP) + (ch - sizes[i].h * k) / 2));
      });
      // The Quick game centred under the rows.
      quick?.position.set(Math.round((800 - qw) / 2), Math.round(y0 + rows * (ch + UPRIGHT_GAP)));
    }
    // One after another, top to bottom: each fades in and slides in from the right.
    buttons.forEach((b, i) => {
      if (still) return void layer.addChild(b);
      const x = b.x;
      b.alpha = 0;
      b.x = x + 24;
      layer.addChild(b);
      let t = -i * 90;
      const step = (tk: { deltaMS: number }) => {
        if (b.destroyed) return void app.ticker.remove(step);
        t += tk.deltaMS;
        const k = Math.max(0, Math.min(1, t / 180));
        b.alpha = k;
        b.x = x + 24 * (1 - k) * (1 - k);
        if (k >= 1) app.ticker.remove(step);
      };
      app.ticker.add(step);
    });
  }
  // Turned between upright and sideways: the buttons laid out again.
  const stop = onLayout(() => {
    if (root.destroyed) return void queueMicrotask(() => stop());
    if (screenSize.portrait !== upright || (upright && uprightZoom() !== zoom)) void show(current);
    else placePicture();
  });
  // The language switched (☰ → Settings): the buttons and the menu's name are pictures in a language, drawn again in
  // the new one (they stayed in the old; The owner 2026-11-02).
  const relang = () => {
    if (root.destroyed) return void languageChanged.delete(relang);
    void show(current);
  };
  languageChanged.add(relang);
  // The game going on, for Continue (EXTRAS continueGame): asked a moment before the buttons come; a
  // slower answer (the friends' games' host, another device's) shows it when it comes.
  if (extra("continueGame")) {
    const asked = latestGame(() => (mapsSoon ??= fetchMapsInfo())).catch(() => null);
    const soon = await Promise.race([asked, new Promise<undefined>((r) => setTimeout(r, 800))]);
    if (soon !== undefined) ongoing = soon;
    else
      void asked.then((o) => {
        ongoing = o;
        if (o && current === "main" && !root.destroyed) void show("main");
      });
  }
  // Back from a campaign set's screen: the campaign menu again ("#menu?campaign").
  await show(location.hash.split("?")[1] === "campaign" ? "campaign" : "main");
  // The app opens on this menu: a game played since on another device is offered at once, as the
  // map page does (put down mid-battle there, it goes on here in that battle).
  // (Continue says it instead, EXTRAS continueGame.)
  if (extra("deviceOffer") && !extra("continueGame") && !location.hash.includes("?") && !still) void offerElsewhere();
  if (newGame) void newGameHere();
  return root;

  async function offerElsewhere() {
    const at = () => {
      try {
        return Number(localStorage.getItem(PLAYED_AT) ?? 0);
      } catch {
        return 0;
      }
    };
    const other = await elsewhere(localGame(), at()).catch(() => null);
    // (The game going on here was finished on another device: it's forgotten here, nothing to offer.)
    if (other?.kind === "over") return forgetLocal();
    // (Not over a window opened meanwhile: New Game, Load Game.)
    if (!other || picking || checking || modals.open) return;
    const answer = await messageBox(modals, offerLine(other.meta), 0, { buttons: YES_NO });
    if (answer === "yes") return void go(`#map?cloud=${encodeURIComponent(other.meta.slot)}`);
    // No: not asked again until it's played there once more.
    try {
      localStorage.setItem(PLAYED_AT, String(Date.now()));
    } catch {
      // (No storage: asked again next time.)
    }
  }
}
