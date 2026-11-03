// Games kept on the server, so a game started on one device carries on on another (the owner's
// devices only: the access gate stands in front, as for everything). Each device's running game is
// slot "current-<device>", saved games "save-<name>"; a slot is its meta (for the list) and its state.
//
//   GET /__saves            every slot's meta, newest first
//   GET /__saves/<slot>     one slot: { meta, state }
//   PUT /__saves/<slot>     store one (JSON { meta, state }, up to 32 MB)
//   PATCH /__saves/<slot>?kept=1   mark it kept ("my games"; kept=0 unmarks)
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { savesDir } from "./paths.ts";
import { json, param, readBytes } from "./http.ts";
import { SAVES_FILES, SAVES_QUOTA, allow, folderUse, grew } from "./limits.ts";

const ROOT = savesDir();
const MAX = 32 * 1024 * 1024;

export function savesApi(req: IncomingMessage, res: ServerResponse, sub = "") {
  // A player's own folder (vite.config.ts), else the owner's.
  const dir = sub ? resolve(ROOT, sub) : ROOT;
  const slot = decodeURIComponent((req.url ?? "/").split("?")[0].replace(/^\//, ""));
  if (!slot) {
    if (req.method !== "GET") return json(res, { error: "GET the list" }, 405);
    const metas = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".meta.json"))
          .map((f) => {
            try {
              return { slot: f.slice(0, -".meta.json".length), ...JSON.parse(readFileSync(resolve(dir, f), "utf8")) };
            } catch {
              return null;
            }
          })
          .filter(Boolean)
      : [];
    return json(res, metas.sort((a, b) => (b?.savedAt ?? 0) - (a?.savedAt ?? 0)));
  }
  if (!/^[\w-]{1,100}$/.test(slot)) return json(res, { error: "bad slot name" }, 400);
  const file = resolve(dir, `${slot}.json`);
  if (req.method === "GET") return existsSync(file) ? json(res, readFileSync(file, "utf8")) : json(res, { error: "no such save" }, 404);
  // "My games": kept or not (only the meta changes; the game stays as it is).
  if (req.method === "PATCH") {
    const metaFile = resolve(dir, `${slot}.meta.json`);
    if (!existsSync(metaFile)) return json(res, { error: "no such save" }, 404);
    const kept = param(req, "kept") === "1";
    const meta = { ...JSON.parse(readFileSync(metaFile, "utf8")), kept };
    writeFileSync(metaFile, JSON.stringify(meta));
    return json(res, { slot, kept });
  }
  if (req.method !== "PUT") return json(res, { error: "GET, PUT or PATCH" }, 405);
  if (!allow(`saves|${sub || "owner"}`, 300, 60_000)) return json(res, { error: "saving too often" }, 429);
  // Room: a player's games take a bounded share of the volume, and only so many of them.
  const use = folderUse(dir);
  const quota = sub ? SAVES_QUOTA.tester : SAVES_QUOTA.owner;
  const declared = Number(req.headers["content-length"] ?? 0);
  const replacing = existsSync(file) ? statSync(file).size : 0;
  if (declared > MAX) return json(res, { error: "too big" }, 413);
  if (use.bytes - replacing + declared > quota || (sub && !replacing && use.files + 2 > SAVES_FILES)) return json(res, { error: "your saved games take too much room; delete some" }, 507);
  readBytes(req, MAX).then(
    (raw) => {
      const size = raw.length;
      try {
        const body = raw.toString("utf8");
        const { meta } = JSON.parse(body) as { meta?: Record<string, unknown> };
        mkdirSync(dir, { recursive: true });
        // Written whole, then moved in place: a reader never sees half a game.
        writeFileSync(`${file}.tmp`, body);
        renameSync(`${file}.tmp`, file);
        grew(dir, Math.max(0, size - replacing));
        // (A game marked kept stays kept as it goes on being played.)
        const metaFile = resolve(dir, `${slot}.meta.json`);
        let kept = false;
        try {
          kept = !!JSON.parse(readFileSync(metaFile, "utf8")).kept;
        } catch {}
        writeFileSync(metaFile, JSON.stringify({ ...meta, size, ...(kept ? { kept } : {}) }));
        json(res, { saved: slot });
      } catch (err) {
        json(res, { error: String(err instanceof Error ? err.message : err) }, 400);
      }
    },
    () => json(res, { error: "too big" }, 413),
  );
}
