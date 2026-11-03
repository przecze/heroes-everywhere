import type { AdventureState, Hero } from "@heroes/core";
import { label } from "../ui/kit.ts";
import { WHITE, YELLOW } from "../text.ts";
import { AIRSHIP, HERO_CLASSES, maskTiles, visitOffset } from "@heroes/core";
import { type H3Map, type MapTile, decodeDef, indexedToRgba } from "@heroes/formats";
import { type Application, BufferImageSource, Container, Graphics, type Rectangle, Sprite, Texture } from "pixi.js";
import { type DefTextures, fetchRes, loadDef, loadDefFlagged, loadFlagOnly, loadFrameCanvases } from "../assets.ts";
import { steadyTick } from "../ui/frameRate.ts";
import { drawOrder } from "./drawOrder.ts";
import { townLook } from "./townLook.ts";
import { screenSize } from "../ui/screen.ts";
import { playSound } from "../audio.ts";
import { extra } from "../settings.ts";
import { NONE, type Text } from "../i18n/index.ts";

export const TILE = 32;
const CHUNK = 16; // tiles per terrain chunk side
/** Opening a map on a spot: the objects this many tiles around it are drawn before it shows (a screen and more). */
const NEAR = 28;
/** Ground pictures (terrain, shroud) kept beyond those needed soon, of each kind (MapView.keepGround). */
const KEEP_GROUND = 24;

// Indexed by the map's terrain / river / road ids.
const TERRAIN_DEFS = ["dirttl", "sandtl", "grastl", "snowtl", "swmptl", "rougtl", "subbtl", "lavatl", "watrtl", "rocktl", "hota/highlands/tiles", "hota/wasteland/tiles"];
const RIVER_DEFS = ["", "clrrvr", "icyrvr", "mudrvr", "lavrvr"];
const ROAD_DEFS = ["", "dirtrd", "gravrd", "cobbrd"];

type FrameCanvas = { canvas: HTMLCanvasElement; x: number; y: number; pixels?: Uint8Array; width?: number };

/**
 * Water, lava and three of the rivers flow by palette cycling, as in the original (VCMI's
 * terrains.json / rivers.json paletteAnimation): every 180 ms tick each run of palette entries
 * moves one place. Indexed by the map's terrain id (lava 7, water 8) and river id + 16.
 * Water's second run stops at 254: the original's 14 would cycle the unused black entry 255 in.
 */
const PALETTE_CYCLES: Record<number, [number, number][]> = {
  7: [[246, 9]],
  8: [[229, 12], [242, 13]],
  17: [[183, 12], [195, 6]],
  19: [[228, 12], [183, 6], [240, 6]],
  20: [[240, 9]],
};
const defPalettes = new Map<string, Uint8Array>();

const canvasCache = new Map<string, Promise<FrameCanvas[]>>();

/** Group-0 frames of a DEF as canvases, for compositing terrain chunks. */
function defCanvases(name: string): Promise<FrameCanvas[]> {
  let p = canvasCache.get(name);
  if (!p) {
    // (HotA's own terrains, named by path, are only in the mod: no .def to ask for first.)
    p = (name.includes("/") ? Promise.reject(new Error("mod")) : fetchRes(`${name}.def`))
      .catch(async () => {
        // HotA terrains come as JSON + PNG frames.
        const groups = await loadFrameCanvases(name);
        return (groups.get(0) ?? []).map((canvas) => ({ canvas, x: 0, y: 0 }));
      })
      .then((bytes) => {
        if (!(bytes instanceof Uint8Array)) return bytes;
        const def = decodeDef(bytes);
        defPalettes.set(name, def.palette);
        return (def.groups.get(0) ?? []).map((f) => {
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, f.width);
          canvas.height = Math.max(1, f.height);
          if (f.width && f.height) {
            const rgba = indexedToRgba(f.pixels, def.palette);
            canvas.getContext("2d")!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, f.width, f.height), 0, 0);
          }
          return { canvas, x: f.x, y: f.y, pixels: f.pixels, width: f.width };
        });
      })
      .catch(() => []);
    canvasCache.set(name, p);
  }
  return p;
}

function drawFlipped(ctx: CanvasRenderingContext2D, f: FrameCanvas | undefined, px: number, py: number, flipX: boolean, flipY: boolean) {
  if (!f) return;
  ctx.save();
  ctx.translate(px + (flipX ? TILE : 0), py + (flipY ? TILE : 0));
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(f.canvas, f.x, f.y);
  ctx.restore();
}

/** Map objects that animate (windmills, campfires, flags...): all step through their frames together. */
const animated = new Set<{ sprite: Sprite; frames: NonNullable<ReturnType<DefTextures["get"]>>; x: number; y: number }>();
const FRAME_MS = 180;
let animClock = 0;

/** Advances every animated map object; frames are trimmed, so each one has its own offset. */
export function tickMapAnimations(ms: number) {
  animClock += ms;
  const step = Math.floor(animClock / FRAME_MS);
  for (const a of animated) {
    if (a.sprite.destroyed) {
      animated.delete(a);
      continue;
    }
    // (Off screen: culled, nothing to draw; it takes up the clock's frame when it comes back.)
    if (!a.sprite.visible) continue;
    const f = a.frames[step % a.frames.length];
    if (a.sprite.texture === f.texture) continue;
    a.sprite.texture = f.texture;
    a.sprite.position.set(a.x - f.fullWidth + f.x, a.y - f.fullHeight + f.y);
  }
}

/** Places a DEF with its bottom-right tile at (x, y), animated when it has more than one frame. */
function placeObject(frames: DefTextures, x: number, y: number): Sprite | null {
  const all = frames.get(0) ?? [];
  const f = all[0];
  if (!f) return null;
  const s = new Sprite(f.texture);
  s.position.set((x + 1) * TILE - f.fullWidth + f.x, (y + 1) * TILE - f.fullHeight + f.y);
  s.cullable = true;
  if (all.length > 1) animated.add({ sprite: s, frames: all, x: (x + 1) * TILE, y: (y + 1) * TILE });
  return s;
}

/**
 * A monster stands on its visitable tile. HotA's maps place many with the template that visits one tile left of the
 * anchor (mask 191) and draw them from HotA's own 96-wide pictures, the creature one tile further left; HotA.lod can't be
 * read by name, so the original 64-wide picture is drawn instead and must move left with the tile, or the creature
 * shows a tile right of where it is fought and tapped (2026-11-02). A 96-wide picture (the HotA mod's) is right as it is.
 */
function monsterShift(o: { type: number; visit: number[] }, frames: DefTextures): number {
  if (o.type !== 54) return 0;
  const f = frames.get(0)?.[0];
  const dx = visitOffset(o.visit)?.[0] ?? 0;
  return f && dx < 0 && f.fullWidth <= 64 ? dx : 0;
}

/** Hero sprite groups: 0-4 standing and 5-9 walking, for up..down; left-facing ones are mirrored. */
const HERO_GROUP = [0, 1, 2, 3, 4, 3, 2, 1];

/**
 * An empty boat facing the way its hero left it (VCMI draws boats from the boat type's own
 * AB0x_ sheet by direction; the map's AVXBOAT pictures are its right-facing frame).
 */
function placeBoat(frames: DefTextures, dir: number, x: number, y: number): Sprite | null {
  const f = frames.get(HERO_GROUP[dir] ?? 2)?.[0];
  if (!f) return null;
  const s = new Sprite(f.texture);
  const left = (x + 1) * TILE - f.fullWidth;
  if (dir >= 5) s.scale.x = -1;
  s.position.set(left + (dir >= 5 ? f.fullWidth - f.x : f.x), (y + 1) * TILE - f.fullHeight + f.y);
  s.cullable = true;
  return s;
}

/** A boat type's sheet by direction (AB0x_; HotA's airship's from the mod; the Bulwark's longboat is AB07_006 there). */
const boatSheet = (boatType: number) => loadDef(boatType === AIRSHIP ? "airship/aair00.def" : boatType === 6 ? "ab07_006.def" : `ab0${boatType + 1}_.def`);
/** Its flags in a player's colour (the letters run Red..Pink). HotA's own boats (Cove, neutral, Conflux, Bulwark) fly the first boat's flags (the mod's boats.json). */
function boatFlags(boatType: number, owner: number) {
  const colour = "lgrdbpwk"[owner] ?? "l";
  return loadDef(boatType === AIRSHIP ? `airship/aairf00${colour}.def` : `abf0${boatType <= 2 ? boatType + 1 : 1}${colour}.def`);
}

