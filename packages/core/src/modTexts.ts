// The HotA mod's words for what the original's files don't say (made in packages/vcmi-data from the mod's english.json).
export { MOD_TEXTS } from "../../vcmi-data/src/modTexts.ts";

/** A text without the "{Title}\n\n" the mod puts before it. */
export const untitled = (text: string) => text.replace(/^\{[^}]*\}\n\n/, "");
