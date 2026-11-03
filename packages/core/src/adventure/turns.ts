// Who moves when: the order of the computer players' turns and how their battles are settled.
// The game server and the headless simulations both play through these, so a simulation
// takes the same path as a game in the browser.
import type { H3Map } from "@heroes/formats";
import { runAi } from "../battle/runner.ts";
import { adventureAiTurn } from "./ai.ts";
import { finishBattle } from "./combat.ts";
import { type AdventureSetup, type GameData, createAdventure } from "./create.ts";
import { type AdventureEvent, battleFor, timedEvents, waitingFor } from "./rules.ts";
import type { AdventureState } from "./types.ts";
import type { World } from "./world.ts";

/** A new game as the server starts it: the map's first-day events already applied. */
export function beginAdventure(map: H3Map, data: GameData, setup: AdventureSetup): { state: AdventureState; world: World; events: AdventureEvent[] } {
  const { state, world } = createAdventure(map, data, setup);
  return { state, world, events: timedEvents(state, world) };
}

/** A battle with a human on either side: it waits for them. */
export function waitingOnHuman(s: AdventureState): boolean {
  return Object.values(s.battles).some((pb) => pb.battle.sides.some((x) => x.controller === "human"));
}

/**
 * The computer player to move next: the current one (sequential), or the first still to end the
 * day once every human has (simultaneous); -1 while a human is up or a battle waits for one.
 */
export function nextAiPlayer(s: AdventureState): number {
  if (s.winner !== undefined || waitingOnHuman(s)) return -1;
  if (s.turnMode === "sequential") return s.players[s.current].controller === "ai" ? s.current : -1;
  const waiting = waitingFor(s);
  if (waiting.some((p) => s.players[p].controller === "human")) return -1;
  return waiting.length ? waiting[0] : -1;
}

/**
 * One computer player's turn, its battles against monsters and other computer players fought out
 * by the battle AI. `publish` gets each step's events. Returns true when it stopped at a battle
 * that waits for a human (who defends). `ai` plays the turn (a variant, to compare two).
 */
export function playAiTurn(s: AdventureState, w: World, player: number, publish: (events: AdventureEvent[]) => void = () => {}, ai = adventureAiTurn): boolean {
  for (let guard = 0; guard < 16 && s.winner === undefined; guard++) {
    publish(ai(s, w, player));
    const found = battleFor(s, player);
    if (!found) return false;
    if (found.pb.battle.sides.some((x) => x.controller === "human")) return true;
    runAi(found.pb.battle);
    publish(finishBattle(s, w, found.key));
    if (s.winner !== undefined) return false;
  }
  return false;
}
