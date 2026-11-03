// One stack's cell in the battle's queue of who moves next, the same on every layout (2026-10-26: "a unified
// consistent by default component across modes"): the desktop's and the sideways phone's strip over the field, the
// upright band between the heroes, and the portraits in the upright log. The creature's small portrait on its
// side's flag colour, the count in the corner as on every army slot, the stack to move in a gold frame.
// client/test/sharedPieces.test.ts keeps every other battle file from drawing one.
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { slotCount } from "../ui/kit.ts";

export interface QueueCellLook {
  portrait: Texture | null;
  /** The stack's count (none: no count, as the log's portraits). */
  count?: number;
  /** Its side's flag colour (BattleView.flagOf). */
  flag: number;
  /** The cell's side, in its layer's pixels. */
  size: number;
  /** The stack whose turn it is: the gold frame. */
  current?: boolean;
  /** Picked to look at (upright): a white frame. */
  picked?: boolean;
  /** It moves only next round: dimmed. */
  nextRound?: boolean;
}

/** The cell, its top left corner at 0, 0. */
export function queueCell(o: QueueCellLook): Container {
  const z = o.size;
  const c = new Container();
  c.label = "queue cell";
  // The frame's line grows with the cell (1 on the desktop's 34, 3 on a phone's big one).
  const line = Math.max(1, Math.round(z / 24));
  c.addChild(new Graphics().rect(0, 0, z, z).fill(o.flag));
  if (o.portrait) {
    const p = Object.assign(new Sprite(o.portrait), { x: line + 1, y: line + 1, width: z - 2 * line - 2, height: z - 2 * line - 2 });
    p.alpha = o.nextRound ? 0.6 : 1;
    c.addChild(p);
  }
  if (o.current) c.addChild(new Graphics().rect(line / 2, line / 2, z - line, z - line).stroke({ color: 0xffd34a, width: line + 1 }));
  else if (o.picked) c.addChild(new Graphics().rect(line / 2, line / 2, z - line, z - line).stroke({ color: 0xffffff, width: line + 1 }));
  if (o.count !== undefined) {
    // The army slots' count: tiny on the desktop's small cells, medfont on a finger's (scaled with the cell).
    const big = z >= 44;
    const n = slotCount(o.count, z, z, big ? "medfont" : "tiny");
    if (big) {
      const k = z / 50;
      n.scale.set(k);
      n.position.set(z - 3 - n.width, z - 2 - n.height);
    } else n.position.y += 1;
    c.addChild(n);
  }
  return c;
}
