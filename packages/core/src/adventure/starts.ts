// Advanced starts: a random map begun weeks or months in, so play (and testing) reaches what
// the first days never do. Each start mixes several things rather than testing one: grown towns
// and a second or third town, levelled heroes with real armies and spellbooks, artifacts (a
// combination set split between you and a rival), the grail puzzle uncovered, ships at sea,
// and rivals strong enough to come for your towns. Every player gets the same treatment (the AI
// too), so the game stays fair. Named by the random map's ":s-<start>" (rmg.ts).
import { maxMovement } from "./movement.ts";
import { CREATURE_INFO } from "../creatureData.ts";
import { type HasRng, randInt } from "../rng.ts";
import { aiSkillChoice, skillId } from "../skills.ts";
import { COMBOS, SLOT, SPELLBOOK_ARTIFACT, giveArtifact, initEquipment, randomArtifactPool } from "./artifacts.ts";
import { chooseSkill, gainExperience, skillUse } from "./combat.ts";
import { experienceForLevel } from "./experience.ts";
import { buildBoat, cannotBuildBoat } from "./rules.ts";
import { B, build, cannotBuild, dwellingId, townInfo, weeklyGrowth } from "./town.ts";
import type { AdvObject, AdventureState, ArmySlot, Hero } from "./types.ts";
import type { RandomMapOptions } from "./rmg.ts";
import { type World, Terrain, heroSight, reveal, tileSpan, visitTile } from "./world.ts";
import { makeHero } from "./create.ts";
import { maxMana } from "./magic.ts";
import { TOWNS } from "../townData.ts";

export interface StartPreset {
  name: string;
  /** What the player finds, for the new game screen. */
  text: string;
  /** The day the game starts on (always a Monday). */
  day: number;
  heroLevel: number;
  /** Weeks of creature growth in the main hero's army. */
  armyWeeks: number;
  /** Neutral towns nearest to each player's that become theirs. */
  extraTowns: number;
  /** "all": everything the town can have (no grail); else this many dwellings and the basics. */
  towns: "all" | number;
  gold: number;
  /** Of each other resource. */
  resources: number;
  /** Secondary skills set outright (key, level), else what the level-ups gave. */
  skills?: [string, number][];
  /** Spellbook with every spell up to this level (0: whatever the hero has). */
  spells: number;
  /** Artifact tiers handed out (T treasure, N minor, J major, R relic), one per letter. */
  artifacts: string;
  /** A combination set: all parts but one to each player, the last one carried by a rival's hero. */
  combo?: boolean;
  /** Share of the obelisks already visited (the grail puzzle). */
  obelisks: number;
  /** A Shipyard where the town can have one, and a boat built at it. */
  boats?: boolean;
  /** Explored around each town (tiles). */
  sight: number;
  /** A rival's hero at each player's gate with this many weeks of its town's troops: a siege or a field battle at once. */
  rivalAtGate?: number;
  /** Weeks of the home town's troops left in its garrison (behind the walls). */
  garrison?: number;
  /** Weeks of each town's own troops in its garrison (a month in, no town stands empty). */
  townGarrison?: number;
}

