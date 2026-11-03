// The original combat options window (COMOPBCK), opened by the battle bar's options button: the
// hex grid, movement shadow and cursor shadow, animation speed, music and effects volume, Default
// and Return. Positions from VCMI 0.99's CBattleOptionsWindow; texts from GENRLTXT 392-407. The
// auto-combat choices (what auto combat plays for you) and creature info (what pointing at a stack
// says) on the window's empty checkbox slots down the right (VCMI never made them work).
import { Container, Graphics, Sprite } from "pixi.js";
import { loadDef } from "../assets.ts";
import { type Settings, extra, setSetting, settings } from "../settings.ts";
import { WHITE, YELLOW } from "../text.ts";
import { DefButton, label, loadButtonHelp, loadImagePlayer, preloadBlankButton, setEnabled, textButton, withHelp } from "../ui/kit.ts";
import { type Modals } from "../ui/modals.ts";
import { resolveText } from "../ui/gameText.ts";
import { volumeBars } from "../ui/systemOptions.ts";
import { phoneSized } from "../ui/screen.ts";
import { mobileBattleOptions } from "../ui/mobileOptions.ts";
import { tr, said, fmt, type Text } from "../i18n/index.ts";

const FALLBACK: Record<number, string> = {
  392: "Combat Options",
  393: "Animation Speed",
  394: "Music Volume",
  395: "Effects Volume",
  396: "Auto-Combat Options",
  397: "Creature Info",
  398: "Creatures",
  399: "Spells",
  400: "Catapult",
  151: "Ballista",
  401: "First Aid Tent",
  402: "All Stats",
  403: "Spells Only",
  404: "View Hex Grid",
  405: "Movement Shadow",
  406: "Cursor Shadow",
  407: "",
};

/** The right-hand checkboxes: the window's empty slots under Auto-Combat Options and Creature Info. */
const AUTO_X = 247;
const AUTO_Y = [83, 113, 143, 173, 203];
const INFO_Y = [282, 312];

/** Undo's word button on a desktop (EXTRAS battleUndo): in the title band's empty right end. */
const UNDO = { x: 378, y: 18, w: 80, h: 25 };

/** HELP.TXT's rows for the window (VCMI's config/widgets/settings/battleOptionsWindow: "core.help.<id>"). */
const HELP = { ret: 392, defaults: 393, music: 394, speed: 422, grid: 427, moveShadow: 428, cursorShadow: 429 } as const;

/** `onHint`: where the rollover texts go (the battle's console under the window). */
/** An addition (EXTRAS battleUndo): the battle back to before the last decision; `can`: one is kept to take back. */
export type UndoOffer = { can: boolean; run: () => void };

export async function battleOptionsWindow(modals: Modals, player: number, onHint: (text: Text) => void = () => {}, undo?: UndoOffer): Promise<void> {
  // Phones: the same window's parts, bigger, laid out afresh over the whole screen.
  if (phoneSized()) return mobileBattleOptions(modals, player, undo);
  let close = () => {};
  let resolve = () => {};
  const closed = new Promise<void>((r) => (resolve = r));
  const done = () => (onHint(said("")), close(), resolve());
  const { win } = await buildBattleOptions(player, onHint, done, undefined, undo);
  close = modals.show(win, { onKey: (k) => (k === "Escape" || k === "Enter" ? done() : undefined, true) });
  return closed;
}

/**
 * The combat options window in the original's coordinates: its backing, words, Default and Return,
 * and the controls' `layer` (drawn again on every change; `after` sees it each time, the phone's page
 * moves its parts into place). `done` closes it.
 */
