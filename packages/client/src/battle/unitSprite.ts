import { fast } from "../speed.ts";
import type { BattleClock } from "./anim/clock.ts";
import { ACTION_FPS, IDLE_FPS, MOUSE_OVER_FPS, shootFps, walkFps } from "./anim/pace.ts";
import { ColorMatrixFilter, Container, Graphics, Sprite } from "pixi.js";
import { GameText, WHITE, formatMetric } from "../text.ts";
import type { DefTextures } from "../assets.ts";
import { CREATURE_ANCHOR } from "./layout.ts";
import { said } from "../i18n/index.ts";

// Animation groups in creature DEFs.
export const Anim = {
  Move: 0,
  MouseOver: 1,
  Stand: 2,
  Hit: 3,
  Defend: 4,
  Death: 5,
  AttackUp: 11,
  Attack: 12,
  AttackDown: 13,
  ShootUp: 14,
  Shoot: 15,
  ShootDown: 16,
  SpecialUp: 17,
  Special: 18,
  SpecialDown: 19,
  MoveStart: 20,
  MoveEnd: 21,
  CastUp: 30,
  Cast: 31,
  CastDown: 32,
  /** HotA's sandworms burrow where they stand and come up where they land (the mod's CSANDWX groups 50 and 51). */
  Dive: 50,
  Rise: 51,
} as const;

/** The groups a shot, a cast or a special attack plays (paced by the attack animation time). */
const SHOOTING = new Set<number>([Anim.ShootUp, Anim.Shoot, Anim.ShootDown, Anim.SpecialUp, Anim.Special, Anim.SpecialDown, Anim.CastUp, Anim.Cast, Anim.CastDown]);
/** The groups that keep their own pace whatever the battle speed (VCMI: idle is not scaled). */
const CALM = new Set<number>([Anim.Stand, Anim.MouseOver]);

/** Colour matrices (5 x 4): the picture unchanged, and its greyscale (luminance) multiplied by a colour. */
const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const LUMA = [0.299, 0.587, 0.114];
const greyTimes = ([r, g, b]: [number, number, number]) => [...LUMA.map((x) => x * r), 0, 0, ...LUMA.map((x) => x * g), 0, 0, ...LUMA.map((x) => x * b), 0, 0, 0, 0, 0, 1, 0];

/** The outline's gold (warmer than VCMI's pure yellow, as HotA's screenshots show it) and VCMI's creatureBlueBorder. */
export const OUTLINE_GOLD = 0xffe65a;
export const OUTLINE_CYAN = 0x00ffff;
/** The count box's gold rim. */
const RIM_GOLD = 0xffe784;

/** A creature on the battlefield: animated DEF sprite plus its stack-size box. */
export class UnitSprite extends Container {
  readonly body = new Sprite();
  readonly countBox = new Container();
  private readonly countText = new GameText("tiny", WHITE, "center", 28);
  private group: number = Anim.Stand;
  private frame = 0;
  private elapsed = 0;
  private loop = true;
  private done: (() => void) | null = null;

  readonly frames: DefTextures;
  facingLeft: boolean;
  /** The pulsing outline: gold while the stack has its turn, cyan while it's pointed at (VCMI's border colours). */
  readonly outline = new Sprite();
  private outlineFrames: DefTextures | null = null;
  private pulse = 0;

  constructor(frames: DefTextures, facingLeft: boolean, countBg: Sprite) {
    super();
    this.frames = frames;
    this.facingLeft = facingLeft;
    this.outline.visible = false;
    // The count box lives in the battle's own layer above every creature (BattleView places it).
    this.addChild(this.body, this.outline);
    countBg.position.set(0, 0);
    this.countBg = countBg;
    this.countBox.addChild(countBg);
    // The box's gold rim keeps its colour; only the grey inside takes the spells' tint (as the original
    // shifts only the grey palette slots: purple inside, the same gold rim, in HotA's screenshots).
    const { width: w, height: h } = countBg.texture;
    this.countRim = new Graphics().rect(0, 0, w, 1).rect(0, h - 1, w, 1).rect(0, 1, 1, h - 2).rect(w - 1, 1, 1, h - 2).fill(0xffffff);
    this.countRim.tint = RIM_GOLD;
    this.countBox.addChild(this.countRim);
    this.countText.position.set(1, 0);
    this.countBox.addChild(this.countText);
    this.play(Anim.Stand, true);
  }

