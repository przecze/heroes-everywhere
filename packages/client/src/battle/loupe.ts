// Touch battles: a magnifier over the finger (as document scanners show the corner being placed).
// While a finger drags over the field, or aims with the one-handed touchpad, a round, enlarged view
// of the field around the aimed spot floats above the finger with a cross at its middle: the hex
// under the cross is the one a lift acts on. Not the original's (settings.ts EXTRAS battleLoupe).
import { type Application, Container, Graphics, Matrix, RenderTexture, Sprite, Texture, UPDATE_PRIORITY } from "pixi.js";
import { screenSize } from "../ui/screen.ts";

/** The magnifier's radius and how far above the finger its middle floats, in CSS pixels. */
const RADIUS_CSS = 58;
const LIFT_CSS = 44;
/** How much bigger than the field is drawn on the screen. */
const ZOOM = 2.2;

/** The cursors' pictures as textures, made once each (a score of them; kept for the page's life). */
const cursorTextures = new Map<HTMLCanvasElement, Texture>();
/** A cursor's picture as a texture (made once). */
export function cursorTexture(canvas: HTMLCanvasElement): Texture {
  let t = cursorTextures.get(canvas);
  if (!t) cursorTextures.set(canvas, (t = Texture.from(canvas)));
  return t;
}

export class Loupe {
  /** Goes into a layer in canvas pixels (the battle's touch layer). */
  readonly view = new Container();
  private readonly sprite = new Sprite();
  private readonly mask = new Graphics();
  private readonly ring = new Graphics();
  /** The cursor the aim would show with a mouse (a sword the way the blow lands, the arrow, the spell...), at the middle. */
  private readonly cursor = new Sprite();
  /**
   * The one picture of the field, drawn into again on every move. A new one per finger move (a whole-stage
   * render into a fresh texture, destroyed a move later, scores of times a second) hung a phone's graphics
   * (2026-10-27, an upright siege: the screen and Feedback stood still, then came back without any text).
   */
  private texture: RenderTexture | null = null;
  /** The last show() asked for, drawn once in the next frame (a finger sends several moves a frame). */
  private pending: (() => void) | null = null;
  private shape = "";

  private readonly app: Application;
  /** Told when the magnifier comes up or goes (the reading room keeps its place clear meanwhile). */
  onVisible: ((on: boolean) => void) | null = null;

  constructor(app: Application) {
    this.app = app;
    this.view.label = "panel: battle magnifier";
    this.view.eventMode = "none";
    this.view.visible = false;
    this.sprite.mask = this.mask;
    this.view.addChild(this.sprite, this.mask, this.ring, this.cursor);
  }

  /**
   * Shows `field` (the battle's field: its own render group, whose local pixels are the field's) around `at` (field
   * pixels), the magnifier's middle at `finger` (canvas pixels, the stage's) less the lift; `spot`, given its radius,
   * puts its middle somewhere else (canvas pixels), with a radius of its own if it says so. `o.shrink` runs just
   * before the picture is taken and gives back what puts things back (the stacks drawn smaller); `o.cursor`: the
   * cursor's picture and its hotspot, drawn at the middle instead of the cross.
   */
  show(...args: Parameters<Loupe["draw"]>) {
    const first = !this.pending;
    this.pending = () => this.draw(...args);
    if (!first) return;
    // Before the frame is drawn (the stage renders at a lower priority), so the magnifier shows in the same frame.
    this.app.ticker.addOnce(() => {
      const run = this.pending;
      this.pending = null;
      if (run && !this.view.destroyed) run();
    }, null, UPDATE_PRIORITY.HIGH);
  }

