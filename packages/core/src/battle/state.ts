import { type CreatureStats, hasAbility } from "../creatures.ts";
import type { RuleOverrides } from "../adventure/gameRules.ts";
import { BATTLEFIELDS, type PlacedObstacle, blockedHexes, placeObstacles } from "./fields.ts";
import { HEX_COUNT, hexAt, hexCol, hexRow, isPlayable } from "./hex.ts";
import { randInt } from "../rng.ts";
import { SUMMONED, type SpellInfo } from "../spells.ts";
import { type SiegeSetup, type SiegeState, TOWER_POS, createSiege, wallBlocked } from "./siege.ts";
import { SORCERY, skillLevel } from "../skills.ts";
import type { LogEntry } from "./texts.ts";

const ARROW_TOWER = 149;
/** Master Genies' spells (kept in sync with creatureMagic.ts). */
export const GENIE_SPELLS = ["airShield", "antiMagic", "bless", "bloodlust", "counterstrike", "cure", "fireShield", "fortune", "frenzy", "haste", "magicMirror", "mirth", "prayer",
  "precision", "protectAir", "protectEarth", "protectFire", "protectWater", "shield", "slayer", "stoneSkin"];

export type Side = 0 | 1;
export type Controller = "human" | "ai";

export interface Unit {
  id: number;
  side: Side;
  creature: number;
  count: number;
  /** HP of the top creature in the stack. */
  firstHp: number;
  /** Head hex. Wide units also occupy tail(). */
  pos: number;
  shots: number;
  /** Retaliations already used this round. */
  retaliations: number;
  acted: boolean;
  waited: boolean;
  defending: boolean;
  /** Already got a good-morale extra turn this round. */
  hadMorale: boolean;
  /** Phoenix rebirth used. */
  reborn?: boolean;
  /** The round it rose from its ashes: no strike back until that round is over (VCMI's rebirth.lua). */
  rebornRound?: number;
  /** Starting size, for casualty reports. */
  initialCount: number;
  /** HotA Runes: levels gained this battle (attacking +1, being hurt +2, defending +3). */
  runes?: number;
  /** Active spells: rounds left (999 = rest of the battle), mastery and effect value. */
  effects?: UnitEffect[];
  /** A war machine (ballista, tent, cart, catapult): it doesn't move and doesn't keep a battle going. */
  machine?: "ballista" | "cannon" | "tent" | "cart" | "catapult" | "tower";
  /** Spells the creature may still cast this battle (unset: its full allowance). */
  casts?: number;
  /** Round an Enchanter last enchanted in. */
  enchanted?: number;
  /** Risen by the Horn of the Abyss: Fangarms that join the hero after the battle. */
  raised?: boolean;
  /** Slain and already looked at by the Horn of the Abyss (Fangarms rise once per stack). */
  hornDone?: boolean;
  /** Summoned elementals and clones vanish after the battle. */
  summoned?: boolean;
  clone?: boolean;
  /** A clone: the stack it copies (it goes when that one falls; a stack has one clone at a time). */
  cloneOf?: number;
  /** Creatures brought back by Basic Resurrection: only for this battle (HotA: the real ones fall first). */
  borrowed?: number;
  /** Given up to Sacrifice: gone for good (can't be raised). */
  sacrificed?: boolean;
  /** How many were in the stack as the blow that killed it fell (Automatons detonate by that number). */
  diedWith?: number;
  /** The most of it dead at once before any came back (resurrected, reanimated, healed back): experience counts them once. */
  mostLost?: number;
  /** Experience its earlier form already gave (the creatures Pit Lords raised it from as demons). */
  xpBefore?: number;
  /** Meditating (HotA Couatls): the round it began; untouchable by attacks and spells until its first turn in a later round. */
  meditating?: number;
  /** Ignited (HotA Automatons): it detonates as it dies; can't be turned off. */
  ignited?: boolean;
  /** Meditated this battle (once). */
  meditated?: boolean;
  /** Round a Wraith stack last drained the enemy hero's mana in (once a round). */
  drained?: number;
  /** Paralysed when struck: its answer to that attack hits at a quarter (cleared after the attack). */
  numbed?: boolean;
  /** Bonus strikes owed (HotA Olgoi-Khorkhoi: one per corpse devoured), all spent on its next attack. */
  bonusStrikes?: number;
}

