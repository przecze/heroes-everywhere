// Phones, floating (EXTRAS townFloating, off by default): the town's blocks floating on a dimmed, blurred copy of the
// picture that fills the rest of the screen; the bar of the buildings' pictures, Leave nearest the thumb.
import { B, dwellingId, fortLevel, hallLevel, levelCount, townLevelCreature, upperArmy, visitingHero, weeklyGrowth, TOWNS, type AdvObject } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { creaturePortrait } from "../assets.ts";
import { en, tr, said, fmt } from "../i18n/index.ts";
import { WHITE, YELLOW } from "../text.ts";
import { DefButton, FingerArea, label, textButton } from "../ui/kit.ts";
import { GOLD, ResourceBar, dockedBar } from "../ui/blocks/resourceBar.ts";
import { StackGrid } from "../ui/blocks/stackGrid.ts";
import { creatureHold } from "../ui/stackWindow.ts";
import { oneHand, screenSize } from "../ui/screen.ts";
import { barIcons } from "./barIcons.ts";
import { heroSlot } from "./heroSlot.ts";
import { ARMIES_H, ARMIES_W, pageCorners, phoneBar, phoneLayout, uprightBar } from "./phoneLayout.ts";
import type { TownScreen } from "./screen.ts";
import { buildingClicked, massRecruit, townServices } from "./windows.ts";
import { townName } from "../i18n/towns.ts";

export class TownFloating {
  private readonly town: TownScreen;
  constructor(town: TownScreen) {
    this.town = town;
  }

