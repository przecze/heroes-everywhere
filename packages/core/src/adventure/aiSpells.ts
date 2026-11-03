import { SPELL } from "../spells.ts";
import { maxMana } from "./magic.ts";
import { cannotCastAdventure, heroMastery, portalTowns, waterNextTo } from "./advSpells.ts";
import { findPaths, isAirship } from "./movement.ts";
import { type AdventureEvent, allied, battleFor } from "./rules.ts";
import { B, townInfo } from "./town.ts";
import { type AdventureState, type AdvObject, type Hero, Obj } from "./types.ts";
import { type World, isRevealed, tileSpan, visitTile, Terrain } from "./world.ts";
import { mapHasWater } from "./aiWorth.ts";
import { weekIndex } from "../calendar.ts";
import { act, seaBoatAt, chooseTarget } from "./ai.ts";
import { WALLS, army, inReach, power } from "./aiThreat.ts";

/** Casts an adventure spell if the hero can; the events, or none. */
export function tryCast(s: AdventureState, w: World, player: number, h: Hero, spell: number, target?: number): AdventureEvent[] {
  const info = w.data.spells?.[spell];
  // (A walk to the spot can end in a fight: that comes first.)
  if (!info || battleFor(s, player) || cannotCastAdventure(s, w, h, info, target)) return [];
  return act(s, w, player, { type: "castSpell", hero: h.id, spell, ...(target !== undefined ? { target } : {}) }) ?? [];
}

/**
 * @wiki thing/view-earth thing/view-air thing/disguise thing/visions
 * Cheap magic for what it tells and hides: View Earth and View Air once a week (what lies on the map),
 * Visions with a monster stack close by (what we're about to fight), Disguise with an enemy hero two
 * days off. Spell points for a battle are kept: a fifth of the full store at least.
 */
export function castForKnowledge(s: AdventureState, w: World, player: number, h: Hero): AdventureEvent[] {
  const out: AdventureEvent[] = [];
  if (!h.spells?.length) return out;
  const week = weekIndex(s.day);
  const cast = (spell: number, key: number) => {
    const info = w.data.spells?.[spell];
    if (!info || !h.spells?.includes(spell) || (h.aiCast?.[spell] ?? -1) === key) return;
    if ((h.mana ?? 0) < info.cost[heroMastery(h, info)] + maxMana(h) / 5) return;
    const got = tryCast(s, w, player, h, spell);
    if (got.length) ((h.aiCast ??= {})[spell] = key), out.push(...got);
  };
  cast(SPELL.VIEW_EARTH, week);
  cast(SPELL.VIEW_AIR, week);
  const enemies = s.heroes.filter((e) => !e.removed && e.owner !== player && !allied(s, e.owner, player) && e.z === h.z);
  if (enemies.some((e) => tileSpan(e, h) <= (2 * e.maxMovement) / 100)) cast(SPELL.DISGUISE, s.day);
  if (s.objects.some((o) => !o.removed && o.type === Obj.MONSTER && o.z === h.z && tileSpan(o, h) <= 3)) cast(SPELL.VISIONS, s.day);
  return out;
}

/**
 * @wiki thing/scuttle-boat
 * Scuttle Boat on an empty boat an enemy hero stands within two tiles of while we are further off,
 * seen by us, and not the only boat our own hero could reach (it would still need one).
 */
export function scuttleBoat(s: AdventureState, w: World, player: number, h: Hero): AdventureEvent[] {
  const info = w.data.spells?.[SPELL.SCUTTLE_BOAT];
  if (!info || !h.spells?.includes(SPELL.SCUTTLE_BOAT) || h.boat !== undefined) return [];
  if ((h.mana ?? 0) < info.cost[heroMastery(h, info)] + maxMana(h) / 5) return [];
  const foes = s.heroes.filter((e) => !e.removed && e.owner !== player && !allied(s, e.owner, player) && e.boat === undefined);
  if (!foes.length) return [];
  const boats = s.objects.filter((o) => !o.removed && o.type === Obj.BOAT && o.carriedBy === undefined && !isAirship(o));
  const reachable = [...findPaths(w, s, h).keys()];
  const mine = (o: AdvObject) => {
    const tile = visitTile(w, o);
    return tile >= 0 && reachable.includes(tile);
  };
  const free = boats.filter(mine).length;
  for (const b of boats) {
    const tile = visitTile(w, b);
    if (tile < 0 || !isRevealed(s, player, tile) || tileSpan(b, h) <= 2 || b.z !== h.z) continue;
    if (!foes.some((e) => e.z === b.z && tileSpan(e, b) <= 2)) continue;
    if (mine(b) && free < 2) continue;
    const got = tryCast(s, w, player, h, SPELL.SCUTTLE_BOAT, tile);
    if (got.length) return got;
  }
  return [];
}

