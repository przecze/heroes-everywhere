// Our own interface texts in the player's language (Options → Language). The game's own texts
// (creatures, spells, the original's messages) come from the game files and follow their language;
// only the texts this client makes up go through `tr`. Keyed by the English text itself, so a missing
// translation shows the English. `npm test` (i18n.test.ts) fails on a `tr` text without a Polish and
// German line, and on a made-up text handed to the interface without `tr`.
import { settings } from "../settings.ts";
import { DE } from "./de.ts";
import { PL } from "./pl.ts";
import { RU } from "./ru.ts";
import { UK } from "./uk.ts";
import { FR } from "./fr.ts";
import { ES } from "./es.ts";

import { QUOTED } from "./quoted.ts";
import { LANGUAGES, isLang, type Lang, type OtherLang } from "./languages.ts";
import { fallback, knownWords, noteEnglish, setLangSource, setTableSource, type Text } from "./text.ts";

export { type Text, said, num, NONE, fallback, join, fmt, englishShown } from "./text.ts";

export { LANGS, has, type Lang } from "./languages.ts";
// (The quoted lines: the words the interface quotes from the HotA mod and the game, quoted.ts.)
const TABLES: Record<OtherLang, Record<string, string>> = { pl: { ...QUOTED.pl, ...PL }, de: { ...QUOTED.de, ...DE }, ru: { ...QUOTED.ru, ...RU }, uk: { ...QUOTED.uk, ...UK }, fr: { ...QUOTED.fr, ...FR }, es: { ...QUOTED.es, ...ES } };

/** The player invite's language (from /__whoami), kept so the next page load starts in it. */
export function setInviteLang(l: string | undefined) {
  try {
    if (isLang(l)) localStorage.setItem("heroes.testerLang", l);
  } catch {
    // not kept
  }
}

/** The interface's language: the one chosen in Options, else the invite's, else the browser's, else English. */
export function lang(): Lang {
  const chosen = settings().language;
  if (chosen !== "auto") return chosen;
  let invite: string | null = null;
  try {
    invite = localStorage.getItem("heroes.testerLang");
  } catch {
    // none
  }
  if (isLang(invite)) return invite;
  const browser = (typeof navigator === "undefined" ? "" : navigator.language).slice(0, 2);
  return isLang(browser) ? browser : "en";
}

const fill = (s: string, args: unknown[]) => s.replace(/%(\d)/g, (m, i) => (Number(i) >= 1 && Number(i) <= args.length ? String(args[Number(i) - 1]) : m));

/** `en` in the interface's language when our tables have it, else undefined (nothing noted). */
export function trKnown(en: string): string | undefined {
  const l = lang();
  return l === "en" ? undefined : TABLES[l][en];
}

/** `en` in the interface's language, its %1, %2... filled with `args`. */
export function tr(en: string, ...args: unknown[]): Text {
  const l = lang();
  const line = l === "en" ? en : TABLES[l][en];
  if (line === undefined && !isOurs(en)) noteEnglish(en, "tr");
  return fill(line ?? en, args) as Text;
}
setLangSource(lang);
setTableSource((l) => (l === "en" ? undefined : TABLES[l as OtherLang]));

/** `en` in language `l` (not the interface's): the chat's timeline lines in each language room. */
export function trIn(l: Lang, en: string, ...args: unknown[]): Text {
  return fill((l === "en" ? undefined : TABLES[l][en]) ?? en, args) as Text;
}

/** The English text a line of the interface's language was made from (as `tr` found it), else the text itself: for lookups keyed by English names. */
export function untr(text: string): string {
  const l = lang();
  if (l === "en") return text;
  const table = TABLES[l];
  let rev = reversed.get(l);
  if (!rev) reversed.set(l, (rev = new Map(Object.entries(table).map(([en, t]) => [t, en]))));
  return rev.get(text) ?? text;
}
const reversed = new Map<Lang, Map<string, string>>();

/** A text drawn in language `from`, in the interface's language now (a text that isn't one of ours stays as it is). */
export function retranslate(text: string, from: Lang): Text {
  if (from === "en") return text in PL ? tr(text) : (text as Text);
  let rev = reversed.get(from);
  if (!rev) reversed.set(from, (rev = new Map(Object.entries(TABLES[from]).map(([en, t]) => [t, en]))));
  const english = rev.get(text);
  return english === undefined ? (text as Text) : tr(english);
}

/** The owner's name as players see it: the owner in Polish, the owner in the other languages. */
export const ownerName = (): Text => "the owner" as Text;

/** Called when the interface's language changes, with the one it was: what is on screen follows (windows open then too). */
export const languageChanged = new Set<(from: Lang) => void>();

