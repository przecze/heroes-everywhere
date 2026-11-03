// Artifact bonuses, war machines and combination parts by artifact id: VCMI's artifacts.json and the HotA mod's
// artifacts (their own and their changes to the original's).
import { readFileSync } from "node:fs";
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { header, record } from "../emit.ts";
import { hotaMapIds } from "../ids.ts";

const TYPES = readFileSync(new URL("./artifactTypes.txt", import.meta.url), "utf8");
const last = (s: string) => s.split(":").pop()!;
type O = Record<string, any>;

export default {
  out: "artifactData.ts",
  make(up) {
    const { entries } = loadConfig(up, "artifacts");
    const ids = new Map<string, number>();
    for (const [k, a] of entries) if (typeof a.index === "number") ids.set(k, a.index);
    // HotA's map ids win: VCMI's placeholders (unusedArtifact1-3) hold the ids HotA gave its combinations.
    const hota = new Map(hotaMapIds(up, "artifacts").list.map(([k, v]) => [v as number, k]));
    for (const [id, k] of hota) ids.set(k, id);
    const rows: [number, O][] = [];
    for (const [k, a] of entries as Iterable<[string, O]>) {
      if (!ids.has(k) || (hota.has(ids.get(k)!) && hota.get(ids.get(k)!) !== k)) continue;
      const info: O = { key: k };
      const bonuses = [...Object.values<O>(a.bonuses ?? {}), ...Object.values<O>(a.instanceBonuses ?? {})].filter(Boolean).map((b) => {
        const o: O = { type: b.type };
        if (typeof b.subtype === "string") o.subtype = b.subtype.split(".").pop()!.split(":").pop();
        if ("val" in b) o.val = b.val;
        const lim = (Array.isArray(b.limiters) ? b.limiters : b.limiters ? [b.limiters] : []).filter((l: unknown) => typeof l === "string");
        if (lim.length) o.limiters = lim;
        return o;
      });
      if (bonuses.length) info.bonuses = bonuses;
      if (a.warMachine) info.warMachine = last(a.warMachine);
      if (Array.isArray(a.components) && a.components.length) info.components = a.components.map(last);
      rows.push([ids.get(k)!, info]);
    }
    rows.sort((x, y) => x[0] - y[0]);
    return header(["Artifact bonuses, war machines and combination parts by artifact id (VCMI's artifacts.json and the HotA mod's)."]) + TYPES + record("ARTIFACT_INFO", "Record<number, ArtifactInfo>", rows);
  },
} satisfies Table;