export const START_PRESETS: Record<string, StartPreset> = {
  // The gentle one (2026-10-27: past the early game to the computer's moves, without Border war's three towns and
  // armies to keep track of): a small map for two, so the rival is a few days away.
  skirmish: {
    name: "Week three",
    text: "Week 3 on a small map for two: your castle with its first four dwellings and a second town, a level 7 hero with two weeks of troops and a few spells. One computer rival, just as far along, a few days' march away.",
    day: 15,
    heroLevel: 7,
    armyWeeks: 2,
    extraTowns: 1,
    towns: 4,
    gold: 10000,
    resources: 10,
    spells: 2,
    artifacts: "TN",
    obelisks: 0,
    sight: 14,
  },
  war: {
    name: "Border war",
    text: "Month 2: three towns each with citadels and a week's troops behind the walls, a level 12 hero with four weeks of troops and a spellbook. The rivals are as strong and close by: sieges both ways, heroes in each other's paths.",
    day: 29,
    heroLevel: 12,
    armyWeeks: 4,
    extraTowns: 2,
    towns: 5,
    gold: 25000,
    resources: 25,
    spells: 3,
    artifacts: "NNJ",
    obelisks: 0.25,
    sight: 18,
    // (Empty, the rival's hero walked into two of them on the first day: no siege at all.)
    townGarrison: 1,
  },
  archmage: {
    name: "Archmage",
    text: "Month 4: capitols and every building, a level 25 hero with expert Air, Earth, Fire and Water magic and every spell (Town Portal, Dimension Door, Fly, Armageddon...), relics, and the grail puzzle nearly done. The rivals are archmages too.",
    day: 85,
    heroLevel: 25,
    armyWeeks: 8,
    extraTowns: 1,
    towns: "all",
    gold: 60000,
    resources: 60,
    skills: [["wisdom", 3], ["airMagic", 3], ["earthMagic", 3], ["fireMagic", 3], ["waterMagic", 3], ["intelligence", 3], ["sorcery", 3], ["logistics", 3]],
    spells: 5,
    artifacts: "JJRR",
    obelisks: 0.85,
    sight: 30,
  },
  sea: {
    name: "Sea lords",
    text: "Week 3 on an island map: a shipyard and a boat at every town that can have one, a level 8 navigator with a fleet's worth of troops, and rivals across the water building boats of their own.",
    day: 15,
    heroLevel: 8,
    armyWeeks: 3,
    extraTowns: 1,
    towns: 4,
    gold: 15000,
    resources: 20,
    skills: [["navigation", 3], ["logistics", 2], ["wisdom", 1]],
    spells: 2,
    artifacts: "TNN",
    obelisks: 0.4,
    boats: true,
    sight: 16,
  },
  siege: {
    name: "At the gates",
    text: "Month 2: a rival's hero stands at your castle gate with six weeks of troops, your own hero and a four-week garrison behind the walls (towers, moat, a level 12 hero with a spellbook). Hold the siege from the walls, or sally out and fight in the field. Every player gets the same visitor.",
    day: 36,
    heroLevel: 12,
    armyWeeks: 4,
    extraTowns: 1,
    towns: "all",
    gold: 30000,
    resources: 30,
    spells: 3,
    artifacts: "NJJ",
    obelisks: 0.3,
    sight: 20,
    rivalAtGate: 6,
    garrison: 4,
  },
  clash: {
    name: "Field of battle",
    text: "Week 6: your level 15 hero with six weeks of troops, relics and a full book of level 1-4 spells, and the rival's hero of the same make a step away: the biggest battle of the game before breakfast, then its towns to take with what's left.",
    day: 36,
    heroLevel: 15,
    armyWeeks: 6,
    extraTowns: 1,
    towns: 6,
    gold: 30000,
    resources: 30,
    spells: 4,
    artifacts: "JJR",
    obelisks: 0.3,
    sight: 20,
    rivalAtGate: 6,
  },
  empire: {
    name: "Late empire",
    text: "Month 6: capitols and every building in four towns, a level 28 hero with ten weeks of troops (the seventh level upgraded), relics and a combination set all but one part, every spell, and rivals grown just as big, their heroes out on the roads. The grail puzzle is almost solved.",
    day: 148,
    heroLevel: 28,
    armyWeeks: 10,
    extraTowns: 3,
    towns: "all",
    gold: 120000,
    resources: 100,
    skills: [["wisdom", 3], ["earthMagic", 3], ["airMagic", 3], ["logistics", 3], ["offense", 3], ["armorer", 3], ["leadership", 3], ["tactics", 3]],
    spells: 5,
    artifacts: "JRRR",
    combo: true,
    obelisks: 0.9,
    sight: 40,
  },
  relics: {
    name: "Relic hunters",
    text: "Week 4: a combination set all but complete, its last part carried by a rival's hero; a relic and major artifacts on your hero, half the grail puzzle uncovered, two towns and an army to go and take it.",
    day: 22,
    heroLevel: 10,
    armyWeeks: 3,
    extraTowns: 1,
    towns: 4,
    gold: 20000,
    resources: 20,
    spells: 3,
    artifacts: "NJR",
    combo: true,
    obelisks: 0.5,
    sight: 16,
  },
};

/** The advanced starts offered in New Game (the first, Week three, is also ☰ → Play's quick start): a map that suits each (a small one for the border war, islands for the sea...), made from one of the original's templates that fits, as its random maps are. */
export const ADVANCED_STARTS: Omit<RandomMapOptions, "seed">[] = [
  { size: 36, players: 2, humans: 1, monsters: 1, start: "skirmish" },
  { size: 36, players: 3, humans: 1, monsters: 1, start: "siege" },
  { size: 36, players: 3, humans: 1, monsters: 1, start: "clash" },
  { size: 36, players: 4, humans: 1, monsters: 1, start: "war" },
  { size: 108, players: 4, humans: 1, monsters: 2, underground: true, start: "empire" },
  { size: 72, players: 3, humans: 1, monsters: 2, underground: true, start: "archmage" },
  { size: 72, players: 4, humans: 1, monsters: 1, islands: true, start: "sea" },
  { size: 72, players: 3, humans: 1, monsters: 1, water: true, start: "relics" },
];

