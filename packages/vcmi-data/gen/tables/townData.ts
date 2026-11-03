// Towns: buildings (ids as in the map format), their requirements and upgrade chains, town-screen sprites and
// positions, creature lines; the original's from VCMI's faction configs, HotA's from the mod's. The classic towns'
// costs come from the game's BUILDING.TXT at runtime.
import { readFileSync } from "node:fs";
import type { Table } from "../build.ts";
import { loadConfig } from "../config.ts";
import { strip } from "../creatures.ts";
import { header, listOf } from "../emit.ts";
import { creatureIds, hotaMapIds } from "../ids.ts";

const TYPES = readFileSync(new URL("./townTypes.txt", import.meta.url), "utf8");
const RES = ["wood", "mercury", "ore", "sulfur", "crystal", "gems", "gold"];
const OPS: Record<string, string> = { allOf: "all", anyOf: "any", noneOf: "none" };
type O = Record<string, any>;

const towns_ = (n: string, v: O[]) => listOf(n, "TownInfo[]", v, "buildings");

export default {
  out: "townData.ts",
  format: { TOWNS: (n, v) => towns_(n, v) },
  make(up) {
    const library = up.json<Record<string, O>>("vcmi/config/buildingsLibrary.json");
    const creatures = creatureIds(up);
    const hotaTowns = new Map(hotaMapIds(up, "factions").list as [string, number][]);
    const towns: O[] = [];
    for (const [faction, f] of loadConfig(up, "factions", { skip: /\/gameBalance\// }).entries as Map<string, O>) {
      const t = f.town;
      if (!t?.buildings) continue;
      const hota = !(f.index >= 0 && f.index < 9);
      const art = (s: unknown, ext: RegExp) => (typeof s !== "string" ? "" : hota ? s.replace(ext, "") : s.toLowerCase().replace(ext, ""));
      const ids = new Map<string, number>();
      for (const [k, b] of Object.entries<O>(t.buildings)) {
        const id = b?.id ?? library[k]?.id;
        if (typeof id === "number") ids.set(k, id);
      }
      const req = (r: unknown): unknown => {
        if (!Array.isArray(r) || !r.length) return null;
        if (typeof r[0] === "string" && OPS[r[0]]) return [OPS[r[0]], ...r.slice(1).map(req)];
        if (r.length === 1 && typeof r[0] === "string") return ids.get(r[0]) ?? -1;
        return ["all", ...r.map((x) => (typeof x === "string" ? ids.get(x) ?? -1 : req(x)))];
      };
      const buildings: Record<number, O> = {};
      const structures: Record<string, O> = t.structures ?? {};
      for (const [k, b0] of Object.entries<O>(t.buildings)) {
        if (!ids.has(k) || !b0 || typeof b0 !== "object") continue;
        const b = { ...library[k], ...b0 };
        const s = structures[k] ?? {};
        const o: O = { key: k, upgrades: typeof b.upgrades === "string" ? ids.get(b.upgrades) ?? null : null, requires: req(b.requires) };
        Object.assign(o, { def: art(s.animation, /\.def$/i), x: s.x ?? 0, y: s.y ?? 0, z: s.z ?? 0, border: art(s.border, hota ? /\.bmp$/i : /$^/), area: art(s.area, hota ? /\.bmp$/i : /$^/) });
        if (hota) {
          if (b.name) o.name = b.name;
          if (b.cost) o.cost = RES.map((r) => b.cost[r] ?? 0);
          if (b.description) o.description = b.description;
        }
        buildings[ids.get(k)!] = o;
      }
      const decorations = Object.entries(structures)
        .filter(([k, s]) => !ids.has(k) && s && typeof s === "object" && s.animation)
        .map(([, s]) => ({ def: art(s.animation, /\.def$/i), x: s.x ?? 0, y: s.y ?? 0, z: s.z ?? 0, builds: s.builds ?? null }));
      towns.push({
        id: hotaTowns.get(faction) ?? f.index,
        faction, background: art(t.townBackground, /$^/),
        creatures: (t.creatures ?? []).map((l: string[]) => l.map((c) => creatures.get(strip(c)) ?? -1)),
        horde: t.horde ?? [], mageGuild: t.mageGuild ?? 0, buildings, decorations,
      });
    }
    towns.sort((a, b) => a.id - b.id);
    for (const t of towns) delete t.id;
    return header(["Towns: buildings (ids as in the map format), requirements, upgrade chains, town-screen sprites and positions, creature lines;", "the original's from VCMI's faction configs, HotA's from the HotA mod's. Classic costs come from the game's BUILDING.TXT."]) + TYPES + towns_("TOWNS", towns);
  },
} satisfies Table;
