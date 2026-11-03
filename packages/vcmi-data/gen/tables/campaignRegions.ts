// Campaign maps: for each region number a campaign file stores, the picture prefix and where each scenario's region
// sits (VCMI's campaignRegions.json at the numbers of its gameConfig, the HotA mod's mapSupport for HotA's own).
import type { Table } from "../build.ts";
import { header, record } from "../emit.ts";
import type { Entries } from "../vjson.ts";

export default {
  out: "campaignRegions.ts",
  make(up) {
    const regions: Record<string, object> = { ...up.json("vcmi/config/campaignRegions.json") };
    const mod = up.json("hota-mod/mods/mapSupport/mod.json");
    Object.assign(regions, mod.campaignRegions);
    const ids: [string, number][] = [];
    const formats = (up.entries("vcmi/config/gameConfig.json").get("settings") as Entries).get("mapFormat") as Entries;
    for (const ed of ["restorationOfErathia", "armageddonsBlade", "shadowOfDeath"]) ids.push(...((((formats.get(ed) as Entries).get("campaignRegions") as Entries)?.list ?? []) as [string, number][]));
    ids.push(...(Object.entries(mod.settings.mapFormat.hornOfTheAbyss.campaignRegions) as [string, number][]));
    const rows = ids.filter(([k]) => regions[k]).map(([k, n]) => [n, { key: k, ...regions[k] }] as [number, object]).sort((a, b) => a[0] - b[0]);
    return (
      header(["Campaign maps: for each region number stored in .h3c files, the picture prefix and where each scenario's region", "sits (VCMI's campaignRegions.json and gameConfig numbers, the HotA mod's mapSupport for HotA's own)."]) +
      `export interface CampaignRegion {\n  key: string;\n  prefix: string;\n  colorSuffixLength: number;\n  /** HotA's own picture names: enabled, selected, conquered (else En / Se / Co). */\n  suffix?: string[];\n  /** HotA: the background picture (else prefix + "_BG"). */\n  background?: string;\n  desc: { infix: string; x: number; y: number }[];\n}\n\n` +
      record("CAMPAIGN_REGIONS", "Record<number, CampaignRegion>", rows)
    );
  },
} satisfies Table;
