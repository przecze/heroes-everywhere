// What each place on the map is worth to a computer player's hero, and what it does there: one record per kind of
// place (its `@wiki thing/<slug>` page shows the record under "In the code"), looked up by the object's type (and
// subtype where a type holds several kinds). Kinds with no record of their own are the configurable places
// (rewardable.ts: warehouses, sea barrels, HotA's huts and springs) and the creature banks.
import { BANKS } from "../bankData.ts";
import { feelsMorale } from "../creatures.ts";
import { SPELL } from "../spells.ts";
import { MAX_SKILLS, skillLevel } from "../skills.ts";
import { COMBOS, LOCKED, SLOT, heroSpells, slotsOf } from "./artifacts.ts";
import { maxMana } from "./magic.ts";
import { CARTOGRAPHER_PRICE, cartographerShows, libraryLevel, mapData } from "./objects.ts";
import { training } from "./visit.ts";
import { gateTowns } from "./advSpells.ts";
import { BLACK_MARKET_MARKETS, JUNKMAN_MARKETS, artifactOffer, marketCount } from "./market.ts";
import { MAIN_XP, engineOf, feederFor, fixes, guarded, onTodaysWalk } from "./aiRoles.ts";
import { GRAIL_ARTIFACT, MAX_HEROES, PRECIOUS, abandonedMine, allied, dwellingCreatures, dwellingGuards, dwellingPrice, mapHeroesOf } from "./rules.ts";
import { B, affordableCount, buildingCost, buildableButForCost, cannotBuild, garrisonHero } from "./town.ts";
import { artifactSacrificeXp, blackMarketStock, cannotBuyMachineAt, cannotLearnSkill, factoryMachines, freelancerPrice, hillFortUpgrade, isEvil, junkmanPrice, skeletonOf, universityCost, universityOffer } from "./trades.ts";
import { type RewardableDef, rewardableDef } from "./rewardable.ts";
import { type Quest, activeQuest, questDone, questExpired } from "./quests.ts";
import { scriptQuestReady } from "./scripts.ts";
import { type AdventureState, type AdvObject, type ArmySlot, type Hero, Obj } from "./types.ts";
import { type World, isRevealed, visitTile } from "./world.ts";
import { BUILD_ORDER, fits, recruitAll, upgradeAll } from "./aiTowns.ts";
import { GRAIL_WORTH, act, landRegions, leaderBonus, locked, mainHero, whirlpoolWorth } from "./ai.ts";
import { WALLS, army, beatsSiege, carriesArmy, ferries, leavesTownsOpen, power } from "./aiThreat.ts";
import { weekIndex } from "../calendar.ts";
import { traitsOf } from "./aiPersonality.ts";
import { LOSS_WEIGHT, RESOURCE_VALUE, UNBEATABLE, WORTH, XP_VALUE, aiEnv } from "./aiValues.ts";
import { GOAL_WORTH, aiGoal, artifactWorth, goalGuards, livingArmy, mapHasWater, objectValue, skillWorth } from "./aiWorth.ts";

/** A hero weighing a place: who, where, the place, its strength and this week's index. */
export interface Visit {
  s: AdventureState;
  w: World;
  h: Hero;
  o: AdvObject;
  enemies: Hero[];
  /** The hero's strength (power). */
  mine: number;
  week: number;
}
/** A kind of place: what reaching it is worth (0 = not interested), and, for a service, what the hero does there. */
export interface Place {
  worth: (v: Visit) => number;
  use?: (s: AdventureState, w: World, player: number, h: Hero, o: AdvObject) => void;
}

/**
 * How the AI weighs monsters: how much stronger than one a hero wants to be before fighting it,
 * and whether it's boxed in with nothing else to do, so that a beatable guard is worth fighting
 * for the way it opens (pickTarget lowers the margin for that one search).
 */
export const odds = { margin: Number(aiEnv("AI_MARGIN") ?? 1.6), clearingTheWay: false };
/** Gold kept back from services for the week's troops. */
export const SERVICE_RESERVE = 3000;

/** What reaching this object is worth to the hero (0 = not interested). */
export function objectWorth(s: AdventureState, w: World, h: Hero, o: AdvObject, enemies: Hero[]): number {
  // An ally's: nothing to take.
  if (o.owner >= 0 && allied(s, o.owner, h.owner)) return 0;
  const mine = power(w, h);
  // Been there this week (shrines, huts, gardens...): nothing more to get. Towns are always worth a look.
  const seen = h.aiVisited?.[o.id];
  if (seen !== undefined && s.day - seen < 7 && o.type !== Obj.TOWN) return 0;
  return (placeOf(o)?.worth ?? otherWorth)({ s, w, h, o, enemies, mine, week: weekIndex(s.day) });
}
/** Uses a service the hero stands at: learns its best skill, upgrades its troops, buys war machines, trades surplus. */
export function useService(s: AdventureState, w: World, player: number, h: Hero, o: AdvObject) {
  placeOf(o)?.use?.(s, w, player, h, o);
}
const placeOf = (o: AdvObject): Place | undefined => PLACES[`${o.type}:${o.subid}`] ?? PLACES[o.type];

// ---- Pickups.

/** @wiki thing/resource A pile: its resources' worth. */
const resource: Place = { worth: ({ o }) => (o.amount ?? 1) * RESOURCE_VALUE[o.subid] };
/** @wiki thing/treasure-chest A Treasure Chest: gold or experience. */
const treasureChest: Place = { worth: () => 1500 };
/** @wiki thing/campfire A Campfire: 400-600 gold and 4-6 of a resource (it was valued at 900, so heroes walked past them). */
const campfire: Place = { worth: () => 500 + 5 * 416 };
/** @wiki thing/artifact An artifact on the ground: what it is worth to this hero (artifactWorth). */
const artifact: Place = { worth: ({ s, w, h, o }) => artifactWorth(s, w, h, o.subid) };
/** @wiki thing/pandora-s-box Pandora's Box: a fixed guess at what's inside. */
const pandorasBox: Place = { worth: () => 3000 };
/** @wiki thing/lean-to thing/wagon thing/corpse Lean To, Wagon, Skeleton: something for the first visitor only (they stay on the map). */
const firstVisitorOnly: Place = { worth: ({ o }) => (o.visitedWeek === -1 ? 0 : 900) };
/** @wiki thing/shipwreck-survivor thing/flotsam thing/sea-chest thing/scholar Shipwreck Survivor, Flotsam, Sea Chest, Scholar: a small pickup. */
const smallPickup: Place = { worth: () => 900 };
/** @wiki thing/spell-scroll A Spell Scroll: its spell, for a hero with a spellbook who doesn't know it (the sea's spells only with water). */
const spellScroll: Place = {
  worth: ({ w, h, o }) => {
    const sp = Number(mapData(w, o).spell ?? -1);
    if (!h.spells || (sp >= 0 && heroSpells(h, w.data.spells ?? [])?.includes(sp))) return 0;
    if (([SPELL.SUMMON_BOAT, SPELL.SCUTTLE_BOAT, SPELL.WATER_WALK] as number[]).includes(sp) && !mapHasWater(w)) return 0;
    return 600 * Math.max(1, w.data.spells?.[sp]?.level ?? 2);
  },
};
/** @wiki thing/warrior-s-tomb A Warrior's Tomb: an artifact (the morale lost lasts only to the next battle). */
const warriorsTomb: Place = { worth: ({ o }) => (o.visitedWeek === -1 ? 0 : 2000) };

