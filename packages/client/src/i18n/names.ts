// Skill, hero, spell, artifact and building names in the interface's language: from the VCMI packs and the
// HotA mod (names-<lang>.json, made by tools/i18n/names.ts), keyed by our VCMI-style keys. Like the creatures'
// names (creatures.ts) they are set in place in the tables the windows read, English kept to go back to.
import { ARTIFACT_INFO, BANKS, HERO_CLASSES, HERO_INFO, HOTA_ARTIFACTS, LEVEL_NAMES, SKILLS, SKILL_NAMES, TOWNS, buildGameData, type GameData } from "@heroes/core";
import { parseTxt } from "@heroes/formats";
import { NAMES_PACKS, loadPack } from "./pack.ts";
import { has, release } from "./languages.ts";
import { learnEnglish, setKnownWords } from "./text.ts";
import { RELEASE_CREATURES, RELEASE_TOWNS, englishFile, releaseText } from "./release.ts";

interface Names {
  skill: Record<string, string>;
  heroClass: Record<string, string>;
  hero: Record<string, string>;
  spell: Record<string, string>;
  artifact: Record<string, string>;
  building: Record<string, Record<string, string>>;
  objects: Record<string, string>;
  /** Objects by "type:subtype" (dwellings, banks, HotA's objects), which go by their kind. */
  sub?: Record<string, string>;
  /** HotA's objects' texts (the HotA mod's translation), by their English as the rules hand it on. */
  said?: Record<string, string>;
  /** ARTEVENT's lines (what is said when an artifact is picked up), by the artifact's key. */
  event?: Record<string, string>;
  skillDesc: Record<string, string[]>;
  artifactDesc?: Record<string, string>;
  /** Buildings' descriptions by faction and key (a language with its own release's files). */
  buildingDesc?: Record<string, Record<string, string>>;
  /** A spell's description at none / basic / advanced / expert, by key. */
  spellDesc?: Record<string, string[]>;
  spec: Record<string, string[]>;
  levels: string[];
  terrains: string[];
}
const DATA = NAMES_PACKS as Record<string, Names>;

/** The HotA mod's words for HotA's own in a language (content/translation/<language>.json): VCMI keys. */
const MOD_FILES: Record<string, string> = { ru: "russian" };

const loading = new Map<string, Promise<void>>();
/**
 * Language `l`'s names, before the tables are named over: a pack's where it is fetched (pack.ts); a language with
 * its own release's files (languages.ts release): its names table, made from those files row by
 * row (the same rows the English tables are made from, so the same ids) and, for HotA's own past them, the HotA
 * mod's words in it; once, before the tables are named over (gameData.ts, a switch of language).
 */
export function loadReleaseNames(l: string): Promise<void> {
  if (DATA[l]) return Promise.resolve();
  if (!release(l)) return loadPack(l);
  let p = loading.get(l);
  if (!p) loading.set(l, (p = makeReleaseNames(l).catch((e) => console.warn(`names in ${l}: ${(e as Error).message}`))));
  return p;
}

