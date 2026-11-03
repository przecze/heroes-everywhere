// The app's views over the game (2026-10-25): the game is always the bottom layer, in its main
// menu, on the adventure map or in a battle; what the ☰ menu opens that isn't the game's (the owner's
// Review, Admin and Previews, the UI catalog, Completeness / Roadmap) comes up over it as
// a view, with ✓ back to the game, and Feedback and ☰ stay on top of it as everywhere. Before, each
// was a page of its own: the page reloaded, the game went, and the way back was the menu.
//
// A view is a frame: the owner's pages are the server's (/__admin...), ours are this app started on
// that page alone (`?view=1#complete`, main.ts: no ☰, Feedback or chat of its own). A link inside it
// to a game page (Completeness' "Watch the AI") asks this page to go there.
import { setFeedbackMeta } from "../feedback/index.ts";
import { tr } from "../i18n/index.ts";
import { extra } from "../settings.ts";
import { applyIcons } from "../ui/htmlIcons.ts";
import { showMenuView } from "./layers.ts";
import { track } from "../usage.ts";

// i18n-ok (the owner's own tools keep English)
const OWNER: Record<string, string> = { "#admin": "/__admin", "#review": "/__review", "#previews": "/__previews" };
const TITLE: Record<string, () => string> = {
  "#admin": () => "Admin", // i18n-ok
  "#review": () => "Notes to review", // i18n-ok
  "#previews": () => "Previews", // i18n-ok
  "#catalog": () => tr("Wiki"),
  "#complete": () => tr("Completeness"),
  "#matrix": () => tr("Completeness"),
  "#roadmap": () => tr("Roadmap"),
};

/** `hash` names a view rather than a state of the game (and views are on: EXTRAS menuViews). */
export const isView = (hash: string) => hash.split("?")[0] in TITLE;

/** The app inside a view's frame: it shows its page alone and hands game links to the page around it. */
export const inViewFrame = new URLSearchParams(location.search).has("view");

let shown: { layer: HTMLElement; hash: string; game: string; meta: () => Record<string, unknown>; gone: () => void; fit: () => void } | null = null;

/** The view now open ("#review"...), if any. */
export const openViewHash = () => shown?.hash ?? null;

/** Views over the game, or (EXTRAS menuViews off) each its own page as before. */
export const viewsOn = () => extra("menuViews");

/** The address while a view is open: the view and its tab, so the link can be given on (a reload brings back the game with it on top). */
const showAddress = (hash: string) => history.replaceState(history.state, "", `${location.pathname}${location.search}${hash}`);

