// The running adventure map: what its parts share (the screen's pieces, the game on it, who is at the
// screen) and the small things every part asks for (select a hero, redraw the info panel, open a town).
// The parts, each with the session in hand: inbox.ts (what the server sends, in order), walk.ts (routes
// and walks), battles.ts, messages.ts (the message boxes, level-ups, tutorials), following.ts (allies'
// turns), replays.ts, start.ts (opening a game), input.ts (pointer and keys), panel.ts (the side
// panel's buttons and the windows they open). page.ts builds them and wires them to the page.
import {
  type AdventureState,
  type Hero,
  type BattleState,
  type GameData,
  PLAYER_NAMES,
  World,
  canAct,
  isInteractive,
  isRevealed,
  movingNow,
  parseRandomMapName,
  upperArmy,
  waitingFor,
} from "@heroes/core";
import type { H3Map } from "@heroes/formats";
import type { Application } from "pixi.js";
import type { ClientMessage } from "@heroes/server";
import { tr, said, type Text } from "../i18n/index.ts";
import { setPopupPlayer } from "../ui/creatureInfo.ts";
import { Modals } from "../ui/modals.ts";
import { screenSize } from "../ui/screen.ts";
import { loadingScreen } from "../ui/loadingScreen.ts";
import { whileWaiting } from "../ui/loadingNote.ts";
import { type MapInfo } from "../ui/newGameModel.ts";
import { randomMapInfo } from "../ui/newGameParts.ts";
import { resolveText } from "../ui/gameText.ts";
import { resourceName } from "../ui/resourceNames.ts";
import { nowPlaying, playMusic, setAmbient } from "../audio.ts";
import { loadDef } from "../assets.ts";
import { PLAYED_AT, pushCurrent } from "../cloudSaves.ts";
import { record } from "../timeline/store.ts";
import { localConnection } from "../connection.ts";
import type { BattleView } from "../battle/view.ts";
import { type TownScreen, preloadTown } from "../town/screen.ts";
import { MapView } from "./view.ts";
import { AdventureHud, type Hud } from "./hud.ts";
import { MobileHud } from "./mobileHud.ts";
import { MapCamera } from "./camera.ts";
import { WorldView } from "./worldView.ts";
import { Follow } from "./follow.ts";
import { ambientLevels } from "./ambient.ts";
import { extra } from "../settings.ts";
import { objectName } from "./describe.ts";
import type { Namer } from "./playLog.ts";
import type { AdvContext } from "./context.ts";
import type { Lobby } from "./lobby.ts";
import type { MpOverlay } from "./mpOverlay.ts";
import type { SavedGames } from "./savedGames.ts";
import type { Aiming } from "./castWindow.ts";
import { isSceneFile } from "@heroes/core";
import { SAVE_KEY, storage } from "./storage.ts";
import type { MapInbox } from "./inbox.ts";
import type { MapWalk } from "./walk.ts";
import type { MapBattles } from "./battles.ts";
import type { MapMessages } from "./messages.ts";
import type { AllyFollowing } from "./following.ts";
import type { MapReplays } from "./replays.ts";
import type { MapStart } from "./start.ts";
import type { MapInput } from "./input.ts";
import type { SidePanel } from "./panel.ts";

// Adventure music follows the terrain under the selected hero (index = terrain id).
export const TERRAIN_MUSIC = ["DIRT.MP3", "SAND.MP3", "GRASS.MP3", "SNOW.MP3", "SWAMP.MP3", "ROUGH.MP3", "Underground.mp3", "LAVA.MP3", "WATER.MP3", "ROUGH.MP3", "HIGHLANDS.mp3", "WASTELAND.mp3"];
/** The music during a computer player's turn. */
export const AI_MUSIC = ["AITheme0.mp3", "AITHEME1.MP3", "AITHEME2.MP3"];
const TOWN_MUSIC = ["CstleTown.mp3", "RAMPART.MP3", "TowerTown.mp3", "InfernoTown.mp3", "necroTown.mp3", "DUNGEON.MP3", "StrongHold.mp3", "FortressTown.mp3", "ElemTown.mp3", "CoveTown.mp3", "FactoryTown.mp3", "BulwarkTown.mp3"];

