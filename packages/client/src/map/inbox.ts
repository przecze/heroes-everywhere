// What the server sends the adventure map, handled strictly in order: each update's reactions played
// out (walks, sounds, messages, windows: reactions.ts), the new state drawn and kept, battles handed
// to the battle screen, and at a hot seat the screen handed from one player to the next.
import {
  type AdventureEvent,
  type AdventureState,
  PLAYER_NAMES,
  allied,
  battleFor,
  canAct,
  daysToTakeTown,
  heroMoraleLuck,
  isRevealed,
  movingNow,
  parseCampaignRef,
  scenarioScore,
  upgradeAdventureState, ownTowns } from "@heroes/core";
import type { ServerMessage, UndoMove } from "@heroes/server";
import { undoWords } from "../battle/undoWords.ts";
import { extra } from "../settings.ts";
import { tr, trn, said, fmt, NONE, reason, rulesText } from "../i18n/index.ts";
import { enemyMovesShown } from "../settings.ts";
import { fast } from "../speed.ts";
import { YES_NO, messageBox as dialog } from "../ui/dialogs.ts";
import { resolveText } from "../ui/gameText.ts";
import { gameOverText, scenarioEnd } from "../ui/highScores.ts";
import { exchangeWindow } from "../ui/exchange.ts";
import { joinersWindow, mapGarrisonWindow } from "../ui/joiners.ts";
import { setSeats } from "../chrome/pageMenu.ts";
import { playSound } from "../audio.ts";
import { loadDef } from "../assets.ts";
import { offerNotifications } from "../notifyAsk.ts";
import { reportError } from "../feedback/errors.ts";
import { logPlay } from "../feedback/recent.ts";
import { componentViews, dwellingDialog, localLoot, gameOverArgs, offerDialog, scriptAskDialog, weekProclamation, wonBy } from "./dialogs.ts";
import { type Reaction, reactionsFor } from "./reactions.ts";
import { ObjectSounds } from "./sounds.ts";
import { isHotaTutorial } from "./tutorial.ts";
import { eventText } from "./playLog.ts";
import { openSeats } from "./seats.ts";
import { SAVE_KEY, unstore } from "./storage.ts";
import type { MapSession } from "./session.ts";

/** How long the info box shows a computer player's turn at least (its flag and the hourglass), even when nothing it does is in sight. */
const OTHERS_TURN_MS = 700;
/** How long the map holds on an opponent's walk that ends in an attack on us, before the battle screen. */
const ATTACK_PAUSE_MS = 600;
/** After an opponent's fight with a monster in sight: the ground where it stood, a moment, before the turn goes on. */
const CLASH_AFTER_MS = 350;

/** Who is moving: the player whose turn it is, or (simultaneous turns) everyone yet to end the day. */
const movers = (s: AdventureState) => movingNow(s).join();

export class MapInbox {
  /** Updates waiting to be shown, in order. */
  readonly queue: { state: AdventureState; events: AdventureEvent[] }[] = [];
  // Server messages are handled strictly in order: a battle update must not overtake
  // the one still waiting for the battle screen to load.
  private chain: Promise<void> = Promise.resolve();
  /** Which visit and pickup sounds each update's events play. */
  private readonly objectSounds = new ObjectSounds();
  /** Whose turn the info box last showed ("" ours), since when, and whether the view went after an opponent. */
  /**
   * Simultaneous turns with friends: a friend ending their day while ours goes on is said over the map (every
   * layout; the upright phone has no status window), so nobody plays on unaware that someone waits for them.
   */
  private friendsDone(before: AdventureState | null | undefined, now: AdventureState) {
    const { s } = this;
    const me = s.me();
    if (!before || !s.lobby.room || me < 0 || !extra("asyncGames") || now.turnMode !== "simultaneous" || before.day !== now.day || !canAct(now, me)) return;
    const done = now.players.flatMap((p, seat) => (seat !== me && p.controller === "human" && now.ended[seat] && !before.ended?.[seat] ? [s.lobby.room!.players.find((x) => x.seat === seat)?.name ?? tr(PLAYER_NAMES[seat])] : []));
    if (done.length) s.hud.setStatus(trn(done.length, "%2 has ended the day and waits for you.", "%2 have ended the day and wait for you.", done.join(", ")), true);
  }

