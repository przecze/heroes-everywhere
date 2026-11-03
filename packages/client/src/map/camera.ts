// The adventure map's camera: where the viewport looks and how big the map is drawn, moved by
// clicks on the minimap, drags, the wheel, pinches, the arrow keys and the mouse at the screen's edge.
import type { Application, Container } from "pixi.js";
import { onPinch } from "../touch.ts";
import { onCssScale, screenSize, toGame, toGameDelta } from "../ui/screen.ts";
import { settings } from "../settings.ts";
import { covered, viewport } from "./viewport.ts";
import { TILE } from "./view.ts";
import { keepAwake, steadyTick } from "../ui/frameRate.ts";
import { smoothZoom } from "./smoothZoom.ts";

/** The map's sizes on the wheel (1 is the original's). */
// (Up to three times the original's size: the owner, 2026-10-26 22:27 "allow zoom more".)
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export interface CameraHost {
  app: Application;
  /** The map's layer, moved and scaled to show what the camera sees. */
  root: Container;
  /** The map's size in tiles (0 before a map is loaded). */
  mapSize: () => number;
  /** After every move: the minimap's frame, the world view, ambient sounds. */
  moved: (view: { x: number; y: number; w: number; h: number }) => void;
  /** Whether the map is what the player is looking at (no battle, town or window over it). */
  active: () => boolean;
}

export class MapCamera {
  x = 0;
  y = 0;
  /** Touch screens start closer in, so tiles are big enough for a finger. */
  zoom = screenSize.touch ? 1.25 : 1;
  private pinchZoom = this.zoom;
  /** The pinching fingers' middle at the last move (client px). */
  private pinchMid: { x: number; y: number } | null = null;
  private wheelSum = 0;
  private wheelAt = 0;
  private edge = { x: 0, y: 0 };

  private readonly host: CameraHost;
  /** The player moved the view themselves (a drag, the arrow keys, the screen's edge, a pinch): following allies lets go (map/follow.ts). */
  userMoved: () => void = () => {};

