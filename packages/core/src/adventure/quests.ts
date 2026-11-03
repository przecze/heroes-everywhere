// Seer's Huts, Quest Guards and Quest Gates: quests and their rewards (H3M quest data).
import { dateLine } from "../calendar.ts";
import { SKILL_NAMES, learnSkill } from "../skills.ts";
import { HERO_CLASSES } from "../heroData.ts";
import { effectivePrimary, giveArtifact, giveScroll, takeArtifact } from "./artifacts.ts";
import { mapData } from "./objects.ts";
import { type AdventureState, type AdvObject, type Component, type Hero, RESOURCE_NAMES, type TextRef } from "./types.ts";
import type { World } from "./world.ts";

export interface Quest {
  mission: number;
  primary?: number[];
  level?: number;
  target?: number;
  artifacts?: number[];
  creatures?: { creature: number; count: number }[];
  resources?: number[];
  hero?: number;
  player?: number;
  firstVisit?: string;
  nextVisit?: string;
  completed?: string;
  reward?: number;
  amount?: number;
  resource?: number;
  skill?: number;
  artifact?: number;
  spell?: number;
  creature?: number;
  /** HotA's own quests (mission 10): 0 = a hero of these classes, 1 = not before a day, 2 = on these difficulties, 3 = a script's. */
  hota?: number;
  classes?: number[];
  value?: number;
  /** The last day it can be done (-1: no limit). */
  lastDay?: number;
  /** HotA: a Seer's quest that can be done again and again once the others are. */
  repeat?: boolean;
}

/**
 * The quest an object asks now: a Quest Guard's or Quest Gate's own. A Seer's Hut's (HotA's hold
 * several: those done once are alternatives, whichever the hero can do first, then the hut's
 * repeatable ones in turn): with a hero, the first it has done; else the first still open.
 */
export function activeQuest(w: World, o: AdvObject, s?: AdventureState, h?: Hero): Quest {
  const data = mapData(w, o);
  if (o.type !== 83) return data as unknown as Quest;
  const all = ((data.quests as Quest[] | undefined) ?? []).filter((q) => q.mission);
  const done = (o.data?.doneQuests as number[] | undefined) ?? [];
  const once = all.filter((q, i) => !q.repeat && !done.includes(i) && !(s && questExpired(s, q)));
  const again = all.filter((q) => q.repeat);
  const next = again.length ? again[((o.data?.repeats as number | undefined) ?? 0) % again.length] : undefined;
  if (s && h) {
    const ready = once.find((q) => questDone(s, w, h, q)) ?? (next && questDone(s, w, h, next) ? next : undefined);
    if (ready) return ready;
  }
  return once[0] ?? next ?? { mission: 0 };
}

/** A Seer's Hut's quest done: a repeatable one passes to the next in turn; the hut is deserted once nothing is left. */
export function questStepDone(w: World, o: AdvObject, q: Quest) {
  const all = ((mapData(w, o).quests as Quest[] | undefined) ?? []).filter((x) => x.mission);
  const d = (o.data ??= {});
  if (q.repeat) d.repeats = ((d.repeats as number | undefined) ?? 0) + 1;
  else d.doneQuests = [...((d.doneQuests as number[] | undefined) ?? []), all.indexOf(q)];
  const left = all.filter((x, i) => x.repeat || !(d.doneQuests as number[] | undefined)?.includes(i));
  if (!left.length) d.done = true;
}

/** Past its deadline: it can't be done any more. */
export const questExpired = (s: AdventureState, q: Quest) => (q.lastDay ?? -1) >= 0 && s.day > q.lastDay!;

const DIFFICULTIES = ["Easy", "Normal", "Hard", "Expert", "Impossible"];
const className = (c: number) => {
  const key = HERO_CLASSES[c]?.key ?? `class ${c}`;
  return key.charAt(0).toUpperCase() + key.slice(1);
};
/** The game's date of a day: "Month 1, Week 2, Day 3". */
const dateOf = (day: number) => dateLine(day);
/** HotA's date quest: open from this day on (the map keeps the day before, as VCMI reads it). */
const openFrom = (q: Quest) => (q.value ?? 0) + 1;

