// Saved single-player games, kept in this browser (IndexedDB: games are too big for localStorage
// in numbers). The automatic save of the current game stays separate.
import type { AdventureState } from "@heroes/core";
import { type GameSummary, summarize } from "./gameSummary.ts";
import { movedDb } from "./movedDb.ts";

export interface SaveInfo {
  id: number;
  name: string;
  savedAt: number;
  mapFile?: string;
  day?: number;
  summary?: GameSummary;
}

const DB = "heroes-saves";

function db(): Promise<IDBDatabase> {
  return movedDb(DB).then(() => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("saves", { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction("saves", mode).objectStore("saves"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listSaves(): Promise<SaveInfo[]> {
  const all = (await tx("readonly", (s) => s.getAll())) as (SaveInfo & { state: AdventureState })[];
  return all.map(({ id, name, savedAt, state }) => ({ id, name, savedAt, mapFile: state?.mapFile, day: state?.day, summary: state?.players ? summarize(state) : undefined })).sort((a, b) => b.savedAt - a.savedAt);
}

/** Saves the game (over `id` when given). */
export async function saveGame(name: string, state: AdventureState, id?: number): Promise<void> {
  const rec = { name, savedAt: Date.now(), state, ...(id !== undefined ? { id } : {}) };
  await tx("readwrite", (s) => s.put(rec));
}

export async function loadSave(id: number): Promise<AdventureState | undefined> {
  const rec = (await tx("readonly", (s) => s.get(id))) as { state: AdventureState } | undefined;
  return rec?.state;
}

export async function deleteSave(id: number): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}
