import { HEX_COUNT, hexDistance, neighbours } from "./hex.ts";
import { type BattleAction, alive, canShoot, canShootAt, canShootWalls, blockedByNeighbours, controlSide, stats, canRetaliate, shotSplash, splashTargets, speedOf, effectOf, fleeBlock } from "./rules.ts";
import { activeUnit, areAdjacent, canFly, isWide, tailOf, reachable, unitHexes, enemyAdjacent, canOccupy, fliesBack } from "./reach.ts";
import { disabled, expectedDamage, totalHp, meditating } from "./damage.ts";
import type { BattleState, Side, Unit } from "./state.ts";
import { SPELL } from "../spells.ts";
import { type WallPart, autoCatapultTarget, gatePasses, inMoat, insideWalls } from "./siege.ts";
import { PROTECTS, actionWorth, protectionWorth } from "./aiMagic.ts";
import { skillLevel } from "../skills.ts";
import { casterSpells, castsLeft, creatureSpellAt, repairable } from "./creatureMagic.ts";
import { hasAbility } from "../creatures.ts";

/** Value of the damage we'd deal: killed creatures weighted by their AI value. */
function damageValue(s: BattleState, a: Unit, d: Unit, ranged: boolean, moved: number): number {
  const { min, max } = expectedDamage(s, a, d, ranged, moved);
  const dmg = Math.min((min + max) / 2, totalHp(s, d));
  return (dmg / stats(s, d).hp) * stats(s, d).aiValue;
}

/** What standing in the moat at `h` costs the stack: the moat's damage (fliers pass over it). */
function moatCost(s: BattleState, u: Unit, h: number): number {
  const moat = s.siege?.moat;
  if (!moat || canFly(s, u) || !unitHexes(s, u, h).some((x) => inMoat(s, x))) return 0;
  return (Math.min(moat.damage, totalHp(s, u)) / stats(s, u).hp) * stats(s, u).aiValue;
}

/**
 * What a stack would cost us on its next turn: the most it could destroy of one of ours, by shot
 * when it can shoot, else by a blow (wherever it reaches). Killing part of it takes that share away.
 */
function threatOf(s: BattleState, e: Unit): number {
  const ranged = canShoot(s, e);
  let worst = 0;
  for (const x of s.units) if (alive(x) && x.side !== e.side && !x.machine) worst = Math.max(worst, damageValue(s, e, x, ranged, 0));
  return worst;
}
/** Whether felling e lets x (a shooter of u's side, kept from shooting by e alone) shoot again. */
function freedBy(s: BattleState, x: Unit, e: Unit, u: Unit): boolean {
  if (!alive(x) || x === u || x.side !== u.side || x.machine || x.shots <= 0) return false;
  const c = stats(s, x);
  if (!hasAbility(c, "SHOOTER") || !blockedByNeighbours(s, x) || !areAdjacent(s, x, x.pos, e)) return false;
  return !s.units.some((o) => o !== e && alive(o) && !o.machine && controlSide(o) !== controlSide(x) && areAdjacent(s, x, x.pos, o));
}
/** The worth of hitting d: what dies of it, and that share of what it would do to us next (focus on the dangerous: shooters, the hard-hitting). */
function hitValue(s: BattleState, a: Unit, d: Unit, ranged: boolean, moved: number, threat: Map<Unit, number>): number {
  const { min, max } = expectedDamage(s, a, d, ranged, moved);
  const share = Math.min(1, (min + max) / 2 / Math.max(1, totalHp(s, d)));
  let t = threat.get(d);
  if (t === undefined) threat.set(d, (t = threatOf(s, d)));
  // A blinded, paralysed or petrified stack wakes when struck: what it would do again, unless it falls.
  const wakes = share < 1 && (effectOf(d, SPELL.BLIND) || effectOf(d, SPELL.PARALYZE) || effectOf(d, SPELL.STONE_GAZE)) ? (1 - share) * t : 0;
  return damageValue(s, a, d, ranged, moved) + share * t * THREAT_WEIGHT - wakes;
}
const THREAT_WEIGHT = 1;


