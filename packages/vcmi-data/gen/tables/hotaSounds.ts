// The visit, ambient and pick-up sounds of HotA's own map objects (Ancient Lamp, Sea Barrel, Warehouses, Mansion, the
// towers...) from the HotA mod's object configs, keyed by the map's "type:subid"; the sounds are in HotA.snd under
// their bare names.
import type { Table } from "../build.ts";
import { modConfigFiles } from "../config.ts";
import { header } from "../emit.ts";
import { hotaObjectIds } from "../ids.ts";

const bare = (n: string) => n.split("/").pop()!.replace(/\.wav$/i, "").toUpperCase();
type Sounds = Partial<Record<"visit" | "ambient" | "removal", string[]>>;

export default {
  out: "hotaSounds.ts",
  make(up) {
    const ids = hotaObjectIds(up);
    const out = new Map<string, Sounds>();
    for (const f of modConfigFiles(up, "objects")) {
      for (const ov of Object.values(up.json<Record<string, any>>(f))) {
        if (!ov || typeof ov.types !== "object") continue;
        const base = { ...(ov.sounds ?? {}), ...(ov.base?.sounds ?? {}) };
        for (const [name, t] of Object.entries<any>(ov.types)) {
          // A type's own sounds add to its object's, key by key (a Warehouse's visit sound is the base's).
          const s = { ...base, ...(t?.sounds ?? {}) };
          const at = ids.get(name);
          if (!at || !Object.keys(s).length) continue;
          const o: Sounds = {};
          for (const k of ["visit", "ambient", "removal"] as const) if (s[k]?.length) o[k] = s[k].map(bare);
          out.set(`${at[0]}:${at[1]}`, o);
        }
      }
    }
    const rows = [...out].sort((a, b) => { const [x, y] = [a[0], b[0]].map((k) => k.split(":").map(Number)); return x[0] - y[0] || x[1] - y[1]; });
    return (
      header(["HotA's own map objects' sounds (the HotA mod's object configs), by the map's \"type:subid\"."]) +
      `export const HOTA_OBJECT_SOUNDS: Record<string, { visit?: string[]; ambient?: string[]; removal?: string[] }> = {\n${rows.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n")}\n};\n`
    );
  },
} satisfies Table;
