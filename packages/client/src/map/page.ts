// The adventure map's page: builds the session (session.ts) and its parts, and wires them to the page:
// the page bar, the HUD, the lobby, the town screen, feedback notes, the agent API and dev handles,
// the layout switch. What each part does is in its own file (see session.ts).
import { creditsHost } from "../ui/about.ts";
import { TOWNS, activeUnit, isSceneFile } from "@heroes/core";
import type { ClientMessage } from "@heroes/server";
import type { Application } from "pixi.js";
import { loadData } from "../gameData.ts";
import { AdventureHud, type Hud } from "./hud.ts";
import { viewport } from "./viewport.ts";
import { MobileHud } from "./mobileHud.ts";
import { pickNewGame } from "../ui/newGame.ts";
import { YES_NO, messageBox as dialog } from "../ui/dialogs.ts";
import { onLayout, screenSize } from "../ui/screen.ts";
import { loadFonts } from "../text.ts";
import { loadAdventureCursors } from "../cursors.ts";
import { onBackAtBottom } from "../chrome/layers.ts";
import { setGameOptions } from "../chrome/pageMenu.ts";
import { PLAYED_AT, cloudLoad } from "../cloudSaves.ts";
import { PENDING } from "../campaign/page.ts";
import { loadingScreen, removeSplash } from "../ui/loadingScreen.ts";
import { track as step } from "../ui/loadSteps.ts";
import { setFeedbackMeta } from "../feedback/index.ts";
import { setErrorSnapshot } from "../feedback/errors.ts";
import { logAction, logPlay, setReplaySource } from "../feedback/recent.ts";
import { installAgentApi } from "../agent.ts";
import { fetchMapsInfo, prefetchNewGame } from "../ui/newGameParts.ts";
import { TownScreen } from "../town/screen.ts";
import { fetchRetry } from "../net.ts";
import { tr, fmt, said } from "../i18n/index.ts";
import { isHotaTutorial } from "./tutorial.ts";
import { loadNames } from "./describe.ts";
import { actionText } from "./playLog.ts";
import { noteMove } from "../timeline/moves.ts";
import { gameId } from "../timeline/model.ts";
import { Lobby } from "./lobby.ts";
import { MpOverlay } from "./mpOverlay.ts";
import { SavedGames } from "./savedGames.ts";
import { loadMap } from "./loadMap.ts";
import { SAVE_KEY, storage, storageError } from "./storage.ts";
import { MapSession } from "./session.ts";
import { MapInbox } from "./inbox.ts";
import { MapWalk } from "./walk.ts";
import { MapBattles } from "./battles.ts";
import { MapMessages } from "./messages.ts";
import { AllyFollowing } from "./following.ts";
import { MapReplays } from "./replays.ts";
import { MapStart } from "./start.ts";
import { MapInput } from "./input.ts";
import { SidePanel } from "./panel.ts";

