import { type BattleState, type TextRef, alive, battleExperience, casualties as lossesOf, withLearning } from "@heroes/core";
import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { CPRESULT, cut } from "../ui/blocks/windowParts.ts";
import { loadImagePlayer } from "../ui/kit.ts";
import { type Modals } from "../ui/modals.ts";
import { creaturePortrait, loadDef, loadImage } from "../assets.ts";
import { heroPortraitOf } from "./heroInfo.ts";
import { englishLine, resolveText } from "../ui/gameText.ts";
import { navBarRight, phoneSized, screenSize } from "../ui/screen.ts";
import { GameText, WHITE, YELLOW } from "../text.ts";
import { SCREEN_H, SCREEN_W } from "./layout.ts";
import { tr, said, fmt, type Text, fallback } from "../i18n/index.ts";

// The window's words (GENRLTXT 410 / 411, 407-409, 523, VCMI's BattleResultWindow; HotA's file keeps
// SoD's numbering), English until the game files have them.
const TEXT = { victorious: "Victorious", defeated: "Defeated", casualties: "Battlefield Casualties", attacker: "Attacker", defender: "Defender", none: "None" };
const TEXT_IDS: Record<keyof typeof TEXT, number> = { victorious: 410, defeated: 411, casualties: 407, attacker: 408, defender: 409, none: 523 };
async function texts(): Promise<typeof TEXT> {
  const out = { ...TEXT };
  for (const k of Object.keys(TEXT) as (keyof typeof TEXT)[]) out[k] = (await resolveText({ file: "genrltxt", id: TEXT_IDS[k] }))?.trim() || TEXT[k];
  return out;
}

/**
 * The original battle results window (CPRESULT): who fought, who won, and
 * each side's casualties with portraits. Resolves when OK is pressed ("restart": HotA's Restart, offered
 * after a quick combat, was pressed instead).
 */
/** The result films, fetched when a battle starts (the server converts them on first use) and kept. */
const films = new Map<string, string>();
export function preloadResultVideos(names = ["win3", "lbstart", "lbloop"]) {
  for (const name of names) {
    if (films.has(name)) continue;
    films.set(name, `/video/${name}.webm`);
    void fetch(`/video/${name}.webm`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => films.set(name, URL.createObjectURL(b)))
      .catch(() => films.delete(name));
  }
}
const resultVideo = (name: string) => films.get(name) ?? `/video/${name}.webm`;
/** Where a sideways phone cuts the window in two (windowParts' CPRESULT `top`, `bottom`). */
const HALF = CPRESULT.parts.top.h;
/** The rim's edge added to each half where it was cut. */
const EDGE = CPRESULT.parts.topEdge.h;

/**
 * Shown as one of the battle's windows (`modals`): on touch screens it grows as the other windows do
 * (upright to the screen's width), the battle's big buttons hide under it, and on phones its text is
 * medfont (the original's small font can't be read there). `field` gets the dimming over the battle.
 */
