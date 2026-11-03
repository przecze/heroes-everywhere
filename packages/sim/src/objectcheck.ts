// Map object proofs for scenecheck.ts: what each object does, checked exactly. The hero steps up
// to it (answering what it asks: a chest's choice, an arena's skill, a bank's "attack?"), fights
// what fights, and the checker compares before and after: the resource and its amount, the
// attribute, the skill or spell learned, the morale or luck, the movement, the mana, the tiles
// uncovered, the hero teleported or let through, the place flagged, the bank's loot, the prisoner
// freed, the service opened. Weekly and once-only places are visited again to see them refuse.
import {
  SLOT,
  type AdventureEvent,
  type AdventureState,
  type AdvObject,
  type Hero,
  type World,
  BANKS,
  PRIMARY_SHRINES,
  applyAdventureAction,
  airshipStop,
  battleFor,
  findPaths,
  isAirship,
  visitTile,
  objectUnder,
  finishBattle,
  heroMoraleLuck,
  maxMana,
  runAi,
  universityOffer,
  visit,
} from "@heroes/core";

export interface ObjectProof {
  proof: string | null;
  note: string;
}

interface Snap {
  resources: number[];
  primary: number[];
  skills: string;
  spells: number[];
  army: string;
  armyCount: number;
  experience: number;
  level: number;
  artifacts: number[];
  mana: number;
  movement: number;
  x: number;
  y: number;
  heroes: number;
  revealed: number;
  /** The player's explored tiles, one bit each (a copy). */
  fog: number[];
  morale: number;
  luck: number;
  tempMorale: number;
  tempLuck: number;
  keys: number[];
  obelisks: number;
  timed: number;
}

export interface ObjectCtx {
  s: AdventureState;
  w: World;
  h: Hero;
  o: AdvObject;
  before: Snap;
  after: Snap;
  events: AdventureEvent[];
  /** Fights the battle the visit began (the AI for the hero too) and settles it; true when won. */
  fight: () => boolean;
  /** Visits the object again, straight away (weekly and once-only places refuse). */
  again: () => AdventureEvent[];
  /** The latest snapshot. */
  now: () => Snap;
}

const bits = (words: number[] | undefined) => (words ?? []).reduce((a, x) => a + ((x >>> 0).toString(2).match(/1/g)?.length ?? 0), 0);

export function snapshot(s: AdventureState, w: World, h: Hero): Snap {
  const ml = heroMoraleLuck(s, w, h);
  return {
    resources: [...s.players[0].resources],
    primary: [...h.primary],
    skills: JSON.stringify(h.skills ?? []),
    spells: [...(h.spells ?? [])],
    army: JSON.stringify(h.army),
    armyCount: h.army.reduce((a, x) => a + (x?.count ?? 0), 0),
    experience: h.experience,
    level: h.level,
    artifacts: [...(h.equipped ?? []).filter((a) => a >= 0), ...(h.backpack ?? [])],
    mana: h.mana ?? 0,
    movement: h.movement,
    x: h.x,
    y: h.y,
    heroes: s.heroes.filter((x) => !x.removed && x.owner === 0).length,
    revealed: bits(s.players[0].revealed as number[] | undefined),
    fog: [...(s.players[0].revealed ?? [])],
    morale: ml.morale,
    luck: ml.luck,
    tempMorale: h.temp?.morale ?? 0,
    tempLuck: h.temp?.luck ?? 0,
    keys: [...(s.players[0].keys ?? [])],
    obelisks: (s.players[0].obelisks ?? []).length,
    timed: (h.timed ?? []).length,
  };
}

