// The deployed game's web server (Dockerfile.prod; `vite preview` until 2026-10-27): the endpoints vite.config.ts's
// plugins add (their configurePreviewServer hooks, in Vite's order) and the built files (dist/), on Node's own http.
// So the server runs no build tool: Vite, Rollup, esbuild's binary and their packages stay in the image's build step,
// and of npm's packages only `ws` (the multiplayer host) is loaded at runtime (docs/supply-chain.md;
// test/serve.test.ts keeps it so).
//   node serve.ts            PORT (8080), on every interface
import { existsSync, statSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { extname, resolve } from "node:path";
import type { Plugin, UserConfig } from "vite";
import { CONTENT_TYPES, cacheControl } from "./http.ts";
import { cspReport, securityHeaders } from "./securityHeaders.ts";

type Next = (err?: unknown) => void;
export type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

/** Connect's `use`, as the plugins call it: a handler for every request, or for a path and what's under it (which
 *  then sees req.url without the path, as with Connect). */
export function middlewares() {
  const stack: { route: string; fn: Handler }[] = [];
  const app = {
    use(route: string | Handler, fn?: Handler) {
      if (typeof route === "function") stack.push({ route: "", fn: route });
      else stack.push({ route: route.replace(/\/$/, "").toLowerCase(), fn: fn! });
      return app;
    },
    handle(req: IncomingMessage, res: ServerResponse, done: Next) {
      const url = req.url ?? "/";
      const path = url.split("?")[0].toLowerCase();
      let i = 0;
      const next: Next = (err) => {
        req.url = url;
        if (err) return done(err);
        const layer = stack[i++];
        if (!layer) return done();
        if (layer.route) {
          const after = path[layer.route.length];
          if (!path.startsWith(layer.route) || (after !== undefined && after !== "/" && after !== ".")) return next();
          const rest = url.slice(layer.route.length);
          req.url = rest.startsWith("/") ? rest : `/${rest}`;
        }
        try {
          layer.fn(req, res, next);
        } catch (e) {
          next(e);
        }
      };
      next();
    },
  };
  return app;
}

/** Vite's own check of the Host header (DNS rebinding): the named host, localhost and plain addresses. */
export function hostAllowed(host: string | undefined, allowed: string[]): boolean {
  if (host === undefined) return true;
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return isIP(h.slice(1, h.indexOf("]"))) === 6;
  const name = h.split(":")[0];
  return isIP(name) === 4 || name === "localhost" || name.endsWith(".localhost") || allowed.includes(name);
}

/** The built files; a page address with no file of its own (anything but the hashed assets) gets index.html. */
export function builtFiles(dist: string): Handler {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      return void ((res.statusCode = 400), res.end());
    }
    let file = resolve(dist, `.${path}`);
    if (file !== dist && !file.startsWith(`${dist}/`)) return next();
    if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (path.startsWith("/assets/") || !String(req.headers.accept ?? "").includes("text/html")) return next();
      file = resolve(dist, "index.html");
      if (!existsSync(file)) return next();
    }
    const st = statSync(file);
    const etag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
    res.setHeader("etag", etag);
    res.setHeader("content-type", CONTENT_TYPES[extname(file)] ?? "application/octet-stream");
    res.setHeader("cache-control", cacheControl(file === resolve(dist, "index.html") ? "/index.html" : path));
    if (req.headers["if-none-match"] === etag) return void ((res.statusCode = 304), res.end());
    res.setHeader("content-length", st.size);
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  };
}

/** The plugins in Vite's order: `enforce: "pre"` first, then the rest, then `"post"`. */
const ordered = (plugins: Plugin[]) => [...plugins.filter((p) => p.enforce === "pre"), ...plugins.filter((p) => !p.enforce), ...plugins.filter((p) => p.enforce === "post")];

export async function start(config: UserConfig, dist: string, port: number) {
  const app = middlewares();
  const httpServer = createServer((req, res) => {
    securityHeaders(res);
    app.handle(req, res, (err) => {
      if (err) console.error(`[serve] ${req.method} ${req.url}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      if (res.headersSent) return void res.end();
      res.statusCode = err ? 500 : 404;
      res.end();
    });
  });
  const allowed = (config.preview?.allowedHosts ?? []) as string[];
  app.use((req, res, next) => (hostAllowed(req.headers.host, allowed) ? next() : void ((res.statusCode = 403), res.end("Blocked request: this host isn't allowed."))));
  app.use("/__csp", cspReport);
  const server = { middlewares: app, httpServer, config };
  const after: (() => void)[] = [];
  for (const p of ordered((config.plugins ?? []).flat() as Plugin[])) {
    const hook = p.configurePreviewServer;
    const fn = typeof hook === "function" ? hook : hook?.handler;
    const post = await (fn as ((s: unknown) => unknown) | undefined)?.call({}, server);
    if (typeof post === "function") after.push(post as () => void);
  }
  app.use(builtFiles(dist));
  for (const f of after) f();
  await new Promise<void>((ok) => httpServer.listen(port, "0.0.0.0", ok));
  console.log(`[serve] ${dist} on ${port}`);
  return httpServer;
}

if (import.meta.main) {
  const { default: config } = await import("./vite.config.ts");
  await start(config, resolve(import.meta.dirname, "dist"), Number(process.env.PORT ?? 8080));
}
