// The battle's bar (CBAR with HotA's slot for the alternate action) and its buttons, each built for the bar and
// again for the touch layout; greying them as the original; the tactics phase's bar.
import type { MenuItem } from "./touchLayout.ts";
import type { BattleView } from "./view.ts";
import { extra } from "../settings.ts";
import { fleeBlock, type Side } from "@heroes/core";
import { phoneSized, screenSize } from "../ui/screen.ts";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { gameTexts } from "../ui/highScores.ts";
import { DefButton, loadImagePlayer, buttonHelp, helpRow, loadButtonHelp, textButton } from "../ui/kit.ts";
import { messageBox } from "../ui/dialogs.ts";
import { loadDef, loadImage } from "../assets.ts";
import { BAR_Y } from "./layout.ts";
import { setPopupPlayer } from "../ui/creatureInfo.ts";
import { AltButton, altHelp, altTip, loadAltButton } from "./altButton.ts";
import { holdTip } from "../ui/holdTip.ts";
import { CBAR, CPRESULT, cut, partTexture } from "../ui/blocks/windowParts.ts";
import { tr, said, type Text } from "../i18n/index.ts";
import { logPicture } from "./logWindow.ts";
import { outOfArrows } from "./aim.ts";

/** The bar's buttons greyed now (VCMI's blockUI): a tap does nothing, a hold still says what they do. */
const greyed = new WeakSet<Container>();

/** HotA's bar: the log's arrows and Cast sit one slot (51 pixels) left of SoD's, for the alternate action's button. */
const ALT_SHIFT = 51;

export class BattleBar {
  private readonly v: BattleView;
  constructor(v: BattleView) {
    this.v = v;
  }

  /** The bar's button and its big copy for touch screens. */
  private altButtons: AltButton[] = [];

  refreshAltButtons() {
    const kind = this.v.aim.altKind();
    const u = this.v.myActive();
    const empty = !!this.v.state && !!u && !kind && extra("battleCues") && outOfArrows(this.v.state, u);
    for (const b of this.altButtons) b.show(kind, this.v.aim.alt, empty);
  }

  /** CBAR with HotA's moved console end, the buttons and the log line. */
  async buildBar(bar: Texture) {
    this.v.barLayer.removeChildren();
    const barSprite = new Sprite(bar);
    // CBAR at (1, 555) as VCMI's battleWindow2.
    barSprite.position.set(1, BAR_Y - 1);
    this.v.barLayer.addChild(barSprite);
    // HotA's bar has a slot for the alternate action between Cast and Wait, the log's arrows and the
    // console a slot further left (HotA.lod's own CBAR): the original's console end, arrows and Cast
    // slot (617-695) moved 51 to the left over the console, the Cast slot left where it was for the new button.
    const moved = new Sprite(cut(bar, CBAR.parts.consoleEnd));
    moved.position.set(1 + CBAR.parts.consoleEnd.x - ALT_SHIFT, BAR_Y - 1);
    this.v.barLayer.addChild(moved);
    this.barSprites = [barSprite, moved];
    await this.buildButtons();
    this.v.consoleText.position.set(215, BAR_Y + 6);
    this.v.barLayer.addChild(this.v.consoleText);
  }

  /** CBAR's two sprites (the whole bar, its moved console end), recoloured once the battle's watcher is known. */
  private barSprites: Sprite[] = [];
  /**
   * The bar in the colour of the player watching (the original colours CBAR's rims for them), and the phone's
   * rooms in its console's box.
   */
  async colourBar(player: number) {
    // (The battle's windows and pages in the same colour: the player at this screen.)
    setPopupPlayer(player);
    await this.v.initialised;
    const [whole, console, ground, portraitBox] = await Promise.all([
      loadImagePlayer(CBAR.file, player).catch(() => null),
      partTexture(CBAR, "console", player),
      loadImage("diboxbck.pcx").catch(() => null),
      partTexture(CPRESULT, "portrait", player),
    ]);
    if (this.v.root.destroyed) return;
    const [bar, moved] = this.barSprites;
    if (whole && bar && moved && whole.width >= CBAR.w) {
      bar.texture = whole;
      moved.texture = cut(whole, CBAR.parts.consoleEnd);
    }
    this.v.touch.player = player;
    this.v.touch.setConsole({ console, ground, portraitBox });
    if (ground) this.v.ground.texture = ground;
    this.v.placeGround();
  }