type Check = (c: ObjectCtx) => true | string;
const d = (c: ObjectCtx, i: number) => c.after.resources[i] - c.before.resources[i];
const gained = (c: ObjectCtx) => c.after.resources.some((x, i) => x > c.before.resources[i]) || c.after.artifacts.length > c.before.artifacts.length || c.after.armyCount > c.before.armyCount || c.after.experience > c.before.experience || c.after.mana > c.before.mana;
const market = (c: ObjectCtx) => c.events.some((e) => e.e === "market") || "the service didn't open";
const flagged = (c: ObjectCtx) => c.o.owner === 0 || "not flagged as ours";
const moved = (c: ObjectCtx) => c.after.x !== c.before.x || c.after.y !== c.before.y;
const refuses = (c: ObjectCtx, what: string): true | string => {
  const was = c.now();
  c.again();
  const is = c.now();
  return JSON.stringify([was.resources, was.primary, was.spells, was.skills, was.experience, was.artifacts]) === JSON.stringify([is.resources, is.primary, is.spells, is.skills, is.experience, is.artifacts]) || `${what} gave again at once`;
};
const rare = [1, 3, 4, 5];
const primaryName = ["Attack", "Defense", "Power", "Knowledge"];
const shrine = (c: ObjectCtx): true | string => {
  const [skill, n] = PRIMARY_SHRINES[c.o.type] ?? [0, 0];
  const got = c.after.primary[skill] - c.before.primary[skill];
  if (got !== n) return `${primaryName[skill]} +${got}, not +${n}`;
  return refuses(c, "the shrine");
};
const temp = (morale: number, luck: number, move?: number) => (c: ObjectCtx): true | string => {
  if (morale && c.after.tempMorale - c.before.tempMorale !== morale) return `morale ${c.after.tempMorale - c.before.tempMorale}, not ${morale}`;
  if (luck && c.after.tempLuck - c.before.tempLuck !== luck) return `luck ${c.after.tempLuck - c.before.tempLuck}, not ${luck}`;
  // (The step onto it cost movement; the bonus adds more than the step costs.)
  if (move && c.after.movement - c.before.movement < move - 200) return `movement ${c.after.movement - c.before.movement}, not about +${move}`;
  return true;
};
const bank = (c: ObjectCtx): true | string => {
  if (!c.s.battles[0]) return "no fight for the loot";
  if (!c.fight()) return "the guards won";
  const now = c.now();
  const def = BANKS[`${c.o.type}:${c.o.subid}`];
  const level = c.o.bank?.level ?? 0;
  const loot = def?.levels[level];
  if (loot?.spells) return now.spells.length > c.before.spells.length || "no spell from the Pyramid";
  if (loot?.creatures?.length) return loot.creatures.every(([id]) => c.h.army.some((a) => a?.creature === id)) || `no ${loot.creatures.map(([id]) => id).join(", ")} from the bank`;
  const res = loot?.resources ?? [];
  const ok = res.every((n, i) => now.resources[i] - c.before.resources[i] >= n) && (!loot?.artifacts?.length || now.artifacts.length > c.before.artifacts.length);
  return ok || `the loot came short (${now.resources.map((x, i) => x - c.before.resources[i]).join("/")}, wanted ${res.join("/")}${loot?.artifacts?.length ? " and artifacts" : ""})`;
};
/**
 * A circle of `r` tiles uncovered around a centre (the original's disc, reveal in world.ts): every
 * tile in it seen after, the tiles at its edge straight out on each side fogged before, and the
 * tiles just beyond it (inside the map) still fogged after.
 */
const uncovers = (r: number, centre: (c: ObjectCtx) => { x: number; y: number }) => (c: ObjectCtx): true | string => {
  const { x: cx, y: cy } = centre(c);
  const n = c.w.size;
  const seen = (fog: number[], x: number, y: number) => {
    const i = c.w.index(x, y, c.o.z);
    return ((fog[i >> 5] >>> (i & 31)) & 1) === 1;
  };
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r + r && inside(cx + dx, cy + dy) && !seen(c.after.fog, cx + dx, cy + dy)) return `${cx + dx},${cy + dy} (within ${r} of ${cx},${cy}) still fogged`;
  const sides: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let edges = 0;
  let beyond = 0;
  for (const [ux, uy] of sides) {
    const [ex, ey] = [cx + ux * r, cy + uy * r];
    if (inside(ex, ey) && ++edges && seen(c.before.fog, ex, ey)) return `${ex},${ey} (at the circle's edge) was seen before the visit`;
    const [bx, by] = [cx + ux * (r + 1), cy + uy * (r + 1)];
    if (inside(bx, by) && ++beyond && seen(c.after.fog, bx, by)) return `${bx},${by} (beyond ${r} tiles) uncovered too`;
  }
  return (edges === 4 && beyond === 4) || `the circle doesn't fit the map (${edges} edges and ${beyond} tiles beyond it inside)`;
};
const teleported = (c: ObjectCtx): true | string => (c.events.some((e) => e.e === "teleport") && moved(c)) || "the hero wasn't taken through";

