// The original's own texts and reward pictures for messages: a TextRef names a line of ADVEVENT.TXT
// or GENRLTXT.TXT (VCMI's numbering), a Component one of the info window icons (VCMI's CComponent,
// large size) with its caption.
import { MOD_TEXTS } from "@heroes/core";
import type { Component, CreatureStats, MoraleLuckPart, TextRef, GameLineFile } from "@heroes/core";
import { gameLine, lineOf } from "@heroes/core";
import { HERO_CLASSES, LEVEL_NAMES, SKILL_NAMES } from "@heroes/core";
import type { Texture } from "pixi.js";
import { creaturePortrait, fetchRes, loadDef } from "../assets.ts";
import { legacyRows } from "../text.ts";
import { has, lang, tr, trKnown } from "../i18n/index.ts";
import { fallback, knownWords, learnEnglish, noteEnglish, num, said, type Text } from "../i18n/text.ts";
import { release } from "../i18n/languages.ts";
import { isHandedName, rowName, skillTexts } from "../i18n/names.ts";
import { corePack } from "../i18n/pack.ts";
import { resourceAmount, resourceIndex } from "./resourceNames.ts";

const files = new Map<string, Promise<string[][]>>();
/** Per file read in a language with the packs: the rows its pack lacks (still the English), for `englishShown`. */
const untranslated = new Map<string, Set<number>>();

/** The VCMI translation packs' lines of the original's text files (core.<file>.<row>): Polish, German, French and Spanish. */
type Pack = Record<string, Record<string, string>>;
const packs = new Map<string, Promise<Pack>>();
function pack(l: string): Promise<Pack> {
  let p = packs.get(l);
  if (!p) {
    p = corePack(l).then((m) => m as Pack);
    packs.set(l, p);
  }
  return p;
}

/** The packs' lines of one text file by row (in the languages that have them: languages.ts gameTexts); in a language
 *  with its own release's files, that file's (HELP's right-click texts as "N.help", like the packs). */
export async function packLines(file: string): Promise<Record<string, string> | undefined> {
  const l = lang();
  if (!has(l, "gameTexts")) return undefined;
  if (release(l)) {
    const own = await rows(file as TextFile);
    if (!own.length) return undefined;
    return Object.fromEntries(own.flatMap((r, i) => [[String(i), r[0] ?? ""], ...(file === "help" && r[1] !== undefined ? [[`${i}.help`, r[1]]] : [])]));
  }
  return (await pack(l))[file];
}

/** The text files lines can come from. */
type TextFile = TextRef["file"] | "minename" | "randtvrn" | "priskill" | "herobios" | "sstraits" | "jktext" | "hctraits" | "overview" | "hallinfo" | "newtut" | "tcommand" | "heroscrn" | "tvrninfo" | "skilllev" | "restypes" | "plcolors" | "xtrainfo";
/** A line that may itself be filled in with lines of the other files too. */
export type AnyTextRef = Omit<TextRef, "file" | "args"> & { file: TextFile; args?: (string | number | AnyTextRef)[] };

/** Every row's fields; GENRLTXT's heading row and SSTRAITS' two don't count. */
function rows(file: TextFile): Promise<string[][]> {
  const l = lang();
  const key = has(l, "gameTexts") ? `${l}:${file}` : file;
  let p = files.get(key);
  if (!p) {
    p = fetchRes(`${file}.txt`)
      .then((b) => legacyRows(b))
      .then((rows) => (file === "genrltxt" ? rows.slice(1) : file === "sstraits" || file === "hctraits" ? rows.slice(2) : rows))
      .catch(() => [])
      .then(async (rows) => {
        // A language with the packs' words (languages.ts gameTexts): they replace the English ones where they have the row.
        // (A language with its own release's files has them already: fetchRes read its own.)
        if (!has(l, "gameTexts") || release(l)) return rows;
        const lines = (await pack(l))[file];
        const english = new Set<number>();
        untranslated.set(key, english);
        // (Names the packs have by id, not by row: skills, classes, heroes, artifacts.)
        // SEERHUT's fields by "row.col" (tools/i18n/core-texts.ts seerRows; The owner's note 2026-11-02 11:16: a seer spoke English
        // in Polish). The packs have the Seer's Hut and Quest Guard wordings; HotA's Quest Gate ones (columns 7-9) take the
        // guard's.
        if (file === "seerhut") return rows.map((r, i) => r.map((f, k) => lines?.[`${i}.${k}`] || (k >= 7 ? lines?.[`${i}.${k - 3}`] : undefined) || f));
        return rows.map((r, i) => {
          const said = lines?.[i] || rowName(file, i, l);
          if (!said) english.add(i);
          else learnEnglish(l, r[0], said);
          const texts = file === "sstraits" ? skillTexts(i, l) : undefined;
          const row = said ? [said, ...r.slice(1)] : r;
          return texts ? row.map((f, k) => (k >= 1 && k <= 3 && texts[k - 1]) || f) : row;
        });
      });
    files.set(key, p);
  }
  return p;
}