/** The adventure map: pick a scenario, move heroes, fight monsters. */
export async function startMapPage(app: Application, toolbar: HTMLElement, statusEl: HTMLElement) {
  // New Game and Load list the maps: the list (and New Game's pictures) start downloading at once,
  // beside the game's texts and fonts, not after them.
  const opening = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const mapsInfoLoad = opening.has("new") || opening.has("load") ? fetchMapsInfo() : null;
  if (opening.has("new")) prefetchNewGame(false);
  // A game being opened (chosen in the menu, the tutorial, a campaign scenario, the game resumed after
  // a reload): the original's loading screen from the first moment. (Not for a multiplayer room, or
  // New Game / Load's lists: those come up at once.)
  const lists = opening.has("new") || opening.has("load") || opening.has("mp") || opening.has("room") || opening.has("replay") || !!storage("heroes.mp");
  const gameComing = !!(opening.get("start") || opening.get("map") || opening.has("quick")) || (!lists && !!(storage(PENDING) || storage(SAVE_KEY)));
  const loading = gameComing ? loadingScreen(app) : null;
  if (!loading) removeSplash();
  // (The game's tables and fonts download together, not one after another as the page gets to them.)
  void step("data", tr("Game tables and texts"), loadData()).catch(() => {});
  void step("fonts", tr("Fonts"), loadFonts()).catch(() => {});

  const s = new MapSession(app);
  s.loading = loading;
  s.mapsInfoLoad = mapsInfoLoad;
  s.inbox = new MapInbox(s);
  s.walk = new MapWalk(s);
  s.battles = new MapBattles(s);
  s.messages = new MapMessages(s);
  s.allies = new AllyFollowing(s);
  s.replays = new MapReplays(s);
  s.start = new MapStart(s);
  s.input = new MapInput(s);
  s.panel = new SidePanel(s);
  const { view, modals, camera, follow } = s;
  creditsHost(app, modals);
  statusEl.textContent = "";
  // An error report carries the whole game as it was (feedback/errors.ts).
  setErrorSnapshot(() => s.savable() ?? s.start.opened);
  // ...and so does every feedback note (feedback/recent.ts: replay.json.gz, `agent.py replay NOTE`).
  setReplaySource(() => ({ state: s.savable(), battle: s.battle?.shownState }));
  // Every feedback note says where in the game it was written.
  setFeedbackMeta(() => {
    const { state, world, town } = s;
    const h = state?.heroes[s.selected];
    const t = town.open && state ? state.objects.find((x) => x.town && x.id === town.objectId) : undefined;
    return {
      map: state?.mapFile ?? s.map?.name,
      day: state?.day,
      player: s.me(),
      hero: h && !h.removed ? { name: h.name, x: h.x, y: h.y, z: h.z, movement: h.movement, army: h.army.filter(Boolean).map((a) => `${a!.count} ${world?.creatures[a!.creature]?.key ?? a!.creature}`) } : undefined,
      town: t ? { name: t.name, faction: TOWNS[t.subid]?.faction, built: t.town?.built.length } : town.open || undefined,
      battle: s.battle ? true : undefined,
      room: s.lobby.room?.id,
      // Whether a reload would resume this game.
      saved: (storage(SAVE_KEY) ?? "").length,
      storageError: storageError() || undefined,
    };
  });
  // Dev-only handles for debugging from the console / agent browser.
  if (import.meta.env.DEV)
    Object.assign(window, {
      __map: {
        view,
        get hud() {
          return s.hud;
        },
        town: () => s.town,
        state: () => s.state,
        map: () => s.map,
        selected: () => s.selected,
        selectHero: (id: number) => s.selectHero(s.state?.heroes[id]),
        planned: () => s.walk.planned,
        battle: () => s.battle?.shownState ?? null,
        battleView: () => s.battle,
        app,
        townOpen: () => s.town.open,
        send: (m: ClientMessage) => s.send(m),
        market: s.panel.showMarket,
        modals,
        thingsAt: s.input.thingsAt,
        screenToTile: s.input.screenToTile,
        centerOn: s.centerOn,
        world: () => s.world,
        tileClicks: () => s.input.tileClicks,
      },
      __camera: camera,
    });
  camera.userMoved = () => s.allies.letGo();

  // ---- toolbar -------------------------------------------------------------
  const bar = (s.bar = {
    select: document.createElement("select"),
    newGame: Object.assign(document.createElement("button"), { textContent: tr("New game") }),
    levelBtn: Object.assign(document.createElement("button"), { textContent: "Underground (U)" }),
    endTurn: Object.assign(document.createElement("button"), { textContent: tr("End turn (E)") }),
    heroBtn: Object.assign(document.createElement("button"), { textContent: tr("Next hero (H)") }),
    townBtn: Object.assign(document.createElement("button"), { textContent: "Town (T)" }),
    info: document.createElement("span"),
    mpBtn: Object.assign(document.createElement("button"), { textContent: tr("Multiplayer") }),
  });
  bar.info.className = "advInfo";
  // Only the scenario picker stays in the page bar; the game's own buttons are in the HUD.
  toolbar.append(bar.select, bar.newGame);
  s.files = await (await fetchRetry("/maps-index")).json();
  await s.start.fillMapList();

  // ---- game state ------------------------------------------------------------
  s.data = await loadData();
  await Promise.all([loadNames(), loadAdventureCursors()]);
  s.hud.creatures = s.data.creatures;
  const { local, inbox } = s;
  s.lobby = new Lobby({
    mapFile: () => bar.select.value,
    chooseMap: async () => {
      s.mapsInfo ??= await (s.mapsInfoLoad ??= fetchMapsInfo());
      return (await pickNewGame(modals, bar.select.value, s.mapsInfo))?.file ?? null;
    },
    receive: (msg) => inbox.receive(msg),
    status: (text) => s.notice(said(text)),
    started: (file) => void s.start.openMp(file),
    stale: () => void s.start.resumeLocal(),
    left: () => (location.hash = "#menu"),
    nothingBehind: () => !s.state,
    storage,
    clock: (seats) => s.mpOverlay.clock(seats),
    // (On the map only: the open panel shows it already.)
    chatLine: (line) => !s.lobby.open && s.mpOverlay.say(line),
    // (After the game's own picture of where it stands: the map open and settled.)
    recap: (text, replay, names) =>
      inbox.then(async () => {
        for (let i = 0; i < 400 && !s.state; i++) await new Promise((r) => setTimeout(r, 50));
        await inbox.settled();
        if (!replay?.length) return s.messages.show(said(text));
        // What could be seen of it on the map: watched now (OK) or later (Adventure Options' Replay Opponent's Turn).
        s.replays.away = replay;
        s.replays.awayNames = names ?? [];
        const answer = await dialog(modals, fmt`${text ? fmt`${said(text)}\n\n` : said("")}${tr("Watch what the others did on the map?")}`, s.color(), { buttons: YES_NO });
        if (answer === "yes") await s.replays.watchAway();
      }),
    look: (seat, look) => {
      follow.look(seat, look);
      if (s.allies.followNow()) void s.allies.followLook();
      s.showInfo();
    },
    watch: (_seat, msg) => inbox.then(() => s.allies.watchBattle(msg)),
    openSave: async (slot) => {
      const st = await cloudLoad(slot);
      if (!st) return;
      await s.lobby.leave();
      s.lobby.hide();
      await s.start.open(st.mapFile, st);
    },
  });
  s.mpOverlay = new MpOverlay(() => s.lobby.seat);
  /** Hot seat: in a battle of two humans, whoever's unit is up acts; else the one at the screen. */
  const actingSeat = (m: ClientMessage) => {
    if (s.hotSeat < 0) return undefined;
    if ((m.t === "act" || m.t === "control") && s.lastBattle) {
      const b = s.lastBattle;
      const side = m.t === "control" ? m.side : ((b as { tactics?: { side: number } }).tactics?.side ?? activeUnit(b)?.side);
      const owner = side !== undefined ? b.sides[side]?.owner : undefined;
      if (owner !== undefined && b.sides[side!].controller === "human") return owner;
    }
    return s.hotSeat;
  };
  s.send = (m: ClientMessage) => {
    if (m.t === "advAct") logPlay(actionText(m.action, s.namer));
    else if (m.t === "act") logPlay(`you in battle: ${JSON.stringify(m.action)}`);
    logAction(m);
    // (Every move kept with the game's timeline: how people play, for the computer player to learn from.)
    if (s.state && !isSceneFile(s.state.mapFile)) noteMove(m, gameId(s.state));
    return s.lobby.link && s.lobby.seat >= 0 ? s.lobby.link.send(m) : local.send(m, actingSeat(m));
  };
  s.town = new TownScreen(app, document.body, (action) => s.sendAct(action));
  app.stage.addChild(s.town.root);
  s.panel.wireTown();
  // A rotation or the touch layout changes the viewport: keep the same middle of the map in view
  // (hooked up only now: the camera asks about the state, town and battle declared above).
  let viewW = viewport.w;
  s.hud.onResize = () => {
    camera.widened(viewport.w - viewW);
    viewW = viewport.w;
  };
  // Options switched the touch layout: the other HUD, in place; the map, the game and its windows carry on.
  onLayout(() => {
    if (screenSize.touch === s.hud.touch) return;
    const old = s.hud;
    const at = app.stage.getChildIndex(old.mapLayer);
    const before = app.stage.children.length;
    const next: Hud = screenSize.touch ? new MobileHud(app) : new AdventureHud(app);
    // Its layers where the old one's were (under a town or battle drawn over the map).
    app.stage.children.slice(before).forEach((c, i) => app.stage.addChildAt(c, at + i));
    for (const k of ["creatures", "moraleLuck", "army", "onButton", "onHero", "onTown", "onListInfo", "explainMoraleLuck", "offTurn", "income", "onInfoHero", "onMinimap", "onResize", "onFollow"] as const) (next as unknown as Record<string, unknown>)[k] = old[k];
    next.mapLayer.addChild(view.root);
    next.visible = view.root.visible;
    old.dispose();
    s.hud = next;
    s.minimapLevel = -1;
    s.showInfo();
    s.hud.setSleeping(!!s.state?.heroes[s.selected]?.asleep);
    s.hud.setTutorial(isHotaTutorial(s.state?.mapFile));
    // The viewport moved and changed size: the selected hero in its middle again.
    const h = s.state?.heroes[s.selected];
    if (h && !h.removed) s.centerOn(h.x, h.y);
  });

  installAgentApi({
    app,
    state: () => s.state,
    world: () => s.world,
    me: s.me,
    battle: () => s.battle?.shownState ?? null,
    modals: () => [modals, ...(s.battle ? [s.battle.modals] : []), ...(s.town.open ? [s.town.modals] : [])],
    send: (action) => s.sendAct(action),
    fight: (action) => s.send({ t: "act", action }),
    endTurn: () => bar.endTurn.click(),
    idle: () => !s.busy && !inbox.queue.length,
    battleReady: () => !!s.battle?.awaitingMe,
    extra: () => (s.battle?.result ? [s.battle.result] : []),
    tilePoint: (t) => {
      const n = s.world?.size ?? 0;
      if (!n || Math.floor(t / (n * n)) !== view.currentLevel) return null;
      return camera.clientOf(t % n, Math.floor(t / n) % n);
    },
    newGame: async (file, humans) => {
      const f = file ?? bar.select.value;
      if (humans) s.mapsInfo ??= await (await fetchRetry("/maps-info")).json();
      let left = humans ?? 0;
      // (A scene isn't in the maps' list: its two players, the rest empty.)
      const players = s.infoFor(f)?.players ?? (/^(scene|occasion):/.test(f) ? Array.from({ length: 8 }, (_, i) => ({ human: i < 2, computer: i < 2 })) : undefined);
      const controllers = humans ? players?.map((p) => (!p.human && !p.computer ? "none" : p.human && left-- > 0 ? "human" : "ai")) : undefined;
      void s.start.open(f, undefined, undefined, controllers ? { difficulty: 1, controllers } : undefined);
    },
  });

  local.onMessage((msg, to, full) => {
    if (s.lobby.link) return;
    if (full) s.fullState = full;
    inbox.then(() => inbox.fromLocal(msg, to));
  });

  // ---- multiplayer ---------------------------------------------------------------
  bar.mpBtn.dataset.ico = "give";
  toolbar.append(bar.mpBtn);
  bar.mpBtn.onclick = () => s.lobby.toggle();

  bar.newGame.onclick = () => void s.start.newGameDialog();
  bar.select.onchange = () => void s.start.open(bar.select.value);
  // The HUD's own level button shows the level it would switch to, so the panel is drawn again too.
  bar.levelBtn.onclick = () =>
    s.map &&
    s.state &&
    void view.show(s.map, view.currentLevel ? 0 : 1, s.state).then(() => {
      s.drawMinimap();
      s.showInfo();
    });

  // ---- saved games -------------------------------------------------------------
  s.savedGames = new SavedGames({
    modals,
    heroNames: s.data.heroNames,
    color: s.color,
    state: () => s.state,
    savable: s.savable,
    mapName: () => s.map?.name,
    multiplayer: () => !!s.lobby.link,
    battleModals: () => s.battle?.modals ?? null,
    mapsInfo: async () => (s.mapsInfo ??= await (s.mapsInfoLoad ??= fetchMapsInfo())),
    infoFor: s.infoFor,
    gameLine: s.gameLine,
    open: (file, st) => s.start.open(file, st),
    playedAt: (at) => (at === undefined ? Number(storage(PLAYED_AT) ?? 0) : (storage(PLAYED_AT, String(at)), at)),
    loaded: () => s.loaded(),
    // (The game link a turn notification opens: the page comes again with that room.)
    openRoom: (id) => (location.hash = `#map?room=${id}`),
    loadMap,
  });
  // Back to this tab after playing elsewhere: the newer game is offered.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && location.hash.startsWith("#map") && !s.battle && !modals.open && !s.town.open) void s.savedGames.offerElsewhere();
  });

  onBackAtBottom(s.panel.askLeave);
  // The page menu's "System Options" opens the game's own window, in front (in a battle, the combat options).
  setGameOptions(() => (s.battle ? void s.battle.openOptions() : s.panel.openSystemOptions()));

  // ---- the HUD, the page bar's buttons, the pointer and the keys ---------------------
  s.panel.wireHud();
  s.input.wireHud();
  s.panel.wireButtons();
  s.panel.startTurnClock();
  s.input.listenPointer();
  s.input.listenPad();
  s.input.listenKeys();

  await s.start.boot();
}
