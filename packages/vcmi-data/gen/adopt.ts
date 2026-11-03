// Moving a table here: the old module's exports written in the generated layout over src/<out> (the generator's own
// header and order kept), so that build.ts --keep turns the differences into the table's patch.
//   node packages/vcmi-data/gen/adopt.ts <out.ts> <old module> NAME[:TYPE]...
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { list, record } from "./emit.ts";
import { ROOT } from "./upstream.ts";

const [out, mod, ...names] = process.argv.slice(2);
const table = (await import(new URL(`./tables/${out.replace(/\.ts$/, "")}.ts`, import.meta.url).href)).default as { format?: Record<string, (n: string, v: unknown) => string> };
const old = await import(pathToFileURL(resolve(mod)).href);
const file = join(ROOT, "src", out);
let text = readFileSync(file, "utf8");
for (const n of names) {
  const start = text.indexOf(`export const ${n}: `);
  if (table.format?.[n]) {
    const end = text.indexOf("\n];\n", start) + 4;
    text = text.slice(0, start) + table.format[n](n, old[n]) + text.slice(end);
    continue;
  }
  if (Array.isArray(old[n])) {
    const type = text.slice(start + `export const ${n}: `.length, text.indexOf(" = [", start));
    const end = text.indexOf("\n];\n", start) + 4;
    text = text.slice(0, start) + list(n, type, old[n]) + text.slice(end);
    continue;
  }
  const type = text.slice(start + `export const ${n}: `.length, text.indexOf(" = {", start));
  const end = text.indexOf("\n};\n", start) + 4;
  const gen = text.slice(start, end);
  const order = [...gen.matchAll(/^  ("[^"]+"|[^:]+):/gm)].map((m) => (m[1].startsWith('"') ? JSON.parse(m[1]) : m[1]));
  const keys = Object.keys(old[n]);
  const sorted = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))];
  text = text.slice(0, start) + record(n, type, sorted.map((k) => [k, old[n][k]])) + text.slice(end);
}
writeFileSync(file, text);
