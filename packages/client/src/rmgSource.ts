// The random map templates' bytes, for the page and the game server's worker alike (no DOM here).
import { rmgBundleWithVcmi } from "@heroes/core";

/** /res/rmgtemplates.txt, else the original's RMG.TXT; with HotA's from VCMI's files when it has none of HotA's own. */
export async function rmgTemplatesFrom(get: (name: string) => Promise<Uint8Array | undefined>): Promise<Uint8Array | undefined> {
  const bundle = await get("rmgtemplates.txt");
  return rmgBundleWithVcmi(bundle, bundle ? undefined : await get("rmg.txt"), get);
}
