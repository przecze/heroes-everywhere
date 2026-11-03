// Campaign files (.h3c): a header gzip member and one gzipped .h3m per scenario. Layout after
// VCMI's CampaignHandler (RoE = 4, AB = 5, SoD = 6, HotA = 10).
import { gunzipMembers } from "./inflate.ts";

export interface CampaignPrologue {
  video: number;
  music: number;
  text: string;
}

export type CampaignBonus =
  | { type: "spell"; hero: number; spell: number }
  | { type: "creatures"; hero: number; creature: number; amount: number }
  | { type: "building"; building: number }
  | { type: "artifact"; hero: number; artifact: number }
  | { type: "scroll"; hero: number; spell: number }
  | { type: "primary"; hero: number; amounts: number[] }
  | { type: "secondary"; hero: number; skill: number; mastery: number }
  | { type: "resource"; resource: number; amount: number }
  | { type: "previousHeroes"; player: number; scenario: number }
  | { type: "hero"; player: number; hero: number };

export interface CampaignScenario {
  mapName: string;
  /** Scenarios (indices) that must be won first. */
  requires: number[];
  regionColor: number;
  difficulty: number;
  regionText: string;
  prologue?: CampaignPrologue;
  epilogue?: CampaignPrologue;
  /** What carries over to the next scenario. */
  keeps: { experience: boolean; primary: boolean; secondary: boolean; spells: boolean; artifacts: boolean };
  keptCreatures: number[];
  keptArtifacts: number[];
  startOptions: "none" | "bonus" | "crossover" | "heroes";
  /** The player choosing (for start bonuses). */
  player?: number;
  bonuses: CampaignBonus[];
}

export interface Campaign {
  version: number;
  /** Index into the campaign regions table (VCMI's campaignRegions.json order). */
  region: number;
  name: string;
  description: string;
  difficultyChosenByPlayer: boolean;
  music: number;
  scenarios: CampaignScenario[];
  /** Decompressed .h3m for each scenario (undefined for unused region slots). */
  maps: (Uint8Array | undefined)[];
}

class Reader {
  pos = 0;
  readonly v: DataView;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8() {
    return this.v.getUint8(this.pos++);
  }
  u16() {
    const x = this.v.getUint16(this.pos, true);
    this.pos += 2;
    return x;
  }
  i16() {
    const x = this.v.getInt16(this.pos, true);
    this.pos += 2;
    return x;
  }
  u32() {
    const x = this.v.getUint32(this.pos, true);
    this.pos += 4;
    return x;
  }
  i32() {
    const x = this.v.getInt32(this.pos, true);
    this.pos += 4;
    return x;
  }
  str() {
    const n = this.u32();
    const s = new TextDecoder("latin1").decode(this.b.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
  bits(bytes: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < bytes * 8; i++) {
      const byte = this.b[this.pos + (i >> 3)];
      if (byte & (1 << (i & 7))) out.push(i);
    }
    this.pos += bytes;
    return out;
  }
}

/** Number of scenarios per region index for the original formats (they don't store it). */
export type RegionCounts = (region: number) => number;

export function parseH3c(bytes: Uint8Array, regionCount: RegionCounts): Campaign {
  const [header, ...maps] = gunzipMembers(bytes);
  const r = new Reader(header);
  const version = r.u32();
  let count = 0;
  let format = 0;
  if (version === 10) {
    // Format 2 (HotA 1.7.3) and later carry the HotA version (major, minor, patch) and a flag.
    format = r.i32();
    if (format >= 2) {
      r.u32();
      r.u32();
      r.u32();
      r.u8();
    }
    r.u8();
    r.i32();
    count = r.i32();
  }
  const region = r.u8();
  if (version !== 10) count = regionCount(region);
  const name = r.str();
  const description = r.str();
  const difficultyChosenByPlayer = version > 4 ? r.u8() !== 0 : false;
  const music = r.u8();
  const scenarios: CampaignScenario[] = [];
  for (let i = 0; i < count; i++) scenarios.push(readScenario(r, version, count, format));
  // Region slots without a map (decorations on some campaign maps) get no map either.
  let next = 0;
  const byScenario = scenarios.map((sc) => (sc.mapName ? maps[next++] : undefined));
  return { version, region, name, description, difficultyChosenByPlayer, music, scenarios, maps: byScenario };
}

function prologue(r: Reader): CampaignPrologue | undefined {
  if (!r.u8()) return undefined;
  return { video: r.u8(), music: r.u8(), text: r.str() };
}

function readScenario(r: Reader, version: number, count: number, format: number): CampaignScenario {
  const mapName = r.str();
  r.u32(); // packed map size
  const mask = count > 8 ? r.u16() : r.u8();
  const requires: number[] = [];
  for (let i = 0; i < 16; i++) if (mask & (1 << i)) requires.push(i);
  const regionColor = r.u8();
  const difficulty = r.u8();
  const regionText = r.str();
  const pro = prologue(r);
  if (version === 10) (prologue(r), prologue(r));
  const epi = prologue(r);
  if (version === 10) (prologue(r), prologue(r));
  const keepsByte = r.u8();
  const keeps = { experience: !!(keepsByte & 1), primary: !!(keepsByte & 2), secondary: !!(keepsByte & 4), spells: !!(keepsByte & 8), artifacts: !!(keepsByte & 16) };
  // HotA 1.8 (format 3) has more creatures and artifacts than 1.7.
  const keptCreatures = r.bits(version === 10 ? (format >= 3 ? 29 : 24) : 19);
  const keptArtifacts = r.bits(version === 10 ? (format >= 3 ? 25 : 21) : version < 6 ? 17 : 18);
  const startByte = r.u8();
  const startOptions = (["none", "bonus", "crossover", "heroes"] as const)[startByte] ?? "none";
  const player = startOptions === "bonus" ? r.u8() : undefined;
  const bonuses: CampaignBonus[] = [];
  if (startOptions !== "none") {
    const n = r.u8();
    for (let i = 0; i < n; i++) bonuses.push(readBonus(r, startOptions));
  }
  return { mapName, requires, regionColor, difficulty, regionText, prologue: pro, epilogue: epi, keeps, keptCreatures, keptArtifacts, startOptions, player, bonuses };
}

function readBonus(r: Reader, mode: "bonus" | "crossover" | "heroes"): CampaignBonus {
  if (mode === "crossover") return { type: "previousHeroes", player: r.u8(), scenario: r.u8() };
  if (mode === "heroes") return { type: "hero", player: r.u8(), hero: r.i16() };
  const t = r.u8();
  switch (t) {
    case 0:
      return { type: "spell", hero: r.i16(), spell: r.u8() };
    case 1:
      return { type: "creatures", hero: r.i16(), creature: r.u16(), amount: r.u16() };
    case 2:
      return { type: "building", building: r.u8() };
    case 3:
      return { type: "artifact", hero: r.i16(), artifact: r.u16() };
    case 4:
      return { type: "scroll", hero: r.i16(), spell: r.u8() };
    case 5: {
      const hero = r.i16();
      return { type: "primary", hero, amounts: [r.u8(), r.u8(), r.u8(), r.u8()] };
    }
    case 6:
      return { type: "secondary", hero: r.i16(), skill: r.u8(), mastery: r.u8() };
    case 7: {
      const resource = r.u8();
      return { type: "resource", resource, amount: r.i32() };
    }
  }
  throw new Error(`unknown campaign bonus ${t}`);
}
