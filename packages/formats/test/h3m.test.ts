// Parses every map shipped with the game, when the game files are present.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { parseH3m } from "../src/index.ts";

const dirs = (process.env.HEROES_MAP_DIRS ?? "").split(":").filter((d) => d && existsSync(d));

test("parses the game's maps", { skip: dirs.length === 0 && "no map dirs (HEROES_MAP_DIRS)" }, () => {
  const failures: string[] = [];
  let ok = 0;
  let skipped = 0;
  for (const dir of dirs) {
    // (And the tutorials: HotA's, a 1.8 map with script variables, among them.)
    for (const file of readdirSync(dir).filter((f) => /\.(h3m|tut)$/i.test(f))) {
      try {
        const map = parseH3m(gunzipSync(readFileSync(join(dir, file))));
        assert.equal(map.tiles.length, map.levels * map.size * map.size);
        ok++;
      } catch (err) {
        const msg = String(err);
        if (msg.includes("not supported yet")) skipped++;
        else failures.push(`${file}: ${msg}`);
      }
    }
  }
  console.log(`parsed ${ok} maps, skipped ${skipped} unsupported HotA maps`);
  assert.deepEqual(failures, []);
});
