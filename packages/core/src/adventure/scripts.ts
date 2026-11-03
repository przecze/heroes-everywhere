// HotA 1.8's map scripts (the editor's event system, after VCMI's HotaScriptConverter): timed and
// town events, scripted quests and box or event visits that run a list of actions: messages,
// questions, rewards, quests, conditions on the game and the map's own variables.
import { withLearning } from "../specialty.ts";
import type { HotaAction, HotaCond, HotaExpr, HotaImage, HotaScripts } from "@heroes/formats";
import { SKILLS, learnSkill, skillLevel } from "../skills.ts";
import { randInt } from "../rng.ts";
import { giveArtifact, giveScroll, takeArtifact } from "./artifacts.ts";
import { fight, gainExperience } from "./combat.ts";
import { FACTIONS } from "./create.ts";
import { type Quest, activeQuest, questStepDone } from "./quests.ts";
import { type AdventureEvent, addToArmy } from "./rules.ts";
import { addToStacks, buildingsFromBits, garrisonHero, townInfo, upperArmy, visitingHero } from "./town.ts";
import type { AdventureState, AdvObject, Component, Hero } from "./types.ts";
import type { World } from "./world.ts";

export type ScriptBucket = "hero" | "player" | "town" | "quest";
const BUCKETS: ScriptBucket[] = ["hero", "player", "town", "quest"];

/** Where a paused script stands: action `i` of a list, and (to go deeper) the list it holds. */
interface Step {
  i: number;
  key?: string;
  branch?: number;
}

/** Where an event stands in the event that ran it ("run another event"): its bucket, id and the run action's place. */
interface Frame {
  bucket: ScriptBucket;
  id: number;
  path: Step[];
}

/** A script waiting for a player's answer (a question, or a finished quest's "accept?"), or for its hero's battle to end. */
export interface PausedScript {
  bucket: ScriptBucket;
  id: number;
  path: Step[];
  /** The events that ran this one, outermost first: they go on after it. */
  outer?: Frame[];
  object?: number;
  town?: number;
}

/** The scripts' own state: the map's variables, events turned off, quests proposed (object:player). */
export interface ScriptState {
  vars: Record<number, number>;
  off: string[];
  proposed: string[];
}

interface Ctx {
  s: AdventureState;
  w: World;
  st: ScriptState;
  bucket: ScriptBucket;
  id: number;
  player: number;
  hero?: Hero;
  object?: AdvObject;
  town?: AdvObject;
  out: AdventureEvent[];
  /** What a rewards message's actions give, for its pictures. */
  collect?: Component[];
  /** The events that ran this one (outermost first), to go on with once it's done. */
  outer: Frame[];
  /** A battle started: the rest of the script waits for its end (and runs if the hero wins). */
  stopped?: boolean;
}

interface Ask {
  text: string;
  mode: number;
  images: HotaImage[];
  extra?: HotaImage[];
}

class Pause {
  where: PausedScript;
  ask: Ask;
  constructor(c: Ctx, path: Step[], ask: Ask) {
    this.where = { bucket: c.bucket, id: c.id, path, ...(c.outer.length ? { outer: c.outer } : {}), object: c.object?.id, town: c.town?.id };
    this.ask = ask;
  }
}

export const mapScripts = (w: World): HotaScripts | undefined => w.map.hotaOptions?.scripts;

function scriptState(s: AdventureState, w: World): ScriptState {
  if (!s.scripts) {
    const vars: Record<number, number> = {};
    for (const [id, v] of Object.entries(mapScripts(w)?.variables ?? {})) vars[Number(id)] = v.initial;
    s.scripts = { vars, off: [], proposed: [] };
  }
  return s.scripts;
}

const human = (c: Ctx) => c.s.players[c.player]?.controller === "human";
const who = (c: Ctx, p: number) => (p < 0 ? c.player : p);
const count = (h: Hero | undefined, creature: number) => (h?.army ?? []).reduce((n, a) => n + (a && a.creature === creature ? a.count : 0), 0);
const artifacts = (h: Hero | undefined, a: number) => [...(h?.equipped ?? []), ...(h?.backpack ?? [])].filter((x) => x === a).length;

