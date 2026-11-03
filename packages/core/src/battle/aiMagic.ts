// The battle AI's spellcasting: try every castable spell on every sensible target, keep the best.
import { COMBAT_SPELLS, SPELL, SUMMONED, type School, type SpellInfo } from "../spells.ts";
import { HEX_COUNT, hexCol, neighbours } from "./hex.ts";
import { affects, canTeleport, castSpell, castable, mastery, obstacleAt, placeHexes, sacrificeable, spellCost, spellDamage, spellTargets, summonCount } from "./magic.ts";
import { type BattleAction, alive, applyAction, canShoot, controlSide, speedOf, stats } from "./rules.ts";
import { canFly, unitHexes } from "./reach.ts";
import { disabled, expectedDamage, isLiving, totalHp } from "./damage.ts";
import { hexDistance } from "./hex.ts";
import { type BattleState, type Side, type Unit, copyBattle } from "./state.ts";

const value = (s: BattleState, u: Unit) => u.count * stats(s, u).aiValue;

/** The four Protections and the school each one guards against. */
export const PROTECTS: Record<number, School> = { [SPELL.PROT_AIR]: "air", [SPELL.PROT_FIRE]: "fire", [SPELL.PROT_WATER]: "water", [SPELL.PROT_EARTH]: "earth" };

/**
 * What a Protection on `t` is worth: half of what the enemy hero's worst spell of that school
 * would do to it (nothing when the enemy has shown no such spell, or it can't touch the stack anyway).
 * Only what a player would know: the spells the enemy hero has cast in this battle (the log shows
 * them) and its spell points (its card in battle shows them), never its spellbook (2026-10-31).
 */
export function protectionWorth(s: BattleState, t: Unit, school: School): number {
  const foe = (1 - t.side) as Side;
  const hero = s.sides[foe].hero;
  let worst = 0;
  for (const id of new Set(s.castLog?.[foe] ?? [])) {
    const sp = s.spells?.[id];
    if (!sp || !COMBAT_SPELLS[sp.id]?.damage || !sp.schools.includes(school) || spellCost(s, foe, sp) > (hero?.mana ?? 0) || !affects(s, sp, t)) continue;
    const dmg = Math.min(spellDamage(s, foe, sp, t), totalHp(s, t));
    worst = Math.max(worst, (dmg / stats(s, t).hp) * stats(s, t).aiValue);
  }
  return worst * 0.5;
}

/** Rough worth of the spell's effect on one unit, from the caster's side (negative when it hurts us). */
function effectWorth(s: BattleState, side: Side, spell: SpellInfo, u: Unit): number {
  const def = COMBAT_SPELLS[spell.id];
  const sign = u.side === side ? 1 : -1;
  if (def.damage) {
    const dmg = Math.min(spellDamage(s, side, spell, u), totalHp(s, u));
    return -sign * (dmg / stats(s, u).hp) * stats(s, u).aiValue;
  }
  switch (spell.id) {
    case SPELL.CURE:
    case SPELL.RESURRECTION:
    case SPELL.ANIMATE_DEAD: {
      const missing = u.initialCount * stats(s, u).hp - totalHp(s, u);
      return missing > 0 ? (Math.min(missing, 300) / stats(s, u).hp) * stats(s, u).aiValue * 0.8 : 0;
    }
    case SPELL.DISPEL: {
      // Worth what it takes away: the enemy's blessings, our own stacks' curses (a spell for a
      // friend is a blessing, for an enemy a curse), less our blessings and their curses that go
      // too (expert Dispel clears every stack). Disrupting Ray stays.
      let net = 0;
      for (const e of u.effects ?? []) {
        if (e.spell === SPELL.DISRUPTING_RAY) continue;
        const who = COMBAT_SPELLS[e.spell]?.who;
        if (who === (u.side === side ? "enemy" : "friend")) net++;
        else if (who === (u.side === side ? "friend" : "enemy")) net--;
      }
      return net * value(s, u) * 0.15;
    }
    case SPELL.CLONE:
      return value(s, u) * 0.3;
  }
  if (u.effects?.some((e) => e.spell === spell.id)) return 0;
  // A Protection: what it saves the stack from the enemy hero's spells of its school (nothing when the enemy has none
  // it can cast: the owner's note 2026-10-27 18:26, the AI cast Protection from Earth against a hero with no earth spell).
  if (PROTECTS[spell.id]) return u.side === side ? protectionWorth(s, u, PROTECTS[spell.id]) : 0;
  // Buffs on our best stacks, debuffs on theirs: a fifth of the stack's worth.
  return value(s, u) * 0.2;
}

