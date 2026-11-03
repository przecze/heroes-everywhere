// Games' timelines kept on the server (src/timeline/), so a game's points reach the player's other
// devices: each game a folder with its entry and its points' list (index.json) and one file per point
// (the packed state, whole or the change from the point before). Points only ever get added, so two
// devices playing on from the same point just make two branches.
//
//   GET    /__timeline                  every game's entry, newest first
//   GET    /__timeline/<game>           { game, points } (the points' descriptors)
//   GET    /__timeline/<game>/<point>   the point's packed state (bytes)
//   PUT    /__timeline/<game>/<point>   JSON { game, point, data: base64, moves?: base64 } (adds the point, updates the
//                                       entry; the moves that led to it, if any, kept beside it as <point>.moves.gz)
//   DELETE /__timeline/<game>           the game and all its points (its name kept in .deleted.json)
//   GET    /__timeline?deleted=1        the names of games deleted here, so other devices forget their copies
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { savesDir } from "./paths.ts";
import { json, pathOf, readBytes, urlOf } from "./http.ts";
import { allow, folderUse, grew } from "./limits.ts";

/** A point's body at most (a whole state packed is some 10-60 KB). */
const MAX = 4 * 1024 * 1024;
/** What one player's timelines may take in all. */
export const TIMELINE_QUOTA = { tester: 200 * 1024 ** 2, owner: 2 * 1024 ** 3 };
const NAME = /^[\w.-]{1,100}$/;

interface Index {
  game: Record<string, unknown> & { updatedAt?: number };
  points: (Record<string, unknown> & { id: string })[];
}

const readIndex = (dir: string): Index | null => {
  try {
    return JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8")) as Index;
  } catch {
    return null;
  }
};

/** Written whole, then moved in place: a reader never sees half of it. */
const writeWhole = (file: string, body: string | Buffer) => {
  writeFileSync(`${file}.tmp`, body);
  renameSync(`${file}.tmp`, file);
};

/** Games deleted on the server (by a device, or by hand on the server): other devices forget their own copies. */
const DELETED = ".deleted.json";
const readDeleted = (root: string): string[] => {
  try {
    const list = JSON.parse(readFileSync(resolve(root, DELETED), "utf8")) as unknown;
    return Array.isArray(list) ? list.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
};
const writeDeleted = (root: string, list: string[]) => {
  mkdirSync(root, { recursive: true });
  writeWhole(resolve(root, DELETED), JSON.stringify([...new Set(list)].slice(-2000)));
};

export function timelineApi(req: IncomingMessage, res: ServerResponse, sub = "") {
  // A player's own folder (vite.config.ts), else the owner's.
  const root = resolve(savesDir(), sub, "timeline");
  const [game, point, ...rest] = pathOf(req).split("/").filter(Boolean).map(decodeURIComponent);
  if (rest.length || (game && !NAME.test(game)) || (point && !NAME.test(point))) return json(res, { error: "bad name" }, 400);
  if (!game) {
    if (req.method !== "GET") return json(res, { error: "GET the list" }, 405);
    if (urlOf(req).searchParams.has("deleted")) return json(res, readDeleted(root));
    const games = existsSync(root)
      ? readdirSync(root)
          .map((g) => readIndex(resolve(root, g))?.game)
          .filter((g): g is Index["game"] => !!g)
      : [];
    return json(res, games.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
  }
  const dir = resolve(root, game);
  if (!point) {
    if (req.method === "GET") {
      const index = readIndex(dir);
      return index ? json(res, index) : json(res, { error: "no such game" }, 404);
    }
    if (req.method === "DELETE") {
      rmSync(dir, { recursive: true, force: true });
      writeDeleted(root, [...readDeleted(root), game]);
      return json(res, { deleted: game });
    }
    return json(res, { error: "GET or DELETE" }, 405);
  }
  const file = resolve(dir, `${point}.gz`);
  if (req.method === "GET") {
    if (!existsSync(file)) return json(res, { error: "no such point" }, 404);
    res.setHeader("content-type", "application/octet-stream");
    // (A point never changes once made.)
    res.setHeader("cache-control", "private, max-age=31536000, immutable");
    return void res.end(readFileSync(file));
  }
  if (req.method !== "PUT") return json(res, { error: "GET or PUT" }, 405);
  if (!allow(`timeline|${sub || "owner"}`, 600, 60_000)) return json(res, { error: "saving too often" }, 429);
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > MAX * 1.4) return json(res, { error: "too big" }, 413);
  if (folderUse(root).bytes + declared > (sub.startsWith("tester-") ? TIMELINE_QUOTA.tester : TIMELINE_QUOTA.owner)) return json(res, { error: "your games take too much room; delete some" }, 507);
  readBytes(req, MAX * 1.4).then(
    (raw) => {
      try {
        const body = JSON.parse(raw.toString("utf8")) as { game?: Index["game"]; point?: Index["points"][number]; data?: string; moves?: string };
        if (!body.game || !body.point || body.point.id !== point || typeof body.data !== "string") return json(res, { error: "game, point and data" }, 400);
        const bytes = Buffer.from(body.data, "base64");
        mkdirSync(dir, { recursive: true });
        writeWhole(file, bytes);
        // (A game played on after it was deleted somewhere is no longer deleted.)
        const deleted = readDeleted(root);
        if (deleted.includes(game)) writeDeleted(root, deleted.filter((g) => g !== game));
        // The player's moves that led to the point (src/timeline/moves.ts), beside it: how people play, for the AI.
        const moves = typeof body.moves === "string" ? Buffer.from(body.moves, "base64") : undefined;
        if (moves) writeWhole(resolve(dir, `${point}.moves.gz`), moves);
        const index = readIndex(dir) ?? { game: body.game, points: [] };
        // (The device's own markers stay at home: where it is in the game, what it has yet to send.)
        const { head: _h, ...entry } = body.game as Index["game"] & { head?: unknown };
        const { unsent: _u, movesUnsent: _m, ...desc } = body.point as Index["points"][number] & { unsent?: unknown; movesUnsent?: unknown };
        if (!index.points.some((p) => p.id === point)) index.points.push(desc);
        // The entry follows the newest point (another device may have sent a newer one before).
        if ((entry.updatedAt ?? 0) >= (index.game.updatedAt ?? 0)) index.game = entry;
        writeWhole(resolve(dir, "index.json"), JSON.stringify(index));
        grew(root, bytes.length + (moves?.length ?? 0));
        json(res, { saved: point, ...(moves ? { moves: true } : {}) });
      } catch (err) {
        json(res, { error: String(err instanceof Error ? err.message : err) }, 400);
      }
    },
    () => json(res, { error: "too big" }, 413),
  );
}
