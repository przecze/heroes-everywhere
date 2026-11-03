// The fresh AI's kingdom: what each town builds, what it buys and what the marketplace trades.
//
// One currency, gold. A building is worth the flow it adds to its town (the hall's gold, the silo's resources, the
// week's creatures as army worth, as much of them as the kingdom's gold can buy) for the days left of the planning
// horizon once it stands, plus what the owner measures the kingdom by (the Capitol, the upgraded 7th-level dwelling). Every
// building of the town is a goal; its chain is what it still needs (the base it upgrades, its requirements), its
// return the chain's worth over the chain's price. The best chain's next step is built (with the marketplace's help
// where that brings it today), and the rest of the gold buys troops, unless it would put the chain off.
import { TOWNS, type Requirement } from "../../townData.ts";
import { type AdventureState, type AdvObject, Obj } from "../types.ts";
import { boatSpot, mapHeroesOf } from "../rules.ts";
import { findPaths } from "../movement.ts";
import { sails } from "./unlock.ts";
import { type World } from "../world.ts";
import { B, buildingCost, cannotBuild, dwellingId, meets, townIncome, townInfo, upperArmy, visitingHero, weeklyGrowth } from "../town.ts";
import { marketCount, tradeRate } from "../market.ts";
import { dailyIncome } from "../rules.ts";
import { type Mind, act, env, note } from "./mind.ts";
import { dangerOf, rivalsOf, townHolds } from "./danger.ts";
import { allied } from "../rules.ts";
import { isRevealed } from "../world.ts";
import { visitTile } from "../world.ts";

/** Days the kingdom plans for: what a building brings after that doesn't count. */
const HORIZON = Number(env("FR_HORIZON") ?? 45);
/** Gold a point of army worth (aiValue) of the week's growth is counted at. */
const ARMY = Number(env("FR_ARMY") ?? 0.35);
/** What the milestones are worth on top (the owner's: a Capitol, an upgraded 7th-level dwelling). */
const MILESTONE = Number(env("FR_MILESTONE") ?? 50000);
/** Days of income the kingdom saves for the next step of its plan before troops get the gold. */
const SAVE_DAYS = Number(env("FR_SAVE") ?? 7);
/** The plan's steps whose resources the heroes go for (more: the Fort's wood fetched while the City Hall is saved for). */
const NEED_STEPS = Number(env("FR_NEEDSTEPS") ?? 3);
/** Gold's extra worth while the plan's next building lacks gold. */
const GOLD_PULL = Number(env("FR_GOLDPULL") ?? 0);
/** The same with a rival near (pressure 1): troops sooner (1v1 small maps 18-14 -> 20-11 against the current AI; 3 won 22-9 but put the Fort in the owner's first
 * Key to Victory game played again past day 18). */
const SAVE_DAYS_CONTESTED = Number(env("FR_SAVE2") ?? 4);
/** A Fort, Citadel and Castle as defence, in gold (on top of what they lead to). */
const WALLS = (env("FR_WALLS") ?? "12000,5000,5000").split(",").map(Number);

/** A resource's base worth in gold: the market's own reckoning with a few marketplaces. */
export const BASE_WORTH = [180, 400, 180, 400, 400, 400, 1];

/** The buildings a town still needs for `id`, in an order they can go up (bases and requirements first); null if never. */
export function chainTo(o: AdvObject, id: number, have = new Set(o.town!.built), out: number[] = [], depth = 0): number[] | null {
  const info = townInfo(o);
  const b = info?.buildings[id];
  if (!b || depth > 12) return null;
  if (have.has(id)) return out;
  if (o.town!.forbidden?.includes(id) || b.key.startsWith("extra") || b.key === "ship" || id === B.GRAIL || id === B.SHIPYARD) return null;
  if (b.upgrades !== null && !have.has(b.upgrades) && !chainTo(o, b.upgrades, have, out, depth + 1)) return null;
  const need = (r: Requirement | null): boolean => {
    if (r === null || meets(r, have)) return true;
    if (typeof r === "number") return !!chainTo(o, r, have, out, depth + 1);
    const [op, ...rest] = r;
    if (op === "none") return true;
    if (op === "any") return rest.some((x) => need(x as Requirement));
    return rest.every((x) => need(x as Requirement));
  };
  if (!need(b.requires)) return null;
  if (!have.has(id)) (have.add(id), out.push(id));
  return out;
}

