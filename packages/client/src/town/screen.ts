// The original town screen: town picture with clickable buildings, the TOWNSCRN panel
// (garrison and visiting hero), and the original building windows. Layouts follow VCMI's
// CCastleInterface and friends.
//
// This file is the screen's shared state, opening and closing, keys, the pinch zoom and what is redrawn when; each
// layout is a part: scene.ts (the picture: buildings, masks, hover, click), panel.ts (the desktop's TOWNSCRN panel),
// sideButtons.ts (a tablet's big buttons beside it), phone.ts (what the phone arrangements share), phoneFrame.ts (the
// phone's frame, the default), phoneFloating.ts (EXTRAS townFloating), phoneLayout.ts (the phones' sizes, numbers
// only); heroSlot.ts (a hero's place, every layout) and barIcons.ts (the buttons' pictures).
import { claimFKey } from "../feedback/index.ts";
import { centre, onLayout, phoneSized, screenSize, toGame } from "../ui/screen.ts";
import { onPinch } from "../touch.ts";
import {
  hallLevel,
  fortLevel,
  type AdventureAction,
  type AdventureState,
  type AdvObject,
  type ArmyRef,
  B,
  canPay,
  type World,
  buildingName,
  visitingHero, garrisonHero, upperArmy, townUpgrade, heroMoraleLuckParts } from "@heroes/core";
import { type Application, Container, Graphics, Sprite } from "pixi.js";
import { type GameText } from "../text.ts";
import { Modals } from "../ui/modals.ts";
import { extra } from "../settings.ts";
import { type TownCtx, buildingClicked, massRecruit } from "./windows.ts";
import { splitWindow } from "../ui/split.ts";
import { ArmyClicks, type StackRef } from "../ui/armyClicks.ts";
import { stackWindow } from "../ui/stackWindow.ts";
import { tr, type Text, said, NONE } from "../i18n/index.ts";
import { steadyTick } from "../ui/frameRate.ts";
import { stackInfo } from "../ui/stackBreakdown.ts";
import { resourceAmount } from "../ui/resourceNames.ts";
import { TownScene } from "./scene.ts";
import { TownPanel } from "./panel.ts";
import { TownSideButtons } from "./sideButtons.ts";
import { TownPhone } from "./phone.ts";
import { TownFrame } from "./phoneFrame.ts";
import { TownFloating } from "./phoneFloating.ts";
import { phoneLayout } from "./phoneLayout.ts";

export { preloadTown } from "./scene.ts";

export class TownScreen {
  readonly root = new Container();
  /** The scene and the panel, zoomed together by a pinch on touch screens. */
  readonly body = new Container();
  /** Phones: what fills the screen round the picture (the frame, or the picture's blurred copy). */
  readonly back = new Container();
  /** Phones: the picture's box (a zoomed picture stays in it). */
  readonly picMask = new Graphics();
  readonly scene = new Container();
  readonly panel = new Container();
  readonly outline = new Sprite();
  readonly modals: Modals;
  readonly app: Application;
  readonly send: (a: AdventureAction) => void;
  private townId = -1;
  /** A hero portrait picked to change places: the garrison one ("up") or the visiting one ("down"). */
  heroPick: "up" | "down" | null = null;
  /** The town on screen (its object id), or -1. */
  get objectId() {
    return this.townId;
  }
  /**
   * The original's town hotkeys (VCMI's keyBindingsConfig): B the hall, F the fort, G the mage
   * guild, T the tavern, M the market, L the blacksmith, Y the shipyard, R recruiting (HotA's
   * recruit-all), Space the heroes change places. True when the key did something.
   */
  private hotkey(key: string): boolean {
    const o = this.town();
    const t = o?.town;
    if (!o || !t) return false;
    const has = (id: number) => t.built.includes(id);
    const open = (id: number) => (has(id) ? void buildingClicked(this.ctx(), id) : undefined, true);
    switch (key.toLowerCase()) {
      case "b":
        return open(B.VILLAGE_HALL + Math.max(0, hallLevel(t.built)));
      case "f":
        return open(B.FORT + Math.max(0, fortLevel(t.built) - 1));
      case "g":
        return open([4, 3, 2, 1, 0].map((k) => B.MAGE_GUILD_1 + k).find(has) ?? B.MAGE_GUILD_1);
      case "t":
        return open(B.TAVERN);
      case "m":
        return open(B.MARKETPLACE);
      case "l":
        return open(B.BLACKSMITH);
      case "y":
        return open(B.SHIPYARD);
      case "r":
        if (fortLevel(t.built)) void massRecruit(this.ctx());
        return true;
      case " ":
        this.send({ type: "swapGarrison", town: o.id });
        return true;
      // VCMI's townOpenHero / townOpenHeroExchange: the visiting hero's screen (else the garrison's), the two heroes' exchange.
      case "h":
      case "e": {
        const s = this.state;
        const w = this.world;
        if (!s || !w) return false;
        const visiting = visitingHero(s, w, o);
        const garrison = garrisonHero(s, o);
        if (key.toLowerCase() === "h" && (visiting ?? garrison)) this.onHero?.((visiting ?? garrison)!.id, this.modals);
        if (key.toLowerCase() === "e" && visiting && garrison) this.onExchange?.(garrison.id, visiting.id, this.modals);
        return true;
      }
    }
    return false;
  }

