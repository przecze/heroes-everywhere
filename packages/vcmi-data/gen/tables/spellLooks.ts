// How every spell and spell-like ability looks in a battle, from VCMI's spell configs (config/spells/*.json "animation":
// cast / hit / affect / affectSecondary / projectile / ray, and config/battleEffects.json's colour muxers) with the HotA
// mod's changes and its own spells on top.
import type { Table } from "../build.ts";
import { header, record } from "../emit.ts";

interface Part { def?: string; bottom?: true; alpha?: number; colour?: string; pause?: number }
type Raw = string | number | { defName?: string; verticalPosition?: string; transparency?: number; effectName?: string; pause?: number; minimumAngle?: number };
interface Look { index?: number; cast?: Part[]; hit?: Part[]; affect?: Part[]; affectSecondary?: Part[]; projectile?: { def: string; angle: number }[]; ray?: unknown; sound?: string }

const base = (p: string) => p.split("/").pop()!;
const defOf = (name: string) => `${base(name).toLowerCase().replace(/\.def$/, "")}.def`;
function part(r: Raw): Part {
  if (typeof r === "number") return { pause: r };
  if (typeof r === "string") return { def: defOf(r) };
  const p: Part = {};
  if (r.defName) p.def = defOf(r.defName);
  if (r.verticalPosition === "bottom") p.bottom = true;
  if (r.transparency !== undefined && r.transparency !== 1) p.alpha = r.transparency;
  if (r.effectName) p.colour = r.effectName;
  if (r.pause) p.pause = r.pause;
  return p;
}
const QUEUES = ["cast", "hit", "affect", "affectSecondary"] as const;

export default {
  out: "spellLooks.ts",
  make(up) {
    const looks: Record<string, Look> = {};
    const merge = (key: string, spell: Record<string, any>) => {
      const look = (looks[key] ??= {});
      if (typeof spell.index === "number") look.index = spell.index;
      const anim = spell.animation ?? spell.graphics?.animation;
      for (const q of QUEUES) {
        const v = anim?.[q] as Raw[] | { appendItems: Raw[] } | undefined;
        if (!v) continue;
        look[q] = Array.isArray(v) ? v.map(part) : [...(look[q] ?? []), ...v.appendItems.map(part)];
      }
      const pr = anim?.projectile as Raw[] | { appendItems: Raw[] } | undefined;
      if (pr) {
        const list = (Array.isArray(pr) ? pr : pr.appendItems).map((r) => ({ def: defOf(typeof r === "object" ? (r.defName ?? "") : String(r)), angle: typeof r === "object" ? (r.minimumAngle ?? 0) : 0 }));
        look.projectile = Array.isArray(pr) ? list : [...(look.projectile ?? []), ...list];
      }
      if (anim?.ray) look.ray = anim.ray;
      const sound = spell.sounds?.cast;
      if (sound) look.sound = base(sound).replace(/\.wav$/i, "").toUpperCase();
    };
    for (const f of up.list("vcmi/config/spells")) for (const [k, v] of Object.entries(up.json<Record<string, unknown>>(f))) if (v && typeof v === "object") merge(k, v as Record<string, unknown>);
    // The HotA mod: "core:magicArrow" changes a VCMI spell, anything else is its own.
    const mod = up.list("hota-mod/mods");
    for (const f of mod.filter((p) => /\/spells\//i.test(p) || /artiSpells/.test(p))) {
      let d: Record<string, unknown>;
      try {
        d = up.json(f);
      } catch {
        continue;
      }
      for (const [k, v] of Object.entries(d)) if (v && typeof v === "object") merge(k.replace(/^core:/, ""), v as Record<string, unknown>);
    }
    for (const [k, v] of Object.entries(looks)) if (Object.keys(v).every((x) => x === "index" || x === "sound")) delete looks[k];
    const muxers: Record<string, unknown> = {};
    for (const f of ["vcmi/config/battleEffects.json", ...mod.filter((p) => base(p) === "battleEffects.json")]) Object.assign(muxers, up.json<Record<string, any>>(f).colorMuxers ?? {});
    delete muxers.example;
    return header(["How every spell and spell-like ability looks in a battle (VCMI's spell configs and battleEffects.json, the HotA mod's on top)."]) +
      record("SPELLS", "Record<string, unknown>", Object.entries(looks)) + "\n" + record("MUXERS", "Record<string, unknown>", Object.entries(muxers));
  },
} satisfies Table;
