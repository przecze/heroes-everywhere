// Battlefields and battle obstacles: VCMI's battlefields.json and obstacles.json, the HotA mod's on top (its obstacles
// numbered after VCMI's in load order). Blocked tiles are hex offsets from the obstacle's position; absolute obstacles
// list hexes directly.
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { header, list } from "../emit.ts";

type O = Record<string, any>;
const TYPES = `export interface ObstacleType {
  id: number;
  terrains: string[];
  special: string[];
  width: number;
  height: number;
  blocked: number[];
  art: string;
  absolute?: boolean;
  foreground?: boolean;
}

export interface Battlefield {
  id: string;
  background: string;
  /** Special fields (Holy Ground, ...) pick obstacles by field, not terrain. */
  special: boolean;
  /** Terrain the field belongs to, for obstacle selection. */
  terrain?: string;
  impassable?: number[];
  /** HotA's fields for one level only (underground sand and lava). */
  layer?: "surface" | "underground";
}

`;
// The original's pictures by their lower-case names (a .bmp is the game's .pcx); the mod's as it writes them.
const art = (s: unknown) => {
  const n = String(s ?? "");
  return n.includes("/") || /\.png$/i.test(n) ? n : n.toLowerCase().replace(/\.bmp$/, ".pcx");
};

export default {
  out: "battlefields.ts",
  make(up) {
    const obstacles: [number, O][] = [];
    let next = 0;
    // The mod's own obstacles after VCMI's: its new terrains' (highlands, wasteland) first, then the overlays' (our numbers).
    const all = [...(loadConfig(up, "obstacles").entries as Map<string, O>)];
    const rank = ([k, o]: [string, O]) => (/^\d+$/.test(k) ? 0 : String(o.animation).startsWith("hota/") ? 1 : 2);
    all.sort((a, b) => rank(a) - rank(b));
    for (const [k, o] of all) {
      const id = /^\d+$/.test(k) ? Number(k) : Math.max(next, ...obstacles.map(([i]) => i + 1));
      next = Math.max(next, id + 1);
      const row: O = { id, terrains: o.allowedTerrains ?? [], special: o.specialBattlefields ?? [], width: o.width ?? 0, height: o.height ?? 0, blocked: o.blockedTiles ?? [], art: art(o.animation) };
      if (o.absolute) row.absolute = true;
      if (o.foreground) row.foreground = true;
      obstacles.push([id, row]);
    }
    obstacles.sort((a, b) => a[0] - b[0]);
    const fields: [string, O][] = [];
    for (const [k, f] of loadConfig(up, "battlefields").entries as Map<string, O>) {
      const row: O = { id: k, background: art(f.graphics), special: !!f.isSpecial };
      if (Array.isArray(f.impassableHexes) && f.impassableHexes.length) row.impassable = f.impassableHexes;
      fields.push([k, row]);
    }
    return header(["Battlefields and battle obstacles: VCMI's battlefields.json and obstacles.json, the HotA mod's on top."]) +
      TYPES + list("OBSTACLES", "ObstacleType[]", obstacles.map(([, o]) => o)) + "\n" + list("BATTLEFIELD_LIST", "Battlefield[]", fields.map(([, f]) => f));
  },
} satisfies Table;
