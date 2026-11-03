// What the towns' special buildings do (VCMI's faction configs and the HotA mod's): one-off gifts
// to visiting heroes, weekly services, help for a besieged town, and kingdom-wide effects.
import { withLearning } from "../specialty.ts";
import { MOD_TEXTS } from "../modTexts.ts";
import { randInt } from "../rng.ts";
import { B, recruitsLevel, townInfo } from "./town.ts";
import type { AdventureState, AdvObject, Component, Hero, TextRef } from "./types.ts";
import { handicapped } from "./handicap.ts";
import { weekIndex } from "../calendar.ts";
import { lineText } from "../gameLines.ts";

/** Building ids of the four special slots and the shipyard's ship. */
export const SPECIAL = { s1: 17, s2: 21, s3: 22, s4: 23 } as const;

const faction = (o: AdvObject) => townInfo(o)?.faction ?? "";
const has = (o: AdvObject, id: number) => !!o.town?.built.includes(id);

/** Does the town have this faction's special building (slot 17, 21, 22 or 23)? */
export function hasSpecial(o: AdvObject, f: string, id: number): boolean {
  return faction(o) === f && has(o, id);
}

/** Towns of a player with a given special building. */
function townsWith(s: AdventureState, player: number, f: string, id: number): AdvObject[] {
  return s.objects.filter((o) => o.town && !o.removed && o.owner === player && hasSpecial(o, f, id));
}

/**
 * +1 to a primary skill, once per hero: Wall of Knowledge, Order of Fire, Hall of Valhalla, Cage of
 * Warlords; with the original's line for it (GENRLTXT, VCMI's CTownBonus).
 */
const PRIMARY_GIFT: Record<string, [number, number, string, number]> = {
  tower: [SPECIAL.s4, 3, "Wall of Knowledge", 581],
  inferno: [SPECIAL.s4, 2, "Order of Fire", 582],
  stronghold: [SPECIAL.s4, 0, "Hall of Valhalla", 584],
  fortress: [SPECIAL.s1, 1, "Cage of Warlords", 585],
};

/** What a town's building tells a visiting hero: in English, the original's line, what it gave. */
export interface TownGift {
  message: string;
  text?: TextRef;
  components?: Component[];
}

/** A hero enters its own town: the special buildings that give something. Returns messages. */
/** Why the town's Mana Vortex can't fill this hero (the mod's texts), or null. */
export function manaVortexRefusal(o: AdvObject, h: Hero, week: number, maxMana: (h: Hero) => number): string | null {
  if (!hasSpecial(o, "dungeon", SPECIAL.s2)) return "There is no Mana Vortex here.";
  if ((o.data as { vortexWeek?: number } | undefined)?.vortexWeek === week) return MOD_TEXTS["building.core.dungeon.special2.onVisited"];
  if ((h.mana ?? 0) >= 2 * maxMana(h)) return MOD_TEXTS["building.core.dungeon.special2.onEmpty"];
  return null;
}

/** The Mana Vortex doubles the hero's normal spell points (once a week for the town). */
export function useManaVortex(o: AdvObject, h: Hero, week: number, maxMana: (h: Hero) => number): string {
  (o.data ??= {}).vortexWeek = week;
  h.mana = 2 * maxMana(h);
  return `{Mana Vortex}\n\n${h.name}'s spell points are doubled.`;
}

/**
 * `built`: only the building just built, for the heroes in the town (VCMI's buildStructure visits the town's bonus
 * buildings for the visiting and garrisoned heroes at once: Hall of Valhalla's +1 comes with its message when it's
 * built, not on the next visit; The owner 2026-11-02).
 */