/** @wiki thing/dimension-door Dimension Door toward a target more than a day's walk away: the free, seen spot in range nearest to it (and nearer than we are). */
export function doorToward(s: AdventureState, w: World, player: number, h: Hero, target: number): AdventureEvent[] {
  const info = w.data.spells?.[SPELL.DIMENSION_DOOR];
  if (!info || !h.spells?.includes(SPELL.DIMENSION_DOOR) || h.boat !== undefined || h.movement < 400) return [];
  if ((h.mana ?? 0) < info.cost[heroMastery(h, info)] + maxMana(h) / 5) return [];
  const paths = findPaths(w, s, h);
  const node = paths.get(target);
  if (!node || node.cost <= h.movement) return [];
  const tx = target % w.size;
  const ty = Math.floor(target / w.size) % w.size;
  const here = Math.max(Math.abs(tx - h.x), Math.abs(ty - h.y));
  let best = -1;
  let dist = here;
  for (let dy = -8; dy <= 9; dy++)
    for (let dx = -9; dx <= 9; dx++) {
      const i = w.index(h.x + dx, h.y + dy, h.z);
      if (i < 0 || !paths.has(i) || w.visitBy[i] || w.heroAt[i] || w.blocked(i) || w.map.tiles[i]?.terrain === Terrain.WATER) continue;
      const d = Math.max(Math.abs(tx - (h.x + dx)), Math.abs(ty - (h.y + dy)));
      if (d < dist) [best, dist] = [i, d];
    }
  if (best < 0 || here - dist < 4) return [];
  return tryCast(s, w, player, h, SPELL.DIMENSION_DOOR, best);
}

/**
 * @wiki thing/dimension-door
 * Dimension Door over what walking can't cross (a wall of rock, a sea arm): with only scouting left,
 * to the nearest free spot out of walking reach from which the hero's best target is worth the trip
 * (tried by standing the hero there for a moment, its state put back after).
 */
export function doorOver(s: AdventureState, w: World, player: number, h: Hero): AdventureEvent[] {
  const info = w.data.spells?.[SPELL.DIMENSION_DOOR];
  if (!info || !h.spells?.includes(SPELL.DIMENSION_DOOR) || h.boat !== undefined || h.movement < 400) return [];
  if ((h.mana ?? 0) < info.cost[heroMastery(h, info)] + maxMana(h) / 5) return [];
  const paths = findPaths(w, s, h);
  const spots: { i: number; d: number }[] = [];
  for (let dy = -8; dy <= 9; dy++)
    for (let dx = -9; dx <= 9; dx++) {
      const i = w.index(h.x + dx, h.y + dy, h.z);
      const terrain = i >= 0 ? w.map.tiles[i]?.terrain : undefined;
      if (i < 0 || (!dx && !dy) || paths.has(i) || w.visitBy[i] || w.heroAt[i] || w.blocked(i) || terrain === Terrain.WATER || terrain === Terrain.ROCK || !isRevealed(s, h.owner, i)) continue;
      spots.push({ i, d: Math.max(Math.abs(dx), Math.abs(dy)) });
    }
  spots.sort((a, b) => a.d - b.d);
  const saved = { x: h.x, y: h.y, aiReason: h.aiReason, aiExploring: h.aiExploring, aiTarget: h.aiTarget };
  for (const { i } of spots.slice(0, 40)) {
    [h.x, h.y] = [i % w.size, Math.floor(i / w.size) % w.size];
    const target = chooseTarget(s, w, h);
    const real = target >= 0 && h.aiReason === "value";
    Object.assign(h, saved);
    if (!real) continue;
    const got = tryCast(s, w, player, h, SPELL.DIMENSION_DOOR, i);
    if (got.length) return got;
  }
  return [];
}

