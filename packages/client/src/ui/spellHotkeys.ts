// HD-style spell hotkeys (an addition, EXTRAS spellHotkeys): in the spellbook a digit pressed over a
// spell ties it to that key (the same digit again unties it); then, in battle or on the adventure
// map, the digit casts it as a click on it in the book would, with the book's reasons when it can't.
const KEY = "heroes.spellHotkeys";

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** The spell tied to a digit ("0".."9"), if any. */
export const spellOfHotkey = (digit: string): number | undefined => load()[digit];

/** The digit a spell is tied to, if any. */
export const hotkeyOfSpell = (spell: number): string | undefined => Object.entries(load()).find(([, id]) => id === spell)?.[0];

/** Ties a spell to a digit (a spell has one digit at most), or unties it when it is tied to that digit already. */
export function toggleSpellHotkey(digit: string, spell: number) {
  const keys = load();
  const was = keys[digit] === spell;
  for (const [d, id] of Object.entries(keys)) if (id === spell || d === digit) delete keys[d];
  if (!was) keys[digit] = spell;
  try {
    localStorage.setItem(KEY, JSON.stringify(keys));
  } catch {
    // (A blocked storage: the keys last this page only... not even that; nothing to do.)
  }
}