/** The page bar's controls (only the scenario picker and New Game are shown; the others are pressed by the HUD and keys). */
export interface MapToolbar {
  select: HTMLSelectElement;
  newGame: HTMLButtonElement;
  levelBtn: HTMLButtonElement;
  endTurn: HTMLButtonElement;
  heroBtn: HTMLButtonElement;
  townBtn: HTMLButtonElement;
  info: HTMLSpanElement;
  mpBtn: HTMLButtonElement;
}

export class MapSession {
  readonly view: MapView;
  /** The original adventure screen (AdventureHud) or, on phones and tablets, the mobile one: swapped when the layout changes. */
  hud: Hud;
  readonly modals: Modals;
  readonly worldView = new WorldView();
  readonly camera: MapCamera;
  /** Made by page.ts only after the loading awaits; the camera and ambient callbacks run before it, so they read it with ?. */
  town!: TownScreen;
  /** Single player talks to a local worker; multiplayer to the host over a WebSocket (the lobby's link). */
  readonly local = localConnection();
  readonly follow = new Follow();
  lobby!: Lobby;
  mpOverlay!: MpOverlay;
  savedGames!: SavedGames;
  /** Sends a game message: to the host in a room, else to the local worker (as the one acting at a hot seat). */
  send!: (m: ClientMessage) => void;
  data!: GameData;
  /** The map files the server has. */
  files: string[] = [];
  bar!: MapToolbar;

  // The parts.
  inbox!: MapInbox;
  walk!: MapWalk;
  battles!: MapBattles;
  messages!: MapMessages;
  allies!: AllyFollowing;
  replays!: MapReplays;
  start!: MapStart;
  input!: MapInput;
  panel!: SidePanel;

  // The game on screen.
  map: H3Map | null = null;
  state: AdventureState | null = null;
  world: World | null = null;
  selected = -1;
  /** A town of ours picked in the list or on the map (the info panel shows it), else -1. */
  selectedTown = -1;
  /** Dev-only backquote toggle: show the whole map. */
  fogLifted = false;
  /** Hot seat: several humans take turns at this screen; the one playing now (-1: not hot seat). */
  hotSeat = -1;
  /** Hot seat: the whole game, for saving (each player is only shown their own view of it). */
  fullState: AdventureState | null = null;
  /** The battle on screen, as last sent: whose unit is up decides who is acting in a hot seat fight. */
  lastBattle: BattleState | null = null;
  battle: BattleView | null = null;
  /** The map is playing out what it was sent (the inbox's queue): no new orders meanwhile. */
  busy = false;
  /** Updates wait for the map they belong to. */
  mapReady: Promise<unknown> = Promise.resolve();
  /** The computer plays our side ("&ai=<days>"): its towns, dwellings, markets, meetings and offers open no windows, its battles' results close by themselves. */
  watching = false;
  /** A targeted spell waiting for its map click (Dimension Door, Scuttle Boat). */
  aiming: Aiming | null = null;
  /** The original's loading screen while a game opens (null: none up). */
  loading: ReturnType<typeof loadingScreen> | null = null;
  /** The maps' list for New Game and Load (started early when the page opens on one of them). */
  mapsInfoLoad: Promise<MapInfo[]> | null = null;
  mapsInfo: MapInfo[] | null = null;
  /** Where the selected hero is while it walks (the state has it only once the walk is over). */
  walkingAt: { x: number; y: number; z: number } | null = null;
  /** The HUD's last redraw (the loading screen stays up until the first one is done). */
  hudDrawn: Promise<unknown> = Promise.resolve();
  minimapLevel = -1;

  private statusText = "";
  private ambientTimer = 0;
  private readonly stateListeners = new Set<() => void>();
  private readonly warmed = new Set<string>();
  private warming = false;
  private readonly prefetched = new Set<string>();
  /** (Held back while the loading screen is up: the map's own art comes first on a slow connection.) */
  private prefetchHeld = false;