function value(c: Ctx, e: HotaExpr): number {
  if (typeof e === "number") return e;
  const h = c.hero;
  switch (e.k) {
    case "var":
      return c.st.vars[e.id] ?? 0;
    case "neg":
      return -value(c, e.e);
    case "+":
      return value(c, e.l) + value(c, e.r);
    case "-":
      return value(c, e.l) - value(c, e.r);
    case "*":
      return value(c, e.l) * value(c, e.r);
    case "/": {
      const d = value(c, e.r);
      return d ? Math.floor(value(c, e.l) / d) : 0;
    }
    case "%": {
      const d = value(c, e.r);
      return d ? value(c, e.l) % d : 0;
    }
    case "resource":
      return c.s.players[who(c, e.player)]?.resources[e.res] ?? 0;
    case "creatures":
      return count(h, e.creature);
    case "difficulty":
      return c.s.difficulty ?? 1;
    case "compareDifficulty":
      return (c.s.difficulty ?? 1) - e.value;
    case "date":
      return c.s.day;
    case "experience":
      return h?.experience ?? 0;
    case "level":
      return h?.level ?? 0;
    case "primary":
      return h?.primary[e.skill] ?? 0;
    case "random": {
      const lo = value(c, e.lo);
      return randInt(c.s, lo, Math.max(lo, value(c, e.hi)));
    }
    case "artifacts":
      return artifacts(h, e.artifact);
  }
}

function test(c: Ctx, k: HotaCond): boolean {
  const { s, hero: h } = c;
  switch (k.k) {
    case "const":
      return k.value;
    case "all":
      return k.of.every((x) => test(c, x));
    case "any":
      return k.of.some((x) => test(c, x));
    case "not":
      return !test(c, k.c);
    case "<":
      return value(c, k.l) < value(c, k.r);
    case ">":
      return value(c, k.l) > value(c, k.r);
    case "==":
      return value(c, k.l) === value(c, k.r);
    case ">=":
      return value(c, k.l) >= value(c, k.r);
    case "<=":
      return value(c, k.l) <= value(c, k.r);
    case "!=":
      return value(c, k.l) !== value(c, k.r);
    case "hasArtifact":
      return artifacts(h, k.artifact) > 0;
    case "currentPlayer":
      return c.player === k.player;
    case "heroOwner":
      return s.heroes.some((x) => !x.removed && x.type === k.hero && x.owner === k.player);
    case "heroClass":
      return h?.heroClass === k.cls;
    case "heroType":
      return h?.type === k.hero;
    // (As the original's "defeat" quests: the hero or monster is gone from the map.)
    case "defeatedHero":
      return !s.heroes.some((x) => !x.removed && x.ident === k.target);
    case "defeatedMonster":
      return !s.objects.some((o) => !o.removed && o.ident === k.target);
    case "ownsTown":
      return s.objects.some((o) => !o.removed && o.ident === k.target && o.owner === who(c, k.player));
    case "skill": {
      const key = SKILLS[k.skill];
      return !!h && !!key && skillLevel(h.skills, key) >= k.level;
    }
    case "playerDefeated":
      return !s.players[who(c, k.player)]?.alive;
    case "playerHuman":
      return s.players[who(c, k.player)]?.controller === "human";
    case "startingFaction":
      return s.players[who(c, k.player)]?.faction === FACTIONS[k.faction];
    case "townNeutral":
      return !!c.town && c.town.owner < 0;
  }
}

