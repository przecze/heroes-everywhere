// The battle screen: the field, its stacks and the server's updates played in order. The parts hold the rest:
// input.ts (pointer, taps, the pad, the magnifier), aim.ts (what the pointer means: hover, shades, cursor, spell
// aiming), bar.ts (the bar and its buttons, the tactics bar), animate.ts (every event's animation), texts.ts (the
// console's lines in the game files' words), info.ts (popups and the stack panel), heroes.ts (the commanding heroes).
// New battle behaviour goes in its part, never back into this file.
import { BattleInput } from "./input.ts";
import { BattleAim } from "./aim.ts";
import { BattleBar } from "./bar.ts";
import { BattleAnimator } from "./animate.ts";
import { BattleTexts } from "./texts.ts";
import { BattleInfo } from "./info.ts";
import { BattleHeroes } from "./heroes.ts";
import { preloadResultVideos } from "./result.ts";
import { logPlay } from "../feedback/recent.ts";
import { extra, battleSpeed, onSettings, setAutoCombat, setSetting, settings } from "../settings.ts";
import { spellOfHotkey } from "../ui/spellHotkeys.ts";
import { BATTLEFIELDS, COMBAT_SPELLS, isPositive, SPELL, type SpellInfo, castable, affectsNoOne, HOTA_ARTIFACTS, mastery, spellCost, spellEstimate, obstacleType, hexRow, type BattleAction, type BattleEvent, type BattleState, type Unit, activeUnit, alive, effectOf, stats, unitAt, unitHexes, upcoming, controlSide, tacticsSpot, needsAim, creatureSpellAt, surrenderCost, HIT_AND_RUN, fleeBlock, actsByItself, skillLevel, WAR_MACHINES, seesHazard, autoAction } from "@heroes/core";
import { onLayout, relayout, phoneSized, screenSize } from "../ui/screen.ts";
import { AnimatedSprite, type Application, Container, Graphics, Rectangle, Sprite, Texture, TilingSprite } from "pixi.js";
import { GameText, WHITE, loadFonts } from "../text.ts";
import { packLines, resolveText, englishLine } from "../ui/gameText.ts";
import { gameTexts } from "../ui/highScores.ts";
import { Modals } from "../ui/modals.ts";
import { YES_NO, messageBox } from "../ui/dialogs.ts";
import { textButton } from "../ui/kit.ts";
import { undoWords } from "./undoWords.ts";
import { menuPicture, undoPicture } from "./touchLayout.ts";
import { battleLogWindow } from "./logWindow.ts";
import type { UndoMove } from "@heroes/server";
import { spellbookWindow } from "../ui/spellbook.ts";
import { BattleClock } from "./anim/clock.ts";
import * as pace from "./anim/pace.ts";
import { creaturePortrait, loadDef, loadImage, loadPng, opaqueBox } from "../assets.ts";
import { playMusicAfter, preloadSounds } from "../audio.ts";
import { actionOf } from "./intent.ts";
import { BAR_Y, CREATURE_ANCHOR, SCREEN_W, cellOrigin, hexAtPoint, hexCenter, CROP_X, CROP_W, cropForSiege, depthOf } from "./layout.ts";
import { SiegeView } from "./siegeView.ts";
import { attackTime, walkTime } from "./walkTimes.ts";
import { drawCreatureInfo } from "./creatureInfo.ts";
import { BattleFx } from "./fx.ts";
import { groupBlows } from "./blows.ts";
import { BattleTouch, type Blow, type TurnCard, uprightFieldTop } from "./touchLayout.ts";
import { queueCell } from "./queueCell.ts";
import { battleOptionsWindow } from "./options.ts";
import { fast, setQuick } from "../speed.ts";
import { loadData } from "../gameData.ts";
import { Anim, UnitSprite } from "./unitSprite.ts";
import { loadCursors } from "../cursors.ts";
import { has, lang, tr, said, fallback, fmt, NONE, type Text } from "../i18n/index.ts";
import { steadyTick, wake } from "../ui/frameRate.ts";
import { PLAYER_RGB as FLAG_RGB } from "../map/minimap.ts";

const BACKGROUNDS = ["cmbkgrmt.pcx", "cmbkgrtr.pcx", "cmbkdrmt.pcx", "cmbksnmt.pcx", "cmbkrgh.pcx", "cmbkbch.pcx"];

/** Real time after which an action still playing is played out at once (battle/anim/clock.ts fastForward). */
const STUCK_MS = 15000;

/** Draws a battle and turns pointer input into actions. Pure view: the server owns the state. */
/** Set once a player has been told about Undo (tellUndo). */
const UNDO_TOLD = "heroes.undoTold";

export class BattleView {
  readonly input = new BattleInput(this);
  readonly aim = new BattleAim(this);
  readonly bar = new BattleBar(this);
  readonly anim = new BattleAnimator(this);
  readonly texts = new BattleTexts(this);
  readonly info = new BattleInfo(this);
  readonly heroes = new BattleHeroes(this);

  readonly root = new Container();
  /**
   * The field itself (its picture, the hexes, the stacks, the heroes, what flies between them) apart from what lies
   * over it (the bar, the touch layout, the aim's ring): its own render group, so the magnifier draws only it, into its
   * picture, with what the GPU already holds (loupe.ts; it drew the whole screen again on every pad move, and hid the
   * touch layer meanwhile, which made the whole screen be sorted out again twice a move).
   */
  readonly field = new Container({ isRenderGroup: true });
  private readonly bg = new Sprite();
  private readonly grid = new Container();
  /** CCELLSHD: the original's hex shadow (its palette's shadow colour, black at half strength). */
  cellShadow: Texture | null = null;
  /** CCELLGRD: one hex of the grid. */
  cellGrid: Texture | null = null;
  readonly shade = new Container();
  readonly hover = new Container();
  /**
   * The battle's one clock (anim/clock.ts): every wait and tween at the speed set, from the time passed;
   * it hurries in fast mode and quick combat.
   */
  readonly clock = new BattleClock(() => battleSpeed(), () => fast, () => wake());
  private readonly obstaclesBack = new Container();
  /** The field's own obstacles, in obstaclesBack with the siege's walls (redrawn when Remove Obstacle takes one). */
  private readonly fieldObstacles = new Container();
  private obstaclesDrawn = "";
  /** Quicksand, mines, force fields and fire walls. */
  private readonly hazardsLayer = new Container();
  /** The spells on the field last drawn (kind and hexes); null before the first draw of a battle. */
  private hazardsShown: Set<string> | null = null;
  private readonly corpses = new Container();
  readonly unitsLayer = new Container();
  /** The stacks' count boxes, above every creature (never covered, as in the original). */
  private readonly counts = new Container();
  /** A gold arrow over the stack waiting for orders (touch screens: the outline alone didn't say whose turn it is). */
  readonly turnArrow = new Graphics().poly([-11, 0, 11, 0, 0, 15]).fill(0xffd34a).stroke({ color: 0x000000, width: 2 });
  arrowOf: number | null = null;
  readonly siege = new SiegeView(this.obstaclesBack, this.unitsLayer, this.clock);
  /** The tower archers' creature (DEF and missile) in a siege. */
  towerArt: { def: string; missile: string } | null = null;
  readonly queueLayer = new Container();
  /** The turn queue's portraits (battle coordinates), so pointing at one picks out its stack. */
  queueSlots: { x: number; y: number; w: number; h: number; unit: number }[] = [];
  /** A stack pointed at in the touch layout's queue (pressed, or under the mouse). */
  queuePointed: number | null = null;
  /** The stack the queue points at, marked whatever the mouse-shadow option says. */
  readonly queueMark = new Container();
  readonly barLayer = new Container();
  /** Shows the 800x600 screen and the touch layout only: sprites past the field's edges stay hidden on a wide canvas. */
  readonly clip = new Graphics();
  /** Touch layout: the bar's buttons again, big, and the message, beside the battlefield. */
  readonly touch: BattleTouch;
  private stopLayout: () => void = () => {};
  /** The log line (narrower than SoD's: HotA's bar gives a button's width of it to the alternate action). */
  readonly consoleText = new GameText("smalfont", WHITE, "center", 349);
  readonly sprites = new Map<number, UnitSprite>();
  state: BattleState | null = null;

