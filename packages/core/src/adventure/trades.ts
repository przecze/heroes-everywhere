// Trading with what stands on the map or in a town: the Black Market and Artifact Merchants, the
// Freelancer's Guild, the Skeleton Transformer, the Junkman, the altars, the Town Gate (tradeAt), and
// the prices and refusals of the Hill Fort, Universities and Blacksmiths, for the rules, the windows
// and the AI alike.
import type { AdventureAction, AdventureEvent } from "./rules.ts";
import { type AdventureState, type AdvObject, type Hero, RESOURCE_NAMES } from "./types.ts";
import { type World } from "./world.ts";
import { Refusal } from "../refusal.ts";
import { B, pay, specialUpgradeOf, townInfo, visitingHero } from "./town.ts";
import { HERO_CLASSES } from "../heroData.ts";
import { SKILLS, SKILL_NAMES, skillLevel } from "../skills.ts";
import { skillAllowed } from "./bans.ts";
import { UPGRADE_OF } from "./rules.ts";
import { randInt } from "../rng.ts";
import { SPECIAL, hasSpecial, offers } from "./townSpecials.ts";
import { CANNON, MACHINE_SLOT, initEquipment, machinePrice, giveArtifact, randomArtifactPool, takeArtifact } from "./artifacts.ts";
import { useTownGate } from "./advSpells.ts";
import { maxMana } from "./magic.ts";
import { maxMovement } from "./movement.ts";
import { gainExperience } from "./combat.ts";
import { BLACK_MARKET_MARKETS, FREELANCER_MAP_MARKETS, JUNKMAN_MARKETS, artifactOffer, creatureOffer, marketCount } from "./market.ts";

const BLACKSMITH: Record<string, number> = {
  castle: 4, dungeon: 4, conflux: 4, rampart: 6, necropolis: 6, fortress: 6, tower: 5, stronghold: 5, inferno: 5, cove: CANNON, factory: 5, bulwark: 6,
};

/** What a University or HotA's Seafaring Academy charges for a skill. */
export const UNIVERSITY_COST = 2000;
/** The Magic University's schools and the resource each costs besides the gold (heroes.thelazy.net: 5 gems, mercury, sulfur, crystal). */
const MAGIC_SCHOOLS = ["airMagic", "fireMagic", "earthMagic", "waterMagic"] as const;
const SCHOOL_RESOURCE: Record<string, number> = { airMagic: 5, fireMagic: 1, earthMagic: 3, waterMagic: 4 };

type TradeAction = Extract<AdventureAction, { type: "buyArtifact" | "sellStack" | "transform" | "townGate" | "sellArtifact" | "sacrifice" }>;

