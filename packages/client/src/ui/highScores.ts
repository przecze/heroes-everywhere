// The end of a scenario and the high score list, as in the original (VCMI's CHighScoreScreen):
// the score screen over HSANIM / HSLOOP (or LOSEGAME), the name entry (HIGHNAME) and the
// HISCORE list. Scores stay in this browser.
import { type ScenarioScore, scoreCreature } from "@heroes/core";
import { Container, Graphics, Sprite, TilingSprite } from "pixi.js";
import { loadDef, loadImage } from "../assets.ts";
import { playMusic } from "../audio.ts";
import { WHITE, YELLOW, loadFont, loadFonts } from "../text.ts";
import { DefButton, label } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { screenSize } from "./screen.ts";
import { videoSprite } from "./video.ts";
import { FILM } from "./prologue.ts";
import { lang, tr, said, type Text, fallback } from "../i18n/index.ts";
import { gameLines, resolveText } from "./gameText.ts";

export interface HighScore {
  player: string;
  scenario: string;
  days: number;
  points: number;
  date: string;
}

const KEY = "heroes-highscores";
const ROWS = 11;
const CAP = 50;

export function loadHighScores(): HighScore[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as HighScore[];
  } catch {
    return [];
  }
}

/** Adds a score; returns its place in the list (or -1 when it fell off the end). */
function addHighScore(entry: HighScore): number {
  const list = [...loadHighScores(), entry].sort((a, b) => b.points - a.points || (a === entry ? -1 : b === entry ? 1 : 0)).slice(0, CAP);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // no storage: the list just isn't kept
  }
  return list.indexOf(entry);
}


const texts = new Map<string, Promise<{ general: Text[] }>>();
/** GENRLTXT, numbered as VCMI does (fonts loaded too), in the interface's language. */
export function gameTexts() {
  let p = texts.get(lang());
  // (The heading line is left out by gameLines.)
  if (!p) texts.set(lang(), (p = Promise.all([gameLines("genrltxt"), loadFonts()]).then(([general]) => ({ general }))));
  return p;
}

/** Full-screen window on the tiled dialog background. */
async function screen(): Promise<Container> {
  const win = new Container();
  win.addChild(new TilingSprite({ texture: await loadImage("diboxbck.pcx"), width: 800, height: 600 }));
  return win;
}

// GENRLTXT lines for the end of the game, by the map's victory / loss condition type (VCMI's MapFormatH3M).
const WON_TEXT = [280, 276, 278, 282, 284, 252, 249, 286, 288, 290, 292];
const OTHER_WON_TEXT = [281, 277, 279, 283, 285, 250, 250, 287, 289, 291, 293];
const LOST_TEXT = [251, 253, 254];

/**
 * What the original says when the game ends for this player; `args` fill its %s / %d in order
 * (the artifact, amount and creature or resource, town or hero of the condition; the player's name).
 */
export async function gameOverText(won: boolean, victoryType: number, lostBy: number, args: (string | number)[]): Promise<Text> {
  const t = (await gameTexts()).general;
  let id: number;
  if (won) id = WON_TEXT[victoryType] ?? 659;
  // Someone else met the map's special victory condition, or we failed its special loss condition.
  else if (victoryType >= 0 && OTHER_WON_TEXT[victoryType]) id = OTHER_WON_TEXT[victoryType];
  else id = LOST_TEXT[lostBy] ?? 7;
  let k = 0;
  return said((t[id] ?? (won ? "Victory!" : "Defeat.")).replace(/%[sd]/g, () => String(args[k++] ?? "")));
}

/**
 * The scenario is over: the score screen (won) or the lost-game film. A click asks for a name and
 * shows the high score list with the new entry highlighted.
 */
