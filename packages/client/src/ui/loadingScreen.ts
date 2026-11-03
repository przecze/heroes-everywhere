// The original's loading screen while a game is being set up: LOADBAR (HotA's own picture when its
// main menu theme is there) and the LOADPROG blocks filling in from left to right (VCMI's
// CLoadingScreen: 20 blocks of 18 px from 395, 548, as mainmenu.json's "loading").
// The page's own splash (index.html) shows the same picture before the app is up; it goes once
// this screen has drawn it, so a game load is the picture from the first moment, never a black gap.
import { type Application, Container, Graphics, Point, Rectangle, Sprite, Texture } from "pixi.js";
import { loadDef } from "../assets.ts";
import { type Backdrop, LOADING_BACKDROPS, pictureSurround, splashBackdrop, takeLoading } from "./backdrops.ts";
import { centre, onLayout, screenSize } from "./screen.ts";
import { label } from "./kit.ts";
import { loadFont } from "../text.ts";
import { loadingText } from "./loadingNote.ts";
import { allSteps, onSteps, parallelWith, resetSteps, stepsWanted } from "./loadSteps.ts";
import { tr, said, fmt } from "../i18n/index.ts";
import { webEmblem } from "./webEmblem.ts";
import { openCreditsHere } from "./about.ts";
import { extra } from "../settings.ts";
import type { GameText } from "../text.ts";

const BLOCKS = 20;
export { LOADBAR_PNG } from "./backdrops.ts";

/** Takes down the page's splash (index.html): the first screen is up. */
export function removeSplash() {
  document.getElementById("splash")?.remove();
  document.body.classList.remove("loading");
}

export interface Loading {
  /** How far the load has really got (0..1): the bar runs a little ahead of it, never past it by much. */
  progress: (f: number) => void;
  /** Fills the bar and takes the screen down. */
  done: () => void;
  /** Resolves once the picture is on the screen (a frame drawn with it). */
  drawn: Promise<void>;
}

