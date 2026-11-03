// Strategic benchmark cases for the adventure AI: a small staged map, a known good decision, and a score
// for what the computer did. The sim (sim/strategy.ts) plays them headless and prints a scorecard; the
// game opens each as a map "strategy:<id>" (the computer on every side with "&ai=<days>", or by hand).
import type { H3Map, MapObject, MapTile, ObjectTemplate } from "@heroes/formats";
import { SPELL } from "../spells.ts";
import { type GameData } from "./create.ts";
import { makeHero } from "./create.ts";
import { B } from "./town.ts";
import { DWELLINGS } from "../dwellingData.ts";
import { type AdventureState, type ArmySlot, type Hero, Obj } from "./types.ts";
import { type AdventureEvent } from "./rules.ts";
import { Terrain, type World, maskTiles, visitTile } from "./world.ts";
import { maxMovement } from "./movement.ts";

export const WOOD = 0;
export const MERCURY = 1;
export const ORE = 2;
export const SULFUR = 3;
export const CRYSTAL = 4;
export const GEMS = 5;
export const GOLD = 6;

/** The town faction ids (subtype of the town object): 0 Castle, 1 Rampart, 2 Tower, 3 Inferno, 4 Necropolis, 5 Dungeon, 6 Stronghold, 7 Fortress, 8 Conflux, 9 Cove. */
export const CASTLE = 0;

export class Stage {
  readonly m: H3Map;
  readonly n: number;
  /** Entrance tile of the first town of each player (the hero starts on it). */
  private mainTown: ({ x: number; y: number } | undefined)[] = [];
  private factions: number[] = [];
  teams: (number | undefined)[] = [];

  private readonly data: GameData;

  constructor(data: GameData, n = 24, terrain: number = Terrain.GRASS) {
    this.data = data;
    this.n = n;
    const tiles: MapTile[] = Array.from({ length: n * n }, () => ({ terrain, view: 0, river: 0, riverDir: 0, road: 0, roadDir: 0, flags: 0 }));
    const player = () => ({ canHuman: false, canComputer: false });
    this.m = {
      version: 0x1c,
      hotaVersion: 0,
      size: n,
      levels: 1,
      name: "Benchmark",
      description: "",
      difficulty: 1,
      levelLimit: 0,
      players: Array.from({ length: 8 }, player) as H3Map["players"],
      victory: { type: -1 },
      loss: { type: -1 },
      rumors: [],
      tiles,
      templates: [],
      objects: [],
      events: [],
    } as unknown as H3Map;
  }

  /** Paints a block of terrain. */
  paint(terrain: number, x0: number, y0: number, x1 = x0, y1 = y0): this {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.m.tiles[y * this.n + x].terrain = terrain;
    return this;
  }
  /** A ring of rock around the block (x0..x1, y0..y1): what is inside can't get out. */
  ring(x0: number, y0: number, x1: number, y1: number): this {
    this.paint(Terrain.ROCK, x0, y0, x1, y0).paint(Terrain.ROCK, x0, y1, x1, y1).paint(Terrain.ROCK, x0, y0, x0, y1).paint(Terrain.ROCK, x1, y0, x1, y1);
    return this;
  }
  /** Rock across a whole row or column band: a wall with the gaps left open (xs / ys given as tiles to leave). */
  wallRow(y: number, gaps: number[] = []): this {
    for (let x = 0; x < this.n; x++) if (!gaps.includes(x)) this.paint(Terrain.ROCK, x, y);
    return this;
  }
  wallCol(x: number, gaps: number[] = []): this {
    for (let y = 0; y < this.n; y++) if (!gaps.includes(y)) this.paint(Terrain.ROCK, x, y);
    return this;
  }

  /** Puts an object with its entrance at (x, y); returns the object's index in the map. */
  put(type: number, sub: number | undefined, x: number, y: number, objData: Record<string, unknown> = {}): number {
    const grass = (t: ObjectTemplate) => !!(t.terrainMask & (1 << Terrain.GRASS));
    const cands = this.data.templates.filter((t) => t.id === type && (sub === undefined || t.subid === sub));
    const t = cands.find(grass) ?? cands[0] ?? this.data.templates.find((o) => o.id === type);
    if (!t) throw new Error(`no template for object ${type}/${sub}`);
    const v = maskTiles(t.visitMask, 1)[0] ?? maskTiles(t.blockMask, 0)[0] ?? { dx: 0, dy: 0 };
    const o: MapObject = { x: x - v.dx, y: y - v.dy, z: 0, template: this.m.templates.push(t) - 1, id: t.id, subid: sub ?? t.subid, data: { owner: -1, ...objData } };
    this.m.objects.push(o);
    return this.m.objects.length - 1;
  }
  /** A wandering monster stack. */
  monster(name: string, count: number, x: number, y: number, extra: Record<string, unknown> = {}): number {
    return this.put(Obj.MONSTER, this.data.creatures.findIndex((c) => c.name === name || c.plural === name), x, y, { count, character: 4, noJoin: true, neverFlees: true, stacksCount: 4, ...extra });
  }
  /** A pile of a resource (gold in gold: a map stores gold piles in hundreds, so 5000 was 500000). */
  resource(res: number, amount: number, x: number, y: number): number {
    return this.put(Obj.RESOURCE, res, x, y, { amount: res === GOLD ? Math.max(1, Math.round(amount / 100)) : amount });
  }
  mine(res: number, x: number, y: number, owner = -1): number {
    return this.put(Obj.MINE, res, x, y, { owner });
  }
  /** A town of a player (gate at (x, y)); the player's first is its main town and spawns its hero. */
  town(player: number, faction: number, x: number, y: number, extra: Record<string, unknown> = {}): number {
    const i = this.put(Obj.TOWN, faction, x, y, { owner: player, formation: 0, ...extra });
    if (player >= 0 && !this.mainTown[player]) {
      this.mainTown[player] = { x, y };
      this.factions[player] = faction;
    }
    return i;
  }
  /** A rival walled in out of the way, in a corner (a ring of rock around its town). */
  corner(player: number, faction = CASTLE): this {
    const e = this.n - 3;
    this.paint(Terrain.GRASS, e - 3, e - 3, e + 1, e + 1);
    this.ring(e - 4, e - 4, e + 2, e + 2);
    this.town(player, faction, e, e - 1);
    return this;
  }
  /** Which players are in the game, and their teams. */
  build(playerCount = 2): H3Map {
    const player = (c: number) => ({
      canHuman: true,
      canComputer: true,
      aiTactic: 0,
      allowedFactions: 1 << (this.factions[c] ?? 0),
      randomFaction: false,
      randomHero: true,
      mainHero: -1,
      mainTown: this.mainTown[c] ? { x: this.mainTown[c]!.x, y: this.mainTown[c]!.y, z: 0, generateHero: true } : undefined,
      ...(this.teams[c] !== undefined ? { team: this.teams[c] } : {}),
    });
    for (let c = 0; c < playerCount; c++) (this.m.players as unknown[])[c] = player(c);
    return this.m;
  }
}

/** Where the computer's hero stands, what it holds: changes to the game as it starts. */
export type Setup = (s: AdventureState, w: World, h: Hero) => void;

/** What player 0 did, day by day. */
export interface Run {
  s: AdventureState;
  w: World;
  /** Player 0's first hero at the end. */
  h: Hero;
  /** Player 0's events, with the day each came on. */
  events: { day: number; ev: AdventureEvent }[];
  /** At the end of each of player 0's days (index = day): where its heroes stood, its gold, the objects it owned. */
  days: { seen: number; foes: { owner: number; x: number; y: number; army: number }[]; heroes: { id: number; x: number; y: number; power: number; army: number }[]; resources: number[]; owned: number[]; towns: number[] }[];
  fights: { day: number; hero: number; object: number; won?: boolean }[];
  /** Player 0's towns taken by others (on their turns), with the day: a town lost and won back still counts. */
  lostTowns?: { day: number; object: number }[];
}

export interface PlayOptions {
  days: number;
  /** Players in the game (default 2), their controllers by colour (default: all ai). */
  players?: number;
  teams?: (number | undefined)[];
  seed?: number;
  /** Runs before the first turn, and each day after a turn of a player (for staged threats). */
  setup?: Setup;
  /** Players standing for friends (human): each day their heroes walk on to where they're heading (Hero.heading), then the day ends. */
  humans?: number[];
  /** Before each of a human's days: where its heroes head now (Hero.heading), e.g. at the computer's hero. */
  steer?: (s: AdventureState, w: World) => void;
  /** Player 0 is a friend away: the caretaker plays its turns (caretaker.ts), not the computer player. */
  caretaker?: boolean;
}


export interface Result {
  /** 0 (wrong) to 1 (right); in between for the right thing too late or only half of it. */
  score: number;
  note: string;
}
export interface Case {
  id: string;
  area: string;
  /** What the right decision is, in words. */
  title: string;
  stage: Stage;
  opt: PlayOptions;
  check: (run: Run) => Result;
}

type Day = Run["days"][number];
/** The first day player 0 satisfies `pred` at the end of, or undefined. */
const firstDay = (run: Run, pred: (d: Day, day: number) => boolean) => {
  for (let d = 1; d < run.days.length; d++) if (run.days[d] && pred(run.days[d], d)) return d;
  return undefined;
};
/** Full marks by day `by`, falling to nothing `slack` days later. */
const byDay = (day: number | undefined, by: number, slack = 3): number => (day === undefined ? 0 : day <= by ? 1 : Math.max(0, 1 - (day - by) / slack));
const dayText = (d: number | undefined, what: string) => (d === undefined ? `${what}: never` : `${what}: day ${d}`);
/** Player 0's events of a kind, as { day, ev }. */
const events = <K extends string>(run: Run, kind: K) => run.events.filter((x) => x.ev.e === kind) as { day: number; ev: Extract<Run["events"][number]["ev"], { e: K }> }[];
/** The day player 0's hero visited an object (a visit, a pickup or a flag). */
const visitedDay = (run: Run, object: number, hero?: number) => {
  const hit = run.events.find(({ ev }) => (ev.e === "visit" || ev.e === "pickup" || ev.e === "dwelling" || ev.e === "flag") && "object" in ev && ev.object === object && (hero === undefined || !("hero" in ev) || ev.hero === hero));
  return hit?.day;
};
const lostFights = (run: Run) => events(run, "battleResult").filter((x) => !x.ev.won);
const wonFights = (run: Run) => events(run, "battleResult").filter((x) => x.ev.won);

