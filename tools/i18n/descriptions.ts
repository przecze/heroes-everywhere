// What names.ts leaves out, from the same VCMI packs and HotA mod (CC BY-SA 4.0): HELP.TXT's rollover and right-click
// texts (core.help.N.hover / .help) into src/i18n/core-<lang>.json's "help" ("N" and "N.help"), and the artifacts'
// descriptions by key (without their "{Name}" heading) into src/i18n/names-<lang>.json's "artifactDesc", the town
// buildings' descriptions by faction and key into its "buildingDesc", and the
// names of the artifacts names.ts misses (the HotA mod's "artifact.hota.artifacts.<key>.name") into its "artifact".
//
//   node tools/i18n/descriptions.ts <folder with vcmi-polish-translation-*.tar.gz, vcmi-german-translation-*.tar.gz, hota-mod-*.tar.gz>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** The languages with a VCMI translation pack (LANGS=fr,es picks some). */
const LANGS = ([["pl", "polish"], ["de", "german"], ["fr", "french"], ["es", "spanish"]] as const).filter(([c]) => !process.env.LANGS || process.env.LANGS.split(",").includes(c));
const [packs] = process.argv.slice(2);
if (!packs) throw new Error("usage: node tools/i18n/descriptions.ts PACKS_DIR");
const find = (prefix: string) => resolve(packs, readdirSync(packs).find((f) => f.startsWith(prefix))!);
const work = mkdtempSync(resolve(tmpdir(), "descriptions-"));
const unpack = (tar: string, sub: string, ...globs: string[]) => {
  const dir = resolve(work, sub);
  mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["xzf", tar, "-C", dir, "--wildcards", ...globs]);
  return resolve(dir, readdirSync(dir)[0]);
};
const mod = unpack(find("hota-mod-"), "hota", ...LANGS.map(([, w]) => `*/content/translation/${w}.json`));
const i18n = process.env.I18N_SRC ?? resolve(import.meta.dirname, "../../packages/client/src/i18n");

for (const [code, word] of LANGS) {
  const pack = unpack(find(`vcmi-${word}-translation`), code, "*/content/config/*/game.json");
  const all = { ...JSON.parse(readFileSync(resolve(pack, `content/config/vcmi-${word}/game.json`), "utf8")), ...JSON.parse(readFileSync(resolve(mod, `content/translation/${word}.json`), "utf8")) } as Record<string, string>;
  const help: Record<string, string> = {};
  const artifactDesc: Record<string, string> = {};
  const artifactName: Record<string, string> = {};
  // The town buildings' descriptions by faction and key, as names.ts takes their names (the build window, a building's
  // picture: the owner's notes 2026-10-29 17:01 and 23:52, still English in Polish and German).
  const buildingDesc: Record<string, Record<string, string>> = {};
  // Spells' descriptions at none / basic / advanced / expert, without their "{Name - level}" heading (the battle's and
  // the spellbook's pop-up: the owner's note 2026-10-27 18:32, English in Polish).
  const spellDesc: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(all)) {
    const h = /^core\.help\.(\d+)\.(hover|help)$/.exec(k);
    if (h) help[h[2] === "hover" ? h[1] : `${h[1]}.help`] = v;
    const a = /^artifact\.(?:core|hota)\.(?:\w+\.)?(\w+)\.description$/.exec(k);
    if (a) artifactDesc[a[1]] = v.replace(/^\{[^}]*\}\s*/, "").trim();
    const n = /^artifact\.(?:core|hota)\.(?:\w+\.)?(\w+)\.name$/.exec(k);
    if (n) artifactName[n[1]] = v;
    const b = /^building\.(?:core|hota)\.(\w+)(?:\.\1)?\.(\w+)\.description$/.exec(k);
    if (b) (buildingDesc[b[1]] ??= {})[b[2]] = v;
    const sd = /^spell\.(?:core|hota)\.(\w+)\.description\.(none|basic|advanced|expert)$/.exec(k);
    if (sd) (spellDesc[sd[1]] ??= [])[["none", "basic", "advanced", "expert"].indexOf(sd[2])] = v.replace(/^\{[^}]*\}\s*/, "").trim();
  }
  const coreFile = resolve(i18n, `core-${code}.json`);
  writeFileSync(coreFile, JSON.stringify({ ...JSON.parse(readFileSync(coreFile, "utf8")), help }));
  const namesFile = resolve(i18n, `names-${code}.json`);
  const names = JSON.parse(readFileSync(namesFile, "utf8"));
  writeFileSync(namesFile, JSON.stringify({ ...names, artifact: { ...artifactName, ...names.artifact }, artifactDesc, buildingDesc, spellDesc }) + "\n");
  console.log(code, Object.keys(help).length, "help texts,", Object.keys(artifactDesc).length, "artifact descriptions,", Object.values(buildingDesc).reduce((n, t) => n + Object.keys(t).length, 0), "building descriptions,", Object.keys(spellDesc).length, "spells' descriptions");
}
