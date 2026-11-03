// The upstream files the tables are made from: VCMI's config and the Horn of the Abyss mod's, each at the commit in
// sources.json. Main keeps them in upstream/ as they are; the open-source release fetches them (fetch.ts) and checks
// each against its sha256 before anything reads it. A generator reads them only through here, so the list of files
// it needs (sources.json "files") is what it actually read.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseVjson, vjsonEntries, type Entries } from "./vjson.ts";

export const ROOT = resolve(import.meta.dirname, "..");
export const UPSTREAM = join(ROOT, "upstream");

export interface Source {
  repo: string;
  sha: string;
  licence: string;
}
export interface Sources {
  vcmi: Source;
  "hota-mod": Source;
  /** "vcmi/config/gameConfig.json" -> sha256 of its bytes. */
  files: Record<string, string>;
}
export const readSources = (): Sources => JSON.parse(readFileSync(join(ROOT, "sources.json"), "utf8"));
export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** What a generator may read; every file it touches is remembered (`read`). */
export class Upstream {
  readonly read = new Set<string>();
  /** Where "vcmi/..." and "hota-mod/..." are: upstream/ itself, or whole checkouts (`build.ts --from`). */
  readonly dirs: Record<string, string>;
  constructor(dirs: Record<string, string> = {}) {
    this.dirs = dirs;
  }
  private file(path: string): string {
    const [top, ...rest] = path.split("/");
    return this.dirs[top] ? join(this.dirs[top], ...rest) : join(UPSTREAM, path);
  }
  text(path: string): string {
    this.read.add(path);
    const f = this.file(path);
    if (!existsSync(f)) throw new Error(`upstream/${path} is missing (node packages/vcmi-data/gen/fetch.ts fetches it)`);
    return readFileSync(f, "utf8");
  }
  /** Whether a file is there (asking doesn't count as reading it). */
  exists(path: string): boolean {
    return existsSync(this.file(path));
  }
  json<T = any>(path: string): T {
    return parseVjson(this.text(path)) as T;
  }
  /** Every entry, a key written twice included, in file order. */
  entries(path: string): Entries {
    return vjsonEntries(this.text(path)) as Entries;
  }
  /** The files under a directory (relative to upstream/) whose names match, sorted. Listing doesn't count as reading. */
  list(dir: string, match: RegExp = /\.json$/i): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      const full = this.file(d);
      if (!existsSync(full)) return;
      for (const e of readdirSync(full, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (match.test(e.name)) out.push(p);
      }
    };
    walk(dir);
    return out;
  }
}
