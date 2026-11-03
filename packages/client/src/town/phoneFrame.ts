// Phones, the frame (the default): the town's picture whole in the adventure map's rim, the town's name between the
// arrows to the other towns, the creatures to recruit, the two armies with the trade, swap and split buttons, every
// one of the town's buttons, the resources and Leave by the thumb; upright one column, sideways a column at the
// thumb's side and a band under the picture.
import { playSound } from "../audio.ts";
import { B, MACHINE_CREATURE, TOWNS, dateParts, blacksmithMachine, buildingName, dailyIncome, dwellingId, fortLevel, garrisonHero, hallLevel, levelCount, townFeature, townLevelCreature, townService, upperArmy, visitingHero, weeklyGrowth, type AdvObject, type CreatureStats } from "@heroes/core";
import { Container, Graphics, Sprite, type Texture, TilingSprite } from "pixi.js";
import { creaturePortrait, loadDef, loadDefPlayer, loadImage } from "../assets.ts";
import { en, tr, said, fmt, type Text } from "../i18n/index.ts";
import { WHITE, YELLOW } from "../text.ts";
import { DefButton, label } from "../ui/kit.ts";
import { scrollList } from "../ui/mobilePage.ts";
import { DAY_CELL_W, GOLD, ResourceBar, compactAmount, treasuryPanel } from "../ui/blocks/resourceBar.ts";
import { placePopup } from "../ui/blocks/popupPlace.ts";
import { StackGrid } from "../ui/blocks/stackGrid.ts";
import { advOrnate, advPlate, advRim } from "../ui/blocks/advFrame.ts";
import { TOWNSCRN, partTexture, tiledPart, townPanel, townRimOver, townRimParts } from "../ui/blocks/windowParts.ts";
import { colourWindow, leatherWindow } from "../ui/blocks/phoneWindow.ts";
import { creatureHold } from "../ui/stackWindow.ts";
import { cutoutTop, oneHand, screenSize } from "../ui/screen.ts";
import { heroSlot } from "./heroSlot.ts";
import { quickStrip } from "../ui/quickStack.ts";
import { ARMIES_SIDE_H, ARMIES_SIDE_W, ARMIES_UP_W, UP_ROSTER_H, phoneLayout } from "./phoneLayout.ts";
import type { TownScreen } from "./screen.ts";
import { buildingClicked, buildingInfo, massRecruit, townServices } from "./windows.ts";
import { townName } from "../i18n/towns.ts";

export class TownFrame {
  /** The player's colour plate the town's buttons lie on. */
  private plateTex: Texture | null = null;
  /** Phones: each button's leather (DIBOXBCK) in the town panel's double gold rim (TOWNSCRN's). */
  private slotTex: Texture | null = null;
  private tileBox: { leather: Texture; rim: NonNullable<Awaited<ReturnType<typeof townRimParts>>> } | null = null;
  private hintBox: Container | null = null;

  private readonly town: TownScreen;
  constructor(town: TownScreen) {
    this.town = town;
  }

