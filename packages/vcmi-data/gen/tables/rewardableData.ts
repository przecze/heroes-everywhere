// HotA's configurable map objects and creature banks (sea barrels, warehouses, vials of mana, Black Tower, Mansion...)
// from the HotA mod's map objects, by the map's "type:subid" (adventure/rewardable.ts says what the fields mean).
import type { Table } from "../build.ts";
import { loadConfig, modConfigFiles } from "../config.ts";
import { header, record } from "../emit.ts";
import { creatureIds, hotaObjectIds, spellIds, vcmiIndex } from "../ids.ts";

const RES = ["wood", "mercury", "ore", "sulfur", "crystal", "gems", "gold"];
const PRIMARY = ["attack", "defence", "spellpower", "knowledge"];
const last = (s: string) => s.split(":").pop()!;
type O = Record<string, any>;

export default {
  out: "rewardableData.ts",
  make(up) {
    const ids = hotaObjectIds(up), creatures = creatureIds(up), spells = spellIds(up);
    const artifacts = vcmiIndex(up, "vcmi/config/artifacts.json");
    const upgrades = new Map<string, string>();
    for (const [k, c] of loadConfig(up, "creatures").entries) if ((c.upgrades as string[] | undefined)?.length) upgrades.set(k, last((c.upgrades as string[])[0]));
    const creature = (c: string) => creatures.get(last(c));
    const resources = (r: unknown) =>
      Array.isArray(r) ? r.map((x: O) => ({ res: String(x.type).startsWith("@") ? x.type : RES.indexOf(x.type), amount: x.amount })) : Object.entries(r as O).map(([k, v]) => ({ res: RES.indexOf(k), amount: v }));
    const reward = (r: O) => {
      const out: O = {};
      const ch = r.appearChance;
      if (ch) out.chance = [ch.min ?? 0, ch.max ?? 100];
      // (mapDice is the map editor's preset outcome, not a dice: every outcome rolls the same dice unless appearChance names another.)
      if (ch && "dice" in ch) out.dice = ch.dice;
      // The map editor's chosen content (HotA 1.7: a map may set what a Jetsam or Sea Barrel holds).
      if ((r.mapDice ?? -1) >= 0) out.dice = r.mapDice;
      if (typeof r.message === "string") out.message = r.message;
      const lim = r.limiter ?? {};
      if ("resources" in lim) out.needs = resources(lim.resources);
      if ("canLearnSpells" in lim) out.needsSpell = true;
      if ("resources" in r) out.resources = resources(r.resources);
      for (const key of ["guards", "creatures"]) if (key in r) out[key] = r[key].map((g: O) => [creature(g.type), g.amount]);
      // A bank's stack that may come upgraded (Beholders / Evil Eyes...): [creature, count, upgrade, percent].
      (r.guards ?? []).forEach((g: O, i: number) => {
        const u = upgrades.get(last(g.type));
        if ("upgradeChance" in g && u && creatures.has(u)) out.guards[i].push(creatures.get(u), g.upgradeChance);
      });
      if ("artifacts" in r) out.artifacts = r.artifacts.map((a: string | O) => (typeof a === "string" ? a : (a.class ?? artifacts.get(last(a.type)))));
      if ("spells" in r) out.spells = r.spells.map((x: string) => (x.startsWith("@") ? x : spells.get(last(x))));
      if ("primary" in r) out.primary = PRIMARY.map((p) => r.primary[p] ?? 0);
      for (const key of ["manaPoints", "manaOverflowFactor", "movePercentage", "removeObject"]) if (key in r) out[key] = r[key];
      if ("bonuses" in r) out.bonuses = r.bonuses.map((b: O) => Object.fromEntries(["type", "subtype", "val", "duration", "turns"].filter((k) => k in b).map((k) => [k, b[k]])));
      return out;
    };
    const variables = (v: O | undefined) => {
      const out: O = {};
      for (const [kind, entries] of Object.entries<O>(v ?? {}))
        for (const [name, spec] of Object.entries<O>(entries)) {
          const d: O = { kind };
          if ("anyOf" in spec) d.anyOf = spec.anyOf.map((x: unknown) => (x && typeof x === "object" ? (x as O).class : kind === "resource" ? RES.indexOf(x as string) : x));
          for (const k of ["min", "max", "level"]) if (k in spec) d[k] = spec[k];
          out[`@${name}`] = d;
        }
      return out;
    };
    const defs = new Map<string, O>();
    for (const f of modConfigFiles(up, "objects").filter((f) => /\/mapObjects\/content\/config\/hotaMapObjects\/[^/]+$/.test(f))) {
      for (const [outer, ov] of Object.entries<O>(up.json(f))) {
        const bank = outer === "core:creatureBank";
        const base = ov.base ?? {};
        for (const [name, t0] of Object.entries<O>(ov.types ?? {})) {
          const t = { ...base, ...t0 };
          const at = ids.get(name);
          if (!at || !("rewards" in t)) continue;
          const msg = (k: string) => (typeof t[k] === "string" ? t[k] : undefined);
          const reset = t.resetParameters ?? {};
          const vars = variables(t.variables);
          const d: O = {
            name: t.name ?? name,
            bank: bank || undefined,
            visitMode: t.visitMode ?? (bank ? "once" : "unlimited"),
            selectMode: t.selectMode ?? "selectFirst",
            resetDays: reset.period,
            canRefuse: t.canRefuse,
            removable: t.removable,
            // (A bank's "onVisited" may be a reward of its own: the Churchyard's line and morale.)
            onVisited: msg("onVisitedMessage") || (bank && (t.onVisited ?? []).find((x: O) => x && typeof x.message === "string")?.message) || undefined,
            onGuarded: msg("onGuardedMessage"),
            onSelect: msg("onSelectMessage"),
            onEmpty: msg("onEmptyMessage"),
            variables: Object.keys(vars).length ? vars : undefined,
            rewards: t.rewards.map(reward),
          };
          for (const k of Object.keys(d)) if (d[k] === undefined || d[k] === null) delete d[k];
          defs.set(`${at[0]}:${at[1]}`, d);
        }
      }
    }
    // Some types are only named by their key ("wateringPlace"): spelled out.
    const nameOf = (n: string) => (n.includes(" ") ? n : n[0].toUpperCase() + n.slice(1).replace(/(?<=[a-z])([A-Z])/g, " $1"));
    const plain: [string, O][] = [], banks: [string, O][] = [];
    for (const [k, d] of defs) {
      d.name = nameOf(d.name);
      if (!d.bank) {
        if (d.rewards.some((r: O) => Object.keys(r).length)) plain.push([k, d]);
        continue;
      }
      const levels = d.rewards.map((r: O) => {
        const [lo, hi] = r.chance ?? [0, 100];
        const res = [0, 0, 0, 0, 0, 0, 0];
        for (const x of r.resources ?? []) res[x.res] += x.amount;
        const arts = (r.artifacts ?? []).map((a: unknown) => (String(a).startsWith("@") ? d.variables[a as string].anyOf[0] : a));
        const lvl: O = { chance: hi - lo, guards: r.guards ?? [] };
        if (res.some(Boolean)) lvl.resources = res;
        if (r.creatures?.length) lvl.creatures = r.creatures;
        if (arts.length) lvl.artifacts = arts;
        return lvl;
      });
      const b: O = { name: d.name, levels };
      // The bank's own lines (the generic ADVEVENT 32 / 33 / 34 otherwise): asked, plundered, won.
      const won = d.rewards.find((r: O) => r.message)?.message;
      for (const [key, text] of [["ask", d.onGuarded], ["empty", d.onVisited], ["won", won]]) if (text) b[key] = text;
      banks.push([k, b]);
    }
    return (
      header(["HotA's configurable map objects and creature banks, by \"type:subid\", from the HotA mod's map objects", "(adventure/rewardable.ts says what the fields mean)."]) +
      `import type { RewardableDef } from "../../core/src/adventure/rewardable.ts";\nimport type { BankDef } from "../../core/src/bankData.ts";\n\n` +
      record("REWARDABLE", "Record<string, RewardableDef>", plain) +
      "\n/** HotA creature banks, in the shape of bankData's BANKS. */\n" +
      record("HOTA_BANKS", "Record<string, BankDef>", banks)
    );
  },
} satisfies Table;
