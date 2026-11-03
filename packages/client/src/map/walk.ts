// Heroes walking on the adventure map: the planned route (its arrows, today's part green), the walk
// asked of the rules a step at a time (so a click or key stops it after the step under way), and each
// walk drawn tile by tile with its hoof beats, the land uncovered as it goes.
import { type AdventureEvent, type AdventureState, type Hero, findPaths, fightStep, garrisonPass, type World, heroSight, isRevealed, mapPathTo, reveal, stepDays, stepsToday, turnsAway } from "@heroes/core";
import { extra } from "../settings.ts";
import { tr, said, fmt } from "../i18n/index.ts";
import { fast } from "../speed.ts";
import { msPerTile } from "../settings.ts";
import { playMusic, playSoundLooped } from "../audio.ts";
import { HORSE_SOUNDS } from "./sounds.ts";
import { mapCursor } from "./mapCursor.ts";
import { AdvCursor } from "../advCursor.ts";
import { type MapSession, TERRAIN_MUSIC } from "./session.ts";

/** The player's own garrisons a route may run through (EXTRAS throughGarrisons; the move sends the same switch). */
export const ownGarrisons = (w: World, s: AdventureState, h: Hero) => (extra("throughGarrisons") ? (i: number) => garrisonPass(w, s, h, i) : undefined);

type Route = { target: number; path: number[]; today: number; object: number };

export class MapWalk {
  /**
   * Each hero's planned route, as in the original: a hero keeps its own route while another is
   * selected, and it comes back with the hero (redrawn from where it stands now). Keyed by hero, so a
   * route can never be walked by the wrong one (2026-10-31: Space after the selection moved on sent
   * the next hero to the last one's target, "no path").
   */
  private readonly routes = new Map<number, Route>();
  /** The selected hero's planned route; `object`: what stands on its last tile (-1 none). */
  get planned(): Route | null {
    return this.routes.get(this.s.selected) ?? null;
  }
  set planned(r: Route | null) {
    if (r) this.routes.set(this.s.selected, r);
    else this.routes.delete(this.s.selected);
  }
  /** A new game: nobody has a route. */
  forgetRoutes() {
    this.routes.clear();
  }
  /** The selected hero (just selected) shows its own route again, planned anew from where it stands; none: no arrows. */
  showRoute(h: Hero | undefined) {
    const r = h && this.routes.get(h.id);
    if (!h || !r || this.routeTaken() || !this.planTo(h, r.target)) {
      if (h) this.routes.delete(h.id);
      this.s.view.showPath([], 0);
    }
  }
  /**
   * The route being walked. As in the original (VCMI's HeroMovementController), a click or a key
   * while the hero walks stops it after the step under way, so the route goes to the rules a step at
   * a time: each next step is asked for as the one before is drawn.
   */
  walking: { hero: number; to: number; stop: boolean; clear?: boolean } | null = null;
  /** The walk's next step, asked for halfway through drawing this one (so a click stops it after the step under way). */
  private nextStep = false;
  /** The hoof beats' loop now playing (animate). */
  private hoofLoop: { name: string; stop: () => void; timer: number } | null = null;

  private readonly s: MapSession;
  constructor(s: MapSession) {
    this.s = s;
  }

  /**
   * The route was to an object that's gone (a pile or chest picked up from the tile next to it, a
   * monster beaten): it's done, as in the original, and leaves no cross on the empty tile.
   */
  routeTaken() {
    return !!this.planned && this.planned.object >= 0 && !!this.s.state?.objects[this.planned.object]?.removed;
  }
  dropRoute() {
    this.planned = null;
    this.s.view.showPath([], 0);
  }

  /** Walks the planned route (the HUD's Move, Space): its arrows go as it's walked. */
  walkPlanned() {
    const planned = this.planned!;
    if (planned.path.length <= 2) this.s.view.showPath([], 0);
    this.route(this.s.selected, planned.target);
  }

  route(hero: number, to: number) {
    // (Whether the route crossed no guard as it was planned: a guard that comes into sight on the way stops it.)
    const { world } = this.s;
    const clear = !!world && this.planned?.target === to && this.seenFight(this.planned.path) < 0;
    this.walking = { hero, to, stop: false, clear };
    this.s.sendAct({ type: "move", hero, to, steps: 1, cyclicPortals: extra("cyclicPortals"), throughGarrisons: extra("throughGarrisons") });
  }
  /** A click or a key while the hero walks: it stops after the step under way. */
  stop() {
    if (this.walking) this.walking.stop = true;
  }