/** The tiles walked to from `start` on land without passing a monster (a player's own lands). */
function unguarded(w: World, start: number): Set<number> {
  const seen = new Set<number>(start >= 0 ? [start] : []);
  const queue = [...seen];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    if (w.guardedBy[i] && i !== start) continue;
    const x = i % w.size;
    const y = Math.floor(i / w.size) % w.size;
    const z = Math.floor(i / (w.size * w.size));
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const j = w.index(x + dx, y + dy, z);
        if (j < 0 || seen.has(j) || w.blocked(j) || w.map.tiles[j].terrain === Terrain.WATER) continue;
        seen.add(j);
        queue.push(j);
      }
  }
  return seen;
}

/** Builds a town up, ignoring cost and the one-a-day rule: everything, or the basics and `dwellings` dwellings (upgraded). */
export function grow(s: AdventureState, w: World, o: AdvObject, how: "all" | number, boats: boolean, except?: number) {
  const info = townInfo(o);
  if (!info || !o.town) return;
  const p = s.players[o.owner];
  const saved = [...p.resources];
  p.resources = p.resources.map(() => 1e9);
  const wanted = (id: number) => {
    if (id === B.GRAIL || id === except) return false;
    if (id === B.SHIPYARD) return boats || how === "all";
    if (how === "all") return true;
    const basics: number[] = [B.FORT, B.CITADEL, B.TOWN_HALL, B.CITY_HALL, B.TAVERN, B.MARKETPLACE, B.BLACKSMITH, B.MAGE_GUILD_1, B.MAGE_GUILD_1 + 1];
    if (basics.includes(id)) return true;
    for (let level = 0; level < how; level++) if (id === dwellingId(level) || id === dwellingId(level, true)) return true;
    return false;
  };
  for (let progress = true; progress; ) {
    progress = false;
    for (const id of Object.keys(info.buildings).map(Number)) {
      if (!wanted(id) || o.town.built.includes(id)) continue;
      o.town.builtToday = false;
      if (!cannotBuild(s, w, o, id)) {
        build(s, w, o, id);
        progress = true;
      }
    }
  }
  o.town.builtToday = false;
  p.resources = saved;
  // A week's creatures to buy.
  o.town.available = o.town.available.map((_, level) => (o.town!.built.includes(dwellingId(level)) ? weeklyGrowth(w, o, level, s) : 0));
}

/** Levels a hero up to `level`, taking the offered skills (those in `prefer` first). */
export function levelUp(s: AdventureState, w: World, h: Hero, level: number, prefer: number[]) {
  // A level at a time, each offer answered before the next is made (offered all at once, a
  // human's offers were all drawn from the starting skills, and most of them taken twice). The
  // same choice for every player: the start's skills first, else the AI's pick, never Learning
  // when there's another (HotA's Learning brings a level of its own: past the start's level).
  const p = s.players[h.owner];
  const controller = p?.controller;
  if (p) p.controller = "human";
  const learning = skillId("learning");
  for (let guard = 0; h.level < level && guard < 100; guard++) {
    gainExperience(s, w, h, Math.max(1, experienceForLevel(h.level + 1) - h.experience));
    while (h.levelUps?.length) {
      const offer = h.levelUps.shift()!;
      h.levelUpPrimary?.shift();
      const preferred = offer.findIndex(([skill]) => prefer.includes(skill));
      let pick = preferred >= 0 ? preferred : aiSkillChoice(offer, (key) => skillUse(w, h, key));
      if (offer[pick]?.[0] === learning && offer.length > 1) pick = offer.findIndex(([skill]) => skill !== learning);
      chooseSkill(s, w, h, offer, pick);
    }
  }
  if (p && controller) p.controller = controller;
}

/** The hero's army: `weeks` of each built dwelling's growth (upgraded where the upgrade is built). */
export function muster(s: AdventureState, w: World, h: Hero, town: AdvObject, weeks: number) {
  const faction = TOWNS[town.subid];
  if (!faction || !town.town) return;
  const army: (ArmySlot | null)[] = [];
  for (let level = 0; level < Math.min(7, faction.creatures.length); level++) {
    if (!town.town.built.includes(dwellingId(level))) continue;
    const [base, up] = faction.creatures[level];
    const creature = town.town.built.includes(dwellingId(level, true)) ? up : base;
    if (CREATURE_INFO[creature] === undefined && !w.data.creatures[creature]) continue;
    army.push({ creature, count: Math.max(1, weeklyGrowth(w, town, level, s) * weeks) });
  }
  if (army.length) h.army = [...army, ...Array(7).fill(null)].slice(0, 7);
}

