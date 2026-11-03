// A language's own release's files (languages.ts release), served beside the game at /l10n/<lang>/ (l10nArt.ts).
// Kept apart from assets.ts: the game server's worker reads them too (names.ts), without the page's drawing.
import { fetchRetry } from "../net.ts";
import { release } from "./languages.ts";

/**
 * A text file of language `l`'s own release (/l10n/<l>/text/, l10nArt.ts), once per page: its code page read and
 * handed on as UTF-8 behind a byte order mark, which every reader of the game's texts takes for UTF-8
 * (formats decodeText). Undefined when the server doesn't have it.
 */
const releaseTexts = new Map<string, Promise<Uint8Array | undefined>>();
export function releaseText(l: string, name: string): Promise<Uint8Array | undefined> {
  const key = `${l}/${name.toLowerCase()}`;
  let p = releaseTexts.get(key);
  if (!p) {
    p = fetchRetry(`/l10n/${l}/text/${encodeURIComponent(name.toLowerCase())}`)
      .then(async (res) => {
        if (!res.ok || res.headers.get("content-type")?.startsWith("text/html")) return undefined;
        return new TextEncoder().encode("\uFEFF" + new TextDecoder(release(l)!.encoding).decode(await res.arrayBuffer()));
      })
      .catch(() => undefined);
    releaseTexts.set(key, p);
  }
  return p;
}

/** A file of the server's game files (the English release's), for the worker and the tables made in both. */
export async function englishFile(name: string): Promise<Uint8Array> {
  const res = await fetchRetry(`/res/${encodeURIComponent(name.toLowerCase())}`);
  if (!res.ok || res.headers.get("content-type")?.startsWith("text/html")) throw new Error(`missing game file ${name}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** A language with its own release's files: the creatures' names, plurals and ability lines from its CRTRAITS, by key
 *  (filled by names.ts loadReleaseNames; read by creatures.ts). */
export const RELEASE_CREATURES: Record<string, Record<string, [string, string, string?]>> = {};
/** And its towns' names, by faction (towns.ts). */
export const RELEASE_TOWNS: Record<string, Record<string, string>> = {};
