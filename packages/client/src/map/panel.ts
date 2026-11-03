// The adventure screen's buttons and the windows they open: the side panel (or the phone's widgets),
// the hero and town lists, End Turn and Next Hero, the hero screen, the kingdom, quests, spells, the
// adventure and system options, View World, the puzzle map, digging; the town screen's own hooks; and
// the Player Turn Duration's clock.
import {
  type AdventureState,
  type Hero,
  canAct,
  cannotDig,
  dailyIncome,
  dateLine,
  heroMoraleLuck,
  heroMoraleLuckParts,
  isMissionCritical,
  mapViews,
  objectUnder,
  visitingHero, ownTowns, canStepToday } from "@heroes/core";
import { extra, extra as extraOn, settings } from "../settings.ts";
import { tr, said, reason, rulesText } from "../i18n/index.ts";
import { YES_NO, infoArea, messageBox as dialog } from "../ui/dialogs.ts";
import { fetchRetry } from "../net.ts";
import { ArmyClicks } from "../ui/armyClicks.ts";
import { stackWindow } from "../ui/stackWindow.ts";
import { splitWindow } from "../ui/split.ts";
import { stackInfo } from "../ui/stackBreakdown.ts";
import { moraleLuckText, originalWords, englishLine } from "../ui/gameText.ts";
import { gameTexts } from "../ui/highScores.ts";
import { systemOptions } from "../ui/systemOptions.ts";
import { leaveAsk } from "../ui/leaveAsk.ts";
import { kingdomOverview } from "../ui/kingdom.ts";
import { heroScreen } from "../ui/heroScreen.ts";
import { exchangeWindow } from "../ui/exchange.ts";
import { advOptionsWindow, puzzleWindow } from "../ui/advOptions.ts";
import { leaveApp } from "../chrome/layers.ts";
import { shipyardDialog } from "../town/windows.ts";
import { logPlay } from "../feedback/recent.ts";
import { openObjectWindow } from "./objectWindows.ts";
import { castWindow } from "./castWindow.ts";
import { questsWindow, scenarioInfoWindow } from "./infoWindows.ts";
import type { HudButton } from "./hud.ts";
import type { MapSession } from "./session.ts";

export class SidePanel {
  // The screen loads its art before it shows, so a double click stacked two of them (the OK then seemed dead).
  private heroScreenLoading = false;
  private townCycle = -1;
  /** The Player Turn Duration's clock for the turn under way. */
  private clock: { key: string; ends: number; warned: number } | null = null;
  private readonly s: MapSession;

  constructor(s: MapSession) {
    this.s = s;
  }

  /** Hooks the HUD's buttons, lists and info bar up (a new HUD for another layout takes them over). */
  wireHud() {
    const s = this.s;
    const { hud, modals } = s;
    hud.onButton = (b) => this.onButton(b);
    // The info bar's army (the selected hero's): rearranged with the same clicks as the hero screen.
    hud.moraleLuck = (h) => (s.state && s.world ? heroMoraleLuck(s.state, s.world, h) : { morale: 0, luck: 0 });
    hud.offTurn = { modals, why: () => (!s.state || s.myTurn() || canAct(s.state, s.me()) ? null : s.othersTurn(s.state)) };
    hud.explainMoraleLuck = (target, h, morale) =>
      infoArea(modals, target, s.color(), async () => {
        if (!s.state || !s.world) return null;
        const ml = heroMoraleLuckParts(s.state, s.world, h);
        return moraleLuckText(morale, morale ? ml.morale : ml.luck, morale ? ml.moraleParts : ml.luckParts);
      });
    hud.income = () => (s.state && s.world ? dailyIncome(s.state, s.world, s.me()) : []);
    hud.army = new ArmyClicks({
      armies: () => [s.state?.heroes[s.selected]?.army ?? []],
      move: (from, to, count) => s.myTurn() && s.sendAct({ type: "transfer", heroes: [s.selected, s.selected], kind: "army", from: { who: 0, slot: from.slot }, to: { who: 0, slot: to.slot }, count }),
      split: (creature, left, right, minLeft, quick) => splitWindow(modals, s.color(), s.data.creatures[creature], left, right, minLeft, quick),
      details: (ref) => {
        const h = s.state?.heroes[s.selected];
        const a = h?.army[ref.slot];
        const c = a && s.data.creatures[a.creature];
        if (!h || !a || !c) return;
        void stackWindow(modals, s.color(), c, {
          info: { count: a.count, ...stackInfo(h, c, s.data, s.state && s.world ? heroMoraleLuckParts(s.state, s.world, h) : undefined) },
          dismiss: h.army.filter((x) => x).length > 1 && s.myTurn() ? () => s.sendAct({ type: "dismissStack", hero: h.id, slot: ref.slot }) : undefined,
        });
      },
    });
    hud.onHero = (id) => this.onHero(id);
    hud.onInfoHero = (held) => s.selected >= 0 && (held ? this.openHeroScreen(s.selected) : s.hud.onHero(s.selected));
    // As the original: a town is selected (the info panel shows it, the map centres on it) by the first
    // click and opened by the second.
    hud.onTown = (id) => {
      if (s.battle) return;
      if (id !== s.selectedTown) return s.selectTown(id);
      const o = s.state?.objects[id];
      if (o && (o.z !== s.view.currentLevel || !s.camera.brought(o.x - 2, o.y))) return void s.selectTown(id);
      s.openTown(id);
    };
    hud.onMinimap = (x, y) => (s.allies.letGo(), s.centerOn(Math.floor(x), Math.floor(y)));
    hud.onFollow = () => (s.follow.following ? s.allies.letGo() : s.allies.takeUp());
  }

