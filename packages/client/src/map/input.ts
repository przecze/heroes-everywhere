// The adventure map's pointer and keys: a click (tap) on a tile plans a route and the second walks
// it, drags and the wheel move the view, the right button (a finger held) shows what's there, hovering
// names it in the status bar with the original's cursor; the original's hotkeys, the message line
// (Tab), and a console controller's context.
import { type AdvObject, type AdventureState, type Hero, groundPatch, findPaths, portalLinks, thievesGuild, tavernLevel, visitTile, ownTowns } from "@heroes/core";
import type { Container } from "pixi.js";
import { extra, extra as extraOn, settings } from "../settings.ts";
import { ownGarrisons } from "./walk.ts";
import { tr, said, fallback } from "../i18n/index.ts";
import { track } from "../usage.ts";
import { messageBox as dialog } from "../ui/dialogs.ts";
import { screenSize, toGame, touchLayoutWanted } from "../ui/screen.ts";
import { spellOfHotkey } from "../ui/spellHotkeys.ts";
import { thievesGuildWindow } from "../ui/thievesGuild.ts";
import { AdvCursor, adventureCursor, defaultCursor } from "../cursors.ts";
import { consumeLongPress, isTouchLongPress } from "../touch.ts";
import { onPageEnd } from "../pages.ts";
import { browsersKey, undoKey } from "../chrome/browserKeys.ts";
import { describeTile, groundText, seenBy } from "./describe.ts";
import { textFramePopup, tilePopup } from "./popups.ts";
import { HoldPopup, heroPanel } from "./holdPopup.ts";
import { mapCursor as mapCursorKind } from "./mapCursor.ts";
import { MessageLine } from "./messageLine.ts";
import { setMapPadHooks } from "./padKeys.ts";
import type { MapSession } from "./session.ts";

/** The map's own Ctrl combinations (VCMI's keyBindingsConfig): the first hero, the first town, scrolling the map. */
const MAP_COMBOS = ["h", "t", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];

/** What's on a tile the player has seen: the hero there or the object (null: unexplored, or off the map). */
type TileThings = { hero: Hero | undefined; object: AdvObject | undefined } | null;

export class MapInput {
  /** Clicks the map took (probes check that taps on panels over it don't count). */
  tileClicks = 0;
  private drag: { x: number; y: number; moved: boolean; id: number } | null = null;
  private readonly fingers = new Set<number>();
  private pinched = false;
  /** The selected hero's routes, kept until the state or the selection changes. */
  private routes: { state: AdventureState; hero: number; paths: ReturnType<typeof findPaths> } | null = null;
  // Right-click: the original's popup while the button is held.
  private readonly popups: HoldPopup;
  /** The message line (Tab): a cheat code for the selected hero and the town it stands by (else the first). */
  private readonly messageLine: MessageLine;
  private readonly s: MapSession;

  constructor(s: MapSession) {
    this.s = s;
    this.popups = new HoldPopup(s.app);
    this.messageLine = new MessageLine(
      (text) => s.hud.setStatus(said(text), true),
      (code) => {
        if (!s.state || !s.myTurn()) return;
        const mine = ownTowns(s.state, s.me());
        const h = s.selected >= 0 ? s.state.heroes[s.selected] : undefined;
        const town = (h && mine.find((o) => o.x - 2 <= h.x && h.x <= o.x && o.y === h.y)) ?? mine[0];
        s.sendAct({ type: "cheat", code, hero: s.selected >= 0 ? s.selected : undefined, town: town?.id });
      },
    );
  }

  screenToTile = (e: PointerEvent) => this.s.camera.tileAt(e.clientX, e.clientY);
  /** Is the pointer over the map viewport (not the frame or side panel)? */
  private inViewport(e: { clientX: number; clientY: number }) {
    return this.s.camera.inViewport(e.clientX, e.clientY);
  }
  /** What's on a tile, if the player has seen it: the hero there or the object. */
  thingsAt = (x: number, y: number): TileThings => {
    const { state, world, view } = this.s;
    if (!state || !world) return null;
    const z = view.currentLevel;
    const i = world.index(x, y, z);
    if (i < 0) return null;
    const p = state.players[this.s.me()];
    if (!this.s.fogLifted && p?.revealed.length && !(p.revealed[i >> 5] & (1 << (i & 31)))) return null;
    world.refresh(state);
    const hero = state.heroes.find((h) => !h.removed && h.x === x && h.y === y && h.z === z);
    const found = state.objects[(world.blockedBy[i] || world.visitBy[i]) - 1];
    // A map event is invisible: bare ground to the cursor and the right-click.
    const object = found?.type === 26 ? undefined : found;
    return { hero, object };
  };

