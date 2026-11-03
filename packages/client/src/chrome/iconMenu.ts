// The ☰ menu as one panel of icons (2026-10-24: the list with More… and a long Settings page was
// "cluttered, spaghettified"): what a player reaches for in two rows of tiles (the game's options,
// the layout, sound, full screen; chat, my notes, how-to, settings), the owner's tools in a row of
// their own under a gold rule, and a status line naming the tile under the finger or mouse, as the
// original's status bar names its buttons. The faces are the original's button art where it has one
// (htmlIcons.ts). The tiles press the list's own buttons, which keep their wiring and stay the menu
// with EXTRAS iconMenu off (classic HotA too).
import { tr, lang, LANGS } from "../i18n/index.ts";
import { extra, onSettings } from "../settings.ts";
import { onMenuOpen } from "./pageMenu.ts";
import { toggleLayouts, toggleThumbs } from "./layouts.ts";
import { turnScreen } from "../fullscreen.ts";
import { heldUpright, screenSize } from "../ui/screen.ts";
import { isMuted, setMuted } from "../audio.ts";
import { applyLanguage } from "./settingsWindow.ts";
import { langSources } from "../i18n/langSources.ts";
import { previewSlug } from "../previewBuild.ts";
import { openCreditsHere } from "../ui/about.ts";
import { goTo } from "./views.ts";
import { closeMenuViews } from "./layers.ts";
import { offlineProgress, onOfflineProgress } from "../offline.ts";
import { pageWindow, type PageWindow } from "./look.ts";
import { applyIcons } from "../ui/htmlIcons.ts";
import { track } from "../usage.ts";
import { isOffline, onNetChange } from "../netState.ts";

interface Tile {
  key: string;
  ico: string;
  name: () => string;
  act: () => void;
  shown?: () => boolean;
  /** The menu stays open (a switch: its new state shows on the tile and the status line). */
  keep?: boolean;
  badge?: () => string;
  /** What the tile does, for the tooltip and the status line (else the list button's own title). */
  help?: () => string;
  /** Needs the server: greyed while offline, a press saying why (online.ts). */
  net?: true;
}

const $ = (id: string) => document.getElementById(id);
const press = (id: string) => () => $(id)?.click();
const there = (id: string) => () => !!$(id) && !$(id)!.hidden;
// (The owner's tiles need the page's Admin link, shown to the owner only; the open-source release has none.)
const owner = () => $("fbAdmin")?.hidden === false;
const helpOf = (id: string) => () => $(id)?.title ?? "";
const explain = (t: Tile) => {
  const h = t.help?.() ?? "";
  const said = h && h !== t.name() ? `${t.name()}: ${h}` : t.name();
  return t.net && isOffline() && extra("netStatus") ? `${said} (${tr("needs a connection: you're offline")})` : said;
};

/**
 * The language: one tile showing the one in use, a tap opens the picker (2026-10-27: "one language button shows
 * current, opens picker on tap"), each named in its own language as language pickers are.
 */
const LANG_TILE: Tile = { key: "lang", ico: "lang", name: () => LANGS.find(([l]) => l === lang())?.[1] ?? "English", act: () => openLanguages(), help: () => tr("Switch the game's language") };
let langWin: PageWindow | null = null;
function openLanguages() {
  if (langWin) return langWin.close();
  langWin = pageWindow(
    "langPanel",
    tr("Language"),
    `<div class="langList">${LANGS.map(([l, name]) => `<button type="button" class="langPick${l === lang() ? " on" : ""}" data-lang="${l}" aria-pressed="${l === lang()}"><b>${l.toUpperCase()}</b>${name}</button>`).join("")}</div>`,
    { onClose: () => (langWin = null) },
  );
  langWin.box.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((b) => b.addEventListener("click", () => (applyLanguage(b.dataset.lang as (typeof LANGS)[number][0]), langWin?.close())));
  void showSources(langWin);
}

