// Battle recipes (docs/evidence-vision.md, 3): the smallest battle that shows a creature's
// abilities. A creature against its own kind by default; where that can't show the effect, its
// counterpart: the hated creature opposite, the enemy packed together for breaths and multi-head
// attacks, several small attackers for extra retaliations, living and undead side by side for a
// death cloud, the player's hero with the spell an immunity or resistance answers (the creature
// then stands on the computer's side, so the player casts at it), a siege for a Cyclops' stones.
// The battle page plays a recipe from its link (recipeLink); sim/battlecheck.ts proves it (the
// ability shows in the battle's events) for the Completeness page.
import { type CreatureStats, hasAbility } from "../creatures.ts";
import { SPELL, type SpellInfo } from "../spells.ts";

export interface Stack {
  creature: number;
  count: number;
}
export interface BattleRecipe {
  left: Stack[];
  right: Stack[];
  /** The left (the player's) hero's spellbook; none: no spells. */
  spells?: number[];
  /** The right hero's spellbook (the computer casts them). */
  rightSpells?: number[];
  /** Both armies packed together (a breath or a multi-head attack reaches the neighbour; an aura covers an ally). */
  tight?: boolean;
  /** This side stands two deep, a stack straight behind another along a row (what a breath reaches). */
  deep?: "left" | "right" | "both";
  /** The left hero's Spell Power and Knowledge (a caster: spells that last, mana for the dearest). */
  power?: number;
  knowledge?: number;
  /** The right side defends this town's walls. */
  siege?: string;
  /** The heroes' skills [key, level] (Expert Fire Magic for Slayer against kings, Wisdom for high spells); both have them. */
  skills?: [string, number][];
  /** What to watch for. */
  what: string;
}

const PIKEMAN = 0;
const SWORDSMAN = 6;
const ARCHER = 2;
const CENTAUR = 14;
const SKELETON = 56;
const IMP = 42;
const AUTOMATON = 176;
const TITAN = 41;
const CAVALIER = 10;

/** What each of the abilities that act on a living enemy shows, said plainly. */
const ON_LIVING: Record<string, string> = {
  ADDITIONAL_ATTACK: "they strike twice",
  BLOCKS_RETALIATION: "they strike one stack at a time and it never strikes back",
  LIFE_DRAIN: "their blows heal them (and raise their fallen)",
  DEATH_STARE: "their gaze slays some of the enemy outright",
  DOUBLE_DAMAGE_CHANCE: "some blows do double damage",
  ENEMY_DEFENCE_REDUCTION: "they ignore part of the enemy's Defense",
  ENEMY_ATTACK_REDUCTION: "the enemy's Attack counts for less against them",
  RETURN_AFTER_STRIKE: "they fly back after each strike",
  SPELL_AFTER_ATTACK: "their blows sometimes cast a spell on the enemy",
  JOUSTING: "the further they charge, the harder they hit",
  NO_MELEE_PENALTY: "they fight at full strength in melee",
  FEARFUL: "the enemy sometimes freezes in fear",
  FIRE_SHIELD: "whoever strikes them is burned back",
};

/** How many of a creature fight in its recipe (the battle page's count). */
export const recipeCount = (c: CreatureStats) => Math.max(1, 40 - 5 * c.level);

/** A plain living melee stack worth about as much as the creature's own stack. */
function foe(c: CreatureStats, n: number, creatures: CreatureStats[], id = c.level >= 4 ? SWORDSMAN : PIKEMAN): Stack {
  const f = creatures[id];
  return { creature: id, count: Math.max(5, Math.min(300, Math.round((n * (c.aiValue || 1)) / Math.max(1, f?.aiValue ?? 1)))) };
}
/** Three stacks worth the one. */
const three = (s: Stack): Stack[] => [0, 1, 2].map(() => ({ creature: s.creature, count: Math.max(3, Math.round(s.count / 3)) }));

/** The hero's spell an immunity or a weakness answers (the ability's subtype is the spell's key). */
function spellByKey(key: string | undefined, spells: SpellInfo[]): number | undefined {
  if (!key) return undefined;
  const sp = spells.find((x) => x.key === key && x.id < 70);
  return sp?.id;
}

