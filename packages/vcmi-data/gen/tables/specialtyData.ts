// Hero specialties by hero id, from VCMI's hero configs and the HotA mod's (adventure/specialty.ts applies them).
import { readFileSync } from "node:fs";
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { header, record } from "../emit.ts";
import { creatureIds, heroIds, spellIds, vcmiIndex } from "../ids.ts";

const RES = ["wood", "mercury", "ore", "sulfur", "crystal", "gems", "gold"];
const strip = (n: string) => n.split(".").pop()!.split(":").pop()!;
const TYPES = readFileSync(new URL("./specialtyTypes.txt", import.meta.url), "utf8");

export default {
  out: "specialtyData.ts",
  make(up) {
    const creatures = creatureIds(up), spells = spellIds(up);
    const skills = vcmiIndex(up, "vcmi/config/skills.json");
    const upgrades = new Map<string, Set<string>>();
    for (const [k, c] of loadConfig(up, "creatures").entries) for (const u of (c.upgrades as string[] | undefined) ?? []) upgrades.set(k, (upgrades.get(k) ?? new Set()).add(strip(u)));
    const family = (key: string) => {
      const k = strip(key);
      return [...new Set([k, ...(upgrades.get(k) ?? [])])].filter((c) => creatures.has(c)).map((c) => creatures.get(c)!).sort((a, b) => a - b);
    };
    // Without the mod's game balance: HotA's changes to the specialties are applied by core's specialtyHota.ts.
    const heroes = loadConfig(up, "heroes", { skip: /\/gameBalance\// }).entries;
    const ids = heroIds(up, heroes);
    const out = new Map<number, Record<string, unknown>>();
    for (const [key, v] of heroes) {
      const sp = v.specialty as Record<string, any> | undefined;
      if (!sp || !ids.has(key)) continue;
      const spec: Record<string, unknown> = {};
      if (sp.creature) {
        spec.creatures = family(sp.creature);
        if ("creatureLevel" in sp) spec.creatureLevel = sp.creatureLevel;
      }
      if (sp.secondary && skills.has(strip(sp.secondary))) spec.skill = skills.get(strip(sp.secondary));
      const base = sp.base && typeof sp.base === "object" ? sp.base : {};
      const bonuses: Record<string, unknown>[] = [];
      for (const b0 of Object.values<any>(sp.bonuses ?? {})) {
        const b = { ...base, ...b0 };
        const e: Record<string, unknown> = { type: b.type };
        if (typeof b.subtype === "string") {
          const s = strip(b.subtype);
          if (String(b.type).startsWith("SPECIAL_") || String(b.type).includes("SPELL")) e.spell = spells.get(s) ?? s;
          else if (b.type === "GENERATE_RESOURCE") e.resource = RES.includes(s) ? RES.indexOf(s) : 6;
          else e.subtype = s;
        }
        if ("val" in b) e.val = b.val;
        const u = b.updater;
        if (u === "TIMES_HERO_LEVEL") e.perLevel = true;
        else if (u === "TIMES_HERO_LEVEL_DIVIDE_STACK_LEVEL") e.perLevelByCreatureLevel = true;
        else if (u && typeof u === "object" && u.type === "GROWS_WITH_LEVEL") e.grows = [u.valPer20 ?? 0, u.stepSize ?? 1];
        const lims = Array.isArray(b.limiters) ? b.limiters : b.limiters && typeof b.limiters === "object" ? [b.limiters] : [];
        for (const l of lims) {
          if (l?.type === "CREATURE_TYPE_LIMITER") e.creatures = l.includeUpgrades ? family(l.creature) : [creatures.get(strip(l.creature)) ?? -1];
          if (l?.type === "CREATURE_LEVEL_LIMITER") e.maxLevel = l.maxlevel ?? 7;
        }
        if (typeof b.addInfo === "number") e.addInfo = b.addInfo;
        bonuses.push(e);
      }
      if (bonuses.length) spec.bonuses = bonuses;
      if (Object.keys(spec).length) out.set(ids.get(key)!, spec);
    }
    return header(["Hero specialties by hero id, from VCMI's hero configs and the HotA mod's (adventure/specialty.ts applies them)."]) + TYPES + record("SPECIALTIES", "Record<number, Specialty>", [...out].sort((a, b) => a[0] - b[0]));
  },
} satisfies Table;
