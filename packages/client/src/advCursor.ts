// The adventure map's cursors by what a click would do (no DOM: map/mapCursor.ts picks one, cursors.ts draws it).

/** CRADVNTR.DEF frames (VCMI's Cursor::Map): per turn count 1..4, move/attack/sail/disembark/exchange/visit. */
export const AdvCursor = {
  Pointer: 0,
  Hero: 2,
  Town: 3,
  Move: 4,
  Attack: 5,
  Sail: 6,
  Disembark: 7,
  Exchange: 8,
  Visit: 9,
  SailVisit: 28,
  Teleport: 41,
  Scuttle: 42,
} as const;
