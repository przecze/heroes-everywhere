// The fresh AI's memory between turns (kept on the player as `aiFresh`, so it lives in the save and crosses the
// computer's view: aiView.ts copies a player's ai* fields back), its switches, and the diary it writes.
import type { AdventureState } from "../types.ts";
import { diary } from "../aiDiary.ts";
import { aiEnv } from "../aiValues.ts";

export { act } from "../ai.ts";

export interface Mind {
  /** The hero that carries the kingdom's army (its id). */
  main?: number;
  /** Each hero's target tile, kept across days (a hero keeps to its errand). */
  targets?: Record<number, number>;
  /** What the towns' plan asks for, by resource (the heroes value these more). */
  need?: number[];
  /** The gold kept back today for the plan's next building. */
  saving?: number;
  /** The gold the plan's next building still lacks (gold then worth more: a chest's, a pile's). */
  goldShort?: number;
  /** What the gathering heroes (all but the main one) reached today, at their targets' worth. */
  gain?: number;
  /** Gathering heroes yesterday (the gain's divisor). */
  gatherers?: number;
  /** A gathering hero's worth a day, smoothed over the days (the price a new hire is weighed by). */
  rate?: number;
  /** The day the towns had their morning (a turn resumes after each battle). */
  townsDay?: number;
}

export const mindOf = (s: AdventureState, player: number): Mind => (s.players[player].aiFresh ??= {});
export const env = aiEnv;
export const note = (s: AdventureState, player: number, line: string) => diary(s, player, line);
