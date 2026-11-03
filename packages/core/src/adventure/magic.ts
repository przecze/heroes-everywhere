// Spellbooks, mana and mage guilds on the adventure map.
import { spellAllowed } from "./bans.ts";
import { skillFactor } from "../specialty.ts";
import { SPECIAL, hasSpecial } from "./townSpecials.ts";
import { randInt } from "../rng.ts";
import { INTELLIGENCE, MYSTICISM, skillLevel } from "../skills.ts";
import { SPELL, type SpellInfo } from "../spells.ts";
import { TOWNS } from "../townData.ts";
import { B } from "./town.ts";
import type { AdventureState, AdvObject, Hero } from "./types.ts";
import type { World } from "./world.ts";
import { bonus, effectivePrimary } from "./artifacts.ts";

export const SPELLBOOK_COST = 500;
/** Spells per mage guild level 1..5. */
const GUILD_SLOTS = [5, 4, 3, 2, 1];
const FACTION_COLUMN = ["castle", "rampart", "tower", "inferno", "necropolis", "dungeon", "stronghold", "fortress", "conflux"];
/** HotA's towns' odds (SPTRAITS.TXT has columns for the classic nine only): the HotA mod's guildSpells; a spell not listed never comes. */
const HOTA_GUILD_ODDS: Record<string, Record<number, number>> = {
  cove: { 0: 5, 1: 8, 2: 2, 3: 3, 4: 2, 5: 3, 7: 10, 9: 10, 10: 4, 11: 4, 12: 4, 13: 4, 14: 8, 15: 30, 16: 50, 17: 4, 19: 10, 20: 30, 21: 2, 22: 5, 23: 10, 25: 2, 27: 3, 28: 2, 29: 5, 30: 2, 31: 3, 32: 3, 33: 4, 34: 10, 35: 10, 37: 5, 38: 5, 41: 10, 43: 5, 44: 4, 45: 8, 46: 5, 47: 4, 48: 10, 49: 8, 50: 5, 51: 4, 52: 4, 53: 10, 54: 5, 55: 5, 56: 5, 58: 5, 59: 5, 60: 4, 61: 8, 63: 10, 64: 4, 65: 10 },
  factory: { 0: 5, 1: 4, 2: 2, 3: 3, 4: 2, 5: 3, 6: 20, 7: 10, 8: 16, 9: 10, 10: 4, 11: 8, 12: 8, 13: 4, 14: 8, 15: 30, 16: 4, 17: 50, 18: 16, 19: 10, 20: 12, 21: 12, 22: 10, 23: 10, 25: 4, 27: 5, 28: 8, 29: 5, 30: 2, 31: 3, 32: 3, 33: 4, 34: 8, 35: 10, 36: 16, 37: 5, 38: 10, 41: 3, 43: 5, 44: 6, 45: 4, 46: 10, 47: 4, 48: 5, 49: 4, 50: 5, 51: 2, 52: 6, 53: 10, 54: 5, 55: 5, 56: 5, 58: 5, 59: 5, 60: 4, 61: 4, 62: 8, 63: 10, 64: 4, 65: 5, 67: 16, 69: 16 },
  bulwark: { 0: 5, 1: 6, 2: 2, 3: 3, 4: 2, 5: 3, 7: 10, 9: 10, 10: 4, 11: 2, 12: 8, 13: 4, 14: 8, 15: 30, 16: 50, 17: 4, 19: 10, 20: 16, 21: 2, 22: 5, 23: 10, 25: 4, 27: 3, 28: 8, 29: 5, 30: 2, 31: 3, 32: 3, 33: 2, 34: 12, 35: 10, 37: 10, 38: 5, 41: 10, 43: 5, 44: 6, 45: 4, 46: 5, 47: 6, 48: 10, 49: 12, 50: 5, 51: 4, 52: 4, 53: 5, 54: 5, 55: 5, 56: 5, 58: 5, 59: 5, 60: 4, 61: 8, 62: 2, 63: 10, 64: 4, 65: 10 },
};

/** Knowledge x 10, plus Intelligence. */
export function maxMana(h: Hero): number {
  return Math.floor(effectivePrimary(h)[3] * 10 * (1 + INTELLIGENCE[skillLevel(h.skills, "intelligence")] * skillFactor(h, "intelligence")));
}

/** Daily regeneration: 1 point, or Mysticism's share of the maximum (HotA, with its minimums). */
export function manaRegen(h: Hero): number {
  const m = skillLevel(h.skills, "mysticism");
  // The Wizard's Well refills everything every day.
  if (bonus(h, "MANA_PERCENTAGE_REGENERATION") >= 100) return maxMana(h);
  // Mysticism specialists: 5% more of it per hero level.
  return (m ? Math.max([0, 5, 10, 15][m], Math.floor(maxMana(h) * MYSTICISM[m] * skillFactor(h, "mysticism"))) : 1) + bonus(h, "MANA_REGENERATION");
}

