// What a sane random map has, checked with the game's own rules on a game just begun (an
// advanced start applied): every player a town and a hero that can move, its town and wood and
// ore without a fight; the players' homes guarded from each other but, with the monsters gone,
// joined by land (by sea on an island map); every hero, town and place to visit reachable; roads.
import { Obj, START_PRESETS, type AdventureState, type RandomMapOptions, type World, Terrain, maskTiles, visitableFromTop } from "@heroes/core";

/**
 * Tiles a hero on foot can get to from `start` over any number of days: visiting what's in the
 * way and going on, through gates and portals; never past a monster (`fights`: through them),
 * never by air or (but `sea`) by water. Other heroes don't count.
 */
export function walkable(s: AdventureState, w: World, start: number, fights: boolean, sea = false): Set<number> {
  const seen = new Set([start]);
  const queue = [start];
  const N = w.size;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const exit = w.teleportTo[i] - 1;
    if (exit >= 0 && !seen.has(exit)) (seen.add(exit), queue.push(exit));
    // A monster's surroundings: a walk past monsters ends at the fight.
    if (!fights && w.guardedBy[i] && i !== start) continue;
    const x = i % N;
    const y = Math.floor(i / N) % N;
    const z = Math.floor(i / (N * N));
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const j = w.index(x + dx, y + dy, z);
        if (j < 0 || seen.has(j) || w.blocked(j)) continue;
        if (!sea && w.map.tiles[j].terrain === Terrain.WATER && !w.visitBy[j]) continue;
        if (dy === 1 && w.visitBy[j]) {
          const o = s.objects[w.visitBy[j] - 1];
          if (o && !visitableFromTop(o)) continue;
        }
        seen.add(j);
        // A boat ends a walk on land.
        if (!sea && w.map.tiles[j].terrain === Terrain.WATER) continue;
        queue.push(j);
      }
  }
  return seen;
}

