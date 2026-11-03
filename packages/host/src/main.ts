// Multiplayer host: WebSocket rooms, each running an authoritative GameServer (rooms.ts).
// Dev: proxied by Vite under /mp. Room states are saved so restarts don't lose games.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { type IncomingMessage, createServer } from "node:http";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { GAME_LINE_FILES, buildGameData, campaignScenarioMap, generateRandomMap, generateOccasion, generateScene, parseCampaignRef, parseOccasionName, parseStrategyName, generateStrategy, parseRandomMapName, parseSceneName } from "@heroes/core";
import { parseH3m } from "@heroes/formats";
import { ResourceStore } from "@heroes/formats/node";
import { WebSocketServer } from "ws";
import { notify } from "../../client/push.ts";
import { Rooms } from "./rooms.ts";

const PORT = Number(process.env.HOST_PORT ?? 8081);
const dataDirs = (process.env.HEROES_DATA_DIRS ?? "").split(":").filter(Boolean);
const mapDirs = (process.env.HEROES_MAP_DIRS ?? "").split(":").filter(Boolean);

const store = new ResourceStore(dataDirs, (process.env.HEROES_LOOSE_DIRS ?? "").split(":").filter(Boolean));
const FILES = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
// (TOWNNAME.TXT names the towns a map leaves unnamed, as the browser's game server does.)
const data = buildGameData({ ...(Object.fromEntries(FILES.map((f) => [f, store.get(`${f}.txt`)!])) as Record<(typeof FILES)[number], Uint8Array>), townname: store.get("townname.txt"), rmg: store.get("rmgtemplates.txt") });

function mapPath(file: string): string | undefined {
  for (const d of mapDirs) {
    const hit = existsSync(d) && readdirSync(d).find((f) => f.toLowerCase() === file.toLowerCase());
    if (hit) return join(d, hit);
  }
  return undefined;
}

async function loadMap(file: string) {
  // Random maps (and the advanced starts) are made from their names, as the game server does.
  const random = parseRandomMapName(file);
  if (random) return generateRandomMap(data, random);
  const scene = parseSceneName(file);
  if (scene) return generateScene(data, scene);
  const occasion = parseOccasionName(file);
  if (occasion) return generateOccasion(data, occasion);
  if (parseStrategyName(file)) return generateStrategy(data, file);
  const camp = parseCampaignRef(file);
  if (camp) return campaignScenarioMap(store.get(`${camp.file}.h3c`)!, camp.scenario);
  const p = mapPath(file);
  if (!p) throw new Error(`map ${file} not found`);
  return parseH3m(gunzipSync(readFileSync(p)));
}

// A friend's turn in a game played by notification: their devices ring (push.ts, shared with the page server).
const rooms = new Rooms({
  data,
  loadMap,
  dir: resolve(process.env.HEROES_ROOMS_DIR ?? "rooms"),
  notify: (key, note) => void notify(key, note).catch((err) => console.error("push:", err)),
});
await rooms.restore();
// Rooms left behind are cleared now and every ten minutes (KEEP_MS in rooms.ts).
const swept = rooms.sweep();
if (swept) console.log(`cleared ${swept} rooms left behind`);
setInterval(() => rooms.sweep(), 600_000).unref();

const http = createServer((_req, res) => {
  res.end("Heroes multiplayer host");
});
// (A browser's messages are small: a few hundred bytes, a chat line at most.)
const wss = new WebSocketServer({ server: http, path: "/mp", maxPayload: 64 * 1024 });
// A phone that sleeps or drops off the network leaves its socket open without a word: the host would count
// its player as here and never tell them of their turn. Each socket is pinged; one silent for a round goes.
const alive = new WeakSet<object>();
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 30_000).unref();
wss.on("connection", (ws, req) => {
  alive.add(ws);
  ws.on("pong", () => alive.add(ws));
  const c = rooms.connect((m) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  }, playerFrom(req));
  // Messages are handled in order per connection.
  let queue = Promise.resolve();
  ws.on("message", (raw) => {
    queue = queue.then(async () => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      await rooms.message(c, m);
      // A connection that keeps flooding after being told goes.
      if (rooms.flooding(c)) ws.close(1008, "too many messages");
    });
  });
  ws.on("close", () => {
    queue = queue.then(() => rooms.disconnect(c));
  });
});
/** Who is playing, as the page server in front says (vite.config.ts multiplayer(); only it can reach this port). */
function playerFrom(req: IncomingMessage): { key: string; name: string } | undefined {
  const raw = req.headers["x-heroes-player"];
  if (typeof raw !== "string") return undefined;
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { key?: unknown; name?: unknown };
    return typeof p.key === "string" && typeof p.name === "string" ? { key: p.key.slice(0, 80), name: p.name.slice(0, 40) } : undefined;
  } catch {
    return undefined;
  }
}

// (Only the page server on this machine talks to the host: it says who each player is.)
http.listen(PORT, process.env.HOST_BIND ?? "127.0.0.1", () => console.log(`multiplayer host on :${PORT}, ${rooms.rooms.size} saved rooms`));
