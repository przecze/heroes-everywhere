// The computer players' personalities: the map editor's "AI tactic" for each computer colour
// (Warrior, Builder, Explorer; most maps leave it Random), or the game setup's choice.
import { B } from "./town.ts";
import type { AdventureState } from "./types.ts";

export type Personality = "warrior" | "builder" | "explorer" | "fresh";
/** The three the editor and "random" pick from ("fresh" is the new engine's seat: fresh/index.ts, picked in the setup). */
export const PERSONALITIES: Personality[] = ["warrior", "builder", "explorer"];
/** The h3m's aiTactic (VCMI's EAiTactic: 0 random, 1 warrior, 2 builder, 3 explorer). */
export const personalityOfTactic = (t: number | undefined): Personality | undefined => (t === 1 ? "warrior" : t === 2 ? "builder" : t === 3 ? "explorer" : t === 4 ? "fresh" : undefined);

/**
 * How a personality shifts what the AI does, as multipliers on (or days added to) the tuned
 * standard AI's numbers: 1 and 0 everywhere is the standard AI.
 */
export interface Traits {
  /** The edge it wants over a rival hero or town (difficulty's boldness, times this). */
  edge: number;
  /** Days added to when it starts marching on rivals out of reach. */
  marchDays: number;
  /** The margin it wants over a monster (risk: less fights closer battles). */
  margin: number;
  /** What rival heroes and towns are worth to it. */
  rivals: number;
  /** What it picks up on the map is worth (mines, resources, chests, places to visit). */
  gather: number;
  /** Unexplored ground near a tile is worth this much a tile even while other things are in reach (0: only once nothing is). */
  fog: number;
  /** Heroes it keeps, beyond the standard number. */
  heroes: number;
  /** Gold kept back from building (the standard: 2500 from week 2) is this much more. */
  reserve: number;
  /** Gold from which it builds everything else the town has (the standard 15000). */
  restAt: number;
  /** Buildings moved to the front of the standard build order, in this order. */
  first: number[];
}

const STANDARD: Traits = { edge: 1, marchDays: 0, margin: 1, rivals: 1, gather: 1, fog: 0, heroes: 0, reserve: 0, restAt: 15000, first: [] };

export const TRAITS: Record<Personality | "standard", Traits> = {
  standard: STANDARD,
  // Troops first and early fights: walls and creature dwellings, the Blacksmith, the upgrades of the
  // lower dwellings before the City Hall; rivals worth more, attacked at a smaller edge, marched on
  // from day 4. (An edge of 0.94 and monsters fought at 0.9 of the margin lost 13 to 26 against
  // the standard AI: armies spent early; at 0.97 it holds its own, sim/personalities.ts.)
  warrior: { ...STANDARD, edge: 0.97, marchDays: -4, rivals: 1.35, first: [B.FORT, B.TAVERN, B.DWELLING, B.DWELLING + 1, B.DWELLING + 2, B.TOWN_HALL, B.CITADEL, B.DWELLING + 3, B.BLACKSMITH, B.DWELLING + 4, B.DWELLING_UPG, B.DWELLING_UPG + 1, B.DWELLING_UPG + 2, B.CASTLE] },
  // Income and growth first: the halls, the Marketplace and the Silo early, the rest of the town
  // built from 8000 gold; keeps to itself (a bigger edge, two weeks before marching), safer fights.
  builder: { ...STANDARD, edge: 1.15, marchDays: 7, margin: 1.1, rivals: 0.85, reserve: -1500, restAt: 8000, first: [B.FORT, B.TAVERN, B.DWELLING, B.TOWN_HALL, B.DWELLING + 1, B.MARKETPLACE, B.DWELLING + 2, B.CITY_HALL, B.RESOURCE_SILO, B.DWELLING + 3, B.CITADEL, B.MAGE_GUILD_1, B.CAPITOL] },
  // The map first: one more hero, what lies around worth more, unexplored ground worth walking to
  // while other things are in reach, the Mage Guild early (its travelling spells).
  // The fresh engine (fresh/index.ts) doesn't read traits; the classic picker's steps it borrows play standard.
  fresh: STANDARD,
  explorer: { ...STANDARD, gather: 1.3, fog: 15, heroes: 1, marchDays: 2, first: [B.FORT, B.TAVERN, B.DWELLING, B.DWELLING + 1, B.DWELLING + 2, B.TOWN_HALL, B.MAGE_GUILD_1] },
};

/**
 * Trait multipliers tried by the self-play tuner (sim/tune.ts): a computer player whose engine is "tuned" plays the
 * standard AI with these traits over its personality's (AI_TUNE=edge=1.1,margin=0.9).
 */
const TUNE: Partial<Traits> = (() => {
  try {
    const raw = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AI_TUNE ?? "";
    // (JSON, or key=value pairs: edge=1.1,margin=0.9.)
    return raw.startsWith("{") ? JSON.parse(raw) : Object.fromEntries(raw.split(",").filter(Boolean).map((kv) => [kv.split("=")[0], Number(kv.split("=")[1])]));
  } catch {
    return {};
  }
})();
export const traitsOf = (s: AdventureState, player: number): Traits => {
  const t = TRAITS[s.players[player]?.personality ?? "standard"];
  return s.players[player]?.aiEngine === "tuned" ? { ...t, ...TUNE } : t;
};

/** The build order with a personality's buildings moved to the front. */
export const personalOrder = (t: Traits, order: number[]): number[] => (t.first.length ? [...t.first, ...order.filter((id) => !t.first.includes(id))] : order);

/** A computer player's personality at the start: the setup's choice ("random": one of the three by the seed), else the map's. */
export function startPersonality(choice: Personality | "random" | undefined, tactic: number | undefined, seed: number, color: number): Personality | undefined {
  if (choice === "random") return PERSONALITIES[Math.abs((seed * 31 + color * 7919) | 0) % 3];
  return choice ?? personalityOfTactic(tactic);
}
