// The adventure AI's towns: what to build, recruit and research, upgrades, and the marketplace.
import { SPELL } from "../spells.ts";
import { researchRefusal } from "./research.ts";
import { SPELLBOOK_COST, guildLevel } from "./magic.ts";
import { offers } from "./townSpecials.ts";
import { TOWNS } from "../townData.ts";
import { artifactOffer, marketCount, tradeRate } from "./market.ts";
import { allied, cannotHire, heroesOf, mapHeroesOf } from "./rules.ts";
import { B, SHORT_OF_RESOURCES, affordableCount, buildingCost, buildableButForCost, cannotBuild, dwellingId, dwellingLevel, levelCount, meets, townIncome, recruitOffers, townInfo, townUpgrade, upperArmy, visitingHero } from "./town.ts";
import { type Requirement } from "../townData.ts";
import { blackMarketStock, cannotLearnSkill, universityCost, universityOffer } from "./trades.ts";
import { type AdventureState, type AdvObject, type ArmySlot } from "./types.ts";
import { type World } from "./world.ts";
import { personalOrder, traitsOf } from "./aiPersonality.ts";
import { act } from "./ai.ts";
import { army, inReach, power } from "./aiThreat.ts";
import { aiEnv } from "./aiValues.ts";
import { SERVICE_RESERVE, artifactWorth, junkStacks, skillWorth, transformable } from "./aiWorth.ts";

/** (A switch for A/B runs: AI_HALLS=0 plays the old way.) */
const HALLS_FIRST = () => aiEnv("AI_HALLS") !== "0";
const JUMP = aiEnv("AI_HALLS") !== "order";
const SAVE_DAYS = Number(aiEnv("AI_SAVEDAYS") ?? 2);

// Build order: creature dwellings first, then growth and income.
/**
 * Specials worth building early (after the City Hall), by faction: the Treasury, the Fair (more
 * marketplaces), the Portal of Summoning, the Magic University, the Library, the Mana Vortex.
 */
const EARLY_SPECIALS: Record<string, number[]> = { rampart: [22], bulwark: [17], dungeon: [22, 21], conflux: [21], tower: [22] };
export const BUILD_ORDER = [B.FORT, B.TAVERN, B.DWELLING, B.DWELLING + 1, B.DWELLING + 2, B.TOWN_HALL, B.DWELLING + 3, B.CITADEL, B.DWELLING + 4, B.BLACKSMITH, B.MAGE_GUILD_1, B.MARKETPLACE, B.CITY_HALL, B.DWELLING + 5, B.CASTLE, B.DWELLING + 6, B.CAPITOL, dwellingId(7), B.DWELLING_UPG + 6, dwellingId(7, true), B.DWELLING_UPG + 5, B.DWELLING_UPG + 4, B.DWELLING_UPG + 3, B.DWELLING_UPG + 2, B.DWELLING_UPG + 1, B.DWELLING_UPG];

/** Can this stack go into the army (same creature or a free slot)? */
export const fits = (slots: (ArmySlot | null)[], creature: number) => slots.some((x) => !x || x.creature === creature);

/** The building a town needs next on the way to `id` (its base, a missing requirement, then itself), or undefined. */
function stepTo(o: AdvObject, id: number, depth = 0): number | undefined {
  const t = o.town!;
  const b = townInfo(o)?.buildings[id];
  if (!b || t.built.includes(id) || t.forbidden?.includes(id) || depth > 8) return undefined;
  if (b.upgrades !== null && !t.built.includes(b.upgrades)) return stepTo(o, b.upgrades, depth + 1);
  const built = new Set(t.built);
  if (meets(b.requires, built)) return id;
  const missing = (r: Requirement | null): number[] => (r === null || meets(r, built) ? [] : typeof r === "number" ? [r] : r[0] === "any" ? missing(r[1] as Requirement) : r[0] === "none" ? [] : (r.slice(1) as Requirement[]).flatMap(missing));
  for (const r of missing(b.requires)) {
    const x = stepTo(o, r, depth + 1);
    if (x !== undefined) return x;
  }
  return undefined;
}

