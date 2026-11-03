// The original Thieves' Guild window (TPRANK.PCX): players ranked 1st to 8th per row, with
// their flags; the best hero, personality and best monster per player. Positions follow VCMI's
// CThievesGuildWindow.
import { FRAME_PAD, SHEET_IN, SPLIT, fitOnPage, fitSheet, splitLine } from "./blocks/phoneWindow.ts";
import { creatureHold } from "./stackWindow.ts";
import { dateParts } from "@heroes/core";
import type { CreatureStats, ThievesGuildInfo } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { creaturePortrait, heroPortrait, loadDef, loadImage } from "../assets.ts";
import { type FontName, WHITE, YELLOW } from "../text.ts";
import { DefButton, goldBorder, label, loadImagePlayer } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { messageBox } from "./dialogs.ts";
import { bigText, openPage } from "./mobilePage.ts";
import { phoneSized, screenSize } from "./screen.ts";
import { tr, said, type Text, NONE, num } from "../i18n/index.ts";
import { resolveText, textTable } from "./gameText.ts";

const ROWS = [
  "Number of Towns",
  "Number of Heroes",
  "Gold",
  "Wood & Ore",
  "Merc, Sulf, Cryst & Gems",
  "Obelisks Found",
  "Artifacts",
  "Kingdom Army Strength",
  "Income",
  "Best Hero",
  "Personality",
  "Best Monster",
];
const PLACES = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
const BANNERS = ["prred", "prblue", "prtan", "prgreen", "prorange", "prpurple", "prteal", "prrose"];
const PRIMARY = ["Attack", "Defense", "Power", "Knowledge"];

export async function thievesGuildWindow(modals: Modals, player: number, info: ThievesGuildInfo, creatures: CreatureStats[], kingdom: { resources: number[]; day: number }): Promise<void> {
  // Phones: the window's own parts, bigger (the ranking and the best heroes side by side, sideways).
  if (phoneSized()) return phoneThieves(modals, player, info, creatures);
  const win = new Container();
  await drawRanking(win, modals, player, info, creatures);
  const centred = (text: Text, x: number, y: number, width: number) => win.addChild(label(text, "smalfont", WHITE, "center", width).centreOn(x, y));
  // The resource bar along the bottom (VCMI's CMinorResDataBar at 7, 575).
  kingdom.resources.forEach((n, i) => centred(said(String(n)), 7 + 50 + 76 * i, 586, 76));
  centred(tr(`Month: %1, Week: %2, Day: %3`, ...dateParts(kingdom.day)), 7 + 545 + (741 - 545) / 2, 586, 196);

  return new Promise((resolve) => {
    let close = () => {};
    const done = () => (close(), resolve());
    const exit = goldBorder(new DefButton("tpmage1.def", 748, 556));
    exit.onClick = done;
    win.addChild(exit);
    close = modals.show(win, { onKey: (k) => (k === "Escape" || k === "Enter" ? done() : undefined, true) });
  });
}

