// An army's seven places, one block for every window that shows them (the adventure info bar and the phone's hero
// widget, the hero screen, exchanges, the town's garrison...): each place a creature portrait with its count, the
// same clicks everywhere (ui/armyClicks.ts: tap picks, a tap on another place moves / swaps / merges, the picked one
// again opens its window), a long press (right button) the stack's window, the gold frame round the picked stack.
import type { CreatureStats } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { creaturePortrait } from "../../assets.ts";
import { type FontName, WHITE, formatMetric } from "../../text.ts";
import { armyWord } from "../../map/describe.ts";
import type { ArmyClicks, StackRef } from "../armyClicks.ts";
import { type CreatureInfo, creatureOnRightClick } from "../creatureInfo.ts";
import { armySelection, dragSource, label, slotAt } from "../kit.ts";
import { HEROSCR4, type WindowPicture, partTexture, tiledPart } from "./windowParts.ts";
import { block } from "./block.ts";
import { said, type Text } from "../../i18n/index.ts";

type Stack = { creature: number; count: number } | null | undefined;

/** The portraits' sizes: CPRSMALL 32 x 32, TWCRPORT 58 x 64. */
export const PORTRAIT = { small: { w: 32, h: 32 }, large: { w: 58, h: 64 } } as const;

export interface StackGridLook {
  size: "small" | "large";
  /** Each place's top left (the original windows' own positions)... */
  at?: readonly (readonly [number, number])[];
  /** ...or rows of `cols` places `gap` apart, the first `skip` cells left free (a hero's portrait goes there). */
  cols?: number;
  gap?: number;
  skip?: number;
  /** The count under the portrait (the info bar's) or in its bottom right corner (VCMI's CGarrisonSlot). */
  count?: "below" | "corner" | "beside";
  countFont?: FontName;
  /** Exact numbers (yours), the size words (others' through a tavern), or none. */
  numbers?: "exact" | "words" | "none";
  /** Empty places drawn as dark squares (where stacks are moved about); else empty places are bare. */
  frames?: boolean;
  /**
   * A hero's army (2026-10-26: "player color background by default no matter in what device context"): the
   * places on the hero screen's band in this player's colours (HEROSCR4's), whoever draws the row.
   */
  band?: number;
  /** Each place on an original window's box (windowParts) in `player`'s colours: the town panel's rows. */
  boxes?: { pic: WindowPicture; name: string; player: number };
  /** Only the stacks, one after another in the places (no empty places): where nothing is being moved about. */
  packed?: boolean;
}

export interface StackGridOptions {
  creatures: readonly CreatureStats[];
  /** Which army of the clicks' this is. */
  who?: number;
  clicks?: ArmyClicks;
  /** Something changed (picked, moved): redraw. */
  changed?: () => void;
  /** A stack's numbers for its popup (the hero's bonuses). */
  info?: (slot: number, count: number) => CreatureInfo;
  /** Without clicks: what a tap on a stack does (the Transformer sends it across, the Altar picks it). */
  onTap?: (slot: number) => void;
  /** Without clicks: the place drawn picked (the gold frame). */
  picked?: () => number | null;
  /** Without clicks: the stack's card, which a long press on a touch screen opens (with clicks, theirs). */
  card?: (slot: number) => void;
  /** The count's words, when not the stack's number (the Altar's "5 (120)"). */
  countText?: (slot: number, count: number) => Text;
  /** The pointer over a place, and off it (null): a window's status line. */
  hover?: (slot: number | null) => void;
  /**
   * Desktop's drag and drop between the places of `grids` (this one among them), its ghost drawn on `layer`; a drop
   * on another place moves there as the clicks would.
   */
  drag?: { layer: Container; grids: () => StackGrid[]; move: (from: StackRef, to: StackRef) => void };
}

export class StackGrid extends Container {
  private readonly look: StackGridLook;
  private readonly o: StackGridOptions;
  private gen = 0;
  /** The places drawn, for drops from another grid. */
  places: { c: Container; ref: StackRef }[] = [];

  constructor(look: StackGridLook, o: StackGridOptions) {
    super();
    block(this, "armySlots");
    this.look = look;
    this.o = o;
    this.label = "panel: army";
  }

  /** The place's top left. */
  cell(i: number): [number, number] {
    const l = this.look;
    if (l.at) return [l.at[i][0], l.at[i][1]];
    const { w, h } = StackGrid.cellSize(l);
    const n = i + (l.skip ?? 0);
    const cols = l.cols ?? 7;
    const gap = l.gap ?? 4;
    return [(n % cols) * (w + gap), Math.floor(n / cols) * (h + gap)];
  }

  /** One place's room: the portrait and, below it, its count. */
  static cellSize(l: StackGridLook) {
    const p = PORTRAIT[l.size];
    return { w: p.w, h: p.h + (l.count === "below" && l.numbers !== "none" ? (l.countFont === "medfont" ? 17 : l.countFont === "smalfont" ? 13 : 10) : 0) };
  }

