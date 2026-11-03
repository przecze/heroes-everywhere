// The phones' shopping lists, one look for all of them (2026-11-02 17:55: "the established pattern of these
// shopping list items, where you have the sprite on top, then the colourful bar with the title on the bottom"): the
// town hall's tile (picture, TPTHBAR's green / red / gold bar with the name, TPTHCHK's mark) half as big again, as
// many to a row as fit, and the shop's price as the resources' pictures with their amounts, never in words. Used by
// the town hall (town/mobileHall.ts) and the trading spots (ui/mobileGoods.ts: the Black Market, the Junkman, a town's
// Artifact Merchants).
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { loadDef } from "../../assets.ts";
import { WHITE } from "../../text.ts";
import { bigText } from "../mobilePage.ts";
import { screenSize } from "../screen.ts";
import { ResourceBar, compactAmount, GOLD } from "./resourceBar.ts";
import { said, num } from "../../i18n/index.ts";

/** The hall tile's size (the original's TPTHALL slot): the picture 150 x 70, the bar under it. */
export const TILE_W = 154;
export const TILE_H = 96;

/** TPTHBAR's frames: 0 gold (built / owned), 1 green (can be had), 2 red (not now), 3 grey (not here). */
export type BarState = 0 | 1 | 2 | 3;

export interface ShopTileArt {
  bars: Texture[];
  marks: Texture[];
  /** SMALRES: the price's small resource pictures. */
  res: Texture[];
}

export async function shopTileArt(): Promise<ShopTileArt> {
  const [bars, marks, res] = await Promise.all(["tpthbar.def", "tpthchk.def", "smalres.def"].map((d) => loadDef(d).catch(() => null)));
  const tex = (d: typeof bars) => (d?.get(0) ?? []).map((f) => f.texture);
  return { bars: tex(bars), marks: tex(marks), res: tex(res) };
}

/** How the tiles fill `w`: as many to a row as fit at 1.5x, upright as wide as the columns fill the screen (at most 2x). */
export function shopGrid(w: number) {
  const k0 = 1.5;
  const cols = Math.max(1, Math.floor((w + 12) / (TILE_W * k0 + 12)));
  const k = screenSize.portrait ? Math.max(k0, Math.min(2, (w - 12 * (cols - 1)) / cols / TILE_W)) : k0;
  const tileW = TILE_W * k;
  const gapX = cols > 1 ? Math.floor((w - cols * tileW) / (cols - 1)) : 0;
  return { cols, k, tileW, tileH: TILE_H * k, gapX, gapY: 12 };
}

export interface ShopTile {
  label: string;
  name: string;
  bar: BarState;
  /** The building's own 150 x 70 picture (the hall), or a small one shown big in a framed slot (an artifact). */
  picture?: Texture | null;
  /** The picture is a small one (an artifact's 44 x 44): drawn twice its size in the middle of a dark slot. */
  small?: boolean;
  /** TPTHCHK's mark at the picture's corner (-1: none). */
  mark?: number;
  /** The price (or what it brings): amounts by resource, drawn as pictures with numbers over the picture's foot. */
  price?: { resource: number; amount: number }[];
  /** Greyed (can't be had now): the picture dimmed. */
  dim?: boolean;
}

/** One tile at scale `k`, its top left at 0, 0 (TILE_W x TILE_H before the scale). */
export function shopTile(t: ShopTile, art: ShopTileArt, k: number): Container {
  const tile = new Container();
  tile.label = t.label;
  const inner = new Container();
  inner.scale.set(k);
  // The price (or what it brings) right in the picture's slot: each resource's small picture with its amount, on a
  // dark plate, as a price tag; a small picture (an artifact) in the room left of it, so the two never overlap.
  let tag: Container | null = null;
  if (t.price?.length) {
    const row = new Container();
    let x = 0;
    for (const p of t.price) {
      const icon = art.res[p.resource];
      if (icon) row.addChild(Object.assign(new Sprite(icon), { x, y: 0 }));
      x += (icon?.width ?? 0) + 2;
      const n = bigText(num(p.amount), "medfont", WHITE, 1);
      n.position.set(x, Math.round(((icon?.height ?? 18) - n.height) / 2));
      row.addChild(n);
      x += n.width + 6;
    }
    const w = Math.min(146, row.width + 8);
    const h = Math.max(22, row.height + 6);
    tag = new Container();
    tag.label = "price";
    tag.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.7 }).stroke({ color: 0xc9a046, width: 1, alpha: 0.6 }), row);
    row.position.set(4, Math.round((h - row.height) / 2));
    tag.position.set(t.small ? 152 - w - 4 : 152 - w - 2, t.small ? 2 + Math.round((70 - h) / 2) : 72 - h - 2);
  }
  if (t.small) {
    inner.addChild(new Graphics().rect(2, 2, 150, 70).fill({ color: 0x000000, alpha: 0.55 }).stroke({ color: 0xc9a046, width: 1 }));
    if (t.picture) {
      const room = (tag ? tag.x - 2 : 150) - 6;
      const s = Math.min(2, 62 / t.picture.height, room / t.picture.width);
      const sp = new Sprite(t.picture);
      sp.scale.set(s);
      sp.position.set(2 + 3 + Math.round((room - t.picture.width * s) / 2), 2 + Math.round((70 - t.picture.height * s) / 2));
      sp.alpha = t.dim ? 0.55 : 1;
      inner.addChild(sp);
    }
  } else if (t.picture) inner.addChild(Object.assign(new Sprite(t.picture), { x: 2, y: 2, alpha: t.dim ? 0.55 : 1 }));
  const b = art.bars[t.bar];
  if (b) inner.addChild(Object.assign(new Sprite(b), { x: 1, y: 73 }));
  else inner.addChild(new Graphics().rect(1, 73, 152, 20).fill({ color: [0xb08a2e, 0x2e7d32, 0x9b2a2a, 0x555555][t.bar] }));
  const m = t.mark !== undefined && t.mark >= 0 ? art.marks[t.mark] : undefined;
  if (m) inner.addChild(Object.assign(new Sprite(m), { x: 136, y: 56 }));
  if (tag) inner.addChild(tag);
  // The name on the bar in the medium font (the original's small one is unreadable on a phone).
  const name = bigText(said(t.name), "medfont", WHITE, 1, { w: 146, center: true });
  name.y = 73 + Math.round(((b?.height ?? 20) - name.height) / 2);
  name.x += 4;
  inner.addChild(name);
  tile.addChild(inner);
  return tile;
}

/** The player's resources as the town's docked bar, one row across `room` (at most twice its size): what there is to pay with. */
export async function resourceFoot(player: number, have: readonly number[], show: readonly number[], room: number): Promise<ResourceBar> {
  const bar = new ResourceBar();
  await bar.set(player, have, { show, narrow: true, format: (n, r) => compactAmount(n, r === GOLD), font: "medfont" });
  bar.label = "resource bar: resources";
  bar.scale.set(Math.min(2, room / bar.barWidth));
  return bar;
}
