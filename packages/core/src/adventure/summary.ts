// What "Your games" shows of a game so it is known at a glance: whose colour you play, your town's
// faction, your strongest hero and the latest happenings. Made from the game's state when it is saved
// (kept in the save's meta, so listing needs no state), on the fly for this browser's own saves, and by
// the multiplayer host for each player of a room.
import type { AdventureState } from "./types.ts";
import { FACTIONS } from "./create.ts";

export interface GameEvent {
  kind: "battle" | "town";
  text: string;
}

export interface GameSummary {
  /** The colour you play (0..7). */
  color: number;
  /** Your faction (index into FACTIONS), or -1 when you have no town. */
  faction: number;
  /** Your strongest hero: the highest level, then the most experience. */
  hero?: { type: number; portrait?: string; name: string; level: number };
  heroes: number;
  towns: number;
  /** The last few happenings worth a line, oldest first. */
  events: GameEvent[];
}

const TOWN = 98;
const BATTLE = /victorious|defeated|lays siege|surrenders|flee|wins the game|out of the game/;
const CLAIM = /claims|brings the Grail/;
/** How many lines of the log to look through, and how many events to keep. */
const LOOK = 60;
const KEEP = 4;

/** The player the saved game is "yours": the one on the move if human, else the first human. */
export function myColor(s: AdventureState): number {
  const humans = s.players.flatMap((p, i) => (p.controller === "human" ? [i] : []));
  return humans.includes(s.current) ? s.current : (humans[0] ?? 0);
}

export function summarize(s: AdventureState, as = myColor(s)): GameSummary {
  const color = as;
  const me = s.players[color];
  const towns = s.objects.filter((o) => o.type === TOWN && !o.removed && o.owner === color);
  const fi = me?.faction ? FACTIONS.indexOf(me.faction) : -1;
  const faction = towns.length ? towns[0].subid : fi;
  const mine = s.heroes.filter((h) => h.owner === color && !h.removed && !h.retired);
  const best = [...mine].sort((a, b) => b.level - a.level || b.experience - a.experience)[0];
  const events: GameEvent[] = [];
  for (const line of s.log.slice(-LOOK)) {
    const kind = BATTLE.test(line) ? "battle" : CLAIM.test(line) ? "town" : null;
    if (kind) events.push({ kind, text: line });
  }
  return {
    color,
    faction: faction >= 0 && faction < FACTIONS.length ? faction : -1,
    ...(best ? { hero: { type: best.type, ...(best.portrait ? { portrait: best.portrait } : {}), name: best.name, level: best.level } } : {}),
    heroes: mine.length,
    towns: towns.length,
    events: events.slice(-KEEP),
  };
}
