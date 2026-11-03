// A hero's pieces as blocks, in the hero screen's own pixels (HEROSCR4's), drawn the same on the desktop's hero screen
// and laid out afresh on phones: the head (portrait, name, level), the skills section (the four primary skills,
// specialty / experience / spell points / morale / luck, the eight skill places, all named as on the desktop), the paper
// doll with its backpack, and the army. Every picture explains itself as on the original screen (a tap: its text with
// OK; held: the popup), the artifacts and stacks move as everywhere (ArtifactHand, ArmyClicks).
import { heroPortraitHold } from "../heroPortraitHold.ts";
import { type ArtifactRef, COMBOS, type GameData, type Hero, LEVEL_NAMES, LOCKED, type MoraleLuckPart, SKILL_NAMES, effectivePrimary, experienceForLevel, maxMana, stackSkills } from "@heroes/core";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { heroPortrait, loadDef, specialtyIcon } from "../../assets.ts";
import { WHITE, YELLOW } from "../../text.ts";
import { DefButton, FingerArea, label } from "../kit.ts";
import { type Modals } from "../modals.ts";
import { YES_NO, infoArea, messageBox, textPopup } from "../dialogs.ts";
import { artifactText } from "../artifactText.ts";
import { type ArtifactHand, type HandPlace } from "../artifactHand.ts";
import type { ArmyClicks } from "../armyClicks.ts";
import { heroClassName, moraleLuckText, resolveText, skillText, textTable, englishLine } from "../gameText.ts";
import { gameTexts } from "../highScores.ts";
import { ARTS, SLOT_POS, specialties } from "../heroScreen.ts";
import { StackGrid } from "./stackGrid.ts";
import { HEROSCR4, part } from "./windowParts.ts";
import { block } from "./block.ts";
import { tr, said, fallback, fmt, type Text, NONE } from "../../i18n/index.ts";

/** The paper doll and backpack in HEROSCR4 (the hero screen's own coordinates). */
export const DOLL = HEROSCR4.parts.doll;
/** The head: the portrait's box (60 x 65) and the name's box beside it, the name and level centred in it. */
export const HEAD = { w: 282, h: 65 };

/** The hero screen's boxes (windowParts' HEROSCR4): every layout draws a hero's pieces in the same boxes. */
export const BOXES = HEROSCR4.parts;
export type BoxName = "portrait" | "name";

/** One of the hero screen's boxes in `player`'s colours (null without the picture: the caller draws nothing there). */
export function heroBox(player: number, name: BoxName, w?: number, h?: number): Promise<Sprite | null> {
  return part(HEROSCR4, name, player, w, h);
}

type MoraleLuck = { morale: number; luck: number; moraleParts?: MoraleLuckPart[]; luckParts?: MoraleLuckPart[] };

const bigFrame = async (def: string, i: number, caption: Text) => {
  const t = (await loadDef(def).catch(() => null))?.get(0)?.[i]?.texture;
  return t ? { texture: t, caption } : null;
};

/** A hit area over `w` x `h` at x, y that explains itself (infoArea), a finger's size at least. */
function explains(modals: Modals, player: number, parent: Container, x: number, y: number, w: number, h: number, text: () => Promise<Text | null | undefined>, comp?: () => Promise<{ texture: Texture; caption: Text } | null>) {
  const a = new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 });
  a.position.set(x, y);
  a.hitArea = new FingerArea(a, w, h);
  a.cursor = "pointer";
  infoArea(modals, a, player, text, comp);
  parent.addChild(a);
}

/**
 * The portrait and, beside it, the name and "Level N Class". A tap on the portrait: `onPortrait` (the exchange: that
 * hero's screen), else the biography as the original's.
 */