// ---- Mines, dwellings and places to flag.

/**
 * @wiki thing/mine A mine: what it yields for about two weeks and a half (500 a day: two wood or ore, one rare
 * resource; a gold mine 1000). Troops a rival left there must be beaten first.
 */
const mineWorth: Place = {
  worth: ({ s, w, h, o, mine }) => {
    if (o.owner === h.owner) return 0;
    if ((o.army ?? []).some((a) => a) && mine <= 1.8 * army(w, o.army ?? [])) return 0;
    // (An abandoned mine as a mine of subtype 7: behind its guards, as below; three Inferno heroes died at one on For Sale.)
    if (o.subid >= 7) return abandonedWorth(s, w, o, mine);
    return o.subid === 6 ? WORTH.goldMine : WORTH.mine;
  },
};
/** @wiki thing/mine-2 An abandoned mine: a mine, once its guards are beaten (or as good as). */
const abandoned: Place = { worth: ({ s, w, h, o, mine }) => (o.owner === h.owner ? 0 : abandonedWorth(s, w, o, mine)) };
function abandonedWorth(s: AdventureState, w: World, o: AdvObject, mine: number): number {
  const lost = abandonedMine(s, w, o);
  if (!lost) return 0;
  return lost.cleared || mine > 1.8 * army(w, lost.guards) ? WORTH.mine : 0;
}
/**
 * @wiki thing/creature-generator-1 A dwelling: what the gold buys there and the army has room for (a walk to a dwelling
 * of ours with no gold to spend, or no free slot, is a day lost); an unflagged one is worth flagging anyway.
 */
const dwelling: Place = {
  worth: ({ s, w, h, o, mine }) => {
    if (o.owner === h.owner && !(o.dwelling?.available ?? []).some((n) => n > 0)) return 0;
    const creatures = dwellingCreatures(o) ?? [];
    const c = w.creatures[creatures[0]];
    if (!c) return 0;
    if (c.level >= 5 && o.owner !== h.owner && mine < 2 * c.growth * 3 * c.aiValue) return 0;
    const avail = o.dwelling?.available[0] ?? c.growth;
    const buys = fits(h.army, creatures[0]) ? affordableCount(dwellingPrice(w, o, creatures[0]), s.players[h.owner].resources, avail) : 0;
    if (o.owner === h.owner) return buys > 0 ? buys * c.aiValue * 0.5 : 0;
    return 1200 + buys * c.aiValue * 0.3;
  },
};
/** @wiki thing/creature-generator-4 Golem Factory / Elemental Conflux: guarded by golems or elementals until taken (beaten at a bank's margin). */
const guardedDwelling: Place = {
  worth: ({ s, w, h, o, mine }) => {
    if (o.owner === h.owner) return (o.dwelling?.available ?? []).some((n) => n > 0) ? 1500 : 0;
    return mine > 1.8 * army(w, dwellingGuards(s, w, o, h)) ? 3000 : 0;
  },
};
/** @wiki thing/refugee-camp A Refugee Camp: worth it when there's something affordable to buy. */
const refugeeCamp: Place = {
  worth: ({ s, w, h, o }) => {
    const c = o.data?.creature !== undefined ? w.creatures[Number(o.data.creature)] : undefined;
    // (Not looked into yet: who's there is rolled on the first visit; worth a look with gold for a few.)
    if (!c) return o.dwelling ? 0 : s.players[h.owner].resources[6] >= SERVICE_RESERVE + 2000 ? 1000 : 0;
    return s.players[h.owner].resources[6] >= c.cost[6] * 3 ? c.aiValue * Math.min(o.dwelling?.available[0] ?? 0, 5) * 0.3 : 0;
  },
};
/** @wiki thing/lighthouse A Lighthouse: flagged for its ships' speed. */
const lighthouse: Place = { worth: ({ h, o }) => (o.owner === h.owner ? 0 : 1500) };
/** @wiki thing/shipyard thing/airship-yard A Shipyard: flagged, a place to build a boat. */
const shipyard: Place = { worth: ({ h, o }) => (o.owner === h.owner ? 0 : 1200) };
/** @wiki thing/garrison thing/garrison-2 A garrison nobody holds: ours to take, and the way through. */
const garrison: Place = { worth: ({ h, o }) => (o.owner !== h.owner && !(o.army ?? []).some((a) => a) ? 500 : 0) };

// ---- Towns.

/**
 * @wiki principle/towns-first A town: a rival's is worth more than a neutral one (its income and troops leave the
 * rival; walls make the garrison count for more); without a town of our own any town that can be won comes first;
 * one of ours, for the troops waiting there or the Grail carried home.
 */
/** The garrison's stacks the hero would take (takeGarrison's rule: its own kind joins, else a free slot, in slot order). */
export function takeable(h: Hero, garrison: (ArmySlot | null)[]): ArmySlot[] {
  const kinds = h.army.map((x) => (x ? x.creature : -1));
  const out: ArmySlot[] = [];
  for (const g of garrison) {
    if (!g) continue;
    if (!kinds.includes(g.creature)) {
      const free = kinds.indexOf(-1);
      if (free < 0) continue;
      kinds[free] = g.creature;
    }
    out.push(g);
  }
  return out;
}

