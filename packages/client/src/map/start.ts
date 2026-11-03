// Opening a game on the adventure map: a new one or a save (the loading screen's steps, the first
// update awaited, the map drawn at our hero), a multiplayer room's, a campaign scenario's (and its
// ending), the way in the page's address asks for (boot), and "&ai=<days>": the computer playing our side.
import { type AdventureState, type CampaignStart, battleFor, canAct, carryOver, isSceneFile, parseCampaignRef, parseRandomMapName, persistentVars, randomMapTitle, readCampaign, CAMPAIGN_OUTRO } from "@heroes/core";
import { h3mFormatName } from "@heroes/formats";
import { extra } from "../settings.ts";
import { tr, said } from "../i18n/index.ts";
import { messageBox as dialog } from "../ui/dialogs.ts";
import { screenSize } from "../ui/screen.ts";
import { loadingScreen } from "../ui/loadingScreen.ts";
import { track as step } from "../ui/loadSteps.ts";
import { advancedStarts, pickNewGame, quickGameChoice, takeChoice } from "../ui/newGame.ts";
import { type ScenarioChoice } from "../ui/newGameModel.ts";
import { fetchMapsInfo } from "../ui/newGameParts.ts";
import { fullVideo, prologue } from "../ui/prologue.ts";
import { closeSeats } from "./seats.ts";
import { reportFirstMap } from "../firstMap.ts";
import { starterMap } from "../starterMap.ts";
import { loadFonts } from "../text.ts";
import { playMusic } from "../audio.ts";
import { fetchRes, heroPortrait } from "../assets.ts";
import { cloudLoad } from "../cloudSaves.ts";
import { PENDING, loadProgress, saveProgress } from "../campaign/page.ts";
import { preloadHudArt } from "./hud.ts";
import { takeGame } from "./savedGames.ts";
import { loadMap } from "./loadMap.ts";
import { SAVE_KEY, storage, unstore } from "./storage.ts";
import { type MapSession, TERRAIN_MUSIC } from "./session.ts";

export class MapStart {
  /** A game is being opened: an error from the server means it couldn't be (openFailed). */
  resuming = false;
  openFailed: string | undefined;
  /** The save being opened (an error report carries it while there's no game yet). */
  opened: AdventureState | undefined;
  private readonly s: MapSession;

  constructor(s: MapSession) {
    this.s = s;
  }

  /** The page bar's map list: the advanced starts (random maps begun weeks in) on top, as in New Game; then the map files. */
  async fillMapList() {
    const { select } = this.s.bar;
    const files = this.s.files;
    if (extra("advancedStarts")) {
      const group = document.createElement("optgroup");
      group.label = "Advanced starts";
      const seed = Math.floor(Math.random() * 1e6);
      for (const m of await advancedStarts(seed)) group.append(new Option(m.name, m.file));
      const maps = document.createElement("optgroup");
      maps.label = "Maps";
      for (const f of files) maps.append(new Option(f.replace(/\.h3m$/i, ""), f));
      select.append(group, maps);
    } else for (const f of files) select.add(new Option(f.replace(/\.h3m$/i, ""), f));
  }
  /** Shows a map in the list, adding it when it isn't a plain map file (a campaign scenario). */
  private selectFile(file: string) {
    const { select } = this.s.bar;
    if (![...select.options].some((o) => o.value === file)) {
      const c = parseCampaignRef(file);
      const r = parseRandomMapName(file);
      const name = c ? `Campaign ${c.file.replace(/\.h3c$/i, "")}, scenario ${c.scenario + 1}` : r ? randomMapTitle(r).name : file;
      select.add(new Option(name, file), 0);
    }
    select.value = file;
  }

  /** Where the view opens: our hero, else our first town (drawn first on a big map). */
  private openingSpot(st: AdventureState, h: AdventureState["heroes"][number] | undefined) {
    if (h) return { x: h.x, y: h.y };
    const t = st.objects.find((o) => o?.town && !o.removed && o.owner === this.s.me());
    return t ? { x: t.x, y: t.y } : undefined;
  }

