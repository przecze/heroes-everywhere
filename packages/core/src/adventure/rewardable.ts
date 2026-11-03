// Configurable map objects (VCMI's "rewardable" objects, as the HotA mod describes them): a list
// of possible rewards, which ones apply (rolled per object, limited by what the hero has), and how
// often they can be visited. Data in rewardableData.ts.
import { withLearning } from "../specialty.ts";
import { MOD_TEXTS } from "../modTexts.ts";
import { spellAllowed } from "./bans.ts";
import { REWARDABLE } from "../rewardableData.ts";
import { randInt } from "../rng.ts";
import { RESOURCE_NAMES } from "./types.ts";
import { maxMana } from "./magic.ts";
import { skillLevel } from "../skills.ts";
import type { AdventureState, AdvObject, Component, Hero } from "./types.ts";
import type { World } from "./world.ts";
import type { HotaPreset } from "@heroes/formats";
import { Refusal } from "../refusal.ts";
import { lineText } from "../gameLines.ts";

type Amount = number | string;

export interface Reward {
  /** Applies when the object's roll (0-99) falls in [min, max). */
  chance?: [number, number];
  /** The mod's "mapDice": which content a map's editor can pick (not a roll of its own; see applicable). */
  dice?: number;
  message?: string;
  /** Only for heroes whose player has these resources (paid with negative `resources`). */
  needs?: { res: Amount; amount: Amount }[];
  /** Only if the hero can learn the spell(s) given. */
  needsSpell?: boolean;
  resources?: { res: Amount; amount: Amount }[];
  guards?: [number, number][];
  /** Creature and count (either may be a variable: the Trapper Lodge's random Kobolds or Gremlins). */
  creatures?: [Amount, Amount][];
  /** The hero is asked before this reward (the object's other rewards are just given). */
  ask?: boolean;
  artifacts?: (string | number)[];
  spells?: (string | number)[];
  primary?: number[];
  manaPoints?: number;
  /** The percent of the points past the maximum that are still given. */
  manaOverflowFactor?: number;
  /** Movement left afterwards, in percent of the maximum. */
  movePercentage?: number;
  bonuses?: { type: string; subtype?: string; val: number; duration: string; turns?: number }[];
  removeObject?: boolean;
  experience?: number;
  /** Movement points added for today. */
  movePoints?: number;
  /** Luck until the next battle. */
  luck?: number;
  /** Morale until the next battle. */
  morale?: number;
  /** Only with the day's movement untouched (the Grave: digging takes a whole day). */
  needsFullMove?: boolean;
  /** One random secondary skill a level up (Basic to Advanced, Advanced to Expert). */
  upgradeSkill?: boolean;
  /** Only on days up to / from this one (the Derrick pays half in the first week). */
  dayMax?: number;
}

export interface RewardableDef {
  name: string;
  bank?: boolean;
  /** once: the first visitor only; hero: once per hero; player: once per player; bonus: while its bonus lasts; limiter: until the hero has what it gives; battle: again after a battle. */
  visitMode: "once" | "hero" | "player" | "bonus" | "limiter" | "unlimited" | "battle";
  /** selectFirst: the first reward that applies; selectRandom: a random one; selectPlayer: the player picks. */
  selectMode: "selectFirst" | "selectRandom" | "selectPlayer";
  /** Visits are forgotten every this many days (warehouses: weekly). */
  resetDays?: number;
  /** The hero is asked first. */
  canRefuse?: boolean;
  removable?: boolean;
  onVisited?: string;
  onSelect?: string;
  onEmpty?: string;
  /** Rolled once per object; a number from min..max or anyOf, a resource or a creature (by key) from anyOf, a spell of a level. */
  variables?: Record<string, { kind: string; anyOf?: (string | number)[]; min?: number; max?: number; level?: number }>;
  rewards: Reward[];
}

