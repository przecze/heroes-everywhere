// The browser's own shortcuts always reach the browser: a key held with Ctrl, Cmd or Alt (reload, hard reload, new tab,
// copy, print, back...) and F5 / F11 / F12 are never taken as a game hotkey (2026-10-24: Ctrl+Shift+R was Retreat).
// A screen that binds a combination of its own on purpose (the map's Ctrl+H, Ctrl+T, Ctrl+arrows) names it in `own`.

/** True when the key belongs to the browser, not the game (`own`: the screen's own Ctrl+key combinations, lower case). */
export function browsersKey(e: KeyboardEvent, own: readonly string[] = []): boolean {
  if (e.key === "F5" || e.key === "F11" || e.key === "F12") return true;
  if (!e.ctrlKey && !e.metaKey && !e.altKey) return false;
  // (Reload and hard reload, with or without Shift, are the browser's whatever a screen binds.)
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "r") return true;
  return !(e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && own.includes(key));
}

/** Ctrl+Z, or Cmd+Z on a Mac: the battle's Undo (EXTRAS battleUndo), taken before the browser's keys. */
export function undoKey(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z";
}