  /** Waits for the first update of the game being opened (the inbox sets the state). */
  private firstState(failed: () => Error | null = () => null) {
    return new Promise<AdventureState>((resolve, reject) => {
      const check = () => {
        if (this.s.state) return resolve(this.s.state);
        const err = failed();
        if (err) return reject(err);
        setTimeout(check, 50);
      };
      check();
    });
  }

  open = async (file: string, saved?: AdventureState, campaign?: CampaignStart, start?: Omit<ScenarioChoice, "file">) => {
    const s = this.s;
    const { view } = s;
    s.savedGames.opened();
    // A game of our own from inside a multiplayer room: out of the room first (it goes on without us).
    if (s.lobby.link) {
      await s.lobby.leave();
      s.mpOverlay.clear();
    }
    // A battle still on screen (a new game started from it) goes with the old game.
    if (s.battle) s.battles.close();
    s.status(tr("Loading…"));
    s.loading ??= loadingScreen(s.app);
    // Nothing of the map until it's built and looking at your hero (no glimpse of the last game,
    // or of this one from the wrong spot before its fog is drawn).
    s.setMapVisible(false);
    try {
      s.state = null;
      s.selected = -1;
      s.walk.forgetRoutes();
      s.hotSeat = -1;
      s.inbox.seatsMenu();
      closeSeats();
      s.fullState = null;
      s.lastBattle = null;
      preloadHudArt(screenSize.touch);
      s.mapReady = step("map", tr("Reading the scenario"), loadMap(file)).then((m) => {
        s.map = m;
        s.world = null;
        s.minimapLevel = -1;
      });
      await s.mapReady;
      s.loading?.progress(0.4);
      if (!isSceneFile(file)) storage("heroes.map", file);
      this.selectFile(file);
      const m = s.map!;
      s.bar.levelBtn.disabled = m.levels < 2;
      // The status bar starts empty, as the original's (the map's name and format go to the console).
      s.status(said(""));
      console.info(`${m.name} · ${h3mFormatName(m.version)} · ${m.size}×${m.size}${m.levels > 1 ? " ×2" : ""}`);
      this.resuming = true;
      this.openFailed = undefined;
      this.opened = saved;
      if (saved) s.send({ t: "advResume", state: saved });
      else {
        // Hot seat (two humans or more here): one player at a time.
        const hot = (start?.controllers?.filter((c) => c === "human").length ?? 0) > 1;
        s.send({ t: "advStart", mapFile: file, seed: (Math.random() * 2 ** 31) | 0, campaign, difficulty: start?.difficulty, controllers: start?.controllers, choices: start?.choices, turnMinutes: start?.turnMinutes, noHota: start?.noHota, rules: start?.rules, turnMode: hot ? "sequential" : undefined });
      }
      // The first update builds the scene.
      const failed = () => (this.openFailed === undefined ? null : new Error(saved ? `${this.openFailed}\n\nThis save may come from an earlier version of the game that this one can't continue. Starting a new game is the way on.` : this.openFailed));
      const first = await step("start", tr("Starting the game"), this.firstState(failed));
      this.resuming = false;
      s.loading?.progress(0.6);
      const h = first.heroes.find((x) => !x.removed && x.owner === s.me());
      // The HUD's frame and our heroes' portraits load while the map is drawn.
      void s.hud.init(s.color()).catch(() => {});
      for (const x of first.heroes) if (!x.removed && x.owner === s.me()) void Promise.all([heroPortrait(x, "small"), heroPortrait(x, "large")]).catch(() => {});
      await step("draw", tr("Drawing the map"), view.show(m, h?.z ?? 0, first, this.openingSpot(first, h)));
      s.loading?.progress(0.85);
      s.selectHero(h);
      // The hero and town lists, the info box and the resources come in with the map, not after it
      // (the loading screen stays up meanwhile; never for good if a picture won't load).
      await step("hud", tr("Interface and pictures"), Promise.race([s.hudDrawn.catch(() => {}), new Promise((r) => setTimeout(r, 15000))]));
      reportFirstMap(m.name || file);
      // No hero to start with: the terrain under our first town, so the main menu's music (carried
      // through the scenario list) doesn't go on into the game.
      if (!h) {
        const t = first.objects.find((o) => o?.town && o.owner === s.me());
        const tile = t && m.tiles[(t.z * m.size + t.y) * m.size + t.x];
        playMusic(tile ? (TERRAIN_MUSIC[tile.terrain] ?? "GRASS.MP3") : "GRASS.MP3");
      }
    } catch (err) {
      this.resuming = false;
      s.notice(said(String(err)));
      // A save this build can't open: put aside (heroes.adv.unopened), so the next visit isn't stuck on it.
      if (saved && !s.state) {
        storage("heroes.adv.unopened", JSON.stringify(saved));
        try {
          if (localStorage.getItem(SAVE_KEY)?.length === JSON.stringify(saved).length) localStorage.removeItem(SAVE_KEY);
        } catch {
          // kept
        }
      }
      // (The status line is small or hidden on a phone: say it in a window too.)
      void dialog(s.modals, tr(`The game couldn't be opened.\n\n%1`, err instanceof Error ? err.message : String(err)), 0);
      return false;
    } finally {
      // (Not under a town or battle opened while it loaded: the map showed through the upright town.)
      s.setMapVisible(!s.town.open && !s.battle);
      s.loaded();
      // (A moment later: the map's first frames, and the loading screen's going, come first.)
      setTimeout(() => view.drawRest(), 400);
    }
    return true;
  };

