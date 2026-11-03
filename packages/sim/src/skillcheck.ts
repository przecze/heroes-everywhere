// Secondary skill proofs for scenecheck.ts: what each skill does, measured with it at Expert and
// without it (the scene played twice: the hero keeps the skill, or loses it before stepping up).
// On the map: movement on land and at sea, the swamp's cost, sight, morale and luck, spell points
// a day, gold a day, the shrine's spell, the Pikemen's offer. In the battle against the scene's
// stack: melee, ranged and spell damage, damage taken, the ballista's shots, the army's health with
// a tent, the tactics phase, the enemy's spells resisted or weakened, rune levels held, the dead
// raised and the experience gained afterwards.
import {
  type AdventureState,
  type BattleHero,
  type BattleState,
  type Hero,
  type SpellInfo,
  type Unit,
  type World,
  SPELL,
  applyAction,
  applyAdventureAction,
  expectedDamage,
  findPaths,
  gainRunes,
  heroMoraleLuck,
  heroSight,
  manaRegen,
  mastery,
  maxMana,
  maxMovement,
  newDay,
  runeBonus,
  spellDamage,
} from "@heroes/core";

export interface SkillProof {
  proof: string | null;
  note: string;
}

export interface SkillRun {
  s: AdventureState;
  w: World;
  h: Hero;
  /** The battle against the scene's stack, begun (where the scene has one). */
  b?: BattleState;
  /** Experience before the fight. */
  xp: number;
  /** The offer the stack made when approached (Diplomacy). */
  offered: boolean;
  /** Spells before the shrine (Wisdom). */
  spellsBefore: number;
  /** Fights the battle out (the AI for both) and settles it on the map. */
  fight: () => boolean;
}

const KEYS = ["pathfinding", "archery", "logistics", "scouting", "diplomacy", "navigation", "leadership", "wisdom", "mysticism", "luck", "ballistics", "eagleEye", "necromancy", "estates", "fireMagic", "airMagic", "waterMagic", "earthMagic", "scholar", "tactics", "artillery", "learning", "offence", "armorer", "intelligence", "sorcery", "resistance", "firstAid", "interference", "runes"];

const alive = (u: Unit) => u.count > 0 && !u.machine;
const mine = (b: BattleState) => b.units.find((u) => u.side === 0 && alive(u))!;
const foe = (b: BattleState) => b.units.find((u) => u.side === 1 && alive(u))!;
const shooter = (b: BattleState) => b.units.find((u) => u.side === 0 && alive(u) && b.creatures[u.creature].abilities.some((a) => a.type === "SHOOTER"));
/** The enemy given a hero with this spell, and that spell cast at our first stack: resisted, or the damage done. */
function enemyCast(b: BattleState, spells: SpellInfo[], spell: number, k = 0): { resisted: boolean; damage: number } {
  const t = structuredClone(b);
  t.rng = (t.rng + k * 7919) | 0;
  const hero: BattleHero = { name: "Foe", heroClass: 0, female: false, owner: 1, primary: [0, 0, 10, 10], spells: [spell], mana: 100, machines: [] };
  t.sides[1].hero = hero;
  (t.spells ??= {})[spell] = spells[spell];
  const f = foe(t);
  const m = mine(t);
  t.active = f.id;
  try {
    const ev = applyAction(t, { type: "cast", unit: f.id, spell, target: m.pos });
    const sp = ev.filter((e) => e.e === "spell");
    return { resisted: sp.some((e) => e.e === "spell" && e.resisted.includes(m.id)), damage: sp.flatMap((e) => (e.e === "spell" ? e.damage : [])).filter((d) => d.unit === m.id).reduce((a, d) => a + d.damage, 0) };
  } catch {
    return { resisted: false, damage: -1 };
  }
}
const cmp = (a: number, b: number, dir: ">" | "<", what: string): true | string => (dir === ">" ? a > b : a < b) || `${what}: ${a} with it, ${b} without`;

type Check = (A: SkillRun, B: SkillRun, spells: SpellInfo[]) => true | string;
const battle = (f: (a: BattleState, b: BattleState, spells: SpellInfo[]) => true | string): Check => (A, B, spells) => (A.b && B.b ? f(A.b, B.b, spells) : "no battle");

