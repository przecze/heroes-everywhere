// The game files, read straight from the extracted installers and served to the page: /res/ (the LODs' files, by name),
// /maps/, /music/, /video/ (Bink films as WebM), and the lists the page asks for (maps-info, offline-index...).
// Shared by the dev and deployed servers (vite.config.ts) and the open-source release's own server config.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Connect, Plugin } from "vite";
import { ResourceStore } from "../formats/src/node.ts";
import { parseH3m } from "../formats/src/h3m.ts";
import { gunzipSync, gzip, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

// Game files are read straight from the extracted installers (locally, and on the owner-only deployment).
const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter(Boolean);
const musicDirs = (process.env.HEROES_MUSIC_DIRS ?? "").split(":").filter(Boolean);
const mapDirs = (process.env.HEROES_MAP_DIRS ?? "").split(":").filter(Boolean);
/** What /res/ sends gzipped: the original's own formats and texts (PNGs, sounds and videos are compressed already). */
const COMPRESSIBLE = /\.(def|pcx|txt|fnt|pal|json|msk|msg|h3c|lod)$/i;
const gzipped = new Map<string, Promise<Buffer | null>>();

/** Case-insensitive file lookup across a list of directories. */
function findFile(dirs: string[], name: string): string | undefined {
  const want = name.toLowerCase();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const hit = readdirSync(dir).find((f) => f.toLowerCase() === want);
    if (hit) return resolve(dir, hit);
  }
  return undefined;
}

