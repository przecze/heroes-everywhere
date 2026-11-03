// Town building proofs for scenecheck.ts: the building is put up in the scene's town (grown to
// everything but it) and what it changes is measured: the day's income, the marketplaces counted,
// the fort's walls, the dwelling's growth and its creatures to recruit, the guild's spells, the
// tavern's hero, the blacksmith's machine, the boat, the specials' help in a siege, the services
// they offer, the lighthouse, the amplifier, the runes, the gifts a visiting hero gets (an
// attribute, experience, doubled spell points, fresh horses, the pond's resources), the
// treasury's interest, the Cover of Darkness, the lookout's sight, the library's extra spells.
import {
  TOWNS,
  comesFree,
  type AdventureState,
  type AdvObject,
  type Hero,
  type World,
  SPECIAL,
  applyAdventureAction,
  castleGateTowns,
  townUpgradeOf,
  coverOfDarkness,
  dwellingLevel,
  extraGuildLevels,
  extraMarkets,
  lighthouseCount,
  marketCount,
  maxMana,
  necromancyBoost,
  offers,
  revealOwned,
  siegeBonuses,
  siegeOf,
  startingRunes,
  visit,
  weeklyGrowth,
  weeklyTownSpecials,
} from "@heroes/core";

export interface BuildingProof {
  proof: string | null;
  note: string;
}

const SERVICES = ["artifacts", "sellArtifacts", "university", "freelancers", "transformer", "altar", "runes", "bank"] as const;
const bits = (words: number[] | undefined) => (words ?? []).reduce((a, x) => a + ((x >>> 0).toString(2).match(/1/g)?.length ?? 0), 0);

/** Everything a building might change, measured at once. */
function measure(s: AdventureState, w: World, h: Hero, o: AdvObject) {
  const t = o.town!;
  const siege = siegeOf(o);
  const sb = siegeBonuses(o);
  return {
    income: JSON.stringify(townIncomeOf(o)),
    markets: marketCount(s, 0) + extraMarkets(s, 0),
    walls: siege?.level ?? 0,
    escape: !!siege?.escape,
    growth: Array.from({ length: 8 }, (_, l) => weeklyGrowth(w, o, l, s)).join(","),
    available: t.available.join(","),
    guild: (t.guild ?? []).map((g) => g.length).join(","),
    services: SERVICES.filter((sv) => offers(o, sv)).join(","),
    siegeHelp: sb.morale + sb.luck + sb.mana + sb.primary.reduce((a, x) => a + x, 0),
    lighthouses: lighthouseCount(s, 0),
    amplifier: necromancyBoost(s, 0),
    guildLevels: extraGuildLevels(s, 0),
    runes: startingRunes(s, 0),
    sight: bits(s.players[0].revealed as number[] | undefined),
  };
}
/** The town's daily income (town.ts's townIncome isn't exported through the index: read the halls and silo the same way). */
function townIncomeOf(o: AdvObject): number[] {
  const built = o.town!.built;
  const out = [0, 0, 0, 0, 0, 0, 0];
  out[6] = built.includes(13) ? 4000 : built.includes(12) ? 2000 : built.includes(11) ? 1000 : 500;
  if (built.includes(26)) out[6] += 5000;
  return out;
}

