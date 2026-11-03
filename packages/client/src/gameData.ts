import { GAME_LINE_FILES, type GameData, buildGameData } from "@heroes/core";
import { fetchEnglish } from "./assets.ts";
import { localizeCreatures } from "./i18n/creatures.ts";
import { lang } from "./i18n/index.ts";
import { loadReleaseNames, localizeNames } from "./i18n/names.ts";
import { rmgTemplatesFrom } from "./rmgSource.ts";

let data: Promise<GameData> | null = null;

/** Creature, object and hero tables, fetched once per page: the English release's, with the names of the
 *  interface's language set in place over them (names.ts), so a switch of language needs no new tables. */
export function loadData(): Promise<GameData> {
  const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
  data ??= Promise.all([Promise.all(files.map((f) => fetchEnglish(`${f}.txt`))), rmgTemplates(), loadReleaseNames(lang())]).then(([bytes, rmg]) => {
    const built = buildGameData({ ...(Object.fromEntries(files.map((f, i) => [f, bytes[i]])) as Record<(typeof files)[number], Uint8Array>), rmg });
    localizeCreatures(built.creatures, lang());
    localizeNames(built, lang());
    return built;
  });
  return data;
}

/**
 * The random map templates: HotA's (/res/rmgtemplates.txt), else the original's RMG.TXT from the
 * archives, else none; with HotA's from the HotA mod's VCMI files when the server has none of its own.
 * (The game server's worker makes the same, so both make the same maps.)
 */
export function rmgTemplates(): Promise<Uint8Array | undefined> {
  return rmgTemplatesFrom((name) => fetchEnglish(name).catch(() => undefined));
}