  /** The town on screen, as the last state has it. */
  town(): AdvObject | undefined {
    return this.townId >= 0 ? this.state?.objects[this.townId] : undefined;
  }
  private builtKey = "";
  state: AdventureState | null = null;
  world: World | null = null;
  /** The desktop panel's status bar (panel.ts). */
  status: GameText | null = null;
  /** Garrison (0) and visiting hero (1): picked stacks, moves, splits. */
  readonly army = new ArmyClicks({
    armies: () => {
      const o = this.town();
      if (!o || !this.state || !this.world) return [];
      return [upperArmy(this.state, o), visitingHero(this.state, this.world, o)?.army ?? []];
    },
    move: (from, to, count) => this.send({ type: "moveStack", town: this.townId, from: armyRef(from), to: armyRef(to), count }),
    upgradeAll: () => {
      const o = this.town();
      return o ? this.upgradeAll(o) : { can: () => false, run: () => {} };
    },
    split: (creature, left, right, minLeft, quick) => (this.world ? splitWindow(this.modals, Math.max(0, this.town()?.owner ?? 0), this.world.creatures[creature], left, right, minLeft, quick) : Promise.resolve(null)),
    details: (ref) => {
      const o = this.town();
      if (o) void this.stackWindow(o, armyRef(ref));
    },
    // The visiting hero, and a garrison hero, can't be left without an army.
    keepsOne: (who) => who === 1 || (!!this.state && !!this.town() && !!garrisonHero(this.state, this.town()!)),
  });
  /** Windows that want to redraw when the state changes (the marketplace). */
  private listeners = new Set<() => void>();
  /** The town screen closed (the town's object id). */
  onClose: ((townId: number) => void) | null = null;
  /** A hero's screen over the town (a click on the picked portrait, H), in the town's window layer. */
  onHero: ((heroId: number, modals: Modals) => void) | null = null;
  /** The two heroes' exchange window (E, as the original's town). */
  onExchange: ((a: number, b: number, modals: Modals) => void) | null = null;

  // The parts.
  private readonly picture = new TownScene(this);
  private readonly desktop = new TownPanel(this);
  private readonly side = new TownSideButtons(this);
  readonly phone = new TownPhone(this);
  readonly frame = new TownFrame(this);
  readonly floating = new TownFloating(this);

