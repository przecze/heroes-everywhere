// The combat log, language-neutral: each entry names a line (the original's GENRLTXT.TXT line by
// its number in VCMI's numbering, or one of ours by key) and its arguments, creatures and spells by
// id; `logText` writes it out. The client fills the lines from the game's own text files (so the
// log scrolled back reads as the console did while the blow played, in the game files' language);
// the headless tools (sims, proofs, tests) get the same lines from the files they were given (gameLines.ts), or
// the line's number and its fill-ins without them. Our own lines (OURS) are English here.
import type { CreatureStats } from "../creatures.ts";
import { gameLine } from "../gameLines.ts";
import type { SpellInfo } from "../spells.ts";

/** A creature by id: its name for one, its plural for any other count. */
export interface LogCreature {
  cr: number;
  n: number;
}
/** A spell by id (the battle's spell table names it). */
export interface LogSpell {
  sp: number;
}
export type LogArg = string | number | LogCreature | LogSpell | { list: LogArg[] } | LogLine;
/** One log line: `t` the line (a GENRLTXT number or our key), `a` its %s / %d in turn, `then` lines that follow it on the same entry. */
export interface LogLine {
  t: number | OurLine;
  a?: LogArg[];
  then?: LogLine[];
}
/** A log entry; plain text only in battles saved before the log was structured. */
export type LogEntry = string | LogLine;


/** Our lines: what the original's files have no line for (HotA's creatures, sieges, hazards, the battle's end). */
export const OURS = {
  begins: "The battle begins!",
  wins: "%s wins the battle!",
  draw: "Both armies have perished.",
  theHero: "The hero",
  tactics: "%s arranges the troops (Tactics).",
  artifactsCast: "%s's artifacts cast %s.",
  cantAct: "%s can't act.",
  fangarms: "%d %s rise from the fallen %s.",
  ashes: "%d %s rise from the ashes!",
  mineNone: "A land mine explodes: no effect.",
  fireWallNone: "The fire wall burns: no effect.",
  moat: "The moat hurts the %s (%d damage).",
  moatKills: "The moat hurts the %s (%d damage, %d perish).",
  cannon: "The cannon",
  catapult: "The catapult",
  theStack: "The %s",
  /** A wall part struck by the catapult / the cannon (one) or Cyclopes (many). */
  destroysOne: "%s destroys the %s.",
  destroysMany: "%s destroy the %s.",
  damagesOne: "%s damages the %s.",
  damagesMany: "%s damage the %s.",
  missOne: "%s hits the %s to no effect.",
  missMany: "%s hit the %s to no effect.",
  keep: "keep",
  bottomTower: "lower tower",
  bottomWall: "lower wall",
  belowGate: "wall below the gate",
  overGate: "wall above the gate",
  upperWall: "upper wall",
  upperTower: "upper tower",
  gate: "gate",
  detonate: "%s detonate: %d damage to everything beside them.",
  acid: "Acid burns the %s: %d damage.",
  fireShield: "Fire Shield deals %d damage.",
  frozen: "%s are frozen.",
  cursed: "%s are cursed.",
  weakened: "%s are weakened.",
  hypnotized: "%s are hypnotized.",
  acidBurned: "%s are burned by acid.",
  rodOne: "The Lightning Rod strikes %d enemy stack.",
  rodMany: "The Lightning Rod strikes %d enemy stacks.",
  sacrificed: "%s are sacrificed; %d %s rise again.",
  devour: "%s devour the fallen %s.",
  ignite: "%s ignite: they will detonate as they fall.",
  meditate: "%s meditate: nothing can touch them until their turn in the next round.",
  repair: "%s repair the %s.",
  repairBack: "%s repair the %s (%d back in action).",
  resurrect: "%s resurrect %d %s.",
  raiseDemons: "%s raise %d %s.",
  heatStroke: "%s unleash a Heat Stroke.",
  /** What the original only shows (an animation, a number over the stack): in the log too, to read back (2026-11-02). */
  regen: "%s regenerate %d health.",
  poisonBites: "The poison saps the %s.",
  drain: "%s drain %d life.",
  drainRise: "%s drain %d life: %d rise again.",
  wearsOff: "%s wears off the %s.",
  vanishes: "The clone of the %s vanishes.",
  aSpell: "a spell",
  /** A spell's victims across several stacks. */
  creature: "creature",
  creatures: "creatures",
} as const;
export type OurLine = keyof typeof OURS;

/** What names the creatures and spells: the battle state (its tables come from the game files). */
export interface LogNames {
  creatures: Record<number, CreatureStats>;
  spells?: Record<number, SpellInfo>;
}
/** Where the lines' words come from: the game's GENRLTXT line `id`, our line `key` (without them, the files the game data was built from). */
export interface LogWords {
  gen?: (id: number) => string | undefined;
  ours?: (key: OurLine, english: string) => string;
}

