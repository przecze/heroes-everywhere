// Where a pop-up goes (2026-10-27: "never show a pop-up in a location where it won't be on the screen fully"): one
// rule for every pop-up, the map HUD's (the treasury, the big minimap, the more grid), the held ones (a monster, a hero,
// a town, a creature, a button's help) and the battle's. Pure geometry here (tested in client/test/popupBox.test.ts);
// ui/blocks/popupPlace.ts measures the screen and the page's own buttons and places a Pixi container with it.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "above" | "below" | "left" | "right";

export interface PlaceOptions {
  /** What it comes from (the widget, the thing tapped): it goes beside it, on the first of `sides` where it fits whole. */
  from?: Box;
  /** Or a point it is centred on (the pointer, the finger). */
  at?: { x: number; y: number };
  /** Boxes it must keep clear of when there is any way to (the page's ☰ and Feedback). */
  avoid?: Box[];
  /** The order of the sides tried beside `from` (above first: the HUD's pieces sit low). */
  sides?: Side[];
  /** The space between it and `from`. */
  gap?: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The top left of a `w` x `h` pop-up wholly inside `room`, and `k` (at most 1) when even whole it is bigger than the room
 * (the size to shrink it by). Beside `from` on the first side where it fits, else centred on `at` (or the room's
 * middle), always pulled inside the room; then moved off any `avoid` box it lands on, to the nearest place that is clear
 * (and clear of `from`), when there is one.
 */
export function placeBox(w: number, h: number, room: Box, o: PlaceOptions = {}): { x: number; y: number; k: number } {
  const k = Math.min(1, room.w / w, room.h / h);
  const [W, H] = [w * k, h * k];
  const gap = o.gap ?? 6;
  const clamp = (x: number, y: number) => ({
    x: Math.max(room.x, Math.min(room.x + room.w - W, x)),
    y: Math.max(room.y, Math.min(room.y + room.h - H, y)),
  });
  const avoid = o.avoid ?? [];
  const clear = (p: { x: number; y: number }) => {
    const b = { x: p.x, y: p.y, w: W, h: H };
    return !avoid.some((a) => overlaps(a, b)) && !(o.from && overlaps(o.from, b));
  };
  let p: { x: number; y: number } | null = null;
  const f = o.from;
  if (f) {
    const cx = f.x + f.w / 2 - W / 2;
    const cy = f.y + f.h / 2 - H / 2;
    const beside: Record<Side, { x: number; y: number; fits: boolean }> = {
      above: { x: cx, y: f.y - gap - H, fits: f.y - gap - H >= room.y },
      below: { x: cx, y: f.y + f.h + gap, fits: f.y + f.h + gap + H <= room.y + room.h },
      left: { x: f.x - gap - W, y: cy, fits: f.x - gap - W >= room.x },
      right: { x: f.x + f.w + gap, y: cy, fits: f.x + f.w + gap + W <= room.x + room.w },
    };
    const sides = o.sides ?? ["above", "below", "left", "right"];
    const fitting = sides.map((s) => beside[s]).filter((s) => s.fits).map((s) => clamp(s.x, s.y));
    p = fitting.find(clear) ?? fitting[0] ?? null;
  }
  p ??= o.at ? clamp(o.at.x - W / 2, o.at.y - H / 2) : clamp(room.x + (room.w - W) / 2, room.y + (room.h - H) / 2);
  if (!clear(p)) {
    // Off the box it lies on: under it, over it, beside it, whichever is nearest and clear.
    const tries: { x: number; y: number }[] = [];
    for (const a of avoid.filter((a) => overlaps(a, { x: p!.x, y: p!.y, w: W, h: H })))
      tries.push(clamp(p.x, a.y + a.h + gap), clamp(p.x, a.y - gap - H), clamp(a.x + a.w + gap, p.y), clamp(a.x - gap - W, p.y));
    const d = (q: { x: number; y: number }) => Math.hypot(q.x - p!.x, q.y - p!.y);
    let best = tries.filter(clear).sort((a, b) => d(a) - d(b))[0];
    // (Nothing clear right beside them, several lying together: the nearest clear place anywhere on the room.)
    if (!best) {
      const step = Math.max(8, Math.round(Math.min(W, H) / 4));
      for (let y = room.y; y <= room.y + room.h - H; y += step)
        for (let x = room.x; x <= room.x + room.w - W; x += step) {
          const q = { x, y };
          if (clear(q) && (!best || d(q) < d(best))) best = q;
        }
    }
    if (best) p = best;
  }
  return { x: Math.round(p.x), y: Math.round(p.y), k };
}