async function makeReleaseNames(l: string) {
  const own = (f: string) => releaseText(l, `${f}.txt`).then((b) => b ?? new Uint8Array());
  const [crtraits, hotraits, hctraits, artraits, bldgneut, bldgspec, dwelling, sptraits, sstraits, objnames, terrname, skilllev, herospec, towntype] = await Promise.all(
    ["crtraits", "hotraits", "hctraits", "artraits", "bldgneut", "bldgspec", "dwelling", "sptraits", "sstraits", "objnames", "terrname", "skilllev", "herospec", "towntype"].map(own),
  );
  if (!hotraits.length) return;
  // (BUILDING, the costs, has no words: the English release's.)
  const [building, modBytes] = await Promise.all([englishFile("building.txt"), MOD_FILES[l] ? englishFile(`content/translation/${MOD_FILES[l]}.json`).catch(() => undefined) : undefined]);
  const mod: Record<string, string> = modBytes ? JSON.parse(new TextDecoder().decode(modBytes).replace(/^\s*\/\/.*$/gm, "")) : {};
  // The mod's names by kind and our key: "hero.hota.bulwark.01dhuin.name" is hero 01dhuin's.
  const modName = (kind: string, key: string, field = "name") => Object.entries(mod).find(([k]) => k.startsWith(`${kind}.`) && k.endsWith(`.${key}.${field}`))?.[1];
  const d = buildGameData({ crtraits, objects: new Uint8Array(), hotraits, hctraits, artraits, building, bldgneut, bldgspec, dwelling, sptraits }, { extraTemplates: false });
  const rows = (b: Uint8Array, skip = 0) => parseTxt(b).slice(skip).filter((r) => r.some((f) => f.trim()));
  // (By row, as gameText.ts and the hero screen read them: blank rows kept.)
  const skillRows = parseTxt(sstraits).slice(2);
  const classRows = parseTxt(hctraits).slice(2).filter((r) => r[0]?.trim());
  const specRows = parseTxt(herospec).slice(2);
  const names: Names = { skill: {}, heroClass: {}, hero: {}, spell: {}, artifact: {}, artifactDesc: {}, building: {}, buildingDesc: {}, objects: {}, skillDesc: {}, spec: {}, levels: [], terrains: [] };
  SKILLS.forEach((key, i) => {
    names.skill[key] = skillRows[i]?.[0] || modName("skill", key) || "";
    const desc = skillRows[i]?.slice(1, 4);
    if (desc?.every(Boolean)) names.skillDesc[key] = desc;
    else if (modName("skill", key)) names.skillDesc[key] = ["basic", "advanced", "expert"].map((lv) => modName("skill", key, `description.${lv}`) ?? "");
  });
  HERO_CLASSES.forEach((c, i) => (names.heroClass[c.key] = classRows[i]?.[0] || modName("heroClass", c.key) || ""));
  for (const [id, info] of Object.entries(HERO_INFO)) {
    // (Past its table the game fills in HotA's own heroes' English names: the mod's words for those.)
    const said = d.heroNames[Number(id)];
    names.hero[info.key] = (said && said !== (info.name ?? info.key) ? said : modName("hero", info.key)) ?? "";
    const spec = specRows[Number(id)];
    const modSpec = ["name", "tooltip", "description"].map((f) => modName("hero", info.key, `specialty.${f}`));
    if (spec?.[0]) names.spec[info.key] = spec.slice(0, 3);
    else if (modSpec[0]) names.spec[info.key] = modSpec.map((t) => t ?? "");
  }
  for (const s of d.spells ?? []) names.spell[s.key] = s.name || modName("spell", s.key) || "";
  for (const [id, info] of Object.entries(ARTIFACT_INFO)) {
    const a = d.artifacts[Number(id)];
    const fallback = HOTA_ARTIFACTS[Number(id)];
    const ours = a?.name && a.name !== fallback?.name;
    names.artifact[info.key] = (ours ? a.name : modName("artifact", info.key)) ?? "";
    names.artifactDesc![info.key] = (ours ? a.description : modName("artifact", info.key, "description")?.replace(/\{[^}]*\}\s*/g, "").trim()) ?? "";
  }
  TOWNS.forEach((town, ti) => {
    const table = (names.building[town.faction] = {} as Record<string, string>);
    const desc = (names.buildingDesc![town.faction] = {} as Record<string, string>);
    for (const [id, b] of Object.entries(town.buildings)) {
      if (!b) continue;
      table[b.key] = (ti < 9 ? d.townTexts?.names[ti]?.[Number(id)] : undefined) || modName("building", `${town.faction}.${b.key}`) || "";
      desc[b.key] = (ti < 9 ? d.townTexts?.descriptions?.[ti]?.[Number(id)] : undefined) || modName("building", `${town.faction}.${b.key}`, "description") || "";
    }
  });
  parseTxt(objnames).forEach((r, i) => r[0]?.trim() && (names.objects[String(i)] = r[0].trim()));
  names.terrains = [...rows(terrname).map((r) => r[0] ?? ""), modName("terrain", "highlands") ?? "", modName("terrain", "wasteland") ?? ""];
  // SKILLLEV: basic, advanced, expert (their short forms after them).
  names.levels = rows(skilllev).slice(0, 3).map((r) => r[0] ?? "");
  // HotA's objects' texts: the rules hand on the mod's English; the mod's words in this language by the same key.
  if (MOD_FILES[l]) {
    const english: Record<string, string> = await englishFile("content/translation/english.json")
      .then((b) => JSON.parse(new TextDecoder().decode(b).replace(/^\s*\/\/.*$/gm, "")))
      .catch(() => ({}));
    const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
    names.said = {};
    for (const [k, v] of Object.entries(english)) if ((k.startsWith("mapObject.") || k.startsWith("object.hota.")) && mod[k] && norm(mod[k]) !== norm(v)) names.said[norm(v)] = norm(mod[k]);
  }
  // The original's banks (CRBANKS, a name on each bank's first row): the release's name for the English one.
  const [enBanks, ownBanks] = await Promise.all([englishFile("crbanks.txt").catch(() => undefined), own("crbanks")]);
  const bankNames = (b: Uint8Array) => parseTxt(b).slice(2).map((r) => r[0]?.trim()).filter((n): n is string => !!n);
  if (enBanks) {
    const ownNames = bankNames(ownBanks);
    names.said ??= {};
    bankNames(enBanks).forEach((n, i) => ownNames[i] && ownNames[i] !== n && (names.said![n] = ownNames[i]));
  }
  DATA[l] = names;
  // The creatures (past the table, HotA's own: creatureNames.ts has the mod's) and the towns.
  const inTable = rows(crtraits, 2).length;
  RELEASE_CREATURES[l] = Object.fromEntries(d.creatures.filter((c) => c.id < inTable && c.name?.trim()).map((c) => [c.key, [c.name, c.plural, c.abilityText]]));
  const towns = rows(towntype).map((r) => r[0] ?? "");
  RELEASE_TOWNS[l] = Object.fromEntries(TOWNS.map((t, i) => [t.faction, towns[i] || modName("faction", t.faction) || ""]).filter(([, n]) => n));
}
/** The names in `l` (languages.ts says which languages have them). */
const TABLES = new Proxy({} as Record<string, Names | undefined>, { get: (_, l: string) => (has(l, "names") ? DATA[l] : undefined) });
// (A bank's English name, as the rules hand it on in a line's %s: its name by type and subtype.)
const BANK_KEYS = new Map(Object.entries(BANKS).map(([key, b]) => [b.name, key]));
setKnownWords((english, l) => TABLES[l]?.said?.[english] ?? (BANK_KEYS.has(english) ? TABLES[l]?.sub?.[BANK_KEYS.get(english)!] : undefined));
/** Whether `english` is one of the names the rules hand on in a line's %s (a bank's), which `knownWords` names. */
export const isHandedName = (english: string) => BANK_KEYS.has(english);
const ENGLISH = { skills: [...SKILL_NAMES], levels: [...LEVEL_NAMES] };
const was = new WeakMap<object, Map<PropertyKey, string>>();

