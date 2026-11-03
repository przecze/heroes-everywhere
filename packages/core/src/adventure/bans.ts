// The map's bans (its allowed artifacts, spells and skills): what may turn up at random.
import type { AdventureState } from "./types.ts";

export const artifactAllowed = (s: AdventureState, id: number) => !s.banned?.artifacts.includes(id);
export const spellAllowed = (s: AdventureState, id: number) => !s.banned?.spells.includes(id);
export const skillAllowed = (s: AdventureState, id: number) => !s.banned?.skills.includes(id);
