// The caretaker: a friend's turn played for them while they're away (a game played by notification
// past its soft turn deadline, or a friend on vacation). Cautious, as a friend would want it: it
// picks up what lies free within the day's walk, keeps heroes out of a stronger enemy's reach (home
// behind the walls if it can), recruits what the towns offer and ends the turn. It never fights,
// builds or spends on anything else, so the friend comes back to their own plans.
import { aiSeesAll, onView } from "./aiView.ts";
import { act } from "./ai.ts";
import { inReach, power } from "./aiThreat.ts";
import { recruitAll } from "./aiTowns.ts";
import { findPaths } from "./movement.ts";
import { type AdventureEvent, allied, battleFor, canAct, mapHeroesOf } from "./rules.ts";
import { upperArmy, visitingHero } from "./town.ts";
import { type AdventureState, type AdvObject, type ArmySlot, type Hero, Obj } from "./types.ts";
import { type World, visitTile } from "./world.ts";

/** What the caretaker did, for the friend's recap and notification. */
export interface CaretakerLog {
  /** Things picked up or flagged: the object type and subtype (resource, mine), the amount (a pile). */
  picked: { type: number; subid: number; amount?: number }[];
  /** Creatures recruited, by creature. */
  recruited: { creature: number; count: number }[];
  /** Towns a hero stayed in to guard (object ids). */
  held: number[];
}

export const emptyCaretakerLog = (): CaretakerLog => ({ picked: [], recruited: [], held: [] });

/** Free for the taking, no fight and no choice that is the friend's to make: piles, chests, campfires, unguarded mines. */
function pickup(s: AdventureState, w: World, player: number, o: AdvObject): number {
  if (o.removed) return 0;
  switch (o.type) {
    case Obj.RESOURCE:
      return 300 + (o.amount ?? 1) * (o.subid === 6 ? 1 : 300);
    case Obj.TREASURE_CHEST:
      return 1500;
    case Obj.CAMPFIRE:
      return 1500;
    case Obj.MINE:
      // (An abandoned mine has guards; a rival's may have troops left in it; an ally's is theirs.)
      if (o.subid >= 7 || o.owner === player || (o.owner >= 0 && allied(s, o.owner, player)) || (o.army ?? []).some((x) => x)) return 0;
      return 4000;
  }
  return 0;
}

const where = (w: World, i: number): [number, number, number] => [i % w.size, Math.floor(i / w.size) % w.size, Math.floor(i / (w.size * w.size))];

const counts = (armies: (ArmySlot | null)[][]) => {
  const out = new Map<number, number>();
  for (const a of armies) for (const x of a) if (x) out.set(x.creature, (out.get(x.creature) ?? 0) + x.count);
  return out;
};

/** One caretaker turn for `player` (played as a computer player would be: offers answered by the rules). */
export function caretakerTurn(s: AdventureState, w: World, player: number, log: CaretakerLog = emptyCaretakerLog()): AdventureEvent[] {
  // (On what the absent player could see themselves: aiView.ts.)
  if (s.viewer === undefined && !aiSeesAll(s)) return onView(s, w, player, (v, vw, p) => caretakerTurn(v, vw, p, log));
  const events: AdventureEvent[] = [];
  const stop = () => s.winner !== undefined || !!battleFor(s, player) || !canAct(s, player);
  w.refresh(s);
  const enemies = () => s.heroes.filter((e) => !e.removed && e.owner !== player && !allied(s, e.owner, player) && e.garrison === undefined);
  /** A rival hero stronger than ours could reach this tile tomorrow. */
  const danger = (h: Hero, i: number) => {
    const [x, y, z] = where(w, i);
    const mine = power(w, h);
    return enemies().some((e) => power(w, e) > mine && inReach(s, w, e, x, y, z));
  };
  const ownTownAt = (i: number) => {
    const o = w.visitBy[i] ? s.objects[w.visitBy[i] - 1] : undefined;
    return o?.town && o.owner === player ? o : undefined;
  };
  for (const h of mapHeroesOf(s, player)) {
    if (stop()) return events;
    // Home with a rival a day off: it stays to guard the town (with the garrison and the walls).
    const home = ownTownAt(w.index(h.x, h.y, h.z));
    if (home && enemies().some((e) => inReach(s, w, e, home.x, home.y, home.z))) {
      log.held.push(home.id);
      continue;
    }
    for (let guard = 0; guard < 12 && h.movement > 0 && !h.removed; guard++) {
      if (stop()) return events;
      w.refresh(s);
      let best = -1;
      let bestScore = 0;
      for (const [i, node] of findPaths(w, s, h)) {
        // (Today's walk only, never into a monster's zone, past a hero or onto a tile a stronger rival reaches.)
        if (node.cost === 0 || node.cost > h.movement || node.passOnly || w.guardedBy[i] || w.heroAt[i]) continue;
        const o = w.visitable(s, i);
        const v = o ? pickup(s, w, player, o) : 0;
        if (v <= 0 || danger(h, i)) continue;
        const score = v / (node.cost + 300);
        if (score > bestScore) [best, bestScore] = [i, score];
      }
      if (best < 0) break;
      const o = w.visitable(s, best)!;
      const got = act(s, w, player, { type: "move", hero: h.id, to: best });
      if (!got) break;
      events.push(...got);
      if (o.removed || o.owner === player) log.picked.push({ type: o.type, subid: o.subid, ...(o.type === Obj.RESOURCE ? { amount: o.amount ?? 1 } : {}) });
    }
    if (stop()) return events;
    // Out in the open where a stronger rival reaches: home behind the walls if a town is in today's walk.
    const here = w.index(h.x, h.y, h.z);
    if (!h.removed && h.movement > 0 && !ownTownAt(here) && danger(h, here)) {
      w.refresh(s);
      const paths = findPaths(w, s, h);
      const town = s.objects
        .filter((t) => t.town && !t.removed && t.owner === player)
        .map((t) => ({ t, gate: visitTile(w, t) }))
        .filter(({ gate }) => gate >= 0 && !w.heroAt[gate] && (paths.get(gate)?.cost ?? Infinity) <= h.movement)
        .sort((a, b) => paths.get(a.gate)!.cost - paths.get(b.gate)!.cost)[0];
      if (town) {
        const got = act(s, w, player, { type: "move", hero: h.id, to: town.gate });
        if (got) (events.push(...got), log.held.push(town.t.id));
      }
    }
  }
  if (stop()) return events;
  // The towns' creatures, bought with what's there (into the garrison, or the hero visiting).
  for (const o of s.objects) {
    if (!o.town || o.removed || o.owner !== player) continue;
    const armies = () => [upperArmy(s, o), visitingHero(s, w, o)?.army ?? []];
    const before = counts(armies());
    recruitAll(s, w, player, o);
    for (const [creature, n] of counts(armies())) {
      const got = n - (before.get(creature) ?? 0);
      if (got <= 0) continue;
      const known = log.recruited.find((r) => r.creature === creature);
      if (known) known.count += got;
      else log.recruited.push({ creature, count: got });
    }
  }
  events.push(...(act(s, w, player, { type: "endTurn" }) ?? []));
  return events;
}
