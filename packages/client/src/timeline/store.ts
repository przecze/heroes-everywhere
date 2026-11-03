// Where the timelines live: in this browser (IndexedDB "heroes-timeline": the games, the points'
// descriptors, the points' packed states) and on the server (timelineApi.ts), where each point goes
// up once, a little after it is taken; without a connection it waits and goes when the connection is
// back. Another device's points come down as descriptors with the list, their states when one is
// opened. The map page hands every state of a game it keeps to record(), which takes the points.
import { type AdventureState, isSceneFile } from "@heroes/core";
import { thisDevice } from "../cloudSaves.ts";
import { diff, pack, patch, unpack } from "./delta.ts";
import { takeMoves } from "./moves.ts";
import { KEYFRAME, type TimelineGame, type TimelinePoint, describe, gameFor, gameId, newId, pointFor, pointOf } from "./model.ts";
import { movedDb } from "../movedDb.ts";

let opening: Promise<IDBDatabase> | null = null;
const open = () =>
  (opening ??= movedDb("heroes-timeline").then(() => new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("heroes-timeline", 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("games", { keyPath: "id" });
      d.createObjectStore("points", { keyPath: "id" }).createIndex("game", "game");
      d.createObjectStore("data");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => ((opening = null), reject(req.error));
  })));

function req<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const r = fn(d.transaction(store, mode).objectStore(store));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

const putGame = (g: TimelineGame) => req("games", "readwrite", (s) => s.put(g));
const putPoint = (p: TimelinePoint) => req("points", "readwrite", (s) => s.put(p));
const putData = (id: string, bytes: Uint8Array) => req("data", "readwrite", (s) => s.put(bytes, id));
const getData = (id: string) => req<Uint8Array | undefined>("data", "readonly", (s) => s.get(id));

/** The games this device knows, as they are kept here. */
const localGames = () => req<TimelineGame[]>("games", "readonly", (s) => s.getAll());
const localPoints = (game: string) => req<TimelinePoint[]>("points", "readonly", (s) => s.index("game").getAll(game));

/** A game's entry and points, read once per page and kept up to date here. */
const mem = new Map<string, { game: TimelineGame; points: Map<string, TimelinePoint> }>();
async function loaded(id: string) {
  let m = mem.get(id);
  if (m) return m;
  const game = await req<TimelineGame | undefined>("games", "readonly", (s) => s.get(id));
  if (!game) return undefined;
  m = { game, points: new Map((await localPoints(id)).map((p) => [p.id, p])) };
  mem.set(id, m);
  return m;
}

/** The state of the point last taken or opened (to make the next point as the change from it). */
let last: { point: string; state: AdventureState } | null = null;

/** What tells two moments of a game apart (the heroes where they stand, what everyone has), cheaply. */
const moment = (s: AdventureState) => JSON.stringify([s.day, s.current, s.log.length, s.heroes.map((h) => [h.x, h.y, h.z, h.movement, h.removed, h.army]), s.players.map((p) => p.resources), s.objects.length]);

/** JSON's own copy: the form points are made and compared in. */
const plain = (s: AdventureState) => JSON.parse(JSON.stringify(s)) as AdventureState;

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
};

/** True while the state follows on from the point (same line, later or the same moment). */
function follows(s: AdventureState, p: TimelinePoint) {
  if (s.day < p.day || s.log.length < p.logLen) return false;
  // (The log only ever grows: the same line where it ended then.)
  return p.logLen === 0 || s.log[p.logLen - 1] === p.logTail;
}

/** Games begun from a saved game of the original, until their first point is taken. */
const imports = new Set<string>();
export const markImported = (s: AdventureState) => imports.add(gameId(s));

export interface RecordOptions {
  /** The map's name (a new game's entry is called so). */
  name: string;
  /** It is your move (a new day's point is taken at its start). */
  yourMove: boolean;
  /** Take a point now, unless the state is the very one of the point it follows on from (leaving it for another point). */
  here?: boolean;
}

/**
 * A state of a game the page keeps: takes a point when it is worth one (pointFor), else does nothing.
 * Resolves to the point taken, if any.
 */