/**
 * What one stack's next blow (or shot) is worth against the other: not capped at what's left of it,
 * or a spell that thins the enemy would seem to blunt our own blows.
 */
function blowValue(s: BattleState, a: Unit, d: Unit, ranged: boolean): number {
  const { min, max } = expectedDamage(s, a, d, ranged, 0);
  return ((min + max) / 2 / stats(s, d).hp) * stats(s, d).aiValue;
}
/** How a stack stands to hurt the other side next: its best blow (a shooter's shot), less for a walker nowhere near; nothing while it can't act. */
function menace(s: BattleState, u: Unit, foes: Unit[]): number {
  if (disabled(u) || u.effects?.some((e) => e.spell === SPELL.BERSERK) || !foes.length) return 0;
  const ranged = canShoot(s, u);
  let best = 0;
  for (const e of foes) best = Math.max(best, blowValue(s, u, e, ranged));
  if (ranged || canFly(s, u)) return best;
  const near = foes.some((e) => unitHexes(s, e).some((h) => unitHexes(s, u).some((x) => hexDistance(x, h) <= speedOf(s, u) + 1)));
  return near ? best : best * 0.6;
}
/**
 * The side's standing: what its stacks are worth against the other's, and the blows each stands
 * to land next (a blinded or slowed stack lands fewer, a blessed one more, a hypnotized one for the
 * other side). A spell is worth what it changes of this.
 */
function standing(s: BattleState, side: Side, before: BattleState = s): number {
  const live = s.units.filter((u) => alive(u) && !u.machine);
  // (Blows are weighed against the stacks standing before the spell, fallen ones too: one that kills a stack mustn't seem to leave our blows nothing to land on.)
  const targets = s.units.filter((u) => !u.machine && (before.units[u.id] ? alive(before.units[u.id]) : alive(u)));
  const owner = (e: Unit) => controlSide(before.units[e.id] ?? e);
  let v = 0;
  for (const u of live) {
    const by = controlSide(u);
    const sign = by === side ? 1 : -1;
    // (By its hit points: a wound healed counts, as a creature raised does.)
    v += sign * (totalHp(s, u) / stats(s, u).hp) * stats(s, u).aiValue;
    v += sign * MENACE * menace(s, u, targets.filter((e) => owner(e) !== by));
  }
  return v;
}
/** How many blows' worth a stack's menace counts for (a spell lasts a few rounds; a blow lands once). */
const MENACE = 1.5;
/** A spell's worth, played out on a copy of the battle: the standing after against before. */
function castWorth(s: BattleState, side: Side, action: Extract<BattleAction, { type: "cast" }>, before: number): number {
  const t = copyBattle(s);
  try {
    castSpell(t, side, action.spell, action.target, [], action.dest);
  } catch {
    return -Infinity;
  }
  return standing(t, side, s) - before;
}

/** A stack's action, played out on a copy of the battle: the standing after it, for the side that acts (−Infinity when refused). */
export function actionWorth(s: BattleState, side: Side, action: BattleAction): number {
  const t = copyBattle(s);
  try {
    applyAction(t, action);
  } catch {
    return -Infinity;
  }
  return standing(t, side, s);
}