export function gameData(): Plugin {
  const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
  return {
    name: "heroes-game-data",
    configureServer: (server) => install(server.middlewares),
    configurePreviewServer: (server) => install(server.middlewares),
  };
  function install(middlewares: Connect.Server) {
    // Everything the game can load, with sizes, for "Play offline" (src/offline.ts): game files,
    // maps, music and videos (their size before conversion, a fair guess at the WebM's).
    middlewares.use("/offline-index", (_req, res) => {
      const sized = (dirs: string[], ext: RegExp) =>
        dirs.flatMap((d) => (existsSync(d) ? readdirSync(d).filter((f) => ext.test(f)).map((f) => ({ name: f, size: statSync(resolve(d, f)).size })) : []));
      const all = store.list();
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          // Each file once (a loose file's other names in `same`, served from the one kept), the mod's screenshots left out.
          res: all.filter((e) => !e.same && !/\.(bik|smk)$/.test(e.name) && !/(^|\/)screenshots\//.test(e.name)).map((e) => ({ name: e.name, size: e.size })),
          same: Object.fromEntries(all.filter((e) => e.same).map((e) => [e.name, e.same])),
          maps: sized(mapDirs, /\.(h3m|tut)$/i),
          music: sized(musicDirs, /\.mp3$/i),
          video: all.filter((e) => /\.(bik|smk)$/.test(e.name)).map((e) => ({ name: e.name.replace(/\.(bik|smk)$/, ""), size: e.size })),
        }),
      );
    });
    middlewares.use("/res-index", (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(store.list()));
    });
    const serveFile = (dirs: string[], type: string) => (req: { url?: string }, res: import("node:http").ServerResponse) => {
      const file = findFile(dirs, decodeURIComponent((req.url ?? "").replace(/^\//, "").split("?")[0]));
      if (!file) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("content-type", type);
      res.setHeader("cache-control", "private, max-age=3600");
      res.end(readFileSync(file));
    };
    middlewares.use("/music/", serveFile(musicDirs, "audio/mpeg"));
    middlewares.use("/maps/", serveFile(mapDirs, "application/octet-stream"));
    // Map headers for the scenario selection screen, parsed once and cached.
    const infoCache = resolve(import.meta.dirname, "../../.cache/maps-info-v2.json");
    let mapsInfo: unknown[] | null = null;
    let mapsInfoBody: { etag: string; json: string; gz: Buffer } | null = null;
    middlewares.use("/maps-info", (_req, res) => {
      if (!mapsInfo && existsSync(infoCache)) mapsInfo = JSON.parse(readFileSync(infoCache, "utf8"));
      if (!mapsInfo) {
        mapsInfo = [];
        for (const d of mapDirs) {
          if (!existsSync(d)) continue;
          for (const file of readdirSync(d).filter((f) => f.toLowerCase().endsWith(".h3m")).sort()) {
            try {
              const m = parseH3m(gunzipSync(readFileSync(resolve(d, file))));
              mapsInfo.push({
                file,
                name: m.name,
                description: m.description,
                size: m.size,
                levels: m.levels,
                version: m.version,
                hota: m.hotaVersion,
                difficulty: m.difficulty,
                victory: m.victory.type,
                loss: m.loss.type,
                players: m.players.map((p) => ({
                  human: p.canHuman,
                  computer: p.canComputer,
                  team: p.team,
                  factions: p.allowedFactions ?? 0,
                  randomFaction: !!p.randomFaction,
                  town: !!p.mainTown,
                  chooseHero: !!p.mainTown?.generateHero || !!p.randomHero,
                })),
              });
            } catch {
              // unreadable map: left out
            }
          }
        }
        mkdirSync(resolve(infoCache, ".."), { recursive: true });
        writeFileSync(infoCache, JSON.stringify(mapsInfo));
      }
      // Some 270 KB, fetched for every New Game: compressed once, and answered with "unchanged" when
      // the browser has it already.
      mapsInfoBody ??= ((json) => ({ etag: `"${createHash("sha1").update(json).digest("hex").slice(0, 16)}"`, json, gz: gzipSync(json) }))(JSON.stringify(mapsInfo));
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "private, no-cache");
      res.setHeader("etag", mapsInfoBody.etag);
      res.setHeader("vary", "accept-encoding");
      if (_req.headers["if-none-match"] === mapsInfoBody.etag) {
        res.statusCode = 304;
        return void res.end();
      }
      if (/\bgzip\b/.test(String(_req.headers["accept-encoding"] ?? ""))) {
        res.setHeader("content-encoding", "gzip");
        return void res.end(mapsInfoBody.gz);
      }
      res.end(mapsInfoBody.json);
    });
    middlewares.use("/maps-index", (_req, res) => {
      const files = mapDirs.flatMap((d) => (existsSync(d) ? readdirSync(d).filter((f) => f.toLowerCase().endsWith(".h3m")) : []));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(files.sort()));
    });
    // Bink/Smacker videos from the VID archives, converted to WebM once and cached.
    const videoCache = resolve(import.meta.dirname, "../../.cache/video");
    // (Converted off the event loop: a first conversion takes long, and a blocked server stalled
    // every other request meanwhile, such as the name box after the score screen's film.)
    const converting = new Map<string, Promise<string>>();
    const convert = (name: string, src: Uint8Array, out: string) => {
      let job = converting.get(name);
      if (!job) {
        mkdirSync(videoCache, { recursive: true });
        const tmp = resolve(videoCache, `${name}.src`);
        writeFileSync(tmp, src);
        job = new Promise<string>((done) => {
          const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, "-c:v", "libvpx", "-b:v", "1M", "-c:a", "libvorbis", `${out}.part.webm`]);
          let err = "";
          p.stderr.on("data", (d) => (err += d));
          p.on("error", (e) => done(String(e)));
          p.on("close", (code) => {
            if (code === 0) renameSync(`${out}.part.webm`, out);
            done(code === 0 ? "" : err || `exit ${code}`);
          });
        }).finally(() => converting.delete(name));
        converting.set(name, job);
      }
      return job;
    };
    middlewares.use("/video/", async (req, res) => {
      const name = decodeURIComponent((req.url ?? "").replace(/^\//, "").split("?")[0]).toLowerCase().replace(/\.webm$/, "");
      const out = resolve(videoCache, `${name}.webm`);
      if (!existsSync(out)) {
        const src = store.get(`${name}.bik`) ?? store.get(`${name}.smk`);
        if (!src) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const failed = await convert(name, src, out);
        if (failed) {
          res.statusCode = 500;
          res.end(`ffmpeg failed: ${failed}`);
          return;
        }
      }
      res.setHeader("content-type", "video/webm");
      res.setHeader("cache-control", "private, max-age=86400");
      res.end(readFileSync(out));
    });
    middlewares.use("/res/", (req, res) => {
      const [path, query = ""] = (req.url ?? "").replace(/^\//, "").split("?");
      const name = decodeURIComponent(path);
      // "?original": the original game's own file where HotA's replaced it (the About window's credits roll).
      const original = /(^|&)original\b/.test(query);
      const data = original ? store.original(name) : store.get(name);
      if (!data) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("content-type", "application/octet-stream");
      res.setHeader("cache-control", "private, max-age=3600");
      // The original's pictures and texts shrink a third (texts and fonts to a seventh) gzipped, and
      // the proxy in front leaves "octet-stream" as it is: a map's first load is ~9 MB of them on a
      // phone. Compressed once per file, kept.
      if (COMPRESSIBLE.test(name) && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
        res.setHeader("vary", "accept-encoding");
        const key = original ? `original:${name}` : name;
        let z = gzipped.get(key);
        if (!z) gzipped.set(key, (z = new Promise((ok) => gzip(data, { level: 6 }, (err, out) => ok(err ? null : out)))));
        void z.then((out) => {
          if (out && out.length < data.length * 0.95) {
            res.setHeader("content-encoding", "gzip");
            res.end(out);
          } else res.end(data);
        });
        return;
      }
      res.end(data);
    });
  }
}

