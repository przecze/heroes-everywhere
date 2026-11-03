// A creature on its town's backdrop, animated as the original's windows show it (VCMI's
// CCreaturePic and CCreatureAnim): the recruit, hire and split windows, the creature window and
// popup (the 100 x 130 backdrop), the Fort's dwelling overview (the 100 x 120 one).
import type { CreatureStats } from "@heroes/core";
import { Container, Graphics, Sprite, type Texture, Ticker } from "pixi.js";
import { type DefTextures, loadDef, loadImage, loadPng } from "../assets.ts";
import { nextPreview } from "./creaturePreview.ts";

/** Backdrops of the original towns: crbkg* (130 high) and tpcas* (120 high) + this suffix. */
const SUFFIX: Record<string, string> = {
  castle: "cas", rampart: "ram", tower: "tow", inferno: "inf", necropolis: "nec", dungeon: "dun", stronghold: "str", fortress: "for", conflux: "ele",
};
/** The HotA towns' backdrops (the mod's faction configs: creatureBackground 120px / 130px). */
const HOTA: Record<string, [string, string]> = {
  cove: ["hota/cove/creaturebg120px.png", "hota/cove/creaturebg130px.png"],
  bulwark: ["hota/bulwark/creaturebg120px.png", "hota/bulwark/creaturebg130px.png"],
  factory: ["hota/factory/tpcasfac.png", "hota/factory/crbkgfac.png"],
};

/** The faction's backdrop: big (130 high, CRBKG) or small (120 high, TPCAS); neutral when missing. */
export function creatureBackdrop(faction: string, big: boolean): Promise<Texture> {
  // HotA redrew the classic ones (its towns' new looks): the HotA mod's heroes3DataPatch has them,
  // else the original's.
  const classic = (name: string) => loadPng(`mods/heroes3datapatch/content/data/${name}.png`).catch(() => loadImage(`${name}.pcx`));
  const neutral = () => classic(big ? "crbkgneu" : "tpcasneu");
  const hota = HOTA[faction];
  if (hota) return loadPng(hota[big ? 1 : 0]).catch(neutral);
  const s = SUFFIX[faction];
  return s ? classic(`${big ? "crbkg" : "tpcas"}${s}`).catch(neutral) : neutral();
}

const HOLDING = 2;
const MOVING = 0;
/** The original plays these at 100 ms a frame whatever the battle speed. */
const FRAME_MS = 100;

/** Plays a creature DEF in a box the way the original's creature pictures do, until destroyed. */
function animate(sp: Sprite, frames: DefTextures, warMachine: boolean, dx: number) {
  const has = (g: number) => frames.get(g)?.length ?? 0;
  const show = (g: number, k: number) => {
    const f = frames.get(g)?.[k];
    if (!f) return;
    sp.texture = f.texture;
    sp.position.set(f.x - dx, f.y - 155);
  };
  let group = has(HOLDING) ? HOLDING : MOVING;
  let k = 0;
  let t = 0;
  const queue: number[] = [];
  show(group, 0);
  const tick = (tk: Ticker) => {
    if (sp.destroyed) return void Ticker.shared.remove(tick);
    t += tk.deltaMS;
    while (t >= FRAME_MS) {
      t -= FRAME_MS;
      if (++k < has(group)) continue;
      // The animation ended: the next one queued, else a new pick (VCMI's reset and its callback).
      if (!queue.length) queue.push(...nextPreview(has, warMachine, group, Math.random()));
      let g = queue.shift();
      while (g !== undefined && !has(g)) g = queue.shift();
      group = g ?? (has(HOLDING) ? HOLDING : MOVING);
      k = 0;
    }
    show(group, k);
  };
  Ticker.shared.add(tick);
}

/**
 * The picture: the backdrop with the creature's DEF drawn so that its canvas point (150, 155) (170
 * for two-hex creatures) sits at the box's corner, clipped to the box (VCMI's CCreaturePic).
 */
export async function creaturePic(c: CreatureStats, big = true): Promise<Container> {
  const card = new Container();
  const [bgTex, frames] = await Promise.all([creatureBackdrop(c.faction, big), loadDef(c.def).catch(() => null)]);
  const bg = new Sprite(bgTex);
  card.addChild(bg);
  if (!frames || !(frames.get(HOLDING)?.length || frames.get(MOVING)?.length)) return card;
  const mask = new Graphics().rect(0, 0, bg.width, bg.height).fill(0xffffff);
  const sp = new Sprite();
  sp.mask = mask;
  card.addChild(mask, sp);
  const wide = c.abilities.some((a) => a.type === "DOUBLE_WIDE");
  const machine = c.abilities.some((a) => a.type === "SIEGE_WEAPON");
  animate(sp, frames, machine, wide ? 170 : 150);
  return card;
}
