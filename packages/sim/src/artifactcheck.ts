// Artifact proofs for scenecheck.ts: what each bonus family does, measured with and without the
// artifact (two plays of the scene: one picks it up, one walks past it). On the map: movement,
// morale and luck, sight, spell points regained, spells known, the town's growth, the next day's
// income, the path over water or swamp, boarding a boat. In the battle against the scene's foe:
// the stacks' speed, health, shooting damage, the surrender price, the hero's spells and their
// damage, duration and cost, what the enemy's spells can't do to the stacks, what the battle opens
// with, the machine on the field, the dead raised afterwards.
import {
  type AdventureState,
  type BattleHero,
  type BattleState,
  type GameData,
  type Hero,
  type World,
  ARTIFACT_INFO,
  COMBOS,
  LOCKED,
  disassemble,
  moveArtifact,
  lastPartOf,
  heroBonuses,
  COMBAT_SPELLS,
  SPELL,
  applyAction,
  aiStep,
  applyAdventureAction,
  canShoot,
  castable,
  effectOf,
  neighbours,
  unitHexes,
  areAdjacent,
  canStand,
  HEX_COUNT,
  expectedDamage,
  findPaths,
  finishBattle,
  heroMoraleLuck,
  heroSight,
  heroSpells,
  hpOf,
  luckOf,
  manaRegen,
  maxMovement,
  moraleOf,
  newDay,
  runAi,
  spellDamage,
  speedOf,
  surrenderCost,
  visitTile,
  weeklyGrowth,
} from "@heroes/core";
import { fightAndSettle } from "./objectcheck.ts";

export interface ArtifactProof {
  proof: string | null;
  note: string;
}

export interface SceneRun {
  s: AdventureState;
  w: World;
  h: Hero;
}

/** Families with nothing a checker can measure yet. */
/** Families that are no rule of this game, and why (shown instead of a check). */
const NO_RULE: Record<string, string> = { GARGOYLE: "healing still tops up the wounded with the Ring of Oblivion, as in HotA; only the dead stay dead" };

/**
 * Proves an artifact: `pick` plays the scene with the artifact taken (and, with a foe, the battle
 * begun), `pass` the same without it. Returns the families that didn't show, or null.
 */
