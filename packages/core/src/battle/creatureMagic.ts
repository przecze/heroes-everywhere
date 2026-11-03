// Creatures that cast spells (heroes.thelazy.net/index.php/Spellcaster): Archangels raise the
// dead, Pit Lords turn corpses into Demons, Ogre Magi, elementals, Faerie Dragons and Master
// Genies cast a few times a battle, and HotA's Enchanters cast a mass spell every third round.
import { ability, hasAbility } from "../creatures.ts";
import { cursedGround } from "./ground.ts";
import { randInt, random } from "../rng.ts";
import { COMBAT_SPELLS, SPELL, type SpellInfo, isPositive } from "../spells.ts";
import { asCreature, castSpell, magicBlocked, spellTargets } from "./magic.ts";
import { type BattleEvent, alive, canShoot, heal, oblivion, stats, strike } from "./rules.ts";
import { reachable, unitHexes } from "./reach.ts";
import { hpOf, isLiving } from "./damage.ts";
import { hexDistance, neighbours } from "./hex.ts";
import { type BattleState, GENIE_SPELLS, type Unit } from "./state.ts";
import { Refusal } from "../refusal.ts";
import { LOG } from "./texts.ts";

/** Spells a Master Genie picks from at random (beneficial ones that would do something). */
const GENIE = GENIE_SPELLS;

const DEMON = 48;

/** The spell keys this creature can cast (empty if none). */
export function casterSpells(u: Unit, s: BattleState): string[] {
  const c = stats(s, u);
  if (hasAbility(c, "RANDOM_SPELLCASTER")) return GENIE;
  // HotA Mechanics repair mechanical creatures next to them (not Golems or war machines: heroes.thelazy.net).
  if (c.abilities.some((a) => a.type === "ADJACENT_SPELLCASTER" && a.subtype === "hotaRepair")) return ["hotaRepair"];
  return c.abilities.filter((a) => a.type === "SPELLCASTER" && a.subtype).map((a) => a.subtype!);
}

/** Faerie Dragons (the dragons with spells): they cast even where an Anti-magic Garrison stops all magic. */
const faerieDragon = (s: BattleState, u: Unit) => hasAbility(stats(s, u), "DRAGON_NATURE");

/** Casts left this battle. */
export function castsLeft(s: BattleState, u: Unit): number {
  if (u.casts !== undefined) return u.casts;
  return casterSpells(u, s).length ? ability(stats(s, u), "CASTS")?.val ?? 1 : 0;
}

const byKey = (s: BattleState, key: string) => Object.values(s.spells ?? {}).find((sp) => sp.key === key);

