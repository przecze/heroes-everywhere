// Siege pictures per faction (VCMI's faction configs and the HotA mod's): picture prefix, the tower shooter's creature
// key, and where each piece of the walls is drawn.
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { header, record } from "../emit.ts";

export default {
  out: "sieges.ts",
  make(up) {
    const rows: [string, unknown][] = [];
    for (const [k, f] of loadConfig(up, "factions").entries) {
      const s = (f.town as { siege?: unknown } | undefined)?.siege;
      if (s) rows.push([k, s]);
    }
    return (
      header(["Siege pictures per faction (VCMI's faction configs and the HotA mod's): picture prefix, the tower shooter's", "creature key, and where each piece of the walls is drawn."]) +
      `export interface SiegeLayout {\n  imagePrefix: string;\n  shooter: string;\n  gate: { arch: P; gate: P };\n  /** Some towns have no moat picture (it's drawn into the background). */\n  moat: { bank?: P; moat?: P };\n  static: { background: P; bottom: P; top: P };\n  towers: Record<"bottom" | "keep" | "top", { battlement: P; creature: P; tower: P }>;\n  walls: { bottom: P; bottomMid: P; upper: P; upperMid: P };\n  [extra: string]: unknown;\n}\ntype P = { x: number; y: number };\n\n` +
      record("SIEGES", "Record<string, SiegeLayout>", rows)
    );
  },
} satisfies Table;
