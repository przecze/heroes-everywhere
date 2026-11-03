// The creatures' ability lines come from the player's own CRTRAITS.TXT, in its language: this release carries no
// translations of the game's own words.
export const TABLES: Record<string, Record<string, string>> = {};

/** A creature's ability line as the player's files have it. */
export function abilityLine(text: string): string {
  return text;
}
