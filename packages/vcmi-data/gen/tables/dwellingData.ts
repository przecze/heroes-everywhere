// Creature dwellings on the adventure map (object 17): subtype -> the creatures sold, from VCMI's dwellings config.
import type { Table } from "../build.ts";
import { header, record } from "../emit.ts";
import type { Entries } from "../vjson.ts";
import { creatureIds, hotaMapIds } from "../ids.ts";

export default {
  out: "dwellingData.ts",
  make(up) {
    const ids = creatureIds(up);
    const d = up.json("vcmi/config/objects/dwellings.json").creatureGeneratorCommon.types as Record<string, { index: number; creatures: string[][] }>;
    const rows = Object.values(d)
      .map((t) => [t.index, t.creatures.flat().map((c) => ids.get(c) ?? -1)] as [number, number[]])
      .sort((a, b) => a[0] - b[0]);
    // HotA's own (Cove, Factory, Bulwark, neutral): the mod's dwellings, at the subtypes its mapSupport gives them.
    const types: Record<string, { creatures?: string[][] }> = {};
    for (const f of up.list("hota-mod/mods", /^dwellings\.json$/i)) Object.assign(types, (up.json(f) as Record<string, { types?: object }>)["core:creatureGeneratorCommon"]?.types);
    for (const [name, at] of (hotaMapIds(up, "objects").get("creatureGeneratorCommon") as Entries).list as [string, [number, number]][])
      if (types[name]?.creatures) rows.push([at[1], types[name].creatures!.flat().map((c) => ids.get(c) ?? -1)]);
    return header(["Creature dwellings on the adventure map (object 17): subtype -> creatures sold (VCMI's dwellings config, and the", "HotA mod's for HotA's own at the subtypes of its mapSupport)."]) + record("DWELLINGS", "Record<number, number[]>", rows);
  },
} satisfies Table;