/** A trade by a hero standing at the object (checked by the caller). */
export function tradeAt(s: AdventureState, w: World, player: number, h: Hero, o: AdvObject, action: TradeAction): AdventureEvent[] {
  const res = s.players[player].resources;
  if (action.type === "buyArtifact") {
    if (!offers(o, "artifacts")) throw new Refusal("no artifacts for sale here");
    const stock = blackMarketStock(s, w, o);
    const art = stock[action.slot];
    if (art === undefined || art < 0) throw new Refusal("sold out");
    // Priced by the resource paid with and the marketplaces owned; the Black Market as five of
    // them (2.5 times the artifact's price in gold, heroes.thelazy.net/index.php/Black_Market).
    const r = paidIn(action.resource);
    const price = artifactOffer(o.town ? marketCount(s, player) : BLACK_MARKET_MARKETS, w.data.artifacts[art]?.cost ?? 0, r, "buy");
    if (res[r] < price) throw new Refusal(`It costs ${price} ${RESOURCE_NAMES[r]}.`);
    res[r] -= price;
    stock[action.slot] = -1;
    giveArtifact(h, w.data.artifacts, art);
    return [];
  }
  if (action.type === "transform") {
    if (!offers(o, "transformer")) throw new Refusal("no Skeleton Transformer here");
    if (action.slots.some((slot) => !h.army[slot])) throw new Refusal("no creatures there");
    for (const slot of new Set(action.slots)) h.army[slot]!.creature = skeletonOf(w, h.army[slot]!.creature);
    // Stacks that are now the same creature merge.
    h.army.forEach((a, i) => {
      if (!a) return;
      const j = h.army.findIndex((b, k) => k < i && b?.creature === a.creature);
      if (j >= 0) {
        h.army[j]!.count += a.count;
        h.army[i] = null;
      }
    });
    h.maxMovement = maxMovement(w, h);
    return [];
  }
  if (action.type === "townGate") {
    if (o.type !== 146 || o.subid !== 3) throw new Refusal("no Town Gate here");
    const msg = useTownGate(s, w, h, action.town);
    s.log.push(msg);
    return [{ e: "teleport", hero: h.id, object: o.id, to: w.index(h.x, h.y, h.z) }];
  }
  if (action.type === "sellArtifact") {
    // Paid in the resource asked for, by the marketplaces owned; HotA's Junkman as seven of them
    // (half the price in gold, heroes.thelazy.net/index.php/Junkman).
    const r = paidIn(action.resource);
    const price = junkmanPrice(w, action.artifact) && artifactOffer(o.town ? marketCount(s, player) : JUNKMAN_MARKETS, w.data.artifacts[action.artifact]?.cost ?? 0, r, "sell");
    if (!offers(o, "sellArtifacts") || !price) throw new Refusal("Nobody here takes that.");
    if (!takeArtifact(h, action.artifact, false)) throw new Refusal("The hero doesn't have it.");
    res[r] += price;
    h.maxMovement = maxMovement(w, h);
    return [];
  }
  if (action.type === "sacrifice" && o.type === 146 && o.subid === 2) {
    // Altar of Mana (HotA): creatures for spell points (AI value / 80 each), up to 4x the hero's maximum.
    const mana = sacrificeCreatures(h, action.stacks ?? [], (c) => creatureManaValue(w, c));
    h.mana = Math.min(4 * maxMana(h), (h.mana ?? 0) + Math.floor(mana));
    h.maxMovement = maxMovement(w, h);
    return [];
  }
  if (action.type === "sacrifice") {
    if (!offers(o, "altar")) throw new Refusal("no altar here");
    let xp = 0;
    if (isEvil(h)) xp = sacrificeCreatures(h, action.stacks ?? [], (c) => creatureSacrificeXp(w, c));
    else {
      // Artifacts by id: from the backpack first, then worn. All checked before any goes.
      const ids = action.artifacts ?? [];
      if (ids.some((id) => !artifactSacrificeXp(w, id))) throw new Refusal("That can't be sacrificed.");
      const owned = (id: number) => [...(h.backpack ?? []), ...(h.equipped ?? [])].filter((x) => x === id).length;
      if (ids.some((id) => ids.filter((x) => x === id).length > owned(id))) throw new Refusal("The hero doesn't have it.");
      for (const id of ids) {
        takeArtifact(h, id);
        xp += artifactSacrificeXp(w, id);
      }
    }
    if (!xp) throw new Refusal("Nothing to sacrifice.");
    const notes = gainExperience(s, w, h, xp);
    h.maxMovement = maxMovement(w, h);
    s.log.push(`${h.name} sacrifices at the altar.`, ...notes);
    return [];
  }
  if (action.type === "sellStack") {
    if (!offers(o, "freelancers")) throw new Refusal("no Freelancer's Guild here");
    const stack = h.army[action.slot];
    if (!stack || !Number.isInteger(action.count) || action.count <= 0 || action.count > stack.count) throw new Refusal("nothing to sell");
    if (action.count === stack.count && h.army.filter(Boolean).length <= 1) throw new Refusal("A hero needs at least one stack.");
    // Paid by the marketplaces owned at a town's guild, as five on the map (70%), in the resource asked for.
    const r = paidIn(action.resource);
    const price = freelancerPrice(w, stack.creature, action.count, o.town ? marketCount(s, player) : FREELANCER_MAP_MARKETS, r);
    if (!price) throw new Refusal(`Too few to be worth any ${RESOURCE_NAMES[r]}.`);
    res[r] += price;
    stack.count -= action.count;
    if (!stack.count) h.army[action.slot] = null;
    h.maxMovement = maxMovement(w, h);
    return [];
  }
  throw new Refusal("nothing to trade");
}

/** Heroes of Inferno, Necropolis and Dungeon sacrifice creatures at the altar; the rest artifacts. */
export function isEvil(h: Hero): boolean {
  return ["inferno", "necropolis", "dungeon"].includes(HERO_CLASSES[h.heroClass]?.faction ?? "");
}