/** A town as if these buildings stood. */
const withBuilt = (o: AdvObject, built: Iterable<number>): AdvObject => ({ ...o, town: { ...o.town!, built: [...built] } });

/** A side with rivals still in the game: its army is what keeps it (and takes theirs). */
const ARMY_CONTESTED = Number(env("FR_ARMY2") ?? 1);
/** Gold's own worth (what it builds) beside the troops it buys, alone on the map and with rivals. */
const GOLD_SOLO = 1;
const GOLD_CONTESTED = Number(env("FR_GOLD2") ?? 0.35);
const TROOPS_FIRST = env("FR_TROOPS_FIRST") !== "0";
export const contested = (s: AdventureState, player: number) => s.players.some((p) => p.alive && p.color !== player && p.controller !== "none" && (p.team === undefined || p.team !== s.players[player].team));
/** Days per tile of the map's width until rivals are expected (36 tiles: ~14 days, 72: ~29, 144: ~58). */
const CONTACT = Number(env("FR_CONTACT") ?? 0.4);

/**
 * How near the rivals are felt, 0 (alone: build) to 1 (in contact: troops). Once a rival hero or town has been seen,
 * 1; before, the share of the days the map's size gives until contact (the owner: "do they start rushing more if the map is
 * small or enemy contact is early? They should").
 */
export function pressure(s: AdventureState, w: World, player: number): number {
  if (!contested(s, player)) return 0;
  if (rivalsOf(s, player).length) return 1;
  if (s.objects.some((o) => o.town && !o.removed && o.owner >= 0 && o.owner !== player && !allied(s, o.owner, player) && isRevealed(s, player, visitTile(w, o)))) return 1;
  return Math.min(1, s.day / (w.size * CONTACT));
}

/** A town's part of the kingdom's day: gold and resources, the army worth on offer and its price, its services. */
export interface Flow {
  gold: number;
  other: number;
  supply: number;
  price: number;
  services: number;
}

export function townFlow(s: AdventureState, w: World, o: AdvObject, worth: number[]): Flow {
  const t = o.town!;
  const info = townInfo(o)!;
  const income = townIncome(o);
  const f: Flow = { gold: income[6], other: income.reduce((a, n, r) => a + (r === 6 ? 0 : n * worth[r]), 0), supply: 0, price: 0, services: 0 };
  for (let l = 0; l < info.creatures.length; l++) {
    const g = weeklyGrowth(w, o, l, s);
    if (!g) continue;
    const up = info.creatures[l][1] !== undefined && t.built.includes(dwellingId(l, true));
    const c = w.creatures[info.creatures[l][up ? 1 : 0]];
    f.supply += (g * (c?.aiValue ?? 0)) / 7;
    f.price += (g * (c?.cost[6] ?? 0)) / 7;
  }
  const has = (id: number) => t.built.includes(id);
  if (has(B.MARKETPLACE)) f.services += 60;
  if (has(B.MAGE_GUILD_1)) f.services += 80;
  if (has(B.BLACKSMITH)) f.services += 30;
  if (has(B.TAVERN)) f.services += 60;
  if (has(B.FORT)) f.services += 40;
  return f;
}

const add = (a: Flow, b: Flow, k = 1): Flow => ({ gold: a.gold + k * b.gold, other: a.other + k * b.other, supply: a.supply + k * b.supply, price: a.price + k * b.price, services: a.services + k * b.services });

/**
 * The kingdom's day in one number: gold (what it builds), the other resources, and the army it buys: the creatures on
 * offer as far as the gold pays for them (dwellings without the gold to buy are worth little; gold without dwellings to
 * spend it on buys nothing), the services. With rivals the army counts most; alone, what the gold builds.
 */
export function kingdomValue(p: number, f: Flow, extraGold: number): number {
  const gold = f.gold + extraGold;
  const bought = f.price > 0 ? f.supply * Math.min(1, gold / f.price) : 0;
  return (GOLD_SOLO + (GOLD_CONTESTED - GOLD_SOLO) * p) * gold + f.other + (ARMY + (ARMY_CONTESTED - ARMY) * p) * bought + f.services;
}

/** The kingdom's flow: every town's, summed. */
function kingdomFlow(s: AdventureState, w: World, towns: AdvObject[], worth: number[]): Flow {
  return towns.reduce((a, o) => add(a, townFlow(s, w, o, worth)), { gold: 0, other: 0, supply: 0, price: 0, services: 0 });
}

