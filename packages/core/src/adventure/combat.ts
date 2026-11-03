// Fights on the adventure map: the heroes and armies sent into battle, sieges, and what a
// finished battle leaves behind (experience, necromancy, captured towns, fallen heroes).
import { type SiegeSetup } from "../battle/siege.ts";
import { feelsMorale } from "../creatures.ts";
import { skillFactor, withLearning } from "../specialty.ts";
import { SPECIAL, hasSpecial, necromancyBoost, siegeBonuses, startingRunes } from "./townSpecials.ts";
import { createBattle, type BankLayout, type BattleState } from "../battle/state.ts";
import { BATTLEFIELDS } from "../battle/fields.ts";
import { battleExperience, gainRunes, oblivion, startBattle } from "../battle/rules.ts";
import { HERO_CLASSES, HERO_INFO, HERO_PORTRAITS } from "../heroData.ts";
import { randInt } from "../rng.ts";
import { tavernReturn } from "./create.ts";
import { BANKS } from "../bankData.ts";
import { checkGameEnd } from "./conditions.ts";
import { MAX_LEVEL, experienceForLevel } from "./experience.ts";
import { mapData } from "./objects.ts";
import { ARTIFACT_INFO } from "../artifactData.ts";
import { bonusArtifacts, disassemble, MACHINE_CREATURE, MACHINE_SLOT, battleBonuses, bonus, effectivePrimary, enemyBonus, giveArtifact, hasBonus, heroMachines, heroSpells, capsAtZero, wornArtifacts } from "./artifacts.ts";
import { maxMana } from "./magic.ts";
import { refreshMovement } from "./movement.ts";
import type { SpellInfo } from "../spells.ts";
import { LEVEL_NAMES, NECROMANCY, SKILLS, SKILL_NAMES, aiSkillChoice, learnSkill, levelUpOffer, skillLevel } from "../skills.ts";
import { type AdventureState, type AdvObject, type ArmySlot, type Hero, Obj, type TextRef } from "./types.ts";
import { Terrain, type World } from "./world.ts";
import { B, dwellingId, dwellingLevel, fortLevel, levelCount, townInfo, garrisonHero } from "./town.ts";
import { type AdventureEvent, abandonedMine, addToArmy, bankReward, passIfOut, week } from "./rules.ts";
import { captureObject, claimDwelling, monsterReward, openBox, splitMonster } from "./visit.ts";
import { afterScriptBattle } from "./scripts.ts";
import { isCampaignYog } from "./campaign.ts";

let spellTable: SpellInfo[] = [];

/**
 * The Lightning Rod's damage for this player (0 without one): 35 + 7 per building of its Factory
 * town, upgrades not counted on their own (a hall, fort or guild counts once, upgraded dwellings
 * not at all), at most 168 (heroes.thelazy.net).
 */
export function lightningRodDamage(s: AdventureState, player: number): number {
  let best = 0;
  for (const o of s.objects) {
    if (!o.town || o.removed || o.owner !== player || townInfo(o)?.faction !== "factory" || !o.town.built.includes(B.GRAIL)) continue;
    const kinds = new Set(
      o.town.built
        .filter((b) => !dwellingLevel(b)?.upgraded)
        .map((b) => (b >= B.VILLAGE_HALL && b <= B.CAPITOL ? "hall" : b >= B.FORT && b <= B.CASTLE ? "fort" : b >= B.MAGE_GUILD_1 && b <= B.MAGE_GUILD_1 + 4 ? "guild" : String(b))),
    );
    best = Math.max(best, Math.min(168, 35 + 7 * kinds.size));
  }
  return best;
}

/** Factions whose Grail structure this player has built (each town's has its own extra). */
export function grailsOf(s: AdventureState, player: number): Set<string> {
  const out = new Set<string>();
  for (const o of s.objects) if (o.town && !o.removed && o.owner === player && o.town.built.includes(B.GRAIL)) out.add(townInfo(o)?.faction ?? "");
  return out;
}

/** One line of the hero screen's morale or luck explanation: an ARRAYTXT line ("\nExpert Leadership +3"), or an artifact or building and its value. */
export interface MoraleLuckPart {
  id?: number;
  args?: (string | number)[];
  name?: string;
  val: number;
}

/**
 * Morale and luck as the hero screen shows them, by the same rules as in battle: the army's mix of
 * towns (+1 for one town, -1 per town past two; neutrals each their own), undead (-1), Angels' aura,
 * Leadership / Luck, artifacts, visited places and the Grail structures. -3..+3, with the
 * modifiers the right-click text lists (ARRAYTXT's "Current Morale Modifiers").
 */