function avgDamage(s: BattleState, a: Unit, d: Unit, moved: number): number {
  const { min, max } = expectedDamage(s, a, d, false, moved);
  return (min + max) / 2;
}

/** Can this stack get next to hex h on its next turn (by speed; flyers over everything)? */
function reachesNext(s: BattleState, x: Unit, h: number): boolean {
  if (canShoot(s, x)) return false;
  return Math.min(...unitHexes(s, x).map((p) => hexDistance(p, h))) <= speedOf(s, x) + 1;
}

/**
 * Retreat or surrender (VCMI's BattleAI: when the fight is lost, a hero worth keeping goes): when
 * what is left of our army is worth under a quarter of theirs, and the hero has grown (level 5 or
 * more, or carries artifacts): the hero retreats alone. Never a surrender, as the original's computer. Never against a side of
 * no worth, nor while the side's hero could still turn it with a spell (checked by the caller first).
 */
export function chooseFlight(s: BattleState, side: Side): BattleAction | null {
  const u = activeUnit(s);
  const hero = s.sides[side].hero;
  if (!u || !hero || controlSide(u) !== side) return null;
  const worth = (x: number) => s.units.filter((v) => alive(v) && !v.machine && !v.summoned && controlSide(v) === x).reduce((a, v) => a + (totalHp(s, v) / stats(s, v).hp) * stats(s, v).aiValue, 0);
  const ours = worth(side);
  const theirs = worth(1 - side);
  if (theirs <= 0 || ours >= FLEE_AT * theirs) return null;
  const grown = (hero.level ?? 1) >= 5 || (hero.bonuses ?? []).some((b) => b.artifact !== undefined);
  if (!grown) return null;
  // Never a surrender (2026-11-03: the original's computer never surrenders, it only retreats).
  if (!fleeBlock(s, side, false)) return { type: "retreat", unit: u.id, surrender: false };
  return null;
}
/** The share of the army its shooters must be worth for the rest to hold back and let the enemy come. */
const HOLD_SHARE = 0.5;
/** Below this share of the enemy's worth the fight is lost. */
const FLEE_AT = 0.25;

/**
 * Where an arrow tower or a Ballista aims when no one aims it (no Artillery): the original's own order, as VCMI's
 * BattleFlowProcessor has it: a stack that can act before a stunned one, a creature before a war machine, one that
 * can strike next turn (a shooter, or one that reaches an enemy) before one that can't, one inside the walls before one
 * outside, then the most worth killed (the damage at its value per hit point, and the creatures killed at their value).
 * The owner, 2026-11-01 21:54: the towers shot his Wolf Riders, outside the walls with no way in, not his shooters and flyers.
 */
export function machineShot(s: BattleState, u: Unit): BattleAction | null {
  if ((u.machine !== "tower" && u.machine !== "ballista" && u.machine !== "cannon") || skillLevel(s.sides[u.side].hero?.skills, "artillery")) return null;
  const targets = s.units.filter((e) => alive(e) && e.machine !== "tower" && controlSide(e) !== controlSide(u) && canShootAt(s, u, e));
  if (!targets.length) return null;
  const strikesNext = (e: Unit) => {
    if (canShoot(s, e)) return true;
    const foes = s.units.filter((o) => alive(o) && o !== e && o.machine !== "tower" && controlSide(o) !== controlSide(e));
    const at = [e.pos, ...reachable(s, e).keys()];
    return foes.some((o) => at.some((h) => areAdjacent(s, e, h, o)));
  };
  const worth = (e: Unit) => {
    const c = stats(s, e);
    const { min, max } = expectedDamage(s, u, e, true);
    const dealt = Math.min(totalHp(s, e), (min + max) / 2);
    return (dealt * c.aiValue) / c.hp + Math.min(e.count, Math.floor(dealt / c.hp)) * c.aiValue;
  };
  const key = (e: Unit) => [disabled(e) && !e.machine ? 0 : 1, e.machine ? 0 : 1, strikesNext(e) ? 1 : 0, s.siege && insideWalls(e.pos) ? 1 : 0, worth(e)];
  let best = targets[0];
  let bestKey = key(best);
  for (const e of targets.slice(1)) {
    const k = key(e);
    const i = k.findIndex((v, j) => v !== bestKey[j]);
    if (i >= 0 && k[i] > bestKey[i]) [best, bestKey] = [e, k];
  }
  return { type: "shoot", unit: u.id, target: best.id };
}