/**
 * @wiki principle/halls-first The hall the kingdom saves for: the Town Hall, the City Hall, then the Capitol (with the
 * Castle it needs), in the town furthest along; its next step, and the gold it keeps back from every other building
 * until then, once two days' income brings it (not from heroes: an advanced start's rivals then stood still, every
 * hero holding a town; nor from upgrades). A hall pays for itself in five days. Without the saving the AI built whatever fitted the
 * day's gold, the cheap dwellings and specials first, and the halls never did: in the eight-AI race only the winner had
 * a Capitol, on day 59 (2026-11-01, "one AI that gets a Capitol in month 3").
 */
export function hallGoal(s: AdventureState, w: World, player: number): { town: AdvObject; step: number; gold: number; first: boolean } | undefined {
  const towns = s.objects.filter((o) => o.town && !o.removed && o.owner === player);
  const capitol = towns.some((o) => o.town!.built.includes(B.CAPITOL));
  const order = personalOrder(traitsOf(s, player), BUILD_ORDER);
  const level = (o: AdvObject) => [B.TOWN_HALL, B.CITY_HALL, B.CAPITOL].filter((id) => o.town!.built.includes(id)).length;
  const goals = towns
    .map((o) => {
      const hall = [B.TOWN_HALL, B.CITY_HALL, ...(capitol ? [] : [B.CAPITOL])].find((id) => !o.town!.built.includes(id) && !o.town!.forbidden?.includes(id));
      const step = hall === undefined ? undefined : stepTo(o, hall);
      const open = (id: number) => [null, SHORT_OF_RESOURCES, "Already built here today."].includes(cannotBuild(s, w, o, id));
      // (Saved for in its turn of the build order: jumped to the front, the halls and what they need held back the
      // dwellings, and ai:growth's armies at day 28 fell from 50k to 36k.)
      const turn = order.find((id) => !o.town!.built.includes(id) && open(id));
      return { town: o, step, ok: step !== undefined && open(step) && (JUMP || turn === step) };
    })
    .filter((g) => g.ok && g.step !== undefined)
    .sort((a, b) => level(b.town) - level(a.town) || b.town.town!.built.length - a.town.town!.built.length);
  const g = goals[0];
  if (!g) return undefined;
  // (Saved for only when two days' income brings it: a hall weeks off kept 7,000 gold idle, and ai:growth's armies
  // at day 28 fell by a fifth.)
  const gold = buildingCost(w, g.town, g.step!)[6];
  const income = towns.reduce((a, o) => a + townIncome(o)[6], 0);
  // (The first Town Hall is saved for however far off: on a Village Hall's 500 a day it is five days away, and the week's
  // troops took every coin first, so a lone town stayed a village for a month, its gold at 500 and no Fort to hold it
  // with: the owner's game, Brave New World, Teal on day 27, 2026-11-01, "completely stopped playing a week ago or what".)
  const first = aiEnv("AI_FIRSTHALL") !== "0" && !towns.some((o) => o.town!.built.includes(B.TOWN_HALL));
  if (!first && s.players[player].resources[6] + SAVE_DAYS * income < gold) return undefined;
  return { town: g.town, step: g.step!, gold, first };
}

