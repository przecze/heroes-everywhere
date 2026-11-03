// Scenario score and its creature rank, as in the original's high scores (VCMI's HighScore.cpp
// and highscoreCreatures.json).
import type { AdventureState } from "./adventure/types.ts";
import { B } from "./adventure/town.ts";
import { CREATURE_INFO } from "./creatureData.ts";

/** Score multipliers of Easy, Normal, Hard, Expert, Impossible. */
export const DIFFICULTY_MULTIPLIER = [0.8, 1, 1.3, 1.6, 2];

export interface ScenarioScore {
  days: number;
  basic: number;
  total: number;
  difficulty: number;
  /** Used cheat codes: no points, and the rank says so. */
  cheater: boolean;
}

/** The winner's score: faster and with more towns is better, +25 for beating everyone, +25 for the Grail. */
export function scenarioScore(s: AdventureState, player: number): ScenarioScore {
  const towns = s.objects.filter((o) => o.town && !o.removed && o.owner === player);
  const allDefeated = s.players.every((p) => p.color === player || !p.alive || (p.team !== undefined && p.team === s.players[player].team));
  const grail = towns.some((o) => o.town!.built.includes(B.GRAIL));
  const basic = Math.trunc(200 - (s.day + 10) / (towns.length + 5) + (allDefeated ? 25 : 0) + (grail ? 25 : 0));
  const difficulty = s.difficulty ?? 1;
  return { days: s.day, basic, total: Math.trunc(basic * DIFFICULTY_MULTIPLIER[difficulty]), difficulty, cheater: !!s.players[player]?.cheated };
}

// The lowest score of each creature rank (by VCMI creature key).
// prettier-ignore
const RANKS: [number, string][] = [[0, "imp"], [5, "gremlin"], [9, "gnoll"], [13, "troglodyte"], [17, "familiar"], [21, "skeleton"], [25, "goblin"], [29, "masterGremlin"], [33, "hobgoblin"], [37, "pikeman"], [41, "infernalTroglodyte"], [45, "skeletonWarrior"], [49, "gnollMarauder"], [53, "walkingDead"], [57, "centaur"], [61, "halberdier"], [65, "archer"], [69, "lizardman"], [73, "zombie"], [77, "goblinWolfRider"], [81, "centaurCaptain"], [85, "dwarf"], [89, "harpy"], [93, "lizardWarrior"], [97, "gog"], [101, "stoneGargoyle"], [105, "sharpshooter"], [109, "orc"], [113, "obsidianGargoyle"], [117, "hobgoblinWolfRider"], [121, "battleDwarf"], [125, "woodElf"], [129, "harpyHag"], [133, "magog"], [137, "orcChieftain"], [141, "stoneGolem"], [145, "wight"], [149, "serpentFly"], [153, "dragonFly"], [157, "wraith"], [161, "waterElemental"], [165, "earthElemental"], [169, "grandElf"], [173, "beholder"], [177, "fireElemental"], [181, "griffin"], [185, "airElemental"], [188, "hellHound"], [191, "evilEye"], [194, "cerberus"], [197, "ironGolem"], [200, "ogre"], [203, "swordsman"], [206, "demon"], [209, "royalGriffin"], [212, "hornedDemon"], [215, "monk"], [218, "dendroidGuard"], [221, "medusa"], [224, "pegasus"], [227, "silverPegasus"], [230, "basilisk"], [233, "vampire"], [236, "mage"], [239, "medusaQueen"], [242, "crusader"], [245, "goldGolem"], [248, "ogreMage"], [251, "archMage"], [254, "greaterBasilisk"], [257, "zealot"], [260, "pitFiend"], [263, "diamondGolem"], [266, "vampireLord"], [269, "dendroidSoldier"], [272, "minotaur"], [275, "lich"], [278, "genie"], [281, "gorgon"], [284, "masterGenie"], [287, "roc"], [290, "mightyGorgon"], [293, "minotaurKing"], [296, "powerLich"], [299, "thunderbird"], [302, "pitLord"], [305, "cyclop"], [308, "wyvern"], [311, "cyclopKing"], [314, "wyvernMonarch"], [317, "manticore"], [320, "scorpicore"], [323, "efreet"], [326, "unicorn"], [329, "efreetSultan"], [332, "cavalier"], [335, "naga"], [338, "warUnicorn"], [341, "blackKnight"], [344, "champion"], [347, "dreadKnight"], [350, "nagaQueen"], [353, "behemoth"], [356, "boneDragon"], [359, "giant"], [362, "hydra"], [365, "ghostDragon"], [368, "redDragon"], [371, "greenDragon"], [374, "angel"], [377, "devil"], [380, "chaosHydra"], [383, "ancientBehemoth"], [386, "archDevil"], [389, "titan"], [392, "goldDragon"], [395, "blackDragon"], [398, "archangel"]];

const BY_KEY = new Map(Object.entries(CREATURE_INFO).map(([id, c]) => [c.key, Number(id)]));

/** The creature a score ranks as (campaign scores are five times bigger). */
export function scoreCreature(points: number, campaign = false): number {
  const p = points / (campaign ? 5 : 1);
  let key = RANKS[0][1];
  for (const [min, k] of RANKS) if (p >= min) key = k;
  return BY_KEY.get(key) ?? 0;
}
