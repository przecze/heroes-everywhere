// Stand-in game files for layout screenshots where the real ones aren't available (a cloud
// session, CI): flat-coloured images and sprites at the original sizes, bar-glyph fonts,
// placeholder text tables and a small test map. Nothing here looks like the game; it only
// shows where things sit.
import { gzipSync } from "node:zlib";
import { CREATURE_INFO } from "../../packages/core/src/creatureData.ts";

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** A palette: slot 0 cyan (colour key), 10 the fill, 11 the border, 12 the text, from the name. */
function palette(name: string): Uint8Array {
  const pal = new Uint8Array(768);
  const h = hash(name);
  const fill = [40 + (h & 127), 40 + ((h >> 7) & 127), 40 + ((h >> 14) & 127)];
  pal.set([0, 255, 255], 0);
  pal.set(fill, 30);
  pal.set(fill.map((c) => Math.min(255, c + 80)), 33);
  pal.set([255, 255, 255], 36);
  return pal;
}

function box(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h).fill(10);
  for (let x = 0; x < w; x++) {
    px[x] = 11;
    px[(h - 1) * w + x] = 11;
  }
  for (let y = 0; y < h; y++) {
    px[y * w] = 11;
    px[y * w + w - 1] = 11;
  }
  // A diagonal, so stretching and flipping show.
  for (let i = 0; i < Math.min(w, h); i++) px[i * w + i] = 11;
  return px;
}

// Sizes of the images the layouts depend on (the rest are 64x64).
const PCX: Record<string, [number, number]> = {
  "advmap.pcx": [800, 600],
  "aresbar.pcx": [600, 22],
  "adstathr.pcx": [192, 192],
  "adstatcs.pcx": [192, 192],
  "adstatin.pcx": [192, 192],
  "adstatnx.pcx": [192, 192],
  "cbar.pcx": [800, 44],
  "gamselbk.pcx": [800, 600],
  "sysopbck.pcx": [480, 480],
  "cpresult.pcx": [470, 561],
  "hpsyyy.pcx": [48, 32],
  "tpmagebg.pcx": [800, 600],
  // Screen-sized windows (centred by their size).
  "heroscr4.pcx": [800, 600],
  "trade2.pcx": [800, 600],
  "ovcast.pcx": [800, 600],
  "gamselb0.pcx": [800, 600],
  "spelback.pcx": [620, 595],
  "chrpop.pcx": [77, 200],
};

export function pcx(name: string): Uint8Array {
  let [w, h] = PCX[name] ?? [64, 64];
  if (/^cmbk/.test(name)) [w, h] = [800, 556];
  if (/^hpl/.test(name)) [w, h] = [58, 64];
  if (/^hps/.test(name)) [w, h] = [48, 32];
  if (/^tb..back|^tbcs|bckgrnd|^tp.*bk/.test(name)) [w, h] = [800, 374];
  const out = new Uint8Array(12 + w * h + 768);
  const v = new DataView(out.buffer);
  v.setUint32(0, w * h, true);
  v.setUint32(4, w, true);
  v.setUint32(8, h, true);
  out.set(box(w, h), 12);
  out.set(palette(name), 12 + w * h);
  return out;
}

