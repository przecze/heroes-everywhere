// The one slider of every count window (recruit, recruit all, split, trades): VCMI's brown CSlider, IGPCRDIV's arrows
// (left 0-1, right 2-3) and knob (4) over a dark track; a press on the track jumps there and drags on, as the knob does
// (with a finger too, anywhere sideways once held; the track twice as high on touch screens). Its Min and Max are HotA's buttons beside it (`minMax`).
import { Container, Graphics, Rectangle, Sprite } from "pixi.js";
import { loadDef } from "../../assets.ts";
import { DefButton } from "../kit.ts";
import { screenSize } from "../screen.ts";
import { block } from "./block.ts";

export class Slider extends Container {
  private readonly w: number;
  private readonly thumb = new Sprite();
  private max = 0;
  private blocked = false;
  private readonly arrows: DefButton[];
  value = 0;
  /** The value changed (by the arrows, the track or the knob). */
  onChange: (value: number) => void = () => {};
  readonly ready: Promise<void>;

  /** `w` wide in all (the arrows 16 each at its ends), 16 high. */
  constructor(w: number) {
    super();
    block(this, "slider");
    this.w = w;
    this.label = "slider";
    const track = new Graphics().rect(16, 2, w - 32, 12).fill({ color: 0x000000, alpha: 0.5 });
    track.eventMode = "static";
    track.cursor = "pointer";
    // Twice the slider's height on a touch screen (the track is 12 high: a few pixels to hit on a phone; The owner's note
    // 2026-10-28), not a whole finger: the count boxes sit just under it.
    if (screenSize.touch) track.hitArea = new Rectangle(16, -8, w - 32, 32);
    let dragging = false;
    // The track jumps there and then follows the finger, as the knob does: one press takes it anywhere, to the ends too.
    track.on("pointerdown", (e) => {
      if (this.blocked || e.button === 2) return;
      dragging = true;
      this.fromX(e.global.x);
    });
    const less = new DefButton("igpcrdiv.def", 0, 0, -1, [0, 1, 1, 1]);
    const more = new DefButton("igpcrdiv.def", w - 16, 0, -1, [2, 3, 3, 3]);
    less.onClick = () => this.set(this.value - 1, true);
    more.onClick = () => this.set(this.value + 1, true);
    // The arrows' finger reach grows outwards, not over the track's ends (it took the taps meant for "all of them").
    for (const [a, outward] of [[less, -1], [more, 1]] as const)
      if (a.hitArea)
        a.hitArea = {
          contains: (x: number, y: number) => {
            const r = a.fingerBox();
            const x0 = outward < 0 ? Math.min(r.x, 16 - r.width) : 0;
            const x1 = outward < 0 ? 16 : Math.max(r.x + r.width, r.width);
            return x >= x0 && x < x1 && y >= r.y && y < r.y + r.height;
          },
        };
    this.arrows = [less, more];
    this.thumb.eventMode = "static";
    this.thumb.cursor = "pointer";
    this.thumb.on("pointerdown", () => (dragging = !this.blocked));
    this.eventMode = "static";
    this.on("globalpointermove", (e) => dragging && this.fromX(e.global.x));
    this.on("pointerup", () => (dragging = false));
    this.on("pointerupoutside", () => (dragging = false));
    this.addChild(track, this.thumb, less, more);
    this.ready = loadDef("igpcrdiv.def").then((d) => {
      const t = d.get(0)?.[4]?.texture;
      if (t) this.thumb.texture = t;
      this.place();
    });
  }

  /** The range 0..`max` and the value in it (no onChange). */
  range(max: number, value = this.value) {
    this.max = Math.max(0, max);
    this.value = Math.max(0, Math.min(this.max, value));
    this.place();
  }

  /** Nothing to pick from yet (a market before both sides are picked): the arrows grey, the knob and track rest (VCMI's block). */
  block(on: boolean) {
    this.blocked = on;
    for (const a of this.arrows) a.disabled = on;
  }

  /** One less or more, as the arrow keys do. */
  step(d: number) {
    if (!this.blocked) this.set(this.value + d, true);
  }

  /** All the way (Max). */
  toMax() {
    if (!this.blocked) this.set(this.max, true);
  }

  set(value: number, notify = false) {
    const v = Math.max(0, Math.min(this.max, Math.round(value)));
    const changed = v !== this.value;
    this.value = v;
    this.place();
    if (notify && changed) this.onChange(v);
  }

  /** The value whose knob sits under the pointer: its middle on it, so the ends are a half knob in (reachable). */
  private fromX(gx: number) {
    const knob = this.thumb.width || 16;
    const span = this.w - 32 - knob;
    const local = this.toLocal({ x: gx, y: 0 }).x - 16 - knob / 2;
    this.set((Math.max(0, Math.min(span, local)) / span) * this.max, true);
  }

  private place() {
    const span = this.w - 32 - (this.thumb.width || 16);
    this.thumb.position.set(16 + (this.max ? (this.value / this.max) * span : 0), 0);
  }
}

/** HotA's Min (three arrows down, IRCMI) and Max (three up, IRCMA) buttons, 50 x 32 each; greyed when they'd do nothing. */
export function minMax(min: () => void, max: () => void): { less: DefButton; most: DefButton } {
  const less = new DefButton("ircmi.def", 0, 0, -1, [0, 1, 2, 2]);
  const most = new DefButton("ircma.def", 0, 0, -1, [0, 1, 2, 2]);
  less.label = "button: the least";
  most.label = "button: the most";
  less.onClick = min;
  most.onClick = max;
  return { less, most };
}
