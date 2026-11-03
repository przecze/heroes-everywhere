// Names to the numbers the original's files and maps use: VCMI's configs give each thing of the original an "index",
// the HotA mod's mapSupport gives HotA's own things theirs.
import type { Upstream } from "./upstream.ts";
import type { Entries } from "./vjson.ts";

const HOTA_MAP = "hota-mod/mods/mapSupport/mod.json";

/** The HotA mod's map numbers of one kind ("creatures", "heroes", "artifacts", "objects", ...). */
export function hotaMapIds(up: Upstream, kind: string): Entries {
  const m = up.entries(HOTA_MAP);
  return (((m.get("settings") as Entries).get("mapFormat") as Entries).get("hornOfTheAbyss") as Entries).get(kind) as Entries;
}

/** VCMI's "index" of every entry in the json files under a config directory (or one file). */
export function vcmiIndex(up: Upstream, where: string): Map<string, number> {
  const out = new Map<string, number>();
  const files = where.endsWith(".json") ? [where] : up.list(where);
  for (const f of files) for (const [k, v] of Object.entries(up.json<Record<string, { index?: number }>>(f))) if (v && typeof v === "object" && typeof v.index === "number") out.set(k, v.index);
  return out;
}

/** Creature key -> id: the original's (VCMI) and HotA's (the mod's map numbers). */
export function creatureIds(up: Upstream): Map<string, number> {
  const out = vcmiIndex(up, "vcmi/config/creatures");
  for (const [k, v] of hotaMapIds(up, "creatures").list) out.set(k, v as number);
  return out;
}

/** Hero key -> id: the original's (VCMI's index) and HotA's (the mod's map numbers). */
export function heroIds(up: Upstream, heroes: Map<string, Record<string, unknown>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of heroes) if (typeof v.index === "number") out.set(k, v.index);
  for (const [k, v] of hotaMapIds(up, "heroes").list) out.set(k, v as number);
  return out;
}

/** Spell key -> id (VCMI's spells). */
export const spellIds = (up: Upstream) => {
  const out = new Map<string, number>();
  for (const p of up.json<Record<string, string[]>>("vcmi/config/gameConfig.json").spells) for (const [k, v] of Object.entries(up.json<Record<string, { index?: number }>>(`vcmi/${p}`))) if (typeof v?.index === "number") out.set(k, v.index);
  return out;
};

/** HotA's map objects: name -> [type, subtype] (the mod's mapSupport, groups flattened). */
export function hotaObjectIds(up: Upstream): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const walk = (e: Entries) => {
    for (const [k, v] of e.list) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number") out.set(k, v as [number, number]);
      else if (v && typeof v === "object" && "list" in (v as object)) walk(v as Entries);
    }
  };
  walk(hotaMapIds(up, "objects"));
  return out;
}