/** DEF frame sizes by name: [width, height, groups, frames per group, full width, full height]. */
function defShape(name: string): [number, number, number, number, number, number] {
  if (/^iam0/.test(name)) return [32, 32, 1, 4, 32, 32];
  if (/^icm0/.test(name)) return [48, 36, 1, 4, 48, 36];
  if (/^iokay|^icancel|^icn6432|^iok6432/.test(name)) return [64, 30, 1, 4, 64, 30];
  if (/^mmenu|^gt/.test(name)) return [150, 80, 1, 4, 150, 80];
  if (/^c[a-z0-9]{4,}\.def$/.test(name) && !/^cr|^cs|^cc/.test(name)) return [40, 60, 22, 6, 450, 400];
  if (/^ah|^af/.test(name)) return [64, 64, 10, 8, 96, 64];
  if (/^cprsmall|^twcrport/.test(name)) return [32, 32, 1, 200, 32, 32];
  if (/^cprlarge/.test(name)) return [58, 64, 1, 200, 58, 64];
  if (/^itpa/.test(name)) return [48, 32, 1, 40, 48, 32];
  if (/^itpt/.test(name)) return [58, 64, 1, 40, 58, 64];
  if (/^imobil|^imana/.test(name)) return [6, 32, 1, 26, 6, 32];
  if (/^crest58/.test(name)) return [58, 64, 1, 8, 58, 64];
  if (/^dialgbox/.test(name)) return [64, 64, 1, 8, 64, 64];
  if (name === "adag.def") return [32, 32, 1, 50, 32, 32];
  if (/^spells\.def/.test(name)) return [78, 65, 1, 90, 78, 65];
  if (/^splev/.test(name)) return [78, 65, 1, 4, 78, 65];
  if (/^imrl22|^ilck22/.test(name)) return [22, 22, 1, 7, 22, 22];
  return [32, 32, 4, 8, 32, 32];
}

export function def(name: string): Uint8Array {
  const [w, h, groups, frames, fw, fh] = defShape(name);
  const frameBytes = 32 + w * h;
  const blockBytes = 16 + frames * 17;
  const head = 16 + 768 + groups * blockBytes;
  const out = new Uint8Array(head + groups * frames * frameBytes);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x47, true);
  v.setUint32(4, fw, true);
  v.setUint32(8, fh, true);
  v.setUint32(12, groups, true);
  out.set(palette(name), 16);
  const px = box(w, h);
  // The route's arrows (ADAG): a small green dot for frames 0-24, red for 25-49, as the original's colours.
  const adag = name === "adag.def";
  const dot = (c: number) => px.map((_, k) => (Math.abs((k % w) - w / 2) < 5 && Math.abs(Math.floor(k / w) - h / 2) < 5 ? c : 0));
  if (adag) out.set([40, 200, 40, 220, 30, 30], 16 + 3 * 13); // slots 13 green, 14 red
  // Creatures stand on the hex centre (193, 251) of their 450x400 canvas.
  const fx = fw === 450 ? 193 - w / 2 : Math.round((fw - w) / 2);
  const fy = fw === 450 ? 251 - h : Math.round((fh - h) / 2);
  for (let g = 0; g < groups; g++) {
    const b = 16 + 768 + g * blockBytes;
    v.setUint32(b, g, true);
    v.setUint32(b + 4, frames, true);
    for (let i = 0; i < frames; i++) {
      const n = `f${g}_${i}`;
      // The spellbook's school frames: see-through, with corners growing with the mastery (frame).
      const px = /^splev/.test(name) ? levelFrame(w, h, i) : box(w, h);
      for (let k = 0; k < n.length; k++) out[b + 16 + i * 13 + k] = n.charCodeAt(k);
      const off = head + (g * frames + i) * frameBytes;
      v.setUint32(b + 16 + frames * 13 + i * 4, off, true);
      v.setUint32(off, w * h, true);
      v.setUint32(off + 4, 0, true);
      v.setUint32(off + 8, fw, true);
      v.setUint32(off + 12, fh, true);
      v.setUint32(off + 16, w, true);
      v.setUint32(off + 20, h, true);
      v.setInt32(off + 24, fx, true);
      v.setInt32(off + 28, fy, true);
      out.set(adag ? dot(i < 25 ? 13 : 14) : px, off + 32);
    }
  }
  return out;
}

/** A hollow frame with filled corners of 2 + 4 * level pixels. */
function levelFrame(w: number, h: number, level: number): Uint8Array {
  const px = new Uint8Array(w * h);
  const c = 2 + 4 * level;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      const corner = (x < c || x >= w - c) && (y < c || y >= h - c);
      if (edge || corner) px[y * w + x] = corner ? 11 : 10;
    }
  return px;
}

