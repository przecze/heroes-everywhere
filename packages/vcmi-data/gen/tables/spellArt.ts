// Spell keys, targeting, animations (DEF names) and sounds, from VCMI's spell config: the spells (0-69) and the
// creature abilities that play like spells (ability.json, 70 on).
import type { Table } from "../build.ts";
import { header, record } from "../emit.ts";

type Anim = string | { defName?: string; effectName?: string };
const defs = (list: Anim[] | undefined) => (list ?? []).map((a) => (typeof a === "string" ? a : a.defName)).filter((d): d is string => !!d);

export default {
  out: "spellArt.ts",
  make(up) {
    const rows: [number, object][] = [];
    for (const p of up.json<Record<string, string[]>>("vcmi/config/gameConfig.json").spells) {
      for (const [key, s] of Object.entries<any>(up.json(`vcmi/${p}`))) {
        if (typeof s?.index !== "number") continue;
        const a = s.animation ?? {};
        const art: Record<string, unknown> = { key, target: s.targetType };
        for (const k of ["hit", "affect", "projectile"]) if (defs(a[k]).length) art[k] = defs(a[k]);
        if (s.sounds?.cast) art.sound = s.sounds.cast;
        rows.push([s.index, art]);
      }
    }
    rows.sort((a, b) => a[0] - b[0]);
    return (
      header(["Spell keys, targeting, animations (DEF names) and sounds, from VCMI's spell config (the creature abilities that play", "like spells from 70 on)."]) +
      `export interface SpellArt {\n  key: string;\n  target: string;\n  hit?: string[];\n  affect?: string[];\n  projectile?: string[];\n  sound?: string;\n}\n` +
      record("SPELL_ART", "Record<number, SpellArt>", rows)
    );
  },
} satisfies Table;
