// The small pieces every server-side endpoint file here shares (gate, review, push, saves, agent,
// notes): answering with JSON, reading a request's body, its path and query.
import type { IncomingMessage, ServerResponse } from "node:http";

/** Answers with `value` as JSON (a string is sent as it is), never cached. */
export function json(res: ServerResponse, value: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(typeof value === "string" ? value : JSON.stringify(value));
}

/** Ends the request with a bare status (403 by default): no body, nothing to learn. */
export const refuse = (res: ServerResponse, status = 403) => void ((res.statusCode = status), res.end());

/** The request's body as text; whatever comes past `limit` characters is dropped. */
export const readText = (req: IncomingMessage, limit = 64 * 1024) =>
  new Promise<string>((done) => {
    let b = "";
    req.on("data", (c) => b.length < limit && (b += c));
    req.on("end", () => done(b));
  });

/** The request's body as bytes; a body over `limit` fails (and the request is cut off). */
export function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    let n = 0;
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > limit) {
        fail(new Error("too large"));
        req.destroy();
      } else parts.push(c);
    });
    req.on("end", () => ok(Buffer.concat(parts)));
    req.on("error", fail);
  });
}

/** The request's URL, parsed (the path is relative to where the middleware is mounted). */
export const urlOf = (req: IncomingMessage) => new URL(req.url ?? "/", "http://x");
/** The request's path without a trailing slash. */
export const pathOf = (req: IncomingMessage) => urlOf(req).pathname.replace(/\/$/, "");
/** One query parameter ("" when absent). */
export const param = (req: IncomingMessage, name: string) => urlOf(req).searchParams.get(name) ?? "";

/** The content types the built files come with (serve.ts, agentApi.ts's live builds). */
export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown",
};

/** How long a built file may be kept: the hashed assets for ever, the pages and the service worker checked each time,
 *  the rest (l10n/<lang>/index.json, the pack's art, the maps' texts) an hour, as they may change with a build. */
export const cacheControl = (path: string) =>
  path.startsWith("/assets/") ? "private, max-age=31536000, immutable" : /^\/[^/]+\.(html|js|json|webmanifest)$/.test(path) ? "no-cache" : "private, max-age=3600";