/** Greedy one-ply battle AI: best immediate trade, else close in on the nearest enemy. */
export function chooseAction(s: BattleState, noCast = false): BattleAction {
  const u = activeUnit(s);
  if (!u) throw new Error("battle is over");
  // Towers can't be attacked; only the catapult deals with walls; nothing touches a meditating stack.
  // A berserk stack goes for whoever is nearest.
  const berserk = u.effects?.some((e) => e.spell === SPELL.BERSERK);
  let enemies = s.units.filter((e) => alive(e) && e !== u && e.machine !== "tower" && !meditating(s, e) && (berserk || controlSide(e) !== controlSide(u)));
  if (berserk && enemies.length) {
    const d = (e: Unit) => Math.min(...unitHexes(s, e).map((h) => hexDistance(u.pos, h)));
    const nearest = Math.min(...enemies.map(d));
    enemies = enemies.filter((e) => d(e) === nearest);
  }
  if (u.machine === "catapult") return { type: "catapult", unit: u.id, target: catapultAim(s, u) };
  const auto = berserk ? null : machineShot(s, u);
  if (auto) return auto;
  // Cyclopes breach the walls when no catapult does it and there's no way in yet (the gate and every
  // stretch of wall standing); once one is down they shoot the defenders (they kept throwing all battle).
  const shut = !!s.siege?.walls.gate && (["upperWall", "overGate", "belowGate", "bottomWall"] as const).every((p) => (s.siege!.walls[p] ?? 1) > 0);
  if (canShootWalls(s, u) && shut && !s.units.some((x) => x.machine === "catapult" && x.side === u.side && alive(x)))
    return { type: "catapult", unit: u.id, target: catapultAim(s, u) };
  // No one to fight (every enemy hypnotized onto our side, say): hold.
  if (!enemies.length) return { type: "defend", unit: u.id };
  // Meditation (HotA Couatls): out of reach of the blows about to land.
  const calm = berserk ? null : meditationChoice(s, u, enemies);
  if (calm) return calm;
  // Ignition (HotA Automatons): once among the enemy with no friend beside it (it keeps its turn).
  const lit = berserk ? null : ignitionChoice(s, u, enemies);
  if (lit) return lit;
  const spell = berserk || noCast ? null : creatureCastChoice(s, u);
  // A caster's spell against what it would do otherwise, both played out on a copy of the battle.
  if (spell && !canShoot(s, u)) {
    const other = chooseAction(s, true);
    const side = controlSide(u) as Side;
    return actionWorth(s, side, spell.action) >= actionWorth(s, side, other) ? spell.action : other;
  }

  const threat = new Map<Unit, number>();
  let shot: BattleAction | null = null;
  let shotValue = -1;
  // (Steel Elves shoot only those not beside them: those they fight hand to hand.)
  const targets = enemies.filter((e) => canShootAt(s, u, e));
  if (canShoot(s, u) && targets.length) {
    let best = targets[0];
    for (const e of targets) {
      // An area shot (Magogs, Liches) counts everyone around the target: our own stacks there against it.
      const splash = shotSplash(s, u, e).reduce((a, x) => a + damageValue(s, u, x, true, 0) * (x.side === u.side ? -1 : 1), 0);
      const v = hitValue(s, u, e, true, 0, threat) + splash;
      if (v > shotValue) [best, shotValue] = [e, v];
    }
    // Every shot would hurt us more than them: no shot (move or wait instead, below).
    if (shotValue > 0 || !targets.some((e) => shotSplash(s, u, e).some((x) => x.side === u.side))) shot = { type: "shoot", unit: u.id, target: best.id };
  }
  // A shooter that can also cast (Ice and Storm Elementals) casts only when the spell is worth more than the shot.
  if (spell && (!shot || spell.value >= shotValue)) return spell.action;
  if (shot) return shot;
  // A shooter kept from shooting by a stack beside it: put off while an ally of ours still to act may fell that stack.
  const c0 = stats(s, u);
  if (!berserk && !u.waited && hasAbility(c0, "SHOOTER") && u.shots > 0 && !u.machine && enemyAdjacent(s, u) && s.units.some((x) => alive(x) && !x.acted && x !== u && x.side === u.side && !x.machine && !canShoot(s, x)))
    return { type: "wait", unit: u.id };

  const reach = reachable(s, u);
  let bestAttack: BattleAction | null = null;
  let bestScore = -Infinity;
  const perTarget = new Map<Unit, { score: number; rest: number; action: BattleAction }>();
  // Who out-shoots whom: the side with more shooting holds its melee back and lets the other come.
  // (Its shooters with shots left, blocked for now or not: a stack beside them is soon gone or fought off.)
  const shooting = (side: number) => s.units.filter((x) => alive(x) && x.side === side && !x.machine && x.shots > 0 && hasAbility(stats(s, x), "SHOOTER")).reduce((a, x) => a + x.count * stats(s, x).aiValue, 0);
  // (Never the besiegers: the defenders behind their walls don't come out, and the towers keep shooting.)
  // (And only when the shooters are half the army or more: 7 Orcs don't make 31 Goblins and the Wolf Riders wait for the enemy.)
  const army = s.units.filter((x) => alive(x) && x.side === u.side && !x.machine).reduce((a, x) => a + x.count * stats(s, x).aiValue, 0);
  const hold = !(s.siege && u.side === 0) && shooting(u.side) > 1.5 * shooting(1 - u.side) && shooting(u.side) >= HOLD_SHARE * army;
  for (const e of enemies) {
    for (const [h, { dist }] of reach) {
      if (!areAdjacent(s, u, h, e)) continue;
      // Breath, three heads, all-around: the others struck too (a friend behind the target, a loss).
      const splash = splashTargets(s, u, e, h).reduce((a, x) => a + damageValue(s, u, x, false, dist) * (x.side === u.side ? -1 : 1), 0);
      const gain = hitValue(s, u, e, false, dist, threat) + splash;
      // The counter-blow by what survives of the target, and the blows of whoever else reaches us there next.
      const left = 1 - Math.min(1, avgDamage(s, u, e, dist) / Math.max(1, totalHp(s, e)));
      const back = canRetaliate(s, e) ? damageValue(s, e, u, false, 0) * left : 0;
      // (Harpies fly back where they started: the blows that reach them are those that reach that hex.)
      const after = fliesBack(s, u, h) ? u.pos : h;
      const exposed = enemies.filter((x) => x !== e && reachesNext(s, x, after)).reduce((a, x) => a + damageValue(s, x, u, false, 0), 0);
      // Standing beside a shooter blocks it (it can't shoot while we're next to it): its next shot saved.
      const blocks = canShoot(s, e) && blockedByNeighbours(s, e) ? (threat.get(e) ?? threatOf(s, e)) * 0.5 : 0;
      // Felling a stack that stands beside a shooter of ours lets that shooter shoot again (a blocker stays: its shots of two rounds).
      const frees = left <= 0 ? s.units.filter((x) => freedBy(s, x, e, u)).reduce((a, x) => a + enemies.reduce((m, t) => Math.max(m, damageValue(s, x, t, true, 0)), 0) * 2, 0) : 0;
      const score = gain - back - exposed * 0.35 - dist * 0.01 + mendWorth(s, u, h) - (dist ? moatCost(s, u, h) : 0) + blocks + frees;
      const prev = perTarget.get(e);
      if (!prev || score > prev.score) perTarget.set(e, { score, rest: score - damageValue(s, u, e, false, dist) - splash + back, action: { type: "attack", unit: u.id, target: e.id, from: h } });
      if (score > bestScore) {
        bestScore = score;
        bestAttack = { type: "attack", unit: u.id, target: e.id, from: h };
      }
    }
  }
  // The few best targets' blows played out on a copy of the battle (the counter-blow, the kills and what the survivors still threaten, as they'd fall);
  // the share of a dangerous stack's threat a blow takes off stays in (one Hydra hit hard still threatens as much till it falls).
  if (perTarget.size > 1 && !berserk) {
    const side = controlSide(u) as Side;
    const top = [...perTarget.values()].sort((a, b) => b.score - a.score).slice(0, 3);
    let best = -Infinity;
    for (const c of top) {
      const v = actionWorth(s, side, c.action) + c.rest;
      if (v > best) [best, bestAttack] = [v, c.action];
    }
  }
  // A losing trade: put off till the rest of ours have moved (the target may be softened first); then taken, unless the shooters can do the work.
  // (Not for one that waits too: two stacks waiting for each other hand the enemy the first blow.)
  if (bestAttack && bestScore <= 0 && !u.waited && s.units.some((x) => alive(x) && !x.acted && !x.waited && x !== u && x.side === u.side && !x.machine)) return { type: "wait", unit: u.id };
  if (bestAttack && (bestScore > 0 || !hold)) return bestAttack;
  // Nothing to strike: the Jotunns send an ally forward instead.
  const sent = berserk ? null : teleportChoice(s, u, enemies, hold);
  if (sent) return sent;
  if (hold) return { type: "defend", unit: u.id };

  // Nobody in reach: walk toward the closest enemy, measured around obstacles.
  const dist = distanceToEnemies(s, u, enemies);
  const score = (h: number) => (canFly(s, u) ? Math.min(...enemies.flatMap((e) => unitHexes(s, e).map((x) => hexDistance(h, x)))) : dist[h]);
  // An Olgoi-Khorkhoi eats a corpse it can reach instead (a strike more when it gets there), the one nearest the enemy.
  if (!berserk) {
    let meal: number | undefined;
    for (const x of s.units) {
      if (alive(x)) continue;
      for (const h of unitHexes(s, x)) if ((meal === undefined || score(h) < score(meal)) && creatureSpellAt(s, u, h).some((o) => o.key === "summonLarva")) meal = h;
    }
    if (meal !== undefined) return { type: "creatureCast", unit: u.id, target: meal };
  }
  let to = u.pos;
  // Defenders of a town don't wade out into their own moat to meet the enemy; they wait inside.
  const wade = (h: number) => u.side === 1 && moatCost(s, u, h) > 0;
  for (const h of reach.keys()) if (!wade(h) && score(h) < score(to)) to = h;
  if (to === u.pos) return { type: "defend", unit: u.id };
  // Walking into their reach hands them the first blow. Unless their shooters (or, besieging, the
  // towers) make every round we wait cost us: wait while one of them is still to act (it may come to us), then stop short of
  // their reach where that still gets us closer.
  // (Not one already locked in a fight with a stack of ours: it is busy there, and ours are being cut down while we hang back.)
  const engaged = (x: Unit) => s.units.some((o) => alive(o) && o.side === u.side && !o.machine && areAdjacent(s, x, x.pos, o));
  const firstBlow = (h: number) => enemies.some((x) => !x.machine && !canShoot(s, x) && !meditating(s, x) && !engaged(x) && reachesNext(s, x, h) && damageValue(s, x, u, false, 0) > 0);
  if (firstBlow(to) && !canFly(s, u) && !(s.siege && u.side === 0) && shooting(1 - u.side) <= shooting(u.side)) {
    if (!u.waited && enemies.some((x) => !x.acted && !x.machine)) return { type: "wait", unit: u.id };
    let safe = u.pos;
    for (const h of reach.keys()) if (!wade(h) && !firstBlow(h) && score(h) < score(safe)) safe = h;
    if (safe !== u.pos) return { type: "move", unit: u.id, to: safe };
  }
  return { type: "move", unit: u.id, to };
}