/** Sets `holder[field]` to the name for the language now chosen, or back to the game's English (remembered on the first call). */
function set<T extends object>(holder: T, field: keyof T, local: string | undefined) {
  let en = was.get(holder);
  if (!en) was.set(holder, (en = new Map()));
  if (!en.has(field)) en.set(field, holder[field] as unknown as string);
  (holder[field] as unknown as string) = local || en.get(field)!;
  learnEnglish(namingIn, en.get(field), local);
}
/** The language the names are being set in (for the last check's dictionary, i18n/text.ts learnEnglish). */
let namingIn = "en";

/** The skills' names and levels (the core's tables, read by every window). */
export function localizeSkills(language: string) {
  const t = TABLES[language];
  SKILLS.forEach((key, i) => (SKILL_NAMES[i] = t?.skill[key] || ENGLISH.skills[i]));
  for (let l = 1; l <= 3; l++) LEVEL_NAMES[l] = t?.levels[l - 1] || ENGLISH.levels[l];
  SKILLS.forEach((key, i) => learnEnglish(language, ENGLISH.skills[i], t?.skill[key]));
  for (let l = 1; l <= 3; l++) learnEnglish(language, ENGLISH.levels[l], t?.levels[l - 1]);
}

/** The game tables' names (heroes, spells, artifacts, buildings) and the skills'; idempotent, cheap. */
export function localizeNames(d: GameData, language: string) {
  namingIn = language;
  localizeSkills(language);
  const t = TABLES[language];
  d.heroNames.forEach((_, id) => {
    const key = HERO_INFO[id]?.key;
    if (key) set(d.heroNames, id as never, t?.hero[key]);
  });
  for (const s of d.spells ?? []) {
    set(s, "name", t?.spell[s.key]);
    const desc = t?.spellDesc?.[s.key];
    s.text.forEach((_, i) => set(s.text, i as never, desc?.[i] || undefined));
  }
  d.artifacts.forEach((a, id) => {
    const key = ARTIFACT_INFO[id]?.key;
    if (key && a) {
      set(a, "name", t?.artifact[key]);
      if (a.description !== undefined) set(a, "description", t?.artifactDesc?.[key]);
    }
  });
  TOWNS.forEach((town, ti) => {
    const names = t?.building[town.faction];
    const descs = t?.buildingDesc?.[town.faction];
    // (HotA's three towns share the classic buildings' names with the first town's table.)
    const generic = t?.building.castle;
    for (const [id, b] of Object.entries(town.buildings)) {
      if (!b) continue;
      const local = names?.[b.key] || (ti >= 9 ? generic?.[b.key] : undefined);
      if (d.townTexts?.names[ti]) set(d.townTexts.names[ti], Number(id) as never, local);
      if (b.name) set(b, "name", local);
      if (d.townTexts?.descriptions?.[ti]) set(d.townTexts.descriptions[ti], Number(id) as never, descs?.[b.key]);
      if (b.description) set(b, "description", descs?.[b.key]);
    }
  });
}

