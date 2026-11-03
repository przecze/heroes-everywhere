// The minimap: terrain coloured as VCMI's terrains.json has it (darker where blocked), owned
// objects and heroes in their players' colours, the shroud black, and the white frame of what the
// map view shows. A click or drag on it calls `onPick` with the tile.
import { maskTiles, type AdventureState, type World } from "@heroes/core";
import type { H3Map } from "@heroes/formats";
import { Container, Graphics, Sprite, Texture } from "pixi.js";

// Minimap colours per terrain (unblocked, blocked), from VCMI's terrains.json; HotA terrains approximated.
const MINI: [number, number][] = [
  [0x523808, 0x392808], [0xdecf8c, 0xa59e6b], [0x004100, 0x003000], [0xb5c7c6, 0x8c9e9c], [0x4a866b, 0x215942], [0x847131, 0x635121],
  [0x843000, 0x5a0800], [0x4a494a, 0x292829], [0x085194, 0x085194], [0x000000, 0x000000], [0x6b6b42, 0x4a4a29], [0x9c6b31, 0x734a21],
];
export const PLAYER_RGB = [0xff0000, 0x3152ff, 0x9c7352, 0x429429, 0xff8400, 0x8c299c, 0x089c9c, 0xc67b8c];

export class Minimap extends Container {
  private readonly picture = new Sprite();
  private readonly frame = new Graphics();
  private source: HTMLCanvasElement | null = null;
  private mapSize = 1;
  private readonly size: number;
  /** A tile picked (fractional, in map tiles). */
  onPick: (x: number, y: number) => void = () => {};
  /** Right-click (a long press) at a canvas point: what the minimap is. */
  onHelp: (x: number, y: number) => void = () => {};

  constructor(size: number) {
    super();
    this.size = size;
    this.addChild(this.picture, this.frame);
    this.picture.eventMode = "static";
    this.picture.cursor = "pointer";
    // The sprite is scaled to `size`, so its local coordinates are already the texture's (one pixel a tile).
    const pick = (e: { global: { x: number; y: number } }) => {
      const p = this.picture.toLocal(e.global);
      this.onPick(p.x, p.y);
    };
    let dragging = false;
    this.picture.on("pointerdown", (e) => {
      if ((e as unknown as { button?: number }).button === 2) return this.onHelp(e.global.x, e.global.y);
      dragging = true;
      pick(e);
    });
    this.picture.on("pointermove", (e) => dragging && pick(e));
    this.picture.on("pointerup", () => (dragging = false));
    this.picture.on("pointerupoutside", () => (dragging = false));
  }

  /** The picture, for windows that show the map small (quest log). */
  get texture() {
    return this.picture.texture;
  }

  /** The terrain picture, built once per map and level. */
  build(map: H3Map, world: World, level: number) {
    const n = map.size;
    this.mapSize = n;
    const c = document.createElement("canvas");
    c.width = n;
    c.height = n;
    const img = c.getContext("2d")!.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = world.index(x, y, level);
        const [free, blocked] = MINI[map.tiles[i]?.terrain ?? 9] ?? MINI[9];
        const col = world.staticBlocked[i] ? blocked : free;
        img.data.set([(col >> 16) & 255, (col >> 8) & 255, col & 255, 255], (y * n + x) * 4);
      }
    }
    c.getContext("2d")!.putImageData(img, 0, 0);
    this.source = c;
  }

  /** The white frame of the visible map area (in tiles). */
  setView(view: { x: number; y: number; w: number; h: number }) {
    const k = this.size / this.mapSize;
    const x = Math.max(0, view.x);
    const y = Math.max(0, view.y);
    this.frame
      .clear()
      .rect(x * k, y * k, Math.min(view.w, this.mapSize - x) * k, Math.min(view.h, this.mapSize - y) * k)
      .stroke({ color: 0xffffff, width: Math.max(1, this.size / 144) });
  }

  /** Redraws owned objects, heroes and the shroud over the terrain. */
  draw(s: AdventureState, world: World, level: number, me: number) {
    const src = this.source;
    if (!src) return;
    const n = this.mapSize;
    const c = document.createElement("canvas");
    c.width = n;
    c.height = n;
    const g = c.getContext("2d")!;
    g.drawImage(src, 0, 0);
    const colour = (p: number) => `#${PLAYER_RGB[p].toString(16).padStart(6, "0")}`;
    for (const o of s.objects) {
      if (o.removed || o.z !== level || o.owner < 0) continue;
      g.fillStyle = colour(o.owner);
      // Its whole footprint, as VCMI's minimap (a town is a block one sees at a glance, not a dot; The owner, 2026-10-25).
      const tiles = [...maskTiles(o.block, 0), ...maskTiles(o.visit, 1)];
      if (!tiles.length) g.fillRect(o.x - 1, o.y, 2, 1);
      for (const { dx, dy } of tiles) g.fillRect(o.x + dx, o.y + dy, 1, 1);
    }
    for (const h of s.heroes) {
      if (h.removed || h.z !== level) continue;
      g.fillStyle = colour(h.owner);
      g.fillRect(h.x, h.y, 1, 1);
    }
    const bits = s.players[me]?.revealed;
    if (bits) {
      const img = g.getImageData(0, 0, n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = world.index(x, y, level);
          if (((bits[i >> 5] >>> (i & 31)) & 1) === 0) img.data.set([0, 0, 0, 255], (y * n + x) * 4);
        }
      }
      g.putImageData(img, 0, 0);
    }
    const old = this.picture.texture;
    this.picture.texture = Texture.from(c);
    this.picture.texture.source.scaleMode = "nearest";
    this.picture.width = this.size;
    this.picture.height = this.size;
    if (old !== Texture.EMPTY) old.destroy(true);
  }
}
