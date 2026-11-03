import { type AdventureEvent, type AdventureState, type Hero, type World, allied, isRevealed } from "@heroes/core";

/** What a hero looks like on the map (enough to draw it walking; nothing of its army or skills). */
export type HeroLook = Pick<Hero, "id" | "type" | "name" | "owner" | "heroClass" | "dir"> & { boat?: number; portrait?: string };

/**
 * Something a player away from a game played by notification can watch again on the map when
 * back: another player's hero walking (only the stretches they could see), a flag changing on a
 * town or mine they could see, a battle fought where they could see it.
 */
export type ReplayStep =
  | { k: "move"; day: number; hero: HeroLook; path: number[] }
  | { k: "flag"; day: number; object: number; owner: number; /** Its owner before (-1 nobody). */ from: number }
  | { k: "battle"; day: number; hero: number; owner: number; tile: number; won: boolean; /** The hero fought, when it was one. */ defender?: number };

/** Steps kept per player away (the oldest go first). */
export const REPLAY_KEPT = 1500;

const look = (h: Hero): HeroLook => ({ id: h.id, type: h.type, name: h.name.trim(), owner: h.owner, heroClass: h.heroClass, dir: h.dir, ...(h.boat !== undefined ? { boat: h.boat } : {}), ...(h.portrait ? { portrait: h.portrait } : {}) });

/** Who owns each flagged object now (towns, mines, dwellings...; the rest nobody's), to tell what a flag event took it from. */
export function flagOwners(s: AdventureState): Map<number, number> {
  return new Map(s.objects.filter((o) => o && !o.removed && o.owner >= 0).map((o) => [o.id, o.owner]));
}

/**
 * What `seat` could have watched of one update (the whole game's state after it, and its events),
 * fog applied: a rival's walk is cut to the stretches over land `seat` had explored, a flag or a battle only
 * where it had. Its own heroes' doings it knows. `before`: the flags as they were (flagOwners;
 * none: flags aren't told).
 */
export function replaySteps(s: AdventureState, w: World, seat: number, events: AdventureEvent[], before?: Map<number, number>): ReplayStep[] {
  const out: ReplayStep[] = [];
  const day = s.day;
  const seen = (i: number) => i >= 0 && isRevealed(s, seat, i);
  for (const e of events) {
    if (e.e === "move") {
      const h = s.heroes[e.hero];
      if (!h || h.owner === seat || e.path.length < 2) continue;
      // An ally's walk is seen whole (its heroes are always in sight, as in the game).
      if (allied(s, h.owner, seat)) {
        out.push({ k: "move", day, hero: look(h), path: e.path });
        continue;
      }
      // Each stretch in sight on its own (the hero shows where it comes out of the dark).
      let run: number[] = [];
      const flush = () => {
        if (run.length >= 2) out.push({ k: "move", day, hero: look(h), path: run });
        run = [];
      };
      for (const t of e.path) {
        if (seen(t)) run.push(t);
        else flush();
      }
      flush();
    } else if (e.e === "battleResult") {
      const h = s.heroes[e.hero];
      if (!h || h.owner === seat) continue;
      // Where it was fought: the place attacked, else the hero (or the hero it fought).
      const o = e.object >= 0 ? s.objects[e.object] : undefined;
      const d = e.defender !== undefined ? s.heroes[e.defender] : undefined;
      const at = o ?? d ?? h;
      const tile = w.index(at.x, at.y, at.z);
      if (!seen(tile)) continue;
      out.push({ k: "battle", day, hero: h.id, owner: h.owner, tile, won: e.won, ...(e.defender !== undefined ? { defender: e.defender } : {}) });
    }
  }
  // Flags that changed (by a hero's visit, a battle won, a town given up), told after what did it.
  if (before)
    for (const o of s.objects) {
      const owner = !o || o.removed || o.owner < 0 ? -1 : o.owner;
      const from = before.get(o?.id ?? -1) ?? -1;
      if (o && owner !== from && owner >= 0 && seen(w.index(o.x, o.y, o.z))) out.push({ k: "flag", day, object: o.id, owner, from });
    }
  return out;
}
