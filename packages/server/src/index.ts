import {
  adventureAiTurn,
  type AdventureAction,
  type AdventureEvent,
  type AdventureState,
  type BattleAction,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type Controller,
  type GameData,
  viewFor,
  type Side,
  World,
  aiStep,
  applyAction,
  battleFor,
  applyAdventureAction,
  beginAdventure,
  controlSide,
  Refusal,
  generateRandomMap,
  parseRandomMapName,
  parseSceneName,
  generateScene,
  generateOccasion,
  parseOccasionName,
  parseStrategyName,
  generateStrategy,
  stageOccasionBattle,
  type CampaignStart,
  createBattle,
  ensureGrail,
  finishBattle,
  isInteractive,
  nextAiPlayer,
  playAiTurn,
  type CaretakerLog,
  canAct,
  caretakerTurn,
  emptyCaretakerLog,
  startBattle,
  surrenderCost,
  upgradeAdventureState,
  saveMapMismatch,
  type AdventureSetup, ruleOn } from "@heroes/core";
import type { H3Map } from "@heroes/formats";
/**
 * Rule newAi (on by default): every computer player without a chosen personality plays with the New AI ("fresh");
 * off, the earlier computer led by the map's AI tactic. Applied at the game's start here, so the simulations that
 * build games themselves keep the engine they name.
 */
export function newAiChoices(choices: AdventureSetup["choices"], controllers: ("human" | "ai" | "none")[] | undefined, rules: AdventureSetup["rules"]): AdventureSetup["choices"] {
  if (!ruleOn(rules, "newAi")) return choices;
  return Array.from({ length: Math.max(8, choices?.length ?? 0, controllers?.length ?? 0) }, (_, c) => {
    const ch = choices?.[c];
    return ch?.personality ? ch : { ...ch, personality: "fresh" as const };
  });
}
import { type GameReport, battleReport, townOwners, townReports } from "./reports.ts";

export { type GameReport, type Loss, type Words, caretakerReport, reportText } from "./reports.ts";
export { type HeroLook, type ReplayStep, REPLAY_KEPT, flagOwners, replaySteps } from "./turnReplay.ts";

export type ClientMessage =
  | { t: "start"; setup: BattleSetup }
  | { t: "resume"; state: BattleState }
  | { t: "act"; action: BattleAction }
  | { t: "control"; side: Side; controller: Controller }
  /** HotA's Restart in a quick combat's results window: the battle again from its start, fought by hand (one human, before anything else is done). */
  | { t: "battleRestart" }
  /** An addition (EXTRAS battleUndo): the battle back to just before the last human decision (a misclick); the other human in it agrees first. */
  | { t: "battleUndo" }
  /** The other human's answer to an undo asked for (undoAsk). */
  | { t: "battleUndoAnswer"; yes: boolean }
  | { t: "advStart"; mapFile: string; seed: number; controllers?: ("human" | "ai" | "none")[]; turnMode?: "simultaneous" | "sequential"; simultaneousUntil?: number; campaign?: CampaignStart; difficulty?: number; choices?: AdventureSetup["choices"]; turnMinutes?: number; noHota?: boolean; rules?: AdventureSetup["rules"] }
  | { t: "advResume"; state: AdventureState }
  | { t: "advAct"; action: AdventureAction }
  /** The computer plays the player's own turn (a scene's "Watch the AI": ?ai=<days>), up to a battle it starts (shown, the AI on both sides). */
  | { t: "advAiTurn" }
  /** Hot seat: a colour goes to the computer (a player had to leave) or back to a person, from where it stands. */
  | { t: "advSeat"; player: number; controller: "human" | "ai" };

export type ServerMessage =
  /** `undo`: the decision this seat may take back (battleUndo); `rewound`: the battle went back (an undo), drawn afresh. */
  | { t: "update"; state: BattleState; events: BattleEvent[]; undo?: UndoMove; rewound?: boolean }
  /** The player `from` asks to take back `move`, the last of the battle you share (battleUndoAnswer). */
  | { t: "undoAsk"; from: number; move: UndoMove }
  | { t: "adv"; state: AdventureState; events: AdventureEvent[] }
  /** `bug`: not the rules turning the action down (a Refusal) but an error inside them, by kind and place. */
  | { t: "error"; message: string; bug?: string };

