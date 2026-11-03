// A window's changing part drawn anew without a blink: built off screen, then put in place of the old one at once.
// Clearing first and awaiting the pieces after (portraits, texts, a DEF) left the part empty or half drawn for a frame
// or more, and two redraws close together (a click and the state that follows it) drew into the same place twice
// (2026-11-02 11:18: on the hero screen the artifacts flashed as one was moved).
import { Container } from "pixi.js";

/** `build` fills a fresh container; the newest finished build replaces what `shown` holds (an older one still drawing is dropped). */
export function redraws(shown: Container, build: (layer: Container) => Promise<void>): () => Promise<void> {
  let gen = 0;
  return async () => {
    const mine = ++gen;
    const layer = new Container();
    try {
      await build(layer);
    } catch (e) {
      layer.destroy({ children: true });
      throw e;
    }
    if (mine !== gen || shown.destroyed) return void layer.destroy({ children: true });
    shown.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const c of [...layer.children]) shown.addChild(c);
    layer.destroy();
  };
}
