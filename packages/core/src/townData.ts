// Towns, by faction: the buildings, requirements, town-screen art and creature lines are made in packages/vcmi-data
// (VCMI's faction configs, the HotA mod's); here the map format's building bits. Costs come from BUILDING.TXT at runtime.
export { TOWNS, type Requirement, type TownBuilding, type TownInfo } from "../../vcmi-data/src/townData.ts";

/** The map format's town building bits (the classic buildings every town has). */
export const MAP_BUILDING_BITS: Record<number, string> = {
  0: "townHall",
  1: "cityHall",
  2: "capitol",
  3: "fort",
  4: "citadel",
  5: "castle",
  6: "tavern",
  7: "blacksmith",
  8: "marketplace",
  9: "resourceSilo",
  11: "mageGuild1",
  12: "mageGuild2",
  13: "mageGuild3",
  14: "mageGuild4",
  15: "mageGuild5",
  16: "shipyard",
  17: "grail",
  22: "dwellingLvl1",
  23: "dwellingUpLvl1",
  24: "horde@0",
  25: "dwellingLvl2",
  26: "dwellingUpLvl2",
  27: "horde@1",
  28: "dwellingLvl3",
  29: "dwellingUpLvl3",
  30: "horde@2",
  31: "dwellingLvl4",
  32: "dwellingUpLvl4",
  33: "horde@3",
  34: "dwellingLvl5",
  35: "dwellingUpLvl5",
  36: "horde@4",
  37: "dwellingLvl6",
  38: "dwellingUpLvl6",
  39: "dwellingLvl7",
  40: "dwellingUpLvl7",
};

/** Per-town special building bits in the map format. */
export const MAP_SPECIAL_BITS: Record<string, Record<number, string>> = {
  castle: { 18: "special1", 20: "special2", 19: "special3" },
  rampart: { 18: "special1", 19: "special2", 20: "special3" },
  tower: { 10: "special1", 20: "special2", 18: "special3", 19: "special4" },
  inferno: { 18: "special2", 19: "special3", 20: "special4" },
  necropolis: { 18: "special1", 19: "special2", 20: "special3" },
  dungeon: { 10: "special1", 18: "special2", 19: "special3", 20: "special4" },
  stronghold: { 18: "special1", 19: "special2", 20: "special3", 21: "special4" },
  fortress: { 20: "special1", 19: "special2", 18: "special3" },
  conflux: {},
  // HotA's towns: the Cove's as VCMI's HotA mod maps them (its Gunpowder Warehouse comes with level 3's
  // dwellings in the bundled maps' town events). The Factory's and the Bulwark's aren't documented
  // (the mod's Factory ids clash with dwelling 1, which the bundled maps use as such): taken by the
  // classic pattern, bit 18 the first special, 19 the second, 10 the Artifact Merchants, 20 the third.
  cove: { 18: "special3", 19: "special4", 20: "dwellingUp2Lvl3" },
  factory: { 18: "special1", 19: "special2", 10: "special3" },
  bulwark: { 18: "special1", 19: "special2", 20: "special3" },
};
