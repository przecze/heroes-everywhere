/** Anything that carries a serializable RNG state. */
export interface HasRng {
  rng: number;
}

/** mulberry32: small, fast, and its whole state is one u32 we can store in game state. */
export function random(s: HasRng): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Inclusive integer range. */
export function randInt(s: HasRng, min: number, max: number): number {
  return min + Math.floor(random(s) * (max - min + 1));
}
