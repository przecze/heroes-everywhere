// Rule newAi (on by default): computer seats without a chosen personality start with the New AI ("fresh");
// a chosen personality stays, and the rule turned off leaves the map's AI tactic in charge.
import assert from "node:assert/strict";
import { test } from "node:test";
import { newAiChoices } from "../src/index.ts";

test("the New AI is every computer's default unless a personality is chosen or the rule is off", () => {
  const out = newAiChoices([{ faction: "castle" }, { personality: "warrior" }], ["human", "ai", "ai"], undefined)!;
  assert.equal(out[0]?.personality, "fresh");
  assert.equal(out[0]?.faction, "castle");
  assert.equal(out[1]?.personality, "warrior");
  assert.equal(out[2]?.personality, "fresh");
  assert.equal(out.length, 8);
  const off = [{ faction: "castle" }];
  assert.equal(newAiChoices(off, undefined, { newAi: false }), off);
});
