// Town sieges: walls, gate, towers, moat and the catapult, after VCMI's siege rules
// (CBattleInfoCallback, config/spells/moats.json, vcmiAbility.json catapult tables).
import { hexRow } from "./hex.ts";
import type { BattleState, Side, Unit } from "./state.ts";
import { ruleOn } from "../adventure/gameRules.ts";

export type WallPart = "keep" | "bottomTower" | "bottomWall" | "belowGate" | "overGate" | "upperWall" | "upperTower" | "gate";

export interface SiegeSetup {
  faction: string;
  /** 1 fort, 2 citadel (keep and moat), 3 castle (stronger walls and two more towers). */
  level: number;
  /** Town structures, for arrow tower damage. */
  structures: number;
  /** Stronghold's Escape Tunnel: the defending hero may retreat. */
  escape?: boolean;
}

export interface SiegeState extends SiegeSetup {
  /** Hit points left per wall part (0 destroyed). */
  walls: Partial<Record<WallPart, number>>;
  /** Hit points of the walls when intact, for the cracked pictures. */
  wallMax: number;
  moat: { hexes: number[]; damage: number } | null;
  /**
   * The drawbridge (VCMI's EGateState; absent: up). "down": lowered and held by whoever lies in the gateway;
   * "blocked": up, and something on the bridge's hex in front of it (a stack, a corpse, a Force Field) keeps
   * it from coming down, for the defenders too. A broken gate (walls.gate 0) is neither.
   */
  bridge?: "down" | "blocked";
}

/** The hex each wall part covers (towers stand off the field). */
export const WALL_HEX: Record<WallPart, number> = {
  keep: 50,
  bottomTower: 183,
  bottomWall: 182,
  belowGate: 130,
  overGate: 78,
  upperWall: 29,
  upperTower: 12,
  gate: 96,
};
/** Wall hexes that never fall. */
const PERMANENT = [12, 45, 62, 112, 147, 165];
/** The two gate hexes: defenders pass, attackers wait until it's broken. */
export const GATE_HEXES = [95, 96];
/** The wall's hex on each row: shots from outside it over the wall do half damage. */
const LINE_WALL = [12, 29, 45, 62, 78, 96, 112, 130, 147, 165, 182];
/** Towers' (off-field) positions: keep, bottom, upper (VCMI's CASTLE_*_TOWER). */
export const TOWER_POS = { keep: -2, bottomTower: -3, upperTower: -4 } as const;

/**
 * Takes `damage` points off a wall part (catapult stones, Cyclopes, Earthquake). Fallen, its hex opens
 * and a tower takes its archers with it: the tower, when they were still shooting, for its death.
 */
export function damageWall(s: BattleState, part: WallPart, damage: number): { fallen: boolean; tower?: Unit } {
  const walls = s.siege!.walls;
  walls[part] = Math.max(0, (walls[part] ?? 0) - damage);
  if (damage <= 0 || walls[part]) return { fallen: false };
  s.blocked = s.blocked.filter((h) => h !== WALL_HEX[part]);
  const tower = s.units.find((x) => x.machine === "tower" && x.pos === TOWER_POS[part as keyof typeof TOWER_POS] && x.count > 0);
  if (tower) tower.count = 0;
  return { fallen: true, tower };
}

const MOAT = [11, 28, 44, 61, 77, 111, 129, 146, 164, 181];
const MOAT_WIDE = [10, 11, 27, 28, 43, 44, 60, 61, 76, 77, 94, 110, 111, 128, 129, 145, 146, 163, 164, 180, 181];
const MOAT_DAMAGE: Record<string, number> = { castle: 70, rampart: 70, tower: 150, inferno: 90, necropolis: 70, dungeon: 90, stronghold: 70, fortress: 90 };

export function createSiege(setup: SiegeSetup): SiegeState {
  const wallHp = setup.level >= 3 ? 3 : 2;
  const walls: Partial<Record<WallPart, number>> = { gate: 2, bottomWall: wallHp, belowGate: wallHp, overGate: wallHp, upperWall: wallHp };
  if (setup.level >= 2) walls.keep = 2;
  if (setup.level >= 3) walls.bottomTower = walls.upperTower = 2;
  const moat = setup.level >= 2 ? { hexes: setup.faction === "fortress" ? MOAT_WIDE : MOAT, damage: MOAT_DAMAGE[setup.faction] ?? 70 } : null;
  return { ...setup, walls, wallMax: wallHp, moat };
}

/** Hexes the walls block right now. */
export function wallBlocked(siege: SiegeState): number[] {
  const out = [...PERMANENT];
  for (const part of ["bottomWall", "belowGate", "overGate", "upperWall"] as WallPart[]) if (siege.walls[part]) out.push(WALL_HEX[part]);
  return out;
}

/** The hex in front of the gate, where the lowered bridge lies (VCMI's GATE_BRIDGE; over Fortress's wide moat). */
export const BRIDGE_HEX = 94;