/** The name of row `i` of a text file the names above replace (SSTRAITS: skills, HCTRAITS: classes, HOTRAITS: heroes, ARTRAITS: artifacts, ARTEVENT: their finding), in the interface's language. */
export function rowName(file: string, i: number, language: string): string | undefined {
  const t = TABLES[language];
  if (!t) return undefined;
  if (file === "sstraits") return t.skill[SKILLS[i]];
  if (file === "hctraits") return t.heroClass[HERO_CLASSES[i]?.key];
  if (file === "hotraits") return t.hero[HERO_INFO[i]?.key];
  if (file === "artraits") return t.artifact[ARTIFACT_INFO[i]?.key];
  if (file === "artevent") return t.event?.[ARTIFACT_INFO[i]?.key];
  // CRGEN1 / CRGEN4: the dwellings' names (types 17 and 20 by subtype), which the packs have by kind.
  if (file === "crgen1") return t.sub?.[`17:${i}`];
  if (file === "crgen4") return t.sub?.[`20:${i}`];
  return undefined;
}

/** OBJNAMES' English with the packs' names over it, by the map objects' type number (not the banks, mines and dwellings: they go by their kind). */
export function localizeObjects(english: string[], language: string): string[] {
  const t = TABLES[language];
  return english.map((en, i) => {
    const local = i === 16 || i === 17 || i === 53 ? en : t?.objects[i] || en;
    learnEnglish(language, en, local);
    return local;
  });
}

/** Whether the packs name OBJNAMES' type `type` in `language` (its name may be the English word, as Polish "Arena"). */
export const packNamesObject = (type: number, language: string): boolean => !!TABLES[language]?.objects[String(type)];

/** A map object's own name by type and subtype (a dwelling, a bank, HotA's), as the packs have it; undefined without one. */
export function subObjectName(type: number, subid: number, language: string): string | undefined {
  return TABLES[language]?.sub?.[`${type}:${subid}`];
}

/** TERRNAME's English (dirt ... rock, then HotA's highlands and wasteland) with the packs' names over it. */
export function localizeTerrains(english: string[], language: string): string[] {
  const t = TABLES[language]?.terrains;
  t?.forEach((name, i) => learnEnglish(language, english[i], name));
  return t ? t.map((name, i) => name || english[i] || "") : english;
}

/** A skill's texts for its levels (SSTRAITS' columns 1-3), as the packs have them: "{Basic Offense}\n\n...". */
export function skillTexts(skill: number, language: string): string[] | undefined {
  return TABLES[language]?.skillDesc[SKILLS[skill]];
}

/** A hero's specialty: short name, tooltip, description (HEROSPEC's three fields), as the packs have them. */
export function specialtyTexts(hero: number, language: string): string[] | undefined {
  return TABLES[language]?.spec[HERO_INFO[hero]?.key];
}
