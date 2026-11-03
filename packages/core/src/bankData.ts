// Creature banks (Naga Bank, Crypt, Shipwreck, Dragon Utopia, HotA banks...): "objectId:subId" -> levels.
// Made from VCMI's creatureBanks.json and the HotA mod in packages/vcmi-data, with HotA's numbers below. A level is rolled by `chance` (percent);
// guards are [creature, count, upgradedCreature?, upgradePercent?] stacks; rewards are resources[7],
// creatures [id, count] and artifact classes (TREASURE, MINOR, MAJOR, RELIC).
import { MOD_TEXTS, untitled } from "./modTexts.ts";
import type { BankLayout } from "./battle/state.ts";
import { HOTA_BANKS } from "./rewardableData.ts";
import { BANK_LAYOUTS, BASE_BANKS } from "../../vcmi-data/src/bankData.ts";

export interface BankLevel {
  chance: number;
  guards: number[][];
  resources?: number[];
  creatures?: number[][];
  artifacts?: string[];
  /** A spell of this level for a hero who can learn it (the Pyramid). */
  spells?: number;
  /** Tiles revealed around the bank once it's won (the Ruins). */
  reveal?: number;
  /** Particular artifacts (the Ancient Altar's Horn of the Abyss). */
  artifactIds?: number[];
}

export interface BankDef {
  name: string;
  levels: BankLevel[];
  /** The bank's own lines (HotA's banks), else ADVEVENT 32 (attack?), 33 (deserted), 34 (what was found). */
  ask?: string;
  empty?: string;
  won?: string;
  /** An ordinary battle, not the banks' (the Black Tower, the Ancient Altar, the Pyramid): war machines, Tactics, the usual formations. */
  ordinary?: boolean;
  /** Where the guards stand around the hero's army (BANK_LAYOUTS); set for every bank below. */
  layout?: BankLayout;
  /** Guards beaten off a hero who retreats or loses come back (the Pyramid; a bank keeps only its survivors). */
  replenish?: boolean;
  /** Searching it again once plundered lowers the hero's luck until the next battle (the Pyramid: -2). */
  revisitLuck?: number;
  /** Searching it again once plundered lowers the army's morale by 1 until the next battle (the Crypt, the ships, the Churchyard). */
  revisitMorale?: boolean;
}
const { "16:32": ruins, ...originals } = structuredClone(BASE_BANKS);
export const BANKS: Record<string, BankDef> = originals;
Object.assign(BANKS, HOTA_BANKS);
// The Ruins (HotA's Highlands creature bank, avxruins), from the HotA mod's ruins.json, its lines too.
BANKS["16:32"] = ruins;

// HotA's numbers where the configs above differ, checked against heroes.thelazy.net (each bank's page)
// and the game's own CRBANKS.TXT:
// the Imp Cache's first level holds 2 mercury too (CRBANKS);
BANKS["16:3"].levels[0].resources = [0, 2, 0, 0, 0, 0, 1000];
// the Red Tower's third level comes 30% of the time (the mod's 30-90 overlapped the second's);
BANKS["16:26"].levels[2].chance = 30;
// the Beholders' Sanctuary: 5000 gold on level 2, a major artifact on levels 3 and 4;
BANKS["16:21"].levels[1].resources = [0, 0, 0, 0, 0, 0, 5000];
BANKS["16:21"].levels[2].artifacts = BANKS["16:21"].levels[3].artifacts = ["MAJOR"];
// the Temple of the Sea: two treasures, a minor and a relic on level 1, one of each class on level 2;
BANKS["16:22"].levels[0].artifacts = ["TREASURE", "TREASURE", "MINOR", "RELIC"];
BANKS["16:22"].levels[1].artifacts = ["TREASURE", "MINOR", "MAJOR", "RELIC"];
// the Black Tower is fought as an ordinary battle ("no special troop positioning": Tactics, formations, war machines);
BANKS["16:27"].ordinary = true;
// the dead's places: searching them again once plundered lowers morale (ADVEVENT 120 / 123 / 42, the Churchyard's own line).
for (const key of ["84:0", "85:0", "24:0", "16:29"]) BANKS[key].revisitMorale = true;
// HotA's Ancient Altar (a campaign object; 146:4, and 139:14 in older maps): 25 Haspids, fought as wandering
// monsters, guard the Horn of the Abyss (the wiki's 25; the mod has 32). Its lines are the HotA mod's.
BANKS["146:4"] = BANKS["139:14"] = {
  name: "Ancient Altar",
  ordinary: true,
  levels: [{ chance: 100, guards: [[166, 25]], artifactIds: [161] }],
  ask: untitled(MOD_TEXTS["mapObject.hota.neutralcreatures.ancientaltar.creatureBank.ancientAltar.onGuarded"]),
  empty: untitled(MOD_TEXTS["mapObject.hota.neutralcreatures.ancientaltar.creatureBank.ancientAltar.onVisited"]),
  won: untitled(MOD_TEXTS["mapObject.hota.neutralcreatures.ancientaltar.creatureBank.ancientAltar.rewards.0"]),
};

// Each bank's formation (VCMI's creatureBanks.json guardsLayout for the original's, the HotA mod's for
// HotA's; heroes.thelazy.net draws the same hexes on each bank's page, but for the Red Tower, drawn
// narrow there and wide in the mod: the mod's kept).
for (const [key, layout] of Object.entries(BANK_LAYOUTS)) BANKS[key].layout = layout;
// The Pyramid (VCMI's pyramid.json, heroes.thelazy.net): an ordinary battle ("default" layout), its golems
// all back if the hero retreats or falls, and searching it once empty costs 2 luck for the next battle.
Object.assign(BANKS["63:0"], { ordinary: true, replenish: true, revisitLuck: -2 });