/** A bitmap font of solid bars: every glyph a block of ink, spaces empty. */
export function fnt(name: string): Uint8Array {
  const height = /tiny/.test(name) ? 7 : /smal/.test(name) ? 9 : /big/.test(name) ? 16 : 13;
  const width = Math.max(3, Math.round(height * 0.45));
  const glyph = new Uint8Array(width * height);
  for (let y = 2; y < height - 1; y++) for (let x = 0; x < width - 1; x++) glyph[y * width + x] = 255;
  const metricsAt = 32;
  const offsetsAt = metricsAt + 256 * 12;
  const pixelsAt = offsetsAt + 256 * 4;
  const out = new Uint8Array(pixelsAt + width * height);
  out[5] = height;
  const v = new DataView(out.buffer);
  for (let c = 0; c < 256; c++) {
    const space = c === 32;
    v.setInt32(metricsAt + c * 12, 0, true);
    v.setInt32(metricsAt + c * 12 + 4, space ? 0 : width, true);
    v.setInt32(metricsAt + c * 12 + 8, space ? width : 1, true);
    v.setUint32(offsetsAt + c * 4, 0, true);
  }
  out.set(glyph, pixelsAt);
  return out;
}

/**
 * OBJECTS.TXT: templates for what maps and the random map generator place, shaped like the
 * originals (a 5x3 town entered in the middle of its bottom row, 3x2 mines, 2x2 dwellings, one-tile
 * monsters and pickups, obstacles of several sizes). Masks are 6 rows of 8 from the anchor (the
 * bottom-right tile) leftwards and up; 1 = passable in the block mask, 1 = entrance in the visit mask.
 */
function objectsTxt(): string {
  const mask = (tiles: [number, number][], set: "0" | "1") => {
    const m = Array.from({ length: 48 }, () => (set === "0" ? "1" : "0"));
    for (const [dx, dy] of tiles) m[-dy * 8 - dx] = set;
    return m.join("");
  };
  const rect = (w: number, h: number) => Array.from({ length: w * h }, (_, i) => [-(i % w), -Math.floor(i / w)] as [number, number]);
  const land = "111111110";
  const rows: string[] = [];
  const add = (def: string, block: [number, number][], visit: [number, number][], id: number, subid: number, terrain = land) =>
    rows.push(`${def} ${mask(block, "0")} ${mask(visit, "1")} ${terrain} 000000000 ${id} ${subid} ${visit.length ? 1 : 0} 0`);
  const one: [number, number][] = [[0, 0]];
  add("ah00_.def", [], one, 34, 0);
  add("ahrandom.def", [], one, 70, 0);
  for (let f = 0; f < 9; f++) add(`avctown${f}.def`, rect(5, 3), [[-2, 0]], 98, f);
  add("avcrand0.def", rect(5, 3), [[-2, 0]], 77, 0);
  for (let r = 0; r < 7; r++) add(`avmine${r}.def`, rect(3, 2), [[-1, 0]], 53, r);
  for (let r = 0; r < 7; r++) add(`avtres${r}.def`, one, one, 79, r);
  add("avtrndm0.def", one, one, 76, 0);
  // (HotA's own creatures, as in its files, stand a tile left of their anchor.)
  for (let c = 0; c < 200; c++) add(`avwmon${c}.def`, c >= 151 ? [[-1, 0]] : one, c >= 151 ? [[-1, 0]] : one, 54, c);
  for (const id of [71, 72, 73, 74, 75, 162, 163, 164]) add(`avwrand${id}.def`, one, one, id, 0);
  for (let a = 0; a < 145; a++) add(`avart${a}.def`, one, one, 5, a);
  for (const id of [65, 66, 67, 68, 69]) add(`avarand${id}.def`, one, one, id, 0);
  add("avtchst0.def", one, one, 101, 0);
  add("avtcamp0.def", one, one, 12, 0);
  for (let d = 0; d < 90; d++) add(`avgdwel${d}.def`, rect(2, 2), [[-1, 0]], 17, d);
  add("avgrand0.def", rect(2, 2), [[-1, 0]], 216, 0);
  add("avxsubg0.def", rect(3, 2), [[-1, 0]], 103, 0, "111111111");
  // (The boat, as the original's, a tile left of its anchor.)
  add("ab01_.def", [[-1, 0]], [[-1, 0]], 8, 0, "000000001");
  // Places to visit: windmills, shrines, schools... (one tile, entered from below), and creature banks (3x2).
  for (const id of [4, 23, 30, 31, 32, 38, 39, 41, 47, 49, 51, 55, 58, 61, 64, 81, 88, 89, 90, 96, 97, 100, 102, 104, 107, 108, 109, 112, 113]) add(`avxsite${id}.def`, one, one, id, 0);
  for (const [id, sub] of [[16, 0], [16, 1], [16, 2], [16, 3], [16, 4], [16, 5], [16, 6], [25, 0], [84, 0], [63, 0]]) add(`avxbank${id}_${sub}.def`, rect(3, 2), [[-1, 0]], id, sub);
  // A map event (invisible, walked over), a Pandora's Box and a whirlpool (at sea).
  add("avzevnt0.def", [], one, 26, 0, "111111111");
  add("ava0128.def", one, one, 6, 0);
  add("avwhirl0.def", one, one, 111, 0, "000000001");
  // A garrison (stepped into through its gate).
  add("avcgar10.def", rect(3, 2), [[-1, 0]], 33, 0);
  // An obelisk (advanced starts' random maps put one in each zone).
  add("avxobel0.def", one, one, 57, 0);
  // Obstacles: never entered.
  add("avlrock0.def", one, [], 147, 0);
  add("avltree0.def", rect(2, 2), [], 135, 0);
  add("avlpine0.def", rect(3, 1), [], 137, 0);
  add("avlmntn0.def", rect(3, 2), [], 134, 0);
  add("avllake0.def", rect(4, 2), [], 126, 0);
  return [String(rows.length), ...rows].join("\r\n") + "\r\n";
}