/** The tile a hero stands on to visit a staged object (its index in the map is its id in the game). */
const visitIndex = (w: World, s: AdventureState, object: number) => {
  const o = s.objects[object];
  return visitTile(w, o);
};
/** Moves a hero. */
const place = (h: Hero, x: number, y: number) => {
  h.x = x;
  h.y = y;
};
/** The rival's hero (it starts in the corner town), moved out into the open with an army. */
const rivalHero = (s: AdventureState, x: number, y: number, army: (ArmySlot | null)[]): Hero => {
  const h = s.heroes.find((e) => !e.removed && e.owner === 1)!;
  place(h, x, y);
  h.army = army;
  return h;
};
const power = (run: Run, h: Hero) => run.w.creatures && h.army.reduce((a, c) => a + (c ? c.count * (run.w.creatures[c.creature]?.aiValue ?? 0) : 0), 0);
const grassFree = 0;


/** Everything to spend, so that gold isn't what decides. */
const rich = (s: AdventureState) => {
  s.players[0].resources = [100, 50, 100, 50, 50, 50, 100000];
};
/** Gold for the day's needs only: no new hero or building muddies the situation. */
const poor = (s: AdventureState) => {
  s.players[0].resources = [20, 10, 20, 10, 10, 10, 1500];
};
/** Gives player 0's hero a decent army and takes the town's own buildings out of the picture (none to recruit). */

