// What the adventure screen's windows need from the running game: its state, the player at the
// screen, a way to send actions, and a callback for every new state.
import type { AdventureAction, AdventureState, GameData, World } from "@heroes/core";
import type { Modals } from "../ui/modals.ts";

export interface AdvContext {
  modals: Modals;
  data: GameData;
  /** The current state and world (only called while a game is on). */
  state: () => AdventureState;
  world: () => World;
  /** The player at the screen (-1 while none). */
  me: () => number;
  send: (action: AdventureAction) => void;
  /** Calls `fn` after every new state; returns what stops it. */
  listen: (fn: () => void) => () => void;
  /** The original message box, queued after whatever is showing. */
  say: (text: string) => void;
  /** A hero's screen over the window showing (a portrait held, EXTRAS portraitHold). */
  openHero?: (id: number) => void;
}

/** The colour windows are drawn in (red while nobody is at the screen). */
export const colorOf = (ctx: AdvContext) => Math.max(0, ctx.me());
