// Terrain pictures for a map made here (random maps): each tile's frame and mirroring picked from
// its 3x3 neighbourhood by the original's rules, as VCMI's CDrawTerrainOperation does with its
// terrainViewPatterns.json (made in packages/vcmi-data). Normal terrains (grass, snow, lava...) border other
// land with a dirt edge and water or rock with a sand edge; dirt borders sand; sand has none; water
// and rock border land with a sand edge. Tiles no pattern can draw (a one-tile spit, a diagonal
// touch) are first turned into a neighbour's terrain, as VCMI's terrain painting does.
import { Terrain } from "./world.ts";
import { TERRAIN_VIEWS } from "../../../vcmi-data/src/terrainViews.ts";

interface Rule {
  name: string;
  points: number;
}
interface Pattern {
  id: string;
  /** Per cell (row by row, the middle unused), the rules any of which may hold. */
  data: Rule[][];
  decoration: boolean;
  minPoints: number;
  maxPoints: number;
  /** Frame ranges (first, last). */
  mapping: [number, number][];
  /** Rock's mirrored pictures are separate frames: 2 or 4 of them per pattern. */
  rotations: number;
}
type Flips = [Pattern, Pattern, Pattern, Pattern];

/** VCMI's config/terrainViewPatterns.json (made in packages/vcmi-data). */
const CONFIG = TERRAIN_VIEWS;

const parseCells = (data: string[]): Rule[][] =>
  data.map((cell) =>
    cell
      .replace(/\s/g, "")
      .split(",")
      .map((r) => {
        const [name, points] = r.split("-");
        return { name, points: Number(points ?? 0) };
      }),
  );

/** The pattern and its three mirror images: left-right, top-bottom, both (VCMI's flipPattern; flip bit 0 left-right, bit 1 top-bottom, as the map's tile flags). */
function flips(p: Pattern): Flips {
  const h = (d: Rule[][]) => [d[2], d[1], d[0], d[5], d[4], d[3], d[8], d[7], d[6]];
  const v = (d: Rule[][]) => [d[6], d[7], d[8], d[3], d[4], d[5], d[0], d[1], d[2]];
  return [p, { ...p, data: h(p.data) }, { ...p, data: v(p.data) }, { ...p, data: h(v(p.data)) }];
}

/** The patterns by terrain group (normal, dirt, sand, water, rock, hota), in order. */
const VIEW = new Map<string, Flips[]>();
for (const node of CONFIG.view) {
  for (const [group, text] of Object.entries(node.mapping)) {
    const m = text.replace(/\s/g, "");
    const colon = m.indexOf(":");
    const mode = colon >= 0 ? m.slice(0, colon) : "";
    const ranges = (colon >= 0 ? m.slice(colon + 1) : m).split(",").map((r) => {
      const [a, b] = r.split("-").map(Number);
      return [a, b ?? a] as [number, number];
    });
    const p: Pattern = { id: node.id, data: parseCells(node.data), decoration: !!node.decoration, minPoints: node.minPoints ?? 0, maxPoints: node.maxPoints || Infinity, mapping: ranges, rotations: mode.endsWith("D") ? Number(mode.slice(0, -1)) : 0 };
    const list = VIEW.get(group) ?? VIEW.set(group, []).get(group)!;
    list.push(flips(p));
  }
}
const TYPE = new Map<string, Flips>(CONFIG.type.map((t) => [t.id, flips({ id: t.id, data: parseCells(t.data), decoration: false, minPoints: 0, maxPoints: Infinity, mapping: [], rotations: 0 })]));

const HIGHLANDS = 10;
const WASTELAND = 11;
const group = (t: number) => (t === Terrain.DIRT ? "dirt" : t === Terrain.SAND ? "sand" : t === Terrain.WATER ? "water" : t === Terrain.ROCK ? "rock" : t === HIGHLANDS || t === WASTELAND ? "hota" : "normal");
/** Water and rock want a sand edge against land (VCMI's transitionRequired). */
const needsSand = (t: number) => t === Terrain.WATER || t === Terrain.ROCK;
/** A neighbour that land meets with a sand edge (VCMI's isSand: sand itself, water, rock). */
const sandEdge = (t: number) => t === Terrain.SAND || needsSand(t);
const passable = (t: number) => t !== Terrain.ROCK;

export interface TerrainGrid {
  size: number;
  /** Terrain by tile index (level x size x size). */
  terrain: (i: number) => number;
}

interface Result {
  ok: boolean;
  flip: number;
  /** A pattern's T cells all came out dirt ("D") or sand ("S"). */
  transition: "" | "D" | "S";
}

function cellTerrain(g: TerrainGrid, x: number, y: number, z: number, centre: number): { t: number; inside: boolean } {
  const n = g.size;
  const at = (cx: number, cy: number) => g.terrain(z * n * n + cy * n + cx);
  if (x >= 0 && y >= 0 && x < n && y < n) return { t: at(x, y), inside: true };
  // Off the map: the neighbour's terrain inward (a corner: the tile's own).
  if ((x < 0 || x >= n) && (y < 0 || y >= n)) return { t: centre, inside: false };
  return { t: at(Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))), inside: false };
}