const town: Place = {
  worth: ({ s, w, h, o, mine }) => {
    if (o.owner === h.owner) {
      // The Grail carried home: its monument (5000 gold a day, faster growth) is built on arrival.
      if ([...(h.equipped ?? []), ...(h.backpack ?? [])].includes(GRAIL_ARTIFACT) && !o.town?.built.includes(B.GRAIL)) return WORTH.grailHome;
      // Home: pick up the troops waiting there.
      // (By the hero that carries the army: see carriesArmy.)
      // (Only what it can take: a stack joins its own kind or a free slot, as takeGarrison does. Counting the whole
      // garrison sent a main hero with seven kinds back to a town of other kinds every day for a year: Realm of Chaos,
      // 8 computers, Purple's 2.8 million army shuttled between its two towns and never marched.)
      const g = army(w, takeable(h, o.town?.garrison ?? []));
      // (Fix engines: a guard left there stays; the main army comes only when the town is on today's walk, else a
      // feeder brings the troops out: aiRoles.ts.)
      if (guarded(s, h.owner, o.id)) return 0;
      const carrier = carriesArmy(s, w, h) && (!fixes(s, h.owner) || onTodaysWalk(h, o) || !feederFor(s, h));
      // (A scout comes for them only to take them out to a far-away main army: see ferries.)
      return g > 0.15 * army(w, h.army) && g > 0 ? (carrier ? g * 1.5 : ferries(s, w, h, o) ? g : 0) : 0;
    }
    // Without a town of our own the player is out in a week (Maelstrom starts so): any town that
    // can be won comes first, at even odds.
    if (s.players[h.owner].townlessSince !== undefined) return mine > (o.town?.built.includes(B.FORT) ? WALLS : 1) * army(w, o.town?.garrison ?? []) ? WORTH.townWhenTownless : 0;
    // (A hero in the garrison defends with its army and skills: a computer's, or a player's, holding the town.)
    // (Not while a rival hero we can't beat could take a town of ours meanwhile: see leavesTownsOpen. The map's town to
    // take is the game, and goes on.)
    const goal = aiGoal(s);
    const days = Math.ceil((100 * Math.max(Math.abs(o.x - h.x), Math.abs(o.y - h.y))) / Math.max(1, h.maxMovement));
    if (!(goal?.type === 6 && goal.object === o.id) && leavesTownsOpen(s, w, h, days)) return 0;
    const keeper = garrisonHero(s, o);
    const defence = keeper ? power(w, keeper) : army(w, o.town?.garrison ?? []);
    if (!beatsSiege(s, w, h, o, defence, keeper)) return 0;
    if (o.owner < 0) return WORTH.neutralTown;
    // A rival's town is worth its defenders beaten too (as a rival hero is worth its army), and a rival's last towns
    // are the game: taking them puts the player out. (At a flat 40000 a leader with 16 towns chased a rival's level-1
    // scouts round the map for a year and left the last towns standing: Free for All, 8 computers, day 470.)
    const left = s.objects.filter((t) => t.town && !t.removed && t.owner === o.owner).length;
    return (WORTH.rivalTown + defence) * (left <= 2 ? LAST_TOWNS : 1) * leaderBonus(s, w, h.owner, o.owner) * traitsOf(s, h.owner).rivals;
  },
};

// ---- Monsters.

/**
 * @wiki thing/monster principle/fights-that-pay A monster: worth its experience less the troops it costs: winning at
 * a strength ratio r loses about 1.1 r^2 of the army (28 battles of the eight-AI race, 2026-11-01: 3% at 1:5, 10% at
 * 3:10, 17% at 2:5, 25% at 1:2; it was 1.7 r^2 from the battle AI of 10-24, twice what it loses now, and main armies
 * walked past every guard worth a fight). Negative when it costs more than it brings: then only what it guards makes it
 * worth it (chooseTarget adds that).
 */
const LOSS_AT = Number(aiEnv("AI_LOSS") ?? 1.1);
const LAST_TOWNS = Number(aiEnv("AI_LAST") ?? 2);
const monster: Place = {
  worth: ({ s, w, h, o, mine }) => {
    const c = w.creatures[o.subid];
    const them = (o.amount ?? 0) * (c?.aiValue ?? 0);
    if (!(mine > odds.margin * traitsOf(s, h.owner).margin * them)) return UNBEATABLE;
    const r = them / Math.max(1, mine);
    const loss = army(w, h.army) * Math.min(1, LOSS_AT * r * r);
    // (Roles engine: the main hero's experience counts for more, its levels win the later fights: aiRoles.ts.)
    const xp = engineOf(s, h.owner) === "roles" && mainHero(s, w, h.owner) === h ? MAIN_XP : 1;
    const net = (o.amount ?? 0) * (c?.hp ?? 0) * XP_VALUE * xp - loss * LOSS_WEIGHT;
    // A stack worth a quarter of the army or less is cleared for the experience and the room it leaves
    // (at 15% the AI fought 5 battles in 14 days on a 72x72 map; a quarter measured +7 in the duel)
    // (at 1000 and a tenth, a main hero with a second one taking the things near home walked past them).
    return odds.clearingTheWay ? Math.max(net, 0) + 600 : r <= 0.25 ? Math.max(net, 1500) : net;
  },
};

// ---- Weekly and once-only places.

/** @wiki thing/mystical-garden thing/water-wheel Mystical Garden (5 gems or 500 gold), Water Wheel (500-1000 gold): weekly. */
const weeklyGold: Place = { worth: ({ o, week }) => (o.visitedWeek === week ? 0 : 800) };
/** @wiki thing/windmill A Windmill: 3-6 of a rare resource, weekly. */
const windmill: Place = { worth: ({ o, week }) => (o.visitedWeek === week ? 0 : 4.5 * 500) };
/**
 * @wiki thing/garden-of-revelation thing/mercenary-camp thing/marletto-tower thing/star-axis thing/learning-stone thing/arena
 * A primary skill or experience, once for each hero.
 */
