// The HotA mod's English words the game quotes where the original's files have none (HotA's own objects, Mana
// Vortex, Runes and Interference, the Ancient Altar): from its content/translation/english.json, the keys in
// modTextKeys.txt (a key a line).
import { readFileSync } from "node:fs";
import type { Table } from "../build.ts";
import { header, record } from "../emit.ts";

const KEYS = readFileSync(new URL("./modTextKeys.txt", import.meta.url), "utf8").split("\n").map((k) => k.trim()).filter(Boolean);

export default {
  out: "modTexts.ts",
  make(up) {
    const all = up.json<Record<string, string>>("hota-mod/content/translation/english.json");
    const missing = KEYS.filter((k) => typeof all[k] !== "string");
    if (missing.length) throw new Error(`modTexts: the mod has no ${missing.join(", ")}`);
    return header(["The HotA mod's English words for what the original's files don't say (content/translation/english.json), by its keys."]) +
      record("MOD_TEXTS", "Record<string, string>", KEYS.map((k) => [k, all[k]]));
  },
} satisfies Table;
