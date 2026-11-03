// The main menu's Credits, first (an addition, EXTRAS about; The owner, 2026-10-25): what this is, whose it
// isn't, and whose work it stands on, each with a link; then "Original game credits" (a gold plate as the
// emblem's) rolls the original game's own (Heroes III's CREDITS.TXT over the film). Also opened by a tap on the
// "Remade for the web" emblem.
import { decodeText } from "@heroes/formats";
import { type Application, Container, Graphics, Sprite } from "pixi.js";
import { videoSprite } from "./video.ts";
import { FILM } from "./prologue.ts";
import { fetchRes } from "../assets.ts";
import { fetchRetry } from "../net.ts";
import { extra } from "../settings.ts";
import { DefButton, label, windowFrame } from "./kit.ts";
import { scrollingText } from "./dialogs.ts";
import { goldWordButton } from "./webEmblem.ts";
import { Modals } from "./modals.ts";
import { WHITE, YELLOW, loadFont, loadFonts, textTexture } from "../text.ts";
import { screenSize, textWindowWidth } from "./screen.ts";
import { en, tr, said } from "../i18n/index.ts";

/** Whose work it stands on, in the owner's order: the HotA Crew, VCMI, the mod's authors, the translations, the wiki. */
const THANKS: [string, string][] = [
  [en("The HotA Crew: Horn of the Abyss, its art and rules"), "https://h3hota.com"],
  [en("The VCMI project: the open engine's rules and layouts"), "https://vcmi.eu"],
  [en("VCMI's Horn of the Abyss mod: edeksumo, avatar, Loki Laufeyjarson, Ben, Karyoplasma (its own work: CC BY-SA)"), "https://github.com/vcmi-mods/horn-of-the-abyss"],
  [en("VCMI's Polish and German translations (CC BY-SA)"), "https://github.com/vcmi-mods"],
  [en("The Heroes of Might and Magic III wiki (Heroes Community)"), "https://heroes.thelazy.net"],
  // CC BY-SA asks for the licence named and linked, and for changes to be said (the map texts are adapted).
  // It covers only the mod authors' and translators' own work: the art in the mod is the HotA Crew's (mod.json:
  // "Assets created by HotA Crew"), which they could not relicense.
  [en("The translations are used, and the map texts adapted, under CC BY-SA 4.0. The art is not: it belongs to the HotA Crew and to New World Computing's rights holders, all rights theirs"), "https://creativecommons.org/licenses/by-sa/4.0/"],
];

const NOTICE = en(
  "An independent, non-commercial remake, for personal use only. It is in no way associated with or supported by Ubisoft, New World Computing, the HotA Crew or the VCMI project. Heroes of Might and Magic is a trademark of Ubisoft Entertainment; all other trademarks are the property of their respective owners. The game's art and texts come from the original game and Horn of the Abyss and remain their owners' property.",
);