/** A spell's name for the recipe's text: the game's (Blind), or its key in words (stone gaze). */
const spellWord = (key: string, spells: SpellInfo[]) => spells.find((x) => x.key === key)?.name ?? key.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`);

/** The creature's recipe: what shows its abilities at their simplest. */
export function creatureRecipe(c: CreatureStats, creatures: CreatureStats[], spells: SpellInfo[]): BattleRecipe {
  const n = recipeCount(c);
  const has = (t: string) => hasAbility(c, t);
  const sub = (t: string) => c.abilities.filter((a) => a.type === t).map((a) => a.subtype ?? "");
  const notes: string[] = [];
  /** The creature's own side (allies after it) and what faces it. */
  const own: Stack[] = [{ creature: c.id, count: n }];
  let enemy: Stack[] = [{ creature: c.id, count: n }];
  let tight = false;
  let siege: string | undefined;
  const book: number[] = [];
  let rightSpells: number[] | undefined;
  let skills: [string, number][] | undefined;
  /** The enemy: a plain living stack (an ability that acts on the target needs one; undead or kin may be immune). */
  // (Only in place of its own kind: a packed, hated or caster enemy set already stays.)
  const living = () => {
    if (enemy.length === 1 && enemy[0].creature === c.id) enemy = [foe(c, n, creatures)];
  };
  const target = (...ids: (number | undefined)[]) => {
    for (const id of ids) if (id !== undefined && !book.includes(id)) book.push(id);
  };

  const onLiving = Object.keys(ON_LIVING).filter(has);
  if (onLiving.length) {
    living();
    notes.push(`against a living stack, ${onLiving.map((k) => ON_LIVING[k]).join(", ")}`);
  }
  // A hated creature opposite (the first one there is).
  for (const key of sub("HATE")) {
    const h = creatures.find((x) => x.key === key);
    if (!h) continue;
    enemy = [foe(c, n, creatures, h.id)];
    notes.push(`they hit ${h.plural} harder`);
    break;
  }
  // A breath: the enemy two deep, a stack straight behind the one struck.
  const breath = has("TWO_HEX_ATTACK_BREATH");
  if (breath) {
    enemy = three(foe(c, n, creatures));
  } else if (["THREE_HEADED_ATTACK", "ATTACKS_ALL_ADJACENT", "MULTIHEX_UNIT_ATTACK"].some(has) || sub("SPELL_LIKE_ATTACK").includes("fireballAbility")) {
    enemy = three(foe(c, n, creatures));
    tight = true;
    notes.push("the enemy stands packed: the attack reaches the neighbour");
  }
  if (sub("SPELL_LIKE_ATTACK").includes("deathCloud")) {
    const f = three(foe(c, n, creatures));
    enemy = [f[0], { creature: SKELETON, count: 40 }, f[1]];
    tight = true;
    notes.push("living and undead side by side: the cloud hurts only the living");
  }
  // (Attackers a Fangarm can't hypnotize: Skeletons, mindless.)
  if (has("ADDITIONAL_RETALIATION") || has("UNLIMITED_RETALIATIONS")) {
    enemy = three(foe(c, n, creatures));
    // (A Fangarm's attackers: two it can't hypnotize, Skeletons, and one living stack it can.)
    if (sub("SPELL_AFTER_ATTACK").includes("hypnotize")) enemy = [...three(foe(c, n, creatures, SKELETON)).slice(0, 2), enemy[2]];
    notes.push("three stacks attack them: they strike back at more than one");
  }
  if (has("RANGED_RETALIATION") || has("FIRST_STRIKE")) (enemy = [foe(c, n, creatures, ARCHER)]), notes.push("shoot at them: they shoot back first");
  if (has("CHARGE_IMMUNITY")) (enemy = [foe(c, n, creatures, CAVALIER)]), notes.push("the charging Cavaliers get no bonus against them");
  if (has("REBIRTH")) (own[0].count = 3), (enemy = three({ creature: TITAN, count: 12 })), (tight = !breath), notes.push("the Titans strike them down: they rise again from the ashes");
  if (sub("SPELLCASTER").some((k) => k.startsWith("detonates"))) (own[0].count = 3), (enemy = three(foe(c, 20, creatures))), (tight = true), notes.push("they fall among the enemy and detonate");
  if (has("HP_REGENERATION")) notes.push("wounds close at the start of their turn");
  if (has("MANA_DRAIN")) notes.push("your hero's spell points drain each round");
  // An aura of bad morale shows on a mixed army (one town's troops have +1 of their own).
  if (c.abilities.some((a) => a.type === "MORALE" && (a.val ?? 0) < 0)) {
    const f = foe(c, n, creatures);
    enemy = [{ creature: f.creature, count: Math.round(f.count / 2) }, { creature: CENTAUR, count: Math.round(f.count / 2) }];
    notes.push("a mixed enemy army loses morale beside them");
  } else if (has("MORALE") || has("LUCK")) notes.push("watch for morale and luck");
  // Spellcasters with an ally to cast on, or something to bring back.
  const casts = sub("SPELLCASTER").filter((k) => !k.startsWith("detonates")).concat(sub("ADJACENT_SPELLCASTER"));
  if (casts.includes("resurrection")) own.push({ creature: PIKEMAN, count: 100 }), living(), notes.push("the Pikemen fall and are resurrected");
  else if (casts.includes("summonDemons")) own.push({ creature: IMP, count: 60 }), living(), notes.push("fallen Imps rise as Demons");
  else if (casts.includes("hotaRepair")) own.push({ creature: AUTOMATON, count: 10 }), living(), notes.push("the damaged Automatons are repaired");
  else if (casts.includes("summonLarva")) own.push({ creature: PIKEMAN, count: 1 }), living(), notes.push("a fallen stack devoured for a bonus strike");
  else if (casts.includes("teleport")) own.push({ creature: PIKEMAN, count: 30 }), notes.push("they teleport the Pikemen beside them");
  else if (casts.length || has("RANDOM_SPELLCASTER")) own.push({ creature: PIKEMAN, count: 30 }), notes.push("they cast on the Pikemen beside them");
  // Immunities and weaknesses: the player's hero has the spell that shows them.
  if (has("MIND_IMMUNITY") || has("NON_LIVING")) target(SPELL.BLIND), notes.push("cast Blind at them: it can't take them");
  if (has("UNDEAD")) target(SPELL.DESTROY_UNDEAD, SPELL.DEATH_RIPPLE), notes.push("cast Death Ripple and Destroy Undead: the first spares them, the second hurts them");
  if (has("LEVEL_SPELL_IMMUNITY")) target(SPELL.MAGIC_ARROW), notes.push("cast Magic Arrow at them: it can't touch them");
  if (sub("SPELL_SCHOOL_IMMUNITY").includes("fire")) target(SPELL.FIREBALL), notes.push("cast Fireball at them: it can't touch them");
  if (has("SPELL_DAMAGE_REDUCTION")) {
    const aura = c.abilities.some((a) => a.type === "SPELL_DAMAGE_REDUCTION" && (a.val ?? 0) < 0);
    target(SPELL.MAGIC_ARROW), notes.push(aura ? "cast Magic Arrow at an enemy beside them: it does a fifth more than its usual damage" : "cast Magic Arrow at them: it does less than its usual damage");
  }
  /** The creature stands on both sides (a spell both heroes and creatures cast). */
  let both = false;
  for (const key of sub("SPELL_IMMUNITY")) {
    const id = spellByKey(key, spells);
    // A spell both heroes and creatures cast (Blind, the Unicorns'): the creature on both sides, its
    // casters beside the computer's stack. The player's stack (large, so it lasts) takes their blows,
    // and the player's hero casts at the computer's: neither takes.
    const caster = creatures.find((x) => x.abilities.some((a) => a.type === "SPELL_AFTER_ATTACK" && a.subtype === key));
    if (id !== undefined && caster) {
      target(id);
      both = true;
      enemy = [{ creature: c.id, count: n * 5 }];
      own.push(...[0, 1, 2, 3].map(() => ({ creature: caster.id, count: 4 })));
      tight = true;
      notes.push(`your large stack of ${c.plural} takes the blows of four stacks of ${caster.plural} and their ${spellWord(key, spells)} never takes; your hero's ${spellWord(key, spells)} can't take the computer's ${c.plural} either`);
      continue;
    }
    if (id !== undefined) target(id);
    else {
      // A creature's spell (a Medusa's gaze): its caster opposite, whose blows never take.
      // (With the creature on both sides already, the caster joins the player's stack.)
      if (caster) (enemy = both ? [...enemy, foe(c, n, creatures, caster.id)] : [foe(c, n, creatures, caster.id)]), notes.push(`${caster.plural}' ${spellWord(key, spells)} never takes on ${both ? "the computer's" : "them"}`);
    }
  }
  for (const key of sub("MORE_DAMAGE_FROM_SPELL")) {
    const id = spellByKey(key, spells);
    if (id !== undefined) target(id);
    // A Fire Shield opposite (an Efreet Sultan): its burn hurts them twice as much.
    const shield = key === "fireShield" ? creatures.find((x) => x.abilities.some((a) => a.type === "FIRE_SHIELD")) : undefined;
    if (shield) enemy.push(foe(c, n, creatures, shield.id)), notes.push(`${shield.plural}' Fire Shield burns them twice as hard`);
  }
  if (has("MAGIC_RESISTANCE")) target(SPELL.SLOW), notes.push("cast Slow at them: it sometimes fails");
  if (has("MAGIC_MIRROR")) target(SPELL.MAGIC_ARROW), notes.push("cast Magic Arrow at them: it sometimes bounces back at your own troops");
  if (has("KING")) target(SPELL.SLAYER), (skills = [["fireMagic", 3]]), notes.push("Slayer (Expert Fire Magic) on your stack: it hits them harder");
  // (Three stacks packed stand in rows 4, 5 and 6: the Pikemen in the middle touch the Unicorns.)
  if (has("SPELL_RESISTANCE_AURA")) own.push({ creature: PIKEMAN, count: 30 }, { creature: PIKEMAN, count: 30 }), (tight = true), (rightSpells = [SPELL.SLOW]), notes.push("the enemy's Slow sometimes fails on the Pikemen beside them");
  if (has("CHANGES_SPELL_COST_FOR_ALLY")) book.push(SPELL.MAGIC_ARROW), notes.push("your spells cost less");
  if (has("CHANGES_SPELL_COST_FOR_ENEMY")) target(SPELL.MAGIC_ARROW), notes.push("your spells cost more");
  if (has("CATAPULT") || has("NO_WALL_PENALTY")) (siege = "castle"), living(), notes.push(has("CATAPULT") ? "they hurl stones at the walls" : "the walls don't weaken their shots");
  // High spells need Wisdom.
  if (book.some((id) => (spells[id]?.level ?? 1) >= 3)) skills = [...(skills ?? []), ["wisdom", 3]];
  // Both sides (the owner, 11-03): the creature on each, beside the stacks that show it, so the player uses
  // its abilities, strikes and casts at the computer's, and is struck by it. (The Troglodytes' kind,
  // `both` above, is so already: a big stack of the player's, the casters and one stack opposite.)
  let r: BattleRecipe;
  if (both) r = { left: enemy, right: own, what: "" };
  else {
    const others = [...enemy.filter((s) => s.creature !== c.id), ...own.slice(1)];
    // (Against its own kind only: a plain living stack on each side as well, to strike and be struck.)
    if (!others.length) others.push(foe(c, n, creatures));
    const self = { creature: c.id, count: own[0].count };
    // (Two deep, for a breath: the others in pairs, the creature behind the last of them.)
    const side = () => [...(breath ? [...others, self] : [self, ...others])].slice(0, 7).map((s) => ({ ...s }));
    r = { left: side(), right: side(), what: "" };
  }
  if (book.length) r.spells = book;
  // The computer's hero has the player's spells too: it casts them at the player's stack of the creature.
  const right = [...new Set([...(rightSpells ?? []), ...book])];
  if (right.length) r.rightSpells = right;
  if (tight) r.tight = true;
  // (The breath's targets: both sides two deep.)
  if (breath) r.deep = "both";
  // A caster's hero: the spells last ten rounds, and mana for each of them.
  if (book.length) (r.power = 10), (r.knowledge = 10);
  if (siege) r.siege = siege;
  if (skills) r.skills = skills;
  // (Said first: what a breath recipe is for.)
  if (breath) notes.unshift("both armies stand two deep: strike a front stack from straight in front (the same row) and the breath burns the one behind it too; theirs breathe through yours the same way");
  const lead = both ? `${c.plural} on both sides` : `${c.plural} on both sides: use yours, strike and cast at the computer's, and watch theirs strike you`;
  r.what = notes.length ? `${lead}; ${notes.join("; ")}.` : `${lead}; they fight as the plain stack they are.`;
  return r;
}