  /**
   * Phones, the frame (the default; The owner, 2026-10-26: the adventure screen's frame, the player's colour and gold
   * filigree, not brown leather): the picture whole in the map's rim; the town's name between the arrows to the
   * other towns; the resources; the creatures to recruit (the Blacksmith's machine with them); the garrison's and
   * the visiting hero's seven stacks, the two heroes with the trade and swap buttons between; every one of the town's
   * buttons always there (greyed, and saying why on a tap, while its building isn't), Build and Recruit all first
   * and twice as wide, square, scrolling when too many; Leave by the thumb. Upright one column from the top;
   * sideways a column at the thumb's side and the armies and the creatures in a band under the picture.
   */
  async draw(step: ((d: number) => void) | null) {
    const town = this.town;
    const s = town.state!;
    const w = town.world!;
    const o = town.town()!;
    const t = o.town!;
    const L = phoneLayout();
    const player = Math.max(0, o.owner);
    const redraw = () => void town.drawTouch();
    const css = screenSize.css;
    const R = advRim.WIDTH;
    // (Inside the ornate frame, its band 24 to 29 pixels; the armies' and creatures' own sizes count 14 a side.)
    const P = 30;
    const G = 6;
    const picH = 374 * L.k;
    const thumbRight = oneHand() === "right";
    this.plateTex = await advPlate(player);
    // (Was TOWNSCRN's 60 x 66 slot stretched over a tile 200 wide: a blurred brown block; The owner, 2026-11-01.)
    const [leatherTex, rimParts] = await Promise.all([loadImage("diboxbck.pcx").catch(() => null), townRimParts(player)]);
    this.tileBox = leatherTex && rimParts ? { leather: leatherTex, rim: rimParts } : null;
    this.slotTex = await partTexture(TOWNSCRN, "slot", player);
    await town.phone.drawBackdrop(o, L);
    const put = (c: Container) => (town.touch.addChild(c), c);
    /** The town panel's gold filigree (TOWNSCRN's, between the desktop's two armies) across `fw` at x, y. */
    const filigree = async (x: number, y: number, fw: number) => {
      const f = await tiledPart(TOWNSCRN, "divider", player, Math.round(fw), TOWNSCRN.parts.divider.h);
      if (f) put(Object.assign(f, { x: Math.round(x), y: Math.round(y), label: "town: gold filigree" }));
    };
    const panel = async (x: number, y: number, pw: number, ph: number) => {
      // The windows' leather in the phone windows' own rim, its knots and edge in the owner's colour (the owner's notes
      // 2026-10-27 22:07, 10-29 23:47: "boring borders that could use ornamentation", "more player colours ... as
      // pretty as desktop"): the town's parts look as its windows do. Not the owner's colour inside (10-26 21:50: "too
      // much red"); without the rim's picture, the town panel's double gold rim.
      // Since 2026-11-01 (the owner: "only improved a little bit ... more ornamental, pretty borders, more player colours"):
      // The owner's colour as the desktop's town panel has it, the leather only in the places on it (TOWNSCRN's).
      const p = (await colourWindow(Math.round(pw), Math.round(ph), player).catch(() => null)) ?? (await leatherWindow(Math.round(pw), Math.round(ph), player).catch(() => null)) ?? (await advOrnate(pw, ph, player));
      p.position.set(Math.round(x), Math.round(y));
      p.eventMode = "static";
      return put(p);
    };

    // ---- the buttons: every one of the town's, greyed (saying why on a tap) while its building isn't there
    const has = (id: number) => t.built.includes(id);
    const needs = (id: number) => tr("Build %1 first.", buildingName(w, o, id));
    const go = (id: number) => () => void buildingClicked(town.ctx(), id);
    const fort = fortLevel(t.built);
    // `info`: the building a long press (or the right button) explains, as on the town's picture.
    type Action = { title: string; id?: number; info?: number; on: boolean; why?: Text; fn: () => void; wide?: boolean };
    const hall = B.VILLAGE_HALL + Math.max(0, hallLevel(t.built));
    const actions: Action[] = [
      { title: en("Build"), info: hall, on: true, fn: go(hall), wide: true },
      { title: en("Recruit all"), info: B.FORT + Math.max(0, fort - 1), on: fort > 0, why: needs(B.FORT), fn: () => void massRecruit(town.ctx()), wide: true },
      { title: en("Mage Guild"), info: B.MAGE_GUILD_1, on: has(B.MAGE_GUILD_1), why: needs(B.MAGE_GUILD_1), fn: go(B.MAGE_GUILD_1) },
      { title: en("Tavern"), info: B.TAVERN, on: has(B.TAVERN), why: needs(B.TAVERN), fn: go(B.TAVERN) },
      { title: en("Market"), id: B.MARKETPLACE, on: has(B.MARKETPLACE), why: needs(B.MARKETPLACE), fn: go(B.MARKETPLACE) },
    ];
    // The Shipyard and the faction's own (Castle Gate, Portal, the traders and teachers); the Blacksmith's machine is
    // with the creatures to recruit.
    for (const { id, name } of townServices(w, o, s)) if (id !== B.BLACKSMITH) actions.push({ title: name, id, on: has(id), why: needs(id), fn: go(id) });
    const art = await this.actionArt(o);
    const arts = await Promise.all(actions.map((a) => art(a.title, a.id)));
    /** The buttons in `cols` columns of `S`-wide, `H`-high tiles (Build and Recruit all two wide, first), scrolling past `maxH`. */
    const grid = (cols: number, S: number, maxH: number, H = S) => {
      const c = new Container();
      // In order, each in the first place it fits (row by row): the small ones fill in beside the big ones.
      const taken: boolean[][] = [];
      const free = (r: number, q: number, n: number) => {
        for (let x = q; x < q + n; x++) if (x >= cols || taken[r]?.[x]) return false;
        return true;
      };
      let rows = 0;
      actions.forEach((a, i) => {
        const n = a.wide && cols > 2 ? 2 : 1;
        let r = 0;
        let q = 0;
        for (; ; r++) {
          q = Array.from({ length: cols }, (_, x) => x).find((x) => free(r, x, n)) ?? -1;
          if (q >= 0) break;
        }
        // (Two wide, one high: the owner, 2026-10-26, "don't need to be SO BIG".)
        for (let x = q; x < q + n; x++) (taken[r] ??= [])[x] = true;
        rows = Math.max(rows, r + 1);
        const tile = this.actionTile(arts[i], a.title, n * S + (n - 1) * G, H, a.on, a.fn, a.why);
        const info = a.info ?? a.id;
        if (info !== undefined) tile.on("rightdown", (e) => !town.modals.open && void buildingInfo(town.ctx(), info, true));
        tile.position.set(q * (S + G), r * (H + G));
        c.addChild(tile);
      });
      const h = rows * (H + G) - G;
      if (h <= maxH) return c;
      return scrollList(c, { x: 0, y: 0, w: cols * (S + G) - G, h: maxH }).view;
    };
    const leave = await this.actionTile(await art(en("Leave town")), en("Leave town"), 0, 0, true, () => town.close());

    // ---- the town's name between the arrows to the other towns, small, over the picture's top (with the page's buttons)
    const title = await this.namePlate(o, step);
    title.scale.set(Math.max(1.25, 15 / (16 * css)));
    const plate = (c: Container) => {
      const b = c.getLocalBounds();
      const bg = new Graphics().roundRect(b.x - 8, b.y - 3, b.width + 16, b.height + 6, 6).fill({ color: 0, alpha: 0.55 });
      c.addChildAt(bg, 0);
    };
    plate(title);

    // ---- the resources, docked at the foot: gold and the town's own; a tap shows all seven with their income
    const res = s.players[o.owner]?.resources ?? [];
    const own = town.phone.townResource(o);
    const dock = new ResourceBar();
    // With the week's day as the bar's own date cell, its seven pips (2026-10-31 06:56: the big day squares were
    // uglier; "old style", as by the map's End turn); a tap on it says the date in words.
    await dock.set(player, res, { show: [GOLD, ...(own >= 0 ? [own] : [])], narrow: true, format: (n, r) => compactAmount(n, r === GOLD), font: "medfont", date: "", dateW: DAY_CELL_W, day: dateParts(s.day)[2] });
    dock.eventMode = "static";
    dock.cursor = "pointer";
    dock.on("pointertap", (e) => {
      if (dock.cells.some(([r, x, cw]) => r === -1 && dock.toLocal(e.global).x >= x && dock.toLocal(e.global).x < x + cw)) return this.hint(tr("Month %1, Week %2, Day %3", ...dateParts(s.day)));
      town.phone.toggleTreasury();
    });
    const dockK = Math.min(L.barK, 2);
    dock.scale.set(dockK);

    // ---- the creatures to recruit (and the Blacksmith's machine): picture, to buy now, the week's growth
    let roster = await this.rosterTiles(o);

    // ---- the armies
    const armies = await this.armiesBlock(o, L.upright, redraw);

    /** The treasury opened over the screen's foot, all across, for a look. */
    const treasury = async (x: number, width: number, bottom: number) => {
      if (!town.phone.treasuryOpen) return;
      const p = await treasuryPanel(player, res, dailyIncome(s, w, o.owner), width, 2.5);
      p.position.set(Math.round(x + (width - p.width) / 2), Math.round(bottom - p.height));
      put(p);
      // (Whole on the screen, over the bar it opens from.)
      placePopup(p, { from: dock, sides: ["above", "below"] });
    };

    if (L.upright) {
      // Upright, top to bottom: the town's name between the page's own buttons, the creatures, the armies, the picture
      // in the middle of the screen, the buttons, and at the foot the resources and Leave.
      title.position.set(Math.round(400 - title.width / 2), Math.round((-screenSize.oy + cutoutTop() + L.top) / 2 - title.height / 2));
      // The band behind the name and the page's own buttons in the owner's colour and the town panel's gold rim (the owner,
      // 2026-10-27 22:07 and 10-29 23:47: no black top; more of the player's colour and ornament, as the desktop's).
      const band = await townPanel(800, L.top + 4 + screenSize.oy, player, "colour");
      if (band) put(Object.assign(band, { x: 0, y: -screenSize.oy }));
      let y = L.top + 4;
      // The creatures: one row across. (With a stack picked, HotA's quick actions on it in their place: halves, evenly,
      // one each, gather, upgrade all; the creatures back once it is put down. The owner's note 2026-10-30 07:22.)
      const picked = town.army.selected;
      if (picked) {
        roster.destroy({ children: true });
        roster = await quickStrip(town.army.quickOps(picked), redraw, 120, 84, 16);
        roster.label = "panel: quick actions on the picked stack";
      }
      const rosterH = Math.ceil(roster.height);
      const rq = Math.min(1.7, (800 - 2 * P) / roster.width, (UP_ROSTER_H - 2 * P) / Math.max(1, rosterH));
      await panel(0, y, 800, UP_ROSTER_H);
      roster.scale.set(rq);
      roster.position.set(Math.round(400 - roster.width / 2), Math.round(y + (UP_ROSTER_H - rosterH * rq) / 2));
      put(roster);
      y += UP_ROSTER_H;
      // The armies: as wide as the screen.
      await panel(0, y, 800, L.upArmiesH);
      armies.scale.set(L.upArmiesK);
      armies.position.set(Math.round(400 - (ARMIES_UP_W * L.upArmiesK) / 2), y + P);
      put(armies);
      y = L.picY + picH + R + 2;
      // The buttons to the foot, the resources and Leave in its last row.
      const foot = L.bottom - P;
      await panel(0, y, 800, L.bottom - y);
      const footH = Math.max(Math.ceil(40 / css), ResourceBar.H * dockK);
      leave.scale.set(footH / leave.height);
      // The desktop's gold filigree (TOWNSCRN's, between its two armies) over the foot: the owner, 2026-11-01, "more ornamental".
      const FIL = 24;
      const room = foot - footH - G - y - P - FIL;
      const cells = actions.reduce((n, a) => n + (a.wide ? 2 : 1), 0);
      const fit = (cols: number) => Math.min((800 - 2 * P - (cols - 1) * G) / cols, room / Math.ceil(cells / cols) - G);
      const cols = [4, 5, 6].reduce((best, c) => (fit(c) > fit(best) ? c : best), 4);
      const S = Math.floor(Math.max(Math.ceil(44 / css), Math.min(200, fit(cols))));
      // The tiles as tall as the room lets them (up to half again their width): the panel filled to the foot, no empty
      // leather under the buttons (2026-10-31 06:57: "a little prettier but I want more").
      const rows = Math.ceil(cells / cols);
      const H = Math.floor(Math.max(S, Math.min(1.5 * S, (room - (rows - 1) * G) / rows)));
      const g = grid(cols, S, room, H);
      g.position.set(Math.round(400 - (cols * (S + G) - G) / 2), y + P);
      put(g);
      await filigree(P, foot - footH - FIL + 1, 800 - 2 * P);
      const leftHand = oneHand() === "left";
      leave.position.set(leftHand ? P : 800 - P - leave.width, foot - leave.height);
      dock.position.set(leftHand ? 800 - P - dock.width : P, Math.round(foot - (footH + dock.height) / 2));
      put(leave);
      put(dock);
      await treasury(8, 800 - 16, dock.y - 6);
    } else {
      // Sideways: the column at the thumb's side (the buttons, the creatures to recruit, the week's days, and at its
      // foot the resources and Leave), the band under the picture the armies'; the name over the picture.
      const colX = thumbRight ? L.safeRight - L.col : L.left - 8;
      const colW = L.col + 8;
      const colTop = -screenSize.oy + Math.ceil(44 / css) + 4;
      await panel(colX, -screenSize.oy, colW, screenSize.h);
      const inner = colW - 2 * P;
      title.position.set(Math.round(L.picX + (800 * L.k - title.width) / 2), Math.round(L.picY + 6));
      // The foot: the resources and Leave side by side, or Leave over them when the column is narrow.
      const foot = 600 + screenSize.oy - P;
      const leaveH = Math.ceil(40 / css);
      leave.scale.set(leaveH / leave.height);
      if (dock.width > inner) dock.scale.set((dockK * inner) / dock.width);
      const side = dock.width + G + leave.width <= inner;
      dock.position.set(colX + P, Math.round(foot - (side ? (leaveH + dock.height) / 2 : dock.height)));
      leave.position.set(side ? colX + colW - P - leave.width : Math.round(colX + (colW - leave.width) / 2), side ? foot - leaveH : dock.y - G - leaveH);
      const cols = inner >= 3 * Math.ceil(40 / css) + 2 * G ? 3 : 2;
      const S = Math.floor((inner - (cols - 1) * G) / cols);
      // (The week's day is the resources' date cell.)
      const daysY = Math.min(leave.y, dock.y);
      // The creatures to recruit in the column too, under the buttons, as big as a third of the column's room lets
      // them (2026-10-30 22:11: the band under the picture is all the armies'; they were tiny beside them).
      const n = Math.min(8, levelCount(o)) + 1;
      const room = daysY - G - colTop;
      const fitIn = (rc: number) => Math.min(1.8, inner / (rc * 52 + 10), (room * 0.4) / (Math.ceil(n / rc) * 66));
      const rcols = [3, 4, 5].reduce((best, c) => (fitIn(c) > fitIn(best) ? c : best), 3);
      roster.destroy({ children: true });
      roster = await this.rosterTiles(o, rcols, true);
      const rq = fitIn(rcols);
      roster.scale.set(rq);
      const rosterH = Math.ceil(roster.height);
      const FIL = 22;
      const g = grid(cols, S, room - rosterH - 2 * G - FIL);
      g.position.set(colX + P, colTop);
      put(g);
      await filigree(colX + P, Math.round(daysY - G - rosterH - FIL), inner);
      roster.position.set(Math.round(colX + (colW - roster.width) / 2), Math.round(daysY - G - rosterH));
      put(roster);
      put(leave);
      put(dock);
      // The band under the picture: the armies, the whole of it.
      const bx0 = thumbRight ? L.left - 8 : colX + colW;
      const bx1 = thumbRight ? colX : L.safeRight + 8;
      const by = L.barY;
      const bh = 600 + screenSize.oy - by;
      await panel(bx0, by, bx1 - bx0, bh);
      const ak = Math.min((bh - 2 * P) / (ARMIES_SIDE_H - 28), (bx1 - bx0 - 2 * P) / (ARMIES_SIDE_W - 28));
      armies.scale.set(ak);
      armies.position.set(Math.round((bx0 + bx1 - (ARMIES_SIDE_W - 28) * ak) / 2), by + Math.round((bh - (ARMIES_SIDE_H - 28) * ak) / 2));
      put(armies);
      await treasury(Math.min(bx0, colX) + 8, Math.max(bx1, colX + colW) - Math.min(bx0, colX) - 16, dock.y - 6);
    }
    put(title);
    if (import.meta.env.DEV) {
      const at = (b: Container) => b.getGlobalPosition(undefined, true);
      const tiles = (town.touch.children as Container[]).flatMap((c) => [c, ...(c.children as Container[]), ...((c.children as Container[]).flatMap((x) => x.children as Container[]))]).filter((c) => typeof c.label === "string" && c.label.startsWith("button: "));
      Object.assign(window, { __townButtons: () => tiles.map((b) => ({ title: b.label.slice(8), x: at(b).x + b.width / 2, y: at(b).y + b.height / 2 })) });
    }
  }