export function visitTownSpecials(s: AdventureState, o: AdvObject, h: Hero, ctx: { maxMana: (h: Hero) => number; gainExperience: (h: Hero, xp: number) => string[] }, built?: number): TownGift[] {
  const out: TownGift[] = [];
  const now = (id: number) => built === undefined || built === id;
  const f = faction(o);
  const d = (o.data ??= {}) as Record<string, unknown>;
  const visitedBy = (key: string) => ((d[key] ??= []) as number[]);
  const week = weekIndex(s.day);
  const gift = PRIMARY_GIFT[f];
  if (gift && now(gift[0]) && has(o, gift[0]) && !visitedBy("gift").includes(h.type)) {
    visitedBy("gift").push(h.type);
    h.primary[gift[1]]++;
    out.push({ message: lineText({ file: "genrltxt", id: gift[3] }), text: { file: "genrltxt", id: gift[3] }, components: [{ kind: "primary", id: gift[1], amount: 1 }] });
  }
  // Battle Academy: 1000 experience, once per hero.
  if (now(SPECIAL.s4) && hasSpecial(o, "dungeon", SPECIAL.s4) && !visitedBy("academy").includes(h.type)) {
    visitedBy("academy").push(h.type);
    ctx.gainExperience(h, 1000);
    out.push({ message: lineText({ file: "genrltxt", id: 583 }), text: { file: "genrltxt", id: 583 }, components: [{ kind: "experience", amount: withLearning(h, 1000) }] });
  }
  // Stables: +300 movement a day for the rest of the week (HotA's; the original's was 400).
  if (now(SPECIAL.s2) && hasSpecial(o, "castle", SPECIAL.s2) && h.stablesWeek !== week && h.boat === undefined) {
    h.stablesWeek = week;
    h.movement += 300;
    out.push({ message: lineText({ file: "genrltxt", id: 580 }), text: { file: "genrltxt", id: 580 } });
  }
  // Mana Vortex: double spell points, one hero each week. In HotA a player's hero asks for it in the
  // town (the building, manaVortex below); the computer's take it on the way in.
  if (built === undefined && s.players[h.owner]?.controller !== "human" && !manaVortexRefusal(o, h, week, ctx.maxMana)) out.push({ message: useManaVortex(o, h, week, ctx.maxMana), text: { file: "genrltxt", id: 579 } });
  // Mystic Pond: a few rare resources a week, for the first visitor.
  if (built === undefined && hasSpecial(o, "rampart", SPECIAL.s1) && d.pondWeek !== week) {
    d.pondWeek = week;
    const res = [1, 3, 4, 5][randInt(s, 0, 3)];
    const n = handicapped(s.players[o.owner].handicap, randInt(s, 1, 4));
    s.players[o.owner].resources[res] += n;
    // (The building's own line, GENRLTXT 678.)
    const name = ["", "Mercury", "", "Sulfur", "Crystal", "Gems"][res];
    out.push({ message: lineText({ file: "genrltxt", id: 678, args: [n, name] }), text: { file: "genrltxt", id: 678, args: [n, name] }, components: [{ kind: "resource", id: res, amount: n }] });
  }
  return out;
}

/** Every day: Necropolis towns' Cover of Darkness hides the land around them from other players. */
export function coverOfDarkness(s: AdventureState, index: (x: number, y: number, z: number) => number) {
  for (const o of s.objects) {
    if (!o.town || o.removed || o.owner < 0 || !hasSpecial(o, "necropolis", SPECIAL.s1)) continue;
    const team = s.players[o.owner]?.team;
    for (const other of s.players) {
      if (other.color === o.owner || !other.revealed.length || (team !== undefined && other.team === team)) continue;
      for (let dy = -20; dy <= 20; dy++)
        for (let dx = -20; dx <= 20; dx++) {
          if (dx * dx + dy * dy > 420) continue;
          const i = index(o.x - 2 + dx, o.y + dy, o.z);
          if (i >= 0) other.revealed[i >> 5] &= ~(1 << (i & 31));
        }
    }
  }
}

/** Inferno's Castle Gate: other towns of the player with one, whose gates are free. */
export function castleGateTowns(s: AdventureState, o: AdvObject, free: (town: AdvObject) => boolean, player = o.owner): AdvObject[] {
  if (!hasSpecial(o, "inferno", SPECIAL.s3)) return [];
  // From an ally's town too: to the hero's own player's gates (heroes.thelazy.net/index.php/Castle_Gate).
  return townsWith(s, player, "inferno", SPECIAL.s3).filter((t) => t !== o && free(t));
}