/** The best spell to cast now, or null if nothing is worth the mana. */
export function chooseSpell(s: BattleState, side: Side, unit: number): BattleAction | null {
  let best: BattleAction | null = null;
  let bestScore = 0;
  const hexes = new Set<number>();
  for (const u of s.units) if (alive(u)) for (const h of [u.pos, ...neighbours(u.pos)]) hexes.add(h);
  const tried: Extract<BattleAction, { type: "cast" }>[] = [];
  const floor: number[] = [];
  const worthOf = (x: number) => s.units.filter((u) => alive(u) && !u.machine && controlSide(u) === x).reduce((a, u) => a + value(s, u), 0);
  // A fight won already: the enemy left is worth under a twentieth of ours.
  const trivial = worthOf(1 - side) < 0.05 * worthOf(side);
  // (Won already: the mana is kept for a fight that needs it.)
  if (trivial) return null;
  for (const spell of castable(s, side)) {
    const def = COMBAT_SPELLS[spell.id];
    if (def.shape === "obstacle") {
      // Remove Obstacle: one between the two sides, with foot soldiers of ours that have to walk round it.
      const m = mastery(s, side, spell);
      const walkers = s.units.filter((u) => alive(u) && u.side === side && !u.machine && !stats(s, u).abilities.some((a) => a.type === "FLYING" || a.type === "SHOOTER"));
      const foes = s.units.filter((u) => alive(u) && u.side !== side && !u.machine);
      if (!walkers.length || !foes.length) continue;
      const cols = [...walkers, ...foes].map((u) => hexCol(u.pos));
      const [lo, hi] = [Math.min(...cols), Math.max(...cols)];
      const worth = walkers.reduce((a, u) => a + value(s, u), 0) * 0.02;
      if (worth <= bestScore) continue;
      for (let hex = 0; hex < HEX_COUNT; hex++) {
        const c = hexCol(hex);
        if (c <= lo || c >= hi || obstacleAt(s, hex, m) < 0) continue;
        [best, bestScore] = [{ type: "cast", unit, spell: spell.id, target: hex }, worth];
        break;
      }
      continue;
    }
    if (def.shape === "teleport") {
      // A slow melee stack of ours, nowhere near the enemy, next to their best stack (shooters most).
      const foes = s.units.filter((u) => alive(u) && u.side !== side && !u.machine);
      const nearFoe = (u: Unit) => foes.some((f) => unitHexes(s, f).some((h) => neighbours(u.pos).includes(h)));
      for (const u of s.units) {
        // (One the spell can take: spellTargets says, as castSpell does; at a siege some it can't.)
        if (!alive(u) || u.side !== side || u.machine || nearFoe(u) || !spellTargets(s, side, spell, u.pos).length) continue;
        const a = stats(s, u).abilities;
        if (a.some((x) => x.type === "SHOOTER" || x.type === "FLYING")) continue;
        for (const f of foes) {
          const shooter = stats(s, f).abilities.some((x) => x.type === "SHOOTER");
          const score = Math.min(value(s, u), value(s, f)) * (shooter ? 0.35 : 0.15);
          if (score <= bestScore) continue;
          const dest = neighbours(f.pos).find((h) => canTeleport(s, u, h, mastery(s, side, spell)));
          if (dest !== undefined) [best, bestScore] = [{ type: "cast", unit, spell: spell.id, target: u.pos, dest }, score];
        }
      }
      continue;
    }
    if (def.shape === "sacrifice") {
      // A fallen stack of ours brought back with a living one given up: worth it when what comes
      // back is worth more than what goes.
      for (const dead of s.units) {
        if (alive(dead) || dead.side !== side || dead.summoned || dead.machine || !isLiving(stats(s, dead))) continue;
        for (const victim of s.units) {
          if (!sacrificeable(s, side, victim, dead)) continue;
          const back = Math.min(((s.sides[side].hero?.primary[2] ?? 0) + stats(s, victim).hp + spell.effect[mastery(s, side, spell)]) * victim.count, dead.initialCount * stats(s, dead).hp);
          const score = (back / stats(s, dead).hp) * stats(s, dead).aiValue - value(s, victim);
          if (score > bestScore) [best, bestScore] = [{ type: "cast", unit, spell: spell.id, target: dead.pos, dest: victim.pos }, score];
        }
      }
      continue;
    }
    // Battlefield spells: worth it when enemy foot soldiers still have to walk to us.
    if (def.shape === "field" || def.shape === "place") {
      const walkers = s.units.filter((u) => alive(u) && u.side !== side && !u.machine && !stats(s, u).abilities.some((a) => a.type === "FLYING" || a.type === "SHOOTER"));
      const ourShooters = s.units.filter((u) => alive(u) && u.side === side && stats(s, u).abilities.some((a) => a.type === "SHOOTER")).length;
      const worth = walkers.reduce((a, u) => a + value(s, u), 0);
      if (spell.id === SPELL.EARTHQUAKE) {
        // Besieging with the walls still up and foot soldiers of ours to get through them.
        const up = !!s.siege && side === 0 && (["bottomWall", "belowGate", "overGate", "upperWall"] as const).some((p) => (s.siege!.walls[p] ?? 0) > 0);
        const ours = s.units.filter((u) => alive(u) && u.side === side && !u.machine && !stats(s, u).abilities.some((a) => a.type === "FLYING" || a.type === "SHOOTER"));
        const score = up ? ours.reduce((a, u) => a + value(s, u), 0) * 0.08 : 0;
        if (score > bestScore) [best, bestScore] = [{ type: "cast", unit, spell: spell.id, target: 0 }, score];
        continue;
      }
      if (!walkers.length) continue;
      if (def.shape === "field") {
        // Quicksand slows them into our shooters; Land Mines hurt them on the way.
        const score = worth * (spell.id === SPELL.LAND_MINE ? 0.12 : ourShooters ? 0.1 : 0.04);
        if (score > bestScore) [best, bestScore] = [{ type: "cast", unit, spell: spell.id, target: 0 }, score];
        continue;
      }
      // Fire Wall / Force Field: in front of the nearest walker, between it and us.
      const m = mastery(s, side, spell);
      const dir = side === 0 ? -1 : 1;
      for (const u of walkers) {
        const hex = u.pos + dir;
        if (!placeHexes(s, side, hex, m).length) continue;
        const score = value(s, u) * (spell.id === SPELL.FIRE_WALL ? 0.15 : ourShooters ? 0.12 : 0.03);
        if (score > bestScore) [best, bestScore] = [{ type: "cast", unit, spell: spell.id, target: hex }, score];
      }
      continue;
    }
    if (def.shape === "summon") {
      const c = s.creatures[SUMMONED[spell.id]];
      if (c && summonCount(s, side, spell, c, mastery(s, side, spell)) > 0) tried.push({ type: "cast", unit, spell: spell.id, target: 0 }), floor.push(0);
      continue;
    }
    // The likeliest targets by a rough worth, then each played out (castWorth).
    const candidates = def.shape === "single" || def.shape === "chain" || def.shape === "all" ? s.units.filter(alive).map((u) => u.pos) : [...hexes];
    const rough: [number, number][] = [];
    for (const hex of candidates) {
      const targets = spellTargets(s, side, spell, hex);
      if (!targets.length) continue;
      const score = targets.reduce((a, u) => a + effectWorth(s, side, spell, u), 0);
      if (score > 0) rough.push([score, hex]);
      if (def.shape === "all") break;
    }
    rough.sort((x, y) => y[0] - x[0]);
    for (const [r, hex] of rough.slice(0, 4)) {
      tried.push({ type: "cast", unit, spell: spell.id, target: hex });
      // (What the copy can't show (luck and morale, a shield against blows to come, a protection for later spells) a little of the rough worth stands for, in a fight that isn't won already.)
      floor.push(def.damage || trivial ? 0 : r * 0.25);
    }
  }
  if (tried.length) {
    const before = standing(s, side);
    for (const [i, action] of tried.entries()) {
      const score = castWorth(s, side, action, before) + (floor[i] ?? 0);
      if (score > bestScore) [best, bestScore] = [action, score];
    }
  }
  return best;
}