/** A hero on the map: class sprite plus the owner's waving flag. */
/** HotA's route arrows (75 frames: today green, then red and dark red by turns), from the mod's data patch. */
const HOTA_ARROWS = "mods/heroes3datapatch/mods/arrow/content/sprites/adag.def";

export class HeroSprite extends Container {
  private readonly body = new Sprite();
  private readonly flag = new Sprite();
  private frames: DefTextures | null = null;
  private flags: DefTextures | null = null;
  private t = 0;
  dir = 3;
  walking = false;
  /** The row it stands on, for the draw order. */
  tileY = 0;

  constructor() {
    super();
    this.addChild(this.flag, this.body);
  }

  /** What the sprite shows: the hero on foot, or the boat type they sail. */
  look = "";

  /** A sailing hero is drawn as their boat with a colour flag (ABF letters run Red..Pink). */
  async load(h: Hero, boatType?: number) {
    this.look = boatType === undefined ? "foot" : `boat${boatType}`;
    [this.frames, this.flags] = await Promise.all(
      boatType === undefined
        ? [loadDef(`${HERO_CLASSES[h.heroClass].mapDef}.def`), loadDef(`af0${h.owner}.def`)]
        : [boatSheet(boatType), boatFlags(boatType, h.owner)],
    );
    // The airship's flag hangs in front of its balloon (behind it, it hides when the ship faces up).
    this.setChildIndex(this.flag, boatType === AIRSHIP ? 1 : 0);
    this.dir = h.dir;
    this.apply();
  }

  /** Pixels walked so far: the walking pictures step on every 4 px, eight to a tile as in the original. */
  private walked = 0;

  /** Tile the hero stands on (sprite extends a tile right and one up). */
  placeAt(x: number, y: number) {
    const px = (x - 1) * TILE;
    const py = (y - 1) * TILE;
    if (this.walking) this.walked += Math.max(Math.abs(px - this.position.x), Math.abs(py - this.position.y));
    else this.walked = 0;
    this.position.set(px, py);
    this.apply();
  }

  tick(ms: number) {
    this.t += ms;
    this.apply();
  }

  private apply() {
    if (!this.frames || !this.flags) return;
    const g = HERO_GROUP[this.dir] + (this.walking ? 5 : 0);
    const mirror = this.dir >= 5;
    const body = this.frames.get(g) ?? [];
    const flag = this.flags.get(g) ?? [];
    // Standing: one picture and the flag waving on the map's 180 ms tick; walking: legs and flag
    // move with the distance covered (VCMI's MapRendererAdventureMovingContext).
    const k = this.walking ? Math.floor(this.walked / 4) : Math.floor(this.t / FRAME_MS);
    for (const [sprite, frames] of [[this.body, body], [this.flag, flag]] as const) {
      const f = frames[k % Math.max(1, frames.length)];
      if (!f) continue;
      sprite.texture = f.texture;
      sprite.scale.x = mirror ? -1 : 1;
      // (Sheets taller than the usual 96x64, the airship's 96x128, stand on the same bottom edge.)
      sprite.position.set(mirror ? f.fullWidth - f.x : f.x, f.y + 64 - f.fullHeight);
    }
  }
}

// The shroud's edge pieces by which neighbours are explored (VCMI's MapRenderer visBitmaps);
// ids past TSHRE's own frames are mirrored (left-right) copies of FOG_ROTATIONS.
const FOG_ROTATIONS = [22, 15, 2, 13, 12, 16, 28, 17, 20, 19, 7, 24, 26, 25, 30, 32, 27];
// prettier-ignore
const FOG_BITMAPS = [
  -1, 34, 4, 4, 22, 23, 4, 4, 36, 36, 38, 38, 47, 47, 38, 38, 3, 25, 12, 12, 3, 25, 12, 12, 9, 9, 6, 6, 9, 9, 6, 6,
  35, 39, 48, 48, 41, 43, 48, 48, 36, 36, 38, 38, 47, 47, 38, 38, 26, 49, 28, 28, 26, 49, 28, 28, 9, 9, 6, 6, 9, 9, 6, 6,
  0, 45, 29, 29, 24, 33, 29, 29, 37, 37, 7, 7, 50, 50, 7, 7, 13, 27, 44, 44, 13, 27, 44, 44, 8, 8, 10, 10, 8, 8, 10, 10,
  0, 45, 29, 29, 24, 33, 29, 29, 37, 37, 7, 7, 50, 50, 7, 7, 13, 27, 44, 44, 13, 27, 44, 44, 8, 8, 10, 10, 8, 8, 10, 10,
  15, 17, 30, 30, 16, 19, 30, 30, 46, 46, 40, 40, 32, 32, 40, 40, 2, 25, 12, 12, 2, 25, 12, 12, 9, 9, 6, 6, 9, 9, 6, 6,
  18, 42, 31, 31, 20, 21, 31, 31, 46, 46, 40, 40, 32, 32, 40, 40, 26, 49, 28, 28, 26, 49, 28, 28, 9, 9, 6, 6, 9, 9, 6, 6,
  0, 45, 29, 29, 24, 33, 29, 29, 37, 37, 7, 7, 50, 50, 7, 7, 13, 27, 44, 44, 13, 27, 44, 44, 8, 8, 10, 10, 8, 8, 10, 10,
  0, 45, 29, 29, 24, 33, 29, 29, 37, 37, 7, 7, 50, 50, 7, 7, 13, 27, 44, 44, 13, 27, 44, 44, 8, 8, 10, 10, 8, 8, 10, 10,
];

/** A 16 x 16-tile piece of the shroud: what goes on each tile (MapView.drawFog), and its picture while near the screen. */
interface FogChunk {
  cx: number;
  cy: number;
  canvas: HTMLCanvasElement | null;
  sprite: Sprite;
  /** What it should show, and what its picture shows ("" none). */
  sig: string;
  painted: string;
  cells: string[];
  covered: boolean;
  empty: boolean;
  /** When it was last on screen (MapView.keepGround's count). */
  seen: number;
}

/** Renders one level of a map: terrain chunks, scenery, live objects, heroes and the planned path. */
export class MapView {
  readonly root = new Container();
  private readonly terrain = new Container();
  private readonly scenery = new Container();
  private readonly pathLayer = new Container();
  private readonly fog = new Container();
  /** Whose exploration to show; -1 shows everything (map preview, spectating). */
  viewer = -1;
  /** With the shroud off (viewer -1): only the objects on this player's explored tiles (expert View Earth's terrain); -1 all. */
  objectsOf = -1;
  readonly heroSprites = new Map<number, HeroSprite>();
  private level = 0;
  map: H3Map | null = null;
  private replaced = new Set<number>();

  /** `still`: a view drawn once for a picture (landPicture's other level), without the map's animations. */
  constructor(app: Application, still = false) {
    this.app = app;
    this.root.addChild(this.terrain, this.scenery, this.pathLayer, this.fog);
    this.scenery.sortableChildren = true;
    if (still) return;
    steadyTick(app, (t) => {
      for (const h of this.heroSprites.values()) h.tick(t.deltaMS);
      tickMapAnimations(t.deltaMS);
      this.animateTerrain(Math.floor(animClock / FRAME_MS));
    });
  }

  /**
   * A picture of one level's land and fixed scenery (no heroes, no live objects, no shroud) within `frame` (map
   * pixels), for the puzzle map. The level is the one asked for, not the one on screen (2026-11-02: an
   * underground obelisk showed the underground, a surface one the surface, while the Grail lies on one level only):
   * the level on screen is photographed from this view, another one from a still view drawn for the picture.
   */
  async landPicture(level: number, frame: Rectangle): Promise<Texture[]> {
    if (!this.map) return [];
    if (level === this.level) return this.photograph(frame, new Set<Container>([...this.heroSprites.values(), ...[...this.dynamic.values()].map((d) => d.sprite)]));
    const other = new MapView(this.app, true);
    other.map = this.map;
    other.level = Math.max(0, Math.min(level, this.levels - 1));
    // The map's objects the game replaced (the towns, mines, monsters...) are live ones: left out, as here.
    other.replaced = new Set(this.lastState?.replaced ?? []);
    try {
      await Promise.all([other.buildTerrain(), other.buildScenery()]);
      return other.photograph(frame, new Set());
    } finally {
      other.dispose();
    }
  }

