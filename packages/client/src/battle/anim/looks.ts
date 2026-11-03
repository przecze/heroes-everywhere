// How each spell and spell-like ability looks, as data (made in packages/vcmi-data from VCMI's spell configs and
// the HotA mod's): its queues of pictures, colours and pauses, and the colour muxers.
// The battle view plays a queue with one routine for every spell (view.ts playLook): no spell has its own code
// for where its picture goes, only these entries and the placement classes of fx.ts (EffectPlace).
import { MUXERS as muxers, SPELLS } from "../../../../vcmi-data/src/spellLooks.ts";

/** One step of a queue: a DEF (standing on the hex's bottom edge, see-through), a colour muxer, a pause in effect frames. */
export interface LookPart {
  def?: string;
  bottom?: boolean;
  alpha?: number;
  colour?: string;
  pause?: number;
}

export interface SpellLook {
  index?: number;
  /** On the caster as it casts. */
  cast?: LookPart[];
  /** At the spot aimed at (over everything; the whole field when there is no spot). */
  hit?: LookPart[];
  /** On every stack the spell touches (the first one only, when `affectSecondary` names the rest's). */
  affect?: LookPart[];
  affectSecondary?: LookPart[];
  /** The missile from the caster, by the flight's angle from straight down. */
  projectile?: { def: string; angle: number }[];
  sound?: string;
}

interface MuxStep {
  time: number;
  color?: number[];
  alpha?: number;
}

const LOOKS = SPELLS as Record<string, SpellLook>;
const MUXERS = muxers as Record<string, MuxStep[]>;

/**
 * Our names for HotA's creature casts (core's `look`) and the triggers the rules report as events, against the
 * mod's spells: Ignition is the mod's detonates01, Meditation its meditation01, the Engineers' Repair hotaRepair,
 * the Sandworms' Devour summonLarva, a Mechanic's detonation, a Land Mine going off landMineTrigger.
 */
const ALIASES: Record<string, string> = {
  ignite: "detonates01",
  meditate: "meditation01",
  repair: "hotaRepair",
  devour: "summonLarva",
  detonate: "detonation",
  landMineGoesOff: "landMineTrigger",
};

export function lookOf(key: string | undefined): SpellLook | undefined {
  return key ? (LOOKS[ALIASES[key] ?? key] ?? LOOKS[key]) : undefined;
}

/** A colour muxer's length in fade units (VCMI's ColorTransformAnimation: its last time point, times getFadeInDuration). */
export function muxLength(name: string): number {
  const steps = MUXERS[name];
  return steps?.length ? steps[steps.length - 1].time : 0;
}

/**
 * The muxer at `t` fade units in: the colour its greyscale is multiplied by (null: the stack's own colours) and how
 * far toward it (0..1), and the alpha. Steps without a colour are the stack's own; between steps both blend.
 */
export function muxAt(name: string, t: number): { color: [number, number, number] | null; k: number; alpha: number } {
  const steps = MUXERS[name] ?? [];
  if (!steps.length) return { color: null, k: 0, alpha: 1 };
  let i = 0;
  while (i < steps.length && steps[i].time < t) i++;
  const prev = steps[Math.max(0, i - 1)];
  const next = steps[Math.min(steps.length - 1, i)];
  const span = next.time - prev.time;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - prev.time) / span)) : 1;
  const rgb = (s: MuxStep) => (s.color ? ([s.color[0], s.color[1], s.color[2]] as [number, number, number]) : null);
  const [a, b] = [rgb(prev), rgb(next)];
  // One colour to blend toward: the coloured step's (a muxer never goes from one colour straight to another).
  const color = b ?? a;
  const k = (a ? 1 - f : 0) + (b ? f : 0);
  const alpha = (prev.alpha ?? 1) + ((next.alpha ?? 1) - (prev.alpha ?? 1)) * f;
  return { color, k: color ? k : 0, alpha };
}
