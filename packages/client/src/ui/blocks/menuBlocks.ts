// The menus' shared pieces on a phone (New Game, Load / Save, the Continue card, the campaign screen): the blue
// window and its recessed box (windowParts' GSELPOP1), the list's line, the scenario screen's text button, and the
// rooms of a list-and-card screen under the page's own buttons and clear of a sideways phone's navigation bar.
import { Container, Graphics, Sprite } from "pixi.js";
import { WHITE } from "../../text.ts";
import { DefButton, label } from "../kit.ts";
import { pageScale, pageSize } from "../mobilePage.ts";
import { navBarRight, pageButtons, screenSize } from "../screen.ts";
import { SCSELBCK, menuBox, menuPanel, partTexture } from "./windowParts.ts";
import { block } from "./block.ts";
import { type Text } from "../../i18n/index.ts";

/** The original's buttons at half as big again: fingers, and readable at a phone's scale. */
export const K = 1.5;
export const GOLD = 0xc9a046;

/**
 * A panel's backing: the menus' own blue window (windowParts' menuPanel, GSELPOP1's rim, filigree and marble), filled
 * in as its picture comes (at once once loaded); without the picture, opaque blue with a gold rule.
 */
export const panelBack = (w: number, h: number) => {
  const c = new Container();
  c.label = "panel";
  void menuPanel(w, h).then((p) => !c.destroyed && c.addChild(p ?? new Graphics().rect(0, 0, w, h).fill({ color: 0x0a1736 }).stroke({ color: GOLD, width: 2 })));
  return c;
};

/** A recessed box on a panel (windowParts' menuBox, the card's description box); without the picture, a darker blue. */
export const panelBox = (w: number, h: number) => {
  const c = new Container();
  c.label = "box";
  void menuBox(w, h).then((p) => !c.destroyed && c.addChild(p ?? new Graphics().rect(0, 0, w, h).fill({ color: 0x08122b }).stroke({ color: 0x5a6b9c, width: 1 })));
  return c;
};

/** The list's line under a row (SCSELBCK's grid), `w` wide. */
export const rowLine = (w: number) => {
  const c = new Container();
  void partTexture(SCSELBCK, "rowLine", -1).then((t) => !c.destroyed && c.addChild(t ? Object.assign(new Sprite(t), { width: w }) : new Graphics().rect(0, 0, w, 1).fill({ color: GOLD, alpha: 0.35 })));
  return c;
};

/** The original scenario screen's text buttons: the GSPBUTT bar with its words on it, as VCMI's. */
export async function gspButton(text: Text, onClick: () => void): Promise<Container> {
  const c = new Container();
  c.label = `button: ${text}`;
  const b = new DefButton("gspbutt.def", 0, 0);
  await b.ready;
  b.onClick = onClick;
  // The medium font (the small one is unreadable at a phone's scale), squeezed into the bar past its arrow.
  const t = label(text, "medfont", WHITE);
  const room = b.width - 22;
  if (t.width > room) t.scale.x = room / t.texture.width;
  t.position.set(16 + Math.round((room - t.width) / 2), Math.round((b.height - t.height) / 2));
  t.eventMode = "none";
  c.addChild(b, t);
  return block(c, "goldWordButton");
}

type Room = { x: number; y: number; w: number; h: number };
/** A list-and-card screen's rooms: the page's size, the top under its buttons, the list (L) and the card (C). */
export interface MenuRooms {
  W: number;
  H: number;
  top: number;
  upright: boolean;
  L: Room;
  C: Room;
}

/**
 * New Game's and Load / Save's layout for the screen now (again when the phone turns): `page` at the page's scale,
 * its backdrop `back` covering the screen, the list left and the card right (upright: the list above the card).
 */
export function menuRooms(page: Container, back: Sprite): MenuRooms {
  const { w: W, h: H } = pageSize();
  page.scale.set(pageScale());
  // Under the page's own buttons (menu, Feedback: about 48 CSS pixels high, and a finger-high button's reach above its picture) on a phone, which draws the page small.
  // Measured where the page's buttons really are (2026-11-02 11:52: upright, ☰ sat 72-112 CSS pixels down,
  // over the size filters, "barely clickable"), else the old guess.
  const pb = pageButtons();
  const below = pb && pb.bottom > 0 ? (pb.bottom + 8) / pageScale() : 72 / (screenSize.css * pageScale());
  const top = Math.max(70, Math.ceil(below));
  // The backdrop covers the screen, centred (its sides cropped on a wide one).
  const bg = back.texture;
  const cover = Math.max(W / bg.width, H / bg.height);
  back.scale.set(cover);
  back.position.set(Math.round((W - bg.width * cover) / 2), Math.round((H - bg.height * cover) / 2));
  const upright = W < H;
  const half = Math.round((H - top) * 0.5);
  const L = upright ? { x: 8, y: top, w: W - 16, h: half - 12 } : { x: 8, y: top, w: Math.round(W * 0.55) - 16, h: H - top - 8 };
  const C = upright ? { x: 8, y: top + half, w: W - 16, h: H - top - half - 8 } : { x: L.w + 24, y: top, w: W - L.w - 24 - (screenSize.portrait ? 8 : Math.max(8, Math.ceil(navBarRight() / pageScale()))), h: H - top - 8 };
  return { W, H, top, upright, L, C };
}
