// Morale and luck in battle: what a stack has (heroes.thelazy.net/index.php/Morale, /Luck) and the rolls.
import { skillLevel } from "../skills.ts";
import { SPELL } from "../spells.ts";
import { ability, feelsMorale, hasAbility } from "../creatures.ts";
import { random } from "../rng.ts";
import { type BattleState, type Unit } from "./state.ts";
import { cursedGround, groundLuck, groundMorale } from "./ground.ts";
import { alive, effectOf, stats } from "./rules.ts";

// ---- morale --------------------------------------------------------------

// Trigger chance by |morale| (heroes.thelazy.net/index.php/Morale): bad morale is likelier than good.
const GOOD_MORALE_CHANCE = [0, 1 / 24, 1 / 12, 1 / 8];
const BAD_MORALE_CHANCE = [0, 1 / 12, 1 / 6, 1 / 4];
/** HotA's unlucky strikes: 2%, 4% and 6% (the mod's gameBalance "badLuckChance"), rarer than bad morale. */
const BAD_LUCK_CHANCE = [0, 0.02, 0.04, 0.06];


/**
 * Army-derived morale: +1 single town, -1 per town beyond two, +1 for Angels,
 * -1 for living troops alongside undead. Hero/artifact sources come later.
 */
export function moraleOf(s: BattleState, u: Unit): number {
  const c = stats(s, u);
  if (!feelsMorale(c)) return 0;
  // War machines and towers aren't troops: they never count as a town of the army.
  const army = s.units.filter((x) => x.side === u.side && x.initialCount > 0 && !x.machine);
  // Neutral creatures each count as their own town.
  const towns = new Set(army.map((x) => (stats(s, x).faction === "neutral" ? `n${x.creature}` : stats(s, x).faction)));
  let m = towns.size === 1 ? 1 : towns.size >= 3 ? -(towns.size - 2) : 0;
  // Temple of Loyalty: no penalty for mixing; Angelic Alliance: none while no evil town is among them.
  const united = s.sides[u.side].hero?.unitedArmy;
  const evil = ["inferno", "necropolis", "dungeon"];
  if (m < 0 && (united === "all" || (united === "nonEvil" && !army.some((x) => evil.includes(stats(s, x).faction))))) m = 0;
  // HotA: the Angelic Alliance costs evil creatures in the army 1 morale.
  if (united === "nonEvil" && evil.includes(c.faction)) m -= 1;
  // Battle-wide morale auras: Angels +1 for their side, Bone/Ghost Dragons -1 for the enemy.
  // (Minotaurs' MORALE is their own floor, no aura.)
  const aura = (x: Unit) => stats(s, x).abilities.find((a) => a.type === "MORALE" && a.subtype !== "minimum")?.val ?? 0;
  // (The Angels' +1 lasts the whole battle, even once they have all fallen: heroes.thelazy.net Angel.)
  if (army.some((x) => aura(x) > 0 && !x.summoned && !x.clone)) m += 1;
  // (So does the dragons' -1: heroes.thelazy.net Bone Dragon.)
  if (s.units.some((x) => x.side !== u.side && x.initialCount > 0 && !x.machine && !x.summoned && !x.clone && aura(x) < 0)) m -= 1;
  if (army.some((x) => alive(x) && hasAbility(stats(s, x), "UNDEAD"))) m -= 1;
  m += skillLevel(s.sides[u.side].hero?.skills, "leadership");
  m += (effectOf(u, SPELL.MIRTH)?.value ?? 0) - (effectOf(u, SPELL.SORROW)?.value ?? 0);
  m += (s.sides[u.side].hero?.morale ?? 0) + (s.sides[1 - u.side].hero?.enemyMorale ?? 0) + (s.sides[u.side].morale ?? 0);
  // The Spirit of Oppression on either side: nobody's morale above 0.
  if (s.sides.some((x) => x.hero?.noMorale)) m = Math.min(m, 0);
  // Holy Ground and Evil Fog by alignment; Cursed Ground: no good morale.
  m += groundMorale(s, c.faction);
  // Minotaurs: never below +1 (heroes.thelazy.net Minotaur), though the Spirit of Oppression and Cursed Ground still hold it at 0.
  if (c.abilities.some((a) => a.type === "MORALE" && a.subtype === "minimum") && !s.sides.some((x) => x.hero?.noMorale)) m = Math.max(m, 1);
  if (cursedGround(s)) m = Math.min(m, 0);
  return Math.max(-3, Math.min(3, m));
}

