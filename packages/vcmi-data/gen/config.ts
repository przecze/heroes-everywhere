// One kind of the game's config (heroes, creatures, artifacts, factions, objects...) as VCMI loads it with the HotA mod:
// VCMI's own files (gameConfig.json lists them), then every HotA submod's (its mod.json lists them, under its content
// folder). A mod's "core:name" changes VCMI's entry (objects merged, anything else replaced), a plain name is a new
// entry; "hota.factory:name" likewise changes the entry another submod made. The submods load in path order, the game balance ones last (they adjust the rest), which is what VCMI's
// dependency order comes to for the entries we read.
import type { Upstream } from "./upstream.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * `b` over `a`: objects merged key by key, anything else replaced; an array changed by VCMI's operators ("modify@N",
 * "insert@N", "append", "appendAll") keeps the rest of its items.
 */
export function merge(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) && isObj(b) && Object.keys(b).every((k) => /^(modify@\d+|insert@\d+|append|appendAll)$/.test(k))) {
    const out = [...a];
    for (const [k, v] of Object.entries(b)) {
      const n = Number(k.split("@")[1]);
      if (k.startsWith("modify@")) out[n] = merge(out[n], v);
      else if (k.startsWith("insert@")) out.splice(n, 0, v);
      else if (k === "append") out.push(v);
      else out.push(...(v as unknown[]));
    }
    return out;
  }
  if (!isObj(a) || !isObj(b)) return b;
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k], v) : v;
  return out;
}

/** Every mod.json of the HotA mod (the mod itself and its submods, nested), in load order. */
export function modFiles(up: Upstream): string[] {
  const all = up.list("hota-mod", /^mod\.json$/).filter((p) => !/\/content\//i.test(p));
  const balance = (p: string) => (p.includes("/gameBalance/") ? 1 : 0);
  // A mod before its submods (they depend on it), as VCMI loads them.
  const dir = (p: string) => p.slice(0, -"mod.json".length);
  const order = (a: string, b: string) => (dir(b).startsWith(dir(a)) ? -1 : dir(a).startsWith(dir(b)) ? 1 : a < b ? -1 : 1);
  return all.sort((a, b) => balance(a) - balance(b) || order(a, b));
}

/** A path from a mod.json's list, in the upstream tree (its content folder is "content" or "Content"). */
function resolveIn(up: Upstream, modDir: string, path: string): string | undefined {
  const file = /\.json$/i.test(path) ? path : `${path}.json`;
  for (const c of ["content", "Content"]) {
    const p = `${modDir}/${c}/${file}`;
    if (up.exists(p)) return p;
  }
  return undefined;
}

/** The HotA mod's files of one kind, as its mod.json files list them, in load order. */
export function modConfigFiles(up: Upstream, kind: string, skip?: RegExp): string[] {
  const out: string[] = [];
  for (const m of modFiles(up)) {
    if (skip?.test(m)) continue;
    const list = up.json<Record<string, unknown>>(m)[kind];
    if (!Array.isArray(list)) continue;
    const dir = m.slice(0, -"/mod.json".length);
    for (const p of list) {
      const f = resolveIn(up, dir, p as string);
      if (f) out.push(f);
    }
  }
  return out;
}

export interface Loaded {
  /** name -> merged entry; HotA's entries under their own names, VCMI's under theirs. */
  entries: Map<string, Obj>;
  /** Which files each entry came from (VCMI's first). */
  from: Map<string, string[]>;
}

/** `kind` as VCMI's config plus the HotA mod's (`skip`: leave out the submods whose mod.json path matches). */
export function loadConfig(up: Upstream, kind: string, opts: { mod?: boolean; skip?: RegExp } = {}): Loaded {
  const entries = new Map<string, Obj>(), from = new Map<string, string[]>();
  // An entry's own definition first; another mod's changes to it ("cove:nymph") after, as VCMI applies them.
  const later: [string, Obj][] = [];
  const take = (file: string, data: Obj, deferred = false) => {
    for (const [k, v] of Object.entries(data)) {
      if (!isObj(v)) continue;
      if (!deferred && /^(?!core:)[\w.]+:/.test(k) && !entries.has(k.slice(k.lastIndexOf(":") + 1))) {
        later.push([file, { [k]: v }]);
        continue;
      }
      const name = k.includes(":") ? k.slice(k.lastIndexOf(":") + 1) : k;
      entries.set(name, entries.has(name) ? (merge(entries.get(name), v) as Obj) : v);
      from.set(name, [...(from.get(name) ?? []), file]);
    }
  };
  const game = up.json<Record<string, unknown>>("vcmi/config/gameConfig.json");
  for (const p of (game[kind] as string[] | undefined) ?? []) take(`vcmi/${p}`, up.json(`vcmi/${p}`));
  if (opts.mod !== false) for (const f of modConfigFiles(up, kind, opts.skip)) take(f, up.json(f));
  for (const [f, d] of later) take(f, d, true);
  return { entries, from };
}
