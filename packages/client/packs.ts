// The language packs the setup page offers: community translations of the original game's texts, each at a fixed
// commit (so what is fetched is what was checked). None of them is part of this repository; their licences are
// their authors' (as their repositories state them).

/** The buttons and windows with words in them that the game draws from a pack (others stay English). */
const SPRITES = /^(cb|scnr|sysob|so|scalbut|scbutt|sclgbut|scmdbut|trrecb|codefaul|icm01|ran|css|hisc|cmpscan)[^/]*\.def$/i;
const NONE = "none stated in its repository";

export const PACKS: Record<string, { name: string; word: string; repo: string; sha: string; licence: string; sprites: RegExp; fonts?: boolean }> = {
  pl: { name: "Polski", word: "polish", repo: "vcmi-mods/polish-translation", sha: "d790da9e735c2dca12673891f88c2d206d9b8be0", licence: NONE, sprites: SPRITES, fonts: true },
  de: { name: "Deutsch", word: "german", repo: "vcmi-mods/german-translation", sha: "d21ea2103c77d4c23a1f519b8e99dfd85ec85b2c", licence: NONE, sprites: SPRITES },
  fr: { name: "Français", word: "french", repo: "vcmi-mods/french-translation", sha: "15b241e28a9497e845324394ddb480c0a3027bfb", licence: NONE, sprites: SPRITES },
  es: { name: "Español", word: "spanish", repo: "vcmi-mods/spanish-translation", sha: "88ff8474da77e4d5eaecd1f4db4357923dda680c", licence: NONE, sprites: SPRITES },
};

/** Fetched with every pack: the HotA mod's words for HotA's own in that language, and VCMI's list of map objects (their numbers). */
export const SOURCES = {
  hotaMod: { repo: "vcmi-mods/horn-of-the-abyss", sha: "9b64ba62f39b50399f1390bd502c2593dc850fad", licence: "CC BY-SA 4.0 (its texts)" },
  vcmi: { repo: "vcmi/vcmi", sha: "a92e29e008049e09ceaf896b162e439a6d9ca3f3", licence: "GPL-2.0-or-later" },
};