/**
 * Mechanics (HotA): what standing on `h` is worth for the next turn's repair, which reaches only
 * the damaged or fallen mechanical allies beside them (never war machines): half of what it would mend.
 */
function mendWorth(s: BattleState, u: Unit, h: number): number {
  if (castsLeft(s, u) <= 0 || !casterSpells(u, s).includes("hotaRepair")) return 0;
  const per = stats(s, u).abilities.find((a) => a.type === "SPECIFIC_SPELL_POWER" && a.subtype === "hotaRepair")?.val ?? 10;
  const own = unitHexes(s, u, h);
  let best = 0;
  for (const t of s.units) {
    if (t === u || t.side !== u.side || t.sacrificed || !repairable(s, t)) continue;
    const c = stats(s, t);
    const missing = t.initialCount * c.hp - totalHp(s, t);
    if (missing <= 0 || !unitHexes(s, t).some((x) => own.some((m) => hexDistance(x, m) === 1))) continue;
    best = Math.max(best, (Math.min(missing, per * u.count) / c.hp) * c.aiValue);
  }
  return best * 0.5;
}

/** Spellcasting creatures cast while they can, on the stack it helps or hurts most (with what that's worth). */
function creatureCastChoice(s: BattleState, u: Unit): { action: BattleAction; value: number } | null {
  if (castsLeft(s, u) <= 0) return null;
  let best: BattleAction | null = null;
  let bestValue = 0;
  for (const t of s.units) {
    if (t.machine) continue;
    // (Teleport, Meditation, Ignition and Devour Corpses have their own reasons: teleportChoice, meditationChoice, ignitionChoice, the walk in chooseAction.)
    const options = creatureSpellAt(s, u, t.pos).filter((o) => o.key !== "teleport" && !o.key.startsWith("meditation") && !o.key.startsWith("detonates") && o.key !== "summonLarva");
    if (!options.length) continue;
    const c = stats(s, t);
    const friendly = t.side === u.side;
    // Raising the dead is worth the lost creatures; buffs the stack's strength; attacks the enemy's;
    // a Protection what it saves the stack from the enemy hero's spells of its school.
    const lost = (t.initialCount - t.count) * c.aiValue;
    const already = friendly && options.every((o) => t.effects?.some((e) => e.spell === o.id));
    const guard = options.every((o) => PROTECTS[o.id]) ? Math.max(...options.map((o) => protectionWorth(s, t, PROTECTS[o.id]))) : undefined;
    // (A once-a-battle raising is worth only the fallen it brings back: never spent on a stack merely wounded.)
    const raises = options.every((o) => o.key === "resurrection" || o.key === "summonDemons");
    const value = already ? 0 : guard !== undefined ? guard : raises ? Math.max(0, lost) : friendly ? t.count * c.aiValue * 0.3 : t.count * c.aiValue * 0.5;
    if (value > bestValue) [best, bestValue] = [{ type: "creatureCast", unit: u.id, target: t.pos }, value];
  }
  return best ? { action: best, value: bestValue } : null;
}