/** Experience for one creature on the altar (VCMI: AI value / 40, times 5). */
export function creatureSacrificeXp(w: World, creature: number): number {
  return Math.floor((w.creatures[creature]?.aiValue ?? 0) / 40) * 5;
}

/** What a creature becomes in the Skeleton Transformer: a Skeleton, or its own choice (dragons: Bone Dragons). */
export function skeletonOf(w: World, creature: number): number {
  const target = w.creatures[creature]?.abilities.find((a) => a.type === "SKELETON_TRANSFORMER_TARGET")?.subtype;
  const id = target ? w.creatures.findIndex((c) => c?.key === target) : -1;
  return id >= 0 ? id : 56;
}

/** Spell points for one creature on the Altar of Mana. */
export function creatureManaValue(w: World, creature: number): number {
  return (w.creatures[creature]?.aiValue ?? 0) / 80;
}

/** Experience for an artifact on the altar: 1000 / 1500 / 3000 / 6000 by class. */
export function artifactSacrificeXp(w: World, id: number): number {
  // Not the spellbook, scrolls, the Grail or war machines.
  if (id < 7) return 0;
  return ({ T: 1000, N: 1500, J: 3000, R: 6000 } as Record<string, number>)[w.data.artifacts[id]?.tier ?? ""] ?? 0;
}

/** What the Junkman pays for an artifact in gold: half its price (not scrolls, war machines, spellbooks or the Grail; 0 for those). */
export function junkmanPrice(w: World, id: number): number {
  if (id < 7) return 0;
  return Math.floor((w.data.artifacts[id]?.cost ?? 0) / 2);
}

/** The resource a trade is paid in: gold unless another is asked for. */
function paidIn(r = 6): number {
  if (!Number.isInteger(r) || r < 0 || r > 6) throw new Refusal("no such resource");
  return r;
}

/**
 * Takes creatures for an altar ([slot, count] pairs), all checked before any are taken, never the
 * hero's last ones; returns what they were worth.
 */
function sacrificeCreatures(h: Hero, stacks: [number, number][], worth: (creature: number) => number): number {
  const want = new Map<number, number>();
  for (const [slot, count] of stacks) {
    if (!Number.isInteger(count) || count <= 0) throw new Refusal("not that many creatures");
    want.set(slot, (want.get(slot) ?? 0) + count);
  }
  for (const [slot, n] of want) if (!h.army[slot] || n > h.army[slot]!.count) throw new Refusal("not that many creatures");
  if (!h.army.some((st, i) => st && st.count > (want.get(i) ?? 0))) throw new Refusal("The hero can't sacrifice the last creatures.");
  let value = 0;
  for (const [slot, n] of want) {
    const st = h.army[slot]!;
    value += worth(st.creature) * n;
    st.count -= n;
    if (!st.count) h.army[slot] = null;
  }
  return value;
}

/** The Black Market's seven artifacts (treasure, minor or major), restocked every month. */
export function blackMarketStock(s: AdventureState, w: World, o: AdvObject): number[] {
  const month = Math.floor((s.day - 1) / 28);
  if (!Array.isArray(o.data?.stock) || o.data.month !== month) {
    // (Priced artifacts only: the game's table has no price for HotA's own.)
    const pool = randomArtifactPool(w.data.artifacts, "TNJ", s.banned?.artifacts)
      .filter((id) => (w.data.artifacts[id]?.cost ?? 0) > 0)
      .map((id) => ({ id }));
    // The first month's: what the map chose (HotA 1.7: o.data.chosen, -1 random).
    const chosen = month === 0 ? ((o.data?.chosen as number[] | undefined) ?? []) : [];
    const roll = lookRng(s, o, month);
    const stock: number[] = [];
    for (let i = 0; i < 7 && pool.length; i++) {
      const pick = chosen[i] ?? -1;
      stock.push(pick >= 0 ? pick : pool.splice(randInt(roll, 0, pool.length - 1), 1)[0].id);
    }
    o.data = { ...(o.data ?? {}), stock, month };
  }
  return o.data!.stock as number[];
}

