// The original View World screen (VWORLD.PCX on the side panel, VwSymbol icons over a
// zoomed-out map), also used by the View Air and View Earth spells.
import { viewport } from "./viewport.ts";
import { type AdventureState, type MapViews, viewShows, viewShowsTerrain, visitOffset, worldViewKind } from "@heroes/core";
import { Container, Sprite } from "pixi.js";
import { type FrameTexture, loadDef, loadImage } from "../assets.ts";
import { DefButton, label } from "../ui/kit.ts";
import { WHITE, YELLOW } from "../text.ts";
import { tr, type Text, said } from "../i18n/index.ts";

const TILE = 32;
// VwSymbol.def: 19 icons per player colour (neutral after the eight players).
const ICON = { town: 0, hero: 1, artifact: 2, teleport: 3, gate: 4, mine: 5, resource: 12 } as const;
const PER_PLAYER = 19;


export interface WorldViewHost {
  panel: Container;
  mapLayer: Container;
  player: number;
  state: () => AdventureState;
  camera: { x: number; y: number; zoom: number };
  /** The map's size in tiles. */
  mapSize: () => number;
  applyCamera: () => void;
  /** Whole terrain shown (expert View Earth). */
  revealAll: (on: boolean) => void;
  level: () => number;
  toggleLevel: () => void;
  openPuzzle: () => void;
  /** Called when the world view closes, with the tile to return to. */
  onClose: (x: number, y: number) => void;
  /** Phones: puts the side panel where it fits, its OK button in reach (at the desktop's spot it ran off the screen). */
  placeSide?: (side: Container) => void;
}

export class WorldView {
  active = false;
  private readonly icons = new Container();
  private readonly side = new Container();
  private host: WorldViewHost | null = null;
  /** What today's View Air / View Earth show (core viewShows): artifacts, heroes, towns; resources, mines, all terrain. */
  private spell: MapViews = {};
  private saved = { x: 0, y: 0, zoom: 1 };
  /** Where the world view itself first looked: unmoved, closing goes back to where the player was. */
  private opened = { x: 0, y: 0 };
  private symbols: FrameTexture[] = [];

  async open(host: WorldViewHost, spell: MapViews = {}) {
    this.host = host;
    this.spell = spell;
    this.active = true;
    this.saved = { ...host.camera };
    this.symbols = (await loadDef("vwsymbol.def")).get(0) ?? [];
    if (viewShowsTerrain(spell)) host.revealAll(true);
    // The panel under the minimap: zoom buttons, the legend, puzzle, level and OK.
    this.side.removeChildren();
    const bg = new Sprite(await loadImage("vworld.pcx"));
    this.side.addChild(bg);
    const p = Math.max(0, host.player);
    const zooms: [string, number, number][] = [["vwmag1.def", 1, 0.25], ["vwmag2.def", 64, 0.5], ["vwmag4.def", 128, 1]];
    for (const [def, x, zoom] of zooms) {
      const b = new DefButton(def, x, 23, p);
      b.onClick = () => this.zoom(zoom);
      this.side.addChild(b);
    }
    const legend: [number, number, number][] = [
      [ICON.town, 5, 59], [ICON.hero, 5, 79], [ICON.artifact, 5, 99], [ICON.teleport, 5, 119], [ICON.gate, 5, 139],
      ...[0, 1, 2, 3, 4, 5, 6].map((i): [number, number, number] => [ICON.mine + i, 5, 183 + 20 * i]),
      ...[0, 1, 2, 3, 4, 5, 6].map((i): [number, number, number] => [ICON.resource + i, 154, 183 + 20 * i]),
    ];
    for (const [i, x, y] of legend) {
      // (The DEF's frames are 32 x 32 with the symbol trimmed out: placed by their offsets.)
      const f = this.symbols[i + PER_PLAYER * p];
      if (f) this.side.addChild(Object.assign(new Sprite(f.texture), { x: x + f.x, y: y + f.y }));
    }
    // Labels, at VCMI's spots (config/widgets/adventureMap.json): the legend's names TOPLEFT, their
    // tops on the 17 px strips of VWORLD; the title, the resources' names and the two headings
    // centred on their points (half the line's height above), on whole pixels.
    const text = (t: Text, x: number, y: number, font: "smalfont" | "bigfont" = "smalfont", color: readonly [number, number, number] = WHITE, centre = true) => {
      const l = label(t, font, color);
      if (centre) l.centreOn(x, y);
      else l.position.set(x, y);
      this.side.addChild(l);
      return l;
    };
    text(tr("World View"), 94, 11, "bigfont", YELLOW);
    ["Town", "Hero", "Artifact", "Teleporter", "Gate"].forEach((t, i) => text(said(t), 43, 66 + 20 * i, "smalfont", WHITE, false));
    // ("Mines" from its left edge, its middle on 173 as the others: the small font's 16 rows.)
    text(tr("Mines"), 7, 173 - 8, "smalfont", WHITE, false);
    text(tr("Resources"), 150, 173);
    ["Wood", "Mercury", "Ore", "Sulfur", "Crystal", "Gems", "Gold"].forEach((t, i) => text(said(t), 101, 198 + 20 * i));
    const puzzle = new DefButton("vwpuz.def", 5, 343, p);
    puzzle.onClick = () => host.openPuzzle();
    const level = new DefButton(host.level() ? "iam003.def" : "iam010.def", 79, 343, p);
    level.onClick = () => {
      host.toggleLevel();
      void this.redraw();
    };
    const ok = new DefButton("iokay32.def", 119, 343, p);
    ok.onClick = () => this.close();
    this.side.addChild(puzzle, level, ok);
    this.side.position.set(800 - 3 - 190, 195);
    host.placeSide?.(this.side);
    // (Above the info panel, which the update after a View Air / View Earth cast redraws: its hit areas would take the clicks.)
    this.side.zIndex = 1000;
    host.panel.sortableChildren = true;
    host.panel.addChild(this.side);
    host.mapLayer.addChild(this.icons);
    this.zoom(0.25);
    this.opened = this.centre();
  }