  /** The state currently shown (read-only use: debugging, telemetry). */
  get shownState(): BattleState | null {
    return this.state;
  }
  animating = false;
  pending: { state: BattleState; events: BattleEvent[] }[] = [];
  pointer = { x: -1, y: -1 };
  hint = "";
  /** The stack the pointer is over (it stirred as the pointer came). */
  stirred: number | undefined;
  /** Bumped on reset so in-flight animations of an old battle stop touching the scene. */
  generation = 0;

  readonly app: Application;
  readonly fx: BattleFx;
  readonly sendAction: (a: BattleAction) => void;
  readonly modals: Modals;

  /** Resolves once init() has the bar and its buttons. */
  private initDone: () => void = () => {};
  readonly initialised = new Promise<void>((r) => (this.initDone = r));
  /** Resolves when the battle is first on screen, whole (until then the screen it opens from stays). */
  private onShown: () => void = () => {};
  readonly shown = new Promise<void>((r) => (this.onShown = r));

  constructor(app: Application, sendAction: (a: BattleAction) => void) {
    // Nothing of it shows until it's all there: the field, the heroes, every stack and the bar.
    this.root.visible = false;
    // The page's own buttons move aside while a battle is up (style.css: Feedback off the enemy hero).
    document.body.classList.add("inBattle");
    this.app = app;
    this.fx = new BattleFx({ clock: this.clock, layer: this.queueLayer, stacks: this.unitsLayer });
    // An order sent: none other for that turn until the answer comes (2026-11-01 21:36: a lift on the pad
    // shot, and a second touch in the same moment sent a move for the same stack: "not this unit's turn").
    this.sendAction = (a) => {
      if (!a.type.startsWith("tactic")) this.sentAt = { key: this.turnKey(), at: performance.now() };
      sendAction(a);
    };
    this.modals = new Modals(app);
    // The page's corner buttons keep off the field (style.css: one-handed on the right they'd cover the queue).
    document.body.classList.add("inBattle");
    this.touch = new BattleTouch(this.clip, this.modals);
    this.touch.setPad(this.input.padHandlers());
    this.touch.onQueuePoint = (unit) => {
      this.queuePointed = unit;
      this.aim.refreshHover();
    };
    this.touch.onStackTap = (unit) => this.input.stackTapped(unit);
    this.modals.changed.add(() => (this.bar.ownButtons(), this.bar.layoutSides()));
    if (import.meta.env.DEV) (window as unknown as { __battle: BattleView }).__battle = this;
    // The heroes over the grid and the shades, under the stacks (VCMI's BattleRenderer: they stand on the field with
    // the stacks, not on its picture; the grid ran over a hero on horseback, the owner 2026-10-26).
    this.field.addChild(this.bg, this.obstaclesBack, this.hazardsLayer, this.grid, this.shade, this.aim.spellShade, this.hover, this.queueMark, this.heroes.layer, this.corpses, this.unitsLayer, this.counts, this.turnArrow, this.queueLayer);
    this.root.addChild(this.field, this.barLayer, this.touch.layer, this.info.stackPanel, this.clip);
    this.root.mask = this.clip;
    this.root.eventMode = "static";
    // The whole screen: a smaller hit area would also cut off the bar's buttons (and, in the
    // touch layout, the big buttons beside the battlefield).
    // The whole canvas, in the battle's coordinates (upright it starts higher and is drawn bigger).
    this.root.hitArea = {
      contains: (x: number, y: number) => {
        const k = this.root.scale.x;
        const gx = this.root.x + x * k;
        const gy = this.root.y + y * k;
        return gx >= 0 && gy >= 0 && gx < screenSize.w && gy < screenSize.h;
      },
    };
    // Upright: the field right under the page's buttons, its buttons and the message under it (in
    // the middle it left a third of the screen black above), and drawn bigger: the heroes at the
    // sides are cut off so the hexes (x 58-741) fill the width. The touch layer keeps screen pixels.
    onLayout(() => {
      if (this.root.destroyed) return;
      const up = screenSize.portrait;
      const k = up ? SCREEN_W / CROP_W : this.touch.fieldScale();
      this.root.scale.set(k);
      // A narrow sideways phone: the field right of a wider left-hand column, smaller to clear the
      // navigation bar; one-handed, under the page's buttons (touchLayout.ts fieldScale).
      const top = up ? 0 : this.touch.fieldTop();
      this.root.position.set(up ? -CROP_X * k : this.touch.fieldX(), up ? uprightFieldTop() : screenSize.oy + top);
      // Upright the page's own buttons are in the battle's row and Menu (touchLayout.ts layoutUpright).
      this.bar.ownButtons();
      this.touch.layer.scale.set(1 / k);
      // (Its own layout stays from the canvas's top.)
      this.touch.layer.position.set(up ? CROP_X : 0, -top / k);
      this.touch.fieldK = k;
      this.placeGround();
    });
    // The touchpad tutorial's demo: the field as it stands, without the touch layer, cropped as on the screen.
    this.touch.fieldShot = () => {
      if (this.root.destroyed) return null;
      const up = screenSize.portrait;
      const a = this.root.toGlobal({ x: up ? CROP_X : 0, y: 0 });
      const b = this.root.toGlobal({ x: up ? CROP_X + CROP_W : SCREEN_W, y: BAR_Y });
      const shown = this.touch.layer.visible;
      this.touch.layer.visible = false;
      try {
        const frame = new Rectangle(Math.round(a.x), Math.round(a.y), Math.round(b.x - a.x), Math.round(b.y - a.y));
        return this.app.renderer.generateTexture({ target: this.app.stage, frame, resolution: 1 });
      } catch {
        return null;
      } finally {
        this.touch.layer.visible = shown;
      }
    };
    this.stopLayout = onLayout(() => this.bar.layoutSides());
    this.input.attachPointer();
    void resolveText({ file: "genrltxt", id: 731 }).then((t) => t && (this.texts.cancelledText = t));
    // The grid and the shadows follow the settings (the combat options, the Options panel).
    const stopSettings = onSettings(() => {
      if (this.grid.destroyed) return;
      this.grid.visible = settings().battleGrid;
      this.hover.visible = settings().battleMouseShadow;
      this.aim.refreshShade();
    });
    this.root.on("destroyed", stopSettings);
    // HotA's Alt switches the alternate action (as the bar's button does); Shift flips it while held.
    window.addEventListener("keydown", this.aim.trackShift);
    window.addEventListener("keyup", this.aim.trackShift);
    steadyTick(app, this.tickSprites);
  }

  /** The battle's tick: the clock, the creatures (standing ones at their own calm pace), the heroes, the turn arrow. */
  private readonly tickSprites = (t: { deltaMS: number }) => {
    this.clock.advance(t.deltaMS);
    const speed = this.clock.hurrying ? 1 : battleSpeed();
    for (const s of this.sprites.values()) if (!s.destroyed) s.tick(t.deltaMS, speed);
    for (const h of this.heroes.heroTicks) h(t.deltaMS);
    this.placeTurnArrow(t.deltaMS);
  };

  private arrowClock = 0;
  /** The turn arrow bobs over the head of the stack waiting for orders (while it stands still: not mid-move). */
  private placeTurnArrow(deltaMS: number) {
    const arrow = this.turnArrow;
    const sp = this.arrowOf === null ? undefined : this.sprites.get(this.arrowOf);
    if (!sp || sp.destroyed || this.animating || this.casting) return void (arrow.visible = false);
    this.arrowClock += deltaMS;
    // Over the art's top (its bounds in the sprite's own frame), kept inside the field.
    // (Where a frame keeps a clear margin, its drawn part: HotA's creatures from the mod.)
    const box = opaqueBox(sp.body.texture);
    const bounds = sp.body.getBounds();
    const at = box
      ? this.root.toLocal(sp.body.toGlobal({ x: box.x + box.width / 2, y: box.y }))
      : this.root.toLocal({ x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY });
    const x = Math.round(at.x);
    arrow.visible = true;
    arrow.position.set(x, Math.max(24, Math.min(BAR_Y - 40, at.y - 18)) + Math.sin(this.arrowClock / 160) * 4);
  }

  /** Tears the view down, including its ticker listener (a dead view must not keep ticking). */
  destroy() {
    setAutoCombat(false);
    setQuick(false);
    this.stopLayout();
    this.modals.dispose();
    this.generation++;
    this.clock.stop();
    this.heroes.heroTicks = [];
    this.app.ticker.remove(this.tickSprites);
    window.removeEventListener("keydown", this.aim.trackShift);
    window.removeEventListener("keyup", this.aim.trackShift);
    this.app.canvas.style.cursor = "";
    document.body.classList.remove("inBattle", "ownButtons");
    this.input.loupe?.destroy();
    this.ground.destroy();
    this.root.destroy({ children: true });
    cropForSiege(false);
    // The page's buttons are back in their places: the screens under the battle keep clear of them again.
    relayout();
  }

