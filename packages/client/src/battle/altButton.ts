// HotA's alternate action button (the battle bar's slot between Cast and Wait; HotA 1.5.0: "Action can
// be changed with a dedicated button or the Alt key"). HotA's own bar (HotA.lod, unreadable by name)
// shows the combat cursor's "can't" sign in that slot while the stack has no alternative; here the
// slot is the original's brown button with the combat cursor of what a click on the field does now:
// the arrow (shoot) or the sword (melee), the wings (Harpies fly back) or the sword (they stay), the
// spell or the sword. Pressed in while the alternate action is on.
import { type AlternateAction, type BattleState, type Unit, casterSpells, stats } from "@heroes/core";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { CombatCursor, combatCursorPicture } from "../cursors.ts";
import { blankButtonNow, preloadBlankButton } from "../ui/kit.ts";
import { type Text, NONE, fmt, said, tr } from "../i18n/index.ts";

export const ALT_W = 48;
export const ALT_H = 36;

/** The cursor each choice shows: [the usual, the alternate]. */
const ICONS: Record<AlternateAction, [number, number]> = {
  melee: [CombatCursor.Shoot, CombatCursor.SwordNE],
  stay: [CombatCursor.Fly, CombatCursor.SwordNE],
  plain: [CombatCursor.Spell, CombatCursor.SwordNE],
  power: [CombatCursor.SwordNE, CombatCursor.Spell],
};

const pictures = new Map<number, Texture>();
function picture(i: number): Texture | null {
  let t = pictures.get(i);
  if (t) return t;
  const canvas = combatCursorPicture(i);
  if (!canvas) return null;
  t = Texture.from(canvas);
  t.source.scaleMode = "nearest";
  pictures.set(i, t);
  return t;
}

/** What the button's tip says (the console line while it's pointed at). */
export function altTip(kind: AlternateAction | null, on: boolean, touch = false): Text {
  const key = touch ? "" : " (Alt)";
  if (!kind) return tr(`Alternate action%1: none for this stack`, key);
  const [now, other] = {
    melee: [tr("shoot"), tr("fight hand to hand")],
    stay: [tr("strike and return"), tr("strike and stay")],
    plain: [tr("use the ability"), tr("move or attack")],
    power: [tr("move or attack"), tr("use the ability")],
  }[kind];
  return on ? tr(`Alternate action%1: %2 (press to %3)`, key, other, now) : tr(`Alternate action%1: %2 (press to %3)`, key, now, other);
}

/** The power a caster's alternate action switches to or from, by its name (a Faerie Dragon's spells: "a random spell"). */
export function powerName(s: BattleState, u: Unit): Text {
  const keys = casterSpells(u, s);
  if (keys.some((k) => k.startsWith("heatStroke"))) return tr("Heat Stroke");
  if (keys.length !== 1) return tr("a random spell");
  const [key] = keys;
  if (key === "summonDemons") return tr("Raise Demons");
  if (key === "summonLarva") return tr("Devour corpses");
  const sp = Object.values(s.spells ?? {}).find((x) => x.key === key);
  return sp?.name ? said(sp.name) : tr("the ability");
}

/**
 * What a hold on the button says (2026-11-03: "hold on the middle special button should show what it does, which
 * special unit ability or that it switches modes"): the stack whose turn it is, what a tap on the field does now and
 * what a press of the button makes it do instead; with no choice, what the button is for.
 */
