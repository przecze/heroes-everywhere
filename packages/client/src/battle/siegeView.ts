// The town walls in a siege battle, drawn like VCMI's BattleSiegeController: each piece of
// the walls is a picture at a fixed spot, sorted with the creatures by the hex it stands on.
import { type BattleState, type Unit, type WallPart, TOWER_POS, gateOpen as bridgeDown, hexCol, hexRow } from "@heroes/core";
import { Container, Sprite, Texture } from "pixi.js";
import { loadImage, loadPng, setArrowTowerPortrait, textureCanvas } from "../assets.ts";
import { playSound } from "../audio.ts";
import { extra } from "../settings.ts";
import type { BattleClock } from "./anim/clock.ts";
import { GATE_MS } from "./anim/pace.ts";
import { SIEGES, type SiegeLayout } from "./sieges.ts";

const towerPortraits = new Map<string, Promise<Texture | null>>();
const BEFORE_ALL = -1;
const AFTER_ALL = 100000;
/** Draw order for a piece standing on a hex (same scale as the unit sprites' zIndex). */
const zOf = (hex: number) => (hex < 0 ? hex : hexRow(hex) * 100 + hexCol(hex) + 0.5);

/** Factions whose wall backdrop is TPW1 rather than TPWL. */
const TPW1 = ["rampart", "necropolis", "dungeon", "stronghold"];

interface Piece {
  /** Image suffix; a function of the part's state for breakable pieces. */
  name: (s: BattleState) => string | null;
  at: (l: SiegeLayout) => { x: number; y: number } | undefined;
  z: number;
  /** Behind everything (moat, background wall). */
  back?: boolean;
  /** The part of the walls this picture shows (lit when aimed at). */
  part?: WallPart;
}

const wallImage = (part: WallPart) => (s: BattleState) => {
  const hp = s.siege!.walls[part] ?? 0;
  return hp >= s.siege!.wallMax ? "1" : hp > 0 ? "2" : "3";
};
/**
 * The keep and the two corner towers stand in every walled town (VCMI's BattleSiegeController draws them
 * whatever the fortifications; heroes.thelazy.net Earthquake: an unguarded tower can fall); only their
 * battlements, where the archers stand, come with the Citadel and the Castle.
 */
const towerImage = (part: WallPart) => (s: BattleState) => (s.siege!.walls[part] === undefined || (s.siege!.walls[part] ?? 0) > 0 ? "1" : "2");
/** The gateway's hexes (VCMI's GATE_BRIDGE / GATE_OUTER / GATE_INNER); the bridge is a hex of Fortress's wide moat. */
export const GATE_HEXES = [94, 95, 96];
/** Someone in the gateway, or passing through it right now: the drawbridge is down. */
let passing = false;
/** The drawbridge half-way up or down, for a moment while it moves. */
let swinging = false;
const gateOpen = (s: BattleState) => passing || bridgeDown(s);

function archName() {
  return "arch";
}

const ifStanding = (part: WallPart, name: string) => (s: BattleState) => ((s.siege!.walls[part] ?? 0) > 0 ? name : null);

const PIECES: Piece[] = [
  { name: (s) => (s.siege!.moat ? "moat" : null), at: (l) => l.moat.moat, z: BEFORE_ALL, back: true },
  { name: (s) => (s.siege!.moat ? "mlip" : null), at: (l) => l.moat.bank, z: BEFORE_ALL, back: true },
  { name: (s) => (TPW1.includes(s.siege!.faction) ? "tpw1" : "tpwl"), at: (l) => l.static.background, z: BEFORE_ALL },
  { name: (s) => `man${towerImage("keep")(s)}`, at: (l) => l.towers.keep.tower, z: zOf(135), part: "keep" },
  { name: (s) => `tw1${towerImage("bottomTower")(s)}`, at: (l) => l.towers.bottom.tower, z: AFTER_ALL, part: "bottomTower" },
  { name: (s) => `wa1${wallImage("bottomWall")(s)}`, at: (l) => l.walls.bottom, z: zOf(182), part: "bottomWall" },
  { name: (s) => `wa3${wallImage("belowGate")(s)}`, at: (l) => l.walls.bottomMid, z: zOf(130), part: "belowGate" },
  { name: (s) => `wa4${wallImage("overGate")(s)}`, at: (l) => l.walls.upperMid, z: zOf(62), part: "overGate" },
  { name: (s) => `wa6${wallImage("upperWall")(s)}`, at: (l) => l.walls.upper, z: zOf(12), part: "upperWall" },
  { name: (s) => `tw2${towerImage("upperTower")(s)}`, at: (l) => l.towers.top.tower, z: BEFORE_ALL, part: "upperTower" },
  // The drawbridge has no picture while it's up (the backdrop shows it raised), DRW1 half-way while it
  // swings, DRW2 lowered (VCMI's gate OPENED, damaged or not), DRW3 broken.
  { name: (s) => ((s.siege!.walls.gate ?? 0) <= 0 ? "drw3" : swinging ? "drw1" : !gateOpen(s) ? null : "drw2"), at: (l) => l.gate.gate, z: BEFORE_ALL, part: "gate" },
  { name: archName, at: (l) => l.gate.arch, z: zOf(112), part: "gate" },
  { name: () => "wa2", at: (l) => l.static.bottom, z: zOf(165) },
  { name: () => "wa5", at: (l) => l.static.top, z: zOf(45) },
  { name: ifStanding("keep", "manc"), at: (l) => l.towers.keep.battlement, z: zOf(135) + 0.01, part: "keep" },
  { name: ifStanding("bottomTower", "tw1c"), at: (l) => l.towers.bottom.battlement, z: AFTER_ALL + 0.01, part: "bottomTower" },
  { name: ifStanding("upperTower", "tw2c"), at: (l) => l.towers.top.battlement, z: BEFORE_ALL + 0.01, part: "upperTower" },
];

