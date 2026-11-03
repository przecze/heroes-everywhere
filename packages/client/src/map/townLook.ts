// A town's picture on the adventure map follows what is built in it, as in the original: a village until it has a
// Fort, then the walled town (the Fort, Citadel and Castle share it in the classic towns; the Horn of the Abyss towns
// have one each), and the Capitol's own picture once that stands. The map file names one picture for the town as
// the map maker placed it; this picks the one for the town as it is now (the town kinds' defs as VCMI's factions
// and the HotA mod's towns name them).
import { B } from "@heroes/core";
import type { AdvObject } from "@heroes/core";

/** Per town kind (the object's subid): village, Fort, Citadel, Castle, Capitol. */
const LOOKS: Record<number, [string, string, string, string, string]> = {
  0: ["avccast0", "avccasx0", "avccasx0", "avccasx0", "avccasz0"],
  1: ["avcramp0", "avcramx0", "avcramx0", "avcramx0", "avcramz0"],
  2: ["avctowr0", "avctowx0", "avctowx0", "avctowx0", "avctowz0"],
  3: ["avcinft0", "avcinfx0", "avcinfx0", "avcinfx0", "avcinfz0"],
  4: ["avcnecr0", "avcnecx0", "avcnecx0", "avcnecx0", "avcnecz0"],
  5: ["avcdung0", "avcdunx0", "avcdunx0", "avcdunx0", "avcdunz0"],
  6: ["avcstro0", "avcstrx0", "avcstrx0", "avcstrx0", "avcstrz0"],
  7: ["avcftrt0", "avcftrx0", "avcftrx0", "avcftrx0", "avcforz0"],
  8: ["avchfor0", "avchforx", "avchforx", "avchforx", "avchforz"],
  9: ["avccove0", "avccovf0", "avccovc0", "avccovx0", "avccovz0"],
  10: ["avcface0", "avcfacf0", "avcfacc0", "avcfacx0", "avcfacz0"],
  11: ["avcblwr0", "avcbulf0", "avcbulc0", "avcbulx0", "avcbulz0"],
};

/** The picture a town shows now (its .def name), or undefined for anything else (or a town kind we don't know). */
export function townLook(o: Pick<AdvObject, "type" | "subid" | "town">): string | undefined {
  if (o.type !== 98 || !o.town) return undefined;
  const looks = LOOKS[o.subid];
  if (!looks) return undefined;
  const built = o.town.built;
  const level = built.includes(B.CAPITOL) ? 4 : built.includes(B.CASTLE) ? 3 : built.includes(B.CITADEL) ? 2 : built.includes(B.FORT) ? 1 : 0;
  return `${looks[level]}.def`;
}
