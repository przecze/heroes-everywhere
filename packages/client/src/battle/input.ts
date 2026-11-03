// The battle's pointer: hover and clicks, taps (a first tap previews, a second does it), the magnifier under a
// dragged finger, the one-handed pad beside the field, the upright portraits' picks and the attack-side picker.
import type { BattleView } from "./view.ts";
import { logPlay } from "../feedback/recent.ts";
import { extra } from "../settings.ts";
import { isTouchLongPress, untilReleased } from "../touch.ts";
import { attackApproaches, attackPositions, type BattleState, type Unit, activeUnit, alive, stats, unitAt, unitHexes, controlSide, tacticsSpot, actsByItself } from "@heroes/core";
import { screenSize } from "../ui/screen.ts";
import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { label } from "../ui/kit.ts";
import { textPopup } from "../ui/dialogs.ts";
import { approachPoint, intentKey } from "./intent.ts";
import { BAR_Y, SCREEN_W, cellOrigin, hexAtPoint, hexCenter, CROP_X, CROP_W } from "./layout.ts";
import { Loupe, cursorTexture } from "./loupe.ts";
import { hexRing } from "./unitSprite.ts";
import { combatCursorFrame } from "../cursors.ts";
import { tr, NONE } from "../i18n/index.ts";

export class BattleInput {
  private readonly v: BattleView;
  /** A stack's or hero's card a finger's hold opened stays up until the next touch (not the hold's own release). */
  private infoStays = false;
  constructor(v: BattleView) {
    this.v = v;
  }

