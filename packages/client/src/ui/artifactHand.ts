// Moving artifacts as the original does on the hero screen and in the exchange window (VCMI's
// CWindowWithArtifacts): a click picks an artifact up, and with a mouse it becomes the cursor (its
// place shows empty) while the slots that take it light up (ARTIFACT.DEF's frame 144); a click on
// one of them puts it down, and what was there is picked up in turn; a click in the backpack puts
// it there. The spellbook stays (in the hero screen a click opens it); the catapult stays (GENRLTXT 312).
import { type Hero, LOCKED, SLOT, slotsOf } from "@heroes/core";
import { artifactCursors, holdArtifactCursor } from "../cursors.ts";

/** A place: hero `who` (of the window's heroes), a worn slot or a backpack index. */
export interface HandPlace {
  who: number;
  slot?: number;
  backpack?: number;
}

export interface ArtifactHandOps {
  heroes: () => Hero[];
  artifacts: { name: string; slots?: number[] }[];
  move: (from: HandPlace, to: HandPlace) => void;
  /** A click on the spellbook (the hero screen opens it). */
  spellbook?: (who: number) => void;
  /** A click on the catapult (the original's "The Catapult must be equipped."). */
  catapult?: () => void;
  changed: () => void;
}

/** A mouse: the picked artifact is the cursor. A finger: it stays put, framed. */
export const cursorHand = () => typeof matchMedia === "function" && matchMedia("(any-pointer: fine)").matches && !matchMedia("(pointer: coarse)").matches;

export const samePlace = (a: HandPlace | null | undefined, b: HandPlace | null | undefined) =>
  !!a && !!b && a.who === b.who && a.slot === b.slot && a.backpack === b.backpack;

export class ArtifactHand {
  held: HandPlace | null = null;
  art = -1;
  readonly cursor = cursorHand();
  private readonly o: ArtifactHandOps;

  constructor(o: ArtifactHandOps) {
    this.o = o;
    if (this.cursor) void artifactCursors();
  }

  /** The artifact at a place now (-1: none, LOCKED: a combination's part). */
  at(p: HandPlace): number {
    const h = this.o.heroes()[p.who];
    if (!h) return -1;
    return p.slot !== undefined ? (h.equipped?.[p.slot] ?? -1) : (h.backpack?.[p.backpack ?? -1] ?? -1);
  }

  /** After the state changed: a hand whose artifact isn't where it was (a move refused, another window) is let go. */
  check() {
    if (this.held && this.at(this.held) !== this.art) this.drop();
  }

  private pick(p: HandPlace, art: number) {
    this.held = p;
    this.art = art;
    if (this.cursor) void holdArtifactCursor(art);
  }

  /** Lets go (the artifact stays where it is). */
  drop() {
    if (this.held && this.cursor) void holdArtifactCursor(null);
    this.held = null;
    this.art = -1;
  }

  /** The worn slot of hero `who` takes the artifact in hand (lit up). */
  takes(who: number, slot: number): boolean {
    if (!this.held || slot === SLOT.SPELLBOOK || slot === SLOT.MACH4) return false;
    const h = this.o.heroes()[who];
    return !!h && slotsOf(this.o.artifacts, this.art).includes(slot) && h.equipped?.[slot] !== LOCKED;
  }

  /** Drawn empty: the place the artifact in hand came from (with a mouse; it's on the cursor). */
  hides(p: HandPlace): boolean {
    return this.cursor && samePlace(this.held, p);
  }

  /** Framed: the artifact picked (on a touch screen, where it isn't on the cursor). */
  framed(p: HandPlace): boolean {
    return !this.cursor && samePlace(this.held, p);
  }

  /**
   * The backpack of hero `who` as shown: with a mouse, without the artifact in hand. Each entry
   * keeps its real index (to pick it up); its position in the list is where a drop puts one.
   */
  bag(who: number): { art: number; index: number }[] {
    const bag = (this.o.heroes()[who]?.backpack ?? []).map((art, index) => ({ art, index }));
    return this.cursor && this.held?.who === who && this.held.backpack !== undefined ? bag.filter((b) => b.index !== this.held!.backpack) : bag;
  }

  /**
   * A click on a place. For the backpack, `p.backpack` is the real index of what's shown there (or
   * none past the end) and `at` its position in the list as shown.
   */
  click(p: HandPlace, at?: number) {
    const heroes = this.o.heroes();
    if (!this.held) {
      const art = this.at(p);
      if (p.backpack === undefined && p.slot === undefined) return;
      if (art < 0) return;
      if (p.slot === SLOT.SPELLBOOK) return this.o.spellbook?.(p.who);
      if (p.slot === SLOT.MACH4) return this.o.catapult?.();
      this.pick(p, art);
      return this.o.changed();
    }
    const from = this.held;
    if (samePlace(from, p)) {
      this.drop();
      return this.o.changed();
    }
    if (p.slot === undefined) {
      // Into the backpack, at the place clicked.
      this.drop();
      this.o.move(from, { who: p.who, backpack: at ?? p.backpack });
      return this.o.changed();
    }
    if (!this.takes(p.who, p.slot)) return;
    const there = this.at(p);
    // What was there changes places with it: back where the picked one came from if it fits, else
    // to that hero's backpack's end (core moveArtifact); it's in hand then, as in the original.
    let next: HandPlace | null = null;
    if (there >= 0) {
      const src = heroes[from.who];
      const fits = from.slot !== undefined && slotsOf(this.o.artifacts, there).includes(from.slot);
      next = fits ? { who: from.who, slot: from.slot } : { who: from.who, backpack: (src?.backpack?.length ?? 0) - (from.backpack !== undefined ? 1 : 0) };
    }
    this.drop();
    this.o.move(from, p);
    if (next) this.pick(next, there);
    this.o.changed();
  }
}