  constructor(app: Application, _host: HTMLElement, send: (a: AdventureAction) => void) {
    this.app = app;
    this.send = send;
    this.body.addChild(this.scene, this.outline, this.panel);
    this.root.addChild(this.back, this.body, this.touch, this.picMask);
    // Touch screens: two fingers zoom into the town (1x to 2.5x) and move it about.
    let last: { x: number; y: number } | null = null;
    onPinch(
      (ratio, cx, cy) => {
        const p = this.root.toLocal(toGame(cx, cy));
        const base = this.baseView();
        const z = Math.max(base.k, Math.min(2.5 * base.k, this.body.scale.x * ratio));
        const from = last ?? p;
        const lx = (from.x - this.body.x) / this.body.scale.x;
        const ly = (from.y - this.body.y) / this.body.scale.y;
        this.body.scale.set(z);
        this.body.position.set(z === base.k ? base.x : p.x - lx * z, z === base.k ? base.y : p.y - ly * z);
        last = p;
      },
      () => (last = null),
      () => this.open && !this.modals.open,
    );
    onLayout(() => {
      this.resetView();
      if (this.state && this.townId >= 0) void this.drawTouch();
    });
    this.root.visible = false;
    this.root.zIndex = 500;
    centre(this.root);
    this.modals = new Modals(app);
    steadyTick(app, this.picture.tick);
    window.addEventListener("keydown", (e) => {
      if (!this.open || this.modals.open) return;
      if (e.target instanceof Element && e.target.closest("textarea, input, select")) return;
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        this.close();
      } else if (e.shiftKey && (e.key === "F" || e.code === "KeyF")) return; // Shift+F: Feedback (feedback/keys.ts)
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && (this.army.quickKey(e.key) || this.hotkey(e.key))) e.preventDefault();
    });
    // F is the Fort here, as the original: Feedback is Shift+F on this screen.
    claimFKey(() => this.open && !this.modals.open);
  }

  get open() {
    return this.root.visible;
  }

  async show(s: AdventureState, w: World, townId: number) {
    this.townId = townId;
    this.root.visible = true;
    this.resetView();
    this.army.selected = null;
    // Dev: click a building by id from the console / scripts.
    // (A name works too: the first building whose name starts with it, the UI catalog's way to open a page.)
    if (import.meta.env.DEV)
      Object.assign(window, {
        __townClick: (id: number | string) => {
          const o = this.state?.objects[this.townId];
          const hit = typeof id === "number" ? id : this.picture.hits.find((h) => this.world && o && buildingName(this.world, o, h.id).toLowerCase().startsWith(id.toLowerCase()))?.id;
          return this.open && hit !== undefined ? buildingClicked(this.ctx(), hit) : undefined;
        },
      });
    await this.render(s, w);
  }
  /** Opens building `id`'s window as a click on it would (the UI catalog's views of the towns' windows). */
  openBuilding(id: number) {
    return buildingClicked(this.ctx(), id);
  }

  close() {
    if (!this.open) return;
    this.root.visible = false;
    const id = this.townId;
    this.townId = -1;
    this.listeners.clear();
    this.onClose?.(id);
  }

  /** Called with every state update while open. */
  async render(s: AdventureState, w: World) {
    this.state = s;
    this.world = w;
    const o = s.objects[this.townId];
    if (!o?.town || o.owner < 0) return this.close();
    const key = `${o.subid}:${o.town.built.join(",")}:${o.owner}`;
    if (key !== this.builtKey) {
      this.builtKey = key;
      await this.picture.draw(o);
    }
    await this.desktop.draw(s, w, o);
    await this.drawTouch();
    for (const l of this.listeners) l();
  }

  private baseView() {
    if (!phoneSized()) return { k: 1, x: 0, y: 0 };
    const l = phoneLayout();
    return { k: l.k, x: l.picX, y: l.picY };
  }
  private resetView() {
    const v = this.baseView();
    this.body.scale.set(v.k);
    this.body.position.set(v.x, v.y);
    this.panel.visible = v.k === 1 && !phoneSized();
    this.back.visible = phoneSized();
    this.body.mask = phoneSized() ? this.picMask : null;
    // (No longer a mask, its white box would draw itself over the town, as after a phone's layout gives way to a
    // desktop's: emptied; the phone's layout draws it again.)
    if (!phoneSized()) this.picMask.clear();
  }

  /** Touch layout: big buttons for the town's main buildings left of the screen, towns and leave right. */
  touch = new Container();
  /** The one of `touch` on screen (a phone's town is drawn whole off screen, then swapped in). */
  touchShown = this.touch;
  private touchGen = 0;
  private touchKey = "";
  /** The touch buttons' draw under way (one at a time: drawTouch). */
  private touchDrawing: Promise<void> = Promise.resolve();
  /**
   * The touch buttons (phones: the whole frame), drawn again. One draw at a time: a draw fills `this.touch` (and the
   * backdrop, the picture's box) as it goes, so a second one started meanwhile (the phone turned while the town was
   * being drawn) took the first one's pieces too (2026-10-26: the sideways town's panels left on the upright
   * screen, no picture). The newest waits for the one drawing; the ones between are dropped.
   */
  async drawTouch() {
    const gen = ++this.touchGen;
    await this.touchDrawing;
    if (gen !== this.touchGen || this.root.destroyed) return;
    let done = () => {};
    this.touchDrawing = new Promise<void>((r) => (done = r));
    try {
      await this.drawTouchNow();
    } finally {
      done();
    }
  }

  /**
   * What the touch layouts show, as one key: they are drawn again only when it changes (the town, the heroes and
   * the picked one, the picked stack, the layout, the treasury, what is built, the resources; on phones the armies
   * and the creatures to recruit too).
   */
  private touchDrawKey(): string {
    const s = this.state;
    const o = s?.objects[this.townId];
    const room = screenSize.ox;
    // Redrawn when anything shown changes (on phones the armies and the creatures to recruit too).
    const shown = o?.town && s && this.world && phoneSized() ? JSON.stringify([upperArmy(s, o), garrisonHero(s, o)?.type, visitingHero(s, this.world, o)?.type, visitingHero(s, this.world, o)?.army, o.town.available]) : "";
    const pair = o && s && this.world ? `${garrisonHero(s, o)?.id}/${visitingHero(s, this.world, o)?.id}` : "";
    return `${pair}:${this.heroPick}:${JSON.stringify(this.army.selected)}:${extra("townFloating")}:${room}:${screenSize.css}:${screenSize.touch}:${phoneSized()}:${this.phone.treasuryOpen}:${this.townId}:${o?.town?.built.join(",")}:${o ? s?.players[o.owner]?.resources.join(",") : ""}:${shown}`;
  }

  private async drawTouchNow() {
    const s = this.state;
    const o = s?.objects[this.townId];
    const key = this.touchDrawKey();
    if (key === this.touchKey) return;
    this.touchKey = key;
    // Phones: the frame drawn whole off screen and swapped in at once (2026-10-26: "for a moment I saw the black
    // background version"), the old one shown meanwhile.
    if (s && o?.town && screenSize.touch && phoneSized()) return this.phone.drawWhole(o.owner);
    this.touch.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!s || !o?.town || !screenSize.touch) return;
    await this.side.draw(s, o);
  }

  ctx(): TownCtx {
    return {
      modals: this.modals,
      player: Math.max(0, this.state?.objects[this.townId]?.owner ?? 0),
      state: () => this.state!,
      world: () => this.world!,
      town: () => this.state!.objects[this.townId],
      send: this.send,
      listen: (fn) => {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
      },
      say: (t) => this.setStatus(said(t)),
      goTo: (id) => this.state && this.world && void this.show(this.state, this.world, id),
    };
  }

  setStatus(text: Text) {
    if (this.status) this.status.value = text;
    // (For the help-text probe.)
    if (import.meta.env.DEV) Object.assign(window, { __status: text });
  }

  /** Upgrade all: every stack of the garrison and the visiting hero this town can upgrade, when all can be paid together. */
  private upgradeAll(o: AdvObject): { can: () => boolean; run: () => void } {
    const list = () => {
      const s = this.state;
      const w = this.world;
      if (!s || !w) return [];
      const out: { who: "garrison" | "hero"; slot: number; cost: number[] }[] = [];
      for (const who of ["garrison", "hero"] as const)
        for (let slot = 0; slot < 7; slot++) {
          const up = townUpgrade(s, w, o, who, slot);
          if (up?.cost) out.push({ who, slot, cost: up.cost });
        }
      return out;
    };
    return {
      can: () => {
        const all = list();
        const total = all.reduce((t, u) => t.map((n, i) => n + (u.cost[i] ?? 0)), new Array(7).fill(0));
        return all.length > 0 && canPay(total, this.state?.players[o.owner]?.resources ?? []);
      },
      run: () => list().forEach((u) => this.send({ type: "upgradeInTown", town: o.id, who: u.who, slot: u.slot })),
    };
  }

  /** A stack's window: the creature card, and Upgrade with its price when this town (or the hero's specialty) allows. */
  private async stackWindow(o: AdvObject, ref: ArmyRef) {
    const s = this.state;
    const w = this.world;
    if (!s || !w) return;
    const hero = visitingHero(s, w, o);
    const stack = (ref.who === "garrison" ? upperArmy(s, o) : hero?.army)?.[ref.slot];
    const c = stack && w.creatures[stack.creature];
    if (!stack || !c) return;
    const player = Math.max(0, o.owner);
    const up = townUpgrade(s, w, o, ref.who, ref.slot);
    const to = up?.to;
    const cost = up?.cost ?? null;
    const res = s.players[o.owner]?.resources ?? [];
    const afford = !!cost && canPay(cost, res);
    const priceText = cost ? tr("Upgrade to %1: %2", w.creatures[to!]?.plural ?? "", cost.map((n, i) => (n ? resourceAmount(i, n) : "")).filter(Boolean).join(", ") || tr("free")) : NONE;
    const army = ref.who === "garrison" ? upperArmy(s, o) : (hero?.army ?? []);
    // A hero's last stack stays (the garrison's may all go).
    const owner = ref.who === "hero" ? hero : garrisonHero(s, o);
    const canDismiss = !owner || army.filter((a) => a).length > 1;
    await stackWindow(this.modals, player, c, {
      info: { count: stack.count, ...(owner ? stackInfo(owner, c, w.data, heroMoraleLuckParts(s, w, owner)) : {}) },
      upgrade: cost ? { text: priceText, cost, afford, apply: () => this.send({ type: "upgradeInTown", town: o.id, who: ref.who, slot: ref.slot }) } : undefined,
      dismiss: canDismiss ? () => this.send(owner ? { type: "dismissStack", hero: owner.id, slot: ref.slot } : { type: "dismissStack", town: o.id, slot: ref.slot }) : undefined,
    });
  }
}

/** The town's army places as the shared clicks number them: the garrison 0, the visiting hero 1. */
export function armyRef(r: StackRef): ArmyRef {
  return { who: r.who === 0 ? "garrison" : "hero", slot: r.slot };
}
