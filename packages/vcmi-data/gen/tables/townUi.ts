// Town interface data per faction from VCMI's faction config and the HotA mod's: Town Hall slots (building keys),
// backgrounds, building icons, the Mage Guild's layout, the creature window's backgrounds.
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { header, record } from "../emit.ts";

const KEYS = ["hallSlots", "hallBackground", "buildingsIcons", "guildWindow", "guildBackground", "guildSpellPositions", "guildWindowPosition"] as const;

export default {
  out: "townUi.ts",
  make(up) {
    const rows: [string, unknown][] = [];
    for (const [k, f] of loadConfig(up, "factions").entries) {
      const t = f.town as Record<string, unknown> | undefined;
      if (!t?.hallSlots) continue;
      const ui: Record<string, unknown> = {};
      for (const key of KEYS) ui[key] = t[key] ?? null;
      ui.creatureBackground = f.creatureBackground;
      rows.push([k, ui]);
    }
    return (
      header(["Town interface data per faction from VCMI's faction config and the HotA mod's: Town Hall slots (building keys),", "backgrounds, building icons, the Mage Guild's layout, the creature window's backgrounds."]) +
      `export interface TownUi {\n  hallSlots: string[][][];\n  hallBackground: string;\n  buildingsIcons: string;\n  guildWindow: string[] | string;\n  guildBackground: string[] | string;\n  guildSpellPositions: { x: number; y: number }[][] | null;\n  guildWindowPosition?: { x: number; y: number } | null;\n  creatureBackground: Record<string, string>;\n}\n` +
      record("TOWN_UI", "Record<string, TownUi>", rows)
    );
  },
} satisfies Table;
