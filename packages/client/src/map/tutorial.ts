// HotA's tutorial guide: on its map ("[HotA] Tutorial.tut") the game itself shows NEWTUT.TXT's hints
// the first time something happens (the town screen opened, the first battle, the hero out of
// movement, the first Obelisk...), on top of the hints its map events give (#HINT_ID=, map/messages.ts).
// Which moment brings which hint is read from the hints' own words: HotA's exact triggers would need
// the original running. Each is shown once a tutorial; Tutorial in the main menu starts afresh.
import { type AdventureState, GRAIL_ARTIFACT, mapHeroesOf } from "@heroes/core";

const KEY = "heroes.tutorialHints";
/** Every hint shown this tutorial (the map's own and the guide's), in the order seen: for View Tutorial Messages. */
const SEEN = "heroes.tutorialSeen";
/** Dwellings 3 and its upgrade (the Castle's Griffin Tower): the one the tutorial has the player build. */
const GRIFFIN_TOWER = [32, 39];

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function save(shown: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...shown]));
  } catch {
    // (A full or blocked storage: the hints may show again after a reload.)
  }
}

/** A new tutorial game: every hint to be shown again. */
export function resetTutorialHints() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(SEEN);
  } catch {
    // nothing kept
  }
}

/** The hints this tutorial has shown so far (NEWTUT.TXT keys), the first first. */
export function seenTutorialHints(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Notes the hints a message carries (`#HINT_ID=...`) as seen, for the View Tutorial Messages list. */
export function noteTutorialHints(text: string) {
  const keys = [...text.matchAll(/#HINT_ID=([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  if (!keys.length) return;
  const seen = seenTutorialHints();
  for (const k of keys) if (!seen.includes(k)) seen.push(k);
  try {
    localStorage.setItem(SEEN, JSON.stringify(seen));
  } catch {
    // (A full or blocked storage: the list shows what this page saw.)
  }
}

/** A hint's title: its first {heading}, else its first line. */
export const tutorialTitle = (text: string) => (/\{([^}]+)\}/.exec(text)?.[1] ?? text.split("\n")[0]).trim();

export const isHotaTutorial = (mapFile: string | undefined) => !!mapFile && /^\[HotA\] Tutorial\.tut$/i.test(mapFile);

/** `show` queues a message after the others (and after a battle); `now` opens it at once (over the battle screen). */
export function tutorialGuide(show: (text: string) => void, now: (text: string) => void = show) {
  const shown = load();
  let start: Map<number, number> | undefined;
  let troops: number | undefined;
  const hint = (key: string, at = show) => {
    if (shown.has(key)) return;
    shown.add(key);
    save(shown);
    at(`#HINT_ID=${key}`);
  };
  return {
    /** Something only the screen knows: "town" (the town screen opened), "battle" (the battle screen), "selectTown" (a town selected on the map). */
    on(s: AdventureState | null, what: "town" | "battle" | "selectTown") {
      if (!s || !isHotaTutorial(s.mapFile)) return;
      if (what === "town") hint("SCN1_Twn_Construction");
      if (what === "battle") hint("SCN1_Btl_Basics", now);
      if (what === "selectTown" && shown.has("SCN1_Adv_Visiting")) hint("SCN1_Adv_Selection");
    },
    /** After each update of the game, for player `me`. */
    update(s: AdventureState | null, me: number) {
      if (!s || me < 0 || !isHotaTutorial(s.mapFile) || s.players[me]?.controller !== "human") return;
      const heroes = s.heroes.filter((h) => !h.removed && h.owner === me);
      const onMap = mapHeroesOf(s, me);
      const towns = s.objects.filter((o) => o.town && !o.removed && o.owner === me);
      start ??= new Map(heroes.map((h) => [h.id, h.x * 1000 + h.y]));
      // After the first walk of the first day: what to do with the objects around.
      if (s.day === 1 && heroes.some((h) => start!.has(h.id) && start!.get(h.id) !== h.x * 1000 + h.y)) hint("SCN1_Adv_Visiting");
      if (heroes.some((h) => h.garrison !== undefined)) hint("SCN1_Adv_HeroInGarrison");
      if (onMap.length && onMap.every((h) => h.movement < 100) && s.winner === undefined) hint("SCN1_Adv_EndTurn");
      if (heroes.length >= 2) hint("COMM_Adv_MultipleHeroes");
      if (onMap.some((h) => h.z === 1)) hint("SCN1_Adv_Underworld");
      if (towns.some((o) => o.town!.built.some((b) => GRIFFIN_TOWER.includes(b)))) hint("SCN1_Twn_HireCreatures");
      // Troops hired into a town's garrison (more there than before).
      const inTowns = towns.reduce((a, o) => a + o.town!.garrison.reduce((b, x) => b + (x?.count ?? 0), 0), 0);
      if (shown.has("SCN1_Twn_HireCreatures") && troops !== undefined && inTowns > troops) hint("SCN1_Twn_Garrison");
      troops = inTowns;
      if (s.day >= 2) hint("SCN1_Adv_BuildEveryday");
      // A quest given (a Seer's Hut or a Quest Guard visited, not yet done): where the log is. (The map's
      // script reads the "Shown-COMM_Adv_QuestLog" flag the game keeps for it.)
      if (s.objects.some((o) => (o.type === 83 || o.type === 215) && !o.removed && !o.data?.done && o.visitors?.includes(me))) hint("COMM_Adv_QuestLog");
      const obelisks = s.players[me].obelisks?.length ?? 0;
      if (obelisks >= 1) {
        hint("SCN1_Adv_FirstGrailMap");
        hint("SCN1_Adv_HireHero");
      }
      if (obelisks >= 2) hint("SCN1_Adv_DiggingGrail");
      if (heroes.some((h) => (h.equipped ?? []).includes(GRAIL_ARTIFACT) || (h.backpack ?? []).includes(GRAIL_ARTIFACT))) hint("SCN1_Twn_BuildingGrail");
      if (s.winner !== undefined) hint(s.winner === me ? "SCN1_Finish" : "COMM_DefeatLoadGame_NoHD");
    },
  };
}