/** The gateway: the hexes whoever lies on holds the drawbridge down (Fortress: its long bridge too). */
export const gatewayHexes = (s: BattleState) => (s.siege?.faction === "fortress" ? [BRIDGE_HEX, ...GATE_HEXES] : GATE_HEXES);

/** Is the drawbridge down (VCMI's EGateState::OPENED)? */
export const gateOpen = (s: BattleState): boolean => !!s.siege?.walls.gate && s.siege.bridge === "down";

/**
 * Can a unit of this side stand on this hex as far as the gate is concerned? Defenders pass while the
 * bridge can come down; attackers once the gate is broken or while the bridge is down (VCMI's
 * getAccessibility: the gate hexes are GATE (defenders only) while CLOSED, ACCESSIBLE to all while OPENED,
 * UNAVAILABLE while BLOCKED).
 */
export function gatePasses(s: BattleState, side: Side, hex: number): boolean {
  if (!s.siege || !GATE_HEXES.includes(hex) || !s.siege.walls.gate) return true;
  if (s.siege.bridge === "down") return true;
  return s.siege.bridge !== "blocked" && side === 1;
}

export const insideWalls = (hex: number) => hex >= LINE_WALL[hexRow(hex)];

/** Attackers shooting from outside at targets behind an intact wall do half damage. */
export function wallPenalty(s: BattleState, a: Unit, d: Unit): boolean {
  if (!s.siege || a.side !== 0 || a.machine || a.pos < 0) return false;
  if (insideWalls(a.pos) || !insideWalls(d.pos)) return false;
  // Through a breach (a fallen wall section on the target's row) there's no penalty.
  const hex = LINE_WALL[hexRow(d.pos)];
  const part = (Object.keys(WALL_HEX) as WallPart[]).find((p) => WALL_HEX[p] === hex && p !== "upperTower");
  return !part || (s.siege.walls[part] ?? 0) > 0;
}

/** Moat hexes, while there is a moat (Fortress's long bridge, while down or broken, is dry: VCMI's getStoppers). */
export const inMoat = (s: BattleState, hex: number) => !!s.siege?.moat?.hexes.includes(hex) && !(hex === BRIDGE_HEX && (!s.siege.walls.gate || s.siege.bridge === "down"));

// ---- catapult ----------------------------------------------------------------

/**
 * Shots and chances (%) per Ballistics level: keep, tower, gate (drawbridge), wall; then 1-damage and
 * 2-damage odds (the rest: no damage). HotA's table (heroes.thelazy.net/index.php/Ballistics):
 * expert always hits what it aims at, for 2.
 */
const CATAPULT = [
  { shots: 1, keep: 5, tower: 10, gate: 25, wall: 50, one: 60, two: 30 },
  { shots: 1, keep: 7, tower: 15, gate: 60, wall: 60, one: 50, two: 50 },
  { shots: 2, keep: 7, tower: 15, gate: 60, wall: 60, one: 50, two: 50 },
  { shots: 2, keep: 100, tower: 100, gate: 100, wall: 100, one: 0, two: 100 },
];

/** A Cyclops stone (VCMI's cyclopsShot): the basic odds with a 30% drawbridge chance. */
export const CYCLOPS_SHOT = { shots: 1, keep: 7, tower: 15, gate: 30, wall: 60, one: 50, two: 50 };

export const catapultTable = (ballistics: number) => CATAPULT[Math.max(0, Math.min(3, ballistics))];

/** Wall parts still standing that the catapult can aim at. */
export function catapultTargets(s: BattleState): WallPart[] {
  if (!s.siege) return [];
  return (Object.keys(s.siege.walls) as WallPart[]).filter((p) => (s.siege!.walls[p] ?? 0) > 0);
}

/**
 * Where Earthquake's points land (heroes.thelazy.net Fortifications, Earthquake): every point is drawn
 * by lot before any damage, through the targets in a fixed order. The draw counts only targets that can
 * still take a point but then counts through every standing one, so once a target has been dealt its
 * full health the last in the order (the Keep first) drop out and a point may land on one already doomed
 * (wasted). The Keep and the two towers count even where the town hasn't built them (points wasted too).
 */
export function earthquakeHits(walls: Partial<Record<WallPart, number>>, points: number, rand: () => number): WallPart[] {
  const order: WallPart[] = ["upperTower", "upperWall", "overGate", "gate", "belowGate", "bottomWall", "bottomTower", "keep"];
  const unbuilt = (p: WallPart) => walls[p] === undefined && (p === "keep" || p === "upperTower" || p === "bottomTower");
  const health = (p: WallPart) => (unbuilt(p) ? 2 : (walls[p] ?? 0));
  const standing = order.filter((p) => health(p) > 0);
  const dealt = new Map<WallPart, number>();
  const hits: WallPart[] = [];
  for (let i = 0; i < points; i++) {
    const open = standing.filter((p) => (dealt.get(p) ?? 0) < health(p)).length;
    if (!open) break;
    const p = standing[Math.floor(rand() * open)];
    if ((dealt.get(p) ?? 0) >= health(p)) continue;
    dealt.set(p, (dealt.get(p) ?? 0) + 1);
    if (!unbuilt(p)) hits.push(p);
  }
  return hits;
}

