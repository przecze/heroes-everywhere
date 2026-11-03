// The scenario list's map names and descriptions in Polish and German (maps-<lang>.json, made by
// tools/i18n/maps-text.ts from the VCMI translation packs), in Russian from HotA's Russian maps (/l10n/ru/maps.json,
// tools/i18n/hota-language.ts); English where a map has no line.
import { has, lang } from "./index.ts";
import { release } from "./languages.ts";
import { mapsPack } from "./pack.ts";

type Texts = Record<string, [string, string]>;
const loaded = new Map<string, Promise<Texts>>();

function texts(l: string): Promise<Texts> {
  let p = loaded.get(l);
  // (A language with its own release's files: its maps' names, beside them on the server; l10nArt.ts.)
  const own = () => fetch(`/l10n/${l}/maps.json`).then((r) => (r.ok && !r.headers.get("content-type")?.startsWith("text/html") ? r.json() : {}));
  if (!p) loaded.set(l, (p = release(l) ? own() : mapsPack(l).then((m) => m as Texts)));
  return p;
}

/**
 * The map headers with the interface language's names and descriptions. The map's own words are kept beside them
 * (`own`), so a list localized once can be localized again after the language changes (New Game opened after a switch
 * showed the old language's names; The owner 2026-11-02).
 */
export async function localizeMaps<T extends { file: string; name: string; description: string; own?: { name: string; description: string } }>(maps: T[]): Promise<T[]> {
  const l = lang();
  const base = (m: T): T => (m.own ? { ...m, name: m.own.name, description: m.own.description } : m);
  if (!has(l, "mapList")) return maps.map(base);
  const table = await texts(l).catch(() => ({}) as Texts);
  return maps.map((m) => {
    const b = base(m);
    const t = table[b.file.replace(/\.h3m$/i, "").trim().toLowerCase()];
    return t ? { ...b, name: t[0] || b.name, description: t[1] || b.description, own: { name: b.name, description: b.description } } : b;
  });
}
