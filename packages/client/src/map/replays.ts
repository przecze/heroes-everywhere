// Watching the others' moves again: Replay Opponent's Turn (what we saw them do since our turn
// ended, kept as the updates come) and, played by notification, what they did while we were away
// (the host's recap), fast, with a bar to pause it or skip the rest.
import { type AdventureEvent, type AdventureState, canAct, isRevealed } from "@heroes/core";
import type { ReplayStep } from "@heroes/server";
import { tr } from "../i18n/index.ts";
import { messageBox as dialog } from "../ui/dialogs.ts";
import { ReplayBar, applyStep, placeHero, rewind } from "./awayReplay.ts";
import type { MapSession } from "./session.ts";

/** Played by notification, the others' moves watched again: fast, as a replay is. */
const AWAY_TILE_MS = 100;

export class MapReplays {
  /** What the opponents were seen doing since our last turn ended (Replay Opponent's Turn). */
  private log: { before: AdventureState; moves: { hero: number; path: number[] }[] }[] = [];
  /** Whether the next update that isn't ours starts a new record. */
  private recordingFrom = false;
  /** Played by notification: what the others did while we were away, as far as we saw it (from the host's recap), and their names. */
  away: ReplayStep[] = [];
  awayNames: string[] = [];
  private readonly s: MapSession;

  constructor(s: MapSession) {
    this.s = s;
  }

  /** An update about to be shown: opponents' moves we could see, kept for Replay Opponent's Turn (from when our turn ended). */
  record(events: AdventureEvent[]) {
    const { state } = this.s;
    const me = this.s.me();
    const mine = !!state && canAct(state, me);
    if (mine && !this.recordingFrom) this.recordingFrom = true;
    else if (!mine && this.recordingFrom) {
      this.recordingFrom = false;
      this.log = [];
    }
    const theirs = events.filter((ev): ev is Extract<AdventureEvent, { e: "move" }> => ev.e === "move" && !!state && state.heroes[ev.hero]?.owner !== me);
    if (state && theirs.length) this.log.push({ before: state, moves: theirs.map((ev) => ({ hero: ev.hero, path: ev.path })) });
  }

  replayTurn = async () => {
    const s = this.s;
    const { view } = s;
    if (!this.log.length && this.away.length) return this.watchAway();
    if (!s.state || s.busy || !this.log.length) return void dialog(s.modals, tr("There is nothing to replay."), s.color());
    s.busy = true;
    try {
      for (const { before, moves } of this.log) {
        await view.update(before);
        for (const m of moves) {
          if (before.heroes[m.hero]?.z !== view.currentLevel) continue;
          // Only where the land is uncovered, as the turn itself showed it (2026-11-02T23-53: the replay walked
          // them through the dark); the view follows each opponent from its first tile in sight.
          const me = s.me();
          const inSight = s.fogLifted ? undefined : (i: number) => isRevealed(before, me, i);
          if (inSight && !m.path.some(inSight)) continue;
          const from = s.tilePos(m.path.find((i) => !inSight || inSight(i)) ?? m.path[0]);
          s.centerOn(from.x, from.y);
          await s.walk.animate(m.hero, m.path, false, undefined, undefined, inSight);
        }
      }
    } finally {
      if (s.state) await view.update(s.state);
      s.busy = false;
    }
  };

  /** Plays what the others did while we were away on the map, fast, from where things stood; the bar pauses it or skips the rest. */
  watchAway = async () => {
    const s = this.s;
    const { view } = s;
    if (!s.state || !s.map || s.busy || !this.away.length) return;
    s.busy = true;
    const now = s.state;
    const bar = new ReplayBar();
    const startLevel = view.currentLevel;
    try {
      await bar.open(s.modals, s.color());
      const work = rewind(now, this.away);
      await view.update(structuredClone(work));
      const level = async (z: number) => z !== view.currentLevel && (await view.show(s.map!, z, structuredClone(work)));
      for (const st of this.away) {
        if (bar.skipped) break;
        await bar.hold();
        if (st.k === "move") {
          const from = s.tilePos(st.path[0]);
          await level(from.z);
          // (Out of the dark, or through a gate: the hero shows where it comes out.)
          const was = work.heroes[st.hero.id];
          const elsewhere = !view.heroSprites.has(st.hero.id) || !was || was.removed || was.x !== from.x || was.y !== from.y || was.z !== from.z;
          placeHero(work, st.hero, st.path[0]);
          if (elsewhere) await view.update(structuredClone(work));
          bar.say(applyStep(work, st, now, this.awayNames));
          s.centerOn(from.x, from.y);
          await s.walk.animate(st.hero.id, st.path, true, { ms: () => (bar.skipped ? 0 : AWAY_TILE_MS), hold: () => bar.hold() });
          await bar.wait(150);
        } else {
          const o = st.k === "flag" ? now.objects[st.object] : undefined;
          const at = o ? { x: o.x - 1, y: o.y, z: o.z } : st.k === "battle" ? s.tilePos(st.tile) : null;
          if (at) await level(at.z);
          bar.say(applyStep(work, st, now, this.awayNames));
          await view.update(structuredClone(work));
          if (at) s.centerOn(at.x, at.y);
          // A battle is shown as a picture on its tile (the swords, a ring green for a won fight and red for a lost one), then told.
          if (at && st.k === "battle") await Promise.race([view.battleMark(at.x, at.y, st.owner === s.me() ? st.won : !st.won, bar.skipped ? 0 : 1500), bar.wait(2200)]);
          await bar.wait(st.k === "battle" ? 600 : 1000);
        }
      }
    } finally {
      bar.done();
      if (s.state && s.map) {
        if (view.currentLevel !== startLevel) await view.show(s.map, startLevel, s.state);
        await view.update(s.state);
      }
      s.busy = false;
      const h = s.state?.heroes[s.selected];
      if (h && !h.removed && h.z === view.currentLevel) s.centerOn(h.x, h.y);
    }
  };
}
