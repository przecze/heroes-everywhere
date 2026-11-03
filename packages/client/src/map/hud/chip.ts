// The touch HUD's hero widget (bottom left): the selected hero's (or town's) portrait and army.
import { type AdventureState, stackSkills, upperArmy } from "@heroes/core";
import { Container, Graphics, Rectangle, Sprite } from "pixi.js";
import { heroPortrait, loadDef, townIcon } from "../../assets.ts";
import { YELLOW } from "../../text.ts";
import { StackGrid } from "../../ui/blocks/stackGrid.ts";
import { heroPortraitHold } from "../../ui/heroPortraitHold.ts";
import { DefButton } from "../../ui/kit.ts";
import { oneHand, screenSize } from "../../ui/screen.ts";
import { track } from "../../usage.ts";
import type { MobileHud } from "../mobileHud.ts";
import { type Rgb, backing, text } from "./look.ts";
import { ARMY_SHAPES, type ArmyShape } from "./store.ts";

/** The head (portrait, bars, morale and luck) the stacks are placed round. */
const HEAD_W = 62;
const HEAD_H = 53;
const GAP = 4;

/** Where a stack's count goes: beside the portrait in the one column, else under it. */
const countPlace = (shape: ArmyShape) => (shape === "column" ? "beside" : "below") as "beside" | "below";

/** Where each of the seven places goes in `shape`, the head at the top left. */
export function armyPlaces(shape: ArmyShape, cw: number, ch: number): [number, number][] {
  const col = Math.max(HEAD_W, cw) + GAP;
  const firstRow = Math.max(HEAD_H, ch) + GAP;
  return Array.from({ length: 7 }, (_, k): [number, number] => {
    if (shape === "row") return [HEAD_W + GAP + k * (cw + GAP), 0];
    if (shape === "rows") {
      // The head takes two cells of the first row of five: three beside it, four under.
      const n = k + 2;
      return [(n % 5) * (cw + GAP), Math.floor(n / 5) * (ch + GAP)];
    }
    if (shape === "pairs") {
      // The head and the first stack, then two to a row.
      const n = k + 1;
      const r = Math.floor(n / 2);
      return [(n % 2) * col + (n % 2 ? 0 : Math.round((HEAD_W - cw) / 2)), r ? firstRow + (r - 1) * (ch + GAP) : 0];
    }
    // One column under the head, the counts beside the portraits (2026-11-02 19:11: the head is wider anyway).
    return [0, firstRow + k * (ch + GAP)];
  });
}

/** A small picture of `shape` (the head as a bigger square, the stacks as small ones), `S` pixels high, in gold. */
export function drawShape(g: Graphics, shape: ArmyShape, S: number, ox = 0, oy = 0) {
  const gold = { color: 0xe5d77b };
  const u = S / 20;
  const sq = (x: number, y: number, w = 3, h = 3) => g.rect(ox + x * u, oy + y * u, w * u, h * u).fill(gold);
  if (shape === "row") {
    sq(0, 7, 5, 5);
    for (let i = 0; i < 4; i++) sq(6 + i * 4, 8);
  } else if (shape === "rows") {
    sq(0, 3, 6, 6);
    for (let i = 0; i < 3; i++) sq(7 + i * 4, 4);
    for (let i = 0; i < 4; i++) sq(3 + i * 4, 11);
  } else if (shape === "pairs") {
    sq(4, 0, 5, 5);
    sq(11, 1);
    for (let r = 0; r < 3; r++) for (const x of [5, 11]) sq(x, 7 + r * 4);
  } else {
    sq(7, 0, 5, 5);
    for (let r = 0; r < 4; r++) sq(8, 6 + r * 4);
  }
}
import { said } from "../../i18n/index.ts";

export class HeroWidget {
  /** Where the widget's top is (HUD pixels), for the list above it. */
  top = 0;
  private h = 0;

  private readonly hud: MobileHud;
  constructor(hud: MobileHud) {
    this.hud = hud;
  }

  /** The widget's shape (store.ts ARMY_SHAPES): one-handed sideways two rows until the player picks, else one row. */
  shape(): ArmyShape {
    const picked = this.hud.store.armyShape(oneHand() && !screenSize.portrait ? "rows" : "row");
    // (A shape too tall for this screen at a finger's size, a column on a sideways phone: the next lower that fits.)
    for (let i = ARMY_SHAPES.indexOf(picked); i >= 0; i--) if (this.fits(ARMY_SHAPES[i])) return ARMY_SHAPES[i];
    return "row";
  }

  /** A finger's size for the portraits: about 36 CSS pixels for each 32-pixel place. */
  private fingerK() {
    return Math.max(1, Math.min(2, 36 / (32 * screenSize.css * this.hud.u)));
  }

  /** Whether `shape` with all seven places stands whole on the screen at a finger's size. */
  private fits(shape: ArmyShape) {
    const { w: cw, h: ch } = StackGrid.cellSize({ size: "small", count: countPlace(shape), countFont: "medfont" });
    const at = armyPlaces(shape, cw, ch);
    const h = Math.max(HEAD_H, ...at.map(([, y]) => y + ch)) + 30;
    const w = Math.max(HEAD_W, ...at.map(([x]) => x + cw)) + 24;
    const k = this.fingerK();
    return h * k <= this.hud.H - 120 && w * k <= this.hud.W - 16;
  }

