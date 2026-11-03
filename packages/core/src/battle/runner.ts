import { skillLevel } from "../skills.ts";
import { chooseAction, chooseFlight } from "./ai.ts";
import { chooseSpell } from "./aiMagic.ts";
import { type BattleAction, type BattleEvent, applyAction, controlSide } from "./rules.ts";
import { activeUnit } from "./reach.ts";
import { SPELL } from "../spells.ts";
import { type BattleState, type Unit, copyBattle } from "./state.ts";
import { Refusal } from "../refusal.ts";

/** Hard stop for AI-vs-AI loops that never resolve (e.g. two flyers dancing). */
export const MAX_ROUNDS = 100;

/**
 * The battle AI's choices the rules turned down, by kind and reason ("shoot: ..."): each is the AI
 * and the rules disagreeing about what's allowed (the stack defends instead). The simulations list them.
 */
export const battleAiRefusals = new Map<string, number>();
const refused = (a: BattleAction, e: unknown) => {
  // (Not a Refusal: an error inside the rules, a bug; its kind leads the key.)
  const bug = e instanceof Refusal ? "" : `BUG ${e instanceof Error ? e.name : "throw"} `;
  const key = `${bug}${a.type}${a.type === "cast" ? ` ${a.spell}` : ""}: ${(e instanceof Error ? e.message : String(e)).replace(/\d+/g, "#")}`;
  battleAiRefusals.set(key, (battleAiRefusals.get(key) ?? 0) + 1);
};

/**
 * Units that act by themselves even on a player's side: the ballista and the towers without
 * Artillery (HotA's cannon too), the catapult without Ballistics, a berserk stack.
 */
export function actsByItself(s: BattleState, u: Unit): boolean {
  const skills = s.sides[u.side].hero?.skills;
  const autoMachine =
    ((u.machine === "ballista" || u.machine === "cannon" || u.machine === "tower") && !skillLevel(skills, "artillery")) || (u.machine === "catapult" && !skillLevel(skills, "ballistics"));
  return autoMachine || !!u.effects?.some((e) => e.spell === SPELL.BERSERK);
}

/** One AI action if an AI-controlled unit is up; null when it's a human's turn or the battle is over. */
export function aiStep(s: BattleState): BattleEvent[] | null {
  // A player who turns on auto combat while arranging the troops (Tactics): the battle begins as it is.
  if (s.tactics && s.sides[s.tactics.side].controller === "ai") return applyAction(s, { type: "tacticsDone", unit: -1 });
  const u = activeUnit(s);
  // Berserk stacks act on their own; hypnotized ones obey the other side.
  const berserk = !!u?.effects?.some((e) => e.spell === SPELL.BERSERK);
  if (!u || (s.sides[controlSide(u)].controller !== "ai" && !actsByItself(s, u))) return null;
  if (s.round > MAX_ROUNDS) {
    s.winner = "draw";
    s.active = null;
    return [{ e: "end", winner: "draw" }];
  }
  // The hero casts first (once a round), then the creature acts.
  const side = controlSide(u);
  const spell = berserk || s.cast?.[side] || s.sides[side].controller !== "ai" ? null : chooseSpell(s, side, u.id);
  if (spell) {
    try {
      return applyAction(s, spell);
    } catch (err) {
      refused(spell, err);
      (s.cast ??= [false, false])[side] = true;
    }
  }
  // A lost fight: the hero worth keeping retreats or surrenders (once its spell couldn't turn it);
  // never for a player on auto combat.
  const flight = berserk || s.sides[side].controller !== "ai" || s.sides[side].auto ? null : chooseFlight(s, side);
  if (flight) {
    try {
      return applyAction(s, flight);
    } catch (err) {
      refused(flight, err);
    }
  }
  // A choice the rules refuse (a corner case the AI misjudged) must not stall the battle.
  const action = chooseAction(s);
  try {
    return applyAction(s, action);
  } catch (err) {
    if (action.type === "defend") throw err;
    refused(action, err);
    return applyAction(s, { type: "defend", unit: action.unit });
  }
}

/**
 * Auto combat played from the player's own screen: what the AI would do with the active stack of a
 * human side (a spell first, as the AI hero casts; never a retreat), checked against the rules; null
 * when no stack of that side is up. Leaves `s` as it is. The player can take over again at any turn.
 */
export function autoAction(s: BattleState, o: { spells?: boolean } = {}): BattleAction | null {
  const t = copyBattle(s);
  const u = activeUnit(t);
  if (!u || t.winner !== null) return null;
  const side = controlSide(u);
  t.sides[side].controller = "ai";
  t.sides[side].auto = true;
  const allowed = (a: BattleAction) => {
    try {
      applyAction(copyBattle(t), a);
      return true;
    } catch (err) {
      refused(a, err);
      return false;
    }
  };
  const berserk = !!u.effects?.some((e) => e.spell === SPELL.BERSERK);
  // (`spells: false`: the combat options' auto-combat Spells unchecked, the hero casts none.)
  const spell = berserk || t.cast?.[side] || o.spells === false ? null : chooseSpell(t, side, u.id);
  if (spell && allowed(spell)) return spell;
  const action = chooseAction(t);
  return allowed(action) ? action : { type: "defend", unit: action.unit };
}

/** Lets AI-controlled sides act until a human is up or the battle ends. */
export function runAi(s: BattleState): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (let ev = aiStep(s); ev; ev = aiStep(s)) events.push(...ev);
  return events;
}

/** Human action followed by any AI responses. */
export function step(s: BattleState, action: BattleAction): BattleEvent[] {
  return [...applyAction(s, action), ...runAi(s)];
}