/** A message picture: HotA's numbering for messages, or (quest hints) the quest missions'. */
function component(c: Ctx, img: HotaImage, hint = false): Component | null {
  const n = img.isVar ? (c.st.vars[img.value] ?? 0) : img.value;
  if (hint) {
    if (img.kind === 0) return { kind: "artifact", id: img.sub };
    if (img.kind === 1) return { kind: "spell", id: img.sub };
    if (img.kind === 2) return { kind: "creature", id: img.sub, amount: n };
    if (img.kind === 3) return { kind: "resource", id: img.sub, amount: n };
    if (img.kind === 5) return { kind: "skill", id: img.sub, level: Math.max(1, Math.min(3, n)) };
    return null;
  }
  switch (img.kind) {
    case 0:
      return { kind: "resource", id: img.sub, amount: n };
    case 13:
      return { kind: "resource", id: img.sub, amount: -n };
    case 18:
      return { kind: "resource", id: img.sub, amount: 0 };
    case 14:
      return { kind: "income", id: img.sub, amount: n };
    case 1:
      return { kind: "artifact", id: img.sub };
    case 2:
      return { kind: "spell", id: img.sub };
    case 15:
      return { kind: "artifact", id: 1 };
    case 4:
      return { kind: "luck", amount: img.sub };
    case 5:
      return { kind: "morale", amount: img.sub };
    case 6:
      return { kind: "experience", amount: n };
    case 7:
      return { kind: "skill", id: img.sub, level: Math.max(1, Math.min(3, n)) };
    case 8:
      return { kind: "creature", id: img.sub, amount: n };
    case 17:
      return { kind: "creature", id: img.sub };
    case 9:
    case 19:
      return { kind: "primary", id: img.sub, amount: n };
    case 10:
      return { kind: "mana", amount: img.sub < 0 ? -n : n };
  }
  return null;
}
const pictures = (c: Ctx, imgs: HotaImage[], hint = false) => imgs.map((i) => component(c, i, hint)).filter((x): x is Component => !!x);

/** A message for the event's player: told about the visiting hero for visits, else to the player. */
function say(c: Ctx, text: string, components: Component[] = []) {
  if (!human(c) || (!text.trim() && !components.length)) return;
  if (c.hero && c.object && (c.bucket === "hero" || c.bucket === "quest")) c.out.push({ e: "visit", hero: c.hero.id, object: c.object.id, message: text, components });
  else c.out.push({ e: "message", player: c.player, text, components });
}

/** What an action gave: a picture in its rewards message, or its own little message. */
function gave(c: Ctx, comp: Component, show: boolean) {
  if (c.collect) c.collect.push(comp);
  else if (show) say(c, "", [comp]);
}

/** The event turned off (timed and town events), or its object gone (visits, quests). */
function disable(c: Ctx) {
  if (c.bucket === "player") c.st.off.push(`player:${c.id}`);
  else if (c.bucket === "town" && c.town) c.st.off.push(`town:${c.town.id}:${c.id}`);
  else if (c.object) removeObject(c, c.object);
}

function removeObject(c: Ctx, o: AdvObject) {
  o.removed = true;
  c.w.refresh(c.s);
}

/** A scripted quest done: a Seer's Hut is finished, a Quest Gate opens, anything else leaves. */
function finishQuest(c: Ctx) {
  const o = c.object;
  if (!o) return;
  if (o.type === 83) {
    const q = scriptedQuest(c.w, o, c.s, c.hero);
    if (q) questStepDone(c.w, o, q);
  } else if (o.type === 212) (o.data ??= {}).opened = true;
  else removeObject(c, o);
}

/** The quest log and the object's hint name the quest. */
function questHint(c: Ctx, text: string, log: boolean) {
  const o = c.object;
  if (!o) return;
  (o.data ??= {}).questHint = text;
  if (log && !o.visitors?.includes(c.player)) (o.visitors ??= []).push(c.player);
}

/** The army a reward goes to: the hero's, else (a town's event) the town's upper row. */
function giveCreatures(c: Ctx, creature: number, n: number): boolean {
  if (c.hero) return addToArmy(c.hero, creature, n);
  if (c.town?.town) return addToStacks(upperArmy(c.s, c.town), creature, n);
  return false;
}

function takeCreatures(c: Ctx, creature: number, n: number) {
  const army = c.hero?.army ?? (c.town?.town ? upperArmy(c.s, c.town) : undefined);
  // (A request for more than the army has is skipped as a whole, as VCMI does.)
  if (!army || n <= 0 || army.reduce((t, a) => t + (a && a.creature === creature ? a.count : 0), 0) < n) return;
  let left = n;
  for (let i = army.length - 1; i >= 0 && left > 0; i--) {
    const a = army[i];
    if (!a || a.creature !== creature) continue;
    const k = Math.min(left, a.count);
    a.count -= k;
    left -= k;
    if (!a.count) army[i] = null;
  }
}

