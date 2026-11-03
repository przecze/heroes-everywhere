// The original's cheat codes (SoD names, as in VCMI's cheats.json), typed in the message console.
// A player who cheats is marked: the score screen then says so.
import { type AdventureState, type AdvObject, type Hero } from "./types.ts";
import type { World } from "./world.ts";
import { reveal } from "./world.ts";
import { B, build, cannotBuild, townInfo } from "./town.ts";
import { SLOT, SPELLBOOK_ARTIFACT } from "./artifacts.ts";
import { experienceForLevel } from "./experience.ts";
import { cheatOutcome } from "./conditions.ts";
import { gainExperience } from "./combat.ts";
import { CREATURE_INFO } from "../creatureData.ts";

const creatureId = (key: string) => Number(Object.entries(CREATURE_INFO).find(([, c]) => c.key === key)?.[0] ?? -1);

/** Applies a cheat code for `player` (hero / town: the selected ones). Returns a message, or null for an unknown code. */
export function applyCheat(s: AdventureState, w: World, player: number, code: string, hero?: Hero, town?: AdvObject): string | null {
  const p = s.players[player];
  const fill = (key: string, count: number) => {
    if (!hero) return "Select a hero first.";
    const id = creatureId(key);
    for (let i = 0; i < 7; i++) if (!hero.army[i]) hero.army[i] = { creature: id, count };
    return "";
  };
  let msg: string | null;
  switch (code.trim().toLowerCase()) {
    case "nwctheconstruct":
      p.resources = p.resources.map((r, i) => r + (i === 6 ? 100000 : 100));
      msg = "";
      break;
    case "nwcredpill":
      cheatOutcome(s, player, true);
      msg = "";
      break;
    case "nwcbluepill":
      cheatOutcome(s, player, false);
      msg = "";
      break;
    case "nwcwhatisthematrix":
      for (let z = 0; z < (w.map.levels ?? 1); z++) reveal(s, w, player, 0, 0, z, 2 * w.size);
      msg = "";
      break;
    case "nwcoracle":
      p.obelisks = s.objects.filter((o) => o.type === 57).map((o) => o.id);
      msg = "";
      break;
    case "nwctrinity":
      msg = fill("archangel", 5);
      break;
    case "nwcagents":
      msg = fill("blackKnight", 10);
      break;
    case "nwcthereisnospoon":
      if (!hero) return "Select a hero first.";
      hero.equipped ??= [];
      hero.equipped[SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
      hero.spells = (w.data.spells ?? []).filter((sp) => sp && sp.level >= 1 && sp.level <= 5).map((sp) => sp.id);
      hero.mana = 999;
      msg = "";
      break;
    case "nwclotsofguns":
      if (!hero) return "Select a hero first.";
      hero.equipped ??= [];
      [[SLOT.MACH1, 4], [SLOT.MACH2, 5], [SLOT.MACH3, 6]].forEach(([slot, art]) => {
        if ((hero.equipped![slot] ?? -1) < 0) hero.equipped![slot] = art;
      });
      msg = "";
      break;
    case "nwcneo":
      if (!hero) return "Select a hero first.";
      gainExperience(s, w, hero, experienceForLevel(hero.level + 1) - hero.experience);
      msg = "";
      break;
    case "nwcnebuchadnezzar":
      if (!hero) return "Select a hero first.";
      hero.movement = 1000000;
      msg = "";
      break;
    case "nwczion": {
      if (!town?.town || town.owner !== player) return "Select one of your towns first.";
      // Everything this town can have, ignoring cost and the one-a-day rule (not the Grail or a Shipyard).
      const info = townInfo(town)!;
      const saved = [...p.resources];
      p.resources = p.resources.map(() => 1e9);
      for (let progress = true; progress; ) {
        progress = false;
        for (const id of Object.keys(info.buildings).map(Number)) {
          if (id === B.GRAIL || id === B.SHIPYARD) continue;
          town.town.builtToday = false;
          if (!cannotBuild(s, w, town, id)) {
            build(s, w, town, id);
            progress = true;
          }
        }
      }
      p.resources = saved;
      msg = "";
      break;
    }
    default:
      return null;
  }
  if (msg === "") p.cheated = true;
  return msg;
}