export function strategyCases(data: GameData): Case[] {
  const out: Case[] = [];
  const creature = (name: string): number => {
    const i = data.creatures.findIndex((c) => c.name === name || c.plural === name);
    if (i < 0) throw new Error(`no creature ${name}`);
    return i;
  };
  const armyOf = (...list: [string, number][]): (ArmySlot | null)[] => [...list.map(([n, count]) => ({ creature: creature(n), count })), ...Array(7 - list.length).fill(null)];
  const base = () => new Stage(data, 40);
  const standard = (terrain?: (st: Stage) => void) => {
    const st = base();
    terrain?.(st);
    st.town(0, CASTLE, 6, 8);
    st.corner(1);
    return st;
  };
  const add = (c: Case) => out.push(c);
  /**
   * The computer plays from a player's view (aiView.ts): a case about what it does with what it knows (an order to take
   * things in, a spell or boat to use), not about finding it, shows it the map first, as scouts or View Earth would
   * have. (Heading for a prize seen across unexplored ground is a gap of its own: ROADMAP, the fair computer.)
   */
  const known = (s: AdventureState) => void s.players[0].revealed.fill(-1);

  // ---- Expansion: what to take, in what order.
  {
    const st = standard();
    const town = st.town(-1, CASTLE, 22, 8);
    const mine = st.mine(ORE, 6, 24);
    add({
      id: "expand-town-before-mine",
      area: "Expansion",
      title: "An undefended town is taken before a mine of the same distance",
      stage: st,
      opt: { days: 4, setup: (s) => (rich(s), known(s)) },
      check: (run) => {
        const t = firstDay(run, (d) => d.towns.includes(town));
        const m = firstDay(run, (d) => d.owned.includes(mine));
        const score = t === undefined ? 0 : t <= 3 ? (m !== undefined && m < t ? 0.5 : 1) : 0.3;
        return { score, note: `${dayText(t, "town")}, ${dayText(m, "mine")}` };
      },
    });
  }
  {
    const st = standard();
    const mines = [st.mine(WOOD, 22, 8), st.mine(GOLD, 6, 24), st.mine(CRYSTAL, 22, 24)];
    add({
      id: "expand-three-mines",
      area: "Expansion",
      title: "Three unguarded mines a day or two away are all flagged within four days",
      stage: st,
      opt: { days: 4, setup: rich },
      check: (run) => {
        const last = run.days[4] ?? run.days[run.days.length - 1];
        const n = mines.filter((m) => last.owned.includes(m)).length;
        return { score: n / 3, note: `${n} of 3 flagged by day 4` };
      },
    });
  }
  {
    const st = standard();
    const spots = [[10, 10], [13, 8], [12, 14], [8, 15], [5, 13], [15, 11]];
    const piles = spots.map(([x, y], i) => st.resource(i % 6, 5, x, y));
    add({
      id: "expand-pick-up-nearby",
      area: "Expansion",
      title: "Six resource piles within a few tiles of the town are all picked up within two days",
      stage: st,
      opt: { days: 2, setup: rich },
      check: (run) => {
        const got = piles.filter((p) => visitedDay(run, p) !== undefined).length;
        return { score: Math.min(1, got / 5), note: `${got} of 6 piles picked up by day 2` };
      },
    });
  }
  {
    const st = standard();
    const pile = st.resource(GOLD, 5000, 30, 30);
    add({
      id: "expand-explore-fog",
      area: "Expansion",
      title: "With nothing in sight the heroes scout: over half the map seen by day 4, and the pile in the far corner found by day 6",
      stage: st,
      opt: { days: 6, setup: rich },
      check: (run) => {
        const d = visitedDay(run, pile);
        const seen = (run.days[4]?.seen ?? 0) / (40 * 40);
        return { score: 0.5 * Math.min(1, seen / 0.55) + 0.5 * byDay(d, 6, 2), note: `${(seen * 100).toFixed(0)}% of the map seen by day 4, ${dayText(d, "far pile picked up")}` };
      },
    });
  }
  {
    const st = standard();
    const mine = st.mine(GOLD, 22, 8);
    st.monster("Pikeman", 6, 22, 9);
    add({
      id: "expand-weak-guard",
      area: "Expansion",
      title: "A mine behind a few weak guards is won and flagged",
      stage: st,
      opt: { days: 4, setup: rich },
      check: (run) => {
        const d = firstDay(run, (x) => x.owned.includes(mine));
        return { score: byDay(d, 3), note: `${dayText(d, "mine")}, ${wonFights(run).length} fights won` };
      },
    });
  }
  {
    const st = standard();
    st.mine(GOLD, 22, 8);
    st.monster("Black Dragon", 12, 22, 9);
    const free = st.mine(ORE, 6, 24);
    add({
      id: "expand-skip-strong-guard",
      area: "Expansion",
      title: "A mine behind Black Dragons is left alone; the free mine is taken instead",
      stage: st,
      opt: { days: 5, setup: rich },
      check: (run) => {
        const free_ = firstDay(run, (x) => x.owned.includes(free));
        const lost = lostFights(run).length;
        const score = (lost ? 0 : 0.5) + 0.5 * byDay(free_, 3);
        return { score, note: `${lost ? `lost ${lost} fight(s)` : "no fight lost"}, ${dayText(free_, "free mine")}` };
      },
    });
  }
  {
    const st = standard();
    const wolfDwelling = Number(Object.entries(DWELLINGS).find(([, v]) => v[0] === creature("Wolf Rider"))![0]);
    const dw = st.put(17, wolfDwelling, 22, 8, { owner: -1 });
    add({
      id: "expand-recruit-dwelling",
      area: "Expansion",
      title: "The hero visits a dwelling outside and buys its creatures",
      stage: st,
      opt: { days: 4, setup: rich },
      check: (run) => {
        const id = creature("Wolf Rider");
        const has = [...run.s.heroes.filter((x) => !x.removed && x.owner === 0)].some((x) => x.army.some((c) => c?.creature === id)) || run.s.objects.some((o) => o.town && o.owner === 0 && o.town.garrison.some((c) => c?.creature === id));
        const d = visitedDay(run, dw);
        return { score: has ? byDay(d, 3) : d ? 0.3 : 0, note: `${dayText(d, "dwelling visited")}, ${has ? "wolf riders bought" : "nothing bought"}` };
      },
    });
  }
  {
    const st = standard();
    // Free-joining neutral Pikemen: compliant, they ask nothing.
    const stack = st.monster("Pikeman", 12, 22, 8, { noJoin: false, character: 0, neverFlees: false });
    add({
      id: "expand-free-joiners",
      area: "Expansion",
      title: "Monsters that would join for free are asked and join",
      stage: st,
      opt: {
        days: 4,
        setup: (s, w, h) => {
          rich(s);
          h.army = armyOf(["Archer", 5], ["Griffin", 2]);
        },
      },
      check: (run) => {
        const pike = creature("Pikeman");
        const got = run.h.army.reduce((a, c) => a + (c?.creature === pike ? c.count : 0), 0);
        const gone = run.s.objects[stack].removed;
        return { score: got > 0 ? 1 : gone ? 0.5 : 0, note: got > 0 ? `${got} Pikemen joined` : gone ? "stack gone, none joined (fought?)" : "stack left alone" };
      },
    });
  }


  {
    const st = standard();
    const target = st.town(1, CASTLE, 22, 8);
    add({
      id: "expand-capture-weak-enemy-town",
      area: "Expansion",
      title: "A second enemy town with a handful of defenders is attacked and taken within three days",
      stage: st,
      opt: {
        days: 4,
        setup: (s, w, h) => {
          rich(s);
          s.objects[target].town!.garrison = armyOf(["Pikeman", 4]);
          h.army = armyOf(["Halberdier", 20], ["Archer", 15], ["Griffin", 8]);
        },
      },
      check: (run) => {
        const d = firstDay(run, (x) => x.towns.includes(target));
        return { score: byDay(d, 3, 2), note: dayText(d, "enemy town taken") };
      },
    });
  }
  {
    const st = standard();
    const mine = st.mine(GOLD, 30, 30);
    add({
      id: "expand-no-idle-days",
      area: "Expansion",
      title: "A lone visible target 34 tiles away is walked to without a day standing still (reached by day 4)",
      stage: st,
      opt: { days: 5, setup: rich },
      check: (run) => {
        const d = firstDay(run, (x) => x.owned.includes(mine));
        return { score: byDay(d, 4, 2), note: dayText(d, "far mine") };
      },
    });
  }

  // ---- Towns: building, recruiting, heroes.
  {
    const st = standard();
    let before: number[] = [];
    add({
      id: "town-build-sensible-day1",
      area: "Towns",
      title: "On day 1 a Castle with money builds what grows the army or the income (a dwelling, the Fort, a hall), not decoration",
      stage: st,
      opt: {
        days: 1,
        setup: (s) => {
          rich(s);
          before = [...s.objects.find((o) => o.town && o.owner === 0)!.town!.built];
        },
      },
      check: (run) => {
        const t = run.s.objects.find((o) => o.town && o.owner === 0)!.town!;
        const added = t.built.filter((b) => !before.includes(b));
        const good = added.some((b) => (b >= B.DWELLING && b < B.DWELLING + 14) || b === B.FORT || b === B.CITADEL || (b > B.VILLAGE_HALL && b <= B.CAPITOL));
        return { score: good ? 1 : added.some((b) => b === B.TAVERN) ? 0.7 : added.length ? 0.3 : 0, note: added.length ? `built building ${added.join(",")} on day 1` : "built nothing on day 1" };
      },
    });
  }
  {
    const st = standard();
    let avail = 0;
    add({
      id: "town-recruit-everything",
      area: "Towns",
      title: "With every dwelling built and gold to spare, all available troops are recruited on day 1",
      stage: st,
      opt: {
        days: 1,
        setup: (s) => {
          rich(s);
          const t = s.objects.find((o) => o.town && o.owner === 0)!.town!;
          for (const b of [B.DWELLING, B.DWELLING + 1, B.DWELLING + 2, B.DWELLING + 3, B.DWELLING + 4, B.FORT]) if (!t.built.includes(b)) t.built.push(b);
          t.available = [20, 14, 10, 7, 5, 3, 1];
          avail = t.available.reduce((a, b) => a + b, 0);
        },
      },
      check: (run) => {
        const t = run.s.objects.find((o) => o.town && o.owner === 0)!.town!;
        const left = t.available.reduce((a, b) => a + b, 0);
        return { score: 1 - left / avail, note: `${avail - left} of ${avail} recruited, ${left} left unbought` };
      },
    });
  }
  {
    const st = standard();
    add({
      id: "town-hire-second-hero",
      area: "Towns",
      title: "With a tavern and gold a second hero is hired within two days",
      stage: st,
      opt: {
        days: 3,
        setup: (s) => {
          rich(s);
          const t = s.objects.find((o) => o.town && o.owner === 0)!.town!;
          if (!t.built.includes(B.TAVERN)) t.built.push(B.TAVERN);
        },
      },
      check: (run) => {
        const d = firstDay(run, (x) => x.heroes.length >= 2);
        return { score: byDay(d, 2, 2), note: dayText(d, "second hero") };
      },
    });
  }
  {
    const st = standard();
    add({
      id: "town-keep-army-together",
      area: "Towns",
      title: "A second hero is not handed half the main army (the main hero keeps most of its strength)",
      stage: st,
      opt: {
        days: 3,
        setup: (s, w, h) => {
          rich(s);
          h.army = armyOf(["Archer", 30], ["Griffin", 14], ["Swordsman", 8], ["Pikeman", 20]);
          // A second hero, empty-handed, in the town beside the first.
          const second = makeHero(s, data, 10, 0, h.x, h.y, h.z, armyOf(["Pikeman", 1]));
          s.heroes.push(second);
        },
      },
      check: (run) => {
        const mine = run.s.heroes.filter((x) => !x.removed && x.owner === 0);
        const ps = mine.map((x) => power(run, x)).sort((a, b) => b - a);
        const total = ps.reduce((a, b) => a + b, 0);
        const share = total ? ps[0] / total : 0;
        return { score: Math.min(1, share / 0.7), note: `strongest hero holds ${(share * 100).toFixed(0)}% of the field armies' worth (${ps.map((p) => Math.round(p)).join(" / ")})` };
      },
    });
  }
  {
    const st = standard();
    add({
      id: "town-economy-first-week",
      area: "Towns",
      title: "In the first week a rich town builds a Town Hall, a Fort and at least four dwellings",
      stage: st,
      opt: {
        days: 7,
        setup: (s) => {
          s.players[0].resources = [60, 30, 60, 30, 30, 30, 30000];
        },
      },
      check: (run) => {
        const t = run.s.objects.find((o) => o.town && o.owner === 0)!.town!;
        const dw = t.built.filter((b) => b >= B.DWELLING && b < B.DWELLING + 14).length;
        const hall = t.built.some((b) => b >= B.VILLAGE_HALL && b <= B.CAPITOL && b > B.VILLAGE_HALL);
        const fort = t.built.includes(B.FORT);
        const score = (Math.min(dw, 4) / 4) * 0.5 + (hall ? 0.25 : 0) + (fort ? 0.25 : 0);
        return { score, note: `${dw} dwellings, town hall ${hall ? "yes" : "no"}, fort ${fort ? "yes" : "no"}` };
      },
    });
  }

  // ---- Danger: when to fight, when to run, when to hold.
  {
    const st = standard();
    add({
      id: "danger-flee-stronger-hero",
      area: "Danger",
      title: "A weak hero in the open, an enemy with dragons eight tiles off: it doesn't die",
      stage: st,
      opt: {
        days: 4,
        setup: (s, w, h) => {
          rich(s);
          place(h, 20, 20);
          h.army = armyOf(["Pikeman", 8], ["Archer", 3]);
          rivalHero(s, 28, 20, armyOf(["Black Dragon", 12], ["Archer", 20]));
        },
      },
      check: (run) => {
        const alive = !run.h.removed;
        return { score: alive ? 1 : 0, note: alive ? `alive on day ${run.days.length - 1}` : "hero lost", };
      },
    });
  }
  {
    const st = standard();
    let town = 0;
    add({
      id: "danger-hold-the-capital",
      area: "Danger",
      title: "An enemy hero stronger than our hero alone but weaker than hero plus garrison and walls: the capital holds",
      stage: st,
      opt: {
        days: 6,
        setup: (s, w, h) => {
          rich(s);
          const o = s.objects.find((x) => x.town && x.owner === 0)!;
          town = o.id;
          for (const b of [B.FORT, B.CITADEL, B.DWELLING]) if (!o.town!.built.includes(b)) o.town!.built.push(b);
          o.town!.garrison = armyOf(["Halberdier", 25], ["Archer", 18]);
          h.army = armyOf(["Swordsman", 10], ["Griffin", 6]);
          rivalHero(s, 22, 8, armyOf(["Griffin", 30], ["Swordsman", 14]));
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        const alive = !run.h.removed;
        return { score: (kept ? 0.7 : 0) + (alive ? 0.3 : 0), note: `capital ${kept ? "held" : "LOST"}, hero ${alive ? "alive" : "lost"}` };
      },
    });
  }
  {
    const st = standard();
    const fortress = st.town(-1, CASTLE, 22, 8);
    add({
      id: "danger-no-suicide-siege",
      area: "Danger",
      title: "A walled enemy town with a big garrison is not stormed by a small army",
      stage: st,
      opt: {
        days: 4,
        setup: (s, w, h) => {
          rich(s);
          const o = s.objects[fortress];
          o.town!.built.push(B.FORT);
          o.town!.garrison = armyOf(["Halberdier", 30], ["Archer", 25], ["Griffin", 12]);
          h.army = armyOf(["Pikeman", 14], ["Archer", 6]);
        },
      },
      check: (run) => {
        const lost = lostFights(run).length;
        const alive = !run.h.removed;
        return { score: lost || !alive ? 0 : 1, note: lost ? `attacked and lost (${lost})` : alive ? "left the town alone" : "hero lost" };
      },
    });
  }
  {
    const st = standard();
    add({
      id: "danger-kill-weak-hero",
      area: "Danger",
      title: "A rival hero with three Pikemen wandering near is attacked and beaten",
      stage: st,
      opt: {
        days: 4,
        setup: (s, w, h) => {
          rich(s);
          h.army = armyOf(["Halberdier", 20], ["Griffin", 8], ["Archer", 15]);
          rivalHero(s, 22, 12, armyOf(["Pikeman", 3]));
          known(s);
        },
      },
      check: (run) => {
        const e = run.s.heroes.find((x) => x.owner === 1)!;
        const dead = !!e.removed || e.retired;
        const d = dead ? events(run, "battleResult").find((x) => x.ev.won && x.ev.defender !== undefined)?.day : undefined;
        return { score: dead ? byDay(d ?? 4, 3, 2) : 0, note: dead ? `rival hero beaten${d ? ` on day ${d}` : ""}` : "rival hero left alone" };
      },
    });
  }
  {
    const st = standard();
    // A vault of troops behind guards too strong: the way to the other half of the map is open.
    const treasure = st.resource(GOLD, 3000, 34, 8);
    st.monster("Black Dragon", 10, 33, 8);
    const safe = st.resource(GEMS, 8, 6, 28);
    add({
      id: "danger-ignore-bait",
      area: "Danger",
      title: "A rich pile behind a dragon stack is not worth dying for; the safe pile is taken",
      stage: st,
      opt: { days: 5, setup: rich },
      check: (run) => {
        const lost = lostFights(run).length;
        const d = visitedDay(run, safe);
        void treasure;
        return { score: (lost ? 0 : 0.5) + 0.5 * byDay(d, 3), note: `${lost ? "lost a fight" : "no fight lost"}, ${dayText(d, "safe pile")}` };
      },
    });
  }

  // ---- Boosters: who visits what.
  {
    const st = standard();
    const camps = [st.put(51, 0, 16, 8), st.put(23, 0, 6, 22), st.put(61, 0, 20, 20)];
    add({
      id: "boost-stat-shrines",
      area: "Boosters",
      title: "Three stat shrines within a day or two are all visited within three days",
      stage: st,
      opt: { days: 3, setup: rich },
      check: (run) => {
        const got = camps.filter((c) => visitedDay(run, c) !== undefined).length;
        return { score: got / 3, note: `${got} of 3 shrines visited` };
      },
    });
  }
  {
    const st = standard();
    const star = st.put(61, 0, 18, 8);
    let strong = -1;
    add({
      id: "boost-main-hero-first",
      area: "Boosters",
      title: "With two heroes at home the strong one, not the novice, drinks from the Star Axis",
      stage: st,
      opt: {
        days: 3,
        setup: (s, w, h) => {
          rich(s);
          h.army = armyOf(["Halberdier", 30], ["Archer", 20], ["Griffin", 10]);
          strong = h.id;
          const second = makeHero(s, data, 10, 0, h.x, h.y, h.z, armyOf(["Pikeman", 1]));
          s.heroes.push(second);
        },
      },
      check: (run) => {
        const by = run.events.find(({ ev }) => ev.e === "visit" && ev.object === star);
        if (!by) return { score: 0, note: "the shrine was not visited" };
        const who = (by.ev as { hero: number }).hero;
        return { score: who === strong ? 1 : 0.3, note: `visited by the ${who === strong ? "main" : "second"} hero on day ${by.day}` };
      },
    });
  }

  // ---- Water.
  {
    // Our island (x 0-13, y 0-17) in a sea, a boat at its shore, a small island east with the mine.
    const st = standard((t) => t.paint(Terrain.WATER, 0, 0, 39, 39).paint(Terrain.GRASS, 0, 0, 13, 17).paint(Terrain.GRASS, 18, 5, 24, 14));
    st.put(Obj.BOAT, 0, 14, 9);
    const mine = st.mine(GOLD, 20, 10);
    add({
      id: "water-cross-by-boat",
      area: "Water",
      title: "A gold mine on the far side of a strait, a boat at the shore: the hero sails across and flags it",
      stage: st,
      opt: { days: 6, setup: (s) => (rich(s), known(s)) },
      check: (run) => {
        const d = firstDay(run, (x) => x.owned.includes(mine));
        return { score: byDay(d, 4), note: dayText(d, "far mine") };
      },
    });
  }
  {
    const st = standard((t) => t.paint(Terrain.WATER, 0, 0, 39, 39).paint(Terrain.GRASS, 0, 0, 8, 17).paint(Terrain.GRASS, 13, 5, 20, 14));
    const mine = st.mine(GOLD, 17, 10);
    add({
      id: "water-build-a-boat",
      area: "Water",
      title: "The only mine lies across a strait and the town has a shipyard site: a boat is built and the mine flagged",
      stage: st,
      opt: {
        days: 8,
        setup: (s) => {
          rich(s);
          known(s);
          const t = s.objects.find((o) => o.town && o.owner === 0)!.town!;
          if (!t.built.includes(B.SHIPYARD)) t.built.push(B.SHIPYARD);
        },
      },
      check: (run) => {
        const d = firstDay(run, (x) => x.owned.includes(mine));
        const built = run.s.objects.some((o) => o.type === Obj.BOAT && !o.removed);
        return { score: byDay(d, 5, 2), note: `${dayText(d, "far mine")}, boat ${built ? "built" : "not built"}` };
      },
    });
  }

  // ---- Allies.
  {
    const st = standard();
    const ally = st.town(2, CASTLE, 22, 8);
    add({
      id: "ally-leave-ally-alone",
      area: "Allies",
      title: "An allied town next door is not attacked or flagged",
      stage: st,
      opt: { days: 4, players: 3, teams: [0, 1, 0], setup: rich },
      check: (run) => {
        const fights = events(run, "battle").filter((x) => run.s.objects[x.ev.object]?.owner === 2 || x.ev.object === ally);
        const kept = run.s.objects[ally].owner === 2;
        return { score: fights.length === 0 && kept ? 1 : 0, note: fights.length || !kept ? "attacked the ally" : "left the ally alone" };
      },
    });
  }
  {
    const st = standard();
    const ally = st.town(2, CASTLE, 20, 8);
    add({
      id: "ally-rescue",
      area: "Allies",
      title: "A strong enemy hero marches on an allied town: ours comes to help (the town still stands, or the enemy falls, by day 4)",
      stage: st,
      opt: {
        days: 4,
        players: 3,
        teams: [0, 1, 0],
        setup: (s, w, h) => {
          rich(s);
          h.army = armyOf(["Halberdier", 30], ["Griffin", 14], ["Archer", 25]);
          const home = s.objects.find((x) => x.town && x.owner === 0)!.town!;
          home.built.push(B.FORT);
          home.garrison = armyOf(["Halberdier", 40], ["Archer", 30]);
          rivalHero(s, 34, 8, armyOf(["Griffin", 20], ["Swordsman", 10]));
          const o = s.objects[ally];
          o.town!.garrison = armyOf(["Pikeman", 6]);
        },
      },
      check: (run) => {
        const at = run.s.objects[ally];
        const near = firstDay(run, (d) => d.heroes.some((x) => Math.max(Math.abs(x.x - at.x), Math.abs(x.y - at.y)) <= 4));
        const standing = run.s.objects[ally].owner === 2;
        const enemy = run.s.heroes.find((x) => x.owner === 1)!;
        const saved = standing || !!enemy.removed;
        return { score: (saved ? 0.5 : 0) + (near !== undefined ? 0.5 : 0), note: `${dayText(near, "our hero near the ally's town")}, ally's town ${standing ? "still stands" : "fell"}${enemy.removed ? ", enemy hero beaten" : ""}` };
      },
    });
  }

  // ---- Known weak spots of the original's and common AIs: staged, the good move scored.
  {
    // A scout meets a strong hero on the road; the good move is past it, to the undefended town behind.
    const st = standard();
    const town = st.town(-1, CASTLE, 30, 8);
    add({
      id: "trick-slip-past-hero",
      area: "Known weak spots",
      title: "A scout meets a strong enemy hero: it doesn't run home, it slips past and takes the undefended town behind (and survives)",
      stage: st,
      opt: {
        days: 6,
        setup: (s, w, h) => {
          poor(s);
          h.army = armyOf(["Pikeman", 6]);
          place(h, 14, 8);
          rivalHero(s, 22, 8, armyOf(["Black Dragon", 8], ["Archer", 20]));
        },
      },
      check: (run) => {
        const d = firstDay(run, (x) => x.towns.includes(town));
        const alive = !run.h.removed;
        return { score: (d !== undefined ? 0.7 * byDay(d, 4, 2) : 0) + (alive ? 0.3 : 0), note: `${dayText(d, "town behind the hero")}, scout ${alive ? "alive" : "lost"}` };
      },
    });
  }
  {
    // The hero is far away with Town Portal; the capital is about to be stormed.
    const st = standard();
    let town = 0;
    add({
      id: "trick-town-portal-defence",
      area: "Known weak spots",
      title: "The hero is two days from a capital that an enemy is about to storm: it casts Town Portal home and the capital holds",
      stage: st,
      opt: {
        days: 5,
        setup: (s, w, h) => {
          poor(s);
          const o = s.objects.find((x) => x.town && x.owner === 0)!;
          town = o.id;
          o.town!.built.push(B.FORT);
          o.town!.garrison = armyOf(["Halberdier", 12], ["Archer", 10]);
          place(h, 30, 30);
          h.army = armyOf(["Swordsman", 18], ["Griffin", 10], ["Archer", 20]);
          h.spells = [SPELL.TOWN_PORTAL];
          h.mana = 60;
          rivalHero(s, 14, 8, armyOf(["Griffin", 24], ["Swordsman", 12]));
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        const cast = run.events.some(({ ev }) => ev.e === "spell" && ev.spell === SPELL.TOWN_PORTAL);
        return { score: (kept ? 0.6 : 0) + (cast ? 0.4 : 0), note: `capital ${kept ? "held" : "LOST"}, Town Portal ${cast ? "cast" : "not cast"}` };
      },
    });
  }
  {
    // An empty capital: the one hero walks off while an enemy marches two days away.
    const st = standard();
    let town = 0;
    add({
      id: "trick-empty-capital",
      area: "Known weak spots",
      title: "An enemy hero two days away, stronger than the hero alone but not than hero plus walls: the hero stays and holds the capital",
      stage: st,
      opt: {
        days: 5,
        setup: (s, w, h) => {
          poor(s);
          town = s.objects.find((x) => x.town && x.owner === 0)!.id;
          s.objects[town].town!.garrison = [null, null, null, null, null, null, null];
          s.objects[town].town!.built.push(B.FORT);
          h.army = armyOf(["Swordsman", 14], ["Archer", 16], ["Griffin", 8]);
          rivalHero(s, 30, 8, armyOf(["Griffin", 18], ["Swordsman", 14]));
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        return { score: kept ? 1 : 0, note: `capital ${kept ? "held" : "LOST"}` };
      },
    });
  }
  {
    // Passing an army along: a second hero must bring the week's troops to the far main hero.
    const st = standard();
    add({
      id: "trick-chain-troops",
      area: "Known weak spots",
      title: "New troops wait in the capital, the main hero is far off: a second hero carries them to it (the main army grows by day 4)",
      stage: st,
      opt: {
        days: 4,
        setup: (s, w, h) => {
          rich(s);
          const o = s.objects.find((x) => x.town && x.owner === 0)!.town!;
          for (const b of [B.DWELLING, B.DWELLING + 1, B.DWELLING + 2]) if (!o.built.includes(b)) o.built.push(b);
          o.available = [20, 14, 10, 0, 0, 0, 0];
          place(h, 26, 20);
          h.army = armyOf(["Halberdier", 10]);
          h.id;
          const second = makeHero(s, data, 10, 0, 6, 8, 0, armyOf(["Pikeman", 1]));
          s.heroes.push(second);
        },
      },
      check: (run) => {
        const main = run.s.heroes.filter((x) => !x.removed && x.owner === 0).map((x) => power(run, x)).sort((a, b) => b - a)[0];
        return { score: Math.min(1, main / 4000), note: `strongest hero's army worth ${Math.round(main)} (4000 needed)` };
      },
    });
  }
  {
    // Weekly growth: the creatures come on day 8; the hero is 10 tiles off on day 7.
    const st = standard();
    add({
      id: "trick-weekly-growth",
      area: "Known weak spots",
      title: "The week's new troops appear on day 8: the hero is back at the town by day 9 and recruits them",
      stage: st,
      opt: {
        days: 9,
        setup: (s, w, h) => {
          rich(s);
          s.day = 7;
          const o = s.objects.find((x) => x.town && x.owner === 0)!.town!;
          for (const b of [B.DWELLING, B.DWELLING + 1, B.DWELLING + 2, B.DWELLING + 3]) if (!o.built.includes(b)) o.built.push(b);
          o.available = [0, 0, 0, 0, 0, 0, 0];
          place(h, 18, 8);
        },
      },
      check: (run) => {
        const t = run.s.objects.find((x) => x.town && x.owner === 0)!.town!;
        const left = t.available.reduce((a, b) => a + b, 0);
        return { score: left === 0 ? 1 : 0.2, note: left === 0 ? "the new week's troops were recruited" : `${left} troops left unrecruited at the end` };
      },
    });
  }
  {
    // A rock wall across the map: only Dimension Door gets through.
    const st = standard((t) => t.wallCol(14));
    const mine = st.mine(GOLD, 18, 10);
    add({
      id: "trick-dimension-door",
      area: "Known weak spots",
      title: "A rock wall splits the map and the hero knows Dimension Door: it jumps over and flags the mine behind",
      stage: st,
      opt: {
        days: 4,
        setup: (s, w, h) => {
          rich(s);
          known(s);
          h.spells = [SPELL.DIMENSION_DOOR];
          h.mana = 80;
          place(h, 11, 9);
        },
      },
      check: (run) => {
        const d = firstDay(run, (x) => x.owned.includes(mine));
        return { score: byDay(d, 3, 2), note: dayText(d, "mine behind the wall") };
      },
    });
  }
  {
    const st = standard((t) => t.paint(Terrain.WATER, 0, 0, 39, 39).paint(Terrain.GRASS, 0, 0, 12, 17).paint(Terrain.GRASS, 17, 5, 24, 14));
    const mine = st.mine(GOLD, 20, 10);
    add({
      id: "trick-fly-over-water",
      area: "Known weak spots",
      title: "The mine is on an island, no boat anywhere, and the hero knows Fly: it flies over and flags it",
      stage: st,
      opt: {
        days: 4,
        setup: (s, w, h) => {
          rich(s);
          known(s);
          h.spells = [SPELL.FLY];
          h.mana = 80;
        },
      },
      check: (run) => {
        const d = firstDay(run, (x) => x.owned.includes(mine));
        return { score: byDay(d, 3, 2), note: dayText(d, "island mine") };
      },
    });
  }
  {
    // Feeding the enemy: attacking a far stronger rival hero gives it the experience.
    const st = standard();
    add({
      id: "trick-dont-feed-experience",
      area: "Known weak spots",
      title: "A weak hero is not thrown at a strong rival hero that walks up to it (no lost fight)",
      stage: st,
      opt: {
        days: 4,
        setup: (s, w, h) => {
          rich(s);
          place(h, 18, 8);
          h.army = armyOf(["Pikeman", 12], ["Archer", 6]);
          rivalHero(s, 26, 8, armyOf(["Griffin", 30], ["Swordsman", 20]));
        },
      },
      check: (run) => {
        const lost = lostFights(run).length;
        return { score: lost ? 0 : 1, note: lost ? `${lost} fight(s) lost against the stronger hero` : "no fight lost" };
      },
    });
  }
  // ---- Allies: absent friends (an allied computer player, the caretaker playing a friend's turn).
  {
    // A friend's hero (player 2, human) is on its way to the gold; ours is as near and moves first.
    const st = standard();
    st.town(2, CASTLE, 22, 8);
    const theirs = st.resource(GOLD, 3000, 11, 8);
    const ours = st.resource(GOLD, 500, 6, 14);
    add({
      id: "ally-leave-friends-target",
      area: "Allies",
      title: "An allied human's hero is heading for a pile: the allied computer leaves it to them and takes its own",
      stage: st,
      opt: {
        days: 3,
        players: 3,
        teams: [0, 1, 0],
        humans: [2],
        setup: (s, w) => {
          const friend = s.heroes.find((x) => !x.removed && x.owner === 2)!;
          if (s.day === 1 && friend.heading === undefined) friend.heading = visitIndex(w, s, theirs);
        },
      },
      check: (run) => {
        const took = visitedDay(run, theirs);
        const own = visitedDay(run, ours);
        return { score: (took === undefined ? 0.7 : 0) + (own !== undefined ? 0.3 : 0), note: `friend's pile ${took === undefined ? "left to them" : `TAKEN day ${took}`}, own pile ${own === undefined ? "not taken" : `day ${own}`}` };
      },
    });
  }
  {
    // Free piles in a day's walk, one behind a monster: the caretaker takes the free ones, fights nothing, builds nothing.
    const st = standard();
    const free = [st.resource(GOLD, 500, 9, 8), st.resource(WOOD, 5, 6, 11)];
    const guarded = st.resource(GOLD, 2000, 12, 12);
    st.monster("Pikeman", 8, 12, 11);
    let built = 0;
    add({
      id: "ally-caretaker-safe-turn",
      area: "Allies",
      title: "The caretaker plays a friend's turn: free pickups taken, no fight, nothing built, the town's creatures recruited",
      stage: st,
      opt: {
        days: 2,
        caretaker: true,
        setup: (s, w, h) => {
          if (s.day > 1) return;
          poor(s);
          h.army = armyOf(["Halberdier", 30], ["Archer", 20]);
          built = s.objects.find((o) => o.town && o.owner === 0)!.town!.built.length;
        },
      },
      check: (run) => {
        const taken = free.filter((i) => visitedDay(run, i) !== undefined).length;
        const town = run.s.objects.find((o) => o.town && o.owner === 0)!;
        const same = town.town!.built.length === built;
        const fought = run.fights.length;
        const recruited = town.town!.garrison.some((x) => x) || run.h.army.some((x) => x && x.creature === creature("Pikeman"));
        const score = (taken / free.length) * 0.4 + (fought ? 0 : 0.3) + (same ? 0.15 : 0) + (recruited ? 0.15 : 0);
        return { score, note: `${taken}/${free.length} free piles, ${fought} fight(s), ${same ? "nothing built" : "BUILT"}, ${recruited ? "recruited" : "nothing recruited"}${visitedDay(run, guarded) !== undefined ? ", took the guarded pile" : ""}` };
      },
    });
  }
  {
    // A stronger rival a day off the town: the caretaker's hero stays home behind the walls (the pile outside can wait).
    const st = standard();
    const pile = st.resource(GOLD, 1000, 10, 8);
    add({
      id: "ally-caretaker-stays-home",
      area: "Allies",
      title: "A stronger rival a day from the town: the caretaker keeps the friend's hero home, alive",
      stage: st,
      opt: {
        days: 3,
        caretaker: true,
        setup: (s, w, h) => {
          if (s.day > 1) return;
          rich(s);
          const o = s.objects.find((x) => x.town && x.owner === 0)!;
          for (const b of [B.FORT, B.CITADEL]) if (!o.town!.built.includes(b)) o.town!.built.push(b);
          o.town!.garrison = armyOf(["Halberdier", 30], ["Archer", 25]);
          h.army = armyOf(["Swordsman", 8], ["Griffin", 5]);
          rivalHero(s, 16, 8, armyOf(["Griffin", 20], ["Swordsman", 12]));
          known(s);
        },
      },
      check: (run) => {
        const alive = !run.h.removed;
        const out = visitedDay(run, pile);
        return { score: (alive ? 0.6 : 0) + (out === undefined ? 0.4 : 0), note: `hero ${alive ? "alive" : "LOST"}, ${out === undefined ? "stayed home" : `walked out for the pile day ${out}`}` };
      },
    });
  }
  void [grassFree, MERCURY, SULFUR, wonFights];

  // ---- Against a player: basic encounters with a human (player 1 walks where its heroes are heading,
  // set each day by `steer`); the computer (player 0) sees the whole map, so it sees them coming.
  const seeAll = (s: AdventureState) => s.players[0].revealed.fill(-1);
  const human = (s: AdventureState, x: number, y: number, army: (ArmySlot | null)[]) => {
    const r = rivalHero(s, x, y, army);
    s.players[1].resources = [0, 0, 0, 0, 0, 0, 0];
    return r;
  };
  const heroOf = (s: AdventureState, p: number) => s.heroes.find((x) => !x.removed && x.owner === p);
  const capital = (s: AdventureState) => s.objects.find((x) => x.town && x.owner === 0)!.id;
  /** The human's field hero (the one put out in the open) is beaten: it no longer stands on the map. */
  const intruderBeaten = (run: Run, id: number) => !!run.s.heroes[id]?.removed || run.s.heroes[id]?.owner !== 1;
  {
    // The owner's story: a small army walks up to the town in plain sight; the hero in it rides off for a
    // pile and the town falls the next day. Staying, beating the intruder or leaving troops all keep it.
    const st = standard();
    st.town(-1, CASTLE, 27, 8);
    let town = 0;
    let foe = -1;
    add({
      id: "vs-human-town-left-empty",
      area: "Against a player",
      title: "A small human army walks at the town in plain sight, an empty neutral town lies the other way: the capital is not left empty for it (beat the intruder first, stay, or leave troops)",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          s.objects[town].town!.garrison = [null, null, null, null, null, null, null];
          h.army = armyOf(["Swordsman", 20], ["Archer", 20], ["Griffin", 10], ["Pikeman", 7]);
          foe = human(s, 6, 30, armyOf(["Pikeman", 12], ["Archer", 6])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = visitIndex(w, s, town);
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        const beaten = intruderBeaten(run, foe);
        return { score: (kept ? 0.7 : 0) + (beaten ? 0.3 : 0), note: `town ${kept ? "kept" : "LOST"}, intruder ${beaten ? "beaten" : "alive"}` };
      },
    });
  }
  {
    // Stronger than the hero in the field, weaker than hero plus walls and towers: stand in the town.
    const st = standard();
    st.resource(GOLD, 3000, 24, 12);
    let town = 0;
    let foe = -1;
    add({
      id: "vs-human-stand-behind-walls",
      area: "Against a player",
      title: "A human army stronger than the hero in the open but not than hero plus walls walks at the town: the hero waits inside and holds",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          const t = s.objects[town].town!;
          t.garrison = [null, null, null, null, null, null, null];
          for (const b of [B.FORT, B.CITADEL]) if (!t.built.includes(b)) t.built.push(b);
          h.army = armyOf(["Swordsman", 14], ["Archer", 18], ["Griffin", 8]);
          foe = human(s, 6, 30, armyOf(["Griffin", 18], ["Swordsman", 16])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = visitIndex(w, s, town);
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        const alive = !run.h.removed && run.h.owner === 0;
        return { score: kept ? 1 : alive ? 0.3 : 0, note: `town ${kept ? "held" : "LOST"}, hero ${alive ? "alive" : "lost"}` };
      },
    });
  }
  {
    // The hero is two days off; the town has a week of creatures and the gold: they guard it.
    const st = standard();
    let town = 0;
    let foe = -1;
    add({
      id: "vs-human-recruit-defenders",
      area: "Against a player",
      title: "The hero is far off and a human army walks at the town: the week's creatures are bought into the garrison and the town holds",
      stage: st,
      opt: {
        days: 3,
        humans: [1],
        setup: (s, w, h) => {
          rich(s);
          seeAll(s);
          const t = s.objects[town].town!;
          t.garrison = [null, null, null, null, null, null, null];
          for (const b of [B.FORT, B.DWELLING, B.DWELLING + 1, B.DWELLING + 2]) if (!t.built.includes(b)) t.built.push(b);
          t.available = [24, 16, 10, 0, 0, 0, 0];
          place(h, 34, 8);
          h.army = armyOf(["Swordsman", 10], ["Archer", 10]);
          foe = human(s, 6, 26, armyOf(["Pikeman", 14], ["Archer", 8])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = visitIndex(w, s, town);
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        return { score: kept ? 1 : 0, note: `town ${kept ? "held" : "LOST"}` };
      },
    });
  }
  {
    // A human hero took our second town and walked on: take it back.
    const st = standard();
    const second = st.town(1, CASTLE, 22, 12);
    let foe = -1;
    add({
      id: "vs-human-retake-town",
      area: "Against a player",
      title: "A human hero took the second town and walked on, leaving it empty: the hero a day off takes it back by day 2",
      stage: st,
      opt: {
        days: 3,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          s.objects[second].town!.garrison = [null, null, null, null, null, null, null];
          h.army = armyOf(["Swordsman", 16], ["Archer", 16], ["Griffin", 8]);
          foe = human(s, 30, 22, armyOf(["Pikeman", 10], ["Archer", 5])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = w.index(36, 22, 0);
        },
      },
      check: (run) => {
        const d = firstDay(run, (x) => x.towns.includes(second));
        return { score: byDay(d, 2, 2), note: dayText(d, "town retaken") };
      },
    });
  }
  {
    // A human flagged our mine on the way past: flag it back.
    const st = standard();
    const mine = st.mine(GOLD, 20, 14, 1);
    add({
      id: "vs-human-retake-mine",
      area: "Against a player",
      title: "A human flagged our gold mine a day away and walked on: it is flagged back by day 2",
      stage: st,
      opt: {
        days: 3,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          h.army = armyOf(["Swordsman", 16], ["Archer", 16]);
          human(s, 32, 20, armyOf(["Pikeman", 10], ["Archer", 5])).heading = w.index(36, 22, 0);
        },
      },
      check: (run) => {
        const d = firstDay(run, (x) => x.owned.includes(mine));
        return { score: byDay(d, 2, 2), note: dayText(d, "mine flagged back") };
      },
    });
  }
  {
    // A weak human hero walks through our land to a pile by the town: catch it.
    const st = standard();
    const pile = st.resource(GOLD, 4000, 12, 16);
    let foe = -1;
    add({
      id: "vs-human-catch-intruder",
      area: "Against a player",
      title: "A weak human hero walks across our land for a pile by the town: our strong hero catches and beats it within three days",
      stage: st,
      opt: {
        days: 3,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          h.army = armyOf(["Swordsman", 16], ["Archer", 16], ["Griffin", 8]);
          foe = human(s, 26, 26, armyOf(["Pikeman", 6], ["Archer", 3])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = s.objects[pile].removed ? w.index(36, 22, 0) : visitIndex(w, s, pile);
        },
      },
      check: (run) => {
        const beaten = events(run, "battleResult").find((x) => x.ev.won);
        const humanGot = run.s.objects[pile].removed && visitedDay(run, pile) === undefined;
        const d = beaten?.day;
        return { score: intruderBeaten(run, foe) ? byDay(d ?? 3, 3, 2) : 0, note: `${dayText(d, "intruder beaten")}${humanGot ? ", the human got the pile" : ""}` };
      },
    });
  }
  {
    // A much stronger human hero comes straight at our weak hero in the open: get away (or into a
    // town that holds); being caught is the one wrong answer.
    const st = standard();
    let foe = -1;
    add({
      id: "vs-human-run-from-hunter",
      area: "Against a player",
      title: "A much stronger human hero hunts our weak hero across open ground, a well-garrisoned walled town a day off: the hero takes refuge there and is not caught",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          place(h, 18, 18);
          h.army = armyOf(["Pikeman", 10], ["Archer", 5]);
          // (Open ground and a faster hunter: the walled town with its garrison is the one refuge.)
          const t = s.objects[capital(s)].town!;
          for (const b of [B.FORT, B.CITADEL]) if (!t.built.includes(b)) t.built.push(b);
          t.garrison = armyOf(["Halberdier", 60], ["Marksman", 40], ["Griffin", 24]);
          foe = human(s, 32, 22, armyOf(["Griffin", 20], ["Swordsman", 20], ["Cavalier", 4])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          const prey = heroOf(s, 0);
          if (f && !f.removed && prey) f.heading = w.index(prey.x, prey.y, prey.z);
        },
      },
      check: (run) => {
        const lost = lostFights(run).length + (run.h.removed || run.h.owner !== 0 ? 1 : 0);
        const kept = run.s.objects.some((o) => o.town && o.owner === 0);
        return { score: lost ? 0 : 1, note: `${lost ? "CAUGHT" : "got away"}${kept ? "" : ", town lost"}` };
      },
    });
  }
  {
    // The owner's 10-27 game: the computer's only town taken; its heroes hid for days by the strong hero that
    // took it while the townless days ran out. Townless, a town to take is worth walking past danger.
    const st = base();
    const town = st.town(0, CASTLE, 6, 8);
    st.corner(1);
    add({
      id: "vs-human-townless-retake",
      area: "Against a player",
      title: "Our only town is lost and left empty, a strong human hero standing near the way back: townless, our hero walks past it and takes the town back",
      stage: st,
      opt: {
        days: 5,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          const t = s.objects[town];
          t.owner = 1;
          t.town!.garrison = [null, null, null, null, null, null, null];
          s.players[0].townlessSince = 1;
          place(h, 24, 8);
          h.army = armyOf(["Pikeman", 10], ["Archer", 5]);
          human(s, 14, 12, armyOf(["Griffin", 20], ["Swordsman", 20], ["Cavalier", 4]));
        },
      },
      check: (run) => {
        const d = firstDay(run, (x) => x.towns.includes(town));
        return { score: byDay(d, 3, 2), note: dayText(d, "town retaken") };
      },
    });
  }
  {
    // A human town with walls and a big garrison next to us: don't throw the army at it.
    const st = standard();
    const theirs = st.town(1, CASTLE, 22, 8);
    add({
      id: "vs-human-no-suicide-siege",
      area: "Against a player",
      title: "A human's walled town with a big garrison a day off: our middling army does not storm it",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          rich(s);
          seeAll(s);
          const t = s.objects[theirs].town!;
          for (const b of [B.FORT, B.CITADEL]) if (!t.built.includes(b)) t.built.push(b);
          t.garrison = armyOf(["Halberdier", 30], ["Marksman", 24], ["Griffin", 12]);
          h.army = armyOf(["Swordsman", 12], ["Archer", 12], ["Griffin", 6]);
        },
      },
      check: (run) => {
        const lost = lostFights(run).length;
        const alive = !run.h.removed && run.h.owner === 0;
        return { score: lost || !alive ? 0 : 1, note: lost ? "stormed it and lost" : alive ? "left it alone" : "hero lost" };
      },
    });
  }
  {
    // Two heroes, each weaker than the human coming, together stronger: join up before the fight.
    const st = standard();
    let town = 0;
    let foe = -1;
    add({
      id: "vs-human-join-forces",
      area: "Against a player",
      title: "A human army stronger than either of our two heroes but not both walks at the town: the armies are joined and it is beaten (town kept, no hero lost)",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          s.objects[town].town!.garrison = [null, null, null, null, null, null, null];
          h.army = armyOf(["Swordsman", 12], ["Archer", 14]);
          s.heroes.push(makeHero(s, data, 10, 0, 12, 14, 0, armyOf(["Griffin", 10], ["Pikeman", 20])));
          foe = human(s, 8, 32, armyOf(["Griffin", 10], ["Swordsman", 12], ["Archer", 8])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = visitIndex(w, s, town);
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        const lost = lostFights(run).length;
        const beaten = intruderBeaten(run, foe);
        return { score: beaten && !lost ? 1 : kept && !lost ? 0.6 : kept ? 0.3 : 0, note: `intruder ${beaten ? "beaten" : "alive"}, ${lost} fights lost, town ${kept ? "kept" : "LOST"}` };
      },
    });
  }
  {
    // The owner, 2026-10-27 (A Warm and Familiar Place): three heroes out, each weaker than the human coming at the empty
    // capital, together with its walls stronger; each hid where it stood and the town fell without a fight.
    const st = standard();
    let town = 0;
    let foe = -1;
    const ours: number[] = [];
    add({
      id: "vs-human-hold-together",
      area: "Against a player",
      title: "A human army stronger than each of our three heroes, and than all three in the field, walks at the walled capital: they go home and hold it together behind the walls",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          const o = s.objects[town];
          if (!o.town!.built.includes(B.FORT)) o.town!.built.push(B.FORT);
          o.town!.garrison = [null, null, null, null, null, null, null];
          h.army = armyOf(["Swordsman", 8], ["Archer", 6]);
          place(h, 19, 8);
          ours.length = 0;
          ours.push(h.id);
          for (const [x, y, army] of [[6, 21, armyOf(["Griffin", 8], ["Pikeman", 10])], [17, 18, armyOf(["Halberdier", 12], ["Archer", 6])]] as const) {
            const k = makeHero(s, data, 10 + ours.length, 0, x, y, 0, [...army]);
            s.heroes.push(k);
            ours.push(k.id);
          }
          foe = human(s, 28, 30, armyOf(["Griffin", 12], ["Swordsman", 10], ["Archer", 8])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = visitIndex(w, s, town);
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        const alive = ours.filter((id) => !run.s.heroes[id]?.removed).length;
        return { score: (kept ? 0.7 : 0) + (0.3 * alive) / 3, note: `capital ${kept ? "held" : "LOST"}, ${alive} of 3 heroes alive` };
      },
    });
  }
  {
    // A weak human scout sits a day off the town as bait while a strong one comes from the other side.
    const st = standard();
    let town = 0;
    let bait = -1;
    let foe = -1;
    add({
      id: "vs-human-bait-and-strike",
      area: "Against a player",
      title: "A weak human scout dangles a day east while a strong human army comes from the south: the hero doesn't chase the scout off and lose the town",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          const t = s.objects[town].town!;
          t.garrison = [null, null, null, null, null, null, null];
          for (const b of [B.FORT, B.CITADEL]) if (!t.built.includes(b)) t.built.push(b);
          h.army = armyOf(["Swordsman", 14], ["Archer", 18], ["Griffin", 8]);
          foe = human(s, 6, 32, armyOf(["Griffin", 18], ["Swordsman", 16])).id;
          const b = makeHero(s, data, 20, 1, 26, 8, 0, armyOf(["Pikeman", 2]));
          s.heroes.push(b);
          bait = b.id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = visitIndex(w, s, town);
          const b = s.heroes[bait];
          if (b && !b.removed) b.heading = w.index(b.x === 26 ? 28 : 26, 8, 0);
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        const alive = !run.h.removed && run.h.owner === 0;
        return { score: kept ? 1 : alive ? 0.3 : 0, note: `town ${kept ? "held" : "LOST"}, hero ${alive ? "alive" : "lost"}, bait ${intruderBeaten(run, bait) ? "beaten" : "alive"}` };
      },
    });
  }
  {
    // A stronger human army camps outside the gate and waits: the hero inside doesn't ride out to it.
    const st = standard();
    let town = 0;
    add({
      id: "vs-human-dont-sally-out",
      area: "Against a player",
      title: "A human army stronger than the hero camps by the gate and waits: the hero stays behind the walls (no lost sally, town kept)",
      stage: st,
      opt: {
        days: 3,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          const t = s.objects[town].town!;
          t.garrison = [null, null, null, null, null, null, null];
          for (const b of [B.FORT, B.CITADEL]) if (!t.built.includes(b)) t.built.push(b);
          h.army = armyOf(["Swordsman", 14], ["Archer", 18], ["Griffin", 8]);
          human(s, 9, 11, armyOf(["Griffin", 18], ["Swordsman", 16]));
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        const lost = lostFights(run).length;
        const alive = !run.h.removed && run.h.owner === 0;
        return { score: lost || !alive ? 0 : kept ? 1 : 0.3, note: `${lost ? "rode out and lost" : alive ? "stayed in" : "hero lost"}, town ${kept ? "kept" : "LOST"}` };
      },
    });
  }
  {
    // A human town with no garrison but a strong hero standing in it: the hero counts as defender.
    const st = standard();
    const theirs = st.town(1, CASTLE, 22, 8);
    add({
      id: "vs-human-hero-in-their-town",
      area: "Against a player",
      title: "A human town with an empty garrison but a strong hero inside, a day off: our middling army doesn't storm it",
      stage: st,
      opt: {
        days: 3,
        humans: [1],
        setup: (s, w, h) => {
          rich(s);
          seeAll(s);
          const t = s.objects[theirs].town!;
          t.garrison = [null, null, null, null, null, null, null];
          if (!t.built.includes(B.FORT)) t.built.push(B.FORT);
          const v = visitIndex(w, s, theirs);
          human(s, v % w.size, Math.floor(v / w.size) % w.size, armyOf(["Halberdier", 30], ["Marksman", 24], ["Griffin", 12]));
          h.army = armyOf(["Swordsman", 12], ["Archer", 12], ["Griffin", 6]);
        },
      },
      check: (run) => {
        const lost = lostFights(run).length;
        const alive = !run.h.removed && run.h.owner === 0;
        return { score: lost || !alive ? 0 : 1, note: lost ? "stormed it and lost" : alive ? "left it alone" : "hero lost" };
      },
    });
  }
  {
    // The hero is two days off with Town Portal; a human army walks at the capital.
    const st = standard();
    let town = 0;
    let foe = -1;
    add({
      id: "vs-human-portal-home",
      area: "Against a player",
      title: "The hero is far off with Town Portal and a human army walks at the capital its garrison can't hold: it casts Town Portal home and the town holds",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          const t = s.objects[town].town!;
          if (!t.built.includes(B.FORT)) t.built.push(B.FORT);
          t.garrison = armyOf(["Halberdier", 12], ["Archer", 10]);
          place(h, 30, 30);
          h.army = armyOf(["Swordsman", 18], ["Griffin", 10], ["Archer", 20]);
          h.spells = [SPELL.TOWN_PORTAL];
          h.mana = 60;
          foe = human(s, 8, 26, armyOf(["Griffin", 20], ["Swordsman", 12])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = visitIndex(w, s, town);
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        const cast = run.events.some(({ ev }) => ev.e === "spell" && ev.spell === SPELL.TOWN_PORTAL);
        return { score: (kept ? 0.7 : 0) + (cast ? 0.3 : 0), note: `capital ${kept ? "held" : "LOST"}, Town Portal ${cast ? "cast" : "not cast"}` };
      },
    });
  }
  {
    // The hero passes through a town whose garrison guards it: it doesn't strip the garrison and go.
    const st = standard();
    st.resource(GOLD, 5000, 27, 8);
    let town = 0;
    let foe = -1;
    add({
      id: "vs-human-keep-the-garrison",
      area: "Against a player",
      title: "The hero passes through a town whose garrison is all that stands between it and a human army: it doesn't take the garrison along and leave the town empty",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          const t = s.objects[town].town!;
          if (!t.built.includes(B.FORT)) t.built.push(B.FORT);
          t.garrison = armyOf(["Halberdier", 24], ["Archer", 20]);
          place(h, 2, 8);
          h.army = armyOf(["Swordsman", 10], ["Griffin", 6]);
          foe = human(s, 6, 30, armyOf(["Swordsman", 12], ["Griffin", 10])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = visitIndex(w, s, town);
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        return { score: kept ? 1 : 0, note: `town ${kept ? "kept" : "LOST"}, intruder ${intruderBeaten(run, foe) ? "beaten" : "alive"}` };
      },
    });
  }
  {
    // A stronger human hero stands by a rich pile near us: leave it be.
    const st = standard();
    const pile = st.resource(GOLD, 5000, 16, 12);
    add({
      id: "vs-human-guarded-pile",
      area: "Against a player",
      title: "A stronger human hero stands next to a rich pile a day off: our hero doesn't walk up to it and get beaten",
      stage: st,
      opt: {
        days: 3,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          h.army = armyOf(["Swordsman", 10], ["Archer", 12]);
          human(s, 17, 13, armyOf(["Griffin", 18], ["Swordsman", 16]));
        },
      },
      check: (run) => {
        const lost = lostFights(run).length;
        const alive = !run.h.removed && run.h.owner === 0;
        return { score: lost || !alive ? 0 : 1, note: `${lost ? "fought for it and lost" : alive ? "kept away" : "hero lost"}, pile ${visitedDay(run, pile) ? "taken" : "left"}` };
      },
    });
  }
  {
    // A weak human hero keeps out of reach, a day off: chasing it all week leaves the mines unflagged.
    const st = standard();
    const mines = [st.mine(WOOD, 6, 20), st.mine(ORE, 16, 4), st.mine(GOLD, 18, 14)];
    let foe = -1;
    add({
      id: "vs-human-dont-chase-a-runner",
      area: "Against a player",
      title: "A weak human hero keeps just out of reach: the hero doesn't spend the days chasing it, the three mines near home are flagged by day 4",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          h.army = armyOf(["Swordsman", 14], ["Archer", 14]);
          foe = human(s, 24, 20, armyOf(["Pikeman", 4])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          const us = heroOf(s, 0);
          if (!f || f.removed || !us) return;
          // (Straight away from our hero, a day's walk, inside the map.)
          const [dx, dy] = [f.x - us.x, f.y - us.y];
          const d = Math.max(1, Math.hypot(dx, dy));
          const clamp = (v: number) => Math.max(1, Math.min(w.size - 2, Math.round(v)));
          f.heading = w.index(clamp(f.x + (dx / d) * 12), clamp(f.y + (dy / d) * 12), 0);
        },
      },
      check: (run) => {
        const last = run.days[4] ?? run.days[run.days.length - 1];
        const n = mines.filter((m) => last.owned.includes(m)).length;
        // (Catching it after all is worth a mine.)
        const caught = intruderBeaten(run, foe);
        return { score: Math.min(1, (n + (caught ? 1 : 0)) / 3), note: `${n} of 3 mines by day 4, runner ${caught ? "caught" : "not caught"}` };
      },
    });
  }
  {
    // A long trip: the human is still three days off when the hero leaves, and arrives while it is away.
    const st = standard();
    st.town(-1, CASTLE, 34, 8);
    let town = 0;
    let foe = -1;
    add({
      id: "vs-human-long-trip",
      area: "Against a player",
      title: "The hero sets off on a four-day round trip while a small human army is three days off: troops stay home and the capital holds",
      stage: st,
      opt: {
        days: 5,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          s.objects[town].town!.garrison = [null, null, null, null, null, null, null];
          h.army = armyOf(["Swordsman", 20], ["Archer", 20], ["Griffin", 10], ["Pikeman", 7]);
          foe = human(s, 22, 38, armyOf(["Pikeman", 12], ["Archer", 6])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = visitIndex(w, s, town);
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        return { score: kept ? 1 : 0, note: `capital ${kept ? "kept" : "LOST"}, intruder ${intruderBeaten(run, foe) ? "beaten" : "alive"}` };
      },
    });
  }
  {
    // Rock splits the map; a two-way monolith by our town leads to the human's side.
    const st = standard((x) => x.wallCol(20));
    st.put(45, 0, 11, 13);
    st.put(45, 0, 29, 18);
    st.town(-1, CASTLE, 12, 32);
    let town = 0;
    let foe = -1;
    add({
      id: "vs-human-through-the-portal",
      area: "Against a player",
      title: "Rock walls off the human's side but a monolith by our town leads there: the hero riding off leaves troops, and the human coming through the portal doesn't take the capital",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          s.objects[town].town!.garrison = [null, null, null, null, null, null, null];
          h.army = armyOf(["Swordsman", 20], ["Archer", 20], ["Griffin", 10], ["Pikeman", 7]);
          foe = human(s, 34, 6, armyOf(["Pikeman", 12], ["Archer", 6])).id;
        },
        steer: (s, w) => {
          const f = s.heroes[foe];
          if (f && !f.removed) f.heading = visitIndex(w, s, town);
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        return { score: kept ? 1 : 0, note: `capital ${kept ? "kept" : "LOST"}, intruder ${intruderBeaten(run, foe) ? "beaten" : "alive"}` };
      },
    });
  }
  {
    // A human town two days off, troops in its garrison: a hero hired there on day 2 marches on us.
    const st = standard();
    const theirs = st.town(1, CASTLE, 26, 26);
    st.town(-1, CASTLE, 34, 8);
    let town = 0;
    let fresh = -1;
    add({
      id: "vs-human-new-hero-from-their-town",
      area: "Against a player",
      title: "A human town two days off holds troops; on day 2 a hero hired there takes them at our capital while ours is away: troops stay home and the capital holds",
      stage: st,
      opt: {
        days: 5,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          s.objects[town].town!.garrison = [null, null, null, null, null, null, null];
          s.objects[theirs].town!.garrison = armyOf(["Pikeman", 14], ["Archer", 8]);
          h.army = armyOf(["Swordsman", 20], ["Archer", 20], ["Griffin", 10], ["Pikeman", 7]);
          human(s, 37, 35, armyOf(["Pikeman", 1]));
        },
        steer: (s, w) => {
          if (s.day === 2 && fresh < 0) {
            const t = s.objects[theirs];
            const v = visitIndex(w, s, theirs);
            const hero = makeHero(s, data, 30, 1, v % w.size, Math.floor(v / w.size) % w.size, 0, t.town!.garrison);
            t.town!.garrison = [null, null, null, null, null, null, null];
            s.heroes.push(hero);
            w.refresh(s);
            fresh = hero.id;
          }
          const f = fresh >= 0 ? s.heroes[fresh] : undefined;
          if (f && !f.removed) f.heading = visitIndex(w, s, town);
        },
      },
      check: (run) => {
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        return { score: kept ? 1 : 0, note: `capital ${kept ? "kept" : "LOST"}` };
      },
    });
  }
  {
    // Nothing can reach the capital (the rival is walled in): the hero takes its whole army to a strong town.
    const st = standard();
    const target = st.town(-1, CASTLE, 30, 8);
    let town = 0;
    add({
      id: "vs-human-safe-trip-whole-army",
      area: "Against a player",
      title: "No enemy can reach the capital: the hero takes its whole army and wins a well-guarded town (nothing left idle at home)",
      stage: st,
      opt: {
        days: 4,
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          s.objects[town].town!.garrison = [null, null, null, null, null, null, null];
          s.objects[target].town!.garrison = armyOf(["Halberdier", 18], ["Archer", 14], ["Griffin", 6]);
          h.army = armyOf(["Swordsman", 20], ["Archer", 20], ["Griffin", 10], ["Pikeman", 7]);
        },
      },
      check: (run) => {
        const d = firstDay(run, (x) => x.towns.includes(target));
        // (The hero's own Swordsmen or Griffins left at home; the day's recruits wait there anyway.)
        const idle = run.s.objects[town].town!.garrison.some((c) => c && c.count > 0 && (c.creature === creature("Swordsman") || c.creature === creature("Griffin")));
        return { score: byDay(d, 3, 2) * (idle ? 0.5 : 1), note: `${dayText(d, "town taken")}${idle ? ", troops left idle at home" : ""}` };
      },
    });
  }
  {
    // The owner's game, 2026-10-31 (Brave New World, day 21): the computer's main army walked past his, as strong, for his
    // town, its own town left behind; he struck first. With even armies the good move is to hold its ground.
    const st = standard();
    const theirs = st.town(1, CASTLE, 32, 22);
    let town = 0;
    let foe = -1;
    add({
      id: "vs-human-even-armies-hold",
      area: "Against a player",
      title: "A human army as strong as ours stands between our capital and their empty town: our hero doesn't walk past it for their town (it would strike first, and our capital lies open); it holds its ground",
      stage: st,
      opt: {
        days: 4,
        humans: [1],
        setup: (s, w, h) => {
          poor(s);
          seeAll(s);
          s.objects[town].town!.garrison = [null, null, null, null, null, null, null];
          s.objects[theirs].town!.garrison = [null, null, null, null, null, null, null];
          h.army = armyOf(["Swordsman", 20], ["Archer", 20], ["Griffin", 10]);
          foe = human(s, 20, 15, armyOf(["Swordsman", 20], ["Archer", 20], ["Griffin", 10])).id;
        },
        steer: (s, w) => {
          // (The human strikes at our hero when it comes within a day's walk, else waits.)
          const f = s.heroes[foe];
          const prey = heroOf(s, 0);
          if (!f || f.removed) return;
          f.heading = prey && Math.max(Math.abs(prey.x - f.x), Math.abs(prey.y - f.y)) <= 9 && !w.visitBy[w.index(prey.x, prey.y, prey.z)] ? w.index(prey.x, prey.y, prey.z) : undefined;
        },
      },
      check: (run) => {
        const caught = events(run, "battleResult").length > 0 || run.h.removed || run.h.owner !== 0;
        const kept = run.s.objects[town].owner === 0 && !run.lostTowns?.some((x) => x.object === town);
        return { score: (caught ? 0 : 0.6) + (kept ? 0.4 : 0), note: `${caught ? "met in the open" : "kept out of its reach"}, capital ${kept ? "kept" : "LOST"}` };
      },
    });
  }
  return out;
}

