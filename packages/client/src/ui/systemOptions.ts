// The original System Options window (SYSOPBCK): hero and enemy speed, map scroll speed, music
// and effects volume, the move reminder, and Load / Save / Restart / Main Menu / Quit / Return.
// Positions from VCMI's CSystemOptionsWindow (before its rework).
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { loadDef } from "../assets.ts";
import { getVolume, setVolume } from "../audio.ts";
import { type Settings, setSetting, settings } from "../settings.ts";
import { WHITE, YELLOW } from "../text.ts";
import { DefButton, FingerArea, helpRow, hoverHelp, label, loadButtonHelp, loadImagePlayer, withHelp } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { originalWords } from "./gameText.ts";
import { tr, said, type Text } from "../i18n/index.ts";
import { phoneSized } from "./screen.ts";
import { mobileSystemOptions } from "./mobileOptions.ts";
import { fallback as english } from "../i18n/text.ts";

/**
 * Music and effects volume as the options windows have them: the background has the ten steps
 * (SYSLB), the highlight moves along (VCMI's CVolumeSlider); a tap sets the level. Each step has its
 * HELP.TXT row ("Set music volume to 3"): `help.first` is the first music row (the System Options'
 * 326, the combat options' 394); the effects' ten follow the music's.
 */
export function volumeBars(layer: Container, bar: { texture: Texture }[], rows: [kind: "music" | "sfx", y: number][], changed: () => void, help?: { first: number; onHint: (text: Text) => void }) {
  for (const [kind, y] of rows) {
    const level = Math.round(getVolume(kind) * 9);
    const f = bar[level] ?? bar[0];
    if (!f) continue;
    const step = f.texture.width + 1;
    layer.addChild(Object.assign(new Sprite(f.texture), { x: 29 + step * level, y }));
    const hit = new Graphics().rect(0, 0, step * 10, f.texture.height).fill({ color: 0, alpha: 0.001 });
    hit.position.set(29, y);
    // Touch: a finger's height (the rows have room above and below).
    hit.hitArea = new FingerArea(hit, step * 10, f.texture.height);
    hit.eventMode = "static";
    hit.cursor = "pointer";
    hit.on("pointertap", (e) => {
      const p = e.getLocalPosition(hit);
      setVolume(kind, Math.max(0, Math.min(9, Math.floor(p.x / step))) / 9);
      changed();
    });
    if (help) {
      const what = kind === "music" ? "music" : "sound effects";
      const fallback = (n: number) => english(n ? `Set ${what} volume to ${n}` : `Turn off ${what}`, "help.txt volume");
      hoverHelp(hit, (x) => {
        const n = Math.max(0, Math.min(9, Math.floor(x / step)));
        const row = helpRow(help.first + (kind === "sfx" ? 10 : 0) + n);
        return { hover: row?.hover || fallback(n), help: row?.help || fallback(n) };
      }, help.onHint);
    }
    layer.addChild(hit);
  }
}

export interface SystemActions {
  load: () => void;
  save: () => void;
  restart: () => void;
  mainMenu: () => void;
  quit: () => void;
}

/** HELP.TXT's rows for the window (VCMI's config/widgets/settings: "core.help.<id>"). */
const HELP = { heroSpeed: 349, enemySpeed: 353, scrollSpeed: 357, music: 326, videoLow: 364, videoHigh: 365 } as const;

/** `onHint`: where the rollover texts go (the adventure map's status bar under the window). */
export async function systemOptions(modals: Modals, player: number, actions: SystemActions, onHint: (text: Text) => void = () => {}): Promise<void> {
  // Phones: the same window's parts, bigger, laid out afresh over the whole screen.
  if (phoneSized()) return mobileSystemOptions(modals, player, actions);
  let close = () => {};
  let resolve = () => {};
  const done = new Promise<void>((r) => (resolve = r));
  const finish = (fn: () => void = () => {}) => {
    onHint(said(""));
    close();
    resolve();
    fn();
  };
  const { win, buttons } = await buildSystemOptions(player, actions, onHint, finish);
  // The buttons' own letters (VCMI's settingsLoadGame... : L, S, R, M, Q), Esc / Enter Return.
  const letters: Record<string, () => void> = { l: buttons.load, s: buttons.save, r: buttons.restart, m: buttons.mainMenu, q: buttons.quit };
  close = modals.show(win, { onKey: (k) => (k === "Escape" || k === "Enter" ? finish() : letters[k.toLowerCase()]?.(), true) });
  return done;
}

