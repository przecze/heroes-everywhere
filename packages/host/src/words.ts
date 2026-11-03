// The host's own words in a player's language: what it says in a room's chat (a key and its values, said by each
// page in its own language: chatText in the lobby) and the "your turn" pings, made here in the language the
// player's page last said it speaks (mpLang). The lines are the interface's own tables (client/src/i18n, keyed by
// the English; plain data, no page needed); a language without the line, or none known, says the English.
import { DE } from "../../client/src/i18n/de.ts";
import { ES } from "../../client/src/i18n/es.ts";
import { FR } from "../../client/src/i18n/fr.ts";
import { PL } from "../../client/src/i18n/pl.ts";
import { RU } from "../../client/src/i18n/ru.ts";
import { UK } from "../../client/src/i18n/uk.ts";
import { PLAYER_NAMES } from "@heroes/core";
import type { ChatArg } from "./protocol.ts";

const TABLES: Record<string, Record<string, string>> = { pl: PL, de: DE, ru: RU, uk: UK, fr: FR, es: ES };

/** A language the host can speak, else undefined (English). */
export function knownLang(l: unknown): string | undefined {
  return typeof l === "string" && l in TABLES ? l : undefined;
}

/** `en` with %1, %2... filled, in language `lang` (English without one). */
export function say(lang: string | undefined, en: string, ...args: unknown[]): string {
  const line = (lang && TABLES[lang]?.[en]) || en;
  return line.replace(/%(\d)/g, (m, i) => (args[Number(i) - 1] === undefined ? m : String(args[Number(i) - 1])));
}

/** A chat line's value as words: a colour by its name, in that language. */
export function argText(lang: string | undefined, a: ChatArg): string {
  return typeof a === "object" ? say(lang, PLAYER_NAMES[a.colour] ?? String(a.colour)) : String(a);
}

/** The words for one language, as reportText takes them. */
export const wordsIn =
  (lang: string | undefined) =>
  (en: string, ...args: unknown[]): string =>
    say(lang, en, ...args);