  constructor(host: CameraHost) {
    this.host = host;
    const canvas = host.app.canvas;
    // Edge scrolling, as in the original: the mouse at the screen's edge moves the map. In a browser window the
    // game's edge is seldom the screen's: the page's bar over it (☰, Feedback) and the margins beside it count as
    // past the edge, and the band is a finger-width of CSS pixels, not the original's 4 (2026-10-27: the top
    // 3 pixels under the bar were all there was, easy to overshoot).
    const BAND_CSS = 12;
    const edgeAt = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      // (Not over the page's own buttons and panels: the ☰ or Feedback being reached for.)
      const t = e.target as Element | null;
      if (t !== canvas && t?.closest?.("button, a, input, textarea, select, [role=dialog], .panel, #fbForm")) return void (this.edge = { x: 0, y: 0 });
      const r = canvas.getBoundingClientRect();
      const ex = e.clientX < r.left + BAND_CSS ? -1 : e.clientX > r.right - BAND_CSS ? 1 : 0;
      const ey = e.clientY < r.top + BAND_CSS ? -1 : e.clientY > r.bottom - BAND_CSS ? 1 : 0;
      // (Far outside the game's box, past a corner of it, nothing: only along its sides.)
      const near = e.clientX > r.left - 400 && e.clientX < r.right + 400 && e.clientY > r.top - 80 && e.clientY < r.bottom + 80;
      this.edge = near ? { x: ex, y: ey } : { x: 0, y: 0 };
    };
    // (The canvas's pixels per game pixel changed: the zoomed-out map's smoothing follows.)
    onCssScale.add(() => smoothZoom(host.root, this.zoom, host.app.renderer.resolution));
    window.addEventListener("pointermove", edgeAt);
    document.documentElement.addEventListener("pointerleave", () => (this.edge = { x: 0, y: 0 }));
    keepAwake(() => (!!this.edge.x || !!this.edge.y) && host.active());
    steadyTick(host.app, (tk) => {
      if ((!this.edge.x && !this.edge.y) || !host.active()) return;
      const speed = [0.25, 0.5, 1][settings().scrollSpeed] * tk.deltaMS;
      this.panBy((this.edge.x * speed) / this.zoom, (this.edge.y * speed) / this.zoom);
      this.userMoved();
    });
  }

  /** Puts the map layer where the camera looks; the middle of the view stays on the map, as in the original. */
  apply() {
    const n = this.host.mapSize();
    if (n) {
      const halfW = viewport.w / 2 / this.zoom;
      const halfH = viewport.h / 2 / this.zoom;
      // How far the view may show past the map's edge: half of it, as the original; upright (a tall
      // view) only as far as across, or half the screen would show the frame beyond the map.
      const over = screenSize.portrait ? Math.min(halfW, halfH) : null;
      // At least far enough that the edge comes out from under what the HUD lying over the map
      // covers there (mobileHud.ts), so a town at the map's edge isn't hidden under the bar or the rail.
      const span = (pos: number, half: number, o: number, before: number, after: number) => {
        // A map shorter than the view (a small one upright, or zoomed out): dragged about freely as long as half of it
        // (or half the view) stays on screen, and at least out from under the HUD (2026-10-26 21:10: upright on a
        // small map it was locked at its edge; it used to be pinned to the middle).
        if (n * TILE <= 2 * half) {
          const keep = Math.min(n * TILE, half) / 2;
          const lo = Math.min(-(2 * half - keep), -before / this.zoom);
          const hi = Math.max(n * TILE - keep, n * TILE + after / this.zoom - 2 * half);
          return Math.min(Math.max(pos, lo), hi);
        }
        const lo = Math.min(TILE / 2 - o, -before / this.zoom);
        const hi = Math.max(n * TILE - TILE / 2 + o, n * TILE + after / this.zoom) - 2 * half;
        return lo > hi ? (lo + hi) / 2 : Math.min(Math.max(pos, lo), hi);
      };
      this.x = span(this.x, halfW, over ?? halfW, covered.left, covered.right);
      this.y = span(this.y, halfH, over ?? halfH, covered.top, covered.bottom);
    }
    this.host.root.scale.set(this.zoom);
    smoothZoom(this.host.root, this.zoom, this.host.app.renderer.resolution);
    this.host.root.position.set(Math.round(-this.x * this.zoom), Math.round(-this.y * this.zoom));
    this.host.moved({ x: this.x / TILE, y: this.y / TILE, w: viewport.w / this.zoom / TILE, h: viewport.h / this.zoom / TILE });
  }

  /** The tile in the middle of the view. */
  get center() {
    return { x: (this.x + viewport.w / 2 / this.zoom) / TILE, y: (this.y + viewport.h / 2 / this.zoom) / TILE };
  }

  /**
   * Brings a tile to the middle of the open part of the view: not the viewport's own middle, which upright lies under
   * the HUD's bottom half (the bar, the chip, the buttons cover half the screen there). Centred there, the next tap on
   * a selected hero or town in the list opens it (2026-10-29: the second tap only centred it again).
   */
  centerOn(x: number, y: number) {
    const midX = (covered.left + viewport.w - covered.right) / 2;
    const midY = (covered.top + viewport.h - covered.bottom) / 2;
    this.x = x * TILE + TILE / 2 - midX / this.zoom;
    this.y = y * TILE + TILE / 2 - midY / this.zoom;
    this.apply();
    this.centred = { tx: x, ty: y, x: this.x, y: this.y, zoom: this.zoom };
  }
  private centred: { tx: number; ty: number; x: number; y: number; zoom: number } | null = null;

  /**
   * Is the tile in view for a tap that "opens what's selected once it's in view": in the open part, or where the last
   * centring put the view and nothing has moved it since (at a map's corner the clamp may leave it under the HUD;
   * centring again would change nothing, so the tap must open it).
   */
  brought(tx: number, ty: number): boolean {
    if (this.shows(tx, ty)) return true;
    const c = this.centred;
    return !!c && c.tx === tx && c.ty === ty && c.zoom === this.zoom && Math.abs(c.x - this.x) < 1 && Math.abs(c.y - this.y) < 1;
  }

  /** Moves the view by map pixels. */
  panBy(dx: number, dy: number) {
    this.x += dx;
    this.y += dy;
    this.apply();
  }

  /** A drag on the screen by (dx, dy) CSS pixels: the map follows the finger. */
  dragBy(dx: number, dy: number) {
    const d = toGameDelta(dx, dy);
    this.panBy(-d.x / this.zoom, -d.y / this.zoom);
    this.userMoved();
  }

  /** The arrow keys: a few tiles at the scrolling speed. */
  step(dx: number, dy: number) {
    const step = (TILE * [2, 4, 8][settings().scrollSpeed]) / this.zoom;
    this.panBy(dx * step, dy * step);
    this.userMoved();
  }

  /** The viewport grew or shrank by `dw` game pixels (a rotation, the touch layout): keep its middle. */
  widened(dw: number) {
    this.x -= dw / 2 / this.zoom;
    this.apply();
  }

  /** The tile under a pointer. */
  tileAt(clientX: number, clientY: number) {
    const g = toGame(clientX, clientY);
    return { x: Math.floor(((g.x - viewport.x) / this.zoom + this.x) / TILE), y: Math.floor(((g.y - viewport.y) / this.zoom + this.y) / TILE) };
  }

  /** Where a tile's middle is on the page (client pixels), or null when it's out of the viewport (agent.ts tilePoint). */
  clientOf(tx: number, ty: number): { x: number; y: number } | null {
    const gx = viewport.x + ((tx + 0.5) * TILE - this.x) * this.zoom;
    const gy = viewport.y + ((ty + 0.5) * TILE - this.y) * this.zoom;
    if (gx < viewport.x || gy < viewport.y || gx >= viewport.x + viewport.w || gy >= viewport.y + viewport.h) return null;
    const c = document.querySelector("#stage canvas");
    if (!c || screenSize.sideways) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left + (gx / screenSize.w) * r.width, y: r.top + (gy / screenSize.h) * r.height };
  }

  /** Is the tile's middle in the open part of the view (not under the HUD's panels along the edges)? */
  shows(tx: number, ty: number): boolean {
    const gx = viewport.x + ((tx + 0.5) * TILE - this.x) * this.zoom;
    const gy = viewport.y + ((ty + 0.5) * TILE - this.y) * this.zoom;
    return gx >= viewport.x + covered.left && gy >= viewport.y + covered.top && gx < viewport.x + viewport.w - covered.right && gy < viewport.y + viewport.h - covered.bottom;
  }

  /** Is the pointer over the map viewport (not the frame or side panel)? */
  inViewport(clientX: number, clientY: number) {
    const { x: px, y: py } = toGame(clientX, clientY);
    return px >= viewport.x && py >= viewport.y && px < viewport.x + viewport.w && py < viewport.y + viewport.h;
  }

  /** Zooms keeping the map spot under the pointer where it is (or, given `to`, moving it there: a pinch's fingers pan too). */
  private zoomAround(zoom: number, clientX: number, clientY: number, to?: { x: number; y: number }) {
    const g = toGame(clientX, clientY);
    const wx = (g.x - viewport.x) / this.zoom + this.x;
    const wy = (g.y - viewport.y) / this.zoom + this.y;
    const n = to ? toGame(to.x, to.y) : g;
    this.zoom = zoom;
    this.x = wx - (n.x - viewport.x) / zoom;
    this.y = wy - (n.y - viewport.y) / zoom;
    this.apply();
  }

  /** Keypad + / - step through the wheel's sizes, Backspace goes back to the original's (VCMI's adventureZoomIn / Out / Reset), around the middle of the view. */
  zoomKey(d: -1 | 0 | 1) {
    const i = ZOOMS.findIndex((z) => z >= this.zoom - 0.01);
    const zoom = d === 0 ? 1 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + d))];
    if (zoom === this.zoom) return;
    const cx = this.x + viewport.w / 2 / this.zoom;
    const cy = this.y + viewport.h / 2 / this.zoom;
    this.zoom = this.pinchZoom = zoom;
    this.x = cx - viewport.w / 2 / zoom;
    this.y = cy - viewport.h / 2 / zoom;
    this.apply();
  }

  /** Two fingers: zoom around the point between them, between half and three times the original's size. */
  listenPinch(allowed: () => boolean, started: () => void) {
    onPinch(
      (ratio, cx, cy) => {
        if (!allowed()) return;
        this.pinchZoom = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], this.pinchZoom * ratio));
        // The spot under the fingers' last middle follows them (zoom and pan together, as a photo does).
        const from = this.pinchMid ?? { x: cx, y: cy };
        this.pinchMid = { x: cx, y: cy };
        // Close to the original's size it sticks there, so a pinch can end on it.
        this.zoomAround(Math.abs(this.pinchZoom - 1) < 0.08 ? 1 : this.pinchZoom, from.x, from.y, { x: cx, y: cy });
        this.userMoved();
      },
      () => {
        started();
        this.pinchZoom = this.zoom;
        this.pinchMid = null;
      },
      allowed,
    );
  }

  /**
   * The wheel steps through a few fixed sizes, one step per notch (a touchpad's stream of small
   * deltas adds up to a notch, and a step waits for the last one to settle), around the pointer.
   */
  wheel(e: WheelEvent) {
    const now = performance.now();
    if (now - this.wheelAt < 250) return;
    this.wheelSum += e.deltaMode === 0 ? e.deltaY : e.deltaY * 40;
    if (Math.abs(this.wheelSum) < 40) return;
    const i = ZOOMS.findIndex((z) => z >= this.zoom - 0.01);
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + (this.wheelSum < 0 ? 1 : -1)))];
    this.wheelSum = 0;
    this.wheelAt = now;
    if (next === this.zoom) return;
    this.pinchZoom = next;
    this.zoomAround(next, e.clientX, e.clientY);
  }
}