  private shownMover = "";
  private shownAt = 0;
  private followedOpponent = false;
  /** An opponent fought a monster in sight this update: the map holds a moment once it is gone (react "clash"). */
  private clashSeen = false;
  /** The turn of ours last started ("day:player"): a turn starting selects the first hero awake. (Not "we can act
   * again": a battle in our own turn stops that, and its end selected the first hero, not the one that fought:
   * The owner, 2026-10-28 and 10-29.) */
  private turnStartedKey = "";
  /** A new day that came in others' turns before ours: shown as ours starts (its jingle). */
  private dayWaiting: string | null = null;
  /** Through a gate or monolith: the hero to follow to where they came out (-1 none). */
  private followHero = -1;
  private readonly s: MapSession;

  constructor(s: MapSession) {
    this.s = s;
  }

  /** Runs a step after everything sent before it. */
  then(fn: () => Promise<unknown> | unknown) {
    this.chain = this.chain.then(async () => void (await fn())).catch(this.failed);
  }
  receive = (msg: ServerMessage) => this.then(() => this.onServer(msg));

  /** Showing what the server sent went wrong (our bug): logged and reported. */
  failed = (err: unknown) => {
    console.error("server message failed", err);
    reportError("client", err instanceof Error ? err.message : String(err), err instanceof Error ? err.stack : undefined);
  };

  /** Resolves once the map has finished showing what it was sent. */
  settled = () =>
    new Promise<void>((resolve) => {
      const check = () => (!this.s.busy && !this.queue.length ? resolve() : setTimeout(check, 50));
      check();
    });

  private async onServer(msg: ServerMessage) {
    const s = this.s;
    if (msg.t === "error") {
      s.walk.walking = null;
      // (The rules' refusals are English: in the player's language, as a sentence.)
      const line = reason(msg.message) ?? said(msg.message);
      s.notice(said(line.charAt(0).toUpperCase() + line.slice(1)));
      // (While a game is being opened: it couldn't be, say so rather than wait on.)
      if (s.start.resuming && !s.state) s.start.openFailed = msg.message;
      // (A bug in the rules, not a refusal: into the console, which feedback reports carry.)
      if (msg.bug) console.error("game server:", msg.bug);
      // Reported by themselves (feedback/errors.ts): a bug, or a refusal of what the interface let the player try.
      reportError(msg.bug ? "bug" : "refusal", msg.message, msg.bug);
      return;
    }
    if (msg.t === "adv") {
      // Only what's this player's (the computer's moves are many and mostly unseen).
      const me = s.me();
      const mine = (e: AdventureEvent) => (e.e === "message" ? e.player === me : !("hero" in e) || msg.state.heroes[e.hero]?.owner === me);
      for (const e of msg.events) {
        const line = mine(e) && eventText(e, s.namer);
        if (line) logPlay(line);
      }
      this.queue.push({ state: msg.state, events: msg.events });
      void this.drain();
    } else if (msg.t === "update") {
      // Keep battle progress in the local save, so a reload resumes the fight where it was.
      s.lastBattle = msg.state;
      const whole = s.savable();
      const pb = whole ? battleFor(whole, s.me())?.pb : undefined;
      if (!s.lobby.link && whole && pb && pb.battle.id === msg.state.id) {
        pb.battle = msg.state;
        s.keepLocal(whole);
      }
      // The walk up to the monster (or hero) plays out before the battle screen comes up.
      while (s.busy || this.queue.length) await new Promise((r) => setTimeout(r, 30));
      // (Watching an ally's battle: ours comes first.)
      if (s.follow.battle !== undefined) s.battles.close();
      // Another battle right after one (two AI attacks in one round): the last one's results window
      // first, then a screen of its own (fed to the old view, it never opened).
      if (s.battle && s.battles.shown !== msg.state.id) await s.battles.afterBattle();
      // The messages before the fight first ("Insulted by your refusal of their offer, the monsters
      // attack!"), as in the original: not after its results.
      if (!s.battle) await s.messages.chain;
      // An opponent's walk that ends in an attack: the map stays a moment on where it ended before the battle comes
      // up (a one-tile walk took 60 ms, so the attack seemed to come from nowhere: the owner, 2026-10-28 07:52).
      if (!s.battle && this.followedOpponent && !fast && msg.state.sides[0]?.owner !== s.me()) await new Promise((r) => setTimeout(r, ATTACK_PAUSE_MS));
      await s.battles.enter();
      s.battles.shown = msg.state.id;
      s.battle?.update(msg.state, msg.events, msg);
    } else if (msg.t === "undoAsk") await this.undoAsked(msg.from, msg.move, (yes) => s.send({ t: "battleUndoAnswer", yes }));
  }

