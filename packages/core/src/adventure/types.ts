import type { Personality } from "./aiPersonality.ts";
import type { RuleOverrides } from "./gameRules.ts";
import type { BattleState } from "../battle/state.ts";
import type { ThievesGuildInfo } from "./thieves.ts";
import type { TownState } from "./town.ts";
import type { PausedScript, ScriptState } from "./scripts.ts";

export interface Pos {
  x: number;
  y: number;
  z: number;
}

// Object type ids used by the rules (same numbering as the map format).
export const Obj = {
  ARTIFACT: 5,
  PANDORAS_BOX: 6,
  BOAT: 8,
  SHIPYARD: 87,
  WHIRLPOOL: 111,
  CAMPFIRE: 12,
  EVENT: 26,
  GARRISON: 33,
  HERO: 34,
  GRAIL: 36,
  MINE: 53,
  MONSTER: 54,
  PRISON: 62,
  RANDOM_ART: 65,
  RANDOM_RELIC_ART: 69,
  RANDOM_HERO: 70,
  RANDOM_MONSTER: 71,
  RANDOM_MONSTER_L1: 72,
  RANDOM_MONSTER_L4: 75,
  RANDOM_RESOURCE: 76,
  RANDOM_TOWN: 77,
  RESOURCE: 79,
  TOWN: 98,
  TREASURE_CHEST: 101,
  RANDOM_MONSTER_L5: 162,
  RANDOM_MONSTER_L7: 164,
  HERO_PLACEHOLDER: 214,
  GARRISON2: 219,
  ABANDONED_MINE: 220,
} as const;

export const RESOURCE_NAMES = ["Wood", "Mercury", "Ore", "Sulfur", "Crystal", "Gems", "Gold"];

export interface ArmySlot {
  creature: number;
  count: number;
}

export interface AdvObject extends Pos {
  /** Index in AdventureState.objects. */
  id: number;
  /** A town's place in its owner's list: the order it was taken (AdventureState.taken when it was; none: owned from the start). */
  taken?: number;
  type: number;
  subid: number;
  def: string;
  /** Map-format masks (6 bytes, bit j of byte i = tile (x+j-7, y+i-5)); block bit 0 = blocked. */
  block: number[];
  visit: number[];
  /** Flat objects are drawn below others. */
  flat: boolean;
  owner: number;
  removed?: boolean;
  /** Monster count, resource amount, ... */
  amount?: number;
  name?: string;
  army?: (ArmySlot | null)[];
  town?: TownState;
  /** Creature bank: guards (rolled on the first visit) and whether it has been plundered. */
  bank?: { level: number; guards: ArmySlot[]; cleared?: boolean };
  /** Guards beaten this week (clearedWeek), or those left standing this week after a lost fight (heroes.thelazy.net, Creature dwelling). */
  dwelling?: { available: number[]; clearedWeek?: number; guardsLeft?: { week: number; guards: ArmySlot[] } };
  /** Boat: the hero sailing it (it moves with them and is off the map meanwhile). */
  carriedBy?: number;
  /** Boat: which way it faces (a hero's dir), as the hero left it at the shore; unset, right as the map's own. */
  dir?: number;
  /** Subterranean Gate: the paired gate on the other level (object id). */
  link?: number;
  /** The map's identifier for quests that target this object. */
  ident?: number;
  /** Per-object state rolled on first use (a Witch Hut's skill, a shrine's spell...). */
  data?: Record<string, unknown>;
  /** Week number of the last visit, for objects that refill weekly. */
  visitedWeek?: number;
  /** The player whose hero emptied it that week: the "(Visited)" mark is theirs (2026-10-28). */
  weekVisitor?: number;
  /** Other players whose heroes came that week and found it empty: they know it's been visited too (2026-10-31). */
  weekSeen?: number[];
  /** Heroes that have used this once-per-hero object. */
  visitors?: number[];
  /** Players who have visited it and so know what it holds (a Witch Hut's skill, a shrine's spell). */
  scouted?: number[];
}