/** Start of a week: the Treasury pays 10% interest on the owner's gold. */
export function weeklyTownSpecials(s: AdventureState) {
  for (const p of s.players) {
    if (!p.alive) continue;
    const n = townsWith(s, p.color, "rampart", SPECIAL.s3).length;
    if (n) p.resources[6] += Math.floor((p.resources[6] * 10 * n) / 100);
  }
}

/** Kingdom-wide: Lighthouses (Castle) add sea movement, Necromancy Amplifiers raise more dead. */
export function lighthouseCount(s: AdventureState, player: number): number {
  return townsWith(s, player, "castle", SPECIAL.s1).length;
}
export function necromancyBoost(s: AdventureState, player: number): number {
  // HotA: 5% (the original's 10%), for each town with one (heroes.thelazy.net: "the effect is cumulative").
  return 0.05 * townsWith(s, player, "necropolis", SPECIAL.s2).length;
}
/** The Fair (Bulwark) counts as two more marketplaces. */
export function extraMarkets(s: AdventureState, player: number): number {
  return 2 * townsWith(s, player, "bulwark", SPECIAL.s1).length;
}
/** Thieves' Guild levels from Castle's Brotherhood of the Sword (+1) and the Cove's Thieves' Guild (+2). */
export function extraGuildLevels(s: AdventureState, player: number): number {
  return townsWith(s, player, "castle", SPECIAL.s3).length + 2 * townsWith(s, player, "cove", SPECIAL.s3).length;
}
/** The Altar of the Runes (Bulwark): the player's units start each battle a Rune Level up for each (heroes.thelazy.net: cumulative). */
export function startingRunes(s: AdventureState, player: number): number {
  return townsWith(s, player, "bulwark", SPECIAL.s3).length;
}

/** The Factory's Bank: gold now, paid back out of the town's income a day at a time. */
export const BANK_LOAN = { gold: 2500, daily: 500, days: 5 };

/** Why `player` can't borrow at the town's Bank now, or null. */
export function cannotBorrow(o: AdvObject, player: number): string | null {
  if (!o.town || o.owner !== player || !offers(o, "bank")) return "no Bank here";
  if (Number(o.data?.loanDays ?? 0) > 0) return "The last loan isn't paid back yet.";
  return null;
}

/** Trading services a map object or town offers (towns through their special buildings). */
export type Service = "artifacts" | "sellArtifacts" | "university" | "freelancers" | "transformer" | "altar" | "runes" | "bank";

/** The towns' buildings that offer a service: the faction, the building, what it offers. */
const SERVICE_BUILDINGS: [string, number, Service[]][] = [
  ["tower", SPECIAL.s1, ["artifacts", "sellArtifacts"]],
  ["dungeon", SPECIAL.s1, ["artifacts", "sellArtifacts"]],
  ["conflux", SPECIAL.s1, ["artifacts", "sellArtifacts"]],
  ["factory", SPECIAL.s3, ["artifacts", "sellArtifacts"]],
  ["conflux", SPECIAL.s2, ["university"]],
  ["stronghold", SPECIAL.s2, ["freelancers"]],
  ["necropolis", SPECIAL.s3, ["transformer"]],
  ["cove", SPECIAL.s4, ["altar"]],
  ["bulwark", SPECIAL.s2, ["runes"]],
  ["factory", SPECIAL.s1, ["bank"]],
];

/** The map objects that offer a service. */
function objectOffers(o: AdvObject, service: Service): boolean {
  switch (service) {
    case "artifacts":
      return o.type === 7;
    case "sellArtifacts":
      return o.type === 144 && o.subid === 7;
    case "university":
      return o.type === 104 || (o.type === 146 && o.subid === 0);
    case "freelancers":
      return o.type === 213;
    case "transformer":
      return o.type === 144 && o.subid === 1;
    case "altar":
      return o.type === 2;
    default:
      return false;
  }
}

export function offers(o: AdvObject, service: Service): boolean {
  return objectOffers(o, service) || SERVICE_BUILDINGS.some(([f, id, list]) => list.includes(service) && hasSpecial(o, f, id));
}

