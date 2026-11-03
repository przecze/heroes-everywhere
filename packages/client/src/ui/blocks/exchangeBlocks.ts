// A hero's pieces as the exchange shows them, cut from its own picture (windowParts' TRADE3), for the phone's exchange
// (2026-10-26: the phone reuses the desktop's parts and only lays them out afresh): the head (the banner with
// "Name, Level N Class", the portrait's box, the five small boxes under the banner: specialty, experience, spell
// points, morale, luck), the eight skills in the same small boxes, and the primary skills' column between the two
// heroes. Each picture explains itself as on the desktop (a tap: its text; held: the popup).
import { type Hero, effectivePrimary, experienceForLevel, maxMana } from "@heroes/core";
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { heroPortrait, loadDef, specialtyIcon } from "../../assets.ts";
import { WHITE } from "../../text.ts";
import { label, smallFont } from "../kit.ts";
import { type Modals } from "../modals.ts";
import { infoArea } from "../dialogs.ts";
import { heroClassName, moraleLuckText, resolveText, textTable } from "../gameText.ts";
import { specialties } from "../heroScreen.ts";
import { heroPortraitHold } from "../heroPortraitHold.ts";
import { skillInfo } from "../skillHelp.ts";
import { tr, said, type Text, fmt, NONE } from "../../i18n/index.ts";
import { TRADE3, part, partTexture } from "./windowParts.ts";
import { block } from "./block.ts";

/** The head's size: the banner and the portrait's box side by side, the banner's boxes under it. */
export const EX_HEAD = { w: TRADE3.parts.bannerLeft.w + TRADE3.parts.portrait.w - 2, h: TRADE3.parts.portrait.h };
/** The small boxes' step and size. */
export const EX_STEP = 36;
const BOX = TRADE3.parts.box;

/** True when the exchange's picture is there to cut (the HD mod's files): else the phone keeps the hero screen's head. */
export async function hasExchangeParts(player: number): Promise<boolean> {
  return !!(await partTexture(TRADE3, "box", player));
}

function tapArea(modals: Modals, player: number, parent: Container, x: number, y: number, w: number, h: number, text: () => Promise<Text | null | undefined>, comp?: () => Promise<{ texture: Texture; caption: Text } | null>) {
  const a = new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 });
  a.position.set(x, y);
  a.cursor = "pointer";
  infoArea(modals, a, player, text, comp);
  parent.addChild(a);
}

/**
 * One hero's head as the exchange's: `who` 0 the first hero's half (banner, then the portrait), 1 the second's
 * (the portrait, then the banner). A tap on the portrait: `onPortrait` (that hero's screen).
 */
