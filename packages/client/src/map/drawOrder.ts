// The adventure map's draw order for standing objects (map/view.ts reorder()).
//
// VCMI's rule, found by experimenting with H3 maps: when one object's blocked tiles stand right above
// the other's (A's tile + 1 row is B's), the one more often below is drawn on top; only then the row,
// then the map's order. Used as a sort comparator that isn't an order: a tree a row lower than the
// Mystic Garden but above a pine that stands over the garden made a ring, and the sort put the tree
// over the gardener's head (2026-10-31 19:47). So the "above" pairs are kept as they
// are and the rest goes by row then map order: each next object is the first by row of those with
// nothing still to be drawn under them; a ring of "above" pairs is broken at its first by row.

/** One standing object: its row, its place in the map's order, its blocked tiles (y * 1024 + x). */
export interface Standing {
  y: number;
  tie: number;
  blocked: Set<number>;
}

/** The objects' indices, first drawn first. */
export function drawOrder(items: readonly Standing[]): number[] {
  // Who blocks each tile, and for each object how many of its tiles stand right above each other's.
  const at = new Map<number, number[]>();
  items.forEach((it, i) => {
    for (const t of it.blocked) (at.get(t) ?? at.set(t, []).get(t)!).push(i);
  });
  const over = items.map(() => new Map<number, number>());
  items.forEach((it, i) => {
    for (const t of it.blocked) for (const j of at.get(t + 1024) ?? []) if (j !== i) over[i].set(j, (over[i].get(j) ?? 0) + 1);
  });
  // i before j when more of i's tiles stand right above j's than the other way round.
  const after = items.map(() => [] as number[]);
  const waiting = items.map(() => 0);
  over.forEach((m, i) =>
    m.forEach((n, j) => {
      if (n > (over[j].get(i) ?? 0)) after[i].push(j), waiting[j]++;
    }),
  );
  const key = (i: number) => items[i].y * 10_000_000 + items[i].tie;
  const ready = new KeyHeap();
  items.forEach((_, i) => waiting[i] || ready.push(key(i), i));
  const order: number[] = [];
  const done = items.map(() => false);
  while (order.length < items.length) {
    let i = -1;
    while (ready.size && i < 0) {
      const j = ready.pop();
      if (!done[j]) i = j;
    }
    // (A ring of "above" pairs: the first by row of what's left breaks it.)
    if (i < 0) for (let j = 0; j < items.length; j++) if (!done[j] && (i < 0 || key(j) < key(i))) i = j;
    done[i] = true;
    order.push(i);
    for (const j of after[i]) if (--waiting[j] === 0 && !done[j]) ready.push(key(j), j);
  }
  return order;
}

/** A binary min-heap of (key, index) pairs, for the draw order. */
class KeyHeap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }
  pop(): number {
    const { keys, vals } = this;
    const top = vals[0];
    const key = keys.pop()!;
    const val = vals.pop()!;
    if (keys.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= keys.length) break;
        if (c + 1 < keys.length && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}