const PRIMARY = ["Attack", "Defense", "Power", "Knowledge"];
const hasArtifact = (h: Hero, a: number) => (h.equipped ?? []).includes(a) || (h.backpack ?? []).includes(a);

const PLAYERS = ["Red", "Blue", "Tan", "Green", "Orange", "Purple", "Teal", "Pink"];

/** "a, b and c", as the original's lists. */
const list = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The seer's name: one of SEERHUT.TXT's 48, fixed per hut. */
export const seerName = (o: AdvObject): TextRef => ({ file: "seerhut", id: 70 + ((o.id * 7) % 48), col: 0 });

/**
 * The original's quest line from SEERHUT.TXT (VCMI's core.seerhut): rows by mission, five each
 * (0 asked, 1 not yet, 2 done, 3 hover, 4 quest log); three wordings for Seer's Huts, then Quest
 * Guards, then Quest Gates. The wording is fixed per object.
 */
export function questRef(s: AdventureState, w: World, o: AdvObject, q: Quest, state: 0 | 1 | 2 | 3 | 4): TextRef {
  const col = 1 + (o.id % 3) + (o.type === 215 ? 3 : o.type === 212 ? 6 : 0);
  if (!q.mission) return { file: "seerhut", id: 1, col: 1 + (o.id % 3), args: [seerName(o)] };
  let args: (string | number | TextRef)[] = [];
  switch (q.mission) {
    case 1:
      args = [q.level ?? 0];
      break;
    case 2:
      args = [list((q.primary ?? []).flatMap((v, i) => (v ? [`${v} ${PRIMARY[i]}`] : [])))];
      break;
    case 3:
      args = [s.heroes.find((x) => x.ident === q.target)?.name ?? ""];
      break;
    case 4: {
      const m = s.objects.find((x) => x.ident === q.target);
      // VCMI's checkDirection: which ninth of the map the monster is in (x counts as north-south there).
      const third = (v: number) => (v / w.size < 0.34 ? 0 : v / w.size < 0.67 ? 1 : 2);
      const dir = m ? [[8, 1, 2], [7, 9, 3], [6, 5, 4]][third(m.x)][third(m.y)] : 9;
      args = [w.creatures[m?.subid ?? -1]?.plural ?? "", { file: "arraytxt", id: 147 + dir }];
      break;
    }
    case 5:
      args = [list((q.artifacts ?? []).map((a) => w.data.artifacts[a]?.name ?? ""))];
      break;
    case 6:
      args = [list((q.creatures ?? []).map((c) => `${c.count} ${w.creatures[c.creature]?.plural ?? ""}`))];
      break;
    case 7:
      args = [list((q.resources ?? []).flatMap((n, i) => (n ? [`${n} ${RESOURCE_NAMES[i]}`] : [])))];
      break;
    case 8:
      args = [w.data.heroNames[q.hero ?? -1] ?? ""];
      break;
    case 9:
      args = [PLAYERS[q.player ?? 0] ?? ""];
      break;
    case 10:
      if (q.hota === 0) args = [(q.classes ?? []).map(className).join(" or ")];
      else if (q.hota === 1) args = [dateOf(openFrom(q))];
      else if (q.hota === 2) args = [DIFFICULTIES.filter((_, i) => ((q.value ?? 0) >> i) & 1).join(" or ")];
      break;
  }
  // The quest log names the seer ("Defeat %s for %s"), not the monster's region.
  if (state === 4) args = [args[0], seerName(o)];
  // (HotA's own follow the original's nine: class, date, difficulty, a script's.)
  const row = q.mission === 10 ? 9 + (q.hota ?? 0) : q.mission - 1;
  const ref: TextRef = { file: "seerhut", id: 2 + row * 5 + state, col, args };
  // A deadline: "You must return in %d days."
  const lastDay = (q as { lastDay?: number }).lastDay ?? -1;
  if (lastDay >= 0 && state < 2) ref.more = [" ", { file: "seerhut", id: 67, col, args: [Math.max(0, lastDay - s.day)] }];
  return ref;
}

