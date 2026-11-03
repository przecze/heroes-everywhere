// VCMI's terrain view patterns (config/terrainViewPatterns.json): which frame a tile of a made map shows, by its
// neighbours (core adventure/terrainViews.ts applies them).
import type { Table } from "../build.ts";
import { header } from "../emit.ts";

export default {
  out: "terrainViews.ts",
  make(up) {
    const c = up.json<{ terrainView: unknown[]; terrainType: unknown[] }>("vcmi/config/terrainViewPatterns.json");
    const rows = (a: unknown[]) => a.map((v) => `    ${JSON.stringify(v)},`).join("\n");
    return (
      header(["VCMI's terrain view patterns (config/terrainViewPatterns.json), one pattern a line."]) +
      `export interface TerrainViewConfig {\n  view: { id: string; data: string[]; decoration?: boolean; minPoints?: number; maxPoints?: number; mapping: Record<string, string> }[];\n  type: { id: string; data: string[] }[];\n}\n` +
      `export const TERRAIN_VIEWS: TerrainViewConfig = {\n  view: [\n${rows(c.terrainView)}\n  ],\n  type: [\n${rows(c.terrainType)}\n  ],\n};\n`
    );
  },
} satisfies Table;
