// The commanding heroes at the field's corners: standing, fidgeting, casting (the hand up while the spell plays),
// winning or losing, with their banners.
import type { BattleView } from "./view.ts";
import { HERO_CLASSES, type BattleState, type Side } from "@heroes/core";
import { screenSize } from "../ui/screen.ts";
import { Container, Sprite } from "pixi.js";
import * as pace from "./anim/pace.ts";
import { heroPortrait, loadDef, loadDefPlayer } from "../assets.ts";
import { SCREEN_W, CROP_X, CROP_W } from "./layout.ts";

/** A hero's frames (VCMI's BattleHero: 10 a second, whatever the battle speed). */
const HERO_FRAME_MS = 1000 / pace.HERO_FPS;
/** About how often a hero fidgets. */
const HERO_FIDGET_MS = 8000;

export class BattleHeroes {
  private readonly v: BattleView;
  constructor(v: BattleView) {
    this.v = v;
  }

  readonly layer = new Container();
  /** How far each side's hero is into its cast animation (ms; -1: not casting), and whether it holds the hand up. */
  private readonly heroCastAt: [number, number] = [-1, -1];
  private readonly heroCastHeld: [boolean, boolean] = [false, false];
  /** The heroes' victory (3) or defeat (2) once the battle is over, and how far into it (ms). */
  readonly heroEnd: [{ group: number; at: number } | null, { group: number; at: number } | null] = [null, null];
  /** The heroes' and their flags' frame steps, on the battle's tick. */
  heroTicks: ((ms: number) => void)[] = [];
  private readonly heroCastFrames: [number, number] = [0, 0];
  /** Commanding heroes stand at the field's edges (64x136 boxes), with their banner. */
  async setupHeroes(s: BattleState) {
    this.layer.removeChildren().forEach((c) => c.destroy());
    this.heroTicks = [];
    // The watcher's colour: the side played here (a hot seat's first), else whoever watches, else the attacker's.
    const watched = ([0, 1] as const).find((side) => this.v.mine(side)) ?? 0;
    this.v.touch.sideFlags = [this.v.flagOf(s, 0), this.v.flagOf(s, 1)];
    void this.v.bar.colourBar(Math.max(0, this.v.viewer ?? s.sides[watched].owner ?? 0));
    // Upright: their portraits in the corners over the field (a tap: the hero's details).
    void Promise.all(
      ([0, 1] as const).map(async (side) => {
        const hero = s.sides[side].hero;
        const tex = hero ? await heroPortrait(hero).catch(() => null) : null;
        return tex ? { tex, onTap: () => void this.v.info.showHeroInfo(side) } : null;
      }),
    ).then((faces) => !this.v.root.destroyed && this.v.touch.setHeroes(faces));
    for (const side of [0, 1] as const) {
      const hero = s.sides[side].hero;
      // A town's defender isn't drawn on the field in a siege: the walls stand there (2026-10-26).
      if (!hero || (side === 1 && s.siege)) continue;
      const cls = HERO_CLASSES[hero.heroClass];
      const [frames, flags] = await Promise.all([
        loadDef(`${cls.battleDef[hero.female ? 1 : 0]}.def`).catch(() => null),
        loadDefPlayer(side === 0 ? "cmflagl.def" : "cmflagr.def", hero.owner).catch(() => null),
      ]);
      // Upright the field's sides are cut off: the heroes stand at its edge with only their front half in it, the rider
      // and the horse's head (stepped in whole they stood over the stacks: the owner 2026-11-02 20:33).
      const up = () => screenSize.portrait && this.v.touch.layer.visible;
      const cxOf = () => heroX(side, up());
      const cyOf = () => 68;
      const flag = new Sprite();
      const body = new Sprite();
      this.layer.addChild(flag, body);
      let t = Math.random() * 1000;
      const cast = frames?.get(4) ?? [];
      this.heroCastFrames[side] = cast.length;
      // VCMI's EHeroAnimType: 0 holding (one standing frame), 1 idle (a fidget), 2 defeat, 3 victory,
      // 4 casting. The hero holds still, now and then fidgets once (the horse tosses its head).
      const still = frames?.get(0)?.length ? frames.get(0)! : frames?.get(1) ?? [];
      const fidget = frames?.get(1) ?? [];
      let fidgetAt = t + HERO_FIDGET_MS * (0.5 + Math.random());
      const tick = (ms: number) => {
        if (body.destroyed) return;
        t += ms;
        // The cast: up to the frame the spell leaves on, held there while the spell plays out, then the rest
        // (VCMI's HeroCastAnimation).
        if (this.heroCastAt[side] >= 0) {
          this.heroCastAt[side] += ms;
          if (this.heroCastHeld[side]) this.heroCastAt[side] = Math.min(this.heroCastAt[side], pace.HERO_CAST_FRAME * HERO_FRAME_MS);
        }
        const casting = this.heroCastAt[side] >= 0 ? Math.floor(this.heroCastAt[side] / HERO_FRAME_MS) : -1;
        if (casting >= cast.length) this.heroCastAt[side] = -1;
        // The battle's end: the winner's victory, the loser's defeat, held on the last frame.
        const ending = this.heroEnd[side];
        if (ending) ending.at += ms;
        const endFrames = ending ? frames?.get(ending.group) ?? [] : [];
        const fidgeting = Math.floor((t - fidgetAt) / HERO_FRAME_MS);
        if (fidgeting >= fidget.length) fidgetAt = t + HERO_FIDGET_MS * (0.5 + Math.random());
        const f =
          casting >= 0 && casting < cast.length
            ? cast[casting]
            : ending && endFrames.length
              ? endFrames[Math.min(endFrames.length - 1, Math.floor(ending.at / HERO_FRAME_MS))]
              : fidgeting >= 0 && fidgeting < fidget.length
                ? fidget[fidgeting]
                : still[0];
        const cx = cxOf();
        const cy = cyOf();
        // Upright the heroes step into the field: drawn over the stacks there, not under the next column's (a Stone Golem
        // stood over the horse: the owner, 2026-11-01); elsewhere under them, beside the field, as the original.
        const parent = this.layer.parent;
        const units = this.v.unitsLayer;
        if (parent && units.parent === parent && parent.getChildIndex(this.layer) > parent.getChildIndex(units) !== up()) parent.setChildIndex(this.layer, parent.getChildIndex(units));
        if (f) {
          body.texture = f.texture;
          body.scale.x = side === 1 ? -1 : 1;
          body.position.set(side === 1 ? cx + f.fullWidth / 2 - f.x : cx - f.fullWidth / 2 + f.x, cy - f.fullHeight / 2 + f.y);
        }
        const fl = flags?.get(0) ?? [];
        const ff = fl[Math.floor(t / 100) % Math.max(1, fl.length)];
        if (ff) {
          flag.texture = ff.texture;
          flag.position.set(cx - ff.fullWidth / 2 + ff.x + (side === 0 ? 4 : -4), cy - ff.fullHeight / 2 + ff.y - 41);
        }
      };
      this.heroTicks.push(tick);
      tick(0);
    }
  }