/** Could this creature cast at `hex` now (and with which spell)? Random casters pick when they cast. */
export function creatureSpellAt(s: BattleState, u: Unit, hex: number): SpellInfo[] {
  if (!alive(u) || castsLeft(s, u) <= 0) return [];
  const out: SpellInfo[] = [];
  for (const key of casterSpells(u, s)) {
    // Devour Corpses (HotA Olgoi-Khorkhoi, the mod's "summonLarva"): a corpse it can reach, instead of a move or an attack.
    if (key === "summonLarva") {
      if (corpseAt(s, u, hex) && reachable(s, u).has(hex)) out.push({ key, id: -5, name: "Devour" } as SpellInfo);
      continue;
    }
    // Teleport an ally (HotA Jotunns): the ally's hex; the destination comes with the action.
    if (key === "teleport") {
      if (s.noMagic) continue;
      if (s.units.some((x) => alive(x) && x.side === u.side && x !== u && !x.machine && unitHexes(s, x).includes(hex))) out.push(byKey(s, "teleport") ?? ({ key, id: SPELL.TELEPORT, name: "Teleport" } as SpellInfo));
      continue;
    }
    // Meditation (HotA Couatls): on itself, once a battle.
    if (key.startsWith("meditation")) {
      if (unitHexes(s, u).includes(hex) && !u.meditated) out.push({ key, id: -4, name: "Meditation" } as SpellInfo);
      continue;
    }
    // Ignition (HotA Automatons, the mod's "detonates"): on itself, once; from then on the stack detonates as it dies.
    if (key.startsWith("detonates")) {
      if (unitHexes(s, u).includes(hex) && !u.ignited) out.push({ key, id: -6, name: "Ignition" } as SpellInfo);
      continue;
    }
    if (key === "summonDemons") {
      // (Cursed Ground stops it: heroes.thelazy.net Pit Lord.)
      if (cursedGround(s)) continue;
      const corpse = demonTarget(s, u, hex);
      if (corpse && demonsRaised(s, u, corpse) > 0) out.push({ key, id: -1 } as SpellInfo);
      continue;
    }
    if (key === "hotaRepair") {
      if (repairTarget(s, u, hex)) out.push({ key, id: -2, name: "Repair" } as SpellInfo);
      continue;
    }
    if (key.startsWith("heatStroke")) {
      if (heatStrokeArea(s, u, hex).length) out.push({ key, id: -3, name: "Heat Stroke" } as SpellInfo);
      continue;
    }
    const sp = byKey(s, key);
    // Cursed Ground: creatures cast no spells (their other powers still work); nor under a hero's
    // Orb of Inhibition, Recanter's Cloak or Cape of Silence (castSpell turns those down).
    if (!sp || !COMBAT_SPELLS[sp.id] || cursedGround(s) || magicBlocked(s, sp, faerieDragon(s, u))) continue;
    // Elementals' protections and Ogre Magi's Bloodlust work on one stack, like a hero at basic.
    const hit = asCreature({ name: "", mastery: masteryOf(s, u, key), power: 1, duration: 1, raise: angelRaise(s, u) }, () => spellTargets(s, u.side, sp, hex));
    if (hit.length && (!hasAbility(stats(s, u), "RANDOM_SPELLCASTER") || genieWorthIt(s, u, sp, hit[0]))) out.push(sp);
  }
  return out;
}

/**
 * Master Genies pass over spells that would do nothing (heroes.thelazy.net Genie): no Slayer while no
 * enemy king it would help against (advanced: King 1 and 2), no Cure on a stack unhurt and unhindered.
 */
function genieWorthIt(s: BattleState, u: Unit, sp: SpellInfo, target: Unit): boolean {
  if (sp.key === "slayer") return s.units.some((x) => alive(x) && x.side !== u.side && (ability(stats(s, x), "KING")?.val ?? -1) >= 0 && Math.max(1, ability(stats(s, x), "KING")!.val ?? 1) <= masteryOf(s, u, sp.key));
  if (sp.key === "cure") return target.firstHp < hpOf(s, target) || (target.effects ?? []).some((e) => !isPositive(e.spell));
  return true;
}

/** The health Archangels give back: 100 per angel. */
const angelRaise = (s: BattleState, u: Unit) => (stats(s, u).abilities.find((a) => a.type === "SPECIFIC_SPELL_POWER" && a.subtype === "resurrection")?.val ?? 100) * u.count;

function masteryOf(s: BattleState, u: Unit, key: string): number {
  const c = stats(s, u);
  if (hasAbility(c, "RANDOM_SPELLCASTER")) return ability(c, "RANDOM_SPELLCASTER")?.val ?? 2;
  // Resurrection by Archangels is permanent (expert); single-target versions otherwise.
  const v = c.abilities.find((a) => a.type === "SPELLCASTER" && a.subtype === key)?.val ?? 0;
  return Math.min(v, key === "resurrection" ? 3 : 2);
}

/**
 * A damaged or fallen mechanical stack of ours next to the Mechanics: Automatons (not once they have
 * detonated), Dreadnoughts and Juggernauts; not Golems or war machines (heroes.thelazy.net Mechanic).
 */