  /** The town screen's heroes (their screens and the exchange open over the town), and leaving it. */
  wireTown() {
    const s = this.s;
    const { town, view, camera } = s;
    town.onHero = (id, layer) => this.openHeroScreen(id, false, layer);
    town.onExchange = (a, b, layer) =>
      void exchangeWindow(layer, s.color(), {
        data: s.data,
        moraleLuck: (h) => (s.state && s.world ? heroMoraleLuck(s.state, s.world, h) : { morale: 0, luck: 0 }),
        heroes: () => [s.state!.heroes[a], s.state!.heroes[b]],
        send: (action) => s.sendAct(action),
        listen: s.listen,
        openHero: (id) => this.openHeroScreen(id, true, layer),
        quests: { any: this.hasQuests, open: () => void this.openQuests() },
      });
    town.onClose = (id) => {
      // An ally's town shown while following: closed by the player, they look around on their own.
      if (s.follow.town === id) {
        s.follow.town = -1;
        if (!s.follow.closing) s.allies.letGo();
      } else s.allies.tellLook({ k: "map" });
      s.setMapVisible(!s.battle);
      // As the original (VCMI's CCastleInterface::close): leaving our town selects its visiting hero,
      // the one just handled there (swapped out of the garrison, say), else the town itself; not the
      // hero that was selected before it opened. And the map shows what's selected: a town opened from
      // somewhere else (a garrison's hero in the list, the kingdom, the next-town key, a town switched to
      // inside the town screen) is centred on leaving (2026-10-27 18:13); one opened on the map
      // stays where it was.
      const o = s.state?.objects[id];
      if (!s.battle && s.state && s.world && o?.town && o.owner === s.me()) {
        const away = (x: number, y: number, z: number) => z !== view.currentLevel || !camera.shows(x, y);
        const v = visitingHero(s.state, s.world, o);
        if (v && v.owner === s.me()) s.selectHero(v, away(v.x, v.y, v.z));
        else s.selectTown(id, away(o.x - 2, o.y, o.z));
      }
      s.adventureMusic();
    };
  }

  /** The page bar's End Turn, Next Hero and Town buttons (the HUD and the keys press them). */
  wireButtons() {
    const s = this.s;
    const { endTurn, heroBtn, townBtn } = s.bar;
    endTurn.onclick = async () => {
      if (!s.myTurn()) return;
      // As in the original: a word of warning while awake heroes can still move.
      // (Not the selected hero whose planned route's first step costs more than it has left: it goes on
      // tomorrow, VCMI's AdventureMapShortcuts::endTurn.)
      const planned = s.walk.planned;
      // (Nor one whose few points left buy no step from where it stands: the owner 2026-11-03.)
      const w = s.world;
      const restless = s.mapHeroes().filter((h) => !h.asleep && h.movement > 0 && !(h.id === s.selected && planned && planned.today < 1) && (!w || !s.state || (w.refresh(s.state), canStepToday(w, s.state, h))));
      if (restless.length && settings().moveReminder) {
        const answer = await dialog(s.modals, (await s.gameLine(55)) ?? englishLine("genrltxt", 55), s.color(), {
          buttons: YES_NO,
        });
        if (answer !== "yes" || !s.myTurn()) return;
      }
      s.sendAct({ type: "endTurn" });
    };
    // Opens your towns one after another.
    townBtn.onclick = () => {
      if (!s.state || s.battle) return;
      const towns = ownTowns(s.state, s.me());
      if (!towns.length) return void s.notice(tr("You have no towns."));
      this.townCycle = (this.townCycle + 1) % towns.length;
      s.openTown(towns[this.townCycle].id);
    };
    heroBtn.onclick = () => {
      // Sleeping heroes and those with no moves left are skipped, as in the original.
      const all = s.mapHeroes();
      // (Nor one whose few points left buy no step: the same test as End turn's reminder.)
      const w = s.world;
      const awake = all.filter((h) => !h.asleep && h.movement > 0 && (!w || !s.state || (w.refresh(s.state), canStepToday(w, s.state, h))));
      const hs = awake.length ? awake : all.filter((h) => !h.asleep).length ? all.filter((h) => !h.asleep) : all;
      if (!hs.length) return;
      const i = hs.findIndex((h) => h.id === s.selected);
      s.selectHero(hs[(i + 1) % hs.length]);
    };
  }