  async init(seed: number) {
    await Promise.all([
      loadFonts(),
      loadCursors(),
      gameTexts().then((t) => (this.texts.gen = t.general)),
      // (The packs' GENRLTXT for the hover and log lines: "Move %s here." in the player's language, not around a translated name.)
      has(lang(), "gameTexts") ? packLines("genrltxt").then((t) => void this.texts.packs.set(lang(), t ?? {})) : undefined,
      loadData().then((d) => (this.texts.artifactNames = d.artifacts.map((a) => a.name))).catch(() => undefined),
    ]);
    const [bar, cell, shadow] = await Promise.all([loadImage("cbar.pcx"), loadImage("ccellgrd.pcx", true), loadImage("ccellshd.pcx", true).catch(() => null)]);
    this.cellShadow = shadow;
    this.cellGrid = cell;
    if (this.root.destroyed) return this.initDone();
    // The battle's opening jingle (one of eight), then one of the four combat tunes, picked by the battle (the original picks them at random).
    // Nothing moves until the jingle is over, as in the original (VCMI's openingPlaying); at most a few seconds.
    this.opening = Promise.race([playMusicAfter(`BATTLE0${(seed >>> 3) % 8}`, `COMBAT0${((seed >>> 0) % 4) + 1}.MP3`), new Promise((r) => setTimeout(r, 4000))]);
    this.grid.removeChildren();
    for (let h = 0; h < 187; h++) {
      const col = h % 17;
      if (col === 0 || col === 16) continue;
      const g = new Sprite(cell);
      const o = cellOrigin(h);
      g.position.set(o.x, o.y);
      g.alpha = 0.5;
      g.label = `hex ${h}`;
      this.grid.addChild(g);
    }
    this.grid.visible = settings().battleGrid;
    this.hover.visible = settings().battleMouseShadow;
    await this.bar.buildBar(bar);
    this.initDone();
  }

  /**
   * Touch layouts: the windows' leather (DIBOXBCK) over the whole screen behind the field, so the rooms round it
   * (the buttons, the pad, the page's own buttons) stand on the game's ground, never on black (2026-10-26).
   * Under the battle's root, at the stage (the root's mask keeps its own pieces to the field and the rooms).
   */
  readonly ground = new TilingSprite({ texture: Texture.EMPTY, width: 1, height: 1 });
  placeGround() {
    const parent = this.root.parent;
    const g = this.ground;
    if (!parent || this.root.destroyed) return;
    if (g.parent !== parent) parent.addChildAt(g, parent.getChildIndex(this.root));
    else if (parent.getChildIndex(g) > parent.getChildIndex(this.root)) parent.setChildIndex(g, parent.getChildIndex(this.root));
    g.label = "battle ground";
    g.visible = screenSize.touch && g.texture !== Texture.EMPTY;
    g.width = screenSize.w;
    g.height = screenSize.h;
  }

  onAuto: (() => void) | null = null;

  /**
   * Auto combat: the AI plays our stacks from this screen, one action at a time, until the battle
   * ends or the player takes over again (the button or A again, or a tap / click on the field).
   */
  auto = false;
  /** The state an auto action was last sent for (one each, however often the view refreshes). */
  private autoSent = "";
  toggleAuto() {
    const s = this.state;
    if (!s || s.winner !== null || (!this.auto && !s.sides.some((_, i) => this.mine(i)))) return;
    this.auto = !this.auto;
    this.touch.setAuto(this.auto);
    setAutoCombat(this.auto);
    this.input.armed = null;
    this.input.peek = false;
    if (this.casting) this.cancelCasting();
    this.setHint(this.texts.idleHint());
    this.autoPlay();
  }
  private autoPlay() {
    const s = this.state;
    if (!this.auto || !s || this.animating || this.modals.open || this.bookOpen) return;
    if (s.winner !== null) return void ((this.auto = false), this.touch.setAuto(false));
    const key = `${s.round}:${s.active}:${s.log.length}:${s.tactics ? 1 : 0}`;
    if (key === this.autoSent) return;
    if (this.myTactics()) return void ((this.autoSent = key), this.endTactics());
    const u = this.myActive();
    if (!u) return;
    // What the combat options' Auto-Combat Options leave unchecked is the player's to play.
    if (this.leftToPlayer(u)) return void this.setHint(this.texts.idleHint());
    const a = autoAction(s, { spells: settings().autoSpells });
    if (!a) return;
    this.autoSent = key;
    this.sendAction(a);
  }

  /**
   * Auto combat leaves this stack to the player: its kind is unchecked in the combat options'
   * Auto-Combat Options (Creatures, Catapult, Ballista, First Aid Tent; Spells are autoAction's).
   */
  leftToPlayer(u: Unit): boolean {
    if (!this.auto) return false;
    const o = settings();
    const m = u.machine;
    return m === "catapult" ? !o.autoCatapult : m === "ballista" || m === "cannon" ? !o.autoBallista : m === "tent" ? !o.autoFirstAid : m ? false : !o.autoCreatures;
  }

  /** Fight the battle as quick combat as soon as it shows (System Options' Quick Combat). */
  quickStart = false;
  /** Quick combat (HD mod style): the AI plays our side and the rest of the battle runs without animations or sounds. */
  quickCombat() {
    if (!this.onAuto || !this.state || this.state.winner !== null) return;
    // (The server plays it through now: nothing left to send from here.)
    this.auto = false;
    this.touch.setAuto(false);
    setQuick(true);
    this.foughtQuick = true;
    this.onAuto();
  }
  /** The player's gold (to tell whether a surrender is affordable); unknown in quick battles. */
  goldOf: ((player: number) => number | undefined) | null = null;
  /** The player dismissed the results window. */
  onResultClosed: (() => void) | null = null;
  /** HotA's Restart in a quick combat's results window (single player): the battle again, by hand. */
  onRestart: (() => void) | null = null;
  /** This battle went to quick combat. */
  foughtQuick = false;
  /** Called once the view has caught up with a server update (after its animations). */
  onApplied: ((s: BattleState) => void) | null = null;

  act(type: "wait" | "defend") {
    const u = this.myActive();
    // (Nor while the troops are arranged: the buttons are greyed then.)
    if (!u || this.state?.tactics || (type === "wait" && u.waited)) return;
    this.sendAction({ type, unit: u.id });
  }

  /** Resolves when the battle's opening jingle is over. */
  private opening: Promise<unknown> = Promise.resolve();

  /** Called with every server update; animations are queued so nothing is skipped. */
  /** The turn an order was last sent in, and when: no second order for it (a refused one is let go after a moment). */
  private sentAt: { key: string; at: number } | null = null;
  private turnKey(): string {
    const s = this.state;
    return s ? `${s.round}:${s.active}:${s.log.length}` : "";
  }

  /**
   * `undo`: the server has a decision to take back (EXTRAS battleUndo); `rewound`: the battle went back to before
   * one (an undo), drawn afresh from the state, as a battle opening (stacks back to life, walls standing again...).
   */
  update(state: BattleState, events: BattleEvent[], o: { undo?: UndoMove; rewound?: boolean } = {}) {
    this.undoMove = o.undo ?? null;
    if (o.rewound && this.state) {
      this.reset();
      this.undone = true;
    }
    this.sentAt = null;
    // Auto combat on our side: the animations may run faster (settings' fastAuto).
    setAutoCombat(state.winner === null && (this.auto || state.sides.some((x) => !!x.auto && (this.viewer === undefined || x.owner === this.viewer))));
    this.pending.push({ state, events });
    if (!this.animating) void this.drain();
  }

