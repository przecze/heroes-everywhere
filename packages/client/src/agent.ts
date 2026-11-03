// Release build: the agents' page handle (window.heroes) is not part of it.
import type { AdventureAction, AdventureState, BattleAction, BattleState, World } from "@heroes/core";
import type { Modals } from "./ui/modals.ts";
import type { Application } from "pixi.js";

export interface AgentHooks {
  app: Application;
  state: () => AdventureState | null;
  world: () => World | null;
  me: () => number;
  battle: () => BattleState | null;
  modals: () => Modals[];
  send: (a: AdventureAction) => void;
  fight: (a: BattleAction) => void;
  endTurn: () => void;
  /** True when no update is still being shown. */
  idle: () => boolean;
  /** In a battle: true when one of our units waits for orders. */
  battleReady: () => boolean;
  /** Text of windows outside the modal layers (the battle results). */
  extra: () => string[];
  /** `humans`: hot seat, that many of the map's human slots played at this screen. */
  newGame: (map?: string, humans?: number) => void;
  /** A map tile's middle on the page (client pixels), when it's in view: a probe taps there as a player. */
  tilePoint?: (tile: number) => { x: number; y: number } | null;
}

export function installAgentApi(_hooks: AgentHooks) {}