/** Applies an advanced start to a game just created (create.ts). */
export function applyStart(s: AdventureState & HasRng, w: World, key: string) {
  const preset = START_PRESETS[key];
  if (!preset) return;
  const data = w.data;
  s.day = preset.day;
  const players = s.players.map((p, color) => ({ p, color })).filter(({ p }) => p.alive && p.controller !== "none");
  const banned = s.banned?.artifacts ?? [];
  const obelisks = s.objects.filter((o) => o.type === 57 && !o.removed).map((o) => o.id);
  // A set for each player (a different one each where there are enough): all its parts but the last,
  // which the next player's hero carries. (One shared set would hand everyone their own last part.)
  const combos = Object.entries(COMBOS).filter(([id, parts]) => parts.length >= 2 && ![Number(id), ...parts].some((a) => banned.includes(a) || !data.artifacts[a]));
  const sets: number[][] = [];
  if (preset.combo && combos.length) {
    const left = combos.map(([, parts]) => parts);
    for (let i = 0; i < players.length; i++) {
      if (!left.length) left.push(...combos.map(([, parts]) => parts));
      sets.push(left.splice(randInt(s, 0, left.length - 1), 1)[0]);
    }
  }
  const setParts = new Set(sets.flat());
  const prefer = (preset.skills ?? []).map(([k]) => skillId(k));
  const mains: Hero[] = [];
  const mainSets: number[][] = [];

  // The neutral towns nearest each player's become theirs: first those in their own lands (walked
  // to without a fight), then the nearest others; a town a round, in turn, so that the first
  // players don't take everything near the last ones.
  const homes = new Map(players.map(({ color }) => [color, s.objects.find((o) => o.town && !o.removed && o.owner === color)]));
  const lands = new Map(players.map(({ color }) => [color, homes.get(color) ? unguarded(w, visitTile(w, homes.get(color)!)) : new Set<number>()]));
  for (let round = 0; round < preset.extraTowns; round++)
    for (const { color } of players) {
      const home = homes.get(color);
      if (!home) continue;
      const own = (o: AdvObject) => (lands.get(color)!.has(visitTile(w, o)) ? 0 : 1);
      // (Never one in another player's lands, unless they're ours too: a template may join starts without a guard.)
      const theirs = (o: AdvObject) => own(o) === 1 && players.some((q) => q.color !== color && lands.get(q.color)!.has(visitTile(w, o)));
      const next = s.objects.filter((o) => o.town && !o.removed && o.owner < 0 && o.z === home.z && !theirs(o)).sort((a, b) => own(a) - own(b) || tileSpan(a, home) - tileSpan(b, home))[0];
      if (next) next.owner = color;
    }
  // As many each: whoever got more gives the last ones back.
  const fewest = Math.min(...players.map(({ color }) => s.objects.filter((o) => o.town && !o.removed && o.owner === color).length));
  for (const { color } of players) for (const o of s.objects.filter((o) => o.town && !o.removed && o.owner === color && o !== homes.get(color)).slice(fewest - 1)) o.owner = -1;

  for (const { p, color } of players) {
    p.resources = p.resources.map((r, i) => r + (i === 6 ? preset.gold : preset.resources));
    const home = homes.get(color);
    if (!home) continue;
    const towns = s.objects.filter((o) => o.town && !o.removed && o.owner === color);
    towns.forEach((o, i) => grow(s, w, o, i === 0 ? preset.towns : typeof preset.towns === "number" ? Math.max(2, preset.towns - 2) : 5, !!preset.boats));
    for (const o of towns) for (let z = 0; z < (w.map.levels ?? 1); z++) if (z === o.z) reveal(s, w, color, o.x, o.y, o.z, preset.sight);
    if (preset.townGarrison)
      for (const o of towns) {
        const keeper = { army: [] } as unknown as Hero;
        muster(s, w, keeper, o, preset.townGarrison);
        if (o.town && keeper.army.length) o.town.garrison = keeper.army;
      }
    if (preset.boats) for (const o of towns) if (!cannotBuildBoat(s, w, o, color)) buildBoat(s, w, color, o.id);
    p.obelisks = obelisks.slice(0, Math.round(obelisks.length * preset.obelisks));

    const hero = s.heroes.find((h) => !h.removed && h.owner === color);
    if (!hero) continue;
    mains.push(hero);
    levelUp(s, w, hero, preset.heroLevel, prefer);
    if (preset.skills) hero.skills = preset.skills.map(([k, l]) => [skillId(k), l] as [number, number]).filter(([id]) => id >= 0).slice(0, 8);
    muster(s, w, hero, home, preset.armyWeeks);
    initEquipment(hero);
    if (preset.spells) {
      hero.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
      hero.spells = (data.spells ?? []).filter((sp) => sp && sp.level >= 1 && sp.level <= preset.spells && !(s.banned?.spells ?? []).includes(sp.id)).map((sp) => sp.id);
    }
    for (const tier of preset.artifacts) {
      const pool = randomArtifactPool(data.artifacts, tier, banned).filter((a) => !setParts.has(a));
      if (pool.length) giveArtifact(hero, data.artifacts, pool[randInt(s, 0, pool.length - 1)]);
    }
    const set = sets[players.findIndex((q) => q.color === color)];
    if (set) {
      for (const part of set.slice(0, -1)) giveArtifact(hero, data.artifacts, part);
      mainSets.push(set);
    }
    hero.movement = hero.maxMovement = maxMovement(w, hero);
    // (Full spell points, with what the artifacts add.)
    hero.mana = maxMana(hero);
    // What the hero sees where it stands (it stood half in the fog at the edge of the towns' circle).
    reveal(s, w, color, hero.x, hero.y, hero.z, heroSight(hero));
  }
  // Each set's last part: the next player's hero carries it.
  if (mainSets.length === mains.length) for (let i = 0; i < mains.length; i++) {
    const set = mainSets[(i + mains.length - 1) % mains.length];
    giveArtifact(mains[i], data.artifacts, set[set.length - 1]);
  }
  // A rival's hero at each player's gate (the next player's), with weeks of its own town's troops; the home garrison behind the walls.
  if (preset.rivalAtGate || preset.garrison) {
    for (let i = 0; i < players.length; i++) {
      const { color } = players[i];
      const home = s.objects.find((o) => o.town && !o.removed && o.owner === color);
      if (!home?.town) continue;
      if (preset.garrison) {
        const keeper = { army: [] } as unknown as Hero;
        muster(s, w, keeper, home, preset.garrison);
        home.town.garrison = keeper.army;
      }
      if (!preset.rivalAtGate || players.length < 2) continue;
      const rival = players[(i + 1) % players.length].color;
      const rivalHome = s.objects.find((o) => o.town && !o.removed && o.owner === rival);
      if (!rivalHome) continue;
      const gate = visitTile(w, home);
      const gx = gate % w.size;
      const gy = Math.floor(gate / w.size) % w.size;
      let spot = -1;
      for (const [dx, dy] of [[0, 1], [-1, 1], [1, 1], [-1, 0], [1, 0], [-2, 1], [2, 1], [0, 2], [-1, 2], [1, 2]]) {
        const j = w.index(gx + dx, gy + dy, home.z);
        if (j < 0 || w.blocked(j) || w.visitBy[j] || w.heroAt[j] || w.map.tiles[j]?.terrain === Terrain.WATER) continue;
        spot = j;
        break;
      }
      if (spot < 0) continue;
      const type = Object.keys(data.heroNames).map(Number).find((t) => data.heroNames[t] && !s.heroes.some((x) => x.type === t));
      if (type === undefined) continue;
      const visitor = makeHero(s, data, type, rival, spot % w.size, Math.floor(spot / w.size) % w.size, home.z, [null, null, null, null, null, null, null]);
      s.heroes.push(visitor);
      w.refresh(s);
      levelUp(s, w, visitor, preset.heroLevel, prefer);
      muster(s, w, visitor, rivalHome, preset.rivalAtGate);
      initEquipment(visitor);
      if (preset.spells) {
        visitor.equipped![SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
        visitor.spells = (data.spells ?? []).filter((sp) => sp && sp.level >= 1 && sp.level <= Math.min(3, preset.spells) && !(s.banned?.spells ?? []).includes(sp.id)).map((sp) => sp.id);
      }
      visitor.movement = visitor.maxMovement = maxMovement(w, visitor);
      visitor.mana = maxMana(visitor);
      reveal(s, w, color, visitor.x, visitor.y, visitor.z, 3);
      // Its own side sees where it stands too (it stood in its owner's fog).
      reveal(s, w, rival, visitor.x, visitor.y, visitor.z, heroSight(visitor));
    }
  }
  s.log.push(`${preset.name}: the game starts on day ${preset.day}.`);
  w.refresh(s);
}