export function mapProblems(s: AdventureState, w: World, o: RandomMapOptions): string[] {
  const out: string[] = [];
  const entrance = (x: { x: number; y: number; z: number; visit: number[] }) => maskTiles(x.visit, 1).map(({ dx, dy }) => w.index(x.x + dx, x.y + dy, x.z));
  const at = (h: { x: number; y: number; z: number }) => w.index(h.x, h.y, h.z);
  const live = s.heroes.filter((h) => !h.removed && h.garrison === undefined);
  const players = s.players.map((p, i) => ({ p, i })).filter(({ p }) => p.controller !== "none");
  const towns = s.objects.filter((x) => x.type === Obj.TOWN && !x.removed);
  const mains = new Map<number, (typeof live)[number]>();
  for (const { i } of players) {
    if (!towns.some((x) => x.owner === i)) out.push(`p${i} has no town`);
    // The main hero: the one that came out of the town (an advanced start's visitors stand elsewhere).
    const home = towns.find((x) => x.owner === i);
    const h = live.find((x) => x.owner === i && home && entrance(home).includes(at(x))) ?? live.find((x) => x.owner === i);
    if (!h) out.push(`p${i} has no hero`);
    else mains.set(i, h);
  }
  // An advanced start: the same number of towns each.
  if (o.start) {
    const held = players.map(({ i }) => towns.filter((t) => t.owner === i).length);
    if (Math.min(...held) !== Math.max(...held)) out.push(`towns held: ${held.join(" ")}`);
    // (Towns to start with beside the home one: at least one of them each.)
    if ((START_PRESETS[o.start]?.extraTowns ?? 0) > 0 && Math.min(...held) < 2) out.push(`towns held: ${held.join(" ")}, none beside the home town`);
  }
  // Without a fight: each player's own town and its wood and ore; nobody else's town.
  const siege = !!o.start && ["siege", "clash"].includes(o.start);
  for (const [i, h] of mains) {
    const reach = walkable(s, w, at(h), false, !!o.islands);
    const town = towns.find((x) => x.owner === i);
    if (town && !entrance(town).some((t) => reach.has(t))) out.push(`p${i}'s hero can't walk into its town`);
    if (!o.islands) {
      const mines = s.objects.filter((x) => x.type === Obj.MINE && (x.subid === 0 || x.subid === 2) && entrance(x).some((t) => reach.has(t)));
      if (mines.length < 2) out.push(`p${i} reaches ${mines.length} of its wood and ore mines`);
    }
    // (A small map's template may make its start zones little more than the town and its mines: 4SM0d's are.)
    if (reach.size < (o.template && o.size <= 36 ? 50 : 60)) out.push(`p${i}'s hero at ${h.x},${h.y},${h.z} has ${reach.size} tiles to walk`);
    // (A template decides its own guards: some leave a way between players open, the original's too.)
    if (!o.islands && !siege && !o.template)
      for (const t of towns.filter((x) => x.owner >= 0 && x.owner !== i))
        if (entrance(t).some((e) => reach.has(e))) out.push(`p${i} walks unguarded into p${t.owner}'s town at ${t.x},${t.y},${t.z}`);
  }
  // Every hero can take a step (none walled in, none standing in rock).
  for (const h of live) if (h.boat === undefined && walkable(s, w, at(h), true).size < 30) out.push(`p${h.owner}'s hero at ${h.x},${h.y},${h.z} is walled in`);
  // Past every monster: the map in one piece (by land, or by sea on an island map).
  const h0 = mains.get(players[0]?.i);
  if (h0) {
    const all = walkable(s, w, at(h0), true, !!o.islands);
    const seen = (x: { x: number; y: number; z: number; visit: number[] }) => entrance(x).some((e) => all.has(e));
    for (const t of towns) if (!seen(t)) out.push(`${t.owner >= 0 ? `p${t.owner}'s` : "a neutral"} town at ${t.x},${t.y},${t.z} can't be reached`);
    for (const h of live) if (h.boat === undefined && !all.has(at(h))) out.push(`p${h.owner}'s hero at ${h.x},${h.y},${h.z} can't be reached`);
    const lost = s.objects.filter((x) => !x.removed && x.type !== 8 && entrance(x).length && !seen(x));
    if (lost.length) out.push(`${lost.length} objects can't be reached (${lost.slice(0, 4).map((x) => `${x.type}@${x.x},${x.y},${x.z}`).join(" ")})`);
  }
  // Roads join the players' towns (on their level, but across the sea of an island map).
  // (A template's homes may be joined only through monoliths or gates: no road there.)
  if (!o.islands && !(o.template && s.objects.some((x) => x.type === 45 || x.type === 103))) {
    const homes = players.map(({ i }) => towns.find((t) => t.owner === i)).filter((t) => t && t.z === 0);
    const road = (i: number) => i >= 0 && !!w.map.tiles[i].road;
    const near = (t: (typeof towns)[number]) => {
      const g = entrance(t)[0];
      const out: number[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (road(w.index((g % w.size) + dx, Math.floor(g / w.size) % w.size + dy, t.z))) out.push(w.index((g % w.size) + dx, Math.floor(g / w.size) % w.size + dy, t.z));
      return out;
    };
    const start = homes[0] ? near(homes[0]) : [];
    const seen = new Set(start);
    const queue = [...start];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = w.index((i % w.size) + dx, (Math.floor(i / w.size) % w.size) + dy, Math.floor(i / (w.size * w.size)));
          if (road(j) && !seen.has(j)) (seen.add(j), queue.push(j));
        }
    }
    for (const t of homes.slice(1)) if (!near(t!).some((i) => seen.has(i))) out.push(`no road from p${homes[0]!.owner}'s town to p${t!.owner}'s`);
  }
  // Monoliths in pairs: every two-way colour (and one-way entrance's colour) has somewhere to lead.
  const ways = new Map<string, number>();
  for (const x of s.objects.filter((x) => !x.removed && (x.type === 45 || x.type === 43 || x.type === 44))) {
    const k = `${x.type === 45 ? 45 : 43}:${x.subid}`;
    ways.set(k, (ways.get(k) ?? 0) + (x.type === 44 ? 100 : 1));
  }
  for (const [k, n] of ways) if (k.startsWith("45") ? n < 2 : n < 101) out.push(`monolith ${k} has no other end`);
  const roads = w.map.tiles.filter((t) => t.road).length;
  // (A template's roads run along its passages only: fewer when gates join much of it.)
  // (Roads: none when the map asked for none, o.roads 0.)
  if (!o.islands && o.roads !== 0 && roads < (o.template ? w.size / 2 : w.size)) out.push(`only ${roads} road tiles`);
  if (o.roads === 0 && roads) out.push(`${roads} road tiles on a map without roads`);
  const monsters = s.objects.filter((x) => x.type === Obj.MONSTER && !x.removed).length;
  // (A template's weak zones on weak monsters leave most things unguarded; its islands have no passages to guard.)
  if (monsters < players.length * (o.template && o.islands ? 2 : 3) && !(o.template && o.monsters === 0)) out.push(`only ${monsters} monsters`);
  return out;
}
