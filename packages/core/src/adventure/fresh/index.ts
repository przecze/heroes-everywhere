// The fresh adventure AI (2026-11-02: "start fresh"; docs/fresh-ai.md). A turn: the kingdom's morning (fresh/
// economy.ts: build by return, trade, recruit), heroes hired, then each hero's day (fresh/heroes.ts), the main hero
// first. It plays on the player's view like the classic AI (aiView.ts) and is picked per player (Player.aiEngine
// "fresh", or AI_ENGINE=fresh). playAiTurn calls it again after each battle, so every part may run twice a day.
import { type AdventureEvent, battleFor, canAct, mapHeroesOf } from "../rules.ts";
import type { AdventureState } from "../types.ts";
import type { World } from "../world.ts";
import { diaryOpen } from "../aiDiary.ts";
import { armyGold } from "./fight.ts";
import { runTowns } from "./economy.ts";
import { countGatherers, gatherBook, heroDay, hire, mainHero, takeTown } from "./heroes.ts";
import { act, env, mindOf } from "./mind.ts";

/** 0: no second hero hired first thing (it waits for the plan's gold like any other). */
const HIRE_FIRST = env("FR_HIRE1") !== "0";
export function freshTurn(s: AdventureState, w: World, player: number): AdventureEvent[] {
  const events: AdventureEvent[] = [];
  w.refresh(s);
  const mind = mindOf(s, player);
  const stop = () => s.winner !== undefined || !!battleFor(s, player) || !canAct(s, player);
  diaryOpen(s, player, `fresh: gold ${s.players[player].resources[6]}, heroes ${mapHeroesOf(s, player).map((h) => `${h.name} L${h.level} ${Math.round(armyGold(w, h.army))}`).join(", ")}`);
  if (mind.townsDay !== s.day) {
    mind.townsDay = s.day;
    // The main hero at home in the morning: the garrison joins it before the day's recruits.
    const m = mainHero(s, w, player, mind);
    const home = m && w.visitBy[w.index(m.x, m.y, m.z)] ? s.objects[w.visitBy[w.index(m.x, m.y, m.z)] - 1] : undefined;
    // (A second hero first thing, as a player hires one on day 1: it gathers while the main hero fights.)
    if (HIRE_FIRST && mapHeroesOf(s, player).length < 2) hire(s, w, player, 0);
    gatherBook(mind);
    runTowns(s, w, player, mind);
    if (m && home?.town && home.owner === player) takeTown(s, w, player, m, home);
    hire(s, w, player, mind.saving ?? 0, mind);
    countGatherers(s, player, mind, mainHero(s, w, player, mind));
  }
  const main = mainHero(s, w, player, mind);
  const heroes = mapHeroesOf(s, player).filter((h) => !h.asleep && h.garrison === undefined);
  heroes.sort((a, b) => (a.id === main?.id ? -1 : b.id === main?.id ? 1 : 0));
  const claimed = new Set<number>();
  for (const h of heroes) {
    if (stop()) return events;
    events.push(...heroDay(s, w, player, h, mind, main, claimed, stop));
  }
  if (stop()) return events;
  events.push(...(act(s, w, player, { type: "endTurn" }) ?? []));
  return events;
}