export interface Hero extends Pos {
  id: number;
  type: number;
  name: string;
  /** A portrait the map gave the hero (PCX name or HotA PNG path) instead of its own; its gender if the map changed it. */
  portrait?: string;
  female?: boolean;
  owner: number;
  heroClass: number;
  /** AI (fresh engine): the hero takes a treasure chest's experience, not its gold. */
  aiChestXp?: boolean;
  movement: number;
  maxMovement: number;
  army: (ArmySlot | null)[];
  /** Attack, defense, power, knowledge. */
  primary: [number, number, number, number];
  experience: number;
  level: number;
  /** 0 up, 1 up-right, 2 right, 3 down-right, 4 down, 5 down-left, 6 left, 7 up-left. */
  dir: number;
  /** Artifact ids carried (equipping and their bonuses come later). */
  backpack?: number[];
  /** Spellbook contents (undefined: no spellbook) and spell points. */
  spells?: number[];
  mana?: number;
  /** Secondary skills: [skill id, level 1..3]. */
  skills?: [number, number][];
  /** Level-ups waiting for the player to pick a skill: the offered [skill id, level] pairs. */
  levelUps?: [number, number][][];
  /** The primary skill each waiting level-up raised (for the level-up window). */
  levelUpPrimary?: number[];
  sinceWisdom?: number;
  sinceSchool?: number;
  /** The hero's own random sequence for level-up offers (skillOffer in combat.ts). */
  skillRng?: number;
  /** sinceWisdom / sinceSchool before the first level-up still waiting for the player's pick. */
  pendingSince?: [number, number];
  /** Fly / Water Walk cast today: the day and the movement efficiency in percent (60, 80, 100). */
  /** Both of today's full pools (land, sea) as the day began, for the Admiral's Hat. */
  pools?: { day: number; land: number; sea: number };
  fly?: { day: number; efficiency: number };
  waterWalk?: { day: number; efficiency: number };
  /** Dimension Door casts used today. */
  doors?: { day: number; n: number };
  /** Wandering monsters waiting for an answer: join (free / for gold) or flee (pursue?). */
  /** An offer to answer; "ask": a configurable object's reward number `cost`. */
/** Creatures that joined with no room for them, waiting in the garrison window's upper row. */
  joiners?: (ArmySlot | null)[];
  /** Joiners bought at a map dwelling: those not taken go back to it, their price refunded (`price`: one creature's). */
  joinersFrom?: { object: number; slot: number; creature: number; price: number[] };
    offer?: { object: number; kind: "join" | "pay" | "flee" | "ask" | "primary" | "confirm" | "chest" | "attack" | "pandora" | "quest" | "script"; cost: number };
  /** A map script waiting for this hero's player to answer its question (scripts.ts). */
  script?: PausedScript;
  /** The class the hero is called by instead of its own (a GENRLTXT line: Gem the Sorceress in her campaigns). */
  classText?: number;
  /** A map script that started this hero's battle: the rest of it runs when the hero wins. */
  scriptAfterBattle?: PausedScript;
  /** Spells of the Spell Scrolls (artifact 1) the hero holds, in the order found; only as many count as scrolls are held. */
  scrolls?: number[];
  /** Bonuses for a while (Observatory: sight this week; Watering Place: movement tomorrow), active from day `from` to `until`. */
  timed?: { type: string; subtype?: string; val: number; from: number; until: number; object: number; active?: boolean }[];
  /** Worn combination artifacts by slot: the slots they lock and the parts they're made of. */
  combos?: Record<number, { combo: number; locked: number[]; parts: number[] }>;
  /** The hero screen's settings: tight formation, and Tactics left unused. */
  tight?: boolean;
  noTactics?: boolean;
  /** AI: visited places it walked through to reach ground beyond, by day. */
  aiCrossed?: Record<number, number>;
  /** AI: objects this hero visited, by day (not worth going back to for a while). */
  aiVisited?: Record<number, number>;
  /** AI: adventure spells cast, by the day or week they were cast for (View Earth once a week, Disguise once a day...). */
  aiCast?: Record<number, number>;
  /** AI: today's target is only exploration (nothing of value in reach). */
  aiExploring?: boolean;
  /** Why the AI chose its last target: worth it, a guard fought only to open the way (nothing else to do), or exploring. */
  aiReason?: "value" | "clearing" | "explore" | "regroup" | "hide";
  /** Asleep: skipped when cycling to the next hero. */
  asleep?: boolean;
  /** Day the hero cast Visions (exact monster counts) / Disguise (army hidden from enemies). */
  visions?: number;
  disguise?: number;
  /** Today's Visions: how far it reaches (spell power x 1, 2, 3 by mastery, at least 3) and the mastery (Advanced: heroes too, Expert: towns too). */
  visionsReach?: { range: number; mastery: number };
  /** Today's Disguise: its mastery (Advanced: the numbers show as 0, Expert: the starting town's strongest creature). */
  disguiseMastery?: number;
  /** Week the hero last used Stables (+400 land movement until it ends). */
  stablesWeek?: number;
  /** Retreated or surrendered: can be hired again (with skills, spells and artifacts). */
  retired?: boolean;
  /** The day the hero last drank from a Magic Well (one drink a day, from any well). */
  wellDay?: number;
  /** In a town's garrison (that town's object id): off the map, defending the town, not moving. */
  garrison?: number;
  /** The map's identifier for quests that target this hero. */
  ident?: number;
  /** Morale / luck from visited objects until the next battle, and which object types gave them. */
  temp?: { morale: number; luck: number; from: number[] };
  /** The boat (object id) the hero is sailing in. */
  boat?: number;
  /** That boat is HotA's Airship (movement.ts isAirship): flying, not sailing. */
  airship?: boolean;
  /** AI: the tile this hero is heading for, kept across days so it doesn't dither. */
  aiTarget?: number;
  /** A human player's hero: the tile its player last sent it to (until it gets there), so an allied computer player leaves that to it. */
  heading?: number;
  /** Worn artifacts by slot (artifact id or -1). */
  equipped?: number[];
  removed?: boolean;
  /** In a player's view (playerView.ts): a rival's hero out of sight, nothing of it known but who it is. */
  unseen?: true;
}