/** @wiki thing/town-portal Town Portal at the week's start, to a town of ours with a good part of an army waiting to be recruited, when it's more than a day's walk away. */
export function portalForTroops(s: AdventureState, w: World, player: number, h: Hero): AdventureEvent[] {
  if (h.boat !== undefined || (s.day - 1) % 7 > 1 || s.players[player].resources[6] < 3000) return [];
  const info = w.data.spells?.[SPELL.TOWN_PORTAL];
  if (!info || !h.spells?.includes(SPELL.TOWN_PORTAL)) return [];
  const m = heroMastery(h, info);
  const mine = army(w, h.army);
  const paths = findPaths(w, s, h);
  for (const t of portalTowns(s, w, h, m)) {
    // (A day's walk or less: walk.)
    const gate = visitTile(w, t);
    const node = gate >= 0 ? paths.get(gate) : undefined;
    if (node && node.cost <= h.movement) continue;
    const ti = townInfo(t);
    // (Troops still to recruit, and those the town already recruited into its garrison.)
    const waiting = (t.town?.available ?? []).reduce((a, n, level) => a + n * (w.creatures[ti?.creatures[level]?.[0] ?? -1]?.aiValue ?? 0), 0) + army(w, t.town?.garrison ?? []);
    if (waiting < 0.25 * Math.max(1, mine)) continue;
    const got = tryCast(s, w, player, h, SPELL.TOWN_PORTAL, t.id);
    if (got.length) return got;
  }
  return [];
}

/**
 * @wiki thing/town-portal principle/empty-town-invites
 * Town Portal home when an enemy that can reach one of our towns (with no hero in it) tomorrow is
 * too strong for the garrison behind its walls, but not for the garrison with this hero.
 */
export function portalHome(s: AdventureState, w: World, player: number, h: Hero): AdventureEvent[] {
  if (h.boat !== undefined || h.movement < 300) return [];
  const enemies = s.heroes.filter((e) => !e.removed && e.owner !== player && !allied(s, e.owner, player));
  if (!enemies.length) return [];
  const mine = power(w, h);
  for (const t of portalTowns(s, w, h, 3)) {
    const gate = visitTile(w, t);
    if (gate < 0 || w.heroAt[gate]) continue;
    // Already a day's walk off or less: walk (chooseTarget's "the strong go home" does).
    if (inReach(s, w, h, t.x, t.y, t.z)) continue;
    const walls = t.town?.built.includes(B.FORT) ? WALLS : 1;
    const garrison = army(w, t.town?.garrison ?? []);
    const comes = enemies.some((e) => power(w, e) > garrison * walls && power(w, e) < (garrison + mine) * walls && inReach(s, w, e, t.x, t.y, t.z));
    if (!comes) continue;
    const got = tryCast(s, w, player, h, SPELL.TOWN_PORTAL, t.id);
    if (got.length) return got;
  }
  return [];
}

/**
 * @wiki thing/water-walk thing/fly thing/summon-boat
 * Something worth taking across the water while on foot there's only scouting (or nothing) left:
 * Fly or Water Walk when either brings it in reach today (Water Walk first, it's the cheaper),
 * else Summon Boat (a boat goes wherever walking on the water would). Tried with the hero walking
 * on the water for a moment, its state put back after.
 */
export function castToReach(s: AdventureState, w: World, player: number, h: Hero): AdventureEvent[] {
  if (h.boat !== undefined || !h.spells?.length) return [];
  const known = (sp: number) => {
    const info = w.data.spells?.[sp];
    return !!info && !!h.spells?.includes(sp) && (h.mana ?? 0) >= info.cost[heroMastery(h, info)];
  };
  const spells = [SPELL.WATER_WALK, SPELL.FLY, SPELL.SUMMON_BOAT].filter((sp) => known(sp) && (sp !== SPELL.SUMMON_BOAT || boatToSummon(s, w, h)));
  if (!spells.length || !mapHasWater(w)) return [];
  const saved = { fly: h.fly, waterWalk: h.waterWalk, aiExploring: h.aiExploring, aiReason: h.aiReason };
  // On a player's view what lies over the water is often still under the shroud: when on foot there's nothing left
  // to take or explore, ground to explore across the water is worth the spell too.
  let stuck = false;
  if (s.viewer !== undefined) {
    stuck = chooseTarget(s, w, h) < 0 || (h.aiReason !== "value" && h.aiReason !== "explore");
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete (h as unknown as Record<string, unknown>)[k];
      else (h as unknown as Record<string, unknown>)[k] = v;
    }
  }
  const opens = (key: "fly" | "waterWalk") => {
    h[key] = { day: s.day, efficiency: 100 };
    const target = chooseTarget(s, w, h);
    const real = target >= 0 && (h.aiReason === "value" || (stuck && h.aiReason === "explore"));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete (h as unknown as Record<string, unknown>)[k];
      else (h as unknown as Record<string, unknown>)[k] = v;
    }
    return real;
  };
  for (const spell of spells) {
    if (spell === SPELL.FLY ? h.fly?.day === s.day || !opens("fly") : !opens("waterWalk")) continue;
    if (spell === SPELL.WATER_WALK && h.waterWalk?.day === s.day) continue;
    if (spell === SPELL.SUMMON_BOAT) {
      // The boat summoned: aboard at once (on foot there's still scouting to do, which would come first).
      const got = castToGetOut(s, w, player, h, true);
      if (!got.some((e) => e.e === "spell")) return got;
      w.refresh(s);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const i = w.index(h.x + dx, h.y + dy, h.z);
          if ((dx || dy) && i >= 0 && seaBoatAt(w, s, i)) return [...got, ...(act(s, w, player, { type: "move", hero: h.id, to: i }) ?? [])];
        }
      return got;
    }
    const got = tryCast(s, w, player, h, spell);
    if (got.length) return got;
  }
  return [];
}