  // The Player Turn Duration (Advanced Options): a human's turn ends when its minutes run out, with the
  // original's warnings (GENRLTXT 629 / 630) in the info bar at five minutes and at one. A battle or
  // a window that's waiting on the player holds the end until it's done.
  startTurnClock() {
    const s = this.s;
    // (The page lives as long as the document.)
    setInterval(() => {
      const { state } = s;
      const minutes = state?.turnMinutes;
      if (!state || !minutes || state.winner !== undefined || !canAct(state, s.me()) || state.players[s.me()]?.controller !== "human") return void (this.clock = null);
      const key = `${state.day}:${s.me()}`;
      if (this.clock?.key !== key) this.clock = { key, ends: Date.now() + minutes * 60_000, warned: minutes };
      const clock = this.clock;
      const left = (clock.ends - Date.now()) / 60_000;
      for (const at of [5, 1]) if (left <= at && clock.warned > at && minutes > at) {
        clock.warned = at;
        void this.minutesLeft(at);
      }
      if (left > 0 || s.busy || s.battle || !s.myTurn()) return;
      logPlay("turn time ran out");
      this.clock = null;
      s.sendAct({ type: "endTurn" });
    }, 1000);
  }
  private async minutesLeft(m: number) {
    const s = this.s;
    const own = m === 1 ? await s.gameLine(628) : await s.gameLine(629, m.toFixed(1));
    const text = own && /minute/i.test(own) ? own.replace(/%0\.1f/, m.toFixed(1)) : m === 1 ? englishLine("genrltxt", 628) : englishLine("genrltxt", 629, [m.toFixed(1)]);
    s.hud.showComponents([], said(text.trim()), 8000);
  }

  // ---- the original side panel ------------------------------------------------
  onButton(b: HudButton) {
    const s = this.s;
    const { state, world, bar } = s;
    const planned = s.walk.planned;
    if (s.battle || s.modals.open) return;
    if (b === "zoomIn" || b === "zoomOut") return s.camera.zoomKey(b === "zoomIn" ? 1 : -1);
    if (b === "level") bar.levelBtn.click();
    else if (b === "nextHero") bar.heroBtn.click();
    else if (b === "endTurn") bar.endTurn.click();
    else if (b === "sysOptions") this.openSystemOptions();
    else if (b === "move" && planned && state && s.myTurn()) s.walk.walkPlanned();
    else if (b === "move" && !planned && state && world && s.myTurn() && s.selected >= 0) {
      // No route: the hero visits again the object it stands on (a town's gate opens the town).
      const h = state.heroes[s.selected];
      world.refresh(state);
      const under = h && !h.removed && h.garrison === undefined ? objectUnder(state, world, h) : undefined;
      if (under?.town) s.openTown(under.id);
      else if (under) s.sendAct({ type: "visit", hero: h.id, cyclicPortals: extra("cyclicPortals") });
    } else if (b === "kingdom") this.openKingdom();
    else if (b === "quests") this.openQuests();
    else if (b === "sleep" && state && s.selected >= 0 && s.myTurn()) {
      const h = state.heroes[s.selected];
      s.sendAct({ type: "sleep", hero: h.id, asleep: !h.asleep });
      s.hud.setSleeping(!h.asleep);
    }
    else if (b === "cast") this.openAdventureSpells();
    else if (b === "advOptions") void this.openAdvOptions();
    else if (b === "world") this.openWorldView();
    else if (b === "puzzle") this.openPuzzle();
    else if (b === "info") void this.scenarioInfo();
    else if (b === "replay") void s.replays.replayTurn();
    else if (b === "dig") void this.dig();
    else if (b === "tutorial") void s.messages.viewTutorialMessages();
  }

