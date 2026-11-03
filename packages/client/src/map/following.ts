// Following allies' turns on screen (the state of it: follow.ts): where we look told to them, their
// town screens opened as they open them, their battles played out here, and letting go of it all
// for a free camera.
import type { ServerMessage } from "@heroes/server";
import { canAct } from "@heroes/core";
import { extra } from "../settings.ts";
import { whileWaiting } from "../ui/loadingNote.ts";
import type { Look } from "../mp.ts";
import type { MapSession } from "./session.ts";

export class AllyFollowing {
  private readonly s: MapSession;

  constructor(s: MapSession) {
    this.s = s;
  }

  /** Allies' turns can be followed now: a game with friends, running, and not our move. */
  followNow = () => {
    const { lobby, state } = this.s;
    return extra("followAllies") && !!lobby.link && lobby.seat >= 0 && !!state && state.winner === undefined && !canAct(state, this.s.me());
  };
  /** Others' walks take the view along (as ever, but with friends only while following, and never during our own turn). */
  viewFollows = () => !extra("followAllies") || !this.s.lobby.link || (this.followNow() && this.s.follow.following);
  /** Where we look, told to our allies (in a room only; only changes go out). */
  tellLook = (look: Look) => {
    const { lobby, follow } = this.s;
    if (lobby.link && lobby.seat >= 0 && follow.battle === undefined) void lobby.link.lobby({ t: "mpLook", look });
  };
  /** The player looks around on their own: a free camera until they tap Follow. */
  letGo = () => {
    if (!this.followNow() || !this.s.follow.following) return;
    this.s.follow.following = false;
    this.s.showInfo();
  };
  /** Back to following: to where the ally followed is, or into their town. */
  takeUp = () => {
    const s = this.s;
    s.follow.following = true;
    s.showInfo();
    if (!this.followNow()) return;
    const at = s.follow.leadAt;
    if (at && at.z === s.view.currentLevel) s.centerOn(at.x, at.y);
    void this.followLook();
  };
  /** Into the town screen the ally followed has open, out of it once they leave it. */
  followLook = async () => {
    const s = this.s;
    const { state, world, follow, town } = s;
    if (!state || !world || !follow.following || s.battle) return;
    const look = follow.looks.get(follow.lead);
    const o = look?.k === "town" ? state.objects[look.object] : undefined;
    if (o && !o.removed && (!town.open || follow.town >= 0) && town.objectId !== o.id) {
      if (o.z === s.view.currentLevel) s.centerOn(o.x - 2, o.y);
      follow.town = o.id;
      s.setMapVisible(false);
      await whileWaiting(town.show(state, world, o.id));
    } else if (!o && follow.town >= 0) this.closeFollowedTown();
  };
  closeFollowedTown() {
    const { follow, town } = this.s;
    if (follow.town < 0) return;
    follow.closing = true;
    town.close();
    follow.closing = false;
    follow.town = -1;
  }
  /** An ally's battle, sent while we follow: it plays out here (nothing of it is ours to press). */
  watchBattle = async (msg: ServerMessage) => {
    const s = this.s;
    const { follow } = s;
    if (msg.t !== "update") return;
    if (follow.battle === undefined) {
      // (Our own battle or town on screen, a free camera, or one already over: not shown.)
      if (s.battle || (s.town.open && follow.town < 0) || !this.followNow() || !follow.following || msg.state.winner !== null) return;
      while (s.busy || s.inbox.queue.length) await new Promise((r) => setTimeout(r, 30));
      if (s.battle || !this.followNow()) return;
      follow.battle = msg.state.id;
      await s.battles.enter();
    }
    if (follow.battle !== msg.state.id || !s.battle) return;
    s.battle.update(msg.state, msg.events, { rewound: msg.rewound });
    // Over: once it has played out here, its results a few seconds, then back to the map (OK closes it sooner).
    const b = s.battle;
    if (msg.state.winner !== null)
      void (async () => {
        while (s.battle === b && !b.result) await new Promise((r) => setTimeout(r, 300));
        await new Promise((r) => setTimeout(r, 5000));
        if (s.battle === b && follow.battle !== undefined) s.battles.close();
      })();
  };
  /** Watching an ally's battle, a press of ours (Retreat, Auto...) stops watching it: back to the map, looking around freely. */
  stopWatching = () => {
    this.s.follow.following = false;
    this.s.battles.close();
    this.s.showInfo();
  };
}
