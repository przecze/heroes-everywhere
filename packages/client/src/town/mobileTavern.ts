// The tavern on a phone (2026-10-26: the film, just the two heroes, the price, a big buy button; 2026-10-27 22:09:
// "portraits way too big, can put the tavern flavor gossip text instead", and a smaller window keeps the resources in
// sight): the tavern's film, the two heroes for hire side by side at the size of the original's (a tap picks, a second
// tap hires, a long press shows the hero's screen) with their names and classes, this week's rumour, then the price
// over Recruit (TPTAV01) between the Thieves' Guild (TPTAV02) and Cancel. A tap on Recruit when no hero can be hired
// says why. Upright one of phoneWindow's sheets, top to bottom; sideways the film and the rumour at one side, the heroes
// and the buy at the thumb's (one-handed: that side; else the right).
import { FRAME_PAD as P, SHEET_IN, SHEET_NAME, SHEET_TEXT, SPLIT, fitSheet, placeSideways, sidewaysScale, splitLine } from "../ui/blocks/phoneWindow.ts";
import { Container, Graphics, Sprite } from "pixi.js";
import { loadDef, heroPortrait } from "../assets.ts";
import { DefButton, label } from "../ui/kit.ts";
import { type Modals } from "../ui/modals.ts";
import { messageBox } from "../ui/dialogs.ts";
import { bigText, openPage } from "../ui/mobilePage.ts";
import { oneHand, screenSize } from "../ui/screen.ts";
import { videoSprite } from "../ui/video.ts";
import { WHITE, YELLOW } from "../text.ts";
import { said, type Text, reason } from "../i18n/index.ts";

const GAP = 8;
/** The portraits (58 x 64) this much bigger: the size the words round them are read at. */
const PK = 1.25;
/** The film's size (the original's tavern clip). */
const FILM = { w: 256, h: 120 };
/** A side's width sideways (the film's, a little more). */
const SIDE = 280;

export interface TavernOffer {
  player: number;
  /** The hero types for hire, in their two places. */
  offer: number[];
  /** Each one's name and class (the desktop's line under the portraits). */
  heroes: { name: string; cls: string }[];
  /** This week's rumour, as the barkeep whispers it. */
  rumor: string;
  cost: number;
  /** Why no hero can be hired now (the game's own words), or null. */
  why: Text | null;
  hire: (slot: number) => void;
  /** Its name over the window. */
  title?: Text;
  preview: (type: number) => void;
  thieves: () => void;
}

