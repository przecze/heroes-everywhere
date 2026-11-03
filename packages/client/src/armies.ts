import { type CreatureStats, type StackSetup, isRecruitable } from "@heroes/core";

const TOWNS = ["castle", "rampart", "tower", "inferno", "necropolis", "dungeon", "stronghold", "fortress", "conflux", "cove", "factory", "bulwark"];

export interface ArmyPreset {
  name: string;
  stacks: StackSetup[];
}

/** For each town: a week-2 army of basic creatures and a week-3 army of upgraded ones. */
export function buildArmies(creatures: CreatureStats[]): ArmyPreset[] {
  const out: ArmyPreset[] = [];
  for (const town of TOWNS) {
    const roster = creatures.filter((c) => c.faction === town && isRecruitable(c));
    const byLevel = (upgraded: boolean) =>
      [1, 2, 3, 4, 5, 6, 7]
        .map((lvl) => roster.filter((c) => c.level === lvl).sort((a, b) => a.id - b.id)[upgraded ? 1 : 0])
        .filter((c): c is CreatureStats => !!c);
    const title = town[0].toUpperCase() + town.slice(1);
    out.push({
      name: `${title} (week 2)`,
      // Week 2: two weeks of growth, no dragons yet.
      stacks: byLevel(false)
        .filter((c) => c.level < 7)
        .map((c) => ({ creature: c.id, count: c.growth * 2 })),
    });
    out.push({
      name: `${title} (upgraded, week 3)`,
      stacks: byLevel(true).map((c) => ({ creature: c.id, count: c.growth * 3 })),
    });
  }
  return out;
}