export async function showBattleResult(modals: Modals, field: Container, s: BattleState, viewer: 0 | 1 | -1, restartable = false): Promise<"ok" | "restart"> {
  const root = new Container();
  const dim = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill({ color: 0x000000, alpha: 0.45 });
  dim.eventMode = "static"; // swallow clicks on the battlefield behind
  root.addChild(dim);
  field.addChild(root);
  const win = new Container();
  win.label = "battle results";
  // Sized as its backing (the original 470x561), whatever spills over its edge.
  win.boundsArea = new Rectangle(0, 0, 470, 561);
  // Phones: medfont wherever the original writes in its small font.
  const small = phoneSized() ? "medfont" : "smalfont";
  // A sideways phone: the window's two halves side by side (see the end), and its text a little
  // bigger again, so it reads at medfont's 1.25 times (the 600 px high screen held it to 1.04x).
  const halves = phoneSized() && !screenSize.portrait;
  const ts = halves ? 1.15 : 1;

  // The window in the colour of the player it's shown to, as the original colours it (a watcher's: as it is).
  const owner = viewer === -1 ? undefined : s.sides[viewer].owner;
  const picture = owner === undefined ? loadImage(CPRESULT.file) : loadImagePlayer(CPRESULT.file, Math.max(0, owner)).catch(() => loadImage(CPRESULT.file));
  const [bg, ok, again] = await Promise.all([picture, loadDef("iok6432.def"), restartable ? loadDef("cbrestb.def").catch(() => null) : null]);
  win.addChild(new Sprite(bg));

  const label = (text: Text, x: number, y: number, font: "smalfont" | "medfont" | "bigfont" = small, align: "left" | "center" | "right" = "left", color: readonly [number, number, number] = WHITE) => {
    const t = new GameText(font, color, align === "right" ? "left" : align, align === "center" ? 300 : undefined);
    t.value = text;
    t.scale.set(ts);
    win.addChild(t);
    if (align === "center") t.centreOn(x, y);
    else if (align === "right") t.position.set(x - t.width, y);
    else t.position.set(x, y);
    return t;
  };

  // Each side: hero portrait (or its best creature) and name.
  for (const side of [0, 1] as const) {
    const x = side === 0 ? 21 : 392;
    const hero = s.sides[side].hero;
    let name: Text = said(s.sides[side].name);
    // (A hero goes by name and portrait even without a portrait of their own: the class's default.)
    if (hero) {
      const tex = await heroPortraitOf(s, side);
      if (tex) {
        const p = new Sprite(tex);
        p.position.set(x, 38);
        win.addChild(p);
      }
      name = said(hero.name);
    } else {
      // (Its own stacks, as VCMI's BattleResultWindow: not the town's arrow towers, war machines or summons.)
      const units = s.units.filter((u) => u.side === side && !u.machine && !u.summoned);
      const best = units.sort((a, b) => s.creatures[b.creature].aiValue - s.creatures[a.creature].aiValue)[0];
      // Monsters go by their strongest creature's name, picture or not.
      if (best) name = said(s.creatures[best.creature].plural);
      const tex = best && (await creaturePortrait(s.creatures[best.creature], "large"));
      if (tex) {
        const p = new Sprite(tex);
        p.position.set(x, 38);
        win.addChild(p);
      }
    }
    // In the name strips (about 140 wide), both at the same height; a name too long for its strip
    // (medfont on phones, maps' own heroes) is cut short with dots.
    const fit = (t: GameText, max: number) => {
      for (let n = name.length - 1; t.width > max && n > 1; n--) t.value = fmt`${said(name.slice(0, n).trimEnd())}...`;
      return t;
    };
    if (side === 0) fit(label(name, 89, 37), 136);
    else {
      const t = fit(label(name, 381, 37, small, "right"), 136);
      t.x = 381 - t.width;
    }
  }

  const won = s.winner;
  const { victorious, defeated, casualties, attacker, defender, none } = await texts();
  label(won === 0 ? said(victorious) : said(defeated), 59, 124, small, "center");
  label(won === 1 ? said(victorious) : said(defeated), 410, 124, small, "center");
  // The original's victory / defeat video (Bink, converted by the dev server).
  const won2 = viewer === -1 ? won !== "draw" : won === viewer;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  // How it ended for the loser (VCMI's BattleResultWindow): beaten, fled or surrendered.
  const how = s.fled && s.fled.side !== won ? (s.fled.surrender ? "surrender" : "escape") : "normal";
  // A town's defenders get their own films: the town held (DEFENDALL) or lost (LOSECSTL).
  const defended = !!s.siege && viewer === 1;
  const clips = won2
    ? defended ? ["defendall", "defendloop"] : ["win3"]
    : defended ? ["losecstl", "losecslp"] : how === "escape" ? ["rtstart", "rtloop"] : how === "surrender" ? ["surrender"] : ["lbstart", "lbloop"];
  let clip = 0;
  video.src = resultVideo(clips[0]);
  video.loop = clips.length === 1;
  video.addEventListener("ended", () => {
    clip = Math.min(clip + 1, clips.length - 1);
    video.src = resultVideo(clips[clip]);
    video.loop = true;
    void video.play().catch(() => {});
  });
  void video.play().catch(() => {});
  // Frames are copied into a canvas texture each tick (simple and reliable across browsers).
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 120;
  const ctx2d = canvas.getContext("2d")!;
  const texture = Texture.from(canvas);
  const videoSprite = new Sprite(texture);
  videoSprite.position.set(107, 70);
  win.addChild(videoSprite);
  let raf = 0;
  const pump = () => {
    if (video.readyState >= 2) {
      ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
      texture.source.update();
    }
    raf = requestAnimationFrame(pump);
  };
  raf = requestAnimationFrame(pump);
  root.on("destroyed", () => {
    cancelAnimationFrame(raf);
    video.pause();
    video.removeAttribute("src");
  });
  // The text under the video, as the original words it (VCMI's BattleResultWindow, a box at 69,203
  // 330 wide): GENRLTXT 304 / 303 / 302 for a victory (the enemy beaten, fled, surrendered) with
  // 305, the hero's experience (battleExperience: the hit points of the enemies killed, 500 for beating
  // a hero or taking a town, with Learning, as VCMI's calculateXp); a defeat as below (with or without our hero).
  const winner = won === 0 || won === 1 ? s.sides[won].hero : null;
  let text: Text;
  if (won === "draw" || viewer === -1) text = won === "draw" ? tr("Both armies perished") : won === 0 ? tr("The attacker wins") : tr("The defender wins");
  else if (won === viewer) {
    text = (await resolveText({ file: "genrltxt", id: how === "escape" ? 303 : how === "surrender" ? 302 : 304 })) ?? fallback("A glorious victory!");
    if (winner) {
      const xp = withLearning(winner, battleExperience(s, won));
      text = fmt`${text}${(await resolveText({ file: "genrltxt", id: 305, args: [winner.name, xp] })) ?? englishLine("genrltxt", 305, [winner.name, xp])}`;
    }
  } else {
    // Our hero beaten, fled or surrendered goes by name (GENRLTXT 308, 307, 306); an army
    // without one (a town's garrison) gets 311 / 310 / 309.
    const ours = s.sides[viewer].hero;
    const ref: TextRef = ours ? { file: "genrltxt", id: how === "escape" ? 307 : how === "surrender" ? 306 : 308, args: [ours.name] } : { file: "genrltxt", id: how === "escape" ? 310 : how === "surrender" ? 309 : 311 };
    text = (await resolveText(ref)) ?? englishLine("genrltxt", ref.id, ref.args);
  }
  const box = new GameText(small, WHITE, "center", Math.floor(330 / ts));
  box.value = text;
  box.scale.set(ts);
  // Medfont (phones) needs more room than the box's 68: the blank line between the parts goes first.
  if (box.height > 68) box.value = said(text.replace(/\n\s*\n/g, "\n"));
  box.position.set(69, Math.min(203 + Math.max(0, Math.round((68 - box.height) / 2)), HALF - 6 - box.height));
  win.addChild(box);
  label(said(casualties), 232, 302, "bigfont", "center", YELLOW);
  // (medfont on phones is taller: a little higher, clear of the casualty strips' top edges)
  const lift = small === "medfont" ? 3 : 0;
  label(said(attacker), 232, 332 - lift, small, "center");
  label(said(defender), 232, 428 - lift, small, "center");

  for (const side of [0, 1] as const) {
    const lost = lossesOf(s, side);
    if (!lost.size) {
      label(said(none), 235, 360 + 97 * side, small, "center");
      continue;
    }
    // 42 apart, closer when many kinds died (seven stacks and the war machines), all within the strip. Upright on a
    // phone the window is the screen's width, so the portraits are drawn bigger to read there (2026-10-27 22:02:
    // "the scaled-down desktop dialogue"), as big as the strip holds.
    const pk = phoneSized() && screenSize.portrait ? 1.4 : 1;
    const pw = Math.round(32 * pk);
    const step = Math.min(Math.round(42 * pk), Math.floor((400 - pw) / Math.max(1, lost.size - 1)));
    let x = 235 - (pw + (lost.size - 1) * step) / 2;
    const y = 344 + side * 97 - Math.round((pw - 32) / 2);
    for (const [creature, n] of lost) {
      const tex = await creaturePortrait(s.creatures[creature], "small");
      if (tex) {
        const p = new Sprite(tex);
        p.scale.set(pk);
        p.position.set(Math.round(x), y);
        win.addChild(p);
      }
      label(said(String(n)), x + pw / 2, y + pw + 10, small, "center");
      x += step;
    }
  }
  void alive;

  return new Promise((resolve) => {
    let answer: "ok" | "restart" = "ok";
    const frames = ok.get(0) ?? [];
    const button = new Sprite(frames[0]?.texture);
    // Its bottom right corner where the original has it (384,505 for 64x30); on phones half as
    // big again, and a finger anywhere near it counts.
    const kb = phoneSized() ? 1.5 : 1;
    button.scale.set(kb);
    // (The bigger phone button sits lower, into the frame's corner, clear of the defender's numbers.)
    button.position.set(Math.round(448 - button.width), Math.round((kb > 1 ? 552 : 535) - button.height));
    if (kb > 1) button.hitArea = new Rectangle(-12, -12, button.texture.width + 24, button.texture.height + 24);
    button.eventMode = "static";
    button.cursor = "pointer";
    button.on("pointerdown", () => frames[1] && (button.texture = frames[1].texture));
    win.addChild(button);
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      if (!root.destroyed) root.destroy({ children: true });
      resolve(answer);
    };
    // HotA's Restart (CBRESTB, 146x40) after a quick combat: the battle again, fought by hand. At the
    // bottom left, level with OK.
    const restartFrames = again?.get(0) ?? [];
    const restart = restartFrames[0] && new Sprite(restartFrames[0].texture);
    if (restart) {
      restart.label = "button: Restart";
      // (On phones a little bigger, its bottom level with OK's, inside the frame.)
      restart.scale.set(Math.min(kb, 1.25));
      restart.position.set(22, Math.round(Math.min(button.y + button.height / 2 - restart.height / 2, button.y + button.height - restart.height)));
      if (kb > 1) restart.hitArea = new Rectangle(-8, -8, restart.texture.width + 16, restart.texture.height + 16);
      restart.eventMode = "static";
      restart.cursor = "pointer";
      restart.on("pointerdown", () => restartFrames[1] && (restart.texture = restartFrames[1].texture));
      win.addChild(restart);
    }
    const shown = halves ? sideBySide(win, bg) : win;
    const hide = modals.show(shown, { own: true, onKey: (k) => ((k === "Enter" || k === "Escape") && (hide(), done()), true) });
    button.on("pointertap", () => (hide(), done()));
    restart?.on("pointertap", () => ((answer = "restart"), hide(), done()));
    // Taken down without an answer (the battle closing): the battle goes on as after OK.
    win.on("destroyed", done);
  });
}