const oncePerHero: Place = { worth: ({ h, o }) => (o.visitors?.includes(h.id) ? 0 : 2500) };
/** @wiki thing/tree-of-knowledge The Tree of Knowledge: a level, once for each hero. */
const treeOfKnowledge: Place = { worth: ({ h, o }) => (o.visitors?.includes(h.id) ? 0 : 2500) };
/** @wiki thing/library-of-enlightenment The Library of Enlightenment: only from the level it lets in. */
const library: Place = { worth: ({ h, o }) => (h.level < libraryLevel(h) ? 0 : o.visitors?.includes(h.id) ? 0 : 2500) };
/** @wiki thing/hut-of-the-magi The Hut of the Magi: a look at what its eyes see, once. */
const hutOfTheMagi: Place = { worth: ({ h, o }) => (o.visitors?.includes(h.id) ? 0 : 300) };
/** @wiki thing/redwood-observatory thing/pillar-of-fire Redwood Observatory, Pillar of Fire: the land around in sight, once. */
const lookout: Place = { worth: ({ h, o }) => (o.visitors?.includes(h.id) || h.aiVisited?.[o.id] !== undefined ? 0 : 400) };
/** @wiki thing/stables Stables: movement for the week. */
const stables: Place = { worth: ({ h, week }) => (h.stablesWeek === week ? 0 : 900) };
/** @wiki thing/swan-pond The Swan Pond: +2 luck to the next battle for the rest of the day's movement: worth more as the day goes. */
const swanPond: Place = { worth: ({ h, o }) => (h.temp?.from.includes(o.type) ? 0 : 500 * (1 - h.movement / Math.max(1, h.maxMovement))) };
/** @wiki thing/magic-spring The Magic Spring: spell points up to double, once a week. */
const magicSpring: Place = { worth: ({ h, o, week }) => (h.spells && o.visitedWeek !== week ? Math.max(0, 2 * maxMana(h) - (h.mana ?? 0)) * 10 : 0) };
/** @wiki thing/magic-well The Magic Well: the mana it gives back (nothing to a full pool, or with no spellbook). */
const magicWell: Place = { worth: ({ h }) => (h.spells ? Math.max(0, maxMana(h) - (h.mana ?? 0)) * 10 : 0) };
/** @wiki thing/temple thing/buoy Morale until the next battle: nothing to an undead army (Temple, Buoy). */
const morale: Place = { worth: ({ w, h, o }) => (h.temp?.from.includes(o.type) || !livingArmy(w, h) ? 0 : 500) };
/**
 * @wiki thing/faerie-ring thing/mermaids thing/fountain-of-fortune thing/fountain-of-youth thing/watering-hole thing/oasis thing/rally-flag thing/idol-of-fortune
 * Morale or luck until the next battle: worth it on the way to a fight.
 */
const battleBoost: Place = { worth: ({ h, o }) => (h.temp?.from.includes(o.type) ? 0 : 500) };
/** @wiki thing/witch-hut A Witch Hut: worth the skill it teaches, if there's room for it and the hero hasn't got it. */
const witchHut: Place = {
  worth: ({ s, w, h, o }) => {
    const list = mapData(w, o).skills as number[] | undefined;
    const sk = o.data?.skill !== undefined ? Number(o.data.skill) : list?.length === 1 ? list[0] : -1;
    if (o.visitors?.includes(h.id)) return 0;
    return sk >= 0 ? skillWorth(s, w, h, sk) : (h.skills ?? []).length >= MAX_SKILLS ? 0 : 1500;
  },
};
/**
 * @wiki thing/shrine-of-magic-incantation thing/shrine-of-magic-gesture thing/shrine-of-magic-thought A shrine: a spell,
 * for a hero with a spellbook (level 3 needs Wisdom) who doesn't know it yet.
 */
const shrine: Place = {
  worth: ({ w, h, o }) => {
    if (!h.spells || (o.type === 90 && !skillLevel(h.skills, "wisdom"))) return 0;
    const sp = o.data?.spell !== undefined ? Number(o.data.spell) : -1;
    return sp >= 0 && heroSpells(h, w.data.spells ?? [])?.includes(sp) ? 0 : 1500;
  },
};
/** @wiki thing/school-of-magic thing/school-of-war The Schools: their fee with 2000 gold to spare. */
const school: Place = { worth: ({ s, h, o }) => (o.visitors?.includes(h.id) || s.players[h.owner].resources[6] < training(o).cost + 2000 ? 0 : 2000) };
/** @wiki thing/cartographer A Cartographer: its maps, with gold to spare (as for the town's extras) and its kind of ground still unseen. */
const cartographer: Place = {
  worth: ({ s, w, h, o }) => {
    if (((o.data?.boughtBy as number[] | undefined) ?? []).includes(h.owner) || s.players[h.owner].resources[6] < CARTOGRAPHER_PRICE + 15000) return 0;
    const dark = w.map.tiles.some((_, i) => cartographerShows(w, o.subid, i) && !isRevealed(s, h.owner, i));
    return dark ? 1000 : 0;
  },
};
/** @wiki thing/obelisk An Obelisk: a piece of the grail's puzzle; the last few show where it lies (the last one: the Grail itself). */
const obelisk: Place = {
  worth: ({ s, h, o }) => {
    if (s.players[h.owner].obelisks?.includes(o.id)) return 0;
    const left = s.objects.filter((x) => x.type === 57).length - (s.players[h.owner].obelisks?.length ?? 0);
    return s.grail?.found ? 500 : Math.max(1500, GRAIL_WORTH / (left * left));
  },
};
/** @wiki thing/prison A Prison: a hero to free (worth a tavern's 2500 and its experience), unless the player has as many as can be. */
const prison: Place = { worth: ({ s, w, h, o }) => (mapHeroesOf(s, h.owner).length >= MAX_HEROES ? 0 : 2500 + Number(mapData(w, o).experience ?? 0) * 0.4) };

// ---- Keys, borders and quests.

