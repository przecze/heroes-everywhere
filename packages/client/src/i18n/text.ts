// A text the player reads: the only kind of string the interface draws. Every window title, label, pop-up, message,
// button caption and status line takes a `Text`, never a bare string, so English typed into a call can't reach the
// screen: tsc refuses it. A `Text` comes only from what knows the player's language:
//   - `tr` / `trn` (our own texts, i18n/index.ts),
//   - the game's text layer (ui/gameText.ts: resolveText, gameLines, textTable...), the names layer (map/describe.ts
//     objectName, ui/resourceNames.ts...), which read the language's own files,
//   - `said(x)`: a text that already is in the player's language or in none: a creature's, hero's or artifact's name
//     from the tables the names layer translated in place, a map's own words (mapText.ts), what a player typed, a number;
//   - `fallback(x)`: the English the game files themselves would say when the language's file lacks the line; in any
//     other language it is noted (`englishShown`) for the probes and the Feedback note, so a leak is found, not guessed.
// Joining texts: `join` / the `fmt` tag (`fmt\`${name}, ${kind}\``), whose literal pieces may hold no words (i18nScan.ts).
// The owner 2026-11-01: "I thought every piece of text displayed to the user is wrapped in an object that at runtime picks
// which language version to show, and we have an architectural solution that doesn't allow bare strings".
declare const TEXT: unique symbol;
/** A text in the player's language (see the top of i18n/text.ts). */
export type Text = string & { readonly [TEXT]: true };

/** A text that is already in the player's language, or in none (a name the names layer translated, a number, a player's words). */
export const said = <T extends string | null | undefined>(s: T): T extends string ? Text : T => s as never;

/** A number as shown. */
export const num = (n: number): Text => String(n) as Text;

/** The empty text. */
export const NONE = "" as Text;

/** English drawn in another language: what `fallback` noted, newest last (the probes read it; Feedback notes carry it). */
export const englishShown: { text: string; where: string }[] = [];
// (On every page, the menu's too, for the probes: `window.heroes.english()` is the game page's.)
if (typeof window !== "undefined") (window as unknown as { __english?: typeof englishShown }).__english = englishShown;
let currentLang: () => string = () => "en";
/** (i18n/index.ts tells it the interface's language; kept apart so this file imports nothing.) */
export const setLangSource = (f: () => string) => (currentLang = f);

let known: (english: string, lang: string) => string | undefined = () => undefined;
/** (names.ts hands on the HotA mod's words for the rules' English: HotA's objects' texts.) */
export const setKnownWords = (f: typeof known) => (known = f);
/** The rules' English `s` in the interface's language when a table of the game's has it (HotA's objects' texts), else undefined. */
export const knownWords = (s: string): string | undefined => (currentLang() === "en" ? undefined : known(s.replace(/\r\n/g, "\n").trim(), currentLang()));

