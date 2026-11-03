// Keeps the original game files (/res/: images, sprites, sounds, text tables; /maps/; a language's own, /l10n/) on the
// device once fetched, so the game starts fast and uses no data the second time; music and videos
// too, after their first play. "Play offline" (src/offline.ts) fetches all of them ahead on a worker of its own and
// puts them into these caches itself (x-heroes-direct: let through).
// The app itself comes from the network when there is one (new builds show up at once) and from
// its last copy when there isn't, so a single-player game goes on without a connection. The game
// files don't change with a new build: the download stays.
const CACHE = "heroes-game-files-v1";
const MEDIA = "heroes-media-v1";
const APP = "heroes-app-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/** Only real files: never the gate's "no access" page, a 404 or a partial answer. */
const cacheable = (res) => res.status === 200 && !(res.headers.get("content-type") ?? "").startsWith("text/html");

/** The app's own files and lists: network first, the last copy when offline. */
const APP_PATHS = /^\/(|index\.html|app-files\.json|manifest\.webmanifest|icon.*|apple-touch-icon\.png|maps-info|maps-index|offline-index|sw\.js)$/;

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // The server's own pages and calls (/__review, /__admin...): never kept, never the game's page.
  if (url.pathname.startsWith("/__")) return;
  // The page asking what is live (src/feedback/build.ts checkBuild): the network's own answer or none, never the kept copy.
  if (e.request.headers.get("x-heroes-live")) return;
  // "Play offline"'s download (src/offlineFetch.worker.ts): straight to the network, it keeps the file itself.
  if (e.request.headers.get("x-heroes-direct")) return;
  // A branch preview (/b/<branch>/, previewApi.ts) is its own page: never kept as the game's.
  if (url.pathname.startsWith("/b/")) return;
  if (url.pathname.startsWith("/music/") || url.pathname.startsWith("/video/")) {
    if (e.request.headers.get("x-heroes-download")) return e.respondWith(keep(MEDIA, url.origin + url.pathname, e.request, e));
    return e.respondWith(media(e, url));
  }
  // Built files have their content's hash in their names: kept ones never change, so an update
  // fetches only what's new (the page, and the scripts and styles that changed).
  if (url.pathname.startsWith("/assets/")) return e.respondWith(keepFirst(e.request, url));
  if (e.request.mode === "navigate" || APP_PATHS.test(url.pathname)) return e.respondWith(app(e.request, url));
  // (And a language's own files beside them, /l10n/: a Russian player's text files and fonts, the packs' buttons.)
  if (!url.pathname.startsWith("/res/") && !url.pathname.startsWith("/maps/") && !url.pathname.startsWith("/l10n/")) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      // Kept under another of its names (offline.ts: each file downloaded once).
      const alias = url.pathname.startsWith("/res/") && (await sameName(cache, decodeURIComponent(url.pathname.slice(5))));
      const other = alias && (await cache.match(url.origin + "/res/" + encodeURIComponent(alias)));
      if (other) return other;
      const res = await fetch(e.request);
      // (Kept while the page reads it too.)
      if (cacheable(res)) e.waitUntil(cache.put(e.request, res.clone()).catch(() => {}));
      return res;
    }),
  );
});

/** The game files' other names (offline.ts keeps the server's list), read once. */
let same = null;
async function sameName(cache, name) {
  if (!same) same = await cache.match(self.location.origin + "/__res-same").then((r) => (r ? r.json() : null)).catch(() => null);
  return same?.[name.toLowerCase()];
}

/** How long the network gets before the kept copy answers (a train's "connected" that carries nothing). */
const PATIENCE = 4000;

/**
 * The app: the network's answer (kept for next time), else the kept one (the page for any
 * navigation). A network that doesn't answer within PATIENCE gets the kept copy too; its late
 * answer still replaces the kept one for next time.
 */
