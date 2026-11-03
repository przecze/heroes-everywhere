// The fresh AI's sense of a fight: it plays the battle out, as the real one would go (the same battle setup and the
// battle AI on both sides), on a throwaway copy, and reads what is left. No ratios to tune: a guard is worth fighting
// when the battle, played, pays.
import { runAi } from "../../battle/runner.ts";
import { fight, siegeOf } from "../combat.ts";
import { splitMonster } from "../visit.ts";
import { bandLow, bandTop } from "../playerView.ts";
import { env } from "./mind.ts";
import type { AdventureState, AdvObject, ArmySlot, Hero } from "../types.ts";
import type { World } from "../world.ts";

export interface Outcome {
  win: boolean;
  /** What the hero's army loses, in gold (the creatures' prices). */
  lost: number;
  /** Share of the army's worth lost (0..1). */
  share: number;
  /** Experience the win brings (the hit points of the creatures killed). */
  xp: number;
}

/** A creature's price in gold, its rare resources at market worth. */
export const priceOf = (w: World, creature: number) => {
  const c = w.creatures[creature];
  if (!c) return 0;
  return c.cost.reduce((a, n, r) => a + n * (r === 6 ? 1 : r === 0 || r === 2 ? 250 : 500), 0);
};
export const armyGold = (w: World, slots: readonly (ArmySlot | null)[]) => slots.reduce((a, x) => a + (x ? x.count * priceOf(w, x.creature) : 0), 0);

const cache = new Map<string, Outcome>();
let cacheDay = -1;

/** The hero against these stacks (a monster's, a bank's guards), played out. */
/** A guard fight costing more than this share of the army is played a second time. */
const CLOSE = Number(env("FR_CLOSE") ?? 0.3);

export function playOut(s: AdventureState, w: World, h: Hero, stacks: ArmySlot[], object: number, bank = false, rival?: { hero?: Hero; owner: number; town?: AdvObject }): Outcome {
  if (cacheDay !== s.day) (cache.clear(), (cacheDay = s.day));
  const key = `${h.id}|${h.army.map((x) => (x ? `${x.creature}:${x.count}` : "")).join(",")}|${h.primary.join(",")}|${stacks.map((x) => `${x.creature}:${x.count}`).join(",")}|${object}|${rival?.hero?.id ?? ""}`;
  const known = cache.get(key);
  if (known) return known;
  // A rival's battle, played twice with other dice (its spells and luck are unknown): the worse of the two. So is a
  // close one against guards (one lucky roll called a fight won that the real one lost: the owner's second Key to Victory
  // game played again, the main hero lost on day 13).
  let out = playOnce(s, w, h, stacks, object, bank, rival, 0);
  if (out.win && (rival || out.share > CLOSE)) {
    const again = playOnce(s, w, h, stacks, object, bank, rival, 7919);
    if (!again.win || again.share > out.share) out = again;
  }
  cache.set(key, out);
  return out;
}

function playOnce(s: AdventureState, w: World, h: Hero, stacks: ArmySlot[], object: number, bank: boolean, rival: { hero?: Hero; owner: number; town?: AdvObject } | undefined, salt: number): Outcome {
  const copy = { ...s, battles: { ...s.battles }, log: [] as string[], rng: (s.rng + salt) >>> 0 } as AdventureState;
  const before = armyGold(w, h.army);
  let out: Outcome = { win: false, lost: before, share: 1, xp: 0 };
  try {
    const stacksNow = stacks.filter((x) => x && x.count > 0).map((x) => ({ creature: x.creature, count: x.count }));
    if (rival) {
      // (A copy of the rival hero: the battle setup adds a town's bonuses to the defender's own numbers.)
      const e = rival.hero ? (structuredClone(rival.hero) as Hero) : undefined;
      fight(copy, w, h, { name: "rival", stacks: stacksNow, owner: rival.owner, hero: e }, rival.town ? rival.town.id : -1, e?.id, rival.town ? siegeOf(rival.town) : undefined, false, rival.town);
    } else fight(copy, w, h, { name: "guards", stacks: stacksNow }, object, undefined, undefined, bank);
    const b = copy.battles[h.owner]!.battle;
    // (Played out by the battle AI on both sides, whoever the rival is.)
    for (const side of b.sides) side.controller = "ai";
    for (let n = 0; n < 4 && b.winner === null; n++) runAi(b);
    const win = b.winner === 0;
    let lost = 0;
    let xp = 0;
    for (const u of b.units) {
      if (u.machine || u.summoned || u.clone) continue;
      const dead = Math.max(0, u.initialCount - Math.max(0, u.count));
      if (u.side === 0) lost += dead * priceOf(w, u.creature);
      else xp += dead * (w.creatures[u.creature]?.hp ?? 0);
    }
    out = win ? { win, lost, share: before ? lost / before : 1, xp } : { win, lost: before, share: 1, xp: 0 };
  } catch {
    // (A battle the copy can't set up: treated as lost.)
  }
  return out;
}

