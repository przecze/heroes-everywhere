import { type AdventureState, type BattleState, type CaretakerLog, type PendingBattle, Obj, RESOURCE_NAMES, World, allied } from "@heroes/core";

/** Creatures a side lost in a battle: name (plural) and how many. */
export interface Loss {
  name: string;
  count: number;
}

/**
 * Something a player away from a game played by notification wants to hear of when they're back
 * ("since your last turn") or at once ("you were attacked"): a battle between players, a town
 * changing hands. Players are colours; names are the map's (English, as the game's texts are).
 */
export type GameReport =
  | {
      kind: "battle";
      day: number;
      /** The attacking player and hero. */
      attacker: number;
      hero: string;
      /** The defending player (none: neutral creatures) and what they defended with. */
      defender?: number;
      foe?: string;
      /** The town (or other place) attacked, when it was one. */
      town?: string;
      /** The attacker won (else held off, or fled). */
      won: boolean;
      fled?: boolean;
      /** Losses: [attacker's, defender's]. */
      lost: [Loss[], Loss[]];
      /** The players told of it: both sides and their allies. */
      seats: number[];
    }
  | { kind: "town"; day: number; town: string; from?: number; to: number; seats: number[] }
  /** A friend away: the caretaker played their turn (what it picked up, recruited, and the towns it stayed to guard). */
  | { kind: "caretaker"; day: number; seat: number; picked: Loss[]; recruited: Loss[]; held: string[]; seats: number[] };

/** The costliest losses told by name; the rest go as "…" (a report reads on a phone's lock screen). */
const LOSSES_NAMED = 3;

function losses(w: World, b: BattleState, side: 0 | 1): Loss[] {
  const by = new Map<number, number>();
  for (const u of b.units) {
    if (u.side !== side || u.summoned || u.clone || u.machine) continue;
    const lost = u.initialCount - Math.max(0, u.count);
    if (lost > 0) by.set(u.creature, (by.get(u.creature) ?? 0) + lost);
  }
  const worth = (c: number, n: number) => (w.creatures[c]?.fightValue ?? 1) * n;
  const all = [...by].sort(([a, n], [b, m]) => worth(b, m) - worth(a, n));
  const named = all.slice(0, LOSSES_NAMED).map(([c, count]) => ({ name: ((count === 1 ? w.creatures[c]?.name : w.creatures[c]?.plural) ?? "creatures").trim(), count }));
  // (The rest, in one: a count of 0 says "and more".)
  return all.length > LOSSES_NAMED ? [...named, { name: "", count: 0 }] : named;
}

/** The players to tell of something between these players: themselves and their allies (the humans among them are picked later). */
function told(s: AdventureState, parties: (number | undefined)[]): number[] {
  const ps = parties.filter((p): p is number => p !== undefined && p >= 0);
  return s.players.filter((p) => ps.some((q) => q === p.color || allied(s, q, p.color))).map((p) => p.color);
}

/**
 * The report of a finished battle between two players (taken before finishBattle settles it);
 * none for a fight with neutral creatures, which nobody else cares about.
 */
export function battleReport(s: AdventureState, w: World, pb: PendingBattle): GameReport | null {
  const b = pb.battle;
  const h = s.heroes[pb.hero];
  const d = pb.defender !== undefined ? s.heroes[pb.defender] : undefined;
  const o = pb.object >= 0 ? s.objects[pb.object] : undefined;
  const defender = d?.owner ?? (o?.owner !== undefined && o.owner >= 0 ? o.owner : undefined);
  if (!h || defender === undefined || b.winner === null) return null;
  return {
    kind: "battle",
    day: s.day,
    attacker: h.owner,
    hero: h.name.trim(),
    defender,
    ...(d ? { foe: d.name.trim() } : {}),
    ...(o?.town ? { town: o.name ?? "a town" } : {}),
    won: b.winner === 0,
    ...(b.fled ? { fled: true } : {}),
    lost: [losses(w, b, 0), losses(w, b, 1)],
    seats: told(s, [h.owner, defender]),
  };
}

/** Who owns each town now (object id → colour, -1 for nobody), to see which changed hands. */
export function townOwners(s: AdventureState): Map<number, number> {
  return new Map(s.objects.filter((o) => o.town && !o.removed).map((o) => [o.id, o.owner ?? -1]));
}

/** Towns that changed hands since `before` (but `skip`, just taken in a battle already reported). */
export function townReports(s: AdventureState, before: Map<number, number>, skip = -1): GameReport[] {
  const out: GameReport[] = [];
  for (const [id, owner] of townOwners(s)) {
    const was = before.get(id);
    if (id === skip || was === undefined || was === owner || owner < 0) continue;
    const o = s.objects[id];
    out.push({ kind: "town", day: s.day, town: o.name ?? "a town", ...(was >= 0 ? { from: was } : {}), to: owner, seats: told(s, [was, owner]) });
  }
  return out;
}