  /** The terrain and scenery layers rendered into textures over `frame`, without `leaveOut`, put back as they were. */
  private photograph(frame: Rectangle, leaveOut: Set<Container>): Texture[] {
    // (The chunks the picture covers drawn, even far off screen; the next scroll lets them go again.)
    const S = CHUNK * TILE;
    this.drawChunks((c) => c.cx * S < frame.right && (c.cx + 1) * S > frame.x && c.cy * S < frame.bottom && (c.cy + 1) * S > frame.y, () => true);
    const terrainShown = this.terrainChunks.map((c) => c.sprite.visible);
    for (const c of this.terrainChunks) c.sprite.visible = !!c.canvas;
    try {
      return this.photographLayers(frame, leaveOut);
    } finally {
      this.terrainChunks.forEach((c, i) => (c.sprite.visible = terrainShown[i]));
    }
  }

  private photographLayers(frame: Rectangle, leaveOut: Set<Container>): Texture[] {
    return [this.terrain, this.scenery].map((layer) => {
      const saved = { x: layer.x, y: layer.y, scale: layer.scale.x };
      const shown = layer.children.map((c) => c.visible);
      layer.children.forEach((c) => (c.visible = !leaveOut.has(c)));
      layer.position.set(0, 0);
      layer.scale.set(1);
      const tex = this.app.renderer.generateTexture({ target: layer, frame });
      layer.position.set(saved.x, saved.y);
      layer.scale.set(saved.scale);
      layer.children.forEach((c, i) => (c.visible = shown[i]));
      return tex;
    });
  }

  /** A still view's pictures let go (the objects' DEF frames are shared and stay). */
  private dispose() {
    if (this.idlePainting) clearTimeout(this.idlePainting);
    for (const c of this.terrainChunks) this.dropChunk(c);
    for (const c of this.fogChunks.values()) this.dropFog(c);
    for (const c of this.scenery.removeChildren()) c.destroy();
    for (const c of [...this.terrain.removeChildren(), ...this.fog.removeChildren()]) c.destroy();
    this.terrainChunks = [];
    this.root.destroy();
  }

  /** The part of the map on screen (tiles), for culling. */
  private shown: { x: number; y: number; w: number; h: number } | null = null;

  /**
   * Hides what lies off screen: a big map holds thousands of object sprites (Barren Lands: 12,000),
   * and drawing them all made every frame, and the opponents' turns, crawl. Run on every camera
   * move and after each update (which adds sprites).
   */
  cull(view: { x: number; y: number; w: number; h: number }) {
    this.shown = view;
    this.recull();
    this.fitPathLabel();
  }

  private recull() {
    const v = this.shown;
    if (!v) return;
    // (A sprite's position is its picture's top left; objects reach up to 8 tiles wide and 6 tall, plus a margin.)
    const left = (v.x - 9) * TILE;
    const top = (v.y - 7) * TILE;
    const right = (v.x + v.w + 2) * TILE;
    const bottom = (v.y + v.h + 2) * TILE;
    // (Heroes stay: few, and one walking in from off screen must show on its way.)
    for (const c of this.scenery.children) if (!(c instanceof HeroSprite)) c.visible = c.x < right && c.x > left && c.y < bottom && c.y > top;
    this.keepGround();
  }

  get levels() {
    return this.map?.levels ?? 1;
  }

  get currentLevel() {
    return this.level;
  }

  tile(x: number, y: number, z = this.level): MapTile | undefined {
    const m = this.map;
    if (!m || x < 0 || y < 0 || x >= m.size || y >= m.size) return undefined;
    return m.tiles[(z * m.size + y) * m.size + x];
  }

  /**
   * Map preview, or a game when `state` is given (its objects replace the map's interactive ones).
   * With `focus` (the tile the view opens on), what's around it is drawn first and `show` resolves
   * then; the rest of the level's objects come in just after (a big map took seconds more).
   */
  async show(map: H3Map, level = 0, state?: AdventureState, focus?: { x: number; y: number }) {
    // An update still drawing would keep placing the sprites this clears away.
    await this.updating;
    const gen = ++this.showGen;
    this.near = focus ? (x: number, y: number) => Math.abs(x - focus.x) <= NEAR && Math.abs(y - focus.y) <= NEAR : null;
    this.map = map;
    this.level = level;
    this.replaced = new Set(state?.replaced ?? []);
    for (const c of this.scenery.removeChildren()) c.destroy();
    // The terrain's and shroud's pictures are their own (the objects' are shared DEF frames).
    for (const c of this.terrainChunks) this.dropChunk(c);
    for (const c of this.fogChunks.values()) this.dropFog(c);
    for (const c of [...this.terrain.removeChildren(), ...this.fog.removeChildren()]) c.destroy();
    this.fogChunks.clear();
    this.heroSprites.clear();
    this.terrainChunks = [];
    this.terrainStep = -1;
    const near = this.near;
    await Promise.all([this.buildTerrain(), this.buildScenery(near ?? undefined)]);
    if (state) await this.update(state);
    if (!near) return;
    // The rest (the far scenery, and the far objects with the latest state) when drawRest() says
    // the screen is up, or in a few seconds.
    this.near = null;
    let started = false;
    this.rest = () => {
      if (started) return;
      started = true;
      this.rest = null;
      void (async () => {
        await this.buildScenery((x, y) => !near(x, y), gen);
        if (gen !== this.showGen) return;
        this.reorder();
        if (this.lastState) await this.update(this.lastState);
      })().catch(() => {});
    };
    setTimeout(() => this.drawRest(), 5000);
  }
  private rest: (() => void) | null = null;
  /** The opened map is on screen: the rest of its level's objects now. */
  drawRest() {
    this.rest?.();
  }
  /** Bumped by each show(): scenery still loading for an earlier one is dropped. */
  private showGen = 0;
  /** While the view opens on a spot: which tiles count as near it (only those are drawn yet). */
  private near: ((x: number, y: number) => boolean) | null = null;
  private lastState: AdventureState | null = null;

  private async buildTerrain() {
    const m = this.map!;
    const z = this.level;
    // Load every terrain/river/road sheet this level uses.
    const used = new Set<string>();
    for (let i = z * m.size * m.size; i < (z + 1) * m.size * m.size; i++) {
      const t = m.tiles[i];
      used.add(TERRAIN_DEFS[t.terrain] ?? "");
      used.add(RIVER_DEFS[t.river] ?? "");
      used.add(ROAD_DEFS[t.road] ?? "");
    }
    used.delete("");
    const sheets = new Map<string, FrameCanvas[]>();
    await Promise.all([...used].map(async (n) => sheets.set(n, await defCanvases(n))));

    // Every chunk has its place; its picture is drawn only while it is on screen or near it (drawChunks).
    this.sheets = sheets;
    const chunks = Math.ceil(m.size / CHUNK);
    for (let cy = 0; cy < chunks; cy++) {
      for (let cx = 0; cx < chunks; cx++) {
        let animated = false;
        for (let ty = 0; ty < CHUNK && !animated; ty++)
          for (let tx = 0; tx < CHUNK && !animated; tx++) {
            const t = this.tile(cx * CHUNK + tx, cy * CHUNK + ty);
            animated = !!t && (!!PALETTE_CYCLES[t.terrain] || (!!t.river && !!PALETTE_CYCLES[16 + t.river]));
          }
        const sprite = new Sprite(Texture.EMPTY);
        sprite.position.set(cx * CHUNK * TILE, cy * CHUNK * TILE);
        sprite.visible = false;
        this.terrain.addChild(sprite);
        this.terrainChunks.push({ cx, cy, canvas: null, sprite, seen: 0, animated, anim: null, used: 0 });
      }
    }
    // What the screen shows; a view not placed yet: around the spot it opens on (the camera's first move culls),
    // or all of it (a still view drawn for a picture).
    const near = this.near;
    if (this.shown) this.recull();
    else if (near) this.drawChunks((c) => near((c.cx + 0.5) * CHUNK, (c.cy + 0.5) * CHUNK) || [0, 1].some((dx) => [0, 1].some((dy) => near((c.cx + dx) * CHUNK, (c.cy + dy) * CHUNK))), () => true);
    else this.drawChunks(() => true);
  }

