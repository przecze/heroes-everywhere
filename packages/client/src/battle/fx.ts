// The battlefield's passing pictures: spell effects (VCMI's EffectAnimation placement), spell and
// creature missiles, beam rays and stones, all on the battle's clock at the paces of anim/pace.ts.
import type { Container } from "pixi.js";
import { Graphics, Sprite, Texture } from "pixi.js";
import { loadDef } from "../assets.ts";
import { playSound } from "../audio.ts";
import type { BattleClock } from "./anim/clock.ts";
import { EFFECT_FPS, RAY_LINGER_MS, catapultMs, missileMs, rayMs } from "./anim/pace.ts";
import { SCREEN_H, SCREEN_W } from "./layout.ts";
import type { ShotHit } from "./shotHits.ts";

/** From a hex's centre down to its bottom edge (VCMI's hexPositionLocal: 42 high). */
const HEX_BOTTOM = 21;
/** From a hex's centre down to where a stack's feet stand. */
const STACK_FEET = 10;
/** Missile DEFs with one frame per flight angle (degrees up from level, pointing right), as CRANIM.TXT has them for every shooter. */
const MISSILE_ANGLES = [90, 72, 45, 27, 0, -27, -45, -72, -90];

type Point = { x: number; y: number };

export interface FxHost {
  clock: BattleClock;
  /** Where the pictures go when drawn over everything (above the creatures). */
  layer: Container;
  /** The creatures' layer (sorted by zIndex): an effect on a stack is drawn at its depth, behind the rows in front. */
  stacks: Container;
}

/**
 * How an effect stands on its spot, the classes every spell, ability and trigger picture belongs to (VCMI's
 * EffectAnimation): "top", its canvas centred on the hex's top edge (the default); "bottom", standing on the
 * hex's bottom edge (the spells VCMI marks "verticalPosition": "bottom": the lightning bolts reaching down
 * from the top of the field, Prayer's beam, Slow's mire); "feet", our one exception, rising from the stack's
 * feet (morale and luck, which sat too low and spilled onto the row below: the owner's notes of 2026-10-23).
 */
export type Anchor = "top" | "bottom" | "feet";

export interface EffectPlace {
  anchor?: Anchor;
  /** See-through (VCMI's "transparency"). */
  alpha?: number;
  /** Tiled over the whole field (a spell without a target spot: Armageddon). */
  field?: boolean;
  /** Drawn among the stacks at this depth (a spell's "affect" on a stack); without it, over everything (its "hit"). */
  depth?: number;
}

export class BattleFx {
  private readonly host: FxHost;

  constructor(host: FxHost) {
    this.host = host;
  }

  /** Calls `fn` with 0..1 over `ms` (normal-speed milliseconds); at once while the battle hurries. */
  tween(ms: number, fn: (t: number) => void): Promise<void> {
    return this.host.clock.tween(ms, fn);
  }

  delay(ms: number) {
    return this.host.clock.wait(ms);
  }

  /** An effect DEF played once at (cx, cy), a hex's centre (or the middle of a wide stack's two), placed as `place` says. */
  async effectAt(def: string, cx: number, cy: number, place: EffectPlace = {}) {
    const frames = (await loadDef(def).catch(() => null))?.get(0) ?? [];
    if (!frames.length) return;
    const anchor = place.anchor ?? "top";
    // The lowest drawn pixel over all frames, on the effect's own canvas.
    const foot = Math.max(...frames.map((f) => f.y + f.texture.height));
    const spots: [number, number][] = [];
    if (place.field) {
      const f = frames[0];
      for (let y = 0; y < SCREEN_H; y += f.fullHeight) for (let x = 0; x < SCREEN_W; x += f.fullWidth) spots.push([x + f.fullWidth / 2, y + f.fullHeight / 2 + 20]);
    } else spots.push([cx, cy]);
    const layer = place.depth !== undefined && !place.field ? this.host.stacks : this.host.layer;
    const sprites = spots.map(() => layer.addChild(Object.assign(new Sprite(), { alpha: place.alpha ?? 1, zIndex: (place.depth ?? 0) + 0.5 })));
    // VCMI's getSpellEffectSpeed (pace.ts), each frame from the time passed: a frame per timer ran up to a third
    // slow, by how often the screen refreshed.
    await this.host.clock.frames(frames.length, EFFECT_FPS, (n) => {
      const f = frames[n];
      sprites.forEach((sprite, i) => {
        sprite.texture = f.texture;
        // Effects are drawn on their own canvas (VCMI: its full size), placed by its anchor.
        const top = anchor === "feet" ? spots[i][1] + STACK_FEET - foot : anchor === "bottom" ? spots[i][1] + HEX_BOTTOM - f.fullHeight : spots[i][1] - f.fullHeight / 2 - 20;
        sprite.position.set(spots[i][0] - f.fullWidth / 2 + f.x, top + f.y);
      });
    });
    for (const sprite of sprites) sprite.destroy();
  }

  /** Where a shot lands (a Magog's fireball, a Lich's cloud): the first of its DEFs found, with its sound. */
  async shotHit(hit: ShotHit, cx: number, cy: number) {
    for (let i = 0; i < hit.defs.length; i++) {
      const frames = (await loadDef(hit.defs[i]).catch(() => null))?.get(0) ?? [];
      if (!frames.length) continue;
      const sound = hit.sounds[Math.min(i, hit.sounds.length - 1)];
      if (sound) void playSound(sound);
      return this.effectAt(hit.defs[i], cx, cy, { alpha: hit.alpha?.[i] });
    }
  }

