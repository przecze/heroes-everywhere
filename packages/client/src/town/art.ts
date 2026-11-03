// Where the town screen's art comes from.
import { type DefTextures, loadDef, loadImage, loadPng } from "../assets.ts";
import type { Texture } from "pixi.js";

/**
 * HotA's redrawn art for the classic towns (the HotA Crew's fixes, shipped with VCMI's HotA mod as
 * heroes3DataPatch): townData names it by its path there. Without the mod, the original's file of
 * the same name.
 */
const PATCH = "mods/heroes3datapatch/content/";
export const unpatched = (name: string) => (name.toLowerCase().startsWith(PATCH) ? name.slice(name.lastIndexOf("/") + 1).replace(/\.png$/i, "") : null);

/** A town's backdrop: a PNG by path (HotA's), else the original's PCX. */
export function townBackground(name: string): Promise<Texture> {
  if (!name.includes("/")) return loadImage(name);
  const png = loadPng(`${name.toLowerCase().replace(/\.png$/, "")}.png`);
  const base = unpatched(name);
  return base ? png.catch(() => loadImage(`${base}.pcx`)) : png;
}

/** A building's animation on the town screen. */
export function townDef(def: string): Promise<DefTextures> {
  const base = unpatched(def);
  return base ? loadDef(`${def}.def`).catch(() => loadDef(`${base}.def`)) : loadDef(`${def}.def`);
}
