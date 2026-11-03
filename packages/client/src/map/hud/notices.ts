// What the touch HUD says by itself: toasts, the status flash over the minimap, and the new day's card.
import type { AdventureState } from "@heroes/core";
import { Container, Sprite, Texture } from "pixi.js";
import { loadDef } from "../../assets.ts";
import { tr, type Text } from "../../i18n/index.ts";
import { WHITE, YELLOW } from "../../text.ts";
import { placePopup } from "../../ui/blocks/popupPlace.ts";
import type { MobileHud } from "../mobileHud.ts";
import { newDayCard } from "../newDay.ts";
import { weekDays } from "../../ui/blocks/weekDays.ts";
import { type Rgb, backing, text } from "./look.ts";

/** A toast (a short message that goes by itself): `value` on the blank backing, at most `maxWidth` wide, `pics` left of the words. */
export function toastBox(value: Text, pics: Texture[], maxWidth: number): Container {
  const sprites = pics.slice(0, 3).map((p) => Object.assign(new Sprite(p), { scale: { x: Math.min(1, 48 / p.height), y: Math.min(1, 48 / p.height) } }));
  const reserve = sprites.reduce((w, p) => w + p.width + 6, 0);
  const width = maxWidth - reserve;
  const t = text(value, "medfont", 1.5, [...WHITE] as Rgb, "center", width);
  const box = new Container();
  box.label = "toast: " + value;
  const h = Math.max(t.height, ...sprites.map((p) => p.height)) + 12;
  box.addChild(backing(width + reserve + 16, h, 0.7), t, ...sprites);
  t.position.set(8 + reserve, Math.round((h - t.height) / 2));
  let px = 8;
  for (const p of sprites) {
    p.position.set(px, Math.round((h - p.height) / 2));
    px += p.width + 6;
  }
  return box;
}

export class HudNotices {
  private box: Container | null = null;
  private dayUntil = 0;

  private readonly hud: MobileHud;
  constructor(hud: MobileHud) {
    this.hud = hud;
  }

  /**
   * What happened, shown for a moment over the minimap (2026-10-25: no toasts in the map's middle; HotA's desktop
   * uses its info box the same way): pictures with their amounts ("+3" under the wood), or a short line. A tap on it
   * opens the big minimap.
   */
  flash(pics: { texture: Texture; caption: Text }[], value: Text, ms: number) {
    const hud = this.hud;
    this.box?.destroy({ children: true });
    this.box = null;
    if (!value && !pics.length) return;
    const mini = hud.minimap.thumb?.parent;
    if (!mini || mini.destroyed || !mini.parent) return;
    const box = new Container();
    box.label = "status: " + (value || pics.map((p) => p.caption).join(" "));
    const side = Math.max(64, hud.minimap.thumbSide * mini.parent.scale.x * mini.scale.x);
    const content = new Container();
    if (pics.length) {
      // Pictures with their captions, side by side (at most three).
      pics.slice(0, 3).forEach((p, i) => {
        const sp = new Sprite(p.texture);
        sp.scale.set(Math.min(1, 44 / p.texture.height));
        const cap = text(p.caption, "medfont", 1.25, [...WHITE] as Rgb, "center", 80);
        sp.position.set(i * 84 + (80 - sp.width) / 2, 0);
        cap.position.set(i * 84, sp.height + 2);
        content.addChild(sp, cap);
      });
    } else content.addChild(text(value, "medfont", 1.25, [...WHITE] as Rgb, "center", Math.max(side, 300) - 16));
    const w = Math.max(side, content.width + 16);
    const h = Math.max(side, content.height + 16);
    box.addChild(backing(w, h, 0.85), content);
    content.position.set(Math.round((w - content.width) / 2), Math.round((h - content.height) / 2));
    // Over the minimap (a short line covers just the minimap), whole on the screen wherever the minimap was moved.
    const mb = mini.getBounds();
    box.eventMode = "static";
    box.cursor = "pointer";
    box.on("pointertap", () => {
      box.destroy({ children: true });
      this.box = null;
      hud.minimap.toggle();
    });
    hud.root.addChild(box);
    placePopup(box, { at: { x: mb.minX + mb.width / 2, y: mb.minY + mb.height / 2 } });
    this.box = box;
    setTimeout(() => {
      if (this.box !== box) return;
      box.destroy({ children: true });
      this.box = null;
    }, ms);
  }

  text(value: Text, ms = 2500) {
    this.flash([], value, ms);
  }

  /** Takes `value` down early if it is still showing (who was moving, once it's our turn). */
  drop(value: string) {
    if (!value || !this.box || this.box.destroyed || this.box.label !== "status: " + value) return;
    this.box.destroy({ children: true });
    this.box = null;
  }

  /** The original's new day animation (NEWDAY / NEWWEEKn) and the day, big in the middle for a moment. */
  newDay(s: AdventureState) {
    const hud = this.hud;
    this.dayUntil = performance.now() + 1500;
    const until = this.dayUntil;
    void (async () => {
      const card = newDayCard(s.day);
      const frames = ((await loadDef(card.def).catch(() => loadDef("newday.def"))).get(0) ?? []) as { texture: Texture; x: number; y: number }[];
      // The picture inside its box, the words under it (2026-10-27 22:44: "the new day movie doesn't fit its
      // container"): the DEF's frames each have their own offset, so the box is the union of them all, the
      // picture at most half as big again and never wider than the box.
      const BW = 280;
      const PAD = 10;
      const x0 = Math.min(...frames.map((f) => f.x ?? 0), 0);
      const y0 = Math.min(...frames.map((f) => f.y ?? 0), 0);
      const fw = Math.max(1, ...frames.map((f) => (f.x ?? 0) + f.texture.width)) - x0;
      const fh = Math.max(1, ...frames.map((f) => (f.y ?? 0) + f.texture.height)) - y0;
      const k = Math.min(1.5, (BW - 2 * PAD) / fw);
      const box = new Container();
      const sp = new Sprite(frames[0]?.texture ?? Texture.EMPTY);
      sp.scale.set(k);
      const label = text(card.newWeek ? tr(`Week %1`, card.n) : tr(`Day %1`, card.n), "bigfont", 1.5, [...YELLOW] as Rgb, "center", BW);
      const picX = Math.round((BW - fw * k) / 2);
      label.position.set(0, PAD + Math.round(fh * k) + 6);
      // The week's days under it, as by End turn (2026-10-30): today lit with its number.
      const days = weekDays(s.day, BW - 2 * PAD, 36);
      days.position.set(PAD, label.y + Math.max(30, label.height) + 4);
      const BH = days.y + days.height + PAD;
      box.addChild(backing(BW, BH, 0.7), sp, label, days);
      box.position.set(Math.round((hud.W - BW) / 2), 150);
      const place = (f: { texture: Texture; x: number; y: number }) => sp.position.set(picX + Math.round(((f.x ?? 0) - x0) * k), PAD + Math.round(((f.y ?? 0) - y0) * k));
      if (frames[0]) place(frames[0]);
      hud.root.addChild(box);
      let i = 0;
      const timer = setInterval(() => {
        if (box.destroyed || performance.now() > until + 200) {
          clearInterval(timer);
          if (!box.destroyed) box.destroy({ children: true });
          return;
        }
        const f = frames[Math.min(i++, frames.length - 1)];
        if (f) {
          sp.texture = f.texture;
          place(f);
        }
      }, 180);
    })();
  }
}