  /** An update came: the walk goes on unless stopped, arrived, or something happened on the way (a visit, a fight, a message). */
  walkOn(events: AdventureEvent[], next: AdventureState) {
    const walk = this.walking;
    if (!walk) return;
    const step = events.length === 1 && events[0].e === "move" && events[0].hero === walk.hero ? events[0] : undefined;
    const h = next.heroes[walk.hero];
    const at = h && this.s.world ? this.s.world.index(h.x, h.y, h.z) : -1;
    if (!step || walk.stop || !h || h.removed || at === walk.to || step.path[step.path.length - 1] !== at) return void (this.walking = null);
    this.nextStep = true;
  }
  stepOn() {
    if (!this.nextStep) return;
    this.nextStep = false;
    const walk = this.walking;
    if (!walk) return;
    if (walk.stop) return void (this.walking = null);
    if (walk.clear && this.guardCameIntoSight(walk)) return;
    this.s.sendAct({ type: "move", hero: walk.hero, to: walk.to, steps: 1, cyclicPortals: extra("cyclicPortals"), throughGarrisons: extra("throughGarrisons") });
  }

  /**
   * A route planned with no fight on it, and a step uncovers a monster whose zone it crosses: the hero stops before it,
   * the route shown again with the fight on it, to be walked on with a tap (the owner's bumped note 2026-10-30 17:12: "a hidden
   * neutral right next to the object, and suddenly I was in a fight"; EXTRAS stopAtNewGuard, off: the original walks on).
   */
  /** The route's first step into the zone of a monster the player sees (the screen's state has the ones in the fog too). */
  private seenFight(path: readonly number[]): number {
    const { state, world } = this.s;
    if (!state || !world) return -1;
    const me = this.s.me();
    for (let k = 1; k < path.length; k++) {
      const g = world.guardedBy[path[k]];
      const o = g ? state.objects[g - 1] : undefined;
      if (o && (this.s.fogLifted || isRevealed(state, me, world.index(o.x, o.y, o.z)))) return k;
    }
    return -1;
  }

  private guardCameIntoSight(walk: { hero: number; to: number }): boolean {
    const { state, world } = this.s;
    const h = state?.heroes[walk.hero];
    if (!extra("stopAtNewGuard") || !state || !world || !h) return false;
    world.refresh(state);
    const path = mapPathTo(findPaths(world, state, h, true, ownGarrisons(world, state, h)), walk.to);
    if (path.length < 2 || this.seenFight(path) < 0) return false;
    this.walking = null;
    if (this.planTo(h, walk.to)) this.s.notice(tr("A monster came into sight on the way: the hero stopped."));
    return true;
  }

  /** Plans and shows the route; green arrows for what today's movement reaches. */
  planTo(h: Hero, target: number): boolean {
    const { state, world, view } = this.s;
    if (!state || !world) return false;
    world.refresh(state);
    const paths = findPaths(world, state, h, true, ownGarrisons(world, state, h));
    const path = mapPathTo(paths, target);
    if (path.length < 2) {
      this.planned = null;
      view.showPath([], 0);
      return false;
    }
    // (Stepped as the server will: a last diagonal step can take less than its cost.)
    const today = stepsToday(world, state, h, path);
    this.planned = { target, path, today, object: (world.blockedBy[target] || world.visitBy[target]) - 1 };
    // HD-style: what the trip costs, at the end of the arrows and in the status bar.
    const cost = paths.get(path[path.length - 1])!.cost;
    const left = Math.max(0, h.movement - cost);
    // (Day by day as the arrows' colours: a day's leftover points don't carry over.)
    const days = turnsAway(world, state, h, path);
    const fight = extra("guardedRoute") ? fightStep(world, path) : -1;
    // A touch screen has no pointer to turn into swords: the route's end shows them when the walk ends in a battle
    // (2026-11-02 12:17; EXTRAS routeFightSword).
    let battle = false;
    if (extra("routeFightSword")) {
      const end = this.s.tilePos(target);
      const heroId = world.heroAt[target] - 1;
      const objectId = (world.blockedBy[target] || world.visitBy[target]) - 1;
      const at = { hero: heroId >= 0 ? state.heroes[heroId] : undefined, object: objectId >= 0 ? state.objects[objectId] : undefined };
      battle = fightStep(world, path) >= 0 || mapCursor({ w: world, s: state, me: this.s.me(), hero: h, at, x: end.x, y: end.y, z: end.z, myTurn: true, paths: () => paths }).kind === AdvCursor.Attack;
    }
    view.showPath(path.map((i) => this.s.tilePos(i)), today, !extra("routeCost") ? undefined : days === 1 ? said(String(left)) : fmt`${days}d`, fight, stepDays(world, state, h, path), battle);
    // (Ours, with the route's cost on: the original's status bar says nothing of it.)
    if (extra("routeCost")) this.s.status(days === 1 ? tr("Cost %1, %2 movement points left today.", cost, left) : tr("Cost %1: %2 days away.", cost, days));
    return true;
  }