  /**
   * The chunks `wanted` says are needed drawn, the others (far off screen) let go: a big map's whole level was
   * kept drawn, 512 x 512 pixels a chunk twice over (the canvas and the GPU's copy), 80 to 160 of them on an XL map,
   * on a phone that also has to hold a battle (2026-11-02). Drawing one again is a few milliseconds.
   */
  private drawChunks(wanted: (c: { cx: number; cy: number }) => boolean, keep: (c: { cx: number; cy: number }) => boolean = wanted) {
    for (const c of this.terrainChunks) {
      if (c.sprite.destroyed) continue;
      if (!c.canvas && wanted(c)) {
        this.paintTerrain(c);
      } else if (c.canvas && !keep(c)) this.dropChunk(c);
    }
  }

  /** A chunk's picture painted and handed to the GPU's texture. */
  private paintTerrain(c: (typeof this.terrainChunks)[number]) {
    c.canvas = this.paintChunk(c.cx, c.cy);
    c.sprite.texture = Texture.from(c.canvas);
  }

  /** A chunk's picture let go (its canvas emptied too: the page keeps 2D canvases' pixels in its own memory). */
  private dropChunk(c: (typeof this.terrainChunks)[number]) {
    this.stillTerrain(c);
    if (!c.canvas) return;
    if (!c.sprite.destroyed) {
      const t = c.sprite.texture;
      c.sprite.texture = Texture.EMPTY;
      t.destroy(true);
    }
    c.canvas.width = c.canvas.height = 0;
    c.canvas = null;
  }

  /** One 16 x 16-tile chunk of the level's ground: terrain, rivers, roads. */
  private paintChunk(cx: number, cy: number): HTMLCanvasElement {
    const sheets = this.sheets;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = CHUNK * TILE;
    const ctx = canvas.getContext("2d")!;
    // Three passes so later layers aren't painted over by the next row's terrain.
    // Roads sit half a tile lower than their tile, so the row above the chunk spills in too.
    for (const layer of ["terrain", "river", "road"] as const) {
      for (let ty = layer === "road" ? -1 : 0; ty < CHUNK; ty++) {
        for (let tx = 0; tx < CHUNK; tx++) {
          const t = this.tile(cx * CHUNK + tx, cy * CHUNK + ty);
          if (!t) continue;
          const px = tx * TILE;
          const py = ty * TILE;
          if (layer === "terrain") drawFlipped(ctx, sheets.get(TERRAIN_DEFS[t.terrain])?.[t.view], px, py, !!(t.flags & 1), !!(t.flags & 2));
          else if (layer === "river" && t.river) drawFlipped(ctx, sheets.get(RIVER_DEFS[t.river])?.[t.riverDir], px, py, !!(t.flags & 4), !!(t.flags & 8));
          else if (layer === "road" && t.road) drawFlipped(ctx, sheets.get(ROAD_DEFS[t.road])?.[t.roadDir], px, py + TILE / 2, !!(t.flags & 16), !!(t.flags & 32));
        }
      }
    }
    return canvas;
  }

  private app: Application;
  private sheets = new Map<string, FrameCanvas[]>();
  /** The terrain's 16x16-tile pictures; the flowing ones (water, lava, rivers) keep their cycling pixels while seen. */
  private terrainChunks: {
    cx: number;
    cy: number;
    /** Its picture, while it is drawn (null: far off screen, let go). */
    canvas: HTMLCanvasElement | null;
    sprite: Sprite;
    /** When it was last on screen (keepGround's count). */
    seen: number;
    animated: boolean;
    /** `cycling`: each cycling pixel as its offset | (kind << 8 | palette index) << 18. */
    anim: { texture: Texture; px: Uint32Array; cycling: Uint32Array } | null;
    used: number;
  }[] = [];
  private terrainStep = -1;

  /** Each run of a cycling palette moved `step` places, as packed RGBA by (kind << 8 | index). */
  private cycleLut(step: number) {
    const lut = new Uint32Array(21 * 256);
    for (const [k, runs] of Object.entries(PALETTE_CYCLES)) {
      const kind = Number(k);
      const pal = defPalettes.get(kind >= 16 ? RIVER_DEFS[kind - 16] : TERRAIN_DEFS[kind]);
      if (!pal) continue;
      for (const [start, n] of runs)
        for (let i = 0; i < n; i++) {
          const o = (start + ((i + step) % n)) * 4;
          lut[(kind << 8) | (start + i)] = (pal[o] | (pal[o + 1] << 8) | (pal[o + 2] << 16) | (255 << 24)) >>> 0;
        }
    }
    return lut;
  }

  /** Which pixels of a chunk show a cycling palette entry: drawn as buildTerrain draws, later layers covering earlier ones. */
  private cyclingPixels(cx: number, cy: number) {
    const S = CHUNK * TILE;
    const keys = new Uint16Array(S * S);
    const cycles = new Map<number, Uint8Array>();
    for (const [k, runs] of Object.entries(PALETTE_CYCLES)) {
      const on = new Uint8Array(256);
      for (const [start, n] of runs) on.fill(1, start, start + n);
      cycles.set(Number(k), on);
    }
    const put = (f: FrameCanvas | undefined, px: number, py: number, flipX: boolean, flipY: boolean, kind: number) => {
      if (!f?.pixels || !f.width) return;
      const w = f.width;
      const h = f.pixels.length / w;
      const on = cycles.get(kind);
      for (let v = 0; v < h; v++) {
        const Y = flipY ? py + TILE - 1 - (f.y + v) : py + f.y + v;
        if (Y < 0 || Y >= S) continue;
        for (let u = 0; u < w; u++) {
          const idx = f.pixels[v * w + u];
          if (!idx) continue;
          const X = flipX ? px + TILE - 1 - (f.x + u) : px + f.x + u;
          if (X < 0 || X >= S) continue;
          keys[Y * S + X] = on?.[idx] ? (kind << 8) | idx : 0;
        }
      }
    };
    for (const layer of ["terrain", "river", "road"] as const)
      for (let ty = layer === "road" ? -1 : 0; ty < CHUNK; ty++)
        for (let tx = 0; tx < CHUNK; tx++) {
          const t = this.tile(cx * CHUNK + tx, cy * CHUNK + ty);
          if (!t) continue;
          const px = tx * TILE;
          const py = ty * TILE;
          if (layer === "terrain") put(this.sheets.get(TERRAIN_DEFS[t.terrain])?.[t.view], px, py, !!(t.flags & 1), !!(t.flags & 2), t.terrain);
          else if (layer === "river" && t.river) put(this.sheets.get(RIVER_DEFS[t.river])?.[t.riverDir], px, py, !!(t.flags & 4), !!(t.flags & 8), 16 + t.river);
          else if (layer === "road" && t.road) put(this.sheets.get(ROAD_DEFS[t.road])?.[t.roadDir], px, py + TILE / 2, !!(t.flags & 16), !!(t.flags & 32), -1);
        }
    let n = 0;
    for (let i = 0; i < keys.length; i++) if (keys[i]) n++;
    const cycling = new Uint32Array(n);
    for (let i = 0, j = 0; i < keys.length; i++) if (keys[i]) cycling[j++] = (i | (keys[i] << 18)) >>> 0;
    return cycling;
  }

