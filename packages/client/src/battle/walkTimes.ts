// How long a creature takes over one hex (and over a shot or a cast): CRANIM.TXT's walk animation time (1 = the usual pace;
// dragons 0.6, Diamond Golems 1.27), as VCMI's getMovementDistance divides by it, and the HotA mod's
// "animationTime.walk" for HotA's creatures and its changes to original ones (by creature key).
import { parseTxt } from "@heroes/formats";
import { fetchRes } from "../assets.ts";

const HOTA_WALK: Record<string, number> = {
  stormElemental: 0.77,
  halflingGrenadier: 1.4,
  hotaMechanic: 1.15,
  hotaEngineer: 1.15,
  armadillo: 1.3,
  bellwetherArmadillo: 1.3,
  automaton: 1.1,
  sentinelAutomaton: 1.1,
  sandworm: 1.25,
  olgoiKhorkhoi: 1.25,
  gunslinger: 1.8,
  bountyHunter: 1.8,
  hotaCouatl: 1.5,
  crimsonCouatl: 1.5,
  hotaDreadnought: 1.85,
  hotaJuggernaut: 1.85,
  pirate: 0.9,
  corsair: 0.9,
  seadog: 0.9,
  nixWarrior: 1.07,
  nymph: 1,
  seaWitch: 1,
  seaserpent: 0.95,
  stormbird: 0.72,
  seaman: 0.87,
  oceanid: 1,
  crewmate: 0.87,
  ayssid: 0.72,
  sorceress: 1,
  nix: 1.07,
  haspid: 0.95,
  koboldForeman: 1.15,
  yeti: 1.8,
  argali: 1.1,
  kobold: 1.15,
  yetiRunemaster: 1.8,
  snowElf: 1.2,
  greatShaman: 1.2,
  steelElf: 1.2,
  mountainRam: 1.1,
  jotunn: 1.45,
  jotunnWarlord: 1.45,
  mammoth: 1.55,
  shaman: 1.2,
  warMammoth: 1.55,
  halfling: 1.4,
};

/**
 * The HotA mod's "animationTime.attack" (the pace of shots, casts and special attacks; 1 = the usual): its
 * shooters and its changes to original casters (heroes3DataPatch). The original's CRANIM.TXT has 1 for all.
 */
const HOTA_ATTACK: Record<string, number> = {
  archangel: 0.5,
  masterGenie: 0.8,
  pitLord: 2,
  stormElemental: 0.75,
  fairieDragon: 1.25,
  bountyHunter: 1.5,
  gunslinger: 1.5,
  halfling: 1.5,
  halflingGrenadier: 1.5,
  cannon: 0.5,
  hotaCouatl: 0.5,
  crimsonCouatl: 2.5,
  hotaDreadnought: 1.75,
  hotaJuggernaut: 1.75,
  leprechaun: 2.5,
  satyr: 2,
};

/** CRANIM.TXT's rows (blank rows part the towns): [walk, attack] animation times. */
let table: Promise<[number, number][]> | null = null;
const cranim = () =>
  (table ??= fetchRes("cranim.txt")
    .then((bytes) =>
      parseTxt(bytes)
        .slice(2)
        .filter((r) => r.length > 20 && r[0]?.trim())
        .map((r): [number, number] => [Number(r[1]) || 1, Number(r[2]) || 1]),
    )
    .catch(() => []));

/** The creature's walk animation time (1 when the game files don't say). */
export async function walkTime(creature: number, key: string): Promise<number> {
  if (HOTA_WALK[key]) return HOTA_WALK[key];
  return creature < 150 ? ((await cranim())[creature]?.[0] ?? 1) : 1;
}

/** The creature's attack animation time (1 when the game files don't say). */
export async function attackTime(creature: number, key: string): Promise<number> {
  if (HOTA_ATTACK[key]) return HOTA_ATTACK[key];
  return creature < 150 ? ((await cranim())[creature]?.[1] ?? 1) : 1;
}
