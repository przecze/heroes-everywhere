// The page's start: the canvas and the screen's fit, the page's chrome (chrome/), Feedback and the chat,
// then the page the address names (#map, #campaign, #battle, #complete, #catalog, the owner's #admin, #review, #previews and #whisper; the main
// menu otherwise). Each page is a fresh load: a hash change reloads. The app's views (the catalog, Completeness, the
// owner's pages) open over the game instead (chrome/views.ts), each in a frame running this app on
// that page alone (`?view=1`, `inViewFrame`: no ☰, Feedback or chat of its own: the page around it has them).
// (First: every canvas made after it keeps its pixels when the phone's graphics restart.)
import "./ui/keepCanvases.ts";
import { previewSlug } from "./previewBuild.ts";
import "./asTesterMode.ts";
import { uiTree } from "./feedback/bundle.ts";
import { Application, TextureStyle } from "pixi.js";
// Pixi's shader code without eval, so the page's Content-Security-Policy can forbid it (securityHeaders.ts).
import "pixi.js/unsafe-eval";
import { installDefaultCursor } from "./cursors.ts";
import { SCREEN_H, SCREEN_W } from "./battle/layout.ts";
import { setupFeedback } from "./feedback/index.ts";
import { reportError } from "./feedback/errors.ts";
import { startTelemetry } from "./telemetry.ts";

// (Not on the Whisper test page: it sends nothing anywhere.)
if (!location.hash.startsWith("#whisper")) startTelemetry();
import { startMapPage } from "./map/page.ts";
import { startCampaignPage } from "./campaign/page.ts";
import { startBattlePage } from "./battle/testPage.ts";
import { showComplete } from "./complete.ts";
import { setupChrome } from "./chrome/index.ts";
import { setupOnline } from "./online.ts";
import { setupChat } from "./community/chat.ts";
import { setPopupLayer } from "./ui/creatureInfo.ts";
import { placePopup } from "./ui/blocks/popupPlace.ts";
import { startMenuPage } from "./menu.ts";
import { Container } from "pixi.js";
import { DefButton, label, windowFrame, loadButtonHelp } from "./ui/kit.ts";
import { Modals } from "./ui/modals.ts";
import { WHITE, retranslateTexts } from "./text.ts";
import { setupTouch, untilReleased } from "./touch.ts";
import { setupInstall } from "./install.ts";
import { reloadPage, restoreFullscreen, wholeScreenInApp } from "./fullscreen.ts";
import { clickEveryButton } from "./ui/clicks.ts";
import { fingerPx, screenSize, setupScreen, touchScale } from "./ui/screen.ts";
import { removeSplash } from "./ui/loadingScreen.ts";
import { lang, languageChanged, tr } from "./i18n/index.ts";
import { localizeDom } from "./i18n/dom.ts";
import { governFrameRate } from "./ui/frameRate.ts";
import { watchFrames } from "./feedback/frames.ts";
import { watchGraphics } from "./ui/graphicsLoss.ts";
import { inViewFrame, isView, lastGamePage, openView, openViewHash, closeView, rememberGamePage, setupViews, viewsOn } from "./chrome/views.ts";
import { adoptEntry, closeMenuViews, setupLayers, steppingBack } from "./chrome/layers.ts";
import { type PageScope, beginPage, capturePageResources, outsidePage } from "./pages.ts";
import { extra } from "./settings.ts";
import { padWanted } from "./pad/device.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Built game: the original files stay on the device after the first load (public/sw.js).
if (import.meta.env.PROD && !previewSlug && !inViewFrame && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});