export function guildLevel(o: AdvObject): number {
  return [B.MAGE_GUILD_1, B.MAGE_GUILD_1 + 1, B.MAGE_GUILD_1 + 2, B.MAGE_GUILD_1 + 3, B.MAGE_GUILD_1 + 4].filter((b) => o.town?.built.includes(b)).length;
}

/** How many spells a guild level holds (the Tower's Library adds one to each). */
export const guildSlots = (o: AdvObject, level: number) => GUILD_SLOTS[level - 1] + (hasSpecial(o, "tower", SPECIAL.s3) ? 1 : 0);

/** The town's chance for each spell to appear in its guild (SPTRAITS by faction, the HotA towns' configs). */
export function guildOdds(o: AdvObject): (sp: SpellInfo) => number {
  const faction = TOWNS[o.subid]?.faction;
  const col = FACTION_COLUMN.indexOf(faction ?? "");
  const hota = HOTA_GUILD_ODDS[faction ?? ""];
  return (sp) => (col >= 0 ? sp.chance[col] : hota ? (hota[sp.id] ?? 0) : Math.round(sp.chance.reduce((a, b) => a + b, 0) / Math.max(1, sp.chance.length)));
}

/** Whether a spell may be rolled into the guild's ordinary places: allowed on the map and in this town, and
 * (HotA) never Town Portal or Dimension Door where research is on: those come only from research itself. */
export function guildMayRoll(s: AdventureState, o: AdvObject, sp: SpellInfo, odds: number, researching = false): boolean {
  if (odds <= 0 || !spellAllowed(s, sp.id)) return false;
  if (o.town?.possible && !o.town.possible.includes(sp.id)) return false;
  return researching || !(o.town?.research && (sp.id === SPELL.TOWN_PORTAL || sp.id === SPELL.DIMENSION_DOOR));
}

/** Fills the town's guild up to its built level with spells, by the town's odds. */
export function stockGuild(s: AdventureState, spells: SpellInfo[], o: AdvObject) {
  const t = o.town;
  if (!t || !spells.length) return;
  t.guild ??= [];
  const faction = TOWNS[o.subid]?.faction;
  const odds = guildOdds(o);
  // The Aurora Borealis (Conflux's Grail): every spell allowed on the map, on each level the guild has (HotA).
  const aurora = faction === "conflux" && t.built.includes(B.GRAIL);
  const taken = new Set(t.guild.flat());
  for (let level = 1; level <= guildLevel(o); level++) {
    const have: number[] = (t.guild[level - 1] ??= []);
    if (aurora) {
      for (const sp of spells) if (sp.id < 70 && sp.level === level && !have.includes(sp.id) && spellAllowed(s, sp.id)) have.push(sp.id);
      continue;
    }
    // The map's mandatory spells take the first places.
    for (const id of t.mandatory ?? []) if (spells[id]?.level === level && !taken.has(id)) (have.push(id), taken.add(id));
    // The Tower's Library: one more spell on every level.
    while (have.length < guildSlots(o, level)) {
      const pool = spells.filter((sp) => sp.id < 70 && sp.level === level && !taken.has(sp.id) && guildMayRoll(s, o, sp, odds(sp)));
      if (!pool.length) break;
      const total = pool.reduce((a, sp) => a + odds(sp), 0);
      let r = randInt(s, 1, total);
      const pick = pool.find((sp) => (r -= odds(sp)) <= 0) ?? pool[0];
      have.push(pick.id);
      taken.add(pick.id);
    }
  }
}

/** A hero with a spellbook in town learns the guild's spells, up to level 2 + Wisdom. */
export function learnFromGuild(s: AdventureState, w: World, h: Hero, o: AdvObject): number[] {
  if (!h.spells || !o.town) return [];
  stockGuild(s, w.data.spells ?? [], o);
  if (!o.town.guild) return [];
  const limit = 2 + skillLevel(h.skills, "wisdom");
  const learned: number[] = [];
  const open = o.town.researchSlot;
  o.town.guild.forEach((spells, i) => {
    if (i + 1 > limit) return;
    for (const [k, id] of spells.entries()) {
      // A spell still being researched can't be learned until the research is finalized (HotA).
      if (open?.[0] === i + 1 && open[1] === k) continue;
      if (!h.spells!.includes(id)) {
        h.spells!.push(id);
        learned.push(id);
      }
    }
  });
  if (learned.length) s.log.push(`${h.name} learns ${learned.map((id) => w.data.spells?.[id]?.name ?? "a spell").join(", ")}.`);
  return learned;
}