/** The service used, through its own action, and what came of it. */
const service = (what: string, act: (c: ObjectCtx) => Parameters<typeof applyAdventureAction>[2], ok: (c: ObjectCtx, was: Snap, now: Snap) => boolean): Check => (c) => {
  if (!c.events.some((e) => e.e === "market")) return "the service didn't open";
  const was = c.now();
  try {
    applyAdventureAction(c.s, c.w, act(c), 0);
  } catch (e) {
    return `${what}: ${e instanceof Error ? e.message : e}`;
  }
  return ok(c, was, c.now()) || `${what} changed nothing`;
};
/** Per object type (or type:subtype), what must have happened. */
const CHECKS: Record<string, Check> = {
  // An artifact, a spell scroll: picked up; a sign: its message.
  5: (c) => c.after.artifacts.length > c.before.artifacts.length || "no artifact taken",
  93: (c) => c.after.artifacts.length > c.before.artifacts.length || "no scroll taken",
  91: (c) => c.events.some((e) => e.e === "visit" && !!e.message) || "no message",
  // HotA's Warehouses: the week's stock of their resource (10 wood or ore, 6 of a rare one, 2000 gold), once a week.
  142: (c) => {
    const want = [10, 6, 10, 6, 6, 6, 2000][c.o.subid] ?? 1;
    const got = d(c, c.o.subid);
    if (got !== want) return `${got} of resource ${c.o.subid}, not ${want}`;
    return refuses(c, "again this week");
  },
  79: (c) => d(c, c.o.subid) > 0 && c.o.removed || "the resource wasn't picked up",
  12: (c) => d(c, 6) >= 400 && d(c, 6) <= 600 && rare.concat(0, 2).some((i) => d(c, i) >= 4 && d(c, i) <= 6) || `gold +${d(c, 6)}, resources ${c.after.resources.map((x, i) => x - c.before.resources[i]).join("/")}`,
  101: (c) => ([1000, 1500, 2000].includes(d(c, 6)) || c.after.artifacts.length > c.before.artifacts.length) || `gold +${d(c, 6)}, no artifact`,
  55: (c) => ((d(c, 5) === 5 || d(c, 6) === 500) ? refuses(c, "the garden") : `gems +${d(c, 5)}, gold +${d(c, 6)}`),
  112: (c) => ([1, 2, 3, 4, 5].some((i) => d(c, i) >= 3 && d(c, i) <= 6) ? refuses(c, "the windmill") : "no 3-6 of a resource"),
  109: (c) => (d(c, 6) === 500 ? refuses(c, "the water wheel") : `gold +${d(c, 6)}, not 500 in the first week`),
  32: shrine,
  51: shrine,
  23: shrine,
  61: shrine,
  4: (c) => (c.after.primary[0] - c.before.primary[0] === 2 ? refuses(c, "the arena") : `Attack +${c.after.primary[0] - c.before.primary[0]}, not +2`),
  47: (c) => (c.after.primary[2] - c.before.primary[2] === 1 && d(c, 6) === -1000) || `Power +${c.after.primary[2] - c.before.primary[2]}, gold ${d(c, 6)}`,
  107: (c) => (c.after.primary[0] - c.before.primary[0] === 1 && d(c, 6) === -1000) || `Attack +${c.after.primary[0] - c.before.primary[0]}, gold ${d(c, 6)}`,
  100: (c) => (c.after.experience - c.before.experience === 1000 ? refuses(c, "the stone") : `experience +${c.after.experience - c.before.experience}, not 1000`),
  41: (c) => c.after.primary.every((v, i) => v - c.before.primary[i] === 2) || `attributes +${c.after.primary.map((v, i) => v - c.before.primary[i]).join("/")}, not +2 each`,
  102: (c) => c.after.level > c.before.level || "no level gained",
  113: (c) => c.after.skills !== c.before.skills || "no skill learned",
  81: (c) => c.after.skills !== c.before.skills || c.after.spells.length > c.before.spells.length || c.after.primary.some((v, i) => v !== c.before.primary[i]) || "nothing taught",
  88: (c) => c.after.spells.length > c.before.spells.length || "no spell learned",
  89: (c) => c.after.spells.length > c.before.spells.length || "no spell learned",
  90: (c) => c.after.spells.length > c.before.spells.length || "no spell learned",
  28: temp(0, 1),
  96: (c) => c.after.tempMorale - c.before.tempMorale >= 1 || "no morale",
  11: temp(1, 0),
  52: temp(0, 1),
  14: (c) => (c.after.tempLuck - c.before.tempLuck === 2 && c.after.movement === 0) || `luck +${c.after.tempLuck - c.before.tempLuck}, movement ${c.after.movement}`,
  30: (c) => c.after.tempLuck !== c.before.tempLuck || c.events.some((e) => e.e === "visit" && /luck/.test(e.message)) || "no luck either way",
  31: temp(1, 0, 400),
  110: temp(1, 0, 400),
  56: temp(1, 0, 800),
  64: temp(1, 1, 400),
  38: (c) => c.after.tempMorale > c.before.tempMorale || c.after.tempLuck > c.before.tempLuck || "no morale or luck",
  94: (c) => (c.after.movement - c.before.movement >= 200 && !c.after.army.includes('"creature":10,')) || `movement ${c.after.movement - c.before.movement}, Cavaliers ${c.after.army.includes('"creature":10,') ? "not " : ""}trained`,
  108: (c) => (c.after.artifacts.length > c.before.artifacts.length || c.o.visitedWeek === -1) && c.after.tempMorale - c.before.tempMorale === -3 || `artifact ${c.after.artifacts.length > c.before.artifacts.length ? "found" : "not found"}, morale ${c.after.tempMorale - c.before.tempMorale}`,
  49: (c) => (c.after.mana === maxMana(c.h) ? refuses(c, "the well") : `spell points ${c.after.mana}, not ${maxMana(c.h)}`),
  48: (c) => c.after.mana === 2 * maxMana(c.h) || `spell points ${c.after.mana}, not ${2 * maxMana(c.h)}`,
  // The Redwood Observatory, the Pillar of Fire: 20 tiles around the hero.
  58: uncovers(20, (c) => c.h),
  60: uncovers(20, (c) => c.h),
  37: (c) => c.after.revealed > c.before.revealed || "nothing uncovered around the Eye",
  13: (c) => c.after.revealed > c.before.revealed && d(c, 6) < 0 || `uncovered ${c.after.revealed - c.before.revealed} tiles, gold ${d(c, 6)}`,
  27: (c) => c.events.some((e) => e.e === "visit") || "nothing said",
  15: (c) => c.events.some((e) => e.e === "visit") || "nothing said",
  43: teleported,
  45: teleported,
  // Underground, through the gate.
  103: (c) => (c.events.some((e) => e.e === "teleport") && c.h.z === 1) || "the hero isn't underground",
  // The other whirlpool, by boat, half the weakest stack gone.
  111: (c) => (c.events.some((e) => e.e === "teleport") && c.h.y < 10 && c.after.armyCount < c.before.armyCount) || `the boat is at ${c.h.x},${c.h.y}; army ${c.before.armyCount} → ${c.after.armyCount}`,
  // The quest: 5 wood handed over for 1000 gold (the guard then gone).
  83: (c) => (d(c, 0) === -5 && d(c, 6) === 1000) || `wood ${d(c, 0)}, gold ${d(c, 6)}`,
  215: (c) => (d(c, 0) === -5 && c.o.removed) || `wood ${d(c, 0)}, the guard ${c.o.removed ? "gone" : "still there"}`,
  44: () => true,
  10: (c) => c.after.keys.includes(c.o.subid) || "no key",
  9: (c) => c.o.removed || "the guard still stands",
  212: (c) => moved(c) || "not let through the gate",
  33: (c) => (moved(c) && c.o.owner === 0) || "not let through the garrison",
  219: (c) => (moved(c) && c.o.owner === 0) || "not let through the garrison",
  53: flagged,
  220: (c) => {
    if (c.s.battles[0] && !c.fight()) return "its guards won";
    return c.o.owner === 0 || "not flagged after the fight";
  },
  42: flagged,
  87: (c) => (c.o.owner === 0 && c.events.some((e) => e.e === "shipyard")) || "not ours, or the shipyard didn't open",
  // HotA's Airship Yard: an airship bought (5000 gold, 20 wood) stands on clear ground by it; boarded, it flies over the water and lands beyond.
  "87:1": (c) => {
    if (c.o.owner !== 0 || !c.events.some((e) => e.e === "shipyard")) return "not ours, or the yard didn't open";
    const { s, w, h } = c;
    const [wood, gold] = [s.players[0].resources[0], s.players[0].resources[6]];
    applyAdventureAction(s, w, { type: "buildBoat", object: c.o.id }, 0);
    const ship = s.objects[s.objects.length - 1];
    if (!isAirship(ship)) return "no airship built";
    if (wood - s.players[0].resources[0] !== 20 || gold - s.players[0].resources[6] !== 5000) return "it didn't cost 5000 gold and 20 wood";
    const at = visitTile(w, ship);
    if (w.map.tiles[at].terrain === 8) return "the airship is on the water";
    h.movement = h.maxMovement;
    applyAdventureAction(s, w, { type: "move", hero: h.id, to: at }, 0);
    if (h.boat !== ship.id || !h.airship) return "the hero didn't board it";
    h.maxMovement = h.movement = 1500;
    const paths = findPaths(w, s, h);
    const over = (i: number) => { for (let j = i; j >= 0; j = paths.get(j)!.prev) if (w.map.tiles[j].terrain === 8) return true; return false; };
    const to = [...paths.entries()].find(([i, n]) => !n.passOnly && airshipStop(w, s, i) && n.prev >= 0 && !paths.get(n.prev)?.passOnly && over(i))?.[0];
    if (to === undefined) return "nowhere beyond the water to fly to";
    applyAdventureAction(s, w, { type: "move", hero: h.id, to }, 0);
    return (w.index(h.x, h.y, h.z) === to && h.boat === undefined) || "the airship didn't fly over the water and land";
  },
  // (A guarded dwelling fights first.)
  17: (c) => (c.s.battles[0] && !c.fight() ? "its guards won" : c.o.owner === 0 || "not ours after the visit"),
  20: (c) => (c.s.battles[0] && !c.fight() ? "its guards won" : c.o.owner === 0 || "not ours after the visit"),
  78: (c) => c.events.some((e) => e.e === "dwelling") || "the camp didn't open",
  62: (c) => c.after.heroes === c.before.heroes + 1 || "no hero freed",
  6: (c) => c.after.experience - c.before.experience === 1000 || `experience +${c.after.experience - c.before.experience}, not the box's 1000`,
  57: (c) => c.after.obelisks === c.before.obelisks + 1 || "the obelisk wasn't counted",
  80: (c) => c.events.some((e) => e.e === "visit") || "nothing said",
  // The services, each used: a stack given up for experience, an artifact bought, a stack upgraded, a hero hired, a trade made, a skill learned, a machine bought, a stack sold, bones raised.
  // (A good hero gives up an artifact, the Centaur's Axe the scene put in the pack.)
  2: service("the sacrifice", (c) => ({ type: "sacrifice", hero: c.h.id, object: c.o.id, artifacts: [7] }), (c, was, now) => now.experience > was.experience && now.artifacts.length < was.artifacts.length),
  7: service("buying an artifact", (c) => ({ type: "buyArtifact", hero: c.h.id, object: c.o.id, slot: 0 }), (c, was, now) => now.artifacts.length > was.artifacts.length),
  35: service("the upgrade", (c) => ({ type: "upgradeStack", hero: c.h.id, object: c.o.id, slot: 0 }), (c) => c.h.army[0]?.creature === 1),
  95: service("hiring", (c) => ({ type: "hireAt", hero: c.h.id, object: c.o.id, slot: 0 }), (c, was, now) => now.heroes > was.heroes),
  97: market,
  99: service("a trade", (c) => ({ type: "trade", from: 0, to: 6, lots: 1 }), (c, was, now) => now.resources[6] > was.resources[6] && now.resources[0] < was.resources[0]),
  104: service("learning", (c) => ({ type: "learnSkill", hero: c.h.id, object: c.o.id, skill: universityOffer(c.s, c.o)[0] }), (c, was, now) => now.skills !== was.skills && now.resources[6] === was.resources[6] - 2000),
  106: service("buying a ballista", (c) => ({ type: "buyMachineAt", hero: c.h.id, object: c.o.id, artifact: 4 }), (c) => (c.h.equipped ?? []).includes(4)),
  213: service("selling a stack", (c) => ({ type: "sellStack", hero: c.h.id, object: c.o.id, slot: 0, count: 1 }), (c, was, now) => now.resources[6] > was.resources[6] && now.armyCount < was.armyCount),
  221: service("a trade", (c) => ({ type: "trade", from: 0, to: 6, lots: 1 }), (c, was, now) => now.resources[6] > was.resources[6] && now.resources[0] < was.resources[0]),
  // HotA's Cannon Yard: only the cannon, in the ballista's slot.
  "106:1": service("buying a cannon", (c) => ({ type: "buyMachineAt", hero: c.h.id, object: c.o.id, artifact: 146 }), (c, was, now) => c.h.equipped?.[SLOT.MACH1] === 146 && now.resources[6] === was.resources[6] - 4000),
  "144:1": service("the transformer", (c) => ({ type: "transform", hero: c.h.id, object: c.o.id, slots: [0] }), (c) => c.h.army.some((a) => a?.creature === 56)),
  "144:7": market,
  "144:9": service("a one-for-one trade", (c) => ({ type: "trade", from: 1, to: 3, lots: 1 }), (c, was, now) => now.resources[3] === was.resources[3] + 1 && now.resources[1] === was.resources[1] - 1),
  "146:0": service("learning", (c) => ({ type: "learnSkill", hero: c.h.id, object: c.o.id, skill: universityOffer(c.s, c.o)[0] }), (c, was, now) => now.skills !== was.skills),
  "146:2": service("the mana altar", (c) => ({ type: "sacrifice", hero: c.h.id, object: c.o.id, stacks: [[0, 5]] }), (c, was, now) => now.mana > was.mana && now.armyCount < was.armyCount),
  "146:3": market,
  22: (c) => gained(c) || c.events.some((e) => e.e === "visit") || "nothing found or said",
  105: (c) => gained(c) || c.events.some((e) => e.e === "visit") || "nothing found or said",
  39: (c) => gained(c) || "nothing in the lean-to",
  29: (c) => gained(c) || "nothing in the flotsam",
  82: (c) => gained(c) || "nothing in the chest",
  86: (c) => c.after.artifacts.length > c.before.artifacts.length || "the survivor gave no artifact",
  59: (c) => c.events.some((e) => e.e === "visit") || "nothing said",
  92: (c) => c.after.armyCount < c.before.armyCount && c.after.experience > c.before.experience || "the sirens took nobody or gave no experience",
  "145:1": (c) => gained(c) || c.events.some((e) => e.e === "visit") || "nothing in the barrel, nothing said",
  "145:2": (c) => gained(c) || "nothing in the jetsam",
  "145:3": (c) => c.after.mana > c.before.mana || "no spell points",
  "145:0": (c) => c.after.armyCount > c.before.armyCount || c.events.some((e) => e.e === "offer") || "no genies offered",
  "144:6": (c) => (c.after.experience - c.before.experience === 2000 && d(c, 6) === -1000) || `experience +${c.after.experience - c.before.experience}, gold ${d(c, 6)}`,
  "144:10": (c) => (d(c, 6) === 500 || d(c, 3) === 5 ? refuses(c, "the prospector") : `gold +${d(c, 6)}, sulfur +${d(c, 3)}`),
  "144:8": (c) => (d(c, 6) === 500 ? refuses(c, "the derrick") : `gold +${d(c, 6)}, not 500 in the first week`),
  "144:5": (c) => c.after.skills !== c.before.skills || "no skill raised",
  "144:11": (c) => c.after.timed > c.before.timed || "no guide for the week",
  "144:12": (c) => [300, 400, 500].includes(d(c, 6)) || c.after.armyCount > c.before.armyCount || c.events.some((e) => e.e === "offer") || `gold +${d(c, 6)}, no trappers' creatures offered`,
  "144:0": (c) => c.after.timed > c.before.timed || "no loyalty bonus",
  "144:4": temp(0, 1, 600),
  // (An overnight stop: today's movement gone, +1000 for two days.)
  "144:3": (c) => (c.after.movement === 0 && c.after.timed > c.before.timed) || `movement ${c.after.movement}, bonuses ${c.after.timed - c.before.timed}`,
  "144:2": (c) => c.after.primary.some((v, i) => v > c.before.primary[i]) || gained(c) || "nothing gained",
  // (The astronomer's apprentice: a week of better sight, taken on when asked.)
  "146:1": (c) => c.after.timed > c.before.timed || c.after.revealed > c.before.revealed || "no apprentice taken on, nothing uncovered",
};
for (const key of Object.keys(BANKS)) CHECKS[key] = bank;
// The Ruins: once won, from the top of the tower, the land around (12 tiles from the bank).
CHECKS["16:32"] = (c) => {
  const won = bank(c);
  if (won !== true) return won;
  const r = BANKS["16:32"].levels[c.o.bank?.level ?? 0]?.reveal ?? 0;
  return uncovers(r, (x) => x.o)({ ...c, after: c.now() });
};