function run(c: Ctx, list: HotaAction[], from: number, path: Step[]) {
  for (let i = from; i < list.length && !c.stopped; i++) act(c, list[i], [...path, { i }]);
}

function act(c: Ctx, a: HotaAction, path: Step[]) {
  const { s, w } = c;
  const h = c.hero;
  const here = path[path.length - 1];
  const into = (key: string, branch?: number): Step[] => [...path.slice(0, -1), { i: here.i, key, branch }];
  const p = s.players[c.player];
  switch (a.k) {
    case "message":
      return say(c, a.text, pictures(c, a.images));
    case "rewardsMessage": {
      const outer = c.collect;
      const got: Component[] = (c.collect = []);
      try {
        run(c, a.body, 0, into("body"));
      } finally {
        c.collect = outer;
      }
      return say(c, a.text, got);
    }
    case "removeObject":
      return c.bucket === "quest" ? finishQuest(c) : disable(c);
    case "disable":
      return disable(c);
    case "quest": {
      const key = `${c.object?.id ?? -1}:${c.player}`;
      if (test(c, a.cond)) {
        // A player is asked first, as with the original's quests ("... Do you accept?").
        if (h && human(c) && a.completion.trim()) throw new Pause(c, path, { text: a.completion, mode: 0, images: [] });
        say(c, a.completion);
        return run(c, a.reward, 0, into("reward"));
      }
      if (c.st.proposed.includes(key)) return say(c, a.progression);
      c.st.proposed.push(key);
      questHint(c, a.hint, true);
      return say(c, a.proposal);
    }
    case "if":
      return test(c, a.cond) ? run(c, a.then, 0, into("then")) : run(c, a.else, 0, into("else"));
    case "chain": {
      const b = a.branches.findIndex((x) => test(c, x.cond));
      return b >= 0 ? run(c, a.branches[b].body, 0, into("body", b)) : undefined;
    }
    case "for": {
      const to = value(c, a.to);
      for (let i = value(c, a.from); i <= to && !c.stopped; i++) {
        c.st.vars[a.variable] = i;
        run(c, a.body, 0, into("body"));
      }
      return;
    }
    case "questHint":
      return questHint(c, a.text, a.log);
    case "question":
      // (Asked of the hero's player, or with no hero, of the event's player; the computer says yes.)
      if (human(c)) throw new Pause(c, path, { text: a.text, mode: a.mode, images: a.images, extra: a.extra });
      return run(c, a.yes, 0, into("yes"));
    case "artifact":
      if (!h) return;
      if (a.take) return void takeArtifact(h, a.artifact);
      if (a.spell >= 0 && a.artifact === 1) giveScroll(h, w.data.artifacts, a.spell);
      else giveArtifact(h, w.data.artifacts, a.artifact);
      return gave(c, { kind: "artifact", id: a.artifact }, a.show);
    case "warMachine":
      if (!h) return;
      if (a.take) return void takeArtifact(h, a.artifact);
      if (!(h.equipped ?? []).includes(a.artifact)) giveArtifact(h, w.data.artifacts, a.artifact);
      return gave(c, { kind: "artifact", id: a.artifact }, a.show);
    case "spellbook":
      if (!h) return;
      if (a.take) return void takeArtifact(h, 0);
      if (!(h.equipped ?? []).includes(0)) giveArtifact(h, w.data.artifacts, 0);
      h.spells ??= [];
      return gave(c, { kind: "artifact", id: 0 }, a.show);
    case "spell":
      if (!h) return;
      if (!(h.spells ??= []).includes(a.spell)) h.spells.push(a.spell);
      return gave(c, { kind: "spell", id: a.spell }, a.show);
    case "creatures": {
      const n = value(c, a.count);
      if (a.creature < 0 || n <= 0) return;
      if (a.take) return takeCreatures(c, a.creature, n);
      if (giveCreatures(c, a.creature, n)) gave(c, { kind: "creature", id: a.creature, amount: n }, a.show);
      return;
    }
    case "combat": {
      const stacks = a.army.map((x) => ({ creature: x.creature, count: value(c, x.count) })).filter((x) => x.creature >= 0 && x.count > 0);
      if (!h || !stacks.length) return;
      // (No object of its own: a won battle doesn't open the box or take the town again; the script goes on.)
      c.out.push(...fight(s, w, h, { name: "Monsters", stacks }, -1));
      h.scriptAfterBattle = new Pause(c, path, { text: "", mode: 0, images: [] }).where;
      c.stopped = true;
      return;
    }
    case "secondarySkill":
      if (!h) return;
      learnSkill(h, a.skill, a.level);
      return gave(c, { kind: "skill", id: a.skill, level: Math.max(1, Math.min(3, a.level)) }, a.show);
    case "morale":
    case "luck":
      if (!h) return;
      h.temp ??= { morale: 0, luck: 0, from: [] };
      h.temp[a.k] += a.amount;
      return gave(c, { kind: a.k, amount: a.amount }, a.show);
    case "experience": {
      const n = value(c, a.amount);
      if (!h || n <= 0) return;
      gainExperience(s, w, h, n);
      return gave(c, { kind: "experience", amount: withLearning(h, n) }, a.show);
    }
    case "spellPoints": {
      if (!h) return;
      const n = value(c, a.amount);
      const before = h.mana ?? 0;
      h.mana = Math.max(0, [before + n, before - n, n][a.mode] ?? before);
      return gave(c, { kind: "mana", amount: h.mana - before }, a.show);
    }
    case "movement": {
      if (!h) return;
      const n = value(c, a.amount);
      h.movement = Math.max(0, [h.movement + n, h.movement - n, n][a.mode] ?? h.movement);
      return;
    }
    case "hire": {
      const t = c.town?.town;
      const n = value(c, a.amount);
      if (!t || a.level < 0 || a.level >= t.available.length || n <= 0) return;
      t.available[a.level] += n;
      return;
    }
    case "build": {
      const o = c.town;
      if (!o?.town || (a.faction >= 0 && townInfo(o)?.faction !== FACTIONS[a.faction])) return;
      for (const b of buildingsFromBits(o, [a.building])) if (!o.town.built.includes(b)) o.town.built.push(b);
      return;
    }
    case "run": {
      const bucket = BUCKETS[a.bucket];
      const list = bucket && mapScripts(w)?.events[bucket][a.id];
      if (!list) return;
      const sub: Ctx = { ...c, bucket, id: a.id, outer: [...c.outer, { bucket: c.bucket, id: c.id, path }] };
      run(sub, list, 0, []);
      c.stopped = sub.stopped;
      return;
    }
    case "resources": {
      if (!p) return;
      a.amounts.forEach((e, r) => {
        const n = value(c, e);
        const before = p.resources[r];
        p.resources[r] = Math.max(0, [before + n, before - n, n][a.mode] ?? before);
        if (p.resources[r] !== before) gave(c, { kind: "resource", id: r, amount: p.resources[r] - before }, a.show);
      });
      return;
    }
    case "primary": {
      const n = value(c, a.amount);
      if (!h || !n) return;
      h.primary[a.skill] = Math.max(a.skill < 2 ? 0 : 1, h.primary[a.skill] + n);
      return gave(c, { kind: "primary", id: a.skill, amount: n }, a.show);
    }
    case "setVar": {
      const n = value(c, a.value);
      const v = c.st.vars[a.id] ?? 0;
      c.st.vars[a.id] = [v + n, v - n, n][a.mode] ?? n;
      return;
    }
    case "setVarIf":
      c.st.vars[a.id] = value(c, test(c, a.cond) ? a.yes : a.no);
      return;
  }
}

