// The fresh AI's danger map: for every tile, the strongest rival army that can stand on it (or attack it from next to
// it) tomorrow and within two days, from what the player knows (aiView.ts: rivals where they were last seen, armies as
// bands). Every decision about safety reads this one map: a hero doesn't end its day where a stronger rival reaches
// it, a town that wouldn't hold calls the main hero home, the main hero stays to hold a town in danger.
import { findPaths } from "../movement.ts";
import { allied } from "../rules.ts";
import type { AdventureState, AdvObject, Hero } from "../types.ts";
import { type World, visitTile } from "../world.ts";
import { power } from "../aiThreat.ts";
import { B } from "../town.ts";

export interface Danger {
  /** By tile: the strongest rival power that can get there by tomorrow, and within two days. */
  one: Map<number, number>;
  two: Map<number, number>;
  /** Who: by tile, the rival hero of `one`. */
  by: Map<number, Hero>;
  rivals: Hero[];
}

const cache = new WeakMap<AdventureState, { key: string; d: Danger }>();

/** The rivals in the field this player knows of (garrison heroes too: they ride out). */
export const rivalsOf = (s: AdventureState, player: number) => s.heroes.filter((e) => !e.removed && e.owner >= 0 && e.owner !== player && !allied(s, e.owner, player));

export function dangerOf(s: AdventureState, w: World, player: number): Danger {
  const rivals = rivalsOf(s, player);
  const key = `${s.day}:${rivals.map((e) => `${e.id}@${e.x},${e.y},${e.z}:${Math.round(power(w, e))}`).join(";")}`;
  const known = cache.get(s);
  if (known?.key === key) return known.d;
  const d: Danger = { one: new Map(), two: new Map(), by: new Map(), rivals };
  // (Our heroes off the map while it walks: they'd be gone by then, and stood in its way only on paper.)
  const cleared: [number, number][] = [];
  for (const x of s.heroes) {
    const i = x.removed || x.owner !== player ? -1 : w.index(x.x, x.y, x.z);
    if (i >= 0 && w.heroAt[i]) cleared.push([i, w.heroAt[i]]), (w.heroAt[i] = 0);
  }
  try {
    for (const e of rivals) {
      const p = power(w, e);
      const day = Math.max(1, e.maxMovement);
      const paths = findPaths(w, s, { ...e, movement: day }, false, undefined, false, (_i, cost) => cost > 2 * day);
      for (const [i, node] of paths) {
        if (node.cost > 2 * day) continue;
        // (A tile next to the one it reaches is attacked from there.)
        const x = i % w.size;
        const y = Math.floor(i / w.size) % w.size;
        const z = Math.floor(i / (w.size * w.size));
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const j = w.index(x + dx, y + dy, z);
            if (j < 0) continue;
            if ((d.two.get(j) ?? 0) < p) d.two.set(j, p);
            if (node.cost <= day && (d.one.get(j) ?? 0) < p) (d.one.set(j, p), d.by.set(j, e));
          }
      }
    }
  } finally {
    for (const [i, v] of cleared) w.heroAt[i] = v;
  }
  cache.set(s, { key, d });
  return d;
}

/** What a town of ours holds out with: its garrison (and a hero in it or at its gate), behind its walls. */
export function townHolds(s: AdventureState, w: World, o: AdvObject): number {
  const gate = visitTile(w, o);
  let v = o.town!.garrison.reduce((a, x) => a + (x ? x.count * (w.creatures[x.creature]?.aiValue ?? 0) : 0), 0);
  for (const h of s.heroes) if (!h.removed && h.owner === o.owner && (h.garrison === o.id || w.index(h.x, h.y, h.z) === gate)) v += power(w, h);
  const walls = o.town!.built.includes(B.CASTLE) ? 1.6 : o.town!.built.includes(B.CITADEL) ? 1.45 : o.town!.built.includes(B.FORT) ? 1.3 : 1;
  return v * walls;
}