  private async buildButtons() {
    // Original button art: icm00N.def, frame 0 normal, 1 pressed; positions from VCMI's battleWindow2,
    // the right-hand group as HotA's bar: Cast, the alternate action, Wait, Defend.
    await loadAltButton();
    this.altButtons = [];
    const buttons: [string, number, string, () => void][] = [
      ["icm003.def", 4, "Combat options: hex grid, shadows, animation speed, volume", () => void this.v.openOptions()],
      ["icm001.def", 55, "Surrender: pay gold to keep your army", () => void this.v.giveUp(true)],
      ["icm002.def", 106, "Retreat: the hero escapes, the army is lost", () => void this.v.giveUp(false)],
      ["icm004.def", 157, "Auto combat: let the AI play this battle (A; again to take over); Q: quick combat, no animations", () => this.v.toggleAuto()],
      ["icm005.def", 646 - ALT_SHIFT, "Cast a spell (C)", () => this.v.openSpellbook()],
      ["alt", 646, "Alternate action (Alt)", () => this.v.aim.toggleAlt()],
      ["icm006.def", 697, "Wait (W)", () => this.v.act("wait")],
      ["icm007.def", 748, "Defend (D)", () => this.v.act("defend")],
    ];
    this.v.touch.reset();
    this.barTip = null;
    this.fleeButtons = [];
    this.castButtons = [];
    this.waitButtons = [];
    this.defendButtons = [];
    // Phones: the left-hand group behind one Menu button (they're seldom used; the room shows the turn instead).
    // (Behind the tiles, everything the desktop bar's left-hand group does, and Undo; the animation speed is in Combat
    // Options, as on a desktop: the owner 2026-11-02 19:27.)
    const NAMES: Record<string, Text> = { "icm003.def": tr("Combat Options"), "icm001.def": tr("Surrender"), "icm002.def": tr("Retreat"), "icm004.def": tr("Auto combat") };
    const menu: MenuItem[] = buttons.filter(([def]) => NAMES[def]).map(([def, , , fn]) => ({ name: NAMES[def], def, fn }));
    // Undo (EXTRAS battleUndo) first, in the menu a phone opens first (2026-11-02 18:37: not behind Options).
    menu.unshift({ name: tr("Undo"), def: "", fn: () => void this.v.undo(), live: () => this.v.undoable(), shown: () => this.v.undoOffered() });
    // The whole battle's log (EXTRAS battleLog), after Undo: what happened, every effect, to read back (2026-11-02 20:13).
    menu.splice(1, 0, { name: tr("Battle log"), def: "", picture: logPicture, fn: () => void this.v.openLog(), shown: () => extra("battleLog") });
    this.v.touch.onOpenLog = extra("battleLog") ? () => void this.v.openLog() : null;
    // (Not the page's own menu: its ☰ is always on the layer above, so the game's windows never lead to it: the owner 2026-10-27.)
    await this.v.touch.setMenu(menu);
    // Upright: Feedback in the row of buttons (the page's own is hidden there).
    // The rollover texts are HELP.TXT's (379-387: "Surrender", "Cast Spell"...); ours, with the keys, without it.
    await loadButtonHelp();
    for (const [def, x, ours, fn] of buttons) {
      if (def === "alt") {
        // A hold: the stack whose turn it is, what it does now and what a press makes it do (its ability by name).
        const altWords = () => {
          const s = this.v.state;
          const u = this.v.myActive();
          return altHelp(s, u, this.v.aim.altKind(), this.v.aim.alt, screenSize.touch, !!s && !!u && extra("battleCues") && outOfArrows(s, u));
        };
        const make = () => {
          const b = new AltButton(fn);
          b.on("pointerover", (e) => {
            const t = altTip(this.v.aim.altKind(), this.v.aim.alt, screenSize.touch);
            if (e.pointerType === "mouse") this.barTip = t;
            this.v.setHint(t);
          });
          b.on("pointerout", () => ((this.barTip = null), this.v.setHint(this.v.texts.idleHint())));
          holdTip(b, altWords);
          this.altButtons.push(b);
          return b;
        };
        const b = make();
        b.position.set(x, BAR_Y + 4);
        if (screenSize.touch) {
          const hit = new Graphics().rect(x - 1.5, BAR_Y, 51, 50).fill({ color: 0, alpha: 0.001 });
          hit.label = b.label;
          hit.eventMode = "static";
          hit.on("pointerdown", () => b.press(true));
          hit.on("pointerup", () => b.press(false));
          hit.on("pointerupoutside", () => b.press(false));
          hit.on("pointertap", fn);
          holdTip(hit, altWords);
          this.v.barLayer.addChild(hit);
        }
        this.v.barLayer.addChild(b);
        this.v.touch.addButton(make(), 1);
        continue;
      }
      const tip = buttonHelp(def)?.hover || said(ours);
      // A hold (the right button): the original's right-click words (HELP.TXT), else the tip.
      const help = () => buttonHelp(def)?.help || tip;
      try {
        const frames = (await loadDef(def)).get(0) ?? [];
        const make = () => {
          const b = new Sprite(frames[0].texture);
          b.eventMode = "static";
          b.cursor = "pointer";
          b.on("pointerdown", (e) => e.button === 0 && !greyed.has(b) && frames[1] && (b.texture = frames[1].texture));
          b.on("pointerup", () => !greyed.has(b) && (b.texture = frames[0].texture));
          b.on("pointerupoutside", () => !greyed.has(b) && (b.texture = frames[0].texture));
          b.on("pointertap", () => !greyed.has(b) && fn());
          holdTip(b, help);
          // Named for scripts and voice notes (heroes.press("Wait")): the tip's words before any key or colon.
          b.label = `button: ${ours.replace(/[:(].*/, "").trim()}`;
          // Kept in barTip: the field's own pointermove (it bubbles up from here) would put the
          // turn's line back over it at once.
          b.on("pointerover", (e) => {
            if (e.pointerType === "mouse") this.barTip = tip;
            this.v.setHint(tip);
          });
          b.on("pointerout", () => ((this.barTip = null), this.v.setHint(this.v.texts.idleHint())));
          return b;
        };
        const b = make();
        b.position.set(x, BAR_Y + 4);
        // Touch screens that keep the bar (a 4:3 tablet): each button takes a finger's tap, from its
        // neighbours' edges and down into the band under the bar (the art stays the original's).
        if (screenSize.touch) {
          const hit = new Graphics().rect(x - 1.5, BAR_Y, 51, 50).fill({ color: 0, alpha: 0.001 });
          hit.label = b.label;
          hit.eventMode = "static";
          hit.on("pointerdown", (e) => e.button === 0 && !greyed.has(b) && frames[1] && (b.texture = frames[1].texture));
          hit.on("pointerup", () => !greyed.has(b) && (b.texture = frames[0].texture));
          hit.on("pointerupoutside", () => !greyed.has(b) && (b.texture = frames[0].texture));
          hit.on("pointertap", () => !greyed.has(b) && fn());
          holdTip(hit, help);
          this.v.barLayer.addChild(hit);
        }
        this.v.barLayer.addChild(b);
        // The left-hand group (options, surrender, retreat, auto) and the right-hand one (cast, wait, defend).
        const side = x < 400 ? 0 : 1;
        const copy = make();
        this.v.touch.addButton(copy, side);
        // Both copies grey out together (the bar's and the touch layout's).
        for (const sprite of [b, copy]) {
          if (def === "icm005.def") this.castButtons.push({ sprite, frames });
          if (def === "icm006.def") this.waitButtons.push({ sprite, frames });
          if (def === "icm007.def") this.defendButtons.push({ sprite, frames });
          if (def === "icm001.def" || def === "icm002.def") this.fleeButtons.push({ surrender: def === "icm001.def", sprite, frames });
        }
      } catch {
        // Missing art shouldn't block the battle; keyboard shortcuts still work.
      }
    }
    // The log's arrows beside the console (VCMI's battleWindow2: ComSlide at 625,560 / 625,579; a slot left on HotA's bar).
    for (const [y, order, d] of [[560, [0, 1, 0, 0], 1], [579, [2, 3, 2, 2], -1]] as const) {
      const b = new DefButton("comslide.def", 625 - ALT_SHIFT, BAR_Y + (y - 556), -1, [...order]);
      b.onClick = () => this.v.texts.scrollLog(d);
      this.v.barLayer.addChild(b);
    }
    // Touch: quick combat (Q on a keyboard) under auto combat.
    if (this.v.onAuto) {
      const quick = await textButton(tr("Quick"), 48, 36, () => this.v.quickCombat(), "medfont");
      holdTip(quick, () => tr("Quick combat: the rest of this battle is played out at once, without animations (Q)."));
      this.v.touch.addButton(quick, 0);
    }
    this.refreshAltButtons();
    this.layoutSides();
  }

