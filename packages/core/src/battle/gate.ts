// The drawbridge's state after each action (VCMI's BattleProcessor::updateGateState), apart from siege.ts
// because it needs the stacks' hexes (reach.ts, which itself asks siege.ts about the gate).
import { unitHexes } from "./reach.ts";
import { BRIDGE_HEX, gatewayHexes } from "./siege.ts";
import type { BattleState, Unit } from "./state.ts";

/** Who lies on this hex: a living stack, head or tail, or a corpse (not eaten or sacrificed; summons and clones vanish). */
function liesOn(s: BattleState, hex: number): Unit[] {
  return s.units.filter((u) => u.pos >= 0 && (u.count > 0 || (!u.sacrificed && !u.summoned)) && unitHexes(s, u).includes(hex));
}

/**
 * The drawbridge after whatever just happened (VCMI's BattleProcessor::updateGateState and moveStack):
 * - a defender stepping into the gateway (head or tail; Fortress: onto its long bridge too) lowers it;
 * - while anyone, living or a corpse, lies in the gateway it stays down, and everyone may pass;
 * - once the gateway is empty it goes up, and while something lies on the hex in front of it (a stack,
 *   a corpse, a Force Field) it can't come down at all, not even for the defenders;
 * - a broken gate is open for good.
 */
export function updateGate(s: BattleState) {
  const siege = s.siege;
  if (!siege) return;
  if (!siege.walls.gate) {
    delete siege.bridge;
    return;
  }
  const gateway = gatewayHexes(s);
  if (siege.bridge === "down" && gateway.some((h) => liesOn(s, h).length)) return;
  if (gateway.some((h) => liesOn(s, h).some((u) => u.side === 1 && u.count > 0)) && siege.bridge !== "blocked") {
    siege.bridge = "down";
    return;
  }
  const blocked = liesOn(s, BRIDGE_HEX).length > 0 || (s.hazards ?? []).some((z) => z.kind === "forceField" && z.hexes.includes(BRIDGE_HEX));
  if (blocked) siege.bridge = "blocked";
  else delete siege.bridge;
}
