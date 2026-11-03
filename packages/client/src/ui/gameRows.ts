// "Your games": one game as a row and as a card, so it is known at a glance (the map's name, your
// colour as the frame and flag, your town's picture, your strongest hero, and the last happenings
// as little icons with a line each). Pictures, not words: the hourglass says it is your move.
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { heroPortrait, loadDef, townIcon } from "../assets.ts";
import type { GameSummary } from "../gameSummary.ts";
import { eventText } from "../gameSummary.ts";
import { WHITE, YELLOW, loadFonts } from "../text.ts";
import { bigText } from "./mobilePage.ts";
import { type MapInfo } from "./newGameModel.ts";
import { said } from "../i18n/index.ts";

/** The middles of the players' colour ramps (players.pal): the frame around your town. */
export const PLAYER_RGB = [0x9d0000, 0x243b7d, 0x9b7454, 0x0f7005, 0xc45a00, 0x6b1d81, 0x2d6f75, 0x9b5564];
const PLAYER_BRIGHT = [0xe03030, 0x4a70e0, 0xd0a878, 0x30b020, 0xf08020, 0xb050d0, 0x50b0b8, 0xe08098];

interface Art {
  flags: Texture[];
  swords?: Texture;
  hourglass?: Texture;
  star?: Texture;
}
let art: Promise<Art> | null = null;
export const loadArt = () =>
  (art ??= (async () => {
    // (With the fonts: rows and cards are laid out by their texts' sizes.)
    const [flags, swords, hourglass, skills] = await Promise.all(["itgflags.def", "icm004.def", "icm006.def", "pskil32.def"].map((d) => loadDef(d).catch(() => null)).concat([loadFonts().then(() => null, () => null)]));
    return { flags: (flags?.get(0) ?? []).map((f) => f.texture), swords: swords?.get(0)?.[0]?.texture, hourglass: hourglass?.get(0)?.[0]?.texture, star: skills?.get(0)?.[4]?.texture };
  })().catch((e) => ((art = null), Promise.reject(e))));

const sized = (t: Texture, h: number) => Object.assign(new Sprite(t), { scale: { x: h / t.height, y: h / t.height } });
/** A picture in a recessed box with the colour's frame. */
function boxed(tex: Texture | null, w: number, h: number, color: number | null) {
  const c = new Container();
  c.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.45 }));
  if (tex) {
    const k = Math.min(w / tex.width, h / tex.height);
    c.addChild(Object.assign(new Sprite(tex), { scale: { x: k, y: k }, x: Math.round((w - tex.width * k) / 2), y: Math.round((h - tex.height * k) / 2) }));
  }
  c.addChild(new Graphics().rect(0, 0, w, h).stroke({ color: color === null ? 0x7a5d30 : PLAYER_BRIGHT[color], width: color === null ? 1 : 3, alignment: 1 }));
  return c;
}

const townPic = (g: GameSummary) => (g.faction >= 0 ? townIcon(g.faction, true, false, "large").catch(() => null) : Promise.resolve(null));
const heroPic = (g: GameSummary) => (g.hero ? heroPortrait({ type: g.hero.type, portrait: g.hero.portrait }, "small").catch(() => null) : Promise.resolve(null));

/** A hero's level: the experience star of the original (PSKIL32) and the number. */
function level(n: number, a: Art, x: number, y: number) {
  const out: Container[] = [];
  let at = x;
  if (a.star) {
    out.push(Object.assign(sized(a.star, 22), { x, y }));
    at += 26;
  }
  out.push(Object.assign(bigText(said(String(n)), "medfont", WHITE, 1.25), { x: at, y: y + 1 }));
  return out;
}

/** A line of a happening with its little icon. */
export function eventLine(e: GameSummary["events"][number], g: GameSummary, a: Art, w: number, k: number) {
  const row = new Container();
  const icon = e.kind === "battle" ? a.swords : a.flags[g.color];
  const ih = Math.round(16 * k);
  if (icon) row.addChild(sized(icon, ih));
  row.addChild(Object.assign(bigText(eventText(said(e.text)), "medfont", WHITE, k, { w: w - ih - 8 }), { x: ih + 6, y: 0 }));
  row.alpha = 0.85;
  return row;
}

/**
 * A game's row of height `h` and width `w`. Wide rows have the town, the hero, the name with its
 * line under it and the last two happenings; narrow ones (a phone held upright) the town and the
 * name with its line and the hero (the card below has the rest). `events: false`: none of the happenings.
 */
