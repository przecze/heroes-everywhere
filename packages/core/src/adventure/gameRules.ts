// A game's own choices beyond the map (New Game -> Advanced Options): playing without the content HotA
// added (its towns, creatures, artifacts, heroes, skills) and HotA's famous rule changes, each of which
// can be put back to the Shadow of Death's. Everything defaults to HotA; only what is turned off is kept.
import { HOTA_CREATURES } from "../hotaData.ts";
import { HERO_INFO } from "../heroData.ts";
import { HOTA_ARTIFACTS } from "./artifacts.ts";

export const RULE_KEYS = ["dwellingStock", "towerSkills", "moatDefenders", "machineCap", "aiFair", "newAi"] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
/** The rules a game turned off (HotA's is the default, so only `false` is stored). */
export type RuleOverrides = Partial<Record<RuleKey, false>>;

// i18n-keys
/** `ours`: a rule of this remake's (on = ours, off = the original's), not one of HotA's changes. */
export const RULE_INFO: Record<RuleKey, { letter: string; name: string; help: string; ours?: true }> = {
  dwellingStock: { letter: "d", name: "Dwellings keep their stock", help: "HotA: creatures in the dwellings you own pile up from week to week. Off (Shadow of Death): every dwelling on the map is refilled to one week's growth." },
  towerSkills: { letter: "t", name: "Arrow towers use the hero's skills", help: "HotA: an arrow tower shoots with 10 Attack plus the defending hero's, Archery and the target's Armorer count. Off (Shadow of Death): a fixed damage from the town's buildings." },
  moatDefenders: { letter: "m", name: "The moat hurts defenders too", help: "HotA: a defender wading into the moat is stopped and hurt like an attacker. Off (Shadow of Death): only attackers are." },
  machineCap: { letter: "c", name: "War machines survive a blow", help: "HotA: the Ballista, Cannon, Catapult and First Aid Tent lose at most 40% of their health to any one blow. Off (Shadow of Death): one blow can destroy them." },
  aiFair: { letter: "f", name: "The computer sees only what it explored", help: "On: the computer plays from the same view a player has: no heroes, towns or treasure under the shroud, Disguise not seen through, no rivals' resources or spellbooks. Off (the original's): the computer knows the whole map and where every hero is.", ours: true },
  newAi: { letter: "n", name: "The New AI", help: "On: computer players without a chosen personality play with the New AI (it plans its whole town and army towards goals and plays every fight out before taking it). Off: the earlier computer, led by the map's AI tactic as in the original.", ours: true },
};

export const ruleOn = (r: RuleOverrides | undefined, k: RuleKey): boolean => r?.[k] !== false;

/** The rules turned off, as letters (a random map's name carries them). */
export const rulesLetters = (r: RuleOverrides | undefined): string => RULE_KEYS.filter((k) => r?.[k] === false).map((k) => RULE_INFO[k].letter).join("");
export function rulesFromLetters(letters: string | undefined): RuleOverrides | undefined {
  const out: RuleOverrides = {};
  for (const k of RULE_KEYS) if (letters?.includes(RULE_INFO[k].letter)) out[k] = false;
  return Object.keys(out).length ? out : undefined;
}

/** Content HotA added, which "without HotA content" leaves out (the first id of each kind). */
export const HOTA_FIRST_CREATURE = 150;
export const HOTA_FACTION_LIST = ["cove", "factory", "bulwark"];
/** Interference and Runes, HotA's secondary skills (skills.ts order). */
export const HOTA_SKILL_IDS = [28, 29];
export const HOTA_FIRST_HERO = 156;

/**
 * The towns a colour may be given at the start, as a mask of FACTIONS: a map of the original's (no HotA header) that
 * allows every town of the original's allows HotA's three too, as HotA does (its own maps say so themselves).
 */
export function startFactionMask(mask: number, hotaMap: boolean): number {
  const classic = (1 << 9) - 1;
  return !hotaMap && (mask & classic) === classic ? mask | (0b111 << 9) : mask;
}

export const isHotaCreature = (id: number): boolean => id >= HOTA_FIRST_CREATURE;
export const isHotaArtifact = (id: number): boolean => id in HOTA_ARTIFACTS;
export const isHotaHero = (id: number): boolean => id >= HOTA_FIRST_HERO;
export const hotaHeroIds = (): number[] => Object.keys(HERO_INFO).map(Number).filter(isHotaHero);
export const hotaArtifactIds = (): number[] => Object.keys(HOTA_ARTIFACTS).map(Number);
export const hotaCreatureIds = (): number[] => HOTA_CREATURES.map((c) => c.id);

/** The bans that keep random draws (artifacts, skill offers, heroes) free of HotA's additions. */
export function addNoHotaBans(map: { banned?: { artifacts: number[]; spells: number[]; skills: number[] }; bannedHeroes?: number[] }) {
  const banned = (map.banned ??= { artifacts: [], spells: [], skills: [] });
  for (const a of hotaArtifactIds()) if (!banned.artifacts.includes(a)) banned.artifacts.push(a);
  for (const k of HOTA_SKILL_IDS) if (!banned.skills.includes(k)) banned.skills.push(k);
  map.bannedHeroes = [...new Set([...(map.bannedHeroes ?? []), ...hotaHeroIds()])].sort((a, b) => a - b);
}
