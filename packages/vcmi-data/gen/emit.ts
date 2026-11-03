// How the tables are written: one entry per line, so that a fix to one entry is one line of its patch.
const key = (k: string) => (/^(\d+|[A-Za-z_$][\w$]*)$/.test(k) ? k : JSON.stringify(k));

/** `export const NAME: TYPE = {` an entry per line `};` */
export function record(name: string, type: string, entries: [string | number, unknown][]): string {
  return `export const ${name}: ${type} = {\n${entries.map(([k, v]) => `  ${key(String(k))}: ${JSON.stringify(v)},`).join("\n")}\n};\n`;
}

/** The file's header: what it is made from (the generator names its sources). */
export const header = (lines: string[]) => `${lines.map((l) => `// ${l}`).join("\n")}\n// Made by packages/vcmi-data/gen (build.ts); don't edit by hand without build.ts --keep.\n`;

/** `export const NAME: TYPE = [` an item per line `];` */
export function list(name: string, type: string, items: unknown[]): string {
  return `export const ${name}: ${type} = [\n${items.map((v) => `  ${JSON.stringify(v)},`).join("\n")}\n];\n`;
}

/** A list of records, each with one field (`expand`) written an entry per line: a town's buildings. */
export function listOf(name: string, type: string, items: Record<string, unknown>[], expand: string): string {
  const item = (v: Record<string, unknown>) => {
    const { [expand]: inner, ...rest } = v;
    const head = JSON.stringify(rest).slice(1, -1);
    const lines = Object.entries(inner as Record<string, unknown>).map(([k, x]) => `      ${key(k)}: ${JSON.stringify(x)},`);
    return `  {\n    ${head},\n    ${JSON.stringify(expand)}: {\n${lines.join("\n")}\n    },\n  },`;
  };
  return `export const ${name}: ${type} = [\n${items.map(item).join("\n")}\n];\n`;
}