/** @wiki thing/keymaster-s-tent A Keymaster's Tent: its key, more when a guard or gate of that colour stands somewhere (a key is kept for good). */
const keymaster: Place = {
  worth: ({ s, h, o }) => {
    if (s.players[h.owner].keys?.includes(o.subid)) return 0;
    return s.objects.some((x) => !x.removed && (x.type === 9 || x.type === 212) && x.subid === o.subid) ? 1500 : 300;
  },
};
/** @wiki thing/border-guard thing/border-gate A border guard or gate with its key in hand (a quest gate's quest done): the way through. HotA's Grave: 1500-4000 gold and an artifact, dug the day after reaching it. */
const border: Place = { worth: ({ s, w, h, o }) => (o.subid === 1001 ? 2000 : locked(s, w, h, o) ? 0 : 800) };
/** @wiki thing/seer-s-hut thing/quest-guard A Seer's Hut with its quest done: the reward less what's handed over; a Quest Guard: the way through. */
const quest: Place = {
  worth: ({ s, w, h, o }) => {
    const q = activeQuest(w, o, s, h);
    if (o.data?.done || !q.mission || !(q.hota === 3 && q.mission === 10 ? scriptQuestReady(s, w, h, o) : questDone(s, w, h, q)) || questExpired(s, q)) return 0;
    // (The one before the victory's goal: the way to winning.)
    const goal = aiGoal(s);
    const g = goal?.object !== undefined ? s.objects[goal.object] : undefined;
    if (o.type === 215 && g && goalGuards(s, w, g).includes(o)) return GOAL_WORTH / 2;
    return o.type === 215 ? 800 : Math.max(0, questWorth(s, w, h, q));
  },
};
/** A finished quest's reward (quests.ts questReward), less what it takes (questPay): resources (at half: a market pays little for them), artifacts, troops. */
function questWorth(s: AdventureState, w: World, h: Hero, q: Quest): number {
  const n = q.amount ?? 0;
  const reward: Record<number, () => number> = {
    1: () => n,
    2: () => n * 5,
    3: () => n * 300,
    4: () => n * 300,
    5: () => n * RESOURCE_VALUE[q.resource ?? 6],
    6: () => n * 1500,
    7: () => skillWorth(s, w, h, q.skill ?? 0),
    8: () => artifactWorth(s, w, h, q.artifact ?? 0),
    9: () => (h.spells ? 600 * (w.data.spells?.[q.spell ?? 0]?.level ?? 1) : 0),
    10: () => n * (w.creatures[q.creature ?? 0]?.aiValue ?? 0) * 0.5,
  };
  const paid =
    (q.mission === 7 ? (q.resources ?? []).reduce((a, x, i) => a + x * RESOURCE_VALUE[i] * 0.5, 0) : 0) +
    (q.mission === 5 ? (q.artifacts ?? []).reduce((a, x) => a + artifactWorth(s, w, h, x), 0) : 0) +
    (q.mission === 6 ? (q.creatures ?? []).reduce((a, c) => a + c.count * (w.creatures[c.creature]?.aiValue ?? 0), 0) : 0);
  return (reward[q.reward ?? 0]?.() ?? 0) - paid;
}

// ---- Travel.

/** @wiki thing/whirlpool A whirlpool: what it leads to, less the troops the sea takes. */
const whirlpool: Place = { worth: ({ s, w, h, o, enemies }) => whirlpoolWorth(s, w, h, o, enemies) };

// ---- Services: worth what the AI then really does there (use).

/** @wiki thing/university thing/seafaring-academy A University (HotA's Seafaring Academy): its best skill for this hero, with gold for it. */
const university: Place = {
  worth: ({ s, w, h, o }) => {
    const gold = s.players[h.owner].resources[6] - SERVICE_RESERVE;
    if ((h.skills ?? []).length >= MAX_SKILLS || gold < 2000) return 0;
    return Math.max(0, ...universityOffer(s, o).map((k) => skillWorth(s, w, h, k)));
  },
  use: (s, w, player, h, o) => {
    const res = s.players[player].resources;
    const best = universityOffer(s, o).filter((k) => !cannotLearnSkill(s, h, o, k, w) && universityCost(o, k).every((n, i) => n <= res[i] - (i === 6 ? SERVICE_RESERVE : 0))).map((k) => ({ k, v: skillWorth(s, w, h, k) })).sort((a, b) => b.v - a.v)[0];
    if (best && best.v > 0) act(s, w, player, { type: "learnSkill", hero: h.id, object: o.id, skill: best.k });
  },
};
/** @wiki thing/black-market The Black Market: an artifact to buy, with gold to spare for it (the stock is seen on arrival); the one worth most for its price. */
const blackMarket: Place = {
  worth: ({ s, h }) => (s.players[h.owner].resources[6] - SERVICE_RESERVE >= 5000 ? 2500 : 0),
  use: (s, w, player, h, o) => {
    const gold = () => s.players[player].resources[6] - SERVICE_RESERVE;
    const stock = blackMarketStock(s, w, o);
    const picks = stock
      .map((art, slot) => ({ slot, art, price: art >= 0 ? artifactOffer(BLACK_MARKET_MARKETS, w.data.artifacts[art]?.cost ?? 0, 6, "buy") : Infinity }))
      .filter((p) => p.art >= 0 && p.price <= gold())
      .map((p) => ({ ...p, worth: artifactWorth(s, w, h, p.art) / Math.max(1, p.price) }))
      .sort((a, b) => b.worth - a.worth);
    if (picks[0] && picks[0].worth > 0.3) act(s, w, player, { type: "buyArtifact", hero: h.id, object: o.id, slot: picks[0].slot });
  },
};
/** @wiki thing/tavern A Tavern on the map: a second or third hero, with gold for one (the first one offered). */
const tavern: Place = {
  worth: ({ s, h }) => (s.players[h.owner].resources[6] - SERVICE_RESERVE >= 2500 && mapHeroesOf(s, h.owner).length < 3 ? 2500 : 0),
  use: (s, w, player, h, o) => {
    if (s.players[player].resources[6] - SERVICE_RESERVE >= 2500 && mapHeroesOf(s, h.owner).length < 3) act(s, w, player, { type: "hireAt", hero: h.id, object: o.id, slot: 0 });
  },
};
/** @wiki thing/hill-fort The Hill Fort: the stacks it would upgrade that the resources pay for, best first. */
const hillFort: Place = {
  worth: ({ s, w, h }) => {
    const gold = s.players[h.owner].resources[6] - SERVICE_RESERVE;
    const res = s.players[h.owner].resources;
    return hillFortUpgrades(w, h).filter((u) => u.cost.every((n, i) => n <= (i === 6 ? gold : res[i]))).reduce((a, u) => a + u.gain * 0.8, 0);
  },
  use: (s, w, player, h, o) => {
    for (const u of hillFortUpgrades(w, h)) if (u.cost[6] <= s.players[player].resources[6] - SERVICE_RESERVE) act(s, w, player, { type: "upgradeStack", hero: h.id, object: o.id, slot: u.slot });
  },
};
/** The stacks a Hill Fort would upgrade, best first, with the cost and the worth gained. */
function hillFortUpgrades(w: World, h: Hero): { slot: number; cost: number[]; gain: number }[] {
  return h.army
    .map((a, slot) => {
      const up = hillFortUpgrade(w, h, slot);
      if (!a || !up) return null;
      return { slot, cost: up.cost, gain: a.count * ((w.creatures[up.to]?.aiValue ?? 0) - (w.creatures[a.creature]?.aiValue ?? 0)) };
    })
    .filter((x): x is { slot: number; cost: number[]; gain: number } => !!x && x.gain > 0)
    .sort((a, b) => b.gain - a.gain);
}
/** @wiki thing/war-machine-factory thing/cannon-yard A War Machine Factory: the machines the hero lacks (HotA's may offer only some of the three). */
const warMachineFactory: Place = {
  worth: ({ s, h, o }) => (s.players[h.owner].resources[6] - SERVICE_RESERVE >= 2500 ? factoryMachines(o).filter((a) => !(h.equipped ?? []).includes(a)).length * 800 : 0),
  use: (s, w, player, h, o) => {
    for (const a of [4, 6, 5]) if (!(h.equipped ?? []).includes(a) && s.players[player].resources[6] - SERVICE_RESERVE >= 2500 && !cannotBuyMachineAt(s, w, h, o, a, player)) act(s, w, player, { type: "buyMachineAt", hero: h.id, object: o.id, artifact: a });
  },
};
/** @wiki thing/trading-post thing/trading-post-2 A Trading Post: surplus resources sold for gold, while the player has few markets. */
const tradingPost: Place = {
  worth: ({ s, h }) => (marketCount(s, h.owner) < 5 && s.players[h.owner].resources.slice(0, 6).some((n, i) => n > [30, 15, 30, 15, 15, 15][i] + 10) ? 600 : 0),
  use: (s, w, player) => {
    const res = s.players[player].resources;
    const keep = [30, 15, 30, 15, 15, 15];
    for (let r = 0; r < 6; r++) if (res[r] - keep[r] > 5) act(s, w, player, { type: "trade", from: r, to: 6, lots: res[r] - keep[r] });
  },
};
/**
 * @wiki thing/altar-of-sacrifice The Altar of Sacrifice: spare artifacts for their experience (a hero of might or
 * magic; the evil ones give troops, a loss at the altar's rate).
 */
