// Carrying a game over to another device: the running game goes up to the server (savesApi.ts) as
// this device's "current" slot, a little after each change, and saved games go up beside it. On
// another device the map page offers the newest running game it doesn't have yet ("Continue the
// game from <device>?"), also when the page comes back into view, and the load window lists the
// saved games of every device. Without the server's store (an older server, offline) nothing shows;
// what was played or saved offline goes up when the connection is back (put, flushCloud).
import { type AdventureState, isSceneFile } from "@heroes/core";
import { type GameSummary, summarize } from "./gameSummary.ts";
import { tr, type Text } from "./i18n/index.ts";
import { movedDb } from "./movedDb.ts";

export interface CloudMeta {
  slot: string;
  /** The device it came from (its own name for itself). */
  device: string;
  deviceId: string;
  /** The game's name: its map's, or the saved game's. */
  name: string;
  mapFile: string;
  day: number;
  savedAt: number;
  /** How many people play it (hot seat: more than one; older saves don't say). */
  humans?: number;
  /** Marked kept in "my games". */
  kept?: boolean;
  /** Colour, town, strongest hero and latest events, for "Your games" (older saves have none). */
  summary?: GameSummary;
  /** A running game's id (its state's), and whether it has ended (older uploads don't say). */
  game?: number;
  over?: boolean;
}

/** This device: a short id and a readable name (tr("Android phone"), "Mac"...), kept in the browser. */
export function thisDevice(): { id: string; name: string } {
  let id = "";
  try {
    id = localStorage.getItem("heroes.device") ?? "";
    if (!id) localStorage.setItem("heroes.device", (id = Math.random().toString(36).slice(2, 8)));
  } catch {
    id ||= "anon";
  }
  const ua = navigator.userAgent;
  const name = /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : tr("Android tablet")) : /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : /Linux/.test(ua) ? "Linux PC" : "browser";
  return { id, name };
}

const humansIn = (s: AdventureState) => s.players.filter((p) => p.controller === "human").length;

/** Marks a game on the server kept (or not) for "my games". */
export const keepCloud = (slot: string, kept: boolean) => fetch(`/__saves/${encodeURIComponent(slot)}?kept=${kept ? 1 : 0}`, { method: "PATCH" }).then((r) => r.ok);

/**
 * "My games" shows a single-player game when it's worth coming back to: marked kept, played with
 * someone else (hot seat), or past its first week; the rest (quick tries, tests) only on asking.
 */
export const worthKeeping = (m: CloudMeta) => !!m.kept || (m.humans ?? 1) > 1 || m.day > 7;

/**
 * Sends one slot up. Without a connection (or with the server down a while) it waits in the browser
 * (IndexedDB, the latest per slot) and goes when the connection is back: a game played on the
 * U-Bahn reaches the other devices. True once the server has it.
 */
async function put(slot: string, meta: Omit<CloudMeta, "slot">, state: AdventureState, keepalive = false): Promise<boolean> {
  const sent = await send(slot, meta, state, keepalive);
  if (sent === "later") await waitingPut("readwrite", (s) => s.put({ slot, meta, state } satisfies Waiting)).catch(() => {});
  else await forget(slot, meta.savedAt);
  return sent === "sent";
}

/** "later": no connection, or a passing trouble (the gate, a 5xx); "refused": not worth trying again. */
async function send(slot: string, meta: Omit<CloudMeta, "slot">, state: AdventureState, keepalive = false): Promise<"sent" | "later" | "refused"> {
  if (navigator.onLine === false) return "later";
  try {
    const body = JSON.stringify({ meta, state });
    // (Outliving the page when it's closed: browsers allow that only for a small request.)
    const r = await fetch(`/__saves/${slot}`, { method: "PUT", headers: { "content-type": "application/json" }, body, keepalive: keepalive && body.length < 60_000 });
    return r.ok ? "sent" : r.status >= 500 || [401, 403, 408, 429].includes(r.status) ? "later" : "refused";
  } catch {
    return "later";
  }
}

interface Waiting {
  slot: string;
  meta: Omit<CloudMeta, "slot">;
  state: AdventureState;
}

function waitingPut<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return movedDb("heroes-cloud-out").then(() => new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("heroes-cloud-out", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("out", { keyPath: "slot" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  })).then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction("out", mode).objectStore("out"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.transaction!.oncomplete = () => d.close();
      }),
  );
}

/** Drops the waiting copy of a slot once it (or a newer one) went up. */
async function forget(slot: string, savedAt: number) {
  const w = (await waitingPut("readonly", (s) => s.get(slot)).catch(() => undefined)) as Waiting | undefined;
  if (w && w.meta.savedAt <= savedAt) await waitingPut("readwrite", (s) => s.delete(slot)).catch(() => {});
}

/** How many games wait to go up. */
export const cloudWaiting = (): Promise<number> => waitingPut("readonly", (s) => s.count()).catch(() => 0);

