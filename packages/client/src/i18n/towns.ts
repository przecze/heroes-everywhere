// The towns' names in a language: from its pack (pack.ts) or its own release's files, else English.
import { has, lang, type Text, fallback } from "./index.ts";
import { RELEASE_TOWNS } from "./release.ts";

/** By language, filled in by pack.ts from the pack the player added. */
export const NAMES: Record<string, Record<string, string>> = {};

/** A town's name ("castle" is Castle, Zamek, Schloss) in the interface's language. */
export function townName(faction: string): Text {
  const l = lang();
  return ((has(l, "towns") ? (NAMES[l] ?? RELEASE_TOWNS[l])?.[faction] : undefined) ?? fallback(faction[0].toUpperCase() + faction.slice(1), "town kind")) as Text;
}