  /** The field's pointer: hover, clicks and taps, the magnifier's drag, a held right button's popups. */
  attachPointer() {
    // Touch: a finger dragged over the field brings up the magnifier (loupe.ts); lifting it acts there.
    this.v.root.on("pointerdown", (e) => {
      if (this.v.bar.barTip && !this.inBar(e.target as Container)) this.v.bar.barTip = null;
      // (A long press's right button, touch.ts, comes as the mouse's: the drag goes on.)
      if (e.pointerType !== "touch") return;
      this.fingerDrag = null;
      // A portrait tapped (upright) lit its stack up as pointed at; a finger on the field ends that look, or every
      // tap kept reading as the portrait's stack and the field took nothing (the owner: stuck until a reload).
      if (this.tapped && !this.inTouchLayer(e.target as Container) && !this.inBar(e.target as Container)) this.dropPicked();
      if (!screenSize.touch || !extra("battleLoupe") || this.inTouchLayer(e.target as Container)) return;
      // Only a finger put down on the field aims there: one on the log under it (upright) or on the bar's band would
      // drag the aim off the field (2026-10-27, a slide started on the log).
      const at = e.getLocalPosition(this.v.root);
      if (at.y < 0 || at.y >= BAR_Y || at.x < CROP_X || at.x > CROP_X + CROP_W) return;
      this.fingerDrag = { x: e.global.x, y: e.global.y, on: false };
    });
    this.v.root.on("pointerupoutside", () => this.endFingerDrag());
    // A finger tapping the field, not the pad: the pad's finger hint may show again (touchLayout.ts fieldTapped).
    this.v.root.on("pointertap", (e) => {
      if (e.pointerType === "touch" && !this.inTouchLayer(e.target as Container) && !this.inBar(e.target as Container)) this.v.touch.fieldTapped();
    });
    // The magnifier's drag let go: straight to what it showed (no second tap). On the lift itself, not
    // on Pixi's tap: the hex first touched is usually redrawn by then (the aim's highlights), and Pixi
    // sends no tap for a press whose target is gone, so the move waited for a second, exact tap.
    this.v.root.on("pointerup", (e) => {
      if (e.pointerType !== "touch" || !this.fingerDrag?.on || e.button !== 0) return;
      const p = e.getLocalPosition(this.v.root);
      this.endFingerDrag();
      this.dragDoneAt = performance.now();
      this.v.pointer = { x: p.x, y: p.y };
      this.v.aim.refreshHover();
      this.armed = null;
      const up = this.v.myActive();
      if (this.v.auto && !(up && this.v.leftToPlayer(up))) return;
      this.v.click();
    });
    this.v.root.on("pointermove", (e) => {
      // A button's rollover text stays only while the pointer is over the bar: its "pointerout" can go missing (the
      // spell book or a window opened over it, leaving full screen), and the stuck text blocked every hover and click.
      if (this.v.bar.barTip && !this.inBar(e.target as Container)) this.v.bar.barTip = null;
      const p = e.getLocalPosition(this.v.root);
      this.v.pointer = { x: p.x, y: p.y };
      this.v.aim.refreshHover();
      const d = this.fingerDrag;
      if (d && e.pointerType === "touch") {
        if (!d.on && Math.hypot(e.global.x - d.x, e.global.y - d.y) * screenSize.css > 12) {
          d.on = true;
          // A finger held on a stack brought up its card (the long press); moving on to aim takes it
          // down, or it covers the field being aimed at.
          this.v.info.hideInfo();
        }
        if (d.on) this.showLoupe(p, e.global);
      }
      // The pointer coming over a stack: it stirs (its "mouse over" group), as VCMI's and the original's.
      const hex = this.v.state ? hexAtPoint(p.x, p.y) : -1;
      const under = hex >= 0 && this.v.state ? unitAt(this.v.state, hex) : undefined;
      if (under?.id !== this.v.stirred) {
        this.v.stirred = under?.id;
        if (under && alive(under) && e.pointerType === "mouse") this.v.sprites.get(under.id)?.fidget();
      }
    });
    this.v.root.on("pointerleave", (e) => {
      // A lifted finger "leaves" too: keep a touch preview on screen until the next tap.
      if (e.pointerType === "touch" && (this.armed || this.peek)) return;
      this.v.pointer = { x: -1, y: -1 };
      this.v.aim.refreshHover();
    });
    this.v.root.on("pointertap", (e) => {
      // (A tap on one of the bar's buttons is that button's: the Auto button's own click, bubbling here, switched auto combat straight off again after one action.)
      if (e.button !== 0 || this.inTouchLayer(e.target as Container) || this.inBar(e.target as Container)) return;
      // Auto combat: a tap or click on the field takes over again.
      // (Not while it's waiting on a stack the combat options leave to the player: that tap plays it.)
      const up = this.v.myActive();
      if (this.v.auto && !(up && this.v.leftToPlayer(up))) return void ((this.fingerDrag = null), this.v.toggleAuto());
      // The magnifier's drag was done on the lift (above): its tap, when Pixi sends one, is not another.
      if (e.pointerType === "touch" && performance.now() - this.dragDoneAt < 400) return;
      this.fingerDrag = null;
      // Touch: no hover beforehand, so work out what the tap means right here; a long press only shows info.
      if (e.pointerType === "touch") {
        const p = e.getLocalPosition(this.v.root);
        this.v.pointer = { x: p.x, y: p.y };
        this.v.aim.refreshHover();
        // Touch layout: the first tap shows what would happen (highlights and the line below),
        // a second tap on the same thing does it; tapping elsewhere (another side of the enemy) re-aims.
        if (screenSize.touch && !this.v.myTactics()) {
          const key = this.intentKey();
          // A tap that can do nothing there (a stack out of reach, one of ours): what it is and how far
          // it walks stay up until the next tap, as a hover would show them.
          this.peek = !key && hexAtPoint(p.x, p.y) >= 0;
          // Armed on a stack, a tap on the same stack (anywhere on it) does the move: where on it the finger lands is not a choice of side (the pointer's side picks `from`, and a fingertip never lands twice alike).
          const [kind, target, from] = key?.split(":") ?? [];
          const [akind, atarget, afrom] = this.armed?.split(":") ?? [];
          if (key && this.armed && kind === "attack" && akind === "attack" && target === atarget && from !== afrom && this.v.aim.intent?.kind === "attack") this.v.aim.intent = { ...this.v.aim.intent, from: +afrom };
          else if (key && key !== this.armed) {
            this.armed = key;
            if (this.v.hint) this.v.setHint(tr(`%1 (tap again)`, this.v.hint));
            return;
          }
        }
        // Tactics too: a tap on a free spot shows the stack there (gold), a second tap places it.
        if (screenSize.touch && this.v.myTactics() && this.v.state && this.v.tacticSel) {
          const hex = hexAtPoint(this.v.pointer.x, this.v.pointer.y);
          const s = this.v.state;
          const at = hex >= 0 ? unitAt(s, hex) : undefined;
          if (hex >= 0 && !(at && at.side === s.tactics!.side) && tacticsSpot(s, this.v.tacticSel, hex) && this.armed !== `place:${hex}`) {
            this.armed = `place:${hex}`;
            this.v.aim.markHexes(unitHexes(s, this.v.tacticSel, hex), 0xffe070, 0.55);
            this.v.setHint(tr("Tap again to place it there."));
            return;
          }
          // An enemy stack tapped: its reach (aim.ts) stays up till the next tap, as in battle.
          this.peek = !!at && at.side !== s.tactics!.side && alive(at);
        }
      }
      this.armed = null;
      this.v.click();
    });
    // Hold right-click on a stack for its details, like the original.
    this.v.root.on("rightdown", (e) => {
      if (this.v.casting) {
        // Called off, and said so while the button is held (GENRLTXT 731, VCMI's onHexRightClicked).
        const side = this.v.myActive() ? controlSide(this.v.myActive()!) : 0;
        this.v.cancelCasting();
        textPopup(this.v.texts.cancelledText, this.v.state?.sides[side]?.owner ?? 0, e.global.x, e.global.y);
        return;
      }
      const p = e.getLocalPosition(this.v.root);
      const hex = hexAtPoint(p.x, p.y);
      // A stack's cell in the queue is that stack (VCMI's StackBox::showPopupWindow).
      const queued = this.queueUnitAt(p.x, p.y);
      const u = this.v.state && hex >= 0 ? unitAt(this.v.state, hex) : queued;
      // A finger's hold: the card stays after the finger lifts, until the next touch (EXTRAS holdStays, touch.ts
      // untilReleased; The owner 2026-11-03: a stack's card under his thumb went as he slid the thumb off to read it).
      const stay = () => {
        if (!isTouchLongPress() || !extra("holdStays")) return;
        this.infoStays = true;
        untilReleased(() => ((this.infoStays = false), this.v.info.hideInfo()), { popup: true });
      };
      if (u) {
        // Held on the field: what the pointer would show there too (an enemy's reach), not only its card.
        if (hex >= 0) (this.v.pointer = { x: p.x, y: p.y }), this.v.aim.refreshHover();
        stay();
        return void this.v.info.showInfo(u);
      }
      // A commanding hero (a stack on the hexes their box touches goes first): portrait, skills,
      // morale, luck and spell points.
      const heroSide = this.v.heroes.heroAtPoint(p.x, p.y);
      if (heroSide !== null) return void (stay(), this.v.info.showHeroInfo(heroSide));
      // A siege tower's archers (GENRLTXT 155 / 154, VCMI's BattleSiegeController::showTowerInfo).
      const tower = this.v.state?.units.find((t) => t.machine === "tower" && this.v.sprites.get(t.id)?.visible && this.v.sprites.get(t.id)!.getBounds().containsPoint(e.global.x, e.global.y));
      // (Or the tower's hex, which answers to the question cursor too.)
      const atHex = tower ?? (this.v.state && hex >= 0 ? this.v.aim.towerAtHex(this.v.state, hex) : undefined);
      if (atHex) this.v.info.showTowerInfo(atHex, e.global.x, e.global.y);
    });
    this.v.root.on("rightup", () => !this.infoStays && this.v.info.hideInfo());
    // A popup opened by a key (I / V) goes with the next click.
    this.v.root.on("pointerdown", (e) => e.button === 0 && this.v.info.popup && this.v.info.hideInfo());
    this.v.root.on("rightupoutside", () => !this.infoStays && this.v.info.hideInfo());
  }

