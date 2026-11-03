// "Play offline"'s download (offline.ts) on a thread of its own: fetched here and put straight into the service
// worker's caches. On the page's own thread every file waited for the game's drawing (the main menu, a map): about
// 10 files a second, 35 minutes and more for the game's 20,000 files on any connection; here a few hundred a second.
// The page is told how far it is a few times a second; it pauses, resumes and stops the download.

interface Item {
  url: string;
  size: number;
  cache: string;
  key: string;
}
type In = { t: "start"; items: Item[]; parallel: number } | { t: "pause"; on: boolean };
/** Bytes come in (`bytes`, taken back for a file that fails), files kept (`kept`, their keys); `end` with those that didn't come in. */
export type Out = { t: "moved"; bytes: number; kept: string[] } | { t: "end"; failed: number };

let paused = false;
let bytes = 0;
let kept: string[] = [];
let timer = 0;
const flush = () => {
  timer = 0;
  if (!bytes && !kept.length) return;
  postMessage({ t: "moved", bytes, kept } satisfies Out);
  bytes = 0;
  kept = [];
};
const count = (n: number) => {
  bytes += n;
  timer ||= setTimeout(flush, 250) as unknown as number;
};

/** Only real files: never the gate's "no access" page, a 404 or a partial answer (as sw.js keeps them). */
const cacheable = (res: Response) => res.status === 200 && !(res.headers.get("content-type") ?? "").startsWith("text/html");

const open = new Map<string, Promise<Cache>>();
const cacheOf = (name: string) => {
  let c = open.get(name);
  if (!c) open.set(name, (c = caches.open(name)));
  return c;
};

/** One file read as it comes, each piece counted at once, then kept; a file that sends nothing for 30 s is given up (the train's "connected" that carries nothing). */
async function fetchOne(it: Item): Promise<boolean> {
  const ctl = new AbortController();
  let quiet = setTimeout(() => ctl.abort(), 30_000);
  const poke = () => (clearTimeout(quiet), (quiet = setTimeout(() => ctl.abort(), 30_000)));
  let got = 0;
  try {
    // (x-heroes-direct: the service worker lets it through to the network, it is kept here; x-heroes-download for an
    // older service worker, which keeps it itself.)
    const res = await fetch(it.url, { headers: { "x-heroes-direct": "1", "x-heroes-download": "1" }, signal: ctl.signal });
    // (An older service worker answers "already kept" itself.)
    if (res.status === 204) return true;
    if (!cacheable(res) || !res.body) return false;
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      poke();
      parts.push(value);
      got += value.byteLength;
      // (Never past the file's listed size: a compressed answer can differ.)
      const n = Math.max(0, Math.min(value.byteLength, it.size - (got - value.byteLength)));
      if (n) count(n);
    }
    const headers = new Headers();
    for (const h of ["content-type", "content-length"]) if (res.headers.get(h) && !(h === "content-length" && res.headers.get("content-encoding"))) headers.set(h, res.headers.get(h)!);
    await (await cacheOf(it.cache)).put(it.key, new Response(new Blob(parts as BlobPart[]), { status: 200, headers }));
    return true;
  } catch {
    // offline meanwhile, or a file the server lost: tried again at the end, else left for the next Download
    return false;
  } finally {
    clearTimeout(quiet);
    // (What it counted is taken back; a file kept is counted whole once.)
    count(-Math.min(got, it.size));
  }
}

async function run(list: Item[], parallel: number, missed: Item[]) {
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      // (The connection gone meanwhile: it waits for it, as a pause does.)
      while (paused || !navigator.onLine) await new Promise((r) => setTimeout(r, 300));
      const it = list[next++];
      if (!it) return;
      if (await fetchOne(it)) {
        count(it.size);
        kept.push(it.key);
      } else missed.push(it);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
}

onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.t === "pause") return void (paused = m.on);
  const missed: Item[] = [];
  await run(m.items, m.parallel, missed);
  // A second go at the ones that didn't come in (a moment's drop in the connection).
  const still: Item[] = [];
  if (missed.length) await run(missed, m.parallel, still);
  clearTimeout(timer);
  flush();
  postMessage({ t: "end", failed: still.length } satisfies Out);
};