/** Said on resuming a save whose map has changed since (saveMapMismatch). */
export const SAVE_MAP_CHANGED = "This game was saved on an earlier version of the game, and its map has changed since. It goes on, but heroes and objects may stand in odd places (on rocks, in the water). If it plays badly, start a new game.";

/** Loads a map by file name (fetch in the browser, fs on a host). */
export type MapLoader = (file: string) => Promise<H3Map>;

/** Delivers a message to one seat (player colour), or to everyone when `to` is undefined. */
export type Send = (msg: ServerMessage, to?: number) => void;

export { viewFor };

/**
 * A decision that can be taken back (EXTRAS battleUndo), for the question's words ("Pikemen attacked the Goblins"):
 * the action, and for a spell aimed at a hex the stack that stood there.
 */
export type UndoMove = { action: BattleAction; target?: number };

/** How many decisions back a battle can be undone (EXTRAS battleUndo). */
export const UNDO_KEPT = 30;

/**
 * Authoritative game session. Transport-agnostic: the browser runs it in a
 * Web Worker for single player, a Node host runs it behind WebSockets for
 * multiplayer. Each message carries the sender's seat (player colour).
 * Every action produces its own update, so clients can animate them one by
 * one with the matching state.
 */
export class GameServer {
  private battle: BattleState | null = null;
  private adv: { state: AdventureState; world: World } | null = null;
  /** The game as the last battle a human started stood at its start (HotA's Restart after quick combat); gone with the next move. */
  private restart: { seat: number; state: AdventureState } | null = null;
  /**
   * Each battle's states just before its human decisions (EXTRAS battleUndo), newest last, by battle id; gone with
   * the battle. Only in this session's memory: a reload or a host restart starts the list afresh.
   */
  private undos = new Map<number, { state: BattleState; move: UndoMove }[]>();
  /** An undo waiting for the other humans in the battle to agree (`waiting` still to answer). */
  private undoAsked: { battle: number; from: number; waiting: Set<number> } | null = null;
  private readonly data: GameData;
  private readonly loadMap: MapLoader;
  private readonly send: Send;

  /** Each human always gets their own view, even when one is left (a multiplayer room: a player the computer stands in for may come back). */
  private readonly views: boolean;

  /** Battles between players and towns changing hands, as they happen (a multiplayer host keeps them for players away). */
  private readonly onReport: ((r: GameReport) => void) | undefined;
  /** Who held each town as last published (to see which changed hands), and a town just taken in a reported battle. */
  private towns: Map<number, number> | null = null;
  private reportedTown = -1;
  /** Every adventure update as it goes out: the whole game after it and its events (a multiplayer host records them for players away). */
  private readonly onPublish: ((s: AdventureState, w: World, events: AdventureEvent[]) => void) | undefined;

  constructor(data: GameData, loadMap: MapLoader, send: Send, opts: { views?: boolean; onReport?: (r: GameReport) => void; onPublish?: (s: AdventureState, w: World, events: AdventureEvent[]) => void } = {}) {
    this.data = data;
    this.views = !!opts.views;
    this.onReport = opts.onReport;
    this.onPublish = opts.onPublish;
    // A random map is made again from its name (options and seed) wherever it is loaded.
    this.loadMap = async (file) => {
      const random = parseRandomMapName(file);
      const scene = parseSceneName(file);
      const occasion = parseOccasionName(file);
      if (parseStrategyName(file)) return generateStrategy(data, file);
      return random ? generateRandomMap(data, random) : scene ? generateScene(data, scene) : occasion ? generateOccasion(data, occasion) : loadMap(file);
    };
    this.send = send;
  }

  /** Battles whose occasion (occasions.ts) has been staged: each once, as it begins. */
  private staged = new WeakSet<BattleState>();
  private stageOccasion(b: BattleState) {
    if (!this.adv || this.staged.has(b)) return;
    this.staged.add(b);
    stageOccasionBattle(this.adv.state, b, this.data);
  }

  get state(): AdventureState | null {
    return this.adv?.state ?? null;
  }

  get world(): World | null {
    return this.adv?.world ?? null;
  }

