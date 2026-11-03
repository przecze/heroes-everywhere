// The common visitable map objects (values per heroes.thelazy.net). Returns null for objects
// handled elsewhere (towns, mines, banks, dwellings, teleports...).
import { withLearning } from "../specialty.ts";
import { skillAllowed, spellAllowed } from "./bans.ts";
import { randInt } from "../rng.ts";
import { MAX_SKILLS, SKILL_NAMES, learnSkill, skillLevel } from "../skills.ts";
import { giveArtifact, giveScroll, heroSpells, randomArtifactPool } from "./artifacts.ts";
import { experienceForLevel } from "./experience.ts";
import { maxMana } from "./magic.ts";
import { type AdventureState, type AdvObject, type ArmySlot, type Hero, RESOURCE_NAMES, type Component, type TextRef } from "./types.ts";
import { type World, Terrain, reveal, revealOwned } from "./world.ts";
import { presetOf } from "./rewardable.ts";
import { weekIndex } from "../calendar.ts";
import { lineText } from "../gameLines.ts";

export type ObjectEvent =
  | { e: "visit"; hero: number; object: number; message: string; text?: TextRef; components?: Component[] }
  | { e: "offer"; hero: number; object: number; kind: "confirm"; cost: number; text: string; textRef?: TextRef; components?: Component[] }
  | { e: "pickup"; hero: number; object: number; resource: number; amount: number; /** The map gave the pile its own text: shown as a window (the message that follows), not in the info box. */ own?: boolean };

/** What the rules module lends us (to avoid an import cycle). */
export interface ObjectCtx {
  gainExperience(h: Hero, xp: number): string[];
  /** Fight the object's guards; the reward follows a victory (see `boxReward`). */
  fightGuards(h: Hero, o: AdvObject, guards: { creature: number; count: number }[], name: string): ObjectEvent[] | unknown[];
  addToArmy(h: Hero, creature: number, count: number): boolean;
}

const week = (s: AdventureState) => weekIndex(s.day);
const PRIMARY = ["Attack", "Defense", "Power", "Knowledge"];

/** The map file's data for this object (rewards, skills, spells...), found by position. */
/** What a Cartographer's maps cost (HotA's price). */
export const CARTOGRAPHER_PRICE = 10000;

/** Does a Cartographer of this kind (0 sea, 1 land, 2 underground) show tile `i`? */
/** The level a hero needs to enter the Library of Enlightenment: 10, less with Diplomacy (8, 6, 4). */
export function libraryLevel(h: Hero): number {
  return [10, 8, 6, 4][skillLevel(h.skills, "diplomacy")];
}

export function cartographerShows(w: World, kind: number, i: number): boolean {
  const z = Math.floor(i / (w.size * w.size));
  const water = w.map.tiles[i]?.terrain === Terrain.WATER;
  return (kind === 0 && water) || (kind === 1 && z === 0 && !water) || (kind === 2 && z === 1);
}

export function mapData(w: World, o: AdvObject): Record<string, unknown> {
  // (Two can share a tile, a hero standing on an event: the same kind first, else a random one made this.)
  const here = w.mapObjectsAt(o.x, o.y, o.z);
  const mo = here.find((m) => m.id === o.type) ?? here[0];
  return (mo?.data as Record<string, unknown>) ?? {};
}

/** A map garrison's troops: the map's on the first look, then its own. */
export function mapGarrisonArmy(w: World, o: AdvObject): (ArmySlot | null)[] {
  const army = (mapData(w, o).army as { slot: number; creature: number; count: number }[] | undefined) ?? [];
  return (o.army ??= Array.from({ length: 7 }, (_, slot) => army.find((a) => a.slot === slot) ?? null).map((a) => (a ? { creature: a.creature, count: a.count } : null)));
}

/** Morale / luck / movement bonuses that last until the hero's next battle. */
function tempBonus(h: Hero, o: AdvObject, morale: number, luck: number): boolean {
  h.temp ??= { morale: 0, luck: 0, from: [] };
  if (h.temp.from.includes(o.type)) return false;
  h.temp.from.push(o.type);
  h.temp.morale += morale;
  h.temp.luck += luck;
  return true;
}

