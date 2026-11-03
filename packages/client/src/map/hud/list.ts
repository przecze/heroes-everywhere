// The touch HUD's hero and town list: heroes (tap: select, again: the hero screen), then towns (tap: open).
import { type AdventureState, type Hero, ownTowns } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { heroPortrait, loadDef, loadImage, townIcon } from "../../assets.ts";
import { extra } from "../../settings.ts";
import { type RowSwipe, rowSwipe } from "../../ui/blocks/rowSwipe.ts";
import { screenSize } from "../../ui/screen.ts";
import { track } from "../../usage.ts";
import { garrisonMark } from "../hud.ts";
import type { MobileHud } from "../mobileHud.ts";
import { backing } from "./look.ts";

export class HeroTownList {
  /** The first row shown. */
  private scroll = 0;
  /** The list's rows, and the item's height, as last drawn (resizing it while moving the panels). */
  readonly geom = { itemH: 40, rows: 1, n: 1 };
  private swipe: RowSwipe | null = null;

  private readonly hud: MobileHud;
  constructor(hud: MobileHud) {
    this.hud = hud;
  }

  async draw(s: AdventureState, me: number, selected: number, selectedTown: number) {
    const hud = this.hud;
    // A finger's height each (the original's 32-high portraits, enlarged).
    // Upright a row is about 34 CSS pixels (the owner: the portraits covered too much, and the town's blew up
    // into squares); the rest of the touch layouts keep a finger's height.
    // (The same size in every touch layout: it was a finger high sideways and blew the town pictures up into squares.)
    const k = Math.min(2.25, Math.max(1.25, 34 / (32 * screenSize.css * hud.u)));
    // (Tight round its pictures: the owner, 2026-10-26.)
    const itemH = 32 * k + 4;
    // (Under the bar, and under the page's menu button it sits beside.)
    const top = Math.max(hud.barBottom + 8, screenSize.portrait ? 0 : hud.pageClear().bottom + 4);
    const bottom = screenSize.portrait ? hud.chip.top - 12 : hud.bottom;
    // Heroes on the map first, then those in a town's garrison (dimmed and marked; a tap opens the town).
    const mine = s.heroes.filter((h) => !h.removed && h.owner === me);
    const heroes = [...mine.filter((h) => h.garrison === undefined), ...(extra("listGarrisoned") ? mine.filter((h) => h.garrison !== undefined) : [])];
    const towns = ownTowns(s, me);
    type Item = { hero?: Hero; town?: (typeof towns)[number] };
    // The player's shape for it (2026-10-25: one column of both, or heroes and towns side by side; as many rows
    // as they want covered): set while moving the panels.
    const shape = hud.store.shape();
    const columns: Item[][] = shape.listCols === 2 ? [heroes.map((h) => ({ hero: h })), towns.map((o) => ({ town: o }))] : [[...heroes.map((h) => ({ hero: h })), ...towns.map((o) => ({ town: o }))]];
    const n = Math.max(1, ...columns.map((c) => c.length));
    const cap = shape.listRows ?? Infinity;
    // The arrows only when the list scrolls, a finger's height each.
    const arrowH = hud.finger;
    const fits = Math.min(cap, Math.floor((bottom - top - 8) / itemH)) >= n;
    const pad = fits ? 2 : arrowH;
    const room = fits ? n : Math.max(1, Math.min(cap, Math.floor((bottom - top - 2 * arrowH - 8) / itemH)));
    this.scroll = Math.max(0, Math.min(this.scroll, n - room));
    Object.assign(this.geom, { itemH, rows: room, n });
    // A finger drags the list a row at a time, as the other lists (the arrows stay for a thumb that taps).
    this.swipe ??= rowSwipe(hud.pieces.list, itemH, () => this.scroll, (t) => {
      const next = Math.max(0, Math.min(t, this.geom.n - this.geom.rows));
      if (next !== this.scroll) (this.scroll = next), void hud.redraw();
    });
    const shown = columns.map((c) => c.slice(this.scroll, this.scroll + room));
    const [sel, mob, mana] = await Promise.all([loadImage("hpsyyy.pcx"), loadDef("imobil.def").then((d) => d.get(0) ?? []), loadDef("imana.def").then((d) => d.get(0) ?? [])]);
    if (hud.root.destroyed) return;
    const c = new Container();
    const colW = 62 * k + 8;
    const width = colW * columns.length;
    const rowsShown = Math.max(1, ...shown.map((x) => x.length));
    c.addChild(backing(width, rowsShown * itemH + 2 * pad + 2));
    const arrow = (up: boolean, y: number) => {
      if (fits) return;
      const live = up ? this.scroll > 0 : this.scroll + room < n;
      const a = new Container();
      a.label = up ? "button: Scroll the list up" : "button: Scroll the list down";
      a.addChild(new Graphics().rect(0, 0, width, arrowH).fill({ color: 0, alpha: 0.001 }));
      const tri = new Graphics().poly(up ? [0, 18, 20, 0, 40, 18] : [0, 0, 20, 18, 40, 0]).fill({ color: 0xf2d674, alpha: live ? 1 : 0.25 });
      tri.position.set(width / 2 - 20, Math.round((arrowH - 18) / 2));
      a.addChild(tri);
      a.position.set(0, y);
      // A spent arrow takes no tap (and isn't a target).
      a.eventMode = live ? "static" : "none";
      a.cursor = "pointer";
      a.on("pointertap", () => {
        this.scroll = Math.max(0, this.scroll + (up ? -room : room));
        void hud.redraw();
      });
      c.addChild(a);
    };
    arrow(true, 0);
    shown.forEach((col, ci) => col.forEach((it, i) => {
      const item = new Container();
      item.position.set(4 + ci * colW, pad + 3 + i * itemH);
      item.scale.set(k);
      if ("hero" in it && it.hero) {
        const h = it.hero;
        // As the original hero list: movement (left) and mana (right) bars beside the portrait.
        // As the original's list: a step per 100 movement points and per 5 spell points.
        const mi = Math.min(mob.length - 1, Math.floor(h.movement / 100));
        const ai = Math.min(mana.length - 1, Math.floor((h.mana ?? 0) / 5));
        if (mob[mi]) item.addChild(Object.assign(new Sprite(mob[mi].texture), { x: 0, y: 1 }));
        void heroPortrait(h, "small").then((t) => !item.destroyed && item.addChildAt(Object.assign(new Sprite(t), { x: 7 }), 0));
        if (mana[ai]) item.addChild(Object.assign(new Sprite(mana[ai].texture), { x: 56, y: 1 }));
        if (h.id === selected) item.addChild(Object.assign(new Sprite(sel), { x: 7 }));
        if (h.asleep) item.alpha = 0.6;
        if (h.garrison !== undefined) item.addChild(new Graphics().rect(0, 0, 64, 32).fill({ color: 0, alpha: 0.45 }), garrisonMark(46, 18));
        item.on("pointertap", () => !this.swipe?.moved() && (track("hud:list hero"), hud.onHero(h.id)));
        item.on("rightdown", (e) => hud.onListInfo({ hero: h.id }, e.global.x, e.global.y));
      } else if ("town" in it && it.town) {
        const o = it.town;
        void townIcon(o.subid, o.town!.built.includes(7), !!o.town!.builtToday, "small").then((t) => t && !item.destroyed && item.addChildAt(Object.assign(new Sprite(t), { x: 7 }), 0));
        if (o.id === selectedTown) item.addChild(Object.assign(new Sprite(sel), { x: 7, width: 48 }));
        item.on("pointertap", () => !this.swipe?.moved() && (track("hud:list town"), hud.onTown(o.id)));
        item.on("rightdown", (e) => hud.onListInfo({ town: o.id }, e.global.x, e.global.y));
      }
      item.eventMode = "static";
      item.cursor = "pointer";
      c.addChild(item);
    }));
    arrow(false, pad + rowsShown * itemH);
    // (Laid out again meanwhile, a phone turned: this HUD is gone.)
    const list = hud.pieces.list;
    if (list.destroyed) return void c.destroy({ children: true });
    list.removeChildren().forEach((x) => x.destroy({ children: true }));
    list.addChild(c);
    list.position.set(screenSize.portrait ? 6 : hud.sides.listX, top);
  }
}