/** Under each language, where its words come from on this server and, for one still missing, a button fetching it. */
async function showSources(win: PageWindow) {
  const sources = await langSources();
  if (!sources || langWin !== win) return;
  win.box.querySelector(".langList")?.classList.add("withNotes");
  for (const b of win.box.querySelectorAll<HTMLButtonElement>("[data-lang]")) {
    const s = sources[b.dataset.lang ?? ""];
    if (!s) continue;
    const note = Object.assign(document.createElement("small"), { className: `langNote${s.full ? " full" : ""}`, textContent: s.note });
    b.append(note);
    if (!s.add) continue;
    const row = Object.assign(document.createElement("div"), { className: "langRow" });
    b.replaceWith(row);
    row.append(b);
    const add = Object.assign(document.createElement("button"), { type: "button", className: "langAdd", textContent: tr("Fetch") });
    add.addEventListener("click", async () => {
      add.disabled = true;
      add.textContent = tr("Fetching…");
      try {
        await s.add!();
        note.textContent = tr("Ready");
        add.remove();
      } catch (e) {
        add.disabled = false;
        add.textContent = tr("Fetch");
        note.textContent = String((e as Error).message ?? e);
      }
    });
    row.append(add);
  }
}

/**
 * ☰ → Play (2026-10-27, instead of the Tools list): jumps to the main menu, a map, a battle or a campaign, and, on
 * the map or in a battle, that page's own set-up (the armies, the map) brought into the window while it is open.
 */
let playWin: PageWindow | null = null;
const JUMPS: [id: string, ico: string, name: () => string][] = [
  ["navMenu", "home", () => tr("Main menu")],
  ["navMap", "map", () => tr("Map")],
  ["navBattle", "battle", () => tr("Battle")],
  ["navCampaign", "campaign", () => tr("Campaigns")],
];
function openPlay() {
  if (playWin) return playWin.close();
  const setup = ["battleControls", "mapControls"].map((id) => $(id)).find((el) => el && !el.hidden && el.childElementCount);
  const more = ["navComplete"] as const;
  playWin = pageWindow(
    "playPanel",
    tr("Play"),
    `<div class="playJumps">${JUMPS.map(([id, ico, name]) => `<div class="cell"><button type="button" class="tile" data-go="${id}" data-ico="${ico}">${name()}</button><span class="cap">${name()}</span></div>`).join("")}</div>
    ${setup ? `<div class="playSetup"><b>${tr("Set it up")}</b></div>` : ""}
    <div class="playMore">${extra("advancedStarts") ? `<button type="button" class="item" data-week3>${tr("Week three (mid-game, one rival)")}</button>` : ""}${more.map((id) => `<button type="button" class="item" data-go="${id}">${$(id)?.textContent?.trim() ?? id}</button>`).join("")}</div>`,
    {
      onClose: () => {
        // The page's own set-up goes back where its page keeps it.
        if (setup && home) home.parent.insertBefore(setup, home.next);
        playWin = null;
      },
    },
  );
  const home = setup ? { parent: setup.parentElement!, next: setup.nextSibling } : null;
  if (setup) playWin.box.querySelector(".playSetup")!.append(setup);
  applyIcons(playWin.box);
  // Straight into a new game a fortnight in, on a small map for two (2026-10-27: the computer's moves without the
  // early game): New Game's first advanced start, a new map each time.
  playWin.box.querySelector<HTMLElement>("[data-week3]")?.addEventListener("click", async () => {
    playWin?.close();
    closeMenuViews();
    const { ADVANCED_STARTS } = await import("../ui/newGame.ts");
    const { templatedMapInfo } = await import("../ui/newGameParts.ts");
    const info = await templatedMapInfo({ ...ADVANCED_STARTS[0], seed: Math.floor(Math.random() * 1e6) });
    location.hash = `#map?map=${encodeURIComponent(info.file)}`;
  });
  playWin.box.querySelectorAll<HTMLElement>("[data-go]").forEach((b) =>
    b.addEventListener("click", () => {
      playWin?.close();
      closeMenuViews();
      $(b.dataset.go!)?.click();
    }),
  );
}

