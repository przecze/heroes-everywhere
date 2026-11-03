// Battle spell proofs for scenecheck.ts: in the scene's battle, the hero casts the spell (the
// checker does the casting, at the stack that shows it) and the effect is checked: the damage
// dealt and to whom (the undead spared by Death Ripple, the living by Destroy Undead), the stat
// the spell changes (speed, attack, defence, damage taken, morale, luck), the shooter who can't
// shoot, the stack moved, healed, raised or sacrificed, the clone or elementals summoned, the
// obstacle gone, the hazard laid, the blessing dispelled, the spell turned away.
import {
  type BattleState,
  type Unit,
  SPELL,
  applyAction,
  attackOf,
  canShoot,
  defenseOf,
  effectOf,
  expectedDamage,
  luckOf,
  moraleOf,
  obstacleAt,
  speedOf,
} from "@heroes/core";

export interface SpellProof {
  proof: string | null;
  note: string;
}

type Check = (b: BattleState, mine: Unit, foe: Unit, cast: (target: number, dest?: number) => import("@heroes/core").BattleEvent[]) => true | string;

const alive = (u: Unit) => u.count > 0 && !u.machine;
const undead = (b: BattleState, u: Unit) => b.creatures[u.creature].abilities.some((a) => a.type === "UNDEAD");
const living = (b: BattleState, u: Unit) => !undead(b, u) && !b.creatures[u.creature].abilities.some((a) => a.type === "NON_LIVING");
/** Damage the cast dealt, per unit. */
const dealt = (ev: ReturnType<Check extends (...a: infer A) => unknown ? never : never> | import("@heroes/core").BattleEvent[]) => (ev as import("@heroes/core").BattleEvent[]).filter((e) => e.e === "spell").flatMap((e) => (e.e === "spell" ? e.damage : []));
const hurtFoe = (ev: import("@heroes/core").BattleEvent[], foe: Unit) => dealt(ev).some((d) => d.unit === foe.id && d.damage > 0);
const effectOn = (u: Unit, spell: number) => !!effectOf(u, spell);