  /** A town button's picture (the original's: the hall's and fort's icons, the spellbook, the market's hand...). */
  private async actionArt(o: AdvObject): Promise<(title: string, id?: number) => Promise<Container>> {
    const town = this.town;
    const t = o.town!;
    const w = town.world!;
    const player = Math.max(0, o.owner);
    const [hallDef, castle, guild, tavern, okay, split] = await Promise.all([
      loadDef("itmtl.def").catch(() => null),
      loadDef("itmcl.def").catch(() => null),
      // (The adventure rail's square spellbook, in the player's colour as there: the owner, 2026-10-26.)
      loadDefPlayer("iam007.def", player).catch(() => null),
      loadDef("ovbutn1.def").catch(() => null),
      loadDef("iok6432.def").catch(() => null),
      loadDef("idv6432.def").catch(() => null),
    ]);
    const sprite = (tex: Texture | undefined) => {
      const c = new Container();
      if (tex) c.addChild(new Sprite(tex));
      return c;
    };
    const frame = async (def: string, i: number, group = 0) => sprite((await loadDef(def).catch(() => null))?.get(group)?.[i]?.texture);
    const creature = async (id: number | undefined) => {
      const c = id === undefined ? undefined : w.creatures[id];
      return sprite(c ? ((await creaturePortrait(c, "large")) ?? undefined) : undefined);
    };
    // What a building would offer, built or not (the buttons show those not built yet too).
    const as = (id: number): AdvObject => (t.built.includes(id) ? o : { ...o, town: { ...t, built: [...t.built, id] } });
    return async (title, id) => {
      // Never the buildings' own little pictures (2026-10-26): each a symbol of what it does.
      // (The adventure cursor's gold boat, the owner 2026-10-26.)
      if (id === B.SHIPYARD) return frame("cradvntr.def", 6);
      if (id !== undefined && id !== B.MARKETPLACE) {
        switch (townFeature(as(id), id)) {
          case "castleGate":
            return frame("spellint.def", 10);
          case "portal": {
            // This week's creature through it, as a dwelling's button shows what it offers (Dimension Door's two
            // figures read as a teleport: a 2026-11-02 note "teleport symbol not right for the portal"); dark, the
            // Summon Elementals' sphere.
            const portal = o.data?.portal as { creature: number } | undefined;
            return portal ? creature(portal.creature) : frame("spellint.def", 67);
          }
          case "manaVortex":
            return frame("pskil42.def", 5);
          case "thievesGuild":
            return frame("hsbtns4.def", 0);
          case "ballistaYard":
            return creature(MACHINE_CREATURE[4]);
        }
        switch (townService(as(id), id)) {
          // The market's own buttons (TPMRKBU*: what goes, an arrow, what comes; The owner 2026-10-26): gold for an artifact,
          // a creature for gold.
          case "artifacts":
            return frame("tpmrkbu2.def", 0);
          case "university":
            return frame("pskil42.def", 3);
          case "freelancers":
            return frame("tpmrkbu4.def", 0);
          case "transformer":
            return creature(w.creatures.findIndex((c) => c?.name === "Skeleton"));
          case "altar":
            return frame("pskil42.def", 4);
          case "runes":
            return frame("pskil42.def", 2);
          case "bank":
            return frame("resource.def", 6);
        }
        return sprite(undefined);
      }
      switch (title) {
        case "Build":
          return sprite(hallDef?.get(0)?.[Math.max(0, hallLevel(t.built))]?.texture);
        case "Recruit all":
          // The fort's own picture, its level's (2026-10-26: "castle icon, not a random unit").
          return sprite(castle?.get(0)?.[Math.max(0, fortLevel(t.built) - 1)]?.texture);
        case "Mage Guild":
          return sprite(guild?.get(0)?.[0]?.texture);
        case "Market":
          // Resources for resources: the button that takes the market back from sending to trading.
          return frame("tpmrkbu5.def", 0);
        case "Tavern": {
          // A hero to hire: the kingdom overview's heroes with a plus.
          const c = sprite(tavern?.get(0)?.[0]?.texture);
          const plus = label(said("+"), "bigfont", YELLOW);
          plus.position.set(2, -4);
          c.addChild(plus);
          return c;
        }
        case "Leave town":
          return sprite(okay?.get(0)?.[0]?.texture);
        case "Split":
          return sprite(split?.get(0)?.[0]?.texture);
      }
      return sprite(undefined);
    };
  }

