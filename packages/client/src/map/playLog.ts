// The game's own steps in words for the feedback play log (feedback/recent.ts logPlay): what the
// player asked for ("move Gunnar to 15,7", "build 7 in Rion") and what came of it ("Gunnar visits
// Windmill at 20,14: 'You find 5 wood'", "battle at 12,9 with Pikemen: won"), so a note needn't say
// what just happened. Generic over the action and event kinds: ids become names, tiles x,y.
import { type AdventureAction, type AdventureEvent, RESOURCE_NAMES } from "@heroes/core";

export interface Namer {
  hero(id: number): string;
  object(id: number): string;
  /** A tile index as "x,y" (with the level when underground). */
  tile(i: number): string;
}

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The other fields of an action or event, with ids named. */
function rest(v: Record<string, unknown>, skip: string[], n: Namer): string {
  const out: string[] = [];
  for (const [k, x] of Object.entries(v)) {
    if (skip.includes(k) || x === undefined) continue;
    if (typeof x === "number" && (k === "hero" || k === "other")) out.push(n.hero(x));
    else if (typeof x === "number" && (k === "town" || k === "object")) out.push(x < 0 ? "here" : n.object(x));
    else if (typeof x === "number" && k === "to") out.push(`to ${n.tile(x)}`);
    else if (typeof x === "string") out.push(`${k} "${short(x, 60)}"`);
    else if (typeof x === "number" || typeof x === "boolean") out.push(`${k} ${x}`);
  }
  return out.join(" ");
}

/** One thing the player asked the game to do. */
export function actionText(a: AdventureAction, n: Namer): string {
  return `you: ${a.type} ${rest(a as unknown as Record<string, unknown>, ["type"], n)}`.trim();
}

/** What came of it (null: not worth a line, e.g. a flag changing hands far away). */
export function eventText(e: AdventureEvent, n: Namer): string | null {
  const v = e as unknown as Record<string, unknown>;
  switch (e.e) {
    case "move": {
      const p = e.path;
      return p.length ? `${n.hero(e.hero)} walks ${p.length} tiles to ${n.tile(p[p.length - 1])}` : null;
    }
    case "visit":
      return `${n.hero(e.hero)} visits ${e.object < 0 ? "the ground" : n.object(e.object)}${e.message ? `: "${short(e.message)}"` : ""}`;
    case "pickup":
      return `${n.hero(e.hero)} picks up ${e.amount} ${RESOURCE_NAMES[e.resource] ?? `resource ${e.resource}`}`;
    case "battleResult":
      return `battle ${e.won ? "won" : "lost"} by ${n.hero(e.hero)} at ${n.object(e.object)}`;
    case "day":
      return `day ${e.day}`;
    case "turn":
      return `turn of player ${e.player}`;
    case "message":
      return `message: "${short(e.text)}"`;
    case "flag":
      return null;
    default:
      return `${e.e} ${rest(v, ["e", "message"], n)}`.trim();
  }
}