export function heroMoraleLuckParts(s: AdventureState, w: World, h: Hero): { morale: number; luck: number; moraleParts: MoraleLuckPart[]; luckParts: MoraleLuckPart[] } {
  const b = battleHero(h, s);
  const army = h.army.flatMap((a) => (a ? [w.creatures[a.creature]] : [])).filter((c) => !!c);
  const has = (c: (typeof army)[number], t: string) => c.abilities.some((a) => a.type === t);
  const towns = new Set(army.map((c) => (c.faction === "neutral" ? `n${c.key}` : c.faction)));
  const moraleParts: MoraleLuckPart[] = [];
  const luckParts: MoraleLuckPart[] = [];
  const evil = ["inferno", "necropolis", "dungeon"];
  const united = b.unitedArmy === "all" || (b.unitedArmy === "nonEvil" && !army.some((c) => evil.includes(c.faction)));
  if (towns.size === 1) moraleParts.push({ id: 115, val: 1 });
  else if (towns.size >= 3 && !united) moraleParts.push({ id: 114, args: [towns.size, -(towns.size - 2)], val: -(towns.size - 2) });
  const aura = army.find((c) => (c.abilities.find((a) => a.type === "MORALE" && a.subtype !== "minimum")?.val ?? 0) > 0);
  if (aura) moraleParts.push({ id: 117, args: [aura.plural || aura.name], val: 1 });
  if (army.some((c) => has(c, "UNDEAD"))) moraleParts.push({ id: 116, val: -1 });
  const lead = skillLevel(h.skills, "leadership");
  if (lead) moraleParts.push({ id: 104 + lead, val: lead });
  const luckSkill = skillLevel(h.skills, "luck");
  if (luckSkill) luckParts.push({ id: 73 + luckSkill, val: luckSkill });
  // Artifacts by name (the original's list names a few of its own; every one is named the same way).
  // Two of a kind count once, as in battle (bonusArtifacts).
  for (const id of bonusArtifacts(h))
    for (const bn of ARTIFACT_INFO[id]?.bonuses ?? []) {
      if (bn.limiters?.length || !bn.val || (bn.type !== "MORALE" && bn.type !== "LUCK")) continue;
      (bn.type === "MORALE" ? moraleParts : luckParts).push({ name: w.data.artifacts?.[id]?.name ?? "", val: bn.val });
    }
  const grails = grailsOf(s, h.owner);
  if (grails.has("castle")) moraleParts.push({ name: w.data.townTexts?.names[0]?.[B.GRAIL] || "Colossus", val: 2 });
  if (grails.has("rampart")) luckParts.push({ name: w.data.townTexts?.names[1]?.[B.GRAIL] || "Spirit Guardian", val: 2 });
  // Places visited and other bonuses until the next battle.
  const tempMorale = (h.temp?.morale ?? 0) + (h.timed ?? []).filter((t) => t.active && t.type === "MORALE").reduce((a, t) => a + (t.val ?? 0), 0);
  const tempLuck = (h.temp?.luck ?? 0) + (h.timed ?? []).filter((t) => t.active && t.type === "LUCK").reduce((a, t) => a + (t.val ?? 0), 0);
  if (tempMorale) moraleParts.push({ id: tempMorale > 0 ? 110 : 109, args: [Math.abs(tempMorale)], val: tempMorale });
  if (tempLuck) luckParts.push({ id: tempLuck > 0 ? 79 : 78, args: [Math.abs(tempLuck)], val: tempLuck });
  let morale = moraleParts.reduce((a, p) => a + p.val, 0);
  let luck = luckParts.reduce((a, p) => a + p.val, 0);
  // The Spirit of Oppression and the Hourglass of the Evil Hour: never above 0.
  const capper = (type: string) => wornArtifacts(h).find((id) => ARTIFACT_INFO[id]?.bonuses?.some((bn) => bn.type === type && bn.val === 0 && !bn.limiters?.length));
  if (b.noMorale) {
    morale = Math.min(morale, 0);
    moraleParts.push({ id: 119, args: [w.data.artifacts?.[capper("MORALE") ?? -1]?.name ?? ""], val: 0 });
  }
  if (b.noLuck) {
    luck = Math.min(luck, 0);
    luckParts.push({ id: 82, args: [w.data.artifacts?.[capper("LUCK") ?? -1]?.name ?? ""], val: 0 });
  }
  const clamp = (v: number) => Math.max(-3, Math.min(3, v));
  return { morale: clamp(morale), luck: clamp(luck), moraleParts, luckParts };
}

export function heroMoraleLuck(s: AdventureState, w: World, h: Hero): { morale: number; luck: number } {
  const { morale, luck } = heroMoraleLuckParts(s, w, h);
  return { morale, luck };
}

function battleHero(h: Hero, s?: AdventureState, bank = false) {
  // The Colossus (+2 morale) and Spirit Guardian (+2 luck) help all the owner's heroes.
  const grails = s ? grailsOf(s, h.owner) : new Set<string>();
  return {
    name: h.name,
    heroClass: h.heroClass,
    type: h.type,
    level: h.level,
    female: h.female ?? HERO_INFO[h.type]?.female ?? false,
    owner: h.owner,
    primary: effectivePrimary(h),
    portrait: h.portrait ?? (HERO_PORTRAITS[h.type] || undefined),
    // Tactics switched off on the hero screen, or a creature bank's fight (VCMI's creatureBank layouts): no placement phase.
    skills: h.skills?.filter(([id]) => !((h.noTactics || bank) && SKILLS[id] === "tactics")).map(([id, l]) => [id, l] as [number, number]),
    spells: heroSpells(h, spellTable),
    mana: h.mana ?? 0,
    maxMana: maxMana(h),
    // War machines stay out of creature-bank and shipwreck fights (HotA, heroes.thelazy.net).
    machines: bank ? [] : heroMachines(h),
    // (Left behind, they still help: the Ammo Cart's shots, the First Aid Tent's health; HotA, heroes.thelazy.net First Aid, Ammo Cart.)
    machinesAway: bank ? heroMachines(h) : undefined,
    bonuses: battleBonuses(h),
    morale: bonus(h, "MORALE") + (h.temp?.morale ?? 0) + (grails.has("castle") ? 2 : 0),
    luck: bonus(h, "LUCK") + (h.temp?.luck ?? 0) + (grails.has("rampart") ? 2 : 0),
    enemyMorale: enemyBonus(h, "MORALE"),
    // (The Angelic Alliance unites every army of its owner, as VCMI's PLAYER_PROPAGATOR and the HotA mod's text.)
    unitedArmy: (bonus(h, "NO_ALIGNMENT_PENALTY") ? "all" : hasBonus(h, "NONEVIL_ALIGNMENT_MIX") || (s?.heroes.some((x) => !x.removed && x.owner === h.owner && x.owner >= 0 && hasBonus(x, "NONEVIL_ALIGNMENT_MIX")) ?? false) ? "nonEvil" : undefined) as "all" | "nonEvil" | undefined,
    enemyLuck: enemyBonus(h, "LUCK"),
    enemySpellPower: enemyBonus(h, "PRIMARY_SKILL"),
    noMorale: capsAtZero(h, "MORALE"),
    noLuck: capsAtZero(h, "LUCK"),
    diplomat: wornArtifacts(h).includes(DIPLOMATS_CLOAK) || undefined,
  };
}

/** HotA's Diplomat's Cloak (the Statesman's Medal, Diplomat's Ring and Ambassador's Sash put together). */
const DIPLOMATS_CLOAK = 141;

const SKELETON = 56;