  /** (EXTRAS tapObject) The entrance of the object whose body (a tile it blocks, not its entrance) is at this tile. */
  private bodyDoor(x: number, y: number): { x: number; y: number; tile: number } | undefined {
    const { state, world, view } = this.s;
    if (!state || !world || !extra("tapObject")) return undefined;
    const i = world.index(x, y, view.currentLevel);
    const obj = i >= 0 && world.blockedBy[i] && !world.visitBy[i] ? state.objects[world.blockedBy[i] - 1] : undefined;
    const door = obj && !obj.removed ? visitTile(world, obj) : -1;
    return door >= 0 && door !== i ? { x: door % world.size, y: Math.floor(door / world.size) % world.size, tile: door } : undefined;
  }
  /** The original cursor for what a click would do: walk, attack, visit, trade armies, sail..., by days away. */
  private mapCursor(x: number, y: number, at: TileThings): string {
    const st = this.s.state;
    const w = this.s.world;
    if (!st || !w || this.s.worldView.active) return adventureCursor(AdvCursor.Pointer);
    const door = this.bodyDoor(x, y);
    if (door) return this.mapCursor(door.x, door.y, this.thingsAt(door.x, door.y));
    const h = st.heroes[this.s.selected];
    const paths = () => {
      if (this.routes?.state !== st || this.routes.hero !== h.id) {
        w.refresh(st);
        // Explored ground only, like the route a click plans (else the horse promised a way the click refused).
        this.routes = { state: st, hero: h.id, paths: findPaths(w, st, h, true, ownGarrisons(w, st, h)) };
      }
      return this.routes.paths;
    };
    const { kind, days } = mapCursorKind({ w, s: st, me: this.s.me(), hero: h, at, x, y, z: this.s.view.currentLevel, myTurn: this.s.myTurn(), aimingSpell: this.s.aiming?.spell, paths });
    return adventureCursor(kind, days);
  }
  /** Bare ground's words (VCMI's getTerrainDescr): the terrain, "(digging ok)" where a hero could dig; unexplored, "Uncharted Territory". */
  private groundAt(x: number, y: number, popup: boolean) {
    const { state, world, view } = this.s;
    const i = world ? world.index(x, y, view.currentLevel) : -1;
    const tile = i >= 0 ? world!.map.tiles[i] : undefined;
    if (!state || !world || !tile) return "";
    if (!this.thingsAt(x, y)) return groundText(-1, false, popup);
    // (Not water, nor rock.)
    const land = tile.terrain !== 8 && tile.terrain !== 9;
    return groundText(tile.terrain, land && !world.blockedBy[i] && !world.visitBy[i] && !(state.holes ?? []).includes(i), popup, land ? groundPatch(world, { x, y, z: view.currentLevel }) : undefined);
  }
  /** The status bar's words for a tile: what stands there, else the ground. */
  private tileStatus(x: number, y: number) {
    const { state, world } = this.s;
    const at = this.thingsAt(x, y);
    const said = at && state && world ? describeTile(at.object, at.hero, this.s.me(), world.creatures, this.s.data.artifacts, seenBy(state, this.s.me(), this.s.selected, this.s.data.spells)) : "";
    return said || (at && !at.hero && !at.object ? this.groundAt(x, y, false) : said);
  }
  private showPopup(e: PointerEvent) {
    const s = this.s;
    // Aiming an adventure spell: the right button calls it off (VCMI's onTileRightClicked).
    if (s.aiming) {
      s.aiming = null;
      s.status(said(""));
      return;
    }
    let t = this.screenToTile(e);
    let at = this.thingsAt(t.x, t.y);
    if (!s.state || !s.world) return;
    // A monster's picture stands a tile above and left of its own (a 64 x 64 frame over one tile): a finger on its head or
    // its back is on the monster, not the grass behind it (a 2026-11-02 note: "can't hold the Unicorns, only the terrain").
    if (at && !at.hero && !at.object)
      for (const [dx, dy] of [[0, 1], [1, 1], [1, 0]]) {
        const below = this.thingsAt(t.x + dx, t.y + dy);
        if (below?.object?.type === 54 && !below.hero) {
          t = { ...t, x: t.x + dx, y: t.y + dy };
          at = below;
          break;
        }
      }
    const { x, y } = toGame(e.clientX, e.clientY);
    // Unexplored or bare ground: its name in a small popup, as the original.
    const ground = !at || (!at.hero && !at.object) ? this.groundAt(t.x, t.y, true) : "";
    if (ground) return void this.popups.show(() => textFramePopup(s.advCtx, ground), x, y);
    if (!at) return;
    void this.popups.show(async () => this.withPortalLinks(at.object, await tilePopup(s.advCtx, at, s.selected)), x, y);
  }
  /** A teleport's popup: lines on the map to where it leads, while the popup is up (EXTRAS portalLinks). */
  private withPortalLinks(o: AdvObject | undefined, frame: Container | null) {
    const { state, world, view } = this.s;
    const links = frame && o && state && world && extra("portalLinks") ? portalLinks(state, world, this.s.me(), o, extra("cyclicPortals")) : null;
    if (!links || !frame || !o || !world) return frame;
    const w = world;
    const tile = (x: AdvObject) => {
      const i = visitTile(w, x);
      return i < 0 ? { x: x.x, y: x.y, z: x.z } : { x: i % w.size, y: Math.floor(i / w.size) % w.size, z: Math.floor(i / (w.size * w.size)) };
    };
    const here = tile(o);
    const level = view.currentLevel;
    const marks = [...links.exits.map((x) => ({ x, back: false })), ...links.entrances.map((x) => ({ x, back: true }))].map(({ x, back }) => ({ ...tile(x), next: x === links.next, back }));
    if (here.z === level) frame.once("destroyed", view.portalLinks(here, marks.filter((m) => m.z === level)));
    return frame;
  }
  /** Over a panel of the HUD that lies on the map (the phone's hero chip and panel, lists): not the map's. */
  private overHud(e: PointerEvent) {
    const g = toGame(e.clientX, e.clientY);
    for (let n: Container | null = this.s.app.renderer.events.rootBoundary.hitTest(g.x, g.y); n; n = n.parent) if (n === this.s.hud.root) return true;
    return false;
  }