export interface UnitEffect {
  spell: number;
  rounds: number;
  mastery: number;
  value: number;
  /** Frenzy: the stack's own turns still to begin before it ends (it ends as the last one begins). */
  turns?: number;
}

export interface BattleHero {
  name: string;
  heroClass: number;
  /** Hero id and level, for the hero's specialty. */
  type?: number;
  level?: number;
  female: boolean;
  owner: number;
  /** Attack, defense, power, knowledge. */
  primary: [number, number, number, number];
  /** Large portrait image name, for the results window. */
  portrait?: string;
  /** Secondary skills: [skill id, level]. */
  skills?: [number, number][];
  /** Spell ids in the hero's spellbook (none: no spellbook). */
  spells?: number[];
  mana?: number;
  /** Spell points at most (Knowledge, Intelligence and its specialists), for the hero popup; unset: from Knowledge. */
  maxMana?: number;
  /** War machines the hero brings (artifact ids in the machine slots). */
  machines?: number[];
  /** War machines the hero owns that stay off the field (a creature bank's fight): their passive help still counts. */
  machinesAway?: number[];
  /** Battle effects of the hero's artifacts (damage, speed, health, immunities, magic limits...). */
  bonuses?: { type: string; subtype?: string; val?: number; artifact?: number; creatures?: string }[];
  /** Morale and luck from artifacts, for this side and (enemy*) for the other side. */
  morale?: number;
  luck?: number;
  enemyMorale?: number;
  /** No morale penalty for mixing towns: "all" (Temple of Loyalty) or "nonEvil" (Angelic Alliance). */
  unitedArmy?: "all" | "nonEvil";
  enemyLuck?: number;
  /** HotA's Charm of Eclipse, Seal of Sunset, Plate of Dying Light: what the enemy hero's spell power loses (negative). */
  enemySpellPower?: number;
  /** The Spirit of Oppression / Hourglass of the Evil Hour: nobody's morale / luck above 0 in this battle. */
  noMorale?: boolean;
  noLuck?: boolean;
  /** HotA's Diplomat's Cloak: may retreat or surrender defending a town, surrender to monsters, and ignore the Hit & Run ban. */
  diplomat?: boolean;
}

export interface BattleSideState {
  name: string;
  controller: Controller;
  /** Auto combat: the computer plays a player's side, but never flees or surrenders for them (as in the original). */
  auto?: boolean;
  /** Player colour on the adventure map (none for monsters and quick battles). */
  owner?: number;
  /** Commanding hero: their attack/defense apply to every stack on this side. */
  hero?: BattleHero;
  /** Morale and luck for the whole side from a besieged town's buildings. */
  morale?: number;
  luck?: number;
  /** A Clone was cast this battle (Eovacius' double clone is only the first). */
  cloned?: boolean;
  /** The owner has the Factory's Lightning Rod: the damage it strikes every enemy stack with as the battle opens. */
  lightningRod?: number;
  /** The Lightning Rod has struck (once, as the side first acts). */
  rodStruck?: boolean;
  /** The hero's army in tight formation (stacks closer together). */
  tight?: boolean;
  /** Two deep (a test formation, not the original's): stacks in pairs along a row, one straight behind the other (what a breath shows on). */
  deep?: boolean;
  /** The owner's gold: what a surrender can be paid with (the computer's choice between surrender and retreat). */
  gold?: number;
}

