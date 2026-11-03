// What is still loading (EXTRAS loadingNote; the loading screen prints it on its bar): when a town, a battle or
// a window waits on the game's files for a moment (`whileWaiting`), a small note in the bottom left
// corner names the file coming in, with a bar of how many of them are in. Files fetched quietly in
// the background (art for battles that may come) show nothing. The original never waited on files.
import { tr } from "../i18n/index.ts";
import { extra } from "../settings.ts";

/** Shown only for a wait longer than this (a cached file never shows). */
const AFTER_MS = 400;

let pending = 0;
let burst = 0;
let doneInBurst = 0;
let latest = "";
let el: HTMLElement | null = null;
let bar: HTMLElement | null = null;
let text: HTMLElement | null = null;
let timer = 0;

let waiters = 0;

/** The loading screen draws the note on its own bar: told the text whenever it changes. */
let onText: ((t: string) => void) | null = null;
export function loadingText(fn: ((t: string) => void) | null) {
  onText = fn;
  if (fn) fn(noteText());
}
const noteText = () => {
  if (!pending) return "";
  const file = latest.split("/").pop() ?? latest;
  return `${tr("Loading %1", file)}${pending > 1 ? ` (+${pending - 1})` : ""}`;
};

/** The screen waits on `p` (a battle being set up, a town, a window's buttons): the note may show meanwhile. */
export function whileWaiting<T>(p: Promise<T>): Promise<T> {
  if (typeof document === "undefined") return p;
  if (waiters++ === 0) {
    burst = pending;
    doneInBurst = 0;
    timer ||= window.setTimeout(show, AFTER_MS);
  }
  const end = () => {
    if (--waiters > 0) return;
    clearTimeout(timer);
    timer = 0;
    el?.classList.remove("on");
  };
  p.then(end, end);
  return p;
}

/** A game file starts loading; call the function it returns when it's in (or failed). */
export function loadingFile(name: string): () => void {
  if (typeof document === "undefined") return () => {};
  pending++;
  burst++;
  latest = name;
  refresh();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pending--;
    doneInBurst++;
    refresh();
  };
}

function show() {
  timer = 0;
  // (The loading screen has its own: on its bar.)
  if (!waiters || !extra("loadingNote")) return;
  // Nothing coming in yet: look again shortly (the wait may be on files about to be asked for).
  if (!pending) return void (timer = window.setTimeout(show, 200));
  if (!el) {
    el = document.createElement("div");
    el.id = "loadingNote";
    el.setAttribute("role", "status");
    text = document.createElement("span");
    const track = document.createElement("div");
    track.className = "track";
    bar = document.createElement("div");
    track.appendChild(bar);
    el.append(text, track);
    document.body.appendChild(el);
  }
  el.classList.add("on");
  refresh();
}

function refresh() {
  if (extra("loadingNote")) onText?.(noteText());
  if (!el || !text || !bar || !el.classList.contains("on")) return;
  if (!pending) return void ((text.textContent = tr("Loading…")), (bar.style.width = "100%"));
  text.textContent = noteText();
  bar.style.width = `${Math.round((100 * doneInBurst) / Math.max(1, burst))}%`;
}
