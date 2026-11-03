// What one player may spend: rate limits, daily budgets on the paid APIs (speech), and how
// much a player's uploads may take of the state volume. All keyed by the player (gate.ts whoIs), the
// owner far higher than a player. In-memory windows; the daily budgets persist (AUTH_DIR).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = () => process.env.AUTH_DIR ?? resolve(import.meta.dirname, "../../.auth");

// ---- sliding-window rate limits ----

const windows = new Map<string, number[]>();
/** Is one more `key` event allowed (at most `max` per `ms`)? Counts it when it is. */
export function allow(key: string, max: number, ms: number, now = Date.now()): boolean {
  const hits = (windows.get(key) ?? []).filter((t) => now - t < ms);
  const ok = hits.length < max;
  if (ok) hits.push(now);
  if (hits.length) windows.set(key, hits);
  else windows.delete(key);
  if (windows.size > 5000) for (const [k, h] of windows) if (!h.some((t) => now - t < 3600_000)) windows.delete(k);
  return ok;
}

/** Wrong guesses: `fail` counts one; after `max` within `ms` the key is `locked` for that long. */
const guesses = new Map<string, number[]>();
export const locked = (key: string, max: number, ms: number, now = Date.now()) => (guesses.get(key) ?? []).filter((t) => now - t < ms).length >= max;
export function fail(key: string, ms: number, now = Date.now()) {
  guesses.set(key, [...(guesses.get(key) ?? []).filter((t) => now - t < ms), now]);
}

// ---- daily budgets for the paid APIs ----

/** Per player and day: calls, and units (audio bytes for Whisper, characters for the text models). */
const BUDGETS: Record<string, { calls: number; units: number }> = {
  transcribe: { calls: 60, units: 40 * 1024 * 1024 },
  "transcribe-live": { calls: 600, units: 400 * 1024 * 1024 },
  interpret: { calls: 400, units: 2_000_000 },
  "stt-token": { calls: 40, units: 0 },
  summary: { calls: 60, units: 0 },
  // the chat room's translations, counted against the message's writer (new messages) or its reader (older ones)
  translate: { calls: 400, units: 200_000 },
};
/** The owner's budgets are this many times a player's. */
export const OWNER_FACTOR = 20;
/** Every player together, per day, in these kinds' calls: a stolen account can't burn the whole key. */
const GLOBAL_CALLS = 3000;

interface Day {
  day: string;
  /** "kind|player" -> [calls, units] */
  used: Record<string, [number, number]>;
}
let state: Day | undefined;
const file = () => resolve(DIR(), "budgets.json");
const today = (now: number) => new Date(now).toISOString().slice(0, 10);
function load(now: number): Day {
  if (state?.day === today(now)) return state;
  let d: Day | undefined;
  try {
    d = JSON.parse(readFileSync(file(), "utf8")) as Day;
  } catch {
    // none yet
  }
  return (state = d?.day === today(now) ? d : { day: today(now), used: {} });
}
const persist = () => {
  try {
    mkdirSync(DIR(), { recursive: true });
    writeFileSync(file(), JSON.stringify(state));
  } catch {
    // the count still holds in memory
  }
};

/**
 * Spends one call (and `units`) of `kind` for `player`; false when today's budget is gone (nothing is
 * spent then). `owner` players get OWNER_FACTOR times the budget.
 */
export function spend(kind: string, player: string, owner: boolean, units = 0, now = Date.now()): boolean {
  const b = BUDGETS[kind];
  if (!b) return true;
  const d = load(now);
  const k = `${kind}|${player}`;
  const [calls, used] = d.used[k] ?? [0, 0];
  const f = owner ? OWNER_FACTOR : 1;
  if (calls + 1 > b.calls * f || (b.units && used + units > b.units * f)) return false;
  const total = Object.entries(d.used).reduce((n, [key, v]) => n + (key.startsWith(`${kind}|`) ? v[0] : 0), 0);
  if (total >= GLOBAL_CALLS) return false;
  d.used[k] = [calls + 1, used + units];
  persist();
  return true;
}

/** Hands back what `spend` took, for a call that never went out. */
export function refund(kind: string, player: string, units = 0, now = Date.now()) {
  const d = load(now);
  const v = d.used[`${kind}|${player}`];
  if (v) {
    v[0] = Math.max(0, v[0] - 1);
    v[1] = Math.max(0, v[1] - units);
    persist();
  }
}

// ---- disk ----

/** Bytes in a folder (files directly in it, and one level of folders), cached for a minute. */
const sizes = new Map<string, { at: number; bytes: number; files: number }>();
export function folderUse(dir: string, now = Date.now()): { bytes: number; files: number } {
  const c = sizes.get(dir);
  if (c && now - c.at < 60_000) return c;
  let bytes = 0;
  let files = 0;
  const walk = (d: string, depth: number) => {
    for (const name of readdirSync(d)) {
      try {
        const st = statSync(resolve(d, name));
        if (st.isDirectory()) depth < 2 && walk(resolve(d, name), depth + 1);
        else (bytes += st.size), files++;
      } catch {
        // gone meanwhile
      }
    }
  };
  if (existsSync(dir)) walk(dir, 0);
  const out = { at: now, bytes, files };
  sizes.set(dir, out);
  return out;
}
/** A write of `bytes` (a new file) went into `dir`: the cached size must know before the minute is up. */
export function grew(dir: string, bytes: number) {
  const c = sizes.get(dir);
  if (c) (c.bytes += bytes), c.files++;
}

/** The most the feedback folder (notes, pictures, recordings, bundles) may hold in all, and the most one player's saves. */
export const FEEDBACK_QUOTA = 2 * 1024 ** 3;
export const SAVES_QUOTA = { tester: 400 * 1024 ** 2, owner: 4 * 1024 ** 3 };
/** Most save files (slots and their metas) one player keeps. */
export const SAVES_FILES = 120;
/** Biggest request bodies. */
export const MAX_AUDIO = 12 * 1024 * 1024;
export const MAX_NOTE = 12 * 1024 * 1024;
export const MAX_BUNDLE_FILE = 8 * 1024 * 1024;
/** Per-note text. */
export const MAX_NOTE_TEXT = 20_000;
/** Biggest jsonl a log may grow to before it stops taking lines. */
export const MAX_LOG = 8 * 1024 * 1024;
export const sizeOf = (f: string) => {
  try {
    return statSync(f).size;
  } catch {
    return 0;
  }
};