  /** The shape the corner button makes of it: the next round that fits the screen. */
  nextShape(): ArmyShape {
    const now = ARMY_SHAPES.indexOf(this.shape());
    for (let d = 1; d <= ARMY_SHAPES.length; d++) {
      const next = ARMY_SHAPES[(now + d) % ARMY_SHAPES.length];
      if (this.fits(next)) return next;
    }
    return "row";
  }

  /** The next shape round, remembered. */
  turnShape() {
    this.hud.store.setArmyShape(this.nextShape());
  }

  /**
   * The selected hero at a glance (2026-10-25), small: the portrait with the level on it (a tap: the hero
   * screen), movement and mana as the list's bars, morale and luck small, and the army in the same places as
   * everywhere (ui/blocks/stackGrid.ts: tap picks and moves, a long press the stack's window). Its army in one row of
   * seven, or folded into two rows (a tap on its leather switches; remembered). A stack picked: the Split button
   * beside it (the split window has HotA's quick actions). A town: its picture (a tap opens it) and its garrison.
   */
  async draw(s: AdventureState, me: number, selected: number, selectedTown: number) {
    const hud = this.hud;
    const chip = hud.pieces.chip;
    const h = selected >= 0 ? s.heroes[selected] : undefined;
    const t = selectedTown >= 0 ? s.objects[selectedTown] : undefined;
    const hero = h && !h.removed && h.owner === me && selectedTown < 0 ? h : undefined;
    const town = !hero && t?.town ? t : undefined;
    if (!hero && !town) {
      chip.removeChildren().forEach((x) => x.destroy({ children: true }));
      return;
    }
    const shape = this.shape();
    const c = new Container();
    // The head: the portrait (bars beside a hero's), morale and luck under it.
    const head = new Container();
    head.label = hero ? "button: hero screen" : "button: open the town";
    if (hero) {
      const [pic, mob, mana, morale, luck] = await Promise.all([heroPortrait(hero, "small"), loadDef("imobil.def").then((d) => d.get(0) ?? []), loadDef("imana.def").then((d) => d.get(0) ?? []), loadDef("imrl22.def").then((d) => d.get(0) ?? []), loadDef("ilck22.def").then((d) => d.get(0) ?? [])]);
      const mi = Math.min(mob.length - 1, Math.floor(hero.movement / 100));
      const ai = Math.min(mana.length - 1, Math.floor((hero.mana ?? 0) / 5));
      if (mob[mi]) head.addChild(Object.assign(new Sprite(mob[mi].texture), { x: 0, y: 1 }));
      head.addChild(Object.assign(new Sprite(pic), { x: 7, width: 48, height: 32 }));
      if (mana[ai]) head.addChild(Object.assign(new Sprite(mana[ai].texture), { x: 56, y: 1 }));
      // The level on the portrait's corner.
      const lv = text(said(String(hero.level)), "medfont", 1, [...YELLOW] as Rgb);
      const plate = new Graphics().rect(0, 0, lv.width + 4, lv.height).fill({ color: 0x000000, alpha: 0.6 });
      plate.position.set(8, 32 - lv.height);
      lv.position.set(10, 32 - lv.height);
      head.addChild(plate, lv);
      const ml = hud.moraleLuck?.(hero) ?? { morale: 0, luck: 0 };
      const mf = morale[Math.max(-3, Math.min(3, ml.morale)) + 3];
      const lf = luck[Math.max(-3, Math.min(3, ml.luck)) + 3];
      // The 22-pixel icons side by side under the portrait, as big as the row leaves room for (2026-10-26).
      // Each tapped or held: its text, as on the hero screen (not the hero screen: the event stops here).
      for (const [f, x, isMorale] of [[mf, 8, true], [lf, 33, false]] as const) {
        if (!f) continue;
        const s = Object.assign(new Sprite(f.texture), { x, y: 31 });
        s.label = isMorale ? "button: morale" : "button: luck";
        if (hud.explainMoraleLuck) {
          // The finger's target: the head's whole lower half, morale's left and luck's right.
          s.hitArea = new Rectangle(isMorale ? -x : -2, 0, 31, 22);
          hud.explainMoraleLuck(s, hero, isMorale);
          s.cursor = "pointer";
          s.on("pointertap", (e) => e.stopPropagation());
          s.on("rightdown", (e) => e.stopPropagation());
        }
        head.addChild(s);
      }
    } else if (town?.town) {
      const icon = await townIcon(town.subid, town.town.built.includes(7), false, "small");
      if (icon) head.addChild(Object.assign(new Sprite(icon), { x: 7, width: 48, height: 32 }));
    }
    head.addChildAt(new Graphics().rect(0, 0, 62, 53).fill({ color: 0, alpha: 0.001 }), 0);
    head.eventMode = "static";
    head.cursor = "pointer";
    head.on("pointertap", (e) => {
      e.stopPropagation();
      track(hero ? "hud:chip hero" : "hud:chip town");
      if (hero) hud.onInfoHero();
      else if (town) hud.onTown(town.id);
    });
    // Held, as tapped: the hero's screen (EXTRAS portraitHold); a town's held: its quick view, as in the list.
    if (hero) heroPortraitHold(head, () => hud.onInfoHero(true));
    else if (town) head.on("rightdown", (e) => hud.onListInfo({ town: town.id }, e.global.x, e.global.y));
    c.addChild(head);
    // The army (a town's garrison only to look at: it's managed in the town).
    const army = hero ? hero.army : town ? upperArmy(s, town) : [];
    // Only the stacks there are until one is picked (the player moving them about): then all seven places (the owner,
    // 2026-10-26).
    const packed = !(hero && hud.army?.selected);
    const places = packed ? Math.max(1, army.filter(Boolean).length) : 7;
    const count = countPlace(shape);
    const { w: cw, h: ch } = StackGrid.cellSize({ size: "small", count, countFont: "medfont" });
    const at = armyPlaces(shape, cw, ch);
    const grid = new StackGrid(
      { size: "small", at, count, countFont: "medfont", frames: !!hero, packed },
      {
        creatures: hud.creatures ?? [],
        clicks: hero ? (hud.army ?? undefined) : undefined,
        changed: () => void hud.redraw(),
        info: (slot, count) => {
          const st = army[slot];
          const cr = st && hud.creatures?.[st.creature];
          return { count, ...(hero && cr ? stackSkills(hero, cr) : {}) };
        },
      },
    );
    await grid.set(army);
    c.addChild(grid);
    // The corner button only once there are more stacks than three: before that the shapes look much alike (the owner,
    // 2026-10-26 22:01). Room for it at the right (the rows) or under the stacks (the columns), off the last count.
    const turns = places > 3;
    const tall = shape === "pairs" || shape === "column";
    const used = at.slice(0, places);
    const w = Math.max(HEAD_W, ...used.map(([x]) => x + cw)) + (turns && !tall ? 16 : 0);
    const hgt = Math.max(HEAD_H, ...used.map(([, y]) => y + ch)) + (turns && tall ? 22 : 0);
    const back = backing(w + 8, hgt + 8);
    back.position.set(-4, -4);
    // (Its leather takes taps, so they don't reach the map under it.)
    back.eventMode = "static";
    c.addChildAt(back, 0);
    // The corner button: a picture of the shape a tap makes of it, round the four (2026-11-02 17:58). A town's
    // garrison takes the same shapes (2026-10-30 19:23, the three plus four switch with a town picked).
    if (turns) {
      const grip = new Container();
      grip.label = "button: the army's shape";
      const g = new Graphics();
      drawShape(g, this.nextShape(), 20);
      g.position.set(3, 0);
      grip.addChild(new Graphics().rect(0, 0, 26, 20).fill({ color: 0, alpha: 0.001 }), g);
      grip.position.set(w + 4 - 26, hgt + 4 - 20);
      grip.eventMode = "static";
      grip.cursor = "pointer";
      grip.on("pointertap", (e) => {
        e.stopPropagation();
        track("hud:chip fold");
        this.turnShape();
        void hud.redraw();
      });
      c.addChild(grip);
    }
    // A finger's size for the portraits: about 36 CSS pixels for each 32-pixel place.
    const k = this.fingerK();
    // (Whole on the screen: a column is tall, a row wide.)
    c.scale.set(Math.min(k, (hud.W - 16) / (w + 8), (hud.H - 120) / (hgt + 8)));
    if (hud.root.destroyed) return void c.destroy({ children: true });
    chip.removeChildren().forEach((x) => x.destroy({ children: true }));
    chip.addChild(c);
    this.h = (hgt + 8) * c.scale.y;
    this.place();
    // A stack picked: the Split button over the widget's army end.
    if (hero && hud.army?.selected) {
      const split = new DefButton("hsbtns9.def", 0, 0, -1);
      split.label = "button: split the picked stack";
      split.scale.set(c.scale.x * 1.25);
      split.onClick = () => void hud.army?.splitSelected().then(() => hud.redraw());
      await split.ready;
      split.position.set(Math.min(hud.W - 8 - split.width - chip.x, (w + 8) * c.scale.x - split.width), -split.height - 6);
      chip.addChild(split);
    }
  }

  /**
   * The widget at the foot, over what lies there: upright over the resource bar in the left corner, or over the
   * buttons' widgets too when it is wide enough to reach them; sideways along the thumb's side.
   */
  place() {
    const hud = this.hud;
    const chip = hud.pieces.chip;
    const c = chip.children[0];
    if (!c) return;
    if (!screenSize.portrait) {
      this.top = hud.bottom - this.h;
      return hud.placeBySide(chip, this.top);
    }
    const dock = hud.pieces.bar.children[0];
    const barTop = dock ? dock.y : hud.bottom;
    const reaches = 8 + c.width + hud.widgetGap > hud.rail.left;
    this.top = Math.min(barTop, reaches ? hud.rail.top : barTop) - 8 - this.h;
    chip.position.set(8, Math.round(this.top));
  }
}