export function record(state: AdventureState, o: RecordOptions): Promise<TimelinePoint | null> {
  if (typeof indexedDB === "undefined" || isSceneFile(state.mapFile)) return Promise.resolve(null);
  return serial(async () => {
    const id = gameId(state);
    let m = await loaded(id);
    let head = m?.game.head ? m.points.get(m.game.head) : undefined;
    // Opened from elsewhere (a saved game, another device, Back in the browser): the point it comes from.
    if (m && (!head || !follows(state, head))) head = pointOf(state, [...m.points.values()]);
    let take = pointFor(state, head, o.yourMove);
    if (!take && o.here && head && !(last?.point === head.id && moment(last.state) === moment(state))) take = { kind: "here", events: [] };
    if (!take) {
      if (m && head && m.game.head !== head.id) await putGame((m.game = { ...m.game, head: head.id }));
      return null;
    }
    const now = plain(state);
    const base = head && !(head.depth + 1 >= KEYFRAME) ? await stateOf(id, head.id).catch(() => null) : null;
    const whole = !base;
    const bytes = await pack(JSON.stringify(whole ? now : diff(base, now)));
    const point: TimelinePoint = { ...describe(state, id, head, take.kind, take.events), id: newId(), whole, depth: whole ? 0 : head!.depth + 1, size: bytes.length, unsent: true, device: thisDevice().name };
    // The moves that led here (moves.ts), packed beside the state.
    const moves = takeMoves(id);
    if (moves.length) {
      await putData(`${point.id}.moves`, await pack(JSON.stringify(moves)));
      point.moves = moves.length;
    }
    if (!m) {
      m = { game: gameFor(state, o.name, imports.delete(id)), points: new Map() };
      mem.set(id, m);
    }
    await putData(point.id, bytes);
    await putPoint(point);
    m.points.set(point.id, point);
    m.game = { ...m.game, head: point.id, updatedAt: point.at, day: state.day, summary: point.summary, ...(state.winner !== undefined ? { over: true } : {}) };
    await putGame(m.game);
    last = { point: point.id, state: now };
    sendSoon();
    return point;
  });
}

/** A point's state: patched up from the last whole one before it (fetched from the server when not here). */
async function stateOf(game: string, id: string): Promise<AdventureState> {
  if (last?.point === id) return last.state;
  const m = await loaded(game);
  const chain: TimelinePoint[] = [];
  for (let p = m?.points.get(id) ?? (await remoteIndex(game))?.points.find((x) => x.id === id); p; p = p.parent ? m?.points.get(p.parent) : undefined) {
    chain.unshift(p);
    if (p.whole) break;
  }
  if (!chain.length || !chain[0].whole) throw new Error("this point's earlier states are missing");
  let s: AdventureState | null = null;
  for (const p of chain) {
    const bytes = (await getData(p.id)) ?? (await fetchData(game, p.id));
    const body = JSON.parse(await unpack(bytes));
    s = p.whole ? body : patch(s!, body);
  }
  return s!;
}

/**
 * Goes to a point of a game (back, forward or to another branch): its state, and this device is
 * there from now on, so what is played on from it hangs from it (a new branch when it had a next point).
 */
export function goTo(game: string, id: string): Promise<AdventureState> {
  return serial(async () => {
    const state = await stateOf(game, id);
    const m = await loaded(game);
    if (m) await putGame((m.game = { ...m.game, head: id }));
    last = { point: id, state };
    return structuredClone(state);
  });
}

// ---- the server ----

async function fetchData(game: string, id: string): Promise<Uint8Array> {
  const r = await fetch(`/__timeline/${encodeURIComponent(game)}/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`point ${id} is not on the server`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  await putData(id, bytes).catch(() => {});
  return bytes;
}

async function remoteIndex(game: string): Promise<{ game: TimelineGame; points: TimelinePoint[] } | null> {
  try {
    const r = await fetch(`/__timeline/${encodeURIComponent(game)}`, { cache: "no-store" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    return (await r.json()) as { game: TimelineGame; points: TimelinePoint[] };
  } catch {
    return null;
  }
}

const base64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

let sending = false;
let timer = 0;
/** The server dropped a point's moves (not deployed yet): not offered again until the page is opened anew. */
let oldServer = false;
const sendSoon = () => {
  if (typeof window === "undefined" || timer) return;
  timer = window.setTimeout(() => ((timer = 0), void flushTimeline()), 3000);
};

/** Sends the points made here and not yet up, oldest first; stops at the first that can't go (offline, server away). */
export async function flushTimeline() {
  if (sending || navigator.onLine === false) return;
  sending = true;
  try {
    const unsent = (await req<TimelinePoint[]>("points", "readonly", (s) => s.getAll())).filter((p) => p.unsent || (p.movesUnsent && !oldServer)).sort((a, b) => a.at - b.at);
    for (const p of unsent) {
      const m = await loaded(p.game);
      const bytes = await getData(p.id);
      if (!m || !bytes) continue;
      const moves = p.moves ? await getData(`${p.id}.moves`) : undefined;
      const r = await fetch(`/__timeline/${encodeURIComponent(p.game)}/${encodeURIComponent(p.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ game: m.game, point: p, data: base64(bytes), ...(moves ? { moves: base64(moves) } : {}) }),
      }).catch(() => null);
      // (Gone for good, a 4xx other than a passing one: not tried again.)
      if (!r || r.status >= 500 || [401, 403, 404, 408, 429, 507].includes(r.status)) break;
      const sent = { ...p };
      delete sent.unsent;
      // (A server from before the moves keeps the point and drops them: they go again with a later flush, once it takes them.)
      const took = moves ? ((await r.json().catch(() => ({}))) as { moves?: boolean }).moves === true : true;
      if (took) delete sent.movesUnsent;
      else ((sent.movesUnsent = true), (oldServer = true));
      await putPoint(sent);
      m.points.set(p.id, sent);
    }
  } finally {
    sending = false;
  }
}