/** What a rewardable object remembers (kept in o.data). */
interface RewardState {
  dice: number[];
  vars: Record<string, number>;
  heroes: number[];
  players: number[];
  epoch?: number;
}

export interface RewardCtx {
  addToArmy(h: Hero, creature: number, count: number): boolean;
  randomArtifact(cls: string): number;
  giveArtifact(h: Hero, id: number): string;
  gainExperience(h: Hero, xp: number): string[];
  skillName(id: number): string;
}

export type RewardEvent = { e: "visit"; hero: number; object: number; message: string; components?: Component[] } | { e: "offer"; hero: number; object: number; kind: "ask"; cost: number; text: string };

/** HotA objects the mod doesn't describe, after the HotA wiki (heroes.thelazy.net); their words from the mod's english.json. */
const HOTA_OBJECTS: Record<string, RewardableDef> = {
  "144:6": {
    name: "Gazebo",
    visitMode: "hero",
    selectMode: "selectFirst",
    canRefuse: true,
    onVisited: MOD_TEXTS["mapObject.hota.highlandsterrain.gazebo.gazebo.onVisited"],
    onEmpty: MOD_TEXTS["mapObject.hota.highlandsterrain.gazebo.gazebo.onEmpty"],
    rewards: [{ needs: [{ res: 6, amount: 1000 }], resources: [{ res: 6, amount: -1000 }], experience: 2000, message: MOD_TEXTS["mapObject.hota.highlandsterrain.gazebo.gazebo.rewards.0"] }],
  },
  // HotA 1.7's Trapper Lodge (snow; heroes.thelazy.net): once, 300 / 400 / 500 gold, or 3-5 Kobolds or Gremlins who join if the hero takes them along.
  "144:12": {
    name: "Trapper Lodge",
    visitMode: "once",
    selectMode: "selectFirst",
    onVisited: MOD_TEXTS["mapObject.hota.bulwark.trapperLodge.trapperLodge.onVisited"],
    variables: {
      "@gainedCreature": { kind: "creature", anyOf: ["kobold", "gremlin"] },
      "@gainedGoldAmount": { kind: "number", anyOf: [300, 400, 500] },
      "@gainedCreatureAmount": { kind: "number", min: 3, max: 5 },
    },
    rewards: [
      { chance: [0, 50], dice: 0, resources: [{ res: 6, amount: "@gainedGoldAmount" }], message: MOD_TEXTS["mapObject.hota.bulwark.trapperLodge.trapperLodge.rewards.0"] },
      { chance: [50, 100], dice: 1, ask: true, creatures: [["@gainedCreature", "@gainedCreatureAmount"]], message: MOD_TEXTS["mapObject.hota.bulwark.trapperLodge.trapperLodge.rewards.1"] },
    ],
  },
  "144:10": {
    name: "Prospector",
    visitMode: "once",
    resetDays: 7,
    selectMode: "selectRandom",
    onVisited: MOD_TEXTS["mapObject.hota.wastelandterrain.prospector.prospector.onVisited"],
    rewards: [
      { resources: [{ res: 6, amount: 500 }], message: MOD_TEXTS["mapObject.hota.wastelandterrain.prospector.prospector.rewards.0"] },
      { resources: [{ res: 3, amount: 5 }], message: MOD_TEXTS["mapObject.hota.wastelandterrain.prospector.prospector.rewards.0"] },
    ],
  },
  "144:8": {
    name: "Derrick",
    visitMode: "once",
    resetDays: 7,
    selectMode: "selectFirst",
    onVisited: MOD_TEXTS["mapObject.hota.wastelandterrain.derrick.derrick.onVisited"],
    rewards: [
      { dayMax: 7, resources: [{ res: 6, amount: 500 }], message: MOD_TEXTS["mapObject.hota.wastelandterrain.derrick.derrick.rewards.0"] },
      { resources: [{ res: 6, amount: 1000 }], message: MOD_TEXTS["mapObject.hota.wastelandterrain.derrick.derrick.rewards.0"] },
    ],
  },
  "144:4": {
    name: "Mineral Spring",
    visitMode: "battle",
    selectMode: "selectFirst",
    onVisited: MOD_TEXTS["mapObject.hota.highlandsterrain.mineralSpring.mineralSpring.onVisited"],
    rewards: [{ movePoints: 600, luck: 1, message: MOD_TEXTS["mapObject.hota.highlandsterrain.mineralSpring.mineralSpring.rewards.0"] }],
  },
  "144:5": {
    name: "Hermit's Shack",
    visitMode: "hero",
    selectMode: "selectFirst",
    onVisited: MOD_TEXTS["mapObject.hota.highlandsterrain.hermitsShack.hermitsShack.onVisited"],
    onEmpty: MOD_TEXTS["mapObject.hota.highlandsterrain.hermitsShack.hermitsShack.onEmpty.1"],
    rewards: [{ upgradeSkill: true, message: MOD_TEXTS["mapObject.hota.highlandsterrain.hermitsShack.hermitsShack.rewards.0"] }],
  },
  "144:11": {
    name: "Trailblazer",
    visitMode: "bonus",
    selectMode: "selectFirst",
    onVisited: MOD_TEXTS["mapObject.hota.wastelandterrain.trailblazer.trailblazer.onVisited"],
    rewards: [{ bonuses: [{ type: "WASTELAND_GUIDE", val: 1, duration: "ONE_WEEK" }], message: MOD_TEXTS["mapObject.hota.wastelandterrain.trailblazer.trailblazer.rewards.0"] }],
  },
  "212:1001": {
    name: "Grave",
    visitMode: "once",
    selectMode: "selectFirst",
    removable: true,
    onEmpty: MOD_TEXTS["mapObject.hota.wastelandterrain.grave.grave.onEmpty"],
    variables: { "@gainedAmount": { kind: "number", anyOf: [1500, 2000, 2500, 3000, 3500, 4000] } },
    rewards: [{ needsFullMove: true, resources: [{ res: 6, amount: "@gainedAmount" }], artifacts: ["TREASURE|MINOR"], morale: -3, movePercentage: 0, removeObject: true, message: MOD_TEXTS["mapObject.hota.wastelandterrain.grave.grave.rewards.0"] }],
  },
  "144:0": {
    name: "Temple of Loyalty",
    visitMode: "bonus",
    selectMode: "selectFirst",
    onVisited: "{Temple of Loyalty}\n\nYour troops are already united.",
    rewards: [{ bonuses: [{ type: "NO_ALIGNMENT_PENALTY", val: 1, duration: "ONE_DAY" }], message: "{Temple of Loyalty}\n\nYour troops swear loyalty to one another: no morale penalty for mixed armies until tomorrow." }],
  },
};

