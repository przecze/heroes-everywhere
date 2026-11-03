// Adventure map sounds from VCMI's object and terrain configs (made in packages/vcmi-data): what plays when a hero
// visits an object ("type" or "type:subtype"), its ambient loop, and the hoof beats on each terrain.
import { BASE_SOUNDS, HORSE_SOUNDS } from "../../../vcmi-data/src/mapSounds.ts";
import { HOTA_OBJECT_SOUNDS } from "./hotaSounds.ts";
import { extra } from "../settings.ts";

/** Footsteps per terrain (dirt .. rock, then HotA's highlands and wasteland): on a road, and off it (VCMI's horseSound / horseSoundPenalty). */
export { HORSE_SOUNDS };

/** The original's objects, then HotA's own (by "type:subtype"). */
export const OBJECT_SOUNDS = { ...BASE_SOUNDS, ...HOTA_OBJECT_SOUNDS };

/** The events by which a hero reaches an object and hears its visit sound (its message, question or window). */
export const SOUNDED_EVENTS = new Set(["visit", "pickup", "offer", "obelisk", "market", "dwelling", "shipyard", "teleport", "garrison"]);

const PICKUP = ["PICKUP01", "PICKUP02", "PICKUP03", "PICKUP04", "PICKUP05", "PICKUP06", "PICKUP07"];

/** The sound as an object is taken off the map (resources, artifacts, chests...). */
export function removalSound(type: number, subid: number): string | undefined {
  const s = OBJECT_SOUNDS[`${type}:${subid}`]?.removal ?? OBJECT_SOUNDS[type]?.removal ?? (type === 79 || type === 76 ? PICKUP : undefined);
  return s?.[Math.floor(Math.random() * s.length)];
}

/** The sound for visiting an object, if it has one. */
export function visitSound(type: number, subid: number): string | undefined {
  const s = OBJECT_SOUNDS[`${type}:${subid}`]?.visit ?? OBJECT_SOUNDS[type]?.visit;
  return s?.[Math.floor(Math.random() * s.length)];
}

type SoundEvent = { e: string; hero?: number; object?: number; components?: unknown[] };

/** Finds that can come up empty, by object type: Flotsam, Sea Chest. */
const MAYBE_EMPTY = new Set([29, 82]);
type Objects = { objects: { type: number; subid: number; removed?: boolean }[]; heroes: { owner: number }[] };

/**
 * Which object sounds the events of each update play for a player: the visit sound as a hero of
 * theirs gets there, with its message, window or question (a Treasure Chest's CHEST as it asks gold
 * or experience, not again with the answer), and the pickup sound as the object leaves the map.
 */
export class ObjectSounds {
  /** The object that asked a hero something, and that hero. */
  private asked: { hero: number; object: number } | null = null;

  /** Starts an update from `before` to `next`: the returned function gives each event's sounds in turn. */
  update(before: Objects | null, next: Objects, me: number): (ev: SoundEvent) => string[] {
    // A campfire's gold and its message are one visit: one sound per object an update.
    const heard = new Set<number>();
    return (ev) => {
      // A hero that walks on after a question (one turned down) is no longer answering it.
      if (ev.e === "move" && this.asked?.hero === ev.hero) this.asked = null;
      if (!SOUNDED_EVENTS.has(ev.e) || ev.object === undefined || ev.hero === undefined) return [];
      if (next.heroes[ev.hero]?.owner !== me || heard.has(ev.object)) return [];
      heard.add(ev.object);
      const o = before?.objects[ev.object] ?? next.objects[ev.object];
      if (!o) return [];
      const answered = this.asked?.hero === ev.hero && this.asked.object === ev.object;
      this.asked = ev.e === "offer" ? { hero: ev.hero, object: ev.object } : answered ? null : this.asked;
      const out: string[] = [];
      // An empty find taken off the map: bad luck's sound, not the chest's and the pickup's (EXTRAS emptyFindSound;
      // The owner's note 2026-11-01 12:56: the empty sea chest sounded like a find).
      const gone = !before?.objects[ev.object]?.removed && !!next.objects[ev.object]?.removed;
      if (gone && ev.e === "visit" && MAYBE_EMPTY.has(o.type) && !ev.components?.length && extra("emptyFindSound")) return ["BADLUCK"];
      const sound = answered ? undefined : visitSound(o.type, o.subid);
      if (sound) out.push(sound);
      // Picked up / gone: the original's pickup sound (resources have only that).
      if (!before?.objects[ev.object]?.removed && next.objects[ev.object]?.removed) {
        const removal = removalSound(o.type, o.subid);
        if (removal && removal !== sound) out.push(removal);
      }
      return out;
    };
  }
}