  /** A campaign scenario ended: the epilogue, heroes carried on, back to the campaign screen. */
  async finishCampaignScenario(st: AdventureState, won: boolean) {
    const s = this.s;
    const ref = parseCampaignRef(st.mapFile)!;
    const all = loadProgress();
    const progress = all[ref.file] ?? { file: ref.file, conquered: [], carried: [], difficulty: 1 };
    const c = readCampaign(await fetchRes(`${ref.file}.h3c`));
    const sc = c.scenarios[ref.scenario];
    if (won) {
      if (sc?.epilogue) await prologue(s.modals, sc.epilogue);
      progress.conquered = [...new Set([...progress.conquered, ref.scenario])];
      const heroes = carryOver(st, s.me());
      progress.carried = heroes;
      progress.pools = { ...progress.pools, [ref.scenario]: heroes };
      progress.heroes = [...heroes, ...(progress.heroes ?? []).filter((h) => !heroes.some((x) => x.type === h.type))];
      progress.last = ref.scenario;
      // HotA's script variables marked to keep, for the scenarios after.
      if (s.world) progress.vars = { ...progress.vars, ...persistentVars(st, s.world) };
      progress.finished = c.scenarios.every((x, i) => !x.mapName || progress.conquered.includes(i));
      // (Then the campaign's own ending, as Song for the Father's.)
      if (progress.finished && CAMPAIGN_OUTRO[ref.file]) await fullVideo(s.modals, CAMPAIGN_OUTRO[ref.file]);
      if (progress.finished) await dialog(s.modals, tr(`%1: the campaign is won!`, c.name), s.color());
    } else await dialog(s.modals, tr("The scenario is lost. You may try it again from the campaign screen."), s.color());
    saveProgress(progress);
    try {
      localStorage.removeItem(SAVE_KEY);
      if (!progress.finished) localStorage.setItem("heroes.campaign.open", ref.file);
    } catch {
      // ignore
    }
    location.hash = "#campaign";
  }

  /** Joins a running multiplayer game: load the map, wait for the host's state. */
  openMp = async (file: string) => {
    const s = this.s;
    s.state = null;
    s.selected = -1;
    s.walk.forgetRoutes();
    s.mapReady = loadMap(file).then((m) => {
      s.map = m;
      s.world = null;
    });
    await s.mapReady;
    const m = s.map!;
    this.selectFile(file);
    s.bar.levelBtn.disabled = m.levels < 2;
    const first = await this.firstState();
    const h = first.heroes.find((x) => !x.removed && x.owner === s.me());
    await s.view.show(m, h?.z ?? 0, first, this.openingSpot(first, h));
    s.selectHero(h);
    s.lobby.hide();
    s.view.drawRest();
  };