  private draw(
    field: Container,
    at: { x: number; y: number },
    finger: { x: number; y: number },
    spot?: (r: number) => { x: number; y: number; r?: number } | undefined,
    o: { shrink?: () => () => void; cursor?: { canvas: HTMLCanvasElement; hx: number; hy: number } } = {},
  ) {
    const css = screenSize.css || 1;
    const fixed = spot?.(Math.round(RADIUS_CSS / css));
    const r = Math.round(fixed?.r ?? RADIUS_CSS / css);
    // What the screen shows there (canvas pixels), ZOOM times bigger.
    const c = field.toGlobal(at);
    const half = r / ZOOM;
    const side = Math.max(1, Math.round(2 * half));
    const resolution = Math.min(4, ZOOM * (this.app.renderer.resolution || 1));
    // Only the field, drawn as it is on the screen (its place there and its scale), moved so `at` is in the middle.
    // (Nothing is hidden for it: hiding something makes Pixi sort the whole screen out again, now and in the next frame.)
    const transform = field.getGlobalTransform(new Matrix(), false).translate(-Math.round(c.x - half), -Math.round(c.y - half));
    const putBack = o.shrink?.();
    try {
      const t = this.texture;
      if (!t || t.destroyed || t.width !== side || t.height !== side || t.source.resolution !== resolution) {
        t?.destroy(true);
        this.texture = RenderTexture.create({ width: side, height: side, resolution });
      }
      // (Past the field's edge: dark leather's brown, not black.)
      this.app.renderer.render({ container: field, target: this.texture!, transform, clearColor: [0.23, 0.16, 0.08, 1] });
    } finally {
      putBack?.();
    }
    this.sprite.texture = this.texture!;
    this.sprite.width = this.sprite.height = 2 * r;
    this.sprite.position.set(-r, -r);
    // Where the lift acts: the cursor a mouse would show there (its hotspot on the middle), else a cross.
    const cur = o.cursor;
    // The round frame drawn again only when its size or the cross changes (not on every move).
    const shape = `${r} ${css} ${!cur}`;
    if (shape !== this.shape) {
      this.shape = shape;
      this.mask.clear().circle(0, 0, r).fill(0xffffff);
      const line = Math.max(2, Math.round(3 / css));
      const tick = Math.round(10 / css);
      this.ring.clear().circle(0, 0, r).stroke({ color: 0x000000, width: line + 2 }).circle(0, 0, r).stroke({ color: 0xffd34a, width: line });
      if (!cur) this.ring.moveTo(-tick, 0).lineTo(tick, 0).moveTo(0, -tick).lineTo(0, tick).stroke({ color: 0xffd34a, width: Math.max(1, Math.round(2 / css)) });
    }
    this.cursor.visible = !!cur;
    if (cur) {
      this.cursor.texture = cursorTexture(cur.canvas);
      // About 50 CSS pixels: clear in the magnifier at a glance, a quarter of it or less.
      const ck = Math.max(1, Math.min(1.6 / css, (r * 0.6) / Math.max(cur.canvas.width, cur.canvas.height)));
      this.cursor.scale.set(ck);
      this.cursor.position.set(Math.round(-cur.hx * ck), Math.round(-cur.hy * ck));
    }
    // Above the finger, kept on the screen (beside it when there's no room above).
    const parent = this.view.parent;
    const lift = Math.round(LIFT_CSS / css) + r;
    const g = finger;
    let gx = g.x;
    let gy = g.y - lift;
    // Or where the caller puts it (beside the field, view.ts).
    if (fixed) (gx = fixed.x), (gy = fixed.y);
    else if (gy - r < 4) {
      gy = Math.max(r + 4, g.y);
      gx = g.x + (g.x < screenSize.w / 2 ? lift : -lift);
    }
    gx = Math.max(r + 4, Math.min(screenSize.w - r - 4, gx));
    const p = parent ? parent.toLocal({ x: gx, y: gy }) : { x: gx, y: gy };
    this.view.position.set(Math.round(p.x), Math.round(p.y));
    this.view.visible = true;
    this.onVisible?.(true);
  }

  hide() {
    this.pending = null;
    if (this.view.visible) this.onVisible?.(false);
    this.view.visible = false;
  }

  destroy() {
    this.pending = null;
    this.texture?.destroy(true);
    this.texture = null;
    this.view.destroy({ children: true });
  }
}