function repairTarget(s: BattleState, u: Unit, hex: number): Unit | undefined {
  const t = s.units.find((x) => x.side === u.side && x !== u && !x.sacrificed && unitHexes(s, x).includes(hex));
  if (!t || !repairable(s, t)) return undefined;
  return unitHexes(s, t).some((h) => unitHexes(s, u).some((m) => hexDistance(h, m) === 1)) ? t : undefined;
}

/** A mechanical stack (not a war machine) with something to mend; none at all under the Ring of Oblivion (the HotA mod's battle-wide immunity to hotaRepair). */
export function repairable(s: BattleState, t: Unit): boolean {
  if (t.machine || !hasAbility(stats(s, t), "MECHANICAL") || oblivion(s)) return false;
  return t.count < t.initialCount || t.firstHp < stats(s, t).hp;
}

/**
 * Devour Corpses (HotA Olgoi-Khorkhoi): every corpse on these hexes is gone for good (no raising)
 * and owes a bonus strike on the next attack; they add up without limit. Returns how many were eaten.
 */
export function devour(s: BattleState, u: Unit, hexes: number[], events: BattleEvent[]): number {
  const eaten = s.units.filter((x) => x !== u && !alive(x) && !x.sacrificed && !x.summoned && unitHexes(s, x).some((h) => hexes.includes(h)));
  if (!eaten.length) return 0;
  for (const x of eaten) x.sacrificed = true;
  u.bonusStrikes = (u.bonusStrikes ?? 0) + eaten.length;
  const note = LOG.ours("devour", [{ cr: u.creature, n: 2 }, { list: eaten.map((x) => ({ cr: x.creature, n: 2 })) }]);
  s.log.push(note);
  events.push({ e: "spell", side: u.side, spell: SPELL.ANIMATE_DEAD, hex: hexes[0], units: eaten.map((x) => x.id), damage: [], resisted: [], ability: true, by: u.id, note, look: "devour" });
  return eaten.length;
}

/** Does this stack devour corpses (HotA Olgoi-Khorkhoi)? */
export const devours = (s: BattleState, u: Unit) => casterSpells(u, s).includes("summonLarva");

/** A fallen stack (anyone's) on this hex, not yet eaten or given up. */
function corpseAt(s: BattleState, u: Unit, hex: number): Unit | undefined {
  return s.units.find((x) => x !== u && !alive(x) && !x.sacrificed && !x.summoned && unitHexes(s, x).includes(hex));
}

/**
 * A fallen friendly stack of living creatures: Pit Lords can raise Demons from it. Fallen Demons too, so
 * the same corpse can rise again and again (heroes.thelazy.net Pit Lord, "Demon herding").
 */
function demonTarget(s: BattleState, u: Unit, hex: number): Unit | undefined {
  return s.units.find((x) => x.side === u.side && !alive(x) && !x.summoned && !x.sacrificed && !x.machine && unitHexes(s, x).includes(hex) && isLiving(stats(s, x)) && !hasAbility(stats(s, x), "MECHANICAL"));
}

/** Casts that leave the turn going on: a Crimson Couatl's Meditation, an Automaton's Ignition (both on itself). */
export function castKeepsTurn(s: BattleState, u: Unit, hex: number): boolean {
  if (!unitHexes(s, u).includes(hex)) return false;
  const keys = casterSpells(u, s);
  return (keys.includes("meditation02") && !u.meditated) || (keys.some((k) => k.startsWith("detonates")) && !u.ignited);
}

