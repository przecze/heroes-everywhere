// The battle screen over the adventure map: opened by the first battle update, closed once its
// results window is dismissed (the messages queued after the fight wait for that), and HotA's Restart
// after a quick combat.
import { battleFor } from "@heroes/core";
import { settings } from "../settings.ts";
import { BattleView } from "../battle/view.ts";
import { whileWaiting } from "../ui/loadingNote.ts";
import type { MapSession } from "./session.ts";

export class MapBattles {
  /** The id of the battle on screen. */
  shown: number | undefined;
  /** The battle is drawn whole (until then the controller's buttons wait, not the battle's prompts over the map). */
  drawn = false;
  /** Battles restarted (HotA's Restart after quick combat): the messages queued before one are dropped. */
  restarts = 0;
  /** The battle on screen is a restarted one: fought by hand, whatever System Options' Quick Combat says. */
  restarting = false;
  /** Our hero in the battle on screen (the attacker or the one attacked): selected again after it, even when the
   *  game was reloaded mid-battle (2026-11-01: a reloaded battle ended on the first hero instead). */
  fought: number | undefined;
  // The battle stays on screen until its results window is dismissed (close).
  /** Resolves once no battle is on screen (messages after a fight wait for its results window). */
  private gone: (() => void)[] = [];
  private readonly s: MapSession;

  constructor(s: MapSession) {
    this.s = s;
  }

  afterBattle = () => (this.s.battle ? new Promise<void>((r) => this.gone.push(r)) : Promise.resolve());

  async enter() {
    const s = this.s;
    const { app, follow } = s;
    if (s.battle) return;
    const pending = s.state ? battleFor(s.state, s.me())?.pb : undefined;
    const ours = pending && [pending.hero, pending.defender].find((id) => id !== undefined && id >= 0 && s.state?.heroes[id]?.owner === s.me());
    if (ours !== undefined) this.fought = ours;
    // Attacked while in a town (a rival's turn, or simultaneous turns): the battle comes first, as
    // in the original; the town screen would otherwise sit over it to the end.
    s.allies.closeFollowedTown();
    s.town.close();
    const watched = follow.battle !== undefined;
    const b = (s.battle = new BattleView(app, (action) => (watched ? s.allies.stopWatching() : s.send({ t: "act", action }))));
    if (!watched) s.allies.tellLook({ k: "battle" });
    // The map stays until the battle is drawn whole (no black or half-drawn field while its art loads).
    this.drawn = false;
    void whileWaiting(b.shown).then(() => s.battle === b && (s.setMapVisible(false), (this.drawn = true)));
    s.messages.tutorial.on(s.state, "battle");
    // Hot seat, two humans fighting: both sides are played at this screen.
    const both = s.hotSeat >= 0 && !!s.lastBattle && s.lastBattle.sides.every((x) => x.controller === "human");
    b.viewer = both ? undefined : s.me();
    // Auto combat: the AI takes over our side for the rest of this b.
    b.goldOf = (player) => s.state?.players[player]?.resources[6];
    b.onAuto = () => {
      if (watched) return s.allies.stopWatching();
      const pb = s.state ? battleFor(s.state, s.me())?.pb.battle : undefined;
      const side = pb?.sides.findIndex((x) => x.owner === s.me() && x.controller === "human");
      if (pb && side !== undefined && side >= 0) s.send({ t: "control", side: side as 0 | 1, controller: "ai" });
    };
    b.onResultClosed = () => this.close();
    // An addition (EXTRAS battleUndo): the battle back to before the last decision (another player in it agrees first).
    b.onUndo = watched ? null : () => s.send({ t: "battleUndo" });
    // HotA's Restart after a quick combat: single player only (one human, no room).
    if (!s.lobby.link && s.state?.players.filter((p) => p.controller === "human").length === 1)
      b.onRestart = () => {
        this.restarts++;
        this.restarting = true;
        this.close();
        s.send({ t: "battleRestart" });
      };
    // System Options' Quick Combat (not when two humans share this screen, nor a restarted battle).
    b.quickStart = settings().quickCombat && !both && !this.restarting && !watched;
    this.restarting = false;
    app.stage.addChild(b.root);
    // (The battle's own seed picks its tune: the game's id would give every battle the same one.)
    await b.init(s.lastBattle?.id ?? s.state?.id ?? 0);
  }

  close = () => {
    const s = this.s;
    const b = s.battle;
    s.battle = null;
    b?.destroy();
    if (s.follow.battle !== undefined) s.follow.battle = undefined;
    else if (b) s.allies.tellLook({ k: "map" });
    const waiting = this.gone;
    this.gone = [];
    waiting.forEach((r) => r());
    s.setMapVisible(true);
    s.adventureMusic();
    // (Not for a battle about to be fought again: its first try's level-ups never happened.)
    if (!this.restarting) s.messages.showLevelUps();
  };
}