  /** What it is playing now, for a feedback note's drawn tree (bundle.ts): the group by name, the frame of how many. */
  get animNow(): string {
    const name = Object.keys(Anim).find((k) => Anim[k as keyof typeof Anim] === this.group) ?? `group ${this.group}`;
    return `${name} ${this.frame + 1}/${this.frames.get(this.group)?.length ?? 0}${this.loop ? " loop" : ""}${this.fidgeting ? " fidget" : ""}`;
  }

  /** Width of the creature's DEF canvas. */
  get canvasWidth(): number {
    return this.frames.get(Anim.Stand)?.[0]?.fullWidth ?? this.frames.get(0)?.[0]?.fullWidth ?? 450;
  }

  /** Turn to face left or right (walking backwards, then back toward the enemy). */
  setFacing(left: boolean) {
    if (left === this.facingLeft) return;
    this.facingLeft = left;
    this.applyFrame();
  }

  setOutline(frames: DefTextures | null, colour = OUTLINE_GOLD) {
    this.outlineFrames = frames;
    this.outline.tint = colour;
    this.outline.visible = !!frames;
    this.applyFrame();
  }

  private readonly countBg: Sprite;
  private readonly countRim: Graphics;

  /** The box's rim: the original's gold, or (the sideCounts extra) the colour of the player the stack fights for. */
  setRim(colour = RIM_GOLD) {
    this.countRim.tint = colour;
  }

  setCount(n: number) {
    this.countText.value = said(formatMetric(n));
    this.countBox.visible = n > 0;
  }

  /**
   * The box's colour for the spells on the stack, as VCMI tints CMNUMWIN: purple with none, green
   * when the helpful ones outnumber the harmful, red the other way, yellow when they balance.
   */
  setMood(mood: "none" | "positive" | "negative" | "mixed") {
    this.countBg.tint = { none: 0x9933ff, positive: 0x33ff33, negative: 0xff3333, mixed: 0xffff33 }[mood];
  }

  /**
   * The stack's lasting look, as VCMI's battleEffects colour muxers: a petrified stack turns to grey
   * stone and stands still, a clone is drawn in shades of blue.
   */
  setLook(look: "normal" | "stone" | "clone") {
    if (look === this.look) return;
    this.look = look;
    this.applyLook();
  }
  private look: "normal" | "stone" | "clone" = "normal";

  /** The look's colour matrix: greyscale multiplied by white (stone) or blue (clone); none when normal. */
  private lookMatrix(): number[] | null {
    return this.look === "normal" ? null : greyTimes(this.look === "stone" ? [1, 1, 1] : [0, 0, 1]);
  }

  private applyLook() {
    const m = this.lookMatrix();
    if (!m) {
      this.body.filters = [];
      return;
    }
    const f = new ColorMatrixFilter();
    f.matrix = m as unknown as typeof f.matrix;
    this.body.filters = [f];
  }

