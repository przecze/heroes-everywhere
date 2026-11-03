// Map objects with nothing for the computer to use (by "type" or "type:subtype"), and why: what they
// give is a message, or nothing a player gains by. aicheck.ts doesn't count them, and the
// Completeness page (coverage.ts) shows no "AI uses" mark for them. (The ways through, the trades
// and the shelters are checked there on an occasion staged for them; the losses, as left alone.)
export const NO_USE: Record<string, string> = {
  91: "a sign: only its message",
  59: "an ocean bottle: only its message",
  97: "the Den of Thieves: only the Thieves' Guild report",
  27: "an Eye of the Magi: nothing on a visit (the Hut of the Magi looks through it)",
  50: "the Market of Time: does nothing in the original",
  15: "the Cover of Darkness: hides the land from rivals, nothing gained",
  44: "a one-way monolith's exit: nothing goes in",
  54: "a monster: fought, not used",
  26: "a map event: hidden, it fires on whoever steps there as the map maker set it; nothing to aim for",
};

export const noUse = (type: number, sub = 0): string | undefined => NO_USE[`${type}:${sub}`] ?? NO_USE[String(type)];