  /** The same popups for the heroes and towns in the side lists (hooked to the HUD; a new HUD takes it over). */
  wireHud() {
    const s = this.s;
    const { popups } = this;
    s.hud.onListInfo = (at, x, y) => {
      if (!s.state || !s.world || s.modals.open) return;
      const st = s.state;
      const own = at.hero !== undefined ? st.heroes[at.hero] : undefined;
      // A finger held on your hero in the list: its screen (EXTRAS portraitHold); the mouse's right button keeps the popup.
      if (own && own.owner === s.me() && own.garrison === undefined && isTouchLongPress() && extra("portraitHold")) return void s.panel.openHeroScreen(own.id);
      // Your hero (EXTRAS heroListPanel): the battle's hero panel (CHRPOP).
      if (own && own.owner === s.me() && extra("heroListPanel")) return void popups.show(() => heroPanel(st, s.world!, own), x, y, popups.heroPanelAt(x, y));
      // Touch screens: in the middle (by the finger it sat under the page's menu buttons and the list).
      void popups.show(() => tilePopup(s.advCtx, { hero: at.hero !== undefined ? st.heroes[at.hero] : undefined, object: at.town !== undefined ? st.objects[at.town] : undefined }, s.selected), x, y, screenSize.touch ? popups.centre : undefined);
    };
  }