/** The creature casts at `hex` instead of acting. */
export function creatureCast(s: BattleState, u: Unit, hex: number, events: BattleEvent[], dest?: number) {
  const options = creatureSpellAt(s, u, hex);
  if (!options.length) throw new Refusal("nothing to cast there");
  // Faerie Dragons pick their spell by the odds of the original's table.
  const c0 = stats(s, u);
  const sp = options.length > 1 && options.some((o) => FAERIE_WEIGHT[o.key] && hasAbility(c0, "DRAGON_NATURE")) ? weighted(s, options, FAERIE_WEIGHT) : options[randInt(s, 0, options.length - 1)];
  const c = stats(s, u);
  if (sp.key === "summonLarva") {
    // The stack moves onto the corpse and eats every one lying there.
    if (u.pos !== hex) {
      events.push({ e: "move", unit: u.id, path: [u.pos, hex], fly: true });
      u.pos = hex;
    }
    devour(s, u, [hex], events);
    return;
  }
  if (sp.key === "teleport") {
    if (dest === undefined) throw new Refusal("where to?");
    u.casts = castsLeft(s, u) - 1;
    asCreature({ name: c.plural, cr: u.creature, mastery: 3, power: 1, duration: 1 }, () => castSpell(s, u.side, SPELL.TELEPORT, hex, events, dest));
    for (const ev of events) if (ev.e === "spell" && ev.spell === SPELL.TELEPORT) ev.by = u.id;
    return;
  }
  if (sp.key.startsWith("heatStroke")) return heatStroke(s, u, hex, events);
  if (sp.key.startsWith("detonates")) {
    // It can't be turned off again; the turn goes on (applyAction keeps it).
    u.ignited = true;
    const note = LOG.ours("ignite", [{ cr: u.creature, n: 2 }]);
    s.log.push(note);
    events.push({ e: "spell", side: u.side, spell: SPELL.FIRE_SHIELD, hex, units: [u.id], damage: [], resisted: [], ability: true, by: u.id, note, look: "ignite" });
    return;
  }
  if (sp.key.startsWith("meditation")) {
    // Untouchable until its first turn next round; the Couatl's turn is spent, the Crimson's isn't (rules.ts keeps it acting).
    u.meditating = s.round;
    u.meditated = true;
    const note = LOG.ours("meditate", [{ cr: u.creature, n: 2 }]);
    s.log.push(note);
    events.push({ e: "spell", side: u.side, spell: SPELL.ANTI_MAGIC, hex, units: [u.id], damage: [], resisted: [], ability: true, by: u.id, note, look: "meditate" });
    return;
  }
  u.casts = castsLeft(s, u) - 1;
  if (sp.key === "summonDemons") return raiseDemons(s, u, demonTarget(s, u, hex)!, events);
  if (sp.key === "hotaRepair") {
    const t = repairTarget(s, u, hex)!;
    const per = c.abilities.find((a) => a.type === "SPECIFIC_SPELL_POWER" && a.subtype === "hotaRepair")?.val ?? 10;
    const revived = heal(s, t, per * u.count);
    const note = revived ? LOG.ours("repairBack", [{ cr: u.creature, n: 2 }, { cr: t.creature, n: 2 }, revived]) : LOG.ours("repair", [{ cr: u.creature, n: 2 }, { cr: t.creature, n: 2 }]);
    s.log.push(note);
    events.push({ e: "spell", side: u.side, spell: SPELL.CURE, hex, units: [t.id], damage: [], resisted: [], by: u.id, note, look: "repair" });
    return;
  }
  // Archangels: 100 health raised per angel, for good; whom the spell could raise (no undead, Golems, Gargoyles...).
  if (sp.key === "resurrection") {
    const amount = angelRaise(s, u);
    const target = asCreature({ name: "", mastery: 3, power: 1, duration: 1, raise: amount }, () => spellTargets(s, u.side, sp, hex))[0];
    if (!target) throw new Refusal("nothing to raise");
    const revived = heal(s, target, amount);
    const note = LOG.ours("resurrect", [{ cr: u.creature, n: 2 }, revived, { cr: target.creature, n: revived }]);
    s.log.push(note);
    events.push({ e: "spell", side: u.side, spell: sp.id, hex, units: [target.id], damage: [], resisted: [], by: u.id, note });
    return;
  }
  const perCreature = (ability(c, "CREATURE_SPELL_POWER")?.val ?? 100) / 100;
  // Master Genies cast with spell power 6 however many they are (heroes.thelazy.net Genie).
  const random = hasAbility(c, "RANDOM_SPELLCASTER");
  const caster = {
    name: c.plural,
    cr: u.creature,
    mastery: masteryOf(s, u, sp.key),
    power: random ? (ability(c, "CREATURE_ENCHANT_POWER")?.val ?? 6) : Math.max(1, Math.floor(perCreature * u.count)),
    duration: ability(c, "CREATURE_ENCHANT_POWER")?.val ?? 3,
    faerie: faerieDragon(s, u),
  };
  const before = events.length;
  asCreature(caster, () => castSpell(s, u.side, sp.id, hex, events));
  for (const ev of events.slice(before)) if (ev.e === "spell") ev.by = u.id;
}

