// The adventure screen's saved games: the original's Save and Load windows (saved games listed
// like scenarios, with their map's card), HD's quick load, and the offer to carry on with a newer
// game from another device (cloudSaves.ts).
import { englishLine } from "../ui/gameText.ts";
import { FACTIONS, dateParts } from "@heroes/core";
import { type AdventureState, isSceneFile } from "@heroes/core";
import { type CloudMeta, ago, cloudList, cloudLoad, elsewhere, forgetLocal, pushSave, thisDevice, worthKeeping } from "../cloudSaves.ts";
import { extra } from "../settings.ts";
import { type GameSummary, summarize } from "../gameSummary.ts";
import { listSaves, loadSave, saveGame } from "../saves.ts";
import { type Modals } from "../ui/modals.ts";
import { YES_NO, messageBox as dialog } from "../ui/dialogs.ts";
import { mobileSaveLoad } from "../ui/mobileScenarios.ts";
import { scenarioSelect } from "../ui/scenarioSelect.ts";
import { type MapInfo } from "../ui/newGameModel.ts";
import { screenSize } from "../ui/screen.ts";
import { lang, tr, fallback, said, fmt, type Text } from "../i18n/index.ts";
import { type MyGame, fetchMyGames } from "../mp.ts";
import { IMPORT_ENTRY, importOriginalSaveFile } from "./importSave.ts";
import { gameId } from "../timeline/model.ts";
import { games as timelineGames, goTo, record } from "../timeline/store.ts";
import { NOW, ago as when } from "../ui/timelineStrip.ts";
import type { H3Map } from "@heroes/formats";

/** What the saved games need from the map screen. */
export interface SavedGamesHost {
  modals: Modals;
  heroNames: string[];
  /** The colour windows are drawn in. */
  color: () => number;
  /** The game on screen, and what a save of it holds (hot seat: everyone's whole state). */
  state: () => AdventureState | null;
  savable: () => AdventureState | null;
  mapName: () => string | undefined;
  /** In a multiplayer room (the host keeps those games). */
  multiplayer: () => boolean;
  /** The battle on screen's windows, if one is. */
  battleModals: () => Modals | null;
  /** The scenario list (loaded once), and one map's entry in it (random maps made up). */
  mapsInfo: () => Promise<MapInfo[]>;
  infoFor: (file: string, byFile?: Map<string, MapInfo>) => MapInfo | undefined;
  /** A line of the game's own text (genrltxt). */
  gameLine: (id: number, ...args: string[]) => Promise<Text | null>;
  /** Opens a saved game; false when its map can't be had. */
  open: (file: string, saved: AdventureState) => Promise<boolean | void>;
  /** When this device last played (the other device's game is offered when newer); with a value, sets it. */
  playedAt: (at?: number) => number;
  /** Takes the loading screen down (a question asked while the game is still opening is seen, not hidden under it). */
  loaded?: () => void;
  /** Opens a multiplayer game I'm in (its room). */
  openRoom?: (id: string) => void;
  /** A scenario's map (for an original's save carried on here). */
  loadMap: (file: string) => Promise<H3Map>;
  /** The Load window over the main menu's picture (the menu's Load Game), not over its own backdrop. */
  overMenu?: boolean;
}

/** A game with friends in the saved games' list: whose turn, with whom, what day. */
export function roomTitle(g: MyGame): Text {
  const others = said(g.room.players.filter((p) => p.seat !== g.seat).map((p) => p.name).join(", ")) || tr("nobody yet");
  const state = !g.room.started ? tr("not started") : g.over ? tr("game over") : g.myTurn ? tr("YOUR TURN") : g.waitingFor.length ? tr("waiting for %1", g.waitingFor.join(", ")) : tr("waiting");
  // (Whose move first: the original's list cuts a long name short.)
  // ("waiting for the owner" already says with whom, when it's everyone else.)
  const named = g.waitingFor.length && g.waitingFor.length === g.room.players.length - 1;
  return fmt`${state}${named ? said("") : fmt`, ${tr("with %1", others)}`}${g.day ? fmt` (${said(dayLine(g.day))})` : said("")}`;
}

/** "month 1, week 2, day 3" inside a line, in the interface's language (German keeps its nouns capitalised). */
export const dayLine = (day: number) => {
  const d = tr("Month %1, Week %2, Day %3", ...dateParts(day));
  return lang() === "de" ? d : d.toLowerCase();
};

/** A game with friends at a glance: the host's summary of my colour, or before the start my seat and the town I picked. */
export function roomSummary(g: MyGame): GameSummary {
  if (g.summary) return g.summary;
  const faction = FACTIONS.indexOf(g.room.players.find((p) => p.seat === g.seat)?.faction ?? "");
  return { color: g.seat, faction, heroes: 0, towns: 0, events: [] };
}