  /** The pointer on the map: taps and clicks, drags, the right button, hovering, pinches and the wheel. */
  listenPointer() {
    const s = this.s;
    const { app, camera } = s;
    const { popups } = this;
    app.canvas.addEventListener("pointerdown", (e) => {
      // A touch screen's popup stays up until the next touch, which only closes it.
      if (popups.open && screenSize.touch) {
        popups.close();
        if (e.button !== 2) return;
      }
      if (e.button === 2) {
        if (this.inViewport(e) && !this.overHud(e) && !s.modals.open && !s.battle && !s.town.open) this.showPopup(e);
        return;
      }
      // A second finger makes it a pinch: no drag until every finger is up (the drag followed both
      // fingers in turn, and the one left after a pinch, so the map leapt about).
      if (e.pointerType === "touch") {
        this.fingers.add(e.pointerId);
        if (this.fingers.size > 1) return void ((this.drag = null), (this.pinched = true));
        if (this.pinched) return;
      }
      // Not under a battle: the tap that closes its results would land on the map as it comes back.
      if (this.inViewport(e) && !this.overHud(e) && !s.modals.open && !s.battle) this.drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    });
    const fingerUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      this.fingers.delete(e.pointerId);
      if (!this.fingers.size) this.pinched = false;
    };
    window.addEventListener("pointercancel", (e) => {
      fingerUp(e);
      if (this.drag?.id === e.pointerId) this.drag = null;
    });
    window.addEventListener("pointerup", (e) => {
      fingerUp(e);
      if (e.button === 2) return;
      if (this.drag && this.drag.id !== e.pointerId) return;
      const d = this.drag;
      this.drag = null;
      // A long press showed the popup; lifting the finger isn't a click.
      if (e.pointerType === "touch" && !s.battle && !s.town.open && consumeLongPress()) return;
      if (!d || d.moved || e.target !== app.canvas || s.battle || s.town.open) return;
      const t = this.screenToTile(e);
      // No hover on a touch screen: the tap names what's there in the status line instead.
      if (e.pointerType === "touch" && s.state && s.world) s.hud.setStatus(said(this.tileStatus(t.x, t.y)));
      this.clickTile(t);
    });
    window.addEventListener("pointermove", (e) => {
      const drag = this.drag;
      // Hovering the map names what's under the pointer in the status bar.
      if (!drag && !s.battle && !s.town.open && !s.modals.open && s.state && s.world && e.target === app.canvas && this.inViewport(e)) {
        const t = this.screenToTile(e);
        const at = this.thingsAt(t.x, t.y);
        s.hud.setStatus(said(this.tileStatus(t.x, t.y)));
        app.canvas.style.cursor = this.mapCursor(t.x, t.y, at);
      } else if (!s.battle && !s.town.open && e.target === app.canvas) app.canvas.style.cursor = s.modals.open ? defaultCursor() : adventureCursor(AdvCursor.Pointer);
      if (!drag || s.battle || drag.id !== e.pointerId) return;
      // A finger wobbles more than a mouse: past 14 pixels a touch is a drag, not a tap.
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > (e.pointerType === "touch" ? 14 : 4)) drag.moved = true;
      if (!drag.moved) return;
      camera.dragBy(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    camera.listenPinch(
      () => !s.battle && !s.town.open && !s.modals.open,
      () => (this.drag = null),
    );
    app.canvas.addEventListener(
      "wheel",
      (e) => {
        if (s.battle || !this.inViewport(e)) return;
        e.preventDefault();
        if (!s.worldView.active) camera.wheel(e);
      },
      { passive: false },
    );
  }

  clickTile = ({ x, y }: { x: number; y: number }) => {
    const s = this.s;
    const { walk } = s;
    this.tileClicks++;
    // A click while the hero walks stops it (after the step under way), and does nothing else.
    if (walk.walking) return void walk.stop();
    // In the world view a click goes back to the map, looking at that spot.
    if (s.worldView.active) {
      s.worldView.close();
      return s.centerOn(x, y);
    }
    const { state, map, world } = s;
    if (!state || !map || !world || !s.myTurn()) return;
    const z = s.view.currentLevel;
    if (s.aiming) {
      const a = s.aiming;
      s.aiming = null;
      s.sendAct({ type: "castSpell", hero: a.hero, spell: a.spell, target: world.index(x, y, z) });
      return;
    }
    // Your selected hero: the hero screen. Another of your heroes: walk over to meet (as in the original).
    const own = s.myHeroes().find((h) => h.x === x && h.y === y && h.z === z && h.garrison === undefined);
    if (own && own.id === s.selected) return s.panel.openHeroScreen(own.id);
    if (own && (s.selected < 0 || state.heroes[s.selected]?.removed)) return s.selectHero(own, false);
    world.refresh(state);
    const at = world.index(x, y, z);
    const obj = at >= 0 ? state.objects[(world.blockedBy[at] || world.visitBy[at]) - 1] : undefined;
    const h = state.heroes[s.selected];
    let target = at;
    // A tap on the body of an object with an entrance (the Dragon Utopia's walls) goes to the entrance.
    target = this.bodyDoor(x, y)?.tile ?? target;
    // Your town: the selected hero walks to its gate; with no hero (or the hero already in the gate) it opens.
    if (obj?.town && obj.owner === s.me()) {
      const gate = visitTile(world, obj);
      if (!h || h.removed || gate < 0 || world.index(h.x, h.y, h.z) === gate) return obj.id === s.selectedTown || (h && !h.removed) ? s.openTown(obj.id) : s.selectTown(obj.id, false);
      // A finger has no cursor to tell the walk from the visit (2026-10-26: a tap on the town didn't open it): on a
      // touch screen a tap on the town's body opens it, its gate is where the hero walks.
      if (screenSize.touch && at !== gate) return s.openTown(obj.id);
      target = gate;
      // The selected hero can't get there: the town is selected instead (a second click opens it).
      if (!walk.planned || walk.planned.target !== gate) {
        if (!walk.planTo(h, gate)) return s.selectTown(obj.id, false);
        // System Options' Show Move Path off: no second click.
        if (settings().showPath) return void s.status(said(s.statusLine + (screenSize.touch ? tr(" Tap again to go.") : tr(" Click again to go."))));
      }
    }
    if (!h || h.removed) return;
    if (target < 0) return;
    if (walk.planned?.target === target) {
      // The arrows stay for the walk to eat up; a route longer than today's movement stays
      // planned, to continue tomorrow.
      // Right next to the hero (a pickup, a visit) there's no walk to eat the arrows: they go now.
      // (Walked a step at a time: what's left of the route is redrawn as it goes, and stays if stopped.)
      if (walk.planned.path.length <= 2) s.view.showPath([], 0);
      walk.route(h.id, target);
      return;
    }
    // (Nowhere to go: nothing happens, as in the original, on a touch screen too: the owner, 2026-10-26 22:02, a toast
    // saying so was worthless and annoying.)
    if (!walk.planTo(h, target)) {
      // Another of your heroes the selected one can't reach: selected instead (VCMI's onTileLeftClicked).
      if (own) return s.selectHero(own, false);
      return;
    }
    if (settings().showPath) return void s.status(said(s.statusLine + (screenSize.touch ? tr(" Tap again to go.") : tr(" Click again to go."))));
    // Show Move Path off: the first click walks.
    this.clickTile({ x, y });
  };

  /** A console's controller (map/padKeys.ts): where the player is, and the right stick moving the map's view. */
  listenPad() {
    const s = this.s;
    setMapPadHooks({
      context: () => (s.battle ? (!s.battles.drawn ? "loading" : s.battle.modals.open ? "window" : s.battle.myTactics() ? "tactics" : "battle") : s.modals.open || (s.town.open && s.town.modals.open) ? "window" : s.town.open ? "town" : s.worldView.active ? "world" : "map"),
      look: (x, y, dt) => {
        if (s.battle || s.town.open || s.modals.open || s.worldView.active) return false;
        s.camera.dragBy(-x * 1100 * dt, -y * 1100 * dt);
        return true;
      },
    });
    onPageEnd(() => setMapPadHooks(null));
  }

  listenKeys() {
    window.addEventListener("keydown", (e) => this.key(e));
  }

  private key(e: KeyboardEvent) {
    const s = this.s;
    const { modals, town, worldView, lobby, panel, bar, view, walk, savedGames } = s;
    const { messageLine } = this;
    const battle = s.battle;
    // No game hotkeys while typing in a text field (the feedback box, the page bar).
    if (e.target instanceof Element && e.target.closest("textarea, input, select, [contenteditable]")) return;
    // Nor under a page of its own (the touch save / load list): S there opened one more.
    if (document.querySelector(".scenarioPage")) return;
    // Ctrl+Z (Cmd+Z) in a battle: Undo (EXTRAS battleUndo).
    if (battle && !modals.open && !battle.modals.open && undoKey(e) && battle.undo()) return void e.preventDefault();
    // Nor the browser's own shortcuts (reload, new tab, copy...): only the map's Ctrl+H, Ctrl+T and Ctrl+arrows are ours.
    if (browsersKey(e, MAP_COMBOS)) return;
    if (!e.repeat && !messageLine.open) track(`key:${battle ? "battle " : town.open ? "town " : modals.open ? "window " : ""}${e.key}`);
    // Any key while the hero walks stops it, as a click does.
    if (walk.walking && !modals.open && !battle) {
      walk.stop();
      e.preventDefault();
      return;
    }
    // Tab: the message line in the status bar, as in the original (cheat codes go here).
    if (messageLine.open) {
      e.preventDefault();
      return messageLine.key(e.key);
    }
    // (Letters whatever Caps Lock or Shift say.)
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // In a multiplayer room the message line is the room's chat (the panel's, with what was said).
    if (key === "Tab" && lobby.room && !modals.open) {
      e.preventDefault();
      lobby.openChat();
      return;
    }
    if (key === "Tab" && !modals.open && !lobby.link && !battle && !town.open) {
      e.preventDefault();
      return messageLine.start();
    }
    if (modals.open) return;
    // F9 in a battle: the quick save, once the battle is given up (GENRLTXT's "your current game will be lost").
    if (battle && key === "F9" && !battle.modals.open && !lobby.link) {
      e.preventDefault();
      return void savedGames.quickLoad();
    }
    // A battle takes the keys first: its own C, Q, D... never reach the map's (Quest Log, dig...).
    if (battle) return void (battle.onKey(key) && e.preventDefault());
    if (s.aiming && key === "Escape") {
      s.aiming = null;
      s.status(said(""));
      return;
    }
    // The world view's own keys (VCMI's adventureViewWorld1 / 2 / 4 and adventureExitWorldView: Esc, Return).
    if (worldView.active && !town.open) {
      if (key === "Enter") return worldView.close();
      if (key === "1" || key === "2" || key === "4") return worldView.zoom(key === "1" ? 0.25 : key === "2" ? 0.5 : 1);
    }
    // A picked stack in the info bar: 1 to 4 are HotA's quick stack actions (before the spell hotkeys).
    if (!town.open && !modals.open && s.hud.army?.quickKey(key)) return void e.preventDefault();
    if (key === "c" && !town.open) return void panel.openAdventureSpells();
    // HD's spell hotkeys: the digit's spell, as picked from the book (spellHotkeys.ts).
    if (/^[0-9]$/.test(key) && !town.open && extraOn("spellHotkeys") && spellOfHotkey(key) !== undefined) return void panel.openAdventureSpells(s.selected, spellOfHotkey(key));
    if (!town.open && key === "p") return panel.openPuzzle();
    if (!town.open && key === "i") return void panel.scenarioInfo();
    // As in the original (VCMI's adventureGameOptions / globalOptions): A the adventure options, O the system options.
    // An addition (EXTRAS wasdScroll, off: W, A, S and D are the original's wake, adventure options, save and dig):
    // W, A, S and D scroll the map as the arrows do.
    if (!town.open && !modals.open && !e.ctrlKey && !e.metaKey && !e.altKey && extraOn("wasdScroll")) {
      const wasd = ({ w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] } as Record<string, [number, number]>)[key];
      if (wasd) {
        e.preventDefault();
        return s.camera.step(wasd[0], wasd[1]);
      }
    }
    if (!town.open && !modals.open && key === "a") return void panel.openAdvOptions();
    if (!town.open && !modals.open && key === "o") return void s.hud.onButton?.("sysOptions");
    if (!town.open && key === "k") return panel.openKingdom();
    if (!town.open && key === "q") return void panel.openQuests();
    if (!town.open && key === "v") return worldView.active ? worldView.close() : panel.openWorldView();
    if (worldView.active && key === "Escape") return worldView.close();
    // Esc on the map: the system options, as O (VCMI's globalOptions).
    // (Not the Esc that just closed the town screen or a window: that one is spent.)
    // (On a touch screen Escape is the phone's Back passed down: the same small question, never all of System Options.)
    if (!town.open && !modals.open && key === "Escape" && !e.defaultPrevented) return void (touchLayoutWanted() && panel.askLeave() ? undefined : s.hud.onButton?.("sysOptions"));
    if (!town.open && key === "d") return void panel.dig();
    if (e.target instanceof Element && e.target.closest("textarea, input, select")) return;
    if (town.open) {
      if (key === "Escape") town.close();
      return;
    }
    // The original's adventure hotkeys (VCMI's keyBindingsConfig), plus HD's quick save / load.
    if (!modals.open && !e.ctrlKey && !e.metaKey) {
      const okCancel = { buttons: [{ def: "iokay.def", value: "ok" }, { def: "icancel.def", value: "cancel" }] };
      const hotkey: Record<string, () => void> = {
        s: () => void savedGames.save(),
        n: () => void dialog(modals, tr("Are you sure you want to start a new game?"), s.color(), okCancel).then((v) => v === "ok" && void s.start.newGameDialog()),
        l: () => void savedGames.load(),
        r: () =>
          void (async () => (await s.gameLine(67)) ?? fallback("Are you sure you want to restart the scenario?"))().then((q) => dialog(modals, q, s.color(), okCancel).then((v) => {
            if (v === "ok" && s.state) void s.start.open(s.state.mapFile);
          })),
        z: () => s.state && s.selected >= 0 && !s.state.heroes[s.selected]?.asleep && s.hud.onButton?.("sleep"),
        w: () => s.state && s.selected >= 0 && s.state.heroes[s.selected]?.asleep && s.hud.onButton?.("sleep"),
        m: () => s.hud.onButton?.("move"),
        " ": () => s.hud.onButton?.("move"),
        c: () => s.hud.onButton?.("cast"),
        g: () => s.state && s.world && void thievesGuildWindow(modals, s.color(), thievesGuild(s.state, s.world, tavernLevel(s.state, s.me())), s.world.creatures, { resources: s.state.players[s.me()].resources, day: s.state.day }),
        F8: () => void (!lobby.link && savedGames.quickSave()),
        F9: () => void savedGames.quickLoad(),
      };
      const fn = hotkey[key];
      if (fn) {
        e.preventDefault();
        return void fn();
      }
    }
    // As in the original: the arrows (and Home / End / Page Up / Page Down diagonally) walk the
    // selected hero a tile; with Ctrl they scroll the map. An addition (EXTRAS arrowsScroll): the arrows
    // scroll the map and Shift + an arrow walks the hero (the diagonal keys still walk).
    const step = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], Home: [-1, -1], PageUp: [1, -1], End: [-1, 1], PageDown: [1, 1] } as Record<string, [number, number]>)[key];
    if (step) {
      e.preventDefault();
      const h = s.state && s.selected >= 0 ? s.state.heroes[s.selected] : undefined;
      const scrolls = key.startsWith("Arrow") && extraOn("arrowsScroll") && !e.shiftKey;
      if (scrolls || e.ctrlKey || e.metaKey || !h || h.removed || !s.world || !s.myTurn()) return s.camera.step(step[0], step[1]);
      const to = s.world.index(h.x + step[0], h.y + step[1], h.z);
      if (to >= 0) s.sendAct({ type: "move", hero: h.id, to, cyclicPortals: extra("cyclicPortals"), throughGarrisons: extra("throughGarrisons") });
      return;
    }
    // Enter: the selected hero's screen; Ctrl+H: the first hero.
    if (key === "Enter" && s.selected >= 0) return panel.openHeroScreen(s.selected);
    if (key === "h" && e.ctrlKey) {
      e.preventDefault();
      return s.selectHero(s.mapHeroes()[0]);
    }
    // Ctrl+T: the first town; keypad + / - and Backspace: zoom (VCMI's keyBindingsConfig).
    if (key === "t" && e.ctrlKey) {
      e.preventDefault();
      const first = (s.state ? ownTowns(s.state, s.me())[0] : undefined);
      return void (first && s.openTown(first.id));
    }
    if (!modals.open && (e.code === "NumpadAdd" || e.code === "NumpadSubtract" || key === "Backspace")) {
      e.preventDefault();
      return s.camera.zoomKey(key === "Backspace" ? 0 : e.code === "NumpadAdd" ? 1 : -1);
    }
    else if (key === "u") return bar.levelBtn.click();
    else if (key === "t") return bar.townBtn.click();
    else if (key === "`" && import.meta.env.DEV && s.state) {
      // Dev only: lift the fog to inspect the whole map.
      e.preventDefault();
      s.fogLifted = !s.fogLifted;
      view.viewer = s.fogLifted ? -1 : s.me();
      void view.update(s.state);
      return;
    }
    else if (key === "e") return bar.endTurn.click();
    else if (key === "h") return bar.heroBtn.click();
    else if (key === " " && walk.planned && s.state) {
      e.preventDefault();
      walk.walkPlanned();
      return;
    }
  }
}