/** Notes row `id` of `file` when the language's pack lacks it (it is drawn in English). */
const checkRow = (file: TextFile, id: number, line: string) => {
  // (A seer's name, SEERHUT's last rows, is a name in every language.)
  if (file === "seerhut" && /^[A-Z][a-z]+$/.test(line)) return;
  if (untranslated.get(`${lang()}:${file}`)?.has(id)) noteEnglish(line, `${file}.txt row ${id}: no line in the ${lang()} pack`);
};

/** First field of every row. */
const lines = async (file: TextFile): Promise<Text[]> => (await rows(file)).map((r) => (r[0] ?? "") as Text);
/** A text file's first fields in the interface's language (the packs' words in Polish and German); GENRLTXT without its heading. */
export const gameLines = lines;

/**
 * RANDTVRN's rumours (the Tavern's gossip), in the interface's language: the packs number them from the file's second
 * line on (VCMI's reading), so they are taken as the pack has them, not row for row (2026-10-30 07:23: the
 * gossip was English in German). Empty lines and the file's quoting left out.
 */
export async function tavernRumours(): Promise<Text[]> {
  const own = await packLines("randtvrn");
  // (The packs' lines are clean; the file's own rows may keep its quoting.)
  if (own) return Object.entries(own).filter(([k, v]) => /^\d+$/.test(k) && v.trim()).sort((a, b) => Number(a[0]) - Number(b[0])).map(([, v]) => v.trim() as Text);
  return (await rows("randtvrn")).map((r) => (r[0] ?? "").trim().replace(/^"|"$/g, "").replace(/""/g, '"') as Text).filter(Boolean);
}

/**
 * A text file's lines (first fields; empty without the game files) and a filler for them: `fill(i, ours, ...args)`
 * is line i with its %s / %d taken by `args` in turn, or `ours` (already filled) when the file lacks it.
 */
export async function textTable(file: TextFile): Promise<(i: number, ours: Text, ...args: (string | number)[]) => Text> {
  const all = await lines(file);
  return (i, ours, ...args) => {
    const t = all[i];
    if (!t) return ours;
    checkRow(file, i, t);
    let k = 0;
    return t.replace(/%[sd]/g, () => String(args[k++] ?? "")) as Text;
  };
}

/** The original's line, filled in; null when the game files don't have it. */
export async function resolveText(ref: AnyTextRef): Promise<Text | null> {
  // (HotA's artifacts past ARTEVENT's rows: the language's own line for it, else the HotA mod's English.)
  const line = (await rows(ref.file))[ref.id]?.[ref.col ?? 0] || (ref.file === "artevent" && !ref.col ? hotaArtifactEvent(ref.id) : undefined);
  if (!line) return null;
  if (!ref.col) checkRow(ref.file, ref.id, line);
  const args = await Promise.all((ref.args ?? []).map(async (a) => (typeof a === "object" ? ((await resolveText(a)) ?? "") : handedWord(String(a), ref))));
  let k = 0;
  let out = line.replace(/%[sd]/g, () => args[k++] ?? "");
  for (const part of ref.more ?? []) out += typeof part === "string" ? part : ((await resolveText(part)) ?? "");
  return out as Text;
}

/** What is said when HotA's artifact `id` is found, in the interface's language (the HotA mod's words). */
function hotaArtifactEvent(id: number): string | undefined {
  return rowName("artevent", id, lang()) || gameLine("artevent", id) || undefined;
}

/** A word the rules put in a line's %s: a name they hand on in English (a bank's) in the player's language, noted when it has none. */
function handedWord(a: string, ref: AnyTextRef): string {
  if (lang() === "en") return a;
  // A seer's wants as the rules list them in English ("5 Wood, 2 Attack and Red"): each piece's word in the language,
  // the list joined its way (2026-11-02 11:16: the seer's line was Polish, "{5 Wood}" not).
  if (ref.file === "seerhut" && !isHandedName(a)) {
    const parts = a.split(/, | and /);
    const own = parts.map((p) => {
      const m = /^(\d+) (.+)$/.exec(p);
      const word = (x: string) => knownWords(x) ?? trKnown(x) ?? x;
      // (A resource takes the case its number asks: "5 drewna", not "5 Drewno".)
      if (m && resourceIndex(m[2]) >= 0) return resourceAmount(resourceIndex(m[2]), Number(m[1]), true);
      return m ? `${m[1]} ${word(m[2])}` : word(p);
    });
    if (own.every((p, i) => p === parts[i])) return a;
    return parts.length < 2 ? own[0] : new Intl.ListFormat(lang(), { type: "conjunction" }).format(own);
  }
  if (!isHandedName(a)) return a;
  const own = knownWords(a);
  if (own === undefined) noteEnglish(a, `${ref.file} ${ref.id} %s`);
  return own ?? a;
}