/** Runs the list (from a paused point on) and asks the player when it stops at a question. */
function execute(c: Ctx, start: () => void): AdventureEvent[] {
  try {
    start();
  } catch (e) {
    if (!(e instanceof Pause)) throw e;
    const { mode } = e.ask;
    const choose = mode === 1 || mode === 2;
    const components = pictures(c, e.ask.images);
    const extra = choose ? pictures(c, e.ask.extra ?? []) : [];
    const h = c.hero;
    if (h) {
      const object = c.object ?? c.town;
      if (!object) return c.out;
      h.offer = { object: object.id, kind: "script", cost: mode };
      h.script = e.where;
      c.out.push({ e: "offer", hero: h.id, object: object.id, kind: "script", cost: mode, text: e.ask.text, components, ...(choose ? { options: [0, 1] } : {}), ...(extra.length ? { extra } : {}) });
    } else {
      // A timed event (or a town's with no hero in it): the player is asked.
      c.s.players[c.player].script = e.where;
      c.out.push({ e: "scriptAsk", player: c.player, text: e.ask.text, mode, components, ...(extra.length ? { extra } : {}) });
    }
  }
  return c.out;
}

function context(s: AdventureState, w: World, bucket: ScriptBucket, id: number, player: number, at: { hero?: Hero; object?: AdvObject; town?: AdvObject }): Ctx {
  return { s, w, st: scriptState(s, w), bucket, id, player, ...at, out: [], outer: [] };
}