/** TPRANK with the ranking drawn on it (everything but the resource bar and the exit); `onHero` makes a best hero's portrait a button. */
async function drawRanking(win: Container, modals: Modals, player: number, info: ThievesGuildInfo, creatures: CreatureStats[], onHero?: (c: number) => void) {
  win.addChild(new Sprite(await loadImagePlayer("tprank.pcx", player)));
  const [strips, flags] = await Promise.all([loadDef("prstrips.def"), loadDef("itgflags.def")]);
  const frame = (d: typeof strips, i: number) => d.get(0)?.[i]?.texture;
  /** A label centred on (x, y), as VCMI places them. */
  const centred = (text: Text, x: number, y: number, font: FontName, color: readonly [number, number, number] = WHITE, width = 220) => {
    const t = label(text, font, color, "center", width);
    t.centreOn(x, y);
    win.addChild(t);
  };

  // The game's own words (JKTEXT 24-35 the rows, 16-23 the places: VCMI's jktexts), else ours.
  const [rows, places] = await Promise.all([Promise.all(ROWS.map((t, g) => resolveText({ file: "jktext", id: 24 + g }).then((x) => x || tr(t)))), Promise.all(PLACES.map((t, g) => resolveText({ file: "jktext", id: 16 + g }).then((x) => x || t)))]);
  rows.forEach((text, g) => centred(text, 135, g < 9 ? 52 + 32 * g : [400, 460, 510][g - 9], "medfont", YELLOW));
  for (let g = 1; g < info.players.length; g++) {
    const t = frame(strips, g - 1);
    if (t) win.addChild(Object.assign(new Sprite(t), { x: 250 + 66 * g, y: 7 }));
  }
  info.players.forEach((_, g) => centred(said(places[g]), 283 + 66 * g, 21, "bigfont", YELLOW, 66));

  // Flags of the players at each place, up to four in a row.
  info.rows.forEach((places, g) =>
    places.forEach((players, b) => {
      const xpos = 259 + 66 * b;
      const ypos = 41 + 32 * g;
      const lengths = [Math.min(players.length, 4), Math.max(0, players.length - 4)];
      for (let j = 0; j < 2; j++) {
        const startX = xpos + (j ? 6 + (lengths[j] < 3 ? 12 : 0) : 24 - 6 * lengths[j]);
        const startY = ypos + (j ? 4 : 0);
        for (let i = 0; i < lengths[j]; i++) {
          const t = frame(flags, players[i + j * 4]);
          if (t) win.addChild(Object.assign(new Sprite(t), { x: startX + i * 12, y: startY }));
        }
      }
    }),
  );

  // Best hero: the player's banner, the portrait and (when known) the hero's skills (PRISKILL's names, in the player's language).
  const pri = await textTable("priskill");
  for (const [c, p] of info.players.entries()) {
    const best = info.bestHero[c];
    if (!best) continue;
    win.addChild(Object.assign(new Sprite(await loadImage(`${BANNERS[p]}.pcx`)), { x: 253 + 66 * c, y: 334 }));
    const face = Object.assign(new Sprite(await heroPortrait(best, "small")), { x: 260 + 66 * c, y: 360 });
    win.addChild(face);
    if (onHero) {
      face.eventMode = "static";
      face.cursor = "pointer";
      face.label = "button: best hero";
      face.on("pointertap", () => onHero(c));
      // (A phone: the card says the skills; the tiny lines under the portrait are left out.)
      continue;
    }
    best.primary?.forEach((v, i) => {
      const name = label(pri(i, said(PRIMARY[i])), "tiny", WHITE);
      name.position.set(260 + 66 * c, 407 + 11 * i - 11);
      const value = label(said(String(v)), "tiny", WHITE);
      value.position.set(310 + 66 * c - value.width, 407 + 11 * i - 11);
      win.addChild(name, value);
    });
  }
  info.personality.forEach((text, c) => text && centred(tr(text), 283 + 66 * c, 459, "smalfont", WHITE, 66));
  for (const [c, cr] of info.bestCreature.entries()) {
    if (cr === null) continue;
    const t = await creaturePortrait(creatures[cr], "large");
    if (!t) continue;
    const pic = win.addChild(Object.assign(new Sprite(t), { x: 255 + 66 * c, y: 479 }));
    creatureHold(pic, modals, player, creatures[cr], () => ({ count: 0 }));
  }

}

/** The ranking's two parts on a phone (TPRANK cut to the players there are): the nine rows, and the best heroes,
 * personalities and monsters; sideways side by side, upright one over the other. A best hero's portrait opens its card. */