export async function heroHead(modals: Modals, player: number, h: Hero, w = HEAD.w, onPortrait?: () => void): Promise<Container> {
  const c = new Container();
  c.label = "hero: head";
  // The hero screen's two boxes (the portrait's, the name's), the name and the tagline centred in the second.
  const nameW = Math.max(120, w - BOXES.portrait.w - 2);
  const [pbox, nbox] = await Promise.all([heroBox(player, "portrait"), heroBox(player, "name", nameW)]);
  if (pbox) c.addChild(pbox);
  if (nbox) c.addChild(Object.assign(nbox, { x: BOXES.portrait.w + 2 }));
  const portrait = await heroPortrait(h).catch(() => null);
  if (portrait) c.addChild(Object.assign(new Sprite(portrait), { x: 1, y: 1 }));
  if (onPortrait) {
    const a = new Graphics().rect(0, 0, 58, 64).fill({ color: 0, alpha: 0.001 });
    a.eventMode = "static";
    a.cursor = "pointer";
    a.label = `hero: ${h.name}`;
    a.on("pointertap", (e) => e.button !== 2 && onPortrait());
    heroPortraitHold(a, onPortrait);
    c.addChild(a);
  } else explains(modals, player, c, 0, 0, 58, 64, () => resolveText({ file: "herobios", id: h.type }), async () => (portrait ? { texture: portrait, caption: said(h.name) } : null));
  const cls = await heroClassName(h.heroClass, h);
  // (Centred as the desktop's: the name at 20, the level at 47 down the box; VCMI's CHeroWindow 190,38 / 190,65.)
  const mid = BOXES.portrait.w + 2 + nameW / 2;
  const name = label(said(h.name), "bigfont", YELLOW, "center", nameW).fit(nameW - 8).centreOn(mid, 20);
  const lvl = label((await resolveText({ file: "genrltxt", id: 342, args: [h.level, cls] })) ?? fallback(`Level ${h.level} ${cls}`), "medfont", WHITE, "center", nameW).fit(nameW - 8).centreOn(mid, 47);
  c.addChild(name, lvl);
  return block(c, "heroHead");
}

/** The skills section's place in HEROSCR4 (under the head, left of the doll): the block's own pixels start there. */
export const SKILLS_PART = HEROSCR4.parts.skills;
const PRIMARY = ["Attack", "Defense", "Power", "Knowledge"];

export interface SkillsOptions {
  /** The texts' font: the desktop's smalfont, medfont on phones (never smalfont there). */
  font?: "smalfont" | "medfont";
  /** The status bar's words while the pointer is over a piece (HEROSCRN.TXT's "View %s Info"...), "" when it leaves. */
  hover?: (text: string) => void;
}

/**
 * The hero screen's skills section, as the desktop draws it on every layout (2026-10-27: "reuse all building
 * blocks ... not modifying the presentation, just layouting, scaling to make it fit"): HEROSCR4's own boxes under the
 * head with the four primary skills named over their pictures and their values; the specialty, experience and spell
 * points with their names and values, morale and luck; the eight skill places, each with its level and name (positions
 * from VCMI's CHeroWindow). Every piece explains itself as on the original screen (a tap: its text with OK; held: the
 * popup). Drawn from SKILLS_PART's corner: the desktop puts it there over its picture, phones lay it out.
 */
