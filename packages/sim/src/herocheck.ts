// Hero specialty proofs for scenecheck.ts: the hero's scene played twice, once as the hero and
// once as a plain one (another hero whose specialty can't touch the measure), and the specialty's
// effect compared: the skill's factor, the creature's attack, defence, damage and speed, the sea
// movement, the sight, the day's income, the spell's damage, duration or strength, the doubled
// clone, the blessed or shielded stack, the swamp's cost.
import {
  type AdventureState,
  type BattleState,
  type Hero,
  type SpellInfo,
  type Unit,
  type World,
  SKILLS,
  HERO_INFO,
  SPECIALTIES,
  skillLevel,
  SPELL,
  applyAction,
  attackOf,
  defenseOf,
  effectOf,
  expectedDamage,
  findPaths,
  heroSight,
  maxMovement,
  newDay,
  skillFactor,
  specialUpgradeOf,
  speedOf,
  spellDamage,
} from "@heroes/core";

export interface HeroProof {
  proof: string | null;
  note: string;
}
export interface HeroRun {
  s: AdventureState;
  w: World;
  h: Hero;
  b?: BattleState;
}

const alive = (u: Unit) => u.count > 0 && !u.machine;
const foe = (b: BattleState) => b.units.find((u) => u.side === 1 && alive(u))!;
const own = (b: BattleState, creature?: number) => b.units.find((u) => u.side === 0 && alive(u) && (creature === undefined || u.creature === creature));
const cmp = (a: number, b: number, dir: ">" | "<" | "!=", what: string): true | string => (dir === ">" ? a > b : dir === "<" ? a < b : a !== b) || `${what}: ${a} as the hero, ${b} as another`;
/** Casts the spell on a stack (ours, or the enemy's) in a copy of the battle; the stack afterwards. */
function cast(b: BattleState, spell: number, onFoe: boolean, creature?: number): { u: Unit; t: BattleState } | string {
  // (A blessing goes on the first of our stacks it can: Precision on the shooter.)
  const candidates = onFoe ? [undefined] : [creature, ...b.units.filter((x) => x.side === 0 && alive(x)).map((x) => x.creature)];
  let last = "";
  for (const c of candidates) {
    const t = structuredClone(b);
    // (A Tactics hero's battle waits for the troops to be arranged.)
    if (t.tactics) applyAction(t, { type: "tacticsDone", unit: 0 });
    const mine = (c === undefined ? undefined : own(t, c)) ?? own(t);
    if (!mine) return "no stack of ours";
    const u = onFoe ? foe(t) : mine;
    t.active = mine.id;
    try {
      applyAction(t, { type: "cast", unit: mine.id, spell, target: u.pos });
      return { u, t };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  return `the cast was refused: ${last}`;
}
const spellId = (spells: SpellInfo[], x: number | string | undefined) => (typeof x === "number" ? x : typeof x === "string" ? spells.find((s) => s.key === x)?.id : undefined);
/** Who a spell is cast on: the enemy for a curse. */
const onEnemy = (spells: SpellInfo[], id: number) => ["curse", "weakness", "slow", "disruptingRay", "forgetfulness", "sorrow", "misfortune", "blind", "berserk", "hypnotize"].includes(spells[id]?.key ?? "");

export function proveHero(id: number, spells: SpellInfo[], A: HeroRun, B: HeroRun): HeroProof {
  const sp = SPECIALTIES[id];
  if (!sp) {
    // No specialty data (Adrienne: "Fire Magic", her starting Expert Fire Magic).
    const expert = HERO_INFO[id]?.skills?.find(([, l]) => l === 3);
    if (!expert) return { proof: null, note: "no checker yet: no specialty data" };
    return { proof: skillLevel(A.h.skills, expert[0] as Parameters<typeof skillLevel>[1]) >= 3 ? null : `starts without expert ${expert[0]}`, note: `checked: starts with expert ${expert[0]}` };
  }
  const checked: string[] = [];
  const unchecked: string[] = [];
  const failed: string[] = [];
  const check = (what: string, r: true | string) => {
    checked.push(what);
    if (r !== true) failed.push(r);
  };
  const battle = (what: string, f: (a: BattleState, b: BattleState) => true | string) => check(what, A.b && B.b ? f(A.b, B.b) : "no battle");
  if (sp.skill !== undefined) check("the skill's factor", skillFactor(A.h, SKILLS[sp.skill]) > skillFactor(B.h, SKILLS[sp.skill]) || `${SKILLS[sp.skill]} no better for the specialist`);
  if (sp.creatures?.length) {
    const c = sp.creatures[0];
    battle("the creature's attack and speed", (a, b) => {
      const u = own(a, c);
      const v = own(b, c);
      if (!u || !v) return "the creature isn't in the army";
      const att = cmp(attackOf(a, u, false), attackOf(b, v, false), ">", "attack");
      // (War machines gain no speed.)
      return att === true && !u.machine && !(c >= 145 && c <= 150) ? cmp(speedOf(a, u), speedOf(b, v), ">", "speed") : att;
    });
  }
  for (const bonus of sp.bonuses ?? []) {
    // (VCMI names the Fire Wall's and the Land Mine's burn as spells of their own: the specialty is for the spell.)
    const spell = spellId(spells, typeof bonus.spell === "string" ? bonus.spell.replace(/Trigger$/, "") : bonus.spell);
    switch (bonus.type) {
      case "MOVEMENT": {
        const sea = (r: HeroRun) => {
          const keep = r.h.boat;
          r.h.boat = 0;
          const m = maxMovement(r.w, r.h);
          r.h.boat = keep;
          return m;
        };
        check("sea movement", cmp(sea(A), sea(B), ">", "sea movement"));
        break;
      }
      case "SIGHT_RADIUS":
        check("sight", cmp(heroSight(A.h), heroSight(B.h), ">", "sight"));
        break;
      case "GENERATE_RESOURCE": {
        const income = (r: HeroRun) => {
          const before = [...r.s.players[0].resources];
          newDay(r.s, r.w);
          return r.s.players[0].resources.map((x, i) => x - before[i]);
        };
        const res = bonus.resource ?? 6;
        check("the day's income", cmp(income(A)[res], income(B)[res], ">", "income"));
        break;
      }
      case "SPELL":
        if (bonus.spell === "specialClone")
          battle("two clones", (a, b) => {
            const n = (x: BattleState) => {
              const r = cast(x, SPELL.CLONE, false);
              return typeof r === "string" ? -1 : r.t.units.length - x.units.length;
            };
            return cmp(n(a), n(b), ">", "clones");
          });
        else unchecked.push(`SPELL:${bonus.spell}`);
        break;
      case "SPELL_DURATION":
        if (spell === undefined) unchecked.push(bonus.type);
        else
          battle("the spell's duration", (a, b) => {
            const rounds = (x: BattleState) => {
              const r = cast(x, spell, onEnemy(spells, spell));
              return typeof r === "string" ? -1 : (effectOf(r.u, spell)?.rounds ?? -1);
            };
            return cmp(rounds(a), rounds(b), ">", `${spells[spell]?.name}'s rounds`);
          });
        break;
      case "SPECIAL_SPELL_LEV":
      case "SPECIFIC_SPELL_DAMAGE":
        if (spell === undefined) unchecked.push(`${bonus.type}:${bonus.spell}`);
        else battle("the spell's damage", (a, b) => cmp(spellDamage(a, 0, spells[spell], foe(a)), spellDamage(b, 0, spells[spell], foe(b)), ">", `${spells[spell]?.name}'s damage`));
        break;
      case "SPECIAL_PECULIAR_ENCHANT":
      case "SPECIAL_ADD_VALUE_ENCHANT":
      case "SPECIAL_FIXED_VALUE_ENCHANT":
        if (spell === undefined) unchecked.push(bonus.type);
        else
          battle("the spell's strength", (a, b) => {
            const value = (x: BattleState) => {
              const r = cast(x, spell, onEnemy(spells, spell));
              return typeof r === "string" ? r : (effectOf(r.u, spell)?.value ?? -1);
            };
            const va = value(a);
            const vb = value(b);
            if (typeof va === "string") return va;
            if (typeof vb === "string") return vb;
            return cmp(va, vb, "!=", `${spells[spell]?.name}'s strength`);
          });
        break;
      case "GENERAL_DAMAGE_PREMY":
        battle("the blessed stack's damage", (a, b) => {
          const dmg = (x: BattleState) => {
            const r = cast(x, SPELL.BLESS, false);
            return typeof r === "string" ? -1 : expectedDamage(r.t, r.u, foe(r.t), false).max;
          };
          return cmp(dmg(a), dmg(b), ">", "damage under Bless");
        });
        break;
      case "GENERAL_DAMAGE_REDUCTION":
        // (A shield's value is the share of damage still taken: the specialist's is lower. Melee: Shield;
        // ranged: Air Shield, Dargem's.)
        battle("the shield's strength", (a, b) => {
          const shield = bonus.subtype === "damageTypeRanged" ? SPELL.AIR_SHIELD : SPELL.SHIELD;
          const share = (x: BattleState) => {
            const r = cast(x, shield, false);
            return typeof r === "string" ? 1e9 : (effectOf(r.u, shield)?.value ?? 1e9);
          };
          return cmp(share(a), share(b), "<", `the share of damage taken under ${spells[shield]?.name ?? "the shield"}`);
        });
        break;
      case "PRIMARY_SKILL":
      case "CREATURE_DAMAGE":
      case "STACKS_SPEED": {
        // (A bonus for no creature in particular is for dragons: Mutare's.)
        const c = bonus.creatures?.[0] ?? (bonus.type === "PRIMARY_SKILL" ? 26 : undefined);
        battle(bonus.type === "STACKS_SPEED" ? "the stacks' speed" : "the creature's " + (bonus.type === "CREATURE_DAMAGE" ? "damage" : bonus.subtype ?? ""), (a, b) => {
          const u = own(a, c);
          const v = own(b, c);
          if (!u || !v) return "the creature isn't in the army";
          if (bonus.type === "STACKS_SPEED") return cmp(speedOf(a, u), speedOf(b, v), ">", "speed");
          if (bonus.type === "CREATURE_DAMAGE") return cmp(expectedDamage(a, u, foe(a), false).max, expectedDamage(b, v, foe(b), false).max, ">", "damage");
          return bonus.subtype === "defence" ? cmp(defenseOf(a, u), defenseOf(b, v), ">", "defence") : cmp(attackOf(a, u, false), attackOf(b, v, false), ">", "attack");
        });
        break;
      }
      // Gelu's Sharpshooters, Dracon's Enchanters, Bidley's Sea Dogs: the base creature upgrades to them for this hero only.
      case "SPECIAL_UPGRADE": {
        const from = A.w.creatures.findIndex((x) => x?.key === bonus.spell);
        if (from < 0) {
          unchecked.push(`SPECIAL_UPGRADE:${bonus.spell}`);
          break;
        }
        const to = specialUpgradeOf(A.w, from, A.h);
        check(`${A.w.creatures[from]?.plural}' special upgrade`, to !== undefined && specialUpgradeOf(B.w, from, B.h) === undefined ? true : to === undefined ? `${A.w.creatures[from]?.plural} don't upgrade specially` : "another hero gets it too");
        break;
      }
      case "BASE_TILE_MOVEMENT_COST":
      case "ROUGH_TERRAIN_DISCOUNT": {
        const far = A.w.index(6, 8, 0);
        const cost = (r: HeroRun) => findPaths(r.w, r.s, r.h).get(far)?.cost ?? Infinity;
        check("the swamp's cost", cmp(cost(A), cost(B), "<", "the swamp's cost"));
        break;
      }
      default:
        unchecked.push(bonus.type);
    }
  }
  const uniq = [...new Set(unchecked)];
  if (!checked.length) return { proof: null, note: `no checker yet for ${uniq.join(", ")}` };
  return { proof: failed.length ? failed.join("; ") : null, note: `checked: ${[...new Set(checked)].join(", ")}${uniq.length ? `; no checker yet for ${uniq.join(", ")}` : ""}` };
}
