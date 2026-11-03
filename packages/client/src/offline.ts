// "Play offline": the whole game onto this device (the service worker's caches, sw.js), so a
// single-player game goes on without a connection. The panel says how big each part is, how much
// is here already and about how long the rest takes at the connection's speed, downloads with a
// progress bar counted in bytes as they come (it can be paused and picks up where it stopped; it goes on with the
// window closed, the ☰ tile showing how far), asks the browser to keep it, and can clear it all again (to try the
// game with the network's real delays): a worded button of its own, never the cancel sign that closes windows.
import { voiceReady } from "./feedback/modes.ts";
import { prepareWhisper } from "./feedback/whisper.ts";
import { tr } from "./i18n/index.ts";
import { type PageWindow, pageWindow } from "./chrome/look.ts";
import { cloudWaiting } from "./cloudSaves.ts";
import { waitingNotes } from "./feedback/outbox.ts";
import type { Out as FetchOut } from "./offlineFetch.worker.ts";

interface Item {
  url: string;
  size: number;
  cache: string;
  key: string;
}
interface Part {
  label: string;
  items: Item[];
  on: boolean;
}

const GAME = "heroes-game-files-v1";
const MEDIA = "heroes-media-v1";
const APP = "heroes-app-v1";
/** Files fetched at once: the live site is reached over HTTP/2, many requests share one connection. */
const PARALLEL = 16;
/** The campaigns' videos (the original's, Armageddon's Blade's, Shadow of Death's and HotA's): their scenarios' openings
 * and endings and the campaign screen's. */
const CAMPAIGN_VIDEO = /^(good|evil|neutral|secret)(\d|[a-c]$)|^c(good|evil|neutral|secret)|^cneutral|^h3ab|^h3x1|^h3x2_|^c1|^allin|^factory|^horn\d|^roger|^terror|^mv|^(endgame|birth|elixir|rise|spectre|unholy)$/;

