// The original's text files row by row (ADVEVENT, GENRLTXT, ARRAYTXT...) in a VCMI translation pack's language: its
// game.json's "core.<file>.<row>" lines (CC BY-SA 4.0) into src/i18n/core-<lang>.json, keeping the "help" that
// descriptions.ts puts there (run this first, then names.ts and descriptions.ts).
//
//   LANGS=fr,es node tools/i18n/core-texts.ts <folder with vcmi-<language>-translation-*.tar.gz>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** The languages with a VCMI translation pack (LANGS=fr,es picks some). */
const LANGS = ([["pl", "polish"], ["de", "german"], ["fr", "french"], ["es", "spanish"]] as const).filter(([c]) => !process.env.LANGS || process.env.LANGS.split(",").includes(c));
const [packs] = process.argv.slice(2);
if (!packs) throw new Error("usage: node tools/i18n/core-texts.ts PACKS_DIR");
const work = mkdtempSync(resolve(tmpdir(), "core-texts-"));
const i18n = process.env.I18N_SRC ?? resolve(import.meta.dirname, "../../packages/client/src/i18n");

/**
 * SEERHUT.TXT by "row.col" (the packs name its fields, VCMI's CGeneralTextHandler reading): row 1 the empty hut's
 * texts (core.seerhut.empty.<col>), rows 2-46 the nine missions' five states (core.seerhut.quest.<mission>.<state>.<k>,
 * column k + 1: three Seer's Hut wordings, then three Quest Guard ones), 67 the time limit, 70-117 the seers' names.
 */
function seerRows(game: Record<string, string>): Record<string, string> {
  const missions = ["heroLevel", "primarySkill", "killHero", "killCreature", "bringArt", "bringCreature", "bringResources", "bringHero", "bringPlayer"];
  const states = ["receive", "visit", "complete", "hover", "description"];
  const out: Record<string, string> = {};
  const put = (row: number, col: number, key: string) => game[key] !== undefined && (out[`${row}.${col}`] = game[key]);
  for (let k = 0; k < 6; k++) {
    put(1, k, `core.seerhut.empty.${k}`);
    put(67, k, `core.seerhut.time.${k}`);
    missions.forEach((m, i) => states.forEach((st, j) => put(2 + i * 5 + j, k + 1, `core.seerhut.quest.${m}.${st}.${k}`)));
  }
  for (let n = 0; n < 48; n++) put(70 + n, 0, `core.seerhut.names.${n}`);
  return out;
}

// ONLY=seerhut: adds that part to the language files as they are (the rest of them left alone).
const only = process.env.ONLY;

for (const [code, word] of LANGS) {
  const tar = readdirSync(packs).find((f) => f.startsWith(`vcmi-${word}-translation`));
  if (!tar) continue;
  const dir = resolve(work, code);
  mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["xzf", resolve(packs, tar), "-C", dir, "--wildcards", "*/content/config/*/game.json"]);
  const game = JSON.parse(readFileSync(resolve(dir, readdirSync(dir)[0], `content/config/vcmi-${word}/game.json`), "utf8")) as Record<string, string>;
  const out: Record<string, Record<string, string>> = {};
  for (const [k, v] of Object.entries(game)) {
    const m = /^core\.(\w+)\.(\d+)$/.exec(k);
    if (m) (out[m[1]] ??= {})[m[2]] = v;
  }
  out.seerhut = seerRows(game);
  const file = resolve(i18n, `core-${code}.json`);
  const had = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  if (only === "seerhut") {
    writeFileSync(file, JSON.stringify({ ...had, seerhut: out.seerhut }));
    console.log(code, "seerhut", Object.keys(out.seerhut).length);
    continue;
  }
  const help = had.help;
  writeFileSync(file, JSON.stringify({ ...out, ...(help ? { help } : {}) }));
  console.log(code, Object.fromEntries(Object.entries(out).map(([f, rows]) => [f, Object.keys(rows).length])));
}