  /**
   * Upright the page's menu is the battle's own and Feedback sits at the foot (style.css ownButtons), also under a
   * window (2026-10-27: moved to the top for a window they covered the heroes' portraits; the windows keep clear
   * of them wherever they are, Modals.bigRoom).
   */
  ownButtons() {
    // (Not once the result is closed: what comes next, a level gained, has the page's buttons where they always are.)
    document.body.classList.toggle("ownButtons", screenSize.portrait && screenSize.touch && !this.v.ended);
  }

  private tacticsBar: Container | null = null;

  /** COPLACBR with Next (ICM011) and Start battle (ICM012), as long as the phase lasts. */
  async syncTacticsBar() {
    // Kept while a placed stack flies to its spot (myTactics() is false meanwhile): taking it down
    // then dropped the stack being placed and raced the touch layer's buttons.
    const t = this.v.state?.tactics;
    const on = !!t && this.v.mine(t.side);
    if (!on) {
      if (this.tacticsBar) void this.v.touch.setTactics(null);
      this.tacticsBar?.destroy({ children: true });
      this.tacticsBar = null;
      this.v.tacticSel = null;
      return;
    }
    if (this.tacticsBar) return;
    // The phase begins: say so, and pick the first stack to place (it glows gold, its spots shaded).
    void this.v.touch.setTactics({ next: () => this.v.nextTacticUnit(), end: () => this.v.endTactics() });
    this.tacticsHintOnce(this.v.state!.sides[this.v.state!.tactics!.side].owner ?? 0);
    this.v.setHint(screenSize.touch ? tr("Tactics: tap a stack, then where it should stand (tap again to place it). Start the battle when ready.") : tr("Tactics: click a stack, then where it should stand; Start the battle when ready."));
    // The bar is ours before anything that comes back here (picking the first stack refreshes the
    // shade, which syncs the bar again): a second one was built, never taken down, over the battle's buttons.
    const bar = new Container();
    this.tacticsBar = bar;
    const side = this.v.state!.tactics!.side;
    const player = this.v.state!.sides[side].owner ?? side;
    if (!this.v.tacticSel) this.v.nextTacticUnit();
    // (In the player's colour, as the bar.)
    const art = await loadImagePlayer("coplacbr.pcx", Math.max(0, player)).catch(() => loadImage("coplacbr.pcx"));
    // (The phase may have ended while the picture loaded.)
    if (this.tacticsBar !== bar) return void bar.destroy({ children: true });
    bar.addChild(Object.assign(new Sprite(art), { x: 0, y: 556 }));
    const next = new DefButton("icm011.def", 213, 560, player);
    // HELP.TXT 388 / 389: "Phase Wait", "End Tactics Phase".
    next.hint = helpRow(388)?.hover || tr("Next stack");
    next.help = helpRow(388)?.help || next.hint;
    next.label = "button: Next stack";
    next.onClick = () => this.v.nextTacticUnit();
    const end = new DefButton("icm012.def", 419, 560, player);
    end.hint = helpRow(389)?.hover || tr("Start the battle");
    end.help = helpRow(389)?.help || end.hint;
    end.label = "button: Start battle";
    end.onClick = () => this.v.endTactics();
    bar.addChild(next, end);
    bar.visible = !phoneSized() && !screenSize.portrait;
    this.v.root.addChild(bar);
  }