const PLAY: Tile[] = [
  { key: "play", ico: "play", name: () => tr("Play"), act: () => openPlay(), help: () => tr("Jump to the main menu, a map or a battle, and set up the one you are in") },
  { key: "options", ico: "sysopt", name: () => $("menuSysOptions")?.textContent?.trim() || tr("System Options"), act: press("menuSysOptions"), shown: there("menuSysOptions"), help: helpOf("menuSysOptions") },
  { key: "seats", ico: "give", name: () => tr("Players"), act: press("menuSeats"), shown: there("menuSeats") },
  // A phone: one tap turns the game (2026-10-25: no picker for it), and held sideways a small choice of thumbs. A
  // computer keeps the pictures of every layout.
  { key: "rotate", ico: "turn", name: () => tr("Rotate"), act: () => void turnScreen(), shown: () => touchNow(), help: () => tr("Turn the game between upright and sideways") },
  { key: "thumbs", ico: "layout", name: () => tr("One-handed"), act: () => toggleThumbs(), shown: () => false && touchNow() && !heldUpright() && !screenSize.portrait && !screenSize.sideways, help: () => tr("Held sideways: both hands, or one thumb, left or right") },
  { key: "layout", ico: "layout", name: () => tr("Layouts"), act: () => toggleLayouts(), shown: () => !touchNow(), help: () => tr("Switch the layout: desktop, phone, upright, one-handed") },
  { key: "sound", ico: "sound", name: () => (isMuted() ? tr("Sound: off") : tr("Sound: on")), act: () => setMuted(!isMuted()), keep: true, help: () => tr("Mute or unmute the game's music and sounds") },
  { key: "full", ico: "full", name: () => tr("Full screen"), act: press("menuFull"), shown: there("menuFull"), help: () => tr("The game fills the whole screen; press again to leave") },
  { key: "chat", net: true, ico: "chat", name: () => $("chatOpen")?.textContent?.trim() || tr("Chat"), act: press("chatOpen"), shown: there("chatOpen"), badge: () => /\((\d+\+?)\)/.exec($("chatOpen")?.textContent ?? "")?.[1] ?? "", help: helpOf("chatOpen") },
  // A player's other devices (gate.ts): a one-time code or QR code signs one into the same account.
  // The whole game onto this device (2026-10-27: "easier to find"; it was in Settings and the dev list only), its
  // badge how far a download is that goes on while playing.
  { key: "offline", ico: "down", name: () => tr("Play offline"), act: press("offline"), shown: () => "caches" in window, badge: offlineProgress, help: helpOf("offline") },
  { key: "device", net: true, ico: "device", name: () => tr("Add a device"), act: press("fbDevice"), shown: there("fbDevice"), help: helpOf("fbDevice") },
  { key: "notes", ico: "notes", name: () => tr("My notes"), act: press("fbMine"), shown: () => !!$("fbMine"), help: helpOf("fbMine") },
  LANG_TILE,
  { key: "settings", ico: "gear", name: () => tr("Settings"), act: press("options"), help: helpOf("options") },
  { key: "catalog", ico: "wiki", name: () => tr("Wiki"), act: press("fbCatalog"), shown: there("fbCatalog"), help: () => tr("Every part of the game with its page: units, heroes, spells, buildings, map objects, the views in every layout, how the computer plays; send feedback about any of them") },
];

// i18n-ok (the owner's own tools)
const OWNER: Tile[] = [
  { key: "review", net: true, ico: "review", name: () => $("fbReview")?.textContent?.trim() || "Review notes", shown: owner, act: () => goTo("#review"), badge: () => /\((\d+)\)/.exec($("fbReview")?.hidden ? "" : ($("fbReview")?.textContent ?? ""))?.[1] ?? "", help: () => "The notes waiting for your review (/__review)" }, // i18n-ok
  { key: "invite", net: true, ico: "give", name: () => "Invite a player", shown: owner, act: press("fbInvite"), help: helpOf("fbInvite") }, // i18n-ok
  { key: "admin", net: true, ico: "admin", name: () => "Admin", shown: owner, act: press("fbAdmin"), help: () => "Players, invites, API keys, pushes (/__admin)" }, // i18n-ok
  { key: "astester", net: true, ico: "play", name: () => "Play as a new player", shown: owner, act: press("menuAsTester"), help: () => "Be a new or a returning player on this device" }, // i18n-ok
  // Playing as a player (asTesterMode.ts): the row holds only the way back.
  { key: "back", ico: "prev", name: () => "Back to owner", shown: there("menuBackOwner"), act: press("menuBackOwner"), help: () => "Leave the test player: your own games and tools" }, // i18n-ok
];

/** A touch screen (the phone's tiles), not a mouse. */
const touchNow = () => matchMedia("(pointer: coarse)").matches || screenSize.touch;

let root: HTMLElement | null = null;
let status: HTMLElement | null = null;

/** The status line: the tile's name, else the build. */
function say(text?: string) {
  if (status) status.textContent = text ?? `${isOffline() && extra("netStatus") ? `${tr("Offline")} · ` : ""}${previewSlug ? `⎇ ${previewSlug} · ` : ""}${$("menuVersion")?.textContent ?? ""}`; // i18n-ok
}

