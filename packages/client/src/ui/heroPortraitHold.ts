// The one rule for a hero's portrait (2026-10-26): a long press (the right button) opens that hero's screen, to
// see the skills, army and artifacts before a choice (the level-up) or from a list (the kingdom). Not inside the hero
// screen itself; in a town with two heroes the caller opens the two heroes' exchange instead. EXTRAS portraitHold.
import type { Container } from "pixi.js";
import { extra } from "../settings.ts";

export function heroPortraitHold(target: Container, open: (() => void) | undefined) {
  if (!open || !extra("portraitHold")) return;
  target.eventMode = "static";
  // (As "rightdown", the long press's own event: a HUD piece that moves on a hold (map/hud/arrange.ts) leaves alone
  // what answers it, and a portrait that only listened to the button's pointerdown was grabbed and moved instead.)
  target.on("rightdown", () => open());
}