  /** Background and obstacles come from the battle state. */
  private async setupField(s: BattleState) {
    // Fetch every creature sound up front so blows aren't silent while they load.
    // (Only what each has: no sound prefix, no sounds; a shot only for shooters; the war machines
    // never step, strike or defend, and the game has only their wince, death and shot.)
    const machines = new Set(Object.values(WAR_MACHINES).map((m) => m.creature));
    preloadSounds(
      Object.entries(s.creatures).flatMap(([id, c]) =>
        c.sound ? [...(machines.has(+id) ? ["WNCE", "KILL"] : ["ATTK", "MOVE", "WNCE", "KILL", "DFND"]), ...(c.shots > 0 ? ["SHOT"] : [])].map((k) => c.sound + k) : [],
      ),
    );
    // A stack's popup (held finger, right button) loads its frame, morale / luck pictures and each
    // side's backdrop the first time: drawn once off screen a little later, so the first hold shows at once
    // (on a phone it took seconds, the finger already lifted).
    setTimeout(() => {
      if (this.root.destroyed || !this.state) return;
      const st = this.state;
      for (const side of [0, 1])
        for (const u of st.units.filter((x) => x.side === side && x.count > 0 && x.pos >= 0).slice(0, 2)) {
          const box = new Container();
          void drawCreatureInfo(box, st, u).catch(() => {}).finally(() => box.destroy({ children: true }));
        }
    }, 1500);
    const field = BATTLEFIELDS.find((f) => f.id === s.field);
    // HotA's own fields and big obstacles (highlands, wasteland) are PNGs in the mod.
    // The mod's PNG obstacles keep the original's cyan for see-through, as its BMPs do.
    const picture = (name: string, key = false) => (name.endsWith(".png") ? loadPng(name, key) : loadImage(name));
    this.bg.texture = (await this.siege.background(s)) ?? (await picture(field?.background ?? BACKGROUNDS[s.id % BACKGROUNDS.length]).catch(() => loadImage(BACKGROUNDS[s.id % BACKGROUNDS.length])));
    this.siege.clear();
    this.obstaclesBack.removeChildren();
    await this.heroes.setupHeroes(s);
    if (s.siege) {
      const shooter = (await loadData()).creatures.find((c) => c.key === this.siege.shooter(s));
      this.towerArt = shooter ? { def: shooter.def, missile: shooter.missile } : null;
      await this.siege.sync(s);
    }
    this.obstaclesBack.addChild(this.fieldObstacles);
    await this.drawObstacles(s);
  }

  /** The field's obstacles (big cliffs, rocks, trees...), and no grid where they stand. */
  private async drawObstacles(s: BattleState) {
    this.obstaclesDrawn = JSON.stringify(s.obstacles ?? []);
    const picture = (name: string, key = false) => (name.endsWith(".png") ? loadPng(name, key) : loadImage(name));
    const back: Sprite[] = [];
    const front: Sprite[] = [];
    // (A foreground obstacle stands in its row, as VCMI's BattleRenderer draws it: over the creatures of its own row
    // and those behind, under the ones in front, not over every creature: the owner 2026-10-27, bones over a Wight below.)
    const rowOf = new Map<Sprite, number>();
    for (const p of s.obstacles ?? []) {
      const o = obstacleType(p.type);
      if (!o) continue;
      try {
        if (o.absolute) {
          // Big cliffs: one image placed at fixed screen coordinates (stored in width/height).
          const img = new Sprite(await picture(o.art, true));
          img.position.set(o.width, o.height);
          back.push(img);
          continue;
        }
        const frames = (await loadDef(o.art)).get(0) ?? [];
        const f = frames[0];
        if (!f) continue;
        const cell = cellOrigin(p.pos);
        let offset = f.fullHeight % 42;
        if (o.blocked[0] < 0 || offset > 37) offset -= 42;
        const [x, y] = [cell.x, cell.y + 42 - f.fullHeight + offset];
        // Animated as the original (fiery fields, clover, pools...): 20 frames a second (VCMI's getObstaclesSpeed).
        const img = new AnimatedSprite(frames.map((fr) => fr.texture));
        const place = (i: number) => img.position.set(x + frames[i].x, y + frames[i].y);
        place(0);
        if (frames.length > 1) {
          img.onFrameChange = place;
          img.animationSpeed = pace.OBSTACLE_FPS / 60;
          img.play();
        }
        (o.foreground ? front : back).push(img);
        rowOf.set(img, hexRow(p.pos));
      } catch {
        // Missing obstacle art shouldn't stop the battle.
      }
    }
    if (this.root.destroyed) return;
    this.fieldObstacles.removeChildren().forEach((c) => c.destroy());
    for (const c of this.unitsLayer.children.filter((c) => c.label === "obstacle: foreground")) c.destroy();
    if (back.length) this.fieldObstacles.addChild(...back);
    for (const img of front) {
      // (After its row's stacks, whose depth is row * 100 + column: depthOf.)
      Object.assign(img, { label: "obstacle: foreground", zIndex: (rowOf.get(img) ?? 10) * 100 + 99 });
      this.unitsLayer.addChild(img);
    }
    this.unitsLayer.sortableChildren = true;
    // As the original: no grid over the obstacles, so it shows where nothing can stand.
    for (const g of this.grid.children) g.visible = !s.blocked.includes(Number(g.label.slice(4)));
  }

  private async drain() {
    const gen = this.generation;
    this.animating = true;
    this.aim.clearHover();
    this.input.dropAiming();
    // Nobody of ours is up while things play out: no movement range or outline left from the last one.
    this.aim.refreshShade();
    while (this.pending.length) {
      const { state, events } = this.pending.shift()!;
      if (this.state && this.sprites.size) {
        // One blow's extra targets (breath, heads, area shots) react with its main target.
        for (const { ev, splash } of groupBlows(events)) {
          // (The screen closed meanwhile, a watched ally's battle say: what was playing stops quietly.)
          const played = this.anim.animate(ev, state, splash).then(
            () => "ok" as const,
            (err) => (gen !== this.generation ? ("ok" as const) : Promise.reject(err)),
          );
          // An action that takes far too long (a long walk at the slow speed is 12 s) is played out at once to
          // its end, never left running under the next one: two actions over each other looked like stacks
          // moving twice. One that still doesn't end (a promise nothing will settle) is left behind.
          let timer = 0;
          const late = new Promise<"late">((r) => (timer = window.setTimeout(() => r("late"), STUCK_MS / Math.min(1, battleSpeed()))));
          if ((await Promise.race([played, late])) === "late") {
            console.warn("battle animation too long, played out at once:", JSON.stringify(ev));
            const ended = await Promise.race([this.clock.fastForward(played), new Promise<"stuck">((r) => setTimeout(() => r("stuck"), 1000))]);
            if (ended === "stuck") console.warn("battle animation stuck, skipped:", JSON.stringify(ev));
          }
          clearTimeout(timer);
          if (gen !== this.generation) return;
        }
        // The action is over: every standing stack turns back to face the enemy (VCMI's endAction).
        this.anim.faceHome();
      }
      const fresh = !this.state;
      this.state = structuredClone(state);
      if (fresh && cropForSiege(!!state.siege)) relayout();
      // A new battle appears whole: field, heroes and every stack ready before it's shown.
      if (fresh) this.root.visible = false;
      if (fresh) preloadResultVideos();
      // A town's defenders get their own films (held, lost).
      if (fresh && state.siege && this.mine(1)) preloadResultVideos(["defendall", "defendloop", "losecstl", "losecslp"]);
      if (fresh) await this.setupField(this.state);
      else if (JSON.stringify(this.state.obstacles ?? []) !== this.obstaclesDrawn) await this.drawObstacles(this.state);
      await this.syncSprites();
      if (fresh) {
        // (Its bar too; never held for good by a picture that won't load.)
        await Promise.race([this.initialised, new Promise((r) => setTimeout(r, 5000))]);
        this.root.visible = true;
        this.onShown();
      }
      // The opening jingle plays out before the first move (not in a quick combat).
      if (fresh && !this.quickStart) await this.opening;
      if (gen !== this.generation) return;
      // System Options' Quick Combat: the computer fights it from the first state on.
      if (fresh && this.quickStart) (this.quickStart = false), this.quickCombat();
      await this.drawHazards(this.state);
      if (gen !== this.generation) return;
      await this.refreshQueue();
      this.onApplied?.(this.state);
    }
    this.animating = false;
    this.refreshQueue();
    if (this.undone && this.state) (this.undone = false), this.setHint(tr("The last move is undone"));
    // The first battle with Undo there: a word about it, once (2026-11-02: players coming back wouldn't know).
    if (this.awaitingMe && this.undoOffered()) void this.tellUndo();
    // A finger's look at a stack lasts until the battle moves on: then whose turn it is again.
    if (this.input.peek) (this.input.peek = false), (this.pointer = { x: -1, y: -1 });
    this.aim.refreshShade();
    this.aim.refreshHover();
    this.autoPlay();
  }

