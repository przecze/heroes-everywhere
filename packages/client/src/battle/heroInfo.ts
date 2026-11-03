// The battle's right-click hero popup (CHRPOP in the hero's colour): portrait, the four primary
// skills, morale and luck, spell points. Laid out as VCMI's HeroInfoBasicPanel.
import { type BattleState, type Side, alive, luckOf, manaLimit, moraleOf } from "@heroes/core";
import { Container, Sprite, type Texture } from "pixi.js";
import { heroPortrait, loadDef, loadImage, loadPng } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { label, loadImagePlayer } from "../ui/kit.ts";
import { gameTexts } from "../ui/highScores.ts";
import { leatherWindow } from "../ui/blocks/phoneWindow.ts";
import { said, fmt, type Text, fallback } from "../i18n/index.ts";



/** Morale and luck as the hero's army has them (from its first living stack; 0 with none). */
function sideMoraleLuck(s: BattleState, side: Side): { morale: number; luck: number } {
  const u = s.units.find((x) => x.side === side && alive(x) && !x.machine);
  return u ? { morale: moraleOf(s, u), luck: luckOf(s, u) } : { morale: 0, luck: 0 };
}

/** A side's hero's large portrait (the battle popup's and the results window's). */
export async function heroPortraitOf(s: BattleState, side: Side): Promise<Texture | null> {
  const hero = s.sides[side].hero!;
  if (hero.type !== undefined) return heroPortrait(hero).catch(() => null);
  if (!hero.portrait) return null;
  return (hero.portrait.includes("/") ? loadPng(hero.portrait.toLowerCase()) : loadImage(`${hero.portrait}.pcx`)).catch(() => null);
}

/** The phone's version: the same pieces in the dialog frame, in medfont (the popup's tiny font can't be read there). */
export const HERO_INFO_PHONE_W = 220;
export const HERO_INFO_PHONE_H = 250;
/** The original popup's size (CHRPOP.PCX), for placing it. */
export const HERO_INFO_W = 77;
export const HERO_INFO_H = 200;

/** What the popup shows. */
export interface HeroPanel {
  owner: number;
  name: string;
  /** Attack, defense, power, knowledge. */
  primary: readonly number[];
  morale: number;
  luck: number;
  mana: number;
  maxMana: number;
  portrait: Texture | null;
}

/** Draws the popup for a side's hero in battle into `box`, its top left corner at the origin; `phone`: the readable version. */
export async function drawHeroInfo(box: Container, s: BattleState, side: Side, phone = false) {
  const hero = s.sides[side].hero;
  if (!hero) return;
  const ml = sideMoraleLuck(s, side);
  const portrait = await heroPortraitOf(s, side);
  await drawHeroPanel(box, { owner: hero.owner, name: hero.name, primary: hero.primary, ...ml, mana: hero.mana ?? 0, maxMana: hero.maxMana ?? manaLimit(hero.primary[3], hero.skills), portrait }, phone);
}

/** Draws the hero popup from its numbers (the battle's, or a hero's on the adventure map). */
export async function drawHeroPanel(box: Container, hero: HeroPanel, phone = false) {
  const portrait = hero.portrait;
  const [bg, morale, luck, texts] = await Promise.all([
    phone ? leatherWindow(HERO_INFO_PHONE_W, HERO_INFO_PHONE_H, Math.max(0, hero.owner)) : loadImagePlayer("chrpop.pcx", Math.max(0, hero.owner)).then((t) => new Sprite(t)),
    // The phone's bigger text gets the 30 px icons (IMRL30 / ILCK30, as the hero screen's), else the popup's 22 px ones.
    (phone ? loadDef("imrl30.def").catch(() => loadDef("imrl22.def")) : loadDef("imrl22.def")).catch(() => null),
    (phone ? loadDef("ilck30.def").catch(() => loadDef("ilck22.def")) : loadDef("ilck22.def")).catch(() => null),
    gameTexts().catch(() => ({ general: [] as string[] })),
  ]);
  box.addChild(bg);
  const t = (i: number, english: string): Text => said(texts.general[i]) || fallback(english);
  const names = [t(380, "Att"), t(381, "Def"), t(382, "Pwr"), t(383, "Know")];
  const mf = morale?.get(0)?.[Math.max(-3, Math.min(3, hero.morale)) + 3];
  const lf = luck?.get(0)?.[Math.max(-3, Math.min(3, hero.luck)) + 3];
  const mana = fmt`${hero.mana}/${hero.maxMana}`;
  const font = phone ? "medfont" : "tiny";
  const text = (value: Text, x: number, y: number, align: "left" | "right" | "center" = "left", color: readonly [number, number, number] = WHITE) => {
    const l = label(value, font, color, align === "center" ? "center" : "left", align === "center" ? 200 : undefined);
    // Right-aligned values end at x; centred lines are centred on x.
    l.position.set(align === "right" ? x - l.width : align === "center" ? x - 100 : x, y);
    box.addChild(l);
  };
  const icon = (f: { texture: Texture; x: number; y: number } | undefined, x: number, y: number) => f && box.addChild(Object.assign(new Sprite(f.texture), { x: x + f.x, y: y + f.y }));

  if (phone) {
    const W = HERO_INFO_PHONE_W;
    if (portrait) box.addChild(Object.assign(new Sprite(portrait), { x: 20, y: 20 }));
    const name = label(said(hero.name), "medfont", YELLOW, "left", W - 104);
    name.position.set(90, 22);
    box.addChild(name);
    let y = 96;
    hero.primary.forEach((v, i) => {
      text(names[i], 20, y);
      text(said(String(v)), W - 20, y, "right");
      y += 18;
    });
    // The icons right-aligned with the values and centred on their line of text.
    const rowIcon = (f: typeof mf, y: number) => f && icon(f, W - 20 - (f.fullWidth ?? f.texture.width), y + 11 - Math.round((f.fullHeight ?? f.texture.height) / 2));
    text(t(384, "Morale"), 20, y + 3);
    rowIcon(mf, y);
    y += 24;
    text(t(385, "Luck"), 20, y + 3);
    rowIcon(lf, y);
    y += 24;
    text(t(387, "Spell Points"), 20, y);
    text(mana, W - 20, y, "right");
    return;
  }
  // As VCMI's HeroInfoBasicPanel: the portrait, the primary skills down the left (TOPLEFT at 9, 75
  // + 12 per line; GENRLTXT 380-383) with their values BOTTOMRIGHT at 69, 87 + 12 per line (so a
  // pixel lower than the names: the tiny font is 11 high), morale and luck with their small icons
  // (frame = value + 3), then the spell points, now / at most, CENTER labels on 39, 174 and 39, 186.
  if (portrait) box.addChild(Object.assign(new Sprite(portrait), { x: 10, y: 6 }));
  hero.primary.forEach((v, i) => {
    text(fmt`${names[i]}:`, 9, 75 + 12 * i);
    const n = label(said(String(v)), "tiny", WHITE);
    n.position.set(69 - n.width, 87 + 12 * i - n.height);
    box.addChild(n);
  });
  text(fmt`${t(384, "Morale")}:`, 9, 131);
  text(fmt`${t(385, "Luck")}:`, 9, 143);
  icon(mf, 47, 131);
  icon(lf, 47, 143);
  box.addChild(label(t(387, "Spell Points"), "tiny", WHITE).centreOn(39, 174), label(mana, "tiny", WHITE).centreOn(39, 186));
}