/**
 * Meditation (HotA Couatls, once a battle): when the enemies still to act this round would hit it
 * hard. The Couatl gives up its turn for it, so only when the blows coming outweigh its own and
 * cost it a good part of the stack; the Crimson Couatl keeps its turn, so whenever a blow is coming.
 */
function meditationChoice(s: BattleState, u: Unit, enemies: Unit[]): BattleAction | null {
  const option = creatureSpellAt(s, u, u.pos).find((o) => o.key.startsWith("meditation"));
  if (!option) return null;
  const coming = enemies.filter((x) => !x.acted && !x.machine && (canShoot(s, x) || unitHexes(s, u).some((h) => reachesNext(s, x, h))));
  const incoming = coming.reduce((a, x) => a + damageValue(s, x, u, canShoot(s, x), 0), 0);
  if (incoming <= 0) return null;
  const meditate: BattleAction = { type: "creatureCast", unit: u.id, target: u.pos };
  if (option.key === "meditation02") return meditate;
  const worth = u.count * stats(s, u).aiValue;
  // Its own blow this turn, if anyone is in reach (a shot counts too).
  const reach = reachable(s, u);
  const inReach = (e: Unit) => canShoot(s, u) || [...reach.keys()].some((h) => areAdjacent(s, u, h, e));
  const ownBlow = Math.max(0, ...enemies.filter(inReach).map((e) => damageValue(s, u, e, canShoot(s, u), 0)));
  return incoming >= worth * 0.15 && incoming > ownBlow ? meditate : null;
}