  /** One terrain animation tick: the flowing chunks on screen get the palette's next step. */
  private animateTerrain(step: number) {
    if (step === this.terrainStep || !this.map) return;
    this.terrainStep = step;
    for (let c: Container | null = this.root; c; c = c.parent) if (!c.visible) return;
    const flowing = this.terrainChunks.filter((c) => c.animated && c.canvas && !c.sprite.destroyed);
    if (!flowing.length) return;
    const a = this.root.toLocal({ x: 0, y: 0 });
    const b = this.root.toLocal({ x: this.app.screen.width, y: this.app.screen.height });
    const S = CHUNK * TILE;
    let lut: Uint32Array | null = null;
    for (const c of flowing) {
      const x0 = c.cx * S;
      const y0 = c.cy * S;
      if (x0 >= Math.max(a.x, b.x) || x0 + S <= Math.min(a.x, b.x) || y0 >= Math.max(a.y, b.y) || y0 + S <= Math.min(a.y, b.y)) continue;
      // Under the shroud nobody sees it flow.
      if (this.fogChunks.get(`${c.cx},${c.cy}`)?.covered) continue;
      lut ??= this.cycleLut(step);
      if (!c.anim) {
        // The pixels go to the GPU straight from a buffer (no canvas round trip each tick).
        const data = c.canvas!.getContext("2d")!.getImageData(0, 0, S, S).data;
        const texture = new Texture({ source: new BufferImageSource({ resource: data, width: S, height: S }) });
        c.anim = { texture, px: new Uint32Array(data.buffer), cycling: this.cyclingPixels(c.cx, c.cy) };
        c.sprite.texture = texture;
      }
      c.used = step;
      const { texture, px, cycling } = c.anim;
      for (let j = 0; j < cycling.length; j++) px[cycling[j] & 0x3ffff] = lut[cycling[j] >>> 18];
      texture.source.update();
    }
    // Only the chunks seen lately keep their pixels (a big sea would hold a lot).
    const kept = flowing.filter((c) => c.anim).sort((p, q) => q.used - p.used);
    for (const c of kept.slice(16)) this.stillTerrain(c);
  }

  /** A flowing chunk back to its still picture, its cycling pixels let go. */
  private stillTerrain(c: (typeof this.terrainChunks)[number]) {
    if (!c.anim) return;
    if (!c.sprite.destroyed) c.sprite.texture = c.canvas ? Texture.from(c.canvas) : Texture.EMPTY;
    c.anim.texture.destroy(true);
    c.anim = null;
  }

  /**
   * Draw order as in the original (VCMI's compareObjectBlitOrder): ground-level objects first, then
   * the rest; heroes on top of their row. Within a group z() is only a first guess (row, then the
   * map's own order); reorder() puts the standing objects in their final order.
   */
  private static z(flat: boolean, x: number, y: number, tie: number) {
    return (flat ? 0 : 1_000_000_000) + y * 100_000 + (x === 999 ? 99_999 : Math.min(99_998, tie));
  }

  /** Where each standing object is and which tiles it blocks, for reorder(). */
  private readonly placed = new Map<Sprite, { y: number; tie: number; blocked: Set<number>; box: [number, number, number, number] }>();
  /** By row: the highest rank among standing objects up to that row (heroes go just above it). */
  private rowRank: number[] = [];

  private place(sp: Sprite, x: number, y: number, mask: number[], tie: number) {
    const blocked = new Set<number>();
    let [x0, y0, x1, y1] = [x, y, x, y];
    for (const { dx, dy } of maskTiles(mask, 0)) {
      blocked.add((y + dy) * 1024 + x + dx);
      [x0, y0, x1, y1] = [Math.min(x0, x + dx), Math.min(y0, y + dy), Math.max(x1, x + dx), Math.max(y1, y + dy)];
    }
    this.placed.set(sp, { y, tie, blocked, box: [x0, y0, x1, y1] });
    sp.once("destroyed", () => this.placed.delete(sp));
  }

  /**
   * VCMI's rule, found by experimenting with H3 maps: when one object's blocked tiles stand right
   * above the other's (A's tile + 1 row is B's), the one more often below is drawn on top; only
   * then the row, then the map's order. A tree beside a mill no longer covers it.
   * (A sort with that as its comparator isn't an order: a tree a row lower than the Mystic Garden
   * but above a pine that stands over the garden made a ring, and the sort put the tree over the
   * gardener's head (2026-10-31 19:47). So the "above" pairs are kept as they are
   * and the rest goes by row then map order: each next object is the first by row of those with
   * nothing still to draw under them.)
   */
  private reorder() {
    const items = [...this.placed].filter(([sp]) => !sp.destroyed && sp.zIndex >= 1_000_000_000);
    const order = drawOrder(items.map(([, it]) => it));
    const sorted = order.map((i) => items[i]);
    this.rowRank = [];
    sorted.forEach(([sp, it], rank) => {
      sp.zIndex = 1_000_000_000 + rank * 2;
      this.rowRank[it.y] = Math.max(this.rowRank[it.y] ?? 0, rank);
    });
    for (let y = 1; y < this.rowRank.length; y++) this.rowRank[y] = Math.max(this.rowRank[y] ?? 0, this.rowRank[y - 1] ?? 0);
    for (const hs of this.heroSprites.values()) hs.zIndex = this.heroZ(hs.tileY);
  }

  /**
   * A walking hero's row for the draw order, step by step (the state has its new place only once
   * the walk is over): the lower of the two tiles it is between, so it passes in front of what
   * stands on the row it walks down into and goes behind what it walks up past.
   */
  walkRow(id: number, y: number) {
    const hs = this.heroSprites.get(id);
    if (!hs || hs.destroyed) return;
    hs.tileY = y;
    hs.zIndex = this.heroZ(y);
  }

  /** A hero: above every standing object of its row and the rows above. */
  private heroZ(y: number) {
    const r = this.rowRank[Math.min(y, this.rowRank.length - 1)];
    return r === undefined ? MapView.z(false, 999, y, 0) : 1_000_000_000 + r * 2 + 1;
  }

  private async buildScenery(only?: (x: number, y: number) => boolean, gen = this.showGen) {
    const m = this.map!;
    await Promise.all(
      m.objects.map(async (o, i) => {
        if (o.z !== this.level || this.replaced.has(i) || (only && !only(o.x, o.y))) return;
        const t = m.templates[o.template];
        const frames = await loadDef(t.def).catch(() => null);
        if (gen !== this.showGen) return;
        const s = frames && placeObject(frames, o.x, o.y);
        if (!s) return;
        s.zIndex = MapView.z(!!t.printPriority, o.x, o.y, i);
        if (!t.printPriority) this.place(s, o.x, o.y, t.blockMask, i);
        this.scenery.addChild(s);
      }),
    );
    this.reorder();
  }

  /** Each object's sprite and the look it was drawn with (kept while that stays: a big map has thousands). */
  private dynamic = new Map<number, { look: string; sprite: Sprite }>();

