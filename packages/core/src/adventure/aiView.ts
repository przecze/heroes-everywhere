// The computer plays from a player's view (playerView.ts viewFor), the same one a person's screen
// gets in a game with rivals: no heroes out of sight, no treasure or towns under the shroud, no
// Disguise seen through, no rivals' resources, spellbooks or plans. Its moves still go to the real
// game through the rules (act -> applyAdventureAction), and after each one the view is made again
// from the real game (a fight, a pickup, new ground in sight change what it knows).
//
// "The computer sees only what it explored" (rule `aiFair`, on by default) turns this off for the
// original's computer, which knows the whole map and where every hero is.
import { ruleOn } from "./gameRules.ts";
import { type AdventureAction, type AdventureEvent, allied, applyAdventureAction } from "./rules.ts";
import { type AdventureState } from "./types.ts";
import { World, heroSight } from "./world.ts";
import { viewFor } from "./playerView.ts";

/** Does the computer read the whole game (the original's), not a player's view? */
export const aiSeesAll = (s: AdventureState): boolean => !ruleOn(s.rules, "aiFair");

interface Bridge {
  real: AdventureState;
  realWorld: World;
  view: AdventureState;
  viewWorld: World;
  player: number;
}
let bridge: Bridge | undefined;

/** The computer's turn on its view; `turn` is the AI itself (it gets the view and a world kept for it). */
export function onView(s: AdventureState, w: World, player: number, turn: (s: AdventureState, w: World, player: number) => AdventureEvent[]): AdventureEvent[] {
  const outer = bridge;
  const view = viewFor(s, w, player, [], { ranks: false, shroud: true, bands: BANDS }).state;
  remember(view, player);
  const viewWorld = worldFor(w);
  bridge = { real: s, realWorld: w, view, viewWorld, player };
  try {
    viewWorld.refresh(view);
    return turn(view, viewWorld, player);
  } finally {
    writeBack(bridge);
    bridge = outer;
    w.refresh(s);
  }
}

/** The action on the real game, when `s` is the view the computer is playing on; undefined otherwise. */
export function bridged(s: AdventureState, action: AdventureAction, player: number): AdventureEvent[] | undefined {
  const b = bridge;
  if (!b || s !== b.view) return undefined;
  const { real, view } = b;
  writeBack(b);
  // What the computer put aside for later (a quest's price) it sees as gone from its purse: the rules spend from what it sees.
  const purse = real.players[player].resources;
  const kept = purse.map((n, r) => n - view.players[player].resources[r]);
  kept.forEach((n, r) => (purse[r] -= n));
  try {
    b.realWorld.refresh(real);
    return applyAdventureAction(real, b.realWorld, action, player);
  } finally {
    kept.forEach((n, r) => (purse[r] += n));
    syncInto(view as unknown as Record<string, unknown>, viewFor(real, b.realWorld, b.player, [], { ranks: false, shroud: true, bands: BANDS }).state as unknown as Record<string, unknown>);
    remember(view, player);
    view.players[player].resources.forEach((_, r, a) => (a[r] -= kept[r]));
    b.viewWorld.refresh(view);
  }
}

/** How long a rival's hero gone out of sight is still reckoned with where it was last seen. */
/** AI_BANDS=0: exact counts of rivals' stacks and monsters, as before 2026-11-01. */
const BANDS = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AI_BANDS !== "0";
export const SEEN_DAYS = 3;

/**
 * A player remembers the rival heroes they saw: one gone into the shroud is still reckoned with where it was last seen,
 * for a few days (else a raider out of sight is a raider forgotten, and the towns are left bare in its way).
 */