  /** A square (or `w` wide) button round a picture, a recessed box in gold; greyed it says `why` on a tap. `w` 0: the picture's own size. */
  private actionTile(art: Container, title: string, w: number, h: number, on: boolean, fn: () => void, why?: Text): Container {
    const c = new Container();
    c.label = `button: ${title}`;
    const b = art.getLocalBounds();
    const [bw, bh] = w ? [w, h] : [b.width + 8, b.height + 8];
    // On the town panel's own leather box (TOWNSCRN's, as the original's icons on its colour); else on the player's
    // colour (the adventure map's date plate), in gold: the desktop's buttons are (2026-10-26).
    // (A small one, the armies' trade, swap and split, on the town panel's own slot: the rim would fill it.)
    const small = Math.min(bw, bh) < 64;
    const boxed = small ? !!this.slotTex && !this.slotTex.destroyed : !!this.tileBox && !this.tileBox.leather.destroyed;
    if (boxed && small) {
      const box = Object.assign(new Sprite(this.slotTex!), { width: bw, height: bh });
      if (!on) box.tint = 0x707070;
      c.addChild(box);
    } else if (boxed) {
      const { leather, rim } = this.tileBox!;
      const box = townRimOver(new TilingSprite({ texture: leather, width: bw, height: bh }), rim, bw, bh);
      if (!on) for (const p of box.children as Sprite[]) p.tint = 0x707070;
      c.addChild(box);
    } else if (this.plateTex && !this.plateTex.destroyed) {
      const plate = new TilingSprite({ texture: this.plateTex, width: bw, height: bh });
      if (!on) plate.tint = 0x707070;
      c.addChild(plate);
    }
    c.addChild(new Graphics().rect(0, 0, bw, bh).fill({ color: 0, alpha: this.plateTex || boxed ? 0.001 : 0.6 }).stroke(boxed ? { width: 0 } : { color: 0xc9a046, width: 2, alignment: 1 }));
    // Raised as the rail's buttons: light along the top and left, shade along the bottom and right; pressed, the other way.
    const bevel = new Graphics();
    // (A thin edge, as the rail's: a thick one read as a pink frame on the big tiles.)
    const e = Math.max(2, Math.min(5, Math.round(Math.min(bw, bh) / 24)));
    const raise = (up: boolean) => {
      const [hi, lo] = up ? [0xfff2c0, 0x000000] : [0x000000, 0xfff2c0];
      bevel
        .clear()
        .poly([0, 0, bw, 0, bw - e, e, e, e, e, bh - e, 0, bh])
        .fill({ color: hi, alpha: up ? 0.45 : 0.5 })
        .poly([bw, 0, bw, bh, 0, bh, e, bh - e, bw - e, bh - e, bw - e, e])
        .fill({ color: lo, alpha: up ? 0.55 : 0.3 });
    };
    raise(true);
    // (The box has its own bevel; pressed, it gets the drawn one.)
    if (boxed) bevel.alpha = 0;
    c.addChild(bevel);
    // (Not past 2.5x: a 32-pixel picture blown up any more is a blur; the plate shows round it.)
    const k = Math.min(2.5, (bw - 6) / Math.max(1, b.width), (bh - 6) / Math.max(1, b.height));
    art.scale.set(k);
    art.position.set(Math.round((bw - b.width * k) / 2 - b.x * k), Math.round((bh - b.height * k) / 2 - b.y * k));
    art.eventMode = "none";
    if (!on) art.alpha = 0.3;
    c.addChild(art);
    c.eventMode = "static";
    c.cursor = "pointer";
    const at = { x: art.x, y: art.y };
    const press = (down: boolean) => {
      if (!on) return;
      // The original's click as the button goes down (2026-10-31: "make buttons click").
      if (down) void playSound("button");
      raise(!down);
      if (boxed) bevel.alpha = down ? 1 : 0;
      art.position.set(at.x + (down ? 2 : 0), at.y + (down ? 2 : 0));
    };
    c.on("pointerdown", () => press(true));
    c.on("pointerup", () => press(false));
    c.on("pointerupoutside", () => press(false));
    c.on("pointertap", (e) => {
      if (e.button === 2) return;
      if (on) fn();
      else if (why) this.hint(why);
    });
    return c;
  }