/** Pictures of what the quest asks for, under its message (VCMI's loadComponents). */
export function questComponents(q: Quest): Component[] {
  switch (q.mission) {
    case 2:
      return (q.primary ?? []).flatMap((v, i) => (v ? [{ kind: "primary" as const, id: i, amount: v, need: true }] : []));
    case 5:
      return (q.artifacts ?? []).map((a) => ({ kind: "artifact" as const, id: a }));
    case 6:
      return (q.creatures ?? []).map((c) => ({ kind: "creature" as const, id: c.creature, amount: c.count }));
    case 7:
      return (q.resources ?? []).flatMap((n, i) => (n ? [{ kind: "resource" as const, id: i, amount: n }] : []));
  }
  return [];
}

/** The picture of what the quest gives, under the reward's message. */
export function questRewardComponents(q: Quest): Component[] {
  const n = q.amount ?? 0;
  switch (q.reward) {
    case 1:
      return [{ kind: "experience", amount: n }];
    case 2:
      return [{ kind: "mana", amount: n }];
    case 3:
      return [{ kind: "morale", amount: n }];
    case 4:
      return [{ kind: "luck", amount: n }];
    case 5:
      return [{ kind: "resource", id: q.resource ?? 6, amount: n }];
    case 6:
      return [{ kind: "primary", id: q.skill ?? 0, amount: n }];
    case 7:
      return [{ kind: "skill", id: q.skill ?? 0, level: n || 1 }];
    case 8:
      return [{ kind: "artifact", id: q.artifact ?? 0 }];
    case 9:
      return q.spell === undefined ? [] : [{ kind: "spell", id: q.spell }];
    case 10:
      return [{ kind: "creature", id: q.creature ?? 0, amount: n }];
  }
  return [];
}

/** What the quest asks, in words (when the map has no text for it). */
export function questText(w: World, q: Quest): string {
  switch (q.mission) {
    case 1:
      return `Come back when you reach level ${q.level}.`;
    case 2:
      return `Come back with at least ${(q.primary ?? []).map((v, i) => (v ? `${v} ${PRIMARY[i]}` : "")).filter(Boolean).join(", ")}.`;
    case 3:
      return "Defeat a certain hero.";
    case 4:
      return "Defeat a certain monster.";
    case 5:
      return `Bring me ${(q.artifacts ?? []).map((a) => w.data.artifacts[a]?.name ?? "an artifact").join(", ")}.`;
    case 6:
      return `Bring me ${(q.creatures ?? []).map((c) => `${c.count} ${w.creatures[c.creature]?.plural ?? ""}`).join(", ")}.`;
    case 7:
      return `Bring me ${(q.resources ?? []).map((n, i) => (n ? `${n} ${RESOURCE_NAMES[i]}` : "")).filter(Boolean).join(", ")}.`;
    case 8:
      return "Only a certain hero may pass.";
    case 9:
      return "Only a certain player may pass.";
    case 10:
      if (q.hota === 0) return `Only a hero of these classes may pass: ${(q.classes ?? []).map(className).join(", ")}.`;
      if (q.hota === 1) return `Closed till ${dateOf(openFrom(q))}.`;
      if (q.hota === 2) return `Only on these difficulties: ${DIFFICULTIES.filter((_, i) => ((q.value ?? 0) >> i) & 1).join(", ")}.`;
  }
  return "";
}