/** What the Freelancer's Guild pays for `count` creatures in `resource`, by the marketplaces owned (as five on the adventure map). */
export function freelancerPrice(w: World, creature: number, count: number, markets = FREELANCER_MAP_MARKETS, resource = 6): number {
  return creatureOffer(markets, w.creatures[creature]?.cost[6] ?? 0, count, resource);
}

/** Hill Fort: the price difference, free at level 1 and cheaper below level 5 (25% / 50% / 75%). */
export function hillFortCost(w: World, from: number, to: number, count: number): number[] {
  const a = w.creatures[from];
  const b = w.creatures[to];
  const factor = [0, 0, 25, 50, 75, 100, 100, 100][a?.level ?? 7] ?? 100;
  return b.cost.map((n, i) => Math.max(0, Math.ceil(((n - (a?.cost[i] ?? 0)) * count * factor) / 100)));
}

/** What a Hill Fort makes of this army stack (specialists' special upgrades too) and for how much; null if nothing. */
export function hillFortUpgrade(w: World, h: Hero, slot: number): { to: number; cost: number[] } | null {
  const stack = h.army[slot];
  const to = stack ? (specialUpgradeOf(w, stack.creature, h) ?? UPGRADE_OF[stack.creature]) : undefined;
  return stack && to !== undefined ? { to, cost: hillFortCost(w, stack.creature, to, stack.count) } : null;
}

/**
 * A generator for what an object offers on the first look, branched off the game's own so that
 * looking (the screen, the AI, a refused purchase) never moves it: a refusal changes nothing.
 */