  /**
   * The shroud and the map's frame, painted into 16x16-tile canvases that are redrawn only when
   * they change: EDG outside the map, TSHRC over unexplored land, TSHRE edges where it meets explored
   * land (picked by VCMI's neighbour table; ids past TSHRE's own frames are mirrored copies).
   */
  private drawFog(s: AdventureState) {
    if (!this.map || !this.fogArt) return;
    const n = this.map.size;
    const { full } = this.fogArt;
    const bits = this.viewer >= 0 ? s.players[this.viewer]?.revealed : undefined;
    const base = this.level * n * n;
    // Off the map counts as unexplored (else the shroud frays along the map's edge).
    const seen = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && (!bits || !!((bits[(base + y * n + x) >> 5] >>> ((base + y * n + x) & 31)) & 1));
    // What goes on a tile: "b<i>" border frame, "f<i>" full shroud, "e<i>" edge, "" nothing.
    const art = (x: number, y: number): string => {
      if (x < 0 || y < 0 || x >= n || y >= n) {
        if (x < -1 || x > n || y < -1 || y > n) return `b${(Math.abs(x) % 4) + 4 * (Math.abs(y) % 4)}`;
        if (x === -1 && y === -1) return "b16";
        if (x === n && y === -1) return "b17";
        if (x === n && y === n) return "b18";
        if (x === -1 && y === n) return "b19";
        if (y === -1) return `b${20 + (x % 4)}`;
        if (x === n) return `b${24 + (y % 4)}`;
        if (y === n) return `b${28 + (x % 4)}`;
        return `b${32 + (y % 4)}`;
      }
      if (seen(x, y)) return "";
      const d1 = seen(x, y + 1), d3 = seen(x - 1, y), d4 = seen(x + 1, y), d6 = seen(x, y - 1);
      const d0 = d1 || d3 || seen(x - 1, y + 1);
      const d2 = d1 || d4 || seen(x + 1, y + 1);
      const d5 = d3 || d6 || seen(x - 1, y - 1);
      const d7 = d4 || d6 || seen(x + 1, y - 1);
      const id = FOG_BITMAPS[+d0 | (+d1 << 1) | (+d2 << 2) | (+d3 << 3) | (+d4 << 4) | (+d5 << 5) | (+d6 << 6) | (+d7 << 7)];
      // A stable pseudo-random full-shroud frame per tile, as VCMI does.
      return id >= 0 ? `e${id}` : `f${(Math.floor(((x * 997) ^ (y * 1009)) / 101) >>> 0) % Math.max(1, full.length)}`;
    };
    const C = 16;
    const lo = -1;
    const hi = Math.ceil(n / C);
    const live = new Set<string>();
    for (let cy = lo; cy <= hi; cy++)
      for (let cx = lo; cx <= hi; cx++) {
        const key = `${cx},${cy}`;
        live.add(key);
        const cells: string[] = [];
        for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) cells.push(art(cx * C + x, cy * C + y));
        const sig = cells.join(",");
        let chunk = this.fogChunks.get(key);
        if (!chunk) {
          const sprite = new Sprite(Texture.EMPTY);
          sprite.position.set(cx * C * TILE, cy * C * TILE);
          sprite.visible = false;
          this.fog.addChild(sprite);
          chunk = { cx, cy, canvas: null, sprite, sig: "", painted: "", cells: [], covered: false, empty: true, seen: 0 };
          this.fogChunks.set(key, chunk);
        }
        if (chunk.sig === sig) continue;
        chunk.sig = sig;
        chunk.cells = cells;
        chunk.covered = cells.every((c) => c[0] === "f");
        chunk.empty = cells.every((c) => !c);
      }
    for (const [key, chunk] of this.fogChunks)
      if (!live.has(key)) {
        this.dropFog(chunk);
        chunk.sprite.destroy();
        this.fogChunks.delete(key);
      }
    this.paintFog();
  }

  /** The shroud painted: before the camera's first move around the spot the view opens on (else all of it), then as keepGround says. */
  private paintFog() {
    if (!this.fogArt) return;
    if (this.shown) return this.keepGround();
    const opening = this.near;
    const C = CHUNK;
    for (const chunk of this.fogChunks.values()) {
      if (chunk.sprite.destroyed) continue;
      const wanted = !chunk.empty && (!opening || [0, 0.5, 1].some((dx) => [0, 0.5, 1].some((dy) => opening((chunk.cx + dx) * C, (chunk.cy + dy) * C))));
      if (!wanted) this.dropFog(chunk);
      else if (chunk.painted !== chunk.sig) this.paintFogChunk(chunk);
      chunk.sprite.visible = wanted;
    }
  }

  /** One shroud chunk painted as its cells say. */
  private paintFogChunk(chunk: FogChunk) {
    const { full, edge, border } = this.fogArt!;
    const C = CHUNK;
    if (!chunk.canvas) {
      chunk.canvas = document.createElement("canvas");
      chunk.canvas.width = chunk.canvas.height = C * TILE;
      chunk.sprite.texture = Texture.from(chunk.canvas);
    }
    const ctx = chunk.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, C * TILE, C * TILE);
    chunk.cells.forEach((c, k) => {
      if (!c) return;
      const px = (k % C) * TILE;
      const py = Math.floor(k / C) * TILE;
      const id = Number(c.slice(1));
      if (c[0] === "b") drawFlipped(ctx, border[id], px, py, false, false);
      else if (c[0] === "f") drawFlipped(ctx, full[id], px, py, false, false);
      else if (id < edge.length) drawFlipped(ctx, edge[id], px, py, false, false);
      // VCMI's "verticalFlip" mirrors across the vertical axis: left-right.
      else drawFlipped(ctx, edge[FOG_ROTATIONS[id - edge.length]], px, py, true, false);
    });
    chunk.sprite.texture.source.update();
    chunk.painted = chunk.sig;
  }

  /**
   * Which pictures of the ground (terrain and shroud, 16 x 16 tiles, 512 x 512 pixels each) are kept. All of them
   * were, a whole XL map's worth twice over (some 450, the GPU's copies as well once seen; The owner's phone held 80 on
   * the GPU under every battle, 2026-11-02). Now: what the screen shows is painted at once; around it, around each
   * of the player's heroes and towns (where the hero and town lists jump to: the owner, "instant jumps we want") and the
   * ones seen last are kept, up to KEEP_GROUND of each kind beyond those; the ones still missing are painted in idle
   * moments (about 10 ms each on a phone), so a jump finds them ready. A chunk with no shroud has no picture.
   */
  private keepGround() {
    const v = this.shown;
    if (!v || !this.map) return;
    const tick = ++this.seenTick;
    const inBox = (c: { cx: number; cy: number }, x0: number, y0: number, x1: number, y1: number) =>
      c.cx + 1 > x0 / CHUNK && c.cx < x1 / CHUNK && c.cy + 1 > y0 / CHUNK && c.cy < y1 / CHUNK;
    const onScreen = (c: { cx: number; cy: number }) => inBox(c, v.x, v.y, v.x + v.w, v.y + v.h);
    const hw = v.w / 2 + 2;
    const hh = v.h / 2 + 2;
    const homes = this.homes;
    this.soon = (c) => inBox(c, v.x - CHUNK, v.y - CHUNK, v.x + v.w + CHUNK, v.y + v.h + CHUNK) || homes.some((h) => inBox(c, h.x - hw, h.y - hh, h.x + hw, h.y + hh));
    for (const c of this.terrainChunks) {
      if (c.sprite.destroyed) continue;
      const on = onScreen(c);
      if (on) {
        if (!c.canvas) this.paintTerrain(c);
        c.seen = tick;
      }
      c.sprite.visible = on;
    }
    for (const f of this.fogChunks.values()) {
      if (f.sprite.destroyed) continue;
      if (f.empty) {
        this.dropFog(f);
        continue;
      }
      const on = onScreen(f);
      if (on) {
        if (f.painted !== f.sig) this.paintFogChunk(f);
        f.seen = tick;
      }
      f.sprite.visible = on;
    }
    // Beyond what's needed soon, the ones seen longest ago go first.
    const soon = this.soon;
    const extra = <T extends { cx: number; cy: number; canvas: HTMLCanvasElement | null; seen: number }>(all: Iterable<T>) =>
      [...all].filter((c) => c.canvas && !soon(c)).sort((a, b) => b.seen - a.seen).slice(KEEP_GROUND);
    for (const c of extra(this.terrainChunks)) this.dropChunk(c);
    for (const f of extra(this.fogChunks.values())) this.dropFog(f);
    this.paintSoon();
  }
  private seenTick = 0;
  /** The chunks wanted ready (around the screen, the player's heroes and towns); set by keepGround. */
  private soon: (c: { cx: number; cy: number }) => boolean = () => false;
  /** The player's heroes and towns on this level (tiles), from the last update. */
  private homes: { x: number; y: number }[] = [];
  private idlePainting: ReturnType<typeof setTimeout> | null = null;

  /** The chunks wanted soon and not painted yet, a few at a time between frames. */
  private paintSoon() {
    if (this.idlePainting) return;
    this.idlePainting = setTimeout(() => {
      this.idlePainting = null;
      if (this.root.destroyed || !this.shown) return;
      const until = performance.now() + 8;
      const soon = this.soon;
      for (const c of this.terrainChunks) {
        if (performance.now() > until) return this.paintSoon();
        if (!c.canvas && !c.sprite.destroyed && soon(c)) this.paintTerrain(c);
      }
      if (!this.fogArt) return;
      for (const f of this.fogChunks.values()) {
        if (performance.now() > until) return this.paintSoon();
        if (!f.empty && f.painted !== f.sig && !f.sprite.destroyed && soon(f)) this.paintFogChunk(f);
      }
    }, 60);
  }

  /** A shroud chunk's picture let go (painted again when the screen comes near). */
  private dropFog(chunk: FogChunk) {
    if (!chunk.sprite.destroyed) chunk.sprite.visible = false;
    if (!chunk.canvas) return;
    if (!chunk.sprite.destroyed) {
      const t = chunk.sprite.texture;
      chunk.sprite.texture = Texture.EMPTY;
      t.destroy(true);
    }
    chunk.canvas.width = chunk.canvas.height = 0;
    chunk.canvas = null;
    chunk.painted = "";
  }

  private fogArt: { full: FrameCanvas[]; edge: FrameCanvas[]; border: FrameCanvas[] } | null = null;
  private readonly fogChunks = new Map<string, FogChunk>();

  private updating: Promise<void> = Promise.resolve();

  /** Just the shroud, e.g. while a hero walks (it only redraws what changed). */
  redrawFog(s: AdventureState) {
    if (this.fogArt) this.drawFog(s);
  }

  /** Rebuilds the game's objects and heroes from a state update. Calls run one after another. */
  update(s: AdventureState): Promise<void> {
    this.lastState = s;
    // Where the hero and town lists jump to: their ground kept painted (keepGround).
    const me = this.viewer;
    this.homes =
      me < 0
        ? []
        : [...s.heroes.filter((h) => h.owner === me && !h.removed && h.z === this.level), ...s.objects.filter((o) => o.town && o.owner === me && !o.removed && o.z === this.level)].map((p) => ({ x: p.x, y: p.y }));
    this.updating = this.updating
      .then(() => this.doUpdate(s))
      .then(() => this.recull())
      .catch((err) => console.error("map update failed", err));
    return this.updating;
  }

  private async doUpdate(s: AdventureState) {
    this.fogArt ??= await Promise.all([defCanvases("tshrc"), defCanvases("tshre"), defCanvases("edg")]).then(([full, edge, border]) => ({ full, edge, border }));
    this.drawFog(s);
    // (The whole terrain shown by expert View Earth: what lies on unexplored ground stays hidden.)
    const bits = this.objectsOf >= 0 ? s.players[this.objectsOf]?.revealed : undefined;
    const n = this.map?.size ?? s.size;
    const known = (x: number, y: number, z: number) => {
      const i = (z * n + y) * n + x;
      return !bits?.length || (x >= 0 && y >= 0 && x < n && y < n && !!((bits[i >> 5] >>> (i & 31)) & 1));
    };
    const sprites: Sprite[] = [];
    const kept = new Map<number, { look: string; sprite: Sprite }>();
    const near = this.near;
    await Promise.all(
      s.objects.map(async (o) => {
        // Events are invisible, as in the original.
        if (o.removed || o.carriedBy !== undefined || o.z !== this.level || o.type === 26) return;
        // (Opening on a spot: the far ones come in the next update.)
        if (near && !near(o.x, o.y)) return;
        if (bits && ![...maskTiles(o.block, 0), ...maskTiles(o.visit, 1)].some((t) => known(o.x + t.dx, o.y + t.dy, o.z))) return;
        // (A town shows what is built in it: village, walls, Capitol; the map file's picture if that one won't load.)
        const def = townLook(o) ?? o.def;
        const look = `${def}|${o.owner}|${o.x},${o.y}|${o.type}:${o.subid}|${o.dir}|${o.flat}|${extra("flagsOnTop")}`;
        const had = this.dynamic.get(o.id);
        if (had && had.look === look && !had.sprite.destroyed) {
          kept.set(o.id, had);
          return;
        }
        const boat = o.type === 8 && o.dir !== undefined ? await boatSheet(o.subid).catch(() => null) : null;
        const frames = boat ?? (await loadDefFlagged(def, o.owner).catch(() => (def === o.def ? null : loadDefFlagged(o.def, o.owner).catch(() => null))));
        const sp = frames && (boat ? placeBoat(boat, o.dir!, o.x, o.y) : placeObject(frames, o.x + monsterShift(o, frames), o.y));
        if (!sp) return;
        sp.zIndex = MapView.z(o.flat, o.x, o.y, o.id);
        if (!o.flat) this.place(sp, o.x, o.y, o.block, 100_000 + o.id);
        // An owned object's flag once more over everything standing (a mountain a row lower hid the Crystal Cavern's;
        // The owner, 2026-11-02 17:19; EXTRAS flagsOnTop): its flag pixels alone, waving with it.
        const flagFrames = !boat && extra("flagsOnTop") ? await loadFlagOnly(def, o.owner).catch(() => loadFlagOnly(o.def, o.owner).catch(() => null)) : null;
        const flag = flagFrames ? placeObject(flagFrames, o.x, o.y) : null;
        if (flag) ((flag.zIndex = 3_000_000_000 + o.id), (flag.label = "owner's flag"), sprites.push(flag), sp.once("destroyed", () => flag.destroy()));
        kept.set(o.id, { look, sprite: sp });
        sprites.push(sp);
      }),
    );
    for (const [id, old] of this.dynamic) if (kept.get(id) !== old) old.sprite.destroy();
    this.dynamic = kept;
    for (const sp of sprites) this.scenery.addChild(sp);

    for (const h of s.heroes) {
      let hs = this.heroSprites.get(h.id);
      // Removed, on the other level, or inside a town's garrison: not on the map.
      if (h.removed || h.z !== this.level || h.garrison !== undefined || !known(h.x, h.y, h.z)) {
        if (hs) {
          hs.destroy();
          this.heroSprites.delete(h.id);
        }
        continue;
      }
      if (!hs) {
        // Register before loading so a concurrent update can't create a second one.
        hs = new HeroSprite();
        this.heroSprites.set(h.id, hs);
        this.scenery.addChild(hs);
        await hs.load(h, h.boat !== undefined ? s.objects[h.boat]?.subid : undefined);
      }
      if (hs.destroyed) continue;
      // Boarded or came ashore: switch between hero and boat pictures.
      const look = h.boat !== undefined ? `boat${s.objects[h.boat]?.subid}` : "foot";
      if (hs.look !== look) await hs.load(h, h.boat !== undefined ? s.objects[h.boat]?.subid : undefined);
      hs.dir = h.dir;
      hs.placeAt(h.x, h.y);
      hs.tileY = h.y;
    }
    // Above every object on its row, so a hero in a town gate stands in front of the town.
    this.reorder();
  }

  private pathGen = 0;
  /** The route's tiles (hero first) and what's drawn on each, for the walk to eat up. */
  private pathTiles: { x: number; y: number; drawn: Container[] }[] = [];

  /**
   * Planned route with the original ADAG arrows: each tile's arrow follows the
   * way in and the way out, the goal gets a cross; frames 25+ are the red
   * "not today" variants; HotA's own arrows (the HotA Crew's, in the mod's data patch) add a darker
   * red at 50+, the later days alternating red and dark red so each day's stretch shows (`days`:
   * each tile's day, 0 today). `tiles[0]` is the hero. The step at `fight` (into a monster's guard zone: a
   * battle) and the rest of the way (the monster's cross) are red whatever the day (EXTRAS guardedRoute): green
   * after a red step read as a mistake (2026-10-26); the sword is the mouse cursor's alone.
   */
  async showPath(tiles: { x: number; y: number }[], today: number, endLabel?: Text, fight = -1, days?: number[], battle = false) {
    const gen = ++this.pathGen;
    const arrows = await loadDef(HOTA_ARROWS).catch(() => loadDef("adag.def"));
    // (The attack cursor's crossed swords, for a touch screen's route that ends in a battle: walk.ts planTo.)
    const swords = battle && screenSize.touch ? ((await loadDef("cradvntr.def").catch(() => null))?.get(0)?.[5] ?? null) : null;
    const frames = arrows.get(0) ?? [];
    if (gen !== this.pathGen) return;
    this.pathLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.pathTiles = tiles.map((t) => ({ x: t.x, y: t.y, drawn: [] }));
    tiles.forEach((t, i) => {
      if (i === 0) return;
      const from = tiles[i - 1];
      const to = tiles[i + 1];
      let index = 0;
      if (to) {
        const enter = t.x - from.x + 1 + 3 * (t.y - from.y + 1);
        const leave = to.x - t.x + 1 + 3 * (to.y - t.y + 1);
        index = ARROWS[enter]?.[leave] ?? 0;
      }
      const day = days?.[i] ?? (i > today ? 1 : 0);
      const f = frames[index + (fight >= 0 && i >= fight ? 25 : day === 0 && i <= today ? 0 : frames.length >= 75 && day > 0 && day % 2 === 0 ? 50 : 25)];
      if (!f) return;
      const sp = new Sprite(f.texture);
      sp.position.set(t.x * TILE + f.x, t.y * TILE + f.y);
      this.pathLayer.addChild(sp);
      this.pathTiles[i].drawn.push(sp);
      if (i === tiles.length - 1 && (endLabel || swords)) {
        const l = screenSize.touch ? this.touchPathLabel(endLabel ?? NONE, i <= today, t, swords?.texture) : label(endLabel!, "tiny", i <= today ? WHITE : YELLOW, "center", TILE);
        if (!screenSize.touch) l.position.set(t.x * TILE, t.y * TILE + TILE - 12);
        this.pathLayer.addChild(l);
        this.pathTiles[i].drawn.push(l);
      }
    });
  }

  /** The route's end label on a touch screen, and the tile under it (kept the same size on screen as the map zooms). */
  private pathLabel: { box: Container; x: number; y: number } | null = null;
  /**
   * On a touch screen the tiny font under the cross was a few pixels high: there the label is the
   * HUD's medium font at 1.5x whatever the zoom, on a dark plate, just under the cross.
   */
  private touchPathLabel(text: Text, today: boolean, t: { x: number; y: number }, swords?: Texture): Container {
    const box = new Container();
    box.label = swords ? "route end label: ends in a battle" : "route end label";
    const l = label(text, "medfont", today ? WHITE : YELLOW);
    // A battle at the end: the attack cursor's crossed swords before the number, as tall as the text (no pointer to
    // turn into swords on a touch screen; The owner 2026-11-02 12:17, EXTRAS routeFightSword).
    const sh = Math.max(16, Math.ceil(l.height));
    const sw = swords ? new Sprite(swords) : null;
    if (sw) sw.scale.set(sh / Math.max(1, swords!.height));
    const gap = sw && text ? 3 : 0;
    const inner = (sw ? Math.ceil(sw.width) + gap : 0) + Math.ceil(l.width);
    const w = inner + 8;
    const h = Math.max(Math.ceil(l.height), sw ? sh : 0) + 2;
    box.addChild(new Graphics().roundRect(-w / 2, 0, w, h, 4).fill({ color: 0x000000, alpha: 0.6 }));
    if (sw) {
      sw.position.set(-Math.round(inner / 2), 1);
      box.addChild(sw);
    }
    l.position.set(-Math.round(inner / 2) + (sw ? Math.ceil(sw.width) + gap : 0), 1 + Math.round((h - 2 - l.height) / 2));
    box.addChild(l);
    this.pathLabel = { box, x: t.x, y: t.y };
    this.fitPathLabel();
    return box;
  }

  private fitPathLabel() {
    const p = this.pathLabel;
    if (!p || p.box.destroyed) return void (this.pathLabel = null);
    const k = 1.5 / (this.root.scale.x || 1);
    p.box.scale.set(k);
    p.box.position.set((p.x + 0.5) * TILE, (p.y + 1) * TILE - 6);
  }

  /**
   * A battle fought on a tile, as a picture: a flash and the crossed swords (the adventure cursor's) swelling and
   * shaking over the tile, green rim for a battle our side won, red for one it lost. Used by the replay of the others' turns.
   */
  async battleMark(x: number, y: number, won: boolean, ms = 1500) {
    const tex = (await loadDef("cradvntr.def").catch(() => null))?.get(0)?.[5];
    const mark = new Container();
    const cx = (x + 0.5) * TILE;
    const cy = (y + 0.5) * TILE;
    const ring = new Graphics();
    mark.addChild(ring);
    const sword = tex ? new Sprite(tex) : null;
    if (sword) (sword.anchor.set(0.5), mark.addChild(sword));
    mark.position.set(cx, cy);
    this.root.addChildAt(mark, this.root.getChildIndex(this.fog));
    void playSound("BATTLE");
    const start = performance.now();
    await new Promise<void>((done) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / ms);
        const pulse = 1 + 0.25 * Math.sin(t * Math.PI * 7);
        ring.clear().circle(0, 0, TILE * (0.5 + 2.2 * t)).stroke({ width: 3, color: won ? 0x66ff66 : 0xff5544, alpha: 1 - t });
        if (sword) (sword.scale.set(3.6 * pulse), (sword.rotation = 0.12 * Math.sin(t * Math.PI * 11)), (sword.alpha = t > 0.8 ? (1 - t) / 0.2 : 1));
        if (t < 1) requestAnimationFrame(step);
        else done();
      };
      step();
    });
    mark.destroy({ children: true });
  }

  /**
   * Where a portal leads (EXTRAS portalLinks): from its entrance, a line to each exit or entrance found on this level,
   * a ring round each pulsing, the next exit in turn gold with an arrow over it. Until the returned function clears it.
   */
  portalLinks(from: { x: number; y: number }, to: { x: number; y: number; next?: boolean; back?: boolean }[]): () => void {
    const layer = new Container();
    const lines = new Graphics();
    const rings = new Graphics();
    layer.addChild(lines, rings);
    this.root.addChildAt(layer, this.root.getChildIndex(this.fog) + 1);
    const c = (p: { x: number; y: number }) => ({ x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE });
    const a = c(from);
    const start = performance.now();
    let alive = true;
    const step = () => {
      if (!alive) return;
      const t = (performance.now() - start) / 1000;
      // The lines draw out from the portal over a fifth of a second, then the rings breathe.
      const grow = Math.min(1, t / 0.2);
      lines.clear();
      rings.clear();
      for (const p of to) {
        const b = c(p);
        const colour = p.next ? 0xffd700 : p.back ? 0x9fd0ff : 0xffffff;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        // Dashes marching from the portal to the exit (from the entrance to the exit when it leads here).
        const dash = 14, gap = 10, phase = ((t * 40) % (dash + gap)) * (p.back ? -1 : 1);
        for (let d = phase - (dash + gap); d < len * grow; d += dash + gap) {
          const s0 = Math.max(0, d), s1 = Math.min(len * grow, d + dash);
          if (s1 <= s0) continue;
          lines.moveTo(a.x + ((b.x - a.x) * s0) / len, a.y + ((b.y - a.y) * s0) / len).lineTo(a.x + ((b.x - a.x) * s1) / len, a.y + ((b.y - a.y) * s1) / len);
        }
        lines.stroke({ width: p.next ? 5 : 3, color: colour, alpha: 0.85 });
        if (grow < 1) continue;
        const pulse = 0.5 + 0.5 * Math.sin(t * 5);
        rings.circle(b.x, b.y, TILE * (0.9 + 0.25 * pulse)).stroke({ width: p.next ? 5 : 3, color: colour, alpha: 0.6 + 0.4 * pulse });
        if (p.next) rings.poly([b.x - 12, b.y - TILE * 1.6 - 10 * pulse, b.x + 12, b.y - TILE * 1.6 - 10 * pulse, b.x, b.y - TILE * 1.1 - 10 * pulse]).fill({ color: colour });
      }
      rings.circle(a.x, a.y, TILE * 0.9).stroke({ width: 3, color: 0xffd700, alpha: 0.9 });
      requestAnimationFrame(step);
    };
    step();
    return () => {
      alive = false;
      layer.destroy({ children: true });
    };
  }

  /** The hero walking the route reached (x, y): the arrows up to there go, as in the original. */
  passPath(x: number, y: number) {
    const at = this.pathTiles.findIndex((t) => t.x === x && t.y === y);
    if (at < 0) return;
    for (const t of this.pathTiles.splice(0, at + 1)) for (const d of t.drawn) d.destroy({ children: true });
  }
}

// ADAG.DEF frame by [direction we came from][direction we leave to], each as dx+1 + 3*(dy+1)
// with "came from" measured back towards the previous tile (table from VCMI's MapRenderer).
const ARROWS = [
  [16, 17, 18, 7, 0, 19, 6, 5, 12],
  [8, 9, 18, 7, 0, 19, 6, 13, 20],
  [8, 1, 10, 7, 0, 19, 14, 21, 20],
  [24, 17, 18, 15, 0, 11, 6, 5, 4],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [8, 1, 2, 15, 0, 11, 22, 21, 20],
  [24, 17, 10, 23, 0, 3, 14, 5, 4],
  [24, 9, 2, 23, 0, 3, 22, 13, 4],
  [16, 1, 2, 23, 0, 3, 22, 21, 12],
];

