// The town's picture: the background with the built buildings and decorations animated, each building's click mask
// and hover outline (System Options' Town Outlines), a new building's reveal; a click opens its window, a right-click
// (a long press) says what it is; upright a finger drags the wide picture sideways.
import { TOWNS, buildingName, type AdvObject } from "@heroes/core";
import { decodePcx } from "@heroes/formats";
import { Graphics, Sprite, Texture } from "pixi.js";
import { type DefTextures, fetchRes, loadDef, opaqueBox } from "../assets.ts";
import { playSound } from "../audio.ts";
import { remember } from "../net.ts";
import { settings } from "../settings.ts";
import { loadFonts } from "../text.ts";
import { loadImagePlayer } from "../ui/kit.ts";
import { phoneSized, screenSize } from "../ui/screen.ts";
import { townBackground, townDef, unpatched } from "./art.ts";
import type { TownScreen } from "./screen.ts";
import { buildingClicked, buildingInfo } from "./windows.ts";
import { said } from "../i18n/index.ts";

interface HitArea {
  id: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  alpha: Uint8Array;
  border: Texture | null;
}

const maskCache = new Map<string, Promise<{ w: number; h: number; alpha: Uint8Array; tex: Texture; white: Texture } | null>>();

async function townMask(name: string) {
  const base = unpatched(name);
  return (await loadMask(name)) ?? (base ? loadMask(`${base}.bmp`) : null);
}

/** A building's click mask or hover outline (the TZ and TO images; palette slot 0 is transparent). */
/**
 * Loads a town's scene into the caches (background, its buildings' and decorations' animations, the
 * click masks) without drawing it: the map warms the player's towns while idle, so the first visit
 * doesn't wait for the downloads.
 */
export async function preloadTown(o: AdvObject) {
  const info = TOWNS[o.subid];
  if (!info || !o.town) return;
  const built = new Set(o.town.built);
  const items = [...[...built].map((id) => info.buildings[id]).filter((b) => b?.def), ...info.decorations.filter((d) => !d.builds)];
  await Promise.all([
    townBackground(info.background).catch(() => null),
    ...items.map((b) => townDef(b!.def).catch(() => null)),
    ...items.flatMap((b) => ("area" in b! && b!.area ? [b!.area, ...(b!.border ? [b!.border] : [])] : [])).map((m) => townMask(m).catch(() => null)),
    loadImagePlayer("townscrn.pcx", o.owner).catch(() => null),
    loadImagePlayer("aresbar.pcx", o.owner).catch(() => null),
    ...["itpt", "itmtl", "itmcl", "twcrport", "tsbtns"].map((d) => loadDef(`${d}.def`).catch(() => null)),
  ]);
}

function loadMask(name: string) {
  // Classic towns: TZ*/TO* PCX images; HotA towns: PNGs by path.
  const key = name.includes("/") ? `${name.toLowerCase().replace(/\.png$/, "")}.png` : name.toLowerCase().replace(/\.bmp$/, ".pcx");
  let p = maskCache.get(key);
  if (!p) {
    p = fetchRes(key)
      .then(async (bytes) => {
        const img = key.endsWith(".png") ? await decodePng(bytes) : decodePcx(bytes);
        const alpha = new Uint8Array(img.width * img.height);
        for (let i = 0; i < alpha.length; i++) alpha[i] = img.rgba[i * 4 + 3];
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d")!.putImageData(new ImageData(img.rgba as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
        // The same shape in white, for the outline's flash when the building goes up (tinted).
        const white = document.createElement("canvas");
        white.width = img.width;
        white.height = img.height;
        const wd = new Uint8ClampedArray(alpha.length * 4);
        for (let i = 0; i < alpha.length; i++) wd.set([255, 255, 255, alpha[i]], i * 4);
        white.getContext("2d")!.putImageData(new ImageData(wd, img.width, img.height), 0, 0);
        return { w: img.width, h: img.height, alpha, tex: Texture.from(canvas), white: Texture.from(white) };
      })
      .catch(() => null);
    remember(maskCache, key, p);
  }
  return p;
}

/** Decodes a PNG into RGBA (for HotA's click masks). */
async function decodePng(bytes: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }));
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const g = c.getContext("2d")!;
  g.drawImage(bitmap, 0, 0);
  const rgba = g.getImageData(0, 0, c.width, c.height).data;
  // Masks converted from the original's images keep its see-through cyan (palette slot 0).
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i] === 0 && rgba[i + 1] === 255 && rgba[i + 2] === 255) rgba[i + 3] = 0;
  return { width: c.width, height: c.height, rgba };
}