  /**
   * Another player in our battle asks to take back the last move (EXTRAS battleUndo): asked on the battle's screen,
   * the answer sent (a hot seat: as the colour asked, who is at this screen too).
   */
  private async undoAsked(from: number, move: UndoMove, answer: (yes: boolean) => void) {
    const s = this.s;
    const who = await s.colourName(from);
    const modals = s.battle?.modals ?? s.modals;
    // The move named in the asker's own question's words ("Undo the last move? Pikemen attacked the Goblins").
    const battle = s.battle?.state ?? s.lastBattle;
    const what = battle ? fmt`\n\n${undoWords(battle, move)}` : said("");
    const a = await dialog(modals, fmt`${tr("%1 asks to undo the last move. Do you agree?", said(who))}${what}`, s.me(), { buttons: YES_NO });
    answer(a === "yes");
  }

  /**
   * Hot seat: each human is sent their own view; this screen shows the one playing now. When
   * another human's turn comes (or they must defend in a battle), the board is hidden until
   * they say they're at the screen, as the original's "<colour> player's turn" window.
   */
  fromLocal = async (msg: ServerMessage, to?: number) => {
    const s = this.s;
    // (Down to one person at the screen, the others' colours handed to the computer: theirs from now on.)
    if (to === undefined && msg.t === "adv" && s.hotSeat >= 0 && msg.state.players[s.hotSeat]?.controller !== "human") s.hotSeat = Math.max(0, msg.state.players.findIndex((p) => p.controller === "human"));
    if (to === undefined || msg.t === "error") return this.onServer(msg);
    // Hot seat: the other player in the battle is at this screen too; they answer as their own colour.
    if (msg.t === "undoAsk") return this.undoAsked(msg.from, msg.move, (yes) => s.local.send({ t: "battleUndoAnswer", yes }, to));
    if (s.hotSeat < 0) (s.hotSeat = to), this.seatsMenu();
    if (msg.t === "adv") {
      const st = msg.state;
      const up = st.turnMode === "sequential" && st.players[st.current]?.controller === "human" ? st.current : -1;
      if (to === up && up !== s.hotSeat) await this.handOver(up);
    } else if (msg.t === "update" && to !== s.hotSeat) {
      // A battle the one at the screen isn't in: the defender comes to it.
      const sides = msg.state.sides;
      if (sides.some((x) => x.owner === s.hotSeat && x.controller === "human") || !sides.some((x) => x.owner === to && x.controller === "human")) return;
      await this.handOver(to);
    }
    if (to === s.hotSeat) return this.onServer(msg);
  };
  /** ☰ → Players: in a hot seat game, a colour to the computer (someone had to leave) or back to a person. */
  seatsMenu() {
    const s = this.s;
    setSeats(
      s.hotSeat >= 0 && !s.lobby.link && extra("hotSeatSwap")
        ? () =>
            openSeats({
              players: () => s.state?.players.map((p) => ({ color: p.color, controller: p.controller, alive: p.alive })) ?? [],
              set: (player, controller) => s.local.send({ t: "advSeat", player, controller }, s.hotSeat),
            })
        : null,
    );
  }
  private async handOver(seat: number) {
    const s = this.s;
    await this.settled();
    await s.battles.afterBattle();
    s.hotSeat = seat;
    s.selected = -1;
    s.setMapVisible(false);
    // The original's "%s's turn." (GENRLTXT 13, VCMI's hot seat message), the player named "Red player" (197, PLCOLORS).
    const turn = await resolveText({ file: "genrltxt", id: 13, args: [{ file: "genrltxt", id: 197, args: [await s.colourName(seat)] }] });
    // Under it the player's flag (VCMI's hot seat message carries a FLAG component: CREST58; The owner's note 2026-10-29
    // 00:05 "Dialog has a flag in original game").
    const flag = (await loadDef("crest58.def").catch(() => null))?.get(0)?.[seat];
    await dialog(s.modals, turn ?? tr(`%1 player's turn.`, tr(PLAYER_NAMES[seat])), seat, flag ? { components: [{ texture: flag.texture, caption: NONE }] } : {});
    s.setMapVisible(true);
  }

