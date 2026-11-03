/**
 * The part of the screen an on-screen keyboard leaves free, for anything typed into (a note, the chat, the room's chat).
 *
 * In a browser tab the keyboard shrinks the visual viewport, and that is the answer. In the installed app (the manifest's
 * "display": "fullscreen") and in full screen, Android lays the keyboard over the page and nothing shrinks: a box at
 * the bottom stays under the keys, typed into blind (2026-11-02: "the keyboard shows, but no box to type in").
 * There the VirtualKeyboard API (Chrome) tells where the keys are, once asked to lay them over the content; where it
 * can't, a phone in full screen is taken to lose the lower part of the screen while a text field has the focus.
 */

type VirtualKeyboard = EventTarget & { overlaysContent: boolean; boundingRect: DOMRect };
const vk = (): VirtualKeyboard | undefined => (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;

/** Laid over the page anyway: the installed app or full screen. */
export function keysOverlay(): boolean {
  return !!document.fullscreenElement || !!window.matchMedia?.("(display-mode: fullscreen)").matches;
}

/** A text field has the focus (the keyboard is up, or coming). */
function typing(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  if (a.isContentEditable || a.tagName === "TEXTAREA") return true;
  return a.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "range", "color", "file", "date"].includes((a as HTMLInputElement).type);
}

/** Where the keys begin, from the top of the layout viewport (innerHeight: no keyboard). */
function keysTop(): number {
  const vv = window.visualViewport;
  let top = vv ? vv.offsetTop + vv.height : innerHeight;
  const rect = vk()?.boundingRect;
  if (rect && rect.height > 0) top = Math.min(top, rect.top);
  // Nothing told, laid over, a finger in a text field: the keys take about the lower 45% upright, 60% sideways.
  if (top >= innerHeight - 60 && keysOverlay() && typing() && matchMedia("(pointer: coarse)").matches) top = Math.round(innerHeight * (innerHeight > innerWidth ? 0.55 : 0.4));
  return top;
}

/** The free part: its top (the visual viewport's, when scrolled) and its height, above the keys. */
export function keyboardRoom(): { top: number; height: number } {
  const top = window.visualViewport?.offsetTop ?? 0;
  return { top, height: Math.max(80, keysTop() - top) };
}

/** Calls `fn` whenever the keyboard may have come, gone or moved; returns the way to stop. */
export function onKeyboard(fn: () => void): () => void {
  const vv = window.visualViewport;
  const k = vk();
  // (Only laid over is the rect told; in the app it is laid over already, so nothing moves.)
  if (k && keysOverlay()) k.overlaysContent = true;
  const later = () => requestAnimationFrame(() => fn());
  vv?.addEventListener("resize", fn);
  vv?.addEventListener("scroll", fn);
  k?.addEventListener("geometrychange", fn);
  document.addEventListener("focusin", later);
  document.addEventListener("focusout", later);
  window.addEventListener("resize", fn);
  return () => {
    vv?.removeEventListener("resize", fn);
    vv?.removeEventListener("scroll", fn);
    k?.removeEventListener("geometrychange", fn);
    document.removeEventListener("focusin", later);
    document.removeEventListener("focusout", later);
    window.removeEventListener("resize", fn);
  };
}