export async function buildBattleOptions(player: number, onHint: (text: Text) => void, done: () => void, after?: (layer: Container) => void, undo?: UndoOffer): Promise<{ win: Container; layer: Container; reset: () => void }> {
  await Promise.all([loadButtonHelp(), preloadBlankButton()]);
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer("comopbck.pcx", player)));
  const texts = Object.fromEntries(await Promise.all(Object.keys(FALLBACK).map(async (k) => [k, (await resolveText({ file: "genrltxt", id: Number(k) }))?.trim() || FALLBACK[Number(k)]] as const)));
  const text = (id: number, x: number, y: number, align: "center" | "left", font: "medfont" | "bigfont" = "medfont", color: readonly [number, number, number] = WHITE) => {
    const value = said(texts[id]);
    if (!value) return;
    const width = align === "center" ? 220 : 180;
    const l = label(value, font, color, align, width);
    l.position.set(align === "center" ? x - width / 2 : x, y - (align === "center" ? Math.round(l.height / 2) : 4));
    win.addChild(l);
  };
  text(392, 242, 32, "center", "bigfont", YELLOW);
  text(393, 122, 214, "center", "medfont", YELLOW);
  text(394, 122, 293, "center", "medfont", YELLOW);
  text(395, 122, 359, "center", "medfont", YELLOW);
  text(396, 353, 66, "center", "medfont", YELLOW);
  text(397, 353, 265, "center", "medfont", YELLOW);
  for (const [id, y] of [[398, 86], [399, 116], [400, 146], [151, 176], [401, 206], [402, 285], [403, 315]]) text(id, 283, y, "left");
  for (const [id, y] of [[404, 57], [405, 90], [406, 123], [407, 156]]) text(id, 61, y, "left");

  const bar = (await loadDef("syslb.def")).get(0) ?? [];
  const layer = new Container();
  win.addChild(layer);
  const draw = () => {
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const s = settings();
    const check = (key: "battleGrid" | "battleMoveShadow" | "battleMouseShadow", y: number, help: number, name: string) => {
      const b = withHelp(new DefButton("sysopchk.def", 25, y, -1, s[key] ? [1, 1, 2, 3] : [0, 1, 2, 3]), help, name, onHint);
      b.onClick = () => (setSetting(key, !s[key]), draw());
      layer.addChild(b);
    };
    check("battleGrid", 56, HELP.grid, "View Hex Grid");
    check("battleMoveShadow", 89, HELP.moveShadow, "Movement Shadow");
    check("battleMouseShadow", 122, HELP.cursorShadow, "Cursor Shadow");
    if (undo && !after) void undoButton(layer, undo, onHint, done);
    // Animation speed: the chosen button stays pressed.
    (["sysopb9.def", "sysob10.def", "sysob11.def"] as const).forEach((def, i) => {
      const b = withHelp(new DefButton(def, [28, 92, 156][i], 225, -1, s.battleSpeed === i ? [1, 1, 2, 3] : [0, 1, 2, 3]), HELP.speed + i, `Set animation speed to ${["slow", "medium", "fast"][i]}`, onHint);
      b.onClick = () => (setSetting("battleSpeed", i as Settings["battleSpeed"]), draw());
      layer.addChild(b);
    });
    // Auto-Combat Options: what auto combat plays (battle/view.ts leftToPlayer; Spells: autoAction's).
    const autoKeys = ["autoCreatures", "autoSpells", "autoCatapult", "autoBallista", "autoFirstAid"] as const;
    autoKeys.forEach((key, i) => {
      const name = `${texts[[398, 399, 400, 151, 401][i]]}`;
      const b = withHelp(new DefButton("sysopchk.def", AUTO_X, AUTO_Y[i], -1, s[key] ? [1, 1, 2, 3] : [0, 1, 2, 3]), -1, name, onHint);
      b.help = tr("{%1}\n\nWhen checked, auto combat plays this for you; unchecked, it waits for you to play it.", name);
      b.onClick = () => (setSetting(key, !s[key]), draw());
      layer.addChild(b);
    });
    // Creature Info: all its stats or only the spells on it when a stack is pointed at (both unchecked: its name).
    (["all", "spells"] as const).forEach((v, i) => {
      const name = `${texts[[402, 403][i]]}`;
      const on = s.creatureInfo === v;
      const b = withHelp(new DefButton("sysopchk.def", AUTO_X, INFO_Y[i], -1, on ? [1, 1, 2, 3] : [0, 1, 2, 3]), -1, name, onHint);
      b.help = tr("{%1}\n\nWhat the status bar says about the stack under the pointer.", name);
      b.onClick = () => (setSetting("creatureInfo", on ? "none" : v), draw());
      layer.addChild(b);
    });
    if (extra("speedSlider")) speedSlider(layer);
    volumeBars(layer, bar, [["music", 305], ["sfx", 371]], draw, { first: HELP.music, onHint });
    after?.(layer);
  };
  draw();

  // Default: the original's choices again (VCMI left it a stub).
  const reset = () => {
    setSetting("battleGrid", true);
    setSetting("battleMoveShadow", true);
    setSetting("battleMouseShadow", true);
    setSetting("battleSpeed", 1);
    setSetting("battleSpeedFine", 1);
    for (const key of ["autoCreatures", "autoSpells", "autoCatapult", "autoBallista", "autoFirstAid"] as const) setSetting(key, true);
    setSetting("creatureInfo", "all");
    draw();
  };
  const defaults = withHelp(new DefButton("codefaul.def", 246, 359, -1), HELP.defaults, "Restore Default Values", onHint);
  defaults.onClick = reset;
  const ret = withHelp(new DefButton("soretrn.def", 357, 359, -1), HELP.ret, "Return to Battle", onHint);
  ret.onClick = done;
  win.addChild(defaults, ret);
  return { win, layer, reset };
}