  /** A line said for a moment over the town (a greyed button's why), readable on the phone. */
  private hint(text: Text) {
    const town = this.town;
    this.hintBox?.destroy({ children: true });
    const box = new Container();
    box.label = `hint: ${text}`;
    const t = label(text, "medfont", WHITE, "center", 360);
    const k = Math.max(1.25, 16 / (16 * screenSize.css));
    t.scale.set(k);
    box.addChild(new Graphics().roundRect(-10, -6, t.width + 20, t.height + 12, 4).fill({ color: 0, alpha: 0.85 }).stroke({ color: 0xc9a046, width: 2 }), t);
    box.position.set(Math.round(400 - t.width / 2), Math.round(300 - t.height / 2));
    box.eventMode = "none";
    town.root.addChild(box);
    this.hintBox = box;
    setTimeout(() => box.destroyed || (box.destroy({ children: true }), this.hintBox === box && (this.hintBox = null)), 2500);
  }

  /** The town's name in gold between the tall arrows to the previous and the next town (`step` null: one town). */
  private async namePlate(o: AdvObject, step: ((d: number) => void) | null): Promise<Container> {
    const c = new Container();
    const fallback = TOWNS[o.subid]?.faction ?? "town";
    const name = label(said(o.name) ?? townName(fallback), "medfont", YELLOW);
    if (!step) {
      c.addChild(name);
      return c;
    }
    const prev = new DefButton("hsbtns3.def", 0, 0, -1);
    const next = new DefButton("hsbtns5.def", 0, 0, -1);
    await Promise.all([prev.ready, next.ready]);
    prev.label = "button: Previous town";
    next.label = "button: Next town";
    prev.onClick = () => step(-1);
    next.onClick = () => step(1);
    // (The arrows a little smaller than the name's line height doubled: they stand beside it, not over it.)
    const ak = (name.height * 1.6) / prev.height;
    prev.scale.set(ak);
    next.scale.set(ak);
    name.position.set(prev.width + 6, Math.round((prev.height - name.height) / 2));
    next.position.set(name.x + name.width + 6, 0);
    c.addChild(prev, name, next);
    return c;
  }