/** Necromancy: the winner raises Skeletons from the health of the enemies killed. */
export function raiseDead(s: AdventureState, w: World, h: Hero, b: BattleState, side: number): AdventureEvent[] {
  const level = skillLevel(h.skills, "necromancy");
  // The Ring of Oblivion leaves nothing to raise. The Cloak of the Undead King raises without the
  // skill too: its parts' 30% as Skeletons (the HotA mod's text).
  if ((!level && !hasBonus(h, "IMPROVED_NECROMANCY")) || oblivion(b)) return [];
  // The Cloak of the Undead King raises Walking Dead / Wights / Liches by Necromancy level.
  const raised = hasBonus(h, "IMPROVED_NECROMANCY") ? [SKELETON, 58, 60, 64][level] : SKELETON;
  const raisedHp = w.creatures[raised]?.hp ?? 6;
  // Every enemy killed counts (war machines too), each with its health up to the raised creature's:
  // 100 dragons at 50% raise 50 Skeletons, 100 Peasants 8 (heroes.thelazy.net Necromancy; HotA sums
  // the whole battle; VCMI's calculateNecromancy). At least one is raised. Not the summoned ones nor
  // clones: HotA 1.3.3 "Fixed a SoD bug with the ability to raise undead from summoned creatures".
  const fallen = b.units.filter((u) => u.side !== side && !u.summoned && !u.clone);
  const hp = fallen.reduce((a, u) => a + (u.initialCount - u.count) * Math.min(raisedHp, b.creatures[u.creature]?.hp ?? 0), 0);
  // Amulet of the Undertaker, Vampire's Cowl, Dead Man's Boots: +5 / 10 / 15%; the Soul Prison +20%.
  const prison = grailsOf(s, h.owner).has("necropolis") ? 0.2 : 0;
  const share = Math.min(1, NECROMANCY[level] * skillFactor(h, "necromancy") + prison + necromancyBoost(s, h.owner) + bonus(h, "UNDEAD_RAISE_PERCENTAGE") / 100);
  const n = hp > 0 && share > 0 ? Math.max(1, Math.floor((hp * share) / raisedHp)) : 0;
  if (n <= 0) return [];
  // The original's window after the battle: GENRLTXT 145 / 146 with the raised creatures.
  const raise = (id: number, count: number): AdventureEvent[] => {
    const c = w.creatures[id];
    const message = `${h.name} raises ${count} ${count === 1 ? (c?.name ?? "Skeleton") : (c?.plural ?? "Skeletons")}.`;
    s.log.push(message);
    const text: TextRef = count === 1 ? { file: "genrltxt", id: 146, args: [c?.name ?? "Skeleton"] } : { file: "genrltxt", id: 145, args: [count, c?.plural ?? "Skeletons"] };
    return [{ e: "visit", hero: h.id, object: -1, message, text, components: [{ kind: "creature", id, amount: count }] }];
  };
  if (addToArmy(h, raised, n)) return raise(raised, n);
  // No room, but upgraded ones in the army (Skeleton Warriors...): two thirds as many of those.
  const upgraded = raised + 1;
  const m = Math.floor((n * 2) / 3);
  if (m > 0 && h.army.some((x) => x?.creature === upgraded) && addToArmy(h, upgraded, m)) return raise(upgraded, m);
  return [];
}

const stacksOf = (army: (ArmySlot | null)[]) => army.filter((a) => a).map((a) => ({ creature: a!.creature, count: a!.count }));
const controllerOf = (s: AdventureState, color: number) => (s.players[color]?.controller === "human" ? "human" : "ai");

const TERRAIN_NAMES = ["dirt", "sand", "grass", "snow", "swamp", "rough", "subterra", "lava", "water", "rock", "highlands", "wasteland"];
/** The magic grounds (map objects laid over the terrain) and the battlefield each gives (VCMI's CGTerrainPatch). */
const SPECIAL_GROUND: Record<number, string> = {
  21: "cursed_ground", 46: "magic_plains", 222: "clover_field", 223: "cursed_ground", 224: "evil_fog",
  226: "fiery_fields", 227: "holy_ground", 228: "lucid_pools", 229: "magic_clouds", 230: "magic_plains", 231: "rocklands",
};
/** Their art's size in tiles by the def's last digit (avxcf0 6x4 ... avxcf7 2x5), the bottom-right tile at the object. */
/** HotA's overlay grounds (the mod's terrainOverlays), by their map pictures: the field and each picture's size. */
const OVERLAYS: [RegExp, string, [number, number][]][] = [
  [/^zice0([1-8])/i, "cracked_ice", [[6, 4], [8, 6], [6, 6], [8, 3], [3, 6], [3, 3], [5, 2], [2, 5]]],
  [/^zsand0([0-7])/i, "dunes", [[6, 4], [8, 6], [6, 6], [8, 3], [3, 6], [3, 3], [5, 2], [2, 5]]],
  [/^avxfld0([0-7])/i, "fields_of_glory", [[6, 4], [8, 6], [6, 6], [8, 3], [3, 5], [3, 3], [4, 2], [3, 6]]],
];
function overlayGround(def: string): { field: string; size: [number, number] } | undefined {
  for (const [re, field, sizes] of OVERLAYS) {
    const m = re.exec(def);
    if (m) return { field, size: sizes[Number(m[1]) - (field === "cracked_ice" ? 1 : 0)] };
  }
  return undefined;
}
const PATCH_SIZE: [number, number][] = [[6, 4], [8, 6], [6, 6], [8, 3], [3, 6], [3, 3], [5, 2], [2, 5]];

/**
 * The magic ground (or HotA overlay) laid over a tile, if any: its battlefield and the map object's
 * type (whose name is the ground's: "Cursed Ground"). Decorations, kept only in the map: they never change.
 */
export function groundPatch(w: World, at: { x: number; y: number; z: number }): { field: string; type: number } | undefined {
  for (const o of w.map.objects) {
    if (o.z !== at.z) continue;
    const def = w.map.templates[o.template]?.def ?? "";
    const overlay = overlayGround(def);
    const field = SPECIAL_GROUND[o.id] ?? overlay?.field;
    if (!field) continue;
    const [pw, ph] = overlay?.size ?? PATCH_SIZE[Number(/(\d)\.def$/i.exec(def)?.[1] ?? 0)] ?? PATCH_SIZE[0];
    if (at.x <= o.x && at.x > o.x - pw && at.y <= o.y && at.y > o.y - ph) return { field, type: o.id };
  }
  return undefined;
}

