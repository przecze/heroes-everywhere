// The Thieves' Guild: how the players rank against each other. A town's guild tells more the
// more taverns you own; a Den of Thieves tells everything. After VCMI's obtainPlayersStats.
import { wornArtifacts } from "./artifacts.ts";
import { B, townIncome } from "./town.ts";
import { extraGuildLevels } from "./townSpecials.ts";
import type { AdventureState, Hero } from "./types.ts";
import type { World } from "./world.ts";

export interface ThievesGuildInfo {
  /** Players still in the game, in colour order: the columns of the ranking. */
  players: number[];
  /** Nine rows (towns, heroes, gold, wood & ore, rare resources, obelisks, artifacts, army, income): places, each the players sharing it. Empty when hidden. */
  rows: number[][][];
  /** Per player in `players` order: their best hero (and its skills when known). */
  bestHero: ({ type: number; primary?: number[] } | null)[];
  personality: (string | null)[];
  bestCreature: (number | null)[];
}

/** Places by value, highest first; ties share a place. */
function rank(values: [number, number][]): number[][] {
  const sorted = [...values].sort((a, b) => b[1] - a[1]);
  const out: number[][] = [];
  let last = NaN;
  for (const [p, v] of sorted) {
    if (v !== last) out.push([]);
    out[out.length - 1].push(p);
    last = v;
  }
  return out;
}

/** How much a town's Thieves' Guild shows the viewer: one level per tavern they own. */
export function tavernLevel(s: AdventureState, viewer: number): number {
  return s.objects.filter((o) => o.town && !o.removed && o.owner === viewer && o.town.built.includes(B.TAVERN)).length + extraGuildLevels(s, viewer);
}

export function thievesGuild(s: AdventureState, w: World, level: number): ThievesGuildInfo {
  if (s.ranks) return shownRanks(s.ranks, level);
  const players = s.players.map((p, i) => (p.alive && p.controller !== "none" ? i : -1)).filter((i) => i >= 0);
  const heroes = (p: number) => s.heroes.filter((h) => !h.removed && h.owner === p && !h.retired);
  const towns = (p: number) => s.objects.filter((o) => o.town && !o.removed && o.owner === p);
  const value = (c: number) => w.creatures[c]?.aiValue ?? 0;
  // (HotA's Diplomat's Cloak: the army counts three times, heroes.thelazy.net.)
  const army = (h: Hero) => h.army.reduce((n, a) => n + (a ? a.count * value(a.creature) : 0), 0) * (wornArtifacts(h).includes(141) ? 3 : 1);
  const income = (p: number) =>
    towns(p).reduce((n, t) => n + townIncome(t)[6], 0) + s.objects.filter((o) => !o.removed && o.owner === p && o.type === 53 && o.subid === 6).length * 1000;
  const artifacts = (h: Hero) => (h.equipped ?? []).filter((a) => a >= 7).length + (h.backpack ?? []).length;
  const r = (lvl: number, f: (p: number) => number) => (level >= lvl ? rank(players.map((p) => [p, f(p)])) : []);
  const res = (p: number, ids: number[]) => ids.reduce((n, i) => n + s.players[p].resources[i], 0);
  const best = (p: number) => heroes(p).sort((a, b) => b.level - a.level || b.experience - a.experience)[0];
  return {
    players,
    rows: [
      r(0, (p) => towns(p).length),
      r(0, (p) => heroes(p).length),
      r(2, (p) => res(p, [6])),
      r(2, (p) => res(p, [0, 2])),
      r(3, (p) => res(p, [1, 3, 4, 5])),
      r(3, (p) => s.players[p].obelisks?.length ?? 0),
      r(4, (p) => heroes(p).reduce((n, h) => n + artifacts(h), 0)),
      r(4, (p) => heroes(p).reduce((n, h) => n + army(h), 0)),
      r(5, income),
    ],
    bestHero: players.map((p) => {
      const h = level >= 1 ? best(p) : undefined;
      return h ? { type: h.type, primary: level >= 2 ? [...h.primary] : undefined } : null;
    }),
    personality: players.map((p) => (level < 3 ? null : s.players[p].controller === "human" ? "Human" : "Warrior")),
    bestCreature: players.map((p) => {
      if (level < 4) return null;
      const all = [...heroes(p).flatMap((h) => h.army), ...towns(p).flatMap((t) => t.town!.garrison ?? [])].filter((a) => a);
      return all.length ? all.reduce((b, a) => (value(a!.creature) > value(b!.creature) ? a : b))!.creature : null;
    }),
  };
}

/** What a guild of this level shows of the whole ranking (a player's view of the game carries it, see AdventureState.ranks). */
function shownRanks(all: ThievesGuildInfo, level: number): ThievesGuildInfo {
  const rowLevel = [0, 0, 2, 2, 3, 3, 4, 4, 5];
  return {
    players: all.players,
    rows: all.rows.map((r, i) => (level >= rowLevel[i] ? r : [])),
    bestHero: all.bestHero.map((h) => (h && level >= 1 ? { type: h.type, primary: level >= 2 ? h.primary : undefined } : null)),
    personality: all.personality.map((p) => (level >= 3 ? p : null)),
    bestCreature: all.bestCreature.map((c) => (level >= 4 ? c : null)),
  };
}
