// Single player: the authoritative game server runs here, off the main thread.
import { GAME_LINE_FILES, buildGameData, campaignScenarioMap, parseCampaignRef } from "@heroes/core";
import { parseH3m } from "@heroes/formats";
import { type ClientMessage, GameServer } from "@heroes/server";
import { localizeCreatures } from "./i18n/creatures.ts";
import { localizeMap } from "./i18n/mapText.ts";
import { loadReleaseNames, localizeNames } from "./i18n/names.ts";
import { rmgTemplatesFrom } from "./rmgSource.ts";
import { fetchRetry } from "./net.ts";
import { release } from "./i18n/languages.ts";
import { releaseText } from "./i18n/release.ts";

const res = async (name: string) => {
  const r = await fetchRetry(`/res/${name}`);
  if (!r.ok) throw new Error(`missing game file ${name}`);
  return new Uint8Array(await r.arrayBuffer());
};

/** The player's language, from the page (connection.ts). */
const language = new URL(self.location.href).searchParams.get("lang") ?? "en";

async function loadMap(file: string) {
  // A campaign scenario: the map inside the .h3c from the game's archives.
  const camp = parseCampaignRef(file);
  if (camp) return campaignScenarioMap(await res(`${camp.file}.h3c`), camp.scenario);
  const r = await fetchRetry(`/maps/${encodeURIComponent(file)}`);
  if (!r.ok) throw new Error(`map ${file} not found`);
  const stream = (await r.blob()).stream().pipeThrough(new DecompressionStream("gzip"));
  return localizeMap(parseH3m(new Uint8Array(await new Response(stream).arrayBuffer())), file, language);
}

const FILES = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits", ...GAME_LINE_FILES] as const;
// TOWNNAME.TXT names the towns a map leaves unnamed; without it they go by their type.
// (In a language with its own release's files, its own TOWNNAME: languages.ts release.)
const townName = (release(language) ? releaseText(language, "townname.txt") : Promise.resolve(undefined)).then(
  (own) => own ?? fetchRetry("/res/townname.txt").then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined)).catch(() => undefined),
);
// The random map templates (HotA's, else the original's RMG.TXT): the same the page has, so both make the same maps.
const optional = (name: string) => fetchRetry(`/res/${name}`).then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined)).catch(() => undefined);
const rmg = rmgTemplatesFrom(optional);
const start = () => Promise.all([Promise.all(FILES.map((f) => res(`${f}.txt`))), townName, rmg, loadReleaseNames(language)]).then(([bytes, townname, rmg]) => {
  const files = { ...(Object.fromEntries(FILES.map((f, i) => [f, bytes[i]])) as Record<(typeof FILES)[number], Uint8Array>), townname, rmg };
  // A message for one seat: the whole game rides along with every adventure update, for saving
  // (only the first human's used to carry it, so the others saved nothing and a reload restarted).
  // Names in the player's language too: the game's own messages ("... gains the Shield of the Damned") are made here.
  const data = buildGameData(files);
  localizeCreatures(data.creatures, language);
  localizeNames(data, language);
  const server: GameServer = new GameServer(data, loadMap, (msg, to) => {
    postMessage({ msg, to, full: msg.t === "adv" && to !== undefined ? server.state : undefined });
  });
  return server;
});

// (The game's files failed to load even after the retries: the next message tries again.)
let ready = start();
const serverReady = () =>
  ready.catch(() => {
    ready = start();
    return ready;
  });

// Messages are handled strictly in order, even though some (map loading) are async; one that
// fails doesn't stop the ones after it.
let queue = Promise.resolve();
onmessage = (e: MessageEvent<{ msg: ClientMessage; seat?: number }>) => {
  queue = queue.then(async () => (await serverReady()).handle(e.data.msg, e.data.seat)).catch((err) => {
      console.error("game server:", err);
      postMessage({ msg: { t: "error", message: "The game's files didn't load: check the connection and try again." } });
    });
};