  reset() {
    setQuick(false);
    this.auto = false;
    this.touch.setAuto(false);
    this.generation++;
    this.clock.stop();
    this.hazardsShown = null;
    this.animating = false;
    this.state = null;
    this.pending = [];
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.corpses.removeChildren();
    this.unitsLayer.removeChildren();
    // (The foreground obstacles stood in it: drawn again with the next battle's field.)
    this.obstaclesDrawn = "";
    this.queueLayer.removeChildren();
    this.queueMark.removeChildren();
    this.queueSlots = [];
    this.queuePointed = null;
    this.heroes.heroEnd[0] = this.heroes.heroEnd[1] = null;
  }

  /** Player colour watching this battle; on map battles only that colour's side takes input. */
  viewer: number | undefined = undefined;

  /** Is this side played from this screen? */
  mine(side: number): boolean {
    const x = this.state?.sides[side];
    return !!x && x.controller === "human" && (this.viewer === undefined || x.owner === undefined || x.owner === this.viewer);
  }

  /** While the results window is up: who won (for scripted players). */
  result: string | null = null;
  /** The result window closed: the battle is over here (what follows is the map's). */
  ended = false;

  /** Waiting for this screen's player (a unit to command or tactics to place). */
  get awaitingMe(): boolean {
    return !!this.myActive() || this.myTactics();
  }

  myActive(): Unit | undefined {
    if (!this.state || this.animating) return undefined;
    if (this.sentAt && this.sentAt.key === this.turnKey() && performance.now() - this.sentAt.at < 3000) return undefined;
    const u = activeUnit(this.state);
    // (Not a war machine its hero can't aim, nor a berserk stack: those act by themselves.)
    return u && this.mine(controlSide(u)) && !actsByItself(this.state, u) ? u : undefined;
  }

  // ---- sprites -----------------------------------------------------------

  /** Where a unit's container goes: the hex centre its art is anchored to. */
  anchorFor(u: Unit, head = u.pos, turned = false): { x: number; y: number } {
    if (!this.state) return { x: 0, y: 0 };
    // Tower archers face left from a fixed spot: their canvas sits at the configured point.
    const turret = this.siege.turretCanvas(u);
    if (turret) {
      const w = this.sprites.get(u.id)?.canvasWidth ?? 450;
      return { x: turret.x + w - CREATURE_ANCHOR.x, y: turret.y + CREATURE_ANCHOR.y };
    }
    const hexes = unitHexes(this.state, u, head);
    // Wide creatures are drawn from their rear hex, which swaps when they turn around.
    return hexCenter(turned ? hexes[0] : hexes[hexes.length - 1]);
  }

  async syncSprites() {
    const s = this.state!;
    const defOf = (u: Unit) => (u.machine === "tower" && this.towerArt ? this.towerArt.def : stats(s, u).def);
    // All the art at once (not one stack after another).
    const [countBg] = await Promise.all([loadImage("cmnumwin.pcx"), ...s.units.filter((u) => !this.sprites.has(u.id)).map((u) => loadDef(defOf(u)).catch(() => null))]);
    for (const u of s.units) {
      if (this.state !== s) return; // reset while loading art
      let sp = this.sprites.get(u.id);
      if (!sp) {
        const frames = await loadDef(defOf(u));
        if (this.state !== s) return;
        sp = new UnitSprite(frames, u.side === 1, new Sprite(countBg));
        sp.label = `stack: ${u.id} ${s.creatures[u.creature]?.name ?? u.creature} (${u.side ? "right" : "left"})`;
        sp.clock = this.clock;
        this.sprites.set(u.id, sp);
        // Its own paces (CRANIM.TXT, the HotA mod): the legs and the walk, the shots and casts.
        const made = sp;
        const key = stats(s, u).key;
        void Promise.all([walkTime(u.creature, key), attackTime(u.creature, key)]).then(([w, a]) => {
          made.walkTime = Math.min(2, Math.max(0.5, w));
          made.attackTime = Math.min(3, Math.max(0.3, a));
        });
        this.unitsLayer.addChild(sp);
        this.counts.addChild(sp.countBox);
        if (!alive(u)) sp.holdLast(Anim.Death);
      }
      // (A stack turned to face a blow stays where it stands until it turns home: faceHome.)
      const p = this.anchorFor(u, u.pos, !u.machine && sp.facingLeft !== (u.side === 1));
      sp.position.set(p.x, p.y);
      sp.setCount(u.count);
      if (u.machine) sp.countBox.visible = false;
      // Sacrificed: gone without a corpse.
      if (u.sacrificed) {
        sp.visible = false;
        continue;
      }
      if (u.machine === "tower") {
        // Archers on the towers: gone with their tower.
        sp.visible = alive(u);
        sp.zIndex = this.siege.turretZ(u);
        continue;
      }
      this.placeCount(s, u, sp);
      sp.zIndex = depthOf(u.pos);
      if (!alive(u) && sp.parent !== this.corpses) {
        this.corpses.addChild(sp);
      } else if (alive(u) && sp.parent === this.corpses) {
        // Back from the dead (rebirth, resurrection).
        this.unitsLayer.addChild(sp);
        void sp.play(Anim.Stand, true);
      }
    }
    this.unitsLayer.sortableChildren = true;
    this.unitsLayer.sortChildren();
  }

  /**
   * The count box as VCMI's BattleStacksController places it: in the hex in front of the stack
   * when that one is free (else inside its own hex), coloured for the spells on it.
   */
  placeCount(s: BattleState, u: Unit, sp: UnitSprite) {
    const box = sp.countBox;
    box.visible = alive(u) && u.count > 0 && !u.sacrificed && (!u.machine || u.count > 1) && sp.visible;
    if (!box.visible) return;
    const right = u.side === 0;
    const front = u.pos + (right ? 1 : -1);
    const col = front % 17;
    const sameRow = Math.floor(front / 17) === Math.floor(u.pos / 17);
    const free = sameRow && front >= 0 && front < 187 && (col === 0 || col === 16 || (!s.blocked.includes(front) && !unitAt(s, front)));
    // VCMI's offsets from the stack's canvas (x 220 / 202, less or more the box's width + 10 when
    // inside; y 260, the defender's outside box 15 higher), here from its hex centre (196, 251).
    const c = hexCenter(u.pos);
    if (!free) box.position.set(c.x + (right ? -16 : -12), c.y + 9);
    else if (right) box.position.set(c.x + 24, c.y + 9);
    else box.position.set(c.x - 52, c.y - 6);
    // On a phone the tiny font is a few pixels high: half as big again, grown from the box's middle.
    // At least 12 CSS pixels a line (the tiny font is 11 high) on a small phone, up to twice as big.
    const k = screenSize.touch ? Math.min(2, Math.max(1.5, 12 / (11 * screenSize.css * this.root.scale.x))) : 1;
    if (box.scale.x !== k) box.scale.set(k);
    if (k !== 1) box.position.set(box.x - (box.width / k) * (k - 1) / 2, box.y - (box.height / k) * (k - 1) / 2);
    let mood = 0;
    let any = false;
    for (const e of u.effects ?? []) {
      any = true;
      if (isPositive(e.spell)) mood++;
      else if (COMBAT_SPELLS[e.spell]?.who === "enemy" || e.spell >= 70) mood--;
    }
    // The inside always says the spells (the original's purple, green, red, yellow: players read it so); whose stack
    // the original tells by the side the box stands on. An extra (the owner) rims it in its player's flag colour as well,
    // for a crowd of boxes; neutral (monsters) grey.
    sp.setMood(!any ? "none" : mood > 0 ? "positive" : mood < 0 ? "negative" : "mixed");
    sp.setRim(extra("sideCounts") ? this.flagOf(s, u.side) : undefined);
    sp.setLook(alive(u) && effectOf(u, SPELL.STONE_GAZE) ? "stone" : u.clone ? "clone" : "normal");
  }

  /** A side's flag colour: its player's; monsters grey; a quick battle's (no players) red for the attacker, blue for the defender. */
  flagOf(s: BattleState, side: number): number {
    const owner = s.sides[side]?.owner;
    if (owner !== undefined && owner >= 0) return FLAG_RGB[owner % 8];
    return s.sides.some((x) => x.owner !== undefined && x.owner >= 0) ? 0x9c9c9c : FLAG_RGB[side];
  }