/**
 * CRTRAITS.TXT with typical numbers for each creature's level (the town and level come from the
 * code's own creature list), upgrades a quarter stronger: costs, growth and fighting strength in
 * the original's ranges, so the AI's economy and fights in the sims mean something.
 */
function crtraitsTxt(): string {
  // Per level 1..7: gold, growth, hp, speed, attack, defense, min and max damage, AI value.
  const L = [
    [60, 14, 6, 5, 4, 4, 1, 3, 80],
    [150, 9, 15, 5, 6, 6, 2, 5, 250],
    [300, 7, 25, 6, 8, 8, 4, 7, 450],
    [500, 4, 35, 7, 10, 10, 6, 11, 800],
    [1000, 3, 60, 7, 12, 12, 10, 18, 1500],
    [1500, 2, 100, 9, 15, 15, 18, 25, 2500],
    [3000, 1, 200, 11, 20, 20, 30, 50, 6000],
  ];
  const rows = ["Singular\tPlural", "Singular\tPlural"];
  for (let id = 0; id < 200; id++) {
    const info = CREATURE_INFO[id];
    const level = Math.min(7, Math.max(1, info?.level || 2));
    const up = id < 112 && id % 2 === 1 ? 1.25 : 1;
    const [gold, growth, hp, speed, att, def, lo, hi, ai] = L[level - 1];
    const r = (v: number) => String(Math.round(v * up));
    // Level 7 creatures also want a rare resource (as dragons want sulfur).
    const cost = [0, level === 7 ? 1 : 0, 0, 0, 0, 0, Math.round(gold * up)];
    const shots = info?.abilities.some((a) => a.type === "SHOOTER") ? 12 : 0;
    rows.push([`Thing ${id}`, `Things ${id}`, ...cost.map(String), r(ai), r(ai), String(growth), String(Math.ceil(growth / 2)), r(hp), String(speed + (up > 1 ? 1 : 0)), r(att), r(def), r(lo), r(hi), String(shots), "0", "0", ...Array.from({ length: 10 }, () => "0")].join("\t"));
  }
  return rows.join("\r\n") + "\r\n";
}