/** The service a town's built building `id` offers (its trading or teaching window), if any. */
export function townService(o: AdvObject, id: number): Exclude<Service, "sellArtifacts"> | undefined {
  const row = SERVICE_BUILDINGS.find(([f, b]) => b === id && hasSpecial(o, f, id));
  return row?.[2][0] as Exclude<Service, "sellArtifacts"> | undefined;
}

/** The towns' own buildings with a window of their own beyond the trading and teaching ones (townService). */
export type TownFeature = "market" | "manaVortex" | "portal" | "castleGate" | "ballistaYard" | "thievesGuild";
const TOWN_FEATURES: [string, number, TownFeature][] = [
  ["bulwark", SPECIAL.s1, "market"], // the Fair: the Marketplace at better rates
  ["dungeon", SPECIAL.s2, "manaVortex"],
  ["dungeon", SPECIAL.s3, "portal"], // Portal of Summoning
  ["inferno", SPECIAL.s3, "castleGate"],
  ["stronghold", SPECIAL.s3, "ballistaYard"],
  ["cove", SPECIAL.s3, "thievesGuild"],
];

/** What a town's built building `id` opens, when it's one of the factions' own (see TOWN_FEATURES). */
export function townFeature(o: AdvObject, id: number): TownFeature | undefined {
  return TOWN_FEATURES.find(([f, b]) => b === id && hasSpecial(o, f, id))?.[2];
}

/** Help for the defenders of a besieged town: morale, luck, primary skills and spell points. */
export function siegeBonuses(o: AdvObject): { morale: number; luck: number; primary: number[]; mana: number } {
  const b = { morale: 0, luck: 0, primary: [0, 0, 0, 0], mana: 0 };
  if (hasSpecial(o, "castle", SPECIAL.s3)) b.morale += 2; // Brotherhood of the Sword
  if (hasSpecial(o, "rampart", SPECIAL.s2)) b.luck += 2; // Fountain of Fortune
  if (hasSpecial(o, "fortress", SPECIAL.s2)) b.primary[0] += 2; // Glyphs of Fear
  if (hasSpecial(o, "fortress", SPECIAL.s3)) b.primary[1] += 2; // Blood Obelisk
  if (hasSpecial(o, "inferno", SPECIAL.s2)) b.primary[2] += 2; // Brimstone Stormclouds
  if (hasSpecial(o, "factory", SPECIAL.s2)) b.mana += 20; // Mana Generator
  return b;
}

/**
 * The window a town's built building `id` opens when clicked (the town screen's buildingClicked follows it; the wiki links
 * each building to the window's catalog view by it): the hall, fort, guild, tavern, market, shipyard, blacksmith, a
 * dwelling's recruiting, a faction's own window (TownFeature, or its trading or teaching Service), else the building's
 * picture and words ("info").
 */
export type TownWindow = "hall" | "fort" | "mageGuild" | "tavern" | "market" | "shipyard" | "blacksmith" | "dwelling" | Exclude<TownFeature, "market"> | Exclude<Service, "sellArtifacts"> | "info";
export function townWindow(o: AdvObject, id: number): TownWindow {
  if (id >= B.VILLAGE_HALL && id <= B.CAPITOL) return "hall";
  if (id >= B.FORT && id <= B.CASTLE) return "fort";
  if (id >= B.MAGE_GUILD_1 && id <= B.MAGE_GUILD_1 + 4) return "mageGuild";
  // The Tavern, or what replaces it (Castle's Brotherhood of the Sword).
  if (id === B.TAVERN || townInfo(o)?.buildings[id]?.upgrades === B.TAVERN) return "tavern";
  // The Silo, and the Bulwark's Fair (better rates), open the Marketplace.
  const feature = townFeature(o, id);
  if (id === B.MARKETPLACE || id === B.RESOURCE_SILO || feature === "market") return "market";
  if (feature === "thievesGuild" || feature === "manaVortex") return feature;
  if (id === B.SHIPYARD) return "shipyard";
  if (id === B.BLACKSMITH) return "blacksmith";
  if (recruitsLevel(o, id) >= 0) return "dwelling";
  if (feature) return feature;
  return townService(o, id) ?? "info";
}