/** Bad morale strikes: the stack freezes in panic and loses its turn. */
export function panics(s: BattleState, u: Unit): boolean {
  const morale = moraleOf(s, u);
  return morale < 0 && random(s) < BAD_MORALE_CHANCE[-morale];
}

/** Good morale strikes: the stack acts again. */
export function cheers(s: BattleState, u: Unit): boolean {
  const morale = moraleOf(s, u);
  return morale > 0 && random(s) < GOOD_MORALE_CHANCE[morale];
}

// ---- luck ----------------------------------------------------------------

/**
 * Luck (heroes.thelazy.net/index.php/Luck): same odds as morale; a lucky
 * strike deals double damage and (HotA) an unlucky one half. Sources so far:
 * Devils (-1) and Arch Devils (-2) on the enemy, Halflings at least +1.
 */
export function luckOf(s: BattleState, u: Unit): number {
  let l = 0;
  let curse = 0;
  for (const e of s.units) {
    if (!alive(e) || e.side === u.side) continue;
    const c = stats(s, e);
    // Devils -1, HotA's Arch Devils -2.
    const luck = ability(c, "LUCK")?.val ?? 0;
    if (luck < 0) curse = Math.max(curse, -luck);
  }
  l -= curse;
  l += skillLevel(s.sides[u.side].hero?.skills, "luck");
  l += (effectOf(u, SPELL.FORTUNE)?.value ?? 0) - (effectOf(u, SPELL.MISFORTUNE)?.value ?? 0);
  l += (s.sides[u.side].hero?.luck ?? 0) + (s.sides[1 - u.side].hero?.enemyLuck ?? 0) + (s.sides[u.side].luck ?? 0);
  // Clover Field (neutral towns +2), Fields of Glory (-2).
  l += groundLuck(s, stats(s, u).faction);
  // Halflings: at least +1, whatever lowers it but the Hourglass and Cursed Ground (heroes.thelazy.net Halfling).
  // (A Leprechaun's LUCK is its doubling of the army's luck chance, rollLuck.)
  if ((ability(stats(s, u), "LUCK")?.val ?? 0) === 1) l = Math.max(l, 1);
  // The Hourglass of the Evil Hour on either side: nobody's luck above 0.
  if (s.sides.some((x) => x.hero?.noLuck)) l = Math.min(l, 0);
  // Cursed Ground: no luck at all (HotA: bad luck neither).
  if (cursedGround(s)) l = 0;
  return Math.max(-3, Math.min(3, l));
}

export function rollLuck(s: BattleState, u: Unit): "good" | "bad" | undefined {
  // Arrow towers (NO_LUCK) and the other war machines are never lucky or unlucky; the Ballista is
  // (heroes.thelazy.net War Machine: "Ballistas and Cannons are affected by Luck").
  if ((u.machine && u.machine !== "ballista" && u.machine !== "cannon") || hasAbility(stats(s, u), "NO_LUCK")) return undefined;
  const l = luckOf(s, u);
  // Leprechauns (HotA) double their army's chance of a lucky strike, while they stand (the mod's PERCENT_TO_ALL 100).
  const lucky = s.units.some((x) => alive(x) && x.side === u.side && (ability(stats(s, x), "LUCK")?.val ?? 0) >= 100) ? 2 : 1;
  if (l > 0 && random(s) < GOOD_MORALE_CHANCE[l] * lucky) return "good";
  if (l < 0 && random(s) < BAD_LUCK_CHANCE[-l]) return "bad";
  return undefined;
}