export const rewardableDef = (o: AdvObject): RewardableDef | undefined => REWARDABLE[`${o.type}:${o.subid}`] ?? HOTA_OBJECTS[`${o.type}:${o.subid}`];

/** What the map's author chose for this object (HotA 1.7's object contents), if anything. */
export function presetOf(w: World, o: AdvObject): HotaPreset | undefined {
  const here = w.mapObjectsAt(o.x, o.y, o.z);
  const p = (here.find((m) => m.id === o.type) ?? here[0])?.data as { preset?: HotaPreset } | undefined;
  return p?.preset && p.preset.content >= 0 ? p.preset : undefined;
}

const PRIMARY = ["Attack", "Defense", "Power", "Knowledge"];

function stateOf(s: AdventureState, w: World, o: AdvObject, def: RewardableDef): RewardState {
  const d = (o.data ??= {}) as Record<string, unknown>;
  if (!d.reward) {
    // Rolled once per object: the dice and the variables (which resource, which artifact...).
    const vars: Record<string, number> = {};
    for (const [name, v] of Object.entries(def.variables ?? {})) {
      if (v.kind === "number" && v.anyOf?.length) vars[name] = v.anyOf[randInt(s, 0, v.anyOf.length - 1)] as number;
      else if (v.kind === "number") vars[name] = randInt(s, v.min ?? 0, v.max ?? v.min ?? 0);
      else if (v.kind === "creature" && v.anyOf?.length) {
        const key = v.anyOf[randInt(s, 0, v.anyOf.length - 1)];
        vars[name] = typeof key === "number" ? key : w.creatures.findIndex((c) => c?.key === key);
      }
      else if (v.kind === "resource" && v.anyOf?.length) vars[name] = v.anyOf[randInt(s, 0, v.anyOf.length - 1)] as number;
      else if (v.kind === "spell") {
        const pool = (w.data.spells ?? []).filter((sp) => sp.id < 70 && (v.level === undefined || sp.level === v.level) && spellAllowed(s, sp.id));
        if (pool.length) vars[name] = pool[randInt(s, 0, pool.length - 1)].id;
      }
    }
    // What the map's author chose (HotA 1.7): the Sea Barrel's resource, the Trapper Lodge's gold or creatures, the Grave's gold.
    const preset = presetOf(w, o);
    if (preset) {
      const set = (name: string, v: number | undefined) => {
        if (v !== undefined && v >= 0 && def.variables?.[name]) vars[name] = v;
      };
      set("@gainedResource", preset.res);
      set("@gainedAmount", preset.amount);
      set("@gainedGoldAmount", preset.amount);
      set("@gainedCreatureAmount", preset.creatureAmount);
      set("@gainedCreature", preset.creature);
    }
    d.reward = { dice: [0, 1, 2, 3].map(() => randInt(s, 0, 99)), vars, heroes: [], players: [] } satisfies RewardState;
  }
  const st = d.reward as RewardState;
  if (def.resetDays) {
    const epoch = Math.floor((s.day - 1) / def.resetDays);
    if (st.epoch !== epoch) {
      st.epoch = epoch;
      st.heroes = [];
      st.players = [];
    }
  }
  return st;
}