export async function heroSkills(modals: Modals, player: number, h: Hero, ml: MoraleLuck, o: SkillsOptions = {}): Promise<Container> {
  const c = new Container();
  c.label = "hero: skills";
  const font = o.font ?? "smalfont";
  const [ground, pskil, secskill, morale, luck, spec, specRows, jk, lev, hs, pri] = await Promise.all([
    part(HEROSCR4, "skills", player),
    loadDef("pskil42.def"),
    loadDef("secskill.def"),
    loadDef("imrl42.def"),
    loadDef("ilck42.def"),
    specialtyIcon(h.type),
    specialties(),
    // The skills' names JKTEXT 1-4, "{Specialty}", "{Experience}", "{Spell Points}" 5-7 (VCMI's CHeroWindow).
    textTable("jktext"),
    // The secondary skills' levels (SKILLLEV.TXT); their names are SSTRAITS.TXT's first column.
    textTable("skilllev"),
    // The hovers as VCMI's CHeroWindow: HEROSCRN 1 "View %s Info" (PRISKILL's names), 27, 9, 22, 21, 3-8.
    textTable("heroscrn"),
    textTable("priskill"),
  ]);
  if (ground) c.addChild(ground);
  // (Loaded now: the first held piece's popup shouldn't wait for the big pictures.)
  for (const def of ["secsk82.def", "pskill.def", "imrl82.def", "ilck82.def"]) void loadDef(def).catch(() => null);
  // Everything at the hero screen's own coordinates, less the section's corner.
  const X = SKILLS_PART.x;
  const Y = SKILLS_PART.y;
  const put = (t: Texture | undefined, x: number, y: number) => t && c.addChild(Object.assign(new Sprite(t), { x: x - X, y: y - Y }));
  const centred = (t: Text, x: number, y: number, color: readonly [number, number, number], w: number) => c.addChild(label(t, font, color).fit(w - 2).centreOn(x - X, y - Y));
  // The labels and values sit top-left from x 69 (VCMI's CHeroWindow: 69,183 / 69,205; 69,232 / 68,252; 213,232 / 211,252).
  const at = (t: Text, x: number, y: number, color: readonly [number, number, number], w = 84) => c.addChild(Object.assign(label(t, font, color).fit(w), { x: x - X, y: y - Y }));
  const info = (x: number, y: number, w: number, h2: number, text: () => Promise<Text | null | undefined>, comp?: () => Promise<{ texture: Texture; caption: Text } | null>, hover?: string) => {
    const a = new Graphics().rect(0, 0, w, h2).fill({ color: 0, alpha: 0.001 });
    a.position.set(x - X, y - Y);
    a.hitArea = new FingerArea(a, w, h2);
    a.cursor = "pointer";
    if (hover && o.hover) a.on("pointerover", () => o.hover?.(hover)).on("pointerout", () => o.hover?.(""));
    infoArea(modals, a, player, text, comp);
    c.addChild(a);
  };
  // The primary skills: the name over the picture, the value under it.
  const prim = effectivePrimary(h);
  for (let v = 0; v < 4; v++) {
    centred(jk(1 + v, said(PRIMARY[v])), 52 + 70 * v, 99, YELLOW, 70);
    put(pskil.get(0)?.[v]?.texture, 32 + 70 * v, 111);
    centred(said(String(prim[v])), 53 + 70 * v, 166, WHITE, 60);
    const what = pri(v, said(PRIMARY[v]));
    info(30 + 70 * v, 109, 42, 64, () => resolveText({ file: "arraytxt", id: 2 + v }), () => bigFrame("pskill.def", v, said("")), hs(1, tr(`View %1 Info`, what), what));
  }
  // Specialty: its icon (UN44, by hero) and short name (HEROSPEC.TXT).
  put(spec, 18, 180);
  at(jk(5, tr("Specialty")), 69, 183, YELLOW);
  at(specRows[h.type]?.[0] ?? said(""), 69, 205, WHITE);
  info(18, 180, 136, 42, async () => specRows[h.type]?.[2], undefined, hs(27, tr("View Special Ability Info")));
  // Experience and spell points.
  put(pskil.get(0)?.[4]?.texture, 20, 230);
  put(pskil.get(0)?.[5]?.texture, 162, 230);
  at(jk(6, tr("Experience")), 69, 232, YELLOW);
  at(said(String(h.experience)), 68, 252, WHITE);
  at(jk(7, tr("Spell Points")), 213, 232, YELLOW);
  at(fmt`${h.mana ?? 0}/${maxMana(h)}`, 211, 252, WHITE);
  info(18, 228, 136, 42, () => resolveText({ file: "genrltxt", id: 2, args: [h.level, experienceForLevel(h.level + 1), h.experience] }), undefined, hs(9, tr("View Experience Info")));
  info(162, 228, 136, 42, () => resolveText({ file: "genrltxt", id: 205, args: [h.name, h.mana ?? 0, maxMana(h)] }), undefined, hs(22, tr("View Spell Points Info")));
  // Morale and luck (VCMI's MoraleLuckBox at 175,179 and 233,179): the kind, then the modifiers.
  put(morale.get(0)?.[ml.morale + 3]?.texture, 181, 183);
  put(luck.get(0)?.[ml.luck + 3]?.texture, 239, 183);
  info(175, 179, 53, 45, () => moraleLuckText(true, ml.morale, ml.moraleParts), () => bigFrame("imrl82.def", ml.morale + 3, said("")), hs(ml.morale > 0 ? 3 : ml.morale < 0 ? 5 : 4, tr("View Morale Info")));
  info(233, 179, 53, 45, () => moraleLuckText(false, ml.luck, ml.luckParts), () => bigFrame("ilck82.def", ml.luck + 3, said("")), hs(ml.luck > 0 ? 6 : ml.luck < 0 ? 8 : 7, tr("View Luck Info")));
  // Secondary skills: two columns, each with its level and name (the text box ends where the next column starts).
  const levelName = (lvl: number) => lev(lvl - 1, said(LEVEL_NAMES[lvl]));
  for (const [i, [id, lvl]] of (h.skills ?? []).slice(0, 8).entries()) {
    const x = i % 2 === 0 ? 18 : 162;
    const y = 276 + 48 * Math.floor(i / 2);
    const name = (await resolveText({ file: "sstraits", id }))?.trim() || said(SKILL_NAMES[id]);
    put(secskill.get(0)?.[id * 3 + 2 + lvl]?.texture, x, y);
    at(levelName(lvl), x + 50, y + 4, WHITE, 90);
    at(name, x + 50, y + 24, WHITE, 90);
    info(x, y, 136, 42, async () => (await skillText(id, lvl)) ?? fallback(`${levelName(lvl)} ${name}`), () => bigFrame("secsk82.def", id * 3 + 2 + lvl, fmt`${levelName(lvl)}\n${name}`), hs(21, tr(`View %1 %2 Info`, levelName(lvl), name), levelName(lvl), name));
  }
  return block(c, "heroSkills");
}