async function app(request, url) {
  const cache = await caches.open(APP);
  const key = request.mode === "navigate" ? "/" : url.pathname + url.search;
  const net = fetch(request).then(async (res) => {
    if (res.status === 200 && (request.mode !== "navigate" || (res.headers.get("content-type") ?? "").includes("html"))) {
      await cache.put(key, res.clone());
    }
    return res;
  });
  const kept = async () => {
    const hit = await cache.match(key);
    // The page asks (src/feedback/build.ts) whether the stored copy opened it: it may be an older build than the live one.
    if (hit && request.mode === "navigate") await cache.put("/__from-cache", new Response(String(Date.now()))).catch(() => {});
    return hit;
  };
  // Known to be offline: the kept copy at once.
  if (self.navigator.onLine === false) {
    const hit = await kept();
    if (hit) return (net.catch(() => {}), hit);
  }
  let timer;
  const slow = new Promise((resolve) => (timer = setTimeout(resolve, PATIENCE)));
  try {
    const first = await Promise.race([net, slow]);
    if (first) {
      // A new build: the files it no longer uses go. (Not when the kept page answered: it may still need them.)
      if (request.mode === "navigate" && first.status === 200) prune(cache).catch(() => {});
      return first;
    }
    const hit = await kept();
    if (hit) return (net.catch(() => {}), hit);
    return await net;
  } catch (err) {
    const hit = await kept();
    if (hit) return hit;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Drops kept built files that the live build doesn't list (app-files.json) any more. */
async function prune(cache) {
  const res = await fetch("/app-files.json", { cache: "no-store" });
  if (!res.ok) return;
  const live = new Set((await res.json()).map((f) => `/${f}`));
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/assets/") && !live.has(path)) await cache.delete(req);
  }
}

/** A built file: the kept copy, else the network's (kept). */
async function keepFirst(request, url) {
  const cache = await caches.open(APP);
  const hit = await cache.match(url.pathname);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.status === 200) await cache.put(url.pathname, res.clone());
  return res;
}

/** A download for "Play offline": fetched whole and kept (unless already there). */
async function keep(name, key, request, e) {
  const cache = await caches.open(name);
  const hit = await cache.match(key);
  if (hit) return new Response(null, { status: 204 });
  const res = await fetch(request.url);
  // Kept as it comes, not first whole: the page counts the bytes as they arrive (a big video moved its bar only at
  // its end, "Download got stuck here": the owner, 2026-10-27).
  if (cacheable(res)) e.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  return res;
}

/** Pending whole-file downloads, so a track's many range requests start only one. */
const downloading = new Set();

/**
 * Music and videos: <audio> and <video> ask for byte ranges. A cached file answers them itself;
 * otherwise the network does, and the whole file is fetched once in the background for next time.
 */
async function media(e, url) {
  const key = url.origin + url.pathname;
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(key);
  if (!hit) {
    if (!downloading.has(key)) {
      downloading.add(key);
      e.waitUntil(
        fetch(key)
          .then((res) => (cacheable(res) ? cache.put(key, res) : undefined))
          .catch(() => {})
          .finally(() => downloading.delete(key)),
      );
    }
    return fetch(e.request);
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(e.request.headers.get("range") ?? "");
  if (!range) return hit;
  const body = await hit.arrayBuffer();
  const size = body.byteLength;
  // "bytes=-N" is the last N bytes; "bytes=N-" runs to the end.
  const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
  const end = range[1] !== "" && range[2] !== "" ? Math.min(size - 1, Number(range[2])) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      "content-type": hit.headers.get("content-type") ?? "application/octet-stream",
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
    },
  });
}

// ---- notifications (push.ts): a push carries nothing; what to show waits in /__push/inbox (the
// device's cookie says whose). A button with `post` calls it from the notification itself (the
// owner's "Send to the agent"); a tap opens the message's page.
self.addEventListener("push", (e) => {
  e.waitUntil(
    (async () => {
      let waiting = [];
      try {
        const sub = await self.registration.pushManager.getSubscription();
        waiting = await (await fetch(`/__push/inbox?endpoint=${encodeURIComponent(sub?.endpoint ?? "")}`, { cache: "no-store" })).json();
      } catch {
        // nothing to read: a plain notification still says something came
      }
      if (!waiting.length) waiting = [{ title: "Heroes", body: "Something new is waiting.", url: "/" }];
      for (const m of waiting)
        await self.registration.showNotification(m.title, {
          body: m.body ?? "",
          tag: m.tag,
          renotify: !!m.tag,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          ...(m.image ? { image: m.image } : {}),
          data: { url: m.url ?? "/", actions: m.actions ?? [] },
          actions: (m.actions ?? []).map((a) => ({ action: a.action, title: a.title })),
        });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const { url = "/", actions = [] } = e.notification.data ?? {};
  const chosen = actions.find((a) => a.action === e.action);
  e.waitUntil(
    (async () => {
      if (chosen?.post) {
        const r = await fetch(chosen.post, { method: "POST", headers: { accept: "application/json" } }).catch(() => null);
        if (r?.ok) return self.registration.showNotification(chosen.done ?? "Done ✓", { tag: e.notification.tag, icon: "/icon-192.png", silent: true });
      }
      const target = new URL(url, self.location.origin).href;
      const open = (await self.clients.matchAll({ type: "window" })).find((c) => c.url === target);
      return open ? open.focus() : self.clients.openWindow(target);
    })(),
  );
});