export function manageTowns(s: AdventureState, w: World, player: number) {
  const towns = s.objects.filter((o) => o.town && !o.removed && o.owner === player);
  // The town saving for a hall goes first (the others build with what's left).
  const goal = HALLS_FIRST() ? hallGoal(s, w, player) : undefined;
  if (goal) towns.sort((a, b) => (b === goal.town ? 1 : 0) - (a === goal.town ? 1 : 0));
  sellSurplus(s, w, player);
  // Heroes stuck on their island lately: a shipyard comes first.
  const stuck = s.players[player].aiStuck;
  let order = stuck !== undefined && s.day - stuck < 7 ? [B.SHIPYARD, ...BUILD_ORDER] : BUILD_ORDER;
  // No heroes left: a tavern to hire one comes before anything else.
  if (!heroesOf(s, player).length) order = [B.TAVERN, ...order];
  const traits = traitsOf(s, player);
  const base = personalOrder(traits, order);
  for (const o of towns) {
    const t = o.town!;
    // No hero out on the map (every one holding a town from its garrison): one from the tavern before any building, or
    // nothing on our side moves (2026-10-27, Week three).
    if (!mapHeroesOf(s, player).length && !cannotHire(s, w, o)) act(s, w, player, { type: "hireHero", town: o.id, slot: 0 });
    order = goal?.town === o ? [goal.step, ...base.filter((id) => id !== goal.step)] : base;
    const early = EARLY_SPECIALS[townInfo(o)?.faction ?? ""];
    if (early) order = [...order.slice(0, order.indexOf(B.CITY_HALL) + 1), ...early, ...order.slice(order.indexOf(B.CITY_HALL) + 1)];
    // After the order, with gold to spare (troops come first): the town's other buildings (its
    // specials, the silo...), cheapest first.
    if (s.players[player].resources[6] >= traits.restAt) {
      const rest = Object.keys(townInfo(o)?.buildings ?? {}).map(Number).filter((id) => !order.includes(id) && id !== B.GRAIL).sort((a, b) => buildingCost(w, o, a)[6] - buildingCost(w, o, b)[6]);
      order = [...order, ...rest];
    }
    // No marketplace anywhere and the next building short of wood, ore or a rare resource: a marketplace
    // first (gold can then buy what's short). (Not before: with the resources at hand day 1 is for a dwelling.)
    const shortOf = order.find((id) => !t.built.includes(id) && buildableButForCost(s, w, o, id));
    if (!marketCount(s, player) && shortOf !== undefined && cannotBuild(s, w, o, shortOf) && !t.built.includes(B.MARKETPLACE)) order = [B.MARKETPLACE, ...order];
    // Short of wood, ore or rare resources for the next building: buy them with gold.
    const wantedBuilding = order.find((id) => !t.built.includes(id) && buildableButForCost(s, w, o, id));
    if (wantedBuilding !== undefined && cannotBuild(s, w, o, wantedBuilding)) buyFor(s, w, player, buildingCost(w, o, wantedBuilding));
    // An enemy hero within a day's walk, stronger than what defends the town: walls or a new
    // dwelling first (they defend too), then troops, then buildings with what's left.
    const defenders = army(w, t.garrison) + s.heroes.filter((h) => !h.removed && h.owner === player && w.visitBy[w.index(h.x, h.y, h.z)] === o.id + 1).reduce((a, h) => a + power(w, h), 0);
    const threat = s.heroes.some((e) => !e.removed && e.owner !== player && !allied(s, e.owner, player) && power(w, e) > defenders && inReach(s, w, e, o.x, o.y, o.z));
    const defends = (id: number) => id === B.FORT || id === B.CITADEL || id === B.CASTLE || dwellingLevel(id) !== null;
    // @wiki principle/troops-first The day's troops come first, the building after, with what's left (the AI built
    // first and recruited with the rest: a quarter of the week's creatures it could afford stayed in the dwellings,
    // and towns stood empty; The owner's game, 2026-10-27, "no early recruit"). Troops first won the duel against
    // build-first 58 to 43 of 180, the armies even (2026-10-31). Recruits wait in the garrison, holding the town,
    // until the hero carrying the army comes for them (see carriesArmy). (Under threat the walls come before even them.)
    // (Saving for the first Town Hall, the troops take only what's over: see hallGoal.)
    const keep = goal?.first && !threat ? goal.gold : 0;
    if (!threat) recruitAll(s, w, player, o, true, keep);
    // (Under threat walls or a new dwelling first, its first week's troops recruited at once; then the rest.)
    const wall = threat ? order.find((id) => !t.built.includes(id) && defends(id) && !cannotBuild(s, w, o, id)) : undefined;
    if (wall !== undefined) act(s, w, player, { type: "build", town: o.id, building: wall });
    if (threat) recruitAll(s, w, player, o);
    // Build while it leaves gold for the week's recruits (from week 2 on).
    // (Under threat the troops took their gold first, and what's left is kept for more of them: only what defends the town still builds.)
    const next = order.find((id) => !t.built.includes(id) && !cannotBuild(s, w, o, id));
    const cost = next === undefined ? 0 : buildingCost(w, o, next)[6];
    const saving = goal && next !== goal.step && !goal.town.town!.built.includes(goal.step) ? goal.gold : 0;
    // (The first Town Hall itself keeps nothing back for next week's troops: it pays for them.)
    const firstHall = goal?.first && next === goal.step && goal.town === o;
    const reserve = (s.day > 7 && !firstHall ? Math.max(0, 2500 + traits.reserve) : 0) + (threat ? 0 : saving);
    if (next !== undefined && (!threat || defends(next)) && s.players[player].resources[6] - cost >= reserve) act(s, w, player, { type: "build", town: o.id, building: next });
    recruitAll(s, w, player, o, true, keep);
    townServices(s, w, player, o);
    // A second hero from the first day (it scouts, takes the mines and carries troops to the main
    // one, as the original's AI does), more as the weeks go by; hired after the day's troops, keeping some gold for them after week 1.
    // (It was one more a week from 4000 gold up, so two-player maps went two weeks with a single hero.)
    const wanted = Math.min(2 + Math.floor(s.day / 7) + traits.heroes, 5 + traits.heroes);
    if (mapHeroesOf(s, player).length < wanted && s.players[player].resources[6] >= (s.day > 7 ? 4000 : 2500) && !cannotHire(s, w, o)) act(s, w, player, { type: "hireHero", town: o.id, slot: 0 });
    upgradeAll(s, w, player, o);
  }
}

