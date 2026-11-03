// The original's creatures (ids 0-149): art, sounds, town, level and abilities (VCMI's bonus types), from VCMI's
// creature configs. Numbers (attack, health, damage...) come from the game's CRTRAITS.TXT at runtime.
import { readFileSync } from "node:fs";
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { abilities, soundName, strip } from "../creatures.ts";
import { header, record } from "../emit.ts";

const TYPES = readFileSync(new URL("./creatureTypes.txt", import.meta.url), "utf8");
const file = (s: unknown) => (typeof s === "string" ? s.toLowerCase() : "");
type O = Record<string, any>;

export default {
  out: "creatureData.ts",
  make(up) {
    const { entries } = loadConfig(up, "creatures", { skip: /^hota-mod\// });
    const rows: [number, O][] = [];
    for (const [key, c] of entries as Iterable<[string, O]>) {
      if (typeof c.index !== "number" || c.index >= 150 || key.startsWith("unused")) continue;
      const g = c.graphics ?? {};
      const info: O = {
        key,
        faction: strip(c.faction ?? ""),
        level: c.level ?? 0,
        def: file(g.animation).replace(/\.def$/, ""),
        missile: file(g.missile?.projectile),
        sound: soundName(c),
        abilities: abilities(c),
      };
      if (Array.isArray(g.missile?.ray) && g.missile.ray.length) info.ray = g.missile.ray.map((l: O) => [l.start, l.end]);
      rows.push([c.index, info]);
    }
    rows.sort((a, b) => a[0] - b[0]);
    return header(["The original's creatures: art, sounds, town, level and abilities (VCMI's bonus types), from VCMI's creature configs.", "Numbers (attack, health, damage...) come from the game's CRTRAITS.TXT at runtime."]) + TYPES + record("CREATURE_INFO", "Record<number, CreatureInfo>", rows);
  },
} satisfies Table;
