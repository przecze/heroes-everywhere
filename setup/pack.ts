// Adds a language pack: the texts of the game in one more language, from a community translation on GitHub
// (fetched at a fixed commit, never part of this repository), turned into the files the game reads at
// /l10n/<lang>/. The setup page (/setup) runs it; by hand: node setup/pack.ts pl
//
// What it makes, in $L10N_DIR/<lang>/: core.json (the original's text files row by row), names.json (heroes,
// spells, artifacts, buildings, objects...), maps.json (the scenario list) and maps-N.json (the maps' own texts),
// extras.json (creatures, towns), sprites/ (buttons with words in them), fonts/ (Polish letters), about.json.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PACKS, SOURCES } from "../packages/client/packs.ts";

const code = process.argv[2] ?? "";
const pack = PACKS[code];
if (!pack) throw new Error(`usage: node setup/pack.ts ${Object.keys(PACKS).join("|")}`);
const app = resolve(import.meta.dirname, "..");
const l10n = process.env.L10N_DIR ?? resolve(app, ".state/l10n");
const out = resolve(l10n, code);
const status = (state: string, detail = "") => {
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "status.json"), JSON.stringify({ state, detail, at: new Date().toISOString() }));
  console.log(`language pack ${code}: ${state} ${detail}`);
};

const work = mkdtempSync(resolve(tmpdir(), `pack-${code}-`));
const tars = resolve(work, "tars");
mkdirSync(tars);
/** A repository's paths at a commit, as a tarball named the way tools/i18n/ look for it (or unpacked to `dir`). */
function fetchRepo(repo: string, sha: string, paths: string[], tarName?: string, dir?: string) {
  const git = resolve(work, repo.replace(/\W/g, "-"));
  const run = (args: string[], opts = {}) => execFileSync("git", args, { cwd: git, stdio: ["ignore", "pipe", "inherit"], ...opts });
  mkdirSync(git, { recursive: true });
  run(["init", "-q"]);
  run(["fetch", "-q", "--depth", "1", `https://github.com/${repo}`, sha]);
  const archive = run(["archive", "--prefix=top/", "FETCH_HEAD", ...paths], { maxBuffer: 1 << 30 });
  if (tarName) writeFileSync(resolve(tars, tarName), execFileSync("gzip", { input: archive, maxBuffer: 1 << 30 }));
  if (dir) (mkdirSync(dir, { recursive: true }), execFileSync("tar", ["x", "-C", dir], { input: archive, maxBuffer: 1 << 30 }));
}

try {
  status("working", "fetching");
  const word = pack.word;
  fetchRepo(pack.repo, pack.sha, ["content"], `vcmi-${word}-translation-${pack.sha.slice(0, 7)}.tar.gz`);
  fetchRepo(SOURCES.hotaMod.repo, SOURCES.hotaMod.sha, ["content/translation", "mods/maps/Mods/officialMaps/Content/translation"], `hota-mod-${SOURCES.hotaMod.sha.slice(0, 7)}.tar.gz`);
  const vcmi = resolve(work, "vcmi");
  fetchRepo(SOURCES.vcmi.repo, SOURCES.vcmi.sha, ["config/objects"], undefined, vcmi);

  status("working", "converting");
  const src = resolve(work, "src");
  const pub = resolve(work, "public");
  mkdirSync(src);
  mkdirSync(pub);
  const env = { ...process.env, LANGS: code, I18N_SRC: src, I18N_PUBLIC: pub };
  const tool = (name: string, ...args: string[]) => execFileSync(process.execPath, [resolve(app, "tools/i18n", `${name}.ts`), ...args], { env, stdio: ["ignore", "ignore", "inherit"] });
  const mapDirs = (process.env.HEROES_MAP_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
  // (In this order: descriptions.ts adds to what core-texts.ts and names.ts wrote.)
  tool("core-texts", tars);
  tool("names", tars, resolve(vcmi, "top/config/objects"));
  tool("descriptions", tars);
  if (mapDirs.length) tool("maps-text", tars, ...mapDirs);

  // The creatures' and towns' names, from the same pack and the HotA mod's words in its language.
  const unpack = (tar: string, ...globs: string[]) => {
    const dir = mkdtempSync(resolve(work, "x-"));
    execFileSync("tar", ["xzf", resolve(tars, tar), "-C", dir, "--wildcards", ...globs]);
    return resolve(dir, "top");
  };
  const packDir = unpack(readdirSync(tars).find((f) => f.startsWith("vcmi-"))!, "*/content/*");
  const modDir = unpack(readdirSync(tars).find((f) => f.startsWith("hota-mod-"))!, `*/content/translation/${word}.json`);
  const texts = {
    ...JSON.parse(readFileSync(resolve(packDir, `content/config/vcmi-${word}/game.json`), "utf8")),
    ...(existsSync(resolve(modDir, `content/translation/${word}.json`)) ? JSON.parse(readFileSync(resolve(modDir, `content/translation/${word}.json`), "utf8")) : {}),
  } as Record<string, string>;
  const creatures: Record<string, [string, string]> = {};
  const towns: Record<string, string> = {};
  for (const [k, v] of Object.entries(texts)) {
    const c = /^creatures\.(?:core|hota)\.(?:\w+\.)?(\w+)\.name\.(singular|plural)$/.exec(k);
    if (c) (creatures[c[1]] ??= ["", ""])[c[2] === "singular" ? 0 : 1] = v;
    const t = /^faction\.(?:core|hota)\.(?:\w+\.)?(\w+)\.name$/.exec(k);
    if (t) towns[t[1]] = v;
  }

  // Into place: the new pack's folder is made beside the old and swapped in whole.
  const next = resolve(l10n, `.next-${code}`);
  rmSync(next, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  for (const [from, to] of [[`core-${code}.json`, "core.json"], [`names-${code}.json`, "names.json"], [`maps-${code}.json`, "maps.json"]])
    if (existsSync(resolve(src, from))) cpSync(resolve(src, from), resolve(next, to));
  if (existsSync(resolve(pub, code))) for (const f of readdirSync(resolve(pub, code))) cpSync(resolve(pub, code, f), resolve(next, f));
  writeFileSync(resolve(next, "extras.json"), JSON.stringify({ creatures: Object.fromEntries(Object.entries(creatures).filter(([, n]) => n[0])), towns }));
  // The buttons and windows with words in them, and the Polish letters of the small font.
  const sprites = resolve(packDir, "content/sprites");
  if (existsSync(sprites)) {
    mkdirSync(resolve(next, "sprites"));
    for (const f of readdirSync(sprites)) if (pack.sprites.test(f)) cpSync(resolve(sprites, f), resolve(next, "sprites", f.toLowerCase()));
  }
  const data = resolve(packDir, "content/data");
  if (pack.fonts && existsSync(data))
    for (const f of readdirSync(data)) if (/^smalfont\.fnt$/i.test(f)) (mkdirSync(resolve(next, "fonts"), { recursive: true }), cpSync(resolve(data, f), resolve(next, "fonts", f.toLowerCase())));
  writeFileSync(resolve(next, "about.json"), JSON.stringify({ code, source: `https://github.com/${pack.repo}/tree/${pack.sha}`, licence: pack.licence, hotaMod: `https://github.com/${SOURCES.hotaMod.repo}/tree/${SOURCES.hotaMod.sha}`, added: new Date().toISOString(), maps: mapDirs.length > 0 }));
  rmSync(out, { recursive: true, force: true });
  renameSync(next, out);
  status("ready");
} catch (e) {
  status("failed", (e as Error).message.split("\n")[0]);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