  /** From the list or the info bar: selects the hero, and opens its screen once selected and in view. */
  private onHero(id: number) {
    const s = this.s;
    const h = s.state?.heroes[id];
    if (!h) return;
    // From the list, a garrison's hero: its town (where it can be swapped out).
    if (h.garrison !== undefined) return void (!s.battle && s.openTown(h.garrison));
    if (id !== s.selected) return s.selectHero(h);
    // Selected, but the view went elsewhere: back to the hero first, the hero screen on the next tap (2026-10-26;
    // the list's portrait or the widget's alike).
    if (h.z !== s.view.currentLevel || !s.camera.brought(h.x, h.y)) return void s.selectHero(h);
    this.openHeroScreen(id);
  }

  // As the rules: not your last hero without a town, nor one at sea, nor one the scenario needs.
  private dismissWhy = (h: Hero): string | null =>
    h.boat !== undefined
      ? tr("A hero at sea can't be dismissed.")
      : isMissionCritical(this.s.state!, h.id)
        ? tr("The scenario needs this hero.")
        : this.s.myHeroes().length > 1 || this.s.state?.objects.some((o) => o.town && !o.removed && o.owner === this.s.me())
          ? null
          : tr("Your last hero can't be dismissed while you have no town.");
  openHeroScreen(id: number, overWindow = false, layer = this.s.modals) {
    const s = this.s;
    if (!s.state || (layer.open && !overWindow) || this.heroScreenLoading) return;
    this.heroScreenLoading = true;
    void heroScreen(layer, s.color(), {
      data: s.data,
      hero: () => s.state!.heroes[id],
      heroes: () => s.myHeroes(),
      moraleLuck: (h) => (s.world ? heroMoraleLuckParts(s.state!, s.world, h) : { morale: 0, luck: 0 }),
      questLog: () => this.openQuests(),
      // The spellbook on the paper doll opens the book (VCMI's CHeroWindow, as the original).
      spellbook: (h) => void this.openAdventureSpells(h.id),
      canDismiss: (h) => !this.dismissWhy(h),
      dismissWhy: (h: Hero) => reason(this.dismissWhy(h)),
      send: (action) => s.sendAct(action),
      listen: s.listen,
    }).finally(() => (this.heroScreenLoading = false));
  }

  /** Shipyard on the map: the original shipyard window. */
  showShipyard(st: AdventureState, objectId: number) {
    const s = this.s;
    if (!s.world) return;
    void shipyardDialog(s.modals, s.color(), st, s.world, st.objects[objectId], (action) => s.sendAct(action));
  }
  showMarket = (heroId: number, objectId: number) => this.s.state && this.s.world && openObjectWindow(this.s.advCtx, heroId, objectId);

  // ---- adventure spells -------------------------------------------------------
  async openAdventureSpells(id = this.s.selected, pick?: number) {
    const s = this.s;
    if (!s.state || !s.world || !s.myTurn()) return;
    const h = s.state.heroes[id];
    if (!h || h.removed) return;
    const aim = await castWindow(s.advCtx, h, pick);
    if (!aim) return;
    s.aiming = aim;
    // GENRLTXT 23 "Select Spell Target".
    s.notice((await s.gameLine(23)) ?? tr("Select Spell Target"));
  }

  // ---- adventure options: puzzle map, digging, scenario info ------------------------
  async openPuzzle() {
    // GENRLTXT 62-64: the original's words for the date, as the map's bar.
    const words = await originalWords("genrltxt", { Month: 62, Week: 63, Day: 64 });
    const s = this.s;
    const { state, map } = s;
    if (!state || !map) return;
    const p = state.players[s.me()];
    const total = state.objects.filter((o) => o.type === 57).length;
    const ratio = total ? (p?.obelisks?.length ?? 0) / total : 0;
    const g = state.grail ?? { x: 0, y: 0, z: 0 };
    const date = dateLine(state.day, ": ", [words("Month"), words("Week"), words("Day")]);
    // (The Grail's level, whichever level the obelisk or the view is on.)
    void puzzleWindow(s.modals, s.color(), { faction: p?.faction ?? "castle", ratio, picture: (frame) => s.view.landPicture(g.z ?? 0, frame), grail: g, resources: p?.resources, date });
  }
  async scenarioInfo() {
    const s = this.s;
    if (!s.state || !s.map) return;
    s.mapsInfo ??= await (await fetchRetry("/maps-info")).json();
    scenarioInfoWindow(s.advCtx, s.map, s.infoFor(s.state.mapFile));
  }
  /** View World (and the View Air / View Earth spells): the whole map at a glance. */
  openWorldView() {
    const s = this.s;
    const { state, map, view, worldView, hud } = s;
    if (!state || !map || worldView.active) return;
    void worldView.open(
      {
        panel: hud.panel,
        mapLayer: hud.mapLayer,
        player: s.me(),
        state: () => s.state!,
        camera: s.camera,
        mapSize: () => s.map?.size ?? 0,
        applyCamera: () => s.camera.apply(),
        revealAll: (on) => {
          view.viewer = on || s.fogLifted ? -1 : s.me();
          view.objectsOf = on && !s.fogLifted ? s.me() : -1;
          if (s.state) void view.update(s.state);
        },
        level: () => view.currentLevel,
        toggleLevel: () => s.bar.levelBtn.click(),
        openPuzzle: () => this.openPuzzle(),
        onClose: (x, y) => s.centerOn(x, y),
        placeSide: hud.placeWorldSide ? (side) => s.hud.placeWorldSide?.(side) : undefined,
      },
      mapViews(state, s.me()),
    );
  }