function lookRng(s: AdventureState, o: AdvObject, salt = 0) {
  return { rng: (s.rng ^ Math.imul(o.id + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) | 0 };
}

/** The four skills a University teaches (rolled on the first look; never Necromancy). */
export function universityOffer(s: AdventureState, o: AdvObject, seafaring = o.type === 146): number[] {
  // The Conflux's Magic University: the four schools of magic.
  if (o.town) return MAGIC_SCHOOLS.map((k) => SKILLS.indexOf(k));
  if (Array.isArray(o.data?.skills)) return o.data.skills as number[];
  // The Seafaring Academy (HotA): three skills, always Navigation.
  const navigation = SKILLS.indexOf("navigation");
  // (A HotA map may name the skills it teaches from: o.data.allowed.)
  const allowed = o.data?.allowed as number[] | undefined;
  const pool = SKILLS.map((_, i) => i).filter((i) => SKILLS[i] !== "necromancy" && i < 28 && !(seafaring && i === navigation) && skillAllowed(s, i) && (!allowed?.length || allowed.includes(i)));
  const out: number[] = seafaring ? [navigation] : [];
  const roll = lookRng(s, o);
  while (out.length < (seafaring ? 3 : 4) && pool.length) out.push(pool.splice(randInt(roll, 0, pool.length - 1), 1)[0]);
  o.data = { ...(o.data ?? {}), skills: out };
  return out;
}

/** What learning a skill here costs (seven resources): 2000 gold, and at the Magic University 5 of the school's resource. */
export function universityCost(o: AdvObject, skill: number): number[] {
  const cost = [0, 0, 0, 0, 0, 0, UNIVERSITY_COST];
  const r = o.town ? SCHOOL_RESOURCE[SKILLS[skill]] : undefined;
  if (r !== undefined) cost[r] = 5;
  return cost;
}

/**
 * Why the hero can't learn this skill here (a University, HotA's Seafaring Academy or Bulwark's
 * Sieidi of Runes), gold aside; null when they can. The rules, the AI and the windows all ask this.
 */
export function cannotLearnSkill(s: AdventureState, h: Hero, o: AdvObject, skill: number, w?: World): string | null {
  const skills = h.skills ?? [];
  // Sieidi of Runes (Bulwark): Runes, for Chieftains, Elders and scholars.
  if (offers(o, "runes") && skill === SKILLS.indexOf("runes")) {
    const cls = HERO_CLASSES[h.heroClass]?.key;
    if (cls !== "chieftain" && cls !== "elder" && !skillLevel(h.skills, "scholar")) return "Only Chieftains, Elders and heroes with Scholar can learn Runes here.";
    if (skills.some(([k]) => k === skill)) return `${h.name} already knows Runes.`;
    if (skills.length >= 8) return `${h.name} can't learn more skills.`;
    return null;
  }
  if (!offers(o, "university") || !universityOffer(s, o).includes(skill)) return "not taught here";
  // The Magic University teaches no school banned for the hero's class.
  if (o.town && w?.data.classSkillOdds?.[h.heroClass]?.[skill] === 0) return `${h.name}'s class can't learn ${SKILL_NAMES[skill]}.`;
  const known = skills.find(([k]) => k === skill);
  // The Seafaring Academy also improves a skill the hero has.
  const academy = o.type === 146 && o.subid === 0;
  if (known && (!academy || known[1] >= 3)) return `${h.name} already knows it.`;
  if (!known && skills.length >= 8) return `${h.name} can't learn more skills.`;
  return null;
}

/** The war machine the town's Blacksmith sells (artifact id). */
export function blacksmithMachine(o: AdvObject): number {
  return BLACKSMITH[townInfo(o)?.faction ?? "castle"] ?? 4;
}

/** Why the town's Blacksmith can't sell its machine right now (or null). */
export function cannotBuyMachine(s: AdventureState, w: World, o: AdvObject): string | null {
  if (!o.town?.built.includes(B.BLACKSMITH)) return "Build a Blacksmith first.";
  const hero = visitingHero(s, w, o);
  if (!hero) return "Only a visiting hero can receive it.";
  const art = blacksmithMachine(o);
  if (hero.equipped?.[MACHINE_SLOT[art]] === art) return `${hero.name} already has one.`;
  const cost = machinePrice(w, art);
  if (s.players[o.owner].resources[6] < cost) return `It costs ${cost} gold.`;
  return null;
}

/** What a war machine factory sells: HotA's Cannon Yard (subtype 1) only the cannon. */
export function factoryMachines(o: AdvObject): number[] {
  return o.subid === 1 ? [CANNON] : [4, 5, 6];
}

/** Why the hero can't buy this war machine here (a War Machine Factory, Stronghold's Ballista Yard); null when they can. */
export function cannotBuyMachineAt(s: AdventureState, w: World, h: Hero, o: AdvObject, artifact: number, player: number): string | null {
  const yard = hasSpecial(o, "stronghold", SPECIAL.s3) && artifact === 4;
  if ((o.type !== 106 && !yard) || !(yard || factoryMachines(o).includes(artifact))) return "not for sale here";
  if (h.equipped?.[MACHINE_SLOT[artifact]] === artifact) return `${h.name} already has one.`;
  const cost = machinePrice(w, artifact);
  if (s.players[player].resources[6] < cost) return `It costs ${cost} gold.`;
  return null;
}

/** Buys a war machine at a War Machine Factory or Stronghold's Ballista Yard (the hero standing there). */
export function buyMachineAt(s: AdventureState, w: World, h: Hero, o: AdvObject, artifact: number, player: number): AdventureEvent[] {
  const why = cannotBuyMachineAt(s, w, h, o, artifact, player);
  if (why) throw new Refusal(why);
  initEquipment(h);
  s.players[player].resources[6] -= machinePrice(w, artifact);
  h.equipped![MACHINE_SLOT[artifact]] = artifact;
  return [];
}

/** The hero learns a skill at a Magic University or a town's (Sieidi of Runes: free). */
export function learnSkillAt(s: AdventureState, w: World, h: Hero, o: AdvObject, skill: number, player: number): AdventureEvent[] {
  const why = cannotLearnSkill(s, h, o, skill, w);
  if (why) throw new Refusal(why);
  const skills = (h.skills ??= []);
  if (offers(o, "runes") && skill === SKILLS.indexOf("runes")) {
    skills.push([skill, 1]);
    return [];
  }
  const known = skills.find(([k]) => k === skill);
  pay(s.players[player].resources, universityCost(o, skill));
  if (known) known[1]++;
  else skills.push([skill, 1]);
  return [];
}

/** A Hill Fort upgrades one of the hero's stacks (specialists' special upgrades, Gelu's Sharpshooters, too). */
export function upgradeAtHillFort(s: AdventureState, w: World, h: Hero, o: AdvObject, slot: number, player: number): AdventureEvent[] {
  if (o.type !== 35) throw new Refusal("no Hill Fort here");
  const up = hillFortUpgrade(w, h, slot);
  if (!up) throw new Refusal("can't be upgraded");
  pay(s.players[player].resources, up.cost);
  h.army[slot]!.creature = up.to;
  return [];
}
