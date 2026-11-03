// The pointed-at stack's panel beside the battlefield (an addition, EXTRAS stackPanel): as VCMI's
// StackInfoBasicPanel (the HD mod's), CHRPOP over CCRPOP in its player's colour, the portrait and count, attack
// and defence (base and now), damage, health, morale and luck, those killed and the last one's health left, and
// up to three spells on it (SPELLINT, rounds left in the corner).
import { type BattleState, type Unit, attackOf, canShoot, defenseOf, hpOf, luckOf, moraleOf, stats } from "@heroes/core";
import { Container, Sprite, type Texture } from "pixi.js";
import { cut } from "../ui/blocks/windowParts.ts";
import { creaturePortrait, loadDef } from "../assets.ts";
import { tr, said, type Text, fmt, fallback } from "../i18n/index.ts";
import { WHITE, formatMetric } from "../text.ts";
import { label, loadImagePlayer } from "../ui/kit.ts";
import { gameTexts } from "../ui/highScores.ts";

/** Its size (76 wide; CCRPOP's lower part ends 323 down). */
export const STACK_PANEL_W = 76;
export const STACK_PANEL_H = 323;

/** Draws the panel for `u` into `box`, its top left corner at the origin. */
export async function drawStackPanel(box: Container, s: BattleState, u: Unit) {
  const owner = Math.max(0, s.sides[u.side]?.owner ?? u.side);
  const c = stats(s, u);
  const [top, bottom, portrait, morale, luck, icons, texts] = await Promise.all([
    loadImagePlayer("chrpop.pcx", owner).catch(() => null),
    loadImagePlayer("ccrpop.pcx", owner).catch(() => null),
    creaturePortrait(c, "large").catch(() => null),
    loadDef("imrl22.def").catch(() => null),
    loadDef("ilck22.def").catch(() => null),
    loadDef("spellint.def").catch(() => null),
    gameTexts().catch(() => ({ general: [] as string[] })),
  ]);
  // VCMI cuts both from (1, 1): CCRPOP 76x286 placed 37 down, CHRPOP's 76x200 over its top.
  if (bottom) box.addChild(Object.assign(new Sprite(cut(bottom, { x: 1, y: 1, w: 76, h: Math.min(286, bottom.height - 1) })), { y: 37 }));
  if (top) box.addChild(new Sprite(cut(top, { x: 1, y: 1, w: 76, h: Math.min(200, top.height - 1) })));
  const t = (i: number, english: string): Text => said(texts.general[i]) || fallback(english);
  const text = (value: Text, x: number, y: number, right = false, bottomAligned = false) => {
    const l = label(value, "tiny", WHITE);
    l.position.set(right ? x - l.width : x, bottomAligned ? y - l.height : y);
    box.addChild(l);
  };
  if (portrait) box.addChild(Object.assign(new Sprite(portrait), { x: 10, y: 6 }));
  const n = label(said(formatMetric(u.count)), "medfont", WHITE);
  n.position.set(68 - n.width, 70 - n.height);
  box.addChild(n);
  const ranged = canShoot(s, u);
  text(fmt`${t(380, "Att")}:`, 9, 75);
  text(fmt`${t(381, "Def")}:`, 9, 87);
  text(fmt`${t(386, "Dmg")}:`, 9, 99);
  text(fmt`${t(389, "Health")}:`, 9, 111);
  text(fmt`${c.attack}(${attackOf(s, u, ranged)})`, 69, 87, true, true);
  text(fmt`${c.defense}(${defenseOf(s, u)})`, 69, 99, true, true);
  text(fmt`${c.minDamage}-${c.maxDamage}`, 69, 111, true, true);
  text(said(String(hpOf(s, u))), 69, 123, true, true);
  text(fmt`${t(384, "Morale")}:`, 9, 131);
  text(fmt`${t(385, "Luck")}:`, 9, 143);
  const icon = (f: { texture: Texture; x: number; y: number } | undefined, x: number, y: number) => f && box.addChild(Object.assign(new Sprite(f.texture), { x: x + f.x, y: y + f.y }));
  icon(morale?.get(0)?.[Math.max(-3, Math.min(3, moraleOf(s, u))) + 3], 47, 131);
  icon(luck?.get(0)?.[Math.max(-3, Math.min(3, luckOf(s, u))) + 3], 47, 143);
  text(fmt`${tr("Killed")}:`, 9, 168);
  text(fmt`${t(389, "Health")}:`, 9, 180);
  text(said(String(Math.max(0, u.initialCount - u.count))), 69, 180, true, true);
  text(said(formatMetric(u.count > 0 ? u.firstHp : 0)), 69, 192, true, true);
  // Three spell boxes 38 apart from (15, 206): the empty frame (78), then the spells on it with art.
  const frames = icons?.get(0);
  for (let i = 0; i < 3; i++) icon(frames?.[78], 15, 206 + 38 * i);
  const effects = (u.effects ?? []).filter((e) => frames?.[e.spell + 1]);
  const shown = effects.slice(0, effects.length > 3 ? 2 : 3);
  shown.forEach((e, i) => {
    icon(frames?.[e.spell + 1], 15, 206 + 38 * i);
    if (e.rounds < 100) text(said(String(e.rounds)), 15 + 46, 206 + 38 * i + 36, true, true);
  });
  // GENRLTXT 674 "No spells" in the first box; "..." in the third when there are more.
  if (!effects.length) box.addChild(label(t(674, "No spells"), "tiny", WHITE, "center", 48).centreOn(15 + 24, 206 + 18));
  if (effects.length > 3) box.addChild(label(said("..."), "medfont", WHITE).centreOn(15 + 24, 206 + 76 + 14));
}
