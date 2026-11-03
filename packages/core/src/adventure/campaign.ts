// Campaign play: heroes carried from scenario to scenario (by the scenario's travel options),
// hero placeholders filled with them, and the start bonus the player picked. After VCMI's
// CGameStateCampaign.
import { type CampaignBonus, type CampaignScenario, type H3Map, parseH3c, parseH3m } from "@heroes/formats";
import { CAMPAIGN_REGIONS } from "../campaignRegions.ts";
import { COMBOS, LOCKED, giveArtifact, giveScroll, initEquipment } from "./artifacts.ts";
import { maxMana } from "./magic.ts";
import { B } from "./town.ts";
import type { AdventureState, ArmySlot, Hero } from "./types.ts";
import type { World } from "./world.ts";

/** A hero as it leaves a won scenario. */
export interface CarriedHero {
  type: number;
  name: string;
  experience: number;
  level: number;
  /** Carried primary skills, or undefined to reset to the hero's class defaults (primary not kept). */
  primary?: [number, number, number, number];
  /** Carried secondary skills, or undefined to reset to the hero's starting skills (secondary not kept). */
  skills?: [number, number][];
  spells?: number[];
  equipped?: number[];
  backpack?: number[];
  /** The worn combinations (Hero.combos): which locked slots each one holds. */
  combos?: Hero["combos"];
  army: (ArmySlot | null)[];
  /** Artifacts that go on to the next scenario even if this hero doesn't (to the player's first hero; VCMI's transferMissingArtifacts). */
  transfer?: number[];
}

export interface CampaignStart {
  /** Heroes from the scenario the heroes come from (the last one won, or the bonus's), strongest first: for placeholders by strength. */
  carried?: CarriedHero[];
  /** Every hero carried so far, as last seen: for placeholders asking for a hero by name. */
  byType?: CarriedHero[];
  bonus?: CampaignBonus;
  /** HotA's script variables the scenarios before handed on, by name. */
  vars?: Record<string, number>;
}

/** "campaign:<file>#<scenario>" names a map inside a campaign. */
export function campaignMapRef(file: string, scenario: number): string {
  return `campaign:${file}#${scenario}`;
}

