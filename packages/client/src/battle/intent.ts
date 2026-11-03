// What a click on the battlefield would do: the active stack's choice at the pointed hex (move, attack
// from which side, shoot, aim at a wall, cast, heal), worked out from the rules alone. The battle
// screen draws it (marks, the cursor, the status line) and sends its action on a click.
import {
  type BattleAction,
  type BattleState,
  type SpellInfo,
  type Unit,
  type WallPart,
  CYCLOPS_SHOT,
  WALL_HEX,
  WALL_SEGMENTS,
  alternateAction,
  areaShooter,
  areaShotTargets,
  attackApproaches,
  attackPositions,
  hexToward,
  canShoot,
  canShootAt,
  canShootWalls,
  catapultTable,
  catapultTargets,
  chanceToHit,
  controlSide,
  creatureSpellAt,
  fliesBack,
  healTargets,
  hexCol,
  hexRow,
  isPlayable,
  reachable,
  skillLevel,
  unitAt,
  unitHexes,
} from "@heroes/core";
import { hexCenter } from "./layout.ts";

/** An action a click sends (the screen keeps it while the pointer stays). */
export type Intent =
  | { kind: "move"; to: number }
  | { kind: "attack"; target: Unit; from: number; stay?: boolean }
  | { kind: "creatureCast"; hex: number }
  | { kind: "shoot"; target: Unit }
  | { kind: "shootHex"; hex: number }
  | { kind: "wall"; part: WallPart }
  | { kind: "heal"; target: Unit };

/** What the pointed hex means for the active stack, with what the screen says about it. */
export type Pointing =
  /** The catapult or Cyclopes aim at a wall part (`chance`: % to hit). */
  | { kind: "wall"; part: WallPart; chance: number }
  | { kind: "heal"; target: Unit }
  /** Dreadnoughts' Heat Stroke on the hex (it burns friends too). */
  | { kind: "heatStroke"; hex: number }
  | { kind: "creatureCast"; hex: number; spells: SpellInfo[]; target?: Unit }
  | { kind: "shoot"; target: Unit }
  | { kind: "outOfReach"; target: Unit }
  /** `returns`: Harpies fly back after (unless `stay`); `melee`: a shooter fighting hand to hand. */
  /** `blow`: the way the sword cursor points (from the side picked toward the pointed hex). */
  | { kind: "attack"; target: Unit; from: number; dist: number; returns: boolean; stay: boolean; melee: boolean; blow: { from: Point; to: Point } }
  | { kind: "shootHex"; hex: number; hit: Unit[] }
  | { kind: "move"; to: number }
  /** A stack to look at (`query`: under the active stack's question-mark cursor), or nothing. */
  | { kind: "look"; target?: Unit; query: boolean }
  /** Nothing to do here (`machine`: the catapult or tent, which can do nothing else). */
  | { kind: "blocked"; machine?: boolean };

export interface PointAt {
  hex: number;
  /** Where the pointer is on the field (the side to attack from, the wall part near it). */
  pointer: { x: number; y: number };
  /** HotA's alternate action (Alt, or the button). */
  alt: boolean;
  /** Shift: a Magog aims at any empty hex. */
  shift: boolean;
  /** Units still moving on screen: the machines wait. */
  animating: boolean;
  /** A tower whose picture is under the pointer (siegeView.ts towerPictureAt): aimed at by its picture too. */
  towerPicture?: WallPart | null;
}

