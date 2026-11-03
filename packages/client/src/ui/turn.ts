// A touch screen held upright shows the upright layout or the whole game turned sideways (Options →
// Screen → Held upright). The first change of layout on a device says which one is on, what turning the
// phone does, and offers the other with one tap (no need for the phone's own rotation settings); the page menu
// keeps the same switch.
import { tr } from "../i18n/index.ts";
import { setSetting } from "../settings.ts";
import { heldUpright, onLayout, relayout, screenSize, toggleTurn } from "./screen.ts";

type Mode = "upright" | "turned" | "small" | "landscape" | "desktop";

const NOTES: Record<Mode, [string, string] | null> = {
  upright: ["Upright layout. Turn the phone for the sideways screens, or turn the game here:", "Turn the game sideways"],
  turned: ["The game is turned sideways: hold the phone sideways, turned to the left. Or play upright:", "Use the upright layout"],
  small: ["The game is small and upright. Bigger:", "Use the upright layout"],
  landscape: null,
  desktop: null,
};

export function setupTurn(toggle: HTMLButtonElement | null) {
  const note = document.createElement("div");
  note.id = "turnNote";
  note.hidden = true;
  document.body.appendChild(note);
  // Only a change while the page is up (the phone turned, the setting switched): never at a page's
  // start, and every scene change starts the page again (main.ts), so it came up on each of them.
  let last: Mode | null = null;
  let timer = 0;

  const mode = (): Mode => {
    if (!screenSize.touch) return "desktop";
    if (screenSize.portrait) return "upright";
    if (screenSize.sideways) return "turned";
    return heldUpright() ? "small" : "landscape";
  };
  /** Upright layout <-> the game turned sideways (from "small" too), laid out again in place. */
  const flip = () => {
    note.hidden = true;
    // "small" isn't a turn: the upright layout is the setting's.
    if (mode() === "small") return void (setSetting("sideways", "portrait"), relayout());
    toggleTurn();
  };

  const seen = () => {
    try {
      if (localStorage.getItem("heroes.turnNoteSeen")) return true;
      localStorage.setItem("heroes.turnNoteSeen", "1");
    } catch {
      // no storage: shown each time, as before
    }
    return false;
  };
  const show = (m: Mode) => {
    const text = NOTES[m]?.map((s) => tr(s));
    if (!text) return void (note.hidden = true);
    note.replaceChildren(Object.assign(document.createElement("span"), { textContent: text[0] }), Object.assign(document.createElement("button"), { textContent: text[1], onclick: flip, title: text[1] }));
    note.hidden = false;
    clearTimeout(timer);
    timer = window.setTimeout(() => (note.hidden = true), 7000);
  };
  // Any tap elsewhere puts it away too (the game goes on under it: a window's choice, the map).
  note.addEventListener("pointerdown", (e) => e.target === note && (note.hidden = true));
  document.addEventListener("pointerdown", (e) => !note.hidden && !note.contains(e.target as Node) && (note.hidden = true), true);

  onLayout(() => {
    const m = mode();
    // (The menu's own "Turn the screen" does this; the extra ⟳ item was redundant.)
    if (toggle) toggle.hidden = true;
    if (m === last) return;
    // Turned back before it went: a note about the other layout doesn't stay over this one.
    note.hidden = true;
    // Once on a device: after that turning the phone just turns the game (no note over it each time).
    if (last !== null && !seen()) show(m);
    last = m;
  });
  if (toggle) toggle.onclick = () => (document.body.classList.remove("menuOpen"), flip());
}
