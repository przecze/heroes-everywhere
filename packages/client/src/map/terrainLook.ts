// Random maps draw their terrain edges as the original maps do: the pictures are learnt from up
// to 16 classic maps on the first random map of a page (core's learnTerrainLook).
import { type TerrainLook, learnTerrainLook } from "@heroes/core";
import { type H3Map, parseH3m } from "@heroes/formats";
import { fetchRetry } from "../net.ts";

let look: Promise<TerrainLook | undefined> | null = null;

async function fetchMap(file: string): Promise<H3Map | null> {
  try {
    const res = await fetchRetry(`/maps/${encodeURIComponent(file)}`);
    if (!res.ok) return null;
    const stream = (await res.blob()).stream().pipeThrough(new DecompressionStream("gzip"));
    return parseH3m(new Uint8Array(await new Response(stream).arrayBuffer()));
  } catch {
    return null;
  }
}

export function terrainLook(): Promise<TerrainLook | undefined> {
  look ??= (async () => {
    try {
      const info = (await (await fetchRetry("/maps-info")).json()) as { file: string; hota?: number }[];
      const files = info.filter((m) => !m.hota).map((m) => m.file).slice(0, 16);
      const maps = (await Promise.all(files.map(fetchMap))).filter((m): m is H3Map => !!m);
      return maps.length ? learnTerrainLook(maps) : undefined;
    } catch {
      return undefined;
    }
  })();
  return look;
}
