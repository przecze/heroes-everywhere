// A page whose browser storage must stay apart from the game's usual one on this address: a branch
// preview (previewBuild.ts) and the owner playing as a player (asTesterMode.ts). Its localStorage
// keys and IndexedDB databases that `mine` picks are kept under `prefix`; the others stay shared.
// Import its users first: everything after them sees only the view.

/** The prefixes of storage kept apart (never shown to another page as its own). */
const APART = /^(preview:[\w.-]+|astester):/;

export function keepApart(prefix: string, mine: (key: string) => boolean, mineDb: (name: string) => boolean) {
  const own = (k: string) => (mine(k) ? prefix + k : k);
  try {
    const real = window.localStorage;
    const keys = () => Object.keys(real).flatMap((k) => (k.startsWith(prefix) ? [k.slice(prefix.length)] : APART.test(k) || mine(k) ? [] : [k]));
    const api = {
      getItem: (k: string) => real.getItem(own(k)),
      setItem: (k: string, v: string) => real.setItem(own(k), String(v)),
      removeItem: (k: string) => real.removeItem(own(k)),
      clear: () => keys().forEach((k) => real.removeItem(own(k))),
      key: (i: number) => keys()[i] ?? null,
    };
    // A Proxy, so `Object.keys(localStorage)` and `localStorage[key]` see the view too, as with the real one.
    const view = new Proxy(api, {
      get: (t, p) => (p === "length" ? keys().length : typeof p === "string" && !(p in t) ? api.getItem(p) ?? undefined : Reflect.get(t, p)),
      set: (t, p, v) => (typeof p === "string" && !(p in t) ? (api.setItem(p, v), true) : false),
      deleteProperty: (_t, p) => (typeof p === "string" && api.removeItem(p), true),
      ownKeys: () => keys(),
      getOwnPropertyDescriptor: (_t, p) => (typeof p === "string" && keys().includes(p) ? { value: api.getItem(p), enumerable: true, configurable: true, writable: true } : undefined),
      has: (t, p) => p in t || (typeof p === "string" && keys().includes(p)),
    });
    Object.defineProperty(window, "localStorage", { value: view, configurable: true });
  } catch {
    // no storage here: the game copes without
  }
  try {
    const real = window.indexedDB;
    const name = (n: string) => (mineDb(n) ? prefix + n : n);
    const view = {
      open: (n: string, v?: number) => real.open(name(n), v),
      deleteDatabase: (n: string) => real.deleteDatabase(name(n)),
      cmp: (a: unknown, b: unknown) => real.cmp(a, b),
    };
    Object.defineProperty(window, "indexedDB", { value: view, configurable: true });
  } catch {
    // ditto
  }
}

/** Forgets everything kept under `prefix` (from a page that sees the real storage). */
export async function dropApart(prefix: string) {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k);
  } catch {
    // no storage
  }
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs
        .filter((d) => d.name?.startsWith(prefix))
        .map((d) => new Promise<void>((done) => {
          const r = indexedDB.deleteDatabase(d.name!);
          r.onsuccess = r.onerror = r.onblocked = () => done();
        })),
    );
  } catch {
    // none
  }
}