/** Runs one of the map's scripts (a timed event's for `player`, a town's, a visit's or a quest's). */
export function runScript(s: AdventureState, w: World, bucket: ScriptBucket, id: number, player: number, at: { hero?: Hero; object?: AdvObject; town?: AdvObject } = {}): AdventureEvent[] {
  const list = mapScripts(w)?.events[bucket][id];
  if (!list) return [];
  const c = context(s, w, bucket, id, player, at);
  return execute(c, () => run(c, list, 0, []));
}

/** Whether a timed event's (`player:id`) or a town's event (`town:object:id`) script was turned off. */
export const scriptOff = (s: AdventureState, key: string) => !!s.scripts?.off.includes(key);

/** A town event's script, at the start of the owner's day: about the hero in the town, if any. */
export function runTownScript(s: AdventureState, w: World, o: AdvObject, id: number): AdventureEvent[] {
  if (scriptOff(s, `town:${o.id}:${id}`)) return [];
  const hero = visitingHero(s, w, o) ?? garrisonHero(s, o);
  return runScript(s, w, "town", id, o.owner, { hero, town: o });
}

/** The quest an object asks when it's a script's (HotA's quest kind 3), else null. */
export function scriptedQuest(w: World, o: AdvObject, s?: AdventureState, h?: Hero): (Quest & { script: { id: number } }) | null {
  const q = activeQuest(w, o, s, h) as Quest & { script?: { id: number } };
  return q.mission === 10 && q.hota === 3 && q.script ? (q as Quest & { script: { id: number } }) : null;
}

/** The lists along a path into an event: lists[k] holds the action path[k] points at. */
function along(w: World, bucket: ScriptBucket, id: number, path: Step[]): HotaAction[][] {
  const lists: HotaAction[][] = [mapScripts(w)?.events[bucket][id] ?? []];
  for (const step of path.slice(0, -1)) {
    const a = lists[lists.length - 1][step.i] as unknown as Record<string, unknown> | undefined;
    const next = step.branch !== undefined ? (a?.branches as { body: HotaAction[] }[] | undefined)?.[step.branch]?.body : a?.[step.key!];
    lists.push((next as HotaAction[] | undefined) ?? []);
  }
  return lists;
}

/** What comes after the action at `path`, at each level out (a loop it sat in goes on with its next turns). */
function continueAfter(c: Ctx, path: Step[]) {
  const lists = along(c.w, c.bucket, c.id, path);
  for (let k = path.length - 1; k >= 0 && !c.stopped; k--) {
    const a = lists[k][path[k].i];
    if (k < path.length - 1 && a?.k === "for" && path[k].key === "body") {
      const to = value(c, a.to);
      for (let v = (c.st.vars[a.variable] ?? 0) + 1; v <= to && !c.stopped; v++) {
        c.st.vars[a.variable] = v;
        run(c, a.body, 0, [...path.slice(0, k), { i: path[k].i, key: "body" }]);
      }
    }
    if (!c.stopped) run(c, lists[k], path[k].i + 1, path.slice(0, k));
  }
  // Then the event that ran this one (and so on out).
  const f = c.outer[c.outer.length - 1];
  if (!f || c.stopped) return;
  const oc: Ctx = { ...c, bucket: f.bucket, id: f.id, outer: c.outer.slice(0, -1) };
  continueAfter(oc, f.path);
  c.stopped = oc.stopped;
}

