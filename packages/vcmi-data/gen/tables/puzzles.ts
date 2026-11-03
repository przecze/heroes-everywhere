// Puzzle maps per faction (VCMI's faction config and the HotA mod's): picture prefix, and for each of the 48 pieces
// its position and when it is uncovered (pieces with index <= 48 x the obelisk share visited go).
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { header, record } from "../emit.ts";

export default {
  out: "puzzles.ts",
  make(up) {
    const rows: [string, unknown][] = [];
    for (const [k, f] of loadConfig(up, "factions").entries) if (f.puzzleMap) rows.push([k, f.puzzleMap]);
    return (
      header(["Puzzle maps per faction (VCMI's faction config and the HotA mod's): picture prefix, and for each of the 48 pieces", "its position and when it is uncovered (pieces with index <= 48 x the obelisk share visited go)."]) +
      record("PUZZLES", "Record<string, { prefix: string; pieces: { x: number; y: number; index: number }[] }>", rows)
    );
  },
} satisfies Table;