/**
 * Ignition (HotA Automatons): the blast hits everyone beside the stack as it falls, friends too, and
 * can't be turned off; so only when no friend of ours stands beside it and an enemy does, or it can
 * reach one this turn (it goes on to strike).
 */
function ignitionChoice(s: BattleState, u: Unit, enemies: Unit[]): BattleAction | null {
  if (!creatureSpellAt(s, u, u.pos).some((o) => o.key.startsWith("detonates"))) return null;
  if (s.units.some((x) => alive(x) && x !== u && x.side === u.side && !x.machine && areAdjacent(s, u, u.pos, x))) return null;
  const reach = reachable(s, u);
  const close = enemies.some((e) => !e.machine && (areAdjacent(s, u, u.pos, e) || [...reach.keys()].some((h) => areAdjacent(s, u, h, e))));
  return close ? { type: "creatureCast", unit: u.id, target: u.pos } : null;
}

/**
 * Teleport (HotA Jotunns): with nothing of its own to strike, an ally of ours that walks (no
 * shooter, no flyer) and can't reach the enemy on its next turn is put beside the enemy stack it
 * would hurt most (shooters first) when the blow is worth more than what strikes back. Holding
 * back for our shooters, only onto the enemy's shooters.
 */
function teleportChoice(s: BattleState, u: Unit, enemies: Unit[], hold: boolean): BattleAction | null {
  let best: BattleAction | null = null;
  let bestScore = 0;
  for (const ally of s.units) {
    if (!alive(ally) || ally === u || ally.side !== u.side || ally.machine || canShoot(s, ally) || canFly(s, ally)) continue;
    if (!creatureSpellAt(s, u, ally.pos).some((o) => o.key === "teleport")) continue;
    if (enemies.some((e) => unitHexes(s, e).some((h) => reachesNext(s, ally, h)))) continue;
    for (const e of enemies) {
      const shooter = canShoot(s, e);
      if (e.machine || (hold && !shooter)) continue;
      const gain = damageValue(s, ally, e, false, 0) * (shooter ? 1.5 : 1);
      const back = canRetaliate(s, e) ? damageValue(s, e, ally, false, 0) : 0;
      const score = gain - back * 0.5;
      if (score <= bestScore) continue;
      const dest = unitHexes(s, e)
        .flatMap((h) => neighbours(h))
        .find((h) => canOccupy(s, ally, unitHexes(s, ally, h)) && areAdjacent(s, ally, h, e));
      if (dest !== undefined) [best, bestScore] = [{ type: "creatureCast", unit: u.id, target: ally.pos, dest }, score];
    }
  }
  return best;
}