/** The four wall segments that fall, from the top of the field down. */
export const WALL_SEGMENTS: WallPart[] = ["upperWall", "overGate", "belowGate", "bottomWall"];

/**
 * Where each target sits along the wall, for "the nearest" (HotA wiki, Fortifications / Targeting):
 * the gate between the two middle segments, the towers past the ends, the keep by the lower wall.
 */
const ALONG: Record<WallPart, number> = { upperTower: -1, upperWall: 0, overGate: 1, gate: 2, belowGate: 3, bottomWall: 4, keep: 4.5, bottomTower: 5 };

/** Standing targets nearest to `from` along the wall (all of them when several are as near). */
function nearest(from: WallPart, among: WallPart[]): WallPart[] {
  const d = (p: WallPart) => Math.abs(ALONG[p] - ALONG[from]);
  const best = Math.min(...among.map(d));
  return among.filter((p) => d(p) === best);
}

const standing = (s: BattleState, p: WallPart) => (s.siege?.walls[p] ?? 0) > 0;

/**
 * A missed stone lands on the nearest standing wall segment along the wall (upper wall and the one
 * above the gate send to each other, as do the lower two; the gate to either middle one; the keep
 * to the lower wall; a tower to the wall by it). With no segment left it hits what it was aimed at.
 */
export function missedShotLands(s: BattleState, aimed: WallPart, pick: (n: number) => number): WallPart {
  const walls = WALL_SEGMENTS.filter((p) => p !== aimed && standing(s, p));
  if (!walls.length) return aimed;
  const near = nearest(aimed, walls);
  return near[pick(near.length)];
}

/** The second stone (Advanced / Expert) after the first destroyed its target: the nearest standing target of any kind. */
export function nextStoneTarget(s: BattleState, after: WallPart, pick: (n: number) => number): WallPart | null {
  const left = catapultTargets(s);
  if (!left.length) return null;
  const near = nearest(after, left);
  return near[pick(near.length)];
}

/** The wall segments with the fewest hit points left (an undamaged wall: all four). */
function weakestWalls(s: BattleState): WallPart[] {
  const walls = WALL_SEGMENTS.filter((p) => standing(s, p));
  const least = Math.min(...walls.map((p) => s.siege!.walls[p] ?? 0));
  return walls.filter((p) => (s.siege!.walls[p] ?? 0) === least);
}

/**
 * What a catapult aims at by itself (HotA wiki, Fortifications / Automatic shots):
 * - a Cyclops, or a catapult whose hero lacks Ballistics: the wall segment with the fewest hit points
 *   (a Cyclops only ever walls; the catapult, once all four are down, the gate, the keep, the towers);
 * - with Ballistics (the computer's hero, or the player's automatic catapult): the gate while it
 *   stands, then the walls while all four stand, then the keep, the towers, and the walls last.
 */
export function autoCatapultTarget(s: BattleState, ballistics: number, cyclops: boolean, pick: (n: number) => number): WallPart | null {
  if (!s.siege) return null;
  const weak = weakestWalls(s);
  const wall = () => (weak.length ? weak[pick(weak.length)] : null);
  if (cyclops) return wall();
  const order: WallPart[] = ["keep", "upperTower", "bottomTower"];
  if (!ballistics) return wall() ?? (["gate", ...order] as WallPart[]).find((p) => standing(s, p)) ?? null;
  if (standing(s, "gate")) return "gate";
  if (WALL_SEGMENTS.every((p) => standing(s, p))) return wall();
  return order.find((p) => standing(s, p)) ?? wall();
}

export function chanceToHit(part: WallPart, t: (typeof CATAPULT)[number]): number {
  if (part === "keep") return t.keep;
  if (part === "bottomTower" || part === "upperTower") return t.tower;
  if (part === "gate") return t.gate;
  return t.wall;
}

/** Arrow tower damage range: the keep 10-20, others 6-12, plus 2-4 per structure (half for side towers). */
export function towerDamageRange(siege: SiegeState, keep: boolean): [number, number] {
  const n = keep ? siege.structures : Math.floor(siege.structures / 2);
  return keep ? [10 + 2 * n, 20 + 4 * n] : [6 + 2 * n, 12 + 4 * n];
}

/** Does the moat hurt and stop this stack? Attackers always; the town's defenders too in HotA (the Shadow of Death spares them). */
export const moatHolds = (s: BattleState, u: Unit): boolean => u.side === 0 || ruleOn(s.rules, "moatDefenders");
