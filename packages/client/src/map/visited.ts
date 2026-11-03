// The visited marks the original adds to an object's name on the status bar and in its popup
// (VCMI's getHoverText): "(Visited)" / "(Not visited)", a shrine's or Witch Hut's lesson.
import { type AdvObject, type Hero, type Player, SKILL_NAMES, rewardVisited, weekIndex } from "@heroes/core";

/** The original's words (GENRLTXT 352-357, VCMI's numbering); English stand-ins until they load. */
export type VisitedWords = { visited: string; notVisited: string; shrineLearn: string; shrineKnown: string; hutLearn: string; hutKnown: string };
export const VISITED_WORDS: VisitedWords = {
  visited: "(Visited)",
  notVisited: "(Not visited)",
  shrineKnown: "(Already learned)",
  shrineLearn: "(Learn %s)",
  hutLearn: "(Learn %s)",
  hutKnown: "(Already learned)",
};
/** GENRLTXT lines of the words above. */
export const VISITED_LINES: Record<keyof VisitedWords, number> = { visited: 352, notVisited: 353, shrineKnown: 354, shrineLearn: 355, hutLearn: 356, hutKnown: 357 };

/** Each hero gets these once: marked for the selected hero (Arena, Marletto Tower, Garden of Revelation, Library of Enlightenment, Mercenary Camp, School of Magic, Star Axis, Learning Stone, Tree of Knowledge, School of War). */
const ONCE_PER_HERO = new Set([4, 23, 32, 41, 47, 51, 61, 100, 102, 107]);

export type VisitedContext = {
  /** The player looking. */
  player?: Player;
  playerId: number;
  /** The selected hero, if any. */
  hero?: Hero;
  spellName?: (id: number) => string;
  /** Today, for the weekly objects' marks. */
  day?: number;
  words?: VisitedWords;
};

/** Refilled each week (Windmill, Water Wheel, Mystical Garden, Magic Spring): marked for the player who emptied them this week. */
const WEEKLY = new Set([48, 55, 109, 112]);

/** The mark after an object's name ("" for none). */
export function visitedMark(o: AdvObject, c: VisitedContext): string {
  const words = c.words ?? VISITED_WORDS;
  const mark = (v: boolean) => (v ? words.visited : words.notVisited);
  // Obelisks and Keymaster's Tents: whether this player has been there, hero or not.
  if (o.type === 57) return mark(!!c.player?.obelisks?.includes(o.id));
  if (o.type === 10) return mark(!!c.player?.keys?.includes(o.subid));
  // A creature bank (Dragon Utopia, Crypt...) once plundered, by anyone (VCMI's CBank::getHoverText): only then marked.
  if (o.bank?.cleared) return words.visited;
  // (2026-10-28: "I can't see whether I've visited a Windmill this week".)
  // (2026-10-31: one who found it emptied by someone else this week knows too.)
  if (WEEKLY.has(o.type) && c.day !== undefined) return mark(o.visitedWeek === weekIndex(c.day) && (o.weekVisitor === c.playerId || !!o.weekSeen?.includes(c.playerId)));
  if (ONCE_PER_HERO.has(o.type)) return c.hero ? mark(!!o.visitors?.includes(c.hero.id)) : "";
  // A Witch Hut or shrine names its lesson once this player has been, and whether the hero has it.
  const scouted = o.scouted?.includes(c.playerId);
  if (o.type === 113 && scouted && o.data?.skill !== undefined) {
    const sk = Number(o.data.skill);
    const learn = words.hutLearn.replace("%s", SKILL_NAMES[sk] ?? "");
    return c.hero?.skills?.some(([id]) => id === sk) ? `${learn} ${words.hutKnown}` : learn;
  }
  if (o.type >= 88 && o.type <= 90 && scouted && o.data?.spell !== undefined) {
    const id = Number(o.data.spell);
    const learn = words.shrineLearn.replace("%s", c.spellName?.(id) ?? "");
    return c.hero?.spells?.includes(id) ? `${learn} ${words.shrineKnown}` : learn;
  }
  // Every other configurable object (HotA's warehouses, huts, springs, the Gazebo...) by how often it gives
  // (2026-11-02 12:49, holding a Warehouse of Gold: "Mark if visited").
  const had = c.day === undefined ? undefined : rewardVisited(c.day, o, c.playerId, c.hero);
  return had === undefined ? "" : mark(had);
}
