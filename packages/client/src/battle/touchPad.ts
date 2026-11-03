// The one-handed and upright battle's touchpad, its teaching (battle/touchLayout.ts draws the pad itself): the window
// that explains it the first time on a device, with a small moving demo, and the faint finger that glides over it
// until it is used, or again when the field is tapped twice in a row instead (EXTRAS padTips).
import { Container, Graphics, RenderTexture, Sprite, type Texture, Ticker } from "pixi.js";
import { YELLOW, placeByText } from "../text.ts";
import { DefButton, blankButtonNow, label } from "../ui/kit.ts";
import { type Modals } from "../ui/modals.ts";
import { messageWindow } from "../ui/dialogs.ts";
import { fingerPx, screenSize } from "../ui/screen.ts";
import { SCREEN_H, SCREEN_W } from "./layout.ts";
import { extra } from "../settings.ts";
import { GOLD as GOLD_TRIM } from "../ui/blocks/menuBlocks.ts";
import { tr, fmt, said } from "../i18n/index.ts";

/** What the teaching reads from the touch layout, as it is now. */
export interface PadHost {
  pad: () => Container | null;
  padSize: () => { w: number; h: number } | null;
  layer: () => Container;
  modals: () => Modals;
  player: () => number;
  fieldShot: () => Texture | null;
  hand: () => "left" | "right" | null;
  navBar: () => number;
  gridTop: () => number;
}

export function stored(key: string): boolean {
  try {
    return !!localStorage.getItem(key);
  } catch {
    return false;
  }
}
export function store(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // (No storage.)
  }
}

export class PadTips {
  private readonly h: PadHost;
  constructor(h: PadHost) {
    this.h = h;
  }

  /** The field tapped since the pad was last used (two: the finger shows again). */
  private fieldTaps = 0;
  private ghostUntil = 0;
  private ghost: Graphics | null = null;


  /**
   * The pad's first appearance on this device: what it is for, in a window (EXTRAS padTips), with a small moving
   * demo of it (2026-10-27: "richer, with an animation"): the field as it stands, a thumb sliding on a pad under
   * it, the gold ring following on the field and the magnifier showing that spot between the two, as the layout has
   * them; the thumb lifts and the ring flashes. (The key's "2": everyone sees this one once, also who saw the plain one.)
   */
  tutorialOnce() {
    if (stored("heroes.padTutorial2")) return;
    store("heroes.padTutorial2");
    // After the battle's opening (the field, the queue) is up, and not over another window.
    setTimeout(() => {
      const pad = this.h.pad();
      if (!pad || pad.destroyed || this.h.modals().open) return;
      void this.tutorial();
    }, 1500);
  }

  private async tutorial() {
    const act = extra("battleLoupe") ? tr("Let go to do it.") : tr("Tap the pad to do it.");
    const text = fmt`${tr("The touchpad aims for you. Slide your thumb on it: a gold ring moves over the field, and the magnifier beside the field shows the hex and the cursor (where the stack goes, which side it strikes from, a shot).")} ${act} ${tr("Tapping the field works too.")}`;
    const DW = 300;
    const DH = 250;
    const slot = RenderTexture.create({ width: DW, height: DH });
    const { win, width, height, buttonsW } = await messageWindow(text, this.h.player(), { title: tr("The touchpad"), components: [{ texture: slot, caption: said("") }] }, 1);
    const holder = win.children.find((c) => c instanceof Sprite && c.texture === slot);
    if (holder) {
      const demo = this.padDemo(DW, DH);
      demo.position.copyFrom(holder.position);
      win.addChild(demo);
    }
    await new Promise<void>((resolve) => {
      let close = () => {};
      const done = () => (close(), slot.destroy(true), resolve());
      const ok = new DefButton("iokay.def", Math.round((width - buttonsW) / 2), height - 16 - 30);
      ok.onClick = done;
      win.addChild(ok);
      // Not over the pad and its buttons it talks about: in the screen's biggest room beside the pad, as big as fits.
      const outer = new Container();
      outer.addChild(win);
      const room = () => this.roomBesidePad(width, height);
      const place = () => {
        const r = room();
        if (!r) return null;
        win.scale.set(r.k);
        return r;
      };
      place();
      close = this.h.modals().show(outer, {
        x: () => place()?.x ?? Math.round((SCREEN_W - width) / 2),
        y: () => room()?.y ?? Math.round((SCREEN_H - height) / 2),
        onKey: (k) => (k === "Enter" || k === " " || k === "Escape" ? (done(), true) : false),
      });
    });
  }