  /** The creatures to recruit, a column each (picture, to buy now, the week's growth), and the Blacksmith's machine; a tap recruits. */
  private async rosterTiles(o: AdvObject, cols = 9, compact = false): Promise<Container> {
    const town = this.town;
    const s = town.state!;
    const w = town.world!;
    const t = o.town!;
    const levels = Math.min(8, levelCount(o));
    // Each creature its own framed box, a finger's target with room between them (2026-10-30: "slightly larger
    // hit boxes per unit, not necessarily bigger portraits, but maybe borders"): the owner's colour behind the picture,
    // a gold rim, the counts on a dark strip under it.
    const RC = 52;
    const IN = 3;
    // (Compact: no growth line; a long press shows it.)
    const RH = compact ? 66 : 84;
    const APART = 10;
    const c = new Container();
    c.label = "panel: creatures to recruit";
    const plate = this.plateTex && !this.plateTex.destroyed ? this.plateTex : null;
    const leather = await loadImage("diboxbck.pcx").catch(() => null);
    const cell = async (i: number, cr: CreatureStats | undefined, here: boolean, fn: () => void, counts?: [number, number]) => {
      if (!cr) return;
      const cl = new Container();
      cl.label = `recruit: ${cr.plural}`;
      // The Blacksmith's machine set apart from the creatures in their row (2026-10-26 22:15: it read as an eighth level).
      cl.position.set((i % cols) * RC + (i === levels && i % cols ? APART : 0), Math.floor(i / cols) * RH);
      cl.addChild(new Graphics().rect(0, 0, RC, RH).fill({ color: 0, alpha: 0.001 }));
      const [bw, bh] = [RC - 2 * IN, RH - 2 * IN];
      // (The leather of the desktop's growth boxes on the panel's colour; without it the player's plate.)
      const box = leather ?? plate;
      if (box) cl.addChild(Object.assign(new TilingSprite({ texture: box, width: bw, height: bh }), { x: IN, y: IN, tint: here ? 0xffffff : 0x606060, label: "part: creature box" }));
      cl.addChild(
        new Graphics()
          .rect(IN, IN + 44, bw, bh - 44)
          .fill({ color: 0, alpha: 0.6 })
          .rect(IN, IN, bw, bh)
          .stroke({ color: 0x000000, width: 3, alpha: 0.6 })
          .rect(IN, IN, bw, bh)
          .stroke({ color: here ? 0xc9a046 : 0x6b5a2e, width: 2 }),
      );
      const tex = await creaturePortrait(cr, "small");
      if (tex) cl.addChild(Object.assign(new Sprite(tex), { x: Math.round((RC - 40) / 2), y: IN + 2, width: 40, height: 40, alpha: here ? 1 : 0.35 }));
      if (here && counts) {
        const n = label(said(String(counts[0])), "medfont", YELLOW, "center", RC);
        n.position.set(0, IN + 44);
        cl.addChild(n);
        if (!compact) {
          const g = label(fmt`+${counts[1]}`, "medfont", WHITE, "center", RC);
          g.position.set(0, IN + 59);
          cl.addChild(g);
        }
      }
      if (here) {
        cl.eventMode = "static";
        cl.cursor = "pointer";
        cl.on("pointertap", (e) => e.button !== 2 && fn());
        // Pressed: the box sinks a little, with the original's click (2026-10-31: "make buttons click").
        const sink = (down: boolean) => cl.pivot.set(down ? -2 : 0, down ? -2 : 0);
        cl.on("pointerdown", (e) => e.button !== 2 && (sink(true), void playSound("button")));
        cl.on("pointerup", () => sink(false));
        cl.on("pointerupoutside", () => sink(false));
      }
      creatureHold(cl, town.modals, Math.max(0, o.owner), cr, () => ({ count: counts?.[0] ?? 1 }));
      c.addChild(cl);
    };
    await Promise.all([
      ...Array.from({ length: levels }, (_, level) =>
        cell(level, w.creatures[townLevelCreature(o, level) ?? -1], t.built.includes(dwellingId(level)), () => void buildingClicked(town.ctx(), dwellingId(level)), [t.available[level] ?? 0, weeklyGrowth(w, o, level, s)]),
      ),
      cell(levels, w.creatures[MACHINE_CREATURE[blacksmithMachine(o)]], t.built.includes(B.BLACKSMITH), () => void buildingClicked(town.ctx(), B.BLACKSMITH)),
    ]);
    const [gw, gh] = [Math.min(cols, levels + 1) * RC + (levels % cols ? APART : 0), Math.ceil((levels + 1) / cols) * RH];
    c.addChildAt(new Graphics().rect(0, 0, gw, gh).fill({ color: 0, alpha: 0.001 }), 0);
    // (On the panel's own colour, each box leather in gold, as the desktop's growth boxes: the owner, 2026-11-01.)
    c.eventMode = "static";
    return c;
  }