/** The battle page's address for a recipe (`?left=&right=&spells=&rspells=&tight=1&siege=&skills=&new=1#battle`). */
export function recipeLink(r: BattleRecipe, skills?: [string, number][]): string {
  const stacks = (list: Stack[]) => list.map((s) => `${s.creature}:${s.count}`).join(",");
  const params: Record<string, string> = { left: stacks(r.left), right: stacks(r.right), new: "1" };
  if (r.spells?.length) params.spells = r.spells.join(",");
  // The computer's caster gets the points for several casts (a hero starts at its maximum, 10 per Knowledge).
  if (r.rightSpells?.length) (params.rspells = r.rightSpells.join(",")), (params.rknow = String(r.knowledge ?? 5));
  // (The computer's hero is the player's equal: the same Spell Power and skills.)
  if (r.rightSpells?.length && r.power) params.rpower = String(r.power);
  if (r.tight) params.tight = "1";
  if (r.deep) params.deep = r.deep;
  if (r.power) params.power = String(r.power);
  if (r.knowledge) params.know = String(r.knowledge);
  if (r.siege) params.siege = r.siege;
  const all = [...(r.skills ?? []), ...(skills ?? [])];
  if (all.length) params.skills = all.map(([k, l]) => `${k}:${l}`).join(",");
  if (r.skills?.length) params.rskills = r.skills.map(([k, l]) => `${k}:${l}`).join(",");
  // What the battle shows: the battle page says it as it opens.
  if (r.what) params.what = r.what;
  return `?${new URLSearchParams(params).toString()}#battle`;
}