/** What a click at `at` would do for the active stack `u` (none: only looking). */
export function pointingAt(s: BattleState, u: Unit | undefined, at: PointAt): Pointing {
  const { hex, pointer, alt, animating } = at;
  // Our catapult (with Ballistics) and Cyclopes in a siege: pointing at a part of the walls aims at
  // it; the catapult can do nothing else, Cyclopes only take walls. (HotA 1.7: no wall shooting in
  // the Cyclopes' alternate action.)
  const catapult = u?.machine === "catapult";
  if (u && !animating && (catapult || (canShootWalls(s, u) && !alt))) {
    const targets = catapultTargets(s).filter((p) => catapult || WALL_SEGMENTS.includes(p));
    const part =
      targets.find((p) => {
        const c = hexCenter(WALL_HEX[p]);
        return Math.hypot(c.x - pointer.x, c.y - pointer.y) < 40;
      }) ?? (at.towerPicture && targets.includes(at.towerPicture) ? at.towerPicture : undefined);
    if (part) return { kind: "wall", part, chance: chanceToHit(part, catapult ? catapultTable(skillLevel(s.sides[u.side].hero?.skills, "ballistics")) : CYCLOPS_SHOT) };
    if (catapult) return { kind: "blocked", machine: true };
  }
  const other = unitAt(s, hex);
  // Our First Aid Tent (with First Aid): a wounded stack of ours.
  if (u?.machine === "tent" && !animating) return other && healTargets(s, u).includes(other) ? { kind: "heal", target: other } : { kind: "blocked", machine: true };
  if (!u) return { kind: "look", target: other, query: false };
  // Spellcasting creatures: cast on whatever their spell can reach; in the alternate action they move or
  // attack instead (Dreadnoughts' Heat Stroke, Olgoi-Khorkhoi's corpses, Archangels' and Pit Lords' too).
  const all = creatureSpellAt(s, u, hex);
  const kind = alternateAction(s, u);
  const spells = (alt && kind === "plain") || (!alt && kind === "power") ? [] : all;
  if (spells.length && all.some((sp) => sp.key.startsWith("heatStroke"))) return { kind: "heatStroke", hex };
  if (spells.length) return { kind: "creatureCast", hex, spells, target: s.units.find((x) => unitHexes(s, x).includes(hex) && !x.machine) };
  if (other && controlSide(other) !== controlSide(u)) {
    // (The alternate action: shooters walk up and fight hand to hand.)
    if (canShootAt(s, u, other) && !alt) return { kind: "shoot", target: other };
    const options = attackPositions(s, u, other);
    if (!options.length) return { kind: "outOfReach", target: other };
    // Attack from the side of the pointed hex the pointer is nearest, like the original (VCMI's selectNearestDirection).
    const { from, blow } = pickApproach(s, u, other, hex, pointer, options);
    // Harpies fly back after the blow; HotA's alternate action keeps them where they struck from.
    const returns = fliesBack(s, u, from);
    return { kind: "attack", target: other, from, dist: reachable(s, u).get(from)!.dist, returns, stay: returns && alt, melee: canShootAt(s, u, other), blow };
  }
  if (other) return { kind: "look", target: other, query: true };
  const reach = reachable(s, u);
  // Wide units: allow pointing at the hex where the tail would go.
  const head = reach.has(hex) ? hex : [...reach.keys()].find((h) => unitHexes(s, u, h).includes(hex));
  // HotA's Magogs aim at an empty hex beyond their reach (Shift: any empty hex) and the blast catches whoever stands around it.
  if ((head === undefined || at.shift) && !alt && areaShooter(s, u) && canShoot(s, u) && isPlayable(hexCol(hex), hexRow(hex))) {
    const hit = areaShotTargets(s, u, hex);
    if (hit.some((x) => controlSide(x) !== controlSide(u))) return { kind: "shootHex", hex, hit };
  }
  if (head !== undefined && head !== u.pos) return { kind: "move", to: head };
  return { kind: "blocked" };
}

type Point = { x: number; y: number };

/**
 * Where on the field the pointer picks the side `dir` of `hex` (attackApproaches' 0-7): the neighbour's centre
 * for the six sides; for a wide attacker's centred spots, between the two neighbours above (below), 5 px out so
 * the sides keep most of the hex (VCMI's directionPoints, as the original).
 */
