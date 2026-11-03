// The original's map objects' visit, ambient and pick-up sounds (VCMI's object configs), by the map's "type" or
// "type:subid", and the hoof beats on each terrain (VCMI's terrains and the HotA mod's: horseSound / horseSoundPenalty).
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { header, list, record } from "../emit.ts";
import { hotaMapIds } from "../ids.ts";

const bare = (n: string) => n.split("/").pop()!.replace(/\.wav$/i, "").toUpperCase();
type Sounds = Partial<Record<"visit" | "ambient" | "removal", string[]>>;
const pick = (s: Record<string, string[]>) => {
  const o: Sounds = {};
  for (const k of ["visit", "ambient", "removal"] as const) if (s[k]?.length) o[k] = s[k].map(bare);
  return o;
};

export default {
  out: "mapSounds.ts",
  make(up) {
    const out: [string, Sounds][] = [];
    for (const [, ov] of loadConfig(up, "objects", { mod: false }).entries as Map<string, Record<string, any>>) {
      if (typeof ov.index !== "number") continue;
      const base = { ...(ov.sounds ?? {}), ...(ov.base?.sounds ?? {}) };
      if (Object.keys(pick(base)).length) out.push([String(ov.index), pick(base)]);
      for (const t of Object.values<any>(ov.types ?? {})) {
        if (!t?.sounds || typeof t.index !== "number") continue;
        const s = pick(t.sounds);
        if (Object.keys(s).length) out.push([`${ov.index}:${t.index}`, s]);
      }
    }
    const terrains = loadConfig(up, "terrains").entries as Map<string, Record<string, any>>;
    const hota = new Map(hotaMapIds(up, "terrains").list as [string, number][]);
    const horse: [number, [string, string]][] = [];
    for (const [k, t] of terrains) {
      const id = typeof t.index === "number" ? t.index : hota.get(k);
      const name = (n: string) => (n.includes("/") ? bare(n) : n);
      if (id !== undefined && t.horseSound) horse.push([id, [name(t.horseSound), name(t.horseSoundPenalty ?? t.horseSound)]]);
    }
    horse.sort((a, b) => a[0] - b[0]);
    return header(["The original's map objects' sounds (VCMI's object configs) by the map's \"type\" or \"type:subid\", and each terrain's", "hoof beats (VCMI's terrains and the HotA mod's)."]) +
      record("BASE_SOUNDS", "Record<string, { visit?: string[]; ambient?: string[]; removal?: string[] }>", out) +
      "\n/** Footsteps per terrain (dirt .. rock, then HotA's highlands and wasteland): on a road, and off it. */\n" + list("HORSE_SOUNDS", "[string, string][]", horse.map(([, h]) => h));
  },
} satisfies Table;
