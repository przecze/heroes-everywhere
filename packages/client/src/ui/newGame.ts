// New Game's scenario list, shared by the main menu (which shows it over itself, the music going
// on, as HotA does) and the map page (its page bar's New game, and "#map?new" links).
import { hotaContentThere } from "../hotaContent.ts";
import { ADVANCED_STARTS, type RandomMapOptions, randomMapName, rmgKey, rmgTemplatesFor, rmgTitle } from "@heroes/core";
import { loadData } from "../gameData.ts";
import { extra } from "../settings.ts";
import type { Modals } from "./modals.ts";
import { mobileNewGame } from "./mobileNewGame.ts";
import { scenarioSelect } from "./scenarioSelect.ts";
import { type MapInfo, type ScenarioChoice } from "./newGameModel.ts";
import { fetchMapsInfo, randomMapInfo, templatedMapInfo } from "./newGameParts.ts";
import { loadFonts } from "../text.ts";
import { screenSize } from "./screen.ts";
import { firstGameDue } from "../map/firstSteps.ts";
import { starterMap } from "../starterMap.ts";
import { localizeMaps } from "../i18n/maps.ts";

export { ADVANCED_STARTS };

/** The advanced starts as New Game lists them: each on a template that fits it (a new pick with each seed). */
export function advancedStarts(seed: number): Promise<MapInfo[]> {
  return Promise.all(ADVANCED_STARTS.map((o) => templatedMapInfo({ ...o, seed })));
}

/**
 * The scenario selection: the advanced starts first (a new seed each time), then the maps. Phones
 * and tablets get the original laid out for fingers (mobileNewGame.ts), desktops the original window;
 * either over the main menu's picture when `overMenu`.
 */
export async function pickNewGame(modals: Modals, current: string | undefined, maps?: Promise<MapInfo[]> | MapInfo[], overMenu = false): Promise<ScenarioChoice | null> {
  const [fetched, data] = await Promise.all([maps ?? fetchMapsInfo(), loadData(), loadFonts()]);
  // (In the language now: the list may have been fetched before a switch.)
  const list = await localizeMaps(fetched);
  const seed = Math.floor(Math.random() * 1e6);
  const starts = extra("advancedStarts") ? await advancedStarts(seed) : [];
  // Nothing played on this device yet (map/page.ts keeps "heroes.map" from the first game opened; the map page's own
  // `current` is only its list's first then): the guided first game (the Quick game's first one, map/firstSteps.ts)
  // on top and chosen, so New Game's Begin starts a newcomer on a small map with its goals, not on a map of the list
  // (2026-10-27: "why is everyone's first game Arrogance").
  if (!playedHere()) current = undefined;
  const first = !current && firstGameDue() ? [randomMapInfo(guidedFirstGame(seed))] : [];
  const all = [...first, ...starts, ...list];
  // The last map picked; none (or one not in the list, as a random map): a starter, not the list's first.
  const pick = first[0]?.file ?? (current && all.some((m) => m.file === current) ? current : starterMap(list.map((m) => m.file)));
  return screenSize.touch ? mobileNewGame(modals, all, pick, data.heroNames, overMenu) : scenarioSelect(modals, all, pick, data.heroNames, "new", "", undefined, 1, undefined, overMenu);
}

/** Has a game been opened on this device (map/page.ts keeps its map as "heroes.map")? Unreadable storage: say yes. */
function playedHere(): boolean {
  try {
    return localStorage.getItem("heroes.map") !== null;
  } catch {
    return true;
  }
}

/** A new player's guided first game (map/firstSteps.ts): small, for two, weak monsters, Peasants by the town. */
const guidedFirstGame = (seed: number): RandomMapOptions => ({ size: 36, players: 2, humans: 1, monsters: 0, seed, guided: true });

/**
 * The Quick game (EXTRAS quickGame): a newcomer's first game with no setup screens. A Medium map for
 * two (you and one computer), normal monsters, Normal difficulty, on the original's 2SM2h: in
 * computer-against-computer games on it the first siege comes in week 3 to 7 (a Small map's in a
 * week), every server has it, and its five zones are quick to find one's way in on a phone.
 * Another template that fits when it's missing.
 */
export async function quickGameChoice(): Promise<ScenarioChoice> {
  // A new player's first one: a small guided map (map/firstSteps.ts), weak monsters, Peasants by the town.
  // (A server without HotA's content: the map without it.)
  const noHota = (await hotaContentThere()) ? {} : { noHota: true };
  if (firstGameDue()) return { file: randomMapName({ ...guidedFirstGame(Math.floor(Math.random() * 2 ** 31)), ...noHota }), difficulty: 1 };
  const o = { size: 72, players: 2, humans: 1, monsters: 1, seed: Math.floor(Math.random() * 2 ** 31), ...noHota };
  const templates = (await loadData().catch(() => null))?.rmgTemplates ?? [];
  const fit = rmgTemplatesFor(templates, o.size, 1, o.humans, o.players);
  const best = fit.find((t) => t.folder === "{Original}" && rmgTitle(t) === "2SM2h") ?? fit.find((t) => rmgTitle(t) === "2SM2h");
  const info = await templatedMapInfo(o, best ? rmgKey(templates, best) : undefined);
  return { file: info.file, difficulty: 1 };
}

/** A game chosen in the main menu, handed to the map page across the page change ("#map?start"). */
const START_KEY = "heroes.newGameChoice";
export function handOverChoice(choice: ScenarioChoice) {
  try {
    sessionStorage.setItem(START_KEY, JSON.stringify(choice));
  } catch {
    // no session storage: the map page starts the chosen map with the defaults
  }
}
export function takeChoice(): ScenarioChoice | null {
  try {
    const v = sessionStorage.getItem(START_KEY);
    sessionStorage.removeItem(START_KEY);
    return v ? (JSON.parse(v) as ScenarioChoice) : null;
  } catch {
    return null;
  }
}