async function phoneThieves(modals: Modals, player: number, info: ThievesGuildInfo, creatures: CreatureStats[]): Promise<void> {
  const n = Math.max(1, info.players.length);
  const W = 320 + 66 * (n - 1);
  const RANK_H = 332;
  const BEST_H = 218;
  const onHero = (c: number) => {
    const best = info.bestHero[c];
    if (!best) return;
    void (async () => {
      const [face, skills] = await Promise.all([heroPortrait(best, "large"), loadDef("pskil42.def").catch(() => null)]);
      const comps = [{ texture: face, caption: NONE }, ...(best.primary ?? []).flatMap((v, i) => {
        const t = skills?.get(0)?.[i]?.texture;
        return t ? [{ texture: t, caption: num(v) }] : [];
      })];
      await messageBox(modals, (await resolveText({ file: "jktext", id: 33 })) || said(ROWS[9]), player, { components: comps });
    })();
  };
  const part = async (x: number, y: number, w: number, h: number) => {
    const c = new Container();
    await drawRanking(c, modals, player, info, creatures, onHero);
    c.mask = c.addChild(new Graphics().rect(x, y, w, h).fill(0xffffff));
    c.position.set(-x, -y);
    const holder = new Container();
    holder.addChild(c);
    return holder;
  };
  const upright = screenSize.portrait;
  if (upright) return uprightThieves(modals, player, info, creatures, onHero);
  const rank = await part(0, 0, W, RANK_H);
  const best = upright ? await part(0, RANK_H, W, BEST_H) : await part(250, RANK_H, W - 250, BEST_H);
  const exit = goldBorder(new DefButton("tpmage1.def", 0, 0, player));
  await exit.ready;
  const root = new Container();
  root.label = "window: thieves' guild";
  root.addChild(rank, best);
  // The two parts in one window, a gold line between them (phoneWindow's splitLine).
  const P = FRAME_PAD;
  const GAP = 8;
  const bestW = upright ? W : W - 250;
  rank.position.set(P, P);
  if (upright) best.position.set(P, P + RANK_H + SPLIT);
  else best.position.set(P + W + SPLIT, P);
  if (upright) splitLine(root, P, P + RANK_H, W);
  else splitLine(root, P + W, P, Math.max(RANK_H, BEST_H), true);
  const dw = best.x + bestW + P;
  const dh = best.y + BEST_H + P;
  exit.position.set(dw - P - exit.width, dh - P + GAP);
  root.addChild(exit);
  const page = await openPage(modals, { bare: true });
  exit.onClick = () => page.close();
  fitOnPage(root, dw, exit.y + exit.height + P, upright);
  page.setContent(root);
  return page.show();
}

/**
 * Upright, a sheet of its own (2026-10-31 06:58: "optimize the thieves guild for mobile": TPRANK's eight columns
 * came out a hand's width, its words and flags tiny): a line per ranking, its name over the places that have someone,
 * each place's word and its players' flags, bigger; then a line per player: the banner with the best hero (a tap opens
 * the hero's card), the personality in words and the best monster. Only the players in the game; a hidden ranking
 * (the Tavern's level) says so.
 */