/** A visit message: English, and the original's ADVEVENT line (with its %s / %d) and reward pictures. */
/** ADVEVENT's line `adv` as the message (its words from the player's files: gameLines.ts). */
const sayLine = (h: Hero, o: AdvObject, adv: number, components?: Component[], args?: (string | number)[], more?: (string | TextRef)[]): ObjectEvent[] =>
  say(h, o, lineText({ file: "advevent", id: adv, ...(args ? { args } : {}), ...(more ? { more } : {}) }), adv, components, args, more);
const say = (h: Hero, o: AdvObject, message: string, adv?: number, components?: Component[], args?: (string | number)[], more?: (string | TextRef)[]): ObjectEvent[] => [
  {
    e: "visit",
    hero: h.id,
    object: o.id,
    message,
    ...(adv !== undefined ? { text: { file: "advevent" as const, id: adv, ...(args ? { args } : {}), ...(more ? { more } : {}) } } : {}),
    ...(components?.length ? { components } : {}),
  },
];
const adv = (id: number): TextRef => ({ file: "advevent", id });
const once = (h: Hero, o: AdvObject) => {
  if (o.visitors?.includes(h.id)) return false;
  (o.visitors ??= []).push(h.id);
  return true;
};

/** The hero's player now knows what the object holds (its map name says so from then on). */
const scout = (h: Hero, o: AdvObject) => {
  if (!o.scouted?.includes(h.owner)) (o.scouted ??= []).push(h.owner);
};

/** Rewards of a Pandora's Box or event (after its guards, if any). */
export function boxReward(s: AdventureState, w: World, ctx: ObjectCtx, h: Hero, data: Record<string, unknown>, pictures: Component[] = []): string[] {
  const out: string[] = [];
  const p = s.players[h.owner];
  const res = (data.resources as number[] | undefined) ?? [];
  res.forEach((n, i) => {
    if (!n) return;
    p.resources[i] = Math.max(0, p.resources[i] + n);
    out.push(`${n > 0 ? "+" : ""}${n} ${RESOURCE_NAMES[i]}`);
    pictures.push({ kind: "resource", id: i, amount: n });
  });
  const prim = (data.primary as number[] | undefined) ?? [];
  prim.forEach((n, i) => {
    if (!n) return;
    h.primary[i] += n;
    out.push(`+${n} ${PRIMARY[i]}`);
    pictures.push({ kind: "primary", id: i, amount: n });
  });
  if (data.mana) {
    h.mana = Math.max(0, (h.mana ?? 0) + Number(data.mana));
    out.push(`${Number(data.mana) > 0 ? "+" : ""}${data.mana} spell points`);
    pictures.push({ kind: "mana", amount: Number(data.mana) });
  }
  if (data.morale || data.luck) {
    h.temp ??= { morale: 0, luck: 0, from: [] };
    h.temp.morale += Number(data.morale ?? 0);
    h.temp.luck += Number(data.luck ?? 0);
    if (data.morale) pictures.push({ kind: "morale", amount: Number(data.morale) });
    if (data.luck) pictures.push({ kind: "luck", amount: Number(data.luck) });
  }
  for (const sk of (data.skills as { skill: number; level: number }[] | undefined) ?? []) {
    learnSkill(h, sk.skill, sk.level);
    out.push(`${SKILL_NAMES[sk.skill]}`);
    pictures.push({ kind: "skill", id: sk.skill, level: Math.max(1, Math.min(3, sk.level)) });
  }
  for (const a of (data.artifacts as number[] | undefined) ?? []) {
    giveArtifact(h, w.data.artifacts, a);
    out.push(w.data.artifacts[a]?.name ?? "an artifact");
    pictures.push({ kind: "artifact", id: a });
  }
  // (HotA: spell scrolls with their spells.)
  for (const sp of (data.scrolls as number[] | undefined) ?? []) {
    giveScroll(h, w.data.artifacts, sp);
    out.push(`a scroll of ${w.data.spells?.[sp]?.name ?? "magic"}`);
    pictures.push({ kind: "artifact", id: 1 });
  }
  for (const sp of (data.spells as number[] | undefined) ?? []) {
    if (h.spells && !h.spells.includes(sp)) h.spells.push(sp);
    if (h.spells) out.push(w.data.spells?.[sp]?.name ?? "a spell");
    pictures.push({ kind: "spell", id: sp });
  }
  for (const c of (data.creatures as { creature: number; count: number }[] | undefined) ?? []) {
    if (c.creature >= 0 && ctx.addToArmy(h, c.creature, c.count)) {
      out.push(`${c.count} ${w.creatures[c.creature]?.plural ?? "creatures"}`);
      pictures.push({ kind: "creature", id: c.creature, amount: c.count });
    }
  }
  // HotA: movement given, taken, emptied, set or topped up (to at most the day's full).
  const move = data.movement as { mode: number; amount: number } | undefined;
  if (move) {
    const before = h.movement;
    h.movement = [before + move.amount, Math.max(0, before - move.amount), 0, move.amount, Math.max(before, Math.min(h.maxMovement, before + move.amount))][move.mode] ?? before;
    if (h.movement !== before) out.push(`${h.movement > before ? "+" : ""}${h.movement - before} movement points`);
  }
  if (data.experience) {
    pictures.push({ kind: "experience", amount: withLearning(h, Number(data.experience)) });
    out.push(...[`${withLearning(h, Number(data.experience))} experience`, ...ctx.gainExperience(h, Number(data.experience))]);
  }
  return out;
}