export async function scenarioEnd(modals: Modals, won: boolean, score: ScenarioScore, scenario: string, creatureName: (id: number) => string): Promise<void> {
  const t = await gameTexts();
  // The name box's picture before the screen shows: a key there must bring the box at once.
  if (won) await loadImage("highname.pcx").catch(() => undefined);
  const win = new Container();
  win.addChild(new Graphics().rect(0, 0, 800, 600).fill(0x000000));
  // The lost-game film closes by itself when it ends.
  let filmOver = () => {};
  win.addChild(videoSprite(won ? ["hsanim", "hsloop"] : ["losegame"], 800, 600, win, won ? undefined : () => filmOver()));
  if (won) {
    const font = await loadFont("hiscore").then(() => "hiscore" as const, () => "bigfont" as const);
    const rank = score.cheater ? (t.general[260] ?? fallback("Cheater!")) : creatureName(scoreCreature(score.total));
    // The difficulty in the game's words (ARRAYTXT 142-146, as the scenario window; The owner 2026-11-02 15:12: "Normal" in Polish).
    const level = (await resolveText({ file: "arraytxt", id: 142 + score.difficulty }))?.trim() ?? tr(["Easy", "Normal", "Hard", "Expert", "Impossible"][score.difficulty] ?? "Normal");
    const values = [String(score.days), String(score.basic), level, String(score.total), rank];
    [438, 439, 440, 441, 676].forEach((id, i) => {
      const x = 150 * i + 100;
      for (const [text, y] of [[t.general[id] ?? "", 450], [values[i], 530]] as const) {
        // VCMI's CHighScoreInputScreen: FONT_HIGH_SCORE (HISCORE.FNT), TOPCENTER in 150-wide boxes.
        const l = label(said(text), font, WHITE, "center", 150);
        l.position.set(x - 75, y);
        win.addChild(l);
      }
    });
    playMusic("Win Scenario.mp3", true);
  } else playMusic("UltimateLose.mp3", false);
  win.eventMode = "static";
  let closeScreen = () => {};
  await new Promise<void>((resolve) => {
    filmOver = resolve;
    win.on("pointertap", () => resolve());
    closeScreen = modals.show(win, { ...FILM, onKey: () => (resolve(), true) });
  });
  win.removeAllListeners("pointertap");
  // The name is asked over the score screen.
  const name = won ? await nameEntry(modals, t.general[96] ?? fallback("Enter your name:")) : "";
  closeScreen();
  if (!name) return;
  const pos = addHighScore({ player: name, scenario: score.cheater ? (t.general[260] ?? fallback("Cheater!")) : scenario, days: score.days, points: score.cheater ? 0 : score.total, date: new Date().toLocaleString() });
  await highScoreList(modals, pos);
}

/** HIGHNAME: a name for the list; resolves with it, or "" on cancel. */
async function nameEntry(modals: Modals, prompt: Text): Promise<string> {
  const win = new Container();
  win.addChild(new Sprite(await loadImage("highname.pcx")));
  const text = label(prompt, "smalfont", WHITE, "center", 202);
  text.position.set(15, 15);
  let value = (() => {
    try {
      return localStorage.getItem("heroes-player-name") ?? tr("Player");
    } catch {
      return tr("Player");
    }
  })();
  // The last name comes up marked: the first key typed replaces it, Backspace clears it.
  let fresh = true;
  const field = label(said(value + "_"), "smalfont", WHITE, "center", 200);
  field.alpha = 0.7;
  field.position.set(18, 108);
  win.addChild(text, field);
  // Touch screens have no keys: a tap on the name brings up the device's keyboard (a hidden text field).
  let input: HTMLInputElement | null = null;
  const typed = (v: string) => {
    value = v.slice(0, 20);
    fresh = false;
    field.alpha = 1;
    field.value = said(value + "_");
  };
  if (screenSize.touch || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches)) {
    input = Object.assign(document.createElement("input"), { type: "text", maxLength: 20, value, autocomplete: "off" });
    input.setAttribute("aria-label", prompt);
    Object.assign(input.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", border: "0", padding: "0" });
    document.body.appendChild(input);
    // A tap anywhere on the window but its two buttons brings the keys (2026-11-02 15:12: "can't open phone
    // keyboard here"; only the name's thin strip did), and they come up at once: the tap that closed the score screen
    // still counts as the player's for the browser.
    const tapArea = new Graphics().rect(0, 0, 230, 140).fill({ color: 0, alpha: 0.001 });
    tapArea.eventMode = "static";
    const keys = () => {
      input!.value = fresh ? "" : value;
      input!.focus();
    };
    tapArea.on("pointertap", keys);
    tapArea.on("pointerdown", keys);
    win.addChildAt(tapArea, 1);
    setTimeout(keys, 0);
    input.addEventListener("input", () => typed(input!.value));
  }
  return new Promise((resolve) => {
    let close = () => {};
    const finish = (v: string) => {
      input?.remove();
      close();
      try {
        if (v) localStorage.setItem("heroes-player-name", v);
      } catch {
        // not kept
      }
      resolve(v);
    };
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(value.trim());
      else if (e.key === "Escape") finish("");
    });
    const ok = new DefButton("mubchck.def", 26, 142);
    ok.onClick = () => finish(value.trim());
    const cancel = new DefButton("mubcanc.def", 142, 142);
    cancel.onClick = () => finish("");
    win.addChild(ok, cancel);
    close = modals.show(win, {
      typed: true,
      onKey: (key) => {
        if (key === "Enter") finish(value.trim());
        else if (key === "Escape") finish("");
        else if (key === "Backspace") value = fresh ? "" : value.slice(0, -1);
        else if (key.length === 1 && (fresh || value.length < 20)) value = (fresh ? "" : value) + key;
        else return true;
        fresh = false;
        field.alpha = 1;
        field.value = said(value + "_");
        return true;
      },
    });
  });
}

