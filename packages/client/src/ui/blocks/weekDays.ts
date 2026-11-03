// The week's seven days as a row of squares, today's lit with its number, the days gone in dim gold, the days to come
// dark (2026-10-30: "the day counter next to the turn button, bigger; also on the new day's card and somewhere in
// town"). One block for the map's buttons, the new day's card and the town, so the day reads the same everywhere.
import { dateParts } from "@heroes/core";
import { Container, Graphics, Rectangle } from "pixi.js";
import { GameText, WHITE } from "../../text.ts";
import { tr, said } from "../../i18n/index.ts";

const GOLD = 0xc9a046;
const TODAY = 0xffe78c;
const GONE = 0xb89a3e;

/** The week's days in `w` x `h` (its own pixels), for game day `day` (1 = the first). Labelled for the catalog and notes. */
export function weekDays(day: number, w: number, h: number): Container {
  const [month, week, d] = dateParts(day);
  const c = new Container();
  c.label = `week days: ${tr("Month %1, Week %2, Day %3", month, week, d)}`;
  const pad = Math.max(3, Math.round(h * 0.14));
  const gap = Math.max(2, Math.round(w / 70));
  const side = Math.min(h - 2 * pad, (w - 2 * pad - 6 * gap) / 7);
  const x0 = Math.round((w - 7 * side - 6 * gap) / 2);
  const y0 = Math.round((h - side) / 2);
  const g = new Graphics();
  g.roundRect(0, 0, w, h, 4).fill({ color: 0x1a0f06, alpha: 0.9 }).stroke({ color: 0x000000, width: 3, alpha: 0.6 }).roundRect(0, 0, w, h, 4).stroke({ color: GOLD, width: 2 });
  for (let i = 0; i < 7; i++) {
    const x = x0 + i * (side + gap);
    const today = i === d - 1;
    if (today) g.rect(x, y0, side, side).fill(TODAY).stroke({ color: 0xffffff, width: 1, alpha: 0.7 });
    else if (i < d - 1) g.rect(x, y0, side, side).fill({ color: GONE, alpha: 0.85 });
    else g.rect(x, y0, side, side).fill({ color: 0x000000, alpha: 0.55 }).stroke({ color: GOLD, width: 1, alpha: 0.45 });
  }
  c.addChild(g);
  // Today's number in its square (dark on the lit gold), when the square holds a readable figure.
  if (side >= 14) {
    const n = new GameText("medfont", [40, 22, 4]);
    n.value = said(String(d));
    n.scale.set(Math.min(1.6, (side * 0.85) / Math.max(1, n.height)));
    n.position.set(Math.round(x0 + (d - 1) * (side + gap) + (side - n.width) / 2), Math.round(y0 + (side - n.height) / 2));
    c.addChild(n);
  }
  c.hitArea = new Rectangle(0, 0, w, h);
  return c;
}

/** The same with "Week 2" (or "Month 2, Week 1") in words over it, `w` wide: the new day's card and the town. */
export function weekDaysCaptioned(day: number, w: number, h: number, scale = 1.25): Container {
  const [month, week] = dateParts(day);
  const c = new Container();
  const t = new GameText("medfont", [...WHITE] as [number, number, number], "center", Math.floor(w / scale));
  t.value = month > 1 ? tr("Month %1, Week %2", month, week) : tr("Week %1", week);
  t.scale.set(scale);
  const row = weekDays(day, w, h);
  row.y = Math.ceil(t.height) + 2;
  c.addChild(t, row);
  c.label = row.label;
  return c;
}