  /** Whether the quest log has anything (the exchange window's buttons are greyed without: VCMI's hasJournalEntries). */
  hasQuests = () => !!this.s.state && this.s.state.objects.some((o) => (o.type === 83 || o.type === 215) && o.visitors?.includes(this.s.me()));

  /** The quests this player has been given (Seer's Huts and Quest Guards visited). */
  async openQuests() {
    const s = this.s;
    if (!s.state || !s.world || !s.map) return;
    await questsWindow(s.advCtx);
  }

  openKingdom() {
    const s = this.s;
    if (!s.state || !s.world) return;
    void kingdomOverview(s.modals, {
      state: () => s.state!,
      player: s.me(),
      creatures: s.world.creatures,
      artifacts: s.data.artifacts,
      openHero: (id) => this.openHeroScreen(id, true),
      openTown: (id) => s.openTown(id),
      world: () => s.world!,
      moraleLuck: (h) => heroMoraleLuck(s.state!, s.world!, h),
    });
  }

  /**
   * Digging (D, the options' shovel): the rules' reasons it can't be done (cannotDig), in the original's words.
   */
  async dig() {
    const s = this.s;
    if (!s.state || !s.world || !s.myTurn() || s.selected < 0) return;
    const h = s.state.heroes[s.selected];
    if (!h || h.removed) return;
    const why = cannotDig(s.state, s.world, h);
    if (why) return void dialog(s.modals, (await s.gameLine(why.line)) ?? rulesText(why.text, "dig"), s.color());
    s.sendAct({ type: "dig", hero: s.selected });
  }

  async openAdvOptions() {
    const choice = await advOptionsWindow(this.s.modals, this.s.color());
    if (choice === "puzzle") this.openPuzzle();
    else if (choice === "dig") void this.dig();
    else if (choice === "info") this.scenarioInfo();
    else if (choice === "world") this.openWorldView();
    else if (choice === "replay") void this.s.replays.replayTurn();
  }

  /** The original's question before Restart, Main Menu and Quit (GENRLTXT 67, 578, 69: VCMI's SettingsMainWindow), OK / Cancel. */
  private async sure(id: number, then: () => void) {
    const question = (await gameTexts().catch(() => null))?.general[id] || englishLine("genrltxt", id);
    if ((await dialog(this.s.modals, question, this.s.color(), { buttons: YES_NO })) === "yes") then();
  }
  /** The original System Options window (the HUD's button, O, Escape, and the page menu's item). */
  openSystemOptions() {
    const s = this.s;
    void systemOptions(s.modals, s.color(), {
      load: () => void s.savedGames.load(),
      save: () => void s.savedGames.save(),
      restart: () => s.state && void this.sure(67, () => s.state && void s.start.open(s.state.mapFile)),
      mainMenu: () => void this.sure(578, () => (location.hash = "#menu")),
      quit: () => void this.sure(69, () => (location.hash = "#menu")),
    }, (text) => s.notice(text));
  }
  // Back with nothing open on the map: whether to leave (Main Menu, Quit, Return), not all of System Options.
  askLeave = () => {
    const s = this.s;
    if (!extraOn("leaveAsk") || s.battle || s.town.open || s.modals.open || s.worldView.active || s.aiming) return false;
    void leaveAsk(s.modals, s.color()).then((a) => (a === "menu" ? (location.hash = "#menu") : a === "quit" ? leaveApp() : undefined));
    return true;
  };
}
