// The adventure map's bits kept in the browser: the running game (a reload resumes it), the map played
// last, the multiplayer room to rejoin. Storage can fail (a private window, the quota): then the game
// just won't survive a reload, and feedback notes say why.

/** The running single player game. */
export const SAVE_KEY = "heroes.adv.v1";

let lastError = "";
/** The last time storing failed (e.g. the browser's quota), for feedback notes. */
export const storageError = () => lastError;

/** Reads a key (no value) or stores one (null back); null too when storage is unavailable. */
export function storage(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (err) {
    // Storage unavailable: the game just won't survive a reload.
    if (value !== undefined) lastError = `${key}: ${err instanceof Error ? err.message : err} (${value.length} bytes)`;
  }
  return null;
}

/** Takes a key out (nothing to do when storage is unavailable). */
export function unstore(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing stored
  }
}