function validateInner(g: TerrainGrid, x: number, y: number, z: number, p: Pattern, depth: number, loose: boolean): Result {
  const centre = g.terrain(z * g.size * g.size + y * g.size + x);
  let total = 0;
  let transition: "" | "D" | "S" = "";
  for (let i = 0; i < 9; i++) {
    if (i === 4) continue;
    const cx = x + (i % 3) - 1;
    const cy = y + Math.floor(i / 3) - 1;
    const { t, inside } = cellTerrain(g, cx, cy, z, centre);
    const alien = inside && t !== centre && (passable(t) || passable(centre));
    let top = -1;
    for (const r0 of p.data[i]) {
      let rule = r0.name;
      const standard = ["?", "D", "N", "S", "T", "N!"].includes(rule);
      if (!standard) {
        // Another pattern named: the neighbour must itself be drawn with it.
        if (loose) {
          // (Loosely: any neighbour of the tile's own terrain.)
          if (!inside || t === centre) top = Math.max(top, r0.points);
          continue;
        }
        if (depth === 0 && inside) {
          if (centre === t || (centre === Terrain.DIRT && !sandEdge(t))) {
            const other = VIEW.get(group(t))?.find((f) => f[0].id === rule);
            if (other && validate(g, cx, cy, z, other, 1).ok) top = Math.max(top, r0.points);
          }
          continue;
        }
        rule = "N";
      }
      const any = rule === "?";
      const native = rule === "N";
      const nativeStrong = rule === "N!";
      const dirt = rule === "D";
      const sand = rule === "S";
      const trans = rule === "T";
      let ok = false;
      const nativeOk = (nativeStrong || native) && !alien;
      if (centre === Terrain.DIRT) {
        const nat = native && !sandEdge(t);
        const sandOk = (sand || trans) && sandEdge(t);
        ok = any || sandOk || nat || nativeOk;
      } else if (centre === Terrain.SAND) ok = true;
      else if (needsSand(centre)) ok = any || ((sand || trans) && alien) || nativeOk;
      else {
        const dirtOk = (dirt || trans) && alien && !sandEdge(t);
        const sandOk = (sand || trans) && sandEdge(t);
        if (!transition && trans && (dirtOk || sandOk)) transition = dirtOk ? "D" : "S";
        if (trans) ok = (dirtOk && transition !== "S") || (sandOk && transition !== "D");
        else ok = any || dirtOk || sandOk || nativeOk;
      }
      if (ok) top = Math.max(top, r0.points);
    }
    if (top < 0) return { ok: false, flip: 0, transition: "" };
    total += top;
  }
  return (loose || total >= p.minPoints) && total <= p.maxPoints ? { ok: true, flip: 0, transition } : { ok: false, flip: 0, transition: "" };
}

function validate(g: TerrainGrid, x: number, y: number, z: number, f: Flips, depth = 0, loose = false): Result {
  for (let flip = 0; flip < 4; flip++) {
    const r = validateInner(g, x, y, z, f[flip], depth, loose);
    if (r.ok) return { ...r, flip };
  }
  return { ok: false, flip: 0, transition: "" };
}

/** Can the tile be drawn at all (VCMI's getInvalidTiles' test)? */
export function drawableTile(g: TerrainGrid, x: number, y: number, z: number): boolean {
  const t = g.terrain(z * g.size * g.size + y * g.size + x);
  let ok = validate(g, x, y, z, TYPE.get("n1")!).ok;
  if (ok && (t === Terrain.WATER || !passable(t))) ok = !validate(g, x, y, z, TYPE.get("s1")!).ok && !validate(g, x, y, z, TYPE.get("s2")!).ok;
  else if (!ok && t !== Terrain.WATER && passable(t)) ok = validate(g, x, y, z, TYPE.get("n2")!).ok || validate(g, x, y, z, TYPE.get("n3")!).ok;
  return ok;
}

/**
 * The tile's picture: { view, flags } (flags: bit 0 mirrored left-right, bit 1 top-bottom), or null
 * when no pattern fits. `random(lo, hi)` picks among a pattern's frames; `decorations` is the share
 * (0..100) of plain tiles drawn with a decorated frame.
 */
export function terrainView(g: TerrainGrid, x: number, y: number, z: number, random: (lo: number, hi: number) => number, decorations = 0): { view: number; flags: number } | null {
  const t = g.terrain(z * g.size * g.size + y * g.size + x);
  // (Where the original's rules find nothing, as beside a mixed corner, they're tried again loosely:
  // a pattern that wants its neighbour drawn a certain way takes any neighbour of the same terrain.)
  for (const loose of [false, true]) for (const f of VIEW.get(group(t)) ?? []) {
    const r = validate(g, x, y, z, f, 0, loose);
    if (!r.ok) continue;
    const p = f[r.flip];
    let range = p.mapping[0];
    if (p.decoration && p.mapping.length > 1 && random(0, 100) <= decorations) range = p.mapping[1];
    if (r.transition) range = r.transition === "D" ? p.mapping[0] : (p.mapping[1] ?? p.mapping[0]);
    if (!p.rotations) return { view: random(range[0], range[1]), flags: r.flip };
    const per = (range[1] - range[0] + 1) / p.rotations;
    const flip = p.rotations === 2 && r.flip === 2 ? 1 : r.flip;
    const first = range[0] + flip * per;
    return { view: random(first, first + per - 1), flags: 0 };
  }
  return null;
}