  /**
   * Where a `w` x `h` window goes without covering the pad (and, upright, the buttons under it): the biggest of the
   * rooms above, below, left and right of them on the screen, in the windows' layer's pixels, with its scale; null
   * without a pad.
   */
  private roomBesidePad(w: number, h: number): { x: number; y: number; k: number } | null {
    const pad = this.h.pad();
    if (!pad || pad.destroyed) return null;
    const b = pad.getBounds();
    // Upright the buttons' row is under the pad: kept clear with it; the top band too.
    const top = screenSize.portrait ? this.h.layer().toGlobal({ x: 0, y: -4 }).y : 0;
    const box = { x0: b.x, y0: b.y, x1: b.x + b.width, y1: screenSize.portrait ? this.h.layer().toGlobal({ x: 0, y: this.h.gridTop() + 120 }).y : b.y + b.height };
    const W = screenSize.w;
    const H = screenSize.h;
    const m = 8;
    const rooms = [
      { x0: 0, y0: top, x1: W, y1: box.y0 },
      { x0: 0, y0: box.y1, x1: W, y1: H },
      { x0: 0, y0: top, x1: box.x0, y1: H },
      { x0: box.x1, y0: top, x1: W - (this.h.hand() === "right" ? this.h.navBar() : 0), y1: H },
    ].map((r) => ({ ...r, k: Math.min((r.x1 - r.x0 - 2 * m) / w, (r.y1 - r.y0 - 2 * m) / h, 1.6) }));
    const best = rooms.reduce((a, r) => (r.k > a.k ? r : a));
    if (best.k < 0.5) return null;
    // Global pixels to the windows' layer's.
    const root = this.h.modals().root;
    const at = root.toLocal({ x: (best.x0 + best.x1 - w * best.k) / 2, y: (best.y0 + best.y1 - h * best.k) / 2 });
    return { x: Math.round(at.x), y: Math.round(at.y), k: best.k };
  }

  /** The tutorial's demo, `w` x `h`: the field, the magnifier, the pad, the thumb and the ring moving in a loop. */
  private padDemo(w: number, h: number): Container {
    const c = new Container();
    c.label = "picture: touchpad demo";
    const shot = this.h.fieldShot();
    c.once("destroyed", () => shot?.destroy(true));
    const fieldH = Math.round(h * 0.44);
    const loupeR = Math.round(h * 0.13);
    const padH = Math.round(h * 0.26);
    const padY = h - padH;
    const loupeY = Math.round(fieldH + (padY - fieldH) / 2);
    // The field (a brown box without its picture), framed in gold.
    const field = new Container();
    let fk = 1;
    if (shot) {
      fk = Math.min(w / shot.width, fieldH / shot.height);
      const sp = Object.assign(new Sprite(shot), { width: shot.width * fk, height: shot.height * fk });
      field.addChild(sp);
    } else field.addChild(new Graphics().rect(0, 0, w, fieldH).fill(0x5a4a2a));
    const fw = shot ? shot.width * fk : w;
    const fh = shot ? shot.height * fk : fieldH;
    field.position.set(Math.round((w - fw) / 2), 0);
    field.addChild(new Graphics().rect(0, 0, fw, fh).stroke({ color: GOLD_TRIM, width: 2 }));
    const ring = new Graphics().circle(0, 0, 9).stroke({ color: 0x000000, width: 4 }).circle(0, 0, 9).stroke({ color: 0xffd34a, width: 2 });
    field.addChild(ring);
    c.addChild(field);
    // The magnifier: the field around the ring, bigger, in a gold circle.
    const ZOOM = 3;
    const lens = new Container();
    lens.position.set(Math.round(w / 2), loupeY);
    const mask = new Graphics().circle(0, 0, loupeR).fill(0xffffff);
    const zoomed = shot ? Object.assign(new Sprite(shot), { width: fw * ZOOM, height: fh * ZOOM }) : new Graphics().rect(0, 0, fw * ZOOM, fh * ZOOM).fill(0x5a4a2a);
    zoomed.mask = mask;
    lens.addChild(new Graphics().circle(0, 0, loupeR).fill(0x3a2814), zoomed, mask);
    lens.addChild(new Graphics().circle(0, 0, loupeR).stroke({ color: 0x000000, width: 5 }).circle(0, 0, loupeR).stroke({ color: 0xffd34a, width: 3 }));
    lens.addChild(new Graphics().moveTo(-6, 0).lineTo(6, 0).moveTo(0, -6).lineTo(0, 6).stroke({ color: 0xffd34a, width: 2 }));
    c.addChild(lens);
    // The pad: the original's brown button face, its two lines, and the thumb.
    const pad = new Container();
    pad.position.set(0, padY);
    pad.addChild(blankButtonNow(w, padH));
    const hint = label(tr("Slide here to aim"), "medfont", YELLOW, "center", w);
    placeByText(() => hint.destroyed || hint.position.set(0, Math.round(padH / 2 - hint.height / 2)));
    hint.alpha = 0.7;
    pad.addChild(hint);
    const thumb = new Graphics();
    for (let i = 4; i >= 1; i--) thumb.circle(0, 0, 16 * (0.7 + i * 0.12)).fill({ color: 0x000000, alpha: 0.16 });
    thumb.circle(0, 0, 11).fill({ color: 0xf2d674, alpha: 0.55 }).stroke({ color: 0xf2d674, width: 2, alpha: 0.9 });
    pad.addChild(thumb);
    c.addChild(pad);
    // A loop of 3.6 s: the thumb comes down, slides (the ring and the magnifier follow), lifts; the ring flashes.
    const t0 = performance.now();
    const from = { x: 0.3, y: 0.7 };
    const to = { x: 0.72, y: 0.3 };
    const tick = () => {
      if (c.destroyed) return void Ticker.shared.remove(tick);
      const p = ((performance.now() - t0) % 3600) / 3600;
      const s = Math.max(0, Math.min(1, (p - 0.12) / 0.6));
      const e = s * s * (3 - 2 * s);
      const down = p > 0.05 && p < 0.8;
      thumb.alpha = down ? Math.min(1, (p - 0.05) * 20) : 0;
      thumb.position.set(w * (from.x + (to.x - from.x) * e), padH * (from.y + (to.y - from.y) * e));
      // The ring over the field: the pad's slide carried across it, from a stack's side towards the enemy's.
      const rx = fw * (0.25 + 0.5 * e);
      const ry = fh * (0.62 - 0.3 * e);
      ring.position.set(rx, ry);
      const flash = p >= 0.8 && p < 0.95;
      ring.scale.set(flash ? 1 + (p - 0.8) * 6 : 1);
      ring.alpha = flash ? 1 - (p - 0.8) / 0.15 : 1;
      lens.alpha = down ? 1 : Math.max(0, 1 - (p - 0.8) * 8);
      zoomed.position.set(-rx * ZOOM, -ry * ZOOM);
    };
    Ticker.shared.add(tick);
    return c;
  }

