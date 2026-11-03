// A secondary skill explains itself on a right-click (held), as the original's skill pictures do
// (VCMI's CSecSkillPlace / CComponent::showPopupWindow): the framed popup with SSTRAITS' text for
// that level (its {name} as the yellow title) over the big picture (SECSK82) and its caption.
import { LEVEL_NAMES, SKILL_NAMES } from "@heroes/core";
import type { Container, FederatedPointerEvent } from "pixi.js";
import { loadDef } from "../assets.ts";
import { type Modals } from "./modals.ts";
import { infoArea, textPopup } from "./dialogs.ts";
import { skillText } from "./gameText.ts";
import { said } from "../i18n/index.ts";

/** The skill's big picture and its "Advanced\nArchery" caption (level 1-3). */
export async function skillPicture(skill: number, level: number) {
  const t = (await loadDef("secsk82.def").catch(() => null))?.get(0)?.[skill * 3 + 2 + level]?.texture;
  return t ? { texture: t, caption: said(`${LEVEL_NAMES[level] ?? ""}\n${SKILL_NAMES[skill] ?? ""}`) } : null;
}

/** A skill shown to look at (not to pick): a tap opens its text with OK, the right button held shows it (infoArea). */
export function skillInfo(modals: Modals, target: Container, player: number, skill: number, level: number) {
  infoArea(modals, target, player, () => skillText(skill, level), () => skillPicture(skill, level));
}

/** Right button held on `target`: the skill's popup (level 1-3; a function for a place that changes). */
export function skillHelp(target: Container, player: number, skill: number | (() => [number, number] | undefined), level = 1) {
  target.eventMode = "static";
  target.on("rightdown", (e: FederatedPointerEvent) => {
    const which = typeof skill === "function" ? skill() : ([skill, level] as [number, number]);
    if (!which) return;
    let up = false;
    window.addEventListener("pointerup", () => (up = true), { once: true });
    void Promise.all([skillText(which[0], which[1]), skillPicture(which[0], which[1])]).then(([t, c]) => {
      if (t && !up) textPopup(t, player, e.global.x, e.global.y, c ? [c] : undefined);
    });
  });
}
