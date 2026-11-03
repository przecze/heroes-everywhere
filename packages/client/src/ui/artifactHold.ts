// An artifact's picture explains itself as the original's (VCMI's CArtPlace / CTradeableItem popups): its name and the
// game's description, while the right button (or a finger) is held. Every window that shows artifacts goes through it.
import type { Hero } from "@heroes/core";
import type { Container, FederatedPointerEvent } from "pixi.js";
import { artifactText } from "./artifactText.ts";
import { textPopup } from "./dialogs.ts";

export type ArtifactData = Parameters<typeof artifactText>[0];

export function artifactHold(target: Container, player: number, data: ArtifactData, art: number, hero?: Hero) {
  if (art < 0 || !data.artifacts[art]) return;
  target.eventMode = "static";
  target.on("rightdown", (e: FederatedPointerEvent) => textPopup(artifactText(data, art, hero), player, e.global.x, e.global.y));
}
