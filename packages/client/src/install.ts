import { extra } from "./settings.ts";
import { tr } from "./i18n/index.ts";

// "Install the game": Chrome / Edge / Android offer an install event we catch and answer with our own
// card; an iPhone or iPad has no such event (Safari: Share, then Add to Home Screen), so there the
// card only says where to tap. Either way it appears once on the main menu, never blocks play, and a
// "Not now" is remembered for a week ("Don't ask again" for good). The ☰ menu keeps an item for later.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const KEY = "heroes.installPrompt";
const WEEK = 7 * 24 * 3600 * 1000;
let deferred: InstallEvent | null = null;
let card: HTMLElement | null = null;

/** Running from the home screen (Android's installed app, an iPhone's navigator.standalone) rather than a browser tab. */
export function isInstalled(): boolean {
  return !!(navigator as Navigator & { standalone?: boolean }).standalone || !!matchMedia?.("(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)").matches;
}

/** Safari on an iPhone or iPad (an iPad asks for the desktop site and says Mac, but has a touch screen). */
export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Is there a way to install from here: Chrome's event came, or an iPhone's Share menu. */
const canInstall = () => !isInstalled() && (!!deferred || isIos());

function remembered(): "never" | number | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "never" ? "never" : v ? Number(v) : null;
  } catch {
    return null;
  }
}
function remember(v: "never" | number) {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    // no storage: asked again next visit
  }
}

function hideCard() {
  card?.remove();
  card = null;
}

/** The card: Install (Chrome) or the Share hint (iPhone), Not now, Don't ask again. */
function showCard() {
  if (card || !canInstall()) return;
  card = document.createElement("div");
  card.id = "installCard";
  card.setAttribute("role", "dialog");
  const text = document.createElement("p");
  text.textContent = deferred
    ? tr("Install the game on this device: it opens full screen with its own icon, and can tell you when it's your turn.")
    : tr("Install the game on your iPhone: tap Share (the square with an arrow, or the ⋯ menu), then “Add to Home Screen”. It then opens full screen with its own icon, and can tell you when it's your turn.");
  const row = document.createElement("div");
  const button = (label: string, act: () => void, ico: string, primary = false) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.ico = ico;
    if (primary) b.className = "primary";
    b.onclick = act;
    row.append(b);
  };
  if (deferred) button(tr("Install"), () => void install(), "ok", true);
  else button(tr("OK"), hideCard, "ok", true);
  // One way out (the owner: two dismiss buttons confused): the card doesn't come back by itself, the ☰ menu keeps "Install".
  button(tr("Not now"), () => (remember("never"), hideCard()), "cancel");
  card.append(text);
  // An iPhone's home-screen app keeps its own cookies: it starts signed out and asks for a device code
  // (the gate's page), the same as "Add a device". Made here on request, so it lasts while they install.
  if (!deferred) {
    const note = document.createElement("p");
    note.className = "installCode";
    const show = document.createElement("button");
    show.textContent = tr("Show the code for signing in the app");
    show.dataset.ico = "eye";
    show.onclick = async () => {
      show.disabled = true;
      try {
        const r = await fetch("/__device/code", { method: "POST" });
        if (!r.ok) throw new Error();
        const { code, minutes } = (await r.json()) as { code: string; minutes: number };
        note.textContent = tr("When the app asks for a code, type %1 (good for %2 minutes).", code, minutes);
        show.remove();
      } catch {
        note.textContent = tr("No code from here: ask for a new invite link.");
        show.remove();
      }
    };
    card.append(show, note);
  }
  card.append(row);
  document.body.append(card);
}

async function install() {
  const e = deferred;
  hideCard();
  if (!e) return;
  deferred = null;
  await e.prompt().catch(() => {});
  await e.userChoice.catch(() => {});
  refreshMenuItem();
}

function refreshMenuItem() {
  const item = document.getElementById("menuInstall");
  if (item) item.hidden = !extra("installPrompt") || !canInstall();
}

/** On load, on the main menu (`offerNow`) the card comes after a short wait; other pages only get the menu item. */
export function setupInstall(offerNow: boolean) {
  const item = document.getElementById("menuInstall");
  if (item)
    item.onclick = () => {
      document.getElementById("menuToggle")?.click();
      showCard();
    };
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    refreshMenuItem();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    hideCard();
    refreshMenuItem();
  });
  refreshMenuItem();
  // (Not on a computer: it has the browser's own install icon, and the ☰ item.)
  if (!offerNow || !extra("installPrompt") || !matchMedia("(pointer: coarse)").matches) return;
  const seen = remembered();
  if (seen === "never" || (seen !== null && Date.now() - seen < WEEK)) return;
  setTimeout(() => {
    refreshMenuItem();
    // Not over a loading screen, a keyboard or the menu: only a quiet main menu.
    if (!document.getElementById("splash") && !document.body.classList.contains("menuOpen")) showCard();
  }, 6000);
}