export class SiegeView {
  private readonly sprites = new Map<number, Sprite>();
  private layout: SiegeLayout | null = null;
  private faction = "";

  private readonly back: Container;
  private readonly front: Container;

  private readonly clock: BattleClock;

  constructor(back: Container, front: Container, clock: BattleClock) {
    this.back = back;
    this.front = front;
    this.clock = clock;
  }

  /** The town's battlefield picture. */
  async background(s: BattleState): Promise<Texture | null> {
    if (!s.siege) return null;
    return this.image(s.siege.faction, "back");
  }

  /** The tower archers' creature key for this town. */
  shooter(s: BattleState): string {
    return (SIEGES[s.siege?.faction ?? ""] ?? SIEGES.castle).shooter;
  }

  /** Where a tower's archer stands: its canvas top-left at the configured point. */
  turretCanvas(u: Unit): { x: number; y: number } | null {
    const l = this.layout;
    if (!l || u.machine !== "tower") return null;
    const t = u.pos === TOWER_POS.keep ? l.towers.keep : u.pos === TOWER_POS.bottomTower ? l.towers.bottom : l.towers.top;
    return t.creature;
  }

  /** Draw order of a tower's archer: just under its battlement. */
  turretZ(u: Unit): number {
    return u.pos === TOWER_POS.keep ? zOf(135) : u.pos === TOWER_POS.bottomTower ? AFTER_ALL : BEFORE_ALL;
  }

  /** Puts up (or updates, after the catapult) every piece of the walls. */
  private wasOpen = false;

  /** Lowers the bridge for a unit about to walk through the gateway (or lets `sync` decide again). */
  async passGate(s: BattleState, through: boolean) {
    passing = through;
    await this.sync(s);
  }

  async sync(s: BattleState) {
    if (!s.siege) return this.clear();
    // The drawbridge creaks whenever it goes up or down.
    const open = (s.siege.walls.gate ?? 0) > 0 && gateOpen(s);
    const moves = open !== this.wasOpen && this.layout !== null;
    if (open !== this.wasOpen && !this.clock.hurrying) void playSound("DRAWBRG");
    this.wasOpen = open;
    // The half-open bridge for a moment (VCMI's GateAnimation: 200 ms, whatever the speed).
    if (moves && !this.clock.hurrying) {
      swinging = true;
      await this.place(s);
      await this.clock.wait(GATE_MS, true);
      swinging = false;
    }
    await this.place(s);
  }

  private async place(s: BattleState) {
    if (!s.siege) return;
    this.faction = s.siege.faction;
    this.layout = SIEGES[this.faction] ?? SIEGES.castle;
    const faction = this.faction;
    setArrowTowerPortrait((size) => this.towerPortrait(faction, size));
    await Promise.all(
      PIECES.map(async (p, i) => {
        const name = p.name(s);
        const at = p.at(this.layout!);
        let sp = this.sprites.get(i);
        if (!name || !at) {
          if (sp) sp.visible = false;
          return;
        }
        const tex = await this.image(this.faction, name);
        if (!tex) return;
        if (!sp) {
          sp = new Sprite(tex);
          this.sprites.set(i, sp);
          (p.back ? this.back : this.front).addChild(sp);
        }
        sp.texture = tex;
        sp.visible = true;
        sp.position.set(at.x, at.y);
        sp.zIndex = p.z;
        // (EXTRAS gateSeeThrough) Someone in the gateway shows through the arch, to be seen and aimed at.
        sp.alpha = p.name === archName && extra("gateSeeThrough") && GATE_HEXES.slice(1).some((h) => s.units.some((u) => u.count > 0 && u.pos === h)) ? 0.45 : 1;
      }),
    );
  }

