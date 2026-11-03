// Armies and artifacts changing hands: the garrison windows (towns and map garrisons), the exchange
// window between two heroes and its "move all", and creatures waiting to join.

import { Refusal } from "../refusal.ts";
import { COMBOS, SLOT, SLOT_COUNT, initEquipment, moveArtifact, releaseCombo } from "./artifacts.ts";
import { mapData, mapGarrisonArmy } from "./objects.ts";
import type { AdventureAction, AdventureEvent, ArmyRef } from "./rules.ts";
import { garrisonHero, visitingHero } from "./town.ts";
import { type AdventureState, type AdvObject, type ArmySlot, Obj } from "./types.ts";
import { type World, tileSpan } from "./world.ts";

/** The garrison window of a town (or a map garrison): a stack moved, split, merged or swapped between the garrison and the visiting hero. */
export function moveStack(s: AdventureState, w: World, player: number, action: Extract<AdventureAction, { type: "moveStack" }>): AdventureEvent[] {
  const o = s.objects[action.town];
  if (o && (o.type === Obj.GARRISON || o.type === Obj.GARRISON2 || o.type === Obj.MINE || o.type === 220)) return moveMapGarrison(s, w, player, o, action);
  if (!o?.town || o.owner !== player) throw new Refusal("not your town");
  const hero = visitingHero(s, w, o);
  const above = garrisonHero(s, o);
  // Work on copies; commit only a valid result (the upper row is the garrison hero's army, if any).
  const garrison = [...(above ? above.army : o.town.garrison)];
  const heroArmy = hero ? [...hero.army] : undefined;
  const armyOf = (r: ArmyRef) => (r.who === "garrison" ? garrison : heroArmy);
  const a = armyOf(action.from);
  const b = armyOf(action.to);
  if (!a || !b) throw new Refusal("no hero in town");
  if (!moveStackBetween(a, action.from.slot, b, action.to.slot, action.count)) return [];
  // A hero can't walk out with no army (nor stay in the garrison without one).
  if (heroArmy && heroArmy.every((x) => !x)) throw new Refusal("a hero needs at least one stack");
  if (above && garrison.every((x) => !x)) throw new Refusal("a hero needs at least one stack");
  if (above) above.army = garrison;
  else o.town.garrison = garrison;
  if (hero && heroArmy) hero.army = heroArmy;
  return [];
}

/** HotA's "move all" between two heroes side by side: every stack (the weakest keeps one creature) or every artifact, one way or swapped. */
export function exchangeAll(s: AdventureState, w: World, player: number, action: Extract<AdventureAction, { type: "exchangeAll" }>): AdventureEvent[] {
  if (!Array.isArray(action.heroes)) throw new Refusal("not your heroes");
  const pair = action.heroes.map((id) => s.heroes[id]);
  const [a, b] = pair;
  if (!a || !b || a === b || a.removed || b.removed || a.owner !== player || b.owner !== player) throw new Refusal("not your heroes");
  if (a.z !== b.z || tileSpan(a, b) > 1) throw new Refusal("the heroes must be side by side");
  if (action.kind === "army") {
    if (action.from === "swap") [a.army, b.army] = [b.army, a.army];
    else {
      const src = pair[action.from];
      const dst = pair[1 - action.from];
      const from = [...src.army];
      const to = [...dst.army];
      // The weakest stack keeps one creature behind, so the hero isn't left without an army.
      const strength = (x: { creature: number }) => w.creatures[x.creature]?.aiValue ?? 0;
      const filled = from.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
      const keep = filled.sort((i, j) => strength(from[i]!) - strength(from[j]!) || from[i]!.count - from[j]!.count)[0];
      for (let i = 0; i < 7; i++) {
        const st = from[i];
        if (!st) continue;
        const n = i === keep ? st.count - 1 : st.count;
        if (n <= 0) continue;
        const same = to.findIndex((x) => x?.creature === st.creature);
        const slot = same >= 0 ? same : to.findIndex((x) => !x);
        if (slot < 0) continue;
        to[slot] = { creature: st.creature, count: (to[slot]?.count ?? 0) + n };
        from[i] = n === st.count ? null : { creature: st.creature, count: st.count - n };
      }
      src.army = from;
      dst.army = to;
    }
  } else if (action.from === "swap") {
    initEquipment(a);
    initEquipment(b);
    // Everything worn (the spellbooks and catapults stay) and the backpacks change hands, combinations with their locks.
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      if (slot === SLOT.SPELLBOOK || slot === SLOT.MACH4) continue;
      [a.equipped![slot], b.equipped![slot]] = [b.equipped![slot], a.equipped![slot]];
    }
    [a.combos, b.combos] = [b.combos, a.combos];
    [a.backpack, b.backpack] = [b.backpack ?? [], a.backpack ?? []];
  } else {
    initEquipment(a);
    initEquipment(b);
    const src = pair[action.from];
    const dst = pair[1 - action.from];
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const art = src.equipped![slot];
      if (slot === SLOT.SPELLBOOK || slot === SLOT.MACH4 || art === undefined || art < 0) continue;
      if (COMBOS[art]) releaseCombo(src, slot);
      src.equipped![slot] = -1;
      // Worn in the same place when it's free (combinations go to the backpack).
      if (!COMBOS[art] && dst.equipped![slot] === -1) dst.equipped![slot] = art;
      else (dst.backpack ??= []).push(art);
    }
    (dst.backpack ??= []).push(...(src.backpack ?? []));
    src.backpack = [];
  }
  return [];
}

