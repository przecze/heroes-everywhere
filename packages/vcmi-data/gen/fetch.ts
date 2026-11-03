// The open-source release's way to the upstream files: each one in sources.json fetched from its public repository at
// the pinned commit (raw.githubusercontent.com) and checked against its sha256 before it is kept. A file already there
// with the right hash is left alone; a wrong hash stops everything.
//   node packages/vcmi-data/gen/fetch.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { UPSTREAM, readSources, sha256 } from "./upstream.ts";

const s = readSources();
const todo = Object.entries(s.files).filter(([p, h]) => !existsSync(join(UPSTREAM, p)) || sha256(readFileSync(join(UPSTREAM, p))) !== h);
let done = 0;
async function one([path, hash]: [string, string]) {
  const [top, ...rest] = path.split("/");
  const src = s[top as "vcmi" | "hota-mod"];
  const url = `https://raw.githubusercontent.com/${src.repo}/${src.sha}/${rest.map(encodeURIComponent).join("/")}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const body = Buffer.from(await r.arrayBuffer());
      if (sha256(body) !== hash) throw Object.assign(new Error(`${path}: sha256 ${sha256(body)} is not the pinned ${hash}`), { fatal: true });
      mkdirSync(dirname(join(UPSTREAM, path)), { recursive: true });
      writeFileSync(join(UPSTREAM, path), body);
      done++;
      return;
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal || attempt >= 8) throw new Error(`${url}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1000 * Math.min(30, 2 ** attempt)));
    }
  }
}
const queue = [...todo];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await one(queue.shift()!); }));
console.log(`upstream: ${done} fetched, ${Object.keys(s.files).length - todo.length} already there (VCMI ${s.vcmi.sha.slice(0, 7)}, HotA mod ${s["hota-mod"].sha.slice(0, 7)})`);
