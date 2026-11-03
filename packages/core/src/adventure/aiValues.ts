// What things are worth to the computer player, on one scale (gold: a gold coin is 1). Every target
// the adventure AI weighs is compared by worth per movement spent, so these numbers decide between a
// pile, a mine, a rival hero, a town and going home. Each was set against the others and tuned in the
// simulations (sim/duel.ts, the strategic bench); change one, and run both. The fuller story of each
// is in the comment where it is used.

/** @wiki player/normal Rough gold value of each resource (wood, mercury, ore, sulfur, crystal, gems, gold). */
export const RESOURCE_VALUE = [250, 500, 250, 500, 500, 500, 1];

/** @wiki player/normal What the computer's targets are worth. */
export const WORTH = {
  /** A rival hero beaten (its army's worth on top). */
  beatHero: 20000,
  /** A rival hero beaten that doesn't carry its side's army (a scout, a ferry): what hiring another costs. */
  beatScout: 2500,
  /** A rival's town taken (a leader's and a warlike personality's worth more). */
  rivalTown: 40000,
  /** A neutral town taken. */
  neutralTown: 25000,
  /** Any town, with none of our own left (out of the game in a week). */
  townWhenTownless: 200000,
  /** Going home to a town of ours an enemy closes in on, when the hero can hold it. */
  defendHome: 12000,
  /** Going home to a town that our heroes and its walls hold together, though none of them alone could (the town is at stake). */
  holdTogether: 40000,
  /** A Sanctuary in reach with a far stronger enemy a day off. */
  shelter: 50000,
  /** A gold mine flagged; any other mine. */
  goldMine: 16000,
  mine: 8000,
  /** The Grail dug up (its town building: 5000 gold a day, faster growth). */
  grail: 150000,
  /** The Grail carried home: its building is built on arrival. */
  grailHome: 60000,
  /** What the map's victory condition asks for (it's the game). */
  goal: 150000,
  /** A boat when the island is explored and emptied. */
  boatWhenStuck: 3000,
};

/** A point of experience against troops (aiValue). */
export const XP_VALUE = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AI_XP ?? 3);
/** Troops lost count for half their price: towns grow new ones every week (tuned in duels against the AI that fought every beatable monster). */
export const LOSS_WEIGHT = 0.5;
/** A monster the hero can't beat (at the margin): never a target. */
export const UNBEATABLE = -1e9;

/** A/B switches for the AI benches (sim/raceBench.ts, growth.ts): AI_HALLS=0, AI_SCOUT=0, AI_LOSS=, AI_MARGIN=, AI_SAVEDAYS=, AI_SAVEUP=1 play a rule the old way. */
export const aiEnv = (k: string): string | undefined => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[k];
