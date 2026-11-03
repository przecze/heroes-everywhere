// The touch HUD's minimap: its small picture as a widget (the white frame of what is in view on it), and the big one a
// tap on it opens, with the surface / underground button.
import type { AdventureState, World } from "@heroes/core";
import type { H3Map } from "@heroes/formats";
import { Container, Graphics, Sprite } from "pixi.js";
import { placePopup } from "../../ui/blocks/popupPlace.ts";
import type { Side } from "../../ui/blocks/popupBox.ts";
import { DefButton } from "../../ui/kit.ts";
import { screenSize } from "../../ui/screen.ts";
import { track } from "../../usage.ts";
import { Minimap } from "../minimap.ts";
import type { MobileHud } from "../mobileHud.ts";
import { GAP, K, backing } from "./look.ts";

export class MinimapWidget {
  readonly map = new Minimap(240);
  /** The big minimap, opened beside the small one. */
  readonly box = new Container();
  open = false;
  /** The small picture (follows the minimap's, which is replaced on every redraw) and its side. */
  thumb: Sprite | null = null;
  thumbSide = 64;
  private thumbFrame: Graphics | null = null;
  private view: { x: number; y: number; w: number; h: number } | null = null;
  private mapTiles = 1;
  /** How many levels the map has (surface / underground is greyed on a map of one, as the desktop's). */
  private levels = 1;

  private readonly hud: MobileHud;
  constructor(hud: MobileHud) {
    this.hud = hud;
    // The finger holds the frame's bottom-left corner, not its middle: dragged, the frame stays beside the thumb in sight
    // instead of under it, about a thumb's size as it is (2026-10-31 21:04).
    this.map.onPick = (x, y) => {
      const v = this.view;
      hud.onMinimap(v ? x + v.w / 2 : x, v ? y - v.h / 2 : y);
    };
    this.box.label = "panel: minimap";
    this.box.visible = false;
  }

  /** The small picture's widget, `side` HUD pixels: a tap shows the big one. */
  thumbWidget(side: number): Container {
    const mini = new Container();
    mini.label = "button: minimap";
    const thumb = new Sprite(this.map.texture);
    this.thumb = thumb;
    thumb.width = side;
    thumb.height = side;
    this.thumbSide = side;
    // The white frame of what is in view, on the small picture too (the owner: it shows where you are).
    const frame = new Graphics();
    this.thumbFrame = frame;
    mini.addChild(Object.assign(backing(side + 2 * GAP, side + 2 * GAP), { x: -GAP, y: -GAP }), new Graphics().rect(-2, -2, side + 4, side + 4).fill(0x000000).stroke({ color: 0xf2d674, width: 2 }), thumb, frame);
    this.drawFrame();
    mini.eventMode = "static";
    mini.cursor = "pointer";
    mini.on("pointertap", () => (track("hud:minimap"), this.toggle()));
    return mini;
  }

  toggle() {
    const open = !this.open;
    this.hud.closePopups();
    if (!open) return;
    this.open = true;
    this.box.visible = true;
    this.hud.openCatcher();
    this.drawBig();
  }

  /**
   * The big minimap, and on a map with an underground the surface / underground button on its side towards the middle;
   * beside the small one, whole on the screen wherever that was moved.
   */
  drawBig() {
    const hud = this.hud;
    this.box.removeChildren().forEach((c) => c !== this.map && c.destroy({ children: true }));
    this.map.scale.set(1);
    this.box.position.set(0, 0);
    this.box.addChild(backing(256, 256, 0.85), this.map);
    this.map.position.set(8, 8);
    const mb = hud.pieces.mini.getBounds();
    const toward = (mb.minX + mb.maxX) / 2 < screenSize.w / 2 ? 1 : -1;
    if (this.levels >= 2) {
      const cell = 32 * K;
      const level = new DefButton(hud.last?.underground ? "iam003.def" : "iam010.def", 0, 0, Math.max(0, hud.player));
      level.scale.set(K);
      level.label = "button: surface or underground";
      level.onClick = () => (track("hud:level"), hud.onButton("level"));
      level.position.set(toward > 0 ? 256 + GAP : -GAP - cell, 256 - cell);
      this.box.addChild(level);
    }
    const sides: Side[] = screenSize.portrait ? ["above", "below", "left", "right"] : toward > 0 ? ["right", "above", "below", "left"] : ["left", "above", "below", "right"];
    placePopup(this.box, { from: hud.pieces.mini, sides });
  }

  setView(view: { x: number; y: number; w: number; h: number }) {
    this.map.setView(view);
    this.view = view;
    this.drawFrame();
  }

  private drawFrame() {
    const f = this.thumbFrame;
    const v = this.view;
    if (!f || f.destroyed || !v) return;
    const k = this.thumbSide / this.mapTiles;
    const x = Math.max(0, v.x);
    const y = Math.max(0, v.y);
    f.clear()
      .rect(x * k, y * k, Math.min(v.w, this.mapTiles - x) * k, Math.min(v.h, this.mapTiles - y) * k)
      .stroke({ color: 0xffffff, width: 1.5 });
  }

  build(map: H3Map, world: World, level: number) {
    this.map.build(map, world, level);
    this.mapTiles = map.size;
    this.levels = map.levels;
  }

  draw(s: AdventureState, world: World, level: number, me: number) {
    this.map.draw(s, world, level, me);
    if (this.thumb && !this.thumb.destroyed) {
      this.thumb.texture = this.map.texture;
      this.thumb.width = this.thumb.height = this.thumbSide;
    }
  }
}
