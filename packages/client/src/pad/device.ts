// Which device the page runs on, for the controller layer (pad/index.ts): a game console's browser is played
// with its controller, never a mouse or a finger. Auto-detected by the browser's name (the PlayStation 5's and 4's
// built-in browsers say "PlayStation"), so a desktop with a controller plugged in stays as it was; `?pad=1` turns
// it on anywhere for one tab (testing on a computer with a DualSense, the probes), `?pad=0` off.

const KEY = "heroes.pad";

/** The console whose browser this is, or null. */
export function consoleBrowser(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): "playstation" | null {
  return /PlayStation/i.test(ua) ? "playstation" : null;
}

let forced: boolean | null = null;
try {
  const q = new URLSearchParams(location.search).get("pad");
  if (q === "1" || q === "0") sessionStorage.setItem(KEY, q);
  const kept = sessionStorage.getItem(KEY);
  forced = kept === "1" ? true : kept === "0" ? false : null;
} catch {
  // no storage (a sandboxed frame): auto-detect only
}

/** Played with a controller: on a console's browser, or forced for this tab. */
export const padWanted = (): boolean => forced ?? consoleBrowser() !== null;
