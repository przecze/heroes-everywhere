// What both New Game screens (the computer's window, scenarioSelect.ts, and the touch screens' page, mobileNewGame.ts)
// show the same way: the words of the setup (difficulties, personalities, the turn timer), the original's text files,
// the backdrop, and the scenario list's entries for random maps. The rules are in newGameModel.ts.
import { decodeText } from "@heroes/formats";
import { type Personality, type RandomMapOptions, type RmgTemplate, randomMapName, randomMapSlots, randomMapTitle, rmgIndex, rmgKey, rmgTemplatesFor } from "@heroes/core";
import { fetchRes } from "../assets.ts";
import { loadData } from "../gameData.ts";
import { localizeMaps } from "../i18n/maps.ts";
import { tr, trn, type Text } from "../i18n/index.ts";
import { fetchRetry } from "../net.ts";
import { originalWords, packLines } from "./gameText.ts";
import { localRandomDescription, localRandomName } from "./randomNames.ts";
import { DIFFICULTIES, type MapInfo } from "./newGameModel.ts";

// i18n-keys
const PERSONALITY_NAMES = { warrior: "Warrior", builder: "Builder", explorer: "Explorer", random: "Random", mixed: "Mixed", fresh: "New AI" };
/** A computer's personality on the screen; none: "Computer" (the map's AI tactic), on a random map's line "Standard". */
export const personalityName = (p: Personality | "random" | "mixed" | undefined, none = "Computer") => tr(p ? PERSONALITY_NAMES[p] : none);
export const PERSONALITY_HELP = "{Computer Personality}\n\nHow this computer player plays. Warrior: troops first, goes for its rivals early. Builder: income and buildings first, keeps to itself for two weeks. Explorer: an extra hero, scouts the map and takes what lies around. Random: one of the three. Computer: the map's own choice (most maps: the standard AI).";
export const RANDOM_AI_HELP = "{Computer Personality}\n\nHow the computer players play: the standard AI, all of them Warriors (troops first, early attacks), Builders (income first, keep to themselves) or Explorers (an extra hero, scout the map), or Mixed (each its own).";

export const turnMinutesName = (n?: number): Text => (!n ? tr("Unlimited") : trn(n, "%1 Minute", "%1 Minutes"));

/** The difficulties' names as the game's files have them (ARRAYTXT 142-146: in Polish and German too). */
export async function difficultyNames(): Promise<string[]> {
  const A = await originalWords("arraytxt", { Easy: 142, Normal: 143, Hard: 144, Expert: 145, Impossible: 146 });
  return DIFFICULTIES.map(A);
}

/** A text file of the game's, line by line (Polish and German: the packs' words where they have the row). */
export async function textLines(name: string): Promise<string[]> {
  try {
    const bytes = await fetchRes(name);
    const lines = decodeText(bytes).replace(/\r/g, "").split("\n");
    const local = await packLines(name.replace(/\.txt$/i, ""));
    return local ? lines.map((l, i) => local[i] ?? l) : lines;
  } catch {
    return [];
  }
}

/**
 * HotA's nine New Game backdrops: one a day (HotA picks one at random each time; a new one every
 * visit meant some 600 KB downloaded every time on a phone).
 */
export function newGameBackdrop(): string {
  return `mods/mainmenu/content/data/gamselb${Math.floor(Date.now() / 86400000) % 9}.png`;
}

/** The scenario list's map headers (the server's /maps-info). */
export async function fetchMapsInfo(): Promise<MapInfo[]> {
  return localizeMaps(await (await fetchRetry("/maps-info")).json());
}

/**
 * Downloads what New Game shows ahead of time, while the main menu is up: the map list, today's
 * backdrop and the screen's pieces go into the browser's cache, so the page that follows (the
 * menu reloads into it) finds them there.
 */
export function prefetchNewGame(withList = true) {
  const files = [newGameBackdrop(), "scnrmpsz.def", "scselc.def", "scnrvict.def", "scnrloss.def", "scnrstar.def", "vcdesc.txt", "lcdesc.txt", "gselpop1.pcx", "scselbck.pcx", "itgflags.def", "scnrbeg.def", "scnrback.def"];
  if (withList) void fetch("/maps-info").catch(() => {});
  for (const f of files) void fetchRes(f).catch(() => {});
}

/** A random map's entry for the scenario lists: its name and who plays which town (the map itself isn't needed). */
export function randomMapInfo(o: RandomMapOptions, template?: RmgTemplate): MapInfo {
  return {
    file: randomMapName(o),
    ...(({ name, description }) => ({ name: localRandomName(name), description: localRandomDescription(o, template, description) }))(randomMapTitle(o, template)),
    size: o.size,
    levels: o.underground ? 2 : 1,
    version: 0x1c,
    hota: 0,
    difficulty: 1,
    victory: -1,
    loss: -1,
    players: randomMapSlots(o).map((p) => ({ human: p.canHuman, computer: p.canComputer, team: p.team, factions: p.allowedFactions ?? 0, randomFaction: !!p.randomFaction, town: p.canComputer, chooseHero: true })),
  };
}

/**
 * A random map from a template: the one asked for (a key of rmgIndex) if it fits these players, else
 * one that fits at random, as the original picks; the generator's own layout with water or when the
 * game files have no templates.
 */
export async function templatedMapInfo(o: RandomMapOptions, key?: string): Promise<MapInfo> {
  const templates = (await loadData().catch(() => null))?.rmgTemplates ?? [];
  const fit = rmgTemplatesFor(templates, o.size, o.underground ? 2 : 1, o.humans, o.players);
  const asked = key ? rmgIndex(templates).get(key) : undefined;
  const template = asked && fit.includes(asked) ? asked : fit.length ? fit[Math.floor(Math.random() * fit.length)] : undefined;
  return randomMapInfo(template ? { ...o, template: rmgKey(templates, template) } : o, template);
}