export async function gameRow(m: MapInfo, o: { w: number; h: number; on: boolean; events?: boolean }): Promise<Container> {
  const a = await loadArt();
  const g = m.game;
  const { w, h } = o;
  const row = new Container();
  const color = o.on ? YELLOW : WHITE;
  const wide = w >= 520;
  const [town, hero] = g ? await Promise.all([townPic(g), heroPic(g)]) : [null, null];
  const picH = Math.min(h - 12, 64);
  // Narrow, the hero goes under the name when the row is tall enough for it (a list's row), else beside the
  // town as in a wide row (the main menu's Continue card sideways), else not at all.
  const under = !wide && !!g?.hero && !!hero && h >= 52 + 38 + 8;
  const beside = !!g?.hero && (wide || (!under && w >= 400));
  let x = 10;
  if (g) {
    const tb = boxed(town, Math.round((picH * 58) / 64), picH, g.color);
    tb.position.set(x, Math.round((h - picH) / 2));
    row.addChild(tb);
    x += tb.width + 8;
    if (beside) {
      const hb = boxed(hero, 72, 48, null);
      hb.position.set(x, Math.round((h - 48) / 2));
      row.addChild(hb);
      x += 72 + 10;
    }
  }
  const tw = w - x - 10;
  const events = g && wide && o.events !== false ? g.events.slice(-2) : [];
  // The line under the name wraps onto a second when the row has the room (the main menu's Continue card sideways:
  // squeezed into one, its letters came out half as wide; The owner's note 2026-10-29 20:05).
  const subW = tw - (m.turn && a.hourglass ? 30 : 0);
  const twoLines = !events.length && !under && h >= 52 + 24 + 8;
  const sub = bigText(m.sub ?? m.title ?? said(""), "medfont", WHITE, 1.25, twoLines ? { wrap: subW } : { w: subW });
  if (twoLines) (sub.maxLines = 2), sub.redraw();
  const subLines = twoLines && sub.height > 30 ? 2 : 1;
  const block = 52 + (subLines - 1) * 24 + events.length * 24 + (under ? 38 : 0);
  const top = Math.max(4, Math.round((h - block) / 2));
  const title = bigText(said(m.name) || said(m.file), "medfont", color, 1.25, { w: tw - (g ? 30 : 0) });
  title.position.set(x, top);
  row.addChild(title);
  if (g && a.flags[g.color]) row.addChild(Object.assign(sized(a.flags[g.color], 22), { x: x + Math.min(title.width, tw - 30) + 8, y: top }));
  let y = top + 26;
  sub.alpha = 0.75;
  sub.position.set(x + (m.turn && a.hourglass ? 28 : 0), y);
  if (m.turn && a.hourglass) {
    row.addChild(Object.assign(sized(a.hourglass, 22), { x, y: y - 1 }));
    sub.alpha = 1;
  }
  row.addChild(sub);
  y += 26 * subLines;
  if (g && wide) {
    for (const e of events) {
      const l = eventLine(e, g, a, tw, 1.25);
      l.position.set(x, y);
      row.addChild(l);
      y += 24;
    }
  } else if (g?.hero && hero && under) {
    // Narrow: the hero small under the name, with its level.
    row.addChild(Object.assign(new Sprite(hero), { x, y: y + 2 }));
    row.addChild(...level(g.hero.level, a, x + 54, y + 4));
  }
  return row;
}

/** The chosen game's card: your town and hero large, what you hold, and the last happenings in full. */
export async function gameCard(m: MapInfo, w: number): Promise<Container | null> {
  const g = m.game;
  if (!g) return null;
  const a = await loadArt();
  const [town, hero] = await Promise.all([townPic(g), heroPic(g)]);
  const c = new Container();
  const tb = boxed(town, 58, 64, g.color);
  c.addChild(tb);
  let x = 58 + 10;
  if (g.hero) {
    const hb = boxed(hero, 96, 64, null);
    hb.x = x;
    c.addChild(hb);
    x += 96 + 10;
    c.addChild(Object.assign(bigText(said(g.hero.name), "medfont", YELLOW, 1.25, { w: w - x }), { x, y: 4 }));
    c.addChild(...level(g.hero.level, a, x, 34));
  }
  let y = 64 + 12;
  if (g.towns || g.heroes) {
    // What you hold: towns (your town's picture), then heroes (the hero's), each with its number.
    let cx = 0;
    for (const [pic, n] of [[town, g.towns], [hero, g.heroes]] as const) {
      if (!pic || !n) continue;
      const s = sized(pic, 28);
      s.x = cx;
      s.y = y;
      const count = bigText(said(String(n)), "medfont", WHITE, 1.25);
      count.position.set(cx + s.width + 6, y + 3);
      c.addChild(s, count);
      cx += s.width + 6 + count.width + 20;
    }
    y += 38;
  }
  for (const e of g.events ?? []) {
    const l = eventLine(e, g, a, w, 1.25);
    l.y = y;
    c.addChild(l);
    y += 26;
  }
  return c;
}