  /** The pad used: no more nudges till the field gets tapped again. */
  used() {
    this.fieldTaps = 0;
    this.ghostUntil = 0;
    store("heroes.padUsed");
  }

  /** The field was tapped (not the pad): the second time in a row, the finger glides over the pad again for a while. */
  fieldTapped() {
    if (!extra("padTips") || this.nudged) return;
    // Once a battle: a player set on tapping their moves is left to it (2026-10-27: the finger floating over the pad
    // the whole time was distracting).
    if (++this.fieldTaps >= 2) (this.nudged = true), this.showGhost(4500);
  }
  /** The finger shown again this battle already (fieldTapped). */
  private nudged = false;

  /** A faint finger's shadow sliding across the pad and back, for `ms`. */
  showGhost(ms: number) {
    this.ghostUntil = performance.now() + ms;
    if (this.ghost && !this.ghost.destroyed) return;
    const g = new Graphics();
    g.label = "hint: finger on the pad";
    g.eventMode = "none";
    const R = Math.max(14, Math.round(fingerPx() / (this.h.layer().worldTransform.a || 1) / 2.4));
    // A soft round shadow: rings fading outwards.
    for (let i = 4; i >= 1; i--) g.circle(0, 0, R * (0.7 + i * 0.12)).fill({ color: 0x000000, alpha: 0.16 });
    g.circle(0, 0, R * 0.7).fill({ color: 0xf2d674, alpha: 0.35 }).stroke({ color: 0xf2d674, width: 2, alpha: 0.6 });
    this.ghost = g;
    const t0 = performance.now();
    const tick = () => {
      const pad = this.h.pad();
      if (!pad || pad.destroyed || g.destroyed || performance.now() > this.ghostUntil) {
        Ticker.shared.remove(tick);
        if (!g.destroyed) g.destroy();
        if (this.ghost === g) this.ghost = null;
        return;
      }
      if (g.parent !== pad) pad.addChild(g);
      const { w, h } = this.h.padSize() ?? { w: 0, h: 0 };
      // Across and up, then back, in 2.4 s: as a thumb aiming at a stack.
      const p = ((performance.now() - t0) % 2400) / 2400;
      const s = p < 0.5 ? p * 2 : 2 - p * 2;
      const e = s * s * (3 - 2 * s);
      g.position.set(w * (0.25 + 0.5 * e), h * (0.7 - 0.4 * e));
      g.alpha = Math.min(1, Math.min(p, 1 - p) * 8);
    };
    Ticker.shared.add(tick);
  }
}