/** A log entry as one line of text: the game files' words when `words` has them, else those the game data was built from. */
export function logText(names: LogNames, e: LogEntry, words: LogWords = {}): string {
  if (typeof e === "string") return e;
  const fill = (tpl: string, args: string[]) => {
    let k = 0;
    return tpl.replace(/%[sd]/g, () => args[k++] ?? "");
  };
  const arg = (a: LogArg): string => {
    if (typeof a === "string" || typeof a === "number") return String(a);
    if ("cr" in a) {
      const c = names.creatures[a.cr];
      return c ? (a.n === 1 ? c.name : c.plural) : "?";
    }
    if ("sp" in a) return names.spells?.[a.sp]?.name ?? line({ t: "aSpell" });
    if ("list" in a) return a.list.map(arg).join(", ");
    return line(a);
  };
  const line = (l: LogLine): string => {
    const tpl = typeof l.t === "number" ? words.gen?.(l.t) || gameLine("genrltxt", l.t) || `genrltxt ${l.t}:${" %s".repeat(l.a?.length ?? 0)}` : (words.ours?.(l.t, OURS[l.t]) ?? OURS[l.t] ?? String(l.t));
    return [fill(tpl, (l.a ?? []).map(arg)), ...(l.then ?? []).map(line)].join(" ").replace(/\s+/g, " ").trim();
  };
  return line(e);
}

/** The line's own number or key and those of every line in it (to find an entry by the line it shows). */
export function logLines(e: LogEntry): (number | OurLine)[] {
  if (typeof e === "string") return [];
  const out: (number | OurLine)[] = [e.t];
  const walk = (a: LogArg) => {
    if (typeof a !== "object") return;
    if ("t" in a) out.push(...logLines(a));
    else if ("list" in a) a.list.forEach(walk);
  };
  (e.a ?? []).forEach(walk);
  for (const t of e.then ?? []) out.push(...logLines(t));
  return out;
}

const cr = (creature: number, n: number): LogCreature => ({ cr: creature, n });
/** Who perished: a creature by id, or a line naming them ("creatures" when several stacks lost some). */
const perishLine = (n: number, who: number | LogLine): LogLine => {
  const name = typeof who === "number" ? cr(who, n) : who;
  return n === 1 ? { t: 378, a: [name] } : { t: 379, a: [n, name] };
};
const kills = (n: number, creature: number | LogLine) => (n ? { then: [perishLine(n, creature)] } : {});