  /** New game: the original scenario selection screen (map list, scenario card, difficulty); true when a game starts from it. */
  newGameDialog = async () => {
    const s = this.s;
    s.mapsInfo ??= await (s.mapsInfoLoad ??= fetchMapsInfo());
    // The advanced starts (core starts.ts) first: random maps begun weeks or months in, a new seed each time.
    // (No game drawn yet, as "#map?new": the map played last, not the map list's first.)
    const choice = await pickNewGame(s.modals, (s.map ? s.bar.select.value : storage("heroes.map")) ?? undefined, s.mapsInfo);
    if (choice) void this.open(choice.file, undefined, undefined, choice);
    return !!choice;
  };

  /** Into the game the page's address asks for: a room, an invitation, a game from the menu, else the one going on here. */
  async boot() {
    const s = this.s;
    const { lobby } = s;
    // Every way into a game below can open a message at once (a map's day-one events): with the fonts
    // still loading its text would be drawn empty, so they come first.
    await loadFonts();
    s.loading?.progress(0.2);
    // A game link from another device: show that room and who to continue as.
    const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
    const linked = params.get("room");
    // Rejoin the multiplayer room after a reload; otherwise resume the local game.
    let last: { room: string; name: string } | null = null;
    try {
      last = JSON.parse(storage("heroes.mp") || "null");
    } catch {
      last = null;
    }
    // From the main menu: "?mp" opens the multiplayer lobby (and is dropped from the address, so a
    // reload in a room rejoins it), "?new" the scenario selection.
    if (params.has("mp")) {
      s.loaded();
      history.replaceState(null, "", "#map");
      if (last) lobby.rejoin(last.room, last.name);
      s.bar.mpBtn.click();
      return;
    }
    // A profile's "Invite to play" (community/people.ts): into our room waiting to start, else a new one; the other player told.
    const invite = params.get("invite");
    if (invite) {
      s.loaded();
      history.replaceState(null, "", "#map");
      lobby.inviteTo(invite, params.get("n") || "", last);
      return;
    }
    if (linked) {
      s.loaded();
      lobby.peek(linked);
      return;
    }
    // (A game chosen in the main menu is that game, not the room we were last in: that one waits in Your games.)
    const chosen = !!params.get("map") || !!params.get("cloud") || params.has("quick") || !!params.get("start") || params.has("new") || params.has("load") || params.has("loaded");
    if (last && chosen) storage("heroes.mp", "");
    if (last && !chosen) {
      s.loaded();
      lobby.rejoin(last.room, last.name);
      return;
    }
    // "?map=<file>" (the tutorial from the main menu): start that map.
    if (params.get("map")) {
      const file = params.get("map")!;
      // "&ai=<days>" (the Completeness page's "Watch the AI"): the computer plays our side for that many days.
      const watch = Number(params.get("ai") ?? 0);
      // "&difficulty=0..4" (Pawn to Impossible; Knight otherwise), for checking the AI's levels.
      const difficulty = params.get("difficulty");
      history.replaceState(null, "", "#map");
      await this.open(file, undefined, undefined, difficulty ? { difficulty: Number(difficulty) } : undefined);
      if (watch > 0) void this.watchAi(watch);
      return;
    }
    // "?cloud=<slot>": another device's game, taken up from the main menu's offer (a battle in it goes on where it was).
    if (params.get("cloud")) {
      const st = await cloudLoad(params.get("cloud")!).catch(() => undefined);
      history.replaceState(null, "", "#map");
      if (st && (await this.open(st.mapFile, st)) !== false) return;
    }
    // "?quick": the Quick game (newGame.ts quickGameChoice), straight into it.
    if (params.has("quick")) {
      history.replaceState(null, "", "#map");
      const choice = await quickGameChoice();
      await this.open(choice.file, undefined, undefined, choice);
      return;
    }
    // "?start=<file>": a game chosen in the main menu's New Game (its options handed over in the tab's storage).
    if (params.get("start")) {
      const file = params.get("start")!;
      history.replaceState(null, "", "#map");
      const choice = takeChoice();
      await this.open(file, undefined, undefined, choice?.file === file ? choice : undefined);
      return;
    }
    // "?loaded": a saved game picked in the main menu's Load Game (handed over in the tab's storage).
    if (params.has("loaded")) {
      history.replaceState(null, "", "#map");
      const st = takeGame();
      if (st) {
        await this.open(st.mapFile, st);
        return;
      }
    }
    // "?new" / "?load" from the main menu: the scenario list or the saved games straight away, with no
    // game drawn behind them; cancelling goes back to the main menu, as in the original.
    if (params.has("new") || params.has("load")) {
      history.replaceState(null, "", "#map");
      // The main menu's music carries on through the scenario list, as in the original (the page
      // reloaded on the way here; browsers start it with the first click if they hold it back).
      void playMusic("MAINMENU.MP3", true);
      const started = params.has("new") ? await this.newGameDialog() : await s.savedGames.load();
      if (!started) location.hash = "#menu";
      return;
    }
    await this.resumeLocal();
    // (Nothing to resume after all: the screen goes.)
    s.loaded();
  }

