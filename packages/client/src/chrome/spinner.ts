// The one sign for "something comes here, it is still loading": a small turning ring in the gold of the game's frames,
// centred in the room it is put in. Platform: every page piece that waits on something shows this one.
import { tr } from "../i18n/index.ts";

/** A spinner to put where the thing will appear; remove it (or replace the room's content) once it has. */
export function spinner(label = tr("Loading…")): HTMLElement {
  const el = document.createElement("div");
  el.className = "spinner";
  el.setAttribute("role", "status");
  el.setAttribute("aria-label", label);
  el.title = label;
  return el;
}
