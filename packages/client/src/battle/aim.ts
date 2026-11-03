// What the pointer means on the battle field: the action under it (intent.ts), its hexes shaded and its line, the
// cursor, the movement shadow, the outlines, a spell being aimed, HotA's alternate action (Alt, Shift).
import type { BattleView } from "./view.ts";
import { extra, settings } from "../settings.ts";
import { aimsAt, landsAnywhere, COMBAT_SPELLS, canTeleport, sacrificeable, mastery, spellTargets, type BattleState, type Unit, activeUnit, alive, expectedDamage, canFly, rangePenalty, wallPenalty, hexRow, reachable, stats, unitAt, unitHexes, WALL_HEX, TOWER_POS, controlSide, tacticsSpot, inTacticsZone, killedBy, hexCol, obstacleAt, placeHexes, heatStrokeArea, areaShooter, isPlayable, neighbours, alternateAction, type AlternateAction, areAdjacent, canShootAt, stackName } from "@heroes/core";
import { screenSize } from "../ui/screen.ts";
import { Container, Sprite } from "pixi.js";
import { loadDefOutline } from "../assets.ts";
import { type Intent as IntentAction, intentOf, pointingAt } from "./intent.ts";
import { cellOrigin, hexAtPoint } from "./layout.ts";
import { altTip } from "./altButton.ts";
import { OUTLINE_CYAN, OUTLINE_GOLD, hexRing, hexShape } from "./unitSprite.ts";
import { CombatCursor, combatCursor, swordFor } from "../cursors.ts";
import { tr, said, fmt, type Text } from "../i18n/index.ts";
import { PART_NAMES } from "./texts.ts";

type Intent = IntentAction | null;

/** A shooter that has used all its arrows (it fights hand to hand now). */
export const outOfArrows = (s: BattleState, u: Unit) => !u.machine && stats(s, u).shots > 0 && u.shots <= 0;

export class BattleAim {
  private readonly v: BattleView;
  constructor(v: BattleView) {
    this.v = v;
  }

  intent: Intent = null;
  private shift = false;
  readonly trackShift = (e: KeyboardEvent) => {
    if (e.key === "Alt") {
      // (Alt alone would open the browser's menu bar.)
      e.preventDefault();
      if (e.type === "keydown" && !e.repeat && !this.v.modals.open) this.toggleAlt();
    }
    if (e.shiftKey === this.shift) return;
    this.shift = e.shiftKey;
    this.refreshHover();
  };

  // ---- HotA's alternate action ----------------------------------------------
  // Shooters melee, Harpies stay; Faerie Dragons, Archangels, Pit Lords, Olgoi-Khorkhoi and
  // Dreadnoughts move or attack instead of using their power; Cyclopes leave the walls alone.

  /** Switched on (the button or Alt) for the stack whose turn it is; each stack's turn starts with it off. */
  alt = false;
  /** Whose turn `alt` belongs to (round and stack). */
  private altTurn = "";
  altKind(): AlternateAction | null {
    const s = this.v.state;
    const turn = s ? `${s.round}:${activeUnit(s)?.id}` : "";
    if (turn !== this.altTurn) {
      this.alt = false;
      this.altTurn = turn;
    }
    const u = this.v.myActive();
    return s && u && !this.v.myTactics() ? alternateAction(s, u) : null;
  }

  /** Is the alternate action in force: switched on, or Shift held (not for Magogs: their Shift aims at the ground)? */
  private altOn(): boolean {
    const s = this.v.state;
    const u = this.v.myActive();
    if (!s || !u || !this.altKind()) return false;
    return this.alt !== (this.shift && !areaShooter(s, u));
  }

  toggleAlt() {
    if (!this.altKind()) return;
    this.alt = !this.alt;
    this.v.bar.refreshAltButtons();
    // Over the button itself the line says what it does now.
    if (this.v.bar.barTip?.startsWith("Alternate action")) this.v.bar.barTip = altTip(this.altKind(), this.alt);
    this.refreshHover();
  }