/** The log's lines, built: creatures as (creature id, count), spells by id. */
export const LOG = {
  /** 376 / 377, and who perished (378 / 379). */
  damage: (who: number, n: number, dmg: number, killed = 0, victim = 0): LogLine => ({ t: n === 1 ? 376 : 377, a: [cr(who, n), dmg], ...kills(killed, victim) }),
  /** 378 / 379 */
  perish: perishLine,
  /** 45 / 44 */
  goodLuck: (who: number, n: number): LogLine => ({ t: 45, a: [cr(who, n)] }),
  badLuck: (who: number, n: number): LogLine => ({ t: 44, a: [cr(who, n)] }),
  /** 365 / 366: a Dread Knight's Death Blow. */
  doubleDamage: (who: number, n: number): LogLine => ({ t: n === 1 ? 365 : 366, a: [cr(who, n)] }),
  /** 136 / 137 */
  wait: (who: number, n: number): LogLine => ({ t: n === 1 ? 136 : 137, a: [cr(who, n)] }),
  /** 120 / 121 */
  defend: (who: number, n: number, gain: number): LogLine => ({ t: n === 1 ? 120 : 121, a: [cr(who, n), gain] }),
  /** 33 / 34 */
  highMorale: (who: number, n: number): LogLine => ({ t: 33, a: [cr(who, n)] }),
  lowMorale: (who: number, n: number): LogLine => ({ t: 34, a: [cr(who, n)] }),
  /** 412 */
  nextRound: (): LogLine => ({ t: 412 }),
  /** 195 / 196 */
  heroCasts: (hero: string, spell: number, target?: LogCreature): LogLine => (target ? { t: 195, a: [hero, { sp: spell }, target] } : { t: 196, a: [hero, { sp: spell }] }),
  /** 565 / 566 (+ 567) */
  creatureCasts: (who: LogArg, n: number, spell: number, target?: LogCreature): LogLine => ({
    t: n === 1 ? 565 : 566,
    a: [who, { sp: spell }],
    ...(target ? { then: [{ t: 567, a: [target] }] } : {}),
  }),
  /** 189 with 143 / 144 */
  resists: (who: number, n: number): LogLine => ({ t: 189, a: [cr(who, n), { t: n === 1 ? 144 : 143 }] }),
  /** 307 / 306 */
  flees: (hero: string): LogLine => ({ t: 307, a: [hero] }),
  surrenders: (hero: string): LogLine => ({ t: 306, a: [hero] }),
  /** 414 */
  heals: (healer: number, who: number, n: number, amount: number): LogLine => ({ t: 414, a: [cr(healer, 1), cr(who, n), amount] }),
  /** 551-564 and 91: what a creature's blow leaves on its target. */
  aged: (who: number, n: number, hp: number): LogLine => ({ t: n === 1 ? 551 : 552, a: [cr(who, n), hp] }),
  ill: (who: number, n: number): LogLine => ({ t: n === 1 ? 553 : 554, a: [cr(who, n)] }),
  dispelled: (who: number, n: number): LogLine => ({ t: 555, a: [cr(who, n)] }),
  blinded: (who: number, n: number): LogLine => ({ t: 556, a: [cr(who, n)] }),
  stone: (who: number, n: number): LogLine => ({ t: n === 1 ? 558 : 559, a: [cr(who, n)] }),
  bound: (who: number, n: number): LogLine => ({ t: 560, a: [cr(who, n)] }),
  poisoned: (who: number, n: number): LogLine => ({ t: n === 1 ? 561 : 562, a: [cr(who, n)] }),
  paralyzed: (who: number, n: number): LogLine => ({ t: n === 1 ? 563 : 564, a: [cr(who, n)] }),
  ray: (by: number): LogLine => ({ t: 91, a: [by] }),
  /** 373 / 374: Wraiths drain the enemy hero's spell points. */
  manaDrain: (who: number, n: number, hero: string): LogLine => ({ t: n === 1 ? 373 : 374, a: [cr(who, n), hero] }),
  /** A spell on the stack ends (its rounds over, cured, or broken by a blow). */
  wearsOff: (spell: number, who: number): LogLine => ({ t: "wearsOff", a: [{ sp: spell }, cr(who, 2)] }),
  /** 710 / 711 */
  fear: (who: number, n: number): LogLine => ({ t: n === 1 ? 710 : 711, a: [cr(who, n)] }),
  /** 118 / 119 */
  stare: (n: number, victims: number, by: number): LogLine => (n === 1 ? { t: 118, a: [cr(victims, 1), cr(by, 2)] } : { t: 119, a: [n, cr(victims, n), cr(by, 2)] }),
  /** 367, and who perished. */
  thunderbolt: (who: number, killed: number): LogLine => ({ t: 367, a: [cr(who, 2)], ...kills(killed, who) }),
  /** 376 then 378 / 379 for a spell's damage: "The Fireball does 120 damage. 4 Archers perish." */
  spellDamage: (spell: number, total: number, killed: number, who: number | LogLine): LogLine => ({ t: 376, a: [{ sp: spell }, total], ...kills(killed, who) }),
  /** 117 / 116 */
  rise: (n: number, who: number): LogLine => ({ t: n === 1 ? 117 : 116, a: [n, cr(who, n)] }),
  /** One of ours, with who perished after it. */
  ours: (t: OurLine, a: LogArg[] = [], killed = 0, victim = 0): LogLine => ({ t, ...(a.length ? { a } : {}), ...kills(killed, victim) }),
};

/** A battle's whole log as text (the lines of the files the game data was built from, unless `words` gives others). */
export const logTexts = (s: LogNames & { log: LogEntry[] }, words?: LogWords): string[] => s.log.map((e) => logText(s, e, words));

/** Every creature, spell, number and word an entry's lines take (to find the entries that name something). */
export function logArgs(e: LogEntry): LogArg[] {
  if (typeof e === "string") return [];
  const out: LogArg[] = [];
  const walk = (a: LogArg) => {
    if (typeof a === "object" && "t" in a) out.push(...logArgs(a));
    else if (typeof a === "object" && "list" in a) a.list.forEach(walk);
    else out.push(a);
  };
  (e.a ?? []).forEach(walk);
  for (const t of e.then ?? []) out.push(...logArgs(t));
  return out;
}

/** Whether an entry names creature `id`. */
export const logNamesCreature = (e: LogEntry, id: number) => logArgs(e).some((a) => typeof a === "object" && "cr" in a && a.cr === id);
/** Whether an entry is a spell's cast (a hero's, GENRLTXT 195 / 196, or a creature's, 565 / 566), of spell `id` if given. */
export const logIsCast = (e: LogEntry, id?: number) =>
  typeof e === "object" && [195, 196, 565, 566].includes(e.t as number) && (id === undefined || logArgs(e).some((a) => typeof a === "object" && "sp" in a && a.sp === id));