export interface Player {
  color: number;
  controller: "human" | "ai" | "none";
  resources: number[];
  alive: boolean;
  faction?: string;
  /** Explored tiles, one bit per tile (levels x size x size), as 32-bit words. */
  revealed: number[];
  /** A timed or town event's script waiting for this player's answer to its question (scripts.ts). */
  script?: PausedScript;
  /** Allied players share a team (from the map). */
  team?: number;
  /** Day the player lost its last town; with no town for 7 days the player is out. */
  townlessSince?: number;
  /** Out of the game by the map's special loss condition (its type), or -1 for the standard one. */
  lostBy?: number;
  /** Used a cheat code (the score screen says so). */
  cheated?: boolean;
  /** The Advanced Options' handicap: 1 Mild, 2 Severe (starting resources and daily income 15% / 30% less). */
  handicap?: number;
  /** Obelisks visited (object ids): each uncovers more of the puzzle map. */
  obelisks?: number[];
  /** AI: the last day its heroes had nowhere to go on their island (it then builds shipyards and boats). */
  aiStuck?: number;
  /** AI: which engine plays this computer player (aiSearch.ts engineOf); unset: the game's default, "fix" (AI_ENGINE overrides; "base" is the classic AI before 2026-11-02). */
  aiEngine?: "base" | "search" | "tuned" | "fix" | "roles" | "fresh";
  /** AI (fix / roles engines): the day a guard was left in each town of ours (aiRoles.ts guarded). */
  aiGuards?: Record<number, number>;
  /** AI (roles engine): its main hero (aiRoles.ts keptMain). */
  aiMain?: number;
  /** AI: the fresh engine's memory between turns (fresh/mind.ts). */
  aiFresh?: import("./fresh/mind.ts").Mind;
  /** AI: its last turns told line by line (aiDiary.ts): what it did and why, kept in the save so a note about it carries them. */
  aiDiary?: { day: number; lines: string[] }[];
  /** AI on a player's view (aiView.ts): rivals' heroes as last seen (where, the army, the day), kept a few days after they went out of sight. */
  aiSeen?: Record<number, { x: number; y: number; z: number; day: number; army: (ArmySlot | null)[]; primary: number[]; maxMovement: number }>;
  /** AI: its personality (aiPersonality.ts), from the map's AI tactic or the setup; none: the standard AI. */
  personality?: Personality;
  /** Keys from Keymaster's Tents (colours 0..7). */
  keys?: number[];
  /** Heroes offered in this player's taverns (hero types): [own faction's, any], refreshed weekly. */
  tavern?: number[];
  /** How each tavern hero got there (VCMI's TavernSlotRole): its army on hire, and which slot a returning hero takes. */
  tavernRoles?: TavernSlot[];
  /** The army each tavern hero (by type) comes with, rolled when the hero took the slot, so the tavern's preview shows what a hire brings. */
  tavernArmies?: Record<number, (ArmySlot | null)[]>;
  /** The starting bonus it got (the advanced options' pick, else rolled). */
  startBonus?: "gold" | "resource" | "artifact";
  /** View Air / View Earth cast on `day`, at their best mastery: shown in the View World window until the turn ends. */
  views?: { day: number; air?: number; earth?: number };
  /**
   * Beyond HotA (the player's switch, EXTRAS cyclicPortals; A player's idea): monoliths of a colour send this player's
   * heroes to their exits in turn, by their place on the map, instead of at random, so as many trips as there are
   * exits show every one. `portalLast`: per colour ("type:subid" of the exits), the tile of the exit taken last.
   */
  cyclicPortals?: boolean;
  portalLast?: Record<string, number>;
}

