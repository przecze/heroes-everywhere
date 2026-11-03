// Campaign videos and music by the number a campaign file stores: VCMI's gameConfig.json mapping for RoE, AB and SoD,
// the HotA mod's mapSupport for HotA's own campaigns. A number with two videos: the second loops.
import type { Table } from "../build.ts";
import { header, record } from "../emit.ts";
import type { Entries } from "../vjson.ts";

const base = (f: string) => f.replace(/\.(smk|bik)$/i, "").toLowerCase();

export default {
  out: "campaignMedia.ts",
  make(up) {
    const videos = new Map<number, string[]>(), music = new Map<number, string>();
    const take = (block: Entries | undefined) => {
      const v = block?.get("campaignVideo") as Entries | undefined, m = block?.get("campaignMusic") as Entries | undefined;
      for (const [f, n] of v?.list ?? []) videos.set(n as number, [...(videos.get(n as number) ?? []), base(f)]);
      for (const [f, n] of m?.list ?? []) music.set(n as number, f.toLowerCase());
    };
    const vcmi = up.entries("vcmi/config/gameConfig.json");
    const formats = (vcmi.get("settings") as Entries).get("mapFormat") as Entries;
    for (const ed of ["restorationOfErathia", "armageddonsBlade", "shadowOfDeath"]) take(formats.get(ed) as Entries);
    const mod = up.entries("hota-mod/mods/mapSupport/mod.json");
    take(((mod.get("settings") as Entries).get("mapFormat") as Entries).get("hornOfTheAbyss") as Entries);
    const sorted = <T>(m: Map<number, T>) => [...m].sort((a, b) => a[0] - b[0]);
    return (
      header(["Campaign prologue / epilogue videos and music by the number a campaign file stores (VCMI's gameConfig.json for", "RoE, AB and SoD, the HotA mod's mapSupport for HotA's campaigns); a number with two videos: the second loops."]) +
      record("CAMPAIGN_VIDEOS", "Record<number, string[]>", sorted(videos)) +
      record("CAMPAIGN_MUSIC", "Record<number, string>", sorted(music))
    );
  },
} satisfies Table;