/**
 * Where a battle at (x, y, z) is fought, as VCMI's battleGetBattlefieldType: a magic ground covering
 * the tile gives its own field; a land tile by the water is the shore (sand); at sea the ship's
 * deck, or two ships side by side when both sides are heroes in boats; else one of the terrain's
 * fields (picked by `seed`). The terrain decides who fights on native ground.
 */
export function battleGround(s: AdventureState, w: World, at: { x: number; y: number; z: number }, seed: number, boats = false, object?: AdvObject): { field?: string; terrain?: string } {
  const i = w.index(at.x, at.y, at.z);
  const tile = w.map.tiles[i];
  if (!tile) return {};
  let terrain = TERRAIN_NAMES[tile.terrain];
  // An abandoned mine, a crystal cavern or a gold mine is fought underground, whatever lies around
  // it (VCMI; heroes.thelazy.net's Mine page).
  if (object?.type === Obj.ABANDONED_MINE || (object?.type === Obj.MINE && [4, 6, 7].includes(object.subid))) return { field: "subterranean", terrain: "subterra" };
  if (tile.terrain === Terrain.WATER) return { field: boats ? "ship_to_ship" : "ship", terrain };
  const patch = groundPatch(w, at);
  if (patch) return { field: patch.field, terrain };
  // A land tile beside water is always the shore.
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const j = w.index(at.x + dx, at.y + dy, at.z);
      if (j >= 0 && (dx || dy) && w.map.tiles[j]?.terrain === Terrain.WATER) return { field: "sand_shore", terrain };
    }
  // HotA's underground sand and lava have caves of their own; the others' fields serve both levels.
  const level = at.z ? "underground" : "surface";
  const all = BATTLEFIELDS.filter((f) => f.terrain === terrain && !f.impassable && (f.terrain === "rock" || !f.special));
  const own = all.filter((f) => f.layer === level);
  const fields = own.length ? own : all.filter((f) => !f.layer);
  return fields.length ? { field: fields[seed % fields.length].id, terrain } : { terrain };
}

/** Starts a battle of the hero against a defending side; the battle waits under the attacker's colour. */
export function fight(
  s: AdventureState,
  w: World,
  h: Hero,
  defender: { name: string; stacks: { creature: number; count: number }[]; owner?: number; hero?: Hero },
  object: number,
  defenderHero?: number,
  siege?: SiegeSetup,
  /** A creature bank's (or shipwreck's) guards: no war machines, no Tactics, no obstacles; the guards on the bank's hexes. */
  bank: boolean | BankLayout = false,
  /** The defenders hold this town (walled or not): its hero can't flee but through the Escape Tunnel. */
  town?: AdvObject,
): AdventureEvent[] {
  spellTable = w.data.spells ?? [];
  const seed = (s.rng = (s.rng * 1103515245 + 12345) >>> 0);
  const ground = battleGround(s, w, h, seed >>> 8, h.boat !== undefined && defender.hero?.boat !== undefined, s.objects.find((o) => o.id === object));
  const battle: BattleState = createBattle(
    {
      seed,
      ...ground,
      siege,
      town: town ? { escape: !!siege?.escape } : undefined,
      noObstacles: !!bank || undefined,
      rules: s.rules,
      bank: bank || undefined,
      // An Anti-magic Garrison (subtype 1 of both garrisons): no spells in its battle.
      noMagic: s.objects.some((o) => o.id === object && (o.type === 33 || o.type === 219) && o.subid === 1) || undefined,
      sides: [
        { name: h.name, controller: controllerOf(s, h.owner), owner: h.owner, stacks: stacksOf(h.army), hero: battleHero(h, s, !!bank), tight: h.tight, gold: s.players[h.owner]?.resources[6] },
        {
          name: defender.name,
          controller: defender.owner !== undefined && defender.owner >= 0 ? controllerOf(s, defender.owner) : "ai",
          owner: defender.owner !== undefined && defender.owner >= 0 ? defender.owner : undefined,
          stacks: defender.stacks,
          hero: defender.hero ? battleHero(defender.hero, s) : undefined,
          tight: defender.hero?.tight,
          gold: defender.owner !== undefined && defender.owner >= 0 ? s.players[defender.owner]?.resources[6] : undefined,
        },
      ],
    },
    w.creatures,
    w.data.spells,
  );
  // A town's Grail defends it: Guardian of Earth +12 power, Warlords' Monument +20 attack, Carnivorous Plant +10 attack and defense.
  const defended = siege && s.objects.find((o) => o.id === object && o.town);
  const guard = battle.sides[1].hero;
  if (defended) {
    // Brotherhood of the Sword, Fountain of Fortune, Blood Obelisk, Glyphs of Fear, Stormclouds, Mana Generator.
    const sb = siegeBonuses(defended);
    battle.sides[1].morale = (battle.sides[1].morale ?? 0) + sb.morale;
    battle.sides[1].luck = (battle.sides[1].luck ?? 0) + sb.luck;
    if (guard) {
      // The town's spell points stay in the town (heroes.thelazy.net: Mana Generator, Skyship).
      battle.townMana = { before: guard.mana ?? 0, refill: false };
      sb.primary.forEach((n, i) => (guard.primary[i] += n));
      guard.mana = (guard.mana ?? 0) + sb.mana;
    }
  }
  if (defended && guard && defended.town!.built.includes(B.GRAIL)) {
    const f = townInfo(defended)?.faction;
    if (f === "dungeon") guard.primary[2] += 12;
    if (f === "stronghold") guard.primary[0] += 20;
    if (f === "fortress") (guard.primary[0] += 10), (guard.primary[1] += 10);
    // Skyship (Tower): +150 spell points, and the hero's own refilled after the battle.
    if (f === "tower") (guard.mana = (guard.mana ?? 0) + 150), battle.townMana && (battle.townMana.refill = true);
    // Spirits of the Forebears (Bulwark): +20 Defense for the defending hero (heroes.thelazy.net).
    if (f === "bulwark") guard.primary[1] += 20;
  }
  // The Lodestar (Cove Grail) of either side: native ground everywhere for Cove creatures, both sides' (heroes.thelazy.net).
  if (battle.sides.some((side) => side.owner !== undefined && grailsOf(s, side.owner).has("cove"))) battle.lodestar = true;
  // The Lightning Rod (Factory Grail) fights in all its owner's battles.
  for (const side of battle.sides) {
    const rod = side.owner !== undefined ? lightningRodDamage(s, side.owner) : 0;
    if (rod) side.lightningRod = rod;
  }
  // Altar of the Runes (Bulwark): a Rune Level for the player's units at the start.
  for (const u of battle.units) {
    const owner = battle.sides[u.side].owner;
    if (owner !== undefined && startingRunes(s, owner) && !u.machine) gainRunes(battle, u, startingRunes(s, owner));
  }
  startBattle(battle);
  s.battles[h.owner] = { hero: h.id, object, defender: defenderHero, battle };
  return [{ e: "battle", hero: h.id, object }];
}