/**
 * The System Options window in the original's coordinates: its backing, words, buttons and the
 * controls' `layer` (drawn again on every change; `after` sees it each time, the phone's page moves
 * its parts into place). `finish(fn)` closes the window and then does `fn`.
 */
export async function buildSystemOptions(
  player: number,
  actions: SystemActions,
  onHint: (text: Text) => void,
  finish: (fn?: () => void) => void,
  after?: (layer: Container) => void,
): Promise<{ win: Container; layer: Container; buttons: Record<keyof SystemActions, () => void> }> {
  await loadButtonHelp();
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer("sysopbck.pcx", player)));
  const layer = new Container();
  // One-handed: the settings stay where they are; the window's own buttons go to the thumb's side (kit.ts handRail).
  (layer as Container & { handGrid?: boolean }).handGrid = true;
  win.addChild(layer);
  const bar = (await loadDef("syslb.def")).get(0) ?? [];
  // The window's words are GENRLTXT's (568-577, 394 / 395, 20; VCMI's systemOptionsWindow), these without it.
  const ids: Record<string, number> = { "System Options": 568, "Hero Speed": 569, "Enemy Speed": 570, "Map Scroll Speed": 571, "Music Volume": 394, "Effects Volume": 395, "Video Quality": 20, "Show Move Path": 572, "Hero Reminder": 573, "Quick Combat": 574, "Video Subtitles": 575, "Town Outlines": 576, "Animate Spell Book": 577 };
  const words = await originalWords("genrltxt", ids);
  const text = (ours: string, x: number, y: number, align: "center" | "left", color: readonly [number, number, number], font: "medfont" | "bigfont" = "medfont") => {
    const t = words(ours);
    const width = align === "center" ? 220 : 180;
    const l = label(t, font, color, align, width);
    if (align === "center") l.centreOn(x, y);
    else l.position.set(x, y);
    win.addChild(l);
  };
  text(tr("System Options"), 242, 32, "center", YELLOW, "bigfont");
  text(tr("Hero Speed"), 122, 64, "center", YELLOW);
  text(tr("Enemy Speed"), 122, 130, "center", YELLOW);
  text(tr("Map Scroll Speed"), 122, 196, "center", YELLOW);
  text(tr("Music Volume"), 122, 347, "center", YELLOW);
  text(tr("Effects Volume"), 122, 412, "center", YELLOW);
  text(tr("Video Quality"), 122, 262, "center", YELLOW);
  // The checkboxes down the right, as the original's (HELP.TXT's SHOW_PATH_ID .. ANIMATE_SPELLBOOK_ID, 360-367 but the video rows).
  const checks: [keyof Settings, string, string, number][] = [
    ["showPath", "Show Move Path", "When checked, a click shows the hero's route first; a second click walks it.", 360],
    ["moveReminder", "Hero Reminder", "Asks before ending the turn while heroes can still move.", 361],
    ["quickCombat", "Quick Combat", "The computer fights your battles; you see only the results.", 362],
    ["subtitles", "Video Subtitles", "Shows the text under the campaigns' videos.", 363],
    ["townOutlines", "Town Outlines", "In the town screen, the building under the mouse is outlined.", 366],
    ["spellbookAnimation", "Animate Spell Book", "Shows the page-turning animation in the spell book.", 367],
  ];
  checks.forEach(([, name], i) => text(name, 282, 55 + i * 32 - 2, "left", WHITE));

  const draw = () => {
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const s = settings();
    // Toggle rows: the chosen button stays pressed.
    const row = (key: keyof Settings, defs: string[], xs: number[], y: number, values: number[], help: number, names: string[]) =>
      defs.forEach((d, i) => {
        const b = withHelp(new DefButton(d, xs[i], y, -1, s[key] === values[i] ? [1, 1, 2, 3] : [0, 1, 2, 3]), help + i, names[i], onHint);
        b.onClick = () => (setSetting(key, values[i] as never), draw());
        layer.addChild(b);
      });
    // i18n-ok: HELP.TXT's rollovers stand in
    row("heroSpeed", ["sysopb1.def", "sysopb2.def", "sysopb3.def", "sysopb4.def"], [28, 76, 124, 172], 77, [0, 1, 2, 3], HELP.heroSpeed, ["Set hero speed to walk", "Set hero speed to canter", "Set hero speed to gallop", "Set hero speed to jump"]);
    // i18n-ok: HELP.TXT's rollovers stand in
    row("enemySpeed", ["sysopb5.def", "sysopb6.def", "sysopb7.def", "sysopb8.def"], [28, 76, 124, 172], 144, [0, 1, 2, 3], HELP.enemySpeed, ["Set enemy hero speed to canter", "Set enemy hero speed to gallop", "Set enemy hero speed to jump", "Do not show enemy movement"]);
    // i18n-ok: HELP.TXT's rollovers stand in
    row("scrollSpeed", ["sysopb9.def", "sysob10.def", "sysob11.def"], [28, 92, 156], 210, [0, 1, 2], HELP.scrollSpeed, ["Set map scroll speed to slow", "Set map scroll speed to medium", "Set map scroll speed to fast"]);
    volumeBars(layer, bar, [["music", 359], ["sfx", 425]], draw, { first: HELP.music, onHint });
    checks.forEach(([key, name, hint, help], i) => {
      const on = !!s[key];
      const check = withHelp(new DefButton("sysopchk.def", 246, 55 + i * 32, -1, on ? [1, 1, 2, 3] : [0, 1, 2, 3]), help, name, onHint);
      if (!helpRow(help)) check.help = english(`{${name}}\n\n${hint}`, "help.txt option");
      check.onClick = () => (setSetting(key, !on as never), draw());
      layer.addChild(check);
    });
    // Video quality: the box's two halves, the chosen one in gold.
    (["low", "high"] as const).forEach((q, i) => {
      const half = new Container();
      half.position.set(28 + i * 96, 278);
      const box = new Graphics().rect(0, 0, 92, 26).fill({ color: 0, alpha: 0.001 });
      if (s.videoQuality === q) box.rect(1, 1, 90, 24).stroke({ color: 0xe8d478, width: 2 });
      half.addChild(box);
      const l = label(q === "low" ? tr("Low") : tr("High"), "medfont", s.videoQuality === q ? YELLOW : WHITE, "center", 92);
      l.y = Math.round((26 - l.height) / 2);
      half.addChild(l);
      half.hitArea = new FingerArea(half, 92, 26);
      half.eventMode = "static";
      half.cursor = "pointer";
      half.on("pointertap", () => (setSetting("videoQuality", q), draw()));
      const words = () => (q === "low" ? tr("Low Quality Video") : tr("High Quality Video"));
      const row = helpRow(q === "low" ? HELP.videoLow : HELP.videoHigh);
      hoverHelp(half, () => ({ hover: row?.hover || words(), help: row?.help || words() }), onHint);
      layer.addChild(half);
    });
    after?.(layer);
  };
  draw();

  // HELP.TXT 320-325 (HELP_IDS has them by DEF too).
  const then = (fn: () => void) => () => finish(fn);
  const buttons = { load: then(actions.load), save: then(actions.save), restart: then(actions.restart), mainMenu: then(actions.mainMenu), quit: then(actions.quit) };
  const defs: [string, number, number, number, string, () => void][] = [
    ["soload.def", 246, 298, 321, "Load Game", buttons.load],
    ["sosave.def", 357, 298, 322, "Save Game", buttons.save],
    ["sorstrt.def", 246, 357, 323, "Restart Scenario", buttons.restart],
    ["somain.def", 357, 357, 320, "Main Menu", buttons.mainMenu],
    ["soquit.def", 246, 415, 324, "Quit to Desktop", buttons.quit],
    ["soretrn.def", 357, 415, 325, "Return", () => finish()],
  ];
  for (const [def, x, y, help, hint, fn] of defs) {
    const b = withHelp(new DefButton(def, x, y), help, hint, onHint);
    b.onClick = fn;
    win.addChild(b);
  }
  return { win, layer, buttons };
}