/**
 * BUILDING.TXT laid out as the game's: each town's special buildings, the common buildings, then
 * each town's dwellings, with the original's kind of costs (wood, mercury, ore, sulfur, crystal,
 * gems, gold), so towns take weeks to build up in the sims as in the game.
 */
function buildingTxt(): string {
  const row = (c: number[]) => c.join("\t");
  const rows = ["Costs", "Costs"];
  for (let t = 0; t < 9; t++) {
    rows.push(...(t === 0 ? ["Town", "Specials"] : ["Specials"]));
    for (let b = 17; b <= 26; b++) rows.push(row([5, 0, 0, 0, 0, 0, 1500]));
    rows.push("");
  }
  rows.push("Common", "Common");
  // Mage guild 1-5, tavern, shipyard, fort, citadel, castle, village hall, town hall, city hall,
  // capitol, marketplace, resource silo, blacksmith.
  const common = [
    [5, 0, 5, 0, 0, 0, 2000], [5, 4, 5, 4, 4, 4, 1000], [5, 6, 5, 6, 6, 6, 1000], [5, 8, 5, 8, 8, 8, 1000], [5, 10, 5, 10, 10, 10, 1000],
    [5, 0, 0, 0, 0, 0, 500], [20, 0, 0, 0, 0, 0, 2000], [20, 0, 20, 0, 0, 0, 5000], [0, 0, 5, 0, 0, 0, 2500], [10, 0, 10, 0, 0, 0, 5000],
    [0, 0, 0, 0, 0, 0, 500], [0, 0, 0, 0, 0, 0, 2500], [0, 0, 0, 0, 0, 0, 5000], [0, 0, 0, 0, 0, 0, 10000], [5, 0, 0, 0, 0, 0, 500],
    [0, 0, 5, 0, 0, 0, 5000], [5, 0, 0, 0, 0, 0, 1000],
  ];
  for (const c of common) rows.push(row(c));
  rows.push("", "Dwellings");
  const gold = [500, 1000, 1500, 2000, 5000, 10000, 20000];
  for (let t = 0; t < 9; t++) {
    rows.push("Town", "Dwellings");
    for (let up = 0; up < 2; up++)
      for (let l = 0; l < 7; l++) {
        const rare = l >= 3 ? 5 + 2 * (l - 3) : 0;
        rows.push(row([5 + l, up ? rare : 0, 5 + l, l >= 5 ? rare : 0, l === 6 ? rare : 0, 0, Math.round(gold[l] * (up ? 1.5 : 1))]));
      }
  }
  return rows.join("\r\n") + "\r\n";
}

/** A text table: two header rows, then rows of a name and ones. */
export function txt(name: string): Uint8Array {
  if (name === "building.txt") return new TextEncoder().encode(buildingTxt());
  if (name === "objects.txt") return new TextEncoder().encode(objectsTxt());
  if (name === "crtraits.txt") return new TextEncoder().encode(crtraitsTxt());
  if (name === "sptraits.txt") return new TextEncoder().encode(sptraitsTxt());
  if (name === "rmg.txt") return new TextEncoder().encode(rmgTxt());
  // HOTRAITS.TXT: two heading rows, then each hero's name and three stacks' Low, High and creature (for reference).
  if (name === "hotraits.txt")
    return new TextEncoder().encode(["\t1st\t\t\t2nd\t\t\t3rd", "Name\tLow\tHigh\tType\tLow\tHigh\tType\tLow\tHigh\tType", ...Array.from({ length: 156 }, (_, i) => `Thing ${i}\t10\t20\tA\t4\t7\tB\t2\t4\tC`)].join("\r\n") + "\r\n");
  if (name === "rmgtemplates.txt") return new TextEncoder().encode(`@@@ Stand-in\n${rmgTxt()}`);
  const rows = ["Name\tPlural", "Name\tPlural"];
  const n = name === "crtraits.txt" ? 200 : 250;
  for (let i = 0; i < n; i++) rows.push([`Thing ${i}`, `Things ${i}`, ...Array.from({ length: 30 }, () => "1")].join("\t"));
  return new TextEncoder().encode(rows.join("\r\n") + "\r\n");
}