  readonly app: Application;
  constructor(app: Application) {
    this.app = app;
    this.view = new MapView(app);
    // The original adventure screen: the map sits in the frame's viewport.
    // Phones and tablets get the mobile HUD (the map full screen); the original panel elsewhere.
    this.hud = screenSize.touch ? new MobileHud(app) : new AdventureHud(app);
    this.hud.mapLayer.addChild(this.view.root);
    this.modals = new Modals(app);
    this.camera = new MapCamera({
      app,
      root: this.view.root,
      mapSize: () => this.map?.size ?? 0,
      moved: (v) => {
        this.hud.setView(v);
        this.view.cull(v);
        if (this.worldView.active) void this.worldView.redraw();
        this.scheduleAmbient();
      },
      active: () => !this.modals.open && !this.town?.open && !this.battle && !!this.state,
    });
  }

  /** The player at this screen: our seat in a room, the one playing now at a hot seat, else the human (-1: none). */
  me = () => (this.lobby.seat >= 0 ? this.lobby.seat : this.hotSeat >= 0 ? this.hotSeat : (this.state?.players.findIndex((p) => p.controller === "human") ?? -1));
  /** The colour windows are drawn in. */
  color = () => Math.max(0, this.me());
  myTurn = () => !!this.state && canAct(this.state, this.me()) && !this.busy;
  myHeroes = () => this.state?.heroes.filter((h) => !h.removed && h.owner === this.me()) ?? [];
  /** The heroes out on the map: the ones that can be selected and moved (not those in a garrison). */
  mapHeroes = () => this.myHeroes().filter((h) => h.garrison === undefined);
  /** What a save holds: the whole game (in hot seat not just the view of the one at the screen). */
  savable = () => (this.hotSeat >= 0 ? (this.fullState ?? this.state) : this.state);
  sendAct = (action: Extract<ClientMessage, { t: "advAct" }>["action"]) => this.send({ t: "advAct", action });

  tilePos(i: number) {
    const n = this.map!.size;
    return { x: i % n, y: Math.floor(i / n) % n, z: Math.floor(i / (n * n)) };
  }

  centerOn = (x: number, y: number) => this.camera.centerOn(x, y);

  /** Status line: the original status bar under the map. */
  status(text: Text) {
    this.statusText = text;
    this.hud.setStatus(text);
  }
  /** What the status line says now. */
  get statusLine() {
    return this.statusText;
  }
  /** A line the player must see (a refusal, a spell to aim): toasted on a touch screen too. */
  notice = (text: Text) => {
    this.statusText = text;
    this.hud.setStatus(text, true);
  };

  /** Ends the loading screen (if up). */
  loaded = () => {
    this.loading?.done();
    this.loading = null;
  };

