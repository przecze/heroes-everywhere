// The language packs' words, fetched from /l10n/<lang>/ where the player added a pack on the setup page
// (setup/pack.ts); a language without one is drawn in English (and in its interface texts, which are ours).
import { DE_CREATURE_NAMES, ES_CREATURE_NAMES, FR_CREATURE_NAMES, PL_CREATURE_NAMES } from "./creatureNames.ts";
import { NAMES as TOWNS } from "./towns.ts";

const CREATURES: Record<string, Record<string, [string, string]>> = { pl: PL_CREATURE_NAMES, de: DE_CREATURE_NAMES, fr: FR_CREATURE_NAMES, es: ES_CREATURE_NAMES };
const json = (l: string, file: string): Promise<unknown> =>
  fetch(`/l10n/${l}/${file}`)
    .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : undefined))
    .catch(() => undefined);

/** The names tables by language (names.ts reads them), filled in when fetched. */
export const NAMES_PACKS: Record<string, unknown> = {};
const loading = new Map<string, Promise<void>>();

/** Fetches language `l`'s pack, once: its names, creatures and towns into the tables the screens read. */
export function loadPack(l: string): Promise<void> {
  if (!(l in CREATURES)) return Promise.resolve();
  let p = loading.get(l);
  if (!p)
    loading.set(
      l,
      (p = Promise.all([json(l, "names.json"), json(l, "extras.json")]).then(([names, extras]) => {
        if (names) NAMES_PACKS[l] = names;
        const e = extras as { creatures?: Record<string, [string, string]>; towns?: Record<string, string> } | undefined;
        if (e?.creatures) Object.assign(CREATURES[l], e.creatures);
        if (e?.towns) TOWNS[l] = e.towns;
      })),
    );
  return p;
}

/** The original's text files' lines in `l`: {file: {row: text}}. */
export const corePack = (l: string): Promise<unknown> => (l in CREATURES ? json(l, "core.json").then((d) => d ?? {}) : Promise.resolve({}));
/** The scenario list's map names and descriptions in `l`: {map: [name, description]}. */
export const mapsPack = (l: string): Promise<unknown> => (l in CREATURES ? json(l, "maps.json").then((d) => d ?? {}) : Promise.resolve({}));