/**
 * HotA's objects that ask first: a human gets the question (the original's line and what it gives);
 * the AI just takes it. Returns the question, or null to go ahead.
 */
function askFirst(s: AdventureState, h: Hero, o: AdvObject, confirmed: boolean, adv: number, components: Component[] = [], args?: (string | number)[]): ObjectEvent[] | null {
  if (confirmed || s.players[h.owner]?.controller !== "human") return null;
  h.offer = { object: o.id, kind: "confirm", cost: 0 };
  const textRef: TextRef = { file: "advevent", id: adv, ...(args ? { args } : {}) };
  return [{ e: "offer", hero: h.id, object: o.id, kind: "confirm", cost: 0, text: lineText(textRef), textRef, components }];
}

export function visitObject(s: AdventureState, w: World, ctx: ObjectCtx, h: Hero, o: AdvObject, confirmed = false): ObjectEvent[] | null {
  const p = s.players[h.owner];
  switch (o.type) {
    // ---- until the next battle ---------------------------------------------
    case 96: // Temple: +1 morale, +2 on the 7th day
      return tempBonus(h, o, s.day % 7 === 0 ? 2 : 1, 0)
        ? sayLine(h, o, 140, [{ kind: "morale", amount: s.day % 7 === 0 ? 2 : 1 }])
        : sayLine(h, o, 141);
    case 28: // Faerie Ring
      return tempBonus(h, o, 0, 1) ? sayLine(h, o, 49, [{ kind: "luck", amount: 1 }]) : sayLine(h, o, 50);
    case 11: // Buoy
      return tempBonus(h, o, 1, 0) ? sayLine(h, o, 21, [{ kind: "morale", amount: 1 }]) : sayLine(h, o, 22);
    case 52: // Mermaids
      return tempBonus(h, o, 0, 1) ? sayLine(h, o, 83, [{ kind: "luck", amount: 1 }]) : sayLine(h, o, 82);
    case 94: {
      // Stables: +400 land movement for the rest of the week; Cavaliers become Champions.
      let upgraded = 0;
      for (const a of h.army) if (a?.creature === 10) [a.creature, upgraded] = [11, upgraded + a.count];
      const week = weekIndex(s.day);
      if (h.stablesWeek === week) return say(h, o, upgraded ? `Your ${upgraded} Cavaliers train as Champions.` : "Your horses are already fresh.", upgraded ? 138 : 136);
      h.stablesWeek = week;
      // HotA: +300 for the rest of the week.
      h.movement += 300;
      return sayLine(h, o, upgraded ? 138 : 137);
    }
    case 59: // Ocean Bottle
    case 91: // Sign
    {
      // A bottle is gone once read (heroes.thelazy.net Ocean Bottle); a sign stays.
      if (o.type === 59) {
        o.removed = true;
        w.refresh(s);
      }
      if (o.data?.message) return say(h, o, String(o.data.message));
      // No words of the map's own: one of the original's sign lines (RANDSIGN), the same each visit.
      const line = typeof o.data?.sign === "number" ? o.data.sign : ((o.data ??= {}).sign = randInt(s, 0, 24));
      return [{ e: "visit", hero: h.id, object: o.id, message: o.type === 91 ? "The sign is too weathered to read." : "The bottle is empty.", text: { file: "randsign", id: line as number } }];
    }
    case 27: // Eye of the Magi
      return sayLine(h, o, 48);
    case 80: // Sanctuary
      return sayLine(h, o, 114);
    case 15: {
      // Cover of Darkness: the land around is hidden from everyone else.
      for (const other of s.players) {
        if (other.color === h.owner || !other.revealed.length || (p.team !== undefined && other.team === p.team)) continue;
        for (let dy = -20; dy <= 20; dy++)
          for (let dx = -20; dx <= 20; dx++) {
            if (dx * dx + dy * dy > 420) continue;
            const i = w.index(o.x + dx, o.y + dy, o.z);
            if (i >= 0) other.revealed[i >> 5] &= ~(1 << (i & 31));
          }
        // Not what their own heroes, towns and mines look at.
        revealOwned(s, w, other.color);
      }
      return sayLine(h, o, 31);
    }
    case 14: // Swan Pond: +2 luck, but the day's movement is spent
      if (!tempBonus(h, o, 0, 2)) return sayLine(h, o, 30);
      h.movement = 0;
      return sayLine(h, o, 29, [{ kind: "luck", amount: 2 }]);
    case 30: {
      // Fountain of Fortune: luck -1..+3
      const roll = [-1, 1, 2, 3][randInt(s, 0, 3)];
      return tempBonus(h, o, 0, roll)
        ? sayLine(h, o, 55, [{ kind: "luck", amount: roll }])
        : sayLine(h, o, 56);
    }
    case 31: // Fountain of Youth: +1 morale, +400 movement
    case 110: // Watering Hole
      if (!tempBonus(h, o, 1, 0)) return sayLine(h, o, o.type === 31 ? 58 : 167);
      h.movement += 400;
      return sayLine(h, o, o.type === 31 ? 57 : 166, [{ kind: "morale", amount: 1 }]);
    case 56: // Oasis: +1 morale, +800 movement
      if (!tempBonus(h, o, 1, 0)) return sayLine(h, o, 94);
      h.movement += 800;
      return sayLine(h, o, 95, [{ kind: "morale", amount: 1 }]);
    case 64: // Rally Flag: +1 morale, +1 luck, +400 movement
      // Again before the battle: the speech (ADVEVENT 110) still names morale and luck, so its pictures stay; only the movement is not given twice.
      if (!tempBonus(h, o, 1, 1)) return sayLine(h, o, 110, [{ kind: "morale", amount: 1 }, { kind: "luck", amount: 1 }]);
      h.movement += 400;
      return sayLine(h, o, 111, [{ kind: "morale", amount: 1 }, { kind: "luck", amount: 1 }]);
    case 38: {
      // Idol of Fortune: luck on odd days, morale on even days, both on the 7th
      const d = ((s.day - 1) % 7) + 1;
      const morale = d % 2 === 0 || d === 7 ? 1 : 0;
      const luck = d % 2 === 1 ? 1 : 0;
      const ok = tempBonus(h, o, morale, luck);
      const comps: Component[] = [...(morale ? [{ kind: "morale" as const, amount: 1 }] : []), ...(luck ? [{ kind: "luck" as const, amount: 1 }] : [])];
      return ok ? sayLine(h, o, 62, comps) : sayLine(h, o, 63);
    }
    case 108: {
      // Warrior's Tomb (heroes.thelazy.net): asked first; searched, an artifact the first time (30%
      // treasure, 50% minor, 15% major, 5% relic), and -3 morale every time.
      const ask = askFirst(s, h, o, confirmed, 161);
      if (ask) return ask;
      tempBonus(h, o, -3, 0);
      if (o.visitedWeek === -1) return sayLine(h, o, 163, [{ kind: "morale", amount: -3 }]);
      o.visitedWeek = -1;
      // (What the map chose: its artifact, else a minor, major or relic one.)
      const pre = presetOf(w, o);
      const roll = pre ? [1, 50, 90, 100][pre.content] ?? 1 : randInt(s, 1, 100);
      const id = pre?.artifact ?? randomArtifact(s, w, roll <= 30 ? "T" : roll <= 80 ? "N" : roll <= 95 ? "J" : "R");
      if (id >= 0) giveArtifact(h, w.data.artifacts, id);
      return sayLine(h, o, id >= 0 ? 162 : 163, [...(id >= 0 ? [{ kind: "artifact" as const, id }] : []), { kind: "morale", amount: -3 }], [w.data.artifacts[id]?.name ?? ""]);
    }
    case 92: {
      // Sirens: 30% of each stack, rounded up, drowns (one-creature stacks don't), for experience; a hero
      // is lured once, whichever Sirens it was (heroes.thelazy.net Sirens; VCMI's CGSirens).
      if (s.objects.some((x) => x.type === 92 && x.visitors?.includes(h.id))) return sayLine(h, o, 133);
      once(h, o);
      let xp = 0;
      for (const a of h.army) {
        if (!a || a.count === 1) continue;
        const lost = Math.ceil(a.count * 0.3);
        a.count -= lost;
        xp += lost * (w.creatures[a.creature]?.hp ?? 0);
      }
      if (!xp) return sayLine(h, o, 134);
      return say(h, o, ["Some of your troops are lured by the sirens.", ...ctx.gainExperience(h, xp)].join(" "), 132, [{ kind: "experience", amount: withLearning(h, xp) }], [withLearning(h, xp)]);
    }

    // ---- once per hero ---------------------------------------------------------
    case 113: {
      // Witch Hut: teaches one secondary skill at Basic; by default never Leadership, Necromancy or
      // Runes (heroes.thelazy.net Witch Hut; HotA 1.3.0 lifted the original's "numbers up to 16" limit).
      const data = mapData(w, o);
      o.data ??= {};
      if (o.data.skill === undefined) {
        const allowed = (data.skills as number[] | undefined)?.length ? (data.skills as number[]) : Array.from({ length: 29 }, (_, i) => i).filter((i) => i !== 6 && i !== 12 && skillAllowed(s, i));
        o.data.skill = allowed[randInt(s, 0, allowed.length - 1)];
      }
      const sk = Number(o.data.skill);
      scout(h, o);
      if ((h.skills ?? []).some(([id]) => id === sk)) return sayLine(h, o, 172, [], [SKILL_NAMES[sk]]);
      if ((h.skills?.length ?? 0) >= MAX_SKILLS) return sayLine(h, o, 173, [], [SKILL_NAMES[sk]]);
      const ask = askFirst(s, h, o, confirmed, 171, [{ kind: "skill", id: sk, level: 1 }], [SKILL_NAMES[sk]]);
      if (ask) return ask;
      learnSkill(h, sk, 1);
      // (A player who said yes saw the offer: no second window with the same words.)
      if (confirmed) return [];
      return sayLine(h, o, 171, [{ kind: "skill", id: sk, level: 1 }], [SKILL_NAMES[sk]]);
    }
    case 88:
    case 89:
    case 90: {
      // Shrines: a spell of level 1 / 2 / 3 (level 3 needs Wisdom); HotA's Shrine of Magic Mystery (88:3) is a rewardable (rewardableData.ts)
      const level = o.type - 87;
      o.data ??= {};
      if (o.data.spell === undefined) {
        const given = Number(mapData(w, o).spell ?? -1);
        const pool = (w.data.spells ?? []).filter((sp) => sp.id >= 10 && sp.id < 70 && sp.level === level && sp.id !== 57 && spellAllowed(s, sp.id));
        o.data.spell = given >= 0 && given < 70 ? given : (pool[randInt(s, 0, pool.length - 1)]?.id ?? 15);
      }
      const id = Number(o.data.spell);
      const name = w.data.spells?.[id]?.name ?? "a spell";
      scout(h, o);
      // The shrine's line, the spell's name, then why not (VCMI's shrine.json).
      const line = 126 + level;
      const spell: Component[] = [{ kind: "spell", id }];
      if (!h.spells) return sayLine(h, o, line, spell, undefined, [` {${name}}. `, adv(131)]);
      if (level === 3 && !skillLevel(h.skills, "wisdom")) return sayLine(h, o, line, spell, undefined, [` {${name}}. `, adv(130)]);
      if (heroSpells(h, w.data.spells ?? [])?.includes(id)) return sayLine(h, o, line, spell, undefined, [` {${name}}. `, adv(174)]);
      h.spells.push(id);
      return sayLine(h, o, line, spell, undefined, [` {${name}}.`]);
    }
    case 81: {
      // Scholar: +1 primary skill, a secondary skill or a spell (decided once, so the question shows it)
      const data = mapData(w, o);
      o.data ??= {};
      if (o.data.kind === undefined) {
        o.data.kind = typeof data.kind === "number" && data.kind >= 0 ? data.kind : randInt(s, 0, 1);
        o.data.value = o.data.kind === 0 ? (typeof data.value === "number" && data.value < 4 ? data.value : randInt(s, 0, 3)) : typeof data.value === "number" ? data.value : pickAllowedSkill(s);
      }
      const kind = Number(o.data.kind);
      const value = Number(o.data.value);
      const skillOk = kind === 1 && (h.skills?.length ?? 0) < MAX_SKILLS;
      const reward: Component = kind === 0 ? { kind: "primary", id: value, amount: 1 } : skillOk ? { kind: "skill", id: value, level: Math.min(3, ((h.skills ?? []).find(([id]) => id === value)?.[1] ?? 0) + 1) } : { kind: "primary", id: 3, amount: 1 };
      const ask = askFirst(s, h, o, confirmed, 115, [reward]);
      if (ask) return ask;
      o.removed = true;
      if (reward.kind === "primary") {
        h.primary[reward.id]++;
        if (confirmed) return [];
        return sayLine(h, o, 115, [reward]);
      }
      learnSkill(h, reward.id, reward.kind === "skill" ? reward.level : 1);
      if (confirmed) return [];
      return sayLine(h, o, 115, [reward]);
    }
    case 102: {
      // Tree of Knowledge: a free level (some trees ask 2000 gold or 10 gems)
      if (o.visitors?.includes(h.id)) return sayLine(h, o, 147);
      const kind = presetOf(w, o)?.content ?? o.subid;
      const price = kind === 1 ? [6, 2000] : kind === 2 ? [5, 10] : null;
      if (price && p.resources[price[0]] < price[1])
        return sayLine(h, o, price[0] === 6 ? 150 : 152);
      // a paying tree asks first, as the original's yes / no window
      const ask = price && askFirst(s, h, o, confirmed, price[0] === 6 ? 149 : 151, [{ kind: "resource", id: price[0], amount: price[1] }]);
      if (ask) return ask;
      once(h, o);
      if (price) p.resources[price[0]] -= price[1];
      const need = Math.max(0, experienceForLevel(h.level + 1) - h.experience);
      // (A paid tree said its words in the question: the level-up window follows alone.)
      if (price) return ctx.gainExperience(h, need), [];
      return say(h, o, [`${h.name} gains a level.`, ...ctx.gainExperience(h, need)].join(" "), [148, 149, 151][kind] ?? 148, [{ kind: "experience", amount: need }]);
    }
    case 41: {
      // Library of Enlightenment: +2 to every primary skill from level 10 (less with Diplomacy)
      const minLevel = libraryLevel(h);
      if (h.level < minLevel) return sayLine(h, o, 68);
      if (!once(h, o)) return sayLine(h, o, 67);
      for (let i = 0; i < 4; i++) h.primary[i] += 2;
      return sayLine(h, o, 66, [0, 1, 2, 3].map((id) => ({ kind: "primary" as const, id, amount: 2 })));
    }

    // ---- daily / weekly ----------------------------------------------------------
    case 49: // Magic Well: spell points back to full, one drink a day from any well
      if (h.wellDay === s.day) return sayLine(h, o, 78);
      if ((h.mana ?? 0) >= maxMana(h)) return sayLine(h, o, 79);
      h.mana = maxMana(h);
      h.wellDay = s.day;
      return sayLine(h, o, 77, [{ kind: "mana", amount: maxMana(h) }]);
    case 48: // Magic Spring: double spell points, once a week
      if (o.visitedWeek === week(s)) return sawEmpty(o, h.owner), sayLine(h, o, 75);
      if ((h.mana ?? 0) >= 2 * maxMana(h)) return sayLine(h, o, 76);
      o.visitedWeek = week(s);
      o.weekVisitor = h.owner;
      o.weekSeen = undefined;
      h.mana = Math.max(h.mana ?? 0, 2 * maxMana(h));
      return sayLine(h, o, 74, [{ kind: "mana", amount: 2 * maxMana(h) }]);

    // ---- pickups -----------------------------------------------------------------
    case 39: {
      // Lean To: 1-5 of a resource (not gold) for the first visitor; it stays, abandoned (VCMI's
      // leanTo: visitMode once; heroes.thelazy.net Lean To).
      if (o.visitedWeek === -1) return sayLine(h, o, 65);
      o.visitedWeek = -1;
      const pre = presetOf(w, o);
      const r = pre?.res ?? randInt(s, 0, 5);
      const n = pre?.amount ?? randInt(s, 1, 5);
      p.resources[r] += n;
      return sayLine(h, o, 64, [{ kind: "resource", id: r, amount: n }]);
    }
    case 105: {
      // Wagon: a treasure (20%) or minor (20%) artifact, 2-5 of a resource (50%), or nothing, for the
      // first visitor; it stays, empty (VCMI's wagon: visitMode once; heroes.thelazy.net Wagon).
      if (o.visitedWeek === -1) return sayLine(h, o, 156);
      o.visitedWeek = -1;
      // What the map chose: its artifact, else its resource (content 0), or nothing (1).
      const pre = presetOf(w, o);
      const roll = !pre ? randInt(s, 1, 100) : pre.content === 0 && pre.artifact !== undefined ? 1 : pre.content === 0 ? 50 : 100;
      if (roll <= 40) {
        const id = pre?.artifact ?? randomArtifact(s, w, roll <= 20 ? "T" : "N");
        if (id >= 0) giveArtifact(h, w.data.artifacts, id);
        return sayLine(h, o, 155, id >= 0 ? [{ kind: "artifact", id }] : [], [w.data.artifacts[id]?.name ?? ""]);
      }
      if (roll <= 90) {
        const r = pre?.res ?? randInt(s, 0, 5);
        const n = pre?.amount ?? randInt(s, 2, 5);
        p.resources[r] += n;
        return sayLine(h, o, 154, [{ kind: "resource", id: r, amount: n }]);
      }
      return sayLine(h, o, 156);
    }
    case 86: {
      // Shipwreck Survivor: an artifact (treasure 55%, minor 20%, major 20%, relic 5%)
      o.removed = true;
      const pre = presetOf(w, o);
      const roll = pre ? [1, 60, 80, 100][pre.content] ?? 1 : randInt(s, 1, 100);
      const id = pre?.artifact ?? randomArtifact(s, w, roll <= 55 ? "T" : roll <= 75 ? "N" : roll <= 95 ? "J" : "R");
      if (id >= 0) giveArtifact(h, w.data.artifacts, id);
      const name = w.data.artifacts[id]?.name ?? "an artifact";
      return sayLine(h, o, 125, id >= 0 ? [{ kind: "artifact", id }] : [], [name]);
    }
    case 22: {
      // Skeleton: a treasure (10%) or minor (10%) artifact, else nothing, for the first visitor; the
      // remains stay (VCMI's corpse: visitMode once).
      if (o.visitedWeek === -1) return sayLine(h, o, 38);
      o.visitedWeek = -1;
      // What the map chose: nothing (0), its artifact (1), a minor one (2).
      const pre = presetOf(w, o);
      const roll = pre ? [100, 1, 15][pre.content] ?? 100 : randInt(s, 1, 100);
      if (roll <= 20) {
        const id = pre?.artifact ?? randomArtifact(s, w, roll <= 10 ? "T" : "N");
        if (id >= 0) giveArtifact(h, w.data.artifacts, id);
        return sayLine(h, o, 37, id >= 0 ? [{ kind: "artifact", id }] : []);
      }
      return sayLine(h, o, 38);
    }
    case 29: {
      // Flotsam: wood and/or gold
      o.removed = true;
      const roll = presetOf(w, o)?.content ?? randInt(s, 0, 3);
      const wood = [0, 5, 5, 10][roll];
      const gold = [0, 0, 200, 500][roll];
      p.resources[0] += wood;
      p.resources[6] += gold;
      const got: Component[] = [...(wood ? [{ kind: "resource" as const, id: 0, amount: wood }] : []), ...(gold ? [{ kind: "resource" as const, id: 6, amount: gold }] : [])];
      return say(h, o, wood || gold ? `You salvage ${[wood && `${wood} Wood`, gold && `${gold} Gold`].filter(Boolean).join(" and ")}.` : "It's just junk.", 51 + roll, got);
    }
    case 82: {
      // Sea Chest: gold or an artifact
      o.removed = true;
      // What the map chose: empty (0), 1500 gold (1), 1000 gold and its artifact (2).
      const pre = presetOf(w, o);
      const roll = pre ? [1, 50, 100][pre.content] ?? 1 : randInt(s, 1, 100);
      if (roll <= 20) return sayLine(h, o, 116);
      if (roll <= 90) {
        p.resources[6] += 1500;
        return sayLine(h, o, 118, [{ kind: "resource", id: 6, amount: 1500 }]);
      }
      const id = pre?.artifact ?? randomArtifact(s, w, "T");
      if (id >= 0) giveArtifact(h, w.data.artifacts, id);
      p.resources[6] += 1000;
      return sayLine(h, o, 117, [{ kind: "resource", id: 6, amount: 1000 }, ...(id >= 0 ? [{ kind: "artifact" as const, id }] : [])], [w.data.artifacts[id]?.name ?? ""]);
    }

    // ---- information -------------------------------------------------------------
    case 13: {
      // Cartographer: reveals sea, land or underground for 10000 gold (HotA's price), asking first
      const kind = o.subid; // 0 water, 1 land, 2 underground
      const bought = ((o.data ??= {}).boughtBy as number[] | undefined) ?? [];
      if (bought.includes(h.owner)) return sayLine(h, o, 24);
      if (p.resources[6] < CARTOGRAPHER_PRICE) return sayLine(h, o, 28);
      const ask = askFirst(s, h, o, confirmed, [25, 26, 27][kind] ?? 26, [{ kind: "resource", id: 6, amount: CARTOGRAPHER_PRICE }]);
      if (ask) return ask;
      p.resources[6] -= CARTOGRAPHER_PRICE;
      o.data.boughtBy = [...bought, h.owner];
      for (let i = 0; i < w.levels * w.size * w.size; i++) if (cartographerShows(w, kind, i)) reveal(s, w, h.owner, i % w.size, Math.floor(i / w.size) % w.size, Math.floor(i / (w.size * w.size)), 0);
      // (The original says nothing more: the map shows what was bought.)
      return [];
    }
    case 58: // Redwood Observatory
    case 60: // Pillar of Fire
      reveal(s, w, h.owner, h.x, h.y, h.z, 20);
      return sayLine(h, o, o.type === 58 ? 98 : 99);

    // ---- prison ------------------------------------------------------------------
    case 62: {
      if (s.heroes.filter((x) => !x.removed && x.owner === h.owner && x.garrison === undefined).length >= 8) return sayLine(h, o, 103);
      return null; // handled by the rules (needs hero creation)
    }
  }
  return null;
}

/** A random secondary skill the map allows (Scholars). */
function pickAllowedSkill(s: AdventureState): number {
  const pool = Array.from({ length: 28 }, (_, i) => i).filter((i) => skillAllowed(s, i));
  return pool.length ? pool[randInt(s, 0, pool.length - 1)] : randInt(s, 0, 27);
}

/** A random artifact of the given tiers (T treasure, N minor, J major, R relic). */
export function randomArtifact(s: AdventureState, w: World, tiers: string): number {
  const ids = randomArtifactPool(w.data.artifacts, tiers, s.banned?.artifacts);
  return ids.length ? ids[randInt(s, 0, ids.length - 1)] : -1;
}

/** A hero found a weekly object empty: its player knows now it's been visited this week (the "(Visited)" mark). */
export function sawEmpty(o: AdvObject, owner: number) {
  if (o.weekVisitor !== owner && !o.weekSeen?.includes(owner)) (o.weekSeen ??= []).push(owner);
}
