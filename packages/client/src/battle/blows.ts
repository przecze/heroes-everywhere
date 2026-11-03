// One blow, many stacks: the battle's events grouped so that everyone a single swing or shot hurts
// reacts at the same time, as in the original (breath, Hydras' and Cerberi's heads, Magogs' and
// Liches' area shots). The core emits the extra targets as `splash` attacks after the main one.
import type { BattleEvent } from "@heroes/core";

export type AttackEvent = Extract<BattleEvent, { e: "attack" }>;

/** An event to play, with the extra stacks its blow hits at the same moment (attacks only). */
export interface Step {
  ev: BattleEvent;
  splash: AttackEvent[];
}

/** A plain extra target of the same blow: not acid on top, not a Fire Shield's answer. */
const sameBlow = (main: AttackEvent, x: BattleEvent): x is AttackEvent =>
  x.e === "attack" && !!x.splash && !x.acid && !x.fireShield && !x.retaliation && x.unit === main.unit && x.target !== main.target && x.ranged === main.ranged;

/** What ends a blow: the next swing (a retaliation, a second strike) or the turn moving on. */
const endsBlow = (x: BattleEvent) => (x.e === "attack" && !x.splash) || x.e === "turn" || x.e === "move" || x.e === "round" || x.e === "end" || x.e === "morale" || x.e === "trigger";

/**
 * The events in order, each swing or shot carrying its extra targets; what happens in between
 * (deaths, life drain, acid, Fire Shield) stays where it was, after the blow.
 */
export function groupBlows(events: readonly BattleEvent[]): Step[] {
  const taken = new Set<number>();
  const out: Step[] = [];
  for (let i = 0; i < events.length; i++) {
    if (taken.has(i)) continue;
    const ev = events[i];
    const splash: AttackEvent[] = [];
    if (ev.e === "attack" && !ev.splash) {
      for (let j = i + 1; j < events.length && !endsBlow(events[j]); j++) {
        const x = events[j];
        if (sameBlow(ev, x)) {
          splash.push(x);
          taken.add(j);
        }
      }
    }
    out.push({ ev, splash });
  }
  return out;
}