  /** Carries out one of the screen's reactions to an update (map/reactions.ts). */
  private async react(re: Reaction, next: AdventureState) {
    const s = this.s;
    const { view, modals, panel, messages } = s;
    const watching = s.watching;
    switch (re.r) {
      case "animate": {
        const state = s.state;
        const me = s.me();
        // An opponent walking where we can see: the view goes there and follows it (as the
        // original with enemy moves shown). One walking in the dark takes no time: it was walked
        // tile by tile under the fog, so the computer's turns dragged on with nothing to see.
        const theirMove = !!state && state.heroes[re.hero]?.owner !== me;
        // (An ally's walk is seen whole: its heroes are always in sight, as the host's replay has it.)
        const ally = theirMove && extra("followAllies") && allied(state!, state!.heroes[re.hero]?.owner ?? -1, me);
        const seen = theirMove && enemyMovesShown() && !fast && (ally || re.path.some((i) => s.fogLifted || isRevealed(state!, me, i)));
        if (theirMove && state) s.follow.acted(state, me, state.heroes[re.hero]?.owner ?? -1, s.tilePos(re.path[re.path.length - 1]));
        // (Following allies: only while following, never over our own turn.)
        const goes = seen && s.allies.viewFollows();
        // A walk on the other level: the view goes there when it follows an opponent (the original shows enemy moves
        // underground too; The owner's hero was underground on 2026-10-27 and 10-28 and saw nothing of the computer's turns).
        const z = re.path.length ? s.tilePos(re.path[0]).z : view.currentLevel;
        if (z !== view.currentLevel) {
          if (!goes || !state || !s.map) break;
          await view.show(s.map, z, state);
          s.drawMinimap();
        }
        // (An opponent's walk is seen where the land is uncovered only: the view picks it up at the first tile in sight.)
        const inSight = theirMove && !ally && !s.fogLifted && state ? (i: number) => isRevealed(state, me, i) : undefined;
        if (goes) {
          const from = s.tilePos(re.path.find((i) => !inSight || inSight(i)) ?? re.path[0]);
          s.centerOn(from.x, from.y);
          this.followedOpponent = true;
        }
        // (What the walk cost, for the movement bars to go down step by step.)
        const spent = !theirMove && state ? (state.heroes[re.hero]?.movement ?? 0) - (next.heroes[re.hero]?.movement ?? 0) : 0;
        if (!theirMove || seen) await s.walk.animate(re.hero, re.path, goes, undefined, spent > 0 ? spent : undefined, inSight);
        break;
      }
      case "clash": {
        // Another player's hero beat (or lost to) a monster where we can see it: the two side by side a moment, then once
        // the map has it gone, another (drain's clashSeen), and the turn goes on.
        const state = s.state;
        const o = state?.objects[re.object];
        const tile = o && s.world ? s.world.index(o.x, o.y, o.z) : -1;
        if (!state || !o || fast || !enemyMovesShown() || o.z !== view.currentLevel || !(s.fogLifted || (tile >= 0 && isRevealed(state, s.me(), tile)))) break;
        void playSound("KILLFADE");
        await new Promise((r) => setTimeout(r, ATTACK_PAUSE_MS));
        this.clashSeen = true;
        break;
      }
      case "sound":
        void playSound(re.name);
        break;
      case "message":
        messages.show(re.text, { text: re.ref, components: re.components, toast: re.toast });
        break;
      // A pile taken as a fight ends (a guarded one, the walk going on onto it) is told once the battle screen has
      // closed: it went by under the results window (2026-10-28: "5000 more gold than before, unexplained").
      case "status":
        void s.battles.afterBattle().then(() => {
          s.status(re.text);
          if (re.ref) void localLoot(s.world, re.ref, re.components).then((r) => resolveText(r ?? re.ref!)).then((t) => t && s.status(t));
        });
        break;
      case "pile":
        void s.battles.afterBattle().then(() => componentViews(s.world, [{ kind: "resource", id: re.resource, amount: re.amount }]).then((c) => s.hud.showComponents(c, said(""))));
        break;
      case "battleLine":
        // Once the battle screen has closed: shown at once, it told the ending over the last blows still playing.
        void s.battles.afterBattle().then(() => s.status(tr(re.text)));
        break;
      case "town":
        // (Watching the computer play our side: its visits open no windows. A town taken in a siege: once the battle
        // screen has closed.)
        if (!watching) void s.battles.afterBattle().then(() => s.messages.settled()).then(() => s.openTown(re.object));
        break;
      case "dwelling":
        if (!watching) messages.later(() => dwellingDialog(s.advCtx, next, re.hero, re.object));
        break;
      case "follow":
        this.followHero = re.hero;
        break;
      case "shipyard":
        if (!watching) panel.showShipyard(next, re.object);
        break;
      case "market":
        if (!watching) panel.showMarket(re.hero, re.object);
        break;
      case "offer":
        if (!watching) messages.later(() => offerDialog(s.advCtx, next, re.event));
        break;
      case "scriptAsk":
        if (!watching) messages.later(() => scriptAskDialog(s.advCtx, next, re.event));
        break;
      case "joiners": {
        if (watching) break;
        const id = re.hero;
        messages.later(() =>
          joinersWindow(modals, s.color(), {
            openHero: (h) => panel.openHeroScreen(h, true),
            world: () => s.world!,
            hero: () => s.state?.heroes[id],
            send: (action) => s.sendAct(action),
            listen: s.listen,
          }),
        );
        break;
      }
      case "garrison": {
        if (watching) break;
        const [id, object] = [re.hero, re.object];
        messages.later(() =>
          mapGarrisonWindow(modals, s.color(), {
            openHero: (h) => panel.openHeroScreen(h, true),
            world: () => s.world!,
            hero: () => s.state?.heroes[id],
            garrison: () => s.state?.objects[object],
            send: (action) => s.sendAct(action),
            listen: s.listen,
          }),
        );
        break;
      }
      case "puzzle":
        if (!watching) messages.later(() => s.state && panel.openPuzzle());
        break;
      case "exchange": {
        if (watching) break;
        const pair = re.heroes;
        void exchangeWindow(modals, s.color(), {
          data: s.data,
          moraleLuck: (h) => (s.state && s.world ? heroMoraleLuck(s.state, s.world, h) : { morale: 0, luck: 0 }),
          heroes: () => [s.state!.heroes[pair[0]], s.state!.heroes[pair[1]]],
          send: (action) => s.sendAct(action),
          listen: s.listen,
          openHero: (id) => panel.openHeroScreen(id, true, modals),
          quests: { any: panel.hasQuests, open: () => void panel.openQuests() },
        });
        break;
      }
      case "worldView":
        // (What they show stays in View World until the turn ends: the player's views, core mapViews.)
        if (!watching) messages.later(() => panel.openWorldView());
        break;
      case "gameOver": {
        const me = s.me();
        const won = wonBy(next, me);
        if (parseCampaignRef(next.mapFile)) void s.start.finishCampaignScenario(next, won);
        else {
          // The original's line for how it ended, then (single player) the score screen and high scores.
          messages.later(async () => dialog(modals, await gameOverText(won, next.victoryType ?? -1, next.players[me]?.lostBy ?? -1, gameOverArgs(next, s.world, me, won)), Math.max(0, me)));
          if (!s.lobby.link)
            messages.later(async () => {
              await scenarioEnd(modals, won, scenarioScore(next, Math.max(0, me)), s.map?.name || next.mapFile, (id) => s.world?.creatures[id]?.name ?? "");
              // Over: back to the main menu, and the finished game no longer resumes.
              unstore(SAVE_KEY);
              location.hash = "#menu";
            });
        }
        break;
      }
      case "vanquished": {
        // (The original's "%s has been vanquished!", in the player's colour.)
        const seat = re.player;
        messages.later(async () => {
          const who = await s.colourName(seat);
          return dialog(modals, (await resolveText({ file: "genrltxt", id: 5, args: [who] })) ?? tr("%1 has been vanquished!", who), seat);
        });
        break;
      }
      case "newDay":
        // The day comes as our turn starts (the original's new day at the turn's start, VCMI's onPlayerTurnStarted):
        // a day that turned over in the players' turns before ours waits for theirs to play out (2026-10-30:
        // "enemy movement was during the new day splash, so I couldn't really see it"). Watching (no seat of our
        // own): at once.
        if (canAct(next, s.me()) || next.players[s.me()]?.controller !== "human") this.newDay(next, re.sound);
        else this.dayWaiting = re.sound;
        break;
    }
  }