async function main() {
  // The owner's Whisper test page (whisperTest.ts): a page of its own, no game behind it.
  if (location.hash.startsWith("#whisper")) {
    removeSplash();
    window.addEventListener("hashchange", () => location.reload());
    return (await import("./whisperTest.ts")).whisperTest();
  }
  // Each step of the start, for the stuck report and Feedback while loading (index.html): a hang names its step.
  const step = (what: string) => (document.documentElement.dataset.boot = what);
  step("texts");
  // The page's own texts (menu, Feedback) in the player's language from the start.
  localizeDom(document.body);
  document.documentElement.lang = lang();
  TextureStyle.defaultOptions.scaleMode = "nearest";
  const app = new Application();
  // roundPixels: sprites land on whole pixels, so tiles keep no flickering seams between them at in-between zooms (a pinch).
  step("graphics (WebGL)");
  await app.init({ width: SCREEN_W, height: SCREEN_H, background: 0x000000, antialias: false, roundPixels: true });
  step("the page's parts");
  // What the graphics hold (the textures on the GPU and their size), for the heartbeat and notes (telemetry.ts,
  // feedback/meta.ts): a phone that runs out of memory shows what grew (2026-11-01).
  Object.assign(window, {
    __gfxMem: () => {
      const all = (app.renderer as unknown as { texture?: { managedTextures?: ({ pixelWidth: number; pixelHeight: number } | null)[] } }).texture?.managedTextures ?? [];
      let n = 0;
      let px = 0;
      // (By size, the most numerous: a phone's 13,000 textures where a desktop holds 1,400 on the same save, 2026-11-01.)
      const bySize = new Map<string, number>();
      for (const t of all) {
        if (!t) continue;
        n++;
        px += t.pixelWidth * t.pixelHeight;
        const k = `${t.pixelWidth}x${t.pixelHeight}`;
        bySize.set(k, (bySize.get(k) ?? 0) + 1);
      }
      const most = [...bySize].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, c]) => `${c}x ${k}`).join(", ");
      return { textures: n, texturesMB: Math.round((px * 4) / 1e6), most };
    },
  });
  $("stage").appendChild(app.canvas);
  watchGraphics(app, (what, detail) => reportError("client", what, detail));
  governFrameRate(app);
  watchFrames(app);
  app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  const refit = setupScreen(app, $("stage"));
  // The language switched: our texts in the windows open now follow at once (the screens draw theirs again on the relayout after).
  languageChanged.add((from) => retranslateTexts(app.stage, from));
  // A mouse gets the original's arrow (CRDEFLT) wherever nothing else sets a cursor (menus, the town,
  // windows, over buttons too); without the game files, the browser's.
  if (matchMedia("(any-pointer: fine)").matches) void installDefaultCursor(app.renderer.events).catch(() => {});
  // The page's own: the ☰ menu and the windows it opens (chrome/). (Not in a view's frame: the page around it has them.)
  if (inViewFrame) document.body.classList.add("inView");
  else {
    // The layers' order, Escape and Back first of all (chrome/layers.ts): their handlers go before everyone's.
    setupLayers(app);
    setupChrome(refit);
    setupChat(app);
  }
  setupTouch(app);
  clickEveryButton(app);
  // Right-click help on buttons: the original framed popup, shown while the button is held.
  const helpLayer = new Container();
  helpLayer.zIndex = 5000;
  app.stage.sortableChildren = true;
  app.stage.addChild(helpLayer);
  setPopupLayer(helpLayer);
  void loadButtonHelp();
  DefButton.showHelp = (text, x, y) => {
    let gone = false;
    const box = new Container();
    void (async () => {
      const body = label(text, "medfont", WHITE, "center", 260);
      const frame = await windowFrame(300, body.height + 40, 0);
      if (gone) return;
      body.position.set(20, 20);
      box.addChild(frame, body);
      box.scale.set(touchScale(box.width, box.height));
      helpLayer.addChild(box);
      // A finger covers what's under it: over it (or beside it) on a touch screen, clear of the finger's reach.
      if (screenSize.touch) {
        const f = fingerPx();
        placePopup(box, { from: { x: x - f / 2, y: y - f / 2, w: f, h: f }, sides: ["above", "below", "left", "right"], gap: Math.round(f / 3) });
      } else placePopup(box, { at: { x, y } });
    })();
    return untilReleased(
      () => {
        gone = true;
        box.destroy({ children: true });
      },
      { popup: true },
    );
  };

  // Hash routing. The game's own pages (the main menu, the map, a campaign, a battle) are pages: one that can be
  // left in place (pages.ts records what it set up) gives way to the next without a reload (EXTRAS pageSwap); else
  // the page reloads, so it starts clean. (A reload leaves full screen: the next tap goes back into it, fullscreen.ts.)
  // A view's link (☰'s Admin, How to's Roadmap, a link given on) opens it over the game, which stays as it was.
  window.addEventListener("hashchange", (e) => {
    // (Back over our own history entry: a step back down the layers, chrome/layers.ts.)
    if (steppingBack()) return;
    // (Not within the catalog: its levels are addresses of their own, walked with Back, catalog/page.ts.)
    if (location.hash.startsWith("#catalog") && document.body.classList.contains("catalogPage")) return;
    if (inViewFrame) return isView(location.hash) ? reloadPage() : void parent.postMessage({ hotaGo: location.hash }, location.origin);
    if (viewsOn() && isView(location.hash)) {
      const to = location.hash;
      adoptEntry(e.oldURL);
      return openView(to);
    }
    if (openViewHash()) closeView();
    if (extra("pageSwap") && current && LEAVES_IN_PLACE.has(current.name) && IN_PLACE.has(pageOf(location.hash.split("?")[0]))) return void swapPage();
    reloadPage();
  });
  if (!inViewFrame) setupViews((hash) => (location.hash = hash));
  restoreFullscreen();
  wholeScreenInApp();
  // The address names a view (a link given on, a reload with one open): the game as it was last here under it.
  // (Not the catalog's frame of a still view, #catalog?still=: that is the page itself, catalog/stage.ts showStill.)
  const stillFrame = /^#catalog\?(.*&)?still=/.test(location.hash);
  const viewFirst = !inViewFrame && !stillFrame && viewsOn() && isView(location.hash) ? location.hash : "";
  if (viewFirst) history.replaceState(history.state, "", location.pathname + location.search + lastGamePage());
  if (!inViewFrame) setupInstall(pageOf(location.hash.split("?")[0]) === "menu");
  Object.assign(window, { __uiTree: () => ({ screen: { w: app.screen.width, h: app.screen.height }, tree: uiTree(app, 1e6) }) }); // (the live UI catalog reads it on the menu pages too)
  if (import.meta.env.DEV) Object.assign(window, { __app: app });
  /** The first screen is up: the page's loading splash (index.html) goes. */
  const loaded = removeSplash;
  setTimeout(loaded, 20000);
  // Feedback, once for every page (each page says where a note was written from itself).
  step("feedback");
  if (!inViewFrame) (setupFeedback(app, () => null), setupOnline());
  step("the page");
  // A game console's browser (or ?pad=1): played with its controller, HotA's buttons on it (pad/, map/padKeys.ts); the
  // shell's, never undone with a page.
  if (!inViewFrame && padWanted()) void Promise.all([import("./pad/index.ts"), import("./map/padKeys.ts")]).then(([pad, keys]) => outsidePage(() => pad.setupPad(keys.hotaPad(app))));
  // What is the shell's on the canvas (the help popups' layer...): every other part of it is the page's.
  const shellParts = new Set(app.stage.children);
  capturePageResources(app);

  let current: PageScope | null = null;
  /** The page now on gives way (what it set up undone, its part of the canvas and of the page gone) and the address's page starts. */
  const swapPage = () => {
    closeMenuViews();
    current?.end();
    for (const c of [...app.stage.children]) {
      if (shellParts.has(c)) continue;
      app.stage.removeChild(c);
      try {
        c.destroy({ children: true });
      } catch {
        // (a part already gone)
      }
    }
    for (const el of [...$("stage").children]) if (el !== app.canvas) el.remove();
    if (!app.canvas.isConnected) $("stage").appendChild(app.canvas);
    document.body.classList.remove("menuPage", "inBattle", "ownButtons");
    $("mapControls").replaceChildren();
    $("status").textContent = "";
    for (const key of ["__map", "__camera", "__battle", "__townButtons", "__status", "heroes"]) delete (window as unknown as Record<string, unknown>)[key];
    void startPage();
  };

  /** Starts the page the address names (`hash`: read before a view opened afresh puts its own in the address). */
  async function startPage(hash = location.hash) {
    const route = hash.split("?")[0];
    const page = pageOf(route);
    document.documentElement.dataset.boot = `page ${page}`;
    const scope = (current = beginPage(page));
    // (A page left while it was still starting: what it still does is no longer anyone's business.)
    const gone = (err: unknown) => {
      if (scope.alive) throw err;
    };
    if (window.top === window && ["menu", "map", "campaign", "battle"].includes(page)) rememberGamePage(page === "menu" ? "#menu" : `#${page}`);
    const nav = { map: "navMap", complete: "navComplete", campaign: "navCampaign", menu: "navMenu", battle: "navBattle", catalog: "", admin: "", review: "", previews: "" }[page];
    for (const id of ["navMap", "navComplete", "navCampaign", "navMenu", "navBattle"]) $(id).classList.toggle("current", id === nav);
    $("battleControls").hidden = page !== "battle";
    $("mapControls").hidden = page !== "map";
    if (page === "menu") {
      // The original main menu; the page bar only keeps the links (its corner buttons clear of the menu's column: style.css).
      document.body.classList.add("menuPage");
      await startMenuPage(app, new Modals(app)).catch(gone);
      loaded();
      return;
    }
    // The other pages say what they're loading themselves (a game being opened keeps the splash's
    // picture until its own loading screen has it on the canvas).
    if (page !== "map") loaded();
    if (page === "complete") {
      app.canvas.remove();
      // "#roadmap" and "#complete?tab=plan" open the plan; the catalogue otherwise.
      const tab = route === "#roadmap" || new URLSearchParams(hash.split("?")[1] ?? "").get("tab") === "plan" ? "plan" : "catalogue";
      await showComplete($("stage"), tab);
      return;
    }
    if (page === "catalog") {
      const q = new URLSearchParams(hash.split("?")[1] ?? "");
      // A view's frame: that view still over the whole page, the page's own ☰ and HTML around it (catalog/stage.ts).
      if (q.has("still")) {
        const [{ showStill }, { hotaRegistry }] = await Promise.all([import("./catalog/stage.ts"), import("./catalog/hotaViews.ts")]);
        await showStill(hotaRegistry, app, q.get("still")!, q.get("layout") ?? "");
        return;
      }
      app.canvas.remove(); // (put in a view's frame when that view is drawn straight into the page: catalog/page.ts)
      const [{ showCatalog }, { hotaRegistry }, { silence }] = await Promise.all([import("./catalog/page.ts"), import("./catalog/hotaViews.ts"), import("./audio.ts")]);
      // (It draws the screens, it doesn't play them: no music, no sounds.)
      silence();
      await showCatalog($("stage"), hotaRegistry, app);
      return;
    }
    if (page === "admin" || page === "review" || page === "previews") {
      app.canvas.remove();
      const { showOwnerPage } = await import("./ownerPage.ts");
      showOwnerPage($("stage"), page, new URLSearchParams(hash.split("?")[1] ?? "").get("tab") ?? "");
      return;
    }
    if (page === "campaign") {
      $("mapControls").hidden = false;
      await startCampaignPage(app, $("mapControls")).catch(gone);
      return;
    }
    if (page === "map") {
      await startMapPage(app, $("mapControls"), $("status")).catch((err) => {
        if (!scope.alive) return;
        console.error("map page failed", err instanceof Error ? err.stack : err);
        reportError("client", `map page failed: ${err instanceof Error ? err.message : err}`, err instanceof Error ? err.stack : undefined);
        $("status").textContent = tr("Map page failed: %1", err instanceof Error ? err.message : err);
      });
      return;
    }
    await startBattlePage(app).catch(gone);
  }
  const started = startPage();
  if (viewFirst) openView(viewFirst);
  await started;
}