  /**
   * The garrison's and the visiting hero's armies, the stacks managed in place (tap picks, a tap elsewhere moves, a
   * long press the stack's card). Upright (2026-11-01 19:05-19:12: the width is scarce, so no hero in a row of
   * seven; and no heroes in a band between the rows): the garrison's hero over its seven, the visiting hero's seven,
   * its hero under them, each hero against its own army. Sideways: each hero at the head of its row, the trade and swap buttons between the two.
   */
  private async armiesBlock(o: AdvObject, upright: boolean, redraw: () => void): Promise<Container> {
    const town = this.town;
    const s = town.state!;
    const w = town.world!;
    const keep = garrisonHero(s, o);
    const visitor = visitingHero(s, w, o);
    const c = new Container();
    c.label = "panel: town armies";
    c.eventMode = "static";
    const grids = await Promise.all(
      ([[0, upperArmy(s, o)], [1, visitor?.army ?? []]] as const).map(async ([row, army]) => {
        // (On the town panel's own places, in the owner's colours: TOWNSCRN's.)
        const g = new StackGrid({ size: "large", cols: 7, gap: 4, count: "corner", countFont: "medfont", frames: true, boxes: { pic: TOWNSCRN, name: "slot", player: Math.max(0, o.owner) } }, { creatures: w.creatures, who: row, clicks: town.army, changed: redraw });
        await g.set(army);
        return g;
      }),
    );
    const [up, down] = await Promise.all([heroSlot(town, o, "up", redraw, upright), heroSlot(town, o, "down", redraw, upright)]);
    const [cursor, upArrow, downArrow, splitArt] = await Promise.all([
      loadDef("cradvntr.def").then((d) => d.get(0)?.[8]?.texture).catch(() => undefined),
      loadDef("iam014.def").then((d) => d.get(0)?.[0]?.texture).catch(() => undefined),
      loadDef("iam015.def").then((d) => d.get(0)?.[0]?.texture).catch(() => undefined),
      loadDef("idv6432.def").then((d) => d.get(0)?.[0]?.texture).catch(() => undefined),
    ]);
    const art = (...texs: (Texture | undefined)[]) => {
      const a = new Container();
      let x = 0;
      for (const tex of texs) if (tex) ((a.addChild(Object.assign(new Sprite(tex), { x })), (x += tex.width + 2)));
      return a;
    };
    // Swap: the original's up arrow over its down arrow (side by side they read as "~~", the owner 2026-10-26 22:16).
    const upDown = (u?: Texture, d?: Texture) => {
      const a = new Container();
      if (u) a.addChild(new Sprite(u));
      if (d) a.addChild(Object.assign(new Sprite(d), { y: (u?.height ?? 0) + 2 }));
      return a;
    };
    const both = !!keep && !!visitor && !!town.onExchange;
    const B_ = upright ? 32 : 42;
    // Trade: the adventure map's cursor for meeting a hero (two arrows); swap: up and down.
    const trade = this.actionTile(art(cursor), en("Trade"), B_, B_, both, () => keep && visitor && town.onExchange?.(keep.id, visitor.id, town.modals), tr("Both places need a hero."));
    const wideB = upright ? 56 : B_;
    const swap = this.actionTile(upDown(upArrow, downArrow), en("Swap"), wideB, B_, !!keep || !!visitor, () => town.send({ type: "swapGarrison", town: o.id }), tr("Both places need a hero."));
    const split = this.actionTile(art(splitArt), en("Split"), wideB, B_, !!town.army.selected, async () => void ((await town.army.splitSelected()) ? redraw() : this.hint(tr("Pick a stack of two or more first."))), tr("Pick a stack of two or more first."));
    split.label = "button: Split";
    const gold = 0xc9a046;
    if (upright) {
      const thumbLeft = oneHand() === "left";
      /** Buttons side by side, 8 apart, against the left edge or the right one (at `w`). */
      const rowAt = (bs: Container[], w: number, y: number, left: boolean) => {
        let x = left ? 0 : w - bs.reduce((n, b) => n + b.width + 8, -8);
        for (const b of bs) (b.position.set(x, y), (x += b.width + 8));
      };
      // The gold frame round each army, its hero in it.
      const g = new Graphics();
      const m = 3;
      const frame = (x: number, y: number, fw: number, fh: number) => g.rect(x - m, y - m, fw + 2 * m, fh + 2 * m).stroke({ color: gold, width: 2 });
      // The garrison's hero (portrait and name) over its seven, the visiting hero's seven, its hero under them; trade
      // and swap in the garrison hero's line, split in the visiting hero's, at the thumb's side.
      const RW = 7 * 62 - 4;
      const names = [garrisonHero(s, o)?.name, visitor?.name];
      const line = (slot: Container, y: number, i: number) => {
        slot.position.set(thumbLeft ? RW - 48 : 0, y);
        c.addChild(slot);
        const n = names[i];
        if (n) {
          const t = label(said(n) ?? tr("Hero"), "medfont", YELLOW);
          t.label = `hero name: ${n}`;
          t.position.set(thumbLeft ? RW - 48 - 8 - t.width : 56, y + Math.round((32 - t.height) / 2));
          c.addChild(t);
        }
      };
      const y1 = 32 + 6;
      const y2 = y1 + 64 + 6;
      const y3 = y2 + 64 + 6;
      grids[0].position.set(0, y1);
      grids[1].position.set(0, y2);
      frame(0, y1, RW, 64);
      frame(0, y2, RW, 64);
      c.addChild(g, ...grids);
      line(up, 0, 0);
      line(down, y3, 1);
      const top = [trade, swap];
      rowAt(top, RW, 0, thumbLeft);
      rowAt([split], RW, y3, thumbLeft);
      c.addChild(...top, split);
    } else {
      // Each hero at the head of its row; between the heroes and the stacks trade, swap and split, one over another.
      up.position.set(0, 0);
      down.position.set(0, 64 + 6);
      trade.position.set(58 + 4, 0);
      swap.position.set(58 + 4, B_ + 4);
      split.position.set(58 + 4, 2 * (B_ + 4));
      grids[0].position.set(58 + 4 + 44 + 4, 0);
      grids[1].position.set(58 + 4 + 44 + 4, 64 + 6);
      c.addChild(...grids, up, down, trade, swap, split);
    }
    // (On the panel's colour, the places leather in gold: the desktop's town panel; The owner, 2026-11-01.)
    return c;
  }
}