/**
 * Random map templates in RMG.TXT's layout (core rmgTemplates.ts reads it): two of the stand-in's
 * own, a duel for Small and Medium maps (with an underground) and a ring of four for Medium and
 * Large ones, with what the generator needs to try: towns, mines, terrain, monster strengths,
 * treasure tiers, connections of several values and a wide one.
 */
function rmgTxt(): string {
  const row = (cells: Partial<Record<number, string | number>>) => Array.from({ length: 85 }, (_, i) => String(cells[i] ?? "")).join("\t");
  const head = [row({ 0: "Map", 3: "Zone", 76: "Connections" }), row({ 4: "Type" }), row({ 0: "Name", 1: "Minimum Size", 2: "Maximum Size", 3: "Id" })];
  // A zone: id, type (h human, c computer, t treasure, j junction), size, owner, castles, neutral towns, mines (7), terrain bits (8), strength, treasure tiers.
  const zone = (id: number, type: string, size: number, owner: number, castles: number, neutral: number, mines: number[], ground: number, strength: string, tiers: number[][]) => {
    const c: Record<number, string | number> = { 3: id, [type === "h" ? 4 : type === "c" ? 5 : type === "j" ? 7 : 6]: "x", 8: size, 9: 1, 10: 8, 11: 2, 12: 8, 55: strength, 57: "x" };
    if (owner) c[13] = owner;
    if (castles) c[15] = castles;
    if (neutral) c[18] = neutral;
    for (let f = 0; f < 9; f++) c[23 + f] = "x";
    mines.forEach((n, r) => n && (c[32 + r] = n));
    if (ground) c[46] = "x";
    else for (let g = 0; g < 8; g++) if (g !== 6) c[47 + g] = "x";
    for (let f = 0; f < 10; f++) c[57 + f] = "x";
    tiers.forEach(([low, high, density], k) => ((c[67 + 3 * k] = low), (c[68 + 3 * k] = high), (c[69 + 3 * k] = density)));
    return c;
  };
  const link = (a: number, b: number, value: number, wide = false) => ({ 76: a, 77: b, 78: value, ...(wide ? { 79: "x" } : {}), 81: 1, 82: 8, 83: 2, 84: 8 });
  const template = (name: string, min: number, max: number, zones: Partial<Record<number, string | number>>[], links: Partial<Record<number, string | number>>[]) =>
    Array.from({ length: Math.max(zones.length, links.length) }, (_, i) => row({ ...(i === 0 ? { 0: name, 1: min, 2: max } : {}), ...zones[i], ...links[i] }));
  const home = [[3000, 6000, 4], [500, 3000, 9]];
  const rich = [[10000, 15000, 2], [3000, 6000, 6], [500, 3000, 6]];
  const duel = template(
    "Stand-in duel",
    1,
    8,
    [zone(1, "h", 12, 1, 1, 0, [1, 0, 1, 0, 0, 0, 0], 1, "weak", home), zone(2, "h", 12, 2, 1, 0, [1, 0, 1, 0, 0, 0, 0], 1, "weak", home), zone(3, "t", 10, 0, 0, 1, [0, 1, 0, 1, 0, 0, 1], 0, "avg", rich), zone(4, "t", 10, 0, 0, 0, [0, 0, 0, 0, 1, 1, 0], 0, "strong", rich)],
    [link(1, 3, 4500), link(2, 3, 4500), link(1, 4, 9000), link(2, 4, 9000), link(3, 4, 0, true)],
  );
  const ring = template(
    "Stand-in ring",
    4,
    18,
    [
      ...[1, 2, 3, 4].map((p) => zone(p, p === 1 ? "h" : "c", 14, p, 1, 0, [1, 0, 1, 0, 0, 0, 0], 1, "avg", home)),
      ...[5, 6, 7, 8].map((z) => zone(z, "t", 10, 0, 0, z % 2, [0, 1, 0, 1, 1, 1, 0], 0, "avg", rich)),
      zone(9, "j", 16, 0, 0, 1, [0, 0, 0, 0, 0, 0, 2], 0, "strong", [[15000, 25000, 2], ...rich.slice(1)]),
    ],
    [...[1, 2, 3, 4].flatMap((p) => [link(p, 4 + p, 3000), link(p, p === 1 ? 8 : 3 + p, 3000)]), ...[5, 6, 7, 8].map((z) => link(z, 9, 12000))],
  );
  return [...head, row({}), ...duel, ...ring].join("\r\n") + "\r\n";
}