  /**
   * Spells on the field, animated; the enemy's quicksand and mines stay hidden until stepped on. A
   * new one first plays its appearing DEF (the one before its loop: C07SPF60, C09SPF0, C17SPE0,
   * C15SPE0...), as VCMI's obstacle "appearAnimation"; every frame sits at its own offset on the DEF's canvas.
   */
  private async drawHazards(s: BattleState) {
    this.hazardsLayer.removeChildren().forEach((c) => c.destroy());
    const mySide = [0, 1].find((side) => this.mine(side));
    const before = this.hazardsShown;
    const shown = new Set<string>();
    this.hazardsShown = shown;
    for (const z of s.hazards ?? []) {
      // (Hidden from the enemy until stepped on; the Lodestar shows them to a side with Cove creatures.)
      if (!seesHazard(s, mySide, z)) continue;
      const key = `${z.kind}:${z.hexes.join(",")}`;
      shown.add(key);
      const big = z.hexes.length > 2;
      // [loop, appear]: the force field's four shapes (/ \ > <) by side and size; "\" has no appearing DEF of its own.
      const [def, appearDef] =
        z.kind === "quicksand" ? ["c17spe1", "c17spe0"] : z.kind === "mine" ? ["c09spf1", "c09spf0"] : z.kind === "fireWall" ? ["c07spf61", "c07spf60"] : z.side === 0 ? (big ? ["c15spe10", "c15spe9"] : ["c15spe1", "c15spe0"]) : big ? ["c15spe7", "c15spe6"] : ["c15spe4", undefined];
      const frames = (await loadDef(`${def}.def`).catch(() => null))?.get(0) ?? [];
      if (!frames.length) continue;
      const fresh = !!before && !before.has(key) && appearDef ? ((await loadDef(`${appearDef}.def`).catch(() => null))?.get(0) ?? []) : [];
      // A force field is one picture standing on its lowest hex; the others repeat on every hex.
      const hexes = z.kind === "forceField" ? [z.hexes[0]] : z.hexes;
      for (const h of hexes) {
        const o = cellOrigin(h);
        // The DEF's canvas stands on the hex's bottom edge (quicksand half a hex higher, on the hex's middle).
        const top = o.y + 42 - frames[0].fullHeight + (z.kind === "quicksand" ? -42 + 21 : 0);
        const play = (list: typeof frames, loop: boolean) => {
          const sp = new AnimatedSprite(list.map((f) => f.texture));
          const place = (i: number) => sp.position.set(o.x + list[i].x, top + list[i].y);
          place(0);
          sp.onFrameChange = place;
          // Obstacles' 20 frames a second whatever the speed (VCMI's getObstaclesSpeed); they ran at 9.
          sp.animationSpeed = pace.OBSTACLE_FPS / 60;
          sp.loop = loop;
          sp.play();
          this.hazardsLayer.addChild(sp);
          return sp;
        };
        if (!fresh.length) play(frames, true);
        else {
          const appear = play(fresh, false);
          // Then the loop, unless the field was redrawn meanwhile.
          appear.onComplete = () => {
            if (appear.destroyed) return;
            appear.destroy();
            play(frames, true);
          };
        }
      }
    }
  }

  private async refreshQueue() {
    this.queueLayer.removeChildren();
    const s = this.state;
    if (!s || s.winner !== null) return;
    // Centred between the two heroes' corners.
    const shown = upcoming(s, 15);
    const textures = await Promise.all(shown.map(({ unit }) => creaturePortrait(stats(s, s.units[unit]), "small")));
    // The phone's list: the next eight that act (the Ammo Cart and the First Aid Tent take up rows and act by themselves).
    const listed = shown.map((x, i) => ({ ...x, tex: textures[i] })).slice(screenSize.portrait ? 0 : 1).filter(({ unit }) => s.units[unit].machine !== "cart" && s.units[unit].machine !== "tent");
    this.touch.setQueue((screenSize.portrait ? listed.slice(0, 15) : phoneSized() ? [] : listed.slice(0, 8)).map(({ unit, nextRound, tex }) => ({ unit: s.units[unit].id, creature: stats(s, s.units[unit]), count: s.units[unit].count, side: s.units[unit].side as 0 | 1, flag: this.flagOf(s, s.units[unit].side), nextRound, portrait: tex ?? null })));
    this.queueSlots = [];
    // Upright, the touch layer draws it in its own band; phones sideways: this strip, the first (the stack to move) a size up.
    if (screenSize.portrait) return;
    const phone = phoneSized() && extra("battleCues");
    // Phones: the cells as big as the strip between the heroes' corners allows (a finger's width, the counts readable).
    const cell = phone ? Math.min(42, Math.floor((SCREEN_W - 140 - 12) / shown.length) - 3) : 34;
    const sizes = shown.map((_, i) => (phone && i === 0 && !shown[0].nextRound ? cell + 12 : cell));
    const total = sizes.reduce((w, z) => w + z + 3, 0);
    let at = Math.round((SCREEN_W - total) / 2);
    shown.forEach(({ unit, nextRound }, i) => {
      const u = s.units[unit];
      const tex = textures[i];
      const z = sizes[i];
      const x = at + 2 + (nextRound && !phone ? 10 : 0);
      at += z + 3;
      if (!tex) return;
      const y = phone ? Math.round((cell + 12 - z) / 2) + 2 : Math.round((46 - z) / 2) + 2;
      // The queue's own cell (queueCell.ts), the same on every layout.
      this.queueLayer.addChild(Object.assign(queueCell({ portrait: tex, count: u.count, flag: this.flagOf(s, u.side), size: z + 2, current: i === 0 && !nextRound, nextRound }), { x: x - 2, y: y - 2 }));
      this.queueSlots.push({ x: x - 2, y: y - 2, w: z + 2, h: z + 2, unit: u.id });
    });
  }

  /** Tactics: the stack being placed (kept by id: every update of the battle brings new objects, and a stale one sent
   *  Next back to the first stack: the owner, 2026-11-01 "multiple high speed rocs in a row"). */
  private tacticSelId: number | null = null;
  get tacticSel(): Unit | null {
    return this.tacticSelId === null ? null : (this.state?.units[this.tacticSelId] ?? null);
  }
  set tacticSel(u: Unit | null) {
    this.tacticSelId = u ? u.id : null;
  }
  /** Our side arranging its stacks before the battle (Tactics). */
  myTactics(): boolean {
    const t = this.state?.tactics;
    return !!t && !this.animating && this.mine(t.side);
  }

  /** Next stack: round all of ours in the army's order, each once (VCMI's tacticNextStack over battleGetStacks). */
  nextTacticUnit() {
    const s = this.state;
    if (!s?.tactics) return;
    const mine = s.units.filter((u) => u.side === s.tactics!.side && alive(u) && !u.machine);
    const i = this.tacticSelId === null ? -1 : mine.findIndex((u) => u.id === this.tacticSelId);
    this.tacticSel = mine[(i + 1) % mine.length] ?? null;
    this.aim.refreshShade();
    this.setHint(this.texts.idleHint());
  }

  endTactics() {
    const s = this.state;
    if (!s?.tactics) return;
    const any = s.units.find((u) => u.side === s.tactics!.side);
    if (any) this.sendAction({ type: "tacticsDone", unit: any.id });
  }

  setHint(text: Text, blow: Blow | null = null, logged = false) {
    // The turn card too: the line can stay the same while the stack it names arrives (the battle's first turn).
    const card = this.turnCard();
    const cardKey = card ? `${card.creature.id}:${card.count}:${card.numbers}` : "";
    if (text !== this.hint || blow || logged || cardKey !== this.cardKey) {
      this.hint = text;
      this.cardKey = cardKey;
      this.consoleText.value = text;
      this.touch.setHint(text, card, blow, logged);
    }
  }
  /** A line of what happened (as an action plays): the console's, and the phone's log keeps it. */
  say(text: Text, blow: Blow | null = null) {
    this.setHint(text, blow, true);
  }

  /** The whole battle's log to scroll through (EXTRAS battleLog: the phone's Menu, a tap on its lines). */
  async openLog() {
    const s = this.state;
    if (!s || this.modals.open) return;
    const owner = s.sides[[0, 1].find((x) => this.mine(x)) ?? 0]?.owner ?? 0;
    const rows = s.log.map((e) => ({ text: this.texts.logLine(e), round: typeof e === "object" && e.t === 412 }));
    await battleLogWindow(this.modals, rows, owner);
  }
  private cardKey = "";

