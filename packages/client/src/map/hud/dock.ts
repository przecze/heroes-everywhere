// The touch HUD's resource bar, docked at the screen's foot, and the treasury it opens.
import { type AdventureState, PLAYER_NAMES, canAct, movingNow } from "@heroes/core";
import { type Container } from "pixi.js";
import { tr } from "../../i18n/index.ts";
import { GOLD, ResourceBar, compactAmount, treasuryPanel } from "../../ui/blocks/resourceBar.ts";
import { placePopup } from "../../ui/blocks/popupPlace.ts";
import { navBarRight, screenSize } from "../../ui/screen.ts";
import { track } from "../../usage.ts";
import type { MobileHud } from "../mobileHud.ts";
import { GAP } from "./look.ts";

export class ResourceDock {
  /** The treasury (all seven with the day's income) opened over the bar. */
  open = false;
  private treasury: Container | null = null;
  private treasuryGen = 0;
  /** The amounts last drawn, and the resource shown beside gold (-1: none yet). */
  private lastRes: number[] = [];
  private focusRes = -1;
  /** The others' turn's line last toasted ("" on ours). */
  private status = "";

  private readonly hud: MobileHud;
  constructor(hud: MobileHud) {
    this.hud = hud;
  }

  /** Closes the treasury (redrawn without it). */
  close() {
    if (!this.open) return;
    this.open = false;
    void this.redraw();
  }

  redraw() {
    const l = this.hud.last;
    return l ? this.draw(l.s, l.me, l.myTurn) : Promise.resolve();
  }

  /**
   * The original's resource bar (ui/blocks/resourceBar.ts), docked as a phone's dock (2026-10-25): gold and the
   * one resource that last changed (picked up, a mine taken, spent); a tap opens all seven. Its size never changes:
   * who is moving on the others' turns comes as a toast (notices.ts).
   */
  async draw(s: AdventureState, me: number, myTurn: boolean) {
    const hud = this.hud;
    if (hud.root.destroyed) return;
    const res = s.players[me]?.resources ?? [];
    // The resource that changed last (not gold: always there) is the one shown beside gold.
    if (this.lastRes.length) {
      const changed = [0, 1, 2, 3, 4, 5].filter((r) => (res[r] ?? 0) !== (this.lastRes[r] ?? 0));
      if (changed.length === 1) this.focusRes = changed[0];
    }
    this.lastRes = [...res];
    const over = s.winner !== undefined;
    // (myTurn is false while our own hero walks, the session being busy: the turn is still ours, so no "Red is moving…"
    // over our own walk; The owner, 2026-11-02 14:29 and 15:02.)
    myTurn ||= canAct(s, me);
    const movers = myTurn || over ? [] : movingNow(s).filter((p) => p !== me);
    // The others' turns: who is moving, as a toast when it changes (2026-11-02 17:57: on the bar it changed the
    // bar's size and made it jump about; the bar keeps one size).
    const status = myTurn || over
      ? ""
      : hud.follow?.caption
        ? hud.follow.caption
        : movers.length === 1
          ? tr("%1 is moving…", tr(PLAYER_NAMES[movers[0]]))
          : s.turnMode === "sequential"
            ? tr("Others are moving…")
            : tr("Waiting for the others…");
    if (status !== this.status) {
      // (Our turn: who was moving goes at once, not left over the new day's card; The owner, 2026-11-03.)
      hud.notices.drop(this.status);
      this.status = status;
      if (status) hud.notices.text(status);
    }
    const k = hud.barK;
    const dock = new ResourceBar();
    dock.label = "resource bar: resources";
    // Always two cells (gold and the resource that last changed, wood before any did): one size all game.
    await dock.set(hud.player, res, {
      show: [GOLD, this.focusRes >= 0 ? this.focusRes : 0],
      narrow: true,
      format: (n, r) => compactAmount(n, r === GOLD),
      font: "medfont",
    });
    if (hud.root.destroyed) return void dock.destroy({ children: true });
    dock.scale.set(k);
    dock.eventMode = "static";
    dock.cursor = "pointer";
    dock.on("pointertap", (e) => {
      e.stopPropagation();
      track("hud:treasury");
      const open = !this.open;
      hud.closePopups();
      this.open = open;
      if (open) hud.openCatcher();
      void this.redraw();
    });
    // Docked to the screen's foot (2026-10-26: the height is worth more than the width), a widget of its own (the owner,
    // 2026-10-27: it lay inside the buttons' block and slid over its buttons): upright in the bottom left corner, the
    // buttons in the other; sideways beside the rail (towards the middle), one-handed in the corner away from the thumb.
    const w = dock.barWidth * k;
    const h = ResourceBar.H * k;
    const hand = hud.sides.hand;
    const x = screenSize.portrait ? 8 : hand === "right" ? 0 : hand === "left" ? hud.W - navBarRight() - w : hud.sides.railX - GAP - hud.widgetGap - w;
    dock.position.set(Math.round(x), Math.round(hud.H - (screenSize.portrait ? 8 : 0) - h));
    const bar = hud.pieces.bar;
    bar.removeChildren().forEach((c) => c.destroy({ children: true }));
    bar.position.set(0, 0);
    bar.addChild(dock);
    this.treasury?.destroy({ children: true });
    this.treasury = null;
    // Opened: all seven, whole, with the day's income over each, in two rows, over the bar (or under it, or beside it:
    // wherever the bar was moved, the treasury comes up whole on the screen).
    if (this.open) {
      const room = hud.W - 16 - (screenSize.portrait ? 0 : navBarRight());
      const panel = await treasuryPanel(hud.player, res, hud.income?.() ?? [], room, hud.barK * 1.25);
      if (hud.root.destroyed) return void panel.destroy({ children: true });
      panel.on("pointertap", (e) => (e.stopPropagation(), hud.closePopups()));
      // (Over the other widgets and their handles, as the big minimap and the more grid.)
      this.treasury = panel;
      hud.popups.addChild(panel);
      placePopup(panel, { from: dock });
      const shown = ++this.treasuryGen;
      setTimeout(() => shown === this.treasuryGen && this.open && hud.closePopups(), 6000);
    }
  }
}
