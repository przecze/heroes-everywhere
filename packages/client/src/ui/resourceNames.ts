// The resources' names on screen: the original's RESTYPES.TXT in the packs' words (Polish, German),
// ours in the other languages; never the rules' English RESOURCE_NAMES.
import { lang, said, tr, trn, type Text } from "../i18n/index.ts";

let packed: Record<string, string> | undefined;
// (Loaded lazily: the rules' tests import this without the packs.)
void import("./gameText.ts").then((m) => m.packLines("restypes")).then((l) => (packed = l)).catch(() => {});

/** A resource's index by the rules' English name ("Wood" 0 ... "Gold" 6), else -1. */
export const resourceIndex = (english: string): number => ["Wood", "Mercury", "Ore", "Sulfur", "Crystal", "Gems", "Gold"].indexOf(english);

/** Resource r's name (0 wood ... 6 gold) in the interface's language. */
export function resourceName(r: number): Text {
  const own = packed?.[r]?.trim();
  if (own) return said(own);
  return [tr("Wood"), tr("Mercury"), tr("Ore"), tr("Sulfur"), tr("Crystal"), tr("Gems"), tr("Gold")][r] ?? said("");
}

const COUNTED: ((n: number) => Text)[] = [
  (n) => trn(n, "%1 Wood", "%1 Wood"),
  (n) => trn(n, "%1 Mercury", "%1 Mercury"),
  (n) => trn(n, "%1 Ore", "%1 Ore"),
  (n) => trn(n, "%1 Sulfur", "%1 Sulfur"),
  (n) => trn(n, "%1 Crystal", "%1 Crystal"),
  (n) => trn(n, "%1 Gems", "%1 Gems"),
  (n) => trn(n, "%1 Gold", "%1 Gold"),
];
/**
 * An amount of a resource: "5 Gems" in English; in the other languages the noun in the case the number takes
 * ("5 drewna", "5 klejnotów"; The owner 2026-11-02: a seer asked for "5 Drewno"). `word`: inside a sentence ("5 gems",
 * lower case in English).
 */
export function resourceAmount(r: number, n: number, word = false): Text {
  if (lang() !== "en" && COUNTED[r]) return COUNTED[r](n);
  return said(`${n} ${word ? resourceName(r).toLowerCase() : resourceName(r)}`);
}
