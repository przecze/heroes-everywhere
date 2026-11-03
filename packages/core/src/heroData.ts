// Heroes and hero classes, by id: the tables are made in packages/vcmi-data (VCMI's configs, the HotA mod's, the
// original heroes' starting armies from HOTRAITS.TXT); here HotA's join the original's, and what no config says.
import { HERO_CLASSES, HERO_INFO, HERO_PORTRAITS, HOTA_HERO_CLASSES, HOTA_HEROES, type HeroClassInfo, type HeroInfo } from "../../vcmi-data/src/heroData.ts";

export { HERO_CLASSES, HERO_INFO, HERO_PORTRAITS, HOTA_HERO_CLASSES, HOTA_HEROES, type HeroClassInfo, type HeroInfo };

for (const [id, c] of Object.entries(HOTA_HERO_CLASSES)) HERO_CLASSES[Number(id)] = c;
for (const [id, h] of Object.entries(HOTA_HEROES)) {
  HERO_INFO[Number(id)] = h;
  HERO_PORTRAITS[Number(id)] = h.portrait?.[0] ?? "";
}

/**
 * Heroes no tavern or random pick offers: HotA's campaign heroes (all but Haart Lich), Sir Mullich and
 * Galthran (HotA bans them: Lord Haart and Ranloo instead) and Thorgrim (no Resistance in HotA).
 */
for (const id of [144, 145, 146, 147, 148, 149, 151, 152, 153, 154, 155, 20, 71]) HERO_INFO[id].special = true;

/** Heroes only on maps with water (the navigators) or only on maps without (their stand-ins); 1% of the map is water enough. */
export const WATER_HEROES: Record<number, "only" | "never"> = {
  3: "only", 122: "only", 174: "only", 214: "only", // Sylvia, Voy, Elmore, Haugir
  175: "never", 176: "never", 177: "never", 159: "never", 210: "never", // Beatrice, Kinkeria, Ranloo, Derek, Biarma
};

/** The portraits a map may give a hero after the heroes' own: the original's seven spare ones, then HotA's (its editor's order). */
const SPARE_PORTRAITS = ["hpl129mk", "hpl002sh", "hpl132wl", "hpl133nc", "hpl134nc", "hpl135wi", "hpl136wi"];
const HOTA_PORTRAITS = [
  "01corkes", "02jeremy", "03illor", "05derek", "06leena", "07anabel", "08cassiopeia", "09miriam", "12casmetra", "13eovacius", "14spint", "15andal",
  "16manfred", "17zilare", "18astra", "19dargem", "10bidley", "11tark", "04elmore", "beatrice", "kinkeria", "ranloo", "editorPortraits/HPL116BX.png", "giselle",
  "01henrietta", "02sam", "03tancred", "04melchior", "05floribert", "06wynona", "07dury", "08morton", "11celestine", "12todd", "13agar", "14bertram",
  "15wrathmont", "16ziph", "17victoria", "18eanswythe", "19frederick", "boyd", "pactal", "zog", "09tavin", "10murdoch", "stina", "umender", "elderian",
  "valquest", "jangaard", "winzells", "areshrak", "kydoimos", "miseria", "athe", "editorPortraits/HPL211.png", "editorPortraits/HPL212.png",
  "editorPortraits/HPL213.png", "editorPortraits/HPL214.png", "editorPortraits/HPL215.png", "editorPortraits/HPL216.png", "gruezak", "hotaMaximus", "balfour",
  "01dhuin", "02oidana", "03neia", "04eikthurn", "05creyle", "06spadum", "07kynr", "08ergon", "09kriv", "10glacius", "11sial", "12dalton", "13biarma",
  "14akka", "15vehr", "16allora", "17haugir",
];

/** A map's portrait number (on a hero it places or in its hero settings) as a portrait image: PCX name or HotA PNG path. */
/** HotA's Factory campaign heroes borrow a Factory hero's specialty picture (the HotA mod's hero configs). */
export const SPECIALTY_ICONS: Record<number, string> = {
  215: "hota/factory/heroes/sam", 216: "hota/factory/heroes/frederick", 217: "hota/factory/heroes/todd",
  218: "hota/factory/heroes/floribert", 219: "hota/factory/heroes/tancred", 220: "hota/factory/heroes/tavin",
};

export function mapPortrait(index: number): string | undefined {
  if (index < 156) return HERO_PORTRAITS[index] || undefined;
  if (index < 163) return SPARE_PORTRAITS[index - 156];
  const name = HOTA_PORTRAITS[index - 163];
  if (!name || name.includes("/")) return name;
  const id = Object.keys(HERO_INFO).find((k) => HERO_INFO[+k].key === name);
  return id !== undefined ? HERO_PORTRAITS[+id] || undefined : undefined;
}

/**
 * How many of each starting creature the original heroes bring: HOTRAITS.TXT's Low / High per stack, from the
 * player's files (the creatures themselves are in heroData; the file names them only for reference). A row the
 * file lacks keeps no army numbers (0-0).
 */
export function heroArmySizes(hotraits: string[][]): void {
  hotraits
    .slice(2)
    .filter((r) => r[0]?.trim())
    .forEach((r, id) => {
      if (id >= 156) return;
      HERO_INFO[id]?.army.forEach((a, k) => {
        const lo = Number(r[1 + 3 * k]), hi = Number(r[2 + 3 * k]);
        if (Number.isFinite(lo) && Number.isFinite(hi) && hi > 0) (a[1] = lo), (a[2] = hi);
      });
    });
}
