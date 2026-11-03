// Build-time plugins every build of the page needs (the deployed one and the open-source release's).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { createHash } from "node:crypto";

/**
 * The game's worker (single player's server) as a second entry of the page's own build, not a build
 * of its own: the rules both run (packages/core, formats, server) then ship once, in a chunk both
 * import, instead of twice (~150 KB less gzipped to download, and to upload: scripts/agent.py deploy).
 * The page takes the worker's address from "virtual:heroes-server-worker" (connection.ts); in the dev
 * server it is Vite's own worker address.
 */
export function serverWorker(): Plugin {
  const ID = "virtual:heroes-server-worker";
  let ref = "";
  let build = false;
  return {
    name: "heroes-server-worker",
    configResolved(config) {
      build = config.command === "build";
    },
    buildStart() {
      if (build) ref = this.emitFile({ type: "chunk", id: resolve(import.meta.dirname, "src/server.worker.ts"), name: "server.worker" });
    },
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    load(id) {
      if (id !== `\0${ID}`) return undefined;
      return build ? `export default import.meta.ROLLUP_FILE_URL_${ref};` : `export default "/src/server.worker.ts?worker_file&type=module";`;
    },
  };
}

/** The build's own files, listed (app-files.json) for "Play offline" to fetch them all ahead (src/offline.ts). */
export function appFiles(): Plugin {
  return {
    name: "heroes-app-files",
    apply: "build",
    generateBundle(_options, bundle) {
      // (Not the on-device speech model's runtime, ~22 MB: it's fetched, and kept, only where voice notes use it: feedback/whisper.ts.)
      this.emitFile({ type: "asset", fileName: "app-files.json", source: JSON.stringify(Object.keys(bundle).filter((f) => f.startsWith("assets/") && !/ort-wasm/.test(f))) });
    },
  };
}

/**
 * Subresource integrity: the page's own script, preloads and style tags in index.html carry the sha384 of the file
 * as it was built, so a file changed after the build (on a disk, in a cache, on the way) isn't run (docs/supply-chain.md).
 * Taken from the written files, after every other plugin is done with them. (The chunks those import later have no
 * tag to carry it: browsers check those only through an import map's integrity, not used here.)
 */
export function integrity(): Plugin {
  let base = "/";
  return {
    name: "heroes-integrity",
    apply: "build",
    configResolved: (config) => void (base = config.base),
    writeBundle(opts) {
      const dir = opts.dir;
      const page = dir && resolve(dir, "index.html");
      if (!page || !existsSync(page)) return;
      const html = readFileSync(page, "utf8").replace(/<(script|link)\b([^>]*?)\s(src|href)="([^"]+)"([^>]*)>/g, (tag, name: string, before: string, attr: string, url: string, after: string) => {
        if (!url.startsWith(`${base}assets/`) || /\bintegrity=/.test(tag)) return tag;
        if (name === "link" && !/rel="(stylesheet|modulepreload)"/.test(tag)) return tag;
        const file = resolve(dir, url.slice(base.length));
        if (!existsSync(file)) return tag;
        const hash = createHash("sha384").update(readFileSync(file)).digest("base64");
        return `<${name}${before} ${attr}="${url}"${after.replace(/\s*\/?$/, "")} integrity="sha384-${hash}">`;
      });
      writeFileSync(page, html);
    },
  };
}

