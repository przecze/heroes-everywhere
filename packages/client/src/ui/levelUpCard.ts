// A level gained, on a phone (2026-10-26: "the level-up dialog is up for reworking"): one small window in the
// adventure map's own frame (the player's colour and gold filigree, ui/blocks/advFrame.ts) instead of a whole page.
// The hero and what went up across the top; the skills on offer as big pictures side by side (a tap picks one, a tap
// on the picked one learns it, a long press its full text); under them the picked skill's text; OK. The window grows
// to the screen as every small window does, its OK at the thumb's side one-handed (Modals.show).
import { type Hero, LEVEL_NAMES, SKILL_NAMES } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { heroPortrait, loadDef } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { tr, said, fmt } from "../i18n/index.ts";
import { DefButton, label } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { infoArea } from "./dialogs.ts";
import { heroClassName, resolveText, skillBody, textTable } from "./gameText.ts";
import { skillHelp } from "./skillHelp.ts";
import { advPanel } from "./blocks/advFrame.ts";
import { heroPortraitHold } from "./heroPortraitHold.ts";

// i18n-keys
const PRIMARY = ["Attack", "Defense", "Spell Power", "Knowledge"];

const W = 440;
const P = 18;
/** The skills' pictures (SECSKILL 44 x 44) drawn this much bigger. */
const ICON_K = 1.5;