export function approachPoint(hex: number, dir: number): Point {
  if (dir < 6) return hexCenter(hexToward(hex, dir));
  const [a, b] = (dir === 6 ? [0, 1] : [3, 4]).map((d) => hexCenter(hexToward(hex, d)));
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (dir === 6 ? -5 : 5) };
}

/** The spot to strike `target` from with the pointer at `pointer` over its hex `hex` (among `options`, attackPositions). */
export function pickApproach(s: BattleState, u: Unit, target: Unit, hex: number, pointer: Point, options: number[]): { from: number; blow: { from: Point; to: Point } } {
  const d2 = (p: Point) => (p.x - pointer.x) ** 2 + (p.y - pointer.y) ** 2;
  let best: { from: number; blow: { from: Point; to: Point } } | null = null;
  let bestD = Infinity;
  for (const w of attackApproaches(s, u, target, hex)) {
    const p = approachPoint(hex, w.dir);
    if (d2(p) < bestD) [best, bestD] = [{ from: w.from, blow: { from: p, to: hexCenter(hex) } }, d2(p)];
  }
  if (best) return best;
  // (The pointed hex can't be struck from anywhere ours reaches, but the stack's other hex can: the spot nearest the pointer.)
  let from = options[0];
  for (const h of options) {
    const d = Math.min(...unitHexes(s, u, h).map(hexCenter).map(d2));
    if (d < bestD) [from, bestD] = [h, d];
  }
  const near = unitHexes(s, u, from).map(hexCenter).reduce((a, c) => (d2(c) < d2(a) ? c : a));
  const struck = unitHexes(s, target).map(hexCenter).reduce((a, c) => ((c.x - near.x) ** 2 + (c.y - near.y) ** 2 < (a.x - near.x) ** 2 + (a.y - near.y) ** 2 ? c : a));
  return { from, blow: { from: near, to: struck } };
}

/** The action a click sends for what's pointed at, or null (only looking). */
export function intentOf(p: Pointing): Intent | null {
  switch (p.kind) {
    case "wall":
      return { kind: "wall", part: p.part };
    case "heal":
      return { kind: "heal", target: p.target };
    case "heatStroke":
    case "creatureCast":
      return { kind: "creatureCast", hex: p.hex };
    case "shoot":
      return { kind: "shoot", target: p.target };
    case "attack":
      return { kind: "attack", target: p.target, from: p.from, stay: p.stay };
    case "shootHex":
      return { kind: "shootHex", hex: p.hex };
    case "move":
      return { kind: "move", to: p.to };
    default:
      return null;
  }
}

/** The battle action an intent sends for the stack `u`. */
export function actionOf(u: Unit, i: Intent): BattleAction {
  switch (i.kind) {
    case "wall":
      return { type: "catapult", unit: u.id, target: i.part };
    case "heal":
      return { type: "heal", unit: u.id, target: i.target.id };
    case "creatureCast":
      return { type: "creatureCast", unit: u.id, target: i.hex };
    case "move":
      return { type: "move", unit: u.id, to: i.to };
    case "attack":
      return { type: "attack", unit: u.id, target: i.target.id, from: i.from, ...(i.stay ? { stay: true } : {}) };
    case "shootHex":
      return { type: "shootHex", unit: u.id, hex: i.hex };
    case "shoot":
      return { type: "shoot", unit: u.id, target: i.target.id };
  }
}

/** An intent as a key: a second tap on a touch screen confirms the same one. */
export function intentKey(i: Intent): string {
  switch (i.kind) {
    case "wall":
      return `wall:${i.part}`;
    case "heal":
      return `heal:${i.target.id}`;
    case "creatureCast":
      return `creatureCast:${i.hex}`;
    case "move":
      return `move:${i.to}`;
    case "attack":
      return `attack:${i.target.id}:${i.from}`;
    case "shootHex":
      return `shootHex:${i.hex}`;
    case "shoot":
      return `shoot:${i.target.id}`;
  }
}