  /**
   * Phones (upright and sideways, one-handed too): one layout from the blocks. The docked resource bar (gold and
   * the town's own resource, a tap: the rest); the garrison and the visiting hero with their armies, two rows
   * across, the stacks managed in place (tap picks, a tap elsewhere moves, a long press the stack's card, Split
   * when one is picked), the heroes swapped by a tap on one and then the other; the creatures to recruit with what
   * can be bought and the weekly growth (a tap recruits); a bar of the buildings' pictures, Leave nearest the
   * thumb. Everything keeps clear of the right edge, where Android's navigation bar sits.
   */
  async draw(step: ((d: number) => void) | null) {
    const town = this.town;
    const s = town.state!;
    const w = town.world!;
    const o = town.town()!;
    const t = o.town!;
    const L = phoneLayout();
    const hand = oneHand();
    const upright = L.upright;
    const frame = !L.floating;
    const gap = 8;
    const redraw = () => void town.drawTouch();
    const W = 800 + 2 * screenSize.ox;
    const picW = 800 * L.k;
    const picH = 374 * L.k;
    await town.phone.drawBackdrop(o, L);

    // ---- the bar: the buildings as the original's pictures
    const go = (id: number) => () => void buildingClicked(town.ctx(), id);
    const items: { title: string; fn: () => void; id?: number }[] = [{ title: en("Build"), fn: go(B.VILLAGE_HALL + Math.max(0, hallLevel(t.built))) }];
    if (fortLevel(t.built)) items.push({ title: en("Recruit all"), fn: () => void massRecruit(town.ctx()) });
    if (t.built.includes(B.MAGE_GUILD_1)) items.push({ title: en("Mage Guild"), fn: go(B.MAGE_GUILD_1) });
    if (t.built.includes(B.TAVERN)) items.push({ title: en("Tavern"), fn: go(B.TAVERN) });
    if (t.built.includes(B.MARKETPLACE)) items.push({ title: en("Market"), fn: go(B.MARKETPLACE) });
    // The Blacksmith, the Shipyard and the faction's own (Castle Gate, Portal, the traders and teachers): their pictures.
    for (const { id, name } of townServices(w, o)) items.push({ title: name, fn: go(id), id });
    if (town.army.selected)
      items.push({ title: en("Split"), fn: async () => void ((await town.army.splitSelected()) ? redraw() : town.setStatus(tr("Pick a stack of two or more first."))) });
    if (step) items.push({ title: en("Previous town"), fn: () => step(-1) }, { title: en("Next town"), fn: () => step(1) });
    const leaveItem = { title: en("Leave town"), fn: () => town.close() };
    const icon = await barIcons(w, o);
    const make = async (it: { title: string; fn: () => void; id?: number }) => {
      const art = (await icon(it.title, it.fn, it.id)) ?? (await textButton(tr(it.title), Math.max(32, Math.ceil(label(tr(it.title), "medfont", WHITE).width) + 16), 36, it.fn, "medfont"));
      art.label = it.title === "Split" ? "button: split the picked stack" : `button: ${it.title}`;
      return art;
    };
    const [made, leave] = await Promise.all([Promise.all(items.map(make)), make(leaveItem)]);

    // ---- the armies: [hero or the player's banner] and the seven places, the garrison above the visiting hero
    const armies = new Container();
    armies.label = "panel: town armies";
    const PAD = 6;
    const CELL = 62;
    const armiesW = ARMIES_W;
    const armiesH = ARMIES_H;
    armies.addChild(new Graphics().roundRect(0, 0, armiesW, armiesH, 6).fill({ color: 0, alpha: 0.6 }).stroke({ color: 0x7a5d30, width: 1, alpha: 0.8 }));
    const visiting = visitingHero(s, w, o);
    for (const [row, which, army] of [[0, "up", upperArmy(s, o)], [1, "down", visiting?.army ?? []]] as const) {
      const slot = await heroSlot(town, o, which, redraw);
      slot.position.set(PAD, PAD + row * 68);
      const grid = new StackGrid({ size: "large", cols: 7, gap: 4, count: "corner", countFont: "medfont", frames: true }, { creatures: w.creatures, who: row, clicks: town.army, changed: redraw });
      await grid.set(army);
      grid.position.set(PAD + CELL, PAD + row * 68);
      armies.addChild(slot, grid);
    }
    armies.eventMode = "static";

    // ---- the creatures to recruit: picture, what can be bought now, the weekly growth; a tap recruits
    const levels = Math.min(8, levelCount(o));
    const RC = 46;
    const RH = 76;
    const roster = (cols: number) => {
      const c = new Container();
      c.label = "panel: creatures to recruit";
      const rows = Math.ceil(levels / cols);
      c.addChild(new Graphics().roundRect(0, 0, cols * RC + 8, rows * RH + 8, 6).fill({ color: 0, alpha: 0.6 }).stroke({ color: 0x7a5d30, width: 1, alpha: 0.8 }));
      c.eventMode = "static";
      return c;
    };
    const fillRoster = async (into: Container, cols: number) => {
      for (let level = 0; level < levels; level++) {
        const c = w.creatures[townLevelCreature(o, level) ?? -1];
        if (!c) continue;
        const here = t.built.includes(dwellingId(level));
        const cl = new Container();
        cl.label = `recruit: ${c.plural}`;
        cl.position.set(4 + (level % cols) * RC, 4 + Math.floor(level / cols) * RH);
        cl.addChild(new Graphics().rect(0, 0, RC, RH).fill({ color: 0, alpha: 0.001 }));
        const tex = await creaturePortrait(c, "small");
        if (tex) cl.addChild(Object.assign(new Sprite(tex), { x: Math.round((RC - 40) / 2), y: 0, width: 40, height: 40, alpha: here ? 1 : 0.35 }));
        if (here) {
          const n = label(said(String(t.available[level] ?? 0)), "medfont", YELLOW, "center", RC);
          n.position.set(0, 41);
          const g = label(fmt`+${weeklyGrowth(w, o, level, s)}`, "medfont", WHITE, "center", RC);
          g.position.set(0, 58);
          cl.addChild(n, g);
          cl.eventMode = "static";
          cl.cursor = "pointer";
          cl.on("pointertap", (e) => e.button !== 2 && void buildingClicked(town.ctx(), dwellingId(level)));
        }
        creatureHold(cl, town.modals, Math.max(0, o.owner), c, () => ({ count: t.available[level] ?? 0 }));
        into.addChild(cl);
      }
    };

    // ---- the resources: gold and the resource the town's best creatures cost (a tap: the rest)
    const res = s.players[o.owner]?.resources ?? [];
    const own = town.phone.townResource(o);
    const show = [GOLD, ...(own >= 0 ? [own] : [])];
    const sideCol = !upright && frame ? Math.max(80, hand === "right" ? L.safeRight - (L.picX + picW + gap) : L.picX - gap - L.left) : 0;
    const docked = await dockedBar(Math.max(0, o.owner), res, {
      show,
      room: upright ? 520 : frame ? sideCol : (L.safeRight - L.left) / 3,
      k: L.barK,
      stack: !upright && frame,
      open: town.phone.treasuryOpen,
      tap: () => town.phone.toggleTreasury(),
      restTap: () => town.phone.toggleTreasury(),
    });

    /** Rows of buttons from `edge` (`dir` the way they go, the first nearest), upwards from `y` when one row isn't room enough; the top row's y. */
    const pack = (list: Container[], edge: number, dir: 1 | -1, room: number, y0: number, rowH: number, most: number) => {
      for (const b of list) b.scale.set((b.scale.x * rowH) / b.height);
      let kk = 1;
      const rows = (k: number) => {
        let n = 1;
        let x = 0;
        for (const b of list) {
          const bw = b.width * k;
          if (x && x + gap + bw > room) ((n += 1), (x = 0));
          x += (x ? gap : 0) + bw;
        }
        return n;
      };
      while (rows(kk) > most && kk > 0.5) kk -= 0.05;
      // As many to a row in each (no one left alone in the last).
      const per = Math.ceil(list.length / rows(kk));
      let x = edge;
      let y = y0;
      let n = 0;
      for (const b of list) {
        b.scale.set(b.scale.x * kk);
        const used = Math.abs(x - edge);
        if (used && (used + b.width > room || n >= per)) ((x = edge), (y -= rowH * kk + gap), (n = 0));
        n++;
        b.position.set(dir < 0 ? x - b.width : x, y + Math.round((rowH * kk - b.height) / 2));
        x += dir * (b.width + gap);
      }
      return y;
    };
    // (Packed from the right, the list goes in reverse so it still reads left to right, Leave at the edge.)
    const order = (dir: 1 | -1) => (dir < 0 ? [leave, ...[...made].reverse()] : [...made, leave]);
    let rosterBox: Container;

    if (upright) {
      // Upright: the resources under the page's own buttons (the town's name beside them in the frame), the picture
      // across, the buttons at the foot; the armies and the creatures under the picture in the frame, else over the bar.
      const barH = uprightBar();
      const rowH = barH - 16;
      leave.scale.set((leave.scale.x * rowH) / leave.height);
      leave.position.set(L.safeRight - leave.width, L.barY + Math.round((barH - leave.height) / 2));
      const barTop = pack(made, L.left, 1, leave.x - gap - L.left, L.barY + 8, rowH, 2);
      if (!frame) town.touch.addChild(new Graphics().rect(-screenSize.ox, barTop - gap, W, L.bottom - barTop + gap).fill({ color: 0, alpha: 0.85 }).rect(-screenSize.ox, barTop - gap, W, 2).fill(0xc9a046));
      docked.bar.position.set(8, L.top);
      if (frame) {
        // All seven in two rows (gold and the town's own first), the town's name beside the shorter.
        docked.bar.removeChildren().forEach((c) => c.destroy({ children: true }));
        const all = [GOLD, ...(own >= 0 ? [own] : []), ...[0, 1, 2, 3, 4, 5].filter((r) => r !== own)];
        const rk = Math.min(L.barK, (800 - 16) / (4 * 84 + 4));
        for (const [i, row] of [all.slice(0, 3), all.slice(3)].entries()) {
          const b = new ResourceBar();
          await b.set(Math.max(0, o.owner), res, { show: row, font: "medfont" });
          b.scale.set(rk);
          b.position.set(0, i * (ResourceBar.H + 2) * rk);
          docked.bar.addChild(b);
        }
        const first = docked.bar.children[0] as ResourceBar;
        await this.title(o, 800 - 8, L.top, 800 - 32 - first.width, first.height, "right");
      }
      const ak = L.armiesK;
      const rk = Math.min(ak * 1.15, (800 - 16) / (levels * RC + 8));
      rosterBox = roster(levels);
      await fillRoster(rosterBox, levels);
      armies.scale.set(ak);
      rosterBox.scale.set(rk);
      if (frame) {
        // The creatures under the picture, the armies by the thumb over the buttons.
        rosterBox.position.set(Math.round((800 - rosterBox.width) / 2), Math.round(L.picY + picH + 16));
        armies.position.set(8, Math.round(Math.max(rosterBox.y + rosterBox.height + 12, barTop - 2 * gap - armiesH * ak)));
      } else {
        rosterBox.position.set(Math.round((800 - rosterBox.width) / 2), Math.round(barTop - 2 * gap - rosterBox.height));
        armies.position.set(8, Math.round(rosterBox.y - 8 - armiesH * ak));
      }
    } else if (frame) {
      // Sideways in the frame: the panel along the foot (the armies at the thumb's side, the buttons beside them
      // in two rows, Leave nearest the edge), the creatures two across in the column at the thumb's side of the
      // picture with the resources over them, the town's name in the other.
      const thumbRight = hand === "right";
      const ak = L.armiesK;
      armies.scale.set(ak);
      const panelTop = L.barY;
      const panelH = 600 + screenSize.oy - panelTop;
      const ay = panelTop + Math.round((panelH - armiesH * ak) / 2);
      const rowH = Math.floor((panelH - 12 - gap) / 2);
      const y0 = panelTop + 6 + rowH + gap;
      if (thumbRight) {
        armies.position.set(Math.round(L.safeRight - armiesW * ak), ay);
        pack(order(-1), armies.x - 2 * gap, -1, armies.x - 2 * gap - L.left, y0, rowH, 2);
      } else if (hand === "left") {
        armies.position.set(L.left, ay);
        const x = L.left + armiesW * ak + 2 * gap;
        pack([leave, ...made], x, 1, L.safeRight - x, y0, rowH, 2);
      } else {
        armies.position.set(L.left, ay);
        const x = L.left + armiesW * ak + 2 * gap;
        pack(order(-1), L.safeRight, -1, L.safeRight - x, y0, rowH, 2);
      }
      // The column at the thumb's side of the picture, under the page's own buttons: name, resources, creatures.
      const [c0, c1] = thumbRight ? [L.picX + picW + gap, L.safeRight] : [L.left, L.picX - gap];
      const room = c1 - c0;
      let y = L.top + Math.ceil(44 / screenSize.css);
      y += (await this.title(o, Math.round((c0 + c1) / 2), y, room, 0, "center")) + gap;
      const docks = docked.bar.getLocalBounds();
      docked.bar.position.set(Math.round(c0 + (room - docks.width) / 2), y);
      y += Math.ceil(docks.height) + gap;
      // Two, three, four or all across: whichever shows them biggest in the room left.
      const fitAt = (cols: number) => Math.min(1.6, room / (cols * RC + 8), (panelTop - gap - y) / (Math.ceil(levels / cols) * RH + 8));
      const cols = [2, 3, 4, levels].reduce((best, c) => (fitAt(c) > fitAt(best) ? c : best), 2);
      rosterBox = roster(cols);
      await fillRoster(rosterBox, cols);
      rosterBox.scale.set(Math.max(0.4, fitAt(cols)));
      rosterBox.position.set(Math.round(c0 + (room - rosterBox.width) / 2), y);
    } else {
      // Floating, sideways: the bar along the foot (the resources left of Leave), the armies and the creatures in the
      // band over the picture, clear of the page's own buttons; one-handed every button in the thumb's third.
      const barH = phoneBar();
      const rowH = barH - 8;
      let barTop: number;
      let [sx0, sx1] = [-screenSize.ox, 800 + screenSize.ox];
      if (hand) {
        const room = hand === "right" ? L.safeRight - gap - (-screenSize.ox + (W * 2) / 3) : -screenSize.ox + W / 3 - L.left - gap;
        const edge = hand === "right" ? L.safeRight - gap : L.left;
        barTop = pack(hand === "right" ? order(-1) : [leave, ...made], edge, hand === "right" ? -1 : 1, room, L.barY + 4, rowH, 3);
        [sx0, sx1] = hand === "right" ? [edge - room - gap, L.safeRight] : [-screenSize.ox, edge + room + gap];
        docked.bar.position.set(hand === "right" ? L.left : Math.round(L.safeRight - docked.top.width), L.barY + Math.round((barH - docked.top.height) / 2));
      } else {
        leave.scale.set((leave.scale.x * rowH) / leave.height);
        leave.position.set(L.safeRight - leave.width, L.barY + Math.round((barH - leave.height) / 2));
        docked.bar.position.set(Math.round(leave.x - 2 * gap - docked.top.width), L.barY + Math.round((barH - docked.top.height) / 2));
        barTop = pack(made, L.left, 1, docked.bar.x - 2 * gap - L.left, L.barY + 4, rowH, 2);
      }
      const stripTop = Math.min(barTop - gap, L.barY);
      town.touch.addChild(new Graphics().rect(sx0, stripTop, sx1 - sx0, L.bottom - stripTop).fill({ color: 0, alpha: 0.85 }).rect(sx0, stripTop, sx1 - sx0, 2).fill(0xc9a046));
      rosterBox = roster(levels);
      await fillRoster(rosterBox, levels);
      const rosterW = levels * RC + 8;
      const page = pageCorners();
      const bx0 = Math.max(L.left, -screenSize.ox + Math.ceil(page.left / screenSize.css) + 4);
      const bx1 = Math.min(L.safeRight, 800 + screenSize.ox - Math.ceil(page.right / screenSize.css) - 4);
      const want = L.armiesK;
      const fit = Math.min(want, (bx1 - bx0 - 12) / (armiesW + rosterW));
      const thumbRight = hand === "right";
      if (fit >= want * 0.8) {
        armies.scale.set(fit);
        rosterBox.scale.set(fit);
        armies.position.set(thumbRight ? Math.round(bx1 - armiesW * fit) : bx0, L.top);
        rosterBox.position.set(thumbRight ? bx0 : Math.round(bx1 - rosterW * fit), L.top);
      } else {
        const ak = Math.min(want, (bx1 - bx0) / armiesW);
        armies.scale.set(ak);
        rosterBox.scale.set(Math.min(ak, (bx1 - bx0) / rosterW));
        armies.position.set(thumbRight ? Math.round(bx1 - armiesW * ak) : bx0, L.top);
        rosterBox.position.set(thumbRight ? bx0 : Math.round(bx1 - rosterW * rosterBox.scale.x), Math.round(L.top + armiesH * ak + 6));
      }
    }

    // Each button takes a finger's tap, also where the row had to shrink (a little into the gaps).
    for (const b of [...made, leave]) {
      if (b instanceof DefButton) continue;
      const r = b.getLocalBounds();
      b.hitArea = new FingerArea(b, r.width, r.height, r.x, r.y);
    }
    town.touch.addChild(...made, leave, armies, rosterBox, docked.bar);
    if (import.meta.env.DEV) {
      const at = (b: Container) => b.getGlobalPosition(undefined, true);
      Object.assign(window, { __townButtons: () => [...items, leaveItem].map((it, i) => { const b = i < made.length ? made[i] : leave; return { title: it.title, x: at(b).x + b.width / 2, y: at(b).y + b.height / 2 }; }) });
    }
  }

  /** The town's name in the frame, `align`ed at `x`, `w` wide; its height. */
  private async title(o: AdvObject, x: number, y: number, w: number, h: number, align: "right" | "center") {
    const town = this.town;
    const fallback = TOWNS[o.subid]?.faction ?? "town";
    const name = label(said(o.name) ?? townName(fallback), "medfont", YELLOW);
    // (About 18 CSS pixels high, narrower where the room is short.)
    const k = Math.min(Math.max(1.25, 18 / (16 * screenSize.css)), w / Math.max(1, name.texture.width));
    name.scale.set(k);
    name.position.set(Math.round(align === "right" ? x - name.width : x - name.width / 2), Math.round(y + Math.max(0, (h - name.height) / 2)));
    town.touch.addChild(name);
    return name.height;
  }
}