const value = (st: RewardState, a: Amount) => (typeof a === "string" ? (st.vars[a] ?? 0) : a);

function canLearn(h: Hero, spell: number, level: number): boolean {
  return !!h.spells && !h.spells.includes(spell) && 2 + skillLevel(h.skills, "wisdom") >= level;
}

/** The rewards that apply for this hero now. */
function applicable(s: AdventureState, w: World, h: Hero, o: AdvObject, def: RewardableDef, st: RewardState): number[] {
  const out: number[] = [];
  const preset = presetOf(w, o);
  const chosen = preset && def.rewards.some((r) => r.dice !== undefined) ? preset.content : undefined;
  def.rewards.forEach((r, i) => {
    if (chosen !== undefined) {
      // The map's author chose this content (HotA 1.7's "mapDice"): no roll.
      if (r.dice !== chosen) return;
    } else if (r.chance) {
      // One roll picks among the bands: the mod's "mapDice" (r.dice) is the map's own choice of
      // content (HotA's editor), not a separate roll; with one roll each, a Jetsam or a Vial of
      // Mana could hold nothing at all.
      const roll = st.dice[0] ?? 0;
      if (roll < r.chance[0] || roll >= r.chance[1]) return;
    }
    if (r.needs?.some((n) => s.players[h.owner].resources[value(st, n.res)] < value(st, n.amount))) return;
    // The Ancient Lamp's genies: no more than the map put in it.
    if (preset?.content === 0 && preset.amount !== undefined && o.type === 145 && o.subid === 0 && (r.creatures ?? []).some(([, n]) => value(st, n) > preset.amount!)) return;
    if (r.dayMax !== undefined && s.day > r.dayMax) return;
    if (r.needsFullMove && h.movement < (h.maxMovement ?? 0)) return;
    if (r.upgradeSkill && !(h.skills ?? []).some(([, l]) => l < 3)) return;
    if (r.needsSpell) {
      const ids = (r.spells ?? []).map((x) => value(st, x));
      if (!ids.every((id) => canLearn(h, id, w.data.spells?.find((sp) => sp.id === id)?.level ?? 1))) return;
    }
    out.push(i);
  });
  return out;
}