export interface BattleState {
  /** Identifies the battle across messages (the setup seed). */
  id: number;
  rng: number;
  round: number;
  sides: [BattleSideState, BattleSideState];
  /** Only the creatures in play, so the state is self-contained (saves, sims, network). */
  creatures: Record<number, CreatureStats>;
  /** Battlefield id (see BATTLEFIELDS): background and obstacle set. */
  field: string;
  /** The ground fought on: creatures native to it get +1 Attack, Defense and Speed. */
  terrain?: string;
  /** The Lodestar (Cove Grail) of a player in this battle: every terrain is native to Cove creatures, and they step over land mines. */
  lodestar?: boolean;
  /** A town's defender's spell points from before the town's bonuses (Mana Generator, Skyship), and whether the Skyship refills them after. */
  townMana?: { before: number; refill: boolean };
  obstacles: PlacedObstacle[];
  /** Hexes nobody can stand on. */
  blocked: number[];
  units: Unit[];
  /** Unit whose turn it is; null once the battle is over. */
  active: number | null;
  winner: Side | "draw" | null;
  log: LogEntry[];
  /** Spells that may be cast in this battle (the heroes' spellbooks). */
  spells?: Record<number, SpellInfo>;
  /** Spells laid on the field: Quicksand, Land Mines, Force Fields, Fire Walls. */
  hazards?: Hazard[];
  /** HotA's rule changes this game turned off. */
  rules?: RuleOverrides;
  /** A town siege: walls, gate, towers and moat. */
  siege?: SiegeState;
  /** A side whose hero retreated or surrendered (the battle is lost, the hero lives on); a surrender's price in gold. */
  fled?: { side: Side; surrender: boolean; cost?: number };
  /** The defenders (side 1) hold a town, walled or not: their hero may neither retreat nor surrender, but
   * through Stronghold's Escape Tunnel (retreat only) or with the Diplomat's Cloak. */
  town?: { escape?: boolean };
  /** An Anti-magic Garrison's battle: no spells cast (but the Faerie Dragons'). */
  noMagic?: boolean;
  /** Tactics phase: this side may rearrange its troops within `cols` columns of its edge first. */
  tactics?: { side: Side; cols: number };
  /** Spells each side's hero cast (Eagle Eye lets the winner learn the other side's). */
  castLog?: [number[], number[]];
  /** Has each side's hero cast a spell this round? */
  cast?: [boolean, boolean];
}

export interface Hazard {
  kind: "quicksand" | "mine" | "forceField" | "fireWall";
  hexes: number[];
  /** The side that cast it (its own troops know where it is and aren't hurt by mines). */
  side: Side;
  /** Rounds left; -1 for the whole battle. */
  rounds: number;
  /** Damage dealt by mines and fire. */
  damage?: number;
  /** Seen by the other side (once a creature blunders into it). */
  revealed?: boolean;
  /** The ground's own (Dunes): nobody's, hidden from both sides and stopping both. */
  neutral?: boolean;
}

export interface StackSetup {
  creature: number;
  count: number;
}

export interface BattleSetup {
  seed: number;
  /** Battlefield id; random ordinary field when omitted. */
  field?: string;
  /** The ground fought on (dirt, grass... highlands), for native terrain; the field's own when omitted. */
  terrain?: string;
  /** Attacking a town with a fort: the defenders (side 1) get walls and towers. */
  siege?: SiegeSetup;
  /** A creature bank's fight: a clear field (VCMI's creatureBank layouts, obstaclesAllowed false). */
  noObstacles?: boolean;
  /** HotA's rule changes this game turned off (adventure/gameRules.ts). */
  rules?: RuleOverrides;
  /**
   * A creature bank's fight: the hero's army in the middle of the field, the guards around it, on the
   * bank's own hexes (BANK_LAYOUTS); `true` picks narrow or wide by the guards.
   */
  bank?: boolean | BankLayout;
  /** The defenders hold a town (a siege without walls too): see BattleState.town. */
  town?: { escape?: boolean };
  /** An Anti-magic Garrison's battle (BattleState.noMagic). */
  noMagic?: boolean;
  sides: [
    BattleSideState & { stacks: StackSetup[] },
    BattleSideState & { stacks: StackSetup[] },
  ];
}

// Rows used for N stacks, as in the original game's loose formation.
const FORMATIONS = [[], [5], [2, 8], [2, 5, 8], [0, 4, 6, 10], [0, 2, 5, 8, 10], [0, 2, 4, 6, 8, 10], [0, 2, 4, 5, 6, 8, 10]];
/** ...and the tight one (VCMI's gameConfig attackerUnitsTight). */
const TIGHT = [[], [5], [4, 6], [4, 5, 6], [2, 4, 6, 8], [2, 4, 5, 6, 8], [0, 2, 4, 6, 8, 10], [0, 2, 4, 5, 6, 8, 10]];
/** ...and two deep: the rows of each pair (the first of a pair a step forward, the second straight behind it). */
const DEEP_ROWS = [5, 3, 7, 1];
/**
 * Creature banks' formations (VCMI's gameConfig layouts creatureBankNarrow / creatureBankWide, as the
 * original; HotA's own for the Churchyard, the Spit and the Ruins from the HotA mod; the hexes drawn on
 * heroes.thelazy.net's bank pages): the hero's stacks in a ring in the middle (BANK_ARMY), the guards
 * in their order on the bank's hexes. Narrow: the corners, the right edge's middle and the top's;
 * wide: the left ones a hex further out (for double-wide guards, though the Red Tower's Fire
 * Elementals are not); the Churchyard: three along the top, three along the bottom; the Spit: one on
 * each side, the hero's army between; the Ruins: the corners and the top's middle.
 */
