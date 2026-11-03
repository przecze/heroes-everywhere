// The search engine (docs/ai-architecture.md, paradigm 3): the classic AI's choices, checked by playing them out.
// The main hero's next stop is picked among the classic picker's best few by playing each one out on a copy of what
// the player sees: the stop, then the rest of the day as the classic AI would play it (its other heroes, the battles
// fought for real on the copy, losses and all), and scoring where the side ends the day in one currency (armies,
// garrisons, towns, mines, purse, artifacts, the main hero's experience, less what stands where a stronger rival can
// reach it tomorrow). Policy improvement by rollouts: it can only pick what the classic AI would have picked or
// something its own play shows to end the day better.
//
// Fair: the copy is the player's view (aiView.ts), its rng the view's (not the game's seed).
//
// Off by default: head to head against the classic AI (2026-11-02, 96 seats each, RACE_ENGINES=base,search) it holds
// 0.12 of all players' strength against 0.13 and fewer towns on day 84 (1.4 against 1.6 with towns at 80000 and the
// outlook doubled; 1.3 against 1.7 before). A day's playout can't see a town three days off; docs/ai-architecture.md.
import { RESOURCE_VALUE, WORTH, aiEnv } from "./aiValues.ts";
import { army, power, reach } from "./aiThreat.ts";
import { allied } from "./rules.ts";
import type { AdventureState, Hero } from "./types.ts";
import { type World } from "./world.ts";
import { cloneWorld } from "./aiView.ts";
import { playAiTurn } from "./turns.ts";
import { artifactWorth } from "./aiWorth.ts";
import { act, gatherTargets } from "./ai.ts";
import { findPaths } from "./movement.ts";

export { type Engine, engineOf } from "./aiRoles.ts";

const K = Number(aiEnv("SR_K") ?? 4);
/** A point of the main hero's experience against army worth (its levels win the later fights). */
const XP = Number(aiEnv("SR_XP") ?? 1);
const TOWN = Number(aiEnv("SR_TOWN") ?? 80000);
let depth = 0;
export const inRollout = () => depth > 0;

/** Where the side stands, in army worth: what it holds, less what a stronger rival can catch tomorrow. */
export function standing(s: AdventureState, w: World, player: number, main?: number): number {
  let v = 0;
  const heroes = s.heroes.filter((h) => !h.removed && h.owner === player);
  for (const h of heroes) {
    v += power(w, h);
    for (const a of [...(h.equipped ?? []), ...(h.backpack ?? [])]) if (a >= 0) v += Math.max(0, artifactWorth(s, w, h, a)) * 0.5;
    if (h.id === main) v += h.experience * XP;
  }
  for (const o of s.objects) {
    if (o.removed || o.owner !== player) continue;
    if (o.town) v += TOWN + army(w, o.town.garrison);
    else if (o.type === 53) v += o.subid === 6 ? WORTH.goldMine : WORTH.mine;
  }
  v += s.players[player].resources.reduce((a, n, r) => a + n * RESOURCE_VALUE[r], 0);
  // Tomorrow's danger: a hero of ours a stronger rival can reach (from what we see) counts as half lost.
  const rivals = s.heroes.filter((e) => !e.removed && e.owner >= 0 && e.owner !== player && !allied(s, e.owner, player) && e.garrison === undefined && !e.unseen);
  for (const h of heroes) {
    if (h.garrison !== undefined) continue;
    const mine = power(w, h);
    for (const e of rivals) {
      if (power(w, e) <= 1.1 * mine || e.z !== h.z || Math.max(Math.abs(e.x - h.x), Math.abs(e.y - h.y)) > e.maxMovement / 50 + 1) continue;
      const node = reach(s, w, e).get(w.index(h.x, h.y, h.z));
      if (node && node.cost <= e.maxMovement) {
        v -= 0.5 * (mine + 2500 + 1500 * h.level);
        break;
      }
    }
  }
  return v;
}

/**
 * What the main hero can still go for from where the day leaves it: the best of the classic picker's targets, by its
 * worth a few days off (a day costs a seventh). Without it a day's playout is short-sighted: a rival town three days
 * off is worth nothing by the evening, and search seats took fewer towns than the classic AI (1.3 against 1.7 on day
 * 84, 2026-11-02).
 */
function outlook(s: AdventureState, w: World, h: Hero | undefined): number {
  if (!h || h.removed) return 0;
  const paths = findPaths(w, s, { ...h, movement: h.maxMovement }, false, undefined, true);
  const cands = gatherTargets(s, w, { ...h, movement: h.maxMovement }, paths);
  let best = 0;
  for (const c of cands) best = Math.max(best, c.value * Math.pow(DAY, c.cost / Math.max(1, h.maxMovement)));
  return best;
}
const POT = Number(aiEnv("SR_POT") ?? 2);
const DAY = Number(aiEnv("SR_DAY") ?? 0.85);

/**
 * The main hero's next stop: the classic picker's best `cands` (tile, its score), each played out on a copy for the
 * rest of the day; the one whose day ends best. Undefined when there is nothing to choose between.
 */
export function searchStop(s: AdventureState, w: World, h: Hero, cands: { i: number; score: number }[]): number | undefined {
  if (depth > 0 || cands.length < 2) return undefined;
  const top = [...new Map(cands.map((c) => [c.i, c])).values()].sort((a, b) => b.score - a.score).slice(0, K);
  if (top.length < 2) return undefined;
  let best: number | undefined;
  let bestV = -Infinity;
  depth++;
  try {
    for (const c of top) {
      const copy = structuredClone(s);
      const cw = cloneWorld(w, copy);
      const hero = copy.heroes[h.id];
      act(copy, cw, h.owner, { type: "move", hero: hero.id, to: c.i });
      // (The rest of the day as the classic AI plays it, battles and all; it ends the turn on the copy.)
      try {
        if (copy.current === h.owner && copy.winner === undefined) playAiTurn(copy, cw, h.owner);
      } catch {
        continue;
      }
      const v = standing(copy, cw, h.owner, h.id) + POT * outlook(copy, cw, copy.heroes[h.id]);
      if (v > bestV) [best, bestV] = [c.i, v];
    }
  } finally {
    depth--;
    w.refresh(s);
  }
  return best;
}