/** How many points wait to go up. */
export const timelineWaiting = () =>
  req<TimelinePoint[]>("points", "readonly", (s) => s.getAll())
    .then((all) => all.filter((p) => p.unsent).length)
    .catch(() => 0);

if (typeof window !== "undefined" && typeof indexedDB !== "undefined") {
  addEventListener("online", () => void flushTimeline());
  setInterval(() => void flushTimeline(), 90_000);
  setTimeout(() => void flushTimeline(), 5000);
}

// ---- the lists ----

/**
 * Every game: this device's and the server's (other devices', and this one's from before), newest
 * first. The server's points of a game are added to what is kept here as descriptors.
 */
export async function games(timeoutMs = 2500): Promise<TimelineGame[]> {
  const here = await localGames().catch(() => [] as TimelineGame[]);
  let there: TimelineGame[] = [];
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch("/__timeline", { cache: "no-store", signal: ctl.signal });
    clearTimeout(t);
    if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) there = (await r.json()) as TimelineGame[];
  } catch {
    // offline, or a server without timelines: this device's alone
  }
  // Games deleted on the server (from another device, or there by hand): forgotten here too, unless this
  // device has played on in one and not yet sent it (then sending it brings the game back).
  const gone = await deletedThere(timeoutMs);
  const forgotten = new Set<string>();
  for (const g of here.filter((g) => gone.has(g.id))) {
    const waiting = (await localPoints(g.id).catch(() => [] as TimelinePoint[])).some((p) => p.unsent);
    if (!waiting) forgotten.add(g.id), await forgetHere(g.id).catch(() => {});
  }
  const kept = here.filter((g) => !forgotten.has(g.id));
  const byId = new Map(kept.map((g) => [g.id, g]));
  for (const g of Array.isArray(there) ? there : []) {
    const mine = byId.get(g.id);
    // (Where this device is in the game stays its own.)
    if (!mine || g.updatedAt > mine.updatedAt) byId.set(g.id, { ...g, ...(mine?.head ? { head: mine.head } : {}) });
  }
  // Test scenes' timelines, taken before scenes were left out: forgotten here and on the server.
  const scenes = [...byId.values()].filter((g) => isSceneFile(g.mapFile));
  for (const g of scenes) byId.delete(g.id), void forget(g.id).catch(() => {});
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A game's points: those kept here and those the server has (from other devices). */
export async function points(game: string): Promise<TimelinePoint[]> {
  const m = await loaded(game);
  const remote = await remoteIndex(game);
  if (remote) {
    let g = m?.game ?? { ...remote.game };
    const known = m?.points ?? new Map<string, TimelinePoint>();
    for (const p of remote.points) {
      if (known.has(p.id)) continue;
      known.set(p.id, p);
      await putPoint(p).catch(() => {});
    }
    if (remote.game.updatedAt > g.updatedAt) g = { ...remote.game, ...(g.head ? { head: g.head } : {}) };
    await putGame(g).catch(() => {});
    mem.set(game, { game: g, points: known });
  }
  return [...(mem.get(game)?.points.values() ?? [])];
}

/** A game's entry as this device has it (with where it is in the game). */
export const game = async (id: string) => (await loaded(id))?.game;

/** The names of games deleted on the server (none when offline, or from a server without the list). */
async function deletedThere(timeoutMs: number): Promise<Set<string>> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch("/__timeline?deleted=1", { cache: "no-store", signal: ctl.signal });
    clearTimeout(t);
    const list = r.ok && (r.headers.get("content-type") ?? "").includes("json") ? ((await r.json()) as unknown) : [];
    // (An older server answers with the games' list itself: entries, not names.)
    return new Set(Array.isArray(list) ? list.filter((g): g is string => typeof g === "string") : []);
  } catch {
    return new Set();
  }
}

/** Forgets a game on this device only. */
async function forgetHere(id: string) {
  const m = await loaded(id);
  for (const p of m?.points.keys() ?? []) {
    await req("points", "readwrite", (s) => s.delete(p));
    await req("data", "readwrite", (s) => s.delete(p));
  }
  await req("games", "readwrite", (s) => s.delete(id));
  mem.delete(id);
}

/** Forgets a game here and on the server. */
export async function forget(id: string) {
  await forgetHere(id);
  await fetch(`/__timeline/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
}
