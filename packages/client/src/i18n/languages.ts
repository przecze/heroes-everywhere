// The languages the game speaks, in one place: each one's name, its plural rule, and where each kind of text the
// player reads comes from in it. A kind a language has no source for is drawn in English. Every module that puts
// text of a kind on screen asks `has(lang, kind)` here (never `l === "pl" || l === "de"`), so a language gains a
// kind by adding its data and its line here; i18n.test.ts checks each module has the data this table promises, and
// tools/i18n/coverage.ts reads every catalog view in every language to count what is still drawn in English
// (docs/i18n/coverage.md). Tiny on purpose: the game server's worker imports it too.

/** The kinds of text on screen, by where they come from. */
export const KINDS = {
  interface: "Our own interface texts: menus, toasts, ☰ views, options (pl.ts, de.ts... keyed by the English; tr / trn)",
  welcome: "The welcome tour (welcome.ts TOURS)",
  feedback: "The Feedback box's words (feedback/text.ts)",
  creatures: "Creature names and plurals (creatureNames.ts)",
  abilities: "Creatures' ability lines, sentence by sentence (abilities.ts)",
  names: "Skill, class, hero, spell, artifact, building, object and terrain names; skill and specialty texts (names-<lang>.json, tools/i18n/names.ts)",
  towns: "Town (faction) names (towns.ts)",
  gameTexts: "The original's text files row by row: ADVEVENT, GENRLTXT, HELP... (core-<lang>.json, the VCMI packs; ui/gameText.ts)",
  battleLog: "The battle log: GENRLTXT's lines and our own (genrltxt.ts, battleOurs.ts)",
  mapList: "The scenario list's map names and descriptions (maps-<lang>.json; maps.ts)",
  mapTexts: "A map's own texts in play: signs, events, seers, rumours (public/l10n/<lang>/maps-N.json; mapText.ts)",
  art: "Pictures with words in them: main menu buttons, a few DEFs (public/l10n/<lang>/, l10nArt.ts)",
} as const;
export type Kind = keyof typeof KINDS;

export interface Language {
  name: string;
  /** Which form of a counted text (trn) a count takes: 0 one, 1 few, 2 many (two forms: 0 and 1). */
  plural: (n: number) => number;
  /** The kinds it has, with where the words come from. */
  sources: Partial<Record<Kind, string>>;
  /**
   * Its own release's game files, served beside the game at /l10n/<code>/ (never in the repo; l10nArt.ts unpacks
   * them from the project's files): text/ every text file row for row like the English, sprites/ the DEFs with
   * words, fonts/ the fonts it is drawn in; `encoding` their code page. The page reads them in place of the
   * English (i18n/release.ts) where a pl / de table would stand.
   */
  release?: { encoding: string };
}

const slavic = (one: (n: number) => boolean) => (n: number) => {
  const a = Math.abs(n);
  if (one(a)) return 0;
  return a % 10 >= 2 && a % 10 <= 4 && (a % 100 < 12 || a % 100 > 14) ? 1 : 2;
};
const ours = "machine-translated";