const PICKUPS: Record<string, [string, string]> = { "gold mine": ["a gold mine", "gold mines"], mine: ["a mine", "mines"], "treasure chest": ["a treasure chest", "treasure chests"], campfire: ["a campfire", "campfires"], pickup: ["a pickup", "pickups"] };

/** What the caretaker did for `seat` today (caretaker.ts), told to them only (in English: the client translates the words it knows). */
export function caretakerReport(s: AdventureState, w: World, seat: number, log: CaretakerLog): GameReport {
  const picked: Loss[] = [];
  const add = (name: string, count: number) => {
    const known = picked.find((x) => x.name === name);
    if (known) known.count += count;
    else picked.push({ name, count });
  };
  for (const p of log.picked) {
    if (p.type === Obj.RESOURCE) add(RESOURCE_NAMES[p.subid] ?? "resources", p.amount ?? 1);
    else add(p.type === Obj.MINE ? (p.subid === 6 ? "gold mine" : "mine") : p.type === Obj.TREASURE_CHEST ? "treasure chest" : p.type === Obj.CAMPFIRE ? "campfire" : "pickup", 1);
  }
  // (Things counted: "a mine", "2 mines".)
  for (const x of picked) if (PICKUPS[x.name]) x.name = PICKUPS[x.name][x.count === 1 ? 0 : 1];
  const recruited = log.recruited.map(({ creature, count }) => ({ name: ((count === 1 ? w.creatures[creature]?.name : w.creatures[creature]?.plural) ?? "creatures").trim(), count }));
  const held = [...new Set(log.held)].map((id) => s.objects[id]?.name ?? "a town");
  return { kind: "caretaker", day: s.day, seat, picked, recruited, held, seats: [seat] };
}

/** Fills %1, %2... (the client passes its `tr` instead, for the player's language). */
export type Words = (en: string, ...args: unknown[]) => string;
const english: Words = (en, ...args) => en.replace(/%(\d)/g, (m, i) => (args[Number(i) - 1] !== undefined ? String(args[Number(i) - 1]) : m));

/**
 * A report in a sentence, as `seat` would put it ("Day 5: Gundula (Blue) attacked your town Arran and
 * took it."); `names` the colours' player names (the computer's: the colour).
 */
export function reportText(r: GameReport, seat: number, names: string[], t: Words = english): string {
  const who = (p: number | undefined) => (p === undefined ? t("neutral creatures") : (names[p] ?? String(p)));
  if (r.kind === "town") {
    if (r.from === seat) return t("Day %1: %2 took your town %3.", r.day, who(r.to), r.town);
    if (r.to === seat) return t("Day %1: you took the town %2.", r.day, r.town);
    return r.from === undefined ? t("Day %1: %2 took the town %3.", r.day, who(r.to), r.town) : t("Day %1: %2 took %3's town %4.", r.day, who(r.to), who(r.from), r.town);
  }
  if (r.kind === "caretaker") {
    const list = (l: Loss[]) => l.map((x) => (x.count === 1 && x.name.startsWith("a ") ? t(x.name) : `${x.count} ${t(x.name)}`)).join(", ");
    const done = [
      r.picked.length ? t("picked up %1", list(r.picked)) : "",
      r.recruited.length ? t("recruited %1", list(r.recruited)) : "",
      r.held.length ? t("stayed to guard %1", r.held.join(", ")) : "",
    ].filter(Boolean);
    const what = done.length ? done.join("; ") : t("nothing to pick up or recruit");
    return r.seat === seat ? t("Day %1: the caretaker played your turn: %2; then ended it.", r.day, what) : t("Day %1: the caretaker played %2's turn: %3; then ended it.", r.day, who(r.seat), what);
  }
  const subject = t("%1 (%2)", r.hero, who(r.attacker));
  const mine = r.defender === seat;
  const target =
    r.town ? (mine ? t("your town %1", r.town) : t("%1's town %2", who(r.defender), r.town))
    : r.foe ? (mine ? t("your hero %1", r.foe) : t("%1's hero %2", who(r.defender), r.foe))
    : mine ? t("your army") : who(r.defender);
  const outcome = r.won ? (r.town ? t("and took it") : t("and won")) : r.fled ? t("and fled") : t("and was beaten");
  const list = (l: Loss[]) => (l.length ? l.map((x) => (x.count ? `${x.count} ${x.name}` : "…")).join(", ") : t("nothing"));
  const lost = r.lost[0].length || r.lost[1].length ? ` ${t("Lost: %1 %2; %3 %4.", who(r.attacker), list(r.lost[0]), who(r.defender), list(r.lost[1]))}` : "";
  const line = t("Day %1: %2 attacked %3 %4.", r.day, subject, target, outcome);
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}${lost}`;
}
