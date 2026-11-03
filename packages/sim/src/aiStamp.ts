// The AI's code, stamped: a hash of the files the AI's per-thing checks depend on (the adventure AI, the battle AI,
// the case maps), comments and blank lines left out. aicheck.ts and dilemmas.ts write it next to their results;
// test/aiChecks.test.ts fails when the code moved on since (run them again), and they fail themselves when a check
// that passed before fails now (a regression; ACCEPT=1 takes it as the new state, for a change meant to do that).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../..");
/** The files the AI checks follow, from the repository's root. */
export function aiFiles(): string[] {
  const adv = "packages/core/src/adventure";
  const battle = "packages/core/src/battle";
  return [
    ...readdirSync(join(root, adv))
      .filter((f) => /^(ai[A-Z]\w*|ai|caretaker|cases)\.ts$/.test(f))
      .map((f) => `${adv}/${f}`),
    ...readdirSync(join(root, battle))
      .filter((f) => /^ai(\w*)\.ts$/.test(f))
      .map((f) => `${battle}/${f}`),
  ].sort();
}
/** The code without its comments and blank lines, so a reworded comment doesn't call for a rerun. */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\/\/.*$/, "").trimEnd())
    .filter((l) => l.trim())
    .join("\n");
export function aiStamp(): string {
  const h = createHash("sha256");
  for (const f of aiFiles()) h.update(f + "\n" + code(readFileSync(join(root, f), "utf8")) + "\n");
  return h.digest("hex").slice(0, 16);
}

/**
 * Checks that passed in the last results and fail now (by key: the thing and the check), for the ratchet. Exits with
 * a list of them unless ACCEPT=1. True when the new results may be written (nothing lost, or accepted).
 */
export function ratchet(name: string, before: Map<string, boolean>, now: Map<string, boolean>): boolean {
  const lost = [...now].filter(([k, ok]) => !ok && before.get(k) === true).map(([k]) => k);
  const won = [...now].filter(([k, ok]) => ok && before.get(k) === false).length;
  console.log(`${name}: ${[...now.values()].filter(Boolean).length} of ${now.size} right; ${won} newly right, ${lost.length} newly wrong`);
  if (!lost.length) return true;
  for (const k of lost) console.log(`  newly wrong: ${k}`);
  if (process.env.ACCEPT) return (console.log("  (ACCEPT=1: kept as the new state)"), true);
  console.log(`  ${name} regressed, results not written: fix the AI, or run with ACCEPT=1 if the change means it (and say why in the commit).`);
  process.exitCode = 1;
  return false;
}