/** The signed-in player's (or owner's) name, if the server knows one. */
async function whoPlays(): Promise<string | undefined> {
  const who = (await fetch("/__whoami", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { name?: string } | null;
  return who?.name?.trim() || undefined;
}

/** Where the window opens from anywhere (the ☰ menu's About, a tap on the loading screen's logo): the page's own windows. */
let host: { app: Application; modals: Modals } | null = null;
export function creditsHost(app: Application, modals: Modals) {
  host = { app, modals };
}
/** Whether a page has put up its windows for it (the ☰ menu's About shows only then). */
export const creditsReady = () => !!host && !host.modals.root.destroyed;
/**
 * Opens it on the page's windows. A screen with no windows of its own yet (the loading screen, before
 * the map page's are up) passes its `app`: windows are made for it then.
 */
export function openCreditsHere(app?: Application) {
  if (!creditsReady()) host = app ? { app, modals: new Modals(app) } : null;
  if (host && !host.modals.open) void openCredits(host.app, host.modals);
}

/** Its width on a computer (upright, half the screen: textWindowWidth). */
const DESKTOP_W = 760;

/** Shows the window; `originalCredits` plays the original's roll (the window closes first). */
export async function aboutWindow(modals: Modals, originalCredits: () => void): Promise<void> {
  await loadFonts().catch(() => {});
  const W = textWindowWidth(DESKTOP_W);
  const PAD = W < DESKTOP_W ? 14 : 26;
  const inner = W - 2 * PAD;
  // The words in one column; taller than the screen allows (Polish, a computer's 600 lines: the owner 2026-10-27), they
  // scroll in their box, the buttons staying put under it.
  const body = new Container();
  let y = 0;
  const put = (c: Container, gap: number, x = 0) => {
    c.position.set(Math.round(x), Math.round(y));
    body.addChild(c);
    y += c.height + gap;
    return c;
  };
  put(label(said("Heroes"), "bigfont", YELLOW, "center", inner), 2); // i18n-ok (the game's own name: Heroes, never HotA, which names only the expansion it follows; The owner, 2026-10-27)
  put(label(said("Remade for the web"), "medfont", YELLOW, "center", inner), 10); // i18n-ok (the project's subtitle: English in every language, the owner)
  // The notice, worded as VCMI's own ("in no way associated with or supported by Ubisoft", the trademarks).
  put(label(tr(NOTICE), "medfont", WHITE, "center", inner), 6);
  // Whose copy this is: the player signed in (gate.ts /__whoami), when there is one.
  const who = await whoPlays();
  if (who) put(label(tr("Playing as %1.", who), "medfont", YELLOW, "center", inner), 6);
  y += 8;
  put(label(tr("Acknowledgements: built on the work of"), "medfont", YELLOW, "center", inner), 8);
  let scroller: ReturnType<typeof scrollingText> | null = null;
  // Each a link: the words gold-underlined, a tap opens the site in a new tab.
  for (const [words, url] of THANKS) {
    const row = new Container();
    const dot = label(said("•"), "medfont", WHITE); // i18n-ok
    const t = label(tr(words), "medfont", WHITE, "left", inner - 14);
    t.x = 14;
    const link = label(said(url.replace(/^https:\/\//, "")), "medfont", YELLOW, "left");
    link.position.set(14, t.height);
    const line = new Graphics().rect(14, t.height + link.height - 1, link.width, 1).fill(0xc9a046);
    row.addChild(dot, t, link, line);
    row.eventMode = "static";
    row.cursor = "pointer";
    row.hitArea = { contains: (x: number, yy: number) => x >= 0 && x <= inner && yy >= 0 && yy <= t.height + link.height + 2 };
    row.label = `link: ${url}`;
    // (Not when the press was a drag scrolling the words.)
    row.on("pointertap", () => !scroller?.moved() && window.open(url, "_blank", "noopener"));
    put(row, 6);
  }
  const bodyH = Math.ceil(y - 6);
  // The plate's height, and OK beside it.
  const credits = await goldWordButton(tr("Original game credits"), () => (close(), originalCredits()));
  credits.label = "button: original game credits";
  // (Narrow, upright: shrunk to leave OK its room.)
  credits.scale.set(Math.min(1, (inner - 64 - 12) / credits.width));
  const bh = Math.max(44, Math.ceil(credits.height));
  const ok = new DefButton("iokay.def", 0, 0);
  ok.onClick = () => close();
  ok.label = "button: about ok";
  // The tallest the window may be: the screen's 600 lines on a computer; upright, what fits once the window is
  // enlarged to the screen's width (touchScale).
  const most = screenSize.touch && screenSize.portrait ? Math.floor(((screenSize.h - 160) * W) / (screenSize.w - 16)) : screenSize.h - 24;
  const TOP = 22;
  const room = most - TOP - 18 - bh - 20;
  const win = await windowFrame(W, Math.min(bodyH, room) + TOP + 18 + bh + 20, 0);
  win.label = "window: about";
  if (bodyH > room) {
    // (The slider takes the box's right-hand 14 pixels: the words keep clear of it.)
    scroller = scrollingText(body, inner + Math.min(16, PAD), room);
    scroller.position.set(PAD, TOP);
    win.addChild(scroller);
  } else {
    body.position.set(PAD, TOP);
    win.addChild(body);
  }
  const by = TOP + Math.min(bodyH, room) + 18;
  credits.position.set(PAD, by + Math.round((bh - credits.height) / 2));
  ok.position.set(W - PAD - 64, by + Math.round((bh - 30) / 2));
  win.addChild(credits, ok);
  let close = () => {};
  close = modals.show(win, { onKey: (key) => (key === "Escape" || key === "Enter" ? (close(), true) : false) });
}

/** The menu's Credits (and a tap on the logo or the emblem): this window first (EXTRAS about), else the roll at once. */
export function openCredits(app: Application, modals: Modals): Promise<void> {
  return extra("about") ? aboutWindow(modals, () => void creditsRoll(app, modals)) : creditsRoll(app, modals);
}

/**
 * The credits: the film (HotA's moving menu picture, the original's own clip) with CREDITS.TXT rolling
 * up over its right-hand side, as VCMI's CreditsScreen (CREDITS.FNT, centred in 350 px, a pixel each
 * 20 ms, from below the screen; {titles} in gold). It ends when the text has gone; a click or a key ends it sooner.
 */
export async function creditsRoll(app: Application, modals: Modals) {
  const win = new Container();
  win.addChild(new Graphics().rect(0, 0, 800, 600).fill(0x000000));
  win.addChild(videoSprite(["credits"], 800, 600, win));
  win.eventMode = "static";
  let close = () => {};
  win.on("pointertap", () => close());
  close = modals.show(win, { ...FILM, onKey: () => (close(), true) });
  // The original game's own credits (Heroes III's, as the GOG release has them), not Horn of the Abyss's file that
  // replaces it: the server's "?original" (2026-10-27: "we want the HoMM 3 credits"; a server without it sends HotA's).
  const text = await fetchRetry("/res/credits.txt?original")
    .then(async (r) => (r.ok && !r.headers.get("content-type")?.startsWith("text/html") ? new Uint8Array(await r.arrayBuffer()) : Promise.reject(new Error("no original credits"))))
    .catch(() => fetchRes("credits.txt"))
    .then((b) => decodeText(b))
    .catch(() => "");
  // (The text is the part between the file's first two quotes.)
  const open = text.indexOf('"');
  const body = open < 0 ? text : text.slice(open + 1, text.indexOf('"', open + 1) >>> 0);
  const font = await loadFont("credits").then(() => "credits" as const, () => "medfont" as const);
  if (win.destroyed || !body.trim()) return;
  const roll = new Container();
  roll.x = 450;
  // In pieces (one texture of the whole would be taller than a GPU allows).
  // (The browser remake stands on the HotA team's and the VCMI project's work: named first.)
  // (With the About window first, the roll is the original's alone: the thanks are in that window.)
  const thanks = extra("about") ? [] : [tr("Browser remake built on the work of:"), tr("The Horn of the Abyss team"), tr("The VCMI project"), ""];
  const lines = [...thanks, ...body.split(/\r?\n/)];
  let y = 0;
  for (let i = 0; i < lines.length; i += 40) {
    // (A highlight left open runs on into the next piece.)
    const piece = lines.slice(i, i + 40);
    const sprite = new Sprite(textTexture(piece, font, WHITE, "center", 350));
    sprite.y = y;
    y += sprite.height;
    roll.addChild(sprite);
  }
  const view = new Container();
  view.mask = view.addChild(new Graphics().rect(450, 0, 350, 600).fill(0xffffff));
  view.addChild(roll);
  win.addChild(view);
  const pieces = roll.children.map((c) => (c as Sprite).texture);
  win.on("destroyed", () => pieces.forEach((tx) => tx.destroy(true)));
  let t = 0;
  const step = (tk: { deltaMS: number }) => {
    if (win.destroyed) return void app.ticker.remove(step);
    t += tk.deltaMS;
    roll.y = 600 - Math.floor(t / 20);
    if (roll.y + y < 0) {
      app.ticker.remove(step);
      close();
    }
  };
  app.ticker.add(step);
}