  /** What a finger had in hand (the magnifier, the side picker, a stack picked or armed) goes when the turn moves on: nothing of it may stay into the next turn. */
  dropAiming() {
    this.closeDirections();
    this.loupe?.hide();
    this.fingerDrag = null;
    this.padAim = null;
    this.clearAimRing();
    this.armed = null;
    if (this.tapped) this.dropPicked();
  }

  /** The portrait's stack no longer picked: its card gives way to the log, and the pointer is the field's again. */
  private dropPicked() {
    this.tapped = null;
    this.v.queuePointed = null;
    this.v.touch.showPicked(null);
  }

  // ---- one-handed play: the touchpad beside the field (touchLayout.ts) ---------------------------
  /** Where the pad aims on the field (null: not aiming), and the gold ring that shows it. */
  private padAim: { x: number; y: number } | null = null;
  private readonly aimRing = new Graphics();
  /** The cursor a mouse would show where the pad aims, on the field by the ring (2026-10-27: not only in the magnifier). */
  private readonly aimCursor = new Sprite();
  private clearAimRing() {
    this.aimRing.clear();
    this.aimCursor.visible = false;
  }
  /** Pad movement to field movement: a thumb's short drag crosses the field. */
  private static readonly PAD_GAIN = 2.4;

  /** Touch: a finger on the field (where it went down, in canvas pixels), and whether it has moved enough to bring up the magnifier. */
  private fingerDrag: { x: number; y: number; on: boolean } | null = null;
  loupe: Loupe | null = null;

