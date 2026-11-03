// The computer player's diary: its last turns told line by line (what each town built, recruited and hired; where
// each hero went and why, what held it back, which heroes were called home), kept in the saved game with the
// player. A feedback note carries the save, so a complaint about the computer comes with what it saw and did
// (2026-10-28: "next time someone has AI complaints we have telemetry for the full picture"). Writing it changes
// nothing the AI decides. `node packages/sim/src/noteReplay.ts` prints it from a note's replay.
import type { AdventureAction } from "./rules.ts";
import type { AdventureState, Hero } from "./types.ts";
import type { World } from "./world.ts";

/** Turns kept, and lines a turn (a long turn's last lines are dropped, the count said). */
const DAYS = 3;
const LINES = 80;

/** The player's turn begins: a fresh page, the oldest dropped. */
export function diaryOpen(s: AdventureState, player: number, line: string) {
  const p = s.players[player];
  if (!p) return;
  const book = (p.aiDiary ??= []);
  // (The same day again: playAiTurn calls the turn once more after each battle.)
  if (book.at(-1)?.day !== s.day) book.push({ day: s.day, lines: [] });
  while (book.length > DAYS) book.shift();
  diary(s, player, line);
}

/** One line in the player's page for today. */
export function diary(s: AdventureState, player: number, line: string) {
  const page = s.players[player]?.aiDiary?.at(-1);
  if (!page || page.day !== s.day) return;
  if (page.lines.length < LINES) page.lines.push(line);
  else if (page.lines.length === LINES) page.lines.push("(more not kept)");
}

const at = (w: World, i: number) => `${i % w.size},${Math.floor(i / w.size) % w.size}${Math.floor(i / (w.size * w.size)) ? ",u" : ""}`;
const heroName = (s: AdventureState, id: number) => s.heroes[id]?.name ?? `hero ${id}`;
const townName = (s: AdventureState, id: number) => s.objects[id]?.name ?? `town ${id}`;

/** An action the AI took, as a line (the moves are told by the hero's own line: see diaryMove). */
export function diaryAction(s: AdventureState, w: World, player: number, a: AdventureAction) {
  switch (a.type) {
    case "build":
      return diary(s, player, `${townName(s, a.town)}: builds ${a.building}`);
    case "recruit":
      return diary(s, player, `${townName(s, a.town)}: recruits ${a.count} of level ${a.level + 1}${a.upgraded ? " (upgraded)" : ""}`);
    case "hireHero":
      return diary(s, player, `${townName(s, a.town)}: hires a hero`);
    case "recruitDwelling":
      return diary(s, player, `${heroName(s, a.hero)}: recruits ${a.count} at a dwelling`);
    case "transfer":
      if (a.kind === "army") return diary(s, player, `${heroName(s, a.heroes[1])} hands troops to ${heroName(s, a.heroes[0])}`);
      return;
    case "moveStack":
      return diary(s, player, `${townName(s, a.town)}: a stack ${a.from.who} -> ${a.to.who}`);
    case "swapGarrison":
      return diary(s, player, `${townName(s, a.town)}: heroes swap gate and garrison`);
    case "castSpell":
      return diary(s, player, `${heroName(s, a.hero)}: casts spell ${a.spell}`);
    case "trade":
      return diary(s, player, `trades ${a.lots} of resource ${a.to} for ${a.from}`);
    case "move":
    case "endTurn":
      return;
    default:
      return diary(s, player, a.type);
  }
}

/** A hero's step: where to, why, and what it is worth to it there. */
export function diaryMove(s: AdventureState, w: World, h: Hero, target: number, power: number) {
  const o = w.visitBy[target] ? s.objects[w.visitBy[target] - 1] : undefined;
  const guard = w.guardedBy[target] ? s.objects[w.guardedBy[target] - 1] : undefined;
  const what = [o && `${o.town ? "town" : "object"} ${o.type}${o.owner >= 0 ? ` of player ${o.owner}` : ""}`, guard && `past a guard of ${guard.amount} creature ${guard.subid}`, w.heroAt[target] && `hero ${heroName(s, w.heroAt[target] - 1)}`].filter(Boolean).join(", ");
  diary(s, h.owner, `${h.name} (${Math.round(power)}) at ${at(w, w.index(h.x, h.y, h.z))} -> ${at(w, target)}: ${h.aiReason ?? "value"}${what ? `, ${what}` : ""}`);
}

/** A hero's day ending without a move, and why. */
export function diaryStays(s: AdventureState, w: World, h: Hero, why: string) {
  diary(s, h.owner, `${h.name} stays at ${at(w, w.index(h.x, h.y, h.z))}: ${why}`);
}

/** The diary as text, newest turn last. */
export function diaryText(s: AdventureState, player: number): string {
  return (s.players[player]?.aiDiary ?? []).map((d) => `day ${d.day}:\n  ${d.lines.join("\n  ")}`).join("\n");
}