/**
 * Summon Boat brings a boat only when there's one free on the map (an Advanced or Expert caster
 * makes one): else the spell points go for nothing, day after day (seen on Arrogance: 126 casts in
 * 56 days, not one boat).
 */
export function boatToSummon(s: AdventureState, w: World, h: Hero): boolean {
  const info = w.data.spells?.[SPELL.SUMMON_BOAT];
  if (!info) return false;
  return heroMastery(h, info) >= 2 || s.objects.some((o) => o.type === Obj.BOAT && !o.removed && o.carriedBy === undefined && !isAirship(o));
}

/** @wiki thing/summon-boat thing/fly thing/water-walk thing/town-portal A hero boxed in with nothing in reach: out by a summoned boat (walking to the shore first), Fly or Water Walk, else Town Portal home. */
export function castToGetOut(s: AdventureState, w: World, player: number, h: Hero, boatOnly = false): AdventureEvent[] {
  // Summon Boat is cast at the shore: walk to the nearest free spot by the water first.
  const boatSpell = w.data.spells?.[SPELL.SUMMON_BOAT];
  // (Known and affordable; the water comes with the walk.)
  const canSummon = !!boatSpell && !!h.spells?.includes(SPELL.SUMMON_BOAT) && (h.mana ?? 0) >= boatSpell.cost[heroMastery(h, boatSpell)] && boatToSummon(s, w, h);
  if (boatSpell && canSummon && !waterNextTo(w, h).length) {
    let shore = -1;
    let cost = Infinity;
    for (const [i, node] of findPaths(w, s, h)) {
      if (node.cost >= cost || node.cost > h.movement || node.passOnly || w.visitBy[i] || w.heroAt[i]) continue;
      const x = i % w.size;
      const y = Math.floor(i / w.size) % w.size;
      if (waterNextTo(w, { x, y, z: h.z }).length) [shore, cost] = [i, node.cost];
    }
    if (shore >= 0) {
      const moved = act(s, w, player, { type: "move", hero: h.id, to: shore }) ?? [];
      w.refresh(s);
      return [...moved, ...tryCast(s, w, player, h, SPELL.SUMMON_BOAT)];
    }
  }
  for (const spell of boatOnly ? [SPELL.SUMMON_BOAT] : [SPELL.SUMMON_BOAT, SPELL.FLY, SPELL.WATER_WALK]) {
    if ((spell === SPELL.SUMMON_BOAT && !boatToSummon(s, w, h)) || (spell === SPELL.FLY && h.fly?.day === s.day) || (spell === SPELL.WATER_WALK && h.waterWalk?.day === s.day)) continue;
    const got = tryCast(s, w, player, h, spell);
    if (got.length) return got;
  }
  if (boatOnly) return [];
  // Stranded (an island emptied, no boat, no spell over the water): Town Portal to a town of ours we can't walk to.
  const portal = w.data.spells?.[SPELL.TOWN_PORTAL];
  if (portal && h.spells?.includes(SPELL.TOWN_PORTAL)) {
    const paths = findPaths(w, s, h);
    for (const t of portalTowns(s, w, h, heroMastery(h, portal))) {
      const gate = visitTile(w, t);
      if (gate < 0 || paths.has(gate) || gate === w.index(h.x, h.y, h.z)) continue;
      const got = tryCast(s, w, player, h, SPELL.TOWN_PORTAL, t.id);
      if (got.length) return got;
    }
  }
  return [];
}