async function uprightThieves(modals: Modals, player: number, info: ThievesGuildInfo, creatures: CreatureStats[], onHero: (c: number) => void): Promise<void> {
  const P = FRAME_PAD;
  const [flags, rows, places] = await Promise.all([
    loadDef("itgflags.def"),
    Promise.all(ROWS.map((t, g) => resolveText({ file: "jktext", id: 24 + g }).then((x) => x || tr(t)))),
    Promise.all(PLACES.map((t, g) => resolveText({ file: "jktext", id: 16 + g }).then((x) => x || t))),
  ]);
  const FLAG = 1.5;
  const exit = goldBorder(new DefButton("tpmage1.def", 0, 0, player));
  await exit.ready;
  const portraits = await Promise.all(info.bestHero.map((b) => (b ? heroPortrait(b, "small") : null)));
  const banners = await Promise.all(info.players.map((p) => loadImage(`${BANNERS[p]}.pcx`).catch(() => null)));
  const monsters = await Promise.all(info.bestCreature.map((cr) => (cr === null ? null : creaturePortrait(creatures[cr], "small"))));
  let shell: Awaited<ReturnType<typeof openPage>> | null = null;
  const draw = () => {
    const root = new Container();
    root.label = "window: thieves' guild";
    let y = P;
    // The nine rankings.
    info.rows.forEach((placesHere, g) => {
      if (g) root.addChild(new Graphics().rect(P, y - 4, SHEET_IN, 1).fill({ color: 0xc9a046, alpha: 0.35 }));
      const row = new Container();
      row.label = `panel: ${rows[g]}`;
      const name = bigText(rows[g], "medfont", YELLOW, 1, { w: SHEET_IN });
      row.addChild(name);
      let x = 0;
      let ly = Math.ceil(name.height) + 2;
      const lineH = 18;
      const shown = placesHere.map((players, b) => [players, b] as const).filter(([players]) => players.length);
      // (Hidden by the Tavern's level, or nobody there: the name alone, dimmed, one line.)
      if (!shown.length) {
        name.alpha = 0.5;
        row.position.set(P, y);
        root.addChild(row);
        y += Math.ceil(name.height) + 10;
        return;
      }
      for (const [players, b] of shown) {
        const word = bigText(said(places[b]), "medfont", WHITE, 1);
        const w = Math.ceil(word.width) + 4 + players.length * 12 * FLAG + 12;
        if (x && x + w > SHEET_IN) ((x = 0), (ly += lineH + 4));
        word.position.set(x, ly);
        row.addChild(word);
        players.forEach((p, i) => {
          const t = flags.get(0)?.[p]?.texture;
          if (t) row.addChild(Object.assign(new Sprite(t), { x: x + Math.ceil(word.width) + 4 + i * 12 * FLAG, y: ly + 1, scale: { x: FLAG, y: FLAG } }));
        });
        x += w;
      }
      row.position.set(P, y);
      root.addChild(row);
      y += Math.ceil(ly + lineH) + 10;
    });
    // A line per player: best hero, personality, best monster.
    splitLine(root, P, y, SHEET_IN);
    y += SPLIT;
    const cols = [0, 96, 230];
    [rows[9], rows[10], rows[11]].forEach((t, i) => {
      const h = bigText(t, "medfont", YELLOW, 1, { w: (cols[i + 1] ?? SHEET_IN) - cols[i] - 4 });
      h.position.set(P + cols[i], y);
      root.addChild(h);
    });
    y += 22;
    const ROW = 40;
    info.players.forEach((p, c) => {
      const line = new Container();
      line.label = `panel: ${PLAYER_LABEL[p] ?? p}`;
      const banner = banners[c];
      if (banner) line.addChild(Object.assign(new Sprite(banner), { x: 0, y: 0, width: 88, height: ROW - 4 }));
      else line.addChild(new Graphics().rect(0, 0, 88, ROW - 4).fill({ color: 0x000000, alpha: 0.4 }));
      const face = portraits[c];
      if (face) {
        const f = Object.assign(new Sprite(face), { x: 20, y: 2 });
        f.scale.set((ROW - 8) / face.height);
        f.eventMode = "static";
        f.cursor = "pointer";
        f.label = "button: best hero";
        f.on("pointertap", () => onHero(c));
        line.addChild(f);
      }
      const pers = info.personality[c];
      if (pers) {
        const t = bigText(tr(pers), "medfont", WHITE, 1, { w: cols[2] - cols[1] - 6 });
        t.position.set(cols[1], Math.round((ROW - 4 - t.height) / 2));
        line.addChild(t);
      }
      const mon = monsters[c];
      const cr = info.bestCreature[c];
      if (mon && cr !== null) {
        const m = new Sprite(mon);
        m.scale.set((ROW - 4) / mon.height);
        m.position.set(cols[2], 0);
        creatureHold(m, modals, player, creatures[cr], () => ({ count: 0 }));
        line.addChild(m);
      }
      line.position.set(P, y);
      root.addChild(line);
      y += ROW;
    });
    y += 6;
    exit.scale.set(1.1);
    exit.position.set(P + SHEET_IN - exit.width, y);
    root.addChild(exit);
    fitSheet(root, y + exit.height + P);
    shell?.setContent(root);
  };
  shell = await openPage(modals, { bare: true, title: tr("Thieves' Guild"), draw });
  exit.onClick = () => shell?.close();
  draw();
  return shell.show();
}

const PLAYER_LABEL = ["red", "blue", "tan", "green", "orange", "purple", "teal", "pink"];