/** Spells the AI is glad to have in its guilds: the travelling ones it casts, and strong battle spells. */
const WANTED_SPELLS = new Set<number>([SPELL.TOWN_PORTAL, SPELL.DIMENSION_DOOR, SPELL.FLY, SPELL.SLOW, SPELL.HASTE, SPELL.BLESS, SPELL.IMPLOSION, SPELL.CHAIN_LIGHTNING, SPELL.RESURRECTION, SPELL.BLIND, SPELL.BERSERK, SPELL.LIGHTNING_BOLT, SPELL.MAGIC_ARROW, SPELL.METEOR_SHOWER, SPELL.ARMAGEDDON, SPELL.PRAYER, SPELL.ANIMATE_DEAD, SPELL.FIREBALL, SPELL.FROST_RING, SPELL.DEATH_RIPPLE]);

/**
 * What a player does with a town's own services after the day's building and recruiting: the visiting
 * hero learns at the Magic University, sells stragglers at the Freelancer's Guild, turns its living
 * troops into Skeletons, buys a good artifact from the merchants; the Portal of Summoning's creatures
 * are recruited; and with plenty to spare, spell research swaps a dull guild spell for a wanted one.
 */
function townServices(s: AdventureState, w: World, player: number, o: AdvObject) {
  const res = s.players[player].resources;
  const gold = () => res[6] - SERVICE_RESERVE;
  const v = visitingHero(s, w, o);
  const h = v?.owner === player ? v : undefined;
  const at = h && { hero: h.id, object: o.id };
  if (h && at && offers(o, "university")) {
    const best = universityOffer(s, o)
      .filter((k) => !cannotLearnSkill(s, h, o, k, w) && universityCost(o, k).every((n, i) => n <= res[i] - (i === 6 ? SERVICE_RESERVE : 0)))
      .map((k) => ({ k, v: skillWorth(s, w, h, k) }))
      .sort((a, b) => b.v - a.v)[0];
    if (best && best.v > 0) act(s, w, player, { type: "learnSkill", ...at, skill: best.k });
  }
  buyBook(s, w, player, o);
  if (h && at && offers(o, "freelancers")) for (const slot of junkStacks(w, h)) act(s, w, player, { type: "sellStack", ...at, slot, count: h.army[slot]!.count });
  if (h && at && offers(o, "transformer")) {
    const slots = transformable(w, h);
    if (slots.length) act(s, w, player, { type: "transform", ...at, slots });
  }
  if (h && at && offers(o, "artifacts") && gold() > 10000) {
    const markets = marketCount(s, player);
    const picks = blackMarketStock(s, w, o)
      .map((art, slot) => ({ slot, art, price: art >= 0 ? artifactOffer(markets, w.data.artifacts[art]?.cost ?? 0, 6, "buy") : Infinity }))
      .filter((p) => p.art >= 0 && p.price <= gold() - 10000)
      .map((p) => ({ ...p, worth: artifactWorth(s, w, h, p.art) / Math.max(1, p.price) }))
      .sort((a, b) => b.worth - a.worth);
    if (picks[0] && picks[0].worth > 0.3) act(s, w, player, { type: "buyArtifact", ...at, slot: picks[0].slot });
  }
  // The Portal of Summoning: this week's creatures, as many as the gold allows.
  const portal = o.data?.portal as { creature: number; available: number } | undefined;
  const pc = portal && w.creatures[portal.creature];
  if (portal?.available && pc && (fits(upperArmy(s, o), portal.creature) || (h && fits(h.army, portal.creature)))) {
    const n = affordableCount(pc.cost, res, portal.available);
    if (n > 0) act(s, w, player, { type: "recruitPortal", town: o.id, count: n });
  }
  research(s, w, player, o);
}

