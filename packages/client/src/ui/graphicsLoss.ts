// When the phone's graphics restart. A browser can lose the page's WebGL (a GPU process that hung or
// ran out of memory: the owner's phone, 2026-10-27, an upright siege, the screen still for half a minute, then
// back). Pixi uploads its textures again by itself, but what the 2D canvases behind them held is gone
// where those canvases lived on the GPU: every text (text.ts draws into canvases) and the icons composed
// on canvases came back blank, while the creatures (decoded pictures) were fine.
//
// So: every 2D canvas the page makes lives in the page's memory (keepCanvases.ts, imported first), the
// texts are drawn again when the graphics come back, and while they are gone nothing (Feedback's picture
// above all) asks the renderer for anything.
import type { Application, Container } from "pixi.js";
import { GameText } from "../text.ts";

let lostAt = 0;
/** How long lost graphics may stay away before the page loads again. */
const RELOAD_AFTER = 20_000;
const RELOADED = "heroes.glReload";
/** Whether the page's WebGL is gone right now (lost and not yet back): the renderer can't be asked for a picture. */
export function graphicsLost(): boolean {
  return lostAt > 0;
}

/** Every text under `root` drawn again (their canvases' textures, in case anything was lost). */
function redrawTexts(root: Container) {
  for (const c of root.children) {
    if (c.destroyed) continue;
    if (c instanceof GameText) c.redraw();
    else redrawTexts(c);
  }
}

/**
 * Watches the game's canvas: a loss is noted (Feedback's trail logs warnings), the return too, with how
 * long it took, and reported once a visit as a client problem; on the return every text is drawn again.
 */
export function watchGraphics(app: Application, report: (what: string, detail: string) => void) {
  const canvas = app.canvas;
  let reloadTimer = 0;
  canvas.addEventListener("webglcontextlost", () => {
    lostAt = performance.now();
    console.warn("graphics lost (the browser took the page's WebGL away)");
    // Not back in a while (2026-11-01: a battle went white and stayed so): the page loads again,
    // straight into the game (saved as it is played; a battle resumes). Once a minute at most, so a phone whose
    // graphics can't come back doesn't reload for ever.
    armReload();
  });
  function armReload() {
    clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => {
      if (!lostAt || document.hidden) return;
      try {
        const last = Number(sessionStorage.getItem(RELOADED) ?? 0);
        if (Date.now() - last < 60_000) return;
        sessionStorage.setItem(RELOADED, String(Date.now()));
      } catch {
        // (no session storage: reload anyway, once this visit)
      }
      report("graphics lost, reloading", `the page's WebGL was gone for ${Math.round(performance.now() - lostAt)} ms; the page loads again into the game`);
      setTimeout(() => location.reload(), 300);
    }, RELOAD_AFTER);
  }
  // Hidden meanwhile (the phone off, another app): the wait starts again when the page is seen.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && lostAt) armReload();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    clearTimeout(reloadTimer);
    const took = lostAt ? Math.round(performance.now() - lostAt) : 0;
    lostAt = 0;
    console.warn(`graphics back after ${took} ms`);
    try {
      redrawTexts(app.stage);
    } catch {
      // (A text that can't be drawn now draws on its next change.)
    }
    report("graphics lost and restored", `the page's WebGL was lost for ${took} ms (a GPU restart); texts drawn again`);
  });
}