/** What each resource is worth to the kingdom now: more when the plan is short of it and no mine brings it. */
export function resourceWorth(s: AdventureState, w: World, player: number, mind: Mind): number[] {
  const res = s.players[player].resources;
  const income = dailyIncome(s, w, player);
  const need = mind.need ?? [0, 0, 0, 0, 0, 0, 0];
  return BASE_WORTH.map((b, r) => {
    // Gold the plan waits for brings its building that much sooner (the owner: "gold from treasure; it should all be
    // connected goals"): worth more while the next building lacks it, the more the closer it is to the Capitol.
    if (r === 6) return mind.goldShort ? 1 + GOLD_PULL : 1;
    const short = need[r] - res[r] - income[r] * 7;
    return short > 0 ? b * (1.5 + Math.min(2, short / 10)) : res[r] > need[r] + 20 ? b * 0.5 : b;
  });
}

/** The gold a cost comes to. */
const goldOf = (cost: number[], worth: number[]) => cost.reduce((a, n, r) => a + n * worth[r], 0);

/** Days until the purse and the income pay for `cost` (Infinity when a resource never comes). */
export function daysToAfford(res: number[], income: number[], cost: number[]): number {
  let d = 0;
  for (let r = 0; r < 7; r++) {
    const short = cost[r] - res[r];
    if (short <= 0) continue;
    if (income[r] <= 0) return Infinity;
    d = Math.max(d, Math.ceil(short / income[r]));
  }
  return d;
}

interface Plan {
  town: AdvObject;
  chain: number[];
  cost: number[];
  score: number;
  /** Days until it stands. */
  days: number;
}

/** The best chain of buildings of every town, by return; the plan's resources go into mind.need. */
export function plan(s: AdventureState, w: World, player: number, mind: Mind): Plan | undefined {
  const towns = s.objects.filter((o) => o.town && !o.removed && o.owner === player && townInfo(o));
  if (!towns.length) return undefined;
  const worth = resourceWorth(s, w, player, mind);
  const all = kingdomFlow(s, w, towns, worth);
  // (Mines' gold counts with the towns': it buys troops too.)
  const mines = dailyIncome(s, w, player)[6] - all.gold;
  const p = pressure(s, w, player);
  const now = kingdomValue(p, all, mines);
  const res = s.players[player].resources;
  const income = dailyIncome(s, w, player);
  const capitol = towns.some((o) => o.town!.built.includes(B.CAPITOL));
  const dz = dangerOf(s, w, player);
  let best: Plan | undefined;
  for (const o of towns) {
    const mine = townFlow(s, w, o, worth);
    // The town as it will soon stand (its City Hall and its five lower dwellings, what every kingdom builds): a
    // building's worth there too. Alone a Castle doubles one dwelling's growth and the Capitol's gold has little to
    // buy, so the Fort-Citadel-Castle-Capitol line lost to every dwelling (the owner's Key to Victory game replayed: City
    // Hall on day 9, the Fort on day 21, no Capitol; his own: Castle on day 9, Capitol on day 12).
    const soon = new Set(o.town!.built);
    for (const id of [B.CITY_HALL, ...[0, 1, 2, 3, 4].map((l) => dwellingId(l))]) chainTo(o, id, soon);
    const others = add(all, mine, -1);
    for (const key of Object.keys(TOWNS[o.subid].buildings)) {
      const id = Number(key);
      if (o.town!.built.includes(id) || (id === B.CAPITOL && capitol)) continue;
      const chain = chainTo(o, id);
      if (!chain?.length || (capitol && chain.includes(B.CAPITOL))) continue;
      const cost = [0, 0, 0, 0, 0, 0, 0];
      for (const b of chain) buildingCost(w, o, b).forEach((n, r) => (cost[r] += n));
      // (A step the marketplace can bring counts its gold; one no mine or market brings is a long wait.)
      const days = Math.max(chain.length - 1 + (o.town!.builtToday ? 1 : 0), Math.min(daysToAfford(res, income, cost), daysToAfford(res.map((n, r) => (r === 6 ? n : n + 1000)), income.map((n, r) => (r === 6 ? n : n + 0.5)), cost) + 3));
      const left = HORIZON - days;
      if (!(left > 0)) continue;
      const gainNow = kingdomValue(p, add(add(all, mine, -1), townFlow(s, w, withBuilt(o, [...o.town!.built, ...chain]), worth)), mines) - now;
      // (The chain's own buildings taken out of that future: a dwelling there is still worth its creatures.)
      const without = [...soon].filter((b) => !chain.includes(b));
      const gainSoon = kingdomValue(p, add(others, townFlow(s, w, withBuilt(o, [...without, ...chain]), worth)), mines) - kingdomValue(p, add(others, townFlow(s, w, withBuilt(o, without), worth)), mines);
      const gain = (gainNow + gainSoon) / 2;
      let v = gain * left;
      if (chain.includes(B.CAPITOL) && !capitol) v += MILESTONE;
      // Walls: what the town holds by (2026-11-02: "fort is an essential thing to build, probably in the first
      // turn"), worth more once rivals are near and most when one could take the town now.
      const walls = (chain.includes(B.FORT) ? WALLS[0] : 0) + (chain.includes(B.CITADEL) ? WALLS[1] : 0) + (chain.includes(B.CASTLE) ? WALLS[2] : 0);
      if (walls) v += walls * (0.4 + 0.6 * p) * (dz.two.has(visitTile(w, o)) && (dz.two.get(visitTile(w, o)) ?? 0) > townHolds(s, w, o) ? 2 : 1);
      if (chain.includes(dwellingId(6, true)) && !towns.some((x) => x.town!.built.includes(dwellingId(6, true)))) v += MILESTONE;
      const score = v / Math.max(500, goldOf(cost, worth));
      if (env("FR_DEBUG")) note(s, player, `  plan ${o.id}:${id} chain ${chain.join(",")} days ${days} gain ${Math.round(gainNow)}/${Math.round(gainSoon)} v ${Math.round(v)} cost ${cost.join("/")} score ${score.toFixed(2)}`);
      if (!best || score > best.score) best = { town: o, chain, cost, score, days };
    }
  }
  return best;
}