/**
 * A window's fixed words from one text file: `ids` maps our English (the stand-in) to its line, and
 * the function returned gives the game's line (trimmed) for those words, or the words themselves when
 * the files don't have it (or they aren't in `ids`).
 */
export async function originalWords(file: TextFile, ids: Record<string, number>): Promise<(ours: string) => Text> {
  const got = new Map(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, (await resolveText({ file, id }).catch(() => null))?.trim() as Text | undefined] as const)));
  return (ours) => got.get(ours) || tr(ours);
}

/**
 * HotA's tutorial texts: its map's events say "#HINT_ID=SCN1_Start" and the text is NEWTUT.TXT's
 * (HotA_lng.lod: a key, then the text). Left as it is when the game files don't have it.
 */
export async function withHints(text: string): Promise<Text> {
  if (!text.includes("#HINT_ID=")) return said(text);
  const table = await rows("newtut");
  return said(text.replace(/#HINT_ID=([A-Za-z0-9_]+)/g, (all, key: string) => table.find((r) => r[0] === key)?.[1] ?? all));
}

/** A hero class's name as the game writes it (HCTRAITS.TXT: "Death Knight", "Battle Mage"), else its key capitalised. */
export async function heroClassName(heroClass: number, hero?: { classText?: number }): Promise<Text> {
  // (A campaign's own name for the hero's class: Gem the Sorceress.)
  if (hero?.classText !== undefined) {
    const own = await resolveText({ file: "genrltxt", id: hero.classText });
    if (own) return own;
  }
  const name = (await rows("hctraits"))[heroClass]?.[0];
  if (name) return said(name);
  // (HotA's six classes, past the original's HCTRAITS rows: the HotA mod's words, "Wynalazca" for the Artificer.)
  const own = rowName("hctraits", heroClass, lang());
  if (own) return said(own);
  const key = HERO_CLASSES[heroClass]?.key ?? "";
  return tr(key.charAt(0).toUpperCase() + key.slice(1));
}

/** HotA's Interference and Runes texts, which the game's SSTRAITS.TXT lacks (from the HotA mod's skill configs). */
const HOTA_SKILL_TEXTS: Record<number, string[]> = {
  28: (["basic", "advanced", "expert"] as const).map((l) => MOD_TEXTS[`skill.hota.interference.interference.description.${l}`]),
  29: (["basic", "advanced", "expert"] as const).map((l) => MOD_TEXTS[`skill.hota.bulwark.runes.description.${l}`]),
};

/** A secondary skill's text at a level (1-3) from SSTRAITS.TXT: name, then basic / advanced / expert. */
export async function skillText(skill: number, level: number): Promise<Text | null> {
  return said((await rows("sstraits"))[skill]?.[level] || HOTA_SKILL_TEXTS[skill]?.[level - 1] || null);
}

/**
 * The hero screen's morale or luck explanation (VCMI's MoraleLuckBox): good, neutral or bad, then
 * "Current Morale Modifiers:" and a line for each, or "None".
 */
export async function moraleLuckText(morale: boolean, value: number, parts: MoraleLuckPart[] = []): Promise<Text | null> {
  const [head, neutral, none] = morale ? [88, 86, 108] : [62, 60, 77];
  const lines = await Promise.all(
    parts.map(async (p) => (p.id !== undefined ? ((await resolveText({ file: "arraytxt", id: p.id, args: p.args })) ?? "") : `\n${p.name} ${p.val > 0 ? "+" : ""}${p.val}`)),
  );
  return resolveText({ file: "arraytxt", id: head, args: [{ file: "arraytxt", id: neutral - Math.sign(value) }], more: lines.length ? lines : [{ file: "arraytxt", id: none }] });
}

/** skillText without its {title} line (for a card that names the skill itself). */
export async function skillBody(skill: number, level: number): Promise<Text | null> {
  const t = await skillText(skill, level);
  return t ? said(t.replace(/^\{[^}]*\}\s*/, "")) : null;
}

const PRIMARY = ["Attack", "Defense", "Spell Power", "Knowledge"];

/** A picture with its caption (and what it says when held): a message's reward, a choice. */
export interface Shown {
  texture: Texture;
  caption: Text;
  help?: Text;
  creature?: { c: CreatureStats; count: number };
}

/** Icon and caption for a component. */
export async function componentView(
  c: Component,
  names: {
    creature: (id: number) => CreatureStats | undefined;
    artifact: (id: number) => string;
    spell: (id: number) => string;
    /** What a held artifact or spell says (its name and description); without them, no popup. */
    artifactHelp?: (id: number) => string;
    spellHelp?: (id: number) => string;
  },
): Promise<Shown | null> {
  const frame = async (def: string, i: number) => (await loadDef(def)).get(0)?.[i]?.texture ?? null;
  const primary: Text[] = (await lines("priskill"))[0] ? await lines("priskill") : PRIMARY.map((p) => tr(p));
  let t: Texture | null = null;
  let caption = said("");
  /** What a right-click on the picture says (VCMI's CComponent::getDescription); a creature shows its card. */
  let help: Text | undefined;
  let creature: { c: CreatureStats; count: number } | undefined;
  switch (c.kind) {
    case "resource":
      t = await frame("resour82.def", c.id);
      caption = num(c.amount);
      help = (await resolveText({ file: "genrltxt", id: 242 })) ?? undefined;
      break;
    case "income": {
      t = await frame("resour82.def", c.id);
      // GENRLTXT 3: "%d/day".
      const perDay = (await lines("genrltxt"))[3] || tr("%1/day").replace("%1", "%d");
      caption = said(perDay.replace("%d", String(c.amount)));
      help = (await resolveText({ file: "genrltxt", id: 242 })) ?? undefined;
      break;
    }
    case "experience":
      t = await frame("pskill.def", 4);
      caption = num(c.amount);
      help = (await resolveText({ file: "genrltxt", id: 241 })) ?? undefined;
      break;
    case "primary":
      t = await frame("pskill.def", c.id);
      // (A quest's level to reach has no sign: the owner 2026-11-01, "shouldn't say plus here".)
      caption = said(`${c.amount >= 0 && !c.need ? "+" : ""}${c.amount} ${primary[c.id] ?? tr(PRIMARY[c.id])}`);
      help = (await resolveText({ file: "arraytxt", id: 2 + c.id })) ?? undefined;
      break;
    case "mana":
      t = await frame("pskill.def", 5);
      caption = said(`${c.amount >= 0 ? "+" : ""}${c.amount} ${tr("Spell Points")}`);
      help = (await resolveText({ file: "genrltxt", id: 149 })) ?? undefined;
      break;
    case "skill":
      t = await frame("secsk82.def", c.id * 3 + 3 + c.level - 1);
      caption = said(`${LEVEL_NAMES[c.level] ?? ""}\n${SKILL_NAMES[c.id] ?? ""}`);
      help = (await skillText(c.id, c.level)) ?? undefined;
      break;
    case "creature": {
      // (HotA's creatures have their own pictures, not in the sheet.)
      t = await creaturePortrait({ id: c.id }, "large");
      const cr = names.creature(c.id);
      caption = said(c.amount ? `${c.amount} ${c.amount > 1 ? cr?.plural : cr?.name}` : (cr?.plural ?? ""));
      if (cr) creature = { c: cr, count: c.amount ?? 0 };
      break;
    }
    case "artifact":
      t = await frame("artifact.def", c.id);
      caption = said(names.artifact(c.id));
      help = said(names.artifactHelp?.(c.id));
      break;
    case "spell":
      t = await frame("spellscr.def", c.id);
      caption = said(names.spell(c.id));
      help = said(names.spellHelp?.(c.id));
      break;
    case "luck":
      t = await frame("ilck82.def", Math.max(0, Math.min(6, c.amount + 3)));
      help = (await moraleLuckText(false, c.amount)) ?? undefined;
      break;
    case "morale":
      t = await frame("imrl82.def", Math.max(0, Math.min(6, c.amount + 3)));
      help = (await moraleLuckText(true, c.amount)) ?? undefined;
      break;
  }
  return t ? { texture: t, caption, help, creature } : null;
}

/**
 * The game files' own line (core gameLines: the English release's) where the language's files lack it: shown, and
 * noted as English drawn (i18n/text.ts) when the interface is in another language.
 */
export const englishLine = (file: GameLineFile, id: number, args?: (string | number | TextRef)[]): Text => fallback(lineOf(file, id, args), `${file} ${id}`);