  /** The first tactics phase on this device explains itself in a dialog (GENRLTXT 372; VCMI's openingEnd, the original's). */
  private tacticsHintOnce(owner: number) {
    try {
      if (localStorage.getItem("heroes.tacticsHint")) return;
      localStorage.setItem("heroes.tacticsHint", "1");
    } catch {
      // (No storage: it explains itself every time.)
    }
    void gameTexts().then((t) => t.general[372] && messageBox(this.v.modals, t.general[372].trim(), owner));
  }

  /** The spellbook buttons (the bar's and the touch layout's) and their frames: greyed out (frame 2) while our hero has no spellbook or has cast this round. */
  private castButtons: { sprite: Sprite; frames: { texture: Texture }[] }[] = [];
  /** Wait's, greyed out once the stack whose turn it is has waited. */
  private waitButtons: { sprite: Sprite; frames: { texture: Texture }[] }[] = [];
  /** Defend's, greyed out (with the book and Wait) while our troops are being arranged. */
  private defendButtons: { sprite: Sprite; frames: { texture: Texture }[] }[] = [];
  /** Surrender and retreat, greyed out as the original's where they can't be used. */
  private fleeButtons: { surrender: boolean; sprite: Sprite; frames: { texture: Texture }[] }[] = [];
  refreshCastButton() {
    const s = this.v.state;
    if (!s) return;
    const side = s.sides.findIndex((_, i) => this.v.mine(i));
    const hero = side >= 0 ? s.sides[side].hero : undefined;
    const grey = (c: { sprite: Sprite; frames: { texture: Texture }[] }, can: boolean) => {
      if (c.sprite.destroyed) return;
      c.sprite.texture = (can ? c.frames[0] : (c.frames[2] ?? c.frames[0])).texture;
      c.sprite.alpha = can || c.frames[2] ? 1 : 0.5;
      // (Still held for its words: greyed, a tap does nothing, a hold says what it is.)
      if (can) greyed.delete(c.sprite);
      else greyed.add(c.sprite);
      c.sprite.cursor = can ? "pointer" : "default";
    };
    // As VCMI's BattleWindow::blockUI: the book greys once the hero has cast this round (a hero shut off from
    // magic keeps it lit: pressing says why), Wait once the stack whose turn it is has waited; the book, Wait and
    // Defend while the troops are arranged (the tactics phase: nobody's turn yet).
    const tactics = !!s.tactics;
    for (const b of this.castButtons) grey(b, !tactics && !!hero?.spells && !s.cast?.[side]);
    const u = this.v.myActive();
    for (const b of this.waitButtons) grey(b, !tactics && (!u || !u.waited));
    for (const b of this.defendButtons) grey(b, !tactics);
    // As giveUp's checks (fleeBlock): a hero to flee with, not shut in a town, the HotA Hit & Run ban;
    // surrender to a hero only. The Shackles of War leave the buttons lit: pressing says why not.
    for (const b of this.fleeButtons) {
      const why = side >= 0 ? fleeBlock(s, side as Side, b.surrender) : "noHero";
      grey(b, !why || why === "shackles");
    }
  }

  /** What the bar's button under the pointer does (shown in the console while it's pointed at). */
  barTip: string | null = null;

  /** The touch layout beside the field; phones drop the original's bar under it (too small there, and its buttons are on the sides). */
  layoutSides() {
    // (A view closed while it was still loading: a new game started meanwhile.)
    if (this.v.root.destroyed) return;
    this.v.touch.layout();
    this.v.info.openStackPanelClip();
    // Upright (tablets too) the touch row under the field stands in for the bar.
    const bar = !phoneSized() && !screenSize.portrait;
    this.v.barLayer.visible = bar;
    if (this.tacticsBar) this.tacticsBar.visible = bar;
  }

}