/** The kingdom's morning: build, trade for the building, buy troops with what's left. */
export function runTowns(s: AdventureState, w: World, player: number, mind: Mind) {
  mind.saving = 0;
  const towns = s.objects.filter((o) => o.town && !o.removed && o.owner === player && townInfo(o));
  // With rivals in the game the week's troops come first (an army a week late is a town lost), the buildings after.
  // (Else only on the week's first day, when the dwellings refill: bought a few a day as the gold came in, the troops
  // took every coin and the halls never came, the City Hall on day 40 against the classic AI's day 20.)
  // Rivals in sight (or remembered): every day, the army first (the owner: rush more when contact comes early).
  // (Seen is not threatened: the owner's 2026-11-02 Key to Victory game, the New AI saw his scout, bought troops every day
  // with every coin and never built a Fort. Daily only when a rival could take a town of ours within two days.)
  const dz = dangerOf(s, w, player);
  const threatened = towns.some((o) => (dz.two.get(visitTile(w, o)) ?? 0) > townHolds(s, w, o));
  // (The week's troops otherwise come after the plan's step, its gold kept back: Capitol on day 28 against the owner's 14.)
  const pressed = pressure(s, w, player) >= 1 && threatened;
  if (TROOPS_FIRST && pressed) for (const o of towns) recruit(s, w, player, o, [0, 0, 0, 0, 0, 0, 0]);
  const p = plan(s, w, player, mind);
  // What the plan still asks for (the next three steps' worth): the heroes value these resources more.
  const need = [0, 0, 0, 0, 0, 0, 0];
  if (p) for (const b of p.chain.slice(0, NEED_STEPS)) buildingCost(w, p.town, b).forEach((n, r) => (need[r] += n));
  mind.need = need;
  let reserve = [0, 0, 0, 0, 0, 0, 0];
  mind.goldShort = 0;
  if (p) {
    const step = p.chain.find((b) => cannotBuild(s, w, p.town, b) === null || cannotBuild(s, w, p.town, b) === "Not enough resources.");
    if (step !== undefined) {
      const cost = buildingCost(w, p.town, step);
      if (cannotBuild(s, w, p.town, step) !== null) tradeFor(s, w, player, cost, need);
      if (cannotBuild(s, w, p.town, step) === null) {
        act(s, w, player, { type: "build", town: p.town.id, building: step });
        note(s, player, `builds ${TOWNS[p.town.subid].buildings[step]?.name ?? TOWNS[p.town.subid].buildings[step]?.key ?? step} toward ${p.chain.at(-1)} (${p.score.toFixed(1)})`);
      } else {
        const res = s.players[player].resources;
        mind.goldShort = Math.max(0, cost[6] - res[6]);
        const income = dailyIncome(s, w, player);
        const save = SAVE_DAYS + (SAVE_DAYS_CONTESTED - SAVE_DAYS) * pressure(s, w, player);
        if (daysToAfford(res, income, cost) <= save) reserve = cost;
        // (The heroes hired today wait too: a 2,500 hire put the City Hall off by three days in the owner's game.)
        mind.saving = reserve[6];
        note(s, player, `saves for ${TOWNS[p.town.subid].buildings[step]?.key ?? step}`);
        if (env("FR_DEBUG")) note(s, player, `  ${cannotBuild(s, w, p.town, step)} cost ${cost.join("/")} have ${res.join("/")} markets ${marketCount(s, player)}`);
      }
    }
  }
  // The other towns build what pays best of what they can afford, keeping the plan's reserve.
  for (const o of towns) {
    if (o.town!.builtToday) continue;
    if (SHIPYARDS && shipyardPays(s, w, player, o, mind, reserve)) {
      act(s, w, player, { type: "build", town: o.id, building: B.SHIPYARD });
      note(s, player, `builds a Shipyard: the sea opens more than it costs`);
      continue;
    }
    const q = cheapest(s, w, player, o, mind, reserve);
    if (q !== undefined) act(s, w, player, { type: "build", town: o.id, building: q });
  }
  // A town a rival can take tomorrow spends everything on troops first.
  const d = dangerOf(s, w, player);
  const endangered = (o: AdvObject) => (d.one.get(visitTile(w, o)) ?? 0) > townHolds(s, w, o);
  for (const o of towns.filter(endangered)) recruit(s, w, player, o, [0, 0, 0, 0, 0, 0, 0]);
  for (const o of towns) recruit(s, w, player, o, reserve);
}