/** A bank's guards fight on its own formation; the ordinary ones (the Black Tower, the Pyramid...) as monsters. */
function bankLayout(o: AdvObject): boolean | BankLayout {
  const def = BANKS[`${o.type}:${o.subid}`];
  return !!o.bank && !def?.ordinary && (def?.layout ?? true);
}

export function startFight(s: AdventureState, w: World, h: Hero, o: AdvObject, guards?: ArmySlot[], guardName = "Wandering monsters"): AdventureEvent[] {
  s.log.push(guards ? `${h.name} attacks the ${guardName}!` : `${h.name} attacks the monsters!`);
  return fight(s, w, h, { name: guardName, stacks: guards ? guards.map((g) => ({ ...g })) : splitMonster(s, w, h, o) }, o.id, undefined, undefined, bankLayout(o));
}

/** Attacks another player's hero (in a town gate: with the garrison behind the walls, or outside when the town has its own hero). */
export function attackHero(s: AdventureState, w: World, h: Hero, other: Hero): AdventureEvent[] {
  // Heroes resting at a Sanctuary can't be attacked.
  if (s.objects.some((o) => o.type === 80 && !o.removed && w.visitBy[w.index(other.x, other.y, other.z)] === o.id + 1)) {
    return [{ e: "visit", hero: h.id, object: -1, message: `${other.name} is under the protection of the Sanctuary.` }];
  }
  s.log.push(`${h.name} attacks ${other.name}!`);
  const town = s.objects.find((o) => o.town && !o.removed && o.owner === other.owner && w.visitBy[w.index(other.x, other.y, other.z)] === o.id + 1);
  // As the original (VCMI's isBattleOutsideTown): with a garrison hero too, the visiting hero meets
  // the attacker outside the walls, and the garrison hero defends the siege afterwards.
  if (!town || garrisonHero(s, town)) return fight(s, w, h, { name: other.name, stacks: stacksOf(other.army), owner: other.owner, hero: other }, -1, other.id);
  // Alone, the visiting hero defends the town from behind its walls with the garrison's troops
  // joined to the army where they fit (VCMI's mergeGarrisonOnSiege): one battle for the town.
  const t = town.town!;
  t.garrison = t.garrison.map((a) => (a && addToArmy(other, a.creature, a.count) ? null : a));
  const all = t.garrison.every((a) => !a);
  return fight(s, w, h, { name: other.name, stacks: stacksOf(other.army), owner: other.owner, hero: other }, all ? town.id : -1, other.id, siegeOf(town), false, town);
}

/** Attacks a town's garrison: behind walls, towers and a moat once the town has a fort. */
export function siege(s: AdventureState, w: World, h: Hero, o: AdvObject): AdventureEvent[] {
  s.log.push(`${h.name} lays siege to ${o.name ?? "the town"}!`);
  // A garrison hero defends the town with their army, behind its walls.
  const g = garrisonHero(s, o);
  if (g) return fight(s, w, h, { name: g.name, stacks: stacksOf(g.army), owner: o.owner, hero: g }, o.id, g.id, siegeOf(o), false, o);
  return fight(s, w, h, { name: `${o.name ?? "Town"} garrison`, stacks: stacksOf(o.town!.garrison), owner: o.owner }, o.id, undefined, siegeOf(o), false, o);
}

/** The town's fortifications for a siege battle (none without a fort). */
export function siegeOf(o: AdvObject): SiegeSetup | undefined {
  const built = o.town?.built ?? [];
  const level = fortLevel(built);
  if (!level) return undefined;
  // Structures (heroes.thelazy.net/index.php/Arrow_Tower): the hall, a mage guild, the tavern,
  // blacksmith, marketplace, silo, Grail and shipyard, each level's dwelling, and the town's own
  // buildings that aren't an upgrade of another (Brotherhood of the Sword, Fountain of Fortune...),
  // with the Conflux's Vault of Ashes; no upgrades of the hall, guild, fort or dwellings, no hordes.
  const one = [B.VILLAGE_HALL, B.MAGE_GUILD_1, B.TAVERN, B.BLACKSMITH, B.MARKETPLACE, B.RESOURCE_SILO, B.GRAIL, B.SHIPYARD];
  let structures = one.filter((b) => built.includes(b)).length;
  for (let l = 0; l < levelCount(o); l++) if (built.includes(dwellingId(l))) structures++;
  const own = townInfo(o)?.buildings as Record<number, { upgrades?: number | null } | undefined> | undefined;
  for (const b of [SPECIAL.s1, SPECIAL.s2, SPECIAL.s3, SPECIAL.s4]) if (built.includes(b) && own?.[b] && own[b]!.upgrades == null) structures++;
  if (townInfo(o)?.faction === "conflux" && built.includes(B.HORDE_2)) structures++;
  return { faction: townInfo(o)?.faction ?? "castle", level, structures, escape: hasSpecial(o, "stronghold", SPECIAL.s1) || undefined };
}

/**
 * Adds experience (+Learning); each level raises a primary skill by the class's
 * odds and offers two secondary skills (the AI picks at once, players choose).
 */