const CHECKS: Record<string, Check> = {
  pathfinding: (A, B) => {
    const far = A.w.index(6, 8, 0);
    const cost = (r: SkillRun) => findPaths(r.w, r.s, r.h).get(far)?.cost ?? Infinity;
    return cmp(cost(A), cost(B), "<", "the swamp's cost");
  },
  archery: battle((a, b) => {
    const u = shooter(a);
    const v = shooter(b);
    if (!u || !v) return "no shooter of ours";
    return cmp(expectedDamage(a, u, foe(a), true).max, expectedDamage(b, v, foe(b), true).max, ">", "ranged damage");
  }),
  logistics: (A, B) => cmp(maxMovement(A.w, A.h), maxMovement(B.w, B.h), ">", "movement"),
  scouting: (A, B) => cmp(heroSight(A.h), heroSight(B.h), ">", "sight"),
  diplomacy: (A) => A.offered || "the Pikemen didn't offer to join",
  navigation: (A, B) => {
    const sea = (r: SkillRun) => {
      const keep = r.h.boat;
      r.h.boat = 0;
      const m = maxMovement(r.w, r.h);
      r.h.boat = keep;
      return m;
    };
    return cmp(sea(A), sea(B), ">", "sea movement");
  },
  leadership: (A, B) => cmp(heroMoraleLuck(A.s, A.w, A.h).morale, heroMoraleLuck(B.s, B.w, B.h).morale, ">", "morale"),
  wisdom: (A) => (A.h.spells ?? []).length > A.spellsBefore || "the level 3 shrine taught nothing",
  mysticism: (A, B) => cmp(manaRegen(A.h), manaRegen(B.h), ">", "spell points a day"),
  luck: (A, B) => cmp(heroMoraleLuck(A.s, A.w, A.h).luck, heroMoraleLuck(B.s, B.w, B.h).luck, ">", "luck"),
  // The other hero of ours, two tiles left: walking onto them trades spells.
  scholar: (A, B) => {
    const learned = (r: SkillRun) => {
      const other = r.s.heroes.find((x) => !x.removed && x.owner === 0 && x.id !== r.h.id);
      if (!other) return -1;
      const n = (r.h.spells ?? []).length;
      applyAdventureAction(r.s, r.w, { type: "move", hero: r.h.id, to: r.w.index(other.x, other.y, 0) }, 0);
      return (r.h.spells ?? []).length - n;
    };
    return cmp(learned(A), learned(B), ">", "spells learned from the other hero");
  },
  // The enemy caster two tiles left: beaten, their spells may be learned (those they cast for certain).
  eagleEye: (A, B) => {
    const learned = (r: SkillRun) => {
      const enemy = r.s.heroes.find((x) => !x.removed && x.owner === 1 && x.x === 6);
      if (!enemy) return -1;
      const n = (r.h.spells ?? []).length;
      applyAdventureAction(r.s, r.w, { type: "move", hero: r.h.id, to: r.w.index(enemy.x, enemy.y, 0) }, 0);
      if (!r.s.battles[0]) return -2;
      if (!r.fight()) return -3;
      return (r.h.spells ?? []).length - n;
    };
    const a = learned(A);
    const b = learned(B);
    if (a < 0 || b < 0) return a === -1 || b === -1 ? "no enemy hero to fight" : a === -2 || b === -2 ? "no battle began" : "the fight was lost";
    return cmp(a, b, ">", "spells learned from the beaten caster");
  },
  necromancy: (A, B) => {
    if (!A.b || !B.b) return "no battle";
    if (!A.fight() || !B.fight()) return "the fight was lost";
    const skel = (r: SkillRun) => r.h.army.reduce((n, x) => n + (x && [56, 58, 60, 64].includes(x.creature) ? x.count : 0), 0);
    return cmp(skel(A), skel(B), ">", "the dead raised");
  },
  estates: (A, B) => {
    const gold = (r: SkillRun) => {
      const before = r.s.players[0].resources[6];
      newDay(r.s, r.w);
      return r.s.players[0].resources[6] - before;
    };
    return cmp(gold(A), gold(B), ">", "gold a day");
  },
  fireMagic: battle((a, b, spells) => cmp(mastery(a, 0, spells[SPELL.MAGIC_ARROW]), mastery(b, 0, spells[SPELL.MAGIC_ARROW]), ">", "Magic Arrow's mastery")),
  airMagic: battle((a, b, spells) => cmp(mastery(a, 0, spells[SPELL.MAGIC_ARROW]), mastery(b, 0, spells[SPELL.MAGIC_ARROW]), ">", "Magic Arrow's mastery")),
  waterMagic: battle((a, b, spells) => cmp(mastery(a, 0, spells[SPELL.MAGIC_ARROW]), mastery(b, 0, spells[SPELL.MAGIC_ARROW]), ">", "Magic Arrow's mastery")),
  earthMagic: battle((a, b, spells) => cmp(mastery(a, 0, spells[SPELL.MAGIC_ARROW]), mastery(b, 0, spells[SPELL.MAGIC_ARROW]), ">", "Magic Arrow's mastery")),
  tactics: battle((a, b) => (a.tactics?.side === 0 && !b.tactics ? true : a.tactics ? "a tactics phase even without it" : "no tactics phase")),
  // Twenty catapult throws at the walls, aimed by the hero: more of them hit with Ballistics.
  ballistics: battle((a, b) => {
    const thrown = (x: BattleState) => {
      if (!x.siege) return -1;
      let total = 0;
      for (let k = 1; k <= 20; k++) {
        const t = structuredClone(x);
        t.rng = (t.rng + k * 7919) | 0;
        const u = t.units.find((y) => y.side === 0 && y.machine === "catapult");
        if (!u) return -1;
        t.active = u.id;
        const hp = () => Object.values(t.siege!.walls).reduce((n, v) => n + (v ?? 0), 0);
        const before = hp();
        try {
          applyAction(t, { type: "catapult", unit: u.id, target: "upperWall" });
        } catch {
          return -1;
        }
        total += before - hp();
      }
      return total;
    };
    const w = thrown(a);
    const wo = thrown(b);
    if (w < 0 || wo < 0) return "no siege, or no catapult to aim";
    return cmp(w, wo, ">", "wall damage from twenty throws");
  }),
  // (The ballista's shot is rolled, Artillery doubling it: twenty shots each way.)
  artillery: battle((a, b) => {
    const shots = (x: BattleState) => {
      let total = 0;
      for (let k = 1; k <= 20; k++) {
        const t = structuredClone(x);
        t.rng = (t.rng + k * 7919) | 0;
        const u = t.units.find((y) => y.side === 0 && y.machine === "ballista");
        if (!u) return -1;
        t.active = u.id;
        try {
          for (const e of applyAction(t, { type: "shoot", unit: u.id, target: foe(t).id })) if (e.e === "attack" && e.unit === u.id) total += e.damage;
        } catch {
          return -1;
        }
      }
      return total;
    };
    const w = shots(a);
    const wo = shots(b);
    if (w < 0 || wo < 0) return "no ballista on the field, or it couldn't shoot";
    return cmp(w, wo, ">", "twenty ballista shots");
  }),
  learning: (A, B) => {
    if (!A.b || !B.b) return "no battle";
    if (!A.fight() || !B.fight()) return "the fight was lost";
    return cmp(A.h.experience - A.xp, B.h.experience - B.xp, ">", "experience from the fight");
  },
  offence: battle((a, b) => cmp(expectedDamage(a, mine(a), foe(a), false).max, expectedDamage(b, mine(b), foe(b), false).max, ">", "melee damage")),
  armorer: battle((a, b) => cmp(expectedDamage(a, foe(a), mine(a), false).max, expectedDamage(b, foe(b), mine(b), false).max, "<", "damage taken")),
  intelligence: (A, B) => cmp(maxMana(A.h), maxMana(B.h), ">", "spell points"),
  sorcery: battle((a, b, spells) => cmp(spellDamage(a, 0, spells[SPELL.MAGIC_ARROW], foe(a)), spellDamage(b, 0, spells[SPELL.MAGIC_ARROW], foe(b)), ">", "spell damage")),
  resistance: battle((a, b, spells) => {
    const rolls = (x: BattleState) => Array.from({ length: 40 }, (_, k) => enemyCast(x, spells, SPELL.SLOW, k + 1).resisted).filter(Boolean).length;
    return cmp(rolls(a), rolls(b), ">", "Slow resisted in 40");
  }),
  firstAid: battle((a, b) => {
    const hp = (x: BattleState) => x.units.filter((u) => u.side === 0 && alive(u)).reduce((n, u) => n + u.firstHp, 0);
    return cmp(hp(a), hp(b), ">", "the army's health");
  }),
  interference: battle((a, b, spells) => cmp(enemyCast(a, spells, SPELL.MAGIC_ARROW).damage, enemyCast(b, spells, SPELL.MAGIC_ARROW).damage, "<", "the enemy's Magic Arrow")),
  runes: battle((a, b) => {
    const held = (x: BattleState) => {
      const t = structuredClone(x);
      const u = mine(t);
      gainRunes(t, u, 9);
      return runeBonus(t, u).attack;
    };
    return cmp(held(a), held(b), ">", "attack from rune levels");
  }),
};
const UNCHECKED: Record<string, string> = {};

/** Proves a skill from two plays of its scene: with the skill (A) and without (B). */
export function proveSkill(id: number, spells: SpellInfo[], A: SkillRun, B: SkillRun): SkillProof {
  const key = KEYS[id];
  if (UNCHECKED[key]) return { proof: null, note: `no checker yet: ${UNCHECKED[key]}` };
  const check = CHECKS[key];
  if (!check) return { proof: null, note: "no checker yet" };
  try {
    const r = check(A, B, spells);
    return { proof: r === true ? null : r, note: "its effect measured with and without it" };
  } catch (e) {
    return { proof: `error: ${e instanceof Error ? e.message : e}`, note: "its effect measured with and without it" };
  }
}