/**
 * @wiki thing/spell-book A visiting hero without a spellbook buys one where the guild sells it (500 gold, the guild's
 * spells learnt at once): the guild's spells, the scrolls, tomes and magic artifacts on the map count for it only so.
 */
export function buyBook(s: AdventureState, w: World, player: number, o: AdvObject) {
  const h = visitingHero(s, w, o);
  if (h?.owner !== player || h.spells || guildLevel(o) <= 0 || s.players[player].resources[6] < SPELLBOOK_COST + SERVICE_RESERVE) return;
  act(s, w, player, { type: "buySpellbook", hero: h.id });
}

/** Spell research with gold to spare: a guild spell the AI doesn't want swapped for one it does. */
function research(s: AdventureState, w: World, player: number, o: AdvObject) {
  const t = o.town!;
  if (!t.research || !t.guild || s.players[player].resources[6] < 12000) return;
  // An open slot: keep a wanted spell (finalized), else try again another day.
  if (t.researchOffer?.length) {
    const pick = t.researchOffer.find((id) => WANTED_SPELLS.has(id)) ?? t.researchOffer[0];
    act(s, w, player, { type: "researchPick", town: o.id, spell: pick });
  }
  if (t.researchSlot) {
    const [level, slot] = t.researchSlot;
    if (WANTED_SPELLS.has(t.guild[level - 1]?.[slot])) return void act(s, w, player, { type: "researchFinalize", town: o.id });
    if (!researchRefusal(s, o, level, slot)) act(s, w, player, { type: "research", town: o.id, level, slot });
    if (t.researchOffer?.length) act(s, w, player, { type: "researchPick", town: o.id, spell: t.researchOffer.find((id) => WANTED_SPELLS.has(id)) ?? t.researchOffer[0] });
    return;
  }
  // The highest level with a spell it doesn't want, where a wanted one could come (not in the guild yet).
  const spells = w.data.spells ?? [];
  for (let level = t.guild.length; level >= 1; level--) {
    const row = t.guild[level - 1] ?? [];
    const missing = spells.some((sp) => sp.level === level && WANTED_SPELLS.has(sp.id) && !row.includes(sp.id));
    const slot = row.findIndex((id, i) => !WANTED_SPELLS.has(id) && !researchRefusal(s, o, level, i));
    if (!missing || slot < 0) continue;
    if (!act(s, w, player, { type: "research", town: o.id, level, slot })) return;
    if (t.researchOffer?.length) act(s, w, player, { type: "researchPick", town: o.id, spell: t.researchOffer.find((id) => WANTED_SPELLS.has(id)) ?? t.researchOffer[0] });
    if (WANTED_SPELLS.has(t.guild[level - 1]?.[slot])) act(s, w, player, { type: "researchFinalize", town: o.id });
    return;
  }
}

/** With the gold left after recruiting: upgrades in town, the best creatures first (the visiting hero's, then the garrison). */
export function upgradeAll(s: AdventureState, w: World, player: number, o: AdvObject) {
  const slots = [0, 1, 2, 3, 4, 5, 6];
  const stacks = [...slots.map((slot) => ({ slot, who: "hero" as const })), ...slots.map((slot) => ({ slot, who: "garrison" as const }))]
    .map((x) => ({ ...x, up: townUpgrade(s, w, o, x.who, x.slot) }))
    .filter((x) => x.up);
  stacks.sort((x, y) => (w.creatures[y.up!.stack.creature]?.level ?? 0) - (w.creatures[x.up!.stack.creature]?.level ?? 0));
  // (Not with the gold kept for a hall.)
  const goal = stacks.length && HALLS_FIRST() && aiEnv("AI_SAVEUP") === "1" ? hallGoal(s, w, player) : undefined;
  const keep = goal ? goal.gold : 0;
  for (const x of stacks) {
    // (Priced again: the stronger stacks' upgrades came first.)
    const up = townUpgrade(s, w, o, x.who, x.slot);
    if (up && affordableCount(up.cost, s.players[player].resources.map((n, i) => (i === 6 ? n - keep : n)), 1)) act(s, w, player, { type: "upgradeInTown", town: o.id, who: x.who, slot: x.slot });
  }
}