/**
 * A Shipyard in a town by the sea when what a boat there opens (unlock.ts sails, for the strongest hero) is worth more
 * than the Shipyard and a boat, no shipyard of ours stands yet, and it leaves the plan's reserve (FR_SHIPYARDS=0: never).
 */
const SHIPYARDS = env("FR_SHIPYARDS") !== "0";
function shipyardPays(s: AdventureState, w: World, player: number, o: AdvObject, mind: Mind, reserve: number[]): boolean {
  if (cannotBuild(s, w, o, B.SHIPYARD) !== null) return false;
  if (s.objects.some((x) => !x.removed && x.owner === player && (x.type === Obj.SHIPYARD || x.town?.built.includes(B.SHIPYARD)))) return false;
  const res = s.players[player].resources;
  const cost = buildingCost(w, o, B.SHIPYARD);
  if (cost.some((n, r) => res[r] - n < reserve[r])) return false;
  const h = mapHeroesOf(s, player).sort((a, b) => b.level - a.level)[0];
  const spot = boatSpot(s, w, o);
  if (!h || h.boat !== undefined || spot < 0) return false;
  const worth = resourceWorth(s, w, player, mind);
  const opened = sails(s, w, h, findPaths(w, s, h), spot);
  if (env("FR_DEBUG")) note(s, player, `  a Shipyard at ${o.name ?? o.id}: the sea opens ${Math.round(opened)}, costs ${Math.round(goldOf(cost, worth))}`);
  return opened - 1500 > goldOf(cost, worth) + 1000;
}

/** A building this town can put up today without touching the reserve, the best return first. */
/** FR_IDLE: spare gold beyond which the other towns' bar for a building falls (0: always twice its price). */
const IDLE = Number(env("FR_IDLE") ?? 0);
function cheapest(s: AdventureState, w: World, player: number, o: AdvObject, mind: Mind, reserve: number[]): number | undefined {
  const res = s.players[player].resources;
  const worth = resourceWorth(s, w, player, mind);
  const towns = s.objects.filter((x) => x.town && !x.removed && x.owner === player && townInfo(x));
  const all = kingdomFlow(s, w, towns, worth);
  const mines = dailyIncome(s, w, player)[6] - all.gold;
  const p = pressure(s, w, player);
  const now = kingdomValue(p, all, mines);
  const mine = townFlow(s, w, o, worth);
  let best: number | undefined;
  // A building must return twice its price over the horizon, while gold is short; gold piling up (more than IDLE spare
  // over the plan's reserve) is worth less, so the bar falls with it (Sands of Blood from the owner's seat, 2026-11-03: the
  // second town built once in a week while 48k gold sat idle on day 28).
  const spare = res[6] - reserve[6];
  let bestScore = IDLE > 0 && spare > IDLE ? Math.max(0.5, (2 * IDLE) / spare) : 2;
  for (const key of Object.keys(TOWNS[o.subid].buildings)) {
    const id = Number(key);
    if (cannotBuild(s, w, o, id) !== null || id === B.SHIPYARD) continue;
    const cost = buildingCost(w, o, id);
    if (cost.some((n, r) => res[r] - n < reserve[r])) continue;
    const score = ((kingdomValue(p, add(add(all, mine, -1), townFlow(s, w, withBuilt(o, [...o.town!.built, id]), worth)), mines) - now) * HORIZON) / Math.max(500, goldOf(cost, worth));
    if (score > bestScore) [best, bestScore] = [id, score];
  }
  return best;
}