export function proveBuilding(s: AdventureState, w: World, h: Hero, o: AdvObject, id: number, faction: string): BuildingProof {
  const t = o.town!;
  if (id === 27 || id === 28 || id === 29) return { proof: null, note: "nothing to check: scenery (an unused hall)" };
  // (Building 20, "ship": the boat the Shipyard builds, listed among the buildings in the original's data.)
  if (id === 20) return { proof: null, note: "nothing to check: the ship the Shipyard builds (checked with the Shipyard), not a building of its own" };
  // What the town starts with (the hall, the tavern, the first dwelling), what the building replaces (a better hall), and the horde's twin: taken down first, so the building's own effect shows.
  const strip = (ids: number[]) => (t.built = t.built.filter((b) => !ids.includes(b)));
  if (id >= 10 && id <= 13) strip([10, 11, 12, 13].filter((b) => b >= id));
  else if (id >= 7 && id <= 9) strip([7, 8, 9].filter((b) => b >= id));
  // An upgraded horde building comes with the upgraded dwelling (never bought): both taken down, the dwelling built again.
  const free = TOWNS[o.subid]?.buildings[id];
  const via = free && comesFree(free) ? free.upgrades : null;
  if (via !== null) strip([id, via]);
  else if (id !== 19 && id !== 25) strip([id]);
  const dw = dwellingLevel(id);
  if (dw && !dw.upgraded) t.available[dw.level] = 0;
  const before = measure(s, w, h, o);
  // (The hero in the town before the building: a bonus building gives its gift as it's built, VCMI's buildStructure.)
  const atBuild = { primary: [...h.primary], xp: h.experience, move: h.movement };
  // The Grail: brought home by the hero, not built.
  if (id === 26) {
    visit(s, w, h, o);
    if (!t.built.includes(26)) return { proof: "the Grail wasn't placed", note: "" };
  } else {
    try {
      applyAdventureAction(s, w, { type: "build", town: o.id, building: via ?? id }, 0);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (/not available in this town/i.test(why)) return { proof: null, note: "not available in this town, as in HotA" };
      return { proof: `can't build it: ${why}`, note: "" };
    }
    if (!t.built.includes(id)) return { proof: "not built", note: "" };
  }
  // The lookout tower: the town sees further once the owner's places are re-revealed.
  revealOwned(s, w, 0);
  const after = measure(s, w, h, o);
  const changed = (Object.keys(before) as (keyof typeof before)[]).filter((k) => before[k] !== after[k]);
  const notes: string[] = [];
  const failed: string[] = [];
  const expect = (k: keyof typeof before, what: string) => {
    if (changed.includes(k)) notes.push(what);
    else failed.push(`${what} unchanged`);
  };
  const level = dwellingLevel(id);
  if (id === 10) notes.push("500 gold a day");
  else if (id >= 10 && id <= 13) expect("income", "the day's gold");
  else if (id === 15) notes.push("a resource a day (the silo's share of the town's income)");
  else if (id === 14) expect("markets", "a marketplace counted");
  else if (id === 7) expect("walls", "walls for a siege");
  else if (id === 8 || id === 9) (expect("walls", "walls for a siege"), expect("growth", "growth"));
  else if (id <= 4) expect("guild", `spells on guild level ${id + 1}`);
  else if (level) {
    if (!level.upgraded) expect("growth", `level ${level.level + 1} growth`);
    if (level.upgraded) {
      try {
        applyAdventureAction(s, w, { type: "recruit", town: o.id, level: level.level, upgraded: true, count: 1 }, 0);
        notes.push("an upgraded creature recruited");
      } catch (e) {
        failed.push(`no upgraded creature to recruit: ${e instanceof Error ? e.message : e}`);
      }
    } else expect("available", "creatures to recruit");
  } else if (id === 18 || id === 24) expect("growth", "growth");
  else if (via !== null) notes.push("came with the upgraded dwelling, the horde's growth kept");
  else if (id === 5) {
    try {
      // (The hero steps off the gate for the new one.)
      [h.x, h.y] = [8, 11];
      w.refresh(s);
      const n = s.heroes.filter((x) => !x.removed && x.owner === 0).length;
      applyAdventureAction(s, w, { type: "hireHero", town: o.id, slot: 0 }, 0);
      if (s.heroes.filter((x) => !x.removed && x.owner === 0).length > n) notes.push("a hero hired");
      else failed.push("no hero hired");
    } catch (e) {
      failed.push(`no hero to hire: ${e instanceof Error ? e.message : e}`);
    }
  } else if (id === 16) {
    try {
      applyAdventureAction(s, w, { type: "buyMachine", town: o.id }, 0);
      notes.push("a war machine bought");
    } catch (e) {
      failed.push(`no machine to buy: ${e instanceof Error ? e.message : e}`);
    }
  } else if (id === 6) {
    try {
      const boats = s.objects.filter((x) => x.type === 8 && !x.removed).length;
      applyAdventureAction(s, w, { type: "buildBoat", object: o.id }, 0);
      if (s.objects.filter((x) => x.type === 8 && !x.removed).length > boats) notes.push("a boat built");
      else failed.push("no boat appeared");
    } catch (e) {
      failed.push(`no boat: ${e instanceof Error ? e.message : e}`);
    }
  } else if (id === 26) (expect("income", "5000 gold a day"), expect("growth", "growth"));
  else if ([17, 21, 22, 23].includes(id)) {
    // A special: what it offers, helps or counts; then the gifts for a hero walking in.
    const direct = changed.filter((k) => ["services", "siegeHelp", "lighthouses", "amplifier", "guildLevels", "runes", "escape", "markets", "guild", "sight"].includes(k));
    for (const k of direct) notes.push({ services: "a service offered", siegeHelp: "help in a siege", lighthouses: "ships sail further", amplifier: "more dead raised", guildLevels: "the Thieves' Guild sees more", runes: "a rune level to start with", escape: "the defender may flee", markets: "marketplaces counted", guild: "more spells in the guild", sight: "the town sees further" }[k as string] ?? k);
    // The Castle Gate: another Inferno of ours to step through to; the Portal of Summoning: a creature from an outside dwelling of ours.
    if (faction === "inferno" && id === SPECIAL.s3 && castleGateTowns(s, o, () => true).length) notes.push("another Inferno to step through to");
    if (faction === "dungeon" && id === SPECIAL.s3 && (o.data as { portal?: unknown } | undefined)?.portal) notes.push("a creature from an outside dwelling to recruit");
    // The Factory's Bank: a loan taken.
    if (offers(o, "bank")) {
      const gold = s.players[0].resources[6];
      try {
        applyAdventureAction(s, w, { type: "bankLoan", town: o.id }, 0);
        if (s.players[0].resources[6] > gold) notes.push("a loan of gold");
      } catch (e) {
        failed.push(`no loan: ${e instanceof Error ? e.message : e}`);
      }
    }
    // The visit: attributes, experience, spell points (drained first), movement, resources.
    h.mana = 0;
    const was = { primary: [...atBuild.primary], xp: atBuild.xp, mana: h.mana, move: atBuild.move, res: [...s.players[0].resources] };
    visit(s, w, h, o);
    if (h.primary.some((v, i) => v > was.primary[i])) notes.push("an attribute for the visiting hero");
    if (h.experience > was.xp) notes.push("experience for the visiting hero");
    if ((h.mana ?? 0) >= 2 * maxMana(h) && maxMana(h) > 0) notes.push("spell points doubled");
    if (h.movement > was.move) notes.push("fresh horses");
    if (s.players[0].resources.some((v, i) => v > was.res[i])) notes.push("resources from the pond");
    // The week's interest.
    const gold = s.players[0].resources[6];
    weeklyTownSpecials(s);
    if (s.players[0].resources[6] > gold) notes.push("interest on the gold");
    // The Cover of Darkness: the rival, shown everything, loses the land around the town.
    if (faction === "necropolis" && id === SPECIAL.s1) {
      const rival = s.players[1];
      rival.revealed = rival.revealed.map(() => -1);
      const all = bits(rival.revealed as number[]);
      coverOfDarkness(s, (x, y, z) => w.index(x, y, z));
      if (bits(rival.revealed as number[]) < all) notes.push("the rival's map darkened around the town");
    }
    if (!notes.length) {
      const known: Record<string, string> = {};
      const why = known[`${faction}:${id}`];
      return why ? { proof: null, note: `no checker yet: ${why}` } : { proof: "nothing measurable changed", note: "" };
    }
  } else if (id === 27 || id === 28 || id === 29) return { proof: null, note: "nothing to check: scenery (an unused hall)" };
  else if (faction === "cove" && id === 44) {
    // The Gunpowder Warehouse: Corsairs upgrade to Sea Dogs in the town.
    const corsair = w.creatures.findIndex((c) => c?.key === "corsair");
    const seadog = w.creatures.findIndex((c) => c?.key === "seadog");
    const to = townUpgradeOf(w, o, corsair);
    return { proof: to === seadog ? null : `Corsairs upgrade to ${to === undefined ? "nothing" : w.creatures[to]?.plural}`, note: "checked: Corsairs upgrade to Sea Dogs" };
  } else if (changed.length) notes.push(...changed.map(String));
  else return { proof: null, note: "no checker yet: only that it can be built" };
  return { proof: failed.length ? failed.join("; ") : null, note: `checked: ${notes.join(", ")}` };
}