let flushing = false;
/** Sends what waits (the connection is back); stops at the first that can't go. */
export async function flushCloud() {
  if (flushing || navigator.onLine === false) return;
  flushing = true;
  try {
    const all = (await waitingPut("readonly", (s) => s.getAll()).catch(() => [])) as Waiting[];
    for (const w of all) {
      const sent = await send(w.slot, w.meta, w.state);
      if (sent === "later") break;
      await forget(w.slot, w.meta.savedAt);
      if (sent === "sent" && w.slot === `current-${w.meta.deviceId}`) sentAt = Math.max(sentAt, w.meta.savedAt);
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined" && typeof indexedDB !== "undefined") {
  addEventListener("online", () => void flushCloud());
  setInterval(() => void flushCloud(), 60_000);
  setTimeout(() => void flushCloud(), 3000);
}

/** When this device last sent its running game (so its own isn't offered back to it as newer). */
let sentAt = 0;
let pending: { state: AdventureState; name: string } | null = null;
let timer = 0;

/** The running game changed: sends it a few seconds later (the latest one wins). */
export function pushCurrent(state: AdventureState, name: string) {
  if (isSceneFile(state.mapFile)) return;
  pending = { state, name };
  if (!timer) timer = window.setTimeout(sendCurrent, 4000);
}

/** Sends the running game's latest change now (at once when the page is put away). */
function sendCurrent(away = false) {
  clearTimeout(timer);
  timer = 0;
  const p = pending;
  pending = null;
  if (!p) return;
  const d = thisDevice();
  const at = Date.now();
  const slot = `current-${d.id}`;
  const meta = { device: d.name, deviceId: d.id, name: p.name, mapFile: p.state.mapFile, day: p.state.day, savedAt: at, humans: humansIn(p.state), summary: summarize(p.state), game: p.state.id, over: p.state.winner !== undefined };
  // Put away (the phone laid down, the tab closed): it waits in the browser too, in case the page is
  // stopped before it's sent (it goes up the next time the game is opened here).
  if (away) void waitingPut("readwrite", (s) => s.put({ slot, meta, state: p.state } satisfies Waiting)).catch(() => {});
  void put(slot, meta, p.state, away)
    .then((ok) => ok && (sentAt = at))
    .catch(() => {});
}

// The device put down at any moment, mid-battle too: the last move goes up before the page sleeps.
if (typeof window !== "undefined") {
  addEventListener("visibilitychange", () => document.visibilityState === "hidden" && sendCurrent(true));
  addEventListener("pagehide", () => sendCurrent(true));
}

/** A saved game goes up too (by its name: saving it again replaces it). */
export function pushSave(name: string, state: AdventureState) {
  const d = thisDevice();
  const slot = `save-${d.id}-${name.replace(/[^\w-]+/g, "_").slice(0, 60)}`;
  void put(slot, { device: d.name, deviceId: d.id, name, mapFile: state.mapFile, day: state.day, savedAt: Date.now(), humans: humansIn(state), summary: summarize(state) }, state).catch(() => {});
}

/** Every device's games on the server (empty when there's no store). */
export async function cloudList(timeoutMs = 2500): Promise<CloudMeta[]> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch("/__saves", { cache: "no-store", signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return [];
    const list = (await r.json()) as CloudMeta[];
    // (A device's running test scene, sent before scenes were left out, isn't a game going on.)
    return Array.isArray(list) ? list.filter((m) => !(m.slot.startsWith("current-") && isSceneFile(m.mapFile))) : [];
  } catch {
    return [];
  }
}

/** One slot's game (`timeoutMs`: given up after that, undefined; a game being opened never waits forever). */
export async function cloudLoad(slot: string, timeoutMs = 30_000): Promise<AdventureState | undefined> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`/__saves/${encodeURIComponent(slot)}`, { cache: "no-store", signal: ctl.signal });
    if (!r.ok) return undefined;
    return ((await r.json()) as { state?: AdventureState }).state;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Another device's running game newer than what this one has: the newest "current" slot from a
 * different device, saved after `localAt` (when this device last played) and after this device's
 * own last upload. Its state comes along (a few seconds at most: on a slow or missing connection,
 * none). What it is to this device:
 * - "newer": the game going on here, played further there (this device takes it up without asking; a copy
 *   that's newer but not further, the same game gone two ways, is asked about as "other");
 * - "over": the game going on here, finished there (this device's copy is stale: it goes);
 * - "other": another game (offered).
 * A finished game of another kind isn't offered at all.
 */
export interface Elsewhere {
  kind: "newer" | "over" | "other";
  meta: CloudMeta;
  state: AdventureState;
}
export async function elsewhere(local: Pick<AdventureState, "id" | "mapFile" | "day"> | null | undefined, localAt: number): Promise<Elsewhere | null> {
  const me = thisDevice().id;
  const list = await cloudList();
  const meta = list.find((m) => m.slot.startsWith("current-") && m.deviceId !== me);
  if (!meta || meta.savedAt <= Math.max(localAt, sentAt)) return null;
  const same = (s: { game?: number; id?: number; mapFile: string }) => !!local && (s.game ?? s.id) === local.id && s.mapFile === local.mapFile;
  // (Known from the list alone: a finished game of another kind, not worth fetching.)
  if (meta.over && !(meta.game === undefined || same(meta))) return null;
  const state = await cloudLoad(meta.slot, 8000).catch(() => undefined);
  if (!state) return null;
  const mine = same(state);
  if (state.winner !== undefined) return mine ? { kind: "over", meta, state } : null;
  return { kind: mine && state.day >= local!.day ? "newer" : "other", meta, state };
}

/** This device's running game is stale (finished on another device): it's forgotten here, not offered again. */
export function forgetLocal() {
  try {
    localStorage.removeItem("heroes.adv.v1");
    localStorage.setItem(PLAYED_AT, String(Date.now()));
  } catch {
    // (No storage: nothing kept to forget.)
  }
}

/** When this device last played its running game (the map page keeps it): another device's newer one is offered over it. */
export const PLAYED_AT = "heroes.adv.at";

/** "5 min ago" and the like, in the interface's language. */
export function ago(at: number): Text {
  const ms = Date.now() - at;
  return ms < 90_000 ? tr("just now") : ms < 3_600_000 ? tr("%1 min ago", Math.round(ms / 60_000)) : ms < 172_800_000 ? tr("%1 h ago", Math.round(ms / 3_600_000)) : tr("%1 days ago", Math.round(ms / 86_400_000));
}
