// The touch HUD as the player left it: where each widget was dragged, which are folded to their handles, the panels'
// shapes (kept per layout and hand: `key`), and the hero widget's army one row or two (one for every layout).
// Each is a localStorage entry; a private window, or an entry that doesn't parse, keeps nothing.

/** The floating pieces, each its own widget (2026-10-27: "split into separate floating widgets"). */
export type MoveKey = "list" | "chip" | "buttons" | "bar" | "zoom" | "mini";
/** The shapes the player gave the panels: the list one or two columns (heroes | towns) and at most `listRows` high, the button block across or up the side. */
export type HudShape = { listCols?: 1 | 2; listRows?: number; buttons?: "row" | "block" };
/** A widget's offset from where the layout puts it (HUD pixels; mirrored by the one-handed flip). */
export type Move = { x: number; y: number };
export type Moves = Partial<Record<MoveKey, Move>>;

/** Where the moved widgets are kept: a new key since they became separate widgets (2026-10-27; the old moves were the block's). */
export const MOVES_KEY = "heroes.hudMoves2";
const SHAPE_KEY = "heroes.hudShape";
const FOLDED_KEY = "heroes.hudFolded";
const ARMY_KEY = "heroes.heroWidget";
/**
 * The hero widget's four shapes, in the order its corner button goes round (2026-11-02 17:58): one row (the
 * portrait and seven stacks), two rows (the portrait and three over four), two columns (the portrait and the first
 * stack, then two to a row), one column (the portrait over the seven).
 */
export const ARMY_SHAPES = ["row", "rows", "pairs", "column"] as const;
export type ArmyShape = (typeof ARMY_SHAPES)[number];

/** One entry: a table of layouts, each its own record. */
function table<T>(name: string): Record<string, T> {
  try {
    return JSON.parse(localStorage.getItem(name) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
function keep(name: string, all: Record<string, unknown>) {
  try {
    localStorage.setItem(name, JSON.stringify(all));
  } catch {
    // not kept
  }
}

export class HudStore {
  /** `key`: the layout the moves are kept for (upright or sideways, and the hand). */
  private readonly key: () => string;
  constructor(key: () => string) {
    this.key = key;
  }

  /** The panels' shapes (the list's columns and rows, the button block's way). */
  shape(): HudShape {
    return table<HudShape>(SHAPE_KEY)[this.key()] ?? {};
  }
  /** Changes some of the shape; null forgets it (back to the layout's own). */
  setShape(change: Partial<HudShape> | null) {
    const all = table<HudShape>(SHAPE_KEY);
    const k = this.key();
    if (change) all[k] = { ...(all[k] ?? {}), ...change };
    else delete all[k];
    keep(SHAPE_KEY, all);
  }

  /** Each widget's move in this layout. */
  moves(): Moves {
    return table<Moves>(MOVES_KEY)[this.key()] ?? {};
  }
  /** This layout's moves, all at once; null forgets them. */
  saveMoves(m: Moves | null) {
    const all = table<Moves>(MOVES_KEY);
    if (m) all[this.key()] = m;
    else delete all[this.key()];
    keep(MOVES_KEY, all);
  }

  /** The widgets folded away to their handles in this layout. */
  folded(): Partial<Record<MoveKey, boolean>> {
    return table<Partial<Record<MoveKey, boolean>>>(FOLDED_KEY)[this.key()] ?? {};
  }
  setFolded(k: MoveKey, on: boolean) {
    const all = table<Partial<Record<MoveKey, boolean>>>(FOLDED_KEY);
    all[this.key()] = { ...(all[this.key()] ?? {}), [k]: on || undefined };
    keep(FOLDED_KEY, all);
  }

  /** The hero widget's shape (`otherwise`: before the player picked); the old two-way switch's "folded" is two rows. */
  armyShape(otherwise: ArmyShape): ArmyShape {
    try {
      const v = localStorage.getItem(ARMY_KEY);
      return v === "folded" ? "rows" : v && (ARMY_SHAPES as readonly string[]).includes(v) ? (v as ArmyShape) : otherwise;
    } catch {
      return otherwise;
    }
  }
  setArmyShape(shape: ArmyShape) {
    try {
      localStorage.setItem(ARMY_KEY, shape);
    } catch {
      /* (private window) */
    }
  }
}