  /** Whose turn it is, for the touch layout's card under the message. */
  private turnCard(): TurnCard | null {
    const s = this.state;
    const u = this.myActive() ?? (this.myTactics() ? this.tacticSel ?? undefined : undefined);
    if (!s || !u || u.machine) return null;
    return { creature: stats(s, u), count: u.count, numbers: this.texts.numbers(u) };
  }

  // ---- spells -----------------------------------------------------------------

  /** Spell being aimed (Teleport keeps the chosen stack until the destination is picked; `creature`: a Jotunn's, not the hero's). */
  casting: { spell: SpellInfo; unit?: Unit; creature?: boolean } | null = null;
  private bookOpen = false;

  /** The original's combat options window, coloured for the player on our side (with Undo: EXTRAS battleUndo). */
  openOptions() {
    const side = [0, 1].find((x) => this.mine(x)) ?? 0;
    const undo = this.undoOffered() ? { can: this.undoable(), run: () => void this.undo() } : undefined;
    return battleOptionsWindow(this.modals, this.state?.sides[side]?.owner ?? 0, (text) => this.setHint(text), undo);
  }

  // ---- undo (an addition: EXTRAS battleUndo) ----------------------------------

  /** The decision of this battle the server would take back (its last update said so), or none. */
  undoMove: UndoMove | null = null;
  /** Asks the server to take the last decision back (set by the screen that opened the battle; none when watching). */
  onUndo: (() => void) | null = null;
  /** The battle has just been taken back: said in the log once it is drawn again. */
  private undone = false;

  /** Is Undo offered here at all (the switch on, a game that can take it)? */
  undoOffered(): boolean {
    return extra("battleUndo") && !!this.onUndo;
  }

  /** Can the last decision be taken back now (one kept, the battle on)? */
  undoable(): boolean {
    return this.undoOffered() && !!this.undoMove && !!this.state && this.state.winner === null && !this.result;
  }

  /**
   * The battle back to just before the last decision a player made (a misclick on a trackpad: the owner 2026-11-02). Two
   * players in the battle: the other one is asked first. False when there is nothing to take back.
   */
  undo(): boolean {
    if (!this.undoable()) return false;
    if (this.casting) this.cancelCasting();
    this.input.dropAiming();
    void this.askUndo();
    return true;
  }

  /** "Undo the last move? Pikemen attacked the Goblins": asked first (a second misclick shouldn't undo a good move). */
  private async askUndo() {
    const s = this.state!;
    const move = this.undoMove!;
    const owner = this.state?.sides[[0, 1].find((x) => this.mine(x)) ?? 0]?.owner ?? 0;
    const a = await messageBox(this.modals, fmt`${tr("Undo the last move?")}\n\n${undoWords(s, move)}`, owner, { buttons: YES_NO });
    // (The battle moved on while asking: that move is the one to take back now, asked again.)
    if (a !== "yes" || this.undoMove !== move || !this.undoable()) return;
    this.onUndo!();
    // Two players at two screens: the other one agrees first.
    const shared = this.viewer !== undefined && s.sides.every((x) => x.controller === "human" && x.owner !== undefined && x.owner >= 0);
    this.setHint(shared ? tr("Asked the other player to agree to undo the last move") : tr("Undoing the last move..."));
  }

  /** Once on this device: what Undo is and where (the first battle where it's offered, at our first turn). */
  private async tellUndo() {
    if (BattleView.undoTold) return;
    BattleView.undoTold = true;
    // (After any window that's up, the touchpad's tips say: never two at once.)
    while (this.modals.open && !this.root.destroyed) await new Promise((r) => setTimeout(r, 400));
    if (this.root.destroyed) return;
    try {
      if (localStorage.getItem(UNDO_TOLD)) return;
      localStorage.setItem(UNDO_TOLD, "1");
    } catch {
      return;
    }
    const owner = this.state?.sides[[0, 1].find((x) => this.mine(x)) ?? 0]?.owner ?? 0;
    // Only where it is and what it looks like (2026-11-02 19:26: not the whole flow): the two buttons to press, pictured.
    const menu = !!this.touch.menu?.visible && this.touch.layer.visible;
    const tiles = menu ? await menuPicture() : null;
    const tilesTexture = tiles ? this.app.renderer.generateTexture({ target: tiles, resolution: 2 }) : null;
    tiles?.destroy({ children: true });
    const options = tilesTexture ?? (await loadDef("icm003.def").catch(() => null))?.get(0)?.[0]?.texture;
    const undo = menu ? await undoPicture() : await textButton(tr("Undo"), 80, 25, () => {}, "medfont");
    // The way there as one picture (2026-11-03 10:27): the first button, the original's gold arrow, the second.
    const path = new Container();
    const first = options ? new Sprite(options) : null;
    const arrowTexture = (await loadDef("adoprta.def").catch(() => null))?.get(0)?.[0]?.texture ?? null;
    const arrow = arrowTexture ? new Sprite(arrowTexture) : null;
    let x = 0;
    for (const piece of [first, arrow, undo]) if (piece) (piece.x = x), (x += piece.width + 10), path.addChild(piece);
    const h = Math.max(...path.children.map((c) => c.height));
    for (const c of path.children) c.y = Math.round((h - c.height) / 2);
    const undoTexture = this.app.renderer.generateTexture({ target: path, resolution: 2 });
    path.destroy({ children: true });
    const caption = options ? fmt`${menu ? tr("Menu") : tr("Combat Options")} > ${tr("Undo")}` : tr("Undo");
    const components = [{ texture: undoTexture, caption }];
    // The owner's tone (2026-11-03 10:27): a slip is normal, here is the way back.
    const text = menu ? tr("Finger slipped? Don't worry: you can take back your last move any time with Undo.") : tr("Mouse slipped, or the touchpad had a hiccup? Don't worry: you can take back your last move any time with Undo (or Ctrl+Z).");
    await messageBox(this.modals, fmt`{${tr("Mistake?")}}\n\n${text}`, owner, { components });
    undoTexture.destroy(true);
    tilesTexture?.destroy(true);
  }
  /** (Asked once a page: the storage can be read only once it's there.) */
  private static undoTold = false;

  /** The original spellbook; picking a castable spell starts aiming. `pick`: a spell hotkey's spell, cast without the book. */
  openSpellbook(pick?: number) {
    const s = this.state;
    const u = this.myActive();
    if (!s || !u || this.bookOpen || s.tactics) return;
    // Aiming a spell: the book again drops it (the only way back on a touch screen, which has no
    // Esc or right button), then opens for another choice.
    if (this.casting) this.cancelCasting();
    const hero = s.sides[u.side].hero;
    const say = (text: Text) => void messageBox(this.modals, text, hero?.owner ?? 0);
    if (!hero) return say(tr("No hero leads this army."));
    if (!hero.spells) return say(tr("The hero has no spellbook."));
    // An Orb of Inhibition on either hero: no book, GENRLTXT 683 says whose it is (VCMI's bSpellf).
    for (const side of [0, 1]) {
      const b = s.sides[side].hero?.bonuses?.find((x) => x.type === "BLOCK_ALL_MAGIC" && x.artifact !== undefined);
      if (!b) continue;
      const art = this.texts.artifactNames[b.artifact!] ?? HOTA_ARTIFACTS[b.artifact!]?.name ?? "";
      const wielder = s.sides[side].hero!.name;
      return say(this.texts.line(683, wielder, art).trim());
    }
    if (s.cast?.[u.side]) return say(this.texts.line(128).trim());
    const ready = castable(s, controlSide(u));
    const known = hero.spells.map((id) => s.spells?.[id]).filter((x): x is SpellInfo => !!x);
    this.bookOpen = true;
    void spellbookWindow(this.modals, hero.owner, {
      pick,
      spells: known,
      mana: hero.mana ?? 0,
      combat: true,
      isCombat: (sp) => sp.id >= 10,
      cost: (sp) => spellCost(s, u.side, sp),
      mastery: (sp) => mastery(s, u.side, sp),
      schoolLevel: (_sp, sc) => skillLevel(hero.skills, `${sc}Magic`),
      wrongKind: (sp) => sp.id < 10,
      blocked: (sp) => (sp.id < 10 ? tr("That spell can only be cast on the adventure map.") : !COMBAT_SPELLS[sp.id] ? tr("That spell isn't in the game yet.") : ready.some((r) => r.id === sp.id) ? null : this.texts.blockedText(s, sp, hero.name) ?? (affectsNoOne(s, controlSide(u), sp) ? this.texts.line(185).trim() : null) ?? this.texts.line(206, spellCost(s, u.side, sp), hero.mana ?? 0).trim()),
      describe: (sp) => {
        // The right-click adds what a damage spell would do (GENRLTXT 343, as VCMI's SpellArea).
        const n = spellEstimate(s, u.side, sp);
        return fmt`${said(sp.name)}\n\n${said(sp.text[mastery(s, u.side, sp)] ?? "")}${n ? fmt`\n${this.texts.line(343, n)}` : NONE}`;
      },
      onMessage: say,
    }).then((sp) => {
      this.bookOpen = false;
      if (!sp) return;
      if (!needsAim(s, u.side, sp)) return this.sendAction({ type: "cast", unit: u.id, spell: sp.id, target: 0 });
      this.casting = { spell: sp };
      this.aim.refreshHover();
    });
  }

