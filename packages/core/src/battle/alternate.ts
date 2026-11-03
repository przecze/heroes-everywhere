// HotA's alternate action (1.5.0: "shooters now can go melee; Harpies now can strike and stay; Faerie
// dragons now can attack instead of casting; Archangels and Pit Lords can now move instead of
// interacting with bodies. Action can be changed with a dedicated button or the Alt key"; 1.7.0:
// "Wall shooting disabled in the Cyclopes' Alternate Action mode"). heroes.thelazy.net Keybinds lists
// the three kinds of modes: "melee" vs "ranged" for creatures that can shoot; "cast spell or use ability"
// vs "move or attack" for creatures that cast or use abilities on corpses or terrain (Sandworms,
// Archangels, Dreadnoughts); "attack and return" vs "attack without return" for Harpies.
//
// The rules need no mode of their own: each choice is an ordinary action (an `attack` by a shooter, a
// `move` onto a corpse, an `attack` with `stay`); this says which choice the alternate action offers.
import { hasAbility } from "../creatures.ts";
import { COMBAT_SPELLS } from "../spells.ts";
import { casterSpells, castsLeft } from "./creatureMagic.ts";
import { alive, canShoot, stats } from "./rules.ts";
import type { BattleState, Unit } from "./state.ts";

/**
 * - melee: a shooter that could shoot now fights hand to hand instead (and Cyclopes leave the walls);
 * - stay: Harpies strike and stay where they struck from instead of flying back;
 * - plain: a creature with a power aimed at enemies, corpses or the ground (Faerie Dragons' spells,
 *   Archangels' resurrection, Pit Lords' Demons, Olgoi-Khorkhoi's devouring, Dreadnoughts' Heat
 *   Stroke) moves or attacks instead of using it.
 * - power: the other way round, the ability the alternate one (Dreadnoughts: "the standard attack is a punch of its
 *   metal fist; the heat beam a special activated attack", heroes.thelazy.net Dreadnought; The owner 2026-11-03T00-15).
 */
export type AlternateAction = "melee" | "stay" | "plain" | "power";

/** Powers whose targets an attack or a move could also be pointed at. */
const ON_FIELD = ["resurrection", "summonDemons", "summonLarva"];

/** What HotA's alternate action does for this stack now, or null when it has none (the button's ⊘). */
export function alternateAction(s: BattleState, u: Unit | undefined): AlternateAction | null {
  if (!u || !alive(u) || u.machine) return null;
  if (canShoot(s, u)) return "melee";
  const c = stats(s, u);
  if (hasAbility(c, "RETURN_AFTER_STRIKE")) return "stay";
  if (castsLeft(s, u) <= 0) return null;
  const aimed = (key: string) => {
    if (ON_FIELD.includes(key) || key.startsWith("heatStroke")) return true;
    const sp = Object.values(s.spells ?? {}).find((x) => x.key === key);
    const who = sp && COMBAT_SPELLS[sp.id]?.who;
    return who === "enemy" || who === "any";
  };
  const powers = casterSpells(u, s);
  if (powers.some((key) => key.startsWith("heatStroke"))) return "power";
  return powers.some(aimed) ? "plain" : null;
}
