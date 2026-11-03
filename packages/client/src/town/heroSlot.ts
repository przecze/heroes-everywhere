// A hero's place in the town (the garrison's and the visiting hero's), the same on every layout.
import { garrisonHero, visitingHero, type AdvObject } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { heroPortrait, loadDef } from "../assets.ts";
import { resolveText, textTable } from "../ui/gameText.ts";
import { part, TOWNSCRN } from "../ui/blocks/windowParts.ts";
import { screenSize } from "../ui/screen.ts";
import type { TownScreen } from "./screen.ts";
import { tr, fallback } from "../i18n/index.ts";

/**
 * A hero's place (the garrison's above, the visiting hero's below), the same on every layout: the portrait, or
 * the player's banner (CREST58, as HotA) where the garrison has none. A tap picks the hero; a tap on the other
 * place then swaps them (the one going up takes the garrison's troops); the picked one again opens the two
 * heroes' exchange (Shift, or no second hero: the hero screen). A long press opens the hero screen (the exchange
 * when both places hold a hero).
 */
export async function heroSlot(town: TownScreen, o: AdvObject, which: "up" | "down", redraw: () => void, small = false): Promise<Container> {
  const s = town.state!;
  const w = town.world!;
  const hero = visitingHero(s, w, o);
  const above = garrisonHero(s, o);
  const h = which === "up" ? above : hero;
  const tc = await textTable("tcommand");
  const empty = (await resolveText({ file: "genrltxt", id: 507 }))?.trim() || fallback("Empty");
  const slot = new Container();
  slot.label = h ? `hero: ${h.name}` : which === "up" ? "hero place: garrison" : "hero place: visiting";
  // (Small: the hero list's portrait, 48 x 32, for the phone's band between the two rows.)
  const [pw, ph] = small ? [48, 32] : [58, 64];
  // (Big: on the town panel's place, as the original's first of each row.)
  const box = small ? null : await part(TOWNSCRN, "slot", Math.max(0, o.owner));
  if (box) slot.addChild(Object.assign(box, { x: -1, y: -1 }));
  slot.addChild(new Graphics().rect(0, 0, pw, ph).fill(small ? { color: 0, alpha: 0.6 } : { color: 0, alpha: 0.001 }));
  const portrait = h ? await heroPortrait(h, small ? "small" : undefined).catch(() => null) : null;
  if (portrait) slot.addChild(Object.assign(new Sprite(portrait), { width: pw, height: ph }));
  else if (which === "up") {
    const crest = (await loadDef("crest58.def").catch(() => null))?.get(0)?.[Math.max(0, o.owner)];
    if (crest && small) {
      const c = new Sprite(crest.texture);
      c.scale.set(ph / Math.max(crest.texture.height, 1));
      c.position.set(Math.round((pw - c.width) / 2), 0);
      slot.addChild(c);
    } else if (crest) slot.addChild(Object.assign(new Sprite(crest.texture), { x: crest.x, y: crest.y }));
  }
  if (town.heroPick === which) slot.addChild(new Graphics().rect(0, 0, pw, ph).stroke({ color: 0xffff00, width: 2 }));
  slot.eventMode = "static";
  slot.cursor = "pointer";
  // (TCOMMAND 4 "View %s" for the picked one, 7 "Exchange %s with %s", 12 / 32 "Select %s (in garrison / visiting)", 6 "Move %s" to an empty place.)
  slot.on("pointerover", () => {
    const picked = town.heroPick === "up" ? above : town.heroPick === "down" ? hero : null;
    town.setStatus(
      h
        ? town.heroPick === which
          ? tc(4, tr(`View %1`, h.name), h.name)
          : picked
            ? tc(7, tr(`Exchange %1 with %2`, picked.name, h.name), picked.name, h.name)
            : which === "up"
              ? tc(12, tr(`Select %1 (in garrison)`, h.name), h.name)
              : tc(32, tr(`Select %1 (visiting)`, h.name), h.name)
        : picked
          ? tc(6, tr(`Move %1`, picked.name), picked.name)
          : empty,
    );
  });
  // Touch: a long press (the right button) opens the hero's screen; with a hero in the other place too, the two
  // side by side in the exchange (2026-10-25: no point in the one hero's screen there).
  slot.on("pointerdown", (e) => {
    if (e.button !== 2 || !h || !screenSize.touch || !town.onHero) return;
    town.heroPick = null;
    if (above && hero && town.onExchange) town.onExchange(above.id, hero.id, town.modals);
    else town.onHero(h.id, town.modals);
  });
  slot.on("pointertap", (e) => {
    if (e.button === 2) return;
    // The picked hero clicked again: the two heroes' exchange when the other place holds one too (Shift: the hero
    // screen), else the hero screen (VCMI's CHeroGSlot::clickPressed).
    const other = which === "up" ? hero : above;
    if (h && town.heroPick === which && other && !e.shiftKey && town.onExchange) {
      town.heroPick = null;
      town.onExchange(above!.id, hero!.id, town.modals);
    } else if (h && town.heroPick === which && town.onHero) {
      town.heroPick = null;
      town.onHero(h.id, town.modals);
    } else if (town.heroPick && town.heroPick !== which) {
      town.heroPick = null;
      town.send({ type: "swapGarrison", town: o.id });
    } else town.heroPick = h && town.heroPick !== which ? which : null;
    redraw();
  });
  return slot;
}
