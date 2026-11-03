// What one player may know of the game: the same view for a person's screen (the server sends it
// to each human in a game with rivals) and for the computer (its turn is played on it, see
// aiView.ts), so the computer knows no more than a player in its seat would.
import { disguisedArmy } from "./advSpells.ts";
import { allied, type AdventureEvent } from "./rules.ts";
import { thievesGuild } from "./thieves.ts";
import { mapGarrisonArmy } from "./objects.ts";
import { type AdvObject, type AdventureState, type Hero, Obj } from "./types.ts";
import { type World, isRevealed, maskTiles } from "./world.ts";

/** A rival hero out of sight: only who it is, nowhere on the map. */
function unseenHero(h: Hero): Hero {
  return { id: h.id, type: h.type, name: h.name, owner: h.owner, heroClass: h.heroClass, x: 0, y: 0, z: 0, movement: 0, maxMovement: 0, army: Array(7).fill(null), primary: [0, 0, 0, 0], experience: 0, level: 1, dir: h.dir, removed: true, unseen: true };
}

/** What only a hero's owner knows (the AI's notes on it among them). */
const OWN_HERO_KEYS = ["backpack", "scrolls", "levelUps", "levelUpPrimary", "offer", "aiCrossed", "aiVisited", "aiCast", "aiExploring", "aiReason", "aiTarget", "heading"] as const;
/** What only a player knows of themselves. */
const OWN_PLAYER_KEYS = ["tavern", "obelisks", "keys", "views", "aiStuck", "aiDiary", "aiGuards", "aiMain", "startBonus"] as const;

export interface ViewOptions {
  /** The Thieves' Guild ranking made from the whole game (a screen shows it; the computer reads its own guilds' instead). */
  ranks?: boolean;
  /** Map objects on ground nobody on the viewer's side explored left out (the computer's view). A player's screen
   * still gets them all, as before: whether it copes with one coming back as the shroud lifts is untried (ROADMAP). */
  shroud?: boolean;
  /** Rivals' armies, rival towns' garrisons and the map's monsters as a player sees them: "a pack" (10-19), not 14
   * (the computer's view; a screen shows the band from the counts itself). */
  bands?: boolean;
}

/**
 * The count a player would guess from what the game shows of a stack it doesn't own: the middle of its band (Few 1-4,
 * Several 5-9, Pack 10-19, Lots 20-49, Horde 50-99, Throng 100-249, Swarm 250-499, Zounds 500-999, Legion 1000+).
 */
export function bandCount(n: number): number {
  if (n <= 0) return 0;
  const bands = [4, 9, 19, 49, 99, 249, 499, 999];
  let lo = 1;
  for (const hi of bands) {
    if (n <= hi) return Math.round((lo + hi) / 2);
    lo = hi + 1;
  }
  return 1500;
}
/**
 * The most a stack shown by its band can be, from the count a view gives it (the band's middle, bandCount): what a
 * careful player fights against ("a pack" may be 19). Any other count is taken as exact.
 */
export function bandTop(n: number): number {
  const bands = [4, 9, 19, 49, 99, 249, 499, 999];
  let lo = 1;
  for (const hi of bands) {
    if (n === Math.round((lo + hi) / 2)) return hi;
    lo = hi + 1;
  }
  return n;
}
/** The least a stack with this band's top can be (1-4, 5-9, 10-19, ...). */
export function bandLow(top: number): number {
  const bands = [4, 9, 19, 49, 99, 249, 499, 999];
  const i = bands.indexOf(top);
  return i <= 0 ? 1 : bands[i - 1] + 1;
}
const banded = <T extends { count: number } | null>(slots: T[]): T[] => slots.map((x) => (x ? { ...x, count: bandCount(x.count) } : x));

/**
 * One player's view of the adventure: what they (and their allies) may know. Rivals' heroes out
 * of sight are left out (where, what army, and their walks there), and of the ones in sight what
 * only their owner knows (backpack, spells, offers, plans); so are what lies under the shroud
 * (the map's objects on tiles never explored, gone from the view until seen), rivals' resources,
 * taverns, explored maps, keys and obelisks, their towns' creatures for hire and guild spells,
 * their battles, the random seed and the game's log. `viewer` marks whose view it is (their
 * routes then keep to explored ground).
 */