export interface PendingBattle {
  /** The attacking hero (side 0). */
  hero: number;
  /** What was attacked: a monster, bank, dwelling or town (object id), or -1 for a hero. */
  object: number;
  /** A defending hero (side 1), when another player's hero was attacked. */
  defender?: number;
  battle: BattleState;
}

export interface AdventureState {
  id: number;
  /** How many towns and mines have changed hands (AdvObject.taken). */
  taken?: number;
  /** HotA 1.8's map scripts: their variables, events turned off, quests proposed. */
  scripts?: ScriptState;
  /** Heroes this map's taverns and random picks never offer: banned by the map, or kept for maps with (or without) water. */
  unhirable?: number[];
  /** Heroes the map lets only some players hire (its hero settings): hero type to a bit per player. */
  heroPlayers?: Record<number, number>;
  /** A HotA map's option: defeated heroes never come back to the taverns. */
  noRehiring?: boolean;
  /** Played without the content HotA added (New Game's option): no HotA towns, creatures, artifacts, heroes or skills turn up. */
  noHota?: boolean;
  /** HotA's rule changes this game turned off (gameRules.ts); the rest apply. */
  rules?: RuleOverrides;
  /** What the map bans (artifacts, spells, secondary skills): never offered at random. */
  banned?: { artifacts: number[]; spells: number[]; skills: number[] };
  rng: number;
  mapFile: string;
  size: number;
  levels: number;
  day: number;
  /** Player whose turn it is. */
  current: number;
  players: Player[];
  /** The Advanced Options' Player Turn Duration in minutes: a human's turn ends when it runs out (none: unlimited). */
  turnMinutes?: number;
  heroes: Hero[];
  /** Interactive objects; scenery stays in the map file. */
  objects: AdvObject[];
  /** Map object indices that state.objects replaces (randoms resolved etc.), hidden from the scenery layer. */
  replaced: number[];
  /** The save format's version (SAVE_VERSION when made; older saves are upgraded on loading). */
  version?: number;
  /** How many objects the map had when the game began (to tell a map changed under a save). */
  mapObjects?: number;
  /** Battles in progress, at most one per player colour. */
  battles: Record<number, PendingBattle>;
  /**
   * HotA-style simultaneous turns: everyone moves at once each day until
   * rival heroes get within `contactDistance` tiles, then turns go one by one.
   */
  turnMode: "simultaneous" | "sequential";
  /** Simultaneous mode: who has finished the day. */
  ended: boolean[];
  contactDistance: number;
  /** Simultaneous turns end after this day even without contact (none: only on contact). */
  simultaneousUntil?: number;
  /** Set when the game is over: a player of the winning team, or -1 when every human lost. */
  winner?: number;
  /** How the game was won: the map's special victory condition type, or -1 for the standard one. */
  victoryType?: number;
  /** 0 Easy ... 4 Impossible (the score multiplier). */
  difficulty?: number;
  /** This week's astrologers' proclamation: a creature gets +5 growth (or just a name). */
  week?: { name: string; creature?: number; /** The Inferno Grail's Deity of Fire: +15 to the imps and familiars. */ deity?: boolean; month?: { name: string; creature?: number; plague?: boolean } };
  /** Where the Grail is buried. */
  grail?: { x: number; y: number; z: number; found?: boolean };
  /** Holes dug so far (tile indices), so nobody digs there twice. */
  holes?: number[];
  /** Map victory/loss conditions resolved to game objects at the start. */
  conditions?: GameConditions;
  log: string[];
  /**
   * A player's own view of a game with rivals (the server's viewFor): the Thieves' Guild ranking
   * made from the whole game, since the view leaves the rivals' resources, artifacts and armies out.
   */
  ranks?: ThievesGuildInfo;
  /** Whose view this is (playerView.ts viewFor): their routes keep to explored ground. Absent: the whole game. */
  viewer?: number;
}

