// HotA's quick stack actions, the same in every army window: one more equal stack a press (two, then three...), split evenly
// across the free slots, one creature into each free slot, and every stack of its kind gathered into it.
// Planned here (no drawing: quickStack.ts has the buttons) as plain moves inside one army, so each window sends them with its own move action.

export type QuickKind = "half" | "spread" | "ones" | "gather";
export const QUICK_KINDS: QuickKind[] = ["half", "spread", "ones", "gather"];
/** With a stack picked: 1 half, 2 even across the free slots, 3 one each, 4 gather (docs/handoff.md). */
export const QUICK_KEYS: Record<string, QuickKind> = { "1": "half", "2": "spread", "3": "ones", "4": "gather" };
export const QUICK_NAMES: Record<QuickKind, string> = { half: "Split into one more equal stack", spread: "Split evenly into the free slots", ones: "One creature into each free slot", gather: "Gather the same creatures" };

type Stack = { creature: number; count: number } | null | undefined;
export interface QuickMove {
  from: number;
  to: number;
  /** Undefined: the whole stack. */
  count?: number;
}

/** What `kind` does to the stack in `slot` of a 7-slot army: moves within it (none when it makes no sense: no free slot, one creature, no other stack of the kind). */
export function quickPlan(army: Stack[], slot: number, kind: QuickKind): QuickMove[] {
  const st = army[slot];
  if (!st) return [];
  const free: number[] = [];
  for (let i = 0; i < 7; i++) if (!army[i]) free.push(i);
  if (kind === "gather") {
    const moves: QuickMove[] = [];
    for (let i = 0; i < 7; i++) if (i !== slot && army[i]?.creature === st.creature) moves.push({ from: i, to: slot });
    return moves;
  }
  if (kind === "half") {
    // One more equal stack each press, as HotA's (2026-11-03): the stacks of this creature and a free slot share
    // all of them evenly (the picked one first to the bigger share): one stack splits in two, two in three, and so on.
    const same = [slot, ...[0, 1, 2, 3, 4, 5, 6].filter((i) => i !== slot && army[i]?.creature === st.creature)];
    const total = same.reduce((n, i) => n + (army[i]?.count ?? 0), 0);
    const n = same.length + 1;
    if (!free.length || total < n) return [];
    const targets = [...same, free[0]];
    const share = (k: number) => Math.floor(total / n) + (k < total % n ? 1 : 0);
    return [...same.slice(1).map((from) => ({ from, to: slot })), ...targets.slice(1).map((to, k) => ({ from: slot, to, count: share(k + 1) }))];
  }
  const places = Math.min(free.length, st.count - 1);
  if (places < 1) return [];
  if (kind === "ones") return free.slice(0, places).map((to) => ({ from: slot, to, count: 1 }));
  // Evenly: no two stacks more than one apart, the bigger shares first, the picked stack among them (the owner
  // 2026-11-02 12:03: 14 Dwarves over five slots are 3 3 3 3 2, not 6 2 2 2 2).
  const n = places + 1;
  const base = Math.floor(st.count / n);
  const rem = st.count % n;
  return free.slice(0, places).map((to, k) => ({ from: slot, to, count: base + (k + 1 < rem ? 1 : 0) }));
}

/** What a window needs to offer the actions for one stack. */
export interface QuickOps {
  can: (kind: QuickKind) => boolean;
  run: (kind: QuickKind) => void;
  /** Upgrade every stack the place can upgrade at once (a town): a fifth button, greyed when none can be paid. */
  upgradeAll?: { can: () => boolean; run: () => void };
}

