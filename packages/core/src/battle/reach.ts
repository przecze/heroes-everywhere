// Where stacks stand and may go on the battlefield: their hexes (wide ones two), what may stand
// where, the hexes a stack reaches this turn and the way there, who stands next to whom.
import { gatePasses, inMoat, moatHolds } from "./siege.ts";
import { hasAbility } from "../creatures.ts";
import { HEX_COUNT, hexCol, hexDistance, hexRow, isPlayable, neighbours } from "./hex.ts";
import { type BattleState, type Side, type Unit } from "./state.ts";
import { alive, bound, controlSide, speedOf, stats } from "./rules.ts";

/** Hazards at a hex. */
export const hazardsAt = (s: BattleState, hex: number) => (s.hazards ?? []).filter((z) => z.hexes.includes(hex));
export const isWide = (s: BattleState, u: Unit) => hasAbility(stats(s, u), "DOUBLE_WIDE");
export const canFly = (s: BattleState, u: Unit) => hasAbility(stats(s, u), "FLYING");

/** The second hex of a wide unit standing with its head on `head`: behind it, facing the enemy. */
export function tailOf(side: Side, head: number): number {
  return side === 0 ? head - 1 : head + 1;
}

export function unitHexes(s: BattleState, u: Unit, head = u.pos): number[] {
  return isWide(s, u) ? [head, tailOf(u.side, head)] : [head];
}

export function unitAt(s: BattleState, hex: number): Unit | undefined {
  return s.units.find((u) => alive(u) && unitHexes(s, u).includes(hex));
}

export function activeUnit(s: BattleState): Unit | undefined {
  return s.active === null ? undefined : s.units[s.active];
}

/** Are these hexes free for `u` (ignoring itself), on the field and in one row? */
export function canOccupy(s: BattleState, u: Unit, hexes: number[]): boolean {
  const row = hexRow(hexes[0]);
  return hexes.every((h) => {
    if (h < 0 || h >= HEX_COUNT) return false;
    if (!isPlayable(hexCol(h), hexRow(h))) return false;
    if (s.blocked.includes(h)) return false;
    if (!gatePasses(s, u.side, h)) return false;
    if (hazardsAt(s, h).some((z) => z.kind === "forceField")) return false;
    // A tail that wrapped onto another row is not adjacent.
    if (hexRow(h) !== row) return false;
    const other = unitAt(s, h);
    return !other || other.id === u.id;
  });
}

/** Can `u` stand with its head on `head`, ignoring itself? */
export function canStand(s: BattleState, u: Unit, head: number): boolean {
  return canOccupy(s, u, unitHexes(s, u, head));
}

/**
 * Does the unit fly back to `start` after striking from `from`? Harpies do, when the hex is still
 * theirs to stand on (HotA's alternate action, "stay", keeps them where they struck from).
 */
export function fliesBack(s: BattleState, u: Unit, from: number, start = u.pos): boolean {
  return from !== start && hasAbility(stats(s, u), "RETURN_AFTER_STRIKE") && canStand(s, u, start);
}

/**
 * Head hexes reachable this turn, with the step count and the previous hex
 * for path reconstruction. Flyers ignore what's in between.
 *
 * Wide units can turn around for free, so they're searched as (front hex,
 * facing) pairs; positions are reported in the unit's normal facing (the
 * same two hexes), which is how the state stores them.
 */
export function reachable(s: BattleState, u: Unit, steps?: number): Map<number, { dist: number; prev: number }> {
  // (`steps`: as far as that, whatever the stack's speed: the tactics phase's walk to its new place.)
  const speed = u.machine || bound(s, u) ? 0 : (steps ?? speedOf(s, u));
  const out = new Map<number, { dist: number; prev: number }>();
  out.set(u.pos, { dist: 0, prev: -1 });
  if (!speed) return out;
  if (canFly(s, u)) {
    for (let h = 0; h < HEX_COUNT; h++) {
      const d = hexDistance(u.pos, h);
      if (d > 0 && d <= speed && canStand(s, u, h)) out.set(h, { dist: d, prev: u.pos });
    }
    return out;
  }
  if (isWide(s, u)) return reachableWide(s, u, speed, out);
  let frontier = [u.pos];
  for (let d = 1; d <= speed && frontier.length; d++) {
    const next: number[] = [];
    for (const h of frontier) {
      for (const n of neighbours(h)) {
        if (out.has(n) || !canStand(s, u, n)) continue;
        out.set(n, { dist: d, prev: h });
        // Anyone wading into the moat stops there (defenders too, heroes.thelazy.net Moat), as does anyone in the enemy's quicksand.
        const sand = hazardsAt(s, n).some((z) => z.kind === "quicksand" && (z.neutral || z.side !== u.side));
        if ((!inMoat(s, n) || !moatHolds(s, u)) && !sand) next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

function reachableWide(s: BattleState, u: Unit, speed: number, out: Map<number, { dist: number; prev: number }>) {
  // facing 0 = tail on the left, 1 = tail on the right.
  const tail = (h: number, f: number) => (f === 0 ? h - 1 : h + 1);
  // Normal-facing head for the pair of hexes a node covers.
  const key = (h: number, f: number) => (u.side === 0 ? Math.max(h, tail(h, f)) : Math.min(h, tail(h, f)));
  const node = (h: number, f: number) => h * 2 + f;
  const dist = new Map<number, number>();
  const startF = u.side === 0 ? 0 : 1;
  // 0-1 BFS: turning around is free, a step costs one.
  const deque: [number, number][] = [[u.pos, startF]];
  dist.set(node(u.pos, startF), 0);
  while (deque.length) {
    const [h, f] = deque.shift()!;
    const d = dist.get(node(h, f))!;
    if (d > 0 && (inMoat(s, h) || inMoat(s, tail(h, f)))) continue;
    if (d > 0 && [h, tail(h, f)].some((x) => hazardsAt(s, x).some((z) => z.kind === "quicksand" && (z.neutral || z.side !== u.side)))) continue;
    const here = key(h, f);
    const moves: [number, number, number][] = [[tail(h, f), 1 - f, 0], ...neighbours(h).map((n): [number, number, number] => [n, f, 1])];
    for (const [nh, nf, cost] of moves) {
      const nd = d + cost;
      if (nd > speed || (dist.get(node(nh, nf)) ?? Infinity) <= nd) continue;
      if (!canOccupy(s, u, [nh, tail(nh, nf)])) continue;
      dist.set(node(nh, nf), nd);
      const k = key(nh, nf);
      if (!out.has(k) || out.get(k)!.dist > nd) out.set(k, { dist: nd, prev: k === here ? out.get(here)?.prev ?? -1 : here });
      if (cost === 0) deque.unshift([nh, nf]);
      else deque.push([nh, nf]);
    }
  }
  return out;
}

export function pathTo(reach: Map<number, { dist: number; prev: number }>, to: number): number[] {
  const path: number[] = [];
  for (let h = to; h !== -1; h = reach.get(h)!.prev) path.unshift(h);
  return path;
}

export function areAdjacent(s: BattleState, a: Unit, aHead: number, b: Unit): boolean {
  const bh = unitHexes(s, b);
  return unitHexes(s, a, aHead).some((h) => bh.some((x) => hexDistance(h, x) === 1));
}

export function enemyAdjacent(s: BattleState, u: Unit): boolean {
  return s.units.some((e) => alive(e) && controlSide(e) !== controlSide(u) && !e.machine && areAdjacent(s, u, u.pos, e));
}

