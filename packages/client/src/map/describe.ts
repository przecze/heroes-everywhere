// What the adventure map says about things under the pointer (status bar) and in right-click
// popups: names from OBJNAMES / MINENAME / CRGEN1, H3's words for army sizes, visited marks.
import { decodeText } from "@heroes/formats";
import { type AdvObject, type AdventureState, BANKS, MINE_INCOME, type CreatureStats, HERO_CLASSES, type Hero, TOWNS, rewardableDef } from "@heroes/core";
import { fetchRes } from "../assets.ts";
import { has, lang, languageChanged } from "../i18n/index.ts";
import { release } from "../i18n/languages.ts";
import { localizeObjects, localizeTerrains, subObjectName, packNamesObject } from "../i18n/names.ts";
import { fallback, said, fmt, tr, type Text } from "../i18n/index.ts";
import { knownWords } from "../i18n/text.ts";
import { townName } from "../i18n/towns.ts";
import { extra } from "../settings.ts";
import { gameLines, heroClassName, resolveText } from "../ui/gameText.ts";
import { VISITED_LINES, VISITED_WORDS, type VisitedContext, type VisitedWords, visitedMark } from "./visited.ts";
import { resourceAmount, resourceName } from "../ui/resourceNames.ts";

let names: { objects: string[]; mines: Text[]; extra: Text[]; dwellings: string[]; classes: Text[]; hero: Text; terrains: string[]; digOk: Text; uncharted: Text } | null = null;
/** The original's visited marks, once GENRLTXT has loaded. */
let english: string[] = [];
let words: VisitedWords = VISITED_WORDS;

const lines = (bytes: Uint8Array) => decodeText(bytes).split(/\r?\n/).map((l) => l.replace(/\t.*$/, "").trim());

// (A switch of language: the names again in the new one, the hover's and the hold's — they stayed in the first.)
languageChanged.add(() => {
  names = null;
  void loadNames();
});

export async function loadNames() {
  if (names) return;
  // (OBJNAMES, CRGEN1 and TERRNAME as English, the names layer's words laid over them; MINENAME through the text layer.
  // A language with its own release's files reads its own here: fetchRes gives them.)
  const [objects, dwellings, terrains] = await Promise.all(["objnames.txt", "crgen1.txt", "terrname.txt"].map((f) => fetchRes(f).then(lines).catch(() => [])));
  const mines = await gameLines("minename").catch(() => [] as Text[]);
  // (XTRAINFO: what an object does, the original's own words in each language: objectHelp.)
  const extra = await gameLines("xtrainfo").catch(() => [] as Text[]);
  // A hero goes by "%s the %s" (GENRLTXT 15: name and class), as VCMI's CGHeroInstance::getObjectName.
  const classes = await Promise.all(HERO_CLASSES.map((_, i) => heroClassName(i)));
  const hero = (await resolveText({ file: "genrltxt", id: 15, args: ["%s", "%s"] })) ?? fallback("%s the %s");
  const digOk = (await resolveText({ file: "genrltxt", id: 330 })) ?? fallback("(digging ok)");
  const uncharted = (await resolveText({ file: "genrltxt", id: 61 })) ?? fallback("Uncharted Territory");
  english = objects;
  names = { objects: localizeObjects(objects, lang()), mines, extra, dwellings, classes, hero, terrains: localizeTerrains(terrains, lang()), digOk, uncharted };
  // The army sizes' phrases (ARRAYTXT 175-199, VCMI's 171 + 3 x quantity + 1): HotA's "A few (1-4)".
  const long = await Promise.all(ARMY_BOUNDS.map((_, q) => resolveText({ file: "arraytxt", id: 175 + 3 * q })));
  if (long.every(Boolean)) sizes = { long: long as string[] };
  // (The lessons keep their %s for the skill's or spell's name: visitedMark fills it in.)
  const loaded = await Promise.all(Object.entries(VISITED_LINES).map(async ([k, id]) => [k, (await resolveText({ file: "genrltxt", id, args: ["%s"] }))?.trim() || VISITED_WORDS[k as keyof VisitedWords]] as const));
  words = Object.fromEntries(loaded) as VisitedWords;
}

const ARMY_BOUNDS = [1, 5, 10, 20, 50, 100, 250, 500, 1000];
/** The game's own army size words, once ARRAYTXT has loaded. */
let sizes: { long: string[] } | null = null;
const quantity = (n: number) => Math.max(0, ARMY_BOUNDS.findLastIndex((b) => n >= b));

/** How many creatures there are, roughly, in a quick view: HotA's "1-4" ... "1000+" (its ARRAYTXT; the same in every
 * language, where a translation's SoD texts would say Few ... Legion). */
export function armyWord(n: number): Text {
  return armyRange(n);
}

/** The army size's numbers: "10-19", "1000+". */
export function armyRange(n: number): Text {
  const q = quantity(n);
  return said(q === ARMY_BOUNDS.length - 1 ? `${ARMY_BOUNDS[q]}+` : `${ARMY_BOUNDS[q]}-${ARMY_BOUNDS[q + 1] - 1}`);
}