export class TownScene {
  private animated: { sprite: Sprite; frames: DefTextures; x: number; y: number }[] = [];
  /** The buildings under a point, topmost first. */
  hits: HitArea[] = [];
  private t = 0;
  /** The buildings last drawn for a town: what's new since then fades in. */
  private lastBuilt: { town: number; ids: Set<number> } | null = null;

  readonly tick = (tk: { deltaMS: number }) => {
    this.t += tk.deltaMS;
    const k = Math.floor(this.t / 150);
    for (const a of this.animated) {
      const frames = a.frames.get(0) ?? [];
      const f = frames[k % Math.max(1, frames.length)];
      if (f) {
        a.sprite.texture = f.texture;
        a.sprite.position.set(a.x + f.x, a.y + f.y);
      }
    }
  };

  private readonly town: TownScreen;
  constructor(town: TownScreen) {
    this.town = town;
    const scene = town.scene;
    scene.eventMode = "static";
    scene.on("pointermove", (e) => this.hover(scene.toLocal(e.global)));
    // A long press on a touch screen is a right-click: its tap doesn't open the building too.
    scene.on("pointertap", (e) => e.button === 0 && !panned && this.click(scene.toLocal(e.global)));
    // Upright the picture is wider than the screen: a finger drags it sideways (a drag isn't a tap).
    let panFrom: { x: number; body: number } | null = null;
    let panned = false;
    scene.on("pointerdown", (e) => {
      panned = false;
      if (screenSize.portrait && phoneSized() && town.body.width > 800) panFrom = { x: town.root.toLocal(e.global).x, body: town.body.x };
    });
    scene.on("globalpointermove", (e) => {
      if (!panFrom) return;
      const d = town.root.toLocal(e.global).x - panFrom.x;
      if (!panned && Math.abs(d) < 12) return;
      panned = true;
      town.body.x = Math.round(Math.max(800 - 800 * town.body.scale.x, Math.min(0, panFrom.body + d)));
    });
    scene.on("pointerup", () => (panFrom = null));
    scene.on("pointerupoutside", () => (panFrom = null));
    // Right-click: what the building is (the original's popup).
    scene.on("rightdown", (e) => {
      const h = this.buildingAt(scene.toLocal(e.global));
      if (h && town.state && !town.modals.open) void buildingInfo(town.ctx(), h.id, true);
    });
    scene.on("pointerleave", () => this.hover({ x: -1, y: -1 }));
  }