  /** Back to the normal view, centred where the player was looking. */
  close() {
    const host = this.host;
    if (!host || !this.active) return;
    this.active = false;
    // Scrolled about in the world view: there. Else where the player was looking before (the world
    // view's own middle is the map's, often unexplored: the map came back all black).
    // (The view's middle, not its corner: a zoom button moves the corner and keeps the middle.)
    const at = this.centre();
    const moved = Math.abs(at.x - this.opened.x) > 1 || Math.abs(at.y - this.opened.y) > 1;
    const from = moved ? host.camera : this.saved;
    const cx = from.x + viewport.w / 2 / from.zoom;
    const cy = from.y + viewport.h / 2 / from.zoom;
    host.revealAll(false);
    this.side.removeFromParent();
    this.icons.removeFromParent();
    Object.assign(host.camera, this.saved);
    host.onClose(Math.floor(cx / TILE), Math.floor(cy / TILE));
  }

  /** The map point in the middle of the view. */
  private centre() {
    const c = this.host!.camera;
    return { x: c.x + viewport.w / 2 / c.zoom, y: c.y + viewport.h / 2 / c.zoom };
  }

  /** Zoom keeping the centre of the view. */
  zoom(z: number) {
    const host = this.host!;
    const c = host.camera;
    const cx = c.x + viewport.w / 2 / c.zoom;
    const cy = c.y + viewport.h / 2 / c.zoom;
    c.zoom = z;
    c.x = cx - viewport.w / 2 / z;
    c.y = cy - viewport.h / 2 / z;
    // A map that fits the view across (or down) sits in its middle, as the original's.
    const px = host.mapSize() * TILE;
    if (px * z <= viewport.w) c.x = (px - viewport.w / z) / 2;
    if (px * z <= viewport.h) c.y = (px - viewport.h / z) / 2;
    host.applyCamera();
    void this.redraw();
  }

  /** Icons for what the player has seen, plus what the spell shows. */
  async redraw() {
    const host = this.host;
    if (!host || !this.active) return;
    const s = host.state();
    const me = host.player;
    const z = host.level();
    const seen = (x: number, y: number) => {
      const p = s.players[me];
      if (!p?.revealed.length) return true;
      const i = (z * s.size + y) * s.size + x;
      return !!(p.revealed[i >> 5] & (1 << (i & 31)));
    };
    const forced = (kind: keyof typeof ICON) => viewShows(this.spell, kind);
    this.icons.removeChildren();
    const c = host.camera;
    const put = (x: number, y: number, frame: number) => {
      const f = this.symbols[frame];
      if (!f) return;
      const icon = new Sprite(f.texture);
      // The symbol's whole 32 x 32 frame centred on the tile (its trimmed picture at its offset).
      icon.position.set(Math.round((x * TILE + TILE / 2 - c.x) * c.zoom) - f.fullWidth / 2 + f.x, Math.round((y * TILE + TILE / 2 - c.y) * c.zoom) - f.fullHeight / 2 + f.y);
      this.icons.addChild(icon);
    };
    const owner = (o: { owner: number }) => (o.owner >= 0 && o.owner < 8 ? o.owner : 8) * PER_PLAYER;
    for (const o of s.objects) {
      if (o.removed || o.z !== z || o.carriedBy !== undefined) continue;
      const kind = worldViewKind(o);
      if (!kind) continue;
      const [dx, dy] = visitOffset(o.visit) ?? [0, 0];
      const x = o.x + dx;
      const y = o.y + dy;
      if (!seen(x, y) && !forced(kind)) continue;
      put(x, y, owner(o) + ICON[kind] + (kind === "mine" || kind === "resource" ? Math.min(6, o.subid) : 0));
    }
    for (const h of s.heroes) {
      if (h.removed || h.z !== z) continue;
      if (!seen(h.x, h.y) && !forced("hero") && h.owner !== me) continue;
      put(h.x, h.y, owner(h) + ICON.hero);
    }
  }
}