/**
 * An addition (EXTRAS battleUndo) on a desktop: the word button "Undo" at the right end of the window's title band
 * (its fourth checkbox row is HotA's Battlefield Casualties, its foot holds Default and Return), greyed with nothing
 * to take back. Pressed: the window closes and the battle asks "Undo the last move?" (BattleView.undo). On a phone it
 * is a button of the page's row beside Default and Return instead (ui/mobileOptions.ts).
 */
async function undoButton(layer: Container, undo: UndoOffer, onHint: (text: Text) => void, done: () => void) {
  const b = await textButton(tr("Undo"), UNDO.w, UNDO.h, () => {
    if (!undo.can) return;
    done();
    undo.run();
  }, "medfont");
  if (layer.destroyed) return void b.destroy({ children: true });
  b.label = "button: Undo";
  b.position.set(UNDO.x, UNDO.y);
  setEnabled(b, undo.can);
  const hint = tr("Undo: the battle goes back to just before the last move a player made (when two players fight, the other one agrees first)");
  b.on("pointerover", () => onHint(undo.can ? hint : tr("Nothing to undo yet")));
  b.on("pointerout", () => onHint(said("")));
  layer.addChild(b);
}

/**
 * An addition (EXTRAS speedSlider): the speed fine-tuned, x0.25 to x4 on top of the three buttons,
 * as a thin gold track with a knob in the gap under them (the Options panel has the same).
 */
function speedSlider(parent: Container) {
  // Its own container, in the window's coordinates (the phone's page moves it as a whole).
  const layer = new Container();
  parent.addChild(layer);
  const [x0, x1, y] = [30, 186, 266];
  const steps = 16;
  const index = () => Math.max(0, Math.min(steps, Math.round(Math.log2(settings().battleSpeedFine || 1) * 4) + steps / 2));
  const g = new Graphics();
  // medfont, readable on a phone where the window is shown small.
  const value = label(said(""), "medfont", YELLOW);
  value.position.set(x1 + 8, y - 8);
  const show = () => {
    const at = index();
    const kx = x0 + ((x1 - x0) * at) / steps;
    g.clear()
      .rect(x0, y - 2, x1 - x0, 4).fill(0x8a6a30)
      .rect(x0 + (x1 - x0) / 2 - 1, y - 5, 2, 11).fill(0xb89050)
      .rect(kx - 5, y - 8, 11, 17).fill(0xe8c860).stroke({ color: 0x302010, width: 1 });
    value.value = fmt`x${said((2 ** ((at - steps / 2) / 4)).toFixed(2).replace(/\.?0+$/, ""))}`;
  };
  show();
  const hit = new Graphics().rect(x0 - 8, y - 12, x1 - x0 + 16, 24).fill({ color: 0, alpha: 0.001 });
  hit.eventMode = "static";
  hit.cursor = "pointer";
  // (Named for scripts: heroes.press, the probes.)
  hit.label = "button: Animation speed slider";
  const set = (px: number) => {
    const i = Math.max(0, Math.min(steps, Math.round(((px - x0) / (x1 - x0)) * steps)));
    if (i === index()) return;
    setSetting("battleSpeedFine", 2 ** ((i - steps / 2) / 4));
    show();
  };
  let dragging = false;
  hit.on("pointerdown", (e) => ((dragging = true), set(e.getLocalPosition(layer).x)));
  hit.on("globalpointermove", (e) => dragging && set(e.getLocalPosition(layer).x));
  hit.on("pointerup", () => (dragging = false)).on("pointerupoutside", () => (dragging = false));
  layer.addChild(g, value, hit);
}