  private async refreshOutline() {
    const s = this.v.state;
    const gen = ++this.outlineGen;
    // Only our stack waiting for orders glows (not the last one while the enemy moves).
    // In tactics, the stack being placed.
    const active = s ? (this.v.myTactics() ? (this.v.tacticSel ?? undefined) : this.v.myActive()) : undefined;
    this.v.arrowOf = active && extra("battleCues") && screenSize.touch ? active.id : null;
    this.v.turnArrow.visible = this.v.arrowOf !== null;
    for (const [id, sp] of this.v.sprites) {
      // The stacks the pointer is on, or that the action under it would touch, in cyan (VCMI's updateHoveredStacks).
      const u = active && id === active.id ? active : active && !this.v.animating && this.hoverIds.includes(id) ? s?.units.find((v) => v.id === id) : undefined;
      const frames = u && (await loadDefOutline(stats(s!, u).def));
      if (gen !== this.outlineGen) return;
      sp.setOutline(frames || null, u === active ? OUTLINE_GOLD : OUTLINE_CYAN);
    }
  }
  private outlineGen = 0;
  /** The stacks outlined in cyan: under the pointer, or what the action there would hit. */
  private hoverIds: number[] = [];

  /** Outline these stacks in cyan (none: clear), while it's our stack's turn and nothing moves. */
  private setHoverIds(units: (Unit | undefined)[]) {
    const ok = !this.v.animating && !!this.v.myActive() && !screenSize.touch;
    const ids = ok ? [...new Set(units.filter((x): x is Unit => !!x && alive(x) && !x.machine).map((x) => x.id))] : [];
    if (ids.length === this.hoverIds.length && ids.every((x, i) => x === this.hoverIds[i])) return;
    this.hoverIds = ids;
    void this.refreshOutline();
  }

  refreshShade() {
    this.v.bar.refreshCastButton();
    this.v.bar.refreshAltButtons();
    void this.refreshOutline();
    this.v.shade.removeChildren().forEach((c) => c.destroy());
    void this.v.bar.syncTacticsBar();
    if (this.v.myTactics() && this.v.state) {
      // The area the troops may be placed in, and the chosen stack's free spots.
      const s = this.v.state;
      const sel = this.v.tacticSel;
      for (let h = 0; h < 187; h++) {
        const ok = sel ? tacticsSpot(s, sel, h) : inTacticsZone(s, h);
        if (!ok) continue;
        this.v.shade.addChild(this.shadowAt(h));
      }
      // In the shade, not the hover layer: every tap clears that.
      if (sel) this.markHexes(unitHexes(s, sel), 0xffe070, 0.4, this.v.shade);
      return;
    }
    const u = this.v.myActive();
    if (!u || !this.v.state) return;
    // Movement shadow (combat options): where the active stack can go, its own hexes too, each hex
    // shaded once with the original's CCELLSHD.
    const colours = extra("battleColours");
    const own = new Set(unitHexes(this.v.state, u));
    const range = new Set<number>(colours ? [] : own);
    if (settings().battleMoveShadow) {
      const s = this.v.state;
      const reach = reachable(s, u);
      for (const h of reach.keys()) for (const x of unitHexes(s, u, h)) range.add(x);
      // The enemies it could strike or shoot this turn are shaded too (VCMI's rebuildBackgroundWithHexes: the
      // hexes of a unit it can attack from a reachable hex, or shoot).
      for (const t of this.targetsOf(s, u, reach)) for (const x of unitHexes(s, t)) range.add(x);
    }
    for (const x of range) this.v.shade.addChild(this.shadowAt(x));
    // With the grid off, HotA still draws the hexes' edges inside the shaded range (its screenshots: a grid
    // only where the stack can go).
    if (!colours && !settings().battleGrid && this.v.cellGrid) for (const x of range) {
      const o = cellOrigin(x);
      this.v.shade.addChild(Object.assign(new Sprite(this.v.cellGrid), { x: o.x, y: o.y, alpha: 0.5 }));
    }
    if (colours) for (const x of own) {
      const g = hexShape(0xffe070, 0.35);
      const o = cellOrigin(x);
      g.position.set(o.x, o.y);
      this.v.shade.addChild(g);
    }
  }