/**
 * How HotA says an army's size before its name (ARRAYTXT's gArmySizeNames): "Several (5-9)
 * Archangels", "A pack (10-19) of Gnolls"; without the numbers on the status bar ("A pack of Gnolls").
 */
export function armyPhrase(n: number, numbers = true): Text {
  const p = sizes?.long[quantity(n)] ?? fallback(["A few (1-4)", "Several (5-9)", "A pack (10-19) of", "Lots (20-49) of", "A Horde (50-99) of", "A Throng (100-249) of", "A Swarm (250-499) of", "Zounds... (500-999)", "A Legion (1000 or more) of"][quantity(n)], "army size");
  return said(numbers ? p : p.replace(/ \([^)]*\)/, ""));
}

/** What the status bar and the hero list call a hero: "Orrin the Knight" (GENRLTXT 15). */
export function heroHoverName(h: Hero): Text {
  const cls = names?.classes[h.heroClass];
  return said(names && cls ? names.hero.replace("%s", h.name).replace("%s", cls) : h.name);
}

/** What the status bar and the town list call a town: "Hearthstone, Castle" (VCMI's CGTownInstance::getObjectName, the town's kind in the player's language). */
export function townHoverName(o: AdvObject): Text {
  const key = TOWNS[o.subid]?.faction ?? "";
  const kind = key ? townName(key) : said("");
  const name = said(o.name);
  return name ? (kind ? fmt`${name}, ${kind}` : name) : kind || tr("Town");
}

/** The name an object goes by on the map. */
export function objectName(o: AdvObject, creatures: CreatureStats[], artifacts: { name: string }[]): Text {
  if (o.name) return said(o.name);
  const l = lang();
  // (A dwelling, a bank or one of HotA's objects goes by its kind: the packs' name for "type:subtype".)
  const own = subObjectName(o.type, o.subid, l);
  if (own) return said(own);
  switch (o.type) {
    case 54:
      return said(creatures[o.subid]?.plural) ?? tr("Monsters");
    case 53:
      return names?.mines[o.subid] || tr("Mine");
    case 79:
      return resourceName(o.subid) || tr("Resource");
    case 5:
      return said(artifacts[o.subid]?.name) ?? tr("Artifact");
    case 17:
      return names?.dwellings[o.subid] ? english17(names.dwellings[o.subid]) : tr("Creature Dwelling");
    case 16:
    case 24:
    case 25:
    case 84:
    case 85: {
      // (A type the packs name — Dragon Utopia, Derelict Ship — goes by its translated name; the other banks by their own.)
      const named = o.type !== 16 && names && names.objects[o.type] !== english[o.type] ? names.objects[o.type] : undefined;
      if (named) return said(named);
      const bank = BANKS[`${o.type}:${o.subid}`]?.name;
      // (The packs' sub names, else the release's: its CRBANKS and the HotA mod's words by the English name.)
      const own = bank && (subObjectName(o.type, o.subid, lang()) ?? knownWords(bank));
      if (own) return said(own);
      return bank ? fallback(bank, `bank ${o.type}:${o.subid}`) : said(names?.objects[o.type] ?? "");
    }
  }
  // HotA's objects (type 144 and on: the Trapper Lodge, the Colosseum...) aren't in OBJNAMES: their own names.
  const listed = names?.objects[o.type];
  if (listed) return listed === english[o.type] && !packNamesObject(o.type, lang()) ? fallback(listed, `objnames ${o.type}`) : said(listed);
  const def = rewardableDef(o)?.name;
  return def ? fallback(def, `object ${o.type}:${o.subid}`) : said("");
}

/** CRGEN1's name of a dwelling the packs don't name: the player's language's own files, else English (noted). */
const english17 = (n: string): Text => (has(lang(), "names") && !release(lang()) ? fallback(n, "crgen1") : said(n));

/** HotA's overlay grounds, whose objects OBJNAMES doesn't have. */
const PATCH_NAMES: Record<string, () => Text> = { cracked_ice: () => tr("Cracked Ice"), dunes: () => tr("Dunes"), fields_of_glory: () => tr("Fields of Glory") };
const TERRAINS = () => [tr("Dirt"), tr("Sand"), tr("Grass"), tr("Snow"), tr("Swamp"), tr("Rough"), tr("Subterranean"), tr("Lava"), tr("Water"), tr("Rock"), tr("Highlands"), tr("Wasteland")];

/**
 * What bare ground is called, as VCMI's CMapHandler::getTerrainDescr: the terrain (TERRNAME), and
 * where a hero could dig (land, nothing on it, not dug yet) GENRLTXT's "(digging ok)": after a space
 * on the status bar, on a line of its own in the right-click popup. `terrain` -1: unexplored.
 */
