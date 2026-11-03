// The original's own lines the rules quote (GENRLTXT, ADVEVENT...), read from the player's game files, never
// written out here: whoever builds the game data hands the files in (buildGameData), and a message the rules make
// reads its line from them. Without the files (tests and tools on the stand-in art) a line reads as its name and
// its fill-ins ("advevent 48"), which is all a headless run needs. The interface shows every such message from
// the files too (in the files' language), by the message's TextRef.
import { legacyRows } from "@heroes/formats";
import type { TextRef } from "./adventure/types.ts";
import { HOTA_ARTIFACTS } from "../../vcmi-data/src/hotaArtifacts.ts";

/** The text files the rules quote. */
export const GAME_LINE_FILES = ["genrltxt", "advevent", "artevent", "mineevnt", "arraytxt", "seerhut", "randsign", "crgen1", "crgen4", "hallinfo"] as const satisfies readonly TextRef["file"][];
export type GameLineFile = (typeof GAME_LINE_FILES)[number];

const ROWS = new Map<string, string[][]>();

/** A text file's bytes, as the game has it (GENRLTXT's heading row is dropped, as the game numbers its lines). */
export function setGameLines(file: GameLineFile, bytes: Uint8Array | undefined): void {
  if (!bytes?.length) return;
  const rows = legacyRows(bytes);
  ROWS.set(file, file === "genrltxt" ? rows.slice(1) : rows);
}

/** Whether the game's lines of `file` are in. */
export const hasGameLines = (file: GameLineFile) => ROWS.has(file);

/** The game's line as it is (%s / %d unfilled), or undefined without the files. */
export function gameLine(file: GameLineFile, id: number, col = 0): string | undefined {
  const line = ROWS.get(file)?.[id]?.[col] || undefined;
  // (HotA's own artifacts, past the original's ARTEVENT rows: the HotA mod's line; "artevent 153" was shown for the
  // Demon's Horseshoe, the owner 2026-11-02.)
  if (!line && file === "artevent" && !col && ROWS.has(file)) return HOTA_ARTIFACTS[id]?.event || undefined;
  return line;
}

/** The line a TextRef names, filled in; without the files its name and fill-ins ("advevent 48: 3, Gold"). */
export function lineText(ref: TextRef): string {
  const args = (ref.args ?? []).map((a) => (typeof a === "object" ? lineText(a) : String(a)));
  const more = (ref.more ?? []).map((m) => (typeof m === "string" ? m : lineText(m))).join("");
  const line = gameLine(ref.file, ref.id, ref.col);
  if (line === undefined) return `${ref.file} ${ref.id}${ref.col ? `.${ref.col}` : ""}${args.length ? `: ${args.join(", ")}` : ""}${more ? ` ${more}` : ""}`;
  let k = 0;
  return line.replace(/%[sd]/g, () => args[k++] ?? "") + more;
}

/** lineText for a line by file and number. */
export const lineOf = (file: GameLineFile, id: number, args?: (string | number | TextRef)[]): string => lineText({ file, id, ...(args ? { args } : {}) });