/**
 * A sideways phone: the window's top (who fought, the film, the words) and bottom (the casualties,
 * OK) side by side, each with the frame's edge where it was cut, so the window can be drawn bigger
 * in the low screen. Room is kept at the right for Android's navigation bar (the windows are centred).
 */
function sideBySide(win: Container, bg: Texture): Container {
  const { w: W, h: H } = CPRESULT;
  const P = CPRESULT.parts;
  const GAP = 12;
  const out = new Container();
  out.label = win.label;
  const piece = (name: keyof typeof P, y = 0) => Object.assign(new Sprite(cut(bg, P[name])), { y, label: `part: ${name}` });
  const top = new Container();
  top.addChild(piece("top"), piece("bottomEdge", HALF));
  const bottom = new Container();
  bottom.addChild(piece("topEdge"), piece("bottom", EDGE));
  bottom.x = W + GAP;
  // Everything but the backing to its half (by where it starts).
  for (const c of [...win.children]) {
    if (c instanceof Sprite && c.texture === bg) continue;
    if (c.y < HALF) top.addChild(c);
    else {
      c.y += EDGE - HALF;
      bottom.addChild(c);
    }
  }
  out.addChild(top, bottom);
  // The navigation bar's room as empty space at the right: the centred window keeps clear of it.
  const nav = navBarRight();
  out.boundsArea = new Rectangle(0, 0, 2 * W + GAP + nav, Math.max(HALF + EDGE, H - HALF + EDGE));
  win.on("destroyed", () => out.destroyed || out.destroy({ children: true }));
  out.on("destroyed", () => win.destroyed || win.destroy());
  return out;
}
