// The page's own menu (the corner ☰, on desktops the slim bar's): a list over the game, closed by a
// tap or click outside it, Escape, or by choosing an item, so whatever the item opens is in front.
// It keeps what the original has no window for (Feedback's settings, the layout, language, the
// extras, offline play, the players' tools); the game's own settings are in its own windows
// (System Options, the combat options), which the menu's first item opens. Short enough for a phone
// held sideways: the pages, the scenario picker and the players' tools fold away under More….

import { dialogBacking } from "./look.ts";
import { closeMenuViews } from "./layers.ts";

let gameOptions: (() => void) | null = null;

/** What the menu's "System Options" opens on this page (the map: System Options, in a battle the combat options). */
export function setGameOptions(open: (() => void) | null) {
  gameOptions = open;
  const item = document.getElementById("menuSysOptions");
  if (item) item.hidden = !open;
}

let seats: (() => void) | null = null;

/** What the menu's "Players" opens (a hot seat game's colours, to hand to the computer); null: not in one. */
export function setSeats(open: (() => void) | null) {
  seats = open;
  const item = document.getElementById("menuSeats");
  if (item) item.hidden = !open;
}

export const menuOpen = () => document.body.classList.contains("menuOpen");

export function closeMenu() {
  document.body.classList.remove("menuOpen");
  document.getElementById("menuToggle")?.setAttribute("aria-expanded", "false");
}

const openers: (() => void)[] = [];
/** Calls `fn` each time the menu opens (the icon panel brings its tiles up to date). */
export function onMenuOpen(fn: () => void) {
  openers.push(fn);
}

function openMenu() {
  // Under its button: from the left, or with the button on the right (one-handed) from the right.
  // (Hidden, its place taken by a game screen's own button: from the left.)
  const toggle = document.getElementById("menuToggle")!;
  const menu = document.getElementById("toolbar")!;
  const w = document.body.clientWidth;
  const onRight = !!toggle.offsetWidth && toggle.offsetLeft + toggle.offsetWidth / 2 > w / 2;
  menu.style.left = onRight ? "auto" : "";
  menu.style.right = onRight ? `${Math.max(6, Math.round(w - toggle.offsetLeft - toggle.offsetWidth))}px` : "";
  void dialogBacking();
  // A page-level window opened from the menu (My notes, a message) would hide the menu behind it: it closes.
  for (const id of ["myNotes", "msgBox"]) document.getElementById(id)?.remove();
  for (const fn of openers) fn();
  document.body.classList.add("menuOpen");
  document.getElementById("menuToggle")?.setAttribute("aria-expanded", "true");
}

/** Opens the page's menu from a game screen's own button (its corner button hidden there: style.css ownButtons). */
export function openPageMenu() {
  if (!menuOpen()) openMenu();
}

export function setupPageMenu() {
  const toggle = document.getElementById("menuToggle")!;
  const menu = document.getElementById("toolbar")!;
  toggle.setAttribute("aria-haspopup", "true");
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => (menuOpen() ? closeMenu() : openMenu()));
  // A tap or click anywhere else closes it; on the game it does nothing more (it can't move a hero).
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!menuOpen()) return;
      const t = e.target as Element;
      if (menu.contains(t) || toggle.contains(t)) return;
      // Feedback leaves it open: the note's screenshot then shows the menu it is about (feedback/menuShot.ts).
      if (t.closest("#feedback, #fbPick, #fbNote")) return;
      closeMenu();
      if (document.getElementById("stage")?.contains(t)) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    { capture: true },
  );
  // (Escape closes it: chrome/layers.ts.)
  // More…: the rest of the list unfolds in place (and stays so next time, on this device).
  const more = document.getElementById("menuMore")!;
  const moreList = document.getElementById("menuMoreList")!;
  const unfold = (open: boolean) => {
    moreList.hidden = !open;
    more.setAttribute("aria-expanded", String(open));
    more.classList.toggle("open", open);
    try {
      localStorage.setItem("heroes.menuMore", open ? "1" : "0");
    } catch {
      // not kept
    }
  };
  let wasOpen = false;
  try {
    wasOpen = localStorage.getItem("heroes.menuMore") === "1";
  } catch {
    // folded
  }
  unfold(wasOpen);
  more.addEventListener("click", () => unfold(moreList.hidden));
  // Choosing an item (a button or a link) closes it: what it opens comes up in front.
  menu.addEventListener("click", (e) => {
    const t = (e.target as Element).closest("button, a");
    // (An icon tile's first tap only names it, "armed": the menu stays for the second tap.)
    if (t && t !== more && !t.hasAttribute("data-keep") && !t.classList.contains("armed")) closeMenu();
  });
  // (The list of words, EXTRAS iconMenu off: its button takes the place of the menu view open, before it opens its own.)
  menu.addEventListener(
    "click",
    (e) => {
      const t = (e.target as Element).closest("#toolbar > button.item, #menuMoreList > button.item");
      if (t && !t.hasAttribute("data-keep") && t.id !== "menuMore") closeMenuViews();
    },
    true,
  );
  document.getElementById("menuSysOptions")!.addEventListener("click", () => gameOptions?.());
  document.getElementById("menuSeats")?.addEventListener("click", () => seats?.());
  setGameOptions(gameOptions);
}