/** Has the hero done what the quest asks? */
export function questDone(s: AdventureState, w: World, h: Hero, q: Quest): boolean {
  switch (q.mission) {
    case 0:
      return true;
    case 1:
      return h.level >= (q.level ?? 0);
    case 2:
      return (q.primary ?? []).every((v, i) => effectivePrimary(h)[i] >= v);
    case 3:
      return !s.heroes.some((x) => !x.removed && x.ident === q.target);
    case 4:
      return !s.objects.some((o) => !o.removed && o.ident === q.target);
    case 5:
      return (q.artifacts ?? []).every((a) => hasArtifact(h, a));
    case 6:
      return (q.creatures ?? []).every((c) => h.army.reduce((n, a) => n + (a && a.creature === c.creature ? a.count : 0), 0) >= c.count);
    case 7:
      return (q.resources ?? []).every((n, i) => s.players[h.owner].resources[i] >= n);
    case 8:
      return h.type === q.hero;
    case 9:
      return h.owner === q.player;
    case 10:
      if (q.hota === 0) return (q.classes ?? []).includes(h.heroClass);
      if (q.hota === 1) return s.day >= openFrom(q);
      if (q.hota === 2) return !!(((q.value ?? 0) >> (s.difficulty ?? 1)) & 1);
      // (3: a script's, which isn't run.)
      return false;
  }
  return false;
}

/** Takes what the quest asked for (artifacts, creatures, resources). */
export function questPay(s: AdventureState, h: Hero, q: Quest) {
  if (q.mission === 5) {
    // (A worn combination frees the slots it locked.)
    for (const a of q.artifacts ?? []) takeArtifact(h, a);
  }
  if (q.mission === 6) {
    for (const c of q.creatures ?? []) {
      let left = c.count;
      for (const a of h.army) {
        if (!a || a.creature !== c.creature || !left) continue;
        const take = Math.min(left, a.count);
        a.count -= take;
        left -= take;
      }
      h.army = h.army.map((a) => (a && a.count > 0 ? a : null));
    }
  }
  if (q.mission === 7) (q.resources ?? []).forEach((n, i) => (s.players[h.owner].resources[i] -= n));
}

/** A Seer's reward: experience, mana, morale, luck, resource, skills, artifact, spell or creatures. */
export function questReward(s: AdventureState, w: World, h: Hero, q: Quest, gainExperience: (xp: number) => string[], addToArmy: (c: number, n: number) => boolean): string {
  const n = q.amount ?? 0;
  switch (q.reward) {
    case 1:
      return [`${n} experience.`, ...gainExperience(n)].join(" ");
    case 2:
      h.mana = (h.mana ?? 0) + n;
      return `${n} spell points.`;
    case 3:
    case 4:
      h.temp ??= { morale: 0, luck: 0, from: [] };
      if (q.reward === 3) h.temp.morale += n;
      else h.temp.luck += n;
      return `${q.reward === 3 ? "Morale" : "Luck"} +${n}.`;
    case 5:
      s.players[h.owner].resources[q.resource ?? 6] += n;
      return `${n} ${RESOURCE_NAMES[q.resource ?? 6]}.`;
    case 6:
      h.primary[q.skill ?? 0] += n;
      return `+${n} ${PRIMARY[q.skill ?? 0]}.`;
    case 7:
      learnSkill(h, q.skill ?? 0, n || 1);
      return `${SKILL_NAMES[q.skill ?? 0]}.`;
    case 8:
      // (HotA: a spell scroll with its spell.)
      if (q.artifact === 1 && q.spell !== undefined) {
        giveScroll(h, w.data.artifacts, q.spell);
        return `A scroll of ${w.data.spells?.[q.spell]?.name ?? "magic"}.`;
      }
      giveArtifact(h, w.data.artifacts, q.artifact ?? 0);
      return `${w.data.artifacts[q.artifact ?? 0]?.name ?? "An artifact"}.`;
    case 9:
      if (h.spells && q.spell !== undefined && !h.spells.includes(q.spell)) h.spells.push(q.spell);
      return `${w.data.spells?.[q.spell ?? 0]?.name ?? "A spell"}.`;
    case 10:
      addToArmy(q.creature ?? 0, n);
      return `${n} ${w.creatures[q.creature ?? 0]?.plural ?? "creatures"}.`;
  }
  return "";
}