const altarOfSacrifice: Place = {
  worth: ({ s, w, h }) => (isEvil(h) ? 0 : spareArtifacts(s, w, h).reduce((a, id) => a + artifactSacrificeXp(w, id), 0)),
  use: (s, w, player, h, o) => {
    if (isEvil(h)) return;
    const spare = spareArtifacts(s, w, h).filter((id) => artifactSacrificeXp(w, id) > 0);
    if (spare.length) act(s, w, player, { type: "sacrifice", hero: h.id, object: o.id, artifacts: spare });
  },
};
/** @wiki thing/junkman The Junkman (HotA): spare artifacts for gold. */
const junkman: Place = {
  worth: ({ s, w, h }) => spareArtifacts(s, w, h).reduce((a, id) => a + junkmanSale(w, id), 0),
  use: (s, w, player, h, o) => {
    for (const id of spareArtifacts(s, w, h)) if (junkmanSale(w, id)) act(s, w, player, { type: "sellArtifact", hero: h.id, object: o.id, artifact: id });
  },
};
/** @wiki thing/warlock-s-lab The Warlock's Lab (HotA): the precious resources a building waits for, for others to spare. */
const warlocksLab: Place = {
  worth: ({ s, w, h }) => {
    const trades = labTrades(s, w, h.owner);
    return trades.length ? 1000 + trades.reduce((a, [, , n]) => a + n * 500, 0) : 0;
  },
  use: (s, w, player) => {
    for (const [from, to, lots] of labTrades(s, w, player)) act(s, w, player, { type: "trade", from, to, lots });
  },
};
/** @wiki thing/freelancer-s-guild The Freelancer's Guild: stacks not worth their slot, sold. */
const freelancersGuild: Place = {
  worth: ({ w, h }) => junkStacks(w, h).reduce((a, slot) => a + 300 + freelancerPrice(w, h.army[slot]!.creature, h.army[slot]!.count), 0),
  use: (s, w, player, h, o) => {
    for (const slot of junkStacks(w, h)) act(s, w, player, { type: "sellStack", hero: h.id, object: o.id, slot, count: h.army[slot]!.count });
  },
};
/** @wiki thing/skeleton-transformer The Skeleton Transformer (HotA): living troops worth less than Skeletons, in an undead army. */
const skeletonTransformer: Place = {
  worth: ({ w, h }) => transformable(w, h).reduce((a, slot) => a + transformGain(w, h.army[slot]!), 0),
  use: (s, w, player, h, o) => {
    const slots = transformable(w, h);
    if (slots.length) act(s, w, player, { type: "transform", hero: h.id, object: o.id, slots });
  },
};
/**
 * @wiki thing/town-gate The Town Gate (HotA): a town of ours to step into that can't be walked to today; through it,
 * and in the town as on arriving there: its garrison taken, troops recruited.
 */
const townGate: Place = {
  worth: ({ s, w, h }) => gateTown(s, w, h)?.value ?? 0,
  use: (s, w, player, h, o) => {
    const to = gateTown(s, w, h)?.town;
    if (to && act(s, w, player, { type: "townGate", hero: h.id, object: o.id, town: to.id })) {
      act(s, w, player, { type: "takeGarrison", town: to.id });
      recruitAll(s, w, player, to);
      upgradeAll(s, w, player, to);
    }
  },
};

/**
 * Artifacts in the pack with nowhere to wear them: every slot they'd take holds one worth as much
 * or more (or a combination), and no part of a set (it may yet be put together).
 */
function spareArtifacts(s: AdventureState, w: World, h: Hero): number[] {
  const eq = h.equipped ?? [];
  const part = (id: number) => !!COMBOS[id]?.length || Object.values(COMBOS).some((parts) => parts.includes(id));
  return (h.backpack ?? []).filter((id) => {
    const slots = slotsOf(w.data.artifacts, id).filter((sl) => sl !== SLOT.SPELLBOOK);
    if (id <= SLOT_LAST_MACHINE || part(id) || !slots.length) return false;
    return slots.every((sl) => eq[sl] === LOCKED || (eq[sl] >= 0 && artifactWorth(s, w, h, eq[sl]) >= artifactWorth(s, w, h, id)));
  });
}
/** (The spellbook, the scroll, the Grail and the war machines: never sold or given up.) */
const SLOT_LAST_MACHINE = 6;
/** What the Junkman pays for an artifact, in gold. */
const junkmanSale = (w: World, id: number) => (junkmanPrice(w, id) ? artifactOffer(JUNKMAN_MARKETS, w.data.artifacts[id]?.cost ?? 0, 6, "sell") : 0);

/**
 * The Warlock's Lab's trades (from, to, lots), one for one: for the first building of the order a
 * town of ours waits for that only precious resources keep back, from those beyond its own needs.
 */