  /**
   * Draws a hero walking a path, tile by tile.
   * `follow`: the view keeps the walker centred (an opponent seen moving, as the original's "Show enemy moves").
   * `replay`: a replay's own pace per tile, and its pause (waited on before each step).
   */
  /** `shown`: for an opponent, the tiles the player sees; a step between two unseen ones is made at once and the view stays
   *  put (2026-11-01: the view followed an enemy hero through the fog and gave away where it went). */
  async animate(heroId: number, path: number[], follow = false, replay?: { ms: () => number; hold: () => Promise<void> }, spent?: number, shown?: (tile: number) => boolean) {
    const s = this.s;
    const { view, app } = s;
    const hs = view.heroSprites.get(heroId);
    if (!hs) return;
    hs.walking = true;
    // Our own heroes uncover the land step by step, as in the original (the state that follows the
    // walk has it all; until then this is drawn on the state from before it).
    const walker = s.state?.heroes[heroId];
    const sees = walker && walker.owner === s.me() && s.world ? heroSight(walker) : 0;
    // The movement bars (hero list, hero chip) go down tile by tile as the hero walks, as the original's: the walk's
    // cost (`spent`, from the state after it) shared out over its steps on the state shown until then (the owner's
    // note 2026-11-01 14:59: the bar stood still until the walk ended).
    const startMovement = walker?.movement ?? 0;
    let stepsTaken = 0;
    const arrive = (x: number, y: number, z: number) => {
      if (spent && walker && walker.owner === s.me() && path.length > 1) {
        stepsTaken++;
        walker.movement = Math.max(0, Math.round(startMovement - (spent * stepsTaken) / (path.length - 1)));
        s.showInfo();
      }
      if (heroId === s.selected) {
        view.passPath(x, y);
        // The loops around the hero change as it goes (once the land there is uncovered, below).
        s.walkingAt = { x, y, z };
        s.scheduleAmbient();
      }
      if (!sees || !s.state || !s.world) return;
      reveal(s.state, s.world, s.me(), x, y, z, sees);
      view.redrawFog(s.state);
    };
    // Hoof beats: one sound looped while the hero walks, changed only when the ground's sound changes
    // (VCMI's HeroMovementController): the terrain's own on a road, its heavier one off it.
    // (Kept a moment past the walk's end: a route walked a step at a time goes on with the same loop.)
    const hoovesFor = (name: string) => {
      if (this.hoofLoop?.name === name) return void (clearTimeout(this.hoofLoop.timer), (this.hoofLoop.timer = 0));
      this.hoofLoop?.stop();
      this.hoofLoop = name ? { name, stop: playSoundLooped(name), timer: 0 } : null;
    };
    const stopHooves = () => {
      const loop = this.hoofLoop;
      if (loop && !loop.timer) loop.timer = window.setTimeout(() => (loop.stop(), this.hoofLoop === loop && (this.hoofLoop = null)), 150);
    };
    const heard = heroId === s.selected || s.state?.heroes[heroId]?.owner === s.me();
    try {
      for (let k = 1; k < path.length; k++) {
        await replay?.hold();
        if (hs.destroyed) break;
        const a = s.tilePos(path[k - 1]);
        const b = s.tilePos(path[k]);
        if (a.z !== view.currentLevel) break;
        const dx = Math.sign(b.x - a.x);
        const dy = Math.sign(b.y - a.y);
        hs.dir = [[7, 0, 1], [6, -1, 2], [5, 4, 3]][dy + 1][dx + 1];
        view.walkRow(heroId, Math.max(a.y, b.y));
        const tile = view.tile(b.x, b.y, b.z);
        // The terrain's music follows the selected hero step by step, fading across a border.
        if (tile && heroId === s.selected && !s.battle && !s.town.open) playMusic(TERRAIN_MUSIC[tile.terrain] ?? "GRASS.MP3");
        if (tile && heard) {
          const [plain, rough] = HORSE_SOUNDS[tile.terrain] ?? HORSE_SOUNDS[0];
          hoovesFor(tile.road && view.tile(a.x, a.y, a.z)?.road ? plain : rough);
        }
        // System Options: own and enemy walking speed (enemies can also be left unseen).
        const own = s.state?.heroes[heroId]?.owner === s.me();
        const ms = replay ? replay.ms() : msPerTile(own);
        if (shown && !shown(path[k - 1]) && !shown(path[k])) {
          hs.placeAt(b.x, b.y);
          arrive(b.x, b.y, b.z);
          continue;
        }
        if (fast || !ms) {
          hs.placeAt(b.x, b.y);
          // (The fastest hero speed too: the view still goes with the hero.)
          if (heroId === s.selected || follow) s.centerOn(b.x, b.y);
          arrive(b.x, b.y, b.z);
          continue;
        }
        // The arrow ahead goes as the hero sets off onto its tile, eaten as it comes: drawn above the
        // hero, it showed over the hero or boat until halfway (2026-10-31 19:56).
        if (heroId === s.selected) view.passPath(b.x, b.y);
        await new Promise<void>((done) => {
          let t = 0;
          let arrived = false;
          const step = (tk: { deltaMS: number }) => {
            // The hero's picture drawn anew meanwhile (the map rebuilt under the walk): this walk is over.
            if (hs.destroyed) return void (app.ticker.remove(step), done());
            t = Math.min(1, t + tk.deltaMS / ms);
            hs.placeAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
            if (heroId === s.selected || follow) s.centerOn(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
            // The land around comes into view halfway onto the tile.
            if (t >= 0.5 && !arrived) {
              arrived = true;
              arrive(b.x, b.y, b.z);
              if (k === path.length - 1 && heroId === this.walking?.hero) this.stepOn();
            }
            if (t >= 1) {
              app.ticker.remove(step);
              done();
            }
          };
          app.ticker.add(step);
        });
      }
    } finally {
      stopHooves();
    }
    hs.walking = false;
    // The route is redrawn once the state after the walk is in (redrawRoute): the state shown during the walk still
    // has the hero where it set off, with the bars' points already taken, so a route planned from it ran out of points
    // and its cross went red at the first step, though the hero got there (2026-11-02 11:06).
    if (heroId === s.selected) this.routeDue = true;
  }

  /** A walk of the selected hero was drawn: its route is redrawn when the state after it comes (MapInbox.drain). */
  private routeDue = false;
  /** The selected hero visited its route's object: the route is done. */
  private visitedTarget = false;
  /**
   * An update's events: did the selected hero visit the object its route led to (took it, read it, fought it, was asked
   * about it)? Then the route is done, as in the original, though the hero stands beside it, no step drawn (a pile taken
   * from the next tile), and though the thing stays (a Skeleton, a Buoy, a mine): no cross is left on it (2026-11-03).
   */
  noteVisits(events: readonly AdventureEvent[]) {
    const p = this.planned;
    if (!p || p.object < 0) return;
    const hero = this.s.selected;
    if (events.some((e) => "object" in e && e.object === p.object && "hero" in e && e.hero === hero)) {
      this.visitedTarget = true;
      this.routeDue = true;
    }
  }
  /**
   * The rest of a longer route stays, redrawn from where the hero stopped (tomorrow's part red); a finished one leaves
   * nothing (e.g. the cross on the object the hero visited). Run on the state after the walk.
   */
  redrawRoute() {
    if (!this.routeDue) return;
    this.routeDue = false;
    const s = this.s;
    const h = s.state?.heroes[s.selected];
    if (!h) return;
    const planned = this.planned;
    const visited = this.visitedTarget;
    this.visitedTarget = false;
    if (visited || this.routeTaken() || !(planned && s.world && s.world.index(h.x, h.y, h.z) !== planned.target && this.planTo(h, planned.target))) {
      this.dropRoute();
    }
  }
}