function remember(view: AdventureState, player: number) {
  const me = view.players[player];
  const seen = (me.aiSeen ??= {});
  for (const h of view.heroes) {
    if (h.removed || h.owner < 0 || h.owner === player || allied(view, h.owner, player) || h.garrison !== undefined) continue;
    seen[h.id] = { x: h.x, y: h.y, z: h.z, day: view.day, army: structuredClone(h.army), primary: h.primary.slice(), maxMovement: h.maxMovement };
  }
  for (const [key, m] of Object.entries(seen)) {
    const h = view.heroes[Number(key)];
    // (Seen gone: beaten, or no longer out there. Too long ago: forgotten.)
    // (Where it stood is in a hero of ours' sight now, and it isn't there: gone. Kept on, the phantom drew a leader's
    // heroes to an empty tile underground, trying to attack it twelve times a day for months: Free for All, 8 fair
    // computers, day 600.)
    if (!h || (h.removed && !h.unseen) || view.day - m.day > SEEN_DAYS || (h.unseen && inSight(view, player, m))) {
      delete seen[Number(key)];
      continue;
    }
    if (!h.unseen) continue;
    Object.assign(h, { x: m.x, y: m.y, z: m.z, army: structuredClone(m.army), primary: m.primary.slice(), maxMovement: m.maxMovement, movement: m.maxMovement });
    delete h.removed;
  }
}

/** A tile one of the player's heroes sees from where it stands. */
function inSight(view: AdventureState, player: number, at: { x: number; y: number; z: number }): boolean {
  return view.heroes.some((h) => !h.removed && h.owner === player && h.garrison === undefined && h.z === at.z && Math.max(Math.abs(h.x - at.x), Math.abs(h.y - at.y)) <= heroSight(h));
}

/** The computer's own notes (ai* fields of its heroes and of itself) go back to the real game. */
function writeBack({ real, view, player }: Bridge) {
  const copy = (to: object, from: object) => {
    const t = to as Record<string, unknown>;
    const f = from as Record<string, unknown>;
    for (const k of Object.keys(t)) if (k.startsWith("ai") && !(k in f)) delete t[k];
    for (const k of Object.keys(f)) if (k.startsWith("ai")) t[k] = structuredClone(f[k]);
  };
  copy(real.players[player], view.players[player]);
  for (const h of view.heroes) if (h.owner === player && real.heroes[h.id]) copy(real.heroes[h.id], h);
}

/** A world of the same map for a copy of a state (the search engine's playouts), its tile layers made from the copy. */
export function cloneWorld(w: World, copy: AdventureState): World {
  const v = worldFor(w);
  v.refresh(copy);
  return v;
}

/** A world of the same map for the view: its own tile layers (who stands and what lies where, as the view has it). */
function worldFor(w: World): World {
  const v = Object.assign(Object.create(Object.getPrototypeOf(w)) as World, w);
  const fresh = v as unknown as Record<string, unknown>;
  for (const k of ["blockedBy", "visitBy", "heroAt", "teleportTo", "guardedBy"]) fresh[k] = new Int32Array(0);
  for (const k of ["heroMarks", "stamps", "blockers", "visitors", "guards", "lit"]) fresh[k] = [];
  fresh.footprints = new WeakMap();
  return v;
}

/** `dst` made equal to `src`, keeping `dst`'s own objects and arrays (the computer holds on to its heroes and towns across a move). */
function syncInto(dst: Record<string, unknown> | unknown[], src: Record<string, unknown> | unknown[]) {
  if (Array.isArray(dst) && Array.isArray(src)) {
    for (let i = 0; i < src.length; i++) dst[i] = merged(dst[i], src[i]);
    dst.length = src.length;
    return;
  }
  const d = dst as Record<string, unknown>;
  const f = src as Record<string, unknown>;
  for (const k of Object.keys(d)) if (!(k in f)) delete d[k];
  for (const k of Object.keys(f)) d[k] = merged(d[k], f[k]);
}

function merged(a: unknown, b: unknown): unknown {
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b) && !ArrayBuffer.isView(a) && !ArrayBuffer.isView(b) && !(a instanceof Map) && !(a instanceof Set)) {
    syncInto(a as Record<string, unknown>, b as Record<string, unknown>);
    return a;
  }
  return b;
}