/** The map's special victory / loss conditions (H3M), with positions resolved to heroes and objects. */
export interface GameConditions {
  victory: { type: number; allowNormal: boolean; appliesToAI: boolean; artifact?: number; creature?: number; resource?: number; amount?: number; hero?: number; object?: number; days?: number; /** Upgrade a town: 0 Town Hall, 1 City Hall, 2 Capitol. */ hall?: number; /** 0 Fort, 1 Citadel, 2 Castle. */ fort?: number };
  loss: { type: number; hero?: number; object?: number; days?: number };
  /** The game started with rival teams (otherwise nobody wins by elimination). */
  contested: boolean;
}

/** A line of the original's own text (shown in its language), %s / %d filled from `args`. */
export interface TextRef {
  file: "advevent" | "genrltxt" | "artevent" | "mineevnt" | "arraytxt" | "seerhut" | "randsign" | "crgen1" | "crgen4" | "hallinfo";
  id: number;
  /** Which field of the row (SEERHUT.TXT's variants); the first by default. */
  col?: number;
  /** Fill-ins for %s / %d, themselves maybe lines of the game's texts. */
  args?: (string | number | TextRef)[];
  /** Appended after it: plain text (e.g. "{Magic Arrow}.") or more lines. */
  more?: (string | TextRef)[];
}

/** A reward or cost pictured under a message, as the original's info windows do (VCMI's ComponentType). */
export type Component =
  | { kind: "resource"; id: number; amount: number }
  /** A resource every day (a mine's output). */
  | { kind: "income"; id: number; amount: number }
  | { kind: "experience"; amount: number }
  /** `need`: a level asked for (a quest's "Attack 10"), not a gain: drawn without a sign. */
  | { kind: "primary"; id: number; amount: number; need?: boolean }
  | { kind: "mana"; amount: number }
  | { kind: "skill"; id: number; level: number }
  | { kind: "creature"; id: number; amount?: number }
  | { kind: "artifact"; id: number }
  | { kind: "spell"; id: number }
  | { kind: "luck"; amount: number }
  | { kind: "morale"; amount: number };

/**
 * A tavern slot's hero: "full" came with the week (its whole army), "single" took a hired hero's place
 * (one creature), "retreated" / "surrendered" came back from a battle (one creature / what survived).
 * `keep`: came back on the week's last day during another player's turn, so it stays into the new week.
 */
export interface TavernSlot {
  role: "full" | "single" | "retreated" | "surrendered";
  keep?: boolean;
}
