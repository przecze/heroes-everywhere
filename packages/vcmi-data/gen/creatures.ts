// What the creature tables share: a VCMI creature's abilities, art and sound names as our tables write them.
type O = Record<string, any>;
export const strip = (n: string) => n.split(".").pop()!.split(":").pop()!;
const camel = (s: string) => s.toLowerCase().replace(/_(.)/g, (_, c: string) => c.toUpperCase());
/** A path's file name, lower case, without `ext` (hota/cove/creatures/battle/CPR3UP.def: cpr3up). */
export const base = (s: unknown, ext = "") => (typeof s === "string" ? s.split("/").pop()!.toLowerCase().replace(ext, "") : "");

export function abilities(c: O): O[] {
  const out: O[] = [];
  if (c.doubleWide) out.push({ type: "DOUBLE_WIDE" });
  for (const b of Object.values<O>(c.abilities ?? {})) {
    if (!b || typeof b !== "object" || !b.type || b.type === "NONE") continue;
    const a: O = { type: b.type };
    if (typeof b.subtype === "string") a.subtype = strip(b.subtype);
    else if (typeof b.effectRange === "string") a.subtype = camel(b.effectRange);
    if (typeof b.val === "number") a.val = b.val;
    out.push(a);
  }
  return out;
}

/** The sound files' shared prefix (PIKEATTK.wav: PIKE). */
export const soundName = (c: O) => base([c.sound?.attack, c.sound?.shoot, c.sound?.move].find((s) => typeof s === "string")).replace(/(attk|shot|move)\.wav$/, "").toUpperCase();
