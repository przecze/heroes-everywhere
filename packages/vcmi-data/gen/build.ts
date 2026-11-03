// Makes the tables in src/ from the upstream files (upstream.ts) and our fixes (patches/): each generator in gen/tables
// writes its table, then patches/<table>.patch is applied. Main commits all three; the open-source release commits only
// the generators and the patches, fetches the upstream files (fetch.ts) and runs this while building.
//
//   node packages/vcmi-data/gen/build.ts            make src/ (writes only what changed)
//   node packages/vcmi-data/gen/build.ts --check    src/ is what the upstream files and the patches make (npm test)
//   node packages/vcmi-data/gen/build.ts --keep     after a hand edit to src/: write the edit into its patch
//   node packages/vcmi-data/gen/build.ts --from vcmi=DIR hota-mod=DIR --pin
//       read whole checkouts (at the commits in sources.json) instead of upstream/, then copy the files the generators
//       read into upstream/ and record their sha256 in sources.json
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyPatch, makePatch } from "./patch.ts";
import { ROOT, UPSTREAM, Upstream, readSources, sha256 } from "./upstream.ts";

export interface Table {
  /** The file it makes in src/. */
  out: string;
  make(up: Upstream): string;
  /** How an export is written when not one entry per line (gen/adopt.ts writes old values the same way). */
  format?: Record<string, (name: string, value: any) => string>;
}

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const from: Record<string, string> = {};
const fi = args.indexOf("--from");
if (fi >= 0) for (const a of args.slice(fi + 1)) if (/^[\w-]+=/.test(a)) from[a.split("=")[0]] = a.slice(a.indexOf("=") + 1);

const up = new Upstream(from);
const tableDir = join(ROOT, "gen/tables");
const names = readdirSync(tableDir).filter((f) => f.endsWith(".ts")).sort();
const only = args.filter((a) => !a.startsWith("-") && !a.includes("="));
let bad = 0;
for (const f of names) {
  const t = (await import(pathToFileURL(join(tableDir, f)).href)).default as Table;
  if (only.length && !only.includes(t.out.replace(/\.ts$/, ""))) continue;
  const made = t.make(up);
  const patchFile = join(ROOT, "patches", t.out.replace(/\.ts$/, ".patch"));
  const target = join(ROOT, "src", t.out);
  if (flag("--keep")) {
    const p = makePatch(made, readFileSync(target, "utf8"), t.out);
    if (p) writeFileSync(patchFile, p);
    else if (existsSync(patchFile)) rmSync(patchFile);
    console.log(`${t.out}: ${p ? `${p.split("\n").filter((l) => /^[~+-]\d/.test(l)).length} changed lines kept in patches/` : "no fixes"}`);
    continue;
  }
  const want = applyPatch(made, existsSync(patchFile) ? readFileSync(patchFile, "utf8") : "", t.out);
  const have = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (flag("--check")) {
    if (have !== want) (bad++, console.error(`${t.out}: differs from what upstream/ and patches/ make (node packages/vcmi-data/gen/build.ts ${t.out.replace(/\.ts$/, "")}, or --keep for a hand edit)`));
  } else if (have !== want) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, want);
    console.log(`${t.out}: made`);
  }
}

if (flag("--pin")) {
  const s = readSources();
  s.files = {};
  for (const p of [...up.read].sort()) {
    const src = Object.keys(from).length ? join(from[p.split("/")[0]] ?? join(UPSTREAM, p.split("/")[0]), ...p.split("/").slice(1)) : join(UPSTREAM, p);
    const dst = join(UPSTREAM, p);
    if (src !== dst) (mkdirSync(dirname(dst), { recursive: true }), copyFileSync(src, dst));
    s.files[p] = sha256(readFileSync(dst));
  }
  writeFileSync(join(ROOT, "sources.json"), `${JSON.stringify(s, null, 2)}\n`);
  console.log(`sources.json: ${Object.keys(s.files).length} files`);
}
if (bad) process.exit(1);