  /**
   * Once no loading screen is up, nor going (its picture stays a moment after done()): the map's windows (a
   * scenario's opening story, day one's events) wait for it, else they flashed through the loading picture
   * (2026-11-03: "the map welcome dialog with the backstory starts flashing through the loading screen").
   */
  async untilLoaded() {
    if (!this.loading) return;
    while (this.loading) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 250));
  }

  setMapVisible(v: boolean) {
    this.view.root.visible = v;
    this.hud.visible = v;
    // The map's ambient loops only play while it's on screen.
    if (v) this.scheduleAmbient();
    else setAmbient(new Map());
  }

  /** Loops of the explored objects around the selected hero (or town), louder the closer they are (up to four). */
  scheduleAmbient() {
    if (this.ambientTimer) return;
    this.ambientTimer = window.setTimeout(() => {
      this.ambientTimer = 0;
      if (!this.state || !this.world || this.battle || this.town?.open) return setAmbient(new Map());
      const s = this.state;
      const w = this.world;
      const me = this.me();
      const explored = (x: number, y: number, z: number) => {
        // (As thingsAt: no fog kept, or the fog lifted, shows everything.)
        if (this.fogLifted || !s.players[me]?.revealed.length) return true;
        const i = w.index(x, y, z);
        return i >= 0 && isRevealed(s, me, i);
      };
      if (extra("ambientNearOnly")) {
        // Only the selected (or walking) hero's spot, and only on your own turn.
        const at = this.ambientCentre(true);
        if (!at || !canAct(s, me)) return setAmbient(new Map());
        return setAmbient(ambientLevels(s.objects, at, explored, true));
      }
      setAmbient(ambientLevels(s.objects, this.ambientCentre(false)!, explored));
    }, 250);
  }
  private ambientCentre(heroOnly: boolean) {
    if (this.walkingAt) return this.walkingAt;
    const h = this.state?.heroes[this.selected];
    if (h && !h.removed && h.garrison === undefined) return { x: h.x, y: h.y, z: h.z };
    if (heroOnly) return undefined;
    const t = this.selectedTown >= 0 ? this.state?.objects[this.selectedTown] : undefined;
    if (t) return { x: t.x - 2, y: t.y, z: t.z };
    // Nothing selected: the middle of the view.
    return { ...this.camera.center, z: this.view.currentLevel };
  }

  /** The running game kept in this browser (a reload resumes it) and sent up for other devices (cloudSaves.ts). */
  keepLocal(whole: AdventureState) {
    // (A test scene isn't a game going on: the one played before it stays the one Continue offers.)
    if (isSceneFile(whole.mapFile)) return;
    storage(SAVE_KEY, JSON.stringify(whole));
    storage(PLAYED_AT, String(Date.now()));
    pushCurrent(whole, this.map?.name || whole.mapFile);
    // Games as timelines: a point at each new day of yours and each big happening (timeline/store.ts), with the moves
    // that led there; taken whatever the Load window shows (the switch is only how it lists them): the record of how
    // people play goes on in the classic interface too.
    void record(whole, { name: this.map?.name || whole.mapFile, yourMove: canAct(whole, this.me()) }).catch(() => null);
  }

  /** Why the turn's buttons are greyed: whose turn it is, or who the day waits for. */
  othersTurn(s: AdventureState) {
    return s.turnMode === "simultaneous" ? tr("Waiting for %1…", waitingFor(s).map((p) => tr(PLAYER_NAMES[p])).join(", ") || tr("the next day")) : tr("%1 is moving…", tr(PLAYER_NAMES[s.current]));
  }

  /** Redraws the HUD (and the page bar's line) for the state on screen. */
  showInfo = () => {
    const state = this.state;
    if (!state) return;
    const me = this.me();
    const p = state.players[me] ?? state.players[state.current];
    const res = p.resources.map((r, i) => `${resourceName(i)} ${r}`).join(" · ");
    const h = state.heroes[this.selected];
    const hero = h && !h.removed ? ` | ${h.name}: ${h.movement}/${h.maxMovement} MP` : "";
    const turn = this.myTurn() || canAct(state, me) ? (state.turnMode === "simultaneous" ? tr("Your turn (simultaneous)") : tr("Your turn")) : this.othersTurn(state);
    this.bar.info.textContent = tr(`Day %1 · %2%3 | %4`, state.day, turn, hero, res);
    this.bar.endTurn.disabled = this.bar.heroBtn.disabled = !this.myTurn();
    // Following allies: the HUD's Follow control and what the ally followed is doing; the host sends their battles while we follow.
    const following = this.allies.followNow();
    this.follow.tell(this.lobby.link, following && this.follow.following);
    this.hud.setFollow(following ? this.follow.shown(state, me, PLAYER_NAMES.map((n, seat) => this.lobby.room?.players.find((p) => p.seat === seat)?.name ?? tr(n)), movingNow(state)) : null);
    this.hudDrawn = this.hud.init(Math.max(0, me)).then(() => this.state && this.hud.update(this.state, this.me(), this.selected, this.selectedTown, this.view.currentLevel === 1, this.myTurn()));
    // The creature cards' frames in this player's colours.
    setPopupPlayer(Math.max(0, me));
    this.drawMinimap();
  };

  drawMinimap() {
    if (!this.state || !this.map || !this.world) return;
    const level = this.view.currentLevel;
    if (level !== this.minimapLevel) {
      this.hud.buildMinimap(this.map, this.world, level);
      this.minimapLevel = level;
    }
    this.hud.drawMinimap(this.state, this.world, level, this.me());
    this.camera.apply();
  }

  rebuildWorld(s: AdventureState) {
    const map = this.map;
    if (!map) return;
    if (!this.world) this.world = new World(map, this.data, new Set(map.objects.map((_, i) => i).filter((i) => isInteractive(map, i))));
    this.world.refresh(s);
  }

  /** Terrain music for where the selected hero stands (towns and battles set their own). */
  adventureMusic() {
    const { map, state } = this;
    if (!map || !state || this.battle || this.town?.open) return;
    const me = this.me();
    // A computer player's turn: one of the original's AI themes, kept until our turn comes.
    const computers = state.turnMode === "sequential" ? state.current !== me && state.players[state.current]?.controller === "ai" : !!state.ended[me] && waitingFor(state).some((p) => state.players[p]?.controller === "ai");
    if (computers) {
      if (!/aitheme/i.test(nowPlaying().src)) playMusic(AI_MUSIC[Math.floor(Math.random() * AI_MUSIC.length)]);
      return;
    }
    const h = state.heroes[this.selected];
    if (!h || h.removed) return;
    const t = map.tiles[(h.z * map.size + h.y) * map.size + h.x];
    if (t) playMusic(TERRAIN_MUSIC[t.terrain] ?? "GRASS.MP3");
  }

  selectHero = (h: Hero | undefined, center = true) => {
    // A hero in a town's garrison isn't on the map: nothing to select there.
    if (h?.garrison !== undefined) h = undefined;
    if (h) this.selectedTown = -1;
    if ((h ? h.id : -1) !== this.selected && this.hud.army) this.hud.army.selected = null;
    this.selected = h ? h.id : -1;
    this.walkingAt = null;
    this.scheduleAmbient();
    this.hud.setSleeping(!!h?.asleep);
    this.walk.showRoute(h);
    if (h && center) {
      if (h.z !== this.view.currentLevel && this.map && this.state) void this.view.show(this.map, h.z, this.state);
      this.centerOn(h.x, h.y);
    }
    this.adventureMusic();
    this.showInfo();
  };

  /** Selects one of our towns (no hero then), centred on the map unless it was clicked there. */
  selectTown = (id: number, center = true) => {
    const o = this.state?.objects[id];
    if (!o?.town) return;
    if (this.hud.army) this.hud.army.selected = null;
    this.selected = -1;
    this.selectedTown = id;
    this.messages.tutorial.on(this.state, "selectTown");
    this.walkingAt = null;
    this.scheduleAmbient();
    this.view.showPath([], 0);
    if (center) {
      if (o.z !== this.view.currentLevel && this.map && this.state) void this.view.show(this.map, o.z, this.state);
      this.centerOn(o.x - 2, o.y);
    }
    this.showInfo();
  };

  openTown = (id: number) => {
    const { state, world } = this;
    if (!state || !world) return;
    this.allies.closeFollowedTown();
    this.allies.tellLook({ k: "town", object: id });
    this.setMapVisible(false);
    playMusic(TOWN_MUSIC[state.objects[id]?.subid ?? 0] ?? "CstleTown.mp3");
    void whileWaiting(this.town.show(state, world, id));
    this.messages.tutorial.on(state, "town");
  };

  /** Calls `fn` after every new state; returns what stops it. */
  listen = (fn: () => void) => {
    this.stateListeners.add(fn);
    return () => void this.stateListeners.delete(fn);
  };
  /** A new state is on screen: the windows listening redraw. */
  changed() {
    for (const fn of this.stateListeners) fn();
  }

  /** What the adventure screen's windows need of the game (map/context.ts). */
  readonly advCtx: AdvContext = this.context();
  private context(): AdvContext {
    // (Asked for only once the game is on: the session's parts are all there by then.)
    const s = this;
    return {
      get modals() {
        return s.modals;
      },
      get data() {
        return s.data;
      },
      state: () => s.state!,
      world: () => s.world!,
      me: () => s.me(),
      send: (action) => s.sendAct(action),
      listen: (fn) => s.listen(fn),
      say: (text) => s.messages.show(said(text)),
      openHero: (id) => s.panel.openHeroScreen(id, true),
    };
  }

  // The game's steps in words for a feedback note's play log (playLog.ts).
  readonly namer: Namer = {
    hero: (id) => this.state?.heroes[id]?.name ?? `hero ${id}`,
    object: (id) => {
      const o = this.state?.objects[id];
      return o && this.world ? `${objectName(o, this.world.creatures, this.data.artifacts)} at ${o.x},${o.y}${o.z ? ",u" : ""}` : `object ${id}`;
    },
    tile: (i) => {
      const n = this.state?.size ?? 0;
      return n ? `${i % n},${Math.floor(i / n) % n}${i >= n * n ? ",u" : ""}` : `tile ${i}`;
    },
  };

  /** A GENRLTXT line (VCMI's numbering), or null without the game files. */
  gameLine = (id: number, ...args: string[]) => resolveText({ file: "genrltxt", id, args });
  /** A player's colour as the game's texts name it ("Red": PLCOLORS, capitalised as VCMI's capColors). */
  async colourName(seat: number) {
    const c = (await resolveText({ file: "plcolors", id: seat })) ?? tr(PLAYER_NAMES[seat]) ?? "";
    return c.charAt(0).toUpperCase() + c.slice(1);
  }

  /** A map's entry for the scenario screens: from the server's list, or made up for a random map. */
  infoFor = (file: string, byFile?: Map<string, MapInfo>): MapInfo | undefined => {
    const random = parseRandomMapName(file);
    return random ? randomMapInfo(random) : (byFile?.get(file) ?? this.mapsInfo?.find((m) => m.file === file));
  };

  // Our towns' scenes loaded while the map is idle (the first visit waited for every building's
  // download), one at a time a moment after the map is up; each town (and what it has built) once.
  warmTowns(s: AdventureState) {
    if (this.warming) return;
    const todo = s.objects.filter((o) => o.town && o.owner === this.me() && !this.warmed.has(`${o.id}:${o.town.built.length}`));
    if (!todo.length) return;
    this.warming = true;
    setTimeout(async () => {
      // (Not while the loading screen is up: the map's own art first.)
      while (this.loading) await new Promise((r) => setTimeout(r, 500));
      for (const o of todo) {
        this.warmed.add(`${o.id}:${o.town!.built.length}`);
        await preloadTown(o).catch(() => {});
      }
      this.warming = false;
    }, 2000);
  }

  /**
   * Warms the art cache for battles that may come: our heroes' and towns' stacks, and the monsters
   * and enemy heroes within a day's walk of our heroes. Fetched quietly in the background (cached
   * per DEF), so a battle usually opens with everything already there.
   */
  prefetchBattleArt(s: AdventureState): void {
    if (!this.world || this.prefetchHeld) return;
    if (this.loading) {
      this.prefetchHeld = true;
      return void setTimeout(() => ((this.prefetchHeld = false), this.state && this.prefetchBattleArt(this.state)), 1000);
    }
    const w = this.world;
    const me = this.me();
    const want = new Set<number>();
    const mine = s.heroes.filter((h) => !h.removed && h.owner === me);
    const near = (x: number, y: number, z: number) => mine.some((h) => h.z === z && Math.abs(h.x - x) <= 12 && Math.abs(h.y - y) <= 12);
    for (const h of mine) for (const a of h.army) if (a) want.add(a.creature);
    for (const o of s.objects) {
      if (o.removed || !near(o.x, o.y, o.z)) continue;
      if (o.type === 54) want.add(o.subid);
      if (o.town && o.owner === me) for (const a of upperArmy(s, o)) if (a) want.add(a.creature);
    }
    for (const h of s.heroes) if (!h.removed && h.owner !== me && near(h.x, h.y, h.z)) for (const a of h.army) if (a) want.add(a.creature);
    for (const id of want) {
      const def = w.creatures[id]?.def;
      if (!def || this.prefetched.has(def)) continue;
      this.prefetched.add(def);
      void loadDef(def).catch(() => this.prefetched.delete(def));
    }
  }
}