function labTrades(s: AdventureState, w: World, player: number): [number, number, number][] {
  const res = s.players[player].resources;
  for (const o of s.objects) {
    if (!o.town || o.removed || o.owner !== player) continue;
    // (Built in today or not: tomorrow's building counts.)
    const t = o.town;
    const today = t.builtToday;
    t.builtToday = false;
    const why = (b: number) => cannotBuild(s, w, o, b);
    const id = BUILD_ORDER.find((b) => !t.built.includes(b) && buildableButForCost(s, w, o, b));
    const short = id !== undefined && !!why(id);
    t.builtToday = today;
    if (id === undefined || !short) continue;
    const cost = buildingCost(w, o, id);
    if ([0, 2, 6].some((r) => cost[r] > res[r])) continue;
    const spare = PRECIOUS.map((r) => ({ r, n: Math.max(0, res[r] - cost[r]) }));
    const trades: [number, number, number][] = [];
    for (const to of PRECIOUS) {
      let need = cost[to] - res[to];
      for (const from of spare) {
        if (need <= 0) break;
        const n = Math.min(need, from.n);
        if (n > 0 && from.r !== to) trades.push([from.r, to, n]), (from.n -= n), (need -= n);
      }
      if (need > 0) return [];
    }
    if (trades.length) return trades;
  }
  return [];
}

/** Stacks not worth their slot: with every slot taken, the ones worth under 3% of the army (a few Peasants), the strongest stack kept. */
export function junkStacks(w: World, h: Hero): number[] {
  if (h.army.some((x) => !x)) return [];
  const total = army(w, h.army);
  const worth = (x: ArmySlot) => x.count * (w.creatures[x.creature]?.aiValue ?? 0);
  const best = Math.max(...h.army.map((x) => worth(x!)));
  return h.army.map((x, slot) => ({ x: x!, slot })).filter(({ x }) => worth(x) < 0.03 * total && worth(x) < best && freelancerPrice(w, x.creature, x.count) > 0).map(({ slot }) => slot);
}

const isUndead = (w: World, c: number) => !!w.creatures[c]?.abilities.some((a) => a.type === "UNDEAD");
/** What a stack gains as Skeletons (or its own skeleton: dragons' are Bone Dragons). */
const transformGain = (w: World, x: ArmySlot) => x.count * ((w.creatures[skeletonOf(w, x.creature)]?.aiValue ?? 0) - (w.creatures[x.creature]?.aiValue ?? 0));
/** Living stacks worth more as Skeletons, in an army with undead in it already (so no morale is lost to the mix). */
export function transformable(w: World, h: Hero): number[] {
  if (!h.army.some((x) => x && isUndead(w, x.creature))) return [];
  return h.army.map((x, slot) => ({ x, slot })).filter(({ x }) => x && w.creatures[x.creature] && feelsMorale(w.creatures[x.creature]) && transformGain(w, x) > 0).map(({ slot }) => slot);
}

/** Through the Town Gate: the town of ours most worth stepping into (its garrison to pick up), when no road leads there from here. */
function gateTown(s: AdventureState, w: World, h: Hero): { town: AdvObject; value: number } | undefined {
  const region = landRegions(w);
  const here = region[w.index(h.x, h.y, h.z)];
  let best: { town: AdvObject; value: number } | undefined;
  for (const t of gateTowns(s, w, h)) {
    if (t.owner !== h.owner || (here >= 0 && region[visitTile(w, t)] === here)) continue;
    const value = 0.8 * objectValue(s, w, h, t, []);
    if (value > 0 && (!best || value > best.value)) best = { town: t, value };
  }
  return best;
}

// ---- Configurable places and creature banks (no record of their own).

/**
 * @wiki thing/warehouse-of-wood thing/warehouse-of-mercury thing/warehouse-of-ore thing/warehouse-of-sulfur thing/warehouse-of-crystal thing/warehouse-of-gem thing/warehouse-of-gold thing/temple-of-loyalty thing/colosseum-of-the-magi thing/watering-place thing/mineral-spring thing/hermit-s-shack thing/gazebo thing/derrick thing/prospector thing/trailblazer thing/trapper-lodge thing/ancient-lamp thing/sea-barrel thing/jetsam thing/vial-of-mana thing/observatory
 * Configurable places (rewardable.ts: warehouses, sea barrels, HotA's huts and springs): roughly what the first reward gives.
 */
function rewardWorth({ s, w, h, o }: Visit, def: RewardableDef): number {
  const st = o.data?.reward as { heroes?: number[]; players?: number[]; vars?: Record<string, number> } | undefined;
  // (A variable not rolled yet, as the Trapper Lodge's creatures before a first visit: a rough guess.)
  const amount = (a: string | number, guess: number) => (typeof a === "number" ? a : (st?.vars?.[a.replace(/^@/, "")] ?? st?.vars?.[a] ?? guess));
  if (def.visitMode === "once" && st?.heroes?.length) return 0;
  if (def.visitMode === "hero" && st?.heroes?.includes(h.type)) return 0;
  if (def.visitMode === "player" && st?.players?.includes(h.owner)) return 0;
  const worth = (r: (typeof def.rewards)[number]) => {
    let v = 0;
    // (What's paid, as the Ancient Lamp's gold for its genies, counts at half, as a quest's price: spending gold on troops is what it's for.)
    for (const x of r.resources ?? []) {
      const n = typeof x.amount === "number" ? x.amount : 4;
      v += n * (typeof x.res === "number" ? RESOURCE_VALUE[x.res] : 250) * (n < 0 ? 0.5 : 1);
    }
    for (const [c, n] of r.creatures ?? []) v += amount(n, 4) * (w.creatures[amount(c, -1)]?.aiValue ?? 300) * 0.5;
    v += (r.artifacts?.length ?? 0) * 2500 + (r.experience ?? 0) + (r.primary ?? []).reduce((a, n) => a + n * 1500, 0) + (r.manaPoints ?? 0) * 5 + (r.movePoints ?? 0);
    // The Hermit's Shack: a skill raised a level, for a hero with one still to raise.
    if (r.upgradeSkill && (h.skills ?? []).some(([, l]) => l < 3)) v += 1500;
    for (const b of r.bonuses ?? []) v += bonusWorth(w, h, b);
    // (An overnight stop: what's left of today's movement given up.)
    if (r.movePercentage !== undefined) v -= h.movement * (1 - r.movePercentage / 100);
    return v;
  };
  const affordable = (r: (typeof def.rewards)[number]) => !r.needs?.some((n) => typeof n.amount === "number" && typeof n.res === "number" && s.players[h.owner].resources[n.res] < n.amount);
  // Left to chance (a sea barrel, jetsam): what each outcome gives, by its odds; otherwise the first reward the hero can have.
  const chanced = def.rewards.filter((r) => r.chance);
  if (chanced.length) return Math.max(0, chanced.reduce((a, r) => a + (worth(r) * (r.chance![1] - r.chance![0])) / 100, 0));
  const r = def.rewards.find(affordable);
  return r ? Math.max(0, worth(r)) : 0;
}