/**
 * Where the catapult (or a Cyclops) aims by itself: HotA's automatic targeting (siege.ts
 * autoCatapultTarget). Ties between equally damaged walls go by the round, so the choice stays a
 * pure function of the state.
 */
function catapultAim(s: BattleState, u: Unit): WallPart {
  const ballistics = skillLevel(s.sides[u.side].hero?.skills, "ballistics");
  return autoCatapultTarget(s, ballistics, !u.machine, (n) => (s.round * 7 + u.id) % n) ?? "gate";
}

/** Walking steps from every hex to the nearest enemy, through free terrain (units ignored). */
function distanceToEnemies(s: BattleState, u: Unit, enemies: Unit[]): number[] {
  const dist = new Array<number>(HEX_COUNT).fill(Infinity);
  const blocked = new Set(s.blocked);
  let frontier = enemies.flatMap((e) => unitHexes(s, e));
  for (const h of frontier) dist[h] = 0;
  for (let d = 1; frontier.length; d++) {
    const next: number[] = [];
    for (const h of frontier) {
      for (const n of neighbours(h)) {
        if (dist[n] !== Infinity || blocked.has(n) || !gatePasses(s, u.side, n)) continue;
        dist[n] = d;
        next.push(n);
      }
    }
    frontier = next;
  }
  // A wide unit stands on its head hex; use the closer of its two hexes.
  return dist.map((d, h) => (isWide(s, u) ? Math.min(d, dist[tailOf(u.side, h)] ?? Infinity) : d));
}
