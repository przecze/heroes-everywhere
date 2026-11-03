// The shared look and behaviour of the page's own windows (Settings, Additions beyond HotA, Layouts,
// Notifications, Play offline): the original's dialog leather behind them, a title with the ✓ that
// closes, and Escape closing the front one (chrome/layers.ts). Defined once here; style.css draws `.townPanel` with
// `--panel-bg` (the leather darkened) and its frame (ui/htmlFrame.ts).
import { decodePcx } from "@heroes/formats";
import { fetchRes } from "../assets.ts";
import { tr } from "../i18n/index.ts";
import { showMenuView } from "./layers.ts";

/**
 * The original's dialog texture (DIBOXBCK), as the game's message boxes have it: set once on the page
 * as `--menu-bg` (every panel of ours inherits it: the menu, chat, My notes, the windows), and given
 * as a CSS `url(...)` (null without the game files: the panels keep a plain dark brown).
 * (ui/htmlFrame.ts swaps the page's `--menu-bg` for a short blob URL once the frame is in.)
 */
let backing: Promise<string | null> | null = null;
export function dialogBacking(): Promise<string | null> {
  backing ??= fetchRes("diboxbck.pcx")
    .then((bytes) => {
      const img = decodePcx(bytes);
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
      const url = `url(${canvas.toDataURL()})`;
      document.documentElement.style.setProperty("--menu-bg", url);
      return url;
    })
    .catch(() => null);
  return backing;
}

export interface PageWindow {
  readonly box: HTMLDivElement;
  /** Takes it down (its `onClose` runs). */
  close(): void;
}

/** The open page windows, the front one last. */
const open: PageWindow[] = [];

/**
 * A page window over the game: `<div class="townPanel {className}">` with a head (the title, `head`'s
 * extra buttons, the ✓ that closes) and `body` under it; on the page at once.
 */
export function pageWindow(className: string, title: string, body: string, opts: { head?: string; onClose?: () => void; nested?: boolean } = {}): PageWindow {
  const box = document.createElement("div");
  box.className = `townPanel ${className}`;
  box.innerHTML = `<div class="head"><b>${title}</b>${opts.head ?? ""}<button data-x data-ico="ok">${tr("Close")}</button></div>${body}`;
  void dialogBacking();
  const win: PageWindow = {
    box,
    close() {
      const i = open.indexOf(win);
      if (i < 0) return;
      open.splice(i, 1);
      gone();
      box.remove();
      opts.onClose?.();
    },
  };
  // One of the menu views over the game (chrome/layers.ts: Escape and Back close the front one; a ☰ item's takes the place of the last).
  const gone = showMenuView(win, opts.nested);
  box.querySelector("[data-x]")!.addEventListener("click", () => win.close());
  open.push(win);
  document.body.appendChild(box);
  return win;
}
