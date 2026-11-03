// Clicking around armies, the same in every window that shows them (hero screen, exchange, town
// garrison, the adventure info bar): click a stack, then another place to move, swap or merge it;
// the picked stack again opens its window; Shift splits with the original split window. HotA's quick
// shortcuts (VCMI's CGarrisonSlot::handleSplittingShortcuts) on a stack: Ctrl-click one creature off into
// a free slot, Shift-click evenly across the free slots, Ctrl+Shift one in each free slot, Alt-click gathers
// its kind, Alt+Ctrl sends the whole stack to the other army.

import { QUICK_KEYS, type QuickKind, type QuickOps, quickPlan } from "./quickPlan.ts";

/** A place in one of the armies on screen (`who` indexes them). */
export interface StackRef {
  who: number;
  slot: number;
}

type Stack = { creature: number; count: number } | null | undefined;

export interface ArmyClickOps {
  /** The armies on screen, as they are now. */
  armies: () => Stack[][];
  move: (from: StackRef, to: StackRef, count?: number) => void;
  /**
   * The split window between `left` (the picked stack) and `right` (the clicked place); answers the new right-hand
   * count (null: cancelled). `quick`: HotA's quick actions shown in it (the Split button's window).
   */
  split?: (creature: number, left: number, right: number, minLeft: number, quick?: QuickOps) => Promise<number | null>;
  /** The picked stack clicked again: its window. */
  details?: (ref: StackRef) => void;
  /** HotA's Upgrade all (a town): offered with the quick actions in the Split button's window. */
  upgradeAll?: () => { can: () => boolean; run: () => void };
  /** A hero's army can't be left empty: its last stack keeps one creature when sent away. */
  keepsOne?: (who: number) => boolean;
}

export interface ClickKeys {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export class ArmyClicks {
  selected: StackRef | null = null;
  private readonly ops: ArmyClickOps;

  constructor(ops: ArmyClickOps) {
    this.ops = ops;
  }

  /** The picked stack's window (what a tap on it again opens). */
  details(ref: StackRef) {
    this.ops.details?.(ref);
  }

  /** HotA's quick stack actions on a stack (ui/quickStack.ts): the moves they make inside its army. */
  quickOps(ref: StackRef): QuickOps {
    const plan = (kind: QuickKind) => quickPlan(this.ops.armies()[ref.who] ?? [], ref.slot, kind);
    return {
      upgradeAll: this.ops.upgradeAll?.(),
      can: (kind) => plan(kind).length > 0,
      run: (kind) => {
        this.selected = null;
        for (const m of plan(kind)) this.ops.move({ who: ref.who, slot: m.from }, { who: ref.who, slot: m.to }, m.count);
      },
    };
  }

  /**
   * The Split button, the same in every army (2026-10-25): the picked stack's split window with HotA's quick
   * actions in it; the part split off goes to the army's first free place. False: no stack picked (or no split here).
   */
  async splitSelected(): Promise<boolean> {
    const ref = this.selected;
    const st = ref && this.stack(ref);
    if (!ref || !st || !this.ops.split) return false;
    const to = (this.ops.armies()[ref.who] ?? []).findIndex((a) => !a);
    const n = await this.ops.split(st.creature, st.count, 0, to < 0 ? st.count : 1, this.quickOps(ref));
    this.selected = null;
    if (n && to >= 0 && n < st.count) this.ops.move(ref, { who: ref.who, slot: to }, n);
    return true;
  }

  /** The hotkeys (1 to 4) on the picked stack; true when one was used. */
  quickKey(key: string): boolean {
    const kind = QUICK_KEYS[key];
    const ref = this.selected;
    if (!kind || !ref) return false;
    const q = this.quickOps(ref);
    if (q.can(kind)) q.run(kind);
    return true;
  }

  isSelected(ref: StackRef) {
    return !!this.selected && this.selected.who === ref.who && this.selected.slot === ref.slot;
  }

  private stack(ref: StackRef): Stack {
    return this.ops.armies()[ref.who]?.[ref.slot];
  }

  /** How many may leave a stack: all, or all but one when it's the last of an army that must keep one. */
  private movable(ref: StackRef): number {
    const st = this.stack(ref);
    if (!st) return 0;
    const last = this.ops.armies()[ref.who].filter((a) => a).length === 1;
    return last && this.ops.keepsOne?.(ref.who) ? st.count - 1 : st.count;
  }

  /** The place a stack of `creature` goes in army `who`: its kind's stack, else the first free slot. */
  private placeFor(who: number, creature: number): StackRef | null {
    const army = this.ops.armies()[who] ?? [];
    const same = army.findIndex((a) => a?.creature === creature);
    const slot = same >= 0 ? same : army.findIndex((a) => !a);
    return slot >= 0 ? { who, slot } : null;
  }

  /** A click on a place; returns true when something changed (redraw). */
  click(ref: StackRef, keys: ClickKeys = {}): boolean {
    const st = this.stack(ref);
    const ctrl = keys.ctrlKey || keys.metaKey;
    const quick = ctrl || keys.altKey || keys.shiftKey;
    if (quick && st && !this.selected) {
      // HotA's (and VCMI's) shortcuts on a stack: Ctrl one creature off, Shift evenly across the free slots,
      // Ctrl+Shift one in each free slot, Alt gathers its kind, Alt+Ctrl the whole stack to the other army.
      if (keys.altKey && ctrl) {
        if (this.ops.armies().length > 1) {
          const to = this.placeFor(ref.who === 0 ? 1 : 0, st.creature);
          const n = this.movable(ref);
          if (to && n > 0) this.ops.move(ref, to, n === st.count ? undefined : n);
        }
      } else if (keys.altKey) {
        if (!keys.shiftKey) this.quickOps(ref).run("gather");
      } else if (keys.shiftKey) this.quickOps(ref).run(ctrl ? "ones" : "spread");
      else {
        const free = this.ops.armies()[ref.who].findIndex((a) => !a);
        if (free >= 0 && st.count > 1) this.ops.move(ref, { who: ref.who, slot: free }, 1);
      }
      return true;
    }
    const from = this.selected;
    if (!from) {
      if (!st) return false;
      this.selected = ref;
      return true;
    }
    this.selected = null;
    if (from.who === ref.who && from.slot === ref.slot) {
      this.ops.details?.(from);
      return true;
    }
    const src = this.stack(from);
    if (!src) return true;
    // A hero's last stack onto the same kind in another army: the split window, not a silent all-but-one
    // (VCMI's CGarrisonSlot::clickPressed, "merge last stack to other hero stack").
    const lastMerge = !!st && st.creature === src.creature && from.who !== ref.who && this.movable(from) < src.count;
    if ((keys.shiftKey || lastMerge) && this.ops.split && (!st || st.creature === src.creature)) {
      const before = st?.count ?? 0;
      const minLeft = from.who !== ref.who ? src.count - this.movable(from) : 0;
      void this.ops.split(src.creature, src.count, before, minLeft).then((after) => {
        if (after === null || after === before) return;
        if (after > before) this.ops.move(from, ref, after - before);
        else this.ops.move(ref, from, before - after);
      });
      return true;
    }
    // A hero's last stack: across to another army with one creature left behind (a swap is fine).
    if (from.who !== ref.who && (!st || st.creature === src.creature)) {
      const n = this.movable(from);
      if (n > 0) this.ops.move(from, ref, n === src.count ? undefined : n);
      return true;
    }
    this.ops.move(from, ref);
    return true;
  }
}