/** "strategy:<case id>": the case's map, to play by hand or watch the computer play ("&ai=<days>"). */
export function parseStrategyName(file: string): string | null {
  return file.startsWith("strategy:") ? file.slice(9) : null;
}
export const strategyName = (id: string) => `strategy:${id}`;

/** The case's map (its allies set in the players' teams). */
export function generateStrategy(data: GameData, file: string): H3Map {
  const c = strategyCases(data).find((x) => x.id === parseStrategyName(file));
  if (!c) throw new Error(`no strategy case ${file}`);
  c.stage.teams = c.opt.teams ?? [];
  const m = c.stage.build(c.opt.players ?? 2);
  m.name = `Strategy: ${c.id}`;
  m.description = `${c.area}: ${c.title}`;
  m.events = [{ name: "Strategy case", message: `${c.area}: ${c.title}.`, resources: [0, 0, 0, 0, 0, 0, 0], players: 1, human: true, computer: false, first: 0, every: 0 }] as unknown as H3Map["events"];
  return m;
}

/** The case's starting situation (armies, spells, the rival's hero out in the open) on the started game. */
export function applyStrategy(s: AdventureState, w: World, file: string, data: GameData) {
  const c = strategyCases(data).find((x) => x.id === parseStrategyName(file));
  const h = s.heroes.find((x) => !x.removed && x.owner === 0);
  if (!c || !h) return;
  c.opt.setup?.(s, w, h);
  for (const x of s.heroes) if (!x.removed) x.movement = x.maxMovement = maxMovement(w, x);
  w.refresh(s);
}