function visited(h: Hero, o: AdvObject, def: RewardableDef, st: RewardState): boolean {
  switch (def.visitMode) {
    case "once":
      return st.heroes.length > 0;
    case "hero":
      return st.heroes.includes(h.type);
    case "player":
      return st.players.includes(h.owner);
    case "bonus":
      return (h.timed ?? []).some((b) => b.object === o.id);
    case "battle":
      return !!h.temp?.from.includes(o.id);
    case "limiter":
      return (def.rewards[0]?.spells ?? []).every((x) => h.spells?.includes(value(st, x)));
    default:
      return false;
  }
}

/**
 * Whether player `player` (with `hero` selected) has had this configurable object's reward, as its hover mark says
 * (VCMI's CRewardableObject::getHoverText "(Visited)" / "(Not visited)"); undefined when it takes no mark (it can
 * always be visited, or it is a hero's own and no hero is selected). Weekly ones (warehouses) count this week only.
 */
export function rewardVisited(day: number, o: AdvObject, player: number, hero?: Hero): boolean | undefined {
  const def = rewardableDef(o);
  if (!def || def.bank) return undefined;
  const st = (o.data as { reward?: RewardState } | undefined)?.reward;
  const fresh = !st || (def.resetDays !== undefined && st.epoch !== Math.floor((day - 1) / def.resetDays));
  switch (def.visitMode) {
    case "once":
    case "player":
      return !fresh && st!.players.includes(player);
    case "hero":
      return hero ? !fresh && st!.heroes.includes(hero.type) : undefined;
    default:
      return undefined;
  }
}

/** Fills in "%s" (the spell or artifact the object holds) in a message. */
function fill(w: World, def: RewardableDef, st: RewardState, text: string): string {
  const spell = Object.entries(def.variables ?? {}).find(([, v]) => v.kind === "spell");
  const name = spell ? (w.data.spells?.find((sp) => sp.id === st.vars[spell[0]])?.name ?? "") : "";
  return text.replace("%s", name);
}

/** Visiting a configurable object: a message, an offer to answer, or nothing (not configurable). */
export function visitRewardable(s: AdventureState, w: World, ctx: RewardCtx, h: Hero, o: AdvObject): RewardEvent[] | null {
  const def = rewardableDef(o);
  if (!def || def.bank) return null;
  const st = stateOf(s, w, o, def);
  const say = (text: string): RewardEvent[] => [{ e: "visit", hero: h.id, object: o.id, message: fill(w, def, st, text) }];
  if (visited(h, o, def, st)) return say(def.onVisited ?? `You have already visited the ${def.name}.`);
  const options = applicable(s, w, h, o, def, st);
  if (!options.length) {
    // A shrine's spell (VCMI's onEmpty with limiters, which the data leaves out): no book, or not wise enough for its level.
    const shrine = def.rewards[0]?.needsSpell ? def.rewards[0].message : undefined;
    if (shrine && !h.spells) return say(`${shrine}${lineText({ file: "advevent", id: 131 })}`);
    if (shrine && !visited(h, o, def, st)) return say(`${shrine}${lineText({ file: "advevent", id: 130 })}`);
    return say(def.onEmpty ?? def.onVisited ?? `The ${def.name} has nothing for you.`);
  }
  const chosen = def.selectMode === "selectRandom" ? options[randInt(s, 0, options.length - 1)] : options[0];
  if ((def.canRefuse || def.rewards[chosen].ask || def.selectMode === "selectPlayer") && s.players[h.owner]?.controller === "human") {
    // The player decides (for "pick one" objects: the first one; the rest come with a dialog later).
    h.offer = { object: o.id, kind: "ask", cost: chosen };
    const pics = rewardPictures(def.rewards[chosen], st, h);
    return [{ e: "offer", hero: h.id, object: o.id, kind: "ask", cost: chosen, text: fill(w, def, st, def.onSelect ?? def.rewards[chosen].message ?? def.name), ...(pics.length ? { components: pics } : {}) }];
  }
  return grantReward(s, w, ctx, h, o, chosen);
}