export async function exchangeHead(modals: Modals, player: number, h: Hero, who: 0 | 1, moraleLuck: { morale: number; luck: number }, onPortrait?: () => void): Promise<Container> {
  const c = new Container();
  c.label = "hero: exchange head";
  const P = TRADE3.parts;
  const bannerX = who ? P.portrait.w - 2 : 0;
  const portraitX = who ? 0 : P.bannerLeft.w - 2;
  const [banner, box, face, pskil, mrl, lck, spec] = await Promise.all([
    part(TRADE3, who ? "bannerRight" : "bannerLeft", player),
    part(TRADE3, "portrait", player),
    heroPortrait(h).catch(() => null),
    loadDef("pskil32.def").catch(() => null),
    loadDef("imrl30.def").catch(() => loadDef("imrl22.def")).catch(() => null),
    loadDef("ilck30.def").catch(() => loadDef("ilck22.def")).catch(() => null),
    specialtyIcon(h.type, "small").catch(() => undefined),
  ]);
  if (banner) c.addChild(Object.assign(banner, { x: bannerX, y: 1 }));
  if (box) c.addChild(Object.assign(box, { x: portraitX, y: 0 }));
  if (face) {
    const f = new Sprite(face);
    f.scale.set(Math.min((P.portrait.w - 4) / face.width, (P.portrait.h - 4) / face.height));
    f.position.set(portraitX + Math.round((P.portrait.w - f.width) / 2), Math.round((P.portrait.h - f.height) / 2));
    c.addChild(f);
  }
  if (onPortrait) {
    const pa = new Graphics().rect(0, 0, P.portrait.w, P.portrait.h).fill({ color: 0, alpha: 0.001 });
    pa.position.set(portraitX, 0);
    pa.eventMode = "static";
    pa.cursor = "pointer";
    pa.on("pointertap", (e) => e.button !== 2 && onPortrait());
    heroPortraitHold(pa, onPortrait);
    c.addChild(pa);
  }
  // GENRLTXT 139: "%s, Level %d %s" on the banner (VCMI's CExchangeWindow titles).
  const title = label(tr(`%1, Level %2 %3`, h.name, h.level, await heroClassName(h.heroClass, h)), smallFont(), WHITE, "center", P.bannerLeft.w - 30);
  title.position.set(bannerX + (who ? 6 : 24), 1 + Math.round((P.bannerLeft.h - title.height) / 2));
  c.addChild(title);
  // The five boxes under the banner (the first hero's from its 58th pixel, the second's from its 13th, as TRADE3's).
  const bx = (k: number) => bannerX + (who ? 13 : 58) + EX_STEP * k;
  const by = P.box.y - P.portrait.y;
  for (let k = 0; k < 5; k++) {
    const b = await part(TRADE3, "box", player);
    if (b) c.addChild(Object.assign(b, { x: bx(k), y: by }));
  }
  const icon = (t: Texture | undefined, k: number) => t && c.addChild(Object.assign(new Sprite(t), { x: bx(k) + 1, y: by + 1 }));
  const value = (text: Text, k: number) => {
    // (Squeezed into its box's step: 1000 experience beside 10/10 mana ran into each other, the owner 2026-10-27 22:22.)
    const l = label(text, smallFont(), WHITE).fit(EX_STEP - 2);
    l.position.set(Math.round(bx(k) + BOX.w / 2 - l.width / 2), by + BOX.h - Math.round(l.height * 0.75));
    c.addChild(l);
  };
  icon(spec, 0);
  tapArea(modals, player, c, bx(0), by, BOX.w, BOX.h, async () => (await specialties())[h.type]?.[2]);
  icon(pskil?.get(0)?.[4]?.texture, 1);
  value(said(String(h.experience)), 1);
  tapArea(modals, player, c, bx(1), by, BOX.w, BOX.h, () => resolveText({ file: "genrltxt", id: 2, args: [h.level, experienceForLevel(h.level + 1), h.experience] }));
  icon(pskil?.get(0)?.[5]?.texture, 2);
  value(fmt`${h.mana ?? 0}/${maxMana(h)}`, 2);
  tapArea(modals, player, c, bx(2), by, BOX.w, BOX.h, () => resolveText({ file: "genrltxt", id: 205, args: [h.name, h.mana ?? 0, maxMana(h)] }));
  const frame = (def: string, v: number) => async () => {
    const t = (await loadDef(def).catch(() => null))?.get(0)?.[v + 3]?.texture;
    return t ? { texture: t, caption: NONE } : null;
  };
  icon(mrl?.get(0)?.[moraleLuck.morale + 3]?.texture, 3);
  tapArea(modals, player, c, bx(3), by, BOX.w, BOX.h, () => moraleLuckText(true, moraleLuck.morale), frame("imrl82.def", moraleLuck.morale));
  icon(lck?.get(0)?.[moraleLuck.luck + 3]?.texture, 4);
  tapArea(modals, player, c, bx(4), by, BOX.w, BOX.h, () => moraleLuckText(false, moraleLuck.luck), frame("ilck82.def", moraleLuck.luck));
  return block(c, "exchangeHead");
}

/** A hero's eight skills in the exchange's small boxes, `perRow` to a row. */
export async function exchangeSkills(modals: Modals, player: number, h: Hero, perRow = 8): Promise<Container> {
  const c = new Container();
  c.label = "hero: exchange skills";
  const secsk = await loadDef("secsk32.def").catch(() => null);
  for (let i = 0; i < 8; i++) {
    const x = EX_STEP * (i % perRow);
    const y = (BOX.h + 3) * Math.floor(i / perRow);
    const b = await part(TRADE3, "box", player);
    if (b) c.addChild(Object.assign(b, { x, y }));
    const s = h.skills?.[i];
    const f = s && secsk?.get(0)?.[s[0] * 3 + s[1] + 2];
    if (!s || !f) continue;
    const pic = new Container();
    pic.addChild(new Sprite(f.texture));
    pic.position.set(x + 1, y + 1);
    pic.eventMode = "static";
    pic.cursor = "pointer";
    skillInfo(modals, pic, player, s[0], s[1]);
    c.addChild(pic);
  }
  return block(c, "exchangeSkills");
}

