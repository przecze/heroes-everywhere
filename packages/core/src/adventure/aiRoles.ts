// Which engine plays a computer player, and the "fix" / "roles" engines' rules (docs/ai-architecture.md; the
// hero-roles thread, 2026-11-02). Measured with sim/shuttle.ts on the race maps: the classic AI's main hero walked
// into a town of its own on 0.65 of its days (troops worth a sixth of its army waiting there, or the guard it had
// left the day before), a day's march lost each time.
//   fix    the main hero picks troops up at home only when the town is on today's walk; a second hero (a feeder)
//          brings them out to it, however near; a guard left in a town stays there for GUARD_DAYS.
// The default since 2026-11-02 is "fix" (the owner picked it): head to head with base over 240 seats it holds the same
// strength (0.124 against 0.126 of all players') and towns (1.5 each on day 84) with 9% more experience by week 4,
// and plays as a person would. "base" stays as the classic AI (AI_ENGINE=base, or RACE_ENGINES=base,fix).
// "roles" (48 seats): 0.11 against 0.14, but +48% experience and the first level-10 hero by week 4; open.
//   roles  fix, and each hero has a role: one main hero kept while no other is
//          KEEP_MAIN times stronger, whose experience counts MAIN_XP times; feeders as in fix.
import { aiEnv } from "./aiValues.ts";
import { power } from "./aiThreat.ts";
import type { World } from "./world.ts";
import type { AdventureState, AdvObject, Hero } from "./types.ts";

export type Engine = "base" | "search" | "tuned" | "fix" | "roles" | "fresh";
export const engineOf = (s: AdventureState, player: number): Engine => s.players[player]?.aiEngine ?? (s.players[player]?.personality === "fresh" ? "fresh" : undefined) ?? ((aiEnv("AI_ENGINE") as Engine | undefined) ?? "fix");

/** Whether the player plays with the shuttle fixes (the fix and roles engines). */
export const fixes = (s: AdventureState, player: number): boolean => {
  const e = engineOf(s, player);
  return e === "fix" || e === "roles";
};

/** Days a guard left in a town stays there (no one comes back for it meanwhile). */
export const GUARD_DAYS = Number(aiEnv("AI_GUARDDAYS") ?? 3);

/** A guard was left in the town in the last GUARD_DAYS days (fix engines only). */
export function guarded(s: AdventureState, player: number, town: number): boolean {
  if (!fixes(s, player)) return false;
  const d = s.players[player]?.aiGuards?.[town];
  return d !== undefined && s.day - d < GUARD_DAYS;
}

export function markGuard(s: AdventureState, player: number, town: number) {
  if (fixes(s, player)) (s.players[player].aiGuards ??= {})[town] = s.day;
}

/** The town lies within the hero's walk today (as the crow flies: a tile a step, 100 movement points). */
export function onTodaysWalk(h: Hero, town: AdvObject): boolean {
  return town.z === h.z && 100 * Math.max(Math.abs(town.x - h.x), Math.abs(town.y - h.y)) <= Math.max(h.movement, 0);
}

/** Another hero of the side out on the map, to bring the troops waiting in a town out to `h`. */
export function feederFor(s: AdventureState, h: Hero): Hero | undefined {
  return s.heroes.find((x) => !x.removed && x.owner === h.owner && x.id !== h.id && x.garrison === undefined);
}

/** Roles engine: the main hero's experience against the classic worth (a monster's xp part). */
export const MAIN_XP = Number(aiEnv("AI_MAINXP") ?? 1.5);
/** Roles engine: another hero becomes the main only when this much stronger (the army doesn't wander to a new hero). */
const KEEP_MAIN = Number(aiEnv("AI_KEEPMAIN") ?? 1.5);

/** Roles engine: yesterday's main hero stays the main while the strongest isn't KEEP_MAIN times stronger. */
export function keptMain(s: AdventureState, w: World, player: number, best: Hero | undefined): Hero | undefined {
  const p = s.players[player];
  const prev = p.aiMain !== undefined ? s.heroes[p.aiMain] : undefined;
  const main = prev && !prev.removed && prev.owner === player && best && power(w, best) < KEEP_MAIN * power(w, prev) ? prev : best;
  p.aiMain = main?.id;
  return main;
}