  /** The new day: its jingle, the HUD's card and day, the astrologers on a week's first, the days left to take a town. */
  private newDay(next: AdventureState, sound: string) {
    const s = this.s;
    const { modals, messages } = s;
    this.dayWaiting = null;
    // The original jingle, and on the first of the week the astrologers' proclamation.
    void playSound(sound);
    s.hud.showNewDay(next);
    const proclamation = weekProclamation(s.world, next);
    if (proclamation) messages.show(proclamation.ref ? said(proclamation.text) : rulesText(proclamation.text, "week"), { text: proclamation.ref });
    // Without a town: the days left to take one (ARRAYTXT 128 / 129, VCMI's onPlayerTurnStarted).
    const p = next.players[s.me()];
    const left = p?.alive ? daysToTakeTown(p, next.day) : 0;
    if (left >= 1) {
      const seat = s.me();
      messages.later(async () => {
        const who = await s.colourName(seat);
        const english = left > 1 ? tr(`%1, you only have %2 days left to capture a town or you will be banished from this land.`, who, left) : tr(`%1, this is your last day to capture a town or you will be banished from this land.`, who);
        const text = await resolveText(left > 1 ? { file: "arraytxt", id: 128, args: [who, left] } : { file: "arraytxt", id: 129, args: [who] });
        return dialog(modals, text ?? english, Math.max(0, seat));
      });
    }
  }