export function proveArtifact(data: GameData, id: number, pick: () => SceneRun & { b?: BattleState }, pass: () => SceneRun & { b?: BattleState }): ArtifactProof {
  const info = ARTIFACT_INFO[id];
  const bonuses = info?.bonuses ?? [];
  const families = [...new Set(bonuses.map((b) => b.type))];
  const spells = data.spells ?? [];
  const A = pick();
  const B = pass();
  if (![...(A.h.equipped ?? []), ...(A.h.backpack ?? [])].includes(id)) return { proof: "not picked up", note: "" };
  const failed: string[] = [];
  const checked: string[] = [];
  const parts = COMBOS[id] ?? [];
  const unchecked: string[] = [];
  const noRule: string[] = [];
  const check = (name: string, ok: boolean | string) => {
    checked.push(name);
    if (ok !== true) failed.push(`${name}: ${ok === false ? "no change" : ok}`);
  };
  if (parts.length) {
    const eq = A.h.equipped ?? [];
    const slot = eq.indexOf(id);
    const rec = A.h.combos?.[slot];
    const loose = parts.filter((p) => eq.includes(p) || (A.h.backpack ?? []).includes(p));
    const free = (B.h.equipped ?? []).includes(id) || parts.slice(0, -1).some((p) => !(B.h.equipped ?? []).includes(p) && !(B.h.backpack ?? []).includes(p));
    check(
      "assembled from its parts",
      slot < 0 ? "the combination isn't worn after the last part" : !rec || [...rec.parts].sort().join() !== [...parts].sort().join() ? "no record of its parts" : !data.artifacts[id]?.slots.includes(slot) ? `in slot ${slot}, not its own` : loose.length ? "parts still loose after assembling" : eq.filter((a) => a === LOCKED).length !== parts.length - 1 ? "the slots of the other parts aren't locked" : free ? "assembled without the last part" : true,
    );
    // The parts' own bonuses stay (the Angelic Alliance's +21), and taking it apart gives each part back.
    const loneBonuses = parts.reduce((a, p) => a + (ARTIFACT_INFO[p]?.bonuses ?? []).length, 0) + bonuses.length;
    // (Counted on top of the hero's own: a Knight's Leadership is a bonus too, and so is an artifact the hero starts with.)
    const own = heroBonuses({ ...A.h, equipped: eq.map((a, i) => (i === slot ? -1 : a)), combos: undefined }).length;
    const wornCount = heroBonuses(A.h).length - own;
    check("parts' bonuses stay", wornCount === loneBonuses || `${wornCount} bonuses, not ${loneBonuses}`);
    const t = structuredClone(A.h);
    disassemble(t, slot);
    // Off to the backpack and on again, and handed to another hero: the same bonuses, no lock left behind.
    const moved = structuredClone(A.h);
    const other = structuredClone(A.h);
    other.equipped = undefined;
    other.backpack = [];
    other.combos = {};
    other.timed = [];
    const worn = () => heroBonuses(moved).length;
    let movedOk: true | string = true;
    try {
      moveArtifact(data.artifacts, moved, { slot }, moved, {});
      if (moved.equipped!.includes(LOCKED) || worn() !== heroBonuses(A.h).length - loneBonuses) movedOk = "its bonuses or locks stay in the backpack";
      moveArtifact(data.artifacts, moved, { backpack: moved.backpack!.indexOf(id) }, moved, { slot });
      if (worn() !== heroBonuses(A.h).length) movedOk = `worn again: ${worn()} bonuses, not ${heroBonuses(A.h).length}`;
      moveArtifact(data.artifacts, moved, { slot }, other, { slot });
      if (moved.equipped!.includes(LOCKED) || heroBonuses(other).length !== loneBonuses) movedOk = "handed over: the giver keeps some of it, or the receiver lacks it";
    } catch (e) {
      movedOk = `moving it: ${(e as Error).message}`;
    }
    check("moved, worn again and traded", movedOk);
    check("taken apart again", parts.every((p) => (t.equipped ?? []).includes(p)) && !(t.equipped ?? []).includes(id) && !(t.equipped ?? []).includes(LOCKED) || "parts not back");
  }
  const units = (b: BattleState) => b.units.filter((u) => u.side === 0 && u.count > 0 && !u.machine);
  const foeUnit = (b: BattleState) => b.units.find((u) => u.side === 1 && u.count > 0 && !u.machine)!;
  const shooter = (b: BattleState) => units(b).find((u) => b.creatures[u.creature].abilities.some((a) => a.type === "SHOOTER"));
  const sum = (b: BattleState, f: (u: (typeof b.units)[number]) => number) => units(b).reduce((a, u) => a + f(u), 0);
  /** The enemy side given a hero with these spells, and one cast at our first stack (or a hex); what came of it. */
  const enemyCast = (b: BattleState, spell: number): { refused?: string; hurt: boolean; effect: boolean; resisted: boolean } => {
    const t = structuredClone(b);
    const hero: BattleHero = { name: "Foe", heroClass: 0, female: false, owner: 1, primary: [0, 0, 5, 5], spells: [spell], mana: 100, machines: [] };
    t.sides[1].hero = hero;
    // (The battle knows only the heroes' own spells; the test spell is added.)
    (t.spells ??= {})[spell] = spells[spell];
    const foe = foeUnit(t);
    const mine = units(t)[0];
    t.active = foe.id;
    try {
      const ev = applyAction(t, { type: "cast", unit: foe.id, spell, target: COMBAT_SPELLS[spell]?.who === "friend" ? foe.pos : mine.pos });
      const sp = ev.filter((e) => e.e === "spell");
      const ours = new Set(units(t).map((u) => u.id));
      return {
        hurt: sp.some((e) => e.e === "spell" && e.damage.some((d) => ours.has(d.unit) && d.damage > 0)),
        effect: units(t).some((u) => effectOf(u, spell)),
        resisted: sp.some((e) => e.e === "spell" && e.resisted.some((u) => ours.has(u))),
      };
    } catch (e) {
      return { refused: e instanceof Error ? e.message : String(e), hurt: false, effect: false, resisted: false };
    }
  };

  /** The state after the enemy's hero casts `spell` at our first stack (or why it was refused). */
  const afterEnemyCast = (b: BattleState, spell: number, skills?: [number, number][]): BattleState | string => {
    const t = structuredClone(b);
    t.sides[1].hero = { name: "Foe", heroClass: 0, female: false, owner: 1, primary: [0, 0, 5, 5], spells: [spell], mana: 100, machines: [], ...(skills ? { skills } : {}) };
    (t.spells ??= {})[spell] = spells[spell];
    const foe = foeUnit(t);
    t.active = foe.id;
    try {
      applyAction(t, { type: "cast", unit: foe.id, spell, target: units(t)[0].pos });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return t;
  };
  /** Our first stack as another creature (Skeletons for Destroy Undead and Animate Dead, Dwarves for resistance). */
  const asCreature = (b: BattleState, key: string, index = 0): BattleState => {
    const t = structuredClone(b);
    const c = data.creatures.find((x) => x.key === key)!;
    const u = units(t)[index];
    // (The battle carries only the stats of those in it.)
    t.creatures[c.id] = c;
    u.creature = c.id;
    u.firstHp = Math.min(u.firstHp, c.hp ?? 6);
    return t;
  };
  const undead = (b: BattleState) => asCreature(b, "skeleton");
  /** How many of forty enemy Slows our first stack resists. */
  const rolls = (b: BattleState) => {
    let n = 0;
    for (let k = 1; k <= 40; k++) {
      const t = structuredClone(b);
      t.rng = (t.rng + k * 7919) | 0;
      if (enemyCast(t, SPELL.SLOW).resisted) n++;
    }
    return n;
  };
  /** Our hero casts `spell` on our first stack (the spell added to the book); the state after, or why it was refused. */
  const ourCast = (b: BattleState, spell: number): BattleState | string => {
    const t = structuredClone(b);
    const u = units(t)[0];
    t.active = u.id;
    (t.spells ??= {})[spell] = spells[spell];
    const hero = t.sides[0].hero;
    if (hero) (hero.spells = [...(hero.spells ?? []), spell]), (hero.mana = Math.max(hero.mana ?? 0, 50)), (hero.skills = [[7, 3], ...(hero.skills ?? []).filter(([id]) => id !== 7)]);
    try {
      applyAction(t, { type: "cast", unit: u.id, spell, target: u.pos });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return t;
  };
  /** Whether `spell` (Resurrection, Animate Dead) raises some of our first stack, five of them fallen. */
  const raises = (b: BattleState, spell: number): boolean | string => {
    const t = spell === SPELL.ANIMATE_DEAD ? undead(b) : structuredClone(b);
    const u = units(t)[0];
    u.count = Math.max(1, u.count - 5);
    const before = u.count;
    const r = ourCast(t, spell);
    return typeof r === "string" ? false : units(r)[0].count > before;
  };

  for (const fam of families) {
    const vals = bonuses.filter((b) => b.type === fam);
    const total = vals.reduce((a, b) => a + (b.val ?? 0), 0);
    switch (fam) {
      case "PRIMARY_SKILL":
        // (Exact deltas are checked by scenecheck.ts itself; the enemy caster's spell power through its Magic Arrow.)
        if (vals.some((v) => v.limiters?.includes("OPPOSITE_SIDE"))) {
          if (!A.b || !B.b) check("the enemy's spell power", "no battle");
          else {
            const sp = spells[SPELL.MAGIC_ARROW];
            const mine = (b: BattleState) => units(b)[0];
            check("the enemy's spell power", spellDamage(A.b, 1, sp, mine(A.b)) < spellDamage(B.b, 1, sp, mine(B.b)) || "the enemy's Magic Arrow does as much as without it");
          }
        } else checked.push("attributes");
        break;
      case "CREATURE_GROWTH_PERCENT": {
        const town = (r: SceneRun) => r.s.objects.find((o) => o.town && o.owner === 0)!;
        check("growth", [1, 2, 3, 4, 5, 6, 7].some((l) => weeklyGrowth(A.w, town(A), l, A.s) > weeklyGrowth(B.w, town(B), l, B.s)) || "growth as without it");
        break;
      }
      case "NONEVIL_ALIGNMENT_MIX":
        check("mixed army's morale", heroMoraleLuck(A.s, A.w, A.h).morale > heroMoraleLuck(B.s, B.w, B.h).morale || "the mixed army's morale is as without it");
        break;
      case "WHIRLPOOL_PROTECTION": {
        // Both sail into the whirlpool: with the hat, the army comes through whole.
        const voyage = (r: SceneRun) => {
          // (The lower of the two whirlpools, entered where its visit tile is.)
          const pool = r.s.objects.filter((o) => o.type === 111 && !o.removed).sort((a, b) => b.y - a.y)[0];
          if (!pool) return "no whirlpool";
          const n = r.h.army.reduce((a, x) => a + (x?.count ?? 0), 0);
          applyAdventureAction(r.s, r.w, { type: "move", hero: r.h.id, to: r.w.index(9, 11, 0) }, 0);
          r.h.movement = r.h.maxMovement;
          applyAdventureAction(r.s, r.w, { type: "move", hero: r.h.id, to: visitTile(r.w, pool) }, 0);
          return r.h.army.reduce((a, x) => a + (x?.count ?? 0), 0) - n;
        };
        const a = voyage(A);
        const b = voyage(B);
        if (typeof a === "string" || typeof b === "string") check("the whirlpool", "no whirlpool to sail into");
        else check("the whirlpool", a === 0 && b < 0 ? true : a < 0 ? "the whirlpool still took half a stack" : "the whirlpool took nothing even without it");
        break;
      }
      case "FREE_SHOOTING": {
        if (!A.b || !B.b) {
          check("shooting beside the enemy", "no battle");
          break;
        }
        const beside = (b: BattleState) => {
          const t = structuredClone(b);
          const u = shooter(t);
          const f = foeUnit(t);
          if (!u) return false;
          u.pos = f.pos - 1;
          return canShoot(t, u);
        };
        check("shooting beside the enemy", beside(A.b) && !beside(B.b) ? true : beside(A.b) ? "the shooter could shoot beside the enemy without it too" : "the shooter can't shoot beside the enemy");
        break;
      }
      case "HP_REGENERATION": {
        if (!A.b || !B.b) {
          check("regeneration", "no battle");
          break;
        }
        // The first stack wounded; by its next turn it has healed with the elixir.
        const healed = (b: BattleState) => {
          const t = structuredClone(b);
          t.sides[0].controller = "ai";
          // (A big enemy, so the battle lasts into the next round, when wounds close.)
          foeUnit(t).count = 500;
          const u = units(t)[0];
          u.firstHp = 1;
          // (Wounds close as a round begins: wait for the stack's turn in the next round.)
          let newRound = false;
          for (let k = 0; k < 80 && t.winner === null; k++) {
            const ev = aiStep(t);
            if (!ev) break;
            if (ev.some((e) => e.e === "round")) newRound = true;
            if (newRound && ev.some((e) => e.e === "turn" && e.unit === u.id)) break;
          }
          return t.units[u.id].firstHp > 1;
        };
        check("regeneration", healed(A.b) && !healed(B.b) ? true : healed(A.b) ? "the wound closed without it too" : "the wound didn't close");
        break;
      }
      // The Ring of Oblivion: a fallen stack Resurrection can't raise.
      case "DISINTEGRATE": {
        if (!A.b || !B.b) {
          check("oblivion", "no battle");
          break;
        }
        const spell = SPELL.RESURRECTION;
        const tryOn = (b: BattleState) => {
          const t = structuredClone(b);
          const u = units(t)[0];
          u.count = Math.max(1, u.count - 5);
          const before = u.count;
          t.active = u.id;
          (t.spells ??= {})[spell] = spells[spell];
          // (And the mana for it: a cast refused for want of points mustn't pass for the Ring at work.)
          if (t.sides[0].hero) (t.sides[0].hero.spells = [...(t.sides[0].hero.spells ?? []), spell]), (t.sides[0].hero.mana = 999);
          try {
            applyAction(t, { type: "cast", unit: u.id, spell, target: u.pos });
          } catch {
            return false;
          }
          return u.count > before;
        };
        check("no raising", !tryOn(A.b) && tryOn(B.b) ? true : tryOn(A.b) ? `${spells[spell]?.name} still works with it` : `${spells[spell]?.name} doesn't work without it either`);
        break;
      }
      case "NEGATE_ALL_NATURAL_IMMUNITIES": {
        if (!A.b || !B.b) {
          check("magic on the immune", "no battle");
          break;
        }
        // Our hero's Magic Arrow at the Black Dragons: it lands with the orb, is refused without.
        const lands = (b: BattleState) => {
          const t = structuredClone(b);
          const mine = units(t)[0];
          const f = foeUnit(t);
          t.active = mine.id;
          try {
            const ev = applyAction(t, { type: "cast", unit: mine.id, spell: SPELL.MAGIC_ARROW, target: f.pos });
            return ev.some((e) => e.e === "spell" && e.damage.some((d) => d.unit === f.id && d.damage > 0));
          } catch {
            return false;
          }
        };
        check("magic on the immune", lands(A.b) && !lands(B.b) ? true : lands(A.b) ? "the dragons took the arrow without it too" : "the arrow didn't land on the dragons");
        break;
      }
      case "MOVEMENT": {
        for (const b of vals) {
          if (b.subtype === "heroMovementSea") {
            // Aboard the scene's boat (fresh plays: boarding moves the hero), the day's movement at sea.
            const aboard = (r: SceneRun) => {
              const boat = r.s.objects.find((o) => o.type === 8 && !o.removed);
              if (!boat) return -1;
              applyAdventureAction(r.s, r.w, { type: "move", hero: r.h.id, to: r.w.index(boat.x - 1, boat.y, 0) }, 0);
              return r.h.boat === undefined ? -1 : maxMovement(r.w, r.h);
            };
            const [a, n] = [aboard(pick()), aboard(pass())];
            check("sea movement aboard", a < 0 || n < 0 ? "couldn't board the scene's boat" : a - n === b.val || `${a - n} more at sea, not ${b.val}`);
            const sea = (r: SceneRun) => {
              const keep = r.h.boat;
              r.h.boat = 0;
              const m = maxMovement(r.w, r.h);
              r.h.boat = keep;
              return m;
            };
            check("sea movement", sea(A) - sea(B) === b.val || `${sea(A) - sea(B)} more, not ${b.val}`);
          } else check("movement", maxMovement(A.w, A.h) - maxMovement(B.w, B.h) === b.val || `${maxMovement(A.w, A.h) - maxMovement(B.w, B.h)} more, not ${b.val}`);
        }
        break;
      }
      case "MORALE":
      case "LUCK": {
        const key = fam === "MORALE" ? "morale" : "luck";
        const enemy = vals.some((b) => b.limiters?.includes("OPPOSITE_SIDE"));
        if (enemy) {
          if (!A.b || !B.b) check(`enemy ${key}`, "no battle");
          else {
            const f = (b: BattleState) => (key === "morale" ? moraleOf(b, foeUnit(b)) : luckOf(b, foeUnit(b)));
            check(`enemy ${key}`, f(A.b) < f(B.b) || `the enemy's ${key} is ${f(A.b)}, as without it`);
          }
        } else {
          const a = heroMoraleLuck(A.s, A.w, A.h)[key];
          const b = heroMoraleLuck(B.s, B.w, B.h)[key];
          check(key, total === 0 ? a === 0 || `${key} is ${a}, not held at 0` : a === Math.max(-3, Math.min(3, b + total)) || `${key} ${a} with it, ${b} without`);
        }
        break;
      }
      case "SIGHT_RADIUS":
        check("sight", heroSight(A.h) - heroSight(B.h) === total || `sight ${heroSight(A.h) - heroSight(B.h)} more, not ${total}`);
        break;
      case "MANA_REGENERATION":
        check("spell points a day", manaRegen(A.h) - manaRegen(B.h) === total || `${manaRegen(A.h) - manaRegen(B.h)} more a day, not ${total}`);
        break;
      case "MANA_PERCENTAGE_REGENERATION":
        check("spell points a day", manaRegen(A.h) > manaRegen(B.h) || "no more a day");
        break;
      case "SPELLS_OF_SCHOOL":
      case "SPELLS_OF_LEVEL":
      case "SPELL": {
        const a = heroSpells(A.h, spells) ?? [];
        const b = heroSpells(B.h, spells) ?? [];
        const gained = a.filter((x) => !b.includes(x));
        // Titan's Lightning Bolt comes only from Titan's Thunder.
        if (fam !== "SPELL") check("no Titan's Bolt", !gained.includes(57) || "it gives Titan's Lightning Bolt");
        if (fam === "SPELL") check("its spell", vals.every((v) => gained.some((x) => spells[x]?.key === v.subtype || (v.subtype === "titanBolt" && x === 57))) || "its spell isn't in the book");
        else if (fam === "SPELLS_OF_LEVEL") {
          // Every spell of that level (the subtype's, "spellLevel5"), and none of another.
          const level = Number(/(\d)$/.exec(vals[0]?.subtype ?? "")?.[1]);
          const all = spells.filter((sp) => sp && sp.id < 70 && sp.id !== 57 && sp.level === level).map((sp) => sp.id);
          check("spells of its level", (gained.length > 0 && gained.every((x) => spells[x]?.level === level) && all.every((x) => a.includes(x))) || `gained levels ${[...new Set(gained.map((x) => spells[x]?.level))].join(",")}, not ${level}`);
        } else check("spells known", gained.length >= 5 || `only ${gained.length} spells gained`);
        break;
      }
      case "FLYING_MOVEMENT":
      case "WATER_WALKING": {
        const water = A.w.index(10, 11, 0);
        check("over the water", findPaths(A.w, A.s, A.h).has(water) && !findPaths(B.w, B.s, B.h).has(water) || "the water is no more reachable than without it");
        break;
      }
      case "ROUGH_TERRAIN_DISCOUNT": {
        const far = A.w.index(6, 8, 0);
        const cost = (r: SceneRun) => findPaths(r.w, r.s, r.h).get(far)?.cost ?? Infinity;
        check("swamp cost", cost(A) < cost(B) || "the swamp costs as much as without it");
        break;
      }
      case "FREE_SHIP_BOARDING": {
        // Boarding: the movement left afterwards.
        const left = (r: SceneRun) => {
          const boat = r.s.objects.find((o) => o.type === 8 && !o.removed);
          if (!boat) return -1;
          // (The boat is entered from the tile west of it, where its hull sits.)
          applyAdventureAction(r.s, r.w, { type: "move", hero: r.h.id, to: r.w.index(boat.x - 1, boat.y, 0) }, 0);
          return r.h.movement;
        };
        check("boarding", left(A) > 0 && left(B) === 0 ? true : left(A) <= 0 ? "boarding took the day's movement" : "boarding costs nothing without it either");
        break;
      }
      case "GENERATE_RESOURCE": {
        const res = (r: SceneRun) => {
          const before = [...r.s.players[0].resources];
          newDay(r.s, r.w);
          return r.s.players[0].resources.map((x, i) => x - before[i]);
        };
        const da = res(A);
        const db = res(B);
        check("income", da[6] - db[6] >= total || `${da[6] - db[6]} more gold a day, not ${total}`);
        break;
      }
      case "STACKS_SPEED":
        if (!A.b || !B.b) check("speed", "no battle");
        else check("speed", sum(A.b, (u) => speedOf(A.b!, u)) - sum(B.b, (u) => speedOf(B.b!, u)) === total * units(A.b).length || "the stacks are no faster");
        break;
      case "STACK_HEALTH":
        if (!A.b || !B.b) check("health", "no battle");
        // (A value of 25 and over is a share: the Elixir of Life's +25%.)
        else check("health", units(A.b).every((u, i) => hpOf(A.b!, u) > hpOf(B.b!, units(B.b!)[i])) || "the stacks have no more health");
        break;
      case "PERCENTAGE_DAMAGE_BOOST":
      case "NO_DISTANCE_PENALTY":
      case "NO_WALL_PENALTY": {
        if (!A.b || !B.b) check("shots", "no battle");
        else if (fam === "NO_WALL_PENALTY" && !A.b.siege) check("shots through walls", "no siege");
        else {
          const dmg = (b: BattleState) => {
            const u = shooter(b);
            return u ? expectedDamage(b, u, foeUnit(b), true).max : -1;
          };
          check(fam === "NO_WALL_PENALTY" ? "shots through walls" : fam === "NO_DISTANCE_PENALTY" ? "shots from afar" : "shooting damage", dmg(A.b) > dmg(B.b) || `the shots do ${dmg(A.b)}, as without it`);
        }
        break;
      }
      case "SURRENDER_DISCOUNT":
        if (!A.b || !B.b) check("surrender price", "no battle");
        else check("surrender price", surrenderCost(A.b, 0) < surrenderCost(B.b, 0) || "surrender costs as much as without it");
        break;
      case "SPELL_DAMAGE": {
        if (!A.b || !B.b) check("spell damage", "no battle");
        else {
          const sp = spells[SPELL.MAGIC_ARROW];
          check("spell damage", spellDamage(A.b, 0, sp, foeUnit(A.b)) > spellDamage(B.b, 0, sp, foeUnit(B.b)) || "Magic Arrow does as much as without it");
        }
        break;
      }
      case "SPELL_DURATION": {
        if (!A.b || !B.b) check("spell duration", "no battle");
        else {
          const rounds = (b: BattleState) => {
            const t = structuredClone(b);
            const mine = units(t)[0];
            t.active = mine.id;
            try {
              applyAction(t, { type: "cast", unit: mine.id, spell: SPELL.HASTE, target: mine.pos });
            } catch {
              return -1;
            }
            return effectOf(t.units[mine.id], SPELL.HASTE)?.rounds ?? -1;
          };
          check("spell duration", rounds(A.b) > rounds(B.b) || `Haste lasts ${rounds(A.b)} rounds, as without it`);
        }
        break;
      }
      case "BLOCK_ALL_MAGIC":
      case "BLOCK_MAGIC_ABOVE":
      case "BLOCK_MAGIC_BELOW":
        if (!A.b || !B.b) check("magic blocked", "no battle");
        else check("magic blocked", castable(A.b, 0).length < castable(B.b, 0).length || "as many spells castable as without it");
        break;
      case "BATTLE_NO_FLEEING": {
        if (!A.b) check("no fleeing", "no battle");
        else {
          const t = structuredClone(A.b);
          // In HotA the Shackles hold only fights between heroes: an enemy hero takes the monsters' side.
          if (!t.sides[1].hero && t.sides[0].hero) t.sides[1].hero = { ...t.sides[0].hero, name: "Foe", owner: 1, bonuses: [] };
          const mine = units(t)[0];
          t.active = mine.id;
          let refused = false;
          try {
            applyAction(t, { type: "retreat", unit: mine.id, surrender: false });
          } catch {
            refused = true;
          }
          check("no fleeing", refused || "the hero could retreat");
        }
        break;
      }
      case "MIND_IMMUNITY":
      case "LEVEL_SPELL_IMMUNITY":
      case "SPELL_IMMUNITY": {
        if (!A.b) {
          check("immunity", "no battle");
          break;
        }
        const tests: [string, number][] = fam === "MIND_IMMUNITY" ? [["Blind", SPELL.BLIND]] : fam === "LEVEL_SPELL_IMMUNITY" ? [["Magic Arrow", SPELL.MAGIC_ARROW]] : vals.map((v) => [v.subtype ?? "", spells.find((x) => x.key === v.subtype)?.id ?? -1] as [string, number]).filter(([, id]) => id >= 0);
        for (const [name, spell] of tests) {
          // The Pendant of Death: our Skeletons, and the enemy's Destroy Undead at them.
          if (name === "destroyUndead") {
            if (!B.b) {
              check("immune to Destroy Undead", "no battle");
              continue;
            }
            const hurt = (b: BattleState): boolean | string => {
              const t = undead(b);
              const r = afterEnemyCast(t, spell);
              // (With every undead immune the spell can't be cast at all: "That spell will affect no one!")
              if (typeof r === "string") return /affect no one/.test(r) ? false : r;
              return units(r)[0].count < units(t)[0].count || units(r)[0].firstHp < units(t)[0].firstHp;
            };
            const a = hurt(A.b);
            const c = hurt(B.b);
            check("immune to Destroy Undead", a === false && c === true ? true : typeof a === "string" ? a : a ? "Destroy Undead hurt the Skeletons" : "Destroy Undead didn't hurt them without it either");
            continue;
          }
          // The Sphere of Permanence: our blessed stack keeps its blessing through the enemy's Dispel.
          if (name === "dispel") {
            if (!B.b) {
              check("immune to Dispel", "no battle");
              continue;
            }
            const keeps = (b: BattleState): boolean | string => {
              const t = ourCast(b, SPELL.BLESS);
              if (typeof t === "string") return `Bless refused: ${t}`;
              if (!effectOf(units(t)[0], SPELL.BLESS)) return "Bless didn't take";
              // (Advanced Water Magic: a Basic Dispel only reaches the caster's own stacks, as HotA's SPTRAITS.)
              const r = afterEnemyCast(t, spell, [[16, 2]]);
              // (Refused for want of a target: nothing of ours it can dispel.)
              return typeof r === "string" ? /target/.test(r) || r : !!effectOf(units(r)[0], SPELL.BLESS);
            };
            const a = keeps(A.b);
            const c = keeps(B.b);
            check("immune to Dispel", a === true && c === false ? true : typeof a === "string" ? a : a ? "Dispel took the blessing off" : "Dispel doesn't take it off without it either");
            continue;
          }
          // The Ring of Oblivion: no Sacrifice either (our second stack fallen, the first given up for it).
          if (name === "sacrifice") {
            if (!B.b) {
              check("no sacrifice", "no battle");
              continue;
            }
            const sacrifices = (b: BattleState): boolean | string => {
              const t = structuredClone(b);
              const [victim, fallen] = units(t);
              if (!fallen) return "no second stack";
              fallen.count = 0;
              t.active = victim.id;
              (t.spells ??= {})[spell] = spells[spell];
              const hero = t.sides[0].hero;
              if (hero) (hero.spells = [...(hero.spells ?? []), spell]), (hero.mana = 50), (hero.skills = [[7, 3], ...(hero.skills ?? []).filter(([id]) => id !== 7)]);
              try {
                applyAction(t, { type: "cast", unit: victim.id, spell, target: fallen.pos, dest: victim.pos });
              } catch {
                return false;
              }
              return fallen.count > 0;
            };
            const a = sacrifices(A.b);
            const c = sacrifices(B.b);
            check("no sacrifice", a === false && c === true ? true : typeof a === "string" ? a : a ? "Sacrifice still raises them with it" : typeof c === "string" ? c : "Sacrifice raises nobody without it either");
            continue;
          }
          // The Sphere of Permanence: a Serpent Fly's blow (which strips blessings) leaves our stack's Bless.
          if (name === "dispelHelpful") {
            if (!B.b) {
              check("blessings kept under a Serpent Fly's blow", "no battle");
              continue;
            }
            const stripped = (b: BattleState): boolean | string => {
              const t0 = ourCast(b, SPELL.BLESS);
              if (typeof t0 === "string") return `Bless refused: ${t0}`;
              const fly = data.creatures.find((x) => x.abilities.some((y) => y.type === "SPELL_AFTER_ATTACK" && y.subtype === "dispelHelpful"));
              if (!fly) return "no creature strips blessings";
              for (let k = 1; k <= 10; k++) {
                const t = structuredClone(t0);
                t.rng = (t.rng + k * 7919) | 0;
                const f = foeUnit(t);
                t.creatures[fly.id] = fly;
                f.creature = fly.id;
                f.firstHp = Math.min(f.firstHp, fly.hp ?? 1);
                const mine = units(t)[0];
                const p = [...Array(HEX_COUNT).keys()].find((h) => areAdjacent(t, f, h, mine) && canStand(t, f, h));
                if (p === undefined) return "the fly can't reach our stack";
                f.pos = p;
                t.active = f.id;
                try {
                  applyAction(t, { type: "attack", unit: f.id, target: mine.id, from: p });
                } catch (e) {
                  return `the fly's blow was refused: ${e instanceof Error ? e.message : e}`;
                }
                if (!effectOf(t.units[mine.id], SPELL.BLESS)) return true;
              }
              return false;
            };
            const a = stripped(A.b);
            const c = stripped(B.b);
            check("blessings kept under a Serpent Fly's blow", a === false && c === true ? true : typeof a === "string" ? a : a ? "the blow stripped the Bless" : typeof c === "string" ? c : "the blow strips nothing without it either");
            continue;
          }
          // The Ring of Oblivion: no raising our fallen (Resurrection, Animate Dead on our Skeletons).
          if (name === "resurrection" || name === "animateDead") {
            if (!B.b) {
              check(`no ${name}`, "no battle");
              continue;
            }
            const a = raises(A.b, spell);
            const c = raises(B.b, spell);
            check(`no ${name}`, a === false && c === true ? true : a ? `${name} still raises them with it` : `${name} raises nobody without it either`);
            continue;
          }
          // Spells that can't be tried on a living stack of ours.
          if (["sacrifice", "dispelHelpful"].includes(name)) {
            unchecked.push(`${fam}:${name}`);
            continue;
          }
          const r = enemyCast(A.b, spell);
          check(`immune to ${name}`, r.refused ? true : r.resisted ? true : !r.hurt && !r.effect ? true : `${name} ${r.hurt ? "hurt" : "took on"} the stacks`);
        }
        break;
      }
      case "MAGIC_RESISTANCE": {
        if (!A.b || !B.b) {
          check("resistance", "no battle");
          break;
        }
        if (total <= 0) {
          // The Orb of Vulnerability: our Dwarves resist nothing with it (forty enemy Slows), something without.
          const a = rolls(asCreature(A.b, "dwarf"));
          const c = rolls(asCreature(B.b, "dwarf"));
          check("no resistance", (a === 0 && c > 0) || `the Dwarves resisted Slow ${a} times in 40 with it, ${c} without`);
          break;
        }
        const a = rolls(A.b);
        const b = rolls(B.b);
        check("resistance", a > b || `Slow resisted ${a} times in 40, ${b} without it`);
        break;
      }
      case "LIFE_DRAIN": {
        // The Ring of Oblivion: our Vampire Lords' blow drains nothing with it (staged beside the enemy), something without.
        if (!A.b || !B.b) {
          check("no life drain", "no battle");
          break;
        }
        const drained = (b: BattleState): number | string => {
          const t = asCreature(b, "vampireLord");
          const mine = units(t)[0];
          mine.count = Math.max(mine.count, 10);
          mine.firstHp = 1;
          const f = foeUnit(t);
          const p = [...Array(HEX_COUNT).keys()].find((h) => areAdjacent(t, mine, h, f) && canStand(t, mine, h));
          if (p === undefined) return "our stack can't reach the enemy";
          mine.pos = p;
          t.active = mine.id;
          try {
            const ev = applyAction(t, { type: "attack", unit: mine.id, target: f.id, from: p });
            return ev.filter((e) => e.e === "drain" && e.unit === mine.id).reduce((x, e) => x + (e.e === "drain" ? e.amount : 0), 0);
          } catch (e) {
            return `the blow was refused: ${e instanceof Error ? e.message : e}`;
          }
        };
        const a = drained(A.b);
        const c = drained(B.b);
        check("no life drain", typeof a === "string" ? a : typeof c === "string" ? c : (a === 0 && c > 0) || `drained ${a} with it, ${c} without`);
        break;
      }
      case "LEARN_BATTLE_SPELL_CHANCE": {
        // The enemy caster two tiles left, its book of cheap spells unspent: beaten twenty times, how many spells our basic Eagle Eye picks up.
        const learned = (r: SceneRun): number | string => {
          let n = 0;
          for (let k = 1; k <= 20; k++) {
            const s = structuredClone(r.s) as AdventureState & { rng: number };
            s.rng = (s.rng + k * 7919) | 0;
            r.w.refresh(s);
            const h = s.heroes.find((x) => x.id === r.h.id)!;
            const enemy = s.heroes.find((x) => !x.removed && x.owner === 1);
            if (!enemy) return "no enemy caster";
            const had = (h.spells ?? []).length;
            if (!s.battles[0]) applyAdventureAction(s, r.w, { type: "move", hero: h.id, to: r.w.index(enemy.x, enemy.y, 0) }, 0);
            if (!s.battles[0]) return "no battle began";
            if (!fightAndSettle(s, r.w)) return "the fight was lost";
            n += (h.spells ?? []).length - had;
          }
          return n;
        };
        const a = learned(A);
        const c = learned(B);
        check("spells learned from the beaten caster", typeof a === "string" ? a : typeof c === "string" ? c : a > c || `learned ${a} spells in twenty fights with it, ${c} without`);
        break;
      }
      case "SPELL_RESISTANCE_AURA": {
        // The Orb of Vulnerability: a Unicorn's aura on the stack beside it counts for nothing with it (forty enemy Slows), something without.
        if (!A.b || !B.b) {
          check("no aura", "no battle");
          break;
        }
        if (total > 0) {
          unchecked.push(fam);
          break;
        }
        const beside = (b: BattleState): BattleState | string => {
          const t = asCreature(b, "unicorn", 1);
          const [first, horn] = units(t);
          if (!horn) return "no second stack";
          const taken = new Set(t.units.filter((u) => u.count > 0).flatMap((u) => unitHexes(t, u)));
          const h = neighbours(first.pos).find((x) => !taken.has(x));
          if (h === undefined) return "no room beside the first stack";
          horn.pos = h;
          return t;
        };
        const ta = beside(A.b);
        const tb = beside(B.b);
        if (typeof ta === "string" || typeof tb === "string") {
          check("no aura", typeof ta === "string" ? ta : (tb as string));
          break;
        }
        const a = rolls(ta);
        const c = rolls(tb);
        check("no aura", (a === 0 && c > 0) || `beside a Unicorn, Slow resisted ${a} times in 40 with it, ${c} without`);
        break;
      }
      case "OPENING_BATTLE_SPELL": {
        if (!A.b) check("opening spell", "no battle");
        else {
          const onEnemy = vals.some((v) => ["curse", "slow", "weakness", "misfortune"].includes(v.subtype ?? ""));
          const ids = vals.map((v) => spells.find((x) => x.key === v.subtype)?.id ?? -1);
          const target = onEnemy ? [foeUnit(A.b)] : units(A.b);
          check("opening spell", target.some((u) => ids.some((sp) => effectOf(u, sp))) || "nobody has the spell on them as the battle opens");
        }
        break;
      }
      case "UNDEAD_RAISE_PERCENTAGE":
      case "IMPROVED_NECROMANCY": {
        if (!A.b || !B.b) {
          check("necromancy", "no battle");
          break;
        }
        const raised = (r: SceneRun & { b?: BattleState }, creature: number) => {
          r.b!.sides[0].controller = "ai";
          runAi(r.b!);
          finishBattle(r.s, r.w, 0);
          return r.h.army.reduce((a, x) => a + (x && x.creature === creature ? x.count : 0), 0);
        };
        if (fam === "IMPROVED_NECROMANCY") check("raises Liches", raised(A, 64) > 0 || "no Liches raised");
        else {
          const a = raised(A, 56);
          const b = raised(B, 56);
          check("skeletons raised", a > b || `${a} Skeletons raised, ${b} without it`);
        }
        break;
      }
      case "RAISE_FANGARMS": {
        // The Horn of the Abyss: the slain living foes rise as Fangarms that join the hero after the battle.
        if (!A.b || !B.b) {
          check("Fangarms rise", "no battle");
          break;
        }
        const fangarms = (r: SceneRun & { b?: BattleState }) => {
          r.b!.sides[0].controller = "ai";
          runAi(r.b!);
          const rose = r.b!.units.filter((u) => u.raised).reduce((a, u) => a + u.initialCount, 0);
          finishBattle(r.s, r.w, 0);
          return { rose, kept: r.h.army.reduce((a, x) => a + (x && x.creature === 168 ? x.count : 0), 0) };
        };
        const a = fangarms(A);
        const b = fangarms(B);
        check("Fangarms rise and stay", (a.rose > 0 && a.kept > 0 && b.rose === 0) || `${a.rose} rose and ${a.kept} stayed with it, ${b.rose} without`);
        break;
      }
      default:
        if (NO_RULE[fam]) noRule.push(`${fam} (${NO_RULE[fam]})`);
        else unchecked.push(fam);
    }
  }
  // Artifacts with a rule of their own, no bonuses: the spellbook, a scroll, the Grail, the war machines, the income and growth ones.
  if (!bonuses.length) {
    const BY_ID_GOLD: Record<number, number> = { 115: 1000, 116: 750, 117: 500 };
    const BY_ID_RESOURCE: Record<number, number> = { 109: 4, 110: 5, 111: 1, 112: 2, 113: 3, 114: 0 };
    const GROWTH: Record<number, number> = { 118: 2, 119: 3, 120: 4, 121: 5, 122: 6 };
    if (id === 0) check("spellbook", A.h.spells !== undefined || "no spellbook on the hero");
    else if (id === 1) check("scroll's spell", (heroSpells(A.h, spells) ?? []).includes(SPELL.MAGIC_ARROW) || "its spell isn't in the book");
    else if (id === 2) check("carried", true);
    else if (id === 3) check("on the field in a siege", A.b ? A.b.units.some((u) => u.side === 0 && u.machine === "catapult") || "no catapult in the siege" : "no siege");
    else if (id === 146) check("on the field, shooting", A.b ? A.b.units.some((u) => u.side === 0 && u.machine === "cannon") || "no cannon in the battle" : "no battle");
    else if (id >= 4 && id <= 6) check("on the field", A.b ? A.b.units.some((u) => u.side === 0 && u.machine) || "no war machine in the battle" : "no battle");
    else if (BY_ID_GOLD[id] || BY_ID_RESOURCE[id] !== undefined || id === 140) {
      const res = (r: SceneRun) => {
        const before = [...r.s.players[0].resources];
        newDay(r.s, r.w);
        return r.s.players[0].resources.map((x, i) => x - before[i]);
      };
      const da = res(A);
      const db = res(B);
      if (BY_ID_GOLD[id]) check("gold a day", da[6] - db[6] === BY_ID_GOLD[id] || `${da[6] - db[6]} more gold a day, not ${BY_ID_GOLD[id]}`);
      else if (id === 140) {
        // (Four of each, besides each part's one; B lacks the last part's one too.)
        const last = BY_ID_RESOURCE[lastPartOf(140)];
        check("resources a day", [1, 3, 4, 5].every((i) => da[i] - db[i] === 4 + (i === last ? 1 : 0)) || "not 4 of each rare resource a day over the parts' own");
      }
      else check("resource a day", da[BY_ID_RESOURCE[id]] - db[BY_ID_RESOURCE[id]] === 1 || "not 1 a day");
    } else if (GROWTH[id] || id === 133) {
      const town = (r: SceneRun) => r.s.objects.find((o) => o.town && o.owner === 0)!;
      // (HotA: a Legion piece only counts in the town its hero stands in; station the hero there.)
      const g = (r: SceneRun, level: number) => {
        const t = town(r);
        const was = r.h.garrison;
        r.h.garrison = t.id;
        try { return weeklyGrowth(r.w, t, level, r.s); } finally { r.h.garrison = was; }
      };
      if (GROWTH[id]) check("growth", g(A, GROWTH[id]) > g(B, GROWTH[id]) || `level ${GROWTH[id]} growth ${g(A, GROWTH[id])}, as without it`);
      else check("growth", [1, 2, 3, 4, 5, 6, 7].some((l) => g(A, l) > g(B, l)) || "growth as without it");
    } else if (info?.components) {
      // (Cornucopia, Diplomat's Cloak: no bonuses of their own; the assembly is their proof.)
    }
    else unchecked.push("own rule");
  }
  if (!checked.length && !failed.length) return { proof: unchecked.length ? null : "nothing checkable", note: unchecked.length ? `no checker yet for ${unchecked.join(", ")}` : "" };
  return { proof: failed.length ? failed.join("; ") : null, note: `checked: ${checked.join(", ")}${unchecked.length ? `; no checker yet for ${unchecked.join(", ")}` : ""}${noRule.length ? `; not a rule here: ${noRule.join(", ")}` : ""}` };
}