  /**
   * A passing colour (VCMI's timed colour muxers, Bloodlust's red): `k` 0..1 of the way from the
   * stack's own look to greyscale multiplied by `rgb`; 0 puts the own look back.
   */
  mixColour(k: number, rgb: [number, number, number]) {
    if (k <= 0) return this.applyLook();
    const from = this.lookMatrix() ?? IDENTITY;
    const to = greyTimes(rgb);
    const f = new ColorMatrixFilter();
    f.matrix = from.map((x, i) => x + (to[i] - x) * k) as unknown as typeof f.matrix;
    this.body.filters = [f];
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]) {
    // Whoever waits on it carries on (a stack gone from the field mid-blow must not hold the battle).
    this.finish();
    this.offClock?.();
    this.countBox.destroy({ children: true });
    super.destroy(options);
  }

  has(group: number): boolean {
    return (this.frames.get(group)?.length ?? 0) > 0;
  }

  /**
   * The chance, after each round of standing, that the creature fidgets (its "mouse over" group
   * once), as VCMI's onAnimationFinished: CRANIM.TXT's time between fidgets x 10 percent.
   */
  fidgets = 0.1;
  /** CRANIM.TXT's walk animation time: above 1 the legs move slower, below faster. */
  walkTime = 1;
  /** CRANIM.TXT's attack animation time (HotA's mod changes it): its shots and casts, slower above 1. */
  attackTime = 1;
  /** The battle's clock: when it hurries, a group under way ends at once (battle/anim/clock.ts). */
  set clock(c: BattleClock | undefined) {
    this.offClock?.();
    this.offClock = c?.onHurry(() => this.finish());
    this.clockRef = c;
  }
  get clock(): BattleClock | undefined {
    return this.clockRef;
  }
  private clockRef: BattleClock | undefined;
  private offClock: (() => void) | undefined;
  /** Held on this frame of the group (a shooter at its climax while its missile flies: VCMI's playUntil). */
  private holdAt = -1;
  private fidgeting = false;

  /** The "mouse over" group once while it stands idle (fidgeting, or the pointer coming over it). */
  fidget() {
    if (this.group !== Anim.Stand || !this.loop || this.look === "stone" || !this.has(Anim.MouseOver)) return;
    void this.play(Anim.MouseOver);
    this.done = null;
    this.fidgeting = true;
  }

  /** Resolves once the group now playing reaches frame `n` (counted from 0), or gives way to another. */
  untilFrame(n: number): Promise<void> {
    if (this.frame >= n) return Promise.resolve();
    return new Promise((resolve) => this.frameWaits.push({ frame: n, resolve }));
  }
  private frameWaits: { frame: number; resolve: () => void }[] = [];

  /** Stops at frame `n` of the group playing until `release` (or another group). */
  holdOn(n: number) {
    this.holdAt = n;
  }
  release() {
    this.holdAt = -1;
  }

  /** The group under way ends now on its last frame (the clock hurrying, the stack destroyed). */
  finish() {
    for (const w of this.frameWaits.splice(0)) w.resolve();
    if (this.loop || !this.done) return;
    this.holdAt = -1;
    this.frame = Math.max(0, (this.frames.get(this.group)?.length ?? 1) - 1);
    if (!this.destroyed) this.applyFrame();
    const d = this.done;
    this.done = null;
    d();
  }

  /** Plays a group; resolves when a non-looping group finishes. */
  play(group: number, loop = false): Promise<void> {
    this.done?.();
    this.fidgeting = false;
    this.holdAt = -1;
    for (const w of this.frameWaits.splice(0)) w.resolve();
    if (!this.has(group)) group = Anim.Stand;
    this.group = group;
    this.frame = 0;
    // Stacks standing side by side breathe out of step; anything else starts on its first frame (a blow
    // given a head start of up to 300 ms skipped the first six frames of its swing).
    this.elapsed = loop && group === Anim.Stand ? Math.random() * 300 : 0;
    this.loop = loop;
    this.applyFrame();
    if (loop) {
      this.done = null;
      return Promise.resolve();
    }
    // Fast mode (or the battle hurrying): show the last frame and carry on.
    if (fast || this.clockRef?.hurrying) {
      this.frame = Math.max(0, (this.frames.get(group)?.length ?? 1) - 1);
      this.applyFrame();
      this.done = null;
      return Promise.resolve();
    }
    return new Promise((resolve) => (this.done = resolve));
  }

  /** Freeze on the last frame of a group (corpses). */
  holdLast(group: number) {
    const frames = this.frames.get(group) ?? [];
    this.group = group;
    this.loop = false;
    this.frame = Math.max(0, frames.length - 1);
    this.done = null;
    this.applyFrame();
  }

  /** Moves on by a frame's real milliseconds; `speed`: the battle's, times normal (standing and fidgeting keep their own). */
  tick(realMs: number, speed = 1) {
    if (this.outline.visible) {
      this.pulse += realMs;
      // VCMI's getBorderStrength: up and down once a second, between 100/255 and full.
      const t = (this.pulse / 1000) % 1;
      this.outline.alpha = (100 + 155 * (t < 0.5 ? t * 2 : 2 - t * 2)) / 255;
    }
    const frames = this.frames.get(this.group);
    // A statue doesn't fidget.
    if (this.look === "stone" && this.loop) return;
    if (!frames || frames.length < 2) {
      if (!this.loop && this.done) {
        const d = this.done;
        this.done = null;
        d();
      }
      return;
    }
    this.elapsed += CALM.has(this.group) ? realMs : realMs * speed;
    // As VCMI's getCreatureAnimationSpeed (pace.ts): the legs keep pace with the walk, shots and casts with the attack time.
    const fps =
      this.group === Anim.Stand ? IDLE_FPS
      : this.group === Anim.MouseOver ? MOUSE_OVER_FPS
      : this.group === Anim.Move ? walkFps(this.walkTime)
      : SHOOTING.has(this.group) ? shootFps(this.attackTime)
      : ACTION_FPS;
    const step = 1000 / fps;
    while (this.elapsed >= step) {
      this.elapsed -= step;
      if (this.holdAt >= 0 && this.frame >= this.holdAt) {
        this.elapsed = 0;
        break;
      }
      if (this.frame + 1 < frames.length) {
        this.frame++;
      } else if (this.loop) {
        this.frame = 0;
        if (this.group === Anim.Stand && Math.random() < this.fidgets) {
          this.fidget();
          return;
        }
      } else if (this.fidgeting) {
        void this.play(Anim.Stand, true);
        return;
      } else if (this.done) {
        const d = this.done;
        this.done = null;
        d();
        break;
      }
    }
    this.applyFrame();
  }

  private applyFrame() {
    if (this.frameWaits.length) {
      const last = (this.frames.get(this.group)?.length ?? 1) - 1;
      this.frameWaits = this.frameWaits.filter((w) => (this.frame >= Math.min(w.frame, last) ? (w.resolve(), false) : true));
    }
    const f = this.frames.get(this.group)?.[this.frame];
    if (!f) return;
    this.body.texture = f.texture;
    const o = this.outlineFrames?.get(this.group)?.[this.frame];
    if (o) this.outline.texture = o.texture;
    // The container sits on the hex centre; place the frame relative to the canvas anchor.
    for (const s of [this.body, this.outline]) {
      if (this.facingLeft) {
        s.scale.x = -1;
        s.position.set(CREATURE_ANCHOR.x - 1 - f.x, f.y - CREATURE_ANCHOR.y);
      } else {
        s.scale.x = 1;
        s.position.set(f.x - CREATURE_ANCHOR.x, f.y - CREATURE_ANCHOR.y);
      }
    }
  }
}

// Outline of the original 45x52 cell (ccellgrd.pcx): flat top, 10px slopes, rows 42px apart.
const HEX_POINTS = [19, 0, 26, 0, 45, 10, 45, 42, 26, 52, 19, 52, 0, 42, 0, 10];

/** Outlined hex, readable on top of other shading (enemy ranges). */
export function hexRing(color: number): Graphics {
  return new Graphics().poly(HEX_POINTS).fill({ color, alpha: 0.12 }).stroke({ color, alpha: 0.9, width: 2, alignment: 1 });
}

/** Translucent hex used for movement range and hover. */
export function hexShape(color: number, alpha: number): Graphics {
  return new Graphics().poly(HEX_POINTS).fill({ color, alpha });
}