  /** Retreat or surrender, after asking; the hero can be hired again from the tavern. */
  async giveUp(surrender: boolean) {
    const s = this.state;
    // The arranging hero may give up during the tactics phase too.
    const tactics = this.myTactics();
    const u = tactics ? s?.units.find((x) => x.side === s.tactics!.side && x.count > 0) : this.myActive();
    if (!s || !u || this.modals.open) return;
    const side = tactics ? u.side : controlSide(u);
    const hero = s.sides[side].hero;
    const owner = hero?.owner ?? 0;
    const t = (await gameTexts()).general;
    const why = fleeBlock(s, side, surrender);
    if (why || !hero) {
      // The Shackles of War on either hero: nobody leaves (GENRLTXT 340 for a retreat, 341 for a surrender).
      const line =
        why === "shackles" ? (surrender ? (t[341] ?? englishLine("genrltxt", 341)) : (t[340] ?? englishLine("genrltxt", 340)))
        : why === "town" ? (surrender && s.town?.escape ? tr("A hero defending a town may retreat through the Escape Tunnel, but not surrender.") : tr("A hero defending a town can neither retreat nor surrender."))
        : why === "noEnemyHero" ? tr("You can only surrender to an enemy hero.")
        : why === "hitAndRun" ? HIT_AND_RUN
        : tr("Only a hero can retreat or surrender.");
      return void messageBox(this.modals, said(line.replace("%s", hero?.name ?? "")), owner);
    }
    // The original's lines: the enemy hero names the price; retreating just asks.
    const cost = surrenderCost(s, side);
    const enemy = s.sides[1 - side].hero?.name ?? s.sides[1 - side].name;
    let k = 0;
    const args = [enemy, cost];
    const text = surrender ? said((t[32] ?? englishLine("genrltxt", 32)).replace(/%[sd]/g, () => String(args[k++]))) : (t[28] ?? englishLine("genrltxt", 28));
    const answer = await messageBox(this.modals, text, owner, { buttons: YES_NO });
    if (answer !== "yes") return;
    const gold = this.goldOf?.(owner);
    if (surrender && gold !== undefined && gold < cost) return void messageBox(this.modals, t[29] ?? fallback("You don't have enough gold!"), owner);
    // Its film for the results window, fetched while the hero leaves.
    preloadResultVideos(surrender ? ["surrender"] : ["rtstart", "rtloop"]);
    this.sendAction({ type: "retreat", unit: u.id, surrender });
  }

  /** Battle hotkeys (W wait, D defend, A auto, C cast, Esc cancel aiming); true when handled. */
  onKey(key: string): boolean {
    if (this.modals.open) return true;
    if (key.length === 1) key = key.toLowerCase();
    if (key === "Escape" && this.casting) this.cancelCasting();
    // Aiming a hero's spell blocks the buttons' shortcuts (VCMI's blockUI: options, info, retreat, surrender, wait, defend, auto); C goes back to the book.
    else if (this.casting && !this.casting.creature && key !== "c" && key.length === 1) return true;
    // Tactics (VCMI's battleTacticsNext / battleTacticsEnd): Space picks the next stack, Enter starts the battle.
    else if (this.myTactics() && (key === " " || key === "Enter")) key === " " ? this.nextTacticUnit() : this.endTactics();
    else if (key === "w") this.act("wait");
    // D, or Space as in HD mod: defend.
    else if (key === "d" || key === " ") this.act("defend");
    else if (key === "a") this.toggleAuto();
    else if (key === "q") this.quickCombat();
    else if (key === "c") this.openSpellbook();
    // HD's spell hotkeys (spellHotkeys.ts): the digit's spell, as picked from the book.
    else if (/^[0-9]$/.test(key) && extra("spellHotkeys") && spellOfHotkey(key) !== undefined) this.openSpellbook(spellOfHotkey(key));
    else if (key === "r") void this.giveUp(false);
    else if (key === "s") void this.giveUp(true);
    // VCMI's battleToggleGrid, battleOpenActiveUnit / battleOpenHoveredUnit.
    else if (key === "F6") setSetting("battleGrid", !this.grid.visible);
    // VCMI's battleToggleMouseShadow / battleToggleMovementShadow (the combat options' two shadows).
    else if (key === "F7") setSetting("battleMouseShadow", !settings().battleMouseShadow);
    else if (key === "F8") setSetting("battleMoveShadow", !settings().battleMoveShadow);
    else if (key === "i" || key === "v") {
      if (this.info.popup) this.info.hideInfo();
      else {
        const s = this.state;
        const hex = key === "v" ? hexAtPoint(this.pointer.x, this.pointer.y) : -1;
        const u = s && (key === "i" ? this.myActive() : hex >= 0 ? unitAt(s, hex) : undefined);
        if (u) void this.info.showInfo(u);
      }
    }
    // VCMI's battleConsoleUp / Down.
    else if (key === "ArrowUp") this.texts.scrollLog(1);
    else if (key === "ArrowDown") this.texts.scrollLog(-1);
    else return false;
    return true;
  }

  cancelCasting() {
    this.casting = null;
    this.aim.refreshHover();
  }

  click() {
    // A click on a stack's cell in the queue is a click on the stack (VCMI's StackBox::clickPressed).
    const queued = this.state ? this.input.queueUnitAt(this.pointer.x, this.pointer.y) : undefined;
    if (queued && !this.myTactics()) {
      this.pointer = hexCenter(queued.pos);
      this.aim.refreshHover();
    }
    const hex = hexAtPoint(this.pointer.x, this.pointer.y);
    // Tactics: pick one of your stacks, then where it should stand.
    if (this.myTactics() && this.state && hex >= 0) {
      const s = this.state;
      const at = unitAt(s, hex);
      if (at && at.side === s.tactics!.side && !at.machine) this.tacticSel = at;
      else if (this.tacticSel && tacticsSpot(s, this.tacticSel, hex)) {
        this.sendAction({ type: "tacticMove", unit: this.tacticSel.id, to: hex });
        // The next stack is picked at once (VCMI's endAction: tacticNextStack(stack)).
        this.nextTacticUnit();
      }
      this.aim.refreshShade();
      this.setHint(this.texts.idleHint());
      return;
    }
    if (this.casting && hex >= 0 && this.aim.clickSpell(hex)) return;
    // A click on our own hero opens the spellbook, as the original's (VCMI's BattleHero::heroLeftClicked).
    if ((hex < 0 || hex % 17 === 0 || hex % 17 === 16) && !this.casting && !this.animating) {
      const side = this.heroes.heroAtPoint(this.pointer.x, this.pointer.y);
      if (side !== null && this.myActive()?.side === side) return void this.openSpellbook();
    }
    const u = this.myActive();
    const i = this.aim.intent;
    if (!u || !i) return void logPlay(`battle: a press did nothing (${!u ? this.input.whyIdle() || "none of ours is up" : `nothing to do at hex ${hex}`})`);
    this.aim.clearHover();
    this.shade.removeChildren().forEach((c) => c.destroy());
    if (i.kind === "creatureCast") {
      // Jotunns' Teleport: the ally is chosen; now where it goes (as the hero's Teleport).
      const s = this.state!;
      const sp = creatureSpellAt(s, u, i.hex);
      const ally = unitAt(s, i.hex);
      if (ally && sp.length === 1 && sp[0].key === "teleport") {
        this.casting = { spell: sp[0], unit: ally, creature: true };
        return this.aim.refreshHover();
      }
    }
    this.sendAction(actionOf(u, i));
  }
}