  private async drain() {
    const s = this.s;
    const { view, walk, messages } = s;
    if (s.busy) return;
    s.busy = true;
    await s.mapReady;
    while (this.queue.length) {
      await this.battleOverClosed();
      // Another player's moves wait for what our last battle left to tell and choose.
      if (s.state && this.queue[0] && !canAct(this.queue[0].state, s.me()) && !s.battle) await s.messages.settled();
      const { state: next, events } = this.queue.shift()!;
      s.replays.record(events);
      // (On a game's first update `state` is still empty: the timed messages' player comes from the new state.)
      const messageSeat = s.lobby.seat >= 0 ? s.lobby.seat : s.hotSeat >= 0 ? s.hotSeat : next.players.findIndex((p) => p.controller === "human");
      walk.walkOn(events, next);
      walk.noteVisits(events);
      for (const re of reactionsFor(s.state, next, events, s.me(), messageSeat, this.objectSounds)) await this.react(re, next);
      walk.stepOn();
      const before = s.state;
      // (Kept here: a new game started meanwhile empties `state` while this one is still drawn.)
      const shown = (s.state = upgradeAdventureState(next));
      this.friendsDone(before, shown);
      const me = s.me();
      // The state has where the hero stopped, the land it uncovered and the objects it took.
      s.walkingAt = null;
      s.scheduleAmbient();
      view.viewer = s.fogLifted ? -1 : me;
      const whole = s.savable();
      if (!s.lobby.link && whole) s.keepLocal(whole);
      s.rebuildWorld(shown);
      await view.update(shown);
      if (this.clashSeen) {
        this.clashSeen = false;
        await new Promise((r) => setTimeout(r, CLASH_AFTER_MS));
      }
      walk.redrawRoute();
      s.prefetchBattleArt(shown);
      s.warmTowns(shown);
      if (s.town.open && s.world) await s.town.render(shown, s.world);
      s.changed();
      messages.tutorial.update(shown, s.me());
      messages.firstSteps.update(shown, s.me());
      // (After the first turn ended, on the player's own turn: notifications offered once, never on load.)
      if (s.me() >= 0 && shown.players[s.me()]?.controller === "human" && canAct(shown, s.me())) offerNotifications(s.lobby.room?.async ? s.lobby.room.id : (shown.mapFile ?? ""), shown.day, !!s.lobby.room?.async);
      s.hud.setTutorial(isHotaTutorial(shown.mapFile));
      // Someone else's turn: the info box shows who is moving (their flag and the hourglass) while
      // their moves play out, and each computer player's turn stays on screen for a moment, as in
      // the original (it was drawn only once everything queued had played, so a turn passed unseen).
      if (!canAct(shown, s.me())) {
        const mover = movers(shown);
        if (mover !== this.shownMover) {
          this.shownMover = mover;
          this.shownAt = performance.now();
        }
        s.showInfo();
        // (Held only before the next one's turn: a turn whose moves are still to play shows meanwhile.)
        const left = OTHERS_TURN_MS - (performance.now() - this.shownAt);
        if (this.queue.length && !fast && enemyMovesShown() && left > 0 && movers(this.queue[0].state) !== mover) await new Promise((r) => setTimeout(r, left));
      } else this.shownMover = "";
      // Through a gate or monolith: follow the hero to where they came out.
      if (this.followHero >= 0) {
        const h = shown.heroes[this.followHero];
        this.followHero = -1;
        if (h && !h.removed) s.selectHero(h);
      }
    }
    s.busy = false;
    this.turnStarted();
  }