  /**
   * The tower (the keep, the corner towers) whose picture is under a global point, standing or not: they are aimed at by
   * their pictures, which rise far above their one hex (2026-10-27: the keep couldn't be targeted).
   */
  towerPictureAt(gx: number, gy: number): WallPart | null {
    for (const [i, p] of PIECES.entries()) {
      if (p.part !== "keep" && p.part !== "upperTower" && p.part !== "bottomTower") continue;
      const sp = this.sprites.get(i);
      if (!sp || sp.destroyed || !sp.visible || !sp.texture) continue;
      const b = sp.getBounds();
      if (gx < b.minX || gx >= b.maxX || gy < b.minY || gy >= b.maxY) continue;
      // (Not its see-through corners: the picture's own pixels only, roughly the middle two thirds across.)
      if (Math.abs(gx - (b.minX + b.maxX) / 2) > b.width / 3) continue;
      return p.part;
    }
    return null;
  }

  /** Lights the pictures of one part of the walls in gold (the target a tap would aim at), or none. */
  mark(part: WallPart | null) {
    PIECES.forEach((p, i) => {
      const sp = this.sprites.get(i);
      if (sp) sp.tint = part && p.part === part ? 0xffe070 : 0xffffff;
    });
  }

  clear() {
    for (const sp of this.sprites.values()) sp.destroy();
    this.sprites.clear();
    this.wasOpen = false;
    this.layout = null;
    setArrowTowerPortrait(null);
  }

  /**
   * The arrow towers' picture in the turn queue and the popups. HotA's towns bring their own
   * (towerIconSmall / towerIconLarge); those are the upper tower over the town's backdrop, a little
   * enlarged, so the original towns' are cut from their own pictures the same way.
   */
  private towerPortrait(faction: string, size: "small" | "large"): Promise<Texture | null> {
    const key = `${faction}/${size}`;
    let p = towerPortraits.get(key);
    if (!p) {
      p = (async () => {
        const l = SIEGES[faction] ?? SIEGES.castle;
        const icon = size === "small" ? l.towerIconSmall : l.towerIconLarge;
        if (typeof icon === "string") return loadPng(`${icon}.png`).catch(() => null);
        const [back, tower, crown] = await Promise.all([this.image(faction, "back"), this.image(faction, "tw21"), this.image(faction, "tw2c")]);
        if (!back || !tower) return null;
        // (Each picture by its own frame: a texture cut from a sheet would otherwise bring the whole sheet.)
        const put = (ctx: CanvasRenderingContext2D, t: Texture, x: number, y: number) => {
          const f = t.frame;
          ctx.drawImage(textureCanvas(t), f.x, f.y, f.width, f.height, x, y, f.width, f.height);
        };
        const at = l.towers.top.tower;
        const top = l.towers.top.battlement;
        // The tower's top as wide as the tower (HotA's own portraits frame it so: the crown and some of its body over
        // the town's backdrop); large 58x64, small 32x32 from the top's middle (2026-10-27: "weird portrait
        // choice for turrets", a crop of the wall's rubble beside it).
        const tw = tower.width;
        const [w, h, ow, oh] = size === "large" ? [tw, Math.round((tw * 64) / 58), 58, 64] : [Math.round(tw * 0.8), Math.round(tw * 0.8), 32, 32];
        const x0 = Math.round(at.x + tw / 2 - w / 2);
        const y0 = Math.min(at.y, top.y) - 2;
        const out = document.createElement("canvas");
        out.width = ow;
        out.height = oh;
        const ctx = out.getContext("2d")!;
        ctx.scale(ow / w, oh / h);
        put(ctx, back, -x0, -y0);
        put(ctx, tower, at.x - x0, at.y - y0);
        if (crown) put(ctx, crown, top.x - x0, top.y - y0);
        return Texture.from(out);
      })();
      towerPortraits.set(key, p);
    }
    return p;
  }

  private image(faction: string, suffix: string): Promise<Texture | null> {
    const prefix = (SIEGES[faction] ?? SIEGES.castle).imagePrefix.toLowerCase();
    const load = prefix.includes("/") ? loadPng(`${prefix}${suffix}.png`, true) : loadImage(`${prefix}${suffix}.pcx`);
    return load.catch(() => null);
  }
}