export function gainExperience(s: AdventureState, w: World, h: Hero, xp: number, avoid?: number): string[] {
  // The map may cap hero levels (experience stops at the cap); HotA's own cap is level 74 (heroes.thelazy.net, Experience).
  const cap = Math.min(MAX_LEVEL, w.map.levelLimit > 0 ? w.map.levelLimit : MAX_LEVEL);
  h.experience = Math.min(h.experience + withLearning(h, xp), Math.max(h.experience, experienceForLevel(cap)));
  const notes: string[] = [];
  while (h.level < cap && h.experience >= experienceForLevel(h.level + 1)) {
    h.level++;
    const odds = w.data.classLevelOdds[h.heroClass] ?? { low: [25, 25, 25, 25], high: [25, 25, 25, 25] };
    // (Yog in his campaign: Attack or Defense only, by their odds.)
    const table = (h.level < 10 ? odds.low : odds.high).map((n, i) => (i < 2 || !isCampaignYog(s, h) ? n : 0));
    let roll = randInt(s, 1, table.reduce((a, b) => a + b, 0));
    let skill = 0;
    while (skill < 3 && roll > table[skill]) roll -= table[skill++];
    h.primary[skill]++;
    notes.push(`${h.name} reaches level ${h.level}: +1 ${["Attack", "Defense", "Power", "Knowledge"][skill]}.`);
    // The counters before the first offer still waiting, so refreshLevelUps can draw those offers again.
    if (!h.levelUps?.length) h.pendingSince = [h.sinceWisdom ?? 0, h.sinceSchool ?? 0];
    const offer = skillOffer(s, w, h, avoid);
    if (!offer.length) continue;
    if (s.players[h.owner]?.controller === "human") {
      (h.levelUps ??= []).push(offer);
      (h.levelUpPrimary ??= []).push(skill);
    }
    else notes.push(...chooseSkill(s, w, h, offer, aiSkillChoice(offer, (key) => skillUse(w, h, key))));
  }
  s.log.push(...notes);
  return notes;
}

/**
 * A level-up's two skills, drawn from the hero's own random sequence (HotA: each hero's is fixed at
 * the scenario's start, so the order heroes level in doesn't change what they're offered).
 */
function skillOffer(s: AdventureState, w: World, h: Hero, avoid?: number): [number, number][] {
  h.skillRng ??= (Math.imul((s.id ^ 0x9e3779b9) >>> 0, 2654435761) + Math.imul(h.id + 1, 40503)) >>> 0;
  const rng = { rng: h.skillRng };
  // Even classes are might, odd ones magic (the HotA classes too: Captain, Navigator, Mercenary, Artificer...).
  const magic = (HERO_CLASSES[h.heroClass]?.affinity ?? (h.heroClass % 2 ? "magic" : "might")) === "magic";
  const offer = levelUpOffer(rng, h, w.data.classSkillOdds?.[h.heroClass] ?? [], s.banned?.skills, avoid, magic);
  h.skillRng = rng.rng;
  return offer;
}

/**
 * A player's pick made: the level-ups still waiting are offered afresh from the skills the hero has
 * now (they were drawn all at once, so three levels could offer Basic -> Advanced X three times).
 */
export function refreshLevelUps(s: AdventureState, w: World, h: Hero) {
  if (!h.levelUps?.length) return;
  const primary = h.levelUpPrimary ?? [];
  const ups: [number, number][][] = [];
  const prim: number[] = [];
  if (h.pendingSince) [h.sinceWisdom, h.sinceSchool] = h.pendingSince;
  h.levelUps.forEach((_, i) => {
    const offer = skillOffer(s, w, h);
    if (offer.length) ups.push(offer), prim.push(primary[i] ?? 0);
  });
  h.levelUps = ups;
  h.levelUpPrimary = prim;
}

/**
 * A hero the map gave more experience than its level: the levels it missed, each skill picked as the
 * AI would, quietly (VCMI's levelUpAutomatically).
 */
export function catchUpLevels(s: AdventureState, w: World, h: Hero) {
  if (h.experience < experienceForLevel(h.level + 1)) return;
  const p = s.players[h.owner];
  const controller = p?.controller;
  if (p) p.controller = "ai";
  const log = s.log.length;
  gainExperience(s, w, h, 0);
  s.log.length = log;
  if (p && controller) p.controller = controller;
}

/** Learns one of the offered skills; HotA's Learning also grants a level right away. */
export function chooseSkill(s: AdventureState, w: World, h: Hero, offer: [number, number][], option: number): string[] {
  const [id, level] = offer[option] ?? offer[0];
  learnSkill(h, id, level);
  const note = `${h.name} learns ${LEVEL_NAMES[level]} ${SKILL_NAMES[id]}.`;
  if (SKILLS[id] !== "learning" || h.level >= Math.min(MAX_LEVEL, w.map.levelLimit > 0 ? w.map.levelLimit : MAX_LEVEL)) return [note];
  const missing = experienceForLevel(h.level + 1) - h.experience;
  h.experience += Math.max(0, missing);
  // (That level's offer leaves Learning out: HotA 1.7.3, heroes.thelazy.net Learning.)
  // (Its notes go back to the caller, which logs them: the log had "reaches level 7" twice.)
  const at = s.log.length;
  const more = gainExperience(s, w, h, 0, id);
  s.log.length = at;
  return [note, ...more];
}

/**
 * Surrender: the hero keeps what survived and pays the price the battle named (surrenderCost: half
 * the troops' gold, less Diplomacy and its artifacts) to the enemy's player (VCMI's endBattle); monsters
 * (a surrender with the Diplomat's Cloak) take nothing.
 */
function payToSurrender(s: AdventureState, h: Hero, b: BattleState, side: number) {
  h.army = applySurvivors(h.army, b, side);
  const cost = Math.min(b.fled?.cost ?? 0, s.players[h.owner].resources[6]);
  s.players[h.owner].resources[6] -= cost;
  const enemy = b.sides[1 - side].owner;
  if (enemy !== undefined && s.players[enemy]) s.players[enemy].resources[6] += cost;
  s.log.push(`${h.name} surrenders, and gains safe passage for ${cost} gold.`);
}

