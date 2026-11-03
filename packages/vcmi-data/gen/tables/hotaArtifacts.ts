// HotA's own artifacts (ids 146 and up): class, slot, name, value and description from the HotA mod's artifact configs,
// for game files whose ARTRAITS.TXT only has the original's.
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { header, record } from "../emit.ts";
import { hotaMapIds } from "../ids.ts";

const TIER: Record<string, string> = { TREASURE: "T", MINOR: "N", MAJOR: "J", RELIC: "R", SPECIAL: "S" };

export default {
  out: "hotaArtifacts.ts",
  make(up) {
    const { entries } = loadConfig(up, "artifacts", { skip: /\/gameBalance\// });
    const ids = new Map<string, number>([["cannon", 146], ...(hotaMapIds(up, "artifacts").list as [string, number][])]);
    const rows: [number, unknown][] = [];
    for (const [k, id] of ids) {
      const a = entries.get(k) as Record<string, any> | undefined;
      if (!a || id < 146) continue;
      const name = a.text?.name ?? k;
      rows.push([id, { tier: TIER[a.class] ?? "", slot: Array.isArray(a.slot) ? a.slot[0] : a.slot, name, cost: a.value ?? 0, description: String(a.text?.description ?? "").replace(/^\{[^}]*\}\n\n/, ""), event: String(a.text?.event ?? "") }]);
    }
    rows.sort((a, b) => a[0] - b[0]);
    return header(["HotA's own artifacts: class (T treasure, N minor, J major, R relic, S special), slot, name, value, description and", "what is said when one is found, from the HotA mod's artifact configs."]) +
      "export interface HotaArtifact {\n  tier: string;\n  /** VCMI's slot name: HEAD, RIGHT_HAND, ..., RING (either hand), MISC (any of five), MACH1... */\n  slot: string;\n  name: string;\n  cost: number;\n  description: string;\n  /** What is said when it is picked up (ARTEVENT's line for it). */\n  event: string;\n}\n" +
      record("HOTA_ARTIFACTS", "Record<number, HotaArtifact>", rows);
  },
} satisfies Table;
