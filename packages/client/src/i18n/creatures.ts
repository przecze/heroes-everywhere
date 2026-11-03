// A creature's name in the interface's language: from the VCMI packs and the HotA mod (creatureNames.ts), else
// the game's English. The core's tables carry the English; this sets the names the screens read, in place, so
// every window that shows a creature (and the battle's own copy) follows the Options → Language choice.
import type { CreatureStats } from "@heroes/core";
import { has } from "./languages.ts";
import { learnEnglish } from "./text.ts";
import { RELEASE_CREATURES } from "./release.ts";
import { DE_CREATURE_NAMES, ES_CREATURE_NAMES, FR_CREATURE_NAMES, PL_CREATURE_NAMES, RU_CREATURE_NAMES, UK_CREATURE_NAMES } from "./creatureNames.ts";

export const NAMES: Record<string, Record<string, [string, string]>> = { pl: PL_CREATURE_NAMES, de: DE_CREATURE_NAMES, ru: RU_CREATURE_NAMES, uk: UK_CREATURE_NAMES, fr: FR_CREATURE_NAMES, es: ES_CREATURE_NAMES };
const english = new WeakMap<CreatureStats, [string, string, string?]>();

/** Sets each creature's name and plural for the language now chosen (idempotent; cheap enough per battle update). */
export function localizeCreatures(creatures: CreatureStats[] | Record<number, CreatureStats>, language: string): void {
  const names = has(language, "creatures") ? NAMES[language] : undefined;
  for (const c of Object.values(creatures)) {
    if (!c) continue;
    let en = english.get(c);
    if (!en) english.set(c, (en = [c.name, c.plural, c.abilityText]));
    // (A language with its own release's files: its CRTRAITS' names and ability lines first, HotA's own past it from the table.)
    const own = names ? RELEASE_CREATURES[language]?.[c.key] : undefined;
    const [singular, plural] = own || names?.[c.key] || en;
    c.name = singular;
    c.plural = plural;
    learnEnglish(language, en[0], singular);
    learnEnglish(language, en[1], plural);
    if (c.abilityText !== undefined || en[2] !== undefined) c.abilityText = own?.[2] ?? en[2];
  }
}
