// The Advanced Options' handicap (heroes.thelazy.net "Handicap"): Mild takes 15% off a player's starting
// resources and daily income, Severe 30%, each amount rounded down (so a small income loses more).
// Not touched: weekly sites (Water Wheel, Windmill), pickups, banks, trade, the Treasury.

/** What's left of `n` under handicap level `level` (0 none, 1 Mild, 2 Severe). */
export function handicapped(level: number | undefined, n: number): number {
  return level ? Math.floor((n * (100 - 15 * Math.min(2, level))) / 100) : n;
}