  async set(army: readonly Stack[]) {
    const gen = ++this.gen;
    const { creatures, clicks, who = 0 } = this.o;
    const l = this.look;
    const p = PORTRAIT[l.size];
    const shown = Array.from({ length: 7 }, (_, i) => i).filter((i) => !l.packed || army[i]);
    const box = l.boxes ? await partTexture(l.boxes.pic, l.boxes.name, l.boxes.player) : null;
    const built = await Promise.all(
      shown.map(async (i, k) => {
        const a = army[i];
        const slot = new Container();
        slot.label = a ? `stack: ${creatures[a.creature]?.plural ?? a.creature}` : "stack: empty place";
        [slot.x, slot.y] = this.cell(k);
        if (box) slot.addChild(Object.assign(new Sprite(box), { x: Math.round((p.w - box.width) / 2), y: Math.round((p.h - box.height) / 2) }));
        slot.addChild(new Graphics().rect(0, 0, p.w, p.h).fill(l.frames && !box ? { color: 0x000000, alpha: l.band !== undefined ? 0.3 : 0.55 } : { color: 0, alpha: 0.001 }));
        if (l.frames && !box) slot.addChild(new Graphics().rect(0.5, 0.5, p.w - 1, p.h - 1).stroke({ color: 0x6b5a3a, width: 1 }));
        const ref = { who, slot: i };
        const drag = this.o.drag;
        const dragged =
          drag && a && clicks
            ? dragSource(slot, drag.layer, (gx, gy) => {
                const to = slotAt(drag.grids().flatMap((g) => g.places), gx, gy);
                clicks.selected = null;
                if (to && (to.who !== who || to.slot !== i)) drag.move(ref, to);
                this.o.changed?.();
              })
            : () => false;
        if (clicks) {
          slot.eventMode = "static";
          slot.cursor = "pointer";
          slot.on("pointertap", (e) => {
            // (Not what the panel around it opens on a tap.)
            e.stopPropagation();
            if (dragged()) return;
            if (clicks.click(ref, e)) this.o.changed?.();
          });
        } else if (this.o.onTap && a) {
          const tap = this.o.onTap;
          slot.eventMode = "static";
          slot.cursor = "pointer";
          slot.on("pointertap", (e) => (e.stopPropagation(), tap(i)));
        }
        if (this.o.hover) {
          const hover = this.o.hover;
          slot.eventMode = "static";
          slot.on("pointerover", () => hover(i));
          slot.on("pointerout", () => hover(null));
        }
        const card = clicks ? () => clicks.details(ref) : this.o.card ? () => this.o.card!(i) : undefined;
        const c = a ? creatures[a.creature] : undefined;
        // (Someone else's stack shows no exact number: no popup that would tell it.)
        if (a && c && (l.numbers ?? "exact") === "exact") creatureOnRightClick(slot, () => ({ c, info: this.o.info?.(i, a.count) ?? { count: a.count } }), card);
        if (!a) return slot;
        const tex = await creaturePortrait(c ?? { id: a.creature }, l.size);
        if (tex) slot.addChild(Object.assign(new Sprite(tex), { width: p.w, height: p.h }));
        if (clicks ? clicks.isSelected(ref) : this.o.picked?.() === i) slot.addChild(await armySelection(l.size));
        const numbers = l.numbers ?? "exact";
        if (numbers === "none") return slot;
        const text = numbers === "exact" ? (this.o.countText?.(i, a.count) ?? said(formatMetric(a.count))) : armyWord(a.count);
        const font = l.countFont ?? (l.size === "large" ? "smalfont" : "tiny");
        if (l.count === "below") {
          const n = label(text, font, WHITE, "center", p.w + 16);
          n.position.set(-8, p.h + 1);
          slot.addChild(n);
        } else if (l.count === "beside") {
          // Right of the portrait, in the middle of its height (a column of stacks: no room spent under each).
          const n = label(text, font, WHITE);
          n.position.set(p.w + 3, Math.round((p.h - n.height) / 2));
          slot.addChild(n);
        } else {
          const n = label(text, font, WHITE);
          n.position.set(p.w - 2 - n.width, p.h - n.height - 1);
          slot.addChild(n);
        }
        return slot;
      }),
    );
    const band = l.band !== undefined ? await heroBand(l.band, built, p) : null;
    if (gen !== this.gen || this.destroyed) return void [...built, ...(band ? [band] : [])].forEach((s) => s.destroy({ children: true }));
    this.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (band) this.addChild(band);
    // (Pixi's addChild with nothing to add throws: a town with an empty garrison shows no places.)
    if (built.length) this.addChild(...built);
    this.places = built.map((c, k) => ({ c, ref: { who: this.o.who ?? 0, slot: shown[k] } }));
  }
}

/** The hero screen's army band behind the places (windowParts' HEROSCR4 armyBand). */
async function heroBand(player: number, places: Container[], p: { w: number; h: number }): Promise<Container | null> {
  if (!places.length) return null;
  const right = Math.max(...places.map((c) => c.x + p.w));
  const bottom = Math.max(...places.map((c) => c.y + p.h));
  const m = 3;
  const band = await tiledPart(HEROSCR4, "armyBand", player, right + 2 * m, bottom + 2 * m);
  return band && Object.assign(band, { x: -m, y: -m, label: "hero army band" });
}