/** A paused script's context again: its event, hero, object and town, and the events that ran it. */
function reopen(s: AdventureState, w: World, p: PausedScript, player: number, hero?: Hero): Ctx {
  const object = p.object !== undefined ? s.objects[p.object] : undefined;
  const town = p.town !== undefined ? s.objects[p.town] : undefined;
  const c = context(s, w, p.bucket, p.id, player, { hero, object, town });
  c.outer = p.outer ?? [];
  return c;
}

/** The answer to a paused script's question: the chosen branch, then the rest of the script. */
function answer(s: AdventureState, w: World, p: PausedScript, player: number, hero: Hero | undefined, accept: boolean, option?: number): AdventureEvent[] {
  if (!mapScripts(w)?.events[p.bucket][p.id]) return [];
  const c = reopen(s, w, p, player, hero);
  const lists = along(w, p.bucket, p.id, p.path);
  const last = p.path[p.path.length - 1];
  const q = lists[lists.length - 1][last.i];
  if (!q) return [];
  const branch = (key: string) => run(c, (q as unknown as Record<string, HotaAction[]>)[key] ?? [], 0, [...p.path.slice(0, -1), { i: last.i, key }]);
  return execute(c, () => {
    if (q.k === "quest") {
      if (!accept) return;
      branch("reward");
    } else if (q.k === "question") {
      // Two pictures to choose from: the first is "yes", the second "no" (Cancel: its own, if any).
      if (q.mode === 1 || q.mode === 2) {
        if (!accept) {
          if (q.mode === 2) branch("cancel");
        } else branch(option === 1 ? "no" : "yes");
      } else branch(accept ? "yes" : "no");
    }
    // Then what came after it, at each level out, and in the events that ran it.
    if (!c.stopped) continueAfter(c, p.path);
  });
}

/** The player's answer to a paused script (a hero's question): the chosen branch, then the rest of the script. */
export function resumeScript(s: AdventureState, w: World, h: Hero, accept: boolean, option?: number): AdventureEvent[] {
  const p = h.script;
  delete h.script;
  return p ? answer(s, w, p, h.owner, h, accept, option) : [];
}

/** The player's answer to a timed or town event's question (no hero asked). */
export function answerPlayerScript(s: AdventureState, w: World, player: number, accept: boolean, option?: number): AdventureEvent[] {
  const p = s.players[player]?.script;
  if (!p) return [];
  delete s.players[player].script;
  return answer(s, w, p, player, undefined, accept, option);
}

/** A script's battle is over: if its hero won, the rest of the script runs; else it ends there. */
export function afterScriptBattle(s: AdventureState, w: World, h: Hero, won: boolean): AdventureEvent[] {
  const p = h.scriptAfterBattle;
  delete h.scriptAfterBattle;
  if (!p || !won || h.removed || !mapScripts(w)?.events[p.bucket][p.id]) return [];
  const c = reopen(s, w, p, h.owner, h);
  return execute(c, () => continueAfter(c, p.path));
}

/** For the AI: whether a script's quest would be done now (its quest's condition holds), or says something new. */
export function scriptQuestReady(s: AdventureState, w: World, h: Hero, o: AdvObject): boolean {
  const q = scriptedQuest(w, o, s, h);
  const list = q ? mapScripts(w)?.events.quest[q.script.id] : undefined;
  if (!list) return false;
  const quest = list.find((a) => a.k === "quest");
  if (!quest) return !o.visitors?.includes(h.owner);
  return test(context(s, w, "quest", q!.script.id, h.owner, { hero: h, object: o }), quest.cond);
}

/** The variables a campaign scenario hands on (those marked to keep), by name. */
export function persistentVars(s: AdventureState, w: World): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(mapScripts(w)?.variables ?? {})) if (v.persist) out[v.name] = scriptState(s, w).vars[Number(id)] ?? v.initial;
  return out;
}

/** A campaign scenario's imported variables start with the value the scenario before handed on (by name). */
export function importVars(s: AdventureState, w: World, from: Record<string, number>) {
  const st = scriptState(s, w);
  for (const [id, v] of Object.entries(mapScripts(w)?.variables ?? {})) if (v.imported && v.name in from) st.vars[Number(id)] = from[v.name];
}