/** HISCORE: the best scenario scores, `highlight` (a place in the list) in yellow. */
export async function highScoreList(modals: Modals, highlight = -1, campaign = false): Promise<void> {
  const t = await gameTexts();
  const win = await screen();
  const body = new Container();
  win.addChild(body);
  const icons = await loadDef("cprsmall.def");
  const draw = () => {
    body.removeChildren().forEach((c) => c.destroy({ children: true }));
    void loadImage(campaign ? "hiscore2.pcx" : "hiscore.pcx").then((bg) => body.addChildAt(new Sprite(bg), 0));
    const head = (text: Text, x: number) => {
      const l = label(text, "medfont", WHITE, "center", 200);
      l.position.set(x - 100, 12);
      body.addChild(l);
    };
    head(t.general[433] ?? fallback("Rank"), 115);
    head(t.general[434] ?? fallback("Player"), 225);
    if (campaign) {
      head(t.general[672] ?? fallback("Campaign"), 405);
      head(t.general[75] ?? fallback("Score"), 592);
    } else {
      head(t.general[435] ?? fallback("Land"), 405);
      head(t.general[436] ?? fallback("Days"), 557);
      head(t.general[75] ?? fallback("Score"), 627);
    }
    // Campaign scores aren't recorded yet: that page stays empty.
    const list = campaign ? [] : loadHighScores();
    for (let i = 0; i < ROWS; i++) {
      // The new entry, when it is past the shown rows, takes the last row.
      const index = i === ROWS - 1 && highlight > ROWS - 1 ? highlight : i;
      const e = list[index];
      const color = index === highlight ? YELLOW : WHITE;
      const y = 58 + i * 50;
      // One line, clipped to the column.
      const cell = (text: Text, x: number, w = 120) => {
        let l = label(text, "medfont", color);
        for (let n = text.length - 1; l.width > w && n > 0; n--) {
          l.destroy();
          l = label(said(text.slice(0, n) + "..."), "medfont", color);
        }
        l.position.set(Math.round(x - l.width / 2), y);
        body.addChild(l);
      };
      cell(said(String(index + 1)), 115, 60);
      if (!e) continue;
      cell(said(e.player), 225);
      cell(said(e.scenario), 405, 200);
      cell(said(String(e.days)), 557, 60);
      cell(said(String(e.points)), 627, 60);
      const f = e.points > 0 && e.points <= 500 ? icons.get(0)?.[scoreCreature(e.points) + 2] : undefined;
      if (f) body.addChild(Object.assign(new Sprite(f.texture), { x: 670 + f.x, y: y - 23 + f.y }));
    }
  };
  draw();
  await new Promise<void>((resolve) => {
    let close = () => {};
    const exit = () => (close(), resolve());
    const pages = (c: boolean) => () => {
      campaign = c;
      highlight = -1;
      draw();
    };
    const cam = new DefButton("hisccam.def", 31, 113);
    cam.hint = tr("Campaign high scores.");
    cam.onClick = pages(true);
    const sta = new DefButton("hiscsta.def", 31, 345);
    sta.hint = tr("Scenario high scores.");
    sta.onClick = pages(false);
    win.addChild(cam, sta);
    const reset = new DefButton("hiscres.def", 726, 113);
    reset.hint = tr("Clear the high score list.");
    reset.onClick = () => {
      try {
        localStorage.removeItem(KEY);
      } catch {
        // nothing kept anyway
      }
      highlight = -1;
      draw();
    };
    const back = new DefButton("hiscext.def", 726, 345);
    back.hint = tr("Back.");
    back.onClick = exit;
    win.addChild(reset, back);
    close = modals.show(win, { onKey: (key) => (key === "Escape" || key === "Enter" ? exit() : undefined, true), backdrop: 0x000000 });
  });
}
