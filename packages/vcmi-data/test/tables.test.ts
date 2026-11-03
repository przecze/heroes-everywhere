// The committed tables are exactly what the upstream files and our patches make (build.ts --check), and every upstream
// file is the one pinned in sources.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UPSTREAM, readSources, sha256 } from "../gen/upstream.ts";

test("upstream files are the pinned ones", () => {
  for (const [p, h] of Object.entries(readSources().files)) assert.equal(sha256(readFileSync(join(UPSTREAM, p))), h, p);
});

test("src/ is what upstream/ and patches/ make", () => {
  execFileSync(process.execPath, [join(import.meta.dirname, "../gen/build.ts"), "--check"], { stdio: "inherit" });
});