  /** The computer plays our turns, one a few seconds apart so each can be watched, until the day is past. */
  private async watchAi(days: number) {
    const s = this.s;
    s.watching = true;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // A battle where we defend (a rival attacked our town or hero in its turn) waits for our moves:
    // the computer fights it for us too (it froze the watch on day 2 when the enemy came to our town).
    // (Once for each battle as the server last sent it: asked again before the update came back, "no battle".)
    const handed = new WeakSet<object>();
    const autoDefend = () => {
      const b = s.state ? battleFor(s.state, s.me())?.pb.battle : undefined;
      if (!b || handed.has(b)) return;
      handed.add(b);
      b.sides.forEach((x, side) => x.owner === s.me() && x.controller === "human" && s.send({ t: "control", side: side as 0 | 1, controller: "ai" }));
    };
    // (Generous: on a big map the others' turns take a while, and a day can need several of ours.)
    for (let guard = 0; guard < days * 40 && s.state && s.state.day <= days && s.state.winner === undefined; guard++) {
      await wait(2500);
      autoDefend();
      // (A battle on screen plays out first, its results shown a moment; the messages of the last turn, read by now, close.)
      for (let t = 0; t < 240 && s.lastBattle && s.lastBattle.winner === null; t++) await wait(250);
      if (s.battle) (await wait(2500), s.battles.close());
      // (Answered, not just taken down: a message unanswered held up everything after it, the battle screen too.)
      s.modals.okAll();
      const day = s.state.day;
      s.send({ t: "advAiTurn" });
      // Until the next day, or our turn again (the others' turns can take a minute on a big map).
      for (let t = 0; t < 480 && s.state && s.state.day === day && !(t > 8 && canAct(s.state, s.me())); t++) {
        await wait(250);
        if (t % 8 === 0) autoDefend();
      }
    }
  }

  resumeLocal = async () => {
    const s = this.s;
    // A campaign scenario chosen on the campaign screen starts fresh.
    const pending = storage(PENDING);
    if (pending) {
      unstore(PENDING);
      const { ref, start, difficulty } = JSON.parse(pending) as { ref: string; start: CampaignStart; difficulty?: number };
      await this.open(ref, undefined, start, { difficulty: difficulty ?? 1 });
      return;
    }
    let saved: AdventureState | undefined;
    try {
      saved = JSON.parse(storage(SAVE_KEY) ?? "null") ?? undefined;
      // (Kept before scenes were left out: dropped.)
      if (isSceneFile(saved?.mapFile)) (saved = undefined), localStorage.removeItem(SAVE_KEY);
    } catch {
      saved = undefined;
    }
    // A newer game from another device first (unless a game was already opened, by a link or the agent): this
    // one played on there is taken up, finished there goes to the main menu, another game is offered.
    if (s.savedGames.opens || (await s.savedGames.offerElsewhere(saved))) return;
    const initial = saved?.mapFile ?? storage("heroes.map") ?? starterMap(s.files);
    // A saved game always resumes (also on maps outside the list, like the tutorial).
    if (initial && (saved || s.files.includes(initial) || parseCampaignRef(initial))) await this.open(initial, saved);
  };
}