/**
 * A HotA place's timed bonus (rewardable.ts): extra movement for its days (the Watering Place),
 * a wider sight (the Observatory's apprentice), and only where it helps: no morale penalty for an
 * army of three towns or more (the Temple of Loyalty), a guide through wasteland on a map with some.
 */
function bonusWorth(w: World, h: Hero, b: { type: string; subtype?: string; val: number; turns?: number }): number {
  if (b.type === "MOVEMENT" && b.subtype !== "heroMovementSea") return b.val * (b.turns ?? 1);
  if (b.type === "SIGHT_RADIUS") return 300;
  if (b.type === "NO_ALIGNMENT_PENALTY") return new Set(h.army.filter((x) => x).map((x) => w.creatures[x!.creature]?.faction ?? "neutral")).size >= 3 ? 600 : 0;
  if (b.type === "WASTELAND_GUIDE") return w.map.tiles.some((t) => t.terrain === WASTELAND) ? 300 : 0;
  return 0;
}
/** HotA's wasteland terrain (movement.ts). */
const WASTELAND = 11;

/**
 * @wiki thing/cyclops-stockpile thing/dwarven-treasury thing/griffin-conservatory thing/imp-cache thing/medusa-stores thing/naga-bank thing/dragon-fly-hive thing/shipwreck thing/derelict-ship thing/crypt thing/dragon-utopia thing/pyramid thing/beholders-sanctuary thing/temple-of-the-sea thing/pirate-cavern thing/mansion thing/spit thing/red-tower thing/black-tower thing/ivory-tower thing/churchyard thing/experimental-shop thing/wolf-raider-picket thing/ruins principle/fights-that-pay
 * A creature bank (the original's and HotA's, bankData.ts): the mean of its levels' loot, when its guards are beaten
 * at a margin (more before the level is known).
 */
function bankWorth({ w, o, mine }: Visit): number {
  const bank = BANKS[`${o.type}:${o.subid}`];
  if (!bank || o.bank?.cleared) return 0;
  // The level is rolled on the first visit: what to expect is the chances' mean (the guards of the first level are what the gate test uses).
  const guards = o.bank?.guards ?? bank.levels[0].guards.map(([creature, count]) => ({ creature, count }));
  const worth = (l: (typeof bank.levels)[number]) =>
    (l.resources ?? []).reduce((a, n, i) => a + n * RESOURCE_VALUE[i], 0) + (l.artifacts?.length ?? 0) * 3000 + (l.creatures ?? []).reduce((a, [c, n]) => a + n * (w.creatures[c]?.aiValue ?? 0) * 0.5, 0) + (l.spells ? 600 * l.spells : 0);
  const levels = o.bank ? [bank.levels[o.bank.level]] : bank.levels;
  const total = levels.reduce((a, l) => a + l.chance, 0) || 1;
  const loot = levels.reduce((a, l) => a + (l.chance * worth(l)) / total, 0);
  return mine > 1.8 * army(w, guards) * (o.bank ? 1 : 1.5) ? loot + 1000 : 0;
}

/** Anything without a record: a configurable place, else a creature bank (else nothing). */
function otherWorth(v: Visit): number {
  const def = rewardableDef(v.o);
  return def && !def.bank ? rewardWorth(v, def) : bankWorth(v);
}

/** Every kind of place with a record: by type, or by "type:subtype" where a type holds several kinds. */
const PLACES: Record<string, Place> = {
  [Obj.RESOURCE]: resource,
  [Obj.TREASURE_CHEST]: treasureChest,
  [Obj.CAMPFIRE]: campfire,
  [Obj.ARTIFACT]: artifact,
  [Obj.PANDORAS_BOX]: pandorasBox,
  39: firstVisitorOnly,
  105: firstVisitorOnly,
  22: firstVisitorOnly,
  86: smallPickup,
  29: smallPickup,
  82: smallPickup,
  81: smallPickup,
  93: spellScroll,
  108: warriorsTomb,
  [Obj.MINE]: mineWorth,
  [Obj.ABANDONED_MINE]: abandoned,
  17: dwelling,
  20: guardedDwelling,
  78: refugeeCamp,
  42: lighthouse,
  [Obj.SHIPYARD]: shipyard,
  [Obj.GARRISON]: garrison,
  [Obj.GARRISON2]: garrison,
  [Obj.TOWN]: town,
  [Obj.MONSTER]: monster,
  55: weeklyGold,
  109: weeklyGold,
  112: windmill,
  32: oncePerHero,
  51: oncePerHero,
  23: oncePerHero,
  61: oncePerHero,
  100: oncePerHero,
  4: oncePerHero,
  102: treeOfKnowledge,
  41: library,
  37: hutOfTheMagi,
  58: lookout,
  60: lookout,
  94: stables,
  14: swanPond,
  48: magicSpring,
  49: magicWell,
  96: morale,
  11: morale,
  28: battleBoost,
  52: battleBoost,
  30: battleBoost,
  31: battleBoost,
  110: battleBoost,
  56: battleBoost,
  64: battleBoost,
  38: battleBoost,
  113: witchHut,
  88: shrine,
  89: shrine,
  90: shrine,
  47: school,
  107: school,
  13: cartographer,
  57: obelisk,
  [Obj.PRISON]: prison,
  10: keymaster,
  9: border,
  212: border,
  83: quest,
  215: quest,
  [Obj.WHIRLPOOL]: whirlpool,
  104: university,
  "146:0": university,
  7: blackMarket,
  95: tavern,
  35: hillFort,
  106: warMachineFactory,
  99: tradingPost,
  221: tradingPost,
  2: altarOfSacrifice,
  "144:7": junkman,
  "144:9": warlocksLab,
  213: freelancersGuild,
  "144:1": skeletonTransformer,
  "146:3": townGate,
};
