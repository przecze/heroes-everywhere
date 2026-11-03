// The names of skills, hero classes, heroes, spells, artifacts and town buildings in Polish and German, from
// the VCMI translation packs and the HotA mod (CC BY-SA 4.0), keyed by our VCMI-style keys: src/i18n/names-<lang>.json.
//
//   node tools/i18n/names.ts <folder with vcmi-polish-translation-*.tar.gz, vcmi-german-translation-*.tar.gz, hota-mod-*.tar.gz> <VCMI repo config/objects>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Upstream } from "../../packages/vcmi-data/gen/upstream.ts";
import { hotaMapIds } from "../../packages/vcmi-data/gen/ids.ts";
import type { Entries } from "../../packages/vcmi-data/gen/vjson.ts";

/** The languages with a VCMI translation pack (LANGS=fr,es picks some). */
const LANGS = ([["pl", "polish"], ["de", "german"], ["fr", "french"], ["es", "spanish"]] as const).filter(([c]) => !process.env.LANGS || process.env.LANGS.split(",").includes(c));
const [packs, OBJECT_CONFIGS] = process.argv.slice(2);
if (!packs) throw new Error("usage: node tools/i18n/names.ts PACKS_DIR VCMI_CONFIG_OBJECTS_DIR");
const find = (prefix: string) => resolve(packs, readdirSync(packs).find((f) => f.startsWith(prefix))!);
const work = mkdtempSync(resolve(tmpdir(), "names-"));
const unpack = (tar: string, sub: string, ...globs: string[]) => {
  const dir = resolve(work, sub);
  mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["xzf", tar, "-C", dir, "--wildcards", ...globs]);
  return resolve(dir, readdirSync(dir)[0]);
};
const mod = unpack(find("hota-mod-"), "hota", "*/content/translation/english.json", ...LANGS.map(([, w]) => `*/content/translation/${w}.json`));
const modEnglish = JSON.parse(readFileSync(resolve(mod, "content/translation/english.json"), "utf8")) as Record<string, string>;
const KINDS = ["skill", "heroClass", "hero", "spell", "artifact"];