  /** The stacks the active one could strike (from a hex it reaches) or shoot this turn. */
  private targetsOf(s: BattleState, u: Unit, reach = reachable(s, u)): Unit[] {
    if (u.machine === "catapult" || u.machine === "tent") return [];
    return s.units.filter((t) => alive(t) && t.pos >= 0 && controlSide(t) !== controlSide(u) && (canShootAt(s, u, t) || (!u.machine && [...reach.keys()].some((h) => areAdjacent(s, u, h, t)))));
  }

  clearHover() {
    this.v.hover.removeChildren().forEach((c) => c.destroy());
    this.v.siege.mark(null);
    this.intent = null;
    this.setCursor(CombatCursor.Pointer);
  }

  /** The combat cursor the field shows now (the magnifier draws it on touch screens, which show none). */
  cursorNow: number = CombatCursor.Pointer;
  private setCursor(i: number) {
    this.cursorNow = i;
    this.v.app.canvas.style.cursor = combatCursor(i);
    // Pixi sets the canvas's cursor from the hovered object's after each move: entering the field
    // from a button or a closing window put back the plain arrow over the spell or sword cursor.
    this.v.root.cursor = combatCursor(i);
  }

  /** The original's hex shadow (CCELLSHD) on a hex; a drawn one without the game file. */
  private shadowAt(hex: number): Container {
    const o = cellOrigin(hex);
    const g = this.v.cellShadow ? Object.assign(new Sprite(this.v.cellShadow), { tint: 0x000000, alpha: 0.5 }) : hexShape(0x000000, 0.5);
    g.position.set(o.x, o.y);
    return g;
  }

  markHexes(hexes: number[], color: number, alpha: number, layer: Container = this.v.hover) {
    // The original's cursor shadow only shades the hexes; colours are an extra.
    if (layer === this.v.hover && !extra("battleColours")) {
      for (const h of hexes) layer.addChild(this.shadowAt(h));
      return;
    }
    for (const h of hexes) {
      const g = hexShape(color, alpha);
      const o = cellOrigin(h);
      g.position.set(o.x, o.y);
      layer.addChild(g);
    }
  }

