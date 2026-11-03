// HotA's spell research (heroes.thelazy.net "Spell research", the HotA changelog): in a town whose map
// allows it, a guild slot's spell can be swapped for 1000 gold and 2 x the spell level of mercury,
// sulfur, crystals and gems, once a day per town. The old spell goes, two new ones are offered (one on
// level 5, taken at once), and the slot stays open (its spell can't be learned) until the research is
// finalized, which makes the slot permanent. Only one slot per town is open at a time; mandatory
// spells can't be replaced. Spells shown before come back only once every other candidate has been
// shown. Town Portal / Dimension Door never roll into ordinary places where research is on, and the
// third attempt at their level is sure to offer them.
import { Refusal } from "../refusal.ts";
import { randInt } from "../rng.ts";
import { SPELL, type SpellInfo } from "../spells.ts";
import { guildLevel, guildMayRoll, guildOdds } from "./magic.ts";
import { TOWNS } from "../townData.ts";
import { B } from "./town.ts";
import type { AdventureState, AdvObject } from "./types.ts";

/** Resources per research of a spell of this level: wood, mercury, ore, sulfur, crystal, gems, gold. */
export const researchCost = (level: number): number[] => [0, 2 * level, 0, 2 * level, 2 * level, 2 * level, 1000];

const auroraGuild = (o: AdvObject) => TOWNS[o.subid]?.faction === "conflux" && !!o.town?.built.includes(B.GRAIL);

/** Why this slot can't be researched now (null when it can). */
export function researchRefusal(s: AdventureState, o: AdvObject, level: number, slot: number): string | null {
  const t = o.town;
  if (!t?.research || auroraGuild(o)) return "Spell research is not allowed in this town.";
  const id = t.guild?.[level - 1]?.[slot];
  if (id === undefined || level > guildLevel(o)) return "There is no spell there.";
  const open = t.researchSlot;
  const here = open?.[0] === level && open[1] === slot;
  if (t.researchOffer?.length) return here ? null : "Choose the researched spell first.";
  if (open && !here) return "Finalize the research in progress first.";
  if (!here && t.mandatory?.includes(id)) return "This spell can't be replaced.";
  if (t.researchFixed?.includes(`${level}:${slot}`)) return "This spell has been finalized.";
  if (t.researchDay === s.day) return "Only one spell can be researched in a town each day.";
  const res = s.players[o.owner]?.resources ?? [];
  if (researchCost(level).some((n, r) => (res[r] ?? 0) < n)) return "You don't have enough resources.";
  return null;
}

/** The spells research could bring to this level, best first by the town's odds. */
function candidates(s: AdventureState, spells: SpellInfo[], o: AdvObject, level: number, seen: Set<number>): SpellInfo[] {
  const t = o.town!;
  const inGuild = new Set(t.guild?.flat() ?? []);
  const odds = guildOdds(o);
  return spells.filter((sp) => sp.id < 70 && sp.level === level && !inGuild.has(sp.id) && !seen.has(sp.id) && guildMayRoll(s, o, sp, odds(sp), true));
}

/** Pays, removes the slot's spell and rolls the new ones (level 5: put in at once). Returns the offer. */
export function startResearch(s: AdventureState, spells: SpellInfo[], o: AdvObject, level: number, slot: number): number[] {
  const t = o.town!;
  const why = researchRefusal(s, o, level, slot);
  if (why) throw new Refusal(why);
  if (t.researchOffer?.length) return t.researchOffer;
  const res = s.players[o.owner].resources;
  researchCost(level).forEach((n, r) => (res[r] -= n));
  t.researchDay = s.day;
  t.researchSlot = [level, slot];
  const old = t.guild![level - 1][slot];
  const seen = new Set(t.researchSeen ?? []);
  seen.add(old);
  const count = ((t.researchCount ??= [0, 0, 0, 0, 0])[level - 1] = (t.researchCount[level - 1] ?? 0) + 1);
  let pool = candidates(s, spells, o, level, seen);
  // Every candidate shown: the old ones come back (still not the ones in the guild or just removed).
  if (!pool.length) {
    for (const sp of spells) if (sp.level === level) seen.delete(sp.id);
    seen.add(old);
    pool = candidates(s, spells, o, level, seen);
  }
  const want = level === 5 ? 1 : 2;
  const offer: number[] = [];
  // The third attempt on Town Portal's / Dimension Door's level is sure to offer it.
  const sure = level === spells[SPELL.TOWN_PORTAL]?.level ? SPELL.TOWN_PORTAL : level === spells[SPELL.DIMENSION_DOOR]?.level ? SPELL.DIMENSION_DOOR : -1;
  if (count === 3 && pool.some((sp) => sp.id === sure)) offer.push(sure);
  const odds = guildOdds(o);
  while (offer.length < want) {
    const left = pool.filter((sp) => !offer.includes(sp.id));
    if (!left.length) break;
    let r = randInt(s, 1, left.reduce((a, sp) => a + Math.max(1, odds(sp)), 0));
    offer.push((left.find((sp) => (r -= Math.max(1, odds(sp))) <= 0) ?? left[0]).id);
  }
  for (const id of offer) seen.add(id);
  t.researchSeen = [...seen];
  // Nothing new to offer: the old spell stays.
  if (!offer.length) offer.push(old);
  if (offer.length === 1) {
    t.guild![level - 1][slot] = offer[0];
    t.researchOffer = undefined;
  } else t.researchOffer = offer;
  return offer;
}

/** Puts the chosen one of the offered spells into the open slot. */
export function pickResearch(o: AdvObject, spell: number) {
  const t = o.town!;
  if (!t.researchOffer?.includes(spell) || !t.researchSlot) throw new Refusal("That spell isn't on offer.");
  const [level, slot] = t.researchSlot;
  t.guild![level - 1][slot] = spell;
  t.researchOffer = undefined;
}

/** Ends the open research: the slot's spell can be learned and the slot is permanent. */
export function finalizeResearch(o: AdvObject) {
  const t = o.town!;
  if (!t.researchSlot) throw new Refusal("No research is in progress.");
  if (t.researchOffer?.length) throw new Refusal("Choose the researched spell first.");
  (t.researchFixed ??= []).push(t.researchSlot.join(":"));
  t.researchSlot = undefined;
}