  /**
   * A spell's missile (Magic Arrow, Ice Bolt...) from `from` (the hero's hand, a casting creature) to `to`: the DEF
   * for the flight's steepness, VCMI's createSpellProjectile (the angle from straight down against each DEF's
   * minimumAngle; HotA adds DEFs for shots upwards).
   */
  async spellMissile(defs: { def: string; angle: number }[], from: Point, to: Point) {
    const angle = Math.abs(Math.atan2(to.x - from.x, to.y - from.y));
    const pick = [...defs].sort((a, b) => a.angle - b.angle).filter((d) => angle >= d.angle).pop() ?? defs[0];
    const frames = (await loadDef(pick.def).catch(() => null))?.get(0) ?? [];
    if (!frames.length) return;
    const sprite = this.host.layer.addChild(new Sprite());
    const left = to.x < from.x;
    // As a shooter's missile, its frames at the spell effects' rate (VCMI's ProjectileAnimatedMissile).
    const ms = missileMs(Math.hypot(to.x - from.x, to.y - from.y));
    await this.tween(ms, (t) => {
      const f = frames[Math.floor((t * ms * EFFECT_FPS) / 1000) % frames.length];
      sprite.texture = f.texture;
      sprite.scale.x = left ? -1 : 1;
      const [x, y] = [from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t];
      sprite.position.set(x + (left ? f.fullWidth / 2 - f.x : -f.fullWidth / 2 + f.x), y - f.fullHeight / 2 + f.y);
    });
    sprite.destroy();
  }

  /**
   * Beam shooters: parallel lines fading from the start to the end colour, drawn out from the shooter to the
   * target and held a moment (VCMI's ProjectileRay); it stood whole for a fixed 350 ms.
   */
  async ray(from: Point, to: Point, colors: number[][][]) {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const nx = -(to.y - from.y) / len;
    const ny = (to.x - from.x) / len;
    const g = new Graphics();
    const SEGMENTS = 12;
    const draw = (reach: number) => {
      g.clear();
      colors.forEach(([start, end], i) => {
        const off = i - (colors.length - 1) / 2;
        for (let k = 0; k < SEGMENTS && k / SEGMENTS < reach; k++) {
          const t0 = k / SEGMENTS;
          const t1 = Math.min(reach, (k + 1) / SEGMENTS);
          const lerp = (j: number) => start[j] + (end[j] - start[j]) * t0;
          g.moveTo(from.x + (to.x - from.x) * t0 + nx * off, from.y + (to.y - from.y) * t0 + ny * off)
            .lineTo(from.x + (to.x - from.x) * t1 + nx * off, from.y + (to.y - from.y) * t1 + ny * off)
            .stroke({ color: (lerp(0) << 16) | (lerp(1) << 8) | lerp(2), alpha: lerp(3) / 255, width: 1 });
        }
      });
    };
    this.host.layer.addChild(g);
    await this.tween(rayMs(len), draw);
    await this.host.clock.wait(RAY_LINGER_MS, true);
    g.destroy();
  }

  /**
   * A catapult's (or a Cyclops') stone thrown in a high arc to the walls, spinning on its frames
   * (VCMI's ProjectileCatapult: a parabola from the shooter to the struck wall).
   */
  async lob(def: string | undefined, from: Point, to: Point) {
    const frames = def ? ((await loadDef(def).catch(() => null))?.get(0) ?? []) : [];
    const sprite = new Sprite(frames[0]?.texture ?? Texture.WHITE);
    sprite.anchor.set(0.5);
    if (!frames.length) sprite.width = sprite.height = 8;
    this.host.layer.addChild(sprite);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // The higher the farther it flies.
    const rise = 80 + Math.abs(dx) * 0.35;
    // VCMI's ProjectileCatapult: at the catapult's pace, spinning at the spell effects' rate
    // (it spun a frame every third screen refresh, twice as fast on a 120 Hz phone).
    const ms = catapultMs(Math.hypot(dx, dy));
    await this.tween(ms, (t) => {
      if (frames.length > 1) sprite.texture = frames[Math.floor((t * ms * EFFECT_FPS) / 1000) % frames.length].texture;
      sprite.position.set(from.x + dx * t, from.y + dy * t - rise * 4 * t * (1 - t));
    });
    sprite.destroy();
  }

  /** A shooter's missile (or a white streak without one) from one point to another. */
  async missile(def: string | undefined, from: Point, to: Point) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const frames = def ? ((await loadDef(def)).get(0) ?? []) : [];
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    if (frames.length === MISSILE_ANGLES.length) {
      // One frame per flight angle (pointing right); mirrored for leftward shots.
      const angle = (Math.atan2(-dy, Math.abs(dx)) * 180) / Math.PI;
      let best = 0;
      MISSILE_ANGLES.forEach((a, i) => Math.abs(a - angle) < Math.abs(MISSILE_ANGLES[best] - angle) && (best = i));
      sprite.texture = frames[best].texture;
      sprite.scale.x = dx < 0 ? -1 : 1;
    } else if (frames.length) {
      sprite.texture = frames[0].texture;
    } else {
      sprite.texture = Texture.WHITE;
      sprite.width = 6;
      sprite.height = 2;
    }
    this.host.layer.addChild(sprite);
    // VCMI's getProjectileSpeed (pace.ts).
    const ms = missileMs(Math.hypot(dx, dy));
    await this.tween(ms, (t) => {
      // Spinning missiles (monk orbs) cycle their frames at the spell effects' rate (they stepped a frame per screen refresh).
      if (frames.length && frames.length !== MISSILE_ANGLES.length) sprite.texture = frames[Math.floor((t * ms * EFFECT_FPS) / 1000) % frames.length].texture;
      sprite.position.set(from.x + dx * t, from.y + dy * t);
    });
    sprite.destroy();
  }
}
