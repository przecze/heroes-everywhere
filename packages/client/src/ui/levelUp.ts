// The original level-up window (LVLUPBKG), laid out like the game (positions from VCMI's CLevelWindow).
import { heroPortraitHold } from "./heroPortraitHold.ts";
import { type Hero, LEVEL_NAMES, SKILL_NAMES } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { loadDef, heroPortrait } from "../assets.ts";
import { WHITE } from "../text.ts";
import { DefButton, label, loadImagePlayer } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { infoArea } from "./dialogs.ts";
import { resolveText, heroClassName } from "./gameText.ts";
import { levelUpCard } from "./levelUpCard.ts";
import { phoneSized } from "./screen.ts";
import { playSound } from "../audio.ts";
import { skillHelp } from "./skillHelp.ts";
import { said, fmt, type Text, fallback } from "../i18n/index.ts";

const PRIMARY = ["Attack", "Defense", "Spell Power", "Knowledge"];

/** Shows the window; resolves with the chosen option (index into `offer`). */
export async function levelUpWindow(modals: Modals, h: Hero, level: number, primary: number, offer: [number, number][], player: number, onHero?: () => void): Promise<number> {
  // The original's fanfare as the window opens (VCMI's heroNewLevel).
  void playSound("NWHEROLV");
  // Phones: a small window in the map's frame, the skills big, the picked one's text under them.
  if (phoneSized()) return levelUpCard(modals, h, level, primary, offer, player, onHero);
  const win = new Container();
  const bg = new Sprite(await loadImagePlayer("lvlupbkg.pcx", player));
  win.addChild(bg);
  const W = bg.width;
  const center = (text: Text, y: number, font: "medfont" | "smalfont" = "medfont", color = WHITE) => {
    // VCMI's CLevelWindow: CENTER labels at x 192.
    const t = label(text, font, color, "center", W - 40).centreOn(192, y);
    win.addChild(t);
  };
  // GENRLTXT 444 / 445: the original's titles (VCMI's CLevelWindow).
  center((await resolveText({ file: "genrltxt", id: 444, args: [h.name] })) ?? fallback(`${h.name} has gained a level.`), 33);
  const portrait = new Sprite(await heroPortrait(h));
  portrait.position.set(170, 66);
  heroPortraitHold(portrait, onHero);
  win.addChild(portrait);
  const cls = await heroClassName(h.heroClass, h);
  const className = cls;
  center((await resolveText({ file: "genrltxt", id: 445, args: [h.name, level, className] })) ?? fallback(`${h.name} is now a level ${level} ${className}.`), 162);
  const pskil = (await loadDef("pskil42.def")).get(0)?.[primary];
  // Held (or tapped): what the skill gained does (ARRAYTXT, as the hero screen's).
  if (pskil) infoArea(modals, win.addChild(Object.assign(new Sprite(pskil.texture), { x: 174, y: 190 })), player, () => resolveText({ file: "arraytxt", id: 2 + primary }));
  // (PRISKILL: the primary skill's name in the game files' words, the interface's language.)
  center(fmt`${(await resolveText({ file: "priskill", id: primary }))?.trim() || said(PRIMARY[primary])} +1`, 253);

  // The offered skills, side by side in the box at y 300; click selects, double click chooses.
  const icons = (await loadDef("secskill.def")).get(0) ?? [];
  let chosen = offer.length === 1 ? 0 : -1;
  const orText = said(((await resolveText({ file: "genrltxt", id: 4 })) ?? "or").trim());
  const frames: Graphics[] = [];
  const boxX = 75;
  const boxW = W - 150;
  const slot = boxW / Math.max(1, offer.length);
  return new Promise((resolve) => {
    let close = () => {};
    const pick = (i: number) => {
      chosen = i;
      frames.forEach((g, k) => (g.visible = k === i));
    };
    offer.forEach(([id, lvl], i) => {
      const c = new Container();
      const f = icons[id * 3 + 2 + lvl];
      const x = Math.round(boxX + slot * i + slot / 2 - 22);
      c.position.set(x, 300);
      if (f) c.addChild(new Sprite(f.texture));
      // VCMI's CSelectableComponent: a one-pixel bright yellow border round the picture.
      const sel = new Graphics().rect(-0.5, -0.5, 45, 45).stroke({ color: 0xffff00, width: 1 });
      sel.visible = i === chosen;
      frames.push(sel);
      c.addChild(sel);
      const name = label(fmt`${said(LEVEL_NAMES[lvl])}\n${said(SKILL_NAMES[id])}`, "smalfont", WHITE, "center", 100);
      name.position.set(22 - 50, 50);
      c.addChild(name);
      c.eventMode = "static";
      c.cursor = "pointer";
      let lastTap = 0;
      // The right button held: the skill's description (a right-click doesn't pick it).
      skillHelp(c, player, id, lvl);
      c.on("pointertap", (e) => {
        if (e.button !== 0) return;
        const now = performance.now();
        if (chosen === i && now - lastTap < 400) done();
        else pick(i);
        lastTap = now;
      });
      win.addChild(c);
      // "or" between the choices (GENRLTXT 4), level with the pictures' middle (VCMI's CComponentBox).
      if (i > 0) {
        const or = label(orText, "medfont", WHITE, "center", 60);
        or.position.set(Math.round(boxX + slot * i - 30), 300 + 22 - 8);
        win.addChild(or);
      }
    });
    const done = () => {
      if (chosen < 0) return;
      close();
      resolve(chosen);
    };
    const ok = new DefButton("iokay.def", 297, 413);
    ok.onClick = done;
    win.addChild(ok);
    close = modals.show(win, {
      onKey: (key) => {
        if (key === "Enter") done();
        else if (key === "ArrowLeft" || key === "1") pick(0);
        else if (key === "ArrowRight" || key === "2") pick(Math.min(1, offer.length - 1));
        else return true; // swallow other keys while the window is up
        return true;
      },
    });
  });
}