/** The primary skills' column between the two heroes: each row the first hero's value, the skill, the second's. */
export async function exchangePrimaries(modals: Modals, player: number, pair: [Hero, Hero]): Promise<Container> {
  const c = new Container();
  c.label = "panel: primary skills";
  const R = TRADE3.parts.primaryRow;
  const [icons, pri] = await Promise.all([loadDef("pskil21.def").catch(() => loadDef("pskil32.def")).catch(() => null), textTable("priskill")]);
  const prim = pair.map((h) => effectivePrimary(h));
  for (let g = 0; g < 4; g++) {
    const y = (R.h + 1) * g;
    const row = await part(TRADE3, "primaryRow", player);
    if (row) c.addChild(Object.assign(row, { y }));
    const f = icons?.get(0)?.[g];
    if (f) c.addChild(Object.assign(new Sprite(f.texture), { x: 68 + Math.round((21 - Math.min(21, f.texture.width)) / 2), y: y + 2, width: Math.min(21, f.texture.width), height: Math.min(21, f.texture.height) }));
    for (const who of [0, 1]) {
      const v = label(said(String(prim[who][g])), smallFont(), WHITE, "center", 56);
      v.position.set(who ? 99 : 3, y + Math.round((R.h - v.height) / 2));
      c.addChild(v);
    }
    const name = pri(g, said(["Attack", "Defense", "Spell Power", "Knowledge"][g]));
    tapArea(modals, player, c, 0, y, R.w, R.h, () => resolveText({ file: "arraytxt", id: 2 + g }), async () => {
      const t = (await loadDef("pskil42.def").catch(() => null))?.get(0)?.[g]?.texture;
      return t ? { texture: t, caption: name } : null;
    });
  }
  return block(c, "exchangePrimaries");
}

/** One hero's primary skills in two rows of two (upright, beside its head): each the skill's picture in a small box, the value beside it. */
export const HERO_PRIMARIES = { cell: BOX.w + 22, w: 2 * (BOX.w + 22), h: 2 * BOX.h + 3 };
export async function heroPrimaries(modals: Modals, player: number, h: Hero): Promise<Container> {
  const c = new Container();
  c.label = "hero: primary skills";
  const [icons, pri] = await Promise.all([loadDef("pskil32.def").catch(() => null), textTable("priskill")]);
  const prim = effectivePrimary(h);
  for (let g = 0; g < 4; g++) {
    const x = HERO_PRIMARIES.cell * (g % 2);
    const y = (BOX.h + 3) * Math.floor(g / 2);
    const b = await part(TRADE3, "box", player);
    if (b) c.addChild(Object.assign(b, { x, y }));
    const f = icons?.get(0)?.[g];
    if (f) c.addChild(Object.assign(new Sprite(f.texture), { x: x + Math.round((BOX.w - f.texture.width) / 2), y: y + Math.round((BOX.h - f.texture.height) / 2) }));
    const v = label(said(String(prim[g])), "medfont", WHITE, "center", HERO_PRIMARIES.cell - BOX.w);
    v.position.set(x + BOX.w, y + Math.round((BOX.h - v.height) / 2));
    c.addChild(v);
    const name = pri(g, said(["Attack", "Defense", "Spell Power", "Knowledge"][g]));
    tapArea(modals, player, c, x, y, HERO_PRIMARIES.cell, BOX.h, () => resolveText({ file: "arraytxt", id: 2 + g }), async () => {
      const t = (await loadDef("pskil42.def").catch(() => null))?.get(0)?.[g]?.texture;
      return t ? { texture: t, caption: name } : null;
    });
  }
  return block(c, "heroPrimaries");
}

/**
 * The HD mod's quick buttons for the armies (TRADE3's upper row: all to the second hero, swap, all to the first) with
 * their arrows turned down and up, for the upright exchange where the second hero's army is under the first's (the owner's
 * note 2026-10-29 00:11: "move buttons maybe should have vert arrows"). The arrows are the picture's own, cut out and
 * turned a quarter over a patch of the buttons' brown. 148 x 32; null without the picture.
 */
export async function armyQuickUpright(player: number): Promise<Container | null> {
  const [row, right, left] = await Promise.all([part(TRADE3, "quickArmy", player), part(TRADE3, "quickArrowsRight", player), part(TRADE3, "quickArrowsLeft", player)]);
  if (!row || !right || !left) return null;
  const c = new Container();
  c.label = "picture: quick army buttons, arrows down and up";
  c.addChild(row);
  // The arrows of the first button (x 31) and of the last (x 101), 16 x 24: turned clockwise, → becomes ↓ and ← ↑.
  for (const [s, ax, mid] of [[right, 31, 36], [left, 101, 110]] as const) {
    c.addChild(new Graphics().rect(ax - 1, 4, 18, 26).fill(0x312118));
    s.anchor.set(0.5);
    s.rotation = Math.PI / 2;
    s.scale.set(0.9);
    s.position.set(mid, 17);
    c.addChild(s);
  }
  return c;
}
