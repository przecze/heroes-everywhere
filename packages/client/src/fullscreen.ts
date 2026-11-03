import { toggleTurn } from "./ui/screen.ts";
import { extra } from "./settings.ts";
import { isInstalled } from "./install.ts";

/**
 * Full screen across page changes. Switching pages reloads the page (main.ts), and a reload always
 * leaves full screen: the player pressed full screen on the menu, started a game, and was dropped
 * back to the browser's bars. So a reload made in full screen leaves a note, and the next tap or key
 * on the new page (a browser lets only a gesture enter full screen) goes back into it.
 */
const KEY = "heroes.fullscreenAgain";

/** An iPhone's Safari has no Fullscreen API (only a video can); the installed app is full screen already. */
export const canFullscreen = () => !!document.documentElement.requestFullscreen;

/** Enters full screen. (It no longer locks the phone sideways: a lock outlived the game's wish and the phone stopped turning.) */
export async function enterFullscreen() {
  if (!canFullscreen()) return;
  await document.documentElement.requestFullscreen({ navigationUI: "hide" });
}

/** Reloads the page, coming back to full screen on the next gesture if it is in full screen now. */
export function reloadPage() {
  try {
    if (document.fullscreenElement) sessionStorage.setItem(KEY, "1");
  } catch {
    // no storage: full screen just stays left
  }
  location.reload();
}

/** On load: after a reload made in full screen, the first tap or key re-enters it. */
export function restoreFullscreen() {
  let again = false;
  try {
    again = sessionStorage.getItem(KEY) === "1";
    sessionStorage.removeItem(KEY);
  } catch {
    return;
  }
  if (!again || !document.documentElement.requestFullscreen) return;
  // pointerup (a touch) and mousedown / keydown (a mouse, keys) are the gestures that allow it.
  const events = ["pointerup", "mousedown", "keydown"] as const;
  const once = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key === "Escape") return;
    for (const ev of events) window.removeEventListener(ev, once, true);
    if (!document.fullscreenElement) void enterFullscreen().catch(() => {});
  };
  for (const ev of events) window.addEventListener(ev, once, true);
}

/**
 * ☰ → Rotate (2026-10-24: one tap to the other orientation): the page turned a quarter, the same in a browser
 * tab, full screen and the installed app, on Android and iPhones. It never locks the screen: a lock outlived the
 * game's wish (the phone stopped turning, a reload or a link came up sideways while held upright), and letting go
 * of one brings back the installed app's manifest orientation, an old one too. docs/rotation.md.
 */
export function turnScreen() {
  toggleTurn();
}

/**
 * The installed app on a phone takes the whole screen (EXTRAS appFullHeight): the manifest's "fullscreen" still left
 * Android's navigation bar, and the game a strip short of the screen (2026-10-30 19:20: "not using the full
 * height of the device", 411 x 787 of 852). The first tap or key, the only time a browser lets a page do it, asks for
 * full screen, which hides the phone's own bars; again after the app comes back from the background. Swiped out of it,
 * the game leaves it so until then.
 */
export function wholeScreenInApp() {
  if (!isInstalled() || !canFullscreen() || !matchMedia("(pointer: coarse)").matches) return;
  const events = ["pointerup", "keydown"] as const;
  const once = () => {
    for (const ev of events) window.removeEventListener(ev, once, true);
    if (!document.fullscreenElement && extra("appFullHeight")) void enterFullscreen().catch(() => {});
  };
  const arm = () => {
    for (const ev of events) window.addEventListener(ev, once, true);
  };
  arm();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && !document.fullscreenElement && arm());
}