  /**
   * Pointing at a portrait in the turn queue picks out its stack on the field: its hexes lit, where
   * it could move, and its line below (as pointing at the stack itself).
   */
  private markQueued(s: BattleState): boolean {
    this.v.queueMark.removeChildren();
    const { x, y } = this.v.pointer;
    const id = this.v.queuePointed ?? this.v.queueSlots.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h)?.unit;
    const u = id === undefined ? undefined : s.units.find((v) => v.id === id && v.count > 0);
    if (!u) return false;
    this.markHexes(unitHexes(s, u), 0xffe070, 0.6, this.v.queueMark);
    for (const h of unitHexes(s, u)) this.v.queueMark.addChild(Object.assign(hexRing(0xffffff), cellOrigin(h)));
    if (!this.v.animating && !u.machine) this.markRange(s, u);
    this.v.setHint(this.v.texts.describe(u));
    return true;
  }

  /** Where a hovered stack could move: outlined so it reads on top of our own range. */
  private markRange(s: BattleState, u: Unit) {
    const color = u.side === 0 ? 0x60c0ff : 0xff5040;
    const seen = new Set<number>();
    for (const h of reachable(s, u).keys()) {
      for (const x of unitHexes(s, u, h)) {
        if (seen.has(x)) continue;
        seen.add(x);
        // The original shades the pointed-at stack's range like the movement shadow.
        if (!extra("battleColours")) {
          this.v.hover.addChild(this.shadowAt(x));
          continue;
        }
        const g = hexRing(color);
        const o = cellOrigin(x);
        g.position.set(o.x, o.y);
        this.v.hover.addChild(g);
      }
    }
  }

  refreshHover() {
    this.hoverUnits = [];
    this.refreshHoverInner();
    this.setHoverIds(this.hoverUnits);
    this.shadeSpellTargets();
    const hex = hexAtPoint(this.v.pointer.x, this.v.pointer.y);
    void this.v.info.showStackPanel(this.v.state && hex >= 0 ? unitAt(this.v.state, hex) : undefined);
  }

  /** While a spell is chosen, every stack it could be cast on, shaded (EXTRAS spellTargets). */
  readonly spellShade = new Container();
  private spellShadeKey = "";
  private shadeSpellTargets() {
    const s = this.v.state;
    const c = this.v.casting;
    const u = this.v.myActive();
    const shape = c && COMBAT_SPELLS[c.spell.id]?.shape;
    // Spells aimed at one stack (and Sacrifice's or Teleport's first pick); not once that pick is made.
    const on = !!s && !!c && !!u && !c.unit && !this.v.animating && extra("spellTargets") && (shape === "single" || shape === "sacrifice" || shape === "teleport");
    const key = on ? `${c.spell.id}:${s.round}:${s.active}:${s.log.length}` : "";
    if (key === this.spellShadeKey) return;
    this.spellShadeKey = key;
    this.spellShade.removeChildren().forEach((x) => x.destroy());
    if (!on) return;
    const side = controlSide(u);
    for (const v of s.units) {
      if (v.pos < 0 || !spellTargets(s, side, c.spell, v.pos).includes(v)) continue;
      for (const h of unitHexes(s, v)) this.spellShade.addChild(this.shadowAt(h));
    }
  }

  private hoverUnits: (Unit | undefined)[] = [];

  private refreshHoverInner() {
    this.clearHover();
    if (this.v.bar.barTip) return this.v.setHint(said(this.v.bar.barTip));
    const s = this.v.state;
    if (s && this.markQueued(s)) return;
    const u = this.v.myActive();
    // A siege tower's picture rises above the field's hexes (the upper tower's above the top row): over it, its hex.
    const g = s?.siege && this.v.pointer.x >= 0 ? this.v.root.toGlobal(this.v.pointer) : null;
    const towerPicture = g ? this.v.siege.towerPictureAt(g.x, g.y) : null;
    const pointed = hexAtPoint(this.v.pointer.x, this.v.pointer.y);
    const hex = pointed < 0 && towerPicture ? WALL_HEX[towerPicture] : pointed;
    // Over a commanding hero: the helmet (as VCMI's BattleHero::hover); a click on ours opens the book.
    // (The field's edge columns, where nobody stands, are under the heroes' boxes.)
    if (s && (hex < 0 || hex % 17 === 0 || hex % 17 === 16) && !this.v.casting && this.v.heroes.heroAtPoint(this.v.pointer.x, this.v.pointer.y) !== null) {
      this.setCursor(CombatCursor.Hero);
      // GENRLTXT 417 "View Hero Stats" (VCMI's HeroInfoEntry::preview).
      return this.v.setHint(this.v.texts.line(417).trim());
    }
    if (!s || hex < 0) return this.v.setHint(this.v.texts.idleHint());
    if (this.v.casting && !this.v.animating) {
      // The pointed-at stack's reach shows while a spell is aimed at it too (VCMI's getMovementRangeForHoveredStack,
      // whatever the action), as while a shot or a blow is.
      const other = unitAt(s, hex);
      if (other && other !== u && alive(other) && !other.machine) this.markRange(s, other);
      if (this.hoverSpell(s, hex)) return;
      this.v.hover.removeChildren().forEach((c) => c.destroy());
    }
    // Arranging troops (VCMI's TacticsUnitSelectionEntry and the move entry): our stacks answer to the pointer cursor and
    // GENRLTXT 481 "Select %s", a free spot in the zone to the move cursor, anything else to the blocked one.
    if (this.v.myTactics() && !this.v.animating) {
      const at = unitAt(s, hex);
      const sel = this.v.tacticSel;
      if (at && at.side === s.tactics!.side && !at.machine) {
        const who = stackName(s, at);
        this.setCursor(CombatCursor.Pointer);
        return this.v.setHint(this.v.texts.line(481, who).trim());
      }
      // An enemy stack pointed at (or held, or tapped): how far it reaches, as in battle (2026-10-30: the
      // tactics phase is when where they can get to matters most).
      if (at && at.side !== s.tactics!.side && alive(at) && !at.machine) {
        this.markRange(s, at);
        this.setCursor(CombatCursor.Blocked);
        return this.v.setHint(this.v.texts.describe(at));
      }
      if (sel && tacticsSpot(s, sel, hex)) {
        if (!screenSize.touch) this.markHexes(unitHexes(s, sel, hex), 0xffffff, 0.3);
        this.setCursor(CombatCursor.Move);
        const who = stackName(s, sel);
        return this.v.setHint(this.v.texts.line(294, who));
      }
      this.setCursor(CombatCursor.Blocked);
      return this.v.setHint(this.v.texts.idleHint());
    }
    const alt = this.altOn();
    const p = pointingAt(s, u, { hex, pointer: this.v.pointer, alt, shift: this.shift, animating: this.v.animating, towerPicture });
    this.intent = intentOf(p);
    // Over a built siege tower the question cursor and GENRLTXT 156 (VCMI's onHexHovered), unless the catapult aims at it.
    if (p.kind !== "wall" && this.towerAtHex(s, hex)) {
      this.setCursor(CombatCursor.Query);
      return this.v.setHint(this.v.texts.line(156));
    }
    // A stack pointed at shows how far it reaches, also while ours aims a shot or a blow at it (VCMI's
    // getMovementRangeForHoveredStack; A player, 2026-10-26: HotA shows it when aiming), not while placing ours
    // in the tactics phase.
    const other = unitAt(s, hex);
    this.hoverUnits.push(other, ...(p.kind === "shootHex" ? p.hit : []));
    const placing = this.v.myTactics() && other?.side === s.tactics?.side;
    if (other && other !== u && !this.v.animating && !placing && p.kind !== "wall" && p.kind !== "heal" && !(p.kind === "blocked" && p.machine)) this.markRange(s, other);
    switch (p.kind) {
      case "wall":
        this.setCursor(CombatCursor.Catapult);
        // Touch has no cursor: the aimed part lights up gold, as the touch preview does for stacks.
        if (screenSize.touch) this.v.siege.mark(p.part);
        return this.v.setHint(tr(`Attack the %1 (%2% to hit)`, PART_NAMES[p.part], p.chance));
      case "heal":
        this.setCursor(CombatCursor.Heal);
        // GENRLTXT 419 "Apply first aid to the %s".
        return this.v.setHint(this.v.texts.line(419, stackName(s, p.target)));
      case "heatStroke":
        this.markHexes(heatStrokeArea(s, u!, hex), 0xff6020, 0.45);
        this.v.setHint(tr(`%1 unleash a Heat Stroke here (no retaliation; it burns friends too)`, stats(s, u!).plural));
        return this.setCursor(CombatCursor.Spell);
      case "creatureCast": {
        const { spells, target } = p;
        if (target) this.markHexes(unitHexes(s, target), 0x60a0ff, 0.45);
        const what = spells.length > 1 ? tr("a random spell") : spells[0].key === "summonDemons" ? tr("Raise Demons") : spells[0].name;
        this.setCursor(CombatCursor.Spell);
        if (spells[0].key.startsWith("detonates")) return this.v.setHint(tr(`Ignite the %1: they detonate as they fall (no turn spent, can't be undone)`, stats(s, u!).plural));
        // GENRLTXT 301 "Cast a spell on %s" (a Genie's random one), 27 "Cast %s on %s", 26 "Cast %s".
        const on = target && stackName(s, target);
        return this.v.setHint(
          spells.length > 1 && on
            ? this.v.texts.line(301, on)
            : on
              ? this.v.texts.line(27, what, on)
              : this.v.texts.line(26, what),
        );
      }
      case "shoot": {
        const other = p.target;
        this.markHexes(unitHexes(s, other), 0xff4030, 0.45);
        // GENRLTXT 296 (shoot, shots left, damage, kills), 37 with one shot left.
        const [dmg, kills] = this.preview(u!, other, true, 0);
        const them = stackName(s, other);
        this.v.setHint(u!.shots === 1 ? this.withKills(this.v.texts.line(37, them, dmg, kills), 37, 3, kills) : this.withKills(this.v.texts.line(296, them, u!.shots, dmg, kills), 296, 4, kills));
        // The broken arrow when the shot does half damage (distance; or a wall, at a siege).
        return this.setCursor(rangePenalty(s, u!, other) || wallPenalty(s, u!, other) ? CombatCursor.ShootPenalty : CombatCursor.Shoot);
      }
      case "outOfReach":
        // A shooter with no arrows left can't reach far targets: say why, not just "out of reach".
        this.v.setHint(extra("battleCues") && outOfArrows(s, u!) ? tr(`%1 — out of reach, no arrows left`, this.v.texts.describe(p.target)) : tr(`%1 — out of reach`, this.v.texts.describe(p.target)));
        return this.setCursor(CombatCursor.Blocked);
      case "attack": {
        const { target: other, from } = p;
        this.markHexes(unitHexes(s, other), 0xff4030, 0.45);
        this.markHexes(unitHexes(s, u!, from), 0xffe070, 0.4);
        // (No keys on a touch screen: just what happens.)
        const after = !p.returns ? said("") : fmt` ${p.stay ? tr("and stay") : screenSize.touch ? tr("and return") : tr("and return (Alt: stay)")}`;
        // A shooter that could shoot, hand to hand (its alternate action).
        const melee = p.melee ? ` ${tr("hand to hand")}` : "";
        // GENRLTXT 36 (attack, with damage and kills); a Harpy's return or stay (HotA's alternate action) after it, ours.
        const [dmg, kills] = this.preview(u!, other, false, p.dist);
        const them = `${stackName(s, other)}${melee}`;
        this.v.setHint(fmt`${this.withKills(this.v.texts.line(36, them, dmg, kills), 36, 3, kills)}${after}`);
        // Sword points from the side picked toward the pointed hex (straight down or up for a wide stack centred over it).
        return this.setCursor(swordFor(p.blow.from, p.blow.to));
      }
      case "shootHex": {
        this.markHexes([hex, ...neighbours(hex)], 0xff4030, 0.3);
        const friends = p.hit.filter((x) => controlSide(x) === controlSide(u!)).length;
        this.v.setHint(tr(`Shoot at the ground here: the blast hits %1 %2%3 (%4 shots left)`, p.hit.length, p.hit.length === 1 ? tr("stack") : tr("stacks"), friends ? tr(` (%1 of ours)`, friends) : "", u!.shots));
        return this.setCursor(CombatCursor.Shoot);
      }
      case "move": {
        this.markHexes(unitHexes(s, u!, p.to), 0xffffff, 0.3);
        // GENRLTXT 294 / 295 "Move %s here." / "Fly %s here.".
        const who = stackName(s, u!);
        this.v.setHint(canFly(s, u!) ? this.v.texts.line(295, who) : this.v.texts.line(294, who));
        return this.setCursor(canFly(s, u!) ? CombatCursor.Fly : CombatCursor.Move);
      }
      case "look":
        if (p.query) this.setCursor(CombatCursor.Query);
        return this.v.setHint(p.target ? this.v.texts.describe(p.target) : this.v.texts.idleHint());
      case "blocked":
        this.v.setHint(this.v.texts.idleHint());
        return this.setCursor(CombatCursor.Blocked);
    }
  }

  /** The arrow tower whose hex this is (VCMI's isTowerHex: only towers the town has; a fallen one still answers). */
  towerAtHex(s: BattleState, hex: number): Unit | undefined {
    const part = (["keep", "bottomTower", "upperTower"] as const).find((p) => WALL_HEX[p] === hex);
    return part && s.siege ? s.units.find((x) => x.machine === "tower" && x.pos === TOWER_POS[part]) : undefined;
  }

  /** The kills put back into a line whose translation dropped them (the Polish release's attack and shot lines, from
   *  before HotA added them: the owner 2026-10-27, "show both damage and kills"): inside its closing bracket. */
  private withKills(text: Text, id: number, values: number, kills: string): Text {
    if (this.v.texts.shows(id) >= values) return text;
    const k = tr("kills: %1", kills);
    return /\)\s*$/.test(text) ? said(text.replace(/\)\s*$/, `, ${k})`)) : fmt`${text} (${k})`;
  }

  /** The damage and kills a blow would do, as VCMI's estimates read: "min - max", one figure when they agree. */
  private preview(a: Unit, d: Unit, ranged: boolean, moved: number): [string, string] {
    const s = this.v.state!;
    const { min, max } = expectedDamage(s, a, d, ranged, moved);
    // "767-920", as HotA writes it.
    const span = (lo: number, hi: number) => (lo === hi ? String(lo) : `${lo}-${hi}`);
    return [span(min, max), span(killedBy(s, d, min), killedBy(s, d, max))];
  }

  /** While aiming: show who the spell would hit. Returns true when it handled the hover. */
  private hoverSpell(s: BattleState, hex: number): boolean {
    const c = this.v.casting;
    const u = this.v.myActive();
    if (!c || !u) return false;
    if (c.unit && COMBAT_SPELLS[c.spell.id]?.shape === "sacrifice") {
      // Sacrifice: now the living stack of ours to give up.
      const v = unitAt(s, hex);
      const ok = sacrificeable(s, controlSide(u), v, c.unit);
      if (v) this.markHexes(unitHexes(s, v), ok ? 0xff6040 : 0x808080, 0.35);
      this.hoverUnits.push(v);
      this.setCursor(ok ? CombatCursor.Sacrifice : CombatCursor.Blocked);
      // GENRLTXT 549 "Sacrifice the %s", else 543 "Choose an army to sacrifice".
      this.v.setHint(ok ? this.v.texts.line(549, stackName(s, v!)).trim() : tr("%1 (%2 to cancel)", this.v.texts.line(543).trim(), screenSize.touch ? tr("hold") : tr("Esc")));
      return true;
    }
    if (c.unit) {
      // Teleport: pick a free spot (in a siege not across the walls or the moat below expert).
      const ok = this.teleportOk(s, c, hex);
      this.markHexes(unitHexes(s, c.unit, hex), ok ? 0x60c0ff : 0xff3020, 0.35);
      this.setCursor(ok ? CombatCursor.Teleport : CombatCursor.Blocked);
      // GENRLTXT 25 "Teleport Here", 24 "Invalid Teleport Destination" (VCMI's teleport.lua).
      this.v.setHint(ok ? this.v.texts.line(25).trim() : tr("%1 (%2 to cancel)", this.v.texts.line(24).trim(), screenSize.touch ? tr("hold") : tr("Esc")));
      return true;
    }
    const side = controlSide(u);
    const shape = COMBAT_SPELLS[c.spell.id]?.shape;
    if (shape === "place" || shape === "obstacle") {
      const m = mastery(s, side, c.spell);
      const hexes = shape === "place" ? placeHexes(s, side, hex, m) : obstacleAt(s, hex, m) >= 0 ? [hex] : [];
      this.markHexes(hexes.length ? hexes : [hex], hexes.length ? 0x60c0ff : 0xff3020, 0.35);
      this.setCursor(hexes.length ? CombatCursor.Spell : CombatCursor.Blocked);
      // GENRLTXT 550 "Remove this obstacle", 26 "Cast %s"; where a wall can't stand, 181 "No room to place %s here" (VCMI's describeTargetStep).
      const blocked = shape === "place" ? this.v.texts.line(181, c.spell.name).trim() : tr("%1: choose %2 (%3 to cancel)", c.spell.name, tr("an obstacle"), screenSize.touch ? tr("hold") : tr("Esc"));
      this.v.setHint(hexes.length ? (shape === "obstacle" ? this.v.texts.line(550) : this.v.texts.line(26, c.spell.name)).trim() : blocked);
      return true;
    }
    const targets = spellTargets(s, side, c.spell, hex);
    // Fireball, Inferno, Frost Ring and Meteor Shower land on any hex of the field, touching someone or not.
    const anyHex = landsAnywhere(c.spell.id) && hex >= 0 && isPlayable(hexCol(hex), hexRow(hex));
    this.setCursor(targets.length || anyHex || COMBAT_SPELLS[c.spell.id]?.shape === "all" ? CombatCursor.Spell : CombatCursor.Blocked);
    for (const t of targets) this.markHexes(unitHexes(s, t), COMBAT_SPELLS[c.spell.id]?.who === "friend" ? 0x60ff80 : 0xff6040, 0.35);
    this.hoverUnits.push(...targets);
    // GENRLTXT 27 "Cast %s on %s" over the one stack it would touch, 26 "Cast %s" for an area.
    const one = targets.length === 1 && shape === "single" ? targets[0] : undefined;
    const who = one && stackName(s, one);
    // Over no target, GENRLTXT 23 "Select Spell Target" (VCMI's blocked text for a creature spell); a touch
    // screen, with no Esc or right button, also says how to drop the spell.
    const select = screenSize.touch ? tr("%1 (%2 to cancel)", this.v.texts.line(23).trim(), tr("hold")) : this.v.texts.line(23).trim();
    this.v.setHint(targets.length || anyHex ? (who ? this.v.texts.line(27, c.spell.name, who) : this.v.texts.line(26, c.spell.name)).trim() : select);
    return true;
  }

  /** Where the stack being teleported may land: a hero's spell by its mastery, the Jotunns' at expert. */
  private teleportOk(s: BattleState, c: NonNullable<typeof this.v.casting>, hex: number): boolean {
    const u = this.v.myActive();
    return !!c.unit && !!u && canTeleport(s, c.unit, hex, c.creature ? 3 : mastery(s, controlSide(u), c.spell));
  }

  clickSpell(hex: number): boolean {
    const c = this.v.casting;
    const u = this.v.myActive();
    const s = this.v.state;
    if (!c || !u || !s) return false;
    if (COMBAT_SPELLS[c.spell.id]?.shape === "sacrifice") {
      if (!c.unit) {
        const fallen = spellTargets(s, controlSide(u), c.spell, hex)[0];
        if (fallen) {
          c.unit = fallen;
          this.refreshHover();
        }
        return true;
      }
      const v = unitAt(s, hex);
      if (!sacrificeable(s, controlSide(u), v, c.unit)) return true;
      this.v.sendAction({ type: "cast", unit: u.id, spell: c.spell.id, target: c.unit.pos, dest: hex });
    } else if (COMBAT_SPELLS[c.spell.id]?.shape === "teleport") {
      if (!c.unit) {
        const who = spellTargets(s, controlSide(u), c.spell, hex)[0];
        if (who) {
          c.unit = who;
          this.refreshHover();
        }
        return true;
      }
      if (!this.teleportOk(s, c, hex)) return true;
      if (c.creature) this.v.sendAction({ type: "creatureCast", unit: u.id, target: c.unit.pos, dest: hex });
      else this.v.sendAction({ type: "cast", unit: u.id, spell: c.spell.id, target: c.unit.pos, dest: hex });
    } else {
      if (!aimsAt(s, controlSide(u), c.spell, hex)) return true;
      this.v.sendAction({ type: "cast", unit: u.id, spell: c.spell.id, target: hex });
    }
    this.v.casting = null;
    return true;
  }

}