export function altHelp(s: BattleState | null | undefined, u: Unit | undefined, kind: AlternateAction | null, on: boolean, touch = false, noShots = false): Text {
  const key = touch ? NONE : fmt`\n\n${tr("Key: Alt (or hold Shift)")}`;
  const who = s && u ? said(stats(s, u).plural) : NONE;
  // (The original's popups put their title in braces: drawn gold.)
  const title = fmt`{${tr("Alternate action")}}\n\n`;
  if (!kind || !s || !u) {
    const what = tr("Alternate action: switches how the stack whose turn it is acts: shoot or fight hand to hand, strike and fly back or strike and stay, use its ability or just move and attack.");
    const none = noShots && who ? tr("%1 have no shots left: they fight hand to hand.", who) : tr("This stack has only one way to act.");
    return fmt`${title}${what}\n\n${none}${key}`;
  }
  const power = kind === "plain" || kind === "power" ? powerName(s, u) : NONE;
  // (The ability first for "plain" casters, the attack first for "power" ones: on flips which is in force.)
  const abilityNow = (kind === "plain") !== on;
  const line = {
    melee: on ? tr("%1 now fight hand to hand. Press: they shoot again.", who) : tr("%1 now shoot. Press: they fight hand to hand instead.", who),
    stay: on ? tr("%1 now strike and stay. Press: they strike and fly back again.", who) : tr("%1 now strike and fly back. Press: they strike and stay instead.", who),
    plain: abilityNow ? tr("%1 now use %2. Press: they move or attack instead.", who, power) : tr("%1 now move or attack. Press: they use %2 again.", who, power),
    power: abilityNow ? tr("%1 now use %2. Press: they move or attack again.", who, power) : tr("%1 now move or attack. Press: they use %2 instead.", who, power),
  }[kind];
  return fmt`${title}${line}${key}`;
}

export async function loadAltButton() {
  await preloadBlankButton();
}

export class AltButton extends Container {
  private face: Container;
  private readonly icon = new Sprite();
  private kind: AlternateAction | null = null;
  private alternate = false;
  private held = false;
  /** A shooter with no arrows left: the arrow crossed out. */
  private empty = false;
  private readonly slash = new Graphics();

  constructor(onPress: () => void) {
    super();
    this.label = "button: Alternate action";
    this.eventMode = "static";
    this.cursor = "pointer";
    this.face = blankButtonNow(ALT_W, ALT_H);
    this.icon.anchor.set(0.5);
    this.addChild(this.face, this.icon, this.slash);
    this.on("pointerdown", () => this.press(true));
    this.on("pointerup", () => this.press(false));
    this.on("pointerupoutside", () => this.press(false));
    this.on("pointertap", () => this.kind && onPress());
    this.draw();
  }

  /** The finger or the mouse holds it down (a tablet's wider tap area passes it on). */
  press(down: boolean) {
    this.held = down && !!this.kind;
    this.draw();
  }

  show(kind: AlternateAction | null, on: boolean, empty = false) {
    if (kind === this.kind && on === this.alternate && empty === this.empty) return;
    this.empty = empty;
    this.kind = kind;
    this.alternate = !!kind && on;
    this.draw();
  }

  private draw() {
    if (this.destroyed) return;
    const down = this.alternate !== this.held;
    this.face.destroy({ children: true });
    this.face = blankButtonNow(ALT_W, ALT_H, down);
    this.addChildAt(this.face, 0);
    const i = this.empty ? CombatCursor.Shoot : this.kind ? ICONS[this.kind][this.alternate ? 1 : 0] : CombatCursor.Blocked;
    const t = picture(i);
    this.icon.visible = !!t;
    if (t) {
      this.icon.texture = t;
      // Within the bevel (the cursors are up to 40 pixels).
      const k = Math.min(1, (ALT_W - 10) / t.width, (ALT_H - 8) / t.height);
      this.icon.scale.set(k);
    }
    // Pressed in, the picture sinks with the face, as the original's buttons' pictures do.
    this.icon.position.set(ALT_W / 2 + (down ? 1 : 0), ALT_H / 2 + (down ? 1 : 0));
    // No alternative: the "can't" sign, dimmed as on HotA's bar.
    this.icon.alpha = this.kind && !this.empty ? 1 : 0.45;
    // Out of arrows: the shoot cursor dimmed and struck through in red.
    this.slash.clear();
    if (this.empty) {
      const x = ALT_W / 2 + (down ? 1 : 0);
      const y = ALT_H / 2 + (down ? 1 : 0);
      this.slash.moveTo(x - 13, y - 11).lineTo(x + 13, y + 11).stroke({ color: 0x000000, width: 5 }).moveTo(x - 13, y - 11).lineTo(x + 13, y + 11).stroke({ color: 0xe03a2a, width: 3 });
    }
  }
}
