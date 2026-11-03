// The adventure screen's information windows: the scenario's card (Adventure Options' Scenario
// Info) and the quest log.
import { LOSS_TEXT, VICTORY_TEXT, activeQuest, questComponents, questRef, questRewardComponents, questText } from "@heroes/core";
import type { H3Map } from "@heroes/formats";
import { resolveText } from "../ui/gameText.ts";
import { messageBox as dialog } from "../ui/dialogs.ts";
import { mobileScenarioInfo } from "../ui/mobileScenarioInfo.ts";
import { questLog } from "../ui/questLog.ts";
import { scenarioSelect } from "../ui/scenarioSelect.ts";
import { type MapInfo } from "../ui/newGameModel.ts";
import { phoneSized } from "../ui/screen.ts";
import { type AdvContext, colorOf } from "./context.ts";
import { componentViews } from "./dialogs.ts";
import { tr, said, rulesText } from "../i18n/index.ts";

/** The original's scenario information: the scenario card (as on the New Game screen) and Back. `card`: the map's entry in the scenario list. */
export function scenarioInfoWindow(ctx: AdvContext, map: H3Map, card: MapInfo | undefined) {
  const { modals, data } = ctx;
  const state = ctx.state();
  // Each colour's town, first hero and starting bonus, as the game began.
  const picks = state.players.map((p) => {
    const first = state.heroes.find((h) => h.owner === p.color);
    return { faction: p.faction, hero: first?.type ?? -1, bonus: p.startBonus ?? ("random" as const), handicap: p.handicap };
  });
  const c = state.conditions;
  const win = c && c.victory.type >= 0 ? VICTORY_TEXT[c.victory.type] : tr("Defeat all your enemies");
  const lose = c && c.loss.type >= 0 ? LOSS_TEXT[c.loss.type] : tr("Lose all your towns and heroes");
  // Phones: a page in big text (the original card is unreadable there).
  if (phoneSized()) {
    // (Who plays which colour as the desktop's card shows it: the town's, hero's and bonus's pictures, no English words.)
    const players = state.players
      .map((p, i) => ({ p, hero: picks[i]?.hero ?? -1 }))
      .filter(({ p }) => p.controller !== "none")
      .map(({ p, hero }) => ({ color: p.color, human: p.controller === "human", faction: p.faction, hero, heroName: hero >= 0 ? (data.heroNames[hero] ?? "") : "", bonus: p.startBonus, out: !p.alive }));
    return void mobileScenarioInfo(modals, { name: map.name, description: map.description ?? "", size: map.size, levels: map.levels, victory: win, loss: lose, difficulty: state.difficulty ?? 1, day: state.day, players });
  }
  if (card) return void scenarioSelect(modals, [card], card.file, data.heroNames, "info", "", card, state.difficulty ?? 1, { human: colorOf(ctx), picks, turnMinutes: state.turnMinutes });
  void dialog(modals, tr(`%1\n\n%2\n\nVictory: %3\nLoss: %4`, map.name, map.description ?? "", win, lose), colorOf(ctx));
}

/** The quests this player has been given (Seer's Huts and Quest Guards visited). */
export async function questsWindow(ctx: AdvContext) {
  const s = ctx.state();
  const w = ctx.world();
  const me = ctx.me();
  // Every quest the player was told, done ones too (a Quest Guard let through is gone from the map).
  // The original's quest log lines ("Reach level 10 and visit Gier"), else ours.
  const entries = await Promise.all(
    s.objects
      .filter((o) => (o.type === 83 || o.type === 215) && o.visitors?.includes(me))
      .map(async (o) => {
        const q = activeQuest(w, o);
        // (A script's quest: the hint its script gave.)
        const hint = said(typeof o.data?.questHint === "string" ? o.data.questHint : "");
        const text = hint || (q.mission ? await resolveText(questRef(s, w, o, q, 4)) : null) || rulesText(questText(w, q), "quest");
        // Phones show the pictures of what is asked and given under the text.
        const pics = phoneSized() && q.mission && !hint ? { asks: await componentViews(w, questComponents(q)), gives: o.type === 83 ? await componentViews(w, questRewardComponents(q)) : [] } : {};
        return { title: o.type === 83 ? tr("Seer's Hut") : tr("Quest Guard"), text, done: !!o.data?.done || !!o.removed, ...pics };
      }),
  );
  entries.sort((a, b) => Number(a.done) - Number(b.done));
  void questLog(ctx.modals, entries);
}