export function viewFor(s: AdventureState, w: World, seat: number, events: AdventureEvent[], opts: ViewOptions = {}): { state: AdventureState; events: AdventureEvent[] } {
  const state = structuredClone(s);
  state.viewer = seat;
  const friend = (p: number) => p === seat || allied(s, p, seat);
  // (Allies share what they see, as they share their heroes.)
  const friends = s.players.filter((p) => friend(p.color)).map((p) => p.color);
  const seen = (i: number) => i >= 0 && friends.some((p) => isRevealed(s, p, i));
  const hidden = new Set<number>();
  if (opts.ranks !== false) state.ranks = thievesGuild(s, w, 20);
  state.rng = 0;
  state.log = [];
  state.heroes = state.heroes.map((h) => {
    if (h.removed || friend(h.owner)) return h;
    if (h.garrison !== undefined ? !seen(objectTile(w, s, h.garrison)) : !seen(w.index(h.x, h.y, h.z))) {
      hidden.add(h.id);
      return unseenHero(h);
    }
    // Disguise: a rival's copy holds only the army the spell shows, never the real one.
    const disguised = disguisedArmy(s, w, s.heroes[h.id], seat);
    if (disguised) h.army = disguised;
    if (opts.bands) h.army = banded(h.army);
    for (const k of OWN_HERO_KEYS) delete h[k];
    if (h.spells) h.spells = [];
    return h;
  });
  for (const p of state.players) {
    if (friend(p.color)) continue;
    p.revealed = [];
    p.resources = p.resources.map(() => 0);
    for (const k of OWN_PLAYER_KEYS) delete p[k];
  }
  for (const o of state.objects) {
    if (o.removed || o.carriedBy !== undefined) continue;
    if (opts.shroud && !friend(o.owner) && !objectSeen(w, o, seen)) {
      o.removed = true;
      continue;
    }
    if (opts.bands && o.type === Obj.MONSTER && o.amount !== undefined) o.amount = bandCount(o.amount);
    // (A garrison's stacks show as bands too: "three stacks of Elementals, lots", the owner's Province break, 2026-11-03.)
    if (opts.bands && (o.type === Obj.GARRISON || o.type === Obj.GARRISON2) && !friend(o.owner)) o.army = banded(mapGarrisonArmy(w, s.objects[o.id]).map((x) => (x ? { ...x } : x)));
    if (!o.town || friend(o.owner)) continue;
    if (opts.bands) o.town.garrison = banded(o.town.garrison);
    o.town.available = o.town.available.map(() => 0);
    delete o.town.guild;
  }
  for (const [key, pb] of Object.entries(state.battles)) if (!friend(Number(key)) && !pb.battle.sides.some((x) => x.owner !== undefined && friend(x.owner))) delete state.battles[Number(key)];
  // A hidden hero's walk shows only when some of it crosses explored ground.
  const shown = events.filter((e) => !(e.e === "move" && hidden.has(e.hero) && !e.path.some(seen)));
  return { state, events: shown };
}

/** An object's tile (its anchor), for a hero in its garrison. */
function objectTile(w: World, s: AdventureState, id: number): number {
  const o = s.objects[id];
  return o ? w.index(o.x, o.y, o.z) : -1;
}

/** Is any tile the object covers (blocks or is entered from) explored? */
function objectSeen(w: World, o: AdvObject, seen: (i: number) => boolean): boolean {
  if (seen(w.index(o.x, o.y, o.z))) return true;
  const on = (dx: number, dy: number) => seen(w.index(o.x + dx, o.y + dy, o.z));
  return maskTiles(o.block, 0).some(({ dx, dy }) => on(dx, dy)) || maskTiles(o.visit, 1).some(({ dx, dy }) => on(dx, dy));
}