function tiles(list: Tile[]): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "iconGrid";
  for (const t of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.dataset.ico = t.ico;
    b.dataset.key = t.key;
    if (t.keep) b.dataset.keep = "";
    if (t.net) b.dataset.net = "";
    b.addEventListener("pointerenter", () => say(explain(t)));
    b.addEventListener("pointerleave", () => say());
    b.addEventListener("focus", () => say(explain(t)));
    b.addEventListener("click", () => {
      // Counted (`agent.py usage`): which ☰ tiles are really used, so unused ones can go.
      track(`tile:${t.key}`);
      // A ☰ item takes the place of the menu view open (chrome/layers.ts): a game window (System Options) is then not under it.
      if (!t.keep) closeMenuViews();
      t.act();
      if (t.keep) (refresh(), say(explain(t)));
    });
    // The name under the tile (2026-10-24: "I have no idea what they mean").
    const cell = document.createElement("div");
    cell.className = "cell";
    const cap = document.createElement("span");
    cap.className = "cap";
    cell.append(b, cap);
    grid.append(cell);
  }
  return grid;
}

/** The tiles' state as the menu opens: which apply here, the switches' faces, the counts. */
function refresh() {
  if (!root) return;
  for (const t of [...PLAY, ...OWNER]) {
    const b = root.querySelector<HTMLButtonElement>(`[data-key="${t.key}"]`);
    if (!b) continue;
    b.parentElement!.hidden = t.shown ? !t.shown() : false;
    const name = t.name();
    b.nextElementSibling!.textContent = name;
    b.title = explain(t);
    b.setAttribute("aria-label", name);
    if (t.key === "sound") (b.dataset.glyph = "♪"), isMuted() ? (b.dataset.off = "") : delete b.dataset.off;
    if (t.key === "lang") b.dataset.glyph = lang().toUpperCase();
    const n = t.badge?.() ?? "";
    b.dataset.badge = n;
    b.classList.toggle("badged", !!n);
  }
  const own = owner() || there("menuBackOwner")();
  root.querySelector<HTMLElement>(".ownerRule")!.hidden = !own;
  root.querySelector<HTMLElement>(".iconOwner")!.hidden = !own;
  root.querySelector<HTMLElement>(".iconBlocks")!.classList.toggle("withOwner", own);
  // (The Tools list stays the classic menu's: ☰ → Play has its jumps here.)
  const list = $("menuMoreList");
  if (list) list.hidden = true;
  say();
}

function show() {
  const on = extra("iconMenu");
  $("toolbar")?.classList.toggle("icons", on);
  if (root) root.hidden = !on;
}

export function setupIconMenu() {
  const menu = $("toolbar");
  if (!menu) return;
  root = document.createElement("div");
  root.id = "iconMenu";
  const blocks = document.createElement("div");
  blocks.className = "iconBlocks";
  const play = document.createElement("div");
  play.className = "iconPlay";
  play.append(tiles(PLAY));
  const own = document.createElement("div");
  own.className = "iconOwner";
  // (The owner's own tools stay English: no translation, and tools/i18n/coverage.ts doesn't count them.)
  own.dataset.noI18n = "";
  const rule = document.createElement("div");
  rule.className = "ownerRule";
  rule.textContent = "Owner"; // i18n-ok (the owner's own tools)
  own.append(rule, tiles(OWNER));
  blocks.append(play, own);
  const line = document.createElement("div");
  line.className = "iconStatus";
  status = document.createElement("span");
  const reload = document.createElement("button");
  reload.type = "button";
  reload.dataset.ico = "swap";
  reload.title = tr("Reload (the game is kept)");
  reload.addEventListener("pointerenter", () => say(reload.title));
  reload.addEventListener("pointerleave", () => say());
  reload.addEventListener("click", press("menuReload"));
  line.append(status, reload);
  root.append(blocks, line);
  menu.prepend(root);
  show();
  onSettings(show);
  onMenuOpen(() => extra("iconMenu") && refresh());
  // (The download's badge moving while the menu is open.)
  onOfflineProgress(() => root && extra("iconMenu") && refresh());
  onNetChange(() => root && extra("iconMenu") && refresh());
  // How to… and About are the Wiki's first tiles now (catalog/page.ts presses these).
  $("menuAbout")?.addEventListener("click", () => openCreditsHere());
}
