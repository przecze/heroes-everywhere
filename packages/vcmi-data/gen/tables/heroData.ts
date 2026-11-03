// Heroes and hero classes: the original's from VCMI's configs, HotA's from the mod's. The original heroes' starting
// creatures are in the patch; how many of each, the player's HOTRAITS.TXT says (core buildGameData).
import { readFileSync } from "node:fs";
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { strip } from "../creatures.ts";
import { header, list, record } from "../emit.ts";
import { creatureIds, hotaMapIds } from "../ids.ts";

const TYPES = readFileSync(new URL("./heroTypes.txt", import.meta.url), "utf8");
const LEVEL: Record<string, number> = { basic: 1, advanced: 2, expert: 3 };
type O = Record<string, any>;
/** HotA's campaign heroes (the mod keeps them out of maps: special), numbered from 215 by us; saved games keep these numbers. */
const CAMPAIGN_HEROES = ["stina", "umender", "elderian", "valquest", "jangaard", "winzells", "areshrak", "pactal", "kydoimos", "miseria", "athe", "gruezak", "zog", "boyd", "hotaMaximus", "balfour"];
const noExt = (s: unknown) => String(s ?? "").replace(/\.def$/i, "");
const lowBase = (s: unknown) => noExt(s).split("/").pop()!.toLowerCase();

export default {
  out: "heroData.ts",
  make(up) {
    // The original's heroes and classes as VCMI has them (HotA's changes to them are core's), HotA's from the mod.
    const classes = loadConfig(up, "heroClasses").entries as Map<string, O>;
    const heroes = loadConfig(up, "heroes").entries as Map<string, O>;
    const vcmiClasses = loadConfig(up, "heroClasses", { mod: false }).entries as Map<string, O>;
    const vcmiHeroes = loadConfig(up, "heroes", { mod: false }).entries as Map<string, O>;
    for (const [k, c] of vcmiClasses) classes.set(k, c);
    for (const [k, h] of vcmiHeroes) if (typeof h.index === "number") heroes.set(k, h);
    const creatures = creatureIds(up);
    // Hero classes: the original's by VCMI's index, HotA's two per town as the original's (might, then magic), by
    // the town's number on HotA's maps.
    const factions = new Map(hotaMapIds(up, "factions").list as [string, number][]);
    const classIds = new Map<string, number>();
    for (const [k, c] of classes) {
      if (typeof c.index === "number") classIds.set(k, c.index);
      else if (factions.has(strip(c.faction ?? ""))) classIds.set(k, 2 * factions.get(strip(c.faction))! + (c.affinity === "magic" ? 1 : 0));
    }
    const original: O[] = [], hota: [number, O][] = [];
    for (const [k, c] of classes) {
      const t = c.mapObject?.templates ?? {};
      const male = c.animation?.battle?.male, female = c.animation?.battle?.female;
      if (!classIds.has(k)) continue;
      if (typeof c.index === "number") {
        original[c.index] = { key: k, faction: strip(c.faction), affinity: c.affinity, mapDef: lowBase(t.default?.animation), battleDef: [lowBase(male), lowBase(female)] };
      } else {
        const o: O = { key: k, faction: strip(c.faction), affinity: c.affinity, mapDef: noExt((t.male ?? t.default)?.animation) };
        if (t.female) o.mapDefFemale = noExt(t.female.animation);
        o.battleDef = [noExt(male), noExt(female)];
        hota.push([classIds.get(k)!, o]);
      }
    }
    // Heroes: the original's by VCMI's index, HotA's by its maps' numbers, HotA's campaign heroes after them.
    const ids = new Map<string, number>();
    for (const [k, h] of heroes) if (typeof h.index === "number") ids.set(k, h.index);
    for (const [k, v] of hotaMapIds(up, "heroes").list) ids.set(k, v as number);
    CAMPAIGN_HEROES.forEach((k, i) => ids.set(k, 215 + i));
    const info: [number, O][] = [], hotaHeroes: [number, O][] = [];
    for (const [k, h] of heroes) {
      const id = ids.get(k);
      if (id === undefined || !h.class) continue;
      const o: O = { key: k, heroClass: classIds.get(strip(h.class)), female: !!h.female };
      o.army = (h.army ?? []).map((a: O) => [creatures.get(strip(a.creature)) ?? -1, a.min ?? 0, a.max ?? 0]);
      o.skills = (h.skills ?? []).map((s: O) => [strip(s.skill), LEVEL[s.level] ?? 1]);
      if (id < 156) { info.push([id, o]); continue; }
      if (h.images?.large) o.portrait = [String(h.images.large), String(h.images.small ?? "")];
      o.name = h.texts?.name ?? k;
      o.spellbook = Array.isArray(h.spellbook) ? h.spellbook.map(strip) : [];
      if (CAMPAIGN_HEROES.includes(k)) o.special = true;
      hotaHeroes.push([id, o]);
    }
    info.sort((a, b) => a[0] - b[0]);
    hotaHeroes.sort((a, b) => a[0] - b[0]);
    const portraits = up.json<{ images: { frame: number; file: string }[] }>("vcmi/Mods/vcmi/Content/Sprites/PortraitsLarge.json").images;
    const large: string[] = [];
    for (const p of portraits) large[p.frame] = p.file.replace(/\.\w+$/, "").toLowerCase();
    return header(["Heroes and hero classes: the original's from VCMI's configs (portraits: its PortraitsLarge), HotA's from the HotA mod's.", "The original heroes' starting creatures are in patches/heroData.patch; how many of each comes from the player's HOTRAITS.TXT (core buildGameData)."]) + TYPES +
      record("HERO_INFO", "Record<number, HeroInfo>", info) + "\n" + list("HERO_CLASSES", "HeroClassInfo[]", original) +
      "\n/** Large portrait (PCX name) by hero id, as named in the original files. */\n" + list("HERO_PORTRAITS", "string[]", large) +
      "\n/** HotA hero classes (ids 18-23), from the HotA mod. */\n" + record("HOTA_HERO_CLASSES", "Record<number, HeroClassInfo & { mapDefFemale?: string }>", hota) +
      "\n/** HotA heroes (ids 156+); 215 and up are the heroes of HotA's own campaigns, in the HotA mod's order. */\n" + record("HOTA_HEROES", "Record<number, HeroInfo & { name: string; spellbook?: string[] | null }>", hotaHeroes);
  },
} satisfies Table;
