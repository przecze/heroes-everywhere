// Creature banks of the original (Naga Bank, Crypt, Shipwreck, Dragon Utopia...) from VCMI's creatureBanks.json and
// pyramid.json, the
// Ruins (HotA's Highlands bank) from the HotA mod's ruins.json, and each bank's battle formation (guardsLayout, VCMI's
// for the original's, the mod's for HotA's). A level is rolled by `chance` (percent); guards are
// [creature, count, upgradedCreature?, upgradePercent?] stacks; rewards are resources[7], creatures [id, count] and
// artifact classes.
import type { Table } from "../build.ts";
import { loadConfig, modConfigFiles } from "../config.ts";
import { header, record } from "../emit.ts";
import { creatureIds, hotaObjectIds } from "../ids.ts";

const RES = ["wood", "mercury", "ore", "sulfur", "crystal", "gems", "gold"];
const last = (s: string) => s.split(":").pop()!;
type O = Record<string, any>;

export default {
  out: "bankData.ts",
  make(up) {
    const creatures = creatureIds(up), hotaIds = hotaObjectIds(up);
    const upgrades = new Map<string, string>();
    for (const [k, c] of loadConfig(up, "creatures").entries) if ((c.upgrades as string[] | undefined)?.length) upgrades.set(k, last((c.upgrades as string[])[0]));
    const level = (r: O, chance: number) => {
      const guards = (r.guards ?? []).map((g: O) => {
        const s = [creatures.get(last(g.type)), g.amount];
        const u = upgrades.get(last(g.type));
        if ("upgradeChance" in g && u && creatures.has(u)) s.push(creatures.get(u), g.upgradeChance);
        return s;
      });
      const lvl: O = { chance, guards };
      const res = RES.map((k) => (r.resources ?? {})[k] ?? 0);
      if (res.some(Boolean)) lvl.resources = res;
      if (r.creatures?.length) lvl.creatures = r.creatures.map((c: O) => [creatures.get(last(c.type)), c.amount]);
      if (r.artifacts?.length) lvl.artifacts = r.artifacts.map((a: O | string) => (typeof a === "string" ? a : a.class));
      if (r.revealTiles?.radius) lvl.reveal = r.revealTiles.radius;
      return lvl;
    };
    const levels = (t: O) => t.rewards.map((r: O) => level(r, (r.appearChance?.max ?? 100) - (r.appearChance?.min ?? 0)));
    const banks: [string, O][] = [], layouts: [string, string][] = [];
    const layout = (k: string, l: string | undefined) => l && layouts.push([k, l.replace(/^creatureBank/, "").replace(/^./, (c) => c.toLowerCase())]);
    for (const ov of Object.values<O>(up.json("vcmi/config/objects/creatureBanks.json")))
      for (const t of Object.values<O>(ov.types)) {
        const k = `${ov.index}:${t.index}`;
        banks.push([k, { name: t.name, levels: levels(t) }]);
        layout(k, t.guardsLayout);
      }
    // The Pyramid (VCMI's pyramid.json): its golems, and a spell of the level its variable names.
    const pyr = up.json("vcmi/config/objects/pyramid.json").pyramid;
    for (const t of Object.values<O>(pyr.types)) {
      const spellLevel = Object.values<O>(t.variables?.spell ?? {})[0]?.level;
      banks.push([`${pyr.index}:${t.index}`, { name: t.name, levels: t.rewards.map((r: O) => ({ ...level(r, 100), ...(spellLevel ? { spells: spellLevel } : {}) })) }]);
    }
    // HotA's banks (their contents are rewardableData's HOTA_BANKS): the formations, and the Ruins' whole bank.
    for (const f of modConfigFiles(up, "objects"))
      for (const [outer, ov] of Object.entries<O>(up.json(f))) {
        if (outer !== "core:creatureBank") continue;
        for (const [name, t] of Object.entries<O>(ov.types ?? {})) {
          const at = hotaIds.get(name);
          if (!at) continue;
          const k = `${at[0]}:${at[1]}`;
          if (t.guardsLayout && t.guardsLayout !== "default") layout(k, t.guardsLayout);
          if (name === "ruins") {
            const won = t.rewards.find((r: O) => typeof r.message === "string")?.message;
            const empty = (t.onVisited ?? []).find((x: O) => typeof x?.message === "string")?.message;
            banks.push([k, { name: t.name, ask: t.onGuardedMessage, won, empty, levels: levels(t) }]);
          }
        }
      }
    return (
      header(["Creature banks of the original (VCMI's creatureBanks.json), the Ruins (the HotA mod's ruins.json), and each bank's", "battle formation (guardsLayout: VCMI's for the original's, the mod's for HotA's)."]) +
      `import type { BankDef } from "../../core/src/bankData.ts";\nimport type { BankLayout } from "../../core/src/battle/state.ts";\n\n` +
      record("BASE_BANKS", "Record<string, BankDef>", banks) +
      "\n" +
      record("BANK_LAYOUTS", "Record<string, BankLayout>", layouts)
    );
  },
} satisfies Table;