/** Shows the loading screen over everything. */
export function loadingScreen(app: Application): Loading {
  const root = new Container();
  root.label = "screen: loading";
  resetSteps();
  // Over the screens built meanwhile (the map, a town or battle), under the windows (Modals: 1000),
  // so a question asked while loading is seen.
  root.zIndex = 999;
  // Black around the 800x600 picture, whatever the screen's shape.
  root.addChild(new Graphics().rect(-4000, -4000, 8800, 8600).fill(0x000000));
  root.eventMode = "static";
  app.stage.addChild(root);
  // (For the probes: they wait for the game itself, not this picture.)
  document.documentElement.dataset.loading = "1";
  centre(root);
  const blocks: Sprite[] = [];
  const list = new Container();
  let shown = 0;
  let real = 0;
  let finished = false;
  let onDrawn = () => {};
  const drawn = new Promise<void>((r) => (onDrawn = r));
  void (async () => {
    // (The splash's copy when it has it: no second download, nothing to wait for.)
    const art = document.getElementById("splashArt") as HTMLImageElement | null;
    // (Else the next of the pictures, EXTRAS backdrops: the page's splash after a reload shows it then.)
    const splash: [Backdrop, Texture] | null = art?.complete && art.naturalWidth ? [splashBackdrop(art.src), Texture.from(art)] : null;
    const [backdrop, back] = splash ?? (await takeLoading()) ?? [LOADING_BACKDROPS[0], null];
    const frames = (await loadDef("loadprog.def").catch(() => null))?.get(0) ?? [];
    if (root.destroyed) return;
    if (back) {
      // Around it the picture's own edges, not black (pictureSurround), laid out again as the screen turns.
      const surround = pictureSurround();
      const place = () => !root.destroyed && surround.place(back, { plain: backdrop.plain, origin: { x: screenSize.ox, y: screenSize.oy } });
      root.addChild(surround.view, new Sprite(back));
      const stop = onLayout(() => (root.destroyed ? queueMicrotask(() => stop()) : place()));
    }
    // "Remade for the web" under the logo (EXTRAS webEmblem).
    void webEmblem(root, () => backdrop.emblem);
    // A tap on the logo or the emblem: the About window over the loading (the load goes on under it).
    // Watched on the canvas itself: the screens being built under this one take the game's own taps.
    if (extra("about")) {
      const logo = new Rectangle(...backdrop.logo);
      const onTap = (e: PointerEvent) => {
        if (root.destroyed) return;
        const at = new Point();
        app.renderer.events.mapPositionToPoint(at, e.clientX, e.clientY);
        const p = root.toLocal(at);
        if (logo.contains(p.x, p.y)) openCreditsHere(app);
      };
      app.canvas.addEventListener("pointerup", onTap);
      root.on("destroyed", () => app.canvas.removeEventListener("pointerup", onTap));
    }
    frames.slice(0, BLOCKS).forEach((f, i) => {
      const s = Object.assign(new Sprite(f.texture), { x: 395 + i * 18, y: 548, visible: i < shown });
      blocks.push(s);
      root.addChild(s);
    });
    // The file coming in, in small print on the bar (EXTRAS loadingNote): the text kept readable
    // on a phone's small screen (about 12 CSS pixels high), under the blocks, within the picture.
    await loadFont("medfont").catch(() => {});
    if (root.destroyed) return;
    const note = label(said(""), "medfont", [229, 215, 123], "center");
    root.addChild(note);
    loadingText((t) => {
      if (note.destroyed || stepsWanted()) return;
      note.value = said(t);
      const k = Math.max(1, 12 / (note.lineHeight * screenSize.css));
      note.scale.set(Math.min(k, 760 / Math.max(1, note.texture.width)));
      note.position.set(Math.round(575 - note.width / 2), 548 + 22);
    });
    root.addChild(list); // (above the backdrop, which arrives after the list was made)
    // The picture is on the canvas from the next frame: the page's splash can go.
    app.ticker.addOnce(() => requestAnimationFrame(() => (removeSplash(), onDrawn())));
  })().catch(() => onDrawn());
  // The live checklist of the real steps (EXTRAS loadSteps): above the bar over the backdrop, or in the
  // space under the backdrop when the screen is upright.
  const rows = new Map<string, { name: GameText; time: GameText; mark: Graphics }>();
  const backing = new Graphics();
  list.addChild(backing);
  root.addChild(list);
  const gold: [number, number, number] = [229, 215, 123];
  const drawSteps = () => {
    // (The rows are laid out by their words' widths: not before the font is in.)
    if (list.destroyed || !stepsWanted() || !fontIn) return;
    const now = performance.now();
    const all = allSteps();
    const k = Math.max(1, 12 / (16 * screenSize.css));
    const rowH = Math.round(16 * k);
    // Upright: under the 800x600 picture, full width; else the right half above the blocks.
    const under = screenSize.portrait;
    const width = under ? 760 : 360;
    const x0 = under ? 20 : 395;
    const spin = (now / 120) % (Math.PI * 2);
    // The text first, so one scale fits the widest row (all rows alike).
    const made = all.map((st) => {
      let r = rows.get(st.id);
      if (!r) {
        r = { name: label(said(""), "medfont", gold), time: label(said(""), "medfont", [255, 255, 255], "left"), mark: new Graphics() };
        rows.set(st.id, r);
        list.addChild(r.mark, r.name, r.time);
      }
      const done = st.end !== undefined;
      r.name.value = parallelWith(st, now) ? fmt`${said(st.label)} (${tr("in parallel")})` : said(st.label);
      r.time.value = done ? tr(`%1 ms`, Math.round(st.end! - st.start)) : said("");
      r.name.scale.set(1);
      r.time.scale.set(1);
      return r;
    });
    const widest = Math.max(1, ...made.map((r) => r.name.width + 70));
    const sc = Math.min(k, (width - rowH * 1.6) / widest);
    const rh = Math.round(16 * sc);
    const y0 = under ? 610 : 540 - rh * all.length - 6;
    backing.clear();
    if (all.length) backing.roundRect(x0 - 10, y0 - 4, width + 14, rh * all.length + 8, 4).fill({ color: 0x000000, alpha: 0.55 });
    all.forEach((st, i) => {
      const r = made[i];
      const y = y0 + i * rh;
      const par = parallelWith(st, now);
      const done = st.end !== undefined;
      for (const t of [r.name, r.time]) t.scale.set(sc);
      r.name.position.set(x0 + rh * 1.6, y + Math.round((rh - r.name.height) / 2));
      r.time.position.set(x0 + width - r.time.width, r.name.y);
      // Spinner while it runs, a tick when it is in (a cross if it failed); a bracket for the parallel ones.
      const g = r.mark.clear();
      const cx = x0 + rh * 0.8;
      const cy = y + rh / 2;
      const u = rh * 0.3;
      const lw = Math.max(2, rh / 8);
      if (!done) g.arc(cx, cy, u, spin, spin + Math.PI * 1.5).stroke({ color: 0xe5d77b, width: lw });
      else if (st.failed) g.moveTo(cx - u, cy - u).lineTo(cx + u, cy + u).moveTo(cx + u, cy - u).lineTo(cx - u, cy + u).stroke({ color: 0xff5a4d, width: lw });
      else g.moveTo(cx - u, cy).lineTo(cx - u * 0.3, cy + u * 0.8).lineTo(cx + u, cy - u * 0.8).stroke({ color: 0x7ee27e, width: lw });
      if (par) g.moveTo(x0 - 1, y + 2).lineTo(x0 - 4, y + 2).lineTo(x0 - 4, y + rh - 2).lineTo(x0 - 1, y + rh - 2).stroke({ color: 0xe5d77b, width: 2 });
    });
  };
  let fontIn = false;
  void loadFont("medfont").then(() => ((fontIn = true), drawSteps()), () => {});
  onSteps(drawSteps);
  // The bar: a block every so often (slower as it fills), held a little ahead of the real progress.
  const start = performance.now();
  const tick = () => {
    if (root.destroyed) return void app.ticker.remove(tick);
    stage();
    drawSteps();
    const t = (performance.now() - start) / 1000;
    const ceiling = Math.min(BLOCKS - 1, Math.ceil(BLOCKS * Math.min(0.95, real + 0.2)));
    const creep = Math.floor(BLOCKS * (1 - Math.exp(-t / 2.5)));
    shown = finished ? BLOCKS : Math.max(shown, Math.min(ceiling, Math.max(creep, Math.floor(BLOCKS * real))));
    blocks.forEach((b, i) => (b.visible = i < shown));
  };
  /** Kept on top: the map page adds its own layers meanwhile. */
  const stage = () => {
    if (app.stage.children[app.stage.children.length - 1] !== root) app.stage.addChild(root);
  };
  app.ticker.add(tick);
  // A few frames a second while it's up: the bar moves seldom, and drawing at the screen's rate
  // (the map and HUD being built under it too) takes the time the loading needs.
  const fps = app.ticker.maxFPS;
  app.ticker.maxFPS = 5;
  return {
    drawn,
    progress: (f) => void (real = Math.max(real, Math.min(1, f))),
    done: () => {
      if (finished) return;
      finished = true;
      app.ticker.maxFPS = fps;
      tick();
      removeSplash();
      setTimeout(() => {
        app.ticker.remove(tick);
        loadingText(null);
        onSteps(null);
        root.destroy({ children: true });
        delete document.documentElement.dataset.loading;
      }, 150);
    },
  };
}