/** Resolves with the chosen offer (index into `offer`; 0 when there's nothing to choose). */
export async function levelUpCard(modals: Modals, h: Hero, level: number, primary: number, offer: [number, number][], player: number, onHero?: () => void): Promise<number> {
  const [portrait, pskil, icons, bodies, lev, jk, cls] = await Promise.all([
    heroPortrait(h).catch(() => null),
    loadDef("pskil42.def").then((d) => d.get(0)?.[primary]?.texture).catch(() => undefined),
    loadDef("secskill.def").then((d) => d.get(0) ?? []).catch(() => []),
    Promise.all(offer.map(([id, lvl]) => skillBody(id, lvl))),
    textTable("skilllev"),
    textTable("jktext"),
    heroClassName(h.heroClass, h),
  ]);
  const names = await Promise.all(offer.map(async ([id]) => (await resolveText({ file: "sstraits", id }))?.trim() || SKILL_NAMES[id]));
  const levelLine = (await resolveText({ file: "genrltxt", id: 342, args: [level, cls] })) ?? tr(`Level %1 %2`, level, cls);
  const orText = ((await resolveText({ file: "genrltxt", id: 4 })) ?? tr("or")).trim();

  let chosen = offer.length === 1 ? 0 : -1;
  const win = new Container();
  win.label = "window: level up";
  const body = new Container();

  // ---- the hero and the primary skill gained
  const head = new Container();
  if (portrait) {
    const pic = Object.assign(new Sprite(portrait), { x: P, y: P });
    pic.label = "picture: hero";
    heroPortraitHold(pic, onHero);
    head.addChild(pic);
  }
  head.addChild(Object.assign(label(said(h.name), "bigfont", YELLOW, "left", W - 2 * P - 70 - 70), { x: P + 70, y: P + 4 }));
  head.addChild(Object.assign(label(levelLine, "medfont", WHITE, "left", W - 2 * P - 70 - 70), { x: P + 70, y: P + 34 }));
  if (pskil) infoArea(modals, head.addChild(Object.assign(new Sprite(pskil), { x: W - P - 42 - 14, y: P })), player, () => resolveText({ file: "arraytxt", id: 2 + primary }));
  const gain = label(fmt`${jk(1 + primary, tr(PRIMARY[primary]))} +1`, "medfont", YELLOW, "center", 80);
  gain.position.set(W - P - 42 - 14 + 21 - 40, P + 44);
  head.addChild(gain);

  // ---- the skills on offer
  const top = P + 64 + 14;
  const slot = (W - 2 * P) / Math.max(1, offer.length);
  const S = 44 * ICON_K;
  const frames: Graphics[] = [];
  const cards = new Container();
  offer.forEach(([id, lvl], i) => {
    const c = new Container();
    c.label = `skill: ${LEVEL_NAMES[lvl]} ${SKILL_NAMES[id]}`;
    const x = Math.round(P + slot * i + (slot - S) / 2);
    c.position.set(x, top);
    c.addChild(new Graphics().rect(-30, -4, S + 60, S + 52).fill({ color: 0, alpha: 0.001 }));
    const f = icons[id * 3 + 2 + lvl];
    if (f) c.addChild(Object.assign(new Sprite(f.texture), { width: S, height: S }));
    // VCMI's CSelectableComponent: a bright yellow frame round the picked one.
    const sel = new Graphics().rect(-2, -2, S + 4, S + 4).stroke({ color: 0xffff00, width: 2 });
    sel.visible = i === chosen;
    frames.push(sel);
    c.addChild(sel);
    const name = label(fmt`${lev(lvl - 1, said(LEVEL_NAMES[lvl]))}\n${said(names[i])}`, "medfont", WHITE, "center", slot - 8);
    name.position.set(Math.round(S / 2 - (slot - 8) / 2), S + 4);
    c.addChild(name);
    c.eventMode = "static";
    c.cursor = "pointer";
    skillHelp(c, player, id, lvl);
    c.on("pointertap", (e) => {
      if (e.button !== 0) return;
      if (chosen === i) return done();
      pick(i);
    });
    cards.addChild(c);
    if (i > 0) {
      const or = label(orText, "medfont", WHITE, "center", 60);
      or.position.set(Math.round(P + slot * i - 30), top + S / 2 - 8);
      cards.addChild(or);
    }
  });

  // ---- the picked skill's text (a hint to pick one before)
  const textTop = top + S + 58;
  const text = label(said(""), "medfont", WHITE, "center", W - 2 * P);
  text.position.set(P, textTop);
  // (As tall as the longest text, so the window doesn't jump as the pick changes.)
  const tallest = Math.max(
    18,
    ...[...bodies, tr("Choose a skill to learn:")].map((b) => {
      const t = label(b ?? said(""), "medfont", WHITE, "center", W - 2 * P);
      const v = t.height;
      t.destroy();
      return v;
    }),
  );
  const ok = new DefButton("iokay.def", 0, 0);
  const H = Math.round(textTop + (offer.length ? tallest + 12 : 0) + 30 + P + 4);
  ok.position.set(Math.round((W - 64) / 2), H - P - 30);

  const show = () => {
    frames.forEach((g, k) => (g.visible = k === chosen));
    text.value = !offer.length ? said("") : chosen < 0 ? tr("Choose a skill to learn:") : (bodies[chosen] ?? said(""));
    text.tint = chosen < 0 ? 0xe8d070 : 0xffffff;
    ok.disabled = !!offer.length && chosen < 0;
    ok.explain(modals, player, () => tr("Choose a skill to learn:"));
  };
  const pick = (i: number) => {
    chosen = i;
    show();
  };
  let close = () => {};
  let resolve = (_: number) => {};
  const done = () => {
    if (offer.length && chosen < 0) return;
    close();
    resolve(Math.max(0, chosen));
  };
  ok.onClick = done;

  win.addChild(await advPanel(W, H, player));
  body.addChild(head, cards, text, ok);
  win.addChild(body);
  show();
  return new Promise((r) => {
    resolve = r;
    close = modals.show(win, {
      onKey: (key) => {
        if (key === "Enter") done();
        else if (key === "ArrowLeft" || key === "1") pick(0);
        else if ((key === "ArrowRight" || key === "2") && offer.length > 1) pick(1);
        // (Escape doesn't skip the choice: the original's window has no Cancel.)
        return true;
      },
    });
  });
}
