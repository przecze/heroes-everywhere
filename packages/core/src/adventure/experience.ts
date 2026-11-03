// Experience needed for levels 2..12; after that each level's step is 20% more than the step
// before (rounded down): 24320, 28784, 34140, 40567...
const LEVELS = [0, 0, 1000, 2000, 3200, 4600, 6200, 8000, 10000, 12200, 14700, 17500, 20600];

export function experienceForLevel(level: number): number {
  if (level < LEVELS.length) return LEVELS[level];
  let xp = LEVELS[LEVELS.length - 1];
  let step = xp - LEVELS[LEVELS.length - 2];
  for (let l = LEVELS.length; l <= level; l++) {
    step = Math.floor(step * 1.2);
    xp += step;
  }
  return xp;
}

/** HotA fixed the original's experience overflow: no hero goes beyond level 74 (heroes.thelazy.net, Experience). */
export const MAX_LEVEL = 74;