/** A measurable before and after a buff or curse on `u`. */
const stat = (f: (b: BattleState, u: Unit) => number, dir: ">" | "<", what: string, onFoe = false): Check => (b, mine, foe, cast) => {
  const u = onFoe ? foe : mine;
  const before = f(b, u);
  cast(u.pos);
  const after = f(b, u);
  return (dir === ">" ? after > before : after < before) || `${what} ${before} → ${after}`;
};
const buff = (spell: number, onFoe = false): Check => (b, mine, foe, cast) => {
  const u = onFoe ? foe : mine;
  cast(u.pos);
  return effectOn(u, spell) || "the spell isn't on the stack";
};
const damage: Check = (b, mine, foe, cast) => hurtFoe(cast(foe.pos), foe) || "no damage to the enemy";
/** Free hexes in the middle of the field, nearest the middle first. */
const middle = (b: BattleState): number[] => {
  const out: number[] = [];
  for (let y = 3; y <= 8; y++) for (let x = 5; x <= 11; x++) out.push(y * 17 + x);
  return out.filter((h) => !b.units.some((u) => alive(u) && u.pos === h) && !b.blocked?.[h]);
};
/** Tries the cast at each hex until one is allowed. */
const castSomewhere = (b: BattleState, cast: (target: number, dest?: number) => unknown, hexes: number[], mineAt?: number) => {
  let last = "";
  for (const h of hexes) {
    try {
      if (mineAt !== undefined) cast(mineAt, h);
      else cast(h);
      return true;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(last || "nowhere to cast it");
};
const hazard = (kind: string): Check => (b, mine, foe, cast) => {
  const n = (b.hazards ?? []).filter((h) => h.kind === kind).length;
  castSomewhere(b, cast, middle(b));
  return (b.hazards ?? []).filter((h) => h.kind === kind).length > n || `no ${kind} laid`;
};
const summon: Check = (b, mine, foe, cast) => {
  const n = b.units.length;
  cast(mine.pos);
  return b.units.length > n || "nothing summoned";
};

const CHECKS: Record<number, Check> = {
  [SPELL.MAGIC_ARROW]: damage,
  [SPELL.ICE_BOLT]: damage,
  [SPELL.LIGHTNING_BOLT]: damage,
  [SPELL.IMPLOSION]: damage,
  [SPELL.TITANS_BOLT]: damage,
  [SPELL.CHAIN_LIGHTNING]: (b, mine, foe, cast) => dealt(cast(foe.pos)).filter((d) => d.damage > 0).length >= 2 || "the lightning hit fewer than two stacks",
  [SPELL.FROST_RING]: (b, mine, foe, cast) => dealt(cast(foe.pos - 1)).some((d) => d.unit === foe.id && d.damage > 0) || "the ring around the hex didn't hurt the stack beside it",
  [SPELL.FIREBALL]: damage,
  [SPELL.INFERNO]: damage,
  [SPELL.METEOR_SHOWER]: damage,
  [SPELL.DEATH_RIPPLE]: (b, mine, foe, cast) => {
    const d = dealt(cast(foe.pos));
    return (d.some((x) => living(b, b.units[x.unit]) && x.damage > 0) && !d.some((x) => undead(b, b.units[x.unit]) && x.damage > 0)) || "it didn't hurt the living only";
  },
  [SPELL.DESTROY_UNDEAD]: (b, mine, foe, cast) => {
    const d = dealt(cast(foe.pos));
    return (d.some((x) => undead(b, b.units[x.unit]) && x.damage > 0) && !d.some((x) => living(b, b.units[x.unit]) && x.damage > 0)) || "it didn't hurt the undead only";
  },
  [SPELL.ARMAGEDDON]: (b, mine, foe, cast) => {
    const d = dealt(cast(foe.pos));
    return (d.some((x) => x.unit === foe.id && x.damage > 0) && d.some((x) => b.units[x.unit].side === 0 && x.damage > 0)) || "it spared one side";
  },
  [SPELL.SHIELD]: stat((b, u) => expectedDamage(b, b.units.find((x) => x.side !== u.side && alive(x))!, u, false).max, "<", "melee damage taken"),
  [SPELL.AIR_SHIELD]: buff(SPELL.AIR_SHIELD),
  [SPELL.FIRE_SHIELD]: buff(SPELL.FIRE_SHIELD),
  [SPELL.PROT_AIR]: buff(SPELL.PROT_AIR),
  [SPELL.PROT_FIRE]: buff(SPELL.PROT_FIRE),
  [SPELL.PROT_WATER]: buff(SPELL.PROT_WATER),
  [SPELL.PROT_EARTH]: buff(SPELL.PROT_EARTH),
  [SPELL.ANTI_MAGIC]: buff(SPELL.ANTI_MAGIC),
  [SPELL.DISPEL]: (b, mine, foe, cast) => {
    // Something to dispel first: Haste on the stack, put there directly.
    (mine.effects ??= []).push({ spell: SPELL.HASTE, rounds: 3, mastery: 1, value: 3 });
    cast(mine.pos);
    return !effectOn(mine, SPELL.HASTE) || "the blessing is still there";
  },
  [SPELL.MAGIC_MIRROR]: buff(SPELL.MAGIC_MIRROR),
  [SPELL.CURE]: (b, mine, foe, cast) => {
    mine.firstHp = 1;
    cast(mine.pos);
    return mine.firstHp > 1 || "the wound wasn't healed";
  },
  [SPELL.RESURRECTION]: (b, mine, foe, cast) => {
    const n = mine.count;
    mine.count = Math.max(1, n - 5);
    cast(mine.pos);
    return mine.count > n - 5 || "nobody rose";
  },
  [SPELL.ANIMATE_DEAD]: (b, mine, foe, cast) => {
    const u = b.units.find((x) => x.side === 0 && undead(b, x));
    if (!u) return "no undead stack of ours";
    const n = u.count;
    u.count = Math.max(1, n - 5);
    cast(u.pos);
    return u.count > n - 5 || "nobody rose";
  },
  [SPELL.SACRIFICE]: (b, mine, foe, cast) => {
    // A fallen stack of ours is raised from a living one given up.
    const victim = b.units.find((x) => x.side === 0 && alive(x) && x.id !== mine.id);
    if (!victim) return "no stack to sacrifice";
    mine.count = 0;
    cast(mine.pos, victim.pos);
    return (mine.count > 0 && victim.count === 0) || `${mine.count} raised, the victim has ${victim.count} left`;
  },
  [SPELL.BLESS]: stat((b, u) => expectedDamage(b, u, b.units.find((x) => x.side !== u.side && alive(x))!, false).min, ">", "least damage"),
  [SPELL.CURSE]: stat((b, u) => expectedDamage(b, u, b.units.find((x) => x.side !== u.side && alive(x))!, false).max, "<", "most damage", true),
  [SPELL.BLOODLUST]: stat((b, u) => attackOf(b, u, false), ">", "attack"),
  [SPELL.PRECISION]: (b, mine, foe, cast) => {
    const u = b.units.find((x) => x.side === 0 && b.creatures[x.creature].abilities.some((a) => a.type === "SHOOTER"));
    if (!u) return "no shooter of ours";
    const before = attackOf(b, u, true);
    cast(u.pos);
    return attackOf(b, u, true) > before || "ranged attack unchanged";
  },
  [SPELL.WEAKNESS]: stat((b, u) => attackOf(b, u, false), "<", "attack", true),
  [SPELL.STONE_SKIN]: stat((b, u) => defenseOf(b, u), ">", "defence"),
  [SPELL.DISRUPTING_RAY]: stat((b, u) => defenseOf(b, u), "<", "defence", true),
  [SPELL.PRAYER]: stat((b, u) => attackOf(b, u, false) + defenseOf(b, u) + speedOf(b, u), ">", "attack, defence and speed"),
  [SPELL.MIRTH]: stat((b, u) => moraleOf(b, u), ">", "morale"),
  [SPELL.SORROW]: stat((b, u) => moraleOf(b, u), "<", "morale", true),
  [SPELL.FORTUNE]: stat((b, u) => luckOf(b, u), ">", "luck"),
  [SPELL.MISFORTUNE]: stat((b, u) => luckOf(b, u), "<", "luck", true),
  [SPELL.HASTE]: stat((b, u) => speedOf(b, u), ">", "speed"),
  [SPELL.SLOW]: stat((b, u) => speedOf(b, u), "<", "speed", true),
  [SPELL.SLAYER]: buff(SPELL.SLAYER),
  [SPELL.FRENZY]: stat((b, u) => attackOf(b, u, false), ">", "attack"),
  [SPELL.COUNTERSTRIKE]: buff(SPELL.COUNTERSTRIKE),
  [SPELL.BERSERK]: buff(SPELL.BERSERK, true),
  [SPELL.HYPNOTIZE]: buff(SPELL.HYPNOTIZE, true),
  [SPELL.FORGETFULNESS]: (b, mine, foe, cast) => {
    const could = canShoot(b, foe);
    cast(foe.pos);
    return (could && !canShoot(b, foe)) || (could ? "the shooter still shoots" : "the enemy couldn't shoot anyway");
  },
  [SPELL.BLIND]: buff(SPELL.BLIND, true),
  [SPELL.TELEPORT]: (b, mine, foe, cast) => {
    const from = mine.pos;
    castSomewhere(b, cast, middle(b), mine.pos);
    return mine.pos !== from || "the stack didn't move";
  },
  [SPELL.REMOVE_OBSTACLE]: (b, mine, foe, cast) => {
    const n = b.obstacles.length;
    let hex = -1;
    for (let h = 0; h < 187 && hex < 0; h++) if (obstacleAt(b, h, 3) >= 0) hex = h;
    if (hex < 0) return "no obstacle on this field";
    cast(hex);
    return b.obstacles.length < n || (b.hazards ?? []).length === 0 || "the obstacle is still there";
  },
  [SPELL.CLONE]: summon,
  // (The elementals: spells 66-69.)
  66: summon,
  67: summon,
  68: summon,
  69: summon,
  // The walls' hit points, before and after.
  [SPELL.EARTHQUAKE]: (b, mine, foe, cast) => {
    if (!b.siege) return "no walls to shake (not a siege)";
    const hp = () => Object.values(b.siege!.walls).reduce((a, x) => a + (x ?? 0), 0);
    const before = hp();
    cast(foe.pos);
    return hp() < before || "the walls stand as they were";
  },
  [SPELL.QUICKSAND]: hazard("quicksand"),
  [SPELL.LAND_MINE]: hazard("mine"),
  [SPELL.FORCE_FIELD]: hazard("forceField"),
  [SPELL.FIRE_WALL]: hazard("fireWall"),
};
const UNCHECKED: Record<number, string> = {};

/** Casts the spell in the scene's battle and checks its effect. */
export function proveSpell(b: BattleState, id: number): SpellProof {
  if (UNCHECKED[id]) return { proof: null, note: `no checker yet: ${UNCHECKED[id]}` };
  const check = CHECKS[id];
  if (!check) return { proof: null, note: "no checker yet: only that the hero can cast it" };
  const mine = b.units.find((u) => u.side === 0 && alive(u));
  const foe = b.units.find((u) => u.side === 1 && alive(u));
  if (!mine || !foe) return { proof: "no stacks on the field", note: "" };
  // Our turn, whoever is up.
  b.active = mine.id;
  const cast = (target: number, dest?: number) => applyAction(b, { type: "cast", unit: mine.id, spell: id, target, dest });
  try {
    const r = check(b, mine, foe, cast);
    return { proof: r === true ? null : r, note: "its effect checked in the battle" };
  } catch (e) {
    return { proof: `the cast was refused: ${e instanceof Error ? e.message : e}`, note: "its effect checked in the battle" };
  }
}