  async draw(o: AdvObject) {
    const town = this.town;
    const scene = town.scene;
    const info = TOWNS[o.subid];
    await loadFonts();
    const built = new Set(o.town!.built);
    const fresh = this.lastBuilt?.town === o.id ? new Set([...built].filter((id) => !this.lastBuilt!.ids.has(id))) : new Set<number>();
    this.lastBuilt = { town: o.id, ids: built };
    const appearing: Sprite[] = [];
    // Upgrades replace what they upgrade on screen (Town Hall over Village Hall, ...).
    const shown = [...built].filter((id) => ![...built].some((other) => info.buildings[other]?.upgrades === id));
    const items: { def: string; x: number; y: number; z: number; id?: number; area?: string; border?: string }[] = [
      ...shown.filter((id) => info.buildings[id]?.def).map((id) => ({ ...info.buildings[id], id })),
      ...info.decorations.filter((d) => !d.builds),
    ].sort((a, b) => a.z - b.z);
    // Everything loads at once, then the scene is swapped in whole (no buildings popping in one by one).
    const [background, allFrames, masks] = await Promise.all([
      townBackground(info.background),
      Promise.all(items.map((b) => townDef(b.def).catch(() => null))),
      Promise.all(items.map((b) => (b.id !== undefined && b.area ? Promise.all([townMask(b.area), b.border ? townMask(b.border) : Promise.resolve(null)]) : Promise.resolve(null)))),
    ]);
    scene.removeChildren().forEach((c) => c.destroy());
    this.animated = [];
    this.hits = [];
    scene.addChild(new Sprite(background));
    for (const [n, b] of items.entries()) {
      const frames = allFrames[n];
      if (!frames) continue;
      // HotA's building DEFs hold the whole building in frame 0 and only small animated patches in
      // the frames after it: the base stays, the patches play over it (else the building blinks).
      const all = frames.get(0) ?? [];
      const base = all[0];
      // (By what each frame draws: the mod's PNGs all keep the building's whole canvas, Factory's Mechanics' smoke too.)
      const drawn = (f: (typeof all)[number]) => {
        const box = opaqueBox(f.texture);
        return box ? box.width * box.height : f.texture.width * f.texture.height;
      };
      const patches = base && all.length > 1 && all.slice(1).every((f) => drawn(f) < drawn(base) * 0.9);
      if (patches) {
        const under = new Sprite(base.texture);
        under.position.set(b.x + base.x, b.y + base.y);
        scene.addChild(under);
        const sprite = new Sprite();
        scene.addChild(sprite);
        this.animated.push({ sprite, frames: new Map([[0, all.slice(1)]]) as typeof frames, x: b.x, y: b.y });
        if (b.id !== undefined && fresh.has(b.id)) appearing.push(under, sprite);
      } else {
        const sprite = new Sprite();
        scene.addChild(sprite);
        this.animated.push({ sprite, frames, x: b.x, y: b.y });
        if (b.id !== undefined && fresh.has(b.id)) appearing.push(sprite);
      }
      const m = masks[n];
      if (b.id !== undefined && m?.[0]) {
        const [area, border] = m;
        this.hits.push({ id: b.id, x: b.x, y: b.y, z: b.z, w: area.w, h: area.h, alpha: area.alpha, border: border?.tex ?? null });
        // Named for the drawn tree (feedback/bundle.ts, the UI catalog): the building's box, taking no taps itself.
        const o = town.state?.objects[town.objectId];
        if (town.world && o) scene.addChild(Object.assign(new Graphics().rect(b.x, b.y, area.w, area.h).fill({ color: 0, alpha: 0.001 }), { eventMode: "none" as const, label: `building: ${buildingName(town.world, o, b.id)}` }));
      }
    }
    this.hits.sort((a, b) => b.z - a.z);
    this.tick({ deltaMS: 0 });
    // A building just built appears as the original's (VCMI's CBuildingRect): it fades in over half a
    // second with the building sound, then its outline flashes, dark to white, back to dark, then to
    // its own yellow, and goes (at 2.5 seconds).
    if (appearing.length) {
      void playSound("BUILDTWN");
      for (const sp of appearing) sp.alpha = 0;
      const flashes = items.flatMap((b, n) => {
        const border = masks[n]?.[1];
        if (b.id === undefined || !fresh.has(b.id) || !border) return [];
        const sp = Object.assign(new Sprite(border.white), { x: b.x, y: b.y, visible: false });
        scene.addChild(sp);
        return [sp];
      });
      const lerp = (a: number, b: number, k: number) => {
        const ch = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * k) << sh;
        return ch(16) | ch(8) | ch(0);
      };
      const DARK = 0x000000;
      const LIGHT = 0xffffff;
      const BASE = 0xffff00;
      let t = 0;
      const fade = (tk: { deltaMS: number }) => {
        t += tk.deltaMS;
        for (const sp of appearing) if (!sp.destroyed) sp.alpha = Math.min(1, t / 500);
        const k = (t % 500) / 500;
        for (const sp of flashes) {
          if (sp.destroyed) continue;
          sp.visible = t > 500 && t < 2500;
          sp.tint = t < 1000 ? lerp(DARK, LIGHT, k) : t < 1500 ? lerp(LIGHT, DARK, k) : lerp(DARK, BASE, Math.min(1, (t - 1500) / 1000));
        }
        if (t >= 2500 || [...appearing, ...flashes].every((sp) => sp.destroyed)) {
          for (const sp of flashes) if (!sp.destroyed) sp.destroy();
          town.app.ticker.remove(fade);
        }
      };
      town.app.ticker.add(fade);
    }
  }

  private buildingAt(p: { x: number; y: number }): HitArea | undefined {
    if (p.y >= 374) return undefined;
    return this.hits.find((h) => {
      const x = Math.floor(p.x - h.x);
      const y = Math.floor(p.y - h.y);
      return x >= 0 && y >= 0 && x < h.w && y < h.h && h.alpha[y * h.w + x] > 0;
    });
  }

  private hover(p: { x: number; y: number }) {
    const town = this.town;
    const h = this.buildingAt(p);
    const o = town.state?.objects[town.objectId];
    // System Options' Town Outlines.
    town.outline.visible = !!h?.border && settings().townOutlines;
    if (h?.border) {
      town.outline.texture = h.border;
      town.outline.position.set(h.x, h.y);
    }
    town.scene.cursor = h ? "pointer" : "default";
    town.setStatus(h && o && town.world ? said(buildingName(town.world, o, h.id)) : said(""));
  }

  private click(p: { x: number; y: number }) {
    const town = this.town;
    const h = this.buildingAt(p);
    if (!h || !town.state || town.modals.open) return;
    void buildingClicked(town.ctx(), h.id);
  }
}
