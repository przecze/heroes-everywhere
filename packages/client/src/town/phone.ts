// Phones (upright and sideways, one-handed too): what the two arrangements of the town share. The whole town drawn
// off screen and swapped in at once, the backdrop round the picture and the picture's box, the treasury opened and
// closed, the resource the town's best creatures cost. The arrangements: phoneFrame.ts (the default) and
// phoneFloating.ts (EXTRAS townFloating).
import { TOWNS, levelCount, type AdvObject, ownTowns } from "@heroes/core";
import { BlurFilter, Container, Graphics, Sprite } from "pixi.js";
import { extra } from "../settings.ts";
import { GOLD } from "../ui/blocks/resourceBar.ts";
import { advRim } from "../ui/blocks/advFrame.ts";
import { screenSize } from "../ui/screen.ts";
import { townBackground } from "./art.ts";
import type { PhoneLayout } from "./phoneLayout.ts";
import type { TownScreen } from "./screen.ts";

export class TownPhone {
  /** The treasury's other rows shown. */
  treasuryOpen = false;
  private treasuryClosed = 0;
  private treasuryGen = 0;
  private backKey = "";

  private readonly town: TownScreen;
  constructor(town: TownScreen) {
    this.town = town;
  }

  /**
   * Phones: behind the picture, the frame (the original's dialog background in the player's border, as the
   * desktop's panel) or the picture's own blurred, dimmed copy filling the screen; the picture kept in its box
   * when zoomed.
   */
  async drawWhole(owner: number) {
    const town = this.town;
    const s = town.state!;
    const o = s.objects[town.objectId];
    const towns = ownTowns(s, owner);
    const step = (d: number) => {
      const i = towns.findIndex((x) => x.id === o.id);
      const next = towns[(i + d + towns.length) % towns.length];
      if (next && next.id !== o.id && town.world) void town.show(s, town.world, next.id);
    };
    const next = new Container();
    next.label = town.touchShown.label;
    town.touch = next;
    await (extra("townFloating") ? town.floating.draw(towns.length > 1 ? step : null) : town.frame.draw(towns.length > 1 ? step : null));
    // (Swapped in even if a newer draw waits: it is whole, and the newer one draws only if something changed.)
    if (town.root.destroyed) return void next.destroy({ children: true });
    const old = town.touchShown;
    town.root.addChildAt(next, town.root.getChildIndex(old));
    old.destroy({ children: true });
    town.touchShown = next;
  }

  async drawBackdrop(o: AdvObject, L: PhoneLayout) {
    const town = this.town;
    const W = 800 + 2 * screenSize.ox;
    const H = screenSize.h;
    const key = `${o.subid}:${o.owner}:${L.floating}:${W}:${H}`;
    if (key !== this.backKey) {
      this.backKey = key;
      town.back.removeChildren().forEach((c) => c.destroy({ children: true }));
      if (L.floating) {
        const tex = await townBackground(TOWNS[o.subid]?.background ?? "").catch(() => null);
        if (tex) {
          const sp = new Sprite(tex);
          const k = Math.max(W / tex.width, H / tex.height) * 1.1;
          sp.scale.set(k);
          sp.position.set(-screenSize.ox + (W - tex.width * k) / 2, -screenSize.oy + (H - tex.height * k) / 2);
          sp.tint = 0x6a6a6a;
          sp.filters = [new BlurFilter({ strength: 12, quality: 3 })];
          town.back.addChild(sp);
        }
      } else town.back.addChild(new Graphics().rect(-screenSize.ox, -screenSize.oy, W, H).fill(0x000000));
    }
    // The picture's box, with the adventure map's rim round it in the frame.
    town.picMask.clear().rect(L.picX, L.picY, 800 * L.k, 374 * L.k).fill(0xffffff);
    if (!L.floating) {
      const rim = await advRim(800 * L.k, 374 * L.k, Math.max(0, o.owner));
      rim.position.set(L.picX, L.picY);
      town.touch.addChild(rim);
    }
  }

  /** The resource the town's best creatures (or their upgrades) cost beside gold (-1: none). */
  townResource(o: AdvObject): number {
    const w = this.town.world;
    if (!w) return -1;
    // (Upgrades too: an Ancient Behemoth takes crystal where the Behemoth doesn't.)
    for (let level = levelCount(o) - 1; level >= 0; level--)
      for (const id of [...(TOWNS[o.subid]?.creatures[level] ?? [])].reverse()) {
        const r = w.creatures[id]?.cost.findIndex((n, i) => i !== GOLD && n > 0) ?? -1;
        if (r >= 0) return r;
      }
    return -1;
  }

  /** Phones: the treasury's other rows opened or closed; open, the next tap anywhere closes it. */
  toggleTreasury() {
    const town = this.town;
    if (performance.now() - this.treasuryClosed < 100) return;
    this.treasuryOpen = !this.treasuryOpen;
    void town.drawTouch();
    if (!this.treasuryOpen) return;
    // (A look: it goes by itself too.)
    const opened = ++this.treasuryGen;
    setTimeout(() => opened === this.treasuryGen && this.treasuryOpen && ((this.treasuryOpen = false), void town.drawTouch()), 6000);
    setTimeout(() =>
      window.addEventListener(
        "pointerup",
        () => {
          if (!this.treasuryOpen) return;
          this.treasuryOpen = false;
          this.treasuryClosed = performance.now();
          void town.drawTouch();
        },
        { capture: true, once: true },
      ),
    );
  }
}