/** What the checker can't set up yet. */
const UNCHECKED: Record<string, string> = { 54: "a creature's fight" };
/** Things with no effect to check: what the original gives them. */
const NOTHING: Record<string, string> = { 50: "the Market of Time does nothing in the original (functionally useless)" };

/** The answer the object's question gets: yes, with the first choice (gold, the first skill). */
export const ANSWER_OPTION: Record<number, number> = { 4: 0, 47: 2, 107: 0, 101: 0 };

export function proveObject(c: ObjectCtx): ObjectProof {
  const key = `${c.o.type}:${c.o.subid}`;
  const why = UNCHECKED[key] ?? UNCHECKED[c.o.type];
  if (why) return { proof: null, note: `no checker yet: ${why}` };
  const nothing = NOTHING[key] ?? NOTHING[c.o.type];
  if (nothing) return { proof: null, note: `nothing to check: ${nothing}` };
  const check = CHECKS[key] ?? CHECKS[c.o.type];
  if (!check) {
    // Only the generic look: the visit changed something or said something.
    const changed = JSON.stringify(c.before) !== JSON.stringify(c.after) || c.events.some((e) => e.e === "visit" || e.e === "offer");
    return { proof: changed ? null : "visiting it did nothing", note: "no checker yet: only that the visit did something" };
  }
  try {
    const r = check(c);
    return { proof: r === true ? null : r, note: "its exact effect checked" };
  } catch (e) {
    return { proof: `error: ${e instanceof Error ? e.message : e}`, note: "its exact effect checked" };
  }
}

/** Plays out the visit's battle (if one began) and settles it; whether the hero won. */
export function fightAndSettle(s: AdventureState, w: World): boolean {
  const b = s.battles[0]?.battle;
  if (!b) return false;
  b.sides[0].controller = "ai";
  runAi(b);
  const won = b.winner === 0;
  finishBattle(s, w, 0);
  return won;
}

/** The hero visits the object again, as the player would: Space where it stands (else straight, counted in `direct`). */
export const visitAgain = (s: AdventureState, w: World, h: Hero, o: AdvObject) => {
  const standing = objectUnder(s, w, h) === o && !battleFor(s, h.owner);
  if (!standing) visitAgain.direct++;
  const ev = standing ? applyAdventureAction(s, w, { type: "visit", hero: h.id }, h.owner) : visit(s, w, h, o);
  if (h.offer) applyAdventureAction(s, w, { type: "answerOffer", hero: h.id, accept: true, option: ANSWER_OPTION[o.type] }, 0);
  return ev;
};
visitAgain.direct = 0;
