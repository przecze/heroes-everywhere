// The game's page and its server: the game files (gameFiles.ts), saved games and their timelines shared by every
// device that opens this server (savesApi.ts, timelineApi.ts), the setup page and language packs (setupPage.ts), and multiplayer (packages/host, started beside it,
// reached through /mp). No accounts: whoever can open the page can play, so keep the server to yourself
// (your own computer or network, or a password in front of it).
import type { IncomingMessage } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import type { Connect, Plugin, UserConfig } from "vite";
import { gameData } from "./gameFiles.ts";
import { appFiles, integrity, serverWorker } from "./buildPlugins.ts";
import { savesApi } from "./savesApi.ts";
import { timelineApi } from "./timelineApi.ts";
import { setupPage } from "./setupPage.ts";

function games(): Plugin {
  const install = (m: Connect.Server) => {
    // The page asks "who is this?" to tell whether the server is reachable; here nobody in particular.
    m.use("/__whoami", (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end("null");
    });
    m.use("/__saves", (req, res) => savesApi(req, res));
    m.use("/__timeline", (req, res) => timelineApi(req, res));
  };
  return { name: "games", configureServer: (s) => install(s.middlewares), configurePreviewServer: (s) => install(s.middlewares) };
}

function multiplayer(): Plugin {
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!(req.url ?? "").startsWith("/mp")) return;
    const upstream = connect(Number(process.env.HOST_PORT ?? 8081), "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const drop = () => (upstream.destroy(), socket.destroy());
    upstream.on("error", drop);
    socket.on("error", drop);
  };
  return {
    name: "multiplayer",
    configureServer: (s) => void s.httpServer?.on("upgrade", upgrade),
    configurePreviewServer: (s) => void s.httpServer?.on("upgrade", upgrade),
  };
}

// (A plain object, not Vite's defineConfig: serve.ts loads this file without Vite installed.)
export default {
  define: { __BUILT__: JSON.stringify(new Date().toISOString().slice(0, 16)) },
  plugins: [gameData(), setupPage(), games(), multiplayer(), appFiles(), serverWorker(), integrity()],
  // The names this server answers to besides localhost and plain addresses (PUBLIC_HOST, comma-separated).
  preview: { allowedHosts: (process.env.PUBLIC_HOST ?? "").split(",").filter(Boolean) },
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 4000 },
} satisfies UserConfig;
