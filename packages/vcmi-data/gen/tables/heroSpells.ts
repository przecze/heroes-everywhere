// The original's heroes who start with a spellbook, and the spells in it: VCMI's hero config with the HotA mod's
// balance changes.
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { header, record } from "../emit.ts";
import { heroIds, spellIds } from "../ids.ts";

export default {
  out: "heroSpells.ts",
  make(up) {
    // The original's heroes (HotA's own carry their spellbook in heroData's HOTA_HEROES), with the mod's changes.
    const { entries: heroes, from } = loadConfig(up, "heroes");
    const ids = heroIds(up, heroes), spells = spellIds(up);
    const rows: [number, number[]][] = [];
    for (const [k, h] of heroes) {
      const book = h.spellbook as string[] | undefined;
      if (book?.length && ids.has(k) && from.get(k)![0].startsWith("vcmi/")) rows.push([ids.get(k)!, book.map((s) => spells.get(s.replace(/^core:/, "")) ?? -1)]);
    }
    rows.sort((a, b) => a[0] - b[0]);
    return header(["Heroes who start with a spellbook, and the spells in it (VCMI's hero config and the HotA mod's)."]) + record("HERO_SPELLS", "Record<number, number[]>", rows);
  },
} satisfies Table;
