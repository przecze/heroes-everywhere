// The connection, said plainly (2026-10-27: "a sane offline mode"). Whether the server can be
// reached is checked by asking it (/__whoami, a few bytes), not only by the browser's "online", which a
// train's wifi fools: when the browser says it lost the network, when a request fails, when the page
// comes back to the front, and every minute (every few seconds while offline, slowing down).
// Losing it and getting it back each get a note at the top; Feedback wears an "offline" tag with the
// count of notes waiting; what needs the server (the chat, multiplayer, voice notes, the owner's pages,
// marked `data-net`) is greyed and a press says why instead of failing. Notes are kept on the device
// (feedback/outbox.ts), changeable in My notes, and go by themselves once it's back ("Back online ✓ 2
// notes sent"). Behind EXTRAS netStatus; the keeping of notes is not an interface and stays.
import { tr } from "./i18n/index.ts";
import { extra, onSettings } from "./settings.ts";
import { flush, waitingNotes } from "./feedback/outbox.ts";
import { isOffline, onNetChange, setOffline } from "./netState.ts";
import { voiceOffline } from "./feedback/whisper.ts";

export { isOffline, onNetChange } from "./netState.ts";

/** Can the server be reached? Any answer of its own counts; a gateway's "the server isn't there" (502-504, a proxy's 52x) doesn't. */
async function reachable(): Promise<boolean> {
  if (navigator.onLine === false) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`/__whoami?probe=${Date.now().toString(36)}`, { cache: "no-store", signal: ctl.signal });
    return !(r.status >= 520 || (r.status >= 502 && r.status <= 504));
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

let checking: Promise<void> | null = null;
let timer = 0;
/** The wait before the next check while offline: 5 s, growing to 30 s. */
let patience = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Checks now (one check at a time; a check asked for meanwhile is that one). */
export function checkConnection(): Promise<void> {
  return (checking ??= (async () => {
    let ok = await reachable();
    // One failure while the browser says it's online: once more before saying so (a server restarting, a moment's drop).
    if (!ok && navigator.onLine !== false && !isOffline()) ok = (await sleep(3000), await reachable());
    setOffline(!ok);
  })().finally(() => {
    checking = null;
    schedule();
  }));
}

function schedule() {
  clearTimeout(timer);
  const wait = isOffline() ? patience : 60_000;
  if (isOffline()) patience = Math.min(30_000, patience * 1.5);
  timer = window.setTimeout(() => (document.hidden ? schedule() : void checkConnection()), wait);
}

const on = () => extra("netStatus");

/** A note at the top that goes by itself (a tap puts it away sooner). */
function toast(text: string, ms = 5000) {
  document.getElementById("netToast")?.remove();
  const el = document.createElement("div");
  el.id = "netToast";
  el.className = "fbFlash";
  el.setAttribute("role", "status");
  el.textContent = text;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** The note when the connection goes: voice notes too wait for it, unless this device hears them itself (Whisper kept, whisper.ts). */
const lostText = () =>
  voiceOffline()
    ? tr("You're offline. The game goes on; notes, spoken ones too, are kept on this device and go when you're back. The chat and multiplayer wait for the connection.")
    : tr("You're offline. The game goes on; notes are kept on this device and go when you're back. The chat, multiplayer and voice notes wait for the connection.");

/** Why a greyed control does nothing. */
const WHY = () => tr("This needs a connection, and you're offline. It works again once you're back.");

/**
 * Offline (and the switch on): says why and answers true, for an action that needs the server and isn't a
 * `data-net` control (a button drawn by the game, as the main menu's Multiplayer). Else false: go ahead.
 */
export function needsNet(): boolean {
  if (!isOffline() || !on()) return false;
  toast(WHY(), 3500);
  return true;
}

/** Feedback's tag: "offline", with the notes waiting on this device. */
async function tag() {
  const button = document.getElementById("fbToggle");
  if (!button) return;
  let el = document.getElementById("netTag");
  if (!el) {
    el = document.createElement("span");
    el.id = "netTag";
    el.setAttribute("aria-hidden", "true");
    button.appendChild(el);
  }
  const n = isOffline() && on() ? await waitingNotes() : 0;
  el.hidden = !(isOffline() && on());
  el.textContent = n ? tr("offline · %1", n) : tr("offline");
  button.title = isOffline() && on() ? tr("Offline: a note is kept on this device and goes when you're back online (☰ → My notes to change it)") : (button.dataset.title ?? button.title);
}

function look() {
  document.body.classList.toggle("offline", isOffline() && on());
  void tag();
}

/** Presses on `data-net` controls while offline: the reason instead (capture, before the control's own handlers). */
function guard(e: Event) {
  if (!document.body.classList.contains("offline")) return;
  const el = (e.target as Element | null)?.closest?.("[data-net]");
  // (One already going, as the dictation listening, can still be stopped. A form marked quiet holds only its sending,
  // greyed by its own button: its field takes presses as ever.)
  if (!el || el.classList.contains("on") || (e.type === "click" && (el as HTMLElement).dataset.net === "quiet")) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  toast(WHY(), 3500);
}

let started = false;
export function setupOnline() {
  if (started) return;
  started = true;
  const fb = document.getElementById("fbToggle");
  if (fb) fb.dataset.title = fb.title;
  document.addEventListener("click", guard, true);
  document.addEventListener("submit", guard, true);
  let first = true;
  onNetChange(async (off) => {
    look();
    patience = 5000;
    schedule();
    if (!on()) return void (off || flush());
    if (off) return toast(lostText(), 7000);
    if (first) return;
    const sent = await flush();
    toast(sent ? tr("Back online ✓ Kept notes sent: %1", sent) : tr("Back online ✓"));
  });
  // (Sent later by the outbox's own round: a limit or a sign-in held them.)
  addEventListener("heroes:notesSent", (e) => on() && toast(tr("Kept notes sent ✓ %1", (e as CustomEvent<number>).detail)));
  addEventListener("heroes:outbox", () => void tag());
  addEventListener("online", () => void checkConnection());
  addEventListener("offline", () => setOffline(true));
  addEventListener("heroes:netTrouble", () => void checkConnection());
  document.addEventListener("visibilitychange", () => !document.hidden && void checkConnection());
  onSettings(look);
  look();
  // The first check: offline from the start is said too, "Back online" only after a loss seen here.
  void checkConnection().then(() => {
    if (isOffline() && on()) toast(lostText(), 7000);
    first = false;
  });
}