export function groundText(terrain: number, canDig: boolean, popup: boolean, patch?: { field: string; type: number }): Text {
  if (terrain < 0) return names?.uncharted ?? tr("Uncharted Territory");
  // A magic ground laid over it (Cursed Ground, Clover Field...) is named instead of the terrain (VCMI's isTile2Terrain objects).
  const name = said((patch && (names?.objects[patch.type] || PATCH_NAMES[patch.field]?.())) || names?.terrains[terrain] || TERRAINS()[terrain] || "");
  const dig = names?.digOk ?? tr("(digging ok)");
  return canDig ? (popup ? fmt`${name}\n${dig}` : fmt`${name} ${dig}`) : name;
}

/** Who is looking, for the visited marks: the player and their selected hero (-1 for none). */
export function seenBy(s: AdventureState, me: number, selected: number, spells?: { name: string }[]): Omit<VisitedContext, "words"> {
  const hero = selected >= 0 ? s.heroes[selected] : undefined;
  return { player: s.players[me], playerId: me, day: s.day, hero: hero && !hero.removed ? hero : undefined, spellName: (id) => spells?.[id]?.name ?? "" };
}

/** Status bar text for a tile: a hero, or the object there with its visited mark (for the player and selected hero in `seen`). */
export function describeTile(objectAt: AdvObject | undefined, heroAt: Hero | undefined, me: number, creatures: CreatureStats[], artifacts: { name: string }[], seen?: Omit<VisitedContext, "words">, popup = false): Text {
  // (Any player's hero by the same name, as the original: VCMI's AdventureMapInterface::onTileHovered.)
  void me;
  if (heroAt) return heroHoverName(heroAt);
  const o = objectAt;
  if (!o || o.removed) return said("");
  if (o.town) return townHoverName(o);
  const name = objectName(o, creatures, artifacts);
  if (o.type === 54) return fmt`${armyPhrase(o.amount ?? 1, extra("monsterRange"))} ${name}`;
  const mark = said(seen ? visitedMark(o, { ...seen, words }) : "");
  const named = mark ? fmt`${name} ${mark}` : name;
  // (What it does after it: HotA's hover line, "Swan Pond (+2 luck until next battle...)"; in a popup on its own line.)
  const help = objectHelp(o);
  return help ? (popup ? fmt`${named}\n${help}` : fmt`${named} ${help}`) : named;
}

/**
 * The original's XTRAINFO line for each kind of object it has one for (VCMI's "description" of these objects says
 * which): what a visit gives, in brackets, "(+1 morale until next battle)".
 */
const XTRAINFO: Record<number, number> = {
  11: 0, // Buoy
  14: 1, // Swan Pond
  28: 2, // Faerie Ring
  30: 3, // Fountain of Fortune
  32: 4, // Garden of Revelation
  100: 5, // Learning Stone
  41: 6, // Library of Enlightenment
  23: 7, // Marletto Tower
  51: 8, // Mercenary Camp
  47: 9, // School of Magic
  107: 10, // School of War
  61: 11, // Star Axis
  113: 12, // Witch Hut
  31: 13, // Fountain of Youth
  35: 14, // Hill Fort
  48: 15, // Magic Spring
  52: 16, // Mermaids
  64: 17, // Rally Flag
  102: 18, // Tree of Knowledge
  88: 19, // Shrine of Magic Incantation
  89: 20, // Shrine of Magic Gesture
  90: 21, // Shrine of Magic Thought
  38: 22, // Idol of Fortune
  96: 23, // Temple
  104: 24, // University
  49: 25, // Magic Well
  56: 26, // Oasis
  110: 27, // Watering Hole
};

/**
 * What an object does, in a line for the status bar and the popup (2026-11-02: HotA says it on hover, the Swan
 * Pond's "+2 luck"): the original's own XTRAINFO line where it has one, else ours made of words already translated
 * (a mine's "+2 wood per day" from the resources' names); empty for the rest.
 */
export function objectHelp(o: AdvObject): Text {
  // (HotA's own kinds under an old type, the Shrine of Magic Mystery, do something else: the rules' table has them.)
  const line = XTRAINFO[o.type];
  if (line !== undefined && !rewardableDef(o)) return names?.extra[line] || said("");
  switch (o.type) {
    case 53: // Mine
      return o.subid < 7 ? tr("(+%1 per day)", resourceAmount(o.subid, MINE_INCOME[o.subid], true)) : said("");
    case 109: // Water Wheel
      return tr("(+%1 once per week)", resourceAmount(6, 1000, true));
    case 55: // Mystical Garden
      return tr("(+%1 once per week)", tr("%1 or %2", resourceAmount(5, 5, true), resourceAmount(6, 500, true)));
    case 112: // Windmill
      return tr("(3-6 of a rare resource once per week)");
    case 4: // Arena
      return tr("(+2 attack or defense once per hero)");
    case 101: // Treasure Chest
      return tr("(Gold or experience, sometimes an artifact)");
    case 12: // Campfire
      return tr("(400-600 gold and 4-6 of a resource)");
  }
  return said("");
}