  /**
   * One order between turns: a battle that is over stays on screen until its results window is closed, and what came
   * after it (the computer's turn going on, a walk onto a pile, a town taken) plays out on the map after that, not
   * under the battle screen (2026-10-29: "did not see the enemy move on after they attacked me"). A battle still
   * being fought doesn't hold the map (its own next update waits on this queue).
   */
  private async battleOverClosed() {
    const s = this.s;
    const b = s.lastBattle;
    if (s.battle && s.follow.battle === undefined && b && b.id === s.battles.shown && b.winner !== null) await s.battles.afterBattle();
  }

  /**
   * After the updates were shown. Our turn starts: the first hero not asleep is selected, else the first
   * town, else the first hero (VCMI's AdventureMapInterface::onPlayerTurnStarted). The hero already
   * selected keeps its route.
   */
  private turnStarted() {
    const s = this.s;
    const { state, walk } = s;
    const me = s.me();
    const key = state ? `${state.day}:${state.turnMode === "simultaneous" ? "all" : state.current}` : "";
    const turnStarts = !!state && canAct(state, me) && key !== this.turnStartedKey;
    // Our move again: an ally's town shown while following goes (their battle ends with their turn),
    // and the next wait starts following again.
    if (turnStarts) {
      s.allies.closeFollowedTown();
      s.follow.following = true;
    }
    if (turnStarts) this.turnStartedKey = key;
    // The day that turned over in the others' turns, now that ours begins.
    if (turnStarts && this.dayWaiting) this.newDay(state, this.dayWaiting);
    // Our turn going on after a battle (the game reloaded mid-battle starts it again): the hero who fought, if still ours.
    // (Taken on the first update we may act in again, so a battle in the middle of a turn changes nothing.)
    const foughtId = state && canAct(state, me) ? s.battles.fought : undefined;
    if (foughtId !== undefined) s.battles.fought = undefined;
    const fought = turnStarts && foughtId !== undefined ? s.mapHeroes().find((x) => x.id === foughtId) : undefined;
    const awake = turnStarts ? (fought ?? s.mapHeroes().find((x) => !x.asleep)) : undefined;
    const firstTown = turnStarts && !awake ? (state ? ownTowns(state, me)[0] : undefined) : undefined;
    if (awake && awake.id !== s.selected) s.selectHero(awake);
    else if (firstTown && firstTown.id !== s.selectedTown) s.selectTown(firstTown.id);
    const h = s.state?.heroes[s.selected];
    // One of our towns selected (the list's first tap): it stays selected across updates. Every update used to fall
    // through to "no hero selected" and select the first hero, so the town's second tap only selected it again
    // (2026-10-29 00:45 / 23:52: "second tap on town in picker doesn't open it").
    const t = s.selectedTown >= 0 ? s.state?.objects[s.selectedTown] : undefined;
    const townHeld = s.selected < 0 && !!t?.town && !t.removed && t.owner === s.me();
    if (firstTown || townHeld) {
      // (The town selected: nothing more to do for a hero.)
    } else if (!h || h.removed || h.owner !== s.me() || h.garrison !== undefined) s.selectHero(s.mapHeroes()[0]);
    else {
      // Our turn again after watching an opponent: the view goes back to our hero.
      // (On the level it is on: following an opponent may have taken the view to the other one.)
      if (this.followedOpponent && s.state && canAct(s.state, s.me())) {
        if (h.z !== s.view.currentLevel && s.map) void s.view.show(s.map, h.z, s.state).then(() => s.drawMinimap());
        s.centerOn(h.x, h.y);
      }
      // A new day restores movement: redraw the planned route's colours.
      if (walk.routeTaken()) walk.dropRoute();
      else if (walk.planned) walk.planTo(h, walk.planned.target);
    }
    if (s.state && canAct(s.state, s.me())) this.followedOpponent = false;
    s.adventureMusic();
    s.showInfo();
    if (!s.battle) s.messages.showLevelUps();
  }
}