// The last check, where every text is drawn (text.ts GameText.value): English the language layers know a word for.
// The type above stops English typed into the interface; what it cannot see is English handed on as data (the
// rules' names and lists, a record's field, a game file's row) and then vouched for with `said` (2026-11-02:
// "why do we still have translation errors"; the week's "Hedgehog", the score screen's "Normal" came that way).
// Every layer that knows a translation tells it here (`learnEnglish`): our tables, the names layer, the game files'
// rows. A whole text that is such English is drawn in the language's own words and noted; English words or names
// inside a longer text are noted (`englishShown`, the probes and Feedback notes), so the path is found, not guessed.
const learned = new Map<string, { local: Map<string, string>; locals: Set<string>; words: Set<string> | null }>();
let tableSource: (lang: string) => Record<string, string> | undefined = () => undefined;
/** (i18n/index.ts hands on our tables: their English keys and lines are known too.) */
export const setTableSource = (f: typeof tableSource) => (tableSource = f);
function learnedFor(l: string) {
  let k = learned.get(l);
  if (!k) {
    learned.set(l, (k = { local: new Map(), locals: new Set(), words: null }));
    for (const [en, local] of Object.entries(tableSource(l) ?? {})) if (!/%\d|\|/.test(en + local)) learnInto(k, en, local);
  }
  return k;
}
function learnInto(k: ReturnType<typeof learnedFor>, en: string, local: string) {
  en = en.trim();
  local = local.trim();
  if (!en || !local || en === local || !/[A-Za-z]{2}/.test(en)) return;
  k.locals.add(local);
  if (!k.local.has(en)) k.local.set(en, local);
  k.words = null;
}
/** Tells the last check that `en` is `local` in language `l` (a name, a line of a table or of the game files). */
export function learnEnglish(l: string, en: string | undefined, local: string | undefined) {
  if (l === "en" || !en || !local) return;
  learnInto(learnedFor(l), en, local);
}
const checked = new Set<string>();
/**
 * The text as drawn: in a language other than English, a whole text that is English with a known translation is drawn
 * as that translation, and English names inside a text are noted. (GameText.value; cheap: once per distinct text.)
 */
export function asDrawn(text: Text): Text {
  const l = currentLang();
  if (l === "en" || text.length < 3 || !/[A-Za-z]{3}/.test(text)) return text;
  const k = learnedFor(l);
  const own = k.local.get(text.trim());
  if (own !== undefined && !k.locals.has(text.trim())) {
    noteEnglish(text, "drawn: English with a translation (drawn translated; find who handed it on)");
    return own as Text;
  }
  if (checked.has(text)) return text;
  if (checked.size > 5000) checked.clear();
  checked.add(text);
  // Names (one to four words, a capital first, five letters or more) the layers know in this language, inside a longer text.
  if (!k.words) {
    k.words = new Set();
    for (const en of k.local.keys()) if (/^[A-Z][A-Za-z']+(?: [A-Za-z'][A-Za-z']*){0,3}$/.test(en) && en.length >= 5 && !k.locals.has(en)) k.words.add(en);
  }
  const words = text.match(/[A-Za-z'\u00C0-\u024F\u0400-\u04FF]+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    for (let n = 4; n >= 1; n--) {
      if (i + n > words.length) continue;
      const phrase = words.slice(i, i + n).join(" ");
      if (k.words.has(phrase)) {
        noteEnglish(text, `drawn: "${phrase}" is English (${k.local.get(phrase)})`);
        return text;
      }
    }
  }
  return text;
}

/** Notes `s` as English shown in another language (once per text). */
export function noteEnglish(s: string, where: string) {
  if (currentLang() === "en" || !/[A-Za-z]{2}/.test(s)) return;
  if (englishShown.some((e) => e.text === s)) return;
  englishShown.push({ text: s.slice(0, 200), where });
  if (englishShown.length > 200) englishShown.shift();
}

/**
 * The game's own English for a line the language's files lack (`resolveText(...) ?? fallback("...")`): shown as it is,
 * and noted when the player's language isn't English.
 */
export function fallback(s: string, where = ""): Text {
  noteEnglish(s, where || "fallback");
  return s as Text;
}

/** Texts joined by `sep` (no words in it). */
export const join = (parts: readonly (Text | number)[], sep = ""): Text => parts.join(sep) as Text;

/** A template of texts: `fmt\`${a}, ${b}\``. Its own pieces are punctuation and spaces only (i18nScan.ts checks it). */
export const fmt = (pieces: TemplateStringsArray, ...parts: (Text | number)[]): Text => pieces.reduce((out, p, i) => out + p + (i < parts.length ? String(parts[i]) : ""), "") as Text;

// Trimming a text keeps it a text (its words stay the language's own).
declare global {
  interface String {
    trim<T extends string>(this: T): T;
    trimEnd<T extends string>(this: T): T;
    trimStart<T extends string>(this: T): T;
  }
}
