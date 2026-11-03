// The battle's right-click creature popup (CRSTKPU, ui/creatureInfo.ts) with this battle's values:
// attack, defense and speed with their bonuses, shots and health left, morale and luck, the spells on the stack.
import { type BattleState, type Unit, attackOf, defenseOf, luckOf, moraleOf, speedOf, stats } from "@heroes/core";
import type { Container } from "pixi.js";
import { tr, said } from "../i18n/index.ts";
import { creaturePopup } from "../ui/creatureInfo.ts";

/** Draws the popup for a stack into `box`, its top left corner at the origin (300 wide, 315 high). */
export async function drawCreatureInfo(box: Container, s: BattleState, u: Unit) {
  const c = stats(s, u);
  box.addChild(
    await creaturePopup(c, {
      count: u.count,
      attack: attackOf(s, u),
      defense: defenseOf(s, u),
      speed: speedOf(s, u),
      shots: u.shots,
      healthLeft: u.firstHp,
      morale: moraleOf(s, u),
      luck: luckOf(s, u),
      status: u.defending ? tr("Defending") : u.waited ? tr("Waiting") : said(s.sides[u.side].name),
      effects: u.effects,
    }),
  );
}
