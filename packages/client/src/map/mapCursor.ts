// Which of the original's adventure cursors (CRADVNTR) the pointer shows over a tile: what a click
// there would do with the selected hero (walk, attack, visit, trade armies, sail, land...) and how
// many days away it is. No DOM: page.ts draws the result with cursors.ts.
import { type AdvObject, type AdventureState, type Hero, type PathNode, type World, allied, mapPathTo, turnsAway, visitTile } from "@heroes/core";
import { AdvCursor } from "../advCursor.ts";

/** What the player sees on the tile (nothing: unexplored). */
export type TileThings = { hero?: Hero; object?: AdvObject } | null;

export interface CursorQuery {
  w: World;
  s: AdventureState;
  /** The player at the screen. */
  me: number;
  /** The selected hero, if any. */
  hero: Hero | undefined;
  at: TileThings;
  x: number;
  y: number;
  z: number;
  /** Our turn (else only the hero and town cursors). */
  myTurn: boolean;
  /** A spell waiting for its target (Scuttle Boat is spell 1, the rest teleport). */
  aimingSpell?: number;
  /** The selected hero's routes over explored ground (asked only when needed). */
  paths: () => Map<number, PathNode>;
}

export function mapCursor(q: CursorQuery): { kind: number; days: number } {
  const { w, me, hero: h, at } = q;
  const plain = (kind: number) => ({ kind, days: 1 });
  if (!at) return plain(AdvCursor.Pointer);
  if (q.aimingSpell !== undefined) return plain(q.aimingSpell === 1 ? AdvCursor.Scuttle : AdvCursor.Teleport);
  if (at.hero?.owner === me && (!h || at.hero.id === h.id)) return plain(AdvCursor.Hero);
  const ownTown = !!at.object?.town && at.object.owner === me;
  if (ownTown && (!h || h.removed)) return plain(AdvCursor.Town);
  if (!h || h.removed || !q.myTurn) return plain(AdvCursor.Pointer);
  // Our town: its gate, where the walk ends.
  const target = ownTown ? visitTile(w, at.object!) : w.index(q.x, q.y, q.z);
  const node = q.paths().get(target);
  // Out of reach: your town or another of your heroes is selected by a click instead (VCMI's onTileHovered).
  if (!node || node.passOnly) return plain(ownTown ? AdvCursor.Town : at.hero?.owner === me ? AdvCursor.Hero : AdvCursor.Pointer);
  const days = turnsAway(w, q.s, h, mapPathTo(q.paths(), target));
  const water = w.map.tiles[target]?.terrain === 8;
  const o = at.object;
  let kind: number = AdvCursor.Move;
  // An ally's hero, town or garrison is no fight (the rules stop the hero beside the hero, and visit the rest for nothing).
  const foe = (owner: number) => owner >= 0 && owner !== me && !allied(q.s, owner, me);
  if (at.hero) kind = at.hero.owner === me ? AdvCursor.Exchange : foe(at.hero.owner) ? AdvCursor.Attack : AdvCursor.Move;
  // A monster, or an enemy's town, garrison or HotA's guarded border (types 33, 219) to fight for.
  else if (o && (o.type === 54 || ((o.town || o.type === 33 || o.type === 219) && foe(o.owner)))) kind = AdvCursor.Attack;
  else if (w.guardedBy[target]) kind = AdvCursor.Attack;
  // On the water (a boat to board, or from a boat a shipwreck, flotsam, a buoy, a whirlpool...): the
  // sailing visit's cursor, as VCMI's on the sail layer, not the horse (2026-10-31 19:58).
  else if (o && (o.type === 8 || water)) kind = AdvCursor.SailVisit;
  else if (o) kind = AdvCursor.Visit;
  else if (h.boat !== undefined) kind = water ? AdvCursor.Sail : AdvCursor.Disembark;
  return { kind, days };
}