// ---- Heat Stroke (HotA Dreadnoughts and Juggernauts) -------------------------
// heroes.thelazy.net/index.php/Juggernaut: instead of moving or attacking, a beam at one of the
// hexes next to it hits the semicircle there: 3 adjacent hexes and the 4-5 behind them. Each stack
// in it (friends too) takes what a normal attack would deal; nobody retaliates.

/** The hexes a Heat Stroke aimed at `hex` (next to the unit) burns; empty if it can't aim there. */
export function heatStrokeArea(s: BattleState, u: Unit, hex: number): number[] {
  const own = unitHexes(s, u);
  const dist = (h: number) => Math.min(...own.map((m) => hexDistance(h, m)));
  if (own.includes(hex) || dist(hex) !== 1) return [];
  const front = [hex, ...neighbours(hex).filter((h) => dist(h) === 1)];
  const behind = new Set(front.flatMap((f) => neighbours(f)).filter((h) => dist(h) === 2 && front.some((f) => hexDistance(f, h) === 1) && hexDistance(h, hex) <= 2));
  return [...front, ...behind];
}

function heatStroke(s: BattleState, u: Unit, hex: number, events: BattleEvent[]) {
  const area = heatStrokeArea(s, u, hex);
  const hit = s.units.filter((x) => x !== u && alive(x) && x.machine !== "tower" && unitHexes(s, x).some((h) => area.includes(h)));
  s.log.push(LOG.ours("heatStroke", [{ cr: u.creature, n: 2 }]));
  // The stack aimed at takes the full blow animation; the rest are caught in the beam.
  hit.sort((a, b) => +unitHexes(s, b).includes(hex) - +unitHexes(s, a).includes(hex));
  hit.forEach((d, i) => strike(s, u, d, false, false, 0, events, i > 0));
  if (!hit.length) events.push({ e: "spell", side: u.side, spell: SPELL.FIRE_WALL, hex, units: [], damage: [], resisted: [], by: u.id });
}

/**
 * Pit Lords (heroes.thelazy.net Pit Lord): 50 health of Demons per Pit Lord, no more health than the
 * fallen stack had (health artifacts, Poison and Age counted) nor more Demons than it had creatures:
 * min(floor(min(dead x health, lords x 50) / 35), dead).
 */
function demonsRaised(s: BattleState, u: Unit, corpse: Unit): number {
  const demon = s.creatures[DEMON];
  if (!demon) return 0;
  const per = stats(s, u).abilities.find((a) => a.type === "SPECIFIC_SPELL_POWER" && a.subtype === "summonDemons")?.val ?? 50;
  const dead = corpse.initialCount;
  return Math.min(Math.floor(Math.min(per * u.count, dead * hpOf(s, corpse)) / demon.hp), dead);
}