/** Spells of levels 1-5 in turn, each of one school in turn (Magic Arrow, 15, of all four), so the
 * spellbook's school pages and frames have something to show. */
function sptraitsTxt(): string {
  const rows = ["Name\tShort", "Name\tShort"];
  for (let i = 0; i < 81; i++) {
    const schools = Array.from({ length: 4 }, (_, k) => (i === 15 || i % 4 === k ? "x" : ""));
    rows.push([`Spell ${i}`, `Sp${i}`, String(1 + (i % 5)), ...schools, ...Array.from({ length: 26 }, () => "1")].join("\t"));
  }
  return rows.join("\r\n") + "\r\n";
}

/** A 36x36 grass map (RoE format): red and blue, each with a hero and a castle, and between
 * them monsters, gold, a sawmill and a dwelling. */
export function testMap(): Uint8Array {
  const b: number[] = [];
  const u8 = (v: number) => b.push(v & 255);
  const u16 = (v: number) => (u8(v), u8(v >> 8));
  const u32 = (v: number) => (u16(v), u16(v >>> 16));
  const str = (s: string) => (u32(s.length), [...s].forEach((c) => u8(c.charCodeAt(0))));
  const size = 36;
  u32(0x0e);
  u8(1);
  u32(size);
  u8(0);
  str("Layout Test");
  str("A small grass map for layout screenshots.");
  u8(1);
  for (let p = 0; p < 8; p++) {
    if (p > 1) {
      u8(0), u8(0);
      for (let k = 0; k < 6; k++) u8(0);
      continue;
    }
    u8(1), u8(1); // human, computer
    u8(0); // tactic
    u8(0xff); // factions
    u8(0); // random faction
    u8(0); // no main town
    u8(0); // random hero
    u8(0xff); // no main hero
  }
  u8(0xff); // victory: standard
  u8(0xff); // loss: standard
  u8(0); // teams
  for (let i = 0; i < 16; i++) u8(0xff); // allowed heroes
  for (let i = 0; i < 31; i++) u8(0); // options
  u32(0); // rumours
  for (let i = 0; i < size * size; i++) [2, i % 20, 0, 0, 0, 0, 0].forEach(u8);
  // Templates: a hero, a castle (blocked 5x3, entered from the middle of its bottom row), then
  // one-tile objects entered from beside them: a monster, a gold pile, a sawmill, a dwelling.
  const small: [string, number, number][] = [["AVWarch.def", 54, 2], ["AVTgold0.def", 79, 6], ["AVMsawd0.def", 53, 0], ["AVGgnll0.def", 17, 0]];
  u32(2 + small.length);
  str("AH00_.def");
  for (let i = 0; i < 6; i++) u8(i === 5 ? 0x7f : 0xff);
  for (let i = 0; i < 6; i++) u8(i === 5 ? 0x80 : 0);
  u16(0xff), u16(0xff);
  u32(34), u32(0), u8(1), u8(0);
  for (let i = 0; i < 16; i++) u8(0);
  str("AVCcasx0.def");
  for (let i = 0; i < 6; i++) u8(i >= 3 ? 0x83 : 0xff);
  for (let i = 0; i < 6; i++) u8(i === 5 ? 0x20 : 0);
  u16(0xff), u16(0xff);
  u32(98), u32(0), u8(3), u8(0);
  for (let i = 0; i < 16; i++) u8(0);
  for (const [def, id, subid] of small) {
    str(def);
    for (let i = 0; i < 6; i++) u8(i === 5 ? 0x7f : 0xff);
    for (let i = 0; i < 6; i++) u8(i === 5 ? 0x80 : 0);
    u16(0xff), u16(0xff);
    u32(id), u32(subid), u8(id === 54 ? 1 : 2), u8(0);
    for (let i = 0; i < 16; i++) u8(0);
  }
  // Objects: [x, y, template]: three monsters, three gold piles, a sawmill, a dwelling.
  const placed: [number, number, number][] = [[12, 14, 2], [20, 18, 2], [24, 10, 2], [10, 12, 3], [22, 24, 3], [18, 8, 3], [6, 20, 4], [30, 12, 5]];
  u32(4 + placed.length);
  for (const [x, y, owner, hero] of [[13, 10, 0, 0], [27, 27, 1, 9]]) {
    u8(x), u8(y), u8(0);
    u32(0);
    for (let i = 0; i < 5; i++) u8(0);
    u8(owner);
    u8(hero);
    u8(0); // no name
    u32(0); // experience
    u8(0); // portrait
    u8(0); // skills
    u8(0); // army
    u8(0); // formation
    u8(0); // artifacts
    u8(0xff); // patrol
    for (let i = 0; i < 16; i++) u8(0);
  }
  // A castle each: mage guild, tavern, fort, village hall, marketplace.
  for (const [x, y, owner] of [[14, 10, 0], [27, 22, 1]]) {
    u8(x), u8(y), u8(0);
    u32(1);
    for (let i = 0; i < 5; i++) u8(0);
    u8(owner);
    u8(0); // name
    u8(0); // army
    u8(0); // formation
    u8(1); // custom buildings
    const built = [0, 5, 7, 10, 14];
    for (let i = 0; i < 6; i++) u8(built.filter((b) => b >> 3 === i).reduce((m, b) => m | (1 << (b & 7)), 0));
    for (let i = 0; i < 6; i++) u8(0);
    for (let i = 0; i < 9; i++) u8(0); // spells
    u32(0); // events
    u8(0), u8(0), u8(0);
  }
  for (const [x, y, t] of placed) {
    u8(x), u8(y), u8(0);
    u32(t);
    for (let i = 0; i < 5; i++) u8(0);
    const id = small[t - 2][1];
    if (id === 54) (u16(8), u8(1), u8(0), u8(0), u8(0), u8(0), u8(0)); // 8 of them, compliant, no message
    else if (id === 79) (u8(0), u32(5), u32(0)); // 500 gold (stored in hundreds), unguarded
    else u32(0xffffffff); // nobody's
  }
  u32(0); // events
  return gzipSync(Uint8Array.from(b));
}

/** What a request for a game file gets: the stand-in, or null (a 404, e.g. sounds and music). */
export function fakeRes(name: string): Uint8Array | null {
  name = name.toLowerCase();
  if (name.endsWith(".pcx") || name.endsWith(".bmp")) return name.endsWith(".pcx") ? pcx(name) : null;
  if (name.endsWith(".def")) return def(name);
  if (name.endsWith(".fnt")) return fnt(name);
  if (name.endsWith(".txt")) return txt(name);
  if (name.endsWith(".pal")) return new Uint8Array(1024).map((_, i) => (i * 37) & 255);
  return null;
}
