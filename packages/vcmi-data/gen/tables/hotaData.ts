// HotA's creatures (ids 150 and up, the mod's map numbers) and HotA's changes to the original's creatures, from the
// HotA mod's creature configs.
import { readFileSync } from "node:fs";
import type { Table } from "../build.ts";
import { loadConfig, modConfigFiles } from "../config.ts";
import { abilities, base, soundName, strip } from "../creatures.ts";
import { header, list, record } from "../emit.ts";
import { hotaMapIds, vcmiIndex } from "../ids.ts";

const TYPES = readFileSync(new URL("./hotaTypes.txt", import.meta.url), "utf8");
const RES = ["wood", "mercury", "ore", "sulfur", "crystal", "gems", "gold"];
type O = Record<string, any>;
const amount = (a: O | undefined): [number, number] => [a?.min ?? 0, a?.max ?? 0];

export default {
  out: "hotaData.ts",
  make(up) {
    // The creatures as their own files have them; the gameBalance submod's changes are HOTA_BALANCE's kind.
    const { entries } = loadConfig(up, "creatures", { skip: /\/gameBalance\// });
    const creatures: O[] = [];
    for (const [key, id] of hotaMapIds(up, "creatures").list as [string, number][]) {
      const c = entries.get(key) as O | undefined;
      if (!c) continue;
      const g = c.graphics ?? {};
      const out: O = {
        id, key, name: c.name?.singular ?? key, plural: c.name?.plural ?? key, faction: strip(c.faction ?? ""), level: c.level ?? 0,
        cost: RES.map((r) => c.cost?.[r] ?? 0), growth: c.growth ?? 0, hordeGrowth: c.horde ?? 0, hp: c.hitPoints ?? 0, speed: c.speed ?? 0,
        attack: c.attack ?? 0, defense: c.defense ?? 0, minDamage: c.damage?.min ?? 0, maxDamage: c.damage?.max ?? 0, shots: c.shots ?? 0,
        aiValue: c.aiValue ?? 0, fightValue: c.fightValue ?? 0, abilities: abilities(c),
        def: base(g.animation, ".def"), missile: base(g.missile?.projectile), sound: soundName(c),
        mapDef: base(g.map, ".def"), mapMask: g.mapMask ?? [], amount: amount(c.advMapAmount),
      };
      const png = (p: unknown) => String(p).toLowerCase().replace(/^([^.]*)$/, "$1.png");
      if (g.iconSmall) out.iconSmall = png(g.iconSmall);
      if (g.iconLarge) out.iconLarge = png(g.iconLarge);
      creatures.push(out);
    }
    creatures.sort((a, b) => a.id - b.id);
    // The mod's changes to the original's creatures, as its files write them.
    const original = vcmiIndex(up, "vcmi/config/creatures");
    const balance = new Map<number, O>();
    for (const f of modConfigFiles(up, "creatures")) {
      for (const [k, v] of Object.entries(up.json<Record<string, O>>(f))) {
        const id = original.get(strip(k));
        if (id === undefined || !v || typeof v !== "object") continue;
        const b = balance.get(id) ?? {};
        if (v.cost) b.cost = { ...b.cost, ...v.cost };
        if (typeof v.aiValue === "number") b.aiValue = v.aiValue;
        if (typeof v.fightValue === "number") b.fightValue = v.fightValue;
        if (v.advMapAmount) b.amount = amount(v.advMapAmount);
        if (v.graphics?.missile?.projectile) b.missile = base(v.graphics.missile.projectile);
        if (Object.keys(b).length) balance.set(id, b);
      }
    }
    return header(["HotA's creatures (ids 150 and up, as HotA's maps number them) and HotA's changes to the original's creatures,", "from the HotA mod's creature configs."]) + TYPES + list("HOTA_CREATURES", "HotaCreature[]", creatures) +
      "\n/** HotA balance changes to original creatures, by id. */\n" + record("HOTA_BALANCE", "Record<number, { cost?: Record<string, number>; aiValue?: number; fightValue?: number; amount?: [number, number]; missile?: string }>", [...balance]);
  },
} satisfies Table;
