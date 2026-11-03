// The scenario list's map names and descriptions in Polish and German, from the VCMI translation packs
// (the Polish / German translation mods' maps.json for the original's maps, the HotA mod's officialMaps
// translation for HotA's; CC BY-SA 4.0), keyed by the map's file name: src/i18n/maps-<lang>.json.
//
//   node tools/i18n/maps-text.ts <folder with vcmi-polish-translation-*.tar.gz, vcmi-german-translation-*.tar.gz, hota-mod-*.tar.gz> <folder with the bundled maps' .h3m, ...>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** The maps' texts go in this many files, a map by its name's sum (client i18n/mapText.ts does the same). */
/** The languages with a VCMI translation pack (LANGS=fr,es picks some). */
const LANGS = ([["pl", "polish"], ["de", "german"], ["fr", "french"], ["es", "spanish"]] as const).filter(([c]) => !process.env.LANGS || process.env.LANGS.split(",").includes(c));
const BUCKETS = 10;
const bucketOf = (slug: string) => [...slug].reduce((n, c) => n + c.charCodeAt(0), 0) % BUCKETS;
const [packs, ...mapDirs] = process.argv.slice(2);
if (!packs || !mapDirs.length) throw new Error("usage: node tools/i18n/maps-text.ts PACKS_DIR MAPS_DIR...");
const files = mapDirs.flatMap((d) => readdirSync(d).filter((f) => /\.h3m$/i.test(f)).map((f) => f.replace(/\.h3m$/i, "").trim().toLowerCase()));
const find = (prefix: string) => resolve(packs, readdirSync(packs).find((f) => f.startsWith(prefix))!);
const work = mkdtempSync(resolve(tmpdir(), "maps-text-"));
const unpack = (tar: string, sub: string, ...globs: string[]) => {
  const dir = resolve(work, sub);
  mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["xzf", tar, "-C", dir, "--wildcards", ...globs]);
  return dir;
};
const mod = unpack(find("hota-mod-"), "hota", ...LANGS.map(([, w]) => `*/mods/maps/Mods/officialMaps/Content/translation/${w}.json`));
const official = (lang: string) => JSON.parse(readFileSync(resolve(mod, readdirSync(mod)[0], `mods/maps/Mods/officialMaps/Content/translation/${lang}.json`), "utf8")) as Record<string, string>;

for (const [code, word] of LANGS) {
  const pack = unpack(find(`vcmi-${word}-translation`), code, "*/content/config/*/maps.json");
  const sod = JSON.parse(readFileSync(resolve(pack, readdirSync(pack)[0], `content/config/vcmi-${word}/maps.json`), "utf8")) as Record<string, string>;
  // (Our own words for the few maps the packs don't translate, tools/i18n/maps-ours.json.)
  const ours = (JSON.parse(readFileSync(resolve(import.meta.dirname, "maps-ours.json"), "utf8")) as Record<string, Record<string, string>>)[code] ?? {};
  const all = { ...sod, ...official(word), ...ours };
  const out: Record<string, [string, string]> = {};
  for (const f of files) {
    const name = all[`map.${f}.header.name`] ?? all[`map.${f}.name`];
    const description = all[`map.${f}.header.description`] ?? all[`map.${f}.description`];
    if (name || description) out[f] = [name ?? "", description ?? ""];
  }
  // Each map's other texts (events, signs, guards, monsters, towns, seers, rumours, heroes' lives), for the page to fetch when a map
  // opens: public/l10n/<lang>/maps-<bucket>.json holding {slug: {key: text}} for the maps in that bucket (few files: the client's
  // upload counts every file), keys as the packs have them minus "map.<file>.".
  const dir = resolve(process.env.I18N_PUBLIC ?? resolve(import.meta.dirname, "../../packages/client/public/l10n"), code);
  rmSync(resolve(dir, "maps"), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const slug = (f: string) => f.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const buckets: Record<string, string>[][] = Array.from({ length: BUCKETS }, () => []);
  let texts = 0;
  for (const f of files) {
    const own: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) if (k.startsWith(`map.${f}.`)) own[k.slice(f.length + 5)] = v;
    if (Object.keys(own).length) (buckets[bucketOf(slug(f))].push({ [slug(f)]: own as never }), texts++);
  }
  buckets.forEach((list, i) => writeFileSync(resolve(dir, `maps-${i}.json`), JSON.stringify(Object.assign({}, ...list))));
  console.log(`${code}: ${texts} maps with texts`);
  writeFileSync(resolve(process.env.I18N_SRC ?? resolve(import.meta.dirname, "../../packages/client/src/i18n"), `maps-${code}.json`), JSON.stringify(out, null, 0) + "\n");
  console.log(`${code}: ${Object.keys(out).length} of ${files.length} maps`);
}