function raiseDemons(s: BattleState, u: Unit, corpse: Unit, events: BattleEvent[]) {
  const demon = s.creatures[DEMON];
  if (!demon) throw new Refusal("no demons here");
  const n = demonsRaised(s, u, corpse);
  if (n <= 0) throw new Refusal("too few Pit Lords");
  // (The fallen still count for the experience, and the demons too when they fall: heroes.thelazy.net, Experience.)
  corpse.xpBefore = (corpse.xpBefore ?? 0) + Math.max(corpse.initialCount - corpse.count, corpse.mostLost ?? 0) * (s.creatures[corpse.creature]?.hp ?? 0);
  corpse.mostLost = undefined;
  corpse.creature = DEMON;
  corpse.count = corpse.initialCount = n;
  corpse.firstHp = demon.hp;
  corpse.shots = 0;
  corpse.effects = [];
  corpse.acted = true;
  const note = LOG.ours("raiseDemons", [{ cr: u.creature, n: 2 }, n, { cr: DEMON, n }]);
  s.log.push(note);
  events.push({ e: "spell", side: u.side, spell: SPELL.ANIMATE_DEAD, hex: corpse.pos, units: [corpse.id], damage: [], resisted: [], by: u.id, summoned: [corpse.id], note });
}

/** How often each spell comes up (VCMI's weights; heroes.thelazy.net Enchanter's and Faerie Dragon's tables). */
const ENCHANTER_WEIGHT: Record<string, number> = { haste: 15, bless: 15, stoneSkin: 15, cure: 10, bloodlust: 5, slow: 10, weakness: 4, airShield: 10 };
const FAERIE_WEIGHT: Record<string, number> = { magicArrow: 10, iceBolt: 22, lightningBolt: 22, fireball: 21, frostRing: 10, inferno: 5, meteorShower: 5, chainLightning: 5 };

/** One of `options` by its weight (1 for those not listed). */
function weighted(s: BattleState, options: SpellInfo[], weights: Record<string, number>): SpellInfo {
  const w = options.map((sp) => weights[sp.key] ?? 1);
  let r = random(s) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) if ((r -= w[i]) < 0) return options[i];
  return options[options.length - 1];
}

/** HotA Enchanters: every third round, an expert mass spell on their own side (or Slow/Weakness on the enemy). */
export function enchant(s: BattleState, u: Unit, events: BattleEvent[]) {
  const c = stats(s, u);
  const keys = c.abilities.filter((a) => a.type === "ENCHANTER" && a.subtype).map((a) => a.subtype!);
  if (!keys.length || (s.round - 1) % 3 !== 0 || u.enchanted === s.round || cursedGround(s) || s.noMagic) return;
  u.enchanted = s.round;
  // Air Shield only against shooters that can shoot, Cure only with a friend hurt (heroes.thelazy.net Enchanter).
  const shooters = s.units.some((x) => alive(x) && x.side !== u.side && !x.machine && canShoot(s, x));
  const hurt = s.units.some((x) => alive(x) && x.side === u.side && !x.machine && (x.firstHp < hpOf(s, x) || x.count < x.initialCount));
  const options = keys
    .map((k) => byKey(s, k))
    .filter((sp): sp is SpellInfo => !!sp && !!COMBAT_SPELLS[sp.id] && (sp.key !== "airShield" || shooters) && (sp.key !== "cure" || hurt));
  if (!options.length) return;
  const sp = weighted(s, options, ENCHANTER_WEIGHT);
  const enemy = COMBAT_SPELLS[sp.id].who === "enemy";
  const target = s.units.find((x) => alive(x) && (enemy ? x.side !== u.side : x.side === u.side) && !x.machine);
  if (!target) return;
  const before = events.length;
  try {
    asCreature({ name: c.plural, cr: u.creature, mastery: 3, power: 1, duration: ability(c, "CREATURE_ENCHANT_POWER")?.val ?? 3 }, () => castSpell(s, u.side, sp.id, target.pos, events));
  } catch {
    return;
  }
  for (const ev of events.slice(before)) if (ev.e === "spell") ev.by = u.id;
}