  /** `seat` is the sender's player colour; single player leaves it out and plays the first human. */
  async handle(msg: ClientMessage, seat?: number): Promise<void> {
    try {
      const who = seat ?? this.adv?.state.players.findIndex((p) => p.controller === "human") ?? 0;
      // (Anything else done on the map: the last battle can't be restarted any more.)
      if (msg.t.startsWith("adv")) {
        this.restart = null;
        await this.applyAdventure(msg, who);
      } else this.applyBattle(msg, who);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof Refusal) return this.send({ t: "error", message }, seat);
      // A bug, not a refusal: said as such, with where it happened, and logged.
      const bug = err instanceof Error ? `${err.name}: ${err.message} @ ${err.stack?.split("\n")[1]?.trim() ?? ""}` : String(err);
      console.error("GameServer:", err);
      this.send({ t: "error", message, bug }, seat);
    }
  }

  // ---- standalone or adventure battles -------------------------------------

  /** The battle this seat takes part in (map battles: as attacker or defender). */
  private battleOf(seat: number): BattleState | null {
    return this.adv ? (battleFor(this.adv.state, seat)?.pb.battle ?? null) : this.battle;
  }

  /** Sends a battle update to every human taking part (everyone, for quick battles). */
  private publishBattle(seat: number, events: BattleEvent[], rewound = false) {
    const b = this.battleOf(seat);
    if (!b) return;
    const last = this.undos.get(b.id)?.at(-1);
    const extra = { ...(last && b.winner === null ? { undo: last.move } : {}), ...(rewound ? { rewound } : {}) };
    if (!this.adv) return this.send({ t: "update", state: structuredClone(b), events, ...extra });
    for (const p of this.battleHumans(b)) this.send({ t: "update", state: structuredClone(b), events, ...extra }, p);
  }

  /** Kept before a human's decision, for an undo (at most UNDO_KEPT back). */
  private keepForUndo(before: BattleState, action: BattleAction) {
    const list = this.undos.get(before.id) ?? [];
    // (A spell's target hex: the stack there, named in the question.)
    const hex = action.type === "cast" || action.type === "creatureCast" ? action.target : -1;
    const target = hex >= 0 ? before.units.find((u) => u.count > 0 && u.pos === hex)?.id : undefined;
    list.push({ state: before, move: { action, ...(target !== undefined ? { target } : {}) } });
    if (list.length > UNDO_KEPT) list.shift();
    this.undos.set(before.id, list);
    this.undoAsked = null;
  }

  /** The battle back to just before its last human decision (the others in it have agreed). */
  private rewind(seat: number) {
    const b = this.battleOf(seat);
    const back = b && this.undos.get(b.id)?.pop()?.state;
    if (!b || !back) throw new Refusal("There is nothing to undo.");
    this.undoAsked = null;
    if (this.adv) {
      const found = battleFor(this.adv.state, seat);
      if (found) found.pb.battle = back;
    } else this.battle = back;
    // (Sides handed to the computer since, auto combat say, stay as they are now: the player chose that last.)
    for (const [i, side] of b.sides.entries()) Object.assign(back.sides[i], { controller: side.controller, auto: side.auto });
    this.publishBattle(seat, [], true);
  }

  /** The human players in a map battle: they see it, also once auto combat plays their side. */
  private battleHumans(b: BattleState): number[] {
    const players = this.adv?.state.players ?? [];
    return [...new Set(b.sides.map((x) => x.owner).filter((p): p is number => p !== undefined && players[p]?.controller === "human"))];
  }

  /**
   * Everything a player needs to pick the game up (rejoining a multiplayer room, or after the host
   * restarted): their view of the adventure and the battle they're in.
   */
  snapshot(seat: number): ServerMessage[] {
    const a = this.adv;
    if (!a) return this.battle ? [{ t: "update", state: structuredClone(this.battle), events: [] }] : [];
    const out: ServerMessage[] = [{ t: "adv", ...(this.whole() ? { state: structuredClone(a.state), events: [] } : viewFor(a.state, a.world, seat, [])) }];
    const b = battleFor(a.state, seat)?.pb.battle;
    if (b) out.push({ t: "update", state: structuredClone(b), events: [] });
    return out;
  }

  /** AI turns, one update each, until a human is up; then a finished map battle is settled. */
  private runBattleAi(seat: number) {
    for (let ev = this.battleOf(seat) && aiStep(this.battleOf(seat)!); ev; ev = aiStep(this.battleOf(seat)!)) this.publishBattle(seat, ev);
    const a = this.adv;
    const found = a && battleFor(a.state, seat);
    const over = this.battleOf(seat);
    if (over && over.winner !== null) this.undos.delete(over.id);
    if (a && found && found.pb.battle.winner !== null) {
      const report = this.onReport && battleReport(a.state, a.world, found.pb);
      if (report) this.onReport!(report);
      this.reportedTown = found.pb.object;
      this.publishAdventure(finishBattle(a.state, a.world, found.key));
      this.reportedTown = -1;
      this.runAdventureAi();
    }
  }

  private applyBattle(msg: ClientMessage, seat: number) {
    switch (msg.t) {
      case "battleRestart": {
        const a = this.adv;
        const r = this.restart;
        if (!a || !r || r.seat !== seat || battleFor(a.state, seat) || a.state.winner !== undefined) throw new Refusal("There is no battle to restart.");
        this.restart = null;
        // The battle as it began, our side ours again; kept for a second try only if this one is quick too.
        a.state = r.state;
        this.restart = { seat, state: structuredClone(r.state) };
        a.world.refresh(a.state);
        this.publishAdventure([]);
        this.publishBattle(seat, []);
        break;
      }
      case "battleUndo": {
        const b = this.battleOf(seat);
        if (!b || b.winner !== null || !this.undos.get(b.id)?.length) throw new Refusal("There is nothing to undo.");
        // Two humans in the battle: the others agree first (each asked on their own screen).
        const others = this.adv ? this.battleHumans(b).filter((p) => p !== seat) : [];
        if (!others.length) {
          this.rewind(seat);
          break;
        }
        this.undoAsked = { battle: b.id, from: seat, waiting: new Set(others) };
        const move = this.undos.get(b.id)!.at(-1)!.move;
        for (const p of others) this.send({ t: "undoAsk", from: seat, move }, p);
        return;
      }
      case "battleUndoAnswer": {
        const b = this.battleOf(seat);
        const asked = this.undoAsked;
        // (Asked about a battle that has moved on since: nothing to answer any more.)
        if (!b || !asked || asked.battle !== b.id || !asked.waiting.has(seat)) return;
        if (!msg.yes) {
          this.undoAsked = null;
          this.send({ t: "error", message: "The other player doesn't agree to undo the last move." }, asked.from);
          return;
        }
        asked.waiting.delete(seat);
        if (asked.waiting.size) return;
        this.rewind(asked.from);
        break;
      }
      case "start":
        this.undos.clear();
        this.adv = null;
        this.battle = createBattle(msg.setup, this.data.creatures, this.data.spells);
        this.publishBattle(seat, startBattle(this.battle));
        break;
      case "resume":
        this.undos.clear();
        this.adv = null;
        this.battle = msg.state;
        // Saved games carry a creature snapshot; refresh it so data fixes apply on reload.
        for (const id of Object.keys(this.battle.creatures)) this.battle.creatures[+id] = this.data.creatures[+id];
        this.publishBattle(seat, []);
        break;
      case "act": {
        const b = this.battleOf(seat);
        if (!b) throw new Refusal("no battle");
        // Hypnotized stacks answer to the side that controls them now.
        const unit = b.units[msg.action.unit];
        const side = unit ? b.sides[controlSide(unit)] : undefined;
        if (side?.controller !== "human" || (this.adv && side.owner !== seat)) throw new Refusal("that unit isn't yours");
        // A surrender needs the gold in the kingdom's treasury (GENRLTXT 29).
        if (msg.action.type === "retreat" && msg.action.surrender && this.adv && unit && this.adv.state.players[seat].resources[6] < surrenderCost(b, controlSide(unit))) throw new Refusal("You don't have enough gold!");
        // (Kept for an undo once the rules have taken it: a refused action isn't a decision.)
        const before = structuredClone(b);
        const events = applyAction(b, msg.action);
        this.keepForUndo(before, msg.action);
        this.publishBattle(seat, events);
        break;
      }
      case "control": {
        const b = this.battleOf(seat);
        if (!b) throw new Refusal("no battle");
        // On the map, only the side's own player hands it to the computer (auto combat) or takes it back.
        const side = b.sides[msg.side];
        if (!side || (this.adv && side.owner !== seat)) throw new Refusal("that side isn't yours");
        side.controller = msg.controller;
        side.auto = msg.controller === "ai" || undefined;
        this.publishBattle(seat, []);
        break;
      }
    }
    this.runBattleAi(seat);
  }

  // ---- adventure -------------------------------------------------------------

  /**
   * Sends the adventure state. With two human players or more, each gets only what they may see:
   * enemy heroes on ground they haven't explored are left out (with their movements), and other
   * players' explored maps too (allies' stay).
   */
  private publishAdventure(events: AdventureEvent[]) {
    if (!this.adv) return;
    const { state: s, world: w } = this.adv;
    if (this.onReport) {
      if (this.towns) for (const r of townReports(s, this.towns, this.reportedTown)) this.onReport(r);
      this.towns = townOwners(s);
    }
    this.onPublish?.(s, w, events);
    const humans = s.players.filter((p) => p.controller === "human").map((p) => p.color);
    if (this.whole()) return this.send({ t: "adv", state: structuredClone(s), events });
    for (const seat of humans) this.send({ t: "adv", ...viewFor(s, w, seat, events) }, seat);
  }

  /** The whole game goes out as it is (one human at this screen, nobody to keep anything from). */
  private whole(): boolean {
    return !this.views && (this.adv?.state.players.filter((p) => p.controller === "human").length ?? 0) < 2;
  }

  /**
   * A multiplayer player gone (or back): the computer plays their colour, their battle included,
   * until they return; then it is theirs again from where it stands.
   */
  setController(seat: number, controller: "human" | "ai") {
    const a = this.adv;
    const p = a?.state.players[seat];
    if (!a || !p || p.controller === "none" || p.controller === controller || a.state.winner !== undefined) return;
    p.controller = controller;
    const found = battleFor(a.state, seat);
    if (found) for (const side of found.pb.battle.sides) if (side.owner === seat) side.controller = controller;
    this.publishAdventure([]);
    if (controller === "human") return;
    if (found) {
      this.publishBattle(seat, []);
      this.runBattleAi(seat);
    }
    this.runAdventureAi();
  }

  /**
   * A friend away past the turn deadline (or on vacation): the caretaker plays their turn, cautiously
   * (caretaker.ts), as a computer player would (offers answered by the rules, a battle fought by the
   * battle AI); the colour stays theirs. Null: not theirs to play now.
   */
  caretake(seat: number): CaretakerLog | null {
    const a = this.adv;
    const p = a?.state.players[seat];
    if (!a || !p || p.controller !== "human" || a.state.winner !== undefined || !canAct(a.state, seat) || battleFor(a.state, seat)) return null;
    const log = emptyCaretakerLog();
    p.controller = "ai";
    try {
      playAiTurn(a.state, a.world, seat, (events) => this.publishAdventure(events), (s, w, player = seat) => caretakerTurn(s, w, player, log));
    } finally {
      p.controller = "human";
      const found = battleFor(a.state, seat);
      if (found) for (const side of found.pb.battle.sides) if (side.owner === seat) side.controller = "human";
    }
    this.publishAdventure([]);
    this.runAdventureAi();
    return log;
  }

  private async openWorld(state: AdventureState, map: H3Map) {
    const interactive = new Set(map.objects.map((_, i) => i).filter((i) => isInteractive(map, i)));
    const world = new World(map, this.data, interactive);
    world.refresh(state);
    ensureGrail(state, map, world);
    this.adv = { state, world };
    this.towns = null;
  }

  /** One AI player's turn; a battle where a human defends is shown to them and waits for their moves. */
  private aiTurn(player: number) {
    const a = this.adv!;
    if (!playAiTurn(a.state, a.world, player, (events) => this.publishAdventure(events))) return;
    this.publishBattle(player, []);
    this.runBattleAi(player);
  }

  /** AI players move: in turn order (sequential), or once every human has ended the day (simultaneous). */
  private runAdventureAi() {
    const a = this.adv;
    if (!a) return;
    for (let guard = 0; guard < 64; guard++) {
      const player = nextAiPlayer(a.state);
      if (player < 0) return;
      this.aiTurn(player);
    }
  }

  private async applyAdventure(msg: ClientMessage, seat: number) {
    switch (msg.t) {
      case "advStart": {
        this.undos.clear();
        this.battle = null;
        const map = await this.loadMap(msg.mapFile);
        const { state, world, events } = beginAdventure(map, this.data, {
          seed: msg.seed,
          mapFile: msg.mapFile,
          controllers: msg.controllers,
          turnMode: msg.turnMode,
          simultaneousUntil: msg.simultaneousUntil,
          campaign: msg.campaign,
          difficulty: msg.difficulty,
          choices: newAiChoices(msg.choices, msg.controllers, msg.rules),
          turnMinutes: msg.turnMinutes,
          noHota: msg.noHota,
          rules: msg.rules,
        });
        this.adv = { state, world };
    this.towns = null;
        this.publishAdventure(events);
        break;
      }
      case "advResume": {
        this.undos.clear();
        this.battle = null;
        const state = upgradeAdventureState(msg.state);
        const map = await this.loadMap(state.mapFile);
        const changed = saveMapMismatch(state, map);
        await this.openWorld(state, map);
        // (A save from an older build whose map has changed since, a random map generated otherwise now: it goes on, warned.)
        if (changed) console.warn(`GameServer: ${state.mapFile} changed since this game was saved: ${changed}`);
        const warn: AdventureEvent[] = changed ? state.players.filter((p) => p.controller === "human").map((p) => ({ e: "message", player: p.color, text: SAVE_MAP_CHANGED })) : [];
        this.publishAdventure(warn);
        for (const p of Object.keys(this.adv!.state.battles)) this.publishBattle(Number(p), []);
        this.runAdventureAi();
        break;
      }
      case "advAiTurn": {
        const a = this.adv;
        if (!a) throw new Refusal("no game");
        if (a.state.players[seat]?.controller !== "human") throw new Refusal("you're not playing");
        // (Played as a computer player: offers answered, a bank's "attack?" said yes to, as the rules do for one.)
        const player = a.state.players[seat];
        player.controller = "ai";
        let events: AdventureEvent[];
        try {
          events = adventureAiTurn(a.state, a.world, seat);
        } finally {
          player.controller = "human";
        }
        this.publishAdventure(events);
        // A fight it starts is shown, the battle AI on our side too (the next call carries the day on).
        const found = battleFor(a.state, seat);
        if (found) {
          for (const side of found.pb.battle.sides) if (side.owner === seat) side.controller = "ai";
          this.stageOccasion(found.pb.battle);
          this.publishBattle(seat, []);
          this.runBattleAi(seat);
        }
        break;
      }
      case "advSeat": {
        const a = this.adv;
        if (!a) throw new Refusal("no game");
        // (One screen only: in a multiplayer game a colour is its player's, never another's to give away.)
        if (this.views) throw new Refusal("only in a game at one screen");
        const p = a.state.players[msg.player];
        if (!p || p.controller === "none" || !p.alive) throw new Refusal("no such player");
        // (Someone stays at the screen: else the computer would play the whole game out alone.)
        if (msg.controller === "ai" && !a.state.players.some((q) => q.color !== msg.player && q.controller === "human" && q.alive)) throw new Refusal("someone has to keep playing");
        this.setController(msg.player, msg.controller === "ai" ? "ai" : "human");
        return;
      }
      case "advAct": {
        const a = this.adv;
        if (!a) throw new Refusal("no game");
        if (a.state.players[seat]?.controller !== "human") throw new Refusal("you're not playing");
        const had = !!battleFor(a.state, seat);
        const events = applyAdventureAction(a.state, a.world, msg.action, seat);
        const fight = battleFor(a.state, seat);
        if (fight) this.stageOccasion(fight.pb.battle);
        // A battle of ours begins: kept as it starts, for HotA's Restart (one human at this screen).
        if (fight && !had && this.whole()) this.restart = { seat, state: structuredClone(a.state) };
        this.publishAdventure(events);
        if (battleFor(a.state, seat)) {
          this.publishBattle(seat, []);
          this.runBattleAi(seat);
        }
        break;
      }
    }
    this.runAdventureAi();
  }
}