const mb = (n: number) => (n <= 0 ? "0 MB" : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`);
const duration = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

let win: PageWindow | null = null;
/** The window's body (under its head), drawn again as the download goes on. */
let panel: HTMLDivElement | null = null;

/** The download going on (with the window closed too: playing meanwhile), or null. */
interface Job {
  done: number;
  total: number;
  files: number;
  of: number;
  paused: boolean;
}
let job: Job | null = null;
/** The files known to be on this device (kept across the window's openings). */
const here = new Set<string>();
/** The connection's speed, bytes a second: the browser's guess (else 10 Mbit/s) until measured. */
let rate = (((navigator as unknown as { connection?: { downlink?: number } }).connection?.downlink ?? 10) * 1e6) / 8;
/** The last download's files that didn't come in. */
let lastFailed = 0;
/** Told whenever the download moves (the window, the ☰ tile's badge). */
const watchers = new Set<() => void>();
const moved = () => watchers.forEach((f) => f());

/** How far the download is, for the ☰ tile ("37%"), or "" when none is going on. */
export function offlineProgress(): string {
  return job ? `${Math.floor((100 * job.done) / Math.max(1, job.total))}%` : "";
}
export const onOfflineProgress = (f: () => void) => (watchers.add(f), () => watchers.delete(f));

/** The download's thread (offlineFetch.worker.ts), while one goes on. */
let fetcher: Worker | null = null;

function download(todo: Item[]) {
  const j: Job = (job = { done: 0, total: todo.reduce((n, it) => n + it.size, 0), files: 0, of: todo.length, paused: false });
  moved();
  // Kept even when the device runs short of space (where the browser allows).
  void navigator.storage?.persist?.().catch(() => false);
  const started = performance.now();
  fetcher?.terminate();
  const w = (fetcher = new Worker(new URL("./offlineFetch.worker.ts", import.meta.url), { type: "module" }));
  w.onmessage = (e: MessageEvent<FetchOut>) => {
    if (job !== j) return;
    const m = e.data;
    if (m.t === "moved") {
      j.done += m.bytes;
      for (const k of m.kept) here.add(k);
      j.files += m.kept.length;
      const s = (performance.now() - started) / 1000;
      if (s > 1.5) rate = Math.max(1, j.done) / s;
    } else {
      lastFailed = m.failed;
      job = null;
      w.terminate();
      fetcher = null;
    }
    moved();
  };
  w.postMessage({ t: "start", items: todo, parallel: PARALLEL });
}

/** Pauses or resumes the download going on. */
function pause(on: boolean) {
  if (!job) return;
  job.paused = on;
  fetcher?.postMessage({ t: "pause", on });
}

export async function offlinePanel() {
  if (win) return win.close();
  win = pageWindow("optionsPanel offlinePanel", tr("Play offline"), `<div data-body><p class="sub">${tr("Looking at what the game needs…")}</p></div>`, { onClose: () => ((win = null), (panel = null), stop()) });
  let stop = () => {};
  panel = win.box.querySelector<HTMLDivElement>("[data-body]")!;
  if (!("caches" in window) || !navigator.serviceWorker?.controller) {
    panel.querySelector(".sub")!.textContent = tr("This browser can't keep the game (or the page needs one reload first).");
    return;
  }
  let index: { res: { name: string; size: number }[]; maps: { name: string; size: number }[]; music: { name: string; size: number }[]; video: { name: string; size: number }[]; same?: Record<string, string> };
  try {
    index = await (await fetch("/offline-index", { cache: "no-store" })).json();
  } catch {
    panel.querySelector(".sub")!.textContent = tr("No connection: the list of files can't be fetched now.");
    return;
  }
  const at = location.origin;
  // Voice notes heard offline need the speech model on the device (feedback/whisper.ts): fetched now, with the rest.
  if (voiceReady()) void prepareWhisper();
  // The game files' other names (a mod file is asked for by its name or by its path): kept for the service worker,
  // which answers one from the copy kept under the other (sw.js), so each file is downloaded and kept once.
  if (index.same) await caches.open(GAME).then((c) => c.put(`${at}/__res-same`, new Response(JSON.stringify(index.same), { headers: { "content-type": "application/json" } }))).catch(() => {});
  // The app's own files (scripts, styles, workers): small, but some load only when first needed.
  // With the lists the menus read (the scenarios, the maps), so New Game shows them offline too.
  const appFiles = [...((await fetch("/app-files.json").then((r) => (r.ok ? r.json() : [])).catch(() => [])) as string[]), "maps-info", "maps-index"].map((f) => ({ url: `/${f}`, size: 0, cache: APP, key: `${at}/${f}` }));
  // (Each name once: the original's and HotA's archives may both hold one.)
  const video = [...new Map(index.video.map((v) => [v.name, { url: `/video/${v.name}.webm`, size: v.size, cache: MEDIA, key: `${at}/video/${v.name}.webm` }])).values()];
  const parts: Part[] = [
    { label: tr("The app (scripts and styles)"), on: true, items: appFiles },
    { label: tr("Game files (graphics, sounds, texts)"), on: true, items: index.res.map((r) => ({ url: `/res/${encodeURIComponent(r.name)}`, size: r.size, cache: GAME, key: `${at}/res/${encodeURIComponent(r.name)}` })) },
    { label: tr("Maps"), on: true, items: index.maps.map((m) => ({ url: `/maps/${encodeURIComponent(m.name)}`, size: m.size, cache: GAME, key: `${at}/maps/${encodeURIComponent(m.name)}` })) },
    { label: tr("Music"), on: true, items: index.music.map((m) => ({ url: `/music/${encodeURIComponent(m.name)}`, size: m.size, cache: MEDIA, key: `${at}/music/${encodeURIComponent(m.name)}` })) },
    // The videos of a game (the intro, the tavern, a game won or lost...) apart from the campaigns' (2026-10-26: not
    // those until he plays a campaign).
    { label: tr("Videos of a game (intro, tavern, victory and defeat)"), on: true, items: video.filter((v) => !CAMPAIGN_VIDEO.test(v.url.slice(7, -5))) },
    { label: tr("Campaign videos"), on: false, items: video.filter((v) => CAMPAIGN_VIDEO.test(v.url.slice(7, -5))) },
  ];
  // The parts chosen last time (music left out stays out).
  try {
    const chosen = JSON.parse(localStorage.getItem("heroes.offlineParts") ?? "null") as boolean[] | null;
    if (Array.isArray(chosen) && chosen.length === parts.length) chosen.forEach((on, i) => (parts[i].on = !!on));
  } catch {
    // no storage: the defaults
  }
  // What's here already.
  const caches_: Record<string, Cache> = { [GAME]: await caches.open(GAME), [MEDIA]: await caches.open(MEDIA), [APP]: await caches.open(APP) };
  // (Many lookups at once: tens of thousands one by one kept the panel waiting, and a whole
  // listing, Cache.keys(), is "too large" for Chrome once the game files are in.)
  const all = parts.flatMap((p) => p.items);
  if (!job)
    for (let i = 0; i < all.length; i += 500)
      await Promise.all(all.slice(i, i + 500).map(async (it) => (await caches_[it.cache].match(it.key)) && here.add(it.key)));
  if (!panel) return;

  const render = () => {
    if (!panel) return;
    const wanted = parts.filter((p) => p.on).flatMap((p) => p.items);
    const total = wanted.reduce((n, it) => n + it.size, 0);
    const missing = wanted.filter((it) => !here.has(it.key)).reduce((n, it) => n + it.size, 0);
    // Each part a row: its check box, its name, its size and how much of it is here.
    const rows = parts
      .map((p, i) => {
        const size = p.items.reduce((n, it) => n + it.size, 0);
        const got = p.items.filter((it) => here.has(it.key)).reduce((n, it) => n + it.size, 0);
        const all = p.items.every((it) => here.has(it.key));
        return `<label class="part${all ? " all" : ""}"><input type="checkbox" data-part="${i}" ${p.on ? "checked" : ""} ${job ? "disabled" : ""}><span class="name">${p.label}</span><span class="size">${all ? "✓ " : ""}${size ? mb(size) : ""}${got && !all ? `<br><small>${tr("%1 here", mb(got))}</small>` : ""}</span></label>`;
      })
      .join("");
    const pct = job ? Math.floor((100 * job.done) / Math.max(1, job.total)) : total ? Math.floor((100 * (total - missing)) / total) : 0;
    const line = job
      ? tr("%1 of %2 · %3 / %4 files · %5/s · about %6 left", mb(job.done), mb(job.total), job.files, job.of, mb(rate), duration((job.total - job.done) / rate))
      : missing
        ? tr("Selected %1, still to fetch %2: about %3 at %4/s.", mb(total), mb(missing), duration(missing / rate), mb(rate))
        : tr("All here");
    const goIco = job ? (job.paused ? "play" : "pause") : missing ? "down" : "ok";
    // The button and its bar first, under the one line saying what it is; then what goes onto the device.
    panel.innerHTML = `<p class="sub">${tr("The whole game on this device: a single-player game then goes on without a connection (notes wait for it). It stays through updates.")}</p>
      <div class="go"><button data-go data-ico="${goIco}" ${!job && !missing ? "disabled" : ""}>${job ? (job.paused ? tr("Resume") : tr("Pause")) : missing ? tr("Download") : tr("All here")}</button>
        <div class="meter"><div class="bar"><div style="width:${pct}%"></div></div><p class="sub">${line}</p></div></div>
      ${!job && lastFailed ? `<p class="sub warn">${tr("%1 files didn't come in: Download tries them again.", lastFailed)}</p>` : ""}
      ${job ? `<p class="sub">${tr("It goes on while you play: ☰ → Play offline shows how far it is.")}</p>` : ""}
      <div class="parts">${rows}</div>
      <p class="sub" data-store></p>
      <p class="sub" data-wait></p>
      <div class="danger"><button data-clear data-ico="remove" ${job ? "disabled" : ""}>${tr("Clear the download")}</button></div>`;
    panel.querySelectorAll<HTMLInputElement>("[data-part]").forEach((x) => (x.onchange = () => {
          parts[Number(x.dataset.part)].on = x.checked;
          try {
            localStorage.setItem("heroes.offlineParts", JSON.stringify(parts.map((p) => p.on)));
          } catch {
            // not remembered
          }
          render();
        }));
    panel.querySelector<HTMLElement>("[data-go]")!.onclick = () => {
      if (job) return void (pause(!job.paused), render());
      const todo = parts.filter((p) => p.on).flatMap((p) => p.items).filter((it) => !here.has(it.key));
      if (todo.length) void download(todo);
    };
    panel.querySelector<HTMLElement>("[data-clear]")!.onclick = async () => {
      if (!window.confirm(tr("Remove the game's files from this device? (They come back as you play, from the network.)"))) return;
      await Promise.all([caches.delete(GAME), caches.delete(MEDIA)]);
      here.clear();
      lastFailed = 0;
      caches_[GAME] = await caches.open(GAME);
      caches_[MEDIA] = await caches.open(MEDIA);
      render();
    };
    // What was made offline and goes up with the connection: the games (for the other devices) and notes.
    void Promise.all([cloudWaiting(), waitingNotes()]).then(([games, notes]) => {
      const el = panel?.querySelector("[data-wait]");
      if (!el) return;
      const parts = [navigator.onLine ? "" : tr("No connection now: the game plays from this device."), games || notes ? tr("Waiting to go up when the connection is back: games %1, notes %2.", games, notes) : ""];
      el.textContent = parts.filter(Boolean).join(" ");
    });
    void navigator.storage?.estimate?.().then((e) => {
      const el = panel?.querySelector("[data-store]");
      if (el && e.quota) el.textContent = tr("This browser lets the game use %1; %2 used now.", mb(e.quota), mb(e.usage ?? 0));
    });
  };
  // While it downloads only the bar and its line move (the rest drawn again when it starts, pauses or ends).
  let was = job;
  let wasPaused = job?.paused;
  stop = onOfflineProgress(() => {
    if (!panel) return;
    if (job !== was || job?.paused !== wasPaused) return void ((was = job), (wasPaused = job?.paused), render());
    const bar = panel.querySelector<HTMLElement>(".bar div");
    const line = panel.querySelector<HTMLElement>(".meter .sub");
    if (job && bar && line) {
      bar.style.width = `${Math.floor((100 * job.done) / Math.max(1, job.total))}%`;
      line.textContent = tr("%1 of %2 · %3 / %4 files · %5/s · about %6 left", mb(job.done), mb(job.total), job.files, job.of, mb(rate), duration((job.total - job.done) / rate));
    }
  });
  render();
}