/**
 * A text that changes with a count: `one` for 1, else `many` (English), %1 the count. The Polish line
 * (under the `many` key) gives three forms "1|2-4|5+" (as "jeden stos|%1 stosy|%1 stosów"), Russian and Ukrainian three the same way, German, French and Spanish two
 * (the rule that picks one: languages.ts `plural`).
 */
export function trn(n: number, one: string, many: string, ...args: unknown[]): Text {
  return trnIn(lang(), n, one, many, ...args);
}
/** `trn` in language `l` (not the interface's). */
export function trnIn(l: Lang, n: number, one: string, many: string, ...args: unknown[]): Text {
  const line = l === "en" ? undefined : TABLES[l][many];
  if (!line) return fill(n === 1 ? one : many, [n, ...args]) as Text;
  const forms = line.split("|");
  const k = LANGUAGES[l].plural(n);
  return fill(forms[Math.min(k, forms.length - 1)], [n, ...args]) as Text;
}

/** The table for a language (the test reads them). */
export const table = (l: OtherLang) => TABLES[l];

/** An English text kept as it is here and put through `tr` where it's drawn (a button's title the probes look for by name). */
export const en = (text: string) => text;

/** `tr` of a text that may be missing (undefined stays undefined). */
export const maybeTr = (text: string | undefined): Text | undefined => (text === undefined ? undefined : tr(text));

/**
 * A text the rules wrote (an event's `text` where it has no line of the game files, an object's own words): ours
 * through `tr` when a table has it, else shown as it is and noted (`englishShown`) in another language.
 */
export const rulesText = (text: string | null | undefined, where = "rules"): Text => {
  if (!text) return "" as Text;
  if (text in PL) return tr(text);
  if (isOurs(text)) return text as Text;
  const known = knownWords(text) ?? filledIn(text);
  if (known !== undefined) return known as Text;
  // "{Name}\n\nwords" (an object's window: its name as the title, then what happens): each part on its own.
  const titled = /^\{([^}\n]+)\}(?:\n\n([\s\S]*))?$/.exec(text);
  if (titled) return `{${rulesText(titled[1], `${where} title`)}}${titled[2] !== undefined ? `\n\n${rulesText(titled[2], where)}` : ""}` as Text;
  // (A line of ours already filled in and translated, handed through again: "Czerwony wykonuje ruch…" is no English.)
  if (filledOurs(text)) return text as Text;
  return fallback(text, where);
};

/** The rules' sentences with names in them (`${h.name} already knows it.`, a table's "%1 already knows it."): every key with %1... as a pattern. */
let patterns: { re: RegExp; key: string; order: number[] }[] | null = null;
const filledIn = (text: string): Text | undefined => {
  if (lang() === "en") return undefined;
  patterns ??= Object.keys(PL)
    .filter((k) => /%\d/.test(k) && /[A-Za-z]{3}/.test(k.replace(/%\d/g, "")))
    .map((key) => ({
      key,
      order: [...key.matchAll(/%(\d)/g)].map((m) => Number(m[1])),
      re: new RegExp(`^${key.split(/%\d/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)")}$`, "s"),
    }))
    // (The most words first: "%1 situations and how..." before "%1 and %2", which matches it too.)
    .sort((a, b) => b.key.replace(/%\d/g, "").length - a.key.replace(/%\d/g, "").length);
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const args: string[] = [];
    p.order.forEach((n, i) => (args[n - 1] = m[i + 1]));
    return tr(p.key, ...args);
  }
  return undefined;
};
/** Whether a text is a line of ours with %1... filled in, in the interface's language. */
const ownPatterns = new Map<Lang, RegExp[]>();
const filledOurs = (text: string): boolean => {
  const l = lang();
  if (l === "en") return false;
  let res = ownPatterns.get(l);
  if (!res) {
    res = Object.values(TABLES[l])
      .filter((v) => /%\d/.test(v) && !v.includes("|") && v.replace(/%\d/g, "").replace(/[\s\p{P}]/gu, "").length >= 4)
      .map((v) => new RegExp(`^${v.split(/%\d/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)")}$`, "su"));
    ownPatterns.set(l, res);
  }
  return res.some((re) => re.test(text));
};
/** Whether a text already is one of ours in the interface's language (a line of its table). */
const isOurs = (text: string) => {
  const l = lang();
  if (l === "en") return false;
  let rev = reversed.get(l);
  if (!rev) reversed.set(l, (rev = new Map(Object.entries(TABLES[l]).map(([en, t]) => [t, en]))));
  return rev.has(text);
};

/** A reason the rules give (English, null when there is none), in the interface's language: every window shows them through this. */
export const reason = (why: string | null | undefined): Text | null => (why ? rulesText(why, "reason") : null);