const BANK_ARMY = [57, 61, 90, 93, 96, 125, 129];
export const BANK_LAYOUTS = {
  narrow: [15, 185, 172, 2, 100, 87, 8],
  wide: [15, 185, 171, 1, 100, 86, 8],
  churchyard: [14, 184, 172, 2, 8, 178, 99],
  spit: [99, 86, 7, 177],
  ruins: [15, 185, 172, 2, 8, 174, 181],
} as const;
export type BankLayout = keyof typeof BANK_LAYOUTS;

/** HotA's Fangarm, the creature the Horn of the Abyss raises. */
export const FANGARM = 168;

/** War machine artifacts: the creature that fights, its kind and its hex (attacker, defender). */
export const WAR_MACHINES: Record<number, { creature: number; kind: "ballista" | "cannon" | "tent" | "cart" | "catapult"; hex: [number, number] }> = {
  4: { creature: 146, kind: "ballista", hex: [52, 66] },
  // HotA's Cannon, where the ballista stands.
  146: { creature: 150, kind: "cannon", hex: [52, 66] },
  5: { creature: 148, kind: "cart", hex: [18, 32] },
  6: { creature: 147, kind: "tent", hex: [154, 168] },
  3: { creature: 145, kind: "catapult", hex: [120, 134] },
};