/** The page an address names ("#map?room=CODE" links open the map page, and that room). */
function pageOf(route: string) {
  return route === "#map" ? "map" : route === "#roadmap" || route === "#matrix" || route === "#complete" ? "complete" : route === "#campaign" ? "campaign" : route === "#battle" ? "battle" : route === "#catalog" ? "catalog" : route === "#admin" ? "admin" : route === "#review" ? "review" : route === "#previews" ? "previews" : "menu";
}
/** The pages that can be left without a reload (everything they set up is undone: pages.ts), and the ones that can then start in place. */
const LEAVES_IN_PLACE = new Set(["menu"]);
const IN_PLACE = new Set(["map", "campaign", "battle"]);

/** What this browser lacks that the game needs (an old iPhone's Safari, an old in-app browser), in words. */
function missing(): string[] {
  const out: string[] = [];
  const c = document.createElement("canvas");
  if (!c.getContext("webgl2") && !c.getContext("webgl")) out.push("WebGL");
  if (typeof DecompressionStream === "undefined") out.push("DecompressionStream");
  if (typeof structuredClone === "undefined") out.push("structuredClone");
  if (typeof Worker === "undefined") out.push("Web Workers");
  return out;
}

/** The loading splash says why the game can't start, instead of loading forever. */
function cannotStart(why: string) {
  const line = document.querySelector("#splash span:last-child");
  if (line) {
    line.textContent = why;
    (line as HTMLElement).style.cssText += ";max-width:min(90vw,520px);text-align:center;line-height:1.4";
  }
}

const lacks = missing();
if (lacks.length)
  cannotStart(
    `This browser can't run the game (it lacks ${lacks.join(", ")}). On an iPhone or iPad, update to iOS 16.4 or newer; in an app's own browser (Messenger, Instagram), open the page in Safari or Chrome instead.`,
  );
else
  main().catch((e) => {
    console.error(e);
    cannotStart(`The game couldn't start (${e instanceof Error ? e.message : String(e)}). Reload the page; if it keeps happening, open it in Safari, Chrome or Firefox.`);
  });