/** The game this browser was last playing (the map page keeps it as it goes), if any. */
export function localGame(): AdventureState | undefined {
  try {
    const s = JSON.parse(localStorage.getItem("heroes.adv.v1") ?? "null") as AdventureState | null;
    // (A test scene kept before they were left out: dropped.)
    if (s && isSceneFile(s.mapFile)) return void localStorage.removeItem("heroes.adv.v1");
    return s && s.winner === undefined ? s : undefined;
  } catch {
    return undefined;
  }
}

/** A game picked in the main menu's Load Game, handed to the map page across the page change ("#map?loaded"). */
const LOADED_KEY = "heroes.loadedGame";
/** False when the tab's storage won't hold it (the map page's own Load window is the way then). */
export function handOverGame(state: AdventureState): boolean {
  try {
    sessionStorage.setItem(LOADED_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
export function takeGame(): AdventureState | null {
  try {
    const v = sessionStorage.getItem(LOADED_KEY);
    sessionStorage.removeItem(LOADED_KEY);
    return v ? (JSON.parse(v) as AdventureState) : null;
  } catch {
    return null;
  }
}

/**
 * Other devices' games worth listing (as "My games"): kept, with another person, or past the first
 * week, and the three newest games in progress (to carry one over); quick tries and tests stay out.
 */
function tidy(metas: CloudMeta[]): CloudMeta[] {
  if (!extra("asyncGames")) return metas;
  const recent = new Set(metas.filter((m) => m.slot.startsWith("current-")).sort((a, b) => b.savedAt - a.savedAt).slice(0, 3));
  return metas.filter((m) => recent.has(m) || worthKeeping(m));
}

/** The question offering another device's newer game (here and on the main menu). */
export const offerLine = (other: CloudMeta) => tr(`Continue the game from your %1?\n\n%2, %3 (played %4).`, other.device, other.name, dayLine(other.day), ago(other.savedAt));

export class SavedGames {
  /** Games opened on this page so far: the start-up's own choice steps aside for one opened meanwhile. */
  opens = 0;
  private offering = false;
  // Another game opened meanwhile (New game, a save): the offer is taken down, unanswered.
  private offerShown: AbortController | null = null;

  private readonly host: SavedGamesHost;

  constructor(host: SavedGamesHost) {
    this.host = host;
  }

  /** A game is being opened: the other device's offer, if up, goes. */
  opened() {
    this.opens++;
    this.offerShown?.abort();
  }

  /** The saved games as scenario entries: this device's, then (unless saving) other devices' games. */
  private async savesAsMaps(others = true) {
    // (Asked meanwhile: the host's answer takes a moment.)
    const rooms = others && extra("asyncGames") && this.host.openRoom ? fetchMyGames() : Promise.resolve([]);
    const mapsInfo = await this.host.mapsInfo();
    const saves = await listSaves();
    const byFile = new Map(mapsInfo.map((m) => [m.file, m]));
    const items: MapInfo[] = [];
    const card = (file: string) => this.host.infoFor(file, byFile) ?? { name: file, description: "", size: 0, levels: 1, version: 28, hota: 0, difficulty: 1, victory: -1, loss: -1, players: [] };
    // This device's game in progress first: the way back to it after the browser's Back (a swipe on
    // Android) left it for the menu, which then had no word of it.
    // Games as timelines: each game once, its points in its card; the game being played here goes on past its last point.
    const timeline = others && extra("timeline");
    const current = others ? localGame() : undefined;
    if (timeline) {
      const playing = this.host.state();
      const here = playing && !this.host.multiplayer() ? gameId(playing) : current ? gameId(current) : "";
      for (const g of await timelineGames()) {
        const now = g.id === here && !g.over && this.host.playedAt() > g.updatedAt + 1500;
        items.push({ ...card(g.mapFile), name: g.name || card(g.mapFile).name, file: `tl:${g.id}`, title: said(g.name), game: g.summary, sub: fmt`${said(dayLine(g.day))} · ${when(g.updatedAt)}`, timeline: { game: g, now } });
      }
      // The game running on another device (the newest): first, as it is there this moment (a battle in it
      // goes on where it was; the timeline's points are only its days, battles and towns).
      const me = thisDevice().id;
      const other = (await cloudList()).find((m) => m.slot.startsWith("current-") && m.deviceId !== me);
      // ("live:", not "cloud:": in the list itself, not behind the other devices' button.)
      if (other) items.unshift({ ...card(other.mapFile), name: other.name, file: `live:${other.slot}`, title: fmt`${tr("Game in progress")} (${said(other.device)}, ${ago(other.savedAt)})`, game: other.summary, sub: fmt`${said(dayLine(other.day))} · ${said(other.device)}, ${ago(other.savedAt)}` });
    } else if (current) items.push({ ...card(current.mapFile), file: "local:current", title: fmt`${tr("Game in progress")} (${said(dayLine(current.day))})`, game: summarize(current), sub: said(dayLine(current.day)) });
    // Games with friends (the multiplayer host keeps them): those waiting for my move first.
    const mine = (await rooms).filter((g) => !g.over).sort((a, b) => Number(b.myTurn) - Number(a.myTurn));
    items.unshift(...(mine.map((g) => ({ ...card(g.room.map), file: `room:${g.room.id}`, title: roomTitle(g), game: roomSummary(g), sub: roomTitle(g), turn: g.myTurn }))));
    for (const x of saves) items.push({ ...card(x.mapFile ?? ""), file: `save:${x.id}`, title: said(x.name), game: x.summary, sub: x.day ? said(dayLine(x.day)) : said(x.name) });
    // Other devices' games (cloudSaves.ts): their saves and the game running there.
    // Not when saving: a name tapped there is what the save is called, and those games are loaded, not written over.
    const me = thisDevice().id;
    for (const m of others && !timeline ? tidy((await cloudList()).filter((m) => m.deviceId !== me)) : []) {
      const what = m.slot.startsWith("current-") ? tr("Game in progress") : said(m.name);
      items.push({ ...card(m.mapFile), file: `cloud:${m.slot}`, title: fmt`${what} (${said(m.device)}, ${ago(m.savedAt)})`, game: m.summary, sub: fmt`${said(dayLine(m.day))} · ${said(m.device)}, ${ago(m.savedAt)}` });
    }
    // Last, the way in for a saved game of the original (HotA / SoD .GM1) from this device.
    if (false) {
          const description = tr("Choose a saved game of Heroes III (Horn of the Abyss or Shadow of Death, a .GM1 file) on this device and play it on here. LOAD opens the file picker.");
      items.push({ ...card(""), name: tr("Saved game of the original"), description, file: IMPORT_ENTRY, title: tr("Import a HotA save (.GM1)…") });
    }
    return { saves, items };
  }

  async save() {
    const { modals, color } = this.host;
    const state = this.host.state();
    if (!state || this.host.multiplayer()) return void dialog(modals, tr("Multiplayer games are kept by the host."), color());
    // Games as timelines: nothing to save by hand; Save opens this game's timeline (where it is, and the way back).
    if (extra("timeline")) return void (await this.load(`tl:${gameId(state)}`));
    const { saves, items } = await this.savesAsMaps(false);
    const name = `${this.host.mapName() || state.mapFile} - ${dayLine(state.day)}`;
    const current = this.host.infoFor(state.mapFile);
    const choice = screenSize.touch ? await mobileSaveLoad(modals, items, "save", name) : await scenarioSelect(modals, items, undefined, this.host.heroNames, "save", name, current);
    if (!choice?.name) return;
    // The same name again overwrites that save, as in the original.
    const same = saves.find((x) => x.name === choice.name);
    try {
      await saveGame(choice.name, this.host.savable()!, same?.id);
      pushSave(choice.name, this.host.savable()!);
      await dialog(modals, (await this.host.gameLine(350, choice.name)) ?? fallback(`"${choice.name}" saved.`), color());
    } catch {
      await dialog(modals, tr("The browser refused to store the game."), color());
    }
  }

  private quickSaveId: number | undefined;
  /** HD's quick save (F8): one "Quicksave", written over each time. */
  async quickSave() {
    const st = this.host.savable();
    if (!st) return;
    pushSave("Quicksave", st);
    await saveGame("Quicksave", st, this.quickSaveId);
    this.quickSaveId = (await listSaves()).find((x) => x.name === "Quicksave")?.id;
  }

  /**
   * HD's quick load (F9): the "Quicksave" F8 keeps. In a battle it first asks, as the original's Load
   * Game does, that the game in progress be given up; with none saved yet it says so.
   */
  async quickLoad() {
    const battle = this.host.battleModals();
    const modals = battle ?? this.host.modals;
    const q = (await listSaves()).find((x) => x.name === "Quicksave");
    if (!q) return void dialog(modals, tr("There is no quick save yet: F8 saves the game here, F9 loads it."), this.host.color());
    if (battle) {
      const yes = await dialog(modals, (await this.host.gameLine(68)) ?? englishLine("genrltxt", 68), this.host.color(), {
        buttons: [{ def: "iokay.def", value: "ok" }, { def: "icancel.def", value: "cancel" }],
      });
      if (yes !== "ok") return;
    }
    const saved = await loadSave(q.id);
    if (saved) await this.host.open(saved.mapFile, saved);
  }

  /** The Load window (with a game picked to begin with); true when a game was opened from it. */
  async load(focus?: string): Promise<boolean> {
    const { modals } = this.host;
    const { items } = await this.savesAsMaps();
    if (!items.length) {
      await dialog(modals, (await this.host.gameLine(685)) ?? fallback("There are no saved games yet."), this.host.color());
      return false;
    }
    const over = !!this.host.overMenu;
    const choice = screenSize.touch || extra("asyncGames") || extra("timeline") ? await mobileSaveLoad(modals, items, "load", "", focus, over) : await scenarioSelect(modals, items, items[0].file, this.host.heroNames, "load", "", undefined, 1, undefined, over);
    if (choice?.file.startsWith("room:")) return (this.host.openRoom?.(choice.file.slice(5)), true);
    if (choice?.file.startsWith("tl:")) return this.openPoint(choice.file.slice(3), choice.point);
    if (choice?.file === IMPORT_ENTRY) return importOriginalSaveFile(this.host);
    const cloud = /^(cloud|live):(.*)$/.exec(choice?.file ?? "")?.[2];
    if (!choice || (!choice.file.startsWith("save:") && !cloud && choice.file !== "local:current")) return false;
    const saved = choice.file === "local:current" ? localGame() : cloud ? await cloudLoad(cloud) : await loadSave(Number(choice.file.slice(5)));
    if (saved) await this.host.open(saved.mapFile, saved);
    return !!saved;
  }

  /**
   * A game's point picked on its timeline: where it was left (NOW) is the game kept here, else the
   * point's state. The game on screen first keeps where it is as a point, so it can be come back to.
   */
  private async openPoint(game: string, point?: string): Promise<boolean> {
    const playing = this.host.savable();
    if (point === NOW || !point) {
      const st = playing && gameId(playing) === game && !this.host.multiplayer() ? playing : localGame();
      if (st && gameId(st) === game) return st === playing ? true : !!(await this.host.open(st.mapFile, st));
    }
    if (playing && !this.host.multiplayer()) await record(playing, { name: this.host.mapName() || playing.mapFile, yourMove: false, here: true }).catch(() => null);
    try {
      const target = point && point !== NOW ? point : (await timelineGames()).find((g) => g.id === game)?.head;
      if (!target) return false;
      const st = await goTo(game, target);
      return !!(await this.host.open(st.mapFile, st));
    } catch {
      await dialog(this.host.modals, tr("This point of the game couldn't be had: it is on another device that hasn't sent it yet."), this.host.color());
      return false;
    }
  }

  /**
   * Another device has a newer running game (cloudSaves.ts): offer to carry on with it here. A "no"
   * isn't asked again until that device plays on. True when a game was opened (that one, or another
   * one meanwhile, which takes the offer down).
   */
  async offerElsewhere(local: AdventureState | null | undefined = this.host.state()): Promise<boolean> {
    if (this.host.multiplayer() || this.offering || !extra("deviceOffer")) return false;
    this.offering = true;
    const shown = (this.offerShown = new AbortController());
    const opened = this.opens;
    try {
      const other = await elsewhere(local, this.host.playedAt());
      // (Withdrawn: another game is already open, so none is to be started here.)
      if (this.opens !== opened) return true;
      if (!other) return false;
      // The game going on here was played on there since (this device put down mid-game, 2026-11-02): it
      // carries on from there, no question; finished there, it's over here too: to the main menu.
      if (other.kind === "over") {
        forgetLocal();
        this.host.loaded?.();
        await dialog(this.host.modals, tr("This game was finished on your %1.", other.meta.device), this.host.color(), { signal: shown.signal });
        if (!shown.signal.aborted) location.hash = "#menu";
        return true;
      }
      if (other.kind === "newer") return !!(await this.host.open(other.state.mapFile, other.state));
      this.host.loaded?.();
      const answer = await dialog(this.host.modals, offerLine(other.meta), this.host.color(), {
        buttons: YES_NO,
        signal: shown.signal,
      });
      this.offerShown = null;
      if (shown.signal.aborted) return true;
      if (answer !== "yes") {
        this.host.playedAt(Date.now());
        return false;
      }
      // (Its map missing here: this device's own game instead.)
      return !!(await this.host.open(other.state.mapFile, other.state));
    } catch {
      return false;
    } finally {
      this.offering = false;
      this.offerShown = null;
    }
  }
}