  private inBar(c: Container | null) {
    for (let n: Container | null = c; n; n = n.parent) if (n === this.v.barLayer) return true;
    return false;
  }

  private inTouchLayer(c: Container | null) {
    for (let n: Container | null = c; n; n = n.parent) if (n === this.v.touch.layer) return true;
    return false;
  }

  /** The magnifier around `at` (field pixels), above `finger` (canvas pixels). */
  private showLoupe(at: { x: number; y: number }, finger: { x: number; y: number }) {
    if (!this.loupe) {
      this.loupe = new Loupe(this.v.app);
      this.loupe.onVisible = (on) => this.v.touch.setLoupeUp(on);
      this.v.app.stage.addChild(this.loupe.view);
    }
    // Beside the field where the layout has a room for it (2026-10-26: "pop out outside the battle field"):
    // upright the reading room under the buttons, sideways the column away from the thumb; as big as the room
    // allows, level with the finger sideways. Without such a room, upright: the corner of the field farthest from
    // both the aim and the stack moving; elsewhere over the finger.
    const outside = (r0: number) => {
      const room = this.v.touch.loupeRoom();
      if (!room) return undefined;
      const L = this.v.touch.layer;
      const a = L.toGlobal({ x: room.x, y: room.y });
      const b = L.toGlobal({ x: room.x + room.w, y: room.y + room.h });
      const css = screenSize.css || 1;
      const r = Math.floor(Math.min(b.x - a.x, b.y - a.y, 220 / css) / 2) - 6;
      if (r < r0 * 0.8) return undefined;
      const x = (a.x + b.x) / 2;
      const y = screenSize.portrait ? (a.y + b.y) / 2 : Math.max(a.y + r + 6, Math.min(b.y - r - 6, finger.y));
      return { x, y, r };
    };
    const corner = !screenSize.portrait
      ? undefined
      : (r: number) => {
          const g = (p: { x: number; y: number }) => this.v.root.toGlobal(p);
          const from = this.v.myActive();
          const avoid = [g(at), ...(from ? [g(hexCenter(from.pos))] : [])];
          const a = g({ x: CROP_X, y: 0 });
          const b = g({ x: CROP_X + CROP_W, y: BAR_Y });
          const corners = [
            { x: a.x + r + 6, y: a.y + r + 6 },
            { x: b.x - r - 6, y: a.y + r + 6 },
            { x: a.x + r + 6, y: b.y - r - 6 },
            { x: b.x - r - 6, y: b.y - r - 6 },
          ];
          const room = (c: { x: number; y: number }) => Math.min(...avoid.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
          return corners.reduce((best, c) => (room(c) > room(best) + r / 2 ? c : best));
        };
    // The stacks drawn smaller for the picture (the owner: they hid the hexes being aimed at), as the attack's popup does.
    // Their counts too, about the size they have on the field (2026-11-02T23-46: the magnified ones were huge),
    // each shrunk about its own centre.
    const shrink = () => {
      const shrunk = [...this.v.sprites.values()].filter((sp) => !sp.destroyed);
      const boxes = shrunk.map((sp) => sp.countBox).filter((b) => !b.destroyed);
      const was = boxes.map((b) => ({ x: b.x, y: b.y, sx: b.scale.x, sy: b.scale.y }));
      for (const sp of shrunk) sp.scale.set(sp.scale.x * 0.65, sp.scale.y * 0.65);
      boxes.forEach((b, i) => {
        const w = b.width, h = b.height;
        b.scale.set(was[i].sx * 0.5, was[i].sy * 0.5);
        b.position.set(was[i].x + (w - b.width) / 2, was[i].y + (h - b.height) / 2);
      });
      return () => {
        shrunk.forEach((sp) => sp.destroyed || sp.scale.set(sp.scale.x / 0.65, sp.scale.y / 0.65));
        boxes.forEach((b, i) => b.destroyed || (b.scale.set(was[i].sx, was[i].sy), b.position.set(was[i].x, was[i].y)));
      };
    };
    this.loupe.show(this.v.field, at, finger, (r) => outside(r) ?? corner?.(r), { shrink, cursor: combatCursorFrame(this.v.aim.cursorNow) });
  }

  private endFingerDrag() {
    this.fingerDrag = null;
    this.loupe?.hide();
  }

  padHandlers() {
    /** Where the thumb is on the pad (canvas pixels): the magnifier floats above it. */
    let thumb: { x: number; y: number } | null = null;
    const place = () => {
      const a = this.padAim;
      this.clearAimRing();
      if (!a) return;
      this.aimRing.circle(a.x, a.y, 16).stroke({ color: 0xffd34a, width: 3 }).circle(a.x, a.y, 3).fill(0xffd34a);
      if (!this.aimRing.parent) this.v.root.addChildAt(this.aimRing, this.v.root.getChildIndex(this.v.touch.layer));
      if (!this.aimCursor.parent) this.v.root.addChildAt(this.aimCursor, this.v.root.getChildIndex(this.v.touch.layer));
      // As a mouse hovering there: the move or attack shows, with its line.
      this.v.pointer = { ...a };
      this.v.aim.refreshHover();
      const cur = combatCursorFrame(this.v.aim.cursorNow);
      this.aimCursor.visible = !!cur;
      if (cur) {
        this.aimCursor.texture = cursorTexture(cur.canvas);
        this.aimCursor.position.set(Math.round(a.x - cur.hx), Math.round(a.y - cur.hy));
      }
      if (thumb && extra("battleLoupe")) this.showLoupe(a, thumb);
    };
    return {
      // From the active stack (or the tactics stack picked), else from where it was left.
      start: () => {
        if (this.padAim) return;
        logPlay(`battle pad: aiming starts (${this.whyIdle() || "ready"})`);
        // (Aiming ends a portrait's look, as a finger on the field does.)
        if (this.tapped) this.dropPicked();
        const u = this.v.myActive() ?? (this.v.myTactics() ? this.v.tacticSel ?? undefined : undefined);
        // (An arrow tower stands off the grid, its hex below 0: from the field's middle, not from off the screen.)
        this.padAim = u && u.pos >= 0 ? hexCenter(u.pos) : { x: SCREEN_W / 2, y: 300 };
        place();
      },
      drag: (dx: number, dy: number, at?: { x: number; y: number }) => {
        if (!this.padAim) return;
        if (at) thumb = at;
        // Upright the pad is as wide as the field: about one to one (and the field's cut-off sides out of reach).
        const up = screenSize.portrait;
        const gain = up ? 1.3 : BattleInput.PAD_GAIN;
        const [x0, x1] = up ? [CROP_X + 4, CROP_X + CROP_W - 4] : [0, SCREEN_W];
        // One-handed the pad is a strip beside the field: a drag across it must cover the whole field (the owner: it stopped short of the right edge).
        const size = !up ? this.v.touch.padSize : null;
        const gx = size ? Math.max(gain, (1.1 * (x1 - x0)) / size.w) : gain;
        const gy = size ? Math.max(gain, (1.1 * (BAR_Y - 80)) / size.h) : gain;
        this.padAim = { x: Math.max(x0, Math.min(x1, this.padAim.x + dx * gx)), y: Math.max(80, Math.min(BAR_Y, this.padAim.y + dy * gy)) };
        place();
      },
      // Let go: with the magnifier, straight to what it showed; else what a tap would do there is
      // ready, and a tap on the pad does it.
      release: () => {
        thumb = null;
        this.loupe?.hide();
        if (extra("battleLoupe") && this.padAim) {
          this.v.pointer = { ...this.padAim };
          this.v.aim.refreshHover();
          this.armed = null;
          this.padAim = null;
          this.clearAimRing();
          // (What a lift did goes in the play log: a lift that did nothing said why in the owner's notes, 2026-10-27.)
          logPlay(`battle pad: let go at ${this.aimText()}`);
          this.v.click();
          return;
        }
        this.armed = this.intentKey();
        if (this.v.hint) this.v.setHint(tr(`%1 (tap the pad to go)`, this.v.hint));
      },
      tap: () => {
        if (!this.padAim || !this.armed) return void logPlay(`battle pad: a tap, nothing aimed (${this.whyIdle() || "slide to aim"})`);
        this.v.pointer = { ...this.padAim };
        this.armed = null;
        this.padAim = null;
        this.clearAimRing();
        this.v.click();
      },
    };
  }

  /** Upright: the stack picked from a portrait (the queue over the field, a line of the log), this turn. */
  private tapped: { unit: number; turn: string } | null = null;
  private directions: Container | null = null;

  /**
   * Upright: a portrait tapped (in the queue over the field or a line of the log). The first tap aims
   * there as a finger on the stack would (it lights up, its card and what would happen show below);
   * a second tap does it, an attack with several sides to come from first asking which (pickDirection).
   */
  stackTapped(id: number) {
    const s = this.v.state;
    const t = s?.units.find((v) => v.id === id && v.count > 0);
    this.closeDirections();
    if (!s || !t || this.v.animating) return;
    const turn = `${s.round}:${activeUnit(s)?.id}`;
    const again = this.tapped?.unit === id && this.tapped.turn === turn;
    this.v.queuePointed = null;
    this.v.pointer = { ...hexCenter(t.pos) };
    this.v.aim.refreshHover();
    const key = this.intentKey();
    const me = this.v.myActive();
    if (again && key) {
      this.tapped = null;
      this.v.touch.showPicked(null);
      this.armed = null;
      if (!this.v.casting && this.v.aim.intent?.kind === "attack" && me) {
        const options = attackPositions(s, me, t);
        if (options.length > 1) return this.pickDirection(s, me, t, options);
      }
      return this.v.click();
    }
    // Nothing to do to it (ours, out of reach, not our turn): it's lit up with its reach, as pointed at.
    if (!key) {
      this.v.queuePointed = id;
      this.v.aim.refreshHover();
    }
    this.tapped = { unit: id, turn };
    const card = { creature: stats(s, t), count: t.count, numbers: this.v.texts.numbers(t) };
    this.v.touch.showPicked({ unit: id, card, note: key ? tr(`%1 (tap again)`, this.v.hint) : NONE });
  }

  /**
   * A melee attack that can come from several sides: the stack, enlarged in a window over the field,
   * with a gold ring on each hex ours could strike from; a tap on one strikes from there, anywhere else
   * closes it.
   */
  private pickDirection(s: BattleState, me: Unit, t: Unit, options: number[]) {
    const R = 120;
    const Z = 1.8;
    const theirs = unitHexes(s, t);
    const mid = theirs.map(hexCenter).reduce((a, c) => ({ x: a.x + c.x / theirs.length, y: a.y + c.y / theirs.length }), { x: 0, y: 0 });
    const layer = this.v.touch.layer;
    const toLayer = (p: { x: number; y: number }) => layer.toLocal(this.v.root.toGlobal(p));
    const k = this.v.root.worldTransform.a / layer.worldTransform.a;
    const at = { x: Math.max(R * Z + 4, Math.min(SCREEN_W - R * Z - 4, mid.x)), y: Math.max(R * Z + 4, Math.min(BAR_Y - R * Z - 4, mid.y)) };
    const box = new Container();
    box.label = "panel: attack from";
    const shade = new Graphics();
    const tl = toLayer({ x: 0, y: 0 });
    const br = toLayer({ x: SCREEN_W, y: BAR_Y });
    shade.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y).fill({ color: 0x000000, alpha: 0.5 });
    shade.eventMode = "static";
    shade.label = "button: cancel the attack";
    shade.on("pointertap", (e) => (e.stopPropagation(), this.closeDirections(), this.v.aim.refreshHover()));
    box.addChild(shade);
    // What the screen shows around the stack, bigger.
    const g = this.v.root.toGlobal(mid);
    const sc = this.v.root.worldTransform.a;
    const frame = new Rectangle(Math.round(g.x - R * sc), Math.round(g.y - R * sc), Math.round(2 * R * sc), Math.round(2 * R * sc));
    this.v.aim.clearHover();
    const shown = layer.visible;
    layer.visible = false;
    // The stacks drawn smaller for the picture (the owner: they covered the hexes, which are what is measured here).
    const shrunk = [...this.v.sprites.values()].filter((sp) => !sp.destroyed);
    for (const sp of shrunk) sp.scale.set(sp.scale.x * 0.65, sp.scale.y * 0.65);
    this.v.turnArrow.visible = false;
    let tex: Texture;
    try {
      tex = this.v.app.renderer.generateTexture({ target: this.v.app.stage, frame, resolution: Math.min(4, Z * (this.v.app.renderer.resolution || 1)), clearColor: [0, 0, 0, 1] });
    } finally {
      layer.visible = shown;
      for (const sp of shrunk) sp.scale.set(sp.scale.x / 0.65, sp.scale.y / 0.65);
    }
    const c = toLayer(at);
    const size = 2 * R * Z * k;
    const pic = new Sprite(tex);
    pic.width = pic.height = size;
    pic.position.set(c.x - size / 2, c.y - size / 2);
    pic.eventMode = "static";
    pic.on("pointertap", (e) => e.stopPropagation());
    box.addChild(pic, new Graphics().rect(c.x - size / 2, c.y - size / 2, size, size).stroke({ color: 0xffd34a, width: Math.max(2, 3 * k) }));
    pic.on("destroyed", () => tex.destroy(true));
    // Every hex's edge over the picture, so the exact hex and side can be picked.
    const grid = new Container();
    grid.position.set(c.x, c.y);
    grid.scale.set(Z * k);
    for (let h = 0; h < 17 * 11; h++) {
      const hc = hexCenter(h);
      if (Math.abs(hc.x - mid.x) > R - 14 || Math.abs(hc.y - mid.y) > R - 14) continue;
      const o = cellOrigin(h);
      const edge = hexRing(0xffffff);
      edge.alpha = 0.55;
      edge.position.set(o.x - mid.x, o.y - mid.y);
      grid.addChild(edge);
    }
    box.addChild(grid);
    for (const from of options) {
      // The ring goes in the middle of where ours would stand: a wide stack's spots right over the target,
      // over either side of it, and at its sides all get their own ring (a ring on the hex nearest the target
      // put two of them on one hex: the owner 2026-11-03).
      const mine = unitHexes(s, me, from);
      const hc = mine.map(hexCenter).reduce((a, c) => ({ x: a.x + c.x / mine.length, y: a.y + c.y / mine.length }), { x: 0, y: 0 });
      const a = mine[0];
      // Where a pointer picks this spot (the side of one of the target's hexes), so the hover agrees with the ring.
      const way = theirs.map((h) => ({ h, w: attackApproaches(s, me, t, h).find((w) => w.from === from) })).find((x) => x.w);
      const off = { x: at.x + (hc.x - mid.x) * Z, y: at.y + (hc.y - mid.y) * Z };
      if (Math.abs(off.x - at.x) > R * Z - 10 || Math.abs(off.y - at.y) > R * Z - 10) continue;
      const p = toLayer(off);
      const ring = new Graphics()
        .circle(0, 0, 19 * Z * k)
        .fill({ color: 0xffd34a, alpha: 0.25 })
        .stroke({ color: 0x000000, width: 5 * k })
        .circle(0, 0, 19 * Z * k)
        .stroke({ color: 0xffd34a, width: 3 * k });
      ring.position.set(p.x, p.y);
      ring.eventMode = "static";
      ring.cursor = "pointer";
      ring.label = `button: attack from hex ${a}`;
      ring.on("pointertap", (e) => {
        e.stopPropagation();
        this.closeDirections();
        const bc = hexCenter(way?.h ?? theirs[0]);
        const ap = way?.w ? approachPoint(way.h, way.w.dir) : hc;
        this.v.pointer = { x: bc.x + (ap.x - bc.x) * 0.4, y: bc.y + (ap.y - bc.y) * 0.4 };
        this.v.aim.refreshHover();
        if (this.v.aim.intent?.kind === "attack" && this.v.aim.intent.target.id === t.id && this.v.aim.intent.from !== from) this.v.aim.intent = { ...this.v.aim.intent, from };
        this.v.click();
      });
      box.addChild(ring);
    }
    const head = label(tr("Attack from which side?"), "medfont", [255, 230, 120], "center");
    head.scale.set(1.75 * k);
    head.position.set(c.x - head.width / 2, c.y - size / 2 - head.height - 4 * k);
    box.addChild(head);
    layer.addChild(box);
    this.directions = box;
    this.v.setHint(tr("Pick the side to attack from (tap elsewhere to cancel)"));
  }

