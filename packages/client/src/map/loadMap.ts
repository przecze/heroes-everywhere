// Reads a map for the adventure screen: a map file from the server, or one made here (a random map,
// a test scene, an occasion, a strategy case, a campaign's scenario).
import {
  PORTALS_TOUR,
  campaignScenarioMap,
  generateOccasion,
  generateRandomMap,
  generateScene,
  generateStrategy,
  parseCampaignRef,
  parseOccasionName,
  parseRandomMapName,
  parseSceneName,
  parseStrategyName,
} from "@heroes/core";
import { type H3Map, parseH3m } from "@heroes/formats";
import { loadData } from "../gameData.ts";
import { fetchRes } from "../assets.ts";
import { fetchRetry } from "../net.ts";
import { lang, tr } from "../i18n/index.ts";
import { localizeMap } from "../i18n/mapText.ts";
import { terrainLook } from "./terrainLook.ts";

async function gunzip(bytes: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function loadMap(file: string): Promise<H3Map> {
  const random = parseRandomMapName(file);
  if (random) return generateRandomMap(await loadData(), random, await terrainLook());
  const scene = parseSceneName(file);
  if (scene) {
    const m = generateScene(await loadData(), scene, await terrainLook());
    // (The portals tour is for players, not only for checking: its words in their language.)
    // The scenes most played from the Wiki: their guide in the player's language too.
    const radius = /^Step up into the place above you( and beat its guards: from the top of the tower|:) the fog lifts in a circle (\d+) tiles around( it)?\. Now you see only (\d+) tiles around you and a little around your town; the map beyond the circle stays dark\.$/.exec(m.description ?? "");
    if (radius) m.description = radius[1] === ":" ? tr("Step up into the place above you: the fog lifts in a circle %1 tiles around. Now you see only %2 tiles around you and a little around your town; the map beyond the circle stays dark.", radius[2], radius[4]) : tr("Step up into the place above you and beat its guards: from the top of the tower the fog lifts in a circle %1 tiles around it. Now you see only %2 tiles around you and a little around your town; the map beyond the circle stays dark.", radius[2], radius[4]);
    else if (m.description === "Step up into the place above you and see what it does.") m.description = tr("Step up into the place above you and see what it does.");
    else if (m.description === "Step up to it: the quest asks for 5 wood, which you have; hand it over for 1000 gold.") m.description = tr("Step up to it: the quest asks for 5 wood, which you have; hand it over for 1000 gold.");
    else if (m.description === "Step up into the gate: it takes you underground, to its other end.") m.description = tr("Step up into the gate: it takes you underground, to its other end.");
    if (scene.kind === "object" && scene.id === 45 && (scene.sub ?? 0) >= PORTALS_TOUR)
      m.description = tr("Five monoliths of one colour stand about this map, most of them in the fog, and a one-way portal to your right leads to three exits. Step into the monolith above you again and again: with Settings → Additions → Monoliths' exits in turn on, each trip takes you to the next exit in order, so after five trips you have stood at every one. Hold (or right-click) a monolith or the portal: lines show where it leads, the next exit marked.");
    return m;
  }
  const occasion = parseOccasionName(file);
  if (occasion) return generateOccasion(await loadData(), occasion, await terrainLook());
  if (parseStrategyName(file)) return generateStrategy(await loadData(), file);
  const camp = parseCampaignRef(file);
  if (camp) return campaignScenarioMap(await fetchRes(`${camp.file}.h3c`), camp.scenario);
  const res = await fetchRetry(`/maps/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`map ${file} not found`);
  return localizeMap(parseH3m(await gunzip(await res.arrayBuffer())), file, lang());
}
