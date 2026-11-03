// Marketplace trading, with the rates from heroes.thelazy.net/index.php/Marketplace.
import { extraMarkets } from "./townSpecials.ts";
import { B } from "./town.ts";
import type { AdventureState } from "./types.ts";
import { Refusal } from "../refusal.ts";

// Per number of marketplaces (1..9+): gold→basic, gold→rare, basic→gold, basic→basic, basic→rare, rare→gold, rare→basic, rare→rare.
// "Give n, get 1" except the sales to gold, which are "give 1, get n".
const RATES = [
  [2500, 5000, 25, 10, 20, 50, 5, 10],
  [1667, 3333, 37, 7, 13, 75, 3, 7],
  [1250, 2500, 50, 5, 10, 100, 3, 5],
  [1000, 2000, 62, 4, 8, 125, 2, 4],
  [833, 1667, 75, 3, 7, 150, 2, 3],
  [714, 1429, 88, 3, 6, 175, 1, 3],
  [625, 1250, 100, 3, 5, 200, 1, 3],
  [556, 1111, 112, 2, 4, 225, 1, 2],
  [500, 1000, 125, 2, 4, 250, 1, 2],
];

const GOLD = 6;
const isBasic = (r: number) => r === 0 || r === 2;

/** Marketplaces in the player's towns (the better rates need more of them). */
export function marketCount(s: AdventureState, player: number): number {
  const markets = s.objects.filter((o) => o.town && !o.removed && o.owner === player && o.town.built.includes(B.MARKETPLACE)).length;
  return markets ? markets + extraMarkets(s, player) : 0;
}

/** One trade lot: give `give` of `from` for `get` of `to`. */
export function tradeRate(markets: number, from: number, to: number): { give: number; get: number } {
  const r = RATES[Math.min(Math.max(markets, 1), 9) - 1];
  if (from === to) return { give: 1, get: 1 };
  if (from === GOLD) return { give: isBasic(to) ? r[0] : r[1], get: 1 };
  if (to === GOLD) return { give: 1, get: isBasic(from) ? r[2] : r[5] };
  if (isBasic(from)) return { give: isBasic(to) ? r[3] : r[4], get: 1 };
  return { give: isBasic(to) ? r[6] : r[7], get: 1 };
}

/** Trades `lots` lots between resources; throws when not possible. */
export function trade(s: AdventureState, player: number, from: number, to: number, lots: number, atLeast = 0) {
  if (!Number.isInteger(lots) || lots <= 0 || from === to || from < 0 || from > 6 || to < 0 || to > 6) throw new Refusal("invalid trade");
  const markets = Math.max(marketCount(s, player), atLeast);
  if (!markets) throw new Refusal("you need a Marketplace");
  const { give, get } = tradeRate(markets, from, to);
  const res = s.players[player].resources;
  if (res[from] < give * lots) throw new Refusal("not enough to trade");
  res[from] -= give * lots;
  res[to] += get * lots;
}

/** The Black Market prices as Artifact Merchants with this many marketplaces (heroes.thelazy.net). */
export const BLACK_MARKET_MARKETS = 5;
/** HotA's Junkman buys as Artifact Merchants with this many (half the price in gold). */
export const JUNKMAN_MARKETS = 7;

/** What each resource is worth in gold, for artifact trades (VCMI's resources.json). */
const RESOURCE_VALUE = [250, 500, 250, 500, 500, 500, 1];

/**
 * Artifact Merchants (VCMI's IMarket::getOffer): what an artifact worth `price` gold costs in
 * `resource` when bought, or brings when sold. The more marketplaces the player has the better:
 * effectiveness (markets + 3) / 20, at most 0.6. Paying in anything but gold costs double.
 */
export function artifactOffer(markets: number, price: number, resource: number, mode: "buy" | "sell"): number {
  const effectiveness = Math.min((markets + 3) / 20, 0.6);
  const value = RESOURCE_VALUE[resource] ?? 1;
  if (mode === "buy") return Math.max(1, Math.round(price / effectiveness / (resource === GOLD ? value : value / 2)));
  return Math.max(1, Math.round((price * effectiveness) / value));
}

/** The Freelancer's Guild on the adventure map pays as five marketplaces: 70% (heroes.thelazy.net). */
export const FREELANCER_MAP_MARKETS = 5;
/** Share of a creature's gold price the Freelancer's Guild pays, by marketplaces owned (VCMI's IMarket, the wiki's table). */
const CREATURE_SHARE = [0, 0.3, 0.45, 0.5, 0.65, 0.7, 0.85, 0.9, 1];

/**
 * What `count` creatures costing `goldCost` gold each bring at the Freelancer's Guild, in
 * `resource` (VCMI's IMarket::getOffer, CREATURE_RESOURCE): per creature when one is worth more
 * than a unit of the resource, else a unit for every so many creatures (none for too few).
 */
export function creatureOffer(markets: number, goldCost: number, count: number, resource: number): number {
  const share = CREATURE_SHARE[Math.min(Math.max(markets, 0), 8)];
  if (!share || goldCost <= 0) return 0;
  const wanted = (RESOURCE_VALUE[resource] ?? 1) / share;
  if (goldCost > wanted) return count * Math.ceil(goldCost / wanted);
  return Math.floor(count / Math.round(wanted / goldCost));
}
