// The town's buttons as the original draws them, for a tablet's side buttons and the floating phone town's bar.
import { B, MACHINE_CREATURE, blacksmithMachine, fortLevel, hallLevel, type AdvObject, type World } from "@heroes/core";
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { creaturePortrait, loadDef } from "../assets.ts";
import { YELLOW } from "../text.ts";
import { DefButton, label } from "../ui/kit.ts";
import { buildingIcons } from "./windows.ts";
import { said } from "../i18n/index.ts";

/**
 * Phones: the bar's buttons as the original draws them: the town panel's hall and fort icons; the same for every
 * town from the original's own buttons (the battle's spellbook, the kingdom overview's heroes with a plus for the
 * Tavern, the market's trade); the Blacksmith's war machine, the Shipyard's boat, the hall's pictures of the rest;
 * the exit and split buttons (TSBTNS), the hero list's arrows to the other towns. Null for one without art.
 */
export async function barIcons(w: World, o: AdvObject): Promise<(title: string, fn: () => void, id?: number) => Promise<Container | null>> {
  const t = o.town!;
  const [hallDef, castle, icons] = await Promise.all([loadDef("itmtl.def").catch(() => null), loadDef("itmcl.def").catch(() => null), buildingIcons(o)]);
  const H = 52;
  const tile = (tex: Texture | undefined, fn: () => void) => {
    if (!tex) return null;
    const c = new Container();
    const sp = new Sprite(tex);
    sp.scale.set(H / tex.height);
    // The town hall's gold frame, as its building tiles.
    c.addChild(new Graphics().rect(-1, -1, sp.width + 2, H + 2).fill({ color: 0, alpha: 0.6 }).stroke({ color: 0xc9a046, width: 2 }), sp);
    c.eventMode = "static";
    c.cursor = "pointer";
    c.on("pointerdown", () => (sp.tint = 0xa0a0a0));
    c.on("pointerup", () => (sp.tint = 0xffffff));
    c.on("pointerupoutside", () => (sp.tint = 0xffffff));
    c.on("pointertap", (e) => e.button !== 2 && fn());
    return c;
  };
  // (Plain buttons stay the original's colours: only the town's own exit and split take the player's.)
  const def = async (file: string, order: number[], fn: () => void, coloured = false) => {
    const b = new DefButton(file, 0, 0, coloured ? Math.max(0, o.owner) : -1, order);
    await b.ready;
    b.scale.set(1.5);
    b.onClick = fn;
    return b as Container;
  };
  const hall = hallLevel(t.built);
  const fort = fortLevel(t.built);
  return async (title, fn, id) => {
    if (id === B.BLACKSMITH) {
      const c = w.creatures[MACHINE_CREATURE[blacksmithMachine(o)]];
      return tile(c ? ((await creaturePortrait(c, "large")) ?? undefined) : undefined, fn) ?? tile(icons(id)?.texture, fn);
    }
    if (id === B.SHIPYARD) {
      const boat = (await loadDef("cradvntr.def").catch(() => null))?.get(0)?.[6];
      const b = tile(boat?.texture, fn);
      return b ?? tile(icons(id)?.texture, fn);
    }
    if (id !== undefined) return tile(icons(id)?.texture, fn);
    switch (title) {
      case "Build":
        return tile(hallDef?.get(0)?.[Math.max(0, hall)]?.texture, fn);
      case "Recruit all":
        return tile(castle?.get(0)?.[Math.max(0, fort - 1)]?.texture, fn);
      case "Mage Guild":
        return def("icm005.def", [0, 1, 2, 3], fn);
      case "Tavern": {
        // A hero to hire: the kingdom overview's heroes with a plus.
        const b = await def("ovbutn1.def", [0, 1, 2, 0], fn);
        const plus = label(said("+"), "bigfont", YELLOW);
        plus.position.set(2, -4);
        b.addChild(plus);
        return b;
      }
      case "Market":
        return def("tpmrkbu5.def", [0, 1, 0, 0], fn);
      case "Leave town":
        return def("tsbtns.def", [4, 5], fn, true);
      case "Split":
        return def("tsbtns.def", [0, 1, 2, 3], fn, true);
      // (Left and right, as the framed town's ‹ ›: the big white up/down arrows are only the lists'.)
      case "Previous town":
        return def("hsbtns3.def", [0, 1, 2, 3], fn);
      case "Next town":
        return def("hsbtns5.def", [0, 1, 2, 3], fn);
    }
    return null;
  };
}
