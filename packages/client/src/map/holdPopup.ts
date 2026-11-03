// The original's right-click popups on the adventure screen: shown while the button (the finger)
// is held, by the pointer or where a `place` puts it; and the battle's hero panel (CHRPOP) for our
// heroes in the side list (EXTRAS heroListPanel).
import { type AdventureState, type Hero, type World, effectivePrimary, heroMoraleLuck, maxMana } from "@heroes/core";
import { type Application, Container } from "pixi.js";
import { heroPortrait } from "../assets.ts";
import { HERO_INFO_PHONE_H, HERO_INFO_PHONE_W, drawHeroPanel } from "../battle/heroInfo.ts";
import { screenSize, touchScale } from "../ui/screen.ts";
import { untilReleased } from "../touch.ts";
import { placePopup } from "../ui/blocks/popupPlace.ts";

export type Place = (frame: Container) => void;

export class HoldPopup {
  private popup: Container | null = null;
  private asked = 0;
  private readonly app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  close() {
    this.asked++;
    this.popup?.destroy({ children: true });
    this.popup = null;
    this.app.canvas.classList.remove("popupHeld");
  }

  /** Open (a touch screen's stays until the next tap: `close` it then, and that tap does nothing more). */
  get open() {
    return !!this.popup;
  }

  /**
   * Shows what `build` makes around a canvas point until the button lets go, also when that comes first. On a touch
   * screen it stays after the finger lifts (2026-10-25: it was under the finger, and read only while held) and
   * stands clear of the finger: in the half of the screen away from it, unless `place` puts it elsewhere.
   */
  async show(build: () => Promise<Container | null>, x: number, y: number, place?: Place) {
    this.close();
    const asked = this.asked;
    const stays = screenSize.touch;
    if (!stays) untilReleased(() => asked === this.asked && this.close());
    const frame = await build();
    if (!frame) return;
    if (asked !== this.asked) return void frame.destroy({ children: true });
    const { screen } = this.app;
    if (place) place(frame);
    else if (stays) {
      frame.scale.set(touchScale(frame.width, frame.height));
      // (In the middle of the half away from the finger.)
      const half = screen.height / 2;
      placePopup(frame, { at: { x: screen.width / 2, y: y > half ? half / 2 : half + half / 2 } });
    } else {
      frame.scale.set(touchScale(frame.width, frame.height));
      placePopup(frame, { at: { x, y } });
    }
    this.popup = frame;
    this.app.stage.addChild(frame);
    // (The cursor hidden while it's up, as the original's right-click windows: it stood over the town's pop-up.)
    if (!stays) this.app.canvas.classList.add("popupHeld");
  }

  /** In the middle of the screen, scaled for touch. */
  centre: Place = (frame) => {
    frame.scale.set(touchScale(frame.width, frame.height));
    placePopup(frame);
  };

  /** The hero panel: left of the list on the desktop, in the middle and readable on touch screens. */
  heroPanelAt = (x: number, y: number): Place => (frame) => {
    const { screen } = this.app;
    if (screenSize.touch) {
      // Upright the screen is 800 game pixels across: room for it bigger.
      const k = Math.max(1.25, Math.min(screenSize.portrait ? 2.4 : 1.75, (screen.height - 16) / HERO_INFO_PHONE_H, (screen.width - 16) / HERO_INFO_PHONE_W));
      frame.scale.set(k);
      placePopup(frame);
    } else placePopup(frame, { from: { x: x - 12, y: y - 12, w: 24, h: 24 }, sides: ["left", "right"], gap: 12 });
  };
}

/** The battle's hero panel (CHRPOP) for a hero on the map. */
export async function heroPanel(s: AdventureState, w: World, h: Hero): Promise<Container> {
  const ml = heroMoraleLuck(s, w, h);
  const portrait = await heroPortrait(h).catch(() => null);
  const frame = new Container();
  await drawHeroPanel(frame, { owner: h.owner, name: h.name, primary: effectivePrimary(h), ...ml, mana: h.mana ?? 0, maxMana: maxMana(h), portrait }, screenSize.touch);
  return frame;
}