/**
 * The hero against a monster on the map. Its count is known only by its band ("a pack", 20-49): the fight is played for
 * counts spread over the band (its bottom, a third, two thirds, its top; The owner, 2026-11-03: "simulate a couple of
 * scenarios") and taken as a win when at least SCEN_WINS of them are won, its losses the mean over all of them (a lost
 * one costs the whole army). Before, only the band's top was played (the owner's Key to Victory replayed: the main hero,
 * level 4, went for a pack of 18 Wargs counted as 15 and was lost), and a pack of 23 Pixies was fought as 49: in the owner's
 * Province seat the New AI beat 4 guards in 37 days to his 25. Off by default (FR_SCEN=1 turns it on): from his seat it beat 37 guards in 4 games to 20, but from the first seat it reached level 10 in 0 of 8 games to 2.
 */
const SCEN = env("FR_SCEN") === "1";
const SCEN_WINS = Number(env("FR_SCENWIN") ?? 3);
export function againstMonster(s: AdventureState, w: World, h: Hero, o: AdvObject, bands = SCEN): Outcome {
  const top = o.amount === undefined ? undefined : bandTop(o.amount);
  if (o.amount === undefined || !bands || top === o.amount) return playOut(s, w, h, splitMonster(s, w, h, o.amount === undefined ? o : { ...o, amount: top }), o.id);
  const low = bandLow(top!);
  const counts = [...new Set([low, low + Math.round((top! - low) / 3), low + Math.round((2 * (top! - low)) / 3), top!])];
  const outs = counts.map((n) => playOut(s, w, h, splitMonster(s, w, h, { ...o, amount: n }), o.id));
  const wins = outs.filter((x) => x.win);
  const mean = (f: (x: Outcome) => number) => outs.reduce((a, x) => a + f(x), 0) / outs.length;
  return { win: wins.length >= Math.min(SCEN_WINS, outs.length), lost: mean((x) => x.lost), share: mean((x) => x.share), xp: wins.length ? wins.reduce((a, x) => a + x.xp, 0) / wins.length : 0 };
}

/**
 * The hero against stacks a player sees only by their bands (a garrison's: "Elementals, lots"), played for counts
 * spread over the bands (all stacks at the bottom, a third, two thirds, the top) and won when 3 of the 4 are: a break
 * risked when it most likely goes well (2026-11-03, Province: three stacks of 25 Elementals shown as "lots").
 * Losses are the mean, a lost one costing the whole army. Stacks whose counts aren't a band's middle are exact.
 */
export function againstBanded(s: AdventureState, w: World, h: Hero, stacks: ArmySlot[], object: number): Outcome {
  if (!stacks.some((x) => bandTop(x.count) !== x.count)) return playOut(s, w, h, stacks, object);
  const at = (q: number) => stacks.map((x) => {
    const top = bandTop(x.count);
    if (top === x.count) return { ...x };
    const low = bandLow(top);
    return { ...x, count: Math.round(low + q * (top - low)) };
  });
  const outs = [0, 1 / 3, 2 / 3, 1].map((q) => playOut(s, w, h, at(q), object));
  const wins = outs.filter((x) => x.win);
  const mean = (f: (x: Outcome) => number) => outs.reduce((a, x) => a + f(x), 0) / outs.length;
  return { win: wins.length >= 3, lost: mean((x) => x.lost), share: mean((x) => x.share), xp: wins.length ? wins.reduce((a, x) => a + x.xp, 0) / wins.length : 0 };
}

/** The hero attacking a rival hero in the field. */
export const againstHero = (s: AdventureState, w: World, h: Hero, e: Hero): Outcome => playOut(s, w, h, e.army.filter((x): x is ArmySlot => !!x), -1, false, { hero: e, owner: e.owner });

/** The hero laying siege to a town (its garrison hero, or its garrison, behind its walls). */
export function againstTown(s: AdventureState, w: World, h: Hero, o: AdvObject, keeper?: Hero): Outcome {
  const stacks = keeper ? keeper.army : o.town!.garrison;
  if (!stacks.some((x) => x && x.count > 0)) return { win: true, lost: 0, share: 0, xp: 0 };
  return playOut(s, w, h, stacks.filter((x): x is ArmySlot => !!x), o.id, false, { hero: keeper, owner: o.owner, town: o });
}