  /**
   * The hero raises their hand to cast; resolves as the spell leaves it (VCMI's HeroCastAnimation: frame 4,
   * at the heroes' own 10 frames a second), the hand held up until `heroCastDone`.
   */
  async heroCasts(side: 0 | 1) {
    if (!this.heroCastFrames[side]) return;
    this.heroCastAt[side] = 0;
    this.heroCastHeld[side] = true;
    await this.v.clock.wait(Math.min(pace.HERO_CAST_FRAME, this.heroCastFrames[side]) * HERO_FRAME_MS, true);
  }

  /** The spell has played out: the hero's cast animation finishes. */
  heroCastDone(side: 0 | 1) {
    this.heroCastHeld[side] = false;
  }

  /** Which side's commanding hero stands at this point (their 64x136 box at the field's top corners), or null. */
  heroAtPoint(x: number, y: number): Side | null {
    if (y < 0 || y > 136) return null;
    // Where they're drawn: upright the field's sides are cut off and they step in (as cxOf above; a hold on the hero on
    // horseback found nobody there: the owner's note 2026-10-30, in the tactics phase).
    const up = screenSize.portrait && this.v.touch.layer.visible;
    // (Upright only the front half shows: a hold there finds them.)
    const reach = (side: Side) => (up ? (side === 0 ? x >= CROP_X && x < heroX(0, true) + 32 : x <= CROP_X + CROP_W && x > heroX(1, true) - 32) : Math.abs(x - heroX(side, false)) < 32);
    const side: Side | null = reach(0) ? 0 : reach(1) ? 1 : null;
    return side !== null && this.v.state?.sides[side].hero && !(side === 1 && this.v.state.siege) ? side : null;
  }

}

/** The middle of a commanding hero's 64-wide box: beside the field, or upright at the cut field's edge (half outside). */
function heroX(side: Side, up: boolean): number {
  if (!up) return side === 0 ? 32 : SCREEN_W - 32;
  return side === 0 ? CROP_X + HALF_IN : CROP_X + CROP_W - HALF_IN;
}
/** How far past the edge the hero's middle stands upright: the rider whole, the horse's back cut off. */
const HALF_IN = 6;