/** Short of gold with resources piling up: sells what's beyond a comfortable stock. */
function sellSurplus(s: AdventureState, w: World, player: number) {
  const markets = marketCount(s, player);
  const res = s.players[player].resources;
  if (!markets || res[6] >= 5000) return;
  const keep = [30, 15, 30, 15, 15, 15];
  for (let r = 0; r < 6; r++) {
    const extra = res[r] - keep[r];
    if (extra > 5) act(s, w, player, { type: "trade", from: r, to: 6, lots: extra });
  }
}

/** Buys the resources missing for `cost` with gold at the marketplace, if that leaves enough gold. */
function buyFor(s: AdventureState, w: World, player: number, cost: number[]) {
  const markets = marketCount(s, player);
  if (!markets) return;
  const res = s.players[player].resources;
  let gold = res[6] - cost[6] - 1000;
  const plan: { r: number; lots: number }[] = [];
  for (let r = 0; r < 6; r++) {
    const missing = cost[r] - res[r];
    if (missing <= 0) continue;
    const { give } = tradeRate(markets, 6, r);
    gold -= missing * give;
    plan.push({ r, lots: missing });
  }
  if (gold < 0) return;
  for (const { r, lots } of plan) act(s, w, player, { type: "trade", from: 6, to: r, lots });
}

/**
 * Buys everything affordable, best creatures first, without running out of army slots. Recruits land
 * in the garrison (as in the original); with a hero of ours visiting, they go on to the hero, as a
 * player would drag them down.
 */
export function recruitAll(s: AdventureState, w: World, player: number, o: AdvObject, toHero = true, keepGold = 0) {
  const t = o.town!;
  const info = TOWNS[o.subid];
  if (!info) return;
  const hero = visitingHero(s, w, o);
  // (Down to the visiting hero only when it carries the army: `toHero` false keeps them in the garrison.)
  const ours = hero?.owner === player && toHero ? hero : undefined;
  const room = (creature: number) => fits(upperArmy(s, o), creature) || (!!ours && fits(ours.army, creature));
  for (let l = levelCount(o) - 1; l >= 0; l--) {
    if (!t.available[l]) continue;
    // The upgrade if there's room for it, else the basic creature (not HotA's second upgrade).
    const offer = recruitOffers(o, l).find((x) => !x.second && room(x.creature));
    const c = offer && w.creatures[offer.creature];
    if (!c) continue;
    const res = s.players[player].resources;
    const afford = affordableCount(c.cost, keepGold ? res.map((v, r) => (r === 6 ? Math.max(0, v - keepGold) : v)) : res, t.available[l]);
    if (afford <= 0) continue;
    const { creature, upgraded } = offer;
    const inGarrison = () => upperArmy(s, o).reduce((n, x) => n + (x?.creature === creature ? x.count : 0), 0);
    const before = inGarrison();
    if (!act(s, w, player, { type: "recruit", town: o.id, level: l, upgraded, count: afford }) || !ours) continue;
    // Down to the visiting hero: what was just recruited (the garrison's own troops stay).
    const added = inGarrison() - before;
    const from = upperArmy(s, o).findIndex((x) => x?.creature === creature);
    const same = ours.army.findIndex((x) => x?.creature === creature);
    const to = same >= 0 ? same : ours.army.findIndex((x) => !x);
    if (added > 0 && from >= 0 && to >= 0) act(s, w, player, { type: "moveStack", town: o.id, from: { who: "garrison", slot: from }, to: { who: "hero", slot: to }, count: added });
  }
}