  private closeDirections() {
    this.directions?.destroy({ children: true });
    this.directions = null;
  }

  /** Why none of ours can act now ("" when one can): the play log's account of a press that did nothing. */
  whyIdle(): string {
    if (!this.v.state) return "no battle drawn yet";
    if (this.v.animating) return `animations still playing (${this.v.pending.length} updates waiting)`;
    const u = activeUnit(this.v.state);
    if (!u) return "nobody is up";
    if (!this.v.mine(controlSide(u))) return `the other side's turn (unit ${u.id})`;
    if (actsByItself(this.v.state, u)) return `unit ${u.id} acts by itself`;
    return "";
  }

  /** Where the aim is, for the play log: the hex, the hint shown there. */
  private aimText(): string {
    const hex = hexAtPoint(this.v.pointer.x, this.v.pointer.y);
    return `hex ${hex}, ${this.v.aim.intent ? this.v.aim.intent.kind : "no action"}${this.v.hint ? `: ${this.v.hint.split("\n")[0]}` : ""}`;
  }

  /** Touch: the action the last tap previewed, waiting for a second tap. */
  armed: string | null = null;
  /** When a magnifier drag last ended in its move (its tap, if any, comes right after). */
  private dragDoneAt = -1e9;
  /** Touch: the last tap only looked (nothing to do there); its hover stays until the next tap. */
  peek = false;

  /** What a click would do now, as a key (null: nothing to confirm). */
  private intentKey(): string | null {
    const hex = hexAtPoint(this.v.pointer.x, this.v.pointer.y);
    if (this.v.casting) return hex >= 0 ? `cast:${hex}` : null;
    return this.v.myActive() && this.v.aim.intent ? intentKey(this.v.aim.intent) : null;
  }

  /** The stack whose cell of the queue strip is at this point (desktop and tablet; the phone's list is the touch layer's). */
  queueUnitAt(x: number, y: number): Unit | undefined {
    const id = this.v.queueSlots.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h)?.unit;
    return id === undefined ? undefined : this.v.state?.units.find((v) => v.id === id && v.count > 0);
  }

}