/** Buys the resources a cost is short of: from those the plan doesn't need first, then with gold. */
export function tradeFor(s: AdventureState, w: World, player: number, cost: number[], need: number[] = []): boolean {
  const markets = marketCount(s, player);
  if (!markets) return false;
  const res = s.players[player].resources;
  // Will it all come together? (Gold first counted for what it pays outright.)
  let gold = res[6] - cost[6];
  const spare = res.map((n, r) => (r === 6 ? 0 : Math.max(0, n - cost[r])));
  const trades: { from: number; to: number; lots: number }[] = [];
  for (let r = 0; r < 6; r++) {
    let missing = cost[r] - res[r];
    for (let f = 0; f < 6 && missing > 0; f++) {
      if (f === r || spare[f] <= 0) continue;
      const { give } = tradeRate(markets, f, r);
      const lots = Math.min(missing, Math.floor(spare[f] / give));
      if (lots <= 0) continue;
      spare[f] -= lots * give;
      missing -= lots;
      trades.push({ from: f, to: r, lots });
    }
    if (missing > 0) {
      gold -= missing * tradeRate(markets, 6, r).give;
      trades.push({ from: 6, to: r, lots: missing });
    }
  }
  // Short of gold: the resources piled up beyond what the plan asks for are sold (the owner's game: 50 wood, 40 ore and
  // 30 of each rare one in store while it waited a week for the City Hall's gold). Precious ones first.
  if (gold < 0)
    for (const f of [3, 4, 5, 1, 0, 2]) {
      const keep = (f === 0 || f === 2 ? 10 : 5) + (need[f] ?? 0);
      const { get } = tradeRate(markets, f, 6);
      const lots = Math.min(Math.max(0, spare[f] - keep), Math.ceil(-gold / get));
      if (lots <= 0) continue;
      spare[f] -= lots;
      gold += lots * get;
      trades.unshift({ from: f, to: 6, lots });
      if (gold >= 0) break;
    }
  if (gold < 0 || !trades.length) return false;
  for (const t of trades) act(s, w, player, { type: "trade", ...t });
  return true;
}

/** The town's creatures, the best first, into the garrison (or the hero at the gate), keeping the reserve. */
export function recruit(s: AdventureState, w: World, player: number, o: AdvObject, reserve: number[]) {
  const t = o.town!;
  const info = TOWNS[o.subid];
  const res = s.players[player].resources;
  const hero = visitingHero(s, w, o);
  for (let l = info.creatures.length - 1; l >= 0; l--) {
    const offers: { up: boolean; creature: number }[] = [];
    if (info.creatures[l][1] !== undefined && t.built.includes(dwellingId(l, true))) offers.push({ up: true, creature: info.creatures[l][1] });
    if (t.built.includes(dwellingId(l))) offers.push({ up: false, creature: info.creatures[l][0] });
    for (const { up, creature } of offers) {
      const c = w.creatures[creature];
      if (!c || !t.available[l]) continue;
      const room = upperArmy(s, o).some((x) => !x || x.creature === creature) || (hero?.owner === player && hero.army.some((x) => !x || x.creature === creature));
      if (!room) continue;
      let n = t.available[l];
      for (let r = 0; r < 7; r++) if (c.cost[r] > 0) n = Math.min(n, Math.floor((res[r] - reserve[r]) / c.cost[r]));
      if (n <= 0) continue;
      act(s, w, player, { type: "recruit", town: o.id, level: l, upgraded: up, count: n });
      break;
    }
  }
}