export const LANGUAGES = {
  en: { name: "English", plural: (n: number) => (Math.abs(n) === 1 ? 0 : 1), sources: {} },
  pl: {
    name: "Polski",
    plural: slavic((a) => a === 1),
    sources: {
      interface: ours, welcome: ours, feedback: ours, abilities: ours,
      creatures: "VCMI's Polish pack and the HotA mod", names: "VCMI's Polish pack and the HotA mod", towns: "VCMI's Polish pack",
      gameTexts: "VCMI's Polish pack", battleLog: "VCMI's Polish pack; our lines machine-translated", mapList: "VCMI's Polish pack and the HotA mod",
      mapTexts: "VCMI's Polish pack and the HotA mod", art: "the HotA mod's Polish buttons and VCMI's Polish DEFs",
    },
  },
  de: {
    name: "Deutsch",
    plural: (n: number) => (Math.abs(n) === 1 ? 0 : 1),
    sources: {
      interface: ours, welcome: ours, feedback: ours, abilities: ours,
      creatures: "VCMI's German pack and the HotA mod", names: "VCMI's German pack and the HotA mod", towns: "VCMI's German pack",
      gameTexts: "VCMI's German pack", battleLog: "VCMI's German pack; our lines machine-translated", mapList: "VCMI's German pack and the HotA mod",
      mapTexts: "VCMI's German pack and the HotA mod", art: "the HotA mod's German buttons and VCMI's German DEFs",
    },
  },
  ru: {
    name: "Русский",
    plural: slavic((a) => a % 10 === 1 && a % 100 !== 11),
    sources: {
      interface: ours, welcome: ours, feedback: ours,
      creatures: "the Russian release's CRTRAITS (the HotA installer), HotA's own from the HotA mod", names: "the Russian release's text files and the HotA mod's Russian",
      towns: "the Russian release's TOWNTYPE and the HotA mod's Russian", gameTexts: "the Russian release's text files (the HotA installer's HotA_lng.lod)",
      battleLog: "the Russian release's GENRLTXT; our lines machine-translated", art: "the Russian release's DEFs (HotA_lng.lod)",
      mapList: "HotA's Russian maps (the HotA installer)", mapTexts: "HotA's Russian maps (the HotA installer)",
    },
    release: { encoding: "windows-1251" },
  },
  uk: {
    name: "Українська",
    plural: slavic((a) => a % 10 === 1 && a % 100 !== 11),
    sources: { interface: ours, welcome: ours, feedback: ours, creatures: "the HotA mod; the original's machine-written" },
  },
  fr: {
    name: "Français",
    plural: (n: number) => (Math.abs(n) < 2 ? 0 : 1),
    sources: {
      interface: ours, welcome: ours, feedback: ours,
      creatures: "VCMI's French pack and the HotA mod", names: "VCMI's French pack and the HotA mod", towns: "VCMI's French pack and the HotA mod",
      gameTexts: "VCMI's French pack", battleLog: "VCMI's French pack; our lines machine-translated", mapList: "VCMI's French pack and the HotA mod",
      mapTexts: "VCMI's French pack and the HotA mod", art: "VCMI's French DEFs",
    },
  },
  es: {
    name: "Español",
    plural: (n: number) => (Math.abs(n) === 1 ? 0 : 1),
    sources: {
      interface: ours, welcome: ours, feedback: ours,
      creatures: "VCMI's Spanish pack and the HotA mod", names: "VCMI's Spanish pack and the HotA mod", towns: "VCMI's Spanish pack and the HotA mod",
      gameTexts: "VCMI's Spanish pack", battleLog: "VCMI's Spanish pack; our lines machine-translated", mapList: "VCMI's Spanish pack and the HotA mod",
      mapTexts: "VCMI's Spanish pack and the HotA mod", art: "the HotA mod's Spanish buttons and VCMI's Spanish DEFs",
    },
  },
} satisfies Record<string, Language>;

export type Lang = keyof typeof LANGUAGES;
export type OtherLang = Exclude<Lang, "en">;
/** The languages offered, English first: [code, own name]. */
export const LANGS = Object.entries(LANGUAGES).map(([code, l]) => [code, l.name]) as [Lang, string][];
export const isLang = (l: unknown): l is Lang => typeof l === "string" && l in LANGUAGES;

/** Language `l` has its own words for this kind of text (else they are drawn in English). */
export function has(l: string, kind: Kind): l is OtherLang {
  return isLang(l) && !!(LANGUAGES[l].sources as Partial<Record<Kind, string>>)[kind];
}

/** Language `l`'s own release's game files (served at /l10n/<l>/), when it has them. */
export function release(l: string): { encoding: string } | undefined {
  return isLang(l) ? (LANGUAGES[l] as Language).release : undefined;
}
