// The Russian release's own game files from the HotA installer: its HotA_lng.lod (all 60 text files row for row
// like the English one, cp1251, and the DEFs with Russian words in them) and the Russian fonts HD mod draws it with
// (_HD3_Data/Common/Rus.Fonts). Like every game file they are never in the repo: this packs them into a tarball for
// the project's files (/mnt/project-files/vendor), which packages/client/l10nArt.ts unpacks into the l10n folder
// (vendor/l10n/ru/{text,sprites,fonts}), served at /l10n/ru/... and carried by a client build.
//
//   node tools/i18n/hota-language.ts <HotA_1.8.1_setup.exe> <out.tar.gz>        (needs innoextract)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseH3m, type H3Map } from "../../packages/formats/src/h3m.ts";
import { ResourceStore } from "../../packages/formats/src/node.ts";

const [setup, out] = process.argv.slice(2);
if (!setup || !out) throw new Error("usage: node tools/i18n/hota-language.ts HotA_setup.exe out.tar.gz");
const work = mkdtempSync(resolve(tmpdir(), "hota-lang-"));
// (The installer holds HotA_lng.lod once per language; rename-all keeps both, as "HotA_lng.lod#Lang\Rus".)
execFileSync("innoextract", ["-e", "-q", "--collisions", "rename-all", "-I", "app/Data/HotA_lng.lod", "-I", "app/_HD3_Data/Common/Rus.Fonts", "-I", "app/Maps", "-d", work, resolve(setup)], { stdio: "inherit" });
const data = resolve(work, "app/Data");
const lodName = readdirSync(data).find((f) => /hota_lng\.lod#lang.rus$/i.test(f));
if (!lodName) throw new Error("no Russian HotA_lng.lod in the installer");
const lodDir = resolve(work, "lod");
mkdirSync(lodDir);
copyFileSync(resolve(data, lodName), resolve(lodDir, "HotA_lng.lod"));
const lod = new ResourceStore([lodDir]);

const stage = resolve(work, "stage/ru");
for (const sub of ["text", "sprites", "fonts"]) mkdirSync(resolve(stage, sub), { recursive: true });
let n = { text: 0, sprites: 0, fonts: 0 };
for (const { name } of lod.list()) {
  const sub = name.endsWith(".txt") ? "text" : name.endsWith(".def") ? "sprites" : undefined;
  if (!sub) continue;
  writeFileSync(resolve(stage, sub, name), lod.get(name)!);
  n[sub]++;
}
const fonts = resolve(work, "app/_HD3_Data/Common/Rus.Fonts");
for (const f of readdirSync(fonts)) if (/\.fnt$/i.test(f)) (copyFileSync(resolve(fonts, f), resolve(stage, "fonts", f.toLowerCase())), n.fonts++);
// HotA's maps in Russian ("[HotA] X.h3m#Lang\Rus" beside the English "#Lang\Eng"): their names and descriptions for the
// scenario list (maps.json, i18n/maps.ts) and their own texts by place (maps-<n>.json, as tools/i18n/maps-text.ts
// makes them for the packs; i18n/mapText.ts), where they differ from the English map.
// (Read as the English, windows-1252, then turned back into their bytes and read as windows-1251.)
const cp1252 = new TextDecoder("windows-1252");
const back = new Map(Array.from({ length: 256 }, (_, b) => [cp1252.decode(Uint8Array.of(b)), b] as [string, number]));
const cyr = new TextDecoder("windows-1251");
const ru = (t: string) => cyr.decode(Uint8Array.from([...t], (c) => back.get(c) ?? 0x3f));
const maps = resolve(work, "app/Maps");
const list: Record<string, [string, string]> = {};
const BUCKETS = 10;
const buckets: Record<string, Record<string, string>>[] = Array.from({ length: BUCKETS }, () => ({}));
const slug = (file: string) => file.replace(/\.h3m$/i, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const read = (f: string) => {
  const b = readFileSync(resolve(maps, f));
  return parseH3m(new Uint8Array(b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b));
};
/** Every text of a map by the packs' keys (i18n/mapText.ts's places). */
function texts(m: H3Map): Record<string, string> {
  const t: Record<string, string> = { "header.name": m.name, "header.description": m.description };
  m.events?.forEach((e, i) => (t[`event.${i}.description`] = e.message));
  m.rumors.forEach((r, i) => (t[`header.rumor.${i}.text`] = r.text));
  for (const [id, c] of Object.entries(m.heroCustom ?? {})) if (c.biography) t[`heroes.${id}.biography`] = c.biography;
  for (const o of m.objects) {
    const d = o.data as Record<string, any>;
    const at = `${o.x}.${o.y}.${o.z}`;
    if (typeof d.message === "string") for (const kind of ["sign", "monster", "guards"]) t[`${kind}.${at}.message`] = d.message;
    if (typeof d.name === "string") t[`town.${at}.name`] = d.name;
    (d.events as { message: string }[] | undefined)?.forEach((e, i) => (t[`town.${at}.event.${i}.description`] = e.message));
    for (const q of [d, ...((d.quests as Record<string, any>[] | undefined) ?? [])]) for (const f of ["firstVisit", "nextVisit", "completed"]) if (typeof q[f] === "string") t[`quest.${at}.${f}`] = q[f];
  }
  return t;
}
let mapCount = 0;
for (const f of readdirSync(maps)) {
  const m = /^(.*\.h3m)#lang.rus$/i.exec(f);
  if (!m) continue;
  const enFile = readdirSync(maps).find((g) => g.toLowerCase() === `${m[1].toLowerCase()}#lang\\eng`) ?? m[1];
  let ruMap: H3Map, enMap: H3Map;
  try {
    (ruMap = read(f)), (enMap = read(enFile));
  } catch (e) {
    console.warn(`${m[1]}: ${(e as Error).message}`);
    continue;
  }
  const own = texts(ruMap);
  const english = texts(enMap);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(own)) if (v && v !== english[k]) out[k] = ru(v);
  if (!Object.keys(out).length) continue;
  const name = slug(m[1]);
  buckets[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % BUCKETS][name] = out;
  list[m[1].replace(/\.h3m$/i, "").trim().toLowerCase()] = [out["header.name"] ?? "", out["header.description"] ?? ""];
  mapCount++;
}
writeFileSync(resolve(stage, "maps.json"), JSON.stringify(list) + "\n");
buckets.forEach((b, i) => writeFileSync(resolve(stage, `maps-${i}.json`), JSON.stringify(b) + "\n"));
console.log("maps", mapCount);
// What the page needs to read them: the code page of the text files and fonts.
writeFileSync(resolve(stage, "lang.json"), JSON.stringify({ encoding: "windows-1251", from: "HotA installer " + setup.split("/").pop() }) + "\n");
execFileSync("tar", ["czf", resolve(out), "-C", resolve(work, "stage"), "ru"]);
rmSync(work, { recursive: true, force: true });
console.log(out, n);