export function parseCampaignRef(ref: string): { file: string; scenario: number } | null {
  const m = /^campaign:([^#]+)#(\d+)$/.exec(ref);
  return m ? { file: m[1], scenario: Number(m[2]) } : null;
}

/** Reads a campaign file (the .h3c bytes from the archives). */
export function readCampaign(bytes: Uint8Array) {
  return parseH3c(bytes, (id) => CAMPAIGN_REGIONS[id]?.desc.length ?? 0);
}

/** The map of one scenario of a campaign. */
export function campaignScenarioMap(bytes: Uint8Array, scenario: number): H3Map {
  const c = readCampaign(bytes);
  const m = c.maps[scenario];
  if (!m) throw new Error(`campaign scenario ${scenario} has no map`);
  return parseH3m(m);
}

const CAMP_STRONGEST = -3;

/** Yog as Birth of a Barbarian's Wizard (Solmyr's slot), and Gem in New Beginning and Unholy Alliance. */
export const YOG_WIZARD = 45;
const GEM = 27;

/** Birth of a Barbarian's Yog: a level brings only Attack or Defense (the original's hard-coded case, VCMI's isCampaignYog). */
export const isCampaignYog = (s: AdventureState, h: Hero) => h.type === YOG_WIZARD && parseCampaignRef(s.mapFile)?.file === "yog";

/** Gem in New Beginning and Unholy Alliance is called a Sorceress (GENRLTXT 735; VCMI's isCampaignGem). */
export function campaignClassText(s: AdventureState, h: Hero): number | undefined {
  const file = parseCampaignRef(s.mapFile)?.file;
  return h.type === GEM && (file === "gem" || file === "final") ? 735 : undefined;
}

/** How strong a hero counts for "strongest hero" (level first, then experience). */
const power = (h: { level: number; experience: number }) => h.level * 1e7 + h.experience;

/**
 * The player's heroes as they leave a won scenario, whole (VCMI's setCurrentMapAsConquered): what
 * the next one lets them keep is decided as it starts (`trimCarried`, by that scenario's options).
 */
export function carryOver(s: AdventureState, player: number): CarriedHero[] {
  return s.heroes
    .filter((h) => !h.removed && h.owner === player)
    .sort((a, b) => power(b) - power(a))
    .map((h) => ({
      type: h.type,
      name: h.name,
      experience: h.experience,
      level: h.level,
      primary: [...h.primary] as [number, number, number, number],
      skills: (h.skills ?? []).map(([k, l]) => [k, l] as [number, number]),
      spells: h.spells && [...h.spells],
      equipped: [...(h.equipped ?? [])],
      backpack: [...(h.backpack ?? [])],
      ...(h.combos ? { combos: structuredClone(h.combos) } : {}),
      army: h.army.map((a) => (a ? { ...a } : null)),
    }));
}

/**
 * Heroes as a scenario takes them in, by its travel options (VCMI's trimCrossoverHeroesParameters):
 * what isn't kept goes back to the hero's own (experience, primary and secondary skills) or goes
 * (spells, artifacts but the ones named, creatures but the ones named). The named artifacts of a
 * hero who doesn't come along go to the player's first hero (`transfer`). `slayerThird`: Dragon
 * Slayer's third scenario, where no creatures come along (VCMI's special case).
 */
export function trimCarried(carried: CarriedHero[], next: CampaignScenario | undefined, slayerThird = false): CarriedHero[] {
  const keeps = next?.keeps ?? { experience: true, primary: true, secondary: true, spells: true, artifacts: true };
  const named = new Set(next?.keptArtifacts ?? []);
  const creatures = new Set(next?.keptCreatures ?? []);
  return carried.map((c) => {
    const kept = (a: number) => keeps.artifacts || named.has(a);
    const transfer = keeps.artifacts ? [] : [...(c.equipped ?? []), ...(c.backpack ?? [])].filter((a) => a >= 0 && named.has(a));
    const equipped = (c.equipped ?? []).map((a) => (a >= 0 && kept(a) ? a : a === LOCKED ? LOCKED : -1));
    // A combination left behind frees the slots it locked (Sandro's scenarios C and D dropped the Cloak but
    // kept its 5 locks). Without the record of which combination holds which lock (a hero carried before it
    // was kept), as many locks stay as the kept combinations need.
    const combos = Object.fromEntries(Object.entries(c.combos ?? {}).filter(([sl, k]) => equipped[Number(sl)] === k.combo));
    const held = new Set(Object.values(combos).flatMap((k) => k.locked));
    let room = c.combos ? 0 : equipped.reduce((n, a) => n + (COMBOS[a] ? COMBOS[a].length - 1 : 0), 0);
    equipped.forEach((a, sl) => {
      if (a === LOCKED && !held.has(sl) && room-- <= 0) equipped[sl] = -1;
    });
    return {
      ...c,
      experience: keeps.experience ? c.experience : 0,
      level: keeps.experience ? c.level : 1,
      primary: keeps.primary ? c.primary : undefined,
      skills: keeps.secondary ? c.skills : undefined,
      spells: keeps.spells ? c.spells : c.spells && [],
      equipped,
      ...(c.combos ? { combos } : {}),
      backpack: (c.backpack ?? []).filter(kept),
      army: c.army.map((a) => (a && !slayerThird && creatures.has(a.creature) ? { ...a } : null)),
      ...(transfer.length ? { transfer } : {}),
    };
  });
}

/** Turns a placeholder into a carried hero (its type, or the n-th strongest). */
export function heroFromCarried(base: Hero, c: CarriedHero): Hero {
  const h: Hero = {
    ...base,
    type: c.type,
    name: c.name,
    experience: c.experience,
    level: c.level,
    primary: c.primary ? [...c.primary] : [...base.primary],
    skills: c.skills ? c.skills.map(([k, l]) => [k, l]) : base.skills,
    spells: c.spells ? [...c.spells] : base.spells,
    equipped: c.equipped ? [...c.equipped] : base.equipped,
    backpack: c.backpack ? [...c.backpack] : base.backpack,
    combos: c.equipped ? c.combos && structuredClone(c.combos) : base.combos,
    // Creatures that came along join; with none, the placeholder's starting army stays.
    army: c.army.some((a) => a) ? c.army.map((a) => (a ? { ...a } : null)) : base.army,
  };
  h.mana = maxMana(h);
  return h;
}

/**
 * Picks the carried hero a placeholder asks for: a hero by name from every hero carried so far
 * (`byType`), or the n-th strongest of the source scenario's heroes, for a human player only (VCMI:
 * Spoils of War's Greed has the computer's placeholders by strength, which stay empty).
 */
export function carriedFor(start: CampaignStart, used: Set<number>, data: Record<string, unknown>, human: boolean): CarriedHero | undefined {
  const type = typeof data.hero === "number" ? data.hero : -1;
  if (type >= 0) {
    const c = [...(start.byType ?? []), ...(start.carried ?? [])].find((x) => x.type === type && !used.has(x.type));
    if (c) used.add(c.type);
    return c;
  }
  if (!human) return undefined;
  const rank = Number(data.power ?? 0);
  const left = (start.carried ?? []).filter((x) => !used.has(x.type));
  const c = left[rank] ?? left[0];
  if (c) used.add(c.type);
  return c;
}

/** The start bonus the player chose for this scenario. */
export function applyCampaignBonus(s: AdventureState, w: World, player: number, bonus: CampaignBonus) {
  const p = s.players[player];
  if (!p) return;
  const heroes = s.heroes.filter((h) => !h.removed && h.owner === player);
  const target = (id: number) => (id === CAMP_STRONGEST || id < 0 ? [...heroes].sort((a, b) => power(b) - power(a))[0] : heroes.find((h) => h.type === id));
  switch (bonus.type) {
    case "resource": {
      // 0xFD: wood and ore; 0xFE: mercury, sulfur, crystal and gems.
      const ids = bonus.resource === 0xfd ? [0, 2] : bonus.resource === 0xfe ? [1, 3, 4, 5] : [bonus.resource];
      for (const r of ids) if (r >= 0 && r < 7) p.resources[r] += bonus.amount;
      return;
    }
    case "building": {
      const town = s.objects.find((o) => o.town && o.owner === player);
      if (town?.town && !town.town.built.includes(bonus.building)) town.town.built.push(bonus.building);
      if (town?.town && bonus.building >= B.DWELLING && bonus.building < B.DWELLING + 7) town.town.available[bonus.building - B.DWELLING] ||= 0;
      return;
    }
  }
  if (bonus.type === "previousHeroes" || bonus.type === "hero") return;
  const h = target(bonus.hero);
  if (!h) return;
  switch (bonus.type) {
    case "spell":
    case "scroll":
      if (bonus.type === "scroll") giveScroll(h, w.data.artifacts, bonus.spell);
      else if (h.spells && !h.spells.includes(bonus.spell)) h.spells.push(bonus.spell);
      return;
    case "creatures": {
      const same = h.army.findIndex((a) => a?.creature === bonus.creature);
      const free = h.army.findIndex((a) => !a);
      if (same >= 0) h.army[same]!.count += bonus.amount;
      else if (free >= 0) h.army[free] = { creature: bonus.creature, count: bonus.amount };
      return;
    }
    case "artifact":
      initEquipment(h);
      giveArtifact(h, w.data.artifacts, bonus.artifact);
      return;
    case "primary":
      bonus.amounts.forEach((n, i) => (h.primary[i] += n));
      h.mana = maxMana(h);
      return;
    case "secondary": {
      const skills = (h.skills ??= []);
      const have = skills.find(([k]) => k === bonus.skill);
      if (have) have[1] = Math.max(have[1], bonus.mastery);
      else if (skills.length < 8) skills.push([bonus.skill, bonus.mastery]);
      return;
    }
  }
}
