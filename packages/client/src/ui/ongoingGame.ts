// The game you were last playing, alone or with friends, as one "ongoing game" item (an addition, EXTRAS
// continueGame; The owner, 2026-10-25): the Your games row (the map's name, your town framed in your colour,
// your strongest hero, the line saying which game it is) on that list's blue, gold-edged panel. The main
// menu has it as Continue, in the Quick game's place.
import { Container, Graphics } from "pixi.js";
import { parseRandomMapName } from "@heroes/core";
import { PLAYED_AT, ago, elsewhere, forgetLocal } from "../cloudSaves.ts";
import { summarize } from "../gameSummary.ts";
import { tr, fmt, said } from "../i18n/index.ts";
import { dayLine, handOverGame, localGame, roomSummary, roomTitle } from "../map/savedGames.ts";
import { fetchMyGames } from "../mp.ts";
import { playSound } from "../audio.ts";
import { YELLOW, loadFonts } from "../text.ts";
import { gameRow } from "./gameRows.ts";
import { bigText } from "./mobilePage.ts";
import { GOLD, panelBack } from "./blocks/menuBlocks.ts";
import { type MapInfo } from "./newGameModel.ts";
import { randomMapInfo } from "./newGameParts.ts";

export interface Ongoing {
  /** The game as the Your games list has it (its map's card, `game` its summary, `sub` which game it is). */
  info: MapInfo;
  multiplayer: boolean;
  /** Where the map page takes it up. */
  open: () => string;
}

const blank = (file: string): MapInfo => ({ file, name: file, description: "", size: 0, levels: 1, version: 28, hota: 0, difficulty: 1, victory: -1, loss: -1, players: [] });

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * The game played last: the room with friends the map page goes back into ("heroes.mp"), else another
 * device's game when it is newer than this one's, else this device's; null with none going on.
 */
export async function latestGame(maps: () => Promise<MapInfo[]>): Promise<Ongoing | null> {
  const card = async (file: string) => {
    const random = parseRandomMapName(file);
    if (random) return randomMapInfo(random);
    return (await maps().catch(() => [])).find((m) => m.file === file) ?? blank(file);
  };
  let room = "";
  try {
    room = (JSON.parse(read("heroes.mp") || "null") as { room?: string } | null)?.room ?? "";
  } catch {
    room = "";
  }
  if (room) {
    const g = (await fetchMyGames().catch(() => [])).find((x) => x.room.id === room);
    // (The map page rejoins it on a plain "#map".)
    if (g && !g.over) return { multiplayer: true, open: () => "#map", info: { ...(await card(g.room.map)), game: roomSummary(g), sub: fmt`${tr("Multiplayer")}: ${roomTitle(g)}`, turn: g.myTurn } };
  }
  const found = await elsewhere(localGame(), Number(read(PLAYED_AT) ?? 0)).catch(() => null);
  // (This device's game finished on another one: no Continue for it here.)
  if (found?.kind === "over") forgetLocal();
  const other = found?.kind === "over" ? null : found?.meta;
  if (other)
    return {
      multiplayer: false,
      open: () => `#map?cloud=${encodeURIComponent(other.slot)}`,
      info: { ...(await card(other.mapFile)), name: other.name, game: other.summary, sub: fmt`${tr("Single player")}, ${said(dayLine(other.day))} · ${said(other.device)}, ${ago(other.savedAt)}` },
    };
  const local = localGame();
  if (!local) return null;
  // (Handed over as Load Game's choice: a plain "#map" would go back into a room left since.)
  return { multiplayer: false, open: () => (handOverGame(local) ? "#map?loaded" : "#map"), info: { ...(await card(local.mapFile)), game: summarize(local), sub: fmt`${tr("Single player")}, ${said(dayLine(local.day))}` } };
}

/** The item, `w` x `h`: "Continue" over the game's row, on the blue panel; a tap calls `onTap`. */
export async function ongoingItem(o: Ongoing, w: number, h: number, onTap: () => void): Promise<Container> {
  // (The card is laid out by its texts' sizes, and the menu asks for the fonts only later: they come first.)
  await loadFonts().catch(() => {});
  const c = new Container();
  c.label = `button: continue ${o.multiplayer ? "multiplayer" : "single player"}`;
  c.addChild(panelBack(w, h));
  // (Centred, as the menus' titles, clear of the panel's filigree corners; the row inside its 8-px rim.)
  const head = bigText(tr("Continue"), "medfont", YELLOW, 1.25, { w: w - 100 });
  head.position.set(Math.round((w - head.width) / 2), 8);
  const rowH = h - head.height - 14;
  const row = await gameRow({ ...o.info, title: undefined }, { w: w - 16, h: rowH, on: false, events: false });
  row.position.set(8, h - rowH - 8);
  c.addChild(head, row);
  // Pressed: the panel's edge lit, as a button.
  const lit = new Graphics().rect(2, 2, w - 4, h - 4).stroke({ color: GOLD, width: 3 });
  lit.visible = false;
  c.addChild(lit);
  c.hitArea = { contains: (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h };
  c.eventMode = "static";
  c.cursor = "pointer";
  c.on("pointerdown", (e) => e.button === 0 && ((lit.visible = true), void playSound("button")));
  c.on("pointerup", () => (lit.visible = false));
  c.on("pointerupoutside", () => (lit.visible = false));
  c.on("pointertap", (e) => e.button === 0 && onTap());
  return c;
}