/** Survivors of one battle side go back into the army slots they came from, in order. */
function applySurvivors(army: (ArmySlot | null)[], b: BattleState, side: number): (ArmySlot | null)[] {
  const units = b.units.filter((u) => u.side === side);
  let k = 0;
  const out = army.map((slot) => {
    if (!slot) return null;
    const u = units[k++];
    // (Less those Basic Resurrection lent for the battle.)
    const count = u ? u.count - (u.borrowed ?? 0) : 0;
    return count > 0 ? { creature: slot.creature, count } : null;
  });
  // Fangarms the Horn of the Abyss raised stay with the hero (with their own kind, else in a free slot).
  for (const u of units) {
    if (!u.raised || u.count <= 0) continue;
    const at = out.findIndex((x) => x?.creature === u.creature);
    const free = at >= 0 ? at : out.findIndex((x) => !x);
    if (free >= 0) out[free] = { creature: u.creature, count: (out[free]?.count ?? 0) + u.count };
  }
  return out;
}

/** Applies a finished battle (stored under `key`, the attacker's colour) back onto the map. */
/** What a beaten hero leaves: worn and carried artifacts, assembled sets taken apart into their parts (the spellbook stays). */
function lootOf(h: Hero): number[] {
  for (const slot of Object.keys(h.combos ?? {}).map(Number)) if (h.equipped?.[slot] === h.combos![slot].combo) disassemble(h, slot);
  // (Not the spellbook (0) nor the Catapult (3): they stay with the hero, as in VCMI.)
  return [...(h.equipped ?? []).filter((a) => a > 0 && a !== 3), ...(h.backpack ?? [])];
}