for (const [code, word] of LANGS) {
  const pack = unpack(find(`vcmi-${word}-translation`), code, "*/content/config/*/game.json");
  const all = { ...JSON.parse(readFileSync(resolve(pack, `content/config/vcmi-${word}/game.json`), "utf8")), ...JSON.parse(readFileSync(resolve(mod, `content/translation/${word}.json`), "utf8")) } as Record<string, string>;
  const out: Record<string, Record<string, unknown>> = Object.fromEntries(KINDS.map((k) => [k, {}]));
  const building: Record<string, Record<string, string>> = {};
  for (const [k, v] of Object.entries(all)) {
    const m = /^(\w+)\.(?:core|hota)\.(\w+)\.name$/.exec(k);
    if (m && KINDS.includes(m[1])) out[m[1]][m[2]] = v;
    // (HotA's own hero classes, skills and spells sit one level deeper: "heroClass.hota.factory.artificer.name".)
    const deep = /^(heroClass|skill|spell)\.hota\.(?:\w+\.)+(\w+)\.name$/.exec(k);
    if (deep && !(deep[2] in out[deep[1]])) out[deep[1]][deep[2]] = v;
    const b = /^building\.(?:core|hota)\.(\w+)(?:\.\1)?\.(\w+)\.name$/.exec(k);
    if (b) (building[b[1]] ??= {})[b[2]] = v;
  }
  // Map objects by their H3 type number: VCMI's object configs say which key is which number.
  const objects: Record<string, string> = {};
  for (const f of readdirSync(OBJECT_CONFIGS)) {
    const text = readFileSync(resolve(OBJECT_CONFIGS, f), "utf8");
    for (const m of text.matchAll(/^\t"(\w+)"\s*:\s*\{[^\n]*\n\s*"index"\s*:\s*(\d+)/gm)) if (all[`object.core.${m[1]}.name`]) objects[m[2]] = all[`object.core.${m[1]}.name`];
  }
  // Map objects by type and subtype ("17:0" the Basilisk Pit, "144:12" the Trapper Lodge): dwellings, banks and HotA's
  // objects go by their kind, not by OBJNAMES' type (VCMI's mapObject.<scope>.<group>.<kind>.name).
  const sub: Record<string, string> = {};
  const up = new Upstream();
  for (const f of up.list("vcmi/config/objects"))
    for (const [group, v] of Object.entries(up.json<Record<string, { index?: number; types?: Record<string, { index?: number }> }>>(f)))
      if (typeof v?.index === "number") for (const [kind, t] of Object.entries(v.types ?? {})) if (typeof t?.index === "number" && all[`mapObject.core.${group}.${kind}.name`]) sub[`${v.index}:${t.index}`] = all[`mapObject.core.${group}.${kind}.name`];
  const byEnd = (end: string) => Object.entries(all).find(([k]) => (k.startsWith("mapObject.hota.") || k.startsWith("object.hota.")) && k.endsWith(end))?.[1];
  for (const [name, at] of hotaMapIds(up, "objects").list as [string, unknown][]) {
    const pairs: [string, unknown][] = Array.isArray(at) ? [[`.${name}.name`, at]] : (at as Entries).list.map(([n, a]) => [`.${name}.${n}.name`, a]);
    for (const [end, a] of pairs) {
      const said = Array.isArray(a) && byEnd(end);
      if (said) sub[`${a[0]}:${a[1]}`] = said;
    }
  }
  // What is said when an artifact is picked up (ARTEVENT), by the artifact's key.
  const event: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    const e = /^artifact\.(?:core|hota)\.(?:\w+\.)*?(\w+)\.event$/.exec(k);
    if (e) event[e[1]] = v;
  }
  // HotA's objects' texts by the English the rules hand on (the HotA mod's words for the same key).
  const said: Record<string, string> = {};
  const modWords = JSON.parse(readFileSync(resolve(mod, `content/translation/${word}.json`), "utf8")) as Record<string, string>;
  const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
  for (const [k, v] of Object.entries(modEnglish)) if ((k.startsWith("mapObject.") || k.startsWith("object.hota.")) && modWords[k] && norm(modWords[k]) !== norm(v)) said[norm(v)] = norm(modWords[k]);
  // Skill descriptions per level and hero specialties (name, tooltip, description), by key.
  const skillDesc: Record<string, string[]> = {};
  const spec: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(all)) {
    const d = /^skill\.core\.(\w+)\.description\.(basic|advanced|expert)$/.exec(k);
    if (d) (skillDesc[d[1]] ??= [])[["basic", "advanced", "expert"].indexOf(d[2])] = v;
    const h = /^hero\.(?:core|hota)\.(?:\w+\.)?(\w+)\.specialty\.(name|tooltip|description)$/.exec(k);
    if (h) (spec[h[1]] ??= [])[["name", "tooltip", "description"].indexOf(h[2])] = v;
  }
  const levels = ["basic", "advanced", "expert"].map((l) => all[`core.skilllev.${["basic", "advanced", "expert"].indexOf(l)}`] ?? "");
  const file = resolve(process.env.I18N_SRC ?? resolve(import.meta.dirname, "../../packages/client/src/i18n"), `names-${code}.json`);
  // Terrains in our order (TERRNAME's: dirt ... rock, then HotA's highlands and wasteland).
  const terrains = [...["dirt", "sand", "grass", "snow", "swamp", "rough", "subterra", "lava", "water", "rock"].map((t) => all[`terrain.core.${t}.name`] ?? ""), all["terrain.hota.highlandsterrain.highlands.name"] ?? "", all["terrain.hota.wastelandterrain.wasteland.name"] ?? ""];
  writeFileSync(file, JSON.stringify({ ...out, building, objects, sub, said, event, skillDesc, spec, levels, terrains }) + "\n");
  console.log(code, Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Object.keys(v).length])), Object.keys(building).length, Object.keys(sub).length, levels);
}
