// Whether this server has HotA's own content to draw (the HotA mod's files: its towns, creatures, objects). A server
// without it (the open-source release started from the original game alone) plays without HotA's content by
// itself: random maps are made without it and the New Game screens start with it off, locked.
/** A file only the HotA mod has (Bulwark's Yeti dwelling). */
const PROBE = "/res/avgyeti0.def";
/** The service worker's cache of game files (public/sw.js). */
const GAME_CACHE = "heroes-game-files-v1";
let there: boolean | undefined;
let asked: Promise<boolean> | undefined;

/** Asks the server once (offline or unsure: assumed there, as on every server so far). Missing: the HotA files this
 *  browser kept from before (the server had them once) are let go first, so nothing of HotA's is drawn from them. */
export function hotaContentThere(): Promise<boolean> {
  return (asked ??= fetch(PROBE, { method: "HEAD", cache: "no-store" })
    .then(async (r) => {
      there = r.status !== 404;
      if (!there) await forgetGone();
      return there;
    })
    .catch(() => (there = true)));
}
void hotaContentThere();

/** Known to be missing (the answer came, and it was no). */
export const hotaContentMissing = () => there === false;

/** Drops the kept game files the server no longer has (its HotA files taken out), when the probe file is kept. */
async function forgetGone() {
  try {
    if (!("caches" in window) || !(await caches.has(GAME_CACHE))) return;
    const cache = await caches.open(GAME_CACHE);
    if (!(await cache.match(PROBE))) return;
    const list = (await (await fetch("/res-index", { cache: "no-store" })).json()) as { name: string }[];
    const names = new Set(list.map((e) => e.name.toLowerCase()));
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (!path.startsWith("/res/")) continue;
      if (!names.has(decodeURIComponent(path.slice(5)).toLowerCase())) await cache.delete(req);
    }
  } catch {
    // (Not this time: the next start tries again.)
  }
}