export function finishBattle(s: AdventureState, w: World, key: number): AdventureEvent[] {
  const pb = s.battles[key];
  if (!pb || pb.battle.winner === null) throw new Error("no finished battle");
  const b = pb.battle;
  const h = s.heroes[pb.hero];
  const o = pb.object >= 0 ? s.objects[pb.object] : undefined;
  const d = pb.defender !== undefined ? s.heroes[pb.defender] : undefined;
  const won = b.winner === 0;
  const extra: AdventureEvent[] = [];
  delete s.battles[key];
  // Destroyed war machines are gone.
  for (const [hero, side] of [[h, 0], [d, 1]] as const) {
    if (!hero) continue;
    for (const u of b.units) {
      // The catapult is only out for the rest of the battle.
      if (u.side !== side || !u.machine || u.machine === "catapult" || u.count > 0) continue;
      const art = Number(Object.entries(MACHINE_CREATURE).find(([, c]) => c === u.creature)?.[0] ?? -1);
      if (art >= 0 && hero.equipped?.[MACHINE_SLOT[art]] === art) hero.equipped[MACHINE_SLOT[art]] = -1;
    }
  }
  // Eagle Eye (HotA): each hero may learn the enemy's spells of levels 1-3 / 1-4 / 1-5 — any in the
  // enemy's book with 30 / 40 / 50%, any the enemy cast for certain. The enemy's Eagle Eye cancels levels.
  const eagleEye = (learner: Hero | undefined, enemy: Hero | undefined, enemySide: 0 | 1) => {
    if (!learner?.spells || !enemy || learner.removed) return;
    const eye = skillLevel(learner.skills, "eagleEye") - skillLevel(enemy.skills, "eagleEye");
    if (eye <= 0) return;
    const cast = new Set((b.castLog ?? [[], []])[enemySide]);
    for (const id of new Set([...(heroSpells(enemy, w.data.spells ?? []) ?? []), ...cast])) {
      const sp = w.data.spells?.[id];
      if (!sp || sp.level < 1 || learner.spells.includes(id) || sp.level > eye + 2) continue;
      // Eagle Eye specialists: the chance 5% better per hero level.
      if (!cast.has(id) && randInt(s, 1, 100) > (20 + 10 * eye) * skillFactor(learner, "eagleEye") + bonus(learner, "LEARN_BATTLE_SPELL_CHANCE")) continue;
      learner.spells.push(id);
      s.log.push(`${learner.name}'s Eagle Eye learns ${sp.name}.`);
    }
  };
  eagleEye(h, d, 1);
  eagleEye(d, h, 0);
  // Spell points spent in battle stay spent; bonuses "until the next battle" are used up.
  h.mana = b.sides[0].hero?.mana ?? h.mana;
  if (d) d.mana = b.sides[1].hero?.mana ?? d.mana;
  // The town's spell points don't leave with the hero (spent from them first); the Skyship refills the rest.
  if (d && b.townMana) d.mana = b.townMana.refill ? b.townMana.before : Math.min(d.mana ?? 0, b.townMana.before);
  delete h.temp;
  if (d) delete d.temp;
  if (won) {
    h.army = applySurvivors(h.army, b, 0);
    // (500 more for a beaten hero or a taken town, none for one who fled or surrendered.)
    const xp = battleExperience(b, 0);
    s.log.push(`${h.name} is victorious and gains ${xp} experience.`);
    if (d) {
      d.removed = true;
      if (d.boat !== undefined) s.objects[d.boat].removed = true;
      if (b.fled?.side === 1) {
        // Retreated or surrendered: the hero waits in the tavern with skills and artifacts.
        d.retired = true;
        if (b.fled.surrender) payToSurrender(s, d, b, 1);
        else d.army = d.army.map(() => null);
        tavernReturn(s, d.owner, d.type, b.fled.surrender ? "surrendered" : "retreated", true, w.data.classTavernOdds);
      } else {
        // The loser's artifacts go to the winner (the spellbook stays behind).
        for (const a of lootOf(d)) giveArtifact(h, w.data.artifacts, a);
      }
      s.log.push(`${d.name} has been defeated.`);
      delete d.garrison;
      // The garrison hero fell: the town is taken.
      if (o?.town) extra.push(...captureObject(s, w, h, o));
    } else if (o?.town) {
      o.town.garrison = o.town.garrison.map(() => null);
      extra.push(...captureObject(s, w, h, o));
    } else if (o?.dwelling) {
      o.dwelling.clearedWeek = week(s);
      extra.push(...claimDwelling(s, w, h, o));
    } else if (o && (o.type === 33 || o.type === 219 || ((o.type === Obj.MINE || o.type === 220) && o.army?.some(Boolean) && !abandonedMine(s, w, o)))) {
      // A conquered garrison (or a mine's troops) changes hands, empty.
      o.army = o.army?.map(() => null);
      extra.push(...captureObject(s, w, h, o));
    } else if (o && abandonedMine(s, w, o)) {
      abandonedMine(s, w, o)!.cleared = true;
      extra.push(...captureObject(s, w, h, o));
    } else if (o && (o.type === Obj.PANDORAS_BOX || o.type === Obj.EVENT)) {
      (o.data ??= {}).cleared = true;
      extra.push(...openBox(s, w, h, o, mapData(w, o), true));
    } else if (o?.bank) {
      o.bank.cleared = true;
      o.bank.guards = [];
      const loot = bankReward(s, w, h, o);
      const def = BANKS[`${o.type}:${o.subid}`];
      const bankName = def?.name ?? "bank";
      // ADVEVENT 34 names the strongest guards (VCMI's CBank: the highest fight value), in the plural.
      const strongest = b.units.filter((u) => u.side === 1 && !u.machine).map((u) => w.creatures[u.creature]).filter((c) => !!c).sort((x, y) => (y.fightValue ?? 0) - (x.fightValue ?? 0))[0];
      const msg = loot.text ? `${h.name} plunders the ${bankName}: ${loot.text}.` : `${h.name} finds nothing in the ${bankName}.`;
      s.log.push(msg);
      // The bank's own line: the Crypt, the ships, the Pyramid's glyph (and why a spell can't be learned), else the generic one.
      const some = loot.components.length > 0;
      const text: TextRef =
        o.type === 84 ? { file: "advevent", id: some ? 121 : 120 }
        : o.type === 24 ? { file: "advevent", id: some ? 43 : 42 }
        : o.type === 85 ? { file: "advevent", id: some ? 124 : 123 }
        : o.type === 63 && loot.spell ? { file: "advevent", id: 106, more: [`{${loot.spell.name}}.`, ...(loot.spell.why ? [{ file: "advevent" as const, id: loot.spell.why }] : [])] }
        : { file: "advevent", id: 34, args: [strongest?.plural ?? `${bankName} guards`, loot.text || "nothing"] };
      // HotA's banks with a line of their own (the Churchyard, the Ancient Altar) say it instead.
      extra.push({ e: "visit", hero: h.id, object: o.id, message: def?.won ?? msg, ...(def?.won ? {} : { text }), components: loot.components });
    } else if (o) {
      o.removed = true;
      if (o.type === Obj.MONSTER) extra.push(...monsterReward(s, w, h, o));
    }
    extra.push(...raiseDead(s, w, h, b, 0));
    gainExperience(s, w, h, xp);
  } else {
    h.removed = true;
    if (b.fled?.side === 0) {
      // Retreated or surrendered: the hero waits in the tavern, artifacts and skills intact.
      h.retired = true;
      if (b.fled.surrender) payToSurrender(s, h, b, 0);
      else h.army = h.army.map(() => null);
      tavernReturn(s, h.owner, h.type, b.fled.surrender ? "surrendered" : "retreated", false, w.data.classTavernOdds);
    }
    if (h.boat !== undefined) s.objects[h.boat].removed = true; // the boat goes down with them
    s.log.push(`${h.name} has been defeated.`);
    if (d) {
      d.army = applySurvivors(d.army, b, 1);
      if (!b.fled) for (const a of lootOf(h)) giveArtifact(d, w.data.artifacts, a);
      extra.push(...raiseDead(s, w, d, b, 1));
      gainExperience(s, w, d, battleExperience(b, 1));
    } else if (o?.town) o.town.garrison = applySurvivors(o.town.garrison, b, 1);
    else if (o?.army && (o.type === 33 || o.type === 219 || o.type === Obj.MINE || o.type === 220)) o.army = applySurvivors(o.army, b, 1);
    else if (o) {
      const left = b.units.filter((u) => u.side === 1 && u.count > 0);
      // (The Pyramid's golems all come back.)
      if (o.bank) {
        if (!BANKS[`${o.type}:${o.subid}`]?.replenish) o.bank.guards = left.map((u) => ({ creature: u.creature, count: u.count }));
      }
      else if (o.dwelling) o.dwelling.guardsLeft = { week: week(s), guards: left.map((u) => ({ creature: u.creature, count: u.count })) };
      else (o.amount = left.reduce((a, u) => a + u.count, 0)), ((o.data ??= {}).power = o.amount * 1000);
    }
  }
  // A winner whose only survivors were clones or summoned creatures (they vanish) has no troops
  // left, and a hero can't go on without any: it counts as retreated (heroes.thelazy.net, Combat#Retreat)
  // and waits in the tavern.
  for (const x of [h, d]) {
    if (!x || x.removed || x.army.some((a) => a)) continue;
    x.removed = true;
    x.retired = true;
    delete x.garrison;
    tavernReturn(s, x.owner, x.type, "retreated", x === d, w.data.classTavernOdds);
    if (x.boat !== undefined) s.objects[x.boat].removed = true;
    s.log.push(`${x.name} has no troops left and leaves.`);
  }
  // A map script's battle: the rest of the script, once its hero has won.
  if (h.scriptAfterBattle) extra.push(...afterScriptBattle(s, w, h, won));
  w.refresh(s);
  refreshMovement(s, w);
  checkGameEnd(s, w, won ? { hero: d?.id, object: o?.id, by: h.owner } : undefined);
  return [{ e: "battleResult", hero: h.id, object: o?.id ?? -1, won, defender: d?.id }, ...extra, ...passIfOut(s, w)];
}

/** How much a skill can do for this hero where it stands (the AI's level-up pick): 0 to 1. */
export function skillUse(w: World, h: Hero, key: string): number {
  const c = (x: ArmySlot | null) => (x ? w.creatures[x.creature] : undefined);
  const water = w.map.tiles.filter((t) => t.terrain === 8).length > w.map.tiles.length * 0.05;
  if (key === "navigation") return water ? 1.5 : 0;
  if (key === "archery") return h.army.some((x) => c(x)?.abilities.some((a) => a.type === "SHOOTER")) ? 1 : 0.2;
  if (key === "leadership") return h.army.some((x) => c(x) && feelsMorale(c(x)!)) ? 1 : 0;
  if (["wisdom", "airMagic", "earthMagic", "fireMagic", "waterMagic", "sorcery", "intelligence", "mysticism", "scholar", "eagleEye"].includes(key)) return h.spells ? 1 : 0.3;
  return 1;
}