export function createBattle(setup: BattleSetup, table: CreatureStats[], spellTable: SpellInfo[] = []): BattleState {
  const creatures: Record<number, CreatureStats> = {};
  // The Horn of the Abyss raises Fangarms.
  if (setup.sides.some((x) => x.hero?.bonuses?.some((b) => b.type === "RAISE_FANGARMS")) && table[FANGARM]) creatures[FANGARM] = table[FANGARM];
  // Spells the heroes know, and the elementals they could summon.
  const spells: Record<number, SpellInfo> = {};
  for (const side of setup.sides) {
    for (const id of side.hero?.spells ?? []) {
      if (spellTable[id]) spells[id] = spellTable[id];
      const summoned = SUMMONED[id];
      if (summoned !== undefined && table[summoned]) creatures[summoned] = table[summoned];
    }
  }
  // Spells creatures cast (Archangels, Faerie Dragons, Genies, Enchanters...), and the Demons Pit Lords raise.
  for (const side of setup.sides) {
    for (const stack of side.stacks) {
      const c = table[stack.creature];
      if (!c) continue;
      // (And those their blows cast, for their levels and strength: a Medusa's gaze is a level 3 spell to a Red Dragon, a Sea Witch's Weakness takes the table's values.)
      const keys = c.abilities.filter((a) => (a.type === "SPELLCASTER" || a.type === "ENCHANTER" || a.type === "SPELL_AFTER_ATTACK") && a.subtype).map((a) => a.subtype!);
      if (c.abilities.some((a) => a.type === "RANDOM_SPELLCASTER")) keys.push(...GENIE_SPELLS);
      for (const key of keys) {
        const sp = spellTable.find((x) => x?.key === key);
        if (sp) spells[sp.id] = sp;
      }
      if (keys.includes("summonDemons") && table[48]) creatures[48] = table[48];
    }
    // Spells artifacts cast as the battle opens (Angelic Alliance, Armor of the Damned...).
    for (const b of side.hero?.bonuses ?? []) {
      if (b.type !== "OPENING_BATTLE_SPELL") continue;
      const sp = spellTable.find((x) => x?.key === b.subtype);
      if (sp) spells[sp.id] = sp;
    }
  }
  const units: Unit[] = [];
  const wideGuards = setup.sides[1].stacks.some((g) => table[g.creature] && hasAbility(table[g.creature], "DOUBLE_WIDE"));
  const layout: BankLayout | undefined = setup.bank === true ? (wideGuards ? "wide" : "narrow") : setup.bank || undefined;
  const bankHexes: readonly (readonly number[])[] | null = layout ? [BANK_ARMY, BANK_LAYOUTS[layout]] : null;
  setup.sides.forEach((side, s) => {
    const rows = (side.tight ? TIGHT : FORMATIONS)[Math.min(side.stacks.length, 7)];
    side.stacks.slice(0, 7).forEach((stack, i) => {
      const c = table[stack.creature];
      creatures[c.id] = c;
      const wide = hasAbility(c, "DOUBLE_WIDE");
      const edge = (two: boolean) => (s === 0 ? (two ? 2 : 1) : two ? 14 : 15);
      // (Two deep: the first of a pair stands just forward of its partner, which keeps the edge.)
      const partner = side.deep && i % 2 === 0 ? table[side.stacks[i + 1]?.creature] : undefined;
      const col = partner ? edge(hasAbility(partner, "DOUBLE_WIDE")) + (s === 0 ? 1 : -1) * (wide ? 2 : 1) : edge(wide);
      const row = side.deep ? DEEP_ROWS[Math.floor(i / 2) % DEEP_ROWS.length] : rows[i];
      // In a bank, VCMI's hexes; a wide guard on the right edge keeps its tail on the field (VCMI
      // counts the edge column, which isn't playable here).
      const at = bankHexes?.[s][i];
      const pos = at === undefined ? hexAt(col, row) : wide && s === 1 && at % 17 === 15 ? at - 1 : at;
      units.push({
        id: units.length,
        side: s as Side,
        creature: c.id,
        count: stack.count,
        firstHp: c.hp,
        pos,
        shots: c.shots,
        retaliations: 0,
        acted: false,
        waited: false,
        defending: false,
        hadMorale: false,
        initialCount: stack.count,
      });
    });
  });
  // War machines on their usual hexes: ballista, ammo cart, first aid tent, and the catapult in
  // sieges (a hero defending a town leaves the ballista to the towers).
  setup.sides.forEach((side, s) => {
    for (const art of side.hero?.machines ?? []) {
      const m = WAR_MACHINES[art];
      const c = m && table[m.creature];
      if (!c) continue;
      if (m.kind === "catapult" && (!setup.siege || s === 1)) continue;
      if ((m.kind === "ballista" || m.kind === "cannon") && setup.siege && s === 1) continue;
      creatures[c.id] = c;
      units.push({
        id: units.length,
        side: s as Side,
        creature: c.id,
        count: 1,
        firstHp: c.hp,
        pos: m.hex[s],
        shots: c.shots,
        retaliations: 0,
        acted: false,
        waited: false,
        defending: false,
        hadMorale: false,
        initialCount: 1,
        machine: m.kind,
      });
    }
  });
  // Arrow towers: the keep with a citadel, two more with a castle.
  const siege = setup.siege ? createSiege(setup.siege) : undefined;
  if (siege && table[ARROW_TOWER]) {
    creatures[ARROW_TOWER] = table[ARROW_TOWER];
    for (const part of ["keep", "bottomTower", "upperTower"] as const) {
      if (!siege.walls[part]) continue;
      units.push({
        id: units.length,
        side: 1,
        creature: ARROW_TOWER,
        count: 1,
        firstHp: table[ARROW_TOWER].hp,
        pos: TOWER_POS[part],
        shots: 99,
        retaliations: 0,
        acted: false,
        waited: false,
        defending: false,
        hadMorale: false,
        initialCount: 1,
        machine: "tower",
      });
    }
  }
  const state: BattleState = {
    id: setup.seed,
    rng: setup.seed >>> 0,
    ...(setup.rules ? { rules: setup.rules } : {}),
    round: 1,
    sides: [
      { name: setup.sides[0].name, controller: setup.sides[0].controller, hero: setup.sides[0].hero, owner: setup.sides[0].owner, lightningRod: setup.sides[0].lightningRod, gold: setup.sides[0].gold },
      { name: setup.sides[1].name, controller: setup.sides[1].controller, hero: setup.sides[1].hero, owner: setup.sides[1].owner, lightningRod: setup.sides[1].lightningRod, gold: setup.sides[1].gold },
    ],
    creatures,
    spells,
    cast: [false, false],
    field: "",
    obstacles: [],
    blocked: [],
    units,
    active: null,
    winner: null,
    log: [],
  };
  const ordinary = BATTLEFIELDS.filter((f) => !f.special && !f.impassable && f.terrain && f.terrain !== "water");
  const field = BATTLEFIELDS.find((f) => f.id === setup.field) ?? ordinary[randInt(state, 0, ordinary.length - 1)];
  state.field = field.id;
  const ground = setup.terrain ?? field.terrain;
  if (ground) state.terrain = ground;
  const town = setup.town ?? (setup.siege ? { escape: setup.siege.escape } : undefined);
  if (town) state.town = town;
  if (setup.noMagic) state.noMagic = true;
  if (siege) {
    // The town's own background, no obstacles: just the walls.
    state.siege = siege;
    state.obstacles = [];
    state.blocked = wallBlocked(siege);
    // A Tower town's "moat" is hidden land mines, gone once set off (VCMI's towerMoat): 10 x the
    // defending hero's Power + 25 (no or Basic Fire Magic) / 50 / 100, at least 150; Sorcery and the Orb of
    // Tempestuous Fire add to it (heroes.thelazy.net Moat: 13 Power, 11 at Advanced, 6 at Expert pass 150).
    if (siege.moat && siege.faction === "tower") {
      const dh = setup.sides[1]?.hero;
      const formula = dh ? 10 * dh.primary[2] + [25, 25, 50, 100][skillLevel(dh.skills, "fireMagic")] : 0;
      const orb = (dh?.bonuses ?? []).filter((b) => b.type === "SPELL_DAMAGE" && b.subtype === "fire").reduce((a, b) => a + (b.val ?? 0), 0);
      const damage = Math.floor(Math.max(siege.moat.damage, formula) * (1 + SORCERY[skillLevel(dh?.skills, "sorcery")]) * (1 + orb / 100));
      state.hazards = siege.moat.hexes.map((h) => ({ kind: "mine" as const, hexes: [h], side: 1 as const, rounds: -1, damage }));
      // The mines are the spell's: what spares a stack from Land Mines (fire immunity, Protection from Fire) spares it here.
      const mine = spellTable.find((x) => x?.key === "landMine");
      if (mine) state.spells = { ...state.spells, [mine.id]: mine };
      siege.moat = null;
    }
    return state;
  }
  state.obstacles = setup.noObstacles ? [] : placeObstacles(state, field);
  state.blocked = blockedHexes(field, state.obstacles);
  // Dunes (HotA): 15 to 20 patches of quicksand nobody can see until someone wades in (heroes.thelazy.net Terrain).
  if (field.id === "dunes") {
    const free = [...Array(HEX_COUNT).keys()].filter((h) => isPlayable(hexCol(h), hexRow(h)) && !state.blocked.includes(h) && !state.units.some((u) => u.pos === h || (hasAbility(state.creatures[u.creature], "DOUBLE_WIDE") && Math.abs(u.pos - h) === 1)));
    const n = randInt(state, 15, 20);
    state.hazards = [];
    for (let i = 0; i < n && free.length; i++) state.hazards.push({ kind: "quicksand", hexes: free.splice(randInt(state, 0, free.length - 1), 1), side: 0, rounds: -1, neutral: true });
  }
  return state;
}

/**
 * A copy of the battle to play a move out on (the AI's look-ahead), as structuredClone makes it but
 * several times faster: the creature and spell tables, which a battle never changes, are shared, and
 * so are the log's entries (the copy's log is a list of its own).
 */
export function copyBattle(s: BattleState): BattleState {
  const t = {} as Record<string, unknown>;
  for (const k in s) {
    const v = (s as unknown as Record<string, unknown>)[k];
    t[k] = k === "creatures" || k === "spells" ? v : k === "log" ? (v as LogEntry[]).slice() : copy(v);
  }
  return t as unknown as BattleState;
}

/** A deep copy of plain data (anything else, structuredClone's). */
function copy(v: unknown): unknown {
  if (typeof v !== "object" || v === null) return v;
  if (Array.isArray(v)) {
    const a = new Array(v.length);
    for (let i = 0; i < v.length; i++) if (i in v) a[i] = copy(v[i]);
    return a;
  }
  if (Object.getPrototypeOf(v) !== Object.prototype) return structuredClone(v);
  const o: Record<string, unknown> = {};
  for (const k in v) o[k] = copy((v as Record<string, unknown>)[k]);
  return o;
}