export interface DollOptions {
  data: GameData;
  hand: ArtifactHand;
  /** Which hero of the hand's this is. */
  who?: number;
  bagScroll: () => number;
  setBagScroll: (n: number) => void;
  /** Taking a worn combination apart. */
  disassemble: (slot: number) => void;
  redraw: () => void;
}

/** The paper doll (HEROSCR4's, in the player's colour) with the hero's artifacts and the backpack's five places. */
export async function heroDoll(modals: Modals, player: number, h: Hero, o: DollOptions): Promise<Container> {
  const c = new Container();
  c.label = "hero: artifacts";
  const [doll, arts] = await Promise.all([part(HEROSCR4, "doll", player), loadDef("artifact.def")]);
  if (doll) c.addChild(doll);
  const who = o.who ?? 0;
  const place = (x: number, y: number, real: number, ref: ArtifactRef, bagAt?: number) => {
    const s = new Container();
    s.position.set(x + ARTS.x - DOLL.x, y + ARTS.y - DOLL.y);
    s.addChild(new Graphics().rect(0, 0, 44, 44).fill({ color: 0, alpha: 0.001 }));
    const hp: HandPlace = { who, ...ref };
    const art = o.hand.hides(hp) ? -1 : real;
    const f = art >= 0 ? arts.get(0)?.[art] : art === LOCKED ? arts.get(0)?.[145] : undefined;
    if (f) s.addChild(Object.assign(new Sprite(f.texture), { x: f.x, y: f.y }));
    const lit = arts.get(0)?.[144];
    if (lit && ((ref.slot !== undefined && o.hand.takes(who, ref.slot)) || o.hand.framed(hp))) s.addChild(Object.assign(new Sprite(lit.texture), { x: lit.x, y: lit.y }));
    // The original's slots sit close: each takes a finger's tap, a little into the gaps.
    s.hitArea = new FingerArea(s, 44, 44);
    s.eventMode = "static";
    s.cursor = "pointer";
    s.label = art >= 0 ? `artifact: ${o.data.artifacts[art]?.name ?? art}` : "artifact: empty place";
    const wornCombo = art >= 0 && ref.slot !== undefined && !!COMBOS[art] && !!h.combos?.[ref.slot];
    const askApart = async (text: Text) => {
      const g = await gameTexts();
      const a = await messageBox(modals, fmt`${text}\n\n${g.general[733] || englishLine("genrltxt", 733)}`, player, { buttons: YES_NO, components: f ? [{ texture: f.texture, caption: NONE }] : undefined });
      if (a === "yes") o.disassemble(ref.slot!);
      return a === "yes";
    };
    // Held (the right button): the artifact's text; a worn combination asks to come apart.
    s.on("pointerdown", (e) => {
      if (e.button !== 2 || art < 0) return;
      const text = artifactText(o.data, art, h);
      if (wornCombo) void askApart(text);
      else textPopup(text, player, e.global.x, e.global.y);
    });
    s.on("pointertap", (e) => {
      if (e.button !== 0) return;
      if (!o.hand.held && wornCombo) return void askApart(artifactText(o.data, art, h)).then((done) => !done && o.hand.click(hp, bagAt));
      o.hand.click(hp, bagAt);
    });
    c.addChild(s);
  };
  SLOT_POS.forEach(([x, y], slot) => place(x, y, h.equipped?.[slot] ?? -1, { slot }));
  const bag = o.hand.bag(who);
  const scroll = bag.length > 5 ? ((o.bagScroll() % bag.length) + bag.length) % bag.length : 0;
  for (let k = 0; k < 5; k++) {
    const i = bag.length > 5 ? (scroll + k) % bag.length : k;
    place(403 + 46 * k, 365, bag[i]?.art ?? -1, { backpack: bag[i]?.index }, i);
  }
  for (const [def, x, d] of [["hsbtns3.def", 379, -1], ["hsbtns5.def", 632, 1]] as const) {
    const b = new DefButton(def, x + ARTS.x - DOLL.x, 364 + ARTS.y - DOLL.y, player);
    b.disabled = bag.length <= 5;
    b.onClick = () => (o.setBagScroll(scroll + d), o.redraw());
    c.addChild(b);
  }
  return block(c, "heroDoll");
}

/** A hero's seven places (TWCRPORT size, the count in the corner) in rows of `cols`, the usual taps and long press. */
export async function heroArmy(h: Hero, data: GameData, army: ArmyClicks, cols: number, changed: () => void, who = 0): Promise<StackGrid> {
  const g = new StackGrid(
    { size: "large", cols, gap: 4, count: "corner", countFont: "medfont", frames: true, band: h.owner },
    { creatures: data.creatures, clicks: army, who, changed, info: (slot, count) => ({ count, ...stackSkills(h, data.creatures[h.army[slot]?.creature ?? -1]) }) },
  );
  await g.set(h.army);
  return g;
}