/** Opens `hash` (a view's, with its query: "#admin?tab=keys") over the game. */
export function openView(hash: string) {
  const route = hash.split("?")[0];
  const query = new URLSearchParams(hash.split("?")[1] ?? "");
  // Counted (`agent.py usage`): which views (the owner's tools among them) are really opened.
  track(`view:${route.slice(1)}`);
  const game = shown ? shown.game : location.hash;
  if (shown) closeView();
  const layer = document.createElement("div");
  layer.id = "viewLayer";
  layer.dataset.view = route.slice(1);
  // The players' notes waiting for approval: blanked in a note's picture (feedback/menuShot.ts).
  if (route === "#review") layer.dataset.private = "";
  const head = document.createElement("div");
  head.className = "viewHead";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "viewBack";
  back.dataset.ico = "ok";
  back.title = back.ariaLabel = tr("Back to the game");
  back.onclick = () => closeView();
  const title = document.createElement("h1");
  title.textContent = TITLE[route]();
  head.append(back, title);
  const frame = document.createElement("iframe");
  frame.title = title.textContent;
  const tab = query.get("tab");
  frame.src = OWNER[route] ? OWNER[route] + (tab ? `#${tab}` : "") : `${location.pathname}?view=1${hash}`;
  layer.append(head, frame);
  document.body.appendChild(layer);
  applyIcons(layer);
  // The head keeps clear of the ☰ and Feedback buttons where this screen has them over it.
  const fit = () => {
    const h = head.getBoundingClientRect();
    let l = 12;
    let r = 12;
    for (const id of ["menuToggle", "fbToggle"]) {
      const b = document.getElementById(id)?.getBoundingClientRect();
      if (!b?.width || b.top >= h.bottom || b.bottom <= h.top) continue;
      if (b.left + b.width / 2 < h.left + h.width / 2) l = Math.max(l, b.right - h.left + 8);
      else r = Math.max(r, h.right - b.left + 8);
    }
    head.style.setProperty("--viewPadL", `${Math.round(l)}px`);
    head.style.setProperty("--viewPadR", `${Math.round(r)}px`);
  };
  fit();
  requestAnimationFrame(fit);
  window.addEventListener("resize", fit);
  showAddress(hash);
  // A note written over it is about the view: its page and the tab or link open in it (its picture paints the view in).
  const where = () => {
    try {
      const l = frame.contentWindow!.location;
      return { path: l.pathname + l.search + l.hash, hash: l.hash };
    } catch {
      return { path: frame.src, hash: "" };
    }
  };
  const meta = setFeedbackMeta(() => {
    const w = where();
    return OWNER[route] ? { view: route.slice(1) + w.hash, ownerPage: w.path } : { view: w.hash.slice(1) || route.slice(1), viewPage: w.path };
  });
  // One step back inside the frame first (a window open in it that takes Escape), then the view closes.
  const inner = () => {
    try {
      const w = frame.contentWindow as (Window & typeof globalThis) | null;
      if (!w?.document.body) return false;
      const ev = new w.KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
      w.document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    } catch {
      return false;
    }
  };
  const gone = showMenuView({ close: () => closeView(), back: inner });
  shown = { layer, hash, game, meta, gone, fit };
  frame.addEventListener("load", () => {
    try {
      const w = frame.contentWindow!;
      // Escape inside the frame that nothing in it took: the same step back as outside.
      w.addEventListener("keydown", (e) => e.key === "Escape" && !e.defaultPrevented && closeView());
      // The address follows the frame's tab (Admin's Players, the catalog's view...).
      const follow = () => {
        if (shown?.layer !== layer) return;
        const h = w.location.hash;
        shown.hash = OWNER[route] ? `${route}${h.length > 1 ? `?tab=${encodeURIComponent(h.slice(1))}` : ""}` : h || route;
        showAddress(shown.hash);
      };
      w.addEventListener("hashchange", follow);
      // (The catalog walks its levels with pushState: no hashchange.)
      w.addEventListener("popstate", follow);
      w.addEventListener("heroes:address", follow);
      follow();
    } catch {
      // (another origin: only the button and Back)
    }
  });
}

/** Closes the view, back to the game as it was. */
export function closeView() {
  if (!shown) return;
  const { layer, meta, game, gone, fit } = shown;
  shown = null;
  window.removeEventListener("resize", fit);
  gone();
  layer.remove();
  setFeedbackMeta(meta);
  showAddress(game);
}

/** Goes to `hash`: a view's over the game, else the page change it names. */
export function goTo(hash: string) {
  if (viewsOn() && isView(hash) && !inViewFrame) openView(hash);
  else location.hash = hash;
}

/** The frames' game links and the page's links to views; `go` takes the page to a game state ("#map?map=..."). */
export function setupViews(go: (hash: string) => void) {
  // A link to a view opens it here (no page change and no history entry: Back is chrome/layers.ts's).
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]");
      const href = a?.getAttribute("href") ?? "";
      const hash = href.startsWith("/#") ? href.slice(1) : href;
      if (!hash.startsWith("#") || !viewsOn() || !isView(hash) || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      openView(hash);
    },
    true,
  );
  // The game under a view hears no keys (its hotkeys); Feedback's F still works, and Escape is chrome/layers.ts's.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!shown || e.key === "Escape" || e.code === "KeyF" || (e.target as HTMLElement | null)?.closest?.("#feedback, #toolbar, #chatPanel, .townPanel, .replies, textarea, input, select")) return;
      e.stopImmediatePropagation();
    },
    true,
  );
  window.addEventListener("message", (e) => {
    const to = e.origin === location.origin && (e.data as { hotaGo?: unknown } | null)?.hotaGo;
    if (typeof to !== "string" || !shown) return;
    closeView();
    go(to);
  });
}

/** The game's own page last shown here ("#map", "#menu"...): a view's link opened afresh comes up over it. */
const GAME = "heroes.gameLayer";
export function rememberGamePage(route: string) {
  try {
    localStorage.setItem(GAME, route);
  } catch {
    // (no storage: a view's link comes up over the main menu)
  }
}
export function lastGamePage(): string {
  try {
    return localStorage.getItem(GAME) || "#menu";
  } catch {
    return "#menu";
  }
}
