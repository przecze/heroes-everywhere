// Undo in battle (EXTRAS battleUndo): the decision about to be taken back, in words ("Pikemen attacked the Goblins"),
// for the question before an undo and for the other player's question in a battle between two players.
import { type BattleState, type Unit, stats } from "@heroes/core";
import type { UndoMove } from "@heroes/server";
import { tr, said, type Text } from "../i18n/index.ts";

/** A stack by its creature's name (plural for more than one). */
function named(s: BattleState, u: Unit | undefined): Text {
  if (!u) return tr("a stack");
  const c = stats(s, u);
  return said(u.count === 1 ? c.name : c.plural);
}

/** What the decision was, named by the stacks and spells in `s` (the battle as it stands; names don't change). */
export function undoWords(s: BattleState, move: UndoMove): Text {
  const a = move.action;
  const u = s.units[a.unit];
  const who = named(s, u);
  const hero = u ? s.sides[u.side]?.hero?.name : undefined;
  switch (a.type) {
    case "move":
    case "tacticMove":
      return tr("%1 moved", who);
    case "attack":
      return tr("%1 attacked the %2", who, named(s, s.units[a.target]));
    case "shoot":
      return tr("%1 shot at the %2", who, named(s, s.units[a.target]));
    case "shootHex":
      return tr("%1 shot", who);
    case "wait":
      return tr("%1 waited", who);
    case "defend":
      return tr("%1 defended", who);
    case "cast": {
      const spell = said(s.spells?.[a.spell]?.name ?? "");
      const caster = hero ? said(hero) : tr("The hero");
      const on = move.target !== undefined ? s.units[move.target] : undefined;
      return on ? tr("%1 cast %2 on the %3", caster, spell, named(s, on)) : tr("%1 cast %2", caster, spell);
    }
    case "creatureCast": {
      const on = move.target !== undefined ? s.units[move.target] : undefined;
      return on ? tr("%1 cast a spell on the %2", who, named(s, on)) : tr("%1 cast a spell", who);
    }
    case "tacticsDone":
      return tr("The battle was started (tactics over)");
    case "catapult":
      return tr("The Catapult fired at the walls");
    case "heal":
      return tr("The First Aid Tent healed the %1", named(s, s.units[a.target]));
    case "retreat":
      return a.surrender ? tr("Surrender") : tr("Retreat");
  }
}