export async function mobileTavern(modals: Modals, t: TavernOffer): Promise<void> {
  const shell = await openPage(modals, { bare: true, title: t.title, draw: () => void draw(), keys: (k) => (k === "Enter" && !t.why && t.offer.length ? (buy(), true) : false) });
  let chosen = t.offer[0] !== undefined ? 0 : 1;
  const buy = () => {
    if (t.why || t.offer[chosen] === undefined) return void messageBox(modals, reason(t.why) ?? said(""), t.player);
    shell.close();
    t.hire(chosen);
  };
  const [portraits, gold] = await Promise.all([
    Promise.all(t.offer.map((type) => heroPortrait(type).catch(() => null))),
    loadDef("resource.def").then((d) => d.get(0)?.[6]?.texture ?? null).catch(() => null),
  ]);

  const draw = async () => {
    const recruit = new DefButton("tptav01.def", 0, 0, t.player);
    const thieves = new DefButton("tptav02.def", 0, 0, t.player);
    thieves.label = "button: thieves' guild";
    const cancel = new DefButton("icancel.def", 0, 0, t.player);
    await Promise.all([recruit.ready, thieves.ready, cancel.ready]);
    const root = new Container();
    root.label = "window: tavern";
    const upright = screenSize.portrait;
    // Upright one column the sheet's width; sideways each side SIDE wide.
    const IN = upright ? SHEET_IN : SIDE;

    // The film.
    const film = videoSprite(["tavern"], FILM.w, FILM.h, root);
    film.label = "picture: tavern film";

    // The two heroes for hire, each over its name and class, the picked one in the gold frame.
    const pw = Math.round(58 * PK);
    const ph = Math.round(64 * PK);
    const cell = Math.floor(IN / 2);
    const heroes = new Container();
    heroes.label = "panel: heroes for hire";
    const frames: Graphics[] = [];
    let lastTap = -1e9;
    const pick = (slot: number) => {
      chosen = slot;
      frames.forEach((f, i) => (f.visible = i === slot));
    };
    t.offer.forEach((type, slot) => {
      const c = new Container();
      c.label = "button: hero for hire";
      c.position.set(slot * cell, 0);
      const px = Math.round((cell - pw) / 2);
      const tex = portraits[slot];
      if (tex) c.addChild(Object.assign(new Sprite(tex), { x: px, y: 3, width: pw, height: ph }));
      const sel = new Graphics().rect(px - 3, 0, pw + 6, ph + 6).stroke({ color: 0xffff00, width: 3 });
      sel.visible = slot === chosen;
      frames.push(sel);
      c.addChild(sel);
      const who = t.heroes[slot];
      const name = bigText(said(who?.name) ?? said(""), "medfont", YELLOW, SHEET_NAME, { w: cell - 8, center: true });
      name.position.set(4, ph + 10);
      const cls = bigText(said(who?.cls) ?? said(""), "medfont", WHITE, SHEET_TEXT, { w: cell - 8, center: true });
      cls.position.set(4, name.y + name.height + 2);
      c.addChild(name, cls);
      c.eventMode = "static";
      c.cursor = "pointer";
      c.on("pointertap", () => {
        const now = performance.now();
        if (chosen === slot && now - lastTap < 400) buy();
        pick(slot);
        lastTap = now;
      });
      // A long press (the right button): the hero's screen, picked too (the original's right click).
      c.on("rightdown", () => {
        pick(slot);
        t.preview(type);
      });
      heroes.addChild(c);
    });

    // This week's rumour.
    const rumor = label(said(t.rumor), "medfont", WHITE, "center", Math.floor(IN / SHEET_TEXT));
    rumor.scale.set(SHEET_TEXT);
    rumor.label = "text: rumour";

    // The price over Recruit: the gold's small picture and the amount.
    const price = new Container();
    price.label = "picture: price";
    const amount = bigText(said(String(t.cost)), "medfont", WHITE, SHEET_TEXT);
    if (gold) price.addChild(Object.assign(new Sprite(gold), { y: Math.round((amount.height - gold.height) / 2) }));
    amount.position.set(gold ? gold.width + 6 : 0, 0);
    price.addChild(amount);
    recruit.disabled = !!t.why || !t.offer.length;
    recruit.onClick = buy;
    // Greyed, a tap still says why (the shared button's explain).
    recruit.explain(modals, t.player, () => t.why);
    thieves.onClick = t.thieves;
    cancel.onClick = () => shell.close();
    // The three buttons along the foot, Recruit in the middle and the biggest.
    const foot = (x0: number, y: number) => {
      const k = Math.min(1.6, (IN - 16) / (thieves.width + recruit.width + cancel.width));
      for (const b of [thieves, recruit, cancel]) b.scale.set(k);
      const h = Math.max(thieves.height, recruit.height, cancel.height);
      price.position.set(Math.round(x0 + (IN - price.width) / 2), y);
      const by = y + price.height + 6;
      thieves.position.set(x0, by + Math.round((h - thieves.height) / 2));
      recruit.position.set(Math.round(x0 + (IN - recruit.width) / 2), by + Math.round((h - recruit.height) / 2));
      cancel.position.set(x0 + IN - cancel.width, by + Math.round((h - cancel.height) / 2));
      root.addChild(price, thieves, recruit, cancel);
      return by + h;
    };
    const heroesH = heroes.height;

    if (upright) {
      let y = P;
      root.addChild(Object.assign(film, { x: P + Math.round((IN - FILM.w) / 2), y }));
      y += FILM.h + GAP;
      root.addChild(Object.assign(heroes, { x: P, y }));
      y += heroesH + GAP;
      root.addChild(Object.assign(rumor, { x: P + Math.round((IN - rumor.width) / 2), y }));
      y += rumor.height + GAP + 4;
      y = foot(P, y);
      fitSheet(root, y + P);
    } else {
      // Two sides: the film over the rumour, the heroes over the buy (at the thumb's side).
      const thumbLeft = oneHand() === "left";
      const fx = thumbLeft ? P + IN + SPLIT : P;
      const hx = thumbLeft ? P : P + IN + SPLIT;
      root.addChild(Object.assign(film, { x: fx + Math.round((IN - FILM.w) / 2), y: P }));
      root.addChild(Object.assign(rumor, { x: fx + Math.round((IN - rumor.width) / 2), y: P + FILM.h + GAP }));
      root.addChild(Object.assign(heroes, { x: hx, y: P }));
      const end = foot(hx, P + heroesH + GAP);
      const h = Math.max(end, rumor.y + rumor.height) - P;
      splitLine(root, P + IN, P, h, true);
      const dw = 2 * IN + 2 * P + SPLIT;
      const dh = h + 2 * P;
      placeSideways(root, dw, dh, sidewaysScale(dw, dh, P), P);
    }
    shell.setContent(root);
  };

  await draw();
  return shell.show();
}