/** What a reward would give, pictured for its question (the Trapper Lodge's creatures...): what's known before it's taken. */
function rewardPictures(r: RewardableDef["rewards"][number], st: RewardState, h?: Hero): Component[] {
  const pics: Component[] = [];
  for (const x of r.resources ?? []) if (value(st, x.amount) > 0) pics.push({ kind: "resource", id: value(st, x.res), amount: value(st, x.amount) });
  for (const [c, n] of r.creatures ?? []) pics.push({ kind: "creature", id: value(st, c), amount: value(st, n) });
  for (const a of r.artifacts ?? []) {
    const id = typeof a === "number" ? a : a.startsWith("@") ? st.vars[a] : undefined;
    if (id !== undefined && id >= 0) pics.push({ kind: "artifact", id });
  }
  for (const x of r.spells ?? []) pics.push({ kind: "spell", id: value(st, x) });
  r.primary?.forEach((n, i) => n && pics.push({ kind: "primary", id: i, amount: n }));
  if (r.manaPoints) pics.push({ kind: "mana", amount: r.manaPoints });
  if (r.experience) pics.push({ kind: "experience", amount: withLearning(h, r.experience) });
  if (r.luck) pics.push({ kind: "luck", amount: r.luck });
  return pics;
}

/** Gives reward `index` of the object (after the player said yes, or straight away). */
/** `asked`: the player saw the reward's words with the question, so only what it gives follows. */
export function grantReward(s: AdventureState, w: World, ctx: RewardCtx, h: Hero, o: AdvObject, index: number, asked = false): RewardEvent[] {
  const def = rewardableDef(o)!;
  const st = stateOf(s, w, o, def);
  const r = def.rewards[index];
  if (!r || !applicable(s, w, h, o, def, st).includes(index)) throw new Refusal("That isn't on offer any more.");
  const got: string[] = [];
  // What it gives, pictured as the original's window shows it (and only told in words when there's no picture).
  const pics: Component[] = [];
  const untold: string[] = [];
  const res = s.players[h.owner].resources;
  for (const x of r.resources ?? []) {
    const i = value(st, x.res);
    const n = value(st, x.amount);
    res[i] += n;
    if (n > 0) got.push(`${n} ${RESOURCE_NAMES[i]}`), pics.push({ kind: "resource", id: i, amount: n });
  }
  for (const [c, n] of (r.creatures ?? []).map(([c, n]) => [value(st, c), value(st, n)])) {
    pics.push({ kind: "creature", id: c, amount: n });
    got.push(ctx.addToArmy(h, c, n) ? `${n} ${w.creatures[c]?.plural ?? "creatures"}` : `${n} ${w.creatures[c]?.plural} (no room, they leave)`);
  }
  for (const a of r.artifacts ?? []) {
    // (A class: the artifact the map chose, if it chose one: the Grave's.)
    const preset = presetOf(w, o)?.artifact;
    const id = typeof a === "number" ? a : a.startsWith("@") ? st.vars[a] : preset !== undefined && preset >= 0 ? preset : ctx.randomArtifact(a);
    if (id !== undefined && id >= 0) got.push(ctx.giveArtifact(h, id)), pics.push({ kind: "artifact", id });
  }
  for (const x of r.spells ?? []) {
    const id = value(st, x);
    if (h.spells && !h.spells.includes(id)) {
      h.spells.push(id);
      pics.push({ kind: "spell", id });
      got.push(`the spell ${w.data.spells?.find((sp) => sp.id === id)?.name ?? id}`);
    }
  }
  r.primary?.forEach((n, i) => {
    if (!n) return;
    h.primary[i] += n;
    got.push(`+${n} ${PRIMARY[i]}`);
    pics.push({ kind: "primary", id: i, amount: n });
  });
  if (r.manaPoints) {
    // Up to the maximum in full, past it only this share (VCMI's calculateManaPoints; the Vial of
    // Mana: half the extra, heroes.thelazy.net).
    const before = h.mana ?? 0;
    const granted = Math.min(Math.max(0, maxMana(h) - before), r.manaPoints);
    h.mana = before + granted + Math.floor(((r.manaPoints - granted) * (r.manaOverflowFactor ?? 0)) / 100);
    if (h.mana > before) got.push(`${h.mana - before} spell points`), pics.push({ kind: "mana", amount: h.mana - before });
  }
  if (r.experience) {
    ctx.gainExperience(h, r.experience);
    got.push(`${withLearning(h, r.experience)} experience`);
    pics.push({ kind: "experience", amount: withLearning(h, r.experience) });
  }
  if (r.movePoints) {
    h.movement += r.movePoints;
    got.push(`${r.movePoints} movement points`);
    untold.push(`${r.movePoints} movement points`);
  }
  if (r.luck) {
    h.temp ??= { morale: 0, luck: 0, from: [] };
    h.temp.luck += r.luck;
    h.temp.from.push(o.id);
    got.push(`+${r.luck} luck`);
    pics.push({ kind: "luck", amount: r.luck });
  }
  if (r.morale) {
    h.temp ??= { morale: 0, luck: 0, from: [] };
    h.temp.morale += r.morale;
    h.temp.from.push(o.id);
    got.push(`${r.morale > 0 ? "+" : ""}${r.morale} morale`);
    pics.push({ kind: "morale", amount: r.morale });
  }
  if (r.upgradeSkill) {
    const up = (h.skills ?? []).filter(([, l]) => l < 3);
    const sk = up[randInt(s, 0, up.length - 1)];
    sk[1]++;
    got.push(`${["", "Basic", "Advanced", "Expert"][sk[1]]} ${ctx.skillName(sk[0])}`);
    pics.push({ kind: "skill", id: sk[0], level: sk[1] });
  }
  if (r.movePercentage !== undefined) h.movement = Math.floor(((h.maxMovement ?? h.movement) * r.movePercentage) / 100);
  for (const b of r.bonuses ?? []) {
    // ONE_WEEK: until the week ends; N_DAYS: from tomorrow for turns - 1 days (Watering Place: tomorrow).
    const until = b.duration === "ONE_WEEK" ? s.day + (7 - ((s.day - 1) % 7)) - 1 : b.duration === "ONE_DAY" ? s.day : s.day + (b.turns ?? 1) - 1;
    const from = b.duration === "N_DAYS" ? s.day + 1 : s.day;
    (h.timed ??= []).push({ type: b.type, subtype: b.subtype, val: b.val, from, until, object: o.id, active: from <= s.day });
  }
  st.heroes.push(h.type);
  st.players.push(h.owner);
  if (r.removeObject) {
    o.removed = true;
    w.refresh(s);
  }
  s.log.push(`${h.name} visits the ${def.name}${got.length ? `: ${got.join(", ")}` : ""}.`);
  if (asked && !got.length) return [];
  const text = [asked ? `{${def.name}}` : r.message ? fill(w, def, st, r.message) : `{${def.name}}`, untold.length && (asked || !r.message) ? `You receive: ${untold.join(", ")}.` : ""].filter(Boolean).join("\n\n");
  return [{ e: "visit", hero: h.id, object: o.id, message: text, ...(pics.length ? { components: pics } : {}) }];
}
