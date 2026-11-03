// The one "what does this do" for a button (2026-11-03: "hold on the middle special button should show what it
// does, and generally the same for most buttons there or overall; map HUD buttons too"): a hold (a finger held still,
// the right mouse button: touch.ts) shows the button's words in the original's framed right-click popup while held,
// beside the finger, never under it (main.ts DefButton.showHelp, placed by popupPlace.ts). The original's own
// buttons (DefButton) do it themselves; this is for the rest: the battle bar's sprites, HotA's alternate action,
// our own Menu, More, zoom, Follow... `words` is asked at the hold, so a contextual button says what it does now.
// As "rightdown", the hold's own event (touch.ts): a HUD widget that moves when held (map/hud/arrange.ts) sees it
// answered and leaves it be. A greyed button still answers (what it would do, and why it's grey, is what's asked).
import type { Container } from "pixi.js";
import type { Text } from "../i18n/index.ts";
import { DefButton } from "./kit.ts";

export function holdTip(target: Container, words: () => Text | null | undefined) {
  if (target.eventMode === "none" || target.eventMode === "passive" || target.eventMode === "auto") target.eventMode = "static";
  target.on("rightdown", (e) => {
    const t = words();
    if (t && DefButton.showHelp) DefButton.showHelp(t, e.global.x, e.global.y);
  });
}