/** The exchange window (or a hero's own screen): one stack or artifact between two heroes side by side. */
export function transfer(s: AdventureState, w: World, player: number, action: Extract<AdventureAction, { type: "transfer" }>): AdventureEvent[] {
  if (!Array.isArray(action.heroes)) throw new Refusal("not your heroes");
  const pair = action.heroes.map((id) => s.heroes[id]);
  const [a, b] = pair;
  if (!a || !b || a.removed || b.removed || a.owner !== player || b.owner !== player) throw new Refusal("not your heroes");
  if (a.z !== b.z || tileSpan(a, b) > 1) throw new Refusal("the heroes must be side by side");
  // The same hero twice: rearranging its own army (hero screen).
  const same = a === b;
  const src = pair[action.from.who];
  const dst = pair[action.to.who];
  if (action.kind === "army") {
    const armies = same ? [[...a.army]] : [[...a.army], [...b.army]];
    const from = armies[same ? 0 : action.from.who];
    const to = armies[same ? 0 : action.to.who];
    if (!moveStackBetween(from, action.from.slot ?? -1, to, action.to.slot ?? -1, action.count)) return [];
    if (armies.some((army) => army.every((x) => !x))) throw new Refusal("a hero needs at least one stack");
    if (same) a.army = armies[0];
    else [a.army, b.army] = armies;
    return [];
  }
  // Artifacts: between worn slots and backpacks of either hero.
  moveArtifact(w.data.artifacts, src, action.from, dst, action.to);
  return [];
}

/** Creatures that offered to join but found no room: moved between them and the hero's army. */
export function moveJoiners(s: AdventureState, w: World, player: number, action: Extract<AdventureAction, { type: "moveJoiners" }>): AdventureEvent[] {
  const h = s.heroes[action.hero];
  if (h?.owner !== player || !h.joiners) throw new Refusal("no creatures waiting to join");
  const armies = { joiners: [...h.joiners], hero: [...h.army] };
  const a = armies[action.from.who];
  const b = armies[action.to.who];
  if (!a || !b) throw new Refusal("nothing to move");
  if (!moveStackBetween(a, action.from.slot, b, action.to.slot, action.count)) return [];
  if (armies.hero.every((x) => !x)) throw new Refusal("a hero needs at least one stack");
  h.joiners = armies.joiners;
  h.army = armies.hero;
  return [];
}

/**
 * The garrison window of a map garrison: stacks between it and the hero standing in it. A garrison
 * whose troops the map made unremovable takes troops but gives none back.
 */
function moveMapGarrison(s: AdventureState, w: World, player: number, o: AdvObject, action: { from: ArmyRef; to: ArmyRef; count?: number }): AdventureEvent[] {
  if (o.owner !== player) throw new Refusal("not your garrison");
  const hero = visitingHero(s, w, o);
  if (hero && hero.owner !== player) throw new Refusal("not your hero");
  if (!hero) throw new Refusal("no hero in the garrison");
  const garrison = [...mapGarrisonArmy(w, o)];
  const heroArmy = [...hero.army];
  const a = action.from.who === "garrison" ? garrison : heroArmy;
  const b = action.to.who === "garrison" ? garrison : heroArmy;
  const stays = mapData(w, o).removable === false;
  const moved = moveStackBetween(a, action.from.slot, b, action.to.slot, action.count, (swaps) => {
    if (stays && a !== b && (a === garrison || swaps)) throw new Refusal("These troops can't leave the garrison.");
  });
  if (!moved) return [];
  if (heroArmy.every((x) => !x)) throw new Refusal("a hero needs at least one stack");
  o.army = garrison;
  hero.army = heroArmy;
  return [];
}

/**
 * Moves `count` creatures (the whole stack when undefined) from slot `from` of army `a` to slot `to` of
 * army `b` (the same army or another; callers pass copies and keep them once all is valid): onto an
 * empty slot or the same creature they join, onto another creature the two stacks swap (whole stacks
 * only). `check` may refuse (told whether it's a swap) before anything changes. False: the same slot,
 * nothing to do.
 */
function moveStackBetween(a: (ArmySlot | null)[], from: number, b: (ArmySlot | null)[], to: number, count?: number, check?: (swaps: boolean) => void): boolean {
  const stack = a[from];
  if (!stack || to < 0 || to > 6) throw new Refusal("nothing to move");
  if (a === b && from === to) return false;
  const there = b[to];
  const n = count ?? stack.count;
  if (!Number.isInteger(n) || n <= 0 || n > stack.count) throw new Refusal("bad count");
  const swaps = !!there && there.creature !== stack.creature;
  if (swaps && count !== undefined) throw new Refusal("can only split into an empty slot or the same creature");
  check?.(swaps);
  if (swaps) [a[from], b[to]] = [there, stack];
  else {
    b[to] = { creature: stack.creature, count: (there?.count ?? 0) + n };
    a[from] = n === stack.count ? null : { creature: stack.creature, count: stack.count - n };
  }
  return true;
}

