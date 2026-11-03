// The battle's popups: a stack's (CRSTKPU), a hero's (CHRPOP), a tower's, held with the right button or a finger;
// and the pointed-at stack's panel beside the field (EXTRAS stackPanel).
import type { BattleView } from "./view.ts";
import { extra } from "../settings.ts";
import { type Unit, alive, stats, type WallPart, TOWER_POS, towerDamageRange, type Side } from "@heroes/core";
import { phoneSized, screenSize, touchScale } from "../ui/screen.ts";
import { Container } from "pixi.js";
import { textPopup } from "../ui/dialogs.ts";
import { BAR_Y, SCREEN_H, SCREEN_W, hexCenter } from "./layout.ts";
import { drawCreatureInfo } from "./creatureInfo.ts";
import { STACK_PANEL_H, STACK_PANEL_W, drawStackPanel } from "./stackPanel.ts";
import { HERO_INFO_PHONE_H, HERO_INFO_PHONE_W, drawHeroInfo } from "./heroInfo.ts";
import { tr } from "../i18n/index.ts";
import { PART_NAMES } from "./texts.ts";

export class BattleInfo {
  private readonly v: BattleView;
  constructor(v: BattleView) {
    this.v = v;
  }

  /** The pointed-at stack's panel beside the field (EXTRAS stackPanel; with a mouse only). */
  readonly stackPanel = new Container();
  private stackPanelKey = "";
  async showStackPanel(u: Unit | undefined) {
    const s = this.v.state;
    const on = !!s && !!u && alive(u) && !u.machine && extra("stackPanel") && !screenSize.touch && !this.v.modals.open;
    const key = on ? `${u.id}:${u.count}:${u.firstHp}:${s.round}:${JSON.stringify(u.effects ?? [])}` : "";
    if (key === this.stackPanelKey) return;
    this.stackPanelKey = key;
    if (!on) return void this.stackPanel.removeChildren().forEach((c) => c.destroy({ children: true }));
    const box = new Container();
    await drawStackPanel(box, s, u);
    if (key !== this.stackPanelKey || this.v.root.destroyed) return box.destroy({ children: true });
    this.stackPanel.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.stackPanel.addChild(box);
    // As VCMI's setPositionInfoWindow: outside the field on the stack's side when the window has the room,
    // else over the field's corner under the hero.
    const outside = screenSize.ox >= STACK_PANEL_W + 1;
    const left = u.side === 0;
    box.position.set(outside ? (left ? -STACK_PANEL_W - 1 : SCREEN_W - 1) : left ? 1 : SCREEN_W - 79, outside ? -1 : 195);
    this.openStackPanelClip();
  }

  /** The battle's clip opened where the panel stands (it hides whatever is past the field's edges). */
  openStackPanelClip() {
    const box = this.stackPanel.children[0];
    if (box) this.v.clip.rect(box.x, box.y, STACK_PANEL_W, STACK_PANEL_H).fill(0xffffff);
  }
  popup: Container | null = null;
  private infoAsked = 0;
  /** The original right-click hero popup (CHRPOP), drawn while the button is held: beside the hero (VCMI: x 1 or right - 79, y 135). */
  async showHeroInfo(side: Side) {
    this.hideInfo();
    const asked = ++this.infoAsked;
    const box = new Container();
    // Touch screens: the readable version, enlarged, in the middle of the field.
    const touch = screenSize.touch;
    await drawHeroInfo(box, this.v.state!, side, touch);
    if (asked !== this.infoAsked || this.v.root.destroyed) return box.destroy({ children: true });
    this.popup = box;
    if (touch) {
      const k = Math.max(1.25, Math.min(1.75, (BAR_Y - 16) / HERO_INFO_PHONE_H));
      box.scale.set(k);
      box.position.set(Math.round((SCREEN_W - HERO_INFO_PHONE_W * k) / 2), Math.round((BAR_Y - HERO_INFO_PHONE_H * k) / 2));
    } else box.position.set(side === 0 ? 1 : SCREEN_W - 79, 135);
    this.v.root.addChild(box);
  }

  /** The original right-click creature popup (CRSTKPU), drawn while the button is held. */
  /** What the original says over a tower: its archers' attack, damage and hit points, or that it is destroyed. */
  showTowerInfo(t: Unit, x: number, y: number) {
    const s = this.v.state!;
    const part = (Object.entries(TOWER_POS).find(([, pos]) => pos === t.pos)?.[0] ?? "keep") as WallPart;
    const name = tr(PART_NAMES[part]).replace(/^./, (c) => c.toUpperCase());
    const st = stats(s, t);
    const [min, max] = towerDamageRange(s.siege!, part === "keep");
    const text = alive(t) ? this.v.texts.line(155, name, st.attack, min, max, st.hp, st.hp) : this.v.texts.line(154, name);
    textPopup(text, s.sides[1]?.owner ?? 0, x, y);
  }

  async showInfo(u: Unit) {
    this.hideInfo();
    const asked = ++this.infoAsked;
    const box = new Container();
    await drawCreatureInfo(box, this.v.state!, u);
    // Released (or another asked for) while the art loaded.
    if (asked !== this.infoAsked || this.v.root.destroyed) return box.destroy({ children: true });
    this.popup = box;
    // Touch screens: as big as the screen allows, in the middle (the original size is unreadable on a phone).
    // On a phone the field ends at the bar's top (its buttons moved aside): the popup fits above it.
    const fieldH = phoneSized() ? BAR_Y : SCREEN_H;
    // Its own size (a stack with many abilities draws a taller window than the original's 300x315).
    const r = box.getLocalBounds();
    const bw = Math.max(300, r.x + r.width);
    const bh = Math.max(315, r.y + r.height);
    const k = Math.min(touchScale(bw, bh), (fieldH - 4) / bh);
    if (touchScale(bw, bh) > 1) {
      box.scale.set(k);
      // Upright the field starts right under the page's own buttons: not above its top.
      box.position.set(Math.round((SCREEN_W - bw * k) / 2), Math.max(0, Math.round((fieldH - bh * k) / 2)));
    } else {
      const anchor = hexCenter(u.pos);
      box.position.set(
        Math.min(SCREEN_W - 302, Math.max(4, anchor.x - 149)),
        Math.max(4, Math.min(BAR_Y - 315, anchor.y - 340)),
      );
    }
    this.v.root.addChild(box);
  }

  hideInfo() {
    this.infoAsked++;
    this.popup?.destroy({ children: true });
    this.popup = null;
  }

}
